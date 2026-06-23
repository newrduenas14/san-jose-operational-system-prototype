import { ROLES } from "./permissions.js";

const SESSION_KEY = "sjops.session";
const DEFAULT_PIN = "1014";

export function getSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    return saved?.authenticated ? saved : null;
  } catch (_error) {
    return null;
  }
}

export function signIn(role, pin) {
  if (pin !== DEFAULT_PIN) throw new Error("That code does not match. Please try again.");
  const normalizedRole = role === ROLES.ADMIN ? ROLES.ADMIN : ROLES.OPERATOR;
  const session = {
    authenticated: true,
    user_id: normalizedRole,
    full_name: normalizedRole === ROLES.ADMIN ? "Admin" : "Operator",
    role: normalizedRole
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function signOut() {
  localStorage.removeItem(SESSION_KEY);
}
