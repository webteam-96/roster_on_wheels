using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Tests;

public class MemberMapTests
{
    [Theory]
    [InlineData(6.927079, 6.93)]
    [InlineData(-33.868820, -33.87)]
    [InlineData(79.861244, 79.86)]
    [InlineData(0.005, 0.01)]
    public void Pins_are_rounded_to_about_one_km(double raw, double expected) =>
        Assert.Equal((decimal)expected, MemberMapService.Approximate((decimal)raw));

    [Fact]
    public void Opting_in_stores_only_the_rounded_point()
    {
        var d = MemberMapService.NormalizePin(new SaveMapPinDto
        {
            ShowOnMap = true, City = "  Colombo ", Area = "Kollupitiya", Latitude = 6.9123456m, Longitude = 79.8487654m,
        });
        Assert.Equal(6.91m, d.Latitude);
        Assert.Equal(79.85m, d.Longitude);
        Assert.Equal("Colombo", d.City);
    }

    [Fact]
    public void Opting_out_drops_everything()
    {
        var d = MemberMapService.NormalizePin(new SaveMapPinDto { ShowOnMap = false, City = "Colombo", Latitude = 6.9m, Longitude = 79.8m });
        Assert.False(d.ShowOnMap);
        Assert.Null(d.City);
        Assert.Null(d.Latitude);
    }

    [Theory]
    [InlineData(null, 79.8)]
    [InlineData(91.0, 79.8)]
    [InlineData(6.9, 181.0)]
    public void Bad_points_are_refused(double? lat, double? lng) =>
        Assert.Throws<InvalidOperationException>(() => MemberMapService.NormalizePin(
            new SaveMapPinDto { ShowOnMap = true, Latitude = (decimal?)lat, Longitude = (decimal?)lng }));

    [Fact]
    public void A_good_listing_is_trimmed()
    {
        var d = MemberMapService.NormalizeListing(new SaveBusinessListingDto
        {
            ClubId = 1, BusinessName = " Acme Tea ", Website = "https://acmetea.lk", Phone = "+94 11 234 5678", Description = "  ",
        });
        Assert.Equal("Acme Tea", d.BusinessName);
        Assert.Null(d.Description);
    }

    [Theory]
    [InlineData("", null, null)]
    [InlineData("Acme", "javascript:alert(1)", null)]
    [InlineData("Acme", "acme.com", null)]
    [InlineData("Acme", null, "call me")]
    public void Bad_listings_are_refused(string name, string? website, string? phone) =>
        Assert.Throws<InvalidOperationException>(() => MemberMapService.NormalizeListing(
            new SaveBusinessListingDto { ClubId = 1, BusinessName = name, Website = website, Phone = phone }));
}
