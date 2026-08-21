import React, { useEffect, useState, useRef } from "react";
import { Mail, Phone, MapPin, ShieldCheck, Camera } from "lucide-react";

export default function AdminProfileHeader({ admin, onFileSelect }) {
  const [imageError, setImageError] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    setImageError(false);
  }, [admin?.profilePic]);

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file && onFileSelect) {
      onFileSelect(file);
    }
  };

  const initials = `${admin?.fName?.[0] || ""}${admin?.lName?.[0] || ""}` || "A";
  const fullName = [admin?.fName, admin?.lName].filter(Boolean).join(" ") || "Admin";
  const subtitle = admin?.address || admin?.email || "Admin dashboard";
  const avatarSrc = !imageError ? admin?.profilePic : null;

  const infoItems = [
    { label: "Email", value: admin?.email || "Not provided", icon: Mail },
    { label: "Phone", value: admin?.phoneNb || "Not provided", icon: Phone },
    { label: "Address", value: admin?.address || "Add your address", icon: MapPin },
  ];

  return (
    <section className="px-4">
      <div className="max-w-6xl mx-auto bg-white rounded-[3rem] p-8 md:p-12 shadow-xl border border-gray-100">
        <div className="flex flex-col lg:flex-row lg:items-center gap-6">
          <div
            className="relative cursor-pointer"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onClick={handleAvatarClick}
          >
            {avatarSrc ? (
              <img
                src={avatarSrc}
                alt={fullName}
                className="w-20 h-20 rounded-2xl object-cover border-4 border-cream shadow-lg"
                onError={() => setImageError(true)}
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-20 h-20 rounded-2xl bg-ocean text-white text-3xl font-bold flex items-center justify-center shadow-lg">
                {initials}
              </div>
            )}
            {isHovered && (
              <div className="absolute inset-0 bg-black/50 rounded-2xl flex items-center justify-center">
                <Camera size={20} className="text-white" />
              </div>
            )}
          </div>

          <div className="flex-1 space-y-3">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-mint/30 text-green-700 border border-mint text-xs font-semibold">
                <ShieldCheck size={14} />
                Admin
              </span>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.4em] text-ocean font-semibold">
                Admin Profile
              </p>
              <h1 className="text-3xl md:text-4xl font-bold text-gray-900">{fullName}</h1>
              <p className="text-gray-600">{subtitle}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-8">
          {infoItems.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.label}
                className="flex items-center gap-3 text-sm text-gray-700 bg-cream rounded-2xl px-4 py-3 border border-gray-100"
              >
                <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center text-ocean">
                  <Icon size={18} />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-500">{item.label}</p>
                  <p className="font-semibold text-gray-900">{item.value}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/*"
        style={{ display: 'none' }}
      />
    </section>
  );
}
