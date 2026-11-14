// Portal definitions: search URLs, search-results card parsing (for monitors/diffing), and the
// structured-extraction schema for a listing page. Etuovi (sale) and Vuokraovi (rent) share Alma
// Media's platform, so one extraction schema covers both.

export const PORTALS = {
  etuovi: {
    kind: 'sale',
    search: (page = 1) => `https://www.etuovi.com/myytavat-asunnot/helsinki?jarjestys=uusimmat${page > 1 ? `&sivu=${page}` : ''}`,
    listingUrl: (id) => `https://www.etuovi.com/kohde/${id}`,
    host: 'www.etuovi.com',
  },
  vuokraovi: {
    kind: 'rent',
    search: (page = 1) => `https://www.vuokraovi.com/vuokra-asunnot/helsinki?jarjestys=uusimmat${page > 1 ? `&sivu=${page}` : ''}`,
    listingUrl: (id) => `https://www.vuokraovi.com/kohde/${id}`,
    host: 'www.vuokraovi.com',
  },
};

export function portalForUrl(url) {
  const host = new URL(url).host;
  return Object.entries(PORTALS).find(([, p]) => p.host === host)?.[0] ?? null;
}

const num = (s) => (s == null ? null : Number(String(s).replace(/[\s  ]/g, '').replace(',', '.')));

/**
 * Parse a search-results page (markdown from web.scrape) into cards.
 * Skips sponsored cards (they lack m² and come from all of Uusimaa).
 * @returns {{id, portal, kind, url, address, district, building_type, year, rooms, m2, price, rent, is_new}[]}
 */
export function parseSearchCards(markdown, portal) {
  const { kind, listingUrl } = PORTALS[portal];
  const cards = new Map();
  const re = /\[((?:[^\[\]]|\\\[|\\\])+?)\]\((https:\/\/www\.(?:etuovi|vuokraovi)\.com\/kohde\/([a-z0-9]+))[^)]*\)/gi;
  for (const m of markdown.matchAll(re)) {
    const [, text, , id] = m;
    const parts = text.split(/\\\\\s*\\\\|\\\s+\\/).map((s) => s.replace(/\*\*/g, '').replace(/\\/g, '').trim()).filter(Boolean);
    const card = { id: `${portal}:${id}`, portal, kind, url: listingUrl(id), address: null, district: null, building_type: null, year: null, rooms: null, m2: null, price: null, rent: null, is_new: parts.some((p) => /^Uusi\s?24 h$/.test(p)) };
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      let x;
      if ((x = p.match(/^([\d\s  ]+?)[\s  ]*€\/kk$/))) card.rent = num(x[1]);
      else if ((x = p.match(/^([\d\s  ]+?)[\s  ]*€$/))) card.price = num(x[1]);
      else if ((x = p.match(/^([\d,]+)(?:\s*\/\s*[\d,]+)?[\s  ]*m²$/))) card.m2 = num(x[1]);
      else if ((x = p.match(/^(\d+)[\s  ]*h$/))) card.rooms = Number(x[1]);
      else if ((x = p.match(/^(Kerrostalo|Rivitalo|Paritalo|Omakotitalo|Erillistalo|Luhtitalo|Puutalo-osake|Muu)(?:, (\d{4}))?(?: \| (.+))?$/))) {
        card.building_type = x[1];
        if (x[2]) card.year = Number(x[2]);
        if (x[3]) card.rooms ??= Number(x[3].match(/^(\d+)\s?h/)?.[1]) || null;
      } else if (p === 'Vuosi' && /^\d{4}$/.test(parts[i + 1] ?? '')) card.year = Number(parts[++i]);
      else if (/,\s*Helsinki$/.test(p) && /\d/.test(p) && !card.address) {
        const bits = p.split(',').map((s) => s.trim());
        card.address = `${bits[0]}, Helsinki`;
        card.district = bits.length > 2 ? bits[1] : null;
      }
    }
    if (card.m2 == null || (card.price == null && card.rent == null)) continue; // sponsored / non-dwelling
    cards.set(card.id, card);
  }
  return [...cards.values()];
}

// JSON schema for web.scrape `formats.json` on a listing page (sale or rent).
export const LISTING_SCHEMA = {
  type: 'object',
  properties: {
    address: { type: ['string', 'null'], description: 'Street address with number, e.g. "Wavulinintie 5, Helsinki"' },
    postcode: { type: ['string', 'null'], description: 'Five-digit Finnish postal code' },
    district: { type: ['string', 'null'] },
    building_type: { type: ['string', 'null'], description: 'Kerrostalo / Rivitalo / Omakotitalo / ...' },
    rooms: { type: ['number', 'null'], description: 'Number of rooms (the number before "h")' },
    rooms_description: { type: ['string', 'null'] },
    living_area_m2: { type: ['number', 'null'] },
    build_year: { type: ['integer', 'null'] },
    floor: { type: ['integer', 'null'] },
    floors_total: { type: ['integer', 'null'] },
    elevator: { type: ['boolean', 'null'] },
    sauna: { type: ['boolean', 'null'] },
    balcony: { type: ['boolean', 'null'] },
    condition: { type: ['string', 'null'] },
    sales_price_eur: { type: ['number', 'null'], description: 'Myyntihinta (sale only)' },
    debt_free_price_eur: { type: ['number', 'null'], description: 'Velaton hinta (sale only)' },
    debt_share_eur: { type: ['number', 'null'], description: 'Velkaosuus (sale only)' },
    maintenance_fee_eur_month: { type: ['number', 'null'], description: 'Hoitovastike €/kk' },
    financing_fee_eur_month: { type: ['number', 'null'], description: 'Rahoitusvastike €/kk' },
    rent_eur_month: { type: ['number', 'null'], description: 'Vuokra €/kk (rental only)' },
    available_from: { type: ['string', 'null'], description: 'Vapautuu date as YYYY-MM-DD, or "now"' },
    plot_ownership: { type: ['string', 'null'], enum: ['own', 'leased', null] },
    tenure: { type: ['string', 'null'], enum: ['ownership', 'right_of_occupancy', 'part_ownership', 'hitas', null], description: 'Omistus / Asumisoikeus / Osaomistus / Hitas' },
    energy_class: { type: ['string', 'null'] },
    renovations_done: { type: ['string', 'null'], description: 'Tehdyt korjaukset, verbatim' },
    renovations_planned: { type: ['string', 'null'], description: 'Tulevat korjaukset / suunnitellut, verbatim' },
    housing_company: { type: ['string', 'null'] },
    latitude: { type: ['number', 'null'] },
    longitude: { type: ['number', 'null'] },
    attachments: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, url: { type: 'string' } } }, description: 'Linked documents (PDFs): esite, isännöitsijäntodistus, energiatodistus' },
    agent_company: { type: ['string', 'null'], description: 'Estate agent or landlord company' },
  },
};

