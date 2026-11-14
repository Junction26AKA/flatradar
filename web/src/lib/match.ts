import { askingPrice } from './format';
import type { Listing, SavedSearch, SearchArea } from './types';

/** Mirrors the alert matcher's intent: same kind, under max price, enough rooms, in the postcodes, deal good enough. */
export function matchesSearch(l: Listing, s: SavedSearch): boolean {
  if (l.kind !== s.kind) return false;
  const price = askingPrice(l);
  if (s.max_price != null && price != null && price > s.max_price) return false;
  if (s.min_rooms != null && l.rooms != null && l.rooms < s.min_rooms) return false;
  if (!inPlaces(l, s)) return false;
  // Same rule as the server: min_deal 0 still means "scored, and at or below fair".
  if (s.min_deal != null && (l.score?.deal_pct == null || l.score.deal_pct > -Math.abs(s.min_deal))) return false;
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

/** Same rule as lib/alerts: with postcodes or areas set, the listing must be in one postcode OR inside one circle. */
export function inPlaces(l: Listing, s: SavedSearch): boolean {
  const areas = s.areas ?? [];
  if (!s.postcodes.length && !areas.length) return true;
  return s.postcodes.some((p) => l.postcode?.startsWith(p)) || areas.some((a) => inArea(l, a));
}
