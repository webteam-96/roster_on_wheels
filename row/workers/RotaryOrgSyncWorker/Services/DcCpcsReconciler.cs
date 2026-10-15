using ClosedXML.Excel;
using Dapper;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using MySqlConnector;

namespace RotaryOrgSyncWorker.Services;

/// <summary>
/// Keeps the District Committee "Club Presidents" / "Club Secretaries" auto-groups an EXACT mirror of
/// board_of_directors (user rule 2026-09-17), for ALL years and ALL districts.
///
/// A group row is valid only when BOD has an ACTIVE row with the same club + year + role + member, the
/// club is active and belongs to the group's district, and the member profile is active.
///   - REMOVE (soft-delete) every active CP/CS group row without such a BOD row, plus same-person
///     duplicate rows (same group + club + member twice → keep the newest).
///   - ADD every valid BOD CP/CS holder missing from its group (creating the year's group if none).
///
/// This is the SAFETY NET for every path that changes BOD / clubs / profiles without touching the DC
/// groups (stored procedures, profile deletes, a club moved to another district, …).
/// Only the CP/CS auto-groups are read or written — every other DC group is untouched.
///
/// Modes:
///   --dc-cpcs-reconcile                   → AUDIT ONLY (default). Reports what would change.
///   --dc-cpcs-reconcile --apply           → Applies removals + additions.
///   --dc-cpcs-reconcile --apply --force   → Bypasses the removal safety threshold.
/// Also invoked (apply) at the end of every full --bod-sync run.
/// </summary>
public class DcCpcsReconciler
{
    private const string DesignationClubPresident = "Club President";
    private const string DesignationClubSecretary = "Club Secretary";
    private const string GroupClubPresidents = "Club Presidents";
    private const string GroupClubSecretaries = "Club Secretaries";

    private readonly EmailReportSender _emailSender;
    private readonly IConfiguration _config;
    private readonly ILogger<DcCpcsReconciler> _logger;
    private readonly string _connectionString;

