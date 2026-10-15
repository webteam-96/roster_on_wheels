using System.Globalization;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using RotaryApi.DTOs;
using A = DocumentFormat.OpenXml.Drawing;
using DW = DocumentFormat.OpenXml.Drawing.Wordprocessing;
using PIC = DocumentFormat.OpenXml.Drawing.Pictures;

namespace RotaryApi.Services;

// Builds the Club Monthly Report Word (.docx):
//   • Summary   — mirrors the familiar report layout (title, upload date, info grid, TRF, members).
//   • Detail    — Meetings + every service avenue rendered in a clean, book-like flow: each item
//                 gets a title, a meta line, its facts, its description (justified), clickable
//                 Agenda / Minutes-of-Meeting download links, and its photos embedded inline.
// Photo bytes are loaded by the controller (CmrWordPhotoDto.ImageBytes). `mediaBase` is the
// absolute base URL used to build the Agenda/MoM hyperlinks.
public static class ClubMonthlyReportWordBuilder
{
    private const string BrandBlueHex = "003DA5";
    private const string LabelHex = "44546A";
    private const string MutedHex = "7A7A7A";
    private const string LinkHex = "0563C1";
    private const string DividerHex = "B9C7DE";
    private const long MaxPhotoWidthEmu = 4_100_000;   // ~4.48"
    private const long MaxPhotoHeightEmu = 3_400_000;  // ~3.72"

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

