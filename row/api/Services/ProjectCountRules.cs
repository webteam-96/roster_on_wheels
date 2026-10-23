using MySqlConnector;

namespace RotaryApi.Services;

// ONE definition of "a project that counts", shared by the two places that publish a
// project count (user, 2026-09-28: "both places you need do display same count … their
// final count should be match with website project count"):
//
//   • the public website  — PublicProjectStatsController (portal.example.org/projects)
//   • the daily email     — DailyStatsReportService
//
// The rules, as the user stated them:
//   1. one-time projects count;
//   2. an ongoing project counts ONCE — its parent entry, never the repeat entries.
//      Option B: when the parent belongs to an EARLIER year table, the project's first
//      entry of THIS year stands in for it, so a project carried over from last year is
//      still counted in the year the work happened (35 such projects in 2026-27 — under a
//      plain "parent only" rule they would have counted in no year at all);
//   3. Zone 0 does not count — and with it the permanently exempt districts.
//
// Club Service is NOT a project (it is the club's meetings) and is excluded from every
// count here; the email reports it on its own line.
//
// Whoever changes a rule changes it HERE, or the two numbers drift apart again.
public interface IProjectCountRules
{
    // The shared counting filter. Every rule is SQL, so nothing is loaded.
    Task<ProjectCountFilter> GetFilterAsync(MySqlConnection conn, CancellationToken ct = default);
}

public sealed class ProjectCountRules : IProjectCountRules
{
    private static readonly ProjectCountFilter Filter = new();

    public Task<ProjectCountFilter> GetFilterAsync(MySqlConnection conn, CancellationToken ct = default) => Task.FromResult(Filter);
}

// The SQL half of the rules. Every fragment names the year table it belongs to, because
// the ongoing-parent test is per-table.
public sealed class ProjectCountFilter
{
    // The 5 project avenues. Club Service is a meeting, not a project.
    public const string ProjectModuleKeys =
        "'community_service','vocational_service','international_service','new_generation_service','public_image_initiative'";

    public const string ClubServiceModuleKey = "club_service";

    // The 5 avenues + Club Service — everything a project row may legitimately belong to.
    // A row carrying anything else (fk_module_id 0, i.e. saved with no module at all — 12 such
    // rows in 2026-27) is counted NOWHERE and shown nowhere: user, 2026-09-28, "what is Other …
    // dont consider that now remove that". The website never reached them anyway, since it joins
    // ProjectModuleKeys; this is what makes the statistics report agree. The rows themselves are
    // untouched in the database — this hides them from the counts, it does not fix the data.
    public const string AvenueModuleKeys = ProjectModuleKeys + ",'" + ClubServiceModuleKey + "'";

    // Rule 3 — the organisation is ROW. "Zone 0" (the placeholder) and
    // "Other Zones" are not part of it, and these three districts never count anywhere.
    public static readonly string[] IndiaZoneNames = { "Zone 4", "Zone 5", "Zone 6", "Zone 7", "Zone 8" };
    public static string[] ExemptDistrictNumbers => RotaryApi.Services.Brand.ExemptDistricts;   // ROW: Brand:Scope:ExemptDistricts

    private static string ZoneList => "'" + string.Join("','", IndiaZoneNames) + "'";
    private static string ExemptList => "'" + string.Join("','", ExemptDistrictNumbers) + "'";

    /// <summary>
    /// club → district → zone, with rule 3 baked in. <paramref name="clubIdExpr"/> is
    /// whatever column holds the club id at the join site (p.fk_club_id, u.ClubId, …).
    /// </summary>
    public static string Geo(string clubIdExpr, string club = "c", string district = "d", string zone = "z") => $@"
        JOIN club_master {club} ON {club}.pk_club_id = {clubIdExpr} AND {club}.isdeleted = 0 AND {club}.IsActive = 1
        JOIN district_master {district} ON {district}.pk_district_id = {club}.fk_district_id
             AND {district}.isdeleted = 0 AND {district}.IsActive = 1
             AND {district}.DistrictNumber NOT IN ({ExemptList})
        JOIN zone_master {zone} ON {zone}.pk_zone_id = {district}.fk_zone_id
             AND {zone}.isdeleted = 0 AND {zone}.IsActive = 1
             AND {zone}.ZoneName IN ({ZoneList})";

    /// <summary>The row exists and is switched on. Says nothing about approvals.</summary>
    public static string Live(string a = "p") => $"{a}.isdeleted = 0 AND {a}.is_active = 1";

    /// <summary>
    /// Rules 1 + 2 (option B) — this row IS the project, not a repeat of it. True for a
    /// one-time project, for an ongoing parent, and for the first entry of this year of an
    /// ongoing project whose parent lives in an earlier year table.
    /// </summary>
    public string RepresentsProject(string table, string a = "p") => $@"(
        COALESCE({a}.parent_project_id,0) = 0
        OR (
            NOT EXISTS (SELECT 1 FROM `{table}` par
                        WHERE par.pk_project_id = {a}.parent_project_id AND COALESCE(par.isdeleted,0) = 0)
            AND NOT EXISTS (SELECT 1 FROM `{table}` sib
                        WHERE sib.parent_project_id = {a}.parent_project_id
                          AND sib.pk_project_id < {a}.pk_project_id
                          AND {Live("sib")})
        ))";

    /// <summary>Every row rule, ready to append to a WHERE. Geo is separate (see <see cref="Geo"/>).</summary>
    public string CountsAsProject(string table, string a = "p") =>
        $"{Live(a)} AND {RepresentsProject(table, a)}";

    /// <summary>
    /// Why a live row did NOT count, as one value per row — for the email's detail columns.
    /// Mutually exclusive and in this order, so the buckets add up to the live row count:
    /// repeat entry → counted (one-time / ongoing).
    /// </summary>
    public string BucketExpr(string table, string a = "p") => $@"
        CASE WHEN NOT {RepresentsProject(table, a)}                       THEN 'repeat'
             WHEN LOWER(COALESCE({a}.project_type,'one_time')) = 'one_time' THEN 'one_time'
             ELSE 'ongoing' END";
}
