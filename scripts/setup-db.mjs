// Creates collections and indexes. Safe to re-run.  npm run setup-db
import { getDb, client } from '../lib/db.mjs';

const db = await getDb();
const existing = new Set((await db.listCollections().toArray()).map((c) => c.name));
for (const name of ['listings', 'events', 'calls', 'users', 'baselines', 'seen_cards', 'runs', 'sessions']) {
  if (!existing.has(name)) await db.createCollection(name);
}

await db.collection('listings').createIndexes([
  { key: { loc: '2dsphere' }, name: 'loc_2dsphere' },
  { key: { kind: 1, first_seen_at: -1 }, name: 'kind_first_seen' },
  // GET /api/listings pages by kind, newest first, _id as tie-breaker: this lets Mongo walk the index instead of sorting.
  { key: { kind: 1, first_seen_at: -1, _id: -1 }, name: 'kind_first_seen_id' },
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
await db.collection('users').createIndex({ favourites: 1 }, { name: 'favourites' }); // price-drop alerts for saved flats
// One favourite_drop email per saver, flat and new price (lib/alerts claims the row before sending).
await db.collection('alerts').createIndex({ user_id: 1, listing_id: 1, type: 1, new_price: 1 }, { unique: true, partialFilterExpression: { type: 'favourite_drop' }, name: 'favourite_drop_unique' });
// Mongo deletes sessions once expires_at passes (lib/auth.mjs also checks it, so this is only cleanup).
await db.collection('sessions').createIndex({ expires_at: 1 }, { expireAfterSeconds: 0, name: 'expires_ttl' });

console.log('collections:', (await db.listCollections().toArray()).map((c) => c.name).sort().join(', '));
await client.close();
