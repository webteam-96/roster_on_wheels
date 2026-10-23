// Live projects API — the Rotary admin backend at portal.example.org/API.
// Only the public, unauthenticated endpoints are used:
//   GET /api/public/projects/{id}  -> full project detail + photos
// Fetched server-side (no CORS concern; valid TLS).

const API_BASE = process.env.PROJECTS_API_BASE || process.env.NEXT_PUBLIC_API_ORIGIN || "";

export type ProjectPhoto = { imagePath: string; description: string | null; isPrimary: boolean };

export type Project = {
  id: number;
  title: string;
  description: string | null;
  projectDate: string | null;
  projectCost: number | null;
  currency?: string | null;
  directBeneficiaries: number | null;
  manHours: number | null;
  rotariansInvolved: number | null;
  rotaractorsInvolved: number | null;
  rccInvolved: number | null;
  location: string | null;
  areaOfFocus: string | null;
  funding: string | null;
  clubId: number;
  clubName: string | null;
  clubRotaryId: string | null;
  clubCity: string | null;
  clubState: string | null;
  districtNumber: string | null;
  zoneName: string | null;
};

export type ProjectDetail = { project: Project; photos: ProjectPhoto[]; officers: unknown[] };

/** Absolute URL for a project photo served by the API. */
export function photoUrl(imagePath: string): string {
  if (imagePath.startsWith("http")) return imagePath;
  return `${API_BASE}/${imagePath.replace(/^\//, "")}`;
}

/** Absolute URL of the API-generated 1200x630 social-preview card for a project.
 *  Used as the og:image / twitter:image on the public project page so a pasted link
 *  unfurls with a preview in messaging and social apps.
 *  Backed by GET /api/public/projects/{id}/share-image.png (PublicProjectShareController). */
export function shareImageUrl(id: number, yearId?: number): string {
  const q = yearId ? `?yearId=${yearId}` : "";
  return `${API_BASE}/api/public/projects/${id}/share-image.png${q}`;
}

/** Fetch one project's full detail. Returns null on 404 / error.
 *  yearId disambiguates: project ids repeat across year tables, and without it
 *  the API returns the first id match from ANY year — a different project. */
export async function getProject(id: number, yearId?: number): Promise<ProjectDetail | null> {
  try {
    const res = await fetch(`${API_BASE}/api/public/projects/${id}${yearId ? `?yearId=${yearId}` : ""}`, {
      next: { revalidate: 3600 },
      // A healthy API answers well inside 5s; an unreachable one must fail
      // fast instead of hanging the server render for its connect timeout.
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as ProjectDetail;
    return data?.project ? data : null;
  } catch {
    return null;
  }
}
