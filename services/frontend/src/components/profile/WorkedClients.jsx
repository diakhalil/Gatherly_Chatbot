import React from "react";
import { Building2, Calendar, Star, Briefcase } from "lucide-react";

export default function WorkedClients({ clients }) {
  if (clients.length === 0) {
    return (
      <div className="bg-white rounded-3xl border border-dashed border-gray-200 p-12 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-cream flex items-center justify-center">
          <Building2 size={32} className="text-gray-400" />
        </div>
        <p className="text-gray-500 font-medium">No clients yet</p>
        <p className="text-sm text-gray-400 mt-1">Clients you've worked with will appear here</p>
      </div>
    );
  }

  const totalEventsWorked = clients.reduce((sum, c) => sum + c.eventsWorked, 0);

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="bg-rose rounded-3xl p-6 text-white">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <p className="text-white/80 text-sm uppercase tracking-wide">Client Network</p>
            <p className="text-3xl font-bold mt-1">{clients.length} Clients</p>
            <p className="text-white/80 mt-1">{totalEventsWorked} total events completed</p>
          </div>
          <div className="flex items-center gap-2">
            <Building2 size={48} className="text-white/30" />
          </div>
        </div>
      </div>

      {/* Client Grid */}
      <div className="bg-white rounded-3xl shadow-lg border border-gray-100 overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100">
          <p className="text-xs uppercase tracking-[0.3em] text-ocean font-semibold">
            Partnerships
          </p>
          <h2 className="text-xl font-bold text-gray-900 mt-1">
            Clients You've Worked With
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-6">
          {clients.map((client) => (
            <article
              key={client.id}
              className="bg-cream/50 rounded-2xl p-5 border border-gray-100 hover:shadow-md transition"
            >
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-sky flex items-center justify-center flex-shrink-0">
                  <Building2 size={24} className="text-ocean" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-semibold text-gray-900 truncate">{client.name}</h3>
                  <div className="flex items-center gap-1 mt-1">
                    <Star size={14} className="text-ocean" fill="currentColor" />
                    <span className="text-sm font-medium text-ocean">{client.rating}</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-2 text-sm text-gray-600">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Briefcase size={14} className="text-ocean" />
                    Events Worked
                  </span>
                  <span className="font-semibold text-gray-900">{client.eventsWorked}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Calendar size={14} className="text-ocean" />
                    Last Event
                  </span>
                  <span className="font-medium text-gray-700">{client.lastEvent}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
