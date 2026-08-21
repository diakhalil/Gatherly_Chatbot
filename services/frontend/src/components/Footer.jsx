import React from "react";
import { Facebook, Twitter, Instagram, Linkedin } from "lucide-react";

export default function Footer() {
  return (
    <footer id="contact" className="bg-white border-t py-6">
      <div className="max-w-6xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between">

        {/* Brand */}
        <div className="mb-4 md:mb-0 text-xl font-bold text-ocean">
          Gatherly
        </div>

        {/* Quick Links */}
        <ul className="flex flex-col md:flex-row items-center gap-6 mb-4 md:mb-0 text-gray-600">
          <li>
            <a href="#home" className="hover:text-ocean transition">Home</a>
          </li>
          <li>
            <a href="#features" className="hover:text-ocean transition">Features</a>
          </li>
          <li>
            <a href="#about" className="hover:text-ocean transition">About Us</a>
          </li>
          <li>
            <a href="#contact" className="hover:text-ocean transition">Contact</a>
          </li>
        </ul>

        {/* Social Icons */}
        <div className="flex gap-4 text-gray-600">
          <a href="#" className="hover:text-ocean transition"><Facebook size={20} /></a>
          <a href="#" className="hover:text-ocean transition"><Twitter size={20} /></a>
          <a href="#" className="hover:text-ocean transition"><Instagram size={20} /></a>
          <a href="#" className="hover:text-ocean transition"><Linkedin size={20} /></a>
        </div>
      </div>

      {/* Bottom copyright */}
      <div className="text-center text-gray-400 text-sm mt-6">
        &copy; {new Date().getFullYear()} Gatherly. All rights reserved.
      </div>
    </footer>
  );
}
