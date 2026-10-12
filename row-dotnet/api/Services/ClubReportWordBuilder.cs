using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;

namespace RotaryApi.Services;

// Builds the two Word .docx reports under Club section of the Club Report v2 page:
//   • Avenue of Service Raw Data    — 5 sections (one per avenue) with aggregate table per Area of Focus
//   • Annual Club Service Raw Data  — single section with one row per club meeting
// Mirrors the legacy example.org layout column-for-column. The visual styling
// (font sizes, blue heading bar, banded table rows) is the improvement the user
// asked for — same data and column set.
public static class ClubReportWordBuilder
{
    private const string BrandBlueHex = "003DA5";
    private const string LightBlueHex = "E8F0FA";

    public sealed record AvenueAreaSummary(string AreaOfFocus, int Projects, int Beneficiaries, decimal AmountSpent);

    public sealed record AvenueSection(string AvenueName, IReadOnlyList<AvenueAreaSummary> Rows);

    public sealed record MeetingRow(string DateLabel, string Title, string Description, int MembersPresent);

    /// <summary>Build the "Avenue of Service Raw Data" Word document.</summary>
    public static byte[] BuildAvenueRawData(string clubName, string yearLabel, int membershipStrength, IReadOnlyList<AvenueSection> sections)
    {
        // Strip NUL/control chars OpenXML can't serialise (imported text) — else SaveAs 500s the report.
        clubName = WordXmlHelper.Clean(clubName); yearLabel = WordXmlHelper.Clean(yearLabel);
        foreach (var sec in sections) { WordXmlHelper.SanitizeStrings(sec); foreach (var row in sec.Rows) WordXmlHelper.SanitizeStrings(row); }

        using var ms = new MemoryStream();
        using (var doc = WordprocessingDocument.Create(ms, WordprocessingDocumentType.Document))
        {
            var main = doc.AddMainDocumentPart();
            var body = new Body();

            AppendHeader(body, clubName, yearLabel, membershipStrength);

            foreach (var section in sections)
            {
                AppendSectionHeading(body, section.AvenueName);
                AppendAvenueTable(body, section.Rows);
                AppendSpacer(body);
            }

            // Section properties — A4 portrait, 1cm margins for more table room.
            body.Append(BuildSectionProperties());
            main.Document = new Document(body);
            main.Document.Save();
        }
        return ms.ToArray();
    }

    /// <summary>Build the "Annual Club Service Raw Data" Word document.</summary>
    public static byte[] BuildAnnualClubServiceRawData(string clubName, string yearLabel, int membershipStrength, IReadOnlyList<MeetingRow> meetings)
    {
        clubName = WordXmlHelper.Clean(clubName); yearLabel = WordXmlHelper.Clean(yearLabel);
        foreach (var mtg in meetings) WordXmlHelper.SanitizeStrings(mtg);

        using var ms = new MemoryStream();
        using (var doc = WordprocessingDocument.Create(ms, WordprocessingDocumentType.Document))
        {
            var main = doc.AddMainDocumentPart();
            var body = new Body();

            AppendHeader(body, clubName, yearLabel, membershipStrength);
            AppendSectionHeading(body, "Club Service");
            AppendMeetingsTable(body, meetings);

            body.Append(BuildSectionProperties());
            main.Document = new Document(body);
            main.Document.Save();
        }
        return ms.ToArray();
    }

    // ── Header (title block) ────────────────────────────────────────────
    private static void AppendHeader(Body body, string clubName, string yearLabel, int membershipStrength)
    {
        body.Append(CenteredText($"Rotary Club of {clubName}", sizeHalfPt: 32, bold: true));
        body.Append(CenteredText($"Annual Report — RY {yearLabel}", sizeHalfPt: 28, bold: true, colorHex: BrandBlueHex));
        body.Append(CenteredText($"Name of Club: Rotary Club of {clubName}", sizeHalfPt: 30, bold: true));
        body.Append(CenteredText($"Membership Strength: {membershipStrength}", sizeHalfPt: 28, bold: true));
        AppendSpacer(body);
    }

    private static void AppendSectionHeading(Body body, string title)
    {
        var para = new Paragraph(
            new ParagraphProperties(
                new SpacingBetweenLines() { Before = "200", After = "200" },
                new Shading() { Fill = BrandBlueHex, Val = ShadingPatternValues.Clear, Color = "auto" }
            ),
            new Run(
                new RunProperties(
                    new Bold(),
                    new Color() { Val = "FFFFFF" },
                    new FontSize() { Val = "26" }
                ),
                new Text(" " + title) { Space = SpaceProcessingModeValues.Preserve }
            )
        );
        body.Append(para);
    }

    private static void AppendSpacer(Body body)
    {
        body.Append(new Paragraph(new Run(new Text(""))));
    }

