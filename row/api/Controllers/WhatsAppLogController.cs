using System.Text.Json;
using System.Text.RegularExpressions;
using ClosedXML.Excel;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;

namespace RotaryApi.Controllers;

// SuperAdmin WhatsApp Delivery Report — mirrors EmailLogController. One row per recipient
// per broadcast, with submit status (Sent/Failed) and, once a delivery webhook
// fires, Delivered/Read/Failed. Filters: date range, recipient (mobile/name), title,
// status, club, district, and broadcast type.
[ApiController]
[Route("api/whatsapp-log")]
[Authorize]
public class WhatsAppLogController : ControllerBase
{
    private readonly string _connectionString;

    public WhatsAppLogController(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private bool IsSuperAdmin() => User.FindFirst("roles")?.Value?.Contains("SuperAdmin") == true;
    private MySqlConnection CreateConnection() => new(_connectionString);

    [HttpGet("")]
    public async Task<ActionResult> List(
        [FromQuery] string? from = null,
        [FromQuery] string? to = null,
        [FromQuery] string? recipient = null,
        [FromQuery] string? title = null,
        [FromQuery] string? status = null,
        [FromQuery] string? club = null,
        [FromQuery] string? district = null,
        [FromQuery] string? waType = null,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 100)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (page < 1) page = 1;
        if (pageSize < 1 || pageSize > 500) pageSize = 100;

        var conditions = new List<string>();
        var p = new DynamicParameters();
        if (DateTime.TryParse(from, out var fromDt)) { conditions.Add("w.sent_at >= @From"); p.Add("From", fromDt.Date); }
        if (DateTime.TryParse(to, out var toDt))    { conditions.Add("w.sent_at < @To");    p.Add("To",   toDt.Date.AddDays(1)); }
        if (!string.IsNullOrWhiteSpace(recipient))  { conditions.Add("(w.recipient_mobile LIKE CONCAT('%', @Recipient, '%') OR w.recipient_name LIKE CONCAT('%', @Recipient, '%'))"); p.Add("Recipient", recipient.Trim()); }
        if (!string.IsNullOrWhiteSpace(title))       { conditions.Add("w.title LIKE CONCAT('%', @Title, '%')"); p.Add("Title", title.Trim()); }
        if (!string.IsNullOrWhiteSpace(status))      { conditions.Add("w.status = @Status"); p.Add("Status", status.Trim()); }
        if (!string.IsNullOrWhiteSpace(waType))      { conditions.Add("w.whatsapp_type = @Type"); p.Add("Type", waType.Trim()); }
        if (!string.IsNullOrWhiteSpace(club))        { conditions.Add("c.ClubName LIKE CONCAT('%', @Club, '%')"); p.Add("Club", club.Trim()); }
        if (!string.IsNullOrWhiteSpace(district))    { conditions.Add("d.DistrictNumber LIKE CONCAT('%', @District, '%')"); p.Add("District", district.Trim()); }

        var where = conditions.Count == 0 ? "" : "WHERE " + string.Join(" AND ", conditions);
        p.Add("PageSize", pageSize);
        p.Add("Offset", (page - 1) * pageSize);

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var sql = $@"
            SELECT w.pk_id AS id, w.recipient_mobile AS recipientMobile, w.recipient_name AS recipientName,
                   w.template_name AS templateName, w.whatsapp_type AS whatsAppType, w.source_id AS sourceId,
                   w.title AS title, w.status AS status, w.interakt_message_id AS interaktMessageId,
                   w.http_status AS httpStatus, w.error_message AS errorMessage,
                   w.sent_at AS sentAt, w.delivered_at AS deliveredAt,
                   c.ClubName AS clubName, d.DistrictNumber AS districtNumber
            FROM whatsapp_log w
            LEFT JOIN club_master c ON c.pk_club_id = w.fk_club_id
            LEFT JOIN district_master d ON d.pk_district_id = w.fk_district_id
            {where}
            ORDER BY w.pk_id DESC
            LIMIT @PageSize OFFSET @Offset;

            SELECT COUNT(*) FROM whatsapp_log w
            LEFT JOIN club_master c ON c.pk_club_id = w.fk_club_id
            LEFT JOIN district_master d ON d.pk_district_id = w.fk_district_id
            {where};";

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
        [FromQuery] string? title = null,
        [FromQuery] string? status = null,
        [FromQuery] string? club = null,
        [FromQuery] string? district = null,
        [FromQuery] string? waType = null)
    {
        if (!IsSuperAdmin()) return Forbid();

        var conditions = new List<string>();
        var p = new DynamicParameters();
        if (DateTime.TryParse(from, out var fromDt)) { conditions.Add("w.sent_at >= @From"); p.Add("From", fromDt.Date); }
        if (DateTime.TryParse(to, out var toDt))    { conditions.Add("w.sent_at < @To");    p.Add("To",   toDt.Date.AddDays(1)); }
        if (!string.IsNullOrWhiteSpace(recipient))  { conditions.Add("(w.recipient_mobile LIKE CONCAT('%', @Recipient, '%') OR w.recipient_name LIKE CONCAT('%', @Recipient, '%'))"); p.Add("Recipient", recipient.Trim()); }
        if (!string.IsNullOrWhiteSpace(title))       { conditions.Add("w.title LIKE CONCAT('%', @Title, '%')"); p.Add("Title", title.Trim()); }
        if (!string.IsNullOrWhiteSpace(status))      { conditions.Add("w.status = @Status"); p.Add("Status", status.Trim()); }
        if (!string.IsNullOrWhiteSpace(waType))      { conditions.Add("w.whatsapp_type = @Type"); p.Add("Type", waType.Trim()); }
        if (!string.IsNullOrWhiteSpace(club))        { conditions.Add("c.ClubName LIKE CONCAT('%', @Club, '%')"); p.Add("Club", club.Trim()); }
        if (!string.IsNullOrWhiteSpace(district))    { conditions.Add("d.DistrictNumber LIKE CONCAT('%', @District, '%')"); p.Add("District", district.Trim()); }
        var where = conditions.Count == 0 ? "" : "WHERE " + string.Join(" AND ", conditions);

        using var conn = CreateConnection();
        await conn.OpenAsync();
        var rows = (await conn.QueryAsync<dynamic>($@"
            SELECT w.sent_at AS sentAt, w.status AS status, w.recipient_name AS recipientName,
                   w.recipient_mobile AS recipientMobile, w.title AS title, w.whatsapp_type AS whatsAppType,
                   c.ClubName AS clubName, d.DistrictNumber AS districtNumber, w.template_name AS templateName,
                   w.interakt_message_id AS interaktMessageId, w.http_status AS httpStatus,
                   w.error_message AS errorMessage, w.delivered_at AS deliveredAt
            FROM whatsapp_log w
            LEFT JOIN club_master c ON c.pk_club_id = w.fk_club_id
            LEFT JOIN district_master d ON d.pk_district_id = w.fk_district_id
            {where}
            ORDER BY w.pk_id DESC
            LIMIT 100000", p)).ToList();

        using var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add("WhatsApp Log");
        string[] headers = { "Sent At", "Status", "Recipient Name", "Mobile", "Title", "Type",
            "Club", "District", "Template", "Message Id", "HTTP", "Error", "Delivered At" };
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
            ws.Cell(r, 3).Value = (string?)row.recipientName ?? "";
            ws.Cell(r, 4).Value = (string?)row.recipientMobile ?? "";
            ws.Cell(r, 5).Value = (string?)row.title ?? "";
            ws.Cell(r, 6).Value = (string?)row.whatsAppType ?? "";
            ws.Cell(r, 7).Value = (string?)row.clubName ?? "";
            ws.Cell(r, 8).Value = row.districtNumber != null ? $"District {row.districtNumber}" : "";
            ws.Cell(r, 9).Value = (string?)row.templateName ?? "";
            ws.Cell(r, 10).Value = (string?)row.interaktMessageId ?? "";
            if (row.httpStatus != null) ws.Cell(r, 11).Value = Convert.ToInt32(row.httpStatus);
            ws.Cell(r, 12).Value = (string?)row.errorMessage ?? "";
            ws.Cell(r, 13).Value = row.deliveredAt != null ? ((DateTime)row.deliveredAt).ToString("dd-MM-yyyy HH:mm") : "";
            var st = (string?)row.status ?? "";
            if (st is "Delivered" or "Read") ws.Cell(r, 2).Style.Font.FontColor = XLColor.FromHtml("#059669");
            else if (st == "Failed") ws.Cell(r, 2).Style.Font.FontColor = XLColor.FromHtml("#dc2626");
            r++;
        }
        ws.Columns().AdjustToContents();

        using var stream = new MemoryStream();
        wb.SaveAs(stream);
        var ts = DateTime.Now.ToString("yyyyMMdd_HHmmss");
        return File(stream.ToArray(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            $"WhatsApp_Log_{ts}.xlsx");
    }

    // Single row with the full body preview. SuperAdmin only.
    [HttpGet("{id:long}")]
    public async Task<ActionResult> Detail(long id)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var row = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT w.pk_id AS id, w.recipient_mobile AS recipientMobile, w.recipient_name AS recipientName,
                   w.template_name AS templateName, w.whatsapp_type AS whatsAppType, w.source_id AS sourceId,
                   w.title AS title, w.status AS status, w.interakt_message_id AS interaktMessageId,
                   w.http_status AS httpStatus, w.error_message AS errorMessage, w.body_preview AS bodyPreview,
                   w.sent_at AS sentAt, w.delivered_at AS deliveredAt,
                   c.ClubName AS clubName, d.DistrictNumber AS districtNumber
            FROM whatsapp_log w
            LEFT JOIN club_master c ON c.pk_club_id = w.fk_club_id
            LEFT JOIN district_master d ON d.pk_district_id = w.fk_district_id
            WHERE w.pk_id = @Id",
            new { Id = id });

        if (row == null) return NotFound(new { message = "WhatsApp log entry not found." });
        return Ok(row);
    }

