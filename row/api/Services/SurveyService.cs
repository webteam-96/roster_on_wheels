using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

/// <summary>
/// Surveys and polls (gap #9) for a club (its active members, or one of its sub groups) or a district (its officers:
/// this year's district committee and Assistant Governors). Admins build a draft, publish it (questions are then fixed,
/// since answers point at options by index), and read results or a CSV. Members answer in the app; publishing writes one
/// survey_notifications row per member of the audience, which the app's bell reads (MobileNotificationFeedService) from
/// the time the survey opens. Anonymous surveys keep the member id only to allow one response each: no API, result or
/// CSV ever returns it. Who may call what: SurveysController. Rules and aggregation: SurveyRules.
/// </summary>
// shortcut: in-app bell only, no push or email for a new survey; add a push leg like the announcement push if clubs ask.
public class SurveyService
{
    private readonly string _cs;

    public SurveyService(IConfiguration config) => _cs = config.GetConnectionString("DefaultConnection")!;

    /// <summary>A club (ClubId) or a district (DistrictId) owning surveys.</summary>
    public readonly record struct Owner(int? ClubId, int? DistrictId)
    {
        public static Owner Club(int id) => new(id, null);
        public static Owner District(int id) => new(null, id);
    }

    private const string CurrentYear = "(SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND COALESCE(isdeleted, 0) = 0 LIMIT 1)";

    // The audience as member ids, for one survey row s (columns fk_club_id, fk_district_id, fk_sub_group_id).
    private const string AudienceSql = @"
        SELECT cm.fk_member_master_profile_id FROM club_members cm
        JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
        WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND IFNULL(cm.isdeleted, 0) = 0
          AND (@SubGroupId IS NULL OR cm.fk_member_master_profile_id IN
               (SELECT fk_member_master_profile_id FROM sub_group_members WHERE fk_sub_group_id = @SubGroupId AND isdeleted = 0))
        UNION
        SELECT fk_member_id FROM district_committee_member
        WHERE @ClubId IS NULL AND fk_district_id = @DistrictId AND isdeleted = 0 AND IFNULL(is_active, 1) = 1 AND fk_member_id > 0
          AND fk_year_id = " + CurrentYear + @"
        UNION
        SELECT fk_member_id FROM district_ag
        WHERE @ClubId IS NULL AND fk_district_id = @DistrictId AND isdeleted = 0 AND IFNULL(is_active, 1) = 1 AND fk_member_id > 0
          AND fk_year_id = " + CurrentYear;

