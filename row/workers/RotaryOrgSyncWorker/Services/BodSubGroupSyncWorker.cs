using ClosedXML.Excel;
using Dapper;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using MySqlConnector;

namespace RotaryOrgSyncWorker.Services;

/// <summary>
/// --bod-subgroup-sync — rebuilds sub_groups (Club + District level) from board_of_directors.
/// One sub-group per (scope, year, designation):
///   - Club scope:     fk_club_id = clubId,    fk_district_id = NULL
///   - District scope: fk_club_id = 0,         fk_district_id = districtId
///
/// Naming:
///   - Current Rotary year → exact designation name (e.g., "Treasurer")
///   - Other years         → designation name + " YYYY-YY"
///
/// Members in the sub-group are reconciled against board_of_directors:
///   - In BOD but not in sub-group → INSERT (or reactivate soft-deleted)
///   - In sub-group but not in BOD → soft-delete the membership row
/// Sends two summary emails (Club + District) at the end.
/// </summary>
public class BodSubGroupSyncWorker
{
    private readonly EmailReportSender _emailSender;
    private readonly IConfiguration _config;
    private readonly ILogger<BodSubGroupSyncWorker> _logger;
    private readonly string _connectionString;

    public BodSubGroupSyncWorker(EmailReportSender emailSender, IConfiguration config, ILogger<BodSubGroupSyncWorker> logger)
    {
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
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === BOD Sub-Group Sync START ===");

        int clubGroupsCreated = 0, clubGroupsUpdated = 0, clubMembersAdded = 0, clubMembersRemoved = 0;
        int districtGroupsCreated = 0, districtGroupsUpdated = 0, districtMembersAdded = 0, districtMembersRemoved = 0;
        int errors = 0;

        try
        {
            await using var conn = CreateConnection();
            await conn.OpenAsync(ct);

            // Distinct (club, year, designation) in active BOD
            var clubCombos = (await conn.QueryAsync<(int clubId, int yearId, int designationId)>(@"
                SELECT DISTINCT b.fk_club_id AS clubId, b.fk_year_id AS yearId, b.fk_designation_id AS designationId
                FROM board_of_directors b
                JOIN club_master c ON c.pk_club_id = b.fk_club_id AND c.isdeleted = 0
                WHERE b.isdeleted = 0")).ToList();
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Club-level combos: {clubCombos.Count}");

            // Distinct (district, year, designation)
            var districtCombos = (await conn.QueryAsync<(int districtId, int yearId, int designationId)>(@"
                SELECT DISTINCT c.fk_district_id AS districtId, b.fk_year_id AS yearId, b.fk_designation_id AS designationId
                FROM board_of_directors b
                JOIN club_master c ON c.pk_club_id = b.fk_club_id AND c.isdeleted = 0
                WHERE b.isdeleted = 0")).ToList();
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] District-level combos: {districtCombos.Count}");

            int idx = 0;
            foreach (var (clubId, yearId, designationId) in clubCombos)
            {
                ct.ThrowIfCancellationRequested();
                idx++;
                if (idx % 100 == 0) Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Club combos {idx}/{clubCombos.Count}");
                try
                {
                    var stat = await SyncOneScopeAsync(conn, scopeClubId: clubId, scopeDistrictId: null, designationId, yearId);
                    if (stat.created) clubGroupsCreated++;
                    if (stat.added > 0 || stat.removed > 0) clubGroupsUpdated++;
                    clubMembersAdded += stat.added;
                    clubMembersRemoved += stat.removed;
                }
                catch (Exception ex) { errors++; _logger.LogWarning(ex, "club combo {C}/{Y}/{D} failed", clubId, yearId, designationId); }
            }

            idx = 0;
            foreach (var (districtId, yearId, designationId) in districtCombos)
            {
                ct.ThrowIfCancellationRequested();
                idx++;
                if (idx % 100 == 0) Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] District combos {idx}/{districtCombos.Count}");
                try
                {
                    var stat = await SyncOneScopeAsync(conn, scopeClubId: null, scopeDistrictId: districtId, designationId, yearId);
                    if (stat.created) districtGroupsCreated++;
                    if (stat.added > 0 || stat.removed > 0) districtGroupsUpdated++;
                    districtMembersAdded += stat.added;
                    districtMembersRemoved += stat.removed;
                }
                catch (Exception ex) { errors++; _logger.LogWarning(ex, "district combo {D}/{Y}/{Des} failed", districtId, yearId, designationId); }
            }

            var elapsed = DateTime.UtcNow - startedAt;
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === DONE in {elapsed.TotalMinutes:F1} min ===");
            Console.WriteLine($"  Club groups created/updated:     {clubGroupsCreated}/{clubGroupsUpdated}");
            Console.WriteLine($"  Club members added/removed:      {clubMembersAdded}/{clubMembersRemoved}");
            Console.WriteLine($"  District groups created/updated: {districtGroupsCreated}/{districtGroupsUpdated}");
            Console.WriteLine($"  District members added/removed:  {districtMembersAdded}/{districtMembersRemoved}");
            Console.WriteLine($"  Errors:                          {errors}");

            // Send 2 emails
            await SendEmailAsync("Club Sub Groups", clubCombos.Count, clubGroupsCreated, clubGroupsUpdated, clubMembersAdded, clubMembersRemoved, elapsed, errors);
            await SendEmailAsync("District Sub Groups", districtCombos.Count, districtGroupsCreated, districtGroupsUpdated, districtMembersAdded, districtMembersRemoved, elapsed, errors);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "BOD Sub-Group Sync FAILED");
            Console.Error.WriteLine($"[{DateTime.Now:HH:mm:ss}] FAILED: {ex.Message}");
            throw;
        }
    }

    /// <summary>Sync ONE sub-group: ensure it exists, then make its member list match BOD truth.
    /// Returns (created, added, removed).</summary>
    private async Task<(bool created, int added, int removed)> SyncOneScopeAsync(
        MySqlConnection conn, int? scopeClubId, int? scopeDistrictId, int designationId, int yearId)
    {
        var designationName = await conn.ExecuteScalarAsync<string?>(
            "SELECT designation_name FROM designation_master WHERE pk_designation_id = @Id AND isdeleted = 0",
            new { Id = designationId });
        if (string.IsNullOrWhiteSpace(designationName)) return (false, 0, 0);

        var year = await conn.QueryFirstOrDefaultAsync<(string yearLabel, DateTime startDate, DateTime endDate)>(@"
            SELECT IFNULL(YearLabel, '') AS yearLabel, StartDate AS startDate, EndDate AS endDate
            FROM rotary_year_master WHERE pk_year_id = @Id LIMIT 1",
            new { Id = yearId });
        if (string.IsNullOrEmpty(year.yearLabel)) return (false, 0, 0);
        var today = DateTime.Today;
        var isCurrent = today >= year.startDate.Date && today <= year.endDate.Date;
        var groupName = isCurrent ? designationName : $"{designationName} {year.yearLabel}";

        var clubFilterValue = scopeClubId ?? 0;
        int? districtFilterValue = scopeDistrictId;

        var groupId = await conn.ExecuteScalarAsync<int?>(@"
            SELECT pk_sub_group_id FROM sub_groups
            WHERE fk_club_id = @C
              AND ((@D IS NULL AND fk_district_id IS NULL) OR fk_district_id = @D)
              AND fk_year_id = @Y AND GroupName = @N AND isdeleted = 0
            LIMIT 1",
            new { C = clubFilterValue, D = districtFilterValue, Y = yearId, N = groupName });

        bool wasCreated = false;
        if (!groupId.HasValue)
        {
            groupId = await conn.ExecuteScalarAsync<int>(@"
                INSERT INTO sub_groups (fk_club_id, fk_district_id, fk_year_id, GroupName, created_date, isdeleted)
                VALUES (@C, @D, @Y, @N, NOW(), 0);
                SELECT LAST_INSERT_ID();",
                new { C = clubFilterValue, D = districtFilterValue, Y = yearId, N = groupName });
            wasCreated = true;
        }

        // Compute BOD truth
        List<int> bodMemberIds;
        if (scopeClubId.HasValue)
        {
            bodMemberIds = (await conn.QueryAsync<int>(@"
                SELECT DISTINCT b.fk_member_master_profile_id
                FROM board_of_directors b
                JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id AND m.isdeleted = 0
                WHERE b.fk_club_id = @C AND b.fk_year_id = @Y AND b.fk_designation_id = @D AND b.isdeleted = 0",
                new { C = scopeClubId.Value, Y = yearId, D = designationId })).ToList();
        }
        else
        {
            bodMemberIds = (await conn.QueryAsync<int>(@"
                SELECT DISTINCT b.fk_member_master_profile_id
                FROM board_of_directors b
                JOIN club_master c ON c.pk_club_id = b.fk_club_id AND c.isdeleted = 0
                JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id AND m.isdeleted = 0
                WHERE c.fk_district_id = @D AND b.fk_year_id = @Y AND b.fk_designation_id = @Des AND b.isdeleted = 0",
                new { D = scopeDistrictId!.Value, Y = yearId, Des = designationId })).ToList();
        }

        var existingMembers = (await conn.QueryAsync<(int pk_id, int memberId)>(@"
            SELECT pk_sub_group_member_id AS pk_id, fk_member_master_profile_id AS memberId
            FROM sub_group_members
            WHERE fk_sub_group_id = @G AND isdeleted = 0",
            new { G = groupId.Value })).ToList();
        var existingIds = existingMembers.Select(m => m.memberId).ToHashSet();
        var bodIds = bodMemberIds.ToHashSet();

        int added = 0, removed = 0;

        foreach (var newMid in bodIds.Where(id => !existingIds.Contains(id)))
        {
            var softId = await conn.ExecuteScalarAsync<int?>(@"
                SELECT MAX(pk_sub_group_member_id) FROM sub_group_members
                WHERE fk_sub_group_id = @G AND fk_member_master_profile_id = @M AND isdeleted = 1",
                new { G = groupId.Value, M = newMid });
            if (softId.HasValue)
                await conn.ExecuteAsync("UPDATE sub_group_members SET isdeleted = 0 WHERE pk_sub_group_member_id = @Id", new { Id = softId.Value });
            else
                await conn.ExecuteAsync(@"
                    INSERT INTO sub_group_members (fk_sub_group_id, fk_member_master_profile_id, created_date, isdeleted)
                    VALUES (@G, @M, NOW(), 0)",
                    new { G = groupId.Value, M = newMid });
            added++;
        }

        foreach (var staleId in existingMembers.Where(m => !bodIds.Contains(m.memberId)))
        {
            await conn.ExecuteAsync(
                "UPDATE sub_group_members SET isdeleted = 1 WHERE pk_sub_group_member_id = @Id",
                new { Id = staleId.pk_id });
            removed++;
        }

        return (wasCreated, added, removed);
    }

    private async Task SendEmailAsync(string label, int combos, int created, int updated, int membersAdded, int membersRemoved, TimeSpan elapsed, int errors)
    {
        try
        {
            var subject = $"[Daily] ROW {label} Auto-Sync — {DateTime.Now:dd MMM yyyy}";
            var body = $@"<div style='font-family:Arial,sans-serif;'>
<h2 style='color:#1a365d;'>{System.Net.WebUtility.HtmlEncode(label)} Auto-Sync</h2>
<p>Nightly auto-sync rebuilt sub-groups from <code>board_of_directors</code>.</p>
<table style='border-collapse:collapse;margin:12px 0;border:1px solid #e5e7eb;'>
  <tr><td style='padding:6px 12px;border:1px solid #e5e7eb;'>Combinations processed</td><td style='padding:6px 12px;border:1px solid #e5e7eb;text-align:right;'><b>{combos}</b></td></tr>
  <tr><td style='padding:6px 12px;border:1px solid #e5e7eb;'>Sub-groups created (new)</td><td style='padding:6px 12px;border:1px solid #e5e7eb;text-align:right;color:#16a34a;'><b>{created}</b></td></tr>
  <tr><td style='padding:6px 12px;border:1px solid #e5e7eb;'>Sub-groups with member changes</td><td style='padding:6px 12px;border:1px solid #e5e7eb;text-align:right;color:#0ea5e9;'><b>{updated}</b></td></tr>
  <tr><td style='padding:6px 12px;border:1px solid #e5e7eb;'>Members added</td><td style='padding:6px 12px;border:1px solid #e5e7eb;text-align:right;color:#16a34a;'><b>{membersAdded}</b></td></tr>
  <tr><td style='padding:6px 12px;border:1px solid #e5e7eb;'>Members removed</td><td style='padding:6px 12px;border:1px solid #e5e7eb;text-align:right;color:#dc2626;'><b>{membersRemoved}</b></td></tr>
  <tr><td style='padding:6px 12px;border:1px solid #e5e7eb;'>Errors</td><td style='padding:6px 12px;border:1px solid #e5e7eb;text-align:right;color:#dc2626;'><b>{errors}</b></td></tr>
  <tr><td style='padding:6px 12px;border:1px solid #e5e7eb;'>Duration</td><td style='padding:6px 12px;border:1px solid #e5e7eb;text-align:right;'><b>{Math.Round(elapsed.TotalSeconds, 1)} sec</b></td></tr>
</table>
<p>Sub-groups are kept in lockstep with BOD truth: members no longer in BOD for that (scope + year + designation) are removed; new BOD entries are added.</p>
<p>Regards,<br/><strong>Team ROW</strong></p>
</div>";
            await _emailSender.SendReportAsync(subject, body);
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Email sent — {label}");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "{Label} email FAILED", label);
            Console.Error.WriteLine($"[{DateTime.Now:HH:mm:ss}] {label} email failed: {ex.Message}");
        }
    }
}
