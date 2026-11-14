// Context.dev monitors on the portal search pages (+ our mock page), and the webhook → diff → enrich flow.
import { createHmac, timingSafeEqual } from 'node:crypto';
import pLimit from 'p-limit';
import { context, call } from './context.mjs';
import getDb from './db.mjs';
import { PORTALS, parseSearchCards } from './ingest/portals.mjs';
import { enrichFromCard } from './enrich.mjs';
import { alertForListing } from './alerts/index.mjs';
import { publish } from './bus.mjs';

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
  // Diff on the price *as shown on the search card* (Etuovi cards show the debt-free price, not the sale
  // price), remembered per listing in `card_price`. A listing seen for the first time on a card (e.g. from
  // the backfill) just records its card price; only a later difference counts as a price change.
  const cardPrice = (c) => (c.kind === 'rent' ? c.rent : c.price) ?? null;
  const ids = cards.map((c) => c.id);
  const known = new Map((await db.collection('listings').find({ _id: { $in: ids } }, { projection: { card_price: 1 } }).toArray()).map((d) => [d._id, d]));
  const changed = [];
  const writes = [];
  let crossListed = 0;
  for (const c of cards) {
    const k = known.get(c.id);
    const now = cardPrice(c);
    if (!k) {
      if (portal !== 'mock') {
        // Same flat already stored from another portal: note where else it's listed instead of a duplicate card.
        const dup = await findCrossListing(db, c);
        if (dup) {
          writes.push({ updateOne: { filter: { _id: dup._id }, update: { $set: { [`also_on.${c.portal}`]: { id: c.id, url: c.url, price: now, seen_at: new Date() } } } } });
          crossListed++;
          continue;
        }
        // Same flat claimed by another diff that hasn't stored it yet: skip it; the next diff records also_on.
        if (claimedTwin(c)) { crossListed++; continue; }
        if (claimed.has(c.id)) continue; // already being enriched by another diff of this portal
        claimed.set(c.id, c);
      }
      changed.push(c);
      continue;
    }
    if (k.card_price == null || now == null) { if (now != null) writes.push({ updateOne: { filter: { _id: c.id }, update: { $set: { card_price: now } } } }); continue; }
    if (now !== k.card_price) {
      changed.push(c);
      // The last drop is stored on the listing too, so the "price dropped" badge survives a page reload.
      const drop = now < k.card_price ? { old_price: k.card_price, new_price: now, at: new Date() } : null;
      writes.push({ updateOne: { filter: { _id: c.id }, update: { $set: { card_price: now, ...(drop ? { last_price_drop: drop } : {}) } } } });
      if (drop) publish('listing.price_drop', { id: c.id, ...drop });
    }
  }
  // New listings only exist once enrichment has inserted them, so their card price is written afterwards.
  const newWrites = changed.filter((c) => !known.has(c.id) && cardPrice(c) != null).map((c) => ({ updateOne: { filter: { _id: c.id }, update: { $set: { card_price: cardPrice(c) } } } }));
  try {
    await db.collection('runs').insertOne({ type: 'diff', portal, reason, cards: cards.length, changed: changed.map((c) => c.id), cross_listed: crossListed, at: new Date() });
  } catch (e) {
    for (const c of changed) claimed.delete(c.id); // nothing will enrich them: release the claims
    throw e;
  }
  console.log(`${new Date().toISOString()} diff ${portal} (${reason}): ${cards.length} cards, ${changed.length} new/changed, ${crossListed} already listed elsewhere`);
  const enrichAll = Promise.allSettled(changed.map((c) => enrichLimit(async () => {
    try {
      const listing = await enrichFromCard(c);
      if (listing) await alertForListing(listing).catch((e) => console.error('alert failed:', e.message));
    } finally {
      claimed.delete(c.id); // stored now (or failed): the DB check takes over
    }
  })));
  if (writes.length) await db.collection('listings').bulkWrite(writes, { ordered: false });
  await enrichAll;
  if (newWrites.length) await db.collection('listings').bulkWrite(newWrites, { ordered: false });
  return { cards: cards.length, changed: changed.map((c) => c.id) };
}

