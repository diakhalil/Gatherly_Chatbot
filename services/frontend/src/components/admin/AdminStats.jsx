import React, { useEffect, useState } from "react";
import api from "../../services/api";

const defaultStats = [
  { label: "Pending Client Event Requests", key: "pendingEventRequests", value: 0, color: "text-ocean" },
  { label: "Pending Host Applications", key: "pendingHostApplications", value: 0, color: "text-rose" },
];

export default function AdminStats() {
  const [stats, setStats] = useState(defaultStats);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const fetchStats = async () => {
      setLoading(true);
      setError(null);
      try {
        // Use the dedicated admin stats endpoint instead of multiple separate calls
        const response = await api.get("/admins/stats");

        if (cancelled) return;

        const { pendingEventRequests, pendingHostApplications } = response.data;

        setStats((prev) =>
          prev.map((stat) => {
            switch (stat.key) {
              case "pendingEventRequests":
                return { ...stat, value: pendingEventRequests || 0 };
              case "pendingHostApplications":
                return { ...stat, value: pendingHostApplications || 0 };
              default:
                return stat;
            }
          })
        );
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.message || "Failed to load admin stats");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchStats();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="px-4 pt-24">
      <div className="max-w-6xl mx-auto bg-white rounded-[3rem] p-8 md:p-12 shadow-xl border border-gray-100">
        <div className="space-y-6">
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-[0.4em] text-ocean font-semibold">
              Admin Overview
            </p>
            <h1 className="text-4xl md:text-5xl font-bold leading-tight text-gray-900">
              Manage Events & Applications
            </h1>
            <p className="text-base text-gray-600 max-w-2xl">
              Review event requests from clients, manage host applications, and oversee all platform activities from your centralized dashboard.
            </p>
            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-2">
                {error}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-6 pt-4">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-2xl border border-gray-100 bg-cream px-6 py-6 text-center hover:shadow-md transition"
              >
                <p className={`text-3xl font-bold ${stat.color}`}>
                  {loading ? "…" : stat.value}
                </p>
                <p className="text-[0.7rem] uppercase tracking-wide text-gray-500 mt-2">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
