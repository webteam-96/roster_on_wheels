using ClosedXML.Excel;

namespace RotaryApi.Services;

// Excel reports of the new goal flow (user 2026-11-18): Disha Goals and District Set Goals.
//   Single  - one district / one club: Auto section, then Manual section; Question · Goal · Achieved · % · Points.
//   Across  - several entities: questions down (category · Auto/Manual), entities across with Goal / Achieved / % /
//             Points each, then Total points · Goals reached · Rank (Disha, RI Director).
//   Down    - several entities: one row per entity (club), the questions across with Goal / Achieved / % / Points,
//             then Total points and Rank (District Set Goals, all clubs).
// Real .xlsx, navy headers, frozen panes, landscape print.
public sealed record GfQuestion(string Category, string Title, bool Auto, string AnswerType, bool TwoDecimals, bool HasBase = false,
    bool IsRcc = false);   // District Set Goals RCC line (user 2026-11-23): RCC Goal · District Set Goal · Achieved, no % / points
public sealed record GfCell(decimal? Goal, string? Achieved, decimal? Pct, decimal Points, decimal? Baseline = null,
    Dictionary<int, decimal>? Monthly = null, decimal? RccGoal = null);   // Disha month-wise (user 2026-11-19): achieved per month 7..6; null = yearly only

public static class GoalFlowExcel
{
    private static readonly XLColor Navy = XLColor.FromHtml("#0B2A5E");
    private static readonly XLColor Gold = XLColor.FromHtml("#F7A81B");
    private static readonly XLColor Band = XLColor.FromHtml("#EEF3FB");
    private static readonly XLColor AutoFill = XLColor.FromHtml("#DBEAFE");
    private static readonly XLColor ManualFill = XLColor.FromHtml("#FEF3C7");
    private static readonly XLColor Line = XLColor.FromHtml("#CBD5E1");
    private static readonly XLColor Reached = XLColor.FromHtml("#DCFCE7");

    private static void Title(IXLWorksheet ws, int cols, string title, string subtitle)
    {
        var t = ws.Range(1, 1, 1, cols); t.Merge();
        t.Value = title; t.Style.Font.Bold = true; t.Style.Font.FontSize = 15; t.Style.Font.FontColor = XLColor.White;
        t.Style.Fill.BackgroundColor = Navy; t.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
        ws.Row(1).Height = 26;
        var s = ws.Range(2, 1, 2, cols); s.Merge();
        s.Value = subtitle; s.Style.Font.FontColor = XLColor.FromHtml("#334155"); s.Style.Font.Italic = true;
        s.Style.Fill.BackgroundColor = Band;
    }

    private static void Head(IXLRange r)
    {
        r.Style.Font.Bold = true; r.Style.Font.FontColor = XLColor.White; r.Style.Fill.BackgroundColor = Navy;
        r.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center; r.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
        r.Style.Alignment.WrapText = true;
        r.Style.Border.OutsideBorder = XLBorderStyleValues.Thin; r.Style.Border.InsideBorder = XLBorderStyleValues.Thin;
        r.Style.Border.OutsideBorderColor = Line; r.Style.Border.InsideBorderColor = Line;
    }

    private static void TypeCell(IXLCell c, bool auto)
    {
        c.Value = auto ? "Auto Fetch" : "Manual Entry";   // names (user 2026-11-19)
        c.Style.Fill.BackgroundColor = auto ? AutoFill : ManualFill;
        c.Style.Font.Bold = true; c.Style.Font.FontColor = auto ? XLColor.FromHtml("#1D4ED8") : XLColor.FromHtml("#B45309");
        c.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
    }

    private static void Num(IXLCell c, decimal? v, bool twoDp = false)
    {
        if (v == null) { c.Value = "-"; c.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center; c.Style.Font.FontColor = XLColor.FromHtml("#94A3B8"); return; }
        c.Value = v.Value; c.Style.NumberFormat.Format = twoDp ? "#,##0.00" : "#,##0";
    }

    private static void Achieved(IXLCell c, string? a)
    {
        if (string.IsNullOrWhiteSpace(a)) { c.Value = "-"; c.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center; c.Style.Font.FontColor = XLColor.FromHtml("#94A3B8"); return; }
        if (decimal.TryParse(a, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var n))
        { c.Value = n; c.Style.NumberFormat.Format = n == Math.Floor(n) ? "#,##0" : "#,##0.00"; }
        else { c.Value = a; c.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center; }
        c.Style.Font.Bold = true;
    }

    private static void Pct(IXLCell c, decimal? p, bool twoDp)
    {
        if (p == null) { c.Value = "-"; c.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center; c.Style.Font.FontColor = XLColor.FromHtml("#94A3B8"); return; }
        c.Value = p.Value / 100m; c.Style.NumberFormat.Format = twoDp ? "0.00%" : "0%";
        if (p.Value >= 100m) { c.Style.Fill.BackgroundColor = Reached; c.Style.Font.FontColor = XLColor.FromHtml("#15803D"); c.Style.Font.Bold = true; }
    }

    private static void Points(IXLCell c, decimal p)
    {
        c.Value = p; c.Style.NumberFormat.Format = "#,##0"; c.Style.Font.Bold = p > 0;
        if (p > 0) c.Style.Font.FontColor = XLColor.FromHtml("#047857");
    }

