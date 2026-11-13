import type {
  RoleScopeDto,
  ZoneScopeDto,
  DistrictScopeDto,
  ClubScopeDto,
} from "./scope";

// Re-export scope types so callers can `import { ClubScopeDto } from "@/types/auth"`
export type { RoleScopeDto, ZoneScopeDto, DistrictScopeDto, ClubScopeDto };

export interface LoginRequest {
  email?: string;
  countryCode?: string;
  mobileNumber?: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  memberName: string;
  email: string;
  memberId: number;
  roles: string[];
  isTemporaryPassword: boolean;
  lastLoginTime: string | null;
  sessionExpiryMinutes: number;
  // Wave 9A: per-role scope data (optional for backward compat with older backend)
  scopedRoles?: RoleScopeDto[];
  accessibleZones?: ZoneScopeDto[];
  accessibleDistricts?: DistrictScopeDto[];
  accessibleClubs?: ClubScopeDto[];
  // Districts where this member is a District Admin with all-clubs access.
  districtClubAccess?: DistrictScopeDto[];
}

export interface LoginAuditLog {
  id: number;
  memberId: number | null;
  memberName: string;
  emailOrMobile: string;
  loginTime: string;
  ipAddress: string | null;
  userAgent: string | null;
  loginStatus: string;
  failureReason: string | null;
}

export interface AuthUser {
  memberId: number;
  name: string;
  email: string;
  roles: string[];
  // Wave 9A: per-role scope data (optional — undefined if older backend or not yet fetched)
  scopedRoles?: RoleScopeDto[];
  accessibleZones?: ZoneScopeDto[];
  accessibleDistricts?: DistrictScopeDto[];
  accessibleClubs?: ClubScopeDto[];
  // Districts where this member is a District Admin with all-clubs access.
  districtClubAccess?: DistrictScopeDto[];
}

export interface ForgotPasswordRequest {
  email?: string;
  countryCode?: string;
  mobileNumber?: string;
}

export interface ResetPasswordRequest {
  token: string;
  newPassword: string;
  confirmPassword: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export interface AssignRoleRequest {
  memberId: number;
  roleId: number;
  clubId?: number;
  /**
   * Year-wise Admin Rights. Both optional: an older caller that sends neither
   * gets the CURRENT year, which is what the server defaults to.
   */
  yearIds?: number[];
  allYears?: boolean;
}

/** One Rotary year as offered by the admin-years pickers. */
export interface AdminYearOption {
  id: number;
  label: string;
  isCurrent: boolean;
}

/** Response of /api/admin/club-admin-years and /api/admin/district-admin-years. */
export interface AdminYearOptions {
  /** Every year, so the picker can show the full list and grey what it must. */
  years: AdminYearOption[];
  /** Years the CALLER may hand on. null means "all of them" (SuperAdmin). */
  grantableYearIds: number[] | null;
  canGrantAllYears: boolean;
  /** Years the TARGET member already holds. */
  heldYearIds: number[];
  heldAllYears: boolean;
  /** Where those held years come from, e.g. "Club President". */
  heldSources: string[];
}

export interface RemoveRoleRequest {
  memberId: number;
  roleId: number;
  clubId?: number;
}
