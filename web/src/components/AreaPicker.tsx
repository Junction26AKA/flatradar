import { useEffect } from 'react';
import { Circle, CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useI18n } from '../lib/i18n';
import type { SearchArea } from '../lib/types';
import './ListingMap.css';
import './AreaPicker.css';

const HELSINKI: [number, number] = [60.1899, 24.9384];
export const MAX_AREAS = 5 // server keeps at most 5 (cleanSearch);
const DEFAULT_RADIUS = 1000;
const km = (m: number) => (m / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 });

function ClickToDrop({ onDrop }: { onDrop: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onDrop(e.latlng.lat, e.latlng.lng) });
  return null;
}

/** Show every circle on first open (editing a saved search), otherwise the city. */
function FitAreas({ areas }: { areas: SearchArea[] }) {
  const map = useMap();
  useEffect(() => {
    if (!areas.length) return;
    const b = L.latLngBounds([]);
    for (const a of areas) b.extend(L.latLng(a.lat, a.lng).toBounds(a.radius_m * 2));
    map.fitBounds(b, { padding: [20, 20], maxZoom: 14, animate: false });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** "Drop a pin, pick a radius": the map half of a saved search's location. */
export default function AreaPicker({ value, onChange }: { value: SearchArea[]; onChange: (areas: SearchArea[]) => void }) {
  const { t } = useI18n();
  const full = value.length >= MAX_AREAS;
  const drop = (lat: number, lng: number) => {
    if (full) return;
    const r = value.at(-1)?.radius_m ?? DEFAULT_RADIUS; // a new pin starts with the last radius used
    onChange([...value, { lat: +lat.toFixed(5), lng: +lng.toFixed(5), radius_m: r }]);
  };
  const setRadius = (i: number, radius_m: number) => onChange(value.map((a, j) => (j === i ? { ...a, radius_m } : a)));

  return (
    <div className="apick">
      <div className={`apick__map${full ? ' is-full' : ''}`}>
        <MapContainer center={HELSINKI} zoom={11} className="lmap" zoomControl attributionControl scrollWheelZoom={false}>
          <TileLayer
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            maxZoom={19}
          />
          <ClickToDrop onDrop={drop} />
          <FitAreas areas={value} />
          {value.map((a, i) => (
            <Circle key={i} center={[a.lat, a.lng]} radius={a.radius_m} interactive={false} pathOptions={{ className: 'lmap__area' }} />
          ))}
          {value.map((a, i) => (
            <CircleMarker key={`p${i}`} center={[a.lat, a.lng]} radius={5} interactive={false} pathOptions={{ className: 'apick__pin' }} />
          ))}
        </MapContainer>
      </div>
      <p className="t-body-s muted apick__hint">{full ? t('sr.maxAreas', { n: MAX_AREAS }) : t('sr.areasHint')}</p>
      {value.length > 0 && (
        <ul className="apick__list">
          {value.map((a, i) => (
            <li key={i}>
              <span className="t-label">{t('sr.areaN', { n: i + 1 })}</span>
              <input
                type="range" min={250} max={20000} step={250} value={a.radius_m}
                aria-label={t('sr.radius', { km: km(a.radius_m) })}
                onChange={(e) => setRadius(i, Number(e.target.value))}
              />
              <span className="t-num-s apick__km">{km(a.radius_m)} km</span>
              <button type="button" className="btn btn--link apick__rm" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={t('sr.removeArea')} title={t('sr.removeArea')}>×</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
