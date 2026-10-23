using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

/// <summary>
/// Live target dashboard (spec B.3 #30, feature target_dashboard): target against actual per club and in total for
/// one Rotary year. Actuals are counted from ROW data on every call. Targets are only read here: goal setting entries
/// (club and district), the district's project targets and the N3 growth targets. Entering targets and the agree /
/// lock flow (#29) are not part of it. One round trip of set-based queries covers every club the viewer may see.
/// </summary>
public class TargetDashboardService
{
    private readonly string _connectionString;
    private readonly IYearTableResolver _yearTables;

    public TargetDashboardService(IConfiguration configuration, IYearTableResolver yearTables)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _yearTables = yearTables;
    }

    // The four club fund targets of goal setting; club_total_target is defined as their sum.
    private static readonly string[] ClubFundTargets =
        { "club_annual_fund_ytd_target", "club_polioplus_ytd_target", "club_other_funds_ytd_target", "club_endowment_ytd_target" };
    private static readonly string[] ClubGoalKeys = ClubFundTargets.Append("new_members").ToArray();

    /// <summary>District managers get every active club; otherwise the clubs this member is the Assistant Governor of
    /// for the year (district_ag) or a club admin of. Null when the year does not exist.</summary>
    public async Task<TargetDashboardDto?> GetDistrictAsync(int districtId, int memberId, int? yearId)
    {
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        if (await GrowthService.YearAsync(conn, yearId) is not { } y) return null;
        var whole = memberId > 0 && await ScopeWriteGuardMiddleware.AllowedAsync(_connectionString, memberId, false, districtId);
        var clubIds = (await conn.QueryAsync<int>(whole
            ? "SELECT pk_club_id FROM club_master WHERE fk_district_id = @D AND isdeleted = 0 AND IsActive = 1"
            : @"SELECT da.fk_club_id FROM district_ag da JOIN club_master c ON c.pk_club_id = da.fk_club_id
                WHERE da.fk_member_id = @M AND da.fk_year_id = @Y AND da.is_active = 1 AND da.isdeleted = 0
                  AND c.fk_district_id = @D AND c.isdeleted = 0 AND c.IsActive = 1
                UNION
                SELECT mr.fk_club_id FROM member_roles mr JOIN club_master c ON c.pk_club_id = mr.fk_club_id
                WHERE mr.fk_member_master_profile_id = @M AND mr.fk_role_id = 2 AND mr.IsActive = 1 AND mr.isdeleted = 0
                  AND c.fk_district_id = @D AND c.isdeleted = 0 AND c.IsActive = 1",
            new { D = districtId, M = memberId, Y = y.Id })).ToList();
        if (!whole && clubIds.Count == 0)
            throw new UnauthorizedAccessException("Only the district, its Assistant Governors and club admins can see targets.");
        return await BuildAsync(conn, districtId, clubIds, y, whole);
    }

    /// <summary>One club, for its admins, its Assistant Governor and the district's managers. Null when the club or the
    /// year does not exist.</summary>
    public async Task<TargetDashboardDto?> GetClubAsync(int clubId, int memberId, int? yearId)
    {
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        var districtId = await conn.ExecuteScalarAsync<int?>(
            "SELECT fk_district_id FROM club_master WHERE pk_club_id = @C AND isdeleted = 0", new { C = clubId });
        if (districtId == null) return null;
        if (memberId <= 0 || (!await ScopeWriteGuardMiddleware.AllowedAsync(_connectionString, memberId, true, clubId)
                              && !await ScopeWriteGuardMiddleware.AllowedAsync(_connectionString, memberId, false, districtId.Value)))
            throw new UnauthorizedAccessException("Only the club's admins, its Assistant Governor and the district can see its targets.");
        if (await GrowthService.YearAsync(conn, yearId) is not { } y) return null;
        return await BuildAsync(conn, districtId.Value, new List<int> { clubId }, y, false);
    }

    private async Task<TargetDashboardDto> BuildAsync(MySqlConnection conn, int districtId, List<int> clubIds, GrowthService.YearRow y, bool whole)
    {
        var elapsed = Elapsed(y.Start, y.End, DateTime.Today);
        var dto = new TargetDashboardDto
        {
            DistrictId = districtId, YearId = y.Id, YearLabel = y.Label, WholeDistrict = whole,
            YearElapsedPercent = (int)Math.Round(elapsed * 100),
        };
        if (clubIds.Count == 0) return dto;

        // Year tables only exist for years that have projects; the name comes from rotary_year_master, not the caller.
        var projectsTable = _yearTables.GetProjectsTableName(y.Label);
        var hasProjects = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = @T",
            new { T = projectsTable }) > 0;
        // Same rule as the AG dashboard: project rows in the five avenues; Club Service is not a project.
        var projectsSql = hasProjects
            ? $@"SELECT p.fk_club_id, COUNT(*) FROM `{projectsTable}` p
                 JOIN module_master pm ON pm.pk_module_id = p.fk_module_id AND pm.ModuleKey IN ({ProjectCountFilter.ProjectModuleKeys})
                 WHERE p.fk_club_id IN @C AND p.isdeleted = 0 GROUP BY p.fk_club_id"
            : "SELECT 0, 0 FROM DUAL WHERE FALSE";

        // In order: clubs; members now, joined and left this year (the GrowthService rule, honorary members left out);
        // N3 growth targets; club goal setting targets; District Dues roster and members paid (the performance report
        // rule); attendance register; Foundation giving; projects; AG per club; the district's own goals and project
        // targets, read only when the viewer sees the whole district (@W).
        using var multi = await conn.QueryMultipleAsync($@"
            SELECT pk_club_id, ClubName FROM club_master WHERE pk_club_id IN @C ORDER BY ClubName;
            SELECT fk_club_id,
                   COUNT(DISTINCT CASE WHEN IsActive = 1 AND isdeleted = 0 THEN fk_member_master_profile_id END),
                   COUNT(DISTINCT CASE WHEN JoinedDate BETWEEN @S AND @E THEN fk_member_master_profile_id END),
                   COUNT(DISTINCT CASE WHEN TerminationDate BETWEEN @S AND @E THEN fk_member_master_profile_id END)
            FROM club_members WHERE fk_club_id IN @C AND IsHonoraryMember = 0 GROUP BY fk_club_id;
            SELECT fk_club_id, target_net_growth FROM club_growth_targets WHERE fk_year_id = @Y AND fk_club_id IN @C;
            SELECT e.fk_club_id, f.FieldKey, e.NumericValue FROM goal_entries e
            JOIN goal_fields f ON f.pk_field_id = e.fk_field_id
            WHERE e.EntityType = 'Club' AND e.fk_year_id = @Y AND e.fk_club_id IN @C AND e.isdeleted = 0
              AND e.NumericValue IS NOT NULL AND f.FieldKey IN @K;
            SELECT m.fk_club_id, COUNT(*), COUNT(CASE WHEN m.IsPaid = 1 THEN 1 END) FROM club_dues_members m
            JOIN club_dues d ON d.pk_club_dues_id = m.fk_club_dues_id
            WHERE d.fk_district_id = @D AND d.RotaryYear = @YL AND COALESCE(d.isdeleted, 0) = 0
              AND m.fk_club_id IN @C AND m.isdeleted = 0 AND m.IsHonorary = 0 GROUP BY m.fk_club_id;
            SELECT a.fk_club_id, COUNT(DISTINCT a.pk_attendance_id), COUNT(am.pk_id) FROM club_attendance a
            LEFT JOIN club_attendance_members am ON am.fk_attendance_id = a.pk_attendance_id
            WHERE a.fk_club_id IN @C AND a.fk_year_id = @Y AND a.isdeleted = 0 GROUP BY a.fk_club_id;
            SELECT fk_club_id, SUM(AmountUSD) FROM trf_contributions
            WHERE fk_club_id IN @C AND fk_year_id = @Y AND isdeleted = 0 GROUP BY fk_club_id;
            {projectsSql};
            SELECT da.fk_club_id, da.fk_member_id, m.MemberName FROM district_ag da
            JOIN member_master_profile m ON m.pk_member_master_profile_id = da.fk_member_id
            WHERE da.fk_club_id IN @C AND da.fk_year_id = @Y AND da.is_active = 1 AND da.isdeleted = 0;
            SELECT f.FieldKey, e.NumericValue FROM goal_entries e JOIN goal_fields f ON f.pk_field_id = e.fk_field_id
            WHERE @W AND e.EntityType = 'District' AND e.fk_district_id = @D AND e.fk_year_id = @Y AND e.isdeleted = 0
              AND e.NumericValue IS NOT NULL AND f.FieldKey IN ('new_members', 'total_contributions_target');
            SELECT SUM(target_count) FROM district_project_target
            WHERE @W AND fk_district_id = @D AND fk_year_id = @Y AND isdeleted = 0 AND IsActive = 1;",
            new { C = clubIds, D = districtId, Y = y.Id, YL = y.Label, S = y.Start, E = y.End, K = ClubGoalKeys, W = whole });

        var clubs = (await multi.ReadAsync<(int Id, string Name)>()).ToList();
        var people = (await multi.ReadAsync<(int Club, int Members, int Joined, int Left)>()).ToDictionary(r => r.Club);
        var growth = (await multi.ReadAsync<(int Club, int Target)>()).ToDictionary(r => r.Club, r => r.Target);
        var goals = (await multi.ReadAsync<(int Club, string Key, decimal Value)>()).ToLookup(r => r.Club);
        var dues = (await multi.ReadAsync<(int Club, int Roster, int Paid)>()).ToDictionary(r => r.Club);
        var attendance = (await multi.ReadAsync<(int Club, int Meetings, int Present)>()).ToDictionary(r => r.Club);
        var trf = (await multi.ReadAsync<(int Club, decimal Usd)>()).ToDictionary(r => r.Club, r => r.Usd);
        var projects = (await multi.ReadAsync<(int Club, int Count)>()).ToDictionary(r => r.Club, r => r.Count);
        var ags = (await multi.ReadAsync<(int Club, int Member, string? Name)>()).GroupBy(r => r.Club).ToDictionary(g => g.Key, g => g.First());
        var districtGoals = (await multi.ReadAsync<(string Key, decimal Value)>()).Where(r => r.Value > 0).ToDictionary(r => r.Key, r => r.Value);
        var districtProjects = await multi.ReadSingleAsync<decimal?>();

        // Attendance over all visible clubs: members present / (meetings x members).
        // shortcut: divides by today's member count, not the count on each meeting date (as the club dashboard does);
        // keep the roll size per meeting when the meeting record of spec 3.17 lands.
        long slots = 0, present = 0;
        foreach (var (id, name) in clubs)
        {
            people.TryGetValue(id, out var p);
            dues.TryGetValue(id, out var d);
            attendance.TryGetValue(id, out var a);
            var goal = goals[id].ToDictionary(g => g.Key, g => g.Value);
            var fund = ClubFundTargets.Where(goal.ContainsKey).Select(k => goal[k]).ToList();
            if (p.Members > 0) { slots += (long)a.Meetings * p.Members; present += a.Present; }
            // Attendance, meetings and projects carry no club target: per-club target entry is #29, not built.
            // shortcut: dues means the District Dues roster (club_dues), not a club's own member dues (membership_dues);
            // add those if districts want club collection tracked too.
            var hasAg = ags.TryGetValue(id, out var ag);
            var row = new TargetClubRowDto
            {
                ClubId = id, ClubName = name,
                AgMemberId = hasAg ? ag.Member : null,
                AgName = hasAg ? ag.Name : null,
                Metrics = new()
                {
                    ["members"] = Metric(p.Members, null, elapsed),
                    ["growth"] = Metric(p.Joined - p.Left, growth.TryGetValue(id, out var gt) ? gt : null, elapsed),
                    ["newMembers"] = Metric(p.Joined, goal.TryGetValue("new_members", out var nm) ? nm : null, elapsed),
                    ["dues"] = Metric(d.Paid, d.Roster > 0 ? d.Roster : null, elapsed),
                    ["attendance"] = Metric(Percent(a.Present, (long)a.Meetings * p.Members), null, elapsed),
                    ["meetings"] = Metric(a.Meetings, null, elapsed),
                    ["projects"] = Metric(projects.GetValueOrDefault(id), null, elapsed),
                    ["foundation"] = Metric(trf.GetValueOrDefault(id), fund.Count > 0 ? fund.Sum() : null, elapsed),
                },
            };
            row.Status = Worst(row.Metrics.Values);
            dto.Clubs.Add(row);
        }

        decimal Sum(string k) => dto.Clubs.Sum(r => r.Metrics[k].Actual);
        decimal? Targets(string k) => dto.Clubs.Any(r => r.Metrics[k].Target != null) ? dto.Clubs.Sum(r => r.Metrics[k].Target ?? 0) : null;
        decimal? DistrictGoal(string k) => districtGoals.TryGetValue(k, out var v) ? v : null;
        dto.Totals = new()
        {
            ["members"] = Metric(Sum("members"), null, elapsed),
            ["growth"] = Metric(Sum("growth"), Targets("growth"), elapsed),
            ["newMembers"] = Metric(Sum("newMembers"), DistrictGoal("new_members") ?? Targets("newMembers"), elapsed),
            ["dues"] = Metric(Sum("dues"), Targets("dues"), elapsed),
            ["attendance"] = Metric(Percent(present, slots), null, elapsed),
            ["meetings"] = Metric(Sum("meetings"), null, elapsed),
            ["projects"] = Metric(Sum("projects"), districtProjects > 0 ? districtProjects : null, elapsed),
            ["foundation"] = Metric(Sum("foundation"), DistrictGoal("total_contributions_target") ?? Targets("foundation"), elapsed),
        };
        dto.AgGroups = ags.Values.GroupBy(a => a.Member)
            .Select(g => new TargetAgGroupDto { MemberId = g.Key, Name = g.First().Name ?? "", Clubs = g.Count() })
            .OrderBy(g => g.Name).ToList();
        return dto;
    }

    private static decimal Percent(long part, long whole) => whole > 0 ? Math.Min(100m, Math.Round(100m * part / whole, 1)) : 0m;

    internal static TargetMetricDto Metric(decimal actual, decimal? target, double elapsed) => new()
    {
        Actual = actual,
        Target = target,
        Percent = target > 0 ? (int)Math.Clamp(Math.Round(actual * 100 / target.Value), -9999, 9999) : null,
        Status = StatusOf(actual, target, elapsed),
    };

    /// <summary>Green when progress has reached the share of the Rotary year passed (so also when the target is met),
    /// amber from 75% of that share, red below it; none without a target. A target of 0 or less is met by any actual
    /// at or above it.</summary>
    internal static string StatusOf(decimal actual, decimal? target, double elapsed)
    {
        if (target == null) return "none";
        if (target <= 0) return actual >= target ? "green" : "red";
        var progress = (double)(actual / target.Value);
        return progress >= elapsed ? "green" : progress >= 0.75 * elapsed ? "amber" : "red";
    }

    // shortcut: a straight line through the year by the server's date; use the month-wise target split
    // (GoalTargetSplitPilot) and the district's time zone once those apply to every district.
    /// <summary>Share of the Rotary year passed, today included: 0 before it starts, 1 after it ends.</summary>
    internal static double Elapsed(DateTime start, DateTime end, DateTime today)
        => Math.Clamp(((today.Date - start.Date).TotalDays + 1) / ((end.Date - start.Date).TotalDays + 1), 0, 1);

    private static string Worst(IEnumerable<TargetMetricDto> metrics)
    {
        var s = metrics.Select(m => m.Status).ToHashSet();
        return s.Contains("red") ? "red" : s.Contains("amber") ? "amber" : s.Contains("green") ? "green" : "none";
    }
}
