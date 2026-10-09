// Login announcement audience: "Show to" roles + optional purchase filters.
// Keys must match RotaryApi LoginAnnouncementAudience.RoleKeys / FilterDefs.
export const ALL_ROLES_KEY = "ALL";

export interface LoginAnnouncementRole {
  key: string;
  label: string;
}

export const LOGIN_ANNOUNCEMENT_ROLE_GROUPS: { title: string; roles: LoginAnnouncementRole[] }[] = [
  {
    title: "Login roles",
    roles: [
      { key: "SuperAdmin", label: "SuperAdmin" },
      { key: "RIDirector", label: "RI Director" },
      { key: "ZonalCoordinator", label: "Zonal Coordinator" },
      { key: "ClubAdmin", label: "Club Admin" },
      { key: "DistrictAdmin", label: "District Admin" },
      { key: "AG", label: "Assistant Governor (AG)" },
      { key: "ClubModerator", label: "Club Moderator" },
      { key: "Member", label: "Member" },
      { key: "ClubPresident", label: "Club President" },
      { key: "ClubSecretary", label: "Club Secretary" },
    ],
  },
  {
    title: "Goal Setting roles",
    roles: [
      { key: "RMC", label: "Rotary Membership Co-Ordinator (RMC)" },
      { key: "ARC", label: "Assistant Rotary Co-Ordinator (ARC)" },
      { key: "RPIC", label: "Regional Public Image Co-Ordinator (RPIC)" },
      { key: "ARPIC", label: "Assistant Regional Public Image Co-Ordinator (ARPIC)" },
      { key: "RRFC", label: "Regional Rotary Foundation Co-Ordinator (RRFC)" },
      { key: "ARRFC", label: "Assistant Regional Rotary Foundation Co-Ordinator (ARRFC)" },
    ],
  },
];

export const LOGIN_ANNOUNCEMENT_ROLES: LoginAnnouncementRole[] = LOGIN_ANNOUNCEMENT_ROLE_GROUPS.flatMap((g) => g.roles);

export function loginAnnouncementRoleLabel(key: string): string {
  if (key === ALL_ROLES_KEY) return "All roles";
  return LOGIN_ANNOUNCEMENT_ROLES.find((r) => r.key === key)?.label ?? key;
}

// Role key of the dashboard the user landed on — that role's announcements are shown first in the popup.
export function currentRoleFromPath(pathname: string): string | undefined {
  if (pathname.startsWith("/district-admin-dashboard")) return "DistrictAdmin";
  if (pathname.startsWith("/club-admin-dashboard")) return "ClubAdmin";
  if (pathname.startsWith("/ag-dashboard")) return "AG";
  if (pathname.startsWith("/zonal-dashboard")) return "ZonalCoordinator";
  if (pathname.startsWith("/ri-director")) return "RIDirector";
  if (pathname.startsWith("/club-moderator")) return "ClubModerator";
  if (pathname.startsWith("/settings")) return "SuperAdmin";
  return undefined;
}

// ── Purchase filters ─────────────────────────────────────────────────────────
export type LoginAnnouncementFilterValue = "purchased" | "not_purchased" | "expired";
export type LoginAnnouncementFilters = Partial<Record<string, LoginAnnouncementFilterValue>>;

export interface LoginAnnouncementFilterDef {
  key: string;
  label: string;
  hint: string;
  // Phrases for the plain-English audience summary.
  phrases: Record<LoginAnnouncementFilterValue, string>;
  options: { value: LoginAnnouncementFilterValue; label: string }[];
}

const PURCHASE_OPTIONS: { value: LoginAnnouncementFilterValue; label: string }[] = [
  { value: "purchased", label: "Purchased" },
  { value: "not_purchased", label: "Not purchased" },
];

