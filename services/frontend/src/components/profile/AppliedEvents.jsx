import React from "react";
import { Calendar, MapPin, Clock } from "lucide-react";

export default function AppliedEvents({ events }) {
  const getStatusStyles = (status) => {
    switch (status) {
      case "Accepted":
        return "bg-mint/30 text-green-700 border-mint";
      case "Pending":
        return "bg-sky text-ocean border-sky";
      case "Rejected":
        return "bg-rose/30 text-red-700 border-rose";
      default:
        return "bg-cream text-gray-700 border-gray-200";
    }
  };

  if (events.length === 0) {
    return (
      <div className="bg-white rounded-3xl border border-dashed border-gray-200 p-12 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-cream flex items-center justify-center">
          <Calendar size={32} className="text-gray-400" />
        </div>
        <p className="text-gray-500 font-medium">No applied events yet</p>
        <p className="text-sm text-gray-400 mt-1">Browse available events and start applying</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-3xl shadow-lg border border-gray-100 overflow-hidden">
      <div className="px-6 py-5 border-b border-gray-100">
        <p className="text-xs uppercase tracking-[0.3em] text-ocean font-semibold">
          Applications
        </p>
        <h2 className="text-xl font-bold text-gray-900 mt-1">
          Events You've Applied To
        </h2>
      </div>

      <div className="divide-y divide-gray-100">
        {events.map((event) => (
          <div key={event.id} className="p-6 hover:bg-cream/50 transition">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs uppercase tracking-wide text-ocean font-semibold">
                    {event.category}
                  </span>
                </div>
                <h3 className="text-lg font-semibold text-gray-900">{event.title}</h3>
                <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
                  <span className="flex items-center gap-1">
                    <Calendar size={14} className="text-ocean" />
                    {event.date}
                  </span>
                  <span className="flex items-center gap-1">
                    <MapPin size={14} className="text-ocean" />
                    {event.location}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`px-4 py-2 rounded-full text-sm font-semibold border ${getStatusStyles(event.status)}`}>
                  {event.status}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
