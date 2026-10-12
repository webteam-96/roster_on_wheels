// Typed client for the public website-directory endpoints, called through the
// same-origin proxy at /site-data/rotary/* (see src/app/(site)/site-data/rotary/[...path]/route.ts).
// Not /api/* — IIS routes that to the .NET backend in production; see the route file.
// Designed for CLIENT components — the URLs are relative.
//
// Same contract as src/lib/projectStats.ts: every function resolves to an
// empty list on any failure — it NEVER throws — so the /websites page can
// fall back to bundled data when the controller isn't deployed yet.

export type DistrictWebsite = {
  districtId: number;
  districtNumber: string;
  url: string; // canonical https:// URL (custom domain, else platform subdomain)
};

export type ClubWebsite = {
  clubId: number;
  clubName: string;
  city: string | null;
  districtId: number;
  districtNumber: string;
  url: string;
};

const BASE = "/site-data/rotary/website-directory";

/** Fetch + parse JSON; null on any HTTP or network failure. Never throws. */
async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** All live district websites, ordered by district number. */
export async function getDistrictWebsites(): Promise<DistrictWebsite[]> {
  return (await getJson<DistrictWebsite[]>(`${BASE}/districts`)) ?? [];
}

/** All live club websites, optionally scoped to one district. */
export async function getClubWebsites(
  districtId?: number
): Promise<ClubWebsite[]> {
  const query = districtId !== undefined ? `?districtId=${districtId}` : "";
  return (await getJson<ClubWebsite[]>(`${BASE}/clubs${query}`)) ?? [];
}
