const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

/**
 * POSTs to the API's localization service with the signed-in token. Without a token (sign-in and public pages) the
 * service applies the stricter visitor limits.
 */
export function postTranslate(body: { target: string; source?: string; q: string[] }): Promise<Response> {
  let token: string | null = null;
  try {
    token = localStorage.getItem("auth_token");
  } catch {
    /* storage blocked: visitor limits */
  }
  return fetch(`${API_BASE_URL}/api/i18n/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

const VERSION_KEY = "i18n:version";
const CACHE_PREFIXES = ["i18n:dom:", "i18n:mt:"];

/** Drops saved translations when a correction was saved since last time. True when they were dropped. */
export async function dropCacheIfCorrected(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/i18n/memory/version`);
    if (!res.ok) return false;
    const version = String((await res.json()).version);
    const previous = localStorage.getItem(VERSION_KEY);
    localStorage.setItem(VERSION_KEY, version);
    if (previous === null || previous === version) return false;
    Object.keys(localStorage)
      .filter((k) => CACHE_PREFIXES.some((p) => k.startsWith(p)))
      .forEach((k) => localStorage.removeItem(k));
    return true;
  } catch {
    return false; // offline or storage blocked: keep what is saved
  }
}
