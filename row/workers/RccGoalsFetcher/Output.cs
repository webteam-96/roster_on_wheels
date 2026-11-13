using System.Net.Http.Json;
using System.Text.Json;
using ClosedXML.Excel;

namespace RccGoalsFetcher;

using Row = Dictionary<string, object?>;

public static class ExcelOut
{
    private const int MaxRowsPerSheet = 1_000_000;

    /// One workbook per Rotary year, readable columns only. Rotary's internal ids (node / goal /
    /// currency GUIDs, import keys) stay in the raw JSON next to it; RI Club Id is kept for matching.
    public static string Write(YearResult y, string folder, DateTime runAt)
    {
        Directory.CreateDirectory(folder);
        var path = Path.Combine(folder, $"RCC_Goals_{y.Label}_{runAt:yyyy-MM-dd}.xlsx");
        using var wb = new XLWorkbook();

        var sum = wb.Worksheets.Add("Summary");
        var lines = new List<(string, object)>
        {
            ("Rotary year", y.Label), ("Downloaded at", runAt.ToString("dd-MM-yyyy HH:mm")),
            ("Source", "Rotary Club Central - https://rcc.rotary.org (read-only)"),
            ("Districts found", y.DistrictNodes.Count), ("Districts not visible to this account", string.Join(", ", y.MissingDistricts)),
            ("Clubs", y.Clubs.Count), ("Clubs with goals", y.ClubGoals.Select(r => V(r, "Club Node Id")).Distinct().Count()),
            ("Club goal rows", y.ClubGoals.Count), ("Errors", y.Errors.Count),
        };
        for (var i = 0; i < lines.Count; i++)
        {
            sum.Cell(i + 1, 1).Value = lines[i].Item1; sum.Cell(i + 1, 1).Style.Font.Bold = true;
            sum.Cell(i + 1, 2).Value = XLCellValue.FromObject(lines[i].Item2);
        }
        var er = lines.Count + 2;
        foreach (var e in y.Errors.Take(5000)) sum.Cell(er++, 1).Value = e;
        sum.Columns().AdjustToContents(1, 60);

        // The data sheets (rows built once - the database sync maps these same rows, see DbWriter).
        var goalCols = GoalColumns(y);
        foreach (var (name, rows) in BuildSheets(y))
        {
            var ws = Sheet(wb, name, rows);
            if (name == ClubGoalsSheet) SectionBand(ws, 6, goalCols);
            else if (name == DistrictTotalsSheet) SectionBand(ws, 15, goalCols);
        }

        wb.SaveAs(path);
        return path;
    }

    public const string ClubGoalsSheet = "Club Goals", DistrictTotalsSheet = "District Totals",
                        HistoryDistrictsSheet = "History - Districts", HistoryClubsSheet = "History - Clubs";

