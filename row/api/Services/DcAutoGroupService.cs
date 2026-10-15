using Dapper;
using MySqlConnector;
using System.Text.RegularExpressions;

namespace RotaryApi.Services;

/// <summary>
/// Auto-manages "Club Presidents" and "Club Secretaries" groups in district_committee_group.
/// Group membership flows ONLY from BOD operations (BoardOfDirectors + ClubLeadership).
/// Admins cannot edit/delete the group or its members directly.
///
/// Naming rules (PLURAL — updated 2026-07-09 per user):
///   - Current Rotary year → exact "Club Presidents" / "Club Secretaries"
///   - Other years → "Club Presidents YYYY-YY" / "Club Secretaries YYYY-YY"
///
/// Historic singular rows ("Club President", "Club President 2025-26") are
/// migrated to plural at API startup by MigrateSingularToPluralAsync — members
/// move to the plural group (deduped by member+club); the empty singular
/// container is soft-deleted. Safe to run repeatedly (idempotent).
/// </summary>
public interface IDcAutoGroupService
{
    /// <summary>True if the group_name matches the auto-managed CP/CS pattern.</summary>
    bool IsAutoManagedGroup(string? groupName);

    /// <summary>
    /// Called after a BOD CP/CS row is inserted/updated. Ensures the matching DC group exists
    /// and the member is in it.
    /// </summary>
    Task OnBodAddedOrUpdatedAsync(MySqlConnection conn, MySqlTransaction? tx, int clubId, int memberId, int designationId, int yearId, int? userId);

    /// <summary>
    /// Called after a BOD CP/CS row is soft-deleted. Removes the member from the matching DC group.
    /// </summary>
    Task OnBodRemovedAsync(MySqlConnection conn, MySqlTransaction? tx, int clubId, int memberId, int designationId, int yearId, int? userId);

    /// <summary>One-time backfill — scan all existing BOD CP/CS rows and populate DC groups/members.</summary>
    Task<(int groupsCreated, int membersAdded)> BackfillAsync();

    /// <summary>
    /// One-time migration from historic singular names ("Club President") to
    /// the plural names the app now uses ("Club Presidents"). For each old
    /// group, ensures the plural equivalent exists, moves members (dedup by
    /// member+club so no duplicates), then soft-deletes the empty singular
    /// container. Idempotent — safe to run on every startup.
    /// </summary>
    Task<(int groupsMigrated, int membersMoved)> MigrateSingularToPluralAsync();

    /// <summary>
    /// One-time cleanup: collapse each auto CP/CS group to ONE member per club (a club has exactly one
    /// President and one Secretary). Removes stale/duplicate group rows that a BOD sync can't fix —
    /// e.g. an orphan group row whose BOD row was already deleted, or two profiles of the same person.
    /// Keeps the member with an active BOD row (Auto preferred), else the newest row. Soft-delete only.
    /// Idempotent — safe to run on every startup.
    /// </summary>
    Task<int> CollapseAutoGroupsToOnePerClubAsync();
}

public class DcAutoGroupService : IDcAutoGroupService
{
    // Canonical pattern: PLURAL "Club Presidents" / "Club Secretaries" with
    // optional " YYYY-YY" suffix. Naming rule (2026-07-10 confirmed by user):
    //   current year  → bare ("Club Presidents")
    //   past / future → suffixed ("Club Presidents 2025-26")
    // NOTE: year-rollover handler is intentionally NOT implemented — user will
    // address next year manually. Bare current-year groups will become "wrong"
    // once the year rolls over.
    private static readonly Regex AutoGroupPattern = new(
        @"^(Club Presidents|Club Secretaries)( \d{4}-\d{2})?$",
        RegexOptions.Compiled);

