import { dealLabel, dealTone, percent } from '../lib/format';
import { useI18n } from '../lib/i18n';
import './badges.css';

/** Figma "DealBadge": negative deal_pct = good (green), positive = overpriced (red), within ±3% = fair (blue). */
export function DealBadge({ pct, label, size = 'm', glow = false }: { pct: number; label?: string; size?: 's' | 'm'; glow?: boolean }) {
  const { t } = useI18n(); // also re-renders the badge when the language changes
  const tone = dealTone(pct);
  return (
    <span className={`deal deal--${tone} deal--${size}${glow ? ' deal--glow' : ''}`} title={t('deal.title')}>
      {label ?? dealLabel(pct)}
    </span>
  );
}

export function PriceChangeBadge({ oldPrice, newPrice }: { oldPrice: number; newPrice: number }) {
  const { t } = useI18n();
  const down = newPrice < oldPrice;
  const pct = Math.abs((newPrice - oldPrice) / oldPrice) * 100;
  return (
    <span className={`pchange pchange--${down ? 'down' : 'up'}`}>
      {t(down ? 'price.dropped' : 'price.raised')} {percent(pct, 1)}
    </span>
  );
}
