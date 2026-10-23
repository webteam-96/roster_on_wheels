/**
 * POSTs to the admin's translate route (app/api/i18n/translate) with the signed-in token, so the route applies
 * the signed-in limits. Without a token (sign-in and public pages) the route applies the stricter visitor limits.
 */
export function postTranslate(body: { target: string; source?: string; q: string[] }): Promise<Response> {
  let token: string | null = null;
  try {
    token = localStorage.getItem("auth_token");
  } catch {
    /* storage blocked: visitor limits */
  }
  return fetch("/api/i18n/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}
