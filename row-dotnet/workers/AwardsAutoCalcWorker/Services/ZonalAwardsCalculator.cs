using Dapper;
using Microsoft.Extensions.Logging;
using MySqlConnector;

namespace AwardsAutoCalcWorker.Services;

// Standalone copy of RotaryApi.Services.ZonalAwardsAutoCalculationService.
// Adds an orchestrator (CalculateForCurrentYearAsync) that does the
// "current year + enabled zone + active district" filtering before calling
// CalculateForDistrictAsync per district. Returns RunStats for the email.
public class ZonalAwardsCalculator
{
    private readonly string _connectionString;
    private readonly ILogger<ZonalAwardsCalculator> _logger;
    private readonly YearTableResolver _yearTables;

    public ZonalAwardsCalculator(string connectionString, ILogger<ZonalAwardsCalculator> logger, YearTableResolver yearTables)
    {
        _connectionString = connectionString;
        _logger = logger;
        _yearTables = yearTables;
    }

    public sealed record RunStats(
        DateTime RunStartedAt,
        DateTime RunCompletedAt,
        string YearLabel,
        int DistrictsProcessed,
        int DistrictsFailed,
        bool Skipped,
        string? SkipReason);

    private static readonly int[] AutoQuestionSortOrders = new[] { 1, 4, 5, 7, 8, 15, 17, 19, 20, 21, 22, 24, 26, 27, 28, 29, 35, 36, 37 };

    public async Task<RunStats> CalculateForCurrentYearAsync()
    {
        var runStart = DateTime.Now;
        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();

        // Current rotary year only — never past or future.
        var year = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT pk_year_id AS id, YearLabel FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1");
        if (year == null)
        {
            _logger.LogWarning("No current rotary year set — skipping.");
            return new RunStats(runStart, DateTime.Now, "", 0, 0, true, "No current year");
        }
        int yearId = (int)year.id;
        string yearLabel = (string?)year.YearLabel ?? "";

        // Only run when ZA has at least one goal configured for this year.
        var hasGoals = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM zonal_awards_goal WHERE fk_year_id = @Y AND isdeleted = 0",
            new { Y = yearId });
        if (hasGoals == 0)
        {
            _logger.LogInformation("Zonal awards: no goals configured for {YearLabel} ({YearId}). Skipping.", yearLabel, yearId);
            return new RunStats(runStart, DateTime.Now, yearLabel, 0, 0, true, "No goals configured");
        }

