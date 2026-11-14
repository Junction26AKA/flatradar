// FlatRadar service: API, SSE stream, Context.dev webhook receiver, mock feed, static web app.
//   npm start      (PORT 3000, HOST 127.0.0.1 by default; set HOST=0.0.0.0 when deployed)
// Contract: docs/contracts.md
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { context, call, telemetry } from './lib/context.mjs';
import getDb, { client } from './lib/db.mjs';
import { bus } from './lib/bus.mjs';
import { ensureMonitors, verifySignature, findSignatureHeader, handleWebhook, processSearchPage, sweepPrices } from './lib/monitors.mjs';
import { publishMock, renderIndex, renderListing, renderPdf, mockCards, mockJson, PRESETS } from './lib/mock.mjs';
import { enrichFromCard, resumeStuck, resumeInsights } from './lib/enrich.mjs';
import { alertForListing } from './lib/alerts/index.mjs';
import { loadStreetWorks, streetWorksStatus } from './lib/flags/streetworks.mjs';
import { hashPassword, verifyPassword, passwordProblem, startSession, endSession, currentUser, publicUser } from './lib/auth.mjs';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_URL = process.env.PUBLIC_URL?.trim().replace(/\/$/, '') || null;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || null;
const WEB_DIR = path.resolve('web/dist');
// Client-side routes: these paths get web/dist/index.html so deep links and reloads work.
const SPA_ROUTE = /^\/(?:app(?:\/.*)?|signin\/?)$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const db = await getDb();
const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------- helpers ----------
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', ...headers });
  res.end(JSON.stringify(body));
}
const readBody = (req, limit = 1_000_000) => new Promise((resolve, reject) => {
  const chunks = []; let size = 0;
  req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});
const readJson = async (req) => { const b = await readBody(req); return b.length ? JSON.parse(b.toString('utf8')) : {}; };
const isAdmin = (req) => !ADMIN_TOKEN || req.headers['x-admin-token'] === ADMIN_TOKEN;

// ---------- SSE hub ----------
const clients = new Set();
function broadcast(type, data) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}
bus.on('message', ({ type, data }) => broadcast(type, data));
telemetry.on('call.start', (e) => broadcast('call.start', e));
telemetry.on('call.end', (e) => {
  broadcast('call.end', e);
  db.collection('calls').insertOne({ ...e, at: new Date() }).catch(() => {});
});
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 20_000);