    /// The rows of every data sheet (all but Summary), in workbook order. Write puts them in Excel; the
    /// worker maps the very same rows to goal_rotary_org_values (DbWriter.BuildRows).
    public static List<(string Name, List<Row> Rows)> BuildSheets(YearResult y)
    {
        var sheets = new List<(string Name, List<Row> Rows)>();
        // "Club Goals" = one row per club, every goal across the top (user 2026-10-22: no club repeated).
        // The one-row-per-goal detail stays in the raw JSON.
        var goalsPerClub = y.ClubGoals.GroupBy(r => V(r, "Club Node Id")?.ToString() ?? "").ToDictionary(g => g.Key, g => g.Count());
        // Every Rotary.org goal as columns, grouped by Rotary.org section (user 2026-10-22): a club row
        // shows each goal's Achieved + Goal (Yes/No goals: Yes/No); a district row shows the totals of its
        // clubs, as on the RCC district summary page (Yes/No goals: clubs with Yes + clubs with the goal).
        var goalCols = GoalColumns(y);
        var byClubGoal = y.ClubGoals
            .GroupBy(r => (Node: V(r, "Club Node Id")?.ToString() ?? "", Goal: (V(r, "Goal.Name") as string)?.Trim() ?? ""))
            .ToDictionary(g => g.Key, g => g.First());
        sheets.Add((ClubGoalsSheet, y.Clubs.Select(r =>
        {
            var node = V(r, "Club Node Id")?.ToString() ?? "";
            var row = new Row
            {
                ["District"] = V(r, "District No"), ["Club Group (AG)"] = V(r, "Club Group (AG)"),
                ["Club"] = V(r, "Name"),
                ["RI Club Id"] = V(r, "RotaryOrganizationId"),
                ["Goals entered"] = goalsPerClub.GetValueOrDefault(node),
            };
            foreach (var gc in goalCols)
            {
                byClubGoal.TryGetValue((node, gc.Goal), out var cg);
                var yn = gc.Type == 3;
                row[$"{gc.Goal} - Achieved"] = cg == null ? null : yn ? YesNo(V(cg, "Progress")) : V(cg, "Progress");
                row[$"{gc.Goal} - Goal"] = cg == null ? null : yn ? YesNo(V(cg, "GoalValue")) : V(cg, "GoalValue");
            }
            return row;
        }).ToList()));

        var districtRows = y.DistrictTotals.Select(r => new Row
        {
            ["District"] = V(r, "District No"), ["As of"] = DateOnly(V(r, "AsOFDate")),
            ["Members"] = V(r, "MemberCount"), ["Members on 1 July"] = V(r, "July1MemberCount"),
            ["Annual Fund (USD)"] = V(r, "AnnualFund"), ["PolioPlus (USD)"] = V(r, "PolioPlusFund"),
            ["Annual Fund cumulative (USD)"] = V(r, "CumulativeAnnualFund"), ["PolioPlus cumulative (USD)"] = V(r, "CumulativePolioPlusFund"),
            ["Major gifts"] = V(r, "MajorGifts"), ["Bequest Society"] = V(r, "PeopleInBequestSociety"), ["Benefactors"] = V(r, "Benefactors"),
            ["Interact clubs"] = V(r, "InteractClubs"), ["Rotaract clubs"] = V(r, "RotoractClubs"), ["Service projects"] = V(r, "ServiceProjects"),
        }).ToList();
        foreach (var row in districtRows)
        {
            var dist = row["District"]?.ToString();
            var mine = y.ClubGoals.Where(r => V(r, "District No")?.ToString() == dist).ToList();
            foreach (var gc in goalCols)
            {
                var rows = mine.Where(r => (V(r, "Goal.Name") as string)?.Trim() == gc.Goal).ToList();
                if (gc.Type == 3)
                {
                    row[$"{gc.Goal} - Clubs with Yes"] = rows.Count(r => Num(V(r, "Progress")) == 1);
                    row[$"{gc.Goal} - Clubs with goal"] = rows.Count;
                }
                else
                {
                    row[$"{gc.Goal} - Achieved"] = Math.Round(rows.Sum(r => Dbl(V(r, "Progress"))), 2);
                    row[$"{gc.Goal} - Goal"] = Math.Round(rows.Sum(r => Dbl(V(r, "GoalValue"))), 2);
                }
            }
        }
        sheets.Add((DistrictTotalsSheet, districtRows));

        // Women count (user 2026-10-26): Rotary's own district figure, then the sum of its clubs and the
        // difference, so a mismatch is easy to spot; club rows below.
        // y.Women holds every year of the Trends answer; these sheets are this year only, the history sheets below the rest.
        var women = y.Women.Where(r => Num(V(r, "Fiscal Year Id")) == y.FiscalYearId).ToList();
        var womenClubs = women.Where(r => V(r, "Level") as string == "Club").ToList();
        sheets.Add(("Women Count", women.Where(r => V(r, "Level") as string == "District").Select(r =>
        {
            var dist = V(r, "District No")?.ToString();
            var sum = womenClubs.Where(c => V(c, "District No")?.ToString() == dist).Sum(c => Dbl(V(c, "Female")));
            return new Row
            {
                ["District"] = dist, ["Female (Rotary.org district)"] = V(r, "Female"), ["Female (sum of clubs)"] = sum,
                ["Difference"] = V(r, "Female") == null ? null : Dbl(V(r, "Female")) - sum,
                ["Male"] = V(r, "Male"), ["Unreported"] = V(r, "Unreported"), ["Self-describe"] = V(r, "Self-describe"),
                ["Prefer not to identify"] = V(r, "Prefer not to identify"),
                ["Members 1 July"] = V(r, "Members 1 July"), ["Members now"] = V(r, "Members now"), ["As of"] = DateOnly(V(r, "As of")),
            };
        }).ToList()));
        sheets.Add(("Women Count - Clubs", womenClubs.Select(r => new Row
        {
            ["District"] = V(r, "District No"), ["Club Group (AG)"] = V(r, "Club Group (AG)"), ["Club"] = V(r, "Club"),
            ["RI Club Id"] = V(r, "RI Club Id"), ["Female"] = V(r, "Female"), ["Male"] = V(r, "Male"),
            ["Unreported"] = V(r, "Unreported"), ["Self-describe"] = V(r, "Self-describe"), ["Prefer not to identify"] = V(r, "Prefer not to identify"),
            ["Members 1 July"] = V(r, "Members 1 July"), ["Members now"] = V(r, "Members now"), ["As of"] = DateOnly(V(r, "As of")),
        }).ToList()));

        // RAG = Rotary's 5 member-size bands (ClubsInDistrict report colours), Rotary clubs only (user 2026-10-26).
        // Members now from the Trends call (= Rotary's ClubsInDistrict report: D3142 4/39/43/19/2, checked
        // 2026-10-28). The club list's MemberCount is stale (it gave 47/8/34/17/1) - used only for a
        // district whose trend rows are missing.
        var trendClubs = women.Where(r => (V(r, "Level") as string) == "Club")
            .GroupBy(r => V(r, "District No")?.ToString() ?? "").ToDictionary(g => g.Key, g => g.ToList());
        sheets.Add(("RAG Bands", y.Clubs.GroupBy(r => V(r, "District No")?.ToString() ?? "").Select(g =>
        {
            // A club whose trend has no "As of" date has no member data at Rotary (new / closing clubs:
            // 40 on 2026-10-28, all 0) - "No member count", not Red (user 2026-10-28).
            var counts = trendClubs.TryGetValue(g.Key, out var tc) && tc.Any(r => V(r, "Members now") != null)
                ? tc.Select(r => V(r, "As of") == null ? null : Num(V(r, "Members now"))).ToList()
                : g.Select(r => Num(V(r, "MemberCount"))).ToList();
            int Band(long lo, long hi) => counts.Count(n => n is long v && v >= lo && v <= hi);
            return new Row
            {
                ["District"] = g.Key, ["Rotary clubs"] = g.Count(),
                ["Red 0-10"] = Band(0, 10), ["Yellow 11-25"] = Band(11, 25), ["Orange 26-50"] = Band(26, 50),
                ["Blue 51-100"] = Band(51, 100), ["Purple 101+"] = Band(101, long.MaxValue),
                ["No member count"] = counts.Count(n => n == null),
            };
        }).ToList()));

        // Rotaractors = Rotary's district Trends figure for Club Type Rotaract (user 2026-10-26/28). Rotary
        // gives no per-club Rotaract count, so the club sheet lists the clubs only.
        var racClubs = y.RotaractClubs.GroupBy(r => V(r, "District No")?.ToString() ?? "").ToDictionary(g => g.Key, g => g.Count());
        sheets.Add(("Rotaractors", women.Where(r => V(r, "Level") as string == "Rotaract District").Select(r => new Row
        {
            ["District"] = V(r, "District No"), ["Active Rotaract clubs"] = racClubs.GetValueOrDefault(V(r, "District No")?.ToString() ?? ""),
            ["Rotaractors 1 July"] = V(r, "Members 1 July"), ["Rotaractors now"] = V(r, "Members now"),
            ["Female"] = V(r, "Female"), ["Male"] = V(r, "Male"), ["As of"] = DateOnly(V(r, "As of")),
        }).ToList()));
        sheets.Add(("Rotaract Clubs", y.RotaractClubs.Select(r => new Row
        {
            ["District"] = V(r, "District No"), ["Club Group (AG)"] = V(r, "Club Group (AG)"), ["Rotaract Club"] = V(r, "Rotaract Club"),
            ["RI Club Id"] = V(r, "RI Club Id"),
        }).ToList()));

        // History (user 2026-10-28): every year Rotary's Trends has (2022-23 on), this year included. District
        // figures are Rotary's own; RAG is worked out from today's clubs that have a figure for that year, so a
        // club terminated since is not in it and one chartered later is left out. No "As of" column: Rotary's
        // date on past years is a year late (2024-25 says 30-06-2026, checked 2026-10-28).
        string Key(Row r, string level) => $"{level}|{V(r, "District No")}|{Num(V(r, "Fiscal Year Id"))}";
        var byKey = y.Women.GroupBy(r => Key(r, V(r, "Level") as string ?? "")).ToDictionary(g => g.Key, g => g.ToList());
        sheets.Add((HistoryDistrictsSheet, y.Women.Where(r => V(r, "Level") as string == "District")
            .OrderBy(r => V(r, "District No")?.ToString()).ThenByDescending(r => Num(V(r, "Fiscal Year Id"))).Select(r =>
        {
            var ra = byKey.GetValueOrDefault(Key(r, "Rotaract District"))?.FirstOrDefault();
            var counts = (byKey.GetValueOrDefault(Key(r, "Club")) ?? new())
                .Select(c => V(c, "As of") == null ? null : Num(V(c, "Members now"))).ToList();
            int Band(long lo, long hi) => counts.Count(n => n is long v && v >= lo && v <= hi);
            return new Row
            {
                ["District"] = V(r, "District No"), ["Rotary Year"] = V(r, "Rotary Year"),
                ["Members 1 July"] = V(r, "Members 1 July"), ["Members now / 30 June"] = V(r, "Members now"),
                ["Female"] = V(r, "Female"), ["Male"] = V(r, "Male"),
                ["Rotaractors 1 July"] = ra == null ? null : V(ra, "Members 1 July"), ["Rotaractors now / 30 June"] = ra == null ? null : V(ra, "Members now"),
                ["Red 0-10"] = Band(0, 10), ["Yellow 11-25"] = Band(11, 25), ["Orange 26-50"] = Band(26, 50),
                ["Blue 51-100"] = Band(51, 100), ["Purple 101+"] = Band(101, long.MaxValue),
                ["No member count"] = counts.Count(n => n == null),
            };
        }).ToList()));
        sheets.Add((HistoryClubsSheet, y.Women.Where(r => V(r, "Level") as string == "Club" && V(r, "As of") != null)
            .OrderBy(r => V(r, "District No")?.ToString()).ThenBy(r => V(r, "Club")?.ToString()).ThenByDescending(r => Num(V(r, "Fiscal Year Id"))).Select(r => new Row
        {
            ["District"] = V(r, "District No"), ["Club Group (AG)"] = V(r, "Club Group (AG)"), ["Club"] = V(r, "Club"),
            ["RI Club Id"] = V(r, "RI Club Id"), ["Rotary Year"] = V(r, "Rotary Year"), ["Female"] = V(r, "Female"), ["Male"] = V(r, "Male"),
            ["Members 1 July"] = V(r, "Members 1 July"), ["Members now / 30 June"] = V(r, "Members now"),
        }).ToList()));

        sheets.Add(("Goals", y.Goals.Select(r => new Row
        {
            ["Category"] = V(r, "Category Name"), ["Goal"] = (V(r, "Name") as string)?.Trim(),
            ["Question"] = (V(r, "Description") as string)?.Trim(), ["Type"] = TypeName(Num(V(r, "GoalTypeId"))),
        }).ToList()));

        return sheets;
    }

