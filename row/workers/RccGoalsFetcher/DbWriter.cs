using System.Globalization;
using Dapper;
using MySqlConnector;

namespace RccGoalsFetcher;

using Row = Dictionary<string, object?>;

/// One value for goal_rotary_org_values, still in Rotary's terms (district number, RI club id, year label).
public sealed record GoalValue(string EntityType, string District, string? RiClubId, string YearLabel, string ItemName, string Kind, decimal Value);

/// The same value with our ids.
public sealed record GoalDbRow(int YearId, string EntityType, int DistrictId, int ClubId, string ItemName, string Kind, decimal Value);

/// THE mapping from the Excel sheet rows (ExcelOut.BuildSheets - or the same sheets read back from an
/// Excel file) to goal_rotary_org_values. Reproduces the rows loaded on 2026-10-28 ('RCC fetch 2026-10-28'):
///   District Totals     -> District: "<goal> - Achieved" / "- Clubs with Yes" = Achieved, "- Goal" / "- Clubs with goal"
///                          = Target, every other column (Members, Annual Fund (USD), Rotaract clubs, ...) = Value
///   History - Districts -> District Value per Rotary Year (Members 1 July, Female, Rotaractors ..., RAG bands)
///   Club Goals          -> Club: "- Achieved" = Achieved, "- Goal" = Target (Yes/No goals: Yes = 1, No = 0)
///   History - Clubs     -> Club Value per Rotary Year (Female, Male, Members 1 July, Members now / 30 June)
/// Empty cells are not stored. "As of", names and ids are not values. A district's "Members" / "Members on
/// 1 July" of 0 means RCC had no aggregate for it (D3291 on 2026-10-28) - not stored either.
/// Club rows are filed under the club's own district in club_master (Rotary may list it elsewhere, e.g.
/// Haliyal: Rotary D3170, RIZones D3171).
public static class DbWriter
{
    private static readonly HashSet<string> NotValues = new(StringComparer.OrdinalIgnoreCase)
        { "District", "As of", "Rotary Year", "Club Group (AG)", "Club", "RI Club Id", "Goals entered", "Rotary clubs" };
    private static readonly (string Suffix, string Kind)[] GoalSuffixes =
        { (" - Achieved", "Achieved"), (" - Goal", "Target"), (" - Clubs with Yes", "Achieved"), (" - Clubs with goal", "Target") };

    public static List<GoalValue> BuildRows(IEnumerable<(string Name, List<Row> Rows)> sheets, string yearLabel)
    {
        var map = new Dictionary<string, GoalValue>(StringComparer.OrdinalIgnoreCase);
        void Add(GoalValue v) => map[$"{v.EntityType}|{v.District}|{v.RiClubId}|{v.YearLabel}|{v.ItemName}|{v.Kind}"] = v;

        foreach (var (name, rows) in sheets)
        {
            var isClub = name == ExcelOut.ClubGoalsSheet || name == ExcelOut.HistoryClubsSheet;
            var isHistory = name == ExcelOut.HistoryDistrictsSheet || name == ExcelOut.HistoryClubsSheet;
            if (!isClub && !isHistory && name != ExcelOut.DistrictTotalsSheet) continue;
            foreach (var r in rows)
            {
                var district = Text(r.GetValueOrDefault("District"));
                if (district == null) continue;
                var club = isClub ? Text(r.GetValueOrDefault("RI Club Id")) : null;
                if (isClub && club == null) continue;
                var year = isHistory ? Text(r.GetValueOrDefault("Rotary Year")) : yearLabel;
                if (year == null) continue;
                foreach (var (col, raw) in r)
                {
                    if (NotValues.Contains(col)) continue;
                    var (item, kind) = Split(col);
                    if (kind == null)
                    {
                        if (name == ExcelOut.ClubGoalsSheet) continue;   // club goal sheet: goal columns only
                        kind = "Value";
                    }
                    if (Dec(raw) is not { } v) continue;
                    if (v == 0 && name == ExcelOut.DistrictTotalsSheet && col is "Members" or "Members on 1 July") continue;
                    Add(new GoalValue(isClub ? "Club" : "District", district, club, year, item, kind, v));
                }
            }
        }
        return map.Values.ToList();
    }

    private static (string Item, string? Kind) Split(string col)
    {
        foreach (var (suffix, kind) in GoalSuffixes)
            if (col.EndsWith(suffix, StringComparison.Ordinal) && col.Length > suffix.Length) return (col[..^suffix.Length].Trim(), kind);
        return (col.Trim(), null);
    }

