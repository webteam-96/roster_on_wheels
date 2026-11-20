using RotaryApi.Services;

namespace RotaryApi.Tests;

public class WebsitePageRulesTests
{
    [Theory]
    [InlineData("our-history", "our-history")]
    [InlineData("  Home ", "home")]
    [InlineData("a1", "a1")]
    public void Slug_accepts_simple_addresses(string raw, string expected) => Assert.Equal(expected, WebsitePageRules.Slug(raw));

    [Theory]
    [InlineData("")]
    [InlineData("our history")]
    [InlineData("-x")]
    [InlineData("a--b")]
    [InlineData("../etc")]
    [InlineData("x/y")]
    public void Slug_refuses_bad_addresses(string raw) => Assert.Throws<ArgumentException>(() => WebsitePageRules.Slug(raw));

    [Fact]
    public void Richtext_loses_scripts_and_handlers()
    {
        var s = WebsitePageRules.Sections(new[]
        {
            new WebsiteSection { Id = "a", Type = "richtext", Html = "<h2>Hi</h2><script>alert(1)</script><img src=\"/uploads/x.png\" onerror=\"alert(1)\"><a href=\"javascript:alert(1)\">x</a><iframe src=\"https://evil.example\"></iframe>" },
        });
        var html = s[0].Html!;
        Assert.Contains("<h2>Hi</h2>", html);
        Assert.Contains("/uploads/x.png", html);
        Assert.DoesNotContain("script", html);
        Assert.DoesNotContain("onerror", html);
        Assert.DoesNotContain("javascript:", html);
        Assert.DoesNotContain("iframe", html);
    }

