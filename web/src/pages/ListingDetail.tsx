import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AnalystPanel } from '../components/AnalystPanel';
import { CommutePanel, PortalCompare } from '../components/DetailExtras';
import { FavButton } from '../components/FavButton';
import { ListingPhotos } from '../components/ListingPhotos';
import { getListing } from '../lib/api';
import { FlagChip, sortFlags } from '../components/FlagChip';
import { ago, eur, factsLine } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useFeed } from '../lib/store';
import type { ListingDetail as Detail, Portal } from '../lib/types';

/** Display names for the "View on …" link. Typed over every Portal so a new portal can't silently lose its link;
 *  mock listings have no real ad, so they get none. */
const PORTAL_NAMES: Record<Portal, string | null> = { etuovi: 'Etuovi', vuokraovi: 'Vuokraovi', oikotie: 'Oikotie', mock: null };

/** /app/l/:id: the detail drawer (facts, fair price, flags, also-on links, photos, analyst). */
export default function ListingDetail() {
  const { id = '' } = useParams();
  const { byId } = useFeed();
  const { t, lang } = useI18n();
  const [detail, setDetail] = useState<Detail | null | undefined>(undefined);

  useEffect(() => {
    const ac = new AbortController();
    getListing(id, ac.signal).then((r) => setDetail(r.data)).catch(() => {});
    return () => ac.abort();
  }, [id]);

  const l = byId[id] ?? detail; // live store first, so streamed patches show immediately
  if (detail === undefined && !l) return <p className="muted">{t('detail.loading')}</p>;
  if (!l) return <p>{t('detail.notFound')} <Link to="/app">{t('detail.back')}</Link></p>;

  return (
    <>
    <div className="detail-scaffold">
      <h2 className="t-h3">{l.address}</h2>
      <p className="t-body-s muted">{factsLine(l)}</p>
      {l.removed_at && (
        <p className="t-body-s"><span className="sold t-label">{t(l.kind === 'rent' ? 'card.let' : 'card.sold')}</span> {t('card.soldTitle', { ago: ago(l.removed_at) })}</p>
      )}
      <div className="detail-actions">
        <FavButton id={l._id} variant="labelled" />
        {l.url && PORTAL_NAMES[l.portal] && (
          <a className="btn btn--ghost btn--s" href={l.url} target="_blank" rel="noreferrer">
            {t('detail.openPortal', { site: PORTAL_NAMES[l.portal] })}
          </a>
        )}
      </div>
      {l.score && (
        <p className="t-num-m">{t('detail.fair', { price: eur(l.score.fair_price), pct: Math.round(l.score.deal_pct * 1000) / 10 })}</p>
      )}
      {l.flags.length > 0 && <div className="lcard__flags">{sortFlags(l.flags).map((f) => <FlagChip key={f.id + f.status} flag={f} />)}</div>}
    </div>
    <ListingPhotos listing={l} />
    <CommutePanel listing={l} />
    <PortalCompare listing={l} />
    <AnalystPanel listing={l} lang={lang} />
    </>
  );
}
