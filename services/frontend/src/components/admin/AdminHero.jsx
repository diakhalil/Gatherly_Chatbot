import React from "react";

export default function AdminHero() {
  return (
    <section className="w-full bg-indigo-600 py-16 px-6 text-white shadow-md">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-4xl sm:text-5xl font-bold mb-4 tracking-tight">
          Admin Dashboard
        </h1>
        <p className="text-lg sm:text-xl text-indigo-100 max-w-2xl">
          Manage applications, review hosts & team leaders, monitor event participation,
          and control system settings — all from one central place.
        </p>
      </div>
    </section>
  );
}
