using ClosedXML.Excel;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

// New Goal Setting (Rotary.org preview) report - user 2026-10-30: "like the old goal setting report,
// with the new names; don't change the old reports". So this renders the SAME workbook as
// RenderEntityWorkbookAsync (YTD (Till Date) · Quarter · Month wise, same bands, columns and figures,
// same writers), with only the names and the order of the new screens:
//   • categories in the new tab order - Membership, Foundation, Public Image, Youth Service - and each
//     band named "<Rotary.org section> (<category>)", e.g. "Expand Our Reach (Membership)";
//   • the goal rows renamed to the Rotary.org field names of the sheet "New" (Clubs, Members, Women
//     Members, Annual Fund contributions, Media stories about club projects ...).
// Nothing in the old report path is called differently; the old reports are untouched.
public partial class GoalSettingService
{
    // Category (as the reports name it) -> new section band. Order = the new tabs.
    private static readonly (string Category, string Band)[] RotaryReportBands =
    {
        ("Membership", "Expand Our Reach (Membership)"),
        ("Foundation", "Increase our Impact (Foundation)"),
        ("Public Image", "Increase Our Ability to Adapt (Public Image)"),
        ("Youth Service", "Enhance Participant Engagement (Youth Service)"),
    };

    // Old goal (group) name -> Rotary.org field name (sheet "New"; club rows next to their district twins).
    private static readonly Dictionary<string, string> RotaryReportGroupNames = new(StringComparer.OrdinalIgnoreCase)
    {
        ["New Clubs"] = "Clubs", ["Total Members"] = "Members", ["Women Membership"] = "Women Members",
        ["Annual Fund"] = "Annual Fund contributions", ["Polio Plus Fund"] = "PolioPlus Fund contributions",
        ["Annual Fund YTD"] = "Annual Fund contributions", ["PolioPlus Fund YTD"] = "PolioPlus Fund contributions",
        ["Other Funds YTD"] = "Other Funds", ["Endowment Fund YTD"] = "Endowment Fund", ["Total"] = "Total Giving",
        ["Rotaract"] = "Rotaract clubs", ["Interact"] = "Interact clubs", ["RCC"] = "RCC (Rotary Community Corps)",
    };

    // Public Image: each point is its own goal with a Rotary.org name (same as the screen).
    private static readonly Dictionary<string, string> RotaryReportPiNames = new(StringComparer.Ordinal)
    {
        ["district_pi_seminar"] = "District Public Image Seminar",
        ["specific_pi_session_training"] = "Public Image Session in Training Events",
        ["district_website"] = "District Website", ["district_social_media"] = "District Social Media",
        ["club_website_percent"] = "Club Website %", ["club_social_media_percent"] = "Club Social Media %",
        ["club_website"] = "Club Website", ["club_social_media"] = "Club Social Media",
        ["bulletin_newsletter"] = "Bulletin / Monthly Newsletter",
        ["press_media_coverage"] = "Media stories about club projects",
        ["district_polio_awareness_programme"] = "District Polio Awareness Programme",
        ["inter_district_pi_programme"] = "Inter District Public Image Programme",
        ["mega_pi_activities"] = "Mega Public Image Activities",
        ["adoption_garden_park_road"] = "Adoption - Garden / Park / Road",
        ["display_items"] = "Display (Bus / Rail / Airport / Highways)",
        ["public_rally"] = "Public Rally / Marathon / Human Chain / Car Rally",
        ["suggestions"] = "Other Public Image activity (suggestions)",
    };

    /// District report (new design). oversight = the RI Director / Zone / District Assistant scope check
    /// (as BuildDistrictGoalSettingReportScopedAsync); otherwise the District Admin check (as
    /// BuildDistrictMonthlyExcelAsync). Several districts (a zone) stack on the same sheets.
    public async Task<byte[]?> BuildRotaryDistrictReportAsync(int memberId, IReadOnlyList<int> districtIds, int? yearId, bool oversight)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var ids = new List<int>();
        if (oversight)
        {
            // ROW: no goal oversight roles, so the multi-district view is SuperAdmin only.
            if (!await IsSuperAdminForGoalScopeAsync(conn, memberId))
                throw new UnauthorizedAccessException("This district is outside your goal-setting scope.");
            foreach (var d in districtIds)
                if (!await GoalDistrictHiddenAsync(conn, d)) ids.Add(d);
        }
        else
        {
            var d = await ResolveDistrictIdAsync(conn, memberId, districtIds.FirstOrDefault());
            if (d != 0 && !await GoalDistrictHiddenAsync(conn, d)) ids.Add(d);
        }
        if (ids.Count == 0) return null;
        var (resolvedYearId, yearLabel, isEditable) = await ResolveYearAsync(conn, yearId);
        if (resolvedYearId == 0) return null;

