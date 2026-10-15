using Dapper;
using MySqlConnector;
using System.Text.RegularExpressions;

namespace RotaryApi.Services;

/// <summary>
/// Auto-creates and maintains sub_groups (and sub_group_members) at BOTH club AND district level
/// driven by the board_of_directors table. One sub-group per (scope, year, designation):
///   - Club scope:     fk_club_id = clubId,    fk_district_id = NULL → contains BOD members of that club for that designation+year
///   - District scope: fk_club_id = 0,         fk_district_id = districtId → contains BOD members of every club in that district for that designation+year
///
/// Naming convention (mirrors DcAutoGroupService for consistency):
///   - Current Rotary year → exact designation name (e.g., "Treasurer")
///   - Other years         → designation name + " " + YYYY-YY (e.g., "Treasurer 2024-25")
///
/// User can manually add/edit/delete members on these sub-groups; the daily nightly job re-syncs
/// from BOD truth so any "drift" (manual removals etc.) gets corrected next morning.
/// </summary>
public interface IBodSubGroupAutoService
{
    bool IsAutoBodSubGroup(string? groupName);
    Task<(int created, int updated, int deleted)> RebuildAllAsync(CancellationToken ct = default);
    Task OnBodChangedAsync(int clubId, int designationId, int yearId, CancellationToken ct = default);
}

public class BodSubGroupAutoService : IBodSubGroupAutoService
{
    private static readonly Regex AutoNamePattern = new(@"^.+( \d{4}-\d{2})?$", RegexOptions.Compiled);
    private readonly string _connectionString;
    private readonly ILogger<BodSubGroupAutoService> _logger;

    public BodSubGroupAutoService(IConfiguration config, ILogger<BodSubGroupAutoService> logger)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        _logger = logger;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    /// <summary>Best-effort check — a group is "auto" if its name starts with a designation name. Hard to be exact since users name groups freely; we treat any group created by this service as auto by tracking via the rebuild.</summary>
    public bool IsAutoBodSubGroup(string? groupName) => !string.IsNullOrWhiteSpace(groupName);

    private static string BuildGroupName(string designationName, string yearLabel, bool isCurrentYear)
        => isCurrentYear ? designationName : $"{designationName} {yearLabel}";

    /// <summary>Async hook for instant updates when BOD changes via web portal.</summary>
    public async Task OnBodChangedAsync(int clubId, int designationId, int yearId, CancellationToken ct = default)
    {
        try
        {
            using var conn = CreateConnection();
            await conn.OpenAsync(ct);

            // Find the district for this club
            var districtId = await conn.ExecuteScalarAsync<int?>(
                "SELECT fk_district_id FROM club_master WHERE pk_club_id = @C AND isdeleted = 0",
                new { C = clubId });

            // Refresh club-scope sub-group for this (clubId, yearId, designationId)
            await SyncOneScopeAsync(conn, scopeClubId: clubId, scopeDistrictId: null, designationId: designationId, yearId: yearId);

            // Refresh district-scope sub-group for this (districtId, yearId, designationId) if district known
            if (districtId.HasValue)
            {
                await SyncOneScopeAsync(conn, scopeClubId: null, scopeDistrictId: districtId.Value, designationId: designationId, yearId: yearId);
            }
        }
        catch (Exception ex)
        {
            // Fire-and-forget — don't break the BOD save if sub-group update fails
            _logger.LogWarning(ex, "BodSubGroupAuto.OnBodChangedAsync failed for club={Club} designation={Des} year={Year}", clubId, designationId, yearId);
        }
    }

    /// <summary>Full rebuild — called by daily nightly job. Returns (created, updated, deleted) counts.</summary>
    public async Task<(int created, int updated, int deleted)> RebuildAllAsync(CancellationToken ct = default)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync(ct);

