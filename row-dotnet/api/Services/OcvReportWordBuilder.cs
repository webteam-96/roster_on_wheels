using System.Globalization;
using RotaryApi.DTOs;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using A = DocumentFormat.OpenXml.Drawing;
using DW = DocumentFormat.OpenXml.Drawing.Wordprocessing;
using PIC = DocumentFormat.OpenXml.Drawing.Pictures;

namespace RotaryApi.Services;

// One uploaded OCV document. ImageBytes is filled by the controller (disk-first, then the
// configured media host) only for image extensions; non-images become hyperlinks instead.
public sealed class OcvWordDocument
{
    public string CategoryCode { get; set; } = "";
    public string CategoryName { get; set; } = "";
    public string TypeName { get; set; } = "";
    public string? CustomTypeName { get; set; }
    public string? OriginalFileName { get; set; }
    public string? FilePath { get; set; }
    public decimal? Amount { get; set; }
    public DateTime? PaidOn { get; set; }
    public DateTime? CreatedDate { get; set; }
    public string? Extension { get; set; }
    public byte[]? ImageBytes { get; set; }
    // PDF file bytes (filled by the controller for .pdf documents) — rasterised to inline page images.
    public byte[]? PdfBytes { get; set; }
    // For Office files (.doc/.docx/.xls/.xlsx): a PDF rendition produced by LibreOffice headless
    // (null when LibreOffice isn't installed), whose FIRST page is embedded as a snapshot image.
    public byte[]? OfficeSnapshotPdfBytes { get; set; }

    public bool IsImage => Extension is "jpg" or "jpeg" or "png" or "gif";
    public bool IsPdf => Extension is "pdf";
    public bool IsOfficeDoc => Extension is "doc" or "docx" or "xls" or "xlsx";
}

public sealed record OcvWordCategory(string Code, string Name);

// A "Live Documents" module rendered as a native Word table — the module's rows are re-queried
// at report time (nothing is stored), so the doc carries a snapshot of the live data.
public sealed class OcvWordModuleTable
{
    public string Label { get; set; } = "";
    // module_master.ModuleKey (e.g. "announcements") — lets the public page / Excel link resolve a
    // table module without matching on the display label.
    public string ModuleKey { get; set; } = "";
    public List<string> Headers { get; } = new();
    public List<string[]> Rows { get; } = new();
}

public sealed class OcvWordNewsletter
{
    public string? Title { get; set; }
    public DateTime? PublishDate { get; set; }
    public string? AttachmentType { get; set; }
    public string? FilePath { get; set; }
    public string? LinkUrl { get; set; }
    public string? Status { get; set; }
}

// One image belonging to a project in the "Live Documents" detailed section. ImagePath is the
// reconstructed web path; ImageBytes is filled by the controller (disk-first, then the media host).
public sealed class OcvWordProjectImage
{
    public string? ImagePath { get; set; }
    public string? Extension { get; set; }
    public byte[]? ImageBytes { get; set; }
    public string? Caption { get; set; }
}

// One project rendered in full in the detailed "Live Documents" section: Title, Description, then
// every remaining form field (pre-formatted label/value pairs), then up to 5 embedded images.
public sealed class OcvWordProject
{
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    public List<(string Label, string Value)> Fields { get; } = new();
    public List<OcvWordProjectImage> Images { get; } = new();
}

// A project-avenue module (Community/Vocational/International/New Generation/Public Image/Club
// Service) with every project of the report's year rendered in full (fields + images).
public sealed class OcvWordProjectModule
{
    public string ModuleKey { get; set; } = "";
    public string Label { get; set; } = "";
    public List<OcvWordProject> Projects { get; } = new();
}

public sealed class OcvWordReportData
{
    public string ClubName { get; set; } = "";
    public string YearLabel { get; set; } = "";
    // Identifying header fields (populated by GetOcvWordReportDataAsync). Blank when unavailable.
    public string ClubRotaryId { get; set; } = "";
    public string DistrictNumber { get; set; } = "";
    public string ZoneName { get; set; } = "";
    public string PresidentName { get; set; } = "";
    public string AssistantGovernorName { get; set; } = "";
    public List<OcvWordCategory> Categories { get; } = new();
    public List<OcvWordDocument> Documents { get; } = new();
    public List<OcvWordModuleTable> LiveTables { get; } = new();
    public List<OcvWordNewsletter> Newsletters { get; } = new();
    // Full per-project detail (fields + images) for the six project avenues, rendered in the
    // detailed "Live Documents" section. Populated by GetOcvWordReportDataAsync.
    public List<OcvWordProjectModule> ProjectModules { get; } = new();
}

