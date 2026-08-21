import React, { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import ProfileHeader from "../components/profile/ProfileHeader";
import ProfileStats from "../components/profile/ProfileStats";
import AppliedEvents from "../components/profile/AppliedEvents";
import AttendedEvents from "../components/profile/AttendedEvents";
import Trainings from "../components/profile/Trainings";
import WorkedClients from "../components/profile/WorkedClients";
import api from "../services/api";

const formatDate = (value, options = { year: "numeric", month: "short", day: "numeric" }) => {
  if (!value) return "TBA";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "TBA";
  return date.toLocaleDateString(undefined, options);
};

const formatStatus = (status = "") => {
  const normalized = status.toLowerCase();
  if (normalized === "accepted") return "Accepted";
  if (normalized === "rejected") return "Rejected";
  return "Pending";
};

const formatRole = (role = "") =>
  role
    ? role
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ")
    : "Host";

const buildTrainingStatus = (dateValue) => {
  if (!dateValue) return "Upcoming";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const trainingDate = new Date(dateValue);
  return trainingDate < today ? "Completed" : "Upcoming";
};

const buildTrainingDuration = (startTime, endTime) => {
  if (!startTime || !endTime) return "Time TBD";
  return `${startTime.slice(0, 5)} - ${endTime.slice(0, 5)}`;
};

export default function HostProfilePage() {
  const { hostId } = useParams();
  const [activeTab, setActiveTab] = useState("applied");
  const navRef = useRef(null);
  const [profile, setProfile] = useState(null);
  const [appliedEvents, setAppliedEvents] = useState([]);
  const [attendedEvents, setAttendedEvents] = useState([]);
  const [trainings, setTrainings] = useState([]);
  const [workedClients, setWorkedClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [checkedUser, setCheckedUser] = useState(false);
  const [profilePicUrl, setProfilePicUrl] = useState("");
  const [profilePicError, setProfilePicError] = useState("");
  const [profilePicSuccess, setProfilePicSuccess] = useState("");
  const [savingProfilePic, setSavingProfilePic] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [availableTrainings, setAvailableTrainings] = useState([]);
  const [applyMessage, setApplyMessage] = useState("");
  const [applyError, setApplyError] = useState("");
  const [applyingId, setApplyingId] = useState(null);
  const [appliedTrainingIds, setAppliedTrainingIds] = useState([]);

  useEffect(() => {
    const stored = localStorage.getItem("user");
    if (stored) {
      try {
        setCurrentUser(JSON.parse(stored));
      } catch {
        console.warn("Failed to parse stored user");
      }
    }
    setCheckedUser(true);
  }, []);

  const resolveUserId = () => hostId || currentUser?.userId || currentUser?.id;

  useEffect(() => {
    if (!checkedUser) return;
    const resolvedId = resolveUserId();
    if (!resolvedId) return;

    // Load available trainings list (global)
    const loadTrainings = async () => {
      try {
        const { data } = await api.get("/trainings");
        setAvailableTrainings(Array.isArray(data) ? data : []);
      } catch (err) {
        console.warn("Failed to load trainings", err);
      }
    };
    loadTrainings();

    const fetchOverview = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data } = await api.get(`/users/${resolvedId}/overview`);

        setProfile({
          ...data.profile,
          profileImage: data.profile.profilePic || null,
        });
        setProfilePicUrl(data.profile.profilePic || "");

        setAppliedEvents(
          data.appliedEvents.map((event) => ({
            id: event.eventAppId,
            title: event.title,
            date: formatDate(event.startsAt),
            location: event.location || "Location TBA",
            status: formatStatus(event.status),
            category: event.type
              ? event.type.charAt(0).toUpperCase() + event.type.slice(1)
              : "General",
          }))
        );

        setAttendedEvents(
          data.attendedEvents.map((event) => ({
            id: event.eventId,
            title: event.title,
            date: formatDate(event.startsAt),
            location: event.location || "Location TBA",
            role: formatRole(event.assignedRole),
            rating: typeof event.starRating === "number" ? event.starRating.toFixed(1) : "N/A",
            client: event.clientName || "Client undisclosed",
          }))
        );

        setTrainings(
          data.trainings.map((training) => ({
            id: training.trainingId,
            title: training.title,
            date: formatDate(training.date),
            duration: buildTrainingDuration(training.startTime, training.endTime),
            status: buildTrainingStatus(training.date),
            certificate: false,
          }))
        );

        setWorkedClients(
          data.workedClients.map((client) => ({
            id: client.clientId,
            name: client.name,
            eventsWorked: client.eventsWorked,
            lastEvent: client.lastEvent ? formatDate(client.lastEvent) : "N/A",
            rating:
              typeof client.rating === "number" && !Number.isNaN(client.rating)
                ? client.rating.toFixed(1)
                : "N/A",
          }))
        );

        if (!hostId && currentUser) {
          const updatedUser = {
            ...currentUser,
            profilePic: data.profile.profilePic || currentUser.profilePic,
          };
          setCurrentUser(updatedUser);
          localStorage.setItem("user", JSON.stringify(updatedUser));
        }
      } catch (err) {
        const message = err.response?.data?.message || "Failed to load profile";
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    fetchOverview();
  }, [hostId, checkedUser]);

  const isOwnProfile =
    !hostId || (currentUser && String(currentUser.userId || currentUser.id) === String(hostId));
  const tabs = [
    { id: "applied", label: "Applied Events", count: appliedEvents.length },
    { id: "attended", label: "Attended Events", count: attendedEvents.length },
    { id: "trainings", label: "Trainings", count: trainings.length },
    { id: "clients", label: "Clients", count: workedClients.length },
    ...(isOwnProfile ? [{ id: "settings", label: "Settings", count: null }] : []),
  ];

  const saveProfilePic = async (data) => {
    setProfilePicError("");
    setProfilePicSuccess("");
    setApplyMessage("");
    setApplyError("");

    const userId = resolveUserId();
    if (!userId) {
      setProfilePicError("Unable to find your account id. Please sign in again.");
      return;
    }

    setSavingProfilePic(true);
    try {
      await api.put(`/users/${userId}`, { profilePic: data });
      setProfile((prev) =>
        prev ? { ...prev, profilePic: data, profileImage: data } : prev
      );
      if (currentUser) {
        const updatedUser = { ...currentUser, profilePic: data };
        setCurrentUser(updatedUser);
        localStorage.setItem("user", JSON.stringify(updatedUser));
      }
      setProfilePicSuccess("Profile photo updated.");
      setSelectedFile(null);
    } catch (err) {
      const message = err?.response?.data?.message || err.message || "Failed to update profile photo";
      setProfilePicError(message);
    } finally {
      setSavingProfilePic(false);
    }
  };

  const handleProfilePicSave = async (e) => {
    e.preventDefault();
    if (selectedFile) {
      const reader = new FileReader();
      reader.onload = async () => {
        await saveProfilePic(reader.result);
      };
      reader.onerror = () => {
        setProfilePicError("Failed to read the selected file.");
      };
      reader.readAsDataURL(selectedFile);
      return;
    }

    const trimmed = profilePicUrl.trim();
    await saveProfilePic(trimmed || null);
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setPasswordError("");
    setPasswordSuccess("");
    setApplyMessage("");
    setApplyError("");

    if (!newPassword || !confirmPassword) {
      setPasswordError("Please enter and confirm your new password.");
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError("Password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match.");
      return;
    }

    const userId = resolveUserId();
    if (!userId) {
      setPasswordError("Unable to find your account id. Please sign in again.");
      return;
    }

    setSavingPassword(true);
    try {
      await api.put(`/users/${userId}`, { password: newPassword });
      setPasswordSuccess("Password updated successfully.");
      setNewPassword("");
      setConfirmPassword("");
      setShowPasswordForm(false);
    } catch (err) {
      const message = err?.response?.data?.message || err.message || "Failed to update password";
      setPasswordError(message);
    } finally {
      setSavingPassword(false);
    }
  };

  const handleApplyTraining = async (trainingId) => {
    setApplyMessage("");
    setApplyError("");
    setApplyingId(trainingId);
    const userId = resolveUserId();
    if (!userId) {
      setApplyError("Please sign in again to join this training.");
      setApplyingId(null);
      return;
    }
    try {
      await api.post(`/trainings/${trainingId}/apply`);
      setApplyMessage("You're in! Training has been added to your schedule.");
      setAppliedTrainingIds((prev) =>
        prev.includes(trainingId) ? prev : [...prev, trainingId]
      );
    } catch (err) {
      const msg = err?.response?.data?.message || err.message || "Failed to join training";
      setApplyError(msg);
    } finally {
      setApplyingId(null);
    }
  };

  const scrollTabsIntoView = () => {
    if (!navRef.current) return;
    const offset = 100;
    const elementTop = navRef.current.getBoundingClientRect().top + window.scrollY;
    const target = Math.max(elementTop - offset, 0);
    window.scrollTo({ top: target, behavior: "smooth" });
  };

  const handleTabChange = (nextTab) => {
    setActiveTab(nextTab);
    requestAnimationFrame(scrollTabsIntoView);
  };

  const handleFileSelect = (file) => {
    setSelectedFile(file);
    setProfilePicUrl("");
    const reader = new FileReader();
    reader.onload = async () => {
      await saveProfilePic(reader.result);
    };
    reader.onerror = () => setProfilePicError("Failed to read the selected file.");
    reader.readAsDataURL(file);
  };

  if (loading) {
    return (
      <main className="bg-pearl min-h-screen flex items-center justify-center">
        <p className="text-gray-600">Loading profile...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="bg-pearl min-h-screen flex items-center justify-center">
        <div className="bg-white rounded-3xl shadow-lg p-8 text-center border border-gray-100">
          <p className="text-gray-700 font-semibold">{error}</p>
        </div>
      </main>
    );
  }

  if (!profile) {
    return null;
  }

  return (
    <main className="bg-pearl min-h-screen">
      <Navbar />

      <div className="pt-24 space-y-8">
        <ProfileHeader profile={profile} onFileSelect={handleFileSelect} />
        <ProfileStats profile={profile} eventsCount={attendedEvents.length} clientsCount={workedClients.length} />

        {/* Tab Navigation */}
        <section className="px-4" ref={navRef}>
          <div className="max-w-6xl mx-auto">
            <div className="bg-white rounded-3xl shadow-lg p-2 flex flex-wrap gap-2">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id)}
                  className={`flex-1 min-w-[140px] px-4 py-3 rounded-2xl text-sm font-semibold transition flex items-center justify-center gap-2 ${
                    activeTab === tab.id
                      ? "bg-ocean text-white shadow-md"
                      : "bg-transparent text-gray-700 hover:bg-cream"
                  }`}
                >
                  {tab.label}
                  {typeof tab.count === "number" && (
                    <span className={`px-2 py-0.5 rounded-full text-xs ${
                      activeTab === tab.id ? "bg-white/20" : "bg-sky text-ocean"
                    }`}>
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Tab Content */}
        <section className="px-4 pb-16">
          <div className="max-w-6xl mx-auto">
            {activeTab === "applied" && <AppliedEvents events={appliedEvents} />}
            {activeTab === "attended" && <AttendedEvents events={attendedEvents} />}
            {activeTab === "trainings" && (
              <div className="space-y-6">
                <div className="bg-white rounded-3xl border border-gray-100 shadow p-8 space-y-6">
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-[0.3em] text-ocean font-semibold">
                      Available Trainings
                    </p>
                    <h2 className="text-2xl font-bold text-gray-900">Join a Training</h2>
                    <p className="text-sm text-gray-600">
                      Browse sessions and join instantly. No approval step.
                    </p>
                  </div>

                  {applyError && (
                    <div className="bg-red-50 border border-red-100 text-red-700 text-sm rounded-2xl px-4 py-3">
                      {applyError}
                    </div>
                  )}
                  {applyMessage && (
                    <div className="bg-green-50 border border-green-100 text-green-700 text-sm rounded-2xl px-4 py-3">
                      {applyMessage}
                    </div>
                  )}

                  {availableTrainings.length === 0 ? (
                    <p className="text-sm text-gray-500">No trainings available right now.</p>
                  ) : (
                    <div className="grid gap-3">
                      {availableTrainings.map((t) => {
                        const trainingId = t.trainingId || t.id;
                        const isApplied = appliedTrainingIds.includes(trainingId);
                        const isLoading = applyingId === trainingId;
                        return (
                          <div
                            key={trainingId}
                            className="border border-gray-100 rounded-2xl p-4 flex flex-col gap-2 bg-cream"
                          >
                            <div className="flex items-center justify-between gap-3 flex-wrap">
                              <div>
                                <p className="text-xs uppercase tracking-[0.25em] text-ocean font-semibold">Training</p>
                                <h3 className="text-lg font-semibold text-gray-900">{t.title}</h3>
                                <p className="text-sm text-gray-600">
                                  {formatDate(t.date)} • {buildTrainingDuration(t.startTime, t.endTime)} • {t.location || "TBA"}
                                </p>
                              </div>
                              <button
                                className="px-4 py-2 rounded-xl bg-ocean text-white text-sm font-semibold shadow hover:bg-ocean/90 disabled:opacity-60 disabled:cursor-not-allowed"
                                disabled={isLoading || isApplied}
                                onClick={() => handleApplyTraining(trainingId)}
                              >
                                {isApplied ? "Applied" : isLoading ? "Applying..." : "Apply"}
                              </button>
                            </div>
                            {t.description && (
                              <p className="text-sm text-gray-700">{t.description}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <Trainings trainings={trainings} />
              </div>
            )}
            {activeTab === "clients" && <WorkedClients clients={workedClients} />}
            {activeTab === "settings" && isOwnProfile && (
              <div className="space-y-6">
                
	                <div className="bg-white rounded-3xl border border-gray-100 shadow p-8 space-y-6">
	                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
	                    <div className="space-y-1">
	                      <p className="text-xs uppercase tracking-[0.3em] text-ocean font-semibold">
	                        Security
	                      </p>
	                      <h2 className="text-2xl font-bold text-gray-900">Password</h2>
	                      <p className="text-sm text-gray-500">
	                        Keep this hidden unless you need to update it.
	                      </p>
	                    </div>
	                    {!showPasswordForm && (
	                      <button
	                        type="button"
	                        onClick={() => {
	                          setPasswordError("");
	                          setPasswordSuccess("");
	                          setShowPasswordForm(true);
	                        }}
	                        className="w-full sm:w-auto px-5 py-3 rounded-xl bg-ocean text-white text-sm font-semibold shadow-md hover:bg-ocean/90 transition"
	                      >
	                        Change Password
	                      </button>
	                    )}
	                  </div>

	                  {passwordError && (
                    <div className="bg-red-50 border border-red-100 text-red-700 text-sm rounded-2xl px-4 py-3">
                      {passwordError}
                    </div>
                  )}
                  {passwordSuccess && (
                    <div className="bg-green-50 border border-green-100 text-green-700 text-sm rounded-2xl px-4 py-3">
                      {passwordSuccess}
	                    </div>
	                  )}

	                  {showPasswordForm && (
	                    <form onSubmit={handlePasswordChange} className="space-y-4">
	                      <div className="grid md:grid-cols-2 gap-4">
	                        <div>
	                          <label className="block text-sm font-semibold text-gray-700 mb-2">
	                            New Password
	                          </label>
	                          <input
	                            type="password"
	                            value={newPassword}
	                            onChange={(e) => setNewPassword(e.target.value)}
	                            placeholder="At least 6 characters"
	                            className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ocean focus:border-ocean bg-white"
	                            disabled={savingPassword}
	                          />
	                        </div>
	                        <div>
	                          <label className="block text-sm font-semibold text-gray-700 mb-2">
	                            Confirm Password
	                          </label>
	                          <input
	                            type="password"
	                            value={confirmPassword}
	                            onChange={(e) => setConfirmPassword(e.target.value)}
	                            placeholder="Re-enter new password"
	                            className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ocean focus:border-ocean bg-white"
	                            disabled={savingPassword}
	                          />
	                        </div>
	                      </div>

	                      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
	                        <button
	                          type="button"
	                          className="px-6 py-3 rounded-xl border border-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition disabled:opacity-60"
	                          disabled={savingPassword}
	                          onClick={() => {
	                            setShowPasswordForm(false);
	                            setNewPassword("");
	                            setConfirmPassword("");
	                            setPasswordError("");
	                          }}
	                        >
	                          Cancel
	                        </button>
	                        <button
	                          type="submit"
	                          className="px-6 py-3 rounded-xl bg-ocean text-white text-sm font-semibold shadow-md hover:bg-ocean/90 transition disabled:opacity-60 disabled:cursor-not-allowed"
	                          disabled={savingPassword}
	                        >
	                          {savingPassword ? "Saving..." : "Save Password"}
	                        </button>
	                      </div>
	                    </form>
	                  )}
	                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      <Footer />
    </main>
  );
}
