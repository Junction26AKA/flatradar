import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { Coin } from '../components/Coin';
import { ListingCard } from '../components/ListingCard';
import { useAuth } from '../lib/auth';
import { dealLabel, shortDistrict } from '../lib/format';
import { matchesAny } from '../lib/match';
import { useFeed, useListings } from '../lib/store';
import type { Kind, Listing } from '../lib/types';
import { useNow } from '../lib/useNow';
import './feed.css';

const ListingMap = lazy(() => import('../components/ListingMap'));
const PAGE = 40;

type Filter = 'good' | 'match';

/** /app and /app/l/:id: feed | map | (detail drawer when a listing is open). */
export default function Feed() {
  const { kind } = useOutletContext<{ kind: Kind }>();
  const { id: selectedId = null } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const all = useListings(kind);
  const { source, loading, fresh, priceChanges } = useFeed();
  const now = useNow();
  const [filters, setFilters] = useState<Set<Filter>>(new Set());
  const [limit, setLimit] = useState(PAGE);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(false); // mobile only
  const listRef = useRef<HTMLDivElement>(null);

  const searches = user?.searches;
  const listings = useMemo(
    () =>
      all.filter((l) =>
        (!filters.has('good') || (l.score && l.score.deal_pct <= -0.03)) &&
        (!filters.has('match') || matchesAny(l, searches)),
      ),
    [all, filters, searches],
  );
  const toggle = (f: Filter) => setFilters((s) => { const n = new Set(s); if (n.has(f)) n.delete(f); else n.add(f); return n; });
  const link = (id: string) => `/app/l/${encodeURIComponent(id)}?kind=${kind}`;
  const open = (id: string) => nav(link(id));
  const toast = useNewDealToast(all, fresh);

  // Keep the open card in view when it was chosen from the map.
  useEffect(() => {
    if (!selectedId) return;
    listRef.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedId]);

  return (
    <div className={`feed${selectedId ? ' feed--detail' : ''}${showMap ? ' feed--map-open' : ''}`}>
      <section className="feed__list" ref={listRef} aria-label="Listings">
        <header className="feed__head">
          <h1 className="t-h3">
            New in Helsinki <span className="t-num-s muted">{listings.length}{listings.length !== all.length && ` of ${all.length}`}</span>
          </h1>
          <div className="feed__filters" role="group" aria-label="Filters">
            <button className="fchip" aria-pressed={filters.has('good')} onClick={() => toggle('good')}>Good deals</button>
            {!!searches?.length && <button className="fchip" aria-pressed={filters.has('match')} onClick={() => toggle('match')}>Matches my search</button>}
            <button className="fchip feed__maptoggle" aria-pressed={showMap} onClick={() => setShowMap((v) => !v)}>Map</button>
          </div>
          {source === 'fixtures' && <p className="feed__note t-body-s">Can’t reach the server, so this is sample data.</p>}
          {toast && (
            <button className="feed__toast t-label" onClick={() => open(toast.id)}>
              <Coin size={18} /> New deal just landed · {toast.where} {toast.deal}
            </button>
          )}
        </header>

        {loading && !all.length && <div className="feed__skel" aria-busy="true">{[0, 1, 2].map((i) => <span key={i} />)}</div>}
        {!loading && !listings.length && (
          <p className="feed__empty muted">
            {all.length ? 'Nothing matches these filters right now.' : `No ${kind === 'rent' ? 'rentals' : 'flats for sale'} yet. New ones appear here the moment they’re listed.`}
          </p>
        )}

        <div className="feed__cards">
          {listings.slice(0, limit).map((l) => (
            <div key={l._id} data-id={l._id}>
              <ListingCard
                listing={l}
                now={now}
                to={link(l._id)}
                fresh={!!fresh[l._id]}
                selected={l._id === selectedId}
                matches={matchesAny(l, searches)}
                priceChange={priceChanges[l._id]}
                onHover={setHoverId}
              />
            </div>
          ))}
        </div>
        {listings.length > limit && (
          <button className="feed__more t-label" onClick={() => setLimit((n) => n + PAGE)}>
            Show {Math.min(PAGE, listings.length - limit)} more
          </button>
        )}
      </section>

      <section className="feed__map" aria-label="Map">
        <Suspense fallback={<div className="feed__mapload" />}>
          <ListingMap listings={listings} selectedId={selectedId} hoverId={hoverId} freshIds={fresh} onSelect={open} />
        </Suspense>
      </section>

      {selectedId && (
        <aside className="feed__detail" aria-label="Listing detail">
          <button className="feed__close" onClick={() => nav(`/app?kind=${kind}`)} aria-label="Close detail">×</button>
          <Outlet />
        </aside>
      )}
    </div>
  );
}

/** Shows "New deal just landed" for 8 s when a good deal arrives over the stream (or gets scored as one). */
function useNewDealToast(all: Listing[], fresh: Record<string, number>) {
  const [toast, setToast] = useState<{ id: string; where: string; deal: string } | null>(null);
  const shown = useRef(new Set<string>());
  useEffect(() => {
    const hit = all.find((l) => fresh[l._id] && l.score && l.score.deal_pct <= -0.03 && !shown.current.has(l._id));
    if (!hit?.score) return;
    shown.current.add(hit._id);
    setToast({ id: hit._id, where: shortDistrict(hit) ?? '', deal: dealLabel(hit.score.deal_pct) });
  }, [all, fresh]);
  // The hide timer depends only on the toast: listing updates keep changing `all`, and must not cancel it.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);
  return toast;
}
