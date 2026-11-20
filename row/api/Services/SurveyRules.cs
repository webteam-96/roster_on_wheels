using RotaryApi.DTOs;

namespace RotaryApi.Services;

/// <summary>Pure survey rules (no database): survey and answer validation, result aggregation. Unit tested in
/// api.Tests/SurveyRulesTests.cs.</summary>
public static class SurveyRules
{
    public static readonly string[] Types = { "single", "multiple", "text", "rating" };
    public const int MaxQuestions = 50, MaxOptions = 20, MaxTextAnswer = 2000;

    public static bool IsChoice(string? type) => type is "single" or "multiple";

    /// <summary>An error message, or null when the survey can be saved.</summary>
    public static string? ValidateSurvey(SaveSurveyDto d)
    {
        var title = d.Title?.Trim() ?? "";
        if (title.Length is 0 or > 200) return "Give the survey a title of up to 200 characters.";
        if ((d.Description?.Length ?? 0) > 2000) return "The description can be up to 2000 characters.";
        if (d.OpensAt is null || d.ClosesAt is null) return "Set when the survey opens and closes.";
        if (d.ClosesAt <= d.OpensAt) return "The survey must close after it opens.";
        var qs = d.Questions ?? new();
        if (qs.Count is 0 or > MaxQuestions) return $"Add between 1 and {MaxQuestions} questions.";
        for (var i = 0; i < qs.Count; i++)
        {
            var q = qs[i];
            var n = i + 1;
            var text = q.Text?.Trim() ?? "";
            if (text.Length is 0 or > 500) return $"Question {n} needs text of up to 500 characters.";
            if (!Types.Contains(q.Type)) return $"Question {n} has an unknown type.";
            var options = q.Options ?? new();
            if (IsChoice(q.Type))
            {
                if (options.Count < 2 || options.Count > MaxOptions) return $"Question {n} needs between 2 and {MaxOptions} options.";
                if (options.Any(o => string.IsNullOrWhiteSpace(o) || o.Trim().Length > 200)) return $"Question {n} has an empty or too long option.";
                if (options.Select(o => o.Trim().ToLowerInvariant()).Distinct().Count() != options.Count) return $"Question {n} repeats an option.";
            }
            else if (options.Count > 0) return $"Question {n} does not take options.";
        }
        return null;
    }

    /// <summary>An error message, or null when the answers fit the questions: every required question answered,
    /// choices in range, one choice for single choice, rating 1 to 5, text within length.</summary>
    public static string? ValidateAnswers(IReadOnlyList<SurveyQuestionDto> questions, IReadOnlyList<SurveyAnswerDto> answers)
    {
        var byId = questions.ToDictionary(q => q.Id);
        if (answers.Select(a => a.QuestionId).Distinct().Count() != answers.Count) return "A question is answered twice.";
        foreach (var a in answers)
        {
            if (!byId.TryGetValue(a.QuestionId, out var q)) return "An answer is for a question this survey does not have.";
            var choices = a.Choices ?? new();
            var count = q.Options?.Count ?? 0;
            switch (q.Type)
            {
                case "single":
                    if (choices.Count > 1) return $"\"{q.Text}\" takes one choice.";
                    if (choices.Any(c => c < 0 || c >= count)) return $"\"{q.Text}\" has a choice that is not an option.";
                    break;
                case "multiple":
                    if (choices.Distinct().Count() != choices.Count) return $"\"{q.Text}\" has a choice twice.";
                    if (choices.Any(c => c < 0 || c >= count)) return $"\"{q.Text}\" has a choice that is not an option.";
                    break;
                case "rating":
                    if (a.Rating is < 1 or > 5) return $"\"{q.Text}\" takes a rating from 1 to 5.";
                    break;
                case "text":
                    if ((a.Text?.Trim().Length ?? 0) > MaxTextAnswer) return $"\"{q.Text}\" takes up to {MaxTextAnswer} characters.";
                    break;
            }
            if (q.Type != "text" && !string.IsNullOrWhiteSpace(a.Text)) return $"\"{q.Text}\" does not take text.";
            if (q.Type != "rating" && a.Rating is not null) return $"\"{q.Text}\" does not take a rating.";
            if (!IsChoice(q.Type) && choices.Count > 0) return $"\"{q.Text}\" does not take choices.";
        }
        foreach (var q in questions.Where(q => q.Required))
        {
            var a = answers.FirstOrDefault(x => x.QuestionId == q.Id);
            if (a is null || !HasValue(q, a)) return $"\"{q.Text}\" needs an answer.";
        }
        return null;
    }

    public static bool HasValue(SurveyQuestionDto q, SurveyAnswerDto a) => q.Type switch
    {
        "single" or "multiple" => a.Choices is { Count: > 0 },
        "rating" => a.Rating is not null,
        _ => !string.IsNullOrWhiteSpace(a.Text),
    };

    /// <summary>One stored answer; Name is the respondent's (null for anonymous surveys).</summary>
    public sealed record StoredAnswer(int QuestionId, string? Choices, string? Text, int? Rating, string? Name);

