import { askingPrice } from './format';
import type { Listing, SavedSearch } from './types';

/** Mirrors the alert matcher's intent: same kind, under max price, enough rooms, in the postcodes, deal good enough. */
export function matchesSearch(l: Listing, s: SavedSearch): boolean {
  if (l.kind !== s.kind) return false;
  const price = askingPrice(l);
  if (s.max_price != null && price != null && price > s.max_price) return false;
  if (s.min_rooms != null && l.rooms != null && l.rooms < s.min_rooms) return false;
  if (s.postcodes.length && (!l.postcode || !s.postcodes.includes(l.postcode))) return false;
  if (s.min_deal != null && s.min_deal < 0) {
    if (!l.score) return false;
    if (l.score.deal_pct > s.min_deal) return false;
  }
  return true;
}

export const matchesAny = (l: Listing, searches: SavedSearch[] | undefined) => !!searches?.some((s) => matchesSearch(l, s));
