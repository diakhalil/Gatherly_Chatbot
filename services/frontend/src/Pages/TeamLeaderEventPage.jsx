import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import AcceptedHosts from "../components/teamleader/AcceptedHosts";
import { Calendar, MapPin, Users, Clock, Building2, Star, AlertTriangle, Bus } from "lucide-react";
import LocationMap from "../components/LocationMap";
import api, { reviewAPI } from "../services/api";

const formatDate = (value) => {
  if (!value) return "TBA";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const formatTimeRange = (start, end) => {
  if (!start || !end) return "Time TBA";
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
    return "Time TBA";
  }
  const opts = { hour: "2-digit", minute: "2-digit" };
  return `${s.toLocaleTimeString([], opts)} - ${e.toLocaleTimeString([], opts)}`;
};

const formatDateTime = (value) => {
  if (!value) return "TBA";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "TBA";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const addMinutes = (isoString, minutes) => {
  if (!isoString) return null;
  const base = new Date(isoString);
  if (Number.isNaN(base.getTime())) return null;
  return new Date(base.getTime() + minutes * 60000);
};

const getEventDetails = (event) => {
  if (!event) return null;

  return {
    guests: event.nbOfGuests ? String(event.nbOfGuests) : "Not specified",
    clothing: event.outfit?.label || "Not specified",
    transportation: event.transportationAvailable ? "Arranged" : "Not arranged",
    type: event.type || "General event",
  };
};

const AUTH_EVENT = "gatherly-auth";

const readStoredUser = () => {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem("user");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.warn("Failed to parse stored user", err);
    return null;
  }
};

const REVIEW_STAR_LABELS = {
  1: "Needs urgent improvements",
  2: "Below expectations",
  3: "Met expectations",
  4: "Great execution",
  5: "Outstanding experience",
};

