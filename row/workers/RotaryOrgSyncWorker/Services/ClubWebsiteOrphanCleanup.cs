using ClosedXML.Excel;
using Dapper;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using MySqlConnector;

namespace RotaryOrgSyncWorker.Services;

/// <summary>
/// Finds club_websites rows that outlived their club and soft-deletes them so a dead club can
/// never keep a live website. A website is an "orphan" when its fk_club_id points at a club that is:
///   - soft-deleted  (club_master.isdeleted = 1), OR
///   - inactive      (club_master.IsActive = 0), OR
///   - terminated    (both of the above — ClubTerminator sets isdeleted=1 + IsActive=0), OR
///   - missing entirely (no club_master row — defensive; the FK normally prevents this).
///
/// This is the CATCH-ALL safety net. ClubTerminator already soft-deletes the website inline when it
/// cascades a Rotary.org termination, but a club can also be set inactive/deleted MANUALLY (outside
/// the sync flow), and those websites would otherwise linger forever (the reminder service skips
/// orphans rather than cleaning them). This sweep closes that gap.
///
/// Cleanup action (soft-delete only — fully reversible by clearing the flag):
///   club_websites SET isdeleted = 1, Status = 'Inactive', modified_date = NOW()
///
/// NOT touched: the club_website child content tables (banners, ads, about, menus, …). They are
/// keyed by fk_club_id and are already suppressed at read-time by the active-geo-chain gate; the
/// website row itself being isdeleted=1 removes the site from serving, reminders and admin lists,
/// which is what the cleanup is for. (We keep them so re-activating the site restores its content.)
///
/// Modes:
///   --website-orphan-cleanup            → AUDIT ONLY (default). Reports what would be soft-deleted.
///   --website-orphan-cleanup --apply    → Actually soft-deletes the orphaned website rows.
///   --website-orphan-cleanup --apply --force → bypass the safety threshold.
/// Also invoked (apply) as the final step of the nightly --club-reconcile.
/// </summary>
public class ClubWebsiteOrphanCleanup
{
    private readonly EmailReportSender _emailSender;
    private readonly IConfiguration _config;
    private readonly ILogger<ClubWebsiteOrphanCleanup> _logger;
    private readonly string _connectionString;

