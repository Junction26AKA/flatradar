import { useEffect, useMemo, useState } from 'react';
import { large, mediaPhotos, renovated, RENOVATION_PROMPTS, shareCardPath, thumb } from '../lib/cloudinary';
import { flagLabel } from '../lib/flagText';
import { eur } from '../lib/format';
import { useI18n } from '../lib/i18n';
import type { Flag, Listing, MediaPhoto } from '../lib/types';
import { CldImage } from './CldImage';
import { FlagChip } from './FlagChip';
import './ListingPhotos.css';

/**
 * Listing photos through Cloudinary: smart-cropped gallery, what AI Vision found in each photo, an on-demand
 * "after renovation" preview (generative replace) and the share card. Renders nothing for listings without photos.
 */
export function ListingPhotos({ listing: l }: { listing: Listing }) {
  const { t } = useI18n();
  const media = l.media;
  const photos = mediaPhotos(l);
  const photoFlags = (l.flags ?? []).filter((f) => f.origin === 'photos');
  const [sel, setSel] = useState(0);
  const [renovating, setRenovating] = useState(false);

  useEffect(() => { setSel(0); setRenovating(false); }, [l._id]);
  useEffect(() => setRenovating(false), [sel]);

  if (!media && !l.photos?.length) return null;
  if (!media || media.status === 'pending') {
    return (
      <section className="photos photos--pending" aria-busy="true">
        <h3 className="t-h3">{t('ph.title')}</h3>
        <div className="photos__skeleton" />
        <p className="t-body-s muted"><i className="chip__spin" aria-hidden="true" /> {t('ph.analysing')}</p>
      </section>
    );
  }
  if (media.status === 'error' || !photos.length) {
    return (
      <section className="photos">
        <h3 className="t-h3">{t('ph.title')}</h3>
        <p className="t-body-s muted">{t('ph.error')}</p>
      </section>
    );
  }

  const cloud = media.cloud;
  const i = Math.min(sel, photos.length - 1);
  const p = photos[i];
  const canRenovate = !!RENOVATION_PROMPTS[p.room];
  // The photo flag for this room, if any, gives the rough cost shown under the preview.
  const roomFlag = photoFlags.find((f) => f.photo === i && f.est_cost_eur);

  return (
    <section className="photos" aria-labelledby="photos-h">
      <div className="photos__head">
        <h3 className="t-h3" id="photos-h">{t('ph.title')}</h3>
        <span className="t-num-s muted">{t('ph.count', { n: photos.length })} · Cloudinary</span>
      </div>

      <div className="photos__stage">
        {renovating ? (
          <BeforeAfter cloud={cloud} photo={p} />
        ) : (
          <CldImage
            key={p.public_id}
            cldImg={large(cloud, p)}
            alt={`${t('ph.photo', { n: i + 1 })}: ${t(`ph.room.${p.room}`)}`}
            width={p.width}
            height={p.height}
            className="photos__main"
          />
        )}
        {p.tags.length > 0 && !renovating && (
          <ul className="photos__tags" aria-label="AI Vision">
            {p.tags.filter((tag) => !['kitchen', 'bathroom', 'exterior', 'floor_plan'].includes(tag)).map((tag) => (
              <li key={tag} className={`photos__tag photos__tag--${tag}`}>{tagText(tag, photoFlags)}</li>
            ))}
          </ul>
        )}
      </div>

      {canRenovate && (
        <div className="photos__reno">
          <button type="button" className="btn btn--primary btn--s" aria-pressed={renovating} onClick={() => setRenovating((r) => !r)}>
            {renovating ? t('ph.original') : `✨ ${t('ph.renovate')}`}
          </button>
          {renovating && (
            <p className="t-body-s muted">
              {roomFlag?.est_cost_eur ? `${t('ph.cost', { c: eur(roomFlag.est_cost_eur) })}. ` : ''}{t('ph.disclaimer')}
            </p>
          )}
        </div>
      )}

      <ol className="photos__strip">
        {photos.map((ph, n) => (
          <li key={ph.public_id}>
            <button type="button" className="photos__thumb" aria-current={n === i ? 'true' : undefined} onClick={() => setSel(n)} aria-label={`${t('ph.photo', { n: n + 1 })}: ${t(`ph.room.${ph.room}`)}`}>
              <CldImage cldImg={thumb(cloud, ph, 160, 120)} lazy width={80} height={60} alt="" />
              {photoFlags.some((f) => f.photo === n && f.severity !== 'info') && <i className="photos__dot" aria-hidden="true" />}
            </button>
          </li>
        ))}
      </ol>

      {media.analysed ? (
        <div className="photos__found">
          <h4 className="t-label">{t('ph.found')}</h4>
          {photoFlags.length ? (
            <ul>
              {photoFlags.map((f) => (
                <li key={f.id}>
                  <button type="button" className="photos__flag" onClick={() => f.photo != null && setSel(f.photo)} title={t('ph.show')}>
                    <FlagChip flag={f} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="t-body-s muted">{t('ph.nothing')}</p>
          )}
        </div>
      ) : (
        <p className="t-body-s muted">{t('ph.notAnalysed')}</p>
      )}

      <ShareCard id={l._id} />
    </section>
  );
}

/** Short tag text: the matching flag's label (translated) when there is one, else the tag name. */
function tagText(tag: string, flags: Flag[]) {
  const f = flags.find((x) => x.id === `photo-${tag}`);
  return f ? flagLabel(f) : tag.replace(/_/g, ' ');
}

/**
 * Before/after slider. The "after" is a Cloudinary generative replace, generated on the first request:
 * Cloudinary answers 423 while it works in the background, so we retry until the image loads.
 */
function BeforeAfter({ cloud, photo }: { cloud: string; photo: MediaPhoto }) {
  const { t } = useI18n();
  const [pos, setPos] = useState(50);
  const before = useMemo(() => large(cloud, photo).toURL(), [cloud, photo]);
  const afterBase = useMemo(() => renovated(cloud, photo)?.toURL() ?? null, [cloud, photo]);
  const [after, setAfter] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!afterBase) return;
    setAfter(null); setFailed(false);
    let tries = 0, timer = 0, dead = false;
    const attempt = () => {
      const img = new Image();
      const url = tries === 0 ? afterBase : `${afterBase}${afterBase.includes('?') ? '&' : '?'}retry=${tries}`;
      img.onload = () => !dead && setAfter(url);
      img.onerror = () => {
        if (dead) return;
        if (++tries > 30) setFailed(true); // ~2 min
        else timer = window.setTimeout(attempt, 4000);
      };
      img.src = url;
    };
    attempt();
    return () => { dead = true; clearTimeout(timer); };
  }, [afterBase]);

  return (
    <div className="ba" style={{ aspectRatio: `${photo.width} / ${photo.height}` }}>
      <img src={before} alt={t('ph.before')} className="ba__img" />
      {after ? (
        <>
          <img src={after} alt={t('ph.after')} className="ba__img ba__after" style={{ clipPath: `inset(0 0 0 ${pos}%)` }} />
          <span className="ba__label ba__label--l t-label">{t('ph.before')}</span>
          <span className="ba__label ba__label--r t-label">{t('ph.after')}</span>
          <i className="ba__handle" style={{ left: `${pos}%` }} aria-hidden="true" />
          <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} className="ba__range" aria-label={t('ph.slider')} />
        </>
      ) : (
        <div className="ba__wait" role="status">
          {failed ? t('ph.genFailed') : <><i className="chip__spin" aria-hidden="true" /> {t('ph.generating')}</>}
        </div>
      )}
    </div>
  );
}

function ShareCard({ id }: { id: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [ok, setOk] = useState(true);
  const path = shareCardPath(id);
  const abs = typeof location !== 'undefined' ? `${location.origin}${path}` : path;
  if (!ok) return null;
  const share = async () => {
    try { await navigator.share({ title: 'FlatRadar', url: abs }); } catch { /* cancelled */ }
  };
  return (
    <div className="photos__share">
      <h4 className="t-label">{t('ph.share')}</h4>
      <img src={path} alt="" className="photos__card" width={600} height={315} loading="lazy" onError={() => setOk(false)} />
      <p className="t-body-s muted">{t('ph.shareHint')}</p>
      <div className="photos__shareBtns">
        {'share' in navigator && <button type="button" className="btn btn--ghost btn--s" onClick={share}>{t('ph.shareBtn')}</button>}
        <button type="button" className="btn btn--ghost btn--s" onClick={() => navigator.clipboard?.writeText(abs).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}>
          {copied ? t('ph.copied') : t('ph.copy')}
        </button>
        <a className="btn btn--ghost btn--s" href={path} target="_blank" rel="noreferrer">{t('ph.open')}</a>
      </div>
    </div>
  );
}
