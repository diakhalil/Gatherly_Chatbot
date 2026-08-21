import React, { useEffect, useState, useRef } from "react";
import { Mail, Phone, MapPin, Camera } from "lucide-react";

export default function ClientProfileHeader({ client, stats, onFileSelect }) {
  const [imageError, setImageError] = useState(false); //Note: If the profile image fails to load imageError becomes true. Then React shows initials instead of image
  const [isHovered, setIsHovered] = useState(false); //Note: it is true only when mouse is over the profile icon. 
  const fileInputRef = useRef(null); //Note: fileInputRef will point to <input type="file">

  useEffect(() => {
    setImageError(false);
  }, [client?.profilePic]);

// User clicks the avatar picture. This function runs --> The file picker opens
  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file && onFileSelect) {
      onFileSelect(file);
    }
  };

  const initials = `${client?.fName?.[0] || ""}${client?.lName?.[0] || ""}` || "C"; //If both initials are empty, use "C" (for Client).
  const displayName = [client?.fName, client?.lName].filter(Boolean).join(" ") || "Client";
// subtitle: shows "address • age" if both exist,
// otherwise shows address, or email, or a default welcome message
  const subtitle =
    client?.address && client?.age
      ? `${client.address} • ${client.age} yrs`
      : client?.address || client?.email || "Welcome back to your dashboard";
  const avatarSrc = !imageError ? client?.profilePic : null;

//Note: This is an array of objects that defines the statistics to display in the client profile (numbers + labels + colors).
  const statItems = [
    { label: "Total Requests", value: stats?.total ?? 0, color: "text-gray-900" },
    { label: "Accepted", value: stats?.accepted ?? 0, color: "text-green-700" },
    { label: "Pending", value: stats?.pending ?? 0, color: "text-amber-700" },
    { label: "Rejected/Other", value: stats?.rejected ?? 0, color: "text-rose" },
  ];

  return (
    <section className="px-4">
      <div className="max-w-6xl mx-auto bg-white rounded-[3rem] p-8 md:p-12 shadow-xl border border-gray-100">
        <div className="space-y-8">
          <div className="flex flex-col lg:flex-row lg:items-center gap-6">
            {/* When user clicks the avatar. Call the function handleAvatarClick. That function opens the hidden file input */}
            <div
              className="relative cursor-pointer"
              onMouseEnter={() => setIsHovered(true)}
              onMouseLeave={() => setIsHovered(false)}
              onClick={handleAvatarClick}
            >
              {avatarSrc ? (
                <img
                  src={avatarSrc}
                  alt={displayName}
                  className="w-16 h-16 rounded-2xl object-cover border-4 border-cream shadow-lg"
                  onError={() => setImageError(true)}
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-16 h-16 rounded-2xl bg-ocean text-white text-2xl font-bold flex items-center justify-center shadow-lg">
                  {initials}
                </div>
              )}
              {isHovered && (
                <div className="absolute inset-0 bg-black/50 rounded-2xl flex items-center justify-center">
                  <Camera size={20} className="text-white" />
                </div>
              )}
            </div>
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.4em] text-ocean font-semibold">
                Client Profile
              </p>
              <h1 className="text-3xl md:text-4xl font-bold text-gray-900">
                {displayName}
              </h1>
              <p className="text-gray-600">{subtitle}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="flex items-center gap-3 text-sm text-gray-700">
              <div className="w-10 h-10 rounded-xl bg-cream flex items-center justify-center text-ocean">
                <Mail size={18} />
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500">Email</p>
                <p className="font-semibold text-gray-900">{client?.email || "Not shared"}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 text-sm text-gray-700">
              <div className="w-10 h-10 rounded-xl bg-cream flex items-center justify-center text-ocean">
                <Phone size={18} />
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500">Phone</p>
                <p className="font-semibold text-gray-900">{client?.phoneNb || "Not shared"}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 text-sm text-gray-700">
              <div className="w-10 h-10 rounded-xl bg-cream flex items-center justify-center text-ocean">
                <MapPin size={18} />
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500">Address</p>
                <p className="font-semibold text-gray-900">{client?.address || "Add your address"}</p>
              </div>
            </div>
          </div>

          <div className="bg-cream rounded-2xl border border-gray-100 px-6 py-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {statItems.map((stat) => (
                <div key={stat.label} className="flex flex-col gap-1">
                  <p className="text-xs uppercase tracking-[0.25em] text-gray-500 font-semibold">
                    {stat.label}
                  </p>
                  <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      
      {/* This is a file picker (for uploading images) */}
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
