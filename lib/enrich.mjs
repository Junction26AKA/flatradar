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
import { analyseListing, geminiEnabled } from './insight.mjs';
import { alertForListing } from './alerts/index.mjs';
import { mediaEnabled, processListingPhotos } from './media/index.mjs';

// Listings this process is enriching right now, so the resume sweep never starts a second run of one.
const inFlight = new Set();

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
export async function enrichFromCard(card, opts = {}) {
  inFlight.add(card.id);
  try {
    return await enrich(card, opts);
  } finally {
    inFlight.delete(card.id);
  }
}

async function enrich(card, { json = null } = {}) {
  const db = await getDb();
  const t0 = Date.now();

  // 1. Card first, so the dashboard shows something immediately. Only for new listings: a card's price can
  //    be the debt-free price, so it must not overwrite an extracted listing (price drops are published by the diff).
  const existing = await db.collection('listings').findOne({ _id: card.id });
  let first;
  if (!existing) {
    first = await upsertListing({ ...normaliseListing({ id: card.id, portal: card.portal, url: card.url, json: null, card }), status: 'enriching' });
    publish('listing.new', { listing: first.listing });
  } else {
    first = { listing: existing };
  }
  // Clearing `insight` makes any Gemini run still in flight for an older version of this listing a no-op (see
  // analyseAndPatch), and stops an old verdict sitting next to flags that are being rebuilt.
  await patch(card.id, { status: 'enriching', enrich_started_at: new Date(), insight: null });

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
  // Placeholders live in memory, not re-read from Mongo, so news and PDFs finishing together can't race.
  const pending = new Map([['pending-news', PENDING.news], ...(hasDocs ? [['pending-docs', PENDING.docs]] : [])]);
  await patch(card.id, { flags: [...flags, ...pending.values()] });

  const replacePending = async (pendingId, newFlags) => {
    // A PDF flag confirms a listing-text flag of the same kind: keep one, sourced to the document.
    const key = (f) => `${f.type}:${f.label.replace(/\s*(being planned|planned)?\s*\(?\d{4}\)?$/, '')}`;
    const fromDocs = new Set(newFlags.filter((f) => f.source?.kind === 'pdf').map(key));
    flags = [...flags.filter((f) => !fromDocs.has(key(f))), ...newFlags];
    pending.delete(pendingId);
    await patch(card.id, { flags: [...flags, ...pending.values()] });
  };

  let docs = [];
  const jobs = [
    scoreListing(listing).then((score) => score && patch(card.id, { score })),
    newsFlags(listing).catch((e) => (console.error('news failed:', e.message), [])).then((f) => replacePending('pending-news', f)),
    hasDocs
      ? documentFlags(listing)
        .catch((e) => (console.error('docs failed:', e.message), { flags: [], docs: [] }))
        .then((r) => { docs = r.docs; return replacePending('pending-docs', r.flags); })
      : null,
  ].filter(Boolean);
  await Promise.allSettled(jobs);

  // The PDF text from this enrichment (empty if none parsed), so a later Gemini run reads current documents.
  // Written directly, not published: the dashboard doesn't need it.
  await db.collection('listings').updateOne({ _id: card.id }, { $set: { doc_extracts: docs } });
  // Final write carries the settled flag list too, in case two earlier patches landed out of order.
  await patch(card.id, { status: 'ready', flags: [...flags, ...pending.values()], enrich_ms: Date.now() - t0 });
  const ready = await db.collection('listings').findOne({ _id: card.id });

  // Gemini runs after the card is ready and isn't awaited, so alerts and the latency number aren't held up by it.
  // Its verdict and any extra (quote-checked) hidden costs stream onto the card a few seconds later.
  if (geminiEnabled) analyseAndPatch(card.id);
  // Photos go through Cloudinary the same way: after `ready`, not awaited (upload + AI Vision take seconds).
  if (mediaEnabled && ready?.photos?.length) processListingPhotos(card.id);
  return ready;
}

/**
 * Run the Gemini analyst on a listing and write `insight` (+ its flags) onto it. Never throws.
 * - It re-reads the listing (and its stored PDF text) when it starts, and only runs on a `ready` listing, so a
 *   caller holding an old snapshot (e.g. insight-all's batch) can't analyse stale data.
 * - Each run stores a token in `insight.run`. The result is written only if that token is still there and the
 *   listing is still ready, so a newer run or a re-enrichment (which clears `insight`) always wins.
 * - Gemini's flags are swapped in one atomic update, leaving every other flag as it is now.
 * @param {string|{_id: string}} idOrListing
 */