function openStream(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n\n');
  res.write(`event: hello\ndata: ${JSON.stringify({ server_time: new Date() })}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
}

// ---------- mock demo flow ----------
let mockFallbackTimer = null;
async function triggerMock(preset) {
  const slug = await publishMock(preset);
  const listingId = `mock:${slug}`;
  const mon = await db.collection('monitors').findOne({ portal: 'mock' });
  if (PUBLIC_URL && mon) {
    // Real path: Context.dev re-reads /mock, detects the change and calls our webhook.
    await call('monitors.run', () => context.monitors.run(mon._id), { listingId, label: 'run mock monitor now' });
    log(`mock ${slug}: monitor ${mon._id} run queued`);
    clearTimeout(mockFallbackTimer);
    mockFallbackTimer = setTimeout(async () => {
      const seen = await db.collection('listings').findOne({ _id: listingId }, { projection: { _id: 1 } });
      if (!seen) { log(`mock ${slug}: no webhook after 40 s, diffing /mock directly`); processSearchPage({ portal: 'mock', url: `${PUBLIC_URL}/mock` }, { reason: 'mock-fallback' }).catch((e) => log('mock fallback failed', e.message)); }
    }, 40_000);
  } else {
    // Local path: no public URL, so Context.dev can't scrape our pages. Use the mock data as the extraction.
    const card = (await mockCards()).find((c) => c.id === listingId);
    const doc = await db.collection('mock_listings').findOne({ _id: slug });
    enrichFromCard(card, { json: mockJson(doc) }).then((l) => alertForListing(l)).catch((e) => log('mock enrich failed', e.message));
  }
  return listingId;
}

// ---------- routes ----------
async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  if (req.method === 'OPTIONS') return send(res, 204, {}, { 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'content-type,x-admin-token' });
  if (p === '/stream') return openStream(req, res);

  if (p === '/webhooks/context' && req.method === 'POST') {
    const raw = await readBody(req);
    let body;
    try { body = JSON.parse(raw.toString('utf8')); } catch { return send(res, 400, { error: 'bad json' }); }
    const mon = await db.collection('monitors').findOne({ _id: body?.data?.change?.monitor_id ?? '' });
    const sig = findSignatureHeader(req.headers);
    if (!mon?.secret || !verifySignature(raw, sig, mon.secret)) {
      log('webhook rejected', { monitor: body?.data?.change?.monitor_id, has_secret: !!mon?.secret, has_sig: !!sig, headers: Object.keys(req.headers) });
      return send(res, 401, { error: 'bad signature' });
    }
    if (req.headers['x-context-id'] && req.headers['x-context-id'] !== body.id) return send(res, 400, { error: 'id mismatch' });
    send(res, 200, { ok: true });
    log(`webhook ${body.event} ${body.id} monitor=${mon._id} (${mon.portal})`);
    handleWebhook(body).catch((e) => log('webhook processing failed:', e.message));
    return;
  }

  if (p === '/api/health') {
    const [monitors, last] = await Promise.all([
      db.collection('monitors').find({}, { projection: { secret: 0 } }).toArray(),
      db.collection('webhook_events').find().sort({ at: -1 }).limit(1).next(),
    ]);
    const counts = await db.collection('listings').aggregate([{ $group: { _id: '$kind', n: { $sum: 1 } } }]).toArray();
    // Also pings the scorer: the keepalive hitting this route keeps a sleeping free scorer instance awake too.
    const scorerUrl = process.env.SCORER_URL?.trim().replace(/\/$/, '');
    const scorer = scorerUrl
      ? await fetch(`${scorerUrl}/health`, { signal: AbortSignal.timeout(2500) }).then((r) => r.json()).catch((e) => ({ ok: false, error: e.name }))
      : null;
    return send(res, 200, { ok: true, public_url: PUBLIC_URL, monitors, last_webhook_at: last?.at ?? null, listings: Object.fromEntries(counts.map((c) => [c._id, c.n])), sse_clients: clients.size, scorer, street_works: streetWorksStatus() });
  }

  if (p === '/api/listings' && req.method === 'GET') {
    const kind = url.searchParams.get('kind');
    const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 500);
    const q = { ...(kind ? { kind } : {}), ...(url.searchParams.get('scored') ? { 'score.deal_pct': { $ne: null } } : {}) };
    const items = await db.collection('listings').find(q, { projection: { doc_extracts: 0 } }).sort({ first_seen_at: -1 }).limit(limit).toArray();
    return send(res, 200, { items });
  }

  let m;
  if ((m = p.match(/^\/api\/listings\/(.+)$/)) && req.method === 'GET') {
    const id = decodeURIComponent(m[1]);
    const listing = await db.collection('listings').findOne({ _id: id }, { projection: { doc_extracts: 0 } });
    if (!listing) return send(res, 404, { error: 'not found' });
    const calls = await db.collection('calls').find({ listing_id: id }).sort({ started_at: 1 }).limit(200).project({ _id: 0 }).toArray();
    return send(res, 200, { ...listing, calls });
  }

  if (p === '/api/users' && req.method === 'POST') {
    const b = await readJson(req);
    if (typeof b.email !== 'string' || !EMAIL_RE.test(b.email)) return send(res, 400, { error: 'valid email required' });
    if (b.password != null) { const problem = passwordProblem(b.password); if (problem) return send(res, 400, { error: problem }); }
    const email = b.email.toLowerCase();
    // An account with a password can only be changed by its signed-in owner.
    const existing = await db.collection('users').findOne({ email }, { projection: { password_hash: 1 } });
    if (existing?.password_hash) {
      const me = await currentUser(req);
      if (!me || String(me._id) !== String(existing._id)) return send(res, 409, { error: 'account exists, sign in first' });
    }
    const searches = Array.isArray(b.searches) ? b.searches.slice(0, 5) : [];
    const set = { name: b.name ?? null, searches, updated_at: new Date(), ...(b.password ? { password_hash: await hashPassword(b.password) } : {}) };
    const r = await db.collection('users').findOneAndUpdate({ email }, { $set: set, $setOnInsert: { email, created_at: new Date() } }, { upsert: true, returnDocument: 'after' });
    // Signing up with a password also signs you in.
    return send(res, 200, { id: r._id }, b.password ? { 'Set-Cookie': await startSession(r._id) } : {});
  }

  // Sign-in (cookie session, same origin)
  if (p === '/api/me' && req.method === 'GET') {
    const me = await currentUser(req);
    return me ? send(res, 200, { user: publicUser(me) }) : send(res, 401, { error: 'not signed in' });
  }
  if (p === '/api/session' && req.method === 'POST') {
    const b = await readJson(req);
    if (typeof b.email !== 'string' || typeof b.password !== 'string' || !b.password) return send(res, 400, { error: 'email and password required' });
    const user = await db.collection('users').findOne({ email: b.email.toLowerCase() });
    if (!(await verifyPassword(b.password, user?.password_hash))) return send(res, 401, { error: 'wrong email or password' });
    return send(res, 200, { user: publicUser(user) }, { 'Set-Cookie': await startSession(user._id) });
  }
  if (p === '/api/session' && req.method === 'DELETE') {
    return send(res, 200, { ok: true }, { 'Set-Cookie': await endSession(req) });
  }

  // Mock feed (public, scraped by Context.dev)
  if (p === '/mock') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(await renderIndex()); }
  if ((m = p.match(/^\/mock\/([\w-]+)\/isannoitsijantodistus\.pdf$/))) {
    const pdf = await renderPdf(m[1]);
    if (!pdf) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': pdf.length }); return res.end(pdf);
  }
  if (p === '/mock/publish' && req.method === 'POST') {
    const b = await readJson(req);
    const preset = b.preset && PRESETS[b.preset] ? b.preset : 'kallio-2h';
    return send(res, 200, { listing_id: await triggerMock(preset) });
  }
  if ((m = p.match(/^\/mock\/([\w-]+)$/))) {
    const html = await renderListing(m[1]);
    if (!html) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(html);
  }

  // Admin (token required if ADMIN_TOKEN is set)
  if (p === '/admin/monitors' && req.method === 'POST') {
    if (!isAdmin(req)) return send(res, 403, { error: 'forbidden' });
    return send(res, 200, { monitors: await ensureMonitors(PUBLIC_URL) });
  }
  if (p === '/admin/poll' && req.method === 'POST') {
    if (!isAdmin(req)) return send(res, 403, { error: 'forbidden' });
    const b = await readJson(req);
    const portal = b.portal ?? 'etuovi';
    const mon = await db.collection('monitors').findOne({ portal });
    const { PORTALS } = await import('./lib/ingest/portals.mjs');
    const target = { portal, url: mon?.url ?? PORTALS[portal]?.search(1) ?? `${PUBLIC_URL}/mock` };
    processSearchPage(target, { reason: 'manual' }).then((r) => log('manual poll', portal, r)).catch((e) => log('manual poll failed', e.message));
    return send(res, 202, { started: target });
  }

  if (p === '/admin/sweep' && req.method === 'POST') {
    if (!isAdmin(req)) return send(res, 403, { error: 'forbidden' });
    const b = await readJson(req);
    sweepPrices(b.pages ? { pages: Number(b.pages) } : {}).catch((e) => log('price sweep failed', e.message));
    return send(res, 202, { started: true });
  }

  // Static web app
  if (req.method === 'GET' && fs.existsSync(WEB_DIR)) {
    const file = path.join(WEB_DIR, p === '/' ? 'index.html' : p);
    if (file.startsWith(WEB_DIR) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' }[path.extname(file)] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type }); return fs.createReadStream(file).pipe(res);
    }
    if (SPA_ROUTE.test(p)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return fs.createReadStream(path.join(WEB_DIR, 'index.html')).pipe(res);
    }
  }
  return send(res, 404, { error: 'not found' });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((e) => { log('error', req.method, req.url, e.message); if (!res.headersSent) send(res, 500, { error: 'internal error' }); });
});
server.listen(PORT, HOST, () => {
  log(`FlatRadar on http://${HOST}:${PORT} (public: ${PUBLIC_URL ?? 'none'})`);
  // Finish work a previous instance left half-done (free instances restart without warning, and a deploy can stop
  // the old instance mid-run): at startup, anything started before this process; then a sweep every 3 min.
  const startedAt = new Date();
  const resumeEnrich = (before) => resumeStuck({ before }).then((n) => n && log(`resumed ${n} half-enriched listings`)).catch((e) => log('resume failed', e.message));
  const resumeGemini = (before) => resumeInsights({ before }).then((n) => n && log(`retried ${n} unfinished Gemini analyses`)).catch((e) => log('insight resume failed', e.message));
  loadStreetWorks(); // warm the street-works register before the first enrichment needs it
  setInterval(loadStreetWorks, 30 * 60 * 1000).unref();
  setTimeout(() => resumeEnrich(startedAt), 5_000);
  setTimeout(() => resumeGemini(startedAt), 10_000);
  // Price sweep over search pages 2…N (page 1 is the monitors' job). Deployed instance only, as it spends credits.
  const sweepMin = Number(process.env.PRICE_SWEEP_MINUTES ?? 60);
  if (PUBLIC_URL && sweepMin > 0) {
    setTimeout(() => sweepPrices().catch((e) => log('price sweep failed', e.message)), 2 * 60 * 1000);
    setInterval(() => sweepPrices().catch((e) => log('price sweep failed', e.message)), sweepMin * 60 * 1000).unref();
  }
  setInterval(() => {
    resumeEnrich(new Date(Date.now() - 5 * 60 * 1000));
    resumeGemini(new Date(Date.now() - 2 * 60 * 1000));
  }, 3 * 60 * 1000).unref();
});

const stop = async () => { server.close(); for (const r of clients) r.end(); await client.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
