// Client for the District Governors roster. The admin API only exposes DGs
// per-club, so the fan-out + assembly happens server-side in
// src/app/(site)/site-data/district-governors/route.ts; this just fetches that one endpoint.
// Not under /api/* — IIS routes that to the .NET backend in production (see the route file).
//
// Resolves to an empty list on ANY failure — it NEVER throws — so the
// /district-governors page keeps its bundled roster when the API is unavailable.

export type ApiGovernor = {
  districtNumber: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  /** Relative /Documents/... path or absolute http(s) URL. */
  photo: string | null;
};

// Portraits live on the production admin host (the local dev API has no
// Documents folder), so photo URLs always resolve against production.
const PHOTO_BASE = process.env.NEXT_PUBLIC_API_ORIGIN ?? "";
const ALLOWED_PHOTO_HOSTS = ["portal.example.org", "example.org"];

/** Live roster for a Rotary year (omit yearId for the current year). [] on failure. */
export async function getGovernors(yearId?: number): Promise<ApiGovernor[]> {
  try {
    const q = yearId !== undefined ? `?yearId=${yearId}` : "";
    const res = await fetch(`/site-data/district-governors${q}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return [];
    const data: unknown = await res.json();
    return Array.isArray(data) ? (data as ApiGovernor[]) : [];
  } catch {
    return [];
  }
}

/** Absolute portrait URL, or null when missing/on an unconfigured host
 *  (next/image throws on hosts missing from next.config remotePatterns). */
export function governorPhotoUrl(path: string | null): string | null {
  if (!path) return null;
  if (!path.startsWith("http")) return `${PHOTO_BASE}${path}`;
  try {
    const host = new URL(path).hostname.replace(/^www\./, "");
    return ALLOWED_PHOTO_HOSTS.includes(host) ? path : null;
  } catch {
    return null;
  }
}
