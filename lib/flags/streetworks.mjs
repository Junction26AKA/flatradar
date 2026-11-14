// Neighbourhood red flags from the City of Helsinki's live permit register (open data, no API key):
// excavation notices (kaivuilmoitukset) and temporary traffic arrangements, each with an address, purpose,
// dates and a polygon. We keep the whole register of current works in memory (refreshed every 30 min) and
// flag the significant ones close to a flat, so the per-listing lookup is instant.
//
// Context.dev news search used to fill this slot, but its index has no Finnish local news (Finnish queries only
// return startup press), so it never produced a flag and was the slowest call in the fan-out.
import { track } from '../context.mjs';

const WFS = 'https://kartta.hel.fi/ws/geoserver/avoindata/wfs';
const LAYERS = [
  { kind: 'dig', layer: 'avoindata:Kaivuilmoitus_alue', start: 'tyo_alkaa', end: 'tyo_paattyy' },
  { kind: 'traffic', layer: 'avoindata:Tilapainen_liikennejarjestely_alue', start: 'liikennejarjestely_alkaa', end: 'liikennejarjestely_paattyy' },
];
const REFRESH_MS = 30 * 60 * 1000;
const RADIUS_M = 150; // flag works this close to the flat
const WARN_M = 100; // a significant work this close is a warning, not just info
const SOON_DAYS = 60; // include works starting within this many days

// Small, short jobs (cables, soil surveys, lighting, signs) aren't red flags. Big ones (tram lines, street
// rebuilds, district heating, water mains) are, as is anything that runs for six months or more.
const MINOR = /tietoliikenn|tiedonsiirto|telekaapel|kuitu|kaapel|maaperä|pohjatutk|kaira|valaistu|sähköverkko|liikennemerk|opastu|mittau/i;
const MAJOR = /raitiotie|ratikka|kruunusillat|katusaneeraus|peruskorjaus|perusparann|rakentaminen|rakennetaan|kunnallistekn|kaukolämpö|vesihuolto|viemäri|vesijohto|silta|sillan|tunneli|metro|purku/i;
const LONG_DAYS = 180;
// The permit purpose is free Finnish text. The English detail gets a category from it instead
// (first match wins); the Finnish original stays in detail_fi and source.quote.
const KINDS_EN = [
  [/raitiotie|ratikka|kruunusillat/i, 'Tram line construction'],
  [/metro/i, 'Metro works'],
  [/silta|sillan/i, 'Bridge works'],
  [/tunneli/i, 'Tunnel works'],
  [/kaukolämpö/i, 'District heating pipe works'],
  [/vesihuolto|viemäri|vesijohto/i, 'Water and sewer pipe works'],
  [/katusaneeraus|peruskorjaus|perusparann|kunnallistekn/i, 'Street reconstruction'],
  [/purku/i, 'Demolition'],
  [/rakentaminen|rakennetaan/i, 'Construction works'],
];
const purposeEn = (w) => KINDS_EN.find(([re]) => re.test(w.purpose))?.[1]
  ?? (w.kind === 'traffic' ? 'Temporary traffic arrangements' : 'Long-running street works');

