using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

// Disha questions that ARE a Goal Setting box (user 2026-11-18): Disha shows exactly what Goal Setting shows -
//   Goal     = the total target (as on 1 July + planned new), as the DG set it in Goal Setting,
//   Achieved = the total today (as on 1 July + added till date) = Goal Setting's Achieved,
//   %        = Goal Setting's formula: Membership (Clubs / Members / Women) = (Achieved - 1 July) / (Goal - 1 July);
//              Youth (Rotaractors, whose goal is the planned NEW number) = (Achieved - 1 July) / Goal.
// Month-wise = Goal Setting's own month figures (what each import added), so 1 July + months = Achieved.
// The AwardsAutoCalcWorker keeps its own copy of the list (CitationCalculator) - change both together.
public static class DishaGoalLinks
{
    public sealed record Link(string AchKey, string BaseKey, bool Youth);

    public static Link? Of(string lineType, string? activityName, string? title)
    {
        if (lineType != "manual")
        {
            var a = RisaoFigures.Plain(activityName).ToLowerInvariant().Replace(" ", "");
            if (a == "newclubs") return new("new_clubs_achieved", "total_clubs", false);
            if ((a.Contains("memberaddition") && a.Contains("lady")) || a == "womenmembers") return new("new_women_members_achieved", "existing_women_members", false);
            if (a == "memberaddition") return new("new_members_achieved", "total_members", false);
            return null;
        }
        return string.Equals((title ?? "").Trim(), "Rotaractors", StringComparison.OrdinalIgnoreCase)
            ? new("rotaract_members_achieved", "rotaract_existing_members", true) : null;
    }

    private static readonly string[] Keys =
    {
        "new_clubs_achieved", "total_clubs", "new_women_members_achieved", "existing_women_members",
        "new_members_achieved", "total_members", "rotaract_members_achieved", "rotaract_existing_members",
    };

    // The district's Goal Setting figures (goal_entries) for the linked boxes.
    public static async Task<Dictionary<string, decimal>> DistrictValuesAsync(MySqlConnection conn, int districtId, int yearId) =>
        (await conn.QueryAsync<(string K, decimal V)>(@"
            SELECT f.FieldKey, e.NumericValue FROM goal_entries e
            JOIN goal_fields f ON f.pk_field_id = e.fk_field_id AND f.isdeleted = 0
            WHERE e.fk_year_id = @Y AND e.EntityType = 'District' AND e.fk_district_id = @D AND e.fk_club_id = 0
              AND e.isdeleted = 0 AND e.NumericValue IS NOT NULL AND f.FieldKey IN @K",
            new { Y = yearId, D = districtId, K = Keys }))
        .GroupBy(x => x.K).ToDictionary(g => g.Key, g => g.First().V, StringComparer.Ordinal);

    // Goal Setting's month figures for the box (each import's addition), Rotary-year months.
    public static async Task<Dictionary<int, decimal>> MonthlyAsync(MySqlConnection conn, Link l, int districtId, int yearId) =>
        (await conn.QueryAsync<(int M, decimal V)>(@"
            SELECT m.PeriodMonth, SUM(m.NumericValue) FROM goal_entries_monthly m
            JOIN goal_fields f ON f.pk_field_id = m.fk_field_id AND f.isdeleted = 0
            WHERE m.fk_year_id = @Y AND m.EntityType = 'District' AND m.fk_district_id = @D AND m.fk_club_id = 0
              AND m.isdeleted = 0 AND m.NumericValue IS NOT NULL AND f.FieldKey = @K
            GROUP BY m.PeriodMonth", new { Y = yearId, D = districtId, K = l.AchKey }))
        .ToDictionary(x => x.M, x => x.V);

    public static decimal? Achieved(Link l, IReadOnlyDictionary<string, decimal> v) => v.TryGetValue(l.AchKey, out var a) ? a : null;
    public static decimal? Baseline(Link l, IReadOnlyDictionary<string, decimal> v) => v.TryGetValue(l.BaseKey, out var b) ? b : null;

    // Goal / answer as the % formula needs them (Goal Setting's rule); no baseline = unchanged.
    public static (decimal? Goal, string? Answer) ForPct(Link l, decimal? goal, string? answer, decimal? baseline)
    {
        if (baseline == null || !decimal.TryParse(answer, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var a))
            return (goal, answer);
        var gained = Math.Max(0m, a - baseline.Value);
        var g = l.Youth ? goal : goal - baseline.Value;
        return (g, gained.ToString(System.Globalization.CultureInfo.InvariantCulture));
    }

    // Count used for the points: what was added this year.
    public static int Gained(Link l, decimal achieved, decimal? baseline) =>
        (int)Math.Round(Math.Max(0m, achieved - (baseline ?? 0m)), MidpointRounding.AwayFromZero);
}