    // ── One-time backfill from server log files ──────────────────────────
    // Past broadcasts (sent before per-recipient logging existed) aren't in whatsapp_log.
    // The original WhatsApp service logged every send as: "WhatsApp reminder to {Phone}: {Status} - {Body}".
    // This parses those lines from a log file/folder into whatsapp_log rows so a historical
    // send (e.g. a specific announcement) becomes visible in the report.
    //
    // Because the log line has no source attribution, pass sentAt/title/waType/sourceId to
    // TAG the imported rows (e.g. the announcement's send time + title). ALL matching lines in
    // the given file(s) are imported, so point logPath at a log file/folder that covers the
    // broadcast you want (e.g. the rotated log for that day) to scope it.
    [HttpPost("backfill")]
    public async Task<ActionResult> Backfill(
        [FromQuery] string logPath,
        [FromQuery] string? sentAt = null,
        [FromQuery] string? title = null,
        [FromQuery] string? waType = null,
        [FromQuery] long? sourceId = null,
        [FromQuery] int? clubId = null,
        [FromQuery] int? districtId = null)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (string.IsNullOrWhiteSpace(logPath)) return BadRequest(new { message = "logPath is required (a log file or a folder of logs)." });

        List<string> files = new();
        if (System.IO.File.Exists(logPath)) files.Add(logPath);
        else if (System.IO.Directory.Exists(logPath))
            files.AddRange(System.IO.Directory.GetFiles(logPath, "*.*", SearchOption.TopDirectoryOnly)
                .Where(f => f.EndsWith(".log", StringComparison.OrdinalIgnoreCase) || f.EndsWith(".txt", StringComparison.OrdinalIgnoreCase)));
        else return NotFound(new { message = $"logPath not found: {logPath}" });

