using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

/// <summary>
/// Membership growth per club and Rotary year (N3, spec B.4 #34): target (club_growth_targets, net growth),
/// joins and terminations from club_members, prospects by stage from potential_members. Honorary members are left
/// out, the same rule as goal setting. Rolled up per club for the district dashboard.
/// </summary>
// shortcut: the target lives in club_growth_targets because club goal setting is parked ("Coming soon"), so clubs
// cannot set goal_entries.new_members; read or merge that target when club goals or the targets module (plan 11) return.
public class GrowthService
{
    private readonly string _connectionString;

    public GrowthService(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    internal sealed class YearRow
    {
        public int Id { get; set; }
        public string Label { get; set; } = "";
        public DateTime Start { get; set; }
        public DateTime End { get; set; }
    }

    internal static Task<YearRow?> YearAsync(MySqlConnection conn, int? yearId) => conn.QueryFirstOrDefaultAsync<YearRow>(@"
        SELECT pk_year_id AS Id, YearLabel AS Label, StartDate AS Start, EndDate AS End FROM rotary_year_master
        WHERE COALESCE(isdeleted, 0) = 0 AND (pk_year_id = @Y OR (@Y IS NULL AND IsCurrent = 1))
        ORDER BY StartDate DESC LIMIT 1", new { Y = yearId });

    private static List<StageCountDto> ByStage(IEnumerable<(string Stage, int Count)> rows)
    {
        var map = rows.GroupBy(r => r.Stage).ToDictionary(g => g.Key, g => g.Sum(r => r.Count));
        return ContactRules.Stages.Select(s => new StageCountDto { Stage = s, Count = map.GetValueOrDefault(s) }).ToList();
    }

    public async Task<ClubGrowthDto?> GetClubAsync(int clubId, int? yearId)
    {
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        var y = await YearAsync(conn, yearId);
        if (y == null) return null;
        var a = new { C = clubId, Y = y.Id, S = y.Start, E = y.End };
        using var multi = await conn.QueryMultipleAsync(@"
            SELECT target_net_growth FROM club_growth_targets WHERE fk_club_id = @C AND fk_year_id = @Y;
            SELECT COUNT(DISTINCT fk_member_master_profile_id) FROM club_members
              WHERE fk_club_id = @C AND IsHonoraryMember = 0 AND JoinedDate BETWEEN @S AND @E;
            SELECT COUNT(DISTINCT fk_member_master_profile_id) FROM club_members
              WHERE fk_club_id = @C AND IsHonoraryMember = 0 AND TerminationDate BETWEEN @S AND @E;
            SELECT COUNT(DISTINCT fk_member_master_profile_id) FROM club_members
              WHERE fk_club_id = @C AND IsHonoraryMember = 0 AND IsActive = 1 AND isdeleted = 0;
            SELECT stage, COUNT(*) FROM potential_members WHERE fk_club_id = @C AND isdeleted = 0 GROUP BY stage;", a);
        return new ClubGrowthDto
        {
            ClubId = clubId, YearId = y.Id, YearLabel = y.Label,
            Target = await multi.ReadFirstOrDefaultAsync<int?>(),
            Joined = await multi.ReadSingleAsync<int>(),
            Terminated = await multi.ReadSingleAsync<int>(),
            CurrentMembers = await multi.ReadSingleAsync<int>(),
            ProspectsByStage = ByStage(await multi.ReadAsync<(string, int)>()),
        };
    }

    public async Task SetTargetAsync(int clubId, SetGrowthTargetDto dto, int by)
    {
        if (dto.Target is < 0 or > 1000) throw new ArgumentException("Target must be between 0 and 1000 new members.");
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        if (await YearAsync(conn, dto.YearId) is not { } y || y.Id != dto.YearId) throw new ArgumentException("Rotary year not found.");
        await conn.ExecuteAsync(@"
            INSERT INTO club_growth_targets (fk_club_id, fk_year_id, target_net_growth, modified_by, modified_date)
            VALUES (@C, @Y, @T, @By, NOW())
            ON DUPLICATE KEY UPDATE target_net_growth = @T, modified_by = @By, modified_date = NOW()",
            new { C = clubId, Y = dto.YearId, T = dto.Target, By = by });
    }

    public async Task<DistrictGrowthDto?> GetDistrictAsync(int districtId, int? yearId)
    {
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        var y = await YearAsync(conn, yearId);
        if (y == null) return null;
        var a = new { D = districtId, Y = y.Id, S = y.Start, E = y.End };
        // One round trip, every figure grouped by club (no per-club queries).
        using var multi = await conn.QueryMultipleAsync(@"
            SELECT pk_club_id, ClubName FROM club_master WHERE fk_district_id = @D AND isdeleted = 0 AND IsActive = 1 ORDER BY ClubName;
            SELECT t.fk_club_id, t.target_net_growth FROM club_growth_targets t
              JOIN club_master c ON c.pk_club_id = t.fk_club_id WHERE c.fk_district_id = @D AND t.fk_year_id = @Y;
            SELECT cm.fk_club_id, COUNT(DISTINCT cm.fk_member_master_profile_id) FROM club_members cm
              JOIN club_master c ON c.pk_club_id = cm.fk_club_id
              WHERE c.fk_district_id = @D AND cm.IsHonoraryMember = 0 AND cm.JoinedDate BETWEEN @S AND @E GROUP BY cm.fk_club_id;
            SELECT cm.fk_club_id, COUNT(DISTINCT cm.fk_member_master_profile_id) FROM club_members cm
              JOIN club_master c ON c.pk_club_id = cm.fk_club_id
              WHERE c.fk_district_id = @D AND cm.IsHonoraryMember = 0 AND cm.TerminationDate BETWEEN @S AND @E GROUP BY cm.fk_club_id;
            SELECT pm.fk_club_id, pm.stage, COUNT(*) FROM potential_members pm
              JOIN club_master c ON c.pk_club_id = pm.fk_club_id
              WHERE c.fk_district_id = @D AND pm.isdeleted = 0 GROUP BY pm.fk_club_id, pm.stage;", a);
        var clubs = (await multi.ReadAsync<(int Id, string Name)>()).ToList();
        var targets = (await multi.ReadAsync<(int Club, int Target)>()).ToDictionary(r => r.Club, r => r.Target);
        var joined = (await multi.ReadAsync<(int Club, int N)>()).ToDictionary(r => r.Club, r => r.N);
        var left = (await multi.ReadAsync<(int Club, int N)>()).ToDictionary(r => r.Club, r => r.N);
        var stages = (await multi.ReadAsync<(int Club, string Stage, int N)>()).ToList();

        var rows = clubs.Select(c => new DistrictGrowthClubDto
        {
            ClubId = c.Id, ClubName = c.Name,
            Target = targets.TryGetValue(c.Id, out var t) ? t : null,
            Joined = joined.GetValueOrDefault(c.Id),
            Terminated = left.GetValueOrDefault(c.Id),
            OpenProspects = stages.Where(s => s.Club == c.Id && s.Stage != "inducted").Sum(s => s.N),
        }).ToList();
        return new DistrictGrowthDto
        {
            DistrictId = districtId, YearId = y.Id, YearLabel = y.Label,
            TargetTotal = rows.Sum(r => r.Target ?? 0),
            ClubsWithTarget = rows.Count(r => r.Target != null),
            ClubsReached = rows.Count(r => r.Target is > 0 && r.NetGrowth >= r.Target),
            Joined = rows.Sum(r => r.Joined),
            Terminated = rows.Sum(r => r.Terminated),
            ProspectsByStage = ByStage(stages.Select(s => (s.Stage, s.N))),
            Clubs = rows,
        };
    }
}
