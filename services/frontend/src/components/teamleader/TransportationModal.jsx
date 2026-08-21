import React, { useState, useEffect } from "react";
import { Calendar, Clock, MapPin, Users, DollarSign } from "lucide-react";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import api from "../../services/api";
import "leaflet/dist/leaflet.css";

const defaultMapCenter = [33.8938, 35.5018];
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

function MapCenterUpdater({ center }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, map.getZoom());
  }, [center, map]);
  return null;
}

export default function TransportationModal({ eventAppId, hostName, onClose, onSaved }) {
  const [form, setForm] = useState({
    vehicleCapacity: 1,
    pickupLocation: "",
    departureTime: "",
    returnTime: "",
    payment: 0,
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [mapCenter, setMapCenter] = useState(defaultMapCenter);
  const [selectedLocation, setSelectedLocation] = useState(null);

  useEffect(() => {
    if (!eventAppId) return;

    const fetchTransportation = async () => {
      setLoading(true);
      try {
        const { data } = await api.get(`/transportation/${eventAppId}`);
        setForm({
          vehicleCapacity: data.vehicleCapacity || 1,
          pickupLocation: data.pickupLocation || "",
          departureTime: data.departureTime ? new Date(data.departureTime).toISOString().slice(0, 16) : "",
          returnTime: data.returnTime ? new Date(data.returnTime).toISOString().slice(0, 16) : "",
          payment: data.payment || 0,
        });
      } catch (err) {
        if (err.response?.status !== 404) {
          console.error("Failed to fetch transportation", err);
        }
        // If not found, keep empty form
      } finally {
        setLoading(false);
      }
    };

    fetchTransportation();
  }, [eventAppId]);

  const handleInputChange = (field) => (e) => {
    const value = e.target.value;
    setForm(prev => ({ ...prev, [field]: value }));
    setErrors(prev => ({ ...prev, [field]: undefined }));
  };

  const handleMapClick = async ({ lat, lng }) => {
    const nextLocation = [lat, lng];
    setSelectedLocation(nextLocation);
    setMapCenter(nextLocation);
    setForm(prev => ({ ...prev, pickupLocation: `${lat.toFixed(6)}, ${lng.toFixed(6)}` }));

    // Reverse geocode to get address
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`);
      const data = await response.json();
      if (data.display_name) {
        setForm(prev => ({ ...prev, pickupLocation: data.display_name }));
      }
    } catch (error) {
      console.error("Geocoding failed", error);
    }
  };

  const validate = () => {
    const nextErrors = {};
    if (!form.vehicleCapacity || form.vehicleCapacity < 1) {
      nextErrors.vehicleCapacity = "Must be at least 1";
    }
    if (!form.pickupLocation.trim()) {
      nextErrors.pickupLocation = "Required";
    }
    if (!form.departureTime) {
      nextErrors.departureTime = "Required";
    }
    if (form.returnTime && form.departureTime && new Date(form.returnTime) <= new Date(form.departureTime)) {
      nextErrors.returnTime = "Must be after departure time";
    }
    if (form.payment < 0) {
      nextErrors.payment = "Cannot be negative";
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving || !validate()) return;

    setSaving(true);
    setFeedbackMessage("");
    try {
      await api.post(`/transportation/${eventAppId}`, form);
      onSaved?.();
      onClose();
    } catch (err) {
      console.error("Failed to save transportation", err);
      setFeedbackMessage(err.response?.data?.message || "Failed to save transportation.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    setFeedbackMessage("");
    try {
      await api.delete(`/transportation/${eventAppId}`);
      onSaved?.();
      onClose();
    } catch (err) {
      console.error("Failed to delete transportation", err);
      setFeedbackMessage(err.response?.data?.message || "Failed to delete transportation.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 text-center">
          <p className="text-gray-600">Loading transportation details...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-100">
          <h2 className="text-xl font-bold text-gray-900">Transportation for {hostName}</h2>
          <p className="text-sm text-gray-500 mt-1">Arrange pickup, drop-off, and compensation</p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {feedbackMessage && (
            <div className="rounded-2xl border border-rose/30 bg-rose/10 px-4 py-2 text-sm text-rose-700">
              {feedbackMessage}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                <Users size={16} />
                Vehicle Capacity
              </label>
              <input
                type="number"
                min="1"
                value={form.vehicleCapacity}
                onChange={handleInputChange("vehicleCapacity")}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-ocean focus:border-ocean"
              />
              {errors.vehicleCapacity && (
                <p className="text-xs text-red-500 mt-1">{errors.vehicleCapacity}</p>
              )}
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                <DollarSign size={16} />
                Payment ($)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.payment}
                onChange={handleInputChange("payment")}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-ocean focus:border-ocean"
              />
              {errors.payment && (
                <p className="text-xs text-red-500 mt-1">{errors.payment}</p>
              )}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
              <MapPin size={16} />
              Pickup Location
            </label>
            <input
              type="text"
              value={form.pickupLocation}
              onChange={handleInputChange("pickupLocation")}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-ocean focus:border-ocean"
              placeholder="e.g., LAU Byblos Main Gate"
            />
            {errors.pickupLocation && (
              <p className="text-xs text-red-500 mt-1">{errors.pickupLocation}</p>
            )}
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700">Select Location on Map</label>
            <div className="relative z-0 mt-2 h-64 w-full rounded-lg overflow-hidden border border-gray-300">
              <MapContainer
                center={mapCenter}
                zoom={15}
                scrollWheelZoom={false}
                className="relative z-0 h-full w-full"
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <MapClickHandler onSelect={handleMapClick} />
                <MapCenterUpdater center={mapCenter} />
                {selectedLocation && (
                  <Marker position={selectedLocation} icon={selectedLocationIcon} />
                )}
              </MapContainer>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                <Clock size={16} />
                Departure Time
              </label>
              <input
                type="datetime-local"
                value={form.departureTime}
                onChange={handleInputChange("departureTime")}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-ocean focus:border-ocean"
              />
              {errors.departureTime && (
                <p className="text-xs text-red-500 mt-1">{errors.departureTime}</p>
              )}
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                <Clock size={16} />
                Return Time (Optional)
              </label>
              <input
                type="datetime-local"
                value={form.returnTime}
                onChange={handleInputChange("returnTime")}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-ocean focus:border-ocean"
              />
              {errors.returnTime && (
                <p className="text-xs text-red-500 mt-1">{errors.returnTime}</p>
              )}
            </div>
          </div>

          <div className="flex justify-between gap-3 pt-4">
            <button
              type="button"
              onClick={handleDelete}
              disabled={saving}
              className="px-4 py-2 rounded-lg text-sm font-medium text-red-600 border border-red-300 hover:bg-red-50 disabled:opacity-60"
            >
              Remove Transportation
            </button>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 border border-gray-300 hover:bg-cream disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 rounded-lg text-sm font-semibold text-white bg-ocean hover:bg-ocean/80 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {saving ? "Saving..." : "Save Transportation"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
