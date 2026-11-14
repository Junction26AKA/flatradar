import { useEffect, useMemo, useState } from 'react';
import { getListings, type Source } from '../lib/api';
import { askingPrice } from '../lib/format';
import { useStream } from '../lib/stream';
import type { Listing } from '../lib/types';
import saleScored from '@fixtures/listing-sale-scored.json';

/**
 * Real numbers for the landing story (public GET /api/listings + /stream; fixtures when offline).
 * Nothing on the landing page is invented: if the live data doesn't have something, we fall back to the
 * fixture listing and say "example".
 */
const WEEK = 7 * 24 * 3600 * 1000;
const FIXTURE = saleScored as unknown as Listing;
const real = (l: Listing) => l.portal !== 'mock';

export interface LandingData {
  source: Source | null;
  /** Σ (asking − fair) over overpriced sale listings first seen in the last 7 days */
  overpricing: number;
  overpricedCount: number;
  /** chapter 2: an overpriced flat (asking vs fair) */
  priceExample: { listing: Listing; isExample: boolean };
  /** chapter 3: a flat with real hidden-cost flags */
  costsExample: { listing: Listing; isExample: boolean };
  /** chapter 4: the sources behind one score */
  pricingExample: { listing: Listing; isExample: boolean };
  /** chapter 5: newest scored listings, live */
  ticker: Listing[];
  watched: number;
}

export function useLandingData(): LandingData {
  const [items, setItems] = useState<Listing[]>([]);
  const [source, setSource] = useState<Source | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    getListings('sale', 200, ac.signal).then((r) => { setItems(r.data); setSource(r.source); }).catch(() => {});
    return () => ac.abort();
  }, []);

  // Keep the ticker live: new listings arrive at the top, score/flag patches merge in.
  useStream((e) => {
    if (e.type === 'listing.new' && e.data.listing.kind === 'sale') {
      const l = { ...e.data.listing, flags: e.data.listing.flags ?? [], score: e.data.listing.score ?? null };
      setItems((xs) => [l, ...xs.filter((x) => x._id !== l._id)]);
    } else if (e.type === 'listing.updated') {
      setItems((xs) => xs.map((x) => (x._id === e.data.id ? { ...x, ...e.data.patch } : x)));
    }
  });

  return useMemo(() => {
    const now = Date.now();
    const pool = items.filter(real);
    let overpricing = 0, overpricedCount = 0;
    for (const l of pool) {
      const ask = askingPrice(l);
      if (!l.score || l.score.deal_pct <= 0 || ask == null || now - Date.parse(l.first_seen_at) > WEEK) continue;
      overpricing += ask - l.score.fair_price;
      overpricedCount++;
    }
    const pick = (f: (l: Listing) => boolean, rank: (l: Listing) => number = () => 0) => {
      const c = pool.filter(f).sort((a, b) => rank(b) - rank(a))[0];
      return c ? { listing: c, isExample: false } : { listing: FIXTURE, isExample: true };
    };
    const priceExample = pick((l) => !!l.score && l.score.deal_pct > 0.05 && l.score.deal_pct < 0.2 && !!l.address && askingPrice(l) != null, (l) => (l.score?.confidence === 'high' ? 2 : l.score?.confidence === 'medium' ? 1 : 0));
    const costsExample = pick((l) => l.flags.filter((f) => f.status === 'ok' && f.severity !== 'info').length >= 2, (l) => l.flags.filter((f) => f.source?.quote).length);
    const pricingExample = pick((l) => !!l.score?.comps && (l.score.comps.n ?? 0) >= 3, (l) => (l.score?.model ? 2 : 0) + (l.score?.baseline ? 1 : 0));
    // Real listings, plus the demo's mock flat only while it's fresh (the stage demo), without repeats.
    const seen = new Set<string>();
    const ticker = items.filter((l) => {
      if (!l.score || (!real(l) && now - Date.parse(l.first_seen_at) > 10 * 60_000)) return false;
      const k = `${l.address}|${askingPrice(l)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, 8);
    return { source, overpricing, overpricedCount, priceExample, costsExample, pricingExample, ticker, watched: items.length };
  }, [items, source]);
}
