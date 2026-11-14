// What each listing photo shows (kitchen, bathroom, living space, outside, floor plan, other), from Gemini.
// One call per listing with every photo as a small thumbnail, so it's cheap enough to run on all photos,
// unlike AI Vision (add-on tokens, top deals only). The web app only offers the "after renovation" preview
// on photos classified here as an interior room, so an unclassified photo must never count as one.
import { track } from '../context.mjs';

const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_ROOMS_MODEL || process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const THINKING = /^gemini-([3-9]|\d{2})\b/.test(MODEL) ? { thinkingConfig: { thinkingLevel: 'low' } } : {};

export const roomsEnabled = !!KEY;

/** Gemini label → PhotoRoom stored on the photo. */
const MAP = { kitchen: 'kitchen', bathroom: 'bathroom', living: 'room', exterior: 'exterior', plan: 'plan', other: 'other' };

const PROMPT = `You will see numbered photos from one Finnish apartment listing. For each, say what it mainly shows:
- kitchen: a kitchen or kitchenette (cabinets, worktop, stove), even if part of an open-plan room
- bathroom: a bathroom, toilet, shower room or sauna
- living: inside the flat: living room, bedroom, dining area, study or hallway, taken as a normal room photo
- exterior: anything outside: the building's facade, street, yard, balcony view, staircase or other shared spaces
- plan: a floor plan, site plan, map or any drawing
- other: anything else (document, certificate, close-up detail, logo, view through a window, unclear)
Answer "living" only for an ordinary interior room photo where the floor and walls are clearly visible.`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    photos: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { n: { type: 'INTEGER' }, room: { type: 'STRING', enum: Object.keys(MAP) } },
        required: ['n', 'room'],
      },
    },
  },
  required: ['photos'],
};

async function inline(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`thumbnail ${res.status}`);
  return { inlineData: { mimeType: 'image/jpeg', data: Buffer.from(await res.arrayBuffer()).toString('base64') } };
}

/**
 * @param {string[]} urls  small JPEG thumbnails (≈384 px is plenty)
 * @returns {Promise<(string|null)[]>}  PhotoRoom per url, null where Gemini gave no answer
 */
export async function classifyRooms(urls, { listingId } = {}) {
  if (!KEY || !urls.length) return urls.map(() => null);
  const images = await Promise.all(urls.map(inline));
  const parts = [{ text: PROMPT }];
  images.forEach((img, i) => parts.push({ text: `Photo ${i + 1}:` }, img));
  return track('gemini.rooms', async () => {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, ...THINKING },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error?.message ?? `Gemini HTTP ${res.status}`);
    const text = (body.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
    const out = urls.map(() => null);
    for (const r of JSON.parse(text || '{}').photos ?? []) {
      if (r.n >= 1 && r.n <= urls.length && MAP[r.room]) out[r.n - 1] = MAP[r.room];
    }
    return Object.assign(out, { request_id: body.responseId ?? null });
  }, { listingId, label: `Gemini photo rooms (${MODEL})` }).then((r) => [...r]);
}
