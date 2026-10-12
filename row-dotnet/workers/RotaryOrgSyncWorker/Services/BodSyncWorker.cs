using System.Text;
using ClosedXML.Excel;
using Dapper;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using MySqlConnector;

namespace RotaryOrgSyncWorker.Services;

/// <summary>
/// Per-club BOD sync from Rotary.org. For each synced club + each Rotary year in scope:
///  1. Fetch officers via /clubs/{type}/{id}/officers?startDate=07/01/{year}&endDate=06/30/{year+1}
///  2. Sync designation_master — INSERT new designations seen in API.
///  3. Sync board_of_directors — INSERT new + soft-delete missing (per club+year).
///  4. Sync DC auto-groups — for "Club President" / "Club Secretary" entries, ensure
///     district_committee_group + district_committee_group_member rows exist.
/// Year-suffix rule: current year groups have no suffix; past/future use "YYYY-YY" suffix.
///
/// Schedule: weekly Sunday 05:00 (after country-sync at 03:00, before next-day delta at 02:00).
/// </summary>
public class BodSyncWorker
{
    private readonly IRotaryOrgApiClient _api;
    private readonly EmailReportSender _emailSender;
    private readonly IConfiguration _config;
    private readonly ILogger<BodSyncWorker> _logger;
    private readonly DcCpcsReconciler _dcCpcsReconciler;
    private readonly string _connectionString;

    // These specific designation_name values trigger DC auto-group sync (CP/CS).
    // Match Rotary.org's OfficerRole values exactly.
    private const string DesignationClubPresident = "Club President";
    private const string DesignationClubSecretary = "Club Secretary";
    private const string GroupClubPresidents = "Club Presidents";
    private const string GroupClubSecretaries = "Club Secretaries";