    // Reservation pattern: anything a user might type that LOOKS like an auto-managed CP/CS group.
    // Catches casing variations ("club secretary"), singular AND plural forms, and various year
    // formats ("2025-26", "2025-2026", "2025-2025", trailing year only). Goal: block manual
    // creation of names that conflict with — or could be confused with — the BOD-driven auto
    // groups, so the canonical "Club Presidents YYYY-YY" hierarchy stays clean.
    private static readonly Regex AutoGroupReservedPattern = new(
        @"^\s*club\s+(president|secretary)s?(\s+\d{4}([-/]\d{2,4})?)?\s*$",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    // Designation names that trigger DC auto-population — match designation_master entries
    // (pk_designation_id=1 → "Club President", pk_designation_id=2 → "Club Secretary").
    // These are the DESIGNATION titles, not the GROUP names (see GroupClubPresidents below).
    private const string DesignationClubPresident = "Club President";
    private const string DesignationClubSecretary = "Club Secretary";

    // GROUP names — plural, per user 2026-07-09. Distinct from designation names so a
    // BOD titled "Club President" always populates the PLURAL "Club Presidents" group.
    private const string GroupClubPresidents = "Club Presidents";
    private const string GroupClubSecretaries = "Club Secretaries";

    private readonly string _connectionString;
    private readonly ILogger<DcAutoGroupService> _logger;

    public DcAutoGroupService(IConfiguration config, ILogger<DcAutoGroupService> logger)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("ConnectionStrings:DefaultConnection missing");
        _logger = logger;
    }

    // Returns true if the name is reserved for the auto-managed CP/CS system —
    // either the canonical form or any near-variation (case, plural, year format).
    // Used by DC admin endpoints to block manual create/edit/delete of these groups.
    public bool IsAutoManagedGroup(string? groupName)
    {
        if (string.IsNullOrWhiteSpace(groupName)) return false;
        var trimmed = groupName.Trim();
        return AutoGroupPattern.IsMatch(trimmed) || AutoGroupReservedPattern.IsMatch(trimmed);
    }

    /// <summary>Build the group name for a given designation + year.</summary>
    /// <param name="basePlural">"Club Presidents" or "Club Secretaries"</param>
    /// <param name="yearLabel">e.g. "2025-26"</param>
    /// <param name="isCurrentYear">true if this row's year is the CURRENT rotary year</param>
    /// <remarks>
    /// Naming rule (confirmed 2026-07-10 by user):
    ///   current → bare "Club Presidents"
    ///   past/future → suffixed "Club Presidents 2025-26"
    /// Known caveat: when the year rolls over next July, the bare current-year
    /// group's name becomes wrong. User has chosen to address this manually
    /// next year — no rollover handler is implemented.
    /// </remarks>
    private static string BuildGroupName(string basePlural, string yearLabel, bool isCurrentYear)
        => isCurrentYear ? basePlural : $"{basePlural} {yearLabel}";

    // Map a designation name (singular, from designation_master) to the plural
    // GROUP name the auto-manager uses. Non-CP/CS returns empty (caller filters).
    private static string DesignationToGroupBase(string designationName) => designationName switch
    {
        DesignationClubPresident => GroupClubPresidents,
        DesignationClubSecretary => GroupClubSecretaries,
        _ => "",
    };

    public async Task OnBodAddedOrUpdatedAsync(MySqlConnection conn, MySqlTransaction? tx, int clubId, int memberId, int designationId, int yearId, int? userId)
    {
        var (designationName, _) = await ResolveDesignationAsync(conn, tx, designationId);
        if (designationName != DesignationClubPresident && designationName != DesignationClubSecretary)
            return; // not CP/CS — no DC group action

        var (districtId, clubName) = await ResolveClubAsync(conn, tx, clubId);
        if (districtId == 0) return; // can't find district — skip silently

        var (yearLabel, isCurrentYear) = await ResolveYearAsync(conn, tx, yearId);
        if (string.IsNullOrEmpty(yearLabel)) return;

        var groupBase = DesignationToGroupBase(designationName);
        var groupName = BuildGroupName(groupBase, yearLabel, isCurrentYear);

        var groupId = await EnsureGroupAsync(conn, tx, districtId, yearId, groupName, userId);
        await UpsertGroupMemberAsync(conn, tx, groupId, memberId, designationName, clubId, userId);

        // For UPDATE path: if the member previously held the OTHER role (e.g. switched from Sec to Pres
        // for the same club+year), remove the stale row. We don't know the previous designation here, so
        // we proactively soft-delete any existing OTHER-designation row for this member+club+year.
        var otherDesignation = designationName == DesignationClubPresident ? DesignationClubSecretary : DesignationClubPresident;
        var otherGroupName = BuildGroupName(DesignationToGroupBase(otherDesignation), yearLabel, isCurrentYear);
        await SoftDeleteMemberFromGroupByNameAsync(conn, tx, districtId, yearId, otherGroupName, memberId, clubId);
    }

