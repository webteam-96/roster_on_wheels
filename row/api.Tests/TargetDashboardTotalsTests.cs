using RotaryApi.Services;

namespace RotaryApi.Tests;

public class TargetDashboardTotalsTests
{
    // A district with no clubs used to send an empty Totals object and crash the admin page (live test 27 Nov).
    [Fact]
    public void ZeroTotals_has_every_metric_at_zero()
    {
        var t = TargetDashboardService.ZeroTotals(0.4);
        Assert.Equal(new[] { "attendance", "dues", "foundation", "growth", "meetings", "members", "newMembers", "projects" },
            t.Keys.OrderBy(k => k, StringComparer.Ordinal).ToArray());
        Assert.All(t.Values, m => { Assert.Equal(0m, m.Actual); Assert.Null(m.Target); Assert.Null(m.Percent); });
    }
}
