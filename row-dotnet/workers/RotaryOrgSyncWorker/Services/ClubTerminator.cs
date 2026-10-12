using ClosedXML.Excel;
using Dapper;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using MySqlConnector;

namespace RotaryOrgSyncWorker.Services;

/// <summary>
/// Identifies clubs that have been removed from BOTH /clubs AND /Clubs/search on Rotary.org
/// (truly terminated) and cascades soft-delete to their club-scoped data.
///
/// Scope (2026-07-31):
///   - Candidates = ALL Rotary.org-origin clubs (ROW_as_vendor_selected=1) — SYNC **and** NON-SYNC.
///     A club gone from both feeds is terminated regardless of its sync flag.
///   - Countries searched are DYNAMIC (every ClubCountry present in /clubs), never a hardcoded list.
///   - The 3 manually-managed districts (5656 / 1280 / IFRM India) are excluded entirely.
///   - A terminated club that later REAPPEARS on Rotary.org is reactivated by the repair-sync path.
///
/// Cascade scope (all soft-delete: isdeleted = 1):
///   - club_master                   — the club itself
///   - club_members                  — membership links for this club
///   - member_roles                  — roles where fk_club_id = terminated club
///   - board_of_directors            — BOD entries for this club
///   - sub_groups                    — subgroups belonging to this club
///   - sub_group_members             — members of those subgroups
///   - district_committee_member     — entries where fk_club_id = terminated club
///
/// Never touched:
///   member_master_profile and member_credentials are NEVER touched for ANY member (even
///   orphans whose only club was this one) — the person record + UNIQUE RotaryId must survive
///   for Family Login / re-sync. Orphaned members are login-blocked by the guards instead
///   (mobile: no active club_members; web: no active admin role). All the same tables for
///   OTHER clubs a multi-club member belongs to are likewise untouched.
///
/// Modes:
///   --terminate-clubs           → AUDIT ONLY (default). Reports what would be terminated.
///   --terminate-clubs --apply   → Actually executes the soft-deletes.
/// </summary>
public class ClubTerminator
{
    // Districts that must NEVER be reconciled/terminated (manually-managed, not on Rotary.org).
    // Matched on district_master.DistrictNumber. Mirrors ClubNonSyncCascadeWorker.
    private static readonly string[] ExemptDistrictNumbers = { "5656", "1280", "IFRM India" };

    private readonly IRotaryOrgApiClient _api;
    private readonly EmailReportSender _emailSender;
    private readonly IConfiguration _config;
    private readonly ILogger<ClubTerminator> _logger;
    private readonly string _connectionString;

