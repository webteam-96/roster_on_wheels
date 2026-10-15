using ClosedXML.Excel;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/email-log")]
[Authorize]
public class EmailLogController : ControllerBase
{
    private readonly string _connectionString;

    public EmailLogController(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private bool IsSuperAdmin() => User.FindFirst("roles")?.Value?.Contains("SuperAdmin") == true;
    private MySqlConnection CreateConnection() => new(_connectionString);

    // List sent emails (SuperAdmin only). Supports filtering by date range, recipient, subject, status, type.
    [HttpGet("")]
    public async Task<ActionResult> List(
        [FromQuery] string? from = null,
        [FromQuery] string? to = null,
        [FromQuery] string? recipient = null,
        [FromQuery] string? subject = null,
        [FromQuery] string? status = null,
        [FromQuery] string? emailType = null,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 100)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (page < 1) page = 1;
        if (pageSize < 1 || pageSize > 500) pageSize = 100;

        var conditions = new List<string>();
        var p = new DynamicParameters();
        if (DateTime.TryParse(from, out var fromDt)) { conditions.Add("sent_at >= @From"); p.Add("From", fromDt.Date); }
        if (DateTime.TryParse(to, out var toDt))    { conditions.Add("sent_at < @To");    p.Add("To",   toDt.Date.AddDays(1)); }
        // Recipient search matches BOTH the TO address and any CC address, so a person cc'd on a
        // mail is found by their email too (not just the primary recipient).
        if (!string.IsNullOrWhiteSpace(recipient))  { conditions.Add("(recipient_email LIKE CONCAT('%', @Recipient, '%') OR cc_emails LIKE CONCAT('%', @Recipient, '%'))"); p.Add("Recipient", recipient.Trim()); }
        if (!string.IsNullOrWhiteSpace(subject))    { conditions.Add("subject LIKE CONCAT('%', @Subject, '%')"); p.Add("Subject", subject.Trim()); }
        if (!string.IsNullOrWhiteSpace(status))     { conditions.Add("status = @Status"); p.Add("Status", status.Trim()); }
        if (!string.IsNullOrWhiteSpace(emailType))  { conditions.Add("email_type = @Type"); p.Add("Type", emailType.Trim()); }

        var where = conditions.Count == 0 ? "" : "WHERE " + string.Join(" AND ", conditions);
        p.Add("PageSize", pageSize);
        p.Add("Offset", (page - 1) * pageSize);

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var sql = $@"
            SELECT pk_id AS id, recipient_email AS recipientEmail, cc_emails AS ccEmails,
                   subject AS subject, email_type AS emailType, status AS status,
                   brevo_message_id AS brevoMessageId, error_message AS errorMessage,
                   sent_at AS sentAt
            FROM email_log
            {where}
            ORDER BY pk_id DESC
            LIMIT @PageSize OFFSET @Offset;

            SELECT COUNT(*) FROM email_log {where};";

        using var multi = await conn.QueryMultipleAsync(sql, p);
        var items = (await multi.ReadAsync<dynamic>()).ToList();
        var total = await multi.ReadSingleAsync<int>();

        return Ok(new
        {
            items,
            total,
            page,
            pageSize,
            totalPages = (int)Math.Ceiling(total / (double)pageSize)
        });
    }

