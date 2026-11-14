// Context.dev monitors on the portal search pages (+ our mock page), and the webhook → diff → enrich flow.
import { createHmac, timingSafeEqual } from 'node:crypto';
import pLimit from 'p-limit';
import { context, call } from './context.mjs';
import getDb from './db.mjs';
import { PORTALS, parseSearchCards } from './ingest/portals.mjs';
import { enrichFromCard } from './enrich.mjs';
import { alertForListing } from './alerts/index.mjs';

const MONITOR_PREFIX = 'flatradar';
const enrichLimit = pLimit(4); // listings enriched at once (each fans out further)

export function monitorTargets(publicUrl) {
  const t = Object.entries(PORTALS).map(([portal, p]) => ({ name: `${MONITOR_PREFIX}:${portal}`, portal, url: p.search(1), minutes: 10 }));
  if (publicUrl) t.push({ name: `${MONITOR_PREFIX}:mock`, portal: 'mock', url: `${publicUrl.replace(/\/$/, '')}/mock`, minutes: 10 }); // also keeps a free Render instance awake
  return t;
}

/** Create (or re-point) one monitor per target. Stores id + signing secret in `monitors`. Idempotent. */
export async function ensureMonitors(publicUrl) {
  publicUrl = publicUrl?.trim().replace(/\/$/, '');
  if (!publicUrl) throw new Error('PUBLIC_URL is required so Context.dev can reach /webhooks/context');
  const db = await getDb();
  const webhookUrl = `${publicUrl.replace(/\/$/, '')}/webhooks/context`;
  const existing = (await context.monitors.list({ limit: 100 })).data ?? [];
  const out = [];
  for (const t of monitorTargets(publicUrl)) {
    const found = existing.find((m) => m.name === t.name);
    const body = {
      name: t.name,
      // Portals: semantic detection ignores ad/sponsor churn. Mock: exact is ~20 s faster, which matters on stage.
      target: t.portal === 'mock' ? { type: 'page', url: t.url } : { type: 'page', url: t.url, instructions: 'A list of property listings; only listing cards (new listings, prices) matter.' },
      change_detection: { type: t.portal === 'mock' ? 'exact' : 'semantic' },
      schedule: { type: 'interval', frequency: t.minutes, unit: 'minutes' },
      webhook: { url: webhookUrl, events: ['change.detected'], retry: {} },
      tags: ['flatradar'],
    };
    const m = found
      ? await call('monitors.update', () => context.monitors.update(found.id, body))
      : await call('monitors.create', () => context.monitors.create(body));
    await db.collection('monitors').updateOne(
      { _id: m.id },
      { $set: { name: t.name, portal: t.portal, url: t.url, ...(m.webhook?.secret ? { secret: m.webhook.secret } : {}), updated_at: new Date() } },
      { upsert: true },
    );
    out.push({ id: m.id, name: t.name, url: t.url, has_secret: !!m.webhook?.secret });
  }
  return out;
}

/** Verify a Context.dev webhook (docs.context.dev/webhooks). Header value looks like "t=…,v1=…". */
export function verifySignature(rawBody, headerValue, secret, toleranceSec = 300) {
  if (!secret || !headerValue) return false;
  const parts = Object.fromEntries(headerValue.split(',').map((p) => p.trim().split('=')).filter((p) => p.length === 2));
  if (!/^\d{1,12}$/.test(parts.t ?? '') || !/^[a-f0-9]{64}$/i.test(parts.v1 ?? '')) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${parts.t}.`).update(rawBody).digest();
  const actual = Buffer.from(parts.v1, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Find the signature header without hard-coding its name: the one whose value is "t=…,v1=…". */
export function findSignatureHeader(headers) {
  for (const [k, v] of Object.entries(headers)) if (/sig/i.test(k) && /t=\d+.*v1=[a-f0-9]{64}/i.test(String(v))) return String(v);
  return null;
}

/**
 * A search page changed: re-read it, diff cards against the DB, enrich new listings and price changes.
 * `source` = {portal, url}. For the mock portal, cards come from our own `mock_listings` collection.
 */
export async function processSearchPage({ portal, url }, { reason = 'webhook' } = {}) {
  const db = await getDb();
  let cards;
  if (portal === 'mock') {
    const { mockCards } = await import('./mock.mjs');
    cards = await mockCards();
  } else {
    const r = await call('web.scrape', () => context.web.scrape({ url, formats: { markdown: true }, maxAgeMs: 0, tags: ['flatradar', 'monitor'] }), { label: `${portal} search (diff)` });
    cards = parseSearchCards(r.markdown?.data ?? '', portal);
  }
  const ids = cards.map((c) => c.id);
  const known = new Map((await db.collection('listings').find({ _id: { $in: ids } }, { projection: { kind: 1, debt_free_price: 1, price: 1, rent: 1 } }).toArray()).map((d) => [d._id, d]));
  const changed = cards.filter((c) => {
    const k = known.get(c.id);
    if (!k) return true;
    const was = c.kind === 'rent' ? k.rent : k.price ?? k.debt_free_price;
    const now = c.kind === 'rent' ? c.rent : c.price;
    return was != null && now != null && was !== now;
  });
  await db.collection('runs').insertOne({ type: 'diff', portal, reason, cards: cards.length, changed: changed.map((c) => c.id), at: new Date() });
  console.log(`${new Date().toISOString()} diff ${portal} (${reason}): ${cards.length} cards, ${changed.length} new/changed`);
  await Promise.allSettled(changed.map((c) => enrichLimit(async () => {
    const listing = await enrichFromCard(c);
    if (listing) await alertForListing(listing).catch((e) => console.error('alert failed:', e.message));
  })));
  return { cards: cards.length, changed: changed.map((c) => c.id) };
}

/** Handle a verified webhook body. Dedupes on event id. */
export async function handleWebhook(body) {
  const db = await getDb();
  const ins = await db.collection('webhook_events').updateOne({ _id: body.id }, { $setOnInsert: { at: new Date(), event: body.event, monitor_id: body.data?.change?.monitor_id ?? null } }, { upsert: true });
  if (!ins.upsertedCount) return { duplicate: true };
  const monitorId = body.data?.change?.monitor_id;
  const mon = await db.collection('monitors').findOne({ _id: monitorId });
  if (!mon) return { ignored: 'unknown monitor' };
  await db.collection('monitors').updateOne({ _id: monitorId }, { $set: { last_webhook_at: new Date() } });
  return processSearchPage({ portal: mon.portal, url: mon.url });
}
