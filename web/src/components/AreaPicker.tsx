import { useEffect, useRef, useState } from 'react';
import { Circle, CircleMarker, MapContainer, Polygon, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useI18n } from '../lib/i18n';
import type { SearchArea, SearchPolygon } from '../lib/types';
import './ListingMap.css';
import './AreaPicker.css';

const HELSINKI: [number, number] = [60.1899, 24.9384];
export const MAX_AREAS = 5 // server keeps at most 5 (cleanSearch);
export const MAX_POLYGONS = 3;
const MAX_POINTS = 100;
const DEFAULT_RADIUS = 1000;
const km = (m: number) => (m / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 });

type Mode = 'pin' | 'draw';

function ClickToDrop({ onDrop }: { onDrop: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onDrop(e.latlng.lat, e.latlng.lng) });
  return null;
}

/** Leaflet measures its box once at mount; inside a just-opened <dialog> that's too early, so re-measure on resize. */
function FitContainer() {
  const map = useMap();
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize({ animate: false }));
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  return null;
}

/** Show every circle and shape on first open (editing a saved search), otherwise the city. */
function FitAreas({ areas, polygons }: { areas: SearchArea[]; polygons: SearchPolygon[] }) {
  const map = useMap();
  useEffect(() => {
    if (!areas.length && !polygons.length) return;
    const b = L.latLngBounds([]);
    for (const a of areas) b.extend(L.latLng(a.lat, a.lng).toBounds(a.radius_m * 2));
    for (const pg of polygons) for (const p of pg.points) b.extend(p);
    map.fitBounds(b, { padding: [20, 20], maxZoom: 14, animate: false });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/**
 * Freehand drawing (Rightmove-style "draw a search"): press, drag round the area, let go.
 * Pointer events on the map container, so it works with a mouse, a pen and a finger; map panning is off meanwhile.
 */
function FreehandDraw({ onDone }: { onDone: (points: [number, number][]) => void }) {
  const map = useMap();
  const [trail, setTrail] = useState<L.LatLng[]>([]);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const el = map.getContainer();
    let pts: L.Point[] = [];
    let active = false;
    const at = (e: PointerEvent) => map.mouseEventToContainerPoint(e as unknown as MouseEvent);
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('.leaflet-control')) return;
      active = true;
      pts = [at(e)];
      el.setPointerCapture(e.pointerId);
      map.dragging.disable();
      setTrail([map.containerPointToLatLng(pts[0])]);
      // Capture phase on the container: Leaflet's own drag handler (on the map pane inside) never sees this press.
      e.preventDefault();
      e.stopPropagation();
    };
    const move = (e: PointerEvent) => {
      if (!active) return;
      const p = at(e);
      if (p.distanceTo(pts[pts.length - 1]) < 4) return;
      pts.push(p);
      setTrail(pts.map((q) => map.containerPointToLatLng(q)));
    };
    // Interrupted by the browser or OS (system gesture, second finger): throw the partial shape away.
    const cancel = () => {
      if (!active) return;
      active = false;
      map.dragging.enable();
      setTrail([]);
    };
    const up = () => {
      if (!active) return;
      active = false;
      map.dragging.enable();
      setTrail([]);
      // Drop the wobble: Douglas–Peucker in screen pixels, then cap the point count.
      let simple = pts.length > 2 ? L.LineUtil.simplify(pts, 3) : pts;
      if (simple.length > MAX_POINTS) { const step = Math.ceil(simple.length / MAX_POINTS); simple = simple.filter((_, i) => i % step === 0); }
      if (simple.length < 3) return;
      done.current(simple.map((q) => { const ll = map.containerPointToLatLng(q); return [+ll.lat.toFixed(5), +ll.lng.toFixed(5)] as [number, number]; }));
    };
    el.addEventListener('pointerdown', down, true);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    return () => {
      el.removeEventListener('pointerdown', down, true);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      map.dragging.enable();
    };
  }, [map]);

  return trail.length > 1 ? <Polyline positions={trail} interactive={false} pathOptions={{ className: 'apick__trail' }} /> : null;
}

