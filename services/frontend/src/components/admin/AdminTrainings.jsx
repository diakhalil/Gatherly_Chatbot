import React, { useEffect, useMemo, useState } from "react";
import { adminAPI } from "../../services/api";
import { Calendar, Clock, MapPin, Users, UserPlus, BookOpen, X } from "lucide-react";
import useBodyScrollLock from "../../hooks/useBodyScrollLock";

const locationOptions = [
  "Office in Beirut Central District",
  "Office in Hamra",
  "Office in Verdun",
  "Office in Achrafieh",
  "Office in Dbayeh",
  "Office in Jounieh",
  "Office in Tripoli",
  "Office in Sidon",
  "Office in Tyre"
];

const defaultForm = {
  title: "",
  type: "",
  description: "",
  location: "",
  date: "",
  startTime: "",
  endTime: "",
};

const formatDate = (value) => {
  if (!value) return "TBD";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

const formatTime = (value) => {
  if (!value) return "—";
  const [hour = "00", minute = "00"] = String(value).split(":");
  const date = new Date();
  date.setHours(Number(hour), Number(minute));
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const sanitizeTime = (value) => {
  if (!value) return "";
  const [hour = "00", minute = "00"] = value.split(":");
  return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}:00`;
};

export default function AdminTrainings() {
  const [trainings, setTrainings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [formData, setFormData] = useState(defaultForm);
  const [showAddModal, setShowAddModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [attendeesModal, setAttendeesModal] = useState(null);
  const [actionStatus, setActionStatus] = useState(null);
  useBodyScrollLock(showAddModal || Boolean(attendeesModal));

  const loadTrainings = async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await adminAPI.listTrainings();
      setTrainings(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load trainings.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTrainings();
  }, []);

  const handleFormChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const validateForm = () => {
    const required = ["title", "type", "description", "location", "date", "startTime", "endTime"];
    const missing = required.filter((field) => !formData[field]?.trim());
    if (missing.length) {
      return `Missing required fields: ${missing.join(", ")}`;
    }
    return null;
  };

  const handleCreateTraining = async (event) => {
    event.preventDefault();
    setFormError("");
    const validation = validateForm();
    if (validation) {
      setFormError(validation);
      return;
    }

    setSaving(true);
    try {
      const payload = {
        ...formData,
        startTime: sanitizeTime(formData.startTime),
        endTime: sanitizeTime(formData.endTime),
      };
      await adminAPI.createTraining(payload);
      setShowAddModal(false);
      setFormData(defaultForm);
      await loadTrainings();
    } catch (err) {
      setFormError(err.response?.data?.message || "Failed to create training.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTraining = async (trainingId) => {
    if (!window.confirm("Delete this training?")) return;
    try {
      await adminAPI.deleteTraining(trainingId);
      setTrainings((prev) => prev.filter((training) => training.trainingId !== trainingId));
    } catch (err) {
      setActionStatus({
        type: "error",
        text: err.response?.data?.message || "Failed to delete training.",
      });
      return;
    }
    setActionStatus({ type: "success", text: "Training deleted." });
  };

  const openAttendeesModal = async (training) => {
    setAttendeesModal({ training, attendees: [], loading: true, error: "" });
    try {
      const { data } = await adminAPI.listTrainingAttendees(training.trainingId);
      setAttendeesModal({ training, attendees: data || [], loading: false, error: "" });
    } catch (err) {
      setAttendeesModal({
        training,
        attendees: [],
        loading: false,
        error: err.response?.data?.message || "Failed to load attendees.",
      });
    }
  };

  const closeAttendeesModal = () => setAttendeesModal(null);

  const totalEnrolled = useMemo(
    () => trainings.reduce((sum, training) => sum + Number(training.enrolledCount || 0), 0),
    [trainings]
  );

  return (
    <section className="px-4 pb-16 space-y-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="bg-white rounded-3xl shadow p-6 border border-gray-100 flex flex-col gap-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-ocean font-semibold">Training Ops</p>
              <h3 className="text-lg font-semibold text-gray-900">Keep skills sharp</h3>
              <p className="text-sm text-gray-500">
                Add new sessions and monitor attendance caps at a glance.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setFormError("");
                setActionStatus(null);
                setShowAddModal(true);
              }}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-ocean text-white font-semibold shadow hover:bg-ocean/90"
            >
              <UserPlus size={16} /> New training
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-gray-100 bg-cream p-4">
              <p className="text-xs uppercase tracking-[0.3em] text-gray-500 font-semibold">Scheduled</p>
              <p className="text-3xl font-bold text-gray-900">{trainings.length}</p>
              <p className="text-sm text-gray-600">Future + current sessions</p>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-cream p-4">
              <p className="text-xs uppercase tracking-[0.3em] text-gray-500 font-semibold">Enrolled hosts</p>
              <p className="text-3xl font-bold text-gray-900">{totalEnrolled}</p>
              <p className="text-sm text-gray-600">Across all trainings</p>
            </div>
          </div>
        </div>
        {actionStatus?.text && (
          <div
            className={`rounded-3xl border px-4 py-3 text-sm ${
              actionStatus.type === "error"
                ? "border-rose/30 bg-rose/10 text-rose-700"
                : "border-mint/40 bg-mint/10 text-emerald-700"
            }`}
          >
            {actionStatus.text}
          </div>
        )}

        {loading ? (
          <div className="rounded-3xl border border-dashed border-gray-200 p-10 text-center text-gray-500 bg-white">
            Loading trainings...
          </div>
        ) : error ? (
          <div className="rounded-3xl border border-red-100 bg-red-50 p-10 text-center text-red-600">
            {error}
          </div>
        ) : trainings.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-gray-200 p-10 text-center text-gray-500 bg-white">
            No trainings scheduled yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {trainings.map((training) => (
              <article key={training.trainingId} className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-ocean font-semibold">{training.type || "Training"}</p>
                    <h3 className="text-xl font-bold text-gray-900">{training.title}</h3>
                    <p className="text-sm text-gray-500">ID #{training.trainingId}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteTraining(training.trainingId)}
                    className="text-sm text-red-500 hover:text-red-700"
                  >
                    Remove
                  </button>
                </div>

                <p className="text-sm text-gray-600 leading-relaxed">{training.description}</p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-gray-700">
                  <div className="flex items-center gap-2">
                    <Calendar size={16} className="text-ocean" />
                    <span>{formatDate(training.date)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock size={16} className="text-ocean" />
                    <span>
                      {formatTime(training.startTime)} - {formatTime(training.endTime)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin size={16} className="text-ocean" />
                    <span>{training.location}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Users size={16} className="text-ocean" />
                    <span>{Number(training.enrolledCount || 0)} enrolled</span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => openAttendeesModal(training)}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl border border-gray-200 text-gray-700 font-semibold hover:border-ocean hover:text-ocean transition"
                  >
                    <BookOpen size={16} /> View attendees
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full p-6 space-y-6 relative">
            <button
              type="button"
              onClick={() => setShowAddModal(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
            >
              <X size={20} />
            </button>
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-ocean font-semibold">New training</p>
              <h3 className="text-2xl font-bold text-gray-900">Create a session</h3>
            </div>
            {formError && (
              <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-600">{formError}</div>
            )}
            <form onSubmit={handleCreateTraining} className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <label className="space-y-2 text-sm font-semibold text-gray-700">
                  Title
                  <input
                    type="text"
                    value={formData.title}
                    onChange={(e) => handleFormChange("title", e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 focus:ring-2 focus:ring-ocean/50"
                  />
                </label>
                <label className="space-y-2 text-sm font-semibold text-gray-700">
                  Type
                  <input
                    type="text"
                    value={formData.type}
                    onChange={(e) => handleFormChange("type", e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 focus:ring-2 focus:ring-ocean/50"
                  />
                </label>
              </div>
              <label className="space-y-2 text-sm font-semibold text-gray-700">
                Description
                <textarea
                  value={formData.description}
                  onChange={(e) => handleFormChange("description", e.target.value)}
                  rows={3}
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 focus:ring-2 focus:ring-ocean/50"
                />
              </label>
              <label className="space-y-2 text-sm font-semibold text-gray-700">
                Location
                <select
                  value={formData.location}
                  onChange={(e) => handleFormChange("location", e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 focus:ring-2 focus:ring-ocean/50"
                >
                  <option value="" disabled hidden>
                    Select a location
                  </option>
                  {locationOptions.map((location) => (
                    <option key={location} value={location}>
                      {location}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid md:grid-cols-3 gap-4">
                <label className="space-y-2 text-sm font-semibold text-gray-700">
                  Date
                  <input
                    type="date"
                    value={formData.date}
                    onChange={(e) => handleFormChange("date", e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 focus:ring-2 focus:ring-ocean/50"
                  />
                </label>
                <label className="space-y-2 text-sm font-semibold text-gray-700">
                  Start Time
                  <input
                    type="time"
                    value={formData.startTime}
                    onChange={(e) => handleFormChange("startTime", e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 focus:ring-2 focus:ring-ocean/50"
                  />
                </label>
                <label className="space-y-2 text-sm font-semibold text-gray-700">
                  End Time
                  <input
                    type="time"
                    value={formData.endTime}
                    onChange={(e) => handleFormChange("endTime", e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 focus:ring-2 focus:ring-ocean/50"
                  />
                </label>
              </div>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-5 py-2.5 rounded-xl border border-gray-200 text-gray-600 font-semibold hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2.5 rounded-xl bg-ocean text-white font-semibold shadow hover:bg-ocean/90 disabled:opacity-60"
                >
                  {saving ? "Saving..." : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {attendeesModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-xl w-full p-6 space-y-5 relative">
            <button
              type="button"
              onClick={closeAttendeesModal}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
            >
              <X size={20} />
            </button>
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-ocean font-semibold">Attendees</p>
              <h3 className="text-2xl font-bold text-gray-900">{attendeesModal.training.title}</h3>
              <p className="text-sm text-gray-500">
                {formatDate(attendeesModal.training.date)} • {attendeesModal.training.location}
              </p>
            </div>
            {attendeesModal.error && (
              <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-600">
                {attendeesModal.error}
              </div>
            )}
            {attendeesModal.loading ? (
              <div className="rounded-2xl border border-dashed border-gray-200 p-6 text-center text-gray-500">
                Loading attendees...
              </div>
            ) : attendeesModal.attendees.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-200 p-6 text-center text-gray-500">
                No attendees yet.
              </div>
            ) : (
              <ul className="space-y-3 max-h-80 overflow-y-auto">
                {attendeesModal.attendees.map((attendee) => (
                  <li key={attendee.userId} className="flex items-center justify-between rounded-2xl border border-gray-100 px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">
                        {[attendee.fName, attendee.lName].filter(Boolean).join(" ") || `Host #${attendee.userId}`}
                      </p>
                      <p className="text-xs text-gray-500">{attendee.email}</p>
                    </div>
                    <span className="text-xs font-semibold px-3 py-1 rounded-full bg-cream text-gray-700 border border-gray-200">
                      Size {attendee.clothingSize || "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
