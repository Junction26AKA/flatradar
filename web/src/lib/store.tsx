import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { getListing, getListings, loadMoreListings, LISTINGS_PAGE, type Source } from './api';
import { useStream } from './stream';
import type { CallEnd, CallStart, Kind, Listing, StreamEvent } from './types';

export interface CallRow extends Partial<CallEnd> {
  id: string;
  listing_id: string;
  endpoint: string;
  label: string;
  started_at: string;
  /** undefined while running */
  ms?: number;
  status?: 'ok' | 'error';
}
export interface PriceChange { old_price: number; new_price: number; at: string }
export interface AlertSent { listing_id: string; to: string; at: string }

export interface FeedState {
  byId: Record<string, Listing>;
  /** newest first_seen_at first */
  order: string[];
  calls: Record<string, CallRow[]>;
  priceChanges: Record<string, PriceChange>;
  alerts: AlertSent[];
  /** ids that arrived over the stream in this session (for the slide-in + glow) */
  fresh: Record<string, number>;
  source: Source | null;
  loading: boolean;
}

type Action =
  | { type: 'loaded'; items: Listing[]; source: Source }
  | { type: 'merge'; items: Listing[] }
  | { type: 'event'; event: StreamEvent };

const initial: FeedState = { byId: {}, order: [], calls: {}, priceChanges: {}, alerts: [], fresh: {}, source: null, loading: true };

const byNewest = (byId: Record<string, Listing>) => (a: string, b: string) =>
  Date.parse(byId[b].first_seen_at) - Date.parse(byId[a].first_seen_at);

function reducer(s: FeedState, a: Action): FeedState {
  if (a.type === 'loaded') {
    const byId = { ...s.byId };
    const priceChanges = { ...s.priceChanges };
    for (const l of a.items) {
      byId[l._id] = { ...l, ...byId[l._id] }; // stream data that already arrived wins
      if (l.last_price_drop && !priceChanges[l._id]) priceChanges[l._id] = l.last_price_drop;
    }
    return { ...s, byId, priceChanges, order: Object.keys(byId).sort(byNewest(byId)), source: a.source, loading: false };
  }
  if (a.type === 'merge') {
    // Older pages of the feed, and single listings fetched on demand (e.g. a saved flat not loaded yet).
    const byId = { ...s.byId };
    const priceChanges = { ...s.priceChanges };
    for (const l of a.items) {
      byId[l._id] = { ...l, ...byId[l._id] };
      if (l.last_price_drop && !priceChanges[l._id]) priceChanges[l._id] = l.last_price_drop;
    }
    return { ...s, byId, priceChanges, order: Object.keys(byId).sort(byNewest(byId)) };
  }
  const e = a.event;
  switch (e.type) {
    case 'listing.new': {
      // listing.new may arrive before enrichment: default the arrays/objects the UI reads.
      const l: Listing = { ...e.data.listing, flags: e.data.listing.flags ?? [], score: e.data.listing.score ?? null };
      const byId = { ...s.byId, [l._id]: { ...s.byId[l._id], ...l } };
      return { ...s, byId, order: Object.keys(byId).sort(byNewest(byId)), fresh: { ...s.fresh, [l._id]: Date.now() } };
    }
    case 'listing.updated': {
      const cur = s.byId[e.data.id];
      if (!cur) return s; // a patch for something we never saw; the next list fetch will bring it
      return { ...s, byId: { ...s.byId, [e.data.id]: { ...cur, ...e.data.patch } } };
    }
    case 'listing.price_drop': {
      const { id, ...change } = e.data;
      const cur = s.byId[id];
      const byId = cur
        ? { ...s.byId, [id]: { ...cur, ...(cur.kind === 'rent' ? { rent: change.new_price } : { price: change.new_price }) } }
        : s.byId;
      return { ...s, byId, priceChanges: { ...s.priceChanges, [id]: change } };
    }
    case 'call.start': {
      const c: CallRow = { ...(e.data as CallStart) };
      const list = s.calls[c.listing_id] ?? [];
      return { ...s, calls: { ...s.calls, [c.listing_id]: [...list.filter((x) => x.id !== c.id), c] } };
    }
    case 'call.end': {
      const c = e.data;
      const list = s.calls[c.listing_id] ?? [];
      const has = list.some((x) => x.id === c.id);
      const next = has ? list.map((x) => (x.id === c.id ? { ...x, ...c } : x)) : [...list, c];
      return { ...s, calls: { ...s.calls, [c.listing_id]: next } };
    }
    case 'alert.sent':
      return { ...s, alerts: [e.data, ...s.alerts].slice(0, 50) };
    default:
      return s;
  }
}

