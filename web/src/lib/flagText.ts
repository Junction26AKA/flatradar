import { decimal, eur, formatLang } from './format';
import type { Flag } from './types';

/**
 * Flag chip text. The backend writes English labels from a fixed set of templates
 * (lib/flags/renovations.mjs, neighbourhood.mjs, enrich.mjs). In Finnish we translate each template
 * exactly, keeping its details (year, loan %, fee, street). A label we don't recognise (e.g. one written by
 * the document parser) is shown as the backend wrote it: an untranslated label is better than a vaguer,
 * possibly wrong one. Detail sentences and source quotes are left as they are.
 *
 * Better long-term: the backend sends a message key plus values (type, year, pct, street) instead of
 * English prose, so the client never has to parse display text. Until then, keep this table in step with
 * the backend templates.
 */
const RENOVATION: Record<string, string> = {
  'Pipe renovation': 'Putkiremontti',
  'Plumbing repairs': 'Putkikorjauksia',
  'Facade / balcony renovation': 'Julkisivu- ja parvekeremontti',
  'Roof renovation': 'Kattoremontti',
  'Window replacement': 'Ikkunoiden vaihto',
  'Lift renovation': 'Hissiremontti',
  'Electrical renovation': 'Sähköremontti',
};
const renoAlt = Object.keys(RENOVATION).map((k) => k.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|');

const RULES: [RegExp, (m: RegExpMatchArray) => string][] = [
  // "Facade / balcony renovation being planned (2026)" | "… being planned"
  [new RegExp(`^(${renoAlt}) being planned(?: \\((\\d{4})\\))?$`), (m) => `${RENOVATION[m[1]]} suunnitteilla${m[2] ? ` (${m[2]})` : ''}`],
  // "Roof renovation 2027"
  [new RegExp(`^(${renoAlt}) (\\d{4})$`), (m) => `${RENOVATION[m[1]]} ${m[2]}`],
  // "Lift renovation planned"
  [new RegExp(`^(${renoAlt}) planned$`), (m) => `${RENOVATION[m[1]]} tulossa`],
  [/^Pipe renovation done(?: (\d{4}))?$/, (m) => `Putkiremontti tehty${m[1] ? ` ${m[1]}` : ''}`],
  [/^Company loan (\d+)% of price$/, (m) => `Yhtiölaina ${m[1]} % hinnasta`],
  [/^High maintenance fee €([\d.]+)\/m²$/, (m) => `Korkea vastike ${decimal(Number(m[1]), 1)} €/m²`],
  [/^Works on (.+)$/, (m) => `Katutöitä: ${m[1]}`],
  [/^Construction in (.+)$/, (m) => `Rakennustyömaa: ${m[1]}`],
  [/^Leased plot$/, () => 'Vuokratontti'],
  [/^Right-of-occupancy flat$/, () => 'Asumisoikeusasunto'],
  [/^Part-ownership flat$/, () => 'Osaomistusasunto'],
  [/^Checking local news…$/, () => 'Tarkistetaan paikallisuutisia…'],
  [/^Reading documents…$/, () => 'Luetaan asiakirjoja…'],
];

export function flagLabel(f: Flag): string {
  if (formatLang() === 'en') return f.label;
  for (const [re, fi] of RULES) {
    const m = f.label.match(re);
    if (m) return fi(m);
  }
  return f.label;
}

export const flagCost = (f: Flag) => (f.est_cost_eur ? ` · ≈${eur(f.est_cost_eur)}` : '');
