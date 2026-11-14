// Rule-based hidden-cost flags from a listing's own fields (no API calls, instant, quotes the source).
// Costs are rough Helsinki rules of thumb (€ per m² of the flat), shown as "≈" estimates.

const NOW_YEAR = new Date().getFullYear();

// Order matters: first match wins for a given renovation line.
const RULES = [
  { type: 'pipe_renovation', re: /linjasaneeraus|linjasaneerauks|putkiremont|lvis|lvi-saneeraus|putkisto\w*\s*(uusi|saneer)|sukitus|pinnoitus/i, label: 'Pipe renovation', severity: 'high', eurM2: 900 },
  { type: 'renovation_upcoming', re: /viemär|vesijohto|käyttövesi|putki/i, label: 'Plumbing repairs', severity: 'warn', eurM2: null },
  { type: 'facade_balcony', re: /julkisivu|parvek/i, label: 'Facade / balcony renovation', severity: 'high', eurM2: 350 },
  { type: 'renovation_upcoming', re: /vesikatto|katto(?!kaivo)|kattoremont/i, label: 'Roof renovation', severity: 'warn', eurM2: 120 },
  { type: 'renovation_upcoming', re: /ikkun\w*\s*(uusi|vaihto|remont|korjau)|ikkunaremont/i, label: 'Window replacement', severity: 'warn', eurM2: 150 },
  { type: 'renovation_upcoming', re: /hissi\w*\s*(uusi|modernis|rakent|peruskorj)|hissiremont/i, label: 'Lift renovation', severity: 'warn', eurM2: 80 },
  { type: 'renovation_upcoming', re: /sähkö\w*\s*(saneeraus|uusi|remont)|sähköremont/i, label: 'Electrical renovation', severity: 'warn', eurM2: 100 },
];
// Inspections, maintenance and studies: not a renovation cost.
const IGNORE = /kuntoarvio|kuntotutkimus|tarkastus|tarkistus|selvitys|huolto|kartoitus|huuhtelu|kuvaus|latausratkaisu|lisärakent|säätö/i;
const PLANNING = /suunnittelu|hankesuunnit/i;

let n = 0;
const fid = () => `f_${Date.now().toString(36)}${(++n).toString(36)}`;

/** Split free text like "2026 X; 2027 Y (…)" into [{year, text}] lines. */
export function splitRenovations(text) {
  if (!text) return [];
  return text
    .split(/[;\n•]|(?<=\.)\s+(?=\d{4})/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const years = [...s.matchAll(/\b(19[5-9]\d|20[0-4]\d)\b/g)].map((m) => Number(m[1]));
      return { year: years.length ? Math.min(...years) : null, text: s };
    });
}

/** @returns {import('../../docs/contracts.md').Flag[]} */
export function listingFlags(l) {
  const flags = [];
  const src = (quote) => ({ kind: l.portal === 'mock' ? 'listing' : 'listing', url: l.url, quote, page: null });
  const seen = new Set();

  for (const { year, text } of splitRenovations(l.renovations_upcoming)) {
    if (IGNORE.test(text)) continue;
    const rule = RULES.find((r) => r.re.test(text));
    if (!rule) continue;
    const planningOnly = PLANNING.test(text);
    if (year && (year < NOW_YEAR - 1 || year > NOW_YEAR + 6)) continue;
    const key = `${rule.label}:${year}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const cost = l.kind === 'sale' && l.m2 && rule.eurM2 ? Math.round((rule.eurM2 * l.m2) / 1000) * 1000 : null;
    flags.push({
      id: fid(),
      type: rule.type,
      severity: planningOnly && rule.severity === 'high' ? 'warn' : rule.severity,
      label: planningOnly ? `${rule.label} being planned${year ? ` (${year})` : ''}` : `${rule.label}${year ? ` ${year}` : ' planned'}`,
      detail: l.kind === 'rent'
        ? `Planned by the housing company${year ? ` for ${year}` : ''}. ${rule.type === 'pipe_renovation' ? 'Tenants usually have to move out for 2–4 months.' : 'Expect noise and scaffolding.'}`
        : `Planned by the housing company${year ? ` for ${year}` : ''}. ${rule.eurM2 ? `Typical cost ≈ €${rule.eurM2}/m², paid by owners through a special charge or loan.` : 'Cost depends on the scope; ask for the maintenance plan.'}`,
      est_cost_eur: cost,
      year,
      source: src(text),
      status: 'ok',
    });
  }

  // Positive signal: the big one is already done.
  const done = splitRenovations(l.renovations_done).find((r) => RULES[0].re.test(r.text) && !IGNORE.test(r.text) && r.year >= 1995);
  if (done) {
    flags.push({ id: fid(), type: 'renovation_upcoming', severity: 'info', label: `Pipe renovation done${done.year ? ` ${done.year}` : ''}`, detail: 'The most expensive housing-company renovation is already behind it.', est_cost_eur: null, year: done.year, source: src(done.text), status: 'ok' });
  }

  if (l.tenure === 'right_of_occupancy' || l.tenure === 'part_ownership') {
    flags.push({ id: fid(), type: 'company_loan', severity: 'info', label: l.tenure === 'right_of_occupancy' ? 'Right-of-occupancy flat' : 'Part-ownership flat', detail: 'The listed price is a deposit, not a market price, so there is no fair-value score.', est_cost_eur: null, year: null, source: src(l.agent_company ?? ''), status: 'ok' });
  }
  if (l.kind === 'sale') {
    if (l.plot === 'leased') flags.push({ id: fid(), type: 'leased_plot', severity: 'warn', label: 'Leased plot', detail: 'Plot rent is part of the monthly fee and can rise when the lease is renewed.', est_cost_eur: null, year: null, source: src('Tontti: vuokrattu'), status: 'ok' });
    const debt = l.debt_free_price && l.price ? l.debt_free_price - l.price : l.debt_share;
    if (debt && l.debt_free_price && debt / l.debt_free_price > 0.25) {
      flags.push({ id: fid(), type: 'company_loan', severity: debt / l.debt_free_price > 0.4 ? 'high' : 'warn', label: `Company loan ${Math.round((debt / l.debt_free_price) * 100)}% of price`, detail: `€${debt.toLocaleString('en')} of the debt-free price is housing-company debt, repaid through a financing charge.`, est_cost_eur: debt, year: null, source: src(`Velkaosuus ${debt} €`), status: 'ok' });
    }
    if (l.fee_m2 && l.fee_m2 > 6) flags.push({ id: fid(), type: 'high_fee', severity: 'warn', label: `High maintenance fee €${l.fee_m2}/m²`, detail: 'Above the typical Helsinki level of about €4–5/m² per month.', est_cost_eur: null, year: null, source: src(`Hoitovastike ${l.fee_month} €/kk`), status: 'ok' });
  }
  return flags;
}