        // Find every distinct (club, year, designation) in active BOD — these define what groups should exist
        var bodCombos = (await conn.QueryAsync<(int clubId, int yearId, int designationId)>(@"
            SELECT DISTINCT b.fk_club_id AS clubId, b.fk_year_id AS yearId, b.fk_designation_id AS designationId
            FROM board_of_directors b
            JOIN club_master c ON c.pk_club_id = b.fk_club_id AND c.isdeleted = 0
            WHERE b.isdeleted = 0")).ToList();

        // Also distinct (district, year, designation)
        var districtCombos = (await conn.QueryAsync<(int districtId, int yearId, int designationId)>(@"
            SELECT DISTINCT c.fk_district_id AS districtId, b.fk_year_id AS yearId, b.fk_designation_id AS designationId
            FROM board_of_directors b
            JOIN club_master c ON c.pk_club_id = b.fk_club_id AND c.isdeleted = 0
            WHERE b.isdeleted = 0")).ToList();

        int totalCreated = 0, totalUpdated = 0, totalDeleted = 0;

        foreach (var (clubId, yearId, designationId) in bodCombos)
        {
            ct.ThrowIfCancellationRequested();
            var stat = await SyncOneScopeAsync(conn, scopeClubId: clubId, scopeDistrictId: null, designationId, yearId);
            totalCreated += stat.created; totalUpdated += stat.updated; totalDeleted += stat.deleted;
        }

        foreach (var (districtId, yearId, designationId) in districtCombos)
        {
            ct.ThrowIfCancellationRequested();
            var stat = await SyncOneScopeAsync(conn, scopeClubId: null, scopeDistrictId: districtId, designationId, yearId);
            totalCreated += stat.created; totalUpdated += stat.updated; totalDeleted += stat.deleted;
        }

        return (totalCreated, totalUpdated, totalDeleted);
    }

    /// <summary>Sync ONE sub-group: ensure it exists, then make its member list match BOD truth.</summary>
    private async Task<(int created, int updated, int deleted)> SyncOneScopeAsync(
        MySqlConnection conn, int? scopeClubId, int? scopeDistrictId, int designationId, int yearId)
    {
        // Resolve designation name
        var designationName = await conn.ExecuteScalarAsync<string?>(
            "SELECT designation_name FROM designation_master WHERE pk_designation_id = @Id AND isdeleted = 0",
            new { Id = designationId });
        if (string.IsNullOrWhiteSpace(designationName)) return (0, 0, 0);

        // Resolve year label + is-current
        var year = await conn.QueryFirstOrDefaultAsync<(string yearLabel, DateTime startDate, DateTime endDate)>(@"
            SELECT IFNULL(YearLabel, '') AS yearLabel, StartDate AS startDate, EndDate AS endDate
            FROM rotary_year_master WHERE pk_year_id = @Id LIMIT 1",
            new { Id = yearId });
        if (string.IsNullOrEmpty(year.yearLabel)) return (0, 0, 0);
        var today = DateTime.Today;
        var isCurrent = today >= year.startDate.Date && today <= year.endDate.Date;
        var groupName = BuildGroupName(designationName, year.yearLabel, isCurrent);

        // Find or create the sub_group row
        var clubFilterValue = scopeClubId ?? 0;
        int? districtFilterValue = scopeDistrictId;
        var groupId = await conn.ExecuteScalarAsync<int?>(@"
            SELECT pk_sub_group_id FROM sub_groups
            WHERE fk_club_id = @C
              AND ((@D IS NULL AND fk_district_id IS NULL) OR fk_district_id = @D)
              AND fk_year_id = @Y AND GroupName = @N AND isdeleted = 0
            LIMIT 1",
            new { C = clubFilterValue, D = districtFilterValue, Y = yearId, N = groupName });

        bool wasCreated = false;
        if (!groupId.HasValue)
        {
            groupId = await conn.ExecuteScalarAsync<int>(@"
                INSERT INTO sub_groups (fk_club_id, fk_district_id, fk_year_id, GroupName, created_date, isdeleted)
                VALUES (@C, @D, @Y, @N, NOW(), 0);
                SELECT LAST_INSERT_ID();",
                new { C = clubFilterValue, D = districtFilterValue, Y = yearId, N = groupName });
            wasCreated = true;
        }

        // Compute members from BOD truth
        List<int> bodMemberIds;
        if (scopeClubId.HasValue)
        {
            bodMemberIds = (await conn.QueryAsync<int>(@"
                SELECT DISTINCT b.fk_member_master_profile_id
                FROM board_of_directors b
                JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id AND m.isdeleted = 0
                WHERE b.fk_club_id = @C AND b.fk_year_id = @Y AND b.fk_designation_id = @D AND b.isdeleted = 0",
                new { C = scopeClubId.Value, Y = yearId, D = designationId })).ToList();
        }
        else
        {
            bodMemberIds = (await conn.QueryAsync<int>(@"
                SELECT DISTINCT b.fk_member_master_profile_id
                FROM board_of_directors b
                JOIN club_master c ON c.pk_club_id = b.fk_club_id AND c.isdeleted = 0
                JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id AND m.isdeleted = 0
                WHERE c.fk_district_id = @D AND b.fk_year_id = @Y AND b.fk_designation_id = @Des AND b.isdeleted = 0",
                new { D = scopeDistrictId!.Value, Y = yearId, Des = designationId })).ToList();
        }

        // Existing active members
        var existingMembers = (await conn.QueryAsync<(int pk_id, int memberId)>(@"
            SELECT pk_sub_group_member_id AS pk_id, fk_member_master_profile_id AS memberId
            FROM sub_group_members
            WHERE fk_sub_group_id = @G AND isdeleted = 0",
            new { G = groupId.Value })).ToList();
        var existingIds = existingMembers.Select(m => m.memberId).ToHashSet();
        var bodIds = bodMemberIds.ToHashSet();

        int added = 0, removed = 0;

        // Add members in BOD but not in sub-group
        foreach (var newMid in bodIds.Where(id => !existingIds.Contains(id)))
        {
            // Try reactivate a soft-deleted row first
            var softId = await conn.ExecuteScalarAsync<int?>(@"
                SELECT MAX(pk_sub_group_member_id) FROM sub_group_members
                WHERE fk_sub_group_id = @G AND fk_member_master_profile_id = @M AND isdeleted = 1",
                new { G = groupId.Value, M = newMid });
            if (softId.HasValue)
            {
                await conn.ExecuteAsync(
                    "UPDATE sub_group_members SET isdeleted = 0 WHERE pk_sub_group_member_id = @Id",
                    new { Id = softId.Value });
            }
            else
            {
                await conn.ExecuteAsync(@"
                    INSERT INTO sub_group_members (fk_sub_group_id, fk_member_master_profile_id, created_date, isdeleted)
                    VALUES (@G, @M, NOW(), 0)",
                    new { G = groupId.Value, M = newMid });
            }
            added++;
        }

        // Remove members in sub-group but not in BOD
        foreach (var staleId in existingMembers.Where(m => !bodIds.Contains(m.memberId)))
        {
            await conn.ExecuteAsync(
                "UPDATE sub_group_members SET isdeleted = 1 WHERE pk_sub_group_member_id = @Id",
                new { Id = staleId.pk_id });
            removed++;
        }

        return (wasCreated ? 1 : 0, (added > 0 || removed > 0) && !wasCreated ? 1 : 0, removed);
    }
}