/** The map half of a saved search's location: drop pins with a radius, or draw shapes freehand. */
export default function AreaPicker({ value, onChange, polygons = [], onPolygonsChange }: {
  value: SearchArea[];
  onChange: (areas: SearchArea[]) => void;
  polygons?: SearchPolygon[];
  onPolygonsChange?: (polygons: SearchPolygon[]) => void;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>('pin');
  const pinsFull = value.length >= MAX_AREAS;
  const shapesFull = polygons.length >= MAX_POLYGONS;
  const full = mode === 'pin' ? pinsFull : shapesFull;
  const drop = (lat: number, lng: number) => {
    if (pinsFull) return;
    const r = value.at(-1)?.radius_m ?? DEFAULT_RADIUS; // a new pin starts with the last radius used
    onChange([...value, { lat: +lat.toFixed(5), lng: +lng.toFixed(5), radius_m: r }]);
  };
  const setRadius = (i: number, radius_m: number) => onChange(value.map((a, j) => (j === i ? { ...a, radius_m } : a)));

  return (
    <div className="apick">
      {onPolygonsChange && (
        <div className="sform__seg apick__mode" role="radiogroup" aria-label={t('sr.areaMode')}>
          {(['pin', 'draw'] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} className="sform__segbtn t-label" onClick={() => setMode(m)}>
              {t(m === 'pin' ? 'sr.modePin' : 'sr.modeDraw')}
            </button>
          ))}
        </div>
      )}
      <div className={`apick__map${full ? ' is-full' : ''}${mode === 'draw' ? ' is-draw' : ''}`}>
        <MapContainer center={HELSINKI} zoom={11} className="lmap" zoomControl attributionControl scrollWheelZoom={false}>
          <TileLayer
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            maxZoom={19}
          />
          <FitContainer />
          {mode === 'pin' && <ClickToDrop onDrop={drop} />}
          {mode === 'draw' && !shapesFull && onPolygonsChange && <FreehandDraw onDone={(points) => onPolygonsChange([...polygons, { points }])} />}
          <FitAreas areas={value} polygons={polygons} />
          {value.map((a, i) => (
            <Circle key={i} center={[a.lat, a.lng]} radius={a.radius_m} interactive={false} pathOptions={{ className: 'lmap__area' }} />
          ))}
          {value.map((a, i) => (
            <CircleMarker key={`p${i}`} center={[a.lat, a.lng]} radius={5} interactive={false} pathOptions={{ className: 'apick__pin' }} />
          ))}
          {polygons.map((pg, i) => (
            <Polygon key={`g${i}`} positions={pg.points} interactive={false} pathOptions={{ className: 'lmap__area' }} />
          ))}
        </MapContainer>
      </div>
      <p className="t-body-s muted apick__hint">
        {mode === 'pin'
          ? (pinsFull ? t('sr.maxAreas', { n: MAX_AREAS }) : t('sr.areasHint'))
          : (shapesFull ? t('sr.maxShapes', { n: MAX_POLYGONS }) : t('sr.drawHint'))}
      </p>
      {(value.length > 0 || polygons.length > 0) && (
        <ul className="apick__list">
          {value.map((a, i) => (
            <li key={i}>
              <span className="t-label">{a.label ?? t('sr.areaN', { n: i + 1 })}</span>
              <input
                type="range" min={250} max={20000} step={250} value={a.radius_m}
                aria-label={t('sr.radius', { km: km(a.radius_m) })}
                onChange={(e) => setRadius(i, Number(e.target.value))}
              />
              <span className="t-num-s apick__km">{km(a.radius_m)} km</span>
              <button type="button" className="btn btn--link apick__rm" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={t('sr.removeArea')} title={t('sr.removeArea')}>×</button>
            </li>
          ))}
          {onPolygonsChange && polygons.map((_, i) => (
            <li key={`g${i}`} className="apick__shape">
              <span className="t-label">{t('sr.shapeN', { n: i + 1 })}</span>
              <span />
              <span />
              <button type="button" className="btn btn--link apick__rm" onClick={() => onPolygonsChange(polygons.filter((_, j) => j !== i))} aria-label={t('sr.removeArea')} title={t('sr.removeArea')}>×</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
