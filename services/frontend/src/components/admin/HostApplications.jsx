import React, { useEffect, useMemo, useState } from "react";
import { User, CheckCircle, XCircle, Mail, Phone, Award, Eye, X, MapPin } from "lucide-react";
import api, { adminAPI } from "../../services/api";
import useBodyScrollLock from "../../hooks/useBodyScrollLock";
import AcceptApplicationModal from "./AcceptApplicationModal";

const FALLBACK_DESCRIPTION = "No additional notes provided.";
const HYDRATION_FIELDS = ["applicantFirstName", "applicantLastName", "applicantEmail", "applicantPhone"];

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

const titleCase = (value = "") =>
  value
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const getStatusKey = (value) => {
  const normalized = String(value ?? "pending").trim().toLowerCase();
  if (normalized === "accepted" || normalized === "rejected") {
    return normalized;
  }
  return "pending";
};

const formatStatusLabel = (value = "") => {
  const key = getStatusKey(value);
  if (key === "accepted") return "Accepted";
  if (key === "rejected") return "Rejected";
  return "Pending";
};

const formatEmailNotificationStatus = (status) => {
  if (status === "sent") return "Email notification sent.";
  if (status === "mail_not_configured") return "Email notification not sent: Gmail is not configured.";
  if (status === "missing_recipient") return "Email notification not sent: host email is missing.";
  if (status === "failed") return "Email notification failed. Check the backend console.";
  return "";
};

const normalizeApplication = (app) => {
  const firstName = app.applicantFirstName ?? app.fName;
  const lastName = app.applicantLastName ?? app.lName;
  const name = [firstName, lastName].filter(Boolean).join(" ").trim();
  const statusKey = getStatusKey(app.status);

  return {
    id: app.eventAppId,
    userId: app.applicantUserId ?? app.senderId,
    name: name || `Applicant #${app.senderId}`,
    email: app.applicantEmail ?? app.email ?? "Email unavailable",
    phone: app.applicantPhone ?? app.phoneNb ?? "Phone unavailable",
    role: titleCase(app.requestedRole || "host"),
    status: formatStatusLabel(app.status),
    statusKey,
    clothingSize: app.applicantClothingSize ?? "N/A",
    appliedDate: formatDate(app.sentAt),
    description: app.notes || app.applicantDescription || FALLBACK_DESCRIPTION,
    requestedRole: app.requestedRole,
    requestDress:
      app.requestDress === true ||
      app.requestDress === "true" ||
      Number(app.requestDress) === 1,
    needsRide:
      app.needsRide === true ||
      app.needsRide === "true" ||
      Number(app.needsRide) === 1,
    eventTitle: app.eventTitle || "Event Title Unavailable",
    eventLocation: app.eventLocation || "Location Unavailable",
    eventDate: formatDate(app.eventDate) || "Date Unavailable",
  };
};

const needsProfileHydration = (rawApp = {}) =>
  HYDRATION_FIELDS.some((field) => !rawApp[field]);

const hydrateApplications = async (rawApps) => {
  const normalized = rawApps.map(normalizeApplication);
  const userIdsToHydrate = Array.from(
    new Set(
      rawApps
        .filter((raw) => needsProfileHydration(raw) && raw.senderId)
        .map((raw) => raw.senderId)
    )
  );

  if (!userIdsToHydrate.length) {
    return normalized;
  }

  const profileResults = await Promise.allSettled(
    userIdsToHydrate.map((userId) => api.get(`/users/${userId}`))
  );

  const profileMap = new Map();
  profileResults.forEach((result, index) => {
    if (result.status === "fulfilled" && result.value?.data) {
      profileMap.set(userIdsToHydrate[index], result.value.data);
    }
  });

  if (!profileMap.size) {
    return normalized;
  }

  return normalized.map((app) => {
    const profile = profileMap.get(app.userId);
    if (!profile) return app;
    const profileName = [profile.fName, profile.lName].filter(Boolean).join(" ").trim();
    const enrichedDescription =
      app.description && app.description !== FALLBACK_DESCRIPTION
        ? app.description
        : profile.description || app.description;

    return {
      ...app,
      name: profileName || app.name,
      email: profile.email || app.email,
      phone: profile.phoneNb || app.phone,
      clothingSize: profile.clothingSize || app.clothingSize,
      description: enrichedDescription,
    };
  });
};

