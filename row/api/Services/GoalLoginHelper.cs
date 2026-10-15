using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

// Goal Setting role holders (goal_role_assignments) may log in to the WEB portal even when they hold
// none of the member_roles admin roles — their landing is the Goal Setting oversight dashboard
// (DashboardResolverController adds it from goal_role_assignments, not the JWT roles claim).
// Used by AuthService (login / SSO session / forgot-password) and by the "last admin role removed →
// deactivate credentials" paths so a goal holder's login is never switched off underneath them.
public static class GoalLoginHelper
{
    // RoleType of the Goal Setting "RI Director" assignment — global like member_roles RIDirector,
    // so it is exempt from the club→district→zone kill-switch at login.
    public const string RiDirectorRoleType = "AllCategoryAllDistrictsFewZones";

    public static async Task<bool> HasActiveGoalRoleAsync(MySqlConnection conn, int memberId, bool riDirectorOnly = false)
    {
        if (memberId <= 0) return false;
        var count = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM goal_role_assignments
            WHERE fk_member_id = @MemberId AND IsActive = 1 AND isdeleted = 0
              AND (@RiOnly = 0 OR RoleType = @RiType)",
            new { MemberId = memberId, RiOnly = riDirectorOnly ? 1 : 0, RiType = RiDirectorRoleType });
        return count > 0;
    }
}
