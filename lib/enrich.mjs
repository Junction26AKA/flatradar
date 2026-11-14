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

  const jobs = [
    scoreListing(listing).then((score) => score && patch(card.id, { score })),
    newsFlags(listing).catch((e) => (console.error('news failed:', e.message), [])).then((f) => replacePending('pending-news', f)),
    hasDocs ? documentFlags(listing).catch((e) => (console.error('docs failed:', e.message), [])).then((f) => replacePending('pending-docs', f)) : null,
  ].filter(Boolean);
  await Promise.allSettled(jobs);

  // Final write carries the settled flag list too, in case two earlier patches landed out of order.
  await patch(card.id, { status: 'ready', flags: [...flags, ...pending.values()], enrich_ms: Date.now() - t0 });
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

/**
 * After a restart (Render free instances restart and sleep), finish listings left half-enriched.
 * Re-uses the stored extraction when there is one, so this usually costs only the news/PDF calls.
 */
export async function resumeStuck({ olderThanMs = 2 * 60 * 1000, max = 20 } = {}) {
  const db = await getDb();
  const stuck = await db.collection('listings').find({ status: { $in: ['new', 'enriching'] }, last_seen_at: { $lt: new Date(Date.now() - olderThanMs) } }).limit(max).toArray();
  for (const l of stuck) {
    const card = { id: l._id, portal: l.portal, kind: l.kind, url: l.url, address: l.address, district: l.district, m2: l.m2, rooms: l.rooms, year: l.year, building_type: l.building_type, price: l.price, rent: l.rent };
    await enrichFromCard(card, { json: l.extracted_at ? toExtractionShape(l) : null }).catch((e) => console.error(`resume ${l._id} failed:`, e.message));
  }
  return stuck.length;
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
