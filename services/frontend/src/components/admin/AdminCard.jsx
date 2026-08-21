import React from "react";
import { User, CheckCircle, XCircle, Mail } from "lucide-react";

export default function ApplicationsSection() {
  // Sample applicant data
  const applicants = [
    { name: "Alice Johnson", email: "alice@example.com", role: "Host", status: "Pending" },
    { name: "Bob Smith", email: "bob@example.com", role: "Host", status: "Pending" },
    { name: "Charlie Lee", email: "charlie@example.com", role: "Team Leader", status: "Pending" },
    { name: "Dana White", email: "dana@example.com", role: "Host", status: "Accepted" },
  ];

  const handleAccept = (email) => {
    console.log(`Accepted: ${email}`);
  };

  const handleReject = (email) => {
    console.log(`Rejected: ${email}`);
  };

  return (
 <section className="py-12 px-4 w-full">
  <div className="max-w-7xl mx-auto">
    <h2 className="text-3xl font-bold text-gray-800 mb-6 text-center">
      Applications
    </h2>

    <div className="flex flex-wrap -mx-4 gap-4">
      {applicants.map((applicant, idx) => (
        <div
  key={idx}
  className="bg-white shadow-lg rounded-xl p-6 border hover:shadow-xl transition transform hover:scale-105 flex flex-col justify-between w-full sm:w-1/2 md:w-1/3 lg:w-1/4 xl:w-1/5 mb-6 min-h-[250px]"

>
          <div className="flex items-center mb-4">
            <User size={32} className="text-indigo-600 mr-3" />
            <div>
             <h3 className="text-xl font-semibold break-words">{applicant.name}</h3>
                <p className="text-gray-500 flex items-center break-words">
                  <Mail size={14} className="mr-1" />
                    {applicant.email}
                </p>
            </div>
          </div>

          <p className="text-gray-600 mb-4">
            Role: <span className="font-medium">{applicant.role}</span>
          </p>

          <p className="text-gray-600 mb-4">
            Status:{" "}
            <span
              className={`font-medium ${
                applicant.status === "Pending"
                  ? "text-yellow-500"
                  : applicant.status === "Accepted"
                  ? "text-green-600"
                  : "text-red-600"
              }`}
            >
              {applicant.status}
            </span>
          </p>

          {applicant.status === "Pending" && (
            <div className="flex justify-between mt-auto">
              <button
                onClick={() => handleAccept(applicant.email)}
                className="flex items-center justify-center gap-2 bg-green-600 text-white py-2 px-4 rounded-lg hover:bg-green-700 transition"
              >
                <CheckCircle size={18} />
                Accept
              </button>
              <button
                onClick={() => handleReject(applicant.email)}
                className="flex items-center justify-center gap-2 bg-red-600 text-white py-2 px-4 rounded-lg hover:bg-red-700 transition"
              >
                <XCircle size={18} />
                Reject
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  </div>
</section>


  );
}
