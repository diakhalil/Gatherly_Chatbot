import React from "react";
import { Users, CheckCircle, XCircle } from "lucide-react";

export default function StatsSection() {
  const stats = [
    { label: "Total Applicants", value: 120, icon: <Users size={24} className="text-indigo-600" /> },
    { label: "Accepted", value: 50, icon: <CheckCircle size={24} className="text-green-600" /> },
    { label: "Rejected", value: 20, icon: <XCircle size={24} className="text-red-600" /> },
  ];

  return (
    <section className="py-12 px-6 max-w-7xl mx-auto">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        {stats.map((stat, idx) => (
          <div key={idx} className="bg-white shadow-lg rounded-xl p-6 flex items-center gap-4">
            {stat.icon}
            <div>
              <p className="text-gray-500">{stat.label}</p>
              <h3 className="text-2xl font-bold text-gray-800">{stat.value}</h3>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