    public async Task OnBodRemovedAsync(MySqlConnection conn, MySqlTransaction? tx, int clubId, int memberId, int designationId, int yearId, int? userId)
    {
        var (designationName, _) = await ResolveDesignationAsync(conn, tx, designationId);
        if (designationName != DesignationClubPresident && designationName != DesignationClubSecretary)
            return;

        var (districtId, _) = await ResolveClubAsync(conn, tx, clubId);
        if (districtId == 0) return;

        var (yearLabel, isCurrentYear) = await ResolveYearAsync(conn, tx, yearId);
        if (string.IsNullOrEmpty(yearLabel)) return;

        var groupName = BuildGroupName(DesignationToGroupBase(designationName), yearLabel, isCurrentYear);

        await SoftDeleteMemberFromGroupByNameAsync(conn, tx, districtId, yearId, groupName, memberId, clubId);
    }

    public async Task<(int groupsCreated, int membersAdded)> BackfillAsync()
    {
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();

        // All distinct (club, member, designation, year) BOD rows for CP/CS
        var rows = (await conn.QueryAsync<(int clubId, int memberId, int designationId, int yearId, string designationName)>(@"
            SELECT b.fk_club_id AS clubId, b.fk_member_master_profile_id AS memberId,
                   b.fk_designation_id AS designationId, b.fk_year_id AS yearId,
                   d.designation_name AS designationName
            FROM board_of_directors b
            JOIN designation_master d ON d.pk_designation_id = b.fk_designation_id
            WHERE b.isdeleted = 0
              AND d.designation_name IN (@Pres, @Sec)",
            new { Pres = DesignationClubPresident, Sec = DesignationClubSecretary })).ToList();

        if (rows.Count == 0) return (0, 0);

        int groupsCreated = 0, membersAdded = 0;
        foreach (var r in rows)
        {
            try
            {
                var (districtId, _) = await ResolveClubAsync(conn, null, r.clubId);
                if (districtId == 0) continue;
                var (yearLabel, isCurrentYear) = await ResolveYearAsync(conn, null, r.yearId);
                if (string.IsNullOrEmpty(yearLabel)) continue;

                var groupName = BuildGroupName(DesignationToGroupBase(r.designationName), yearLabel, isCurrentYear);

                var existed = await conn.ExecuteScalarAsync<int>(@"
                    SELECT COUNT(*) FROM district_committee_group
                    WHERE fk_district_id = @D AND fk_year_id = @Y AND group_name = @N AND isdeleted = 0",
                    new { D = districtId, Y = r.yearId, N = groupName });

                var groupId = await EnsureGroupAsync(conn, null, districtId, r.yearId, groupName, null);
                if (existed == 0) groupsCreated++;

                var alreadyInGroup = await conn.ExecuteScalarAsync<int>(@"
                    SELECT COUNT(*) FROM district_committee_group_member
                    WHERE fk_group_id = @G AND fk_member_id = @M AND fk_club_id = @C AND isdeleted = 0",
                    new { G = groupId, M = r.memberId, C = r.clubId });
                if (alreadyInGroup > 0) continue;

                await UpsertGroupMemberAsync(conn, null, groupId, r.memberId, r.designationName, r.clubId, null);
                membersAdded++;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "DC backfill error for ClubId={C} MemberId={M} Year={Y}", r.clubId, r.memberId, r.yearId);
            }
        }

        // Also auto-create CURRENT-year CP and CS groups in EVERY district, even if no BOD yet
        // (so the empty groups exist and admins can see them).
        await EnsureCurrentYearGroupsForAllDistrictsAsync(conn, null);

