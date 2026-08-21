import React from "react";
import { Link } from "react-router-dom";
import {
  User,
  Mail,
  Phone,
  Star,
  Eye,
  Shirt,
  CheckCircle,
  Clock,
  AlertTriangle,
  Bus,
} from "lucide-react";

export default function AcceptedHosts({
  hosts,
  attendance = {},
  onToggleAttendance = () => {},
  targetCount = null,
  confirmedCount = null,
  openSlots = 0,
}) {
  const placeholders = Math.max((targetCount || 0) - hosts.length, 0);

  const renderEmpty = () => (
    <div className="bg-white rounded-3xl border border-dashed border-gray-200 p-12 text-center">
      <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-cream flex items-center justify-center">
        <User size={32} className="text-gray-400" />
      </div>
      <p className="text-gray-500 font-medium">No hosts assigned yet</p>
      <p className="text-sm text-gray-400 mt-1">Accepted hosts will appear here</p>
    </div>
  );

  return (
    <div className="bg-white rounded-3xl shadow-lg border border-gray-100 overflow-hidden">
      
      <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-ocean font-semibold">
            Your Team
          </p>
          <h2 className="text-xl font-bold text-gray-900 mt-1">Accepted Hosts</h2>
          {(typeof confirmedCount === "number" || targetCount) && (
            <p className="text-sm text-gray-500 mt-1">
              {confirmedCount ?? hosts.length} confirmed{targetCount ? ` of ${targetCount}` : ""} ·{" "}
              {openSlots > 0 ? `${openSlots} open slot${openSlots > 1 ? "s" : ""}` : "Fully staffed"}
            </p>
          )}
        </div>
        <span className="px-4 py-2 rounded-full bg-mint/30 text-green-700 text-sm font-semibold">
          {hosts.length} Member{hosts.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Hosts Grid */}
      <div className="p-6">
        {hosts.length === 0 ? (
          renderEmpty()
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {hosts.map((host) => {
              const initials = host.name
                .split(" ")
                .filter(Boolean)
                .map((n) => n[0])
                .join("");
              const isCheckedIn = Boolean(attendance[String(host.userId)]);

              return (
                <article
                  key={host.userId}
                  className="bg-cream/50 rounded-2xl p-5 border border-gray-100 hover:shadow-md transition"
                >
                  {/* Header */}
                  <div className="flex items-start gap-4 mb-4">
                    {host.profileImage ? (
                      <img
                        src={host.profileImage}
                        alt={host.name}
                        className="w-14 h-14 rounded-xl object-cover"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-xl bg-ocean flex items-center justify-center text-white text-lg font-bold">
                        {initials}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-gray-900 truncate">{host.name}</h3>
                      <p className="text-sm text-gray-500">{host.role}</p>
                      <div className="flex items-center gap-1 mt-1">
                        <Star size={14} className="text-yellow-500" fill="currentColor" />
                        <span className="text-sm font-medium text-gray-700">
                          {host.rating ?? "TBD"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Contact Info */}
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2 text-gray-600">
                      <Mail size={14} className="text-ocean flex-shrink-0" />
                      <span className="truncate">{host.email}</span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-600">
                      <Phone size={14} className="text-ocean flex-shrink-0" />
                      <span>{host.phone}</span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-600">
                      <Shirt size={14} className="text-ocean flex-shrink-0" />
                      <span>Size: {host.clothingSize || "N/A"}</span>
                    </div>
                    {host.outfit ? (
                      <div className="flex items-center gap-2 text-gray-600">
                        <Shirt size={14} className="text-ocean flex-shrink-0" />
                        <div>
                          <p className="font-semibold text-gray-800">{host.outfit.label}</p>
                          <p className="text-xs uppercase tracking-wide text-gray-500">
                            Uniform ready
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-gray-500">
                        <Shirt size={14} className="text-ocean flex-shrink-0" />
                        <span>Uniform pending assignment</span>
                      </div>
                    )}
                    {host.outfit?.description && (
                      <p className="text-xs text-gray-500 italic">"{host.outfit.description}"</p>
                    )}
                    <div className="flex items-center gap-2 text-gray-600">
                      <Bus size={14} className="text-ocean flex-shrink-0" />
                      <span>{host.needsRide ? "Needs transportation" : "Self-arrival"}</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="mt-4 space-y-2">
                    <button
                      type="button"
                      onClick={() => onToggleAttendance(host.userId)}
                      className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition ${
                        isCheckedIn
                          ? "bg-mint/40 text-green-800 border border-green-200"
                          : "border border-gray-200 text-gray-700 hover:border-ocean hover:text-ocean"
                      }`}
                    >
                      {isCheckedIn ? (
                        <>
                          <CheckCircle size={16} />
                          Checked In
                        </>
                      ) : (
                        <>
                          <Clock size={16} />
                          Awaiting Arrival
                        </>
                      )}
                    </button>
                    <Link
                      to={`/profile/${host.userId}`}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-ocean text-ocean text-sm font-semibold hover:bg-sky transition"
                    >
                      <Eye size={16} />
                      View Full Profile
                    </Link>
                  </div>
                </article>
              );
            })}

            {placeholders > 0 &&
              Array.from({ length: placeholders }).map((_, index) => (
                <article
                  key={`placeholder-${index}`}
                  className="border border-dashed border-gray-200 rounded-2xl p-5 text-center flex flex-col items-center justify-center bg-white"
                >
                  <div className="w-14 h-14 rounded-xl bg-cream flex items-center justify-center mb-3">
                    <AlertTriangle size={20} className="text-rose" />
                  </div>
                  <p className="font-semibold text-gray-900">Open Slot</p>
                  <p className="text-sm text-gray-500 mt-1">Awaiting host assignment</p>
                  <p className="text-xs text-gray-400 mt-2">
                    Confirmed hosts will appear here automatically.
                  </p>
                </article>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
