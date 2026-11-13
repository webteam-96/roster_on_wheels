using Dapper;
using MySqlConnector;

namespace RotaryApi.Services.Assistant;

// Reads the member's live role rows and turns them into an AssistantScope.
//
// Deliberately NOT MemberScopesHelper.BuildScopesAsync's Zones/Districts/Clubs lists: those add the
// parent district and zone of every Club Admin row and every plain club membership, which would hand
// a Club Admin their whole district. Reach here comes only from the role row's own id.
public sealed class AssistantScopeBuilder
{
    private readonly IGoalSettingService _goals;

    public AssistantScopeBuilder(IGoalSettingService goals) => _goals = goals;

    public async Task<AssistantScope> BuildAsync(MySqlConnection conn, int memberId, string memberName)
    {
        // Same live-hierarchy rule as MemberScopesHelper: a role under an inactive zone / district /
        // club is not offered at all.
        var roleRows = await conn.QueryAsync<RoleRow>($@"
            SELECT r.RoleName, mr.fk_zone_id AS ZoneId, mr.fk_district_id AS DistrictId,
                   mr.fk_club_id AS ClubId, COALESCE(mr.AllClubsAccess, 0) AS AllClubsAccess
            FROM member_roles mr
            JOIN roles r ON r.pk_role_id = mr.fk_role_id
            LEFT JOIN zone_master z ON z.pk_zone_id = mr.fk_zone_id
            LEFT JOIN district_master d ON d.pk_district_id = mr.fk_district_id
            LEFT JOIN club_master c ON c.pk_club_id = mr.fk_club_id
            WHERE mr.fk_member_master_profile_id = @MemberId
              AND mr.IsActive = 1 AND mr.isdeleted = 0
              AND {HierarchyScopeSql.ZoneLive("z")}
              AND {HierarchyScopeSql.DistrictLive("d")}
              AND {HierarchyScopeSql.ClubLive("c")}",
            new { MemberId = memberId });

        bool superAdmin = false, riDirector = false;
        var zc = new HashSet<int>();
        var da = new HashSet<int>();
        var daAll = new HashSet<int>();
        var ca = new HashSet<int>();

        foreach (var r in roleRows)
        {
            // fk_*_id = 0 means "not set" on legacy rows, same as NULL.
            int? zone = r.ZoneId > 0 ? r.ZoneId : null;
            int? district = r.DistrictId > 0 ? r.DistrictId : null;
            int? club = r.ClubId > 0 ? r.ClubId : null;
            switch (r.RoleName)
            {
                case UserPermissionHelper.SuperAdmin: superAdmin = true; break;
                // ROW has no RI Director / Zonal Coordinator roles (module sheet).
                case UserPermissionHelper.Admin:
                    if (club is int c) ca.Add(c);
                    else if (district is int d)
                    {
                        da.Add(d);
                        if (r.AllClubsAccess) daAll.Add(d);
                    }
                    break;
            }
        }

        // AG rights are per (club, year): an AG sees a club only for the years they held it.
        var agRows = await conn.QueryAsync<(int ClubId, int YearId)>($@"
            SELECT ag.fk_club_id, ag.fk_year_id
            FROM district_ag ag
            JOIN club_master c ON c.pk_club_id = ag.fk_club_id
            WHERE ag.fk_member_id = @MemberId
              AND COALESCE(ag.is_active, 1) = 1 AND COALESCE(ag.isdeleted, 0) = 0
              AND ag.fk_year_id IS NOT NULL
              AND {HierarchyScopeSql.ClubLive("c")}",
            new { MemberId = memberId });
        var ag = new Dictionary<int, HashSet<int>>();
        foreach (var (clubId, yearId) in agRows)
        {
            if (!ag.TryGetValue(clubId, out var years)) ag[clubId] = years = new HashSet<int>();
            years.Add(yearId);
        }

        var moderated = (await conn.QueryAsync<int>($@"
            SELECT m.fk_club_id
            FROM district_club_moderator m
            JOIN club_master c ON c.pk_club_id = m.fk_club_id
            WHERE m.fk_member_id = @MemberId
              AND COALESCE(m.is_active, 1) = 1 AND COALESCE(m.isdeleted, 0) = 0
              AND {HierarchyScopeSql.ClubLive("c")}",
            new { MemberId = memberId })).ToHashSet();

        // RI Director screens leave out the two placeholder zones (RiDirectorService.GetContextAsync).
        var excluded = riDirector && !superAdmin
            ? (await conn.QueryAsync<int>(
                "SELECT pk_zone_id FROM zone_master WHERE ZoneName IN ('Other Zones','Zone 0')")).ToHashSet()
            : new HashSet<int>();

        // Goal Setting seats (RI Director / Zone Co-ordinator / District Assistant). Inactive zones
        // and districts are already removed by the service.
        // ROW has no goal oversight roles, so no goal-seat zones or districts.
        var goalZones = new HashSet<int>();
        var goalDistricts = new HashSet<int>();

        return new AssistantScope
        {
            MemberId = memberId,
            MemberName = memberName,
            IsSuperAdmin = superAdmin,
            IsRiDirector = riDirector,
            ExcludedZones = excluded,
            CoordinatorZones = zc,
            AdminDistricts = da,
            AllClubsDistricts = daAll,
            AdminClubs = ca,
            AgClubYears = ag,
            ModeratorClubs = moderated,
            GoalZones = goalZones,
            GoalDistricts = goalDistricts,
        };
    }

    private sealed class RoleRow
    {
        public string RoleName { get; set; } = "";
        public int? ZoneId { get; set; }
        public int? DistrictId { get; set; }
        public int? ClubId { get; set; }
        public bool AllClubsAccess { get; set; }
    }
}
