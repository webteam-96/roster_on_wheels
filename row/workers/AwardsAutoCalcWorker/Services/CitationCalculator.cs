using RotaryApi.Services;
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
        var runStart = DateTime.UtcNow;
        int districtCount = 0, clubCount = 0, entryCount = 0;

        using var conn = RowDb.Connect(_connectionString);
        await conn.OpenAsync();

        var currentYear = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT pk_year_id AS id, StartDate, EndDate, YearLabel FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1");
        if (currentYear == null)
        {
            _logger.LogWarning("No current rotary year set — skipping run.");
            return new RunStats(runStart, DateTime.UtcNow, "", 0, 0, 0, true, "No current rotary year");
        }

        int yearId = (int)currentYear.id;
        DateTime startDate = (DateTime)currentYear.StartDate;
        DateTime endDate = (DateTime)currentYear.EndDate;
        string yearLabel = currentYear.YearLabel?.ToString() ?? "";

        var projInfo = await _yearTables.ResolveByYearIdAsync(conn, yearId);
        if (projInfo == null)
        {
            _logger.LogWarning("No year-wise projects table for current year {YearLabel} ({YearId}). Skipping.", yearLabel, yearId);
            return new RunStats(runStart, DateTime.UtcNow, yearLabel, 0, 0, 0, true, $"No projects table for {yearLabel}");
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
            return new RunStats(runStart, DateTime.UtcNow, yearLabel, 0, 0, 0, true, "No districts configured");
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
                       q.points, q.is_bonus AS isBonus, q.bonus_points AS bonusPoints, q.min_bonus AS minBonus, q.max_bonus AS maxBonus, COALESCE(q.per_unit, 1) AS perUnit
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
                    int     qPerUnit     = Convert.ToInt32(q.perUnit);
                    int     qId          = (int)q.id;

                    if (qSubs.Count == 0 || qPoints > 0)
                    {
                        int count = await GetAutoCount(conn, actName, clubId, yearId, startDate, endDate, moduleIdMap, projTbl, null);
                        var (earned, bonus) = CalculatePoints(count, qPoints, qIsBonus, qBonusPoints, qMinBonus, qMaxBonus, qPerUnit);
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

        return new RunStats(runStart, DateTime.UtcNow, yearLabel, districtCount, clubCount, entryCount, false, null);
    }

    // Disha Goals nightly (user 2026-11-18) - same as RotaryApi DishaAwardsController.RefreshAutoAsync: for every
    // Rotary.org district (synced clubs, not Zone 0), each Disha AUTO line of the owners whose scope covers it
    // (owner 0 = shared defaults = all; Super Admin / RI Director role = all; RI Director goal seat = its zones):
    // RISAO activity = the district's RISAO figure (or its clubs added up when RISAO has no district figure), any other
    // activity = the District Awards count added up over the district's clubs. Points: District Awards formula.
    // Saved in disha_district_entry. Current year. Returns how many answers were written.
    private static readonly Dictionary<string, string> RisaoDistrictField = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Annual Fund"] = "annual_fund_achieved", ["PolioPlus Fund"] = "polio_plus_achieved",
        ["Endowment Fund"] = "endowment_achieved", ["Total Giving"] = "total_giving_achieved",
        ["CSR with RFI"] = "csr_achieved",
    };

    // Disha questions that ARE a Goal Setting box (user 2026-11-18) - same list as RotaryApi DishaGoalLinks:
    // answer = Goal Setting's Achieved (total, as on 1 July + added); points on what was added this year.
    private static (string Ach, string Base)? GoalSettingLink(string activityName)
    {
        var a = PlainAct(activityName).ToLowerInvariant().Replace(" ", "");
        if (a == "newclubs") return ("new_clubs_achieved", "total_clubs");
        if ((a.Contains("memberaddition") && a.Contains("lady")) || a == "womenmembers") return ("new_women_members_achieved", "existing_women_members");
        if (a == "memberaddition") return ("new_members_achieved", "total_members");
        return null;
    }

    private static async Task<Dictionary<string, decimal>> GoalSettingValuesAsync(MySqlConnection conn, int districtId, int yearId, params string[] keys) =>
        (await conn.QueryAsync<(string K, decimal V)>(@"
            SELECT f.FieldKey, e.NumericValue FROM goal_entries e
            JOIN goal_fields f ON f.pk_field_id = e.fk_field_id AND f.isdeleted = 0
            WHERE e.fk_year_id = @Y AND e.EntityType = 'District' AND e.fk_district_id = @D AND e.fk_club_id = 0
              AND e.isdeleted = 0 AND e.NumericValue IS NOT NULL AND f.FieldKey IN @K",
            new { Y = yearId, D = districtId, K = keys }))
        .GroupBy(x => x.K).ToDictionary(g => g.Key, g => g.First().V);

    public async Task<int> CalculateDishaAutoAsync()
    {
        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        if (await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'disha_auto_question'") == 0) return 0;
        // ROW: Disha Goals are off (owner 2026-11-27) - only run once a Super Admin turns "disha_goals" on (Settings > Features).
        if (await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'platform_features'") == 0
            || await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM platform_features WHERE feature_key = 'disha_goals' AND enabled = 1") == 0) return 0;
        var year = await conn.QueryFirstOrDefaultAsync<dynamic>("SELECT pk_year_id AS id, StartDate, EndDate FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1");
        if (year == null) return 0;
        int yearId = (int)year.id;
        var projInfo = await _yearTables.ResolveByYearIdAsync(conn, yearId);
        if (projInfo == null) return 0;

        // Owners with auto questions this year, and the districts each covers.
        var owners = (await conn.QueryAsync<int>("SELECT DISTINCT fk_owner_id FROM disha_auto_question WHERE fk_year_id = @Y AND isdeleted = 0", new { Y = yearId })).ToList();
        if (owners.Count == 0) return 0;
        const string baseSql = @"SELECT d.pk_district_id FROM district_master d JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE d.isdeleted = 0 AND COALESCE(d.IsActive,1) = 1 AND z.ZoneName NOT IN ('Zone 0','Other Zones')
              AND EXISTS (SELECT 1 FROM club_master c WHERE c.fk_district_id = d.pk_district_id AND c.IsSyncedFromRotaryOrg = 1 AND c.isdeleted = 0 AND c.IsActive = 1)";
        var allDistricts = (await conn.QueryAsync<int>(baseSql)).ToList();
        var scope = new Dictionary<int, HashSet<int>>();
        foreach (var o in owners)
        {
            bool all = o == 0 || await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM member_roles WHERE fk_member_master_profile_id = @M AND fk_role_id IN (3, 7) AND IsActive = 1 AND isdeleted = 0", new { M = o }) > 0;
            scope[o] = all ? allDistricts.ToHashSet() : (await conn.QueryAsync<int>(baseSql + @" AND d.fk_zone_id IN (
                SELECT z2.fk_zone_id FROM goal_role_assignments a JOIN goal_role_assignment_zones z2 ON z2.fk_assignment_id = a.pk_id
                WHERE a.fk_member_id = @M AND a.RoleType = 'AllCategoryAllDistrictsFewZones' AND a.IsActive = 1 AND a.isdeleted = 0)", new { M = o })).ToHashSet();
        }

        var qs = (await conn.QueryAsync<dynamic>(@"
            SELECT q.pk_id AS id, q.fk_owner_id AS ownerId, a.activity_name AS act, q.points, q.is_bonus AS isBonus, q.bonus_points AS bonusPoints,
                   q.min_bonus AS minBonus, q.max_bonus AS maxBonus, COALESCE(q.per_unit, 1) AS perUnit
            FROM disha_auto_question q JOIN district_citation_activity_master a ON a.pk_id = q.fk_activity_id
            WHERE q.fk_year_id = @Y AND q.isdeleted = 0", new { Y = yearId })).ToList();
        var subs = (await conn.QueryAsync<dynamic>(@"
            SELECT s.pk_id AS id, s.fk_auto_question_id AS qid, s.sub_item_type AS subItemType, s.sub_item_id AS subItemId, s.sub_item_name AS subItemName,
                   s.points, s.is_bonus AS isBonus, s.bonus_points AS bonusPoints, s.min_bonus AS minBonus, s.max_bonus AS maxBonus
            FROM disha_auto_question_sub s WHERE s.fk_auto_question_id IN @Ids AND s.isdeleted = 0", new { Ids = qs.Select(q => (int)q.id) })).ToList();

        var moduleIdMap = new Dictionary<string, int>();
        foreach (var key in new[] { "club_service", "community_service", "vocational_service", "international_service", "new_generation_service", "public_image_initiative" })
        {
            var mid = await conn.ExecuteScalarAsync<int?>("SELECT pk_module_id FROM module_master WHERE ModuleKey = @Key AND isdeleted = 0", new { Key = key });
            if (mid.HasValue) moduleIdMap[key] = mid.Value;
        }

        int written = 0;
        foreach (var d in allDistricts)
        {
            var clubIds = (await conn.QueryAsync<int>("SELECT pk_club_id FROM club_master WHERE fk_district_id = @D AND isdeleted = 0 AND IsActive = 1", new { D = d })).ToList();
            foreach (var q in qs.Where(q => scope.TryGetValue((int)q.ownerId, out var sc) && sc.Contains(d)))
            {
                string act = (string)q.act;
                var qSubs = subs.Where(x => (int)x.qid == (int)q.id).ToList();
                var lines = new List<(int? SubId, dynamic? Sub, decimal Pts, bool IsB, decimal BonusPts, int MinB, int MaxB, int PerUnit)>();
                if (qSubs.Count == 0 || (decimal)q.points > 0)
                    lines.Add((null, null, (decimal)q.points, Convert.ToBoolean(q.isBonus), (decimal)q.bonusPoints, (int)q.minBonus, (int)q.maxBonus, Convert.ToInt32(q.perUnit)));
                foreach (var x in qSubs)
                    lines.Add(((int)x.id, x, (decimal)x.points, Convert.ToBoolean(x.isBonus), (decimal)x.bonusPoints, (int)x.minBonus, (int)x.maxBonus, 1));
                foreach (var l in lines)
                {
                    int? count = null;
                    string? answerOverride = null;
                    var gsLink = GoalSettingLink(act);
                    if (gsLink != null)
                    {
                        var gv = await GoalSettingValuesAsync(conn, d, yearId, gsLink.Value.Ach, gsLink.Value.Base);
                        if (!gv.TryGetValue(gsLink.Value.Ach, out var ach)) continue;
                        count = (int)Math.Round(Math.Max(0m, ach - gv.GetValueOrDefault(gsLink.Value.Base)), MidpointRounding.AwayFromZero);
                        answerOverride = Math.Round(ach, 0, MidpointRounding.AwayFromZero).ToString(System.Globalization.CultureInfo.InvariantCulture);
                    }
                    else if (RisaoDistrictField.TryGetValue(PlainAct(act), out var field))
                    {
                        var fv = (await conn.QueryAsync<(string Field, decimal? Val)>(@"
                            SELECT gf.FieldKey, e.NumericValue FROM goal_entries e JOIN goal_fields gf ON gf.pk_field_id = e.fk_field_id AND gf.isdeleted = 0
                            WHERE e.fk_year_id = @Y AND e.EntityType = 'District' AND e.fk_district_id = @D AND e.fk_club_id = 0 AND e.isdeleted = 0
                              AND e.NumericValue IS NOT NULL AND gf.FieldKey IN @F",
                            new { Y = yearId, D = d, F = DistrictFundFields.Append(field) })).GroupBy(x => x.Field).ToDictionary(g => g.Key, g => g.First().Val!.Value);
                        var v = DistrictFigure(field, fv);
                        if (v != null) count = (int)Math.Round(v.Value, MidpointRounding.AwayFromZero);
                    }
                    if (count == null)
                    {
                        int total = 0;
                        foreach (var clubId in clubIds)
                            total += await GetAutoCount(conn, act, clubId, yearId, (DateTime)year.StartDate, (DateTime)year.EndDate, moduleIdMap, projInfo.ProjectsTable, l.Sub);
                        count = total;
                    }
                    var (earned, bonus) = CalculatePoints(count.Value, l.Pts, l.IsB, l.BonusPts, l.MinB, l.MaxB, l.PerUnit);
                    var prm = new { Y = yearId, D = d, Q = (int)q.id, S = l.SubId, V = answerOverride ?? count.Value.ToString(), P = earned, B = bonus };
                    var id = await conn.ExecuteScalarAsync<int?>(@"SELECT pk_id FROM disha_district_entry WHERE fk_year_id = @Y AND fk_district_id = @D AND entry_type = 'auto'
                        AND fk_question_id = @Q AND (fk_sub_question_id <=> @S) AND isdeleted = 0 LIMIT 1", prm);
                    if (id.HasValue)
                        await conn.ExecuteAsync("UPDATE disha_district_entry SET answer_value = @V, points_earned = @P, bonus_earned = @B, modified_date = NOW() WHERE pk_id = @Id",
                            new { Id = id.Value, prm.V, prm.P, prm.B });
                    else
                        await conn.ExecuteAsync(@"INSERT INTO disha_district_entry (fk_year_id, fk_district_id, entry_type, fk_question_id, fk_sub_question_id, answer_value, points_earned, bonus_earned)
                            VALUES (@Y, @D, 'auto', @Q, @S, @V, @P, @B)", prm);
                    written++;
                }
            }
        }
        return written;
    }

    // RISAO-linked goal questions (user 2026-11-17): the figure the RISAO import wrote into Goal Setting becomes the
    // answer - District Set Goals (club figure -> the club's District Awards entry, with the awards points) and
    // Disha Goals (district figure). Same lists / rules as RotaryApi GoalFlowController.RisaoSources. Current year.
    private static readonly Dictionary<string, (string? Club, string? District)> RisaoFields = new()
    {
        ["annual_fund"] = ("club_annual_fund_ytd", "annual_fund_achieved"),
        ["polioplus"] = ("club_polioplus_ytd", "polio_plus_achieved"),
        ["endowment"] = ("club_endowment_ytd", "endowment_achieved"),
        ["csr"] = (null, "csr_achieved"),
        ["other_funds"] = ("club_other_funds_ytd", null),
        ["af_per_capita"] = ("club_af_per_capita", null),
        ["total_giving"] = ("club_total_ytd", "total_giving_achieved"),
    };

    // Same figures the Goal Setting screen shows: club Total = stored Total, or when empty the 5 club funds added up;
    // district Total Giving = Annual Fund + PolioPlus + Endowment + CSR, always.
    private static readonly string[] ClubFundFields = { "club_af_per_capita", "club_annual_fund_ytd", "club_polioplus_ytd", "club_other_funds_ytd", "club_endowment_ytd" };
    private static readonly string[] DistrictFundFields = { "annual_fund_achieved", "polio_plus_achieved", "endowment_achieved", "csr_achieved" };
    private static decimal? ClubFigure(string field, Dictionary<string, decimal> fv)
    {
        if (fv.TryGetValue(field, out var v)) return v;
        if (field != "club_total_ytd") return null;
        var parts = ClubFundFields.Where(fv.ContainsKey).ToList();
        return parts.Count == 0 ? null : parts.Sum(k => fv[k]);
    }
    private static decimal? DistrictFigure(string field, Dictionary<string, decimal> fv)
    {
        if (field != "total_giving_achieved") return fv.TryGetValue(field, out var v) ? v : null;
        var parts = DistrictFundFields.Where(fv.ContainsKey).ToList();
        return parts.Count == 0 ? null : parts.Sum(k => fv[k]);
    }

    private static readonly Dictionary<string, string> RisaoActivityField = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Annual Fund"] = "club_annual_fund_ytd", ["PolioPlus Fund"] = "club_polioplus_ytd",
        ["Endowment Fund"] = "club_endowment_ytd", ["Other Funds"] = "club_other_funds_ytd",
        ["Annual Fund per capita"] = "club_af_per_capita", ["Total Giving"] = "club_total_ytd",
    };
    // Activity names carry no "RISAO" (user 2026-11-18); the old "RISAO - x" names are still understood.
    private static string PlainAct(string? n)
    {
        n = (n ?? "").Trim();
        return n.StartsWith("RISAO - ", StringComparison.OrdinalIgnoreCase) ? n[8..].Trim() : n;
    }
    private static async Task<int> RisaoClubCountAsync(MySqlConnection conn, string activityName, int clubId, int yearId)
    {
        if (!RisaoActivityField.TryGetValue(PlainAct(activityName), out var field)) return 0;
        var fv = (await conn.QueryAsync<(string Field, decimal? Val)>(@"
            SELECT f.FieldKey, e.NumericValue FROM goal_entries e
            JOIN goal_fields f ON f.pk_field_id = e.fk_field_id AND f.isdeleted = 0
            WHERE e.fk_year_id = @Y AND e.EntityType = 'Club' AND e.fk_club_id = @C AND e.fk_district_id = 0 AND e.isdeleted = 0
              AND e.NumericValue IS NOT NULL AND f.FieldKey IN @F",
            new { Y = yearId, C = clubId, F = ClubFundFields.Append("club_total_ytd") }))
            .GroupBy(x => x.Field).ToDictionary(g => g.Key, g => g.First().Val!.Value);
        var v = ClubFigure(field, fv);
        return v == null ? 0 : (int)Math.Round(v.Value, MidpointRounding.AwayFromZero);
    }

    public async Task<int> PunchRisaoAsync()
    {
        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        var tables = (await conn.QueryAsync<string>(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('goal_risao_links','disha_goal_questions')")).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var yearId = await conn.ExecuteScalarAsync<int?>("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1");
        if (yearId == null) return 0;
        int n = 0;

        if (tables.Contains("goal_risao_links"))
        {
            var links = (await conn.QueryAsync<(int DistrictId, int SubId, string Key, decimal Pts, bool IsBonus, decimal BonusPts, int MinB, int MaxB)>(@"
                SELECT l.fk_district_id, l.fk_line_id, l.risao_key, sc.points, sc.is_bonus, sc.bonus_points, sc.min_bonus, sc.max_bonus
                FROM goal_risao_links l
                JOIN district_citation_manual_sub_criteria sc ON sc.pk_id = l.fk_line_id AND sc.isdeleted = 0
                WHERE l.fk_year_id = @Y AND l.line_type = 'manual' AND l.risao_key IS NOT NULL", new { Y = yearId })).ToList();
            foreach (var l in links)
            {
                if (!RisaoFields.TryGetValue(l.Key, out var f) || f.Club == null) continue;
                var rows = await conn.QueryAsync<(int Club, string Field, decimal? Val)>(@"
                    SELECT e.fk_club_id, gf.FieldKey, e.NumericValue FROM goal_entries e
                    JOIN goal_fields gf ON gf.pk_field_id = e.fk_field_id AND gf.isdeleted = 0
                    JOIN club_master c ON c.pk_club_id = e.fk_club_id AND c.fk_district_id = @D AND c.isdeleted = 0 AND c.IsActive = 1
                    WHERE e.fk_year_id = @Y AND e.EntityType = 'Club' AND e.fk_district_id = 0 AND e.isdeleted = 0 AND e.NumericValue IS NOT NULL
                      AND gf.FieldKey IN @F",
                    new { F = ClubFundFields.Append("club_total_ytd"), D = l.DistrictId, Y = yearId });
                foreach (var g in rows.GroupBy(r => r.Club))
                {
                    var fv = g.GroupBy(x => x.Field).ToDictionary(x => x.Key, x => x.First().Val!.Value);
                    var figure = ClubFigure(f.Club, fv);
                    if (figure == null) continue;
                    decimal val = Math.Round(figure.Value, 2);
                    var v = (Club: g.Key, Val: (decimal?)val);
                    // District Awards manual Number points - same formula as the awards club form.
                    decimal points = val * l.Pts, bonus = 0;
                    if (l.IsBonus)
                    {
                        if (l.MinB == 0 && l.MaxB == 0) bonus = l.BonusPts;
                        else
                        {
                            if (val >= l.MinB && l.MinB > 0) bonus = l.BonusPts;
                            if (l.MaxB > 0 && val > l.MaxB) points = l.MaxB * l.Pts;
                        }
                    }
                    if (val == 0) { points = 0; bonus = 0; }
                    var prm = new { D = l.DistrictId, Y = yearId, C = v.Club, Q = l.SubId, A = val.ToString(System.Globalization.CultureInfo.InvariantCulture), P = points, B = bonus };
                    var id = await conn.ExecuteScalarAsync<int?>(@"
                        SELECT pk_id FROM district_citation_club_entry
                        WHERE fk_district_id = @D AND fk_year_id = @Y AND fk_club_id = @C AND entry_type = 'manual' AND fk_question_id = @Q AND isdeleted = 0", prm);
                    if (id.HasValue)
                        await conn.ExecuteAsync("UPDATE district_citation_club_entry SET answer_value = @A, points_earned = @P, bonus_earned = @B, modified_date = NOW() WHERE pk_id = @Id",
                            new { Id = id.Value, prm.A, prm.P, prm.B });
                    else
                        await conn.ExecuteAsync(@"
                            INSERT INTO district_citation_club_entry (fk_district_id, fk_year_id, fk_club_id, entry_type, fk_question_id, answer_value, points_earned, bonus_earned, created_date)
                            VALUES (@D, @Y, @C, 'manual', @Q, @A, @P, @B, NOW())", prm);
                    n++;
                }
            }
        }

        var hasDishaRisao = tables.Contains("disha_goal_questions") && await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'disha_goal_questions' AND column_name = 'risao_key'") > 0;
        if (hasDishaRisao)
        {
            var qs = await conn.QueryAsync<(int Id, int DistrictId, string Key)>(
                "SELECT pk_id, fk_district_id, risao_key FROM disha_goal_questions WHERE fk_year_id = @Y AND source = 'risao' AND isdeleted = 0",
                new { Y = yearId });
            foreach (var q in qs)
            {
                if (!RisaoFields.TryGetValue(q.Key ?? "", out var f) || f.District == null) continue;
                var fv = (await conn.QueryAsync<(string Field, decimal? Val)>(@"
                    SELECT gf.FieldKey, e.NumericValue FROM goal_entries e
                    JOIN goal_fields gf ON gf.pk_field_id = e.fk_field_id AND gf.isdeleted = 0
                    WHERE e.fk_year_id = @Y AND e.EntityType = 'District' AND e.fk_district_id = @D AND e.fk_club_id = 0 AND e.isdeleted = 0
                      AND gf.FieldKey IN @F AND e.NumericValue IS NOT NULL",
                    new { F = DistrictFundFields.Append(f.District), Y = yearId, D = q.DistrictId }))
                    .GroupBy(x => x.Field).ToDictionary(x => x.Key, x => x.First().Val!.Value);
                var val = DistrictFigure(f.District, fv);
                if (val == null) continue;
                await conn.ExecuteAsync(@"
                    INSERT INTO disha_goal_answers (fk_question_id, fk_district_id, answer_value) VALUES (@Q, @D, @V)
                    ON DUPLICATE KEY UPDATE answer_value = @V, modified_date = NOW()",
                    new { Q = q.Id, D = q.DistrictId, V = Math.Round(val.Value, 2).ToString(System.Globalization.CultureInfo.InvariantCulture) });
                n++;
            }
        }
        return n;
    }

    // Copy of RotaryApi RotaryOrgClubFigures.AddedAsync (user 2026-11-20) - change both together.
    //   Member addition = Members now - Members 1 July; Women Members = Female now - the club's women on 1 July.
    private static async Task<int?> RotaryOrgAddedAsync(MySqlConnection conn, string act, int clubId, int yearId)
    {
        bool women = (act.Contains("member addition") && act.Contains("lady")) || act.Contains("women member");
        bool members = !women && act.Contains("member addition") && !act.Contains("youth");
        if (!women && !members) return null;
        var v = (await conn.QueryAsync<(string Item, decimal Val)>(@"
            SELECT ItemName, NumericValue FROM goal_rotary_org_values
            WHERE fk_year_id = @Y AND EntityType = 'Club' AND fk_club_id = @C AND isdeleted = 0 AND NumericValue IS NOT NULL
              AND ItemName IN ('Members 1 July', 'Members now / 30 June', 'Female')", new { Y = yearId, C = clubId }))
            .GroupBy(x => x.Item).ToDictionary(g => g.Key, g => g.First().Val);
        if (members)
            return v.TryGetValue("Members now / 30 June", out var now) && v.TryGetValue("Members 1 July", out var jul)
                ? (int)Math.Round(Math.Max(0m, now - jul), MidpointRounding.AwayFromZero) : null;
        if (!v.TryGetValue("Female", out var fem)) return null;
        var july = await conn.ExecuteScalarAsync<decimal?>(@"
            SELECT e.NumericValue FROM goal_entries e
            JOIN goal_fields f ON f.pk_field_id = e.fk_field_id AND f.isdeleted = 0 AND f.FieldKey = 'existing_women_members'
            WHERE e.fk_year_id = @Y AND e.EntityType = 'Club' AND e.fk_club_id = @C AND e.isdeleted = 0 AND e.NumericValue IS NOT NULL
            LIMIT 1", new { Y = yearId, C = clubId });
        return july == null ? null : (int)Math.Round(Math.Max(0m, fem - july.Value), MidpointRounding.AwayFromZero);
    }

    private async Task<int> GetAutoCount(MySqlConnection conn, string activityName, int clubId, int yearId,
        DateTime startDate, DateTime endDate, Dictionary<string, int> moduleIdMap, string projTbl, dynamic? subItem)
    {
        var act = activityName.ToLower();
        // RISAO figures in the Auto list (user 2026-11-17) - same as RotaryApi RisaoFigures.ClubCountAsync.
        if (RisaoActivityField.ContainsKey(PlainAct(activityName))) return await RisaoClubCountAsync(conn, activityName, clubId, yearId);
        if (act.Contains("club website")) return 0;
        if (act.Contains("club dues"))    return 0;

        // Rotary.org first (user 2026-11-20) - same rule as RotaryApi RotaryOrgClubFigures: a club whose figures came
        // from Rotary.org answers Member addition / Women Members with the Rotary.org figure; otherwise counted below.
        if (await RotaryOrgAddedAsync(conn, act, clubId, yearId) is int fromRotaryOrg)
            return fromRotaryOrg;

        // "Member Addition(Lady)" renamed "Women Members" (user 2026-11-18) - both names work.
        if ((act.Contains("member addition") && act.Contains("lady")) || act.Contains("women member"))
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

    // "For every" (user 2026-11-18, option B): points are given per block of PerUnit (default 1 = the usual
    // District Awards count x points). 15 clubs, 50 points for every 5 -> 3 x 50 = 150; US$16,603, 10 for every
    // US$1,000 -> 16 x 10 = 160. Bonus min / max still compare the real figure.
    private (decimal earned, decimal bonus) CalculatePoints(int count, decimal pointsPerUnit, bool isBonus, decimal bonusPoints, int minBonus, int maxBonus, int perUnit = 1)
    {
        if (count == 0) return (0, 0);
        if (perUnit < 1) perUnit = 1;
        decimal bonus = 0;
        int counted = count;
        if (isBonus)
        {
            if (minBonus == 0 && maxBonus == 0) bonus = bonusPoints;
            else
            {
                if (maxBonus > 0 && count > maxBonus) counted = maxBonus;   // cap at max for the base points
                if (count >= minBonus && minBonus > 0) bonus = bonusPoints;
            }
        }
        return ((counted / perUnit) * pointsPerUnit, bonus);
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
