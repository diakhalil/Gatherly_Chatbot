import React from "react";
import { BookOpen, Clock, Award, Calendar } from "lucide-react";

export default function Trainings({ trainings }) {
  if (trainings.length === 0) {
    return (
      <div className="bg-white rounded-3xl border border-dashed border-gray-200 p-12 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-cream flex items-center justify-center">
          <BookOpen size={32} className="text-gray-400" />
        </div>
        <p className="text-gray-500 font-medium">No trainings yet</p>
        <p className="text-sm text-gray-400 mt-1">Completed trainings will appear here</p>
      </div>
    );
  }

  const completedCount = trainings.filter(t => t.status === "Completed").length;
  const upcomingCount = trainings.filter(t => t.status === "Upcoming").length;

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-mint/20 rounded-2xl p-5 border border-mint">
          <p className="text-3xl font-bold text-green-700">{completedCount}</p>
          <p className="text-sm text-green-600 mt-1">Completed Trainings</p>
        </div>
        <div className="bg-sky rounded-2xl p-5 border border-ocean/20">
          <p className="text-3xl font-bold text-ocean">{upcomingCount}</p>
          <p className="text-sm text-ocean mt-1">Upcoming Trainings</p>
        </div>
      </div>

      {/* Training List */}
      <div className="bg-white rounded-3xl shadow-lg border border-gray-100 overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100">
          <p className="text-xs uppercase tracking-[0.3em] text-ocean font-semibold">
            Certifications
          </p>
          <h2 className="text-xl font-bold text-gray-900 mt-1">
            Your Training History
          </h2>
        </div>

        <div className="divide-y divide-gray-100">
          {trainings.map((training) => (
            <div key={training.id} className="p-6 hover:bg-cream/50 transition">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                    training.status === "Completed" ? "bg-mint/30" : "bg-sky"
                  }`}>
                    {training.certificate ? (
                      <Award size={24} className={training.status === "Completed" ? "text-green-600" : "text-ocean"} />
                    ) : (
                      <BookOpen size={24} className="text-ocean" />
                    )}
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-lg font-semibold text-gray-900">{training.title}</h3>
                    <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
                      <span className="flex items-center gap-1">
                        <Calendar size={14} className="text-ocean" />
                        {training.date}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock size={14} className="text-ocean" />
                        {training.duration}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {training.certificate && training.status === "Completed" && (
                    <span className="px-3 py-1 rounded-full bg-mint/30 text-green-700 text-xs font-semibold border border-mint">
                      Certified
                    </span>
                  )}
                  <span className={`px-4 py-2 rounded-full text-sm font-semibold ${
                    training.status === "Completed" 
                      ? "bg-mint/30 text-green-700 border border-mint" 
                      : "bg-sky text-ocean border border-ocean/20"
                  }`}>
                    {training.status}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
