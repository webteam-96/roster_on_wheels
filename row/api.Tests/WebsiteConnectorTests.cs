using RotaryApi.Services;

namespace RotaryApi.Tests;

public class WebsiteConnectorTests
{
    [Fact]
    public void NewKeys_AreUnique_WellFormed_AndHashStably()
    {
        var a = WebsiteConnectorService.NewKey();
        var b = WebsiteConnectorService.NewKey();
        Assert.NotEqual(a, b);
        Assert.True(WebsiteConnectorService.LooksLikeKey(a));
        Assert.StartsWith("rowk_", a);
        Assert.Equal(WebsiteConnectorService.HashKey(a), WebsiteConnectorService.HashKey(a));
        Assert.Equal(64, WebsiteConnectorService.HashKey(a).Length);
        Assert.NotEqual(WebsiteConnectorService.HashKey(a), WebsiteConnectorService.HashKey(b));
        // the stored prefix is not the key
        Assert.Equal(12, WebsiteConnectorService.DisplayPrefix(a).Length);
        Assert.False(WebsiteConnectorService.LooksLikeKey(WebsiteConnectorService.DisplayPrefix(a)));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("rowk_short")]
    [InlineData("abcd_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")]
    [InlineData("rowk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaa' OR '1'='1")]
    public void LooksLikeKey_RejectsJunk(string? key) => Assert.False(WebsiteConnectorService.LooksLikeKey(key));

    [Fact]
    public void DirectoryMember_CarriesNoContactDetails()
    {
        var props = typeof(WebsiteConnectorService.MemberItem).GetProperties().Select(p => p.Name).OrderBy(n => n);
        Assert.Equal(new[] { "Classification", "Name", "PhotoPath" }, props);
    }

    [Fact]
    public void PlainText_StripsMarkupAndShortens()
    {
        Assert.Null(WebsiteConnectorService.PlainText("  "));
        Assert.Equal("Hello & welcome", WebsiteConnectorService.PlainText("<p>Hello &amp; <b>welcome</b></p><script></script>"));
        var longText = WebsiteConnectorService.PlainText(new string('x', 700), 600)!;
        Assert.Equal(603, longText.Length);
        Assert.EndsWith("...", longText);
    }

    [Theory]
    [InlineData(null, 10)]
    [InlineData(0, 1)]
    [InlineData(500, 50)]
    [InlineData(7, 7)]
    public void ClampLimit_StaysInRange(int? asked, int expected) =>
        Assert.Equal(expected, WebsiteConnectorService.ClampLimit(asked));
}
