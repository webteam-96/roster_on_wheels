using Dapper;
using Microsoft.Extensions.Logging;
using MySqlConnector;

namespace AwardsAutoCalcWorker.Services;

// Standalone copy of the citation auto-points calculation logic, lifted out
// of RotaryApi/Services/CitationAutoPointsBackgroundService.cs. Same SQL,
// same logic, same perf optimisations:
//   • Year-wise projects table resolved ONCE per run (not per club × question)
//   • moduleIdMap hoisted ABOVE the district loop
//   • No legacy rotary_projects fallback — bails cleanly if year table missing
//
// Only the BackgroundService scheduling + IEmailService DI are dropped — those
// belong to the host (Program.cs hands the stats to BrevoEmailSender directly).
public class CitationCalculator
{
    private readonly string _connectionString;
    private readonly ILogger<CitationCalculator> _logger;
    private readonly YearTableResolver _yearTables;

    public CitationCalculator(string connectionString, ILogger<CitationCalculator> logger, YearTableResolver yearTables)
    {
        _connectionString = connectionString;
        _logger = logger;
        _yearTables = yearTables;
    }

    public sealed record RunStats(
        DateTime RunStartedAt,
        DateTime RunCompletedAt,
        string YearLabel,
        int DistrictCount,
        int ClubCount,
        int EntryCount,
        bool Skipped,
        string? SkipReason);