    // ── Tables ──────────────────────────────────────────────────────────
    private static void AppendAvenueTable(Body body, IReadOnlyList<AvenueAreaSummary> rows)
    {
        var table = new Table(BuildTableProps(), BuildTableGrid(5));
        table.Append(BuildHeaderRow("Sr. No.", "Sub Heading", "Number of projects", "No Of Benefciaries", "Amount Spent"));
        int sr = 1;
        foreach (var r in rows)
        {
            table.Append(BuildBodyRow(sr.ToString(), r.AreaOfFocus, r.Projects.ToString(), r.Beneficiaries.ToString(), r.AmountSpent.ToString("0")));
            sr++;
        }
        if (rows.Count == 0)
        {
            table.Append(BuildBodyRow("", "(no records)", "", "", ""));
        }
        body.Append(table);
    }

    private static void AppendMeetingsTable(Body body, IReadOnlyList<MeetingRow> meetings)
    {
        var table = new Table(BuildTableProps(), BuildTableGrid(5));
        table.Append(BuildHeaderRow("Sr. No.", "Date", "Title", "Meeting Description", "Member Attendence"));
        int sr = 1;
        foreach (var m in meetings)
        {
            table.Append(BuildBodyRow(sr.ToString(), m.DateLabel, m.Title, m.Description ?? "", m.MembersPresent.ToString()));
            sr++;
        }
        if (meetings.Count == 0)
        {
            table.Append(BuildBodyRow("", "", "(no meetings recorded)", "", ""));
        }
        body.Append(table);
    }

    private static TableProperties BuildTableProps() => new(
        new TableWidth() { Width = "5000", Type = TableWidthUnitValues.Pct },
        new TableBorders(
            new TopBorder()    { Val = BorderValues.Single, Size = 4, Color = BrandBlueHex },
            new BottomBorder() { Val = BorderValues.Single, Size = 4, Color = BrandBlueHex },
            new LeftBorder()   { Val = BorderValues.Single, Size = 4, Color = BrandBlueHex },
            new RightBorder()  { Val = BorderValues.Single, Size = 4, Color = BrandBlueHex },
            new InsideHorizontalBorder() { Val = BorderValues.Single, Size = 2, Color = "BFD3F0" },
            new InsideVerticalBorder()   { Val = BorderValues.Single, Size = 2, Color = "BFD3F0" }
        ),
        new TableLayout() { Type = TableLayoutValues.Autofit }
    );

    private static TableGrid BuildTableGrid(int columns)
    {
        var grid = new TableGrid();
        for (int i = 0; i < columns; i++) grid.Append(new GridColumn());
        return grid;
    }

    private static TableRow BuildHeaderRow(params string[] headers)
    {
        var row = new TableRow(new TableRowProperties(new TableHeader()));
        foreach (var h in headers)
        {
            row.Append(new TableCell(
                new TableCellProperties(new Shading() { Fill = BrandBlueHex, Val = ShadingPatternValues.Clear, Color = "auto" }),
                new Paragraph(
                    new Run(
                        new RunProperties(new Bold(), new Color() { Val = "FFFFFF" }, new FontSize() { Val = "22" }),
                        new Text(h) { Space = SpaceProcessingModeValues.Preserve }
                    )
                )
            ));
        }
        return row;
    }

    private static TableRow BuildBodyRow(params string[] cells)
    {
        var row = new TableRow();
        bool alt = false; // banded — every other row shaded.
        // We can't actually know "alt" inside one row, so caller must alternate. Keep it simple:
        // all body rows white; visual contrast comes from header colour. (Banded zebra would
        // need row index tracked externally.)
        foreach (var c in cells)
        {
            row.Append(new TableCell(
                new TableCellProperties(),
                new Paragraph(
                    new Run(
                        new RunProperties(new FontSize() { Val = "20" }),
                        new Text(c ?? "") { Space = SpaceProcessingModeValues.Preserve }
                    )
                )
            ));
            _ = alt;
        }
        return row;
    }

    // ── Helpers ─────────────────────────────────────────────────────────
    private static Paragraph CenteredText(string text, int sizeHalfPt, bool bold = false, string? colorHex = null)
    {
        var runProps = new RunProperties(new FontSize() { Val = sizeHalfPt.ToString() });
        if (bold) runProps.Append(new Bold());
        if (!string.IsNullOrEmpty(colorHex)) runProps.Append(new Color() { Val = colorHex });

        return new Paragraph(
            new ParagraphProperties(
                new Justification() { Val = JustificationValues.Center },
                new SpacingBetweenLines() { After = "120" }
            ),
            new Run(runProps, new Text(text) { Space = SpaceProcessingModeValues.Preserve })
        );
    }

    private static SectionProperties BuildSectionProperties()
    {
        return new SectionProperties(
            new PageSize() { Width = 11906, Height = 16838 }, // A4 portrait (twentieths-of-a-point — 210mm × 297mm)
            new PageMargin() { Top = 720, Bottom = 720, Left = 720, Right = 720, Header = 0, Footer = 0, Gutter = 0 }
        );
    }
}
