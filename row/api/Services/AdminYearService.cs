using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// Year-wise Admin Rights — the ONE place that answers "which Rotary years may
/// this member add/edit/delete in, for this club or district?".
///
/// Every add/edit/delete endpoint must go through here. Copy-pasted year checks
/// are exactly how the club boundary on <c>admin/assign-role</c> ended up living
/// in two UI screens instead of the server.
///
/// ── Where rights come from ──────────────────────────────────────────────────
///   1. SuperAdmin            → every year, always. Never year-restricted.
///   2. Manual grants         → member_admin_years (a year each, or an
///                              AllYears flag).
///   3. Club office-bearers   → computed LIVE from board_of_directors, which is
///                              already year-scoped:
///                                • Club President  → the year they are President
///                                • Club Secretary  → the year they are Secretary
///                                • Club Executive Secretary/Director → ALL years
///                                  ONLY while sitting (board row in the CURRENT
///                                  Rotary year); a past holder keeps just the year
///                                  of the post. No current year = fail closed
///                                  (post year only). (2026-11-09 note
///                                  BACKEND_NOTE_ywar_exec_secretary_year_scoped)
///   4. District Governor     → computed LIVE from district_governors, which is
///                              year-scoped too: the DG earns THE YEAR THEY ARE
///                              DG FOR, the district's mirror of the club
///                              President/Secretary rule.
///      Computing these live means a board or DG change updates rights
///      immediately and leaves no stale row behind.
///
/// ── Confirmed rules ─────────────────────────────────────────────────────────
///   • PAST YEARS STAY EDITABLE. Rights for a year never expire, so this whole
///     feature is ADDITIVE — no existing admin loses anything.
///   • DATA WITH NO ROTARY YEAR (116 of 154 tables) needs CURRENT-year rights.
///     See <see cref="CanEditYearlessAsync"/>.
/// </summary>
public interface IAdminYearService
{
    Task<AdminYearRights> GetClubRightsAsync(MySqlConnection conn, int memberId, int clubId);
    Task<AdminYearRights> GetDistrictRightsAsync(MySqlConnection conn, int memberId, int districtId);

    /// <summary>
    /// The rights this member WOULD have if the year rule were switched on for this
    /// scope — i.e. ignoring the Settings → Year-wise Admin Rights switch.
    ///
    /// For the preflight check on the settings page ONLY, which has to answer "who
    /// loses access if I turn this on?" while it is still off. Never use it to
    /// authorise anything.
    /// </summary>
    Task<AdminYearRights> GetClubRightsIfRuleOnAsync(MySqlConnection conn, int memberId, int clubId);
    Task<AdminYearRights> GetDistrictRightsIfRuleOnAsync(MySqlConnection conn, int memberId, int districtId);

    /// <summary>May this member touch a record STAMPED with <paramref name="yearId"/>?</summary>
    Task<bool> CanEditClubYearAsync(MySqlConnection conn, int memberId, int clubId, int yearId);
    Task<bool> CanEditDistrictYearAsync(MySqlConnection conn, int memberId, int districtId, int yearId);

    /// <summary>
    /// May this member touch a record with NO Rotary year? Confirmed rule:
    /// current-year rights required.
    /// </summary>
    Task<bool> CanEditYearlessClubAsync(MySqlConnection conn, int memberId, int clubId);
    Task<bool> CanEditYearlessDistrictAsync(MySqlConnection conn, int memberId, int districtId);

    /// <summary>
    /// "Is this member an admin of this scope at all?" — nothing to do with years.
    ///
    /// For callers that must tell a SCOPED ADMIN HOLDING ZERO YEARS, who has to be
    /// refused, apart from someone authorised by a different path entirely — a Zonal
    /// Co-ordinator over their zone, a District Assistant — who holds no admin row
    /// here and must NOT be year-limited. <c>AdminYearRights.Any</c> cannot tell
    /// those two apart: it is false for both.
    ///
    /// Pass the club id, or the district id with clubId 0.
    /// </summary>
    Task<bool> HasAdminStandingAsync(MySqlConnection conn, int memberId, int clubId, int districtId);

    /// <summary>
    /// The years this member may GRANT to someone else in this scope. A
    /// District Admin may pass on only years they hold themselves, and never
    /// All Years; SuperAdmin may grant anything.
    /// </summary>
    Task<AdminYearRights> GetGrantableDistrictYearsAsync(MySqlConnection conn, int memberId, int districtId);

    /// <summary>The years a CLUB admin may hand on in this club.</summary>
    Task<AdminYearRights> GetGrantableClubYearsAsync(MySqlConnection conn, int memberId, int clubId);

    /// <summary>
    /// Replaces someone's MANUAL grants in one scope with exactly the years given.
    /// Role-based rights (President / Secretary / Executive Secretary) are never
    /// touched — they come from the board and are computed live.
    /// </summary>
    Task SetManualGrantsAsync(
        MySqlConnection conn, int targetMemberId, int? clubId, int? districtId,
        IEnumerable<int> yearIds, bool allYears, int grantedBy, MySqlTransaction? tx = null);

