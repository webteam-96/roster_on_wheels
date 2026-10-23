using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IGoalSettingService
{
    Task<List<GoalCategoryDto>> GetCategoriesAsync();

    // Quarterly / month-wise TARGETS (user 2026-09-25). The yearly target is never written here -
    // this saves the SPLIT of it, and refuses anything that does not add up to the year exactly.
    Task<GoalMonthlyFormDto> SaveDistrictTargetSplitAsync(int memberId, int categoryId, SaveGoalTargetSplitRequest req, int? requestedDistrictId);
    Task<GoalMonthlyFormDto> SaveClubTargetSplitAsync(int memberId, int categoryId, SaveGoalTargetSplitRequest req, int? requestedClubId);

    // District Performance Report — READ-ONLY system call (no caller scope). Only the SuperAdmin-gated
    // DistrictPerformanceReportService uses it; never expose it on a user-scoped endpoint.
    Task<DistrictPerformanceGoalData> GetDistrictPerformanceGoalDataAsync(int districtId, int yearId, bool includeWorkbooks);

    // Club goal entry — memberId resolves to a club via their Club Admin role,
    // or requestedClubId lets a District Admin (or SuperAdmin) act on a specific club.
    Task<GoalCategoryFormDto?> GetClubGoalFormAsync(int memberId, int categoryId, int? yearId, int? requestedClubId);
    Task<GoalCategoryFormDto> SaveClubGoalFormAsync(int memberId, int categoryId, SaveGoalEntriesRequest request, int? requestedClubId);

    // District's own goal entry (independent numbers, same fields as clubs).
    Task<GoalCategoryFormDto?> GetDistrictGoalFormAsync(int memberId, int categoryId, int? yearId, int? requestedDistrictId);
    Task<GoalCategoryFormDto> SaveDistrictGoalFormAsync(int memberId, int categoryId, SaveGoalEntriesRequest request, int? requestedDistrictId);

    // Month-wise (additive; separate store).
    Task<GoalMonthlyFormDto?> GetClubMonthlyGoalFormAsync(int memberId, int categoryId, int? yearId, int? requestedClubId, bool readOnly = false);
    Task<GoalMonthlyFormDto> SaveClubMonthlyGoalsAsync(int memberId, int categoryId, SaveGoalMonthlyRequest request, int? requestedClubId);
    Task<GoalMonthlyFormDto?> GetDistrictMonthlyGoalFormAsync(int memberId, int categoryId, int? yearId, int? requestedDistrictId, bool readOnly = false);
    // Goal Overview (SuperAdmin) read-only month-wise for ANY district (not district-admin gated).
    Task<GoalMonthlyFormDto?> GetDistrictMonthlyGoalFormScopedAsync(int memberId, int categoryId, int? yearId, int districtId);
    Task<GoalMonthlyFormDto> SaveDistrictMonthlyGoalsAsync(int memberId, int categoryId, SaveGoalMonthlyRequest request, int? requestedDistrictId);
    Task<byte[]?> BuildDistrictMonthlyExcelAsync(int memberId, int categoryId, int? yearId, int? requestedDistrictId);
    Task<byte[]?> BuildClubMonthlyExcelAsync(int memberId, int categoryId, int? yearId, int? requestedClubId);
    Task<byte[]?> BuildAllClubsMonthlyExcelAsync(int memberId, int? yearId, int? requestedDistrictId);
    // Goal Overview "View clubs" popup: all-clubs report for a district (SuperAdmin or its admin).
    Task<byte[]?> BuildAllClubsMonthlyExcelScopedAsync(int memberId, int? yearId, int districtId);

    // District Admin's "all my clubs" overview for one category+year.
    Task<List<GoalClubSummaryDto>> GetDistrictClubsGoalListAsync(int memberId, int categoryId, int yearId, int? requestedDistrictId);
    Task<GoalClubMatrixDto> GetDistrictClubsGoalMatrixAsync(int memberId, int categoryId, int? yearId, int? requestedDistrictId);
    Task<GoalClubMonthlyMatrixDto> GetDistrictClubsMonthlyMatrixAsync(int memberId, int categoryId, int? yearId, int? requestedDistrictId);
    // Goal Overview "Club Goal Setting" popup: clubs matrix for a district (SuperAdmin or its admin).
    Task<GoalClubMatrixDto> GetScopedDistrictClubsGoalMatrixAsync(int memberId, int categoryId, int? yearId, int districtId);
    Task<GoalClubMonthlyMatrixDto> GetScopedDistrictClubsMonthlyMatrixAsync(int memberId, int categoryId, int? yearId, int districtId);

    // SuperAdmin read-only Overview matrix: one zone × one category × one year → every active
    // district's Target/Achieved values per metric. Returns null if the zone/year is invalid.
    Task<GoalOverviewMatrixDto?> GetOverviewMatrixAsync(int zoneId, int categoryId, int? yearId);
    // Goal Overview dashboard (SuperAdmin): districts = rows, compact Target/Achieved/% per category + totals.
    Task<GoalDistrictSummaryMatrixDto> GetScopedDistrictSummaryMatrixAsync(int memberId, int zoneId, int? yearId);
    // Goal Overview district report (YTD + Month-wise, districts × categories horizontal), scoped to selection.
    Task<byte[]?> BuildGoalDistrictReportExcelAsync(int memberId, int? zoneId, int? districtId, int? yearId);
    // Goal Overview per-district download: the SAME "District Goal Setting" workbook as the district admin,
    // SuperAdmin only (not the district-admin role).
    Task<byte[]?> BuildDistrictGoalSettingReportScopedAsync(int memberId, int districtId, int? yearId);
    // Red "new message" dot for the Goal Overview Messages popup (per zone+year).
    Task<bool> HasUnreadZoneMessagesAsync(int memberId, int zoneId, int yearId);

    // Goal Overview (SuperAdmin): every active district with its goal status for one category + year.
    Task<List<GoalDistrictSummaryDto>> GetScopedDistrictsGoalListAsync(int memberId, int categoryId, int yearId);

    // Messaging (formerly "comments") — two-way threads scoped per (district, category, year)
    // plus optional club thread (clubId > 0 = Club Admin ↔ its District Admin only; 0 = district
    // thread: District Admin ↔ SuperAdmin).
    Task<List<GoalCommentDto>> GetCommentsAsync(int memberId, int categoryId, int districtId, int clubId, int yearId);
    Task<GoalCommentDto> PostCommentAsync(int memberId, int categoryId, int districtId, int clubId, int yearId, string commentText);

    // Goal messages report (zone), filterable by category (0=all) + district (0=all). SuperAdmin.
    Task<byte[]?> BuildGoalMessagesReportExcelAsync(int memberId, int zoneId, int yearId, int categoryId, int districtId);

    // Foundation benchmark import (SuperAdmin, cumulative till-date) — parse master Excel by
    // DistrictNumber and UPSERT the 9 Reference fields per district into goal_entries for the
    // year (overwrite on re-import). Returns imported + skipped (unrecognised district) rows.
    // BuildFoundationSampleExcel produces the upload template.
    Task<GoalFoundationImportResultDto> ImportFoundationMonthlyAsync(int memberId, int yearId, Stream excelStream, int month = 0);
    // Club Foundation import — every district's clubs from one Rotary MCR Excel (matched globally
    // by Club No = ClubRotaryId). Year only; no district selection.
    Task<GoalFoundationImportResultDto> ImportFoundationClubAsync(int memberId, int yearId, Stream excelStream, int month = 0);
    Task<GoalDistrictMessagesDto> GetDistrictMessagesAsync(int memberId, int categoryId, int districtId, int yearId);
    Task<GoalCommentDto> PostDistrictMessageAsync(int memberId, int categoryId, int districtId, int yearId, string text);
    Task<List<GoalDistrictConversationDto>> GetDistrictMessageInboxAsync(int memberId, int zoneId, int yearId, int categoryId, int districtId);
    Task<GoalFoundationImportResultDto> ImportDistrictMembershipAsync(int memberId, int yearId, Stream membersStream, string membersFileName, Stream genderStream, Stream? rotaractStream = null, string? rotaractFileName = null, Stream? interactStream = null);
    Task<byte[]> BuildFoundationSampleExcelAsync();
    // Club Foundation sample (MCR layout, one row per current synced club, 0 baseline).
    Task<byte[]> BuildFoundationClubSampleExcelAsync();
    Task<(byte[] File, int Filled, int Missing)> ConvertFoundationMcrToClubFileAsync(Stream mcrStream);
}
