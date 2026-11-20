using RotaryApi.Services;

namespace RotaryApi.Tests;

public class OfficerProgressionChainTests
{
    [Fact]
    public void Club_chain_runs_PN_PE_P_IPP_over_four_consecutive_years()
    {
        var steps = OfficerProgressionChain.Build(OfficerProgressionChain.Club, 2026);
        Assert.Equal(new[] { "PN", "PE", "P", "IPP" }, steps.Select(s => s.Role));
        Assert.Equal(new[] { "2026-27", "2027-28", "2028-29", "2029-30" }, steps.Select(s => s.YearLabel));
        Assert.Equal(new[] { "record", "record", "board", "board" }, steps.Select(s => s.AppliesTo));
    }

    [Fact]
    public void District_chain_runs_DGN_DGE_DG_IPDG_and_only_DG_writes_the_governors_list()
    {
        var steps = OfficerProgressionChain.Build(OfficerProgressionChain.District, 2027);
        Assert.Equal(new[] { "DGN", "DGE", "DG", "IPDG" }, steps.Select(s => s.Role));
        Assert.Equal("2029-30", steps.Single(s => s.Role == "DG").YearLabel);
        Assert.Equal(new[] { "DG" }, steps.Where(s => s.AppliesTo == "governor").Select(s => s.Role));
    }

    [Fact]
    public void Year_label_wraps_the_century()
    {
        Assert.Equal("2099-00", OfficerProgressionChain.YearLabel(2099));
        Assert.Equal("2009-10", OfficerProgressionChain.YearLabel(2009));
    }

    [Fact]
    public void Board_designations_match_designation_master_names()
    {
        Assert.Equal("Club President", OfficerProgressionChain.BoardDesignation("P"));
        Assert.Equal("Immediate Past President", OfficerProgressionChain.BoardDesignation("IPP"));
        Assert.Null(OfficerProgressionChain.BoardDesignation("PE"));
    }

    [Theory]
    [InlineData(2023, true)]
    [InlineData(2026, true)]
    [InlineData(2029, true)]
    [InlineData(2022, false)]
    [InlineData(2030, false)]
    public void Nominee_year_window_is_three_back_to_three_ahead(int year, bool allowed) =>
        Assert.Equal(allowed, OfficerProgressionChain.IsNomineeYearAllowed(year, 2026));

    [Fact]
    public void Unknown_scope_or_role_is_rejected()
    {
        Assert.Throws<ArgumentException>(() => OfficerProgressionChain.Build("zone", 2026));
        Assert.Throws<ArgumentException>(() => OfficerProgressionChain.Step(OfficerProgressionChain.Club, 2026, "DG"));
        Assert.False(OfficerProgressionChain.IsScope("zone"));
    }
}
