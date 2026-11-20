using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Tests;

/// <summary>Job board rules: what a post must carry, how long it runs, and what a review may do.</summary>
public class JobBoardTests
{
    private static readonly DateTime Today = new(2026, 11, 20);

    private static SaveJobPostDto Valid() => new()
    {
        Kind = " Job ", Title = "  Accountant ", Description = "Part time", Contact = "hr@example.org", Company = " ", ExpiresOn = Today.AddDays(10),
    };

    [Fact]
    public void A_valid_post_is_trimmed_and_blank_optionals_become_null()
    {
        var p = JobBoardRules.Validate(Valid(), Today);
        Assert.Equal(("job", "Accountant", null, Today.AddDays(10)), (p.Kind, p.Title, p.Company, p.ExpiresOn));
    }

    [Fact]
    public void No_expiry_runs_thirty_days()
    {
        var d = Valid();
        d.ExpiresOn = null;
        Assert.Equal(Today.AddDays(30), JobBoardRules.Validate(d, Today).ExpiresOn);
    }

    [Theory]
    [InlineData("kind")]
    [InlineData("title")]
    [InlineData("contact")]
    [InlineData("past")]
    [InlineData("toolong")]
    [InlineData("bigtitle")]
    public void Bad_posts_are_refused(string what)
    {
        var d = Valid();
        switch (what)
        {
            case "kind": d.Kind = "event"; break;
            case "title": d.Title = "  "; break;
            case "contact": d.Contact = null; break;
            case "past": d.ExpiresOn = Today.AddDays(-1); break;
            case "toolong": d.ExpiresOn = Today.AddDays(91); break;
            case "bigtitle": d.Title = new string('a', 151); break;
        }
        Assert.Throws<InvalidOperationException>(() => JobBoardRules.Validate(d, Today));
    }

    [Theory]
    [InlineData("pending", "approve", "approved")]
    [InlineData("approved", "approve", "approved")]
    [InlineData("pending", "reject", "rejected")]
    [InlineData("pending", "Remove", "removed")]
    [InlineData("approved", "remove", "removed")]
    public void Review_moves(string from, string action, string to) => Assert.Equal(to, JobBoardRules.Review(from, action));

    [Theory]
    [InlineData("approved", "reject")]
    [InlineData("removed", "approve")]
    [InlineData("withdrawn", "remove")]
    [InlineData("pending", "delete")]
    [InlineData("pending", null)]
    public void Review_refuses(string from, string? action) =>
        Assert.Throws<InvalidOperationException>(() => JobBoardRules.Review(from, action));

    [Fact]
    public void A_post_expires_after_its_day()
    {
        Assert.Equal("approved", JobBoardRules.DisplayStatus("approved", Today, Today));
        Assert.Equal("expired", JobBoardRules.DisplayStatus("approved", Today.AddDays(-1), Today));
        Assert.Equal("expired", JobBoardRules.DisplayStatus("pending", Today.AddDays(-1), Today));
        Assert.Equal("removed", JobBoardRules.DisplayStatus("removed", Today.AddDays(-1), Today));
    }
}
