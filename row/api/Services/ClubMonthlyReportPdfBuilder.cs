using System.Globalization;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;
using RotaryApi.DTOs;

using RotaryApi.Services.Localization;
namespace RotaryApi.Services;

// PDF twin of ClubMonthlyReportWordBuilder — same content/design, rendered with QuestPDF.
// Emailed to DG / AG / President / Secretary when a CMR is submitted.
//   • Summary  — familiar layout (title, upload date, info grid, TRF, members).
//   • Detail   — Meetings + every avenue in a clean book-like flow: title, meta, facts,
//                description, clickable Agenda / MoM links, and embedded photos.
public static class ClubMonthlyReportPdfBuilder
{
    private static bool _licensed;
    private const string Brand = "#17458F";
    private const string Label = "#2A3F5C";
    private const string Muted = "#64748B";
    private const string Divider = "#D5DEE8";
    private const string LabelBg = "#EDF4FB";
    private const string Link = "#0067C8";
    private const string Ink = "#1B2C42";

    // S5: fixed labels in the current culture's language; callers set the club's (MessageCulture.Use). Labels
    // passed to InfoGrid, GridTable and the facts line are literals and are translated where they are drawn.
    private static string T(string english) => DbStringLocalizer.Instance[english];
    private static string T(string english, params object[] args) => DbStringLocalizer.Instance[english, args];

    private static readonly (string Key, string Label)[] Avenues =
    {
        ("community_service", "Community Service"),
        ("vocational_service", "Vocational Service"),
        ("international_service", "International Service"),
        ("new_generation_service", "New Generation Service"),
        ("public_image_initiative", "Public Image Initiative"),
    };

    private static readonly Dictionary<string, string> MeetingTypeLabels = new()
    {
        ["regular"] = "Regular", ["fellowship"] = "Fellowship", ["bod"] = "BOD",
        ["assembly"] = "Assembly", ["trust"] = "Trust",
    };

