// Mock listing feed for the stage demo. These pages are ours (clearly labelled demo data), served at /mock,
// watched by a real Context.dev monitor and extracted with the same schema as the real portals.
import getDb from './db.mjs';
import { normaliseListing } from './ingest/portals.mjs';
import { scoreListing } from './score/index.mjs';

// The demo flat is priced this far below the live fair value when it's published (it's fictional, so we
// set the price; the score itself is computed normally afterwards, from real comparables or Kevin's model).
const DEMO_DISCOUNT = Number(process.env.DEMO_DISCOUNT ?? 0.18);

const PUBLIC_URL = () => (process.env.PUBLIC_URL?.trim() || 'http://localhost:3000').replace(/\/$/, '');

export const PRESETS = {
  'kallio-2h': {
    kind: 'sale', address: 'Vaasankatu 14 B, Helsinki', postcode: '00500', district: 'Kallio', lat: 60.1868, lng: 24.9536,
    building_type: 'Kerrostalo', rooms: 2, rooms_description: '2h + k + kph', m2: 48, year: 1928, floor: 4, floors_total: 6,
    elevator: true, sauna: false, balcony: false, condition: 'Hyvä', plot: 'own', energy_class: 'D (2018)',
    price: 259000, debt_free_price: 259000, fee_month: 215, housing_company: 'Asunto Oy Demo-Vaasankatu 14 (fictional)',
    renovations_done: '2015 Vesikatto uusittu. 2019 Hissin modernisointi.',
    renovations_planned: '2027 Linjasaneeraus (hankesuunnitelma hyväksytty, arvio 900 €/m²); 2028 Julkisivun ja ikkunoiden korjaus',
    agent: 'FlatRadar demo feed', pdf: true,
  },
  'kallio-rent': {
    kind: 'rent', address: 'Helsinginkatu 20 A, Helsinki', postcode: '00500', district: 'Kallio', lat: 60.1859, lng: 24.9488,
    building_type: 'Kerrostalo', rooms: 1, rooms_description: '1h + kk + kph', m2: 32, year: 1936, floor: 3, floors_total: 5,
    elevator: true, sauna: false, balcony: false, condition: 'Hyvä', rent: 690, available_from: '2026-12-01',
    renovations_done: null, renovations_planned: '2027 Putkiremontti (LVIS-saneeraus)', agent: 'FlatRadar demo feed', pdf: false,
  },
};

/**
 * Publish a new mock listing from a preset. Returns its id.
 * @param {string[]} [photos]  photo URLs, e.g. uploaded on stage with the Cloudinary Upload Widget on /mock
 */
