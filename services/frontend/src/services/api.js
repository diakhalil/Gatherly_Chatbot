import axios from 'axios';
import { clearAuthSession } from '../utils/authSession';

const api = axios.create({
  baseURL:
    process.env.NODE_ENV === 'production'
      ? '/api'
      : process.env.REACT_APP_API_URL || 'http://localhost:5050/api',
});

// Add request interceptor for auth token if needed
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const message = error.response?.data?.message || "";
    const isAuthEndpoint = String(error.config?.url || "").startsWith("/auth/");
    const isSessionFailure =
      !isAuthEndpoint &&
      (status === 401 ||
        message === "Invalid token" ||
        message.toLowerCase().includes("session expired"));

    if (isSessionFailure) {
      clearAuthSession();
      if (window.location.pathname !== "/") {
        window.location.assign("/");
      }
    }

    return Promise.reject(error);
  }
);


export const adminAPI = {
  // Stats
  getStats: () => api.get('/admins/stats'),

  // Event requests
  getEventRequests: () => api.get('/admins/event-requests'),
  approveEventRequest: (id) => api.put(`/admins/event-requests/${id}/approve`),
  rejectEventRequest: (id) => api.put(`/admins/event-requests/${id}/reject`),

  // Host applications (event applications)
  getHostApplications: () => api.get('/applications'),
  getApplicationsForEvent: (eventId) => api.get(`/applications/event/${eventId}`),
  approveHostApplication: (id, assignedRole) => api.put(`/applications/${id}`, { status: 'accepted', assignedRole }),
  rejectHostApplication: (id) => api.put(`/applications/${id}`, { status: 'rejected' }),

  // Host lifecycle
  listPendingHosts: () => api.get('/admins/hosts/pending'),
  approveHostAccount: (userId) => api.patch(`/admins/hosts/${userId}/approve`),
  blockHostAccount: (userId) => api.patch(`/admins/hosts/${userId}/block`),
  listClients: () => api.get('/admins/clients'),
  getClientDetails: (clientId) => api.get(`/admins/clients/${clientId}`),
  listClothing: () => api.get('/admins/clothing'),
  createClothing: (payload) => api.post('/admins/clothing', payload),
  addClothingStock: (clothesId, payload) => api.patch(`/admins/clothing/${clothesId}/stock`, payload),
  adjustClothingStock: (clothesId, payload) => api.patch(`/admins/clothing/${clothesId}/stock`, payload),
  removeClothingStock: (clothesId, payload) => api.patch(`/admins/clothing/${clothesId}/stock/remove`, payload),
  saveTransportation: (eventId, payload) => api.post(`/transportation/${eventId}`, payload),
  deleteTransportation: (eventId) => api.delete(`/transportation/${eventId}`),
  listTrainings: () => api.get('/trainings'),
  createTraining: (payload) => api.post('/trainings', payload),
  deleteTraining: (trainingId) => api.delete(`/trainings/${trainingId}`),
  listTrainingAttendees: (trainingId) => api.get(`/trainings/${trainingId}/attendees`),
};

export const userAPI = {
  getUser: (id) => api.get(`/users/${id}`),
};

export const clothingAPI = {
  getClothing: () => api.get('/clothing'),
};

export const hostAPI = {
  signupHost: (payload) => api.post('/auth/signup/host', payload),
  acceptCodeOfConduct: (userId) => api.post('/hosts/code-of-conduct/accept', { userId }),
  getMyApplications: () => api.get('/applications'),
};

export const clientAPI = {
  signupClient: (payload) => api.post('/auth/signup/client', payload),
  getMyEvents: () => api.get('/clients/me/events'),
};

export const reviewAPI = {
  getEventReviews: (eventId) => api.get(`/events/${eventId}/reviews`),
  submitTeamLeaderReview: (eventId, payload) => api.post(`/host/events/${eventId}/review`, payload),
  updateReviewVisibility: (eventId, reviewerId, visibility) =>
    api.patch(`/admin/events/${eventId}/reviews/${reviewerId}/visibility`, { visibility }),
};

export const chatbotAPI = {
  createConversation: () =>
    api.post("/chatbot/conversations"),

  listConversations: () =>
    api.get("/chatbot/conversations"),

  getConversation: (conversationId) =>
    api.get(`/chatbot/conversations/${conversationId}/messages`),

  renameConversation: (conversationId, title) =>
    api.patch(`/chatbot/conversations/${conversationId}`, {
      title,
    }),

  deleteConversation: (conversationId) =>
    api.delete(`/chatbot/conversations/${conversationId}`),

  sendMessage: (conversationId, message, extras = {}) =>
    api.post("/chatbot/chat", {
      conversationId,
      message,
      ...extras,
    }),

  streamChat: (conversationId, message, extras = {}) => {
    const token = localStorage.getItem("token");
    return fetch(`${api.defaults.baseURL}/chatbot/chat/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        conversationId,
        message,
        ...extras,
      }),
    });
  },

  resumeRequest: (requestId, approved) =>
    api.post("/chatbot/resume", {
      requestId,
      approved,
    }),
};

export default api;
