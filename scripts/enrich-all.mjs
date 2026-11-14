// Rule flags + score for every listing that has been extracted. No Context.dev credits.
//   npm run enrich-all
import { getDb, client } from '../lib/db.mjs';
import { enrichOffline } from '../lib/enrich.mjs';
import { classify } from '../lib/ingest/portals.mjs';

const db = await getDb();
const docs = await db.collection('listings').find({ extracted_at: { $exists: true } }).toArray();
// Classify first (tenure, comparable) for every listing, so comparables use the right pool.
for (const d of docs) Object.assign(d, classify(d, d.tenure === 'ownership' ? null : d.tenure));
await db.collection('listings').bulkWrite(docs.map((d) => ({ updateOne: { filter: { _id: d._id }, update: { $set: { tenure: d.tenure, comparable: d.comparable } } } })));
console.log('comparable:', docs.filter((d) => d.comparable).length, 'of', docs.length);
let scored = 0, flagged = 0;
for (const d of docs) {
  const { flags, score } = await enrichOffline(d);
  if (score) scored++;
  if (flags.length) flagged++;
}
console.log(`${docs.length} listings: ${scored} scored, ${flagged} with flags`);
const sample = await db.collection('listings').find({ 'score.deal_pct': { $ne: null } }).sort({ 'score.deal_pct': 1 }).limit(6).project({ address: 1, kind: 1, m2: 1, debt_free_price: 1, rent: 1, 'score.deal_pct': 1, 'score.fair_m2': 1, 'score.comps.n': 1 }).toArray();
console.log('cheapest vs comparables:', JSON.stringify(sample));
await client.close();
