// Attachment PDFs (sales brochure, isännöitsijäntodistus): parse with Context.dev and run the same
// renovation rules over the extracted text, keeping the page number as the source.
import { context, call } from '../context.mjs';
import { listingFlags } from './renovations.mjs';

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    renovations_planned: { type: ['string', 'null'], description: 'Planned / upcoming renovations (PTS, kunnossapitotarveselvitys), one per line with year, verbatim' },
    renovations_done: { type: ['string', 'null'], description: 'Completed renovations with year, verbatim' },
    company_loans_eur: { type: ['number', 'null'], description: 'Housing company total loans (yhtiölainat)' },
    plot: { type: ['string', 'null'], enum: ['own', 'leased', null] },
    page_hint: { type: ['integer', 'null'], description: 'Page where the renovation plan appears' },
  },
};

/** @returns {Promise<Flag[]>} */
export async function documentFlags(l) {
  const docs = (l.attachments ?? []).filter((a) => /\.pdf($|\?)/i.test(a.url) || /todistus|esite|tilinpäätös|pts|kunnossapito/i.test(a.title ?? '')).slice(0, 3);
  const results = await Promise.allSettled(docs.map((a) =>
    call('parse.pdf', () => context.web.scrape({
      url: a.url,
      formats: { json: true },
      jsonParams: { schema: PLAN_SCHEMA, instructions: 'Finnish housing-company document. Copy renovation lines verbatim with their years.' },
      sharedParams: { parsers: { pdf: { ocr: 'auto' } } },
      tags: ['flatradar', 'pdf'],
    }), { listingId: l._id, label: a.title || 'attachment.pdf' }).then((r) => ({ a, data: r.json?.data }))));

  const flags = [];
  for (const r of results) {
    if (r.status !== 'fulfilled' || !r.value.data) continue;
    const { a, data } = r.value;
    const fake = { ...l, renovations_upcoming: data.renovations_planned, renovations_done: data.renovations_done, plot: data.plot ?? l.plot };
    for (const f of listingFlags(fake)) {
      if (f.type === 'leased_plot' || f.type === 'high_fee' || f.type === 'company_loan') continue; // already covered by listing fields
      flags.push({ ...f, source: { kind: 'pdf', url: a.url, quote: f.source.quote, page: data.page_hint ?? null, title: a.title } });
    }
  }
  return flags;
}
