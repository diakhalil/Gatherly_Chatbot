import React, { useEffect, useState } from "react";
import api from "../services/api";
import DatePicker from "react-datepicker";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { MapPin } from "lucide-react";
import "react-datepicker/dist/react-datepicker.css";
import "leaflet/dist/leaflet.css";

const LEBANON_CENTER = [33.8547, 35.8623];
const BEIRUT_CENTER = [33.8938, 35.5018];
const LEBANON_ZOOM = 8;
const VENUE_ZOOM = 15;
const LEBANON_BOUNDS = {
  minLon: 35.103,
  minLat: 33.055,
  maxLon: 36.625,
  maxLat: 34.692,
};

const formatTime = (date) => {
  if (!date) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

// Note: fction to combine date and time
const combineDateAndTime = (date, timeStr) => {
  if (!date || !timeStr) return null;
  const [h, m] = timeStr.split(":").map((v) => parseInt(v, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const merged = new Date(date);
  merged.setHours(h, m, 0, 0);
  return merged;
};

const timeOptions = [
  "08:00", "09:00", "10:00", "11:00", "12:00",
  "13:00", "14:00", "15:00", "16:00", "17:00",
  "18:00", "19:00", "20:00", "21:00","22:00","23:00","24:00"
];

const buildAssetUrl = (path) => {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const base = (api.defaults.baseURL || "").replace(/\/api\/?$/, "");
  if (!base) return path;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
};

const locationOptions = [
  "Le Royal Hotels & Resorts",
  "Four Seasons Halat / Okaibe",
  "The Phoenicia Hotel",
  "Le Gray Beirut",
  "Radisson Blu Martinez",
  "Gefinor Rotana",
  "Monroe Hotel"
];

const locationFallbacks = {
  "le royal hotels & resorts": {
    label: "Le Royal Hotels & Resorts",
    displayName: "Le Royal Hotel, Dbayeh, Lebanon",
    lat: 33.94799,
    lng: 35.59515,
  },
  "four seasons hotel beirut": {
    label: "Four Seasons Halat / Okaibe",
    displayName: "Four Seasons Halat, Halat Front Sea Road, Byblos Road, Lebanon",
    lat: 34.07325,
    lng: 35.644211,
  },
  "four seasons halat / okaibe": {
    label: "Four Seasons Halat / Okaibe",
    displayName: "Four Seasons Halat, Halat Front Sea Road, Byblos Road, Lebanon",
    lat: 34.07325,
    lng: 35.644211,
  },
  "four seasons halat": {
    label: "Four Seasons Halat / Okaibe",
    displayName: "Four Seasons Halat, Halat Front Sea Road, Byblos Road, Lebanon",
    lat: 34.07325,
    lng: 35.644211,
  },
  "four seasons okaibe": {
    label: "Four Seasons Halat / Okaibe",
    displayName: "Four Seasons Halat, Halat Front Sea Road, Byblos Road, Lebanon",
    lat: 34.07325,
    lng: 35.644211,
  },
  "the phoenicia hotel": {
    label: "The Phoenicia Hotel",
    displayName: "Phoenicia Hotel Beirut, Minet El Hosn, Beirut, Lebanon",
    lat: 33.900466,
    lng: 35.495109,
  },
  "le gray beirut": {
    label: "Le Gray Beirut",
    displayName: "Le Gray Beirut, Downtown Beirut, Lebanon",
    lat: 33.897296,
    lng: 35.506589,
  },
  "radisson blu martinez": {
    label: "Radisson Blu Martinez",
    displayName: "Radisson Blu Martinez Hotel, Beirut, Lebanon",
    lat: 33.9003,
    lng: 35.49277,
  },
  "gefinor rotana": {
    label: "Gefinor Rotana",
    displayName: "Gefinor Rotana, Hamra, Beirut, Lebanon",
    lat: 33.89817552500911,
    lng: 35.48802316188812,
  },
  "monroe hotel": {
    label: "Monroe Hotel",
    displayName: "Monroe Hotel, Beirut, Lebanon",
    lat: 33.9006,
    lng: 35.49564,
  },
  "biel beirut": {
    label: "BIEL Beirut",
    displayName: "BIEL Beirut, Beirut Waterfront, Lebanon",
    lat: 33.9081,
    lng: 35.5105,
  },
  "beirut waterfront": {
    label: "Beirut Waterfront",
    displayName: "Beirut Waterfront, Beirut, Lebanon",
    lat: 33.9068,
    lng: 35.5098,
  },
};

const normalizeSearchKey = (value = "") =>
  value.toLowerCase().replace(/\s+/g, " ").trim();

const isInsideLebanon = (result) => {
  const lat = Number(result?.lat);
  const lon = Number(result?.lon);
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= LEBANON_BOUNDS.minLat &&
    lat <= LEBANON_BOUNDS.maxLat &&
    lon >= LEBANON_BOUNDS.minLon &&
    lon <= LEBANON_BOUNDS.maxLon
  );
};

const selectedLocationIcon = L.divIcon({
  className: "",
  html: '<div style="width:18px;height:18px;border-radius:9999px;background:#0f6b7a;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,.35);"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function MapClickHandler({ onSelect }) {
  useMapEvents({
    click(event) {
      onSelect(event.latlng);
    },
  });
  return null;
}

function MapCenterUpdater({ center, zoom }) {
  const map = useMap();
  React.useEffect(() => {
    map.setView(center, zoom);
  }, [center, map, zoom]);
  return null;
}

function MapResizeWatcher({ active }) {
  const map = useMap();
  useEffect(() => {
    if (!active) return undefined;
    const timers = [0, 150, 350].map((delay) =>
      window.setTimeout(() => map.invalidateSize(), delay)
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [active, map]);
  return null;
}

export default function ClientEventRequest({
  occasions,
  eventType,
  startDateTime,
  endDateTime,
  nbOfGuests,
  location,
  description,
  clothingOptions = [],
  selectedClothesId = null,
  onTypeChange,
  onStartChange,
  onEndChange,
  onGuestsChange,
  onLocationChange,
  onLocationMetaChange,
  onDescriptionChange,
  onClothesChange,
  onSubmit,
  submitting = false,
  errorMessage = "",
}) {
  const [isMapOpen, setIsMapOpen] = useState(false);
  const [mapCenter, setMapCenter] = useState(LEBANON_CENTER);
  const [mapZoom, setMapZoom] = useState(LEBANON_ZOOM);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [mapError, setMapError] = useState("");
  const [isSearchingLocation, setIsSearchingLocation] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [mapSearchQuery, setMapSearchQuery] = useState("");
  const [mapLayer, setMapLayer] = useState("satellite");

  const applyResolvedLocation = ({
    lat,
    lng,
    displayName,
    placeName,
    shouldReplaceLocation = true,
  }) => {
    const nextLocation = [Number(lat), Number(lng)];
    setMapCenter(nextLocation);
    setMapZoom(VENUE_ZOOM);
    setSelectedLocation(nextLocation);
    if (shouldReplaceLocation) {
      onLocationChange(placeName || displayName || location);
    }
    onLocationMetaChange?.({
      locationLat: Number(lat),
      locationLng: Number(lng),
      locationPlaceName: placeName || displayName?.split(",")[0] || "",
    });
    setMapError("");
  };

  const findFallbackLocation = (query) => {
    const normalized = normalizeSearchKey(query);
    if (locationFallbacks[normalized]) return locationFallbacks[normalized];
    return Object.entries(locationFallbacks).find(
      ([key, fallback]) =>
        normalized.includes(key) ||
        key.includes(normalized) ||
        normalized.includes(normalizeSearchKey(fallback.label))
    )?.[1];
  };

  const selectKnownLocation = (knownLocation) => {
    if (!knownLocation) return;
    const fallbackResult = {
      place_id: `fallback-${normalizeSearchKey(knownLocation.label)}`,
      lat: knownLocation.lat,
      lon: knownLocation.lng,
      name: knownLocation.label,
      display_name: knownLocation.displayName,
      isFallback: true,
    };
    setIsMapOpen(true);
    setMapSearchQuery(knownLocation.label);
    setSearchResults([fallbackResult]);
    handleSearchResultSelect(fallbackResult);
  };

  const handleMapSelect = async ({ lat, lng }) => {
    const nextLocation = [lat, lng];
    const coordinateLabel = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

    setSelectedLocation(nextLocation);
    setMapCenter(nextLocation);
    setMapZoom(VENUE_ZOOM);
    onLocationChange(coordinateLabel);
    onLocationMetaChange?.({
      locationLat: lat,
      locationLng: lng,
      locationPlaceName: "",
    });
    setMapError("");
    setSearchResults([]);

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`
      );
      const data = await response.json();
      if (data.display_name) {
        onLocationChange(data.display_name);
        onLocationMetaChange?.({
          locationLat: lat,
          locationLng: lng,
          locationPlaceName: data.name || data.display_name.split(",")[0] || "",
        });
      }
    } catch {
      setMapError("Address lookup failed. Coordinates were saved instead.");
    }
  };

  const runNominatimSearch = async (query, searchParams = {}) => {
    const rawParams = {
      format: "jsonv2",
      addressdetails: "1",
      limit: "8",
      countrycodes: "lb",
      q: query,
      ...searchParams,
    };
    const params = new URLSearchParams();
    Object.entries(rawParams).forEach(([key, value]) => {
      if (value !== "" && value !== null && value !== undefined) {
        params.set(key, value);
      }
    });
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?${params.toString()}`
    );
    if (!response.ok) {
      throw new Error("Map search request failed");
    }
    return response.json();
  };

  const pickBestLebanonResult = (results = []) => {
    const lebanonResults = results.filter(
      (result) =>
        isInsideLebanon(result) ||
        result?.address?.country_code === "lb" ||
        /lebanon/i.test(result?.display_name || "")
    );
    return lebanonResults[0] || null;
  };

  const handleLocationSearch = async (queryOverride = mapSearchQuery || location) => {
    const query = queryOverride.trim();
    if (!query) {
      setMapError("Type a venue, hotel, or address in the map search box.");
      return;
    }

    const knownLocation = findFallbackLocation(query);
    if (knownLocation) {
      selectKnownLocation(knownLocation);
      return;
    }

    setIsSearchingLocation(true);
    setMapError("");
    setSearchResults([]);

    try {
      const withLebanon = /\blebanon\b/i.test(query) ? query : `${query}, Lebanon`;
      const attempts = [
        () => runNominatimSearch(query),
        () => runNominatimSearch(withLebanon),
        () =>
          runNominatimSearch(withLebanon, {
            viewbox: `${LEBANON_BOUNDS.minLon},${LEBANON_BOUNDS.maxLat},${LEBANON_BOUNDS.maxLon},${LEBANON_BOUNDS.minLat}`,
          }),
        () => runNominatimSearch(query, { countrycodes: "" }),
      ];

      let results = [];
      for (const attempt of attempts) {
        const data = await attempt();
        const usable = (data || []).filter(
          (result) => Number.isFinite(Number(result.lat)) && Number.isFinite(Number(result.lon))
        );
        if (usable.length) {
          results = usable;
          break;
        }
      }

      const bestResult = pickBestLebanonResult(results);
      if (bestResult) {
        const lebanonResults = results.filter(
          (result) =>
            isInsideLebanon(result) ||
            result?.address?.country_code === "lb" ||
            /lebanon/i.test(result?.display_name || "")
        );
        const sortedResults = [
          bestResult,
          ...lebanonResults.filter((result) => result.place_id !== bestResult.place_id),
        ];
        setSearchResults(sortedResults);
        handleSearchResultSelect(bestResult);
        return;
      }

      const fallback = findFallbackLocation(query);
      if (fallback) {
        const fallbackResult = {
          place_id: `fallback-${normalizeSearchKey(fallback.label)}`,
          lat: fallback.lat,
          lon: fallback.lng,
          name: fallback.label,
          display_name: fallback.displayName,
          isFallback: true,
        };
        setSearchResults([fallbackResult]);
        handleSearchResultSelect(fallbackResult);
        setMapError("");
        return;
      }

      onLocationChange(query);
      onLocationMetaChange?.({
        locationLat: null,
        locationLng: null,
        locationPlaceName: "",
      });
      setMapError("No exact map result found. The typed location was kept, but no marker was saved.");
    } catch {
      const fallback = findFallbackLocation(query);
      if (fallback) {
        const fallbackResult = {
          place_id: `fallback-${normalizeSearchKey(fallback.label)}`,
          lat: fallback.lat,
          lon: fallback.lng,
          name: fallback.label,
          display_name: fallback.displayName,
          isFallback: true,
        };
        setSearchResults([fallbackResult]);
        handleSearchResultSelect(fallbackResult);
        return;
      }
      setMapError("Map search failed. You can still type the address manually.");
    } finally {
      setIsSearchingLocation(false);
    }
  };

  const handleSearchResultSelect = (result) => {
    const typedVenueName = (mapSearchQuery || location || "").trim();
    applyResolvedLocation({
      lat: result.lat,
      lng: result.lon,
      displayName: result.display_name || result.name || location,
      placeName: typedVenueName || result.name || result.display_name?.split(",")[0] || "",
    });
  };

  const handleSuggestedLocation = (loc) => {
    const fallback = findFallbackLocation(loc);
    if (fallback) {
      selectKnownLocation(fallback);
      return;
    }
    onLocationChange(loc);
    setMapSearchQuery(loc);
    setIsMapOpen(true);
    window.setTimeout(() => handleLocationSearch(loc), 0);
  };

  const resetMapToLebanon = () => {
    setMapCenter(LEBANON_CENTER);
    setMapZoom(LEBANON_ZOOM);
  };

  const focusBeirut = () => {
    setMapCenter(BEIRUT_CENTER);
    setMapZoom(13);
  };

  return (
    <div className="bg-white rounded-3xl shadow-lg border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className="bg-cream px-8 py-6 border-b border-gray-100">
        <p className="text-xs uppercase tracking-[0.3em] text-ocean font-semibold">
          Create Request
        </p>
        <h2 className="text-2xl font-bold text-gray-900 mt-1">
          What is Your Occasion?
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          Select any occasion from the list below
        </p>
      </div>

      <div className="p-8">
        {/* Icons Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {occasions.map((o) => (
            <label
              key={o.id}
              className={`flex flex-col items-center gap-3 p-4 rounded-2xl cursor-pointer transition-all border-2 ${
                eventType === o.label
                  ? "border-ocean bg-sky shadow-md"
                  : "border-gray-100 bg-cream hover:border-gray-200 hover:bg-mist"
              }`}
            >
              <img
                src={o.icon}
                alt={o.label}
                className="w-16 h-16 object-contain"
              />
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  name="eventType"
                  value={o.label}
                  checked={eventType === o.label}
                  onChange={() => onTypeChange(o.label)}
                  className="accent-indigo-600"
                />
                <span className={`text-sm font-medium ${
                  eventType === o.label ? "text-ocean" : "text-gray-700"
                }`}>
                  {o.label}
                </span>
              </div>
            </label>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={onSubmit} className="mt-8">
          <div className="bg-cream rounded-2xl p-6 border border-gray-100 space-y-6">
            {errorMessage && (
              <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm px-4 py-3">
                {errorMessage}
              </div>
            )}

            {clothingOptions.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-ocean font-semibold">
                      Outfit
                    </p>
                    <p className="text-sm text-gray-700">Pick the dress/uniform for this event</p>
                  </div>
                  {selectedClothesId && (
                    <button
                      type="button"
                      onClick={() => onClothesChange?.(null)}
                      className="text-xs font-semibold text-gray-600 hover:text-ocean"
                      disabled={submitting}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {clothingOptions.map((item) => {
                    const isActive = Number(selectedClothesId) === Number(item.clothesId);
                    return (
                      <button
                        key={item.clothesId}
                        type="button"
                        onClick={() => onClothesChange?.(item.clothesId)}
                        className={`flex items-center gap-3 p-3 rounded-2xl border text-left transition ${
                          isActive
                            ? "border-ocean bg-white shadow-md"
                            : "border-gray-200 bg-white hover:border-ocean/50"
                        }`}
                        disabled={submitting}
                      >
                        {item.picture && (
                          <div className="h-16 w-16 rounded-xl overflow-hidden bg-cream flex-shrink-0">
                            <img
                              src={buildAssetUrl(item.picture)}
                              alt={item.clothingLabel}
                              className="h-full w-full object-cover"
                            />
                          </div>
                        )}
                        <div className="space-y-1">
                          <p className="text-sm font-semibold text-gray-900">{item.clothingLabel}</p>
                          <p className="text-xs text-gray-600 line-clamp-2">
                            {item.description || "Standard uniform"}
                          </p>
                          {item.stockInfo && (
                            <p className="text-[0.7rem] uppercase tracking-wide text-ocean">
                              {item.stockInfo}
                            </p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Event Title or Description
                </label>
                <textarea
                  rows={3}
                  placeholder="Tell us about the occasion, vibe, and any special requests"
                  value={description}
                  onChange={(e) => onDescriptionChange(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ocean focus:border-ocean bg-white resize-none"
                  disabled={submitting}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Event Location
                </label>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => {
                    const nextValue = e.target.value;
                    const knownLocation = findFallbackLocation(nextValue);
                    if (knownLocation && normalizeSearchKey(knownLocation.label) === normalizeSearchKey(nextValue)) {
                      selectKnownLocation(knownLocation);
                      return;
                    }

                    onLocationChange(nextValue);
                    setMapSearchQuery(nextValue);
                    onLocationMetaChange?.({
                      locationLat: null,
                      locationLng: null,
                      locationPlaceName: "",
                    });
                  }}
                  list="client-location-suggestions"
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ocean focus:border-ocean bg-white"
                  placeholder="Type an address or choose one from the map"
                  disabled={submitting}
                  required
                />
                <datalist id="client-location-suggestions">
                  {locationOptions.map((loc) => (
                    <option key={loc} value={loc} />
                  ))}
                </datalist>
                <div className="mt-3 flex flex-wrap gap-2">
                  {locationOptions.slice(0, 5).map((loc) => (
                    <button
                      key={loc}
                      type="button"
                      onClick={() => handleSuggestedLocation(loc)}
                      className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 hover:border-ocean hover:text-ocean transition"
                      disabled={submitting}
                    >
                      {loc}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMapSearchQuery((current) => current || location);
                    setIsMapOpen((prev) => !prev);
                  }}
                  className="mt-3 inline-flex items-center gap-2 rounded-xl border border-ocean/30 bg-white px-4 py-2 text-sm font-semibold text-ocean hover:bg-sky transition"
                  disabled={submitting}
                >
                  <MapPin size={16} />
                  {isMapOpen ? "Hide Map" : "Choose on Map"}
                </button>
                {isMapOpen && (
                  <div className="mt-3 space-y-2">
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        value={mapSearchQuery}
                        onChange={(e) => setMapSearchQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleLocationSearch();
                          }
                        }}
                        className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ocean focus:border-ocean"
                        placeholder="Search venue or hotel in Lebanon"
                        disabled={submitting}
                      />
                      <button
                        type="button"
                        onClick={() => handleLocationSearch()}
                        className="rounded-xl bg-ocean px-4 py-2 text-sm font-semibold text-white hover:bg-ocean/90 transition disabled:opacity-60"
                        disabled={submitting || isSearchingLocation}
                      >
                        {isSearchingLocation ? "Searching..." : "Search"}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setMapLayer("satellite")}
                        className={`rounded-xl border px-4 py-2 text-xs font-semibold transition ${
                          mapLayer === "satellite"
                            ? "border-ocean bg-ocean text-white"
                            : "border-gray-200 bg-white text-gray-700 hover:border-ocean hover:text-ocean"
                        }`}
                        disabled={submitting}
                      >
                        Satellite
                      </button>
                      <button
                        type="button"
                        onClick={() => setMapLayer("street")}
                        className={`rounded-xl border px-4 py-2 text-xs font-semibold transition ${
                          mapLayer === "street"
                            ? "border-ocean bg-ocean text-white"
                            : "border-gray-200 bg-white text-gray-700 hover:border-ocean hover:text-ocean"
                        }`}
                        disabled={submitting}
                      >
                        Map
                      </button>
                      <button
                        type="button"
                        onClick={resetMapToLebanon}
                        className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700 hover:border-ocean hover:text-ocean transition"
                        disabled={submitting}
                      >
                        Show Lebanon
                      </button>
                      <button
                        type="button"
                        onClick={focusBeirut}
                        className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700 hover:border-ocean hover:text-ocean transition"
                        disabled={submitting}
                      >
                        Beirut
                      </button>
                      <button
                        type="button"
                        onClick={() => setMapZoom((zoom) => Math.min(zoom + 1, 22))}
                        className="h-9 w-9 rounded-xl border border-gray-200 bg-white text-lg font-bold text-gray-700 hover:border-ocean hover:text-ocean transition"
                        disabled={submitting}
                        aria-label="Zoom in"
                      >
                        +
                      </button>
                      <button
                        type="button"
                        onClick={() => setMapZoom((zoom) => Math.max(zoom - 1, 6))}
                        className="h-9 w-9 rounded-xl border border-gray-200 bg-white text-lg font-bold text-gray-700 hover:border-ocean hover:text-ocean transition"
                        disabled={submitting}
                        aria-label="Zoom out"
                      >
                        -
                      </button>
                    </div>
                    {searchResults.length > 0 && (
                      <div className="max-h-44 overflow-y-auto rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100">
                        {searchResults.map((result) => (
                          <button
                            key={`${result.place_id}-${result.lat}-${result.lon}`}
                            type="button"
                            onClick={() => handleSearchResultSelect(result)}
                            className="w-full px-4 py-3 text-left hover:bg-sky transition"
                            disabled={submitting}
                          >
                            <p className="text-sm font-semibold text-gray-900">
                              {result.name || result.display_name.split(",")[0]}
                            </p>
                            <p className="text-xs text-gray-500 line-clamp-2">
                              {result.display_name}
                            </p>
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="relative z-0 h-80 w-full overflow-hidden rounded-2xl border border-gray-200 bg-white">
                      <MapContainer
                        center={mapCenter}
                        zoom={mapZoom}
                        maxZoom={22}
                        scrollWheelZoom
                        className="relative z-0 h-full w-full"
                      >
                        {mapLayer === "satellite" ? (
                          <>
                            <TileLayer
                              attribution='Tiles &copy; Esri'
                              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                              maxZoom={22}
                              maxNativeZoom={19}
                            />
                            <TileLayer
                              attribution='Labels &copy; Esri'
                              url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
                              maxZoom={22}
                              maxNativeZoom={19}
                            />
                          </>
                        ) : (
                          <TileLayer
                            attribution='Tiles &copy; Esri'
                            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"
                            maxZoom={22}
                            maxNativeZoom={19}
                          />
                        )}
                        <MapClickHandler onSelect={handleMapSelect} />
                        <MapCenterUpdater center={mapCenter} zoom={mapZoom} />
                        <MapResizeWatcher active={isMapOpen} />
                        {selectedLocation && (
                          <Marker
                            position={selectedLocation}
                            icon={selectedLocationIcon}
                          />
                        )}
                      </MapContainer>
                    </div>
                    {mapError && (
                      <p className="text-xs font-medium text-amber-700">{mapError}</p>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-6">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-sky text-ocean">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </span>
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-ocean font-semibold">Start</p>
                    <p className="text-sm text-gray-700">Date and time</p>
                  </div>
                </div>
                <div className="rounded-2xl bg-white border border-gray-200 p-4 shadow-sm space-y-3">
                  <DatePicker
                    selected={startDateTime}
                    onChange={(date) => onStartChange(date)}
                    placeholderText="Start date"
                    dateFormat="yyyy-MM-dd"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ocean focus:border-ocean bg-white"
                    disabled={submitting}
                    popperClassName="z-50"
                  />
                  <select
                    value={formatTime(startDateTime)}
                    onChange={(e) => {
                      const merged = combineDateAndTime(startDateTime, e.target.value);
                      if (merged) onStartChange(merged);
                    }}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ocean focus:border-ocean bg-white"
                    disabled={submitting || !startDateTime}
                  >
                    <option value="">Select time</option>
                    {timeOptions.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-cream text-gray-700">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </span>
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-ocean font-semibold">End</p>
                    <p className="text-sm text-gray-700">Date and time</p>
                  </div>
                </div>
                <div className="rounded-2xl bg-white border border-gray-200 p-4 shadow-sm space-y-3">
                  <DatePicker
                    selected={endDateTime}
                    onChange={(date) => onEndChange(date)}
                    placeholderText="End date"
                    dateFormat="yyyy-MM-dd"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ocean focus:border-ocean bg-white"
                    disabled={submitting}
                    popperClassName="z-50"
                    minDate={startDateTime || undefined}
                  />
                  <select
                    value={formatTime(endDateTime)}
                    onChange={(e) => {
                      const merged = combineDateAndTime(endDateTime, e.target.value);
                      if (merged) onEndChange(merged);
                    }}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ocean focus:border-ocean bg-white"
                    disabled={submitting || !endDateTime}
                  >
                    <option value="">Select time</option>
                    {timeOptions.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Number of Guests
                </label>
                <input
                  type="number"
                  min="1"
                  placeholder="e.g. 120"
                  value={nbOfGuests}
                  onChange={(e) => onGuestsChange(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ocean focus:border-ocean bg-white"
                  disabled={submitting}
                  required
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                className="w-full md:w-auto px-6 py-3 rounded-xl bg-ocean text-white text-sm font-semibold shadow-md hover:bg-ocean/90 transition flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                disabled={submitting}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                {submitting ? "Submitting..." : "Submit Request"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
