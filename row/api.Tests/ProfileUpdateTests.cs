using RotaryApi.Services;

namespace RotaryApi.Tests;

public class ProfileUpdateTests
{
    [Fact]
    public void Missing_lists_each_empty_field()
    {
        Assert.Empty(ProfileUpdateService.Missing("p.jpg", "a@b.org", "999", new DateTime(1970, 1, 2), "Law"));
        Assert.Equal(new[] { "photo", "email", "mobile", "birthDate", "classification" },
            ProfileUpdateService.Missing(" ", null, "", new DateTime(1800, 1, 1), null));
    }

    [Fact]
    public void Token_is_url_safe_and_only_its_hash_matches()
    {
        var (token, hash) = ProfileUpdateService.NewToken();
        Assert.True(ProfileUpdateService.LooksLikeToken(token));
        Assert.Equal(64, hash.Length);
        Assert.Equal(hash, ProfileUpdateService.HashToken(token));
        Assert.NotEqual(hash, ProfileUpdateService.HashToken(ProfileUpdateService.NewToken().Token));
        Assert.False(ProfileUpdateService.LooksLikeToken("../../etc"));
        Assert.False(ProfileUpdateService.LooksLikeToken(null));
    }

    [Fact]
    public void Status_follows_completion_then_expiry()
    {
        var now = new DateTime(2026, 11, 19, 10, 0, 0);
        Assert.Equal("updated", ProfileUpdateService.Status(now, now.AddDays(-1), now));
        Assert.Equal("expired", ProfileUpdateService.Status(null, now, now));
        Assert.Equal("pending", ProfileUpdateService.Status(null, now.AddDays(1), now));
    }

    [Theory]
    [InlineData(5, true)]
    [InlineData(25, true)]
    [InlineData(3, true)] // district setting
    [InlineData(7, false)]
    [InlineData(0, false)]
    public void Milestones_are_every_fifth_year_plus_district_years(int years, bool expected)
        => Assert.Equal(expected, ProfileUpdateService.IsMilestone(years, new[] { 1, 3 }));

    [Fact]
    public void Years_between_counts_whole_years_and_leap_days()
    {
        Assert.Equal(9, ProfileUpdateService.YearsBetween(new DateTime(2016, 11, 20), new DateTime(2026, 11, 19)));
        Assert.Equal(10, ProfileUpdateService.YearsBetween(new DateTime(2016, 11, 19), new DateTime(2026, 11, 19)));
        Assert.Equal(3, ProfileUpdateService.YearsBetween(new DateTime(2020, 2, 29), new DateTime(2023, 2, 28)));
    }

    [Fact]
    public void Report_marks_this_months_anniversaries_milestones_and_hides_private_dates()
    {
        var today = new DateTime(2026, 11, 19);
        var rows = ProfileUpdateService.BuildReport(new[]
        {
            new ProfileUpdateService.ReportInput { MemberId = 1, MemberName = "Ann", JoinedDate = new DateTime(2016, 11, 25), BirthDate = new DateTime(1900, 11, 3) },
            new ProfileUpdateService.ReportInput { MemberId = 2, MemberName = "Bob", JoinedDate = new DateTime(2019, 4, 1), AnniversaryDate = new DateTime(1990, 11, 30), ShowPersonal = false },
            new ProfileUpdateService.ReportInput { MemberId = 3, MemberName = "Cy", JoinedDate = new DateTime(2026, 11, 2) },
            new ProfileUpdateService.ReportInput { MemberId = 4, MemberName = "Di" },
        }, 2026, 11, today, Array.Empty<int>());

        var ann = rows.Single(r => r.MemberId == 1);
        Assert.Equal(9, ann.YearsOfService);       // the 10th anniversary is on the 25th
        Assert.Equal(25, ann.JoinAnniversaryDay);
        Assert.Equal(10, ann.AnniversaryYears);
        Assert.True(ann.Milestone);
        Assert.Equal(3, ann.BirthdayDay);

        var bob = rows.Single(r => r.MemberId == 2);
        Assert.Null(bob.JoinAnniversaryDay);
        Assert.Null(bob.WeddingAnniversaryDay);     // hidden by the member

        var cy = rows.Single(r => r.MemberId == 3);
        Assert.Equal(0, cy.YearsOfService);
        Assert.Null(cy.JoinAnniversaryDay);         // joined this month: no anniversary yet

        Assert.Null(rows.Single(r => r.MemberId == 4).YearsOfService);
        Assert.Equal("Ann", rows[0].MemberName);    // longest service first
    }

    [Fact]
    public void Csv_quotes_and_neutralises_formulas()
    {
        Assert.Equal("\"'=HYPERLINK(1)\"", ProfileUpdateService.CsvCell("=HYPERLINK(1)"));
        Assert.Equal("\"say \"\"hi\"\"\"", ProfileUpdateService.CsvCell("say \"hi\""));
        Assert.Equal("\"\"", ProfileUpdateService.CsvCell(null));
        var csv = ProfileUpdateService.ReportCsv(new[] { new ProfileUpdateService.ReportRow(1, "@Ann", "2016-11-25", 9, 25, 10, true, 3, null) });
        Assert.Contains("\"'@Ann\",\"2016-11-25\",\"9\",\"25\",\"10\",\"Yes\",\"3\",\"\"", csv);
    }

    [Fact]
    public void Validate_trims_and_refuses_bad_input()
    {
        var today = new DateTime(2026, 11, 19);
        var ok = new ProfileUpdateService.LinkUpdate { SecondaryEmailId = " a@b.org ", Website = "https://x.org", BirthDate = new DateTime(1970, 5, 1) };
        Assert.Null(ProfileUpdateService.Validate(ok, today));
        Assert.Equal("a@b.org", ok.SecondaryEmailId);

        Assert.NotNull(ProfileUpdateService.Validate(new() { SecondaryEmailId = "nope" }, today));
        Assert.NotNull(ProfileUpdateService.Validate(new() { Website = "javascript:alert(1)" }, today));
        Assert.NotNull(ProfileUpdateService.Validate(new() { BirthDate = today.AddYears(1) }, today));
        Assert.NotNull(ProfileUpdateService.Validate(new() { SecondaryMobileNumber = "call me" }, today));
        Assert.Null(ProfileUpdateService.Validate(new() { ConfirmOnly = true, Website = "bad" }, today));
    }
}
