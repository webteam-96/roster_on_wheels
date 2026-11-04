// Server-side fetch helpers for the public read-only API.
// All endpoints live under /api/public/club/{clubId}/... and require no auth.

import "server-only";

const API_BASE = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

// Every page fetch goes to the API fresh. User requirement: admin saves must
// reflect on the public site immediately (no 2-minute wait, no 5-second wait).
// Trade-off: ~12x more API hits during sustained traffic, but immediacy wins
// here. Switch back to revalidate + revalidateTag if scaling load becomes the
// pain point.
//
// The `revalidateSeconds` argument is kept for back-compat but ignored.
export async function fetchJson<T>(path: string, _revalidateSeconds = 0): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function apiBase(): string {
  return API_BASE;
}
