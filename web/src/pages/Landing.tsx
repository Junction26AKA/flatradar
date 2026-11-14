import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { motion, useMotionValueEvent, useScroll, useSpring, useTransform, useVelocity, type MotionValue } from 'motion/react';
import { Coin } from '../components/Coin';
import { DealBadge } from '../components/DealBadge';
import { FlagChip, sortFlags } from '../components/FlagChip';
import { ListingCard } from '../components/ListingCard';
import { Logo } from '../components/Logo';
import { LiveDot } from '../components/LiveDot';
import { ANCHOR, CHAPTERS, COINS, OVERLAY, chapterAt, ramp, toScroll, toStory, type Chapter } from '../fx/chapters';
import { CoinRain, coinBurst, pourTarget } from '../fx/CoinRain';
import { House2D } from '../fx/House2D';
import { Odometer } from '../fx/Odometer';
import { PiggyBank } from '../fx/PiggyBank';
import { useLandingData, type LandingData } from '../fx/useLandingData';
import { askingPrice, eur, num, perM2, shortAddress, shortDistrict } from '../lib/format';
import { useNow } from '../lib/useNow';
import { LangSwitch, useI18n } from '../lib/i18n';
import './landing.css';

const Scene3D = lazy(() => import('../fx/Scene3D'));

/** Scroll length of the whole story, in viewport heights. */
const STORY_VH = 840;

function useEnv() {
  const get = () => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const narrow = window.matchMedia('(max-width: 767px)').matches;
    let gl = false;
    try { gl = !!document.createElement('canvas').getContext('webgl2'); } catch { /* no WebGL */ }
    return { reduced, narrow, use3D: gl && !reduced && !narrow };
  };
  const [env, setEnv] = useState(get);
  useEffect(() => {
    const mq = [window.matchMedia('(prefers-reduced-motion: reduce)'), window.matchMedia('(max-width: 767px)')];
    const on = () => setEnv(get());
    mq.forEach((m) => m.addEventListener('change', on));
    return () => mq.forEach((m) => m.removeEventListener('change', on));
  }, []);
  return env;
}

/** Scroll the window to a given point in story time (nav links jump to chapters). */
function scrollToProgress(root: HTMLElement | null, storyP: number) {
  if (!root) return;
  const top = root.offsetTop + toScroll(storyP) * (root.offsetHeight - window.innerHeight);
  window.scrollTo({ top, behavior: 'smooth' });
}