        var entities = new List<(string Title, string EntityType, int ClubId, int DistrictId)>();
        foreach (var d in ids)
        {
            var num = await conn.ExecuteScalarAsync<string>(
                "SELECT DistrictNumber FROM district_master WHERE pk_district_id = @Id", new { Id = d }) ?? "";
            entities.Add(($"District {num}", "District", 0, d));
        }
        var filter = oversight ? await OversightCategoryFilterAsync(conn, memberId) : await DaCategoryFilterAsync(conn, memberId);
        var wb = await RenderRotaryWorkbookAsync(conn, entities, resolvedYearId,
            $"Rotary Year {yearLabel}   ·   Generated {DateTime.UtcNow:dd MMM yyyy, hh:mm tt}", isEditable, filter, dropYouthPct: oversight);
        return wb == null ? null : SaveAndDispose(wb);
    }

    /// Club report (new design) - the Club Admin's own club, or a club of the District Admin's district.
    public async Task<byte[]?> BuildRotaryClubReportAsync(int memberId, int clubId, int? yearId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var id = await ResolveClubIdAsync(conn, memberId, clubId);
        if (id == 0 || await GoalClubHiddenAsync(conn, id)) return null;
        var (resolvedYearId, yearLabel, isEditable) = await ResolveYearAsync(conn, yearId);
        if (resolvedYearId == 0) return null;
        var row = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT c.ClubName AS name, d.DistrictNumber AS num FROM club_master c LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id WHERE c.pk_club_id = @Id AND c.isdeleted = 0",
            new { Id = id });
        if (row == null) return null;
        string title = $"{(string?)row.name ?? $"Club {id}"} · District {(string?)row.num ?? ""}";
        var wb = await RenderRotaryWorkbookAsync(conn, new() { (title, "Club", id, 0) }, resolvedYearId,
            $"Rotary Year {yearLabel}   ·   Generated {DateTime.UtcNow:dd MMM yyyy, hh:mm tt}", isEditable, await DaCategoryFilterAsync(conn, memberId));
        return wb == null ? null : SaveAndDispose(wb);
    }

    /// Every club of a district (user 2026-11-02, "All" in the club picker): the same report in the
    /// district-wise layout - goals down the rows, one column per club, then Total. District Admin of that
    /// district / Super Admin, or (oversight) a goal role whose scope holds the district.
    public async Task<byte[]?> BuildRotaryAllClubsReportAsync(int memberId, int districtId, int? yearId, bool oversight)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        HashSet<int>? filter;
        bool excludeRotaract;
        if (oversight)
        {
            if (!await CanAccessDistrictReportAsync(conn, memberId, districtId))
                throw new UnauthorizedAccessException("This district is outside your goal-setting scope.");
            filter = await OversightCategoryFilterAsync(conn, memberId);
            excludeRotaract = false;
        }
        else
        {
            districtId = await ResolveDistrictIdAsync(conn, memberId, districtId);
            filter = await DaCategoryFilterAsync(conn, memberId);
            // Same club list as the old all-clubs report (Rotaract hidden from the District Admin).
            excludeRotaract = ClubScopeSql.HideRotaract(await ClubAdminAccessHelper.IsSuperAdminAsync(conn, memberId));
        }
        if (districtId == 0 || await GoalDistrictHiddenAsync(conn, districtId)) return null;
        var (resolvedYearId, yearLabel, isEditable) = await ResolveYearAsync(conn, yearId);
        if (resolvedYearId == 0) return null;
        var num = await conn.ExecuteScalarAsync<string>(
            "SELECT DistrictNumber FROM district_master WHERE pk_district_id = @Id", new { Id = districtId }) ?? "";
        var clubs = (await conn.QueryAsync<(int Id, string Name)>(
            "SELECT pk_club_id AS Id, ClubName AS Name FROM club_master WHERE fk_district_id = @D AND isdeleted = 0 AND IsActive = 1"
            + " AND " + HierarchyScopeSql.ClubLive("club_master")
            + (excludeRotaract ? " AND " + ClubScopeSql.NotRotaract("") : "") + " ORDER BY ClubName",
            new { D = districtId })).ToList();
        if (clubs.Count == 0) return null;
        var wb = await RenderRotaryWorkbookAsync(conn, clubs.Select(c => (c.Name, "Club", c.Id, 0)).ToList(), resolvedYearId,
            $"District {num}   ·   Rotary Year {yearLabel}   ·   Generated {DateTime.UtcNow:dd MMM yyyy, hh:mm tt}", isEditable, filter,
            multiTitle: $"Club Goal Setting — District {num} (all clubs)");
        return wb == null ? null : SaveAndDispose(wb);
    }

    // Same sheets and writers as RenderEntityWorkbookAsync, one entity after another.
    private async Task<XLWorkbook?> RenderRotaryWorkbookAsync(MySqlConnection conn,
        List<(string Title, string EntityType, int ClubId, int DistrictId)> entities, int yearId, string subtitle,
        bool autoFillLive, HashSet<int>? onlyCategoryIds, bool dropYouthPct = false, string? multiTitle = null)
    {
        var blocks = new List<(string Title, string EntityType, string? TrfAsOn,
            List<(string Name, List<GoalMetricComputed> Rows, List<GoalMonthPeriodDto> Months)> PerCat)>();
        // Each entity on its own pooled connection, 12 at a time (a district's ~100 clubs, a zone's
        // districts), as the old all-clubs report does; the order stays as given.
        var sem = new SemaphoreSlim(12);
        var computed = await Task.WhenAll(entities.Select(async e =>
        {
            await sem.WaitAsync();
            try
            {
                using var c2 = CreateConnection();
                await c2.OpenAsync();
                return (e, Data: await ComputeEntityPerCatAsync(c2, e.EntityType, e.ClubId, e.DistrictId, yearId, autoFillLive));
            }
            finally { sem.Release(); }
        }));
        var trfAsOnByType = new Dictionary<string, string?>();
        foreach (var (e, data) in computed)
        {
            if (data == null) continue;
            var perCat = data.Value.PerCat;
            if (dropYouthPct) DropYouthPct(perCat);
            if (!trfAsOnByType.TryGetValue(e.EntityType, out var asOn))
                trfAsOnByType[e.EntityType] = asOn = await FoundationAsOnAsync(conn, yearId, e.EntityType);
            blocks.Add((e.Title, e.EntityType, asOn, RotaryOrder(perCat)));
        }
        if (blocks.Count == 0) return null;
        var months0 = UnionMonths(blocks.SelectMany(b => b.PerCat.Select(p => p.Months)));
        bool grid = blocks[0].EntityType == "District";
        string title0 = blocks.Count == 1 ? blocks[0].Title : multiTitle ?? "District Goal Setting";

        var wb = new XLWorkbook();

        if (blocks.Count > 1)
        {
            // Several districts (zone / all, user 2026-10-30): every sheet goes goals down the rows,
            // districts across, then Total.
            // More than one club or district (user 2026-11-02, the rule everywhere): one ROW per club /
            // district, the questions across. A single club or district keeps its own tabular report.
            WriteDistrictMatrixSheets(wb, blocks.Select(b => (b.Title, b.PerCat)).ToList(), title0, subtitle, blocks[0].TrfAsOn, months0);
        }
        else
        {
            var s1 = wb.Worksheets.Add("YTD (Till Date)");
            int r = 1;
            s1.Column(1).Width = 34;
            for (int i = 2; i <= 5; i++) s1.Column(i).Width = 15;
            RenderTitleBand(s1, 5, title0, subtitle, ref r);
            WriteYtdBlock(s1, blocks[0].PerCat, ref r, blocks[0].TrfAsOn);
            s1.PageSetup.PrintAreas.Add($"A1:E{Math.Max(1, r - 1)}");
            s1.PageSetup.PageOrientation = XLPageOrientation.Landscape;
            s1.PageSetup.FitToPages(1, 0);
            s1.PageSetup.Margins.Top = 0.5; s1.PageSetup.Margins.Bottom = 0.5;
            s1.PageSetup.Margins.Left = 0.4; s1.PageSetup.Margins.Right = 0.4;

            var sq = wb.Worksheets.Add("Quarter");
            int qCols = 1 + 1 + 1 + 4;
            sq.Column(1).Width = 30;
            r = 1;
            RenderTitleBand(sq, qCols, title0, subtitle + "   ·   Quarter", ref r);
            foreach (var b in blocks)
            {
                if (blocks.Count > 1) RenderSectionBand(sq, qCols, b.Title, ref r);
                WriteQuarterBlock(sq, b.PerCat, qCols, ref r);
            }
            sq.PageSetup.PageOrientation = XLPageOrientation.Landscape;
            sq.PageSetup.FitToPages(1, 0);
            sq.PageSetup.Margins.Top = 0.5; sq.PageSetup.Margins.Bottom = 0.5;
            sq.PageSetup.Margins.Left = 0.4; sq.PageSetup.Margins.Right = 0.4;
            if (r > 1) sq.PageSetup.PrintAreas.Add($"A1:{XLHelper.GetColumnLetterFromNumber(qCols)}{r - 1}");

            var s2 = wb.Worksheets.Add("Month wise");
            int totalCols = grid ? 1 + 1 + 1 + 2 * months0.Count + 2 : 1 + 1 + 1 + months0.Count;
            s2.Column(1).Width = 30;
            r = 1;
            RenderTitleBand(s2, totalCols, title0, subtitle + "   ·   Month wise", ref r);
            foreach (var b in blocks)
            {
                if (blocks.Count > 1) RenderSectionBand(s2, totalCols, b.Title, ref r);
                if (grid) WriteMonthGridBlock(s2, b.PerCat, ref r);
                else WriteMonthBlock(s2, b.PerCat, totalCols, ref r);
            }
            s2.PageSetup.PageOrientation = XLPageOrientation.Landscape;
            s2.PageSetup.FitToPages(1, 0);
            s2.PageSetup.Margins.Top = 0.5; s2.PageSetup.Margins.Bottom = 0.5;
            s2.PageSetup.Margins.Left = 0.4; s2.PageSetup.Margins.Right = 0.4;
            if (r > 1) s2.PageSetup.PrintAreas.Add($"A1:{XLHelper.GetColumnLetterFromNumber(totalCols)}{r - 1}");

        }

        // The writers name each category band by the category itself (they also use that name for the
        // TRF / annual-only rules), so the new section names are put on the bands afterwards.
        var bandOf = RotaryReportBands.ToDictionary(x => x.Category, x => x.Band, StringComparer.OrdinalIgnoreCase);
        bandOf["TRF"] = bandOf["Foundation"];
        foreach (var ws in wb.Worksheets)
            foreach (var cell in ws.Column(1).CellsUsed())
                if (cell.IsMerged() && cell.DataType == XLDataType.Text && bandOf.TryGetValue(cell.GetString().Trim(), out var band))
                    cell.Value = band;
        return wb;
    }

    // ── Several clubs / districts: one row each, the questions across, then Total. Each goal prints its
    //    lines with the SAME figures as that club's / district's own sheet (WriteYtdBlock /
    //    WriteQuarterBlock / WriteMonthGridBlock). Total = added up; a Total % uses the same rule. ──
    private sealed record MatrixLine(string Label, Func<GoalMetricComputed, decimal?> Val, bool Pct = false,
        Func<GoalMetricComputed, decimal?>? StatusTarget = null, Func<GoalMetricComputed, decimal?>? TotalPct = null);

    // Several clubs / districts (user 2026-11-02): one ROW per club or district (Total at the bottom),
    // the questions ACROSS: a section band, the goal name over its columns, then
    // its lines (As on July 1st / Target / Achieved / % ...). Same figures, colours and Total rules.
    private int WriteEntityRowsMatrix(IXLWorksheet s,
        List<(string Title, List<(string Name, List<GoalMetricComputed> Rows, List<GoalMonthPeriodDto> Months)> PerCat)> blocks,
        string title, string subtitle,
        Func<string, bool> includeCategory, Func<string, GoalMetricComputed, bool> includeMetric,
        Func<string, GoalMetricComputed, List<MatrixLine>> linesOf)
    {
        int n = blocks.Count;
        List<GoalMetricComputed>? RowsOf(int bi, string cat) =>
            blocks[bi].PerCat.FirstOrDefault(p => string.Equals(p.Name, cat, StringComparison.OrdinalIgnoreCase)).Rows;
        var bandOf = RotaryReportBands.ToDictionary(x => x.Category, x => x.Band, StringComparer.OrdinalIgnoreCase);
        bandOf["TRF"] = bandOf["Foundation"];

        // Columns: (category, goal, line). A one-value goal (Public Image / Yes-No) is a single column.
        var cols = new List<(string Cat, GoalMetricComputed M, string Label, MatrixLine? Line, bool Single)>();
        foreach (var cat in blocks.SelectMany(b => b.PerCat.Select(p => p.Name)).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (!includeCategory(cat)) continue;
            var src = Enumerable.Range(0, n).Select(i => RowsOf(i, cat)).FirstOrDefault(x => x != null && x.Count > 0);
            if (src == null) continue;
            var rows = src.Where(m => includeMetric(cat, m)).ToList();
            foreach (var m in rows)
            {
                var label = QualifiedLabel(m, rows);
                if (m.SingleValue || m.DisplayText != null) { cols.Add((cat, m, label, null, true)); continue; }
                foreach (var line in linesOf(cat, m)) cols.Add((cat, m, label, line, false));
            }
        }
        int last = 1 + cols.Count;
        s.Column(1).Width = 38;
        for (int i = 2; i <= last; i++) s.Column(i).Width = 13;
        int r = 1;
        RenderTitleBand(s, Math.Max(2, last), title, subtitle, ref r);

        // Three header rows: section · goal · line.
        int h0 = r, h1 = r + 1, h2 = r + 2;
        var club = s.Cell(h0, 1); club.Value = "Club"; StyleHeaderCell(club);
        StyleHeaderCell(s.Cell(h1, 1)); StyleHeaderCell(s.Cell(h2, 1));
        s.Range(h0, 1, h2, 1).Merge();
        void Span(int row, int from, int to, string text, bool band)
        {
            var c = s.Cell(row, from); c.Value = text;
            for (int k = from; k <= to; k++) StyleHeaderCell(s.Cell(row, k));
            if (to > from) s.Range(row, from, row, to).Merge();
            c.Style.Alignment.WrapText = true;
            if (band) { c.Style.Fill.BackgroundColor = RepBlue; c.Style.Font.FontColor = XLColor.White; }
        }
        for (int i = 0; i < cols.Count;)
        {
            int j = i; while (j + 1 < cols.Count && string.Equals(cols[j + 1].Cat, cols[i].Cat, StringComparison.OrdinalIgnoreCase)) j++;
            Span(h0, 2 + i, 2 + j, bandOf.TryGetValue(cols[i].Cat, out var b) ? b : cols[i].Cat, true);
            for (int k = i; k <= j;)
            {
                int e = k; while (e + 1 <= j && cols[e + 1].M.FieldKey == cols[k].M.FieldKey) e++;
                Span(h1, 2 + k, 2 + e, cols[k].Label, false);
                for (int q = k; q <= e; q++) Span(h2, 2 + q, 2 + q, cols[q].Single ? "Value" : cols[q].Line!.Label, false);
                k = e + 1;
            }
            i = j + 1;
        }
        s.Row(h1).Height = 30; s.Row(h2).Height = 30;
        r = h2 + 1;
        s.SheetView.Freeze(h2, 1);

        GoalMetricComputed? Metric(int bi, string cat, string key) => RowsOf(bi, cat)?.FirstOrDefault(x => x.FieldKey == key);
        for (int bi = 0; bi < n; bi++)
        {
            s.Cell(r, 1).Value = blocks[bi].Title;
            for (int ci = 0; ci < cols.Count; ci++)
            {
                var (cat, m, _, line, single) = cols[ci];
                var c = s.Cell(r, 2 + ci);
                var mm = Metric(bi, cat, m.FieldKey);
                if (single)
                {
                    if (mm?.DisplayText != null) { c.Value = mm.DisplayText; c.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center; }
                    else SetNumCell(c, mm?.Target);
                    continue;
                }
                var v = mm == null ? null : line!.Val(mm);
                if (line!.Pct) SetPctCell(c, v, m.TwoDecimalPct); else SetNumCell(c, v);
                if (line.StatusTarget != null && mm != null && v.HasValue) ColourStatusCell(c, MonthStatus(line.StatusTarget(mm), v.Value));
            }
            BorderRow(s, r, last);
            r++;
        }

        // Total row: the clubs added up; a Total % by the same rule as one club.
        s.Cell(r, 1).Value = "Total";
        for (int ci = 0; ci < cols.Count; ci++)
        {
            var (cat, m, _, line, single) = cols[ci];
            var per = Enumerable.Range(0, n).Select(bi => Metric(bi, cat, m.FieldKey)).Where(x => x != null).Select(x => x!).ToList();
            decimal? Sum(Func<GoalMetricComputed, decimal?> pick)
            {
                var vals = per.Select(pick).Where(v => v.HasValue).ToList();
                return vals.Count == 0 ? null : vals.Sum(v => v!.Value);
            }
            var c = s.Cell(r, 2 + ci);
            if (single) { if (!per.Any(x => x.DisplayText != null)) SetNumCell(c, Sum(x => x.Target)); continue; }
            if (line!.Pct)
            {
                var sum = new GoalMetricComputed
                {
                    FieldKey = m.FieldKey, TwoDecimalPct = m.TwoDecimalPct, HasBaseline = m.HasBaseline,
                    BaselineIsReferenceOnly = m.BaselineIsReferenceOnly,
                    Baseline = Sum(x => x.Baseline), Target = Sum(x => x.Target), Achieved = Sum(x => x.Achieved),
                };
                SetPctCell(c, line.TotalPct?.Invoke(sum), m.TwoDecimalPct);
            }
            else
            {
                var tv = Sum(line.Val);
                SetNumCell(c, tv);
                if (line.StatusTarget != null && tv.HasValue) ColourStatusCell(c, MonthStatus(Sum(line.StatusTarget), tv.Value));
            }
        }
        BorderRow(s, r, last);
        s.Row(r).Style.Font.Bold = true;
        r++;

        s.PageSetup.PageOrientation = XLPageOrientation.Landscape;
        s.PageSetup.FitToPages(1, 0);
        s.PageSetup.Margins.Top = 0.5; s.PageSetup.Margins.Bottom = 0.5;
        s.PageSetup.Margins.Left = 0.4; s.PageSetup.Margins.Right = 0.4;
        s.PageSetup.PrintAreas.Add($"A1:{XLHelper.GetColumnLetterFromNumber(last)}{r - 1}");
        return last;
    }

    // The three district-wise sheets. Lines and figures follow the one-district writers.
    private void WriteDistrictMatrixSheets(XLWorkbook wb,
        List<(string Title, List<(string Name, List<GoalMetricComputed> Rows, List<GoalMonthPeriodDto> Months)> PerCat)> blocks,
        string title, string subtitle, string? trfAsOn, List<GoalMonthPeriodDto> months)
    {
        int Write(IXLWorksheet ws,
            List<(string Title, List<(string Name, List<GoalMetricComputed> Rows, List<GoalMonthPeriodDto> Months)> PerCat)> bl,
            string t, string st, Func<string, bool> incCat, Func<string, GoalMetricComputed, bool> incMetric,
            Func<string, GoalMetricComputed, List<MatrixLine>> lines, ref int row)
            => WriteEntityRowsMatrix(ws, bl, t, st, incCat, incMetric, lines);
        string BaseLabel(GoalMetricComputed m) =>
            string.IsNullOrWhiteSpace(ReportLabel(m.BaselineLabel)) ? "As on July 1st" : ReportLabel(m.BaselineLabel);
        static decimal YearStart(GoalMetricComputed m) => m.BaselineIsReferenceOnly ? 0m : (m.Baseline ?? 0m);

        // YTD (Till Date): As on July 1st · Target · Achieved · Achievement (%).
        int r = 1;
        Write(wb.Worksheets.Add("YTD (Till Date)"), blocks, title, subtitle,
            _ => true, (_, m) => m.MonthlyTracked || m.SingleValue,
            (cat, m) =>
            {
                var l = new List<MatrixLine>();
                if (m.HasBaseline) l.Add(new(BaseLabel(m), x => x.Baseline));
                l.Add(new(TargetHeader(cat), x => x.Target));
                l.Add(new(AchievedHeader(cat, trfAsOn), x => x.Achieved));
                l.Add(new("Achievement (%)", x => x.Pct, Pct: true,
                    TotalPct: x => ComputePct(x.Baseline, x.Target, x.Achieved, x.HasBaseline && !x.BaselineIsReferenceOnly, x.TwoDecimalPct ? 2 : 0)));
                return l;
            }, ref r);

        // Quarter: the year's target and what the quarters add up to, then each quarter's Target /
        // Achieved / %. Youth Service and Public Image are yearly only.
        string[] qLabels = { "Q1 · Jul-Sep", "Q2 · Oct-Dec", "Q3 · Jan-Mar", "Q4 · Apr-Jun" };
        r = 1;
        Write(wb.Worksheets.Add("Quarter"), blocks, title, subtitle + "   ·   Quarter",
            cat => !IsAnnualOnlyCategory(cat), (_, m) => m.MonthlyTracked,
            (cat, m) =>
            {
                var l = new List<MatrixLine>();
                if (m.HasBaseline) l.Add(new("As on Jul 1 / Value", x => x.Baseline));
                l.Add(new(TargetHeader(cat), x => x.Target));
                l.Add(new("To add", x => x.SplitBase));
                for (int q = 1; q <= 4; q++)
                {
                    int qq = q;
                    decimal? QT(GoalMetricComputed x) => x.QuarterlyTargets.TryGetValue(qq, out var v) ? v : null;
                    decimal? QA(GoalMetricComputed x) => x.QuarterlyAchieved.TryGetValue(qq, out var v) ? v : null;
                    decimal? QP(decimal? t, decimal? a, bool two) => t.HasValue && t.Value != 0m && a.HasValue
                        ? Math.Round(a.Value / t.Value * 100m, two ? 2 : 0, MidpointRounding.AwayFromZero) : null;
                    l.Add(new($"{qLabels[q - 1]} Target", QT));
                    l.Add(new($"{qLabels[q - 1]} Achieved", QA));
                    // Total quarter % = added-up achieved ÷ added-up target (each district: its own).
                    var qTot = blocks.Select(b => b.PerCat.FirstOrDefault(p => string.Equals(p.Name, cat, StringComparison.OrdinalIgnoreCase)).Rows?
                        .FirstOrDefault(x => x.FieldKey == m.FieldKey)).Where(x => x != null).ToList();
                    decimal? tT = qTot.Select(x => QT(x!)).Where(v => v.HasValue).Select(v => v!.Value).DefaultIfEmpty().Sum();
                    decimal? tA = qTot.Any(x => QA(x!).HasValue) ? qTot.Select(x => QA(x!)).Where(v => v.HasValue).Sum(v => v!.Value) : null;
                    l.Add(new($"{qLabels[q - 1]} Achievement (%)", x => QP(QT(x), QA(x), x.TwoDecimalPct), Pct: true,
                        TotalPct: _ => QP(tT, tA, m.TwoDecimalPct)));
                }
                return l;
            }, ref r);

        // Month wise: Target / Achieved / % for the year, then each month's running Target and Achieved
        // (from 0, coloured red / yellow / green against that month's target) - as the one-district grid.
        r = 1;
        Write(wb.Worksheets.Add("Month wise"), blocks, title, subtitle + "   ·   Month wise",
            cat => !IsAnnualOnlyCategory(cat),
            (cat, m) => m.MonthlyTracked,
            (cat, m) =>
            {
                bool membership = cat.Equals("Membership", StringComparison.OrdinalIgnoreCase);
                decimal? Last(GoalMetricComputed x)
                {
                    decimal run = 0m; decimal? last = null;
                    foreach (var mo in months.Where(mo => mo.IsAvailable))
                    { run += x.Monthly.TryGetValue(mo.Month, out var v) && v.HasValue ? v.Value : 0m; last = run; }
                    return last;
                }
                var l = new List<MatrixLine>();
                if (membership) l.Add(new("As on July 1st", x => x.BaselineIsReferenceOnly || !x.HasBaseline ? null : x.Baseline));
                l.Add(new(TargetHeader(cat), x => x.Target));
                if (membership) l.Add(new("Target Details", x => x.Target.HasValue ? x.Target.Value - YearStart(x) : null));
                l.Add(new("Achieved", Last, StatusTarget: x => x.Target.HasValue ? x.Target.Value - YearStart(x) : null));
                l.Add(new("% Ach.", x => { var a = Last(x); return a.HasValue ? PctAtMonth(x, YearStart(x) + a.Value) : null; }, Pct: true,
                    TotalPct: x => { var a = Sum2(m, blocks, cat, Last); return a.HasValue ? PctAtMonth(x, YearStart(x) + a.Value) : null; }));
                foreach (var mo in months)
                {
                    var month = mo;
                    decimal? MT(GoalMetricComputed x) => RunningMonthTargets(x, months).TryGetValue(month.Month, out var v) ? v : null;
                    decimal? MA(GoalMetricComputed x)
                    {
                        if (!month.IsAvailable) return null;
                        decimal run = 0m;
                        foreach (var p in months.TakeWhile(p => p.Month != month.Month).Append(month).Where(p => p.IsAvailable))
                            run += x.Monthly.TryGetValue(p.Month, out var v) && v.HasValue ? v.Value : 0m;
                        return run;
                    }
                    l.Add(new($"{mo.Label} Target", MT));
                    l.Add(new($"{mo.Label} Achieved", MA, StatusTarget: MT));
                }
                return l;
            }, ref r);
    }

    // Σ of one figure of a goal across the districts.
    private static decimal? Sum2(GoalMetricComputed m,
        List<(string Title, List<(string Name, List<GoalMetricComputed> Rows, List<GoalMonthPeriodDto> Months)> PerCat)> blocks,
        string cat, Func<GoalMetricComputed, decimal?> pick)
    {
        var vals = blocks.Select(b => b.PerCat.FirstOrDefault(p => string.Equals(p.Name, cat, StringComparison.OrdinalIgnoreCase)).Rows?
                .FirstOrDefault(x => x.FieldKey == m.FieldKey))
            .Where(x => x != null).Select(x => pick(x!)).Where(v => v.HasValue).ToList();
        return vals.Count == 0 ? null : vals.Sum(v => v!.Value);
    }

    // New tab order + Rotary.org goal names. Category names themselves stay (the writers key on them).
    private static List<(string Name, List<GoalMetricComputed> Rows, List<GoalMonthPeriodDto> Months)> RotaryOrder(
        List<(string Name, List<GoalMetricComputed> Rows, List<GoalMonthPeriodDto> Months)> perCat)
    {
        int Rank(string name)
        {
            var key = IsTrfCategory(name) ? "Foundation" : name;
            var i = Array.FindIndex(RotaryReportBands, x => string.Equals(x.Category, key, StringComparison.OrdinalIgnoreCase));
            return i < 0 ? RotaryReportBands.Length : i;
        }
        foreach (var (name, rows, _) in perCat)
            foreach (var m in rows)
            {
                bool pi = string.Equals(name, "Public Image", StringComparison.OrdinalIgnoreCase);
                if (pi && RotaryReportPiNames.TryGetValue(m.FieldKey, out var piName)) { m.Label = piName; m.GroupName = piName; continue; }
                // Youth: the Rotaractors fields sit in the "Rotaract" group - a goal of their own now.
                var group = m.GroupName;
                if (string.Equals(group, "Rotaract", StringComparison.OrdinalIgnoreCase) && m.FieldKey.Contains("members", StringComparison.Ordinal))
                    group = "Rotaractors";
                else if (RotaryReportGroupNames.TryGetValue(group, out var g)) group = g;
                if (string.Equals(m.Label, m.GroupName, StringComparison.OrdinalIgnoreCase)) m.Label = group;
                m.GroupName = group;
            }
        return perCat.OrderBy(p => Rank(p.Name)).ToList();
    }
}
