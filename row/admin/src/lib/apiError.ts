const FALLBACK = "Something went wrong. Please try again.";

/**
 * Pages show `err.response.data.message || err.response.data || "..."`. An ASP.NET validation error has no `message`, so
 * they would hand React the whole object and crash. This gives every such error a text message before any page sees it.
 */
export function ensureErrorMessage(error: unknown): void {
  const response = (error as { response?: { data?: unknown } } | null)?.response;
  const data = response?.data;
  if (!response || data === null || typeof data !== "object") return;
  if (Object.getPrototypeOf(data) !== Object.prototype) return; // Blob or ArrayBuffer from a file download
  const body = data as { message?: unknown; title?: unknown; errors?: unknown };
  if (typeof body.message === "string" && body.message) return;

  let first: unknown;
  if (body.errors && typeof body.errors === "object") {
    const value = Object.values(body.errors as Record<string, unknown>)[0];
    first = Array.isArray(value) ? value[0] : value;
  }
  body.message = typeof first === "string" && first ? first : typeof body.title === "string" && body.title ? body.title : FALLBACK;
}
