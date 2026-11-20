// Website builder helpers (pages and layout for club and district sites). Pure, so they are unit-tested.
import type { WebsiteSection, WebsiteSectionType } from "@/services/api";

export const HOME_SLUG = "home";

/** What an admin can add to a page, in the order the picker shows them. */
export const SECTION_TYPES: { type: WebsiteSectionType; label: string; hint: string }[] = [
  { type: "richtext", label: "Rich text", hint: "Headings, text, links and pictures" },
  { type: "image", label: "Picture", hint: "One picture from the media library" },
  { type: "embed", label: "Video or map", hint: "YouTube, Vimeo or Google Maps" },
  { type: "file", label: "File", hint: "A document or picture to open or download" },
  { type: "events", label: "Upcoming events", hint: "From the club calendar" },
  { type: "officers", label: "Officers", hint: "Board of directors for the year" },
  { type: "news", label: "News", hint: "Latest newsletters" },
  { type: "projects", label: "Projects", hint: "Service projects of the year" },
  { type: "gallery", label: "Gallery", hint: "Latest photos" },
  { type: "sponsors", label: "Sponsors", hint: "Advertisements and sponsors" },
  { type: "contact", label: "Contact form", hint: "Enquiries go to the prospects list" },
];

export const DATA_WIDGETS: WebsiteSectionType[] = ["events", "officers", "news", "projects", "gallery", "sponsors"];

export function sectionLabel(type: WebsiteSectionType): string {
  return SECTION_TYPES.find((t) => t.type === type)?.label ?? type;
}

export function newSection(type: WebsiteSectionType, seed: number = Date.now()): WebsiteSection {
  const id = `s${seed.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  return DATA_WIDGETS.includes(type) ? { id, type, title: sectionLabel(type), limit: 6 } : { id, type, title: "" };
}

/** Moves the item at `from` to index `to`; out-of-range moves return the list unchanged. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** "Our History!" -> "our-history" (same rule the API enforces: a-z, 0-9, single hyphens, max 60). */
export function slugify(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

export const isValidSlug = (s: string): boolean => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s) && s.length <= 60;

export const isImageMedia = (m: { contentType: string | null; fileName: string }): boolean =>
  (m.contentType ?? "").startsWith("image/") || /\.(jpe?g|png|gif|webp)$/i.test(m.fileName);

/**
 * Which library items a picker may offer. Rich text embeds a plain URL, so only public pictures; a picture section
 * takes any picture (members-only ones show to signed-in members only); a file section takes anything.
 */
export function pickable<T extends { contentType: string | null; fileName: string; membersOnly: boolean }>(
  items: T[], into: "image" | "richtext" | "file",
): T[] {
  if (into === "file") return items;
  return items.filter((m) => isImageMedia(m) && (into === "image" || !m.membersOnly));
}

/** Where a published custom page lives on the public site; menus link here. */
export const pagePath = (slug: string): string => `/p/${slug}`;

/** The menu builder's "Page" options for published custom pages (home layout excluded: it is the site's home). */
export function customPageMenuOptions(pages: { slug: string; title: string; isPublished: boolean }[]): { value: string; label: string }[] {
  return pages
    .filter((p) => p.isPublished && p.slug !== HOME_SLUG)
    .map((p) => ({ value: pagePath(p.slug), label: `Custom page: ${p.title}` }));
}
