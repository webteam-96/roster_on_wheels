using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;

namespace RotaryApi.Controllers;

// Resolves the dashboard landing route for the authenticated user AND lists every
// dashboard they can switch to from the sidebar.
//
// Roles in member_roles (fk_role_id):
//   2 = Admin (Club Admin if fk_club_id > 0, District Admin if fk_district_id > 0)
//   3 = SuperAdmin
//   4 = ZonalCoordinator
//   6 = AG
//   7 = RIDirector
//
// Default-landing priority (2026-08-14; DA/CA moved to the top 2026-09-25). The member always lands on a REAL dashboard
// (never a tile-picker) and switches roles from the sidebar switcher. SuperAdmin is
// LAST so a SuperAdmin who is ALSO District/Club Admin lands on their operational
// dashboard; the SuperAdmin portal (Global Search) is reached via the switcher.
// SuperAdmin is the landing only when it is the member's sole role.
//   1) District Admin        -> "/district-admin-dashboard"
//   2) Club Admin            -> "/club-admin-dashboard"
//   3) RIDirector            -> "/ri-director/v2"
//   4) ZonalCoordinator      -> "/zonal-dashboard"
//   5) AG                    -> "/ag-dashboard"
//   6) Club Moderator        -> "/club-moderator/v2"
//   7) SuperAdmin            -> "/settings/global-search"  (only if sole role)
//   8) Member / fallback     -> "/"
//
// The sidebar "Switch dashboard" picker lists EVERY entry the user is authorised
// for — not just the landing — so a member with AG + Club Admin + Club Moderator
// lands on AG and the picker offers AG / Club Admin / Club Moderator.
[ApiController]
[Authorize]
public class DashboardResolverController : ControllerBase
{
    private readonly string _connectionString;

