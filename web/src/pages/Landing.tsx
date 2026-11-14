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
import { ANCHOR, CHAPTERS, COINS, OVERLAY, chapterAt, ramp, type Chapter } from '../fx/chapters';
import { CoinRain, coinBurst, pourTarget } from '../fx/CoinRain';
import { House2D } from '../fx/House2D';
import { Odometer } from '../fx/Odometer';
import { PiggyBank } from '../fx/PiggyBank';
import { useLandingData, type LandingData } from '../fx/useLandingData';
import { askingPrice, eur, num, perM2, shortAddress, shortDistrict } from '../lib/format';
import { useNow } from '../lib/useNow';
import './landing.css';

const Scene3D = lazy(() => import('../fx/Scene3D'));

/** Scroll length of the whole story, in viewport heights. */
const STORY_VH = 720;

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

/** Scroll the window to a given story progress (nav links jump to chapters). */
function scrollToProgress(root: HTMLElement | null, p: number) {
  if (!root) return;
  const top = root.offsetTop + p * (root.offsetHeight - window.innerHeight);
  window.scrollTo({ top, behavior: 'smooth' });
}

export default function Landing() {
  const root = useRef<HTMLDivElement>(null);
  const { scrollYProgress, scrollY } = useScroll({ target: root, offset: ['start start', 'end end'] });
  const velocity = useVelocity(scrollY);
  const env = useEnv();
  const data = useLandingData();
  const [active, setActive] = useState<Chapter>(CHAPTERS[0]);
  useMotionValueEvent(scrollYProgress, 'change', (p) => { const c = chapterAt(p); if (c.id !== active.id) setActive(c); });

  // Background colour crossfades between chapters. Function form on purpose: motion would otherwise hand
  // array-keyed opacity/colour transforms to the browser's native ScrollTimeline, which mis-maps our
  // target-relative progress (the colours drifted by a whole chapter).
  const bg = useTransform(scrollYProgress, chapterBg);

  const jump = (id: keyof typeof ANCHOR) => scrollToProgress(root.current, ANCHOR[id]);
  const { status } = useAuth();
  const signedIn = status === 'signed-in';

  return (
    <div className={`lp lp--${active.ink}`}>
      <nav className="lp__nav" aria-label="Main">
        <Link to="/" className="lp__brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <Logo size={36} />
          <span className="t-h4">FlatRadar</span>
        </Link>
        <LiveDot onDark={active.ink === 'light'} />
        <div className="lp__links t-label">
          <button onClick={() => jump('price')}>How it works</button>
          <button onClick={() => jump('pricing')}>Pricing model</button>
          <button onClick={() => jump('live')}>Live map</button>
        </div>
        {!signedIn && <Link to="/signin?mode=in" className="lp__signin t-label">Sign in</Link>}
        <CtaButton className="lp__navcta">{signedIn ? 'Open FlatRadar →' : 'Start saving →'}</CtaButton>
      </nav>

      <div ref={root} className="lp__story" style={{ height: `${STORY_VH}vh` }}>
        <div className="lp__stage">
          <motion.div className="lp__bg" style={{ backgroundColor: bg }} />
          <GhostCross progress={scrollYProgress} />
          <FlagCross progress={scrollYProgress} />
          <div className="lp__house">
            {env.use3D ? (
              <Suspense fallback={<House2D progress={scrollYProgress} />}>
                <Scene3D progress={scrollYProgress} />
              </Suspense>
            ) : (
              <House2D progress={scrollYProgress} />
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
    const fadeIn = isFirst ? 1 : ramp(p, c.from - span * 0.05, c.from + span * 0.18);
    const fadeOut = isLast ? 1 : 1 - ramp(p, c.to - span * 0.18, c.to + span * 0.02);
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
  return (
    <>
      <Panel chapter="hero" progress={progress} active={active}>
        <p className="t-eyebrow lp__eyebrow">Helsinki · live on Etuovi + Vuokraovi</p>
        <h1 id="h-hero" className="t-hero">Stop overpaying for Helsinki flats.</h1>
        <p className="t-body-l lp__sub">
          Every new listing scored against comparable flats, an ML model and Statistics Finland prices, in seconds, with the hidden costs called out.
        </p>
        <div className="lp__odo">
          <Odometer value={data.overpricing} className="t-num-xl" />
          <span className="t-body-s lp__odocap">
            of overpricing spotted this week{data.overpricedCount ? ` across ${data.overpricedCount} flats` : ''}
            {data.source === 'fixtures' && ' (sample data)'}
          </span>
        </div>
        <div className="lp__ctas">
          <CtaButton>Start saving →</CtaButton>
          <a className="lp__ghost" href="#how" onClick={(e) => { e.preventDefault(); onHow(); }}>See how it works</a>
        </div>
        <p className="t-num-s lp__hint" aria-hidden="true">scroll ↓ to watch the money</p>
      </Panel>

      <Panel chapter="price" progress={progress} active={active}>
        <h2 id="h-price" className="t-h1">We know what it’s really worth.</h2>
        <p className="t-body-l lp__sub">
          Comparable flats within 1 km, a model trained on Helsinki listings, and Statistics Finland’s postcode prices, blended into one fair price.
        </p>
      </Panel>

      <Panel chapter="costs" progress={progress} active={active}>
        <h2 id="h-costs" className="t-h1">See the costs they don’t put in the headline.</h2>
        <p className="t-body-l lp__sub">
          We read the renovation plans, the housing company’s papers and local news, so a “cheap” flat with a pipe renovation next year doesn’t look cheap any more.
        </p>
      </Panel>

      <Panel chapter="pricing" progress={progress} active={active}>
        <h2 id="h-pricing" className="t-h1">Three sources. One fair price.</h2>
        <p className="t-body-l lp__sub">
          Every number is shown with where it came from. The blend gets a confidence level, and we publish the model’s error, not just its answer.
        </p>
      </Panel>

      <Panel chapter="live" progress={progress} active={active} className="lp__panel--wide">
        <p className="lp__livepill t-num-s"><LiveDot /> {data.watched ? `${num(data.watched)} flats for sale watched` : 'Watching Etuovi + Vuokraovi'}</p>
        <h2 id="h-live" className="t-h1">Watching Helsinki right now.</h2>
        <p className="t-body-l lp__sub">New listings and price drops are scored within seconds. Good deals light up and land in your inbox.</p>
        <div className="lp__ticker" aria-label="Newest scored listings">
          {data.ticker.slice(0, 6).map((l) => (
            <ListingCard key={l._id} listing={l} now={now} to={`/app/l/${encodeURIComponent(l._id)}`} compact fresh={now - Date.parse(l.first_seen_at) < 60_000} />
          ))}
        </div>
      </Panel>

      <Panel chapter="cta" progress={progress} active={active} className="lp__panel--cta">
        <h2 id="h-cta" className="t-h1">Your savings start here.</h2>
        <div className="lp__ctas">
          <CtaButton variant="primary">Start watching, it’s free →</CtaButton>
          <Link className="lp__ghost" to="/app">See the live map</Link>
        </div>
        <p className="t-body-l lp__sub">Set a search like “2 rooms under €280k in Kallio”. We’ll email you the moment a good deal appears.</p>
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
        <span className="t-eyebrow">Asking{isExample ? ' · example' : ''}</span>
        <span className="t-num-l lp__tagprice">{eur(ask)}</span>
        <span className="lp__stamp t-eyebrow">Overpriced +{(pct * 100).toFixed(0)}%</span>
      </motion.div>
      <motion.div className="lp__fair" style={{ opacity: fairIn, scale: fairScale }} aria-hidden="true">
        <span className="t-eyebrow lp__fairlbl">Fair value · {shortAddress(l)}, {shortDistrict(l)}</span>
        <span className="t-num-l lp__fairprice">{eur(fair)}</span>
        <DealBadge pct={pct} label={`${eur(ask - fair)} too high`} />
      </motion.div>
    </>
  );
}

function FlyingFlags({ progress, data, narrow }: { progress: MotionValue<number>; data: LandingData; narrow: boolean }) {
  const { listing, isExample } = data.costsExample;
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
            <span className="t-num-s lp__quotesrc">{isExample ? 'example listing' : `${listing.portal}.com · ${shortAddress(listing)}`}</span>
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
  const sources = [
    { name: 'Comparables', sub: s?.comps ? `${s.comps.n} flats ≤${Math.round((s.comps.radius_m ?? 1000) / 100) / 10} km` : 'not enough nearby', v: s?.comps?.fair_m2 ?? null },
    { name: 'ML model', sub: s?.model ? `${s.model.version} · MAE ${Math.round(s.model.mae_pct * 100)}%` : 'training', v: s?.model?.fair_m2 ?? null },
    { name: 'Statistics Finland', sub: s?.baseline ? `${s.baseline.postcode} · ${s.baseline.year}` : 'no postcode data', v: s?.baseline?.eur_m2 ?? null },
  ];
  const max = Math.max(...sources.map((x) => x.v ?? 0), 1);
  const beam = useTransform(progress, (p) => -6 + 6 * ramp(p, OVERLAY.beam[0], OVERLAY.beam[1]));
  const show = useTransform(progress, (p) => ramp(p, 0.56, 0.6) * (1 - ramp(p, 0.73, 0.76)));
  if (!s) return null;
  return (
    <motion.div className="lp__towers" style={{ opacity: show }} aria-hidden="true">
      <motion.div className="lp__beam" style={{ rotate: beam }}>
        <span className="t-num-l">Fair {perM2(s.fair_m2, kind)}</span>
        <DealBadge pct={0} label={`confidence: ${s.confidence}`} size="s" />
        {isExample && <span className="t-num-s lp__eg">example listing</span>}
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
