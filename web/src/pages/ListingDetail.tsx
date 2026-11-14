import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AnalystPanel } from '../components/AnalystPanel';
import { FavButton } from '../components/FavButton';
import { ListingPhotos } from '../components/ListingPhotos';
import { getListing } from '../lib/api';
import { flagLabel } from '../lib/flagText';
import { dealLabel, eur, factsLine } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useFeed } from '../lib/store';
import type { ListingDetail as Detail, Portal } from '../lib/types';

/** Display names for the "View on …" link. Typed over every Portal so a new portal can't silently lose its link;
 *  mock listings have no real ad, so they get none. */
const PORTAL_NAMES: Record<Portal, string | null> = { etuovi: 'Etuovi', vuokraovi: 'Vuokraovi', oikotie: 'Oikotie', mock: null };

/** Step-1 scaffold for /app/l/:id. Step 5 turns this into the drawer (score breakdown, comps, flags, map, fan-out). */
export default function ListingDetail() {
  const { id = '' } = useParams();
  const { byId, calls } = useFeed();
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
  const callRows = calls[id]?.length ? calls[id] : detail?.calls ?? [];

  return (
    <>
    <div className="detail-scaffold">
      <p className="t-eyebrow muted">{l._id}</p>
      <h2 className="t-h3">{l.address}</h2>
      <p className="t-body-s muted">{factsLine(l)}</p>
      <div className="detail-actions">
        <FavButton id={l._id} variant="labelled" />
        {l.url && PORTAL_NAMES[l.portal] && (
          <a className="btn btn--ghost btn--s" href={l.url} target="_blank" rel="noreferrer">
            {t('detail.openPortal', { site: PORTAL_NAMES[l.portal] })}
          </a>
        )}
      </div>
      <p className="t-num-m">
        {t('card.fair')} {eur(l.score?.fair_price)} {l.score && `· ${dealLabel(l.score.deal_pct)} · ${t(`confidence.${l.score.confidence}`)}`}
      </p>
      <p className="t-body-s">{l.flags.map((f) => flagLabel(f) + (f.status === 'error' ? ` (${t('flag.failed')})` : f.status === 'pending' ? ` ${t('flag.checking')}` : '')).join(' · ') || t('detail.noFlags')}</p>
      {l.also_on && Object.keys(l.also_on).length > 0 && (
        <p className="t-body-s muted">
          {t('detail.alsoOn')}{' '}
          {Object.entries(l.also_on).map(([p, x], i) => x && <span key={p}>{i > 0 && ' · '}<a href={x.url} target="_blank" rel="noreferrer">{p[0].toUpperCase() + p.slice(1)}{x.price ? ` (${eur(x.price)})` : ''}</a></span>)}
        </p>
      )}
      <p className="t-num-s muted">{t('detail.calls', { n: callRows.filter((c) => !c.endpoint.startsWith('gemini')).length })}</p>
    </div>
    <ListingPhotos listing={l} />
    <AnalystPanel listing={l} lang={lang} />
    </>
  );
}
