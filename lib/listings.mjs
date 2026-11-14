// Writing listings: one upsert that keeps first_seen_at and appends to price_history only on change.
import getDb from './db.mjs';

const priceKey = (l) => (l.kind === 'rent' ? 'rent' : 'debt_free_price');

/**
 * Upsert a normalised listing (docs/contracts.md §1).
 * @returns {{isNew: boolean, priceChanged: boolean, oldPrice: number|null, newPrice: number|null, listing: object}}
 */
export async function upsertListing(doc, { seenAt = new Date() } = {}) {
  const db = await getDb();
  const col = db.collection('listings');
  const prev = await col.findOne({ _id: doc._id }, { projection: { price: 1, debt_free_price: 1, rent: 1, kind: 1, first_seen_at: 1 } });
  const key = priceKey(doc);
  const newPrice = doc[key] ?? null;
  const oldPrice = prev ? prev[key] ?? null : null;
  const priceChanged = !!prev && newPrice != null && oldPrice != null && newPrice !== oldPrice;

  // Don't overwrite good values with nulls from a thinner source (e.g. a search card).
  const set = Object.fromEntries(Object.entries(doc).filter(([k, v]) => k !== '_id' && v !== null && v !== undefined));
  const update = {
    $set: { ...set, last_seen_at: seenAt },
    $setOnInsert: Object.fromEntries(Object.entries({ first_seen_at: seenAt, flags: [], score: null, status: 'new' }).filter(([k]) => !(k in set))),
  };
  if (!prev || priceChanged) {
    update.$push = { price_history: { at: seenAt, price: doc.price ?? null, debt_free_price: doc.debt_free_price ?? null, rent: doc.rent ?? null } };
  }
  const listing = await col.findOneAndUpdate({ _id: doc._id }, update, { upsert: true, returnDocument: 'after' });
  return { isNew: !prev, priceChanged, oldPrice, newPrice, listing };
}
