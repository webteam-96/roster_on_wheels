using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Dapper;
using MySqlConnector;
using Microsoft.Extensions.Localization;
using RotaryApi.DTOs;
using RotaryApi.Services.Localization;

namespace RotaryApi.Services;

/// <summary>
/// Planning mode, elect access and cut-over (ROW build spec 3.1, switch planning_mode). A district tenant goes
/// live -> planning (StartAsync: the year being planned, the DGE and the elect PEs / SEs RI already holds, a 1 July
/// cut-over) -> live (CutOverAsync). Elect roles are planning_roles rows; PlanningAccess turns an active one into
/// write access on the year being planned. The cut-over's RI steps go to ri_outbound_queue, which nothing sends yet
/// (the RI outbound path is spec 3.2). Controller: PlanningController; job: PlanningCutoverBackgroundService.
/// </summary>
public class PlanningService
{
    private const int InviteDays = 14;
    private static readonly Dictionary<string, string> RoleNames = new()
    {
        ["DGE"] = "governor-elect", ["DS"] = "district secretary", ["DT"] = "district treasurer",
        ["PE"] = "president-elect", ["SE"] = "secretary-elect",
    };
    // RI's six officer titles (spec 3.2, 3.12) as Super Admin maps them to designations (designation_master.ri_title,
    // Settings > Designations); other designations are not pushed to RI.
    private const string RiTitleSql = "ds.ri_title";

    private const string StateSql = @"
        SELECT ts.fk_district_id AS DistrictId, d.DistrictNumber, ts.state AS State,
               ts.planning_year_id AS PlanningYearId, py.YearLabel AS PlanningYearLabel,
               py.StartDate AS PlanningYearStart, py.EndDate AS PlanningYearEnd,
               ts.cutover_at AS CutoverAt, ts.cutover_done_at AS CutoverDoneAt
        FROM tenant_subscriptions ts
        JOIN district_master d ON d.pk_district_id = ts.fk_district_id
        LEFT JOIN rotary_year_master py ON py.pk_year_id = ts.planning_year_id
        WHERE ts.fk_club_id = 0 AND ts.fk_district_id = @districtId";

    private const string RoleSelect = @"
        SELECT pr.pk_planning_role_id AS RoleId, pr.fk_district_id AS DistrictId, d.DistrictNumber,
               pr.fk_club_id AS ClubId, c.ClubName, pr.role_code AS Role, pr.status AS Status, pr.source AS Source,
               pr.fk_member_id AS MemberId, m.MemberName, pr.fk_year_id AS YearId, y.YearLabel,
               y.StartDate AS YearStart, y.EndDate AS YearEnd, pr.email_sent_at AS InvitedAt, pr.accepted_at AS AcceptedAt
        FROM planning_roles pr
        JOIN district_master d ON d.pk_district_id = pr.fk_district_id
        LEFT JOIN club_master c ON c.pk_club_id = pr.fk_club_id
        LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = pr.fk_member_id
        JOIN rotary_year_master y ON y.pk_year_id = pr.fk_year_id";

    // An active elect role in a district that is planning the role's year.
    private const string LiveTenantJoin = @"
        JOIN tenant_subscriptions ts ON ts.fk_district_id = pr.fk_district_id AND ts.fk_club_id = 0
             AND ts.state = 'planning' AND ts.planning_year_id = pr.fk_year_id";

    private readonly string _cs;
    private readonly IAuditLogService _audit;
    private readonly IEmailService _email;

    public PlanningService(IConfiguration config, IAuditLogService audit, IEmailService email)
    {
        _cs = config.GetConnectionString("DefaultConnection")!;
        _audit = audit;
        _email = email;
    }

    // ===== Reads =====

    /// <summary>A district's planning state (by district, or by one of its clubs); null for an unknown club.</summary>
    public async Task<PlanningStateDto?> StateAsync(int? districtId, int? clubId)
    {
        await using var conn = new MySqlConnection(_cs);
        var d = districtId ?? await conn.ExecuteScalarAsync<int?>(
            "SELECT fk_district_id FROM club_master WHERE pk_club_id = @clubId AND isdeleted = 0", new { clubId });
        return d is int id ? await StateAsync(conn, id) : null;
    }

    private static async Task<PlanningStateDto> StateAsync(MySqlConnection conn, int districtId)
    {
        var s = await conn.QueryFirstOrDefaultAsync<PlanningStateDto>(StateSql, new { districtId })
                ?? new PlanningStateDto { DistrictId = districtId };
        if (await PlanningAccess.ReadOnlyYearAsync(conn, districtId, null, true) is { } ro)
        {
            s.ReadOnlyYearId = ro.Year;
            s.ReadOnlyYearArchived = ro.Archived;
            s.ReadOnlyYearLabel = await conn.ExecuteScalarAsync<string?>(
                "SELECT YearLabel FROM rotary_year_master WHERE pk_year_id = @Year", new { ro.Year });
        }
        return s;
    }

