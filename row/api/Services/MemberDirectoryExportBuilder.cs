using System.Globalization;
using ClosedXML.Excel;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;
using RotaryApi.DTOs;
using RotaryApi.Services.Localization;

namespace RotaryApi.Services;

/// <summary>
/// Club member directory as an Excel sheet or a printable PDF (GET api/clubs/{id}/members/export).
/// Rows arrive already filtered by each member's privacy flags, so a hidden phone or email stays blank here too.
/// </summary>
public static class MemberDirectoryExportBuilder
{
    private const string Brand = "#17458F";
    private const string Muted = "#64748B";
    private const string Divider = "#D5DEE8";

    private static string T(string english) => DbStringLocalizer.Instance[english];

    private static string Date(DateTime? d) => d?.ToString("d MMM yyyy", CultureInfo.InvariantCulture) ?? "";

    /// <summary>Header row and one row of cells per member, shared by both formats so they never drift.</summary>
    public static readonly string[] Columns =
        { "No.", "Name", "Rotary ID", "Classification", "Club roles", "Email", "Mobile", "Joined", "Honorary", "Status" };

    public static IReadOnlyList<string[]> Rows(IEnumerable<ClubMemberDto> members) =>
        members
            .OrderBy(m => m.MemberName, StringComparer.OrdinalIgnoreCase)
            .Select((m, i) => new[]
            {
                (i + 1).ToString(CultureInfo.InvariantCulture),
                m.MemberName,
                m.RotaryId ?? "",
                m.ClassificationProfession ?? "",
                // "Member" is every row's base role: leaving it out lets the real roles stand out.
                string.Join(", ", m.Roles.Append(m.Designation ?? "")
                    .Where(s => !string.IsNullOrWhiteSpace(s) && !s.Equals("Member", StringComparison.OrdinalIgnoreCase)).Distinct()),
                m.EmailId ?? "",
                m.PrimaryMobileNumber ?? "",
                Date(m.JoinedDate),
                m.IsHonorary ? T("Yes") : T("No"),
                m.MembershipActive ? T("Active") : T("Inactive"),
            })
            .ToList();

    public static byte[] BuildExcel(string clubName, IEnumerable<ClubMemberDto> members)
    {
        var rows = Rows(members);
        using var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add(T("Members"));

        ws.Cell(1, 1).Value = clubName;
        ws.Cell(1, 1).Style.Font.SetBold().Font.SetFontSize(14);
        ws.Cell(2, 1).Value = $"{T("Member directory")} · {DateTime.UtcNow.ToString("d MMM yyyy", CultureInfo.InvariantCulture)} · {rows.Count} {T("members")}";
        ws.Cell(2, 1).Style.Font.SetFontColor(XLColor.FromHtml(Muted));

        const int headerRow = 4;
        for (int c = 0; c < Columns.Length; c++) ws.Cell(headerRow, c + 1).Value = T(Columns[c]);
        var header = ws.Range(headerRow, 1, headerRow, Columns.Length);
        header.Style.Font.SetBold().Font.SetFontColor(XLColor.White).Fill.SetBackgroundColor(XLColor.FromHtml(Brand));

        for (int r = 0; r < rows.Count; r++)
            for (int c = 0; c < Columns.Length; c++)
                // Text cells: phone numbers and Rotary IDs keep their leading zeros and plus signs.
                ws.Cell(headerRow + 1 + r, c + 1).SetValue(rows[r][c]);

        if (rows.Count > 0) ws.Range(headerRow, 1, headerRow + rows.Count, Columns.Length).SetAutoFilter();
        ws.SheetView.FreezeRows(headerRow);
        ws.Columns().AdjustToContents(headerRow, headerRow + rows.Count, 8, 48);

        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }

    public static byte[] BuildPdf(string clubName, IEnumerable<ClubMemberDto> members)
    {
        QuestPDF.Settings.License = LicenseType.Community;
        var rows = Rows(members);
        var generated = DateTime.UtcNow.ToString("d MMM yyyy", CultureInfo.InvariantCulture);

        return Document.Create(doc => doc.Page(page =>
        {
            page.Size(PageSizes.A4.Landscape());
            page.Margin(28);
            page.DefaultTextStyle(t => t.FontSize(9).FontColor("#1B2C42"));

            page.Header().PaddingBottom(10).Column(col =>
            {
                col.Item().Text(clubName).FontSize(16).Bold().FontColor(Brand);
                col.Item().Text($"{T("Member directory")} · {generated} · {rows.Count} {T("members")}").FontColor(Muted);
            });

            page.Content().Table(table =>
            {
                table.ColumnsDefinition(c =>
                {
                    c.ConstantColumn(28);   // No.
                    c.RelativeColumn(3);    // Name + classification
                    c.RelativeColumn(2);    // Rotary ID
                    c.RelativeColumn(3);    // Club roles
                    c.RelativeColumn(4);    // Email
                    c.RelativeColumn(2.5f); // Mobile
                    c.RelativeColumn(2);    // Joined
                });

                table.Header(h =>
                {
                    foreach (var label in new[] { "No.", "Name", "Rotary ID", "Club roles", "Email", "Mobile", "Joined" })
                        h.Cell().BorderBottom(1).BorderColor(Brand).PaddingVertical(4).Text(T(label)).Bold().FontColor(Brand);
                });

                foreach (var r in rows)
                {
                    IContainer Cell(IContainer c) => c.BorderBottom(0.5f).BorderColor(Divider).PaddingVertical(4).PaddingRight(4);
                    table.Cell().Element(Cell).Text(r[0]).FontColor(Muted);
                    table.Cell().Element(Cell).Column(c =>
                    {
                        c.Item().Text(r[1]).Bold();
                        if (r[3].Length > 0) c.Item().Text(r[3]).FontColor(Muted).FontSize(8);
                    });
                    table.Cell().Element(Cell).Text(r[2]);
                    table.Cell().Element(Cell).Text(r[4]);
                    table.Cell().Element(Cell).Text(r[5]);
                    table.Cell().Element(Cell).Text(r[6]);
                    table.Cell().Element(Cell).Text(r[7]);
                }
            });

            page.Footer().AlignRight().Text(t =>
            {
                t.DefaultTextStyle(s => s.FontColor(Muted).FontSize(8));
                t.CurrentPageNumber();
                t.Span(" / ");
                t.TotalPages();
            });
        })).GeneratePdf();
    }
}
