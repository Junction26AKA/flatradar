// Match a listing against users' saved searches and email them through SendGrid.
// Without SENDGRID_API_KEY it logs what it would send (and still records the match).
import sgMail from '@sendgrid/mail';
import getDb from '../db.mjs';
import { publish } from '../bus.mjs';
import { mediaEnabled } from '../media/index.mjs';
import { distanceM, inPolygon, commuteMinutes, ensureCommutes } from '../geo.mjs';

const KEY = process.env.SENDGRID_API_KEY;
const FROM = process.env.SENDGRID_FROM;
const PUBLIC_URL = (process.env.PUBLIC_URL?.trim() || 'http://localhost:3000').replace(/\/$/, '');
if (KEY) sgMail.setApiKey(KEY);

const COMMUTE_WAIT_MS = 3000;
const mask = (e) => e.replace(/^(.).*?(@.*)$/, '$1***$2');
const eur = (n) => `€${Math.round(n).toLocaleString('en')}`;

export { distanceM };

/**
 * Postcodes, map circles and drawn areas are alternatives: with any of them set, the listing must be in one
 * postcode OR inside one circle OR inside one drawn polygon.
 */
export function inPlaces(search, l) {
  const codes = search.postcodes ?? [];
  const areas = search.areas ?? [];
  const polygons = search.polygons ?? [];
  if (!codes.length && !areas.length && !polygons.length) return true;
  if (codes.some((p) => l.postcode?.startsWith(p))) return true;
  const c = l.loc?.coordinates;
  if (!c) return false;
  return areas.some((a) => distanceM(a.lat, a.lng, c[1], c[0]) <= a.radius_m) || polygons.some((pg) => inPolygon(c[1], c[0], pg.points));
}

/** Hidden-cost flags the search excludes: a finished, non-info flag of an excluded type rules the listing out. */
export const hasExcludedFlag = (search, l) =>
  !!search.exclude_flags?.length && (l.flags ?? []).some((f) => f.status === 'ok' && f.severity !== 'info' && search.exclude_flags.includes(f.type));

export function matches(search, l) {
  if (search.kind && search.kind !== l.kind) return false;
  const price = l.kind === 'rent' ? l.rent : l.debt_free_price ?? l.price;
  if (search.max_price && price && price > search.max_price) return false;
  if (search.min_rooms && l.rooms && l.rooms < search.min_rooms) return false;
  if (!inPlaces(search, l)) return false;
  if (search.districts?.length && !search.districts.some((d) => l.district?.toLowerCase().includes(d.toLowerCase()))) return false;
  if (search.min_deal != null && (l.score?.deal_pct == null || l.score.deal_pct > -Math.abs(search.min_deal))) return false;
  if (search.commute) {
    const min = commuteMinutes(l, search.commute);
    if (min == null || min > search.commute.max_min) return false;
  }
  if (hasExcludedFlag(search, l)) return false;
  return true;
}

