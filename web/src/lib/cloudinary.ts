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
import { generativeReplace } from '@cloudinary/url-gen/actions/effect';
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

/** Best cover photo: an interior shot rather than a floor plan or the street. */
export function coverPhoto(l: Pick<Listing, 'media'>): MediaPhoto | null {
  const photos = mediaPhotos(l);
  return photos.find((p) => p.room !== 'plan' && p.room !== 'exterior') ?? photos[0] ?? null;
}

const optimise = (img: CloudinaryImage) => img.delivery(format(auto())).delivery(quality(autoQuality()));

/** Smart-cropped thumbnail (auto gravity keeps the interesting part of the room in frame). */
export const thumb = (cloud: string, p: MediaPhoto, w: number, h: number) =>
  optimise(cldFor(cloud).image(p.public_id).resize(fill().width(w).height(h).gravity(autoGravity())));

/** Full photo, never upscaled. */
export const large = (cloud: string, p: MediaPhoto, w = 1400) =>
  optimise(cldFor(cloud).image(p.public_id).resize(limitFit().width(w).height(w)));

/**
 * "After renovation" prompts per room type, for Cloudinary generative replace. Kept short and concrete:
 * gen_replace swaps one kind of object, so each prompt names the object most renovations would change.
 */
export const RENOVATION_PROMPTS: Partial<Record<PhotoRoom, { from: string; to: string }>> = {
  kitchen: { from: 'kitchen cabinets', to: 'modern white flat-panel kitchen cabinets with a light oak worktop' },
  bathroom: { from: 'bathroom wall tiles', to: 'new large light grey porcelain wall tiles' },
  room: { from: 'floor', to: 'new light oak parquet floor' },
};

/** Same photo, renovated by generative AI. Expensive (≈120 transformations) and slow the first time, so only on demand. */
export function renovated(cloud: string, p: MediaPhoto, w = 1400): CloudinaryImage | null {
  const prompt = RENOVATION_PROMPTS[p.room];
  if (!prompt) return null;
  return optimise(
    cldFor(cloud).image(p.public_id)
      .effect(generativeReplace().from(prompt.from).to(prompt.to).preserveGeometry(true))
      .resize(limitFit().width(w).height(w)),
  );
}

/** Same-origin share card (the server redirects to the Cloudinary overlay URL). */
export const shareCardPath = (id: string) => `/api/listings/${encodeURIComponent(id)}/card`;
