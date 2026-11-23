using RotaryApi.Services;

namespace RotaryApi.Tests;

public class DistrictWebsiteThemeTests
{
    [Theory]
    [InlineData("ether")]
    [InlineData("prism")]
    [InlineData("orbit")]
    [InlineData("tide")]
    [InlineData("transit")]
    [InlineData("cascade")]
    [InlineData("kinetic")]
    public void Known_keys_are_kept(string key)
    {
        Assert.True(DistrictWebsiteThemes.IsValid(key));
        Assert.Equal(key, DistrictWebsiteThemes.Normalize(key));
    }

    [Fact]
    public void Case_and_spaces_are_normalized()
    {
        Assert.Equal("prism", DistrictWebsiteThemes.Normalize(" Prism "));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("  ")]
    [InlineData("classic-blue")]
    [InlineData("../ether")]
    [InlineData("ether'; DROP TABLE x;--")]
    public void Unknown_or_missing_keys_fall_back_to_ether(string? key)
    {
        Assert.False(DistrictWebsiteThemes.IsValid(key));
        Assert.Equal("ether", DistrictWebsiteThemes.Normalize(key));
    }

    [Fact]
    public void Seven_themes_with_ether_as_default()
    {
        Assert.Equal(7, DistrictWebsiteThemes.Keys.Length);
        Assert.Contains(DistrictWebsiteThemes.Default, DistrictWebsiteThemes.Keys);
    }
}
