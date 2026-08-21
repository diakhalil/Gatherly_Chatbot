import React from "react";

// AboutUsSection: full-width jumbotron with background, text, and CTA style
export default function AboutUsSection() {
    return (
        <section id="about" className="w-full bg-rose text-white py-32 px-6">
            <div className="max-w-5xl mx-auto text-center">
                {/* Title */}
                <h2 className="text-4xl md:text-5xl font-bold mb-6">
                    About Our Hosting Agency
                </h2>

                {/* Paragraph */}
                <p className="text-lg md:text-xl mb-8 leading-relaxed">
                    We are a professional event hosting agency dedicated to connecting
                    talented hosts with exclusive events. Our platform ensures seamless
                    coordination, reliable tools, and a professional environment for both
                    hosts and clients. From managing applications to ensuring smooth
                    event execution, we help make every event exceptional.
                </p>

                {/* Optional CTA button */}
                <button className="px-8 py-3 bg-white text-ocean font-semibold rounded-lg shadow-md hover:bg-gray-100 transition">
                    Learn More
                </button>
            </div>
        </section>
    );
}