    public ClubWebsiteOrphanCleanup(
        EmailReportSender emailSender,
        IConfiguration config,
        ILogger<ClubWebsiteOrphanCleanup> logger)
    {
        _emailSender = emailSender;
        _config = config;
        _logger = logger;
        _connectionString = config.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("ConnectionStrings:DefaultConnection missing");
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    /// <summary>Returns the number of orphaned website rows found (audit) or soft-deleted (apply).</summary>
    public async Task<int> RunAsync(bool apply, bool force = false, CancellationToken ct = default)
    {
        if (force) _logger.LogWarning("ClubWebsiteOrphanCleanup running with --force — safety threshold bypassed");
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === Club Website Orphan Cleanup {(apply ? "APPLY" : "AUDIT")} START ===");

        int logId;
        await using var conn = CreateConnection();
        await conn.OpenAsync(ct);

        var triggeredBy = int.Parse(_config["RotaryOrgSync:TriggeredByMemberId"] ?? "0");
        logId = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO rotary_org_sync_log (SyncType, StartedAtUtc, Status, TriggeredBy)
            VALUES (@Type, UTC_TIMESTAMP(), 'Running', @By);
            SELECT LAST_INSERT_ID();",
            new { Type = apply ? "WebsiteOrphanApply" : "WebsiteOrphanAudit", By = triggeredBy });

        try
        {
            // Orphan = active website row (isdeleted=0) whose club is inactive/deleted/missing.
            // LEFT JOIN so a website pointing at a non-existent club (cm IS NULL) is also caught.
            var orphans = (await conn.QueryAsync<OrphanRow>(@"
                SELECT cw.pk_id           AS WebsiteId,
                       cw.fk_club_id      AS ClubId,
                       cw.Subdomain       AS Subdomain,
                       IFNULL(cw.Status,'')   AS Status,
                       IFNULL(cm.ClubName,'') AS ClubName,
                       IFNULL(d.DistrictNumber,'') AS DistrictNumber,
                       CASE
                         WHEN cm.pk_club_id IS NULL        THEN 'Club row missing'
                         WHEN cm.isdeleted = 1             THEN 'Club deleted'
                         WHEN IFNULL(cm.IsActive,1) = 0     THEN 'Club inactive'
                         ELSE 'Unknown'
                       END AS Reason
                FROM club_websites cw
                LEFT JOIN club_master cm   ON cm.pk_club_id = cw.fk_club_id
                LEFT JOIN district_master d ON d.pk_district_id = cm.fk_district_id
                WHERE COALESCE(cw.isdeleted,0) = 0
                  AND (cm.pk_club_id IS NULL OR cm.isdeleted = 1 OR IFNULL(cm.IsActive,1) = 0)
                ORDER BY d.DistrictNumber, cm.ClubName, cw.Subdomain")).ToList();

            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Orphaned website rows found: {orphans.Count}");
            foreach (var o in orphans)
                Console.WriteLine($"  website#{o.WebsiteId}  {o.Subdomain}  (club#{o.ClubId} {o.ClubName} D{o.DistrictNumber}) — {o.Reason}, Status={o.Status}");

            if (orphans.Count == 0)
            {
                await conn.ExecuteAsync(@"
                    UPDATE rotary_org_sync_log
                    SET FinishedAtUtc = UTC_TIMESTAMP(), Status = 'Completed', ErrorDetail = 'No orphaned websites.'
                    WHERE pk_id = @Id", new { Id = logId });
                Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Nothing to clean. All active websites have a live club.");
                return 0;
            }

            // Safety threshold: a sudden spike (many websites flagged) likely means a bad state
            // (e.g. a district mass-deactivated by mistake). Abort + email instead of mass-deleting.
            int maxAuto = int.Parse(_config["RotaryOrgSync:MaxAutoWebsiteCleanupPerRun"] ?? "50");
            if (apply && !force && orphans.Count > maxAuto)
            {
                Console.WriteLine($"⚠ ABORT — {orphans.Count} orphaned websites exceed safety threshold ({maxAuto}). Not applying. Audit email sent.");
                await conn.ExecuteAsync(@"
                    UPDATE rotary_org_sync_log
                    SET FinishedAtUtc = UTC_TIMESTAMP(), Status = 'Aborted',
                        ErrorDetail = @Detail WHERE pk_id = @Id",
                    new { Id = logId, Detail = $"Safety abort: {orphans.Count} orphaned websites > threshold {maxAuto}." });
                await SendEmailAsync(apply: false, aborted: true, orphans, maxAuto);
                return orphans.Count;
            }

            if (apply)
            {
                var ids = orphans.Select(o => o.WebsiteId).ToList();
                var affected = await conn.ExecuteAsync(@"
                    UPDATE club_websites
                    SET isdeleted = 1, Status = 'Inactive', modified_date = NOW()
                    WHERE pk_id IN @Ids AND COALESCE(isdeleted,0) = 0",
                    new { Ids = ids });
                Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Soft-deleted {affected} orphaned website row(s) (isdeleted=1, Status='Inactive').");
            }

            await conn.ExecuteAsync(@"
                UPDATE rotary_org_sync_log
                SET FinishedAtUtc = UTC_TIMESTAMP(), Status = 'Completed',
                    DisabledCount = @Disabled, ErrorDetail = @Detail
                WHERE pk_id = @Id",
                new
                {
                    Id = logId,
                    Disabled = apply ? orphans.Count : 0,
                    Detail = apply
                        ? $"Soft-deleted {orphans.Count} orphaned website(s)."
                        : $"AUDIT ONLY — {orphans.Count} orphaned website(s) would be soft-deleted.",
                });

            Console.WriteLine("");
            Console.WriteLine($"=== {(apply ? "APPLIED" : "AUDIT")} — {orphans.Count} orphaned website(s) ===");
            if (!apply)
                Console.WriteLine("  This was AUDIT ONLY — no DB changes. Run with --apply to soft-delete.");

            await SendEmailAsync(apply, aborted: false, orphans, maxAuto);
            return orphans.Count;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[{DateTime.Now:HH:mm:ss}] FAILED: {ex.Message}");
            try
            {
                await conn.ExecuteAsync(@"
                    UPDATE rotary_org_sync_log
                    SET FinishedAtUtc = UTC_TIMESTAMP(), Status = 'Failed', ErrorDetail = @Err
                    WHERE pk_id = @Id", new { Id = logId, Err = ex.Message });
            }
            catch { }
            throw;
        }
    }

    private async Task SendEmailAsync(bool apply, bool aborted, List<OrphanRow> orphans, int threshold)
    {
        try
        {
            using var wb = new XLWorkbook();
            var s = wb.Worksheets.Add("Orphaned Websites");
            s.Cell(1, 1).Value = "WebsiteId";
            s.Cell(1, 2).Value = "Subdomain";
            s.Cell(1, 3).Value = "ClubId";
            s.Cell(1, 4).Value = "ClubName";
            s.Cell(1, 5).Value = "District";
            s.Cell(1, 6).Value = "Reason";
            s.Cell(1, 7).Value = "Status (before)";
            s.Range(1, 1, 1, 7).Style.Font.SetBold().Fill.SetBackgroundColor(XLColor.LightGray);
            for (int i = 0; i < orphans.Count; i++)
            {
                var o = orphans[i];
                s.Cell(i + 2, 1).Value = o.WebsiteId;
                s.Cell(i + 2, 2).Value = o.Subdomain;
                s.Cell(i + 2, 3).Value = o.ClubId;
                s.Cell(i + 2, 4).Value = o.ClubName;
                s.Cell(i + 2, 5).Value = "D" + o.DistrictNumber;
                s.Cell(i + 2, 6).Value = o.Reason;
                s.Cell(i + 2, 7).Value = o.Status;
            }
            s.Columns().AdjustToContents();

            using var ms = new MemoryStream();
            wb.SaveAs(ms);
            var bytes = ms.ToArray();
            var fileName = $"ClubWebsite_Orphans_{(aborted ? "Aborted" : apply ? "Applied" : "Audit")}_{DateTime.Now:yyyyMMdd_HHmmss}.xlsx";

            var triggeredByName = _config["RotaryOrgSync:TriggeredByName"] ?? "Admin";
            string modeText = aborted ? "SAFETY ABORT" : apply ? "APPLIED" : "AUDIT ONLY";
            string modeColor = aborted ? "#dc2626" : apply ? "#dc2626" : "#1a365d";
            string modeNote = aborted
                ? $"<p style='background:#fef2f2;border-left:4px solid #dc2626;padding:8px 12px;'>{orphans.Count} orphaned websites exceeded the safety threshold of {threshold}. Nothing was changed. Review the attached list; if legitimate, run <code>--website-orphan-cleanup --apply --force</code>.</p>"
                : apply
                    ? "<p style='background:#fef2f2;border-left:4px solid #dc2626;padding:8px 12px;'>These website rows were soft-deleted (<code>isdeleted=1, Status='Inactive'</code>) because their club is inactive/deleted.</p>"
                    : "<p style='background:#fffbeb;border-left:4px solid #f59e0b;padding:8px 12px;'>AUDIT only — no changes made. Re-run with <code>--apply</code> to soft-delete.</p>";

            var rowsHtml = string.Join("", orphans.Select((o, i) =>
                $"<tr>" +
                $"<td style='padding:6px 12px;border:1px solid #e5e7eb;color:#64748b;'>{i + 1}</td>" +
                $"<td style='padding:6px 12px;border:1px solid #e5e7eb;'><b>{System.Net.WebUtility.HtmlEncode(o.Subdomain)}</b></td>" +
                $"<td style='padding:6px 12px;border:1px solid #e5e7eb;'>{System.Net.WebUtility.HtmlEncode(o.ClubName)}</td>" +
                $"<td style='padding:6px 12px;border:1px solid #e5e7eb;color:#64748b;'>D{System.Net.WebUtility.HtmlEncode(o.DistrictNumber)}</td>" +
                $"<td style='padding:6px 12px;border:1px solid #e5e7eb;color:#64748b;'>{System.Net.WebUtility.HtmlEncode(o.Reason)}</td>" +
                $"</tr>"));

            var body = $@"<div style='font-family:Arial,sans-serif;'>
<h2 style='color:{modeColor};'>Club Website Orphan Cleanup — {modeText}</h2>
<p>Dear {System.Net.WebUtility.HtmlEncode(triggeredByName)},</p>
{modeNote}
<p>Orphaned website rows (club inactive / deleted / missing): <b>{orphans.Count}</b></p>
<table style='border-collapse:collapse;margin:12px 0;font-size:14px;border:1px solid #e5e7eb;'>
<thead>
<tr style='background:#1a365d;color:white;font-weight:bold;'>
  <td style='padding:8px 12px;border:1px solid #1a365d;'>#</td>
  <td style='padding:8px 12px;border:1px solid #1a365d;'>Subdomain</td>
  <td style='padding:8px 12px;border:1px solid #1a365d;'>Club</td>
  <td style='padding:8px 12px;border:1px solid #1a365d;'>District</td>
  <td style='padding:8px 12px;border:1px solid #1a365d;'>Reason</td>
</tr>
</thead>
<tbody>{rowsHtml}</tbody>
</table>
<p style='font-size:13px;color:#64748b;'>Soft-delete is reversible — clearing <code>isdeleted</code> restores the website and its content.</p>
<p>Regards,<br/><strong>Team ROW</strong></p>
</div>";

            var subject = aborted
                ? $"[ALERT] Club Website Cleanup Aborted — safety threshold — {DateTime.Now:dd MMM yyyy}"
                : apply
                    ? $"[Daily] Club Website Orphan Cleanup — {orphans.Count} soft-deleted — {DateTime.Now:dd MMM yyyy}"
                    : $"[Audit] Club Website Orphan Cleanup — {orphans.Count} found — {DateTime.Now:dd MMM yyyy}";
            await _emailSender.SendReportAsync(subject, body, bytes, fileName);
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Email sent.");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Club website orphan cleanup email FAILED");
            Console.Error.WriteLine($"[{DateTime.Now:HH:mm:ss}] Email failed: {ex.Message}");
        }
    }

    private class OrphanRow
    {
        public int WebsiteId { get; set; }
        public int ClubId { get; set; }
        public string Subdomain { get; set; } = "";
        public string Status { get; set; } = "";
        public string ClubName { get; set; } = "";
        public string DistrictNumber { get; set; } = "";
        public string Reason { get; set; } = "";
    }
}
