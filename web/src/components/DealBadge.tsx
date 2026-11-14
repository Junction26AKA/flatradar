import { dealLabel, dealTone } from '../lib/format';
import './badges.css';

/** Figma "DealBadge": negative deal_pct = good (green), positive = overpriced (red), within ±3% = fair (blue). */
export function DealBadge({ pct, label, size = 'm', glow = false }: { pct: number; label?: string; size?: 's' | 'm'; glow?: boolean }) {
  const tone = dealTone(pct);
  return (
    <span className={`deal deal--${tone} deal--${size}${glow ? ' deal--glow' : ''}`} title="Asking price vs our fair-value estimate">
      {label ?? dealLabel(pct)}
    </span>
  );
}

export function PriceChangeBadge({ oldPrice, newPrice }: { oldPrice: number; newPrice: number }) {
  const down = newPrice < oldPrice;
  const pct = Math.abs((newPrice - oldPrice) / oldPrice) * 100;
  return (
    <span className={`pchange pchange--${down ? 'down' : 'up'}`}>
      {down ? '↓ Price dropped' : '↑ Price raised'} {pct.toFixed(1)}%
    </span>
  );
}
