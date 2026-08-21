import React from "react";

export default function EventCard({
  event = {},
  onApply = () => {},
  onViewDetails = () => {},
}) {
  // Safely extract fields from the event object
  const {
    eventId,
    title,
    date,
    location,
    nbOfHosts,
    acceptedHostsCount,
    dressCode,
    shortDescription,
    imageUrl,
    category,
    badge,
  } = event;

  const filled = acceptedHostsCount ?? 0;
  const requested = nbOfHosts ?? 0;

  return (
    <div className="bg-white rounded-2xl shadow-md hover:shadow-lg transition flex flex-col overflow-hidden">
      <div className="relative h-40 w-full overflow-hidden">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={title}
            className="h-full w-full object-cover transition-transform duration-500 hover:scale-105"
          />
        ) : (
          <div className="h-full w-full bg-blush" />
        )}
        {(category || badge) && (
          <div className="absolute top-3 left-3 flex flex-wrap gap-2">
            {category && (
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-white/90 text-gray-800 shadow">
                {category}
              </span>
            )}
            {badge && (
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-indigo-600 text-white shadow">
                {badge}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="p-4 flex flex-col flex-1">
        <h3 className="text-lg font-semibold text-gray-800 mb-1">
          {title || "Untitled Event"}
        </h3>

        <p className="text-sm text-gray-600 mb-3 line-clamp-2">
          {shortDescription || "No description available."}
        </p>

        <div className="text-sm text-gray-600 mb-1">
          <span className="font-medium">Date:</span> {date || "TBA"}
        </div>

        <div className="text-sm text-gray-600 mb-1">
          <span className="font-medium">Location:</span>{" "}
          {location || "TBA"}
        </div>

        <div className="text-sm text-gray-600 mb-1">
          <span className="font-medium">Hosts:</span>{" "}
          {filled} / {requested || "?"}
        </div>

        <div className="text-xs text-gray-500 mb-4">
          <span className="font-medium">Dress code:</span>{" "}
          {dressCode || "Not specified"}
        </div>

        {/* Buttons */}
        <div className="mt-auto flex gap-2">
          <button
            onClick={() => onApply(event)}
            className="flex-1 px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition"
          >
            Apply
          </button>

          <button
            onClick={() => onViewDetails(event)}
            className="flex-1 px-3 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
          >
            View Details
          </button>
        </div>
      </div>
    </div>
  );
}
