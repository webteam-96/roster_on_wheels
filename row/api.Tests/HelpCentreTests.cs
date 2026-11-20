using RotaryApi.Services;
using static RotaryApi.Services.HelpCentreService;

namespace RotaryApi.Tests;

public sealed class HelpCentreTests
{
    [Theory]
    [InlineData("Sign in to ROW", "sign-in-to-row")]
    [InlineData("  Club Dues & Payments!! ", "club-dues-payments")]
    [InlineData("Ünïcode only", "n-code-only")]
    public void Slugify_MakesUrlSafeSlugs(string title, string expected) => Assert.Equal(expected, Slugify(title));

    [Theory]
    [InlineData("ok-slug", true)]
    [InlineData("Bad", false)]
    [InlineData("double--hyphen", false)]
    [InlineData("-lead", false)]
    [InlineData("../etc", false)]
    public void ValidSlug_RejectsUnsafe(string slug, bool ok) => Assert.Equal(ok, ValidSlug(slug));

    [Fact]
    public void StripHtml_GivesPlainText() =>
        Assert.Equal("Hello & welcome to ROW", StripHtml("<p>Hello &amp; <strong>welcome</strong></p>\n<p>to ROW</p>"));

    [Fact]
    public void LikeEscape_EscapesWildcards() => Assert.Equal(@"100\% a\_b \\", LikeEscape(@"100% a_b \"));

    [Fact]
    public void SearchTerms_SplitsDedupesAndCaps()
    {
        Assert.Equal(new[] { "mass", "Email" }, SearchTerms("  mass   Email email "));
        Assert.Equal(6, SearchTerms("a b c d e f g h").Count);
        Assert.Empty(SearchTerms(null));
    }

    [Fact]
    public void SplitHtmlBlocks_KeepsTagsAndRejoinsExactly()
    {
        var html = string.Concat(Enumerable.Range(0, 50).Select(i => $"<p>Paragraph {i} {new string('x', 150)}</p>"));
        var parts = SplitHtmlBlocks(html, 1000);
        Assert.True(parts.Count > 5);
        Assert.All(parts, p => Assert.True(p.Length <= 1000));
        Assert.All(parts, p => Assert.EndsWith("</p>", p));
        Assert.Equal(html, string.Concat(parts));
    }

    [Fact]
    public void RankRelated_PrefersSharedKeywordsThenCategory_ExcludesSelf()
    {
        var current = new RelatedCandidate(1, "a", "A", null, 10, "email, newsletter");
        var all = new[]
        {
            current,
            new RelatedCandidate(2, "b", "Same category only", null, 10, "website"),
            new RelatedCandidate(3, "c", "Two shared keywords", null, 20, "Email, newsletter"),
            new RelatedCandidate(4, "d", "Unrelated", null, 30, "privacy"),
            new RelatedCandidate(5, "e", "One shared", null, 30, "email"),
        };
        Assert.Equal(new[] { 3, 5, 2 }, RankRelated(current, all).Select(r => r.Id));
    }

    [Fact]
    public void MatchContext_TakesLongestPrefixOnSegmentBoundary()
    {
        var rows = new[]
        {
            ("/club-admin-dashboard/communication", "comms"),
            ("/club-admin-dashboard/communication/mass-email", "mass"),
            ("/club-admin-dashboard/comms-settings", "settings"),
        };
        Assert.Equal("mass", MatchContext("/club-admin-dashboard/communication/mass-email/compose", rows));
        Assert.Equal("comms", MatchContext("/club-admin-dashboard/communication/", rows));
        Assert.Null(MatchContext("/club-admin-dashboard/communicationx", rows));
        Assert.Null(MatchContext("/members", rows));
    }

    [Fact]
    public void Validate_SanitizesBodyAndDefaultsSlug()
    {
        var (clean, error) = Validate(new ArticleInput(1, " Send a mass email ", null, "", "<p onclick=\"x()\">Hi<script>alert(1)</script></p>",
            "Email, EMAIL, send", "/Club-Admin-Dashboard/Communication/", null, 0));
        Assert.Null(error);
        Assert.Equal("send-a-mass-email", clean!.Slug);
        Assert.DoesNotContain("script", clean.Body);
        Assert.DoesNotContain("onclick", clean.Body);
        Assert.Equal("email, send", clean.Keywords);
        Assert.Equal("/club-admin-dashboard/communication", clean.ContextPath);
        Assert.Equal("draft", clean.Status);
        Assert.Null(clean.Summary);
    }

    [Theory]
    [InlineData("", "<p>x</p>", null, "draft")]
    [InlineData("T", "<script>only</script>", null, "draft")]
    [InlineData("T", "<p>x</p>", "no-slash", "draft")]
    [InlineData("T", "<p>x</p>", null, "live")]
    public void Validate_RejectsBadInput(string title, string body, string? context, string status) =>
        Assert.NotNull(Validate(new ArticleInput(1, title, null, null, body, null, context, status, 0)).Error);

    [Fact]
    public void Seed_IsCompleteAndClean()
    {
        Assert.InRange(HelpSeed.Articles.Length, 15, 25);
        var cats = HelpSeed.Categories.Select(c => c.Slug).ToHashSet();
        Assert.All(HelpSeed.Articles, a =>
        {
            Assert.Contains(a.Category, cats);
            Assert.True(ValidSlug(a.Slug), a.Slug);
            Assert.Null(Validate(new ArticleInput(1, a.Title, a.Slug, a.Summary, a.Body, a.Keywords, a.ContextPath, "published", 0)).Error);
            Assert.DoesNotContain("—", a.Title + a.Summary + a.Body);
        });
        Assert.Equal(HelpSeed.Articles.Length, HelpSeed.Articles.Select(a => a.Slug).Distinct().Count());
    }
}
