import React, { useEffect, useState } from "react";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import AdminProfileHeader from "../components/admin/AdminProfileHeader";
import api from "../services/api";

export default function AdminProfilePage() {
  const [admin, setAdmin] = useState(null);
  const [profilePicUrl, setProfilePicUrl] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [profilePicError, setProfilePicError] = useState("");
  const [profilePicSuccess, setProfilePicSuccess] = useState("");
  const [savingProfilePic, setSavingProfilePic] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("user");
    let parsed = null;
    if (stored) {
      try {
        parsed = JSON.parse(stored);
        setAdmin(parsed);
        setProfilePicUrl(parsed.profilePic || "");
      } catch (err) {
        console.warn("Failed to parse stored admin", err);
      }
    }

    const fetchAdmin = async () => {
      const adminId = parsed?.adminId || parsed?.id;
      if (!adminId) return;
      try {
        const { data } = await api.get(`/admins/${adminId}`);
        setAdmin(data);
        setProfilePicUrl(data.profilePic || "");
        localStorage.setItem("user", JSON.stringify(data));
      } catch (err) {
        console.warn("Failed to refresh admin profile", err);
      }
    };

    fetchAdmin();
  }, []);

  const resolveAdminId = () => admin?.adminId || admin?.id;

  const saveProfilePic = async (data) => {
    setProfilePicError("");
    setProfilePicSuccess("");

    const adminId = resolveAdminId();
    if (!adminId) {
      setProfilePicError("Unable to find your account id. Please sign in again.");
      return;
    }

    setSavingProfilePic(true);
    try {
      await api.put(`/admins/${adminId}`, { profilePic: data });
      const updatedAdmin = { ...(admin || {}), profilePic: data };
      setAdmin(updatedAdmin);
      localStorage.setItem("user", JSON.stringify(updatedAdmin));
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
    let profilePicData = null;
    if (selectedFile) {
      // Read file as base64
      const reader = new FileReader();
      reader.onload = async () => {
        profilePicData = reader.result; // data:image/...;base64,...
        await saveProfilePic(profilePicData);
      };
      reader.onerror = () => {
        setProfilePicError("Failed to read the selected file.");
      };
      reader.readAsDataURL(selectedFile);
      return;
    } else {
      await saveProfilePic(null);
    }
  };

  const handleFileSelect = async (file) => {
    setSelectedFile(file);
    // Auto save
    const reader = new FileReader();
    reader.onload = async () => {
      const data = reader.result;
      await saveProfilePic(data);
    };
    reader.onerror = () => {
      setProfilePicError("Failed to read the selected file.");
    };
    reader.readAsDataURL(file);
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setPasswordError("");
    setPasswordSuccess("");

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

    const adminId = resolveAdminId();
    if (!adminId) {
      setPasswordError("Unable to find your account id. Please sign in again.");
      return;
    }

    setSavingPassword(true);
    try {
      await api.put(`/admins/${adminId}`, { password: newPassword });
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

  return (
    <main className="bg-pearl min-h-screen">
      <Navbar />

      <div className="pt-24 space-y-8">
        <AdminProfileHeader admin={admin} onFileSelect={handleFileSelect} />

        <section className="px-4 pb-16">
          <div className="max-w-6xl mx-auto space-y-6">
            <div className="bg-white rounded-3xl border border-gray-100 shadow p-8 space-y-8">
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.3em] text-ocean font-semibold">
                  Profile Settings
                </p>
                <h2 className="text-2xl font-bold text-gray-900">Manage your admin profile</h2>
                <p className="text-sm text-gray-600">
                  Update your profile photo and account security.
                </p>
              </div>


            </div>

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
        </section>
      </div>

      <Footer />
    </main>
  );
}
