using RotaryApi.Services;
using Xunit;

namespace RotaryApi.Tests;

public sealed class ClubAdminLimitTests
{
    [Theory]
    [InlineData(0, 3, false)]
    [InlineData(2, 3, false)]
    [InlineData(3, 3, true)]   // the 4th grant
    [InlineData(5, 3, true)]   // a club already over the limit cannot grow
    [InlineData(1, 1, true)]
    public void WouldExceed_RefusesAtOrPastTheLimit(int active, int max, bool refused) =>
        Assert.Equal(refused, ClubAdminLimit.WouldExceed(active, max, alreadyAdmin: false, granteeIsSuperAdmin: false));

    [Fact]
    public void WouldExceed_NeverRefusesSomeoneWhoIsAlreadyAdmin() =>
        Assert.False(ClubAdminLimit.WouldExceed(3, 3, alreadyAdmin: true, granteeIsSuperAdmin: false));

    [Fact]
    public void WouldExceed_SuperAdminIsNotCounted() =>
        Assert.False(ClubAdminLimit.WouldExceed(3, 3, alreadyAdmin: false, granteeIsSuperAdmin: true));

    [Theory]
    [InlineData(null, 3)]
    [InlineData("", 3)]
    [InlineData("abc", 3)]
    [InlineData("0", 3)]
    [InlineData("-2", 3)]
    [InlineData("51", 3)]
    [InlineData("5", 5)]
    [InlineData(" 4 ", 4)]
    [InlineData("1", 1)]
    public void Parse_FallsBackToDefaultForBadValues(string? raw, int expected) =>
        Assert.Equal(expected, ClubAdminLimit.Parse(raw));

    [Fact]
    public void Exception_IsABusinessRuleWithAClearMessage()
    {
        var ex = new ClubAdminLimitException(341, 3);
        Assert.IsAssignableFrom<InvalidOperationException>(ex);
        Assert.Equal(341, ex.ClubId);
        Assert.Contains("3 active Club Admins", ex.Message);
        Assert.Contains("Remove one before adding another", ex.Message);
    }
}
