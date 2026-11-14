/**
 * The landing page's scroll choreography in one place (Figma "Landing /" storyboard).
 * Everything that moves reads scroll progress p ∈ [0, 1] and looks its values up here, so timing is tuned
 * by editing numbers in this file, not by hunting through components.
 */

export interface Chapter { id: string; from: number; to: number; bg: string; ink: 'light' | 'dark' }

export const CHAPTERS: Chapter[] = [
  { id: 'hero', from: 0, to: 0.15, bg: '#002F6C', ink: 'light' },
  { id: 'price', from: 0.15, to: 0.35, bg: '#FFFFFF', ink: 'dark' },
  { id: 'costs', from: 0.35, to: 0.55, bg: '#002F6C', ink: 'light' },
  { id: 'pricing', from: 0.55, to: 0.75, bg: '#E8EEF6', ink: 'dark' },
  { id: 'live', from: 0.75, to: 0.9, bg: '#FFFFFF', ink: 'dark' },
  { id: 'cta', from: 0.9, to: 1, bg: '#FFFFFF', ink: 'dark' },
];

/** Piecewise-linear lookup: keys = [[p, value], ...] sorted by p. Clamped at both ends. */
export function track(keys: [number, number][], p: number): number {
  if (p <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [p1, v1] = keys[i];
    if (p <= p1) {
      const [p0, v0] = keys[i - 1];
      const t = (p - p0) / (p1 - p0 || 1);
      const s = t * t * (3 - 2 * t); // smoothstep between keys: no sharp corners in the motion
      return v0 + (v1 - v0) * s;
    }
  }
  return keys[keys.length - 1][1];
}

/** 0→1 over [a, b], clamped. */
export const ramp = (p: number, a: number, b: number) => Math.min(1, Math.max(0, (p - a) / (b - a)));

const TAU = Math.PI * 2;

/** House (3D, and the 2.5D fallback) */
export const HOUSE = {
  // Y rotation: idle spin in the hero, face the camera for the price tag, turn to the back for costs,
  // three-quarter for pricing, and one full turn overall as the page scrolls.
  rotY: [[0, -0.35], [0.12, 0.2], [0.2, 0], [0.3, 0], [0.42, Math.PI], [0.52, Math.PI], [0.62, Math.PI + 0.7], [0.75, TAU - 0.4], [0.9, TAU], [1, TAU]] as [number, number][],
  // x position in world units (desktop: text on the left, house on the right)
  x: [[0, 2.4], [0.3, 2.4], [0.42, 2.6], [0.55, 2.6], [0.65, -4.2], [0.75, -4.2], [0.82, 5], [1, 5]] as [number, number][],
  y: [[0, -0.2], [0.55, -0.2], [0.65, -1.9], [0.75, -1.9], [0.82, -0.9], [1, -0.9]] as [number, number][],
  scale: [[0, 1], [0.2, 1.08], [0.3, 1.08], [0.42, 1.22], [0.52, 1.22], [0.62, 0.5], [0.75, 0.5], [0.82, 0.45], [0.9, 0.45], [0.95, 0], [1, 0]] as [number, number][],
  crackGlow: [[0, 0], [0.4, 0], [0.45, 1], [0.53, 1], [0.58, 0], [1, 0]] as [number, number][],
};

/** Camera: tilts to look straight down for the live map chapter. */
export const CAMERA = {
  y: [[0, 1.2], [0.75, 1.2], [0.84, 26], [0.9, 26], [0.95, 1.2], [1, 1.2]] as [number, number][],
  z: [[0, 14], [0.42, 13], [0.52, 12.2], [0.6, 14], [0.75, 14], [0.84, 2.5], [0.9, 2.5], [0.95, 14], [1, 14]] as [number, number][],
};

/** Mini houses on the live map (0 = hidden, 1 = fully popped up). */
export const MINI = [[0, 0], [0.78, 0], [0.84, 1], [0.9, 1], [0.93, 0], [1, 0]] as [number, number][];

/** Coin rain */
export const COINS = {
  /** coins per second at rest; scroll velocity adds more */
  baseRate: [[0, 4], [0.15, 2], [0.35, 0], [0.55, 0.5], [0.75, 1], [0.9, 0], [1, 0]] as [number, number][],
  /** extra coins per second per (viewport heights per second) of scroll speed */
  velocityRate: 16,
  /** "lost money" (dark red, heavier) instead of gold */
  lost: (p: number) => p > 0.38 && p < 0.55,
  /** pile height as a fraction of the viewport height: grows with savings, shrinks with hidden costs, pours into the bank at the end */
  pile: [[0, 0.05], [0.15, 0.07], [0.3, 0.16], [0.42, 0.16], [0.52, 0.1], [0.62, 0.07], [0.85, 0.11], [0.93, 0.12], [0.975, 0], [1, 0]] as [number, number][],
  /** the price tag shatters into a burst of coins when scrolling down past this point */
  shatterAt: 0.255,
  /** coins pour from the pile into the piggy bank in this range */
  pour: [0.93, 0.975] as [number, number],
};

/** DOM overlays per chapter (all in progress units) */
export const OVERLAY = {
  tag: { in: [0.16, 0.2] as [number, number], shatter: 0.255, fair: [0.27, 0.31] as [number, number] },
  flags: [0.43, 0.5] as [number, number],
  towers: [0.58, 0.7] as [number, number],
  beam: [0.68, 0.74] as [number, number],
  flag: [0.895, 0.925] as [number, number],
  /** CTA copy appears once the flag's band is behind it (white headline needs the blue band) */
  ctaText: [0.915, 0.935] as [number, number],
};

/**
 * Where the nav links land: the point where that chapter's visuals have settled (not its first frame, where the
 * house, camera and overlays are still mid-transition). Checked against HOUSE/CAMERA/MINI/OVERLAY above.
 */
export const ANCHOR: Record<'price' | 'pricing' | 'live', number> = {
  price: 0.22, // tag fully swung in (OVERLAY.tag.in ends at 0.2), before it shatters at 0.255
  pricing: 0.71, // towers mostly built (0.58–0.74), panel not yet fading (fade-out starts ≈0.718)
  live: 0.86, // camera fully top-down and mini map up (0.84–0.9)
};

export const chapterAt = (p: number) => CHAPTERS.find((c) => p >= c.from && p < c.to) ?? CHAPTERS[CHAPTERS.length - 1];
