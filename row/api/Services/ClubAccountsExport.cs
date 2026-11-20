using System.Globalization;
using System.Text;
using ClosedXML.Excel;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace RotaryApi.Services;

/// <summary>Club accounts reports as CSV, Excel or PDF. A cell is a string, a decimal (money) or null.</summary>
public static class ClubAccountsExport
{
    public record Table(string Title, string Subtitle, string[] Headers, List<object?[]> Rows);

    public static (byte[] Bytes, string ContentType, string Extension) Render(Table t, string format) => format switch
    {
        "csv" => (Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(Csv(t))).ToArray(), "text/csv", "csv"),
        "xlsx" => (Xlsx(t), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"),
        "pdf" => (Pdf(t), "application/pdf", "pdf"),
        _ => throw new ClubAccountsService.AccountsException("Choose csv, xlsx or pdf."),
    };

    public static string Csv(Table t)
    {
        var sb = new StringBuilder();
        sb.AppendJoin(',', t.Headers.Select(Quote)).Append("\r\n");
        foreach (var r in t.Rows) sb.AppendJoin(',', r.Select(Cell)).Append("\r\n");
        return sb.ToString();
    }

    private static string Cell(object? v) => v switch
    {
        null => "",
        decimal d => d.ToString("0.00", CultureInfo.InvariantCulture), // numbers stay numbers, never quoted or prefixed
        _ => Quote(v.ToString()),
    };

    // A text cell starting with = + - @ is prefixed with ' so a spreadsheet never runs it as a formula.
    private static string Quote(string? v)
    {
        v ??= "";
        if (v.Length > 0 && "=+-@\t\r".Contains(v[0])) v = "'" + v;
        return "\"" + v.Replace("\"", "\"\"") + "\"";
    }

    private static byte[] Xlsx(Table t)
    {
        using var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add("Report");
        ws.Cell(1, 1).Value = t.Title;
        ws.Cell(1, 1).Style.Font.Bold = true;
        ws.Cell(2, 1).Value = t.Subtitle;
        for (var i = 0; i < t.Headers.Length; i++)
        {
            ws.Cell(4, i + 1).Value = t.Headers[i];
            ws.Cell(4, i + 1).Style.Font.Bold = true;
        }
        for (var r = 0; r < t.Rows.Count; r++)
            for (var col = 0; col < t.Rows[r].Length; col++)
            {
                var cell = ws.Cell(r + 5, col + 1);
                switch (t.Rows[r][col])
                {
                    case decimal d: cell.Value = d; cell.Style.NumberFormat.Format = "#,##0.00"; break;
                    case null: break;
                    case var v: cell.SetValue(v.ToString()); break; // SetValue as text: never parsed as a formula
                }
            }
        ws.Columns().AdjustToContents();
        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }

    private static byte[] Pdf(Table t)
    {
        QuestPDF.Settings.License = LicenseType.Community;
        QuestPDF.Settings.CheckIfAllTextGlyphsAreAvailable = false; // same opt-out as DuesReceiptPdfBuilder
        var numeric = Enumerable.Range(0, t.Headers.Length).Select(i => t.Rows.Any(r => r[i] is decimal)).ToArray();
        return Document.Create(doc => doc.Page(page =>
        {
            page.Size(PageSizes.A4);
            page.Margin(1.4f, Unit.Centimetre);
            page.DefaultTextStyle(x => x.FontSize(9).FontColor("#1B2C42"));
            page.Header().Column(col =>
            {
                col.Item().Text(t.Title).FontSize(15).Bold().FontColor("#17458F");
                col.Item().Text(t.Subtitle).FontColor("#64748B");
            });
            page.Content().PaddingTop(10).Table(table =>
            {
                table.ColumnsDefinition(cd => { foreach (var n in numeric) { if (n) cd.ConstantColumn(80); else cd.RelativeColumn(); } });
                table.Header(h =>
                {
                    for (var i = 0; i < t.Headers.Length; i++)
                    {
                        var c = h.Cell().Background("#EDF4FB").BorderBottom(1).BorderColor("#D5DEE8").Padding(4);
                        (numeric[i] ? c.AlignRight() : c).Text(t.Headers[i]).Bold();
                    }
                });
                foreach (var row in t.Rows)
                {
                    var bold = row.Length > 0 && row[0] is string s && s.StartsWith("Total", StringComparison.Ordinal);
                    for (var i = 0; i < row.Length; i++)
                    {
                        var c = table.Cell().BorderBottom(0.5f).BorderColor("#D5DEE8").Padding(4);
                        var text = row[i] is decimal d ? d.ToString("#,##0.00", CultureInfo.InvariantCulture) : row[i]?.ToString() ?? "";
                        var span = (numeric[i] ? c.AlignRight() : c).Text(text);
                        if (bold) span.Bold();
                    }
                }
            });
            page.Footer().AlignRight().Text(x => { x.Span("Page "); x.CurrentPageNumber(); x.Span(" of "); x.TotalPages(); });
        })).GeneratePdf();
    }
}
