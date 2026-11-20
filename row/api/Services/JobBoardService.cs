using Dapper;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

/// <summary>
/// Job postings and business-to-business offers (DACdb parity, flag job_board). A member posts for the district of
/// one of their clubs; the district's admins approve it before other members of that district see it. A post stops
/// showing after its expiry date (worked out on read, no job needed). Members report abuse: at
/// <see cref="JobBoardRules.HideAtReports"/> open reports the post hides until an admin keeps or removes it.
/// Members only: there is no public route. Who may call what: JobBoardController. Separate from the business directory.
/// </summary>
// shortcut: no email or push to admins on a new post or report; they see the queue in the admin. Add a notice if asked.
public class JobBoardService
{
    private readonly string _cs;

    public JobBoardService(IConfiguration config) => _cs = config.GetConnectionString("DefaultConnection")!;

    private const string Columns = @"
        p.pk_post_id AS Id, p.kind AS Kind, p.title AS Title, p.description AS Description, p.company AS Company,
        p.location AS Location, p.contact AS Contact, p.expires_on AS ExpiresOn, p.status AS Status, p.review_note AS ReviewNote,
        p.fk_club_id AS ClubId, cl.ClubName, p.fk_member_id AS MemberId, m.MemberName AS PostedBy, p.created_at AS CreatedAt,
        (SELECT COUNT(*) FROM job_board_reports r WHERE r.fk_post_id = p.pk_post_id AND r.resolved_at IS NULL) AS OpenReports";
    private const string From = @"
        FROM job_board_posts p
        LEFT JOIN club_master cl ON cl.pk_club_id = p.fk_club_id
        LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = p.fk_member_id";
    private const string MemberDistricts = @"
        SELECT cl2.fk_district_id FROM club_members cm
        JOIN club_master cl2 ON cl2.pk_club_id = cm.fk_club_id AND cl2.IsActive = 1 AND IFNULL(cl2.isdeleted, 0) = 0
        WHERE cm.fk_member_master_profile_id = @memberId AND cm.IsActive = 1 AND IFNULL(cm.isdeleted, 0) = 0";

    private static string? Like(string? q) =>
        string.IsNullOrWhiteSpace(q) ? null : "%" + q.Trim().Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%";

    private static List<JobPostDto> Finish(IEnumerable<JobPostDto> rows, int memberId, DateTime today) =>
        rows.Select(p =>
        {
            p.Status = JobBoardRules.DisplayStatus(p.Status, p.ExpiresOn, today);
            p.Mine = p.MemberId == memberId;
            return p;
        }).ToList();

    // ===== Members (the app) =====

    /// <summary>Live posts of the member's districts (approved, not expired, not hidden by reports).</summary>
    public async Task<List<JobPostDto>> BrowseAsync(int memberId, string? kind, string? q)
    {
        if (kind != null && !JobBoardRules.Kinds.Contains(kind)) throw new InvalidOperationException("Kind is job or offer.");
        await using var c = RowDb.Connect(_cs);
        // shortcut: the 200 newest live posts, add paging if a district has more.
        var rows = await c.QueryAsync<JobPostDto>($@"
            SELECT {Columns} {From}
            WHERE p.fk_district_id IN ({MemberDistricts}) AND p.status = 'approved' AND p.expires_on >= UTC_DATE()
              AND (SELECT COUNT(*) FROM job_board_reports r WHERE r.fk_post_id = p.pk_post_id AND r.resolved_at IS NULL) < @hide
              AND (@kind IS NULL OR p.kind = @kind)
              AND (@like IS NULL OR p.title LIKE @like OR p.description LIKE @like OR p.company LIKE @like OR p.location LIKE @like)
            ORDER BY p.created_at DESC, p.pk_post_id DESC LIMIT 200",
            new { memberId, kind, like = Like(q), hide = JobBoardRules.HideAtReports });
        return Finish(rows, memberId, DateTime.UtcNow.Date);
    }

