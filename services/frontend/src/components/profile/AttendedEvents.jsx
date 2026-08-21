import React from "react";
import { Link } from "react-router-dom";
import { Calendar, MapPin, Star, Users, Crown } from "lucide-react";

export default function AttendedEvents({ events }) {
  if (events.length === 0) {
    return (
      <div className="bg-white rounded-3xl border border-dashed border-gray-200 p-12 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-cream flex items-center justify-center">
          <Calendar size={32} className="text-gray-400" />
        </div>
        <p className="text-gray-500 font-medium">No attended events yet</p>
        <p className="text-sm text-gray-400 mt-1">Events you've worked at will appear here</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-3xl shadow-lg border border-gray-100 overflow-hidden">
      <div className="px-6 py-5 border-b border-gray-100">
        <p className="text-xs uppercase tracking-[0.3em] text-ocean font-semibold">
          Work History
        </p>
        <h2 className="text-xl font-bold text-gray-900 mt-1">
          Events You've Attended
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-6">
        {events.map((event) => (
          <article
            key={event.id}
            className="bg-cream/50 rounded-2xl p-5 border border-gray-100 hover:shadow-md transition"
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs uppercase tracking-wide text-ocean font-semibold">
                    {event.role}
                  </span>
                  {event.role === "Team Leader" && (
                    <Crown size={14} className="text-yellow-500" fill="currentColor" />
                  )}
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mt-1">{event.title}</h3>
              </div>
              <span className="px-3 py-1 rounded-full bg-sky text-ocean text-sm font-semibold flex items-center gap-1">
                <Star size={12} fill="currentColor" />
                {event.rating}
              </span>
            </div>

            <div className="space-y-2 text-sm text-gray-600">
              <div className="flex items-center gap-2">
                <Calendar size={14} className="text-ocean" />
                <span>{event.date}</span>
              </div>
              <div className="flex items-center gap-2">
                <MapPin size={14} className="text-ocean" />
                <span>{event.location}</span>
              </div>
              <div className="flex items-center gap-2">
                <Users size={14} className="text-ocean" />
                <span>{event.client}</span>
              </div>
            </div>

            {/* Team Leader Access */}
            {event.role === "Team Leader" && (
              <Link
                to={`/team-leader/event/${event.id}`}
                className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-ocean text-white text-sm font-semibold hover:bg-ocean/80 transition"
              >
                <Crown size={14} />
                Manage Event
              </Link>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
