using System.Text;
using Microsoft.AspNetCore.Http;
using RotaryApi.Services;
using Xunit;

namespace RotaryApi.Tests;

/// Security #21: an upload's content must match its image extension.
public class UploadSignatureTests
{
    private static IFormFile File(string name, byte[] bytes) =>
        new FormFile(new MemoryStream(bytes), 0, bytes.Length, "file", name);

    private static readonly byte[] Png1x1 = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==");

    [Fact]
    public void RealPng_Passes()
    {
        var r = ImageQualityValidator.Validate(File("photo.png", Png1x1), strict: false);
        Assert.True(r.Ok, r.Error);
        Assert.Equal(1, r.Width);
    }

    [Theory]
    [InlineData("evil.png", "<html><script>alert(1)</script></html>")]
    [InlineData("evil.jpg", "<svg onload=alert(1)>")]
    [InlineData("evil.gif", "MZ not an image")]
    [InlineData("evil.webp", "RIFF0000WAVEfmt ")]
    public void RenamedNonImage_IsRefused(string name, string content)
    {
        var r = ImageQualityValidator.Validate(File(name, Encoding.ASCII.GetBytes(content)), strict: false);
        Assert.False(r.Ok);
        Assert.Contains("does not match", r.Error);
    }

    [Fact]
    public void OtherAllowedTypes_AreNotSignatureChecked()
    {
        var r = ImageQualityValidator.Validate(File("doc.pdf", Encoding.ASCII.GetBytes("%PDF-1.7")), strict: false,
            allowedExtensions: new[] { ".pdf" });
        Assert.True(r.Ok, r.Error);
    }
}

/// The global upload filter's per-file check (all upload endpoints).
public class UploadContentFilterTests
{
    private static IFormFile F(string name, string content) =>
        new FormFile(new MemoryStream(Encoding.ASCII.GetBytes(content)), 0, content.Length, "file", name);

    [Theory]
    [InlineData("x.html")] [InlineData("x.aspx")] [InlineData("x.exe")] [InlineData("x.JS")]
    public void ScriptTypes_AreRefused(string name) => Assert.NotNull(UploadContentFilter.Check(F(name, "anything")));

    [Theory]
    [InlineData("a.pdf", "%PDF-1.7 ...", true)]
    [InlineData("a.pdf", "<html>", false)]
    [InlineData("a.docx", "PK\u0003\u0004rest", true)]
    [InlineData("a.xlsx", "MZ", false)]
    [InlineData("a.txt", "plain", true)]
    [InlineData("a.svg", "<svg/>", true)]
    public void ContentMustMatchType(string name, string content, bool ok) =>
        Assert.Equal(ok, UploadContentFilter.Check(F(name, content)) == null);
}
