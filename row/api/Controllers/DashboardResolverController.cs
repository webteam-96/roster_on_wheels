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
//   6 = AG
//
// Default-landing priority (2026-08-14; DA/CA moved to the top 2026-09-25). The member always lands on a REAL dashboard
// (never a tile-picker) and switches roles from the sidebar switcher. SuperAdmin is
// LAST so a SuperAdmin who is ALSO District/Club Admin lands on their operational
// dashboard; the SuperAdmin portal (Global Search) is reached via the switcher.
// SuperAdmin is the landing only when it is the member's sole role.
//   1) District Admin        -> "/district-admin-dashboard"
//   2) Club Admin            -> "/club-admin-dashboard"
//   3) AG                    -> "/ag-dashboard"
//   4) SuperAdmin            -> "/settings/global-search"  (only if sole role)
//   5) Member / fallback     -> "/"
//
// The sidebar "Switch dashboard" picker lists EVERY entry the user is authorised
// for — not just the landing — so a member with AG + Club Admin
// lands on AG and the picker offers AG / Club Admin.
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
        // ── Scope fields (additive — null for global-scope kinds like SuperAdmin) ──
        // A user who is Club Admin of 3 clubs gets 3 separate entries — each
        // populated with that club's ClubId/ClubName (plus its DistrictId/DistrictNumber).
        // A user who is District Admin of 2 districts gets 2 entries with DistrictId/Number.
        // A user who is AG at 2 clubs gets 2 entries with ClubId/ClubName.
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

    // Web — includes the SuperAdmin "Goal Overview" entry (web only).
    [HttpGet("api/dashboard/resolve-landing")]
    public Task<ActionResult<LandingRouteResponse>> Resolve() => ResolveCoreAsync(includeGoal: true);

    // Mobile parity twin — Flutter app uses the same logic to route after login. The Goal Overview
    // has no mobile screen, so its entry is omitted here.
    [HttpGet("api/mobile/dashboard/resolve-landing")]
    public Task<ActionResult<LandingRouteResponse>> ResolveMobile() => ResolveCoreAsync(includeGoal: false);

    private async Task<ActionResult<LandingRouteResponse>> ResolveCoreAsync(bool includeGoal)
    {
        var memberId = GetMemberId();
        if (memberId <= 0)
            return Ok(new LandingRouteResponse { Route = "/", Reason = "no-member-id" });

        var roles = GetRolesClaim();
        var available = new List<DashboardEntry>();

        // Populate the switcher list — every role/scope the member holds (incl. SuperAdmin,
        // and one entry per admin club/district). The frontend renders these in the sidebar
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
        // 2026-09-25: District Admin and Club Admin come FIRST — a member who also holds
        // AG lands on their District (or Club) Admin dashboard and switches to the rest.
        //   District Admin > Club Admin > AG > SuperAdmin
        // Mobile keeps the OLD order (DA > AG > CA) until the mobile side is decided
        // (user, 2026-09-25: "keep mobile old order till Monday"). includeGoal is false only for mobile.
        var isMobile = !includeGoal;
        var landing = (isMobile
            ? available.FirstOrDefault(e => e.Kind == "district-admin")
              ?? available.FirstOrDefault(e => e.Kind == "ag")
              ?? available.FirstOrDefault(e => e.Kind == "club-admin")
            : available.FirstOrDefault(e => e.Kind == "district-admin")
              ?? available.FirstOrDefault(e => e.Kind == "club-admin")
              ?? available.FirstOrDefault(e => e.Kind == "ag"))
            ?? available.FirstOrDefault(e => e.Kind == "super-admin")
            ?? available[0];

        var reason = available.Count > 1 ? $"multi-role-default:{landing.Kind}" : landing.Kind;
        return Ok(new LandingRouteResponse { Route = landing.Route, Reason = reason, Available = available });
    }

    // Queries member_roles row-by-row and emits one DashboardEntry per (role × scope)
    // assignment. A user who is Club Admin at 3 clubs → 3 entries. District Admin
    // at 2 districts → 2 entries. AG at 2 clubs → 2 entries.
    //
    // Each entry carries the scope IDs/names the frontend needs to route the user
    // straight into that specific club's / district's dashboard.
    //
    // Global roles (SuperAdmin) come from the JWT roles claim, with no
    // per-row breakdown needed for landing.
    //
    // Ordering inside `available` is landing-priority (DA, AG, CA)
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

        // Every SuperAdmin gets the read-only "Goal Overview" switcher entry (all zones). Web only;
        // never the landing (it is not in the landing chain above).
        if (includeGoal && rolesClaim.Contains("SuperAdmin"))
            available.Add(new DashboardEntry { Kind = "goal-oversight", Route = "/goal-overviews", Label = "Goal Overview" });
    }
}
