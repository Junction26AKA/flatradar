// Match a listing against users' saved searches and email them through SendGrid.
// Without SENDGRID_API_KEY it logs what it would send (and still records the match).
import sgMail from '@sendgrid/mail';
import getDb from '../db.mjs';
import { publish } from '../bus.mjs';
import { mediaEnabled } from '../media/index.mjs';

const KEY = process.env.SENDGRID_API_KEY;
const FROM = process.env.SENDGRID_FROM;
const PUBLIC_URL = (process.env.PUBLIC_URL?.trim() || 'http://localhost:3000').replace(/\/$/, '');
if (KEY) sgMail.setApiKey(KEY);

const mask = (e) => e.replace(/^(.).*?(@.*)$/, '$1***$2');
const eur = (n) => `€${Math.round(n).toLocaleString('en')}`;

export function matches(search, l) {
  if (search.kind && search.kind !== l.kind) return false;
  const price = l.kind === 'rent' ? l.rent : l.debt_free_price ?? l.price;
  if (search.max_price && price && price > search.max_price) return false;
  if (search.min_rooms && l.rooms && l.rooms < search.min_rooms) return false;
  if (search.postcodes?.length && !search.postcodes.some((p) => l.postcode?.startsWith(p))) return false;
  if (search.districts?.length && !search.districts.some((d) => l.district?.toLowerCase().includes(d.toLowerCase()))) return false;
  if (search.min_deal != null && (l.score?.deal_pct == null || l.score.deal_pct > -Math.abs(search.min_deal))) return false;
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
  let sent = 0;
  for (const u of users) {
    if (!(u.searches ?? []).some((s) => matches(s, l))) continue;
    const already = await db.collection('alerts').findOne({ user_id: u._id, listing_id: l._id });
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
