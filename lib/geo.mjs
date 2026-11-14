// Geography helpers for saved searches: drawn areas (polygons), geocoding and public-transport commute times.
//
// Commute times come from the HSL journey planner (Digitransit) when DIGITRANSIT_KEY is set, and are cached on the
// listing as `commutes.<key>`. Without a key (or when the planner fails) we use a straight-line estimate, which
// web/src/lib/match.ts computes the same way, so the feed filter and the email alerts always agree.
import pLimit from 'p-limit';
import getDb from './db.mjs';
import { track } from './context.mjs';
import { publish } from './bus.mjs';

const KEY = process.env.DIGITRANSIT_KEY?.trim() || null;
export const routingEnabled = !!KEY;
const ROUTING_URL = 'https://api.digitransit.fi/routing/v2/hsl/gtfs/v1';
const GEOCODE_URL = 'https://api.digitransit.fi/geocoding/v1/search';
// Greater Helsinki (HSL area), for geocoding.
const BOX = { minLat: 60.0, maxLat: 60.45, minLng: 24.4, maxLng: 25.35 };
const routeLimit = pLimit(4);

/** Great-circle distance in metres. */
export function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6_371_000, rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Ray casting. `points` is [[lat, lng], …] (not closed). Fine at city scale, where lat/lng is close to flat. */
export function inPolygon(lat, lng, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [yi, xi] = points[i], [yj, xj] = points[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Cache key for a commute destination: ~10 m grid, safe as a Mongo field name. Same as web/src/lib/match.ts. */
export const commuteKey = (lat, lng) => `${Math.round(lat * 1e4)}_${Math.round(lng * 1e4)}`;

/**
 * Door-to-door public transport estimate from straight-line distance: 8 min of walking and waiting plus 2.6 min
 * per km (about 23 km/h). Close to HSL journey-planner times for inner Helsinki. Same as web/src/lib/match.ts.
 */
export const estimateMin = (meters) => Math.round(8 + 2.6 * (meters / 1000));

/** Minutes from the listing to the search's commute target: the cached planner time, else the estimate. null = no location. */
export function commuteMinutes(l, target) {
  const c = l.loc?.coordinates;
  if (!c) return null;
  const hit = l.commutes?.[commuteKey(target.lat, target.lng)];
  if (hit?.min != null) return hit.min;
  return estimateMin(distanceM(c[1], c[0], target.lat, target.lng));
}

/** Next weekday at 08:00 Helsinki time, as an ISO string with the right UTC offset (+02:00 or +03:00). */
function nextWeekdayMorning(now = new Date()) {
  const d = new Date(now);
  do d.setUTCDate(d.getUTCDate() + 1); while ([0, 6].includes(d.getUTCDay()));
  const ymd = d.toISOString().slice(0, 10);
  const noon = new Date(`${ymd}T12:00:00Z`);
  const off = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Helsinki', timeZoneName: 'longOffset' })
    .formatToParts(noon).find((p) => p.type === 'timeZoneName')?.value.replace('GMT', '') || '+02:00';
  return `${ymd}T08:00:00${off}`;
}

const PLAN_QUERY = `query($o: PlanLabeledLocationInput!, $d: PlanLabeledLocationInput!, $t: OffsetDateTime!) {
  planConnection(origin: $o, destination: $d, dateTime: { earliestDeparture: $t }, first: 3) {
    edges { node { duration } }
  }
}`;

/** HSL journey planner: fastest of the first 3 itineraries leaving after 08:00 on the next weekday, in minutes. */
export async function routeMinutes(from, to, { listingId = null } = {}) {
  if (!KEY) return null;
  return routeLimit(() => track('digitransit.plan', async () => {
    const loc = (p) => ({ location: { coordinate: { latitude: p.lat, longitude: p.lng } } });
    const res = await fetch(ROUTING_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'digitransit-subscription-key': KEY },
      body: JSON.stringify({ query: PLAN_QUERY, variables: { o: loc(from), d: loc(to), t: nextWeekdayMorning() } }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.errors?.length) throw Object.assign(new Error(body.errors?.[0]?.message ?? `Digitransit HTTP ${res.status}`), { status: res.status });
    const secs = (body.data?.planConnection?.edges ?? []).map((e) => e.node?.duration).filter((s) => s > 0);
    return secs.length ? Math.round(Math.min(...secs) / 60) : null;
  }, { listingId, label: 'HSL commute time' }));
}

/** A stored entry counts as fresh: a planner time, or "no route" checked within the last day. */
const fresh = (v) => v && (v.min != null || (v.at && Date.now() - new Date(v.at).getTime() < 24 * 3600 * 1000));

/**
 * Make sure the listing has planner times for these targets. Writes `commutes.<key>` and publishes the patch.
 * "No route found" is stored as `{ min: null, src: 'none' }` so it isn't re-planned for a day; request errors aren't
 * stored. No-op without a Digitransit key (everything falls back to the estimate). Returns the listing's commutes.
 */
export async function ensureCommutes(l, targets) {
  const c = l.loc?.coordinates;
  if (!KEY || !c || !targets.length) return l.commutes ?? {};
  const missing = [...new Map(targets.map((t) => [commuteKey(t.lat, t.lng), t])).entries()].filter(([k]) => !fresh(l.commutes?.[k]));
  if (!missing.length) return l.commutes ?? {};
  const set = {};
  await Promise.all(missing.map(async ([k, t]) => {
    try {
      const min = await routeMinutes({ lat: c[1], lng: c[0] }, t, { listingId: l._id });
      set[`commutes.${k}`] = min != null ? { min, src: 'hsl', at: new Date() } : { min: null, src: 'none', at: new Date() };
    } catch (e) { console.warn('commute', l._id, e.message); }
  }));
  if (!Object.keys(set).length) return l.commutes ?? {};
  const db = await getDb();
  const r = await db.collection('listings').findOneAndUpdate({ _id: l._id }, { $set: set }, { returnDocument: 'after', projection: { commutes: 1 } });
  const commutes = r?.commutes ?? {};
  l.commutes = commutes;
  publish('listing.updated', { id: l._id, patch: { commutes } });
  return commutes;
}

// One backfill per destination at a time, and not again within 10 minutes (users re-save searches often).
const backfilling = new Map(); // `${kind}:${key}` → started at (ms)
const BACKFILL_EVERY_MS = 10 * 60 * 1000;

/** Background fill after a search with a commute target is saved: the newest live listings of that kind. */
export async function backfillCommutes(targets, kind, { max = 300 } = {}) {
  if (!KEY || !targets.length) return 0;
  const now = Date.now();
  const todo = [...new Map(targets.map((t) => [commuteKey(t.lat, t.lng), t])).entries()]
    .filter(([k]) => !(now - (backfilling.get(`${kind}:${k}`) ?? 0) < BACKFILL_EVERY_MS));
  if (!todo.length) return 0;
  for (const [k] of todo) backfilling.set(`${kind}:${k}`, now);
  const db = await getDb();
  const q = { kind, 'loc.coordinates': { $exists: true }, removed_at: null, $or: todo.map(([k]) => ({ [`commutes.${k}`]: { $exists: false } })) };
  const rows = await db.collection('listings').find(q, { projection: { _id: 1, loc: 1, commutes: 1 } }).sort({ first_seen_at: -1 }).limit(max).toArray();
  for (const l of rows) await ensureCommutes(l, todo.map(([, t]) => t));
  return rows.length;
}

const geoCache = new Map(); // normalised query → { at, items }
const GEO_TTL_MS = 24 * 3600 * 1000;
let nominatimNext = 0; // OSM usage policy: at most 1 request per second

/**
 * Address or place → up to 5 { label, lat, lng } in the Helsinki region. Digitransit when there's a key (falling
 * back if it fails), else OpenStreetMap Nominatim (generic client name, no user details sent, ≤ 1 request/s).
 * Results are cached for a day.
 */
export async function geocode(q) {
  const text = String(q ?? '').trim().slice(0, 120);
  if (text.length < 2) return [];
  const ck = text.toLowerCase();
  const hit = geoCache.get(ck);
  if (hit && Date.now() - hit.at < GEO_TTL_MS) return hit.items;
  let items = null;
  if (KEY) items = await geocodeDigitransit(text).catch((e) => { console.warn('digitransit geocode:', e.message); return null; });
  if (!items?.length) items = await geocodeNominatim(text);
  if (geoCache.size > 1000) geoCache.clear();
  geoCache.set(ck, { at: Date.now(), items });
  return items;
}

async function geocodeDigitransit(text) {
  const qs = new URLSearchParams({
    text, size: '5', lang: 'fi',
    'boundary.rect.min_lat': BOX.minLat, 'boundary.rect.max_lat': BOX.maxLat, 'boundary.rect.min_lon': BOX.minLng, 'boundary.rect.max_lon': BOX.maxLng,
  });
  const res = await fetch(`${GEOCODE_URL}?${qs}`, { headers: { 'digitransit-subscription-key': KEY }, signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  return (body.features ?? []).map((f) => ({ label: f.properties?.label ?? text, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] }));
}

async function geocodeNominatim(text) {
  // Queue behind earlier requests so we never send more than one per second.
  const wait = Math.max(0, nominatimNext - Date.now());
  nominatimNext = Math.max(nominatimNext, Date.now()) + 1100;
  if (wait) await new Promise((r) => setTimeout(r, wait));
  const qs = new URLSearchParams({ q: text, format: 'jsonv2', limit: '5', countrycodes: 'fi', bounded: '1', viewbox: `${BOX.minLng},${BOX.maxLat},${BOX.maxLng},${BOX.minLat}` });
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${qs}`, { headers: { 'User-Agent': 'FlatRadar/0.1 (hackathon demo)' }, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return [];
    return (await res.json()).map((r) => ({ label: r.display_name.split(',').slice(0, 3).join(','), lat: Number(r.lat), lng: Number(r.lon) }));
  } catch (e) {
    console.warn('nominatim geocode:', e.message);
    return [];
  }
}
