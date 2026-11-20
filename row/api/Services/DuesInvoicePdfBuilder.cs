using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace RotaryApi.Services;

// Printable dues invoice and member statement (gap #7). Same look as DuesReceiptPdfBuilder: navy header band with
// the ROW logo built into the API, bordered tables, muted footer.
public static class DuesInvoicePdfBuilder
{
    private const string Navy = "#17458F";
    private const string Ink = "#1B2C42";
    private const string Border = "#D5DEE8";
    private const string HeadBg = "#EDF4FB";
    private const string FootBg = "#F7F9FC";
    private const string Muted = "#64748B";

    private static string D(DateTime d) => d.ToString("dd MMM yyyy", System.Globalization.CultureInfo.InvariantCulture);
    private static string M(decimal v) => Brand.Money(v);

    public static string StatusLabel(string status) => status switch
    {
        DuesInvoiceMath.PartPaid => "Part paid",
        DuesInvoiceMath.Paid => "Paid",
        DuesInvoiceMath.Voided => "Void",
        _ => "Open",
    };

    public static byte[] Invoice(DuesInvoiceService.InvoiceRow inv, IReadOnlyList<DuesInvoiceService.InvoiceLine> lines, DuesInvoiceService.ClubInfo club) =>
        Page(club.ClubName, col =>
        {
            col.Item().Text("Invoice").Bold().FontSize(16).FontColor(Navy);
            Meta(col, new (string, string?)[]
            {
                ("Invoice No", inv.InvoiceNo), ("Billed To", inv.MemberName), ("Club Name", club.ClubName),
                ("District Number", club.DistrictNumber), ("Issue Date", D(inv.IssueDate)), ("Due Date", D(inv.DueDate)),
                ("Status", StatusLabel(inv.Status)), ("Notes", inv.Notes), ("Void Reason", inv.Status == DuesInvoiceMath.Voided ? inv.VoidReason : null),
            });
            col.Item().PaddingTop(10).Text("Items").Bold().FontSize(12).FontColor(Navy);
            Table(col, new[] { ("Sr No", 34f, false), ("Description", 0f, false), ("Qty", 50f, true), ("Unit Amount", 90f, true), ("Amount", 90f, true) },
                lines.Select((l, i) => new[] { (i + 1).ToString(), l.Description, l.Quantity.ToString("0.##"), M(l.UnitAmount), M(l.Amount) }));
            col.Item().PaddingTop(8).AlignRight().Width(240).Table(t =>
            {
                t.ColumnsDefinition(c => { c.RelativeColumn(); c.RelativeColumn(); });
                void Row(string label, string value, bool bold = false)
                {
                    t.Cell().Border(0.7f).BorderColor(Border).Padding(5).Text(label).Bold();
                    var v = t.Cell().Border(0.7f).BorderColor(Border).Padding(5).AlignRight().Text(value);
                    if (bold) v.Bold();
                }
                Row("Total", M(inv.Amount));
                Row("Paid", M(inv.PaidAmount));
                Row("Balance Due", M(inv.Status == DuesInvoiceMath.Voided ? 0 : inv.Amount - inv.PaidAmount), bold: true);
            });
        });

    public static byte[] Statement(string memberName, DuesInvoiceService.ClubInfo? club, DateTime from, DateTime to, DuesInvoiceMath.Statement s) =>
        Page(club?.ClubName ?? Brand.ProductName, col =>
        {
            col.Item().Text("Member Statement").Bold().FontSize(16).FontColor(Navy);
            Meta(col, new (string, string?)[]
            {
                ("Member Name", memberName), ("Club Name", club?.ClubName ?? "All clubs"), ("District Number", club?.DistrictNumber),
                ("Period", $"{D(from)} to {D(to)}"), ("Opening Balance", M(s.Opening)), ("Charges", M(s.Charges)),
                ("Payments", M(s.Payments)), ("Closing Balance", M(s.Closing)),
            });
            col.Item().PaddingTop(10).Text("Activity").Bold().FontSize(12).FontColor(Navy);
            var rows = new List<string[]> { new[] { D(from), "", "Opening balance", "", "", M(s.Opening) } };
            rows.AddRange(s.Rows.Select(r => new[]
            {
                D(r.Line.Date), r.Line.Reference, r.Line.Description,
                r.Line.IsCharge ? M(r.Line.Amount) : "", r.Line.IsCharge ? "" : M(r.Line.Amount), M(r.Balance),
            }));
            Table(col, new[] { ("Date", 70f, false), ("Reference", 90f, false), ("Description", 0f, false), ("Charge", 70f, true), ("Payment", 70f, true), ("Balance", 75f, true) }, rows);
            col.Item().PaddingTop(6).Text("A positive balance is owed to the club; a negative balance is a credit.").FontSize(8).FontColor(Muted);
        });

