using RotaryApi.Services;

namespace RotaryApi.Tests;

/// <summary>ROW speaks the eight launch languages only; anything else falls back (tenant, then English).</summary>
public class LanguageTests
{
    [Theory]
    [InlineData("Spanish", "es")]
    [InlineData("japanese", "ja")]
    [InlineData("pt-BR", "pt-BR")]
    [InlineData("ko", "ko")]
    [InlineData("English", "en")]
    [InlineData("Hindi", null)]
    [InlineData("zh", null)]
    [InlineData("Other", null)]
    [InlineData("", null)]
    [InlineData(null, null)]
    public void LanguageOf_keeps_only_the_eight(string? stored, string? expected) =>
        Assert.Equal(expected, CommsTemplates.LanguageOf(stored));

    [Theory]
    [InlineData("fr", true)]
    [InlineData("DE", true)]
    [InlineData("hi", false)]
    [InlineData("en-<x>", false)]
    [InlineData(null, false)]
    public void IsSupported(string? code, bool expected) => Assert.Equal(expected, CommsTemplates.IsSupported(code));
}
