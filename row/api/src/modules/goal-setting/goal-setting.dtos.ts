/**
 * Port of DTOs/GoalSettingDtos.cs. These are built in code, not mapped from rows, so they are
 * plain shapes with the JSON (camelCase) property names the C# serializer produces.
 * Dictionary<int, T> becomes Record<number, T> (JSON object with numeric string keys, as in .NET).
 */
export interface GoalCategoryDto { id: number; name: string; sortOrder: number; hasMonthWise: boolean }

export interface GoalFieldWithValueDto {
  fieldId: number; groupName: string; fieldKey: string; fieldLabel: string; dataType: string; unit: string | null; fieldRole: string;
  numericValue: number | null; textValue: string | null; boolValue: boolean | null; minValue: number | null;
}

export interface GoalEntrySaveDto { fieldId: number; numericValue: number | null; textValue: string | null; boolValue: boolean | null }
export interface SaveGoalEntriesRequest { yearId: number; entries: GoalEntrySaveDto[] }

export interface GoalCategoryFormDto {
  categoryId: number; categoryName: string; entityType: string; clubId: number | null; districtId: number | null; entityName: string;
  yearId: number; yearLabel: string; isEditable: boolean; isLocked: boolean; lockedByName: string | null; lockedDate: string | null;
  canLock: boolean; achievedAsOn: string | null; fields: GoalFieldWithValueDto[];
}

export interface GoalClubSummaryDto { clubId: number; clubName: string; hasAnyGoalSet: boolean; lastUpdatedDate: string | null; lastUpdatedBy: string | null; isLocked: boolean }

export interface GoalMatrixColumnDto { fieldKey: string; fieldLabel: string; groupName: string; dataType: string; unit: string | null }
export interface GoalMatrixRowDto { clubId: number; clubName: string; rag: string; memberCount: number; values: Record<string, string | null> }
export interface GoalClubMatrixDto { categoryId: number; categoryName: string; yearId: number; yearLabel: string; columns: GoalMatrixColumnDto[]; clubs: GoalMatrixRowDto[] }

export interface GoalMonthPeriodDto { month: number; label: string; calendarYear: number; isAvailable: boolean }
export interface GoalMatrixMonthlyFieldDto { fieldKey: string; groupName: string; fieldLabel: string; unit: string | null }
export interface GoalClubMonthlyRowDto { clubId: number; clubName: string; values: Record<string, Record<number, string | null>>; totals: Record<string, string | null> }
export interface GoalClubMonthlyMatrixDto {
  categoryId: number; categoryName: string; yearId: number; yearLabel: string;
  months: GoalMonthPeriodDto[]; fields: GoalMatrixMonthlyFieldDto[]; clubs: GoalClubMonthlyRowDto[];
}

export interface GoalObserverRoleDto { memberId: number; memberName: string; roleType: string; roleLabel: string; zoneNames: string; categoryName: string | null }
export interface GoalLockStatusDto { isLocked: boolean; lockedByName: string | null; lockedDate: string | null }

export interface GoalRoleAssignmentDto {
  id: number; memberId: number; memberName: string; roleType: string; assignmentName: string;
  categoryId: number | null; categoryName: string | null; zoneId: number | null; zoneName: string | null;
  districtIds: number[]; districtNumbers: string[]; zoneIds: number[]; zoneNames: string[];
  isActive: boolean; assignedDate: string | null; roleEmailSentDate: string | null;
  roleTitle: string | null; avenue: string | null; homeDistrictId: number | null; homeDistrictNumber: string | null; dgYear: string | null; supportingText: string | null;
}
export interface CreateGoalRoleAssignmentRequest {
  memberId: number; memberNameText: string | null; roleType: string; assignmentName: string; categoryId: number | null; zoneId: number | null;
  districtIds: number[] | null; zoneIds: number[] | null; roleTitle: string | null; avenue: string | null; homeDistrictId: number | null; dgYear: string | null; supportingText: string | null;
}
export interface AddGoalRoleHolderRequest { memberId: number; memberNameText: string | null }
export interface ChangeGoalRoleAssignmentRequest { memberId: number; memberNameText: string | null; zoneIds: number[] | null; zoneId: number | null; districtIds: number[] | null }

export interface GoalDesignationDto { id: number; title: string; avenue: string; roleType: string; defaultCategoryName: string | null; defaultCategoryId: number | null; sortOrder: number }
export interface CreateGoalDesignationRequest { title: string; avenue: string; roleType: string; defaultCategoryName: string | null }
export interface GoalZoneMemberDto { id: number; memberName: string; emailId: string; primaryMobileNumber: string; clubName: string | null; districtNumber: string | null }
export interface GoalMyAssignmentDto { assignmentId: number; roleType: string; assignmentName: string; categoryIds: number[]; districtIds: number[]; zoneIds: number[]; canBulkLock: boolean }
export interface GoalDistrictSummaryDto { districtId: number; districtNumber: string; zoneId: number; zoneName: string | null; hasAnyGoalSet: boolean; lastUpdatedDate: string | null; isLocked: boolean }
export interface GoalBulkLockRequest { yearId: number; categoryIds: number[] | null; zoneIds: number[] | null; locked: boolean }
export interface GoalBulkLockResultDto { affectedCount: number }