    public DashboardResolverController(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int GetMemberId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    private string GetRolesClaim() => User.FindFirst("roles")?.Value ?? "";

    private MySqlConnection CreateConnection() => new(_connectionString);

    public class DashboardEntry
    {
        public string Kind { get; set; } = "";   // "ag" | "district-admin" | "club-admin" | etc.
        public string Route { get; set; } = "";
        public string Label { get; set; } = "";
        // ── Scope fields (additive — null for global-scope kinds like SuperAdmin / RID) ──
        // A user who is Club Admin of 3 clubs gets 3 separate entries — each
        // populated with that club's ClubId/ClubName (plus its DistrictId/DistrictNumber).
        // A user who is District Admin of 2 districts gets 2 entries with DistrictId/Number.
        // A user who is AG at 2 clubs gets 2 entries with ClubId/ClubName.
        // A user who is ZonalCoordinator of 1 zone gets 1 entry with ZoneId/ZoneName.
        public int? ClubId { get; set; }
        public string? ClubName { get; set; }
        public int? DistrictId { get; set; }
        public string? DistrictNumber { get; set; }
        public int? ZoneId { get; set; }
        public string? ZoneName { get; set; }
    }

    public class LandingRouteResponse
    {
        public string Route { get; set; } = "/";
        public string Reason { get; set; } = "fallback";
        // Every dashboard the user can navigate to. Frontend renders these in
        // the sidebar "Switch dashboard" picker. Multi-club / multi-district
        // members get one entry per assignment.
        public List<DashboardEntry> Available { get; set; } = new();
    }

    // Web — includes the Goal Setting oversight roles (web-only for now).
    [HttpGet("api/dashboard/resolve-landing")]
    public Task<ActionResult<LandingRouteResponse>> Resolve() => ResolveCoreAsync(includeGoal: true);

    // Mobile parity twin — Flutter app uses the same logic to route after login. Goal Setting
    // oversight has no mobile screen yet, so its entries are omitted here.
    [HttpGet("api/mobile/dashboard/resolve-landing")]
    public Task<ActionResult<LandingRouteResponse>> ResolveMobile() => ResolveCoreAsync(includeGoal: false);

    private async Task<ActionResult<LandingRouteResponse>> ResolveCoreAsync(bool includeGoal)
    {
        var memberId = GetMemberId();
        if (memberId <= 0)
            return Ok(new LandingRouteResponse { Route = "/", Reason = "no-member-id" });

        var roles = GetRolesClaim();
        var available = new List<DashboardEntry>();

        // Populate the switcher list — every role/scope the member holds (incl. SuperAdmin, ZC,
        // RID, and one entry per admin club/district). The frontend renders these in the sidebar
        // "Switch dashboard" dropdown.
        await AddRoleBasedEntriesAsync(memberId, roles, available, includeGoal);

        if (available.Count == 0)
            return Ok(new LandingRouteResponse { Route = "/", Reason = "member-fallback", Available = available });

        // Default-landing rule (2026-08-14): the member lands DIRECTLY on a real dashboard (never a
        // tile-picker page) and switches roles from the sidebar switcher. When they hold several
        // roles we pick the highest-priority OPERATIONAL dashboard below. SuperAdmin is deliberately
        // LAST — a member who is SuperAdmin AND (District/Club Admin/…) lands on their operational
        // dashboard and reaches the SuperAdmin portal (Global Search) only via the switcher.
        // SuperAdmin is the landing ONLY when it's the member's sole role.
        // 2026-09-25: District Admin and Club Admin come FIRST — a member who also holds RI Director /
        // ZC / AG lands on their District (or Club) Admin dashboard and switches to the rest.
        //   District Admin > Club Admin > RI Director > Zonal Coordinator > AG > Club Moderator > SuperAdmin
        // Mobile keeps the OLD order (RID > ZC > DA > AG > CA) until the mobile side is decided
        // (user, 2026-09-25: "keep mobile old order till Monday"). includeGoal is false only for mobile.
        var isMobile = !includeGoal;
        var landing = (isMobile
            ? available.FirstOrDefault(e => e.Kind == "ri-director")
              ?? available.FirstOrDefault(e => e.Kind == "zonal-coordinator")
              ?? available.FirstOrDefault(e => e.Kind == "district-admin")
              ?? available.FirstOrDefault(e => e.Kind == "ag")
              ?? available.FirstOrDefault(e => e.Kind == "club-admin")
            : available.FirstOrDefault(e => e.Kind == "district-admin")
              ?? available.FirstOrDefault(e => e.Kind == "club-admin")
              ?? available.FirstOrDefault(e => e.Kind == "ri-director")
              ?? available.FirstOrDefault(e => e.Kind == "zonal-coordinator")
              ?? available.FirstOrDefault(e => e.Kind == "ag"))
            ?? available.FirstOrDefault(e => e.Kind == "club-moderator")
            // Goal Setting oversight ranks just above SuperAdmin: a member whose only "operational"
            // role is a goal oversight role lands there; SuperAdmin (portal) stays the last resort.
            ?? available.FirstOrDefault(e => e.Kind == "goal-oversight")
            ?? available.FirstOrDefault(e => e.Kind == "super-admin")
            ?? available[0];

        var reason = available.Count > 1 ? $"multi-role-default:{landing.Kind}" : landing.Kind;
        return Ok(new LandingRouteResponse { Route = landing.Route, Reason = reason, Available = available });
    }

    // Queries member_roles row-by-row and emits one DashboardEntry per (role × scope)
    // assignment. A user who is Club Admin at 3 clubs → 3 entries. District Admin
    // at 2 districts → 2 entries. AG at 1 club + Club Mod at 1 club → 2 entries.
    //
    // Each entry carries the scope IDs/names the frontend needs to route the user
    // straight into that specific club's / district's dashboard.
    //
    // Global roles (SuperAdmin / RIDirector / ZonalCoordinator zone-scope) come
    // from the JWT roles claim — no per-row breakdown needed for landing, but ZC
    // still gets its ZoneId populated from member_roles.
    //
    // Ordering inside `available` is landing-priority (DA, AG, CA, ClubModerator)
    // so the resolver's `FirstOrDefault(...)` lookups still pick the right landing.
    private async Task AddRoleBasedEntriesAsync(int memberId, string rolesClaim, List<DashboardEntry> available, bool includeGoal)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // SuperAdmin — global, web-only role (lands on the global search). Added FIRST so it heads
        // the multi-role picker. A member can now be SuperAdmin AND other roles at once (2026-08-14).
        if (rolesClaim.Contains("SuperAdmin"))
            available.Add(new DashboardEntry { Kind = "super-admin", Route = "/settings/global-search", Label = "Super Admin" });

        // District Admin rows — one entry per district.
        // A proper DA row has fk_role_id=2 + fk_district_id (set) + fk_club_id NULL.
        // The fk_club_id IS NULL filter is critical: Club Admin shares role_id=2
        // but its row has fk_club_id set, not fk_district_id. Without this filter
        // a multi-role user (CA + AG) with a stale or malformed row could land on
        // the DA dashboard incorrectly.
        var districtAdmins = await connection.QueryAsync<dynamic>(@"
            SELECT mr.fk_district_id AS districtId,
                   d.DistrictNumber AS districtNumber,
                   d.fk_zone_id AS zoneId,
                   z.ZoneName AS zoneName
            FROM member_roles mr
            JOIN district_master d ON d.pk_district_id = mr.fk_district_id
            LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE mr.fk_member_master_profile_id = @MemberId
              AND mr.fk_role_id = 2
              AND mr.fk_district_id IS NOT NULL AND mr.fk_district_id > 0
              AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0)
              AND mr.IsActive = 1 AND mr.isdeleted = 0
              AND d.isdeleted = 0
            ORDER BY CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber",
            new { MemberId = memberId });
        foreach (var row in districtAdmins)
        {
            available.Add(new DashboardEntry
            {
                Kind = "district-admin",
                Route = "/district-admin-dashboard",
                Label = "District Admin",
                DistrictId = row.districtId == null ? null : (int?)row.districtId,
                DistrictNumber = (string?)row.districtNumber,
                ZoneId = row.zoneId == null ? null : (int?)row.zoneId,
                ZoneName = (string?)row.zoneName
            });
        }

