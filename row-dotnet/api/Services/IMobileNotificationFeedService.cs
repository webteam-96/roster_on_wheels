using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IMobileNotificationFeedService
{
    /// <summary>
    /// Paginated, newest-first notification feed for the mobile bell icon.
    /// Pagination is applied across the UNION of every source, not per source.
    /// </summary>
    /// <param name="memberId">Member resolved from the JWT "memberId" claim.</param>
    /// <param name="page">1-based page number.</param>
    /// <param name="pageSize">Rows per page (clamped 1..100).</param>
    /// <param name="days">Lookback window in days (clamped 1..365).</param>
    /// <param name="types">Optional comma-separated type filter, e.g. "project,announcement".</param>
    Task<PagedResult<MobileNotificationDto>> GetFeedAsync(
        int memberId, int page, int pageSize, int days, string? types);
}