    private static byte[] Save(XLWorkbook wb)
    {
        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        wb.Dispose();
        return ms.ToArray();
    }

    private static void Print(IXLWorksheet ws)
    {
        ws.PageSetup.PageOrientation = XLPageOrientation.Landscape;
        ws.PageSetup.FitToPages(1, 0);
        ws.PageSetup.Margins.Left = 0.3; ws.PageSetup.Margins.Right = 0.3;
    }

    // ── one district / one club ──
    // showPct = false (District Set Goals, user 2026-11-23): no % / Achieved % anywhere in the workbook.
    public static byte[] Single(string title, string subtitle, List<GfQuestion> qs, List<GfCell> cells, bool showPoints = true, List<int>? months = null, bool showPct = true)
    {
        var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add(months != null ? "YTD (Till Date)" : "Goals");   // YTD (Till Date) · Quarter · Month wise - as the RCC report (user 2026-11-19)
        int cols = (showPoints ? 6 : 5) - (showPct ? 0 : 1);   // no Points column for the RI Director's Disha report (user 2026-11-19)
        int ptsCol = showPct ? 6 : 5;
        Title(ws, cols, title, subtitle);
        int r = 4;
        decimal autoPts = 0, manualPts = 0;
        foreach (var auto in new[] { true, false })
        {
            var idx = Enumerable.Range(0, qs.Count).Where(i => qs[i].Auto == auto && !qs[i].IsRcc).ToList();
            if (idx.Count == 0) continue;
            var sec = ws.Range(r, 1, r, cols); sec.Merge();
            sec.Value = auto ? "AUTO FETCH  -  filled by the system" : "MANUAL ENTRY  -  typed";
            sec.Style.Font.Bold = true; sec.Style.Font.FontColor = XLColor.White;
            sec.Style.Fill.BackgroundColor = auto ? XLColor.FromHtml("#1D4ED8") : XLColor.FromHtml("#D97706");
            r++;
            var h = ws.Range(r, 1, r, cols);
            string[] heads = new[] { "Question", "Type", "Goal", "Achieved" }.Concat(showPct ? new[] { "Achieved %" } : Array.Empty<string>())
                .Concat(showPoints ? new[] { "Points" } : Array.Empty<string>()).ToArray();
            for (int i = 0; i < heads.Length; i++) ws.Cell(r, i + 1).Value = heads[i];
            Head(h); r++;
            string? cat = null;
            foreach (var i in idx)
            {
                var q = qs[i]; var x = cells[i];
                if (q.Category != cat)
                {
                    cat = q.Category;
                    var b = ws.Range(r, 1, r, cols); b.Merge(); b.Value = cat; b.Style.Font.Bold = true;
                    b.Style.Font.FontColor = Navy; b.Style.Fill.BackgroundColor = Band; r++;
                }
                ws.Cell(r, 1).Value = q.Title; ws.Cell(r, 1).Style.Alignment.WrapText = true;
                TypeCell(ws.Cell(r, 2), q.Auto);
                if (q.AnswerType == "number") Num(ws.Cell(r, 3), x.Goal, q.TwoDecimals);
                else { ws.Cell(r, 3).Value = q.AnswerType == "yesno" ? "Yes" : "-"; ws.Cell(r, 3).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center; }
                Achieved(ws.Cell(r, 4), x.Achieved);
                if (showPct) Pct(ws.Cell(r, 5), x.Pct, q.TwoDecimals);
                if (showPoints) Points(ws.Cell(r, ptsCol), x.Points);
                ws.Range(r, 1, r, cols).Style.Border.BottomBorder = XLBorderStyleValues.Thin;
                ws.Range(r, 1, r, cols).Style.Border.BottomBorderColor = Line;
                if (auto) autoPts += x.Points; else manualPts += x.Points;
                r++;
            }
            r++;
        }
        // RCC goals (user 2026-11-23): Rotary.org RCC Goal + Achieved, the District Set Goal next to them; no % / points.
        var rccIdx = Enumerable.Range(0, qs.Count).Where(i => qs[i].IsRcc).ToList();
        decimal rccPts = 0;
        if (rccIdx.Count > 0)
        {
            var sec = ws.Range(r, 1, r, cols); sec.Merge();
            sec.Value = "RCC GOALS  -  from Rotary.org (Auto)";
            sec.Style.Font.Bold = true; sec.Style.Font.FontColor = XLColor.White; sec.Style.Fill.BackgroundColor = Navy;
            r++;
            // RCC points (user 2026-11-23): the "Type" column carries the points instead (every RCC line is Auto).
            string[] heads = showPoints ? new[] { "Question", "RCC Goal", "District Set Goal", "Achieved", "Points" }
                                        : new[] { "Question", "RCC Goal", "District Set Goal", "Achieved" };
            for (int i = 0; i < heads.Length; i++) ws.Cell(r, i + 1).Value = heads[i];
            Head(ws.Range(r, 1, r, cols)); r++;
            string? cat = null;
            foreach (var i in rccIdx)
            {
                var q = qs[i]; var x = cells[i];
                if (q.Category != cat)
                {
                    cat = q.Category;
                    var b = ws.Range(r, 1, r, cols); b.Merge(); b.Value = cat; b.Style.Font.Bold = true;
                    b.Style.Font.FontColor = Navy; b.Style.Fill.BackgroundColor = Band; r++;
                }
                ws.Cell(r, 1).Value = q.Title; ws.Cell(r, 1).Style.Alignment.WrapText = true;
                Num(ws.Cell(r, 2), x.RccGoal, q.TwoDecimals);
                Num(ws.Cell(r, 3), x.Goal, q.TwoDecimals);
                Achieved(ws.Cell(r, 4), x.Achieved);
                if (showPoints) { Points(ws.Cell(r, 5), x.Points); rccPts += x.Points; }
                ws.Range(r, 1, r, cols).Style.Border.BottomBorder = XLBorderStyleValues.Thin;
                ws.Range(r, 1, r, cols).Style.Border.BottomBorderColor = Line;
                r++;
            }
            r++;
        }
        // RCC points count inside Auto Fetch points (user 2026-11-23: "RCC counted inside Auto everywhere").
        var totals = new[] { ("Auto Fetch points", autoPts + rccPts, AutoFill), ("Manual Entry points", manualPts, ManualFill), ("Total points", autoPts + manualPts + rccPts, Gold) };
        if (showPoints) foreach (var (label, v, fill) in totals)
        {
            var l = ws.Range(r, 1, r, ptsCol - 1); l.Merge(); l.Value = label; l.Style.Font.Bold = true;
            l.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right; l.Style.Fill.BackgroundColor = fill;
            Points(ws.Cell(r, ptsCol), v); ws.Cell(r, ptsCol).Style.Fill.BackgroundColor = fill; ws.Cell(r, ptsCol).Style.Font.Bold = true;
            r++;
        }
        ws.Column(1).Width = 52; ws.Column(2).Width = 14;
        for (int c = 3; c <= cols; c++) ws.Column(c).Width = 15;
        ws.SheetView.FreezeRows(2);
        Print(ws);
        if (months != null)
        {
            PeriodSheetSingle(wb, true, title, subtitle, qs, cells, months, showPct, dsg: !showPct);    // Quarter, then Month wise - the RCC report's order
            PeriodSheetSingle(wb, false, title, subtitle, qs, cells, months, showPct, dsg: !showPct);
        }
        return Save(wb);
    }