    /// <summary>The member's invited and active elect roles in districts that are planning (the admin's /planning
    /// page and the app).</summary>
    public async Task<List<PlanningRoleDto>> MyRolesAsync(int memberId)
    {
        await using var conn = new MySqlConnection(_cs);
        return (await conn.QueryAsync<PlanningRoleDto>(RoleSelect + LiveTenantJoin + @"
            WHERE pr.fk_member_id = @memberId AND pr.live = 1 AND pr.status IN ('invited', 'active')
            ORDER BY pr.fk_club_id, pr.role_code", new { memberId })).ToList();
    }

    /// <summary>Who may open a district's planning (SuperAdmin, an active district elect role, a district admin) and
    /// who runs it (SuperAdmin or the active DGE: appointments, invitations, revocations, cut-over).</summary>
    public async Task<(bool SuperAdmin, bool Dge, bool CanView)> AccessAsync(int memberId, int districtId)
    {
        await using var conn = new MySqlConnection(_cs);
        await conn.OpenAsync();
        var sa = await ClubAdminAccessHelper.IsSuperAdminAsync(conn, memberId);
        var role = await conn.ExecuteScalarAsync<string?>(@"
            SELECT pr.role_code FROM planning_roles pr" + LiveTenantJoin + @"
            WHERE pr.fk_member_id = @memberId AND pr.fk_district_id = @districtId AND pr.fk_club_id = 0 AND pr.status = 'active'
            ORDER BY pr.role_code = 'DGE' DESC LIMIT 1", new { memberId, districtId });
        var view = sa || role != null || await ScopeWriteGuardMiddleware.AllowedAsync(_cs, memberId, false, districtId);
        return (sa, role == "DGE", view);
    }

    public async Task<PlanningOverviewDto> OverviewAsync(int districtId, bool canManage)
    {
        await using var conn = new MySqlConnection(_cs);
        await conn.OpenAsync();
        var o = new PlanningOverviewDto { State = await StateAsync(conn, districtId), CanManage = canManage };
        if (o.State.State != "planning" || o.State.PlanningYearId is not int p) return o;
        var roles = (await conn.QueryAsync<PlanningRoleDto>(RoleSelect + @"
            WHERE pr.fk_district_id = @districtId AND pr.fk_year_id = @p AND pr.live = 1", new { districtId, p })).ToList();
        o.Team = roles.Where(r => r.ClubId == 0).OrderBy(r => Array.IndexOf(PlanningAccess.DistrictRoles, r.Role)).ToList();
        o.Clubs = (await conn.QueryAsync<PlanningClubDto>(@"
            SELECT pk_club_id AS ClubId, ClubName FROM club_master
            WHERE fk_district_id = @districtId AND isdeleted = 0 AND IFNULL(IsActive, 1) = 1 ORDER BY ClubName", new { districtId })).ToList();
        foreach (var c in o.Clubs)
        {
            c.Pe = roles.FirstOrDefault(r => r.ClubId == c.ClubId && r.Role == "PE");
            c.Se = roles.FirstOrDefault(r => r.ClubId == c.ClubId && r.Role == "SE");
        }
        o.Launchpad = await LaunchpadAsync(conn, districtId, p, o.Team, o.Clubs);
        return o;
    }

    private async Task<List<PlanningLaunchpadItemDto>> LaunchpadAsync(
        MySqlConnection conn, int districtId, int p, List<PlanningRoleDto> team, List<PlanningClubDto> clubs)
    {
        var n = await conn.QueryFirstAsync<(long Ags, long CommitteeMembers, long Goals)>(@"
            SELECT (SELECT COUNT(*) FROM district_ag WHERE fk_district_id = @districtId AND fk_year_id = @p AND isdeleted = 0),
                   (SELECT COUNT(*) FROM district_committee_member WHERE fk_district_id = @districtId AND fk_year_id = @p AND isdeleted = 0)
                 + (SELECT COUNT(*) FROM district_committee_group_member gm
                    JOIN district_committee_group g ON g.id = gm.fk_group_id
                    WHERE g.fk_district_id = @districtId AND g.fk_year_id = @p AND g.isdeleted = 0 AND gm.isdeleted = 0),
                   (SELECT COUNT(*) FROM district_membership_goal WHERE fk_district_id = @districtId AND fk_year_id = @p AND isdeleted = 0)
                 + (SELECT COUNT(*) FROM district_foundation_goal WHERE fk_district_id = @districtId AND fk_year_id = @p AND isdeleted = 0)",
            new { districtId, p });
        var titles = await EventTitlesAsync(conn, districtId, p);
        // shortcut: PETS and SETS are found by the event title, add an event type when the calendar gets one.
        bool Has(string word) => titles.Any(t => Regex.IsMatch(t, $@"\b{word}\b", RegexOptions.IgnoreCase));
        string Name(string role) => team.FirstOrDefault(r => r.Role == role)?.MemberName ?? "not appointed";
        var invited = clubs.Count(c => c.Pe != null && c.Se != null);
        return new()
        {
            new() { Key = "team", Label = "Team appointed",
                Done = team.Any(r => r.Role == "DS") && team.Any(r => r.Role == "DT") && n.Ags > 0 && n.CommitteeMembers > 0,
                Detail = $"Secretary: {Name("DS")}. Treasurer: {Name("DT")}. AG assignments: {n.Ags}. Committee members: {n.CommitteeMembers}." },
            new() { Key = "goals", Label = "Goals set", Done = n.Goals > 0,
                Detail = n.Goals > 0 ? "District goals are saved." : "No district goals yet." },
            new() { Key = "calendar", Label = "Calendar published", Done = titles.Count > 0, Detail = $"District events: {titles.Count}." },
            new() { Key = "pets_sets", Label = "PETS and SETS scheduled", Done = Has("PETS") && Has("SETS"),
                Detail = $"PETS: {(Has("PETS") ? "scheduled" : "not yet")}. SETS: {(Has("SETS") ? "scheduled" : "not yet")}." },
            new() { Key = "clubs_invited", Label = "Clubs invited", Done = clubs.Count > 0 && invited == clubs.Count,
                Detail = $"{invited} of {clubs.Count} clubs have a president-elect and a secretary-elect." },
            new() { Key = "clubs_ri", Label = "Clubs authorised with RI", Stub = true, Detail = "Shown once the RI vendor path is live." },
        };
    }

    /// <summary>Titles of the district's calendar events dated in a year (district upcoming events).</summary>
    // shortcut: an event counts once it is dated in the year, published or not; check PublishDate if "published" must mean visible.
    private static async Task<List<string>> EventTitlesAsync(MySqlConnection conn, int districtId, int yearId) =>
        (await conn.QueryAsync<string>(@"
            SELECT e.Title FROM upcoming_events e
            JOIN rotary_year_master y ON y.pk_year_id = @yearId
            WHERE e.fk_district_id = @districtId AND e.fk_club_id = 0 AND e.isdeleted = 0
              AND DATE(e.EventDate) BETWEEN y.StartDate AND y.EndDate", new { districtId, yearId })).ToList();

    // ===== Planning start (SuperAdmin) =====

    /// <summary>Puts a subscribed district in planning for next year: the DGE (given, or the one RI holds for that
    /// year), the PEs and SEs RI already holds (next-year officers synced from RI), and a cut-over on 1 July at
    /// midnight in the brand's time zone (there is no per-district zone yet). Starting again while planning replaces
    /// the DGE and picks up new RI elects; other elect roles stay.</summary>
    public async Task<object> StartAsync(int districtId, int? dgeMemberId, int by, HttpContext ctx)
    {
        await using var conn = new MySqlConnection(_cs);
        await conn.OpenAsync();
        var tenant = await conn.QueryFirstOrDefaultAsync<(string State, int? PlanningYear, DateTime? CutoverDone)?>(
            "SELECT state, planning_year_id, cutover_done_at FROM tenant_subscriptions WHERE fk_district_id = @districtId AND fk_club_id = 0",
            new { districtId });
        if (tenant is not { } t) throw new KeyNotFoundException("This district has no subscription yet. Save one in Settings > Tenants first.");
        var currentEnd = await conn.ExecuteScalarAsync<DateTime?>(
            "SELECT EndDate FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1")
            ?? throw new InvalidOperationException("No current Rotary year is set.");
        // the next year's row (the helper also creates its year tables, as for any new year)
        var p = await RotaryYearHelper.EnsureRotaryYearAsync(conn, currentEnd.AddDays(1));
        var (label, start) = await conn.QueryFirstAsync<(string, DateTime)>(
            "SELECT YearLabel, StartDate FROM rotary_year_master WHERE pk_year_id = @p", new { p });
        // an early cut-over leaves the global current year behind: the next year to plan opens after 1 July
        if (t.CutoverDone != null && t.PlanningYear == p)
            throw new InvalidOperationException($"{label} is already planned and live. Plan the following year after 1 July.");
        var fromRi = dgeMemberId == null;
        var dge = dgeMemberId ?? await conn.ExecuteScalarAsync<int?>(
            "SELECT fk_member_id FROM district_governors WHERE fk_district_id = @districtId AND fk_year_id = @p AND isdeleted = 0",
            new { districtId, p });
        if (dge is not int dgeId) throw new ArgumentException("Choose the governor-elect: RI holds none for this district and year.");
        if (!await IsDistrictMemberAsync(conn, dgeId, districtId))
            throw new ArgumentException("The governor-elect must be an active member of a club in this district.");
        var cutoverAt = TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(start.Date, DateTimeKind.Unspecified), Brand.TimeZone);

        int fromRiElects;
        await using (var tx = await conn.BeginTransactionAsync())
        {
            await conn.ExecuteAsync(@"
                UPDATE tenant_subscriptions SET state = 'planning', planning_year_id = @p, cutover_at = @cutoverAt,
                       cutover_done_at = NULL, modified_by = @by
                WHERE fk_district_id = @districtId AND fk_club_id = 0", new { districtId, p, cutoverAt, by }, tx);
            // roles of an earlier planning year are void, and there is one DGE
            await conn.ExecuteAsync(@"
                UPDATE planning_roles SET status = 'revoked', live = NULL, token_hash = NULL, modified_by = @by
                WHERE fk_district_id = @districtId AND live = 1 AND status IN ('invited', 'active')
                  AND (fk_year_id <> @p OR (fk_club_id = 0 AND role_code = 'DGE'))", new { districtId, p, by }, tx);
            await conn.ExecuteAsync(@"
                INSERT INTO planning_roles (fk_district_id, fk_club_id, fk_year_id, role_code, fk_member_id, status, source, created_by)
                VALUES (@districtId, 0, @p, 'DGE', @dgeId, 'active', @source, @by)",
                new { districtId, p, dgeId, source = fromRi ? "ri" : "signup", by }, tx);
            fromRiElects = await conn.ExecuteAsync(@"
                INSERT IGNORE INTO planning_roles (fk_district_id, fk_club_id, fk_year_id, role_code, fk_member_id, status, source, created_by)
                SELECT @districtId, bd.fk_club_id, @p, IF(ds.designation_name = 'Club President', 'PE', 'SE'),
                       bd.fk_member_master_profile_id, 'active', 'ri', @by
                FROM board_of_directors bd
                JOIN club_master c ON c.pk_club_id = bd.fk_club_id AND c.fk_district_id = @districtId AND c.isdeleted = 0
                JOIN designation_master ds ON ds.pk_designation_id = bd.fk_designation_id
                WHERE bd.fk_year_id = @p AND bd.isdeleted = 0 AND bd.SyncSource = 'Auto'
                  AND bd.fk_member_master_profile_id IS NOT NULL
                  AND ds.designation_name IN ('Club President', 'Club Secretary')", new { districtId, p, by }, tx);
            await tx.CommitAsync();
        }

        await _audit.LogAsync(by, "START", "planning", districtId, label,
            new { planningYearId = p, dgeMemberId = dgeId, dgeFromRi = fromRi, electsFromRi = fromRiElects, cutoverAt }, ctx);
        var number = await DistrictNumberAsync(conn, districtId);
        await NotifyAsync(conn, dgeId, L => (L["Plan {0} for District {1}", label, number],
            L["You can now plan Rotary year {0} for District {1} as governor-elect. Sign in to open the planning workspace.", Enc(label), Enc(number)],
            L["Open the planning workspace"]), Brand.PortalOrigin + "/planning");
        return new { districtId, planningYearId = p, planningYearLabel = label, cutoverAt, dgeMemberId = dgeId, electsFromRi = fromRiElects };
    }

    // ===== Team (the DGE or a SuperAdmin) =====

    /// <summary>The DGE appoints next year's district secretary (DS) or treasurer (DT): an active elect role at once.</summary>
    public async Task<object> AppointAsync(int districtId, string role, int memberId, int by, HttpContext ctx)
    {
        role = (role ?? "").Trim().ToUpperInvariant();
        if (role is not ("DS" or "DT")) throw new ArgumentException("Role must be DS (district secretary) or DT (district treasurer).");
        await using var conn = new MySqlConnection(_cs);
        await conn.OpenAsync();
        var p = await PlanningYearAsync(conn, districtId);
        if (!await IsDistrictMemberAsync(conn, memberId, districtId))
            throw new ArgumentException("Choose an active member of a club in this district.");
        int roleId;
        await using (var tx = await conn.BeginTransactionAsync())
        {
            await conn.ExecuteAsync(@"
                UPDATE planning_roles SET status = 'revoked', live = NULL, modified_by = @by
                WHERE fk_district_id = @districtId AND fk_club_id = 0 AND fk_year_id = @p AND role_code = @role AND live = 1",
                new { districtId, p, role, by }, tx);
            roleId = await conn.ExecuteScalarAsync<int>(@"
                INSERT INTO planning_roles (fk_district_id, fk_club_id, fk_year_id, role_code, fk_member_id, status, source, created_by)
                VALUES (@districtId, 0, @p, @role, @memberId, 'active', 'appointed', @by);
                SELECT LAST_INSERT_ID();", new { districtId, p, role, memberId, by }, tx);
            await tx.CommitAsync();
        }
        await _audit.LogAsync(by, "APPOINT", "planning", districtId, role, new { roleId, role, memberId, planningYearId = p }, ctx);
        var (label, number) = await LabelsAsync(conn, districtId, p);
        await NotifyAsync(conn, memberId, L => (L["You are {0} for {1}", L[RoleNames[role]], label],
            L["You have been appointed {0} of District {1} for Rotary year {2}. Sign in to plan the year.", L[RoleNames[role]], Enc(number), Enc(label)],
            L["Open the planning workspace"]), Brand.PortalOrigin + "/planning");
        return new { roleId };
    }

    /// <summary>The DGE invites a club's president-elect (PE) or secretary-elect (SE) by email: the role becomes
    /// active when the member opens the accept link (single use, 14 days). Inviting again replaces a pending invite.</summary>
    public async Task<object> InviteAsync(int districtId, int clubId, string role, int memberId, int by, HttpContext ctx)
    {
        role = (role ?? "").Trim().ToUpperInvariant();
        if (role is not ("PE" or "SE")) throw new ArgumentException("Role must be PE (president-elect) or SE (secretary-elect).");
        await using var conn = new MySqlConnection(_cs);
        await conn.OpenAsync();
        var p = await PlanningYearAsync(conn, districtId);
        var clubName = await conn.ExecuteScalarAsync<string?>(
            "SELECT ClubName FROM club_master WHERE pk_club_id = @clubId AND fk_district_id = @districtId AND isdeleted = 0", new { clubId, districtId })
            ?? throw new KeyNotFoundException("Club not found in this district.");
        var member = await conn.QueryFirstOrDefaultAsync<(int Id, string? Email)?>(@"
            SELECT m.pk_member_master_profile_id, m.EmailId FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            WHERE cm.fk_club_id = @clubId AND cm.fk_member_master_profile_id = @memberId AND cm.IsActive = 1 AND IFNULL(cm.isdeleted, 0) = 0
            LIMIT 1", new { clubId, memberId });
        if (member is not { } invitee) throw new ArgumentException("Choose an active member of this club.");
        if (string.IsNullOrWhiteSpace(invitee.Email)) throw new ArgumentException("This member has no email address in ROW. Add one first.");
        var live = await conn.ExecuteScalarAsync<string?>(@"
            SELECT status FROM planning_roles WHERE fk_district_id = @districtId AND fk_club_id = @clubId AND fk_year_id = @p
              AND role_code = @role AND live = 1", new { districtId, clubId, p, role });
        if (live == "active") throw new InvalidOperationException($"This club already has an active {RoleNames[role]}. Revoke that role first.");

        var token = Base64Url(RandomNumberGenerator.GetBytes(32));
        int roleId;
        await using (var tx = await conn.BeginTransactionAsync())
        {
            await conn.ExecuteAsync(@"
                UPDATE planning_roles SET status = 'revoked', live = NULL, token_hash = NULL, modified_by = @by
                WHERE fk_district_id = @districtId AND fk_club_id = @clubId AND fk_year_id = @p AND role_code = @role AND live = 1",
                new { districtId, clubId, p, role, by }, tx);
            roleId = await conn.ExecuteScalarAsync<int>(@"
                INSERT INTO planning_roles (fk_district_id, fk_club_id, fk_year_id, role_code, fk_member_id, status, source,
                                            token_hash, token_expires, created_by)
                VALUES (@districtId, @clubId, @p, @role, @memberId, 'invited', 'invite', @hash,
                        UTC_TIMESTAMP() + INTERVAL @days DAY, @by);
                SELECT LAST_INSERT_ID();", new { districtId, clubId, p, role, memberId, hash = Sha256Hex(token), days = InviteDays, by }, tx);
            await tx.CommitAsync();
        }
        var (label, number) = await LabelsAsync(conn, districtId, p);
        await NotifyAsync(conn, memberId, L => (L["Plan {0} for {1}", label, clubName],
            L["District {0} invites you to plan Rotary year {1} for {2} as {3}.", Enc(number), Enc(label), Enc(clubName), L[RoleNames[role]]] + " " +
            L["The link works once, for {0} days. After accepting, sign in to the admin (use Forgot password if you have no password yet).", InviteDays],
            L["Accept the invitation"]), Brand.PortalOrigin + "/planning/accept/" + token);
        await conn.ExecuteAsync("UPDATE planning_roles SET email_sent_at = UTC_TIMESTAMP() WHERE pk_planning_role_id = @roleId", new { roleId });
        await _audit.LogAsync(by, "INVITE", "planning", districtId, role, new { roleId, clubId, role, memberId, planningYearId = p }, ctx);
        return new { roleId };
    }

    /// <summary>Accepts an invitation from its link (no sign-in: the token proves the email; the role is the
    /// invited member's, whoever opens the link). Answers only what the page shows.</summary>
    public async Task<object> AcceptAsync(string token, HttpContext ctx)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Length > 100) throw new KeyNotFoundException("This invitation link is not valid.");
        await using var conn = new MySqlConnection(_cs);
        await conn.OpenAsync();
        var r = await conn.QueryFirstOrDefaultAsync<InviteRow>(@"
            SELECT pr.pk_planning_role_id AS Id, pr.status AS Status, pr.token_expires AS Expires, pr.fk_member_id AS MemberId,
                   pr.role_code AS Role, pr.fk_district_id AS DistrictId, ts.state AS State, ts.planning_year_id AS PlanningYear,
                   pr.fk_year_id AS YearId
            FROM planning_roles pr
            LEFT JOIN tenant_subscriptions ts ON ts.fk_district_id = pr.fk_district_id AND ts.fk_club_id = 0
            WHERE pr.token_hash = @hash AND pr.live = 1", new { hash = Sha256Hex(token) })
            ?? throw new KeyNotFoundException("This invitation link is not valid or was already used.");
        if (r.Status != "invited") throw new InvalidOperationException("This invitation was already accepted.");
        if (r.Expires < DateTime.UtcNow) throw new InvalidOperationException("This invitation has expired. Ask your governor-elect to send it again.");
        if (r.State != "planning" || r.PlanningYear != r.YearId) throw new InvalidOperationException("This district is no longer planning that year.");
        await conn.ExecuteAsync(@"
            UPDATE planning_roles SET status = 'active', accepted_at = UTC_TIMESTAMP(), token_hash = NULL, token_expires = NULL
            WHERE pk_planning_role_id = @Id AND status = 'invited'", new { r.Id });
        await _audit.LogAsync(r.MemberId, "ACCEPT", "planning", r.DistrictId, r.Role, new { roleId = r.Id }, ctx);
        var role = await conn.QueryFirstAsync<PlanningRoleDto>(RoleSelect + " WHERE pr.pk_planning_role_id = @Id", new { r.Id });
        return new { role.Role, role.Status, role.ClubName, role.DistrictNumber, role.YearLabel };
    }

    /// <summary>Revokes a live elect role. Only a SuperAdmin replaces the DGE (by starting planning again).</summary>
    public async Task RevokeAsync(int districtId, int roleId, int by, bool superAdmin, HttpContext ctx)
    {
        await using var conn = new MySqlConnection(_cs);
        var row = await conn.QueryFirstOrDefaultAsync<(string Role, string Status)?>(
            "SELECT role_code, status FROM planning_roles WHERE pk_planning_role_id = @roleId AND fk_district_id = @districtId AND live = 1",
            new { roleId, districtId });
        if (row is not { } r) throw new KeyNotFoundException("Role not found in this district.");
        if (r.Role == "DGE" && !superAdmin) throw new UnauthorizedAccessException("Only a SuperAdmin can change the governor-elect.");
        if (r.Status == "activated") throw new InvalidOperationException("This role became a current role at cut-over: change it in member roles.");
        await conn.ExecuteAsync(@"
            UPDATE planning_roles SET status = 'revoked', live = NULL, token_hash = NULL, modified_by = @by
            WHERE pk_planning_role_id = @roleId", new { roleId, by });
        await _audit.LogAsync(by, "REVOKE", "planning", districtId, r.Role, new { roleId }, ctx);
    }

    // ===== Cut-over =====

    /// <summary>Flips a planning district live: the outgoing year is archived (read-only), active elect roles become
    /// current roles (DGE, DS, DT: district Admin; PE, SE: club Admin), pending invitations lapse, dues collection
    /// opens (it follows the state), and the RI steps are queued: next-year officer pushes (RI's six titles),
    /// primary vendor for every club that authorised ROW, one reconciliation. by = 0 for the scheduled run.</summary>
    public async Task<object> CutOverAsync(int districtId, int by, HttpContext? ctx)
    {
        await using var conn = new MySqlConnection(_cs);
        await conn.OpenAsync();
        var tenant = await conn.QueryFirstOrDefaultAsync<(string State, int? PlanningYear)?>(
            "SELECT state, planning_year_id FROM tenant_subscriptions WHERE fk_district_id = @districtId AND fk_club_id = 0", new { districtId });
        if (tenant is not { } t) throw new KeyNotFoundException("This district has no subscription.");
        if (t.State != "planning") throw new InvalidOperationException("This district is not planning: there is nothing to cut over.");
        var p = t.PlanningYear ?? await NextYearAsync(conn) ?? throw new InvalidOperationException("The year being planned is not set.");
        var outgoing = await PlanningAccess.YearBeforeAsync(conn, p);

        int rolesActivated, officers, vendor;
        await using (var tx = await conn.BeginTransactionAsync())
        {
            // the row lock makes a second cut-over (the job and a DGE at once) wait, then find the district live
            var state = await conn.ExecuteScalarAsync<string>(
                "SELECT state FROM tenant_subscriptions WHERE fk_district_id = @districtId AND fk_club_id = 0 FOR UPDATE", new { districtId }, tx);
            if (state != "planning") throw new InvalidOperationException("This district is not planning: there is nothing to cut over.");
            await conn.ExecuteAsync(@"
                UPDATE tenant_subscriptions SET state = 'live', cutover_done_at = UTC_TIMESTAMP(), archived_year_id = @outgoing,
                       planning_year_id = @p, modified_by = @by
                WHERE fk_district_id = @districtId AND fk_club_id = 0", new { districtId, outgoing, p, by }, tx);

            var active = (await conn.QueryAsync<(int Member, int Club)>(
                "SELECT fk_member_id, fk_club_id FROM planning_roles WHERE fk_district_id = @districtId AND fk_year_id = @p AND status = 'active'",
                new { districtId, p }, tx)).ToList();
            foreach (var (member, club) in active)
            {
                if (club > 0)
                {
                    await ClubAdminAccessHelper.EnsureActiveClubAdminRoleAsync(conn, member, club, by, tx);
                    continue;
                }
                var has = await conn.ExecuteScalarAsync<int>(@"
                    SELECT COUNT(*) FROM member_roles WHERE fk_member_master_profile_id = @member AND fk_role_id = 2
                      AND fk_district_id = @districtId AND (fk_club_id IS NULL OR fk_club_id = 0) AND IsActive = 1 AND isdeleted = 0",
                    new { member, districtId }, tx);
                if (has == 0)
                    await conn.ExecuteAsync(@"
                        INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, fk_district_id, fk_club_id, AllClubsAccess,
                                                  IsActive, isdeleted, AssignedBy, created_by, created_date)
                        VALUES (@member, 2, @districtId, NULL, 0, 1, 0, @by, @by, NOW())", new { member, districtId, by }, tx);
            }
            rolesActivated = active.Count;
            await conn.ExecuteAsync(@"
                UPDATE planning_roles SET status = 'activated', activated_at = UTC_TIMESTAMP()
                WHERE fk_district_id = @districtId AND fk_year_id = @p AND status = 'active'", new { districtId, p }, tx);
            await conn.ExecuteAsync(@"
                UPDATE planning_roles SET status = 'revoked', live = NULL, token_hash = NULL
                WHERE fk_district_id = @districtId AND status = 'invited'", new { districtId }, tx);

            // RI steps (stub): queued for the RI outbound path, nothing sends them yet
            officers = await conn.ExecuteAsync($@"
                INSERT IGNORE INTO ri_outbound_queue (kind, fk_district_id, fk_club_id, fk_year_id, ref_id, fk_member_id, ri_title, created_by)
                SELECT 'officer', @districtId, bd.fk_club_id, @p, bd.pk_board_director_id, bd.fk_member_master_profile_id, {RiTitleSql}, @by
                FROM board_of_directors bd
                JOIN club_master c ON c.pk_club_id = bd.fk_club_id AND c.fk_district_id = @districtId AND c.isdeleted = 0
                JOIN designation_master ds ON ds.pk_designation_id = bd.fk_designation_id
                WHERE bd.fk_year_id = @p AND bd.isdeleted = 0 AND ({RiTitleSql}) IS NOT NULL", new { districtId, p, by }, tx);
            vendor = await conn.ExecuteAsync(@"
                INSERT IGNORE INTO ri_outbound_queue (kind, fk_district_id, fk_club_id, fk_year_id, created_by)
                SELECT 'primary_vendor', @districtId, c.pk_club_id, @p, @by FROM club_master c
                WHERE c.fk_district_id = @districtId AND c.isdeleted = 0 AND c.ROW_as_vendor_selected = 1", new { districtId, p, by }, tx);
            await conn.ExecuteAsync(@"
                INSERT IGNORE INTO ri_outbound_queue (kind, fk_district_id, fk_club_id, fk_year_id, created_by)
                VALUES ('reconciliation', @districtId, 0, @p, @by)", new { districtId, p, by }, tx);
            await tx.CommitAsync();
        }
        var result = new { districtId, state = "live", planningYearId = p, archivedYearId = outgoing, rolesActivated, officersQueued = officers, primaryVendorQueued = vendor };
        await _audit.LogAsync(by, "CUTOVER", "planning", districtId, by == 0 ? "scheduled" : "manual", result, ctx);
        return result;
    }

    /// <summary>Planning districts whose scheduled cut-over time has passed (the job runs them).</summary>
    public async Task<List<int>> DueCutoversAsync()
    {
        await using var conn = new MySqlConnection(_cs);
        return (await conn.QueryAsync<int>(@"
            SELECT fk_district_id FROM tenant_subscriptions
            WHERE fk_club_id = 0 AND state = 'planning' AND cutover_at IS NOT NULL AND cutover_at <= UTC_TIMESTAMP()")).ToList();
    }

    // ===== Helpers =====

    internal sealed class InviteRow
    {
        public int Id { get; set; }
        public string Status { get; set; } = "";
        public DateTime? Expires { get; set; }
        public int MemberId { get; set; }
        public string Role { get; set; } = "";
        public int DistrictId { get; set; }
        public string? State { get; set; }
        public int? PlanningYear { get; set; }
        public int YearId { get; set; }
    }

    /// <summary>The year a planning district plans; 409 when the district is not planning.</summary>
    private static async Task<int> PlanningYearAsync(MySqlConnection conn, int districtId) =>
        await conn.ExecuteScalarAsync<int?>(@"
            SELECT planning_year_id FROM tenant_subscriptions
            WHERE fk_district_id = @districtId AND fk_club_id = 0 AND state = 'planning'", new { districtId })
        ?? throw new InvalidOperationException("This district is not planning.");

    private static Task<int?> NextYearAsync(MySqlConnection conn) =>
        conn.ExecuteScalarAsync<int?>(@"
            SELECT y.pk_year_id FROM rotary_year_master y
            WHERE y.isdeleted = 0 AND y.StartDate > (SELECT StartDate FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1)
            ORDER BY y.StartDate LIMIT 1");

    private static async Task<bool> IsDistrictMemberAsync(MySqlConnection conn, int memberId, int districtId) =>
        await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM club_members cm
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.fk_district_id = @districtId AND c.isdeleted = 0
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            WHERE cm.fk_member_master_profile_id = @memberId AND cm.IsActive = 1 AND IFNULL(cm.isdeleted, 0) = 0",
            new { memberId, districtId }) > 0;

    private static async Task<string> DistrictNumberAsync(MySqlConnection conn, int districtId) =>
        await conn.ExecuteScalarAsync<string?>("SELECT DistrictNumber FROM district_master WHERE pk_district_id = @districtId", new { districtId }) ?? "";

    private static async Task<(string Label, string Number)> LabelsAsync(MySqlConnection conn, int districtId, int yearId) =>
        (await conn.ExecuteScalarAsync<string?>("SELECT YearLabel FROM rotary_year_master WHERE pk_year_id = @yearId", new { yearId }) ?? "",
         await DistrictNumberAsync(conn, districtId));

    /// <summary>Emails a member (best effort: the send is logged in email_log and never fails the request).
    /// <paramref name="text"/> builds the subject, the intro (HTML whose dynamic parts are already encoded) and the
    /// link text inside the member's language (S5).</summary>
    private async Task NotifyAsync(MySqlConnection conn, int memberId,
        Func<IStringLocalizer, (string Subject, string IntroHtml, string LinkText)> text, string link)
    {
        var m = await conn.QueryFirstOrDefaultAsync<(string? Name, string? Email)?>(
            "SELECT MemberName, EmailId FROM member_master_profile WHERE pk_member_master_profile_id = @memberId AND isdeleted = 0", new { memberId });
        if (m is not { Email: { Length: > 0 } email } who) return;
        using var culture = MessageCulture.Use(await MessageCulture.ForMemberAsync(conn, memberId));
        var L = DbStringLocalizer.Instance;
        var (subject, introHtml, linkText) = text(L);
        var html = $@"<div style=""font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f2937;line-height:1.6;max-width:640px"">
            <p>{L["Dear {0},", Enc(who.Name ?? "")]}</p><p>{introHtml}</p>
            <p><a href=""{Enc(link)}"">{Enc(linkText)}</a></p>
            <p style=""color:#6b7280;font-size:13px"">{Enc(Brand.ProductName)}</p></div>";
        await _email.SendGenericEmailAsync(email, $"{Brand.ProductName}: {subject}", html);
    }

    private static string Enc(string s) => WebUtility.HtmlEncode(s);

    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static string Sha256Hex(string s) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(s))).ToLowerInvariant();
}
