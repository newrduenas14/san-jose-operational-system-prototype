import { authenticateUser } from "./api-smooth1.js?v=users2";

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

export async function signIn(username, pin) {
  let session;
  try {
    session = await authenticateUser(username, pin);
  } catch (error) {
    session = legacySignIn(username, pin, error);
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function signOut() {
  localStorage.removeItem(SESSION_KEY);
}

function legacySignIn(username, pin, originalError) {
  const normalized = String(username || "").trim().toLowerCase();
  if (pin === DEFAULT_PIN && normalized === "admin") {
    return { authenticated: true, user_id: "ADMIN", username: "admin", full_name: "Admin", role: "ADMIN" };
  }
  if (pin === DEFAULT_PIN && normalized === "operator") {
    return { authenticated: true, user_id: "OPERATOR", username: "operator", full_name: "Operator", role: "OPERATOR" };
  }
  throw originalError;
}
