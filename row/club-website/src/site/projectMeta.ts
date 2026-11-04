// Search and link-preview metadata for a project page (og:image is the API's 1200x630 share card), so a project
// link pasted into a chat app or social network unfurls with a preview. Used by /project and /projects/[id].

import type { Metadata } from "next";
import { headers } from "next/headers";
import { resolveTenant } from "@/lib/tenant";
import { getProjectDetail } from "@/lib/publicApi";
import { projectShareImageUrl } from "@/lib/imageUrl";

/** Same 200-char word-boundary rule the share API uses for `summary`. */
function shareSummary(description: string | null): string {
  const s = (description ?? "").replace(/\n|\r/g, " ").replace(/\s+/g, " ").trim();
  if (s.length <= 200) return s;
  const cut = s.slice(0, 200);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 100 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.-]+$/, "") + "…";
}

export async function projectMetadata(rawId: string | undefined): Promise<Metadata> {
  try {
    const projectId = parseInt(rawId ?? "", 10);
    if (Number.isNaN(projectId)) return {};
    const host = headers().get("x-tenant-host") || headers().get("host") || "";
    const tenant = await resolveTenant(host);
    if (!tenant) return {};
    const project = await getProjectDetail(tenant.clubId, projectId);
    if (!project) return {};

    const title = project.title?.trim() || "Rotary service project";
    const description = shareSummary(project.description) || `A service project by ${tenant.clubName}.`;
    const image = projectShareImageUrl(projectId, project.yearId);
    return {
      title,
      description,
      openGraph: { type: "article", title, description, images: [{ url: image, width: 1200, height: 630, alt: title }] },
      twitter: { card: "summary_large_image", title, description, images: [image] },
    };
  } catch {
    return {};
  }
}
