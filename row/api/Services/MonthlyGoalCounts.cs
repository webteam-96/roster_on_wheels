using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

// Month-wise achieved for the new goal flow (user 2026-11-18, option A): Disha Goals and District Set Goals.
// Auto questions = the SAME rules as CitationAutoPointsBackgroundService.GetAutoCount (District Awards), split by
// calendar month of the row's own date (project_date, PublishDateTime, ReportMonth, EventDateTime, JoinedDate,
// CampDate) - one grouped query for all the given clubs. RISAO questions = the monthly RISAO import
// (goal_entries_monthly), so a new month's import shows up by itself. Manual answers are yearly - not here.
// Keep the WHERE rules in step with GetAutoCount.
public static class MonthlyGoalCounts
{
    public static async Task<Dictionary<int, decimal>> AutoAsync(MySqlConnection conn, string activityName, IReadOnlyList<int> clubIds,
        int yearId, DateTime start, DateTime end, string projTbl, Dictionary<string, int> moduleIdMap,
        string? subType, int? subId, string? subName)
    {
        var res = new Dictionary<int, decimal>();
        if (clubIds.Count == 0) return res;
        var act = activityName.ToLowerInvariant();
        async Task<Dictionary<int, decimal>> Q(string sql, object prm) =>
            (await conn.QueryAsync<(int M, long N)>(sql, prm)).ToDictionary(x => x.M, x => (decimal)x.N);
        var p = new DynamicParameters(new { C = clubIds, Y = yearId, S = start, E = end });

        if (RisaoFigures.IsRisaoActivity(activityName)) return await RisaoClubsAsync(conn, activityName, clubIds, yearId);
        if (act.Contains("club website") || act.Contains("club dues")) return res;

        string member = @"SELECT MONTH(cm.JoinedDate), COUNT(*) FROM member_master_profile m
            JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.IsActive = 1 AND cm.isdeleted = 0
            WHERE cm.fk_club_id IN @C AND m.isdeleted = 0 AND cm.JoinedDate >= @S AND cm.JoinedDate <= @E {0} GROUP BY MONTH(cm.JoinedDate)";
        if ((act.Contains("member addition") && act.Contains("lady")) || act.Contains("women member")) return await Q(string.Format(member, "AND m.Gender = 'Female'"), p);
        if (act.Contains("member addition") && act.Contains("youth")) return await Q(string.Format(member, "AND m.IsYouth = 1"), p);
        if (act.Contains("member addition")) return await Q(string.Format(member, ""), p);
        if (act.Contains("newsletter"))
            return await Q("SELECT MONTH(PublishDateTime), COUNT(*) FROM newsletters WHERE fk_club_id IN @C AND fk_year_id = @Y AND isdeleted = 0 AND PublishDateTime IS NOT NULL GROUP BY MONTH(PublishDateTime)", p);
        if (act.Contains("club monthly report"))
            return await Q("SELECT ReportMonth, COUNT(*) FROM club_monthly_reports WHERE fk_club_id IN @C AND fk_year_id = @Y AND isdeleted = 0 AND IsUploadedToDistrict = 1 AND ReportMonth BETWEEN 1 AND 12 GROUP BY ReportMonth", p);
        if (act.Contains("attendance"))
            return await Q("SELECT MONTH(EventDateTime), COUNT(*) FROM club_attendance WHERE fk_club_id IN @C AND fk_year_id = @Y AND isdeleted = 0 AND EventDateTime IS NOT NULL GROUP BY MONTH(EventDateTime)", p);
        if (act.Contains("pph camp"))
            return await Q("SELECT MONTH(CampDate), COUNT(*) FROM pph_camps WHERE fk_club_id IN @C AND isdeleted = 0 AND CampDate >= @S AND CampDate <= @E GROUP BY MONTH(CampDate)", p);

        string proj = $"SELECT MONTH(project_date), COUNT(*) FROM `{projTbl}` WHERE fk_club_id IN @C AND fk_module_id = @Mod AND fk_year_id = @Y AND isdeleted = 0 AND project_date IS NOT NULL {{0}} GROUP BY MONTH(project_date)";
        if (act.Contains("club service"))
        {
            var modId = moduleIdMap.GetValueOrDefault("club_service", 0);
            if (modId == 0) return res;
            p.Add("Mod", modId);
            if (subType == "meeting_type")
            {
                var mt = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
                    { {"Regular","regular"},{"Fellowship","fellowship"},{"BOD","bod"},{"Assembly","assembly"},{"Trust","trust"} };
                p.Add("Mt", mt.GetValueOrDefault(subName ?? "", (subName ?? "").ToLowerInvariant()));
                return await Q(string.Format(proj, "AND meeting_type = @Mt"), p);
            }
            return await Q(string.Format(proj, ""), p);
        }
        var modules = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
            {"community service","community_service"}, {"vocational service","vocational_service"},
            {"international service","international_service"}, {"new generation service","new_generation_service"},
            {"public image initiative","public_image_initiative"} };
        foreach (var kv in modules)
        {
            if (!act.Contains(kv.Key)) continue;
            var modId = moduleIdMap.GetValueOrDefault(kv.Value, 0);
            if (modId == 0) return res;
            p.Add("Mod", modId);
            bool community = act.Contains("community");
            if (subId.HasValue)
            {
                p.Add("Sub", subId.Value);
                if (subType == "area_of_focus") return await Q(string.Format(proj, "AND fk_area_of_focus_id = @Sub"), p);
                if (subType == "category") return await Q(string.Format(proj, community ? "AND fk_category_id = @Sub" : "AND fk_area_of_focus_id = @Sub"), p);
                if (subType == "sub_category") return await Q(string.Format(proj, community ? "AND fk_sub_category_id = @Sub" : "AND fk_category_id = @Sub"), p);
            }
            return await Q(string.Format(proj, ""), p);
        }
        return res;
    }

    // RISAO by month for clubs (added up). Club Total Giving = the 5 club funds added up (as Goal Setting does).
    public static async Task<Dictionary<int, decimal>> RisaoClubsAsync(MySqlConnection conn, string activityName, IReadOnlyList<int> clubIds, int yearId)
    {
        var field = RisaoFigures.ClubFieldOf(activityName);
        if (field == null || clubIds.Count == 0) return new();
        var fields = field == "club_total_ytd" ? RisaoFigures.ClubFundFields : new[] { field };
        return (await conn.QueryAsync<(int M, decimal V)>(@"
            SELECT m.PeriodMonth, SUM(m.NumericValue) FROM goal_entries_monthly m JOIN goal_fields f ON f.pk_field_id = m.fk_field_id AND f.isdeleted = 0
            WHERE m.fk_year_id = @Y AND m.EntityType = 'Club' AND m.fk_club_id IN @C AND m.isdeleted = 0 AND m.NumericValue IS NOT NULL AND f.FieldKey IN @F
            GROUP BY m.PeriodMonth", new { Y = yearId, C = clubIds, F = fields })).ToDictionary(x => x.M, x => x.V);
    }

    // RISAO by month for a district: its own district figures (Total Giving = AF + PolioPlus + Endowment + CSR);
    // a RISAO figure with no district version = its clubs added up.
    public static async Task<Dictionary<int, decimal>> RisaoDistrictAsync(MySqlConnection conn, string activityName, int districtId, IReadOnlyList<int> clubIds, int yearId)
    {
        var field = RisaoFigures.DistrictFieldOf(activityName);
        if (field == null) return await RisaoClubsAsync(conn, activityName, clubIds, yearId);
        var fields = field == "total_giving_achieved" ? RisaoFigures.DistrictFundFields : new[] { field };
        return (await conn.QueryAsync<(int M, decimal V)>(@"
            SELECT m.PeriodMonth, SUM(m.NumericValue) FROM goal_entries_monthly m JOIN goal_fields f ON f.pk_field_id = m.fk_field_id AND f.isdeleted = 0
            WHERE m.fk_year_id = @Y AND m.EntityType = 'District' AND m.fk_district_id = @D AND m.fk_club_id = 0 AND m.isdeleted = 0
              AND m.NumericValue IS NOT NULL AND f.FieldKey IN @F
            GROUP BY m.PeriodMonth", new { Y = yearId, D = districtId, F = fields })).ToDictionary(x => x.M, x => x.V);
    }

    // Is this activity counted by month? RISAO = it has a monthly import field; else one of the counted kinds above.
    // Anything else (club website, club dues, ...) is yearly only - Month-wise / Quarterly leave it out (user 2026-11-19).
    public static bool IsMonthly(string? activityName)
    {
        if (string.IsNullOrEmpty(activityName)) return false;
        if (RisaoFigures.IsRisaoActivity(activityName)) return RisaoFigures.ClubFieldOf(activityName) != null || RisaoFigures.DistrictFieldOf(activityName) != null;
        var act = activityName.ToLowerInvariant();
        if (act.Contains("club website") || act.Contains("club dues")) return false;
        return new[] { "member addition", "women member", "newsletter", "club monthly report", "attendance", "pph camp", "club service",
            "community service", "vocational service", "international service", "new generation service", "public image initiative" }.Any(act.Contains);
    }

    public static async Task<Dictionary<string, int>> ModuleIdsAsync(MySqlConnection conn)
    {
        var map = new Dictionary<string, int>();
        foreach (var key in new[] { "club_service", "community_service", "vocational_service", "international_service", "new_generation_service", "public_image_initiative" })
        {
            var mid = await conn.ExecuteScalarAsync<int?>("SELECT pk_module_id FROM module_master WHERE ModuleKey = @Key AND isdeleted = 0", new { Key = key });
            if (mid.HasValue) map[key] = mid.Value;
        }
        return map;
    }

    // Rotary-year month order: Jul (7) .. Jun (6).
    public static readonly int[] YearMonths = { 7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6 };
}
