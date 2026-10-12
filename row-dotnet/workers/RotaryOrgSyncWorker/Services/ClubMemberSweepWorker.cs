using ClosedXML.Excel;
using Dapper;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using MySqlConnector;

namespace RotaryOrgSyncWorker.Services;

/// <summary>
/// Per-club member sweep. For each synced club (IsSyncedFromRotaryOrg = 1):
///  1. Fetch authoritative member list from Rotary.org via /clubs/{type}/{id}/members.
///  2. Compare with local club_members:
///     - In API but NOT in DB     → ADD: insert/reactivate member_master_profile + insert into club_members + assign Member role.
///     - In both                  → UPDATE profile fields with merge rules (skip blanks, prefer API mobile, IsYouth from age).
///     - In DB but NOT in API     → SOFT-DELETE: remove from this club. If this was the member's only club → fully deactivate profile.
///
/// Email summary at the end: counts + per-club breakdown + Excel sheets (Added / Updated / Terminated / Errors).
/// </summary>
public class ClubMemberSweepWorker
{
    private readonly IRotaryOrgApiClient _api;
    private readonly EmailReportSender _emailSender;
    private readonly IConfiguration _config;
    private readonly ILogger<ClubMemberSweepWorker> _logger;
    private readonly string _connectionString;

    public ClubMemberSweepWorker(
        IRotaryOrgApiClient api,
        EmailReportSender emailSender,
        IConfiguration config,
        ILogger<ClubMemberSweepWorker> logger)
    {
        _api = api;
        _emailSender = emailSender;
        _config = config;
        _logger = logger;
        _connectionString = config.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("ConnectionStrings:DefaultConnection missing");
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    // Daily-delta mode flags. When set, RunAsync restricts club iteration to these RotaryIds and
    // applies an admission-date cutoff for ADDs (skip historical members not joined recently).
    private HashSet<string>? _restrictedClubRotaryIds;
    private DateTime? _admissionDateFilter;
    private bool _isDailyDelta = false;
    private bool _isMismatchReconcile = false;   // morning member-count reconcile (mismatch-only)

    // Failed-list mode flags. When set, RunAsync:
    //   1. Iterates ONLY the clubs that appear as keys in _restrictedClubMemberPairs
    //   2. Within each club, processes ONLY the member RotaryIds in that club's HashSet
    //   3. SKIPS the soft-delete pass entirely (failed list is for retry, not for terminations)
    // Use case: re-sync only members that errored on a previous sweep run, without
    // touching the rest of the 28-district fleet.
    private Dictionary<string, HashSet<string>>? _restrictedClubMemberPairs;
    private bool _isFailedListMode = false;

    // ──────────────────────────────────────────────────────────────────────────────
    // Helpers (added 2026-06-30 after mobile-overwrite incident)
    // ──────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Country-agnostic mobile shape check: 8-12 digits after stripping non-digits,
    /// not all-same digit, no 000-prefix junk. Covers India (10), Sri Lanka (9),
    /// with-country-code (11-12). Used before writing rotary.org mobile to DB —
    /// rejects obvious junk like "0", "9", "9999999999", "00012345".
    /// </summary>
    private static bool LooksLikeRealMobile(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return false;
        var digits = new string(raw.Where(char.IsDigit).ToArray());
        if (digits.Length < 8 || digits.Length > 12) return false;
        if (digits.All(c => c == digits[0])) return false;
        if (digits.StartsWith("000")) return false;
        return true;
    }

    /// <summary>
    /// Sync-side mobile cleanup (user 2026-09-24). Rotary.org sends numbers however the club typed
    /// them — "+91 98765-43210", "0451-2000001", "91-431-2000002", "90000 00003". We keep the DIGITS
    /// only and store the LOCAL number, because that is what the mobile app sends at login
    /// (MobileAuthService matches PrimaryMobileNumber exactly, with the country held separately in
    /// fk_primary_country_id).
    ///
    ///   "+91 98765-43210" → "9876543210"      "0451-2000001" → "4512000001"
    ///   "91-431-2000002"  → "4312000002"      "90000 00003"  → "9000000003"
    ///   "0171-2631279/2642516" → "1712631279" (first number only — never the two glued together)
    ///
    /// The dial code is removed only when the number is clearly longer than a local one, so a real
    /// local number that happens to begin with the same digits (e.g. Indian "9187654321") is left
    /// alone. A leading trunk zero goes too. Junk still has to pass LooksLikeRealMobile afterwards.
    /// </summary>
    // Rotary.org sends "Mobile", "Home" or "Business"; be generous about spelling/case.
    private static bool IsMobileType(string? phoneType)
    {
        if (string.IsNullOrWhiteSpace(phoneType)) return false;   // unknown type -> treat as landline, store as-is
        var t = phoneType.Trim();
        return t.Contains("mobile", StringComparison.OrdinalIgnoreCase)
            || t.Contains("cell", StringComparison.OrdinalIgnoreCase);
    }

    private static string? CleanSyncedPhone(string? raw, string? countryCode, string? phoneType)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        // Only a MOBILE is cleaned. A landline ("Home"/"Business") is stored exactly as Rotary.org
        // sent it: it is never used for login or WhatsApp, its length and shape vary by city, and
        // "0171-2631279/2642516" is two numbers, not one (user 2026-09-24). Judging by the type the
        // source gives us also keeps this right for every country - a Sri Lanka mobile is 9 digits,
        // Nepal 10 starting 98 - instead of guessing from the length.
        if (!IsMobileType(phoneType)) return raw.Trim();
        // A field like "0171-2631279/2642516" holds TWO numbers. Stripping characters would glue them
        // into one 17-digit nonsense value, so only the first number is ever considered.
        var first = raw.Split('/', ',', ';', '&', '|')[0];
        var digits = new string(first.Where(char.IsDigit).ToArray());
        if (digits.Length == 0) return null;

        var cc = new string((countryCode ?? "").Where(char.IsDigit).ToArray());
        if (cc.Length > 0 && digits.StartsWith(cc, StringComparison.Ordinal) && digits.Length - cc.Length >= 6)
        {
            // Written in international form ("+65 9123 4567") - the code is certainly there, strip it
            // whatever the local length. Singapore locals are 8 digits, so a length test alone would
            // leave "6591234567" behind and lock those members out of the app.
            if (first.TrimStart().StartsWith('+'))
                digits = digits[cc.Length..];
            // No "+", so only strip when the number is clearly longer than a local one - otherwise an
            // Indian mobile that merely begins 91 ("9187654321") would lose its first two digits.
            else if (digits.Length > 10 && digits.Length - cc.Length >= 8)
                digits = digits[cc.Length..];
        }

        digits = digits.TrimStart('0');
        return digits.Length == 0 ? null : digits;
    }

    /// <summary>
    /// Strip everything except letters and digits — preserves case. Used to clean
    /// rotary.org-sourced PinCode values like 'chennai-12345', 'chennai/123456',
    /// 'chennai  123456', 'chennai -- 12456' → 'chennai12345' etc. Only applied
    /// to sync-side writes; portal-entered pincodes are not touched.
    /// </summary>
    private static string? NormalizePincode(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var cleaned = new string(raw.Where(char.IsLetterOrDigit).ToArray());
        return string.IsNullOrEmpty(cleaned) ? null : cleaned;
    }

    /// <summary>
    /// Write one row to sync_exception_log so SuperAdmin can review + resolve via
    /// GET /api/superadmin/sync-exceptions. Failure to log is itself logged but
    /// never bubbles — we don't want logging to crash the sweep.
    /// </summary>
    /// <param name="adminMessage">Human-friendly remark shown to admin in the portal — must NEVER include table/column names or raw exception text. Example: "Mobile number is already used by another member — please verify and update manually."</param>
    /// <param name="errorMessage">Raw developer-facing message (exception text, conflict pk, etc.) for triage when admin escalates.</param>
    // Conflict rows (member inserted despite an email/mobile clash) collected during a run — used for the
    // emailed Excel's "Inserted = Yes" rows. Failures ("Inserted = No") come from the `errors` list.
    private readonly List<MemberErrorRow> _conflictRows = new();

    // inserted: TRUE  = the member DID land in member_master_profile (conflict handled via primary→secondary);
    //           FALSE = a genuine failure, member NOT inserted (the rows an admin must review).
    private async Task LogSyncExceptionAsync(
        MySqlConnection conn, MySqlTransaction? tx,
        string exceptionType, string? rotaryId, string? rotaryOrgName,
        string? fieldName, string? conflictValue,
        int? conflictMemberPk, string? conflictMemberName,
        string? adminMessage, string? errorMessage, string? rawPayload,
        int? clubId, int? memberPk, bool inserted)
    {
        if (inserted)
            _conflictRows.Add(new MemberErrorRow
            {
                ClubId = clubId ?? 0,
                MemberRotaryId = rotaryId ?? "",
                Reason = adminMessage ?? errorMessage ?? exceptionType,
                Inserted = "Yes",
            });
        try
        {
            await conn.ExecuteAsync(@"
                INSERT INTO sync_exception_log
                    (exception_type, rotary_id, rotary_org_name, field_name, conflict_value,
                     conflict_with_member_pk, conflict_with_member_name,
                     admin_message, error_message, raw_payload,
                     fk_club_id, fk_member_master_profile_id, inserted)
                VALUES (@Type, @Rid, @Name, @Field, @Value,
                        @ConPk, @ConName,
                        @AdminMsg, @Err, @Payload,
                        @Club, @Mid, @Ins)",
                new
                {
                    Type = exceptionType, Rid = rotaryId, Name = rotaryOrgName,
                    Field = fieldName, Value = conflictValue,
                    ConPk = conflictMemberPk, ConName = conflictMemberName,
                    AdminMsg = adminMessage, Err = errorMessage, Payload = rawPayload,
                    Club = clubId, Mid = memberPk, Ins = inserted ? 1 : 0
                }, tx);
        }
        catch (Exception logEx)
        {
            _logger.LogWarning(logEx, "Failed to write sync_exception_log row (type={Type}, rotaryId={Rid})", exceptionType, rotaryId);
        }
    }

