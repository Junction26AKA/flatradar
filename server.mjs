// FlatRadar service: API, SSE stream, Context.dev webhook receiver, mock feed, static web app.
//   npm start      (PORT 3000, HOST 127.0.0.1 by default; set HOST=0.0.0.0 when deployed)
// Contract: docs/contracts.md
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { context, call, telemetry } from './lib/context.mjs';
import getDb, { client } from './lib/db.mjs';
import { bus } from './lib/bus.mjs';
import { ensureMonitors, verifySignature, findSignatureHeader, handleWebhook, processSearchPage } from './lib/monitors.mjs';
import { publishMock, renderIndex, renderListing, renderPdf, mockCards, mockJson, PRESETS } from './lib/mock.mjs';
import { enrichFromCard } from './lib/enrich.mjs';
import { alertForListing } from './lib/alerts/index.mjs';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_URL = process.env.PUBLIC_URL?.replace(/\/$/, '') || null;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || null;
const WEB_DIR = path.resolve('web/dist');
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

  if (req.method === 'OPTIONS') return send(res, 204, {}, { 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'content-type,x-admin-token' });
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
    return send(res, 200, { ok: true, public_url: PUBLIC_URL, monitors, last_webhook_at: last?.at ?? null, listings: Object.fromEntries(counts.map((c) => [c._id, c.n])), sse_clients: clients.size });
  }

  if (p === '/api/listings' && req.method === 'GET') {
    const kind = url.searchParams.get('kind');
    const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 500);
    const q = { ...(kind ? { kind } : {}), ...(url.searchParams.get('scored') ? { 'score.deal_pct': { $ne: null } } : {}) };
    const items = await db.collection('listings').find(q).sort({ first_seen_at: -1 }).limit(limit).toArray();
    return send(res, 200, { items });
  }

  let m;
  if ((m = p.match(/^\/api\/listings\/(.+)$/)) && req.method === 'GET') {
    const id = decodeURIComponent(m[1]);
    const listing = await db.collection('listings').findOne({ _id: id });
    if (!listing) return send(res, 404, { error: 'not found' });
    const calls = await db.collection('calls').find({ listing_id: id }).sort({ started_at: 1 }).limit(200).project({ _id: 0 }).toArray();
    return send(res, 200, { ...listing, calls });
  }

  if (p === '/api/users' && req.method === 'POST') {
    const b = await readJson(req);
    if (!b.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email)) return send(res, 400, { error: 'valid email required' });
    const searches = Array.isArray(b.searches) ? b.searches.slice(0, 5) : [];
    const r = await db.collection('users').findOneAndUpdate({ email: b.email.toLowerCase() }, { $set: { name: b.name ?? null, searches, updated_at: new Date() }, $setOnInsert: { created_at: new Date() } }, { upsert: true, returnDocument: 'after' });
    return send(res, 200, { id: r._id });
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

  // Static web app
  if (req.method === 'GET' && fs.existsSync(WEB_DIR)) {
    const file = path.join(WEB_DIR, p === '/' ? 'index.html' : p);
    if (file.startsWith(WEB_DIR) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' }[path.extname(file)] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type }); return fs.createReadStream(file).pipe(res);
    }
    if (!p.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': 'text/html' }); return fs.createReadStream(path.join(WEB_DIR, 'index.html')).pipe(res); }
  }
  return send(res, 404, { error: 'not found' });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((e) => { log('error', req.method, req.url, e.message); if (!res.headersSent) send(res, 500, { error: 'internal error' }); });
});
server.listen(PORT, HOST, () => log(`FlatRadar on http://${HOST}:${PORT} (public: ${PUBLIC_URL ?? 'none'})`));

const stop = async () => { server.close(); for (const r of clients) r.end(); await client.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
