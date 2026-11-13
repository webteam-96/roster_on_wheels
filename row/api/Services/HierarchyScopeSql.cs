using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

// upstream 2026-10-21: an INACTIVE zone hides its districts, clubs and members everywhere; an inactive
// district hides its clubs and members; an inactive club hides its members - for everyone,
// SuperAdmin included. Only the master listings (Zone / District / Club masters) still show
// inactive rows so they can be switched back on. Nothing is written to child rows: activating the
// parent again brings everything back exactly as it was.
//
// Every predicate uses NOT EXISTS so a row with no district / zone (NULL fk) stays visible.
// Subquery aliases (hz/hd/hc) are private to the subquery, so they never clash with the caller's.
public static class HierarchyScopeSql
{
    /// Zone row is live. alias = zone_master alias.
    public static string ZoneLive(string a = "z") => $"COALESCE({a}.IsActive,1) = 1";

    /// District row is live (district active AND its zone active). alias = district_master alias.
    public static string DistrictLive(string a = "d") =>
        $"(COALESCE({a}.IsActive,1) = 1 AND NOT EXISTS (SELECT 1 FROM zone_master hz WHERE hz.pk_zone_id = {a}.fk_zone_id AND COALESCE(hz.IsActive,1) = 0))";

    /// A district id expression (e.g. "c.fk_district_id") points at a live district (or none).
    public static string DistrictIdLive(string expr) =>
        $"NOT EXISTS (SELECT 1 FROM district_master hd LEFT JOIN zone_master hz ON hz.pk_zone_id = hd.fk_zone_id WHERE hd.pk_district_id = {expr} AND (COALESCE(hd.IsActive,1) = 0 OR COALESCE(hz.IsActive,1) = 0))";

    /// Club row is live (club, its district and its zone all active). alias = club_master alias.
    public static string ClubLive(string a = "c") =>
        $"(COALESCE({a}.IsActive,1) = 1 AND {DistrictIdLive(a + ".fk_district_id")})";

    /// A club id expression (e.g. "cm.fk_club_id") points at a live club (or none).
    /// Use on club_members / club-scoped tables that have no club_master join.
    public static string ClubIdLive(string expr) =>
        $"NOT EXISTS (SELECT 1 FROM club_master hc LEFT JOIN district_master hd ON hd.pk_district_id = hc.fk_district_id LEFT JOIN zone_master hz ON hz.pk_zone_id = hd.fk_zone_id WHERE hc.pk_club_id = {expr} AND (COALESCE(hc.IsActive,1) = 0 OR COALESCE(hd.IsActive,1) = 0 OR COALESCE(hz.IsActive,1) = 0))";

    /// For results that come from stored procedures (which can't be edited on this DB): load the
    /// hidden ids once and filter in C#.
    public static async Task<HiddenScope> LoadHiddenAsync(MySqlConnection conn)
    {
        var zones = await conn.QueryAsync<int>(
            "SELECT pk_zone_id FROM zone_master WHERE COALESCE(IsActive,1) = 0");
        var districts = await conn.QueryAsync<int>($@"
            SELECT d.pk_district_id FROM district_master d
            WHERE NOT {DistrictLive("d")}");
        var clubs = await conn.QueryAsync<int>($@"
            SELECT c.pk_club_id FROM club_master c
            WHERE NOT {ClubLive("c")}");
        return new HiddenScope(zones.ToHashSet(), districts.ToHashSet(), clubs.ToHashSet());
    }
}

public sealed record HiddenScope(HashSet<int> Zones, HashSet<int> Districts, HashSet<int> Clubs)
{
    public bool ZoneHidden(int? id) => id.HasValue && Zones.Contains(id.Value);
    public bool DistrictHidden(int? id) => id.HasValue && Districts.Contains(id.Value);
    public bool ClubHidden(int? id) => id.HasValue && Clubs.Contains(id.Value);
}