    public DcCpcsReconciler(EmailReportSender emailSender, IConfiguration config, ILogger<DcCpcsReconciler> logger)
    {
        _emailSender = emailSender;
        _config = config;
        _logger = logger;
        _connectionString = config.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("ConnectionStrings:DefaultConnection missing");
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    /// <summary>Returns (rows to remove / removed, people to add / added).</summary>
    public async Task<(int removed, int added)> RunAsync(bool apply, bool force = false, CancellationToken ct = default)
    {
        const int TimeoutSec = 300;
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === DC CP/CS Reconcile {(apply ? "APPLY" : "AUDIT")} START ===");

        await using var conn = CreateConnection();
        await conn.OpenAsync(ct);

        var triggeredBy = int.Parse(_config["RotaryOrgSync:TriggeredByMemberId"] ?? "0");
        var logId = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO rotary_org_sync_log (SyncType, StartedAtUtc, Status, TriggeredBy)
            VALUES (@Type, UTC_TIMESTAMP(), 'Running', @By);
            SELECT LAST_INSERT_ID();",
            new { Type = apply ? "DcCpcsReconcileApply" : "DcCpcsReconcileAudit", By = triggeredBy });

        try
        {
            // 1. Active CP/CS groups — same name match as the DB guard column cpcs_active_key.
            var groups = (await conn.QueryAsync<GroupRow>(@"
                SELECT id AS Id, fk_district_id AS DistrictId, fk_year_id AS YearId, group_name AS GroupName,
                       IF(group_name LIKE 'Club Secretaries%', 'S', 'P') AS Role
                FROM district_committee_group
                WHERE isdeleted = 0
                  AND (group_name = 'Club Presidents' OR group_name LIKE 'Club Presidents ____-__'
                    OR group_name = 'Club Secretaries' OR group_name LIKE 'Club Secretaries ____-__')",
                commandTimeout: TimeoutSec)).ToList();
            var groupById = groups.ToDictionary(g => g.Id);
            // One group per district+year+role (DB guard). If a legacy second copy exists, use the exact-name/oldest one.
            var groupByKey = groups
                .GroupBy(g => (g.DistrictId, g.YearId, g.Role))
                .ToDictionary(x => x.Key, x => x.OrderBy(g => g.Id).First().Id);

            // 2. Their active member rows.
            var rows = groups.Count == 0 ? new List<MemberRow>() : (await conn.QueryAsync<MemberRow>(@"
                SELECT id AS Id, fk_group_id AS GroupId, fk_member_id AS MemberId, fk_club_id AS ClubId
                FROM district_committee_group_member
                WHERE isdeleted = 0 AND fk_group_id IN @Ids",
                new { Ids = groups.Select(g => g.Id).ToList() }, commandTimeout: TimeoutSec)).ToList();

            // 3. Valid BOD CP/CS holders: active BOD row, active club (its district), active profile.
            var holders = (await conn.QueryAsync<HolderRow>(@"
                SELECT c.fk_district_id AS DistrictId, b.fk_year_id AS YearId,
                       IF(d.designation_name = @Sec, 'S', 'P') AS Role, d.designation_name AS DesignationName,
                       b.fk_club_id AS ClubId, IFNULL(c.ClubName, '') AS ClubName,
                       b.fk_member_master_profile_id AS MemberId, IFNULL(p.MemberName, '') AS MemberName,
                       IFNULL(p.PrimaryMobileNumber, '') AS Mobile, IFNULL(p.EmailId, '') AS Email,
                       IFNULL(y.YearLabel, '') AS YearLabel, IFNULL(y.IsCurrent, 0) AS IsCurrent,
                       IFNULL(dm.DistrictNumber, '') AS DistrictNumber
                FROM board_of_directors b
                JOIN designation_master d ON d.pk_designation_id = b.fk_designation_id AND d.designation_name IN (@Pres, @Sec)
                JOIN club_master c ON c.pk_club_id = b.fk_club_id AND c.isdeleted = 0 AND c.fk_district_id IS NOT NULL
                JOIN member_master_profile p ON p.pk_member_master_profile_id = b.fk_member_master_profile_id AND p.isdeleted = 0
                LEFT JOIN rotary_year_master y ON y.pk_year_id = b.fk_year_id
                LEFT JOIN district_master dm ON dm.pk_district_id = c.fk_district_id
                WHERE b.isdeleted = 0",
                new { Pres = DesignationClubPresident, Sec = DesignationClubSecretary }, commandTimeout: TimeoutSec)).ToList();

            // SAFETY: an empty BOD read (query/DB problem) must never be taken as "nobody holds any role".
            if (holders.Count == 0)
            {
                Console.WriteLine("⚠ ABORT — BOD returned 0 Club President/Secretary holders. Nothing changed.");
                await FinishLogAsync(conn, logId, "Aborted", 0, 0, "Safety abort: BOD read returned 0 CP/CS holders.");
                return (0, 0);
            }

            var validKeys = new HashSet<(int, int, string, int, int)>(
                holders.Select(h => (h.DistrictId, h.YearId, h.Role, h.ClubId, h.MemberId)));

            // 4. Rows to remove: not backed by BOD, or a duplicate of the same person in the same group+club.
            var toRemove = new List<int>();
            foreach (var r in rows)
            {
                var g = groupById[r.GroupId];
                if (!r.ClubId.HasValue || !r.MemberId.HasValue ||
                    !validKeys.Contains((g.DistrictId, g.YearId, g.Role, r.ClubId.Value, r.MemberId.Value)))
                    toRemove.Add(r.Id);
            }
            var removeSet = toRemove.ToHashSet();
            foreach (var dup in rows.Where(r => !removeSet.Contains(r.Id))
                                    .GroupBy(r => (r.GroupId, r.ClubId, r.MemberId))
                                    .Where(x => x.Count() > 1))
                toRemove.AddRange(dup.OrderByDescending(r => r.Id).Skip(1).Select(r => r.Id));

            // 5. People to add: valid holder with no active row in its district+year+role group.
            var present = new HashSet<(int, int, string, int, int)>();
            foreach (var r in rows)
            {
                if (!r.ClubId.HasValue || !r.MemberId.HasValue) continue;
                var g = groupById[r.GroupId];
                present.Add((g.DistrictId, g.YearId, g.Role, r.ClubId.Value, r.MemberId.Value));
            }
            var toAdd = holders
                .Where(h => !present.Contains((h.DistrictId, h.YearId, h.Role, h.ClubId, h.MemberId)))
                .GroupBy(h => (h.DistrictId, h.YearId, h.Role, h.ClubId, h.MemberId))
                .Select(x => x.First())
                .ToList();

            var removeDetails = await LoadRemoveDetailsAsync(conn, toRemove, TimeoutSec);
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] CP/CS groups: {groups.Count}, active rows: {rows.Count}, BOD holders: {holders.Count}");
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Rows to remove: {toRemove.Count}   People to add: {toAdd.Count}");
            foreach (var x in removeDetails.GroupBy(d => d.Reason).OrderByDescending(x => x.Count()))
                Console.WriteLine($"    remove — {x.Key}: {x.Count()}");

            if (toRemove.Count == 0 && toAdd.Count == 0)
            {
                await FinishLogAsync(conn, logId, "Completed", 0, 0, "DC CP/CS already matches BOD.");
                Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Nothing to do — DC CP/CS groups match BOD.");
                return (0, 0);
            }

            // Safety threshold on removals: a spike likely means a bad state (e.g. BOD partly wiped).
            // The one-time historic cleanup is SQL/dc_cpcs_mirror_bod_cleanup.sql (or --apply --force).
            int maxRemove = int.Parse(_config["RotaryOrgSync:MaxAutoDcCpcsRemovePerRun"] ?? "500");
            if (apply && !force && toRemove.Count > maxRemove)
            {
                Console.WriteLine($"⚠ ABORT — {toRemove.Count} rows to remove exceed safety threshold ({maxRemove}). Nothing changed.");
                await FinishLogAsync(conn, logId, "Aborted", 0, 0, $"Safety abort: {toRemove.Count} removals > threshold {maxRemove}.");
                await SendEmailAsync("ABORTED", removeDetails, toAdd, maxRemove);
                return (toRemove.Count, toAdd.Count);
            }

            int removed = 0, added = 0;
            if (apply)
            {
                foreach (var chunk in toRemove.Chunk(500))
                    removed += await conn.ExecuteAsync(@"
                        UPDATE district_committee_group_member
                        SET isdeleted = 1, is_active = 0, modified_date = NOW()
                        WHERE id IN @Ids AND isdeleted = 0",
                        new { Ids = chunk }, commandTimeout: TimeoutSec);

                foreach (var h in toAdd)
                {
                    ct.ThrowIfCancellationRequested();
                    try
                    {
                        var groupId = await EnsureGroupAsync(conn, groupByKey, h);
                        added += await conn.ExecuteAsync(@"
                            INSERT INTO district_committee_group_member
                                (fk_group_id, fk_member_id, is_member, name, mobile, email, district_designation, fk_club_id, sort_order, is_active, created_date, isdeleted)
                            VALUES (@G, @M, 1, @Name, @Mobile, @Email, @Des, @C, 0, 1, NOW(), 0)",
                            new { G = groupId, M = h.MemberId, Name = h.MemberName, Mobile = h.Mobile, Email = h.Email, Des = h.DesignationName, C = h.ClubId });
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "DC CP/CS reconcile: add failed for club {C} member {M} year {Y}", h.ClubId, h.MemberId, h.YearId);
                    }
                }
                Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Soft-deleted {removed} row(s), added {added} row(s).");
            }

