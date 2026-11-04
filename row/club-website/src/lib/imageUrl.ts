// Photo paths returned by the API are usually relative ("/uploads/banner/abc.jpg")
// and need to be prefixed with the API origin so <Image> can load them.
// Absolute URLs and data: URIs are passed through unchanged.

const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

export function photoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^(https?:|data:)/i.test(path)) return path;
  return `${API_ORIGIN}${path.startsWith("/") ? path : "/" + path}`;
}

/** Absolute URL of the API-generated 1200x630 social-preview card for a project.
 *  Used as og:image / twitter:image on this club site's project page so a link
 *  pasted into a chat app, Facebook, LinkedIn or X unfurls with a preview.
 *  Backed by GET /api/public/projects/{id}/share-image.png (PublicProjectShareController). */
export function projectShareImageUrl(projectId: number, yearId?: number | null): string {
  const q = yearId ? `?yearId=${yearId}` : "";
  return `${API_ORIGIN}/api/public/projects/${projectId}/share-image.png${q}`;
}

// Stable colour from a name — used by the initial-avatar fallback so
// each member's "no photo" tile is visually distinct but consistent.
export function colorFromName(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue}, 35%, 35%)`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0]!.toUpperCase();
  return (parts[0][0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