    // Totals per entity (Total points, goals reached) and the rank by points.
    private static (decimal[] Pts, int[] Goals, int[] Reached, int[] Rank) Totals(List<GfQuestion> qs, int n, Func<int, int, GfCell> cell)
    {
        var pts = new decimal[n]; var goals = new int[n]; var reached = new int[n];
        for (int e = 0; e < n; e++)
            for (int i = 0; i < qs.Count; i++)
            {
                var x = cell(i, e);
                pts[e] += x.Points;
                if (qs[i].AnswerType == "yesno" || (qs[i].AnswerType == "number" && x.Goal > 0))
                { goals[e]++; if (x.Pct >= 100m) reached[e]++; }
            }
        var order = Enumerable.Range(0, n).OrderByDescending(e => pts[e]).ThenByDescending(e => reached[e]).ToList();
        var rank = new int[n];
        for (int k = 0; k < order.Count; k++) rank[order[k]] = k + 1;
        return (pts, goals, reached, rank);
    }

    // ── questions down, entities (districts) across ──
    public static byte[] QuestionsDown(string title, string subtitle, string entityWord, List<GfQuestion> qs, List<string> entities, GfCell[,] cells)
    {
        var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add("Goals");
        int cols = 3 + entities.Count * 4;
        Title(ws, Math.Min(cols, 16384), title, subtitle);
        int h1 = 4, h2 = 5;
        ws.Cell(h1, 1).Value = "Category"; ws.Range(h1, 1, h2, 1).Merge();
        ws.Cell(h1, 2).Value = "Question"; ws.Range(h1, 2, h2, 2).Merge();
        ws.Cell(h1, 3).Value = "Type"; ws.Range(h1, 3, h2, 3).Merge();
        for (int e = 0; e < entities.Count; e++)
        {
            int c0 = 4 + e * 4;
            var top = ws.Range(h1, c0, h1, c0 + 3); top.Merge(); top.Value = entities[e];
            string[] sub = { "Goal", "Achieved", "%", "Points" };
            for (int k = 0; k < 4; k++) ws.Cell(h2, c0 + k).Value = sub[k];
        }
        Head(ws.Range(h1, 1, h2, cols));
        for (int e = 0; e < entities.Count; e++) ws.Range(h1, 4 + e * 4, h1, 7 + e * 4).Style.Fill.BackgroundColor = e % 2 == 0 ? Navy : XLColor.FromHtml("#17458F");
        int r = h2 + 1;
        string? cat = null;
        for (int i = 0; i < qs.Count; i++)
        {
            var q = qs[i];
            if (q.Category != cat) { cat = q.Category; }
            ws.Cell(r, 1).Value = q.Category; ws.Cell(r, 1).Style.Font.FontColor = Navy; ws.Cell(r, 1).Style.Fill.BackgroundColor = Band;
            ws.Cell(r, 2).Value = q.Title; ws.Cell(r, 2).Style.Font.Bold = true; ws.Cell(r, 2).Style.Alignment.WrapText = true;
            TypeCell(ws.Cell(r, 3), q.Auto);
            for (int e = 0; e < entities.Count; e++)
            {
                int c0 = 4 + e * 4; var x = cells[i, e];
                if (q.AnswerType == "number") Num(ws.Cell(r, c0), x.Goal, q.TwoDecimals);
                else { ws.Cell(r, c0).Value = q.AnswerType == "yesno" ? "Yes" : "-"; ws.Cell(r, c0).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center; }
                Achieved(ws.Cell(r, c0 + 1), x.Achieved);
                Pct(ws.Cell(r, c0 + 2), x.Pct, q.TwoDecimals);
                Points(ws.Cell(r, c0 + 3), x.Points);
                ws.Cell(r, c0).Style.Border.LeftBorder = XLBorderStyleValues.Thin; ws.Cell(r, c0).Style.Border.LeftBorderColor = Line;
            }
            ws.Range(r, 1, r, cols).Style.Border.BottomBorder = XLBorderStyleValues.Hair;
            ws.Range(r, 1, r, cols).Style.Border.BottomBorderColor = Line;
            r++;
        }
        var t = Totals(qs, entities.Count, (i, e) => cells[i, e]);
        foreach (var (label, kind) in new[] { ("Total points", 0), ("Goals reached", 1), ("Rank", 2) })
        {
            var l = ws.Range(r, 1, r, 3); l.Merge(); l.Value = label; l.Style.Font.Bold = true;
            l.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right; l.Style.Fill.BackgroundColor = kind == 0 ? Gold : Band;
            for (int e = 0; e < entities.Count; e++)
            {
                var rg = ws.Range(r, 4 + e * 4, r, 7 + e * 4); rg.Merge();
                rg.Value = kind == 0 ? t.Pts[e] : kind == 1 ? $"{t.Reached[e]} / {t.Goals[e]}" : t.Rank[e];
                if (kind == 0) rg.Style.NumberFormat.Format = "#,##0";
                rg.Style.Font.Bold = true; rg.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
                rg.Style.Fill.BackgroundColor = kind == 0 ? Gold : Band;
            }
            r++;
        }
        ws.Column(1).Width = 24; ws.Column(2).Width = 44; ws.Column(3).Width = 14;
        for (int c = 4; c <= cols; c++) ws.Column(c).Width = 11;
        ws.SheetView.Freeze(h2, 3);
        Print(ws);

        // Ranking sheet
        var rk = wb.Worksheets.Add("Ranking");
        Title(rk, 5, title + " - Ranking", subtitle);
        string[] rh = { "Rank", entityWord, "Total points", "Goals reached", "Goals" };
        for (int k = 0; k < rh.Length; k++) rk.Cell(4, k + 1).Value = rh[k];
        Head(rk.Range(4, 1, 4, 5));
        int rr = 5;
        foreach (var e in Enumerable.Range(0, entities.Count).OrderBy(e => t.Rank[e]))
        {
            rk.Cell(rr, 1).Value = t.Rank[e]; rk.Cell(rr, 1).Style.Font.Bold = true; rk.Cell(rr, 1).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            rk.Cell(rr, 2).Value = entities[e];
            Points(rk.Cell(rr, 3), t.Pts[e]);
            rk.Cell(rr, 4).Value = t.Reached[e]; rk.Cell(rr, 5).Value = t.Goals[e];
            if (t.Rank[e] <= 3) rk.Range(rr, 1, rr, 5).Style.Fill.BackgroundColor = XLColor.FromHtml("#FEF9C3");
            rr++;
        }
        rk.Column(1).Width = 8; rk.Column(2).Width = 40; rk.Column(3).Width = 14; rk.Column(4).Width = 14; rk.Column(5).Width = 10;
        rk.SheetView.FreezeRows(4);
        return Save(wb);
    }

