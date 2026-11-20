using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Tests;

public class SpeakerBureauTests
{
    private static BureauEntryDto Entry(int id, string name, string topics, string languages = "English",
        bool online = false, bool inPerson = true) =>
        new() { Id = id, Name = name, Topics = topics, Languages = languages, AvailableOnline = online, AvailableInPerson = inPerson };

    [Fact]
    public void Stats_average_counts_rated_talks_only_and_rounds_to_one_decimal()
    {
        var a = Entry(1, "A", "water");
        var b = Entry(2, "B", "polio");
        var c = Entry(3, "C", "peace");
        SpeakerBureauService.ApplyStats(new[] { a, b, c }, new (int, int?)[] { (1, 5), (1, 4), (1, 4), (1, null), (2, null) });
        Assert.Equal(4.3, a.AverageRating);
        Assert.Equal(3, a.RatingCount);
        Assert.Equal(4, a.TalkCount);
        Assert.Null(b.AverageRating);
        Assert.Equal(0, b.RatingCount);
        Assert.Equal(1, b.TalkCount);
        Assert.Null(c.AverageRating);
        Assert.Equal(0, c.TalkCount);
    }

    [Fact]
    public void Rating_is_refused_when_the_club_already_rated_that_talk()
    {
        var today = new DateTime(2026, 11, 19);
        Assert.Null(SpeakerBureauService.CheckRating(4, today.AddDays(-3), today, false));
        Assert.NotNull(SpeakerBureauService.CheckRating(4, today.AddDays(-3), today, true));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(6)]
    public void Rating_outside_one_to_five_is_refused(int rating) =>
        Assert.NotNull(SpeakerBureauService.CheckRating(rating, new DateTime(2026, 11, 1), new DateTime(2026, 11, 19), false));

    [Fact]
    public void Rating_a_future_talk_is_refused_with_one_day_of_slack()
    {
        var today = new DateTime(2026, 11, 19);
        Assert.Null(SpeakerBureauService.CheckRating(3, today.AddDays(1), today, false));
        Assert.NotNull(SpeakerBureauService.CheckRating(3, today.AddDays(2), today, false));
    }

    private static List<BureauEntryDto> Bureau()
    {
        var list = new List<BureauEntryDto>
        {
            Entry(1, "Asha", "Water and sanitation, Polio", "English, Hindi", online: true),
            Entry(2, "Ben", "Polio eradication", "English", inPerson: true),
            Entry(3, "Chen", "Peacebuilding", "French", online: true, inPerson: false),
            Entry(4, "Dee", "Polio", "Hindi"),
        };
        SpeakerBureauService.ApplyStats(list, new (int, int?)[] { (1, 4), (2, 5), (3, 2), (4, 4), (4, null), (4, null) });
        return list;
    }

    [Fact]
    public void Search_sorts_by_rating_then_talks_then_name()
    {
        var ids = SpeakerBureauService.Search(Bureau(), new BureauSearchDto()).Select(e => e.Id);
        Assert.Equal(new[] { 2, 4, 1, 3 }, ids);
    }

    [Fact]
    public void Search_filters_topic_language_mode_and_rating()
    {
        var all = Bureau();
        Assert.Equal(new[] { 2, 4, 1 }, SpeakerBureauService.Search(all, new BureauSearchDto { Topic = "polio" }).Select(e => e.Id));
        Assert.Equal(new[] { 4, 1 }, SpeakerBureauService.Search(all, new BureauSearchDto { Language = "hindi" }).Select(e => e.Id));
        // A language matches a whole tag only: "Eng" is not English.
        Assert.Empty(SpeakerBureauService.Search(all, new BureauSearchDto { Language = "Eng" }));
        Assert.Equal(new[] { 1, 3 }, SpeakerBureauService.Search(all, new BureauSearchDto { Mode = "online" }).Select(e => e.Id));
        Assert.Equal(new[] { 2, 4, 1 }, SpeakerBureauService.Search(all, new BureauSearchDto { Mode = "in_person" }).Select(e => e.Id));
        Assert.Equal(new[] { 2 }, SpeakerBureauService.Search(all, new BureauSearchDto { MinRating = 4.5 }).Select(e => e.Id));
        Assert.Equal(new[] { 4, 1 }, SpeakerBureauService.Search(all,
            new BureauSearchDto { Topic = "polio", Language = "Hindi", Mode = "in_person", MinRating = 4 }).Select(e => e.Id));
    }

    [Fact]
    public void Tags_are_trimmed_and_deduplicated()
    {
        Assert.Equal("Polio, water", SpeakerBureauService.CleanTags(" Polio ,water, polio,,Water ", "Topics"));
        Assert.Throws<InvalidOperationException>(() => SpeakerBureauService.CleanTags("a,b,c", "Languages", 2));
    }

    [Fact]
    public void Booking_date_is_needed_and_within_two_years_ahead_one_year_back()
    {
        var today = new DateTime(2026, 11, 19);
        Assert.NotNull(SpeakerBureauService.CheckBookingDate(default, today));
        Assert.Null(SpeakerBureauService.CheckBookingDate(today.AddDays(30), today));
        Assert.Null(SpeakerBureauService.CheckBookingDate(today.AddDays(-30), today));
        Assert.NotNull(SpeakerBureauService.CheckBookingDate(today.AddYears(2).AddDays(1), today));
        Assert.NotNull(SpeakerBureauService.CheckBookingDate(today.AddYears(-1).AddDays(-1), today));
    }
}