    private static object? V(Row r, string key) => r.TryGetValue(key, out var v) ? v : null;
    private static double Dbl(object? v) => v switch { long l => l, int i => i, double d => d, string s when double.TryParse(s, out var x) => x, _ => 0 };

    // The 26 goals in Rotary.org's order: section (category SortOrder) then goal SortOrder.
    private sealed record GoalCol(string Section, string Goal, long? Type);
    private static List<GoalCol> GoalColumns(YearResult y)
    {
        var catSort = y.Categories.ToDictionary(c => V(c, "GoalCategoryId")?.ToString() ?? "", c => Num(V(c, "SortOrder")) ?? 99);
        return y.Goals
            .OrderBy(g => catSort.GetValueOrDefault(V(g, "GoalCategoryId")?.ToString() ?? "", 99))
            .ThenBy(g => Num(V(g, "SortOrder")) ?? 99)
            .Select(g => new GoalCol(V(g, "Category Name") as string ?? "", (V(g, "Name") as string)?.Trim() ?? "", Num(V(g, "GoalTypeId"))))
            .Where(g => g.Goal != "").ToList();
    }

    // A band above the header naming each Rotary.org section over its goal columns.
    private static void SectionBand(IXLWorksheet? ws, int firstGoalCol, List<GoalCol> cols)
    {
        if (ws == null || cols.Count == 0) return;
        ws.Row(1).InsertRowsAbove(1);
        ws.SheetView.FreezeRows(2);
        var c = firstGoalCol;
        foreach (var grp in cols.GroupBy(g => g.Section))   // already ordered by section
        {
            var width = grp.Count() * 2;
            var rng = ws.Range(1, c, 1, c + width - 1);
            rng.Merge().Value = grp.Key;
            rng.Style.Font.Bold = true;
            rng.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            rng.Style.Fill.BackgroundColor = XLColor.FromHtml("#DDEBF7");
            c += width;
        }
    }
    private static long? Num(object? v) => v switch { long l => l, int i => i, double d => (long)d, string s when long.TryParse(s, out var n) => n, _ => null };
    // RCC GoalTypeId: 1 = money (USD), 2 = number, 3 = yes/no, 4 = number of people (Bequest Society).
    private static string? TypeName(long? t) => t switch { 1 => "Amount (USD)", 2 or 4 => "Number", 3 => "Yes/No", _ => null };
    private static object? YesNo(object? v) => Num(v) switch { 1 => "Yes", 0 => "No", null => null, var n => n };
    private static object? DateOnly(object? v) => v is string s
        && (DateTime.TryParse(s, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var d)
            || s.Length >= 10 && DateTime.TryParse(s[..10], System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out d))
        ? d.ToString("dd-MM-yyyy") : v;