export function renderEmail(l) {
  const price = l.kind === 'rent' ? `${eur(l.rent)}/month` : eur(l.debt_free_price ?? l.price);
  const deal = l.score?.deal_pct != null ? `${l.score.deal_pct < 0 ? '' : '+'}${Math.round(l.score.deal_pct * 100)}% vs fair value` : 'not scored yet';
  const flags = (l.flags ?? []).filter((f) => f.status === 'ok' && f.severity !== 'info').slice(0, 4);
  const subject = `FlatRadar: ${l.rooms ?? '?'}-room ${l.kind === 'rent' ? 'rental' : 'flat'} in ${l.district ?? 'Helsinki'}, ${price} (${deal})`;
  // Cloudinary share card (photo + deal band), when the listing has photos. Points at our redirect route, not
  // the Cloudinary URL: the alert goes out right at `ready`, before the photo pass has written `media`, and the
  // route resolves the card when the mail client loads the image.
  const card = mediaEnabled && PUBLIC_URL && l.photos?.length ? `${PUBLIC_URL}/api/listings/${encodeURIComponent(l._id)}/card` : null;
  const link = `${PUBLIC_URL}/app/l/${encodeURIComponent(l._id)}?kind=${l.kind}`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px">
  ${card ? `<a href="${link}"><img src="${card}" width="560" alt="${deal}" style="display:block;width:100%;max-width:560px;height:auto;border-radius:8px;margin:0 0 12px"></a>` : ''}
  <h2 style="margin:0 0 4px">${l.address ?? 'New listing'}</h2>
  <p style="margin:0 0 12px;color:#555">${l.district ?? ''} · ${l.m2 ?? '?'} m² · ${l.rooms ?? '?'} rooms · built ${l.year ?? '?'}</p>
  <p style="font-size:20px;margin:0 0 4px"><b>${price}</b></p>
  <p style="margin:0 0 12px"><b>${deal}</b>${l.score?.fair_price ? ` (fair ≈ ${l.kind === 'rent' ? `${eur(l.score.fair_price)}/month` : eur(l.score.fair_price)})` : ''}</p>
  ${flags.length ? `<ul>${flags.map((f) => `<li><b>${f.label}</b>${f.est_cost_eur ? ` (≈ ${eur(f.est_cost_eur)})` : ''}: ${f.detail ?? ''}</li>`).join('')}</ul>` : ''}
  <p><a href="${link}">Open in FlatRadar</a> · <a href="${l.url}">Original listing</a></p></div>`;
  return { subject, html, text: `${subject}\n${l.url}` };
}

/** Send alerts for one listing. Returns the number of users alerted. */
export async function alertForListing(l) {
  const db = await getDb();
  const users = await db.collection('users').find({}).toArray();
  // Planner commute times for every commute target in a search that otherwise fits (estimate without a key).
  const targets = users.flatMap((u) => (u.searches ?? []).filter((s) => s.commute && matches({ ...s, commute: null }, l)).map((s) => s.commute));
  // Wait at most 3 s: a slow planner mustn't hold up every alert. Late times still land on the listing; this
  // alert falls back to the estimate.
  if (targets.length) {
    await Promise.race([
      ensureCommutes(l, targets).catch((e) => console.error('commute failed:', e.message)),
      new Promise((r) => setTimeout(r, COMMUTE_WAIT_MS)),
    ]);
  }
  let sent = 0;
  for (const u of users) {
    if (!(u.searches ?? []).some((s) => matches(s, l))) continue;
    const already = await db.collection('alerts').findOne({ user_id: u._id, listing_id: l._id, type: { $exists: false } });
    if (already) continue;
    const msg = renderEmail(l);
    let status = 'logged';
    if (KEY && FROM) {
      try { await sgMail.send({ to: u.email, from: FROM, subject: msg.subject, html: msg.html, text: msg.text }); status = 'sent'; }
      catch (e) { status = 'error'; console.error('sendgrid:', e.response?.body ?? e.message); }
    } else {
      console.log(`[alert not sent: no SENDGRID_API_KEY/SENDGRID_FROM] to ${mask(u.email)}: ${msg.subject}`);
    }
    await db.collection('alerts').insertOne({ user_id: u._id, listing_id: l._id, status, at: new Date() });
    if (status !== 'error') { publish('alert.sent', { listing_id: l._id, to: mask(u.email), at: new Date(), status }); sent++; }
  }
  return sent;
}

/** A saved (hearted) listing dropped in price: email everyone who saved it, once per new price. */
const RECENT_MS = 12 * 3600_000;
export async function alertFavouriteDrop(listingId, drop) {
  const db = await getDb();
  const users = await db.collection('users').find({ favourites: listingId }, { projection: { email: 1 } }).toArray();
  if (!users.length) return 0;
  const l = await db.collection('listings').findOne({ _id: listingId }, { projection: { doc_extracts: 0 } });
  if (!l) return 0;
  // Override the field renderEmail shows (rent, else debt-free price, else asking price).
  const field = l.kind === 'rent' ? 'rent' : l.debt_free_price != null ? 'debt_free_price' : 'price';
  const listing = { ...l, [field]: drop.new_price };
  let sent = 0;
  for (const u of users) {
    const key = { user_id: u._id, listing_id: listingId, type: 'favourite_drop', new_price: drop.new_price };
    // The search-page diff and the listing monitor can both report the same drop, possibly read from
    // different price fields. Skip if this saver was emailed about this flat recently, then claim the
    // alert atomically (unique index, scripts/setup-db.mjs) before sending, so two callers can't both send.
    if (await db.collection('alerts').findOne({ user_id: u._id, listing_id: listingId, type: 'favourite_drop', at: { $gt: new Date(Date.now() - RECENT_MS) } })) continue;
    try { await db.collection('alerts').insertOne({ ...key, status: 'sending', at: new Date() }); }
    catch (e) { if (e.code === 11000) continue; throw e; }
    const base = renderEmail(listing);
    const pct = Math.round(((drop.old_price - drop.new_price) / drop.old_price) * 100);
    const was = l.kind === 'rent' ? `${eur(drop.old_price)}/month` : eur(drop.old_price);
    const now = l.kind === 'rent' ? `${eur(drop.new_price)}/month` : eur(drop.new_price);
    const subject = `Price drop on a flat you saved: ${l.address ?? 'listing'} now ${now} (−${pct}%)`;
    const html = `<p style="font-family:system-ui,sans-serif;font-size:16px;margin:0 0 12px">A flat you saved just dropped from <s>${was}</s> to <b>${now}</b> (−${pct}%).</p>${base.html}`;
    let status = 'logged';
    if (KEY && FROM) {
      try { await sgMail.send({ to: u.email, from: FROM, subject, html, text: `${subject}\n${l.url}` }); status = 'sent'; }
      catch (e) { status = 'error'; console.error('sendgrid:', e.response?.body ?? e.message); }
    } else {
      console.log(`[alert not sent: no SENDGRID_API_KEY/SENDGRID_FROM] to ${mask(u.email)}: ${subject}`);
    }
    await db.collection('alerts').updateOne(key, { $set: { status, at: new Date() } });
    if (status !== 'error') { publish('alert.sent', { listing_id: listingId, to: mask(u.email), at: new Date(), status }); sent++; }
  }
  return sent;
}