    public BodSyncWorker(
        IRotaryOrgApiClient api,
        EmailReportSender emailSender,
        IConfiguration config,
        ILogger<BodSyncWorker> logger,
        DcCpcsReconciler dcCpcsReconciler)
    {
        _api = api;
        _dcCpcsReconciler = dcCpcsReconciler;
        _emailSender = emailSender;
        _config = config;
        _logger = logger;
        _connectionString = config.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("ConnectionStrings:DefaultConnection missing");
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    // specificClubRotaryId: the club's Rotary.org id (ClubRotaryId, e.g. 28046) — NOT the internal
    // pk_club_id. Matches the --club-sync convention so testing a single club uses the id you know.
    public async Task RunAsync(int? specificClubRotaryId = null, bool recentYearsOnly = false, CancellationToken ct = default)
    {
        var startedAt = DateTime.UtcNow;
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === BOD Sync START ===");
        if (specificClubRotaryId.HasValue)
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] (Test mode — only ClubRotaryId {specificClubRotaryId.Value})");

        int logId;
        await using (var conn = CreateConnection())
        {
            await conn.OpenAsync(ct);
            var triggeredBy = int.Parse(_config["RotaryOrgSync:TriggeredByMemberId"] ?? "0");
            logId = await conn.ExecuteScalarAsync<int>(@"
                INSERT INTO rotary_org_sync_log (SyncType, StartedAtUtc, Status, TriggeredBy)
                VALUES ('BodSync', UTC_TIMESTAMP(), 'Running', @By);
                SELECT LAST_INSERT_ID();",
                new { By = triggeredBy });
        }
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Log row created — logId={logId}");

        var addedDesignations = new List<string>();
        var addedYears = new List<string>();   // Rotary years auto-created in rotary_year_master during this run
        var bodAdded = new List<BodChangeRow>();
        var bodUpdated = new List<BodChangeRow>();
        var bodTerminated = new List<BodChangeRow>();
        var dcChanges = new List<DcChangeRow>();
        var skippedMemberMissing = new List<BodErrorRow>();   // Historical officers — member no longer in DB. Expected, not an error.
        var errors = new List<BodErrorRow>();                 // Real errors only (API failures, DB exceptions, etc.)
        var perClub = new List<(int ClubId, string ClubName, int YearsProbed, int OfficersFound, int Added, int Updated, int Terminated, int DcGroupOps, int SkippedMember, int Errors, string Status)>();
        int totalAdded = 0, totalUpdated = 0, totalTerminated = 0, totalDcOps = 0, totalSkippedMember = 0, totalErrors = 0;
        // Auto Club-Admin tracking (current-year CP/CS only). CP and CS kept separate per request.
        int cpAdminMade = 0, csAdminMade = 0, cpAdminAlready = 0, csAdminAlready = 0;
        var adminMadeList = new List<AdminMadeRow>();   // newly-made admins for the email detail list

        try
        {
            await using var dbConn = CreateConnection();
            await dbConn.OpenAsync(ct);

            // Load synced clubs (with charter date so we know how far back to go)
            var clubsSql = @"
                SELECT pk_club_id AS pk_id, ClubRotaryId AS clubRotaryId, ClubName AS clubName,
                       fk_district_id AS districtId, ClubCharterDate AS charterDate
                FROM club_master
                WHERE isdeleted = 0
                  AND IsSyncedFromRotaryOrg = 1
                  AND ClubRotaryId IS NOT NULL AND ClubRotaryId <> ''" +
                (specificClubRotaryId.HasValue ? " AND ClubRotaryId = @SpecificRotaryId" : "") + @"
                ORDER BY pk_club_id";
            var clubs = (await dbConn.QueryAsync<(int pk_id, string clubRotaryId, string clubName, int districtId, DateTime? charterDate)>(
                clubsSql, new { SpecificRotaryId = (specificClubRotaryId ?? 0).ToString() })).ToList();
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Synced clubs to process: {clubs.Count}");

            // Load designations (designation_name → pk_designation_id)
            var designations = (await dbConn.QueryAsync<(int pk_id, string designationName)>(@"
                SELECT pk_designation_id AS pk_id, designation_name AS designationName
                FROM designation_master WHERE isdeleted = 0"))
                .ToDictionary(x => x.designationName, x => x.pk_id, StringComparer.OrdinalIgnoreCase);
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Loaded {designations.Count} designations");

            // Load all members by RotaryId (for fast lookup)
            var membersByRotaryId = (await dbConn.QueryAsync<(int pk_id, string rotaryId)>(@"
                SELECT pk_member_master_profile_id AS pk_id, IFNULL(RotaryId, '') AS rotaryId
                FROM member_master_profile
                WHERE isdeleted = 0 AND RotaryId IS NOT NULL AND RotaryId <> ''"))
                .ToDictionary(x => x.rotaryId.Trim(), x => x.pk_id, StringComparer.OrdinalIgnoreCase);
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Loaded {membersByRotaryId.Count} members with RotaryId");

            // Load rotary years (YearLabel → pk_year_id)
            // YearLabel is "YYYY-YY" e.g., "2024-25"
            var years = (await dbConn.QueryAsync<(int pk_id, string yearLabel, DateTime startDate, byte isCurrent)>(@"
                SELECT pk_year_id AS pk_id, YearLabel AS yearLabel, StartDate AS startDate, IsCurrent AS isCurrent
                FROM rotary_year_master WHERE isdeleted = 0"))
                .ToList();
            var yearsByLabel = years.ToDictionary(y => y.yearLabel, y => y, StringComparer.OrdinalIgnoreCase);
            var yearsByPk = years.ToDictionary(y => y.pk_id, y => y);
            var currentYearLabel = years.FirstOrDefault(y => y.isCurrent == 1).yearLabel ?? "";
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Loaded {years.Count} Rotary years — current is '{currentYearLabel}'");

            // Determine end year for syncing (current Rotary year + 2)
            // Current Rotary year starts July 1. If today >= July 1 → year = today.Year, else today.Year - 1.
            var today = DateTime.Today;
            var currentRotaryStartYear = today.Month >= 7 ? today.Year : today.Year - 1;
            var maxFromYear = currentRotaryStartYear + 2;  // sync up to year+2 (e.g., 2027-28 starts 2027)

            int clubIdx = 0;
            foreach (var club in clubs)
            {
                ct.ThrowIfCancellationRequested();
                clubIdx++;
                int clubAdded = 0, clubUpdated = 0, clubTerminated = 0, clubDcOps = 0, clubSkippedMember = 0, clubErrors = 0;
                int yearsProbed = 0;
                int officersFound = 0;
                string status = "ok";

                if (!int.TryParse(club.clubRotaryId, out var rotaryClubId))
                {
                    perClub.Add((club.pk_id, club.clubName, 0, 0, 0, 0, 0, 0, 0, 1, "invalid ClubRotaryId"));
                    continue;
                }

                // ── One call: fetch ALL officers for this club across every year ──
                // (Your approach) Instead of one API call per year (charter→now ≈ 35 calls/club), ask
                // Rotary.org for the whole span at once, then read each officer's own StartDate/EndDate
                // to place it in a Rotary year. Turns ~130k calls/run into ~1 per club — this is what
                // lets the weekly run actually finish.
                int floorYear = club.charterDate?.Year ?? 2000;
                if (floorYear < 1900) floorYear = 2000;
                if (floorYear > maxFromYear) floorYear = maxFromYear;
                // --recent: only sync LAST / CURRENT / FUTURE Rotary years (don't reach back to charter).
                // Lighter per-club call + far less to process; the weekly full run still covers all history.
                if (recentYearsOnly)
                {
                    int recentFloor = currentRotaryStartYear - 1;   // last Rotary year
                    if (floorYear < recentFloor) floorYear = recentFloor;
                }

                List<RotaryOrgClubOfficerDto> allOfficers;
                try
                {
                    // Per-call timeout so one hung/slow response can't freeze the whole run.
                    using var callCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                    callCts.CancelAfter(TimeSpan.FromSeconds(90));   // one wide call — a little more headroom
                    allOfficers = await _api.GetClubOfficersAsync("Rotary Club", rotaryClubId, floorYear, maxFromYear, callCts.Token);
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested)
                {
                    throw;   // genuine shutdown/cancellation — bubble up
                }
                catch (Exception ex)
                {
                    clubErrors++;
                    totalErrors++;
                    var isTimeout = ex is OperationCanceledException;
                    errors.Add(new BodErrorRow { ClubId = club.pk_id, ClubName = club.clubName, YearLabel = "", MemberRotaryId = "", DesignationName = "", Reason = isTimeout ? "API: officers call timed out (90s) — club skipped this run" : $"API: {ex.Message}" });
                    Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] [{clubIdx}/{clubs.Count}] {club.clubName,-40} API ERROR — {(isTimeout ? "timeout" : ex.Message)}");
                    perClub.Add((club.pk_id, club.clubName, 0, 0, 0, 0, 0, 0, 0, 1, "api error"));
                    continue;
                }
                officersFound = allOfficers.Count;

                // Group each officer into its Rotary year (derived from StartDate/EndDate). Auto-create
                // the year in rotary_year_master if missing so a new future/past year never drops it.
                var officersByYearPk = new Dictionary<int, List<RotaryOrgClubOfficerDto>>();
                foreach (var off in allOfficers)
                {
                    var startYr = DeriveRotaryStartYear(off);
                    if (startYr == null)
                    {
                        clubErrors++;
                        totalErrors++;
                        errors.Add(new BodErrorRow { ClubId = club.pk_id, ClubName = club.clubName, YearLabel = "", MemberRotaryId = off.MemberId.ToString(), DesignationName = off.OfficerRole ?? "", Reason = "Officer has no StartDate/EndDate — cannot place in a Rotary year" });
                        continue;
                    }
                    var yLabel = $"{startYr.Value}-{(startYr.Value + 1) % 100:D2}";
                    if (!yearsByLabel.TryGetValue(yLabel, out var yInfo))
                    {
                        // Year missing → create it (StartDate Jul 1, EndDate Jun 30, IsCurrent 0).
                        yInfo = await EnsureRotaryYearAsync(dbConn, yearsByLabel, yearsByPk, startYr.Value, yLabel, ct);
                        if (yInfo.pk_id != 0)
                        {
                            addedYears.Add(yLabel);
                            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}]   + auto-created Rotary year '{yLabel}' (id {yInfo.pk_id})");
                        }
                    }
                    if (yInfo.pk_id == 0)
                    {
                        clubErrors++;
                        totalErrors++;
                        errors.Add(new BodErrorRow { ClubId = club.pk_id, ClubName = club.clubName, YearLabel = yLabel, MemberRotaryId = off.MemberId.ToString(), DesignationName = off.OfficerRole ?? "", Reason = $"Could not ensure Rotary year '{yLabel}'" });
                        continue;
                    }
                    if (!officersByYearPk.TryGetValue(yInfo.pk_id, out var lst))
                    {
                        lst = new List<RotaryOrgClubOfficerDto>();
                        officersByYearPk[yInfo.pk_id] = lst;
                    }
                    lst.Add(off);
                }

                // Reconcile ONLY the years Rotary.org actually returned in this response.
                // SAFETY: we deliberately do NOT delete BOD for years absent from the response.
                // A missing year can't be told apart from a truncated/capped response, and wrongly
                // wiping real history is far worse than leaving a rare Rotary-emptied year in place.
                // Consequence: if the whole call returns nothing (API blip), zero deletions happen.
                // Deletes still work normally WITHIN any year the API returned (an officer dropped
                // from a year that still has others is soft-deleted). Manual rows are never touched.
                foreach (var yearPk in officersByYearPk.Keys)
                {
                    ct.ThrowIfCancellationRequested();
                    yearsProbed++;

                    if (!yearsByPk.TryGetValue(yearPk, out var yearInfo))
                        continue;   // unknown id — shouldn't happen (dicts kept in sync on create)
                    var yearLabel = yearInfo.yearLabel;
                    bool yearIsCurrent = yearInfo.isCurrent == 1;
                    var apiOfficers = officersByYearPk[yearPk];

                    // Enforce "one Club President / one Club Secretary per club+year". Rotary.org can
                    // return several people for the same singular role in one year (e.g. a 3-day interim
                    // president followed by the year's real president). Keep ONLY the current holder —
                    // the officer with the LATEST StartDate — and drop the superseded ones. A dropped
                    // officer is never added to apiKeysForThisYear, so if it was synced before it falls
                    // out of the "seen" set and gets soft-deleted in Step 5 ("president changed ->
                    // replace"). Non-singular roles (Director, etc.) pass through untouched.
                    apiOfficers = CollapseSingularRoles(apiOfficers);

                    // Process each officer
                    var apiKeysForThisYear = new HashSet<(int memberId, int designationId)>();

                    foreach (var off in apiOfficers)
                    {
                        try
                        {
                            // Step 1: ensure designation
                            var designationName = off.OfficerRole?.Trim() ?? "";
                            if (string.IsNullOrWhiteSpace(designationName)) continue;

                            if (!designations.TryGetValue(designationName, out var designationId))
                            {
                                designationId = await dbConn.ExecuteScalarAsync<int>(@"
                                    INSERT INTO designation_master (designation_name, sort_order, created_date, isdeleted)
                                    VALUES (@N, 0, NOW(), 0);
                                    SELECT LAST_INSERT_ID();",
                                    new { N = designationName });
                                designations[designationName] = designationId;
                                addedDesignations.Add(designationName);
                            }

                            // Step 2: find member in our DB by RotaryId
                            var memberRid = off.MemberId.ToString();
                            if (!membersByRotaryId.TryGetValue(memberRid, out var memberPkId))
                            {
                                // Historical officer whose member is no longer in member_master_profile
                                // (terminated/removed since the BOD record was created). NOT an error —
                                // expected for old years. Track separately so the count stays clean.
                                clubSkippedMember++;
                                totalSkippedMember++;
                                skippedMemberMissing.Add(new BodErrorRow { ClubId = club.pk_id, ClubName = club.clubName, YearLabel = yearLabel, MemberRotaryId = memberRid, DesignationName = designationName, Reason = "Member not in DB (likely removed/terminated since this BOD year)" });
                                continue;
                            }

                            apiKeysForThisYear.Add((memberPkId, designationId));

                            // Step 3: BOD upsert
                            var existingBodId = await dbConn.ExecuteScalarAsync<int?>(@"
                                SELECT pk_board_director_id FROM board_of_directors
                                WHERE fk_club_id = @ClubId AND fk_year_id = @YearId
                                  AND fk_member_master_profile_id = @MemberId AND fk_designation_id = @DesignationId
                                ORDER BY pk_board_director_id DESC LIMIT 1",
                                new { ClubId = club.pk_id, YearId = yearInfo.pk_id, MemberId = memberPkId, DesignationId = designationId });

                            if (existingBodId == null || existingBodId == 0)
                            {
                                // INSERT
                                await dbConn.ExecuteAsync(@"
                                    INSERT INTO board_of_directors
                                        (fk_club_id, fk_member_master_profile_id, fk_designation_id, fk_year_id, SyncSource, created_date, isdeleted)
                                    VALUES
                                        (@ClubId, @MemberId, @DesignationId, @YearId, 'Auto', NOW(), 0)",
                                    new { ClubId = club.pk_id, MemberId = memberPkId, DesignationId = designationId, YearId = yearInfo.pk_id });
                                clubAdded++;
                                totalAdded++;
                                bodAdded.Add(new BodChangeRow { ClubName = club.clubName, YearLabel = yearLabel, MemberRotaryId = memberRid, MemberName = BuildName(off), DesignationName = designationName });
                            }
                            else
                            {
                                // Existing — check if it was soft-deleted; if so, reactivate
                                var wasSoftDeleted = await dbConn.ExecuteScalarAsync<int>(@"
                                    SELECT isdeleted FROM board_of_directors WHERE pk_board_director_id = @Id",
                                    new { Id = existingBodId.Value });
                                if (wasSoftDeleted == 1)
                                {
                                    await dbConn.ExecuteAsync(@"
                                        UPDATE board_of_directors
                                        SET isdeleted = 0, deleted_by = NULL, deleted_date = NULL,
                                            SyncSource = 'Auto', modified_date = NOW()
                                        WHERE pk_board_director_id = @Id",
                                        new { Id = existingBodId.Value });
                                    clubUpdated++;
                                    totalUpdated++;
                                    bodUpdated.Add(new BodChangeRow { ClubName = club.clubName, YearLabel = yearLabel, MemberRotaryId = memberRid, MemberName = BuildName(off), DesignationName = designationName });
                                }
                                else
                                {
                                    // Active row matching all keys — flip Manual → Auto if Rotary.org has confirmed it
                                    await dbConn.ExecuteAsync(@"
                                        UPDATE board_of_directors
                                        SET SyncSource = 'Auto', modified_date = NOW()
                                        WHERE pk_board_director_id = @Id AND IFNULL(SyncSource, 'Manual') <> 'Auto'",
                                        new { Id = existingBodId.Value });
                                }
                            }

                            // Step 4: DC auto-group for Club President / Club Secretary
                            if (string.Equals(designationName, DesignationClubPresident, StringComparison.OrdinalIgnoreCase) ||
                                string.Equals(designationName, DesignationClubSecretary, StringComparison.OrdinalIgnoreCase))
                            {
                                var ops = await EnsureDcGroupMemberAsync(dbConn, club, yearInfo.pk_id, yearLabel, yearIsCurrent, designationName, memberPkId, off, ct);
                                clubDcOps += ops;
                                totalDcOps += ops;
                                if (ops > 0)
                                {
                                    dcChanges.Add(new DcChangeRow { ClubName = club.clubName, YearLabel = yearLabel, MemberRotaryId = memberRid, MemberName = BuildName(off), DesignationName = designationName, Action = "ensured" });
                                }

                                // CURRENT year only: auto-make this CP/CS a Club Admin (role + login
                                // credentials + credentials email), self-contained in the worker.
                                // Skips if the member is already an active Club Admin for this club.
                                if (yearIsCurrent)
                                {
                                    var adminRes = await MakeClubAdminAsync(dbConn, club.pk_id, memberPkId, off, ct);
                                    bool isCp = string.Equals(designationName, DesignationClubPresident, StringComparison.OrdinalIgnoreCase);
                                    if (adminRes.Outcome == AdminOutcome.MadeNew)
                                    {
                                        if (isCp) cpAdminMade++; else csAdminMade++;
                                        adminMadeList.Add(new AdminMadeRow { Name = adminRes.Name, ClubName = club.clubName, Role = designationName, Email = adminRes.Email });
                                    }
                                    else if (adminRes.Outcome == AdminOutcome.AlreadyAdmin)
                                    {
                                        if (isCp) cpAdminAlready++; else csAdminAlready++;
                                    }
                                }
                            }
                        }
                        catch (OperationCanceledException) { throw; }
                        catch (Exception ex)
                        {
                            clubErrors++;
                            totalErrors++;
                            errors.Add(new BodErrorRow { ClubId = club.pk_id, ClubName = club.clubName, YearLabel = yearLabel, MemberRotaryId = off.MemberId.ToString(), DesignationName = off.OfficerRole ?? "", Reason = ex.Message });
                            _logger.LogError(ex, "BOD sync error for club {Club} year {Year} member {Mid}", club.clubName, yearLabel, off.MemberId);
                        }
                    }

                    // Step 5: soft-delete BOD entries in DB but NOT in API (for this club + year).
                    // Auto rows are always mirror-candidates. Manual rows (added by club admins for
                    // local designations Rotary.org doesn't track) are normally NEVER auto-deleted —
                    // EXCEPT the singular roles (Club President / Club Secretary), which must be a hard
                    // singleton per club+year: if Rotary.org supplied that officer this year, the
                    // Rotary.org holder wins and every OTHER CP/CS row is removed — Manual included.
                    // (A Manual CP/CS is kept only when Rotary.org has none for that role+year.)
                    var cpDesignationId = designations.TryGetValue(DesignationClubPresident, out var _cpId) ? _cpId : 0;
                    var csDesignationId = designations.TryGetValue(DesignationClubSecretary, out var _csId) ? _csId : 0;
                    var apiSingularDesignationIds = new HashSet<int>();
                    if (cpDesignationId != 0 && apiKeysForThisYear.Any(k => k.designationId == cpDesignationId)) apiSingularDesignationIds.Add(cpDesignationId);
                    if (csDesignationId != 0 && apiKeysForThisYear.Any(k => k.designationId == csDesignationId)) apiSingularDesignationIds.Add(csDesignationId);

                    var dbBod = (await dbConn.QueryAsync<(int pk_id, int memberId, int designationId, string? syncSource)>(@"
                        SELECT pk_board_director_id AS pk_id, fk_member_master_profile_id AS memberId,
                               fk_designation_id AS designationId, SyncSource AS syncSource
                        FROM board_of_directors
                        WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND isdeleted = 0",
                        new { ClubId = club.pk_id, YearId = yearInfo.pk_id })).ToList();

                    foreach (var (bodPkId, dbMemberId, dbDesignationId, syncSource) in dbBod)
                    {
                        if (apiKeysForThisYear.Contains((dbMemberId, dbDesignationId))) continue;  // matches the API winner → keep
                        var isAuto = string.Equals(syncSource ?? "Manual", "Auto", StringComparison.OrdinalIgnoreCase);
                        var isSupersededSingular = apiSingularDesignationIds.Contains(dbDesignationId);
                        // Keep a Manual row UNLESS it's a CP/CS that Rotary.org filled this year.
                        if (!isAuto && !isSupersededSingular) continue;
                        // Not in API (Auto), or a superseded Manual CP/CS → terminate
                        try
                        {
                            await dbConn.ExecuteAsync(@"
                                UPDATE board_of_directors SET isdeleted = 1, deleted_date = NOW()
                                WHERE pk_board_director_id = @Id",
                                new { Id = bodPkId });
                            clubTerminated++;
                            totalTerminated++;

                            // Get member + designation names for reporting
                            var info = await dbConn.QueryFirstOrDefaultAsync<(string memberName, string rotaryId, string designationName)>(@"
                                SELECT m.MemberName AS memberName, IFNULL(m.RotaryId, '') AS rotaryId, d.designation_name AS designationName
                                FROM member_master_profile m, designation_master d
                                WHERE m.pk_member_master_profile_id = @MemberId AND d.pk_designation_id = @DesignationId",
                                new { MemberId = dbMemberId, DesignationId = dbDesignationId });
                            bodTerminated.Add(new BodChangeRow { ClubName = club.clubName, YearLabel = yearLabel, MemberRotaryId = info.rotaryId, MemberName = info.memberName ?? "", DesignationName = info.designationName ?? "" });

                            // DC auto-group cleanup if CP/CS — decided by designation ID, not by the name lookup
                            // above: that lookup joins member_master_profile, so when the profile no longer exists
                            // it returned nothing and the DC row was never removed (stale CP/CS left in DC).
                            bool isCpRow = cpDesignationId != 0 && dbDesignationId == cpDesignationId;
                            bool isCsRow = csDesignationId != 0 && dbDesignationId == csDesignationId;
                            if (isCpRow || isCsRow)
                            {
                                var ops = await RemoveDcGroupMemberAsync(dbConn, club, yearInfo.pk_id, isCpRow, dbMemberId, ct);
                                clubDcOps += ops;
                                totalDcOps += ops;
                                if (ops > 0)
                                {
                                    dcChanges.Add(new DcChangeRow { ClubName = club.clubName, YearLabel = yearLabel, MemberRotaryId = info.rotaryId ?? "", MemberName = info.memberName ?? "", DesignationName = isCpRow ? DesignationClubPresident : DesignationClubSecretary, Action = "removed" });
                                }
                            }
                        }
                        catch (Exception ex)
                        {
                            clubErrors++;
                            totalErrors++;
                            errors.Add(new BodErrorRow { ClubId = club.pk_id, ClubName = club.clubName, YearLabel = yearLabel, MemberRotaryId = "", DesignationName = "", Reason = $"Terminate: {ex.Message}" });
                        }
                    }

                    // Step 6: collapse SAME-PERSON duplicates. A member listed 2+ times in the SAME
                    // club+year+designation is one person on two rows (e.g. a Manual entry plus a later
                    // Auto sync that missed the match because the member's profile pk had changed). Step 5
                    // can't remove these — both rows carry the API winner key (member, designation) — so
                    // dedupe here: keep ONE per (member, designation), preferring the Auto row (Rotary.org
                    // authoritative), else the oldest pk. Soft-delete only; never a hard delete.
                    try
                    {
                        var deduped = await dbConn.ExecuteAsync(@"
                            UPDATE board_of_directors b
                            JOIN (
                                SELECT fk_member_master_profile_id AS mid, fk_designation_id AS did,
                                       CAST(SUBSTRING_INDEX(
                                           GROUP_CONCAT(pk_board_director_id ORDER BY (SyncSource='Auto') DESC, pk_board_director_id ASC),
                                           ',', 1) AS UNSIGNED) AS keep_pk
                                FROM board_of_directors
                                WHERE fk_club_id = @ClubId AND fk_year_id = @YearId AND isdeleted = 0
                                GROUP BY fk_member_master_profile_id, fk_designation_id
                                HAVING COUNT(*) > 1
                            ) k ON b.fk_member_master_profile_id = k.mid AND b.fk_designation_id = k.did
                            SET b.isdeleted = 1, b.deleted_date = NOW()
                            WHERE b.fk_club_id = @ClubId AND b.fk_year_id = @YearId AND b.isdeleted = 0
                              AND b.pk_board_director_id <> k.keep_pk",
                            new { ClubId = club.pk_id, YearId = yearInfo.pk_id });
                        if (deduped > 0)
                        {
                            clubTerminated += deduped;
                            totalTerminated += deduped;
                            _logger.LogInformation("[BOD] {Club} {Year}: collapsed {N} same-person duplicate row(s)", club.clubName, yearLabel, deduped);
                        }
                    }
                    catch (Exception ex)
                    {
                        clubErrors++;
                        totalErrors++;
                        errors.Add(new BodErrorRow { ClubId = club.pk_id, ClubName = club.clubName, YearLabel = yearLabel, MemberRotaryId = "", DesignationName = "", Reason = $"Dedup same-member: {ex.Message}" });
                    }
                }

                Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] [{clubIdx}/{clubs.Count}] {club.clubName,-40} years={yearsProbed,2} found={officersFound,4} +{clubAdded,3} ~{clubUpdated,3} -{clubTerminated,3} dc={clubDcOps,3} skip={clubSkippedMember,3} err={clubErrors}");
                perClub.Add((club.pk_id, club.clubName, yearsProbed, officersFound, clubAdded, clubUpdated, clubTerminated, clubDcOps, clubSkippedMember, clubErrors, status));
            }

            // Safety net (full runs only): DC Club Presidents / Secretaries groups must match BOD exactly, all
            // years — catches changes made outside this sync (club/profile deletes, stored procedures, …).
            if (!specificClubRotaryId.HasValue)
            {
                try
                {
                    Console.WriteLine("");
                    await _dcCpcsReconciler.RunAsync(apply: true, force: false, ct);
                }
                catch (OperationCanceledException) { throw; }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "DC CP/CS reconcile after BOD sync FAILED");
                    errors.Add(new BodErrorRow { ClubId = 0, ClubName = "", YearLabel = "", MemberRotaryId = "", DesignationName = "", Reason = $"DC CP/CS reconcile: {ex.Message}" });
                    totalErrors++;
                }
            }

            var elapsed = DateTime.UtcNow - startedAt;
            Console.WriteLine("");
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === BOD Sync DONE in {elapsed.TotalMinutes:F1} min ===");
            Console.WriteLine($"  Clubs processed:       {clubs.Count}");
            Console.WriteLine($"  Designations added:    {addedDesignations.Count}");
            Console.WriteLine($"  Years auto-created:    {addedYears.Count}{(addedYears.Count > 0 ? " (" + string.Join(", ", addedYears.Distinct()) + ")" : "")}");
            Console.WriteLine($"  BOD added:             {totalAdded}");
            Console.WriteLine($"  BOD updated:           {totalUpdated}");
            Console.WriteLine($"  BOD terminated:        {totalTerminated}");
            Console.WriteLine($"  DC group ops:          {totalDcOps}");
            Console.WriteLine($"  Skipped (no member):   {totalSkippedMember}");
            Console.WriteLine($"  Errors:                {totalErrors}");
            Console.WriteLine($"  Club Admin made:       CP {cpAdminMade} / CS {csAdminMade}   (already admin: CP {cpAdminAlready} / CS {csAdminAlready})");

            await dbConn.ExecuteAsync(@"
                UPDATE rotary_org_sync_log
                SET FinishedAtUtc = UTC_TIMESTAMP(), Status = 'Completed',
                    InsertedCount = @Add, UpdatedCount = @Upd, DisabledCount = @Term, ErrorCount = @Err
                WHERE pk_id = @Id",
                new { Id = logId, Add = totalAdded, Upd = totalUpdated, Term = totalTerminated, Err = totalErrors });

            await SendEmailAsync(logId, elapsed, clubs.Count, addedDesignations, addedYears, totalAdded, totalUpdated, totalTerminated, totalDcOps, totalSkippedMember, totalErrors,
                cpAdminMade, csAdminMade, cpAdminAlready, csAdminAlready, adminMadeList,
                bodAdded, bodUpdated, bodTerminated, dcChanges, skippedMemberMissing, errors, perClub);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[{DateTime.Now:HH:mm:ss}] BOD SYNC FAILED: {ex.Message}");
            _logger.LogError(ex, "BOD sync FAILED");
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

    // ─── DC auto-group helpers ─────────────────────────────────────────

    /// Returns 1 if any group/member row was created/changed, 0 if no-op.
    private async Task<int> EnsureDcGroupMemberAsync(MySqlConnection conn,
        (int pk_id, string clubRotaryId, string clubName, int districtId, DateTime? charterDate) club,
        int yearPkId, string yearLabel, bool yearIsCurrent, string designationName,
        int memberPkId, RotaryOrgClubOfficerDto api, CancellationToken ct)
    {
        var groupBaseName = string.Equals(designationName, DesignationClubPresident, StringComparison.OrdinalIgnoreCase)
            ? GroupClubPresidents : GroupClubSecretaries;
        var groupName = yearIsCurrent ? groupBaseName : $"{groupBaseName} {yearLabel}";

        // Find or create the group — ONE active group per district + year + role (user rule 2026-09-17).
        // Matched by year + role in either plural form ("Club Presidents" / "Club Presidents YYYY-YY"), so
        // a bare/suffixed name mismatch (IsCurrent flag vs dates, year rollover) never creates a 2nd copy.
        var groupId = await FindActiveRoleGroupIdAsync(conn, club.districtId, yearPkId, groupBaseName, groupName);

        int ops = 0;
        if (groupId == null || groupId == 0)
        {
            try
            {
                groupId = await conn.ExecuteScalarAsync<int>(@"
                    INSERT INTO district_committee_group
                        (fk_district_id, fk_year_id, group_name, sort_order, is_active, created_date, isdeleted)
                    VALUES (@DistrictId, @YearId, @Name, 0, 1, NOW(), 0);
                    SELECT LAST_INSERT_ID();",
                    new { DistrictId = club.districtId, YearId = yearPkId, Name = groupName });
                ops++;
            }
            catch (MySqlException ex) when (ex.ErrorCode == MySqlErrorCode.DuplicateKeyEntry)
            {
                // The API created it at the same moment — DB unique key (SQL/dc_cpcs_one_active_group_guard.sql)
                // rejected this 2nd copy. Use the existing row.
                groupId = await FindActiveRoleGroupIdAsync(conn, club.districtId, yearPkId, groupBaseName, groupName);
                if (groupId == null || groupId == 0) throw;
            }
        }

        // Member name + contact for the denormalized columns
        var memberInfo = await conn.QueryFirstOrDefaultAsync<(string name, string? mobile, string? email)>(@"
            SELECT MemberName AS name, PrimaryMobileNumber AS mobile, EmailId AS email
            FROM member_master_profile WHERE pk_member_master_profile_id = @Id",
            new { Id = memberPkId });

        // UPSERT member row in district_committee_group_member
        var existingMemberRowId = await conn.ExecuteScalarAsync<int?>(@"
            SELECT id FROM district_committee_group_member
            WHERE fk_group_id = @GroupId AND fk_member_id = @MemberId AND fk_club_id = @ClubId
            ORDER BY id DESC LIMIT 1",
            new { GroupId = groupId, MemberId = memberPkId, ClubId = club.pk_id });

        int keptRowId;
        if (existingMemberRowId == null || existingMemberRowId == 0)
        {
            keptRowId = await conn.ExecuteScalarAsync<int>(@"
                INSERT INTO district_committee_group_member
                    (fk_group_id, fk_member_id, is_member, name, mobile, email, district_designation, fk_club_id, sort_order, is_active, created_date, isdeleted)
                VALUES (@GroupId, @MemberId, 1, @Name, @Mobile, @Email, @Designation, @ClubId, 0, 1, NOW(), 0);
                SELECT LAST_INSERT_ID();",
                new { GroupId = groupId, MemberId = memberPkId, Name = memberInfo.name ?? BuildName(api), Mobile = memberInfo.mobile, Email = memberInfo.email, Designation = designationName, ClubId = club.pk_id });
            ops++;
        }
        else
        {
            keptRowId = existingMemberRowId.Value;
            // Reactivate if soft-deleted, refresh denormalized fields
            await conn.ExecuteAsync(@"
                UPDATE district_committee_group_member
                SET isdeleted = 0, is_active = 1,
                    name = @Name, mobile = @Mobile, email = @Email, district_designation = @Designation,
                    modified_date = NOW()
                WHERE id = @Id",
                new { Id = keptRowId, Name = memberInfo.name ?? BuildName(api), Mobile = memberInfo.mobile, Email = memberInfo.email, Designation = designationName });
        }

        // ONE-PER-CLUB enforcement (the fix): this club now has exactly one current holder for
        // this role+year (kept row). Soft-delete EVERY OTHER active row for the same (group, club)
        // — a superseded old CP/CS, an orphaned no-RID-twin row, or a leftover duplicate of the
        // same member. Keys off the kept row id (not member id) so same-member duplicates go too.
        // Guarantees the DC group can never exceed the club count, no matter how many times
        // Rotary.org changes the officer or the member terminates/rejoins during the year.
        var swept = await conn.ExecuteAsync(@"
            UPDATE district_committee_group_member
            SET isdeleted = 1, is_active = 0, modified_date = NOW()
            WHERE fk_group_id = @GroupId AND fk_club_id = @ClubId AND id <> @KeptId AND isdeleted = 0",
            new { GroupId = groupId, ClubId = club.pk_id, KeptId = keptRowId });
        if (swept > 0) ops++;
        return ops;
    }

    // The single ACTIVE CP/CS group for a district + year + role, whichever plural form its name has.
    // Same match as the DB guard column cpcs_active_key. Exact-name row first if (legacy) there are two.
    private static Task<int?> FindActiveRoleGroupIdAsync(MySqlConnection conn, int districtId, int yearPkId, string groupBaseName, string groupName)
        => conn.ExecuteScalarAsync<int?>(@"
            SELECT id FROM district_committee_group
            WHERE fk_district_id = @DistrictId AND fk_year_id = @YearId AND isdeleted = 0
              AND (group_name = @Base OR group_name LIKE @BaseYear)
            ORDER BY (group_name = @Name) DESC, id
            LIMIT 1",
            new { DistrictId = districtId, YearId = yearPkId, Base = groupBaseName, BaseYear = groupBaseName + " ____-__", Name = groupName });

    // Removes the member+club from the district+year+role group, matched by role (either plural name
    // form) — not one exact name — so a bare/suffixed mismatch at year rollover can't leave them behind.
    private async Task<int> RemoveDcGroupMemberAsync(MySqlConnection conn,
        (int pk_id, string clubRotaryId, string clubName, int districtId, DateTime? charterDate) club,
        int yearPkId, bool isPresident, int memberPkId, CancellationToken ct)
    {
        var groupBaseName = isPresident ? GroupClubPresidents : GroupClubSecretaries;
        return await conn.ExecuteAsync(@"
            UPDATE district_committee_group_member m
            JOIN district_committee_group g ON g.id = m.fk_group_id
            SET m.isdeleted = 1, m.modified_date = NOW()
            WHERE g.fk_district_id = @DistrictId AND g.fk_year_id = @YearId AND g.isdeleted = 0
              AND (g.group_name = @Base OR g.group_name LIKE @BaseYear)
              AND m.fk_member_id = @MemberId AND m.fk_club_id = @ClubId AND m.isdeleted = 0",
            new { DistrictId = club.districtId, YearId = yearPkId, Base = groupBaseName, BaseYear = groupBaseName + " ____-__", MemberId = memberPkId, ClubId = club.pk_id });
    }

    // Derive the Rotary year (the July that starts the term) from an officer's own dates.
    // Rotary years run Jul 1 → Jun 30, so StartDate 07/01/2027 → 2027-28, and a mid-term
    // StartDate like 01/15/2028 (a replacement appointed during 2027-28) → still 2027.
    // Falls back to EndDate if StartDate is null; returns null only if both are missing.
    private static int? DeriveRotaryStartYear(RotaryOrgClubOfficerDto o)
    {
        var d = o.StartDate ?? o.EndDate;
        if (d == null) return null;
        var dt = d.Value;
        return dt.Month >= 7 ? dt.Year : dt.Year - 1;
    }

    // Collapse the SINGULAR roles (Club President, Club Secretary) to a single current holder per
    // year — the officer with the LATEST StartDate (then latest EndDate as a tie-break). Every other
    // role passes through unchanged, so a club can still have many Directors etc. This enforces the
    // "one CP / one CS per club+year" rule and makes a mid-year replacement supersede the outgoing
    // officer. Example: Priyanka (07/01→07/03) + Anand (07/04→06/30) both "Club President" for
    // 2026-27 → only Anand (later StartDate = current holder) is kept.
    private static List<RotaryOrgClubOfficerDto> CollapseSingularRoles(List<RotaryOrgClubOfficerDto> officers)
    {
        var kept = new List<RotaryOrgClubOfficerDto>(officers.Count);
        // Non-singular roles: keep every officer.
        kept.AddRange(officers.Where(o => !IsSingularRole(o.OfficerRole)));
        // Singular roles: keep only the current holder per role.
        foreach (var role in new[] { DesignationClubPresident, DesignationClubSecretary })
        {
            var winner = officers
                .Where(o => string.Equals(o.OfficerRole?.Trim(), role, StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(o => o.StartDate ?? o.EndDate ?? DateTime.MinValue)
                .ThenByDescending(o => o.EndDate ?? DateTime.MinValue)
                .FirstOrDefault();
            if (winner != null) kept.Add(winner);
        }
        return kept;
    }

    private static bool IsSingularRole(string? role)
    {
        var r = role?.Trim();
        return string.Equals(r, DesignationClubPresident, StringComparison.OrdinalIgnoreCase)
            || string.Equals(r, DesignationClubSecretary, StringComparison.OrdinalIgnoreCase);
    }

    // Auto-make the current-year CP/CS a Club Admin — SELF-CONTAINED (no API call, no config).
    // Replicates the manual "Make Admin": (1) skip if already an active Club Admin, (2) ensure the
    // Club Admin role (collapse to one active row), (3) create/reset login credentials with a temp
    // password, (4) email the member their login + temp password. Best-effort — never breaks the sync.
    private async Task<AdminResult> MakeClubAdminAsync(MySqlConnection conn, int clubId, int memberPkId, RotaryOrgClubOfficerDto off, CancellationToken ct)
    {
        try
        {
            // (1) Already an active Club Admin for this club? → skip entirely (no role touch, no email).
            var already = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM member_roles
                WHERE fk_member_master_profile_id = @M AND fk_club_id = @C
                  AND fk_role_id = 2 AND IsActive = 1 AND isdeleted = 0",
                new { M = memberPkId, C = clubId });
            if (already > 0) return new AdminResult { Outcome = AdminOutcome.AlreadyAdmin };

            // (2) Ensure exactly ONE active Club Admin (role 2) row — mirrors
            // ClubAdminAccessHelper.EnsureActiveClubAdminRoleAsync (collapse duplicates, undelete keep).
            var keepPk = await conn.ExecuteScalarAsync<int?>(@"
                SELECT MAX(pk_member_role_id) FROM member_roles
                WHERE fk_member_master_profile_id = @M AND fk_role_id = 2 AND fk_club_id = @C",
                new { M = memberPkId, C = clubId });
            if (keepPk == null)
            {
                await conn.ExecuteAsync(@"
                    INSERT INTO member_roles
                        (fk_member_master_profile_id, fk_role_id, fk_club_id, IsActive, isdeleted, AssignedBy, created_by, created_date)
                    VALUES (@M, 2, @C, 1, 0, 0, 0, NOW())",
                    new { M = memberPkId, C = clubId });
            }
            else
            {
                await conn.ExecuteAsync(@"
                    UPDATE member_roles
                    SET IsActive    = CASE WHEN pk_member_role_id = @Keep THEN 1 ELSE 0 END,
                        isdeleted   = CASE WHEN pk_member_role_id = @Keep THEN 0 ELSE 1 END,
                        RevokedDate = CASE WHEN pk_member_role_id = @Keep THEN NULL ELSE NOW() END,
                        modified_date = NOW()
                    WHERE fk_member_master_profile_id = @M AND fk_role_id = 2 AND fk_club_id = @C",
                    new { M = memberPkId, C = clubId, Keep = keepPk.Value });
            }

            // (3) Credentials — create if none / reset if soft-deleted / reactivate if inactive.
            var cred = await conn.QueryFirstOrDefaultAsync<dynamic>(
                "SELECT IsActive AS isActive, isdeleted AS isdel FROM member_credentials WHERE fk_member_master_profile_id = @M",
                new { M = memberPkId });
            string? tempPassword = null;
            if (cred == null)
            {
                tempPassword = GenerateTempPassword();
                await conn.ExecuteAsync(@"
                    INSERT INTO member_credentials (fk_member_master_profile_id, PasswordHash, IsTemporaryPassword, IsActive, created_by)
                    VALUES (@M, @H, 1, 1, 0)",
                    new { M = memberPkId, H = BCrypt.Net.BCrypt.HashPassword(tempPassword) });
            }
            else if (Convert.ToInt32(cred.isdel) == 1)
            {
                tempPassword = GenerateTempPassword();
                await conn.ExecuteAsync(@"
                    UPDATE member_credentials
                    SET PasswordHash = @H, IsTemporaryPassword = 1, IsActive = 1, isdeleted = 0, modified_date = NOW()
                    WHERE fk_member_master_profile_id = @M",
                    new { M = memberPkId, H = BCrypt.Net.BCrypt.HashPassword(tempPassword) });
            }
            else if (Convert.ToInt32(cred.isActive) == 0)
            {
                await conn.ExecuteAsync(@"
                    UPDATE member_credentials SET IsActive = 1, modified_date = NOW()
                    WHERE fk_member_master_profile_id = @M AND isdeleted = 0",
                    new { M = memberPkId });
            }
            // else: active credentials already exist → member logs in with their existing password.

            // (4) Email the member their access (mirrors RoleService.SendRoleAssignmentEmailAsync content).
            string madeName = BuildName(off);
            string madeEmail = "";
            var member = await conn.QueryFirstOrDefaultAsync<dynamic>(
                "SELECT EmailId, MemberName, PrimaryMobileNumber FROM member_master_profile WHERE pk_member_master_profile_id = @M AND isdeleted = 0",
                new { M = memberPkId });
            if (member != null)
            {
                var email = (string?)member.EmailId;
                madeName = (string?)member.MemberName ?? madeName;
                madeEmail = email ?? "";
                if (!string.IsNullOrWhiteSpace(email))
                {
                    var name = madeName;
                    var mobile = (string?)member.PrimaryMobileNumber;
                    var loginUrl = (_config["FrontendUrl"] ?? RotaryApi.Services.Brand.PortalOrigin).TrimEnd('/') + "/login";
                    var creds = tempPassword != null
                        ? $@"<div style='background:#f7fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0;'>
                                <p><strong>Login URL:</strong> <a href='{loginUrl}'>{loginUrl}</a></p>
                                {(!string.IsNullOrWhiteSpace(mobile) ? $"<p><strong>Username (Mobile):</strong> {mobile}</p>" : "")}
                                <p><strong>Username (Email):</strong> {email}</p>
                                <p><strong>Temporary Password:</strong> {tempPassword}</p>
                             </div>
                             <p style='color:#e53e3e;'><strong>Important:</strong> Please change your password after your first login.</p>"
                        : $@"<div style='background:#f7fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0;'>
                                <p><strong>Login URL:</strong> <a href='{loginUrl}'>{loginUrl}</a></p>
                                <p>Please use your existing credentials to login.</p>
                             </div>";
                    var body = $@"<h2 style='color:#1a365d;margin-top:0;'>Club Admin Access</h2>
                        <p>Dear {name},</p>
                        <p>As this year's Club President / Secretary, you have been given <strong>Club Admin</strong> access on the ROW portal.</p>
                        {creds}
                        <div style='text-align:center;margin:24px 0;'>
                            <a href='{loginUrl}' style='background:#3182ce;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;'>Login Now</a>
                        </div>";
                    await _emailSender.SendToMemberAsync(email, "Rotary Club - Your Club Admin Access", body);
                }
            }
            return new AdminResult { Outcome = AdminOutcome.MadeNew, Name = madeName, Email = madeEmail };
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Auto make-club-admin failed for member {M} club {C}", memberPkId, clubId);
            return new AdminResult { Outcome = AdminOutcome.Failed };
        }
    }

    private static string GenerateTempPassword()
    {
        const string upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        var rnd = new Random();
        var chars = new char[8];
        for (int i = 0; i < 8; i++) chars[i] = upper[rnd.Next(upper.Length)];
        return new string(chars);
    }

    // Ensure a Rotary year row exists; create it (IsCurrent=0) if missing. Keeps both lookup
    // dictionaries in sync so the rest of the run sees the new year. Returns pk_id 0 on failure.
    private async Task<(int pk_id, string yearLabel, DateTime startDate, byte isCurrent)> EnsureRotaryYearAsync(
        MySqlConnection conn,
        Dictionary<string, (int pk_id, string yearLabel, DateTime startDate, byte isCurrent)> yearsByLabel,
        Dictionary<int, (int pk_id, string yearLabel, DateTime startDate, byte isCurrent)> yearsByPk,
        int startYear, string yearLabel, CancellationToken ct)
    {
        var start = new DateTime(startYear, 7, 1);
        var end = new DateTime(startYear + 1, 6, 30);
        // INSERT IGNORE — YearLabel is UNIQUE, so this is safe if another path created it meanwhile.
        await conn.ExecuteAsync(@"
            INSERT IGNORE INTO rotary_year_master (YearLabel, StartDate, EndDate, IsCurrent, isdeleted)
            VALUES (@Label, @Start, @End, 0, 0)",
            new { Label = yearLabel, Start = start, End = end });
        var pk = await conn.ExecuteScalarAsync<int>(
            "SELECT pk_year_id FROM rotary_year_master WHERE YearLabel = @Label LIMIT 1",
            new { Label = yearLabel });
        var info = (pk, yearLabel, start, (byte)0);
        if (pk != 0)
        {
            yearsByLabel[yearLabel] = info;
            yearsByPk[pk] = info;
        }
        return info;
    }

    private static string BuildName(RotaryOrgClubOfficerDto o)
    {
        var parts = new[] { o.FirstName, o.MiddleName, o.LastName, o.Suffix }
            .Where(p => !string.IsNullOrWhiteSpace(p)).Select(p => p!.Trim()).ToList();
        return parts.Count > 0 ? string.Join(" ", parts) : "Unknown";
    }

    // ─── Email ─────────────────────────────────────────────────

    private async Task SendEmailAsync(int logId, TimeSpan elapsed, int clubsProcessed,
        List<string> addedDesignations, List<string> addedYears, int totalAdded, int totalUpdated, int totalTerminated, int totalDcOps, int totalSkippedMember, int totalErrors,
        int cpAdminMade, int csAdminMade, int cpAdminAlready, int csAdminAlready, List<AdminMadeRow> adminMadeList,
        List<BodChangeRow> bodAdded, List<BodChangeRow> bodUpdated, List<BodChangeRow> bodTerminated,
        List<DcChangeRow> dcChanges, List<BodErrorRow> skippedMemberMissing, List<BodErrorRow> errors,
        List<(int ClubId, string ClubName, int YearsProbed, int OfficersFound, int Added, int Updated, int Terminated, int DcGroupOps, int SkippedMember, int Errors, string Status)> perClub)
    {
        try
        {
            // Excel attachment is now ERRORS-ONLY. If totalErrors == 0 → no attachment, body shows "No errors".
            // Drops the heavy sheets (BOD Added/Updated/Terminated, DC Changes, Skipped, Per-Club summary)
            // that were causing huge attachments and SMTP failures.
            byte[]? bytes = null;
            string? fileName = null;
            if (totalErrors > 0)
            {
                using var workbook = new XLWorkbook();
                AddErrorSheet(workbook, "Errors", errors);
                using var ms = new MemoryStream();
                workbook.SaveAs(ms);
                bytes = ms.ToArray();
                fileName = $"RotaryOrg_BodSync_Errors_{DateTime.Now:yyyyMMdd_HHmmss}.xlsx";
            }

            var triggeredByName = _config["RotaryOrgSync:TriggeredByName"] ?? "Admin";
            string errorHint = totalErrors > 0
                ? "<p style='color:#dc2626;'><b>⚠ Errors detected</b> — open the <b>Errors</b> sheet in the attached Excel for details.</p>"
                : "<p style='color:#16a34a;'><b>✓ No errors</b> — no attachment included.</p>";

            // Auto Club-Admin summary (CP / CS kept separate) + newly-made detail list with emails.
            string adminSummaryHtml = $@"
<h3 style='color:#1a365d;margin:18px 0 6px;'>Auto Club-Admin (current year CP / CS)</h3>
<table style='border-collapse:collapse;margin:6px 0;border:1px solid #e5e7eb;'>
  <tr style='background:#f1f5f9;'>
    <th style='padding:6px 12px;border:1px solid #e5e7eb;text-align:left;'>Role</th>
    <th style='padding:6px 12px;border:1px solid #e5e7eb;'>Newly made Admin</th>
    <th style='padding:6px 12px;border:1px solid #e5e7eb;'>Already Admin (skipped)</th>
    <th style='padding:6px 12px;border:1px solid #e5e7eb;'>Total</th>
  </tr>
  <tr>
    <td style='padding:6px 12px;border:1px solid #e5e7eb;'>Club President</td>
    <td style='padding:6px 12px;border:1px solid #e5e7eb;text-align:right;color:#16a34a;'><b>{cpAdminMade}</b></td>
    <td style='padding:6px 12px;border:1px solid #e5e7eb;text-align:right;color:#64748b;'>{cpAdminAlready}</td>
    <td style='padding:6px 12px;border:1px solid #e5e7eb;text-align:right;'>{cpAdminMade + cpAdminAlready}</td>
  </tr>
  <tr>
    <td style='padding:6px 12px;border:1px solid #e5e7eb;'>Club Secretary</td>
    <td style='padding:6px 12px;border:1px solid #e5e7eb;text-align:right;color:#16a34a;'><b>{csAdminMade}</b></td>
    <td style='padding:6px 12px;border:1px solid #e5e7eb;text-align:right;color:#64748b;'>{csAdminAlready}</td>
    <td style='padding:6px 12px;border:1px solid #e5e7eb;text-align:right;'>{csAdminMade + csAdminAlready}</td>
  </tr>
  <tr style='background:#f8fafc;font-weight:bold;'>
    <td style='padding:6px 12px;border:1px solid #e5e7eb;'>Total</td>
    <td style='padding:6px 12px;border:1px solid #e5e7eb;text-align:right;color:#16a34a;'>{cpAdminMade + csAdminMade}</td>
    <td style='padding:6px 12px;border:1px solid #e5e7eb;text-align:right;color:#64748b;'>{cpAdminAlready + csAdminAlready}</td>
    <td style='padding:6px 12px;border:1px solid #e5e7eb;text-align:right;'>{cpAdminMade + csAdminMade + cpAdminAlready + csAdminAlready}</td>
  </tr>
</table>";

            string adminDetailHtml;
            if (adminMadeList.Count == 0)
            {
                adminDetailHtml = "<p style='color:#64748b;font-size:13px;'>No new Club Admins created this run.</p>";
            }
            else
            {
                var rows = new StringBuilder();
                foreach (var a in adminMadeList.OrderBy(x => x.ClubName).ThenBy(x => x.Role))
                {
                    rows.Append($@"<tr>
  <td style='padding:5px 10px;border:1px solid #e5e7eb;'>{System.Net.WebUtility.HtmlEncode(a.Name)}</td>
  <td style='padding:5px 10px;border:1px solid #e5e7eb;'>{System.Net.WebUtility.HtmlEncode(a.ClubName)}</td>
  <td style='padding:5px 10px;border:1px solid #e5e7eb;'>{System.Net.WebUtility.HtmlEncode(a.Role)}</td>
  <td style='padding:5px 10px;border:1px solid #e5e7eb;'>{(string.IsNullOrWhiteSpace(a.Email) ? "<span style='color:#dc2626;'>(no email)</span>" : System.Net.WebUtility.HtmlEncode(a.Email))}</td>
</tr>");
                }
                adminDetailHtml = $@"<h4 style='color:#1a365d;margin:12px 0 4px;'>Newly-made Club Admins — {adminMadeList.Count} (credentials mail sent)</h4>
<table style='border-collapse:collapse;margin:4px 0;border:1px solid #e5e7eb;font-size:13px;'>
  <tr style='background:#f1f5f9;'>
    <th style='padding:5px 10px;border:1px solid #e5e7eb;text-align:left;'>Name</th>
    <th style='padding:5px 10px;border:1px solid #e5e7eb;text-align:left;'>Club</th>
    <th style='padding:5px 10px;border:1px solid #e5e7eb;text-align:left;'>Role</th>
    <th style='padding:5px 10px;border:1px solid #e5e7eb;text-align:left;'>Email</th>
  </tr>
  {rows}
</table>";
            }

            var body = $@"<div style='font-family:Arial,sans-serif;'>
<h2 style='color:#1a365d;'>Rotary.org BOD Sync</h2>
<p>Dear {System.Net.WebUtility.HtmlEncode(triggeredByName)},</p>
<p>Per-club BOD sync complete. Designations + board_of_directors + DC auto-groups (Club Presidents / Club Secretaries) updated.</p>
<table style='border-collapse:collapse;margin:12px 0;border:1px solid #e5e7eb;'>
  <tr><td style='padding:6px 12px;border:1px solid #e5e7eb;'>Duration</td><td style='padding:6px 12px;border:1px solid #e5e7eb;'><b>{Math.Round(elapsed.TotalMinutes, 1)} min</b></td></tr>
  <tr><td style='padding:6px 12px;border:1px solid #e5e7eb;'>Clubs processed</td><td style='padding:6px 12px;border:1px solid #e5e7eb;text-align:right;'><b>{clubsProcessed}</b></td></tr>
  <tr><td style='padding:6px 12px;border:1px solid #e5e7eb;'>Designations added</td><td style='padding:6px 12px;border:1px solid #e5e7eb;text-align:right;color:#0ea5e9;'><b>{addedDesignations.Count}</b></td></tr>
  <tr><td style='padding:6px 12px;border:1px solid #e5e7eb;'>Years auto-created</td><td style='padding:6px 12px;border:1px solid #e5e7eb;text-align:right;color:#0ea5e9;'><b>{addedYears.Count}</b>{(addedYears.Count > 0 ? " <span style='color:#64748b;font-size:12px;'>(" + System.Net.WebUtility.HtmlEncode(string.Join(", ", addedYears.Distinct())) + ")</span>" : "")}</td></tr>
  <tr><td style='padding:6px 12px;border:1px solid #e5e7eb;'>BOD added</td><td style='padding:6px 12px;border:1px solid #e5e7eb;text-align:right;color:#16a34a;'><b>{totalAdded}</b></td></tr>
  <tr><td style='padding:6px 12px;border:1px solid #e5e7eb;'>BOD updated</td><td style='padding:6px 12px;border:1px solid #e5e7eb;text-align:right;color:#0ea5e9;'><b>{totalUpdated}</b></td></tr>
  <tr><td style='padding:6px 12px;border:1px solid #e5e7eb;'>BOD terminated</td><td style='padding:6px 12px;border:1px solid #e5e7eb;text-align:right;color:#dc2626;'><b>{totalTerminated}</b></td></tr>
  <tr><td style='padding:6px 12px;border:1px solid #e5e7eb;'>DC group ops (CP/CS)</td><td style='padding:6px 12px;border:1px solid #e5e7eb;text-align:right;color:#7c3aed;'><b>{totalDcOps}</b></td></tr>
  <tr><td style='padding:6px 12px;border:1px solid #e5e7eb;'>Skipped (member no longer in DB)</td><td style='padding:6px 12px;border:1px solid #e5e7eb;text-align:right;color:#64748b;'><b>{totalSkippedMember}</b></td></tr>
  <tr><td style='padding:6px 12px;border:1px solid #e5e7eb;'>Errors</td><td style='padding:6px 12px;border:1px solid #e5e7eb;text-align:right;color:#dc2626;'><b>{totalErrors}</b></td></tr>
</table>
{adminSummaryHtml}
{adminDetailHtml}
{errorHint}
<p style='color:#64748b;font-size:13px;'>Sync log id: {logId}.</p>
<p>Regards,<br/><strong>Team ROW</strong></p>
</div>";

            await _emailSender.SendReportAsync($"[Weekly Sun] ROW BOD Sync — {DateTime.Now:dd MMM yyyy}", body, bytes, fileName);
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Email sent ({(bytes == null ? "no attachment" : $"errors-only Excel: {bytes.Length} bytes")}).");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "BOD sync email FAILED");
            Console.Error.WriteLine($"[{DateTime.Now:HH:mm:ss}] Email failed: {ex.Message}");
        }
    }

    private static void AddBodSheet(XLWorkbook wb, string sheetName, List<BodChangeRow> rows)
    {
        var ws = wb.Worksheets.Add(sheetName);
        ws.Cell(1, 1).Value = "Club";
        ws.Cell(1, 2).Value = "Year";
        ws.Cell(1, 3).Value = "MemberRotaryId";
        ws.Cell(1, 4).Value = "MemberName";
        ws.Cell(1, 5).Value = "Designation";
        ws.Range(1, 1, 1, 5).Style.Font.SetBold().Fill.SetBackgroundColor(XLColor.LightGray);
        for (int i = 0; i < rows.Count; i++)
        {
            ws.Cell(i + 2, 1).Value = rows[i].ClubName;
            ws.Cell(i + 2, 2).Value = rows[i].YearLabel;
            ws.Cell(i + 2, 3).Value = rows[i].MemberRotaryId;
            ws.Cell(i + 2, 4).Value = rows[i].MemberName;
            ws.Cell(i + 2, 5).Value = rows[i].DesignationName;
        }
        ws.Columns().AdjustToContents();
    }

    private static void AddDcSheet(XLWorkbook wb, string sheetName, List<DcChangeRow> rows)
    {
        var ws = wb.Worksheets.Add(sheetName);
        ws.Cell(1, 1).Value = "Club";
        ws.Cell(1, 2).Value = "Year";
        ws.Cell(1, 3).Value = "MemberRotaryId";
        ws.Cell(1, 4).Value = "MemberName";
        ws.Cell(1, 5).Value = "Designation";
        ws.Cell(1, 6).Value = "Action";
        ws.Range(1, 1, 1, 6).Style.Font.SetBold().Fill.SetBackgroundColor(XLColor.LightGray);
        for (int i = 0; i < rows.Count; i++)
        {
            ws.Cell(i + 2, 1).Value = rows[i].ClubName;
            ws.Cell(i + 2, 2).Value = rows[i].YearLabel;
            ws.Cell(i + 2, 3).Value = rows[i].MemberRotaryId;
            ws.Cell(i + 2, 4).Value = rows[i].MemberName;
            ws.Cell(i + 2, 5).Value = rows[i].DesignationName;
            ws.Cell(i + 2, 6).Value = rows[i].Action;
        }
        ws.Columns().AdjustToContents();
    }

    private static void AddErrorSheet(XLWorkbook wb, string sheetName, List<BodErrorRow> rows)
    {
        var ws = wb.Worksheets.Add(sheetName);
        ws.Cell(1, 1).Value = "ClubId";
        ws.Cell(1, 2).Value = "Club";
        ws.Cell(1, 3).Value = "Year";
        ws.Cell(1, 4).Value = "MemberRotaryId";
        ws.Cell(1, 5).Value = "Designation";
        ws.Cell(1, 6).Value = "Reason";
        ws.Range(1, 1, 1, 6).Style.Font.SetBold().Fill.SetBackgroundColor(XLColor.LightGray);
        for (int i = 0; i < rows.Count; i++)
        {
            ws.Cell(i + 2, 1).Value = rows[i].ClubId;
            ws.Cell(i + 2, 2).Value = rows[i].ClubName;
            ws.Cell(i + 2, 3).Value = rows[i].YearLabel;
            ws.Cell(i + 2, 4).Value = rows[i].MemberRotaryId;
            ws.Cell(i + 2, 5).Value = rows[i].DesignationName;
            ws.Cell(i + 2, 6).Value = rows[i].Reason;
        }
        ws.Columns().AdjustToContents();
    }

    private enum AdminOutcome { MadeNew, AlreadyAdmin, Failed }

    private class AdminResult
    {
        public AdminOutcome Outcome { get; set; }
        public string Name { get; set; } = "";
        public string Email { get; set; } = "";
    }

    private class AdminMadeRow
    {
        public string Name { get; set; } = "";
        public string ClubName { get; set; } = "";
        public string Role { get; set; } = "";
        public string Email { get; set; } = "";
    }

    private class BodChangeRow
    {
        public string ClubName { get; set; } = "";
        public string YearLabel { get; set; } = "";
        public string MemberRotaryId { get; set; } = "";
        public string MemberName { get; set; } = "";
        public string DesignationName { get; set; } = "";
    }

    private class DcChangeRow
    {
        public string ClubName { get; set; } = "";
        public string YearLabel { get; set; } = "";
        public string MemberRotaryId { get; set; } = "";
        public string MemberName { get; set; } = "";
        public string DesignationName { get; set; } = "";
        public string Action { get; set; } = "";
    }

    private class BodErrorRow
    {
        public int ClubId { get; set; }
        public string ClubName { get; set; } = "";
        public string YearLabel { get; set; } = "";
        public string MemberRotaryId { get; set; } = "";
        public string DesignationName { get; set; } = "";
        public string Reason { get; set; } = "";
    }
}
