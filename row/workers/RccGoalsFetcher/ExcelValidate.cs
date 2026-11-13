using ClosedXML.Excel;
using Dapper;
using MySqlConnector;

namespace RccGoalsFetcher;

using Row = Dictionary<string, object?>;

/// --validate-excel <xlsx> --districts 3142,3141 [--source "RCC fetch 2026-10-28"]
/// READ-ONLY check of the DbWriter mapping: reads an Excel this program wrote, builds the database rows
/// with the same mapping code the worker uses, and compares them with the rows already in
/// goal_rotary_org_values for that Source. Nothing is written anywhere.
public static class ExcelValidate
{
    public static async Task<int> RunAsync(Settings s, string xlsx, IReadOnlyList<string> districts, string source)
    {
        if (string.IsNullOrWhiteSpace(s.ConnectionString)) { Log.Error("No ConnectionStrings:DefaultConnection."); return 2; }
        var (yearLabel, sheets) = Read(xlsx);
        Log.Info($"Excel {Path.GetFileName(xlsx)}: Rotary year {yearLabel}, sheets {string.Join(", ", sheets.Select(x => $"{x.Name} ({x.Rows.Count})"))}");

        var want = districts.ToHashSet(StringComparer.OrdinalIgnoreCase);
        var values = DbWriter.BuildRows(sheets, yearLabel).Where(v => want.Count == 0 || want.Contains(v.District)).ToList();

        await using var db = new MySqlConnection(s.ConnectionString);
        await db.OpenAsync();
        var res = await DbWriter.ResolveAsync(db, values);
        var dIds = res.DistrictIds.Where(d => want.Count == 0 || want.Contains(d.Key)).Select(d => d.Value).ToList();
        var numOf = res.DistrictIds.ToDictionary(d => d.Value, d => d.Key);
        var cIds = res.Rows.Where(r => r.ClubId > 0).Select(r => r.ClubId).Distinct().Append(-1).ToList();
        foreach (var r in res.Rows) numOf.TryAdd(r.DistrictId, $"(id {r.DistrictId})");
        Log.Info($"Mapped {values.Count} values -> {res.Rows.Count} rows; clubs not in our DB: {res.UnknownClubs.Count}, clubs filed under another district in club_master: {res.ClubsInOtherDistrict} " +
                 $"(values of unknown districts {res.UnknownDistrictValues}, unknown years {string.Join(",", res.UnknownYears)})");

        var dbRows = (await db.QueryAsync<(int Y, string E, int D, int C, string I, string K, decimal? V)>(
            "SELECT fk_year_id, EntityType, fk_district_id, fk_club_id, ItemName, Kind, NumericValue FROM goal_rotary_org_values " +
            "WHERE Source = @source AND isdeleted = 0 AND (fk_district_id IN @dIds OR fk_club_id IN @cIds)", new { source, dIds, cIds })).ToList();
        var dbMap = new Dictionary<string, (int D, string E, string I, string K, decimal? V)>();
        var dbDupes = 0;
        foreach (var r in dbRows)
            if (!dbMap.TryAdd(DbWriter.Key(r.Y, r.E, r.D, r.C, r.I, r.K), (r.D, r.E, r.I, r.K, r.V))) dbDupes++;
        var xMap = new Dictionary<string, GoalDbRow>();
        foreach (var r in res.Rows) xMap[DbWriter.Key(r.YearId, r.EntityType, r.DistrictId, r.ClubId, r.ItemName, r.Kind)] = r;

        int match = 0, diff = 0, missing = 0, extra = 0;
        var samples = new List<string>();
        var reasons = new Dictionary<string, int>();
        void Note(string kind, int d, string e, string i, string k, string detail)
        {
            var key = $"{kind}: {e} / {i} / {k}";
            reasons[key] = reasons.GetValueOrDefault(key) + 1;
            if (samples.Count < 40) samples.Add($"  {kind} D{numOf.GetValueOrDefault(d)} {detail}");
        }
        foreach (var (k, x) in xMap)
        {
            if (!dbMap.TryGetValue(k, out var d)) { missing++; Note("MISSING in DB", x.DistrictId, x.EntityType, x.ItemName, x.Kind, $"{k} excel={x.Value}"); continue; }
            if (d.V == x.Value) match++;
            else { diff++; Note("VALUE DIFF", x.DistrictId, x.EntityType, x.ItemName, x.Kind, $"{k} excel={x.Value} db={d.V}"); }
        }
        foreach (var (k, d) in dbMap)
            if (!xMap.ContainsKey(k)) { extra++; Note("EXTRA in DB", d.D, d.E, d.I, d.K, $"{k} db={d.V}"); }

        Log.Info($"Districts {string.Join(",", want)} - DB rows (Source '{source}'): {dbRows.Count}{(dbDupes > 0 ? $" ({dbDupes} duplicate keys)" : "")}, Excel rows: {xMap.Count}");
        foreach (var g in res.Rows.GroupBy(r => r.DistrictId).OrderBy(g => numOf.GetValueOrDefault(g.Key)))
        {
            var xk = g.Select(r => DbWriter.Key(r.YearId, r.EntityType, r.DistrictId, r.ClubId, r.ItemName, r.Kind)).ToHashSet();
            var dk = dbMap.Where(kv => kv.Value.D == g.Key).Select(kv => kv.Key).ToHashSet();
            var m = xk.Count(k => dk.Contains(k) && dbMap[k].V == xMap[k].Value);
            Log.Info($"  D{numOf.GetValueOrDefault(g.Key)}: excel {xk.Count}, db {dk.Count}, match {m}, value diff {xk.Count(k => dk.Contains(k)) - m}, " +
                     $"missing in db {xk.Count(k => !dk.Contains(k))}, extra in db {dk.Count(k => !xk.Contains(k))}");
        }
        Log.Info($"TOTAL: match {match}, value differences {diff}, missing in DB {missing}, extra in DB {extra}");
        foreach (var r in reasons.OrderByDescending(r => r.Value).Take(30)) Log.Info($"  {r.Value,6} x {r.Key}");
        foreach (var x in samples) Log.Info(x);
        if (res.UnknownClubs.Count > 0) Log.Info($"Clubs in the Excel but not in club_master (skipped): {string.Join(", ", res.UnknownClubs.Take(30))}");
        return diff + missing + extra == 0 ? 0 : 1;
    }

