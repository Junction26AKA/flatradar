import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import Supercluster from 'supercluster';
import 'leaflet/dist/leaflet.css';
import { dealTone } from '../lib/format';
import { useI18n } from '../lib/i18n';
import type { Listing } from '../lib/types';
import './ListingMap.css';

const HELSINKI: [number, number] = [60.1699, 24.9384];

interface Props {
  listings: Listing[];
  selectedId?: string | null;
  hoverId?: string | null;
  freshIds?: Record<string, number>;
  onSelect: (id: string) => void;
}

const latLng = (l: Listing): [number, number] | null =>
  l.loc?.coordinates ? [l.loc.coordinates[1], l.loc.coordinates[0]] : null;

function pinLabel(l: Listing) {
  if (!l.score) return '•';
  const p = Math.round(l.score.deal_pct * 100);
  return p === 0 ? '±0%' : p < 0 ? `−${-p}%` : `+${p}%`;
}

/** Deal pins as HTML (DivIcon) so they use the same tokens as the DealBadge. */
function icon(l: Listing, state: { selected: boolean; hover: boolean; fresh: boolean }) {
  const tone = l.score ? dealTone(l.score.deal_pct) : 'none';
  const cls = ['pin', `pin--${tone}`, state.selected && 'pin--selected', state.hover && 'pin--hover', state.fresh && 'pin--fresh'].filter(Boolean).join(' ');
  return divIcon(`<span class="${cls}">${pinLabel(l)}</span>`);
}

// The feed re-renders every second (the "seen N s ago" clock). react-leaflet calls setIcon whenever the icon
// object changes, and Leaflet then rewrites the marker's HTML, which restarts the drop animation and breaks the
// hover transition. Same HTML → same icon object, so unchanged markers are left alone.
const icons = new Map<string, L.DivIcon>();
function divIcon(html: string): L.DivIcon {
  let i = icons.get(html);
  if (!i) {
    if (icons.size > 2000) icons.clear();
    i = L.divIcon({ className: 'pin-wrap', html, iconSize: undefined, iconAnchor: [0, 0] });
    icons.set(html, i);
  }
  return i;
}

// Leaflet computes NaN coordinates (and throws) if you move a map that has no size, e.g. while it's
// display:none behind the mobile "Map" toggle. Every camera move goes through this check.
const visible = (map: L.Map) => { const s = map.getSize(); return s.x > 0 && s.y > 0; };

/** Re-measure when the container changes size (mobile toggle, drawer opening), then run any deferred move. */
function useVisibleSize(onVisible: () => void) {
  const map = useMap();
  const cb = useRef(onVisible);
  cb.current = onVisible;
  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => { map.invalidateSize({ pan: false }); if (visible(map)) cb.current(); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);
  return map;
}

function FlyTo({ target }: { target: [number, number] | null }) {
  const pending = useRef<[number, number] | null>(null);
  const map = useVisibleSize(() => { if (pending.current) { map.setView(pending.current, Math.max(map.getZoom(), 14)); pending.current = null; } });
  useEffect(() => {
    if (!target) return;
    if (visible(map)) map.flyTo(target, Math.max(map.getZoom(), 14), { duration: 0.6 });
    else pending.current = target;
  }, [map, target?.[0], target?.[1]]);
  return null;
}

/** Fit to the listings once: the first time there are listings and the map is visible. */
function FitOnce({ points }: { points: [number, number][] }) {
  const done = useRef(false);
  const latest = useRef(points);
  latest.current = points;
  const fit = () => {
    if (done.current || !latest.current.length || !visible(map)) return;
    // Whole zoom level (zoomSnap is 0 for the trackpad, see below), so the first view's tiles are crisp.
    const b = L.latLngBounds(latest.current);
    map.setView(b.getCenter(), Math.min(13, Math.floor(map.getBoundsZoom(b, false, L.point(80, 80)))), { animate: false });
    done.current = true;
  };
  const map = useVisibleSize(fit);
  useEffect(fit, [points.length > 0]);
  return null;
}

export default function ListingMap({ listings, selectedId, hoverId, freshIds = {}, onSelect }: Props) {
  const placed = useMemo(() => listings.flatMap((l) => { const p = latLng(l); return p ? [{ l, p }] : []; }), [listings]);
  const selected = placed.find((x) => x.l._id === selectedId);

  return (
    <MapContainer
      center={HELSINKI}
      zoom={12}
      className="lmap"
      zoomControl={false}
      attributionControl
      preferCanvas={false}
      // Mac trackpads send a stream of tiny wheel events. With the default zoomSnap of 1, Leaflet rounds every
      // 40 ms batch UP to a whole level, so a gentle two-finger scroll flew from city to world view (12 → 0).
      // Unsnapped instead. Leaflet also divides Mac wheel deltas by 3×DPR, so the per-level distance has to be much
      // smaller than its default 60. Measured in WebKit + Chromium (DPR 2): a gentle 250 px swipe ≈ 0.7–0.9 levels.
      zoomSnap={0}
      wheelPxPerZoomLevel={10}
    >
      {/* Standard OSM tiles (no key). ListingMap.css tints them toward the Finnish-blue palette. */}
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        maxZoom={19}
      />
      <FitOnce points={placed.map((x) => x.p)} />
      <FlyTo target={selected?.p ?? null} />
      <ClusteredPins placed={placed} selectedId={selectedId ?? null} hoverId={hoverId ?? null} freshIds={freshIds} onSelect={onSelect} />
    </MapContainer>
  );
}

