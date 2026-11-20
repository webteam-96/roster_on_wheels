using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Tests;

public class BulletinTests
{
    [Fact]
    public void Validate_RejectsBadDrafts()
    {
        Assert.Null(BulletinService.Validate(new BulletinDto { Title = "Week 47" }));
        Assert.NotNull(BulletinService.Validate(new BulletinDto { Title = "  " }));
        Assert.NotNull(BulletinService.Validate(new BulletinDto { Title = "x", Layout = "fancy" }));
        Assert.NotNull(BulletinService.Validate(new BulletinDto { Title = new string('a', 201) }));
        Assert.NotNull(BulletinService.Validate(new BulletinDto { Title = "x", EventIds = Enumerable.Range(1, 21).ToList() }));
    }

    [Fact]
    public void InPickedOrder_KeepsTheManagersOrder_AndDropsUnknownIds()
    {
        var rows = new[] { new BulletinItem { Id = 1, Title = "a" }, new BulletinItem { Id = 2, Title = "b" }, new BulletinItem { Id = 3, Title = "c" } };
        var picked = BulletinService.InPickedOrder(rows, r => r.Id, new List<int> { 3, 99, 1 });
        Assert.Equal(new[] { "c", "a" }, picked.Select(r => r.Title));
    }

    [Fact]
    public void ParseIds_IgnoresJunk()
    {
        Assert.Equal(new[] { 4, 2 }, BulletinService.ParseIds("4,x,,-1,2"));
        Assert.Empty(BulletinService.ParseIds(null));
    }

    [Fact]
    public void BirthdayKeys_CrossNewYear_AndCover29Feb()
    {
        Assert.Equal(new[] { "1229", "1230", "1231", "0101", "0102", "0103", "0104" },
            BulletinService.BirthdayKeys(new DateTime(2026, 12, 29), 7));
        Assert.Contains("0229", BulletinService.BirthdayKeys(new DateTime(2027, 2, 27), 3));
        Assert.DoesNotContain("0229", BulletinService.BirthdayKeys(new DateTime(2028, 2, 27), 2));
    }

    [Fact]
    public void Compose_EncodesUserText_AndSkipsEmptySections()
    {
        var html = BulletinHtml.Compose(new BulletinContent
        {
            ClubName = "Club", Title = "<script>alert(1)</script>",
            Announcements = { new BulletinItem { Title = "Fair & fun" } },
            Birthdays = { new BulletinItem { Title = "Asha", Date = new DateTime(1980, 11, 21) } },
        });
        Assert.DoesNotContain("<script>", html);
        Assert.Contains("Club news", html);
        Assert.Contains("Birthdays this week", html);
        Assert.Contains("21 November", html);
        Assert.DoesNotContain("Upcoming events", html);
    }

    [Fact]
    public void IsNonOpener_OnlyDeliveredUnopenedReachableAddresses()
    {
        ClubMassEmailService.ResendCandidate R() => new() { Status = "Sent", DeliveryStatus = "Delivered", Email = "a@b.c" };
        Assert.True(ClubMassEmailService.IsNonOpener(R()));
        var opened = R(); opened.OpenCount = 1; Assert.False(ClubMassEmailService.IsNonOpener(opened));
        var clicked = R(); clicked.ClickCount = 1; Assert.False(ClubMassEmailService.IsNonOpener(clicked));
        var bounced = R(); bounced.DeliveryStatus = "HardBounce"; Assert.False(ClubMassEmailService.IsNonOpener(bounced));
        var suppressed = R(); suppressed.Suppressed = true; Assert.False(ClubMassEmailService.IsNonOpener(suppressed));
        var optedOut = R(); optedOut.OptedOut = true; Assert.False(ClubMassEmailService.IsNonOpener(optedOut));
        var failed = R(); failed.Status = "Failed"; Assert.False(ClubMassEmailService.IsNonOpener(failed));
    }

    [Fact]
    public void EditorOffice_PublicImageOrEditorOrBulletin()
    {
        Assert.True(StoryService.IsEditorOffice("Club Public Image Chair", null));
        Assert.True(StoryService.IsEditorOffice("Director", "Bulletin Editor"));
        Assert.False(StoryService.IsEditorOffice("Club Treasurer", null));
        Assert.False(StoryService.IsEditorOffice(null, "  "));
    }

    [Fact]
    public void Review_NeedsADecision_AndANoteUnlessApproved()
    {
        Assert.Null(StoryService.ValidateReview(new StoryReviewDto { Decision = "approve" }));
        Assert.NotNull(StoryService.ValidateReview(new StoryReviewDto { Decision = "reject" }));
        Assert.Null(StoryService.ValidateReview(new StoryReviewDto { Decision = "changes", Note = "Shorter please" }));
        Assert.NotNull(StoryService.ValidateReview(new StoryReviewDto { Decision = "publish" }));
        Assert.NotNull(StoryService.Validate(new StoryDto { Title = "t", Body = " " }));
    }

    [Theory]
    [InlineData(" Asha@Example.ORG ", "asha@example.org")]
    [InlineData("no-at-sign", null)]
    [InlineData("a@b", null)]
    [InlineData("two@@example.org", null)]
    [InlineData("sp ace@example.org", null)]
    public void NormaliseEmail(string input, string? expected) => Assert.Equal(expected, BulletinSubscriberService.NormaliseEmail(input));

    [Fact]
    public void UnsubscribeToken_RoundTrips_AndRejectsTampering()
    {
        var secret = new string('k', 40);
        var t = BulletinSubscriberService.UnsubscribeToken(42, secret);
        Assert.Equal(42, BulletinSubscriberService.UnsubscribeSubscriber(t, secret));
        Assert.Null(BulletinSubscriberService.UnsubscribeSubscriber("43" + t[2..], secret));
        Assert.Null(BulletinSubscriberService.UnsubscribeSubscriber(t, new string('x', 40)));
        Assert.Null(BulletinSubscriberService.UnsubscribeSubscriber(t, "short"));
        // a member unsubscribe token (CommsService) is not a subscriber token
        Assert.Null(BulletinSubscriberService.UnsubscribeSubscriber(CommsService.UnsubscribeToken(42, secret), secret));
    }

    [Fact]
    public void SubscriberFooter_EncodesClubName_AndCarriesTheLink()
    {
        var html = BulletinSubscriberService.WithFooter("<p>x</p>", "A&B <Club>", "https://api.example/u/1.abc");
        Assert.Contains("A&amp;B &lt;Club&gt;", html);
        Assert.Contains("href=\"https://api.example/u/1.abc\"", html);
    }

    [Fact]
    public void Compose_ShowsStories()
    {
        var html = BulletinHtml.Compose(new BulletinContent { ClubName = "C", Title = "T", Stories = { new BulletinItem { Title = "Our trip", Text = "We went" } } });
        Assert.Contains("Stories from our members", html);
        Assert.Contains("Our trip", html);
    }
}