    public async Task<RunStats> CalculateAllAutoPointsAsync()
    {
        var runStart = DateTime.Now;
        int districtCount = 0, clubCount = 0, entryCount = 0;

        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();

        var currentYear = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT pk_year_id AS id, StartDate, EndDate, YearLabel FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1");
        if (currentYear == null)
        {
            _logger.LogWarning("No current rotary year set — skipping run.");
            return new RunStats(runStart, DateTime.Now, "", 0, 0, 0, true, "No current rotary year");
        }

        int yearId = (int)currentYear.id;
        DateTime startDate = (DateTime)currentYear.StartDate;
        DateTime endDate = (DateTime)currentYear.EndDate;
        string yearLabel = currentYear.YearLabel?.ToString() ?? "";

        var projInfo = await _yearTables.ResolveByYearIdAsync(conn, yearId);
        if (projInfo == null)
        {
            _logger.LogWarning("No year-wise projects table for current year {YearLabel} ({YearId}). Skipping.", yearLabel, yearId);
            return new RunStats(runStart, DateTime.Now, yearLabel, 0, 0, 0, true, $"No projects table for {yearLabel}");
        }
        string projTbl = projInfo.ProjectsTable;

        // Only districts that have citation questions configured for the year.
        var districtIds = (await conn.QueryAsync<int>(
            "SELECT DISTINCT fk_district_id FROM district_citation_auto_question WHERE fk_year_id = @YearId AND isdeleted = 0",
            new { YearId = yearId })).ToList();
        districtCount = districtIds.Count;
        if (districtIds.Count == 0)
        {
            _logger.LogInformation("No districts have citation auto questions for year {YearLabel}. Skipping.", yearLabel);
            return new RunStats(runStart, DateTime.Now, yearLabel, 0, 0, 0, true, "No districts configured");
        }

        // Module IDs identical across districts — fetch once.
        var moduleKeys = new Dictionary<string, string> {
            {"Club Service", "club_service"}, {"Community Service", "community_service"},
            {"Vocational Service", "vocational_service"}, {"International Service", "international_service"},
            {"New Generation Service", "new_generation_service"}, {"Public Image Initiative", "public_image_initiative"}
        };
        var moduleIdMap = new Dictionary<string, int>();
        foreach (var kv in moduleKeys)
        {
            var mid = await conn.ExecuteScalarAsync<int?>(
                "SELECT pk_module_id FROM module_master WHERE ModuleKey = @Key AND isdeleted = 0",
                new { Key = kv.Value });
            if (mid.HasValue) moduleIdMap[kv.Value] = mid.Value;
        }

        foreach (var districtId in districtIds)
        {
            var clubs = (await conn.QueryAsync<dynamic>(
                "SELECT pk_club_id AS id FROM club_master WHERE fk_district_id = @DistrictId AND isdeleted = 0 AND IsActive = 1",
                new { DistrictId = districtId })).ToList();

            var questions = (await conn.QueryAsync<dynamic>(@"
                SELECT q.pk_id AS id, q.fk_activity_id AS activityId, a.activity_name AS activityName, a.sub_type AS subType,
                       q.points, q.is_bonus AS isBonus, q.bonus_points AS bonusPoints, q.min_bonus AS minBonus, q.max_bonus AS maxBonus
                FROM district_citation_auto_question q
                INNER JOIN district_citation_activity_master a ON a.pk_id = q.fk_activity_id
                WHERE q.fk_district_id = @DistrictId AND q.fk_year_id = @YearId AND q.isdeleted = 0",
                new { DistrictId = districtId, YearId = yearId })).ToList();

            var qIds = questions.Select(q => (int)q.id).ToList();
            var subItems = qIds.Count > 0
                ? (await conn.QueryAsync<dynamic>(@"
                    SELECT pk_id AS id, fk_auto_question_id AS questionId, sub_item_type AS subItemType,
                           sub_item_id AS subItemId, sub_item_name AS subItemName,
                           points, is_bonus AS isBonus, bonus_points AS bonusPoints, min_bonus AS minBonus, max_bonus AS maxBonus
                    FROM district_citation_auto_question_sub WHERE fk_auto_question_id IN @Ids AND isdeleted = 0",
                    new { Ids = qIds })).ToList()
                : new List<dynamic>();

            foreach (var club in clubs)
            {
                int clubId = (int)club.id;
                clubCount++;

                foreach (var q in questions)
                {
                    string actName = (string)q.activityName;
                    var qSubs = subItems.Where(s => (int)s.questionId == (int)q.id).ToList();

                    // Pre-extract dynamic columns into typed locals so the
                    // CalculatePoints call isn't typed dynamic (dynamic args
                    // taint the entire call and break tuple deconstruction).
                    decimal qPoints      = (decimal)q.points;
                    bool    qIsBonus     = Convert.ToBoolean(q.isBonus);
                    decimal qBonusPoints = (decimal)q.bonusPoints;
                    int     qMinBonus    = (int)q.minBonus;
                    int     qMaxBonus    = (int)q.maxBonus;
                    int     qId          = (int)q.id;

                    if (qSubs.Count == 0 || qPoints > 0)
                    {
                        int count = await GetAutoCount(conn, actName, clubId, yearId, startDate, endDate, moduleIdMap, projTbl, null);
                        var (earned, bonus) = CalculatePoints(count, qPoints, qIsBonus, qBonusPoints, qMinBonus, qMaxBonus);
                        await SaveAutoEntry(conn, districtId, yearId, clubId, qId, null, count.ToString(), earned, bonus);
                        entryCount++;
                    }

                    foreach (var sub in qSubs)
                    {
                        decimal sPoints      = (decimal)sub.points;
                        bool    sIsBonus     = Convert.ToBoolean(sub.isBonus);
                        decimal sBonusPoints = (decimal)sub.bonusPoints;
                        int     sMinBonus    = (int)sub.minBonus;
                        int     sMaxBonus    = (int)sub.maxBonus;
                        int     subId        = (int)sub.id;
                        int subCount = await GetAutoCount(conn, actName, clubId, yearId, startDate, endDate, moduleIdMap, projTbl, sub);
                        var (subEarned, subBonus) = CalculatePoints(subCount, sPoints, sIsBonus, sBonusPoints, sMinBonus, sMaxBonus);
                        await SaveAutoEntry(conn, districtId, yearId, clubId, qId, subId, subCount.ToString(), subEarned, subBonus);
                        entryCount++;
                    }
                }
            }
        }

        return new RunStats(runStart, DateTime.Now, yearLabel, districtCount, clubCount, entryCount, false, null);
    }

