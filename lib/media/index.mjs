// Listing photos through Cloudinary (Junction 2026 "Best Use of Cloudinary").
//   1. ingest:  copy each listing photo into our Cloudinary account (generative AI effects don't run on
//               fetched images, and a stable public_id lets the web app build any size it needs).
//   2. analyse: Cloudinary AI Vision (tagging mode) reads every photo against our own condition taxonomy:
//               dated kitchen, original bathroom, worn floors, damp, worn facade, fresh renovation.
//   3. flags:   those tags become `photo_condition` flags next to the renovation-text and PDF flags, each
//               linked to the photo it came from.
// Needs CLOUDINARY_URL (cloudinary://<key>:<secret>@<cloud>) and the AI Vision add-on for step 2.
// Without CLOUDINARY_URL everything here is a no-op.
import { createHash } from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import getDb from '../db.mjs';
import { publish } from '../bus.mjs';

export const mediaEnabled = !!process.env.CLOUDINARY_URL?.trim();
const cfg = () => cloudinary.config();
export const cloudName = () => (mediaEnabled ? cfg().cloud_name : null);

const MAX_PHOTOS = 8;
// AI Vision is billed in add-on tokens: the first few photos (kitchen, bathroom, living room) carry the story.
const ANALYSE_PHOTOS = Number(process.env.CLOUDINARY_VISION_PHOTOS ?? 4);

/** "etuovi:20828740" → "flatradar/listings/etuovi-20828740" */
const folderFor = (id) => `flatradar/listings/${String(id).replace(/[^\w-]+/g, '-')}`;

/** Public id if `url` is already an image in our own account (e.g. uploaded with the widget on /mock). */
export function ownPublicId(url) {
  const name = cloudName();
  if (!name || typeof url !== 'string') return null;
  // Upload results (and the widget) always give versioned URLs: .../image/upload/[transformations/]v123/<public_id>.<ext>
  const m = url.match(new RegExp(`^https?://res\\.cloudinary\\.com/${name}/image/upload/(?:.*?/)?v\\d+/(.+?)(?:\\.[a-z0-9]+)?$`, 'i'));
  return m ? decodeURIComponent(m[1]) : null;
}

/** Delivery URL helpers (server side; the web app builds its own with @cloudinary/url-gen). */
export const photoUrl = (publicId, t = 'c_limit,w_1024/f_auto/q_auto') => cloudinary.url(publicId, { secure: true, raw_transformation: t });
const analysisUrl = (publicId) => cloudinary.url(publicId, { secure: true, raw_transformation: 'c_limit,w_1024/q_auto/f_jpg' });

/** Short stable id for a source photo URL, so a public id always means the same image. */
const photoKey = (url) => createHash('sha1').update(url).digest('hex').slice(0, 12);

/**
 * Copy a listing's photos into Cloudinary. Idempotent: public ids are derived from the listing id and a hash
 * of the source URL (not its position, which shifts when the gallery changes), and existing assets are kept
 * (overwrite: false).
 * @returns {Promise<{public_id, width, height, source_url}[]>}
 */
