// Scope DTOs returned by /api/auth/login and /api/auth/my-context
// Shared between web and mobile auth flows (Wave 9A backend).

export type RoleScopeKind = "global" | "zone" | "district" | "club";

export interface RoleScopeDto {
  roleName: string; // "Admin" | "AG" | "SuperAdmin" | "Member"
  scope: string;    // RoleScopeKind values (string-typed for backward/forward compat)
  zoneId?: number;
  zoneName?: string;
  districtId?: number;
  districtNumber?: string;
  clubId?: number;
  clubName?: string;
}

export interface ZoneScopeDto {
  id: number;
  name: string;
}

export interface DistrictScopeDto {
  id: number;
  number: string;
  zoneId?: number;
  totalClubs?: number;
  totalMembers?: number;
  isSynced?: boolean; // has >=1 Rotary.org-synced club — gates Goal Setting in the sidebar
}

export interface ClubScopeDto {
  id: number;
  name: string;
  districtId?: number;
  totalMembers?: number;
  isSynced?: boolean; // IsSyncedFromRotaryOrg — gates Goal Setting in the sidebar
}