// Builds the OCV / GOV compliance report Word (.docx):
//   • Uploaded documents  — grouped by category; images embedded inline, everything else
//                           (pdf/doc/docx/xls/xlsx) rendered as a clickable download link.
//   • Live Documents      — each module's current rows re-rendered as a native Word table.
//   • Newsletters         — listed with clickable links.
// `mediaBase` is the absolute base URL used to build the document hyperlinks.
public static class OcvReportWordBuilder
{
    private const string BrandBlueHex = "003DA5";
    private const string LabelHex = "44546A";
    private const string MutedHex = "7A7A7A";
    private const string LinkHex = "0563C1";
    private const string DividerHex = "B9C7DE";
    private const long MaxPhotoWidthEmu = 4_100_000;   // ~4.48"
    private const long MaxPhotoHeightEmu = 3_400_000;  // ~3.72"
    // Full-page document scans (PDF page renders, Office snapshots) should FILL the page, not sit
    // tiny like a photo. Printable A4 area with the 0.75" margins below is ~6.77" × ~10.19"; these
    // fill the width and most of the height while leaving room for the caption + download line.
    private const long MaxPageImageWidthEmu = 6_000_000;   // ~6.56"
    private const long MaxPageImageHeightEmu = 8_800_000;  // ~9.62"

    // Live Documents and Newsletters are cards on the OCV grid but not upload categories —
    // they get their own sections instead of a document listing.
    private static readonly string[] NonUploadCategoryCodes = { "live_documents", "newsletters" };

    // Labels of the six project avenues — used to keep them OUT of the non-project module
    // tables (they are rendered in full, with images, in their own detailed sections instead).
    private static readonly string[] ProjectModuleLabels =
    {
        "Community Service Projects", "Vocational Service", "International Service",
        "New Generation Service", "Public Image Initiative", "Club Service",
    };

