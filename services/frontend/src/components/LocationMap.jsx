import React from "react";
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const markerIcon = L.divIcon({
  className: "",
  html: '<div style="width:18px;height:18px;border-radius:9999px;background:#0f6b7a;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,.35);"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

const toCoordinate = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function MapController({ center, zoom, recenterKey }) {
  const map = useMap();

  React.useEffect(() => {
    const refreshMap = () => {
      map.invalidateSize();
      map.setView(center, zoom);
    };

    refreshMap();
    const timers = [
      window.setTimeout(refreshMap, 100),
      window.setTimeout(refreshMap, 350),
      window.setTimeout(refreshMap, 800),
    ];
    const resizeObserver = new ResizeObserver(refreshMap);
    resizeObserver.observe(map.getContainer());
    window.addEventListener("resize", refreshMap);

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      resizeObserver.disconnect();
      window.removeEventListener("resize", refreshMap);
    };
  }, [center, map, zoom, recenterKey]);

  return null;
}

export default function LocationMap({
  lat,
  lng,
  className = "h-56",
  zoom = 15,
  interactive = false,
  showControls = false,
  showOpenLink = false,
}) {
  const latitude = toCoordinate(lat);
  const longitude = toCoordinate(lng);
  const [mapZoom, setMapZoom] = React.useState(zoom);
  const [recenterKey, setRecenterKey] = React.useState(0);

  React.useEffect(() => {
    setMapZoom(zoom);
    setRecenterKey((current) => current + 1);
  }, [latitude, longitude, zoom]);

  if (latitude === null || longitude === null) return null;

  const position = [latitude, longitude];
  const osmUrl = `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=${mapZoom}/${latitude}/${longitude}`;

  return (
    <div className={`relative z-0 w-full overflow-hidden rounded-2xl border border-gray-200 bg-white ${className}`}>
      {showControls && (
        <div className="absolute left-3 top-3 z-[500] flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setMapZoom((current) => Math.min(current + 1, 18))}
            className="h-9 w-9 rounded-xl bg-white text-lg font-bold text-gray-800 shadow border border-gray-200 hover:text-ocean"
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => setMapZoom((current) => Math.max(current - 1, 7))}
            className="h-9 w-9 rounded-xl bg-white text-lg font-bold text-gray-800 shadow border border-gray-200 hover:text-ocean"
            aria-label="Zoom out"
          >
            -
          </button>
          <button
            type="button"
            onClick={() => {
              setMapZoom(zoom);
              setRecenterKey((current) => current + 1);
            }}
            className="h-9 rounded-xl bg-white px-3 text-xs font-semibold text-gray-700 shadow border border-gray-200 hover:text-ocean"
          >
            Recenter
          </button>
        </div>
      )}
      {showOpenLink && (
        <a
          href={osmUrl}
          target="_blank"
          rel="noreferrer"
          className="absolute right-3 top-3 z-[500] rounded-xl bg-white px-3 py-2 text-xs font-semibold text-gray-700 shadow border border-gray-200 hover:text-ocean"
        >
          Open full map
        </a>
      )}
      <MapContainer
        center={position}
        zoom={mapZoom}
        scrollWheelZoom={interactive}
        dragging={interactive}
        doubleClickZoom={interactive}
        zoomControl={false}
        className="relative z-0 h-full w-full"
      >
        <MapController center={position} zoom={mapZoom} recenterKey={recenterKey} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={position} icon={markerIcon} />
      </MapContainer>
    </div>
  );
}
