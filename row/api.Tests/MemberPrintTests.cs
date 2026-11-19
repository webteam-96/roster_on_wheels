using RotaryApi.Services;

namespace RotaryApi.Tests;

/// <summary>Printable club outputs: mailing labels, name badges, table tents.</summary>
public class MemberPrintTests
{
    [Fact]
    public void Address_lines_split_the_street_and_join_the_locality()
    {
        var lines = MemberPrintBuilder.AddressLines("12 Galle Road,\nColpetty", "Colombo", "Western", "00300", "Sri Lanka");
        Assert.Equal(["12 Galle Road", "Colpetty", "Colombo Western 00300", "Sri Lanka"], lines);
    }

    [Fact]
    public void A_country_alone_is_not_an_address() =>
        Assert.Empty(MemberPrintBuilder.AddressLines(null, " ", null, "", "Nepal"));

    [Fact]
    public void Avery_sheets_fit_their_page()
    {
        foreach (var s in new[] { MemberPrintBuilder.LabelsA4, MemberPrintBuilder.LabelsLetter, MemberPrintBuilder.BadgesA4, MemberPrintBuilder.BadgesLetter })
        {
            const float mm = 2.8346f;
            var width = (s.Left + s.Cols * s.W + (s.Cols - 1) * s.GapX) * mm;
            var height = (s.Top + s.Rows * s.H + (s.Rows - 1) * s.GapY) * mm;
            Assert.True(width <= s.Page.Width + 0.5, $"{s.Cols}x{s.Rows} too wide: {width} > {s.Page.Width}");
            Assert.True(height <= s.Page.Height + 0.5, $"{s.Cols}x{s.Rows} too tall: {height} > {s.Page.Height}");
        }
    }

    [Fact]
    public void A_long_address_stays_inside_its_label_on_the_small_letter_stock()
    {
        // 30 labels fill exactly one Letter sheet; an overflowing label would spill the sheet onto a second page.
        var people = Enumerable.Range(1, 30)
            .Select(i => new PrintMember($"Ajanthan Joseph Prathapkumar Jayaseelan {i}", null, null,
                ["428/3 Eden Gardens", "Samagi Mawatha", "Hokandara South", "Colombo Western 10118", "Sri Lanka"]))
            .ToList();
        var pdf = MemberPrintBuilder.Labels(people, letter: true);
        using var reader = Docnet.Core.DocLib.Instance.GetDocReader(pdf, new Docnet.Core.Models.PageDimensions(1, 1));
        Assert.Equal(1, reader.GetPageCount());
    }

    [Fact]
    public void Every_output_is_a_pdf_with_and_without_people()
    {
        var people = Enumerable.Range(1, 25)
            .Select(i => new PrintMember($"Member {i}", "Law", i == 1 ? "President" : "", i % 2 == 0 ? ["1 Main St", "Town 123"] : []))
            .ToList();
        foreach (var bytes in new[]
        {
            MemberPrintBuilder.Labels(people, letter: false), MemberPrintBuilder.Labels(people, letter: true),
            MemberPrintBuilder.Badges(people, "Club", letter: false), MemberPrintBuilder.TableTents(people.Take(2).ToList(), "Club", letter: true),
            MemberPrintBuilder.Labels([], letter: false), MemberPrintBuilder.Badges([], "Club", letter: true),
            MemberPrintBuilder.TableTents([], "Club", letter: false),
        })
            Assert.Equal("%PDF", System.Text.Encoding.ASCII.GetString(bytes, 0, 4));
    }
}
