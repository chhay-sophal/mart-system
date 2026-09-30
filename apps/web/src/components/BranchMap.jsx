import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// HTML pins (L.divIcon) rather than Leaflet's default marker images, which
// bundlers don't resolve — and they match the design's pill-shaped pins.
function pinIcon(name, selected) {
  const el = document.createElement('span');
  el.className = `branch-pin${selected ? ' branch-pin--selected' : ''}`;
  el.textContent = name;
  return L.divIcon({ html: el.outerHTML, className: '', iconSize: null, iconAnchor: [0, 0] });
}

/**
 * Leaflet map of the branches that have a pin. Loaded lazily (see
 * BranchesPage) so Leaflet stays out of the main bundle.
 */
export default function BranchMap({ stores, selectedId, onSelect }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  useEffect(() => {
    const map = L.map(containerRef.current, { scrollWheelZoom: false });
    // OpenStreetMap's own tile server: fine for a small shop's traffic, and its
    // usage policy requires this attribution. Swap for a paid tile provider if
    // the storefront ever gets heavy traffic.
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Fit the view to the pins only when the set of pinned branches changes, not on every selection.
  const pinKey = stores.map((s) => `${s.id}:${s.latitude},${s.longitude}`).join('|');
  useEffect(() => {
    const map = mapRef.current;
    const points = stores.map((s) => [s.latitude, s.longitude]);
    if (points.length === 1) map.setView(points[0], 16);
    // Pin labels sit above and to the right of their point, so leave extra room on those sides.
    else map.fitBounds(points, { paddingTopLeft: [32, 64], paddingBottomRight: [140, 24], maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinKey]);

  useEffect(() => {
    const layer = layerRef.current;
    layer.clearLayers();
    for (const s of stores) {
      L.marker([s.latitude, s.longitude], {
        icon: pinIcon(s.name, s.id === selectedId),
        title: s.name,
        keyboard: true,
        zIndexOffset: s.id === selectedId ? 1000 : 0,
      })
        .on('click', () => onSelect(s.id))
        .addTo(layer);
    }
  }, [stores, selectedId, onSelect]);

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label="Map of branches"
      className="h-80 overflow-hidden rounded-[28px] bg-[#dce5da] md:h-full md:min-h-[520px]"
    />
  );
}
