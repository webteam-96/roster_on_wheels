using ClosedXML.Excel;
using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

// New Goal Setting (Rotary.org), ported from upstream. ROW has no goal oversight roles (module sheet), so:
// the "oversight" (all-districts) view is SuperAdmin only, and the category filters are "no filter" (upstream
// also returns no filter for every caller). Helpers the report needs from the newer upstream goal engine.
public partial class GoalSettingService
{
    private static Task<HashSet<int>?> DaCategoryFilterAsync(MySqlConnection conn, int memberId)
        => Task.FromResult<HashSet<int>?>(null);

    private static Task<HashSet<int>?> OversightCategoryFilterAsync(MySqlConnection conn, int memberId)
        => Task.FromResult<HashSet<int>?>(null);

    private static Task<bool> IsSuperAdminForGoalScopeAsync(MySqlConnection conn, int memberId)
        => ClubAdminAccessHelper.IsSuperAdminAsync(conn, memberId);

    // Month colour (user 2026-10-15), compared on the whole numbers shown: Achieved below Target = red,
    // equal = yellow, above = green. Null when there is no target.
    private static string? MonthStatus(decimal? target, decimal achieved)
    {
        if (!target.HasValue) return null;
        decimal t = Math.Round(target.Value, 0, MidpointRounding.AwayFromZero), a = Math.Round(achieved, 0, MidpointRounding.AwayFromZero);
        return a < t ? "red" : a == t ? "yellow" : "green";
    }

    private static void ColourStatusCell(IXLCell cell, string? status)
    {
        if (status == null) return;
        var (bg, fg) = status switch
        {
            "red" => ("#FDE2E1", "#B91C1C"),
            "yellow" => ("#FEF3C7", "#92400E"),
            _ => ("#D1FAE5", "#047857"),
        };
        cell.Style.Fill.BackgroundColor = XLColor.FromHtml(bg);
        cell.Style.Font.FontColor = XLColor.FromHtml(fg);
        cell.Style.Font.Bold = true;
    }

    // Lock / Unlock the clubs of a district in one go (new View Club Goals page, user 2026-10-30): the
    // same rule as SetClubLockAsync - Super Admin or a District Admin of that district, within their
    // admin years - checked ONCE, then one batched write instead of ~4 queries per club per category.
    // clubId > 0 = just that club. Pairs already in that state are skipped (counted, not written).
    public async Task<(int Changed, int Skipped)> SetDistrictClubsLockAsync(
        int memberId, int districtId, int yearId, IReadOnlyList<int> categoryIds, int clubId, bool locked)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        if (!await ClubAdminAccessHelper.IsSuperAdminAsync(conn, memberId))
        {
            var isDistrictAdmin = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM member_roles mr
                WHERE mr.fk_member_master_profile_id = @MemberId AND mr.fk_role_id = 2
                  AND mr.fk_district_id = @DistrictId AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0)
                  AND mr.IsActive = 1 AND mr.isdeleted = 0",
                new { MemberId = memberId, DistrictId = districtId });
            if (isDistrictAdmin == 0)
                throw new UnauthorizedAccessException("You are not authorised to lock/unlock this district's club goals.");
        }
        await EnsureYearRightsAsync(conn, memberId, 0, districtId, yearId);

        var clubs = (await conn.QueryAsync<int>($@"
            SELECT c.pk_club_id FROM club_master c
            WHERE c.fk_district_id = @DistrictId AND c.isdeleted = 0 AND c.IsActive = 1
              AND {HierarchyScopeSql.ClubLive("c")} AND (@ClubId = 0 OR c.pk_club_id = @ClubId)",
            new { DistrictId = districtId, ClubId = clubId })).ToList();
        if (clubs.Count == 0 || categoryIds.Count == 0) return (0, 0);

        var current = (await conn.QueryAsync<(int ClubId, int CategoryId, bool IsLocked)>(@"
            SELECT fk_club_id, fk_category_id, IsLocked = 1 FROM goal_locks
            WHERE EntityType = 'Club' AND fk_district_id = 0 AND fk_year_id = @YearId
              AND fk_club_id IN @Clubs AND fk_category_id IN @Cats",
            new { YearId = yearId, Clubs = clubs, Cats = categoryIds }))
            .ToDictionary(x => (x.ClubId, x.CategoryId), x => x.IsLocked);

        var todo = clubs.SelectMany(c => categoryIds.Select(k => (Club: c, Cat: k)))
            .Where(x => !current.TryGetValue((x.Club, x.Cat), out var isLocked) ? locked : isLocked != locked)
            .ToList();
        int total = clubs.Count * categoryIds.Count;
        // Same columns and values SetLockAsync writes, 300 rows per statement.
        foreach (var chunk in todo.Chunk(300))
        {
            var p = new DynamicParameters(new { YearId = yearId, MemberId = memberId });
            var values = string.Join(",", chunk.Select((x, i) =>
            {
                p.Add($"c{i}", x.Club); p.Add($"k{i}", x.Cat);
                return locked ? $"('Club', @c{i}, 0, @k{i}, @YearId, 1, @MemberId, NOW())"
                              : $"('Club', @c{i}, 0, @k{i}, @YearId, 0, @MemberId, NOW())";
            }));
            await conn.ExecuteAsync(locked
                ? $@"INSERT INTO goal_locks (EntityType, fk_club_id, fk_district_id, fk_category_id, fk_year_id, IsLocked, LockedBy, LockedDate)
                     VALUES {values}
                     ON DUPLICATE KEY UPDATE IsLocked = 1, LockedBy = @MemberId, LockedDate = NOW(), UnlockedBy = NULL, UnlockedDate = NULL"
                : $@"INSERT INTO goal_locks (EntityType, fk_club_id, fk_district_id, fk_category_id, fk_year_id, IsLocked, UnlockedBy, UnlockedDate)
                     VALUES {values}
                     ON DUPLICATE KEY UPDATE IsLocked = 0, UnlockedBy = @MemberId, UnlockedDate = NOW()", p);
        }
        return (todo.Count, total - todo.Count);
    }
}