    /// <summary>
    /// Remove Admin, scoped to the years the REMOVER holds.
    ///
    /// The mirror of granting: you may take back only what you could have given.
    /// Years the remover does not hold survive, and the member keeps the Admin
    /// role while anything of theirs remains.
    /// </summary>
    /// <remarks>
    /// ⚠️ No transaction parameter, deliberately. This reads rights through
    /// GetClubRightsAsync / GetDistrictRightsAsync, which run their own commands
    /// with no transaction — inside an open one MySqlConnector throws "not the
    /// connection's active transaction". Taking a tx it cannot honour would be a
    /// trap for the next caller.
    /// </remarks>
    Task<YearRemovalResult> RemoveYearsYouHoldAsync(
        MySqlConnection conn, int targetMemberId, int? clubId, int? districtId,
        int removerMemberId, int revokedBy);

    /// <summary>Withdraws every manual grant in one scope.</summary>
    Task RevokeManualGrantsAsync(
        MySqlConnection conn, int targetMemberId, int? clubId, int? districtId, int revokedBy,
        MySqlTransaction? tx = null);

    /// <summary>
    /// The rights-bearing office this member holds in this scope for the CURRENT
    /// Rotary year, or null. "Club President", "Club Secretary",
    /// "Club Executive Secretary" or "District Governor".
    ///
    /// Used to stop Remove Admin being used on a SITTING office-holder, which
    /// would strip the role while the office keeps granting the year — leaving
    /// someone with rights they cannot reach.
    /// </summary>
    Task<string?> SittingOfficeAsync(MySqlConnection conn, int memberId, int? clubId, int? districtId);
}

/// <summary>What a member may edit in one scope.</summary>
public class AdminYearRights
{
    /// <summary>Every year, including ones not created yet (SuperAdmin, the SITTING Executive Secretary, an AllYears grant).</summary>
    public bool AllYears { get; set; }

    /// <summary>Specific year ids. Ignore when <see cref="AllYears"/> is true.</summary>
    public HashSet<int> YearIds { get; set; } = new();

    /// <summary>Why — for the UI ("from your role as Club President"). Never a permission decision.</summary>
    public List<string> Sources { get; set; } = new();

    public bool Covers(int yearId) => AllYears || YearIds.Contains(yearId);
    public bool Any => AllYears || YearIds.Count > 0;
}

/// <summary>What a year-scoped Remove Admin actually did.</summary>
public class YearRemovalResult
{
    /// <summary>Set when nothing was removed and the caller should be told why.</summary>
    public string? Refusal { get; init; }

    /// <summary>The year labels taken away, for the confirmation message.</summary>
    public List<string> RemovedYears { get; init; } = new();

    /// <summary>
    /// True when the member still administers SOMETHING here afterwards — other
    /// granted years, or an office. The Admin ROLE must then stay switched on,
    /// or they would hold years they cannot reach.
    /// </summary>
    public bool StillHasRights { get; init; }

    public bool Refused => Refusal != null;
}

public class AdminYearService : IAdminYearService
{
    // Whether the year rule applies to a given club / district at all. SuperAdmin
    // switches it per scope on Settings → Year-wise Admin Rights.
    private readonly YearRuleScopeHelper _scope;
    private readonly string _cs;
    public AdminYearService(YearRuleScopeHelper scope, IConfiguration config)
    {
        _scope = scope;
        _cs = config.GetConnectionString("DefaultConnection") ?? "";
    }

    // Matched by ID, never by name. The designation table holds near-misses that
    // text matching gets wrong — "President Elect" (id 5) is not the President,
    // and "Club Executive Secretary/Director" (id 6) is not the Secretary. It
    // also holds soft-deleted duplicates of several names.
    public const int DesignationClubPresident = 1;
    public const int DesignationClubSecretary = 2;
    public const int DesignationClubExecutiveSecretary = 6;

    private const string CurrentYearIdSql =
        "(SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND COALESCE(isdeleted,0) = 0 LIMIT 1)";