export default function Landing() {
  const root = useRef<HTMLDivElement>(null);
  const { scrollYProgress: scrollP, scrollY } = useScroll({ target: root, offset: ['start start', 'end end'] });
  // Everything downstream runs on story time (see SCROLL_TO_STORY): same scroll, but some moments hold longer.
  const scrollYProgress = useTransform(scrollP, toStory);
  const velocity = useVelocity(scrollY);
  const env = useEnv();
  const data = useLandingData();
  const [active, setActive] = useState<Chapter>(CHAPTERS[0]);
  useMotionValueEvent(scrollYProgress, 'change', (p) => { const c = chapterAt(p); if (c.id !== active.id) setActive(c); });

  // Background colour crossfades between chapters. Function form on purpose: motion would otherwise hand
  // array-keyed opacity/colour transforms to the browser's native ScrollTimeline, which mis-maps our
  // target-relative progress (the colours drifted by a whole chapter).
  const bg = useTransform(scrollYProgress, chapterBg);

  useEffect(() => {
    const el = document.documentElement;
    const prev = el.style.overscrollBehaviorY;
    el.style.overscrollBehaviorY = 'none';
    return () => { el.style.overscrollBehaviorY = prev; };
  }, []);

  const jump = (id: keyof typeof ANCHOR) => scrollToProgress(root.current, ANCHOR[id]);
  const { status } = useAuth();
  const { t } = useI18n();
  const signedIn = status === 'signed-in';

  return (
    <div className={`lp lp--${active.ink}`}>
      <nav className="lp__nav" aria-label="Main">
        <Link to="/" className="lp__brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <Logo size={36} />
          <span className="t-h4">FlatRadar</span>
        </Link>
        <div className="lp__links t-label">
          <button onClick={() => jump('price')}>{t('lp.how')}</button>
          <button onClick={() => jump('pricing')}>{t('lp.pricing')}</button>
          <button onClick={() => jump('live')}>{t('lp.liveMap')}</button>
        </div>
        <LangSwitch onDark={active.ink === 'light'} className="lp__lang" />
        {!signedIn && <Link to="/signin?mode=in" className="lp__signin t-label">{t('lp.signIn')}</Link>}
        <CtaButton className="lp__navcta">{signedIn ? t('lp.open') : t('lp.start')}</CtaButton>
      </nav>

      <div ref={root} className="lp__story" style={{ height: `${STORY_VH}vh` }}>
        <div className="lp__stage">
          <motion.div className="lp__bg" style={{ backgroundColor: bg }} />
          <GhostCross progress={scrollYProgress} />
          <FlagCross progress={scrollYProgress} />
          <div className="lp__house">
            {env.use3D ? (
              <Suspense fallback={<House2D progress={scrollYProgress} narrow={env.narrow} />}>
                <Scene3D progress={scrollYProgress} />
              </Suspense>
            ) : (
              <House2D progress={scrollYProgress} narrow={env.narrow} />
            )}
          </div>

          <PriceTag progress={scrollYProgress} data={data} />
          <FlyingFlags progress={scrollYProgress} data={data} narrow={env.narrow} />
          <CoinTowers progress={scrollYProgress} data={data} />
          <Piggy progress={scrollYProgress} />

          <CoinRain progress={scrollYProgress} velocity={velocity} lite={env.narrow} still={env.reduced} />

          <Panels progress={scrollYProgress} active={active.id} data={data} onHow={() => jump('price')} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Chapter text panels (in the sticky stage; visible while their chapter is on screen)

function Panel({ chapter, progress, active, className = '', children }: { chapter: string; progress: MotionValue<number>; active: string; className?: string; children: ReactNode }) {
  const c = CHAPTERS.find((x) => x.id === chapter)!;
  const span = c.to - c.from;
  const isFirst = c.from === 0;
  const isLast = c.to === 1;
  const opacity = useTransform(progress, (p) => {
    // Outgoing text is fully gone before the next chapter's text starts (no doubled text mid-scroll).
    const fadeIn = isFirst ? 1 : chapter === 'cta' ? ramp(p, OVERLAY.ctaText[0], OVERLAY.ctaText[1]) : ramp(p, c.from + span * 0.02, c.from + span * 0.16);
    const fadeOut = isLast ? 1 : 1 - ramp(p, c.to - span * 0.16, c.to - span * 0.02);
    return Math.min(fadeIn, fadeOut);
  });
  const y = useTransform(opacity, (o) => (1 - o) * 28);
  return (
    <motion.section
      className={`lp__panel lp__panel--${c.ink} lp__panel--${chapter} ${className}`}
      style={{ opacity, y }}
      aria-labelledby={`h-${chapter}`}
      inert={active !== chapter}
    >
      {children}
    </motion.section>
  );
}

function Panels({ progress, active, data, onHow }: { progress: MotionValue<number>; active: string; data: LandingData; onHow: () => void }) {
  const now = useNow();
  const { t } = useI18n();
  return (
    <>
      <Panel chapter="hero" progress={progress} active={active}>
        <p className="t-eyebrow lp__eyebrow">{t('lp.eyebrow')}</p>
        <h1 id="h-hero" className="t-hero">{t('lp.hero')}</h1>
        <p className="t-body-l lp__sub">
          {t('lp.heroSub')}
        </p>
        <div className="lp__odo">
          <Odometer value={data.overpricing} className="t-num-xl" />
          <span className="t-body-s lp__odocap">
            {t('lp.odoCap', { n: data.overpricedCount, sample: data.source === 'fixtures' })}
          </span>
        </div>
        <div className="lp__ctas">
          <CtaButton>{t('lp.start')}</CtaButton>
          <a className="lp__ghost" href="#how" onClick={(e) => { e.preventDefault(); onHow(); }}>{t('lp.seeHow')}</a>
        </div>
        <p className="t-num-s lp__hint" aria-hidden="true">{t('lp.hint')}</p>
      </Panel>

      <Panel chapter="price" progress={progress} active={active}>
        <h2 id="h-price" className="t-h1">{t('lp.priceH')}</h2>
        <p className="t-body-l lp__sub">
          {t('lp.priceSub')}
        </p>
      </Panel>

      <Panel chapter="costs" progress={progress} active={active}>
        <h2 id="h-costs" className="t-h1">{t('lp.costsH')}</h2>
        <p className="t-body-l lp__sub">
          {t('lp.costsSub')}
        </p>
      </Panel>

      <Panel chapter="pricing" progress={progress} active={active}>
        <h2 id="h-pricing" className="t-h1">{t('lp.pricingH')}</h2>
        <p className="t-body-l lp__sub">
          {t('lp.pricingSub')}
        </p>
      </Panel>

      <Panel chapter="live" progress={progress} active={active} className="lp__panel--wide">
        <p className="lp__livepill t-num-s"><LiveDot /> {data.watched ? t('lp.livePill', { n: num(data.watched) }) : t('lp.livePillNone')}</p>
        <h2 id="h-live" className="t-h1">{t('lp.liveH')}</h2>
        <p className="t-body-l lp__sub">{t('lp.liveSub')}</p>
        <div className="lp__ticker" aria-label={t('lp.tickerLabel')}>
          {data.ticker.slice(0, 6).map((l) => (
            <ListingCard key={l._id} listing={l} now={now} to={`/app/l/${encodeURIComponent(l._id)}`} compact fresh={now - Date.parse(l.first_seen_at) < 60_000} />
          ))}
        </div>
      </Panel>

      <Panel chapter="cta" progress={progress} active={active} className="lp__panel--cta">
        <h2 id="h-cta" className="t-h1">{t('lp.ctaH')}</h2>
        <div className="lp__ctas">
          <CtaButton variant="primary">{t('lp.ctaPrimary')}</CtaButton>
          <Link className="lp__ghost" to="/app">{t('lp.ctaMap')}</Link>
        </div>
        <p className="t-body-l lp__sub">{t('lp.ctaSub')}</p>
      </Panel>
    </>
  );
}

/** Gold CTA: coin burst from the button, then go to sign-up. */
function CtaButton({ children, className = '', variant = 'gold' }: { children: ReactNode; className?: string; variant?: 'gold' | 'primary' }) {
  const nav = useNavigate();
  const { status } = useAuth();
  const to = status === 'signed-in' ? '/app' : '/signin';
  return (
    <button
      className={`lp__cta lp__cta--${variant} t-label ${className}`}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        coinBurst(r.left + r.width / 2, r.top + r.height / 2, 24);
        setTimeout(() => nav(to), window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 380);
      }}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------------------------
// Overlays drawn over the house

const hexRgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** Chapter background at progress p, crossfading over ±0.015 around each chapter boundary. */
function chapterBg(p: number): string {
  const X = 0.015;
  for (let i = 1; i < CHAPTERS.length; i++) {
    const c = CHAPTERS[i];
    if (p < c.from - X) return CHAPTERS[i - 1].bg;
    if (p <= c.from + X) {
      const t = ramp(p, c.from - X, c.from + X);
      const [a, b] = [hexRgb(CHAPTERS[i - 1].bg), hexRgb(c.bg)];
      return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * t)).join(',')})`;
    }
  }
  return CHAPTERS[CHAPTERS.length - 1].bg;
}

function GhostCross({ progress }: { progress: MotionValue<number> }) {
  const opacity = useTransform(progress, (p) => 1 - ramp(p, 0.12, 0.16));
  return <motion.div className="lp__ghostcross" style={{ opacity }} aria-hidden="true"><i /><i /></motion.div>;
}

/** Final chapter: the page becomes the Finnish flag (blue cross wipes in from the centre). */
function FlagCross({ progress }: { progress: MotionValue<number> }) {
  const s = useTransform(progress, (p) => ramp(p, OVERLAY.flag[0], OVERLAY.flag[1]));
  return (
    <div className="lp__flag" aria-hidden="true">
      <motion.i className="lp__flag-v" style={{ scaleY: s }} />
      <motion.i className="lp__flag-h" style={{ scaleX: s }} />
    </div>
  );
}

function PriceTag({ progress, data }: { progress: MotionValue<number>; data: LandingData }) {
  const { listing: l, isExample } = data.priceExample;
  const { t } = useI18n();
  const ask = askingPrice(l);
  const fair = l.score?.fair_price ?? null;
  const pct = l.score?.deal_pct ?? 0;
  const tagIn = useTransform(progress, (p) => (p >= OVERLAY.tag.shatter ? 0 : ramp(p, OVERLAY.tag.in[0], OVERLAY.tag.in[1]) * (1 - ramp(p, 0.33, 0.36))));
  const swing = useSpring(useTransform(tagIn, (t) => (1 - t) * -40 - 8), { stiffness: 180, damping: 12 });
  const fairIn = useTransform(progress, (p) => ramp(p, OVERLAY.tag.fair[0], OVERLAY.tag.fair[1]) * (1 - ramp(p, 0.335, 0.36)));
  const fairScale = useSpring(useTransform(fairIn, (t) => 0.6 + 0.4 * t), { stiffness: 260, damping: 14 });
  if (ask == null || fair == null) return null;
  return (
    <>
      <motion.div data-fx="tag" className="lp__tag" style={{ opacity: tagIn, rotate: swing, scale: tagIn }} aria-hidden="true">
        <span className="t-eyebrow">{t('lp.asking')}{isExample ? ` · ${t('lp.example')}` : ''}</span>
        <span className="t-num-l lp__tagprice">{eur(ask)}</span>
        <span className="lp__stamp t-eyebrow">{t('lp.overpriced', { p: (pct * 100).toFixed(0) })}</span>
      </motion.div>
      <motion.div className="lp__fair" style={{ opacity: fairIn, scale: fairScale }} aria-hidden="true">
        <span className="t-eyebrow lp__fairlbl">{t('lp.fairValue')} · {shortAddress(l)}, {shortDistrict(l)}</span>
        <span className="t-num-l lp__fairprice">{eur(fair)}</span>
        <DealBadge pct={pct} label={t('lp.tooHigh', { eur: eur(ask - fair) })} />
      </motion.div>
    </>
  );
}

function FlyingFlags({ progress, data, narrow }: { progress: MotionValue<number>; data: LandingData; narrow: boolean }) {
  const { listing, isExample } = data.costsExample;
  const { t } = useI18n();
  const flags = useMemo(() => sortFlags(listing.flags.filter((f) => f.status === 'ok')).slice(0, 4), [listing]);
  const quoted = flags.find((f) => f.source?.quote);
  // where each chip lands, relative to the house centre (in % of the stage)
  // Chips are centred on their spot (vw, vh from the house centre). Desktop: alternate left/right of the
  // house; phones: a tidy stack above the house, and no quote card.
  const spots = narrow ? [[0, -34], [0, -28], [0, -22], [0, -16]] : [[-12, -28], [10, -18], [-12, -8], [10, 2]];
  return (
    <div className="lp__flags" aria-hidden="true">
      {flags.map((f, i) => <FlyingChip key={f.id} progress={progress} i={i} to={spots[i]}><FlagChip flag={f} /></FlyingChip>)}
      {!narrow && quoted?.source?.quote && (
        <FlyingChip progress={progress} i={flags.length} to={[-1, 16]}>
          <span className="lp__quote">
            <span className="t-body-s">“{quoted.source.quote}”</span>
            <span className="t-num-s lp__quotesrc">{isExample ? t('lp.exampleListing') : `${listing.portal === 'oikotie' ? 'oikotie.fi' : `${listing.portal}.com`} · ${shortAddress(listing)}`}</span>
          </span>
        </FlyingChip>
      )}
    </div>
  );
}

function FlyingChip({ progress, i, to, children }: { progress: MotionValue<number>; i: number; to: number[]; children: ReactNode }) {
  const t = useTransform(progress, (p) => ramp(p, OVERLAY.flags[0] + i * 0.012, OVERLAY.flags[1] + i * 0.012) * (1 - ramp(p, 0.54, 0.57)));
  const x = useTransform(t, (v) => `${to[0] * v}vw`);
  const y = useTransform(t, (v) => `${to[1] * v}vh`);
  const scale = useTransform(t, (v) => 0.3 + 0.7 * v);
  return <motion.div className="lp__fly" style={{ x, y, scale, opacity: t }}><div className="lp__flyin">{children}</div></motion.div>;
}

function CoinTowers({ progress, data }: { progress: MotionValue<number>; data: LandingData }) {
  const { listing: l, isExample } = data.pricingExample;
  const s = l.score;
  const kind = l.kind;
  const { t } = useI18n();
  const sources = [
    { name: t('lp.src.comps'), sub: s?.comps ? t('lp.src.compsSub', { n: s.comps.n, km: Math.round((s.comps.radius_m ?? 1000) / 100) / 10 }) : t('lp.src.compsNone'), v: s?.comps?.fair_m2 ?? null },
    { name: t('lp.src.model'), sub: s?.model ? `${s.model.version} · MAE ${Math.round(s.model.mae_pct * 100)}%` : t('lp.src.modelTraining'), v: s?.model?.fair_m2 ?? null },
    { name: t('lp.src.stat'), sub: s?.baseline ? `${s.baseline.postcode} · ${s.baseline.year}` : t('lp.src.statNone'), v: s?.baseline?.eur_m2 ?? null },
  ];
  const max = Math.max(...sources.map((x) => x.v ?? 0), 1);
  const beam = useTransform(progress, (p) => -6 + 6 * ramp(p, OVERLAY.beam[0], OVERLAY.beam[1]));
  const show = useTransform(progress, (p) => ramp(p, 0.56, 0.6) * (1 - ramp(p, 0.73, 0.76)));
  if (!s) return null;
  return (
    <motion.div className="lp__towers" style={{ opacity: show }} aria-hidden="true">
      <motion.div className="lp__beam" style={{ rotate: beam }}>
        <span className="t-num-l">{t('lp.fair')} {perM2(s.fair_m2, kind)}</span>
        <DealBadge pct={0} label={t('lp.confidence', { c: t(`confidence.${s.confidence}`) })} size="s" />
        {isExample && <span className="t-num-s lp__eg">{t('lp.exampleListing')}</span>}
      </motion.div>
      <div className="lp__towerrow">
        {sources.map((src, i) => <Tower key={src.name} progress={progress} i={i} n={src.v ? Math.max(3, Math.round((14 * src.v) / max)) : 2} missing={!src.v} label={src.v ? perM2(src.v, kind) : '—'} name={src.name} sub={src.sub} />)}
      </div>
    </motion.div>
  );
}

function Tower({ progress, i, n, missing, label, name, sub }: { progress: MotionValue<number>; i: number; n: number; missing: boolean; label: string; name: string; sub: string }) {
  const [count, setCount] = useState(0);
  useMotionValueEvent(progress, 'change', (p) => setCount(Math.round(n * ramp(p, OVERLAY.towers[0] + i * 0.02, OVERLAY.towers[1] + i * 0.02))));
  return (
    <div className={`lp__tower${missing ? ' lp__tower--missing' : ''}`}>
      <div className="lp__stack">
        {Array.from({ length: count }, (_, k) => <span key={k} style={{ bottom: k * 13, left: (k % 2) * 3 }}><Coin size={44} /></span>)}
      </div>
      <span className="t-num-m">{label}</span>
      <span className="t-body-s lp__towersub">{name} · {sub}</span>
    </div>
  );
}

function Piggy({ progress }: { progress: MotionValue<number> }) {
  const slot = useRef<HTMLDivElement>(null);
  const [wobble, setWobble] = useState(false);
  const opacity = useTransform(progress, (p) => ramp(p, 0.9, 0.93));
  const y = useTransform(opacity, (o) => (1 - o) * 60);
  useMotionValueEvent(progress, 'change', (p) => {
    const inPour = p > COINS.pour[0] && p < COINS.pour[1];
    if (inPour && slot.current) { const r = slot.current.getBoundingClientRect(); pourTarget.current = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
    else pourTarget.current = null;
    setWobble(p > 0.975);
  });
  return (
    <motion.div className="lp__piggy" style={{ opacity, y }} aria-hidden="true">
      <PiggyBank ref={slot} wobble={wobble} />
    </motion.div>
  );
}