            await FinishLogAsync(conn, logId, "Completed", apply ? added : 0, apply ? removed : 0,
                apply ? $"Removed {removed}, added {added}." : $"AUDIT ONLY — would remove {toRemove.Count}, add {toAdd.Count}.");
            await SendEmailAsync(apply ? "APPLIED" : "AUDIT", removeDetails, toAdd, maxRemove);
            if (!apply)
                Console.WriteLine("  This was AUDIT ONLY — no DB changes. Run with --apply to fix.");
            return apply ? (removed, added) : (toRemove.Count, toAdd.Count);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[{DateTime.Now:HH:mm:ss}] DC CP/CS reconcile FAILED: {ex.Message}");
            try { await FinishLogAsync(conn, logId, "Failed", 0, 0, ex.Message); } catch { }
            throw;
        }
    }

    // The district+year+role group; created (per the naming rule) only when none is active.
    private static async Task<int> EnsureGroupAsync(MySqlConnection conn, Dictionary<(int, int, string), int> groupByKey, HolderRow h)
    {
        var key = (h.DistrictId, h.YearId, h.Role);
        if (groupByKey.TryGetValue(key, out var id)) return id;

        var baseName = h.Role == "S" ? GroupClubSecretaries : GroupClubPresidents;
        if (h.IsCurrent != 1 && string.IsNullOrWhiteSpace(h.YearLabel))
            throw new InvalidOperationException($"Rotary year {h.YearId} has no label — cannot name its group");
        var name = h.IsCurrent == 1 ? baseName : $"{baseName} {h.YearLabel}";
        const string findSql = @"
            SELECT id FROM district_committee_group
            WHERE fk_district_id = @D AND fk_year_id = @Y AND isdeleted = 0
              AND (group_name = @Base OR group_name LIKE @BaseYear)
            ORDER BY (group_name = @N) DESC, id LIMIT 1";
        var findArgs = new { D = h.DistrictId, Y = h.YearId, Base = baseName, BaseYear = baseName + " ____-__", N = name };

        var existing = await conn.ExecuteScalarAsync<int?>(findSql, findArgs);
        if (!existing.HasValue)
        {
            try
            {
                existing = await conn.ExecuteScalarAsync<int>(@"
                    INSERT INTO district_committee_group (fk_district_id, fk_year_id, group_name, sort_order, is_active, created_date, isdeleted)
                    VALUES (@D, @Y, @N, 0, 1, NOW(), 0);
                    SELECT LAST_INSERT_ID();",
                    new { D = h.DistrictId, Y = h.YearId, N = name });
            }
            catch (MySqlException ex) when (ex.ErrorCode == MySqlErrorCode.DuplicateKeyEntry)
            {
                // Created at the same moment by the API / BOD sync — DB guard kept it to one. Use that row.
                existing = await conn.ExecuteScalarAsync<int?>(findSql, findArgs);
                if (!existing.HasValue) throw;
            }
        }
        groupByKey[key] = existing.Value;
        return existing.Value;
    }

    private static async Task<List<RemoveDetail>> LoadRemoveDetailsAsync(MySqlConnection conn, List<int> ids, int timeoutSec)
    {
        var list = new List<RemoveDetail>();
        foreach (var chunk in ids.Chunk(2000))
            list.AddRange(await conn.QueryAsync<RemoveDetail>(@"
                SELECT m.id AS RowId, IFNULL(dm.DistrictNumber, '') AS DistrictNumber, IFNULL(y.YearLabel, '') AS YearLabel,
                       g.group_name AS GroupName, IFNULL(m.name, '') AS MemberName, m.fk_member_id AS MemberId,
                       m.fk_club_id AS ClubId, IFNULL(c.ClubName, '') AS ClubName,
                       CASE
                         WHEN m.fk_club_id IS NULL OR m.fk_club_id = 0 THEN 'No club on the row'
                         WHEN c.pk_club_id IS NULL THEN 'Club not found'
                         WHEN c.isdeleted <> 0 THEN 'Club deleted/terminated'
                         WHEN c.fk_district_id <> g.fk_district_id THEN 'Club belongs to another district'
                         WHEN m.fk_member_id IS NULL THEN 'No member on the row'
                         WHEN p.pk_member_master_profile_id IS NULL THEN 'Member profile no longer exists'
                         WHEN p.isdeleted <> 0 THEN 'Member profile deleted'
                         WHEN EXISTS (SELECT 1 FROM board_of_directors b
                                      JOIN designation_master d ON d.pk_designation_id = b.fk_designation_id
                                       AND d.designation_name = IF(g.group_name LIKE 'Club Secretaries%', 'Club Secretary', 'Club President')
                                      WHERE b.isdeleted = 0 AND b.fk_club_id = m.fk_club_id AND b.fk_year_id = g.fk_year_id
                                        AND b.fk_member_master_profile_id = m.fk_member_id) THEN 'Duplicate row of the same person'
                         ELSE 'Not in BOD for this club/year/role'
                       END AS Reason
                FROM district_committee_group_member m
                JOIN district_committee_group g ON g.id = m.fk_group_id
                LEFT JOIN district_master dm ON dm.pk_district_id = g.fk_district_id
                LEFT JOIN rotary_year_master y ON y.pk_year_id = g.fk_year_id
                LEFT JOIN club_master c ON c.pk_club_id = m.fk_club_id
                LEFT JOIN member_master_profile p ON p.pk_member_master_profile_id = m.fk_member_id
                WHERE m.id IN @Ids",
                new { Ids = chunk }, commandTimeout: timeoutSec));
        return list.OrderBy(d => d.DistrictNumber).ThenBy(d => d.YearLabel).ThenBy(d => d.GroupName).ThenBy(d => d.ClubName).ToList();
    }

    private static Task FinishLogAsync(MySqlConnection conn, int logId, string status, int inserted, int disabled, string detail)
        => conn.ExecuteAsync(@"
            UPDATE rotary_org_sync_log
            SET FinishedAtUtc = UTC_TIMESTAMP(), Status = @Status, InsertedCount = @Ins, DisabledCount = @Dis, ErrorDetail = @Detail
            WHERE pk_id = @Id",
            new { Id = logId, Status = status, Ins = inserted, Dis = disabled, Detail = detail });

    private async Task SendEmailAsync(string modeText, List<RemoveDetail> removes, List<HolderRow> adds, int threshold)
    {
        try
        {
            using var wb = new XLWorkbook();
            var s = wb.Worksheets.Add("Removed");
            string[] rh = { "Row id", "District", "Year", "Group", "Member id", "Name", "Club id", "Club", "Reason" };
            for (int c = 0; c < rh.Length; c++) s.Cell(1, c + 1).Value = rh[c];
            s.Range(1, 1, 1, rh.Length).Style.Font.SetBold().Fill.SetBackgroundColor(XLColor.LightGray);
            for (int i = 0; i < removes.Count; i++)
            {
                var d = removes[i];
                s.Cell(i + 2, 1).Value = d.RowId;
                s.Cell(i + 2, 2).Value = d.DistrictNumber;
                s.Cell(i + 2, 3).Value = d.YearLabel;
                s.Cell(i + 2, 4).Value = d.GroupName;
                s.Cell(i + 2, 5).Value = d.MemberId;
                s.Cell(i + 2, 6).Value = d.MemberName;
                s.Cell(i + 2, 7).Value = d.ClubId;
                s.Cell(i + 2, 8).Value = d.ClubName;
                s.Cell(i + 2, 9).Value = d.Reason;
            }
            s.Columns().AdjustToContents();

            var a = wb.Worksheets.Add("Added");
            string[] ah = { "District", "Year", "Role", "Member id", "Name", "Club id", "Club" };
            for (int c = 0; c < ah.Length; c++) a.Cell(1, c + 1).Value = ah[c];
            a.Range(1, 1, 1, ah.Length).Style.Font.SetBold().Fill.SetBackgroundColor(XLColor.LightGray);
            for (int i = 0; i < adds.Count; i++)
            {
                var h = adds[i];
                a.Cell(i + 2, 1).Value = h.DistrictNumber;
                a.Cell(i + 2, 2).Value = h.YearLabel;
                a.Cell(i + 2, 3).Value = h.DesignationName;
                a.Cell(i + 2, 4).Value = h.MemberId;
                a.Cell(i + 2, 5).Value = h.MemberName;
                a.Cell(i + 2, 6).Value = h.ClubId;
                a.Cell(i + 2, 7).Value = h.ClubName;
            }
            a.Columns().AdjustToContents();

            using var ms = new MemoryStream();
            wb.SaveAs(ms);
            var fileName = $"DC_CPCS_Reconcile_{modeText}_{DateTime.Now:yyyyMMdd_HHmmss}.xlsx";

            var triggeredByName = System.Net.WebUtility.HtmlEncode(_config["RotaryOrgSync:TriggeredByName"] ?? "Admin");
            var note = modeText switch
            {
                "ABORTED" => $"<p style='background:#fef2f2;border-left:4px solid #dc2626;padding:8px 12px;'>{removes.Count} rows to remove exceeded the safety threshold of {threshold}. Nothing was changed. If the attached list is right, run <code>--dc-cpcs-reconcile --apply --force</code>.</p>",
                "APPLIED" => "<p style='background:#f0fdf4;border-left:4px solid #16a34a;padding:8px 12px;'>District Committee Club Presidents / Club Secretaries groups now match Board of Directors. Removed rows were soft-deleted (reversible).</p>",
                _ => "<p style='background:#fffbeb;border-left:4px solid #f59e0b;padding:8px 12px;'>AUDIT only — no changes made. Re-run with <code>--apply</code> to fix.</p>",
            };
            var reasonsHtml = string.Join("", removes.GroupBy(d => d.Reason).OrderByDescending(x => x.Count()).Select(x =>
                $"<tr><td style='padding:6px 12px;border:1px solid #e5e7eb;'>{System.Net.WebUtility.HtmlEncode(x.Key)}</td><td style='padding:6px 12px;border:1px solid #e5e7eb;text-align:right;'>{x.Count()}</td></tr>"));

            var body = $@"<div style='font-family:Arial,sans-serif;'>
<h2 style='color:#1a365d;'>DC Club Presidents / Secretaries vs BOD — {modeText}</h2>
<p>Dear {triggeredByName},</p>
{note}
<p>Rows not backed by BOD: <b>{removes.Count}</b> &nbsp;·&nbsp; BOD holders missing from the group: <b>{adds.Count}</b></p>
<table style='border-collapse:collapse;margin:12px 0;font-size:14px;border:1px solid #e5e7eb;'>
<thead><tr style='background:#1a365d;color:white;font-weight:bold;'><td style='padding:8px 12px;'>Reason</td><td style='padding:8px 12px;'>Rows</td></tr></thead>
<tbody>{reasonsHtml}</tbody>
</table>
<p>Full lists are attached.</p>
<p>Regards,<br/><strong>Team ROW</strong></p>
</div>";
            var subject = modeText == "ABORTED"
                ? $"[ALERT] DC CP/CS Reconcile Aborted — safety threshold — {DateTime.Now:dd MMM yyyy}"
                : $"[{(modeText == "APPLIED" ? "Daily" : "Audit")}] DC CP/CS Reconcile — {removes.Count} removed, {adds.Count} added — {DateTime.Now:dd MMM yyyy}";
            await _emailSender.SendReportAsync(subject, body, ms.ToArray(), fileName);
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Email sent.");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "DC CP/CS reconcile email FAILED");
            Console.Error.WriteLine($"[{DateTime.Now:HH:mm:ss}] Email failed: {ex.Message}");
        }
    }

    private class GroupRow
    {
        public int Id { get; set; }
        public int DistrictId { get; set; }
        public int YearId { get; set; }
        public string GroupName { get; set; } = "";
        public string Role { get; set; } = "";
    }

    private class MemberRow
    {
        public int Id { get; set; }
        public int GroupId { get; set; }
        public int? MemberId { get; set; }
        public int? ClubId { get; set; }
    }

    private class HolderRow
    {
        public int DistrictId { get; set; }
        public int YearId { get; set; }
        public string Role { get; set; } = "";
        public string DesignationName { get; set; } = "";
        public int ClubId { get; set; }
        public string ClubName { get; set; } = "";
        public int MemberId { get; set; }
        public string MemberName { get; set; } = "";
        public string Mobile { get; set; } = "";
        public string Email { get; set; } = "";
        public string YearLabel { get; set; } = "";
        public int IsCurrent { get; set; }
        public string DistrictNumber { get; set; } = "";
    }

    private class RemoveDetail
    {
        public int RowId { get; set; }
        public string DistrictNumber { get; set; } = "";
        public string YearLabel { get; set; } = "";
        public string GroupName { get; set; } = "";
        public string MemberName { get; set; } = "";
        public int? MemberId { get; set; }
        public int? ClubId { get; set; }
        public string ClubName { get; set; } = "";
        public string Reason { get; set; } = "";
    }
}
