import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AnalystPanel } from '../components/AnalystPanel';
import { getListing } from '../lib/api';
import { dealLabel, eur } from '../lib/format';
import { useFeed } from '../lib/store';
import type { ListingDetail as Detail } from '../lib/types';

/** Step-1 scaffold for /app/l/:id. Step 5 turns this into the drawer (score breakdown, comps, flags, map, fan-out). */
export default function ListingDetail() {
  const { id = '' } = useParams();
  const { byId, calls } = useFeed();
  const [detail, setDetail] = useState<Detail | null | undefined>(undefined);

  useEffect(() => {
    const ac = new AbortController();
    getListing(id, ac.signal).then((r) => setDetail(r.data)).catch(() => {});
    return () => ac.abort();
  }, [id]);

  const l = byId[id] ?? detail; // live store first, so streamed patches show immediately
  if (detail === undefined && !l) return <p className="muted">Loading…</p>;
  if (!l) return <p>Listing not found. <Link to="/app">Back to feed</Link></p>;
  const callRows = calls[id]?.length ? calls[id] : detail?.calls ?? [];

  return (
    <>
    <div className="detail-scaffold">
      <p className="t-eyebrow muted">{l._id}</p>
      <h2 className="t-h3">{l.address}</h2>
      <p className="t-num-m">
        fair {eur(l.score?.fair_price)} {l.score && `· ${dealLabel(l.score.deal_pct)} · ${l.score.confidence}`}
      </p>
      <p className="t-body-s">{l.flags.map((f) => `${f.label} (${f.status})`).join(' · ') || 'no flags yet'}</p>
      <p className="t-num-s muted">{callRows.length} Context.dev calls recorded</p>
    </div>
    <AnalystPanel listing={l} />
    </>
  );
}
