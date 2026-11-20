using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Tests;

public class ProspectFollowUpTests
{
    private static readonly DateTime Due = new(2026, 12, 10);

    [Theory]
    [InlineData(1, "2026-12-08", false)]
    [InlineData(1, "2026-12-09", true)]
    [InlineData(0, "2026-12-09", false)]
    [InlineData(0, "2026-12-10", true)]
    [InlineData(3, "2026-12-20", true)]   // overdue and never reminded: remind now
    public void Reminder_goes_out_on_the_chosen_day_or_later(int daysBefore, string today, bool due) =>
        Assert.Equal(due, ProspectFollowUpService.ReminderDue(Due, daysBefore, DateTime.Parse(today)));

    [Fact]
    public void No_reminder_when_none_was_asked_for() =>
        Assert.False(ProspectFollowUpService.ReminderDue(Due, null, Due.AddDays(5)));

    [Fact]
    public void Validate_trims_and_keeps_the_day_only()
    {
        var v = ProspectFollowUpService.Validate("  Call about the next meeting ", " ", Due.AddHours(15), 2);
        Assert.Equal("Call about the next meeting", v.Title);
        Assert.Null(v.Notes);
        Assert.Equal(Due, v.DueDate);
        Assert.Equal(2, v.RemindDaysBefore);
    }

    [Theory]
    [InlineData("", 1, 2026)]
    [InlineData("Call", 31, 2026)]
    [InlineData("Call", -1, 2026)]
    [InlineData("Call", 1, 1)]
    public void Validate_refuses_bad_input(string title, int remind, int year) =>
        Assert.Throws<ArgumentException>(() => ProspectFollowUpService.Validate(title, null, new DateTime(year, 1, 1), remind));

    [Fact]
    public void Validate_refuses_a_title_over_200_characters() =>
        Assert.Throws<ArgumentException>(() => ProspectFollowUpService.Validate(new string('a', 201), null, Due, null));

    [Fact]
    public void Recipients_merge_roles_and_members_once_and_skip_the_actor()
    {
        var s = new ProspectNotifySettingsDto { ToPresident = true, ToMembershipChair = true, MemberIds = new() { 7, 9, 0 } };
        Assert.Equal(new[] { 1, 2, 7, 9 }, ProspectFollowUpService.Recipients(s, new[] { 1 }, new[] { 2, 1 }, actor: null));
        Assert.Equal(new[] { 2, 7, 9 }, ProspectFollowUpService.Recipients(s, new[] { 1 }, new[] { 2 }, actor: 1));
    }

    [Fact]
    public void Recipients_leave_out_roles_that_are_switched_off()
    {
        var s = new ProspectNotifySettingsDto { ToPresident = false, ToMembershipChair = false, MemberIds = new() { 5 } };
        Assert.Equal(new[] { 5 }, ProspectFollowUpService.Recipients(s, new[] { 1 }, new[] { 2 }, actor: null));
    }
}
