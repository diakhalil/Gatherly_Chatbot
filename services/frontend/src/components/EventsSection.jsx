// import React from "react";
// import EventCard from "./EventCard";

// export default function EventsSection({
// events = [],
// onViewDetails = () => {},
// onApply = () => {},
// }) {
// return (
// <section className="flex py-16 px-4 bg-gray-50">
// <div className="max-w-6xl mx-auto w-full">
// <h2 className="text-4xl font-bold text-center mb-10 text-indigo-700">
// Available Events
// </h2>

// {/* Grid of Event Cards */}
// <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-[5rem]">
// {events.map((event) => (
// <EventCard
// key={event.eventId}
// event={event}
// onViewDetails={onViewDetails}
// onApply={onApply}
// />
// ))}
// </div>
// </div>
// </section>
// );
// }

import React, { useState, useEffect } from 'react';
import api from '../services/api';

const EventsSection = () => {
  const [events, setEvents] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/events')
      .then(response => setEvents(response.data))
      .catch(err => setError('Error: ' + err.message));
  }, []);

  return (
    <div>
      <h2>Events</h2>
      {error && <p>{error}</p>}
      <ul>
        {events.map(event => <li key={event.eventId}>{event.title}</li>)}
      </ul>
    </div>
  );
};

export default EventsSection;