    public static byte[] BuildReport(OcvWordReportData data, IEnumerable<OcvReportItemDto> reportItems, string mediaBase)
    {
        var items = (reportItems ?? Enumerable.Empty<OcvReportItemDto>()).ToList();

        // Strip NUL/control chars OpenXML can't serialise from EVERY text field (imported document/module
        // text) — otherwise SaveAs throws "hexadecimal value 0x00, is an invalid character" → 500.
        WordXmlHelper.SanitizeStrings(data);
        foreach (var c in data.Categories) WordXmlHelper.SanitizeStrings(c);
        foreach (var d in data.Documents) WordXmlHelper.SanitizeStrings(d);
        foreach (var n in data.Newsletters) WordXmlHelper.SanitizeStrings(n);
        foreach (var t in data.LiveTables)
        {
            for (int i = 0; i < t.Headers.Count; i++) t.Headers[i] = WordXmlHelper.Clean(t.Headers[i]);
            foreach (var row in t.Rows) for (int j = 0; j < row.Length; j++) row[j] = WordXmlHelper.Clean(row[j]);
        }
        foreach (var pm in data.ProjectModules)
        {
            WordXmlHelper.SanitizeStrings(pm);
            foreach (var pr in pm.Projects)
            {
                WordXmlHelper.SanitizeStrings(pr);
                for (int k = 0; k < pr.Fields.Count; k++)
                    pr.Fields[k] = (WordXmlHelper.Clean(pr.Fields[k].Label), WordXmlHelper.Clean(pr.Fields[k].Value));
            }
        }
        foreach (var it in items) WordXmlHelper.SanitizeStrings(it);

        using var ms = new MemoryStream();
        using (var doc = WordprocessingDocument.Create(ms, WordprocessingDocumentType.Document))
        {
            var main = doc.AddMainDocumentPart();
            ApplySerifDefaults(main);

            var body = new Body();
            uint imgId = 1;

            body.Append(Centered($"Rotary Club of {data.ClubName}", 34, bold: true));
            body.Append(Centered("Governor's Official Visit (OCV) Report", 28, bold: true, colorHex: BrandBlueHex));
            body.Append(Centered($"Rotary Year {data.YearLabel}", 22, colorHex: MutedHex));
            Spacer(body);

            // ── Identifying header block ──
            var header = new List<string[]>();
            void HdrRow(string l1, string v1, string l2, string v2) => header.Add(new[] { l1, v1, l2, v2 });
            HdrRow("Zone", Dash(data.ZoneName), "District Number", Dash(data.DistrictNumber));
            HdrRow("Club Name", Dash(data.ClubName), "Club ID", Dash(data.ClubRotaryId));
            HdrRow("President", Dash(data.PresidentName), "Assistant Governor", Dash(data.AssistantGovernorName));
            HdrRow("Rotary Year", Dash(data.YearLabel), "Report Generated", DateTime.Now.ToString("dd MMM yyyy HH:mm", CultureInfo.InvariantCulture));
            FourColTable(body, header);
            Spacer(body);

            var categories = data.Categories
                .Where(c => !NonUploadCategoryCodes.Contains(c.Code))
                .ToList();

            FourColTable(body, new List<string[]>
            {
                new[] { "Documents Uploaded", data.Documents.Count.ToString(), "Document Categories", categories.Count.ToString() },
                new[] { "Live Document Modules", data.LiveTables.Count.ToString(), "Newsletters", data.Newsletters.Count.ToString() },
            });

            // ── Summary listing tables (the same tables the Excel report builds) ──
            // 1) Module / Document-Type checklist (every document type across all categories).
            SectionHeading(body, "Documents Summary");
            if (items.Count == 0) body.Append(MutedText("No document types configured."));
            else
            {
                var rows = new List<string[]>();
                int s = 1;
                foreach (var it in items)
                    rows.Add(new[] { (s++).ToString(), it.CategoryName ?? "", it.TypeName ?? "" });
                GridTable(body, new[] { "Sr.No.", "Module Name", "Document Type" }, rows);
            }

            // 2) Live Documents module listing.
            SectionHeading(body, "Live Documents");
            if (data.LiveTables.Count == 0) body.Append(MutedText("No live document modules."));
            else
            {
                var rows = new List<string[]>();
                int s = 1;
                foreach (var t in data.LiveTables)
                    rows.Add(new[] { (s++).ToString(), t.Label });
                GridTable(body, new[] { "Sr.No.", "Module Name" }, rows);
            }

            // 3) Newsletters module listing.
            SectionHeading(body, "Newsletters");
            if (data.Newsletters.Count == 0) body.Append(MutedText("No newsletters published for this year."));
            else
            {
                var rows = new List<string[]>();
                int s = 1;
                foreach (var nl in data.Newsletters)
                    rows.Add(new[] { (s++).ToString(), string.IsNullOrWhiteSpace(nl.Title) ? "(untitled)" : nl.Title! });
                GridTable(body, new[] { "Sr.No.", "Module Name" }, rows);
            }

            // ── Uploaded documents (flat — no per-category headers, filenames or upload dates) ──
            SectionHeading(body, "Uploaded Documents");
            if (data.Documents.Count == 0) body.Append(MutedText("No documents uploaded."));
            else
            {
                int n = 1;
                foreach (var d in data.Documents)
                {
                    // One malformed document (bad image bytes, unreachable file, etc.) must not
                    // sink the whole report — note it and keep going.
                    try { AppendDocument(main, body, mediaBase, d, n, ref imgId); }
                    catch { body.Append(MutedText($"{n}.  Could not be included in this report.")); }
                    n++;
                }
            }

            // ── Detailed Live Documents content, one section per module ──
            SectionHeading(body, "Live Documents — Detailed");
            body.Append(MutedText($"Current data as on {DateTime.Now:dd MMM yyyy}. These modules are not uploaded files — the content below is read live from the club's records."));

            // Project avenues first — every project of the year rendered in full (fields + images).
            foreach (var pm in data.ProjectModules)
            {
                SubHeading(body, $"{pm.Label} ({pm.Projects.Count})");
                if (pm.Projects.Count == 0) { body.Append(MutedText("No projects for this year.")); continue; }
                int pn = 1;
                foreach (var pr in pm.Projects)
                {
                    try { AppendProject(main, body, pr, pn, ref imgId); }
                    catch { body.Append(MutedText($"{pn}.  This project could not be rendered.")); }
                    pn++;
                }
            }

            // Remaining modules (Announcements … TRF Contributions) as their listing tables. The six
            // project avenues are excluded here — they are the detailed sections above.
            foreach (var t in data.LiveTables.Where(t => !ProjectModuleLabels.Contains(t.Label)))
            {
                SubHeading(body, $"{t.Label} ({t.Rows.Count})");
                try
                {
                    if (t.Rows.Count == 0) body.Append(MutedText("No records."));
                    else GridTable(body, t.Headers, t.Rows);
                }
                catch { body.Append(MutedText("This section could not be rendered.")); }
            }

            // Newsletters — all content, last.
            SubHeading(body, $"Newsletters ({data.Newsletters.Count})");
            if (data.Newsletters.Count == 0) body.Append(MutedText("No newsletters published for this year."));
            int idx = 1;
            foreach (var nl in data.Newsletters)
            {
                try { AppendNewsletter(main, body, mediaBase, nl, idx); }
                catch { body.Append(MutedText($"{idx}.  Could not be included in this report.")); }
                idx++;
            }

            body.Append(SectionProps());
            main.Document = new Document(body);
            main.Document.Save();
        }
        return ms.ToArray();
    }

