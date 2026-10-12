using ClosedXML.Excel;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

// District Awards activation flag (per district + year). Read by anyone (to show active vs
// "Coming soon" and to make club entry read-only); toggled ONLY by a SuperAdmin.
//
// Also hosts the SuperAdmin-only "Clear all clubs points" tool: backs up + emails (Excel to DG +
// District Admins) + clears every club's district-award entries for one (district, year), plus a
// one-click Restore of the most recent cleared batch. Only the CLUB ENTRIES are touched — the
// criteria / questions / categories setup is never cleared.
[ApiController]
[Authorize]
public class DistrictAwardsConfigController : ControllerBase
{
    private readonly string _connectionString;
    private readonly IEmailService _email;
    public DistrictAwardsConfigController(IConfiguration config, IEmailService email)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        _email = email;
    }

    private bool IsSuperAdmin() => User.FindFirst("roles")?.Value?.Contains("SuperAdmin") == true;
    private int GetUserId() => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    public class AwardsConfigDto { public bool IsEnabled { get; set; } }
    public class SetAwardsConfigDto { public int YearId { get; set; } public bool IsEnabled { get; set; } }

    // GET current flag (default enabled if no row). Authenticated users may read.
    [HttpGet("api/districts/{districtId:int}/awards-config")]
    public async Task<ActionResult<AwardsConfigDto>> Get(int districtId, [FromQuery] int yearId)
    {
        if (districtId <= 0 || yearId <= 0) return BadRequest(new { message = "districtId and yearId are required." });
        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        var enabled = await DistrictAwardsConfigHelper.IsEnabledAsync(conn, districtId, yearId);
        return Ok(new AwardsConfigDto { IsEnabled = enabled });
    }

    // PUT set the flag — SuperAdmin ONLY.
    [HttpPut("api/districts/{districtId:int}/awards-config")]
    public async Task<ActionResult> Set(int districtId, [FromBody] SetAwardsConfigDto dto)
    {
        if (!IsSuperAdmin())
            return StatusCode(403, new { message = "Only SuperAdmin can enable/disable District Awards." });
        if (districtId <= 0 || dto.YearId <= 0) return BadRequest(new { message = "districtId and yearId are required." });

        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        // UPSERT on the unique (district, year) key.
        await conn.ExecuteAsync(
            @"INSERT INTO district_awards_config (fk_district_id, fk_year_id, is_enabled, modified_by, modified_date, created_date)
              VALUES (@D, @Y, @E, @U, NOW(), NOW())
              ON DUPLICATE KEY UPDATE is_enabled = @E, modified_by = @U, modified_date = NOW()",
            new { D = districtId, Y = dto.YearId, E = dto.IsEnabled ? 1 : 0, U = GetUserId() });
        return Ok(new { message = dto.IsEnabled ? "District Awards enabled." : "District Awards disabled.", isEnabled = dto.IsEnabled });
    }

    // ─────────────────────────── Clear all clubs points (SuperAdmin) ───────────────────────────

    public class ClearStatusDto
    {
        public int LiveEntryCount { get; set; }      // active club entries (answers) for this district+year
        public int LiveClubCount { get; set; }       // distinct clubs that have any entry
        public bool CanClear { get; set; }           // there is something to clear
        public bool CanRestore { get; set; }         // a not-yet-restored backup batch exists
        public string? LastClearedDate { get; set; }
        public int LastClearedCount { get; set; }
        public bool IsSuperAdmin { get; set; }        // drives whether the UI shows the buttons at all
    }

    // Status for the Clear/Restore buttons. SuperAdmin only (the buttons don't exist for anyone else).
    [HttpGet("api/districts/{districtId:int}/awards-clear-status")]
    public async Task<ActionResult<ClearStatusDto>> ClearStatus(int districtId, [FromQuery] int yearId)
    {
        if (!IsSuperAdmin()) return Ok(new ClearStatusDto { IsSuperAdmin = false });
        if (districtId <= 0 || yearId <= 0) return BadRequest(new { message = "districtId and yearId are required." });
        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();

        var live = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM district_citation_club_entry WHERE fk_district_id=@D AND fk_year_id=@Y AND isdeleted=0",
            new { D = districtId, Y = yearId });
        var liveClubs = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(DISTINCT fk_club_id) FROM district_citation_club_entry WHERE fk_district_id=@D AND fk_year_id=@Y AND isdeleted=0",
            new { D = districtId, Y = yearId });
        var batch = await conn.QueryFirstOrDefaultAsync<dynamic>(
            @"SELECT batch_id AS batchId, DATE_FORMAT(MAX(cleared_date),'%Y-%m-%d %H:%i') AS clearedDate, COUNT(*) AS cnt
              FROM district_citation_club_entry_backup
              WHERE fk_district_id=@D AND fk_year_id=@Y AND restored=0
              GROUP BY batch_id ORDER BY MAX(cleared_date) DESC LIMIT 1",
            new { D = districtId, Y = yearId });

        return Ok(new ClearStatusDto
        {
            IsSuperAdmin = true,
            LiveEntryCount = live,
            LiveClubCount = liveClubs,
            CanClear = live > 0,
            CanRestore = batch != null,
            LastClearedDate = batch?.clearedDate as string,
            LastClearedCount = batch == null ? 0 : (int)(long)batch.cnt,
        });
    }

    // Clear = snapshot to backup → email Excel to DG + District Admins → soft-delete the live entries.
    [HttpPost("api/districts/{districtId:int}/awards-clear")]
    public async Task<ActionResult> ClearAll(int districtId, [FromQuery] int yearId)
    {
        if (!IsSuperAdmin()) return StatusCode(403, new { message = "Only SuperAdmin can clear club points." });
        if (districtId <= 0 || yearId <= 0) return BadRequest(new { message = "districtId and yearId are required." });

        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();

        var liveCount = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM district_citation_club_entry WHERE fk_district_id=@D AND fk_year_id=@Y AND isdeleted=0",
            new { D = districtId, Y = yearId });
        if (liveCount == 0) return BadRequest(new { message = "There are no club points to clear for this district and year." });

        var (districtNumber, yearLabel) = await DistrictYearLabelsAsync(conn, districtId, yearId);
        var batchId = $"{districtId}-{yearId}-{DateTime.Now:yyyyMMddHHmmss}";

        // Build the Excel of exactly what's being cleared (BEFORE deleting).
        var excel = await BuildClearedEntriesExcelAsync(conn, districtId, yearId, districtNumber, yearLabel);

        // Snapshot → soft-delete, atomically.
        using (var tx = await conn.BeginTransactionAsync())
        {
            await conn.ExecuteAsync(
                @"INSERT INTO district_citation_club_entry_backup
                    (batch_id, fk_district_id, fk_year_id, fk_club_id, entry_type, fk_question_id, fk_sub_question_id,
                     answer_value, points_earned, bonus_earned, orig_created_by, orig_created_date, cleared_by, cleared_date, restored)
                  SELECT @B, fk_district_id, fk_year_id, fk_club_id, entry_type, fk_question_id, fk_sub_question_id,
                     answer_value, points_earned, bonus_earned, created_by, created_date, @U, NOW(), 0
                  FROM district_citation_club_entry
                  WHERE fk_district_id=@D AND fk_year_id=@Y AND isdeleted=0",
                new { B = batchId, D = districtId, Y = yearId, U = GetUserId() }, tx);
            await conn.ExecuteAsync(
                @"UPDATE district_citation_club_entry SET isdeleted=1, modified_by=@U, modified_date=NOW()
                  WHERE fk_district_id=@D AND fk_year_id=@Y AND isdeleted=0",
                new { D = districtId, Y = yearId, U = GetUserId() }, tx);
            await tx.CommitAsync();
        }

        // Email the record to DG + District Admins (best-effort — the clear already succeeded + is restorable).
        var recipients = await GetRecipientsAsync(conn, districtId, yearId);
        var emailedTo = new List<string>();
        if (recipients.Count > 0)
        {
            var to = recipients[0];
            var cc = recipients.Skip(1).ToList();
            var subject = $"District {districtNumber} — Award club points cleared (RY {yearLabel})";
            var body =
                EmailService.EMAIL_HEADER +
                $"<h2 style='color:#1a365d;margin-top:0;'>District Awards — Club Points Cleared</h2>" +
                $"<p>Dear Sir/Madam,</p>" +
                $"<p>The District Awards club points for <strong>District {districtNumber}</strong>, Rotary Year <strong>{yearLabel}</strong> " +
                $"were cleared by a SuperAdmin on <strong>{DateTime.Now:dd MMM yyyy, hh:mm tt}</strong>.</p>" +
                $"<div style='background-color:#f7fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0;'>" +
                $"<p style='margin:0;'><strong>{liveCount}</strong> point entr{(liveCount == 1 ? "y was" : "ies were")} cleared.</p>" +
                $"<p style='margin:8px 0 0;'>The full detail (club name, category, question / criteria, answer and points) is attached as an Excel file for your records.</p>" +
                $"</div>" +
                $"<p>This can be <strong>restored on request</strong>. If this was not expected, please contact the ROW admin team.</p>" +
                EmailService.EMAIL_FOOTER;
            try
            {
                await _email.SendEmailWithAttachmentAsync(to, subject, body, excel,
                    $"District-{districtNumber}-Awards-Cleared-{DateTime.Now:yyyyMMdd_HHmmss}.xlsx", cc);
                emailedTo.AddRange(recipients);
            }
            catch { /* clear + backup already committed; don't fail the request on email trouble */ }
        }

        return Ok(new
        {
            message = $"Cleared {liveCount} club entr{(liveCount == 1 ? "y" : "ies")} for District {districtNumber} (RY {yearLabel}). A backup was taken and can be restored.",
            clearedCount = liveCount,
            emailedTo,
            batchId,
        });
    }

    // Restore the most recent not-yet-restored backup batch for this (district, year).
    [HttpPost("api/districts/{districtId:int}/awards-restore")]
    public async Task<ActionResult> RestoreAll(int districtId, [FromQuery] int yearId)
    {
        if (!IsSuperAdmin()) return StatusCode(403, new { message = "Only SuperAdmin can restore club points." });
        if (districtId <= 0 || yearId <= 0) return BadRequest(new { message = "districtId and yearId are required." });

        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();

        var batchId = await conn.ExecuteScalarAsync<string?>(
            @"SELECT batch_id FROM district_citation_club_entry_backup
              WHERE fk_district_id=@D AND fk_year_id=@Y AND restored=0
              ORDER BY cleared_date DESC LIMIT 1",
            new { D = districtId, Y = yearId });
        if (string.IsNullOrEmpty(batchId))
            return BadRequest(new { message = "There is no cleared backup to restore for this district and year." });

        int restored;
        using (var tx = await conn.BeginTransactionAsync())
        {
            // Any entries added since the clear are soft-deleted first, then the backup batch is re-inserted live.
            await conn.ExecuteAsync(
                @"UPDATE district_citation_club_entry SET isdeleted=1, modified_by=@U, modified_date=NOW()
                  WHERE fk_district_id=@D AND fk_year_id=@Y AND isdeleted=0",
                new { D = districtId, Y = yearId, U = GetUserId() }, tx);
            restored = await conn.ExecuteAsync(
                @"INSERT INTO district_citation_club_entry
                    (fk_district_id, fk_year_id, fk_club_id, entry_type, fk_question_id, fk_sub_question_id,
                     answer_value, points_earned, bonus_earned, created_by, created_date, modified_by, modified_date, isdeleted)
                  SELECT fk_district_id, fk_year_id, fk_club_id, entry_type, fk_question_id, fk_sub_question_id,
                     answer_value, points_earned, bonus_earned, orig_created_by, orig_created_date, @U, NOW(), 0
                  FROM district_citation_club_entry_backup WHERE batch_id=@B",
                new { B = batchId, U = GetUserId() }, tx);
            await conn.ExecuteAsync(
                "UPDATE district_citation_club_entry_backup SET restored=1, restored_date=NOW() WHERE batch_id=@B",
                new { B = batchId }, tx);
            await tx.CommitAsync();
        }

        return Ok(new { message = $"Restored {restored} club entr{(restored == 1 ? "y" : "ies")}.", restoredCount = restored });
    }

    // ─────────────────────────── helpers ───────────────────────────

    private static async Task<(string DistrictNumber, string YearLabel)> DistrictYearLabelsAsync(MySqlConnection conn, int districtId, int yearId)
    {
        var dn = await conn.ExecuteScalarAsync<string?>("SELECT DistrictNumber FROM district_master WHERE pk_district_id=@D", new { D = districtId }) ?? districtId.ToString();
        var yl = await conn.ExecuteScalarAsync<string?>("SELECT YearLabel FROM rotary_year_master WHERE pk_year_id=@Y", new { Y = yearId }) ?? yearId.ToString();
        return (dn, yl);
    }

    // DG email + every active District Admin's email, de-duplicated. The DG's address comes from
    // their member profile, or from the DG row itself when the governor is not a member of any club
    // (LEFT JOIN — an INNER JOIN would leave such a district without its governor on the mail).
    private static async Task<List<string>> GetRecipientsAsync(MySqlConnection conn, int districtId, int yearId)
    {
        var emails = new List<string>();
        var dg = await conn.ExecuteScalarAsync<string?>(
            $@"SELECT {DistrictGovernorSql.Email} FROM district_governors g
              {DistrictGovernorSql.JoinMember}
              WHERE g.fk_district_id=@D AND g.fk_year_id=@Y AND g.isdeleted=0
                AND {DistrictGovernorSql.Email} IS NOT NULL AND TRIM({DistrictGovernorSql.Email}) <> '' LIMIT 1",
            new { D = districtId, Y = yearId });
        if (!string.IsNullOrWhiteSpace(dg)) emails.Add(dg.Trim());

        var admins = (await conn.QueryAsync<string>(
            @"SELECT DISTINCT m.EmailId FROM member_roles r
              JOIN member_master_profile m ON m.pk_member_master_profile_id = r.fk_member_master_profile_id AND COALESCE(m.isdeleted,0)=0
              WHERE r.fk_role_id=2 AND r.fk_district_id=@D AND (r.fk_club_id IS NULL OR r.fk_club_id=0)
                AND r.IsActive=1 AND r.isdeleted=0 AND m.EmailId IS NOT NULL AND TRIM(m.EmailId) <> ''",
            new { D = districtId })).ToList();
        foreach (var a in admins) if (!string.IsNullOrWhiteSpace(a)) emails.Add(a.Trim());

        return emails.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    }

    // A flat, human-readable Excel of the entries being cleared: one row per entry with resolved labels.
    private static async Task<byte[]> BuildClearedEntriesExcelAsync(MySqlConnection conn, int districtId, int yearId, string districtNumber, string yearLabel)
    {
        var rows = (await conn.QueryAsync<dynamic>(@"
            SELECT cm.ClubName AS clubName,
                   e.entry_type AS entryType,
                   COALESCE(acat.category_name, mcat.category_name) AS category,
                   COALESCE(aact.activity_name, mc.criteria_name) AS question,
                   COALESCE(asub.sub_item_name, msc.sub_criteria_title) AS subItem,
                   e.answer_value AS answerValue,
                   e.points_earned AS points, e.bonus_earned AS bonus
            FROM district_citation_club_entry e
            JOIN club_master cm ON cm.pk_club_id = e.fk_club_id
            LEFT JOIN district_citation_auto_question aq ON e.entry_type='auto' AND aq.pk_id = e.fk_question_id
            LEFT JOIN district_citation_category acat ON acat.pk_id = aq.fk_category_id
            LEFT JOIN district_citation_activity_master aact ON aact.pk_id = aq.fk_activity_id
            LEFT JOIN district_citation_auto_question_sub asub ON asub.pk_id = e.fk_sub_question_id
            LEFT JOIN district_citation_manual_sub_criteria msc ON e.entry_type='manual' AND msc.pk_id = e.fk_question_id
            LEFT JOIN district_citation_manual_criteria mc ON mc.pk_id = msc.fk_criteria_id
            LEFT JOIN district_citation_category mcat ON mcat.pk_id = mc.fk_category_id
            WHERE e.fk_district_id=@D AND e.fk_year_id=@Y AND e.isdeleted=0
            ORDER BY cm.ClubName, e.entry_type, category, question",
            new { D = districtId, Y = yearId })).ToList();

        using var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add("Cleared Points");
        ws.Cell(1, 1).Value = $"District {districtNumber} — Award Club Points Cleared · RY {yearLabel} · {DateTime.Now:dd MMM yyyy, hh:mm tt}";
        ws.Range(1, 1, 1, 8).Merge();
        ws.Cell(1, 1).Style.Font.Bold = true; ws.Cell(1, 1).Style.Font.FontSize = 13;
        ws.Cell(1, 1).Style.Font.FontColor = XLColor.White; ws.Cell(1, 1).Style.Fill.BackgroundColor = XLColor.FromHtml("#1e3a5f");

        string[] headers = { "Club", "Type", "Category", "Question / Criteria", "Sub Item", "Answer", "Points", "Bonus" };
        int hr = 3;
        for (int c = 0; c < headers.Length; c++)
        {
            var cell = ws.Cell(hr, c + 1); cell.Value = headers[c];
            cell.Style.Font.Bold = true; cell.Style.Font.FontColor = XLColor.White;
            cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#274b73");
        }
        int r = hr + 1;
        foreach (var row in rows)
        {
            ws.Cell(r, 1).Value = (string?)row.clubName ?? "";
            ws.Cell(r, 2).Value = ((string?)row.entryType ?? "").ToUpperInvariant() == "AUTO" ? "Auto" : "Manual";
            ws.Cell(r, 3).Value = (string?)row.category ?? "";
            ws.Cell(r, 4).Value = (string?)row.question ?? "";
            ws.Cell(r, 5).Value = (string?)row.subItem ?? "";
            ws.Cell(r, 6).Value = (string?)row.answerValue ?? "";
            ws.Cell(r, 7).Value = row.points == null ? 0m : (decimal)row.points;
            ws.Cell(r, 8).Value = row.bonus == null ? 0m : (decimal)row.bonus;
            r++;
        }
        ws.Columns(1, 8).AdjustToContents();
        ws.SheetView.FreezeRows(hr);

        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }
}
