import { askingPrice } from './format';
import type { Listing, Portal } from './types';

/** Display names; mock listings have no real ad. */
export const PORTAL_NAMES: Record<Portal, string | null> = { etuovi: 'Etuovi', vuokraovi: 'Vuokraovi', oikotie: 'Oikotie', mock: null };
export const portalName = (p: Portal | string) => PORTAL_NAMES[p as Portal] ?? p[0].toUpperCase() + p.slice(1);

export interface PortalPrice {
  portal: Portal;
  url: string;
  price: number | null;
  here: boolean;
  seen_at?: string;
  /** price − this ad's price (negative = cheaper there) */
  diff: number | null;
}

/**
 * The same flat on every portal we've seen it on (`also_on`, set by the cross-listing diff), this ad first.
 * Prices are the ones on each portal's search card, which is the debt-free price for sales on Etuovi and Oikotie.
 */
export function portalPrices(l: Listing): PortalPrice[] {
  const own = askingPrice(l);
  const others = Object.entries(l.also_on ?? {})
    .filter(([p, x]) => x && p !== l.portal)
    .map(([p, x]) => ({ portal: p as Portal, url: x!.url, price: x!.price, here: false, seen_at: x!.seen_at, diff: x!.price != null && own != null ? x!.price - own : null }));
  return [{ portal: l.portal, url: l.url, price: own, here: true, diff: 0 }, ...others];
}

/**
 * The cheapest other portal, when it's meaningfully cheaper than this ad: at least €500 and 0.5% for a sale,
 * €10 for a rent. Small gaps are usually rounding or a stale card.
 */
export function cheaperElsewhere(l: Listing): PortalPrice | null {
  const own = askingPrice(l);
  if (own == null) return null;
  const min = l.kind === 'rent' ? 10 : Math.max(500, own * 0.005);
  const best = portalPrices(l).filter((r) => !r.here && r.diff != null && -r.diff >= min).sort((a, b) => a.diff! - b.diff!)[0];
  return best ?? null;
}
