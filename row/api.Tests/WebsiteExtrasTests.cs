using RotaryApi.Services;

namespace RotaryApi.Tests;

public class WebsiteExtrasTests
{
    private static WebsiteExtrasDto Dto(string? fb = null, string? ig = null, string? x = null, string? ga = null) => new(fb, ig, x, ga);

    [Theory]
    [InlineData("https://www.facebook.com/rotaryclub", "https://www.facebook.com/rotaryclub")]
    [InlineData("facebook.com/rotary.club-1/", "https://www.facebook.com/rotary.club-1")]
    [InlineData("https://m.facebook.com/profile.php?id=1000123", "https://www.facebook.com/profile.php?id=1000123")]
    [InlineData("http://fb.com/club", "https://www.facebook.com/club")]
    public void Facebook_links_are_normalized(string input, string expected)
    {
        var (v, e) = WebsiteExtrasService.Normalize(Dto(fb: input));
        Assert.Null(e);
        Assert.Equal(expected, v!.FacebookPageUrl);
    }

    [Theory]
    [InlineData("https://evil.com/facebook.com/x")]
    [InlineData("javascript:alert(1)")]
    [InlineData("https://www.facebook.com/a b")]
    [InlineData("https://www.facebook.com/x?next=https://evil.com")]
    public void Bad_facebook_links_are_refused(string input) =>
        Assert.NotNull(WebsiteExtrasService.Normalize(Dto(fb: input)).Error);

    [Theory]
    [InlineData("@rotary_club", "rotary_club")]
    [InlineData("https://www.instagram.com/rotary.club/", "rotary.club")]
    [InlineData("rotary", "rotary")]
    public void Instagram_names_are_extracted(string input, string expected) =>
        Assert.Equal(expected, WebsiteExtrasService.Normalize(Dto(ig: input)).Value!.InstagramUsername);

    [Theory]
    [InlineData("@Rotary", "Rotary")]
    [InlineData("https://x.com/rotary_intl", "rotary_intl")]
    [InlineData("twitter.com/rotary", "rotary")]
    public void X_names_are_extracted(string input, string expected) =>
        Assert.Equal(expected, WebsiteExtrasService.Normalize(Dto(x: input)).Value!.XUsername);

    [Theory]
    [InlineData("this_name_is_far_too_long")]
    [InlineData("bad name")]
    [InlineData("<script>")]
    public void Bad_x_names_are_refused(string input) =>
        Assert.NotNull(WebsiteExtrasService.Normalize(Dto(x: input)).Error);

    [Fact]
    public void Analytics_id_is_upper_cased_and_checked()
    {
        Assert.Equal("G-ABC123DEF4", WebsiteExtrasService.Normalize(Dto(ga: " g-abc123def4 ")).Value!.GaMeasurementId);
        Assert.NotNull(WebsiteExtrasService.Normalize(Dto(ga: "UA-1234-1")).Error);
        Assert.NotNull(WebsiteExtrasService.Normalize(Dto(ga: "G-AB'); alert(1)//")).Error);
    }

    [Fact]
    public void Blank_fields_switch_the_feature_off()
    {
        var v = WebsiteExtrasService.Normalize(Dto(" ", "", null, "")).Value!;
        Assert.Equal(new WebsiteExtrasDto(null, null, null, null), v);
    }

    [Theory]
    [InlineData("a", null)]
    [InlineData("  ab ", "%ab%")]
    [InlineData("50%_off\\", "%50\\%\\_off\\\\%")]
    public void Search_terms_are_escaped_for_like(string q, string? expected) =>
        Assert.Equal(expected, WebsiteExtrasService.LikePattern(q));

    [Fact]
    public void Too_long_search_terms_are_refused() => Assert.Null(WebsiteExtrasService.LikePattern(new string('a', 81)));

    [Theory]
    [InlineData("/", true)]
    [InlineData("/project?pid=4&yearId=2", true)]
    [InlineData("//evil.com", false)]
    [InlineData("https://evil.com", false)]
    [InlineData("/a b", false)]
    [InlineData("/a\\b", false)]
    [InlineData("", false)]
    public void Only_site_paths_go_into_qr_codes(string path, bool ok) => Assert.Equal(ok, WebsiteExtrasService.IsSafePath(path));

    [Fact]
    public void Slug_is_file_name_safe() => Assert.Equal("event-id-12", WebsiteExtrasService.Slug("/event?id=12"));

    [Fact]
    public void Sitemap_xml_escapes_urls_and_dates_lastmod()
    {
        var xml = WebsiteExtrasService.SitemapXml("club.example.org", new[]
        {
            new WebsiteSitemapEntry("/", null),
            new WebsiteSitemapEntry("/project?pid=4&yearId=2", new DateTime(2026, 11, 3, 10, 0, 0, DateTimeKind.Utc)),
        });
        Assert.Contains("<loc>https://club.example.org/</loc>", xml);
        Assert.Contains("<loc>https://club.example.org/project?pid=4&amp;yearId=2</loc><lastmod>2026-11-03</lastmod>", xml);
        Assert.StartsWith("<?xml", xml);
        System.Xml.Linq.XDocument.Parse(xml); // well-formed
    }

    [Fact]
    public void Robots_open_only_for_a_live_site()
    {
        Assert.Contains("Disallow: /\n", WebsiteExtrasService.RobotsTxt(null));
        var live = WebsiteExtrasService.RobotsTxt("club.example.org");
        Assert.Contains("Allow: /", live);
        Assert.Contains("Disallow: /search", live);
        Assert.Contains("Sitemap: https://club.example.org/sitemap.xml", live);
    }

    [Fact]
    public void Snippet_strips_html_and_centres_on_the_match()
    {
        var html = "<p>" + new string('x', 300) + " <b>polio</b> drive " + new string('y', 300) + "</p>";
        var s = WebsiteExtrasService.Snippet(html, "polio")!;
        Assert.Contains("polio drive", s);
        Assert.DoesNotContain("<", s);
        Assert.StartsWith("...", s);
    }

    [Fact]
    public void Qr_codes_render_as_png_and_svg()
    {
        var png = WebsiteExtrasService.QrPng("https://club.example.org/events");
        Assert.Equal(new byte[] { 0x89, 0x50, 0x4E, 0x47 }, png[..4]);
        Assert.Contains("<svg", WebsiteExtrasService.QrSvg("https://club.example.org/"));
    }
}