    public static string? Text(object? v) => v switch
    {
        null => null,
        string s => string.IsNullOrWhiteSpace(s) ? null : s.Trim(),
        double d => d.ToString("0.##########", CultureInfo.InvariantCulture),
        _ => Convert.ToString(v, CultureInfo.InvariantCulture)?.Trim(),
    };

    public static decimal? Dec(object? v)
    {
        decimal? d = v switch
        {
            null => null,
            long l => l, int i => i, decimal m => m,
            double x when !double.IsNaN(x) && !double.IsInfinity(x) => (decimal)x,
            bool b => b ? 1 : 0,
            string s when s.Trim().Equals("Yes", StringComparison.OrdinalIgnoreCase) => 1,
            string s when s.Trim().Equals("No", StringComparison.OrdinalIgnoreCase) => 0,
            string s when decimal.TryParse(s.Trim(), NumberStyles.Number, CultureInfo.InvariantCulture, out var p) => p,
            _ => null,
        };
        return d is { } z ? Math.Round(z, 2, MidpointRounding.AwayFromZero) : null;
    }

    /// Our ids for Rotary's district numbers / RI club ids / year labels (read-only). Values whose
    /// district, club or year is not in our database are counted and left out.
    public sealed record Resolved(List<GoalDbRow> Rows, int UnknownDistrictValues, HashSet<string> UnknownClubs, HashSet<string> UnknownYears,
                                  Dictionary<string, int> DistrictIds, int ClubsInOtherDistrict);

    public static async Task<Resolved> ResolveAsync(MySqlConnection db, List<GoalValue> values)
    {
        var dNums = values.Select(v => v.District).Distinct().ToList();
        var districts = dNums.Count == 0 ? new Dictionary<string, int>() : (await db.QueryAsync<(int Id, string Num)>(
                "SELECT pk_district_id, TRIM(DistrictNumber) FROM district_master WHERE isdeleted = 0 AND TRIM(DistrictNumber) IN @dNums ORDER BY pk_district_id", new { dNums }))
            .GroupBy(x => x.Num).ToDictionary(g => g.Key, g => g.First().Id, StringComparer.OrdinalIgnoreCase);
        var clubIds = values.Where(v => v.RiClubId != null).Select(v => v.RiClubId!).Distinct().ToList();
        var clubs = new Dictionary<string, (int Id, int District)>(StringComparer.OrdinalIgnoreCase);
        foreach (var chunk in clubIds.Chunk(1000))
            foreach (var c in await db.QueryAsync<(int Id, string Rid, int District)>(
                         "SELECT pk_club_id, TRIM(ClubRotaryId), fk_district_id FROM club_master WHERE isdeleted = 0 AND ClubRotaryId IN @chunk ORDER BY pk_club_id", new { chunk }))
                clubs.TryAdd(c.Rid, (c.Id, c.District));
        var labels = values.Select(v => v.YearLabel).Distinct().ToList();
        var years = labels.Count == 0 ? new Dictionary<string, int>() : (await db.QueryAsync<(int Id, string Label)>(
                "SELECT pk_year_id, YearLabel FROM rotary_year_master WHERE isdeleted = 0 AND YearLabel IN @labels ORDER BY pk_year_id", new { labels }))
            .GroupBy(x => x.Label).ToDictionary(g => g.Key, g => g.First().Id, StringComparer.OrdinalIgnoreCase);

        var res = new Resolved(new(), 0, new(StringComparer.OrdinalIgnoreCase), new(StringComparer.OrdinalIgnoreCase), districts, 0);
        var unknownDistrict = 0;
        var otherDistrict = new HashSet<int>();
        foreach (var v in values)
        {
            if (!districts.TryGetValue(v.District, out var did)) { unknownDistrict++; continue; }
            if (!years.TryGetValue(v.YearLabel, out var yid)) { res.UnknownYears.Add(v.YearLabel); continue; }
            var cid = 0;
            if (v.EntityType == "Club")
            {
                if (!clubs.TryGetValue(v.RiClubId!, out var c)) { res.UnknownClubs.Add(v.RiClubId!); continue; }
                cid = c.Id;
                if (c.District > 0 && c.District != did) { otherDistrict.Add(cid); did = c.District; }
            }
            res.Rows.Add(new GoalDbRow(yid, v.EntityType, did, cid, v.ItemName, v.Kind, v.Value));
        }
        return res with { UnknownDistrictValues = unknownDistrict, ClubsInOtherDistrict = otherDistrict.Count };
    }