const day = (d = new Date()) => d.toISOString().slice(0, 10);
const daysBetween = (a, b) => (new Date(b) - new Date(a)) / 864e5;
// First line of the purpose, without the permit boilerplate ("Työstä vastaava varaa tilaa kaivutyölle; …").
const purposeOf = (p) => {
  const s = String(p.tyon_tarkoitus ?? '').split('\n')[0]
    .replace(/^(työstä vastaava|päätöksen saaja)\s+varaa tilaa\s*(kaivuu?työlle)?\s*[;:,.]?\s*/i, '').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

let works = []; // [{ id, kind, start, end, purpose, address, major, long, rings: [[[x, y]…]…] }]
let loadedAt = 0;
let failedAt = 0; // last failed load: don't make enrichments wait on a source that is down
let loading = null;

function featureUrl(layer, id) {
  const q = new URLSearchParams({ service: 'WFS', version: '2.0.0', request: 'GetFeature', outputFormat: 'application/json', srsName: 'EPSG:4326', typeNames: layer, cql_filter: `hakemustunnus='${id}'` });
  return `${WFS}?${q}`;
}

async function fetchLayer({ kind, layer, start, end }) {
  const q = new URLSearchParams({ service: 'WFS', version: '2.0.0', request: 'GetFeature', outputFormat: 'application/json', srsName: 'EPSG:4326', typeNames: layer, cql_filter: `${end}>='${day()}'` });
  const res = await fetch(`${WFS}?${q}`, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${layer}: HTTP ${res.status}`);
  const soon = day(new Date(Date.now() + SOON_DAYS * 864e5));
  const out = [];
  for (const f of (await res.json()).features ?? []) {
    const p = f.properties ?? {};
    const s = p[start], e = p[end];
    if (!s || !e || s > soon || !f.geometry) continue;
    const purpose = purposeOf(p);
    const major = MAJOR.test(purpose);
    const long = daysBetween(s, e) >= LONG_DAYS;
    if (!major && (MINOR.test(purpose) || !long)) continue;
    const g = f.geometry;
    const rings = g.type === 'MultiPolygon' ? g.coordinates.flat(1) : g.type === 'Polygon' ? g.coordinates : null;
    if (!rings) continue;
    const xs = rings.flat().map((c) => c[0]), ys = rings.flat().map((c) => c[1]);
    const bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    out.push({ id: p.hakemustunnus, kind, layer, start: s, end: e, purpose, address: String(p.osoite ?? '').trim(), major, long, rings, bbox });
  }
  return out;
}

/** Load (or refresh) the register. Concurrent callers share one load; a failed refresh keeps the old data. */
export function loadStreetWorks() {
  if (loading) return loading;
  loading = track('open_data.streetworks', async () => {
    const parts = await Promise.all(LAYERS.map(fetchLayer));
    works = parts.flat();
    loadedAt = Date.now();
    console.log(`${new Date().toISOString()} street works: ${works.length} significant current works loaded`);
    return { count: works.length };
  }, { label: 'Helsinki street-works register' })
    .catch((e) => { failedAt = Date.now(); console.error('street works load failed:', e.message); })
    .finally(() => { loading = null; });
  return loading;
}

export const streetWorksStatus = () => ({ count: works.length, loaded_at: loadedAt ? new Date(loadedAt) : null });

// Metres from point p to polygon rings (0 if inside), using a local flat projection (fine at this scale).
function distanceM([lng, lat], rings) {
  const kx = Math.cos((lat * Math.PI) / 180) * 111320, ky = 110540;
  let best = Infinity, inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const ax = (ring[j][0] - lng) * kx, ay = (ring[j][1] - lat) * ky;
      const bx = (ring[i][0] - lng) * kx, by = (ring[i][1] - lat) * ky;
      if ((ay > 0) !== (by > 0) && 0 < ax + ((0 - ay) * (bx - ax)) / (by - ay)) inside = !inside; // ray cast along +x
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
  }
  return inside ? 0 : best;
}

let n = 0;
const fid = () => `w_${Date.now().toString(36)}${(++n).toString(36)}`;

/** Significant street works and traffic diversions within 150 m of the flat. Returns Flag[] (may be empty). */
export async function streetWorksFlags(l) {
  const p = l.loc?.coordinates;
  if (!p) return [];
  if (!loadedAt || Date.now() - loadedAt > REFRESH_MS) {
    const pending = loadStreetWorks();
    // First load: wait for it (bounded), unless it failed recently. Later refreshes run in the background.
    if (!loadedAt && Date.now() - failedAt > 5 * 60 * 1000) await Promise.race([pending, new Promise((r) => setTimeout(r, 30_000).unref())]);
  }
  const today = day();
  // Cheap bounding-box test first (RADIUS_M in degrees, with margin), then the exact distance.
  const dLat = (RADIUS_M * 1.2) / 110540, dLng = (RADIUS_M * 1.2) / (Math.cos((p[1] * Math.PI) / 180) * 111320);
  const near = works
    .filter((w) => w.end >= today && p[0] >= w.bbox[0] - dLng && p[0] <= w.bbox[2] + dLng && p[1] >= w.bbox[1] - dLat && p[1] <= w.bbox[3] + dLat)
    .map((w) => ({ w, m: Math.round(distanceM(p, w.rings)) }))
    .filter((x) => x.m <= RADIUS_M)
    // Major and long works first, then the closest.
    .sort((a, b) => (b.w.major + b.w.long) - (a.w.major + a.w.long) || a.m - b.m);
  const seen = new Set();
  const flags = [];
  for (const { w, m } of near) {
    if (seen.has(w.id)) continue;
    seen.add(w.id);
    const until = w.end.slice(0, 4);
    const upcoming = w.start > today;
    const what = w.kind === 'traffic' ? 'Traffic diversion' : 'Street works';
    flags.push({
      id: fid(),
      type: 'street_works',
      severity: m <= WARN_M && (w.major || w.long) ? 'warn' : 'info',
      label: `${what} ${m} m away (until ${until})`,
      detail: `${purposeEn(w)} · ${w.address.slice(0, 120)} · ${w.start} → ${w.end}${upcoming ? ' (starts soon)' : ''}`,
      detail_fi: `${w.purpose.slice(0, 200)} · ${w.address.slice(0, 120)} · ${w.start} → ${w.end}${upcoming ? ' (alkaa pian)' : ''}`,
      est_cost_eur: null,
      year: Number(until),
      distance_m: m,
      source: { kind: 'open_data', url: featureUrl(w.layer, w.id), quote: w.purpose.slice(0, 240), page: null, outlet: 'City of Helsinki permit register', permit: w.id },
      status: 'ok',
    });
    if (flags.length >= 2) break;
  }
  return flags;
}
