using ClosedXML.Excel;
using Dapper;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using MySqlConnector;
using System.Globalization;

namespace RotaryOrgSyncWorker.Services;

/// <summary>
/// Daily member sync (Option A — profile updates only).
///
/// Flow:
///   1. /individuals/updates → list of MemberIds with changes
///   2. Dedupe by MemberId
///   3. For each MemberId — only if RotaryId already in our DB:
///        a. Fetch /individuals/{id} for latest profile
///        b. UPDATE basic fields: name, DOB, gender, language, classification, IsYouth
///   4. Skip members not in our DB (new members + terminations need a separate per-club sweep)
///
/// What this DOESN'T do (separate weekly sweep mode will):
///   - Add new members
///   - Detect terminations
///   - Update email/phone/address (those need separate /individuals/{id}/emails etc. endpoints)
/// </summary>
public class MemberSyncWorker
{
    private readonly IRotaryOrgApiClient _api;
    private readonly EmailReportSender _emailSender;
    private readonly IConfiguration _config;
    private readonly ILogger<MemberSyncWorker> _logger;
    private readonly string _connectionString;

    public MemberSyncWorker(
        IRotaryOrgApiClient api,
        EmailReportSender emailSender,
        IConfiguration config,
        ILogger<MemberSyncWorker> logger)
    {
        _api = api;
        _emailSender = emailSender;
        _config = config;
        _logger = logger;
        _connectionString = config.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("ConnectionStrings:DefaultConnection missing");
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    public async Task RunAsync(CancellationToken ct = default)
    {
        var startedAt = DateTime.UtcNow;
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === Member Sync START (Option A — profile updates only) ===");

        // Determine date window: last successful sync − 2hr safety overlap → now
        DateTime windowStart;
        await using (var conn0 = CreateConnection())
        {
            await conn0.OpenAsync(ct);
            var lastSync = await conn0.ExecuteScalarAsync<DateTime?>(@"
                SELECT MAX(StartedAtUtc) FROM rotary_org_sync_log
                WHERE Status = 'Completed' AND SyncType = 'MemberSync' AND isdeleted = 0");
            windowStart = lastSync.HasValue ? lastSync.Value.AddHours(-2) : DateTime.UtcNow.AddDays(-1);
        }
        var windowEnd = DateTime.UtcNow;
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Window: {windowStart:yyyy-MM-dd HH:mm} UTC → {windowEnd:yyyy-MM-dd HH:mm} UTC");

        // Insert log row
        int logId;
        await using (var conn = CreateConnection())
        {
            await conn.OpenAsync(ct);
            var triggeredBy = int.Parse(_config["RotaryOrgSync:TriggeredByMemberId"] ?? "0");
            logId = await conn.ExecuteScalarAsync<int>(@"
                INSERT INTO rotary_org_sync_log (SyncType, StartedAtUtc, Status, TriggeredBy)
                VALUES ('MemberSync', UTC_TIMESTAMP(), 'Running', @By);
                SELECT LAST_INSERT_ID();",
                new { By = triggeredBy });
        }

        var updated = new List<MemberChangeRow>();
        var skippedNotInDb = new List<SkippedMemberRow>();
        var skippedNoAccess = new List<SkippedMemberRow>();
        int errorCount = 0;
        int detailFetched = 0;

        try
        {
            // Step 1: fetch change notifications
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Fetching /individuals/updates...");
            var notifications = await _api.GetMemberUpdateNotificationsAsync(windowStart, windowEnd, ct);
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] {notifications.Count} change notification(s)");

            var uniqueMemberIds = notifications.Select(n => n.MemberId).Where(id => id > 0).Distinct().ToList();
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] {uniqueMemberIds.Count} unique members to process");

            if (uniqueMemberIds.Count == 0)
            {
                await using var conn1 = CreateConnection();
                await conn1.OpenAsync(ct);
                await conn1.ExecuteAsync(@"
                    UPDATE rotary_org_sync_log
                    SET FinishedAtUtc = UTC_TIMESTAMP(), Status = 'Completed', TotalFetched = 0
                    WHERE pk_id = @Id",
                    new { Id = logId });
                Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] No member changes — sending no-op email");
                await SendEmailAsync(logId, 0, 0, 0, 0, 0, windowStart, windowEnd,
                    new List<MemberChangeRow>(), updated, new List<MemberChangeRow>(),
                    skippedNotInDb, skippedNoAccess);
                return;
            }

            // Step 2: load existing local member RotaryIds for fast lookup
            await using var dbConn = CreateConnection();
            await dbConn.OpenAsync(ct);
            var localMembersByRotaryId = (await dbConn.QueryAsync<(int pk_id, string rotaryId)>(@"
                SELECT pk_member_master_profile_id AS pk_id, IFNULL(RotaryId, '') AS rotaryId
                FROM member_master_profile
                WHERE isdeleted = 0 AND RotaryId IS NOT NULL AND RotaryId <> ''"))
                .ToDictionary(x => x.rotaryId, x => x.pk_id, StringComparer.OrdinalIgnoreCase);
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Local members with RotaryId: {localMembersByRotaryId.Count}");

            // Step 3: for each unique MemberId — fetch detail ONLY if they exist in our DB
            foreach (var mid in uniqueMemberIds)
            {
                ct.ThrowIfCancellationRequested();
                var midStr = mid.ToString();

                // Skip immediately if not in our DB — avoids wasted API calls
                if (!localMembersByRotaryId.TryGetValue(midStr, out var localPk))
                {
                    skippedNotInDb.Add(new SkippedMemberRow { RotaryId = midStr, Name = "", Reason = "Not in our DB (new/external member)" });
                    continue;
                }

                try
                {
                    var detail = await _api.GetMemberDetailAsync(mid, ct);
                    detailFetched++;
                    if (detailFetched % 25 == 0)
                        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Detail fetched {detailFetched}");

                    if (detail == null)
                    {
                        // 401/403/404 — no access OR doesn't exist
                        skippedNoAccess.Add(new SkippedMemberRow { RotaryId = midStr, Name = "", Reason = "No access from Rotary.org (401/403/404)" });
                        continue;
                    }

                    var changes = await UpdateProfileAsync(dbConn, localPk, detail, ct);
                    if (changes.Count > 0)
                    {
                        updated.Add(new MemberChangeRow
                        {
                            RotaryId = midStr,
                            Name = BuildName(detail),
                            ChangedFields = string.Join(", ", changes),
                        });
                    }

                    await Task.Delay(100, ct);
                }
                catch (OperationCanceledException) { throw; }
                catch (Exception ex)
                {
                    errorCount++;
                    _logger.LogError(ex, "Error on MemberId={Id}", mid);
                }
            }

            // Finalize log
            await dbConn.ExecuteAsync(@"
                UPDATE rotary_org_sync_log
                SET FinishedAtUtc = UTC_TIMESTAMP(), Status = 'Completed',
                    TotalFetched = @Total, UpdatedCount = @Upd,
                    SkippedDistrictMissing = @Skip, ErrorCount = @Err
                WHERE pk_id = @Id",
                new
                {
                    Id = logId,
                    Total = uniqueMemberIds.Count,
                    Upd = updated.Count,
                    Skip = skippedNotInDb.Count + skippedNoAccess.Count,
                    Err = errorCount,
                });

            var totalElapsed = DateTime.UtcNow - startedAt;
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === Member Sync DONE in {totalElapsed.TotalMinutes:F1} min ===");
            Console.WriteLine($"  Notifications:           {notifications.Count}");
            Console.WriteLine($"  Unique members:          {uniqueMemberIds.Count}");
            Console.WriteLine($"  Updated (profile):       {updated.Count}");
            Console.WriteLine($"  Skipped — not in DB:     {skippedNotInDb.Count}");
            Console.WriteLine($"  Skipped — no access:     {skippedNoAccess.Count}");
            Console.WriteLine($"  Errors:                  {errorCount}");

            // Option A logic: only profile updates flow through this sync. New-member adds and
            // terminations are deferred to a separate per-club sweep, so these lists are always
            // empty here — but we still expose them in the Excel for future-proofing.
            var added = new List<MemberChangeRow>();
            var terminated = new List<MemberChangeRow>();

            await SendEmailAsync(logId, uniqueMemberIds.Count, added.Count, updated.Count, terminated.Count,
                skippedNotInDb.Count + skippedNoAccess.Count, windowStart, windowEnd,
                added, updated, terminated, skippedNotInDb, skippedNoAccess);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[{DateTime.Now:HH:mm:ss}] MEMBER SYNC FAILED: {ex.Message}");
            try
            {
                await using var conn = CreateConnection();
                await conn.OpenAsync(CancellationToken.None);
                await conn.ExecuteAsync(@"
                    UPDATE rotary_org_sync_log
                    SET FinishedAtUtc = UTC_TIMESTAMP(), Status = 'Failed', ErrorDetail = @Err
                    WHERE pk_id = @Id",
                    new { Id = logId, Err = ex.Message + "\n" + ex.StackTrace });
            }
            catch { }
            throw;
        }
    }

    // ─────────────────────── Profile update with field-merge rules ───────────────────────

    private async Task<List<string>> UpdateProfileAsync(MySqlConnection conn, int memberPk, RotaryOrgMemberDto m, CancellationToken ct)
    {
        var changes = new List<string>();
        var setClauses = new List<string>();
        var pars = new DynamicParameters();
        pars.Add("Id", memberPk);

        var name = BuildName(m);
        if (!string.IsNullOrWhiteSpace(name))
        {
            setClauses.Add("MemberName = @Name");
            pars.Add("Name", Truncate(name, 200));
            changes.Add("Name");
        }

        var dob = ParseDob(m.DateOfBirth);
        if (dob.HasValue)
        {
            setClauses.Add("BirthDate = @Dob, IsYouth = @IsYouth");
            pars.Add("Dob", dob.Value);
            pars.Add("IsYouth", ComputeIsYouth(dob.Value));
            changes.Add("DOB+IsYouth");
        }

        if (!string.IsNullOrWhiteSpace(m.Gender))
        {
            setClauses.Add("Gender = @Gender");
            pars.Add("Gender", Truncate(m.Gender, 20));
            changes.Add("Gender");
        }

        if (!string.IsNullOrWhiteSpace(m.PrimaryLanguage))
        {
            setClauses.Add("PrimaryLanguage = @Lang");
            pars.Add("Lang", Truncate(m.PrimaryLanguage, 50));
            changes.Add("Lang");
        }

        if (setClauses.Count == 0) return changes;

        setClauses.Add("modified_date = NOW()");
        var sql = $"UPDATE member_master_profile SET {string.Join(", ", setClauses)} WHERE pk_member_master_profile_id = @Id";
        await conn.ExecuteAsync(sql, pars);
        return changes;
    }

    // ─────────────────────── Helpers ───────────────────────

    private static string BuildName(RotaryOrgMemberDto m)
    {
        if (!string.IsNullOrWhiteSpace(m.LocalizedName)) return m.LocalizedName.Trim();
        var parts = new[] { m.Prefix, m.FirstName, m.MiddleName, m.LastName, m.Suffix }
            .Where(s => !string.IsNullOrWhiteSpace(s)).Select(s => s!.Trim());
        return string.Join(" ", parts);
    }

    private static DateTime? ParseDob(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var v = raw.Trim();
        // Rotary.org DOB format is "MM/dd/yyyy"
        if (DateTime.TryParseExact(v, "MM/dd/yyyy", CultureInfo.InvariantCulture, DateTimeStyles.None, out var dt))
            return dt.Date;
        if (DateTime.TryParse(v, CultureInfo.InvariantCulture, DateTimeStyles.None, out var dt2))
            return dt2.Date;
        return null;
    }

    private static int ComputeIsYouth(DateTime dob)
    {
        var today = DateTime.Today;
        int age = today.Year - dob.Year;
        if (dob.Date > today.AddYears(-age)) age--;
        return (age >= 18 && age <= 40) ? 1 : 0;
    }

    private static string? Truncate(string? value, int maxLen)
    {
        if (value == null) return null;
        var v = value.Trim();
        if (v.Length == 0) return null;
        return v.Length <= maxLen ? v : v.Substring(0, maxLen);
    }

    // ─────────────────────── Email ───────────────────────

    private async Task SendEmailAsync(int logId, int totalUnique, int addedCount, int updatedCount, int terminatedCount, int skippedCount,
        DateTime windowStart, DateTime windowEnd,
        List<MemberChangeRow> added, List<MemberChangeRow> updated, List<MemberChangeRow> terminated,
        List<SkippedMemberRow> skippedNotInDb, List<SkippedMemberRow> skippedNoAccess)
    {
        try
        {
            using var workbook = new XLWorkbook();
            var summary = workbook.Worksheets.Add("Summary");
            summary.Cell(1, 1).Value = "Rotary.org Daily Member Sync (Profile Updates)";
            summary.Range("A1:B1").Merge().Style.Font.SetBold().Font.SetFontSize(14);
            summary.Cell(3, 1).Value = "Log ID"; summary.Cell(3, 2).Value = logId;
            summary.Cell(4, 1).Value = "Window start (UTC)"; summary.Cell(4, 2).Value = windowStart.ToString("u");
            summary.Cell(5, 1).Value = "Window end (UTC)"; summary.Cell(5, 2).Value = windowEnd.ToString("u");
            summary.Cell(6, 1).Value = "Total unique members"; summary.Cell(6, 2).Value = totalUnique;
            summary.Cell(7, 1).Value = "Added (new)"; summary.Cell(7, 2).Value = added.Count;
            summary.Cell(8, 1).Value = "Profile updated"; summary.Cell(8, 2).Value = updatedCount;
            summary.Cell(9, 1).Value = "Terminated"; summary.Cell(9, 2).Value = terminated.Count;
            summary.Cell(10, 1).Value = "Skipped — not in DB"; summary.Cell(10, 2).Value = skippedNotInDb.Count;
            summary.Cell(11, 1).Value = "Skipped — no access"; summary.Cell(11, 2).Value = skippedNoAccess.Count;
            summary.Columns().AdjustToContents();

            AddUpdatedSheet(workbook, "Added", added);
            AddUpdatedSheet(workbook, "Updated", updated);
            AddUpdatedSheet(workbook, "Terminated", terminated);
            AddSkippedSheet(workbook, "Skipped (not in DB)", skippedNotInDb);
            AddSkippedSheet(workbook, "Skipped (no access)", skippedNoAccess);

            using var ms = new MemoryStream();
            workbook.SaveAs(ms);
            var bytes = ms.ToArray();
            var fileName = $"RotaryOrg_MemberSync_{DateTime.Now:yyyyMMdd_HHmmss}.xlsx";

            var triggeredByName = _config["RotaryOrgSync:TriggeredByName"] ?? "Admin";

            var body = $@"<div style='font-family:Arial,sans-serif;'>
<h2 style='color:#1a365d;'>Rotary.org Daily Member Sync (Profile Updates)</h2>
<p>Dear {System.Net.WebUtility.HtmlEncode(triggeredByName)},</p>
<p>Daily member sync ran. <b>This run only updates profile fields</b> (name, DOB, gender, language, IsYouth) for members already in our DB. New members and terminations need a separate per-club sweep — coming next phase.</p>
<table style='border-collapse:collapse;margin:12px 0;border:1px solid #e5e7eb;'>
<thead><tr style='background:#1a365d;color:white;'>
  <td style='padding:8px 12px;'>Metric</td>
  <td style='padding:8px 12px;text-align:right;'>Count</td>
</tr></thead>
<tbody>
  <tr><td style='padding:6px 12px;border:1px solid #e5e7eb;'>Window (UTC)</td><td style='padding:6px 12px;border:1px solid #e5e7eb;'>{windowStart:yyyy-MM-dd HH:mm} → {windowEnd:yyyy-MM-dd HH:mm}</td></tr>
  <tr><td style='padding:6px 12px;border:1px solid #e5e7eb;'>Total unique members changed</td><td style='padding:6px 12px;border:1px solid #e5e7eb;text-align:right;'><b>{totalUnique}</b></td></tr>
  <tr><td style='padding:6px 12px;border:1px solid #e5e7eb;'>Profile updated</td><td style='padding:6px 12px;border:1px solid #e5e7eb;text-align:right;color:#16a34a;'><b>{updatedCount}</b></td></tr>
  <tr><td style='padding:6px 12px;border:1px solid #e5e7eb;'>Skipped — not in our DB</td><td style='padding:6px 12px;border:1px solid #e5e7eb;text-align:right;color:#64748b;'><b>{skippedNotInDb.Count}</b></td></tr>
  <tr><td style='padding:6px 12px;border:1px solid #e5e7eb;'>Skipped — no API access (401)</td><td style='padding:6px 12px;border:1px solid #e5e7eb;text-align:right;color:#64748b;'><b>{skippedNoAccess.Count}</b></td></tr>
</tbody>
</table>
<p>Full details (members updated/skipped) are in the attached Excel.</p>
<p style='color:#64748b;font-size:13px;'>Sync log id: {logId}.</p>
<p>Regards,<br/><strong>Team ROW</strong></p>
</div>";

            await _emailSender.SendReportAsync($"[Daily] ROW Member Profile Refresh — {DateTime.Now:dd MMM yyyy}", body, bytes, fileName);
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Email sent.");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Email failed");
            Console.Error.WriteLine($"Email failed: {ex.Message}");
        }
    }

