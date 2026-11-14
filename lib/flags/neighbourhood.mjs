// Neighbourhood red flags from live news (Context.dev news search). Each search is one call in the fan-out.
import { context, call } from '../context.mjs';

const street = (address) => address?.split(',')[0]?.replace(/\s+\d.*$/, '').trim() || null;
const SIX_MONTHS = 183 * 24 * 3600 * 1000;
const CONSTRUCTION = /katutyö|työmaa|rakennustyö|kaivu|remontti|raitiotie|liikennejärjestely|purku|rakennetaan|sulje|construction|roadwork/i;

let n = 0;
const fid = () => `n_${Date.now().toString(36)}${(++n).toString(36)}`;

async function search(query, listingId, label) {
  const res = await call('news.search', () => context.news.search({
    searchBy: { type: 'natural_language', query },
    filterBy: { sourceCountry: ['fi'], date: { from: Math.floor((Date.now() - SIX_MONTHS) / 1000) } },
    sortBy: { type: 'relevance' },
    limit: 6,
    tags: ['flatradar', 'news'],
  }), { listingId, label });
  return res.data ?? [];
}

/** Street-level and district-level construction news. Returns Flag[] (may be empty). */
export async function newsFlags(l) {
  const s = street(l.address);
  const queries = [];
  if (s) queries.push({ q: `${s} Helsinki katutyöt rakennustyömaa`, scope: 'street', label: `news: ${s}` });
  if (l.district) queries.push({ q: `${l.district} Helsinki rakentaminen työmaa liikenne`, scope: 'district', label: `news: ${l.district}` });

  const results = await Promise.allSettled(queries.map((x) => search(x.q, l._id, x.label).then((items) => ({ ...x, items }))));
  const flags = [];
  const seen = new Set();
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const { scope, items } = r.value;
    for (const a of items) {
      const text = `${a.title} ${a.description ?? ''}`;
      if (seen.has(a.url) || !CONSTRUCTION.test(text)) continue;
      const mentionsStreet = s && text.toLowerCase().includes(s.toLowerCase().slice(0, Math.max(5, s.length - 3)));
      const mentionsDistrict = l.district && text.toLowerCase().includes(l.district.toLowerCase().slice(0, 5));
      if (scope === 'street' && !mentionsStreet && !mentionsDistrict) continue;
      if (scope === 'district' && !mentionsDistrict) continue;
      seen.add(a.url);
      flags.push({
        id: fid(),
        type: 'street_works',
        severity: mentionsStreet ? 'warn' : 'info',
        label: mentionsStreet ? `Works on ${s}` : `Construction in ${l.district}`,
        detail: a.title,
        est_cost_eur: null,
        year: a.published_at ? new Date(a.published_at).getFullYear() : null,
        source: { kind: 'news', url: a.url, quote: (a.description ?? a.title).slice(0, 240), page: null, published_at: a.published_at, outlet: a.source?.name },
        status: 'ok',
      });
      if (flags.length >= 3) return flags;
    }
  }
  return flags;
}