    // Module-scoped Word: the OCV identity header, then ONE module rendered in full. Used by the
    // public Live-Documents page's "Download Word" button. Handles all three module kinds:
    //   • project avenue  → every project's Title, Description, fields + up to 5 images
    //   • table module    → the module's live table (headers + rows)
    //   • newsletters     → the newsletter list (title, meta, open link)
    // Image bytes are pre-loaded by the caller (project modules only).
    public static byte[] BuildModuleReport(OcvWordReportData data, string moduleKey, string mediaBase)
    {
        bool isNewsletters = string.Equals(moduleKey, "newsletters", StringComparison.OrdinalIgnoreCase);
        var projectModule = data.ProjectModules.FirstOrDefault(m =>
            string.Equals(m.ModuleKey, moduleKey, StringComparison.OrdinalIgnoreCase));
        var tableModule = data.LiveTables.FirstOrDefault(t =>
            string.Equals(t.ModuleKey, moduleKey, StringComparison.OrdinalIgnoreCase));
        var moduleLabel = projectModule?.Label ?? tableModule?.Label ?? (isNewsletters ? "Newsletters" : moduleKey);

        using var ms = new MemoryStream();
        using (var doc = WordprocessingDocument.Create(ms, WordprocessingDocumentType.Document))
        {
            var main = doc.AddMainDocumentPart();
            ApplySerifDefaults(main);

            var body = new Body();
            uint imgId = 1;

            body.Append(Centered($"Rotary Club of {data.ClubName}", 34, bold: true));
            body.Append(Centered("Governor's Official Visit (OCV) Report", 28, bold: true, colorHex: BrandBlueHex));
            body.Append(Centered(moduleLabel, 24, bold: true, colorHex: LabelHex));
            body.Append(Centered($"Rotary Year {data.YearLabel}", 22, colorHex: MutedHex));
            Spacer(body);

            // ── Identifying header block (same fields as the full report) ──
            var header = new List<string[]>();
            void HdrRow(string l1, string v1, string l2, string v2) => header.Add(new[] { l1, v1, l2, v2 });
            HdrRow("Zone", Dash(data.ZoneName), "District Number", Dash(data.DistrictNumber));
            HdrRow("Club Name", Dash(data.ClubName), "Club ID", Dash(data.ClubRotaryId));
            HdrRow("President", Dash(data.PresidentName), "Assistant Governor", Dash(data.AssistantGovernorName));
            HdrRow("Rotary Year", Dash(data.YearLabel), "Report Generated", DateTime.Now.ToString("dd MMM yyyy HH:mm", CultureInfo.InvariantCulture));
            FourColTable(body, header);
            Spacer(body);

            if (projectModule is not null)
            {
                SectionHeading(body, $"{moduleLabel} ({projectModule.Projects.Count})");
                if (projectModule.Projects.Count == 0)
                    body.Append(MutedText("No projects for this year."));
                else
                {
                    int pn = 1;
                    foreach (var pr in projectModule.Projects)
                    {
                        try { AppendProject(main, body, pr, pn, ref imgId); }
                        catch { body.Append(MutedText($"{pn}.  This project could not be rendered.")); }
                        pn++;
                    }
                }
            }
            else if (isNewsletters)
            {
                SectionHeading(body, $"Newsletters ({data.Newsletters.Count})");
                if (data.Newsletters.Count == 0) body.Append(MutedText("No newsletters published for this year."));
                int idx = 1;
                foreach (var nl in data.Newsletters)
                {
                    try { AppendNewsletter(main, body, mediaBase, nl, idx); }
                    catch { body.Append(MutedText($"{idx}.  Could not be included in this report.")); }
                    idx++;
                }
            }
            else if (tableModule is not null)
            {
                SectionHeading(body, $"{moduleLabel} ({tableModule.Rows.Count})");
                try
                {
                    if (tableModule.Rows.Count == 0) body.Append(MutedText("No records."));
                    else GridTable(body, tableModule.Headers, tableModule.Rows);
                }
                catch { body.Append(MutedText("This section could not be rendered.")); }
            }
            else
            {
                SectionHeading(body, moduleLabel);
                body.Append(MutedText("No data for this module."));
            }

            body.Append(SectionProps());
            main.Document = new Document(body);
            main.Document.Save();
        }
        return ms.ToArray();
    }

    // ── One project in the detailed Live Documents section: Title, Description, remaining
    //    fields as a two-column table, then up to 5 embedded images ──
    private static void AppendProject(MainDocumentPart main, Body body, OcvWordProject pr, int index, ref uint imgId)
    {
        ItemTitle(body, $"{index}.  {(string.IsNullOrWhiteSpace(pr.Title) ? "(untitled)" : pr.Title)}");

        // Description on its own row.
        body.Append(new Paragraph(
            new ParagraphProperties(new SpacingBetweenLines { Before = "20", After = "60" }),
            new Run(new RunProperties(new Bold(), new Color { Val = LabelHex }, new FontSize { Val = "20" }),
                T("Description: ")),
            new Run(new RunProperties(new FontSize { Val = "20" }),
                T(string.IsNullOrWhiteSpace(pr.Description) ? "—" : pr.Description!))));

        // All remaining form fields as a label/value table.
        if (pr.Fields.Count > 0)
            TwoColTable(body, pr.Fields);

        // The project's images (already capped to 5 by the loader).
        foreach (var img in pr.Images)
        {
            if (img.ImageBytes is not { Length: > 0 }) continue;
            var partType = ClubMonthlyReportWordBuilder.MapImageType(img.Extension);
            if (partType == null) continue;
            try { EmbedImageBytes(main, body, img.ImageBytes!, partType.Value, ref imgId); } catch { }
            if (!string.IsNullOrWhiteSpace(img.Caption)) body.Append(Caption(img.Caption!));
        }
    }

