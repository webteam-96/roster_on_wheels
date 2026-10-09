export type LinkType = "page" | "external" | "document" | "html";

export const LINK_TYPES = [
  { value: "page" as const, label: "Page" },
  { value: "external" as const, label: "External Link" },
  { value: "document" as const, label: "Document" },
  { value: "html" as const, label: "Rich-Text Page" },
] as const;

export interface ClubMenu {
  id: number;
  clubId: number;
  menuName: string;
  linkType: LinkType;
  linkValue: string;
  contentHtml?: string | null;
  sortOrder: number;
  isActive: boolean;
  subMenuCount: number;
  isDefault?: boolean;
}

// The seeded Home menu is always on: it can't be edited, deleted or switched inactive
// (the other default menus can be switched inactive). API enforces the same rule.
export const isHomeMenu = (m: Pick<ClubMenu, "isDefault" | "linkValue">): boolean =>
  !!m.isDefault && (m.linkValue ?? "").trim().toLowerCase() === "home";

export interface ClubSubMenu {
  id: number;
  menuId: number;
  subMenuName: string;
  linkType: LinkType;
  linkValue: string;
  sortOrder: number;
  isActive: boolean;
  // True for the 6 avenue sub-menus auto-seeded under Projects. Locked from
  // delete/edit in admin UI; API also rejects mutation attempts on these.
  isSystemManaged?: boolean;
}

export interface CreateClubMenuRequest {
  menuName: string;
  linkType: string;
  linkValue: string;
  contentHtml?: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface UpdateClubMenuRequest {
  menuName: string;
  linkType: string;
  linkValue: string;
  contentHtml?: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface CreateClubSubMenuRequest {
  subMenuName: string;
  linkType: string;
  linkValue: string;
  sortOrder: number;
  isActive: boolean;
}

export interface UpdateClubSubMenuRequest {
  subMenuName: string;
  linkType: string;
  linkValue: string;
  sortOrder: number;
  isActive: boolean;
}
