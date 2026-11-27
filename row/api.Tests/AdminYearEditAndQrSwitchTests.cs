using RotaryApi.Services;
using Xunit;

namespace RotaryApi.Tests;

/// YWAR-EDIT-YEARS (AdminYearService.PlanYearEdit) and QR-ATTENDANCE (AttendanceQrSwitch.IsOn).
public sealed class AdminYearEditAndQrSwitchTests
{
    private static AdminYearRights Holds(params int[] years) => new() { YearIds = years.ToHashSet() };

    [Fact]
    public void EditYears_OnlyTheEditorsYearsChange_OthersAreKept()
    {
        // Editor holds 10 and 11. Target holds 9 (not the editor's), 10 and 11. Editor picks 11 and nothing else.
        var (refusal, final, kept) = AdminYearService.PlanYearEdit(
            Holds(10, 11), targetHasAllYears: false, new HashSet<int> { 9, 10, 11 }, new[] { 11 }, wantsAllYears: false);

        Assert.Null(refusal);
        Assert.Equal(new[] { 9 }, kept);                      // 9 survives, it is not the editor's to take
        Assert.Equal(new[] { 9, 11 }, final.OrderBy(y => y)); // 10 removed, 11 kept
    }

    [Fact]
    public void EditYears_RefusesAYearTheEditorDoesNotHold()
    {
        var (refusal, _, _) = AdminYearService.PlanYearEdit(
            Holds(10), false, new HashSet<int> { 10 }, new[] { 10, 12 }, false);
        Assert.Equal(403, refusal!.RefusalStatus);
    }

    [Fact]
    public void EditYears_EmptyResultIs400_UseRemoveAdmin()
    {
        var (refusal, _, _) = AdminYearService.PlanYearEdit(
            Holds(10), false, new HashSet<int> { 10 }, Array.Empty<int>(), false);
        Assert.Equal(400, refusal!.RefusalStatus);
    }

    [Fact]
    public void EditYears_OnlySuperAdminTouchesAllYears()
    {
        Assert.NotNull(AdminYearService.PlanYearEdit(Holds(10), false, new HashSet<int>(), new[] { 10 }, true).Refusal);
        Assert.NotNull(AdminYearService.PlanYearEdit(Holds(10), true, new HashSet<int>(), new[] { 10 }, false).Refusal);

        var sa = new AdminYearRights { AllYears = true };
        var (refusal, final, kept) = AdminYearService.PlanYearEdit(sa, false, new HashSet<int> { 9, 10 }, new[] { 12 }, false);
        Assert.Null(refusal);
        Assert.Empty(kept);                 // a SuperAdmin may replace every year
        Assert.Equal(new[] { 12 }, final);
    }

    [Fact]
    public void QrSwitch_OffWhenNoRows() =>
        Assert.False(AttendanceQrSwitch.IsOn(Array.Empty<(int, bool)>(), 5));

    [Fact]
    public void QrSwitch_AllClubsRowTurnsEveryClubOn()
    {
        Assert.True(AttendanceQrSwitch.IsOn(new[] { (0, true) }, 5));
        Assert.False(AttendanceQrSwitch.IsOn(new[] { (0, false) }, 5));
    }

    [Fact]
    public void QrSwitch_TestClubListOnlyCoversListedClubs()
    {
        var rows = new[] { (0, false), (5, true), (6, false) };
        Assert.True(AttendanceQrSwitch.IsOn(rows, 5));
        Assert.False(AttendanceQrSwitch.IsOn(rows, 6));
        Assert.False(AttendanceQrSwitch.IsOn(rows, 7));
    }
}