    // ── One uploaded document: heading, meta, then the image itself or a download link ──
    private static void AppendDocument(MainDocumentPart main, Body body, string mediaBase, OcvWordDocument d, int index, ref uint imgId)
    {
        var label = string.IsNullOrWhiteSpace(d.CustomTypeName) ? d.TypeName : $"{d.TypeName} — {d.CustomTypeName}";
        ItemTitle(body, $"{index}.  {(string.IsNullOrWhiteSpace(label) ? "(untitled)" : label)}");

        // File name and upload date are intentionally NOT shown per the restructured OCV report.
        var facts = new List<(string, string)>();
        if (d.Amount is > 0) facts.Add(("Amount", "₹ " + d.Amount!.Value.ToString("N2", CultureInfo.InvariantCulture)));
        if (d.PaidOn.HasValue) facts.Add(("Paid On", d.PaidOn.Value.ToString("dd MMM yyyy", CultureInfo.InvariantCulture)));
        InlineFacts(body, facts);

        if (string.IsNullOrWhiteSpace(d.FilePath))
        {
            body.Append(MutedText("File missing."));
            Spacer(body);
            return;
        }

        // Render the document as image(s):
        //   • images        → embedded inline as-is
        //   • PDFs          → every page rasterised inline (Docnet.Core/PDFium)
        //   • Office files  → first page of the LibreOffice PDF rendition, as a snapshot
        // then ALWAYS add a small download link line directly below the image(s).
        bool shown = false;
        if (d.IsImage && d.ImageBytes is { Length: > 0 })
            shown = AppendImage(main, body, d, ref imgId);
        else if (d.IsPdf && d.PdfBytes is { Length: > 0 })
            shown = AppendPdfRender(main, body, d.PdfBytes!, MaxPdfPages, ref imgId);
        else if (d.OfficeSnapshotPdfBytes is { Length: > 0 })
            shown = AppendPdfRender(main, body, d.OfficeSnapshotPdfBytes!, 1, ref imgId);

        if (!shown)
        {
            // No image could be produced — Office file with LibreOffice unavailable, or a PDF that
            // failed to rasterise. Show a clearly-labelled entry; the download link is added below.
            var ext = string.IsNullOrWhiteSpace(d.Extension) ? "file" : d.Extension!.ToUpperInvariant();
            var name = string.IsNullOrWhiteSpace(d.OriginalFileName) ? "attachment" : d.OriginalFileName!;
            body.Append(MutedText($"[{ext}] {name} — could not be rendered as an image inline; use the download link below."));
        }

        // Download link BELOW the image(s)/entry — points at the served document URL. This is a
        // link LINE only; the images themselves are not hyperlinks.
        DocLink(main, body, mediaBase, d.FilePath!, "Download document");
        Spacer(body);
    }

    // Rasterise a PDF and embed up to maxPages pages as inline pictures. Returns false when no page
    // could be rendered, so the caller falls back to the labelled entry. Never throws.
    private const int MaxPdfPages = 20;
    private static bool AppendPdfRender(MainDocumentPart main, Body body, byte[] pdfBytes, int maxPages, ref uint imgId)
    {
        List<byte[]> pages;
        int total;
        try { (pages, total) = PdfRasterizer.RenderToPngs(pdfBytes, maxPages); }
        catch { return false; }

        if (pages.Count == 0) return false;

        for (int i = 0; i < pages.Count; i++)
        {
            if (pages.Count > 1) body.Append(Caption($"Page {i + 1} of {total}"));
            // A single unembeddable page is skipped, not fatal. PDF/Office page scans fill the
            // page (larger cap) instead of sitting tiny like a photo.
            try { EmbedImageBytes(main, body, pages[i], ImagePartType.Png, ref imgId, MaxPageImageWidthEmu, MaxPageImageHeightEmu); } catch { }
        }

        if (maxPages > 1 && total > pages.Count)
            body.Append(MutedText($"(showing first {pages.Count} of {total} pages)"));

        return true;
    }

    private static Paragraph Caption(string text) => new(
        new ParagraphProperties(new Justification { Val = JustificationValues.Center }, new SpacingBetweenLines { Before = "60", After = "20" }),
        new Run(new RunProperties(new Bold(), new Color { Val = LabelHex }, new FontSize { Val = "17" }),
            T(text)));

