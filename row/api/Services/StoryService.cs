using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

/// <summary>
/// Club stories with editor approval (gap #6). Any active member of the club submits a story; an editor approves it,
/// rejects it or asks for changes (the author edits and it is Pending again). Only Approved stories reach the bulletin
/// picker and the public club website. Editors: the club's managers, and members who hold an editor office on this
/// year's board (Club Public Image Chair, or a custom office naming an editor or the bulletin).
/// </summary>
public class StoryService
{
    public static readonly string[] Decisions = { "approve", "reject", "changes" };
    private readonly string _cs;

    public StoryService(IConfiguration config) => _cs = config.GetConnectionString("DefaultConnection")!;

    private MySqlConnection Conn() => new(_cs);

    public static string? Validate(StoryDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.Title)) return "A title is required.";
        if (dto.Title.Trim().Length > 200) return "The title can be at most 200 characters.";
        if (string.IsNullOrWhiteSpace(dto.Body)) return "The story text is required.";
        if (dto.Body.Length > 10000) return "The story can be at most 10000 characters.";
        return null;
    }

    public static string? ValidateReview(StoryReviewDto dto)
    {
        if (!Decisions.Contains(dto.Decision)) return "Decide approve, reject or changes.";
        if (dto.Decision != "approve" && string.IsNullOrWhiteSpace(dto.Note)) return "Tell the author why, in a note.";
        if ((dto.Note?.Length ?? 0) > 1000) return "The note can be at most 1000 characters.";
        return null;
    }

    /// <summary>The board offices that may review stories, besides the club's managers.</summary>
    public static bool IsEditorOffice(string? designation, string? customDesignation)
    {
        static bool Match(string? s) => !string.IsNullOrWhiteSpace(s)
            && (s.Contains("public image", StringComparison.OrdinalIgnoreCase)
                || s.Contains("editor", StringComparison.OrdinalIgnoreCase)
                || s.Contains("bulletin", StringComparison.OrdinalIgnoreCase));
        return Match(designation) || Match(customDesignation);
    }

    public async Task<bool> IsMemberAsync(int clubId, int memberId)
    {
        await using var c = Conn();
        return await c.ExecuteScalarAsync<int>(@"SELECT COUNT(*) FROM club_members WHERE fk_club_id = @clubId
            AND fk_member_master_profile_id = @memberId AND IsActive = 1 AND IFNULL(isdeleted, 0) = 0", new { clubId, memberId }) > 0;
    }

    public async Task<bool> IsEditorAsync(int clubId, int memberId)
    {
        if (await ScopeWriteGuardMiddleware.AllowedAsync(_cs, memberId, true, clubId)) return true;
        await using var c = Conn();
        await c.OpenAsync();
        var year = await AdminYearService.GetCurrentYearIdAsync(c);
        var offices = await c.QueryAsync<(string? Name, string? Custom)>(@"
            SELECT d.designation_name, b.custom_designation FROM board_of_directors b
            LEFT JOIN designation_master d ON d.pk_designation_id = b.fk_designation_id
            WHERE b.fk_club_id = @clubId AND b.fk_member_master_profile_id = @memberId AND IFNULL(b.isdeleted, 0) = 0
              AND b.fk_year_id = @year", new { clubId, memberId, year });
        return offices.Any(o => IsEditorOffice(o.Name, o.Custom))
            && await IsMemberAsync(clubId, memberId);
    }

    private const string Select = @"SELECT s.pk_story_id AS Id, s.title AS Title, s.body AS Body, s.status AS Status,
        s.fk_author_id AS AuthorId, a.MemberName AS AuthorName, s.submitted_date AS SubmittedDate,
        r.MemberName AS ReviewerName, s.review_note AS ReviewNote, s.reviewed_date AS ReviewedDate
        FROM club_stories s
        LEFT JOIN member_master_profile a ON a.pk_member_master_profile_id = s.fk_author_id
        LEFT JOIN member_master_profile r ON r.pk_member_master_profile_id = s.fk_reviewer_id";

    /// <summary>Editors see every story of the club; other members only their own.</summary>
    public async Task<List<StoryItemDto>> ListAsync(int clubId, int memberId, bool editor, string? status)
    {
        await using var c = Conn();
        return (await c.QueryAsync<StoryItemDto>($@"{Select}
            WHERE s.fk_club_id = @clubId AND s.isdeleted = 0 AND (@editor = 1 OR s.fk_author_id = @memberId)
              AND (@status IS NULL OR s.status = @status)
            ORDER BY (s.status = 'Pending') DESC, s.submitted_date DESC LIMIT 300",
            new { clubId, memberId, editor, status })).ToList();
    }

    public async Task<int> SubmitAsync(int clubId, StoryDto dto, int memberId)
    {
        await using var c = Conn();
        return await c.ExecuteScalarAsync<int>(@"
            INSERT INTO club_stories (fk_club_id, title, body, status, fk_author_id, submitted_date)
            VALUES (@clubId, @Title, @Body, 'Pending', @memberId, UTC_TIMESTAMP()); SELECT LAST_INSERT_ID();",
            new { clubId, Title = dto.Title.Trim(), Body = dto.Body.Trim(), memberId });
    }

    /// <summary>The author edits a story that is not decided yet, or one sent back for changes; it is Pending again.</summary>
    public async Task<bool> EditAsync(int clubId, int id, StoryDto dto, int memberId)
    {
        await using var c = Conn();
        return await c.ExecuteAsync(@"
            UPDATE club_stories SET title = @Title, body = @Body, status = 'Pending', submitted_date = UTC_TIMESTAMP()
            WHERE pk_story_id = @id AND fk_club_id = @clubId AND fk_author_id = @memberId AND isdeleted = 0
              AND status IN ('Pending', 'ChangesRequested')",
            new { id, clubId, memberId, Title = dto.Title.Trim(), Body = dto.Body.Trim() }) > 0;
    }

    public async Task<bool> WithdrawAsync(int clubId, int id, int memberId)
    {
        await using var c = Conn();
        return await c.ExecuteAsync(@"UPDATE club_stories SET isdeleted = 1
            WHERE pk_story_id = @id AND fk_club_id = @clubId AND fk_author_id = @memberId AND isdeleted = 0 AND status <> 'Approved'",
            new { id, clubId, memberId }) > 0;
    }

    /// <summary>Only a Pending story is decided. False when there is no such story in this club.</summary>
    public async Task<bool> ReviewAsync(int clubId, int id, StoryReviewDto dto, int reviewerId)
    {
        var status = dto.Decision switch { "approve" => "Approved", "reject" => "Rejected", _ => "ChangesRequested" };
        await using var c = Conn();
        return await c.ExecuteAsync(@"
            UPDATE club_stories SET status = @status, fk_reviewer_id = @reviewerId, review_note = @Note, reviewed_date = UTC_TIMESTAMP()
            WHERE pk_story_id = @id AND fk_club_id = @clubId AND isdeleted = 0 AND status = 'Pending'",
            new { id, clubId, status, reviewerId, Note = string.IsNullOrWhiteSpace(dto.Note) ? null : dto.Note.Trim() }) > 0;
    }

    /// <summary>Approved stories for the bulletin picker and the public website, newest first. No author contact data.</summary>
    public async Task<List<PublicStoryDto>> ApprovedAsync(int clubId, int limit)
    {
        await using var c = Conn();
        return (await c.QueryAsync<PublicStoryDto>(@"
            SELECT pk_story_id AS Id, title AS Title, body AS Body, reviewed_date AS PublishedDate FROM club_stories
            WHERE fk_club_id = @clubId AND status = 'Approved' AND isdeleted = 0
            ORDER BY reviewed_date DESC LIMIT @limit", new { clubId, limit = Math.Clamp(limit, 1, 100) })).ToList();
    }
}
