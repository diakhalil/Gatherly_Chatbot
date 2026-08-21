import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowRight, Calendar, Mail, MapPin, Phone, Ruler, User } from "lucide-react";
import Navbar from "../components/Navbar";
import api from "../services/api";
import { getDashboardPath, storeAuthSession } from "../utils/authSession";

const PENDING_GOOGLE_AUTH_KEY = "pendingGoogleAuth";

const FIELD_CONFIG = {
  fName: {
    label: "First Name",
    type: "text",
    icon: User,
    placeholder: "",
  },
  lName: {
    label: "Last Name",
    type: "text",
    icon: User,
    placeholder: "",
  },
  phoneNb: {
    label: "Phone Number",
    type: "tel",
    icon: Phone,
    placeholder: "+961 70 123 456",
  },
  age: {
    label: "Age",
    type: "number",
    icon: Calendar,
    placeholder: "26",
  },
  gender: {
    label: "Gender",
    type: "select",
    options: [
      { value: "", label: "Select" },
      { value: "M", label: "Male" },
      { value: "F", label: "Female" },
      { value: "Other", label: "Other" },
    ],
  },
  address: {
    label: "Address",
    type: "text",
    icon: MapPin,
    placeholder: "Beirut Downtown, Biel",
  },
  clothingSize: {
    label: "Clothing Size",
    type: "select",
    icon: Ruler,
    options: [
      { value: "", label: "Select" },
      ...["XS", "S", "M", "L", "XL"].map((size) => ({ value: size, label: size })),
    ],
  },
};

const buildInitialForm = (fields) =>
  fields.reduce((values, field) => ({ ...values, [field]: "" }), {});

