using System.Globalization;
using System.Net;
using System.Text;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

// Builds the OCV / Governor's Official Visit Excel report as an HTML-table workbook
// (Content-Type application/vnd.ms-excel) — a byte-for-byte structural match of the legacy
// example.org "OCVList….xls" export the user asked us to replicate:
//   • A blue header block: title + Report Generated at / Club Name / Club ID / District Number /
//     President / Assistant Governor / Rotary Year.
//   • Main documents table: Sr.No. | Module Name | Document Type | Uploaded (Yes/No) |
//     Download Document — one row per document-type across ALL categories, in category order.
//     "Download Here" hyperlinks the API's documents/{id}/download URL for uploaded docs; blank otherwise.
//   • Live Documents section: Sr | Module Name | Download hyperlink (the module snapshots the
//     Word report renders, deep-linked to the frontend Live Documents page).
//   • Newsletters section: Sr | Module Name | Download hyperlink (the attachment / external link).
//   • "End Of Report" footer.
public static class OcvReportExcelBuilder
{
    // Match the standard report background (exportToCSV / AG Allocation etc.): navy #1F4E79,
    // not the old brighter #2d7fc7, so the OCV report's header/section bands look consistent.
    private const string HeaderBlue = "#1F4E79";

    public static byte[] Build(
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
        sb.Append("<font style='font-size:10.0pt; font-family:Calibri;'>");
        sb.Append("<table border='0' cellspacing='0' style='width:100%; border-collapse:collapse;'>");

        // ── Header block — matches the standard reports (exportToCSV / PPH_Camp etc.):
        // a navy TITLE (text only, no fill) + grey italic subtitle lines, then the bordered
        // data table with a navy header row. No coloured label/value blocks.
        var generatedAt = DateTime.Now.ToString("dd MMM yyyy, hh:mm tt", CultureInfo.InvariantCulture);
        sb.Append($"<tr><td colspan='5' style='color:#1F4E79;font-weight:bold;font-size:16pt;'>{Enc("Governor's Official Visit Report — " + (header.ClubName ?? ""))}</td></tr>");
        sb.Append("<tr><td colspan='5' style='color:#555555;font-style:italic;'>ROW Admin Portal</td></tr>");
        sb.Append($"<tr><td colspan='5' style='color:#555555;font-style:italic;'>Rotary Year: {Enc(header.YearLabel)}</td></tr>");
        sb.Append($"<tr><td colspan='5' style='color:#666666;'>Generated: {generatedAt}  |  Club ID: {Enc(header.ClubRotaryId)}  &#183;  District: {Enc(header.DistrictNumber)}  &#183;  President: {Enc(header.PresidentName)}  &#183;  Assistant Governor: {Enc(header.AssistantGovernorName)}</td></tr>");
        sb.Append("<tr><td colspan='5'>&nbsp;</td></tr>");

        // ── Main documents table — column headers (navy band, white bold, bordered) ──
        sb.Append("<tr>")
          .Append(Th("Sr.No.", "2%"))
          .Append(Th("Module Name", "20%"))
          .Append(Th("Document Type", "20%"))
          .Append(Th("Uploaded", "10%"))
          .Append(Th("Download Document", "48%"))
          .Append("</tr>");

        int sr = 0;
        foreach (var it in items)
        {
            sr++;
            var uploaded = it.IsUploaded ? "Yes" : "No";
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
                link = "<a href='' target='_blank'> </a>";
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
          .Append(Th("Module Name", "20%"))
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
                ? "<a href='' target='_blank'> </a>"
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
          .Append(Th("Module Name", "20%"))
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
                ? "<a href='' target='_blank'> </a>"
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

        return new UTF8Encoding(false).GetBytes(sb.ToString());
    }

    // Navy column-header / section-header cell (white bold on #1F4E79, bordered) — matches the
    // standard reports' header row.
    private static string Th(string text, string width) =>
        $"<th style='width:{width};background-color:#1F4E79;color:White;border:1px solid #1F4E79;padding:2px;'>{Enc(text)}</th>";

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
