using RotaryApi.Services;

namespace RotaryApi.Tests;

public class DailyStatsReportTests
{
    private static readonly string[] Brand = { "brand@example.org", "" };

    [Fact]
    public void Blank_placeholders_are_not_recipients()
    {
        Assert.Equal(new[] { "brand@example.org" }, DailyStatsReportService.ChooseRecipients(new[] { "", " " }, Brand));
        Assert.Equal(new[] { "a@example.org" }, DailyStatsReportService.ChooseRecipients(new[] { "", " a@example.org " }, Brand));
        Assert.Equal(new[] { "brand@example.org" }, DailyStatsReportService.ChooseRecipients(null, Brand));
        Assert.Empty(DailyStatsReportService.ChooseRecipients(new[] { "" }, new[] { "" }));
    }
}

public class ProjectCountZoneTests
{
    [Fact]
    public void With_no_zones_configured_every_zone_counts()
    {
        Assert.DoesNotContain("ZoneName", ProjectCountFilter.Geo("p.fk_club_id"));
    }
}
