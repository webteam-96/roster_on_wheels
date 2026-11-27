using System.Globalization;
using System.Net;
using System.Text;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

// Builds the OCV / Governor's Official Visit Excel report as an HTML-table workbook
// (real .xlsx since 2026-11-13 - see Build; BuildHtml is the old, unused HTML version) — same structure as the legacy
// OCV list export the user asked us to replicate:
//   • A blue header block: title + Report Generated at / Club Name / Club ID / District Number /
//     President / Assistant Governor / Rotary Year.
//   • Main documents table: Sr.No. | Particulars | Document Type | Status (Uploaded/Pending) |
//     Download Document — one row per document-type across ALL categories, in category order.
//     "Download Here" hyperlinks the API's documents/{id}/download URL for uploaded docs; blank otherwise.
//   • Live Documents section: Sr | Particulars | Download hyperlink (the module snapshots the
//     Word report renders, deep-linked to the frontend Live Documents page).
//   • Newsletters section: Sr | Particulars | Download hyperlink (the attachment / external link).
//   • "End Of Report" footer.
public static class OcvReportExcelBuilder
{
    // Match the standard report background (exportToCSV / AG Allocation etc.): navy #1F4E79,
    // not the old brighter #2d7fc7, so the OCV report's header/section bands look consistent.
    private const string HeaderBlue = "#1F4E79";

