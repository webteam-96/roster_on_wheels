using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

// Helpers the one-to-one and group goal messages need (RIZones goal module, restored 2026-11-20 on owner request).
// ROW has no Goal Setting Roles screen, so goal_role_assignments stays empty: the role-based seats (RI Director,
// Zone Co-ordinator, District Assistant) resolve to nobody and the chats run between DG, District Admin and Super Admin.
public partial class GoalSettingService
{
    // Designation pairs: each zone-level designation has its own assistant (key = short form in the title's brackets).
    private static readonly Dictionary<string, string> DesignationAssistantOf = new(StringComparer.OrdinalIgnoreCase)
    {
        ["RRFC"] = "ARRFC", ["E/MGA"] = "AE/MGA", ["EPNC"] = "AEPNC", ["RMC"] = "ARMC", ["RPIC"] = "ARPIC",
    };

    private static string DesignationShort(string? title)
    {
        var m = System.Text.RegularExpressions.Regex.Match(title ?? "", @"\(([^()]+)\)\s*$");
        return m.Success ? m.Groups[1].Value.Trim() : "";
    }

    // The zone-level short form an assistant reports to ("ARRFC" -> "RRFC"); "" when not a known pair.
    private static string CoordinatorShortOf(string? assistantTitle)
    {
        var a = DesignationShort(assistantTitle);
        return DesignationAssistantOf.FirstOrDefault(kv => kv.Value.Equals(a, StringComparison.OrdinalIgnoreCase)).Key ?? "";
    }

    private static string TierRoleLabel(int tier) => tier switch
    {
        5 => "SuperAdmin", 4 => "RI Director", 3 => "Zone Co-ordinator", 2 => "District Assistant", _ => "",
    };

    // The active RI Director over a zone (null = none assigned).
    private static async Task<int?> ResolveRiDirectorForZoneAsync(MySqlConnection conn, int zoneId)
        => await conn.ExecuteScalarAsync<int?>(@"
            SELECT a.fk_member_id
            FROM goal_role_assignments a
            JOIN goal_role_assignment_zones z ON z.fk_assignment_id = a.pk_id
            WHERE a.RoleType = 'AllCategoryAllDistrictsFewZones' AND a.IsActive = 1 AND a.isdeleted = 0
              AND a.fk_member_id > 0 AND z.fk_zone_id = @ZoneId
            ORDER BY a.pk_id DESC LIMIT 1", new { ZoneId = zoneId });

    // Stamp one conversation as read for this viewer (sessions run in UTC, so NOW() is UTC).
    private static async Task MarkThreadSeenAsync(
        MySqlConnection conn, int viewerMemberId, int ownerMemberId, int categoryId, int yearId)
    {
        if (viewerMemberId <= 0 || ownerMemberId <= 0) return;
        await conn.ExecuteAsync(@"
            INSERT INTO goal_message_thread_seen
                (fk_member_id, ThreadOwnerMemberId, fk_category_id, fk_year_id, last_seen_date)
            VALUES (@M, @O, @C, @Y, NOW())
            ON DUPLICATE KEY UPDATE last_seen_date = NOW()",
            new { M = viewerMemberId, O = ownerMemberId, C = categoryId, Y = yearId });
    }
}