    // Export the CURRENT filtered result set (all matching rows, not just the page) to XLSX.
    [HttpGet("export")]
    public async Task<ActionResult> Export(
        [FromQuery] string? from = null,
        [FromQuery] string? to = null,
        [FromQuery] string? recipient = null,
        [FromQuery] string? subject = null,
        [FromQuery] string? status = null,
        [FromQuery] string? emailType = null)
    {
        if (!IsSuperAdmin()) return Forbid();

        var conditions = new List<string>();
        var p = new DynamicParameters();
        if (DateTime.TryParse(from, out var fromDt)) { conditions.Add("sent_at >= @From"); p.Add("From", fromDt.Date); }
        if (DateTime.TryParse(to, out var toDt))    { conditions.Add("sent_at < @To");    p.Add("To",   toDt.Date.AddDays(1)); }
        if (!string.IsNullOrWhiteSpace(recipient))  { conditions.Add("(recipient_email LIKE CONCAT('%', @Recipient, '%') OR cc_emails LIKE CONCAT('%', @Recipient, '%'))"); p.Add("Recipient", recipient.Trim()); }
        if (!string.IsNullOrWhiteSpace(subject))    { conditions.Add("subject LIKE CONCAT('%', @Subject, '%')"); p.Add("Subject", subject.Trim()); }
        if (!string.IsNullOrWhiteSpace(status))     { conditions.Add("status = @Status"); p.Add("Status", status.Trim()); }
        if (!string.IsNullOrWhiteSpace(emailType))  { conditions.Add("email_type = @Type"); p.Add("Type", emailType.Trim()); }
        var where = conditions.Count == 0 ? "" : "WHERE " + string.Join(" AND ", conditions);

        using var conn = CreateConnection();
        await conn.OpenAsync();
        var rows = (await conn.QueryAsync<dynamic>($@"
            SELECT sent_at AS sentAt, status AS status, recipient_email AS recipientEmail,
                   cc_emails AS ccEmails, subject AS subject, email_type AS emailType,
                   brevo_message_id AS brevoMessageId, error_message AS errorMessage
            FROM email_log
            {where}
            ORDER BY pk_id DESC
            LIMIT 100000", p)).ToList();

        using var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add("Email Log");
        string[] headers = { "Sent At", "Status", "Recipient", "Cc", "Subject", "Type", "Brevo Msg Id", "Error" };
        for (int i = 0; i < headers.Length; i++)
        {
            var cell = ws.Cell(1, i + 1);
            cell.Value = headers[i];
            cell.Style.Font.Bold = true;
            cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#17458F");
            cell.Style.Font.FontColor = XLColor.White;
        }
        int r = 2;
        foreach (var row in rows)
        {
            ws.Cell(r, 1).Value = row.sentAt != null ? ((DateTime)row.sentAt).ToString("dd-MM-yyyy HH:mm") : "";
            ws.Cell(r, 2).Value = (string?)row.status ?? "";
            ws.Cell(r, 3).Value = (string?)row.recipientEmail ?? "";
            ws.Cell(r, 4).Value = (string?)row.ccEmails ?? "";
            ws.Cell(r, 5).Value = (string?)row.subject ?? "";
            ws.Cell(r, 6).Value = (string?)row.emailType ?? "";
            ws.Cell(r, 7).Value = (string?)row.brevoMessageId ?? "";
            ws.Cell(r, 8).Value = (string?)row.errorMessage ?? "";
            var st = (string?)row.status ?? "";
            if (st == "Sent") ws.Cell(r, 2).Style.Font.FontColor = XLColor.FromHtml("#059669");
            else if (st == "Failed") ws.Cell(r, 2).Style.Font.FontColor = XLColor.FromHtml("#dc2626");
            r++;
        }
        ws.Columns().AdjustToContents();

        using var stream = new MemoryStream();
        wb.SaveAs(stream);
        var ts = DateTime.Now.ToString("yyyyMMdd_HHmmss");
        return File(stream.ToArray(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            $"Email_Log_{ts}.xlsx");
    }

    // Single row with full HTML body. SuperAdmin only.
    [HttpGet("{id:long}")]
    public async Task<ActionResult> Detail(long id)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var row = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pk_id AS id, recipient_email AS recipientEmail, cc_emails AS ccEmails,
                   subject AS subject, body_html AS bodyHtml, email_type AS emailType,
                   status AS status, brevo_message_id AS brevoMessageId,
                   error_message AS errorMessage, sent_at AS sentAt
            FROM email_log WHERE pk_id = @Id",
            new { Id = id });

        if (row == null) return NotFound(new { message = "Email not found." });
        return Ok(row);
    }

    // Summary counts for last 24h / 7d / 30d. SuperAdmin only.
    [HttpGet("summary")]
    public async Task<ActionResult> Summary()
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var summary = await conn.QueryFirstAsync<dynamic>(@"
            SELECT
                SUM(CASE WHEN sent_at >= NOW() - INTERVAL 1  DAY THEN 1 ELSE 0 END) AS last24h,
                SUM(CASE WHEN sent_at >= NOW() - INTERVAL 7  DAY THEN 1 ELSE 0 END) AS last7d,
                SUM(CASE WHEN sent_at >= NOW() - INTERVAL 30 DAY THEN 1 ELSE 0 END) AS last30d,
                SUM(CASE WHEN status = 'Sent'   THEN 1 ELSE 0 END) AS totalSent,
                SUM(CASE WHEN status = 'Failed' THEN 1 ELSE 0 END) AS totalFailed,
                COUNT(*) AS totalAll
            FROM email_log");

        return Ok(summary);
    }

    // ── Club / District scoped views (locked to that club/district, for their admins) ──
    private int GetMemberId()
    {
        var id = User.FindFirst("memberId")?.Value ?? User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        return int.TryParse(id, out var x) ? x : 0;
    }
    private async Task<bool> CanAccessClubAsync(MySqlConnection conn, int clubId)
    {
        var m = GetMemberId(); if (m <= 0) return false;
        if (await RotaryApi.Services.ClubAdminAccessHelper.IsSuperAdminAsync(conn, m)) return true;
        try { await RotaryApi.Services.ClubAdminAccessHelper.EnsureClubAdminAsync(conn, m, clubId); return true; } catch { return false; }
    }
    private async Task<bool> CanAccessDistrictAsync(MySqlConnection conn, int districtId)
    {
        var m = GetMemberId(); if (m <= 0) return false;
        if (await RotaryApi.Services.ClubAdminAccessHelper.IsSuperAdminAsync(conn, m)) return true;
        var n = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM member_roles WHERE fk_member_master_profile_id = @M AND fk_role_id = 2
              AND fk_district_id = @D AND (fk_club_id IS NULL OR fk_club_id = 0) AND IsActive = 1 AND isdeleted = 0",
            new { M = m, D = districtId });
        return n > 0;
    }

