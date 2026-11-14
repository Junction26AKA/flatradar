// Cloudinary delivery URLs for listing photos (lib/media on the server uploads them).
// The cloud name travels with the data (`listing.media.cloud`), so the web build needs no Cloudinary env vars
// and never sees an API key. Patterns follow the Cloudinary React skill: one cached `Cloudinary` instance,
// fill + auto gravity, and f_auto/q_auto on every delivery.
import { Cloudinary, type CloudinaryImage } from '@cloudinary/url-gen';
import { fill, limitFit } from '@cloudinary/url-gen/actions/resize';
import { format, quality } from '@cloudinary/url-gen/actions/delivery';
import { auto } from '@cloudinary/url-gen/qualifiers/format';
import { auto as autoQuality } from '@cloudinary/url-gen/qualifiers/quality';
import { autoGravity } from '@cloudinary/url-gen/qualifiers/gravity';
import { generativeRecolor, generativeReplace } from '@cloudinary/url-gen/actions/effect';
import { improve } from '@cloudinary/url-gen/actions/adjust';
import type { Listing, MediaPhoto, PhotoRoom } from './types';

const instances = new Map<string, Cloudinary>();
export function cldFor(cloudName: string): Cloudinary {
  let c = instances.get(cloudName);
  if (!c) {
    c = new Cloudinary({ cloud: { cloudName }, url: { secure: true } });
    instances.set(cloudName, c);
  }
  return c;
}

/** The listing's photos once they're in Cloudinary (empty until the photo pass has run). */
export const mediaPhotos = (l: Pick<Listing, 'media'>): MediaPhoto[] => (l.media?.status === 'ok' ? l.media.photos : []);

const INTERIOR = new Set<PhotoRoom>(['room', 'kitchen', 'bathroom']);

/** Best cover photo: an interior shot rather than a floor plan or the street. */
export function coverPhoto(l: Pick<Listing, 'media'>): MediaPhoto | null {
  const photos = mediaPhotos(l);
  return photos.find((p) => INTERIOR.has(p.room)) ?? photos.find((p) => p.room !== 'plan') ?? photos[0] ?? null;
}

const optimise = (img: CloudinaryImage) => img.delivery(format(auto())).delivery(quality(autoQuality()));

/** Smart-cropped thumbnail (auto gravity keeps the interesting part of the room in frame). */
export const thumb = (cloud: string, p: MediaPhoto, w: number, h: number) =>
  optimise(cldFor(cloud).image(p.public_id).resize(fill().width(w).height(h).gravity(autoGravity())));

/** Full photo, never upscaled. */
export const large = (cloud: string, p: MediaPhoto, w = 1400) =>
  optimise(cldFor(cloud).image(p.public_id).resize(limitFit().width(w).height(w)));

/**
 * What "See it renovated" means: a full cosmetic refresh of that room in one consistent, current Nordic style
 * (light oak, soft sage-grey paint, sage cabinets, matte black or brushed brass details), not just one surface.
 * Each step is a generative effect on the original photo, applied in order; `preserveGeometry` keeps the room's
 * layout. `label` is the message key listed under the preview, so the user can see exactly what changed.
 *
 * `core` steps target something that is in every photo of that room type (floor, walls, kitchen cabinets).
 * The others (tiles, vanity, doors, ceiling light) only work when the photo shows them: Cloudinary doesn't skip
 * a replace whose target is missing, it stays at 423 "processing" indefinitely. So the web app asks for the full
 * version and falls back to the core-only version if the full one isn't back in time (see ListingPhotos).
 * Cloudinary runs the steps one after another, about 10-25 s each.
 *
 * Tiles only ever go on existing ceramic tiles in a bathroom: kitchens include open-plan living rooms, so a
 * "wall tiles" prompt there would tile ordinary walls.
 */
type RenoStep = ({ replace: string; with: string } | { recolor: string; to: string }) & { label: RenoLabel; core?: true };
export type RenoLabel = 'floor' | 'walls' | 'doors' | 'cabinets' | 'tiles' | 'vanity' | 'bathFloor' | 'light';
const OAK_FLOOR: RenoStep = { replace: 'floor', with: 'wide light oak plank floor with a matte finish', label: 'floor', core: true };
// Recolor prompt is plain 'walls': 'painted walls' never finished on some kitchen photos (stuck at 423 for 10+ min).
// Soft sage grey: visibly not the old white, and stays neutral after the indoor colour correction.
const PAINT: RenoStep = { recolor: 'walls', to: '#C5CABD', label: 'walls', core: true };
export const RENOVATION_STEPS: Partial<Record<PhotoRoom, RenoStep[]>> = {
  kitchen: [
    { replace: 'kitchen cabinet doors', with: 'matte sage green flat-panel kitchen cabinet doors with slim brushed brass handles', label: 'cabinets', core: true },
    OAK_FLOOR,
    PAINT,
  ],
  bathroom: [
    { replace: 'ceramic wall tiles', with: 'large warm white matte porcelain wall tiles with thin light grey grout', label: 'tiles' },
    { replace: 'bathroom floor', with: 'dark grey matte stone-look floor tiles', label: 'bathFloor', core: true },
    { replace: 'washbasin and the cabinet under it', with: 'a floating light oak vanity with a white ceramic basin and a brushed brass tap', label: 'vanity' },
    PAINT, // on tiled walls this only changes their colour, never adds tiles
  ],
  room: [
    OAK_FLOOR,
    PAINT,
    { replace: 'interior doors', with: 'white flat-panel interior doors with matte black handles', label: 'doors' },
    { replace: 'ceiling light', with: 'a large white paper globe pendant lamp', label: 'light' },
  ],
};

const stepsFor = (p: MediaPhoto, core: boolean) => (RENOVATION_STEPS[p.room] ?? []).filter((s) => !core || s.core);

/** Whether the full renovation has steps beyond the core ones (so a core-only fallback is worth asking for). */
export const hasOptionalSteps = (p: MediaPhoto) => stepsFor(p, false).length > stepsFor(p, true).length;

/** What the preview changes for this photo, in order (empty when it gets no preview). */
export const renovationChanges = (p: MediaPhoto, core = false): RenoLabel[] => stepsFor(p, core).map((s) => s.label);

/**
 * Whether a photo gets the renovation preview: an interior room we know about. `room_by` is set by the photo
 * pass when Gemini (or AI Vision, on a positive tag) actually classified the photo. Older data without it is
 * not trusted, even if AI Vision read it: its 'room' was the default for "no room tag", facades included.
 */
export const canRenovate = (p: MediaPhoto) => !!RENOVATION_STEPS[p.room] && p.room_by != null;

/**
 * Same photo, renovated by generative AI: every step for its room, or only the `core` ones.
 * Expensive (≈120 transformations per step) and slow the first time, so only on demand.
 */
export function renovated(cloud: string, p: MediaPhoto, { core = false, w = 1400 } = {}): CloudinaryImage | null {
  const steps = stepsFor(p, core);
  if (!steps.length || !canRenovate(p)) return null;
  let img = cldFor(cloud).image(p.public_id);
  for (const s of steps) {
    img = 'replace' in s
      ? img.effect(generativeReplace().from(s.replace).to(s.with).preserveGeometry(true))
      : img.effect(generativeRecolor(s.recolor, s.to));
  }
  // Even out the listing photo's lighting so the new surfaces don't look pasted in.
  return optimise(img.adjust(improve().mode('indoor')).resize(limitFit().width(w).height(w)));
}

