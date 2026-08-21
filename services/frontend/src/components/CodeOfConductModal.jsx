import React, { useState } from "react";
import { X, CheckCircle } from "lucide-react";

export default function CodeOfConductModal({ isOpen, onClose, onAccept, loading }) {
  const [acknowledged, setAcknowledged] = useState(false);

  if (!isOpen) return null;

  const handleAccept = () => {
    if (acknowledged) {
      onAccept();
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-2xl font-bold text-gray-900">Gatherly Host Code of Conduct</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Introduction */}
          <div className="bg-ocean/5 rounded-xl p-4 border-l-4 border-ocean">
            <p className="text-gray-700">
              As a Gatherly host, you are a representative of our agency and play a crucial role in creating
              exceptional experiences for our clients. This Code of Conduct outlines the standards of professional
              behavior expected from all hosts.
            </p>
          </div>

          {/* Professional Conduct */}
          <section>
            <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
              <CheckCircle className="text-ocean mr-2" size={20} />
              Professional Conduct
            </h3>
            <ul className="list-disc list-inside text-gray-700 space-y-1 ml-6">
              <li>Maintain a professional appearance and demeanor at all times</li>
              <li>Arrive on time and prepared for all assignments</li>
              <li>Follow all agency guidelines and client instructions</li>
              <li>Represent Gatherly positively in all interactions</li>
              <li>Maintain confidentiality regarding client information and events</li>
            </ul>
          </section>

          {/* Safety and Security */}
          <section>
            <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
              <CheckCircle className="text-ocean mr-2" size={20} />
              Safety and Security
            </h3>
            <ul className="list-disc list-inside text-gray-700 space-y-1 ml-6">
              <li>Prioritize the safety of all guests, clients, and team members</li>
              <li>Report any safety concerns or incidents immediately</li>
              <li>Follow emergency procedures and evacuation protocols</li>
              <li>Do not consume alcohol or drugs while on duty</li>
              <li>Ensure all equipment and venues meet safety standards</li>
            </ul>
          </section>

          {/* Respect and Inclusion */}
          <section>
            <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
              <CheckCircle className="text-ocean mr-2" size={20} />
              Respect and Inclusion
            </h3>
            <ul className="list-disc list-inside text-gray-700 space-y-1 ml-6">
              <li>Treat all individuals with respect and dignity</li>
              <li>Promote an inclusive environment for all guests</li>
              <li>Avoid discriminatory language or behavior</li>
              <li>Be mindful of cultural differences and sensitivities</li>
              <li>Support diversity and inclusion initiatives</li>
            </ul>
          </section>

          {/* Guest Interaction */}
          <section>
            <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
              <CheckCircle className="text-ocean mr-2" size={20} />
              Guest Interaction
            </h3>
            <ul className="list-disc list-inside text-gray-700 space-y-1 ml-6">
              <li>Provide excellent customer service to all guests</li>
              <li>Be attentive, helpful, and responsive to guest needs</li>
              <li>Maintain appropriate professional boundaries</li>
              <li>Handle guest complaints or concerns professionally</li>
              <li>Protect guest privacy and personal information</li>
            </ul>
          </section>

          {/* Communication */}
          <section>
            <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
              <CheckCircle className="text-ocean mr-2" size={20} />
              Communication
            </h3>
            <ul className="list-disc list-inside text-gray-700 space-y-1 ml-6">
              <li>Communicate clearly and professionally with team members and clients</li>
              <li>Respond promptly to messages and requests</li>
              <li>Use appropriate channels for different types of communication</li>
              <li>Maintain a positive and collaborative attitude</li>
              <li>Report issues or concerns through proper channels</li>
            </ul>
          </section>

          {/* Consequences */}
          <section>
            <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
              <CheckCircle className="text-ocean mr-2" size={20} />
              Consequences for Violations
            </h3>
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-red-800 font-medium mb-2">Violations of this Code of Conduct may result in:</p>
              <ul className="list-disc list-inside text-red-700 space-y-1 ml-4">
                <li>Verbal warning</li>
                <li>Written warning</li>
                <li>Suspension from assignments</li>
                <li>Termination of hosting agreement</li>
                <li>Legal action if applicable</li>
              </ul>
            </div>
          </section>

          {/* Acknowledgment */}
          <section className="bg-gray-50 rounded-lg p-4">
            <div className="flex items-start space-x-3">
              <input
                type="checkbox"
                id="acknowledge"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-1 h-4 w-4 text-ocean border-gray-300 rounded focus:ring-ocean"
              />
              <label htmlFor="acknowledge" className="text-sm text-gray-700">
                I acknowledge that I have read, understood, and agree to abide by the Gatherly Host Code of Conduct.
                I understand that violations may result in disciplinary action up to and including termination of my
                hosting agreement.
              </label>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200 bg-gray-50 rounded-b-2xl">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleAccept}
            disabled={!acknowledged || loading}
            className="px-6 py-2 bg-ocean text-white rounded-lg hover:bg-ocean/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
          >
            {loading ? 'Accepting...' : 'Accept Code of Conduct'}
          </button>
        </div>
      </div>
    </div>
  );
}