    private static void AppendNewsletter(MainDocumentPart main, Body body, string mediaBase, OcvWordNewsletter nl, int index)
    {
        ItemTitle(body, $"{index}.  {(string.IsNullOrWhiteSpace(nl.Title) ? "(untitled)" : nl.Title)}");

        var facts = new List<(string, string)>();
        if (nl.PublishDate.HasValue) facts.Add(("Published", nl.PublishDate.Value.ToString("dd MMM yyyy", CultureInfo.InvariantCulture)));
        if (!string.IsNullOrWhiteSpace(nl.AttachmentType)) facts.Add(("Type", nl.AttachmentType!));
        if (!string.IsNullOrWhiteSpace(nl.Status)) facts.Add(("Status", nl.Status!));
        InlineFacts(body, facts);

        var target = !string.IsNullOrWhiteSpace(nl.FilePath) ? nl.FilePath : nl.LinkUrl;
        if (string.IsNullOrWhiteSpace(target)) body.Append(MutedText("No attachment."));
        else DocLink(main, body, mediaBase, target!, "Open newsletter");
    }

    // ── Clickable download link ──
    private static void DocLink(MainDocumentPart main, Body body, string mediaBase, string path, string label)
    {
        var para = new Paragraph(new ParagraphProperties(new SpacingBetweenLines { Before = "40", After = "60" }));
        var url = DocUrl(mediaBase, path);
        try
        {
            var relId = main.AddHyperlinkRelationship(new Uri(url), true).Id;
            para.Append(new Hyperlink(
                new Run(new RunProperties(new Color { Val = LinkHex }, new Underline { Val = UnderlineValues.Single }, new FontSize { Val = "19" }),
                    T(label)))
            { Id = relId });
        }
        catch
        {
            para.Append(new Run(new RunProperties(new FontSize { Val = "19" }), T(url)));
        }
        body.Append(para);
    }

    private static string DocUrl(string mediaBase, string path)
    {
        if (path.StartsWith("http", StringComparison.OrdinalIgnoreCase)) return path;
        var b = (mediaBase ?? "").TrimEnd('/');
        return path.StartsWith("/") ? b + path : b + "/" + path;
    }

    // ── Image embedding ── returns false when the part couldn't be created, so the caller links instead.
    private static bool AppendImage(MainDocumentPart main, Body body, OcvWordDocument d, ref uint imgId)
    {
        var partType = ClubMonthlyReportWordBuilder.MapImageType(d.Extension);
        if (partType == null) return false;
        return EmbedImageBytes(main, body, d.ImageBytes!, partType.Value, ref imgId);
    }

    // Embeds raw image bytes as a centred inline picture. Shared by the photo path (jpg/png/…)
    // and the PDF-page path (rasterised PNGs). Returns false when the image part can't be created.
    private static bool EmbedImageBytes(MainDocumentPart main, Body body, byte[] bytes, PartTypeInfo partType, ref uint imgId,
        long maxWidthEmu = MaxPhotoWidthEmu, long maxHeightEmu = MaxPhotoHeightEmu)
    {
        string relId;
        try
        {
            var imagePart = main.AddImagePart(partType);
            using (var stream = new MemoryStream(bytes)) imagePart.FeedData(stream);
            relId = main.GetIdOfPart(imagePart);
        }
        catch { return false; }

        var (w, h) = ClubMonthlyReportWordBuilder.ReadImageSize(bytes);
        var (cx, cy) = FitEmu(w, h, maxWidthEmu, maxHeightEmu);
        uint id = imgId++;

        var drawing = new Drawing(
            new DW.Inline(
                new DW.Extent { Cx = cx, Cy = cy },
                new DW.EffectExtent { LeftEdge = 0L, TopEdge = 0L, RightEdge = 0L, BottomEdge = 0L },
                new DW.DocProperties { Id = id, Name = $"Picture{id}" },
                new DW.NonVisualGraphicFrameDrawingProperties(new A.GraphicFrameLocks { NoChangeAspect = true }),
                new A.Graphic(new A.GraphicData(
                    new PIC.Picture(
                        new PIC.NonVisualPictureProperties(
                            new PIC.NonVisualDrawingProperties { Id = id, Name = $"Image{id}" },
                            new PIC.NonVisualPictureDrawingProperties()),
                        new PIC.BlipFill(new A.Blip { Embed = relId }, new A.Stretch(new A.FillRectangle())),
                        new PIC.ShapeProperties(
                            new A.Transform2D(new A.Offset { X = 0L, Y = 0L }, new A.Extents { Cx = cx, Cy = cy }),
                            new A.PresetGeometry(new A.AdjustValueList()) { Preset = A.ShapeTypeValues.Rectangle }))
                ) { Uri = "http://schemas.openxmlformats.org/drawingml/2006/picture" })
            ) { DistanceFromTop = 0U, DistanceFromBottom = 0U, DistanceFromLeft = 0U, DistanceFromRight = 0U });

        body.Append(new Paragraph(
            new ParagraphProperties(new Justification { Val = JustificationValues.Center }, new SpacingBetweenLines { Before = "120", After = "40" }),
            new Run(drawing)));
        return true;
    }

