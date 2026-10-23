using ClosedXML.Excel;
using Dapper;
using MySqlConnector;

namespace RotaryApi.Services.RotaryOrg;

/// <summary>
/// Club synchronization engine. Pulls clubs from Rotary.org, matches them to
/// our `club_master` by ClubRotaryId, upserts only Rotary.org-owned fields
/// (preserves local-edited columns), and flags disappeared clubs as
/// IsSyncedFromRotaryOrg=0 + ROW_as_vendor_selected=0 (never deleted).
///
/// Design notes:
///  - First-time INSERT only: ActiveFromDate = ClubCharterDate,
///    ActiveToDate = ClubCharterDate + 70 years (unless admin sets later).
///  - Clubs from districts we don't have locally are SKIPPED + reported.
///  - Full sync runs in the background via Task.Run. Progress tracked in
///    rotary_org_sync_log; on completion emails a 3-sheet XLSX to the
///    triggering user.
/// </summary>
public class ClubSyncService : IClubSyncService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<ClubSyncService> _logger;
    private readonly IConfiguration _config;
    private readonly string _connectionString;

    public ClubSyncService(
        IServiceScopeFactory scopeFactory,
        IConfiguration config,
        ILogger<ClubSyncService> logger)
    {
        _scopeFactory = scopeFactory;
        _config = config;
        _logger = logger;
        _connectionString = config.GetConnectionString("DefaultConnection")!;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    // ─────────────────────────── Public API ───────────────────────────

    public async Task<int> StartBootstrapAsync(string triggeredByEmail, string triggeredByName, int triggeredByMemberId)
    {
        // Insert log row FIRST so we have an ID to return.
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var logId = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO rotary_org_sync_log (SyncType, StartedAtUtc, Status, TriggeredBy)
            VALUES ('Bootstrap', UTC_TIMESTAMP(), 'Running', @By);
            SELECT LAST_INSERT_ID();",
            new { By = triggeredByMemberId });

        // Fire-and-forget — caller gets the ID immediately.
        _ = Task.Run(async () => await RunBootstrapBackgroundAsync(logId, triggeredByEmail, triggeredByName));
        return logId;
    }

    public async Task<SyncStatusDto?> GetStatusAsync(int logId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var row = await conn.QueryFirstOrDefaultAsync<SyncStatusDto>(@"
            SELECT pk_id AS LogId, SyncType, Status, StartedAtUtc, FinishedAtUtc,
                   TotalFetched, InsertedCount, UpdatedCount, DisabledCount,
                   SkippedDistrictMissing, ErrorCount, ErrorDetail
            FROM rotary_org_sync_log WHERE pk_id = @Id AND isdeleted = 0",
            new { Id = logId });
        return row;
    }

    // ─────────────────────── Background worker ───────────────────────

    private async Task RunBootstrapBackgroundAsync(int logId, string toEmail, string toName)
    {
        var result = new SyncResult { LogId = logId };
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var api = scope.ServiceProvider.GetRequiredService<IRotaryOrgApiClient>();

            _logger.LogInformation("🔑 [RI.org sync #{LogId}] bootstrap START", logId);

            var clubs = await api.GetClubsAsync();
            result.TotalFetched = clubs.Count;
            _logger.LogInformation("🔑 [RI.org sync #{LogId}] fetched {Count} clubs — processing...", logId, clubs.Count);

            using var conn = CreateConnection();
            await conn.OpenAsync();

            // District lookup: old DB has DistrictNumber as string e.g. "3141". RI.org returns int.
            var districts = (await conn.QueryAsync<(int pk_id, string districtNumber)>(
                "SELECT pk_district_id AS pk_id, DistrictNumber AS districtNumber FROM district_master WHERE isdeleted = 0"))
                .ToDictionary(x => x.districtNumber, x => x.pk_id, StringComparer.OrdinalIgnoreCase);

            // Existing clubs by ClubRotaryId for fast lookup
            var existing = (await conn.QueryAsync<(int pk_id, string clubRotaryId, string clubName, int fk_district_id, DateTime? charterDate)>(@"
                SELECT pk_club_id AS pk_id, ClubRotaryId AS clubRotaryId, ClubName AS clubName,
                       fk_district_id, ClubCharterDate AS charterDate
                FROM club_master WHERE isdeleted = 0"))
                .ToDictionary(x => x.clubRotaryId, StringComparer.OrdinalIgnoreCase);

            int idx = 0;
            foreach (var club in clubs)
            {
                idx++;
                try
                {
                    // Resolve district — skip if RI.org's district not in our local district_master
                    if (!districts.TryGetValue(club.DistrictId?.ToString() ?? "", out var localDistrictId))
                    {
                        result.SkippedDistrictMissing++;
                        result.Skipped.Add(new SkippedClubRow
                        {
                            ClubRotaryId = club.ClubId.ToString(),
                            ClubName = club.ClubName ?? "",
                            RotaryOrgDistrictId = club.DistrictId ?? 0,
                            Reason = $"District {club.DistrictId} not in local district_master",
                        });
                        continue;
                    }

                    // Fetch detail for meeting info + charter date
                    var detail = await api.GetClubDetailAsync(club.ClubType ?? "Rotary Club", club.ClubId);
                    if (detail == null)
                    {
                        result.ErrorCount++;
                        _logger.LogWarning("🔑 [RI.org sync #{LogId}] detail 404 for ClubId={ClubId}", logId, club.ClubId);
                        continue;
                    }

                    // Find the "Meeting" address (fallback to primary, then first)
                    // ONLY "Meeting Location" per user 2026-07-10 — no fallback.
                    // If null → MeetingAddress/MeetingDay updates skipped via COALESCE.
                    var addr = detail.Addresses?.FirstOrDefault(a => string.Equals(a.AddressType, "Meeting Location", StringComparison.OrdinalIgnoreCase));

                    var meetingAddress = BuildMeetingAddress(addr);
                    var meetingFromTime = ParseTime(addr?.MeetingTime);
                    var clubRotaryIdStr = club.ClubId.ToString();

                    if (existing.TryGetValue(clubRotaryIdStr, out var existingRow))
                    {
                        // UPDATE — overwrite only Rotary.org-owned fields
                        await conn.ExecuteAsync(@"
                            UPDATE club_master SET
                                fk_district_id = @DistrictPk,
                                ClubName = @ClubName,
                                ClubCharterDate = @CharterDate,
                                Country = @Country,
                                State = @State,
                                City = @City,
                                Pincode = @PinCode,
                                MeetingAddress = COALESCE(@MeetingAddress, MeetingAddress),
                                MeetingDay      = COALESCE(@MeetingDay,     MeetingDay),
                                MeetingFromTime = @MeetingFromTime,
                                IsSyncedFromRotaryOrg = 1,
                                LastSyncedFromRotaryOrg = NOW(),
                                ROW_as_vendor_selected = 1,
                                modified_date = NOW()
                            WHERE pk_club_id = @Id",
                            new
                            {
                                Id = existingRow.pk_id,
                                DistrictPk = localDistrictId,
                                ClubName = detail.ClubName ?? club.ClubName,
                                CharterDate = detail.CharterDate,
                                Country = addr?.Country,
                                State = IndianStateResolver.NormalizeForCountry(addr?.State, addr?.Country),
                                City = addr?.City,
                                PinCode = addr?.PostalCode,
                                MeetingAddress = meetingAddress,
                                MeetingDay = NormalizeMeetingDay(addr?.MeetingDay),
                                MeetingFromTime = meetingFromTime,
                            });
                        result.UpdatedCount++;
                        result.Updated.Add(new ClubChangeRow
                        {
                            ClubRotaryId = clubRotaryIdStr,
                            ClubName = detail.ClubName ?? "",
                            DistrictNumber = club.DistrictId?.ToString() ?? "",
                            CharterDate = detail.CharterDate,
                            MeetingDay = addr?.MeetingDay ?? "",
                        });
                    }
                    else
                    {
                        // INSERT — set smart defaults for ActiveFromDate / ActiveToDate
                        var activeFrom = detail.CharterDate;
                        var activeTo = detail.CharterDate?.AddYears(70);
                        await conn.ExecuteAsync(@"
                            INSERT INTO club_master (
                                fk_district_id, ClubRotaryId, ClubName, Timezone,
                                ClubCharterDate, MeetingDay, MeetingFromTime, MeetingAddress,
                                Country, State, City, Pincode,
                                ActiveFromDate, ActiveToDate,
                                IsAutomaticMeetingReminder, IsFamilyLogin, IsActive,
                                IsSyncedFromRotaryOrg, LastSyncedFromRotaryOrg,
                                ROW_as_vendor_selected,
                                created_date, isdeleted
                            ) VALUES (
                                @DistrictPk, @ClubRotaryId, @ClubName, @Tz,
                                @CharterDate, @MeetingDay, @MeetingFromTime, @MeetingAddress,
                                @Country, @State, @City, @PinCode,
                                @ActiveFrom, @ActiveTo,
                                1, 0, 1,
                                1, NOW(),
                                1,
                                NOW(), 0
                            )",
                            new
                            {
                                Tz = RotaryApi.Services.Brand.DefaultTimeZone,   // ROW: the brand's zone (the original: Asia/Kolkata)
                                DistrictPk = localDistrictId,
                                ClubRotaryId = clubRotaryIdStr,
                                ClubName = detail.ClubName ?? club.ClubName,
                                CharterDate = detail.CharterDate,
                                MeetingDay = NormalizeMeetingDay(addr?.MeetingDay),
                                MeetingFromTime = meetingFromTime,
                                MeetingAddress = meetingAddress,
                                Country = addr?.Country,
                                State = IndianStateResolver.NormalizeForCountry(addr?.State, addr?.Country),
                                City = addr?.City,
                                PinCode = addr?.PostalCode,
                                ActiveFrom = activeFrom,
                                ActiveTo = activeTo,
                            });
                        result.InsertedCount++;
                        result.Inserted.Add(new ClubChangeRow
                        {
                            ClubRotaryId = clubRotaryIdStr,
                            ClubName = detail.ClubName ?? "",
                            DistrictNumber = club.DistrictId?.ToString() ?? "",
                            CharterDate = detail.CharterDate,
                            MeetingDay = addr?.MeetingDay ?? "",
                        });
                    }

                    // Progress log every 100 clubs
                    if (idx % 100 == 0)
                    {
                        await conn.ExecuteAsync(@"
                            UPDATE rotary_org_sync_log
                            SET TotalFetched = @Total, InsertedCount = @Ins, UpdatedCount = @Upd,
                                SkippedDistrictMissing = @Skip, ErrorCount = @Err
                            WHERE pk_id = @Id",
                            new
                            {
                                Id = logId,
                                Total = result.TotalFetched,
                                Ins = result.InsertedCount,
                                Upd = result.UpdatedCount,
                                Skip = result.SkippedDistrictMissing,
                                Err = result.ErrorCount,
                            });
                        _logger.LogInformation("🔑 [RI.org sync #{LogId}] progress {Idx}/{Total} — ins={Ins} upd={Upd} skip={Skip} err={Err}",
                            logId, idx, clubs.Count, result.InsertedCount, result.UpdatedCount, result.SkippedDistrictMissing, result.ErrorCount);
                    }

                    // Small delay to be gentle on Rotary.org API
                    await Task.Delay(100);
                }
                catch (Exception ex)
                {
                    result.ErrorCount++;
                    _logger.LogError(ex, "🔑 [RI.org sync #{LogId}] error on ClubId={ClubId}", logId, club.ClubId);
                }
            }

            // ─── Mark disappeared clubs as not synced ───
            // Any club in our DB that was previously synced but is NOT in the current Rotary.org list
            var riOrgIds = clubs.Select(c => c.ClubId.ToString()).ToHashSet(StringComparer.OrdinalIgnoreCase);
            foreach (var (existingId, existingInfo) in existing)
            {
                if (riOrgIds.Contains(existingId)) continue;
                // Only flag if previously marked as synced (we never touch local-only clubs)
                var wasSynced = await conn.ExecuteScalarAsync<int>(@"
                    SELECT IFNULL(IsSyncedFromRotaryOrg, 0) FROM club_master WHERE pk_club_id = @Id",
                    new { Id = existingInfo.pk_id });
                if (wasSynced == 1)
                {
                    await conn.ExecuteAsync(@"
                        UPDATE club_master
                        SET IsSyncedFromRotaryOrg = 0, ROW_as_vendor_selected = 0, modified_date = NOW()
                        WHERE pk_club_id = @Id",
                        new { Id = existingInfo.pk_id });
                    result.DisabledCount++;
                    result.Disabled.Add(new ClubChangeRow
                    {
                        ClubRotaryId = existingInfo.clubRotaryId,
                        ClubName = existingInfo.clubName,
                        DistrictNumber = "",
                        CharterDate = existingInfo.charterDate,
                        MeetingDay = "",
                    });
                }
            }

            // ─── Finalize log row ───
            await conn.ExecuteAsync(@"
                UPDATE rotary_org_sync_log
                SET FinishedAtUtc = UTC_TIMESTAMP(), Status = 'Completed',
                    TotalFetched = @Total, InsertedCount = @Ins, UpdatedCount = @Upd,
                    DisabledCount = @Dis, SkippedDistrictMissing = @Skip, ErrorCount = @Err
                WHERE pk_id = @Id",
                new
                {
                    Id = logId,
                    Total = result.TotalFetched,
                    Ins = result.InsertedCount,
                    Upd = result.UpdatedCount,
                    Dis = result.DisabledCount,
                    Skip = result.SkippedDistrictMissing,
                    Err = result.ErrorCount,
                });

            _logger.LogInformation("🔑 [RI.org sync #{LogId}] DONE — ins={Ins} upd={Upd} dis={Dis} skip={Skip} err={Err}",
                logId, result.InsertedCount, result.UpdatedCount, result.DisabledCount, result.SkippedDistrictMissing, result.ErrorCount);

            // ─── Email report — always goes to the RotaryOrgSync:ReportRecipients list
            // (triggering user's email just informs name for salutation) ───
            await SendReportEmailAsync(toEmail, toName, result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "🔑 [RI.org sync #{LogId}] FAILED", logId);
            try
            {
                using var conn2 = CreateConnection();
                await conn2.OpenAsync();
                await conn2.ExecuteAsync(@"
                    UPDATE rotary_org_sync_log
                    SET FinishedAtUtc = UTC_TIMESTAMP(), Status = 'Failed', ErrorDetail = @Err
                    WHERE pk_id = @Id",
                    new { Id = logId, Err = ex.Message + "\n" + ex.StackTrace });
            }
            catch { }
        }
    }

    // ───────────────────────── Helpers ─────────────────────────

    // Prepends the MeetingName (e.g. "Wisdom Chamber") so DB MeetingAddress
    // carries the venue name alongside the street lines. Caller has already
    // filtered to the "Meeting Location" address.
    private static string? BuildMeetingAddress(RotaryOrgAddressDto? addr)
    {
        if (addr == null) return null;
        var parts = new[] { addr.MeetingName, addr.AddressLine1, addr.AddressLine2, addr.AddressLine3 }
            .Where(p => !string.IsNullOrWhiteSpace(p))
            .Select(p => p!.Trim())
            .ToList();
        return parts.Count == 0 ? null : string.Join(", ", parts);
    }

    // Any short weekday form ("Thu", "Thurs", "Thursday", any casing) → "Thursday".
    // Returns null for null/blank so callers COALESCE the UPDATE and never overwrite
    // the stored value with an empty string.
    private static string? NormalizeMeetingDay(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var trimmed = raw.Trim();
        return trimmed.ToLowerInvariant() switch
        {
            "mon" or "monday" => "Monday",
            "tue" or "tues" or "tuesday" => "Tuesday",
            "wed" or "weds" or "wednesday" => "Wednesday",
            "thu" or "thur" or "thurs" or "thursday" => "Thursday",
            "fri" or "friday" => "Friday",
            "sat" or "saturday" => "Saturday",
            "sun" or "sunday" => "Sunday",
            _ => trimmed,
        };
    }

    // Rotary.org MeetingTime is HHMM (e.g. "1930" = 7:30 PM). The old parser
    // routed everything through TimeSpan/DateTime.TryParse and mis-interpreted
    // "1930" (produced e.g. 21:30 or year 1930 depending on culture). Handle
    // HHMM/HMM explicitly first so the DB gets the correct 19:30. Works the
    // same on any server timezone / country.
    private static TimeSpan? ParseTime(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var trimmed = raw.Trim();

        if (trimmed.Length == 4 && trimmed.All(char.IsDigit))
        {
            var hh = int.Parse(trimmed[..2]);
            var mm = int.Parse(trimmed[2..]);
            if (hh < 24 && mm < 60) return new TimeSpan(hh, mm, 0);
        }
        if (trimmed.Length == 3 && trimmed.All(char.IsDigit))
        {
            var hh = int.Parse(trimmed[..1]);
            var mm = int.Parse(trimmed[1..]);
            if (hh < 24 && mm < 60) return new TimeSpan(hh, mm, 0);
        }

        if (TimeSpan.TryParse(trimmed, System.Globalization.CultureInfo.InvariantCulture, out var t)) return (t.TotalHours >= 0 && t.TotalHours < 24) ? t : null;
        if (DateTime.TryParse(trimmed, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var dt)) return dt.TimeOfDay;
        return null;
    }

    private async Task SendReportEmailAsync(string triggeredByEmail, string triggeredByName, SyncResult r)
    {
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var emailService = scope.ServiceProvider.GetRequiredService<IEmailService>();

            // Recipients configured in appsettings → RotaryOrgSync:ReportRecipients (array of emails).
            // The triggering user is always included; the first recipient becomes the primary To.
            var configured = _config.GetSection("RotaryOrgSync:ReportRecipients").Get<string[]>() ?? Array.Empty<string>();
            var all = new List<string>(configured.Where(e => !string.IsNullOrWhiteSpace(e)).Select(e => e.Trim()));
            if (!string.IsNullOrWhiteSpace(triggeredByEmail) &&
                !all.Any(e => string.Equals(e, triggeredByEmail, StringComparison.OrdinalIgnoreCase)))
                all.Insert(0, triggeredByEmail);

            if (all.Count == 0)
            {
                _logger.LogWarning("🔑 [RI.org sync #{LogId}] no report recipients configured — skipping email", r.LogId);
                return;
            }

            var toEmail = all[0];
            var ccEmails = all.Skip(1).ToList();
            var toName = string.IsNullOrWhiteSpace(triggeredByName) ? "Admin" : triggeredByName;

            // Build 4-sheet Excel: Summary, New, Updated, Disabled, Skipped
            using var workbook = new XLWorkbook();

            var summary = workbook.Worksheets.Add("Summary");
            summary.Cell(1, 1).Value = "Rotary.org Bootstrap Sync Report";
            summary.Range("A1:B1").Merge().Style.Font.SetBold().Font.SetFontSize(14);
            summary.Cell(3, 1).Value = "Log ID"; summary.Cell(3, 2).Value = r.LogId;
            summary.Cell(4, 1).Value = "Total fetched"; summary.Cell(4, 2).Value = r.TotalFetched;
            summary.Cell(5, 1).Value = "New clubs"; summary.Cell(5, 2).Value = r.InsertedCount;
            summary.Cell(6, 1).Value = "Updated clubs"; summary.Cell(6, 2).Value = r.UpdatedCount;
            summary.Cell(7, 1).Value = "Disabled clubs"; summary.Cell(7, 2).Value = r.DisabledCount;
            summary.Cell(8, 1).Value = "Skipped (district missing)"; summary.Cell(8, 2).Value = r.SkippedDistrictMissing;
            summary.Cell(9, 1).Value = "Errors"; summary.Cell(9, 2).Value = r.ErrorCount;
            summary.Columns().AdjustToContents();

            AddChangesSheet(workbook, "New Clubs", r.Inserted);
            AddChangesSheet(workbook, "Updated Clubs", r.Updated);
            AddChangesSheet(workbook, "Disabled Clubs", r.Disabled);
            AddSkippedSheet(workbook, "Skipped (no district)", r.Skipped);

            using var ms = new MemoryStream();
            workbook.SaveAs(ms);
            var bytes = ms.ToArray();
            var fileName = $"RotaryOrg_Sync_Report_{DateTime.Now:yyyyMMdd_HHmmss}.xlsx";

            var body = $@"{EmailService.EMAIL_HEADER}
<h2 style='color:#17458F;margin-top:0;'>Rotary.org Sync Complete</h2>
<p>Dear {System.Net.WebUtility.HtmlEncode(toName)},</p>
<p>The Rotary.org bootstrap sync has finished. Summary:</p>
<table style='border-collapse:collapse; margin:12px 0;'>
  <tr><td style='padding:4px 12px;'>Total fetched</td><td style='padding:4px 12px;'><b>{r.TotalFetched}</b></td></tr>
  <tr><td style='padding:4px 12px;'>New clubs added</td><td style='padding:4px 12px;color:#16a34a;'><b>{r.InsertedCount}</b></td></tr>
  <tr><td style='padding:4px 12px;'>Existing clubs updated</td><td style='padding:4px 12px;color:#1F56A8;'><b>{r.UpdatedCount}</b></td></tr>
  <tr><td style='padding:4px 12px;'>Clubs disabled (no longer on Rotary.org)</td><td style='padding:4px 12px;color:#dc2626;'><b>{r.DisabledCount}</b></td></tr>
  <tr><td style='padding:4px 12px;'>Skipped (district missing locally)</td><td style='padding:4px 12px;color:#64748b;'><b>{r.SkippedDistrictMissing}</b></td></tr>
  <tr><td style='padding:4px 12px;'>Errors</td><td style='padding:4px 12px;color:#dc2626;'><b>{r.ErrorCount}</b></td></tr>
</table>
<p>Full details are in the attached Excel (5 sheets: Summary, New, Updated, Disabled, Skipped).</p>
<p style='color:#64748b;font-size:13px;'>Sync log id: {r.LogId}. Clubs marked disabled are NOT deleted — they remain in your database with <code>IsSyncedFromRotaryOrg=0</code> and <code>ROW_as_vendor_selected=0</code>.</p>
<p>Regards,<br/><strong>Team ROW</strong></p>
{EmailService.EMAIL_FOOTER}";

            await emailService.SendEmailWithAttachmentAsync(toEmail, $"Rotary.org Sync Report — {DateTime.Now:dd MMM yyyy}", body, bytes, fileName, ccEmails);
            _logger.LogInformation("🔑 [RI.org sync #{LogId}] report email sent — to={To} cc={CcCount}", r.LogId, LogMask.Email(toEmail), ccEmails.Count);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "🔑 [RI.org sync #{LogId}] report email FAILED", r.LogId);
        }
    }

    private static void AddChangesSheet(XLWorkbook wb, string sheetName, List<ClubChangeRow> rows)
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
            var row = rows[i];
            ws.Cell(i + 2, 1).Value = row.ClubRotaryId;
            ws.Cell(i + 2, 2).Value = row.ClubName;
            ws.Cell(i + 2, 3).Value = row.DistrictNumber;
            ws.Cell(i + 2, 4).Value = row.CharterDate?.ToString("yyyy-MM-dd") ?? "";
            ws.Cell(i + 2, 5).Value = row.MeetingDay;
        }
        ws.Columns().AdjustToContents();
    }

    private static void AddSkippedSheet(XLWorkbook wb, string sheetName, List<SkippedClubRow> rows)
    {
        var ws = wb.Worksheets.Add(sheetName);
        ws.Cell(1, 1).Value = "ClubRotaryId";
        ws.Cell(1, 2).Value = "ClubName";
        ws.Cell(1, 3).Value = "RotaryOrgDistrictId";
        ws.Cell(1, 4).Value = "Reason";
        ws.Range(1, 1, 1, 4).Style.Font.SetBold().Fill.SetBackgroundColor(XLColor.LightGray);
        for (int i = 0; i < rows.Count; i++)
        {
            var row = rows[i];
            ws.Cell(i + 2, 1).Value = row.ClubRotaryId;
            ws.Cell(i + 2, 2).Value = row.ClubName;
            ws.Cell(i + 2, 3).Value = row.RotaryOrgDistrictId;
            ws.Cell(i + 2, 4).Value = row.Reason;
        }
        ws.Columns().AdjustToContents();
    }

    // ───────────── Internal result tracking ─────────────

    private class SyncResult
    {
        public int LogId { get; set; }
        public int TotalFetched { get; set; }
        public int InsertedCount { get; set; }
        public int UpdatedCount { get; set; }
        public int DisabledCount { get; set; }
        public int SkippedDistrictMissing { get; set; }
        public int ErrorCount { get; set; }
        public List<ClubChangeRow> Inserted { get; } = new();
        public List<ClubChangeRow> Updated { get; } = new();
        public List<ClubChangeRow> Disabled { get; } = new();
        public List<SkippedClubRow> Skipped { get; } = new();
    }

    private class ClubChangeRow
    {
        public string ClubRotaryId { get; set; } = "";
        public string ClubName { get; set; } = "";
        public string DistrictNumber { get; set; } = "";
        public DateTime? CharterDate { get; set; }
        public string MeetingDay { get; set; } = "";
    }

    private class SkippedClubRow
    {
        public string ClubRotaryId { get; set; } = "";
        public string ClubName { get; set; } = "";
        public int RotaryOrgDistrictId { get; set; }
        public string Reason { get; set; } = "";
    }
}