const Ctx = createContext<FeedState | null>(null);
const EnsureCtx = createContext<(ids: string[]) => void>(() => {});

/** Holds every listing we know about: the initial GET /api/listings plus everything from /stream. */
export function FeedProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  useEffect(() => {
    // Fetch each kind separately: rentals far outnumber sales, so one mixed "newest 100" would hide the sales.
    // Show the newest page of each kind straight away, then merge in the older pages as they arrive.
    const ac = new AbortController();
    const kinds = ['sale', 'rent'] as const;
    Promise.all(kinds.map((k) => getListings(k, LISTINGS_PAGE, ac.signal)))
      .then((rs) => {
        // If either kind came from the server, show only server data: never mix fixtures into a live feed.
        const live = rs.filter((r) => r.source === 'live');
        const use = live.length ? live : rs;
        dispatch({ type: 'loaded', items: use.flatMap((r) => r.data), source: live.length ? 'live' : 'fixtures' });
        rs.forEach((r, i) => {
          if (r.source === 'live' && r.data.length === LISTINGS_PAGE) {
            loadMoreListings(kinds[i], (items) => dispatch({ type: 'merge', items }), ac.signal).catch(() => {});
          }
        });
      })
      .catch(() => {});
    return () => ac.abort();
  }, []);
  useStream((event) => dispatch({ type: 'event', event }));
  // Fetch listings we don't have yet (once per id per session). Waits for the first list load.
  const requested = useRef(new Set<string>());
  const loadedRef = useRef(state);
  loadedRef.current = state;
  const ensure = useCallback((ids: string[]) => {
    const s = loadedRef.current;
    if (s.loading || s.source === 'fixtures') return;
    const missing = ids.filter((id) => !s.byId[id] && !requested.current.has(id));
    if (!missing.length) return;
    missing.forEach((id) => requested.current.add(id));
    Promise.all(missing.map((id) => getListing(id).then((r) => (r.source === 'live' ? r.data : null)).catch(() => null)))
      .then((rs) => { const items = rs.filter((x): x is NonNullable<typeof x> => !!x); if (items.length) dispatch({ type: 'merge', items }); });
  }, []);
  return <EnsureCtx.Provider value={ensure}><Ctx.Provider value={state}>{children}</Ctx.Provider></EnsureCtx.Provider>;
}

export function useFeed(): FeedState {
  const s = useContext(Ctx);
  if (!s) throw new Error('useFeed must be used inside <FeedProvider>');
  return s;
}

export function useListings(kind?: Kind): Listing[] {
  const { byId, order } = useFeed();
  return useMemo(() => order.map((id) => byId[id]).filter((l) => !kind || l.kind === kind), [byId, order, kind]);
}

/** Makes sure these listings are in the store, fetching any that the initial list didn't include. */
export function useEnsureListings(ids: string[] | undefined) {
  const ensure = useContext(EnsureCtx);
  const { loading } = useFeed();
  const key = (ids ?? []).join('|');
  useEffect(() => { if (!loading && ids?.length) ensure(ids); }, [key, loading, ensure]); // eslint-disable-line react-hooks/exhaustive-deps
}
