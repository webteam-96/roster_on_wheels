// Mirrors RotaryApi/DTOs/GoalSettingDtos.cs exactly — keep in sync.

export interface GoalCategoryDto {
  id: number;
  name: string;
  sortOrder: number;
}

export interface GoalFieldWithValueDto {
  fieldId: number;
  groupName: string;
  fieldKey: string;
  fieldLabel: string;
  dataType: "Integer" | "Decimal" | "Percentage" | "Currency" | "Boolean" | "Text";
  unit: string | null;
  fieldRole: "Reference" | "Target" | "Computed";
  numericValue: number | null;
  textValue: string | null;
  boolValue: boolean | null;
  // Lowest value this field may be saved with (the existing figure of the same metric); null = none,
  // so 0 is legal. Computed server-side so the UI blocks exactly what the API refuses.
  minValue?: number | null;
}

export interface GoalEntrySaveDto {
  fieldId: number;
  numericValue: number | null;
  textValue: string | null;
  boolValue: boolean | null;
}

export interface SaveGoalEntriesRequest {
  yearId: number;
  entries: GoalEntrySaveDto[];
}

export interface GoalCategoryFormDto {
  categoryId: number;
  categoryName: string;
  entityType: "Club" | "District";
  clubId: number | null;
  districtId: number | null;
  entityName: string;
  yearId: number;
  yearLabel: string;
  isEditable: boolean;
  isLocked: boolean;
  lockedByName: string | null;
  lockedDate: string | null;
  canLock: boolean;
  achievedAsOn?: string | null; // "31 Aug 2026" = latest month with month-wise data; null → "as on July 1st"
  fields: GoalFieldWithValueDto[];
}

export interface GoalClubSummaryDto {
  clubId: number;
  clubName: string;
  hasAnyGoalSet: boolean;
  lastUpdatedDate: string | null;
  lastUpdatedBy: string | null;
  isLocked: boolean;
}

export interface GoalLockStatusDto {
  isLocked: boolean;
  lockedByName: string | null;
  lockedDate: string | null;
}

// Read-only "View club goals" matrix: all clubs × one category's fields (+ per-club RAG).
export interface GoalMatrixColumnDto {
  fieldKey: string;
  fieldLabel: string;
  groupName: string;
  dataType: string;
  unit: string | null;
}

export interface GoalMatrixRowDto {
  clubId: number;
  clubName: string;
  rag: "Red" | "Amber" | "Green" | "SuperGreen" | "None";
  memberCount: number;
  values: Record<string, string | null>;
}

// SuperAdmin "Observe as" list entry (RI Directors + Zone Coordinators). Gated to the observer.
export interface GoalObserverRoleDto {
  memberId: number;
  memberName: string;
  roleType: string;   // AllCategoryAllDistrictsFewZones | AllDistrictsOneCategoryOneZone
  roleLabel: string;  // "RI Director" | "Zone Co-ordinator"
  zoneNames: string;
  categoryName: string | null;
}

export interface GoalClubMatrixDto {
  categoryId: number;
  categoryName: string;
  yearId: number;
  yearLabel: string;
  columns: GoalMatrixColumnDto[];
  clubs: GoalMatrixRowDto[];
}

// ── Goal-oversight dashboard: districts = rows, compact Target/Achieved/% per category ──
// ragBand set ("Red" | "Amber" | "Green" | "SuperGreen") → the metric is ONE coloured column holding a
// club count in `value`, not the usual baseline/target/achieved/% block.
export interface GoalSummaryMetricDto { groupName: string; baselineLabel: string; ragBand?: string | null; singleValue?: boolean; hasBaseline?: boolean; notSummable?: boolean; }
export interface GoalSummaryCellDto { asOnJul1: string | null; target: string | null; achieved: string | null; pct: string | null; value?: string | null; }
export interface GoalSummaryCategoryDto { categoryId: number; name: string; metrics: GoalSummaryMetricDto[]; totals: GoalSummaryCellDto[]; }
export interface GoalSummaryDistrictRowDto { districtId: number; districtNumber: string; cells: Record<number, GoalSummaryCellDto[]>; }
export interface GoalDistrictSummaryMatrixDto {
  zoneId: number; zoneName: string; yearId: number; yearLabel: string;
  categories: GoalSummaryCategoryDto[];
  districts: GoalSummaryDistrictRowDto[];
}