    private static (long cx, long cy) FitEmu(int w, int h, long maxWidthEmu = MaxPhotoWidthEmu, long maxHeightEmu = MaxPhotoHeightEmu)
    {
        if (w <= 0 || h <= 0) { w = 800; h = 600; }
        long cx = (long)w * 9525;
        long cy = (long)h * 9525;
        double scale = Math.Min((double)maxWidthEmu / cx, (double)maxHeightEmu / cy);
        if (scale < 1.0) { cx = (long)(cx * scale); cy = (long)(cy * scale); }
        return (Math.Max(cx, 1), Math.Max(cy, 1));
    }

    // ── Book-like base font ──
    private static void ApplySerifDefaults(MainDocumentPart main)
    {
        var stylePart = main.AddNewPart<StyleDefinitionsPart>();
        stylePart.Styles = new Styles(
            new DocDefaults(
                new RunPropertiesDefault(
                    new RunPropertiesBaseStyle(
                        new RunFonts { Ascii = "Georgia", HighAnsi = "Georgia", ComplexScript = "Georgia" },
                        new FontSize { Val = "22" },
                        new FontSizeComplexScript { Val = "22" })),
                new ParagraphPropertiesDefault(
                    new ParagraphPropertiesBaseStyle(
                        new SpacingBetweenLines { After = "120", Line = "276", LineRule = LineSpacingRuleValues.Auto }))));
        stylePart.Styles.Save();
    }

    // ── Text / layout helpers ──
    private static void SectionHeading(Body body, string title)
    {
        body.Append(new Paragraph(
            new ParagraphProperties(
                new SpacingBetweenLines { Before = "360", After = "120" },
                new ParagraphBorders(new BottomBorder { Val = BorderValues.Single, Size = 6, Color = BrandBlueHex, Space = 4 })),
            new Run(new RunProperties(new Bold(), new Color { Val = BrandBlueHex }, new FontSize { Val = "30" }),
                T(title))));
    }

    private static void SubHeading(Body body, string title)
    {
        body.Append(new Paragraph(
            new ParagraphProperties(new SpacingBetweenLines { Before = "240", After = "80" }),
            new Run(new RunProperties(new Bold(), new Color { Val = BrandBlueHex }, new FontSize { Val = "24" }),
                T(title))));
    }

    private static void ItemTitle(Body body, string title)
    {
        body.Append(new Paragraph(
            new ParagraphProperties(new SpacingBetweenLines { Before = "220", After = "20" }),
            new Run(new RunProperties(new Bold(), new Color { Val = "222222" }, new FontSize { Val = "25" }),
                T(title))));
    }

    private static void InlineFacts(Body body, List<(string Label, string Value)> pairs)
    {
        if (pairs.Count == 0) return;
        var para = new Paragraph(new ParagraphProperties(new SpacingBetweenLines { After = "40" }));
        for (int i = 0; i < pairs.Count; i++)
        {
            if (i > 0) para.Append(new Run(new RunProperties(new Color { Val = DividerHex }, new FontSize { Val = "19" }), T("   ·   ")));
            para.Append(new Run(new RunProperties(new Bold(), new Color { Val = LabelHex }, new FontSize { Val = "19" }), T(pairs[i].Label + ": ")));
            para.Append(new Run(new RunProperties(new FontSize { Val = "19" }), T(pairs[i].Value ?? "")));
        }
        body.Append(para);
    }

    private static Paragraph MutedText(string text) => new(
        new Run(new RunProperties(new Italic(), new Color { Val = MutedHex }, new FontSize { Val = "20" }),
            T(text)));

    private static Paragraph Centered(string text, int sizeHalfPt, bool bold = false, string? colorHex = null)
    {
        var rp = new RunProperties(new FontSize { Val = sizeHalfPt.ToString() });
        if (bold) rp.Append(new Bold());
        if (!string.IsNullOrEmpty(colorHex)) rp.Append(new Color { Val = colorHex });
        return new Paragraph(
            new ParagraphProperties(new Justification { Val = JustificationValues.Center }, new SpacingBetweenLines { After = "60" }),
            new Run(rp, T(text)));
    }

    private static void Spacer(Body body) => body.Append(new Paragraph(new Run(T(""))));

