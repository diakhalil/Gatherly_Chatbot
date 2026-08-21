import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import EventsPage from "./Pages/EventsPage";
import HomePage from "./Pages/HomePage";
import AdminPage from "./Pages/AdminPage";
import AdminProfilePage from "./Pages/AdminProfilePage";
import ClientPage from "./Pages/ClientPage";
import HostProfilePage from "./Pages/HostProfilePage";
import TeamLeaderEventPage from "./Pages/TeamLeaderEventPage";
import TrainingsPage from "./Pages/TrainingsPage";
import AboutPage from "./Pages/AboutPage";
import CompleteProfilePage from "./Pages/CompleteProfilePage";
import Chatbot from "./components/Chatbot";

const RequireRole = ({ role, roles, children }) => {
  const allowedRoles = roles || (role ? [role] : null);
  const token = localStorage.getItem("token");
  const storedRole =
    localStorage.getItem("role") ||
    (() => {
      try {
        const u = JSON.parse(localStorage.getItem("user") || "{}");
        return u.role;
      } catch (e) {
        return null;
      }
    })();

  if (!token) return <Navigate to="/" replace />;
  if (allowedRoles && !allowedRoles.includes(storedRole)) return <Navigate to="/" replace />;
  return children;
};

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/complete-profile" element={<CompleteProfilePage />} />
        <Route
          path="/events"
          element={
            <RequireRole role="user">
              <EventsPage />
            </RequireRole>
          }
        />
        <Route
          path="/admin"
          element={
            <RequireRole role="admin">
              <AdminPage />
            </RequireRole>
          }
        />
        <Route
          path="/admin/profile"
          element={
            <RequireRole role="admin">
              <AdminProfilePage />
            </RequireRole>
          }
        />
        <Route
          path="/client"
          element={
            <RequireRole role="client">
              <ClientPage />
            </RequireRole>
          }
        />
        <Route
          path="/trainings"
          element={
            <RequireRole roles={["user", "admin"]}>
              <TrainingsPage />
            </RequireRole>
          }
        />
        <Route
          path="/profile"
          element={
            <RequireRole role="user">
              <HostProfilePage />
            </RequireRole>
          }
        />
        <Route
          path="/profile/:hostId"
          element={
            <RequireRole roles={["user", "admin"]}>
              <HostProfilePage />
            </RequireRole>
          }
        />
        <Route
          path="/team-leader/event/:eventId"
          element={
            <RequireRole role="user">
              <TeamLeaderEventPage />
            </RequireRole>
          }
        />
      </Routes>
      <Chatbot />
    </Router>
  );
}

export default App;
