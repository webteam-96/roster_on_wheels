using ClosedXML.Excel;
using Dapper;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using MySqlConnector;

namespace RotaryOrgSyncWorker.Services;

/// <summary>
/// NON-SYNC club member cascade (Phase 1 — detection + cascade, audit-first).
///
/// Identifies clubs that DROPPED OUT of Rotary.org's sync list (/clubs) but STILL EXIST
/// on Rotary.org (present in /Clubs/search) — i.e. they went sync → non-sync (NOT terminated).
/// For each such club it flips IsSyncedFromRotaryOrg 1→0 (KEEPING the club so it still shows
/// in reports + SuperAdmin) and soft-deletes that club's CLUB-SCOPED member data.
///
/// Distinct from ClubTerminator: termination = gone from BOTH /clubs AND /Clubs/search →
/// whole club + orphan profiles soft-deleted. Here the club STAYS (as non-sync) and member
/// PROFILES/credentials are NEVER touched — login is blocked separately by the login guard
/// (Phase 2), and members re-appear on re-sync (Phase 3).
///
/// Cascade scope (soft-delete isdeleted=1, club-scoped by fk_club_id):
///   club_members · member_roles · board_of_directors ·
///   district_committee_member · district_committee_group_member · district_committee_sub_group_member
/// NEVER touched: club_master.isdeleted (club kept), member_master_profile, member_credentials.
///
/// Exempt districts (cascade skipped entirely): 5656, 1280, IFRM India.
///
/// Modes:
///   --non-sync-cascade            → AUDIT ONLY (default). Reports what would cascade.
///   --non-sync-cascade --apply    → Executes the flag flip + member soft-deletes.
///   --non-sync-cascade --apply --force → bypass the safety threshold.
/// </summary>
public class ClubNonSyncCascadeWorker
{
    private static readonly string[] TargetCountries = { "India", "Sri Lanka", "Nepal" };

    // Districts that must NEVER be cascaded (system/internal). Matched on district_master.DistrictNumber.
    private static string[] ExemptDistrictNumbers => RotaryApi.Services.Brand.ExemptDistricts;   // ROW: Brand:Scope:ExemptDistricts

    private readonly IRotaryOrgApiClient _api;
    private readonly EmailReportSender _emailSender;
    private readonly IConfiguration _config;
    private readonly ILogger<ClubNonSyncCascadeWorker> _logger;
    private readonly string _connectionString;

    public ClubNonSyncCascadeWorker(
        IRotaryOrgApiClient api,
        EmailReportSender emailSender,
        IConfiguration config,
        ILogger<ClubNonSyncCascadeWorker> logger)
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
        if (force) _logger.LogWarning("ClubNonSyncCascade running with --force — safety threshold bypassed");
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === Non-Sync Cascade {(apply ? "APPLY" : "AUDIT")} START ===");

        int logId;
        await using (var conn0 = CreateConnection())
        {
            await conn0.OpenAsync(ct);
            var triggeredBy = int.Parse(_config["RotaryOrgSync:TriggeredByMemberId"] ?? "0");
            logId = await conn0.ExecuteScalarAsync<int>(@"
                INSERT INTO rotary_org_sync_log (SyncType, StartedAtUtc, Status, TriggeredBy)
                VALUES (@Type, UTC_TIMESTAMP(), 'Running', @By);
                SELECT LAST_INSERT_ID();",
                new { Type = apply ? "NonSyncCascadeApply" : "NonSyncCascadeAudit", By = triggeredBy });
        }