// ── Month-wise "all clubs" matrix (clubs = rows, months = columns) ──
export interface GoalMonthPeriodDto {
  month: number;        // 7..12 then 1..6
  label: string;        // "Jul", "Aug" …
  calendarYear: number;
  isAvailable: boolean;
}
export interface GoalMatrixMonthlyFieldDto {
  fieldKey: string;
  groupName?: string;   // "Total Members", "Annual Fund" … — labels repeat, the group tells them apart
  fieldLabel: string;
  unit: string | null;
}
export interface GoalClubMonthlyRowDto {
  clubId: number;
  clubName: string;
  values: Record<string, Record<number, string | null>>; // fieldKey -> (month -> value)
  totals: Record<string, string | null>;                 // fieldKey -> total
}
export interface GoalClubMonthlyMatrixDto {
  categoryId: number;
  categoryName: string;
  yearId: number;
  yearLabel: string;
  months: GoalMonthPeriodDto[];
  fields: GoalMatrixMonthlyFieldDto[];
  clubs: GoalClubMonthlyRowDto[];
}

export type GoalRoleType =
  | "FewDistrictsOneCategoryOneZone"
  | "AllDistrictsOneCategoryOneZone"
  | "AllCategoryAllDistrictsFewZones";

export interface GoalRoleAssignmentDto {
  id: number;
  memberId: number;
  memberName: string;
  roleType: GoalRoleType;
  assignmentName: string;
  categoryId: number | null;
  categoryName: string | null;
  zoneId: number | null;
  zoneName: string | null;
  districtIds: number[];
  districtNumbers: string[];
  zoneIds: number[];
  zoneNames: string[];
  isActive: boolean;
  assignedDate: string | null;
  // When this holder was last sent their role email ("emailed on …"). Null = never emailed.
  roleEmailSentDate?: string | null;
  // Zonal-leadership hierarchy overlay (optional/additive).
  roleTitle?: string | null;
  avenue?: string | null;
  homeDistrictId?: number | null;
  homeDistrictNumber?: string | null;
  dgYear?: string | null;
  supportingText?: string | null;
}

export interface CreateGoalRoleAssignmentRequest {
  memberId: number;
  memberNameText?: string | null;
  roleType: GoalRoleType;
  assignmentName: string;
  categoryId?: number | null;
  zoneId?: number | null;
  districtIds?: number[] | null;
  zoneIds?: number[] | null;
  // Zonal-leadership hierarchy overlay.
  roleTitle?: string | null;
  avenue?: string | null;
  homeDistrictId?: number | null;
  dgYear?: string | null;
  supportingText?: string | null;
}

// Extensible leadership-designation catalog (RMC, ARC, RPIC …).
export interface GoalDesignationDto {
  id: number;
  title: string;
  avenue: string;
  roleType: GoalRoleType;
  defaultCategoryName?: string | null;
  defaultCategoryId?: number | null;
  sortOrder: number;
}

export interface CreateGoalDesignationRequest {
  title: string;
  avenue: string;
  roleType: GoalRoleType;
  defaultCategoryName?: string | null;
}

export interface GoalMyAssignmentDto {
  assignmentId: number;
  roleType: GoalRoleType;
  assignmentName: string;
  categoryIds: number[];
  districtIds: number[];
  zoneIds: number[];
  canBulkLock: boolean;
}

export interface GoalDistrictSummaryDto {
  districtId: number;
  districtNumber: string;
  zoneId: number;
  zoneName: string | null;
  hasAnyGoalSet: boolean;
  lastUpdatedDate: string | null;
  isLocked: boolean;
}

export interface GoalBulkLockRequest {
  yearId: number;
  categoryIds?: number[] | null;
  zoneIds?: number[] | null;
  locked: boolean;
}

export interface GoalBulkLockResultDto {
  affectedCount: number;
}

