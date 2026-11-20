using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Tests;

public class VolunteerExtrasTests
{
    private static readonly DateTime Start = new(2026, 12, 10, 9, 0, 0), End = new(2026, 12, 10, 12, 0, 0);

    [Fact]
    public void Reminder_IsDueFromNDaysBefore_UntilTheSlotStarts()
    {
        Assert.False(VolunteerExtras(kind: "before", days: 3, now: Start.AddDays(-3).AddMinutes(-1)));
        Assert.True(VolunteerExtras(kind: "before", days: 3, now: Start.AddDays(-3)));
        Assert.True(VolunteerExtras(kind: "before", days: 3, now: Start.AddMinutes(-1)));
        Assert.False(VolunteerExtras(kind: "before", days: 3, now: Start));
    }

    [Fact]
    public void ThankYou_IsDueNDaysAfterTheSlotEnds_ForThirtyDays()
    {
        Assert.False(VolunteerExtras(kind: "after", days: 1, now: End.AddDays(1).AddMinutes(-1)));
        Assert.True(VolunteerExtras(kind: "after", days: 1, now: End.AddDays(1)));
        Assert.True(VolunteerExtras(kind: "after", days: 1, now: End.AddDays(30)));
        Assert.False(VolunteerExtras(kind: "after", days: 1, now: End.AddDays(31)));
        // no end time: counted from the start
        Assert.Equal(Start, VolunteerExtrasService.DueAt("after", 0, Start, null));
    }

    private static bool VolunteerExtras(string kind, int days, DateTime now) =>
        VolunteerExtrasService.IsDue(kind, days, Start, End, now);

    [Theory]
    [InlineData("before", 0)]
    [InlineData("after", -1)]
    [InlineData("after", 91)]
    [InlineData("later", 2)]
    public void Followups_RefuseBadKindOrDays(string kind, int days) =>
        Assert.Throws<InvalidOperationException>(() => VolunteerExtrasService.NormalizeFollowups(
            new() { new VolunteerFollowupDto { Kind = kind, Days = days, Subject = "s", Body = "b" } }));

    [Fact]
    public void Followups_NeedSubjectAndText_AndAtMostFive()
    {
        Assert.Throws<InvalidOperationException>(() => VolunteerExtrasService.NormalizeFollowups(
            new() { new VolunteerFollowupDto { Kind = "after", Days = 1, Subject = "  ", Body = "b" } }));
        Assert.Throws<InvalidOperationException>(() => VolunteerExtrasService.NormalizeFollowups(
            Enumerable.Range(0, 6).Select(_ => new VolunteerFollowupDto { Kind = "after", Days = 1, Subject = "s", Body = "b" }).ToList()));
        var ok = VolunteerExtrasService.NormalizeFollowups(new() { new VolunteerFollowupDto { Kind = "before", Days = 2, Subject = " Hi ", Body = "Text" } });
        Assert.Equal("Hi", ok[0].Subject);
    }

    [Fact]
    public void ClubText_IsEncoded_WithParagraphsAndLineBreaks()
    {
        Assert.Equal("<p>Hello &lt;b&gt;<br>line two</p><p>Para two</p>", VolunteerExtrasService.TextToHtml("Hello <b>\r\nline two\r\n\r\nPara two"));
        Assert.Equal("", VolunteerExtrasService.TextToHtml("   "));
    }
}
