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
 * "After renovation" looks per room type: one consistent, current Nordic style (light oak, warm whites,
 * one muted colour accent), so the preview reads as a believable refresh rather than a different flat.
 * Each step is one generative effect on the original photo; `preserveGeometry` keeps the room's layout.
 * Two changes per room is where it starts to look renovated without drifting into a showroom render.
 */
type RenoStep = { replace: string; with: string } | { recolor: string; to: string };
export const RENOVATION_STEPS: Partial<Record<PhotoRoom, RenoStep[]>> = {
  kitchen: [
    { replace: 'kitchen cabinet doors', with: 'matte sage green flat-panel kitchen cabinet doors with slim brushed brass handles' },
    { replace: 'kitchen wall tiles above the worktop', with: 'glossy off-white handmade rectangular wall tiles' },
  ],
  bathroom: [
    { replace: 'bathroom wall tiles', with: 'large warm white matte porcelain wall tiles with thin light grey grout' },
    { replace: 'washbasin and the cabinet under it', with: 'a floating light oak vanity with a white ceramic basin and a brushed brass tap' },
  ],
  room: [
    { replace: 'floor', with: 'light oak herringbone parquet floor' },
    { recolor: 'walls', to: '#E8E1D5' },
  ],
};

/**
 * Whether a photo gets the renovation preview: an interior room we know about. `room_by` is set by the photo
 * pass when Gemini (or AI Vision, on a positive tag) actually classified the photo. Older data without it is
 * not trusted, even if AI Vision read it: its 'room' was the default for "no room tag", facades included.
 */
export const canRenovate = (p: MediaPhoto) => !!RENOVATION_STEPS[p.room] && p.room_by != null;

/** Same photo, renovated by generative AI. Expensive (≈2 × 120 transformations) and slow the first time, so only on demand. */
export function renovated(cloud: string, p: MediaPhoto, w = 1400): CloudinaryImage | null {
  const steps = RENOVATION_STEPS[p.room];
  if (!steps || !canRenovate(p)) return null;
  let img = cldFor(cloud).image(p.public_id);
  for (const s of steps) {
    img = 'replace' in s
      ? img.effect(generativeReplace().from(s.replace).to(s.with).preserveGeometry(true))
      : img.effect(generativeRecolor(s.recolor, s.to));
  }
  // Even out the listing photo's lighting so the new surfaces don't look pasted in.
  return optimise(img.adjust(improve().mode('indoor')).resize(limitFit().width(w).height(w)));
}

/** Same-origin share card (the server redirects to the Cloudinary overlay URL). */
export const shareCardPath = (id: string) => `/api/listings/${encodeURIComponent(id)}/card`;
