import { useEffect, useRef, useSyncExternalStore } from 'react';
import sample from '@fixtures/sse-sample.txt?raw';
import { eventTime, parseSse } from './sse';
import { STREAM_EVENT_TYPES, type StreamEvent } from './types';

/**
 * One shared connection to GET /stream for the whole app.
 * - `live`: EventSource is open.
 * - `replay`: the server is unreachable, so we replay data/fixtures/sse-sample.txt with its real timing
 *   (gaps clamped), looping, so the landing page and /app still move during design work and offline demos.
 * Force a mode with ?stream=replay or ?stream=live (handy on stage).
 */
export type StreamStatus = 'connecting' | 'live' | 'replay';
type Listener = (e: StreamEvent) => void;

const listeners = new Set<Listener>();
const statusListeners = new Set<() => void>();
let status: StreamStatus = 'connecting';
let es: EventSource | null = null;
let replayTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;

const CONNECT_TIMEOUT_MS = 4000;
const REPLAY_GAP = { min: 180, max: 2200 };
const REPLAY_LOOP_PAUSE_MS = 6000;

function setStatus(s: StreamStatus) {
  if (s === status) return;
  status = s;
  statusListeners.forEach((l) => l());
}

function emit(e: StreamEvent) {
  listeners.forEach((l) => {
    try { l(e); } catch (err) { console.error('stream listener failed', err); }
  });
}

/** Replayed events get fresh ids/timestamps each loop, so "seen 3 s ago" and new-card animations stay true. */
function restamp(e: StreamEvent, loop: number, now: number): StreamEvent {
  const iso = new Date(now).toISOString();
  const suffix = loop ? `~${loop}` : '';
  const id = (s: string) => (s.startsWith('mock:') ? s + suffix : s);
  switch (e.type) {
    case 'listing.new':
      return { ...e, data: { listing: { ...e.data.listing, _id: id(e.data.listing._id), first_seen_at: iso, last_seen_at: iso } } };
    case 'listing.updated':
      return { ...e, data: { ...e.data, id: id(e.data.id) } };
    case 'call.start':
      return { ...e, data: { ...e.data, id: e.data.id + suffix, listing_id: id(e.data.listing_id), queued_at: iso, started_at: iso } };
    case 'call.end':
      return { ...e, data: { ...e.data, id: e.data.id + suffix, listing_id: id(e.data.listing_id), started_at: new Date(now - e.data.ms).toISOString() } };
    case 'alert.sent':
      return { ...e, data: { ...e.data, listing_id: id(e.data.listing_id), at: iso } };
    case 'listing.price_drop':
      return { ...e, data: { ...e.data, at: iso } };
    default:
      return e;
  }
}

function startReplay() {
  stopLive();
  setStatus('replay');
  const events = parseSse(sample);
  let i = 0;
  let loop = 0;
  const step = () => {
    if (i >= events.length) {
      i = 0;
      loop += 1;
      replayTimer = setTimeout(step, REPLAY_LOOP_PAUSE_MS);
      return;
    }
    const e = events[i];
    emit(restamp(e, loop, Date.now()));
    const next = events[i + 1];
    i += 1;
    const t0 = eventTime(e);
    const t1 = next ? eventTime(next) : null;
    const gap = t0 != null && t1 != null ? t1 - t0 : 400;
    replayTimer = setTimeout(step, Math.min(REPLAY_GAP.max, Math.max(REPLAY_GAP.min, gap)));
  };
  replayTimer = setTimeout(step, 600);
}

function stopLive() {
  es?.close();
  es = null;
}

function startLive() {
  if (typeof EventSource === 'undefined') return startReplay();
  setStatus('connecting');
  let opened = false;
  const timeout = setTimeout(() => { if (!opened) startReplay(); }, CONNECT_TIMEOUT_MS);
  es = new EventSource('/stream');
  es.onopen = () => {
    opened = true;
    clearTimeout(timeout);
    if (replayTimer) { clearTimeout(replayTimer); replayTimer = null; }
    setStatus('live');
  };
  es.onerror = () => {
    // Before the first open: no server, fall back to the replay. After: EventSource retries by itself (retry: 3000).
    if (!opened) { clearTimeout(timeout); startReplay(); }
    else setStatus('connecting');
  };
  for (const type of STREAM_EVENT_TYPES) {
    es.addEventListener(type, (m) => {
      if (es?.readyState === EventSource.OPEN) setStatus('live');
      try { emit({ type, data: JSON.parse((m as MessageEvent<string>).data) } as StreamEvent); }
      catch { /* ignore malformed */ }
    });
  }
}

function ensureStarted() {
  if (started) return;
  started = true;
  const forced = new URLSearchParams(location.search).get('stream');
  if (forced === 'replay') startReplay();
  else startLive();
}

/** Subscribe to every stream event. The handler can change between renders without resubscribing. */
export function useStream(handler: Listener) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    ensureStarted();
    const l: Listener = (e) => ref.current(e);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
}

export function useStreamStatus(): StreamStatus {
  return useSyncExternalStore(
    (cb) => { ensureStarted(); statusListeners.add(cb); return () => statusListeners.delete(cb); },
    () => status,
    () => status,
  );
}