    private static IXLWorksheet? Sheet(XLWorkbook wb, string name, List<Row> rows)
    {
        IXLWorksheet? first = null;
        var cols = new List<string>();
        var seen = new HashSet<string>();
        foreach (var r in rows) foreach (var k in r.Keys) if (seen.Add(k)) cols.Add(k);

        var part = 0;
        for (var start = 0; start < Math.Max(rows.Count, 1); start += MaxRowsPerSheet)
        {
            var ws = wb.Worksheets.Add(part == 0 ? name : $"{name} {part + 1}");
            first ??= ws;
            part++;
            for (var c = 0; c < cols.Count; c++) ws.Cell(1, c + 1).Value = cols[c];
            ws.Row(1).Style.Font.Bold = true;
            var chunk = rows.Skip(start).Take(MaxRowsPerSheet).ToList();
            for (var i = 0; i < chunk.Count; i++)
                for (var c = 0; c < cols.Count; c++)
                    if (chunk[i].TryGetValue(cols[c], out var v) && v != null)
                        ws.Cell(i + 2, c + 1).Value = v switch
                        {
                            string s => s.Length > 32000 ? s[..32000] : s,
                            long l => l, double d => d, bool b => b, int n => n,
                            _ => v.ToString(),
                        };
            if (cols.Count > 0) { ws.SheetView.FreezeRows(1); ws.Range(1, 1, Math.Max(chunk.Count + 1, 1), cols.Count).SetAutoFilter(); }
        }
        return first;
    }

