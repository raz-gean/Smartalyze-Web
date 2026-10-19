import { clearEditDrafts } from "./editDraft";

const AUTH_TOKEN_KEY = "smartalyze_auth_token";

export function getStoredToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  window.localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function clearStoredToken(): void {
  window.localStorage.removeItem(AUTH_TOKEN_KEY);
}

/** Deliberate sign-out: also drop unsaved editor drafts so a shared computer keeps no data.
 *  (An expired session only calls clearStoredToken, so the user's draft survives re-login.) */
export function signOut(): void {
  clearStoredToken();
  clearEditDrafts();
}
