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
    /// <summary>
    /// True when stored date-times are UTC and go out with "Z" (UtcDateTimeConverter). Since 2026-11-17 the code writes
    /// UTC whatever the server zone: DateTime.UtcNow in C#, and every MySQL session runs in UTC (RowDb), so NOW() is UTC.
    /// </summary>
    public static bool StoredUtc => Brand.Feature("time.emitOffset");

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

    /// <summary>
    /// The value to store for a time a club form sent. A time without an offset is the club's wall-clock (its
    /// district's zone); when stored times are UTC it is converted, otherwise kept as typed.
    /// </summary>
    public static async Task<DateTime> ClubInputToStoredAsync(MySqlConnection conn, int clubId, DateTime value)
    {
        if (!StoredUtc) return value;
        return value.Kind switch
        {
            DateTimeKind.Utc => value,
            DateTimeKind.Local => value.ToUniversalTime(),
            _ => TimeZoneInfo.ConvertTimeToUtc(value, await OfClubAsync(conn, clubId)),
        };
    }

    /// <summary>
    /// A stored time as the club's wall-clock "yyyy-MM-ddTHH:mm", the value an edit form shows; the inverse of
    /// <see cref="ClubInputToStoredAsync"/>, so loading and saving a form never moves the time.
    /// </summary>
    public static async Task<string> StoredToClubInputAsync(MySqlConnection conn, int clubId, DateTime stored) =>
        StoredToInput(StoredUtc ? await OfClubAsync(conn, clubId) : Brand.TimeZone, stored);

    /// <summary><see cref="StoredToClubInputAsync"/> with the club's zone already known.</summary>
    public static string StoredToInput(TimeZoneInfo clubZone, DateTime stored) =>
        StoredToLocal(clubZone, stored).ToString("yyyy-MM-dd'T'HH:mm", System.Globalization.CultureInfo.InvariantCulture);

    /// <summary>A stored time as wall-clock in the zone (stored times are UTC only when <see cref="StoredUtc"/>).</summary>
    public static DateTime StoredToLocal(TimeZoneInfo zone, DateTime stored) =>
        StoredUtc ? TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(stored, DateTimeKind.Utc), zone) : stored;

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

    /// <summary>
    /// A stored time as an ISO string for a browser: "…Z" for an instant, no zone for a date (midnight), the same rule
    /// as UtcDateTimeConverter. Use it wherever the API builds a date-time string itself.
    /// </summary>
    public static string Iso(DateTime stored) =>
        stored.TimeOfDay == TimeSpan.Zero || !StoredUtc
            ? stored.ToString("yyyy-MM-dd'T'HH:mm:ss", System.Globalization.CultureInfo.InvariantCulture)
            : DateTime.SpecifyKind(stored, DateTimeKind.Utc).ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", System.Globalization.CultureInfo.InvariantCulture);

    /// <summary>
    /// A stored time printed for people (emails, receipts, Excel, PDF) in the given zone, or the brand zone. When the
    /// zone is UTC the text says so, so a reader in another zone is never shown a bare UTC time as if it were theirs.
    /// </summary>
    public static string Print(DateTime stored, string format, TimeZoneInfo? zone = null)
    {
        zone ??= Brand.TimeZone;
        var text = StoredToLocal(zone, stored).ToString(format, System.Globalization.CultureInfo.InvariantCulture);
        return zone.BaseUtcOffset == TimeSpan.Zero && !zone.SupportsDaylightSavingTime ? text + " UTC" : text;
    }
}
