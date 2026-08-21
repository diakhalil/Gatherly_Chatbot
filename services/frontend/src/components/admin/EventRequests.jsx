import React, { useEffect, useMemo, useState } from "react";
import {
  CheckCircle,
  XCircle,
  Calendar,
  MapPin,
  Users,
  Clock,
  Eye,
  Mail,
  Phone,
  User,
  X,
  AlertTriangle,
  Bus,
} from "lucide-react";
import api, { adminAPI, reviewAPI } from "../../services/api";
import useBodyScrollLock from "../../hooks/useBodyScrollLock";
import LocationMap from "../LocationMap";

const CLIENT_FIELDS = ["clientFirstName", "clientLastName", "clientEmail", "clientPhone"];

const formatDate = (value) => {
  if (!value) return "TBA";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const formatDateTime = (value) => {
  if (!value) return "TBA";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const toInputDateTime = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (num) => String(num).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
};

const toIsoString = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

const toTitleCase = (value = "") =>
  value
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "General";

const formatEmailNotificationStatus = (status) => {
  if (status === "sent") return "Email notification sent.";
  if (status === "mail_not_configured") return "Email notification not sent: Gmail is not configured.";
  if (status === "missing_recipient") return "Email notification not sent: client email is missing.";
  if (status === "failed") return "Email notification failed. Check the backend console.";
  return "";
};

const normalizeRequest = (request) => {
  const clientName = [request.clientFirstName, request.clientLastName]
    .filter(Boolean)
    .join(" ")
    .trim();

  const teamLeaderName = [request.teamLeaderFirstName, request.teamLeaderLastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  const adminName = [request.adminFirstName, request.adminLastName].filter(Boolean).join(" ").trim();

  return {
    id: request.eventId,
    title: request.title || "Untitled Event",
    type: request.type || "Event",
    category: toTitleCase(request.type),
    clientName: clientName || "Client details pending",
    clientEmail: request.clientEmail || "Not provided",
    clientPhone: request.clientPhone || "Not provided",
    clientAddress: request.clientAddress || "",
    date: formatDate(request.startsAt),
    startDateTime: formatDateTime(request.startsAt),
    endDateTime: formatDateTime(request.endsAt),
    location: request.location || "Location TBA",
    locationLat: request.locationLat,
    locationLng: request.locationLng,
    locationPlaceName: request.locationPlaceName,
    displayLocation: request.locationPlaceName || request.location || "Location TBA",
    nbOfHosts: request.nbOfHosts || 0,
    description: request.description || "No description provided.",
    status: toTitleCase(request.status || "pending"),
    submittedDate: formatDate(request.createdAt),
    hostCoverage: {
      accepted: Number(request.acceptedHostsCount || 0),
      required: Number(request.nbOfHosts || 0),
    },
    outfit: request.clothingLabel
      ? {
          label: request.clothingLabel,
          picture: request.clothingPicture,
          description: request.clothingDescription,
          stockInfo: request.clothingStockInfo || null,
        }
      : null,
    transportation: request.transportationSummary || null,
    teamLeader: request.teamLeaderId
      ? {
          id: request.teamLeaderId,
          name: teamLeaderName || "Team leader TBD",
          email: request.teamLeaderEmail || "",
          phone: request.teamLeaderPhone || "",
        }
      : null,
    adminOwner: request.adminId
      ? {
          id: request.adminId,
          name: adminName || "Admin",
          email: request.adminEmail || "",
        }
      : null,
    floorPlan: request.floorPlan || null,
    attendeesList: request.attendeesList || null,
  };
};

const needsClientHydration = (request = {}) =>
  request.clientId && CLIENT_FIELDS.some((field) => !request[field]);

const hydrateRequests = async (rawRequests) => {
  const normalized = rawRequests.map(normalizeRequest);
  const clientIds = Array.from(
    new Set(rawRequests.filter(needsClientHydration).map((req) => req.clientId))
  );

  if (!clientIds.length) {
    return normalized;
  }

  const clientResults = await Promise.allSettled(
    clientIds.map((clientId) => api.get(`/clients/${clientId}`))
  );

  const clientMap = new Map();
  clientResults.forEach((result, index) => {
    if (result.status === "fulfilled" && result.value?.data) {
      clientMap.set(clientIds[index], result.value.data);
    }
  });

  if (!clientMap.size) {
    return normalized;
  }

  return normalized.map((request, index) => {
    const raw = rawRequests[index];
    const client = clientMap.get(raw.clientId);

    if (!client) return request;

    const hydratedName = [client.fName, client.lName].filter(Boolean).join(" ").trim();

    return {
      ...request,
      clientName: hydratedName || request.clientName,
      clientEmail: client.email || request.clientEmail,
      clientPhone: client.phoneNb || request.clientPhone,
    };
  });
};

export default function EventRequests() {
  const [activeFilter, setActiveFilter] = useState("all");
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [detailModal, setDetailModal] = useState(null);
  const [eventApplications, setEventApplications] = useState([]);
  const [applicationsLoading, setApplicationsLoading] = useState(false);
  const [conflictModal, setConflictModal] = useState(null);
  const [transportModal, setTransportModal] = useState(null);
  const [transportSaving, setTransportSaving] = useState(false);
  const [transportError, setTransportError] = useState("");
  const [detailReviews, setDetailReviews] = useState([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [reviewUpdating, setReviewUpdating] = useState(null);
  const [actionStatus, setActionStatus] = useState(null);
  useBodyScrollLock(Boolean(detailModal || transportModal || conflictModal));



  useEffect(() => {
    let cancelled = false;
    const fetchRequests = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = activeFilter === "all" ? {} : { status: activeFilter };
        const { data } = await api.get("/admins/event-requests", { params });
        if (!cancelled) {
          const hydrated = await hydrateRequests(data);
          const resolved = hydrated.map((req) => {
            const next = { ...req };
            if (req?.outfit?.picture) {
              next.outfit = { ...req.outfit, picture: resolvePicture(req.outfit.picture) };
            }
            if (req.floorPlan) {
              next.floorPlan = resolvePicture(req.floorPlan);
            }
            return next;
          });
          setRequests(resolved);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.message || "Failed to load event requests");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchRequests();
    return () => {
      cancelled = true;
    };
  }, [activeFilter]);

  const statusFilters = ["all", "pending", "accepted", "rejected"];

  const resolvePicture = (picture) => {
    const origin = (api.defaults.baseURL || "").replace(/\/api$/, "");
    if (!picture) return picture;
    if (picture.startsWith("http")) return picture;
    if (picture.startsWith("/")) return `${origin}${picture}`;
    return `${origin}/${picture}`;
  };

  const filteredRequests = requests; // No client-side filtering needed since API does it

  const closeDetailModal = () => {
    setDetailModal(null);
    setEventApplications([]);
    setDetailReviews([]);
    setReviewError("");
  };

  const hostCoverage = detailModal?.hostCoverage;
  const hostCoveragePct =
    hostCoverage && hostCoverage.required > 0
      ? Math.min(
          100,
          Math.round(
            (hostCoverage.accepted / Math.max(hostCoverage.required, 1)) * 100
          )
        )
      : null;

  const detailTransportUsage =
    detailModal?.transportation?.worstCaseSeats > 0
      ? Math.round(
          (detailModal.transportation.actualNeededSeats /
            Math.max(detailModal.transportation.worstCaseSeats, 1)) * 100
        )
      : null;

  const updateRequestStatus = (requestId, newStatus) => {
    setRequests((prev) =>
      prev.map((req) => (req.id === requestId ? { ...req, status: newStatus } : req))
    );
  };

  const handleApprove = async (requestId) => {
    try {
      const response = await api.put(`/events/${requestId}`, { status: "accepted" });
      updateRequestStatus(requestId, "Accepted");
      const emailStatus = formatEmailNotificationStatus(response?.data?.emailNotification);
      setActionStatus({
        type: "success",
        text: ["Event approved successfully.", emailStatus].filter(Boolean).join("\n"),
      });
    } catch (err) {
      setActionStatus({
        type: "error",
        text: err.response?.data?.message || "Failed to approve event.",
      });
    }
  };

  const handleReject = async (requestId) => {
    try {
      await api.put(`/events/${requestId}`, { status: "rejected" });
      updateRequestStatus(requestId, "Rejected");
      setActionStatus({ type: "success", text: "Event rejected." });
    } catch (err) {
      setActionStatus({
        type: "error",
        text: err.response?.data?.message || "Failed to reject event.",
      });
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case "pending":
        return "text-yellow-600 bg-yellow-50 border-yellow-200";
      case "Accepted":
        return "text-green-600 bg-green-50 border-green-200";
      case "rejected":
        return "text-red-600 bg-red-50 border-red-200";
      default:
        return "text-gray-600 bg-gray-50 border-gray-200";
    }
  };

  const openDetailModal = async (request) => {
    setDetailModal(request);
    setApplicationsLoading(true);
    setReviewsLoading(true);
    setReviewError("");
    try {
      const [appsResult, reviewsResult] = await Promise.allSettled([
        api.get(`/applications/event/${request.id}`),
        reviewAPI.getEventReviews(request.id),
      ]);

      if (appsResult.status === "fulfilled") {
        setEventApplications(appsResult.value.data || []);
      } else {
        console.error("Failed to fetch applications:", appsResult.reason);
        setEventApplications([]);
      }

      if (reviewsResult.status === "fulfilled") {
        setDetailReviews(reviewsResult.value.data?.reviews || []);
      } else {
        console.error("Failed to fetch reviews:", reviewsResult.reason);
        setDetailReviews([]);
        setReviewError(
          reviewsResult.reason?.response?.data?.message || "Failed to load reviews."
        );
      }
    } finally {
      setApplicationsLoading(false);
      setReviewsLoading(false);
    }
  };

  const handleAcceptApplication = async (applicationId, requestedRole) => {
    try {
      await api.put(`/applications/${applicationId}`, {
        status: "accepted",
        assignedRole: requestedRole,
      });
      // Update local state
      setEventApplications(prev =>
        prev.map(app =>
          app.eventAppId === applicationId
            ? { ...app, status: "accepted", assignedRole: requestedRole }
            : app
        )
      );
      setActionStatus({ type: "success", text: "Application accepted." });
    } catch (err) {
      // Check for scheduling conflict (409)
      if (err.response?.status === 409) {
        // Show scheduling conflict modal instead of alert
        const message = err.response.data?.message || "Cannot accept application due to scheduling conflict";
        const conflicts = err.response.data?.conflicts || "Scheduling conflict detected";

        setConflictModal({
          message,
          conflicts: typeof conflicts === 'string' ? conflicts : JSON.stringify(conflicts),
          applicationId,
          requestedRole
        });
        return;
      }

      setActionStatus({
        type: "error",
        text: err.response?.data?.message || "Failed to accept application.",
      });
    }
  };

  const handleRejectApplication = async (applicationId) => {
    try {
      await api.put(`/applications/${applicationId}`, { status: "rejected" });
      // Update local state
      setEventApplications(prev =>
        prev.map(app =>
          app.eventAppId === applicationId
            ? { ...app, status: "rejected" }
            : app
        )
      );
      setActionStatus({ type: "success", text: "Application rejected." });
    } catch (err) {
      setActionStatus({
        type: "error",
        text: err.response?.data?.message || "Failed to reject application.",
      });
    }
  };

  const openTransportModal = (request) => {
    const existingTrip = request.transportation?.trips?.[0] || null;
    setTransportModal({
      eventId: request.id,
      title: request.title,
      pickupLocation: existingTrip?.pickupLocation || "",
      departureTime: toInputDateTime(existingTrip?.departureTime || ""),
      returnTime: toInputDateTime(existingTrip?.returnTime || ""),
      payment: existingTrip?.payment ?? "",
    });
    setTransportError("");
  };

  const closeTransportModal = () => {
    setTransportModal(null);
    setTransportError("");
  };

  const handleTransportFieldChange = (field, value) => {
    setTransportModal((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const handleTransportationSubmit = async (e) => {
    e.preventDefault();
    if (!transportModal) return;
    if (!transportModal.pickupLocation.trim() || !transportModal.departureTime) {
      setTransportError("Pickup location and departure time are required.");
      return;
    }
    if (
      transportModal.returnTime &&
      new Date(transportModal.returnTime) < new Date(transportModal.departureTime)
    ) {
      setTransportError("Return time must be after departure.");
      return;
    }
    const normalizedPayment = Number(transportModal.payment ?? 0);
    if (Number.isNaN(normalizedPayment) || normalizedPayment < 0) {
      setTransportError("Payment must be a positive number or zero.");
      return;
    }

    setTransportSaving(true);
    setTransportError("");
    try {
      const payload = {
        pickupLocation: transportModal.pickupLocation.trim(),
        departureTime: toIsoString(transportModal.departureTime),
        returnTime: toIsoString(transportModal.returnTime),
        payment: normalizedPayment,
      };
      await adminAPI.saveTransportation(transportModal.eventId, payload);
      const { data } = await api.get(`/transportation/${transportModal.eventId}`);
      setRequests((prev) =>
        prev.map((req) =>
          req.id === transportModal.eventId ? { ...req, transportation: data } : req
        )
      );
      setDetailModal((prev) =>
        prev && prev.id === transportModal.eventId ? { ...prev, transportation: data } : prev
      );
      closeTransportModal();
    } catch (err) {
      setTransportError(err.response?.data?.message || "Failed to save transportation.");
    } finally {
      setTransportSaving(false);
    }
  };

  const handleReviewVisibilityChange = async (reviewerId, visibility) => {
    if (!detailModal) return;
    setReviewUpdating(reviewerId);
    try {
      await reviewAPI.updateReviewVisibility(detailModal.id, reviewerId, visibility);
      setDetailReviews((prev) =>
        prev.map((review) =>
          review.reviewerId === reviewerId ? { ...review, visibility } : review
        )
      );
      setActionStatus({ type: "success", text: "Review visibility updated." });
    } catch (err) {
      setActionStatus({
        type: "error",
        text: err.response?.data?.message || "Failed to update review visibility.",
      });
    } finally {
      setReviewUpdating(null);
    }
  };

  return (
    <div className="space-y-8">
      {/* Filter Section */}
      <section className="px-4">
        <div className="max-w-6xl mx-auto bg-white rounded-3xl shadow p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-ocean font-semibold">
              Filter events
            </p>
            <h3 className="text-lg font-semibold text-gray-900">
              Browse by status
            </h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {statusFilters.map((filter) => (
              <button
                key={filter}
                onClick={() => setActiveFilter(filter)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition ${
                  activeFilter === filter
                    ? "bg-ocean text-white"
                    : "bg-cream text-gray-700 hover:bg-mist"
                }`}
              >
                {filter === "all" ? "All Events" : filter.charAt(0).toUpperCase() + filter.slice(1)}
              </button>
            ))}

          </div>
        </div>
        {actionStatus?.text && (
          <div
            className={`max-w-6xl mx-auto mt-4 rounded-2xl border px-4 py-3 text-sm whitespace-pre-line ${
              actionStatus.type === "error"
                ? "border-rose/30 bg-rose/10 text-rose-700"
                : "border-mint/40 bg-mint/10 text-emerald-700"
            }`}
          >
            {actionStatus.text}
          </div>
        )}
      </section>

      <section className="px-4 pb-16">
        <div className="max-w-6xl mx-auto">
          {loading ? (
            <div className="bg-white rounded-3xl border border-gray-100 p-12 text-center text-gray-500">
              Loading event requests...
            </div>
          ) : error ? (
            <div className="bg-white rounded-3xl border border-red-100 p-12 text-center text-red-600">
              {error}
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="bg-white rounded-3xl border border-dashed border-gray-200 p-12 text-center text-gray-500">
              No event requests match this filter.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {filteredRequests.map((request) => {
                const isPending = request.status === "Pending";
                const transport = request.transportation;
                const showTransport = Boolean(transport?.available);
                const usagePercent =
                  transport?.worstCaseSeats > 0
                    ? Math.round(
                        (transport.actualNeededSeats / Math.max(transport.worstCaseSeats, 1)) * 100
                      )
                    : null;
                return (
                  <article
                    key={request.id}
                    className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-lg transition p-6 space-y-5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-ocean font-semibold mb-2">
                          <Calendar size={14} />
                          <span>{request.category}</span>
                        </div>
                        <h3 className="text-xl font-bold text-gray-900">{request.title}</h3>
                        <p className="text-sm text-gray-500 mt-1">Requested on {request.submittedDate}</p>
                      </div>
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-semibold border ${getStatusColor(
                          request.status
                        )}`}
                      >
                        {request.status}
                      </span>
                    </div>

                    <div className="bg-cream rounded-2xl p-4 space-y-3">
                      <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                        <User size={16} className="text-ocean" />
                        <span>Client</span>
                      </div>
                      <p className="text-base font-semibold text-gray-900">{request.clientName}</p>
                      <div className="flex flex-col gap-2 text-sm text-gray-600">
                        <div className="flex items-center gap-2">
                          <Mail size={16} className="text-ocean" />
                          <span>{request.clientEmail}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Phone size={16} className="text-ocean" />
                          <span>{request.clientPhone}</span>
                        </div>
                      </div>
                    </div>

                    {request.outfit && (
                      <div className="rounded-2xl border border-gray-100 p-4 flex gap-3 items-center">
                        {request.outfit.picture && (
                          <div className="h-16 w-16 rounded-xl overflow-hidden bg-cream flex-shrink-0">
                            <img
                              src={request.outfit.picture}
                              alt={request.outfit.label}
                              className="h-full w-full object-cover"
                            />
                          </div>
                        )}
                        <div className="space-y-1">
                          <p className="text-xs uppercase tracking-wide text-ocean font-semibold">
                            Outfit requested
                          </p>
                          <p className="text-sm font-semibold text-gray-900">
                            {request.outfit.label}
                          </p>
                          {request.outfit.description && (
                            <p className="text-xs text-gray-600 line-clamp-2">
                              {request.outfit.description}
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm text-gray-600">
                      <div className="flex items-center gap-2">
                        <Calendar size={16} className="text-ocean" />
                        <span>{request.date}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <MapPin size={16} className="text-ocean" />
                        <span>{request.displayLocation}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock size={16} className="text-ocean" />
                        <span>Starts: {request.startDateTime || "TBA"}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock size={16} className="text-ocean" />
                        <span>Ends: {request.endDateTime || "TBA"}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Users size={16} className="text-ocean" />
                        <span>{request.nbOfHosts} hosts</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock size={16} className="text-ocean" />
                        <span>Type: {request.type}</span>
                      </div>
                    </div>

                    <p className="text-sm text-gray-600 leading-relaxed">{request.description}</p>

                    {isPending && (
                      <button
                        type="button"
                        onClick={() => openTransportModal(request)}
                        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-dashed border-ocean/40 text-ocean text-sm font-semibold hover:bg-sky/10 transition"
                      >
                        <Bus size={16} />
                        {transport?.available ? "Edit transportation details" : "Set transportation (optional)"}
                      </button>
                    )}

                    {showTransport && (
                      <div className="rounded-2xl border border-gray-100 p-4 bg-cream/40 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                            <Bus size={16} className="text-ocean" />
                            <span>
                              Transportation {transport.available ? "arranged" : "not arranged"}
                            </span>
                          </div>
                          {usagePercent !== null && (
                            <span className="text-xs font-semibold px-2 py-1 rounded-full bg-white border border-gray-200 text-gray-600">
                              {usagePercent}% utilization
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-4 text-xs text-gray-600">
                          <span>Worst case: {transport.worstCaseSeats}</span>
                          <span>Seats needed: {transport.actualNeededSeats}</span>
                        </div>
                        {transport.downgradeSuggested && (
                          <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                            <AlertTriangle size={14} />
                            <span>Demand is low. Consider downgrading transportation.</span>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => openDetailModal(request)}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full border border-gray-200 text-gray-700 font-semibold hover:border-ocean hover:text-ocean transition"
                      >
                        <Eye size={18} />
                        View Details
                      </button>
                      <div className="flex flex-1 gap-3">
                        <button
                          type="button"
                          disabled={!isPending}
                          onClick={() => handleReject(request.id)}
                          className={`flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full font-semibold transition ${
                            isPending
                              ? "text-red-600 border border-red-200 hover:bg-red-50"
                              : "text-gray-400 border border-gray-100 bg-gray-50 cursor-not-allowed"
                          }`}
                        >
                          <XCircle size={18} />
                          Reject
                        </button>
                        <button
                          type="button"
                          disabled={!isPending}
                          onClick={() => handleApprove(request.id)}
                          className={`flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full font-semibold transition ${
                            isPending
                              ? "text-white bg-ocean hover:bg-ocean/90"
                              : "text-gray-400 bg-gray-100 cursor-not-allowed"
                          }`}
                        >
                          <CheckCircle size={18} />
                          Approve
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {detailModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-4xl w-full max-h-[90vh] relative flex flex-col">
            {/* Fixed Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-2xl bg-cream flex items-center justify-center text-ocean">
                  <Calendar size={24} />
                </div>
                <div>
                  <p className="text-sm uppercase tracking-[0.25em] text-ocean font-semibold">
                    {detailModal.category}
                  </p>
                  <h3 className="text-lg font-bold text-gray-900">{detailModal.title}</h3>
                </div>
              </div>
              <button
                type="button"
                onClick={closeDetailModal}
                className="text-gray-400 hover:text-gray-600 p-2 hover:bg-gray-100 rounded-full transition"
              >
                <X size={24} />
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Event Info Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 rounded-2xl border border-gray-100 p-4 space-y-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                    <MapPin size={16} className="text-ocean" />
                    <span>Location</span>
                  </div>
                  <div>
                    <p className="text-base font-semibold text-gray-900">
                      {detailModal.displayLocation}
                    </p>
                    {detailModal.location && detailModal.location !== detailModal.displayLocation && (
                      <p className="text-sm text-gray-600">{detailModal.location}</p>
                    )}
                  </div>
                  <LocationMap
                    lat={detailModal.locationLat}
                    lng={detailModal.locationLng}
                    className="h-80"
                    zoom={16}
                    interactive
                    showControls
                    showOpenLink
                  />
                  {!detailModal.locationLat || !detailModal.locationLng ? (
                    <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                      This event has no saved map coordinates yet. The text location is still available above.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-gray-600">
                      <div className="rounded-xl bg-cream px-3 py-2">
                        <span className="font-semibold text-gray-800">Latitude:</span> {detailModal.locationLat}
                      </div>
                      <div className="rounded-xl bg-cream px-3 py-2">
                        <span className="font-semibold text-gray-800">Longitude:</span> {detailModal.locationLng}
                      </div>
                    </div>
                  )}
                </div>
                <div className="rounded-2xl border border-gray-100 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                    <Clock size={16} className="text-ocean" />
                    <span>Schedule</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Users size={16} className="text-ocean" />
                    <span>{detailModal.nbOfHosts} hosts requested</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Clock size={16} className="text-ocean" />
                    <span>Starts: {detailModal.startDateTime || "TBA"}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Clock size={16} className="text-ocean" />
                    <span>Ends: {detailModal.endDateTime || "TBA"}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                    <User size={16} className="text-ocean" />
                    <span>Client</span>
                  </div>
                  <p className="text-base font-semibold text-gray-900">{detailModal.clientName}</p>
                  <div className="flex flex-col gap-2 text-sm text-gray-600">
                    <div className="flex items-center gap-2">
                      <Mail size={16} className="text-ocean" />
                      <span>{detailModal.clientEmail}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Phone size={16} className="text-ocean" />
                      <span>{detailModal.clientPhone}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <MapPin size={16} className="text-ocean" />
                      <span>{detailModal.clientAddress || "Address not provided"}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Event Description */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-2xl border border-gray-100 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                    <Users size={16} className="text-ocean" />
                    <span>Host coverage</span>
                  </div>
                  {hostCoverage ? (
                    <>
                      <p className="text-3xl font-bold text-gray-900">
                        {hostCoverage.accepted}/{hostCoverage.required}
                      </p>
                      <p className="text-sm text-gray-500">
                        {hostCoverage.required > 0
                          ? `${hostCoveragePct || 0}% of staffing confirmed`
                          : "No host requirement set"}
                      </p>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-ocean h-2 rounded-full transition-all"
                          style={{ width: `${hostCoveragePct || 0}%` }}
                        />
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-gray-500">No staffing data yet.</p>
                  )}
                </div>
                <div className="rounded-2xl border border-gray-100 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                    <User size={16} className="text-ocean" />
                    <span>Leadership</span>
                  </div>
                  {detailModal.teamLeader ? (
                    <div className="text-sm text-gray-700 space-y-1">
                      <p className="font-semibold">{detailModal.teamLeader.name}</p>
                      <p>{detailModal.teamLeader.email || "Email unavailable"}</p>
                      <p>{detailModal.teamLeader.phone || "Phone unavailable"}</p>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">Team leader not assigned yet.</p>
                  )}
                  {detailModal.adminOwner && (
                    <p className="text-xs text-gray-500">
                      Assigned admin: {detailModal.adminOwner.name || "Admin"} ({detailModal.adminOwner.email || "—"})
                    </p>
                  )}
                </div>
              </div>

              {/* Event Description */}
              <div className="rounded-2xl border border-gray-100 p-4 space-y-3">
                <p className="text-sm font-semibold text-gray-700">Event Brief</p>
                <p className="text-sm text-gray-600 leading-relaxed">{detailModal.description}</p>
                <p className="text-xs text-gray-500">Event Type: {detailModal.type}</p>
              </div>

              {detailModal.status === "Pending" && (
                <button
                  type="button"
                  onClick={() => openTransportModal(detailModal)}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-dashed border-ocean/40 text-ocean text-sm font-semibold hover:bg-sky/10 transition"
                >
                  <Bus size={16} />
                  {detailModal.transportation?.available
                    ? "Edit transportation details"
                    : "Set transportation (optional)"}
                </button>
              )}

              {detailModal.transportation?.available && (
                <div className="rounded-2xl border border-gray-100 p-4 space-y-3 bg-cream/40">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                      <Bus size={16} className="text-ocean" />
                      <span>Transportation summary</span>
                    </div>
                    {detailTransportUsage !== null && (
                      <span className="text-xs font-semibold px-2 py-1 rounded-full bg-white border border-gray-200 text-gray-600">
                        {detailTransportUsage}% utilization
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm text-gray-600">
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Worst case</p>
                      <p className="font-semibold text-gray-900">
                        {detailModal.transportation.worstCaseSeats} seats
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Needed</p>
                      <p className="font-semibold text-gray-900">
                        {detailModal.transportation.actualNeededSeats} seats
                      </p>
                    </div>
                  </div>
                  {detailModal.transportation.downgradeSuggested && (
                    <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                      <AlertTriangle size={14} />
                      <span>Demand is low. Consider downgrading transportation.</span>
                    </div>
                  )}
                  {detailModal.transportation.trips?.length > 0 && (
                    <div className="space-y-2 text-sm text-gray-600">
                      {detailModal.transportation.trips.map((trip) => (
                        <div
                          key={trip.transportationId}
                          className="rounded-xl border border-gray-100 bg-white px-3 py-2"
                        >
                          <p className="text-xs uppercase tracking-wide text-gray-500">
                            Pickup: {trip.pickupLocation}
                          </p>
                          <p>Departure: {formatDateTime(trip.departureTime)}</p>
                          <p>Return: {trip.returnTime ? formatDateTime(trip.returnTime) : "TBD"}</p>
                          <p>Payment: ${Number(trip.payment ?? 0).toFixed(2)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {detailModal.floorPlan && (
                <div className="rounded-2xl border border-gray-100 p-4 space-y-3">
                  <p className="text-sm font-semibold text-gray-700">Floor plan</p>
                  <div className="rounded-2xl overflow-hidden bg-cream border border-gray-100">
                    <img
                      src={resolvePicture(detailModal.floorPlan)}
                      alt="Event floor plan"
                      className="w-full h-64 object-cover"
                    />
                  </div>
                </div>
              )}

              {detailModal.outfit && (
                <div className="rounded-2xl border border-gray-100 p-4 flex gap-4 items-center">
                  {detailModal.outfit.picture && (
                    <div className="h-20 w-20 rounded-xl overflow-hidden bg-cream flex-shrink-0">
                      <img
                        src={detailModal.outfit.picture}
                        alt={detailModal.outfit.label}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  )}
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-wide text-ocean font-semibold">
                      Requested outfit
                    </p>
                    <p className="text-base font-semibold text-gray-900">
                      {detailModal.outfit.label}
                    </p>
                    {detailModal.outfit.description && (
                      <p className="text-sm text-gray-600">
                        {detailModal.outfit.description}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {detailModal.attendeesList && (
                <div className="rounded-2xl border border-gray-100 p-4 space-y-2">
                  <p className="text-sm font-semibold text-gray-700">Attendees list</p>
                  <pre className="text-sm text-gray-600 whitespace-pre-wrap bg-cream rounded-2xl p-4 border border-gray-100">
                    {detailModal.attendeesList}
                  </pre>
                </div>
              )}

              {/* Applications & reviews - only after approval */}
              {detailModal.status === "Accepted" && (
                <>
                  <div className="rounded-2xl border border-gray-100 p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-gray-700">Host Applications</p>
                      {applicationsLoading && (
                        <p className="text-xs text-gray-500">Loading applications...</p>
                      )}
                    </div>

                    {eventApplications.length === 0 ? (
                      <p className="text-sm text-gray-500 text-center py-8">
                        {applicationsLoading ? "Loading..." : "No applications yet"}
                      </p>
                    ) : (
                      <div className="space-y-3 max-h-96 overflow-y-auto">
                        {eventApplications.map((app) => {
                          const isPending = app.status === "pending";
                          const requestedDress = Boolean(
                            app.requestDress === true ||
                              app.requestDress === "true" ||
                              Number(app.requestDress) === 1
                          );
                          const needsRide = Boolean(
                            app.needsRide === true ||
                              app.needsRide === "true" ||
                              Number(app.needsRide) === 1
                          );
                          return (
                            <div key={app.eventAppId} className="border border-gray-200 rounded-lg p-4 space-y-3">
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <p className="text-sm font-semibold text-gray-900">
                                    {app.fName} {app.lName}
                                  </p>
                                  <p className="text-xs text-gray-600">
                                    Applied for: {app.requestedRole?.replace('_', ' ')}
                                  </p>
                                  {app.notes && (
                                    <p className="text-xs text-gray-600 italic mt-1">"{app.notes}"</p>
                                  )}
                                  {requestedDress ? (
                                    <span className="mt-2 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-cream text-ocean text-xs font-semibold">
                                      <span className="h-2 w-2 rounded-full bg-ocean"></span>
                                      Dress requested
                                    </span>
                                  ) : (
                                    <span className="mt-2 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 text-gray-600 text-xs font-semibold">
                                      No dress request
                                    </span>
                                  )}
                                  {needsRide ? (
                                    <span className="mt-2 ml-2 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-semibold">
                                      <span className="h-2 w-2 rounded-full bg-blue-500"></span>
                                      Needs transportation
                                    </span>
                                  ) : (
                                    <span className="mt-2 ml-2 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 text-gray-600 text-xs font-semibold">
                                      Self-arrival
                                    </span>
                                  )}
                                </div>
                                <span className={`px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap ml-3 ${
                                  app.status === 'accepted' ? 'bg-green-100 text-green-800' :
                                  app.status === 'rejected' ? 'bg-red-100 text-red-800' :
                                  'bg-yellow-100 text-yellow-800'
                                }`}>
                                  {app.status || 'pending'}
                                </span>
                              </div>

                              {isPending && (
                                <div className="flex gap-2 pt-2 border-t border-gray-100">
                                  <button
                                    onClick={() => handleRejectApplication(app.eventAppId)}
                                    className="flex-1 px-4 py-2 text-sm bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 transition font-medium"
                                  >
                                    Reject
                                  </button>
                                  <AcceptWithRoleButton
                                    application={app}
                                    onAccept={handleAcceptApplication}
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-gray-100 p-4 space-y-4">
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-sm font-semibold text-gray-700">Event Reviews</p>
                      {reviewsLoading && (
                        <p className="text-xs text-gray-500">Loading reviews...</p>
                      )}
                    </div>
                    {reviewError && (
                      <div className="rounded-2xl border border-red-100 bg-red-50 p-3 text-xs text-red-600">
                        {reviewError}
                      </div>
                    )}
                    {detailReviews.length === 0 ? (
                      <p className="text-sm text-gray-500 text-center py-4">
                        {reviewsLoading ? "Loading..." : "No reviews yet."}
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {detailReviews.map((review) => (
                          <div key={`${review.eventId}-${review.reviewerId}`} className="rounded-2xl border border-gray-100 p-4 space-y-3">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-gray-900">
                                  {[review.reviewer?.fName, review.reviewer?.lName].filter(Boolean).join(" ") ||
                                    `Reviewer #${review.reviewerId}`}
                                </p>
                                <p className="text-xs text-gray-500">{formatDateTime(review.createdAt)}</p>
                              </div>
                              <span className="text-sm font-semibold text-ocean">
                                ⭐ {review.starRating}/5
                              </span>
                            </div>
                            {review.content && (
                              <p className="text-sm text-gray-700 leading-relaxed">{review.content}</p>
                            )}
                            <div className="flex flex-col gap-2">
                              <label className="text-xs uppercase tracking-[0.2em] text-gray-500">
                                Visibility
                              </label>
                              <select
                                value={review.visibility}
                                onChange={(e) => handleReviewVisibilityChange(review.reviewerId, e.target.value)}
                                disabled={reviewUpdating === review.reviewerId}
                                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:ring-2 focus:ring-ocean/40"
                              >
                                <option value="public">Public</option>
                                <option value="private">Private</option>
                                <option value="hidden">Hidden</option>
                              </select>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Status message for non-accepted events */}
              {detailModal.status !== "Accepted" && (
                <div className="rounded-2xl border border-gray-100 p-4 space-y-4">
                  <div className="text-center py-8">
                    <div className="text-4xl mb-4">
                      {detailModal.status === "Pending" ? "⏳" : "❌"}
                    </div>
                    <p className="text-sm font-semibold text-gray-700 mb-2">
                      {detailModal.status === "Pending"
                        ? "Event is Pending Approval"
                        : "Event was Rejected"
                      }
                    </p>
                    <p className="text-sm text-gray-500">
                      {detailModal.status === "Pending"
                        ? "Host applications will be available once the event is approved."
                        : "Rejected events do not have host applications."
                      }
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {transportModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleTransportationSubmit}
            className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full p-6 space-y-6"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-ocean font-semibold">Transportation</p>
                <h3 className="text-xl font-semibold text-gray-900">
                  {transportModal.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeTransportModal}
                className="text-gray-400 hover:text-gray-600 p-2 hover:bg-gray-100 rounded-full transition"
              >
                <X size={20} />
              </button>
            </div>

            <div className="grid gap-4">
              <div className="space-y-1">
                <label className="text-sm font-semibold text-gray-700">Pickup Location *</label>
                <input
                  type="text"
                  value={transportModal.pickupLocation}
                  onChange={(e) => handleTransportFieldChange("pickupLocation", e.target.value)}
                  className="w-full rounded-2xl border border-gray-200 px-4 py-2.5 focus:ring-2 focus:ring-ocean/40 focus:outline-none"
                  placeholder="123 Main St, City"
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-semibold text-gray-700">Departure Time *</label>
                <input
                  type="datetime-local"
                  value={transportModal.departureTime}
                  onChange={(e) => handleTransportFieldChange("departureTime", e.target.value)}
                  className="w-full rounded-2xl border border-gray-200 px-4 py-2.5 focus:ring-2 focus:ring-ocean/40 focus:outline-none"
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-semibold text-gray-700">Return Time</label>
                <input
                  type="datetime-local"
                  value={transportModal.returnTime}
                  onChange={(e) => handleTransportFieldChange("returnTime", e.target.value)}
                  className="w-full rounded-2xl border border-gray-200 px-4 py-2.5 focus:ring-2 focus:ring-ocean/40 focus:outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-semibold text-gray-700">Payment (USD)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={transportModal.payment}
                  onChange={(e) => handleTransportFieldChange("payment", e.target.value)}
                  className="w-full rounded-2xl border border-gray-200 px-4 py-2.5 focus:ring-2 focus:ring-ocean/40 focus:outline-none"
                />
              </div>
            </div>

            {transportError && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {transportError}
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:justify-end gap-3">
              <button
                type="button"
                onClick={closeTransportModal}
                className="px-5 py-2.5 rounded-2xl border border-gray-200 text-gray-700 font-semibold hover:bg-gray-50 transition"
                disabled={transportSaving}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={transportSaving}
                className="px-5 py-2.5 rounded-2xl bg-ocean text-white font-semibold disabled:opacity-60"
              >
                {transportSaving ? "Saving..." : "Save transportation"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Scheduling Conflict Modal */}
      {conflictModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full p-6 space-y-5 relative">
            <button
              type="button"
              onClick={() => setConflictModal(null)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 p-2 hover:bg-gray-100 rounded-full transition"
            >
              <X size={24} />
            </button>

            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-2xl bg-red-100 flex items-center justify-center text-red-600 text-2xl">
                ⚠️
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">Scheduling Conflict</h3>
                <p className="text-sm text-gray-600">Cannot accept this application</p>
              </div>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
              <p className="text-sm font-semibold text-red-800">{conflictModal.message}</p>
              <div className="space-y-2">
                <p className="text-xs font-medium text-red-700 uppercase tracking-wide">Conflicting Events:</p>
                <div className="text-sm text-red-600 space-y-1">
                  {typeof conflictModal.conflicts === 'string'
                    ? conflictModal.conflicts.split(', ').map((conflict, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-red-500"></div>
                          <span>{conflict}</span>
                        </div>
                      ))
                    : <span>{JSON.stringify(conflictModal.conflicts)}</span>
                  }
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setConflictModal(null)}
                className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 font-semibold rounded-xl hover:bg-gray-200 transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}


    </div>
  );
}

// Component for Accept button with role selection
function AcceptWithRoleButton({ application, onAccept }) {
  const [showModal, setShowModal] = useState(false);
  const [selectedRole, setSelectedRole] = useState(application.requestedRole);

  const roles = ['host', 'team_leader'];

  const handleAccept = () => {
    // Call the onAccept function with the application ID and selected role
    onAccept(application.eventAppId, selectedRole);
    setShowModal(false);
  };

  return (
    <>
      <div className="flex-1">
        <button
          onClick={() => setShowModal(true)}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-green-600 text-white text-sm font-semibold hover:bg-green-700 transition"
        >
          <CheckCircle size={16} />
          Accept
        </button>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-sm w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4">
              Assign Role for {application.fName} {application.lName}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select Role:
                </label>
                <select
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  {roles.map((role) => (
                    <option key={role} value={role}>
                      {role.replace('_', ' ').toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-400 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAccept}
                  className="flex-1 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 transition"
                >
                  Accept Application
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
