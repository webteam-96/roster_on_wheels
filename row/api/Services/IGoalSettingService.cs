using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IGoalSettingService
{
    Task<List<GoalCategoryDto>> GetCategoriesAsync();
    // Same list, narrowed to a District Assistant's own goal category (everyone else gets all of them).
    Task<List<GoalCategoryDto>> GetCategoriesAsync(int callerMemberId);
    Task<List<GoalCategoryDto>> GetOversightCategoriesAsync(int callerMemberId);

    // Quarterly / month-wise TARGETS (user 2026-09-25). The yearly target is never written here -
    // this saves the SPLIT of it, and refuses anything that does not add up to the year exactly.
    Task<GoalMonthlyFormDto> SaveDistrictTargetSplitAsync(int memberId, int categoryId, SaveGoalTargetSplitRequest req, int? requestedDistrictId);
    Task<GoalMonthlyFormDto> SaveClubTargetSplitAsync(int memberId, int categoryId, SaveGoalTargetSplitRequest req, int? requestedClubId);

    // District Performance Report — READ-ONLY system call (no caller scope). Only the SuperAdmin-gated
    // DistrictPerformanceReportService uses it; never expose it on a user-scoped endpoint.
    Task<DistrictPerformanceGoalData> GetDistrictPerformanceGoalDataAsync(int districtId, int yearId, bool includeWorkbooks);

    // Club goal entry — memberId resolves to a club via their Club Admin/Moderator role,
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
    // Goal-oversight read-only month-wise for ANY district in the caller's goal scope (not district-admin gated).
    Task<GoalMonthlyFormDto?> GetDistrictMonthlyGoalFormScopedAsync(int memberId, int categoryId, int? yearId, int districtId);
    Task<GoalMonthlyFormDto> SaveDistrictMonthlyGoalsAsync(int memberId, int categoryId, SaveGoalMonthlyRequest request, int? requestedDistrictId);
    Task<byte[]?> BuildDistrictMonthlyExcelAsync(int memberId, int categoryId, int? yearId, int? requestedDistrictId);
    Task<byte[]?> BuildClubMonthlyExcelAsync(int memberId, int categoryId, int? yearId, int? requestedClubId);
    Task<byte[]?> BuildAllClubsMonthlyExcelAsync(int memberId, int? yearId, int? requestedDistrictId);
    // Goal-oversight "View clubs" popup: all-clubs report for a district in the caller's goal scope.
    Task<byte[]?> BuildAllClubsMonthlyExcelScopedAsync(int memberId, int? yearId, int districtId);

    // District Admin's "all my clubs" overview for one category+year.
    Task<List<GoalClubSummaryDto>> GetDistrictClubsGoalListAsync(int memberId, int categoryId, int yearId, int? requestedDistrictId);
    Task<GoalClubMatrixDto> GetDistrictClubsGoalMatrixAsync(int memberId, int categoryId, int? yearId, int? requestedDistrictId);
    Task<GoalClubMonthlyMatrixDto> GetDistrictClubsMonthlyMatrixAsync(int memberId, int categoryId, int? yearId, int? requestedDistrictId);
    // Goal-oversight "Club Goal Setting" popup: clubs matrix for ANY district in the caller's goal scope
    // (RI Director / ZC / DA / observer / SuperAdmin) — validated via goal assignments, not district-admin.
    Task<GoalClubMatrixDto> GetScopedDistrictClubsGoalMatrixAsync(int memberId, int categoryId, int? yearId, int districtId);
    Task<GoalClubMonthlyMatrixDto> GetScopedDistrictClubsMonthlyMatrixAsync(int memberId, int categoryId, int? yearId, int districtId);
    // Observer ("view as") — gated to the single SuperAdmin demo/observer account (by mobile).
    Task<bool> IsGoalObserverAsync(int callerMemberId);
    Task<List<GoalObserverRoleDto>> GetObserverRoleListAsync(int callerMemberId);

    // Zonal Coordinator's "all districts in my zone" overview for one category+year
    // (requestedZoneId lets a SuperAdmin borrow a specific zone; a ZC omits it).
    Task<List<GoalDistrictSummaryDto>> GetZoneDistrictsGoalListAsync(int memberId, int categoryId, int yearId, int? requestedZoneId);

    // SuperAdmin read-only Overview matrix: one zone × one category × one year → every active
    // district's Target/Achieved values per metric. Returns null if the zone/year is invalid.
    Task<GoalOverviewMatrixDto?> GetOverviewMatrixAsync(int zoneId, int categoryId, int? yearId);
    // Same matrix, but scoped to what a goal oversight role (RI Director / ZC / DA) may see for a zone
    // they cover (a DA's grid is filtered to their districts). Throws Unauthorized otherwise.
    Task<GoalOverviewMatrixDto?> GetScopedOverviewMatrixAsync(int memberId, int zoneId, int categoryId, int? yearId);
    // Goal-oversight dashboard: districts = rows, compact Target/Achieved/% per overseen category + totals.
    Task<GoalDistrictSummaryMatrixDto> GetScopedDistrictSummaryMatrixAsync(int memberId, int zoneId, int? yearId);
    // Goal-oversight district report (YTD + Month-wise, districts × categories horizontal), scoped to selection.
    Task<byte[]?> BuildGoalDistrictReportExcelAsync(int memberId, int? zoneId, int? districtId, int? yearId);
    // Goal-oversight per-district download: the SAME "District Goal Setting" workbook as the district admin,
    // validated against the caller's goal-oversight scope (not the district-admin role).
    Task<byte[]?> BuildDistrictGoalSettingReportScopedAsync(int memberId, int districtId, int? yearId);
    // Red "new message" dot for the RI Messages popup (per zone+year).
    Task<bool> HasUnreadZoneMessagesAsync(int memberId, int zoneId, int yearId);
    Task MarkZoneMessagesSeenAsync(int memberId, int zoneId, int yearId);

    // Locking — club goals: District Admin of that club's district, or SuperAdmin.
    // District's own goals: SuperAdmin only (Phase 3 adds the zone-scoped Role 5 bulk-lock).
    Task<GoalLockStatusDto> SetClubLockAsync(int memberId, int categoryId, int yearId, int clubId, bool locked);
    Task<GoalLockStatusDto> SetDistrictLockAsync(int memberId, int categoryId, int yearId, int districtId, bool locked);

    // Specialized oversight roles (Phase 3) — SuperAdmin-managed assignments.
    Task<List<GoalRoleAssignmentDto>> GetRoleAssignmentsAsync();
    // Excel of the Role Assign listing (zone, district, club + name / mobile / email),
    // honouring the screen's "Filter by zone" dropdown. null zoneId = every zone.
    Task<byte[]> BuildRoleAssignmentsExcelAsync(int? zoneId);
    Task<GoalRoleAssignmentDto> CreateRoleAssignmentAsync(int assignedByMemberId, CreateGoalRoleAssignmentRequest request);
    Task RevokeRoleAssignmentAsync(int assignmentId, int revokedByMemberId);
    // "+" beside a name: add ANOTHER holder with the same scope (zones / category / districts).
    Task<int> AddRoleAssignmentHolderAsync(int assignmentId, AddGoalRoleHolderRequest req, int addedByMemberId);
    // Replace the holder (and RI-Director zones / District-Assistant districts) without revoking.
    Task ChangeRoleAssignmentAsync(int assignmentId, ChangeGoalRoleAssignmentRequest req, int changedByMemberId);
    // Send the login/credentials email to the single member on this assignment (on-demand).
    Task<int> SendCredentialsEmailAsync(int assignmentId, int requestedByMemberId);
    // Zone ids already held by an active RI Director (for hiding taken zones in the picker).
    Task<List<int>> GetAssignedDirectorZoneIdsAsync(int? excludeAssignmentId);
    // Sends the role-assigned email (with login) to every member currently holding an active goal
    // role — assignment no longer emails automatically; the SuperAdmin triggers this in one go.
    // zoneId (optional): email only that zone's RI Director / Zone Co-ordinators / District Assistants.
    Task<int> SendAllRoleAssignmentEmailsAsync(int requestedByMemberId, int? zoneId = null);

    // Leadership designation catalog (RMC / ARC / RPIC …) — SuperAdmin-extensible.
    Task<List<GoalDesignationDto>> GetDesignationsAsync();
    Task<GoalDesignationDto> AddDesignationAsync(CreateGoalDesignationRequest request);
    // Zone-scoped member search for the assign form (members whose active club is in the zone[s]).
    Task<List<GoalZoneMemberDto>> SearchZoneMembersAsync(int[] zoneIds, string? search);
    // Global smart member search (member is picked first, before any zone).
    Task<List<GoalZoneMemberDto>> SearchMembersAsync(string? search);

    // What the CURRENT caller holds, and the scoped read-only views it unlocks.
    Task<List<GoalMyAssignmentDto>> GetMyAssignmentsAsync(int memberId);
    Task<List<GoalDistrictSummaryDto>> GetScopedDistrictsGoalListAsync(int memberId, int categoryId, int yearId);
    Task<GoalCategoryFormDto> GetScopedDistrictGoalFormAsync(int memberId, int categoryId, int yearId, int districtId);
    // Scoped CLUB drill-down (role logins): a district's club list + one club's read-only goal form,
    // gated by the same goal-role scope (RI Director / Zone Co-ordinator / District Assistant).
    Task<List<GoalClubSummaryDto>> GetScopedDistrictClubsGoalListAsync(int memberId, int categoryId, int yearId, int districtId);
    Task<GoalCategoryFormDto?> GetScopedClubGoalFormAsync(int memberId, int categoryId, int yearId, int clubId);
    Task<GoalBulkLockResultDto> BulkLockDistrictsAsync(int memberId, GoalBulkLockRequest request);

    // Attractive, print-friendly goal reports (all 4 categories, YTD + Month-wise, + Messages on
    // zone/district). Scope-enforced: SuperAdmin sees all; role logins only their assigned scope.
    Task<byte[]?> BuildZoneGoalReportAsync(int memberId, int zoneId, int? yearId);
    Task<byte[]?> BuildDistrictGoalReportAsync(int memberId, int districtId, int? yearId);
    Task<byte[]?> BuildClubGoalReportAsync(int memberId, int clubId, int? yearId);

    // Messaging (formerly "comments") — two-way threads scoped per (district, category, year)
    // plus optional club thread (clubId > 0 = Club Admin ↔ its District Admin only; 0 = district
    // thread: District Admin ↔ the coordinators above it).
    Task<List<GoalCommentDto>> GetCommentsAsync(int memberId, int categoryId, int districtId, int clubId, int yearId);
    Task<GoalCommentDto> PostCommentAsync(int memberId, int categoryId, int districtId, int clubId, int yearId, string commentText);

    // Pairwise oversight messaging — private RI Director ↔ (District Assistant / Zone Co-ordinator)
    // threads, scoped per (category, district, year). ThreadList tells the caller their role and the
    // thread(s) they can see; messages/post operate on one owner's thread (the DA/ZC member id).
    Task<GoalThreadListDto> GetGoalThreadListAsync(int memberId, int categoryId, int districtId, int yearId);
    Task<List<GoalCommentDto>> GetGoalThreadMessagesAsync(int memberId, int categoryId, int districtId, int yearId, int ownerMemberId);
    Task<GoalCommentDto> PostGoalThreadMessageAsync(int memberId, int categoryId, int districtId, int yearId, int ownerMemberId, string text);

    // Zone-based messaging (RI Director dashboard) — one message box per ZC / DA of the zone; threads
    // keyed by (category, year, ownerMemberId). Owner = the ZC/DA member (not district-scoped).
    // filterDistrictId: null = every owner (ZC + all DAs, e.g. reports); 0 = ZC only (zone chosen, no
    // district); >0 = only the District Assistant(s) covering that district.
    Task<GoalThreadListDto> GetGoalZoneThreadListAsync(int memberId, int categoryId, int zoneId, int yearId, string? actingAs = null, int? filterDistrictId = null);
    Task<List<GoalCommentDto>> GetGoalOwnerThreadMessagesAsync(int memberId, int categoryId, int yearId, int ownerMemberId, int? zoneId = null);
    Task<GoalCommentDto> PostGoalOwnerThreadMessageAsync(int memberId, int categoryId, int yearId, int ownerMemberId, string text, int districtId = 0);
    // Goal messages report (zone), filterable by category (0=all) + district (0=all). RI/ZC/SuperAdmin.
    Task<byte[]?> BuildGoalMessagesReportExcelAsync(int memberId, int zoneId, int yearId, int categoryId, int districtId);
    // On-screen unified messages list (same filter/scope as the report).
    Task<List<GoalMessageRowDto>> GetGoalMessagesListAsync(int memberId, int zoneId, int yearId, int categoryId, int districtId);
    // Roster of ZC/DA in the zone (with message counts) — for the "no messages yet" state.
    Task<List<GoalMessageOwnerDto>> GetGoalMessageRosterAsync(int memberId, int zoneId, int yearId, int categoryId, int districtId);

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
