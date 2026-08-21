import React, { useEffect, useMemo, useState } from "react";
import { adminAPI } from "../../services/api";
import { Search, User, Mail, Phone, MapPin, Eye, X, Calendar } from "lucide-react";
import useBodyScrollLock from "../../hooks/useBodyScrollLock";

const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

export default function ClientDirectory() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedClient, setSelectedClient] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  useBodyScrollLock(Boolean(selectedClient));

  useEffect(() => {
    let cancelled = false;
    const loadClients = async () => {
      setLoading(true);
      setError("");
      try {
        const { data } = await adminAPI.listClients();
        if (!cancelled) setClients(data || []);
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.message || "Failed to load clients");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadClients();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredClients = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return clients;
    return clients.filter((client) => {
      const name = `${client.fName || ""} ${client.lName || ""}`.toLowerCase();
      return (
        name.includes(query) ||
        (client.email || "").toLowerCase().includes(query) ||
        (client.phoneNb || "").toLowerCase().includes(query)
      );
    });
  }, [clients, search]);

  const handleOpenClient = async (client) => {
    setDetailError("");
    setDetailLoading(true);
    setSelectedClient({ ...client, events: [] });
    try {
      const { data } = await adminAPI.getClientDetails(client.clientId);
      setSelectedClient((prev) => ({ ...(prev || {}), ...data }));
    } catch (err) {
      setDetailError(err.response?.data?.message || "Failed to load client details");
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <section className="px-4 pb-16 space-y-6">
      <div className="max-w-6xl mx-auto bg-white rounded-3xl shadow p-6 border border-gray-100 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-ocean font-semibold">Client records</p>
            <h3 className="text-lg font-semibold text-gray-900">All registered clients</h3>
            <p className="text-sm text-gray-500">Clients become active immediately; review their event history here.</p>
          </div>
          <div className="relative w-full md:w-72">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, or phone"
              className="w-full pl-10 pr-4 py-2.5 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-ocean/40"
            />
          </div>
        </div>
        {loading ? (
          <div className="rounded-2xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">
            Loading clients...
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-100 bg-red-50 p-6 text-center text-sm text-red-600">
            {error}
          </div>
        ) : filteredClients.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">
            No clients match this search.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {filteredClients.map((client) => (
              <article key={client.clientId} className="bg-cream/40 rounded-2xl p-5 border border-gray-100 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-ocean font-semibold">Client</p>
                    <h4 className="text-xl font-semibold text-gray-900">
                      {[client.fName, client.lName].filter(Boolean).join(" ") || `Client #${client.clientId}`}
                    </h4>
                    <p className="text-sm text-gray-500">
                      First event {client.firstEventAt ? formatDate(client.firstEventAt) : "not scheduled"}
                    </p>
                  </div>
                  <span className="px-3 py-1 rounded-full text-xs font-semibold bg-white border border-gray-200 text-gray-700">
                    {client.eventCount || 0} events
                  </span>
                </div>

                <div className="mt-4 space-y-3 text-sm text-gray-700">
                  <div className="flex items-center gap-2">
                    <Mail size={16} className="text-ocean" />
                    <span>{client.email}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Phone size={16} className="text-ocean" />
                    <span>{client.phoneNb}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin size={16} className="text-ocean" />
                    <span>{client.address}</span>
                  </div>
                </div>

                <div className="mt-5 flex items-center justify-between text-sm text-gray-500">
                  <span>Last activity: {client.lastEventAt ? formatDate(client.lastEventAt) : "No events yet"}</span>
                  <button
                    type="button"
                    onClick={() => handleOpenClient(client)}
                    className="inline-flex items-center gap-2 text-ocean font-semibold hover:text-ocean/80"
                  >
                    <Eye size={16} /> View
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {selectedClient && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-3xl w-full relative p-6 space-y-6">
            <button
              type="button"
              onClick={() => {
                setSelectedClient(null);
                setDetailError("");
              }}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
            >
              <X size={20} />
            </button>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div className="h-14 w-14 rounded-2xl bg-cream flex items-center justify-center text-ocean">
                  <User size={28} />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-ocean font-semibold">Client</p>
                  <h3 className="text-2xl font-bold text-gray-900">
                    {[selectedClient.fName, selectedClient.lName].filter(Boolean).join(" ") || `Client #${selectedClient.clientId}`}
                  </h3>
                  <p className="text-sm text-gray-500">
                    First event {selectedClient.firstEventAt ? formatDate(selectedClient.firstEventAt) : "pending"}
                  </p>
                </div>
              </div>
              {detailError && (
                <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-600">
                  {detailError}
                </div>
              )}
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="rounded-2xl border border-gray-100 p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                  <Mail size={16} className="text-ocean" />
                  <span>Contact</span>
                </div>
                <div className="text-sm text-gray-600 space-y-1">
                  <p>{selectedClient.email}</p>
                  <p>{selectedClient.phoneNb}</p>
                  <p>{selectedClient.address}</p>
                </div>
                <div className="text-sm text-gray-500">
                  Age {selectedClient.age} • Gender {selectedClient.gender}
                </div>
              </div>
              <div className="rounded-2xl border border-gray-100 p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                  <Calendar size={16} className="text-ocean" />
                  <span>Events</span>
                </div>
                {detailLoading ? (
                  <p className="text-sm text-gray-500">Loading events...</p>
                ) : selectedClient.events && selectedClient.events.length > 0 ? (
                  <ul className="space-y-2 text-sm text-gray-600 max-h-48 overflow-y-auto">
                    {selectedClient.events.map((event) => (
                      <li key={event.eventId} className="flex items-center justify-between gap-2">
                        <div>
                          <p className="font-semibold text-gray-900">{event.type}</p>
                          <p className="text-xs text-gray-500">{formatDate(event.startsAt)} • {event.location || "TBA"}</p>
                        </div>
                        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${
                          event.status === "accepted"
                            ? "text-green-600 bg-green-50 border-green-200"
                            : event.status === "rejected"
                            ? "text-red-600 bg-red-50 border-red-200"
                            : "text-yellow-700 bg-yellow-50 border-yellow-200"
                        }`}>
                          {event.status || "pending"}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-500">No events submitted yet.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