    [Theory]
    [InlineData("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ")]
    [InlineData("https://youtu.be/dQw4w9WgXcQ", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ")]
    [InlineData("https://www.youtube.com/embed/dQw4w9WgXcQ", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ")]
    [InlineData("https://vimeo.com/76979871", "https://player.vimeo.com/video/76979871")]
    [InlineData("https://www.google.com/maps/embed?pb=!1m18!1m12", "https://www.google.com/maps/embed?pb=!1m18!1m12")]
    public void Embed_normalises_known_providers(string raw, string expected) => Assert.Equal(expected, WebsitePageRules.EmbedUrl(raw));

    [Theory]
    [InlineData("https://evil.example/embed/x")]
    [InlineData("javascript:alert(1)")]
    [InlineData("https://www.youtube.com/watch?v=bad\"id")]
    [InlineData("https://www.google.com/search?q=x")]
    [InlineData("https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ")]
    public void Embed_refuses_everything_else(string raw) => Assert.Null(WebsitePageRules.EmbedUrl(raw));

    [Fact]
    public void Image_needs_a_safe_url()
    {
        Assert.Throws<ArgumentException>(() => WebsitePageRules.Sections(new[] { new WebsiteSection { Type = "image", Url = "javascript:alert(1)" } }));
        Assert.Throws<ArgumentException>(() => WebsitePageRules.Sections(new[] { new WebsiteSection { Type = "image", Url = "//evil.example/x.png" } }));
        var ok = WebsitePageRules.Sections(new[] { new WebsiteSection { Type = "image", Url = "/uploads/website-pages/club-1/a.png", LinkUrl = "/events" } });
        Assert.Equal("/uploads/website-pages/club-1/a.png", ok[0].Url);
        Assert.Equal("/events", ok[0].LinkUrl);
    }

    [Fact]
    public void Widgets_get_a_clamped_limit_and_unknown_types_fail()
    {
        var s = WebsitePageRules.Sections(new[] { new WebsiteSection { Id = "e", Type = "events", Limit = 500 }, new WebsiteSection { Id = "e", Type = "NEWS" } });
        Assert.Equal(24, s[0].Limit);
        Assert.Equal(6, s[1].Limit);
        Assert.Equal("news", s[1].Type);
        Assert.NotEqual(s[0].Id, s[1].Id); // duplicate ids are replaced
        Assert.Throws<ArgumentException>(() => WebsitePageRules.Sections(new[] { new WebsiteSection { Type = "script" } }));
        Assert.Throws<ArgumentException>(() => WebsitePageRules.Sections(Enumerable.Range(0, WebsitePageRules.MaxSections + 1).Select(_ => new WebsiteSection { Type = "contact" })));
    }

    [Fact]
    public void File_and_picture_sections_accept_media_references_only_in_their_exact_form()
    {
        var s = WebsitePageRules.Sections(new[]
        {
            new WebsiteSection { Id = "f", Type = "file", Url = "media:42", Caption = "Minutes" },
            new WebsiteSection { Id = "i", Type = "image", Url = "media:7" },
        });
        Assert.Equal("media:42", s[0].Url);
        Assert.Equal(42, WebsitePageRules.MediaRef(s[0].Url));
        Assert.Null(WebsitePageRules.MediaRef("media:42/../x"));
        Assert.Null(WebsitePageRules.MediaRef("media:"));
        Assert.Throws<ArgumentException>(() => WebsitePageRules.Sections(new[] { new WebsiteSection { Type = "file", Url = "media:abc" } }));
        Assert.Throws<ArgumentException>(() => WebsitePageRules.Sections(new[] { new WebsiteSection { Type = "file" } }));
    }

    [Fact]
    public void Member_session_token_is_bound_to_club_signature_and_time()
    {
        var key = WebsiteMemberSession.DeriveKey("test-secret-for-unit-tests-only-0123456789");
        var now = DateTimeOffset.UtcNow;
        var token = WebsiteMemberSession.IssueToken(key, 341, 1068, now.AddHours(1));
        Assert.Equal(1068, WebsiteMemberSession.ReadToken(key, token, 341, now));
        Assert.Null(WebsiteMemberSession.ReadToken(key, token, 342, now));              // other club
        Assert.Null(WebsiteMemberSession.ReadToken(key, token, 341, now.AddHours(2)));  // expired
        var parts = token.Split('.');
        Assert.Null(WebsiteMemberSession.ReadToken(key, $"{parts[0]}.999.{parts[2]}.{parts[3]}", 341, now)); // member swapped
        Assert.Null(WebsiteMemberSession.ReadToken(WebsiteMemberSession.DeriveKey("other-secret"), token, 341, now));
        Assert.Null(WebsiteMemberSession.ReadToken(key, "garbage", 341, now));
        Assert.Null(WebsiteMemberSession.ReadToken(key, null, 341, now));
    }

    [Fact]
    public void Signed_file_links_check_id_signature_and_expiry()
    {
        var key = WebsiteMemberSession.DeriveKey("test-secret-for-unit-tests-only-0123456789");
        var now = DateTimeOffset.UtcNow;
        var exp = now.AddMinutes(30).ToUnixTimeSeconds();
        var sig = WebsiteMemberSession.FileSig(key, 5, exp);
        Assert.True(WebsiteMemberSession.FileSigValid(key, 5, exp, sig, now));
        Assert.False(WebsiteMemberSession.FileSigValid(key, 6, exp, sig, now));
        Assert.False(WebsiteMemberSession.FileSigValid(key, 5, exp + 60, sig, now));
        Assert.False(WebsiteMemberSession.FileSigValid(key, 5, exp, sig, now.AddHours(1)));
        Assert.False(WebsiteMemberSession.FileSigValid(key, 5, exp, null, now));
    }

    [Fact]
    public void Public_read_drops_sections_that_no_longer_pass()
    {
        var s = WebsitePageRules.PublicSections(new[]
        {
            new WebsiteSection { Id = "a", Type = "embed", Url = "https://evil.example/x" },
            new WebsiteSection { Id = "b", Type = "richtext", Html = "<p onclick=\"x()\">ok</p>" },
        });
        Assert.Single(s);
        Assert.Equal("<p>ok</p>", s[0].Html);
    }
}
