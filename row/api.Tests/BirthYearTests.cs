using RotaryApi.Services;

namespace RotaryApi.Tests;

public class BirthYearTests
{
    private static DateTime? Save(DateTime? sent, DateTime? stored) => MemberService.NormalizeBirthAnnivYear(sent, stored);

    [Fact]
    public void The_stored_year_survives_a_form_that_sends_only_a_day_and_month()
    {
        var stored = new DateTime(1985, 6, 15);
        Assert.Equal(stored, Save(new DateTime(1985, 6, 15), stored));
        Assert.Equal(stored, Save(new DateTime(1900, 6, 15), stored));
        Assert.Equal(new DateTime(1985, 7, 1), Save(new DateTime(2000, 7, 1), stored));
    }

    [Fact]
    public void Without_a_real_stored_year_the_year_is_1900()
    {
        Assert.Equal(new DateTime(1900, 7, 1), Save(new DateTime(2000, 7, 1), null));
        Assert.Equal(new DateTime(1900, 7, 1), Save(new DateTime(2000, 7, 1), new DateTime(1900, 6, 15)));
    }

    [Fact]
    public void Clearing_29_february_and_sentinel_dates()
    {
        Assert.Null(Save(null, new DateTime(1985, 6, 15)));
        Assert.Null(Save(new DateTime(1753, 1, 1), new DateTime(1985, 6, 15)));
        Assert.Equal(new DateTime(1985, 2, 28), Save(new DateTime(2000, 2, 29), new DateTime(1985, 6, 15)));
        Assert.Equal(new DateTime(1984, 2, 29), Save(new DateTime(2000, 2, 29), new DateTime(1984, 2, 29)));
        Assert.Equal(new DateTime(1900, 2, 28), Save(new DateTime(2000, 2, 29), null));
    }
}
