// Cross-portal de-duplication test. Runs the real diff (processSearchPage) for Etuovi and Oikotie at the same
// time against a throwaway database, with Context.dev stubbed, and checks each flat is stored once.
//   npm run test:dedupe        (needs MONGODB_URI; spends no credits; drops its own test database)
process.env.MONGODB_DB = 'flatradar_test_dedupe';
process.env.GEMINI_API_KEY = '';
process.env.SENDGRID_API_KEY = '';
process.env.SCORER_URL = '';
process.env.CONTEXT_DEV_API_KEY ||= 'test';

const { context } = await import('../lib/context.mjs');
const { default: getDb, client } = await import('../lib/db.mjs');
const { processSearchPage, sameFlat, addressParts } = await import('../lib/monitors.mjs');
const { PORTALS } = await import('../lib/ingest/portals.mjs');

let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };

// --- Pure matching rules -------------------------------------------------------------------------------
const f = (address, m2, rooms = 2, kind = 'sale') => ({ address, m2, rooms, kind });
check(sameFlat(f('Pengerkatu 7 B, Helsinki', 48), f('Pengerkatu 7 B', 48)), 'same address and m² match');
check(sameFlat(f('Topeliuksenkatu 15, Helsinki', 23, 1), f('Topeliuksenkatu 15 A', 23, 1)), 'staircase missing on one side still matches');
check(sameFlat(f('Pengerkatu 7 B', 48), f('pengerkatu 7 b a 12', 48.5)), 'case, flat number and m² ±1 tolerated');
check(!sameFlat(f('Pengerkatu 7 B', 48), f('Pengerkatu 7 C', 48)), 'different staircase is a different flat');
check(!sameFlat(f('Pengerkatu 7 B', 48, 2), f('Pengerkatu 7 B', 48, 3)), 'different room count is a different flat');
check(!sameFlat(f('Pengerkatu 7', 48), f('Pengerkatu 17', 48)), 'house 7 is not house 17');
check(!sameFlat(f('Pengerkatu 7', 48), f('Pengerkatu 7', 52)), 'm² more than 1 apart is a different flat');
check(!sameFlat(f('Pengerkatu 7', 48, 2, 'sale'), f('Pengerkatu 7', 48, 2, 'rent')), 'sale and rent never merge');
check(addressParts('Eskolantie 12-14, Helsinki')?.num === '12', 'house number ranges use the first number');

// --- Live diff, both portals at once ---------------------------------------------------------------------
// Same flats on both portals, plus near-misses that must stay separate.
const etuoviCard = (id, addr, district, rooms, price, m2) =>
  String.raw`[${addr}, ${district}, Helsinki\\ \\ Kerrostalo, 1932\\ \\ ${rooms} h\\ \\ Kerros 3/8\\ \\ ${price} €\\ \\ ${m2} m²\\ \\ Uusi 24 h](https://www.etuovi.com/kohde/${id}?haku=X)`;
const oikotieCard = (id, addr, district, rooms, price, m2) =>
  String.raw`[${addr}, ${district}, Helsinki\\ \\ ${price} € ${m2} m²\\ \\ Huoneita ${rooms}\\ \\ Kerros 3/8\\ \\ Kerrostalo, 1932\\ \\ Uusi](https://asunnot.oikotie.fi/myytavat-asunnot/helsinki/${id})`;
const pages = {
  etuovi: [
    etuoviCard('900001', 'Pengerkatu 7 B', 'Kallio', 2, '289 000', '48'), // = oikotie 800001
    etuoviCard('900002', 'Topeliuksenkatu 15', 'Taka-Töölö', 1, '178 000', '23'), // = oikotie 800002 (no staircase here)
    etuoviCard('900003', 'Pengerkatu 7 C', 'Kallio', 2, '295 000', '48'), // other staircase: separate flat
    etuoviCard('900005', 'Ohjaajantie 6', 'Pohjois-Haaga', 3, '285 000', '66'), // only on Etuovi
    etuoviCard('900004', 'Fleminginkatu 8 B', 'Kallio', 3, '719 000', '82'), // = oikotie 800004 (82,5 m² there); last, so it queues behind the
    // 4-at-a-time enrichment limit and stays unstored while the Oikotie diff runs
  ].join('\n\n'),
  oikotie: [
    oikotieCard('800001', 'Pengerkatu 7 B', 'Kallio', 2, '289 000', '48'),
    oikotieCard('800002', 'Topeliuksenkatu 15 A', 'Taka-Töölö', 1, '178 000', '23'),
    oikotieCard('800004', 'Fleminginkatu 8 B', 'Kallio', 3, '719 000', '82,5'),
    oikotieCard('800006', 'Pengerkatu 17 B', 'Kallio', 2, '310 000', '48'), // house 17, not 7: separate
    oikotieCard('800007', 'Ohjaajantie 6', 'Pohjois-Haaga', 4, '285 000', '66'), // 4 rooms vs 3: separate
  ].join('\n\n'),
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Stub Context.dev: search pages return the fixtures; listing extraction is slow and finds nothing, so new
// cards stay unstored for a while (this is the window where a duplicate used to slip through).
context.web.scrape = async ({ url }) => {
  if (url.includes('etuovi.com/myytavat')) { await sleep(50); return { markdown: { data: pages.etuovi } }; }
  if (url.includes('oikotie.fi/myytavat')) { await sleep(80); return { markdown: { data: pages.oikotie } }; }
  await sleep(600);
  return { json: { data: null } };
};

const db = await getDb();
if (db.databaseName !== 'flatradar_test_dedupe') throw new Error(`refusing to drop ${db.databaseName}`);
await db.dropDatabase();
const run = () => Promise.all(['etuovi', 'oikotie'].map((portal) => processSearchPage({ portal, url: PORTALS[portal].search(1) }, { reason: 'test' })));

await run();
const ids = (await db.collection('listings').find({}, { projection: { _id: 1 } }).toArray()).map((d) => d._id).sort();
console.log('stored after concurrent diffs:', ids.join(', '));
check(ids.length === 7, `7 distinct flats stored from 10 cards (got ${ids.length})`);
const one = (a, b) => ids.includes(a) !== ids.includes(b);
check(one('etuovi:900001', 'oikotie:800001'), 'Pengerkatu 7 B stored once');
check(one('etuovi:900002', 'oikotie:800002'), 'Topeliuksenkatu 15 stored once');
check(one('etuovi:900004', 'oikotie:800004'), 'Fleminginkatu 8 B stored once');
check(ids.includes('etuovi:900003'), 'Pengerkatu 7 C kept (other staircase)');
check(ids.includes('oikotie:800006'), 'Pengerkatu 17 B kept (other house)');
check(ids.includes('etuovi:900005') && ids.includes('oikotie:800007'), 'Ohjaajantie 6 3-room and 4-room kept apart');

// The next diff sees the stored flats and records where else each one is listed.
await run();
const ids2 = (await db.collection('listings').find({}, { projection: { _id: 1 } }).toArray()).map((d) => d._id);
check(ids2.length === 7, `still 7 flats after a second diff (got ${ids2.length})`);
const cross = await db.collection('listings').find({ also_on: { $exists: true } }, { projection: { also_on: 1 } }).toArray();
check(cross.length === 3, `3 flats record their other portal in also_on (got ${cross.length})`);
for (const c of cross) console.log('   ', c._id, '→ also on', Object.values(c.also_on).map((x) => x.id).join(', '));

await db.dropDatabase();
await client.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