    public static string Key(int year, string entity, int district, int club, string item, string kind)
        => $"{year}|{entity}|{district}|{club}|{item.ToLowerInvariant()}|{kind.ToLowerInvariant()}";

    /// Rules: Target, Achieved and Value = inserted or UPDATED on every sync, so Rizones always shows Rotary.org's
    /// LATEST goal (user 2026-11-23: a club that changes its goal in Rotary.org changes it in Rizones - RCC only;
    /// before, an existing target was never changed). Only the DG / club sync writes here, and only the CURRENT
    /// Rotary year. Nothing is ever deleted: a goal Rotary.org no longer sends stays as it was.
    /// Returns rows written and how many of them were targets that already existed (refreshed from Rotary.org).
    /// Which Rotary year a sync writes (user 2026-11-20): Past = Achieved / Value updated, a goal only where none is saved;
    /// Current = everything updated (latest Rotary.org goal); Next = goals only (no Achieved before 1 July).
    public enum YearMode { Past, Current, Next }

    public static async Task<(int Written, int TargetsRefreshed)> WriteAsync(MySqlConnection db, List<GoalDbRow> rows, string source, YearMode mode = YearMode.Current)
    {
        if (mode == YearMode.Next) rows = rows.Where(r => r.Kind == "Target").ToList();
        if (rows.Count == 0) return (0, 0);
        var dIds = rows.Select(r => r.DistrictId).Distinct().ToList();
        var yIds = rows.Select(r => r.YearId).Distinct().ToList();
        var existing = (await db.QueryAsync<(int Y, string E, int D, int C, string I, string K)>(
                "SELECT fk_year_id, EntityType, fk_district_id, fk_club_id, ItemName, Kind FROM goal_rotary_org_values WHERE fk_district_id IN @dIds AND fk_year_id IN @yIds",
                new { dIds, yIds }))
            .Select(x => Key(x.Y, x.E, x.D, x.C, x.I, x.K)).ToHashSet();
        var targetsRefreshed = rows.Count(r => r.Kind == "Target" && existing.Contains(Key(r.YearId, r.EntityType, r.DistrictId, r.ClubId, r.ItemName, r.Kind)));

        await using var tx = await db.BeginTransactionAsync();
        if (mode == YearMode.Past)
        {
            // An old year's goal that is already saved is never changed; a missing one is filled.
            await InsertAsync(db, tx, rows.Where(r => r.Kind == "Target").ToList(), source, "pk_id = pk_id");
            await InsertAsync(db, tx, rows.Where(r => r.Kind != "Target").ToList(), source, "NumericValue = VALUES(NumericValue), Source = VALUES(Source), modified_date = NOW()");
            targetsRefreshed = 0;
        }
        else
            await InsertAsync(db, tx, rows, source, "NumericValue = VALUES(NumericValue), Source = VALUES(Source), modified_date = NOW()");
        await tx.CommitAsync();
        return (rows.Count, targetsRefreshed);
    }

    private static async Task InsertAsync(MySqlConnection db, MySqlTransaction tx, List<GoalDbRow> rows, string source, string onDuplicate)
    {
        foreach (var chunk in rows.Chunk(400))
        {
            var p = new DynamicParameters();
            p.Add("src", source);
            var vals = new List<string>();
            for (var i = 0; i < chunk.Length; i++)
            {
                var r = chunk[i];
                vals.Add($"(@y{i}, @e{i}, @d{i}, @c{i}, @n{i}, @k{i}, @v{i}, @src, NOW(), 0)");
                p.Add($"y{i}", r.YearId); p.Add($"e{i}", r.EntityType); p.Add($"d{i}", r.DistrictId); p.Add($"c{i}", r.ClubId);
                p.Add($"n{i}", r.ItemName); p.Add($"k{i}", r.Kind); p.Add($"v{i}", r.Value);
            }
            await db.ExecuteAsync(
                "INSERT INTO goal_rotary_org_values (fk_year_id, EntityType, fk_district_id, fk_club_id, ItemName, Kind, NumericValue, Source, created_date, isdeleted) VALUES " +
                string.Join(", ", vals) + " ON DUPLICATE KEY UPDATE " + onDuplicate, p, tx, commandTimeout: 300);
        }
    }
}
