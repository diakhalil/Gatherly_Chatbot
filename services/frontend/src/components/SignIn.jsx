import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, Mail, Lock, User, ArrowRight, AlertTriangle, CheckCircle2, Eye, EyeOff, Upload } from "lucide-react";
import api, { hostAPI, clientAPI } from "../services/api";
import useBodyScrollLock from "../hooks/useBodyScrollLock";
import { getDashboardPath, storeAuthSession } from "../utils/authSession";

const PENDING_GOOGLE_AUTH_KEY = "pendingGoogleAuth";
let googleScriptPromise = null;
let googleInitializedClientId = null;
let googleCredentialHandler = null;

const loadGoogleScript = () => {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!googleScriptPromise) {
    googleScriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
      if (existing) {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", reject, { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }
  return googleScriptPromise;
};

const initializeGoogleIdentity = (clientId) => {
  if (googleInitializedClientId === clientId) return;
  window.google.accounts.id.initialize({
    client_id: clientId,
    callback: (response) => googleCredentialHandler?.(response),
  });
  googleInitializedClientId = clientId;
};

function GoogleAuthButton({ mode, disabled, onCredential, onUnavailable }) {
  const containerRef = useRef(null);
  const unavailableRef = useRef(onUnavailable);
  const [scriptReady, setScriptReady] = useState(false);
  const clientId = (process.env.REACT_APP_GOOGLE_CLIENT_ID || "").trim();

  useEffect(() => {
    googleCredentialHandler = onCredential;
  }, [onCredential]);

  useEffect(() => {
    unavailableRef.current = onUnavailable;
  }, [onUnavailable]);

  useEffect(() => {
    if (!clientId || disabled) return undefined;
    let cancelled = false;

    loadGoogleScript()
      .then(() => {
        if (cancelled) return;
        initializeGoogleIdentity(clientId);
        setScriptReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          unavailableRef.current?.("Google login could not load. Please check your connection and try again.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [clientId, disabled]);

  useEffect(() => {
    if (!scriptReady || !containerRef.current || disabled) return;
    containerRef.current.innerHTML = "";
    const width = Math.max(240, Math.min(containerRef.current.clientWidth || 360, 400));
    window.google.accounts.id.renderButton(containerRef.current, {
      theme: "outline",
      size: "large",
      type: "standard",
      shape: "rectangular",
      text: mode === "signup" ? "signup_with" : "signin_with",
      logo_alignment: "left",
      width,
    });
  }, [scriptReady, mode, disabled]);

  if (!clientId) {
    return (
      <button
        type="button"
        onClick={() =>
          onUnavailable?.(
            "Google login is not configured yet. Add REACT_APP_GOOGLE_CLIENT_ID to frontend/.env.local and restart the frontend server."
          )
        }
        className="w-full py-3 rounded-xl border border-gray-200 bg-cream text-gray-700 font-semibold hover:bg-mist transition"
      >
        {mode === "signup" ? "Sign up with Google" : "Sign in with Google"}
      </button>
    );
  }

  if (disabled) {
    return (
      <button
        type="button"
        disabled
        className="w-full py-3 rounded-xl border border-gray-200 bg-cream text-gray-400 font-semibold"
      >
        {mode === "signup" ? "Sign up with Google" : "Sign in with Google"}
      </button>
    );
  }

  return <div ref={containerRef} className="w-full min-h-[44px] flex justify-center" />;
}

const INITIAL_FORM = {
  firstName: "",
  lastName: "",
  email: "",
  password: "",
  confirmPassword: "",
  phoneNb: "",
  age: "",
  gender: "",
  address: "",
  clothingSize: "",
  profilePic: "",
  description: "",
};

export default function AuthModal({ show, onClose, initialRole = "host" }) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [activeRole, setActiveRole] = useState(initialRole);
  const [formData, setFormData] = useState(INITIAL_FORM);
  const [status, setStatus] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [profilePicPreview, setProfilePicPreview] = useState(null);
  const statusRef = useRef(null);
  const fileInputRef = useRef(null);
  const navigate = useNavigate();

  useBodyScrollLock(show);

  useEffect(() => {
    if (show) {
      setActiveRole(initialRole);
    }
  }, [initialRole, show]);

  useEffect(() => {
    setShowPassword(false);
    setShowConfirmPassword(false);
    setSelectedFile(null);
    setProfilePicPreview(null);
  }, [isSignUp, show]);

  useEffect(() => {
    if (status?.text && statusRef.current) {
      statusRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [status]);

  if (!show) return null;

  const roles = [
    { id: "host", label: "Host"},
    { id: "client", label: "Client"},
    { id: "admin", label: "Admin"},
  ];
  const visibleRoles = isSignUp ? roles.filter((role) => role.id !== "admin") : roles;
  const googleEnabledForRole = ["host", "client"].includes(activeRole);

  const handleAuthSuccess = (data) => {
    const session = storeAuthSession(data);
    onClose();
    navigate(getDashboardPath(session.role));
  };

  const handleGoogleCredential = async (credentialResponse) => {
    setStatus(null);

    if (!googleEnabledForRole) {
      setStatus({ type: "error", text: "Google authentication is available for hosts and clients only." });
      return;
    }

    if (!credentialResponse?.credential) {
      setStatus({ type: "error", text: "Failed Google login. Please try again." });
      return;
    }

    try {
      const response = await api.post("/auth/google", {
        credential: credentialResponse.credential,
        role: activeRole,
        mode: isSignUp ? "signup" : "signin",
      });

      if (response.data?.requiresProfile) {
        sessionStorage.setItem(
          PENDING_GOOGLE_AUTH_KEY,
          JSON.stringify({
            credential: credentialResponse.credential,
            role: activeRole,
            mode: isSignUp ? "signup" : "signin",
            missingFields: response.data.missingFields || [],
            googleProfile: response.data.googleProfile || {},
            expiresAt: response.data.expiresAt,
          })
        );
        onClose();
        navigate("/complete-profile");
        return;
      }

      handleAuthSuccess(response.data);
    } catch (err) {
      const message = err.response?.data?.message || "Failed Google login. Please try again.";
      setStatus({ type: "error", text: message });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus(null);
    if (isSignUp) {
      if (!["host", "client"].includes(activeRole)) {
        setStatus({ type: "error", text: "Sign-up is currently available for hosts and clients only." });
        return;
      }
      if (formData.password !== formData.confirmPassword) {
        setStatus({ type: "error", text: "Passwords do not match." });
        return;
      }
      try {
        const commonPayload = {
          fName: formData.firstName.trim(),
          lName: formData.lastName.trim(),
          email: formData.email.trim(),
          password: formData.password,
          phoneNb: formData.phoneNb.trim(),
          age: Number(formData.age),
          gender: formData.gender,
          address: formData.address.trim(),
        };
        let response;
          if (activeRole === "host") {
            // Convert file to base64 if selected
            let profilePicData = undefined;
            if (selectedFile) {
              profilePicData = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(selectedFile);
              });
            }

            const payload = {
              ...commonPayload,
              clothingSize: formData.clothingSize,
              profilePic: profilePicData || formData.profilePic?.trim() || undefined,
              description: formData.description?.trim() || undefined,
            };
            response = await hostAPI.signupHost(payload);
            setStatus({
              type: "success",
              text: "Host account created. Check your inbox for approval updates.",
            });
          } else {
            const payload = {
              ...commonPayload,
            };
            response = await clientAPI.signupClient(payload);
            setStatus({
              type: "success",
              text: "Client account created. You can now sign in and start booking events.",
            });
          }
          setIsSignUp(false);
          const createdEmail = response?.data?.user?.email || response?.data?.client?.email || formData.email;
          setFormData((prev) => ({
            ...INITIAL_FORM,
            email: createdEmail,
          }));
          setSelectedFile(null);
          setProfilePicPreview(null);
        } catch (err) {
          const message = err.response?.data?.message || "Sign-up failed";
          const validationErrors = err.response?.data?.errors;
          const details = validationErrors?.length ? `\u2022 ${validationErrors.join("\n\u2022 ")}` : "";
          setStatus({
            type: "error",
            text: [message, details].filter(Boolean).join("\n"),
          });
        }
        return;
      }

    try {
      const apiRole = activeRole === "host" ? "user" : activeRole;
      const frontendRole = activeRole === "host" ? "user" : activeRole;
      const roleLabel = activeRole === "host" ? "host" : activeRole;
      const response = await api.post("/auth/login", {
        email: formData.email,
        password: formData.password,
        role: apiRole,
      });

      handleAuthSuccess({
        token: response.data.token,
        user: response.data.user,
        role: frontendRole,
        userRole: roleLabel,
      });
    } catch (err) {
      const message = err.response?.data?.message || "Login failed. Please try again.";
      setStatus({ type: "error", text: message });
    }
  };

  const handleInputChange = (field) => (e) => {
    setFormData((prev) => ({ ...prev, [field]: e.target.value }));
    if (status) setStatus(null);
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSelectedFile(file);
      // Create preview
      const reader = new FileReader();
      reader.onload = () => {
        setProfilePicPreview(reader.result);
      };
      reader.readAsDataURL(file);
    }
    if (status) setStatus(null);
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setProfilePicPreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRoleSelect = (roleId) => {
    setActiveRole(roleId);
    if (status) setStatus(null);
  };

  const getRoleColor = (roleId) => {
    switch (roleId) {
      case "host": return "ocean";
      case "client": return "rose";
      case "admin": return "mint";
      default: return "ocean";
    }
  };

  const renderStatus = () => {
    if (!status?.text) return null;
    const isSuccess = status.type === "success";
    const Icon = isSuccess ? CheckCircle2 : AlertTriangle;
    const baseClasses =
      "flex items-start gap-3 px-4 py-3 rounded-xl text-sm border whitespace-pre-line";
    const styles = isSuccess
      ? "bg-mint/15 border-mint/50 text-emerald-700"
      : "bg-rose/10 border-rose/40 text-rose-700";

    return (
      <div className={`${baseClasses} ${styles}`} ref={statusRef}>
        <Icon size={18} className="mt-0.5 flex-shrink-0" />
        <span className="flex-1">{status.text}</span>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 bg-gray-900/60 flex justify-center items-center z-50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative bg-rose p-6 text-white">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition"
          >
            <X size={18} />
          </button>
          <h2 className="text-2xl font-bold">
            {isSignUp ? "Create Account" : "Welcome Back"}
          </h2>
          <p className="text-white/80 mt-1 text-sm">
            {isSignUp ? "Join our community today" : "Sign in to continue"}
          </p>
        </div>

        {/* Role Selector */}
        <div className="px-6 pt-6">
          <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-3">
            I am a
          </p>
          <div className="flex gap-2">
            {visibleRoles.map((role) => (
              <button
                key={role.id}
                onClick={() => handleRoleSelect(role.id)}
                className={`flex-1 py-3 px-4 rounded-xl text-sm font-semibold transition flex items-center justify-center gap-2 ${
                  activeRole === role.id
                    ? `bg-${getRoleColor(role.id)} text-white shadow-md`
                    : "bg-cream text-gray-700 hover:bg-mist"
                }`}
                style={activeRole === role.id ? {
                  backgroundColor: role.id === "host" ? "var(--color-ocean)" : 
                                   role.id === "client" ? "var(--color-rose)" : 
                                   "var(--color-mint)"
                } : {}}
              >
               
                {role.label}
              </button>
            ))}
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
          {renderStatus()}
          {googleEnabledForRole && (
            <div className="space-y-3">
              <GoogleAuthButton
                mode={isSignUp ? "signup" : "signin"}
                disabled={!googleEnabledForRole}
                onCredential={handleGoogleCredential}
                onUnavailable={(message) => setStatus({ type: "error", text: message })}
              />
              <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-gray-400 font-semibold">
                <span className="h-px flex-1 bg-gray-200" />
                <span>or use email</span>
                <span className="h-px flex-1 bg-gray-200" />
              </div>
            </div>
          )}
          {isSignUp && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
                <div className="relative">
                  <User size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={formData.firstName}
                    onChange={handleInputChange("firstName")}
                    placeholder=""
                    className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-ocean/50 focus:border-ocean"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
                <input
                  type="text"
                  value={formData.lastName}
                  onChange={handleInputChange("lastName")}
                  placeholder=""
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-ocean/50 focus:border-ocean"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <div className="relative">
              <Mail size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="email"
                value={formData.email}
                onChange={handleInputChange("email")}
                placeholder="you@example.com"
                className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-ocean/50 focus:border-ocean"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <div className="relative">
              <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type={showPassword ? "text" : "password"}
                value={formData.password}
                onChange={handleInputChange("password")}
                placeholder="••••••••"
                className="w-full pl-10 pr-12 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-ocean/50 focus:border-ocean"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {isSignUp && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
              <div className="relative">
                <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  value={formData.confirmPassword}
                  onChange={handleInputChange("confirmPassword")}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-12 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-ocean/50 focus:border-ocean"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((prev) => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                >
                  {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
          )}

          {isSignUp && ["host", "client"].includes(activeRole) && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                  <input
                    type="tel"
                    value={formData.phoneNb}
                    onChange={handleInputChange("phoneNb")}
                    placeholder="+961 70 123 456"
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-ocean/50 focus:border-ocean"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Age</label>
                  <input
                    type="number"
                    min="18"
                    max="100"
                    value={formData.age}
                    onChange={handleInputChange("age")}
                    placeholder="26"
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-ocean/50 focus:border-ocean"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className={activeRole !== "host" ? "sm:col-span-2" : ""}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Gender</label>
                  <select
                    value={formData.gender}
                    onChange={handleInputChange("gender")}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-ocean/50 focus:border-ocean"
                  >
                    <option value="">Select</option>
                    <option value="M">Male</option>
                    <option value="F">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                {activeRole === "host" && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Clothing Size</label>
                    <select
                      value={formData.clothingSize}
                      onChange={handleInputChange("clothingSize")}
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-ocean/50 focus:border-ocean"
                    >
                      <option value="">Select</option>
                      {["XS", "S", "M", "L", "XL"].map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={handleInputChange("address")}
                  placeholder="Beirut Downtown, Biel"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-ocean/50 focus:border-ocean"
                />
              </div>
              {activeRole === "host" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Profile Photo (optional)</label>
                  <div className="space-y-3">
                    {/* File Input */}
                    <div className="relative">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleFileSelect}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full flex items-center justify-center gap-3 px-4 py-3 border-2 border-dashed border-gray-300 rounded-xl hover:border-ocean hover:bg-ocean/5 transition-colors group"
                      >
                        <Upload size={20} className="text-gray-400 group-hover:text-ocean" />
                        <span className="text-sm text-gray-600 group-hover:text-ocean">
                          {selectedFile ? selectedFile.name : "Choose profile photo"}
                        </span>
                      </button>
                    </div>

                    {/* Preview */}
                    {profilePicPreview && (
                      <div className="relative inline-block">
                        <img
                          src={profilePicPreview}
                          alt="Profile preview"
                          className="w-20 h-20 rounded-xl object-cover border-2 border-gray-200"
                        />
                        <button
                          type="button"
                          onClick={handleRemoveFile}
                          className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-colors"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {activeRole === "host" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Short Bio (optional)</label>
                  <textarea
                    rows={3}
                    value={formData.description}
                    onChange={handleInputChange("description")}
                    placeholder="Tell clients about your experience..."
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-ocean/50 focus:border-ocean"
                  />
                </div>
              )}
            </div>
          )}

          <button
            type="submit"
            className="w-full py-3 rounded-xl text-white font-semibold transition flex items-center justify-center gap-2 group"
            style={{
              backgroundColor: activeRole === "host" ? "var(--color-ocean)" : 
                               activeRole === "client" ? "var(--color-rose)" : 
                               "var(--color-mint)"
            }}
          >
            {isSignUp ? "Create Account" : "Sign In"}
            <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
          </button>
        </form>

        {/* Footer */}
        <div className="px-6 pb-6 text-center">
          <p className="text-sm text-gray-600">
            {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
            <button
              onClick={() => {
                setIsSignUp(!isSignUp);
                setStatus(null);
                if (!isSignUp && activeRole === "admin") {
                  setActiveRole("host");
                }
              }}
              className="text-ocean font-semibold hover:underline"
            >
              {isSignUp ? "Sign In" : "Sign Up"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
