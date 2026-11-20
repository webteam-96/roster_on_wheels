using RotaryApi.Services;
using Xunit;

namespace RotaryApi.Tests;

/// <summary>Youth programs (gap #12): participant status flow, clearance state and validation.</summary>
public class YouthRulesTests
{
    private static readonly DateTime Today = new(2026, 11, 19);

    [Theory]
    [InlineData("applied", "approved", true, true)]
    [InlineData("applied", "declined", true, true)]
    [InlineData("approved", "attended", true, true)]
    [InlineData("attended", "completed", true, true)]
    [InlineData("applied", "completed", true, false)]   // no skipping steps
    [InlineData("completed", "applied", true, false)]
    [InlineData("declined", "approved", true, false)]
    [InlineData("applied", "withdrawn", false, true)]   // the club may withdraw
    [InlineData("approved", "withdrawn", false, true)]
    [InlineData("attended", "withdrawn", false, false)]
    [InlineData("applied", "approved", false, false)]   // only the chair decides
    [InlineData("applied", "bogus", true, false)]
    public void MayMove_follows_the_flow(string from, string to, bool chair, bool expected) =>
        Assert.Equal(expected, YouthRules.MayMove(from, to, chair));

    [Fact]
    public void ClearanceState_by_dates()
    {
        var t = Today.AddYears(-1);
        Assert.Equal("incomplete", YouthRules.ClearanceState(null, t, Today.AddYears(1), Today));
        Assert.Equal("incomplete", YouthRules.ClearanceState(t, t, null, Today));
        Assert.Equal("expired", YouthRules.ClearanceState(t, t, Today.AddDays(-1), Today));
        Assert.Equal("expiring", YouthRules.ClearanceState(t, t, Today, Today));
        Assert.Equal("expiring", YouthRules.ClearanceState(t, t, Today.AddDays(60), Today));
        Assert.Equal("cleared", YouthRules.ClearanceState(t, t, Today.AddDays(61), Today));
    }

    [Fact]
    public void ClearanceError_checks_dates()
    {
        Assert.Null(YouthRules.ClearanceError(Today, Today, Today.AddYears(3), Today));
        Assert.Null(YouthRules.ClearanceError(null, null, null, Today));
        Assert.NotNull(YouthRules.ClearanceError(Today.AddDays(1), null, null, Today));
        Assert.NotNull(YouthRules.ClearanceError(null, Today.AddDays(1), null, Today));
        Assert.NotNull(YouthRules.ClearanceError(null, null, Today.AddYears(1), Today));      // expiry needs a check date
        Assert.NotNull(YouthRules.ClearanceError(null, Today, Today, Today));                 // expiry after the check
        Assert.NotNull(YouthRules.ClearanceError(null, Today, Today.AddYears(11), Today));
    }

    [Fact]
    public void ParticipantError_validates_input()
    {
        Assert.Null(YouthRules.ParticipantError("ryla", "Asha Perera", null));
        Assert.Null(YouthRules.ParticipantError("rli", "Asha Perera", "asha@example.org"));
        Assert.NotNull(YouthRules.ParticipantError("other", "Asha", null));
        Assert.NotNull(YouthRules.ParticipantError(null, "Asha", null));
        Assert.NotNull(YouthRules.ParticipantError("ryla", " ", null));
        Assert.NotNull(YouthRules.ParticipantError("ryla", new string('a', 151), null));
        Assert.NotNull(YouthRules.ParticipantError("ryla", "Asha", "not-an-email"));
    }
}
