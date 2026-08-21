import React from "react";
import { Star, ShieldCheck, Users } from "lucide-react";

export default function HeroSection({ onGetStarted, showCTA = true }) {
    return (
        <section className="w-full bg-cream pt-32 pb-20 px-4">
            {/* MAIN HERO CONTENT */}
            <div className="max-w-4xl mx-auto text-center">
                {/* Dynamic, Creative Title */}
                <h1 className="text-5xl md:text-6xl font-extrabold text-gray-900 mb-4">
                    Elevate Your Events with GATHERLY!
                </h1>

                {/* Introduction Paragraph */}
                <p className="text-gray-700 text-lg md:text-xl max-w-2xl mx-auto mb-8">
                    Welcome to our hosting agency platform, where professional hosts and event
                    organizers connect seamlessly. Whether you're looking to work as a host,
                    manage events as an admin, or hire talent as a client, we've got you covered.
                </p>

                {/* GET STARTED BUTTON */}
                {showCTA && (
                    <button
                        onClick={() => onGetStarted?.("host")}
                        className="px-10 py-4 bg-ocean text-white text-lg rounded-xl font-semibold shadow-lg hover:bg-ocean/80 transition"
                    >
                        Get Started
                    </button>
                )}
            </div>

            {/* INFORMATION BOXES */}
            <div className="mt-16 max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
                {/* Box 1 */}
                <div className="bg-white rounded-2xl shadow-lg p-8 text-center border-t-4 border-ocean hover:shadow-xl transition">
                    <Star className="mx-auto text-ocean mb-4" size={42} />
                    <h3 className="text-2xl font-semibold text-gray-800 mb-2">Top Quality Hosts</h3>
                    <p className="text-gray-600">
                        We provide trained and highly professional hosts ensuring exceptional
                        service for every occasion.
                    </p>
                </div>

                {/* Box 2 */}
                <div className="bg-white rounded-2xl shadow-lg p-8 text-center border-t-4 border-ocean hover:shadow-xl transition">
                    <ShieldCheck className="mx-auto text-ocean mb-4" size={42} />
                    <h3 className="text-2xl font-semibold text-gray-800 mb-2">Reliable & Secure System</h3>
                    <p className="text-gray-600">
                        Our platform ensures safe, transparent management for events,
                        applications, and user roles.
                    </p>
                </div>

                {/* Box 3 */}
                <div className="bg-white rounded-2xl shadow-lg p-8 text-center border-t-4 border-ocean hover:shadow-xl transition">
                    <Users className="mx-auto text-ocean mb-4" size={42} />
                    <h3 className="text-2xl font-semibold text-gray-800 mb-2">Efficient Collaboration</h3>
                    <p className="text-gray-600">
                        Hosts, leaders, admins, and clients work together seamlessly for
                        smooth event execution.
                    </p>
                </div>
            </div>
        </section>
    );
}
