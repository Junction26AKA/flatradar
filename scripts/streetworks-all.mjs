// Add street-works flags (City of Helsinki permit register) to every stored listing. No Context.dev credits.
//   npm run streetworks-all
// Replaces each listing's street_works flags in one atomic update and leaves every other flag as it is.
import getDb, { client } from '../lib/db.mjs';
import { loadStreetWorks, streetWorksFlags, streetWorksStatus } from '../lib/flags/streetworks.mjs';

const db = await getDb();
await loadStreetWorks();
if (!streetWorksStatus().count) throw new Error('street-works register did not load');

const cur = db.collection('listings').find({ status: 'ready', loc: { $exists: true } }, { projection: { loc: 1 } });
let n = 0, flagged = 0;
for await (const l of cur) {
  const flags = await streetWorksFlags(l);
  await db.collection('listings').updateOne({ _id: l._id, status: 'ready' }, [{ $set: { flags: { $concatArrays: [
    { $filter: { input: { $ifNull: ['$flags', []] }, cond: { $ne: ['$$this.type', 'street_works'] } } },
    { $literal: flags },
  ] } } }]);
  n++;
  if (flags.length) flagged++;
}
console.log(`street works: ${n} listings checked, ${flagged} flagged`);
await client.close();
