// The JWT lives in sessionStorage (per-tab, cleared when the tab closes) — deliberately NOT
// localStorage, so a token never outlives the browser session.
const TOKEN_KEY = "assistant_token";

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage unavailable — nothing to clear
  }
}
