using RotaryApi.Services;
using static RotaryApi.Services.ClubAccountsTools;

namespace RotaryApi.Tests;

public class ClubAccountsToolsTests
{
    [Fact]
    public void Statement_csv_reads_header_quotes_signs_and_formats()
    {
        var csv = "﻿Date,Description,Amount\r\n" +
                  "2026-11-02,Dues from A,250.00\r\n" +
                  "03/11/2026,\"Dinner, venue\",-120.25\r\n" +
                  "4 Nov 2026,Bank fee,(5.00)\r\n" +
                  "2026-11-05,Big,\"1,250.50\"\r\n" +
                  "\r\n" +
                  "not a date,x,1\r\n" +
                  "2026-11-06,Bad amount,12.345\r\n" +
                  "2026-11-07,Zero,0\r\n";
        var (rows, problems) = ParseStatementCsv(csv);
        Assert.Equal(4, rows.Count);
        Assert.Equal(new DateTime(2026, 11, 3), rows[1].Date); // day before month
        Assert.Equal("Dinner, venue", rows[1].Description);
        Assert.Equal(-120.25m, rows[1].Amount);
        Assert.Equal(-5m, rows[2].Amount);
        Assert.Equal(1250.50m, rows[3].Amount);
        Assert.Equal(3, problems.Count);
        Assert.Contains(problems, p => p.Contains("Line 7"));
    }

    [Fact]
    public void Statement_csv_without_header_keeps_first_row()
    {
        var (rows, problems) = ParseStatementCsv("2026-01-01;Opening;100\n2026-01-02;Fee;-1");
        Assert.Equal(2, rows.Count);
        Assert.Empty(problems);
    }

    [Theory]
    [InlineData(0, "Zero and 00/100")]
    [InlineData(7.5, "Seven and 50/100")]
    [InlineData(21, "Twenty-one and 00/100")]
    [InlineData(1250.50, "One thousand two hundred fifty and 50/100")]
    [InlineData(1000000, "One million and 00/100")]
    [InlineData(3405019.99, "Three million four hundred five thousand nineteen and 99/100")]
    public void Amount_in_words(double amount, string words) => Assert.Equal(words, AmountInWords((decimal)amount));

    private static FeeRow Fee(bool f1, bool f2, bool f3, string? paid) =>
        new(1, "Asha", "Dues 2026-27", f1, f2, f3, "Annual", "Half 1", "Half 2", 300m, 160m, 160m, new DateTime(2026, 7, 1), paid);

    [Fact]
    public void Charges_follow_what_the_member_paid()
    {
        Assert.Equal(300m, ChargesFor(Fee(true, true, true, null)).Single().Amount);           // nothing paid: annual
        Assert.Empty(ChargesFor(Fee(true, true, true, "1")));                                    // annual paid
        var halves = ChargesFor(Fee(true, true, true, "2")).ToList();                            // first half paid
        Assert.Equal(160m, halves.Single().Amount);
        Assert.Equal(new DateTime(2027, 1, 1), halves.Single().DueDate);
        Assert.Equal(2, ChargesFor(Fee(false, true, true, null)).Count());                     // halves only
        Assert.Equal("Dues 2026-27: Annual", ChargesFor(Fee(true, false, false, "")).Single().Item);
    }

    [Fact]
    public void Aging_buckets_by_days_past_due()
    {
        var asOf = new DateTime(2026, 11, 20);
        Charge C(int member, decimal amount, int daysAgo) => new(member, "M" + member, "x", amount, asOf.AddDays(-daysAgo));
        var r = BuildAging(new[]
        {
            C(1, 10, 0), C(1, 20, 30), C(1, 30, 31), C(1, 40, 60), C(1, 50, 61), C(1, 60, 90), C(1, 70, 91), C(1, 5, -10),
            C(2, 100, 200), C(3, 0, 10),
        }, asOf);
        var m1 = r.Rows.Single(x => x.MemberId == 1);
        Assert.Equal(30m, m1.Days0To30);
        Assert.Equal(70m, m1.Days31To60);
        Assert.Equal(110m, m1.Days61To90);
        Assert.Equal(70m, m1.Over90);
        Assert.Equal(5m, m1.NotDue);
        Assert.Equal(285m, m1.Total);
        Assert.Equal(2, r.Rows.Count);           // zero amounts left out
        Assert.Equal(2, r.Rows[0].MemberId);     // most overdue first
        Assert.Equal(385m, r.Totals.Total);
        Assert.Equal(170m, r.Totals.Over90);
    }
}
