import React, { useRef, useState } from "react";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import AdminStats from "../components/admin/AdminStats";
import EventRequests from "../components/admin/EventRequests";
import HostApplications from "../components/admin/HostApplications";
import ClientDirectory from "../components/admin/ClientDirectory";
import ClothingInventory from "../components/admin/ClothingInventory";
import AdminTrainings from "../components/admin/AdminTrainings";

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState("events");
  const navRef = useRef(null);

  const scrollTabsIntoView = () => {
    if (!navRef.current) return;
    const headerOffset = 80;
    const elementTop = navRef.current.getBoundingClientRect().top + window.scrollY;
    const targetPosition = Math.max(elementTop - headerOffset, 0);
    window.scrollTo({ top: targetPosition, behavior: "smooth" });
  };

  const handleTabChange = (nextTab) => {
    setActiveTab(nextTab);
    requestAnimationFrame(scrollTabsIntoView);
  };

  return (
    <main className="bg-pearl min-h-screen">
      <Navbar />
      
      {/* Stats Section */}
      <div>
        <AdminStats />
      </div>

      {/* Tab Navigation */}
      <section className="px-4 py-8" ref={navRef}>
        <div className="max-w-6xl mx-auto">
          <div className="bg-white rounded-3xl shadow-lg p-2 flex gap-2">
            <button
              onClick={() => handleTabChange("events")}
              className={`flex-1 px-6 py-4 rounded-2xl text-base font-semibold transition ${
                activeTab === "events"
                  ? "bg-ocean text-white shadow-md"
                  : "bg-transparent text-gray-700 hover:bg-cream"
              }`}
            >
              Event Requests
            </button>
            <button
              onClick={() => handleTabChange("hosts")}
              className={`flex-1 px-6 py-4 rounded-2xl text-base font-semibold transition ${
                activeTab === "hosts"
                  ? "bg-ocean text-white shadow-md"
                  : "bg-transparent text-gray-700 hover:bg-cream"
              }`}
            >
              Host Applications
            </button>
            <button
              onClick={() => handleTabChange("clients")}
              className={`flex-1 px-6 py-4 rounded-2xl text-base font-semibold transition ${
                activeTab === "clients"
                  ? "bg-ocean text-white shadow-md"
                  : "bg-transparent text-gray-700 hover:bg-cream"
              }`}
            >
              Clients
            </button>
            <button
              onClick={() => handleTabChange("clothing")}
              className={`flex-1 px-6 py-4 rounded-2xl text-base font-semibold transition ${
                activeTab === "clothing"
                  ? "bg-ocean text-white shadow-md"
                  : "bg-transparent text-gray-700 hover:bg-cream"
              }`}
            >
              Clothing
            </button>
            <button
              onClick={() => handleTabChange("trainings")}
              className={`flex-1 px-6 py-4 rounded-2xl text-base font-semibold transition ${
                activeTab === "trainings"
                  ? "bg-ocean text-white shadow-md"
                  : "bg-transparent text-gray-700 hover:bg-cream"
              }`}
            >
              Trainings
            </button>
          </div>
        </div>
      </section>

      {/* Content based on active tab */}
      {activeTab === "events" && <EventRequests />}
      {activeTab === "hosts" && <HostApplications />}
      {activeTab === "clients" && <ClientDirectory />}
      {activeTab === "clothing" && <ClothingInventory />}
      {activeTab === "trainings" && <AdminTrainings />}

      <Footer />
    </main>
  );
}