        try
        {
            // 1. /clubs = authoritative CURRENT sync list.
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Fetching /clubs...");
            var syncClubs = await _api.GetClubsAsync(ct);
            var syncIds = new HashSet<string>(syncClubs.Select(x => x.ClubId.ToString()), StringComparer.OrdinalIgnoreCase);
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}]   /clubs: {syncClubs.Count}");

            // 2. /Clubs/search = clubs that STILL EXIST on Rotary.org (any status).
            var searchIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var country in TargetCountries)
            {
                ct.ThrowIfCancellationRequested();
                Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Fetching /Clubs/search for {country}...");
                var list = await _api.SearchClubsByCountryAsync(country, ct);
                foreach (var c in list) searchIds.Add(c.ClubId.ToString());
                Console.WriteLine($"[{DateTime.Now:HH:mm:ss}]   {country}: {list.Count}");
            }

            await using var dbConn = CreateConnection();
            await dbConn.OpenAsync(ct);

            // 3. ROW sync clubs (flag=1), NON-exempt districts.
            var syncedInDb = (await dbConn.QueryAsync<(int pk_id, string clubRotaryId, string clubName, string districtNumber)>(@"
                SELECT cm.pk_club_id AS pk_id,
                       cm.ClubRotaryId AS clubRotaryId,
                       IFNULL(cm.ClubName, '') AS clubName,
                       IFNULL(d.DistrictNumber, '') AS districtNumber
                FROM club_master cm
                JOIN district_master d ON d.pk_district_id = cm.fk_district_id
                WHERE cm.isdeleted = 0
                  AND cm.ClubRotaryId IS NOT NULL AND cm.ClubRotaryId <> ''
                  AND IFNULL(cm.IsSyncedFromRotaryOrg, 0) = 1
                  AND d.DistrictNumber NOT IN @Exempt
                ORDER BY cm.ClubName",
                new { Exempt = ExemptDistrictNumbers })).ToList();

            // 4. Non-sync candidates: dropped from /clubs but STILL in /Clubs/search (so not terminated).
            //    In neither → that's a termination case (ClubTerminator's job) — skipped here.
            var candidates = syncedInDb
                .Where(c => !syncIds.Contains(c.clubRotaryId) && searchIds.Contains(c.clubRotaryId))
                .ToList();

            Console.WriteLine("");
            Console.WriteLine($"=== {candidates.Count} club(s) went sync → non-sync (still on Rotary.org, dropped from /clubs) ===");
            foreach (var c in candidates)
                Console.WriteLine($"  D{c.districtNumber}  {c.clubName} (RID {c.clubRotaryId}, pk_club_id={c.pk_id})");
            Console.WriteLine($"  (exempt districts skipped: {string.Join(", ", ExemptDistrictNumbers)})");

            if (candidates.Count == 0)
            {
                Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] No clubs went non-sync. Nothing to cascade.");
                await dbConn.ExecuteAsync(
                    "UPDATE rotary_org_sync_log SET FinishedAtUtc = UTC_TIMESTAMP(), Status='Completed', TotalFetched=@T WHERE pk_id=@Id",
                    new { Id = logId, T = syncClubs.Count });
                return;
            }

            // Safety threshold — a big jump usually means a Rotary.org /clubs blip, not real churn.
            int maxAuto = int.Parse(_config["RotaryOrgSync:MaxAutoNonSyncPerRun"] ?? "20");
            if (apply && !force && candidates.Count > maxAuto)
            {
                Console.WriteLine($"\n⚠ ABORT — {candidates.Count} clubs flagged non-sync, exceeds safety threshold ({maxAuto}).");
                Console.WriteLine($"  Likely a Rotary.org API blip. NOT applying. Review, then re-run with --non-sync-cascade --apply --force if genuine.");
                await dbConn.ExecuteAsync(
                    "UPDATE rotary_org_sync_log SET FinishedAtUtc=UTC_TIMESTAMP(), Status='Aborted', TotalFetched=@T, ErrorDetail=@D WHERE pk_id=@Id",
                    new { Id = logId, T = syncClubs.Count, D = $"Safety abort: {candidates.Count} > threshold {maxAuto}." });
                var abortTotals = new CascadeTotals();
                var abortRows = new List<CascadeRow>();
                foreach (var c in candidates)
                {
                    var d = await BuildCascadeAsync(dbConn, c.pk_id);
                    abortRows.Add(new CascadeRow { ClubRotaryId = c.clubRotaryId, ClubName = c.clubName, DistrictNumber = c.districtNumber, Detail = d });
                    abortTotals.Add(d);
                }
                await SendEmailAsync(false, candidates.Count, abortTotals, abortRows, syncClubs.Count, aborted: true, threshold: maxAuto);
                return;
            }

            // 5. Build cascade preview / execute.
            var totals = new CascadeTotals();
            var rows = new List<CascadeRow>();
            foreach (var c in candidates)
            {
                ct.ThrowIfCancellationRequested();
                var detail = await BuildCascadeAsync(dbConn, c.pk_id);
                rows.Add(new CascadeRow { ClubRotaryId = c.clubRotaryId, ClubName = c.clubName, DistrictNumber = c.districtNumber, Detail = detail });
                totals.Add(detail);

                if (apply)
                {
                    await ApplyCascadeAsync(dbConn, c.pk_id, ct);
                    Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Non-synced {c.clubName} (RID {c.clubRotaryId}) — flag→0, {detail.TotalRows} member row(s) soft-deleted");
                }
            }

            await dbConn.ExecuteAsync(@"
                UPDATE rotary_org_sync_log
                SET FinishedAtUtc=UTC_TIMESTAMP(), Status='Completed', TotalFetched=@T, DisabledCount=@Dis, ErrorDetail=@D
                WHERE pk_id=@Id",
                new
                {
                    Id = logId, T = syncClubs.Count, Dis = apply ? candidates.Count : 0,
                    D = apply
                        ? $"Non-synced {candidates.Count} clubs. {totals.Summary}"
                        : $"AUDIT ONLY — would non-sync {candidates.Count} clubs. {totals.Summary}",
                });

            Console.WriteLine("");
            Console.WriteLine($"=== {(apply ? "APPLIED" : "AUDIT")} ===");
            Console.WriteLine($"  Clubs → non-sync:                {candidates.Count}");
            Console.WriteLine($"  Members affected:                {totals.MembersAffected}");
            Console.WriteLine($"  Login-blocked (only this club):  {totals.BlockedMembers}");
            Console.WriteLine($"  club_members rows:               {totals.ClubMembers}");
            Console.WriteLine($"  member_roles rows:               {totals.MemberRoles}");
            Console.WriteLine($"  board_of_directors rows:         {totals.Bod}");
            Console.WriteLine($"  district_committee_member:       {totals.Dc}");
            Console.WriteLine($"  district_committee_group_member: {totals.DcGroup}");
            Console.WriteLine($"  district_committee_sub_group:    {totals.DcSubGroup}");
            Console.WriteLine($"  TOTAL member rows:               {totals.GrandTotal}");
            if (!apply)
                Console.WriteLine($"\n  AUDIT ONLY — no DB changes. Re-run with --apply to execute.");

            await SendEmailAsync(apply, candidates.Count, totals, rows, syncClubs.Count, aborted: false, threshold: maxAuto);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[{DateTime.Now:HH:mm:ss}] NON-SYNC CASCADE FAILED: {ex.Message}");
            _logger.LogError(ex, "Non-sync cascade FAILED");
            try
            {
                await using var conn = CreateConnection();
                await conn.OpenAsync(CancellationToken.None);
                await conn.ExecuteAsync(
                    "UPDATE rotary_org_sync_log SET FinishedAtUtc=UTC_TIMESTAMP(), Status='Failed', ErrorDetail=@E WHERE pk_id=@Id",
                    new { Id = logId, E = ex.Message });
            }
            catch { }
            throw;
        }
    }

    private async Task<CascadeDetail> BuildCascadeAsync(MySqlConnection conn, int clubId)
    {
        var d = new CascadeDetail();
        d.ClubMembers = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM club_members WHERE fk_club_id=@C AND isdeleted=0", new { C = clubId });
        d.MemberRoles = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM member_roles WHERE fk_club_id=@C AND isdeleted=0", new { C = clubId });
        d.Bod = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM board_of_directors WHERE fk_club_id=@C AND isdeleted=0", new { C = clubId });
        d.Dc = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM district_committee_member WHERE fk_club_id=@C AND IFNULL(isdeleted,0)=0", new { C = clubId });
        d.DcGroup = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM district_committee_group_member WHERE fk_club_id=@C AND IFNULL(isdeleted,0)=0", new { C = clubId });
        d.DcSubGroup = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM district_committee_sub_group_member WHERE fk_club_id=@C AND IFNULL(isdeleted,0)=0", new { C = clubId });
        d.MembersAffected = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(DISTINCT fk_member_master_profile_id) FROM club_members WHERE fk_club_id=@C AND isdeleted=0", new { C = clubId });
        // Members whose ONLY active club is this one → they'll be login-blocked (profile NOT deleted).
        d.BlockedMembers = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(DISTINCT cm.fk_member_master_profile_id)
            FROM club_members cm
            WHERE cm.fk_club_id=@C AND cm.isdeleted=0
              AND NOT EXISTS (
                SELECT 1 FROM club_members cm2
                WHERE cm2.fk_member_master_profile_id = cm.fk_member_master_profile_id
                  AND cm2.fk_club_id <> @C AND cm2.isdeleted=0 AND IFNULL(cm2.IsActive,1)=1)",
            new { C = clubId });

        // Per-member detail for the "Members Removed" sheet. Read BEFORE ApplyCascade soft-deletes
        // club_members (isdeleted=0 filter), so audit + apply both list the actual affected members.
        d.Members = (await conn.QueryAsync<RemovedMember>(@"
            SELECT IFNULL(mp.MemberName, '')            AS MemberName,
                   IFNULL(mp.RotaryId, '')              AS RotaryId,
                   IFNULL(mp.EmailId, '')               AS Email,
                   IFNULL(mp.PrimaryMobileNumber, '')   AS Mobile
            FROM club_members cm
            JOIN member_master_profile mp ON mp.pk_member_master_profile_id = cm.fk_member_master_profile_id
            WHERE cm.fk_club_id = @C AND cm.isdeleted = 0
            ORDER BY mp.MemberName",
            new { C = clubId })).ToList();
        return d;
    }

    private async Task ApplyCascadeAsync(MySqlConnection conn, int clubId, CancellationToken ct)
    {
        await using var tx = await conn.BeginTransactionAsync(ct);
        try
        {
            // Soft-delete club-scoped member data (fk_club_id). Profiles/credentials untouched.
            await conn.ExecuteAsync(
                "UPDATE club_members SET isdeleted=1, IsActive=0, modified_date=NOW() WHERE fk_club_id=@C AND isdeleted=0",
                new { C = clubId }, tx);
            await conn.ExecuteAsync(
                "UPDATE member_roles SET isdeleted=1, IsActive=0, RevokedDate=NOW(), modified_date=NOW() WHERE fk_club_id=@C AND isdeleted=0",
                new { C = clubId }, tx);
            await conn.ExecuteAsync(
                "UPDATE board_of_directors SET isdeleted=1, modified_date=NOW(), deleted_date=NOW() WHERE fk_club_id=@C AND isdeleted=0",
                new { C = clubId }, tx);
            await conn.ExecuteAsync(
                "UPDATE district_committee_member SET isdeleted=1, modified_date=NOW() WHERE fk_club_id=@C AND IFNULL(isdeleted,0)=0",
                new { C = clubId }, tx);
            await conn.ExecuteAsync(
                "UPDATE district_committee_group_member SET isdeleted=1, modified_date=NOW() WHERE fk_club_id=@C AND IFNULL(isdeleted,0)=0",
                new { C = clubId }, tx);
            await conn.ExecuteAsync(
                "UPDATE district_committee_sub_group_member SET isdeleted=1, modified_date=NOW() WHERE fk_club_id=@C AND IFNULL(isdeleted,0)=0",
                new { C = clubId }, tx);

            // Flip the club to NON-SYNC but KEEP it (isdeleted stays 0 → still in reports + SuperAdmin).
            await conn.ExecuteAsync(
                "UPDATE club_master SET IsSyncedFromRotaryOrg=0, modified_date=NOW() WHERE pk_club_id=@C AND isdeleted=0",
                new { C = clubId }, tx);

            await tx.CommitAsync(ct);
        }
        catch
        {
            await tx.RollbackAsync(ct);
            throw;
        }
    }

    private async Task SendEmailAsync(bool apply, int clubCount, CascadeTotals totals, List<CascadeRow> rows, int syncTotal, bool aborted, int threshold)
    {
        try
        {
            using var wb = new XLWorkbook();
            var s = wb.Worksheets.Add("Summary");
            var modeText = aborted ? "SAFETY ABORT" : (apply ? "APPLIED" : "AUDIT ONLY");
            s.Cell(1, 1).Value = $"Rotary.org Non-Sync Cascade — {modeText}";
            s.Range("A1:B1").Merge().Style.Font.SetBold().Font.SetFontSize(14);
            s.Cell(3, 1).Value = "Mode"; s.Cell(3, 2).Value = modeText;
            s.Cell(4, 1).Value = "/clubs total"; s.Cell(4, 2).Value = syncTotal;
            s.Cell(5, 1).Value = "Clubs → non-sync"; s.Cell(5, 2).Value = clubCount;
            if (aborted) { s.Cell(6, 1).Value = "Safety threshold"; s.Cell(6, 2).Value = threshold; }
            s.Cell(8, 1).Value = "Members affected"; s.Cell(8, 2).Value = totals.MembersAffected;
            s.Cell(9, 1).Value = "Login-blocked (only this club)"; s.Cell(9, 2).Value = totals.BlockedMembers;
            s.Cell(10, 1).Value = "club_members"; s.Cell(10, 2).Value = totals.ClubMembers;
            s.Cell(11, 1).Value = "member_roles"; s.Cell(11, 2).Value = totals.MemberRoles;
            s.Cell(12, 1).Value = "board_of_directors"; s.Cell(12, 2).Value = totals.Bod;
            s.Cell(13, 1).Value = "district_committee_member"; s.Cell(13, 2).Value = totals.Dc;
            s.Cell(14, 1).Value = "district_committee_group_member"; s.Cell(14, 2).Value = totals.DcGroup;
            s.Cell(15, 1).Value = "district_committee_sub_group_member"; s.Cell(15, 2).Value = totals.DcSubGroup;
            s.Cell(16, 1).Value = "Exempt districts"; s.Cell(16, 2).Value = string.Join(", ", ExemptDistrictNumbers);
            s.Columns().AdjustToContents();

            var det = wb.Worksheets.Add("Clubs → non-sync");
            var hdr = new[] { "ClubRotaryId", "ClubName", "District", "MembersAffected", "LoginBlocked", "club_members", "roles", "BOD", "DC", "DC_group", "DC_subgroup" };
            for (int i = 0; i < hdr.Length; i++) det.Cell(1, i + 1).Value = hdr[i];
            det.Range(1, 1, 1, hdr.Length).Style.Font.SetBold().Fill.SetBackgroundColor(XLColor.LightGray);
            for (int i = 0; i < rows.Count; i++)
            {
                var r = rows[i];
                det.Cell(i + 2, 1).Value = r.ClubRotaryId;
                det.Cell(i + 2, 2).Value = r.ClubName;
                det.Cell(i + 2, 3).Value = "D" + r.DistrictNumber;
                det.Cell(i + 2, 4).Value = r.Detail.MembersAffected;
                det.Cell(i + 2, 5).Value = r.Detail.BlockedMembers;
                det.Cell(i + 2, 6).Value = r.Detail.ClubMembers;
                det.Cell(i + 2, 7).Value = r.Detail.MemberRoles;
                det.Cell(i + 2, 8).Value = r.Detail.Bod;
                det.Cell(i + 2, 9).Value = r.Detail.Dc;
                det.Cell(i + 2, 10).Value = r.Detail.DcGroup;
                det.Cell(i + 2, 11).Value = r.Detail.DcSubGroup;
            }
            det.Columns().AdjustToContents();

            // Per-member detail sheet — one row per removed member, with district + club + contact.
            var mem = wb.Worksheets.Add("Members Removed");
            var mHdr = new[] { "District", "Club Name", "Member Name", "RotaryId", "Email", "Mobile" };
            for (int i = 0; i < mHdr.Length; i++) mem.Cell(1, i + 1).Value = mHdr[i];
            mem.Range(1, 1, 1, mHdr.Length).Style.Font.SetBold().Fill.SetBackgroundColor(XLColor.LightGray);
            int mRow = 2;
            foreach (var r in rows)
            {
                foreach (var m in r.Detail.Members)
                {
                    mem.Cell(mRow, 1).Value = "D" + r.DistrictNumber;
                    mem.Cell(mRow, 2).Value = r.ClubName;
                    mem.Cell(mRow, 3).Value = m.MemberName;
                    mem.Cell(mRow, 4).Value = m.RotaryId;   // string → stored as text (RotaryId not numeric-cast)
                    mem.Cell(mRow, 5).Value = m.Email;
                    mem.Cell(mRow, 6).Value = m.Mobile;     // string → keeps leading +/0 intact
                    mRow++;
                }
            }
            mem.Columns().AdjustToContents();

            using var ms = new MemoryStream();
            wb.SaveAs(ms);
            var bytes = ms.ToArray();
            var fileName = $"RotaryOrg_NonSync_{modeText.Replace(" ", "")}_{DateTime.Now:yyyyMMdd_HHmmss}.xlsx";

            var triggeredByName = _config["RotaryOrgSync:TriggeredByName"] ?? "Admin";
            var color = aborted ? "#dc2626" : (apply ? "#b45309" : "#1a365d");
            var note = aborted
                ? $"<p style='background:#fef2f2;border-left:4px solid #dc2626;padding:8px 12px;'><b>Aborted</b> — {clubCount} clubs exceeded the safety threshold of {threshold} (likely a Rotary.org API blip). No changes made. Review the attachment; if genuine, re-run with <code>--non-sync-cascade --apply --force</code>.</p>"
                : apply
                    ? "<p style='background:#fffbeb;border-left:4px solid #f59e0b;padding:8px 12px;'>Clubs flipped to non-sync and their club-scoped member data soft-deleted. Member profiles &amp; credentials were NOT touched. Members re-appear automatically if the club re-syncs.</p>"
                    : "<p style='background:#eff6ff;border-left:4px solid #3b82f6;padding:8px 12px;'>AUDIT only — no DB changes. Re-run with <code>--apply</code> to execute.</p>";

            var rowsHtml = string.Join("", rows.Select((r, i) =>
                $"<tr><td style='padding:6px 12px;border:1px solid #e5e7eb;color:#64748b;'>{i + 1}</td>" +
                $"<td style='padding:6px 12px;border:1px solid #e5e7eb;'><b>{System.Net.WebUtility.HtmlEncode(r.ClubName)}</b></td>" +
                $"<td style='padding:6px 12px;border:1px solid #e5e7eb;color:#64748b;'>D{System.Net.WebUtility.HtmlEncode(r.DistrictNumber)}</td>" +
                $"<td style='padding:6px 12px;border:1px solid #e5e7eb;color:#64748b;'>RID {System.Net.WebUtility.HtmlEncode(r.ClubRotaryId)}</td>" +
                $"<td style='padding:6px 12px;border:1px solid #e5e7eb;text-align:right;'><b>{r.Detail.MembersAffected}</b></td>" +
                $"<td style='padding:6px 12px;border:1px solid #e5e7eb;text-align:right;color:#dc2626;'><b>{r.Detail.BlockedMembers}</b></td></tr>"));

            var body = $@"<div style='font-family:Arial,sans-serif;'>
<h2 style='color:{color};'>Rotary.org Non-Sync Cascade — {modeText}</h2>
<p>Dear {System.Net.WebUtility.HtmlEncode(triggeredByName)},</p>
{note}
<p>These clubs are still on Rotary.org (in <code>/Clubs/search</code>) but dropped out of the sync list (<code>/clubs</code>), so they went <b>sync → non-sync</b>. The club is kept; only its members are soft-deleted from club-scoped tables.</p>
<table style='border-collapse:collapse;margin:12px 0;'>
  <tr><td style='padding:4px 12px;'>Clubs → non-sync</td><td style='padding:4px 12px;'><b>{clubCount}</b></td></tr>
  <tr><td style='padding:4px 12px;'>Members affected</td><td style='padding:4px 12px;'><b>{totals.MembersAffected}</b></td></tr>
  <tr><td style='padding:4px 12px;'>Login-blocked (only this club)</td><td style='padding:4px 12px;color:#dc2626;'><b>{totals.BlockedMembers}</b></td></tr>
  <tr><td style='padding:4px 12px;'>Total member rows</td><td style='padding:4px 12px;'>{totals.GrandTotal}</td></tr>
  <tr><td style='padding:4px 12px;'>Exempt districts</td><td style='padding:4px 12px;'>{string.Join(", ", ExemptDistrictNumbers)}</td></tr>
</table>
<h3 style='margin-top:20px;color:#1a365d;'>Clubs ({clubCount})</h3>
<table style='border-collapse:collapse;font-size:14px;border:1px solid #e5e7eb;'>
<thead><tr style='background:#1a365d;color:white;font-weight:bold;'>
  <td style='padding:8px 12px;'>#</td><td style='padding:8px 12px;'>Club</td><td style='padding:8px 12px;'>District</td>
  <td style='padding:8px 12px;'>Rotary ID</td><td style='padding:8px 12px;text-align:right;'>Members</td><td style='padding:8px 12px;text-align:right;'>Login blocked</td>
</tr></thead><tbody>{rowsHtml}</tbody></table>
<p style='font-size:13px;color:#64748b;'><b>Login blocked</b> = members whose only active club was this one — they can't log in until the club re-syncs or they're added elsewhere. Their profile/credentials are NOT deleted.</p>
<p>Regards,<br/><strong>Team ROW</strong></p>
</div>";

            var subject = aborted
                ? "[ALERT] Non-Sync Cascade Aborted — safety threshold"
                : $"[{(apply ? "Applied" : "Audit")}] ROW Non-Sync Cascade — {DateTime.Now:dd MMM yyyy}";
            await _emailSender.SendReportAsync(subject, body, bytes, fileName);
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Email sent.");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Non-sync cascade email FAILED");
            Console.Error.WriteLine($"[{DateTime.Now:HH:mm:ss}] Email failed: {ex.Message}");
        }
    }

    private class CascadeDetail
    {
        public int MembersAffected { get; set; }
        public int BlockedMembers { get; set; }
        public int ClubMembers { get; set; }
        public int MemberRoles { get; set; }
        public int Bod { get; set; }
        public int Dc { get; set; }
        public int DcGroup { get; set; }
        public int DcSubGroup { get; set; }
        public int TotalRows => ClubMembers + MemberRoles + Bod + Dc + DcGroup + DcSubGroup;
        public List<RemovedMember> Members { get; set; } = new();
    }

    private class RemovedMember
    {
        public string MemberName { get; set; } = "";
        public string RotaryId { get; set; } = "";
        public string Email { get; set; } = "";
        public string Mobile { get; set; } = "";
    }

    private class CascadeTotals
    {
        public int MembersAffected;
        public int BlockedMembers;
        public int ClubMembers;
        public int MemberRoles;
        public int Bod;
        public int Dc;
        public int DcGroup;
        public int DcSubGroup;
        public int GrandTotal => ClubMembers + MemberRoles + Bod + Dc + DcGroup + DcSubGroup;
        public string Summary => $"members={MembersAffected} blocked={BlockedMembers}, club_members={ClubMembers}, roles={MemberRoles}, bod={Bod}, dc={Dc}, dcg={DcGroup}, dcsg={DcSubGroup}";
        public void Add(CascadeDetail d)
        {
            MembersAffected += d.MembersAffected; BlockedMembers += d.BlockedMembers;
            ClubMembers += d.ClubMembers; MemberRoles += d.MemberRoles; Bod += d.Bod;
            Dc += d.Dc; DcGroup += d.DcGroup; DcSubGroup += d.DcSubGroup;
        }
    }

    private class CascadeRow
    {
        public string ClubRotaryId { get; set; } = "";
        public string ClubName { get; set; } = "";
        public string DistrictNumber { get; set; } = "";
        public CascadeDetail Detail { get; set; } = new();
    }
}
