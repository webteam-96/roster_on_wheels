using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// Phase 4 Zone/District/Club kill-switch chain check.
///
/// A district drill-down is reachable only when both the district AND its parent
/// zone are active (IsActive = 1, isdeleted = 0). A club drill-down is reachable
/// only when the club, its district, and its zone are all active.
///
/// SuperAdmin is exempt at LOGIN, but for management/drill-down
/// every role follows this chain rule. Only the master Edit/Update endpoints in
/// ZonesController / DistrictsController / ClubsController bypass these helpers
/// so SA can flip IsActive back on.
///
/// Reference templates: <see cref="Controllers.DistrictsController"/> +
/// <see cref="Controllers.ClubsController"/>.
/// </summary>
public static class KillSwitchHelper
{
    public static async Task<bool> IsDistrictDrillReachableAsync(string connectionString, int districtId)
    {
        using var conn = new MySqlConnection(connectionString);
        await conn.OpenAsync();
        var count = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM district_master d
            JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE d.pk_district_id = @Id
              AND d.IsActive = 1 AND d.isdeleted = 0
              AND z.IsActive = 1 AND z.isdeleted = 0",
            new { Id = districtId });
        return count > 0;
    }

    public static async Task<bool> IsClubDrillReachableAsync(string connectionString, int clubId)
    {
        using var conn = new MySqlConnection(connectionString);
        await conn.OpenAsync();
        var count = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM club_master c
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE c.pk_club_id = @Id
              AND c.IsActive = 1 AND c.isdeleted = 0
              AND d.IsActive = 1 AND d.isdeleted = 0
              AND z.IsActive = 1 AND z.isdeleted = 0",
            new { Id = clubId });
        return count > 0;
    }

    public const string DistrictBlockedMessage =
        "This district or its zone is inactive. Reactivate it first to access this data.";
    public const string ClubBlockedMessage =
        "This club, its district, or its zone is inactive. Reactivate it first to access this data.";
}
