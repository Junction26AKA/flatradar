import { useEffect, useRef } from 'react';
import type { MotionValue } from 'motion/react';
import { COINS, track } from './chapters';

/**
 * Scroll-driven coin rain on one <canvas> (no DOM per coin).
 * - spawn rate = chapter base rate + scroll speed, so scrolling makes it rain
 * - scrolling back up sends falling coins floating up again
 * - coins land on a pile whose height follows the "savings so far" track in chapters.ts
 * - bursts (price tag shattering, CTA click) and the final pour into the piggy bank go through `coinBurst()` / `pourTarget`
 */

type Kind = 'gold' | 'lost';
interface Coin { x: number; y: number; vx: number; vy: number; r: number; phase: number; spin: number; kind: Kind; target?: { x: number; y: number; t: number; x0: number; y0: number; dur: number } }

const bus = new EventTarget();
/** Burst of coins at a viewport point (CSS px). */
export function coinBurst(x: number, y: number, n = 30, kind: Kind = 'gold') {
  bus.dispatchEvent(new CustomEvent('burst', { detail: { x, y, n, kind } }));
}
/** Where pouring coins fly to (viewport CSS px), e.g. the piggy bank's slot. Set by the CTA chapter. */
export const pourTarget: { current: { x: number; y: number } | null } = { current: null };

const PALETTE = {
  gold: { face: '#F2B632', edge: '#B8811A', shine: '#FFE08A' },
  lost: { face: '#8A2A24', edge: '#4E1512', shine: '#C8362E' },
};

// ---- Sprites ---------------------------------------------------------------------------------
// Drawing ellipses + a "€" glyph per coin per frame was the main cost on phones. Instead each coin look is
// rendered once into small offscreen canvases (one per spin step) and blitted with drawImage.
const SPIN_STEPS = 12;
const SPRITE_R = 28; // sprite radius in sprite pixels (scaled down when drawn)