    public static byte[] BuildReport(MonthlyReportPreviewDto s, IReadOnlyList<CmrWordProjectDto> items, string mediaBase)
    {
        // Strip NUL/control chars imported project text may carry (OpenXML SaveAs can't serialize them).
        SanitizeStrings(s);
        foreach (var it in items) { SanitizeStrings(it); foreach (var ph in it.Photos) SanitizeStrings(ph); }

        using var ms = new MemoryStream();
        using (var doc = WordprocessingDocument.Create(ms, WordprocessingDocumentType.Document))
        {
            var main = doc.AddMainDocumentPart();
            ApplySerifDefaults(main);   // book-like base font

            var body = new Body();
            uint imgId = 1;

            // ── Summary (familiar layout) ──
            body.Append(Centered($"Club Monthly Report — {s.MonthName} {s.YearLabel}", 32, bold: true));
            if (s.UploadedToDistrictDate.HasValue)
                body.Append(Centered($"Uploaded to District: {FormatDateTime(s.UploadedToDistrictDate.Value)}", 22, bold: true, colorHex: MutedHex));
            Spacer(body);

            FourColTable(body, new List<string[]>
            {
                new[] { "Club Name", s.ClubName, "Prepared By", Dash(s.PreparedBy) },
                new[] { "Rotary Club ID", Dash(s.ClubCode), "Designation", Dash(s.Designation) },
                new[] { "Assistant Governor", Dash(s.AssistantGovernor), "No. Of Members", s.CurrentMemberCount.ToString() },
                new[] { "No. Of Meetings", s.TotalMeetings.ToString(), "Avg. Attendance", $"{s.AverageAttendance:0.##}%" },
            });

            // TRF
            SubHeading(body, "TRF Contribution");
            body.Append(PlainText($"Current Month: ${s.TrfCurrentMonth.ToString("N2", CultureInfo.InvariantCulture)}    |    This Year: ${s.TrfThisYear.ToString("N2", CultureInfo.InvariantCulture)}"));
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
                GridTable(body, new[] { "Sr.No", "Date", "Name", "Amount (USD)", "Fund Type" }, rows);
            }

            // Members
            SubHeading(body, "Members");
            FourColTable(body, new List<string[]>
            {
                new[] { "Member count as on last month", s.MemberCountLastMonth.ToString(), "Members Deleted/Terminated", s.MembersDeleted.ToString() },
                new[] { "Members Added", s.MembersAdded.ToString(), "Current No. Of Members", s.CurrentMemberCount.ToString() },
            });
            if (!string.IsNullOrWhiteSpace(s.AdditionalRemarks))
            {
                body.Append(LabelPara("Additional achievement / participation / hosting of events / projects above club, if any:"));
                body.Append(BodyPara(s.AdditionalRemarks!));
            }

            // ── Detail: Meetings ──
            var meetings = items.Where(i => i.ModuleKey == "club_service").ToList();
            SectionHeading(body, $"Meetings ({meetings.Count})");
            if (meetings.Count == 0) body.Append(MutedText("No meetings recorded for this month."));
            int n = 1;
            foreach (var m in meetings) AppendItem(main, body, mediaBase, m, isMeeting: true, index: n++, ref imgId);

            // ── Detail: each service avenue ──
            foreach (var (key, label) in Avenues)
            {
                var list = items.Where(i => i.ModuleKey == key).ToList();
                SectionHeading(body, $"{label} ({list.Count})");
                if (list.Count == 0) body.Append(MutedText($"No {label} projects recorded for this month."));
                n = 1;
                foreach (var p in list) AppendItem(main, body, mediaBase, p, isMeeting: false, index: n++, ref imgId);
            }

            // ── Note ──
            Spacer(body);
            body.Append(new Paragraph(
                new ParagraphProperties(new SpacingBetweenLines { Before = "200" }),
                new Run(new RunProperties(new Bold(), new Italic(), new FontSize { Val = "16" }), new Text("Note: ") { Space = SpaceProcessingModeValues.Preserve }),
                new Run(new RunProperties(new Italic(), new FontSize { Val = "16" }),
                    new Text("Agenda, MOM and photographs added to Club Meetings are not shared with the District — only the content displayed here is shared.") { Space = SpaceProcessingModeValues.Preserve })));

            body.Append(SectionProps());
            main.Document = new Document(body);
            main.Document.Save();
        }
        return ms.ToArray();
    }

    // Membership analytics for the Annual Report summary (no TRF).
    public sealed record AnnualMembership(int Current, int Male, int Female, int Honorary, int AddedThisYear);

    // Annual Report: same book-like flow as the monthly report, scoped to the whole year, with a
    // membership-analytics summary instead of the CMR summary, and no TRF.
    public static byte[] BuildAnnualReport(string clubName, string yearLabel, AnnualMembership mem,
        IReadOnlyList<CmrWordProjectDto> items, string mediaBase)
    {
        // Imported project text can carry NUL/control chars that OpenXML cannot serialize (SaveAs then
        // throws "hexadecimal value 0x00, is an invalid character" → 500). Strip them from every string first.
        clubName = XmlClean(clubName); yearLabel = XmlClean(yearLabel);
        foreach (var it in items) { SanitizeStrings(it); foreach (var ph in it.Photos) SanitizeStrings(ph); }

        using var ms = new MemoryStream();
        using (var doc = WordprocessingDocument.Create(ms, WordprocessingDocumentType.Document))
        {
            var main = doc.AddMainDocumentPart();
            ApplySerifDefaults(main);
            var body = new Body();
            uint imgId = 1;

            body.Append(Centered($"Rotary Club of {clubName}", 34, bold: true));
            body.Append(Centered($"Annual Report — RY {yearLabel}", 28, bold: true, colorHex: BrandBlueHex));
            Spacer(body);

            // Membership (analytics only)
            SectionHeading(body, "Membership");
            FourColTable(body, new List<string[]>
            {
                new[] { "Current Members", mem.Current.ToString(), "Added this year", mem.AddedThisYear.ToString() },
                new[] { "Male", mem.Male.ToString(), "Female", mem.Female.ToString() },
                new[] { "Honorary", mem.Honorary.ToString(), "", "" },
            });

            // Club Service (meetings across the year)
            var meetings = items.Where(i => i.ModuleKey == "club_service").ToList();
            SectionHeading(body, $"Club Service — Meetings ({meetings.Count})");
            if (meetings.Count == 0) body.Append(MutedText("No meetings recorded for this year."));
            int n = 1;
            foreach (var m in meetings) AppendItem(main, body, mediaBase, m, isMeeting: true, index: n++, ref imgId);

            // Service avenues (each project detailed, area of focus shown as a field)
            foreach (var (key, label) in Avenues)
            {
                var list = items.Where(i => i.ModuleKey == key).ToList();
                SectionHeading(body, $"{label} ({list.Count})");
                if (list.Count == 0) body.Append(MutedText($"No {label} projects recorded for this year."));
                n = 1;
                foreach (var p in list) AppendItem(main, body, mediaBase, p, isMeeting: false, index: n++, ref imgId);
            }

            body.Append(SectionProps());
            main.Document = new Document(body);
            main.Document.Save();
        }
        return ms.ToArray();
    }

    // ── One meeting/project block (book-like) ──
    private static void AppendItem(MainDocumentPart main, Body body, string mediaBase, CmrWordProjectDto p, bool isMeeting, int index, ref uint imgId)
    {
        ItemTitle(body, $"{index}.  {(string.IsNullOrWhiteSpace(p.Title) ? "(untitled)" : p.Title)}");

        // Meta line: date · (meeting type | avenue focus)
        var meta = new List<string>();
        if (!string.IsNullOrWhiteSpace(p.ProjectDate)) meta.Add(FormatDate(p.ProjectDate!));
        if (isMeeting && !string.IsNullOrWhiteSpace(p.MeetingType))
            meta.Add((MeetingTypeLabels.TryGetValue(p.MeetingType!.ToLowerInvariant(), out var lbl) ? lbl : p.MeetingType!) + " meeting");
        if (meta.Count > 0) MetaLine(body, string.Join("   ·   ", meta));

        // Facts
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
            if (!string.IsNullOrWhiteSpace(p.CategoryName)) facts.Add(("Category", p.CategoryName!));
            if (!string.IsNullOrWhiteSpace(p.SubCategoryName)) facts.Add(("Sub-Category", p.SubCategoryName!));
            if (!string.IsNullOrWhiteSpace(p.Location)) facts.Add(("Location", p.Location!));
            if (p.ProjectCost is > 0) facts.Add(("Cost", Brand.Money(p.ProjectCost!.Value, null, 0)));
            if (!string.IsNullOrWhiteSpace(p.FundingName)) facts.Add(("Funding", p.FundingName!));
            if (p.DirectBeneficiaries is > 0) facts.Add(("Beneficiaries", p.DirectBeneficiaries!.Value.ToString()));
            if (p.ManHours is > 0) facts.Add(("Man-hours", p.ManHours!.Value.ToString()));
            if (p.RotariansInvolved is > 0) facts.Add(("Rotarians", p.RotariansInvolved!.Value.ToString()));
            if (p.RotaractorsInvolved is > 0) facts.Add(("Rotaractors", p.RotaractorsInvolved!.Value.ToString()));
            if (p.RccInvolved is > 0) facts.Add(("RCC", p.RccInvolved!.Value.ToString()));
            if (p.IsJointProject) facts.Add(("Joint Project", string.IsNullOrWhiteSpace(p.CoHostName) ? "Yes" : $"with {p.CoHostName}"));
        }
        InlineFacts(body, facts);

        if (!string.IsNullOrWhiteSpace(p.Description))
            body.Append(BodyPara(p.Description!));

        // Agenda / Minutes links (downloadable from the doc)
        DocsLine(main, body, mediaBase, ("Agenda", p.AgendaDocument), ("Minutes of Meeting", p.MinutesDocument));

        // Photos
        foreach (var ph in p.Photos)
        {
            if (ph.ImageBytes == null || ph.ImageBytes.Length == 0) continue;
            AppendImage(main, body, ph, ref imgId);
        }
        Spacer(body);
    }

    // ── Agenda / MoM download links ──
    private static void DocsLine(MainDocumentPart main, Body body, string mediaBase, params (string Label, string? Path)[] docs)
    {
        var links = docs.Where(d => !string.IsNullOrWhiteSpace(d.Path)).ToList();
        if (links.Count == 0) return;

        var para = new Paragraph(new ParagraphProperties(new SpacingBetweenLines { Before = "40", After = "60" }));
        para.Append(new Run(new RunProperties(new Bold(), new Color { Val = LabelHex }, new FontSize { Val = "19" }),
            new Text("Documents:  ") { Space = SpaceProcessingModeValues.Preserve }));

        bool first = true;
        foreach (var (label, path) in links)
        {
            if (!first) para.Append(new Run(new RunProperties(new Color { Val = MutedHex }, new FontSize { Val = "19" }), new Text("    ·    ") { Space = SpaceProcessingModeValues.Preserve }));
            first = false;
            var url = DocUrl(mediaBase, path!);
            try
            {
                var relId = main.AddHyperlinkRelationship(new Uri(url), true).Id;
                para.Append(new Hyperlink(
                    new Run(new RunProperties(new Color { Val = LinkHex }, new Underline { Val = UnderlineValues.Single }, new FontSize { Val = "19" }),
                        new Text(label) { Space = SpaceProcessingModeValues.Preserve }))
                { Id = relId });
            }
            catch
            {
                para.Append(new Run(new RunProperties(new FontSize { Val = "19" }), new Text(label) { Space = SpaceProcessingModeValues.Preserve }));
            }
        }
        body.Append(para);
    }

    private static string DocUrl(string mediaBase, string path)
    {
        if (path.StartsWith("http", StringComparison.OrdinalIgnoreCase)) return path;
        var b = (mediaBase ?? "").TrimEnd('/');
        return path.StartsWith("/") ? b + path : b + "/" + path;
    }

    // ── Image embedding ──
    private static void AppendImage(MainDocumentPart main, Body body, CmrWordPhotoDto ph, ref uint imgId)
    {
        var partType = MapImageType(ph.ImageExtension);
        if (partType == null) return;

        string relId;
        try
        {
            var imagePart = main.AddImagePart(partType.Value);
            using (var stream = new MemoryStream(ph.ImageBytes!)) imagePart.FeedData(stream);
            relId = main.GetIdOfPart(imagePart);
        }
        catch { return; }

        var (w, h) = ReadImageSize(ph.ImageBytes!);
        var (cx, cy) = FitEmu(w, h);
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

        if (!string.IsNullOrWhiteSpace(ph.Description))
            body.Append(Caption(ph.Description!));
    }

    // Remove characters OpenXML/Word XML cannot serialize (NUL + other control chars not valid in XML 1.0).
    private static string XmlClean(string? s)
    {
        if (string.IsNullOrEmpty(s)) return s ?? "";
        var sb = new System.Text.StringBuilder(s!.Length);
        foreach (var ch in s!)
            if (System.Xml.XmlConvert.IsXmlChar(ch)) sb.Append(ch);
        return sb.ToString();
    }

    // Clean every readable/writable string property on a DTO in place (project + photo text fields).
    private static void SanitizeStrings(object? obj)
    {
        if (obj == null) return;
        foreach (var p in obj.GetType().GetProperties())
            if (p.PropertyType == typeof(string) && p.CanRead && p.CanWrite)
                p.SetValue(obj, XmlClean((string?)p.GetValue(obj)));
    }

    internal static PartTypeInfo? MapImageType(string? ext) => (ext ?? "").ToLowerInvariant() switch
    {
        "jpg" or "jpeg" => ImagePartType.Jpeg,
        "png" => ImagePartType.Png,
        "gif" => ImagePartType.Gif,
        "bmp" => ImagePartType.Bmp,
        "tif" or "tiff" => ImagePartType.Tiff,
        _ => null,
    };

    private static (long cx, long cy) FitEmu(int w, int h)
    {
        if (w <= 0 || h <= 0) { w = 800; h = 600; }
        long cx = (long)w * 9525;
        long cy = (long)h * 9525;
        double scale = Math.Min((double)MaxPhotoWidthEmu / cx, (double)MaxPhotoHeightEmu / cy);
        if (scale < 1.0) { cx = (long)(cx * scale); cy = (long)(cy * scale); }
        return (Math.Max(cx, 1), Math.Max(cy, 1));
    }

    internal static (int w, int h) ReadImageSize(byte[] b)
    {
        try
        {
            if (b.Length > 24 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47)
                return (((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]), ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]));
            if (b.Length > 4 && b[0] == 0xFF && b[1] == 0xD8)
            {
                int i = 2;
                while (i + 9 < b.Length)
                {
                    if (b[i] != 0xFF) { i++; continue; }
                    byte marker = b[i + 1];
                    if (marker >= 0xC0 && marker <= 0xCF && marker != 0xC4 && marker != 0xC8 && marker != 0xCC)
                        return (((b[i + 7] << 8) | b[i + 8]), ((b[i + 5] << 8) | b[i + 6]));
                    int len = (b[i + 2] << 8) | b[i + 3];
                    if (len <= 0) break;
                    i += 2 + len;
                }
            }
            if (b.Length > 10 && b[0] == 0x47 && b[1] == 0x49 && b[2] == 0x46)
                return ((b[6] | (b[7] << 8)), (b[8] | (b[9] << 8)));
        }
        catch { }
        return (800, 600);
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
                new Text(title) { Space = SpaceProcessingModeValues.Preserve })));
    }

    private static void SubHeading(Body body, string title)
    {
        body.Append(new Paragraph(
            new ParagraphProperties(new SpacingBetweenLines { Before = "240", After = "80" }),
            new Run(new RunProperties(new Bold(), new Color { Val = BrandBlueHex }, new FontSize { Val = "24" }),
                new Text(title) { Space = SpaceProcessingModeValues.Preserve })));
    }

    private static void ItemTitle(Body body, string title)
    {
        body.Append(new Paragraph(
            new ParagraphProperties(new SpacingBetweenLines { Before = "220", After = "20" }),
            new Run(new RunProperties(new Bold(), new Color { Val = "222222" }, new FontSize { Val = "25" }),
                new Text(title) { Space = SpaceProcessingModeValues.Preserve })));
    }

    private static void MetaLine(Body body, string text)
    {
        body.Append(new Paragraph(
            new ParagraphProperties(new SpacingBetweenLines { After = "40" }),
            new Run(new RunProperties(new Italic(), new Color { Val = MutedHex }, new FontSize { Val = "19" }),
                new Text(text) { Space = SpaceProcessingModeValues.Preserve })));
    }

    private static void InlineFacts(Body body, List<(string Label, string Value)> pairs)
    {
        if (pairs.Count == 0) return;
        var para = new Paragraph(new ParagraphProperties(new SpacingBetweenLines { After = "40" }));
        for (int i = 0; i < pairs.Count; i++)
        {
            if (i > 0) para.Append(new Run(new RunProperties(new Color { Val = DividerHex }, new FontSize { Val = "19" }), new Text("   ·   ") { Space = SpaceProcessingModeValues.Preserve }));
            para.Append(new Run(new RunProperties(new Bold(), new Color { Val = LabelHex }, new FontSize { Val = "19" }), new Text(pairs[i].Label + ": ") { Space = SpaceProcessingModeValues.Preserve }));
            para.Append(new Run(new RunProperties(new FontSize { Val = "19" }), new Text(pairs[i].Value ?? "") { Space = SpaceProcessingModeValues.Preserve }));
        }
        body.Append(para);
    }

    private static Paragraph LabelPara(string text) => new(
        new ParagraphProperties(new SpacingBetweenLines { Before = "120", After = "20" }),
        new Run(new RunProperties(new Bold(), new Color { Val = LabelHex }, new FontSize { Val = "20" }),
            new Text(text) { Space = SpaceProcessingModeValues.Preserve }));

    private static Paragraph BodyPara(string text) => new(
        new ParagraphProperties(new Justification { Val = JustificationValues.Both }, new SpacingBetweenLines { After = "80" }),
        new Run(new RunProperties(new FontSize { Val = "21" }), new Text(text) { Space = SpaceProcessingModeValues.Preserve }));

    private static Paragraph PlainText(string text) => new(
        new Run(new RunProperties(new FontSize { Val = "21" }), new Text(text) { Space = SpaceProcessingModeValues.Preserve }));

    private static Paragraph MutedText(string text) => new(
        new Run(new RunProperties(new Italic(), new Color { Val = MutedHex }, new FontSize { Val = "20" }),
            new Text(text) { Space = SpaceProcessingModeValues.Preserve }));

    private static Paragraph Caption(string text) => new(
        new ParagraphProperties(new Justification { Val = JustificationValues.Center }, new SpacingBetweenLines { After = "140" }),
        new Run(new RunProperties(new Italic(), new Color { Val = MutedHex }, new FontSize { Val = "18" }),
            new Text(text) { Space = SpaceProcessingModeValues.Preserve }));

    private static Paragraph Centered(string text, int sizeHalfPt, bool bold = false, string? colorHex = null)
    {
        var rp = new RunProperties(new FontSize { Val = sizeHalfPt.ToString() });
        if (bold) rp.Append(new Bold());
        if (!string.IsNullOrEmpty(colorHex)) rp.Append(new Color { Val = colorHex });
        return new Paragraph(
            new ParagraphProperties(new Justification { Val = JustificationValues.Center }, new SpacingBetweenLines { After = "60" }),
            new Run(rp, new Text(text) { Space = SpaceProcessingModeValues.Preserve }));
    }

    private static void Spacer(Body body) => body.Append(new Paragraph(new Run(new Text(""))));

    // 4-column table: cols 0 & 2 are shaded bold labels, 1 & 3 are values.
    private static void FourColTable(Body body, IReadOnlyList<string[]> rows)
    {
        var table = new Table(BaseTableProps(), new TableGrid(
            new GridColumn { Width = "2600" }, new GridColumn { Width = "2400" },
            new GridColumn { Width = "2600" }, new GridColumn { Width = "2400" }));
        foreach (var r in rows)
            table.Append(new TableRow(LabelCell(r[0]), ValueCell(r[1]), LabelCell(r[2]), ValueCell(r[3])));
        body.Append(table);
    }

    private static void GridTable(Body body, string[] headers, IReadOnlyList<string[]> rows)
    {
        var table = new Table(BaseTableProps(), BuildGrid(headers.Length));
        var headerRow = new TableRow(new TableRowProperties(new TableHeader()));
        foreach (var h in headers)
            headerRow.Append(new TableCell(
                new TableCellProperties(new Shading { Fill = BrandBlueHex, Val = ShadingPatternValues.Clear, Color = "auto" }),
                new Paragraph(new Run(new RunProperties(new Bold(), new Color { Val = "FFFFFF" }, new FontSize { Val = "19" }),
                    new Text(h) { Space = SpaceProcessingModeValues.Preserve }))));
        table.Append(headerRow);
        foreach (var r in rows)
        {
            var row = new TableRow();
            foreach (var c in r)
                row.Append(new TableCell(new TableCellProperties(),
                    new Paragraph(new Run(new RunProperties(new FontSize { Val = "19" }), new Text(c ?? "") { Space = SpaceProcessingModeValues.Preserve }))));
            table.Append(row);
        }
        body.Append(table);
    }

    private static TableCell LabelCell(string text) => new(
        new TableCellProperties(new Shading { Fill = "EEF3FB", Val = ShadingPatternValues.Clear, Color = "auto" }),
        new Paragraph(new Run(new RunProperties(new Bold(), new Color { Val = LabelHex }, new FontSize { Val = "19" }),
            new Text(text) { Space = SpaceProcessingModeValues.Preserve })));

    private static TableCell ValueCell(string text) => new(
        new TableCellProperties(),
        new Paragraph(new Run(new RunProperties(new FontSize { Val = "19" }),
            new Text(text ?? "") { Space = SpaceProcessingModeValues.Preserve })));

    private static TableProperties BaseTableProps() => new(
        new TableWidth { Width = "5000", Type = TableWidthUnitValues.Pct },
        new TableBorders(
            new TopBorder { Val = BorderValues.Single, Size = 2, Color = DividerHex },
            new BottomBorder { Val = BorderValues.Single, Size = 2, Color = DividerHex },
            new LeftBorder { Val = BorderValues.Single, Size = 2, Color = DividerHex },
            new RightBorder { Val = BorderValues.Single, Size = 2, Color = DividerHex },
            new InsideHorizontalBorder { Val = BorderValues.Single, Size = 2, Color = DividerHex },
            new InsideVerticalBorder { Val = BorderValues.Single, Size = 2, Color = DividerHex }),
        new TableLayout { Type = TableLayoutValues.Fixed });

    private static TableGrid BuildGrid(int columns)
    {
        var grid = new TableGrid();
        for (int i = 0; i < columns; i++) grid.Append(new GridColumn());
        return grid;
    }

    private static string? FirstNonEmpty(params string?[] vals)
    {
        foreach (var v in vals) if (!string.IsNullOrWhiteSpace(v)) return v;
        return null;
    }

    private static string Dash(string? v) => string.IsNullOrWhiteSpace(v) ? "-" : v!;

    private static string FormatDate(string ymd) =>
        DateTime.TryParse(ymd, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)
            ? d.ToString("dd MMM yyyy", CultureInfo.InvariantCulture) : ymd;

    private static string FormatDateTime(DateTime d) =>
        d.ToString("ddd, dd MMM yyyy hh:mm:ss tt", CultureInfo.InvariantCulture);

    private static SectionProperties SectionProps() => new(
        new PageSize { Width = 11906, Height = 16838 },
        new PageMargin { Top = 1080, Bottom = 1080, Left = 1080, Right = 1080, Header = 0, Footer = 0, Gutter = 0 });
}
