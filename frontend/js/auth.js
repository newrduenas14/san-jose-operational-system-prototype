import { ROLES } from "./permissions.js";

const SESSION_KEY = "sjops.session";

export function getSession() {
  const saved = localStorage.getItem(SESSION_KEY);
  if (saved) return JSON.parse(saved);
  const session = { user_id: "ADMIN", full_name: "Admin User", role: ROLES.ADMIN };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function setRole(role) {
  const names = {
    ADMIN: "Admin User",
    MANAGER: "Manager User",
    OPERATOR: "Warehouse Operator"
  };
  const session = {
    user_id: role,
    full_name: names[role],
    role
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function roleOptions() {
  return Object.values(ROLES);
}
