import React from "react";
import Navbar from "../components/Navbar";
import Hero from "../components/Hero";
import Features from "../components/Features";
import AboutUs from "../components/AboutUs";
import Footer from "../components/Footer";

export default function AboutPage() {
  return (
    <main className="bg-pearl min-h-screen">
      <Navbar />
      <Hero showCTA={false} />
      <Features />
      <AboutUs />
      <Footer />
    </main>
  );
}
