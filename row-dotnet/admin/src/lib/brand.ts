// ROW instance brand for the web apps. Everything that identifies the deployment
// (domains, contacts) comes from NEXT_PUBLIC_* environment variables set per build;
// empty means "not configured" and the UI hides the link or line that needs it.

export const BRAND = {
  productName: "Roster On Wheels",
  shortName: "ROW",
  /** Admin portal origin, e.g. "https://portal.example.org". */
  portalOrigin: (process.env.NEXT_PUBLIC_PORTAL_ORIGIN ?? "").replace(/\/$/, ""),
  /** Public API origin, e.g. "https://portal.example.org/API". */
  apiOrigin: (process.env.NEXT_PUBLIC_API_ORIGIN ?? process.env.PROJECTS_API_BASE ?? "").replace(/\/$/, ""),
  /** Parent domain of club websites, e.g. "clubs.example.org". */
  clubSiteParentDomain: process.env.NEXT_PUBLIC_CLUB_SITE_PARENT_DOMAIN ?? "",
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "",
  supportPhone: process.env.NEXT_PUBLIC_SUPPORT_PHONE ?? "",
  supportHours: process.env.NEXT_PUBLIC_SUPPORT_HOURS ?? "",
  legalName: process.env.NEXT_PUBLIC_LEGAL_NAME ?? "",
} as const;