    private static void Meta(ColumnDescriptor col, IEnumerable<(string Label, string? Value)> rows) =>
        col.Item().PaddingTop(8).Table(t =>
        {
            t.ColumnsDefinition(c => { c.ConstantColumn(150); c.RelativeColumn(); });
            foreach (var (label, value) in rows.Where(r => !string.IsNullOrWhiteSpace(r.Value)))
            {
                t.Cell().Border(0.7f).BorderColor(Border).Padding(6).Text(label).Bold();
                t.Cell().Border(0.7f).BorderColor(Border).Padding(6).Text(value);
            }
        });

    // width 0 = relative column.
    private static void Table(ColumnDescriptor col, (string Head, float Width, bool Right)[] cols, IEnumerable<string[]> rows) =>
        col.Item().Table(t =>
        {
            t.ColumnsDefinition(c => { foreach (var x in cols) { if (x.Width > 0) c.ConstantColumn(x.Width); else c.RelativeColumn(); } });
            foreach (var x in cols)
            {
                var cell = t.Cell().Background(HeadBg).Border(0.7f).BorderColor(Border).Padding(5);
                (x.Right ? cell.AlignRight() : cell).Text(x.Head).Bold().FontSize(8.5f);
            }
            foreach (var r in rows)
                for (var i = 0; i < cols.Length; i++)
                {
                    var cell = t.Cell().Border(0.7f).BorderColor(Border).Padding(5);
                    (cols[i].Right ? cell.AlignRight() : cell).Text(r[i]).FontSize(8.5f);
                }
        });

    private static byte[] Page(string organisation, Action<ColumnDescriptor> content)
    {
        QuestPDF.Settings.License = LicenseType.Community;
        // Same opt-out as DuesReceiptPdfBuilder: a currency sign the server font lacks must not become a 500.
        QuestPDF.Settings.CheckIfAllTextGlyphsAreAvailable = false;
        return Document.Create(doc => doc.Page(page =>
        {
            page.Size(PageSizes.A4);
            page.Margin(1.4f, Unit.Centimetre);
            page.DefaultTextStyle(x => x.FontFamily("Arial", "Segoe UI", "Nirmala UI").FontSize(10).FontColor(Ink).LineHeight(1.35f));
            var logo = BrandAssets.PdfLogoOnDark;
            page.Header().Background(Navy).PaddingVertical(12).PaddingHorizontal(20).Column(h =>
            {
                h.Spacing(6);
                if (logo != null) h.Item().AlignCenter().Height(48).Image(logo).FitHeight();
                h.Item().AlignCenter().Text(organisation).FontColor(Colors.White).Bold().FontSize(15);
            });
            page.Content().PaddingTop(16).Column(col =>
            {
                col.Spacing(6);
                content(col);
                col.Item().PaddingTop(10).Text($"Generated on {D(DateTime.UtcNow)} (UTC)").FontSize(8).FontColor(Muted);
            });
            page.Footer().Background(FootBg).PaddingVertical(9).PaddingHorizontal(16).AlignCenter().Text(t =>
            {
                t.DefaultTextStyle(s => s.FontSize(8).FontColor(Muted).Italic());
                t.Span("This is generated by ");
                t.Span(organisation).Bold();
            });
        })).GeneratePdf();
    }
}