    /// <summary>
    /// Daily delta sync: ONLY clubs that changed in the last 10 days (per /clubs/updates),
    /// and ADDs only for members whose AdmissionDate is within the same window.
    /// UPDATEs and SOFT-DELETEs are unfiltered for those clubs (a member's profile may
    /// have changed without a new admission, etc.).
    ///
    /// Widened 24h → 3d → 5d → 10d on 2026-07-07 (user request): a member admitted
    /// on 2026-07-01 was dropped by the 5-day window on 2026-07-07 (1 day outside).
    /// 10-day rolling window gives a much larger safety net; overlap re-processing
    /// is idempotent (existing rows get UPDATED, not duplicated).
    /// </summary>
    public async Task RunDailyDeltaAsync(IReadOnlyList<int>? specificClubRotaryIds = null, CancellationToken ct = default)
    {
        var windowStart = DateTime.UtcNow.AddDays(-10).AddHours(-2); // 10 days + 2h overlap safety
        var windowEnd = DateTime.UtcNow;
        _admissionDateFilter = windowStart.Date;
        _isDailyDelta = true;

        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === Member Daily Delta START ===");
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Window: {windowStart:yyyy-MM-dd HH:mm}Z → {windowEnd:yyyy-MM-dd HH:mm}Z");

        try
        {
            // Test mode: --club-id (one or comma-separated many) was passed.
            // Each value is ALWAYS treated as a Rotary.org ClubRotaryId
            // (e.g. 28046), never as an internal PK. We look up rows in
            // club_master by ClubRotaryId; use their pk_club_id purely as a
            // DB-FK filter via _restrictedClubRotaryIds. Any ClubRotaryId not
            // present in club_master is reported and skipped.
            if (specificClubRotaryIds != null && specificClubRotaryIds.Count > 0)
            {
                var rotaryIdStrings = specificClubRotaryIds.Select(n => n.ToString()).Distinct().ToList();
                List<(string clubRotaryId, string clubName)> matched;
                await using (var lookupConn = CreateConnection())
                {
                    await lookupConn.OpenAsync(ct);
                    matched = (await lookupConn.QueryAsync<(string clubRotaryId, string clubName)>(@"
                        SELECT ClubRotaryId AS clubRotaryId, ClubName AS clubName
                        FROM club_master
                        WHERE ClubRotaryId IN @Ids
                          AND isdeleted = 0",
                        new { Ids = rotaryIdStrings })).ToList();
                }

                var matchedIds = matched.Select(m => m.clubRotaryId).ToHashSet(StringComparer.OrdinalIgnoreCase);
                var missing = rotaryIdStrings.Where(id => !matchedIds.Contains(id)).ToList();
                if (missing.Count > 0)
                    Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] --club-id: {missing.Count} ClubRotaryId(s) NOT found in club_master → skipping: {string.Join(", ", missing)}");
                if (matched.Count == 0)
                {
                    Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] --club-id: no ClubRotaryId matched. Nothing to sync.");
                    return;
                }

                Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] --club-id: matched {matched.Count} club(s) in club_master:");
                foreach (var m in matched)
                    Console.WriteLine($"[{DateTime.Now:HH:mm:ss}]   • {m.clubRotaryId} — {m.clubName}");

                Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Bypassing /clubs/updates gate; running daily-delta logic on just these {matched.Count} club(s).");
                _restrictedClubRotaryIds = matchedIds;
                await RunAsync(specificClubId: null, ct: ct);
                return;
            }

            var changed = await _api.GetClubUpdatesAsync(windowStart, windowEnd, ct);
            _restrictedClubRotaryIds = new HashSet<string>(
                changed.Select(c => c.ClubId.ToString()),
                StringComparer.OrdinalIgnoreCase);
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] /clubs/updates returned {changed.Count} changed club(s)");

            if (_restrictedClubRotaryIds.Count == 0)
            {
                Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] No clubs changed in window — nothing to sync");
                return;
            }

            await RunAsync(specificClubId: null, ct: ct);
        }
        finally
        {
            _restrictedClubRotaryIds = null;
            _admissionDateFilter = null;
            _isDailyDelta = false;
        }
    }

    /// <summary>
    /// MORNING member-count reconcile (mismatch-only). Closes the gap that --member-daily-delta leaves:
    /// the delta only touches clubs the /clubs/updates change-feed reports, so clubs whose members
    /// silently drifted (terminations the feed never emitted) never get cleaned.
    ///
    /// Cheap filter: ONE /clubs call gives every club's Rotary.org member count (active + honorary).
    /// Compare it to each SYNC club's ROW count; sweep ONLY the clubs whose counts differ. The sweep
    /// inserts members missing here and soft-deletes members gone from Rotary.org (from club_members +
    /// cascade) — member_master_profile is NEVER touched. Matched clubs are skipped entirely.
    /// Emails a "Mismatch Member Sync" report (via the normal sweep email path).
    /// </summary>
    public async Task RunMemberCountReconcileAsync(
        IReadOnlyCollection<string>? districtNumbers = null, CancellationToken ct = default)
    {
        bool filterDistricts = districtNumbers is { Count: > 0 };
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === Member Count Reconcile START (mismatch-only){(filterDistricts ? $" — districts: {string.Join(", ", districtNumbers!)}" : "")} ===");

        // 1) Cheap Rotary.org counts for every club — one /clubs call. Count = active + honorary,
        //    plus the honorary count on its own (see step 3).
        var orgClubs = await _api.GetClubsAsync(ct);
        var orgCountByRid = new Dictionary<string, (int Total, int Honorary)>(StringComparer.OrdinalIgnoreCase);
        foreach (var c in orgClubs)
            orgCountByRid[c.ClubId.ToString()] = ((c.MemberCount ?? 0) + (c.HonoraryMemberCount ?? 0), c.HonoraryMemberCount ?? 0);
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] /clubs: {orgClubs.Count} clubs (member counts loaded)");

        // 2) ROW SYNC clubs + their current member count (total + honorary). Optionally scoped to
        //    specific districts (the club-page "Sync all mismatched — this district" button passes one DistrictNumber).
        List<(string clubRotaryId, string clubName, int localCount, int localHonorary)> rizClubs;
        await using (var conn = CreateConnection())
        {
            await conn.OpenAsync(ct);
            rizClubs = (await conn.QueryAsync<(string clubRotaryId, string clubName, int localCount, int localHonorary)>(@"
                SELECT c.ClubRotaryId AS clubRotaryId, IFNULL(c.ClubName,'') AS clubName,
                       (SELECT COUNT(*) FROM club_members cm WHERE cm.fk_club_id = c.pk_club_id AND cm.isdeleted = 0) AS localCount,
                       (SELECT COUNT(*) FROM club_members cm WHERE cm.fk_club_id = c.pk_club_id AND cm.isdeleted = 0
                                                              AND IFNULL(cm.IsHonoraryMember,0) = 1) AS localHonorary
                FROM club_master c" +
                (filterDistricts ? " JOIN district_master d ON d.pk_district_id = c.fk_district_id" : "") + @"
                WHERE c.isdeleted = 0 AND IFNULL(c.IsSyncedFromRotaryOrg,0) = 1
                  AND c.ClubRotaryId IS NOT NULL AND c.ClubRotaryId <> ''" +
                (filterDistricts ? " AND d.isdeleted = 0 AND d.DistrictNumber IN @Districts" : ""),
                new { Districts = districtNumbers })).ToList();
        }

        // 3) Mismatched = ROW TOTAL != /clubs total, OR ROW HONORARY count != /clubs honorary
        //    count. The honorary check catches honorary <-> member status changes (e.g. a member
        //    re-admitted as regular after an honorary termination), which leave the total unchanged
        //    and never appear in the /clubs/updates feed. Clubs not in /clubs are left to the terminator.
        var mismatched = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        int checkedCount = 0, notInClubs = 0, totalMismatch = 0, honoraryOnlyMismatch = 0;
        foreach (var r in rizClubs)
        {
            if (!orgCountByRid.TryGetValue(r.clubRotaryId, out var org)) { notInClubs++; continue; }
            checkedCount++;
            if (r.localCount != org.Total) { mismatched.Add(r.clubRotaryId); totalMismatch++; }
            else if (r.localHonorary != org.Honorary) { mismatched.Add(r.clubRotaryId); honoraryOnlyMismatch++; }
        }
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Sync clubs: {rizClubs.Count}   checked vs /clubs: {checkedCount}   not in /clubs (skipped): {notInClubs}");
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] MISMATCHED clubs to sweep: {mismatched.Count} (total count: {totalMismatch}, honorary count only: {honoraryOnlyMismatch})");

        if (mismatched.Count == 0)
        {
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Nothing to reconcile — all sync clubs match the /clubs count.");
            return;
        }

        // 4) Sweep ONLY the mismatched clubs — full reconcile (add + terminate). NO _admissionDateFilter:
        //    we want to add EVERY missing member, not just recent admissions.
        try
        {
            _restrictedClubRotaryIds = mismatched;
            _isMismatchReconcile = true;
            await RunAsync(specificClubId: null, ct: ct);
        }
        finally
        {
            _restrictedClubRotaryIds = null;
            _isMismatchReconcile = false;
        }
    }

    /// <summary>
    /// Lightweight JOINING-DATE-ONLY sync. For each synced club it fetches the Rotary.org
    /// active member list (which carries AdmissionDate = the per-club joining date) — plus
    /// honorary members when requested — and UPDATEs ONLY club_members.JoinedDate for members
    /// already present in the DB. It does NOT fetch per-member /profile, does NOT add, does NOT
    /// terminate, and touches NO other column — so it's far faster than a full sweep and cannot
    /// affect any other data. Clubs are processed with modest concurrency to keep wall-clock low.
    /// Optional filters: clubRotaryIds (ClubRotaryId list) OR districtNumbers (DistrictNumber list).
    /// </summary>
    public async Task RunJoinDateSyncAsync(
        IReadOnlyList<int>? clubRotaryIds = null,
        IReadOnlyCollection<string>? districtNumbers = null,
        bool includeHonorary = true,
        int concurrency = 6,
        CancellationToken ct = default)
    {
        var startedAt = DateTime.UtcNow;
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === Joining-Date-Only Sync START ===");
        if (clubRotaryIds is { Count: > 0 })
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] (Filtered to ClubRotaryId(s): {string.Join(", ", clubRotaryIds)})");
        if (districtNumbers is { Count: > 0 })
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] (Filtered to districts: {string.Join(", ", districtNumbers)})");
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Honorary members: {(includeHonorary ? "included" : "skipped")} · concurrency={concurrency}");

        // Load the same synced-club set the sweep uses, optionally filtered.
        List<(int pk_id, string clubRotaryId, string clubName)> clubs;
        bool filterClubs = clubRotaryIds is { Count: > 0 };
        bool filterDistricts = districtNumbers is { Count: > 0 };
        var clubRotaryIdStrings = filterClubs ? clubRotaryIds!.Select(n => n.ToString()).ToList() : null;
        await using (var dbConn = CreateConnection())
        {
            await dbConn.OpenAsync(ct);
            var clubsSql = @"
                SELECT c.pk_club_id AS pk_id, c.ClubRotaryId AS clubRotaryId, c.ClubName AS clubName
                FROM club_master c" +
                (filterDistricts ? " JOIN district_master d ON d.pk_district_id = c.fk_district_id" : "") + @"
                WHERE c.isdeleted = 0
                  AND c.IsSyncedFromRotaryOrg = 1
                  AND c.ClubRotaryId IS NOT NULL AND c.ClubRotaryId <> ''" +
                (filterClubs ? " AND c.ClubRotaryId IN @ClubRotaryIds" : "") +
                (filterDistricts ? " AND d.DistrictNumber IN @Districts AND d.isdeleted = 0" : "") + @"
                ORDER BY c.pk_club_id";
            clubs = (await dbConn.QueryAsync<(int, string, string)>(
                clubsSql, new { ClubRotaryIds = clubRotaryIdStrings, Districts = districtNumbers })).ToList();
        }
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Clubs to process: {clubs.Count}");
        if (clubs.Count == 0) { Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Nothing to do."); return; }

        int clubsDone = 0, clubsErr = 0, totalUpdated = 0, totalMatched = 0;
        using var gate = new SemaphoreSlim(Math.Max(1, concurrency));

        var tasks = clubs.Select(async club =>
        {
            await gate.WaitAsync(ct);
            try
            {
                if (!int.TryParse(club.clubRotaryId, out var rotaryClubId))
                {
                    Interlocked.Increment(ref clubsErr);
                    return;
                }

                // Build MemberId(string) → AdmissionDate map from the active list (+ honorary).
                var admByRid = new Dictionary<string, DateTime>(StringComparer.OrdinalIgnoreCase);
                try
                {
                    var active = await _api.GetClubMembersAsync("Rotary Club", rotaryClubId, ct);
                    foreach (var m in active)
                        if (m.AdmissionDate.HasValue)
                            admByRid[m.MemberId.ToString()] = m.AdmissionDate.Value;

                    if (includeHonorary)
                    {
                        try
                        {
                            var hon = await _api.GetClubHonoraryMembersAsync("Rotary Club", rotaryClubId, ct);
                            foreach (var m in hon)
                                if (m.AdmissionDate.HasValue && !admByRid.ContainsKey(m.MemberId.ToString()))
                                    admByRid[m.MemberId.ToString()] = m.AdmissionDate.Value;
                        }
                        catch (Exception ex)
                        {
                            _logger.LogWarning(ex, "Honorary fetch failed for club {Club} — join-date sync proceeding active-only", club.clubName);
                        }
                    }
                }
                catch (Exception ex)
                {
                    Interlocked.Increment(ref clubsErr);
                    Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] {club.clubName,-40} API ERROR: {ex.Message}");
                    return;
                }

                int clubUpdated = 0, clubMatched = 0;
                await using (var conn = CreateConnection())
                {
                    await conn.OpenAsync(ct);
                    // All non-deleted club_members for this club + their RotaryId + current JoinedDate.
                    var dbRows = (await conn.QueryAsync<(int pkCm, string? rotaryId, DateTime? joined)>(@"
                        SELECT cm.pk_club_member_id AS pkCm, m.RotaryId AS rotaryId, cm.JoinedDate AS joined
                        FROM club_members cm
                        JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                        WHERE cm.fk_club_id = @ClubId AND COALESCE(cm.isdeleted,0) = 0 AND COALESCE(m.isdeleted,0) = 0",
                        new { ClubId = club.pk_id })).ToList();

                    foreach (var r in dbRows)
                    {
                        if (string.IsNullOrWhiteSpace(r.rotaryId)) continue;
                        if (!admByRid.TryGetValue(r.rotaryId.Trim(), out var adm)) continue;
                        clubMatched++;
                        // Only write when the date actually differs — keeps writes minimal.
                        if (r.joined.HasValue && r.joined.Value.Date == adm.Date) continue;
                        await conn.ExecuteAsync(@"
                            UPDATE club_members SET JoinedDate = @Joined, modified_date = NOW()
                            WHERE pk_club_member_id = @Id",
                            new { Id = r.pkCm, Joined = adm });
                        clubUpdated++;
                    }
                }

                Interlocked.Add(ref totalUpdated, clubUpdated);
                Interlocked.Add(ref totalMatched, clubMatched);
                var done = Interlocked.Increment(ref clubsDone);
                Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] [{done}/{clubs.Count}] {club.clubName,-40} matched={clubMatched} updated={clubUpdated}");
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex)
            {
                Interlocked.Increment(ref clubsErr);
                _logger.LogError(ex, "Join-date sync error for club {Club}", club.clubName);
            }
            finally { gate.Release(); }
        });

        await Task.WhenAll(tasks);

        var elapsed = DateTime.UtcNow - startedAt;
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === Joining-Date-Only Sync DONE ===");
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Clubs: {clubsDone} ok, {clubsErr} errored · Members matched: {totalMatched} · JoinedDate updated: {totalUpdated} · Elapsed: {elapsed:hh\\:mm\\:ss}");
    }

    /// <summary>
    /// Lightweight DATE-OF-BIRTH-ONLY sync. Refreshes ONLY member_master_profile.BirthDate from
    /// Rotary.org, parsed with the CORRECT fixed US format ("MM/dd/yyyy", InvariantCulture) — no add,
    /// no terminate, no other column touched. Corrective counterpart to --joindate-sync: it re-reads
    /// each member's DOB via /individuals/{id} (GetMemberDetailAsync) and overwrites BirthDate only
    /// when it differs. Fixes the historical day/month-swap and year-1900 rows caused by the old
    /// culture-sensitive DateTime.TryParse. Optional club/district filters; no filter = every member
    /// with a RotaryId. Never wipes a DOB: if Rotary.org has no usable date, the existing value stays.
    /// </summary>
    public async Task RunDobSyncAsync(
        IReadOnlyList<int>? clubRotaryIds = null,
        IReadOnlyCollection<string>? districtNumbers = null,
        int concurrency = 6,
        CancellationToken ct = default)
    {
        var startedAt = DateTime.UtcNow;
        bool filterClubs = clubRotaryIds is { Count: > 0 };
        bool filterDistricts = districtNumbers is { Count: > 0 };
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === Date-of-Birth-Only Sync START ===");
        if (filterClubs) Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] (Filtered to ClubRotaryId(s): {string.Join(", ", clubRotaryIds!)})");
        if (filterDistricts) Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] (Filtered to districts: {string.Join(", ", districtNumbers!)})");
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] concurrency={concurrency}");

        // DISTINCT members to refresh. A member in several clubs is fetched once. With a club/district
        // filter we join through synced clubs; otherwise every member that has a RotaryId.
        List<(int pk, string? rotaryId, DateTime? birthDate)> members;
        var clubRotaryIdStrings = filterClubs ? clubRotaryIds!.Select(n => n.ToString()).ToList() : null;
        await using (var dbConn = CreateConnection())
        {
            await dbConn.OpenAsync(ct);
            string sql = (filterClubs || filterDistricts)
                ? @"
                    SELECT DISTINCT m.pk_member_master_profile_id AS pk, m.RotaryId AS rotaryId, m.BirthDate AS birthDate
                    FROM member_master_profile m
                    JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND COALESCE(cm.isdeleted,0)=0
                    JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted=0 AND IFNULL(c.IsSyncedFromRotaryOrg,0)=1" +
                    (filterDistricts ? " JOIN district_master d ON d.pk_district_id = c.fk_district_id AND d.isdeleted=0" : "") + @"
                    WHERE COALESCE(m.isdeleted,0)=0 AND m.RotaryId IS NOT NULL AND m.RotaryId <> ''" +
                    (filterClubs ? " AND c.ClubRotaryId IN @ClubRotaryIds" : "") +
                    (filterDistricts ? " AND d.DistrictNumber IN @Districts" : "")
                : @"
                    SELECT m.pk_member_master_profile_id AS pk, m.RotaryId AS rotaryId, m.BirthDate AS birthDate
                    FROM member_master_profile m
                    WHERE COALESCE(m.isdeleted,0)=0 AND m.RotaryId IS NOT NULL AND m.RotaryId <> ''";
            members = (await dbConn.QueryAsync<(int, string?, DateTime?)>(
                sql, new { ClubRotaryIds = clubRotaryIdStrings, Districts = districtNumbers })).ToList();
        }
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Members to check: {members.Count}");
        if (members.Count == 0) { Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Nothing to do."); return; }

        int done = 0, updated = 0, matched = 0, noDob = 0, apiErr = 0, badId = 0;
        using var gate = new SemaphoreSlim(Math.Max(1, concurrency));

        var tasks = members.Select(async mem =>
        {
            await gate.WaitAsync(ct);
            try
            {
                if (string.IsNullOrWhiteSpace(mem.rotaryId) || !long.TryParse(mem.rotaryId.Trim(), out var mid) || mid <= 0)
                { Interlocked.Increment(ref badId); return; }

                RotaryOrgMemberDto? detail;
                try { detail = await _api.GetMemberDetailAsync(mid, ct); }
                catch (Exception ex)
                {
                    Interlocked.Increment(ref apiErr);
                    _logger.LogWarning(ex, "DOB sync: /individuals/{Mid} fetch failed", mid);
                    return;
                }

                var dob = ParseRotaryDob(detail?.DateOfBirth);
                // No usable DOB from Rotary.org → leave the existing value untouched (never wipe).
                if (!dob.HasValue || dob.Value.Year < 1900) { Interlocked.Increment(ref noDob); return; }
                Interlocked.Increment(ref matched);
                if (mem.birthDate.HasValue && mem.birthDate.Value.Date == dob.Value.Date) return;  // already correct

                await using var conn = CreateConnection();
                await conn.OpenAsync(ct);
                await conn.ExecuteAsync(@"
                    UPDATE member_master_profile SET BirthDate = @Dob, modified_date = NOW()
                    WHERE pk_member_master_profile_id = @Id",
                    new { Dob = dob.Value, Id = mem.pk });
                Interlocked.Increment(ref updated);
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex) { _logger.LogError(ex, "DOB sync error for member pk {Pk}", mem.pk); }
            finally
            {
                var d = Interlocked.Increment(ref done);
                if (d % 250 == 0) Console.WriteLine($"[{DateTime.Now:HH:mm:ss}]   {d}/{members.Count} checked · updated={updated}");
                gate.Release();
            }
        });
        await Task.WhenAll(tasks);

        var elapsed = DateTime.UtcNow - startedAt;
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === Date-of-Birth-Only Sync DONE ===");
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Members: {members.Count} · with DOB: {matched} · BirthDate updated: {updated} · no/invalid DOB: {noDob} · API errors: {apiErr} · bad RotaryId: {badId} · Elapsed: {elapsed:hh\\:mm\\:ss}");
    }

    // Parse Rotary.org's DOB string with the FIXED US format — never culture-dependent. Rotary.org
    // always sends "MM/dd/yyyy"; DateTime.TryParse(current culture) is the bug that swapped day/month
    // (08/01 → Jan 8) or dropped the year to 1900. Mirrors MemberSyncWorker.ParseDob.
    private static DateTime? ParseRotaryDob(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var v = raw.Trim();
        if (DateTime.TryParseExact(v, "MM/dd/yyyy", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var dt))
            return dt.Date;
        if (DateTime.TryParse(v, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var dt2))
            return dt2.Date;
        return null;
    }

    /// <summary>
    /// SINGLE-MEMBER verify/fix: for one or more RotaryIds, refresh DOB
    /// (member_master_profile.BirthDate, correct MM/dd/yyyy parse) AND joining date
    /// (club_members.JoinedDate for every club the member is in) from Rotary.org, printing a clear
    /// before→after for each. Nothing else touched; never wipes a value. Use to confirm a fix on the
    /// server before running --dob-sync / --joindate-sync across all districts.
    /// </summary>
    public async Task RunMemberRefreshAsync(IReadOnlyList<long> rotaryIds, CancellationToken ct = default)
    {
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === Single-Member Refresh (DOB + JoinedDate) — {rotaryIds.Count} member(s) ===");
        await using var conn = CreateConnection();
        await conn.OpenAsync(ct);

        foreach (var rid in rotaryIds)
        {
            ct.ThrowIfCancellationRequested();
            var ridStr = rid.ToString();
            Console.WriteLine("");
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] ── RotaryId {ridStr} ──");

            var member = await conn.QueryFirstOrDefaultAsync<(int pk, string? name, DateTime? birthDate)>(@"
                SELECT pk_member_master_profile_id AS pk, MemberName AS name, BirthDate AS birthDate
                FROM member_master_profile
                WHERE TRIM(RotaryId) = @Rid AND COALESCE(isdeleted,0)=0
                ORDER BY pk_member_master_profile_id DESC LIMIT 1",
                new { Rid = ridStr });
            if (member.pk == 0) { Console.WriteLine("   NOT FOUND in member_master_profile (isdeleted=0). Skipped."); continue; }
            Console.WriteLine($"   {member.name}  (pk {member.pk})");

            // 1) DOB from /individuals/{id}
            try
            {
                var detail = await _api.GetMemberDetailAsync(rid, ct);
                var raw = detail?.DateOfBirth;
                var dob = ParseRotaryDob(raw);
                if (!dob.HasValue || dob.Value.Year < 1900)
                    Console.WriteLine($"   DOB: Rotary.org='{raw ?? "(none)"}' → no usable date — LEFT AS-IS ({member.birthDate:yyyy-MM-dd})");
                else if (member.birthDate.HasValue && member.birthDate.Value.Date == dob.Value.Date)
                    Console.WriteLine($"   DOB: already correct ({dob:yyyy-MM-dd}) — Rotary.org='{raw}'");
                else
                {
                    await conn.ExecuteAsync("UPDATE member_master_profile SET BirthDate=@Dob, modified_date=NOW() WHERE pk_member_master_profile_id=@Id",
                        new { Dob = dob.Value, Id = member.pk });
                    Console.WriteLine($"   DOB: {member.birthDate:yyyy-MM-dd} → {dob:yyyy-MM-dd}  (Rotary.org='{raw}')  UPDATED");
                }
            }
            catch (Exception ex) { Console.WriteLine($"   DOB: API error — {ex.Message}"); }

            // 2) Joining date per club (club_members.JoinedDate ← Rotary.org AdmissionDate)
            var cmRows = (await conn.QueryAsync<(int pkCm, string? clubRotaryId, string? clubName, DateTime? joined)>(@"
                SELECT cm.pk_club_member_id AS pkCm, c.ClubRotaryId AS clubRotaryId, c.ClubName AS clubName, cm.JoinedDate AS joined
                FROM club_members cm
                JOIN club_master c ON c.pk_club_id = cm.fk_club_id
                WHERE cm.fk_member_master_profile_id = @Pk AND COALESCE(cm.isdeleted,0)=0 AND c.isdeleted=0",
                new { Pk = member.pk })).ToList();
            if (cmRows.Count == 0) { Console.WriteLine("   JoinedDate: no active club memberships."); continue; }

            foreach (var cm in cmRows)
            {
                if (string.IsNullOrWhiteSpace(cm.clubRotaryId) || !int.TryParse(cm.clubRotaryId, out var clubRid))
                { Console.WriteLine($"   JoinedDate [{cm.clubName}]: club has no ClubRotaryId — skipped."); continue; }
                try
                {
                    DateTime? adm = null;
                    var active = await _api.GetClubMembersAsync("Rotary Club", clubRid, ct);
                    adm = active.FirstOrDefault(m => m.MemberId == rid)?.AdmissionDate;
                    if (adm == null)
                    {
                        try
                        {
                            var hon = await _api.GetClubHonoraryMembersAsync("Rotary Club", clubRid, ct);
                            adm = hon.FirstOrDefault(m => m.MemberId == rid)?.AdmissionDate;
                        }
                        catch { }
                    }
                    if (adm == null) { Console.WriteLine($"   JoinedDate [{cm.clubName}]: not in Rotary.org active/honorary list — LEFT AS-IS ({cm.joined:yyyy-MM-dd})"); continue; }
                    if (cm.joined.HasValue && cm.joined.Value.Date == adm.Value.Date)
                    { Console.WriteLine($"   JoinedDate [{cm.clubName}]: already correct ({adm:yyyy-MM-dd})"); continue; }
                    await conn.ExecuteAsync("UPDATE club_members SET JoinedDate=@J, modified_date=NOW() WHERE pk_club_member_id=@Id",
                        new { J = adm.Value, Id = cm.pkCm });
                    Console.WriteLine($"   JoinedDate [{cm.clubName}]: {cm.joined:yyyy-MM-dd} → {adm:yyyy-MM-dd}  UPDATED");
                }
                catch (Exception ex) { Console.WriteLine($"   JoinedDate [{cm.clubName}]: API error — {ex.Message}"); }
            }
        }
        Console.WriteLine("");
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === Single-Member Refresh DONE ===");
    }

    // Last 10 digits of a phone string (digits only). "" if fewer than 10 digits.
    private static string Last10Digits(string? raw)
    {
        if (string.IsNullOrEmpty(raw)) return "";
        var digits = new string(raw.Where(char.IsDigit).ToArray());
        return digits.Length < 10 ? "" : digits.Substring(digits.Length - 10);
    }

    // Real Indian mobile = a clean 10-digit number (after +91/formatting) starting 6-9.
    // Deliberately STRICTER than LooksLikeRealMobile so landlines (e.g. 2836222322) are NOT salvaged —
    // matches the audit's `[6-9][0-9]{9}$` check so buckets line up exactly.
    private static bool IsSalvageableMobile(string? raw)
    {
        var last10 = Last10Digits(raw);
        return last10.Length == 10 && last10[0] >= '6' && last10[0] <= '9';
    }

    /// <summary>
    /// No-RotaryId DEDUP. In synced clubs (except 3 exempt districts), a member with no RotaryId is a
    /// stale import duplicate of a same-name RID member. For each such no-RID member that has a same-name
    /// RID twin in the same club: salvage its mobile onto the RID twin's SECONDARY slot IF that slot is
    /// blank and the number is a real mobile (bucket C), then soft-delete the no-RID member's club-scoped
    /// rows (full termination cascade — member_master_profile is NEVER touched). Buckets: A no valid
    /// mobile → delete; B number already on RID → delete; C copy → delete; D RID has a different secondary
    /// → delete anyway (per decision). No-RID members with NO twin are LEFT for manual review.
    /// apply=false → audit-only (counts + log nothing). apply=true → writes + a dedup_norid_log row per action.
    /// </summary>
    public async Task RunDedupNoRidAsync(bool apply, IReadOnlyCollection<string>? districtNumbers = null, CancellationToken ct = default)
    {
        var startedAt = DateTime.UtcNow;
        bool filterDistricts = districtNumbers is { Count: > 0 };
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === No-RotaryId Dedup ({(apply ? "APPLY" : "AUDIT — dry run, no writes")}){(filterDistricts ? $" · districts: {string.Join(",", districtNumbers!)}" : "")} ===");

        List<NoRidRow> rows;
        await using (var conn = CreateConnection())
        {
            await conn.OpenAsync(ct);
            var sql = @"
                SELECT
                  nr.pk_member_master_profile_id AS noridPk,
                  c.pk_club_id AS clubId, c.ClubName AS clubName, d.DistrictNumber AS district,
                  nr.MemberName AS memberName, nr.PrimaryMobileNumber AS noridMobile,
                  rid.pk_member_master_profile_id AS ridPk, rid.RotaryId AS ridRotaryId,
                  rid.PrimaryMobileNumber AS ridPrimary, rid.SecondaryMobileNumber AS ridSecondary
                FROM member_master_profile nr
                JOIN club_members cmn  ON cmn.fk_member_master_profile_id = nr.pk_member_master_profile_id AND cmn.isdeleted=0
                JOIN club_master c     ON c.pk_club_id = cmn.fk_club_id AND c.isdeleted=0 AND IFNULL(c.IsSyncedFromRotaryOrg,0)=1
                JOIN district_master d ON d.pk_district_id = c.fk_district_id AND d.isdeleted=0
                LEFT JOIN member_master_profile rid ON rid.pk_member_master_profile_id = (
                    SELECT r.pk_member_master_profile_id
                    FROM club_members cmr
                    JOIN member_master_profile r ON r.pk_member_master_profile_id = cmr.fk_member_master_profile_id
                    WHERE cmr.fk_club_id = c.pk_club_id AND cmr.isdeleted=0
                      AND r.isdeleted=0 AND r.RotaryId IS NOT NULL AND TRIM(r.RotaryId) NOT IN ('','0')
                      AND LOWER(REGEXP_REPLACE(TRIM(r.MemberName),'[[:space:]]+',' ')) = LOWER(REGEXP_REPLACE(TRIM(nr.MemberName),'[[:space:]]+',' '))
                    ORDER BY r.pk_member_master_profile_id LIMIT 1)
                WHERE nr.isdeleted=0
                  AND (nr.RotaryId IS NULL OR TRIM(nr.RotaryId) IN ('','0'))
                  AND d.DistrictNumber NOT IN ('5656','1280','IFRM India')" +
                (filterDistricts ? " AND d.DistrictNumber IN @Districts" : "") + @"
                ORDER BY CAST(d.DistrictNumber AS UNSIGNED), c.ClubName, nr.MemberName";
            rows = (await conn.QueryAsync<NoRidRow>(sql, new { Districts = districtNumbers })).ToList();

            if (apply)
                await conn.ExecuteAsync(@"CREATE TABLE IF NOT EXISTS dedup_norid_log (
                    pk_id BIGINT AUTO_INCREMENT PRIMARY KEY, run_utc DATETIME NOT NULL,
                    norid_member_pk INT, club_id INT, club_name VARCHAR(255), member_name VARCHAR(255),
                    norid_mobile VARCHAR(100), rid_member_pk INT NULL, rid_rotaryid VARCHAR(50) NULL,
                    action VARCHAR(40), mobile_moved TINYINT DEFAULT 0, rid_secondary_old VARCHAR(100) NULL)");
        }

        int a = 0, b = 0, cCnt = 0, dCnt = 0, skipNoTwin = 0, moved = 0, deleted = 0, errors = 0;
        foreach (var r in rows)
        {
            ct.ThrowIfCancellationRequested();
            if (r.ridPk == null) { skipNoTwin++; continue; }   // no twin → leave for manual review

            var nm = Last10Digits(r.noridMobile);
            string action;
            if (!IsSalvageableMobile(r.noridMobile))                                         { action = "A_DELETE_NO_MOBILE"; a++; }
            else if (nm == Last10Digits(r.ridPrimary) || nm == Last10Digits(r.ridSecondary)) { action = "B_ALREADY_ON_RID";   b++; }
            else if (string.IsNullOrWhiteSpace(r.ridSecondary))                              { action = "C_COPY_SECONDARY";   cCnt++; }
            else                                                                             { action = "D_CONFLICT";         dCnt++; }

            if (!apply) continue;

            try
            {
                await using var w = CreateConnection();
                await w.OpenAsync(ct);
                bool didMove = false;
                // Bucket C: salvage the mobile FIRST (fill-blank-only guard), so nothing is lost if the
                // delete somehow fails (re-run would then see it as bucket B and just delete).
                if (action == "C_COPY_SECONDARY")
                {
                    var n = await w.ExecuteAsync(@"UPDATE member_master_profile
                        SET SecondaryMobileNumber = @Mob, modified_date = NOW()
                        WHERE pk_member_master_profile_id = @RidPk
                          AND (SecondaryMobileNumber IS NULL OR TRIM(SecondaryMobileNumber) = '')",
                        new { Mob = r.noridMobile, RidPk = r.ridPk });
                    didMove = n > 0; if (didMove) moved++;
                }
                // Soft-delete the no-RID duplicate from THIS club (full cascade; profile untouched).
                await TerminateFromClubAsync(w, r.clubId, r.noridPk, DateTime.Today,
                    $"No Rotary ID — duplicate of RID {r.ridRotaryId}", ct);
                deleted++;
                await w.ExecuteAsync(@"INSERT INTO dedup_norid_log
                    (run_utc, norid_member_pk, club_id, club_name, member_name, norid_mobile, rid_member_pk, rid_rotaryid, action, mobile_moved, rid_secondary_old)
                    VALUES (UTC_TIMESTAMP(), @NoridPk, @ClubId, @ClubName, @Name, @Mob, @RidPk, @Rid, @Action, @Moved, @OldSec)",
                    new { NoridPk = r.noridPk, ClubId = r.clubId, ClubName = r.clubName, Name = r.memberName,
                          Mob = r.noridMobile, RidPk = r.ridPk, Rid = r.ridRotaryId, Action = action,
                          Moved = didMove ? 1 : 0, OldSec = r.ridSecondary });
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex) { errors++; _logger.LogError(ex, "Dedup error for no-RID member pk {Pk}", r.noridPk); }
        }

        var elapsed = DateTime.UtcNow - startedAt;
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === No-RotaryId Dedup {(apply ? "APPLIED" : "AUDIT")} — {elapsed:hh\\:mm\\:ss} ===");
        Console.WriteLine($"  No-RID members (with twin): {a + b + cCnt + dCnt}   |   NO twin (left for review): {skipNoTwin}");
        Console.WriteLine($"  A delete-no-mobile: {a}   B already-on-RID: {b}   C copy->secondary: {cCnt}   D conflict(delete anyway): {dCnt}");
        if (apply) Console.WriteLine($"  APPLIED → duplicates soft-deleted: {deleted}   mobiles salvaged: {moved}   errors: {errors}   (see dedup_norid_log)");
        else       Console.WriteLine($"  DRY RUN — nothing written. Re-run with --apply to execute.");
    }

    private class NoRidRow
    {
        public int noridPk { get; set; }
        public int clubId { get; set; }
        public string? clubName { get; set; }
        public string? district { get; set; }
        public string? memberName { get; set; }
        public string? noridMobile { get; set; }
        public int? ridPk { get; set; }
        public string? ridRotaryId { get; set; }
        public string? ridPrimary { get; set; }
        public string? ridSecondary { get; set; }
    }

    /// <summary>
    /// Full sweep restricted to a specific set of ClubRotaryIds (no time filter,
    /// no AdmissionDate filter — everyone in the Rotary.org active member list
    /// for each club gets ADD/UPDATE/TERMINATE processing). Used when the user
    /// wants "sync all members of these clubs" — e.g. --member-sweep --club-id
    /// 28046,28047,28048.
    /// </summary>
    public async Task RunForClubRotaryIdsAsync(IReadOnlyList<int> clubRotaryIds, CancellationToken ct = default)
    {
        var rotaryIdStrings = clubRotaryIds.Select(n => n.ToString()).Distinct().ToList();
        List<(string clubRotaryId, string clubName)> matched;
        await using (var lookupConn = CreateConnection())
        {
            await lookupConn.OpenAsync(ct);
            matched = (await lookupConn.QueryAsync<(string clubRotaryId, string clubName)>(@"
                SELECT ClubRotaryId AS clubRotaryId, ClubName AS clubName
                FROM club_master
                WHERE ClubRotaryId IN @Ids
                  AND isdeleted = 0",
                new { Ids = rotaryIdStrings })).ToList();
        }

        var matchedIds = matched.Select(m => m.clubRotaryId).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var missing = rotaryIdStrings.Where(id => !matchedIds.Contains(id)).ToList();
        if (missing.Count > 0)
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] --club-id: {missing.Count} ClubRotaryId(s) NOT found in club_master → skipping: {string.Join(", ", missing)}");
        if (matched.Count == 0)
        {
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] --club-id: no ClubRotaryId matched. Nothing to sync.");
            return;
        }

        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] --club-id: matched {matched.Count} club(s) in club_master:");
        foreach (var m in matched)
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}]   • {m.clubRotaryId} — {m.clubName}");

        try
        {
            _restrictedClubRotaryIds = matchedIds;
            await RunAsync(specificClubId: null, ct: ct);
        }
        finally
        {
            _restrictedClubRotaryIds = null;
        }
    }

    /// <summary>
    /// Failed-list re-sync: read an Excel file of (RotaryId, ClubRotaryId) pairs and
    /// process only those members. Skips terminations. Use to retry the 'Errors' sheet
    /// from a previous sweep run without re-syncing all 28 districts.
    /// </summary>
    /// <param name="xlsxPath">Path to .xlsx with headers 'RotaryId' and 'ClubRotaryId' in first row.</param>
    public async Task RunForFailedListAsync(string xlsxPath, CancellationToken ct = default)
    {
        if (!File.Exists(xlsxPath))
            throw new FileNotFoundException($"Failed-list file not found: {xlsxPath}");

        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === Failed-List Re-Sync START ===");
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Reading {xlsxPath}");

        var pairs = ReadFailedListFromExcel(xlsxPath);
        if (pairs.Count == 0)
        {
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] No (RotaryId, ClubRotaryId) pairs found — exiting.");
            return;
        }

        var clubCount = pairs.Select(p => p.ClubRotaryId).Distinct(StringComparer.OrdinalIgnoreCase).Count();
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Parsed {pairs.Count} member rows across {clubCount} club(s).");

        // Resolve any ROW pk_club_id entries (when source Excel used 'ClubId' column from
        // a previous sweep's Errors sheet, which carries the ROW internal PK, not the
        // rotary.org ClubRotaryId). Look them up here so the rest of RunAsync only deals
        // with ClubRotaryId strings.
        var pkSet = pairs.Where(p => p.IsPkClubId).Select(p => p.ClubRotaryId).Distinct().ToList();
        var pkToRotaryId = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (pkSet.Count > 0)
        {
            await using var resolveConn = CreateConnection();
            await resolveConn.OpenAsync(ct);
            var resolved = await resolveConn.QueryAsync<(int pk_id, string clubRotaryId)>(@"
                SELECT pk_club_id AS pk_id, ClubRotaryId AS clubRotaryId
                FROM club_master
                WHERE pk_club_id IN @Ids
                  AND ClubRotaryId IS NOT NULL AND ClubRotaryId <> ''",
                new { Ids = pkSet.Select(int.Parse) });
            foreach (var r in resolved)
                pkToRotaryId[r.pk_id.ToString()] = r.clubRotaryId;
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Resolved {pkToRotaryId.Count}/{pkSet.Count} ROW pk_club_id values to ClubRotaryId.");
        }

        // Normalize: replace any pk values with their ClubRotaryId equivalent, drop unresolved
        var resolvedPairs = pairs
            .Select(p => p.IsPkClubId
                ? (RotaryId: p.RotaryId, ClubRotaryId: pkToRotaryId.GetValueOrDefault(p.ClubRotaryId, ""))
                : (p.RotaryId, p.ClubRotaryId))
            .Where(p => !string.IsNullOrEmpty(p.ClubRotaryId))
            .ToList();

        if (resolvedPairs.Count < pairs.Count)
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Dropped {pairs.Count - resolvedPairs.Count} row(s) with unresolved club references.");

        _restrictedClubMemberPairs = resolvedPairs
            .GroupBy(p => p.ClubRotaryId, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(
                g => g.Key,
                g => new HashSet<string>(g.Select(p => p.RotaryId), StringComparer.OrdinalIgnoreCase),
                StringComparer.OrdinalIgnoreCase);
        _restrictedClubRotaryIds = new HashSet<string>(_restrictedClubMemberPairs.Keys, StringComparer.OrdinalIgnoreCase);
        _isFailedListMode = true;

        try
        {
            await RunAsync(specificClubId: null, ct: ct);
        }
        finally
        {
            _restrictedClubMemberPairs = null;
            _restrictedClubRotaryIds = null;
            _isFailedListMode = false;
        }
    }

    /// <summary>
    /// Parse the failed-list Excel. Member column accepts headers 'RotaryId' / 'Rotary Id' /
    /// 'MemberRotaryId' / 'Member Rotary Id'. Club column accepts EITHER 'ClubRotaryId' /
    /// 'Club Rotary Id' (rotary.org id — preferred) OR 'ClubId' / 'Club Id' (ROW pk_club_id,
    /// the format used by old sweep Errors sheets). IsPkClubId is true for the latter so the
    /// caller can resolve them to rotary.org ids via DB lookup. Skips blank rows. Dedupes.
    /// </summary>
    private static List<(string RotaryId, string ClubRotaryId, bool IsPkClubId)> ReadFailedListFromExcel(string path)
    {
        var pairs = new List<(string, string, bool)>();
        using var wb = new XLWorkbook(path);
        var ws = wb.Worksheet(1);
        var headerRow = ws.FirstRowUsed();
        if (headerRow == null) return pairs;

        int rotaryIdCol = -1, clubRotaryIdCol = -1, clubPkCol = -1;
        foreach (var cell in headerRow.CellsUsed())
        {
            var h = cell.GetString().Trim();
            if (rotaryIdCol < 0 && (
                string.Equals(h, "RotaryId", StringComparison.OrdinalIgnoreCase)
                || string.Equals(h, "Rotary Id", StringComparison.OrdinalIgnoreCase)
                || string.Equals(h, "MemberRotaryId", StringComparison.OrdinalIgnoreCase)
                || string.Equals(h, "Member Rotary Id", StringComparison.OrdinalIgnoreCase)))
            {
                rotaryIdCol = cell.Address.ColumnNumber;
            }
            else if (clubRotaryIdCol < 0 && (
                string.Equals(h, "ClubRotaryId", StringComparison.OrdinalIgnoreCase)
                || string.Equals(h, "Club Rotary Id", StringComparison.OrdinalIgnoreCase)))
            {
                clubRotaryIdCol = cell.Address.ColumnNumber;
            }
            else if (clubPkCol < 0 && (
                string.Equals(h, "ClubId", StringComparison.OrdinalIgnoreCase)
                || string.Equals(h, "Club Id", StringComparison.OrdinalIgnoreCase)
                || string.Equals(h, "ClubPkId", StringComparison.OrdinalIgnoreCase)
                || string.Equals(h, "pk_club_id", StringComparison.OrdinalIgnoreCase)))
            {
                clubPkCol = cell.Address.ColumnNumber;
            }
        }

        if (rotaryIdCol < 0)
            throw new InvalidOperationException(
                "Excel must have a member column: 'RotaryId' / 'Rotary Id' / 'MemberRotaryId' / 'Member Rotary Id'.");
        if (clubRotaryIdCol < 0 && clubPkCol < 0)
            throw new InvalidOperationException(
                "Excel must have a club column: 'ClubRotaryId' (preferred) or 'ClubId' (ROW pk_club_id from old Errors sheet).");

        // Prefer ClubRotaryId if both present; fall back to pk.
        bool useClubRotaryId = clubRotaryIdCol >= 0;
        int clubCol = useClubRotaryId ? clubRotaryIdCol : clubPkCol;

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var row in ws.RowsUsed().Skip(1))
        {
            var rid = row.Cell(rotaryIdCol).GetString().Trim();
            var cid = row.Cell(clubCol).GetString().Trim();
            if (string.IsNullOrEmpty(rid) || string.IsNullOrEmpty(cid)) continue;
            var key = $"{cid}|{rid}|{useClubRotaryId}";
            if (!seen.Add(key)) continue;
            pairs.Add((rid, cid, !useClubRotaryId));
        }
        return pairs;
    }

    public async Task RunAsync(int? specificClubId = null, IReadOnlyCollection<string>? districtNumbers = null, CancellationToken ct = default)
    {
        var startedAt = DateTime.UtcNow;
        _conflictRows.Clear();  // reset per-run "Inserted=Yes" conflict rows for the emailed Excel
        var modeLabel = _isMismatchReconcile ? "Member Count Reconcile (mismatch)" : (_isDailyDelta ? "Member Daily Delta" : "Club Member Sweep");
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === {modeLabel} START ===");
        if (specificClubId.HasValue)
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] (Test mode — only club id {specificClubId.Value})");
        if (districtNumbers != null && districtNumbers.Count > 0)
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] (Filtered to districts: {string.Join(", ", districtNumbers)})");

        int logId;
        await using (var conn = CreateConnection())
        {
            await conn.OpenAsync(ct);
            var triggeredBy = int.Parse(_config["RotaryOrgSync:TriggeredByMemberId"] ?? "0");
            logId = await conn.ExecuteScalarAsync<int>(@"
                INSERT INTO rotary_org_sync_log (SyncType, StartedAtUtc, Status, TriggeredBy)
                VALUES ('ClubMemberSweep', UTC_TIMESTAMP(), 'Running', @By);
                SELECT LAST_INSERT_ID();",
                new { By = triggeredBy });
        }
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Log row created — logId={logId}");

        var added = new List<MemberChangeRow>();
        var updated = new List<MemberChangeRow>();
        var terminated = new List<MemberChangeRow>();
        var errors = new List<MemberErrorRow>();
        var perClub = new List<(int ClubId, string ClubRotaryId, string ClubName, int Found, int Added, int Updated, int Terminated, int Errors, string Status)>();
        int totalAdded = 0, totalUpdated = 0, totalTerminated = 0, totalErrors = 0;

        try
        {
            await using var dbConn = CreateConnection();
            await dbConn.OpenAsync(ct);

            // Load synced clubs — optionally filtered by --club-id or --districts.
            // Districts use DistrictNumber (the public 4-digit code like 3233), not the PK.
            bool filterDistricts = districtNumbers != null && districtNumbers.Count > 0;
            var clubsSql = @"
                SELECT c.pk_club_id AS pk_id, c.ClubRotaryId AS clubRotaryId, c.ClubName AS clubName
                FROM club_master c" +
                (filterDistricts ? " JOIN district_master d ON d.pk_district_id = c.fk_district_id" : "") + @"
                WHERE c.isdeleted = 0
                  AND c.IsSyncedFromRotaryOrg = 1
                  AND c.ClubRotaryId IS NOT NULL AND c.ClubRotaryId <> ''" +
                (specificClubId.HasValue ? " AND c.pk_club_id = @SpecificId" : "") +
                (filterDistricts ? " AND d.DistrictNumber IN @Districts AND d.isdeleted = 0" : "") + @"
                ORDER BY c.pk_club_id";
            var clubs = (await dbConn.QueryAsync<(int pk_id, string clubRotaryId, string clubName)>(
                clubsSql, new { SpecificId = specificClubId ?? 0, Districts = districtNumbers })).ToList();

            // Daily-delta mode — narrow to clubs that appeared in /clubs/updates
            if (_restrictedClubRotaryIds != null && _restrictedClubRotaryIds.Count > 0)
            {
                var before = clubs.Count;
                clubs = clubs.Where(c => _restrictedClubRotaryIds.Contains(c.clubRotaryId)).ToList();
                Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Daily-delta filter: {clubs.Count}/{before} synced clubs are in changed list");
            }
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Clubs to process: {clubs.Count}");

            int clubIdx = 0;
            foreach (var club in clubs)
            {
                ct.ThrowIfCancellationRequested();
                clubIdx++;
                int clubAdded = 0, clubUpdated = 0, clubTerminated = 0, clubErrors = 0;
                string status = "ok";

                if (!int.TryParse(club.clubRotaryId, out var rotaryClubId))
                {
                    perClub.Add((club.pk_id, club.clubRotaryId, club.clubName, 0, 0, 0, 0, 1, "invalid ClubRotaryId"));
                    continue;
                }

                List<RotaryOrgClubMemberDto> apiMembers;
                int activeCount = 0;
                int honoraryCount = 0;
                try
                {
                    var activeList = await _api.GetClubMembersAsync("Rotary Club", rotaryClubId, ct);
                    activeCount = activeList.Count;

                    // /Active endpoint excludes Honorary members — fetch them separately
                    // and merge so the sweep processes BOTH sets. Honorary members' MemberType
                    // is "Honorary Member"; AddMemberAsync / UpdateMemberAsync already
                    // reads that field and sets club_members.IsHonoraryMember = 1.
                    // Non-fatal on failure — falls back to Active-only for that club.
                    List<RotaryOrgClubMemberDto> honList;
                    try
                    {
                        honList = await _api.GetClubHonoraryMembersAsync("Rotary Club", rotaryClubId, ct);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Failed to fetch honorary members for club {Club} — proceeding with active only", club.clubName);
                        honList = new List<RotaryOrgClubMemberDto>();
                    }
                    honoraryCount = honList.Count;

                    // Merge with de-dupe by MemberId (defensive — Rotary.org theoretically
                    // shouldn't return the same MemberId in both /Active and /Honorary, but
                    // if they do, keep the /Active row first and drop the honorary duplicate).
                    var seenIds = new HashSet<long>(activeList.Select(m => m.MemberId));
                    apiMembers = new List<RotaryOrgClubMemberDto>(activeList);
                    foreach (var h in honList)
                    {
                        if (!seenIds.Contains(h.MemberId))
                        {
                            apiMembers.Add(h);
                            seenIds.Add(h.MemberId);
                        }
                    }
                }
                catch (Exception ex)
                {
                    totalErrors++;
                    errors.Add(new MemberErrorRow { ClubId = club.pk_id, ClubName = club.clubName, MemberRotaryId = "", Reason = $"API: {ex.Message}" });
                    perClub.Add((club.pk_id, club.clubRotaryId, club.clubName, 0, 0, 0, 0, 1, $"api error: {ex.Message}"));
                    Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] [{clubIdx}/{clubs.Count}] {club.clubName,-40} API ERROR: {ex.Message}");
                    continue;
                }

                // Fetch the historical terminated list — for SOFT-DELETE we want the REAL
                // TerminationDate + TerminationReason from Rotary.org instead of stamping today's
                // date with a generic message. Same MemberId can appear multiple times in this
                // list (joined → left → rejoined → left); dedupe by MemberId keeping the row with
                // the latest TerminationDate. Failure to fetch is non-fatal — the SOFT-DELETE
                // path falls back to today + generic reason.
                Dictionary<long, (DateTime? Date, string? Reason)> terminatedLatest;
                try
                {
                    var terminatedList = await _api.GetClubTerminatedMembersAsync("Rotary Club", rotaryClubId, ct);
                    terminatedLatest = terminatedList
                        .Where(t => t.MemberId > 0)
                        .GroupBy(t => t.MemberId)
                        .Select(g => g.OrderByDescending(t => t.TerminationDate ?? DateTime.MinValue).First())
                        .ToDictionary(t => t.MemberId, t => ((DateTime?)t.TerminationDate, (string?)t.TerminationReason));
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to fetch /members/terminated for club {Club} — soft-deletes will use defaults", club.clubName);
                    terminatedLatest = new Dictionary<long, (DateTime?, string?)>();
                }

                // Load current DB members for this club: pk_member_id + RotaryId
                var dbMembers = (await dbConn.QueryAsync<(int memberId, string? rotaryId)>(@"
                    SELECT m.pk_member_master_profile_id AS memberId, m.RotaryId AS rotaryId
                    FROM club_members cm
                    JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                    WHERE cm.fk_club_id = @ClubId AND cm.isdeleted = 0 AND m.isdeleted = 0",
                    new { ClubId = club.pk_id })).ToList();

                var apiRotaryIds = new HashSet<string>(apiMembers.Select(m => m.MemberId.ToString()), StringComparer.OrdinalIgnoreCase);

                // ── STEP 1 — TERMINATE FIRST: members in DB but no longer on Rotary.org. ──
                // This MUST run before the ADD pass below: terminating a member from their LAST club
                // frees their PRIMARY mobile (Primary -> Secondary). If a NEW RotaryId in the SAME club
                // is re-using that number, the ADD pass can then claim it as primary. Add-then-terminate
                // would insert the newcomer while the old number is still held, so the newcomer's mobile
                // would be bumped to secondary (the duplicate-mobile bug). Skipped in failed-list mode
                // (that's a targeted retry, not a full reconciliation).
                if (_isFailedListMode)
                {
                    Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] [{clubIdx}/{clubs.Count}] {club.clubName,-40} skip-terminate (failed-list mode)");
                }
                else
                {
                    foreach (var (dbMemberId, dbRotaryId) in dbMembers)
                    {
                        ct.ThrowIfCancellationRequested();
                        if (string.IsNullOrWhiteSpace(dbRotaryId)) continue;  // no RotaryId = locally added, never auto-terminate
                        if (apiRotaryIds.Contains(dbRotaryId)) continue;       // still on API, keep

                        try
                        {
                            var name = await dbConn.ExecuteScalarAsync<string?>(
                                "SELECT MemberName FROM member_master_profile WHERE pk_member_master_profile_id = @Id",
                                new { Id = dbMemberId }) ?? "";

                            // Real TerminationDate + reason from Rotary.org (deduped latest per MemberId);
                            // null falls back to today + generic inside TerminateFromClubAsync.
                            DateTime? actualTermDate = null;
                            string? actualTermReason = null;
                            if (long.TryParse(dbRotaryId, out var dbMemberRid) && terminatedLatest.TryGetValue(dbMemberRid, out var tinfo))
                            {
                                actualTermDate = tinfo.Date;
                                actualTermReason = tinfo.Reason;
                            }
                            await TerminateFromClubAsync(dbConn, club.pk_id, dbMemberId, actualTermDate, actualTermReason, ct);
                            clubTerminated++;
                            totalTerminated++;
                            terminated.Add(new MemberChangeRow
                            {
                                ClubName = club.clubName,
                                MemberRotaryId = dbRotaryId,
                                MemberName = name,
                                ChangedFields = "removed from this club",
                            });
                        }
                        catch (Exception ex)
                        {
                            clubErrors++;
                            totalErrors++;
                            errors.Add(new MemberErrorRow { ClubId = club.pk_id, ClubName = club.clubName, MemberRotaryId = dbRotaryId, Reason = ex.Message });
                            _logger.LogError(ex, "Termination error for club {Club} member {Mid}", club.clubName, dbRotaryId);
                        }
                    }
                }

                // Build RotaryId → memberId map. Defensive against duplicate RotaryIds
                // within the same club (the 2026-06-24 sweep crashed when two members
                // shared RotaryId 6887532). On dupes we keep the LOWEST pk_member_id
                // (oldest row — assumed canonical) and log a warning so admin can
                // clean up the duplicate manually.
                var dbByRotaryId = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
                foreach (var m in dbMembers.Where(m => !string.IsNullOrWhiteSpace(m.rotaryId))
                                           .OrderBy(m => m.memberId))
                {
                    var key = m.rotaryId!.Trim();
                    if (!dbByRotaryId.ContainsKey(key))
                    {
                        dbByRotaryId[key] = m.memberId;
                    }
                    else
                    {
                        _logger.LogWarning(
                            "Duplicate RotaryId {RotaryId} in club {ClubId} ({ClubName}) — keeping member {KeptId}, ignoring member {SkippedId}",
                            key, club.pk_id, club.clubName, dbByRotaryId[key], m.memberId);
                    }
                }

                // Failed-list filter: only process the member RotaryIds we were given for this club
                HashSet<string>? allowedMemberIds = null;
                if (_restrictedClubMemberPairs != null)
                    _restrictedClubMemberPairs.TryGetValue(club.clubRotaryId, out allowedMemberIds);

                // ── STEP 2+3 — ADD or UPDATE for each API member ──
                foreach (var apiMember in apiMembers)
                {
                    ct.ThrowIfCancellationRequested();
                    var rid = apiMember.MemberId.ToString();

                    // Skip members not in our retry set (failed-list mode only)
                    if (allowedMemberIds != null && !allowedMemberIds.Contains(rid))
                        continue;

                    try
                    {
                        if (dbByRotaryId.TryGetValue(rid, out var existingMemberId))
                        {
                            // UPDATE (merge rules: skip blanks, prefer API non-empty values, per-club honorary refresh)
                            var changedFields = await UpdateMemberAsync(dbConn, club.pk_id, existingMemberId, apiMember, ct);
                            if (changedFields.Length > 0)
                            {
                                clubUpdated++;
                                totalUpdated++;
                                updated.Add(new MemberChangeRow
                                {
                                    ClubName = club.clubName,
                                    MemberRotaryId = rid,
                                    MemberName = BuildName(apiMember),
                                    ChangedFields = changedFields,
                                });
                            }
                        }
                        else
                        {
                            // Daily-delta: ADD only if AdmissionDate is within the 24h window. Historical
                            // members who happen to be missing locally are NOT auto-added by daily delta —
                            // they get picked up by the weekly full sweep instead.
                            if (_admissionDateFilter.HasValue
                                && (!apiMember.AdmissionDate.HasValue || apiMember.AdmissionDate.Value.Date < _admissionDateFilter.Value))
                            {
                                continue;
                            }

                            // ADD: insert into member_master_profile (or re-activate soft-deleted) + club_members + Member role
                            var memberId = await AddMemberAsync(dbConn, club.pk_id, apiMember, ct);
                            clubAdded++;
                            totalAdded++;
                            added.Add(new MemberChangeRow
                            {
                                ClubName = club.clubName,
                                MemberRotaryId = rid,
                                MemberName = BuildName(apiMember),
                                ChangedFields = "inserted",
                            });
                        }
                    }
                    catch (Exception ex)
                    {
                        clubErrors++;
                        totalErrors++;
                        errors.Add(new MemberErrorRow { ClubId = club.pk_id, ClubName = club.clubName, MemberRotaryId = rid, Reason = ex.Message });
                        _logger.LogError(ex, "Sweep error for club {Club} member {Mid}", club.clubName, rid);
                    }
                }

                Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] [{clubIdx}/{clubs.Count}] {club.clubName,-40} api={apiMembers.Count,4} (act={activeCount} hon={honoraryCount}) +{clubAdded,3} ~{clubUpdated,3} -{clubTerminated,3} err={clubErrors}");
                perClub.Add((club.pk_id, club.clubRotaryId, club.clubName, apiMembers.Count, clubAdded, clubUpdated, clubTerminated, clubErrors, status));
            }

            var elapsed = DateTime.UtcNow - startedAt;
            Console.WriteLine("");
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === Club Member Sweep DONE in {elapsed.TotalMinutes:F1} min ===");
            Console.WriteLine($"  Clubs processed:       {clubs.Count}");
            Console.WriteLine($"  Members added:         {totalAdded}");
            Console.WriteLine($"  Members updated:       {totalUpdated}");
            Console.WriteLine($"  Members terminated:    {totalTerminated}");
            Console.WriteLine($"  Errors:                {totalErrors}");

            await dbConn.ExecuteAsync(@"
                UPDATE rotary_org_sync_log
                SET FinishedAtUtc = UTC_TIMESTAMP(), Status = 'Completed',
                    InsertedCount = @Add, UpdatedCount = @Upd, DisabledCount = @Term, ErrorCount = @Err
                WHERE pk_id = @Id",
                new { Id = logId, Add = totalAdded, Upd = totalUpdated, Term = totalTerminated, Err = totalErrors });

            await SendEmailAsync(logId, elapsed, clubs.Count, totalAdded, totalUpdated, totalTerminated, totalErrors,
                added, updated, terminated, errors, perClub);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[{DateTime.Now:HH:mm:ss}] CLUB MEMBER SWEEP FAILED: {ex.Message}");
            _logger.LogError(ex, "Club member sweep FAILED");
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

    private static string BuildName(RotaryOrgClubMemberDto m)
    {
        // Per user 2026-07-09: use ONLY FirstName + MiddleName + LastName,
        // ignore LocalizedName / Prefix / Suffix so the display name in
        // member_master_profile.MemberName exactly matches what Rotary.org
        // sends as the individual name parts (e.g. "N. D. Joseph").
        // Applies to sweep, daily-delta, --club-id, and district-wise sync
        // paths (all funnel through this worker). BOD sync uses its own
        // BuildName and is intentionally NOT changed.
        var parts = new[] { m.FirstName, m.MiddleName, m.LastName }
            .Where(p => !string.IsNullOrWhiteSpace(p)).Select(p => p!.Trim()).ToList();
        return parts.Count > 0 ? string.Join(" ", parts) : "Unknown";
    }

    private static int? ComputeIsYouthFromDob(string? dobRaw)
    {
        // IsYouth = 1 if age between 18 and 40 (inclusive). Otherwise 0. Returns null if DOB unknown.
        if (string.IsNullOrWhiteSpace(dobRaw)) return null;
        var dobN = ParseRotaryDob(dobRaw);   // fixed MM/dd/yyyy parse — never culture-dependent
        if (dobN == null) return null;
        var dob = dobN.Value;
        var today = DateTime.Today;
        var age = today.Year - dob.Year;
        if (dob.Date > today.AddYears(-age)) age--;
        if (age >= 18 && age <= 40) return 1;
        return 0;
    }

    // Pulls primary email + primary phone from the profile response, plus the phone's
    // country code ("94") and country name ("Sri Lanka") used to resolve fk_primary_country_id.
    // NOTE: PhoneNumber is the LOCAL number (no dial code) — that's what login compares against;
    // the country is carried separately via CountryCode / PhoneCountryName.
    private static (string? Email, string? Phone, string? PhoneCountryCode, string? PhoneCountryName) ExtractPrimaryContact(RotaryOrgIndividualProfileResponse? p)
    {
        if (p == null) return (null, null, null, null);
        var email = p.Email?.FirstOrDefault(e => e.IsPrimary == true)?.EmailAddress
                 ?? p.Email?.FirstOrDefault()?.EmailAddress;
        var phone = p.Phone?.FirstOrDefault(ph => ph.IsPrimary == true);
        phone ??= p.Phone?.FirstOrDefault(ph => string.Equals(ph.PhoneType, "Mobile", StringComparison.OrdinalIgnoreCase));
        phone ??= p.Phone?.FirstOrDefault();
        return (email?.Trim(), CleanSyncedPhone(phone?.PhoneNumber, phone?.CountryCode, phone?.PhoneType),
                phone?.CountryCode?.Trim(), phone?.PhoneCountryName?.Trim());
    }

    // Resolve member's primary country from the profile phone: concat '+' to the CountryCode
    // ("94" → "+94") and EXACT-match country_master.PhoneCode. Exact match (not LIKE) is required
    // so "+94" (Sri Lanka) never collides with "+994" (Azerbaijan). Falls back to PhoneCountryName.
    // Returns null when nothing matches — caller then leaves fk_primary_country_id unchanged.
    private async Task<int?> ResolvePrimaryCountryIdAsync(MySqlConnection conn, MySqlTransaction? tx, string? phoneCountryCode, string? phoneCountryName)
    {
        var cc = new string((phoneCountryCode ?? "").Where(char.IsDigit).ToArray());
        if (!string.IsNullOrEmpty(cc))
        {
            var id = await conn.ExecuteScalarAsync<int?>(
                "SELECT pk_country_id FROM country_master WHERE PhoneCode = CONCAT('+', @Cc) AND isdeleted = 0 LIMIT 1",
                new { Cc = cc }, tx);
            if (id.HasValue) return id;
        }
        if (!string.IsNullOrWhiteSpace(phoneCountryName))
        {
            var id2 = await conn.ExecuteScalarAsync<int?>(
                "SELECT pk_country_id FROM country_master WHERE LOWER(CountryName) = LOWER(@Nm) AND isdeleted = 0 LIMIT 1",
                new { Nm = phoneCountryName.Trim() }, tx);
            if (id2.HasValue) return id2;
        }
        return null;
    }

    // Dynamic fallback country when the phone has no resolvable country code: the CLUB's own country
    // (club_master.Country → country_master). NO hardcoded India — a Sri Lanka club falls back to Sri Lanka.
    private async Task<int?> ResolveClubCountryIdAsync(MySqlConnection conn, MySqlTransaction? tx, int clubId)
    {
        return await conn.ExecuteScalarAsync<int?>(@"
            SELECT cm.pk_country_id
            FROM club_master c
            JOIN country_master cm ON LOWER(TRIM(cm.CountryName)) = LOWER(TRIM(c.Country)) AND cm.isdeleted = 0
            WHERE c.pk_club_id = @C LIMIT 1", new { C = clubId }, tx);
    }

    // The member's SECOND phone (distinct from the primary) → SecondaryMobileNumber + fk_secondary_country_id.
    // Returns nulls when the profile has fewer than two distinct phones.
    private static (string? Phone, string? Cc, string? Cn) ExtractSecondaryPhone(RotaryOrgIndividualProfileResponse? p)
    {
        var phones = p?.Phone;
        if (phones == null || phones.Count < 2) return (null, null, null);
        var primary = phones.FirstOrDefault(ph => ph.IsPrimary == true)
                   ?? phones.FirstOrDefault(ph => string.Equals(ph.PhoneType, "Mobile", StringComparison.OrdinalIgnoreCase))
                   ?? phones.FirstOrDefault();
        var secondary = phones.FirstOrDefault(ph => !ReferenceEquals(ph, primary)
                            && !string.IsNullOrWhiteSpace(ph.PhoneNumber)
                            && !string.Equals(ph.PhoneNumber?.Trim(), primary?.PhoneNumber?.Trim(), StringComparison.Ordinal));
        return (CleanSyncedPhone(secondary?.PhoneNumber, secondary?.CountryCode, secondary?.PhoneType),
                secondary?.CountryCode?.Trim(), secondary?.PhoneCountryName?.Trim());
    }

    // Free `mobile` from any SOFT-DELETED profile (other than excludeId) that still owns it, so a
    // reused number doesn't trip UNIQUE(PrimaryMobileNumber) on INSERT / re-activation. Moves that
    // deleted row's Primary -> Secondary (only when Secondary is empty, so nothing is lost) and nulls
    // its Primary. ACTIVE rows are never touched — a live duplicate is still caught by the collision
    // checks and diverted to the new member's secondary instead.
    private static async Task ReleaseSoftDeletedMobileAsync(MySqlConnection conn, MySqlTransaction? tx, string? mobile, int excludeId = 0)
    {
        if (string.IsNullOrWhiteSpace(mobile)) return;
        await conn.ExecuteAsync(@"
            UPDATE member_master_profile
            SET SecondaryMobileNumber = CASE WHEN SecondaryMobileNumber IS NULL OR SecondaryMobileNumber = ''
                                             THEN PrimaryMobileNumber ELSE SecondaryMobileNumber END,
                PrimaryMobileNumber = NULL,
                modified_date = NOW()
            WHERE TRIM(PrimaryMobileNumber) = TRIM(@Mobile)
              AND isdeleted = 1
              AND pk_member_master_profile_id <> @ExcludeId",
            new { Mobile = mobile.Trim(), ExcludeId = excludeId }, tx);
    }

    // Email twin of ReleaseSoftDeletedMobileAsync. EmailId is UNIQUE across ALL rows (incl. soft-deleted),
    // so a returning member (same email, new RotaryId) would hit a duplicate-key error on INSERT unless we
    // first free the email from the soft-deleted profile that still holds it: move its EmailId → SecondaryEmailId
    // and NULL the primary. Sync-only column; never surfaced anywhere.
    private static async Task ReleaseSoftDeletedEmailAsync(MySqlConnection conn, MySqlTransaction? tx, string? email, int excludeId = 0)
    {
        if (string.IsNullOrWhiteSpace(email)) return;
        await conn.ExecuteAsync(@"
            UPDATE member_master_profile
            SET SecondaryEmailId = CASE WHEN SecondaryEmailId IS NULL OR SecondaryEmailId = ''
                                        THEN EmailId ELSE SecondaryEmailId END,
                EmailId = NULL,
                modified_date = NOW()
            WHERE LOWER(TRIM(EmailId)) = LOWER(TRIM(@Email))
              AND isdeleted = 1
              AND pk_member_master_profile_id <> @ExcludeId",
            new { Email = email.Trim(), ExcludeId = excludeId }, tx);
    }

    private async Task<string> UpdateMemberAsync(MySqlConnection conn, int clubId, int memberId, RotaryOrgClubMemberDto api, CancellationToken ct)
    {
        // UPDATE path: fetch /profile to refresh name, DOB, gender, language, IsYouth, email,
        // primary mobile (with swap rule), and addresses. Skip-blank rule applies — never overwrite a
        // populated DB field with a blank Rotary.org value.
        var current = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT MemberName, EmailId, PrimaryMobileNumber, SecondaryMobileNumber,
                   BirthDate, Gender, PrimaryLanguage, IsYouth, fk_primary_country_id
            FROM member_master_profile
            WHERE pk_member_master_profile_id = @Id",
            new { Id = memberId });
        if (current == null) return "";

        RotaryOrgIndividualProfileResponse? profile = null;
        try { profile = await _api.GetIndividualProfileAsync(api.MemberId, ct); }
        catch (Exception ex) { _logger.LogWarning(ex, "Profile fetch failed for member {Mid} on UPDATE — falling back to basic fields", api.MemberId); }

        var ind = profile?.Individual;
        var (email, phone, phoneCc, phoneCn) = ExtractPrimaryContact(profile);
        var (phone2, phone2Cc, phone2Cn) = ExtractSecondaryPhone(profile);
        // Primary country = phone's own country code, else DYNAMIC fallback to the club's country (no hardcoded India).
        var primaryCountryId = await ResolvePrimaryCountryIdAsync(conn, null, phoneCc, phoneCn)
                               ?? await ResolveClubCountryIdAsync(conn, null, clubId);
        var secondaryCountryId = await ResolvePrimaryCountryIdAsync(conn, null, phone2Cc, phone2Cn);
        var phone2Safe = LooksLikeRealMobile(phone2) ? phone2 : null;
        var name = BuildName(api);
        var dobRaw = ParseRotaryDob(ind?.DateOfBirth);   // fixed MM/dd/yyyy parse — never culture-dependent
        // Pre-1900 sentinels (1753 etc) are NOT real DOBs — drop to NULL.
        var dob = (dobRaw.HasValue && dobRaw.Value.Year < 1900) ? (DateTime?)null : dobRaw;
        var gender = !string.IsNullOrWhiteSpace(ind?.Gender) ? ind!.Gender : ind?.GenderDescription;
        var lang = ind?.PrimaryLanguage;
        int? isYouth = null;
        if (ind?.YouthFlag.HasValue == true) isYouth = ind.YouthFlag.Value ? 1 : 0;
        else isYouth = ComputeIsYouthFromDob(ind?.DateOfBirth) ?? ComputeIsYouthFromBirthYear(api.BirthYear);

        var changes = new List<string>();
        var setClauses = new List<string>();
        var pars = new DynamicParameters();
        pars.Add("Id", memberId);

        if (!string.IsNullOrWhiteSpace(name) && !string.Equals((string?)current.MemberName, name, StringComparison.Ordinal))
        { setClauses.Add("MemberName = @MemberName"); pars.Add("MemberName", name); changes.Add("name"); }

        // Email rule (post-incident 2026-06-30): never overwrite a populated DB email; only fill when blank.
        // BUT the rotary.org value may be live on ANOTHER active member (UNIQUE(EmailId)) — blindly filling
        // it crashes the whole member (the Chandigarh / 201240 case). So: free it from soft-deleted holders;
        // if an ACTIVE member still holds it, park it in SecondaryEmailId + log instead of setting primary.
        if (!string.IsNullOrWhiteSpace(email) && string.IsNullOrWhiteSpace((string?)current.EmailId))
        {
            await ReleaseSoftDeletedEmailAsync(conn, null, email, excludeId: memberId);
            var eh = await conn.QueryFirstOrDefaultAsync<(int pk, string? name)?>(@"
                SELECT pk_member_master_profile_id AS pk, MemberName AS name FROM member_master_profile
                WHERE LOWER(TRIM(EmailId)) = LOWER(TRIM(@E)) AND isdeleted = 0 AND pk_member_master_profile_id <> @Self
                LIMIT 1", new { E = email, Self = memberId });
            bool takeAsPrimary = !eh.HasValue;
            if (eh.HasValue)
            {
                var ac = await conn.ExecuteScalarAsync<int>(
                    "SELECT COUNT(*) FROM club_members WHERE fk_member_master_profile_id = @Pk AND isdeleted = 0",
                    new { Pk = eh.Value.pk });
                if (ac == 0)
                {
                    // terminated holder (same person, old RotaryId) → free their email, this member takes it
                    await conn.ExecuteAsync(@"UPDATE member_master_profile
                        SET SecondaryEmailId = CASE WHEN SecondaryEmailId IS NULL OR SecondaryEmailId = '' THEN EmailId ELSE SecondaryEmailId END,
                            EmailId = NULL, modified_date = NOW() WHERE pk_member_master_profile_id = @Pk", new { Pk = eh.Value.pk });
                    takeAsPrimary = true;
                }
                else
                {
                    // active holder (e.g. spouse / shared email on rotary.org) → keep in secondary, log
                    setClauses.Add("SecondaryEmailId = CASE WHEN SecondaryEmailId IS NULL OR SecondaryEmailId = '' THEN @EmailId ELSE SecondaryEmailId END");
                    pars.Add("EmailId", email);
                    changes.Add("email-secondary-filled");
                    await LogSyncExceptionAsync(conn, null, "email_conflict", api.MemberId.ToString(), name, "EmailId", email, eh.Value.pk, eh.Value.name,
                        adminMessage: $"The email address provided by Rotary.org for this member is already in use by '{eh.Value.name}'. It has been saved as the member's alternate/secondary email — please verify and update manually.",
                        errorMessage: $"Email {email} already used by member {eh.Value.pk} ({eh.Value.name}). Update kept the value in secondary instead of primary.",
                        rawPayload: null, clubId: clubId, memberPk: memberId, inserted: true);
                }
            }
            if (takeAsPrimary)
            {
                setClauses.Add("EmailId = @EmailId");
                pars.Add("EmailId", email);
                changes.Add("email-filled");
            }
        }

        // Mobile rule (post-incident 2026-06-30): never overwrite a populated primary.
        //   - Primary blank + rotary.org has valid shape → fill primary
        //   - Primary populated AND rotary.org differs AND secondary blank → fill secondary
        //     (preserves the alternate number; admin can review later)
        //   - Otherwise ignore rotary.org mobile entirely
        // Country-agnostic shape check (LooksLikeRealMobile) rejects junk values
        // before they touch the DB — works for India 10-digit, Sri Lanka 9-digit, etc.
        if (LooksLikeRealMobile(phone))
        {
            var dbPrimary = (string?)current.PrimaryMobileNumber;
            var dbSecondary = (string?)current.SecondaryMobileNumber;
            if (string.IsNullOrWhiteSpace(dbPrimary))
            {
                // Free the number from any soft-deleted row first so this fill doesn't hit UNIQUE(PrimaryMobileNumber).
                await ReleaseSoftDeletedMobileAsync(conn, null, phone, excludeId: memberId);
                // If an ACTIVE member still holds this number, park it in secondary instead of primary
                // (same class of bug as the email path — avoids a UNIQUE(PrimaryMobileNumber) crash).
                var mh = await conn.QueryFirstOrDefaultAsync<(int pk, string? name)?>(@"
                    SELECT pk_member_master_profile_id AS pk, MemberName AS name FROM member_master_profile
                    WHERE TRIM(PrimaryMobileNumber) = TRIM(@P) AND isdeleted = 0 AND pk_member_master_profile_id <> @Self LIMIT 1",
                    new { P = phone, Self = memberId });
                var mobileActiveHolder = mh.HasValue && await conn.ExecuteScalarAsync<int>(
                    "SELECT COUNT(*) FROM club_members WHERE fk_member_master_profile_id = @Pk AND isdeleted = 0", new { Pk = mh!.Value.pk }) > 0;
                if (mobileActiveHolder)
                {
                    if (string.IsNullOrWhiteSpace(dbSecondary))
                    {
                        setClauses.Add("SecondaryMobileNumber = @SecondaryMobile");
                        pars.Add("SecondaryMobile", phone);
                        changes.Add("mobile-secondary-filled");
                    }
                    await LogSyncExceptionAsync(conn, null, "mobile_conflict", api.MemberId.ToString(), name, "PrimaryMobileNumber", phone, mh!.Value.pk, mh.Value.name,
                        adminMessage: $"The mobile number provided by Rotary.org for this member is already in use by '{mh.Value.name}'. It has been saved as the member's alternate/secondary mobile — please verify and update manually.",
                        errorMessage: $"Mobile {phone} already used by member {mh.Value.pk} ({mh.Value.name}). Update kept the value in secondary instead of primary.",
                        rawPayload: null, clubId: clubId, memberPk: memberId, inserted: true);
                }
                else
                {
                    setClauses.Add("PrimaryMobileNumber = @PrimaryMobile");
                    pars.Add("PrimaryMobile", phone);
                    changes.Add("mobile-filled");
                }
            }
            else if (!string.Equals(dbPrimary, phone, StringComparison.Ordinal)
                     && string.IsNullOrWhiteSpace(dbSecondary))
            {
                setClauses.Add("SecondaryMobileNumber = @SecondaryMobile");
                pars.Add("SecondaryMobile", phone);
                changes.Add("mobile-secondary-filled");
            }
            // else: primary populated + secondary populated OR matches → ignore
        }

        // Defensive: pre-1900 dates from Rotary.org (or any sentinel like 0001-01-01)
        // are NOT real DOBs — skip the write so the column stays NULL instead of
        // poisoning the row with a fake birthday that would show up in reports.
        if (dob.HasValue && dob.Value.Year >= 1900
            && (current.BirthDate == null || ((DateTime)current.BirthDate).Date != dob.Value.Date))
        { setClauses.Add("BirthDate = @BirthDate"); pars.Add("BirthDate", dob.Value); changes.Add("dob"); }

        if (!string.IsNullOrWhiteSpace(gender) && !string.Equals((string?)current.Gender, gender, StringComparison.OrdinalIgnoreCase))
        { setClauses.Add("Gender = @Gender"); pars.Add("Gender", gender); changes.Add("gender"); }

        if (!string.IsNullOrWhiteSpace(lang) && !string.Equals((string?)current.PrimaryLanguage, lang, StringComparison.OrdinalIgnoreCase))
        { setClauses.Add("PrimaryLanguage = @PrimaryLanguage"); pars.Add("PrimaryLanguage", lang); changes.Add("language"); }

        if (isYouth.HasValue && (int)current.IsYouth != isYouth.Value)
        { setClauses.Add("IsYouth = @IsYouth"); pars.Add("IsYouth", isYouth.Value); changes.Add("youth"); }

        // Primary country: phone's own country code, else the club's country (dynamic — no hardcoded India).
        // Fixes members previously stuck on India (fk_primary_country_id=1) because they had no phone country code.
        if (primaryCountryId.HasValue
            && (current.fk_primary_country_id == null || (int)current.fk_primary_country_id != primaryCountryId.Value))
        { setClauses.Add("fk_primary_country_id = @CountryId"); pars.Add("CountryId", primaryCountryId.Value); changes.Add("country"); }

        // Secondary country: from the member's 2nd phone only (dynamic). Set whenever it resolves.
        if (secondaryCountryId.HasValue)
        { setClauses.Add("fk_secondary_country_id = @SecondaryCountryId"); pars.Add("SecondaryCountryId", secondaryCountryId.Value); changes.Add("secondary-country"); }

        // Secondary mobile from the 2nd phone — fill only when DB secondary is blank and the mobile rule
        // above didn't already fill it (avoids a duplicate SET on SecondaryMobileNumber).
        if (!string.IsNullOrWhiteSpace(phone2Safe)
            && string.IsNullOrWhiteSpace((string?)current.SecondaryMobileNumber)
            && !changes.Contains("mobile-secondary-filled"))
        { setClauses.Add("SecondaryMobileNumber = @Phone2"); pars.Add("Phone2", phone2Safe); changes.Add("mobile2-filled"); }

        if (setClauses.Count > 0)
        {
            setClauses.Add("modified_date = NOW()");
            var sql = $"UPDATE member_master_profile SET {string.Join(", ", setClauses)} WHERE pk_member_master_profile_id = @Id";
            await conn.ExecuteAsync(sql, pars);
        }

        // Address upsert (independent of profile column changes — addresses may change without other fields)
        if (await UpsertMemberAddressesAsync(conn, null, memberId, profile?.Address))
            changes.Add("address");

        // Per-club honorary refresh (post 2026-06-26 schema move — IsHonoraryMember lives
        // on club_members now, NOT member_master_profile). A member can be Honorary in club A
        // and Regular in club B, so we refresh THIS club's row from rotary.org MemberType.
        // Only writes when the value differs from current — keeps the changes list accurate.
        var isHonForClub = string.Equals(api.MemberType, "Honorary Member", StringComparison.OrdinalIgnoreCase) ? 1 : 0;
        var currentHon = await conn.ExecuteScalarAsync<int?>(@"
            SELECT IsHonoraryMember FROM club_members
            WHERE fk_club_id = @ClubId AND fk_member_master_profile_id = @MemberId
              AND COALESCE(isdeleted, 0) = 0
            LIMIT 1",
            new { ClubId = clubId, MemberId = memberId });
        if (currentHon.HasValue && currentHon.Value != isHonForClub)
        {
            await conn.ExecuteAsync(@"
                UPDATE club_members SET IsHonoraryMember = @IsHon, modified_date = NOW()
                WHERE fk_club_id = @ClubId AND fk_member_master_profile_id = @MemberId
                  AND COALESCE(isdeleted, 0) = 0",
                new { ClubId = clubId, MemberId = memberId, IsHon = isHonForClub });
            changes.Add(isHonForClub == 1 ? "honorary-set" : "honorary-cleared");
        }

        // Joining Date (club_members.JoinedDate) refresh from Rotary.org AdmissionDate.
        // AdmissionDate IS the member's joining date for THIS club (per-club). The UPDATE
        // path previously never synced it, so EXISTING members kept a blank JoinedDate even
        // when rotary.org had the date — only newly ADDed members got it. The API value wins
        // when present; an API blank leaves the existing DB date untouched. Done in C# (not a
        // blind UPDATE) so we only write on an actual change and can report it.
        if (api.AdmissionDate.HasValue)
        {
            var currentJoined = await conn.ExecuteScalarAsync<DateTime?>(@"
                SELECT JoinedDate FROM club_members
                WHERE fk_club_id = @ClubId AND fk_member_master_profile_id = @MemberId
                  AND COALESCE(isdeleted, 0) = 0
                LIMIT 1",
                new { ClubId = clubId, MemberId = memberId });
            if (!currentJoined.HasValue || currentJoined.Value.Date != api.AdmissionDate.Value.Date)
            {
                await conn.ExecuteAsync(@"
                    UPDATE club_members SET JoinedDate = @Joined, modified_date = NOW()
                    WHERE fk_club_id = @ClubId AND fk_member_master_profile_id = @MemberId
                      AND COALESCE(isdeleted, 0) = 0",
                    new { ClubId = clubId, MemberId = memberId, Joined = api.AdmissionDate.Value });
                changes.Add("joining-date");
            }
        }

        return string.Join(", ", changes);
    }

    private async Task<int> AddMemberAsync(MySqlConnection conn, int clubId, RotaryOrgClubMemberDto api, CancellationToken ct)
    {
        var rotaryId = api.MemberId.ToString();
        var nameForExLog = BuildName(api);

        // Guard: missing/blank RotaryId from rotary.org → cannot identify, skip + log
        if (string.IsNullOrWhiteSpace(rotaryId) || rotaryId == "0")
        {
            await LogSyncExceptionAsync(conn, null, "missing_rotary_id", null, nameForExLog,
                null, null, null, null,
                adminMessage: "This member could not be added because Rotary.org did not provide their Rotary ID. Please verify the member on Rotary.org and re-run the sync once the ID is corrected.",
                errorMessage: "Rotary.org returned a member with no RotaryId — cannot identify, skipped.",
                rawPayload: null, clubId: clubId, memberPk: null, inserted: false);
            return 0;
        }

        using var tx = await conn.BeginTransactionAsync(ct);
        try
        {
            var name = nameForExLog;

            // ADD path: fetch the FULL profile from /individuals/{id}/profile to get email/mobile/DOB.
            // Profile fetch is bounded by NEW members per run, so it's acceptable.
            RotaryOrgIndividualProfileResponse? profile = null;
            try
            {
                profile = await _api.GetIndividualProfileAsync(api.MemberId, ct);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Profile fetch failed for new member {Mid} — proceeding with basic data only", api.MemberId);
            }

            var ind = profile?.Individual;
            var (email, phone, phoneCc, phoneCn) = ExtractPrimaryContact(profile);
            var (phone2, phone2Cc, phone2Cn) = ExtractSecondaryPhone(profile);
            // Primary country = the phone's own country code, else DYNAMIC fallback to the club's country
            // (no hardcoded India). Secondary country = the member's 2nd phone only (NULL if none).
            var primaryCountryId = await ResolvePrimaryCountryIdAsync(conn, tx, phoneCc, phoneCn)
                                   ?? await ResolveClubCountryIdAsync(conn, tx, clubId);
            var secondaryCountryId = await ResolvePrimaryCountryIdAsync(conn, tx, phone2Cc, phone2Cn);
            var phone2Safe = LooksLikeRealMobile(phone2) ? phone2 : null;
            var dobRaw = ParseRotaryDob(ind?.DateOfBirth);   // fixed MM/dd/yyyy parse — never culture-dependent
            // Pre-1900 sentinels (1753 from SQL-Server-origin data, 0001 from .NET defaults)
            // are not real DOBs — coerce to NULL so neither the INSERT nor the UPDATE
            // below writes a garbage birthday into member_master_profile.
            var dob = (dobRaw.HasValue && dobRaw.Value.Year < 1900) ? (DateTime?)null : dobRaw;
            var gender = !string.IsNullOrWhiteSpace(ind?.Gender) ? ind!.Gender : ind?.GenderDescription;
            var lang = ind?.PrimaryLanguage;
            // Prefer profile YouthFlag if set; else compute from DOB; else fall back to BirthYear column from API.
            int? isYouthN = null;
            if (ind?.YouthFlag.HasValue == true) isYouthN = ind.YouthFlag.Value ? 1 : 0;
            else isYouthN = ComputeIsYouthFromDob(ind?.DateOfBirth) ?? ComputeIsYouthFromBirthYear(api.BirthYear);
            var isYouth = isYouthN ?? 0;

            // Re-use lookup: RotaryId matches an EXISTING member_master_profile row,
            // regardless of isdeleted status. Handles TWO cases with the same code path:
            //   (a) Soft-deleted member (isdeleted=1) → re-activate them.
            //   (b) ACTIVE member who moved clubs (isdeleted=0) → reuse their profile;
            //       the club_members INSERT below will add a new row for the new club.
            //
            // Fix 2026-07-08 (member 9439037 case): previously this query filtered
            // `isdeleted = 1` only. When a member moved from club 82067 → 35436 on
            // rotary.org, we saw him missing from THIS club's dbByRotaryId map, fell
            // through to INSERT, and hit UNIQUE(RotaryId) constraint → error sheet.
            // Now we reuse the existing profile; the SOFT-DELETE pass in the OLD club's
            // next sweep will clean up his stale club_members row for that club.
            var existingId = await conn.ExecuteScalarAsync<int?>(@"
                SELECT pk_member_master_profile_id FROM member_master_profile
                WHERE RotaryId = @Rid
                ORDER BY pk_member_master_profile_id DESC LIMIT 1",
                new { Rid = rotaryId }, tx);

            // Pre-INSERT collision checks — UNIQUE on EmailId / PrimaryMobileNumber would fail
            // mid-INSERT and dump the whole transaction. We pre-check and substitute NULL +
            // log to sync_exception_log so the member is still inserted (no data loss) and
            // admin can see the conflict.
            //
            // Only run when we're going to INSERT a new profile row. If existingId is set
            // (re-activation OR reused-because-moved-clubs), the mobile/email would collide
            // with the member's OWN existing record — skip the check. The UPDATE below uses
            // COALESCE(EmailId, @Email) / COALESCE(PrimaryMobileNumber, @Phone) so a value
            // stays put if already present, and gets set if the DB row had NULL.
            string? safePhone = LooksLikeRealMobile(phone) ? phone : null;
            string? safeEmail = string.IsNullOrWhiteSpace(email) ? null : email;
            string? secondaryFromCollision = null;
            string? secondaryEmailFromCollision = null;

            if (!existingId.HasValue)
            {
                // Mobile shape rejected → log
                if (!string.IsNullOrWhiteSpace(phone) && safePhone == null)
                {
                    await LogSyncExceptionAsync(conn, tx, "invalid_mobile_format", rotaryId, name,
                        "PrimaryMobileNumber", phone, null, null,
                        adminMessage: $"The mobile number from Rotary.org for this member is not a valid number (it doesn't look like a real mobile). The member has been added without a mobile — please verify their correct number on Rotary.org and update manually.",
                        errorMessage: "Mobile from rotary.org failed shape check (8-12 digits, not all-same, no 000-prefix). Inserted with NULL primary.",
                        rawPayload: null, clubId: clubId, memberPk: null, inserted: true);
                }

                // Mobile collision with another ROW member → set NULL + log + push to secondary
                if (safePhone != null)
                {
                    // Free the number from any SOFT-DELETED row first (its Primary -> Secondary, Primary nulled)
                    // so a reused number doesn't collide with a deleted profile. The active-holder check below
                    // then only fires on a genuine live conflict.
                    await ReleaseSoftDeletedMobileAsync(conn, tx, safePhone);

                    var mobileHolder = await conn.QueryFirstOrDefaultAsync<(int pk, string? name)?>(@"
                        SELECT pk_member_master_profile_id AS pk, MemberName AS name
                        FROM member_master_profile
                        WHERE TRIM(PrimaryMobileNumber) = TRIM(@P) AND isdeleted = 0
                        LIMIT 1",
                        new { P = safePhone }, tx);
                    if (mobileHolder.HasValue)
                    {
                        // Is the current holder a TERMINATED member (profile still alive, but NO active
                        // club membership anywhere)? That's the "same person re-joined under a NEW RotaryId"
                        // case — free the number from them (Primary -> Secondary) so THIS newcomer can take
                        // it as primary. Only a genuinely ACTIVE holder (e.g. a spouse sharing the number)
                        // keeps it, and the newcomer's value goes to secondary + a conflict is logged.
                        var holderActiveClubs = await conn.ExecuteScalarAsync<int>(@"
                            SELECT COUNT(*) FROM club_members
                            WHERE fk_member_master_profile_id = @Pk AND isdeleted = 0",
                            new { Pk = mobileHolder.Value.pk }, tx);
                        if (holderActiveClubs == 0)
                        {
                            await conn.ExecuteAsync(@"
                                UPDATE member_master_profile
                                SET SecondaryMobileNumber = CASE WHEN SecondaryMobileNumber IS NULL OR SecondaryMobileNumber = ''
                                                                 THEN PrimaryMobileNumber ELSE SecondaryMobileNumber END,
                                    PrimaryMobileNumber = NULL,
                                    modified_date = NOW()
                                WHERE pk_member_master_profile_id = @Pk",
                                new { Pk = mobileHolder.Value.pk }, tx);
                            // safePhone stays set → the newcomer takes it as their primary below.
                        }
                        else
                        {
                            secondaryFromCollision = safePhone;  // preserve in secondary (no data loss)
                            await LogSyncExceptionAsync(conn, tx, "mobile_conflict", rotaryId, name,
                                "PrimaryMobileNumber", safePhone, mobileHolder.Value.pk, mobileHolder.Value.name,
                                adminMessage: $"The mobile number provided by Rotary.org for this member is already in use by '{mobileHolder.Value.name}'. " +
                                    "This often happens when husband and wife share the same mobile number on Rotary.org. " +
                                    "The new member has been added without a primary mobile (the Rotary.org value has been saved as their alternate/secondary mobile) — " +
                                    "please verify the correct mobile and update it manually.",
                                errorMessage: $"Mobile {safePhone} already used by member {mobileHolder.Value.pk} ({mobileHolder.Value.name}). " +
                                    "Inserted with NULL primary, moved value to secondary.",
                                rawPayload: null, clubId: clubId, memberPk: null, inserted: true);
                            safePhone = null;
                        }
                    }
                }

                // Email collision with another ROW member → mirror the primary/secondary MOBILE rule.
                // EmailId is UNIQUE across ALL rows (incl. soft-deleted), so without this a returning member
                // (same email, new RotaryId) hard-fails the INSERT with a duplicate-key error and is dropped.
                if (safeEmail != null)
                {
                    // Free the email from any SOFT-DELETED row first (its EmailId -> SecondaryEmailId, primary
                    // nulled) so a reused email doesn't collide with a deleted profile. The active-holder check
                    // below then only fires on a genuine live conflict.
                    await ReleaseSoftDeletedEmailAsync(conn, tx, safeEmail);

                    var emailHolder = await conn.QueryFirstOrDefaultAsync<(int pk, string? name)?>(@"
                        SELECT pk_member_master_profile_id AS pk, MemberName AS name
                        FROM member_master_profile
                        WHERE LOWER(TRIM(EmailId)) = LOWER(TRIM(@E)) AND isdeleted = 0
                        LIMIT 1",
                        new { E = safeEmail }, tx);
                    if (emailHolder.HasValue)
                    {
                        // Is the holder a TERMINATED member (profile alive, but NO active club anywhere)? That's
                        // the "same person re-joined under a NEW RotaryId" case — free the email from them
                        // (Primary -> Secondary) so THIS newcomer can take it as primary. Only a genuinely ACTIVE
                        // holder (e.g. a spouse sharing the email) keeps it, and the newcomer's value goes to
                        // secondary + a conflict is logged.
                        var holderActiveClubs = await conn.ExecuteScalarAsync<int>(@"
                            SELECT COUNT(*) FROM club_members
                            WHERE fk_member_master_profile_id = @Pk AND isdeleted = 0",
                            new { Pk = emailHolder.Value.pk }, tx);
                        if (holderActiveClubs == 0)
                        {
                            await conn.ExecuteAsync(@"
                                UPDATE member_master_profile
                                SET SecondaryEmailId = CASE WHEN SecondaryEmailId IS NULL OR SecondaryEmailId = ''
                                                            THEN EmailId ELSE SecondaryEmailId END,
                                    EmailId = NULL,
                                    modified_date = NOW()
                                WHERE pk_member_master_profile_id = @Pk",
                                new { Pk = emailHolder.Value.pk }, tx);
                            // safeEmail stays set → the newcomer takes it as their primary below.
                        }
                        else
                        {
                            secondaryEmailFromCollision = safeEmail;  // preserve in secondary (no data loss)
                            await LogSyncExceptionAsync(conn, tx, "email_conflict", rotaryId, name,
                                "EmailId", safeEmail, emailHolder.Value.pk, emailHolder.Value.name,
                                adminMessage: $"The email address provided by Rotary.org for this member is already in use by '{emailHolder.Value.name}'. " +
                                    "This often happens when husband and wife share the same email on Rotary.org. " +
                                    "The new member has been added without a primary email (the Rotary.org value has been saved as their alternate/secondary email) — " +
                                    "please verify the correct email and update it manually.",
                                errorMessage: $"Email {safeEmail} already used by member {emailHolder.Value.pk} ({emailHolder.Value.name}). " +
                                    "Inserted with NULL primary email, moved value to secondary.",
                                rawPayload: null, clubId: clubId, memberPk: null, inserted: true);
                            safeEmail = null;
                        }
                    }
                }
            }

            int memberId;
            if (existingId.HasValue && existingId.Value > 0)
            {
                // Re-activation: COALESCE keeps existing DB values where rotary.org gives blanks,
                // and uses safePhone/safeEmail (NULL on collision/invalid) — so we never accidentally
                // overwrite a populated email/mobile with rotary.org junk on re-activation either.
                memberId = existingId.Value;
                // Free the number from any OTHER soft-deleted row so the COALESCE fill below (when this
                // row's primary is blank) doesn't hit UNIQUE(PrimaryMobileNumber).
                await ReleaseSoftDeletedMobileAsync(conn, tx, safePhone, excludeId: memberId);

                // Reactivation/refresh collision guard (the Chandigarh / member 201240 case): the incoming
                // email/mobile may be live on ANOTHER active member. The COALESCE fills below would then hit
                // UNIQUE(EmailId)/UNIQUE(PrimaryMobileNumber) and the whole member would fail. Apply the same
                // primary→secondary rule as the insert path, excluding THIS member's own row.
                if (safeEmail != null)
                {
                    await ReleaseSoftDeletedEmailAsync(conn, tx, safeEmail, excludeId: memberId);
                    var eh = await conn.QueryFirstOrDefaultAsync<(int pk, string? name)?>(@"
                        SELECT pk_member_master_profile_id AS pk, MemberName AS name FROM member_master_profile
                        WHERE LOWER(TRIM(EmailId)) = LOWER(TRIM(@E)) AND isdeleted = 0 AND pk_member_master_profile_id <> @Self
                        LIMIT 1", new { E = safeEmail, Self = memberId }, tx);
                    if (eh.HasValue)
                    {
                        var ac = await conn.ExecuteScalarAsync<int>(
                            "SELECT COUNT(*) FROM club_members WHERE fk_member_master_profile_id = @Pk AND isdeleted = 0",
                            new { Pk = eh.Value.pk }, tx);
                        if (ac == 0)
                        {
                            // terminated holder → free the email so this member can keep it as primary
                            await conn.ExecuteAsync(@"UPDATE member_master_profile
                                SET SecondaryEmailId = CASE WHEN SecondaryEmailId IS NULL OR SecondaryEmailId = '' THEN EmailId ELSE SecondaryEmailId END,
                                    EmailId = NULL, modified_date = NOW()
                                WHERE pk_member_master_profile_id = @Pk", new { Pk = eh.Value.pk }, tx);
                        }
                        else
                        {
                            secondaryEmailFromCollision = safeEmail;
                            await LogSyncExceptionAsync(conn, tx, "email_conflict", rotaryId, name, "EmailId", safeEmail, eh.Value.pk, eh.Value.name,
                                adminMessage: $"The email address provided by Rotary.org for this member is already in use by '{eh.Value.name}'. The member was kept without a primary email (the Rotary.org value is saved as their alternate/secondary email) — please verify and update manually.",
                                errorMessage: $"Email {safeEmail} already used by member {eh.Value.pk} ({eh.Value.name}). Reactivation kept NULL primary email, moved value to secondary.",
                                rawPayload: null, clubId: clubId, memberPk: memberId, inserted: true);
                            safeEmail = null;
                        }
                    }
                }
                if (safePhone != null)
                {
                    var mh = await conn.QueryFirstOrDefaultAsync<(int pk, string? name)?>(@"
                        SELECT pk_member_master_profile_id AS pk, MemberName AS name FROM member_master_profile
                        WHERE TRIM(PrimaryMobileNumber) = TRIM(@P) AND isdeleted = 0 AND pk_member_master_profile_id <> @Self
                        LIMIT 1", new { P = safePhone, Self = memberId }, tx);
                    if (mh.HasValue)
                    {
                        var ac = await conn.ExecuteScalarAsync<int>(
                            "SELECT COUNT(*) FROM club_members WHERE fk_member_master_profile_id = @Pk AND isdeleted = 0",
                            new { Pk = mh.Value.pk }, tx);
                        if (ac == 0)
                        {
                            await conn.ExecuteAsync(@"UPDATE member_master_profile
                                SET SecondaryMobileNumber = CASE WHEN SecondaryMobileNumber IS NULL OR SecondaryMobileNumber = '' THEN PrimaryMobileNumber ELSE SecondaryMobileNumber END,
                                    PrimaryMobileNumber = NULL, modified_date = NOW()
                                WHERE pk_member_master_profile_id = @Pk", new { Pk = mh.Value.pk }, tx);
                        }
                        else
                        {
                            secondaryFromCollision = safePhone;
                            await LogSyncExceptionAsync(conn, tx, "mobile_conflict", rotaryId, name, "PrimaryMobileNumber", safePhone, mh.Value.pk, mh.Value.name,
                                adminMessage: $"The mobile number provided by Rotary.org for this member is already in use by '{mh.Value.name}'. The member was kept without a primary mobile (the Rotary.org value is saved as their alternate/secondary mobile) — please verify and update manually.",
                                errorMessage: $"Mobile {safePhone} already used by member {mh.Value.pk} ({mh.Value.name}). Reactivation kept NULL primary mobile, moved value to secondary.",
                                rawPayload: null, clubId: clubId, memberPk: memberId, inserted: true);
                            safePhone = null;
                        }
                    }
                }
                await conn.ExecuteAsync(@"
                    UPDATE member_master_profile SET
                        isdeleted = 0, deleted_by = NULL, deleted_date = NULL,
                        RotaryId = @Rid,
                        MemberName = @Name,
                        EmailId = COALESCE(EmailId, @Email),
                        SecondaryEmailId = COALESCE(SecondaryEmailId, @SecondaryEmail),
                        PrimaryMobileNumber = COALESCE(PrimaryMobileNumber, @Phone),
                        SecondaryMobileNumber = COALESCE(SecondaryMobileNumber, @SecondaryPhone),
                        BirthDate = COALESCE(@Dob, BirthDate),
                        Gender = COALESCE(@Gender, Gender),
                        PrimaryLanguage = COALESCE(@Lang, PrimaryLanguage),
                        IsYouth = @IsYouth,
                        fk_primary_country_id = COALESCE(@CountryId, fk_primary_country_id),
                        fk_secondary_country_id = COALESCE(@SecondaryCountryId, fk_secondary_country_id),
                        modified_date = NOW()
                    WHERE pk_member_master_profile_id = @Id",
                    new { Id = memberId, Rid = rotaryId, Name = name, Email = safeEmail, SecondaryEmail = secondaryEmailFromCollision, Phone = safePhone,
                          SecondaryPhone = secondaryFromCollision ?? phone2Safe, Dob = dob, Gender = gender, Lang = lang, IsYouth = isYouth,
                          CountryId = primaryCountryId, SecondaryCountryId = (secondaryFromCollision != null ? primaryCountryId : secondaryCountryId) }, tx);

                // Same person returning: un-delete the address + family rows soft-deleted at their
                // last-club termination. Rotary.org does NOT resupply family data, so we RESTORE the
                // rows rather than re-fetch. (Addresses are also refreshed from /profile just below.)
                await conn.ExecuteAsync(@"
                    UPDATE member_address_details SET isdeleted = 0, modified_date = NOW()
                    WHERE fk_member_master_profile_id = @Id AND isdeleted = 1",
                    new { Id = memberId }, tx);
                // Restore ONLY the batch soft-deleted at the last termination, and only when no live
                // family rows exist - restoring every isdeleted=1 row revived old copies from past saves.
                await conn.ExecuteAsync(@"
                    UPDATE member_family_details f
                    JOIN (SELECT MAX(modified_date) AS last_del FROM member_family_details
                          WHERE fk_member_master_profile_id = @Id AND isdeleted = 1) b
                      ON f.modified_date = b.last_del
                    SET f.isdeleted = 0, f.modified_date = NOW()
                    WHERE f.fk_member_master_profile_id = @Id AND f.isdeleted = 1
                      AND NOT EXISTS (SELECT 1 FROM (SELECT fk_member_master_profile_id FROM member_family_details
                                      WHERE fk_member_master_profile_id = @Id AND COALESCE(isdeleted, 0) = 0) live)",
                    new { Id = memberId }, tx);
            }
            else
            {
                memberId = await conn.ExecuteScalarAsync<int>(@"
                    INSERT INTO member_master_profile
                        (MemberName, RotaryId, EmailId, SecondaryEmailId, PrimaryMobileNumber, SecondaryMobileNumber, BirthDate, Gender, PrimaryLanguage, IsYouth, fk_primary_country_id, fk_secondary_country_id, IsPersonalDetailsVisible, created_date, isdeleted)
                    VALUES
                        (@Name, @Rid, @Email, @SecondaryEmail, @Phone, @SecondaryPhone, @Dob, @Gender, @Lang, @IsYouth, @CountryId, @SecondaryCountryId, 1, NOW(), 0);
                    SELECT LAST_INSERT_ID();",
                    new
                    {
                        Name = name,
                        Rid = rotaryId,
                        Email = safeEmail,
                        SecondaryEmail = secondaryEmailFromCollision,
                        Phone = safePhone,
                        SecondaryPhone = secondaryFromCollision ?? phone2Safe,
                        Dob = dob,
                        Gender = gender,
                        Lang = lang,
                        IsYouth = isYouth,
                        CountryId = primaryCountryId,
                        SecondaryCountryId = (secondaryFromCollision != null ? primaryCountryId : secondaryCountryId),
                    }, tx);
            }
            // Honorary status moved to club_members 2026-06-26 — write it on the per-club row below.
            var isHonForClub = string.Equals(api.MemberType, "Honorary Member", StringComparison.OrdinalIgnoreCase) ? 1 : 0;

            // Upsert addresses from /profile (Home → Residential, Business → Business)
            await UpsertMemberAddressesAsync(conn, tx, memberId, profile?.Address);

            // Insert/re-activate club_members for this club
            var existingCm = await conn.QueryFirstOrDefaultAsync<(int pk_id, int isdeleted)>(@"
                SELECT pk_club_member_id AS pk_id, isdeleted
                FROM club_members
                WHERE fk_club_id = @ClubId AND fk_member_master_profile_id = @MemberId
                ORDER BY pk_club_member_id DESC LIMIT 1",
                new { ClubId = clubId, MemberId = memberId }, tx);

            var joinedDate = api.AdmissionDate;
            if (existingCm.pk_id == 0)
            {
                await conn.ExecuteAsync(@"
                    INSERT INTO club_members (fk_club_id, fk_member_master_profile_id, JoinedDate, IsActive, IsHonoraryMember, created_date, isdeleted)
                    VALUES (@ClubId, @MemberId, @Joined, 1, @IsHon, NOW(), 0)",
                    new { ClubId = clubId, MemberId = memberId, Joined = joinedDate, IsHon = isHonForClub }, tx);
            }
            else if (existingCm.isdeleted == 1)
            {
                await conn.ExecuteAsync(@"
                    UPDATE club_members
                    SET isdeleted = 0, IsActive = 1, JoinedDate = @Joined,
                        IsHonoraryMember = @IsHon,
                        TerminationDate = NULL, TerminationReason = NULL,
                        deleted_by = NULL, deleted_date = NULL, modified_date = NOW()
                    WHERE pk_club_member_id = @Id",
                    new { Id = existingCm.pk_id, Joined = joinedDate, IsHon = isHonForClub }, tx);
            }
            else
            {
                // Active row — refresh honorary status + Joining Date (AdmissionDate) from
                // Rotary.org. COALESCE keeps an existing date when the API omits one, but
                // otherwise backfills/keeps JoinedDate in sync (previously this branch never
                // set JoinedDate, so existing members stayed blank).
                await conn.ExecuteAsync(@"
                    UPDATE club_members
                    SET IsHonoraryMember = @IsHon,
                        JoinedDate = COALESCE(@Joined, JoinedDate),
                        modified_date = NOW()
                    WHERE pk_club_member_id = @Id",
                    new { Id = existingCm.pk_id, IsHon = isHonForClub, Joined = joinedDate }, tx);
            }

            // Re-sync recovery (non-sync cascade): if this member's club-scoped roles were
            // soft-deleted when the club went non-sync, UNDELETE them now that the club is
            // syncing again (Member / Admin / ClubModerator / AG for THIS club). No-op for a
            // genuinely new member (no soft-deleted rows). BOD/DC stay soft-deleted by design.
            await conn.ExecuteAsync(@"
                UPDATE member_roles
                SET isdeleted = 0, IsActive = 1, RevokedDate = NULL, modified_date = NOW()
                WHERE fk_member_master_profile_id = @MemberId
                  AND fk_club_id = @ClubId
                  AND isdeleted = 1",
                new { MemberId = memberId, ClubId = clubId }, tx);

            // Default Member role with NOT EXISTS guard
            await conn.ExecuteAsync(@"
                INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, AssignedBy, IsActive, isdeleted, AssignedDate)
                SELECT @MemberId, 1, @MemberId, 1, 0, NOW() FROM DUAL
                WHERE NOT EXISTS (
                    SELECT 1 FROM member_roles
                    WHERE fk_member_master_profile_id = @MemberId
                      AND fk_role_id = 1 AND IsActive = 1 AND isdeleted = 0
                )",
                new { MemberId = memberId }, tx);

            await tx.CommitAsync(ct);
            return memberId;
        }
        catch (Exception ex)
        {
            try { await tx.RollbackAsync(ct); } catch { }

            // Surface the error to admin via sync_exception_log. Re-throw so the caller's
            // counters still record the failure (sweep continues with next member).
            await LogSyncExceptionAsync(conn, null, "insert_error", rotaryId, nameForExLog,
                null, null, null, null,
                adminMessage: "This member could not be added because of an unexpected issue during the save. Please report this to the developer team with the member's Rotary ID so they can investigate.",
                errorMessage: ex.Message,
                rawPayload: null, clubId: clubId, memberPk: null, inserted: false);
            throw;
        }
    }

    private static int? ComputeIsYouthFromBirthYear(string? birthYear)
    {
        if (string.IsNullOrWhiteSpace(birthYear)) return null;
        if (!int.TryParse(birthYear.Trim(), out var year)) return null;
        var age = DateTime.Today.Year - year;
        if (age >= 18 && age <= 40) return 1;
        return 0;
    }

    /// <summary>
    /// UPSERT addresses from /individuals/{id}/profile into member_address_details, one row per AddressType.
    /// Maps Rotary.org "Home" → "Residential", "Business" → "Business". Skips blank rows and other types.
    /// Returns true if any row was inserted or updated.
    ///
    /// Step 1: Soft-delete duplicates — keep ONLY the latest active row per AddressType (handles legacy
    /// data where prior sync runs created multiple rows for the same type).
    /// Step 2: Upsert from API. Types missing from API are left untouched (per project rule).
    /// </summary>
    private async Task<bool> UpsertMemberAddressesAsync(MySqlConnection conn, MySqlTransaction? tx, int memberId, List<RotaryOrgIndividualAddressDto>? addresses)
    {
        bool changed = false;

        // Step 1: dedup — keep only the latest active row per AddressType
        var dedupRowsAffected = await conn.ExecuteAsync(@"
            UPDATE member_address_details
            SET isdeleted = 1, deleted_date = NOW()
            WHERE fk_member_master_profile_id = @M
              AND isdeleted = 0
              AND pk_member_address_details_id NOT IN (
                SELECT keep_id FROM (
                    SELECT MAX(pk_member_address_details_id) AS keep_id
                    FROM member_address_details
                    WHERE fk_member_master_profile_id = @M AND isdeleted = 0
                    GROUP BY AddressType
                ) AS keepers
              )",
            new { M = memberId }, tx);
        if (dedupRowsAffected > 0)
        {
            changed = true;
            _logger.LogInformation("Soft-deleted {N} duplicate address row(s) for member {Mid}", dedupRowsAffected, memberId);
        }

        if (addresses == null || addresses.Count == 0) return changed;

        foreach (var a in addresses)
        {
            if (a == null) continue;
            string? mappedType = a.AddressType?.Trim() switch
            {
                var t when string.Equals(t, "Home", StringComparison.OrdinalIgnoreCase) => "Residential",
                var t when string.Equals(t, "Business", StringComparison.OrdinalIgnoreCase) => "Business",
                _ => null,
            };
            if (mappedType == null) continue;

            // Build address text (concatenate Line1/2/3 with newline)
            var addrLine = string.Join("\n", new[] { a.AddressLine1, a.AddressLine2, a.AddressLine3 }
                .Where(s => !string.IsNullOrWhiteSpace(s))
                .Select(s => s!.Trim()));

            // Skip if entire address is blank
            if (string.IsNullOrWhiteSpace(addrLine)
                && string.IsNullOrWhiteSpace(a.City)
                && string.IsNullOrWhiteSpace(a.State)
                && string.IsNullOrWhiteSpace(a.PostalCode))
                continue;

            int countryId = await ResolveCountryIdAsync(conn, tx, a.Country);

            // Per project memory rule: UPSERT per AddressType (one row per type per member, isdeleted=0)
            var existingId = await conn.ExecuteScalarAsync<int?>(@"
                SELECT pk_member_address_details_id FROM member_address_details
                WHERE fk_member_master_profile_id = @M AND AddressType = @T AND isdeleted = 0
                ORDER BY pk_member_address_details_id DESC LIMIT 1",
                new { M = memberId, T = mappedType }, tx);

            // Pincode normalization (post-incident 2026-06-30): rotary.org sends dirty values
            // like 'chennai-12345', 'chennai/123456', 'chennai  123456', 'chennai -- 12456'.
            // NormalizePincode strips everything except letters/digits → 'chennai12345'. Only
            // applies here (sync write path); portal-entered pincodes are not touched.
            var cleanedPin = NormalizePincode(a.PostalCode);

            if (existingId.HasValue)
            {
                await conn.ExecuteAsync(@"
                    UPDATE member_address_details
                    SET fk_country_id = @C,
                        Address = @A,
                        State = @S,
                        City = @City,
                        PinCode = @P,
                        modified_date = NOW()
                    WHERE pk_member_address_details_id = @Id",
                    new { Id = existingId.Value, C = countryId, A = addrLine, S = a.State?.Trim(), City = a.City?.Trim(), P = cleanedPin }, tx);
            }
            else
            {
                await conn.ExecuteAsync(@"
                    INSERT INTO member_address_details
                        (fk_member_master_profile_id, AddressType, fk_country_id, Address, State, City, PinCode, created_date, isdeleted)
                    VALUES
                        (@M, @T, @C, @A, @S, @City, @P, NOW(), 0)",
                    new { M = memberId, T = mappedType, C = countryId, A = addrLine, S = a.State?.Trim(), City = a.City?.Trim(), P = cleanedPin }, tx);
            }
            changed = true;
        }
        return changed;
    }

    /// <summary>Look up FkCountryId by country name; default to 1 (India) on miss/blank.</summary>
    private async Task<int> ResolveCountryIdAsync(MySqlConnection conn, MySqlTransaction? tx, string? countryName)
    {
        if (string.IsNullOrWhiteSpace(countryName)) return 1;
        var id = await conn.ExecuteScalarAsync<int?>(
            "SELECT pk_country_id FROM country_master WHERE LOWER(CountryName) = LOWER(@Name) AND isdeleted = 0 LIMIT 1",
            new { Name = countryName.Trim() }, tx);
        return id ?? 1;
    }

    private async Task TerminateFromClubAsync(MySqlConnection conn, int clubId, int memberId,
        DateTime? actualTerminationDate, string? actualTerminationReason, CancellationToken ct)
    {
        // Mirrors ClubService.RemoveMemberAsync logic (per-club soft-delete + last-club full deactivate).
        using var tx = await conn.BeginTransactionAsync(ct);
        try
        {
            var otherActiveClubs = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM club_members
                WHERE fk_member_master_profile_id = @MemberId AND fk_club_id <> @ClubId AND isdeleted = 0",
                new { MemberId = memberId, ClubId = clubId }, tx);
            bool isLast = otherActiveClubs == 0;

            // Use the actual TerminationDate + TerminationReason from Rotary.org's
            // /members/terminated endpoint when available. Falls back to today + generic message
            // when the member is missing from /members but Rotary.org provided no terminated row.
            var termDate = actualTerminationDate?.Date ?? DateTime.Today;
            var termReason = string.IsNullOrWhiteSpace(actualTerminationReason)
                ? "Removed from Rotary.org active list"
                : actualTerminationReason!.Trim();
            if (termReason.Length > 500) termReason = termReason.Substring(0, 500);

            await conn.ExecuteAsync(@"
                UPDATE club_members
                SET isdeleted = 1, deleted_date = NOW(),
                    TerminationDate = @TermDate,
                    TerminationReason = @TermReason
                WHERE fk_club_id = @ClubId AND fk_member_master_profile_id = @MemberId AND isdeleted = 0",
                new { ClubId = clubId, MemberId = memberId, TermDate = termDate, TermReason = termReason }, tx);

            await conn.ExecuteAsync(@"
                UPDATE member_roles
                SET isdeleted = 1, IsActive = 0, RevokedDate = NOW(), modified_date = NOW()
                WHERE fk_club_id = @ClubId AND fk_member_master_profile_id = @MemberId AND isdeleted = 0",
                new { ClubId = clubId, MemberId = memberId }, tx);

            await conn.ExecuteAsync(@"
                UPDATE board_of_directors SET isdeleted = 1, deleted_date = NOW()
                WHERE fk_club_id = @ClubId AND fk_member_master_profile_id = @MemberId AND isdeleted = 0",
                new { ClubId = clubId, MemberId = memberId }, tx);

            await conn.ExecuteAsync(@"
                UPDATE district_committee_member SET isdeleted = 1, modified_date = NOW()
                WHERE fk_club_id = @ClubId AND fk_member_id = @MemberId AND isdeleted = 0",
                new { ClubId = clubId, MemberId = memberId }, tx);

            await conn.ExecuteAsync(@"
                UPDATE district_committee_group_member SET isdeleted = 1, modified_date = NOW()
                WHERE fk_club_id = @ClubId AND fk_member_id = @MemberId AND isdeleted = 0",
                new { ClubId = clubId, MemberId = memberId }, tx);

            await conn.ExecuteAsync(@"
                UPDATE district_committee_sub_group_member SET isdeleted = 1, modified_date = NOW()
                WHERE fk_club_id = @ClubId AND fk_member_id = @MemberId AND isdeleted = 0",
                new { ClubId = clubId, MemberId = memberId }, tx);

            await conn.ExecuteAsync(@"
                UPDATE district_ag SET isdeleted = 1, is_active = 0, modified_date = NOW()
                WHERE fk_club_id = @ClubId AND fk_member_id = @MemberId AND isdeleted = 0",
                new { ClubId = clubId, MemberId = memberId }, tx);

            await conn.ExecuteAsync(@"
                UPDATE district_club_moderator SET isdeleted = 1, is_active = 0, modified_date = NOW()
                WHERE fk_club_id = @ClubId AND fk_member_id = @MemberId AND isdeleted = 0",
                new { ClubId = clubId, MemberId = memberId }, tx);

            if (isLast)
            {
                // member_master_profile is intentionally NOT touched, even on last-club termination.
                // The person record + UNIQUE RotaryId must survive for Family Login / re-sync. Login is
                // blocked instead by: mobile NonSyncLoginGuardHelper (no active club_members) + web
                // active-admin-role check (remaining roles soft-deleted below).
                // See feedback: member-removal-never-disables-profile.

                // Soft-delete remaining roles except SuperAdmin (role_id=3, portal-level, keep for audit).
                await conn.ExecuteAsync(@"
                    UPDATE member_roles
                    SET isdeleted = 1, IsActive = 0, RevokedDate = NOW(), modified_date = NOW()
                    WHERE fk_member_master_profile_id = @MemberId AND isdeleted = 0 AND fk_role_id <> 3",
                    new { MemberId = memberId }, tx);

                // Person-scoped cleanup (LAST club only — the member is fully gone from Rotary.org):
                //   (a) Free the PRIMARY mobile (Primary -> Secondary, primary nulled) so the same
                //       person re-joining under a NEW RotaryId can claim it as primary.
                //   (b) Soft-delete address + family so a terminated member carries no stale personal
                //       data. Both are un-deleted again on a same-RotaryId reactivation (AddMemberAsync).
                // The profile row itself is still NOT deleted (UNIQUE RotaryId + Family Login survive).
                await conn.ExecuteAsync(@"
                    UPDATE member_master_profile
                    SET SecondaryMobileNumber = CASE WHEN SecondaryMobileNumber IS NULL OR SecondaryMobileNumber = ''
                                                     THEN PrimaryMobileNumber ELSE SecondaryMobileNumber END,
                        PrimaryMobileNumber = NULL,
                        modified_date = NOW()
                    WHERE pk_member_master_profile_id = @MemberId
                      AND PrimaryMobileNumber IS NOT NULL",
                    new { MemberId = memberId }, tx);
                await conn.ExecuteAsync(@"
                    UPDATE member_address_details SET isdeleted = 1, modified_date = NOW()
                    WHERE fk_member_master_profile_id = @MemberId AND isdeleted = 0",
                    new { MemberId = memberId }, tx);
                await conn.ExecuteAsync(@"
                    UPDATE member_family_details SET isdeleted = 1, modified_date = NOW()
                    WHERE fk_member_master_profile_id = @MemberId AND isdeleted = 0",
                    new { MemberId = memberId }, tx);
            }

            await tx.CommitAsync(ct);
        }
        catch
        {
            try { await tx.RollbackAsync(ct); } catch { }
            throw;
        }
    }

    // ─────────────────────────── Email ───────────────────────────

    private async Task SendEmailAsync(int logId, TimeSpan elapsed,
        int clubsProcessed, int totalAdded, int totalUpdated, int totalTerminated, int totalErrors,
        List<MemberChangeRow> added, List<MemberChangeRow> updated, List<MemberChangeRow> terminated, List<MemberErrorRow> errors,
        List<(int ClubId, string ClubRotaryId, string ClubName, int Found, int Added, int Updated, int Terminated, int Errors, string Status)> perClub)
    {
        try
        {
            using var workbook = new XLWorkbook();

            var summary = workbook.Worksheets.Add("Summary");
            summary.Cell(1, 1).Value = "Rotary.org Club Member Sweep";
            summary.Range("A1:B1").Merge().Style.Font.SetBold().Font.SetFontSize(14);
            summary.Cell(3, 1).Value = "Log ID"; summary.Cell(3, 2).Value = logId;
            summary.Cell(4, 1).Value = "Duration (min)"; summary.Cell(4, 2).Value = Math.Round(elapsed.TotalMinutes, 1);
            summary.Cell(5, 1).Value = "Clubs processed"; summary.Cell(5, 2).Value = clubsProcessed;
            summary.Cell(6, 1).Value = "Members added"; summary.Cell(6, 2).Value = totalAdded;
            summary.Cell(7, 1).Value = "Members updated"; summary.Cell(7, 2).Value = totalUpdated;
            summary.Cell(8, 1).Value = "Members terminated"; summary.Cell(8, 2).Value = totalTerminated;
            summary.Cell(9, 1).Value = "Errors"; summary.Cell(9, 2).Value = totalErrors;
            summary.Columns().AdjustToContents();

            AddMemberSheet(workbook, "Added", added);
            AddMemberSheet(workbook, "Updated", updated);
            AddMemberSheet(workbook, "Terminated", terminated);
            // Exceptions sheet = failures (Inserted=No, from `errors`) + conflicts (Inserted=Yes — the member
            // still landed via the primary→secondary rule). ClubRotaryId/Name resolved from the per-club list.
            var clubInfoById = perClub
                .GroupBy(x => x.ClubId)
                .ToDictionary(g => g.Key, g => (g.First().ClubRotaryId, g.First().ClubName));
            var allExceptions = errors.Concat(_conflictRows).ToList();
            AddErrorSheet(workbook, "Exceptions", allExceptions, clubInfoById);

            var pc = workbook.Worksheets.Add("Per Club");
            pc.Cell(1, 1).Value = "ClubId";
            pc.Cell(1, 2).Value = "ClubRotaryId";
            pc.Cell(1, 3).Value = "ClubName";
            pc.Cell(1, 4).Value = "API Members";
            pc.Cell(1, 5).Value = "Added";
            pc.Cell(1, 6).Value = "Updated";
            pc.Cell(1, 7).Value = "Terminated";
            pc.Cell(1, 8).Value = "Errors";
            pc.Cell(1, 9).Value = "Status";
            pc.Range(1, 1, 1, 9).Style.Font.SetBold().Fill.SetBackgroundColor(XLColor.LightGray);
            for (int i = 0; i < perClub.Count; i++)
            {
                var r = perClub[i];
                pc.Cell(i + 2, 1).Value = r.ClubId;
                pc.Cell(i + 2, 2).Value = r.ClubRotaryId;
                pc.Cell(i + 2, 3).Value = r.ClubName;
                pc.Cell(i + 2, 4).Value = r.Found;
                pc.Cell(i + 2, 5).Value = r.Added;
                pc.Cell(i + 2, 6).Value = r.Updated;
                pc.Cell(i + 2, 7).Value = r.Terminated;
                pc.Cell(i + 2, 8).Value = r.Errors;
                pc.Cell(i + 2, 9).Value = r.Status;
            }
            pc.Columns().AdjustToContents();

            using var ms = new MemoryStream();
            workbook.SaveAs(ms);
            var bytes = ms.ToArray();
            var fileName = $"RotaryOrg_ClubMemberSweep_{DateTime.Now:yyyyMMdd_HHmmss}.xlsx";

            var triggeredByName = _config["RotaryOrgSync:TriggeredByName"] ?? "Admin";

            // Email body shows COUNTS only. Per-member error details (club, RotaryId, reason)
            // live in the Excel "Errors" sheet for cleaner scanning.
            string errorHint = totalErrors > 0
                ? "<p style='color:#dc2626;'><b>⚠ Errors detected</b> — open the <b>Errors</b> sheet in the attached Excel for per-member details (Club, MemberRotaryId, Reason).</p>"
                : "";

            var body = $@"<div style='font-family:Arial,sans-serif;'>
<h2 style='color:#1a365d;'>Rotary.org Club Member Sweep</h2>
<p>Dear {System.Net.WebUtility.HtmlEncode(triggeredByName)},</p>
<p>Per-club member sweep complete. New members added, existing profiles refreshed, removed members soft-deleted.</p>
<table style='border-collapse:collapse;margin:12px 0;border:1px solid #e5e7eb;'>
  <tr><td style='padding:6px 12px;border:1px solid #e5e7eb;'>Duration</td><td style='padding:6px 12px;border:1px solid #e5e7eb;'><b>{Math.Round(elapsed.TotalMinutes, 1)} min</b></td></tr>
  <tr><td style='padding:6px 12px;border:1px solid #e5e7eb;'>Clubs processed</td><td style='padding:6px 12px;border:1px solid #e5e7eb;text-align:right;'><b>{clubsProcessed}</b></td></tr>
  <tr><td style='padding:6px 12px;border:1px solid #e5e7eb;'>Members added</td><td style='padding:6px 12px;border:1px solid #e5e7eb;text-align:right;color:#16a34a;'><b>{totalAdded}</b></td></tr>
  <tr><td style='padding:6px 12px;border:1px solid #e5e7eb;'>Members updated</td><td style='padding:6px 12px;border:1px solid #e5e7eb;text-align:right;color:#0ea5e9;'><b>{totalUpdated}</b></td></tr>
  <tr><td style='padding:6px 12px;border:1px solid #e5e7eb;'>Members terminated</td><td style='padding:6px 12px;border:1px solid #e5e7eb;text-align:right;color:#dc2626;'><b>{totalTerminated}</b></td></tr>
  <tr><td style='padding:6px 12px;border:1px solid #e5e7eb;'>Errors</td><td style='padding:6px 12px;border:1px solid #e5e7eb;text-align:right;color:#dc2626;'><b>{totalErrors}</b></td></tr>
</table>
{errorHint}
<p>Full per-club + per-member detail in the attached Excel.</p>
<p style='color:#64748b;font-size:13px;'>Sync log id: {logId}.</p>
<p>Regards,<br/><strong>Team ROW</strong></p>
</div>";

            var subjectPrefix = _isFailedListMode ? "[Resync]" : ((_isDailyDelta || _isMismatchReconcile) ? "[Daily]" : "[Manual]");
            var subjectKind = _isFailedListMode ? "Member Failed-List Retry"
                : _isMismatchReconcile ? "Mismatch Member Sync"
                : (_isDailyDelta ? "Member Delta" : "Member Full Sweep");
            await _emailSender.SendReportAsync($"{subjectPrefix} ROW {subjectKind} — {DateTime.Now:dd MMM yyyy}", body, bytes, fileName);
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Email sent.");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Sweep email FAILED");
            Console.Error.WriteLine($"[{DateTime.Now:HH:mm:ss}] Email failed: {ex.Message}");
        }
    }

    private static void AddMemberSheet(XLWorkbook wb, string sheetName, List<MemberChangeRow> rows)
    {
        var ws = wb.Worksheets.Add(sheetName);
        ws.Cell(1, 1).Value = "Club";
        ws.Cell(1, 2).Value = "RotaryId";
        ws.Cell(1, 3).Value = "Name";
        ws.Cell(1, 4).Value = "ChangedFields";
        ws.Range(1, 1, 1, 4).Style.Font.SetBold().Fill.SetBackgroundColor(XLColor.LightGray);
        for (int i = 0; i < rows.Count; i++)
        {
            ws.Cell(i + 2, 1).Value = rows[i].ClubName;
            ws.Cell(i + 2, 2).Value = rows[i].MemberRotaryId;
            ws.Cell(i + 2, 3).Value = rows[i].MemberName;
            ws.Cell(i + 2, 4).Value = rows[i].ChangedFields;
        }
        ws.Columns().AdjustToContents();
    }

    private static void AddErrorSheet(XLWorkbook wb, string sheetName, List<MemberErrorRow> rows, Dictionary<int, (string ClubRotaryId, string ClubName)> clubInfoById)
    {
        var ws = wb.Worksheets.Add(sheetName);
        ws.Cell(1, 1).Value = "ClubRotaryId";
        ws.Cell(1, 2).Value = "Club";
        ws.Cell(1, 3).Value = "MemberRotaryId";
        ws.Cell(1, 4).Value = "Inserted";
        ws.Cell(1, 5).Value = "Reason";
        ws.Range(1, 1, 1, 5).Style.Font.SetBold().Fill.SetBackgroundColor(XLColor.LightGray);
        for (int i = 0; i < rows.Count; i++)
        {
            var info = clubInfoById.TryGetValue(rows[i].ClubId, out var v) ? v : (ClubRotaryId: "", ClubName: "");
            ws.Cell(i + 2, 1).Value = !string.IsNullOrEmpty(info.ClubRotaryId) ? info.ClubRotaryId : rows[i].ClubId.ToString();
            ws.Cell(i + 2, 2).Value = !string.IsNullOrEmpty(rows[i].ClubName) ? rows[i].ClubName : info.ClubName;
            ws.Cell(i + 2, 3).Value = rows[i].MemberRotaryId;
            ws.Cell(i + 2, 4).Value = rows[i].Inserted;
            ws.Cell(i + 2, 5).Value = rows[i].Reason;
        }
        ws.Columns().AdjustToContents();
    }

    private class MemberChangeRow
    {
        public string ClubName { get; set; } = "";
        public string MemberRotaryId { get; set; } = "";
        public string MemberName { get; set; } = "";
        public string ChangedFields { get; set; } = "";
    }

    private class MemberErrorRow
    {
        public int ClubId { get; set; }
        public string ClubName { get; set; } = "";
        public string MemberRotaryId { get; set; } = "";
        public string Reason { get; set; } = "";
        // "Yes" = the member DID land in member_master_profile (conflict handled via primary→secondary);
        // "No" = a genuine failure, member NOT inserted (the only rows needing manual review).
        public string Inserted { get; set; } = "No";
    }
}