export default function TeamLeaderEventPage() {
  const { eventId } = useParams();
  const [activeTab, setActiveTab] = useState("hosts");
  const [eventData, setEventData] = useState(null);
  const [client, setClient] = useState(null);
  const [hosts, setHosts] = useState([]);
  const [transportation, setTransportation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [attendance, setAttendance] = useState({});
  const [review, setReview] = useState(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [reviewForm, setReviewForm] = useState({ starRating: 5, content: "" });
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewSuccess, setReviewSuccess] = useState("");
  const [sessionUser, setSessionUser] = useState(() => readStoredUser());
  const [hoveredStar, setHoveredStar] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const syncSession = () => setSessionUser(readStoredUser());
    window.addEventListener(AUTH_EVENT, syncSession);
    window.addEventListener("storage", syncSession);
    return () => {
      window.removeEventListener(AUTH_EVENT, syncSession);
      window.removeEventListener("storage", syncSession);
    };
  }, []);

  const attendanceStorageKey = useMemo(
    () => (eventId ? `team-event-${eventId}-attendance` : null),
    [eventId]
  );
  const currentUserId = sessionUser?.userId ?? sessionUser?.id ?? null;

  const eventEnded = useMemo(() => {
    if (!eventData?.endsAt) return false;
    const end = new Date(eventData.endsAt);
    if (Number.isNaN(end.getTime())) return false;
    return end <= new Date();
  }, [eventData?.endsAt]);

  const isTeamLeader = useMemo(
    () => Boolean(currentUserId && eventData?.teamLeaderId === currentUserId),
    [currentUserId, eventData?.teamLeaderId]
  );

  const transportTrips = transportation?.trips || [];
  const transportUsage =
    transportation?.worstCaseSeats > 0
      ? Math.round(
          (transportation.actualNeededSeats /
            Math.max(transportation.worstCaseSeats, 1)) * 100
        )
      : null;
  const hasTransportation = Boolean(transportation?.available);

  useEffect(() => {
    if (!eventId) {
      setError("No event selected.");
      setLoading(false);
      return;
    }

    const fetchOverview = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data } = await api.get(`/events/${eventId}/team-view`);
        setEventData(data.event);
        setClient(data.client);
        setHosts(
          data.hosts.map((host) => ({
            ...host,
            languages: host.languages ?? [],
            rating: host.rating ?? null,
          }))
        );
        setTransportation(data.transportation || null);
      } catch (err) {
        const message = err.response?.data?.message || "Failed to load event overview";
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    fetchOverview();
  }, [eventId]);

  const loadReview = useCallback(async () => {
    if (!eventId) return;
    setReviewLoading(true);
    setReviewError("");
    try {
      const { data } = await reviewAPI.getEventReviews(eventId);
      const rows = Array.isArray(data?.reviews) ? data.reviews : [];
      const selectedReview =
        (currentUserId && rows.find((rev) => rev.reviewerId === currentUserId)) ||
        rows[0] ||
        null;
      setReview(selectedReview ?? null);
    } catch (err) {
      const message = err.response?.data?.message || "Failed to load review.";
      setReviewError(message);
      setReview(null);
    } finally {
      setReviewLoading(false);
    }
  }, [eventId, currentUserId]);

  useEffect(() => {
    if (!eventData) return;
    loadReview();
  }, [eventData, loadReview]);

  useEffect(() => {
    setReviewSuccess("");
    setReviewError("");
  }, [eventId]);

  useEffect(() => {
    if (!attendanceStorageKey || typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(attendanceStorageKey);
      if (stored) {
        setAttendance(JSON.parse(stored));
      }
    } catch (err) {
      console.warn("Failed to parse stored attendance", err);
    }
  }, [attendanceStorageKey]);

  useEffect(() => {
    if (!attendanceStorageKey || hosts.length === 0 || typeof window === "undefined") return;
    setAttendance((prev) => {
      const validIds = new Set(hosts.map((h) => String(h.userId)));
      const filteredEntries = Object.entries(prev).filter(([id]) => validIds.has(String(id)));
      const filtered = Object.fromEntries(filteredEntries);
      window.localStorage.setItem(attendanceStorageKey, JSON.stringify(filtered));
      return filtered;
    });
  }, [hosts, attendanceStorageKey]);

  const handleToggleAttendance = useCallback(
    (hostId) => {
      if (!attendanceStorageKey || typeof window === "undefined") return;
      setAttendance((prev) => {
        const key = String(hostId);
        const next = { ...prev, [key]: !prev[key] };
        window.localStorage.setItem(attendanceStorageKey, JSON.stringify(next));
        return next;
      });
    },
    [attendanceStorageKey]
  );

  const handleStarSelection = (value) => {
    setReviewForm((prev) => ({ ...prev, starRating: value }));
  };

  const handleReviewSubmit = async (e) => {
    e.preventDefault();
    if (!eventId || !isTeamLeader) return;

    setReviewError("");
    setReviewSuccess("");
    setReviewSubmitting(true);
    try {
      const payload = {
        starRating: Number(reviewForm.starRating),
        content: reviewForm.content.trim(),
      };
      const { data } = await reviewAPI.submitTeamLeaderReview(eventId, payload);
      const reviewerName = sessionUser
        ? {
            fName: sessionUser.fName ?? "",
            lName: sessionUser.lName ?? "",
          }
        : undefined;
      setReview({
        ...data.review,
        reviewer: reviewerName,
      });
      setReviewForm({ starRating: 5, content: "" });
      setHoveredStar(0);
      setReviewSuccess("Review submitted successfully.");
    } catch (err) {
      const message = err.response?.data?.message || "Failed to submit review.";
      setReviewError(message);
    } finally {
      setReviewSubmitting(false);
    }
  };

  const renderStaticStars = (value, size = 20) => (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          size={size}
          className={star <= value ? "text-yellow-400" : "text-gray-300"}
          fill={star <= value ? "currentColor" : "none"}
        />
      ))}
    </div>
  );

  const tabs = useMemo(
    () => [
      { id: "hosts", label: "Team Members", count: hosts.length },
      { id: "details", label: "Event Details", count: null },
    ],
    [hosts.length]
  );
  const eventDetails = useMemo(() => getEventDetails(eventData), [eventData]);
  const targetHostCount = eventData?.nbOfHosts ?? hosts.length ?? 0;
  const confirmedHostCount =
    typeof eventData?.acceptedHostsCount === "number"
      ? eventData.acceptedHostsCount
      : hosts.length;
  const openSlots = Math.max((targetHostCount || 0) - confirmedHostCount, 0);

  if (loading) {
    return (
      <main className="bg-pearl min-h-screen flex items-center justify-center">
        <p className="text-gray-600">Loading event overview...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="bg-pearl min-h-screen flex items-center justify-center">
        <div className="bg-white rounded-3xl shadow-lg p-8 text-center border border-gray-100 max-w-md">
          <p className="text-gray-700 font-semibold mb-2">Unable to load event</p>
          <p className="text-sm text-gray-500">{error}</p>
        </div>
      </main>
    );
  }

  if (!eventData) {
    return null;
  }

  const formattedDate = formatDate(eventData.startsAt);
  const formattedTime = formatTimeRange(eventData.startsAt, eventData.endsAt);
  const reviewVisibilityLabel = review?.visibility
    ? `Visibility: ${review.visibility.charAt(0).toUpperCase()}${review.visibility.slice(1)}`
    : null;

  return (
    <main className="bg-pearl min-h-screen">
      <Navbar />

      <div className="pt-24 space-y-6">
        <section className="px-4">
          <div className="max-w-6xl mx-auto bg-white rounded-[3rem] p-8 md:p-10 shadow-xl border border-gray-100">
            <div className="flex flex-col lg:flex-row gap-8">
              <div className="flex-1 space-y-4">
                <div className="flex items-center gap-3">
                  {eventData.type && (
                    <span className="px-3 py-1 rounded-full bg-sky text-ocean text-xs font-semibold uppercase">
                      {eventData.type}
                    </span>
                  )}
                  <span className="px-3 py-1 rounded-full bg-mint/30 text-green-700 text-xs font-semibold">
                    Team Leader View
                  </span>
                </div>

                <h1 className="text-3xl md:text-4xl font-bold text-gray-900">
                  {eventData.title}
                </h1>

                <p className="text-gray-600">{eventData.description || "Event details will appear here."}</p>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4">
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Calendar size={18} className="text-ocean" />
                    <span>{formattedDate}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Clock size={18} className="text-ocean" />
                    <span>{formattedTime}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <MapPin size={18} className="text-ocean" />
                    <span>{eventData.location || "Location TBA"}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Users size={18} className="text-ocean" />
                    <span>
                      {confirmedHostCount}/{targetHostCount || "?"} hosts filled
                    </span>
                  </div>
                </div>
                {openSlots > 0 && (
                  <div className="px-4 py-3 rounded-2xl bg-rose/10 text-rose-600 border border-rose/20 text-sm font-semibold">
                    {openSlots} slot{openSlots > 1 ? "s" : ""} still need assignment
                  </div>
                )}
                <LocationMap
                  lat={eventData.locationLat}
                  lng={eventData.locationLng}
                  className="h-80"
                  zoom={16}
                  interactive
                  showControls
                  showOpenLink
                />
              </div>

              <div className="lg:w-80 bg-cream rounded-2xl p-6 border border-gray-100">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 rounded-xl bg-sky flex items-center justify-center">
                    <Building2 size={24} className="text-ocean" />
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">Client</p>
                    <p className="font-bold text-gray-900">{client?.name || "Undisclosed"}</p>
                  </div>
                </div>
                {client ? (
                  <div className="space-y-2 text-sm">
                    <p className="text-gray-600">
                      <span className="font-medium text-gray-700">Email:</span> {client.email || "—"}
                    </p>
                    <p className="text-gray-600">
                      <span className="font-medium text-gray-700">Phone:</span> {client.phone || "—"}
                    </p>
                    <p className="text-gray-600">
                      <span className="font-medium text-gray-700">Address:</span> {client.address || "—"}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">Client details will appear here once assigned.</p>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="px-4">
          <div className="max-w-6xl mx-auto bg-white rounded-3xl shadow p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-ocean font-semibold">
                Management panel
              </p>
              <h3 className="text-lg font-semibold text-gray-900">
                Coordinate hosts and review event data
              </h3>
            </div>
            <div className="flex flex-wrap gap-2">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition ${
                    activeTab === tab.id
                      ? "bg-ocean text-white"
                      : "bg-cream text-gray-700 hover:bg-mist"
                  }`}
                >
                  {tab.label}
                  {typeof tab.count === "number" && (
                    <span className="ml-2 px-2 py-0.5 rounded-full bg-white/20">
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="px-4">
          <div className="max-w-6xl mx-auto">
            <div className="bg-white rounded-3xl shadow border border-gray-100 p-6">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-ocean font-semibold">
                    Event review
                  </p>
                  <h3 className="text-lg font-semibold text-gray-900">
                    Team leader recap
                  </h3>
                  <p className="text-sm text-gray-500">
                    Share how things went once the event wraps up.
                  </p>
                </div>
                {reviewVisibilityLabel && (
                  <span className="px-4 py-2 rounded-full bg-cream text-gray-700 text-xs font-semibold uppercase">
                    {reviewVisibilityLabel}
                  </span>
                )}
              </div>

              <div className="mt-6 space-y-4">
                {reviewLoading ? (
                  <p className="text-sm text-gray-500">Loading review details...</p>
                ) : !eventEnded ? (
                  <div className="px-4 py-3 rounded-2xl bg-cream text-gray-600">
                    Reviews unlock after the event ends.
                  </div>
                ) : review ? (
                  <div className="bg-cream/60 rounded-2xl p-6 border border-gray-100">
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div className="flex items-center gap-3">
                        {renderStaticStars(review.starRating, 26)}
                        <span className="text-xl font-semibold text-gray-900">
                          {review.starRating}/5
                        </span>
                      </div>
                      <p className="text-sm text-gray-500">
                        Submitted {formatDateTime(review.createdAt)}
                      </p>
                    </div>
                    {review.reviewer && (
                      <p className="mt-2 text-sm text-gray-500">
                        By {[review.reviewer.fName, review.reviewer.lName].filter(Boolean).join(" ") || "Team Leader"}
                      </p>
                    )}
                    <p className="mt-4 text-gray-700 whitespace-pre-line leading-relaxed">
                      {review.content?.trim() || "No written comments provided."}
                    </p>
                    {reviewVisibilityLabel && (
                      <div className="mt-4 text-xs uppercase tracking-wide text-gray-500">
                        {reviewVisibilityLabel}
                      </div>
                    )}
                  </div>
                ) : isTeamLeader ? (
                  <form onSubmit={handleReviewSubmit} className="space-y-5">
                    <div className="bg-cream rounded-2xl p-6 text-center">
                      <p className="text-sm font-semibold text-gray-700 mb-3">
                        Overall experience
                      </p>
                      <div className="flex justify-center gap-2 mb-2">
                        {[1, 2, 3, 4, 5].map((value) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => handleStarSelection(value)}
                            onMouseEnter={() => setHoveredStar(value)}
                            onMouseLeave={() => setHoveredStar(0)}
                            className="p-1 transition-transform hover:scale-110"
                          >
                            <Star
                              size={34}
                              className={
                                value <= (hoveredStar || reviewForm.starRating)
                                  ? "text-yellow-400"
                                  : "text-gray-300"
                              }
                              fill={
                                value <= (hoveredStar || reviewForm.starRating)
                                  ? "currentColor"
                                  : "none"
                              }
                            />
                          </button>
                        ))}
                      </div>
                      <p className="text-base font-semibold text-gray-900">
                        {REVIEW_STAR_LABELS[hoveredStar || reviewForm.starRating] ||
                          "Select a rating"}
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        Quick recap (optional)
                      </label>
                      <textarea
                        rows={4}
                        value={reviewForm.content}
                        onChange={(e) =>
                          setReviewForm((prev) => ({ ...prev, content: e.target.value }))
                        }
                        placeholder="Highlight successes, risks, and anything the admin team should know..."
                        className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ocean/40 focus:border-ocean resize-none"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={reviewSubmitting || reviewForm.starRating < 1}
                      className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-ocean text-white font-semibold hover:bg-ocean/80 transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {reviewSubmitting ? "Submitting..." : "Submit review"}
                    </button>
                  </form>
                ) : (
                  <div className="px-4 py-3 rounded-2xl bg-cream text-gray-600">
                    Only the assigned team leader can submit a review for this event.
                  </div>
                )}

                {reviewError && (
                  <p className="text-sm text-rose-600 bg-rose/10 border border-rose/20 rounded-xl px-4 py-3">
                    {reviewError}
                  </p>
                )}
                {reviewSuccess && (
                  <p className="text-sm text-green-700 bg-mint/30 border border-mint/40 rounded-xl px-4 py-3">
                    {reviewSuccess}
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="px-4">
          <div className="max-w-6xl mx-auto space-y-4">
            <div className="bg-white rounded-3xl shadow p-6 border border-gray-100">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-ocean font-semibold">
                    Logistics
                  </p>
                  <h3 className="text-lg font-semibold text-gray-900">Transportation</h3>
                  <p className="text-sm text-gray-500">
                    Coordinate pickup details and monitor seat usage.
                  </p>
                </div>
                <span
                  className={`px-4 py-2 rounded-full text-sm font-semibold ${
                    hasTransportation ? "bg-mint/30 text-green-700" : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {hasTransportation ? "Arranged" : "Not arranged"}
                </span>
              </div>
              {hasTransportation ? (
                <>
                  <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                    <div className="bg-cream rounded-2xl px-4 py-3 border border-gray-100">
                      <p className="text-xs uppercase tracking-wide text-gray-500">Worst case</p>
                      <p className="text-lg font-semibold text-gray-900">
                        {transportation?.worstCaseSeats ?? eventData?.nbOfHosts ?? 0} seats
                      </p>
                    </div>
                    <div className="bg-cream rounded-2xl px-4 py-3 border border-gray-100">
                      <p className="text-xs uppercase tracking-wide text-gray-500">Requested</p>
                      <p className="text-lg font-semibold text-gray-900">
                        {transportation?.actualNeededSeats ?? 0} seats
                      </p>
                    </div>
                  </div>
                  {transportUsage !== null && (
                    <p className="text-xs text-gray-500 mt-2">
                      Utilization: <span className="font-semibold text-gray-800">{transportUsage}%</span>
                    </p>
                  )}
                  {transportation?.downgradeSuggested && (
                    <div className="mt-3 flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                      <AlertTriangle size={14} />
                      <span>Demand is low. Consider scaling down transportation.</span>
                    </div>
                  )}
                </>
              ) : (
                <div className="mt-4 rounded-2xl border border-dashed border-gray-200 bg-cream/40 px-4 py-3 text-sm text-gray-600">
                  Transportation has not been arranged for this event. Coordinate host arrivals individually.
                </div>
              )}
            </div>

            {hasTransportation && (
              transportTrips.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {transportTrips.map((trip) => (
                    <article
                      key={trip.transportationId}
                      className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
                            Pickup Location
                          </p>
                          <p className="text-base font-bold text-gray-900">{trip.pickupLocation}</p>
                        </div>
                        <div className="px-3 py-1 rounded-full bg-cream text-gray-700 text-xs font-semibold">
                          ${Number(trip.payment ?? 0).toFixed(2)}
                        </div>
                      </div>
                      <div className="space-y-1 text-sm text-gray-600">
                        <div className="flex items-center gap-2">
                          <Clock size={16} className="text-ocean" />
                          <span>Departure: {formatDateTime(trip.departureTime)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Clock size={16} className="text-ocean" />
                          <span>
                            Return: {trip.returnTime ? formatDateTime(trip.returnTime) : "TBA"}
                          </span>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-gray-100 p-6 text-sm text-gray-500">
                  Transportation details will appear here once the coordinator adds the pickup schedule.
                </div>
              )
            )}
          </div>
        </section>

        <section className="px-4 pb-16">
          <div className="max-w-6xl mx-auto">
            {activeTab === "hosts" && (
              <AcceptedHosts
                hosts={hosts}
                attendance={attendance}
                onToggleAttendance={handleToggleAttendance}
                targetCount={targetHostCount}
                confirmedCount={confirmedHostCount}
                openSlots={openSlots}
              />
            )}

            {activeTab === "details" &&
              (eventDetails ? (
                <div className="bg-white rounded-3xl shadow-lg border border-gray-100 p-8">
                  <h3 className="text-xl font-semibold text-gray-900 mb-6">Additional Event Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-cream rounded-2xl p-4">
                      <p className="text-sm font-semibold text-gray-700 mb-2">Number of Guests</p>
                      <p className="text-lg text-gray-900">{eventDetails.guests}</p>
                    </div>
                    <div className="bg-cream rounded-2xl p-4">
                      <p className="text-sm font-semibold text-gray-700 mb-2">Clothing Required</p>
                      <p className="text-lg text-gray-900">{eventDetails.clothing}</p>
                    </div>
                    <div className="bg-cream rounded-2xl p-4">
                      <p className="text-sm font-semibold text-gray-700 mb-2">Transportation</p>
                      <p className="text-lg text-gray-900">{eventDetails.transportation}</p>
                    </div>
                    <div className="bg-cream rounded-2xl p-4">
                      <p className="text-sm font-semibold text-gray-700 mb-2">Event Type</p>
                      <p className="text-lg text-gray-900">{eventDetails.type}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-3xl shadow-lg border border-gray-100 p-8 text-center text-gray-600">
                  <p className="font-semibold text-gray-900 mb-2">Event details unavailable</p>
                  <p className="text-sm">Additional information will appear here once loaded.</p>
                </div>
              ))}
          </div>
        </section>
      </div>

      <Footer />
    </main>
  );
}
