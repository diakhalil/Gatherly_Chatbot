import React, { useEffect, useState } from "react";
import { Bus, AlertTriangle } from "lucide-react";
import api from "../services/api";
import useBodyScrollLock from "../hooks/useBodyScrollLock";
import LocationMap from "./LocationMap";

const DetailRow = ({ label, value }) => {
  if (!value) return null;
  return (
    <div className="flex justify-between text-sm text-gray-600">
      <span className="font-medium text-gray-800">{label}</span>
      <span>{value}</span>
    </div>
  );
};

const formatDateTime = (value) => {
  if (!value) return "TBA";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "TBA";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export default function EventDetailsModal({
  event,
  onClose,
  onApply,
  disableApply = false,
}) {
  const [transportInfo, setTransportInfo] = useState(null);
  const [transportLoading, setTransportLoading] = useState(false);
  const [transportError, setTransportError] = useState("");
  const [resolvedLocation, setResolvedLocation] = useState(null);
  useBodyScrollLock(Boolean(event));

  useEffect(() => {
    if (!event?.eventId) {
      setTransportInfo(null);
      setTransportError("");
      return undefined;
    }
    if (!event.transportationAvailable && !event.transportation?.available) {
      setTransportInfo(event.transportation || null);
      setTransportError("");
      return undefined;
    }
    let cancelled = false;
    setTransportLoading(true);
    setTransportError("");
    api
      .get(`/transportation/${event.eventId}`)
      .then(({ data }) => {
        if (!cancelled) {
          setTransportInfo(data);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setTransportError(err.response?.data?.message || "Failed to load transportation details");
          setTransportInfo(event.transportation || null);
        }
      })
      .finally(() => {
        if (!cancelled) setTransportLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [event?.eventId, event?.transportationAvailable, event?.transportation]);

  useEffect(() => {
    if (!event) {
      setResolvedLocation(null);
      return undefined;
    }

    const directLat = event.locationLat ?? event.location_lat ?? null;
    const directLng = event.locationLng ?? event.location_lng ?? null;
    if (directLat && directLng) {
      setResolvedLocation({
        lat: directLat,
        lng: directLng,
        name: event.locationPlaceName || event.location || "",
      });
      return undefined;
    }

    if (!event.location) {
      setResolvedLocation(null);
      return undefined;
    }

    let cancelled = false;
    const loadLocationFromAddress = async () => {
      try {
        const query = /\blebanon\b/i.test(event.location)
          ? event.location
          : `${event.location}, Lebanon`;
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=lb&q=${encodeURIComponent(query)}`
        );
        const data = await response.json();
        if (!cancelled && data?.[0]) {
          setResolvedLocation({
            lat: data[0].lat,
            lng: data[0].lon,
            name: data[0].display_name || event.location,
          });
        }
      } catch {
        if (!cancelled) setResolvedLocation(null);
      }
    };

    setResolvedLocation(null);
    loadLocationFromAddress();

    return () => {
      cancelled = true;
    };
  }, [event]);

  if (!event) return null;

  const filled = event.acceptedHostsCount ?? 0;
  const requested = event.nbOfHosts ?? 0;
  const displayLocation =
    event.locationPlaceName || event.location_place_name || event.location || "TBA";
  const fullLocation =
    event.location && event.location !== displayLocation ? event.location : "";
  const coverage =
    requested > 0 ? Math.round((filled / requested) * 100) : null;

  const info = [
    { label: "Date", value: event.date || "TBA" },
    { label: "Location", value: displayLocation },
    { label: "Dress code", value: event.outfit?.label || event.dressCode || "Not specified" },
    { label: "Hosts requested", value: `${filled} / ${requested || "?"}` },
  ];
  const transportSummary = transportInfo || event.transportation || null;
  const transportUsage =
    transportSummary?.worstCaseSeats > 0
      ? Math.round(
          (transportSummary.actualNeededSeats /
            Math.max(transportSummary.worstCaseSeats, 1)) * 100
        )
      : null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-y-auto">
        {event.imageUrl && (
          <div className="h-60 w-full overflow-hidden rounded-t-3xl">
            <img
              src={event.imageUrl}
              alt={event.title}
              className="h-full w-full object-cover"
            />
          </div>
        )}

        <div className="p-6 sm:p-8 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-widest text-ocean font-semibold mb-2">
                Event overview
              </p>
              <h2 className="text-3xl font-bold text-gray-900">
                {event.title}
              </h2>
              {event.type && (
                <p className="text-sm text-gray-500 mt-1">{event.type}</p>
              )}
            </div>

            <div className="flex flex-wrap gap-3">
              {coverage !== null && (
                <span className="px-4 py-2 rounded-full bg-emerald-50 text-emerald-700 text-sm font-semibold">
                  {coverage}% staffed
                </span>
              )}
              {event.rate && (
                <span className="px-4 py-2 rounded-full bg-sky text-ocean text-sm font-semibold">
                  ★ {event.rate} rating
                </span>
              )}
            </div>
          </div>

          <p className="text-gray-700 leading-relaxed">
            {event.description || event.shortDescription || "More details coming soon."}
          </p>

          {event.outfit && (
            <div className="bg-cream rounded-2xl p-4 border border-gray-100 flex items-center gap-4">
              {event.outfit.picture && (
                <div className="h-20 w-20 rounded-xl overflow-hidden bg-white flex-shrink-0">
                  <img
                    src={event.outfit.picture}
                    alt={event.outfit.label}
                    className="h-full w-full object-cover"
                  />
                </div>
              )}
              <div className="space-y-1">
                <p className="text-sm uppercase tracking-wide text-ocean font-semibold">
                  Event outfit
                </p>
                <p className="text-base font-semibold text-gray-900">
                  {event.outfit.label || "Provided outfit"}
                </p>
                {event.outfit.description && (
                  <p className="text-sm text-gray-600">{event.outfit.description}</p>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-cream rounded-2xl p-4">
            {info.map(({ label, value }) => (
              <DetailRow key={label} label={label} value={value} />
            ))}
          </div>

          {resolvedLocation && (
            <div className="rounded-2xl border border-gray-100 p-4 space-y-3">
              <div>
                <p className="text-sm font-semibold text-gray-800">Map Location</p>
                {fullLocation && (
                  <p className="text-sm font-semibold text-gray-900">{displayLocation}</p>
                )}
                <p className="text-xs text-gray-500">
                  {fullLocation || resolvedLocation.name || displayLocation || "Selected event location"}
                </p>
              </div>
              <LocationMap
                lat={resolvedLocation.lat}
                lng={resolvedLocation.lng}
                className="h-96"
                zoom={16}
                interactive
                showControls
                showOpenLink
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-gray-600">
                <span className="rounded-xl bg-cream px-3 py-2">
                  Latitude: {resolvedLocation.lat}
                </span>
                <span className="rounded-xl bg-cream px-3 py-2">
                  Longitude: {resolvedLocation.lng}
                </span>
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-gray-100 p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
              <Bus size={16} className="text-ocean" />
              <span>Transportation</span>
            </div>
            {transportLoading ? (
              <p className="text-sm text-gray-500">Loading transportation details...</p>
            ) : transportSummary?.available ? (
              <>
                <div className="flex flex-wrap gap-4 text-xs text-gray-600">
                  <span>Worst case: {transportSummary.worstCaseSeats} seats</span>
                  <span>Requested: {transportSummary.actualNeededSeats} seats</span>
                  {transportUsage !== null && <span>Usage: {transportUsage}%</span>}
                </div>
                {transportSummary.downgradeSuggested && (
                  <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                    <AlertTriangle size={14} />
                    <span>Demand is low. Seats may be scaled down.</span>
                  </div>
                )}
                {transportSummary.trips?.length > 0 && (
                  <div className="space-y-2 text-sm text-gray-600">
                    {transportSummary.trips.map((trip) => (
                      <div
                        key={trip.transportationId}
                        className="rounded-xl bg-cream px-3 py-2 border border-gray-100"
                      >
                        <p className="text-xs uppercase text-gray-500">
                          Pickup: {trip.pickupLocation}
                        </p>
                        <p>Departure: {formatDateTime(trip.departureTime)}</p>
                        <p>Return: {trip.returnTime ? formatDateTime(trip.returnTime) : "TBA"}</p>
                        <p>Compensation: ${Number(trip.payment ?? 0).toFixed(2)}</p>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-xs text-gray-500">
                  Check the “Need transportation?” option below if you'd like a seat reserved.
                </p>
              </>
            ) : (
              <p className="text-sm text-gray-500">
                Transportation is not available for this event. Please plan your own arrival.
              </p>
            )}
            {transportError && (
              <p className="text-xs text-red-500">
                {transportError}
              </p>
            )}
          </div>

          {event.requirements?.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold text-gray-800 mb-2">
                Requirements
              </h3>
              <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
                {event.requirements.map((req) => (
                  <li key={req}>{req}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-cream"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => !disableApply && onApply?.(event)}
              disabled={disableApply}
              className={`px-6 py-2 rounded-lg text-sm font-semibold ${
                disableApply
                  ? "bg-gray-200 text-gray-500 cursor-not-allowed"
                  : "bg-ocean text-white hover:bg-ocean/80"
              }`}
            >
              {disableApply ? "Already applied" : "Apply to this event"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
