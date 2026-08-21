import React, { useState } from "react";
import Navbar from "../components/Navbar";
import Hero from "../components/Hero";
import Features from "../components/Features";
import AboutUs from "../components/AboutUs";
import Footer from "../components/Footer";
import AuthModal from "../components/SignIn";

export default function HomePage() {
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [selectedRole, setSelectedRole] = useState("host");

  const handleGetStarted = (role = "host") => {
    setSelectedRole(role);
    setShowAuthModal(true);
  };

  return (
    <main id="home" className="bg-pearl min-h-screen">
      <Navbar />
      <Hero onGetStarted={handleGetStarted} showCTA />
      <Features />
      <AboutUs />
      <Footer />

      <AuthModal
        show={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        initialRole={selectedRole}
      />
    </main>
  );
}
