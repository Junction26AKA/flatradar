import { memo } from 'react';
import { CldImage } from './CldImage';
import { coverPhoto, thumb } from '../lib/cloudinary';
import { Link } from 'react-router-dom';
import { ago, agoShort, eur, factsLine, perM2, pricePerM2, priceLabel, shortAddress, shortDistrict } from '../lib/format';
import { useI18n } from '../lib/i18n';
import type { PriceChange } from '../lib/store';
import type { Listing } from '../lib/types';
import { cheaperElsewhere, portalName } from '../lib/portals';
import { DealBadge, PriceChangeBadge } from './DealBadge';
import { FlagChip, sortFlags } from './FlagChip';
import './ListingCard.css';

interface Props {
  listing: Listing;
  now: number;
  to: string;
  compact?: boolean;
  /** arrived over the stream this session: slide in + green glow */
  fresh?: boolean;
  selected?: boolean;
  matches?: boolean;
  priceChange?: PriceChange;
  onHover?: (id: string | null) => void;
}

const MAX_CHIPS = 3;

/** Figma "ListingCard" (Size=Full / Compact). */
export const ListingCard = memo(function ListingCard({ listing: l, now, to, compact, fresh, selected, matches, priceChange, onHover }: Props) {
  const { t, lang } = useI18n();
  const score = l.score;
  const flags = sortFlags(l.flags ?? []);
  const shown = flags.slice(0, MAX_CHIPS);
  const more = flags.length - shown.length;
  const seenS = (now - Date.parse(l.first_seen_at)) / 1000;
  const scoring = !score && l.status !== 'ready';
  const good = score != null && score.deal_pct <= -0.03;
  const cover = compact ? null : coverPhoto(l);
  const gone = !!l.removed_at;
  const portals = 1 + Object.keys(l.also_on ?? {}).filter((p) => p !== l.portal).length;
  const cheaper = portals > 1 ? cheaperElsewhere(l) : null;

  return (
    <Link
      to={to}
      className={['lcard', compact && 'lcard--compact', fresh && 'lcard--fresh', fresh && good && 'lcard--fresh-good', gone && 'lcard--gone', selected && 'lcard--selected', matches && 'lcard--match'].filter(Boolean).join(' ')}
      aria-current={selected ? 'true' : undefined}
      onMouseEnter={onHover && (() => onHover(l._id))}
      onMouseLeave={onHover && (() => onHover(null))}
      onFocus={onHover && (() => onHover(l._id))}
      onBlur={onHover && (() => onHover(null))}
    >
      {cover && l.media && (
        <CldImage
          className="lcard__photo"
          cldImg={thumb(l.media.cloud, cover, 640, 320)}
          lazy
          width={640}
          height={320}
          alt=""
        />
      )}
      <div className="lcard__top">
        <span className="t-eyebrow lcard__where">
          {[shortDistrict(l), compact ? null : l.postcode].filter(Boolean).join(' · ') || t(l.kind === 'rent' ? 'kind.forRent' : 'kind.forSale')}
        </span>
        <span className={`t-num-s lcard__seen${seenS < 120 ? ' is-new' : ''}`}>
          ● {compact ? agoShort(l.first_seen_at, now) : t('card.seen', { ago: ago(l.first_seen_at, now) })}
        </span>
      </div>

      <h3 className="t-h3 lcard__addr">{shortAddress(l)}</h3>
      {/* English mode spells out the Finnish room codes; the portal's original is on hover. */}
      <p className="t-body-s lcard__facts" title={lang === 'en' && l.rooms_description ? t('card.roomsOriginal', { s: l.rooms_description }) : undefined}>{factsLine(l) || ' '}</p>

      <div className="lcard__price">
        <span className="t-num-l">{priceLabel(l)}</span>
        {score ? (
          <DealBadge pct={score.deal_pct} />
        ) : scoring ? (
          <span className="lcard__scoring t-num-s">{t('card.scoring')}</span>
        ) : (
          <span className="t-num-s lcard__noscore" title={t('card.noScoreTitle')}>{t('card.noScore')}</span>
        )}
        {gone && (
          <span className="sold t-label" title={t('card.soldTitle', { ago: ago(l.removed_at!, now) })}>
            {t(l.kind === 'rent' ? 'card.let' : 'card.sold')}
          </span>
        )}
        {priceChange && <PriceChangeBadge oldPrice={priceChange.old_price} newPrice={priceChange.new_price} />}
      </div>

      {portals > 1 && (
        <p className={`lcard__portals t-num-s${cheaper ? ' is-cheaper' : ''}`} title={t('card.portalsTitle')}>
          ⇄ {t('card.portals', { n: portals })}
          {cheaper && <> · <strong>{t('card.cheaperOn', { eur: eur(-cheaper.diff!), site: portalName(cheaper.portal) })}</strong></>}
        </p>
      )}

      <p className="t-num-s lcard__perm2">
        {perM2(pricePerM2(l), l.kind)}
        {score && ` · ${t('card.fair')} ${perM2(score.fair_m2, l.kind).replace(/ €.*/, '')}`}
        {score && score.confidence === 'low' && <span className="lcard__conf"> · {t('card.lowConfidence')}</span>}
      </p>

      {!compact && flags.length > 0 && (
        <div className="lcard__flags">
          {shown.map((f) => <FlagChip key={f.id + f.status} flag={f} />)}
          {more > 0 && <span className="lcard__more t-num-s">+{more}</span>}
        </div>
      )}

      {matches && <span className="lcard__matchtag t-label">{t('card.matches')}</span>}
    </Link>
  );
});