        // AG rows — one entry per district (AG is district-scoped per member_roles convention).
        var agRows = await connection.QueryAsync<dynamic>(@"
            SELECT mr.fk_district_id AS districtId,
                   d.DistrictNumber AS districtNumber,
                   d.fk_zone_id AS zoneId,
                   z.ZoneName AS zoneName
            FROM member_roles mr
            LEFT JOIN district_master d ON d.pk_district_id = mr.fk_district_id
            LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE mr.fk_member_master_profile_id = @MemberId
              AND mr.fk_role_id = 6
              AND mr.IsActive = 1 AND mr.isdeleted = 0
              AND (d.isdeleted IS NULL OR d.isdeleted = 0)
            ORDER BY CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber",
            new { MemberId = memberId });
        foreach (var row in agRows)
        {
            available.Add(new DashboardEntry
            {
                Kind = "ag",
                Route = "/ag-dashboard",
                Label = "AG Dashboard",
                DistrictId = row.districtId == null ? null : (int?)row.districtId,
                DistrictNumber = (string?)row.districtNumber,
                ZoneId = row.zoneId == null ? null : (int?)row.zoneId,
                ZoneName = (string?)row.zoneName
            });
        }

        // Club Admin rows — one entry per club.
        var clubAdmins = await connection.QueryAsync<dynamic>(@"
            SELECT mr.fk_club_id AS clubId,
                   c.ClubName AS clubName,
                   c.fk_district_id AS districtId,
                   d.DistrictNumber AS districtNumber,
                   d.fk_zone_id AS zoneId,
                   z.ZoneName AS zoneName
            FROM member_roles mr
            JOIN club_master c ON c.pk_club_id = mr.fk_club_id
            LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
            LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE mr.fk_member_master_profile_id = @MemberId
              AND mr.fk_role_id = 2
              AND mr.fk_club_id IS NOT NULL AND mr.fk_club_id > 0
              AND mr.IsActive = 1 AND mr.isdeleted = 0
              AND c.isdeleted = 0
            ORDER BY c.ClubName",
            new { MemberId = memberId });
        foreach (var row in clubAdmins)
        {
            available.Add(new DashboardEntry
            {
                Kind = "club-admin",
                Route = "/club-admin-dashboard",
                Label = "Club Admin",
                ClubId = row.clubId == null ? null : (int?)row.clubId,
                ClubName = (string?)row.clubName,
                DistrictId = row.districtId == null ? null : (int?)row.districtId,
                DistrictNumber = (string?)row.districtNumber,
                ZoneId = row.zoneId == null ? null : (int?)row.zoneId,
                ZoneName = (string?)row.zoneName
            });
        }

