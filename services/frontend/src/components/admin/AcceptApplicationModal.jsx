import React, { useState } from "react";
import api from "../../services/api";

export default function AcceptApplicationModal({ application, onClose, onAccepted }) {
  const [selectedRole, setSelectedRole] = useState(application.requestedRole);
  const [provideTransportation, setProvideTransportation] = useState(false);
  const [vehicleCapacity, setVehicleCapacity] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const needsRide =
    application.needsRide === true ||
    application.needsRide === "true" ||
    Number(application.needsRide) === 1;

  const handleAccept = async () => {
    setError("");
    setLoading(true);
    try {
      await api.put(`/applications/${application.id}`, {
        status: "accepted",
        assignedRole: selectedRole,
        provideTransportation,
        vehicleCapacity: provideTransportation ? vehicleCapacity : undefined,
      });
      onAccepted?.();
      setError("");
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to accept application.");
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    setLoading(true);
    try {
      await api.put(`/applications/${application.id}`, {
        status: "rejected",
      });
      onAccepted?.();
      setError("");
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to reject application.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-100">
          <h2 className="text-xl font-bold text-gray-900">Review Application</h2>
          <p className="text-sm text-gray-500 mt-1">
            {application.name} - {application.requestedRole}
          </p>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-green-50 border border-green-200 rounded-xl p-4">
            <p className="text-sm font-medium text-green-800 mb-2">
              Assign Role
            </p>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Select role for this application
            </label>
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-ocean focus:border-ocean"
            >
              <option value="host">Host</option>
              <option value="team_leader">Team Leader</option>
            </select>
            <p className="text-xs text-gray-600 mt-1">
              Requested: {application.requestedRole.replace('_', ' ')}
            </p>
          </div>

          {needsRide && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <p className="text-sm font-medium text-blue-800 mb-2">
                Transportation Requested
              </p>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={provideTransportation}
                  onChange={(e) => setProvideTransportation(e.target.checked)}
                  className="rounded border-gray-300"
                />
                <span className="text-sm text-gray-700">Provide transportation</span>
              </label>

              {provideTransportation && (
                <div className="mt-3">
                  <label className="text-sm font-medium text-gray-700">
                    Vehicle Capacity
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={vehicleCapacity}
                    onChange={(e) => setVehicleCapacity(parseInt(e.target.value) || 1)}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-ocean focus:border-ocean"
                  />
                </div>
              )}
            </div>
          )}

          {!needsRide && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
              <p className="text-sm text-gray-600">
                No transportation requested
              </p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <p className="text-sm font-medium text-red-800 mb-1">Error</p>
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}
        </div>

        <div className="flex gap-3 p-6 pt-0">
          <button
            type="button"
            onClick={handleReject}
            disabled={loading}
            className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-60"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={handleAccept}
            disabled={loading}
            className="flex-1 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-ocean hover:bg-ocean/80 disabled:opacity-60"
          >
            {loading ? "Processing..." : "Accept"}
          </button>
        </div>
      </div>
    </div>
  );
}