    // ── entities (clubs) down, questions across ──
    public static byte[] EntitiesDown(string title, string subtitle, string entityWord, List<GfQuestion> qs, List<string> entities, GfCell[,] cells)
    {
        var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add("Goals");
        int fixedCols = 2, cols = fixedCols + qs.Count * 4 + 2;
        Title(ws, cols, title, subtitle);
        int h0 = 4, h1 = 5, h2 = 6;   // category · question (+ Auto / Manual) · Goal / Achieved / % / Points
        ws.Cell(h0, 1).Value = "Rank"; ws.Range(h0, 1, h2, 1).Merge();
        ws.Cell(h0, 2).Value = entityWord; ws.Range(h0, 2, h2, 2).Merge();
        int c = fixedCols + 1;
        for (int i = 0; i < qs.Count; i++)
        {
            ws.Range(h0, c, h0, c + 3).Merge().Value = qs[i].Category;
            ws.Range(h1, c, h1, c + 3).Merge().Value = $"{qs[i].Title}  ({(qs[i].Auto ? "Auto Fetch" : "Manual Entry")})";
            string[] sub = { "Goal", "Achieved", "%", "Points" };
            for (int k = 0; k < 4; k++) ws.Cell(h2, c + k).Value = sub[k];
            c += 4;
        }
        ws.Range(h0, c, h2, c).Merge().Value = "Total points";
        ws.Range(h0, c + 1, h2, c + 1).Merge().Value = "Goals reached";
        Head(ws.Range(h0, 1, h2, cols));
        c = fixedCols + 1;
        for (int i = 0; i < qs.Count; i++)
        {
            ws.Range(h1, c, h1, c + 3).Style.Fill.BackgroundColor = qs[i].Auto ? XLColor.FromHtml("#1D4ED8") : XLColor.FromHtml("#D97706");
            c += 4;
        }
        ws.Row(h1).Height = 42;
        var t = Totals(qs, entities.Count, (i, e) => cells[i, e]);
        int r = h2 + 1;
        foreach (var e in Enumerable.Range(0, entities.Count).OrderBy(e => t.Rank[e]))
        {
            ws.Cell(r, 1).Value = t.Rank[e]; ws.Cell(r, 1).Style.Font.Bold = true; ws.Cell(r, 1).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            ws.Cell(r, 2).Value = entities[e]; ws.Cell(r, 2).Style.Font.Bold = true;
            c = fixedCols + 1;
            for (int i = 0; i < qs.Count; i++)
            {
                var q = qs[i]; var x = cells[i, e];
                if (q.AnswerType == "number") Num(ws.Cell(r, c), x.Goal, q.TwoDecimals);
                else { ws.Cell(r, c).Value = q.AnswerType == "yesno" ? "Yes" : "-"; ws.Cell(r, c).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center; }
                Achieved(ws.Cell(r, c + 1), x.Achieved);
                Pct(ws.Cell(r, c + 2), x.Pct, q.TwoDecimals);
                Points(ws.Cell(r, c + 3), x.Points);
                ws.Cell(r, c).Style.Border.LeftBorder = XLBorderStyleValues.Thin; ws.Cell(r, c).Style.Border.LeftBorderColor = Line;
                c += 4;
            }
            Points(ws.Cell(r, c), t.Pts[e]); ws.Cell(r, c).Style.Fill.BackgroundColor = Gold; ws.Cell(r, c).Style.Font.Bold = true;
            ws.Cell(r, c + 1).Value = $"{t.Reached[e]} / {t.Goals[e]}"; ws.Cell(r, c + 1).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            if (r % 2 == 0) ws.Range(r, 1, r, 2).Style.Fill.BackgroundColor = Band;
            r++;
        }
        ws.Column(1).Width = 7; ws.Column(2).Width = 36;
        for (int k = fixedCols + 1; k <= cols; k++) ws.Column(k).Width = 11;
        ws.SheetView.Freeze(h2, 2);
        Print(ws);
        return Save(wb);
    }

