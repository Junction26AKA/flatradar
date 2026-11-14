/**
 * Finnish listing room codes → English. "3h + k + kph + p" → "3 rooms + kitchen + bathroom + balcony".
 * Unknown words are left as they are (the original is always available on hover).
 */
const WORDS: [string, string][] = [
  // phrases first (longest match wins anyway, but keep them together for readability)
  ['lasitettu parveke', 'glazed balcony'],
  ['ranskalainen parveke', 'French balcony'],
  ['lasitettu terassi', 'glazed terrace'],
  ['avokeittiö', 'open kitchen'],
  ['keittokomero', 'kitchenette'],
  ['keittiötila', 'kitchen area'],
  ['keittiö', 'kitchen'],
  ['kylpyhuone', 'bathroom'],
  ['pesuhuone', 'washroom'],
  ['vaatehuone', 'walk-in wardrobe'],
  ['makuuhuone', 'bedroom'],
  ['olohuone', 'living room'],
  ['työhuone', 'study'],
  ['kodinhoitohuone', 'utility room'],
  ['ruokailutila', 'dining area'],
  ['eteinen', 'hall'],
  ['alkovi', 'alcove'],
  ['parveke', 'balcony'],
  ['terassi', 'terrace'],
  ['parvi', 'loft'],
  ['piha', 'yard'],
  ['varasto', 'storage'],
  ['sauna', 'sauna'],
  ['lasitettu', 'glazed'],
  ['lasit.', 'glazed'],
  ['las.', 'glazed'],
  ['yj:n mukaan', 'per the housing company'],
  // abbreviations
  ['avok', 'open kitchen'],
  ['parv', 'balcony'],
  ['khh', 'utility room'],
  ['kph', 'bathroom'],
  ['kh', 'bathroom'],
  ['kk', 'kitchenette'],
  ['kt', 'kitchen area'],
  ['vh', 'walk-in wardrobe'],
  ['mh', 'bedroom'],
  ['oh', 'living room'],
  ['th', 'study'],
  ['ph', 'washroom'],
  ['rt', 'dining area'],
  ['et', 'hall'],
  ['var', 'storage'],
  ['alk', 'alcove'],
  ['wc', 'WC'],
  ['k', 'kitchen'],
  ['s', 'sauna'],
  ['p', 'balcony'],
  ['ja', 'and'],
];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// One pass, longest alternatives first, only on whole tokens (not inside other words: "kh" in "khh").
const RE = new RegExp(
  `(?<![\\p{L}])(${[...WORDS].sort((a, b) => b[0].length - a[0].length).map(([w]) => esc(w)).join('|')})(?![\\p{L}])`,
  'giu',
);
const MAP = new Map(WORDS.map(([fi, en]) => [fi.toLowerCase(), en]));

export function roomsToEnglish(s: string): string {
  return s
    // "3h", "3 h", "3h+k" → "3 rooms"
    .replace(/(?<![\p{L}\d])(\d+)\s*h(?![\p{L}])/giu, (_, n) => `${n} ${n === '1' ? 'room' : 'rooms'}`)
    .replace(RE, (m) => MAP.get(m.toLowerCase()) ?? m)
    .replace(/\s*\+\s*/g, ' + ');
}