    // Real .xlsx (user 2026-11-13: the HTML saved as ".xls" made Excel warn "format and extension don't match").
    // SAME layout and look as before: merged title lines, navy header rows, bordered centred cells, group rows,
    // "Download Here" / "Click Here to Show" links, "End Of Report" footer. The old HTML builder is BuildHtml below.
    public static byte[] Build(
        OcvWordReportData header,
        IEnumerable<OcvReportItemDto> items,
        int clubId,
        int yearId,
        string apiBase,
        string mediaBase,
        string frontendBase)
    {
        using var wb = new ClosedXML.Excel.XLWorkbook();
        var ws = wb.Worksheets.Add("OCV Report");
        ws.Style.Font.FontName = "Calibri";
        ws.Style.Font.FontSize = 10;
        var navy = ClosedXML.Excel.XLColor.FromHtml("#1F4E79");
        var line = ClosedXML.Excel.XLColor.FromHtml("#D0D0D0");
        var center = ClosedXML.Excel.XLAlignmentHorizontalValues.Center;
        int r = 1;

        void Title(string text, double size, bool bold, bool italic, string color)
        {
            var rg = ws.Range(r, 1, r, 5).Merge();
            rg.FirstCell().Value = text;
            rg.Style.Font.FontSize = size; rg.Style.Font.Bold = bold; rg.Style.Font.Italic = italic;
            rg.Style.Font.FontColor = ClosedXML.Excel.XLColor.FromHtml(color);
            r++;
        }
        void Th(int col, string text)
        {
            var c = ws.Cell(r, col);
            c.Value = text;
            c.Style.Fill.BackgroundColor = navy; c.Style.Font.FontColor = ClosedXML.Excel.XLColor.White; c.Style.Font.Bold = true;
            c.Style.Alignment.Horizontal = center;
            c.Style.Border.OutsideBorder = ClosedXML.Excel.XLBorderStyleValues.Thin; c.Style.Border.OutsideBorderColor = navy;
        }
        void Td(int col, string? text, ClosedXML.Excel.XLAlignmentHorizontalValues? align = null)
        {
            var c = ws.Cell(r, col);
            c.SetValue(text ?? "");
            c.Style.Alignment.Horizontal = align ?? center;
            c.Style.Border.OutsideBorder = ClosedXML.Excel.XLBorderStyleValues.Thin; c.Style.Border.OutsideBorderColor = line;
        }
        void LinkTd(int col, string? url, string text)
        {
            if (string.IsNullOrWhiteSpace(url)) { Td(col, "—"); return; }
            Td(col, text);
            try { ws.Cell(r, col).SetHyperlink(new ClosedXML.Excel.XLHyperlink(new Uri(url!))); } catch { }
            ws.Cell(r, col).Style.Font.FontColor = ClosedXML.Excel.XLColor.FromHtml("#0563C1");
            ws.Cell(r, col).Style.Font.Underline = ClosedXML.Excel.XLFontUnderlineValues.Single;
        }

        // ── Header block ──
        var generatedAt = DateTime.UtcNow.ToString("dd MMM yyyy, hh:mm tt", CultureInfo.InvariantCulture);
        Title("Governor's Official Visit Report — " + (header.ClubName ?? ""), 16, true, false, "#1F4E79");
        Title($"{Brand.ProductName} Admin Portal", 10, false, true, "#555555");
        Title($"Rotary Year: {header.YearLabel}", 10, false, true, "#555555");
        Title($"Generated: {generatedAt}  |  Club ID: {header.ClubRotaryId}  ·  District: {header.DistrictNumber}  ·  President: {header.PresidentName}  ·  Assistant Governor: {header.AssistantGovernorName}", 10, false, false, "#666666");
        r++;

        // ── Club Goals at a glance ──
        if (header.GoalScorecard is { } sc && (sc.Rows.Count > 0 || sc.Checklist.Count > 0))
        {
            Title("Club Goals at a glance", 12, true, false, "#1F4E79");
            string? AsOn(string prefix) => sc.AsOn.FirstOrDefault(a => a.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                ?.Substring(prefix.Length).Trim().Replace("as on ", "", StringComparison.OrdinalIgnoreCase);
            void Group(string label, string? note, string color)
            {
                var rg = ws.Range(r, 1, r, 4).Merge();
                rg.Style.Fill.BackgroundColor = ClosedXML.Excel.XLColor.FromHtml("#F1F5F9");
                rg.Style.Border.OutsideBorder = ClosedXML.Excel.XLBorderStyleValues.Thin; rg.Style.Border.OutsideBorderColor = line;
                var rt = ws.Cell(r, 1).GetRichText();
                rt.AddText(label).SetBold().SetFontColor(navy);
                if (note != null) rt.AddText("   " + note).SetBold().SetFontColor(ClosedXML.Excel.XLColor.FromHtml(color));
                r++;
            }
            void GoalRow(string goal, string target, string achieved, string pct)
            {
                Td(1, goal, ClosedXML.Excel.XLAlignmentHorizontalValues.Left);
                Td(2, target, ClosedXML.Excel.XLAlignmentHorizontalValues.Right);
                Td(3, achieved, ClosedXML.Excel.XLAlignmentHorizontalValues.Right);
                Td(4, pct, ClosedXML.Excel.XLAlignmentHorizontalValues.Right);
                r++;
            }
            Th(1, "Goal"); Th(2, "Target"); Th(3, "Achieved"); Th(4, "% Achieved"); r++;
            var mem = sc.Rows.Where(x => !x.Money && (x.Goal == "Members" || x.Goal == "Women members")).ToList();
            var fnd = sc.Rows.Where(x => x.Money).ToList();
            var rot = sc.Rows.Except(mem).Except(fnd).ToList();
            // Figures go in as real numbers (no "number stored as text" green triangles); same look via number formats.
            void Num(int col, decimal? v, string fmt)
            {
                if (v is null or 0) return;   // "—" already written
                var c = ws.Cell(r, col);
                c.SetValue(fmt.EndsWith("%") ? v.Value / 100m : v.Value);
                // "0.##" would print "130." in Excel - whole numbers get no decimals, others 2.
                c.Style.NumberFormat.Format = v.Value == decimal.Truncate(v.Value) ? fmt.Replace(".##", "") : fmt.Replace(".##", ".00");
            }
            void Rows(IEnumerable<ClubGoalScorecardRow> rs)
            {
                foreach (var x in rs)
                {
                    GoalRow(x.Goal, GoalSettingService.ScorecardCell(x.Target, x.Money),
                        GoalSettingService.ScorecardCell(x.Achieved, x.Money), GoalSettingService.ScorecardCell(x.Pct, pct: true));
                    r--;
                    var nf = x.Money ? "$#,##0.##" : "#,##0.##";
                    Num(2, x.Target, nf); Num(3, x.Achieved, nf); Num(4, x.Pct, "0.##%");
                    r++;
                }
            }
            if (mem.Count > 0) { var d = AsOn("Rotary.org"); Group("MEMBERSHIP", d != null ? $"Updated from Rotary.org on {d}" : "Updated from Rotary.org", "#047857"); Rows(mem); }
            // Foundation (user 2026-11-13): Annual Fund + PolioPlus come from Rotary.org; Endowment / Other / Total from the RISAO import.
            var fndRo = fnd.Where(x => x.Goal is "Annual Fund" or "PolioPlus Fund").ToList();
            var fndImp = fnd.Except(fndRo).ToList();
            if (fndRo.Count > 0) { var d = AsOn("Rotary.org"); Group("FOUNDATION · FROM ROTARY.ORG", d != null ? $"Updated from Rotary.org on {d}" : "Updated from Rotary.org", "#047857"); Rows(fndRo); }
            if (fndImp.Count > 0) { var d = AsOn("Foundation"); Group("FOUNDATION · FROM IMPORT (RISAO)", d != null ? $"Updated from RISAO on {d}" : null, "#1D4ED8"); Rows(fndImp); }
            if (rot.Count > 0 || sc.Checklist.Count > 0)
            {
                var d = AsOn("Rotary.org");
                Group("ROTARY.ORG GOALS", d != null ? $"Updated from Rotary.org on {d}" : "Updated from Rotary.org", "#047857");
                Rows(rot);
                foreach (var (label, yes) in sc.Checklist) GoalRow(label, "—", yes == null ? "—" : yes.Value ? "Yes" : "No", "—");
            }
            r++;
        }

        // ── Documents ──
        var itemList = items.ToList();
        Title($"Documents - {itemList.Count(i => i.IsUploaded)} of {itemList.Count} uploaded", 12, true, false, "#1F4E79");
        Th(1, "Sr.No."); Th(2, "Particulars"); Th(3, "Document Type"); Th(4, "Status"); Th(5, "Download Document"); r++;
        int sr = 0;
        foreach (var it in itemList)
        {
            sr++;
            Td(1, sr.ToString()); Td(2, it.CategoryName); Td(3, it.TypeName); Td(4, it.IsUploaded ? "Uploaded" : "Pending");
            // Straight to the media URL (no login needed) - the API download endpoint needs a login (see BuildHtml).
            LinkTd(5, it.IsUploaded ? AbsUrl(mediaBase, it.FilePath) : null, "Download Here");
            r++;
        }

        // ── Live Documents ──
        r++;
        Th(1, "Live Documents"); Th(2, "Particulars"); Th(3, "Download Document"); r++;
        var liveBase = string.IsNullOrWhiteSpace(frontendBase) ? "" : frontendBase.TrimEnd('/');
        var liveUrl = string.IsNullOrWhiteSpace(liveBase) ? "" : $"{liveBase}/clubs/{clubId}/ocv-gov/v2/live-documents?yearId={yearId}";
        int lr = 0;
        foreach (var t in header.LiveTables)
        {
            lr++;
            bool pub = !string.IsNullOrWhiteSpace(liveBase) && !string.IsNullOrWhiteSpace(t.ModuleKey);
            var url = pub ? $"{liveBase}/ocv-live-documents/{clubId}/{t.ModuleKey}?yearId={yearId}" : liveUrl;
            Td(1, lr.ToString()); Td(2, t.Label); LinkTd(3, url, pub ? "Click Here to Show" : "Download Here");
            r++;
        }

        // ── Newsletters ──
        r++;
        Th(1, "Newsletters"); Th(2, "Particulars"); Th(3, "Download Document"); r++;
        var newslettersPageUrl = string.IsNullOrWhiteSpace(liveBase) ? "" : $"{liveBase}/ocv-live-documents/{clubId}/newsletters?yearId={yearId}";
        int nr = 0;
        foreach (var nl in header.Newsletters)
        {
            nr++;
            string url, linkText;
            if (!string.IsNullOrWhiteSpace(newslettersPageUrl)) { url = newslettersPageUrl; linkText = "Click Here to Show"; }
            else
            {
                var target = !string.IsNullOrWhiteSpace(nl.FilePath) ? nl.FilePath : !string.IsNullOrWhiteSpace(nl.LinkUrl) ? nl.LinkUrl : null;
                url = AbsUrl(mediaBase, target) ?? ""; linkText = "Download Here";
            }
            Td(1, nr.ToString()); Td(2, nl.Title ?? "(untitled)"); LinkTd(3, url, linkText);
            r++;
        }

        // ── Footer ──
        var foot = ws.Range(r, 1, r, 5).Merge();
        foot.FirstCell().Value = "End Of Report";
        foot.Style.Font.Italic = true; foot.Style.Font.FontColor = navy;
        foot.Style.Alignment.Horizontal = center;

        ws.Column(1).Width = 24; ws.Column(2).Width = 30; ws.Column(3).Width = 42; ws.Column(4).Width = 16; ws.Column(5).Width = 24;
        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }

    // The previous HTML-table workbook (kept, NOT used - Excel warned "format and extension don't match").
    public static byte[] BuildHtml(
        OcvWordReportData header,
        IEnumerable<OcvReportItemDto> items,
        int clubId,
        int yearId,
        string apiBase,
        string mediaBase,
        string frontendBase)
    {
        var sb = new StringBuilder();
        sb.Append("<!DOCTYPE HTML PUBLIC \"-//W3C//DTD HTML 4.0 Transitional//EN\">");
        // UTF-8 declared (meta + BOM below), else Excel reads it as Windows-1252 and "—" shows "â€”" (user 2026-11-12).
        sb.Append("<meta http-equiv='Content-Type' content='text/html; charset=utf-8'>");
        sb.Append("<font style='font-size:10.0pt; font-family:Calibri;'>");
        sb.Append("<table border='0' cellspacing='0' style='width:100%; border-collapse:collapse;'>");

        // ── Header block — matches the standard reports (exportToCSV etc.):
        // a navy TITLE (text only, no fill) + grey italic subtitle lines, then the bordered
        // data table with a navy header row. No coloured label/value blocks.
        var generatedAt = DateTime.UtcNow.ToString("dd MMM yyyy, hh:mm tt", CultureInfo.InvariantCulture);
        sb.Append($"<tr><td colspan='5' style='color:#1F4E79;font-weight:bold;font-size:16pt;'>{Enc("Governor's Official Visit Report — " + (header.ClubName ?? ""))}</td></tr>");
        sb.Append("<tr><td colspan='5' style='color:#555555;font-style:italic;'>ROW Admin Portal</td></tr>");
        sb.Append($"<tr><td colspan='5' style='color:#555555;font-style:italic;'>Rotary Year: {Enc(header.YearLabel)}</td></tr>");
        sb.Append($"<tr><td colspan='5' style='color:#666666;'>Generated: {generatedAt}  |  Club ID: {Enc(header.ClubRotaryId)}  &#183;  District: {Enc(header.DistrictNumber)}  &#183;  President: {Enc(header.PresidentName)}  &#183;  Assistant Governor: {Enc(header.AssistantGovernorName)}</td></tr>");
        sb.Append("<tr><td colspan='5'>&nbsp;</td></tr>");

        // ── Club Goals at a glance (user 2026-11-12) - same rows as the OCV tab's scorecard ──
        if (header.GoalScorecard is { } sc && (sc.Rows.Count > 0 || sc.Checklist.Count > 0))
        {
            sb.Append($"<tr><td colspan='5' style='color:#1F4E79;font-weight:bold;font-size:12pt;'>Club Goals at a glance</td></tr>");
            // One group per source with its own date (user 2026-11-13) - same as the Word report.
            string? AsOn(string prefix) => sc.AsOn.FirstOrDefault(a => a.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                ?.Substring(prefix.Length).Trim().Replace("as on ", "", StringComparison.OrdinalIgnoreCase);
            void Group(string label, string? note, string color) => sb.Append(
                $"<tr><td colspan='4' style='background-color:#F1F5F9;border:1px solid #D0D0D0;padding:2px;'><b style='color:#1F4E79;'>{Enc(label)}</b>"
                + (note != null ? $"&nbsp;&nbsp;&nbsp;<b style='color:{color};'>{Enc(note)}</b>" : "") + "</td></tr>");
            void GoalRow(string goal, string target, string achieved, string pct) =>
                sb.Append("<tr>").Append(TdL(goal)).Append(TdR(target)).Append(TdR(achieved)).Append(TdR(pct)).Append("</tr>");
            sb.Append("<tr>").Append(Th("Goal", "30%")).Append(Th("Target", "20%")).Append(Th("Achieved", "20%")).Append(Th("% Achieved", "15%")).Append("</tr>");
            var mem = sc.Rows.Where(r => !r.Money && (r.Goal == "Members" || r.Goal == "Women members")).ToList();
            var fnd = sc.Rows.Where(r => r.Money).ToList();
            var rot = sc.Rows.Except(mem).Except(fnd).ToList();
            void Rows(IEnumerable<ClubGoalScorecardRow> rs)
            {
                foreach (var r in rs) GoalRow(r.Goal, GoalSettingService.ScorecardCell(r.Target, r.Money),
                    GoalSettingService.ScorecardCell(r.Achieved, r.Money), GoalSettingService.ScorecardCell(r.Pct, pct: true));
            }
            if (mem.Count > 0) { var d = AsOn("Rotary.org"); Group("MEMBERSHIP", d != null ? $"Updated from Rotary.org on {d}" : "Updated from Rotary.org", "#047857"); Rows(mem); }
            if (fnd.Count > 0) { var d = AsOn("Foundation"); Group("FOUNDATION", d != null ? $"From import (RISAO) · Updated from RISAO on {d}" : "From import (RISAO)", "#1D4ED8"); Rows(fnd); }
            if (rot.Count > 0 || sc.Checklist.Count > 0)
            {
                var d = AsOn("Rotary.org");
                Group("ROTARY.ORG GOALS", d != null ? $"Updated from Rotary.org on {d}" : "Updated from Rotary.org", "#047857");
                Rows(rot);
                foreach (var (label, yes) in sc.Checklist) GoalRow(label, "—", yes == null ? "—" : yes.Value ? "Yes" : "No", "—");
            }
            sb.Append("<tr><td colspan='5'>&nbsp;</td></tr>");
        }

        // ── Main documents table — column headers (navy band, white bold, bordered) ──
        // "Module Name" is "Particulars" (user 2026-11-13); a one-line count first.
        var itemList = items.ToList();
        sb.Append($"<tr><td colspan='5' style='color:#1F4E79;font-weight:bold;font-size:12pt;'>Documents - {itemList.Count(i => i.IsUploaded)} of {itemList.Count} uploaded</td></tr>");
        sb.Append("<tr>")
          .Append(Th("Sr.No.", "2%"))
          .Append(Th("Particulars", "20%"))
          .Append(Th("Document Type", "20%"))
          .Append(Th("Status", "10%"))
          .Append(Th("Download Document", "48%"))
          .Append("</tr>");

        int sr = 0;
        foreach (var it in itemList)
        {
            sr++;
            var uploaded = it.IsUploaded ? "Uploaded" : "Pending";
            string link;
            // Link straight to the document's media URL (mediaBase + FilePath), NOT the API
            // documents/{id}/download endpoint. That endpoint is [Authorize]-protected, so a raw
            // hyperlink click from Excel/a browser (which carries no bearer token) got a 401 →
            // Excel's "Cannot download the information you requested". The media file is served
            // statically (no auth) — the same source the Word report and the newsletters row below
            // already link to.
            var docUrl = AbsUrl(mediaBase, it.FilePath);
            if (it.IsUploaded && !string.IsNullOrWhiteSpace(docUrl))
            {
                link = $"<a href='{Enc(docUrl!)}' target='_blank'>Download Here </a>";
            }
            else
            {
                link = "—";
            }
            sb.Append("<tr>")
              .Append(Td(sr.ToString()))
              .Append(Td(it.CategoryName))
              .Append(Td(it.TypeName))
              .Append(Td(uploaded))
              .Append($"<td style='text-align:center;border:1px solid #D0D0D0;padding:2px;'>{link}</td>")
              .Append("</tr>");
        }

        // ── Live Documents section ──
        sb.Append("<tr></tr>");
        sb.Append("<tr>")
          .Append(Th("Live Documents", "2%"))
          .Append(Th("Particulars", "20%"))
          .Append(Th("Download Document", "48%"))
          .Append("</tr>");

        var liveBase = string.IsNullOrWhiteSpace(frontendBase) ? "" : frontendBase.TrimEnd('/');
        var liveUrl = string.IsNullOrWhiteSpace(liveBase)
            ? ""
            : $"{liveBase}/clubs/{clubId}/ocv-gov/v2/live-documents?yearId={yearId}";
        int lr = 0;
        foreach (var t in header.LiveTables)
        {
            lr++;
            // Every live module now links to its PUBLIC (no-login) page — projects render with photos,
            // the other modules render as the module's live table — with a "Click Here to Show" link.
            // Falls back to the in-app deep link only if the public base URL is unavailable.
            string url;
            string linkText;
            if (!string.IsNullOrWhiteSpace(liveBase) && !string.IsNullOrWhiteSpace(t.ModuleKey))
            {
                url = $"{liveBase}/ocv-live-documents/{clubId}/{t.ModuleKey}?yearId={yearId}";
                linkText = "Click Here to Show";
            }
            else
            {
                url = liveUrl;
                linkText = "Download Here";
            }

            var link = string.IsNullOrWhiteSpace(url)
                ? "—"
                : $"<a href='{Enc(url)}' target='_blank'>{linkText} </a>";
            sb.Append("<tr>")
              .Append(Td(lr.ToString()))
              .Append(Td(t.Label))
              .Append($"<td style='text-align:center;border:1px solid #D0D0D0;padding:2px;'>{link}</td>")
              .Append("</tr>");
        }

        // ── Newsletters section ──
        sb.Append("<tr></tr>");
        sb.Append("<tr>")
          .Append(Th("Newsletters", "2%"))
          .Append(Th("Particulars", "20%"))
          .Append(Th("Download Document", "48%"))
          .Append("</tr>");

        // One public "Newsletters" page lists every newsletter (meta + open link) — each row points
        // there with "Click Here to Show". If the public base is unavailable, fall back to the
        // newsletter's own attachment/link with "Download Here".
        var newslettersPageUrl = string.IsNullOrWhiteSpace(liveBase)
            ? ""
            : $"{liveBase}/ocv-live-documents/{clubId}/newsletters?yearId={yearId}";
        int nr = 0;
        foreach (var nl in header.Newsletters)
        {
            nr++;
            string url, linkText;
            if (!string.IsNullOrWhiteSpace(newslettersPageUrl))
            {
                url = newslettersPageUrl;
                linkText = "Click Here to Show";
            }
            else
            {
                var target = !string.IsNullOrWhiteSpace(nl.FilePath) ? nl.FilePath
                           : !string.IsNullOrWhiteSpace(nl.LinkUrl) ? nl.LinkUrl : null;
                url = AbsUrl(mediaBase, target) ?? "";
                linkText = "Download Here";
            }
            var link = string.IsNullOrWhiteSpace(url)
                ? "—"
                : $"<a href='{Enc(url)}' target='_blank'>{linkText} </a>";
            sb.Append("<tr>")
              .Append(Td(nr.ToString()))
              .Append(Td(nl.Title ?? "(untitled)"))
              .Append($"<td style='text-align:center;border:1px solid #D0D0D0;padding:2px;'>{link}</td>")
              .Append("</tr>");
        }

        // ── Footer ──
        sb.Append($"<tr><td style='text-align: center;color:{HeaderBlue};' colspan='5'><i>End Of Report</i></td></tr>");
        sb.Append("</table></font>");

        var utf8 = new UTF8Encoding(true);
        return utf8.GetPreamble().Concat(utf8.GetBytes(sb.ToString())).ToArray();
    }

    // Navy column-header / section-header cell (white bold on #1F4E79, bordered) — matches the
    // standard reports' header row.
    private static string Th(string text, string width) =>
        $"<th style='width:{width};background-color:#1F4E79;color:White;border:1px solid #1F4E79;padding:2px;'>{Enc(text)}</th>";

    private static string TdL(string? text) =>
        $"<td style='text-align:left;border:1px solid #D0D0D0;padding:2px;'>{Enc(text ?? "")}</td>";
    private static string TdR(string? text) =>
        $"<td style='text-align:right;border:1px solid #D0D0D0;padding:2px;'>{Enc(text ?? "")}</td>";

    private static string Td(string? text) =>
        $"<td style='text-align:center;border:1px solid #D0D0D0;padding:2px;'>{Enc(text ?? "")}</td>";

    private static string Enc(string s) => WebUtility.HtmlEncode(s ?? "");

    private static string? AbsUrl(string mediaBase, string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return null;
        if (path.StartsWith("http", StringComparison.OrdinalIgnoreCase)) return path;
        var b = (mediaBase ?? "").TrimEnd('/');
        if (string.IsNullOrEmpty(b)) return path;
        return path.StartsWith("/") ? b + path : b + "/" + path;
    }
}
