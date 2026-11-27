using RotaryApi.Services;

namespace RotaryApi.Tests;

public class ProjectNumbersTests
{
    [Fact]
    public void Below_zero_is_refused_and_blank_or_zero_is_fine()
    {
        Assert.Null(ProjectNumbers.Validate(null, 0, 12.5m));
        Assert.NotNull(ProjectNumbers.Validate(5, -0.01m));
        int? beneficiaries = -4;
        Assert.NotNull(ProjectNumbers.Validate(null, beneficiaries));
    }
}