    /// <summary>The member's own posts in every state, newest first.</summary>
    public async Task<List<JobPostDto>> MineAsync(int memberId)
    {
        await using var c = RowDb.Connect(_cs);
        var rows = await c.QueryAsync<JobPostDto>($@"
            SELECT {Columns} {From} WHERE p.fk_member_id = @memberId
            ORDER BY p.created_at DESC, p.pk_post_id DESC LIMIT 200", new { memberId });
        return Finish(rows, memberId, DateTime.UtcNow.Date);
    }

    public async Task<int> CreateAsync(int memberId, SaveJobPostDto dto)
    {
        var today = DateTime.UtcNow.Date;
        var p = JobBoardRules.Validate(dto, today);
        await using var c = RowDb.Connect(_cs);
        await c.OpenAsync();
        var club = await c.QueryFirstOrDefaultAsync<(int ClubId, int DistrictId)?>(@"
            SELECT cl.pk_club_id, cl.fk_district_id FROM club_members cm
            JOIN club_master cl ON cl.pk_club_id = cm.fk_club_id AND cl.IsActive = 1 AND IFNULL(cl.isdeleted, 0) = 0
            WHERE cm.fk_member_master_profile_id = @memberId AND cm.IsActive = 1 AND IFNULL(cm.isdeleted, 0) = 0
              AND IFNULL(cl.fk_district_id, 0) > 0 AND (@clubId IS NULL OR cl.pk_club_id = @clubId)
            ORDER BY cl.pk_club_id LIMIT 1", new { memberId, clubId = dto.ClubId })
            ?? throw new UnauthorizedAccessException("Only active members of a club can post here.");
        var open = await c.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM job_board_posts WHERE fk_member_id = @memberId
              AND status IN ('pending', 'approved') AND expires_on >= UTC_DATE()", new { memberId });
        if (open >= JobBoardRules.MaxOpenPerMember)
            throw new InvalidOperationException($"You can have {JobBoardRules.MaxOpenPerMember} open posts at most. Withdraw one first.");
        return await c.ExecuteScalarAsync<int>(@"
            INSERT INTO job_board_posts (fk_district_id, fk_club_id, fk_member_id, kind, title, description, company, location,
                                         contact, expires_on, status, created_at)
            VALUES (@DistrictId, @ClubId, @memberId, @Kind, @Title, @Description, @Company, @Location, @Contact, @ExpiresOn,
                    'pending', UTC_TIMESTAMP());
            SELECT LAST_INSERT_ID();",
            new { club.DistrictId, club.ClubId, memberId, p.Kind, p.Title, p.Description, p.Company, p.Location, p.Contact, p.ExpiresOn });
    }

    /// <summary>The poster takes their own post down.</summary>
    public async Task<bool> WithdrawAsync(int memberId, int id)
    {
        await using var c = RowDb.Connect(_cs);
        return await c.ExecuteAsync(@"
            UPDATE job_board_posts SET status = 'withdrawn'
            WHERE pk_post_id = @id AND fk_member_id = @memberId AND status IN ('pending', 'approved')", new { id, memberId }) > 0;
    }

    /// <summary>Reports a live post of the member's districts; a second report by the same member updates the reason.</summary>
    public async Task ReportAsync(int memberId, int id, string? reason)
    {
        reason = JobBoardRules.Clean(reason, 500, "Reason");
        await using var c = RowDb.Connect(_cs);
        await c.OpenAsync();
        var poster = await c.ExecuteScalarAsync<int?>($@"
            SELECT p.fk_member_id FROM job_board_posts p
            WHERE p.pk_post_id = @id AND p.status = 'approved' AND p.expires_on >= UTC_DATE()
              AND p.fk_district_id IN ({MemberDistricts})", new { id, memberId })
            ?? throw new KeyNotFoundException("Post not found.");
        if (poster == memberId) throw new InvalidOperationException("You cannot report your own post.");
        await c.ExecuteAsync(@"
            INSERT INTO job_board_reports (fk_post_id, fk_member_id, reason, created_at) VALUES (@id, @memberId, @reason, UTC_TIMESTAMP())
            ON DUPLICATE KEY UPDATE reason = VALUES(reason), created_at = VALUES(created_at), resolved_at = NULL", new { id, memberId, reason });
    }

    // ===== District admins =====

    /// <summary>filter: pending (waiting for approval), reported (live with open reports), live, closed (the rest).</summary>
    public async Task<List<JobPostDto>> ListForDistrictAsync(int districtId, string filter)
    {
        var where = filter switch
        {
            "pending" => "p.status = 'pending' AND p.expires_on >= UTC_DATE()",
            "reported" => "p.status = 'approved' AND EXISTS (SELECT 1 FROM job_board_reports r WHERE r.fk_post_id = p.pk_post_id AND r.resolved_at IS NULL)",
            "live" => "p.status = 'approved' AND p.expires_on >= UTC_DATE()",
            "closed" => "(p.status IN ('rejected', 'removed', 'withdrawn') OR p.expires_on < UTC_DATE())",
            _ => throw new InvalidOperationException("Filter is pending, reported, live or closed."),
        };
        await using var c = RowDb.Connect(_cs);
        await c.OpenAsync();
        // shortcut: the 300 newest posts per filter, add paging if a district has more.
        var posts = Finish(await c.QueryAsync<JobPostDto>($@"
            SELECT {Columns} {From} WHERE p.fk_district_id = @districtId AND {where}
            ORDER BY p.created_at DESC, p.pk_post_id DESC LIMIT 300", new { districtId }), 0, DateTime.UtcNow.Date);
        var ids = posts.Where(p => p.OpenReports > 0).Select(p => p.Id).ToArray();
        if (ids.Length > 0)
        {
            var reports = (await c.QueryAsync<JobPostReportDto>(@"
                SELECT r.pk_report_id AS Id, r.fk_post_id AS PostId, m.MemberName AS ReporterName, r.reason AS Reason, r.created_at AS ReportedAt
                FROM job_board_reports r LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = r.fk_member_id
                WHERE r.fk_post_id IN @ids AND r.resolved_at IS NULL ORDER BY r.created_at", new { ids })).ToLookup(r => r.PostId);
            foreach (var p in posts) p.Reports = reports[p.Id].ToList();
        }
        return posts;
    }

    /// <summary>approve: a pending post goes live, or a reported one stays live (its reports close). reject: a pending
    /// post is refused. remove: any live post comes down (its reports close). The note is shown to the poster.</summary>
    public async Task ReviewAsync(int districtId, int id, JobPostReviewDto dto, int reviewer)
    {
        var note = JobBoardRules.Clean(dto.Note, 500, "Note");
        await using var c = RowDb.Connect(_cs);
        await c.OpenAsync();
        var status = await c.ExecuteScalarAsync<string?>(
            "SELECT status FROM job_board_posts WHERE pk_post_id = @id AND fk_district_id = @districtId", new { id, districtId })
            ?? throw new KeyNotFoundException("Post not found.");
        var next = JobBoardRules.Review(status, dto.Action);
        await using var tx = await c.BeginTransactionAsync();
        var changed = await c.ExecuteAsync(@"
            UPDATE job_board_posts SET status = @next, review_note = @note, reviewed_by = @reviewer, reviewed_at = UTC_TIMESTAMP()
            WHERE pk_post_id = @id AND fk_district_id = @districtId AND status = @status", new { next, note, reviewer, id, districtId, status }, tx);
        if (changed == 0) throw new InvalidOperationException("The post changed meanwhile. Reload and try again.");
        await c.ExecuteAsync("UPDATE job_board_reports SET resolved_at = UTC_TIMESTAMP() WHERE fk_post_id = @id AND resolved_at IS NULL",
            new { id }, tx);
        await tx.CommitAsync();
    }
}

/// <summary>The job board's pure rules (validation, review transitions, shown status); unit tested.</summary>
public static class JobBoardRules
{
    public const int HideAtReports = 3, MaxOpenPerMember = 10, MaxDays = 90, DefaultDays = 30;
    public static readonly string[] Kinds = { "job", "offer" };

    public static string? Clean(string? s, int max, string what)
    {
        s = s?.Trim();
        if (string.IsNullOrEmpty(s)) return null;
        if (s.Length > max) throw new InvalidOperationException($"{what} is {max} characters at most.");
        return s;
    }

    private static string Required(string? s, int max, string what) =>
        Clean(s, max, what) ?? throw new InvalidOperationException($"{what} is required.");

    public sealed record Post(string Kind, string Title, string Description, string? Company, string? Location, string Contact, DateTime ExpiresOn);

    public static Post Validate(SaveJobPostDto dto, DateTime today)
    {
        var kind = dto.Kind?.Trim().ToLowerInvariant() ?? "";
        if (!Kinds.Contains(kind)) throw new InvalidOperationException("Choose a job or a business offer.");
        var expires = dto.ExpiresOn?.Date ?? today.AddDays(DefaultDays);
        if (expires < today) throw new InvalidOperationException("The expiry date has passed.");
        if (expires > today.AddDays(MaxDays)) throw new InvalidOperationException($"A post can run for {MaxDays} days at most.");
        return new Post(kind, Required(dto.Title, 150, "Title"), Required(dto.Description, 4000, "Description"),
            Clean(dto.Company, 150, "Company"), Clean(dto.Location, 150, "Location"), Required(dto.Contact, 254, "Contact"), expires);
    }

    /// <summary>The status a review action moves a post to; refuses a move that makes no sense.</summary>
    public static string Review(string status, string? action) => (status, action?.Trim().ToLowerInvariant()) switch
    {
        ("pending", "approve") or ("approved", "approve") => "approved",
        ("pending", "reject") => "rejected",
        ("pending", "remove") or ("approved", "remove") => "removed",
        (_, "approve" or "reject" or "remove") => throw new InvalidOperationException($"A {status} post cannot be changed that way."),
        _ => throw new InvalidOperationException("Action is approve, reject or remove."),
    };

    /// <summary>Stored status, or "expired" for a pending or live post past its date.</summary>
    public static string DisplayStatus(string status, DateTime expiresOn, DateTime today) =>
        status is "pending" or "approved" && expiresOn.Date < today.Date ? "expired" : status;
}
