using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace RotaryApi.Services;

/// <summary>One person on a printed sheet. Address lines are empty when the member has no postal address.</summary>
public sealed record PrintMember(string Name, string? Classification, string? Roles, IReadOnlyList<string> AddressLines);

/// <summary>
/// Printable club outputs (GET api/clubs/{id}/members/print): Avery-sized mailing labels, name badges and folded table
/// tents. Sheet geometry follows the Avery templates named below, so the PDF prints straight onto the label stock at 100%.
/// </summary>
public static class MemberPrintBuilder
{
    private const string Brand = "#17458F";
    private const string Muted = "#64748B";
    private const float Mm = 2.8346f; // points per millimetre

    /// <summary>Label sheet: page, columns, rows, label size, margins and gaps, all in millimetres.</summary>
    public sealed record Sheet(PageSize Page, int Cols, int Rows, float W, float H, float Top, float Left, float GapX, float GapY);

    // Avery L7160 (A4, 21 labels 63.5 x 38.1 mm) and Avery 5160 (US Letter, 30 labels 66.7 x 25.4 mm).
    public static readonly Sheet LabelsA4 = new(PageSizes.A4, 3, 7, 63.5f, 38.1f, 15.15f, 7.25f, 2.5f, 0f);
    public static readonly Sheet LabelsLetter = new(PageSizes.Letter, 3, 10, 66.7f, 25.4f, 12.7f, 4.8f, 3.2f, 0f);
    // Avery L7418 (A4, 8 badges 86 x 55 mm) and Avery 5395 (US Letter, 8 badges 85.7 x 59.3 mm).
    public static readonly Sheet BadgesA4 = new(PageSizes.A4, 2, 4, 86f, 55f, 26f, 15.5f, 7f, 7.5f);
    public static readonly Sheet BadgesLetter = new(PageSizes.Letter, 2, 4, 85.7f, 59.3f, 15.9f, 17.5f, 9.5f, 4.8f);

    private static void License() => QuestPDF.Settings.License = LicenseType.Community;

    /// <summary>Lays items out across sheets of fixed-size cells, left to right, top to bottom.</summary>
    private static byte[] Grid<T>(Sheet s, IReadOnlyList<T> items, Action<IContainer, T> draw)
    {
        License();
        var perPage = s.Cols * s.Rows;
        return Document.Create(doc =>
        {
            for (int start = 0; start == 0 || start < items.Count; start += perPage)
            {
                var pageItems = items.Skip(start).Take(perPage).ToList();
                doc.Page(page =>
                {
                    page.Size(s.Page);
                    page.MarginTop(s.Top * Mm);
                    page.MarginLeft(s.Left * Mm);
                    page.MarginRight(0);
                    page.MarginBottom(0);
                    page.Content().Column(col =>
                    {
                        col.Spacing(s.GapY * Mm);
                        for (int r = 0; r < s.Rows; r++)
                        {
                            var rowItems = pageItems.Skip(r * s.Cols).Take(s.Cols).ToList();
                            if (rowItems.Count == 0) break;
                            col.Item().Row(row =>
                            {
                                row.Spacing(s.GapX * Mm);
                                foreach (var it in rowItems)
                                    row.ConstantItem(s.W * Mm).Height(s.H * Mm).Element(c => draw(c, it));
                            });
                        }
                    });
                });
                if (items.Count == 0) break;
            }
        }).GeneratePdf();
    }

    public static byte[] Labels(IReadOnlyList<PrintMember> members, bool letter) =>
        Grid(letter ? LabelsLetter : LabelsA4, members.Where(m => m.AddressLines.Count > 0).ToList(), (c, m) =>
            // ScaleToFit: a long address shrinks inside its label instead of overflowing it, which would push the
            // rest of the sheet onto the next page and break the alignment with the label stock.
            c.Padding(2.5f * Mm).AlignMiddle().ScaleToFit().Column(col =>
            {
                col.Item().Text(m.Name).FontSize(10).Bold();
                foreach (var line in m.AddressLines) col.Item().Text(line).FontSize(9);
            }));

    public static byte[] Badges(IReadOnlyList<PrintMember> members, string clubName, bool letter) =>
        Grid(letter ? BadgesLetter : BadgesA4, members, (c, m) =>
            c.Border(0.5f).BorderColor("#D5DEE8").Column(col =>
            {
                col.Item().Background(Brand).PaddingVertical(4).PaddingHorizontal(8)
                    .Text(clubName).FontSize(9).Bold().FontColor(Colors.White);
                col.Item().ExtendVertical().AlignMiddle().AlignCenter().PaddingHorizontal(8).ScaleToFit().Column(inner =>
                {
                    inner.Item().AlignCenter().Text(m.Name).FontSize(18).Bold().FontColor("#1B2C42");
                    if (!string.IsNullOrWhiteSpace(m.Roles))
                        inner.Item().AlignCenter().Text(m.Roles).FontSize(10).FontColor(Brand);
                    if (!string.IsNullOrWhiteSpace(m.Classification))
                        inner.Item().AlignCenter().Text(m.Classification).FontSize(9).FontColor(Muted);
                });
            }));

    /// <summary>One A4/Letter landscape page per member, folded across the middle: the top half is printed upside
    /// down so the name reads correctly from both sides of the table.</summary>
    public static byte[] TableTents(IReadOnlyList<PrintMember> members, string clubName, bool letter)
    {
        License();
        var size = (letter ? PageSizes.Letter : PageSizes.A4).Landscape();
        return Document.Create(doc =>
        {
            foreach (var m in members.Count > 0 ? members : [new PrintMember("", null, null, [])])
                doc.Page(page =>
                {
                    page.Size(size);
                    page.Margin(0);
                    page.Content().Column(col =>
                    {
                        void Face(IContainer c) => c.AlignMiddle().AlignCenter().PaddingHorizontal(30).Column(f =>
                        {
                            f.Item().AlignCenter().Text(m.Name).FontSize(40).Bold().FontColor("#1B2C42");
                            if (!string.IsNullOrWhiteSpace(m.Roles))
                                f.Item().AlignCenter().Text(m.Roles).FontSize(16).FontColor(Brand);
                            f.Item().AlignCenter().PaddingTop(6).Text(clubName).FontSize(12).FontColor(Muted);
                        });
                        col.Item().Height(size.Height / 2).RotateRight().RotateRight().Element(Face);
                        col.Item().Height(size.Height / 2).BorderTop(0.5f).BorderColor("#CBD5E1").Element(Face);
                    });
                });
        }).GeneratePdf();
    }

    /// <summary>Address block for a label: street lines as stored, then "City State PostCode", then country.</summary>
    public static IReadOnlyList<string> AddressLines(string? address, string? city, string? state, string? postCode, string? country)
    {
        var lines = (address ?? "").Split('\n', ',').Select(l => l.Trim()).Where(l => l.Length > 0).Take(3).ToList();
        var locality = string.Join(" ", new[] { city, state, postCode }.Select(x => x?.Trim()).Where(x => !string.IsNullOrEmpty(x)));
        if (locality.Length > 0) lines.Add(locality);
        if (!string.IsNullOrWhiteSpace(country)) lines.Add(country.Trim());
        // A country alone is not a postal address: no label for that member.
        return string.IsNullOrWhiteSpace(address) && locality.Length == 0 ? [] : lines;
    }
}
