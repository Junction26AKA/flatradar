// One Context.dev monitor per listing page: catches price drops, fee changes and "sold" on every flat we track,
// not just the ones still on search page 1. Search-page monitors still find new listings; each new listing then
// gets its own monitor here, and loses it once the flat is gone.
//
// Stored in `monitors` as { kind: 'listing', listing_id, listing_portal, url, secret } — deliberately with no
// `portal` field, because other code looks up search monitors with findOne({ portal }).
//
// Budget: 1 credit per run. LISTING_MONITOR_MAX caps how many exist (default 0 = off), LISTING_MONITOR_HOURS sets
// the interval (default 2). 800 listings every 2 h ≈ 9,600 credits/day.
import pLimit from 'p-limit';
import { context, call } from './context.mjs';
import getDb from './db.mjs';
import { enrichFromCard } from './enrich.mjs';
import { alertForListing, alertFavouriteDrop } from './alerts/index.mjs';
import { publish } from './bus.mjs';

const PORTALS = ['etuovi', 'vuokraovi']; // Oikotie renders client-side: a page monitor can't see its listings
const MAX = () => Number(process.env.LISTING_MONITOR_MAX ?? 0);
const HOURS = () => Number(process.env.LISTING_MONITOR_HOURS ?? 2);
const GONE_AFTER = 2; // consecutive failed re-reads before a listing counts as removed (one can be a bad render)

const createLimit = pLimit(3); // each create starts a baseline run, which shares the account's 50 concurrent requests
const changeLimit = pLimit(2); // webhook bursts: re-enrich at most 2 listings at once

const priceOf = (l) => (l?.kind === 'rent' ? l.rent : l?.debt_free_price ?? l?.price) ?? null;

/** Is `listing` eligible for its own monitor? */
const eligible = (l) => l && PORTALS.includes(l.portal) && l.url && !l.removed_at;

/** Create a monitor for one listing, unless it has one or the cap is reached. Never throws. */
export async function ensureListingMonitor(listing, { max = MAX() } = {}) {
  const publicUrl = process.env.PUBLIC_URL?.trim().replace(/\/$/, '');
  if (!publicUrl || max <= 0 || !eligible(listing)) return null;
  const db = await getDb();
  const col = db.collection('monitors');
  if (await col.findOne({ kind: 'listing', listing_id: listing._id })) return null;
  if ((await col.countDocuments({ kind: 'listing' })) >= max) return null;
  return createLimit(async () => {
    try {
      const m = await call('monitors.create', () => context.monitors.create({
        name: `flatradar:listing:${listing._id}`,
        target: { type: 'page', url: listing.url, instructions: 'A single property listing. Only the asking price, debt-free price, rent, maintenance fee, availability or sold status, and renovation information matter. Ignore ads, view counters and recommended listings.' },
        change_detection: { type: 'semantic' },
        schedule: { type: 'interval', frequency: HOURS(), unit: 'hours' },
        webhook: { url: `${publicUrl}/webhooks/context`, events: ['change.detected'], retry: {} },
        tags: ['flatradar', 'listing'],
      }), { listingId: listing._id, label: 'create listing monitor' });
      await col.updateOne({ _id: m.id }, { $set: { kind: 'listing', listing_id: listing._id, listing_portal: listing.portal, url: listing.url, secret: m.webhook?.secret, created_at: new Date() } }, { upsert: true });
      return m.id;
    } catch (e) {
      console.error(`listing monitor for ${listing._id} failed:`, e.message);
      return null;
    }
  });
}