const buildHostProfileStub = (host = {}) => ({
  id: host.userId,
  userId: host.userId,
  name: [host.fName, host.lName].filter(Boolean).join(" ").trim() || `Host #${host.userId}`,
  email: host.email || "Email unavailable",
  phone: host.phoneNb || "Phone unavailable",
  role: "Host",
  status: "Pending",
  statusKey: "pending",
  clothingSize: host.clothingSize || "N/A",
  appliedDate: formatDate(host.createdAt || host.updatedAt),
  description: host.description || FALLBACK_DESCRIPTION,
  requestedRole: "host",
  requestDress: false,
});

export default function HostApplications() {
  const [activeView, setActiveView] = useState("onboarding");
  const [activeFilter, setActiveFilter] = useState("all");
  const [applicants, setApplicants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [profileModal, setProfileModal] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [pendingHosts, setPendingHosts] = useState([]);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [pendingError, setPendingError] = useState("");
  const [hostActionState, setHostActionState] = useState(null);
  const [actionStatus, setActionStatus] = useState(null);
  const [onboardingFilter, setOnboardingFilter] = useState("all");
  const [acceptModal, setAcceptModal] = useState(null);
  useBodyScrollLock(Boolean(profileModal || hostActionState || acceptModal));

  useEffect(() => {
    let cancelled = false;
    const fetchApplications = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data } = await api.get("/applications");
        if (!cancelled) {
          const hydrated = await hydrateApplications(data);
          setApplicants(hydrated);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.message || "Failed to load applications");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchApplications();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetchPendingHosts = async () => {
      setPendingLoading(true);
      setPendingError("");
      try {
        const { data } = await adminAPI.listPendingHosts();
        if (!cancelled) setPendingHosts(data || []);
      } catch (err) {
        if (!cancelled) {
          setPendingError(err.response?.data?.message || "Failed to load pending hosts");
        }
      } finally {
        if (!cancelled) setPendingLoading(false);
      }
    };
    fetchPendingHosts();
    return () => {
      cancelled = true;
    };
  }, []);

  const statusFilters = [
    { key: "all", label: "All Hosts" },
    { key: "pending", label: "Pending" },
    { key: "accepted", label: "Accepted" },
    { key: "rejected", label: "Rejected" },
  ];

  const onboardingFilters = [
    { key: "all", label: "All Pending" },
    { key: "awaiting_coc", label: "Awaiting CoC" },
    { key: "ready", label: "Ready for Approval" },
  ];

  const filteredApplicants = useMemo(() => {
    if (activeFilter === "all") return applicants;
    return applicants.filter((app) => app.statusKey === activeFilter);
  }, [activeFilter, applicants]);

  const filteredPendingHosts = useMemo(() => {
    return pendingHosts.filter((host) => {
      if (onboardingFilter === "awaiting_coc") {
        return !host.codeOfConductAccepted;
      }
      if (onboardingFilter === "ready") {
        return Boolean(host.codeOfConductAccepted);
      }
      return true;
    });
  }, [onboardingFilter, pendingHosts]);

  const pendingApplicantsCount = useMemo(
    () => applicants.filter((app) => app.statusKey === "pending").length,
    [applicants]
  );
  const adjudicatedApplicantsCount = useMemo(
    () => applicants.filter((app) => app.statusKey !== "pending").length,
    [applicants]
  );
  const readyHostsCount = useMemo(
    () => pendingHosts.filter((host) => host.codeOfConductAccepted).length,
    [pendingHosts]
  );

  const updateStatus = (applicationId, status) => {
    const key = String(status || "pending").trim().toLowerCase();
    const label = formatStatusLabel(key);
    setApplicants((prev) =>
      prev.map((app) =>
        app.id === applicationId ? { ...app, status: label, statusKey: key } : app
      )
    );
  };

  const handleAccept = async (applicationId, requestedRole) => {
    try {
      await api.put(`/applications/${applicationId}`, {
        status: "accepted",
        assignedRole: requestedRole,
      });
      updateStatus(applicationId, "Accepted");
      setActionStatus({ type: "success", text: "Application accepted." });
    } catch (err) {
      setActionStatus({
        type: "error",
        text: err.response?.data?.message || "Failed to accept application.",
      });
    }
  };

  const handleReject = async (applicationId) => {
    try {
      await api.put(`/applications/${applicationId}`, { status: "rejected" });
      updateStatus(applicationId, "Rejected");
      setActionStatus({ type: "success", text: "Application rejected." });
    } catch (err) {
      setActionStatus({
        type: "error",
        text: err.response?.data?.message || "Failed to reject application.",
      });
    }
  };

  const openProfile = async (app) => {
    setProfileLoading(true);
    try {
      const { data } = await api.get(`/users/${app.userId}/overview`);
      setProfileModal({ ...app, overview: data });
    } catch (err) {
      setActionStatus({
        type: "error",
        text: err.response?.data?.message || "Failed to load profile.",
      });
    } finally {
      setProfileLoading(false);
    }
  };

  const handleHostLifecycle = async (userId, action) => {
    setHostActionState({ userId, action });
    try {
      let response;
      if (action === "approve") {
        response = await adminAPI.approveHostAccount(userId);
      } else {
        response = await adminAPI.blockHostAccount(userId);
      }
      setPendingHosts((prev) => prev.filter((host) => host.userId !== userId));
      const emailStatus = formatEmailNotificationStatus(response?.data?.emailNotification);
      setActionStatus({
        type: "success",
        text: [action === "approve" ? "Host approved." : "Host blocked.", emailStatus]
          .filter(Boolean)
          .join("\n"),
      });
    } catch (err) {
      setActionStatus({
        type: "error",
        text: err.response?.data?.message || `Failed to ${action} host.`,
      });
    } finally {
      setHostActionState(null);
    }
  };

  const isHostActionLoading = (userId, action) =>
    Boolean(hostActionState && hostActionState.userId === userId && hostActionState.action === action);

  const getStatusColor = (status) => {
    switch (status) {
      case "Pending":
        return "text-yellow-600 bg-yellow-50 border-yellow-200";
      case "Accepted":
        return "text-green-600 bg-green-50 border-green-200";
      case "Rejected":
        return "text-red-600 bg-red-50 border-red-200";
      default:
        return "text-gray-600 bg-gray-50 border-gray-200";
    }
  };

  const profileOverview = profileModal?.overview || null;
  const profileSummary = profileOverview?.profile || null;
  const profileAppliedEvents = profileOverview?.appliedEvents || [];
  const profileAttendedEvents = profileOverview?.attendedEvents || [];
  const profileTrainings = profileOverview?.trainings || [];
  const profileWorkedClients = profileOverview?.workedClients || [];

  return (
    <div className="space-y-8">
      <section className="px-4">
        <div className="max-w-6xl mx-auto rounded-3xl bg-white shadow p-5 sm:p-6 border border-gray-100">
          <div className="grid lg:grid-cols-[1.3fr_auto] gap-6 items-center">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] font-semibold text-ocean/70">
                Host operations center
              </p>
              <h2 className="text-2xl font-bold mt-2 text-gray-900">Keep onboarding and event requests moving</h2>
              <p className="mt-2 text-sm sm:text-base text-gray-600">
                Toggle between pending host onboarding tasks and event applications without losing context.
                Quick-glance metrics highlight what needs your attention first.
              </p>
              <div className="flex flex-wrap gap-3 mt-4">
                <button
                  className={`px-5 py-2.5 rounded-2xl text-sm font-semibold transition ${
                    activeView === "onboarding"
                      ? "bg-ocean text-white shadow"
                      : "bg-cream text-gray-700 hover:bg-mist"
                  }`}
                  onClick={() => setActiveView("onboarding")}
                >
                  Host Onboarding
                </button>
                <button
                  className={`px-5 py-2.5 rounded-2xl text-sm font-semibold transition ${
                    activeView === "applications"
                      ? "bg-ocean text-white shadow"
                      : "bg-cream text-gray-700 hover:bg-mist"
                  }`}
                  onClick={() => setActiveView("applications")}
                >
                  Event Applications
                </button>
              </div>
            </div>
            <div className="bg-cream rounded-2xl p-4 sm:p-5 border border-gray-100 space-y-4">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-ocean/70 font-semibold">Snapshot</p>
                <h3 className="text-lg font-semibold text-gray-900">Today&apos;s workload</h3>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-white rounded-xl p-3 border border-gray-100">
                  <p className="text-gray-500">Pending hosts</p>
                  <p className="text-2xl font-bold text-gray-900">{pendingHosts.length}</p>
                  <p className="text-xs text-gray-500">Ready now: {readyHostsCount}</p>
                </div>
                <div className="bg-white rounded-xl p-3 border border-gray-100">
                  <p className="text-gray-500">Event applicants</p>
                  <p className="text-2xl font-bold text-gray-900">{applicants.length}</p>
                  <p className="text-xs text-gray-500">Awaiting review: {pendingApplicantsCount}</p>
                </div>
                <div className="bg-white rounded-xl p-3 border border-gray-100">
                  <p className="text-gray-500">Adjudicated</p>
                  <p className="text-2xl font-bold text-gray-900">{adjudicatedApplicantsCount}</p>
                  <p className="text-xs text-gray-500">All-time decisions</p>
                </div>
                <div className="bg-white rounded-xl p-3 border border-gray-100">
                  <p className="text-gray-500">Filters applied</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {activeView === "onboarding" ? (onboardingFilter !== "all" ? 1 : 0) : activeFilter === "all" ? 0 : 1}
                  </p>
                  <p className="text-xs text-gray-500">Quickly narrow focus</p>
                </div>
              </div>
            </div>
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

      {activeView === "onboarding" ? (
        <section className="px-4 pb-16">
          <div className="max-w-6xl mx-auto bg-white rounded-3xl shadow p-6 space-y-4 border border-gray-100">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-ocean font-semibold">
                  Host onboarding
                </p>
                <h3 className="text-lg font-semibold text-gray-900">Pending approvals</h3>
              </div>
              {pendingError && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-2">
                  {pendingError}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {onboardingFilters.map((filter) => (
                <button
                  key={filter.key}
                  onClick={() => setOnboardingFilter(filter.key)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition ${
                    onboardingFilter === filter.key
                      ? "bg-ocean text-white"
                      : "bg-cream text-gray-700 hover:bg-mist"
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
            {pendingLoading ? (
              <div className="rounded-2xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">
                Loading pending hosts...
              </div>
            ) : pendingHosts.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">
                All host profiles with completed Code of Conduct have been reviewed.
              </div>
            ) : filteredPendingHosts.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">
                No pending hosts match this filter.
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {filteredPendingHosts.map((host) => {
                  const hasAccepted = Boolean(host.codeOfConductAccepted);
                  const statusLabel = hasAccepted ? "Ready for approval" : "Awaiting Code of Conduct";
                  const statusStyle = hasAccepted
                    ? "text-green-600 bg-green-50 border-green-200"
                    : "text-yellow-600 bg-yellow-50 border-yellow-200";
                  return (
                    <article
                      key={host.userId}
                      className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-lg transition p-6 space-y-5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-ocean font-semibold mb-2">
                            <User size={14} />
                            <span>Host Candidate</span>
                          </div>
                          <h3 className="text-xl font-bold text-gray-900">
                            {[host.fName, host.lName].filter(Boolean).join(" ") || `Host #${host.userId}`}
                          </h3>
                          <p className="text-sm text-gray-500 mt-1">
                            Applied on {formatDate(host.createdAt || host.updatedAt)}
                          </p>
                        </div>
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${statusStyle}`}>
                          {statusLabel}
                        </span>
                      </div>

                      <div className="space-y-4">
                        <div className="flex flex-col gap-3">
                          <div className="flex items-start gap-3 text-gray-700">
                            <Mail size={18} className="text-ocean" />
                            <div>
                              <p className="text-xs uppercase text-gray-400 tracking-widest">Email</p>
                              <p className="font-medium">{host.email}</p>
                            </div>
                          </div>
                          {host.phoneNb && (
                            <div className="flex items-start gap-3 text-gray-700">
                              <Phone size={18} className="text-ocean" />
                              <div>
                                <p className="text-xs uppercase text-gray-400 tracking-widest">Phone</p>
                                <p className="font-medium">{host.phoneNb}</p>
                              </div>
                            </div>
                          )}
                          {host.address && (
                            <div className="flex items-start gap-3 text-gray-700">
                              <Award size={18} className="text-ocean" />
                              <div>
                                <p className="text-xs uppercase text-gray-400 tracking-widest">Address</p>
                                <p className="font-medium">{host.address}</p>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="bg-cream rounded-2xl p-4 space-y-3">
                          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                            <Award size={16} className="text-ocean" />
                            <span>Profile details</span>
                          </div>
                          <p className="text-sm text-gray-600 leading-relaxed">
                            {host.description || FALLBACK_DESCRIPTION}
                          </p>
                          <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
                            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-gray-200 text-gray-700 font-medium">
                              Size: {host.clothingSize || "?"}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => openProfile(buildHostProfileStub(host))}
                          disabled={profileLoading}
                          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full border border-gray-200 text-gray-700 font-semibold hover:border-ocean hover:text-ocean transition"
                        >
                          <Eye size={18} />
                          {profileLoading ? "Loading..." : "View Profile"}
                        </button>
                        <div className="flex flex-1 gap-3">
                          <button
                            type="button"
                            onClick={() => handleHostLifecycle(host.userId, "block")}
                            disabled={isHostActionLoading(host.userId, "block")}
                            className={`flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full font-semibold transition ${
                              isHostActionLoading(host.userId, "block")
                                ? "text-gray-400 border border-gray-100 bg-gray-50 cursor-not-allowed"
                                : "text-red-600 border border-red-200 hover:bg-red-50"
                            }`}
                          >
                            <XCircle size={18} />
                            {isHostActionLoading(host.userId, "block") ? "Blocking..." : "Block"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleHostLifecycle(host.userId, "approve")}
                            disabled={!hasAccepted || isHostActionLoading(host.userId, "approve")}
                            className={`flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full font-semibold transition ${
                              hasAccepted && !isHostActionLoading(host.userId, "approve")
                                ? "text-white bg-ocean hover:bg-ocean/90"
                                : "text-gray-400 bg-gray-100 cursor-not-allowed"
                            }`}
                          >
                            <CheckCircle size={18} />
                            {isHostActionLoading(host.userId, "approve")
                              ? "Approving..."
                              : hasAccepted
                              ? "Approve"
                              : "Awaiting CoC"}
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
      ) : (
        <>
          <section className="px-4">
            <div className="max-w-6xl mx-auto bg-white rounded-3xl shadow p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-ocean font-semibold">
                  Filter hosts & applicants
                </p>
                <h3 className="text-lg font-semibold text-gray-900">All statuses at a glance</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {statusFilters.map((filter) => (
                  <button
                    key={filter.key}
                    onClick={() => setActiveFilter(filter.key)}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition ${
                      activeFilter === filter.key
                        ? "bg-ocean text-white"
                        : "bg-cream text-gray-700 hover:bg-mist"
                    }`}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="px-4 pb-16">
            <div className="max-w-6xl mx-auto">
              {loading ? (
                <div className="bg-white rounded-3xl border border-gray-100 p-12 text-center text-gray-500">
                  Loading applications...
                </div>
              ) : error ? (
                <div className="bg-white rounded-3xl border border-red-100 p-12 text-center text-red-600">
                  {error}
                </div>
              ) : filteredApplicants.length === 0 ? (
                <div className="bg-white rounded-3xl border border-dashed border-gray-200 p-12 text-center text-gray-500">
                  No hosts or applicants match this selection.
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {filteredApplicants.map((app) => {
                    const isPending = app.statusKey === "pending";
                    return (
                      <article
                        key={app.id}
                        className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-lg transition p-6 space-y-5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-ocean font-semibold mb-2">
                            <User size={14} />
                            <span>{app.role}</span>
                          </div>
                          <h3 className="text-xl font-bold text-gray-900">{app.name}</h3>
                          <p className="text-sm text-gray-500 mt-1">Applied on {app.appliedDate}</p>
                          <div className="mt-2 p-3 bg-cream rounded-xl border border-gray-100">
                            <p className="text-sm font-semibold text-gray-900">{app.eventTitle}</p>
                            <p className="text-xs text-gray-600 flex items-center gap-1">
                              <MapPin size={12} />
                              {app.eventLocation} • {app.eventDate}
                            </p>
                          </div>
                        </div>
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-semibold border ${getStatusColor(
                            app.status
                          )}`}
                        >
                          {app.status}
                        </span>
                      </div>

                      <div className="space-y-4">
                        <div className="flex flex-col gap-3">
                          <div className="flex items-start gap-3 text-gray-700">
                            <Mail size={18} className="text-ocean" />
                            <div>
                              <p className="text-xs uppercase text-gray-400 tracking-widest">Email</p>
                              <p className="font-medium">{app.email}</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-3 text-gray-700">
                            <Phone size={18} className="text-ocean" />
                            <div>
                              <p className="text-xs uppercase text-gray-400 tracking-widest">Phone</p>
                              <p className="font-medium">{app.phone}</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-3 text-gray-700">
                            <Award size={18} className="text-ocean" />
                            <div>
                              <p className="text-xs uppercase text-gray-400 tracking-widest">
                                Outfit
                              </p>
                              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cream text-gray-800 font-semibold border border-gray-200">
                                <span className={`h-2 w-2 rounded-full ${app.requestDress ? "bg-ocean" : "bg-gray-400"}`}></span>
                                {app.requestDress ? "Dress requested" : "No dress requested"}
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="bg-cream rounded-2xl p-4 space-y-3">
                          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                            <Award size={16} className="text-ocean" />
                            <span>Experience</span>
                          </div>
                          <p className="text-sm text-gray-600 leading-relaxed">{app.description}</p>
                          <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
                            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-gray-200 text-gray-700 font-medium">
                              Size: {app.clothingSize}
                            </span>
                            <span
                              className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border font-medium ${
                                app.needsRide
                                  ? "bg-blue-50 border-blue-200 text-blue-700"
                                  : "bg-gray-50 border-gray-200 text-gray-600"
                              }`}
                            >
                              {app.needsRide ? "Needs transportation" : "Self-arrival"}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => openProfile(app)}
                          disabled={profileLoading}
                          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full border border-gray-200 text-gray-700 font-semibold hover:border-ocean hover:text-ocean transition"
                        >
                          <Eye size={18} />
                          {profileLoading ? "Loading..." : "View Profile"}
                        </button>
                        <div className="flex flex-1 gap-3">
                          <button
                            type="button"
                            disabled={!isPending}
                            onClick={() => handleReject(app.id)}
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
                            onClick={() => setAcceptModal(app)}
                            className={`flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full font-semibold transition ${
                              isPending
                                ? "text-white bg-ocean hover:bg-ocean/90"
                                : "text-gray-400 bg-gray-100 cursor-not-allowed"
                            }`}
                          >
                            <CheckCircle size={18} />
                            Accept
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
        </>
      )}

      {profileModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full relative p-6 space-y-5 max-h-[85vh] overflow-y-auto">
            <button
              type="button"
              onClick={() => setProfileModal(null)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
            >
              <X size={20} />
            </button>
            <div className="flex items-center gap-4">
              <div className="h-14 w-14 rounded-2xl bg-cream flex items-center justify-center text-ocean">
                <User size={28} />
              </div>
              <div>
                <p className="text-sm uppercase tracking-[0.25em] text-ocean font-semibold">
                  {profileModal.role}
                </p>
                <h3 className="text-2xl font-bold text-gray-900">{profileModal.name}</h3>
                <p className="text-sm text-gray-500 mt-1">Applied on {profileModal.appliedDate}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <div className="rounded-2xl border border-gray-100 p-4 space-y-3">
                <div className="flex items-start gap-3 text-gray-700">
                  <Mail size={18} className="text-ocean" />
                  <div>
                    <p className="text-xs uppercase text-gray-400 tracking-widest">Email</p>
                    <p className="font-semibold">
                      {profileSummary?.email || profileModal.email}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 text-gray-700">
                  <Phone size={18} className="text-ocean" />
                  <div>
                    <p className="text-xs uppercase text-gray-400 tracking-widest">Phone</p>
                    <p className="font-semibold">
                      {profileSummary?.phoneNb || profileModal.phone}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 text-gray-700">
                  <MapPin size={18} className="text-ocean" />
                  <div>
                    <p className="text-xs uppercase text-gray-400 tracking-widest">Address</p>
                    <p className="font-semibold">
                      {profileSummary?.address || profileModal.address || "Not provided"}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 text-gray-700">
                  <Award size={18} className="text-ocean" />
                  <div>
                    <p className="text-xs uppercase text-gray-400 tracking-widest">Eligibility</p>
                    <p className="font-semibold capitalize">
                      {profileSummary?.eligibility || "pending"}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="px-3 py-1 rounded-full bg-cream text-gray-700 font-semibold border border-gray-100">
                    Active: {profileSummary?.isActive ? "Yes" : "No"}
                  </span>
                  <span className="px-3 py-1 rounded-full bg-cream text-gray-700 font-semibold border border-gray-100">
                    CoC: {profileSummary?.codeOfConductAccepted ? "Accepted" : "Pending"}
                  </span>
                </div>
              </div>

              <div className="rounded-2xl border border-gray-100 p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                  <Award size={16} className="text-ocean" />
                  <span>Notes & Experience</span>
                </div>
                <p className="text-sm text-gray-600 leading-relaxed">
                  {profileSummary?.description || profileModal.description || "No description provided."}
                </p>
                <div className="flex flex-wrap gap-2 text-sm text-gray-600">
                  <span className="px-3 py-1 rounded-full bg-cream text-gray-800 font-semibold">
                    Clothing Size: {profileSummary?.clothingSize || profileModal.clothingSize}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="rounded-2xl border border-gray-100 p-4 space-y-2">
                <p className="text-xs uppercase tracking-[0.3em] text-ocean font-semibold">Recent Applications</p>
                {profileAppliedEvents.length === 0 ? (
                  <p className="text-sm text-gray-500">No applications submitted yet.</p>
                ) : (
                  <ul className="space-y-2 max-h-48 overflow-y-auto">
                    {profileAppliedEvents.slice(0, 5).map((event) => (
                      <li key={event.eventAppId} className="border border-gray-100 rounded-2xl px-3 py-2">
                        <p className="text-sm font-semibold text-gray-900">{event.title}</p>
                        <p className="text-xs text-gray-500">
                          {event.requestedRole} • {formatDate(event.startsAt)}
                        </p>
                        <span className="text-xs font-semibold uppercase text-gray-600">
                          {event.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-2xl border border-gray-100 p-4 space-y-2">
                <p className="text-xs uppercase tracking-[0.3em] text-ocean font-semibold">Training history</p>
                {profileTrainings.length === 0 ? (
                  <p className="text-sm text-gray-500">No trainings completed.</p>
                ) : (
                  <ul className="space-y-2 max-h-48 overflow-y-auto">
                    {profileTrainings.slice(0, 5).map((training) => (
                      <li key={training.trainingId} className="border border-gray-100 rounded-2xl px-3 py-2">
                        <p className="text-sm font-semibold text-gray-900">{training.title}</p>
                        <p className="text-xs text-gray-500">
                          {training.type} • {formatDate(training.date)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="rounded-2xl border border-gray-100 p-4 space-y-2">
                <p className="text-xs uppercase tracking-[0.3em] text-ocean font-semibold">Attended events</p>
                {profileAttendedEvents.length === 0 ? (
                  <p className="text-sm text-gray-500">No completed events yet.</p>
                ) : (
                  <ul className="space-y-2 max-h-48 overflow-y-auto">
                    {profileAttendedEvents.slice(0, 5).map((event) => (
                      <li key={event.eventId} className="border border-gray-100 rounded-2xl px-3 py-2">
                        <p className="text-sm font-semibold text-gray-900">{event.title}</p>
                        <p className="text-xs text-gray-500">
                          {event.location || "TBA"} • {formatDate(event.startsAt)}
                        </p>
                        <p className="text-xs text-gray-500">
                          Role: {event.assignedRole || "Host"}{" "}
                          {event.starRating ? `• ⭐ ${event.starRating}` : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-2xl border border-gray-100 p-4 space-y-2">
                <p className="text-xs uppercase tracking-[0.3em] text-ocean font-semibold">Worked clients</p>
                {profileWorkedClients.length === 0 ? (
                  <p className="text-sm text-gray-500">No client history yet.</p>
                ) : (
                  <ul className="space-y-2 max-h-48 overflow-y-auto">
                    {profileWorkedClients.slice(0, 5).map((client) => (
                      <li key={client.clientId} className="border border-gray-100 rounded-2xl px-3 py-2">
                        <p className="text-sm font-semibold text-gray-900">{client.name || `Client #${client.clientId}`}</p>
                        <p className="text-xs text-gray-500">
                          Events: {client.eventsWorked} • Last: {client.lastEvent ? formatDate(client.lastEvent) : "N/A"}
                        </p>
                        {client.rating && (
                          <p className="text-xs text-gray-500">Avg rating: ⭐ {client.rating}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {acceptModal && (
        <AcceptApplicationModal
          application={acceptModal}
          onClose={() => setAcceptModal(null)}
          onAccepted={() => {
            updateStatus(acceptModal.id, "Accepted");
            setAcceptModal(null);
          }}
        />
      )}
    </div>
  );
}