    private static async Task<bool> IsSuperAdminAsync(MySqlConnection conn, int memberId) =>
        await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM member_roles mr
            JOIN roles r ON r.pk_role_id = mr.fk_role_id
            WHERE mr.fk_member_master_profile_id = @MemberId
              AND r.RoleName = 'SuperAdmin'
              AND mr.IsActive = 1 AND COALESCE(mr.isdeleted,0) = 0",
            new { MemberId = memberId }) > 0;

    public static async Task<int?> GetCurrentYearIdAsync(MySqlConnection conn) =>
        await conn.ExecuteScalarAsync<int?>(
            "SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND COALESCE(isdeleted,0) = 0 LIMIT 1");

    // ── Club ────────────────────────────────────────────────────────────────

    /// <summary>
    /// Public entry point: the core year rights, widened to All Years when the year
    /// rule is switched OFF for this club.
    /// </summary>
    public async Task<AdminYearRights> GetClubRightsAsync(MySqlConnection conn, int memberId, int clubId)
    {
        var rights = await ClubRightsCoreAsync(conn, memberId, clubId);
        if (rights.AllYears) return rights;                              // nothing left to widen
        if (await _scope.IsOnForClubAsync(conn, clubId))                 // rule applies — as before
        {
            await AddDelegatedClubYearsAsync(conn, memberId, clubId, rights);
            return rights;
        }

        // ── Year rule OFF for this club ─────────────────────────────────────
        // Behave as the API did before YWAR: an admin of this club edits ANY year.
        //
        // ⚠️ Only the YEAR half is lifted. Standing is still required, and it must
        // be proved HERE. AdminYearGuard reads `rights.Any` as "is this person an
        // admin of this club at all?" and 403s when it is false — that one line is
        // what stands between a plain member and the write endpoints of all 34
        // guarded controllers. Returning AllYears unconditionally would open every
        // one of them to anyone with a login.
        //
        // The test is deliberately WIDER than `rights.Any`: someone holding the
        // Admin role on this club with no grant and no office has no years, so
        // rights.Any is false — yet they could edit before YWAR and must be able
        // to again when the rule is off. (That same gap is why admins see refused
        // buttons on pages where the rule IS on.)
        if (await HasClubAdminStandingAsync(conn, memberId, clubId, rights))
        {
            rights.AllYears = true;
            rights.Sources.Add("Year rule off for this club");
            return rights;
        }
        await AddDelegatedClubYearsAsync(conn, memberId, clubId, rights);
        return rights;
    }

    // An Assistant Governor and an elect officer (PE / SE, DGE / DS / DT) pass the scope guard
    // (ScopeWriteGuardMiddleware, PlanningAccess) without an admin role, office or grant here, so without these
    // years the year guard refused them every write (regression found 2026-11-20). Added AFTER the rule-off
    // widening on purpose: they give exactly the year the role covers, never All Years, and are never grantable.
    private async Task AddDelegatedClubYearsAsync(MySqlConnection conn, int memberId, int clubId, AdminYearRights rights)
    {
        // Same rows as the scope guard: an AG year that has not started yet gives nothing.
        var agYears = await conn.QueryAsync<int>(@"
            SELECT ag.fk_year_id FROM district_ag ag
            JOIN rotary_year_master y ON y.pk_year_id = ag.fk_year_id
            WHERE ag.fk_member_id = @memberId AND ag.fk_club_id = @clubId AND ag.is_active = 1 AND ag.isdeleted = 0
              AND y.StartDate <= CURDATE()", new { memberId, clubId });
        foreach (var y in agYears)
            if (rights.YearIds.Add(y) && !rights.Sources.Contains("Assistant Governor")) rights.Sources.Add("Assistant Governor");
        await AddElectYearAsync(conn, memberId, true, clubId, rights);
    }

    private async Task AddElectYearAsync(MySqlConnection conn, int memberId, bool isClub, int scopeId, AdminYearRights rights)
    {
        if (!await FeatureGate.IsOnAsync(PlanningAccess.FeatureKey, _cs)) return;
        if (await PlanningAccess.ElectYearAsync(conn, memberId, isClub, scopeId) is int year && rights.YearIds.Add(year))
            rights.Sources.Add("Elect officer (planning)");
    }

    /// <summary>
    /// The year rights themselves, with the ON/OFF switch NOT applied. Used by the
    /// grantable-years methods, which must never hand out years the member only has
    /// because the rule is currently off.
    /// </summary>
    private async Task<AdminYearRights> ClubRightsCoreAsync(MySqlConnection conn, int memberId, int clubId)
    {
        var rights = new AdminYearRights();
        if (memberId <= 0 || clubId <= 0) return rights;

        if (await IsSuperAdminAsync(conn, memberId))
        {
            rights.AllYears = true;
            rights.Sources.Add("SuperAdmin");
            return rights;
        }

        // (1) Manual grants for this club.
        await AddManualGrantsAsync(conn, rights, memberId, clubId: clubId, districtId: null);

        // (2) Office held on this club's board, by designation ID.
        var bod = await conn.QueryAsync<(int DesignationId, int YearId)>(@"
            SELECT fk_designation_id AS DesignationId, fk_year_id AS YearId
            FROM board_of_directors
            WHERE fk_member_master_profile_id = @MemberId
              AND fk_club_id = @ClubId
              AND COALESCE(isdeleted,0) = 0
              AND fk_designation_id IN (@Pres, @Sec, @ExecSec)",
            new
            {
                MemberId = memberId,
                ClubId = clubId,
                Pres = DesignationClubPresident,
                Sec = DesignationClubSecretary,
                ExecSec = DesignationClubExecutiveSecretary,
            });

        // All Years follows the SITTING Executive Secretary only (2026-11-09). Resolved once;
        // null (no current year configured) = fail closed: the post's own year only.
        var currentYearId = await GetCurrentYearIdAsync(conn);
        foreach (var row in bod)
        {
            if (row.DesignationId == DesignationClubExecutiveSecretary)
            {
                if (!rights.Sources.Contains("Club Executive Secretary"))
                    rights.Sources.Add("Club Executive Secretary");
                if (currentYearId is int cy && row.YearId == cy)
                    rights.AllYears = true;            // sitting holder: every year
                else
                    rights.YearIds.Add(row.YearId);    // past holder: that year only
                continue;
            }
            // President / Secretary earn ONLY the year they hold the office.
            rights.YearIds.Add(row.YearId);
            var label = row.DesignationId == DesignationClubPresident ? "Club President" : "Club Secretary";
            if (!rights.Sources.Contains(label)) rights.Sources.Add(label);
        }

        // (3) A District Admin WITH all-clubs access reaches every club of their
        //     district — the same years they hold on the district. Without this
        //     the flag would be a way around the year rule entirely.
        var districtId = await conn.ExecuteScalarAsync<int?>(
            "SELECT fk_district_id FROM club_master WHERE pk_club_id = @ClubId", new { ClubId = clubId });
        if (districtId is int did && did > 0)
        {
            var hasAllClubs = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM member_roles
                WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 2
                  AND fk_district_id = @DistrictId AND COALESCE(fk_club_id,0) = 0
                  AND COALESCE(AllClubsAccess,0) = 1
                  AND IsActive = 1 AND COALESCE(isdeleted,0) = 0",
                new { MemberId = memberId, DistrictId = did }) > 0;

            if (hasAllClubs)
            {
                // CORE, not the public method: this is a CLUB-scoped check, so the
                // CLUB's switch governs it (applied by the caller). Using the widened
                // district rights here would let a club whose rule is ON inherit All
                // Years from a district whose rule is OFF.
                var viaDistrict = await DistrictRightsCoreAsync(conn, memberId, did);
                if (viaDistrict.AllYears) rights.AllYears = true;
                foreach (var y in viaDistrict.YearIds) rights.YearIds.Add(y);
                if (viaDistrict.Any && !rights.Sources.Contains("District Admin (all clubs)"))
                    rights.Sources.Add("District Admin (all clubs)");
            }
        }

        return rights;
    }

    // ── District ────────────────────────────────────────────────────────────

    /// <summary>District twin of <see cref="GetClubRightsAsync"/>.</summary>
    public async Task<AdminYearRights> GetDistrictRightsAsync(MySqlConnection conn, int memberId, int districtId)
    {
        var rights = await DistrictRightsCoreAsync(conn, memberId, districtId);
        if (rights.AllYears) return rights;
        // See GetClubRightsAsync for why standing must be proved before widening, and why elect years come after.
        if (!await _scope.IsOnForDistrictAsync(conn, districtId)
            && await HasDistrictAdminStandingAsync(conn, memberId, districtId, rights))
        {
            rights.AllYears = true;
            rights.Sources.Add("Year rule off for this district");
            return rights;
        }
        await AddElectYearAsync(conn, memberId, false, districtId, rights);
        return rights;
    }

    /// <summary>The district year rights with the ON/OFF switch NOT applied.</summary>
    private async Task<AdminYearRights> DistrictRightsCoreAsync(MySqlConnection conn, int memberId, int districtId)
    {
        var rights = new AdminYearRights();
        if (memberId <= 0 || districtId <= 0) return rights;

        if (await IsSuperAdminAsync(conn, memberId))
        {
            rights.AllYears = true;
            rights.Sources.Add("SuperAdmin");
            return rights;
        }

        // (1) Manual grants for this district.
        await AddManualGrantsAsync(conn, rights, memberId, clubId: null, districtId: districtId);

        // (2) District Governor of this district — the district's answer to the
        //     club's President/Secretary rule: holding the office earns THE YEAR
        //     YOU HOLD IT FOR, and nothing else.
        //
        //     ⚠️ fk_member_id is nullable on district_governors (legacy rows carry
        //     only a typed-in member_name), so a null there must never match.
        var dgYears = await conn.QueryAsync<int>(@"
            SELECT fk_year_id
            FROM district_governors
            WHERE fk_member_id = @MemberId
              AND fk_district_id = @DistrictId
              AND fk_member_id IS NOT NULL
              AND COALESCE(isdeleted,0) = 0",
            new { MemberId = memberId, DistrictId = districtId });

        foreach (var y in dgYears)
        {
            rights.YearIds.Add(y);
            if (!rights.Sources.Contains("District Governor")) rights.Sources.Add("District Governor");
        }

        return rights;
    }

    // Preflight only — see the interface for why this exists.
    public Task<AdminYearRights> GetClubRightsIfRuleOnAsync(MySqlConnection conn, int memberId, int clubId)
        => ClubRightsCoreAsync(conn, memberId, clubId);

    public Task<AdminYearRights> GetDistrictRightsIfRuleOnAsync(MySqlConnection conn, int memberId, int districtId)
        => DistrictRightsCoreAsync(conn, memberId, districtId);

    // ── Standing: "is this person an admin of this scope at all?" ───────────
    //
    // Used ONLY on the year-rule-off path, to decide whether there is anything to
    // widen. Never used to decide a year.
    //
    // fk_role_id = 2 is Admin — the same row the clients' isClubAdminOf /
    // isDistrictAdminOf read, so a member who sees admin screens on the app is
    // exactly the member who passes here.

    private static async Task<bool> HasClubAdminStandingAsync(
        MySqlConnection conn, int memberId, int clubId, AdminYearRights core)
    {
        // Any year, grant or office already proves it.
        if (core.Any) return true;
        if (memberId <= 0 || clubId <= 0) return false;

        // Admin role on this club.
        var onClub = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM member_roles
            WHERE fk_member_master_profile_id = @MemberId
              AND fk_role_id = 2
              AND fk_club_id = @ClubId
              AND IsActive = 1 AND COALESCE(isdeleted, 0) = 0",
            new { MemberId = memberId, ClubId = clubId });
        if (onClub > 0) return true;

        // District Admin with all-clubs access over this club's district. Core only
        // added years for this path, so a holder with no years at all reaches here.
        return await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM member_roles mr
            JOIN club_master c ON c.pk_club_id = @ClubId
            WHERE mr.fk_member_master_profile_id = @MemberId
              AND mr.fk_role_id = 2
              AND mr.fk_district_id = c.fk_district_id
              AND COALESCE(mr.fk_club_id, 0) = 0
              AND COALESCE(mr.AllClubsAccess, 0) = 1
              AND mr.IsActive = 1 AND COALESCE(mr.isdeleted, 0) = 0",
            new { MemberId = memberId, ClubId = clubId }) > 0;
    }

    /// <summary>
    /// The public face of the two helpers above, for callers outside the year-rule-off
    /// path that need "is this an admin here?" on its own. A fresh (empty) rights object
    /// is passed deliberately so the <c>core.Any</c> shortcut cannot mask the answer —
    /// the point is to query standing, not to reuse a years verdict.
    /// </summary>
    public async Task<bool> HasAdminStandingAsync(
        MySqlConnection conn, int memberId, int clubId, int districtId)
    {
        if (clubId > 0)
            return await HasClubAdminStandingAsync(conn, memberId, clubId, new AdminYearRights());
        if (districtId > 0)
            return await HasDistrictAdminStandingAsync(conn, memberId, districtId, new AdminYearRights());
        return false;
    }

    private static async Task<bool> HasDistrictAdminStandingAsync(
        MySqlConnection conn, int memberId, int districtId, AdminYearRights core)
    {
        if (core.Any) return true;
        if (memberId <= 0 || districtId <= 0) return false;

        return await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM member_roles
            WHERE fk_member_master_profile_id = @MemberId
              AND fk_role_id = 2
              AND fk_district_id = @DistrictId
              AND COALESCE(fk_club_id, 0) = 0
              AND IsActive = 1 AND COALESCE(isdeleted, 0) = 0",
            new { MemberId = memberId, DistrictId = districtId }) > 0;
    }

    private static async Task AddManualGrantsAsync(
        MySqlConnection conn, AdminYearRights rights, int memberId, int? clubId, int? districtId)
    {
        // 0 means "not this scope" — the columns are 0-not-NULL so the unique
        // index actually works (NULLs would make every row distinct).
        var scopeWhere = clubId.HasValue
            ? "fk_club_id = @ClubId AND COALESCE(fk_district_id,0) = 0"
            : "fk_district_id = @DistrictId AND COALESCE(fk_club_id,0) = 0";

        var grants = await conn.QueryAsync<(int? YearId, bool AllYears)>($@"
            SELECT fk_year_id AS YearId, AllYears
            FROM member_admin_years
            WHERE fk_member_master_profile_id = @MemberId
              AND {scopeWhere}
              AND IsActive = 1 AND COALESCE(isdeleted,0) = 0",
            new { MemberId = memberId, ClubId = clubId, DistrictId = districtId });

        var added = false;
        foreach (var g in grants)
        {
            added = true;
            if (g.AllYears) rights.AllYears = true;
            else if (g.YearId is int y && y > 0) rights.YearIds.Add(y);
        }
        if (added && !rights.Sources.Contains("Granted")) rights.Sources.Add("Granted");
    }

    // ── The checks endpoints call ───────────────────────────────────────────

    public async Task<bool> CanEditClubYearAsync(MySqlConnection conn, int memberId, int clubId, int yearId) =>
        (await GetClubRightsAsync(conn, memberId, clubId)).Covers(yearId);

    public async Task<bool> CanEditDistrictYearAsync(MySqlConnection conn, int memberId, int districtId, int yearId) =>
        (await GetDistrictRightsAsync(conn, memberId, districtId)).Covers(yearId);

    public async Task<bool> CanEditYearlessClubAsync(MySqlConnection conn, int memberId, int clubId)
    {
        var current = await GetCurrentYearIdAsync(conn);
        // No current year configured is a server misconfiguration, not a licence
        // to edit — refuse rather than fall open.
        if (current is not int y) return false;
        return await CanEditClubYearAsync(conn, memberId, clubId, y);
    }

    public async Task<bool> CanEditYearlessDistrictAsync(MySqlConnection conn, int memberId, int districtId)
    {
        var current = await GetCurrentYearIdAsync(conn);
        if (current is not int y) return false;
        return await CanEditDistrictYearAsync(conn, memberId, districtId, y);
    }

    // ── Granting ────────────────────────────────────────────────────────────

    public async Task<AdminYearRights> GetGrantableDistrictYearsAsync(
        MySqlConnection conn, int memberId, int districtId)
    {
        if (await IsSuperAdminAsync(conn, memberId))
            return new AdminYearRights { AllYears = true, Sources = { "SuperAdmin" } };

        // A District Admin passes on only what they hold, and never All Years —
        // otherwise a single-year admin could mint a permanent one.
        //
        // ⚠️ CORE rights, so the switch is NOT applied. While the rule is off every
        // admin here looks like All Years, and granting from that would let anyone
        // hand out every year — grants that then start biting the day a SuperAdmin
        // switches the rule back ON. Granting stays bounded by the years actually
        // held either way.
        var own = await DistrictRightsCoreAsync(conn, memberId, districtId);
        if (!own.Any) return new AdminYearRights();

        if (own.AllYears)
        {
            // They hold All Years themselves, but may still only hand out
            // CONCRETE years. Expand to the years that exist today.
            var years = await conn.QueryAsync<int>(
                "SELECT pk_year_id FROM rotary_year_master WHERE COALESCE(isdeleted,0) = 0");
            return new AdminYearRights { YearIds = years.ToHashSet(), Sources = { "District Admin" } };
        }

        return new AdminYearRights { YearIds = own.YearIds, Sources = { "District Admin" } };
    }

    public async Task<AdminYearRights> GetGrantableClubYearsAsync(
        MySqlConnection conn, int memberId, int clubId)
    {
        if (await IsSuperAdminAsync(conn, memberId))
            return new AdminYearRights { AllYears = true, Sources = { "SuperAdmin" } };

        // You may only pass on years you hold yourself, and never All Years —
        // otherwise a single-year admin could mint a permanent one.
        //
        // ⚠️ CORE rights — see GetGrantableDistrictYearsAsync for why the ON/OFF
        // switch must not widen what can be handed out.
        var own = await ClubRightsCoreAsync(conn, memberId, clubId);
        if (!own.Any) return new AdminYearRights();

        if (own.AllYears)
        {
            var years = await conn.QueryAsync<int>(
                "SELECT pk_year_id FROM rotary_year_master WHERE COALESCE(isdeleted,0) = 0");
            return new AdminYearRights { YearIds = years.ToHashSet(), Sources = { "Club Admin" } };
        }
        return new AdminYearRights { YearIds = own.YearIds, Sources = { "Club Admin" } };
    }

    public async Task<string?> SittingOfficeAsync(
        MySqlConnection conn, int memberId, int? clubId, int? districtId)
    {
        if (memberId <= 0) return null;

        // The CURRENT year only. A president of 2021-22 is not sitting, and
        // removing their admin role today takes nothing away that they still
        // need — their 2021-22 rights are unaffected either way.
        var current = await GetCurrentYearIdAsync(conn);
        if (current is not int year) return null;

        if ((clubId ?? 0) > 0)
        {
            var designation = await conn.ExecuteScalarAsync<int?>(@"
                SELECT fk_designation_id FROM board_of_directors
                WHERE fk_member_master_profile_id = @MemberId
                  AND fk_club_id = @ClubId
                  AND fk_year_id = @YearId
                  AND fk_designation_id IN (@Pres, @Sec, @ExecSec)
                  AND COALESCE(isdeleted,0) = 0
                -- Someone can hold more than one of these at once. Name the most
                -- senior, or the message points at the wrong record to change.
                ORDER BY FIELD(fk_designation_id, @Pres, @Sec, @ExecSec)
                LIMIT 1",
                new
                {
                    MemberId = memberId, ClubId = clubId!.Value, YearId = year,
                    Pres = DesignationClubPresident,
                    Sec = DesignationClubSecretary,
                    ExecSec = DesignationClubExecutiveSecretary,
                });

            return designation switch
            {
                DesignationClubPresident => "Club President",
                DesignationClubSecretary => "Club Secretary",
                DesignationClubExecutiveSecretary => "Club Executive Secretary",
                _ => null,
            };
        }

        if ((districtId ?? 0) > 0)
        {
            var isDg = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM district_governors
                WHERE fk_member_id = @MemberId
                  AND fk_district_id = @DistrictId
                  AND fk_year_id = @YearId
                  AND COALESCE(isdeleted,0) = 0",
                new { MemberId = memberId, DistrictId = districtId!.Value, YearId = year }) > 0;

            return isDg ? "District Governor" : null;
        }

        return null;
    }

    public async Task<YearRemovalResult> RemoveYearsYouHoldAsync(
        MySqlConnection conn, int targetMemberId, int? clubId, int? districtId,
        int removerMemberId, int revokedBy)
    {
        MySqlTransaction? tx = null;   // see the interface remark: never transactional
        var isClub = (clubId ?? 0) > 0;

        // What the REMOVER may take back — the same set they could grant.
        var removerRights = isClub
            ? await GetClubRightsAsync(conn, removerMemberId, clubId!.Value)
            : await GetDistrictRightsAsync(conn, removerMemberId, districtId ?? 0);

        // What the TARGET holds as GRANTS. Office-based years are not in this
        // table and cannot be removed here at all — the board or DG record has
        // to change, which is what the sitting-office check tells the caller.
        var scopeWhere = isClub
            ? "fk_club_id = @ClubId AND COALESCE(fk_district_id,0) = 0"
            : "fk_district_id = @DistrictId AND COALESCE(fk_club_id,0) = 0";

        var grants = (await conn.QueryAsync<(int? YearId, bool AllYears)>($@"
            SELECT fk_year_id AS YearId, AllYears
            FROM member_admin_years
            WHERE fk_member_master_profile_id = @MemberId
              AND {scopeWhere}
              AND IsActive = 1 AND COALESCE(isdeleted,0) = 0",
            new { MemberId = targetMemberId, ClubId = clubId, DistrictId = districtId }, tx)).ToList();

        var targetYears = grants.Where(g => !g.AllYears && g.YearId is int y && y > 0)
                                .Select(g => g.YearId!.Value).ToHashSet();
        var targetHasAllYears = grants.Any(g => g.AllYears);

        // ── Refusal 1: an All Years grant. Only someone who holds every year can
        //    take every year back, and that is a SuperAdmin.
        if (targetHasAllYears && !removerRights.AllYears)
            return new YearRemovalResult
            {
                Refusal = "This member is an admin for All Years. Only a Super Admin can remove that.",
            };

        // The years this remover is entitled to strip.
        var removable = removerRights.AllYears
            ? targetYears
            : targetYears.Where(y => removerRights.Covers(y)).ToHashSet();

        // ⚠️ Nothing GRANTED here at all — so there is nothing to clamp, and the
        // clamp must not become a veto. Remove Admin's job is the ROLE; the years
        // are only the part that has to be scoped. Refusing here stopped even a
        // SuperAdmin from removing an admin whose rights came from an office, or
        // whose grants had already been withdrawn — the button simply errored.
        if (targetYears.Count == 0 && !targetHasAllYears)
            return new YearRemovalResult { StillHasRights = false };

        // ── Refusal 2: they hold years here, but none of them are yours.
        if (removable.Count == 0 && !(targetHasAllYears && removerRights.AllYears))
        {
            var mine = await YearLabelsForAsync(conn, removerRights.YearIds, tx);
            var theirs = await YearLabelsForAsync(conn, targetYears, tx);
            return new YearRemovalResult
            {
                Refusal = removerRights.AllYears || mine.Count > 0
                    ? $"You can only remove the Rotary years you administer ({(removerRights.AllYears ? "all years" : string.Join(", ", mine))}). "
                      + (theirs.Count > 0
                            ? $"This member holds {string.Join(", ", theirs)}, none of which is yours to remove."
                            : "This member holds no granted years here.")
                    : "You do not administer any Rotary year here, so there is nothing you can remove.",
            };
        }

        var removedLabels = await YearLabelsForAsync(conn, removable, tx);

        // Write back exactly what survives. Role-based years are untouched —
        // they never lived in this table.
        var remaining = targetYears.Except(removable).ToList();
        await SetManualGrantsAsync(
            conn, targetMemberId, clubId, districtId,
            remaining, allYears: targetHasAllYears && !removerRights.AllYears,
            grantedBy: revokedBy, tx: tx);

        // Do they still hold GRANTED years here? If so the Admin ROLE stays on, or
        // they would hold years with no way to reach them.
        //
        // ⚠️ Granted years only — not office-based ones. A past president keeps
        // their year from the board whatever happens here, and counting that would
        // make Remove Admin a permanent no-op for every former office-holder.
        // A SERVING office-holder is a different case and is refused earlier, by
        // the sitting-office check in the controller.
        return new YearRemovalResult
        {
            RemovedYears = removedLabels,
            StillHasRights = remaining.Any(),
        };
    }

    private static async Task<List<string>> YearLabelsForAsync(
        MySqlConnection conn, IEnumerable<int> ids, MySqlTransaction? tx)
    {
        var list = ids.Where(i => i > 0).Distinct().ToList();
        if (list.Count == 0) return new List<string>();
        var rows = await conn.QueryAsync<string>(
            "SELECT YearLabel FROM rotary_year_master WHERE pk_year_id IN @Ids ORDER BY StartDate",
            new { Ids = list }, tx);
        return rows.ToList();
    }

    public async Task SetManualGrantsAsync(
        MySqlConnection conn, int targetMemberId, int? clubId, int? districtId,
        IEnumerable<int> yearIds, bool allYears, int grantedBy, MySqlTransaction? tx = null)
    {
        if (targetMemberId <= 0) return;
        if ((clubId ?? 0) <= 0 && (districtId ?? 0) <= 0) return;

        var scopeWhere = (clubId ?? 0) > 0
            ? "fk_club_id = @ClubId AND COALESCE(fk_district_id,0) = 0"
            : "fk_district_id = @DistrictId AND COALESCE(fk_club_id,0) = 0";

        // Withdraw what is there now, then write the new set. Soft-delete rather
        // than DELETE so the audit trail survives — the whole point of keeping
        // grants in their own table.
        await conn.ExecuteAsync($@"
            UPDATE member_admin_years
            SET IsActive = 0, RevokedBy = @By, RevokedDate = NOW(), modified_by = @By
            WHERE fk_member_master_profile_id = @MemberId AND {scopeWhere}
              AND IsActive = 1 AND COALESCE(isdeleted,0) = 0",
            new { MemberId = targetMemberId, ClubId = clubId, DistrictId = districtId, By = grantedBy },
            transaction: tx);

        if (allYears)
        {
            await InsertGrantAsync(conn, targetMemberId, clubId, districtId, null, true, grantedBy, tx);
            return;
        }

        foreach (var y in yearIds.Distinct().Where(y => y > 0))
            await InsertGrantAsync(conn, targetMemberId, clubId, districtId, y, false, grantedBy, tx);
    }

    /// <summary>
    /// Writes one grant. Re-activates an existing row for the same
    /// (member, scope, year) rather than inserting a duplicate — the unique index
    /// covers the year rows, and the AllYears rows (year IS NULL) are de-duplicated
    /// here because MySQL treats NULLs as distinct in a UNIQUE index.
    /// </summary>
    private static async Task InsertGrantAsync(
        MySqlConnection conn, int memberId, int? clubId, int? districtId,
        int? yearId, bool allYears, int grantedBy, MySqlTransaction? tx = null)
    {
        var scopeWhere = (clubId ?? 0) > 0
            ? "fk_club_id = @ClubId AND COALESCE(fk_district_id,0) = 0"
            : "fk_district_id = @DistrictId AND COALESCE(fk_club_id,0) = 0";
        // AllYears rows are year 0, not NULL — same unique-index reason.
        var yearWhere = "fk_year_id = @YearId";

        var revived = await conn.ExecuteAsync($@"
            UPDATE member_admin_years
            SET IsActive = 1, isdeleted = 0, AllYears = @AllYears,
                GrantedBy = @By, GrantedDate = NOW(), RevokedBy = NULL, RevokedDate = NULL,
                modified_by = @By
            WHERE fk_member_master_profile_id = @MemberId AND {scopeWhere} AND {yearWhere}",
            new
            {
                MemberId = memberId, ClubId = clubId ?? 0, DistrictId = districtId ?? 0,
                YearId = yearId ?? 0, AllYears = allYears ? 1 : 0, By = grantedBy,
            },
            transaction: tx);
        if (revived > 0) return;

        await conn.ExecuteAsync(@"
            INSERT INTO member_admin_years
                (fk_member_master_profile_id, fk_club_id, fk_district_id, fk_year_id,
                 AllYears, GrantedBy, GrantedDate, IsActive, isdeleted, created_by)
            VALUES (@MemberId, @ClubId, @DistrictId, @YearId, @AllYears, @By, NOW(), 1, 0, @By)",
            new
            {
                MemberId = memberId, ClubId = clubId ?? 0, DistrictId = districtId ?? 0,
                YearId = yearId ?? 0, AllYears = allYears ? 1 : 0, By = grantedBy,
            },
            transaction: tx);
    }

    public async Task RevokeManualGrantsAsync(
        MySqlConnection conn, int targetMemberId, int? clubId, int? districtId, int revokedBy,
        MySqlTransaction? tx = null)
        => await SetManualGrantsAsync(
            conn, targetMemberId, clubId, districtId,
            Array.Empty<int>(), allYears: false, grantedBy: revokedBy, tx: tx);

    // Kept so the SQL constant is referenced from one place if inlined later.
    internal static string CurrentYearSubquery => CurrentYearIdSql;
}