    /// The data sheets of an Excel written by ExcelOut, as the same rows BuildSheets makes (header row =
    /// the row whose first cell is "District"; the section band above it is skipped).
    public static (string YearLabel, List<(string Name, List<Row> Rows)> Sheets) Read(string path)
    {
        using var wb = new XLWorkbook(path);
        var year = "";
        if (wb.Worksheets.TryGetWorksheet("Summary", out var sum))
            foreach (var r in sum.RowsUsed())
                if (r.Cell(1).GetString().Trim() == "Rotary year") year = r.Cell(2).GetString().Trim();
        var sheets = new List<(string, List<Row>)>();
        foreach (var ws in wb.Worksheets)
        {
            if (ws.Name == "Summary") continue;
            var last = ws.LastRowUsed()?.RowNumber() ?? 0;
            var lastCol = ws.LastColumnUsed()?.ColumnNumber() ?? 0;
            var header = Enumerable.Range(1, Math.Min(3, last)).FirstOrDefault(i => ws.Cell(i, 1).GetString().Trim() is "District" or "Category");
            if (header == 0) continue;
            var cols = Enumerable.Range(1, lastCol).Select(c => ws.Cell(header, c).GetString().Trim()).ToList();
            var rows = new List<Row>();
            for (var i = header + 1; i <= last; i++)
            {
                var row = new Row();
                for (var c = 0; c < cols.Count; c++)
                {
                    if (cols[c] == "") continue;
                    var cell = ws.Cell(i, c + 1);
                    row[cols[c]] = cell.Value.Type switch
                    {
                        XLDataType.Blank => null,
                        XLDataType.Number => cell.Value.GetNumber(),
                        XLDataType.Boolean => cell.Value.GetBoolean(),
                        _ => cell.GetString(),
                    };
                }
                if (row.Values.Any(v => v != null)) rows.Add(row);
            }
            sheets.Add((ws.Name, rows));
        }
        return (year, sheets);
    }
}
