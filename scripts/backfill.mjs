// Backfill: scrape N search pages per portal, then extract every listing through the Batch API.
// Gives Kevin training data and gives the scorer comparables.
//   npm run backfill -- --pages 12                 both portals, 12 search pages each (~30 listings/page)
//   npm run backfill -- --portal etuovi --pages 2  one portal
//   npm run backfill -- --resume <batch_id>        re-read results of an earlier batch (no new credits)
//   --dry-run   collect cards and print how many would be extracted, without submitting a batch
import { parseArgs } from 'node:util';
import { context, call } from '../lib/context.mjs';
import { getDb, client } from '../lib/db.mjs';
import { PORTALS, LISTING_SCHEMA, parseSearchCards, normaliseListing, portalForUrl } from '../lib/ingest/portals.mjs';
import { upsertListing } from '../lib/listings.mjs';

const { values: args } = parseArgs({
  options: {
    pages: { type: 'string', default: '12' },
    portal: { type: 'string' },
    resume: { type: 'string' },
    force: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
  },
});
const stamp = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.log(stamp(), ...a);
const db = await getDb();

async function collectCards() {
  // Oikotie is skipped by default: the live diff de-duplicates it against Etuovi/Vuokraovi, the backfill doesn't.
const portals = args.portal ? [args.portal] : Object.keys(PORTALS).filter((p) => !PORTALS[p].format);
  const pages = Number(args.pages);
  const jobs = portals.flatMap((p) => Array.from({ length: pages }, (_, i) => ({ portal: p, page: i + 1 })));
  const results = await Promise.allSettled(jobs.map(({ portal, page }) =>
    call('web.scrape', () => context.web.scrape({ url: PORTALS[portal].search(page), formats: { markdown: true }, maxAgeMs: 30 * 60 * 1000, tags: ['flatradar', 'backfill'] }), { label: `${portal} search p${page}` })
      .then((r) => parseSearchCards(r.markdown?.data ?? '', portal))));
  const cards = new Map();
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') r.value.forEach((c) => cards.set(c.id, c));
    else log(`search ${jobs[i].portal} p${jobs[i].page} failed:`, r.reason?.message);
  });
  return [...cards.values()];
}

async function submit(cards) {
  const batch = await call('batch.submit', () => context.batch.submit({
    input: {
      mode: 'scrape',
      data: {
        urls: cards.map((c) => ({ url: c.url, itemId: c.id, meta: { card: c } })),
        formats: { json: true },
        jsonParams: { schema: LISTING_SCHEMA, instructions: 'Finnish property listing. Copy renovation texts verbatim. Use null when a fact is not on the page.' },
        maxAgeMs: 24 * 3600 * 1000,
      },
    },
    tags: ['flatradar', 'backfill'],
  }));
  await db.collection('runs').insertOne({ type: 'backfill', batch_id: batch.id, n: cards.length, at: new Date() });
  return batch.id;
}

async function waitFor(batchId) {
  for (;;) {
    const b = await context.batch.retrieve(batchId);
    log(`batch ${batchId}: ${b.status} ${JSON.stringify(b.progress)} credits=${JSON.stringify(b.credits)}`);
    if (['completed', 'cancelled', 'failed'].includes(b.status)) return b;
    await new Promise((r) => setTimeout(r, 15_000));
  }
}

async function ingestResults(batchId) {
  let cursor, ok = 0, bad = 0, isNew = 0, credits = 0;
  do {
    const page = await context.batch.getResults(batchId, { limit: 100, ...(cursor ? { cursor } : {}) });
    for (const rec of page.data ?? []) {
      if (rec.status !== 'ok' || !rec.result?.json?.data) { bad++; continue; }
      credits += rec.credits_used ?? 0;
      const id = rec.itemId;
      const portal = id?.split(':')[0] ?? portalForUrl(rec.url);
      const doc = normaliseListing({ id, portal, url: PORTALS[portal].listingUrl(id.split(':')[1]), json: rec.result.json.data, card: rec.meta?.card ?? null });
      doc.extracted_at = new Date();
      const r = await upsertListing(doc);
      ok++; if (r.isNew) isNew++;
    }
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);
  return { ok, bad, isNew, credits };
}

let batchId = args.resume;
if (!batchId) {
  const cards = await collectCards();
  const known = args.force ? new Set() : new Set((await db.collection('listings').find({ _id: { $in: cards.map((c) => c.id) }, extracted_at: { $exists: true } }, { projection: { _id: 1 } }).toArray()).map((d) => d._id));
  const todo = cards.filter((c) => !known.has(c.id));
  const byKind = todo.reduce((a, c) => ((a[c.kind] = (a[c.kind] ?? 0) + 1), a), {});
  log(`cards: ${cards.length} found, ${known.size} already extracted, ${todo.length} to extract`, byKind);
  if (args['dry-run'] || todo.length === 0) { await client.close(); process.exit(0); }
  batchId = await submit(todo);
  log(`submitted batch ${batchId}`);
}
const b = await waitFor(batchId);
if (b.status !== 'completed') log('batch did not complete:', b.failure, b.page_errors);
const s = await ingestResults(batchId);
log(`ingested: ${s.ok} ok (${s.isNew} new), ${s.bad} failed, ${s.credits} credits on pages; page_errors=${JSON.stringify(b.page_errors)}`);
const counts = await db.collection('listings').aggregate([{ $group: { _id: '$kind', n: { $sum: 1 }, with_loc: { $sum: { $cond: [{ $ne: ['$loc', null] }, 1, 0] } } } }]).toArray();
log('listings in db:', JSON.stringify(counts));
await client.close();