    private async Task<int> GetAutoCount(MySqlConnection conn, string activityName, int clubId, int yearId,
        DateTime startDate, DateTime endDate, Dictionary<string, int> moduleIdMap, string projTbl, dynamic? subItem)
    {
        var act = activityName.ToLower();
        if (act.Contains("club website")) return 0;
        if (act.Contains("club dues"))    return 0;

        if (act.Contains("member addition") && act.Contains("lady"))
        {
            return await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM member_master_profile m
                INNER JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.IsActive = 1 AND cm.isdeleted = 0
                WHERE cm.fk_club_id = @ClubId AND m.isdeleted = 0 AND m.Gender = 'Female'
                  AND cm.JoinedDate >= @Start AND cm.JoinedDate <= @End",
                new { ClubId = clubId, Start = startDate, End = endDate });
        }
        if (act.Contains("member addition") && act.Contains("youth"))
        {
            return await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM member_master_profile m
                INNER JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.IsActive = 1 AND cm.isdeleted = 0
                WHERE cm.fk_club_id = @ClubId AND m.isdeleted = 0 AND m.IsYouth = 1
                  AND cm.JoinedDate >= @Start AND cm.JoinedDate <= @End",
                new { ClubId = clubId, Start = startDate, End = endDate });
        }
        if (act.Contains("member addition"))
        {
            return await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM member_master_profile m
                INNER JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.IsActive = 1 AND cm.isdeleted = 0
                WHERE cm.fk_club_id = @ClubId AND m.isdeleted = 0
                  AND cm.JoinedDate >= @Start AND cm.JoinedDate <= @End",
                new { ClubId = clubId, Start = startDate, End = endDate });
        }
        if (act.Contains("newsletter"))
        {
            return await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM newsletters WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND isdeleted = 0",
                new { ClubId = clubId, YearId = yearId });
        }
        if (act.Contains("club monthly report"))
        {
            return await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM club_monthly_reports WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND isdeleted = 0 AND IsUploadedToDistrict = 1",
                new { ClubId = clubId, YearId = yearId });
        }
        if (act.Contains("attendance"))
        {
            return await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM club_attendance WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND isdeleted = 0",
                new { ClubId = clubId, YearId = yearId });
        }

        if (act.Contains("club service"))
        {
            var modId = moduleIdMap.GetValueOrDefault("club_service", 0);
            if (modId == 0) return 0;
            if (subItem != null && (string)subItem.subItemType == "meeting_type")
            {
                string mtName = (string)subItem.subItemName;
                var mtMap = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
                    {"Regular","regular"},{"Fellowship","fellowship"},{"BOD","bod"},{"Assembly","assembly"},{"Trust","trust"}
                };
                var dbVal = mtMap.GetValueOrDefault(mtName, mtName.ToLower());
                return await conn.ExecuteScalarAsync<int>(
                    $"SELECT COUNT(*) FROM `{projTbl}` WHERE fk_club_id = @ClubId AND fk_module_id = @ModId AND fk_year_id = @YearId AND meeting_type = @Mt AND isdeleted = 0",
                    new { ClubId = clubId, ModId = modId, YearId = yearId, Mt = dbVal });
            }
            return await conn.ExecuteScalarAsync<int>(
                $"SELECT COUNT(*) FROM `{projTbl}` WHERE fk_club_id = @ClubId AND fk_module_id = @ModId AND fk_year_id = @YearId AND isdeleted = 0",
                new { ClubId = clubId, ModId = modId, YearId = yearId });
        }

        var serviceModuleMap = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
            {"community service","community_service"}, {"vocational service","vocational_service"},
            {"international service","international_service"}, {"new generation service","new_generation_service"},
            {"public image initiative","public_image_initiative"}
        };
        foreach (var kv in serviceModuleMap)
        {
            if (!act.Contains(kv.Key)) continue;
            var modId = moduleIdMap.GetValueOrDefault(kv.Value, 0);
            if (modId == 0) return 0;

            if (subItem != null)
            {
                string subType = (string)subItem.subItemType;
                int? subId = subItem.subItemId != null ? (int?)subItem.subItemId : null;

                if (subType == "area_of_focus" && subId.HasValue)
                    return await conn.ExecuteScalarAsync<int>(
                        $"SELECT COUNT(*) FROM `{projTbl}` WHERE fk_club_id=@ClubId AND fk_module_id=@ModId AND fk_year_id=@YearId AND fk_area_of_focus_id=@AofId AND isdeleted=0",
                        new { ClubId = clubId, ModId = modId, YearId = yearId, AofId = subId.Value });
            }

            return await conn.ExecuteScalarAsync<int>(
                $"SELECT COUNT(*) FROM `{projTbl}` WHERE fk_club_id=@ClubId AND fk_module_id=@ModId AND fk_year_id=@YearId AND isdeleted=0",
                new { ClubId = clubId, ModId = modId, YearId = yearId });
        }

        return 0;
    }

    private (decimal earned, decimal bonus) CalculatePoints(int count, decimal pointsPerUnit, bool isBonus, decimal bonusPoints, int minBonus, int maxBonus)
    {
        if (count == 0) return (0, 0);
        decimal earned;
        decimal bonus = 0;
        if (isBonus)
        {
            if (minBonus == 0 && maxBonus == 0)
            {
                earned = count * pointsPerUnit;
                bonus = bonusPoints;
            }
            else
            {
                int cappedCount = maxBonus > 0 && count > maxBonus ? maxBonus : count;
                earned = cappedCount * pointsPerUnit;
                if (count >= minBonus && minBonus > 0) bonus = bonusPoints;
            }
        }
        else
        {
            earned = count * pointsPerUnit;
        }
        return (earned, bonus);
    }

    private async Task SaveAutoEntry(MySqlConnection conn, int districtId, int yearId, int clubId, int questionId, int? subQuestionId, string countValue, decimal pointsEarned, decimal bonusEarned)
    {
        var existing = await conn.ExecuteScalarAsync<int?>(
            @"SELECT pk_id FROM district_citation_club_entry
              WHERE fk_district_id=@DistrictId AND fk_year_id=@YearId AND fk_club_id=@ClubId
                AND entry_type='auto' AND fk_question_id=@QId AND (fk_sub_question_id=@SubQId OR (@SubQId IS NULL AND fk_sub_question_id IS NULL))
                AND isdeleted=0",
            new { DistrictId = districtId, YearId = yearId, ClubId = clubId, QId = questionId, SubQId = subQuestionId });

        if (existing.HasValue)
        {
            await conn.ExecuteAsync(
                "UPDATE district_citation_club_entry SET answer_value=@Count, points_earned=@Points, bonus_earned=@Bonus, modified_date=NOW() WHERE pk_id=@Id",
                new { Id = existing.Value, Count = countValue, Points = pointsEarned, Bonus = bonusEarned });
        }
        else
        {
            await conn.ExecuteAsync(
                @"INSERT INTO district_citation_club_entry (fk_district_id, fk_year_id, fk_club_id, entry_type, fk_question_id, fk_sub_question_id, answer_value, points_earned, bonus_earned, created_date)
                  VALUES (@DistrictId, @YearId, @ClubId, 'auto', @QId, @SubQId, @Count, @Points, @Bonus, NOW())",
                new { DistrictId = districtId, YearId = yearId, ClubId = clubId, QId = questionId, SubQId = subQuestionId, Count = countValue, Points = pointsEarned, Bonus = bonusEarned });
        }
    }
}
