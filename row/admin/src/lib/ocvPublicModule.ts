// PUBLIC OCV "Live Documents" module — the Rotary admin backend at portal.example.org/API.
// Only the public, unauthenticated endpoint is used:
//   GET /api/public/ocv-live-documents?clubId=&yearId=&moduleKey=  -> header + projects[]
// Fetched server-side (no CORS concern; valid TLS). Backed by
// PublicOcvLiveDocumentsController, which reuses the OCV Word report's project loader.

// PROJECTS_API_BASE wins if set; otherwise use the same API base the rest of the app uses
// (NEXT_PUBLIC_API_URL) so LOCAL dev reads the LOCAL API (localhost:5000) and prod reads prod.
const API_BASE = process.env.PROJECTS_API_BASE || process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

export type OcvModuleField = { label: string; value: string };
export type OcvModuleImage = { url: string; caption: string | null };
export type OcvModuleProject = {
  title: string;
  description: string | null;
  fields: OcvModuleField[];
  images: OcvModuleImage[];
};
export type OcvModuleHeader = {
  clubName: string;
  clubDisplayName: string;
  zoneName: string;
  districtNumber: string;
  clubRotaryId: string;
  presidentName: string;
  assistantGovernorName: string;
  yearLabel: string;
  generatedAt: string;
  moduleKey: string;
  moduleLabel: string;
};
export type OcvModuleTable = { headers: string[]; rows: string[][] };
export type OcvNewsletter = {
  title: string | null;
  publishDate: string | null;
  attachmentType: string | null;
  status: string | null;
  url: string;
};

// Discriminated by `kind`: project avenues, the seven table modules, or the newsletter list.
export type OcvModuleData =
  | { kind: "projects"; header: OcvModuleHeader; projects: OcvModuleProject[] }
  | { kind: "table"; header: OcvModuleHeader; table: OcvModuleTable }
  | { kind: "newsletters"; header: OcvModuleHeader; newsletters: OcvNewsletter[] };

/** Fetch one club+year+module's public projects. Returns null on 404 / error (never throws). */
export async function getOcvPublicModule(
  clubId: number,
  yearId: number,
  moduleKey: string,
): Promise<OcvModuleData | null> {
  try {
    const url = `${API_BASE}/api/public/ocv-live-documents?clubId=${clubId}&yearId=${yearId}&moduleKey=${encodeURIComponent(moduleKey)}`;
    const res = await fetch(url, {
      next: { revalidate: 300 },
      // A healthy API answers well inside 8s; an unreachable one must fail fast
      // instead of hanging the server render for its connect timeout.
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as OcvModuleData;
    return data?.header ? data : null;
  } catch {
    return null;
  }
}

/** Absolute backend URL for the module-scoped Word download. In production the public site and
 *  the backend share an origin (portal.example.org + portal.example.org/API), so a plain anchor to
 *  this URL downloads the .docx (the server sends Content-Disposition: attachment). */
export function ocvModuleWordUrl(clubId: number, yearId: number, moduleKey: string): string {
  return `${API_BASE}/api/public/ocv-live-documents/word?clubId=${clubId}&yearId=${yearId}&moduleKey=${encodeURIComponent(moduleKey)}`;
}
