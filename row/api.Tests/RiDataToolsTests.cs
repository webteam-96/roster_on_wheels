using RotaryApi.Services;
using H = RotaryApi.Services.RiDataToolsService.Holder;

namespace RotaryApi.Tests;

/// <summary>RI data tools: role mapping and the ROW vs RI officer compare (fixture data, no Rotary.org calls).</summary>
public class RiDataToolsTests
{
    [Theory]
    [InlineData("Club President", "President")]
    [InlineData("Club Secretary", "Secretary")]
    [InlineData("Club Treasurer", "Treasurer")]
    [InlineData("Club Membership Chair", "Membership Chair")]
    [InlineData("Club Rotary Foundation Chair", "Foundation Chair")]
    [InlineData("Club Foundation Chair", "Foundation Chair")]
    [InlineData("Club Executive Secretary/Director", "Executive Secretary")]
    [InlineData("club executive secretary", "Executive Secretary")]
    [InlineData("Club President-Elect", null)]
    [InlineData("Club Public Image Chair", null)]
    [InlineData("", null)]
    [InlineData(null, null)]
    public void Ri_roles_map_to_the_six_titles(string? role, string? title) =>
        Assert.Equal(title, RiDataToolsService.NormalizeRiRole(role));

    private static (string, H) P(string t, string name, string? rid) => (t, new H(name, rid, null));

    [Fact]
    public void Compare_marks_each_title()
    {
        var row = new[]
        {
            P("President", "A", "100"),
            P("Secretary", "B", "200"),
            P("Treasurer", "C", null),          // no RI id in ROW: can never match
            P("Membership Chair", "D", "400"),
        };
        var ri = new[]
        {
            P("President", "A", "100"),
            P("Secretary", "X", "999"),
            P("Treasurer", "C", "300"),
            P("Foundation Chair", "F", "500"),
        };
        var rows = RiDataToolsService.Compare(row, ri, riSynced: true).ToDictionary(r => r.Title, r => r.Status);
        Assert.Equal("match", rows["President"]);
        Assert.Equal("different", rows["Secretary"]);
        Assert.Equal("different", rows["Treasurer"]);
        Assert.Equal("missing_in_ri", rows["Membership Chair"]);
        Assert.Equal("missing_in_row", rows["Foundation Chair"]);
        Assert.Equal("empty", rows["Executive Secretary"]);
        Assert.Equal(RiDataToolsService.RiTitles, RiDataToolsService.Compare(row, ri, true).Select(r => r.Title));
    }

    [Fact]
    public void Two_holders_match_only_as_a_set()
    {
        var row = new[] { P("Membership Chair", "A", "1"), P("Membership Chair", "B", "2") };
        Assert.Equal("match", RiDataToolsService.Compare(row, new[] { P("Membership Chair", "B", "2"), P("Membership Chair", "A", "1") }, true)[3].Status);
        Assert.Equal("different", RiDataToolsService.Compare(row, new[] { P("Membership Chair", "A", "1") }, true)[3].Status);
    }

    [Fact]
    public void Without_stored_ri_data_every_title_is_not_synced()
    {
        var rows = RiDataToolsService.Compare(new[] { P("President", "A", "1") }, Array.Empty<(string, H)>(), riSynced: false);
        Assert.All(rows, r => Assert.Equal("not_synced", r.Status));
    }

    [Fact]
    public void Name_key_ignores_case_spaces_and_punctuation() =>
        Assert.Equal(RiDataToolsService.NameKey("Kosala R. Wickramanayake"), RiDataToolsService.NameKey("kosala r wickramanayake "));

    [Fact]
    public void Youth_flag_follows_ri_then_age()
    {
        var today = new DateTime(2026, 11, 20);
        Assert.Equal(1, RiMemberImport.YouthFlag(true, null, today));
        Assert.Equal(1, RiMemberImport.YouthFlag(null, new DateTime(1990, 1, 1), today));
        Assert.Equal(0, RiMemberImport.YouthFlag(null, new DateTime(1980, 1, 1), today));
        Assert.Equal(0, RiMemberImport.YouthFlag(null, null, today));
    }
}