    public ClubTerminator(
        IRotaryOrgApiClient api,
        EmailReportSender emailSender,
        IConfiguration config,
        ILogger<ClubTerminator> logger)
    {
        _api = api;
        _emailSender = emailSender;
        _config = config;
        _logger = logger;
        _connectionString = config.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("ConnectionStrings:DefaultConnection missing");
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    public async Task RunAsync(bool apply, bool force = false, CancellationToken ct = default)
    {
        // 'force' bypasses the safety threshold (for one-time manual cleanups when many clubs really did terminate)
        if (force) _logger.LogWarning("ClubTerminator running with --force — safety threshold bypassed");
        var startedAt = DateTime.UtcNow;
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === Club Termination {(apply ? "APPLY" : "AUDIT")} START ===");

        // Insert log row
        int logId;
        await using (var conn0 = CreateConnection())
        {
            await conn0.OpenAsync(ct);
            var triggeredBy = int.Parse(_config["RotaryOrgSync:TriggeredByMemberId"] ?? "0");
            logId = await conn0.ExecuteScalarAsync<int>(@"
                INSERT INTO rotary_org_sync_log (SyncType, StartedAtUtc, Status, TriggeredBy)
                VALUES (@Type, UTC_TIMESTAMP(), 'Running', @By);
                SELECT LAST_INSERT_ID();",
                new { Type = apply ? "TerminateApply" : "TerminateAudit", By = triggeredBy });
        }

        try
        {
            // 1. Fetch /clubs (authoritative)
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Fetching /clubs...");
            var syncClubs = await _api.GetClubsAsync(ct);
            var syncIds = new HashSet<string>(syncClubs.Select(x => x.ClubId.ToString()), StringComparer.OrdinalIgnoreCase);
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}]   /clubs: {syncClubs.Count}");

            // 2. Fetch /Clubs/search — DYNAMIC country list. No hardcoding, so new countries are
            // covered automatically. CRITICAL for correctness: we must search every country we
            // actually hold clubs in, or its clubs would be absent from the authoritative set and
            // WRONGLY terminated. We therefore union TWO sources:
            //   (a) every ClubCountry in /clubs (global feed), and
            //   (b) every distinct Country of our own vendor-selected clubs.
            // (b) is essential for countries that have ONLY non-sync clubs and thus never appear in
            // /clubs — e.g. Nepal (163 clubs, none in /clubs). Without (b) all 163 would flag.
            var countrySet = new HashSet<string>(
                syncClubs.Select(c => c.ClubCountry?.Trim())
                         .Where(s => !string.IsNullOrWhiteSpace(s)).Select(s => s!),
                StringComparer.OrdinalIgnoreCase);
            // (b) is limited to districts OUTSIDE "Other Zones" so world clubs from the manual
            // --world-clubs import don't grow this list to ~180 countries. Clubs in "Other Zones"
            // whose country is NOT searched are excluded from the candidates below (step 4), so
            // they can never be flagged just because their country wasn't fetched.
            await using (var ccConn = CreateConnection())
            {
                await ccConn.OpenAsync(ct);
                var dbCountries = await ccConn.QueryAsync<string>(@"
                    SELECT DISTINCT TRIM(cm.Country) FROM club_master cm
                    JOIN district_master d ON d.pk_district_id = cm.fk_district_id
                    LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
                    WHERE cm.isdeleted = 0 AND IFNULL(cm.ROW_as_vendor_selected,0) = 1
                      AND cm.Country IS NOT NULL AND TRIM(cm.Country) <> ''
                      AND IFNULL(z.ZoneName,'') <> 'Other Zones'");
                foreach (var c in dbCountries) countrySet.Add(c);
            }
            var countries = countrySet.OrderBy(s => s, StringComparer.OrdinalIgnoreCase).ToList();
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Countries to search ({countries.Count}): {string.Join(", ", countries)}");

            var searchIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var country in countries)
            {
                ct.ThrowIfCancellationRequested();
                Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Fetching /Clubs/search for {country}...");
                var list = await _api.SearchClubsByCountryAsync(country, ct);
                foreach (var c in list) searchIds.Add(c.ClubId.ToString());
                Console.WriteLine($"[{DateTime.Now:HH:mm:ss}]   {country}: {list.Count} (raw)");
            }

            // 3. Build authoritative set
            var allRiOrgIds = new HashSet<string>(syncIds, StringComparer.OrdinalIgnoreCase);
            foreach (var id in searchIds) allRiOrgIds.Add(id);
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Combined authoritative IDs: {allRiOrgIds.Count}");

            // 4. Find termination candidates: sync clubs in DB whose ClubRotaryId is NOT in allRiOrgIds
            await using var dbConn = CreateConnection();
            await dbConn.OpenAsync(ct);

            var candidates = (await dbConn.QueryAsync<(int pk_id, string clubRotaryId, string clubName, int fk_district_id, string districtNumber)>(@"
                SELECT cm.pk_club_id AS pk_id,
                       cm.ClubRotaryId AS clubRotaryId,
                       IFNULL(cm.ClubName, '') AS clubName,
                       cm.fk_district_id,
                       IFNULL(d.DistrictNumber, '') AS districtNumber
                FROM club_master cm
                JOIN district_master d ON d.pk_district_id = cm.fk_district_id
                LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
                WHERE cm.isdeleted = 0
                  AND cm.ClubRotaryId IS NOT NULL AND cm.ClubRotaryId <> ''
                  AND IFNULL(cm.ROW_as_vendor_selected, 0) = 1   -- came from Rotary.org (sync OR non-sync); excludes purely-manual clubs
                  AND d.DistrictNumber NOT IN @Exempt             -- never touch the 3 manually-managed districts
                  -- 'Other Zones' clubs are judged only when their country was actually searched
                  AND NOT (IFNULL(z.ZoneName,'') = 'Other Zones'
                           AND TRIM(IFNULL(cm.Country,'')) <> ''
                           AND TRIM(cm.Country) NOT IN @Searched)
                ORDER BY cm.ClubName",
                new { Exempt = ExemptDistrictNumbers, Searched = countries })).ToList();

            var toTerminate = candidates.Where(c => !allRiOrgIds.Contains(c.clubRotaryId)).ToList();
            Console.WriteLine($"");
            Console.WriteLine($"  (exempt districts never terminated: {string.Join(", ", ExemptDistrictNumbers)})");
            Console.WriteLine($"=== {toTerminate.Count} clubs identified for termination ===");
            foreach (var c in toTerminate)
                Console.WriteLine($"  D{c.districtNumber}  {c.clubName} (RID {c.clubRotaryId}, pk_club_id={c.pk_id})");

            if (toTerminate.Count == 0)
            {
                Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] No clubs to terminate. All sync clubs still on Rotary.org.");
                await dbConn.ExecuteAsync(@"
                    UPDATE rotary_org_sync_log
                    SET FinishedAtUtc = UTC_TIMESTAMP(), Status = 'Completed', TotalFetched = @Total
                    WHERE pk_id = @Id",
                    new { Id = logId, Total = syncClubs.Count });
                return;
            }

