using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

// RISAO figures as goal answers (user 2026-11-17): they sit in the AUTO list (District Awards activity master
// "RISAO - ..." rows, and the Disha Auto list) - no separate RISAO choice. The figure is the one the RISAO monthly
// import wrote into Goal Setting, with the SAME rules the Goal Setting screen uses (GoalSettingService):
//   club Total Giving   = the stored Total, or when empty the 5 club funds added up
//   district Total Giving = Annual Fund + PolioPlus + Endowment + CSR, always.
// The standalone AwardsAutoCalcWorker keeps its own copy of these lists (CitationCalculator) - change both together.
public static class RisaoFigures
{
    // Names carry no "RISAO" (user 2026-11-18): plain names; the old "RISAO - x" names are still understood.
    public const string OldPrefix = "RISAO - ";
    public static string Plain(string? activityName)
    {
        var n = (activityName ?? "").Trim();
        return n.StartsWith(OldPrefix, StringComparison.OrdinalIgnoreCase) ? n[OldPrefix.Length..].Trim() : n;
    }
    // Rotary.org goals already in RCC (the 26) - never offered in the Auto list (user 2026-11-18).
    public static readonly int[] InRccActivityIds = { 16, 17 };

    // District Awards activity master rows (club level) - pk_id fixed, seeded by DatabaseInitializer.
    public static readonly (int Id, string Name, string ClubField)[] Activities =
    {
        (16, "Annual Fund",            "club_annual_fund_ytd"),
        (17, "PolioPlus Fund",         "club_polioplus_ytd"),
        (18, "Endowment Fund",         "club_endowment_ytd"),
        (19, "Other Funds",            "club_other_funds_ytd"),
        (20, "Annual Fund per capita", "club_af_per_capita"),
        (21, "Total Giving",           "club_total_ytd"),
    };

    // District-level figure of a RISAO activity (Disha); null = no district figure -> add up the clubs instead.
    public static string? DistrictFieldOf(string activityName) => Plain(activityName).ToLowerInvariant() switch
    {
        "annual fund" => "annual_fund_achieved",
        "polioplus fund" => "polio_plus_achieved",
        "endowment fund" => "endowment_achieved",
        "total giving" => "total_giving_achieved",
        "csr with rfi" => "csr_achieved",
        _ => null,
    };

    public static async Task<decimal?> DistrictValueAsync(MySqlConnection conn, string field, int districtId, int yearId)
    {
        var fv = (await conn.QueryAsync<(string Field, decimal? Val)>(@"
            SELECT f.FieldKey, e.NumericValue FROM goal_entries e
            JOIN goal_fields f ON f.pk_field_id = e.fk_field_id AND f.isdeleted = 0
            WHERE e.fk_year_id = @Y AND e.EntityType = 'District' AND e.fk_district_id = @D AND e.fk_club_id = 0 AND e.isdeleted = 0
              AND e.NumericValue IS NOT NULL AND f.FieldKey IN @F",
            new { Y = yearId, D = districtId, F = DistrictFundFields.Append(field) }))
            .GroupBy(x => x.Field).ToDictionary(g => g.Key, g => g.First().Val!.Value);
        return DistrictFigure(field, fv);
    }

    // District-only RISAO activity (no club figure) - Disha Goals only; hidden from the club-level Auto list.
    public const int CsrActivityId = 22;
    public const string CsrActivityName = "CSR with RFI";

    // "New Clubs" (user 2026-11-18) - district-level Auto activity (Disha Goals only; hidden from the club-level list).
    // Its figures = Goal Setting's Clubs box (DishaGoalLinks).
    public const int NewClubsActivityId = 23;
    public const string NewClubsActivityName = "New Clubs";

    public static readonly string[] ClubFundFields = { "club_af_per_capita", "club_annual_fund_ytd", "club_polioplus_ytd", "club_other_funds_ytd", "club_endowment_ytd" };
    public static readonly string[] DistrictFundFields = { "annual_fund_achieved", "polio_plus_achieved", "endowment_achieved", "csr_achieved" };

    public static bool IsRisaoActivity(string? activityName) =>
        activityName != null && (Activities.Any(a => string.Equals(a.Name, Plain(activityName), StringComparison.OrdinalIgnoreCase))
                                 || string.Equals(CsrActivityName, Plain(activityName), StringComparison.OrdinalIgnoreCase));

    public static string? ClubFieldOf(string activityName) =>
        Activities.FirstOrDefault(a => string.Equals(a.Name, Plain(activityName), StringComparison.OrdinalIgnoreCase)).ClubField;

    public static decimal? ClubFigure(string field, IReadOnlyDictionary<string, decimal> fv)
    {
        if (fv.TryGetValue(field, out var v)) return v;
        if (field != "club_total_ytd") return null;
        var parts = ClubFundFields.Where(fv.ContainsKey).ToList();
        return parts.Count == 0 ? null : parts.Sum(k => fv[k]);
    }

    public static decimal? DistrictFigure(string field, IReadOnlyDictionary<string, decimal> fv)
    {
        if (field != "total_giving_achieved") return fv.TryGetValue(field, out var v) ? v : null;
        var parts = DistrictFundFields.Where(fv.ContainsKey).ToList();
        return parts.Count == 0 ? null : parts.Sum(k => fv[k]);
    }

    // One club's RISAO figure for an activity, as a whole number (District Awards auto answers are counts).
    public static async Task<int> ClubCountAsync(MySqlConnection conn, string activityName, int clubId, int yearId)
    {
        var field = ClubFieldOf(activityName);
        if (field == null) return 0;
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

    // "Oct 2026" - the latest month the RISAO import brought for the year ('Club' or 'District'); null = none yet.
    public static async Task<string?> AsOnAsync(MySqlConnection conn, int yearId, string scope)
    {
        var row = await conn.QueryFirstOrDefaultAsync<(int? Month, string? Label)>(@"
            SELECT MAX(m.PeriodMonth), y.YearLabel FROM goal_foundation_import_months m
            JOIN rotary_year_master y ON y.pk_year_id = m.fk_year_id
            WHERE m.fk_year_id = @Y AND m.Scope = @S AND m.isdeleted = 0
            GROUP BY y.YearLabel", new { Y = yearId, S = scope });
        if (row.Month is not (>= 1 and <= 12) || string.IsNullOrEmpty(row.Label)) return null;
        var startYear = int.TryParse(row.Label[..4], out var sy) ? sy : DateTime.Today.Year;
        var calYear = row.Month >= 7 ? startYear : startYear + 1;   // Rotary year runs July - June
        return new DateTime(calYear, row.Month.Value, 1).ToString("MMM yyyy", System.Globalization.CultureInfo.InvariantCulture);
    }
}
