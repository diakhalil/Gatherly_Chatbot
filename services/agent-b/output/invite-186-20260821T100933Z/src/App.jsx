import React, { useState, useEffect } from 'react';
import { eventData } from './eventData';

export default function App() {
  const [timeLeft, setTimeLeft] = useState(null);
  const [rsvpSubmitted, setRsvpSubmitted] = useState(false);
  const [rsvpForm, setRsvpForm] = useState({ name: '', guests: '1', note: '' });

  // Countdown timer logic
  useEffect(() => {
    if (!eventData.startsAt) return;
    const targetDate = new Date(eventData.startsAt.replace(' ', 'T'));
    if (isNaN(targetDate.getTime())) return;

    const updateCountdown = () => {
      const now = new Date();
      const difference = targetDate - now;
      if (difference <= 0) {
        setTimeLeft(null);
        return;
      }
      const days = Math.floor(difference / (1000 * 60 * 60 * 24));
      const hours = Math.floor((difference / (1000 * 60 * 60)) % 24);
      const minutes = Math.floor((difference / 1000 / 60) % 60);
      const seconds = Math.floor((difference / 1000) % 60);
      setTimeLeft({ days, hours, minutes, seconds });
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleRsvp = (e) => {
    e.preventDefault();
    setRsvpSubmitted(true);
  };

  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    eventData.venueName + ' ' + eventData.venueAddress
  )}`;

  return (
    <div className="site-wrapper" style={{ '--primary': eventData.primaryColor, '--accent': eventData.accentColor }}>
      {/* Sticky Navigation */}
      <nav className="site-nav">
        <div className="nav-container">
          <span className="nav-brand">{eventData.title}</span>
          <div className="nav-links">
            <a href="#hero">Home</a>
            <a href="#story">Overview</a>
            <a href="#schedule">Details</a>
            <a href="#venue">Venue</a>
            <a href="#gallery">Atmosphere</a>
            <a href="#rsvp">RSVP</a>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <header id="hero" className="hero-section">
        <div className="hero-overlay"></div>
        <div className="hero-content">
          <span className="badge-tag">{eventData.eventType}</span>
          <h1 className="hero-title">{eventData.title}</h1>
          <p className="hero-subtitle">Hosted by {eventData.clientName}</p>
          <div className="hero-datetime">
            <span>📅 {eventData.startsAt}</span>
            <span>📍 {eventData.venueName}</span>
          </div>

          {timeLeft && (
            <div className="countdown-box">
              <div className="countdown-unit">
                <span className="countdown-num">{timeLeft.days}</span>
                <span className="countdown-label">Days</span>
              </div>
              <div className="countdown-unit">
                <span className="countdown-num">{timeLeft.hours}</span>
                <span className="countdown-label">Hours</span>
              </div>
              <div className="countdown-unit">
                <span className="countdown-num">{timeLeft.minutes}</span>
                <span className="countdown-label">Mins</span>
              </div>
              <div className="countdown-unit">
                <span className="countdown-num">{timeLeft.seconds}</span>
                <span className="countdown-label">Secs</span>
              </div>
            </div>
          )}

          <div className="hero-cta">
            <a href="#rsvp" className="btn-primary">Confirm Attendance</a>
            <a href="#venue" className="btn-secondary">View Location</a>
          </div>
        </div>
      </header>

      {/* Overview / Welcome Section */}
      <section id="story" className="section overview-section">
        <div className="container">
          <div className="section-header">
            <h2>Welcome & Overview</h2>
            <div className="divider"></div>
          </div>
          <div className="overview-card">
            <p className="overview-message">{eventData.message}</p>
            <div className="overview-highlights">
              <div className="highlight-item">
                <span className="highlight-icon">🏢</span>
                <h3>Professional Reception</h3>
                <p>Tailored guest coordination and professional hosting.</p>
              </div>
              <div className="highlight-item">
                <span className="highlight-icon">🤝</span>
                <h3>Corporate Gathering</h3>
                <p>An evening dedicated to collaboration and executive networking.</p>
              </div>
              <div className="highlight-item">
                <span className="highlight-icon">✨</span>
                <h3>Full Support</h3>
                <p>Dedicated event support at Azure Conference Hall 16.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Event Details Section */}
      <section id="schedule" className="section details-section">
        <div className="container">
          <div className="section-header">
            <h2>Event Details</h2>
            <div className="divider"></div>
            <p>Essential information regarding {eventData.title}</p>
          </div>
          <div className="details-grid">
            <div className="detail-card">
              <div className="detail-icon">📅</div>
              <h3>Date & Time</h3>
              <p>{eventData.startsAt}</p>
              <span className="detail-note">Prompt arrival is appreciated.</span>
            </div>
            <div className="detail-card">
              <div className="detail-icon">📍</div>
              <h3>Location</h3>
              <p><strong>{eventData.venueName}</strong></p>
              <p>{eventData.venueAddress}</p>
            </div>
            <div className="detail-card">
              <div className="detail-icon">👤</div>
              <h3>Host & Organization</h3>
              <p>Hosted by <strong>{eventData.clientName}</strong></p>
              <p>{eventData.eventType} Event #{eventData.eventId}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Venue Section */}
      <section id="venue" className="section venue-section">
        <div className="container">
          <div className="section-header">
            <h2>The Venue</h2>
            <div className="divider"></div>
          </div>
          <div className="venue-content-card">
            <div className="venue-info">
              <h3>{eventData.venueName}</h3>
              <p className="venue-addr">📍 {eventData.venueAddress}</p>
              <p className="venue-desc">
                Azure Conference Hall 16 provides an exceptional setting for professional gatherings, offering state-of-the-art facilities and refined hospitality.
              </p>
              <a href={googleMapsUrl} target="_blank" rel="noopener noreferrer" className="btn-primary map-btn">
                Open in Google Maps 🗺️
              </a>
            </div>
            <div className="venue-visual">
              <img 
                src="https://images.unsplash.com/photo-1517502884422-41eaead166d4?auto=format&fit=crop&w=800&q=80" 
                alt="Conference Hall Atmosphere" 
                className="venue-img"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Decorative Atmosphere / Mood Section */}
      <section id="gallery" className="section gallery-section">
        <div className="container">
          <div className="section-header">
            <h2>Celebration Details & Atmosphere</h2>
            <div className="divider"></div>
            <p>A glimpse of the professional atmosphere and setting</p>
          </div>
          <div className="gallery-grid">
            <div className="gallery-item">
              <img 
                src="https://images.unsplash.com/photo-1511578314322-379afb476865?auto=format&fit=crop&w=800&q=80" 
                alt="Event atmosphere inspiration" 
              />
              <div className="gallery-caption">
                <span>Executive Gathering Atmosphere</span>
              </div>
            </div>
            <div className="gallery-item">
              <img 
                src="https://images.unsplash.com/photo-1505373877841-8d25f7d46678?auto=format&fit=crop&w=800&q=80" 
                alt="Conference setting inspiration" 
              />
              <div className="gallery-caption">
                <span>Azure Conference Hall Settings</span>
              </div>
            </div>
          </div>
          <p className="disclaimer-text">Images shown are for decorative atmosphere and mood inspiration.</p>
        </div>
      </section>

      {/* RSVP Section */}
      <section id="rsvp" className="section rsvp-section">
        <div className="container">
          <div className="section-header">
            <h2>RSVP Confirmation</h2>
            <div className="divider"></div>
            <p>Please confirm your attendance for {eventData.title}</p>
          </div>

          <div className="rsvp-card-wrapper">
            {rsvpSubmitted ? (
              <div className="rsvp-success">
                <div className="success-icon">✨</div>
                <h3>Thank You, {rsvpForm.name || 'Guest'}!</h3>
                <p>Your response for <strong>{eventData.title}</strong> has been noted locally.</p>
                <p className="success-sub">We look forward to welcoming you on {eventData.startsAt} at {eventData.venueName}.</p>
                <button onClick={() => setRsvpSubmitted(false)} className="btn-secondary" style={{ marginTop: '1.5rem' }}>
                  Edit Response
                </button>
              </div>
            ) : (
              <form onSubmit={handleRsvp} className="rsvp-form">
                <div className="form-group">
                  <label htmlFor="name">Full Name *</label>
                  <input 
                    type="text" 
                    id="name" 
                    required 
                    placeholder="Enter your full name"
                    value={rsvpForm.name}
                    onChange={(e) => setRsvpForm({ ...rsvpForm, name: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="guests">Number of Attendees</label>
                  <select 
                    id="guests"
                    value={rsvpForm.guests}
                    onChange={(e) => setRsvpForm({ ...rsvpForm, guests: e.target.value })}
                  >
                    <option value="1">1 Person</option>
                    <option value="2">2 Persons</option>
                    <option value="3">3 Persons</option>
                    <option value="4">4 Persons</option>
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="note">Special Notes or Dietary Requirements</label>
                  <textarea 
                    id="note" 
                    rows="3" 
                    placeholder="Optional notes for the host..."
                    value={rsvpForm.note}
                    onChange={(e) => setRsvpForm({ ...rsvpForm, note: e.target.value })}
                  ></textarea>
                </div>
                <button type="submit" className="btn-primary btn-submit">
                  Confirm Attendance
                </button>
                <p className="rsvp-disclaimer">Note: This is an on-page interactive confirmation for {eventData.clientName}&apos;s event.</p>
              </form>
            )}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="site-footer">
        <div className="container footer-content">
          <p>&copy; {new Date().getFullYear()} {eventData.title} • Hosted by {eventData.clientName}</p>
          <p className="footer-sub">{eventData.venueName} — {eventData.venueAddress}</p>
        </div>
      </footer>
    </div>
  );
}
