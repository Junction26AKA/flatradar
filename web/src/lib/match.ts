import { askingPrice } from './format';
import type { Listing, SavedSearch } from './types';

/** Mirrors the alert matcher's intent: same kind, under max price, enough rooms, in the postcodes, deal good enough. */
export function matchesSearch(l: Listing, s: SavedSearch): boolean {
  if (l.kind !== s.kind) return false;
  const price = askingPrice(l);
  if (s.max_price != null && price != null && price > s.max_price) return false;
  if (s.min_rooms != null && l.rooms != null && l.rooms < s.min_rooms) return false;
  if (s.postcodes.length && !s.postcodes.some((p) => l.postcode?.startsWith(p))) return false;
  // Same rule as the server: min_deal 0 still means "scored, and at or below fair".
  if (s.min_deal != null && (l.score?.deal_pct == null || l.score.deal_pct > -Math.abs(s.min_deal))) return false;
  return true;
}

export const matchesAny = (l: Listing, searches: SavedSearch[] | undefined) => !!searches?.some((s) => matchesSearch(l, s));
