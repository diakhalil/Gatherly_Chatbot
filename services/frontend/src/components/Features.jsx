import React from "react";
// import { Layers, Search, Users, Award, TShirt, Settings } from 'lucide-react';
import { Calendar, Users, Shield, SquareCheck, BookUser, Lock } from 'lucide-react';



// FeaturesSection.jsx
// Uses a flexbox layout and professional cards to display platform features.
// Recommended: TailwindCSS + lucide-react icons.

export default function FeaturesSection() {
    const features = [
        {
            title: "Everything You Need to Excel",
            description: "Our platform provides all the tools for seamless event coordination and professional development.",
            icon: <Calendar size={40} className="text-ocean mb-3" />,
        },
        {
            title: "Event Discovery",
            description: "Browse and apply for exclusive events with detailed requirements and schedules.",
            icon: <Users size={40} className="text-ocean mb-3" />,
        },
        {
            title: "Team Coordination",
            description: "Connect with other hosts, form teams, and coordinate event logistics seamlessly.",
            icon: <Shield size={40} className="text-ocean mb-3" />,
        },
        {
            title: "Professional Profile",
            description: "Build your reputation with reviews, work history, and achievement badges.",
            icon: <SquareCheck size={40} className="text-ocean mb-3" />,
        },
        {
            title: "Team Leadership",
            description: "Apply as team leader and manage event logistics, badges, and documentation.",
            icon: <BookUser size={40} className="text-ocean mb-3" />,
        },
        {
            title: "Admin Tools",
            description: "Comprehensive dashboard for managing applications, teams, and event staffing.",
            icon: <Lock size={40} className="text-ocean mb-3" />,
        },
    ];

    return (
        <section className="py-20 bg-white">

            <div className="max-w-7xl mx-auto px-4">
                <h2 className="text-4xl font-bold text-center text-gray-800 mb-12">
                    Platform Features
                </h2>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-8">
                    {features.map((feature, idx) => (
                        <div key={idx} className="flex flex-col items-center text-center p-6 bg-cream rounded-2xl shadow-md hover:shadow-xl transition">
                            {feature.icon}
                            <h3 className="text-xl font-semibold text-gray-800 mb-2">{feature.title}</h3>
                            <p className="text-gray-600">{feature.description}</p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