export interface GoalCommentDto {
  id: number;
  commentText: string;
  postedByMemberId: number;
  postedByName: string;
  postedByTier: number;
  createdDate: string | null;
  // Chat-UI extras.
  postedByRoleLabel?: string | null;
  isMine?: boolean;
  // District this message is about (DA tags each message; 0 = "All districts"). Zone-wide → 0.
  districtId?: number;
  districtNumber?: string | null;
  // District Admin / DG messages (2026-10-09): the category they are about.
  categoryName?: string | null;
}

// District Admin / District Governor messages to the oversight chain (2026-10-09). Read-only above.
export interface GoalDistrictMessagesDto {
  districtId: number;
  districtNumber: string | null;
  categoryId: number;
  categoryName: string;
  canPost: boolean;            // the viewer is this district's Admin / DG
  posterRole: string | null;   // "District Admin" | "District Governor"
  notice: string | null;
  messages: GoalCommentDto[];
}

export interface GoalDistrictConversationDto {
  districtId: number;
  districtNumber: string | null;
  categoryId: number;
  categoryName: string;
  messageCount: number;
  unreadCount: number;
  lastFrom: string | null;
  lastFromRole: string | null;
  lastPreview: string | null;
  lastDate: string | null;
}

export interface GoalMessageDistrictDto {
  id: number;
  number: string;
}

export interface GoalMessageOwnerDto {
  memberId: number;
  categoryId: number;
  name: string;
  roleLabel: string;
  categoryName: string;
  districts?: string | null;
  isFormer?: boolean;   // no longer holds the seat - old conversation, read-only
  messageCount: number;
  unreadCount: number;
}

export interface GoalMessageRowDto {
  id: number;
  categoryId: number;
  categoryName: string;
  districtId: number;       // 0 = zone-wide / all districts
  districtNumber?: string | null;
  fromName: string;
  roleLabel: string;
  postedByTier: number;
  message: string;
  createdDate?: string | null;
}

// ── Foundation benchmark import (SuperAdmin, cumulative till-date) ───────────
export interface GoalMessageThreadDto {
  ownerMemberId: number;
  ownerName: string;
  ownerRoleLabel: string;
  scope: string | null;
  isMine: boolean;
  lastMessagePreview: string | null;
  lastMessageDate: string | null;
  messageCount: number;
  // Messages in THIS conversation the viewer has not read yet, written by somebody else.
  unreadCount: number;
  // No longer holds a seat here - the old conversation stays readable (read-only).
  isFormer?: boolean;
  counterpartyName: string | null;
  canPost: boolean;
  notice: string | null;
}

export interface GoalThreadListDto {
  viewerRole: "RIDirector" | "ZoneCoordinator" | "DistrictAssistant" | "SuperAdmin" | "None";
  threads: GoalMessageThreadDto[];
  // District Assistant viewer: their covered districts for the "message about which district" picker.
  ownerDistricts?: GoalMessageDistrictDto[];
  // Only true for the gated observer SuperAdmin: click any ZC/DA box to post AS that person.
  canObservePost?: boolean;
}

export interface GoalFoundationImportSkippedRowDto {
  row: number;
  districtNumber: string;
  clubNo: string;
  clubName: string;
  reason: string;
}

export interface GoalFoundationImportResultDto {
  yearId: number;
  importedDistricts: number;
  valuesWritten: number;
  skippedRows: GoalFoundationImportSkippedRowDto[];
  message: string;
}

// ── SuperAdmin read-only Overview matrix (one zone × one category × one year) ────
export interface GoalOverviewDistrictDto {
  districtId: number;
  districtNumber: string;
}

export interface GoalOverviewCellDto {
  districtId: number;
  total: string | null;
  target: string | null;
  achieved: string | null;
}

export interface GoalOverviewRowDto {
  metricKey: string;
  groupName: string;
  label: string;
  dataType: string;
  unit: string | null;
  hasReference: boolean;
  hasTarget: boolean;
  hasAchieved: boolean;
  cells: GoalOverviewCellDto[];
}

export interface GoalOverviewMatrixDto {
  zoneId: number;
  zoneName: string;
  categoryId: number;
  categoryName: string;
  yearId: number;
  yearLabel: string;
  districts: GoalOverviewDistrictDto[];
  rows: GoalOverviewRowDto[];
}
