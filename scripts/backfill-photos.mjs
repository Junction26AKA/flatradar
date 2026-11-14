// Photo backfill: find the gallery photos of listings extracted before `photos` was in the schema, then
// (optionally) send them through Cloudinary (upload + AI Vision flags + share cards).
//
// Context.dev cost: 1 credit per listing (images-only scrape, no JSON extraction). Re-extracting instead
// would cost 5. Image enrichment (dimensions, classification) and visual dedupe add nothing.
//
//   npm run backfill-photos                          dry run: how many listings, how many credits
//   npm run backfill-photos -- --sample 3            scrape 3 listings directly (3 credits) and print what it finds
//   npm run backfill-photos -- --yes                 submit the batch for every listing without photos
//   npm run backfill-photos -- --kind sale --limit 200 --yes
//   npm run backfill-photos -- --yes --process       ...then run the Cloudinary photo pass on them
//   npm run backfill-photos -- --process-only        Cloudinary pass on listings that already have photos
//   npm run backfill-photos -- --resume <batch_id>   re-read an earlier batch (no new Context.dev credits)
//
// Options: --portal etuovi|vuokraovi, --kind sale|rent, --limit N (best deals first), --force (include listings
// that already have photos), --vision N (AI Vision on the N best deals only; default 20, the rest are uploaded
// and shown without analysis, to stay inside the free AI Vision quota), --concurrency N (Cloudinary, default 3).
//
// Writes only `photos` (and `photos_at`) on listings, then `media` + photo flags if --process. The live
// dashboard picks the changes up on its next load (this process isn't connected to the server's SSE).
import { parseArgs } from 'node:util';
import pLimit from 'p-limit';
import { context, call } from '../lib/context.mjs';
import { getDb, client } from '../lib/db.mjs';
import { PORTALS } from '../lib/ingest/portals.mjs';
import { mediaEnabled, processListingPhotos, pickPhotos } from '../lib/media/index.mjs';

