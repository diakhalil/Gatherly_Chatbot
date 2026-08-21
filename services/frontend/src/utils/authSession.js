export const AUTH_EVENT = "gatherly-auth";

export const getDashboardPath = (role) => {
  if (role === "admin") return "/admin";
  if (role === "client") return "/client";
  return "/events";
};

export const getDisplayRole = (role) => {
  if (role === "user" || role === "host") return "host";
  return role || "";
};

export const storeAuthSession = ({ token, user, role, userRole }) => {
  const normalizedRole = role || user?.role;
  const displayRole = userRole || getDisplayRole(normalizedRole);
  const storedUser = { ...(user || {}), role: normalizedRole };

  localStorage.setItem("token", token);
  localStorage.setItem("user", JSON.stringify(storedUser));
  localStorage.setItem("role", normalizedRole);
  localStorage.setItem("userRole", displayRole);
  window.dispatchEvent(new Event(AUTH_EVENT));

  return { user: storedUser, role: normalizedRole, userRole: displayRole };
};

export const clearAuthSession = () => {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  localStorage.removeItem("userRole");
  localStorage.removeItem("role");
  sessionStorage.removeItem("pendingGoogleAuth");
  if (window.google?.accounts?.id?.disableAutoSelect) {
    window.google.accounts.id.disableAutoSelect();
  }
  window.dispatchEvent(new Event(AUTH_EVENT));
};
