using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Tests;

public class SurveyRulesTests
{
    private static readonly DateTimeOffset Opens = new(2026, 11, 20, 9, 0, 0, TimeSpan.Zero);

    private static SaveSurveyDto Survey(params SurveyQuestionDto[] qs) => new()
    {
        Title = "Meeting venue", OpensAt = Opens, ClosesAt = Opens.AddDays(7), Questions = qs.ToList(),
    };

    private static SurveyQuestionDto Single(int id = 1, bool required = true) =>
        new() { Id = id, Text = "Venue", Type = "single", Required = required, Options = new() { "Hotel", "Club house", "Online" } };

    private static readonly List<SurveyQuestionDto> Questions = new()
    {
        Single(1),
        new() { Id = 2, Text = "Topics", Type = "multiple", Options = new() { "Polio", "Water", "Youth" } },
        new() { Id = 3, Text = "Rate the year", Type = "rating", Required = true },
        new() { Id = 4, Text = "Comments", Type = "text" },
    };

    [Fact]
    public void ValidateSurvey_AcceptsAValidSurvey() => Assert.Null(SurveyRules.ValidateSurvey(Survey(Single())));

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void ValidateSurvey_NeedsATitle(string title)
    {
        var s = Survey(Single());
        s.Title = title;
        Assert.NotNull(SurveyRules.ValidateSurvey(s));
    }

    [Fact]
    public void ValidateSurvey_RefusesBadDatesQuestionsAndOptions()
    {
        var s = Survey(Single());
        s.ClosesAt = s.OpensAt;
        Assert.Contains("close after", SurveyRules.ValidateSurvey(s));
        Assert.NotNull(SurveyRules.ValidateSurvey(Survey()));
        Assert.NotNull(SurveyRules.ValidateSurvey(Survey(new SurveyQuestionDto { Text = "Q", Type = "slider" })));
        Assert.NotNull(SurveyRules.ValidateSurvey(Survey(new SurveyQuestionDto { Text = "Q", Type = "single", Options = new() { "Only one" } })));
        Assert.Contains("repeats", SurveyRules.ValidateSurvey(Survey(new SurveyQuestionDto { Text = "Q", Type = "multiple", Options = new() { "Yes", " yes" } })));
        Assert.NotNull(SurveyRules.ValidateSurvey(Survey(new SurveyQuestionDto { Text = "Q", Type = "text", Options = new() { "a", "b" } })));
    }

    [Fact]
    public void ValidateAnswers_ChecksRequiredRangesAndShapes()
    {
        SurveyAnswerDto A(int q, List<int>? c = null, string? t = null, int? r = null) => new() { QuestionId = q, Choices = c, Text = t, Rating = r };
        Assert.Null(SurveyRules.ValidateAnswers(Questions, new[] { A(1, new() { 2 }), A(2, new() { 0, 2 }), A(3, r: 4), A(4, t: "Good") }));
        Assert.Null(SurveyRules.ValidateAnswers(Questions, new[] { A(1, new() { 0 }), A(3, r: 1) })); // optional ones left out
        Assert.Contains("needs an answer", SurveyRules.ValidateAnswers(Questions, new[] { A(1, new() { 0 }) }));
        Assert.Contains("one choice", SurveyRules.ValidateAnswers(Questions, new[] { A(1, new() { 0, 1 }), A(3, r: 3) }));
        Assert.Contains("not an option", SurveyRules.ValidateAnswers(Questions, new[] { A(1, new() { 3 }), A(3, r: 3) }));
        Assert.Contains("twice", SurveyRules.ValidateAnswers(Questions, new[] { A(1, new() { 0 }), A(2, new() { 1, 1 }), A(3, r: 3) }));
        Assert.Contains("1 to 5", SurveyRules.ValidateAnswers(Questions, new[] { A(1, new() { 0 }), A(3, r: 6) }));
        Assert.Contains("does not have", SurveyRules.ValidateAnswers(Questions, new[] { A(1, new() { 0 }), A(3, r: 3), A(99, t: "x") }));
        Assert.Contains("does not take text", SurveyRules.ValidateAnswers(Questions, new[] { A(1, new() { 0 }, t: "x"), A(3, r: 3) }));
        Assert.Contains("answered twice", SurveyRules.ValidateAnswers(Questions, new[] { A(1, new() { 0 }), A(1, new() { 1 }), A(3, r: 3) }));
    }

