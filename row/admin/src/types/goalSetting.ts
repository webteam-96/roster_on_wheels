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
  achievedAsOn?: string | null; // "31 Aug 2026" = latest month with month-wise data; null → "as on July 1st"
  fields: GoalFieldWithValueDto[];
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

export interface GoalDistrictSummaryDto {
  districtId: number;
  districtNumber: string;
  zoneId: number;
  zoneName: string | null;
  hasAnyGoalSet: boolean;
  lastUpdatedDate: string | null;
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
  // District this message is about (0 = "All districts"). Zone-wide → 0.
  districtId?: number;
  districtNumber?: string | null;
  // District Admin / DG messages (2026-10-09): the category they are about.
  categoryName?: string | null;
}

// District Admin / District Governor messages to the Super Admin (2026-10-09). Read-only above.
export interface GoalDistrictMessagesDto {
  districtId: number;
  districtNumber: string | null;
  categoryId: number;
  categoryName: string;
  canPost: boolean;            // the viewer is this district's Admin / DG
  posterRole: string | null;   // "District Admin" | "District Governor"
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

// ── Foundation benchmark import (SuperAdmin, cumulative till-date) ───────────
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