        DateTime stamp = DateTime.TryParse(sentAt, out var dt) ? dt : DateTime.Now;
        // The parsed line has no timestamp we can trust, so every imported row is stamped with
        // the supplied sentAt (the broadcast time) — that's what makes them group sensibly.
        var lineRx = new Regex(@"WhatsApp reminder to (?<phone>\d+):\s*(?<status>\S+)\s*-\s*(?<body>.*)$", RegexOptions.Compiled);

        var rows = new List<object>();
        int scanned = 0;
        foreach (var file in files)
        {
            IEnumerable<string> lines;
            try { lines = System.IO.File.ReadLines(file); }
            catch { continue; }
            foreach (var line in lines)
            {
                var m = lineRx.Match(line);
                if (!m.Success) continue;
                scanned++;
                var phone = m.Groups["phone"].Value;
                var statusToken = m.Groups["status"].Value.TrimEnd(':');
                var body = m.Groups["body"].Value.Trim();

                bool ok = statusToken is "OK" or "Created" or "Accepted" or "NoContent"
                          || body.Contains("\"result\":true", StringComparison.OrdinalIgnoreCase)
                          || body.Contains("\"result\": true", StringComparison.OrdinalIgnoreCase);
                int? httpCode = Enum.TryParse<System.Net.HttpStatusCode>(statusToken, out var sc) ? (int)sc : (int?)null;

                string? msgId = null;
                try
                {
                    using var doc = JsonDocument.Parse(body);
                    if (doc.RootElement.ValueKind == JsonValueKind.Object && doc.RootElement.TryGetProperty("id", out var idEl))
                        msgId = idEl.ValueKind == JsonValueKind.String ? idEl.GetString() : idEl.ToString();
                }
                catch { /* body not JSON */ }

                rows.Add(new
                {
                    RecipientMobile = phone,
                    RecipientName = (string?)null,
                    TemplateName = (string?)null,
                    WhatsAppType = waType ?? "Backfill",
                    SourceId = sourceId,
                    Title = title,
                    ClubId = clubId,
                    DistrictId = districtId,
                    Status = ok ? "Sent" : "Failed",
                    MessageId = msgId,
                    HttpStatus = httpCode,
                    Error = ok ? (string?)null : (body.Length > 1000 ? body.Substring(0, 1000) : body),
                    Preview = (string?)null,
                    SentAt = stamp,
                });
            }
        }

