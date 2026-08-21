import React from "react";

export default function ClientEventList({ events }) {
  //Note: this fction returns Tailwind CSS classes to choose the color of the event button according to status
  const getStatusStyles = (status) => {
    const normalized = String(status || "").toLowerCase();
    if (normalized === "accepted" || normalized === "confirmed") {
      return "bg-green-100 text-green-700 border-green-200";
    }
    if (normalized === "pending") {
      return "bg-yellow-100 text-yellow-700 border-yellow-200";
    }
    if (normalized === "under discussion") {
      return "bg-blue-100 text-blue-700 border-blue-200";
    }
    if (normalized === "rejected") {
      return "bg-red-100 text-red-700 border-red-200";
    }
    switch (status) {
      case "Confirmed":
        return "bg-green-100 text-green-700 border-green-200";
      case "Pending review":
        return "bg-yellow-100 text-yellow-700 border-yellow-200";
      case "Under discussion":
        return "bg-purple-100 text-purple-700 border-purple-200";
      default:
        return "bg-gray-100 text-gray-700 border-gray-200";
    }
  };

  //Note: function that returns a small icon (SVG) depending on the event’s status.
  const getStatusIcon = (status) => {
    const normalized = String(status || "").toLowerCase();
    if (normalized === "accepted" || normalized === "confirmed") {
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      );
    }
    if (normalized === "pending") {
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    }
    if (normalized === "rejected") {
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      );
    }
    switch (status) {
      case "Confirmed":
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        );
      case "Pending review":
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      case "Under discussion":
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        );
      default:
        return null;
    }
  };

  return (
    <div className="bg-white rounded-3xl shadow-lg border border-gray-100 overflow-hidden">
      <div className="px-8 py-6 border-b border-gray-100 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-ocean font-semibold">
            Your Events
          </p>
          <h2 className="text-2xl font-bold text-gray-900 mt-1">
            Event Requests
          </h2>
        </div>
        {/*Note: if there is one event, write Request, if more than one write Requests*/}
        <span className="px-4 py-2 rounded-full bg-sky text-ocean text-sm font-semibold">
          {events.length} {events.length === 1 ? "Request" : "Requests"}
        </span>
      </div>


      {/*Note: If there are NO events → show “No requests yet”, Else → show a list (cards) of events} */}
      <div className="p-6">
        {events.length === 0 ? (
          <div className="bg-cream rounded-2xl border border-dashed border-gray-200 p-12 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="text-gray-500 font-medium">No requests yet</p>
            <p className="text-sm text-gray-400 mt-1">Create your first event request above</p>
          </div>
        
      ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {/*Note: For each event inside events, we do the following JSX. */}
            {events.map((ev) => (
              <article
                key={ev.id}
                className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] text-ocean font-semibold">
                      Event
                    </p>
                    <h3 className="text-xl font-semibold text-gray-900 mt-1">
                      {ev.type}
                    </h3>
                  </div>
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border ${getStatusStyles(ev.status)}`}>
                    {getStatusIcon(ev.status)}
                    {ev.status}
                  </span>
                </div>

                <div className="space-y-2 mt-4">
                  <div className="flex items-center gap-3 text-sm text-gray-600">
                    <div className="w-8 h-8 rounded-lg bg-cream flex items-center justify-center">
                      <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <span><span className="font-medium text-gray-900">Date:</span> {ev.date}</span>
                   </div> {/* Note: I used span here to make Date in bold and the actual date in normal font */}
                  <div className="flex items-center gap-3 text-sm text-gray-600">
                    <div className="w-8 h-8 rounded-lg bg-cream flex items-center justify-center">
                      <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </div>
                    <span><span className="font-medium text-gray-900">Hosts:</span> {ev.guests}</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