    /// The untouched API answers, so nothing is lost even if a field is awkward in Excel.
    public static string WriteRaw(YearResult y, string folder, DateTime runAt)
    {
        var dir = Path.Combine(folder, "raw");
        Directory.CreateDirectory(dir);
        var path = Path.Combine(dir, $"RCC_ClubGoals_{y.Label}_{runAt:yyyy-MM-dd}.json");
        using var fs = File.Create(path);
        using var w = new Utf8JsonWriter(fs, new JsonWriterOptions { Indented = false });
        w.WriteStartArray();
        foreach (var (district, club, clubId, goals) in y.Raw)
        {
            w.WriteStartObject();
            w.WriteString("district", district); w.WriteString("club", club); w.WriteString("clubId", clubId);
            w.WritePropertyName("clubGoals"); goals.WriteTo(w);
            w.WriteEndObject();
        }
        w.WriteEndArray();
        return path;
    }
}

public static class Mailer
{
    /// One mail to one person (worker: "your Rotary.org password stopped working"). Needs Brevo:ApiKey only,
    /// not Email:Enabled (that switch is for the run reports). True when Brevo accepted it.
    public static async Task<bool> SendToAsync(Settings s, string to, string subject, string html)
    {
        if (string.IsNullOrWhiteSpace(s.BrevoApiKey)) { Log.Warn("Brevo:ApiKey is empty - mail not sent."); return false; }
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(2) };
            var payload = new Dictionary<string, object>
            {
                ["sender"] = new { name = s.SenderName, email = s.SenderEmail },
                ["to"] = new[] { new { email = to } },
                ["subject"] = subject,
                ["htmlContent"] = html,
            };
            using var req = new HttpRequestMessage(HttpMethod.Post, s.BrevoApiUrl) { Content = JsonContent.Create(payload) };
            req.Headers.Add("api-key", s.BrevoApiKey);
            var r = await http.SendAsync(req);
            if (r.IsSuccessStatusCode) { Log.Info($"Email sent to {to}."); return true; }
            Log.Warn($"Email to {to} failed: HTTP {(int)r.StatusCode}");
        }
        catch (Exception ex) { Log.Warn($"Email to {to} failed: {ex.Message.Split((char)10)[0]}"); }
        return false;
    }

    /// Same Brevo HTTP route the sync worker uses. Small files are attached; big ones are listed by path.
    public static async Task SendAsync(Settings s, string subject, string html, List<string> files)
    {
        if (!s.EmailEnabled || s.Recipients.Count == 0) return;
        if (string.IsNullOrWhiteSpace(s.BrevoApiKey)) { Log.Warn("Email enabled but Brevo:ApiKey is empty - not sent."); return; }

        var attach = new List<object>();
        long total = 0;
        foreach (var f in files.Where(File.Exists))
        {
            var len = new FileInfo(f).Length;
            if (total + len > s.MaxAttachmentMb * 1024L * 1024L) { html += $"<p>Not attached (too big): {f}</p>"; continue; }
            total += len;
            attach.Add(new { name = Path.GetFileName(f), content = Convert.ToBase64String(await File.ReadAllBytesAsync(f)) });
        }

        using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(5) };
        foreach (var to in s.Recipients)
        {
            var payload = new Dictionary<string, object>
            {
                ["sender"] = new { name = s.SenderName, email = s.SenderEmail },
                ["to"] = new[] { new { email = to } },
                ["subject"] = subject,
                ["htmlContent"] = html,
            };
            if (attach.Count > 0) payload["attachment"] = attach;
            using var req = new HttpRequestMessage(HttpMethod.Post, s.BrevoApiUrl) { Content = JsonContent.Create(payload) };
            req.Headers.Add("api-key", s.BrevoApiKey);
            var r = await http.SendAsync(req);
            if (r.IsSuccessStatusCode) Log.Info($"Email sent to {to}.");
            else Log.Warn($"Email to {to} failed: HTTP {(int)r.StatusCode} {await r.Content.ReadAsStringAsync()}");
        }
    }
}