        // Club Moderator rows — one entry per club (role id 5, club-scoped).
        if (rolesClaim.Contains("ClubModerator"))
        {
            var clubMods = await connection.QueryAsync<dynamic>(@"
                SELECT mr.fk_club_id AS clubId,
                       c.ClubName AS clubName,
                       c.fk_district_id AS districtId,
                       d.DistrictNumber AS districtNumber,
                       d.fk_zone_id AS zoneId,
                       z.ZoneName AS zoneName
                FROM member_roles mr
                JOIN roles r ON r.pk_role_id = mr.fk_role_id
                LEFT JOIN club_master c ON c.pk_club_id = mr.fk_club_id
                LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
                LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
                WHERE mr.fk_member_master_profile_id = @MemberId
                  AND r.RoleName = 'ClubModerator'
                  AND mr.IsActive = 1 AND mr.isdeleted = 0
                  AND (c.isdeleted IS NULL OR c.isdeleted = 0)
                ORDER BY c.ClubName",
                new { MemberId = memberId });
            var any = false;
            foreach (var row in clubMods)
            {
                any = true;
                available.Add(new DashboardEntry
                {
                    Kind = "club-moderator",
                    Route = "/club-moderator/v2",
                    Label = "Club Moderator",
                    ClubId = row.clubId == null ? null : (int?)row.clubId,
                    ClubName = (string?)row.clubName,
                    DistrictId = row.districtId == null ? null : (int?)row.districtId,
                    DistrictNumber = (string?)row.districtNumber,
                    ZoneId = row.zoneId == null ? null : (int?)row.zoneId,
                    ZoneName = (string?)row.zoneName
                });
            }
            // Defensive fallback: claim says ClubModerator but no rows resolved
            // (shouldn't happen — JWT claim is built from member_roles — but keep
            // the dashboard reachable rather than disappearing it).
            if (!any)
                available.Add(new DashboardEntry { Kind = "club-moderator", Route = "/club-moderator/v2", Label = "Club Moderator" });
        }

        // ZonalCoordinator rows — one entry per zone (typically just one).
        if (rolesClaim.Contains("ZonalCoordinator"))
        {
            var zcRows = await connection.QueryAsync<dynamic>(@"
                SELECT mr.fk_zone_id AS zoneId, z.ZoneName AS zoneName
                FROM member_roles mr
                JOIN roles r ON r.pk_role_id = mr.fk_role_id
                LEFT JOIN zone_master z ON z.pk_zone_id = mr.fk_zone_id
                WHERE mr.fk_member_master_profile_id = @MemberId
                  AND r.RoleName = 'ZonalCoordinator'
                  AND mr.IsActive = 1 AND mr.isdeleted = 0
                ORDER BY z.ZoneName",
                new { MemberId = memberId });
            var any = false;
            foreach (var row in zcRows)
            {
                any = true;
                available.Add(new DashboardEntry
                {
                    Kind = "zonal-coordinator",
                    Route = "/zonal-dashboard",
                    Label = "Zonal Dashboard",
                    ZoneId = row.zoneId == null ? null : (int?)row.zoneId,
                    ZoneName = (string?)row.zoneName
                });
            }
            if (!any)
                available.Add(new DashboardEntry { Kind = "zonal-coordinator", Route = "/zonal-dashboard", Label = "Zonal Dashboard" });
        }

