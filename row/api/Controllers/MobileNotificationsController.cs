using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Mobile bell-icon notification feed.
///
/// Route prefix, [Authorize] and the memberId-from-JWT convention all match the other
/// Mobile*Controllers (MobileCalendarController, MobileClubDuesController, …). The response is
/// the repo's standard <see cref="PagedResult{T}"/> envelope — the same
/// { items, totalCount, page, pageSize, totalPages } shape the mobile district-admin directory
/// already returns.
/// </summary>
[ApiController]
[Route("api/mobile")]
[Authorize]
public class MobileNotificationsController : ControllerBase
{
    private readonly IMobileNotificationFeedService _service;

    public MobileNotificationsController(IMobileNotificationFeedService service) => _service = service;

    private int GetMemberId() => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    /// <summary>
    /// GET /api/mobile/notifications?page=1&amp;pageSize=20&amp;days=90&amp;types=project,announcement
    ///
    /// Everything the signed-in member could have been notified about — greetings, projects,
    /// announcements, upcoming events, newsletters and documents — merged into ONE list sorted
    /// newest-first. Pagination is applied across the merged list, not per source.
    /// </summary>
    /// <param name="page">1-based page number. Default 1.</param>
    /// <param name="pageSize">Rows per page. Default 20, max 100.</param>
    /// <param name="days">Lookback window in days. Default 90, max 365. (Greetings are always
    /// capped to the last 30 days — see MobileNotificationFeedService.)</param>
    /// <param name="types">Optional comma-separated filter:
    /// greeting, project, announcement, event, newsletter, document. Omit for all.</param>
    [HttpGet("notifications")]
    public async Task<ActionResult<PagedResult<MobileNotificationDto>>> GetNotifications(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        [FromQuery] int days = 90,
        [FromQuery] string? types = null)
    {
        var memberId = GetMemberId();
        if (memberId <= 0) return Unauthorized();

        var result = await _service.GetFeedAsync(memberId, page, pageSize, days, types);
        return Ok(result);
    }
}
