import React, { useCallback, useEffect, useMemo, useState } from "react";
import api from "../services/api";
import useBodyScrollLock from "../hooks/useBodyScrollLock";

const getEmptyManualApplicant = () => ({
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
});

export default function ApplyModal({ event, onClose, onSubmitted, currentUser }) {
  const canSubmitWithProfile =
    currentUser &&
    currentUser.role === "user" &&
    currentUser.eligibility === "approved" &&
    currentUser.codeOfConductAccepted &&
    Boolean(currentUser.isActive);

  const buildFormFromProfile = useCallback(() => {
    return {
      motivation: "",
      agreeToPolicy: false,
    };
  }, [currentUser]);

  const [form, setForm] = useState(buildFormFromProfile);
  const [manualApplicant, setManualApplicant] = useState(getEmptyManualApplicant);
  const [requestedRole, setRequestedRole] = useState("host");
  const [requestDress, setRequestDress] = useState(false);
  const [needsRide, setNeedsRide] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState({});
  const [generalError, setGeneralError] = useState("");
  const [resolvedOutfit, setResolvedOutfit] = useState(null);
  const [outfitError, setOutfitError] = useState("");
  const [outfitLoading, setOutfitLoading] = useState(false);

  const languageOptions = Array.from(
    new Set([
      "English",
      "French",
      "Arabic",
      "Spanish",
      ...(currentUser?.spokenLanguages || []),
    ])
  );
  const availabilityOptions = [
    "Full day",
    "Morning shift",
    "Evening shift",
    "Setup / rehearsal day",
  ];
  const experienceOptions = [
    { value: "first_timer", label: "First-time host" },
    { value: "junior", label: "1-3 events" },
    { value: "seasoned", label: "4+ events" },
  ];

  const handleInputChange = (field) => (e) => {
    const value =
      e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const handleManualApplicantChange = (field) => (e) => {
    const value = e.target.value;
    setManualApplicant((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const handleExperienceChange = (value) => {
    setForm((prev) => ({ ...prev, experience: value }));
  };

  const toggleArrayField = (field, value) => {
    setForm((prev) => {
      const list = prev[field];
      const exists = list.includes(value);
      return {
        ...prev,
        [field]: exists
          ? list.filter((item) => item !== value)
          : [...list, value],
      };
    });
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const validate = () => {
    const nextErrors = {};
    if (!currentUser) {
      if (!manualApplicant.firstName.trim()) nextErrors.firstName = "Required";
      if (!manualApplicant.lastName.trim()) nextErrors.lastName = "Required";
      if (!manualApplicant.email.trim()) nextErrors.email = "Required";
    }
    if (!form.agreeToPolicy) nextErrors.agreeToPolicy = "Please accept";

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const resolvePicture = useCallback((picture) => {
    const origin = (api.defaults.baseURL || "").replace(/\/api$/, "");
    if (!picture) return picture;
    if (picture.startsWith("http")) return picture;
    if (picture.startsWith("/")) return `${origin}${picture}`;
    return `${origin}/${picture}`;
  }, []);

  const eventOutfit = useMemo(() => {
    if (resolvedOutfit) return resolvedOutfit;
    if (event?.outfit) {
      return {
        ...event.outfit,
        picture: resolvePicture(event.outfit.picture),
      };
    }
    if (event?.clothingLabel || event?.clothesId) {
      return {
        clothesId: event.clothesId,
        label: event.clothingLabel,
        picture: resolvePicture(event.clothingPicture),
        description: event.clothingDescription,
        stockInfo: event.clothingStockInfo || null,
      };
    }
    return null;
  }, [event, resolvedOutfit, resolvePicture]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setGeneralError("");
    if (!validate()) return;
    if (!canSubmitWithProfile) {
      setGeneralError("Your host profile must be active before applying.");
      return;
    }

    setSubmitting(true);

    try {
      const response = await api.post('/applications', {
        requestedRole,
        notes: form.motivation.trim(),
        eventId: event.eventId,
        requestDress,
        needsRide,
      });

      const payload = {
        eventId: event.eventId,
        eventTitle: event.title,
        requestedRole,
        applicantName: `${currentUser.fName} ${currentUser.lName}`
      };

      onSubmitted?.(payload);
      setForm(buildFormFromProfile());
      setManualApplicant(getEmptyManualApplicant());
      setRequestedRole("host");
      setRequestDress(false);
      setNeedsRide(false);
      setErrors({});
      setGeneralError("");
    } catch (err) {
      setGeneralError(err.response?.data?.message || "Application failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  useBodyScrollLock(true);

  useEffect(() => {
    setForm(buildFormFromProfile());
    setManualApplicant(getEmptyManualApplicant());
    setRequestedRole("host");
    setRequestDress(false);
    setNeedsRide(false);
    setErrors({});
  }, [buildFormFromProfile, currentUser]);

  useEffect(() => {
    setResolvedOutfit(null);
    setOutfitError("");
  }, [event?.eventId]);

  useEffect(() => {
    const fetchOutfit = async () => {
      if (resolvedOutfit || !event?.clothesId) return;
      setOutfitLoading(true);
      setOutfitError("");
      try {
        const { data } = await api.get("/clothing");
        const match = (data || []).find(
          (item) => Number(item.clothesId) === Number(event.clothesId)
        );
        if (match) {
          setResolvedOutfit({
            clothesId: match.clothesId,
            label: match.clothingLabel,
            picture: resolvePicture(match.picture),
            description: match.description,
            stockInfo: match.stockInfo || match.clothingStockInfo || null,
          });
        }
      } catch (err) {
        setOutfitError(err?.response?.data?.message || "Unable to load outfit");
      } finally {
        setOutfitLoading(false);
      }
    };
    fetchOutfit();
  }, [event?.clothesId, resolvedOutfit, resolvePicture]);

  if (!event) return null;

  const disableSubmit =
    submitting ||
    (!currentUser &&
      (!manualApplicant.firstName.trim() ||
        !manualApplicant.lastName.trim() ||
        !manualApplicant.email.trim())) ||
    !form.agreeToPolicy;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-100">
          <p className="text-xs uppercase tracking-widest text-ocean font-semibold mb-2">
            Application for
          </p>
          <h2 className="text-2xl font-bold text-gray-900">{event.title}</h2>
          <p className="text-sm text-gray-500 mt-1">
            {event.date} • {event.location}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-8">
          {generalError && (
            <div className="rounded-2xl border border-rose/30 bg-rose/10 px-4 py-3 text-sm text-rose-700">
              {generalError}
            </div>
          )}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-800">
                Applicant profile
              </h3>
              {currentUser && (
                <span className="text-xs font-medium text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full">
                  Logged in
                </span>
              )}
            </div>

            {currentUser ? (
              <div className="rounded-2xl border border-gray-100 bg-cream p-4 space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <p className="text-base font-semibold text-gray-900">
                      {currentUser.fName} {currentUser.lName}
                    </p>
                    <p className="text-sm text-gray-500">{currentUser.email}</p>
                    <p className="text-sm text-gray-500">
                      {currentUser.phoneNb || "Phone on profile"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-gray-600">
                    {currentUser.clothingSize && (
                      <span className="bg-white border border-gray-200 px-3 py-1 rounded-full">
                        Size {currentUser.clothingSize}
                      </span>
                    )}
                    {currentUser.eligibility && (
                      <span className="bg-white border border-gray-200 px-3 py-1 rounded-full capitalize">
                        {currentUser.eligibility}
                      </span>
                    )}
                    {currentUser.gender && (
                      <span className="bg-white border border-gray-200 px-3 py-1 rounded-full capitalize">
                        {currentUser.gender}
                      </span>
                    )}
                  </div>
                </div>
                {currentUser.address && (
                  <p className="text-sm text-gray-600">{currentUser.address}</p>
                )}
                {currentUser.spokenLanguages?.length > 0 && (
                  <p className="text-xs text-gray-500">
                    Languages: {currentUser.spokenLanguages.join(", ")}
                  </p>
                )}
                {currentUser.description && (
                  <p className="text-xs text-gray-500">{currentUser.description}</p>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-700">First name</label>
                  <input
                    type="text"
                    value={manualApplicant.firstName}
                    onChange={handleManualApplicantChange("firstName")}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-ocean focus:border-ocean"
                  />
                  {errors.firstName && (
                    <p className="text-xs text-red-500 mt-1">{errors.firstName}</p>
                  )}
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Last name</label>
                  <input
                    type="text"
                    value={manualApplicant.lastName}
                    onChange={handleManualApplicantChange("lastName")}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-ocean focus:border-ocean"
                  />
                  {errors.lastName && (
                    <p className="text-xs text-red-500 mt-1">{errors.lastName}</p>
                  )}
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Email</label>
                  <input
                    type="email"
                    value={manualApplicant.email}
                    onChange={handleManualApplicantChange("email")}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-ocean focus:border-ocean"
                  />
                  {errors.email && (
                    <p className="text-xs text-red-500 mt-1">{errors.email}</p>
                  )}
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Phone (optional)</label>
                  <input
                    type="tel"
                    value={manualApplicant.phone}
                    onChange={handleManualApplicantChange("phone")}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-ocean focus:border-ocean"
                  />
                </div>
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h3 className="text-lg font-semibold text-gray-800">Preferred role</h3>
            <div className="flex flex-col sm:flex-row gap-3">
              {[
                { value: "host", label: "Host" },
                { value: "team_leader", label: "Team Leader" },
              ].map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRequestedRole(value)}
                  className={`flex-1 px-3 py-3 rounded-xl border text-sm font-semibold transition ${
                    requestedRole === value
                      ? "bg-ocean text-white border-ocean"
                      : "bg-white text-gray-700 border-gray-300 hover:bg-cream"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>



          <section className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Motivation / notes</label>
              <textarea
                rows={3}
                value={form.motivation}
                onChange={handleInputChange("motivation")}
                className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-ocean focus:border-ocean"
                placeholder="Tell us about your hosting style, certifications, or anything the coordinator should know."
              />
            </div>

            <div className="space-y-2">
              {eventOutfit && (
                <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-cream p-3">
                  {eventOutfit.picture && (
                    <div className="h-14 w-14 rounded-lg overflow-hidden bg-white flex-shrink-0">
                      <img
                        src={eventOutfit.picture}
                        alt={eventOutfit.label}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  )}
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-gray-900">
                      {eventOutfit.label || "Event outfit"}
                    </p>
                    <p className="text-xs text-gray-600 line-clamp-2">
                      {eventOutfit.description || "Provided by the client"}
                    </p>
                    {eventOutfit.stockInfo && (
                      <p className="text-[0.65rem] uppercase tracking-wide text-ocean">
                        Stock: {eventOutfit.stockInfo}
                      </p>
                    )}
                  </div>
                </div>
              )}
              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={requestDress}
                  onChange={(e) => setRequestDress(e.target.checked)}
                  className="rounded border-gray-300"
                />
                <span>Request dress for this event</span>
              </label>
              <label className="flex items-start gap-3 text-sm text-gray-700 rounded-xl border border-gray-200 bg-white p-3">
                <input
                  type="checkbox"
                  checked={needsRide}
                  onChange={(e) => setNeedsRide(e.target.checked)}
                  className="mt-1 rounded border-gray-300"
                />
                <span>
                  Need transportation?{" "}
                  {event?.transportationAvailable
                    ? "We'll reserve a seat on the coordinator's shuttle when your application is accepted."
                    : "We'll record your preference so the coordinator can arrange transportation if it becomes available."}
                </span>
              </label>
              {!event?.transportationAvailable && (
                <p className="text-xs text-gray-500">
                  Transportation for this event hasn't been arranged yet. If it becomes available, we'll use your
                  preference above.
                </p>
              )}
            </div>

            <label className="flex items-start gap-2 text-sm text-gray-600 bg-cream p-3 rounded-xl border border-gray-200">
              <input
                type="checkbox"
                checked={form.agreeToPolicy}
                onChange={handleInputChange("agreeToPolicy")}
                className="mt-1 rounded border-gray-300"
              />
              <span>
                I agree to Hostify's professionalism code (punctuality, NDA, and dress code compliance).
              </span>
            </label>
            {errors.agreeToPolicy && (
              <p className="text-xs text-red-500">{errors.agreeToPolicy}</p>
            )}
          </section>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 border border-gray-300 hover:bg-cream"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={disableSubmit}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-ocean hover:bg-ocean/80 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting ? "Submitting…" : "Submit application"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