    [Fact]
    public void State_FollowsStatusAndTimes()
    {
        var open = new DateTime(2026, 11, 20, 9, 0, 0);
        var close = open.AddDays(1);
        Assert.Equal("draft", SurveyRules.State("draft", open, close, open.AddHours(1)));
        Assert.Equal("scheduled", SurveyRules.State("published", open, close, open.AddHours(-1)));
        Assert.Equal("open", SurveyRules.State("published", open, close, open));
        Assert.Equal("closed", SurveyRules.State("published", open, close, close));
        Assert.Equal("closed", SurveyRules.State("closed", open, close, open.AddHours(1)));
    }

    [Fact]
    public void MemberSeesResults_OnlyWhenSharedAndAnsweredOrClosed()
    {
        Assert.False(SurveyRules.MemberSeesResults(false, true, "closed"));
        Assert.False(SurveyRules.MemberSeesResults(true, false, "open"));
        Assert.True(SurveyRules.MemberSeesResults(true, true, "open"));
        Assert.True(SurveyRules.MemberSeesResults(true, false, "closed"));
    }

    [Fact]
    public void Aggregate_CountsPercentagesAverageAndDropsNamesWhenAnonymous()
    {
        var stored = new[]
        {
            new SurveyRules.StoredAnswer(1, "0", null, null, "Asha"),
            new SurveyRules.StoredAnswer(1, "0", null, null, "Ben"),
            new SurveyRules.StoredAnswer(1, "2", null, null, "Chen"),
            new SurveyRules.StoredAnswer(2, "0,2", null, null, "Asha"),
            new SurveyRules.StoredAnswer(3, null, null, 5, "Asha"),
            new SurveyRules.StoredAnswer(3, null, null, 2, "Ben"),
            new SurveyRules.StoredAnswer(4, null, "zebra", null, "Asha"),
            new SurveyRules.StoredAnswer(4, null, "apple", null, "Ben"),
        };
        var named = SurveyRules.Aggregate(Questions, stored, anonymous: false);
        Assert.Equal(3, named[0].Answered);
        Assert.Equal(new[] { 2, 0, 1 }, named[0].Options.Select(o => o.Count));
        Assert.Equal(66.7m, named[0].Options[0].Percent);
        Assert.Equal(new[] { 1, 0, 1 }, named[1].Options.Select(o => o.Count));
        Assert.Equal(3.5m, named[2].RatingAverage);
        Assert.Equal(5, named[2].Options.Count);
        Assert.Equal("Asha", named[3].TextAnswers[0].Name);

        var anon = SurveyRules.Aggregate(Questions, stored, anonymous: true);
        Assert.All(anon[3].TextAnswers, t => Assert.Null(t.Name));
        Assert.Equal("apple", anon[3].TextAnswers[0].Text); // sorted, not in answer order
    }

    [Fact]
    public void BuildCsv_LabelsChoicesGuardsFormulasAndHidesWhoWhenAnonymous()
    {
        var rows = new[]
        {
            new SurveyRules.CsvResponse("Ben", "ben@example.org", "2026-11-20T10:00:00Z", new()
            {
                new(1, "1", null, null, null), new(2, "0,2", null, null, null), new(3, null, null, 4, null), new(4, null, "=SUM(A1)", null, null),
            }),
            new SurveyRules.CsvResponse("Asha", "asha@example.org", "2026-11-20T09:00:00Z", new() { new(1, "0", null, null, null), new(3, null, null, 5, null) }),
        };
        var csv = SurveyRules.BuildCsv(Questions, rows, anonymous: false);
        var lines = csv.TrimEnd().Split("\r\n");
        Assert.Equal("\"Name\",\"Email\",\"Submitted (UTC)\",\"Venue\",\"Topics\",\"Rate the year\",\"Comments\"", lines[0]);
        Assert.Equal("\"Ben\",\"ben@example.org\",\"2026-11-20T10:00:00Z\",\"Club house\",\"Polio; Youth\",\"4\",\"'=SUM(A1)\"", lines[1]);

        var anon = SurveyRules.BuildCsv(Questions, rows, anonymous: true);
        Assert.DoesNotContain("Ben", anon);
        Assert.DoesNotContain("2026-11-20", anon);
        var anonLines = anon.TrimEnd().Split("\r\n");
        Assert.Equal("\"Venue\",\"Topics\",\"Rate the year\",\"Comments\"", anonLines[0]);
        Assert.StartsWith("\"Club house\"", anonLines[1]); // sorted by content: "Club house" before "Hotel"
    }
}
