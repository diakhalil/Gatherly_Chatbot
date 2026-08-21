import React, { useState } from "react";
import { Star, Send, CheckCircle } from "lucide-react";
import api from "../../services/api";

export default function EventRating({ event }) {
  const [rating, setRating] = useState(0);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const ratingLabels = {
    1: "Poor",
    2: "Fair",
    3: "Good",
    4: "Very Good",
    5: "Excellent",
  };

  const categories = [
    { id: "organization", label: "Event Organization", rating: 0 },
    { id: "communication", label: "Client Communication", rating: 0 },
    { id: "support", label: "Agency Support", rating: 0 },
  ];

  const [categoryRatings, setCategoryRatings] = useState(
    categories.reduce((acc, cat) => ({ ...acc, [cat.id]: 0 }), {})
  );

  const handleCategoryRating = (categoryId, value) => {
    setCategoryRatings((prev) => ({ ...prev, [categoryId]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!event?.eventId) return;

    setError(null);
    setSubmitting(true);

    try {
      const categorySummary = categories
        .map((cat) => `${cat.label}: ${categoryRatings[cat.id] || "N/A"}/5`)
        .join(" | ");

      const contentPieces = [
        `Overall feedback: ${feedback || "No additional comments."}`,
        categorySummary,
      ];

      await api.post("/review", {
        eventId: event.eventId,
        starRating: rating,
        content: contentPieces.join("\n"),
        visibility: true,
      });

      setSubmitted(true);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to submit rating");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="bg-white rounded-3xl shadow-lg border border-gray-100 p-12 text-center">
        <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-mint/30 flex items-center justify-center">
          <CheckCircle size={40} className="text-green-600" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Thank You!</h2>
        <p className="text-gray-600 max-w-md mx-auto">
          Your feedback has been submitted successfully. This helps us improve future events and maintain our high standards.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-3xl shadow-lg border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b border-gray-100">
        <p className="text-xs uppercase tracking-[0.3em] text-ocean font-semibold">
          Feedback
        </p>
        <h2 className="text-xl font-bold text-gray-900 mt-1">
          Rate This Event
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          Share your experience as a team leader
        </p>
      </div>

      <form onSubmit={handleSubmit} className="p-6 space-y-8">
        {/* Overall Rating */}
        <div className="bg-cream rounded-2xl p-6 text-center">
          <p className="text-sm font-semibold text-gray-700 mb-4">Overall Experience</p>
          <div className="flex justify-center gap-2 mb-3">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setRating(value)}
                onMouseEnter={() => setHoveredRating(value)}
                onMouseLeave={() => setHoveredRating(0)}
                className="p-2 transition-transform hover:scale-110"
              >
                <Star
                  size={40}
                  className={`transition ${
                    value <= (hoveredRating || rating)
                      ? "text-yellow-400"
                      : "text-gray-300"
                  }`}
                  fill={value <= (hoveredRating || rating) ? "currentColor" : "none"}
                />
              </button>
            ))}
          </div>
          <p className="text-lg font-semibold text-gray-900">
            {ratingLabels[hoveredRating || rating] || "Select a rating"}
          </p>
        </div>

        {/* Category Ratings */}
        <div className="space-y-4">
          <p className="text-sm font-semibold text-gray-700">Rate specific aspects</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {categories.map((category) => (
              <div key={category.id} className="bg-cream/50 rounded-xl p-4">
                <p className="text-sm font-medium text-gray-700 mb-2">{category.label}</p>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => handleCategoryRating(category.id, value)}
                      className="p-1 transition-transform hover:scale-110"
                    >
                      <Star
                        size={24}
                        className={`transition ${
                          value <= categoryRatings[category.id]
                            ? "text-yellow-400"
                            : "text-gray-300"
                        }`}
                        fill={value <= categoryRatings[category.id] ? "currentColor" : "none"}
                      />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Feedback Text */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Additional Comments
          </label>
          <textarea
            rows={4}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Share any additional thoughts about the event, client, or suggestions for improvement..."
            className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ocean/50 focus:border-ocean resize-none"
          />
        </div>

        {/* Submit Button */}
        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={rating === 0 || submitting}
          className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-ocean text-white font-semibold hover:bg-ocean/80 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send size={18} />
          {submitting ? "Submitting..." : "Submit Rating"}
        </button>
      </form>
    </div>
  );
}
