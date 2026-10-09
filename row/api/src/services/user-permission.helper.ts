import type { CurrentUser } from "../auth/current-user";

/**
 * Port of UserPermissionHelper.cs. Role checks here are exact and
 * case-insensitive on the split "roles" claim (unlike the substring tests some
 * controllers use, which are ported where they occur).
 */
export const Roles = {
  SuperAdmin: "SuperAdmin",
  Admin: "Admin",
  ZonalCoordinator: "ZonalCoordinator",
  RIDirector: "RIDirector",
  AG: "AG",
  ClubModerator: "ClubModerator",
  Member: "Member",
} as const;

export function getRoles(user: CurrentUser | null | undefined): string[] {
  const claim = user?.findFirst("roles");
  if (!claim || !claim.trim()) return [];
  return claim.split(",").map((r) => r.trim()).filter(Boolean);
}

export const hasRole = (user: CurrentUser | null | undefined, role: string) => getRoles(user).some((r) => r.toLowerCase() === role.toLowerCase());
export const isSuperAdmin = (u: CurrentUser | null | undefined) => hasRole(u, Roles.SuperAdmin);
export const isAdmin = (u: CurrentUser | null | undefined) => hasRole(u, Roles.Admin);
export const isZonalCoordinator = (u: CurrentUser | null | undefined) => hasRole(u, Roles.ZonalCoordinator);
export const isRIDirector = (u: CurrentUser | null | undefined) => hasRole(u, Roles.RIDirector);
export const isAG = (u: CurrentUser | null | undefined) => hasRole(u, Roles.AG);
export const isClubModerator = (u: CurrentUser | null | undefined) => hasRole(u, Roles.ClubModerator);

export const canCrudZone = isSuperAdmin;
export const canCrudDistrict = isSuperAdmin;
export const canCrudClub = isSuperAdmin;
export const canCrudDirectoryMember = isSuperAdmin;
export const canPartialEditDirectoryMember = isAdmin;
export const isOrgStructureReadOnly = (u: CurrentUser | null | undefined) => !isSuperAdmin(u);

export function canCrudModules(user: CurrentUser | null | undefined): boolean {
  const allowed = [Roles.SuperAdmin, Roles.RIDirector, Roles.ZonalCoordinator, Roles.Admin, Roles.AG, Roles.ClubModerator].map((r) => r.toLowerCase());
  return getRoles(user).some((r) => allowed.includes(r.toLowerCase()));
}

export const isMobileLogin = (user: CurrentUser | null | undefined) => (user?.findFirst("loginType") ?? "").toLowerCase() === "mobile";

/** Fields a club/district Admin may not change on someone else's directory entry (camelCase body keys). */
export const DIRECTORY_MEMBER_LOCKED_FIELDS = new Set([
  "secondaryMobileNumber", "rotaryId", "isYouth", "joinedDate", "isPersonalDetailsVisible",
  "fkSecondaryCountryId", "isFamilyDetailsVisible", "primaryLanguage",
]);

/** Fields a member may not change on their own entry from the app. */
export const MOBILE_SELF_EDIT_LOCKED_FIELDS = new Set(["primaryMobileNumber", "rotaryId", "emailId"]);