    private static (string where, DynamicParameters p) ScopeFilter(
        string? from, string? to, string? recipient, string? subject, string? status, string? emailType, string scopeKind, int scopeId)
    {
        // Past emails have no club/district stamp, so scope by the club's/district's MEMBER
        // emails (captures history from the shared email_log) OR the newly-stamped fk column.
        var memberEmails = scopeKind == "club"
            ? @"SELECT m.EmailId FROM club_members cm
                JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                WHERE cm.fk_club_id = @ScopeId AND cm.IsActive = 1 AND cm.isdeleted = 0
                  AND m.isdeleted = 0 AND m.EmailId IS NOT NULL AND m.EmailId <> ''"
            : @"SELECT m.EmailId FROM club_members cm
                JOIN club_master c ON c.pk_club_id = cm.fk_club_id
                JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                WHERE c.fk_district_id = @ScopeId AND cm.IsActive = 1 AND cm.isdeleted = 0
                  AND c.isdeleted = 0 AND m.isdeleted = 0 AND m.EmailId IS NOT NULL AND m.EmailId <> ''";
        var scopeCol = scopeKind == "club" ? "fk_club_id" : "fk_district_id";
        var c = new List<string> { $"({scopeCol} = @ScopeId OR recipient_email IN ({memberEmails}))" };
        var p = new DynamicParameters(); p.Add("ScopeId", scopeId);
        if (DateTime.TryParse(from, out var fromDt)) { c.Add("sent_at >= @From"); p.Add("From", fromDt.Date); }
        if (DateTime.TryParse(to, out var toDt))    { c.Add("sent_at < @To");    p.Add("To",   toDt.Date.AddDays(1)); }
        if (!string.IsNullOrWhiteSpace(recipient))  { c.Add("(recipient_email LIKE CONCAT('%', @Recipient, '%') OR cc_emails LIKE CONCAT('%', @Recipient, '%'))"); p.Add("Recipient", recipient.Trim()); }
        if (!string.IsNullOrWhiteSpace(subject))    { c.Add("subject LIKE CONCAT('%', @Subject, '%')"); p.Add("Subject", subject.Trim()); }
        if (!string.IsNullOrWhiteSpace(status))     { c.Add("status = @Status"); p.Add("Status", status.Trim()); }
        if (!string.IsNullOrWhiteSpace(emailType))  { c.Add("email_type = @Type"); p.Add("Type", emailType.Trim()); }
        return ("WHERE " + string.Join(" AND ", c), p);
    }