/**
 * Price sweep: the monitors only watch page 1 (newest first), so a listing that has scrolled off it could drop
 * its price unseen. Re-read search pages 2…N of each portal and run the same diff: a changed card price is a
 * price change (published as `listing.price_drop` when it went down) and the listing is re-enriched, which
 * appends to its price_history. About 1 credit per page. The first sweep after a backfill only records card
 * prices; drops show up from the second sweep on.
 */
let sweeping = null;
export function sweepPrices({ pages = Number(process.env.SWEEP_PAGES) || 12 } = {}) {
  if (sweeping) return sweeping;
  sweeping = (async () => {
    const t0 = Date.now();
    const out = { pages: 0, cards: 0, changed: 0, failed: 0 };
    const jobs = Object.entries(PORTALS).flatMap(([portal, p]) => Array.from({ length: Math.max(0, Math.min(pages, p.sweepPages ?? pages) - 1) }, (_, i) => ({ portal, url: p.search(i + 2) })));
    const limit = pLimit(3);
    await Promise.all(jobs.map((j) => limit(async () => {
      try {
        const r = await processSearchPage(j, { reason: 'price-sweep' });
        out.pages++; out.cards += r.cards; out.changed += r.changed.length;
      } catch (e) {
        out.failed++;
        console.error(`sweep ${j.url} failed:`, e.message);
      }
    })));
    console.log(`${new Date().toISOString()} price sweep: ${JSON.stringify(out)} in ${Math.round((Date.now() - t0) / 1000)} s`);
    return out;
  })().finally(() => { sweeping = null; });
  return sweeping;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CROSS_MAX_AGE_MS = 45 * 24 * 3600 * 1000; // a listing unseen for longer is probably sold or withdrawn

/** "Pengerkatu 7 B, Helsinki" → { street: 'pengerkatu', num: '7', letter: 'b' }; null without a house number. */
export function addressParts(address) {
  const m = String(address ?? '').split(',')[0].trim().toLowerCase().match(/^(.+?)\s+(\d+)(?:\s*-\s*\d+)?(?:\s+([a-zåäö])(?![a-zåäö]))?/);
  return m ? { street: m[1], num: m[2], letter: m[3] ?? null } : null;
}

/** Could two listings be the same flat? Same kind, street and number, m² within 1, and no conflicting staircase or rooms. */
export function sameFlat(a, b) {
  const pa = addressParts(a.address), pb = addressParts(b.address);
  if (!pa || !pb || a.kind !== b.kind || !a.m2 || !b.m2) return false;
  if (pa.street !== pb.street || pa.num !== pb.num || Math.abs(a.m2 - b.m2) > 1) return false;
  if (pa.letter && pb.letter && pa.letter !== pb.letter) return false; // B and C staircases are different flats
  if (a.rooms && b.rooms && a.rooms !== b.rooms) return false;
  return true;
}

/** A recently seen listing from another portal that is the same flat as card `c`, or null. */
export async function findCrossListing(db, c) {
  const parts = addressParts(c.address);
  if (!parts || !c.m2) return null;
  const candidates = await db.collection('listings').find({
    kind: c.kind,
    portal: { $nin: [c.portal, 'mock'] },
    m2: { $gte: c.m2 - 1, $lte: c.m2 + 1 },
    address: { $regex: `^${escapeRe(parts.street)}\\s+${parts.num}(?!\\d)`, $options: 'i' },
    last_seen_at: { $gte: new Date(Date.now() - CROSS_MAX_AGE_MS) },
  }, { projection: { _id: 1, address: 1, kind: 1, m2: 1, rooms: 1 } }).limit(10).toArray();
  return candidates.find((d) => sameFlat(c, d)) ?? null;
}

// New cards claimed by a diff in this process but not stored yet (a listing is inserted when its enrichment
// starts, which can be queued behind others). Lets two diffs running at once (e.g. the Etuovi and Oikotie
// monitors firing together) see each other's new flats, so the same flat isn't enriched twice.
const claimed = new Map(); // card id → card
const claimedTwin = (c) => [...claimed.values()].find((x) => x.portal !== c.portal && sameFlat(c, x)) ?? null;

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
