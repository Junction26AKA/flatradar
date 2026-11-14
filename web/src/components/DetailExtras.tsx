import { useEffect, useMemo, useState } from 'react';
import { getCommute } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ago, eur } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { commuteKey, commuteTime } from '../lib/match';
import { cheaperElsewhere, portalName, portalPrices } from '../lib/portals';
import type { CommuteTarget, CommuteTime, Listing } from '../lib/types';
import './DetailExtras.css';

/** The same flat on every portal it's advertised on, with the price gap to this ad. Hidden for single-portal flats. */
export function PortalCompare({ listing: l }: { listing: Listing }) {
  const { t } = useI18n();
  const rows = portalPrices(l);
  if (rows.length < 2) return null;
  const best = cheaperElsewhere(l);
  const unit = l.kind === 'rent' ? t('unit.month') : '';
  return (
    <section className="dx" aria-labelledby="dx-portals">
      <h3 id="dx-portals" className="t-eyebrow muted">{t('detail.portalsH')}</h3>
      {best && <p className="dx__best t-body-s">{t('detail.bestOn', { site: portalName(best.portal), eur: eur(-best.diff!) })}</p>}
      <table className="dx__table">
        <tbody>
          {rows.map((r) => (
            <tr key={r.portal} className={r === best ? 'is-best' : undefined}>
              <th scope="row" className="t-label">
                <a href={r.url} target="_blank" rel="noreferrer">{portalName(r.portal)} ↗</a>
                {r.here && <span className="muted t-body-s"> · {t('detail.thisAd')}</span>}
              </th>
              <td className="t-num-s">{r.price != null ? `${eur(r.price)}${unit}` : '—'}</td>
              <td className="t-num-s dx__diff">
                {r.here || r.diff == null ? '' : r.diff === 0 ? t('detail.samePrice') : r.diff < 0 ? t('detail.cheaperBy', { eur: eur(-r.diff) }) : t('detail.dearerBy', { eur: eur(r.diff) })}
              </td>
              <td className="t-num-s muted dx__seen">{r.seen_at ? ago(r.seen_at) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="t-body-s muted">{t('detail.portalsNote')}</p>
    </section>
  );
}

/**
 * Commute times to the places in the user's saved searches (same kind). Shows the estimate at once, then asks the
 * server for the HSL journey-planner time (cached on the listing) and swaps it in.
 */
export function CommutePanel({ listing: l }: { listing: Listing }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const targets = useMemo(() => {
    const m = new Map<string, CommuteTarget>();
    for (const s of user?.searches ?? []) {
      if (s.kind !== l.kind || !s.commute) continue;
      const k = commuteKey(s.commute.lat, s.commute.lng);
      const prev = m.get(k);
      if (!prev || s.commute.max_min > prev.max_min) m.set(k, s.commute);
    }
    return [...m.entries()];
  }, [user?.searches, l.kind]);
  const [fetched, setFetched] = useState<Record<string, CommuteTime>>({});

  useEffect(() => {
    if (!l.loc || user?.offline) return;
    let live = true;
    for (const [k, c] of targets) {
      if (l.commutes?.[k]?.min != null) continue;
      getCommute(l._id, c.lat, c.lng).then((v) => { if (live) setFetched((f) => ({ ...f, [k]: v })); }).catch(() => {});
    }
    return () => { live = false; };
  }, [l._id, !!l.loc, targets]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!targets.length || !l.loc) return null;
  return (
    <section className="dx" aria-labelledby="dx-commute">
      <h3 id="dx-commute" className="t-eyebrow muted">{t('detail.commuteH')}</h3>
      <ul className="dx__commutes">
        {targets.map(([k, c]) => {
          const v = l.commutes?.[k] ?? fetched[k] ?? commuteTime(l, c);
          if (!v) return null;
          const over = v.min > c.max_min;
          return (
            <li key={k} className={over ? 'is-over' : 'is-ok'}>
              <span className="t-label">🚆 {t('detail.commuteRow', { min: v.min, to: c.label })}</span>
              <span className="t-body-s muted">
                {v.src === 'hsl' ? t('detail.commuteHsl') : t('detail.commuteEst')}
                {over && <> · <span className="dx__over">{t('detail.commuteOver', { max: c.max_min })}</span></>}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
