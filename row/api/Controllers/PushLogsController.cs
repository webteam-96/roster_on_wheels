using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;

namespace RotaryApi.Controllers;

/// <summary>
/// SuperAdmin → Settings → Push Notification Logs viewer.
/// Read-only viewer for the last 5 days of push activity (older rows auto-deleted by PushLogCleanupBackgroundService).
/// Plus a "Send Now" action for stuck entities (PublishDate passed but PushNotificationSent still 0).
/// </summary>
[ApiController]
[Authorize]
[Route("api/admin/push-logs")]
public class PushLogsController : ControllerBase
{
    private readonly string _connectionString;

    public PushLogsController(IConfiguration config)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);
    private bool IsSuperAdmin() => User.FindFirst("roles")?.Value?.Contains("SuperAdmin") == true;

    /// <summary>List of recent push events grouped by entity (one row per push attempt).</summary>
    [HttpGet("recent")]
    public async Task<ActionResult> GetRecent([FromQuery] string? type, [FromQuery] DateTime? from, [FromQuery] DateTime? to)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var fromDate = from ?? DateTime.Now.AddDays(-5);
        var toDate = to ?? DateTime.Now.AddDays(1);

        var rows = new List<dynamic>();

        if (type == null || type == "announcement" || type == "all")
        {
            rows.AddRange(await conn.QueryAsync<dynamic>(@"
                SELECT 'announcement' AS type, 0 AS isReminder,
                       a.pk_announcement_id AS entityId, a.Title AS title,
                       a.fk_club_id AS clubId, a.fk_district_id AS districtId,
                       MIN(l.SentAt) AS pushedAt,
                       SUM(CASE WHEN l.Status = 'Sent' THEN 1 ELSE 0 END) AS totalSent,
                       SUM(CASE WHEN l.Status = 'Failed' THEN 1 ELSE 0 END) AS totalFailed,
                       COUNT(*) AS totalRecipients
                FROM announcement_push_log l
                JOIN announcements a ON a.pk_announcement_id = l.fk_announcement_id
                WHERE l.created_date BETWEEN @F AND @T
                GROUP BY a.pk_announcement_id, a.Title, a.fk_club_id, a.fk_district_id",
                new { F = fromDate, T = toDate }));

            rows.AddRange(await conn.QueryAsync<dynamic>(@"
                SELECT 'announcement' AS type, 1 AS isReminder,
                       a.pk_announcement_id AS entityId, a.Title AS title,
                       a.fk_club_id AS clubId, a.fk_district_id AS districtId,
                       MIN(l.SentAt) AS pushedAt,
                       SUM(CASE WHEN l.Status = 'Sent' THEN 1 ELSE 0 END) AS totalSent,
                       SUM(CASE WHEN l.Status = 'Failed' THEN 1 ELSE 0 END) AS totalFailed,
                       COUNT(*) AS totalRecipients,
                       l.fk_reminder_id AS reminderId
                FROM announcement_reminder_push_log l
                JOIN announcements a ON a.pk_announcement_id = l.fk_announcement_id
                WHERE l.created_date BETWEEN @F AND @T
                GROUP BY a.pk_announcement_id, a.Title, a.fk_club_id, a.fk_district_id, l.fk_reminder_id",
                new { F = fromDate, T = toDate }));
        }

        if (type == null || type == "event" || type == "all")
        {
            rows.AddRange(await conn.QueryAsync<dynamic>(@"
                SELECT 'event' AS type, 0 AS isReminder,
                       e.pk_upcoming_event_id AS entityId, e.Title AS title,
                       e.fk_club_id AS clubId, e.fk_district_id AS districtId,
                       MIN(l.SentAt) AS pushedAt,
                       SUM(CASE WHEN l.Status = 'Sent' THEN 1 ELSE 0 END) AS totalSent,
                       SUM(CASE WHEN l.Status = 'Failed' THEN 1 ELSE 0 END) AS totalFailed,
                       COUNT(*) AS totalRecipients
                FROM event_push_log l
                JOIN upcoming_events e ON e.pk_upcoming_event_id = l.fk_upcoming_event_id
                WHERE l.created_date BETWEEN @F AND @T
                GROUP BY e.pk_upcoming_event_id, e.Title, e.fk_club_id, e.fk_district_id",
                new { F = fromDate, T = toDate }));

            rows.AddRange(await conn.QueryAsync<dynamic>(@"
                SELECT 'event' AS type, 1 AS isReminder,
                       e.pk_upcoming_event_id AS entityId, e.Title AS title,
                       e.fk_club_id AS clubId, e.fk_district_id AS districtId,
                       MIN(l.SentAt) AS pushedAt,
                       SUM(CASE WHEN l.Status = 'Sent' THEN 1 ELSE 0 END) AS totalSent,
                       SUM(CASE WHEN l.Status = 'Failed' THEN 1 ELSE 0 END) AS totalFailed,
                       COUNT(*) AS totalRecipients,
                       l.fk_reminder_id AS reminderId
                FROM event_reminder_push_log l
                JOIN upcoming_events e ON e.pk_upcoming_event_id = l.fk_upcoming_event_id
                WHERE l.created_date BETWEEN @F AND @T
                GROUP BY e.pk_upcoming_event_id, e.Title, e.fk_club_id, e.fk_district_id, l.fk_reminder_id",
                new { F = fromDate, T = toDate }));
        }

        if (type == null || type == "document" || type == "all")
        {
            rows.AddRange(await conn.QueryAsync<dynamic>(@"
                SELECT 'document' AS type, 0 AS isReminder,
                       d.pk_document_id AS entityId, d.Title AS title,
                       d.fk_club_id AS clubId, d.fk_district_id AS districtId,
                       MIN(l.SentAt) AS pushedAt,
                       SUM(CASE WHEN l.Status = 'Sent' THEN 1 ELSE 0 END) AS totalSent,
                       SUM(CASE WHEN l.Status = 'Failed' THEN 1 ELSE 0 END) AS totalFailed,
                       COUNT(*) AS totalRecipients
                FROM document_push_log l
                JOIN club_documents d ON d.pk_document_id = l.fk_document_id
                WHERE l.created_date BETWEEN @F AND @T
                GROUP BY d.pk_document_id, d.Title, d.fk_club_id, d.fk_district_id",
                new { F = fromDate, T = toDate }));
        }

        return Ok(rows.OrderByDescending(r => r.pushedAt));
    }

    /// <summary>Recipient detail rows for one push event.</summary>
    [HttpGet("recipients")]
    public async Task<ActionResult> GetRecipients([FromQuery] string type, [FromQuery] int entityId, [FromQuery] bool isReminder = false, [FromQuery] int? reminderId = null)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();

        string table = (type, isReminder) switch
        {
            ("announcement", false) => "announcement_push_log",
            ("announcement", true)  => "announcement_reminder_push_log",
            ("event", false)        => "event_push_log",
            ("event", true)         => "event_reminder_push_log",
            ("document", false)     => "document_push_log",
            _ => ""
        };
        if (string.IsNullOrEmpty(table)) return BadRequest(new { message = "Invalid type" });

        string entityFk = type switch
        {
            "announcement" => "fk_announcement_id",
            "event"        => "fk_upcoming_event_id",
            "document"     => "fk_document_id",
            _ => ""
        };

        var sql = $@"
            SELECT m.MemberName AS memberName, m.PrimaryMobileNumber AS mobile, m.EmailId AS email,
                   l.FcmToken AS fcmToken, l.Status AS status, l.FirebaseMessageId AS firebaseMessageId,
                   l.ErrorMessage AS errorMessage, l.SentAt AS sentAt, l.created_date AS createdDate
            FROM {table} l
            JOIN member_master_profile m ON m.pk_member_master_profile_id = l.fk_member_master_profile_id
            WHERE l.{entityFk} = @Eid"
            + (isReminder && reminderId.HasValue ? " AND l.fk_reminder_id = @Rid" : "")
            + " ORDER BY l.created_date DESC";

        var rows = await conn.QueryAsync<dynamic>(sql, new { Eid = entityId, Rid = reminderId });
        return Ok(rows);
    }

    /// <summary>Entities that should have been pushed (publish date passed) but PushNotificationSent is still 0.</summary>
    [HttpGet("stuck")]
    public async Task<ActionResult> GetStuck()
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var stuck = new List<dynamic>();

        stuck.AddRange(await conn.QueryAsync<dynamic>(@"
            SELECT 'announcement' AS type, pk_announcement_id AS entityId, Title AS title,
                   fk_club_id AS clubId, fk_district_id AS districtId, PublishDateTime AS publishDate
            FROM announcements
            WHERE isdeleted = 0 AND IFNULL(PushNotificationSent, 0) = 0
              AND PublishDateTime <= NOW() AND (ExpiryDateTime IS NULL OR ExpiryDateTime > NOW())
              AND IFNULL(Scope, '') <> 'ri'"));

        stuck.AddRange(await conn.QueryAsync<dynamic>(@"
            SELECT 'event' AS type, pk_upcoming_event_id AS entityId, Title AS title,
                   fk_club_id AS clubId, fk_district_id AS districtId, PublishDate AS publishDate
            FROM upcoming_events
            WHERE isdeleted = 0 AND IFNULL(PushNotificationSent, 0) = 0
              AND PublishDate <= NOW() AND EventDate > NOW()
              AND IFNULL(Scope, '') <> 'ri'"));

        stuck.AddRange(await conn.QueryAsync<dynamic>(@"
            SELECT 'document' AS type, pk_document_id AS entityId, Title AS title,
                   fk_club_id AS clubId, fk_district_id AS districtId, PublishDateTime AS publishDate
            FROM club_documents
            WHERE isdeleted = 0 AND IFNULL(PushNotificationSent, 0) = 0
              AND PublishDateTime <= NOW() AND (ExpiryDateTime IS NULL OR ExpiryDateTime > NOW())
              AND IFNULL(Scope, '') <> 'ri' AND IFNULL(Status, 'Unpublished') = 'Published'"));

        return Ok(stuck.OrderBy(s => s.publishDate));
    }

    /// <summary>
    /// Manually fire push for one stuck entity. Resets PushNotificationSent=0 so the next
    /// background poll cycle (within ~60 sec) picks it up. Background, doesn't block UI.
    /// </summary>
    [HttpPost("send-now")]
    public async Task<ActionResult> SendNow([FromBody] SendNowRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (string.IsNullOrWhiteSpace(req.Type) || req.EntityId <= 0)
            return BadRequest(new { message = "type + entityId required" });

        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Reset the flag — background service will pick it up on next cycle
        int affected = req.Type switch
        {
            "announcement" => await conn.ExecuteAsync(
                "UPDATE announcements SET PushNotificationSent = 0, PushNotificationSentAt = NULL WHERE pk_announcement_id = @Id AND isdeleted = 0",
                new { Id = req.EntityId }),
            "event" => await conn.ExecuteAsync(
                "UPDATE upcoming_events SET PushNotificationSent = 0, PushNotificationSentAt = NULL WHERE pk_upcoming_event_id = @Id AND isdeleted = 0",
                new { Id = req.EntityId }),
            "document" => await conn.ExecuteAsync(
                "UPDATE club_documents SET PushNotificationSent = 0, PushNotificationSentAt = NULL WHERE pk_document_id = @Id AND isdeleted = 0",
                new { Id = req.EntityId }),
            _ => 0
        };

        if (affected == 0) return NotFound(new { message = "Entity not found or already deleted" });
        return Ok(new { message = "Queued. Push will fire within ~60 seconds.", entityId = req.EntityId, type = req.Type });
    }

    public class SendNowRequest
    {
        public string Type { get; set; } = "";
        public int EntityId { get; set; }
    }
}