        // RIDirector — global, no per-row breakdown.
        if (rolesClaim.Contains("RIDirector"))
            available.Add(new DashboardEntry { Kind = "ri-director", Route = "/ri-director/v2", Label = "RI Director" });

        // Goal Setting oversight roles (RI Director / Zone Co-ordinator / District Assistant) — these
        // live in goal_role_assignments, NOT member_roles, so they're separate from the role7 "RI
        // Director" above and from the Goal Setting *module* in the admin sidebars. One switcher entry
        // per distinct goal role the member holds, labelled "Goal Setting - <role>". Web only.
        if (includeGoal)
        {
            var goalRoleTypes = (await connection.QueryAsync<string>(@"
                SELECT DISTINCT RoleType FROM goal_role_assignments
                WHERE fk_member_id = @MemberId AND fk_member_id > 0 AND IsActive = 1 AND isdeleted = 0",
                new { MemberId = memberId })).ToList();

            // Show the highest role only if they somehow hold several — but per spec show each distinct
            // role. Order: RI Director, Zone Co-ordinator, District Assistant.
            string? GoalLabel(string rt) => rt switch
            {
                "AllCategoryAllDistrictsFewZones" => "RI Director",
                "AllDistrictsOneCategoryOneZone" => "Zone Co-ordinator",
                "FewDistrictsOneCategoryOneZone" => "District Assistant",
                _ => null,
            };
            string? GoalAs(string rt) => rt switch
            {
                "AllCategoryAllDistrictsFewZones" => "ri-director",
                "AllDistrictsOneCategoryOneZone" => "zone-coordinator",
                "FewDistrictsOneCategoryOneZone" => "district-assistant",
                _ => null,
            };
            var order = new[] { "AllCategoryAllDistrictsFewZones", "AllDistrictsOneCategoryOneZone", "FewDistrictsOneCategoryOneZone" };
            foreach (var rt in order.Where(goalRoleTypes.Contains))
            {
                var label = GoalLabel(rt);
                if (label == null) continue;
                available.Add(new DashboardEntry
                {
                    Kind = "goal-oversight",
                    // The ?as= tells the dashboard which role to act as, so a multi-role person gets a
                    // separate scoped view per switcher entry (RI Director vs ZC vs DA).
                    Route = $"/goal-overviews?as={GoalAs(rt)}",
                    Label = $"Goal Setting - {label}",
                });
            }

            // A SuperAdmin gets the plain "Goal Setting" switcher entry → the read-only oversight dashboard
            // across ALL zones (same flow as ?as=ri-director, but unscoped) — ONLY when their per-SuperAdmin
            // "Goal Setting enabled" flag is on (goal_oversight_access, toggled on settings/super-admin-role-config;
            // default OFF). A SuperAdmin who ALSO holds a real goal role gets that role-scoped tile instead
            // (the !Any(goal-oversight) guard).
            if (!available.Any(e => e.Kind == "goal-oversight") && rolesClaim.Contains("SuperAdmin"))
            {
                var goalEnabled = await connection.ExecuteScalarAsync<int?>(
                    "SELECT IsEnabled FROM goal_oversight_access WHERE fk_member_id = @Id", new { Id = memberId });
                if (goalEnabled == 1)
                    available.Add(new DashboardEntry
                    {
                        Kind = "goal-oversight",
                        Route = "/goal-overviews",
                        Label = "Goal Overview",
                    });
            }
        }
    }
}
