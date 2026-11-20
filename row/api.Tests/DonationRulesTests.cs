using RotaryApi.Controllers;
using RotaryApi.Services;

namespace RotaryApi.Tests;

public class DonationRulesTests
{
    [Theory]
    [InlineData(50, "25,50,100", false, 1, null)]          // a tier is always fine
    [InlineData(30, "25,50,100", false, 1, "Choose one of the suggested amounts.")]
    [InlineData(30, "25,50", true, 10, null)]
    [InlineData(5, "25,50", true, 10, "The smallest donation is 10.")]
    [InlineData(0, null, true, 1, "Enter an amount above zero.")]
    [InlineData(-5, null, true, 1, "Enter an amount above zero.")]
    [InlineData(10.555, null, true, 1, "Use at most two decimal places.")]
    [InlineData(2000000, null, true, 1, "This amount is above the limit for one donation.")]
    public void ValidateAmount_TheServerIsTheJudge(double amount, string? tiers, bool custom, double min, string? expected) =>
        Assert.Equal(expected, DonationRules.ValidateAmount((decimal)amount, tiers, custom, (decimal)min));

    [Fact]
    public void Tiers_RoundTrip_SortedDistinctPositive()
    {
        Assert.Equal("10,25.5,100", DonationRules.FormatTiers(new[] { 100m, 25.5m, 10m, 10m, -1m }));
        Assert.Equal(new[] { 5m, 20m }, DonationRules.ParseTiers("20, x, 5,0"));
        Assert.Null(DonationRules.FormatTiers(null));
    }

    [Fact]
    public void Progress_MayPassTheGoal_AndNoGoalIsZero()
    {
        Assert.Equal(125.0m, DonationRules.Progress(200m, 250m, 3).Percent);
        Assert.Equal(33.3m, DonationRules.Progress(300m, 100m, 1).Percent);
        Assert.Equal(0m, DonationRules.Progress(0m, 100m, 1).Percent);
    }

    [Fact]
    public void IsOpen_RespectsActiveAndDates()
    {
        var today = new DateTime(2026, 11, 19, 10, 0, 0, DateTimeKind.Utc);
        Assert.True(DonationRules.IsOpen(new DonationCampaignRow { IsActive = true }, today));
        Assert.True(DonationRules.IsOpen(new DonationCampaignRow { IsActive = true, StartDate = today.Date, EndDate = today.Date }, today));
        Assert.False(DonationRules.IsOpen(new DonationCampaignRow { IsActive = false }, today));
        Assert.False(DonationRules.IsOpen(new DonationCampaignRow { IsActive = true, StartDate = today.AddDays(1) }, today));
        Assert.False(DonationRules.IsOpen(new DonationCampaignRow { IsActive = true, EndDate = today.AddDays(-1) }, today));
    }

    [Fact]
    public void ToPublic_NeverShowsEmailOrSurname_AndHonoursAnonymousAndHiddenAmount()
    {
        var d = new DonationRow { DonorName = "Priya Fernando", DonorEmail = "p@x.org", Amount = 50m, Message = "Go!", PaidDate = DateTime.UtcNow };
        var shown = DonationRules.ToPublic(d);
        Assert.Equal("Priya", shown.Name);
        Assert.Equal(50m, shown.Amount);
        Assert.Equal("Go!", shown.Message);

        var anon = DonationRules.ToPublic(new DonationRow { DonorName = "Priya Fernando", IsAnonymous = true, HideAmount = true, Amount = 50m, Message = "secret" });
        Assert.Equal("Anonymous", anon.Name);
        Assert.Null(anon.Amount);
        Assert.Null(anon.Message);
    }

    [Fact]
    public void Daily_GroupsPaidByUtcDay()
    {
        var rows = new[]
        {
            new DonationRow { Status = "paid", Amount = 10m, PaidDate = new DateTime(2026, 11, 2, 23, 0, 0) },
            new DonationRow { Status = "paid", Amount = 5m, PaidDate = new DateTime(2026, 11, 1, 1, 0, 0) },
            new DonationRow { Status = "paid", Amount = 7m, PaidDate = new DateTime(2026, 11, 2, 1, 0, 0) },
            new DonationRow { Status = "pending", Amount = 99m, CreatedDate = new DateTime(2026, 11, 2) },
        };
        var daily = DonationRules.Daily(rows);
        Assert.Equal(2, daily.Count);
        Assert.Equal(new DailyGiving("2026-11-01", 5m, 1), daily[0]);
        Assert.Equal(new DailyGiving("2026-11-02", 17m, 2), daily[1]);
    }

    [Fact]
    public void ValidateCampaign_RejectsBadInput()
    {
        Assert.Null(DonationRules.ValidateCampaign(new SaveDonationCampaignDto { Title = "Water wells", GoalAmount = 1000 }));
        Assert.NotNull(DonationRules.ValidateCampaign(new SaveDonationCampaignDto { Title = " " }));
        Assert.NotNull(DonationRules.ValidateCampaign(new SaveDonationCampaignDto { Title = "x", AllowCustom = false }));
        Assert.NotNull(DonationRules.ValidateCampaign(new SaveDonationCampaignDto
            { Title = "x", StartDate = new DateTime(2026, 12, 1), EndDate = new DateTime(2026, 11, 1) }));
        Assert.NotNull(DonationRules.ValidateCampaign(new SaveDonationCampaignDto { Title = "x", ImageUrl = "https://evil.example/a.png" }));
        Assert.Null(DonationRules.ValidateCampaign(new SaveDonationCampaignDto { Title = "x", ImageUrl = "/Documents/donations/a.png" }));
    }

    [Fact]
    public void ReceiptTemplate_RendersKnownPlaceholdersOnly()
    {
        var values = new Dictionary<string, string> { ["donor_name"] = "Priya", ["amount"] = "50.00", ["currency"] = "LKR" };
        Assert.Equal("Dear Priya, 50.00 LKR {unknown}", DonationReceiptTemplate.Render("Dear {DONOR_NAME}, {amount} {currency} {unknown}", values));
        Assert.StartsWith("Dear Priya,", DonationReceiptTemplate.Render(null, values));
        Assert.NotNull(new DonationReceiptTemplate { Body = new string('x', 5001) }.Validate());
    }

    [Fact]
    public void Receipt_And_Qr_ProduceFiles()
    {
        var pdf = DonationReceiptPdfBuilder.Build(new DonationReceipt("Rotary Club of Test", "Wells", "Priya", 50m, "LKR",
            DateTime.UtcNow, "DON1_abc", "sim_1", null, new DonationReceiptTemplate { TaxStatement = "Reg. no. 123", SignatoryName = "A. Treasurer" }));
        Assert.Equal("%PDF", System.Text.Encoding.ASCII.GetString(pdf, 0, 4));
        var png = DonationsController.QrPng("https://example.org/public/donate/1");
        Assert.Equal(new byte[] { 0x89, 0x50, 0x4E, 0x47 }, png.Take(4).ToArray());
    }
}