export const SCRAPE_LISTING_PARAMS = (url) => ({
  url,
  formats: { json: true },
  jsonParams: { schema: LISTING_SCHEMA, instructions: 'Finnish property listing. Copy renovation texts verbatim. Use null when a fact is not on the page.' },
  maxAgeMs: 6 * 3600 * 1000,
  tags: ['flatradar'],
});

/**
 * Tenure and whether a listing is a fair comparable (used for scoring, comparables and model training).
 * Right-of-occupancy (asumisoikeus) and part-ownership prices are deposits, not market prices.
 */
export function classify(l, extractedTenure = null) {
  const who = `${l.agent_company ?? ''} ${l.housing_company ?? ''}`;
  let tenure = extractedTenure ?? null;
  if (!tenure || tenure === 'ownership') {
    if (/asumisoikeus|asoasun/i.test(who)) tenure = 'right_of_occupancy';
    else if (/osaomistus/i.test(who)) tenure = 'part_ownership';
  }
  const pm2 = l.m2 ? (l.kind === 'rent' ? l.rent : l.debt_free_price ?? l.price) / l.m2 : null;
  if (!tenure && l.kind === 'sale' && pm2 != null && pm2 > 0 && pm2 < 1500) tenure = 'right_of_occupancy';
  tenure ??= l.kind === 'sale' ? 'ownership' : null;
  const okRange = pm2 != null && (l.kind === 'sale' ? pm2 >= 1500 && pm2 <= 20000 : pm2 >= 8 && pm2 <= 50);
  const comparable = okRange && (l.kind === 'rent' || tenure === 'ownership' || tenure === 'hitas') && !/ulosotto/i.test(who);
  return { tenure, comparable };
}

/** Normalise extracted JSON (+ optional search card) into a `listing` document (docs/contracts.md §1). */
export function normaliseListing({ id, portal, url, json, card = null, seenAt = new Date() }) {
  const j = json ?? {};
  const kind = card?.kind ?? PORTALS[portal]?.kind ?? (j.rent_eur_month ? 'rent' : 'sale');
  const m2 = j.living_area_m2 ?? card?.m2 ?? null;
  const price = kind === 'sale' ? j.sales_price_eur ?? card?.price ?? null : null;
  const debtFree = kind === 'sale' ? j.debt_free_price_eur ?? price : null;
  const rent = kind === 'rent' ? j.rent_eur_month ?? card?.rent ?? null : null;
  const fee = j.maintenance_fee_eur_month ?? null;
  const lat = j.latitude, lng = j.longitude;
  const validLoc = typeof lat === 'number' && typeof lng === 'number' && lat > 59.9 && lat < 60.4 && lng > 24.5 && lng < 25.3;
  const postcode = j.postcode && /^\d{5}$/.test(j.postcode) ? j.postcode : null;
  const out = {
    _id: id,
    portal,
    kind,
    url,
    address: j.address ?? card?.address ?? null,
    postcode,
    district: j.district ?? card?.district ?? null,
    loc: validLoc ? { type: 'Point', coordinates: [lng, lat] } : null,
    building_type: j.building_type ?? card?.building_type ?? null,
    rooms: j.rooms ?? card?.rooms ?? null,
    rooms_description: j.rooms_description ?? null,
    m2,
    year: j.build_year ?? card?.year ?? null,
    floor: j.floor ?? null,
    floors_total: j.floors_total ?? null,
    elevator: j.elevator ?? null,
    sauna: j.sauna ?? null,
    balcony: j.balcony ?? null,
    condition: j.condition ?? null,
    plot: j.plot_ownership ?? null,
    energy_class: j.energy_class ?? null,
    price,
    debt_free_price: debtFree,
    debt_share: kind === 'sale' ? j.debt_share_eur ?? (price && debtFree ? debtFree - price : null) : null,
    fee_month: fee,
    fee_m2: fee && m2 ? Math.round((fee / m2) * 100) / 100 : null,
    financing_fee_month: j.financing_fee_eur_month ?? null,
    housing_company: j.housing_company ?? null,
    rent,
    available_from: j.available_from ?? null,
    agent_company: j.agent_company ?? null,
    renovations_done: j.renovations_done ?? null,
    renovations_upcoming: j.renovations_planned ?? null,
    attachments: (j.attachments ?? []).filter((a) => a?.url && /^https?:/.test(a.url)),
    last_seen_at: seenAt,
  };
  return { ...out, ...classify(out, j.tenure ?? null) };
}
