import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../services/api";
import { clearAuthSession } from "../utils/authSession";

function MenuIcon({ size = 24 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function CloseIcon({ size = 24 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function UserIcon({ size = 24 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

const AUTH_EVENT = "gatherly-auth";

const readSession = () => {
    if (typeof window === "undefined") {
        return { token: null, user: null, userType: null };
    }
    const token = localStorage.getItem("token");
    const userRaw = localStorage.getItem("user");
    const storedRole = localStorage.getItem("userRole");
    let user = null;
    if (userRaw) {
        try {
            user = JSON.parse(userRaw);
        } catch (err) {
            console.warn("Failed to parse stored user", err);
        }
    }
    const role = storedRole || user?.role || null;
    return { token, user, userType: role };
};

export default function Navbar() {
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [session, setSession] = useState(() => readSession());
    const [teamLeaderEvent, setTeamLeaderEvent] = useState(null);
    const navigate = useNavigate();

    useEffect(() => {
        const syncSession = () => setSession(readSession());
        syncSession();

        window.addEventListener(AUTH_EVENT, syncSession);
        window.addEventListener("storage", syncSession);
        return () => {
            window.removeEventListener(AUTH_EVENT, syncSession);
            window.removeEventListener("storage", syncSession);
        };
    }, []);

    const isLoggedIn = Boolean(session.token && session.user);
    const displayRole = session.userType ? session.userType.replace(/_/g, " ") : null;

    const getDashboardPath = () => {
        if (session.userType === "admin") return "/admin";
        if (session.userType === "client") return "/client";
        if (session.userType === "host" || session.userType === "user") return "/events";
        if (session.userType === "team_leader") return "/profile";
        return "/";
    };

    const primaryLink = isLoggedIn ? getDashboardPath() : "/";

    const navLinks = isLoggedIn
        ? [
              { label: "Dashboard", path: getDashboardPath() },
              { label: "About", path: "/about" },
              { label: "Contact", path: "#contact" },
          ]
        : [
              { label: "Home", path: "#home" },
              { label: "About", path: "#about" },
              { label: "Contact", path: "#contact" },
          ];

    const scrollToSection = (hash) => {
        if (!hash?.startsWith("#") || typeof document === "undefined") return false;
        const id = hash.slice(1);
        const element = document.getElementById(id);
        if (element) {
            element.scrollIntoView({ behavior: "smooth", block: "start" });
            return true;
        }
        return false;
    };

    const profilePath =
        session.userType === "admin"
            ? "/admin/profile"
            : session.userType === "client"
            ? "/client"
            : "/profile";

    const handleProfileClick = () => {
        if (!isLoggedIn) return;
        navigate(profilePath);
        setMobileMenuOpen(false);
    };

    const handleLogout = () => {
        if (typeof window !== "undefined") {
            api.post("/auth/logout").catch(() => {});
            clearAuthSession();
        }
        setSession(readSession());
        setMobileMenuOpen(false);
        navigate("/");
    };

    useEffect(() => {
        let cancelled = false;

        const loadTeamLeaderEvent = async () => {
            if (!session.user || session.userType !== "user" || session.user.eligibility !== "approved") {
                setTeamLeaderEvent(null);
                return;
            }

            try {
                const { data } = await api.get("/events/team-leader/assignments");
                if (cancelled) return;
                if (Array.isArray(data) && data.length > 0) {
                    setTeamLeaderEvent({
                        id: data[0].eventId,
                        title: data[0].title,
                    });
                } else {
                    setTeamLeaderEvent(null);
                }
            } catch (err) {
                if (!cancelled) {
                    console.warn("Failed to load team leader assignment", err);
                    setTeamLeaderEvent(null);
                }
            }
        };

        loadTeamLeaderEvent();
        return () => {
            cancelled = true;
        };
    }, [session.user, session.userType]);

    const handleTeamLeaderNavigate = () => {
        if (!teamLeaderEvent) return;
        navigate(`/team-leader/event/${teamLeaderEvent.id}`);
        setMobileMenuOpen(false);
    };

    const showTeamLeaderLink = Boolean(teamLeaderEvent && isLoggedIn);

    return (
        <header className="w-full fixed top-0 left-0 z-[2000] bg-rose shadow-sm">
            <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
                {/* Logo */}
                <Link to={primaryLink} className="text-2xl font-bold text-white select-none">
                    Gatherly
                </Link>

                {/* Desktop Links */}
                <ul className="hidden md:flex items-center space-x-8 text-gray-700 font-medium">
                    {navLinks.map((link) => (
                        <li key={link.label}>
                            {link.path.startsWith("#") ? (
                                <button
                                    type="button"
                                    className="hover:text-white transition cursor-pointer"
                                    onClick={() => scrollToSection(link.path)}
                                >
                                    {link.label}
                                </button>
                            ) : (
                                <Link to={link.path} className="hover:text-white transition">
                                    {link.label}
                                </Link>
                            )}
                        </li>
                    ))}
                </ul>

                {/* Auth Section - Only shows when logged in */}
                <div className="hidden md:flex items-center space-x-4">
                    {isLoggedIn && (
                        <>
                            {showTeamLeaderLink && (
                                <button
                                    onClick={handleTeamLeaderNavigate}
                                    className="px-3.5 py-1.5 rounded-full bg-white/90 text-rose font-semibold text-sm border border-white/70 shadow-sm hover:bg-white transition-colors"
                                >
                                    Team Leader
                                </button>
                            )}
                            <button
                                onClick={handleProfileClick}
                                className="w-10 h-10 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white transition"
                                title="View Profile"
                            >
                                <UserIcon size={20} />
                            </button>
                            {displayRole && (
                                <span className="px-3 py-1 rounded-full bg-white/20 text-white text-xs font-medium uppercase">
                                    {displayRole}
                                </span>
                            )}
                            <button
                                onClick={handleLogout}
                                className="px-4 py-2 border border-white/50 text-white rounded-lg font-medium transition hover:bg-white/10"
                            >
                                Log out
                            </button>
                        </>
                    )}
                </div>

                {/* Mobile Menu Button */}
                <button
                    className="md:hidden p-2 text-white"
                    onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                >
                    {mobileMenuOpen ? <CloseIcon size={28} /> : <MenuIcon size={28} />}
                </button>
            </nav>

            {/* Mobile Menu */}
            {mobileMenuOpen && (
                <div className="md:hidden bg-white shadow-lg">
                    <ul className="px-6 py-4 space-y-4 text-gray-700 font-medium">
                        {navLinks.map((link) => (
                            <li key={link.label}>
                                {link.path.startsWith("#") ? (
                                    <button
                                        type="button"
                                        className="hover:text-ocean transition block text-left"
                                        onClick={() => {
                                            if (scrollToSection(link.path)) {
                                                setMobileMenuOpen(false);
                                            }
                                        }}
                                    >
                                        {link.label}
                                    </button>
                                ) : (
                                    <Link
                                        to={link.path}
                                        className="hover:text-ocean transition block"
                                        onClick={() => setMobileMenuOpen(false)}
                                    >
                                        {link.label}
                                    </Link>
                                )}
                            </li>
                        ))}
                    </ul>

                    {isLoggedIn && (
                        <div className="border-t px-6 py-4 space-y-3">
                            {showTeamLeaderLink && (
                                <button
                                    onClick={handleTeamLeaderNavigate}
                                    className="w-full px-4 py-2.5 rounded-full bg-white/90 text-rose font-semibold text-sm border border-rose/30 shadow-sm"
                                >
                                    Team Leader
                                </button>
                            )}
                            <button
                                onClick={handleProfileClick}
                                className="w-full px-4 py-3 bg-ocean text-white rounded-lg font-medium flex items-center justify-center gap-2"
                            >
                                <UserIcon size={18} />
                                View Profile
                            </button>
                            <button
                                onClick={handleLogout}
                                className="w-full px-4 py-3 border border-ocean text-ocean rounded-lg font-medium"
                            >
                                Log out
                            </button>
                        </div>
                    )}
                </div>
            )}
        </header>
    );
}