        return (groupsCreated, membersAdded);
    }

    public async Task<(int groupsMigrated, int membersMoved)> MigrateSingularToPluralAsync()
    {
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();

        // Migration queries run against multi-row updates on
        // district_committee_group_member (~large) with self-joins. The
        // default 30s Dapper timeout is not enough — allow 5 min per query.
        const int MigrationCommandTimeoutSec = 300;

        // Idempotent normalization. Find every group whose name looks like a
        // CP/CS auto-group in ANY historic form:
        //   • singular:      "Club President", "Club President 2025-26"
        //   • bare plural:   "Club Presidents", "Club Secretaries"
        //   • suffixed plural: "Club Presidents 2025-26" (canonical target)
        // For each row, compute the CANONICAL name = "{basePlural} {yearLabel}"
        // where yearLabel comes from the row's fk_year_id (never from the old
        // name string — avoids trusting stale/broken suffixes). If the row is
        // already canonical AND alone for that (district, year_id, name), nothing
        // to do. Otherwise: ensure the canonical row exists, move members
        // (dedupe by member+club), soft-delete the non-canonical container.
        var suspects = (await conn.QueryAsync<(int id, int districtId, int yearId, string groupName)>(
            @"SELECT id, fk_district_id AS districtId, fk_year_id AS yearId, group_name AS groupName
              FROM district_committee_group
              WHERE isdeleted = 0
                AND group_name REGEXP '^(Club (President|Presidents)|Club (Secretary|Secretaries))( [0-9]{4}-[0-9]{2})?$'",
            commandTimeout: MigrationCommandTimeoutSec)).ToList();

        if (suspects.Count == 0) return (0, 0);

        int migrated = 0, moved = 0;
        foreach (var g in suspects)
        {
            try
            {
                // Determine which auto-group family this row belongs to.
                var lower = g.groupName.ToLowerInvariant();
                string basePlural;
                if (lower.Contains("secret")) basePlural = GroupClubSecretaries;
                else basePlural = GroupClubPresidents;

                // Look up the CANONICAL year label AND current-year flag from the
                // row's fk_year_id. Canonical name uses the same rule BuildGroupName
                // does at runtime: bare for current year, suffixed otherwise.
                var (yearLabel, isCurrentYear) = await ResolveYearAsync(conn, null, g.yearId);
                if (string.IsNullOrWhiteSpace(yearLabel))
                {
                    // Orphan year_id — can't build canonical name. Skip so we don't
                    // silently lose the row; ops can inspect manually.
                    _logger.LogWarning("DC normalization: group id={Id} name={Name} has orphan year_id={Y}; skipped", g.id, g.groupName, g.yearId);
                    continue;
                }

                var canonicalName = BuildGroupName(basePlural, yearLabel, isCurrentYear);
                if (string.Equals(canonicalName, g.groupName, StringComparison.Ordinal))
                    continue; // already canonical, nothing to do

                // Ensure/restore the canonical target row exists (may be a fresh
                // insert or a soft-deleted row we resurrect).
                var canonicalId = await EnsureGroupAsync(conn, null, g.districtId, g.yearId, canonicalName, null);
                if (canonicalId == g.id)
                {
                    // This row IS the year's single active group for the role, just under the other plural
                    // form (e.g. bare name left on a past year) — rename in place, never create a 2nd copy.
                    await conn.ExecuteAsync(
                        "UPDATE district_committee_group SET group_name = @N, modified_date = NOW() WHERE id = @Id",
                        new { N = canonicalName, Id = g.id }, commandTimeout: MigrationCommandTimeoutSec);
                    migrated++;
                    continue;
                }

                // Step 1 — dedupe: soft-delete member rows in THIS group that
                // already exist (same member+club) in the canonical target.
                // Uses a subquery instead of a self-join — MySQL's self-join
                // planner scanned the whole table per iteration, causing 30s+
                // timeouts. The subquery reads only the target group's rows.
                await conn.ExecuteAsync(@"
                    UPDATE district_committee_group_member m
                    SET m.isdeleted = 1, m.modified_date = NOW()
                    WHERE m.fk_group_id = @OldGroupId
                      AND m.isdeleted = 0
                      AND EXISTS (
                          SELECT 1 FROM (
                              SELECT fk_member_id, fk_club_id
                              FROM district_committee_group_member
                              WHERE fk_group_id = @NewGroupId AND isdeleted = 0
                          ) t
                          WHERE t.fk_member_id = m.fk_member_id
                            AND t.fk_club_id = m.fk_club_id
                      )",
                    new { OldGroupId = g.id, NewGroupId = canonicalId },
                    commandTimeout: MigrationCommandTimeoutSec);

                // Step 2 — move remaining (unique) members from THIS → canonical.
                var movedCount = await conn.ExecuteAsync(@"
                    UPDATE district_committee_group_member
                    SET fk_group_id = @NewGroupId, modified_date = NOW()
                    WHERE fk_group_id = @OldGroupId AND isdeleted = 0",
                    new { OldGroupId = g.id, NewGroupId = canonicalId },
                    commandTimeout: MigrationCommandTimeoutSec);
                moved += movedCount;

                // Step 3 — soft-delete the non-canonical container.
                await conn.ExecuteAsync(@"
                    UPDATE district_committee_group
                    SET isdeleted = 1, modified_date = NOW()
                    WHERE id = @OldGroupId",
                    new { OldGroupId = g.id },
                    commandTimeout: MigrationCommandTimeoutSec);

                migrated++;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "DC group normalization error on id={Id} name={Name}", g.id, g.groupName);
            }
        }

        _logger.LogInformation("DC CP/CS normalization: {Groups} groups collapsed, {Members} members moved", migrated, moved);
        return (migrated, moved);
    }

    public async Task<int> CollapseAutoGroupsToOnePerClubAsync()
    {
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        const int TimeoutSec = 300;

        // All ACTIVE members of the auto CP/CS groups + each group's year & role. fk_club_id is nullable:
        // an orphan row with NULL/0 club is an invalid CP/CS entry (a President MUST belong to a club).
        var rows = (await conn.QueryAsync<(int id, int groupId, int yearId, int? clubId, int memberId, string groupName)>(@"
            SELECT m.id, m.fk_group_id AS groupId, g.fk_year_id AS yearId, m.fk_club_id AS clubId,
                   m.fk_member_id AS memberId, g.group_name AS groupName
            FROM district_committee_group_member m
            JOIN district_committee_group g ON g.id = m.fk_group_id AND g.isdeleted = 0
            WHERE m.isdeleted = 0
              AND g.group_name REGEXP '^(Club Presidents|Club Secretaries)( [0-9]{4}-[0-9]{2})?$'",
            commandTimeout: TimeoutSec)).ToList();
        if (rows.Count == 0) return 0;

        // Active BOD CP/CS rows → keyed set so we can prefer the member Rotary.org/BOD actually holds.
        var bod = (await conn.QueryAsync<(int clubId, int memberId, int yearId, string designation, int isAuto)>(@"
            SELECT b.fk_club_id AS clubId, b.fk_member_master_profile_id AS memberId, b.fk_year_id AS yearId,
                   d.designation_name AS designation,
                   CASE WHEN b.SyncSource = 'Auto' THEN 1 ELSE 0 END AS isAuto
            FROM board_of_directors b
            JOIN designation_master d ON d.pk_designation_id = b.fk_designation_id
            WHERE b.isdeleted = 0 AND d.designation_name IN (@Pres, @Sec)",
            new { Pres = DesignationClubPresident, Sec = DesignationClubSecretary },
            commandTimeout: TimeoutSec)).ToList();

        var autoKeys = new HashSet<(int, int, int, string)>();
        var anyKeys = new HashSet<(int, int, int, string)>();
        foreach (var b in bod)
        {
            anyKeys.Add((b.clubId, b.memberId, b.yearId, b.designation));
            if (b.isAuto == 1) autoKeys.Add((b.clubId, b.memberId, b.yearId, b.designation));
        }

        // Rank: 1 = active Auto BOD, 2 = active BOD (any source), 3 = no active BOD (orphan group row).
        int BodRank(int clubId, int memberId, int yearId, string designation)
        {
            var key = (clubId, memberId, yearId, designation);
            if (autoKeys.Contains(key)) return 1;
            if (anyKeys.Contains(key)) return 2;
            return 3;
        }

        var toDelete = new List<int>();

        // (a) NULL/0-club orphan rows → invalid CP/CS (no club) → remove them all.
        toDelete.AddRange(rows.Where(r => !r.clubId.HasValue || r.clubId.Value == 0).Select(r => r.id));

        // (b) Real-club duplicates → keep ONE per (group, club): the BOD-backed member (Auto preferred),
        //     newest row as tie-break; drop the rest.
        foreach (var grp in rows.Where(r => r.clubId.HasValue && r.clubId.Value > 0)
                                .GroupBy(r => (r.groupId, ClubId: r.clubId!.Value))
                                .Where(g => g.Count() > 1))
        {
            var designation = grp.First().groupName.ToLowerInvariant().Contains("secret")
                ? DesignationClubSecretary : DesignationClubPresident;
            var ranked = grp
                .Select(r => new { r.id, rank = BodRank(r.clubId!.Value, r.memberId, r.yearId, designation) })
                .OrderBy(x => x.rank).ThenByDescending(x => x.id)
                .ToList();
            toDelete.AddRange(ranked.Skip(1).Select(x => x.id));
        }

        if (toDelete.Count == 0) return 0;
        foreach (var chunk in toDelete.Chunk(500))
            await conn.ExecuteAsync(
                "UPDATE district_committee_group_member SET isdeleted = 1, modified_date = NOW() WHERE id IN @Ids",
                new { Ids = chunk }, commandTimeout: TimeoutSec);

        _logger.LogInformation("DC one-per-club collapse: soft-deleted {N} duplicate CP/CS group row(s)", toDelete.Count);
        return toDelete.Count;
    }

    // ─────────────────────── Helpers ───────────────────────

    private async Task<int> EnsureGroupAsync(MySqlConnection conn, MySqlTransaction? tx, int districtId, int yearId, string groupName, int? userId)
    {
        // ONE active group per district + year + role (user rule 2026-09-17). Look up the ACTIVE group
        // by year + role in either plural form ("Club Presidents" or "Club Presidents YYYY-YY"), so a
        // bare/suffixed name mismatch (e.g. after the year rolls over) can never create a second copy.
        var existingId = await FindActiveRoleGroupIdAsync(conn, tx, districtId, yearId, groupName);
        if (existingId.HasValue) return existingId.Value;

        try
        {
            // No active group. If a soft-deleted row with this exact name exists (admin "deleted" the
            // auto-group but Option A means the delete cannot stick for CP/CS), restore it in place.
            var deletedId = await conn.ExecuteScalarAsync<int?>(@"
                SELECT id FROM district_committee_group
                WHERE fk_district_id = @D AND fk_year_id = @Y AND group_name = @N AND isdeleted <> 0
                ORDER BY id LIMIT 1",
                new { D = districtId, Y = yearId, N = groupName }, tx);
            if (deletedId.HasValue)
            {
                await conn.ExecuteAsync(@"
                    UPDATE district_committee_group
                    SET isdeleted = 0, is_active = 1, modified_by = @U, modified_date = NOW()
                    WHERE id = @Id",
                    new { Id = deletedId.Value, U = userId }, tx);
                return deletedId.Value;
            }

            return await conn.ExecuteScalarAsync<int>(@"
                INSERT INTO district_committee_group (fk_district_id, fk_year_id, group_name, sort_order, is_active, created_by, created_date, isdeleted)
                VALUES (@D, @Y, @N, 0, 1, @U, NOW(), 0);
                SELECT LAST_INSERT_ID();",
                new { D = districtId, Y = yearId, N = groupName, U = userId }, tx);
        }
        catch (MySqlException ex) when (ex.ErrorCode == MySqlErrorCode.DuplicateKeyEntry)
        {
            // Another save created the group at the same moment — the DB unique key
            // (SQL/dc_cpcs_one_active_group_guard.sql) rejected the 2nd copy. Use the winner's row.
            var winnerId = await FindActiveRoleGroupIdAsync(conn, tx, districtId, yearId, groupName);
            if (winnerId.HasValue) return winnerId.Value;
            throw;
        }
    }

    // The single ACTIVE CP/CS group for a district + year + role, whichever plural form its name has.
    // Same match as the DB guard column cpcs_active_key. Exact-name row first if (legacy) there are two.
    private static Task<int?> FindActiveRoleGroupIdAsync(MySqlConnection conn, MySqlTransaction? tx, int districtId, int yearId, string groupName)
    {
        var basePlural = groupName.StartsWith(GroupClubSecretaries, StringComparison.OrdinalIgnoreCase)
            ? GroupClubSecretaries : GroupClubPresidents;
        return conn.ExecuteScalarAsync<int?>(@"
            SELECT id FROM district_committee_group
            WHERE fk_district_id = @D AND fk_year_id = @Y AND isdeleted = 0
              AND (group_name = @Base OR group_name LIKE @BaseYear)
            ORDER BY (group_name = @N) DESC, id
            LIMIT 1",
            new { D = districtId, Y = yearId, Base = basePlural, BaseYear = basePlural + " ____-__", N = groupName }, tx);
    }

    private async Task UpsertGroupMemberAsync(MySqlConnection conn, MySqlTransaction? tx, int groupId, int memberId, string designation, int clubId, int? userId)
    {
        // Check if member already in this group (active row)
        var existing = await conn.ExecuteScalarAsync<int?>(@"
            SELECT id FROM district_committee_group_member
            WHERE fk_group_id = @G AND fk_member_id = @M AND fk_club_id = @C AND isdeleted = 0
            LIMIT 1",
            new { G = groupId, M = memberId, C = clubId }, tx);

        // Pull member's name/mobile/email (for denormalized columns).
        var profile = await conn.QueryFirstOrDefaultAsync<(string name, string mobile, string email)>(@"
            SELECT IFNULL(MemberName, '') AS name,
                   IFNULL(PrimaryMobileNumber, '') AS mobile,
                   IFNULL(EmailId, '') AS email
            FROM member_master_profile WHERE pk_member_master_profile_id = @M LIMIT 1",
            new { M = memberId }, tx);

        // If the member has no profile row (orphan BOD reference), QueryFirstOrDefault returns a
        // default tuple with NULL strings — coalesce so the NOT NULL columns never receive NULL.
        var memName = profile.name ?? "";
        var memMobile = profile.mobile ?? "";
        var memEmail = profile.email ?? "";

        if (existing.HasValue)
        {
            await conn.ExecuteAsync(@"
                UPDATE district_committee_group_member
                SET name = @Name, mobile = @Mobile, email = @Email,
                    district_designation = @Des, fk_club_id = @C, is_member = 1, is_active = 1,
                    modified_by = @U, modified_date = NOW(), isdeleted = 0
                WHERE id = @Id",
                new { Id = existing.Value, Name = memName, Mobile = memMobile, Email = memEmail, Des = designation, C = clubId, U = userId }, tx);
        }
        else
        {
            await conn.ExecuteAsync(@"
                INSERT INTO district_committee_group_member
                    (fk_group_id, fk_member_id, is_member, name, mobile, email, district_designation, fk_club_id, sort_order, is_active, created_by, created_date, isdeleted)
                VALUES
                    (@G, @M, 1, @Name, @Mobile, @Email, @Des, @C, 0, 1, @U, NOW(), 0)",
                new { G = groupId, M = memberId, Name = memName, Mobile = memMobile, Email = memEmail, Des = designation, C = clubId, U = userId }, tx);
        }

        // ONE-PER-CLUB guard: a club has exactly ONE President and ONE Secretary. The member just
        // upserted IS the current holder (BOD set them), so soft-delete any OTHER member's active row
        // for the SAME club in THIS auto-group — a president change, or a duplicate profile of the same
        // person, must not leave a second CP/CS for the club. Keeps the District Committee CP/CS count
        // at ≤ club count (100 clubs → ≤100 CP, ≤100 CS).
        await conn.ExecuteAsync(@"
            UPDATE district_committee_group_member
            SET isdeleted = 1, modified_date = NOW()
            WHERE fk_group_id = @G AND fk_club_id = @C AND fk_member_id <> @M AND isdeleted = 0",
            new { G = groupId, C = clubId, M = memberId }, tx);
    }

    // Removes the member+club from the district+year+role group, matched by role in either plural name
    // form — not one exact name — so a bare/suffixed mismatch after year rollover can't leave them behind.
    private async Task SoftDeleteMemberFromGroupByNameAsync(MySqlConnection conn, MySqlTransaction? tx, int districtId, int yearId, string groupName, int memberId, int clubId)
    {
        var basePlural = groupName.StartsWith(GroupClubSecretaries, StringComparison.OrdinalIgnoreCase)
            ? GroupClubSecretaries : GroupClubPresidents;
        await conn.ExecuteAsync(@"
            UPDATE district_committee_group_member m
            JOIN district_committee_group g ON g.id = m.fk_group_id
            SET m.isdeleted = 1, m.modified_date = NOW()
            WHERE g.fk_district_id = @D AND g.fk_year_id = @Y AND g.isdeleted = 0
              AND (g.group_name = @Base OR g.group_name LIKE @BaseYear)
              AND m.fk_member_id = @M AND m.fk_club_id = @C AND m.isdeleted = 0",
            new { D = districtId, Y = yearId, Base = basePlural, BaseYear = basePlural + " ____-__", M = memberId, C = clubId }, tx);
    }

    private async Task<(string designationName, int designationId)> ResolveDesignationAsync(MySqlConnection conn, MySqlTransaction? tx, int designationId)
    {
        var name = await conn.ExecuteScalarAsync<string?>(
            "SELECT designation_name FROM designation_master WHERE pk_designation_id = @Id",
            new { Id = designationId }, tx);
        return (name ?? "", designationId);
    }

    private async Task<(int districtId, string clubName)> ResolveClubAsync(MySqlConnection conn, MySqlTransaction? tx, int clubId)
    {
        var row = await conn.QueryFirstOrDefaultAsync<(int districtId, string clubName)>(
            "SELECT IFNULL(fk_district_id, 0) AS districtId, IFNULL(ClubName, '') AS clubName FROM club_master WHERE pk_club_id = @Id LIMIT 1",
            new { Id = clubId }, tx);
        return row;
    }

    private async Task<(string yearLabel, bool isCurrentYear)> ResolveYearAsync(MySqlConnection conn, MySqlTransaction? tx, int yearId)
    {
        var row = await conn.QueryFirstOrDefaultAsync<(string yearLabel, DateTime startDate, DateTime endDate)>(
            "SELECT IFNULL(YearLabel, '') AS yearLabel, StartDate AS startDate, EndDate AS endDate FROM rotary_year_master WHERE pk_year_id = @Id LIMIT 1",
            new { Id = yearId }, tx);
        if (string.IsNullOrEmpty(row.yearLabel)) return ("", false);
        var today = DateTime.Today;
        var isCurrent = today >= row.startDate.Date && today <= row.endDate.Date;
        return (row.yearLabel, isCurrent);
    }

    /// <summary>For all districts, ensure the CURRENT-year CP and CS groups exist (even empty).</summary>
    private async Task EnsureCurrentYearGroupsForAllDistrictsAsync(MySqlConnection conn, MySqlTransaction? tx)
    {
        var currentYear = await conn.QueryFirstOrDefaultAsync<(int pk_year_id, string yearLabel)>(@"
            SELECT pk_year_id, IFNULL(YearLabel, '') AS yearLabel
            FROM rotary_year_master
            WHERE @Today BETWEEN StartDate AND EndDate
            LIMIT 1",
            new { Today = DateTime.Today }, tx);
        if (currentYear.pk_year_id == 0) return;

        var districts = (await conn.QueryAsync<int>(
            "SELECT pk_district_id FROM district_master WHERE isdeleted = 0", null, tx)).ToList();

        // Seed with the BARE name (e.g. "Club Presidents") — matches BuildGroupName
        // for isCurrentYear=true, so BOD saves later find the same row via
        // EnsureGroupAsync's name lookup.
        foreach (var districtId in districts)
        {
            await EnsureGroupAsync(conn, tx, districtId, currentYear.pk_year_id, GroupClubPresidents, null);
            await EnsureGroupAsync(conn, tx, districtId, currentYear.pk_year_id, GroupClubSecretaries, null);
        }
    }
}
