namespace RotaryApi.Services.Assistant.Tools;

// SQL fragments every tool query uses, so the visibility rules live in one place.
public static class ToolSql
{
    // A club that counts anywhere: not deleted, club + district + zone active, not Rotaract, and not
    // the COG pseudo-club (its 1,108 members are mostly also in real clubs - counting it double counts).
    public static string ClubCounts(string c = "c") =>
        $"{c}.isdeleted = 0 AND {HierarchyScopeSql.ClubLive(c)} AND {ClubScopeSql.NotRotaract(c)} " +
        $"AND {c}.pk_club_id <> {CogDesignationHelper.CogClubId}";

    // Narrows club_master (alias c, with district_master alias d joined) to the asked-for unit. The
    // unit's id is always bound as @Id. "all" relies on the caller adding ExcludedZonesSql.
    public static string Level(string level, string c = "c", string d = "d") => level switch
    {
        "club" => $"{c}.pk_club_id = @Id",
        "district" => $"{c}.fk_district_id = @Id",
        "zone" => $"{d}.fk_zone_id = @Id",
        _ => "1 = 1",
    };

    // club_master c + district_master d + zone_master z, for queries that report by unit.
    public static string ClubJoins(string c = "c", string d = "d", string z = "z") =>
        $"LEFT JOIN district_master {d} ON {d}.pk_district_id = {c}.fk_district_id " +
        $"LEFT JOIN zone_master {z} ON {z}.pk_zone_id = {d}.fk_zone_id";
}