        // Districts in zones where Zonal Awards is enabled + both active.
        var districtIds = (await conn.QueryAsync<int>(@"
            SELECT d.pk_district_id
            FROM district_master d
            INNER JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE d.isdeleted = 0 AND d.IsActive = 1
              AND z.isdeleted = 0 AND z.IsActive = 1
              AND z.IsZonalAwardsEnabled = 1")).ToList();

        if (districtIds.Count == 0)
        {
            _logger.LogInformation("No active districts in zones with Zonal Awards enabled. Skipping.");
            return new RunStats(runStart, DateTime.Now, yearLabel, 0, 0, true, "No eligible districts");
        }

        int processed = 0, failed = 0;
        foreach (var districtId in districtIds)
        {
            try
            {
                await CalculateForDistrictAsync(districtId, yearId);
                processed++;
            }
            catch (Exception ex)
            {
                failed++;
                _logger.LogError(ex, "Failed calculating zonal awards for district {D}", districtId);
            }
        }
        return new RunStats(runStart, DateTime.Now, yearLabel, processed, failed, false, null);
    }

    public async Task CalculateForDistrictAsync(int districtId, int yearId)
    {
        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();

        var year = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT StartDate, EndDate FROM rotary_year_master WHERE pk_year_id = @Y", new { Y = yearId });
        if (year == null) return;
        DateTime startDate = (DateTime)year.StartDate;
        DateTime endDate = (DateTime)year.EndDate;

        var questions = (await conn.QueryAsync<dynamic>(@"
            SELECT q.pk_id AS id, q.sort_order AS sortOrder
            FROM zonal_awards_question q
            JOIN zonal_awards_goal g ON g.pk_id = q.fk_goal_id
            WHERE g.fk_year_id = @Y AND q.isdeleted = 0 AND g.isdeleted = 0
              AND q.sort_order IN @Sorts", new { Y = yearId, Sorts = AutoQuestionSortOrders })).ToList();
        if (questions.Count == 0) return;

        var qIds = questions.Select(q => (int)q.id).ToList();
        var options = (await conn.QueryAsync<dynamic>(@"
            SELECT pk_id AS id, fk_question_id AS questionId, mini, maxi, points, atleast, subtype, sort_order AS sortOrder
            FROM zonal_awards_question_option
            WHERE fk_question_id IN @Ids AND isdeleted = 0
            ORDER BY fk_question_id, sort_order", new { Ids = qIds })).ToList();

        // Zero-out existing entries for these options (UPDATE only).
        var optionIds = options.Select(o => (int)o.id).ToList();
        if (optionIds.Count > 0)
        {
            await conn.ExecuteAsync(@"
                UPDATE zonal_awards_district_entry
                SET entered_counts = 0, received_points = 0
                WHERE fk_district_id = @D AND fk_year_id = @Y AND fk_option_id IN @OptIds",
                new { D = districtId, Y = yearId, OptIds = optionIds });
        }

        foreach (var q in questions)
        {
            int qId = (int)q.id;
            int sortOrder = (int)q.sortOrder;
            var qOpts = options.Where(o => (int)o.questionId == qId).ToList();

            try
            {
                switch (sortOrder)
                {
                    case 1: await CalcQ1_NewClubs(conn, districtId, yearId, startDate, endDate, qOpts); break;
                    case 4: await CalcQ4_AvgMembers(conn, districtId, yearId, endDate, qOpts); break;
                    case 5: await CalcQ5_HealthyClubs(conn, districtId, yearId, endDate, qOpts); break;
                    case 7: await CalcQ7_WomenInRotary(conn, districtId, yearId, endDate, qOpts); break;
                    case 8: await CalcQ8_PercentWomen(conn, districtId, yearId, endDate, qOpts); break;
                    case 15: await CalcRangeProject(conn, districtId, yearId, startDate, endDate, qOpts, aof: 59); break;
                    case 17: await CalcRangeProject(conn, districtId, yearId, startDate, endDate, qOpts, aof: 2, cat: 13, subcat: 44); break;
                    case 19: await CalcQ19_MedicalMission(conn, districtId, yearId, startDate, endDate, qOpts); break;
                    case 20: await CalcRangeProject(conn, districtId, yearId, startDate, endDate, qOpts, aof: 41); break;
                    case 21: await CalcRangeProject(conn, districtId, yearId, startDate, endDate, qOpts, aof: 50); break;
                    case 22: await CalcRangeProject(conn, districtId, yearId, startDate, endDate, qOpts, aof: 51); break;
                    case 24: await CalcRangeProject(conn, districtId, yearId, startDate, endDate, qOpts, aof: 31); break;
                    case 26: await CalcRangeProject(conn, districtId, yearId, startDate, endDate, qOpts, aof: 39); break;
                    case 27: await CalcRangeProject(conn, districtId, yearId, startDate, endDate, qOpts, cat: 129); break;
                    case 28: await CalcRangeProject(conn, districtId, yearId, startDate, endDate, qOpts, cat: 130); break;
                    case 29: await CalcRangeProject(conn, districtId, yearId, startDate, endDate, qOpts, cat: 131); break;
                    case 35: await CalcRangeProject(conn, districtId, yearId, startDate, endDate, qOpts, aof: 54, perCount: true); break;
                    case 36: await CalcRangeProject(conn, districtId, yearId, startDate, endDate, qOpts, aof: 55, perCount: true); break;
                    case 37: await CalcRangeProject(conn, districtId, yearId, startDate, endDate, qOpts, aof: 56); break;
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error calculating zonal awards auto Q{Sort} for district {D} year {Y}", sortOrder, districtId, yearId);
            }
        }
    }

    private async Task CalcQ1_NewClubs(MySqlConnection conn, int districtId, int yearId, DateTime start, DateTime end, List<dynamic> opts)
    {
        var monthly = (await conn.QueryAsync<dynamic>(@"
            SELECT MONTH(ClubCharterDate) AS m, COUNT(*) AS c
            FROM club_master
            WHERE fk_district_id = @D AND isdeleted = 0
              AND ClubCharterDate >= @S AND ClubCharterDate <= @E
            GROUP BY MONTH(ClubCharterDate)", new { D = districtId, S = start, E = end })).ToList();
        var monthCounts = monthly.ToDictionary(x => (int)x.m, x => (int)x.c);
        int yearTotal = monthCounts.Values.Sum();
        await SaveRangeMatch(conn, districtId, yearId, 0, opts, yearTotal, perCount: true);
        foreach (var kv in monthCounts)
            await SaveRangeMatch(conn, districtId, yearId, kv.Key, opts, kv.Value, perCount: true);
    }

    private async Task CalcQ4_AvgMembers(MySqlConnection conn, int districtId, int yearId, DateTime end, List<dynamic> opts)
    {
        int totalClubs = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM club_master WHERE fk_district_id = @D AND isdeleted = 0 AND IsActive = 1",
            new { D = districtId });
        if (totalClubs == 0) return;
        int totalMembers = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM member_master_profile m
            INNER JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
                AND cm.IsActive = 1 AND cm.isdeleted = 0
            INNER JOIN club_master c ON c.pk_club_id = cm.fk_club_id
            WHERE c.fk_district_id = @D AND c.isdeleted = 0 AND c.IsActive = 1
              AND m.isdeleted = 0 AND cm.JoinedDate <= @E",
            new { D = districtId, E = end });
        int avg = totalMembers / totalClubs;
        await SaveRangeMatch(conn, districtId, yearId, 0, opts, avg);
    }

    private async Task CalcQ5_HealthyClubs(MySqlConnection conn, int districtId, int yearId, DateTime end, List<dynamic> opts)
    {
        var clubMemberCounts = (await conn.QueryAsync<dynamic>(@"
            SELECT c.pk_club_id AS clubId, COUNT(m.pk_member_master_profile_id) AS memberCount
            FROM club_master c
            LEFT JOIN club_members cm ON cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                AND m.isdeleted = 0 AND cm.JoinedDate <= @E
            WHERE c.fk_district_id = @D AND c.isdeleted = 0 AND c.IsActive = 1
            GROUP BY c.pk_club_id", new { D = districtId, E = end })).ToList();
        int totalClubs = clubMemberCounts.Count;
        if (totalClubs == 0) return;

        int redCount = 0, amberCount = 0, greenCount = 0;
        foreach (var cm in clubMemberCounts)
        {
            int clubId = (int)cm.clubId;
            int count = Convert.ToInt32(cm.memberCount);
            string flag;
            if (count >= 10 && count <= 25)        { flag = "Red";   redCount++; }
            else if (count >= 26 && count <= 40)   { flag = "Amber"; amberCount++; }
            else if (count >= 41)                  { flag = "Green"; greenCount++; }
            else                                   { flag = "None"; }
            await conn.ExecuteAsync(
                "UPDATE club_master SET Is_healthy_club = @F WHERE pk_club_id = @Id",
                new { F = flag, Id = clubId });
        }

        decimal pctRed = (decimal)redCount * 100 / totalClubs;
        decimal pctAmber = (decimal)amberCount * 100 / totalClubs;
        decimal pctGreen = (decimal)greenCount * 100 / totalClubs;

        foreach (var o in opts)
        {
            int sort = (int)o.sortOrder;
            decimal pts = (decimal)o.points;
            bool match = false;
            decimal enteredVal = 0;
            if (sort == 1)      { match = pctRed   < 30; enteredVal = pctRed;   }
            else if (sort == 2) { match = pctAmber >= 40; enteredVal = pctAmber; }
            else if (sort == 3) { match = pctGreen > 30; enteredVal = pctGreen; }
            await InsertEntry(conn, (int)o.id, districtId, yearId, 0, (int)enteredVal, match ? pts : 0);
        }
    }

    private async Task CalcQ7_WomenInRotary(MySqlConnection conn, int districtId, int yearId, DateTime end, List<dynamic> opts)
    {
        int totalClubs = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM club_master WHERE fk_district_id = @D AND isdeleted = 0 AND IsActive = 1",
            new { D = districtId });
        if (totalClubs == 0) return;
        int clubsWith4PlusWomen = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM (
                SELECT c.pk_club_id
                FROM club_master c
                INNER JOIN club_members cm ON cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0
                INNER JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                    AND m.isdeleted = 0 AND m.Gender = 'Female' AND cm.JoinedDate <= @E
                WHERE c.fk_district_id = @D AND c.isdeleted = 0 AND c.IsActive = 1
                GROUP BY c.pk_club_id
                HAVING COUNT(m.pk_member_master_profile_id) >= 4
            ) t", new { D = districtId, E = end });
        int pct = (int)((decimal)clubsWith4PlusWomen * 100 / totalClubs);
        await SaveRangeMatch(conn, districtId, yearId, 0, opts, pct);
    }

    private async Task CalcQ8_PercentWomen(MySqlConnection conn, int districtId, int yearId, DateTime end, List<dynamic> opts)
    {
        int totalMembers = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM member_master_profile m
            INNER JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
                AND cm.IsActive = 1 AND cm.isdeleted = 0
            INNER JOIN club_master c ON c.pk_club_id = cm.fk_club_id
            WHERE c.fk_district_id = @D AND c.isdeleted = 0 AND c.IsActive = 1
              AND m.isdeleted = 0 AND cm.JoinedDate <= @E",
            new { D = districtId, E = end });
        if (totalMembers == 0) return;
        int womenMembers = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM member_master_profile m
            INNER JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
                AND cm.IsActive = 1 AND cm.isdeleted = 0
            INNER JOIN club_master c ON c.pk_club_id = cm.fk_club_id
            WHERE c.fk_district_id = @D AND c.isdeleted = 0 AND c.IsActive = 1
              AND m.isdeleted = 0 AND m.Gender = 'Female' AND cm.JoinedDate <= @E",
            new { D = districtId, E = end });
        int pct = (int)((decimal)womenMembers * 100 / totalMembers);
        await SaveRangeMatch(conn, districtId, yearId, 0, opts, pct);
    }

    private async Task CalcQ19_MedicalMission(MySqlConnection conn, int districtId, int yearId, DateTime start, DateTime end, List<dynamic> opts)
    {
        var projInfo = await _yearTables.ResolveByYearIdAsync(conn, yearId);
        if (projInfo == null) return;
        var projTbl = projInfo.ProjectsTable;

        foreach (var o in opts)
        {
            int sort = (int)o.sortOrder;
            int subcat = sort == 1 ? 285 : 286;
            var monthly = (await conn.QueryAsync<dynamic>($@"
                SELECT MONTH(p.project_date) AS m, COUNT(*) AS c
                FROM `{projTbl}` p
                INNER JOIN club_master c ON c.pk_club_id = p.fk_club_id
                WHERE c.fk_district_id = @D AND c.isdeleted = 0
                  AND p.isdeleted = 0
                  AND p.fk_sub_category_id = @Sub
                  AND p.project_date >= @S AND p.project_date <= @E
                GROUP BY MONTH(p.project_date)",
                new { D = districtId, Sub = subcat, S = start, E = end })).ToList();
            var monthCounts = monthly.ToDictionary(x => (int)x.m, x => (int)x.c);
            int total = monthCounts.Values.Sum();
            decimal pts = (decimal)o.points;
            await InsertEntry(conn, (int)o.id, districtId, yearId, 0, total, total > 0 ? pts * total : 0);
            foreach (var kv in monthCounts)
                await InsertEntry(conn, (int)o.id, districtId, yearId, kv.Key, kv.Value, pts * kv.Value);
        }
    }

    private async Task CalcRangeProject(MySqlConnection conn, int districtId, int yearId, DateTime start, DateTime end, List<dynamic> opts, int? aof = null, int? cat = null, int? subcat = null, bool perCount = false)
    {
        var projInfo = await _yearTables.ResolveByYearIdAsync(conn, yearId);
        if (projInfo == null) return;
        var projTbl = projInfo.ProjectsTable;

        var whereParts = new List<string> {
            "c.fk_district_id = @D", "c.isdeleted = 0",
            "p.isdeleted = 0",
            "p.project_date >= @S", "p.project_date <= @E"
        };
        if (aof.HasValue) whereParts.Add("p.fk_area_of_focus_id = @Aof");
        if (cat.HasValue) whereParts.Add("p.fk_category_id = @Cat");
        if (subcat.HasValue) whereParts.Add("p.fk_sub_category_id = @Sub");

        var sql = $@"
            SELECT MONTH(p.project_date) AS m, COUNT(*) AS c
            FROM `{projTbl}` p
            INNER JOIN club_master c ON c.pk_club_id = p.fk_club_id
            WHERE {string.Join(" AND ", whereParts)}
            GROUP BY MONTH(p.project_date)";
        var monthly = (await conn.QueryAsync<dynamic>(sql,
            new { D = districtId, S = start, E = end, Aof = aof, Cat = cat, Sub = subcat })).ToList();
        var monthCounts = monthly.ToDictionary(x => (int)x.m, x => (int)x.c);
        int yearTotal = monthCounts.Values.Sum();
        await SaveRangeMatch(conn, districtId, yearId, 0, opts, yearTotal, perCount);
        foreach (var kv in monthCounts)
            await SaveRangeMatch(conn, districtId, yearId, kv.Key, opts, kv.Value, perCount);
    }

    private async Task SaveRangeMatch(MySqlConnection conn, int districtId, int yearId, int month, List<dynamic> opts, int count, bool perCount = false)
    {
        dynamic? winner = null;
        foreach (var o in opts)
        {
            int mini = (int)o.mini;
            int maxi = (int)o.maxi;
            if (mini == 0 && maxi == 0) continue;
            if (count >= mini && count <= maxi)
            {
                if (winner == null || (int)o.mini > (int)winner.mini)
                    winner = o;
            }
        }
        if (winner != null && count > 0)
        {
            decimal pts = (decimal)winner.points;
            decimal totalPts = perCount ? pts * count : pts;
            await InsertEntry(conn, (int)winner.id, districtId, yearId, month, count, totalPts);
        }
    }

    private async Task InsertEntry(MySqlConnection conn, int optionId, int districtId, int yearId, int month, int enteredCounts, decimal receivedPoints)
    {
        await conn.ExecuteAsync(@"
            INSERT INTO zonal_awards_district_entry (fk_option_id, fk_district_id, fk_year_id, month, entered_counts, received_points, created_by)
            VALUES (@Opt, @D, @Y, @M, @C, @P, 0)
            ON DUPLICATE KEY UPDATE entered_counts = @C, received_points = @P, modified_date = CURRENT_TIMESTAMP",
            new { Opt = optionId, D = districtId, Y = yearId, M = month, C = enteredCounts, P = receivedPoints });
    }
}