            // Safety threshold for unattended runs: if more than N clubs would terminate in one shot,
            // it's likely an API blip (e.g., /clubs returned partial data). Abort and email a warning
            // instead of mass-deleting.
            int maxAuto = int.Parse(_config["RotaryOrgSync:MaxAutoTerminationsPerRun"] ?? "20");
            if (apply && !force && toTerminate.Count > maxAuto)
            {
                Console.WriteLine($"");
                Console.WriteLine($"⚠ ABORT — {toTerminate.Count} clubs flagged for termination, exceeds safety threshold ({maxAuto}).");
                Console.WriteLine($"  This is likely a Rotary.org API issue. NOT applying. Audit-only email sent.");
                Console.WriteLine($"  If this is genuine, review the audit list and re-run with --terminate-clubs --apply --force");

                await dbConn.ExecuteAsync(@"
                    UPDATE rotary_org_sync_log
                    SET FinishedAtUtc = UTC_TIMESTAMP(), Status = 'Aborted',
                        TotalFetched = @Total,
                        ErrorDetail = @Detail
                    WHERE pk_id = @Id",
                    new
                    {
                        Id = logId,
                        Total = syncClubs.Count,
                        Detail = $"Safety abort: {toTerminate.Count} clubs > threshold {maxAuto}. Possible API issue."
                    });

                // Build cascade preview for the audit email
                var auditTotals = new CascadeTotals();
                var auditRows = new List<TerminationRow>();
                foreach (var c in toTerminate)
                {
                    var d = await BuildCascadeForClubAsync(dbConn, c.pk_id, ct);
                    auditRows.Add(new TerminationRow { ClubRotaryId = c.clubRotaryId, ClubName = c.clubName, DistrictNumber = c.districtNumber, PkClubId = c.pk_id, Detail = d });
                    auditTotals.Add(d);
                }
                await SendSafetyAbortEmailAsync(toTerminate.Count, maxAuto, auditTotals, auditRows, syncClubs.Count, allRiOrgIds.Count);
                return;
            }

            // 5. Build cascade preview / execute
            var totals = new CascadeTotals();
            var rows = new List<TerminationRow>();

            foreach (var c in toTerminate)
            {
                ct.ThrowIfCancellationRequested();
                var detail = await BuildCascadeForClubAsync(dbConn, c.pk_id, ct);
                rows.Add(new TerminationRow
                {
                    ClubRotaryId = c.clubRotaryId,
                    ClubName = c.clubName,
                    DistrictNumber = c.districtNumber,
                    PkClubId = c.pk_id,
                    Detail = detail,
                });
                totals.Add(detail);

                if (apply)
                {
                    await ApplyCascadeAsync(dbConn, c.pk_id, ct);
                    Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Soft-deleted club {c.clubName} (RID {c.clubRotaryId}) and cascade ({detail.TotalRowsAffected} rows)");
                }
            }

            // 6. Finalize log
            await dbConn.ExecuteAsync(@"
                UPDATE rotary_org_sync_log
                SET FinishedAtUtc = UTC_TIMESTAMP(), Status = 'Completed',
                    TotalFetched = @Total, DisabledCount = @Disabled,
                    ErrorDetail = @Detail
                WHERE pk_id = @Id",
                new
                {
                    Id = logId,
                    Total = syncClubs.Count,
                    Disabled = apply ? toTerminate.Count : 0,
                    Detail = apply
                        ? $"Terminated {toTerminate.Count} clubs. Cascade: {totals.Summary}"
                        : $"AUDIT ONLY — would terminate {toTerminate.Count} clubs. Cascade: {totals.Summary}",
                });

            Console.WriteLine($"");
            Console.WriteLine($"=== {(apply ? "APPLIED" : "AUDIT")} ===");
            Console.WriteLine($"  Clubs to terminate:           {toTerminate.Count}");
            Console.WriteLine($"  Members affected:             {totals.MembersAffected}");
            Console.WriteLine($"  Orphan members (login blocked): {totals.OrphanMembers}");
            Console.WriteLine($"  club_members rows:            {totals.ClubMembers}");
            Console.WriteLine($"  member_roles rows:            {totals.MemberRoles}");
            Console.WriteLine($"  board_of_directors rows:      {totals.Bod}");
            Console.WriteLine($"  sub_groups rows:              {totals.SubGroups}");
            Console.WriteLine($"  sub_group_members rows:       {totals.SubGroupMembers}");
            Console.WriteLine($"  district_committee_member:    {totals.DistrictCommittee}");
            Console.WriteLine($"  club_websites rows:           {totals.ClubWebsites}");
            Console.WriteLine($"  TOTAL rows affected:          {totals.GrandTotal}");
            if (!apply)
                Console.WriteLine($"");
                Console.WriteLine($"  This was AUDIT ONLY — no DB changes made. Run with --apply to execute.");

            await SendEmailReportAsync(apply, toTerminate.Count, totals, rows, syncClubs.Count, allRiOrgIds.Count);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[{DateTime.Now:HH:mm:ss}] FAILED: {ex.Message}");
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