// ---------- clustering ----------
// Central Helsinki has dozens of listings per block, so nearby pins merge into one bubble per zoom level
// (supercluster, recomputed on pan/zoom). The bubble shows the count and the best deal inside it.
// Pins that must stay visible are never clustered: the selected listing and anything that just arrived.

const FRESH_UNCLUSTERED_MS = 60_000;
type Placed = { l: Listing; p: [number, number] };
type Props2 = { placed: Placed[]; selectedId: string | null; hoverId: string | null; freshIds: Record<string, number>; onSelect: (id: string) => void };
type PinProps = { id: string; best: number | null };
type ClusterProps = { best: number | null };

function useView() {
  const map = useMap();
  const read = () => ({ zoom: Math.round(map.getZoom()), bounds: map.getBounds() });
  const [view, setView] = useState(read);
  useMapEvents({ moveend: () => setView(read()), zoomend: () => setView(read()), resize: () => setView(read()) });
  return { map, ...view };
}

function bestLabel(best: number | null) {
  if (best == null) return '';
  const p = Math.round(best * 100);
  return p < 0 ? `−${-p}%` : p > 0 ? `+${p}%` : '±0%';
}

function clusterIcon(count: number, best: number | null, hover: boolean, title: string) {
  const tone = best == null ? 'none' : dealTone(best);
  const size = count < 10 ? 's' : count < 50 ? 'm' : 'l';
  return divIcon(
    `<span class="cluster cluster--${tone} cluster--${size}${hover ? ' cluster--hover' : ''}" title="${title}"><b>${count}</b>${best != null ? `<small>${bestLabel(best)}</small>` : ''}</span>`,
  );
}

function ClusteredPins({ placed, selectedId, hoverId, freshIds, onSelect }: Props2) {
  const { map, zoom, bounds } = useView();
  const { t } = useI18n();
  const now = Date.now();
  const pinned = (l: Listing) => l._id === selectedId || (freshIds[l._id] != null && now - freshIds[l._id] < FRESH_UNCLUSTERED_MS);

  const free = placed.filter((x) => !pinned(x.l));
  const always = placed.filter((x) => pinned(x.l));
  const byId = useMemo(() => new Map(placed.map((x) => [x.l._id, x])), [placed]);

  // Rebuild the index only when the set of clusterable listings (or their scores) changes, not on every pan.
  const freeKey = free.map((x) => `${x.l._id}:${x.l.score?.deal_pct ?? ''}`).join('|');
  const index = useMemo(() => {
    const sc = new Supercluster<PinProps, ClusterProps>({
      // Leaflet tiles are 256 px; supercluster defaults to 512, which would halve the radius on screen.
      extent: 256,
      // Largest bubble (56 px) + ring + the deal tab underneath, so neighbouring bubbles never touch.
      radius: 72,
      maxZoom: 16, // from z17 every listing is its own pin
      map: (p) => ({ best: p.best }),
      reduce: (acc, p) => { if (p.best != null && (acc.best == null || p.best < acc.best)) acc.best = p.best; },
    });
    sc.load(free.map(({ l, p }) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [p[1], p[0]] },
      properties: { id: l._id, best: l.score?.deal_pct ?? null },
    })));
    return sc;
  }, [freeKey]);

  const clusters = index.getClusters([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()], zoom);

  // Which cluster holds the card being hovered in the list (so the bubble can light up).
  const hoverCluster = useMemo(() => {
    if (!hoverId || !byId.has(hoverId) || always.some((x) => x.l._id === hoverId)) return null;
    for (const c of clusters) {
      const props = c.properties as Partial<Supercluster.ClusterProperties>;
      if (props.cluster && index.getLeaves(props.cluster_id!, Infinity).some((f) => (f.properties as PinProps).id === hoverId)) return props.cluster_id!;
    }
    return null;
  }, [hoverId, clusters, index]);

  const pin = (l: Listing, p: [number, number]) => {
    const isSel = l._id === selectedId;
    const isHover = l._id === hoverId;
    return (
      <Marker
        key={l._id}
        position={p}
        icon={icon(l, { selected: isSel, hover: isHover, fresh: freshIds[l._id] != null })}
        zIndexOffset={isSel ? 3000 : isHover ? 2000 : l.score && l.score.deal_pct < 0 ? 100 : 0}
        eventHandlers={{ click: () => onSelect(l._id) }}
        keyboard
        title={l.address ?? l._id}
      />
    );
  };

  return (
    <>
      {clusters.map((c) => {
        const [lng, lat] = c.geometry.coordinates;
        const props = c.properties as Partial<Supercluster.ClusterProperties> & ClusterProps & Partial<PinProps>;
        if (!props.cluster) { const x = byId.get(props.id!); return x ? pin(x.l, x.p) : null; }
        const id = props.cluster_id!;
        return (
          <Marker
            key={`c${id}`}
            position={[lat, lng]}
            icon={clusterIcon(props.point_count!, props.best ?? null, hoverCluster === id, t('map.best', { d: bestLabel(props.best ?? null) || t('map.notScored') }))}
            zIndexOffset={hoverCluster === id ? 1500 : 500}
            eventHandlers={{ click: () => map.flyTo([lat, lng], Math.min(index.getClusterExpansionZoom(id), 18), { duration: 0.5 }) }}
            keyboard
            title={t('map.clusterTitle', { n: props.point_count })}
          />
        );
      })}
      {always.map(({ l, p }) => pin(l, p))}
    </>
  );
}
