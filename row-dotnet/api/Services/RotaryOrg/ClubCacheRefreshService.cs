using Dapper;
using MySqlConnector;

namespace RotaryApi.Services.RotaryOrg;

public class ClubCacheRefreshService : IClubCacheRefreshService
{
    // Auto-refresh runs ONCE a day at 08:00 in the brand's time zone. Single source of truth for the schedule;
    // the background service and the "next auto-refresh" display both use GetNextScheduledRunUtc().
    private static readonly TimeSpan ScheduledLocalTime = new(8, 0, 0); // 08:00

    private static TimeZoneInfo BrandZone() => Brand.TimeZone;

    // The next 08:00 in the brand time zone, returned in UTC (Kind=Utc so it serialises with a 'Z').
    public static DateTime GetNextScheduledRunUtc(DateTime? fromUtc = null)
    {
        var tz = BrandZone();
        var nowUtc = fromUtc ?? DateTime.UtcNow;
        var nowLocal = TimeZoneInfo.ConvertTimeFromUtc(nowUtc, tz);
        var todayRun = nowLocal.Date + ScheduledLocalTime;               // today 08:00 local
        var nextLocal = nowLocal < todayRun ? todayRun : todayRun.AddDays(1);
        return TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(nextLocal, DateTimeKind.Unspecified), tz);
    }

    private readonly string _connectionString;
    private readonly IRotaryOrgApiClient _api;
    private readonly ILogger<ClubCacheRefreshService> _logger;

    public ClubCacheRefreshService(IConfiguration config, IRotaryOrgApiClient api, ILogger<ClubCacheRefreshService> logger)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        _api = api;
        _logger = logger;
    }

    public async Task<(int upserted, int deleted, bool skippedEmpty)> RefreshAsync(CancellationToken ct = default)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();

        // One bulk /clubs call (all clubs in scope). GetClubsAsync throws on a non-200; a 200 with an
        // EMPTY body deserialises to an empty list — that's the dangerous case handled below.
        var orgAll = await _api.GetClubsAsync(ct);

        // SAFETY GUARD: a 0-club response must NEVER wipe a good cache (an expired token / API blip
        // that still returns 200 + []). Skip the upsert AND the delete entirely.
        if (orgAll.Count == 0)
        {
            _logger.LogWarning("[ClubCacheRefresh] /clubs returned 0 clubs — skipping refresh so the cache is not wiped.");
            return (0, 0, true);
        }

        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(ct);
        var nowUtc = DateTime.UtcNow;

        int upserted = 0;
        foreach (var c in orgAll)
        {
            await conn.ExecuteAsync(@"
                INSERT INTO rotary_org_clubs_cache
                    (RotaryClubId, ClubName, ClubType, DistrictNumber, Country, NumberOfActiveMembers, LastFetchedUtc)
                VALUES (@RcId, @Name, @Type, @District, @Country, @MemberCount, @Now)
                ON DUPLICATE KEY UPDATE
                    ClubName = VALUES(ClubName), ClubType = VALUES(ClubType),
                    DistrictNumber = VALUES(DistrictNumber), Country = VALUES(Country),
                    NumberOfActiveMembers = VALUES(NumberOfActiveMembers),
                    LastFetchedUtc = VALUES(LastFetchedUtc)",
                new
                {
                    RcId = c.ClubId,
                    Name = c.ClubName,
                    Type = c.ClubType,
                    District = c.DistrictId?.ToString() ?? "",
                    Country = c.ClubCountry,   // ROW: a club with no country is stored with none (the original assumed India)
                    MemberCount = c.MemberCount,
                    Now = nowUtc,
                });
            upserted++;
        }

        // Keep the cache = exactly the current /clubs set (drop rows this run didn't touch).
        var deleted = await conn.ExecuteAsync(
            "DELETE FROM rotary_org_clubs_cache WHERE LastFetchedUtc < @Now", new { Now = nowUtc });

        sw.Stop();
        _logger.LogInformation("[ClubCacheRefresh] {Upserted} clubs upserted, {Deleted} stale removed in {Ms}ms",
            upserted, deleted, sw.ElapsedMilliseconds);
        return (upserted, deleted, false);
    }

    public async Task<DateTime?> GetLastRefreshUtcAsync(CancellationToken ct = default)
    {
        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync(ct);
        return await conn.ExecuteScalarAsync<DateTime?>("SELECT MAX(LastFetchedUtc) FROM rotary_org_clubs_cache");
    }
}
