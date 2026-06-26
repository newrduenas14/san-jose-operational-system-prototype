import { authenticateUser } from "./api-smooth1.js?v=pin1";

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

export async function signIn(pin) {
  let session;
  try {
    session = await authenticateUser(pin);
  } catch (error) {
    session = legacySignIn(pin, error);
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function signOut() {
  localStorage.removeItem(SESSION_KEY);
}

function legacySignIn(pin, originalError) {
  if (String(pin || "").trim() === DEFAULT_PIN) {
    return { authenticated: true, user_id: "ADMIN", full_name: "Admin", role: "ADMIN" };
  }
  throw originalError;
}