export async function analyseAndPatch(idOrListing) {
  const id = typeof idOrListing === 'string' ? idOrListing : idOrListing._id;
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const finish = async (insight, newFlags) => {
    const db = await getDb();
    const set = { insight: { $literal: { ...insight, run } } };
    if (newFlags) {
      set.flags = { $concatArrays: [
        { $filter: { input: { $ifNull: ['$flags', []] }, cond: { $ne: ['$$this.origin', 'gemini'] } } },
        { $literal: newFlags },
      ] };
    }
    const doc = await db.collection('listings').findOneAndUpdate({ _id: id, status: 'ready', 'insight.run': run }, [{ $set: set }], { returnDocument: 'after', projection: { insight: 1, flags: 1 } });
    if (doc) publish('listing.updated', { id, patch: newFlags ? { insight: doc.insight, flags: doc.flags } : { insight: doc.insight } });
    return !!doc;
  };
  try {
    const db = await getDb();
    const pending = { status: 'pending', run, at: new Date() };
    const listing = await db.collection('listings').findOneAndUpdate({ _id: id, status: 'ready' }, { $set: { insight: pending } }, { returnDocument: 'after' });
    if (!listing) return null; // being re-enriched (it will start a fresh run when ready) or gone
    publish('listing.updated', { id, patch: { insight: pending } });
    const r = await analyseListing(listing, listing.doc_extracts ?? []);
    if (!r) return null;
    return (await finish(r.insight, r.flags)) ? r : null;
  } catch (e) {
    console.error(`gemini ${id} failed:`, e.message);
    await finish({ status: 'error', error: String(e.message).slice(0, 200), at: new Date() }, null).catch(() => {});
    return null;
  }
}

/**
 * Retry Gemini runs that never finished: cut off by a restart or deploy (they run after `ready`, so resumeStuck
 * doesn't see them). Runs one at a time; call it without awaiting.
 * @param {{before?: Date, max?: number}} [opts]  retry runs started before this time (default: 2 min ago)
 */
export async function resumeInsights({ before = new Date(Date.now() - 2 * 60 * 1000), max = 20 } = {}) {
  if (!geminiEnabled) return 0;
  const db = await getDb();
  const ids = await db.collection('listings').find({ status: 'ready', 'insight.status': 'pending', 'insight.at': { $lt: before } }, { projection: { _id: 1 } }).limit(max).toArray();
  for (const { _id } of ids) await analyseAndPatch(_id);
  return ids.length;
}

/** No-credit enrichment for backfilled listings: rule flags + score. */
export async function enrichOffline(listing) {
  // Keep the Gemini analyst's flags: they're quote-checked and cost money to regenerate.
  const flags = [...listingFlags(listing), ...(listing.flags ?? []).filter((f) => f.origin === 'gemini')];
  const score = await scoreListing(listing);
  const db = await getDb();
  await db.collection('listings').updateOne({ _id: listing._id }, { $set: { flags, score, status: 'ready' } });
  return { flags, score };
}

/**
 * Finish listings left half-enriched: an instance restarted, slept or was replaced by a deploy mid-enrichment.
 * Re-uses the stored extraction when there is one, so this usually costs only the news/PDF calls.
 * - `before`: resume enrichments that started before this time. At startup the server passes its own start
 *   time (anything older was cut off); the periodic sweep uses 5 min ago, far longer than an enrichment takes.
 * - Listings this process is still enriching are skipped.
 * - The cut-off run never reached its alerts, so a resumed listing first seen in the last 24 h alerts now
 *   (alerts are deduped per user and listing).
 */
export async function resumeStuck({ before = new Date(Date.now() - 5 * 60 * 1000), max = 20 } = {}) {
  const db = await getDb();
  const stuck = await db.collection('listings').find({
    status: { $in: ['new', 'enriching'] },
    $or: [{ enrich_started_at: { $lt: before } }, { enrich_started_at: { $exists: false }, last_seen_at: { $lt: before } }],
  }).limit(max).toArray();
  let resumed = 0;
  for (const l of stuck) {
    if (inFlight.has(l._id)) continue;
    const card = { id: l._id, portal: l.portal, kind: l.kind, url: l.url, address: l.address, district: l.district, m2: l.m2, rooms: l.rooms, year: l.year, building_type: l.building_type, price: l.price, rent: l.rent };
    try {
      const listing = await enrichFromCard(card, { json: l.extracted_at ? toExtractionShape(l) : null });
      resumed++;
      if (listing && new Date(listing.first_seen_at) > new Date(Date.now() - 24 * 3600 * 1000)) {
        await alertForListing(listing).catch((e) => console.error(`resume alert ${l._id} failed:`, e.message));
      }
    } catch (e) {
      console.error(`resume ${l._id} failed:`, e.message);
    }
  }
  return resumed;
}

// Inverse of normaliseListing, so a stored listing can be re-enriched without re-scraping it.
function toExtractionShape(l) {
  return {
    address: l.address, postcode: l.postcode, district: l.district, building_type: l.building_type, rooms: l.rooms,
    rooms_description: l.rooms_description, living_area_m2: l.m2, build_year: l.year, floor: l.floor, floors_total: l.floors_total,
    elevator: l.elevator, sauna: l.sauna, balcony: l.balcony, condition: l.condition, sales_price_eur: l.price,
    debt_free_price_eur: l.debt_free_price, debt_share_eur: l.debt_share, maintenance_fee_eur_month: l.fee_month,
    financing_fee_eur_month: l.financing_fee_month, rent_eur_month: l.rent, available_from: l.available_from,
    plot_ownership: l.plot, tenure: l.tenure, energy_class: l.energy_class, renovations_done: l.renovations_done,
    renovations_planned: l.renovations_upcoming, housing_company: l.housing_company,
    latitude: l.loc?.coordinates?.[1], longitude: l.loc?.coordinates?.[0], attachments: l.attachments, agent_company: l.agent_company,
  };
}
