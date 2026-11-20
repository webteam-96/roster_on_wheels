namespace RotaryApi.DTOs;

// Surveys and polls (gap #9). Times go out as UTC strings with "Z"; clients send them with an offset (or "Z") from
// the viewer's own zone.

public class SurveyQuestionDto
{
    public int Id { get; set; }
    public string? Text { get; set; }
    /// <summary>single, multiple, text or rating (1 to 5).</summary>
    public string? Type { get; set; }
    public bool Required { get; set; }
    public List<string>? Options { get; set; }
}

public class SaveSurveyDto
{
    public string? Title { get; set; }
    public string? Description { get; set; }
    /// <summary>Club surveys only: limit the audience to this sub group of the club.</summary>
    public int? SubGroupId { get; set; }
    public bool IsAnonymous { get; set; }
    /// <summary>Members see the results after they answer.</summary>
    public bool ShowResults { get; set; }
    public DateTimeOffset? OpensAt { get; set; }
    public DateTimeOffset? ClosesAt { get; set; }
    public List<SurveyQuestionDto>? Questions { get; set; }
}

public class SurveyAnswerDto
{
    public int QuestionId { get; set; }
    /// <summary>Option indexes (0-based) for single and multiple choice.</summary>
    public List<int>? Choices { get; set; }
    public string? Text { get; set; }
    public int? Rating { get; set; }
}

public class SubmitSurveyDto
{
    public List<SurveyAnswerDto>? Answers { get; set; }
}

public class SurveyDto
{
    public int Id { get; set; }
    public int? ClubId { get; set; }
    public int? DistrictId { get; set; }
    public int? SubGroupId { get; set; }
    public string? SubGroupName { get; set; }
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    public bool IsAnonymous { get; set; }
    public bool ShowResults { get; set; }
    /// <summary>draft, scheduled, open or closed.</summary>
    public string State { get; set; } = "";
    public string OpensAt { get; set; } = "";
    public string ClosesAt { get; set; } = "";
    public int ResponseCount { get; set; }
    public int? AudienceCount { get; set; }
    public bool Answered { get; set; }
    public bool CanSeeResults { get; set; }
    public List<SurveyQuestionDto>? Questions { get; set; }
    public List<SurveyAnswerDto>? MyAnswers { get; set; }
}

public class SurveyOptionResultDto
{
    public string Label { get; set; } = "";
    public int Count { get; set; }
    public decimal Percent { get; set; }
}

public class SurveyTextAnswerDto
{
    public string Text { get; set; } = "";
    /// <summary>Always null for anonymous surveys.</summary>
    public string? Name { get; set; }
}

public class SurveyQuestionResultDto
{
    public int QuestionId { get; set; }
    public string Text { get; set; } = "";
    public string Type { get; set; } = "";
    /// <summary>Respondents who answered this question.</summary>
    public int Answered { get; set; }
    public List<SurveyOptionResultDto> Options { get; set; } = new();
    public decimal? RatingAverage { get; set; }
    public List<SurveyTextAnswerDto> TextAnswers { get; set; } = new();
}

public class SurveyResultsDto
{
    public int SurveyId { get; set; }
    public string Title { get; set; } = "";
    public bool IsAnonymous { get; set; }
    public int ResponseCount { get; set; }
    public int AudienceCount { get; set; }
    /// <summary>Responses as a percentage of the audience.</summary>
    public decimal ResponseRate { get; set; }
    public List<SurveyQuestionResultDto> Questions { get; set; } = new();
}

public class SurveySubGroupDto
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
}
