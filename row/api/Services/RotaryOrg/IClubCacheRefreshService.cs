namespace RotaryApi.Services.RotaryOrg;

/// Shared Rotary.org /clubs → rotary_org_clubs_cache refresh used by BOTH the manual
/// "Refresh from Rotary.org" button and the automatic background scheduler.
public interface IClubCacheRefreshService
{
    /// Fetch /clubs and upsert the cache. Returns (upserted, staleDeleted, skippedEmpty).
    /// skippedEmpty = true means Rotary.org returned 0 clubs and the cache was left UNTOUCHED
    /// (never wiped on an empty/degraded response).
    Task<(int upserted, int deleted, bool skippedEmpty)> RefreshAsync(CancellationToken ct = default);

    /// Most recent cache refresh time (MAX LastFetchedUtc), or null if the cache is empty.
    /// The scheduler measures the next run from this, so a manual refresh resets the clock.
    Task<DateTime?> GetLastRefreshUtcAsync(CancellationToken ct = default);
}