    private async Task<CascadeDetail> BuildCascadeForClubAsync(MySqlConnection conn, int clubId, CancellationToken ct)
    {
        var d = new CascadeDetail();

        d.ClubMembers = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM club_members WHERE fk_club_id = @C AND isdeleted = 0",
            new { C = clubId });
        d.MemberRoles = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM member_roles WHERE fk_club_id = @C AND isdeleted = 0",
            new { C = clubId });
        d.Bod = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM board_of_directors WHERE fk_club_id = @C AND isdeleted = 0",
            new { C = clubId });
        d.SubGroups = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM sub_groups WHERE fk_club_id = @C AND isdeleted = 0",
            new { C = clubId });
        d.SubGroupMembers = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM sub_group_members sgm
            JOIN sub_groups sg ON sg.pk_sub_group_id = sgm.fk_sub_group_id
            WHERE sg.fk_club_id = @C AND sgm.isdeleted = 0",
            new { C = clubId });
        d.DistrictCommittee = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM district_committee_member WHERE fk_club_id = @C AND isdeleted = 0",
            new { C = clubId });
        d.ClubWebsites = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM club_websites WHERE fk_club_id = @C AND COALESCE(isdeleted, 0) = 0",
            new { C = clubId });
        d.MembersAffected = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(DISTINCT fk_member_master_profile_id) FROM club_members WHERE fk_club_id = @C AND isdeleted = 0",
            new { C = clubId });

        // Orphan members count — those whose ONLY active club is this terminated one.
        // They will be fully soft-deleted (profile + credentials) so they can no longer log in.
        d.OrphanMembers = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(DISTINCT cm.fk_member_master_profile_id)
            FROM club_members cm
            WHERE cm.fk_club_id = @C AND cm.isdeleted = 0
              AND NOT EXISTS (
                SELECT 1 FROM club_members cm2
                WHERE cm2.fk_member_master_profile_id = cm.fk_member_master_profile_id
                  AND cm2.fk_club_id <> @C
                  AND cm2.isdeleted = 0
                  AND IFNULL(cm2.IsActive, 1) = 1
              )",
            new { C = clubId });
        return d;
    }

    private async Task ApplyCascadeAsync(MySqlConnection conn, int clubId, CancellationToken ct)
    {
        await using var tx = await conn.BeginTransactionAsync(ct);
        try
        {

            // STEP 2 — Cascade soft-delete club-scoped tables
            await conn.ExecuteAsync(@"
                UPDATE sub_group_members sgm
                JOIN sub_groups sg ON sg.pk_sub_group_id = sgm.fk_sub_group_id
                SET sgm.isdeleted = 1
                WHERE sg.fk_club_id = @C AND sgm.isdeleted = 0",
                new { C = clubId }, tx);

            await conn.ExecuteAsync(
                "UPDATE sub_groups SET isdeleted = 1, modified_date = NOW() WHERE fk_club_id = @C AND isdeleted = 0",
                new { C = clubId }, tx);

            await conn.ExecuteAsync(@"
                UPDATE board_of_directors SET isdeleted = 1, modified_date = NOW(), deleted_date = NOW()
                WHERE fk_club_id = @C AND isdeleted = 0",
                new { C = clubId }, tx);

            // Mirror the BOD delete into the DC auto-groups: this club's Club Presidents / Club Secretaries
            // rows (every year) go too. district_committee_member below is only the legacy table.
            await conn.ExecuteAsync(@"
                UPDATE district_committee_group_member m
                JOIN district_committee_group g ON g.id = m.fk_group_id
                SET m.isdeleted = 1, m.modified_date = NOW()
                WHERE m.fk_club_id = @C AND m.isdeleted = 0 AND g.isdeleted = 0
                  AND (g.group_name = 'Club Presidents' OR g.group_name LIKE 'Club Presidents ____-__'
                    OR g.group_name = 'Club Secretaries' OR g.group_name LIKE 'Club Secretaries ____-__')",
                new { C = clubId }, tx);

            await conn.ExecuteAsync(@"
                UPDATE member_roles SET isdeleted = 1, IsActive = 0, RevokedDate = NOW(), modified_date = NOW()
                WHERE fk_club_id = @C AND isdeleted = 0",
                new { C = clubId }, tx);

            await conn.ExecuteAsync(@"
                UPDATE district_committee_member SET isdeleted = 1, modified_date = NOW()
                WHERE fk_club_id = @C AND isdeleted = 0",
                new { C = clubId }, tx);

            await conn.ExecuteAsync(@"
                UPDATE club_members SET isdeleted = 1, IsActive = 0, modified_date = NOW()
                WHERE fk_club_id = @C AND isdeleted = 0",
                new { C = clubId }, tx);

            await conn.ExecuteAsync(@"
                UPDATE club_master SET isdeleted = 1, IsActive = 0, modified_date = NOW(),
                    IsSyncedFromRotaryOrg = 0, ROW_as_vendor_selected = 0
                WHERE pk_club_id = @C AND isdeleted = 0",
                new { C = clubId }, tx);

            // Soft-delete any club website so a terminated club can't keep a live site.
            // (isdeleted=1 removes it from serving + reminders + admin lists; Status='Inactive' for clarity.)
            await conn.ExecuteAsync(@"
                UPDATE club_websites SET isdeleted = 1, Status = 'Inactive', modified_date = NOW()
                WHERE fk_club_id = @C AND COALESCE(isdeleted, 0) = 0",
                new { C = clubId }, tx);

            // Hard-delete club_modules for the terminated club (no isdeleted column on this table)
            await ClubModuleHelper.DeleteClubModulesAsync(conn, clubId, tx);

            // member_master_profile + member_credentials are intentionally NOT touched, even for members
            // whose only club was this terminated one. The person record + UNIQUE RotaryId must survive
            // for Family Login / re-sync. Orphaned members are already login-blocked: mobile via
            // NonSyncLoginGuardHelper (no active club_members), web via the active-admin-role check
            // (their roles were soft-deleted above). See feedback: member-removal-never-disables-profile.

            await tx.CommitAsync(ct);
        }
        catch
        {
            await tx.RollbackAsync(ct);
            throw;
        }
    }

    private async Task SendEmailReportAsync(bool apply, int clubCount, CascadeTotals totals, List<TerminationRow> rows, int syncTotal, int authoritativeTotal)
    {
        try
        {
            using var workbook = new XLWorkbook();
            var summary = workbook.Worksheets.Add("Summary");
            summary.Cell(1, 1).Value = $"Rotary.org Club Termination — {(apply ? "APPLIED" : "AUDIT ONLY")}";
            summary.Range("A1:B1").Merge().Style.Font.SetBold().Font.SetFontSize(14);
            summary.Cell(3, 1).Value = "Mode"; summary.Cell(3, 2).Value = apply ? "APPLIED (DB changes made)" : "AUDIT ONLY (no DB changes)";
            summary.Cell(4, 1).Value = "/clubs total"; summary.Cell(4, 2).Value = syncTotal;
            summary.Cell(5, 1).Value = "Authoritative IDs (clubs ∪ search)"; summary.Cell(5, 2).Value = authoritativeTotal;
            summary.Cell(6, 1).Value = "Clubs terminated"; summary.Cell(6, 2).Value = clubCount;
            summary.Cell(8, 1).Value = "— Cascade —";
            summary.Range("A8:B8").Merge().Style.Font.SetBold();
            summary.Cell(9, 1).Value = "Members affected"; summary.Cell(9, 2).Value = totals.MembersAffected;
            summary.Cell(10, 1).Value = "Orphan members (login blocked)"; summary.Cell(10, 2).Value = totals.OrphanMembers;
            summary.Cell(11, 1).Value = "club_members"; summary.Cell(11, 2).Value = totals.ClubMembers;
            summary.Cell(12, 1).Value = "member_roles"; summary.Cell(12, 2).Value = totals.MemberRoles;
            summary.Cell(13, 1).Value = "board_of_directors"; summary.Cell(13, 2).Value = totals.Bod;
            summary.Cell(14, 1).Value = "sub_groups"; summary.Cell(14, 2).Value = totals.SubGroups;
            summary.Cell(15, 1).Value = "sub_group_members"; summary.Cell(15, 2).Value = totals.SubGroupMembers;
            summary.Cell(16, 1).Value = "district_committee_member"; summary.Cell(16, 2).Value = totals.DistrictCommittee;
            summary.Cell(17, 1).Value = "club_websites"; summary.Cell(17, 2).Value = totals.ClubWebsites;
            summary.Cell(18, 1).Value = "TOTAL rows affected"; summary.Cell(18, 2).Value = totals.GrandTotal;
            summary.Columns().AdjustToContents();

            var detail = workbook.Worksheets.Add("Clubs to terminate");
            detail.Cell(1, 1).Value = "ClubRotaryId";
            detail.Cell(1, 2).Value = "ClubName";
            detail.Cell(1, 3).Value = "District";
            detail.Cell(1, 4).Value = "MembersAffected";
            detail.Cell(1, 5).Value = "OrphanMembers (LoginBlocked)";
            detail.Cell(1, 6).Value = "ClubMembers";
            detail.Cell(1, 7).Value = "Roles";
            detail.Cell(1, 8).Value = "BOD";
            detail.Cell(1, 9).Value = "SubGroups";
            detail.Cell(1, 10).Value = "SubGroupMembers";
            detail.Cell(1, 11).Value = "DistrictCommittee";
            detail.Range(1, 1, 1, 11).Style.Font.SetBold().Fill.SetBackgroundColor(XLColor.LightGray);
            for (int i = 0; i < rows.Count; i++)
            {
                var r = rows[i];
                detail.Cell(i + 2, 1).Value = r.ClubRotaryId;
                detail.Cell(i + 2, 2).Value = r.ClubName;
                detail.Cell(i + 2, 3).Value = "D" + r.DistrictNumber;
                detail.Cell(i + 2, 4).Value = r.Detail.MembersAffected;
                detail.Cell(i + 2, 5).Value = r.Detail.OrphanMembers;
                detail.Cell(i + 2, 6).Value = r.Detail.ClubMembers;
                detail.Cell(i + 2, 7).Value = r.Detail.MemberRoles;
                detail.Cell(i + 2, 8).Value = r.Detail.Bod;
                detail.Cell(i + 2, 9).Value = r.Detail.SubGroups;
                detail.Cell(i + 2, 10).Value = r.Detail.SubGroupMembers;
                detail.Cell(i + 2, 11).Value = r.Detail.DistrictCommittee;
            }
            detail.Columns().AdjustToContents();

            using var ms = new MemoryStream();
            workbook.SaveAs(ms);
            var bytes = ms.ToArray();
            var fileName = $"RotaryOrg_Terminate_{(apply ? "Applied" : "Audit")}_{DateTime.Now:yyyyMMdd_HHmmss}.xlsx";

            var triggeredByName = _config["RotaryOrgSync:TriggeredByName"] ?? "Admin";
            var modeColor = apply ? "#dc2626" : "#1a365d";
            var modeText = apply ? "APPLIED" : "AUDIT ONLY";
            var modeNote = apply
                ? "<p style='background:#fef2f2;border-left:4px solid #dc2626;padding:8px 12px;'>The cascade soft-deletes were applied to the database. Affected rows have <code>isdeleted = 1</code>.</p>"
                : "<p style='background:#fffbeb;border-left:4px solid #f59e0b;padding:8px 12px;'>This is an AUDIT only. No database changes were made. Re-run with <code>--apply</code> to execute the cascade.</p>";

            var rowsHtml = string.Join("", rows.Select((r, i) =>
                $"<tr>" +
                $"<td style='padding:6px 12px;border:1px solid #e5e7eb;color:#64748b;'>{i + 1}</td>" +
                $"<td style='padding:6px 12px;border:1px solid #e5e7eb;'><b>{System.Net.WebUtility.HtmlEncode(r.ClubName)}</b></td>" +
                $"<td style='padding:6px 12px;border:1px solid #e5e7eb;color:#64748b;'>D{System.Net.WebUtility.HtmlEncode(r.DistrictNumber)}</td>" +
                $"<td style='padding:6px 12px;border:1px solid #e5e7eb;color:#64748b;'>RID {System.Net.WebUtility.HtmlEncode(r.ClubRotaryId)}</td>" +
                $"<td style='padding:6px 12px;border:1px solid #e5e7eb;text-align:right;'><b>{r.Detail.MembersAffected}</b></td>" +
                $"<td style='padding:6px 12px;border:1px solid #e5e7eb;text-align:right;color:#dc2626;'><b>{r.Detail.OrphanMembers}</b></td>" +
                $"</tr>"));

            var body = $@"<div style='font-family:Arial,sans-serif;'>
<h2 style='color:{modeColor};'>Rotary.org Club Termination — {modeText}</h2>
<p>Dear {System.Net.WebUtility.HtmlEncode(triggeredByName)},</p>
{modeNote}
<table style='border-collapse:collapse;margin:12px 0;'>
  <tr><td style='padding:4px 12px;'>Clubs identified for termination</td><td style='padding:4px 12px;'><b>{clubCount}</b></td></tr>
  <tr><td style='padding:4px 12px;'>Members affected</td><td style='padding:4px 12px;'><b>{totals.MembersAffected}</b></td></tr>
  <tr><td style='padding:4px 12px;'>Orphan members (login blocked)</td><td style='padding:4px 12px;color:#dc2626;'><b>{totals.OrphanMembers}</b></td></tr>
  <tr><td style='padding:4px 12px;'>club_members rows</td><td style='padding:4px 12px;'>{totals.ClubMembers}</td></tr>
  <tr><td style='padding:4px 12px;'>member_roles rows</td><td style='padding:4px 12px;'>{totals.MemberRoles}</td></tr>
  <tr><td style='padding:4px 12px;'>board_of_directors rows</td><td style='padding:4px 12px;'>{totals.Bod}</td></tr>
  <tr><td style='padding:4px 12px;'>sub_groups rows</td><td style='padding:4px 12px;'>{totals.SubGroups}</td></tr>
  <tr><td style='padding:4px 12px;'>sub_group_members rows</td><td style='padding:4px 12px;'>{totals.SubGroupMembers}</td></tr>
  <tr><td style='padding:4px 12px;'>district_committee_member rows</td><td style='padding:4px 12px;'>{totals.DistrictCommittee}</td></tr>
  <tr><td style='padding:4px 12px;'>club_websites rows</td><td style='padding:4px 12px;'>{totals.ClubWebsites}</td></tr>
  <tr style='background:#f1f5f9;font-weight:bold;'><td style='padding:4px 12px;'>TOTAL rows affected</td><td style='padding:4px 12px;'>{totals.GrandTotal}</td></tr>
</table>
<h3 style='margin-top:24px;color:#1a365d;'>Terminated clubs ({clubCount})</h3>
<table style='border-collapse:collapse;margin:12px 0;font-size:14px;border:1px solid #e5e7eb;'>
<thead>
<tr style='background:#1a365d;color:white;font-weight:bold;'>
  <td style='padding:8px 12px;border:1px solid #1a365d;'>#</td>
  <td style='padding:8px 12px;border:1px solid #1a365d;'>Club Name</td>
  <td style='padding:8px 12px;border:1px solid #1a365d;'>District</td>
  <td style='padding:8px 12px;border:1px solid #1a365d;'>Rotary ID</td>
  <td style='padding:8px 12px;border:1px solid #1a365d;text-align:right;'>Members affected</td>
  <td style='padding:8px 12px;border:1px solid #1a365d;text-align:right;'>Login blocked</td>
</tr>
</thead>
<tbody>
{rowsHtml}
</tbody>
</table>
<p style='font-size:13px;color:#64748b;'>
<b>Members affected</b> = members who lost their connection to this club.<br>
<b>Login blocked</b> = members whose only club was this one (orphan members) — they can no longer log in to web or mobile.
</p>
<p style='color:#64748b;font-size:13px;'>
<b>Multi-club members</b> keep their profile, credentials, and all other club affiliations intact.<br>
<b>Orphan members</b> (whose only club was the one terminated) keep their <code>member_master_profile</code> and <code>member_credentials</code> (preserved for Family Login / re-sync) but can no longer log in to web or mobile — their club membership and roles are soft-deleted, so the login guards deny them.
</p>
<p>Regards,<br/><strong>Team ROW</strong></p>
</div>";

            // Daily auto-terminate runs APPLY mode at 04:00; manual audit-only run is interactive.
            var subject = string.Equals(modeText, "APPLIED", StringComparison.OrdinalIgnoreCase)
                ? $"[Daily] ROW Auto-Terminate Clubs — {DateTime.Now:dd MMM yyyy}"
                : $"[Manual] ROW Termination Audit — {DateTime.Now:dd MMM yyyy}";
            await _emailSender.SendReportAsync(subject, body, bytes, fileName);
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Email sent.");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Termination email FAILED");
            Console.Error.WriteLine($"[{DateTime.Now:HH:mm:ss}] Email failed: {ex.Message}");
        }
    }

    private async Task SendSafetyAbortEmailAsync(int proposedCount, int threshold, CascadeTotals totals, List<TerminationRow> rows, int syncTotal, int authoritativeTotal)
    {
        try
        {
            using var workbook = new XLWorkbook();
            var summary = workbook.Worksheets.Add("Summary");
            summary.Cell(1, 1).Value = "Rotary.org Termination — SAFETY ABORT";
            summary.Range("A1:B1").Merge().Style.Font.SetBold().Font.SetFontSize(14).Font.SetFontColor(XLColor.Red);
            summary.Cell(3, 1).Value = "Status"; summary.Cell(3, 2).Value = "ABORTED — too many clubs flagged for termination";
            summary.Cell(4, 1).Value = "Proposed terminations"; summary.Cell(4, 2).Value = proposedCount;
            summary.Cell(5, 1).Value = "Safety threshold"; summary.Cell(5, 2).Value = threshold;
            summary.Cell(6, 1).Value = "/clubs total"; summary.Cell(6, 2).Value = syncTotal;
            summary.Cell(7, 1).Value = "Authoritative IDs (clubs ∪ search)"; summary.Cell(7, 2).Value = authoritativeTotal;
            summary.Columns().AdjustToContents();

            var detail = workbook.Worksheets.Add("Clubs that would terminate");
            detail.Cell(1, 1).Value = "ClubRotaryId";
            detail.Cell(1, 2).Value = "ClubName";
            detail.Cell(1, 3).Value = "District";
            detail.Cell(1, 4).Value = "Members";
            detail.Cell(1, 5).Value = "TotalRowsAffected";
            detail.Range(1, 1, 1, 5).Style.Font.SetBold().Fill.SetBackgroundColor(XLColor.LightGray);
            for (int i = 0; i < rows.Count; i++)
            {
                var r = rows[i];
                detail.Cell(i + 2, 1).Value = r.ClubRotaryId;
                detail.Cell(i + 2, 2).Value = r.ClubName;
                detail.Cell(i + 2, 3).Value = "D" + r.DistrictNumber;
                detail.Cell(i + 2, 4).Value = r.Detail.MembersAffected;
                detail.Cell(i + 2, 5).Value = r.Detail.TotalRowsAffected;
            }
            detail.Columns().AdjustToContents();

            using var ms = new MemoryStream();
            workbook.SaveAs(ms);
            var bytes = ms.ToArray();
            var fileName = $"RotaryOrg_Terminate_ABORTED_{DateTime.Now:yyyyMMdd_HHmmss}.xlsx";

            var triggeredByName = _config["RotaryOrgSync:TriggeredByName"] ?? "Admin";
            var body = $@"<div style='font-family:Arial,sans-serif;'>
<h2 style='color:#dc2626;'>⚠ Rotary.org Termination — SAFETY ABORT</h2>
<p>Dear {System.Net.WebUtility.HtmlEncode(triggeredByName)},</p>
<p style='background:#fef2f2;border-left:4px solid #dc2626;padding:12px;'>
<b>The auto-termination job aborted because {proposedCount} clubs were flagged for termination, exceeding the safety threshold of {threshold}.</b><br><br>
This is most likely a Rotary.org API issue (e.g., <code>/clubs</code> returned partial data). The system did NOT apply any deletions to protect your DB.
</p>

<h3>What to do</h3>
<ol>
  <li>Review the attached Excel — list of clubs that would have been terminated.</li>
  <li>If the list looks legitimate (clubs really were terminated by Rotary.org) → run manually with override:<br>
      <code>RotaryOrgSyncWorker.exe --terminate-clubs --apply --force</code>
  </li>
  <li>If the list looks wrong (most clubs are normal active clubs) → no action. The next day's run will likely succeed normally as Rotary.org's API recovers.</li>
  <li>To raise the threshold, edit appsettings.json: <code>RotaryOrgSync:MaxAutoTerminationsPerRun</code></li>
</ol>

<table style='border-collapse:collapse;margin:12px 0;'>
  <tr><td style='padding:4px 12px;'>Proposed terminations</td><td style='padding:4px 12px;color:#dc2626;'><b>{proposedCount}</b></td></tr>
  <tr><td style='padding:4px 12px;'>Safety threshold</td><td style='padding:4px 12px;'>{threshold}</td></tr>
  <tr><td style='padding:4px 12px;'>/clubs total</td><td style='padding:4px 12px;'>{syncTotal}</td></tr>
  <tr><td style='padding:4px 12px;'>Members that would be affected</td><td style='padding:4px 12px;'>{totals.MembersAffected}</td></tr>
  <tr><td style='padding:4px 12px;'>Total rows that would be soft-deleted</td><td style='padding:4px 12px;'>{totals.GrandTotal}</td></tr>
</table>

<p>Regards,<br/><strong>Team ROW</strong></p>
</div>";

            await _emailSender.SendReportAsync($"[ALERT] ROW Termination Aborted — safety threshold", body, bytes, fileName);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Safety abort email FAILED");
        }
    }

    private class CascadeDetail
    {
        public int MembersAffected { get; set; }
        public int OrphanMembers { get; set; }
        public int ClubMembers { get; set; }
        public int MemberRoles { get; set; }
        public int Bod { get; set; }
        public int SubGroups { get; set; }
        public int SubGroupMembers { get; set; }
        public int DistrictCommittee { get; set; }
        public int ClubWebsites { get; set; }
        public int TotalRowsAffected => ClubMembers + MemberRoles + Bod + SubGroups + SubGroupMembers + DistrictCommittee + ClubWebsites + 1;
    }

    private class CascadeTotals
    {
        public int MembersAffected;
        public int OrphanMembers;
        public int ClubMembers;
        public int MemberRoles;
        public int Bod;
        public int SubGroups;
        public int SubGroupMembers;
        public int DistrictCommittee;
        public int ClubWebsites;
        public int GrandTotal => ClubMembers + MemberRoles + Bod + SubGroups + SubGroupMembers + DistrictCommittee + ClubWebsites;
        public string Summary => $"members={MembersAffected} orphans={OrphanMembers}, club_members={ClubMembers}, roles={MemberRoles}, bod={Bod}, sg={SubGroups}, sgm={SubGroupMembers}, dcm={DistrictCommittee}, websites={ClubWebsites}";

        public void Add(CascadeDetail d)
        {
            MembersAffected += d.MembersAffected;
            OrphanMembers += d.OrphanMembers;
            ClubMembers += d.ClubMembers;
            MemberRoles += d.MemberRoles;
            Bod += d.Bod;
            SubGroups += d.SubGroups;
            SubGroupMembers += d.SubGroupMembers;
            DistrictCommittee += d.DistrictCommittee;
            ClubWebsites += d.ClubWebsites;
        }
    }

    private class TerminationRow
    {
        public string ClubRotaryId { get; set; } = "";
        public string ClubName { get; set; } = "";
        public string DistrictNumber { get; set; } = "";
        public int PkClubId { get; set; }
        public CascadeDetail Detail { get; set; } = new();
    }
}