const { values: args } = parseArgs({
  options: {
    portal: { type: 'string' },
    kind: { type: 'string' },
    limit: { type: 'string' },
    force: { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
    sample: { type: 'string' },
    resume: { type: 'string' },
    process: { type: 'boolean', default: false },
    'process-only': { type: 'boolean', default: false },
    vision: { type: 'string', default: '20' },
    concurrency: { type: 'string', default: '3' },
  },
});
const stamp = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.log(stamp(), ...a);
const db = await getDb();

// ---------- which listings ----------
async function selectListings({ needPhotos }) {
  const portals = args.portal ? [args.portal] : Object.keys(PORTALS); // etuovi + vuokraovi (not mock, not oikotie)
  const q = {
    portal: { $in: portals },
    extracted_at: { $exists: true },
    ...(args.kind ? { kind: args.kind } : {}),
    ...(needPhotos
      ? (args.force ? {} : { $or: [{ photos: { $exists: false } }, { photos: null }] }) // [] = tried, found none
      : { 'photos.0': { $exists: true }, ...(args.force ? {} : { 'media.status': { $ne: 'ok' } }) }),
  };
  const docs = await db.collection('listings')
    .find(q, { projection: { _id: 1, url: 1, kind: 1, portal: 1, 'score.deal_pct': 1 } })
    .toArray();
  // Best deals first, unscored last: with --limit or --vision, the most demo-worthy listings go first.
  docs.sort((a, b) => (a.score?.deal_pct ?? Infinity) - (b.score?.deal_pct ?? Infinity));
  return args.limit ? docs.slice(0, Number(args.limit)) : docs;
}

// ---------- images → photo URLs ----------
const IMAGE_PARAMS = { enrich: ['dimensions', 'classification'], dedupe: 'visual' };
async function savePhotos(id, photos) {
  await db.collection('listings').updateOne({ _id: id }, { $set: { photos, photos_at: new Date() } });
}

// ---------- modes ----------
async function sample(n) {
  const docs = (await selectListings({ needPhotos: true })).slice(0, n);
  log(`sampling ${docs.length} listings (${docs.length} credits)`);
  for (const d of docs) {
    try {
      const r = await call('web.scrape', () => context.web.scrape({ url: d.url, formats: { images: true }, imageParams: IMAGE_PARAMS, maxAgeMs: 24 * 3600 * 1000, tags: ['flatradar', 'photos-sample'] }), { listingId: d._id, label: 'photos sample' });
      const images = r.images?.data ?? [];
      const photos = pickPhotos(images);
      log(`${d._id}: ${images.length} images on the page → ${photos.length} photos kept`);
      for (const im of images.slice(0, 25)) console.log(`   ${photos.includes(im.url) ? 'KEEP' : 'skip'} ${im.classification ?? '-'} ${im.width ?? '?'}x${im.height ?? '?'} ${im.url.slice(0, 140)}`);
      if (photos.length) await savePhotos(d._id, photos);
    } catch (e) {
      log(`${d._id}: failed: ${e.message}`);
    }
  }
}

async function submit(docs) {
  const batch = await call('batch.submit', () => context.batch.submit({
    input: {
      mode: 'scrape',
      data: {
        urls: docs.map((d) => ({ url: d.url, itemId: d._id })),
        formats: { images: true },
        imageParams: IMAGE_PARAMS,
        maxAgeMs: 24 * 3600 * 1000,
      },
    },
    tags: ['flatradar', 'backfill-photos'],
  }));
  await db.collection('runs').insertOne({ type: 'backfill-photos', batch_id: batch.id, n: docs.length, at: new Date() });
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
  let cursor, ok = 0, none = 0, bad = 0, credits = 0, total = 0;
  const ids = [];
  do {
    const page = await context.batch.getResults(batchId, { limit: 100, ...(cursor ? { cursor } : {}) });
    for (const rec of page.data ?? []) {
      credits += rec.credits_used ?? 0;
      const images = rec.result?.images?.data;
      if (rec.status !== 'ok' || !Array.isArray(images)) { bad++; continue; }
      const photos = pickPhotos(images);
      await savePhotos(rec.itemId, photos); // [] marks "tried, nothing found" so a re-run skips it
      if (photos.length) { ok++; total += photos.length; ids.push(rec.itemId); } else none++;
    }
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);
  log(`photos: ${ok} listings got ${total} photos (avg ${ok ? (total / ok).toFixed(1) : 0}), ${none} had none, ${bad} failed; ${credits} credits`);
  return ids;
}

async function cloudinaryPass(ids) {
  if (!mediaEnabled) { log('CLOUDINARY_URL not set: skipping the Cloudinary pass'); return; }
  const docs = await db.collection('listings').find({ _id: { $in: ids } }, { projection: { _id: 1, 'score.deal_pct': 1 } }).toArray();
  docs.sort((a, b) => (a.score?.deal_pct ?? Infinity) - (b.score?.deal_pct ?? Infinity));
  const visionN = Number(args.vision);
  const run = pLimit(Number(args.concurrency) || 3);
  let done = 0, analysed = 0, failed = 0;
  log(`cloudinary: ${docs.length} listings, AI Vision on the ${Math.min(visionN, docs.length)} best deals`);
  await Promise.all(docs.map((d, i) => run(async () => {
    const m = await processListingPhotos(d._id, { vision: i < visionN });
    if (!m) failed++; else if (m.analysed) analysed++;
    if (++done % 25 === 0 || done === docs.length) log(`cloudinary: ${done}/${docs.length} (${analysed} analysed, ${failed} failed)`);
  })));
}

// ---------- main ----------
try {
  if (args.sample) {
    await sample(Number(args.sample));
  } else if (args['process-only']) {
    const docs = await selectListings({ needPhotos: false });
    log(`${docs.length} listings with photos to send through Cloudinary`);
    if (!args.yes) log('dry run: add --yes to run it');
    else await cloudinaryPass(docs.map((d) => d._id));
  } else {
    let ids;
    if (args.resume) {
      ids = await ingestResults(args.resume);
    } else {
      const docs = await selectListings({ needPhotos: true });
      const byKind = docs.reduce((a, d) => ((a[d.kind] = (a[d.kind] ?? 0) + 1), a), {});
      log(`${docs.length} listings need photos`, byKind, `→ about ${docs.length} Context.dev credits (1 per page)`);
      if (!args.yes || !docs.length) {
        if (!args.yes) log('dry run: add --yes to submit the batch (try --sample 3 first)');
        await client.close();
        process.exit(0);
      }
      const batchId = await submit(docs);
      log(`submitted batch ${batchId} (resume with --resume ${batchId})`);
      const b = await waitFor(batchId);
      if (b.status !== 'completed') log('batch did not complete:', b.failure, b.page_errors);
      ids = await ingestResults(batchId);
    }
    if (args.process) await cloudinaryPass(ids);
  }
} finally {
  await client.close();
}
