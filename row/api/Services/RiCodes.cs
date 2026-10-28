using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// RI fields for the outbound sync (build spec 3.12): RI's six officer titles, mapped from ROW designations, and the
/// ri_codes lists (member types, join and termination reason codes) a Super Admin keeps from RI's own lists. Stored
/// now; sending them to RI waits for ROW's Rotary.org access.
/// </summary>
public static class RiCodes
{
    public static readonly string[] OfficerTitles =
        { "President", "Secretary", "Treasurer", "Executive Secretary", "Membership Chair", "Foundation Chair" };

    public static readonly string[] Kinds = { "member_type", "join_reason", "termination_reason" };

    /// <summary>The six designations PlanningService mapped by name before the mapping became data.</summary>
    public const string SeedOfficerTitlesSql = @"
        UPDATE designation_master SET ri_title = CASE designation_name WHEN 'Club President' THEN 'President'
            WHEN 'Club Secretary' THEN 'Secretary' WHEN 'Club Treasurer' THEN 'Treasurer'
            WHEN 'Club Executive Secretary/Director' THEN 'Executive Secretary'
            WHEN 'Club Membership Chair' THEN 'Membership Chair' WHEN 'Club Foundation Chair' THEN 'Foundation Chair' END
        WHERE ri_title IS NULL AND designation_name IN ('Club President', 'Club Secretary', 'Club Treasurer',
            'Club Executive Secretary/Director', 'Club Membership Chair', 'Club Foundation Chair')";

    public const string SeedMemberTypesSql = @"
        INSERT IGNORE INTO ri_codes (kind, code, label, sort_order) VALUES
            ('member_type', 'active', 'Active', 1), ('member_type', 'honorary', 'Honorary', 2)";

    /// <summary>Null and empty are allowed (no code); otherwise the code must be a live entry of that kind.</summary>
    public static async Task<bool> IsValidAsync(MySqlConnection conn, string kind, string? code) =>
        string.IsNullOrEmpty(code) || await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM ri_codes WHERE kind = @kind AND code = @code AND isdeleted = 0", new { kind, code }) > 0;
}