export const LOGIN_ANNOUNCEMENT_FILTERS: LoginAnnouncementFilterDef[] = [
  {
    key: "clubWebsite",
    label: "Club Website",
    hint: "Checked on the user's club",
    phrases: {
      purchased: "their club has a live website",
      not_purchased: "their club has no live website",
      expired: "their club's website has expired (not renewed)",
    },
    options: [...PURCHASE_OPTIONS, { value: "expired", label: "Expired" }],
  },
  {
    key: "clubDues",
    label: "Club Dues",
    hint: "Club collects dues from members · current Rotary year",
    phrases: {
      purchased: "their club uses Club Dues this year",
      not_purchased: "their club has not set up Club Dues this year",
      expired: "",
    },
    options: PURCHASE_OPTIONS,
  },
  {
    key: "districtDues",
    label: "District Dues",
    hint: "District collects dues from clubs · current Rotary year",
    phrases: {
      purchased: "their district uses District Dues this year",
      not_purchased: "their district has not set up District Dues this year",
      expired: "",
    },
    options: PURCHASE_OPTIONS,
  },
  {
    key: "districtWebsite",
    label: "District Website",
    hint: "Checked on the user's district",
    phrases: {
      purchased: "their district has a website",
      not_purchased: "their district has no website",
      expired: "",
    },
    options: PURCHASE_OPTIONS,
  },
  {
    key: "whatsappCredits",
    label: "WhatsApp Credits",
    hint: "Club credits, or district credits for District Admins / AGs",
    phrases: {
      purchased: "they have WhatsApp credits left",
      not_purchased: "they have no WhatsApp credits",
      expired: "",
    },
    options: PURCHASE_OPTIONS,
  },
  {
    key: "emailCredits",
    label: "Email Credits",
    hint: "Club credits, or district credits for District Admins / AGs",
    phrases: {
      purchased: "they have Email credits left",
      not_purchased: "they have no Email credits",
      expired: "",
    },
    options: PURCHASE_OPTIONS,
  },
];

export function loginAnnouncementFilterLabel(key: string, value: string): string {
  const def = LOGIN_ANNOUNCEMENT_FILTERS.find((f) => f.key === key);
  const option = def?.options.find((o) => o.value === value);
  return `${def?.label ?? key}: ${option?.label ?? value}`;
}

// ── Location filter ──────────────────────────────────────────────────────────
export interface LoginAnnouncementLocations {
  zoneIds: number[];
  districtIds: number[];
  clubIds: number[];
}

export const EMPTY_LOGIN_ANNOUNCEMENT_LOCATIONS: LoginAnnouncementLocations = { zoneIds: [], districtIds: [], clubIds: [] };

// "Zone 4 and Zone 5" / "District 3141, 3142 and 3 more" / "Rotary Club X" / "12 selected clubs".
export function describeLocationSelection(
  locations: LoginAnnouncementLocations,
  names: { zones: Record<number, string>; districts: Record<number, string>; clubs: Record<number, string> },
): string {
  const listNames = (ids: number[], map: Record<number, string>, prefix = "") => {
    const labels = ids.map((id) => `${prefix}${map[id] ?? `#${id}`}`);
    return labels.length > 4 ? `${labels.slice(0, 4).join(", ")} and ${labels.length - 4} more` : joinWithAnd(labels);
  };
  if (locations.clubIds.length > 0) {
    return locations.clubIds.length <= 2
      ? listNames(locations.clubIds, names.clubs)
      : `${locations.clubIds.length} selected clubs`;
  }
  if (locations.districtIds.length > 0) return listNames(locations.districtIds, names.districts, "District ");
  if (locations.zoneIds.length > 0) return listNames(locations.zoneIds, names.zones);
  return "";
}

// Plain-English summary, e.g. "Shows to Club Admin in Zone 4, only where their club has no live website."
export function describeLoginAnnouncementAudience(roles: string[], filters: LoginAnnouncementFilters, locationPhrase?: string): string {
  const who = roles.length === 0
    ? "nobody yet — select at least one role"
    : roles.includes(ALL_ROLES_KEY)
      ? "everyone who logs in (except Family Login)"
      : joinWithAnd(roles.map(loginAnnouncementRoleLabel));
  const where = locationPhrase ? ` in ${locationPhrase}` : "";
  const conditions = LOGIN_ANNOUNCEMENT_FILTERS
    .filter((f) => filters[f.key])
    .map((f) => f.phrases[filters[f.key] as LoginAnnouncementFilterValue])
    .filter(Boolean);
  return conditions.length === 0
    ? `Shows after login to ${who}${where}.`
    : `Shows after login to ${who}${where}, only where ${joinWithAnd(conditions)}.`;
}

function joinWithAnd(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