    // The same audience rule as a predicate on survey s for member @MemberId (the app's list and the answer check).
    private const string MemberInAudience = @"(
        (s.fk_club_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM club_members cm JOIN club_master cl ON cl.pk_club_id = cm.fk_club_id AND cl.IsActive = 1 AND IFNULL(cl.isdeleted, 0) = 0
            WHERE cm.fk_club_id = s.fk_club_id AND cm.fk_member_master_profile_id = @MemberId AND cm.IsActive = 1 AND IFNULL(cm.isdeleted, 0) = 0)
         AND (s.fk_sub_group_id IS NULL OR EXISTS (
            SELECT 1 FROM sub_group_members g WHERE g.fk_sub_group_id = s.fk_sub_group_id AND g.fk_member_master_profile_id = @MemberId AND g.isdeleted = 0)))
        OR (s.fk_club_id IS NULL AND (
            EXISTS (SELECT 1 FROM district_committee_member d WHERE d.fk_district_id = s.fk_district_id AND d.fk_member_id = @MemberId
                    AND d.isdeleted = 0 AND IFNULL(d.is_active, 1) = 1 AND d.fk_year_id = " + CurrentYear + @")
            OR EXISTS (SELECT 1 FROM district_ag a WHERE a.fk_district_id = s.fk_district_id AND a.fk_member_id = @MemberId
                    AND a.isdeleted = 0 AND IFNULL(a.is_active, 1) = 1 AND a.fk_year_id = " + CurrentYear + @"))))";

    private const string SurveySelect = @"
        SELECT s.pk_survey_id AS Id, s.fk_club_id AS ClubId, s.fk_district_id AS DistrictId, s.fk_sub_group_id AS SubGroupId,
               g.GroupName AS SubGroupName, s.title AS Title, s.description AS Description, s.is_anonymous AS IsAnonymous,
               s.show_results AS ShowResults, s.status AS Status, s.opens_at AS OpensAt, s.closes_at AS ClosesAt,
               (SELECT COUNT(*) FROM survey_responses r WHERE r.fk_survey_id = s.pk_survey_id) AS ResponseCount
        FROM surveys s LEFT JOIN sub_groups g ON g.pk_sub_group_id = s.fk_sub_group_id";

    private const string OwnerWhere = "((@ClubId IS NOT NULL AND s.fk_club_id = @ClubId) OR (@ClubId IS NULL AND s.fk_club_id IS NULL AND s.fk_district_id = @DistrictId))";

    private sealed class Row
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
        public string Status { get; set; } = "";
        public DateTime OpensAt { get; set; }
        public DateTime ClosesAt { get; set; }
        public int ResponseCount { get; set; }
    }

    private sealed class QuestionRow
    {
        public int Id { get; set; }
        public string Text { get; set; } = "";
        public string Type { get; set; } = "";
        public bool Required { get; set; }
        public string? OptionsJson { get; set; }
    }

    internal static string Utc(DateTime d) => DateTime.SpecifyKind(d, DateTimeKind.Utc).ToString("yyyy-MM-dd'T'HH:mm:ss'Z'");

    private static SurveyDto ToDto(Row r) => new()
    {
        Id = r.Id, ClubId = r.ClubId, DistrictId = r.DistrictId, SubGroupId = r.SubGroupId, SubGroupName = r.SubGroupName,
        Title = r.Title, Description = r.Description, IsAnonymous = r.IsAnonymous, ShowResults = r.ShowResults,
        State = SurveyRules.State(r.Status, r.OpensAt, r.ClosesAt, DateTime.UtcNow),
        OpensAt = Utc(r.OpensAt), ClosesAt = Utc(r.ClosesAt), ResponseCount = r.ResponseCount,
    };

    private static async Task<List<SurveyQuestionDto>> QuestionsAsync(MySqlConnection c, int surveyId, MySqlTransaction? tx = null) =>
        (await c.QueryAsync<QuestionRow>(@"
            SELECT pk_question_id AS Id, question_text AS Text, question_type AS Type, is_required AS Required, options_json AS OptionsJson
            FROM survey_questions WHERE fk_survey_id = @surveyId ORDER BY sort_order, pk_question_id", new { surveyId }, tx))
        .Select(q => new SurveyQuestionDto
        {
            Id = q.Id, Text = q.Text, Type = q.Type, Required = q.Required,
            Options = string.IsNullOrEmpty(q.OptionsJson) ? new() : System.Text.Json.JsonSerializer.Deserialize<List<string>>(q.OptionsJson) ?? new(),
        }).ToList();

    private static Task<Row?> FindAsync(MySqlConnection c, Owner o, int id, MySqlTransaction? tx = null) =>
        c.QueryFirstOrDefaultAsync<Row>(SurveySelect + " WHERE s.pk_survey_id = @id AND " + OwnerWhere, new { id, o.ClubId, o.DistrictId }, tx);

    private static async Task<List<int>> AudienceAsync(MySqlConnection c, Row r, MySqlTransaction? tx = null) =>
        (await c.QueryAsync<int>(AudienceSql, new { r.ClubId, r.DistrictId, r.SubGroupId }, tx)).ToList();

    // ===== Admins =====

    public async Task<List<SurveyDto>> ListAsync(Owner o)
    {
        await using var c = RowDb.Connect(_cs);
        return (await c.QueryAsync<Row>(SurveySelect + " WHERE " + OwnerWhere + " ORDER BY s.created_at DESC, s.pk_survey_id DESC", new { o.ClubId, o.DistrictId }))
            .Select(ToDto).ToList();
    }

    /// <summary>This club's sub groups (the audience choices beside "all members").</summary>
    public async Task<List<SurveySubGroupDto>> SubGroupsAsync(int clubId)
    {
        await using var c = RowDb.Connect(_cs);
        return (await c.QueryAsync<SurveySubGroupDto>(
            "SELECT pk_sub_group_id AS Id, GroupName AS Name FROM sub_groups WHERE fk_club_id = @clubId AND isdeleted = 0 ORDER BY GroupName", new { clubId })).ToList();
    }

    public async Task<SurveyDto?> GetAsync(Owner o, int id)
    {
        await using var c = RowDb.Connect(_cs);
        if (await FindAsync(c, o, id) is not { } r) return null;
        var dto = ToDto(r);
        dto.Questions = await QuestionsAsync(c, id);
        dto.AudienceCount = (await AudienceAsync(c, r)).Count;
        return dto;
    }

    private static async Task CheckSubGroupAsync(MySqlConnection c, Owner o, int? subGroupId)
    {
        if (subGroupId is null) return;
        if (o.ClubId is null) throw new InvalidOperationException("District surveys go to the district's officers; they take no sub group.");
        if (await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM sub_groups WHERE pk_sub_group_id = @subGroupId AND fk_club_id = @ClubId AND isdeleted = 0",
                new { subGroupId, o.ClubId }) == 0)
            throw new InvalidOperationException("That sub group is not one of this club's.");
    }

    private static async Task SaveQuestionsAsync(MySqlConnection c, MySqlTransaction tx, int surveyId, List<SurveyQuestionDto> qs)
    {
        await c.ExecuteAsync("DELETE FROM survey_questions WHERE fk_survey_id = @surveyId", new { surveyId }, tx);
        for (var i = 0; i < qs.Count; i++)
        {
            var q = qs[i];
            await c.ExecuteAsync(@"
                INSERT INTO survey_questions (fk_survey_id, sort_order, question_text, question_type, is_required, options_json)
                VALUES (@surveyId, @i, @Text, @Type, @Required, @Options)",
                new
                {
                    surveyId, i, Text = q.Text!.Trim(), q.Type, q.Required,
                    Options = SurveyRules.IsChoice(q.Type) ? System.Text.Json.JsonSerializer.Serialize(q.Options!.Select(x => x.Trim())) : null,
                }, tx);
        }
    }

    public async Task<int> CreateAsync(Owner o, SaveSurveyDto d, int memberId)
    {
        if (SurveyRules.ValidateSurvey(d) is { } error) throw new InvalidOperationException(error);
        await using var c = RowDb.Connect(_cs);
        await c.OpenAsync();
        await CheckSubGroupAsync(c, o, d.SubGroupId);
        await using var tx = await c.BeginTransactionAsync();
        var id = await c.ExecuteScalarAsync<int>(@"
            INSERT INTO surveys (fk_club_id, fk_district_id, fk_sub_group_id, title, description, is_anonymous, show_results, opens_at, closes_at, created_by)
            VALUES (@ClubId, @DistrictId, @SubGroupId, @Title, @Description, @IsAnonymous, @ShowResults, @OpensAt, @ClosesAt, @memberId);
            SELECT LAST_INSERT_ID();",
            new
            {
                o.ClubId, DistrictId = o.ClubId is null ? o.DistrictId : null, d.SubGroupId, Title = d.Title!.Trim(),
                Description = string.IsNullOrWhiteSpace(d.Description) ? null : d.Description.Trim(), d.IsAnonymous, d.ShowResults,
                OpensAt = d.OpensAt!.Value.UtcDateTime, ClosesAt = d.ClosesAt!.Value.UtcDateTime, memberId,
            }, tx);
        await SaveQuestionsAsync(c, tx, id, d.Questions!);
        await tx.CommitAsync();
        return id;
    }

    /// <summary>A draft changes in full. Once published, only the title, description, closing time and "show results"
    /// change: the questions, audience, anonymity and opening time stay as members saw them.</summary>
    public async Task<SurveyDto?> UpdateAsync(Owner o, int id, SaveSurveyDto d)
    {
        await using var c = RowDb.Connect(_cs);
        await c.OpenAsync();
        await using var tx = await c.BeginTransactionAsync();
        if (await c.QueryFirstOrDefaultAsync<Row>(SurveySelect + " WHERE s.pk_survey_id = @id AND " + OwnerWhere + " FOR UPDATE",
                new { id, o.ClubId, o.DistrictId }, tx) is not { } r) return null;
        var draft = r.Status == "draft";
        if (!draft)
        {
            d.Questions = await QuestionsAsync(c, id, tx);
            d.SubGroupId = r.SubGroupId;
            d.IsAnonymous = r.IsAnonymous;
            d.OpensAt = new DateTimeOffset(DateTime.SpecifyKind(r.OpensAt, DateTimeKind.Utc));
        }
        if (SurveyRules.ValidateSurvey(d) is { } error) throw new InvalidOperationException(error);
        if (draft) await CheckSubGroupAsync(c, o, d.SubGroupId);
        await c.ExecuteAsync(@"
            UPDATE surveys SET title = @Title, description = @Description, fk_sub_group_id = @SubGroupId, is_anonymous = @IsAnonymous,
                   show_results = @ShowResults, opens_at = @OpensAt, closes_at = @ClosesAt
            WHERE pk_survey_id = @id",
            new
            {
                id, Title = d.Title!.Trim(), Description = string.IsNullOrWhiteSpace(d.Description) ? null : d.Description.Trim(),
                d.SubGroupId, d.IsAnonymous, d.ShowResults, OpensAt = d.OpensAt!.Value.UtcDateTime, ClosesAt = d.ClosesAt!.Value.UtcDateTime,
            }, tx);
        if (draft) await SaveQuestionsAsync(c, tx, id, d.Questions!);
        // a published survey's notifications wait for its (unchanged) opening time; nothing to move
        await tx.CommitAsync();
        return await GetAsync(o, id);
    }

    public async Task<bool> DeleteAsync(Owner o, int id)
    {
        await using var c = RowDb.Connect(_cs);
        await c.OpenAsync();
        if (await FindAsync(c, o, id) is null) return false;
        await c.ExecuteAsync("DELETE FROM survey_notifications WHERE fk_survey_id = @id", new { id });
        return await c.ExecuteAsync("DELETE FROM surveys WHERE pk_survey_id = @id", new { id }) > 0;
    }

    /// <summary>Publishes a draft and queues one in-app notification per member of the audience, shown from the time
    /// the survey opens.</summary>
    public async Task<SurveyDto?> PublishAsync(Owner o, int id)
    {
        await using var c = RowDb.Connect(_cs);
        await c.OpenAsync();
        await using var tx = await c.BeginTransactionAsync();
        if (await c.QueryFirstOrDefaultAsync<Row>(SurveySelect + " WHERE s.pk_survey_id = @id AND " + OwnerWhere + " FOR UPDATE",
                new { id, o.ClubId, o.DistrictId }, tx) is not { } r) return null;
        if (r.Status != "draft") throw new InvalidOperationException("This survey is already published.");
        if (r.ClosesAt <= DateTime.UtcNow) throw new InvalidOperationException("This survey's closing time has passed. Set a later one first.");
        var audience = await AudienceAsync(c, r, tx);
        if (audience.Count == 0) throw new InvalidOperationException("No one is in this survey's audience yet.");
        await c.ExecuteAsync("UPDATE surveys SET status = 'published', published_at = UTC_TIMESTAMP() WHERE pk_survey_id = @id", new { id }, tx);
        var notifyAt = r.OpensAt > DateTime.UtcNow ? r.OpensAt : DateTime.UtcNow;
        await c.ExecuteAsync("INSERT IGNORE INTO survey_notifications (fk_survey_id, fk_member_id, notify_at) VALUES (@id, @m, @notifyAt)",
            audience.Select(m => new { id, m, notifyAt }), tx);
        await tx.CommitAsync();
        return await GetAsync(o, id);
    }

    /// <summary>Closes a published survey now (answers stop; results stay).</summary>
    public async Task<SurveyDto?> CloseAsync(Owner o, int id)
    {
        await using var c = RowDb.Connect(_cs);
        await c.OpenAsync();
        if (await FindAsync(c, o, id) is not { } r) return null;
        if (r.Status == "draft") throw new InvalidOperationException("A draft is not open; delete it instead.");
        await c.ExecuteAsync(
            "UPDATE surveys SET status = 'closed', closes_at = LEAST(closes_at, UTC_TIMESTAMP()) WHERE pk_survey_id = @id", new { id });
        return await GetAsync(o, id);
    }

    private sealed class AnswerRow
    {
        public int ResponseId { get; set; }
        public int QuestionId { get; set; }
        public string? Choices { get; set; }
        public string? Text { get; set; }
        public int? Rating { get; set; }
        public string? Name { get; set; }
        public string? Email { get; set; }
        public DateTime SubmittedAt { get; set; }
    }

    private static async Task<List<AnswerRow>> AnswersAsync(MySqlConnection c, int surveyId) =>
        (await c.QueryAsync<AnswerRow>(@"
            SELECT r.pk_response_id AS ResponseId, a.fk_question_id AS QuestionId, a.choices AS Choices, a.text_value AS Text, a.rating AS Rating,
                   m.MemberName AS Name, m.EmailId AS Email, IFNULL(r.updated_at, r.submitted_at) AS SubmittedAt
            FROM survey_responses r
            LEFT JOIN survey_answers a ON a.fk_response_id = r.pk_response_id
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = r.fk_member_id
            WHERE r.fk_survey_id = @surveyId ORDER BY r.pk_response_id", new { surveyId })).ToList();

    private static async Task<SurveyResultsDto> ResultsAsync(MySqlConnection c, Row r, bool names)
    {
        var questions = await QuestionsAsync(c, r.Id);
        var answers = await AnswersAsync(c, r.Id);
        var audience = (await AudienceAsync(c, r)).Count;
        return new SurveyResultsDto
        {
            SurveyId = r.Id, Title = r.Title, IsAnonymous = r.IsAnonymous, ResponseCount = r.ResponseCount, AudienceCount = audience,
            ResponseRate = SurveyRules.Percent(r.ResponseCount, audience),
            Questions = SurveyRules.Aggregate(questions,
                answers.Where(a => a.QuestionId > 0).Select(a => new SurveyRules.StoredAnswer(a.QuestionId, a.Choices, a.Text, a.Rating, names ? a.Name : null)),
                r.IsAnonymous),
        };
    }

    public async Task<SurveyResultsDto?> GetResultsAsync(Owner o, int id)
    {
        await using var c = RowDb.Connect(_cs);
        return await FindAsync(c, o, id) is { } r ? await ResultsAsync(c, r, names: true) : null;
    }

    public async Task<(string Title, string Csv)?> ExportCsvAsync(Owner o, int id)
    {
        await using var c = RowDb.Connect(_cs);
        if (await FindAsync(c, o, id) is not { } r) return null;
        var questions = await QuestionsAsync(c, id);
        var rows = (await AnswersAsync(c, id)).GroupBy(a => a.ResponseId).Select(g => new SurveyRules.CsvResponse(
            r.IsAnonymous ? null : g.First().Name, r.IsAnonymous ? null : g.First().Email, Utc(g.First().SubmittedAt),
            g.Where(a => a.QuestionId > 0).Select(a => new SurveyRules.StoredAnswer(a.QuestionId, a.Choices, a.Text, a.Rating, null)).ToList())).ToList();
        return (r.Title, SurveyRules.BuildCsv(questions, rows, r.IsAnonymous));
    }

    // ===== Members (the app) =====

    public async Task<List<SurveyDto>> ListForMemberAsync(int memberId)
    {
        await using var c = RowDb.Connect(_cs);
        var rows = (await c.QueryAsync<(int Id, bool Answered)>($@"
            SELECT s.pk_survey_id, EXISTS (SELECT 1 FROM survey_responses r WHERE r.fk_survey_id = s.pk_survey_id AND r.fk_member_id = @MemberId)
            FROM surveys s
            WHERE s.status <> 'draft' AND s.opens_at <= UTC_TIMESTAMP() AND s.closes_at > UTC_TIMESTAMP() - INTERVAL 90 DAY
              AND {MemberInAudience}", new { MemberId = memberId })).ToDictionary(x => x.Id, x => x.Answered);
        if (rows.Count == 0) return new();
        return (await c.QueryAsync<Row>(SurveySelect + " WHERE s.pk_survey_id IN @Ids ORDER BY s.closes_at DESC", new { Ids = rows.Keys }))
            .Select(r =>
            {
                var dto = ToDto(r);
                dto.Answered = rows[r.Id];
                dto.CanSeeResults = SurveyRules.MemberSeesResults(r.ShowResults, dto.Answered, dto.State);
                return dto;
            })
            .OrderBy(d => d.State == "open" && !d.Answered ? 0 : 1).ToList();
    }

    /// <summary>A survey the member is in the audience of and that has opened, or null.</summary>
    private static Task<Row?> FindForMemberAsync(MySqlConnection c, int memberId, int id, MySqlTransaction? tx = null) =>
        c.QueryFirstOrDefaultAsync<Row>(SurveySelect + $" WHERE s.pk_survey_id = @id AND s.status <> 'draft' AND s.opens_at <= UTC_TIMESTAMP() AND {MemberInAudience}",
            new { id, MemberId = memberId }, tx);

    public async Task<SurveyDto?> GetForMemberAsync(int memberId, int id)
    {
        await using var c = RowDb.Connect(_cs);
        if (await FindForMemberAsync(c, memberId, id) is not { } r) return null;
        var dto = ToDto(r);
        dto.Questions = await QuestionsAsync(c, id);
        var mine = (await c.QueryAsync<AnswerRow>(@"
            SELECT a.fk_question_id AS QuestionId, a.choices AS Choices, a.text_value AS Text, a.rating AS Rating
            FROM survey_responses r JOIN survey_answers a ON a.fk_response_id = r.pk_response_id
            WHERE r.fk_survey_id = @id AND r.fk_member_id = @memberId", new { id, memberId })).ToList();
        dto.Answered = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM survey_responses WHERE fk_survey_id = @id AND fk_member_id = @memberId", new { id, memberId }) > 0;
        dto.MyAnswers = mine.Select(a => new SurveyAnswerDto { QuestionId = a.QuestionId, Choices = SurveyRules.ParseChoices(a.Choices), Text = a.Text, Rating = a.Rating }).ToList();
        dto.CanSeeResults = SurveyRules.MemberSeesResults(r.ShowResults, dto.Answered, dto.State);
        // marks this survey's bell item read-worthy: nothing to store, the feed has no read state of its own
        return dto;
    }

    /// <summary>Saves (or replaces) the member's answers. Null when the survey is not theirs to see.</summary>
    public async Task<bool?> SubmitAsync(int memberId, int id, SubmitSurveyDto d)
    {
        await using var c = RowDb.Connect(_cs);
        await c.OpenAsync();
        await using var tx = await c.BeginTransactionAsync();
        if (await FindForMemberAsync(c, memberId, id, tx) is not { } r) return null;
        if (SurveyRules.State(r.Status, r.OpensAt, r.ClosesAt, DateTime.UtcNow) != "open") throw new InvalidOperationException("This survey is closed.");
        var answers = d.Answers ?? new();
        if (SurveyRules.ValidateAnswers(await QuestionsAsync(c, id, tx), answers) is { } error) throw new InvalidOperationException(error);
        await c.ExecuteAsync(@"
            INSERT INTO survey_responses (fk_survey_id, fk_member_id, submitted_at) VALUES (@id, @memberId, UTC_TIMESTAMP())
            ON DUPLICATE KEY UPDATE updated_at = UTC_TIMESTAMP()", new { id, memberId }, tx);
        var responseId = await c.ExecuteScalarAsync<int>(
            "SELECT pk_response_id FROM survey_responses WHERE fk_survey_id = @id AND fk_member_id = @memberId FOR UPDATE", new { id, memberId }, tx);
        await c.ExecuteAsync("DELETE FROM survey_answers WHERE fk_response_id = @responseId", new { responseId }, tx);
        foreach (var a in answers)
            await c.ExecuteAsync(@"
                INSERT INTO survey_answers (fk_response_id, fk_question_id, choices, text_value, rating)
                VALUES (@responseId, @QuestionId, @Choices, @Text, @Rating)",
                new
                {
                    responseId, a.QuestionId,
                    Choices = a.Choices is { Count: > 0 } ? string.Join(",", a.Choices.OrderBy(x => x)) : null,
                    Text = string.IsNullOrWhiteSpace(a.Text) ? null : a.Text.Trim(), a.Rating,
                }, tx);
        await tx.CommitAsync();
        return true;
    }

    /// <summary>Results for a member, when the survey shares them; never with names.</summary>
    public async Task<SurveyResultsDto?> MemberResultsAsync(int memberId, int id)
    {
        await using var c = RowDb.Connect(_cs);
        if (await FindForMemberAsync(c, memberId, id) is not { } r) return null;
        var answered = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM survey_responses WHERE fk_survey_id = @id AND fk_member_id = @memberId", new { id, memberId }) > 0;
        if (!SurveyRules.MemberSeesResults(r.ShowResults, answered, SurveyRules.State(r.Status, r.OpensAt, r.ClosesAt, DateTime.UtcNow)))
            throw new UnauthorizedAccessException("This survey does not share its results with members.");
        return await ResultsAsync(c, r, names: false);
    }
}
