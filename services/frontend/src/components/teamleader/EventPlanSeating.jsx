import React, { useState } from "react";
import { Clock, MapPin, Users, FileText, Grid3X3, ChevronDown, ChevronUp } from "lucide-react";

export default function EventPlanSeating({ plan }) {
  const [expandedZone, setExpandedZone] = useState(null);

  return (
    <div className="space-y-6">
      {/* Schedule Timeline */}
      <div className="bg-white rounded-3xl shadow-lg border border-gray-100 overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100">
          <p className="text-xs uppercase tracking-[0.3em] text-ocean font-semibold">
            Timeline
          </p>
          <h2 className="text-xl font-bold text-gray-900 mt-1">
            Event Schedule
          </h2>
        </div>

        <div className="p-6">
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-[27px] top-0 bottom-0 w-0.5 bg-sky" />
            
            <div className="space-y-4">
              {plan.schedule.map((item, index) => (
                <div key={index} className="relative flex gap-4">
                  {/* Timeline dot */}
                  <div className="relative z-10 w-14 flex-shrink-0">
                    <div className="w-14 h-14 rounded-xl bg-ocean text-white flex items-center justify-center text-sm font-bold">
                      {item.time}
                    </div>
                  </div>
                  
                  {/* Content */}
                  <div className="flex-1 bg-cream/50 rounded-xl p-4 border border-gray-100">
                    <h4 className="font-semibold text-gray-900">{item.activity}</h4>
                    <div className="flex items-center gap-2 mt-1 text-sm text-gray-600">
                      <MapPin size={14} className="text-ocean" />
                      {item.location}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Zone Assignments */}
      <div className="bg-white rounded-3xl shadow-lg border border-gray-100 overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100">
          <p className="text-xs uppercase tracking-[0.3em] text-ocean font-semibold">
            Assignments
          </p>
          <h2 className="text-xl font-bold text-gray-900 mt-1">
            Zone & Host Assignments
          </h2>
        </div>

        <div className="p-6 space-y-3">
          {plan.zones.map((zone, index) => (
            <div
              key={index}
              className="border border-gray-100 rounded-2xl overflow-hidden"
            >
              <button
                onClick={() => setExpandedZone(expandedZone === index ? null : index)}
                className="w-full flex items-center justify-between p-4 bg-cream/50 hover:bg-cream transition"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-ocean text-white flex items-center justify-center">
                    <MapPin size={18} />
                  </div>
                  <div className="text-left">
                    <h4 className="font-semibold text-gray-900">{zone.name}</h4>
                    <p className="text-sm text-gray-500">{zone.hosts.length} hosts assigned</p>
                  </div>
                </div>
                {expandedZone === index ? (
                  <ChevronUp size={20} className="text-gray-500" />
                ) : (
                  <ChevronDown size={20} className="text-gray-500" />
                )}
              </button>

              {expandedZone === index && (
                <div className="p-4 border-t border-gray-100 space-y-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">
                      Assigned Hosts
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {zone.hosts.map((host, hostIndex) => (
                        <span
                          key={hostIndex}
                          className="px-3 py-1.5 rounded-full bg-sky text-ocean text-sm font-medium"
                        >
                          {host}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">
                      Duties
                    </p>
                    <p className="text-sm text-gray-700">{zone.duties}</p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Seating Info */}
      <div className="bg-white rounded-3xl shadow-lg border border-gray-100 overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100">
          <p className="text-xs uppercase tracking-[0.3em] text-ocean font-semibold">
            Layout
          </p>
          <h2 className="text-xl font-bold text-gray-900 mt-1">
            Seating Arrangement
          </h2>
        </div>

        <div className="p-6">
          {/* Stats */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-cream rounded-xl p-4 text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Users size={20} className="text-ocean" />
              </div>
              <p className="text-2xl font-bold text-gray-900">{plan.seatingCapacity}</p>
              <p className="text-xs uppercase tracking-wide text-gray-500 mt-1">Total Capacity</p>
            </div>
            <div className="bg-cream rounded-xl p-4 text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Grid3X3 size={20} className="text-ocean" />
              </div>
              <p className="text-2xl font-bold text-gray-900">{plan.tableCount}</p>
              <p className="text-xs uppercase tracking-wide text-gray-500 mt-1">Tables</p>
            </div>
          </div>

          {/* Notes */}
          {plan.notes && (
            <div className="bg-rose/20 rounded-xl p-4 border border-rose/30">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-rose/30 flex items-center justify-center flex-shrink-0">
                  <FileText size={16} className="text-rose" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-700 mb-1">Important Notes</p>
                  <p className="text-sm text-gray-600">{plan.notes}</p>
                </div>
              </div>
            </div>
          )}

          {/* Seating Chart Placeholder */}
          <div className="mt-6 bg-mist rounded-2xl p-8 text-center border-2 border-dashed border-gray-300">
            <Grid3X3 size={48} className="mx-auto text-gray-400 mb-3" />
            <p className="font-semibold text-gray-700">Seating Chart</p>
            <p className="text-sm text-gray-500 mt-1">
              Interactive seating chart will be displayed here
            </p>
            <button className="mt-4 px-6 py-2 rounded-xl bg-ocean text-white text-sm font-semibold hover:bg-ocean/80 transition">
              Download Seating Plan (PDF)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
