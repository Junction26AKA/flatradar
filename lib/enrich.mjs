// Live pipeline for one listing: card → extract → parallel fan-out (flags, score, news, PDFs) → ready.
// Every step patches Mongo and publishes `listing.updated`, so the card fills in as calls return.
import { context, call } from './context.mjs';
import getDb from './db.mjs';
import { publish } from './bus.mjs';
import { normaliseListing, SCRAPE_LISTING_PARAMS } from './ingest/portals.mjs';
import { upsertListing } from './listings.mjs';
import { listingFlags } from './flags/renovations.mjs';
import { newsFlags } from './flags/neighbourhood.mjs';
import { documentFlags } from './flags/documents.mjs';
import { scoreListing } from './score/index.mjs';

const PENDING = {
  news: { id: 'pending-news', type: 'street_works', severity: 'info', label: 'Checking local news…', detail: null, est_cost_eur: null, year: null, source: null, status: 'pending' },
  docs: { id: 'pending-docs', type: 'renovation_upcoming', severity: 'info', label: 'Reading documents…', detail: null, est_cost_eur: null, year: null, source: null, status: 'pending' },
};

async function patch(id, fields) {
  const db = await getDb();
  await db.collection('listings').updateOne({ _id: id }, { $set: fields });
  publish('listing.updated', { id, patch: fields });
}

/**
 * Enrich a listing. `card` is a parsed search card (or a mock listing) with at least {id, portal, kind, url}.
 * @param {{json?: object}} [opts]  pass `json` to skip the extraction scrape (already extracted)
 * @returns {Promise<object>} the final listing
 */
export async function enrichFromCard(card, { json = null } = {}) {
  const db = await getDb();
  const t0 = Date.now();

  // 1. Card first, so the dashboard shows something immediately.
  const first = await upsertListing({ ...normaliseListing({ id: card.id, portal: card.portal, url: card.url, json: null, card }), status: 'enriching' });
  if (first.isNew) publish('listing.new', { listing: first.listing });
  else if (first.priceChanged) publish('listing.price_drop', { id: card.id, old_price: first.oldPrice, new_price: first.newPrice, at: new Date() });
  await patch(card.id, { status: 'enriching', enrich_started_at: new Date() });

  // 2. Full extraction (one structured scrape).
  let extracted = json;
  if (!extracted) {
    try {
      const r = await call('web.scrape', () => context.web.scrape(SCRAPE_LISTING_PARAMS(card.url)), { listingId: card.id, label: 'extract listing' });
      extracted = r.json?.data ?? null;
    } catch (e) {
      console.error(`extract ${card.id} failed:`, e.message);
    }
  }
  let listing = first.listing;
  if (extracted) {
    const doc = normaliseListing({ id: card.id, portal: card.portal, url: card.url, json: extracted, card });
    doc.extracted_at = new Date();
    listing = (await upsertListing(doc)).listing;
    const { _id, price_history, first_seen_at, flags, score, ...fields } = listing;
    publish('listing.updated', { id: card.id, patch: fields });
  }

  // 3. Fan-out. Rule flags are instant; the rest run in parallel and land as they finish.
  let flags = listingFlags(listing);
  const hasDocs = (listing.attachments ?? []).length > 0;
  await patch(card.id, { flags: [...flags, PENDING.news, ...(hasDocs ? [PENDING.docs] : [])] });

  const replacePending = async (pendingId, newFlags) => {
    flags = [...flags, ...newFlags];
    const current = (await db.collection('listings').findOne({ _id: card.id }, { projection: { flags: 1 } }))?.flags ?? [];
    const stillPending = current.filter((f) => f.status === 'pending' && f.id !== pendingId);
    await patch(card.id, { flags: [...flags, ...stillPending] });
  };

  const jobs = [
    scoreListing(listing).then((score) => score && patch(card.id, { score })),
    newsFlags(listing).catch((e) => (console.error('news failed:', e.message), [])).then((f) => replacePending('pending-news', f)),
    hasDocs ? documentFlags(listing).catch((e) => (console.error('docs failed:', e.message), [])).then((f) => replacePending('pending-docs', f)) : null,
  ].filter(Boolean);
  await Promise.allSettled(jobs);

  await patch(card.id, { status: 'ready', enrich_ms: Date.now() - t0 });
  return db.collection('listings').findOne({ _id: card.id });
}

/** No-credit enrichment for backfilled listings: rule flags + score. */
export async function enrichOffline(listing) {
  const flags = listingFlags(listing);
  const score = await scoreListing(listing);
  const db = await getDb();
  await db.collection('listings').updateOne({ _id: listing._id }, { $set: { flags, score, status: 'ready' } });
  return { flags, score };
}
