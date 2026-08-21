import React, { useEffect, useRef, useState } from "react";
import { Mail, Phone, MapPin, Star, Camera } from "lucide-react";

export default function ProfileHeader({ profile, onFileSelect }) {
  const [imageError, setImageError] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    // Reset error state when the pic changes so a new URL can attempt to load.
    setImageError(false);
  }, [profile.profileImage, profile.profilePic]);

  const initials = `${profile.fName?.[0] || ""}${profile.lName?.[0] || ""}`;
  const avatarSrc = imageError ? null : profile.profileImage || profile.profilePic || null;
  const canUpload = typeof onFileSelect === "function";

  const handleAvatarClick = () => {
    if (!canUpload) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file && canUpload) {
      onFileSelect(file);
    }
  };

  return (
    <section className="px-4">
      <div className="max-w-6xl mx-auto bg-white rounded-[3rem] p-8 md:p-12 shadow-xl border border-gray-100">
        <div className="flex flex-col md:flex-row gap-8">
          {/* Avatar */}
          <div
            className={`relative flex-shrink-0 ${canUpload ? "cursor-pointer" : ""}`}
            onMouseEnter={() => canUpload && setIsHovered(true)}
            onMouseLeave={() => canUpload && setIsHovered(false)}
            onClick={handleAvatarClick}
          >
            {avatarSrc ? (
              <img
                src={avatarSrc}
                alt={`${profile.fName} ${profile.lName}`}
                className="w-32 h-32 rounded-full object-cover border-4 border-sky"
                onError={() => setImageError(true)}
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-32 h-32 rounded-full bg-ocean flex items-center justify-center text-white text-4xl font-bold">
                {initials}
              </div>
            )}
            {canUpload && isHovered && (
              <div className="absolute inset-0 w-32 h-32 rounded-full bg-black/50 flex items-center justify-center text-white">
                <Camera size={22} />
              </div>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.4em] text-ocean font-semibold">
                  Host Profile
                </p>
                <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mt-1">
                  {profile.fName} {profile.lName}
                </h1>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-4 py-2 rounded-full text-sm font-semibold ${
                  profile.eligibility === "approved"
                    ? "bg-mint/30 text-green-700 border border-mint"
                    : "bg-rose/30 text-rose border border-rose"
                }`}>
                  {profile.eligibility === "approved" ? "Verified Host" : "Pending Verification"}
                </span>
              </div>
            </div>

            <p className="text-gray-600 max-w-2xl">
              {profile.description}
            </p>

            {/* Contact & Details */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-4">
              <div className="flex items-center gap-3 text-sm text-gray-600">
                <div className="w-10 h-10 rounded-xl bg-cream flex items-center justify-center">
                  <Mail size={18} className="text-ocean" />
                </div>
                <span className="truncate">{profile.email}</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-gray-600">
                <div className="w-10 h-10 rounded-xl bg-cream flex items-center justify-center">
                  <Phone size={18} className="text-ocean" />
                </div>
                <span>{profile.phoneNb}</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-gray-600">
                <div className="w-10 h-10 rounded-xl bg-cream flex items-center justify-center">
                  <MapPin size={18} className="text-ocean" />
                </div>
                <span>{profile.address}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {profile.spokenLanguages?.length ? (
                  profile.spokenLanguages.map((lang) => (
                    <span key={lang} className="px-3 py-1 rounded-full bg-mist text-gray-700 text-xs font-medium">
                      {lang}
                    </span>
                  ))
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
      {canUpload && (
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept="image/*"
          style={{ display: "none" }}
        />
      )}
    </section>
  );
}
