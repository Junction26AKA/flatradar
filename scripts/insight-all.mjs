// Run the Gemini analyst over listings that don't have an insight yet (no Context.dev credits; uses Gemini).
//   npm run insight-all                 up to 20 listings, ones with renovation text first
//   npm run insight-all -- --limit 100 --kind sale
//   npm run insight-all -- --force      redo listings that already have one
// Runs in its own process, so open dashboards see the result on their next load, not live.
import pLimit from 'p-limit';
import { getDb, client } from '../lib/db.mjs';
import { analyseAndPatch } from '../lib/enrich.mjs';
import { geminiEnabled } from '../lib/insight.mjs';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const max = Number(arg('limit', 20));
const kind = arg('kind', null);
const force = process.argv.includes('--force');

if (!geminiEnabled) { console.error('GEMINI_API_KEY is not set.'); process.exit(1); }

const db = await getDb();
const filter = {
  status: 'ready',
  extracted_at: { $exists: true },
  ...(kind ? { kind } : {}),
  ...(force ? {} : { 'insight.status': { $ne: 'ok' } }),
};
// Listings with renovation text first: that's where the analyst adds the most.
const docs = await db.collection('listings').aggregate([
  { $match: filter },
  { $addFields: { _hasText: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$renovations_upcoming', ''] } }, 0] }, 1, 0] } } },
  { $sort: { _hasText: -1, first_seen_at: -1 } },
  { $limit: max },
]).toArray();

console.log(`analysing ${docs.length} listings with Gemini…`);
const limit = pLimit(4);
let ok = 0, newFlags = 0, dropped = 0;
await Promise.all(docs.map((d) => limit(async () => {
  const r = await analyseAndPatch(d);
  if (!r) return;
  ok++;
  newFlags += r.flags.length;
  dropped += r.insight.grounding.dropped;
  console.log(`${d._id}  ${r.insight.ms} ms  +${r.flags.length} flags  "${r.insight.headline}"`);
})));
console.log(`done: ${ok}/${docs.length} analysed, ${newFlags} new hidden-cost flags, ${dropped} ungrounded quotes dropped`);
await client.close();
