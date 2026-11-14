import { STREAM_EVENT_TYPES, type StreamEvent, type StreamEventType } from './types';

/** Parse a raw `text/event-stream` body (e.g. data/fixtures/sse-sample.txt) into typed events. */
export function parseSse(raw: string): StreamEvent[] {
  const out: StreamEvent[] = [];
  for (const block of raw.replace(/\r\n/g, '\n').split(/\n\n+/)) {
    let type = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) type = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (!data.length || !STREAM_EVENT_TYPES.includes(type as StreamEventType)) continue;
    try {
      out.push({ type, data: JSON.parse(data.join('\n')) } as StreamEvent);
    } catch {
      /* skip malformed block */
    }
  }
  return out;
}

/** Best-guess wall-clock time an event happened, so a replay keeps the real rhythm of the fan-out. */
export function eventTime(e: StreamEvent): number | null {
  const d = e.data as Record<string, unknown>;
  const ts = (v: unknown) => (typeof v === 'string' ? Date.parse(v) : NaN);
  let t = NaN;
  switch (e.type) {
    case 'hello': t = ts(e.data.server_time); break;
    case 'listing.new': t = ts(e.data.listing.first_seen_at); break;
    case 'call.start': t = ts(e.data.started_at); break;
    case 'call.end': t = ts(e.data.started_at) + e.data.ms; break;
    case 'listing.updated': t = ts(e.data.patch.score?.scored_at); break;
    default: t = ts(d.at);
  }
  return Number.isFinite(t) ? t : null;
}