        if (rows.Count == 0) return Ok(new { imported = 0, scanned, files = files.Count, message = "No 'WhatsApp reminder to …' lines matched." });

        using var conn = CreateConnection();
        await conn.OpenAsync();
        var imported = await conn.ExecuteAsync(@"
            INSERT INTO whatsapp_log
                (recipient_mobile, recipient_name, template_name, whatsapp_type, source_id, title,
                 fk_club_id, fk_district_id, status, interakt_message_id, http_status, error_message, body_preview, sent_at)
            VALUES
                (@RecipientMobile, @RecipientName, @TemplateName, @WhatsAppType, @SourceId, @Title,
                 @ClubId, @DistrictId, @Status, @MessageId, @HttpStatus, @Error, @Preview, @SentAt)",
            rows);

        return Ok(new { imported, scanned, files = files.Count, sentAt = stamp, waType = waType ?? "Backfill", title });
    }

    // Summary counts for last 24h / 7d / 30d + status totals. SuperAdmin only.
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
                SUM(CASE WHEN status IN ('Sent','Delivered','Read') THEN 1 ELSE 0 END) AS totalSent,
                SUM(CASE WHEN status IN ('Delivered','Read') THEN 1 ELSE 0 END) AS totalDelivered,
                SUM(CASE WHEN status = 'Failed' THEN 1 ELSE 0 END) AS totalFailed,
                COUNT(*) AS totalAll
            FROM whatsapp_log");

        return Ok(summary);
    }

    // ── Club / District scoped views ─────────────────────────────────────
    // Same log + filters + export, but locked to ONE club or district and gated to that
    // club/district's admins (or SuperAdmin). Used by the Club Admin / District Admin dashboards.
    private int GetMemberId()
    {
        var id = User.FindFirst("memberId")?.Value ?? User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        return int.TryParse(id, out var x) ? x : 0;
    }

    private async Task<bool> CanAccessClubAsync(MySqlConnection conn, int clubId)
    {
        var m = GetMemberId();
        if (m <= 0) return false;
        if (await RotaryApi.Services.ClubAdminAccessHelper.IsSuperAdminAsync(conn, m)) return true;
        try { await RotaryApi.Services.ClubAdminAccessHelper.EnsureClubAdminAsync(conn, m, clubId); return true; }
        catch { return false; }
    }

    private async Task<bool> CanAccessDistrictAsync(MySqlConnection conn, int districtId)
    {
        var m = GetMemberId();
        if (m <= 0) return false;
        if (await RotaryApi.Services.ClubAdminAccessHelper.IsSuperAdminAsync(conn, m)) return true;
        var n = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM member_roles
            WHERE fk_member_master_profile_id = @M AND fk_role_id = 2 AND fk_district_id = @D
              AND (fk_club_id IS NULL OR fk_club_id = 0) AND IsActive = 1 AND isdeleted = 0",
            new { M = m, D = districtId });
        return n > 0;
    }

    private static (string where, DynamicParameters p) BuildFilter(
        string? from, string? to, string? recipient, string? title, string? status,
        string? club, string? district, string? waType, int? scopeClubId, int? scopeDistrictId)
    {
        var c = new List<string>();
        var p = new DynamicParameters();
        if (scopeClubId is > 0) { c.Add("w.fk_club_id = @ScopeClub"); p.Add("ScopeClub", scopeClubId.Value); }
        if (scopeDistrictId is > 0) { c.Add("w.fk_district_id = @ScopeDistrict"); p.Add("ScopeDistrict", scopeDistrictId.Value); }
        if (DateTime.TryParse(from, out var fromDt)) { c.Add("w.sent_at >= @From"); p.Add("From", fromDt.Date); }
        if (DateTime.TryParse(to, out var toDt))    { c.Add("w.sent_at < @To");    p.Add("To",   toDt.Date.AddDays(1)); }
        if (!string.IsNullOrWhiteSpace(recipient))  { c.Add("(w.recipient_mobile LIKE CONCAT('%', @Recipient, '%') OR w.recipient_name LIKE CONCAT('%', @Recipient, '%'))"); p.Add("Recipient", recipient.Trim()); }
        if (!string.IsNullOrWhiteSpace(title))       { c.Add("w.title LIKE CONCAT('%', @Title, '%')"); p.Add("Title", title.Trim()); }
        if (!string.IsNullOrWhiteSpace(status))      { c.Add("w.status = @Status"); p.Add("Status", status.Trim()); }
        if (!string.IsNullOrWhiteSpace(waType))      { c.Add("w.whatsapp_type = @Type"); p.Add("Type", waType.Trim()); }
        if (!string.IsNullOrWhiteSpace(club))        { c.Add("c.ClubName LIKE CONCAT('%', @Club, '%')"); p.Add("Club", club.Trim()); }
        if (!string.IsNullOrWhiteSpace(district))    { c.Add("d.DistrictNumber LIKE CONCAT('%', @District, '%')"); p.Add("District", district.Trim()); }
        return (c.Count == 0 ? "" : "WHERE " + string.Join(" AND ", c), p);
    }

    private async Task<object> RunListAsync(MySqlConnection conn, string where, DynamicParameters p, int page, int pageSize)
    {
        p.Add("PageSize", pageSize); p.Add("Offset", (page - 1) * pageSize);
        var sql = $@"
            SELECT w.pk_id AS id, w.recipient_mobile AS recipientMobile, w.recipient_name AS recipientName,
                   w.template_name AS templateName, w.whatsapp_type AS whatsAppType, w.source_id AS sourceId,
                   w.title AS title, w.status AS status, w.interakt_message_id AS interaktMessageId,
                   w.http_status AS httpStatus, w.error_message AS errorMessage,
                   w.sent_at AS sentAt, w.delivered_at AS deliveredAt,
                   c.ClubName AS clubName, d.DistrictNumber AS districtNumber
            FROM whatsapp_log w
            LEFT JOIN club_master c ON c.pk_club_id = w.fk_club_id
            LEFT JOIN district_master d ON d.pk_district_id = w.fk_district_id
            {where}
            ORDER BY w.pk_id DESC LIMIT @PageSize OFFSET @Offset;
            SELECT COUNT(*) FROM whatsapp_log w
            LEFT JOIN club_master c ON c.pk_club_id = w.fk_club_id
            LEFT JOIN district_master d ON d.pk_district_id = w.fk_district_id {where};";
        using var multi = await conn.QueryMultipleAsync(sql, p);
        var items = (await multi.ReadAsync<dynamic>()).ToList();
        var total = await multi.ReadSingleAsync<int>();
        return new { items, total, page, pageSize, totalPages = (int)Math.Ceiling(total / (double)pageSize) };
    }

    private async Task<object> RunSummaryAsync(MySqlConnection conn, string where, DynamicParameters p)
    {
        var sql = $@"
            SELECT
                SUM(CASE WHEN w.sent_at >= NOW() - INTERVAL 1  DAY THEN 1 ELSE 0 END) AS last24h,
                SUM(CASE WHEN w.sent_at >= NOW() - INTERVAL 7  DAY THEN 1 ELSE 0 END) AS last7d,
                SUM(CASE WHEN w.sent_at >= NOW() - INTERVAL 30 DAY THEN 1 ELSE 0 END) AS last30d,
                SUM(CASE WHEN w.status IN ('Sent','Delivered','Read') THEN 1 ELSE 0 END) AS totalSent,
                SUM(CASE WHEN w.status IN ('Delivered','Read') THEN 1 ELSE 0 END) AS totalDelivered,
                SUM(CASE WHEN w.status = 'Failed' THEN 1 ELSE 0 END) AS totalFailed,
                COUNT(*) AS totalAll
            FROM whatsapp_log w
            LEFT JOIN club_master c ON c.pk_club_id = w.fk_club_id
            LEFT JOIN district_master d ON d.pk_district_id = w.fk_district_id {where}";
        return await conn.QueryFirstAsync<dynamic>(sql, p);
    }

    [HttpGet("club/{clubId:int}")]
    public async Task<ActionResult> ClubList(int clubId, [FromQuery] string? from = null, [FromQuery] string? to = null,
        [FromQuery] string? recipient = null, [FromQuery] string? title = null, [FromQuery] string? status = null,
        [FromQuery] string? waType = null, [FromQuery] int page = 1, [FromQuery] int pageSize = 100)
    {
        if (page < 1) page = 1; if (pageSize < 1 || pageSize > 500) pageSize = 100;
        using var conn = CreateConnection(); await conn.OpenAsync();
        if (!await CanAccessClubAsync(conn, clubId)) return Forbid();
        var (where, p) = BuildFilter(from, to, recipient, title, status, null, null, waType, clubId, null);
        return Ok(await RunListAsync(conn, where, p, page, pageSize));
    }

    [HttpGet("club/{clubId:int}/summary")]
    public async Task<ActionResult> ClubSummary(int clubId)
    {
        using var conn = CreateConnection(); await conn.OpenAsync();
        if (!await CanAccessClubAsync(conn, clubId)) return Forbid();
        var (where, p) = BuildFilter(null, null, null, null, null, null, null, null, clubId, null);
        return Ok(await RunSummaryAsync(conn, where, p));
    }

    [HttpGet("club/{clubId:int}/export")]
    public async Task<ActionResult> ClubExport(int clubId, [FromQuery] string? from = null, [FromQuery] string? to = null,
        [FromQuery] string? recipient = null, [FromQuery] string? title = null, [FromQuery] string? status = null, [FromQuery] string? waType = null)
    {
        using var conn = CreateConnection(); await conn.OpenAsync();
        if (!await CanAccessClubAsync(conn, clubId)) return Forbid();
        var (where, p) = BuildFilter(from, to, recipient, title, status, null, null, waType, clubId, null);
        return await BuildXlsxAsync(conn, where, p);
    }

    [HttpGet("district/{districtId:int}")]
    public async Task<ActionResult> DistrictList(int districtId, [FromQuery] string? from = null, [FromQuery] string? to = null,
        [FromQuery] string? recipient = null, [FromQuery] string? title = null, [FromQuery] string? status = null,
        [FromQuery] string? club = null, [FromQuery] string? waType = null, [FromQuery] int page = 1, [FromQuery] int pageSize = 100)
    {
        if (page < 1) page = 1; if (pageSize < 1 || pageSize > 500) pageSize = 100;
        using var conn = CreateConnection(); await conn.OpenAsync();
        if (!await CanAccessDistrictAsync(conn, districtId)) return Forbid();
        var (where, p) = BuildFilter(from, to, recipient, title, status, club, null, waType, null, districtId);
        return Ok(await RunListAsync(conn, where, p, page, pageSize));
    }

    [HttpGet("district/{districtId:int}/summary")]
    public async Task<ActionResult> DistrictSummary(int districtId)
    {
        using var conn = CreateConnection(); await conn.OpenAsync();
        if (!await CanAccessDistrictAsync(conn, districtId)) return Forbid();
        var (where, p) = BuildFilter(null, null, null, null, null, null, null, null, null, districtId);
        return Ok(await RunSummaryAsync(conn, where, p));
    }

    [HttpGet("district/{districtId:int}/export")]
    public async Task<ActionResult> DistrictExport(int districtId, [FromQuery] string? from = null, [FromQuery] string? to = null,
        [FromQuery] string? recipient = null, [FromQuery] string? title = null, [FromQuery] string? status = null,
        [FromQuery] string? club = null, [FromQuery] string? waType = null)
    {
        using var conn = CreateConnection(); await conn.OpenAsync();
        if (!await CanAccessDistrictAsync(conn, districtId)) return Forbid();
        var (where, p) = BuildFilter(from, to, recipient, title, status, club, null, waType, null, districtId);
        return await BuildXlsxAsync(conn, where, p);
    }

    // Shared XLSX builder for the scoped exports (same shape as the SuperAdmin export).
    private async Task<ActionResult> BuildXlsxAsync(MySqlConnection conn, string where, DynamicParameters p)
    {
        var rows = (await conn.QueryAsync<dynamic>($@"
            SELECT w.sent_at AS sentAt, w.status AS status, w.recipient_name AS recipientName,
                   w.recipient_mobile AS recipientMobile, w.title AS title, w.whatsapp_type AS whatsAppType,
                   c.ClubName AS clubName, d.DistrictNumber AS districtNumber, w.template_name AS templateName,
                   w.interakt_message_id AS interaktMessageId, w.http_status AS httpStatus,
                   w.error_message AS errorMessage, w.delivered_at AS deliveredAt
            FROM whatsapp_log w
            LEFT JOIN club_master c ON c.pk_club_id = w.fk_club_id
            LEFT JOIN district_master d ON d.pk_district_id = w.fk_district_id
            {where} ORDER BY w.pk_id DESC LIMIT 100000", p)).ToList();

        using var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add("WhatsApp Log");
        string[] headers = { "Sent At", "Status", "Recipient Name", "Mobile", "Title", "Type",
            "Club", "District", "Template", "Message Id", "HTTP", "Error", "Delivered At" };
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
            ws.Cell(r, 3).Value = (string?)row.recipientName ?? "";
            ws.Cell(r, 4).Value = (string?)row.recipientMobile ?? "";
            ws.Cell(r, 5).Value = (string?)row.title ?? "";
            ws.Cell(r, 6).Value = (string?)row.whatsAppType ?? "";
            ws.Cell(r, 7).Value = (string?)row.clubName ?? "";
            ws.Cell(r, 8).Value = row.districtNumber != null ? $"District {row.districtNumber}" : "";
            ws.Cell(r, 9).Value = (string?)row.templateName ?? "";
            ws.Cell(r, 10).Value = (string?)row.interaktMessageId ?? "";
            if (row.httpStatus != null) ws.Cell(r, 11).Value = Convert.ToInt32(row.httpStatus);
            ws.Cell(r, 12).Value = (string?)row.errorMessage ?? "";
            ws.Cell(r, 13).Value = row.deliveredAt != null ? ((DateTime)row.deliveredAt).ToString("dd-MM-yyyy HH:mm") : "";
            var st = (string?)row.status ?? "";
            if (st is "Delivered" or "Read") ws.Cell(r, 2).Style.Font.FontColor = XLColor.FromHtml("#059669");
            else if (st == "Failed") ws.Cell(r, 2).Style.Font.FontColor = XLColor.FromHtml("#dc2626");
            r++;
        }
        ws.Columns().AdjustToContents();
        using var stream = new MemoryStream();
        wb.SaveAs(stream);
        var ts = DateTime.Now.ToString("yyyyMMdd_HHmmss");
        return File(stream.ToArray(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"WhatsApp_Log_{ts}.xlsx");
    }
}
