using RotaryApi.Services;

namespace RotaryApi.Tests;

public class YearRolloverTests
{
    private static readonly string[] Designations = ["Club President", "Club Secretary", "Immediate Past President"];

    [Theory]
    [InlineData("Club President", true)]
    [InlineData("club president 2025-26", true)]
    [InlineData("Immediate Past President 2024-25", true)]
    [InlineData("Club Presidential Dinner Committee", false)]
    [InlineData("Fundraising Committee", false)]
    public void Board_mirror_groups_are_not_carried(string name, bool auto) =>
        Assert.Equal(auto, YearRolloverService.IsAutoGroup(name, Designations));

    [Fact]
    public void Same_person_is_matched_by_id_then_by_name()
    {
        Assert.Equal(YearRolloverService.PersonKey(12, "A"), YearRolloverService.PersonKey(12, "Someone Else"));
        Assert.Equal(YearRolloverService.PersonKey(null, " Asha Rao "), YearRolloverService.PersonKey(0, "asha rao"));
        Assert.NotEqual(YearRolloverService.PersonKey(12, "Asha Rao"), YearRolloverService.PersonKey(null, "Asha Rao"));
    }

    [Fact]
    public void Undo_is_blocked_by_rows_added_or_edited_after_the_run()
    {
        var run = new[] { ("sub_groups", 10), ("sub_group_members", 100), ("board_of_directors", 7) };
        var rows = new List<YearRolloverService.UndoRow>
        {
            new("sub_group_members", 100, "sub_groups", 10, "Member A", false), // the run's own member
            new("sub_group_members", 101, "sub_groups", 10, "Member B", false), // added later under the run's committee
            new("sub_group_members", 200, "sub_groups", 99, "Member C", false), // under a committee the run did not create
            new("board_of_directors", 7, null, null, "Board entry for D", true), // the run's row, edited later
        };
        Assert.Equal(["Member B was added after the rollover", "Board entry for D was changed after the rollover"],
            YearRolloverService.UndoBlockers(run, rows));
    }

    [Fact]
    public void Undo_is_free_when_only_the_runs_own_rows_exist() =>
        Assert.Empty(YearRolloverService.UndoBlockers([("sub_groups", 10), ("sub_group_members", 100)],
            [new("sub_group_members", 100, "sub_groups", 10, "Member A", false)]));

    [Fact]
    public void Members_are_carried_only_when_picked()
    {
        var picks = new List<RolloverCommitteePick> { new(5, ["m:1", "m:2"]), new(6, null) };
        Assert.Equal(new HashSet<string> { "m:1", "m:2" }, YearRolloverService.PickedKeys(picks, 5));
        Assert.Empty(YearRolloverService.PickedKeys(picks, 6));
        Assert.Empty(YearRolloverService.PickedKeys(picks, 7));
        Assert.Empty(YearRolloverService.PickedKeys(null, 5));
    }
}
