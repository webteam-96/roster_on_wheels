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
  /**
   * Year-wise Admin Rights, sent by /my-context. Both may be absent when the
   * server predates the feature — treat that as "no restriction" so an older
   * API never locks anyone out. See canEditYear().
   */
  allYears?: boolean;
  yearIds?: number[];
  yearSources?: string[];
  /**
   * Is the year rule itself switched ON for this assignment's scope?
   * (Settings -> Year-wise Admin Rights.) Different question from allYears,
   * which says only WHICH years. Absent on a server that predates the switch --
   * treat that as ON, which is how the platform behaved before it existed.
   * See isCurrentYearSelected().
   */
  yearRuleEnabled?: boolean;
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