/** Give monitors to stored listings that lack one, newest first, up to `max` in total. */
export async function backfillListingMonitors({ max = MAX() } = {}) {
  const db = await getDb();
  const have = await db.collection('monitors').distinct('listing_id', { kind: 'listing' });
  const room = Math.max(0, max - have.length);
  // Flats someone saved (hearted) come first: their savers are waiting for a price-drop email.
  const saved = (await db.collection('users').distinct('favourites')).filter((id) => !have.includes(id));
  const q = { portal: { $in: PORTALS }, status: 'ready', removed_at: null };
  const proj = { projection: { _id: 1, portal: 1, url: 1 } };
  const first = saved.length ? await db.collection('listings').find({ ...q, _id: { $in: saved } }, proj).sort({ first_seen_at: -1 }).limit(room).toArray() : [];
  // Mongo treats limit(0) as "no limit", so skip the query when saved flats already fill the room.
  const rest = room - first.length <= 0 ? [] : await db.collection('listings')
    .find({ ...q, _id: { $nin: [...have, ...first.map((l) => l._id)] } }, proj)
    .sort({ first_seen_at: -1 }).limit(room - first.length).toArray();
  const todo = [...first, ...rest];
  const ids = await Promise.all(todo.map((l) => ensureListingMonitor(l, { max })));
  return { existing: have.length, created: ids.filter(Boolean).length, attempted: todo.length };
}

/** Delete a listing's monitor (flat sold or removed). */
export async function dropListingMonitor(monitorId) {
  const db = await getDb();
  try {
    await call('monitors.delete', () => context.monitors.delete(monitorId), { label: 'delete listing monitor' });
  } catch (e) {
    if (!/404|not.?found/i.test(e.message)) console.error(`delete monitor ${monitorId} failed:`, e.message);
  }
  await db.collection('monitors').deleteOne({ _id: monitorId });
}

/**
 * A listing page changed. Re-enrich it (one extraction scrape + the usual fan-out; upsertListing appends to
 * price_history on a price change), then publish a price drop or mark the listing removed.
 */
export function handleListingChange(mon, body) {
  return changeLimit(async () => {
    const db = await getDb();
    const before = await db.collection('listings').findOne({ _id: mon.listing_id });
    if (!before) return dropListingMonitor(mon._id);
    const summary = body.data?.change?.summary ?? body.data?.change?.description ?? null;
    console.log(`${new Date().toISOString()} listing ${mon.listing_id} changed${summary ? `: ${String(summary).slice(0, 200)}` : ''}`);

    const after = await enrichFromCard({ id: before._id, portal: before.portal, kind: before.kind, url: before.url });
    const reread = after?.extracted_at && (!before.extracted_at || after.extracted_at > before.extracted_at);
    const soldHint = /\b(sold|myyty|removed|poistettu|no longer available|ei enää saatavilla|vuokrattu)\b/i.test(String(summary ?? ''));

    if (!reread || soldHint) {
      const fails = (mon.failed_reads ?? 0) + 1;
      if (soldHint || fails >= GONE_AFTER) {
        await db.collection('listings').updateOne({ _id: before._id }, { $set: { removed_at: new Date() } });
        publish('listing.updated', { id: before._id, patch: { removed_at: new Date() } });
        await dropListingMonitor(mon._id);
        console.log(`listing ${before._id} looks removed; monitor deleted`);
      } else {
        await db.collection('monitors').updateOne({ _id: mon._id }, { $set: { failed_reads: fails } });
      }
      return;
    }
    await db.collection('monitors').updateOne({ _id: mon._id }, { $set: { failed_reads: 0, last_change_at: new Date() } });

    const oldP = priceOf(before), newP = priceOf(after);
    if (oldP != null && newP != null && newP < oldP) {
      const drop = { old_price: oldP, new_price: newP, at: new Date(), via: 'listing-monitor' };
      await db.collection('listings').updateOne({ _id: before._id }, { $set: { last_price_drop: drop } });
      publish('listing.price_drop', { id: before._id, ...drop });
      await alertForListing(after).catch((e) => console.error('alert failed:', e.message));
      await alertFavouriteDrop(before._id, drop).catch((e) => console.error('favourite drop alert failed:', e.message));
    }
  });
}
