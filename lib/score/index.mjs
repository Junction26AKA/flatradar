// Scoring: call Kevin's model service (SCORER_URL, POST /score) and fall back to a comparables-only
// score computed here, so the demo never shows an unscored card. Shape: docs/contracts.md §2.
import getDb from '../db.mjs';

const SCORER_URL = process.env.SCORER_URL?.trim(); // e.g. http://localhost:8000 (trimmed: dashboard pastes add whitespace)

export const pricePerM2 = (l) => {
  const p = l.kind === 'rent' ? l.rent : l.debt_free_price ?? l.price;
  return p && l.m2 ? p / l.m2 : null;
};

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};

/** Comparables: same kind, similar size/rooms, within radius, excluding itself. */
export async function comparables(l, { radius = 1000, max = 12 } = {}) {
  if (!l.loc || !l.m2) return null;
  const db = await getDb();
  const query = {
    _id: { $ne: l._id },
    kind: l.kind,
    comparable: true,
    portal: { $ne: 'mock' }, // demo flats must never become anyone's comparable
    m2: { $gte: l.m2 * 0.75, $lte: l.m2 * 1.25 },
    ...(l.kind === 'sale' ? { debt_free_price: { $gt: 0 } } : { rent: { $gt: 0 } }),
    ...(l.building_type ? { building_type: l.building_type } : {}),
    ...(l.year ? { year: { $gte: l.year - 15, $lte: l.year + 15 } } : {}),
  };
  const run = (r) => db.collection('listings').aggregate([
    { $geoNear: { near: l.loc, distanceField: 'distance_m', maxDistance: r, query, spherical: true } },
    { $limit: max },
    { $project: { url: 1, address: 1, m2: 1, rooms: 1, year: 1, debt_free_price: 1, price: 1, rent: 1, kind: 1, distance_m: 1 } },
  ]).toArray();
  let used = radius, docs = await run(radius);
  if (docs.length < 4) { used = radius * 2.5; docs = await run(used); }
  const items = docs.map((d) => ({ id: d._id, url: d.url, address: d.address, m2: d.m2, rooms: d.rooms, year: d.year, price_m2: Math.round(pricePerM2(d) * 100) / 100, distance_m: Math.round(d.distance_m) }));
  return { fair_m2: items.length ? median(items.map((i) => i.price_m2)) : null, n: items.length, radius_m: used, items };
}

function fallbackScore(l, comps) {
  const ask = pricePerM2(l);
  const fair = comps?.fair_m2;
  if (!ask || !fair || comps.n < 3) return null;
  return {
    fair_m2: Math.round(fair * 100) / 100,
    fair_price: Math.round(fair * l.m2),
    deal_pct: Math.round(((ask - fair) / fair) * 1000) / 1000,
    confidence: comps.n >= 8 && Math.abs((ask - fair) / fair) <= 0.35 ? 'medium' : 'low',
    model: null,
    comps,
    baseline: null,
    yield_pct: null,
    scored_at: new Date(),
  };
}

/** Returns a Score or null. Never throws. */
export async function scoreListing(l) {
  if (l.comparable === false) return null; // deposits (asumisoikeus), €0 prices, outliers: no fair-value claim
  if (SCORER_URL) {
    try {
      const res = await fetch(`${SCORER_URL.replace(/\/$/, '')}/score`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(l),
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) return { ...(await res.json()), scored_at: new Date() };
      console.error(`scorer ${res.status}: ${(await res.text()).slice(0, 200)}`);
    } catch (e) {
      console.error('scorer unreachable, using comparables fallback:', e.message);
    }
  }
  try {
    return fallbackScore(l, await comparables(l));
  } catch (e) {
    console.error('fallback score failed:', e.message);
    return null;
  }
}
