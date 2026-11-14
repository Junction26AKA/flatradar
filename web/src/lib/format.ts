import { translate, type MessageKey } from './messages';
import { roomsToEnglish } from './rooms';
import type { Listing } from './types';

/**
 * Formatting follows the selected language (set by I18nProvider through setFormatLang):
 * EN "€236,738" / "5 min ago", FI "236 738 €" / "5 min sitten". Plain functions, so cards and maps can
 * call them without hooks; components re-render on a language change because they read useI18n().
 */
type Lang = 'en' | 'fi';
let lang: Lang = 'en';
export const setFormatLang = (l: Lang) => { lang = l; };
export const formatLang = () => lang;

const msg = (key: MessageKey, vars?: Record<string, unknown>) => translate(lang, key, vars);

const EUR = {
  en: new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }),
  fi: new Intl.NumberFormat('fi-FI', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }),
};
const int = new Intl.NumberFormat('fi-FI', { maximumFractionDigits: 0 }); // "6 646": Finnish thin-space grouping in both languages
const DEC: Record<Lang, Intl.NumberFormat[]> = {
  en: [0, 1, 2].map((d) => new Intl.NumberFormat('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: false })),
  fi: [0, 1, 2].map((d) => new Intl.NumberFormat('fi-FI', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: false })),
};
/** A plain decimal in the current language: EN "82.5", FI "82,5". */
export const decimal = (n: number, digits: 0 | 1 | 2) => DEC[lang][digits].format(n);
/** A percentage in the current language: EN "8.2%", FI "8,2 %". */
export const percent = (n: number, digits: 0 | 1) => (lang === 'fi' ? `${decimal(n, digits)} %` : `${decimal(n, digits)}%`);
const dec1 = new Intl.NumberFormat('fi-FI', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const eur = (n: number | null | undefined) => (n == null ? '—' : EUR[lang].format(n));
export const num = (n: number | null | undefined) => (n == null ? '—' : int.format(n));
export const m2 = (n: number | null | undefined) => (n == null ? '—' : `${Number.isInteger(n) ? n : decimal(n, 1)} m²`);

/** The asking price everything compares on: debt-free for a sale, monthly rent for a rental. */
export function askingPrice(l: Listing): number | null {
  return l.kind === 'rent' ? l.rent ?? null : l.debt_free_price ?? l.price ?? null;
}
export function pricePerM2(l: Listing): number | null {
  const p = askingPrice(l);
  return p != null && l.m2 ? p / l.m2 : null;
}
export const priceLabel = (l: Listing) => (l.kind === 'rent' ? `${eur(l.rent)}${msg('unit.month')}` : eur(l.price ?? l.debt_free_price));

export type DealTone = 'good' | 'fair' | 'bad';
/** Within ±3% we call it fair; that is well inside the model's error. */
export function dealTone(pct: number): DealTone {
  if (pct <= -0.03) return 'good';
  if (pct >= 0.03) return 'bad';
  return 'fair';
}
export function dealLabel(pct: number): string {
  const p = Math.abs(pct * 100);
  const s = decimal(p, p >= 10 ? 0 : 1);
  const tone = dealTone(pct);
  return msg(tone === 'fair' ? 'deal.fair' : tone === 'good' ? 'deal.good' : 'deal.bad', { p: s });
}

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return msg('ago.s', { n: s });
  const m = Math.round(s / 60);
  if (m < 60) return msg('ago.min', { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return msg('ago.h', { n: h });
  return msg('ago.d', { n: Math.round(h / 24) });
}
/** "5 min" without "ago" / "sitten", for compact cards. */
export const agoShort = (iso: string | null | undefined, now = Date.now()) => ago(iso, now).replace(/ (ago|sitten)$/, '');

/** "Laajasalo, Kruunuvuorenranta, Helsinki" → "Laajasalo" */
export const shortDistrict = (l: Listing) => l.district?.split(',')[0].trim() || null;
/** "Wavulinintie 5, Helsinki" → "Wavulinintie 5" */
export const shortAddress = (l: Listing) => l.address?.replace(/,\s*(\d{5}\s*)?Helsinki$/i, '').trim() || l._id;

/** Sale: "6 646 €/m²". Rent: "18,3 €/m²/mo" (monthly rent is small, so one decimal). */
export function perM2(n: number | null | undefined, kind: Listing['kind']): string {
  if (n == null) return '—';
  return kind === 'rent' ? `${dec1.format(n)} €/m²${msg('unit.month')}` : `${int.format(n)} €/m²`;
}

/** The listing's room layout: the portal's Finnish codes in FI, plain English in EN. */
export function roomsText(l: Listing): string | null {
  if (l.rooms_description) return lang === 'fi' ? l.rooms_description : roomsToEnglish(l.rooms_description);
  return l.rooms ? msg('unit.rooms', { n: l.rooms }) : null;
}

export const factsLine = (l: Listing) =>
  [roomsText(l), l.m2 ? m2(l.m2) : null, l.year, l.floor != null && l.floors_total ? `${l.floor}/${l.floors_total}` : null]
    .filter(Boolean)
    .join(' · ');
