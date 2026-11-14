import { askingPrice } from './format';
import type { CommuteTarget, CommuteTime, Listing, SavedSearch, SearchArea } from './types';

/** Mirrors the alert matcher's intent: same kind, under max price, enough rooms, in the postcodes, deal good enough. */
export function matchesSearch(l: Listing, s: SavedSearch): boolean {
  if (l.kind !== s.kind) return false;
  const price = askingPrice(l);
  if (s.max_price != null && price != null && price > s.max_price) return false;
  if (s.min_rooms != null && l.rooms != null && l.rooms < s.min_rooms) return false;
  if (!inPlaces(l, s)) return false;
  // Same rule as the server: min_deal 0 still means "scored, and at or below fair".
  if (s.min_deal != null && (l.score?.deal_pct == null || l.score.deal_pct > -Math.abs(s.min_deal))) return false;
  if (s.commute) {
    const c = commuteTime(l, s.commute);
    if (!c || c.min > s.commute.max_min) return false;
  }
  if (s.exclude_flags?.length && (l.flags ?? []).some((f) => f.status === 'ok' && f.severity !== 'info' && s.exclude_flags!.includes(f.type))) return false;
  return true;
}

export const matchesAny = (l: Listing, searches: SavedSearch[] | undefined) => !!searches?.some((s) => matchesSearch(l, s));

/** Great-circle distance in metres. */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000, rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export const inArea = (l: Listing, a: SearchArea) => {
  const c = l.loc?.coordinates;
  return !!c && distanceM(a.lat, a.lng, c[1], c[0]) <= a.radius_m;
};

/** Ray casting over [lat, lng] points. Same as lib/geo.mjs. */
export function inPolygon(lat: number, lng: number, points: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [yi, xi] = points[i], [yj, xj] = points[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Same rule as lib/alerts: with postcodes, circles or polygons set, the listing must be inside one of them. */
export function inPlaces(l: Listing, s: SavedSearch): boolean {
  const areas = s.areas ?? [];
  const polygons = s.polygons ?? [];
  if (!s.postcodes.length && !areas.length && !polygons.length) return true;
  if (s.postcodes.some((p) => l.postcode?.startsWith(p)) || areas.some((a) => inArea(l, a))) return true;
  const c = l.loc?.coordinates;
  return !!c && polygons.some((pg) => inPolygon(c[1], c[0], pg.points));
}

// ---------- commute (same formulas as lib/geo.mjs) ----------
export const commuteKey = (lat: number, lng: number) => `${Math.round(lat * 1e4)}_${Math.round(lng * 1e4)}`;
/** 8 min walking and waiting + 2.6 min per straight-line km. */
export const estimateMin = (meters: number) => Math.round(8 + 2.6 * (meters / 1000));

/** HSL planner time if the server has fetched one, else the straight-line estimate. null = listing has no location. */
export function commuteTime(l: Listing, t: Pick<CommuteTarget, 'lat' | 'lng'>): CommuteTime | null {
  const hit = l.commutes?.[commuteKey(t.lat, t.lng)];
  if (hit?.min != null) return hit;
  const c = l.loc?.coordinates;
  return c ? { min: estimateMin(distanceM(c[1], c[0], t.lat, t.lng)), src: 'estimate' } : null;
}
