// Creates collections and indexes. Safe to re-run.  npm run setup-db
import { getDb, client } from '../lib/db.mjs';

const db = await getDb();
const existing = new Set((await db.listCollections().toArray()).map((c) => c.name));
for (const name of ['listings', 'events', 'calls', 'users', 'baselines', 'seen_cards', 'runs']) {
  if (!existing.has(name)) await db.createCollection(name);
}

await db.collection('listings').createIndexes([
  { key: { loc: '2dsphere' }, name: 'loc_2dsphere' },
  { key: { kind: 1, first_seen_at: -1 }, name: 'kind_first_seen' },
  { key: { postcode: 1, kind: 1 }, name: 'postcode_kind' },
  { key: { status: 1 }, name: 'status' },
]);
await db.collection('events').createIndexes([
  { key: { at: -1 }, name: 'at' },
  { key: { listing_id: 1, at: -1 }, name: 'listing_at' },
]);
await db.collection('calls').createIndexes([
  { key: { listing_id: 1, started_at: 1 }, name: 'listing_started' },
  { key: { started_at: -1 }, name: 'started' },
]);
await db.collection('users').createIndex({ email: 1 }, { unique: true, name: 'email_unique' });

console.log('collections:', (await db.listCollections().toArray()).map((c) => c.name).sort().join(', '));
await client.close();