function renderCoinSprite(kind: Kind, widthFrac: number, scale: number): HTMLCanvasElement {
  const c = PALETTE[kind];
  const r = SPRITE_R * scale;
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(r * 2 + 4);
  cv.height = Math.ceil(r * 2.24 + 4);
  const g = cv.getContext('2d')!;
  const x = cv.width / 2, y = r + 2;
  const w = Math.max(0.12, widthFrac) * r;
  g.fillStyle = c.edge;
  g.beginPath(); g.ellipse(x, y + r * 0.12, w, r, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = c.face;
  g.beginPath(); g.ellipse(x, y, w, r, 0, 0, Math.PI * 2); g.fill();
  if (w > r * 0.55) {
    g.strokeStyle = c.edge; g.globalAlpha = 0.55; g.lineWidth = Math.max(1, r * 0.09);
    g.beginPath(); g.ellipse(x, y, w * 0.74, r * 0.74, 0, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = 1;
    g.fillStyle = c.edge;
    g.font = `700 ${Math.round(r * 0.95)}px "Space Grotesk", sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.save(); g.translate(x, y); g.scale(w / r, 1); g.fillText('€', 0, r * 0.05); g.restore();
    g.strokeStyle = c.shine; g.lineWidth = Math.max(1, r * 0.13); g.lineCap = 'round';
    g.beginPath(); g.ellipse(x, y, w * 0.8, r * 0.8, 0, Math.PI * 1.15, Math.PI * 1.45); g.stroke();
  }
  return cv;
}

type Sprites = Record<Kind, HTMLCanvasElement[]>;
function buildSprites(dpr: number): Sprites {
  const steps = (kind: Kind) => Array.from({ length: SPIN_STEPS }, (_, i) => renderCoinSprite(kind, Math.abs(Math.cos((i / SPIN_STEPS) * Math.PI)), dpr));
  return { gold: steps('gold'), lost: steps('lost') };
}

function drawCoin(ctx: CanvasRenderingContext2D, sprites: Sprites, x: number, y: number, r: number, phase: number, kind: Kind) {
  const k = ((Math.floor((phase / Math.PI) * SPIN_STEPS) % SPIN_STEPS) + SPIN_STEPS) % SPIN_STEPS;
  const img = sprites[kind][k];
  const s = r / SPRITE_R;
  const w = (SPRITE_R * 2 + 4) * s; // sprite box in CSS px at this radius (sprite pixels are dpr-scaled)
  const h = w * (img.height / img.width);
  ctx.drawImage(img, x - w / 2, y - r - 2 * s, w, h);
}

/** A flat coin seen from the side, for the pile. */
function drawFlat(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = '#B8811A';
  ctx.beginPath(); ctx.ellipse(x, y + r * 0.18, r, r * 0.34, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#F2B632';
  ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.32, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#FFE08A';
  ctx.beginPath(); ctx.ellipse(x - r * 0.25, y - r * 0.06, r * 0.35, r * 0.09, 0, 0, Math.PI * 2); ctx.fill();
}

interface Props {
  progress: MotionValue<number>;
  /** scroll velocity in px/s */
  velocity: MotionValue<number>;
  /** lighter settings for phones */
  lite?: boolean;
  /** prefers-reduced-motion: no falling coins, just a pile that steps per chapter */
  still?: boolean;
}

export function CoinRain({ progress, velocity, lite = false, still = false }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    const CAP = lite ? 40 : 110;
    const COLS = lite ? 22 : 56;
    let w = 0, h = 0, dpr = 1;
    const coins: Coin[] = [];
    const pile = new Float32Array(COLS); // current height of each pile column (px)
    const noise = Array.from({ length: COLS }, (_, i) => 0.6 + 0.4 * Math.sin(i * 1.7) * Math.sin(i * 0.43 + 1) + 0.25 * Math.sin(i * 0.9));
    let spawnDebt = 0;
    let last = performance.now();
    let raf = 0;
    let lastP = progress.get();
    let sprites: Sprites | null = null;
    // The pile changes slowly: draw it into its own layer and only redraw when a column moved > 1.5 px.
    const pileCv = document.createElement('canvas');
    const pileCtx = pileCv.getContext('2d')!;
    const drawnPile = new Float32Array(COLS).fill(-1);

    const resize = () => {
      // Phones: 1.5x is visually the same for moving coins and ~45% fewer pixels to fill than 2x/3x.
      const nextDpr = Math.min(window.devicePixelRatio || 1, lite ? 1.5 : 2);
      const nw = canvas.clientWidth, nh = canvas.clientHeight;
      if (nw === w && nh === h && nextDpr === dpr && sprites) return; // nothing changed (avoid clearing the canvas)
      w = nw; h = nh;
      if (nextDpr !== dpr || !sprites) { dpr = nextDpr; sprites = buildSprites(dpr); }
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      pileCv.width = canvas.width; pileCv.height = canvas.height;
      pileCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawnPile.fill(-1);
    };
    resize();
    // The "€" is drawn in Space Grotesk: rebuild the sprites once the web font has loaded.
    document.fonts?.ready.then(() => { sprites = buildSprites(dpr); }).catch(() => {});
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const radius = () => (lite ? 9 : 12) + Math.random() * (lite ? 6 : 9);
    const spawn = (kind: Kind, x = Math.random() * w, y = -30, vx = (Math.random() - 0.5) * 30, vy = 40 + Math.random() * 80) => {
      if (coins.length >= CAP) coins.shift();
      coins.push({ x, y, vx, vy, r: radius(), phase: Math.random() * Math.PI, spin: 4 + Math.random() * 6, kind });
    };

    const onBurst = (e: Event) => {
      const { x, y, n, kind } = (e as CustomEvent).detail;
      if (still) return;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = 120 + Math.random() * 380;
        spawn(kind, x, y, Math.cos(a) * s, Math.sin(a) * s - 260);
      }
    };
    bus.addEventListener('burst', onBurst);

    const colX = (i: number) => (i + 0.5) * (w / COLS);
    const colAt = (x: number) => Math.max(0, Math.min(COLS - 1, Math.floor((x / w) * COLS)));

    const frame = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const p = progress.get();
      const vel = velocity.get() / Math.max(1, h); // viewport heights per second, signed
      const lost = COINS.lost(p);
      const gravity = lost ? 1500 : 1000;
      const pileTarget = track(COINS.pile, p) * h;

      // shatter: crossing the threshold going down
      if (lastP < COINS.shatterAt && p >= COINS.shatterAt && !still) {
        const tag = document.querySelector('[data-fx="tag"]')?.getBoundingClientRect();
        if (tag) for (let i = 0; i < 2; i++) bus.dispatchEvent(new CustomEvent('burst', { detail: { x: tag.left + tag.width / 2, y: tag.top + tag.height / 2, n: 18, kind: 'gold' } }));
      }
      lastP = p;

      // spawn
      if (!still) {
        const rate = track(COINS.baseRate, p) + Math.max(0, vel) * COINS.velocityRate * (lite ? 0.4 : 1);
        spawnDebt += rate * dt;
        while (spawnDebt >= 1) { spawnDebt -= 1; spawn(lost ? 'lost' : 'gold'); }
      }

      // pile follows its target (slowly, like coins settling); pours into the piggy bank at the end
      const pouring = p > COINS.pour[0] && p < COINS.pour[1] && pourTarget.current;
      for (let i = 0; i < COLS; i++) {
        const target = pileTarget * noise[i];
        const before = pile[i];
        pile[i] += (target - pile[i]) * Math.min(1, dt * (target < pile[i] ? 3 : 1.2));
        if (pouring && !still && before - pile[i] > 0.6 && Math.random() < 0.35) {
          const to = pourTarget.current!;
          const c: Coin = { x: colX(i), y: h - pile[i], vx: 0, vy: 0, r: radius(), phase: 0, spin: 8, kind: 'gold' };
          c.target = { x: to.x, y: to.y, t: 0, x0: c.x, y0: c.y, dur: 0.7 + Math.random() * 0.5 };
          if (coins.length < CAP) coins.push(c);
        }
      }

      ctx.clearRect(0, 0, w, h);

      // falling coins
      for (let i = coins.length - 1; i >= 0; i--) {
        const c = coins[i];
        c.phase += c.spin * dt;
        if (c.target) {
          // arc into the bank's slot
          const tg = c.target;
          tg.t += dt / tg.dur;
          const s = Math.min(1, tg.t);
          c.x = tg.x0 + (tg.x - tg.x0) * s;
          c.y = tg.y0 + (tg.y - tg.y0) * s - Math.sin(s * Math.PI) * 220;
          c.r *= 1 - dt * 0.6;
          if (s >= 1) { coins.splice(i, 1); continue; }
        } else {
          // scrolling up makes the rain float back up
          const lift = vel < -0.15 ? vel * 1400 : 0;
          c.vy += (gravity + lift) * dt;
          c.vx *= 1 - dt * 0.6;
          c.x += c.vx * dt;
          c.y += c.vy * dt;
          const col = colAt(c.x);
          const floor = h - pile[col] - c.r * 0.3;
          if (c.y > floor && c.vy > 0) {
            // landed: becomes part of the pile (the pile's target decides how big it gets)
            if (c.kind === 'gold') pile[col] = Math.min(pile[col] + 2, h * 0.3);
            coins.splice(i, 1);
            continue;
          }
          if (c.y < -80 && c.vy < 0) { coins.splice(i, 1); continue; }
          if (c.x < -40 || c.x > w + 40) { coins.splice(i, 1); continue; }
        }
        drawCoin(ctx, sprites!, c.x, c.y, c.r, c.phase, c.kind);
      }

      // pile: stacked flat coins per column, back to front (cached layer)
      let dirty = false;
      for (let i = 0; i < COLS; i++) if (Math.abs(pile[i] - drawnPile[i]) > 1.5) { dirty = true; break; }
      if (dirty) {
        pileCtx.clearRect(0, 0, w, h);
        const r = (w / COLS) * 0.72;
        const step = r * 0.42;
        for (let i = 0; i < COLS; i++) {
          drawnPile[i] = pile[i];
          const height = pile[i];
          if (height < 2) continue;
          const x = colX(i) + Math.sin(i * 12.9) * r * 0.25;
          for (let y = h + r * 0.1; y > h - height; y -= step) drawFlat(pileCtx, x + Math.sin(y * 0.13 + i) * r * 0.12, y, r);
        }
      }
      ctx.drawImage(pileCv, 0, 0, w, h);

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const onVis = () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else { last = performance.now(); raf = requestAnimationFrame(frame); }
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      bus.removeEventListener('burst', onBurst);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [progress, velocity, lite, still]);

  return <canvas ref={ref} className="coinrain" aria-hidden="true" />;
}
