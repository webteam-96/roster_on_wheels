using ClosedXML.Excel;
using Dapper;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using MySqlConnector;

namespace RotaryOrgSyncWorker.Services;

public class ClubSyncWorker
{
    private readonly IRotaryOrgApiClient _api;
    private readonly EmailReportSender _emailSender;
    private readonly IConfiguration _config;
    private readonly ILogger<ClubSyncWorker> _logger;
    private readonly ClubMemberSweepWorker _memberSweep;
    private readonly string _connectionString;

    public ClubSyncWorker(
        IRotaryOrgApiClient api,
        EmailReportSender emailSender,
        IConfiguration config,
        ILogger<ClubSyncWorker> logger,
        ClubMemberSweepWorker memberSweep)
    {
        _api = api;
        _emailSender = emailSender;
        _config = config;
        _logger = logger;
        _memberSweep = memberSweep;
        _connectionString = config.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("ConnectionStrings:DefaultConnection missing");
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    public async Task RunBootstrapAsync(CancellationToken ct = default)
    {
        var startedAt = DateTime.UtcNow;
        var startedAtLocal = DateTime.Now;  // Match DB NOW() / created_date / LastSyncedFromRotaryOrg (server-local)
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === Bootstrap START ===");

        // Insert log row
        int logId;
        await using (var conn = CreateConnection())
        {
            await conn.OpenAsync(ct);
            var triggeredBy = int.Parse(_config["RotaryOrgSync:TriggeredByMemberId"] ?? "0");
            logId = await conn.ExecuteScalarAsync<int>(@"
                INSERT INTO rotary_org_sync_log (SyncType, StartedAtUtc, Status, TriggeredBy)
                VALUES ('Bootstrap', UTC_TIMESTAMP(), 'Running', @By);
                SELECT LAST_INSERT_ID();",
                new { By = triggeredBy });
        }
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Log row created — logId={logId}");

        var result = new SyncResult { LogId = logId };
        try
        {
            // Auth + fetch all clubs (one-shot)
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Fetching club list from Rotary.org...");
            var clubs = await _api.GetClubsAsync(ct);
            result.TotalFetched = clubs.Count;
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Fetched {clubs.Count} clubs. Loading local lookups...");

            await using var dbConn = CreateConnection();
            await dbConn.OpenAsync(ct);

            var districts = (await dbConn.QueryAsync<(int pk_id, string districtNumber)>(
                "SELECT pk_district_id AS pk_id, DistrictNumber AS districtNumber FROM district_master WHERE isdeleted = 0"))
                // After --world-ensure, district_master can have duplicate DistrictNumber rows
                // (e.g., "2452" exists in USA + Mexico). GroupBy handles the dup by keeping
                // the lowest pk_id — typically the original Indian district when both exist.
                .GroupBy(x => x.districtNumber, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.Min(x => x.pk_id), StringComparer.OrdinalIgnoreCase);
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Loaded {districts.Count} districts");

            var existing = (await dbConn.QueryAsync<(int pk_id, string clubRotaryId, string clubName, int fk_district_id, DateTime? charterDate)>(@"
                SELECT pk_club_id AS pk_id, ClubRotaryId AS clubRotaryId, ClubName AS clubName,
                       fk_district_id, ClubCharterDate AS charterDate
                FROM club_master WHERE isdeleted = 0 AND ClubRotaryId IS NOT NULL AND ClubRotaryId <> ''"))
                .ToDictionary(x => x.clubRotaryId, StringComparer.OrdinalIgnoreCase);
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Loaded {existing.Count} existing clubs by ClubRotaryId");

            int idx = 0;
            var loopStart = DateTime.UtcNow;
            foreach (var club in clubs)
            {
                ct.ThrowIfCancellationRequested();
                idx++;
                try
                {
                    if (!districts.TryGetValue(club.DistrictId?.ToString() ?? "", out var localDistrictId))
                    {
                        // District not in DB → AUTO-CREATE with NO zone (fk_zone_id = 0); SuperAdmin
                        // assigns the zone later. Never bucket into "Other Zones". Skip only
                        // when Rotary.org gave no district number.
                        var distNum = club.DistrictId?.ToString();
                        if (string.IsNullOrWhiteSpace(distNum))
                        {
                            result.SkippedDistrictMissing++;
                            result.Skipped.Add(new SkippedClubRow { ClubRotaryId = club.ClubId.ToString(), ClubName = club.ClubName ?? "", RotaryOrgDistrictId = club.DistrictId ?? 0, Reason = "Club has no DistrictId from Rotary.org" });
                            continue;
                        }
                        localDistrictId = await dbConn.ExecuteScalarAsync<int>(@"
                            INSERT INTO district_master (DistrictNumber, fk_zone_id, IsActive, created_date, isdeleted)
                            VALUES (@DistrictNumber, NULL, 1, NOW(), 0);   -- no zone yet (NULL, not 0 — FK fk_district_zone has no zone 0); SuperAdmin assigns later
                            SELECT LAST_INSERT_ID();",
                            new { DistrictNumber = distNum });
                        districts[distNum] = localDistrictId;
                    }

                    var detail = await _api.GetClubDetailAsync(club.ClubType ?? "Rotary Club", club.ClubId, ct);
                    if (detail == null)
                    {
                        result.ErrorCount++;
                        continue;
                    }

                    // ONLY "Meeting Location" per user 2026-07-10 — no fallback.
                    // If Rotary.org doesn't send one, addr = null and we skip
                    // the MeetingAddress / MeetingDay update below (COALESCE in
                    // the UPDATE keeps whatever's already in the DB).
                    var addr = detail.Addresses?.FirstOrDefault(a => string.Equals(a.AddressType, "Meeting Location", StringComparison.OrdinalIgnoreCase));

                    var meetingAddress = BuildMeetingAddress(addr);
                    var meetingFromTime = ParseTime(addr?.MeetingTime);
                    var clubRotaryIdStr = club.ClubId.ToString();

                    if (existing.TryGetValue(clubRotaryIdStr, out var existingRow))
                    {
                        await dbConn.ExecuteAsync(@"
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
                                MeetingFromTime = COALESCE(@MeetingFromTime, MeetingFromTime),
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
                        var activeFrom = detail.CharterDate;
                        var activeTo = detail.CharterDate?.AddYears(70);
                        await dbConn.ExecuteAsync(@"
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
                                @DistrictPk, @ClubRotaryId, @ClubName, 'Asia/Kolkata',
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
                        // Auto-assign default modules for the newly-inserted club
                        await ClubModuleHelper.AssignDefaultClubModulesAsync(dbConn);
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

                    // Console progress every 25 clubs
                    if (idx % 25 == 0)
                    {
                        var elapsed = DateTime.UtcNow - loopStart;
                        var ratePerSec = idx / Math.Max(1, elapsed.TotalSeconds);
                        var remaining = clubs.Count - idx;
                        var etaMin = ratePerSec > 0 ? (remaining / ratePerSec) / 60.0 : 0;
                        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] {idx,5}/{clubs.Count} — ins={result.InsertedCount} upd={result.UpdatedCount} skip={result.SkippedDistrictMissing} err={result.ErrorCount}  rate={ratePerSec:F1}/s  ETA {etaMin:F1} min");
                    }

                    // DB log progress every 100
                    if (idx % 100 == 0)
                    {
                        await dbConn.ExecuteAsync(@"
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
                    }

                    await Task.Delay(100, ct);
                }
                catch (OperationCanceledException) { throw; }
                catch (Exception ex)
                {
                    result.ErrorCount++;
                    _logger.LogError(ex, "Error on ClubId={ClubId}", club.ClubId);
                }
            }

            // Mark disappeared clubs
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Loop done. Checking for disappeared clubs...");
            var riOrgIds = clubs.Select(c => c.ClubId.ToString()).ToHashSet(StringComparer.OrdinalIgnoreCase);
            foreach (var (existingId, existingInfo) in existing)
            {
                if (riOrgIds.Contains(existingId)) continue;
                var wasSynced = await dbConn.ExecuteScalarAsync<int>(@"
                    SELECT IFNULL(IsSyncedFromRotaryOrg, 0) FROM club_master WHERE pk_club_id = @Id",
                    new { Id = existingInfo.pk_id });
                if (wasSynced == 1)
                {
                    await dbConn.ExecuteAsync(@"
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

            // ─── DB-verified counts (source of truth) ───
            // Compare in-memory counters with what the database actually shows. The DB is
            // authoritative — if a row was written, it's in the DB regardless of whether the
            // in-memory increment ran (e.g. race conditions, exceptions after commit).
            var dbInserted = await dbConn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM club_master
                WHERE IsSyncedFromRotaryOrg = 1
                  AND created_date >= @StartedAt
                  AND isdeleted = 0",
                new { StartedAt = startedAtLocal });
            var dbUpdated = await dbConn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM club_master
                WHERE IsSyncedFromRotaryOrg = 1
                  AND created_date < @StartedAt
                  AND LastSyncedFromRotaryOrg >= @StartedAt
                  AND isdeleted = 0",
                new { StartedAt = startedAtLocal });

            if (dbInserted != result.InsertedCount || dbUpdated != result.UpdatedCount)
            {
                Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] ⚠ Count mismatch — using DB-verified counts");
                Console.WriteLine($"      In-memory: ins={result.InsertedCount} upd={result.UpdatedCount}");
                Console.WriteLine($"      DB-verified: ins={dbInserted} upd={dbUpdated}");
                _logger.LogWarning("Count mismatch corrected from DB: in-memory ins={Mi}/upd={Mu} → DB ins={Di}/upd={Du}",
                    result.InsertedCount, result.UpdatedCount, dbInserted, dbUpdated);

                // Re-populate Inserted/Updated detail lists from DB so the Excel report is also accurate
                var dbInsertedRows = (await dbConn.QueryAsync<(string ClubRotaryId, string ClubName, string DistrictNumber, DateTime? CharterDate, string MeetingDay)>(@"
                    SELECT cm.ClubRotaryId, cm.ClubName, IFNULL(d.DistrictNumber, '') AS DistrictNumber,
                           cm.ClubCharterDate AS CharterDate, IFNULL(cm.MeetingDay, '') AS MeetingDay
                    FROM club_master cm
                    LEFT JOIN district_master d ON d.pk_district_id = cm.fk_district_id
                    WHERE cm.IsSyncedFromRotaryOrg = 1 AND cm.created_date >= @StartedAt AND cm.isdeleted = 0
                    ORDER BY cm.ClubName",
                    new { StartedAt = startedAtLocal })).ToList();
                var dbUpdatedRows = (await dbConn.QueryAsync<(string ClubRotaryId, string ClubName, string DistrictNumber, DateTime? CharterDate, string MeetingDay)>(@"
                    SELECT cm.ClubRotaryId, cm.ClubName, IFNULL(d.DistrictNumber, '') AS DistrictNumber,
                           cm.ClubCharterDate AS CharterDate, IFNULL(cm.MeetingDay, '') AS MeetingDay
                    FROM club_master cm
                    LEFT JOIN district_master d ON d.pk_district_id = cm.fk_district_id
                    WHERE cm.IsSyncedFromRotaryOrg = 1 AND cm.created_date < @StartedAt
                      AND cm.LastSyncedFromRotaryOrg >= @StartedAt AND cm.isdeleted = 0
                    ORDER BY cm.ClubName",
                    new { StartedAt = startedAtLocal })).ToList();

                result.InsertedCount = dbInserted;
                result.UpdatedCount = dbUpdated;
                result.Inserted.Clear();
                foreach (var r in dbInsertedRows)
                    result.Inserted.Add(new ClubChangeRow
                    {
                        ClubRotaryId = r.ClubRotaryId ?? "",
                        ClubName = r.ClubName ?? "",
                        DistrictNumber = r.DistrictNumber ?? "",
                        CharterDate = r.CharterDate,
                        MeetingDay = r.MeetingDay ?? "",
                    });
                result.Updated.Clear();
                foreach (var r in dbUpdatedRows)
                    result.Updated.Add(new ClubChangeRow
                    {
                        ClubRotaryId = r.ClubRotaryId ?? "",
                        ClubName = r.ClubName ?? "",
                        DistrictNumber = r.DistrictNumber ?? "",
                        CharterDate = r.CharterDate,
                        MeetingDay = r.MeetingDay ?? "",
                    });
            }
            else
            {
                Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] ✓ Counts verified against DB (ins={dbInserted} upd={dbUpdated})");
            }

            // Finalize log (uses verified counts)
            await dbConn.ExecuteAsync(@"
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

            var totalElapsed = DateTime.UtcNow - startedAt;
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === DONE in {totalElapsed.TotalMinutes:F1} min ===");
            Console.WriteLine($"  Total fetched: {result.TotalFetched}");
            Console.WriteLine($"  Inserted:      {result.InsertedCount}");
            Console.WriteLine($"  Updated:       {result.UpdatedCount}");
            Console.WriteLine($"  Disabled:      {result.DisabledCount}");
            Console.WriteLine($"  Skipped (no district): {result.SkippedDistrictMissing}");
            Console.WriteLine($"  Errors:        {result.ErrorCount}");

            // Email report
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Sending email report...");
            await SendEmailReportAsync(result);
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Email sent.");
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[{DateTime.Now:HH:mm:ss}] FAILED: {ex.Message}");
            _logger.LogError(ex, "Bootstrap FAILED");
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

    /// <summary>
    /// Repair mode — finds sync clubs in /clubs that are missing from our DB
    /// (e.g., previously skipped due to missing district during bootstrap) and inserts them
    /// now that more districts may have been added. Idempotent: doesn't touch existing clubs.
    /// </summary>
    /// Total clubs returned by the last /clubs fetch in RunRepairSyncAsync — used by
    /// --club-reconcile to verify the final ROW synced count matches Rotary.org.
    public int LastClubsTotal { get; private set; }

    /// <summary>
    /// Full-list reconcile against /clubs (NOT the /clubs/updates change feed): inserts clubs
    /// missing from the DB and flips mis-marked clubs from non-sync → sync.
    /// Returns the ClubRotaryIds it actually touched (flipped + inserted) so the caller can
    /// sync those clubs' members — see --club-reconcile. Returns an empty list when nothing
    /// needed repairing.
    /// </summary>
    public async Task<List<int>> RunRepairSyncAsync(CancellationToken ct = default)
    {
        var affected = new List<int>();   // ClubRotaryIds flipped to sync or newly inserted
        var startedAt = DateTime.UtcNow;
        var startedAtLocal = DateTime.Now;
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === Repair Sync START ===");

        // Insert log row
        int logId;
        await using (var conn0 = CreateConnection())
        {
            await conn0.OpenAsync(ct);
            var triggeredBy = int.Parse(_config["RotaryOrgSync:TriggeredByMemberId"] ?? "0");
            logId = await conn0.ExecuteScalarAsync<int>(@"
                INSERT INTO rotary_org_sync_log (SyncType, StartedAtUtc, Status, TriggeredBy)
                VALUES ('RepairSync', UTC_TIMESTAMP(), 'Running', @By);
                SELECT LAST_INSERT_ID();",
                new { By = triggeredBy });
        }
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Log row created — logId={logId}");

        var result = new SyncResult { LogId = logId, SyncType = "Repair Sync" };
        try
        {
            // Fetch /clubs
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Fetching /clubs...");
            var allSyncClubs = await _api.GetClubsAsync(ct);
            result.TotalFetched = allSyncClubs.Count;
            LastClubsTotal = allSyncClubs.Count;   // read by --club-reconcile for its final count check
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] /clubs returned {allSyncClubs.Count} clubs");

            await using var dbConn = CreateConnection();
            await dbConn.OpenAsync(ct);

            // Load lookups
            var districts = (await dbConn.QueryAsync<(int pk_id, string districtNumber)>(
                "SELECT pk_district_id AS pk_id, DistrictNumber AS districtNumber FROM district_master WHERE isdeleted = 0"))
                // After --world-ensure, district_master can have duplicate DistrictNumber rows
                // (e.g., "2452" exists in USA + Mexico). GroupBy handles the dup by keeping
                // the lowest pk_id — typically the original Indian district when both exist.
                .GroupBy(x => x.districtNumber, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.Min(x => x.pk_id), StringComparer.OrdinalIgnoreCase);

            // Load existing clubs (active OR soft-deleted, by ClubRotaryId) — includes the IsSyncedFromRotaryOrg flag
            var existing = (await dbConn.QueryAsync<(int pk_id, string clubRotaryId, int isdeleted, int isSynced)>(@"
                SELECT pk_club_id AS pk_id, ClubRotaryId AS clubRotaryId, isdeleted,
                       IFNULL(IsSyncedFromRotaryOrg, 0) AS isSynced
                FROM club_master
                WHERE ClubRotaryId IS NOT NULL AND ClubRotaryId <> ''"))
                .ToDictionary(x => x.clubRotaryId, StringComparer.OrdinalIgnoreCase);

            // Find:
            //  - missing: not in DB at all → INSERT
            //  - misMarked: in DB but IsSyncedFromRotaryOrg = 0 → UPDATE to mark as sync (these were
            //    inserted as non-sync by country sync before the district was added)
            var missing = allSyncClubs
                .Where(c => !existing.ContainsKey(c.ClubId.ToString()))
                .ToList();
            var misMarked = allSyncClubs
                .Where(c => existing.TryGetValue(c.ClubId.ToString(), out var info) && info.isSynced == 0 && info.isdeleted == 0)
                .ToList();
            // REAPPEARED: club is back on /clubs but sits soft-deleted in DB (it was terminated
            // earlier, now Rotary.org lists it again). It's in `existing` (so not "missing" → no
            // insert) and isdeleted=1 (so not "misMarked" → no flip) — without this it would stay
            // dead forever. Reactivate the club row + flags, then re-sync its members.
            var reappeared = allSyncClubs
                .Where(c => existing.TryGetValue(c.ClubId.ToString(), out var info) && info.isdeleted == 1)
                .ToList();

            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Missing from DB:     {missing.Count} sync clubs");
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Marked as non-sync:  {misMarked.Count} (will flip to sync)");
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Reappeared (deleted): {reappeared.Count} (will REACTIVATE)");

            if (missing.Count == 0 && misMarked.Count == 0 && reappeared.Count == 0)
            {
                Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Nothing to repair. All sync clubs already in DB and correctly flagged.");
                await dbConn.ExecuteAsync(@"
                    UPDATE rotary_org_sync_log
                    SET FinishedAtUtc = UTC_TIMESTAMP(), Status = 'Completed', TotalFetched = @Total
                    WHERE pk_id = @Id",
                    new { Id = logId, Total = allSyncClubs.Count });
                return affected;
            }

            // Step A0 — REACTIVATE reappeared clubs (un-delete + flag sync). Members are re-synced
            // afterwards via the `affected` list (--club-reconcile runs the member sweep on them).
            // BOD / committees repopulate on their own next syncs. We deliberately do NOT blanket
            // un-delete the old cascade rows — the member sweep rebuilds the current roster instead,
            // so stale post-termination data isn't resurrected.
            int reactivatedCount = 0;
            foreach (var c in reappeared)
            {
                ct.ThrowIfCancellationRequested();
                try
                {
                    var info = existing[c.ClubId.ToString()];
                    await dbConn.ExecuteAsync(@"
                        UPDATE club_master
                        SET isdeleted = 0, IsActive = 1,
                            IsSyncedFromRotaryOrg = 1, ROW_as_vendor_selected = 1,
                            LastSyncedFromRotaryOrg = NOW(), modified_date = NOW()
                        WHERE pk_club_id = @Id",
                        new { Id = info.pk_id });
                    reactivatedCount++;
                    affected.Add(c.ClubId);   // re-sync its members
                }
                catch (Exception ex)
                {
                    result.ErrorCount++;
                    _logger.LogError(ex, "Error reactivating reappeared club {ClubId}", c.ClubId);
                }
            }
            if (reactivatedCount > 0)
                Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Reactivated {reactivatedCount} reappeared club(s)");

            // Step A — flip mis-marked clubs from non-sync to sync (they exist in DB, just wrongly flagged)
            int flippedCount = 0;
            foreach (var c in misMarked)
            {
                ct.ThrowIfCancellationRequested();
                try
                {
                    var info = existing[c.ClubId.ToString()];
                    await dbConn.ExecuteAsync(@"
                        UPDATE club_master
                        SET IsSyncedFromRotaryOrg = 1,
                            LastSyncedFromRotaryOrg = NOW(),
                            ROW_as_vendor_selected = 1,
                            modified_date = NOW()
                        WHERE pk_club_id = @Id",
                        new { Id = info.pk_id });
                    flippedCount++;
                    affected.Add(c.ClubId);   // members must follow the flag — see --club-reconcile
                    if (flippedCount % 25 == 0)
                        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Flipped {flippedCount}/{misMarked.Count} clubs to sync");
                }
                catch (Exception ex)
                {
                    result.ErrorCount++;
                    _logger.LogError(ex, "Error flipping club {ClubId} to sync", c.ClubId);
                }
            }
            result.UpdatedCount = flippedCount;
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Flipped total: {flippedCount} clubs from non-sync to sync");

            int idx = 0;
            foreach (var club in missing)
            {
                ct.ThrowIfCancellationRequested();
                idx++;
                try
                {
                    if (!districts.TryGetValue(club.DistrictId?.ToString() ?? "", out var localDistrictId))
                    {
                        // District not in DB → AUTO-CREATE it with NO zone (fk_zone_id = 0). A SuperAdmin
                        // assigns the zone later (Global Search → edit district). We never bucket it into
                        // "Other Zones". Only skip if the club has no DistrictId from Rotary.org.
                        var distNum = club.DistrictId?.ToString();
                        if (string.IsNullOrWhiteSpace(distNum))
                        {
                            result.SkippedDistrictMissing++;
                            result.Skipped.Add(new SkippedClubRow { ClubRotaryId = club.ClubId.ToString(), ClubName = club.ClubName ?? "", RotaryOrgDistrictId = club.DistrictId ?? 0, Reason = "Club has no DistrictId from Rotary.org" });
                            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] {idx,3}/{missing.Count} skip — no district number");
                            continue;
                        }
                        localDistrictId = await dbConn.ExecuteScalarAsync<int>(@"
                            INSERT INTO district_master (DistrictNumber, fk_zone_id, IsActive, created_date, isdeleted)
                            VALUES (@DistrictNumber, NULL, 1, NOW(), 0);   -- no zone yet (NULL, not 0 — FK fk_district_zone has no zone 0); SuperAdmin assigns later
                            SELECT LAST_INSERT_ID();",
                            new { DistrictNumber = distNum });
                        districts[distNum] = localDistrictId;
                        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] {idx,3}/{missing.Count} + created district D{distNum} (no zone) id={localDistrictId}");
                    }

                    var detail = await _api.GetClubDetailAsync(club.ClubType ?? "Rotary Club", club.ClubId, ct);
                    if (detail == null)
                    {
                        result.ErrorCount++;
                        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] {idx,3}/{missing.Count} 404 detail for ClubId={club.ClubId}");
                        continue;
                    }

                    // ONLY "Meeting Location" per user 2026-07-10 — no fallback.
                    // If Rotary.org doesn't send one, addr = null and we skip
                    // the MeetingAddress / MeetingDay update below (COALESCE in
                    // the UPDATE keeps whatever's already in the DB).
                    var addr = detail.Addresses?.FirstOrDefault(a => string.Equals(a.AddressType, "Meeting Location", StringComparison.OrdinalIgnoreCase));

                    var meetingAddress = BuildMeetingAddress(addr);
                    var meetingFromTime = ParseTime(addr?.MeetingTime);
                    var clubRotaryIdStr = club.ClubId.ToString();
                    var activeFrom = detail.CharterDate;
                    var activeTo = detail.CharterDate?.AddYears(70);

                    await dbConn.ExecuteAsync(@"
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
                            @DistrictPk, @ClubRotaryId, @ClubName, 'Asia/Kolkata',
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
                            DistrictPk = localDistrictId,
                            ClubRotaryId = clubRotaryIdStr,
                            ClubName = (detail.ClubName ?? club.ClubName ?? "").Length > 200 ? (detail.ClubName ?? club.ClubName ?? "").Substring(0, 200) : (detail.ClubName ?? club.ClubName),
                            CharterDate = detail.CharterDate,
                            MeetingDay = NormalizeMeetingDay(addr?.MeetingDay),
                            MeetingFromTime = meetingFromTime,
                            MeetingAddress = (meetingAddress ?? "").Length > 500 ? meetingAddress!.Substring(0, 500) : meetingAddress,
                            Country = (addr?.Country ?? "").Length > 50 ? (addr?.Country ?? "").Substring(0, 50) : addr?.Country,
                            State = IndianStateResolver.NormalizeForCountry(
                                        (addr?.State ?? "").Length > 50 ? (addr?.State ?? "").Substring(0, 50) : addr?.State,
                                        addr?.Country),
                            City = (addr?.City ?? "").Length > 100 ? (addr?.City ?? "").Substring(0, 100) : addr?.City,
                            PinCode = (addr?.PostalCode ?? "").Length > 10 ? (addr?.PostalCode ?? "").Substring(0, 10) : addr?.PostalCode,
                            ActiveFrom = activeFrom,
                            ActiveTo = activeTo,
                        });
                    // Auto-assign default modules for the newly-inserted club
                    await ClubModuleHelper.AssignDefaultClubModulesAsync(dbConn);
                    result.InsertedCount++;
                    affected.Add(club.ClubId);   // new club → its members must be pulled too
                    result.Inserted.Add(new ClubChangeRow
                    {
                        ClubRotaryId = clubRotaryIdStr,
                        ClubName = detail.ClubName ?? "",
                        DistrictNumber = club.DistrictId?.ToString() ?? "",
                        CharterDate = detail.CharterDate,
                        MeetingDay = addr?.MeetingDay ?? "",
                    });
                    Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] {idx,3}/{missing.Count} inserted: {detail.ClubName} (D{club.DistrictId})");

                    await Task.Delay(100, ct);
                }
                catch (OperationCanceledException) { throw; }
                catch (Exception ex)
                {
                    result.ErrorCount++;
                    _logger.LogError(ex, "Error on ClubId={ClubId}", club.ClubId);
                    Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] {idx,3}/{missing.Count} ERROR: {ex.Message}");
                }
            }

            // Finalize log
            await dbConn.ExecuteAsync(@"
                UPDATE rotary_org_sync_log
                SET FinishedAtUtc = UTC_TIMESTAMP(), Status = 'Completed',
                    TotalFetched = @Total, InsertedCount = @Ins, UpdatedCount = @Upd,
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

            var totalElapsed = DateTime.UtcNow - startedAt;
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === Repair DONE in {totalElapsed.TotalMinutes:F1} min ===");
            Console.WriteLine($"  Total in /clubs:       {result.TotalFetched}");
            Console.WriteLine($"  Missing from DB:       {missing.Count}");
            Console.WriteLine($"  Inserted (new):        {result.InsertedCount}");
            Console.WriteLine($"  Flipped to sync:       {result.UpdatedCount}");
            Console.WriteLine($"  Skipped (no district): {result.SkippedDistrictMissing}");
            Console.WriteLine($"  Errors:                {result.ErrorCount}");

            // ── Count reconciliation: ROW synced clubs MUST equal Rotary.org /clubs total ──
            var syncedNow = await dbConn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM club_master WHERE IFNULL(IsSyncedFromRotaryOrg,0) = 1 AND isdeleted = 0");
            Console.WriteLine("");
            Console.WriteLine($"  Rotary.org /clubs total: {result.TotalFetched}");
            Console.WriteLine($"  Synced in ROW now:   {syncedNow}");
            if (syncedNow == result.TotalFetched)
            {
                Console.WriteLine("  ==> COUNT MATCHES.");
            }
            else if (syncedNow > result.TotalFetched)
            {
                Console.WriteLine($"  ==> {syncedNow - result.TotalFetched} EXTRA marked sync here but NOT in /clubs anymore.");
                Console.WriteLine("      This mode never flips sync->non-sync (no deletes). Review them with:");
                Console.WriteLine("        RotaryOrgSyncWorker.exe --non-sync-cascade          (audit only)");
                Console.WriteLine("        RotaryOrgSyncWorker.exe --non-sync-cascade --apply  (flip + soft-delete members)");
            }
            else
            {
                Console.WriteLine($"  ==> {result.TotalFetched - syncedNow} SHORT of /clubs.");
                Console.WriteLine($"      Skipped for missing district: {result.SkippedDistrictMissing} (add those districts, then re-run)");
                Console.WriteLine($"      Errors this run:              {result.ErrorCount}");
            }

            await SendEmailReportAsync(result);
            return affected;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[{DateTime.Now:HH:mm:ss}] REPAIR FAILED: {ex.Message}");
            try
            {
                await using var conn = CreateConnection();
                await conn.OpenAsync(CancellationToken.None);
                await conn.ExecuteAsync(@"
                    UPDATE rotary_org_sync_log
                    SET FinishedAtUtc = UTC_TIMESTAMP(), Status = 'Failed', ErrorDetail = @Err
                    WHERE pk_id = @Id",
                    new { Id = logId, Err = ex.Message });
            }
            catch { }
            throw;
        }
    }

    /// <summary>
    /// Daily delta sync. Calls /clubs/updates for the window since the last successful sync,
    /// processes only the changed clubs, and sends an email summary. Designed to run nightly
    /// via Windows Task Scheduler.
    /// </summary>
    public async Task RunDeltaAsync(CancellationToken ct = default)
    {
        var startedAt = DateTime.UtcNow;
        var startedAtLocal = DateTime.Now;
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === Delta START ===");

        // Determine date range: from last successful sync (or 24h ago if first run)
        DateTime windowStart;
        await using (var conn0 = CreateConnection())
        {
            await conn0.OpenAsync(ct);
            var lastSync = await conn0.ExecuteScalarAsync<DateTime?>(@"
                SELECT MAX(StartedAtUtc) FROM rotary_org_sync_log
                WHERE Status = 'Completed' AND isdeleted = 0");
            windowStart = lastSync.HasValue
                ? lastSync.Value.AddHours(-2)  // 2-hour overlap for safety
                : DateTime.UtcNow.AddDays(-1);
        }
        var windowEnd = DateTime.UtcNow;
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Delta window: {windowStart:yyyy-MM-dd HH:mm} UTC → {windowEnd:yyyy-MM-dd HH:mm} UTC");

        // Insert log row
        int logId;
        await using (var conn = CreateConnection())
        {
            await conn.OpenAsync(ct);
            var triggeredBy = int.Parse(_config["RotaryOrgSync:TriggeredByMemberId"] ?? "0");
            logId = await conn.ExecuteScalarAsync<int>(@"
                INSERT INTO rotary_org_sync_log (SyncType, StartedAtUtc, Status, TriggeredBy)
                VALUES ('Delta', UTC_TIMESTAMP(), 'Running', @By);
                SELECT LAST_INSERT_ID();",
                new { By = triggeredBy });
        }
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Log row created — logId={logId}");

        var result = new SyncResult { LogId = logId };
        try
        {
            // Fetch only changed clubs in the window
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Fetching club updates from Rotary.org...");
            var clubs = await _api.GetClubUpdatesAsync(windowStart, windowEnd, ct);
            result.TotalFetched = clubs.Count;
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] {clubs.Count} club(s) changed in window.");

            if (clubs.Count == 0)
            {
                // Mark Completed with all zeros, send a "no changes" email
                await using var conn1 = CreateConnection();
                await conn1.OpenAsync(ct);
                await conn1.ExecuteAsync(@"
                    UPDATE rotary_org_sync_log
                    SET FinishedAtUtc = UTC_TIMESTAMP(), Status = 'Completed', TotalFetched = 0
                    WHERE pk_id = @Id",
                    new { Id = logId });
                Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] No changes — sending no-op email");
                await SendDeltaEmailReportAsync(result, windowStart, windowEnd);
                return;
            }

            await using var dbConn = CreateConnection();
            await dbConn.OpenAsync(ct);

            var districts = (await dbConn.QueryAsync<(int pk_id, string districtNumber)>(
                "SELECT pk_district_id AS pk_id, DistrictNumber AS districtNumber FROM district_master WHERE isdeleted = 0"))
                // After --world-ensure, district_master can have duplicate DistrictNumber rows
                // (e.g., "2452" exists in USA + Mexico). GroupBy handles the dup by keeping
                // the lowest pk_id — typically the original Indian district when both exist.
                .GroupBy(x => x.districtNumber, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.Min(x => x.pk_id), StringComparer.OrdinalIgnoreCase);

            var existing = (await dbConn.QueryAsync<(int pk_id, string clubRotaryId, string clubName, int fk_district_id, DateTime? charterDate, int isSynced)>(@"
                SELECT pk_club_id AS pk_id, ClubRotaryId AS clubRotaryId, ClubName AS clubName,
                       fk_district_id, ClubCharterDate AS charterDate,
                       IFNULL(IsSyncedFromRotaryOrg, 0) AS isSynced
                FROM club_master WHERE isdeleted = 0 AND ClubRotaryId IS NOT NULL AND ClubRotaryId <> ''"))
                .ToDictionary(x => x.clubRotaryId, StringComparer.OrdinalIgnoreCase);

            // Clubs that BECAME sync this run (newly inserted, or flipped non-sync→sync).
            // Each needs a FULL member match afterwards (RotaryId-keyed add/update/terminate,
            // no admission-date filter) so it doesn't land at 0 members.
            var clubsNeedingMemberMatch = new List<int>();

            int idx = 0;
            foreach (var club in clubs)
            {
                ct.ThrowIfCancellationRequested();
                idx++;
                try
                {
                    if (!districts.TryGetValue(club.DistrictId?.ToString() ?? "", out var localDistrictId))
                    {
                        // District not in DB → AUTO-CREATE with NO zone (fk_zone_id = 0); SuperAdmin
                        // assigns the zone later. Never bucket into "Other Zones". Skip only
                        // when Rotary.org gave no district number.
                        var distNum = club.DistrictId?.ToString();
                        if (string.IsNullOrWhiteSpace(distNum))
                        {
                            result.SkippedDistrictMissing++;
                            result.Skipped.Add(new SkippedClubRow { ClubRotaryId = club.ClubId.ToString(), ClubName = club.ClubName ?? "", RotaryOrgDistrictId = club.DistrictId ?? 0, Reason = "Club has no DistrictId from Rotary.org" });
                            continue;
                        }
                        localDistrictId = await dbConn.ExecuteScalarAsync<int>(@"
                            INSERT INTO district_master (DistrictNumber, fk_zone_id, IsActive, created_date, isdeleted)
                            VALUES (@DistrictNumber, NULL, 1, NOW(), 0);   -- no zone yet (NULL, not 0 — FK fk_district_zone has no zone 0); SuperAdmin assigns later
                            SELECT LAST_INSERT_ID();",
                            new { DistrictNumber = distNum });
                        districts[distNum] = localDistrictId;
                    }

                    var detail = await _api.GetClubDetailAsync(club.ClubType ?? "Rotary Club", club.ClubId, ct);
                    if (detail == null)
                    {
                        result.ErrorCount++;
                        continue;
                    }

                    // ONLY "Meeting Location" per user 2026-07-10 — no fallback.
                    // If Rotary.org doesn't send one, addr = null and we skip
                    // the MeetingAddress / MeetingDay update below (COALESCE in
                    // the UPDATE keeps whatever's already in the DB).
                    var addr = detail.Addresses?.FirstOrDefault(a => string.Equals(a.AddressType, "Meeting Location", StringComparison.OrdinalIgnoreCase));

                    var meetingAddress = BuildMeetingAddress(addr);
                    var meetingFromTime = ParseTime(addr?.MeetingTime);
                    var clubRotaryIdStr = club.ClubId.ToString();

                    if (existing.TryGetValue(clubRotaryIdStr, out var existingRow))
                    {
                        await dbConn.ExecuteAsync(@"
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
                                MeetingFromTime = COALESCE(@MeetingFromTime, MeetingFromTime),
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

                        // Was non-sync before this UPDATE flipped it to sync → needs a full member match.
                        if (existingRow.isSynced == 0 && int.TryParse(clubRotaryIdStr, out var flippedRid))
                            clubsNeedingMemberMatch.Add(flippedRid);
                    }
                    else
                    {
                        var activeFrom = detail.CharterDate;
                        var activeTo = detail.CharterDate?.AddYears(70);
                        await dbConn.ExecuteAsync(@"
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
                                @DistrictPk, @ClubRotaryId, @ClubName, 'Asia/Kolkata',
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
                        // Auto-assign default modules for the newly-inserted club
                        await ClubModuleHelper.AssignDefaultClubModulesAsync(dbConn);
                        result.InsertedCount++;
                        result.Inserted.Add(new ClubChangeRow
                        {
                            ClubRotaryId = clubRotaryIdStr,
                            ClubName = detail.ClubName ?? "",
                            DistrictNumber = club.DistrictId?.ToString() ?? "",
                            CharterDate = detail.CharterDate,
                            MeetingDay = addr?.MeetingDay ?? "",
                        });

                        // Brand-new synced club → needs a full member match.
                        if (int.TryParse(clubRotaryIdStr, out var newRid))
                            clubsNeedingMemberMatch.Add(newRid);
                    }

                    Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] {idx,3}/{clubs.Count} — ins={result.InsertedCount} upd={result.UpdatedCount} skip={result.SkippedDistrictMissing} err={result.ErrorCount}");

                    await Task.Delay(100, ct);
                }
                catch (OperationCanceledException) { throw; }
                catch (Exception ex)
                {
                    result.ErrorCount++;
                    _logger.LogError(ex, "Error on ClubId={ClubId}", club.ClubId);
                }
            }

            // DB-verified counts (same belt-and-suspenders as bootstrap)
            var dbInserted = await dbConn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM club_master
                WHERE IsSyncedFromRotaryOrg = 1
                  AND created_date >= @StartedAt
                  AND isdeleted = 0",
                new { StartedAt = startedAtLocal });
            var dbUpdated = await dbConn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM club_master
                WHERE IsSyncedFromRotaryOrg = 1
                  AND created_date < @StartedAt
                  AND LastSyncedFromRotaryOrg >= @StartedAt
                  AND isdeleted = 0",
                new { StartedAt = startedAtLocal });

            if (dbInserted != result.InsertedCount || dbUpdated != result.UpdatedCount)
            {
                Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] ⚠ Count mismatch — using DB-verified counts");
                _logger.LogWarning("Delta count mismatch: in-memory ins={Mi}/upd={Mu} → DB ins={Di}/upd={Du}",
                    result.InsertedCount, result.UpdatedCount, dbInserted, dbUpdated);
                result.InsertedCount = dbInserted;
                result.UpdatedCount = dbUpdated;
            }

            await dbConn.ExecuteAsync(@"
                UPDATE rotary_org_sync_log
                SET FinishedAtUtc = UTC_TIMESTAMP(), Status = 'Completed',
                    TotalFetched = @Total, InsertedCount = @Ins, UpdatedCount = @Upd,
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

            var totalElapsed = DateTime.UtcNow - startedAt;
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === Delta DONE in {totalElapsed.TotalMinutes:F1} min ===");
            Console.WriteLine($"  Total changed: {result.TotalFetched}");
            Console.WriteLine($"  Inserted:      {result.InsertedCount}");
            Console.WriteLine($"  Updated:       {result.UpdatedCount}");
            Console.WriteLine($"  Skipped:       {result.SkippedDistrictMissing}");
            Console.WriteLine($"  Errors:        {result.ErrorCount}");

            await SendDeltaEmailReportAsync(result, windowStart, windowEnd);

            // ── Auto member-match for clubs that BECAME sync in this run ──
            // Full RotaryId-keyed reconcile (add / update / terminate), NO admission-date
            // filter — so a newly-synced or brand-new club is populated with ALL its
            // members immediately instead of showing 0. Wrapped in its own try so a
            // member-side failure never fails the (already-committed) club sync.
            if (clubsNeedingMemberMatch.Count > 0)
            {
                var uniqueMatch = clubsNeedingMemberMatch.Distinct().ToList();
                Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Auto member-match: {uniqueMatch.Count} newly-synced/new club(s)…");
                try
                {
                    await _memberSweep.RunForClubRotaryIdsAsync(uniqueMatch, ct);
                }
                catch (Exception ex2)
                {
                    _logger.LogError(ex2, "Auto member-match after delta failed for {Count} club(s)", uniqueMatch.Count);
                    Console.Error.WriteLine($"[{DateTime.Now:HH:mm:ss}] Auto member-match FAILED: {ex2.Message} (club sync itself succeeded)");
                }
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[{DateTime.Now:HH:mm:ss}] DELTA FAILED: {ex.Message}");
            _logger.LogError(ex, "Delta sync FAILED");
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

    private async Task SendDeltaEmailReportAsync(SyncResult r, DateTime windowStart, DateTime windowEnd)
    {
        try
        {
            using var workbook = new XLWorkbook();
            var summary = workbook.Worksheets.Add("Summary");
            summary.Cell(1, 1).Value = "Rotary.org Daily Delta Sync Report";
            summary.Range("A1:B1").Merge().Style.Font.SetBold().Font.SetFontSize(14);
            summary.Cell(3, 1).Value = "Log ID"; summary.Cell(3, 2).Value = r.LogId;
            summary.Cell(4, 1).Value = "Window start (UTC)"; summary.Cell(4, 2).Value = windowStart.ToString("u");
            summary.Cell(5, 1).Value = "Window end (UTC)"; summary.Cell(5, 2).Value = windowEnd.ToString("u");
            summary.Cell(6, 1).Value = "Total clubs changed"; summary.Cell(6, 2).Value = r.TotalFetched;
            summary.Cell(7, 1).Value = "New clubs"; summary.Cell(7, 2).Value = r.InsertedCount;
            summary.Cell(8, 1).Value = "Updated clubs"; summary.Cell(8, 2).Value = r.UpdatedCount;
            summary.Cell(9, 1).Value = "Skipped (district missing)"; summary.Cell(9, 2).Value = r.SkippedDistrictMissing;
            summary.Cell(10, 1).Value = "Errors"; summary.Cell(10, 2).Value = r.ErrorCount;
            summary.Columns().AdjustToContents();

            AddChangesSheet(workbook, "New Clubs", r.Inserted);
            AddChangesSheet(workbook, "Updated Clubs", r.Updated);
            AddSkippedSheet(workbook, "Skipped (no district)", r.Skipped);

            using var ms = new MemoryStream();
            workbook.SaveAs(ms);
            var bytes = ms.ToArray();
            var fileName = $"RotaryOrg_Delta_{DateTime.Now:yyyyMMdd_HHmmss}.xlsx";

            string newClubsBlock = "";
            if (r.Inserted.Count > 0)
            {
                var rows = string.Join("", r.Inserted.Select((c, i) =>
                    $"<tr><td style='padding:2px 8px;color:#64748b;'>{i + 1}.</td>" +
                    $"<td style='padding:2px 8px;'>{System.Net.WebUtility.HtmlEncode(c.ClubName)}</td>" +
                    $"<td style='padding:2px 8px;color:#64748b;'>D{System.Net.WebUtility.HtmlEncode(c.DistrictNumber)}</td>" +
                    $"<td style='padding:2px 8px;color:#64748b;'>RID {System.Net.WebUtility.HtmlEncode(c.ClubRotaryId)}</td></tr>"));
                newClubsBlock = $@"
<h3 style='color:#16a34a;margin-top:20px;'>New clubs added ({r.InsertedCount})</h3>
<table style='border-collapse:collapse;margin:8px 0;font-size:14px;'>{rows}</table>";
            }

            string updatedClubsBlock = "";
            if (r.Updated.Count > 0)
            {
                var rows = string.Join("", r.Updated.Take(50).Select((c, i) =>
                    $"<tr><td style='padding:2px 8px;color:#64748b;'>{i + 1}.</td>" +
                    $"<td style='padding:2px 8px;'>{System.Net.WebUtility.HtmlEncode(c.ClubName)}</td>" +
                    $"<td style='padding:2px 8px;color:#64748b;'>D{System.Net.WebUtility.HtmlEncode(c.DistrictNumber)}</td></tr>"));
                var more = r.Updated.Count > 50
                    ? $"<p style='color:#64748b;font-size:13px;'>… and <b>{r.Updated.Count - 50}</b> more in the attached Excel.</p>"
                    : "";
                updatedClubsBlock = $@"
<h3 style='color:#2563eb;margin-top:20px;'>Updated clubs ({r.UpdatedCount})</h3>
<table style='border-collapse:collapse;margin:8px 0;font-size:14px;'>{rows}</table>{more}";
            }

            var triggeredByName = _config["RotaryOrgSync:TriggeredByName"] ?? "Admin";
            string statusLine = r.TotalFetched == 0
                ? "<p style='color:#16a34a;'>No clubs changed on Rotary.org in this window. All in sync.</p>"
                : $"<p>Found <b>{r.TotalFetched}</b> changed club(s) in this window.</p>";

            var body = $@"<div style='font-family:Arial,sans-serif;'>
<h2 style='color:#1a365d;'>Rotary.org Daily Delta Sync</h2>
<p>Dear {System.Net.WebUtility.HtmlEncode(triggeredByName)},</p>
{statusLine}
<table style='border-collapse:collapse;margin:12px 0;'>
  <tr><td style='padding:4px 12px;'>Window (UTC)</td><td style='padding:4px 12px;'>{windowStart:yyyy-MM-dd HH:mm} → {windowEnd:yyyy-MM-dd HH:mm}</td></tr>
  <tr><td style='padding:4px 12px;'>Clubs changed on Rotary.org</td><td style='padding:4px 12px;'><b>{r.TotalFetched}</b></td></tr>
  <tr><td style='padding:4px 12px;'>New clubs added in ROW</td><td style='padding:4px 12px;color:#16a34a;'><b>{r.InsertedCount}</b></td></tr>
  <tr><td style='padding:4px 12px;'>Updated clubs in ROW</td><td style='padding:4px 12px;color:#2563eb;'><b>{r.UpdatedCount}</b></td></tr>
  <tr><td style='padding:4px 12px;'>Skipped (district missing)</td><td style='padding:4px 12px;color:#64748b;'><b>{r.SkippedDistrictMissing}</b></td></tr>
  <tr><td style='padding:4px 12px;'>Errors</td><td style='padding:4px 12px;color:#dc2626;'><b>{r.ErrorCount}</b></td></tr>
</table>
{newClubsBlock}
{updatedClubsBlock}
<p style='color:#64748b;font-size:13px;'>Sync log id: {r.LogId}.</p>
<p>Regards,<br/><strong>Team ROW</strong></p>
</div>";

            await _emailSender.SendReportAsync($"[Daily] ROW Club Sync — {DateTime.Now:dd MMM yyyy}", body, bytes, fileName);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Delta email FAILED");
            Console.Error.WriteLine($"[{DateTime.Now:HH:mm:ss}] Email failed: {ex.Message}");
        }
    }

    private async Task SendEmailReportAsync(SyncResult r)
    {
        try
        {
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

            var triggeredByName = _config["RotaryOrgSync:TriggeredByName"] ?? "Admin";

            // Inline list of new clubs (cap to keep email size sane). Full list always in Excel.
            const int InlineListLimit = 100;
            string newClubsBlock = "";
            if (r.Inserted.Count > 0)
            {
                var shown = r.Inserted.Take(InlineListLimit).ToList();
                var rows = string.Join("", shown.Select((c, i) =>
                    $"<tr><td style='padding:2px 8px;color:#64748b;'>{i + 1}.</td>" +
                    $"<td style='padding:2px 8px;'>{System.Net.WebUtility.HtmlEncode(c.ClubName)}</td>" +
                    $"<td style='padding:2px 8px;color:#64748b;'>D{System.Net.WebUtility.HtmlEncode(c.DistrictNumber)}</td>" +
                    $"<td style='padding:2px 8px;color:#64748b;'>RID {System.Net.WebUtility.HtmlEncode(c.ClubRotaryId)}</td></tr>"));
                var more = r.Inserted.Count > InlineListLimit
                    ? $"<p style='color:#64748b;font-size:13px;'>… and <b>{r.Inserted.Count - InlineListLimit}</b> more new clubs in the attached Excel.</p>"
                    : "";
                newClubsBlock = $@"
<h3 style='color:#16a34a;margin-top:24px;'>New clubs added ({r.InsertedCount})</h3>
<table style='border-collapse:collapse;margin:8px 0;font-size:14px;'>
{rows}
</table>
{more}";
            }

            var body = $@"<div style='font-family:Arial,sans-serif;'>
<h2 style='color:#1a365d;'>Rotary.org Sync Complete</h2>
<p>Dear {System.Net.WebUtility.HtmlEncode(triggeredByName)},</p>
<p>The Rotary.org bootstrap sync has finished. Summary:</p>
<table style='border-collapse:collapse;margin:12px 0;'>
  <tr><td style='padding:4px 12px;'>Total clubs on Rotary.org</td><td style='padding:4px 12px;'><b>{r.TotalFetched}</b></td></tr>
  <tr><td style='padding:4px 12px;'>New clubs added in ROW</td><td style='padding:4px 12px;color:#16a34a;'><b>{r.InsertedCount}</b></td></tr>
  <tr><td style='padding:4px 12px;'>Updated clubs in ROW</td><td style='padding:4px 12px;color:#2563eb;'><b>{r.UpdatedCount}</b></td></tr>
  <tr><td style='padding:4px 12px;'>Clubs disabled (no longer on Rotary.org)</td><td style='padding:4px 12px;color:#dc2626;'><b>{r.DisabledCount}</b></td></tr>
  <tr><td style='padding:4px 12px;'>Skipped (district missing locally)</td><td style='padding:4px 12px;color:#64748b;'><b>{r.SkippedDistrictMissing}</b></td></tr>
  <tr><td style='padding:4px 12px;'>Errors</td><td style='padding:4px 12px;color:#dc2626;'><b>{r.ErrorCount}</b></td></tr>
</table>
{newClubsBlock}
<p>Full details (including all updated, disabled, and skipped clubs) are in the attached Excel — 5 sheets: Summary, New, Updated, Disabled, Skipped.</p>
<p style='color:#64748b;font-size:13px;'>Sync log id: {r.LogId}. Disabled clubs are NOT deleted.</p>
<p>Regards,<br/><strong>Team ROW</strong></p>
</div>";

            // Subject differentiates bootstrap (one-time setup) vs repair-sync (manual gap-fill).
            var subjectPrefix = string.Equals(r.SyncType, "Repair Sync", StringComparison.OrdinalIgnoreCase)
                ? "[Manual] ROW Repair Sync"
                : "[One-time] ROW Bootstrap";
            await _emailSender.SendReportAsync($"{subjectPrefix} — {DateTime.Now:dd MMM yyyy}", body, bytes, fileName);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Email report FAILED");
            Console.Error.WriteLine($"[{DateTime.Now:HH:mm:ss}] Email failed: {ex.Message}");
        }
    }

    // Prepends the MeetingName (e.g. "Wisdom Chamber") to the address lines so
    // the DB's MeetingAddress field carries the venue name too. Called only
    // when the caller has already selected the "Meeting Location" address.
    private static string? BuildMeetingAddress(RotaryOrgAddressDto? addr)
    {
        if (addr == null) return null;
        var parts = new[] { addr.MeetingName, addr.AddressLine1, addr.AddressLine2, addr.AddressLine3 }
            .Where(p => !string.IsNullOrWhiteSpace(p))
            .Select(p => p!.Trim())
            .ToList();
        return parts.Count == 0 ? null : string.Join(", ", parts);
    }

    // Normalizes any short/abbreviated weekday from Rotary.org ("Thu", "Thurs",
    // "Thursday", any casing) to the full English form "Thursday". Returns
    // null for null/blank so callers can COALESCE and skip the DB write when
    // Rotary.org sends nothing (per user 2026-07-10 rule: don't overwrite the
    // stored value with blank).
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
            _ => trimmed, // unknown form — keep as-is instead of silently dropping
        };
    }

    // Rotary.org sends MeetingTime as "HHMM" (24-hour, no separator, e.g.
    // "1930" for 7:30 PM). The previous version routed everything through
    // TimeSpan/DateTime.TryParse which misread "1930" (parsed as 1930 days
    // or year 1930 in some cultures) and produced garbage times in the DB
    // (e.g. 21:30). Handle HHMM/HMM explicitly BEFORE the fallback parsers.
    // Timezone-neutral — same result on every server culture / country.
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

        TimeSpan? result = null;
        if (TimeSpan.TryParse(trimmed, System.Globalization.CultureInfo.InvariantCulture, out var t)) result = t;
        else if (DateTime.TryParse(trimmed, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var dt)) result = dt.TimeOfDay;
        if (result.HasValue && (result.Value.TotalHours < 0 || result.Value.TotalHours >= 24))
            return null;
        return result;
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

    private class SyncResult
    {
        public int LogId { get; set; }
        public string SyncType { get; set; } = "Bootstrap";   // "Bootstrap" or "Repair Sync"
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
