import React, { useEffect, useState, useMemo } from "react";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import api from "../services/api";

const formatDate = (value) => {
  if (!value) return "—";
  const parts = String(value).split("-");
  if (parts.length === 3) {
    const [y, m, d] = parts.map((v) => parseInt(v, 10));
    if (!Number.isNaN(y) && !Number.isNaN(m) && !Number.isNaN(d)) {
      const date = new Date(y, m - 1, d);
      return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    }
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

const formatTime = (value) => {
  if (!value) return "—";
  const [h, m] = String(value).split(":");
  if (h === undefined || m === undefined) return value;
  const hour = parseInt(h, 10);
  const minute = parseInt(m, 10);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return value;
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
};

const Badge = ({ children, tone = "blue" }) => {
  const toneMap = {
    blue: "bg-sky text-ocean border-ocean/20",
    green: "bg-mint/30 text-green-700 border-mint",
    gray: "bg-gray-100 text-gray-700 border-gray-200",
  };
  return (
    <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${toneMap[tone] || toneMap.blue}`}>
      {children}
    </span>
  );
};

const TrainingCard = ({ training }) => {
  const {
    title,
    type,
    description,
    date,
    startTime,
    endTime,
    location,
  } = training;

  return (
    <article className="rounded-3xl border border-gray-100 bg-white shadow-sm hover:shadow-md transition p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.25em] text-ocean font-semibold">Training</p>
          <h3 className="text-xl font-semibold text-gray-900">{title}</h3>
          <p className="text-sm text-gray-600">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge>{type}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm text-gray-700">
        <div className="rounded-xl bg-cream px-3 py-2 border border-gray-100">
          <p className="text-xs text-gray-500">Date</p>
          <p className="font-semibold text-gray-900">{formatDate(date)}</p>
        </div>
        <div className="rounded-xl bg-cream px-3 py-2 border border-gray-100">
          <p className="text-xs text-gray-500">Starts</p>
          <p className="font-semibold text-gray-900">{formatTime(startTime)}</p>
        </div>
        <div className="rounded-xl bg-cream px-3 py-2 border border-gray-100">
          <p className="text-xs text-gray-500">Ends</p>
          <p className="font-semibold text-gray-900">{formatTime(endTime)}</p>
        </div>
        <div className="rounded-xl bg-cream px-3 py-2 border border-gray-100">
          <p className="text-xs text-gray-500">Location</p>
          <p className="font-semibold text-gray-900">{location || "—"}</p>
        </div>
      </div>
    </article>
  );
};

export default function TrainingsPage() {
  const [trainings, setTrainings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const loadTrainings = async () => {
      setLoading(true);
      try {
        const res = await api.get("/trainings");
        if (!active) return;
        setTrainings(res.data || []);
      } catch (err) {
        if (!active) return;
        const msg = err?.response?.data?.message || err.message || "Failed to load trainings";
        setError(msg);
      } finally {
        if (active) setLoading(false);
      }
    };
    loadTrainings();
    return () => {
      active = false;
    };
  }, []);

  const stats = useMemo(() => {
    const total = trainings.length;
    // If backend doesn’t send status, mark all as upcoming
    const upcoming = trainings.filter((t) => (t.status || "").toLowerCase() !== "completed").length;
    const completed = trainings.filter((t) => (t.status || "").toLowerCase() === "completed").length;
    return { total, upcoming, completed };
  }, [trainings]);

  return (
    <main className="bg-pearl min-h-screen">
      <Navbar />

      <div className="pt-24 space-y-8 px-4">
        <div className="max-w-6xl mx-auto bg-white rounded-[2rem] p-6 md:p-10 shadow-xl border border-gray-100">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-[0.4em] text-ocean font-semibold">Skill Growth</p>
              <h1 className="text-3xl md:text-4xl font-bold text-gray-900 leading-tight">
                Training & Certifications
              </h1>
              <p className="text-sm text-gray-600 max-w-2xl">
                Browse upcoming trainings, see schedules, and get prepared. Admins can manage sessions; hosts can view and attend.
              </p>
              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm px-4 py-3">
                  {error}
                </div>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3 w-full md:w-auto">
              <div className="rounded-2xl border border-gray-100 bg-cream px-4 py-3 text-center">
                <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
                <p className="text-[0.7rem] uppercase tracking-wide text-gray-500 mt-1">Total</p>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-sky px-4 py-3 text-center">
                <p className="text-2xl font-bold text-ocean">{stats.upcoming}</p>
                <p className="text-[0.7rem] uppercase tracking-wide text-ocean mt-1">Upcoming</p>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-mint/30 px-4 py-3 text-center">
                <p className="text-2xl font-bold text-green-700">{stats.completed}</p>
                <p className="text-[0.7rem] uppercase tracking-wide text-green-700 mt-1">Completed</p>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-6xl mx-auto pb-16">
          {loading ? (
            <div className="bg-white rounded-3xl border border-gray-100 p-10 text-center text-gray-600 shadow-sm">
              Loading trainings...
            </div>
          ) : trainings.length === 0 ? (
            <div className="bg-white rounded-3xl border border-dashed border-gray-200 p-12 text-center shadow-sm">
              <p className="text-gray-500 font-medium">No trainings found</p>
              <p className="text-sm text-gray-400 mt-1">Admins can create trainings in the dashboard.</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {trainings.map((t) => (
                <TrainingCard key={t.trainingId || t.id} training={t} />
              ))}
            </div>
          )}
        </div>
      </div>

      <Footer />
    </main>
  );
}