    public static List<int> ParseChoices(string? choices) =>
        string.IsNullOrEmpty(choices) ? new() : choices.Split(',').Select(int.Parse).ToList();

    /// <summary>Counts and percentages per option (of the respondents who answered that question), rating average,
    /// text answers. Names are dropped when anonymous, whatever the caller passed.</summary>
    public static List<SurveyQuestionResultDto> Aggregate(IReadOnlyList<SurveyQuestionDto> questions, IEnumerable<StoredAnswer> answers, bool anonymous)
    {
        var byQuestion = answers.GroupBy(a => a.QuestionId).ToDictionary(g => g.Key, g => g.ToList());
        var results = new List<SurveyQuestionResultDto>();
        foreach (var q in questions)
        {
            var list = byQuestion.TryGetValue(q.Id, out var l) ? l : new();
            var r = new SurveyQuestionResultDto { QuestionId = q.Id, Text = q.Text ?? "", Type = q.Type ?? "" };
            if (IsChoice(q.Type))
            {
                var picks = list.Select(a => ParseChoices(a.Choices)).Where(c => c.Count > 0).ToList();
                r.Answered = picks.Count;
                r.Options = (q.Options ?? new()).Select((label, i) =>
                {
                    var count = picks.Count(p => p.Contains(i));
                    return new SurveyOptionResultDto { Label = label, Count = count, Percent = Percent(count, r.Answered) };
                }).ToList();
            }
            else if (q.Type == "rating")
            {
                var ratings = list.Where(a => a.Rating is not null).Select(a => a.Rating!.Value).ToList();
                r.Answered = ratings.Count;
                r.RatingAverage = ratings.Count == 0 ? null : Math.Round((decimal)ratings.Average(), 2);
                r.Options = Enumerable.Range(1, 5).Select(v =>
                {
                    var count = ratings.Count(x => x == v);
                    return new SurveyOptionResultDto { Label = v.ToString(), Count = count, Percent = Percent(count, ratings.Count) };
                }).ToList();
            }
            else
            {
                var texts = list.Where(a => !string.IsNullOrWhiteSpace(a.Text)).ToList();
                r.Answered = texts.Count;
                r.TextAnswers = texts.Select(a => new SurveyTextAnswerDto { Text = a.Text!, Name = anonymous ? null : a.Name }).ToList();
                // Anonymous text answers are listed in text order so their order says nothing about who answered when.
                if (anonymous) r.TextAnswers = r.TextAnswers.OrderBy(t => t.Text, StringComparer.OrdinalIgnoreCase).ToList();
            }
            results.Add(r);
        }
        return results;
    }

    public static decimal Percent(int count, int of) => of == 0 ? 0 : Math.Round(count * 100m / of, 1);

    /// <summary>draft; scheduled (published, not yet open); open; closed (closed by hand or past its closing time).</summary>
    public static string State(string status, DateTime opensAt, DateTime closesAt, DateTime nowUtc) =>
        status == "draft" ? "draft"
        : status == "closed" || nowUtc >= closesAt ? "closed"
        : nowUtc < opensAt ? "scheduled"
        : "open";

    /// <summary>Members see results only when the survey shares them, and then only after answering or once it closed.</summary>
    public static bool MemberSeesResults(bool showResults, bool answered, string state) => showResults && (answered || state == "closed");

    public sealed record CsvResponse(string? Name, string? Email, string SubmittedAt, List<StoredAnswer> Answers);

    /// <summary>One row per response, one column per question (choices by label, joined with "; "). Anonymous surveys have
    /// no name, email or time columns and their rows are sorted by content, so neither row order nor time says who
    /// answered.</summary>
    public static string BuildCsv(IReadOnlyList<SurveyQuestionDto> questions, IEnumerable<CsvResponse> responses, bool anonymous)
    {
        var head = (anonymous ? Array.Empty<string>() : new[] { "Name", "Email", "Submitted (UTC)" }).Concat(questions.Select(q => q.Text ?? ""));
        var lines = responses.Select(r =>
        {
            var byQ = r.Answers.ToDictionary(a => a.QuestionId);
            var cells = questions.Select(q => !byQ.TryGetValue(q.Id, out var a) ? ""
                : IsChoice(q.Type) ? string.Join("; ", ParseChoices(a.Choices).Where(i => i < (q.Options?.Count ?? 0)).Select(i => q.Options![i]))
                : q.Type == "rating" ? a.Rating?.ToString() ?? ""
                : a.Text ?? "");
            return string.Join(",", (anonymous ? Array.Empty<string>() : new[] { r.Name, r.Email, r.SubmittedAt }).Concat(cells).Select(Csv));
        });
        if (anonymous) lines = lines.OrderBy(l => l, StringComparer.Ordinal);
        return string.Join("\r\n", lines.Prepend(string.Join(",", head.Select(Csv)))) + "\r\n";
    }

    // Quotes every cell; a cell starting with = + - @ is prefixed with ' so a spreadsheet never runs it as a formula.
    public static string Csv(string? v)
    {
        v ??= "";
        if (v.Length > 0 && "=+-@\t\r".Contains(v[0])) v = "'" + v;
        return "\"" + v.Replace("\"", "\"\"") + "\"";
    }
}