    // ── Disha zone / all districts (user 2026-11-19): districts DOWN, across = Category / Question /
    // As on July 1st · Goal · Achieved · % (no Points, no Type) - the Overview's figures. ──
    public static byte[] DistrictsDownOverview(string title, string subtitle, List<GfQuestion> qs, List<string> entities, GfCell[,] cells, string entityWord = "District", bool showPoints = false, List<int>? months = null, bool showPct = true)
    {
        var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add(months != null ? "YTD (Till Date)" : "Goals");   // YTD (Till Date) · Quarter · Month wise - as the RCC report (user 2026-11-19)
        string[] Measures(GfQuestion q) => q.IsRcc ? new[] { "RCC Goal", "District Set Goal", "Achieved" }.Concat(showPoints ? new[] { "Points" } : Array.Empty<string>()).ToArray() : (q.AnswerType == "number"
            ? (q.HasBase ? new[] { "As on July 1st", "Goal", "Achieved" } : new[] { "Goal", "Achieved" }).Concat(showPct ? new[] { "%" } : Array.Empty<string>()).ToArray()
            : new[] { "Achieved" }).Concat(showPoints ? new[] { "Points" } : Array.Empty<string>()).ToArray();
        var widths = qs.Select(q => Measures(q).Length).ToList();
        int cols = 1 + widths.Sum();
        Title(ws, cols, title, subtitle);
        int h0 = 4, h1 = 5, h3 = 6;   // category · question · figures
        ws.Range(h0, 1, h3, 1).Merge().Value = entityWord;
        int c = 2;
        for (int i = 0; i < qs.Count; i++)
        {
            int w = widths[i];
            // Category spans its questions (consecutive ones in the same category).
            if (i == 0 || qs[i].Category != qs[i - 1].Category)
            {
                int span = 0;
                for (int j = i; j < qs.Count && qs[j].Category == qs[i].Category; j++) span += widths[j];
                ws.Range(h0, c, h0, c + span - 1).Merge().Value = qs[i].Category;
            }
            var qr = ws.Range(h1, c, h1, c + w - 1); qr.Merge(); qr.Value = qs[i].Title;
            var m = Measures(qs[i]);
            for (int k = 0; k < w; k++) ws.Cell(h3, c + k).Value = m[k];
            c += w;
        }
        Head(ws.Range(h0, 1, h3, cols));
        ws.Range(h0, 2, h0, cols).Style.Fill.BackgroundColor = Gold; ws.Range(h0, 2, h0, cols).Style.Font.FontColor = Navy;
        ws.Row(h1).Height = 42;
        int r = h3 + 1;
        for (int e = 0; e < entities.Count; e++)
        {
            ws.Cell(r, 1).Value = entities[e]; ws.Cell(r, 1).Style.Font.Bold = true;
            if (r % 2 == 0) ws.Cell(r, 1).Style.Fill.BackgroundColor = Band;
            c = 2;
            for (int i = 0; i < qs.Count; i++)
            {
                var q = qs[i]; var x = cells[i, e];
                if (q.IsRcc)
                {
                    Num(ws.Cell(r, c++), x.RccGoal, q.TwoDecimals);
                    Num(ws.Cell(r, c++), x.Goal, q.TwoDecimals);
                    Achieved(ws.Cell(r, c++), x.Achieved);
                    if (showPoints) Points(ws.Cell(r, c++), x.Points);
                    ws.Cell(r, c - widths[i]).Style.Border.LeftBorder = XLBorderStyleValues.Thin; ws.Cell(r, c - widths[i]).Style.Border.LeftBorderColor = Line;
                    continue;
                }
                if (q.AnswerType == "number")
                {
                    if (q.HasBase) Num(ws.Cell(r, c++), x.Baseline);
                    Num(ws.Cell(r, c++), x.Goal, q.TwoDecimals);
                    Achieved(ws.Cell(r, c++), x.Achieved);
                    if (showPct) Pct(ws.Cell(r, c++), x.Pct, q.TwoDecimals);
                }
                else Achieved(ws.Cell(r, c++), x.Achieved);
                if (showPoints) Points(ws.Cell(r, c++), x.Points);
                ws.Cell(r, c - widths[i]).Style.Border.LeftBorder = XLBorderStyleValues.Thin; ws.Cell(r, c - widths[i]).Style.Border.LeftBorderColor = Line;
            }
            r++;
        }
        ws.Column(1).Width = entityWord == "Club" ? 34 : 16;
        for (int k = 2; k <= cols; k++) ws.Column(k).Width = 12;
        ws.SheetView.Freeze(h3, 1);
        Print(ws);
        if (months != null)
        {
            PeriodSheetDown(wb, true, title, subtitle, qs, entities, cells, entityWord, months, showPct, dsg: !showPct);    // Quarter, then Month wise - the RCC report's order
            PeriodSheetDown(wb, false, title, subtitle, qs, entities, cells, entityWord, months, showPct, dsg: !showPct);
        }
        return Save(wb);
    }

