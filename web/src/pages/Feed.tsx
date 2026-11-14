import { useEffect, useState } from 'react';
import { Link, Outlet, useOutletContext } from 'react-router-dom';
import { ago, dealLabel, dealTone, factsLine, priceLabel } from '../lib/format';
import { useFeed, useListings } from '../lib/store';
import type { Kind } from '../lib/types';

/** Step-1 scaffold: proves list fetch + stream merge work. Step 2 replaces the rows with ListingCard + map. */
export default function Feed() {
  const { kind } = useOutletContext<{ kind: Kind }>();
  const listings = useListings(kind);
  const { source, loading, fresh, priceChanges, calls } = useFeed();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  return (
    <div className="scaffold">
      <h1 className="t-h3">New in Helsinki <span className="t-num-s muted">{listings.length}</span></h1>
      {source === 'fixtures' && <p className="scaffold__note t-body-s">Server unreachable, showing data/fixtures.</p>}
      {loading && <p className="muted">Loading…</p>}
      {listings.map((l) => {
        const pct = l.score?.deal_pct;
        const change = priceChanges[l._id];
        return (
          <Link key={l._id} to={`/app/l/${encodeURIComponent(l._id)}?kind=${kind}`} className={`scaffold__row${fresh[l._id] ? ' is-fresh' : ''}`}>
            <span className="t-h4">{l.address ?? l._id}</span>
            <span className="t-num-m">{priceLabel(l)}</span>
            <span className="t-body-s muted">{[l.district, factsLine(l)].filter(Boolean).join(' · ')}</span>
            <span className={`t-num-s deal-${pct != null ? dealTone(pct) : 'fair'}`}>
              {pct != null ? dealLabel(pct) : l.status === 'ready' ? 'no score' : 'scoring…'}
            </span>
            <span className="t-num-s muted">
              seen {ago(l.first_seen_at, now)} · {l.flags.length} flags · {calls[l._id]?.length ?? 0} calls
              {change && ` · price ${change.new_price < change.old_price ? 'dropped' : 'changed'}`}
            </span>
          </Link>
        );
      })}
      <Outlet />
    </div>
  );
}