export default function CompleteProfilePage() {
  const [pendingAuth, setPendingAuth] = useState(null);
  const [formData, setFormData] = useState({});
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const raw = sessionStorage.getItem(PENDING_GOOGLE_AUTH_KEY);
    if (!raw) {
      navigate("/", { replace: true });
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      if (!parsed?.credential || !parsed?.role) {
        setStatus({ type: "error", text: "Missing Google sign-in information. Please sign in again." });
        return;
      }
      setPendingAuth(parsed);
      setFormData(buildInitialForm(parsed.missingFields || []));
    } catch {
      sessionStorage.removeItem(PENDING_GOOGLE_AUTH_KEY);
      navigate("/", { replace: true });
    }
  }, [navigate]);

  const visibleFields = useMemo(
    () => (pendingAuth?.missingFields || []).filter((field) => FIELD_CONFIG[field]),
    [pendingAuth]
  );

  const handleInputChange = (field) => (event) => {
    setFormData((prev) => ({ ...prev, [field]: event.target.value }));
    if (status) setStatus(null);
  };

  const renderStatus = () => {
    if (!status?.text) return null;
    return (
      <div className="flex items-start gap-3 px-4 py-3 rounded-xl text-sm border whitespace-pre-line bg-rose/10 border-rose/40 text-rose-700">
        <AlertTriangle size={18} className="mt-0.5 flex-shrink-0" />
        <span className="flex-1">{status.text}</span>
      </div>
    );
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!pendingAuth?.credential || !pendingAuth?.role) {
      setStatus({ type: "error", text: "Missing Google sign-in information. Please sign in again." });
      return;
    }

    if (pendingAuth.expiresAt && Date.now() > Number(pendingAuth.expiresAt)) {
      setStatus({ type: "error", text: "Google session expired. Please sign in with Google again." });
      return;
    }

    const missing = visibleFields.filter((field) => !String(formData[field] || "").trim());
    if (missing.length) {
      setStatus({ type: "error", text: "Please fill in all required fields." });
      return;
    }

    setSaving(true);
    setStatus(null);

    try {
      const response = await api.post("/auth/google/complete", {
        credential: pendingAuth.credential,
        role: pendingAuth.role,
        profile: formData,
      });

      sessionStorage.removeItem(PENDING_GOOGLE_AUTH_KEY);
      const session = storeAuthSession(response.data);
      navigate(getDashboardPath(session.role), { replace: true });
    } catch (err) {
      const validationErrors = err.response?.data?.errors;
      const details = validationErrors?.length ? `\u2022 ${validationErrors.join("\n\u2022 ")}` : "";
      const nextMissing = err.response?.data?.missingFields;
      if (Array.isArray(nextMissing) && nextMissing.length) {
        const updatedPending = { ...pendingAuth, missingFields: nextMissing };
        setPendingAuth(updatedPending);
        setFormData((prev) => ({ ...buildInitialForm(nextMissing), ...prev }));
        sessionStorage.setItem(PENDING_GOOGLE_AUTH_KEY, JSON.stringify(updatedPending));
      }
      setStatus({
        type: "error",
        text: [err.response?.data?.message || "Failed to complete profile.", details].filter(Boolean).join("\n"),
      });
    } finally {
      setSaving(false);
    }
  };

  if (!pendingAuth) {
    return (
      <main className="bg-pearl min-h-screen flex items-center justify-center">
        <p className="text-gray-600">Loading...</p>
      </main>
    );
  }

  const googleProfile = pendingAuth.googleProfile || {};
  const roleLabel = pendingAuth.role === "client" ? "Client" : "Host";

  return (
    <main className="bg-pearl min-h-screen">
      <Navbar />

      <div className="pt-28 pb-16 px-4">
        <div className="w-full max-w-md mx-auto bg-white rounded-3xl shadow-2xl overflow-hidden">
          <div className="relative bg-rose p-6 text-white">
            <h1 className="text-2xl font-bold">Complete Profile</h1>
            <p className="text-white/80 mt-1 text-sm">{roleLabel} account</p>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div className="flex items-center gap-3 rounded-xl bg-cream px-4 py-3">
              {googleProfile.profilePic ? (
                <img
                  src={googleProfile.profilePic}
                  alt={googleProfile.fullName || googleProfile.email}
                  className="w-11 h-11 rounded-full object-cover"
                />
              ) : (
                <div className="w-11 h-11 rounded-full bg-ocean text-white flex items-center justify-center">
                  <User size={20} />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">
                  {googleProfile.fullName || [googleProfile.fName, googleProfile.lName].filter(Boolean).join(" ") || "Google account"}
                </p>
                <p className="text-xs text-gray-500 truncate flex items-center gap-1">
                  <Mail size={12} />
                  {googleProfile.email}
                </p>
              </div>
            </div>

            {renderStatus()}

            {visibleFields.map((field) => {
              const config = FIELD_CONFIG[field];
              const Icon = config.icon;
              const maxAge = pendingAuth.role === "client" ? 80 : 100;

              if (config.type === "select") {
                return (
                  <div key={field}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{config.label}</label>
                    <select
                      value={formData[field] || ""}
                      onChange={handleInputChange(field)}
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-ocean/50 focus:border-ocean"
                      disabled={saving}
                    >
                      {config.options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              }

              return (
                <div key={field}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{config.label}</label>
                  <div className="relative">
                    {Icon && (
                      <Icon size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    )}
                    <input
                      type={config.type}
                      min={field === "age" ? "18" : undefined}
                      max={field === "age" ? String(maxAge) : undefined}
                      value={formData[field] || ""}
                      onChange={handleInputChange(field)}
                      placeholder={config.placeholder}
                      className={`${Icon ? "pl-10" : "pl-4"} w-full pr-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-ocean/50 focus:border-ocean`}
                      disabled={saving}
                    />
                  </div>
                </div>
              );
            })}

            <button
              type="submit"
              className="w-full py-3 rounded-xl text-white font-semibold transition flex items-center justify-center gap-2 group disabled:opacity-60 disabled:cursor-not-allowed"
              style={{
                backgroundColor:
                  pendingAuth.role === "client" ? "var(--color-rose)" : "var(--color-ocean)",
              }}
              disabled={saving}
            >
              {saving ? "Saving..." : "Save Profile"}
              <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