export async function ingestPhotos(listing) {
  const urls = [...new Set((listing.photos ?? []).filter((u) => typeof u === 'string' && /^https?:\/\//.test(u) && !isJunkPhotoUrl(u)))].slice(0, MAX_PHOTOS);
  const folder = folderFor(listing._id);
  const out = await Promise.all(urls.map(async (url, i) => {
    const own = ownPublicId(url);
    try {
      if (own) {
        const r = await cloudinary.api.resource(own);
        return { public_id: r.public_id, width: r.width, height: r.height, source_url: url };
      }
      const r = await cloudinary.uploader.upload(url, {
        public_id: `${folder}/${photoKey(url)}`, overwrite: false, unique_filename: false, resource_type: 'image',
        tags: ['flatradar', listing.kind, listing.portal].filter(Boolean),
        context: { listing: listing._id, source: url },
      });
      return { public_id: r.public_id, width: r.width, height: r.height, source_url: url };
    } catch (e) {
      console.error(`cloudinary upload ${listing._id} #${i} failed:`, e.message ?? e.error?.message);
      return null;
    }
  }));
  return out.filter(Boolean);
}

/**
 * Gallery photos from a Context.dev `images` scrape (with dimensions + classification enrichment): real
 * photographs, reasonably large, not logos, agent portraits, maps or banners. At most 12, page order.
 */
// /static/ = the portal's own site images (marketing banners on every listing page), never listing photos.
// adnxs/doubleclick/getuid = ad-tracking pixels; wordpress = the portal's blog articles linked from the page.
const JUNK = /adnxs\.com|doubleclick|getuid|wordpress\.|\/static\/|logo|icon|avatar|agent|broker|sprite|placeholder|banner|badge|[/_-]qr[/_.-]|[/_-]maps?[/_.-]|\.svg(\?|$)/i;
/** Photo URL that is clearly not a listing photo (logo, ad pixel, site banner, blog image). */
export const isJunkPhotoUrl = (url) => JUNK.test(url);

export function pickPhotos(images = []) {
  const seen = new Set();
  const out = [];
  for (const im of images) {
    const url = im?.url;
    if (typeof url !== 'string' || !/^https:\/\//.test(url) || JUNK.test(url)) continue;
    if (im.classification && im.classification !== 'photography') continue;
    if (im.width && im.height && (Math.min(im.width, im.height) < 400 || im.width / im.height > 3 || im.height / im.width > 3)) continue;
    const key = url.replace(/[?#].*$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
    if (out.length >= 12) break;
  }
  return out;
}

// ---------- AI Vision ----------
// Max 10 definitions per request. Room tags pick the right "after renovation" preview in the web app;
// condition tags become flags.
const TAGS = [
  { name: 'kitchen', description: 'The photo shows a kitchen or kitchenette.' },
  { name: 'bathroom', description: 'The photo shows a bathroom, toilet or sauna.' },
  { name: 'exterior', description: 'The photo shows the outside of the building: facade, balconies, yard or street.' },
  { name: 'floor_plan', description: 'The image is a floor plan drawing or a map, not a photo.' },
  { name: 'dated_kitchen', description: 'A kitchen whose cabinets, countertops or appliances look clearly old-fashioned or worn, as if not renovated in about 20 years or more.' },
  { name: 'dated_bathroom', description: 'A bathroom with clearly old tiles, old fixtures, a plastic floor mat or other signs it has not been renovated in decades.' },
  { name: 'worn_floor', description: 'Floors that look visibly worn, scratched, stained, or old linoleum or carpet.' },
  { name: 'damp_damage', description: 'Visible water stains, mould, damp marks, or peeling or bubbling paint on walls or ceilings.' },
  { name: 'worn_facade', description: 'The building facade, balconies or windows look worn, cracked, rusty or in poor condition.' },
  { name: 'fresh_renovation', description: 'The room looks recently renovated, with new and modern surfaces and fixtures throughout.' },
];

async function visionTags(publicId) {
  const { cloud_name, api_key, api_secret } = cfg();
  const res = await fetch(`https://api.cloudinary.com/v2/analysis/${cloud_name}/analyze/ai_vision_tagging`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${api_key}:${api_secret}`).toString('base64')}` },
    // AI Vision tag names may only use lower-case letters, digits and hyphens; we use underscores everywhere else.
    body: JSON.stringify({ source: { uri: analysisUrl(publicId) }, tag_definitions: TAGS.map((t) => ({ ...t, name: t.name.replace(/_/g, '-') })) }),
    signal: AbortSignal.timeout(45_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`ai_vision ${res.status}: ${[body?.error?.message, body?.error?.details?.message].filter(Boolean).join(': ') || JSON.stringify(body).slice(0, 200)}`);
  return (body?.data?.analysis?.tags ?? []).map((t) => t.name.replace(/-/g, '_'));
}

/** Typical Helsinki costs, used only as a rough order of magnitude and labelled as such on the flag. */
const COST = { kitchen: 15000, bathroom: 15000, floor_m2: 50 };

/**
 * Turn per-photo tags into flags (docs/contracts.md §3, type `photo_condition`, origin `photos`).
 * One flag per condition, pointing at the first photo that shows it.
 */
export function photoFlags(listing, photos) {
  const first = (tag) => photos.findIndex((p) => p.tags?.includes(tag));
  const hasPipeReno = (listing.flags ?? []).some((f) => f.type === 'pipe_renovation' && !/done/i.test(f.label));
  const out = [];
  const add = (tag, f) => {
    const i = first(tag);
    if (i < 0) return;
    const p = photos[i];
    out.push({
      id: `photo-${tag}`, type: 'photo_condition', year: null, status: 'ok', origin: 'photos', photo: i,
      source: { kind: 'photo', url: photoUrl(p.public_id), quote: TAGS.find((t) => t.name === tag).description, page: i + 1 },
      ...f,
    });
  };
  add('dated_kitchen', { severity: 'warn', label: 'Kitchen looks dated', label_fi: 'Keittiö näyttää vanhalta', est_cost_eur: COST.kitchen,
    detail: 'From the listing photos. A typical kitchen renovation in Helsinki costs roughly €10k–25k.',
    detail_fi: 'Ilmoituksen kuvista. Keittiöremontti maksaa Helsingissä tyypillisesti noin 10–25 t€.' });
  add('dated_bathroom', hasPipeReno
    ? { severity: 'info', label: 'Bathroom looks dated', label_fi: 'Kylpyhuone näyttää vanhalta', est_cost_eur: null,
      detail: 'From the listing photos. The planned pipe renovation will redo it anyway.', detail_fi: 'Ilmoituksen kuvista. Tuleva putkiremontti uusii sen joka tapauksessa.' }
    : { severity: 'warn', label: 'Bathroom looks dated', label_fi: 'Kylpyhuone näyttää vanhalta', est_cost_eur: COST.bathroom,
      detail: 'From the listing photos. A bathroom renovation in Helsinki typically costs roughly €12k–20k.', detail_fi: 'Ilmoituksen kuvista. Kylpyhuoneremontti maksaa Helsingissä tyypillisesti noin 12–20 t€.' });
  add('worn_floor', { severity: 'info', label: 'Floors look worn', label_fi: 'Lattiat näyttävät kuluneilta', est_cost_eur: listing.m2 ? Math.round((COST.floor_m2 * listing.m2) / 100) * 100 : null,
    detail: 'From the listing photos. New flooring costs roughly €40–60/m² fitted.', detail_fi: 'Ilmoituksen kuvista. Uusi lattia maksaa asennettuna noin 40–60 €/m².' });
  add('damp_damage', { severity: 'high', label: 'Possible damp in photos', label_fi: 'Mahdollinen kosteusjälki kuvissa', est_cost_eur: null,
    detail: 'A photo shows what looks like water stains, mould or peeling paint. Ask for a moisture survey.', detail_fi: 'Kuvassa näyttää olevan vesivahinkoa, hometta tai hilseilevää maalia. Pyydä kosteusmittaus.' });
  add('worn_facade', { severity: 'warn', label: 'Facade looks worn', label_fi: 'Julkisivu näyttää kuluneelta', est_cost_eur: null,
    detail: 'From the exterior photos. Check the maintenance plan for a facade renovation.', detail_fi: 'Ulkokuvista. Tarkista kunnossapitosuunnitelmasta julkisivuremontti.' });
  add('fresh_renovation', { severity: 'info', label: 'Recently renovated (photos)', label_fi: 'Äskettäin remontoitu (kuvat)', est_cost_eur: null,
    detail: 'At least one room looks newly renovated in the photos.', detail_fi: 'Ainakin yksi huone näyttää kuvissa vasta remontoidulta.' });
  return out;
}

const roomOf = (tags) => (tags.includes('kitchen') ? 'kitchen' : tags.includes('bathroom') ? 'bathroom' : tags.includes('exterior') ? 'exterior' : tags.includes('floor_plan') ? 'plan' : 'room');

/**
 * Full photo pass for one listing: ingest, analyse, write `media` and the photo flags, publish the patch.
 * Never throws. Runs after the listing is `ready` (like the Gemini analyst), so it never delays the card.
 * @param {{vision?: boolean}} [opts]  vision: false = upload and show photos without AI Vision (saves add-on tokens)
 */
export async function processListingPhotos(id, { vision } = {}) {
  if (!mediaEnabled) return null;
  const db = await getDb();
  const t0 = Date.now();
  try {
    const listing = await db.collection('listings').findOne({ _id: id });
    if (!listing?.photos?.length) return null;
    const pending = { status: 'pending', cloud: cloudName(), photos: listing.media?.photos ?? [], at: new Date() };
    await db.collection('listings').updateOne({ _id: id }, { $set: { media: pending } });
    publish('listing.updated', { id, patch: { media: pending } });

    const uploaded = await ingestPhotos(listing);
    const visionOn = vision ?? process.env.CLOUDINARY_AI_VISION !== '0';
    let visionError = null;
    // Tags from an earlier successful pass, by source URL: a re-enrichment re-runs this pass, and AI Vision
    // tokens are limited, so only photos we haven't analysed yet go to AI Vision.
    const prevTags = new Map(listing.media?.status === 'ok'
      ? listing.media.photos.filter((p) => p.analysed || p.tags?.length).map((p) => [p.source_url, p.tags ?? []]) : []);
    const photos = await Promise.all(uploaded.map(async (p, i) => {
      const known = prevTags.get(p.source_url);
      if (known) return { ...p, tags: known, room: roomOf(known), analysed: true };
      if (!visionOn || i >= ANALYSE_PHOTOS) return { ...p, tags: [], room: 'room' };
      try {
        const tags = await visionTags(p.public_id);
        return { ...p, tags, room: roomOf(tags), analysed: true };
      } catch (e) {
        visionError = e.message;
        return { ...p, tags: [], room: 'room' };
      }
    }));
    if (visionError) console.error(`ai vision ${id}:`, visionError);

    // Re-read the flags: Gemini may have added a pipe renovation while we were uploading (it decides bathroom costs).
    const current = await db.collection('listings').findOne({ _id: id }, { projection: { flags: 1, m2: 1 } });
    const flags = photoFlags({ ...listing, ...current }, photos);
    const media = { status: 'ok', cloud: cloudName(), photos, analysed: (visionOn || prevTags.size > 0) && !visionError, error: visionError ? String(visionError).slice(0, 200) : null, ms: Date.now() - t0, at: new Date() };
    // Swap in the new photo flags atomically, keeping every other flag as it is now.
    const doc = await db.collection('listings').findOneAndUpdate({ _id: id }, [{ $set: {
      media: { $literal: media },
      flags: { $concatArrays: [
        { $filter: { input: { $ifNull: ['$flags', []] }, cond: { $ne: ['$$this.origin', 'photos'] } } },
        { $literal: flags },
      ] },
    } }], { returnDocument: 'after', projection: { flags: 1, media: 1 } });
    if (doc) publish('listing.updated', { id, patch: { media: doc.media, flags: doc.flags } });
    return media;
  } catch (e) {
    console.error(`photos ${id} failed:`, e.message);
    const media = { status: 'error', cloud: cloudName(), photos: [], error: String(e.message).slice(0, 200), at: new Date() };
    await db.collection('listings').updateOne({ _id: id }, { $set: { media } }).catch(() => {});
    publish('listing.updated', { id, patch: { media } });
    return null;
  }
}

// ---------- share card ----------
// Text overlay escaping: URL-encode, then double-encode the characters Cloudinary's own parser treats as
// syntax (% , /), e.g. "18%" → "18%2525". The SDK leaves existing %XX sequences alone.
const esc = (s) => encodeURIComponent(String(s)).replace(/%(25|2C|2F)/gi, '%25$1');
const eur = (n) => `€${Math.round(n).toLocaleString('en').replace(/,/g, ' ')}`;

/**
 * 1200×630 share card: the best photo on top, a Finnish-blue band with the deal, price and address.
 * Built entirely from the delivery URL (overlays, smart crop, padding), so it costs one transformation and
 * no server rendering. Used in the alert email and by the Share button in the web app.
 */
export function shareCardUrl(l) {
  // Before the photo pass finishes, photos uploaded with the widget on /mock are already in our account.
  const photos = l.media?.photos?.length ? l.media.photos
    : (l.photos ?? []).map((u) => ownPublicId(u)).filter(Boolean).map((public_id) => ({ public_id, room: 'room' }));
  if (!mediaEnabled || !photos.length) return null;
  // Prefer an interior photo that isn't a floor plan; fall back to the first.
  const best = photos.find((p) => !['plan', 'exterior'].includes(p.room)) ?? photos[0];
  const deal = l.score?.deal_pct;
  const headline = deal == null ? 'New on FlatRadar'
    : deal <= -0.03 ? `${Math.round(-deal * 100)}% below fair value`
      : deal >= 0.03 ? `${Math.round(deal * 100)}% above fair value` : 'Priced about fair';
  const price = l.kind === 'rent' ? (l.rent ? `${eur(l.rent)}/month` : '') : (l.debt_free_price ?? l.price) ? eur(l.debt_free_price ?? l.price) : '';
  const facts = [price, l.m2 && `${l.m2} m²`, l.rooms && `${l.rooms} rooms`].filter(Boolean).join('  ·  ');
  const where = [l.address?.replace(/, Helsinki$/, ''), l.district].filter(Boolean).join(', ');
  const t = [
    'c_fill,g_auto,w_1200,h_430',
    'c_pad,w_1200,h_630,g_north,b_rgb:002F6C',
    `l_text:Arial_64_bold:${esc(headline)},co_white/fl_layer_apply,g_south_west,x_56,y_118`,
    `l_text:Arial_32:${esc(facts)},co_white/fl_layer_apply,g_south_west,x_56,y_70`,
    `l_text:Arial_26:${esc(where.slice(0, 60))},co_rgb:C9D6EA/fl_layer_apply,g_south_west,x_56,y_28`,
    `l_text:Arial_30_bold:FlatRadar,co_white/fl_layer_apply,g_south_east,x_56,y_28`,
    'f_jpg,q_auto',
  ].join('/');
  return cloudinary.url(best.public_id, { secure: true, raw_transformation: t });
}

/** One-off account setup: the unsigned upload preset the Upload Widget on /mock uses. */
export async function ensureUploadPreset(name = process.env.CLOUDINARY_UPLOAD_PRESET || 'flatradar_demo') {
  const settings = {
    unsigned: true, folder: 'flatradar/demo', allowed_formats: 'jpg,jpeg,png,webp,heic,avif',
    tags: 'flatradar,demo-upload', use_filename: false, unique_filename: true,
    transformation: [{ crop: 'limit', width: 2400, height: 2400 }], // cap what strangers can store through an unsigned preset
  };
  try {
    await cloudinary.api.upload_preset(name);
    await cloudinary.api.update_upload_preset(name, settings);
    return { name, created: false };
  } catch (e) {
    if ((e.error?.http_code ?? e.http_code) !== 404) throw e;
    await cloudinary.api.create_upload_preset({ name, ...settings });
    return { name, created: true };
  }
}
