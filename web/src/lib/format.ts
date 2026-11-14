import type { Listing } from './types';

const eur0 = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const int = new Intl.NumberFormat('fi-FI', { maximumFractionDigits: 0 }); // "6 646": Finnish thin-space grouping

export const eur = (n: number | null | undefined) => (n == null ? '—' : eur0.format(n));
export const num = (n: number | null | undefined) => (n == null ? '—' : int.format(n));
export const m2 = (n: number | null | undefined) => (n == null ? '—' : `${n} m²`);

/** The asking price everything compares on: debt-free for a sale, monthly rent for a rental. */
export function askingPrice(l: Listing): number | null {
  return l.kind === 'rent' ? l.rent ?? null : l.debt_free_price ?? l.price ?? null;
}
export function pricePerM2(l: Listing): number | null {
  const p = askingPrice(l);
  return p != null && l.m2 ? p / l.m2 : null;
}
export const priceLabel = (l: Listing) => (l.kind === 'rent' ? `${eur(l.rent)}/mo` : eur(l.price ?? l.debt_free_price));

export type DealTone = 'good' | 'fair' | 'bad';
/** Within ±3% we call it fair; that is well inside the model's error. */
export function dealTone(pct: number): DealTone {
  if (pct <= -0.03) return 'good';
  if (pct >= 0.03) return 'bad';
  return 'fair';
}
export function dealLabel(pct: number): string {
  const p = Math.abs(pct * 100);
  const s = p >= 10 ? p.toFixed(0) : p.toFixed(1);
  if (dealTone(pct) === 'fair') return `±${s}% fair price`;
  return pct < 0 ? `−${s}% vs fair` : `+${s}% overpriced`;
}

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export const factsLine = (l: Listing) =>
  [l.rooms_description ?? (l.rooms ? `${l.rooms} rooms` : null), l.m2 ? m2(l.m2) : null, l.year, l.floor != null && l.floors_total ? `${l.floor}/${l.floors_total}` : null]
    .filter(Boolean)
    .join(' · ');