    private async Task<object> ScopedListAsync(MySqlConnection conn, string where, DynamicParameters p, int page, int pageSize)
    {
        p.Add("PageSize", pageSize); p.Add("Offset", (page - 1) * pageSize);
        var sql = $@"
            SELECT pk_id AS id, recipient_email AS recipientEmail, cc_emails AS ccEmails, subject AS subject,
                   email_type AS emailType, status AS status, brevo_message_id AS brevoMessageId,
                   error_message AS errorMessage, sent_at AS sentAt
            FROM email_log {where} ORDER BY pk_id DESC LIMIT @PageSize OFFSET @Offset;
            SELECT COUNT(*) FROM email_log {where};";
        using var multi = await conn.QueryMultipleAsync(sql, p);
        var items = (await multi.ReadAsync<dynamic>()).ToList();
        var total = await multi.ReadSingleAsync<int>();
        return new { items, total, page, pageSize, totalPages = (int)Math.Ceiling(total / (double)pageSize) };
    }
    private async Task<object> ScopedSummaryAsync(MySqlConnection conn, string where, DynamicParameters p)
        => await conn.QueryFirstAsync<dynamic>($@"
            SELECT SUM(CASE WHEN sent_at >= NOW() - INTERVAL 1 DAY THEN 1 ELSE 0 END) AS last24h,
                   SUM(CASE WHEN sent_at >= NOW() - INTERVAL 7 DAY THEN 1 ELSE 0 END) AS last7d,
                   SUM(CASE WHEN sent_at >= NOW() - INTERVAL 30 DAY THEN 1 ELSE 0 END) AS last30d,
                   SUM(CASE WHEN status = 'Sent' THEN 1 ELSE 0 END) AS totalSent,
                   SUM(CASE WHEN status = 'Failed' THEN 1 ELSE 0 END) AS totalFailed,
                   COUNT(*) AS totalAll
            FROM email_log {where}", p);

    private async Task<ActionResult> ScopedExportAsync(MySqlConnection conn, string where, DynamicParameters p)
    {
        var rows = (await conn.QueryAsync<dynamic>($@"
            SELECT sent_at AS sentAt, status AS status, recipient_email AS recipientEmail, cc_emails AS ccEmails,
                   subject AS subject, email_type AS emailType, brevo_message_id AS brevoMessageId, error_message AS errorMessage
            FROM email_log {where} ORDER BY pk_id DESC LIMIT 100000", p)).ToList();
        using var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add("Email Log");
        string[] headers = { "Sent At", "Status", "Recipient", "Cc", "Subject", "Type", "Brevo Msg Id", "Error" };
        for (int i = 0; i < headers.Length; i++)
        {
            var cell = ws.Cell(1, i + 1); cell.Value = headers[i];
            cell.Style.Font.Bold = true; cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#17458F"); cell.Style.Font.FontColor = XLColor.White;
        }
        int r = 2;
        foreach (var row in rows)
        {
            ws.Cell(r, 1).Value = row.sentAt != null ? ((DateTime)row.sentAt).ToString("dd-MM-yyyy HH:mm") : "";
            ws.Cell(r, 2).Value = (string?)row.status ?? "";
            ws.Cell(r, 3).Value = (string?)row.recipientEmail ?? "";
            ws.Cell(r, 4).Value = (string?)row.ccEmails ?? "";
            ws.Cell(r, 5).Value = (string?)row.subject ?? "";
            ws.Cell(r, 6).Value = (string?)row.emailType ?? "";
            ws.Cell(r, 7).Value = (string?)row.brevoMessageId ?? "";
            ws.Cell(r, 8).Value = (string?)row.errorMessage ?? "";
            var st = (string?)row.status ?? "";
            if (st == "Sent") ws.Cell(r, 2).Style.Font.FontColor = XLColor.FromHtml("#059669");
            else if (st == "Failed") ws.Cell(r, 2).Style.Font.FontColor = XLColor.FromHtml("#dc2626");
            r++;
        }
        ws.Columns().AdjustToContents();
        using var stream = new MemoryStream(); wb.SaveAs(stream);
        var ts = DateTime.Now.ToString("yyyyMMdd_HHmmss");
        return File(stream.ToArray(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"Email_Log_{ts}.xlsx");
    }

    [HttpGet("club/{clubId:int}")]
    public async Task<ActionResult> ClubList(int clubId, [FromQuery] string? from = null, [FromQuery] string? to = null,
        [FromQuery] string? recipient = null, [FromQuery] string? subject = null, [FromQuery] string? status = null,
        [FromQuery] string? emailType = null, [FromQuery] int page = 1, [FromQuery] int pageSize = 100)
    {
        if (page < 1) page = 1; if (pageSize < 1 || pageSize > 500) pageSize = 100;
        using var conn = CreateConnection(); await conn.OpenAsync();
        if (!await CanAccessClubAsync(conn, clubId)) return Forbid();
        var (where, p) = ScopeFilter(from, to, recipient, subject, status, emailType, "club", clubId);
        return Ok(await ScopedListAsync(conn, where, p, page, pageSize));
    }
    [HttpGet("club/{clubId:int}/summary")]
    public async Task<ActionResult> ClubSummary(int clubId)
    {
        using var conn = CreateConnection(); await conn.OpenAsync();
        if (!await CanAccessClubAsync(conn, clubId)) return Forbid();
        var (where, p) = ScopeFilter(null, null, null, null, null, null, "club", clubId);
        return Ok(await ScopedSummaryAsync(conn, where, p));
    }
    [HttpGet("club/{clubId:int}/export")]
    public async Task<ActionResult> ClubExport(int clubId, [FromQuery] string? from = null, [FromQuery] string? to = null,
        [FromQuery] string? recipient = null, [FromQuery] string? subject = null, [FromQuery] string? status = null, [FromQuery] string? emailType = null)
    {
        using var conn = CreateConnection(); await conn.OpenAsync();
        if (!await CanAccessClubAsync(conn, clubId)) return Forbid();
        var (where, p) = ScopeFilter(from, to, recipient, subject, status, emailType, "club", clubId);
        return await ScopedExportAsync(conn, where, p);
    }
    [HttpGet("district/{districtId:int}")]
    public async Task<ActionResult> DistrictList(int districtId, [FromQuery] string? from = null, [FromQuery] string? to = null,
        [FromQuery] string? recipient = null, [FromQuery] string? subject = null, [FromQuery] string? status = null,
        [FromQuery] string? emailType = null, [FromQuery] int page = 1, [FromQuery] int pageSize = 100)
    {
        if (page < 1) page = 1; if (pageSize < 1 || pageSize > 500) pageSize = 100;
        using var conn = CreateConnection(); await conn.OpenAsync();
        if (!await CanAccessDistrictAsync(conn, districtId)) return Forbid();
        var (where, p) = ScopeFilter(from, to, recipient, subject, status, emailType, "district", districtId);
        return Ok(await ScopedListAsync(conn, where, p, page, pageSize));
    }
    [HttpGet("district/{districtId:int}/summary")]
    public async Task<ActionResult> DistrictSummary(int districtId)
    {
        using var conn = CreateConnection(); await conn.OpenAsync();
        if (!await CanAccessDistrictAsync(conn, districtId)) return Forbid();
        var (where, p) = ScopeFilter(null, null, null, null, null, null, "district", districtId);
        return Ok(await ScopedSummaryAsync(conn, where, p));
    }
    [HttpGet("district/{districtId:int}/export")]
    public async Task<ActionResult> DistrictExport(int districtId, [FromQuery] string? from = null, [FromQuery] string? to = null,
        [FromQuery] string? recipient = null, [FromQuery] string? subject = null, [FromQuery] string? status = null, [FromQuery] string? emailType = null)
    {
        using var conn = CreateConnection(); await conn.OpenAsync();
        if (!await CanAccessDistrictAsync(conn, districtId)) return Forbid();
        var (where, p) = ScopeFilter(from, to, recipient, subject, status, emailType, "district", districtId);
        return await ScopedExportAsync(conn, where, p);
    }
}
