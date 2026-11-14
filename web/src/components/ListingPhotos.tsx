import { useEffect, useMemo, useState } from 'react';
import { canRenovate as renovatable, hasOptionalSteps, large, mediaPhotos, renovated, renovationChanges, thumb } from '../lib/cloudinary';
import { flagLabel } from '../lib/flagText';
import { eur } from '../lib/format';
import { useI18n } from '../lib/i18n';
import type { Flag, Listing, MediaPhoto } from '../lib/types';
import { CldImage } from './CldImage';
import { FlagChip } from './FlagChip';
import './ListingPhotos.css';

/**
 * Listing photos through Cloudinary: smart-cropped gallery, what AI Vision found in each photo, an on-demand
 * "after renovation" preview (generative replace) Renders nothing for listings without photos.
 */
export function ListingPhotos({ listing: l }: { listing: Listing }) {
  const { t } = useI18n();
  const media = l.media;
  const photos = mediaPhotos(l);
  const photoFlags = (l.flags ?? []).filter((f) => f.origin === 'photos');
  const [sel, setSel] = useState(0);
  const [renovating, setRenovating] = useState(false);
  // Which renovated version the slider is showing: the full one or the core-only fallback (null while generating).
  const [shown, setShown] = useState<'full' | 'core' | null>(null);

  useEffect(() => { setSel(0); setRenovating(false); }, [l._id]);
  useEffect(() => setRenovating(false), [sel]);
  useEffect(() => { if (!renovating) setShown(null); }, [renovating]);

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
  const canRenovate = renovatable(p);
  // The photo flag for this room, if any, gives the rough cost shown under the preview.
  const roomFlag = photoFlags.find((f) => f.photo === i && f.est_cost_eur);

  return (
    <section className="photos" aria-labelledby="photos-h">
      <div className="photos__head">
        <h3 className="t-h3" id="photos-h">{t('ph.title')}</h3>
        <span className="t-body-s muted">{t('ph.count', { n: photos.length })}</span>
      </div>

      <div className="photos__stage">
        {renovating ? (
          <BeforeAfter cloud={cloud} photo={p} onShown={setShown} />
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
            <>
              {shown && (
                <p className="t-body-s">
                  <span className="muted">{t('ph.changes')}</span>{' '}
                  {renovationChanges(p, shown === 'core').map((c) => t(`ph.change.${c}`)).join(', ')}
                </p>
              )}
              <p className="t-body-s muted">
                {roomFlag?.est_cost_eur ? `${t('ph.cost', { c: eur(roomFlag.est_cost_eur) })}. ` : ''}{t('ph.disclaimer')}
              </p>
            </>
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

    </section>
  );
}

/** Short tag text: the matching flag's label (translated) when there is one, else the tag name. */
function tagText(tag: string, flags: Flag[]) {
  const f = flags.find((x) => x.id === `photo-${tag}`);
  return f ? flagLabel(f) : tag.replace(/_/g, ' ');
}

/** Retry an image URL while Cloudinary answers 423 (still generating), until it loads or `giveUpMs` passes. */
function pollImage(base: string, giveUpMs: number, onLoad: (url: string) => void, onGiveUp: () => void) {
  const until = Date.now() + giveUpMs;
  let tries = 0, timer = 0, dead = false;
  const attempt = () => {
    const img = new Image();
    const url = tries === 0 ? base : `${base}${base.includes('?') ? '&' : '?'}retry=${tries}`;
    img.onload = () => !dead && onLoad(url);
    img.onerror = () => {
      if (dead) return;
      tries++;
      if (Date.now() > until) onGiveUp();
      else timer = window.setTimeout(attempt, 4000);
    };
    img.src = url;
  };
  attempt();
  return () => { dead = true; clearTimeout(timer); };
}

/** After this long without the full renovation, also ask for the core-only one (see RENOVATION_STEPS). */
const CORE_FALLBACK_MS = 45_000;
const GIVE_UP_MS = 150_000;

/**
 * Before/after slider. The "after" is a chain of Cloudinary generative effects, generated on the first request:
 * Cloudinary answers 423 while it works in the background, so we retry until the image loads. If the full
 * version is slow (a target like tiles or a ceiling light isn't in the photo), the core-only one takes its place.
 */
function BeforeAfter({ cloud, photo, onShown }: { cloud: string; photo: MediaPhoto; onShown: (v: 'full' | 'core') => void }) {
  const { t } = useI18n();
  const [pos, setPos] = useState(50);
  const before = useMemo(() => large(cloud, photo).toURL(), [cloud, photo]);
  const [after, setAfter] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const full = renovated(cloud, photo)?.toURL();
    if (!full) return;
    setAfter(null); setFailed(false);
    let settled = false, pending = 0;
    const stops: (() => void)[] = [];
    const show = (version: 'full' | 'core') => (url: string) => {
      if (settled) return;
      settled = true;
      stops.forEach((stop) => stop());
      setAfter(url);
      onShown(version);
    };
    const giveUp = () => { if (--pending === 0 && !settled) setFailed(true); };
    const start = (url: string, version: 'full' | 'core', ms: number) => { pending++; stops.push(pollImage(url, ms, show(version), giveUp)); };

    start(full, 'full', GIVE_UP_MS);
    const core = hasOptionalSteps(photo) ? renovated(cloud, photo, { core: true })?.toURL() : undefined;
    const fallback = core ? window.setTimeout(() => !settled && start(core, 'core', GIVE_UP_MS - CORE_FALLBACK_MS), CORE_FALLBACK_MS) : 0;
    return () => { settled = true; clearTimeout(fallback); stops.forEach((stop) => stop()); };
  }, [cloud, photo, onShown]);

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