    // ── Month wise / Quarterly (Disha, user 2026-11-19): the SAME layout as the RCC report's sheets.
    //   Month wise: As on July 1st · Goal · Goal Details · Achieved · Achieved (%), then each month ONE header with
    //   Goal (the yearly goal spread over the months, running - the RCC rule) / Achieved (running) / Achieved (%).
    //   Quarterly:  As on July 1st · Goal · Goal to add, then each quarter Goal / Achieved / Achieved (%).
    //   Achieved cells coloured against that period's goal (below = red, equal = yellow, above = green).
    //   A question with no month figures (Manual Entry, yearly-only) shows its year figures only. ──
    private static readonly string[] MonthName = { "", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec" };
    private static readonly string[] QLabel = { "Q1 · Jul-Sep", "Q2 · Oct-Dec", "Q3 · Jan-Mar", "Q4 · Apr-Jun" };
    private static readonly int[][] QMonths = { new[] { 7, 8, 9 }, new[] { 10, 11, 12 }, new[] { 1, 2, 3 }, new[] { 4, 5, 6 } };

    private static decimal Start(GfCell x) => x.Baseline ?? 0m;
    // The yearly goal's growth spread over the 12 months (GoalSettingService.SpreadTarget - the RCC report's rule).
    private static Dictionary<int, decimal>? MonthShares(GfCell x, List<int> months)
    {
        if (x.Goal == null) return null;
        var growth = Math.Round(x.Goal.Value - Start(x), 0, MidpointRounding.AwayFromZero);
        var shares = growth <= 0m ? months.Select(_ => 0m).ToList() : GoalSettingService.SpreadTarget(growth, months.Count, true);
        return months.Select((m, i) => (m, shares[i])).ToDictionary(t => t.m, t => t.Item2);
    }
    private static decimal MonthVal(GfCell x, int m) => x.Monthly != null && x.Monthly.TryGetValue(m, out var v) ? v : 0m;
    private static decimal? RunPct(decimal? goal, decimal? ach, bool two) =>
        goal is > 0 && ach.HasValue ? Math.Round(ach.Value * 100m / goal.Value, two ? 2 : 0, MidpointRounding.AwayFromZero) : null;
    private static void Status(IXLCell c, decimal? goal, decimal ach)
    {
        if (goal == null) return;
        decimal g = Math.Round(goal.Value, 0), a = Math.Round(ach, 0);
        c.Style.Fill.BackgroundColor = a < g ? XLColor.FromHtml("#FDE2E2") : a == g ? XLColor.FromHtml("#FEF3C7") : XLColor.FromHtml("#DCFCE7");
    }
    private static decimal? YearAch(GfCell x) =>
        x.Monthly != null ? x.Monthly.Values.Sum() : decimal.TryParse(x.Achieved, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var n) ? n - Start(x) : null;

    // The period columns of one question for one entity (Month wise: 12 x 3, Quarterly: 4 x 3).
    private static IEnumerable<(string Group, string Label, Func<GfCell, decimal?> Val, bool Pct, Func<GfCell, decimal?>? Goal)> PeriodLines(bool quarter, List<int> months)
    {
        if (quarter)
            for (int q = 0; q < 4; q++)
            {
                var qm = QMonths[q];
                decimal? QT(GfCell x) => MonthShares(x, months) is { } s ? qm.Sum(m => s.GetValueOrDefault(m)) : null;
                decimal? QA(GfCell x) => x.Monthly == null ? null : qm.Sum(m => MonthVal(x, m));
                yield return (QLabel[q], "Goal", QT, false, null);
                yield return (QLabel[q], "Achieved", QA, false, QT);
                yield return (QLabel[q], "Achieved (%)", x => RunPct(QT(x), QA(x), false), true, null);
            }
        else
            for (int i = 0; i < months.Count; i++)
            {
                var upTo = months.Take(i + 1).ToList();
                decimal? MT(GfCell x) => MonthShares(x, months) is { } s ? upTo.Sum(m => s.GetValueOrDefault(m)) : null;
                decimal? MA(GfCell x) => x.Monthly == null ? null : upTo.Sum(m => MonthVal(x, m));
                yield return (MonthName[months[i]], "Goal", MT, false, null);
                yield return (MonthName[months[i]], "Achieved", MA, false, MT);
                yield return (MonthName[months[i]], "Achieved (%)", x => RunPct(MT(x), MA(x), false), true, null);
            }
    }
    private static List<(string Label, Func<GfCell, decimal?> Val, bool Pct)> YearLines(bool quarter) => quarter
        ? new() { ("As on July 1st", x => x.Baseline, false), ("Goal", x => x.Goal, false), ("Goal to add", x => x.Goal.HasValue ? x.Goal.Value - Start(x) : null, false) }
        : new() { ("As on July 1st", x => x.Baseline, false), ("Goal", x => x.Goal, false), ("Goal Details", x => x.Goal.HasValue ? x.Goal.Value - Start(x) : null, false),
                  ("Achieved", YearAch, false), ("Achieved (%)", x => x.Goal.HasValue ? RunPct(x.Goal.Value - Start(x), YearAch(x), true) : null, true) };

    // District Set Goals (user 2026-11-23): RCC Goal + District Set Goal + Achieved as the year columns (no "As on
    // July 1st" / "Goal Details"), and the RCC lines are listed too (their months are blank - Rotary.org gives a year figure).
    private static List<(string Label, Func<GfCell, decimal?> Val, bool Pct)> DsgYearLines() => new()
        { ("RCC Goal", x => x.RccGoal, false), ("District Set Goal", x => x.Goal, false), ("Achieved", YearAch, false) };

    private static void PeriodSheetSingle(XLWorkbook wb, bool quarter, string title, string subtitle, List<GfQuestion> qs, List<GfCell> cells, List<int> months, bool showPct = true, bool dsg = false)
    {
        var ws = wb.Worksheets.Add(quarter ? "Quarter" : "Month wise");
        var yl = dsg ? DsgYearLines() : YearLines(quarter).Where(y => showPct || !y.Pct).ToList();
        var pl = PeriodLines(quarter, months).Where(p => showPct || !p.Pct).ToList();
        int g = showPct ? 3 : 2;   // columns per period
        int cols = 1 + yl.Count + pl.Count;
        Title(ws, cols, title, $"{subtitle}   ·   {(quarter ? "Quarter" : "Month wise")}");
        int r = 4, hr = r;
        void Tall(int col, string txt) { var hc = ws.Cell(hr, col); hc.Value = txt; ws.Range(hr, col, hr + 1, col).Merge(); }
        Tall(1, "Particulars");
        for (int k = 0; k < yl.Count; k++) Tall(2 + k, yl[k].Label);
        int c0 = 2 + yl.Count;
        for (int k = 0; k < pl.Count; k += g) { ws.Range(r, c0 + k, r, c0 + k + g - 1).Merge().Value = pl[k].Group; }
        for (int k = 0; k < pl.Count; k++) ws.Cell(r + 1, c0 + k).Value = pl[k].Label;
        Head(ws.Range(r, 1, r + 1, cols));
        r += 2;
        string? cat = null;
        for (int i = 0; i < qs.Count; i++)
        {
            var q = qs[i]; var x = cells[i];
            if (q.AnswerType != "number" || (x.Monthly == null && !(dsg && q.IsRcc))) continue;   // month figures only (user 2026-11-19); DSG also its RCC lines
            if (q.Category != cat)
            {
                cat = q.Category;
                var b = ws.Range(r, 1, r, cols); b.Merge(); b.Value = cat; b.Style.Font.Bold = true;
                b.Style.Font.FontColor = Navy; b.Style.Fill.BackgroundColor = Band; r++;
            }
            ws.Cell(r, 1).Value = q.Title; ws.Cell(r, 1).Style.Alignment.WrapText = true;
            if (q.AnswerType != "number") { Achieved(ws.Cell(r, 1 + yl.Count), x.Achieved); r++; continue; }
            for (int k = 0; k < yl.Count; k++)
            {
                var v = yl[k].Val(x); var cell = ws.Cell(r, 2 + k);
                if (yl[k].Pct) Pct(cell, v, q.TwoDecimals); else Num(cell, v, q.TwoDecimals);
            }
            if (x.Monthly != null)
                for (int k = 0; k < pl.Count; k++)
                {
                    var v = pl[k].Val(x); var cell = ws.Cell(r, c0 + k);
                    if (pl[k].Pct) Pct(cell, v, q.TwoDecimals); else Num(cell, v, q.TwoDecimals);
                    if (pl[k].Goal != null && v.HasValue) Status(cell, pl[k].Goal!(x), v.Value);
                }
            ws.Range(r, 1, r, cols).Style.Border.BottomBorder = XLBorderStyleValues.Thin;
            ws.Range(r, 1, r, cols).Style.Border.BottomBorderColor = Line;
            r++;
        }
        ws.Column(1).Width = 42;
        for (int k = 2; k <= cols; k++) ws.Column(k).Width = 12;
        ws.SheetView.Freeze(5, 1);
        Print(ws);
    }

    // Several districts / clubs: entity DOWN; across = section · question · year lines, then period (one header)
    // with Goal / Achieved / Achieved (%). Only questions with month figures (as the RCC report's 5).
    private static void PeriodSheetDown(XLWorkbook wb, bool quarter, string title, string subtitle, List<GfQuestion> qs, List<string> entities,
        GfCell[,] cells, string entityWord, List<int> months, bool showPct = true, bool dsg = false)
    {
        var ws = wb.Worksheets.Add(quarter ? "Quarter" : "Month wise");
        var yl = dsg ? DsgYearLines() : YearLines(quarter).Where(y => showPct || !y.Pct).ToList();
        var pl = PeriodLines(quarter, months).Where(p => showPct || !p.Pct).ToList();
        int g = showPct ? 3 : 2;   // columns per period
        var idx = Enumerable.Range(0, qs.Count).Where(i => qs[i].AnswerType == "number"
            && ((dsg && qs[i].IsRcc) || Enumerable.Range(0, entities.Count).Any(e => cells[i, e].Monthly != null))).ToList();
        int w = yl.Count + pl.Count;
        int cols = 1 + Math.Max(1, idx.Count * w);
        Title(ws, cols, title, $"{subtitle}   ·   {(quarter ? "Quarter" : "Month wise")}");
        int h0 = 4, h1 = 5, hg = 6, h2 = 7;
        ws.Range(h0, 1, h2, 1).Merge().Value = entityWord;
        int c = 2;
        for (int n = 0; n < idx.Count; n++)
        {
            var q = qs[idx[n]];
            if (n == 0 || q.Category != qs[idx[n - 1]].Category)
            {
                int span = 0;
                for (int j = n; j < idx.Count && qs[idx[j]].Category == q.Category; j++) span += w;
                ws.Range(h0, c, h0, c + span - 1).Merge().Value = q.Category;
            }
            ws.Range(h1, c, h1, c + w - 1).Merge().Value = q.Title;
            for (int k = 0; k < yl.Count; k++) ws.Range(hg, c + k, h2, c + k).Merge().Value = yl[k].Label;
            for (int k = 0; k < pl.Count; k += g) ws.Range(hg, c + yl.Count + k, hg, c + yl.Count + k + g - 1).Merge().Value = pl[k].Group;
            for (int k = 0; k < pl.Count; k++) ws.Cell(h2, c + yl.Count + k).Value = pl[k].Label;
            c += w;
        }
        Head(ws.Range(h0, 1, h2, cols));
        if (cols > 1) { ws.Range(h0, 2, h0, cols).Style.Fill.BackgroundColor = Gold; ws.Range(h0, 2, h0, cols).Style.Font.FontColor = Navy; }
        ws.Row(h1).Height = 30;
        int r = h2 + 1;
        for (int e = 0; e < entities.Count; e++)
        {
            ws.Cell(r, 1).Value = entities[e]; ws.Cell(r, 1).Style.Font.Bold = true;
            if (r % 2 == 0) ws.Cell(r, 1).Style.Fill.BackgroundColor = Band;
            c = 2;
            foreach (var i in idx)
            {
                var q = qs[i]; var x = cells[i, e];
                foreach (var yline in yl)
                {
                    var v = yline.Val(x); var cell = ws.Cell(r, c++);
                    if (yline.Pct) Pct(cell, v, q.TwoDecimals); else Num(cell, v, q.TwoDecimals);
                }
                foreach (var p in pl)
                {
                    var cell = ws.Cell(r, c++);
                    if (x.Monthly == null) { Num(cell, null); continue; }
                    var v = p.Val(x);
                    if (p.Pct) Pct(cell, v, q.TwoDecimals); else Num(cell, v, q.TwoDecimals);
                    if (p.Goal != null && v.HasValue) Status(cell, p.Goal(x), v.Value);
                }
            }
            r++;
        }
        ws.Column(1).Width = entityWord == "Club" ? 34 : 16;
        for (int k = 2; k <= cols; k++) ws.Column(k).Width = 11;
        ws.SheetView.Freeze(h2, 1);
        Print(ws);
    }
}