    private static void AddUpdatedSheet(XLWorkbook wb, string sheetName, List<MemberChangeRow> rows)
    {
        var ws = wb.Worksheets.Add(sheetName);
        ws.Cell(1, 1).Value = "RotaryId";
        ws.Cell(1, 2).Value = "Name";
        ws.Cell(1, 3).Value = "ChangedFields";
        ws.Range(1, 1, 1, 3).Style.Font.SetBold().Fill.SetBackgroundColor(XLColor.LightGray);
        for (int i = 0; i < rows.Count; i++)
        {
            ws.Cell(i + 2, 1).Value = rows[i].RotaryId;
            ws.Cell(i + 2, 2).Value = rows[i].Name;
            ws.Cell(i + 2, 3).Value = rows[i].ChangedFields;
        }
        ws.Columns().AdjustToContents();
    }

    private static void AddSkippedSheet(XLWorkbook wb, string sheetName, List<SkippedMemberRow> rows)
    {
        var ws = wb.Worksheets.Add(sheetName);
        ws.Cell(1, 1).Value = "RotaryId";
        ws.Cell(1, 2).Value = "Name";
        ws.Cell(1, 3).Value = "Reason";
        ws.Range(1, 1, 1, 3).Style.Font.SetBold().Fill.SetBackgroundColor(XLColor.LightGray);
        for (int i = 0; i < rows.Count; i++)
        {
            ws.Cell(i + 2, 1).Value = rows[i].RotaryId;
            ws.Cell(i + 2, 2).Value = rows[i].Name;
            ws.Cell(i + 2, 3).Value = rows[i].Reason;
        }
        ws.Columns().AdjustToContents();
    }

    private class MemberChangeRow
    {
        public string RotaryId { get; set; } = "";
        public string Name { get; set; } = "";
        public string ChangedFields { get; set; } = "";
    }

    private class SkippedMemberRow
    {
        public string RotaryId { get; set; } = "";
        public string Name { get; set; } = "";
        public string Reason { get; set; } = "";
    }
}
