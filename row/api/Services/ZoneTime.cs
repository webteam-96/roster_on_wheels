using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// N12 time zones. Every district keeps an IANA zone (district_master.Timezone, NULL = the brand's zone) and a club
/// uses its district's. Jobs that act on a district's day or hour work it out here from the UTC clock; platform jobs
/// (daily statistics, cache refresh, training appointments) keep <see cref="Brand.TimeZone"/>. The GreetingsWorker
/// links this file.
/// </summary>
public static class ZoneTime
{
    private static readonly bool ServerIsUtc =
        TimeZoneInfo.Local.BaseUtcOffset == TimeSpan.Zero && !TimeZoneInfo.Local.SupportsDaylightSavingTime;

    /// <summary>
    /// True when stored date-times are UTC: the server clock (DateTime.Now, MySQL NOW()) is UTC and time.emitOffset is
    /// on. Then the API writes them with "Z" (UtcDateTimeConverter); otherwise they are wall-clock values.
    /// </summary>
    public static bool StoredUtc => ServerIsUtc && Brand.Feature("time.emitOffset");

    /// <summary>The zone for an IANA id; the brand's zone for none, an unknown id, or with time.districtZone off.</summary>
    public static TimeZoneInfo Find(string? id) =>
        !string.IsNullOrWhiteSpace(id) && Brand.Feature("time.districtZone")
        && TimeZoneInfo.TryFindSystemTimeZoneById(id.Trim(), out var zone) ? zone : Brand.TimeZone;

    /// <summary>True for an IANA zone id this server knows, e.g. "America/New_York" (Windows ids are refused).</summary>
    public static bool IsValidId(string id) =>
        id.Length <= 64 && TimeZoneInfo.TryFindSystemTimeZoneById(id, out var zone) && (zone.HasIanaId || id == "UTC");

    /// <summary>The zone's IANA id (the brand zone may be configured with a Windows id).</summary>
    public static string IanaId(TimeZoneInfo zone) =>
        !zone.HasIanaId && TimeZoneInfo.TryConvertWindowsIdToIanaId(zone.Id, out var iana) ? iana : zone.Id;

    /// <summary>Wall-clock time in the zone at a UTC instant (default: now).</summary>
    public static DateTime Local(TimeZoneInfo zone, DateTime? utcNow = null) =>
        TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utcNow ?? DateTime.UtcNow, DateTimeKind.Utc), zone);

    public static async Task<TimeZoneInfo> OfDistrictAsync(MySqlConnection conn, int districtId) =>
        Find(await conn.ExecuteScalarAsync<string?>(
            "SELECT Timezone FROM district_master WHERE pk_district_id = @D", new { D = districtId }));

    /// <summary>A club's zone: its district's.</summary>
    public static async Task<TimeZoneInfo> OfClubAsync(MySqlConnection conn, int clubId) =>
        Find(await conn.ExecuteScalarAsync<string?>(@"
            SELECT d.Timezone FROM club_master c JOIN district_master d ON d.pk_district_id = c.fk_district_id
            WHERE c.pk_club_id = @C", new { C = clubId }));

    /// <summary>Every district's zone, by district id.</summary>
    public static async Task<Dictionary<int, TimeZoneInfo>> DistrictZonesAsync(MySqlConnection conn) =>
        (await conn.QueryAsync<(int Id, string? Tz)>("SELECT pk_district_id, Timezone FROM district_master"))
            .ToDictionary(r => r.Id, r => Find(r.Tz));

    /// <summary>
    /// The zone ids districts use, each with its zone, for jobs that run once per zone with @Tz bound to the id and
    /// <see cref="Filter"/> in their SQL. "" (the brand's zone) is always there: it also covers a club without a district.
    /// </summary>
    public static async Task<List<(string Id, TimeZoneInfo Zone)>> ZonesAsync(MySqlConnection conn) =>
        (await conn.QueryAsync<string>("SELECT '' UNION SELECT IFNULL(Timezone, '') FROM district_master"))
            .Select(id => (id, Find(id))).ToList();

    /// <summary>SQL condition: the district (alias; NULL when a club has none) is in the zone group @Tz.</summary>
    public static string Filter(string districtAlias) => $"IFNULL({districtAlias}.Timezone, '') = @Tz";
}
