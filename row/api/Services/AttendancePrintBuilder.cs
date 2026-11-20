using System.Text;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace RotaryApi.Services;

/// <summary>
/// Attendance printables (gap #5 extras, 2026-11-20): the sign-in sheet of one meeting and the rule of 85 report
/// (PDF and CSV). Same look as DuesReceiptPdfBuilder: navy band with the ROW logo, hairline tables.
/// </summary>
public static class AttendancePrintBuilder
{
    private const string Navy = "#17458F", Ink = "#1B2C42", Border = "#D5DEE8", HeadBg = "#EDF4FB", Muted = "#64748B";

    private static void License()
    {
        QuestPDF.Settings.License = LicenseType.Community;
        // Member names in any script: never 500 on a glyph the server font lacks (as DuesReceiptPdfBuilder).
        QuestPDF.Settings.CheckIfAllTextGlyphsAreAvailable = false;
    }

    private static byte[] Page(string clubName, string title, string subtitle, Action<ColumnDescriptor> body)
    {
        License();
        return Document.Create(doc => doc.Page(page =>
        {
            page.Size(PageSizes.A4);
            page.Margin(1.4f, Unit.Centimetre);
            page.DefaultTextStyle(x => x.FontFamily("Arial", "Segoe UI", "Nirmala UI").FontSize(10).FontColor(Ink));
            var logo = BrandAssets.PdfLogoOnDark;
            page.Header().Background(Navy).PaddingVertical(10).PaddingHorizontal(20).Row(r =>
            {
                if (logo != null) r.ConstantItem(90).Height(36).Image(logo).FitHeight();
                r.RelativeItem().AlignRight().AlignMiddle().Text(clubName).FontColor(Colors.White).Bold().FontSize(13);
            });
            page.Content().PaddingTop(14).Column(col =>
            {
                col.Spacing(6);
                col.Item().Text(title).Bold().FontSize(16).FontColor(Navy);
                col.Item().Text(subtitle).FontColor(Muted);
                body(col);
            });
            page.Footer().AlignCenter().Text(t =>
            {
                t.DefaultTextStyle(x => x.FontSize(8).FontColor(Muted));
                t.Span("Page ");
                t.CurrentPageNumber();
                t.Span(" of ");
                t.TotalPages();
            });
        })).GeneratePdf();
    }

    private static IContainer Head(IContainer c) => c.Background(HeadBg).Border(0.7f).BorderColor(Border).Padding(5);
    private static IContainer Cell(IContainer c) => c.Border(0.7f).BorderColor(Border).PaddingHorizontal(5).PaddingVertical(4);

    public static byte[] SignInSheet(string clubName, string meetingName, DateTime meetingAt, IReadOnlyList<string> names)
        => Page(clubName, "Attendance sign-in sheet", $"{meetingName}, {meetingAt:dd MMM yyyy}", col =>
        {
            col.Item().PaddingTop(6).Table(t =>
            {
                t.ColumnsDefinition(c => { c.ConstantColumn(34); c.RelativeColumn(3); c.RelativeColumn(2); });
                t.Header(h =>
                {
                    h.Cell().Element(Head).Text("No.").Bold();
                    h.Cell().Element(Head).Text("Member").Bold();
                    h.Cell().Element(Head).Text("Signature").Bold();
                });
                var i = 0;
                foreach (var n in names)
                {
                    t.Cell().Element(Cell).Height(24).AlignMiddle().Text((++i).ToString());
                    t.Cell().Element(Cell).Height(24).AlignMiddle().Text(n);
                    t.Cell().Element(Cell).Height(24).Text("");
                }
                // Blank rows for guests and visiting Rotarians.
                for (var g = 0; g < 5; g++)
                    for (var k = 0; k < 3; k++) t.Cell().Element(Cell).Height(24).Text("");
            });
            col.Item().PaddingTop(4).Text("Visitors and guests: use the blank rows.").FontColor(Muted).FontSize(9);
        });

    public static byte[] Rule85Pdf(string clubName, IReadOnlyList<AttendanceStandingService.Rule85Row> rows, DateOnly asOf)
        => Page(clubName, "Rule of 85 report", $"Members whose age plus years of membership is 85 or more, as of {asOf:dd MMM yyyy}", col =>
        {
            if (rows.Count == 0) { col.Item().PaddingTop(8).Text("No member qualifies at present."); return; }
            col.Item().PaddingTop(6).Table(t =>
            {
                t.ColumnsDefinition(c => { c.RelativeColumn(3); c.RelativeColumn(); c.RelativeColumn(); c.RelativeColumn(); c.RelativeColumn(1.4f); });
                t.Header(h =>
                {
                    foreach (var x in new[] { "Member", "Age", "Years a member", "Total", "Exempt" }) h.Cell().Element(Head).Text(x).Bold();
                });
                foreach (var r in rows)
                {
                    t.Cell().Element(Cell).Text(r.MemberName);
                    t.Cell().Element(Cell).Text(r.Age.ToString());
                    t.Cell().Element(Cell).Text(r.Years.ToString());
                    t.Cell().Element(Cell).Text((r.Age + r.Years).ToString());
                    t.Cell().Element(Cell).Text(r.Exempt ? "Yes" : "Not yet");
                }
            });
            col.Item().PaddingTop(4).Text("The board grants the exemption when the member asks for it in writing.").FontColor(Muted).FontSize(9);
        });

    public static string Rule85Csv(IReadOnlyList<AttendanceStandingService.Rule85Row> rows)
    {
        var sb = new StringBuilder("Member,Age,Years a member,Total,Exempt\r\n");
        foreach (var r in rows)
            sb.Append(CsvField(r.MemberName)).Append(',').Append(r.Age).Append(',').Append(r.Years).Append(',')
              .Append(r.Age + r.Years).Append(',').Append(r.Exempt ? "Yes" : "No").Append("\r\n");
        return sb.ToString();
    }

    /// <summary>Quotes a CSV field and defuses spreadsheet formulas (a leading = + - @ runs as a formula in Excel).</summary>
    public static string CsvField(string value)
    {
        if (value.Length > 0 && "=+-@\t\r".Contains(value[0])) value = "'" + value;
        return "\"" + value.Replace("\"", "\"\"") + "\"";
    }
}