export async function publishMock(preset = 'kallio-2h', photos = []) {
  const p = PRESETS[preset];
  if (!p) throw new Error(`unknown preset ${preset}`);
  const db = await getDb();
  const slug = `${preset}-${Date.now().toString(36)}`;
  const doc = { _id: slug, preset, ...p, photos: photos.filter((u) => typeof u === 'string' && /^https:\/\//.test(u)).slice(0, 12) };

  // Price it relative to what the scorer currently thinks this flat is worth.
  const draft = normaliseListing({ id: `mock:${slug}`, portal: 'mock', url: '', json: mockJson(doc), card: { kind: p.kind } });
  const score = await scoreListing({ ...draft, comparable: true }).catch(() => null);
  if (score?.fair_price) {
    const target = score.fair_price * (1 - DEMO_DISCOUNT);
    if (p.kind === 'rent') doc.rent = Math.round(target / 10) * 10;
    else doc.price = doc.debt_free_price = Math.round(target / 1000) * 1000;
    doc.priced_from = { fair_price: score.fair_price, discount: DEMO_DISCOUNT, source: score.model ? 'model' : 'comparables' };
  }
  await db.collection('mock_listings').insertOne({ ...doc, published_at: new Date() });
  return slug;
}

export async function mockCards() {
  const db = await getDb();
  const docs = await db.collection('mock_listings').find({}).sort({ published_at: -1 }).limit(20).toArray();
  return docs.map((d) => ({
    id: `mock:${d._id}`, portal: 'mock', kind: d.kind, url: `${PUBLIC_URL()}/mock/${d._id}`,
    address: d.address, district: d.district, building_type: d.building_type, year: d.year, rooms: d.rooms, m2: d.m2,
    price: d.price ?? null, rent: d.rent ?? null, is_new: true,
  }));
}

/** The extraction-shaped JSON for a mock listing (used when no public URL exists to scrape it). */
export function mockJson(d) {
  return {
    address: d.address, postcode: d.postcode, district: d.district, building_type: d.building_type, rooms: d.rooms,
    rooms_description: d.rooms_description, living_area_m2: d.m2, build_year: d.year, floor: d.floor, floors_total: d.floors_total,
    elevator: d.elevator, sauna: d.sauna, balcony: d.balcony, condition: d.condition, sales_price_eur: d.price ?? null,
    debt_free_price_eur: d.debt_free_price ?? null, maintenance_fee_eur_month: d.fee_month ?? null, rent_eur_month: d.rent ?? null,
    available_from: d.available_from ?? null, plot_ownership: d.plot ?? null, energy_class: d.energy_class ?? null,
    renovations_done: d.renovations_done, renovations_planned: d.renovations_planned, housing_company: d.housing_company ?? null,
    latitude: d.lat, longitude: d.lng, agent_company: d.agent,
    attachments: d.pdf ? [{ title: 'Isännöitsijäntodistus (PDF)', url: `${PUBLIC_URL()}/mock/${d._id}/isannoitsijantodistus.pdf` }] : [],
    photos: d.photos ?? [],
  };
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const eur = (n) => (n == null ? '–' : `${Math.round(n).toLocaleString('fi-FI')} €`);

export async function renderIndex() {
  const db = await getDb();
  const docs = await db.collection('mock_listings').find({}).sort({ published_at: -1 }).limit(20).toArray();
  const items = docs.map((d) => `<li><a href="/mock/${d._id}">${esc(d.address)}, ${esc(d.district)} · ${esc(d.building_type)}, ${d.year} · ${d.rooms} h · ${d.m2} m² · ${d.kind === 'rent' ? `${eur(d.rent)}/kk` : eur(d.price)}</a></li>`).join('\n');
  return page('FlatRadar demo feed', `${publishPanel()}<h1>Demo listings (fictional)</h1><p>${docs.length} kohdetta</p><ul>${items}</ul>`);
}

/**
 * Stage panel on /mock: add photos with the Cloudinary Upload Widget (unsigned preset, local files, camera or
 * URL), then publish the demo flat with them. Photos land in our Cloudinary account straight from the browser.
 * Hidden unless Cloudinary is configured. Publishing is the same POST /mock/publish the demo already uses.
 */
function publishPanel() {
  const cloud = process.env.CLOUDINARY_URL?.match(/@([^/?#]+)/)?.[1];
  const preset = process.env.CLOUDINARY_UPLOAD_PRESET || 'flatradar_demo';
  if (!cloud) return '';
  const opts = Object.keys(PRESETS).map((k) => `<option value="${esc(k)}">${esc(k)}</option>`).join('');
  return `<section class="stage" aria-labelledby="stage-h">
  <h2 id="stage-h">Publish a demo flat</h2>
  <p>Add photos of the flat, then publish. FlatRadar sends them through Cloudinary AI Vision to look for dated kitchens, damp and worn floors.</p>
  <div class="row"><button type="button" id="upload" disabled>Add photos</button>
  <label>Preset <select id="preset">${opts}</select></label>
  <button type="button" id="publish" class="primary">Publish</button></div>
  <div id="thumbs" class="gallery" aria-live="polite"></div>
  <p id="status" role="status"></p>
</section>
<script src="https://upload-widget.cloudinary.com/global/all.js" async></script>
<script>
(() => {
  const cloudName = ${JSON.stringify(cloud)}, uploadPreset = ${JSON.stringify(preset)};
  const photos = [];
  const $ = (id) => document.getElementById(id);
  const thumb = (r) => r.secure_url.replace('/image/upload/', '/image/upload/c_fill,g_auto,w_160,h_120/f_auto/q_auto/');
  let widget = null;
  // The widget script loads async: poll until createUploadWidget exists (window.cloudinary can appear first).
  const started = Date.now();
  const poll = setInterval(() => {
    if (typeof window.cloudinary?.createUploadWidget === 'function') {
      clearInterval(poll);
      widget = window.cloudinary.createUploadWidget({
        cloudName, uploadPreset, sources: ['local', 'camera', 'url'], multiple: true, maxFiles: 8,
        clientAllowedFormats: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'avif'], maxImageFileSize: 15000000,
        styles: { palette: { window: '#FFFFFF', windowBorder: '#002F6C', tabIcon: '#002F6C', link: '#002F6C', action: '#002F6C', inProgress: '#002F6C', complete: '#1E7B45', sourceBg: '#F4F7FB', textDark: '#0B1B33', textLight: '#FFFFFF', menuIcons: '#002F6C', inactiveTabIcon: '#6B7A90', error: '#B3261E' } },
      }, (err, res) => {
        if (err) { $('status').textContent = 'Upload failed: ' + (err.statusText || err.message || 'unknown error'); return; }
        if (res.event === 'success') {
          photos.push(res.info.secure_url);
          const img = document.createElement('img'); img.src = thumb(res.info); img.alt = 'Photo ' + photos.length;
          $('thumbs').append(img);
          $('status').textContent = photos.length + ' photo(s) ready';
        }
      });
      $('upload').disabled = false;
    } else if (Date.now() - started > 10000) {
      clearInterval(poll);
      $('status').textContent = 'The Cloudinary upload widget did not load. You can still publish without photos.';
    }
  }, 100);
  $('upload').addEventListener('click', () => widget && widget.open());
  $('publish').addEventListener('click', async () => {
    $('publish').disabled = true; $('status').textContent = 'Publishing…';
    try {
      const r = await fetch('/mock/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preset: $('preset').value, photos }) });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error || r.status);
      $('status').innerHTML = 'Published <code>' + b.listing_id + '</code>. Watch the dashboard.';
      setTimeout(() => location.reload(), 1500);
    } catch (e) { $('status').textContent = 'Publish failed: ' + e.message; $('publish').disabled = false; }
  });
})();
</script>`;
}

export async function renderListing(id) {
  const db = await getDb();
  const d = await db.collection('mock_listings').findOne({ _id: id });
  if (!d) return null;
  const j = mockJson(d);
  const row = (k, v) => (v == null || v === '' ? '' : `<tr><th>${k}</th><td>${esc(v)}</td></tr>`);
  const body = `<h1>${esc(d.address)}</h1><p>${esc(d.district)}, Helsinki · ${esc(d.building_type)}</p>
  <table>
  ${row('Postinumero', d.postcode)}${row('Huoneistoselitelmä', d.rooms_description)}${row('Huoneita', d.rooms)}${row('Asuinpinta-ala', `${d.m2} m²`)}
  ${row('Rakennusvuosi', d.year)}${row('Kerros', `${d.floor}/${d.floors_total}`)}${row('Hissi', d.elevator ? 'Kyllä' : 'Ei')}${row('Kunto', d.condition)}
  ${d.kind === 'rent' ? row('Vuokra', `${eur(d.rent)}/kk`) + row('Vapautuu', d.available_from) : row('Myyntihinta', eur(d.price)) + row('Velaton hinta', eur(d.debt_free_price)) + row('Hoitovastike', `${d.fee_month} €/kk`) + row('Tontti', d.plot === 'own' ? 'Oma' : 'Vuokrattu')}
  ${row('Energialuokka', d.energy_class)}${row('Taloyhtiö', d.housing_company)}${row('Tehdyt korjaukset', d.renovations_done)}${row('Tulevat korjaukset', d.renovations_planned)}
  ${row('Sijainti', `${d.lat}, ${d.lng}`)}${row('Ilmoittaja', d.agent)}
  </table>
  ${j.attachments.map((a) => `<p>Liitteet: <a href="${esc(a.url)}">${esc(a.title)}</a></p>`).join('')}
  ${j.photos.length ? `<h2>Kuvat</h2><div class="gallery">${j.photos.map((u, i) => `<a href="${esc(u)}"><img src="${esc(u)}" alt="Kuva ${i + 1}" loading="lazy"></a>`).join('')}</div>` : ''}
  <script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Residence', address: d.address, geo: { latitude: d.lat, longitude: d.lng } })}</script>`;
  return page(`${d.address} – demo`, body);
}

function page(title, body) {
  return `<!doctype html><html lang="fi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:24px auto;padding:0 16px}th{text-align:left;padding-right:16px;color:#555;font-weight:500}td,th{padding:4px 8px 4px 0;vertical-align:top}.demo{background:#fff4d6;padding:6px 10px;border-radius:6px}
.gallery{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}.gallery img{width:160px;height:120px;object-fit:cover;border-radius:6px}
.stage{border:2px solid #002F6C;border-radius:10px;padding:12px 16px;margin:16px 0}.stage h2{margin:0 0 4px;color:#002F6C}
.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}button,select{font:inherit;padding:6px 12px;border-radius:6px;border:1px solid #002F6C;background:#fff;color:#002F6C;cursor:pointer}
button.primary{background:#002F6C;color:#fff}button:disabled{opacity:.5;cursor:default}</style></head>
<body><p class="demo">FlatRadar demo feed: fictional listings for a hackathon demo.</p>${body}</body></html>`;
}

/** A small, valid one-page PDF (Helvetica, WinAnsi) with the housing company's maintenance plan. */
export async function renderPdf(id) {
  const db = await getDb();
  const d = await db.collection('mock_listings').findOne({ _id: id });
  if (!d) return null;
  const lines = [
    ['F2', 16, 'ISÄNNÖITSIJÄNTODISTUS'],
    ['F1', 10, 'DEMO DOCUMENT: fictional housing company for a hackathon demo'],
    ['F1', 11, ''],
    ['F2', 11, `Taloyhtiö: ${d.housing_company ?? 'Asunto Oy Demo'}`],
    ['F1', 11, `Osoite: ${d.address}`],
    ['F1', 11, `Rakennusvuosi: ${d.year}   Tontti: ${d.plot === 'leased' ? 'vuokrattu' : 'oma'}`],
    ['F1', 11, 'Yhtiölainat: 0 €'],
    ['F1', 11, ''],
    ['F2', 12, 'Tehdyt korjaukset'],
    ...String(d.renovations_done ?? '-').split(/(?<=\.)\s+/).map((t) => ['F1', 11, t]),
    ['F1', 11, ''],
    ['F2', 12, 'Kunnossapitotarveselvitys 2026-2031 (tulevat korjaukset)'],
    ['F1', 11, '2026 Kiinteistön kuntoarvio'],
    ['F1', 11, '2027 Linjasaneeraus (LVIS), arvio 900 €/m2, hankesuunnitelma hyväksytty yhtiökokouksessa 5/2026'],
    ['F1', 11, '2028 Julkisivun ja ikkunoiden korjaus, arvio 300 €/m2'],
    ['F1', 11, '2030 Hissien kuntotutkimus'],
  ];
  let y = 790;
  const toWin = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const content = lines.map(([f, size, t]) => { y -= size + 8; return `BT /${f} ${size} Tf 50 ${y} Td (${toWin(t)}) Tj ET`; }).join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
