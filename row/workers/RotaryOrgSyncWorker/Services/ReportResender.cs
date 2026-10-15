using ClosedXML.Excel;
using Dapper;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using MySqlConnector;

namespace RotaryOrgSyncWorker.Services;

/// <summary>
/// Re-sends a sync report email by reading the actual current state of club_master
/// (rather than using in-memory result counts which may be stale or missing). Used
/// when an earlier bootstrap reported wrong numbers but the data was actually written.
/// </summary>
public class ReportResender
{
    private readonly EmailReportSender _emailSender;
    private readonly IConfiguration _config;
    private readonly ILogger<ReportResender> _logger;
    private readonly string _connectionString;

    public ReportResender(EmailReportSender emailSender, IConfiguration config, ILogger<ReportResender> logger)
    {
        _emailSender = emailSender;
        _config = config;
        _logger = logger;
        _connectionString = config.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("ConnectionStrings:DefaultConnection missing");
    }

    public async Task RunAsync(int? logId, CancellationToken ct = default)
    {
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(ct);

        // Pick log row: explicit id or the latest
        var logRow = logId.HasValue
            ? await conn.QueryFirstOrDefaultAsync<dynamic>(@"
                SELECT pk_id AS LogId, SyncType, StartedAtUtc, FinishedAtUtc, Status,
                       TotalFetched, InsertedCount, UpdatedCount, DisabledCount,
                       SkippedDistrictMissing, ErrorCount
                FROM rotary_org_sync_log WHERE pk_id = @Id",
                new { Id = logId.Value })
            : await conn.QueryFirstOrDefaultAsync<dynamic>(@"
                SELECT pk_id AS LogId, SyncType, StartedAtUtc, FinishedAtUtc, Status,
                       TotalFetched, InsertedCount, UpdatedCount, DisabledCount,
                       SkippedDistrictMissing, ErrorCount
                FROM rotary_org_sync_log
                WHERE Status IN ('Completed', 'Failed') AND isdeleted = 0
                ORDER BY pk_id DESC LIMIT 1");

        if (logRow == null)
        {
            Console.WriteLine("No matching sync log row found.");
            return;
        }

        int chosenLogId = (int)logRow.LogId;
        DateTime startedUtc = (DateTime)logRow.StartedAtUtc;
        Console.WriteLine($"Resending report for logId={chosenLogId}  Status={(string)logRow.Status}  StartedAtUtc={startedUtc:u}");

        // Current actual state of club_master
        var currentState = await conn.QueryFirstAsync<(int total, int synced, int local)>(@"
            SELECT
              COUNT(*) AS total,
              SUM(CASE WHEN IsSyncedFromRotaryOrg = 1 THEN 1 ELSE 0 END) AS synced,
              SUM(CASE WHEN IFNULL(IsSyncedFromRotaryOrg, 0) = 0 THEN 1 ELSE 0 END) AS local
            FROM club_master WHERE isdeleted = 0");

        // Clubs that were inserted DURING (or just after) this sync run.
        // Threshold: created_date >= sync StartedAtUtc, IsSyncedFromRotaryOrg=1
        // (StartedAtUtc is UTC; created_date is server-local. Use both bounds loosely.)
        var insertedDuringRun = (await conn.QueryAsync<(string ClubRotaryId, string ClubName, string DistrictNumber, DateTime? CharterDate, string MeetingDay)>(@"
            SELECT cm.ClubRotaryId, cm.ClubName,
                   IFNULL(d.DistrictNumber, '') AS DistrictNumber,
                   cm.ClubCharterDate AS CharterDate,
                   IFNULL(cm.MeetingDay, '') AS MeetingDay
            FROM club_master cm
            LEFT JOIN district_master d ON d.pk_district_id = cm.fk_district_id
            WHERE cm.isdeleted = 0
              AND cm.IsSyncedFromRotaryOrg = 1
              AND cm.created_date >= @Cutoff
            ORDER BY cm.ClubName",
            new { Cutoff = startedUtc.AddHours(-24) })).ToList();

        // Clubs that were already there before this run but updated (LastSyncedFromRotaryOrg refreshed during run)
        var updatedDuringRun = (await conn.QueryAsync<(string ClubRotaryId, string ClubName, string DistrictNumber, DateTime? CharterDate, string MeetingDay)>(@"
            SELECT cm.ClubRotaryId, cm.ClubName,
                   IFNULL(d.DistrictNumber, '') AS DistrictNumber,
                   cm.ClubCharterDate AS CharterDate,
                   IFNULL(cm.MeetingDay, '') AS MeetingDay
            FROM club_master cm
            LEFT JOIN district_master d ON d.pk_district_id = cm.fk_district_id
            WHERE cm.isdeleted = 0
              AND cm.IsSyncedFromRotaryOrg = 1
              AND cm.created_date < @Cutoff
              AND cm.LastSyncedFromRotaryOrg >= @SyncStart
            ORDER BY cm.ClubName",
            new { Cutoff = startedUtc.AddHours(-24), SyncStart = startedUtc.AddHours(-2) })).ToList();

        Console.WriteLine($"Current state: total={currentState.total} synced={currentState.synced} local={currentState.local}");
        Console.WriteLine($"Inserted during run (approx): {insertedDuringRun.Count}");
        Console.WriteLine($"Updated during run (approx): {updatedDuringRun.Count}");

        // Build Excel
        using var workbook = new XLWorkbook();
        var summary = workbook.Worksheets.Add("Summary");
        summary.Cell(1, 1).Value = "Rotary.org Bootstrap — Resent Report";
        summary.Range("A1:B1").Merge().Style.Font.SetBold().Font.SetFontSize(14);
        summary.Cell(3, 1).Value = "Sync Log ID"; summary.Cell(3, 2).Value = chosenLogId;
        summary.Cell(4, 1).Value = "Run Status (recorded)"; summary.Cell(4, 2).Value = (string)logRow.Status;
        summary.Cell(5, 1).Value = "Run Started (UTC)"; summary.Cell(5, 2).Value = startedUtc.ToString("u");
        summary.Cell(7, 1).Value = "— CURRENT DB STATE —";
        summary.Range("A7:B7").Merge().Style.Font.SetBold();
        summary.Cell(8, 1).Value = "Total clubs in DB"; summary.Cell(8, 2).Value = currentState.total;
        summary.Cell(9, 1).Value = "Synced from Rotary.org"; summary.Cell(9, 2).Value = currentState.synced;
        summary.Cell(10, 1).Value = "Local-only clubs"; summary.Cell(10, 2).Value = currentState.local;
        summary.Cell(12, 1).Value = "— RUN ATTRIBUTION (approx) —";
        summary.Range("A12:B12").Merge().Style.Font.SetBold();
        summary.Cell(13, 1).Value = "Inserted during this run"; summary.Cell(13, 2).Value = insertedDuringRun.Count;
        summary.Cell(14, 1).Value = "Updated during this run"; summary.Cell(14, 2).Value = updatedDuringRun.Count;
        summary.Cell(15, 1).Value = "Skipped (district missing)"; summary.Cell(15, 2).Value = (int)logRow.SkippedDistrictMissing;
        summary.Columns().AdjustToContents();

        AddClubSheet(workbook, "Inserted (during run)", insertedDuringRun);
        AddClubSheet(workbook, "Updated (during run)", updatedDuringRun);

        using var ms = new MemoryStream();
        workbook.SaveAs(ms);
        var bytes = ms.ToArray();
        var fileName = $"RotaryOrg_Sync_Report_RESEND_{DateTime.Now:yyyyMMdd_HHmmss}.xlsx";

        var triggeredByName = _config["RotaryOrgSync:TriggeredByName"] ?? "Admin";
        var body = $@"<div style='font-family:Arial,sans-serif;'>
<h2 style='color:#1a365d;'>Rotary.org Sync Report (Resend)</h2>
<p>Dear {System.Net.WebUtility.HtmlEncode(triggeredByName)},</p>
<p>This is a resend of the sync report for log id <b>{chosenLogId}</b>. Numbers below reflect the
<u>current actual state</u> of the database, which is more reliable than the original run's saved counts.</p>

<h3 style='color:#1a365d;margin-top:20px;'>Current DB state</h3>
<table style='border-collapse:collapse;margin:8px 0;'>
  <tr><td style='padding:4px 12px;'>Total clubs in DB</td><td style='padding:4px 12px;'><b>{currentState.total}</b></td></tr>
  <tr><td style='padding:4px 12px;'>Synced from Rotary.org</td><td style='padding:4px 12px;color:#16a34a;'><b>{currentState.synced}</b></td></tr>
  <tr><td style='padding:4px 12px;'>Local-only clubs</td><td style='padding:4px 12px;color:#64748b;'><b>{currentState.local}</b></td></tr>
</table>

<h3 style='color:#1a365d;margin-top:20px;'>Run attribution (approx)</h3>
<table style='border-collapse:collapse;margin:8px 0;'>
  <tr><td style='padding:4px 12px;'>Inserted during this run</td><td style='padding:4px 12px;color:#16a34a;'><b>{insertedDuringRun.Count}</b></td></tr>
  <tr><td style='padding:4px 12px;'>Updated during this run</td><td style='padding:4px 12px;color:#2563eb;'><b>{updatedDuringRun.Count}</b></td></tr>
  <tr><td style='padding:4px 12px;'>Skipped (district missing)</td><td style='padding:4px 12px;color:#64748b;'><b>{(int)logRow.SkippedDistrictMissing}</b></td></tr>
</table>

<p style='color:#64748b;font-size:13px;'>
Note: 'Inserted during run' = clubs marked synced with created_date after the run's StartedAtUtc.
'Updated during run' = previously-existing synced clubs whose LastSyncedFromRotaryOrg was refreshed during the run window.
These are computed from the database now, so are accurate even if the original run's in-memory counts were lost.
</p>

<p>Full club lists are in the attached Excel.</p>
<p>Regards,<br/><strong>Team ROW</strong></p>
</div>";

        await _emailSender.SendReportAsync($"[Resent] ROW Report Log #{chosenLogId}", body, bytes, fileName);
        Console.WriteLine($"Email sent for log #{chosenLogId}.");
    }

    private static void AddClubSheet(XLWorkbook wb, string sheetName, List<(string ClubRotaryId, string ClubName, string DistrictNumber, DateTime? CharterDate, string MeetingDay)> rows)
    {
        var ws = wb.Worksheets.Add(sheetName);
        ws.Cell(1, 1).Value = "ClubRotaryId";
        ws.Cell(1, 2).Value = "ClubName";
        ws.Cell(1, 3).Value = "DistrictNumber";
        ws.Cell(1, 4).Value = "CharterDate";
        ws.Cell(1, 5).Value = "MeetingDay";
        ws.Range(1, 1, 1, 5).Style.Font.SetBold().Fill.SetBackgroundColor(XLColor.LightGray);
        for (int i = 0; i < rows.Count; i++)
        {
            var r = rows[i];
            ws.Cell(i + 2, 1).Value = r.ClubRotaryId;
            ws.Cell(i + 2, 2).Value = r.ClubName;
            ws.Cell(i + 2, 3).Value = r.DistrictNumber;
            ws.Cell(i + 2, 4).Value = r.CharterDate?.ToString("yyyy-MM-dd") ?? "";
            ws.Cell(i + 2, 5).Value = r.MeetingDay;
        }
        ws.Columns().AdjustToContents();
    }
}