    // Strips characters illegal in XML 1.0 (NUL and other control bytes that DB text can carry).
    // Removes 0x00–0x08, 0x0B, 0x0C, 0x0E–0x1F and 0xFFFE/0xFFFF; keeps tab/LF/CR and everything
    // else (including surrogate pairs for astral chars). Returns "" for null.
    private static string Xml(string? s)
    {
        if (string.IsNullOrEmpty(s)) return "";
        var sb = new System.Text.StringBuilder(s!.Length);
        foreach (var ch in s)
        {
            if (ch <= 0x08 || ch == 0x0B || ch == 0x0C || (ch >= 0x0E && ch <= 0x1F) || ch == 0xFFFE || ch == 0xFFFF)
                continue;
            sb.Append(ch);
        }
        return sb.ToString();
    }

    // The single lowest-level text run — EVERY piece of visible text goes through here, so the XML
    // sanitizer runs once for all call sites (titles, descriptions, table cells, field values, links).
    private static Text T(string? text) => new Text(Xml(text)) { Space = SpaceProcessingModeValues.Preserve };

    private static string Dash(string? s) => string.IsNullOrWhiteSpace(s) ? "—" : s!;

    private static void FourColTable(Body body, IReadOnlyList<string[]> rows)
    {
        var table = new Table(BaseTableProps(TableLayoutValues.Fixed), new TableGrid(
            new GridColumn { Width = "2600" }, new GridColumn { Width = "2400" },
            new GridColumn { Width = "2600" }, new GridColumn { Width = "2400" }));
        foreach (var r in rows)
            table.Append(new TableRow(LabelCell(r[0]), ValueCell(r[1]), LabelCell(r[2]), ValueCell(r[3])));
        body.Append(table);
    }

    // Two-column label/value table — used for a project's form fields in the detailed section.
    private static void TwoColTable(Body body, IReadOnlyList<(string Label, string Value)> pairs)
    {
        var table = new Table(BaseTableProps(TableLayoutValues.Fixed), new TableGrid(
            new GridColumn { Width = "3200" }, new GridColumn { Width = "6800" }));
        foreach (var (label, value) in pairs)
            table.Append(new TableRow(LabelCell(label), ValueCell(value)));
        body.Append(table);
    }

    private static void GridTable(Body body, IReadOnlyList<string> headers, IReadOnlyList<string[]> rows)
    {
        var table = new Table(BaseTableProps(TableLayoutValues.Autofit), BuildGrid(headers.Count));
        var headerRow = new TableRow(new TableRowProperties(new TableHeader()));
        foreach (var h in headers)
            headerRow.Append(new TableCell(
                new TableCellProperties(new Shading { Fill = BrandBlueHex, Val = ShadingPatternValues.Clear, Color = "auto" }),
                new Paragraph(new Run(new RunProperties(new Bold(), new Color { Val = "FFFFFF" }, new FontSize { Val = "18" }),
                    T(h)))));
        table.Append(headerRow);
        foreach (var r in rows)
        {
            var row = new TableRow();
            foreach (var c in r)
                row.Append(new TableCell(new TableCellProperties(),
                    new Paragraph(new Run(new RunProperties(new FontSize { Val = "17" }), T(c ?? "")))));
            table.Append(row);
        }
        body.Append(table);
    }

    private static TableCell LabelCell(string text) => new(
        new TableCellProperties(new Shading { Fill = "EEF3FB", Val = ShadingPatternValues.Clear, Color = "auto" }),
        new Paragraph(new Run(new RunProperties(new Bold(), new Color { Val = LabelHex }, new FontSize { Val = "19" }),
            T(text))));

    private static TableCell ValueCell(string text) => new(
        new TableCellProperties(),
        new Paragraph(new Run(new RunProperties(new FontSize { Val = "19" }),
            T(text ?? ""))));

    private static TableProperties BaseTableProps(TableLayoutValues layout) => new(
        new TableWidth { Width = "5000", Type = TableWidthUnitValues.Pct },
        new TableBorders(
            new TopBorder { Val = BorderValues.Single, Size = 2, Color = DividerHex },
            new BottomBorder { Val = BorderValues.Single, Size = 2, Color = DividerHex },
            new LeftBorder { Val = BorderValues.Single, Size = 2, Color = DividerHex },
            new RightBorder { Val = BorderValues.Single, Size = 2, Color = DividerHex },
            new InsideHorizontalBorder { Val = BorderValues.Single, Size = 2, Color = DividerHex },
            new InsideVerticalBorder { Val = BorderValues.Single, Size = 2, Color = DividerHex }),
        new TableLayout { Type = layout });

    private static TableGrid BuildGrid(int columns)
    {
        var grid = new TableGrid();
        for (int i = 0; i < columns; i++) grid.Append(new GridColumn());
        return grid;
    }

    private static SectionProperties SectionProps() => new(
        new PageSize { Width = 11906, Height = 16838 },
        new PageMargin { Top = 1080, Bottom = 1080, Left = 1080, Right = 1080, Header = 0, Footer = 0, Gutter = 0 });
}