export interface GoalCommentDto {
  id: number; commentText: string; postedByMemberId: number; postedByName: string; postedByTier: number; createdDate: string | null;
  postedByRoleLabel: string | null; isMine: boolean; districtId: number; districtNumber: string | null; categoryName: string | null;
}
export interface GoalDistrictMessagesDto {
  districtId: number; districtNumber: string | null; categoryId: number; categoryName: string; canPost: boolean; posterRole: string | null; notice: string | null; messages: GoalCommentDto[];
}
export interface GoalDistrictConversationDto {
  districtId: number; districtNumber: string | null; categoryId: number; categoryName: string; messageCount: number; unreadCount: number;
  lastFrom: string | null; lastFromRole: string | null; lastPreview: string | null; lastDate: string | null;
}
export interface GoalMessageDistrictDto { id: number; number: string }
export interface GoalMessageOwnerDto {
  memberId: number; categoryId: number; name: string; roleLabel: string; categoryName: string; districts: string | null; isFormer: boolean; messageCount: number; unreadCount: number;
}
export interface GoalMessageRowDto {
  id: number; categoryId: number; categoryName: string; districtId: number; districtNumber: string | null; fromName: string; roleLabel: string; postedByTier: number; message: string; createdDate: string | null;
}
export interface GoalMessageThreadDto {
  ownerMemberId: number; ownerName: string; ownerRoleLabel: string; scope: string | null; isMine: boolean; lastMessagePreview: string | null; lastMessageDate: string | null;
  messageCount: number; unreadCount: number; isFormer: boolean; counterpartyName: string | null; canPost: boolean; notice: string | null;
}
export interface GoalThreadListDto { viewerRole: string; threads: GoalMessageThreadDto[]; ownerDistricts: GoalMessageDistrictDto[]; canObservePost: boolean }
export interface PostGoalCommentRequest { commentText: string }

export interface GoalFoundationImportSkippedRowDto { row: number; districtNumber: string; clubNo: string; clubName: string; reason: string }
export interface GoalFoundationImportResultDto { yearId: number; importedDistricts: number; valuesWritten: number; skippedRows: GoalFoundationImportSkippedRowDto[]; message: string }

export interface GoalOverviewDistrictDto { districtId: number; districtNumber: string }
export interface GoalOverviewCellDto { districtId: number; total: string | null; target: string | null; achieved: string | null }
export interface GoalOverviewRowDto {
  metricKey: string; groupName: string; label: string; referenceLabel: string | null; dataType: string; unit: string | null;
  hasReference: boolean; hasTarget: boolean; hasAchieved: boolean; cells: GoalOverviewCellDto[];
}
export interface GoalOverviewMatrixDto {
  zoneId: number; zoneName: string; categoryId: number; categoryName: string; yearId: number; yearLabel: string; districts: GoalOverviewDistrictDto[]; rows: GoalOverviewRowDto[];
}

export interface GoalSummaryMetricDto { groupName: string; baselineLabel: string; ragBand: string | null; singleValue: boolean; hasBaseline: boolean; notSummable: boolean }
export interface GoalSummaryCellDto { asOnJul1: string | null; target: string | null; achieved: string | null; pct: string | null; value: string | null }
export interface GoalSummaryCategoryDto { categoryId: number; name: string; metrics: GoalSummaryMetricDto[]; totals: GoalSummaryCellDto[] }
export interface GoalSummaryDistrictRowDto { districtId: number; districtNumber: string; cells: Record<number, GoalSummaryCellDto[]> }
export interface GoalDistrictSummaryMatrixDto { zoneId: number; zoneName: string; yearId: number; yearLabel: string; categories: GoalSummaryCategoryDto[]; districts: GoalSummaryDistrictRowDto[] }

export interface GoalMonthlyFieldDto {
  fieldId: number; groupName: string; fieldKey: string; fieldLabel: string; dataType: string; unit: string | null;
  annualTarget: number | null; baseline: number | null; monthly: Record<number, number | null>; total: number;
  monthlyTargets: Record<number, number | null>; monthlyTargetsRunning: Record<number, number | null>;
  quarterlyTargets: Record<number, number | null>; quarterlyAchieved: Record<number, number | null>;
  targetTotal: number; splitBase: number | null; targetsAreSuggested: boolean; monthlyTracked: boolean; displayText: string | null;
}
export interface GoalMonthlyFormDto {
  categoryId: number; categoryName: string; entityType: string; clubId: number | null; districtId: number | null; entityName: string;
  yearId: number; yearLabel: string; isEditable: boolean; months: GoalMonthPeriodDto[]; fields: GoalMonthlyFieldDto[];
}
export interface GoalMonthlySaveDto { fieldId: number; numericValue: number | null }
export interface SaveGoalMonthlyRequest { yearId: number; month: number; entries: GoalMonthlySaveDto[] }
export interface GoalTargetSplitFieldDto { fieldId: number; values: Record<number, number | null> }
export interface SaveGoalTargetSplitRequest { yearId: number; period: string; fields: GoalTargetSplitFieldDto[] }
export interface GoalTargetSplitErrorDto { fieldId: number; fieldLabel: string; annualTarget: number; entered: number; difference: number }

export const newMonthlyField = (o: Partial<GoalMonthlyFieldDto> & Pick<GoalMonthlyFieldDto, "fieldId" | "groupName" | "fieldKey" | "fieldLabel" | "dataType">): GoalMonthlyFieldDto => ({
  unit: null, annualTarget: null, baseline: null, monthly: {}, total: 0, monthlyTargets: {}, monthlyTargetsRunning: {},
  quarterlyTargets: {}, quarterlyAchieved: {}, targetTotal: 0, splitBase: null, targetsAreSuggested: false, monthlyTracked: true, displayText: null, ...o,
});