    // includePhotos=false renders a text-only report (no embedded images) — used as the
    // e-mail fallback when the photo-rich PDF would blow past the 20 MB mail-size limit.
    public static byte[] Build(MonthlyReportPreviewDto s, IReadOnlyList<CmrWordProjectDto> items, string mediaBase, bool includePhotos = true)
    {
        if (!_licensed) { QuestPDF.Settings.License = LicenseType.Community; _licensed = true; }

        var meetings = items.Where(i => i.ModuleKey == "club_service").ToList();

        // Compress embedded photos hard: QuestPDF defaults to 288 DPI + high quality, which
        // makes a photo-heavy report balloon to tens of MB. 96 DPI + medium JPEG keeps the
        // images perfectly legible on screen/e-mail while cutting size ~5-10x.
        var settings = DocumentSettings.Default;
        settings.ImageCompressionQuality = ImageCompressionQuality.Medium;
        settings.ImageRasterDpi = 96;

        return Document.Create(doc =>
        {
            doc.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(1.5f, Unit.Centimetre);
                // shortcut: PDFs keep server fonts, the brand's Figtree needs embedding (QuestPDF FontManager); add it when the PDF look is reviewed.
                page.DefaultTextStyle(x => x.FontFamily("Georgia").FontSize(10.5f).FontColor(Ink).LineHeight(1.35f));

                page.Content().Column(col =>
                {
                    col.Spacing(4);

                    // ROW logo, then the title
                    var logo = BrandAssets.PdfLogo;
                    if (logo != null)
                        col.Item().PaddingBottom(6).AlignCenter().Height(50).Image(logo).FitHeight();
                    col.Item().AlignCenter().Text(T("Club Monthly Report — {0} {1}", s.MonthName, s.YearLabel)).Bold().FontSize(17).FontColor("#1B2C42");
                    if (s.UploadedToDistrictDate.HasValue)
                        col.Item().AlignCenter().Text(T("Uploaded to District: {0}", FmtDateTime(s.UploadedToDistrictDate.Value))).FontSize(10).FontColor(Muted);
                    col.Item().PaddingBottom(4);

                    // Info grid
                    InfoGrid(col, new (string, string, string, string)[]
                    {
                        ("Club Name", s.ClubName, "Prepared By", Dash(s.PreparedBy)),
                        ("Rotary Club ID", Dash(s.ClubCode), "Designation", Dash(s.Designation)),
                        ("Assistant Governor", Dash(s.AssistantGovernor), "No. Of Members", s.CurrentMemberCount.ToString()),
                        ("No. Of Meetings", s.TotalMeetings.ToString(), "Avg. Attendance", $"{s.AverageAttendance:0.##}%"),
                    });

                    // TRF
                    SubHeading(col, T("TRF Contribution"));
                    col.Item().Text(T("Current Month: {0}", "$" + s.TrfCurrentMonth.ToString("N2", CultureInfo.InvariantCulture)) + "     |     " + T("This Year: {0}", "$" + s.TrfThisYear.ToString("N2", CultureInfo.InvariantCulture))).FontSize(10);
                    if (s.TrfEntries.Count > 0)
                    {
                        var rows = s.TrfEntries.Select((e, i) => new[]
                        {
                            (i + 1).ToString(),
                            e.TrfDate.ToString("dd MMM yyyy", CultureInfo.InvariantCulture),
                            e.DonorName ?? "",
                            "$" + e.AmountUSD.ToString("N2", CultureInfo.InvariantCulture),
                            e.FundType == "Other" && !string.IsNullOrWhiteSpace(e.OtherFundName) ? e.OtherFundName! : (e.FundType ?? ""),
                        }).ToList();
                        GridTable(col, new[] { "Sr.No", "Date", "Name", "Amount (USD)", "Fund Type" },
                            new[] { 1f, 2f, 3f, 2f, 3f }, rows);
                    }

                    // Members
                    SubHeading(col, T("Members"));
                    InfoGrid(col, new (string, string, string, string)[]
                    {
                        ("Member count as on last month", s.MemberCountLastMonth.ToString(), "Members Deleted/Terminated", s.MembersDeleted.ToString()),
                        ("Members Added", s.MembersAdded.ToString(), "Current No. Of Members", s.CurrentMemberCount.ToString()),
                    });
                    if (!string.IsNullOrWhiteSpace(s.AdditionalRemarks))
                    {
                        col.Item().PaddingTop(4).Text(T("Additional achievement / participation / hosting of events / projects above club, if any:")).Bold().FontColor(Label).FontSize(10);
                        col.Item().Text(s.AdditionalRemarks!).FontSize(10.5f);
                    }

                    // Meetings
                    SectionHeading(col, T("Meetings ({0})", meetings.Count));
                    if (meetings.Count == 0) col.Item().Text(T("No meetings recorded for this month.")).Italic().FontColor(Muted).FontSize(10);
                    int n = 1;
                    foreach (var m in meetings) Item(col, mediaBase, m, isMeeting: true, index: n++, includePhotos: includePhotos);

                    // Avenues
                    foreach (var (key, label) in Avenues)
                    {
                        var list = items.Where(i => i.ModuleKey == key).ToList();
                        SectionHeading(col, $"{T(label)} ({list.Count})");
                        if (list.Count == 0) col.Item().Text(T("No {0} projects recorded for this month.", T(label))).Italic().FontColor(Muted).FontSize(10);
                        n = 1;
                        foreach (var p in list) Item(col, mediaBase, p, isMeeting: false, index: n++, includePhotos: includePhotos);
                    }

                    // Note
                    col.Item().PaddingTop(12).Text(t =>
                    {
                        t.Span(T("Note:") + " ").Bold().Italic().FontSize(8.5f);
                        t.Span(T("Agenda, MOM and photographs added to Club Meetings are not shared with the District. Only the content displayed here is shared.")).Italic().FontSize(8.5f).FontColor(Muted);
                    });
                });

                page.Footer().AlignCenter().Text(t =>
                {
                    t.DefaultTextStyle(x => x.FontSize(8).FontColor(Muted));
                    t.Span(T("Page") + " ");
                    t.CurrentPageNumber();
                    t.Span(" " + T("of") + " ");
                    t.TotalPages();
                });
            });
        }).WithSettings(settings).GeneratePdf();
    }

    // ── one meeting/project block ──
    private static void Item(ColumnDescriptor col, string mediaBase, CmrWordProjectDto p, bool isMeeting, int index, bool includePhotos = true)
    {
        col.Item().PaddingTop(8).Text($"{index}.  {(string.IsNullOrWhiteSpace(p.Title) ? T("(untitled)") : p.Title)}").Bold().FontSize(12.5f).FontColor(Ink);

        var meta = new List<string>();
        if (!string.IsNullOrWhiteSpace(p.ProjectDate)) meta.Add(FmtDate(p.ProjectDate!));
        if (isMeeting && !string.IsNullOrWhiteSpace(p.MeetingType))
            meta.Add(MeetingTypeLabels.TryGetValue(p.MeetingType!.ToLowerInvariant(), out var lbl) ? T("{0} meeting", T(lbl)) : T("{0} meeting", p.MeetingType!));
        if (meta.Count > 0)
            col.Item().Text(string.Join("   ·   ", meta)).Italic().FontColor(Muted).FontSize(9.5f);

        var facts = new List<(string, string)>();
        if (isMeeting)
        {
            if (p.Attendance is > 0) facts.Add(("Attendance", p.Attendance + (p.AttendancePercentage is > 0 ? $" ({p.AttendancePercentage:0.##}%)" : "")));
            if (!string.IsNullOrWhiteSpace(p.Location)) facts.Add(("Location", p.Location!));
        }
        else
        {
            var focus = FirstNonEmpty(p.AreaOfFocusName, p.OtherAreaOfFocus);
            if (focus != null) facts.Add(("Area of Focus", focus));
            if (!string.IsNullOrWhiteSpace(p.Location)) facts.Add(("Location", p.Location!));
            if (p.ProjectCost is > 0) facts.Add(("Cost", RotaryApi.Services.Brand.Money(p.ProjectCost!.Value, null, 0)));
            if (!string.IsNullOrWhiteSpace(p.FundingName)) facts.Add(("Funding", p.FundingName!));
            if (p.DirectBeneficiaries is > 0) facts.Add(("Beneficiaries", p.DirectBeneficiaries!.Value.ToString()));
            if (p.ManHours is > 0) facts.Add(("Man-hours", p.ManHours!.Value.ToString()));
            if (p.RotariansInvolved is > 0) facts.Add(("Rotarians", p.RotariansInvolved!.Value.ToString()));
            if (p.RotaractorsInvolved is > 0) facts.Add(("Rotaractors", p.RotaractorsInvolved!.Value.ToString()));
            if (p.RccInvolved is > 0) facts.Add(("RCC", p.RccInvolved!.Value.ToString()));
            if (p.IsJointProject) facts.Add(("Joint Project", string.IsNullOrWhiteSpace(p.CoHostName) ? T("Yes") : T("with {0}", p.CoHostName!)));
        }
        if (facts.Count > 0)
        {
            col.Item().PaddingTop(2).Text(t =>
            {
                for (int i = 0; i < facts.Count; i++)
                {
                    if (i > 0) t.Span("   ·   ").FontColor(Divider).FontSize(9.5f);
                    t.Span(T(facts[i].Item1) + ": ").Bold().FontColor(Label).FontSize(9.5f);
                    t.Span(facts[i].Item2).FontSize(9.5f);
                }
            });
        }

        if (!string.IsNullOrWhiteSpace(p.Description))
            col.Item().PaddingTop(2).Text(p.Description!).FontSize(10.5f);

        // Agenda / MoM links
        var agenda = DocUrl(mediaBase, p.AgendaDocument);
        var mom = DocUrl(mediaBase, p.MinutesDocument);
        if (agenda != null || mom != null)
        {
            col.Item().PaddingTop(3).Row(row =>
            {
                row.Spacing(10);
                row.AutoItem().Text(T("Documents:")).Bold().FontColor(Label).FontSize(9.5f);
                if (agenda != null) row.AutoItem().Hyperlink(agenda).Text(T("Agenda")).FontColor(Link).Underline().FontSize(9.5f);
                if (mom != null) row.AutoItem().Hyperlink(mom).Text(T("Minutes of Meeting")).FontColor(Link).Underline().FontSize(9.5f);
            });
        }

        // Photos (skipped entirely in the text-only fallback build)
        if (includePhotos)
        {
            foreach (var ph in p.Photos)
            {
                if (ph.ImageBytes == null || ph.ImageBytes.Length == 0 || !LooksLikeImage(ph.ImageBytes)) continue;
                try
                {
                    col.Item().PaddingTop(6).AlignCenter().MaxWidth(12, Unit.Centimetre).MaxHeight(11, Unit.Centimetre).Image(ph.ImageBytes).FitArea();
                    if (!string.IsNullOrWhiteSpace(ph.Description))
                        col.Item().AlignCenter().PaddingBottom(4).Text(ph.Description!).Italic().FontColor(Muted).FontSize(8.5f);
                }
                catch { /* skip a photo that fails to render */ }
            }
        }
    }

    // ── layout helpers ──
    private static void SectionHeading(ColumnDescriptor col, string title)
    {
        col.Item().PaddingTop(12).BorderBottom(1.2f).BorderColor(Brand).PaddingBottom(2)
            .Text(title).Bold().FontSize(14.5f).FontColor(Brand);
    }

    private static void SubHeading(ColumnDescriptor col, string title)
    {
        col.Item().PaddingTop(8).Text(title).Bold().FontSize(12).FontColor(Brand);
    }

    private static void InfoGrid(ColumnDescriptor col, (string L1, string V1, string L2, string V2)[] rows)
    {
        col.Item().Table(t =>
        {
            t.ColumnsDefinition(c => { c.RelativeColumn(2.4f); c.RelativeColumn(2.6f); c.RelativeColumn(2.4f); c.RelativeColumn(2.6f); });
            foreach (var r in rows)
            {
                t.Cell().Element(LabelCell).Text(T(r.L1)).Bold().FontColor(Label).FontSize(9.5f);
                t.Cell().Element(ValueCell).Text(r.V1).FontSize(9.5f);
                t.Cell().Element(LabelCell).Text(T(r.L2)).Bold().FontColor(Label).FontSize(9.5f);
                t.Cell().Element(ValueCell).Text(r.V2).FontSize(9.5f);
            }
        });
    }

    private static void GridTable(ColumnDescriptor col, string[] headers, float[] widths, IReadOnlyList<string[]> rows)
    {
        col.Item().PaddingTop(2).Table(t =>
        {
            t.ColumnsDefinition(c => { foreach (var w in widths) c.RelativeColumn(w); });
            foreach (var h in headers)
                t.Cell().Element(HeaderCell).Text(T(h)).Bold().FontColor("#FCFDFE").FontSize(9.5f);
            foreach (var r in rows)
                foreach (var cval in r)
                    t.Cell().Element(ValueCell).Text(cval ?? "").FontSize(9.5f);
        });
    }

    private static IContainer LabelCell(IContainer c) => c.Border(0.5f).BorderColor(Divider).Background(LabelBg).PaddingVertical(3).PaddingHorizontal(5);
    private static IContainer ValueCell(IContainer c) => c.Border(0.5f).BorderColor(Divider).PaddingVertical(3).PaddingHorizontal(5);
    private static IContainer HeaderCell(IContainer c) => c.Border(0.5f).BorderColor(Divider).Background(Brand).PaddingVertical(3).PaddingHorizontal(5);

    private static string? DocUrl(string mediaBase, string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return null;
        if (path.StartsWith("http", StringComparison.OrdinalIgnoreCase)) return path;
        var b = (mediaBase ?? "").TrimEnd('/');
        return path.StartsWith("/") ? b + path : b + "/" + path;
    }

    private static bool LooksLikeImage(byte[] b)
    {
        if (b.Length < 12) return false;
        if (b[0] == 0xFF && b[1] == 0xD8) return true;                                   // JPEG
        if (b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47) return true;   // PNG
        if (b[0] == 0x47 && b[1] == 0x49 && b[2] == 0x46) return true;                   // GIF
        if (b[0] == 0x42 && b[1] == 0x4D) return true;                                   // BMP
        if (b[0] == 0x52 && b[1] == 0x49 && b[2] == 0x46 && b[3] == 0x46 &&              // RIFF....WEBP
            b[8] == 0x57 && b[9] == 0x45 && b[10] == 0x42 && b[11] == 0x50) return true;
        return false;
    }

    private static string? FirstNonEmpty(params string?[] vals)
    {
        foreach (var v in vals) if (!string.IsNullOrWhiteSpace(v)) return v;
        return null;
    }

    private static string Dash(string? v) => string.IsNullOrWhiteSpace(v) ? "-" : v!;

    private static string FmtDate(string ymd) =>
        DateTime.TryParse(ymd, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)
            ? d.ToString("dd MMM yyyy", CultureInfo.InvariantCulture) : ymd;

    private static string FmtDateTime(DateTime d) =>
        d.ToString("ddd, dd MMM yyyy hh:mm:ss tt", CultureInfo.InvariantCulture);
}
