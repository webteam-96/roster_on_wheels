using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// N8 Meetings: calendar feeds and meeting compliance (MeetingsService). Behind the flagged feature 'meetings'
/// (FeatureGate). Club and district routes are guarded by ScopeWriteGuardMiddleware: reads need a member or manager
/// of that club or district, writes need a manager.
/// </summary>
[ApiController]
[Authorize]
public class MeetingsController : ControllerBase
{
    private static readonly Regex TokenFormat = new("^[0-9A-Fa-f]{64}$", RegexOptions.Compiled);

    private readonly MeetingsService _meetings;
    private readonly IAuditLogService _audit;
    private readonly IConfiguration _config;
    private readonly string _cs;

    public MeetingsController(MeetingsService meetings, IAuditLogService audit, IConfiguration config)
    {
        _meetings = meetings;
        _audit = audit;
        _config = config;
        _cs = config.GetConnectionString("DefaultConnection")!;
    }

    private int MemberId => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    private string? FeedUrl(string? token)
    {
        if (token == null) return null;
        var api = _config["Api:BaseUrl"];
        if (string.IsNullOrWhiteSpace(api)) api = $"{Request.Scheme}://{Request.Host}{Request.PathBase}";
        return $"{api.TrimEnd('/')}/api/public/calendar/{token}.ics";
    }

    // ── Calendar feeds ───────────────────────────────────────────────────────────────────────

    [HttpGet("api/clubs/{clubId:int}/calendar-feed")]
    public async Task<ActionResult> GetClubFeed(int clubId)
        => Ok(new { url = FeedUrl(await _meetings.GetFeedTokenAsync(clubId, null)) });

    /// <summary>Creates the club's feed URL, or replaces it so the old one stops working.</summary>
    [HttpPost("api/clubs/{clubId:int}/calendar-feed")]
    public async Task<ActionResult> ResetClubFeed(int clubId)
        => Ok(new { url = FeedUrl(await _meetings.ResetFeedTokenAsync(clubId, null, MemberId)) });

    /// <summary>The caller's own feed: meetings of every club they belong to (for the app).</summary>
    [HttpGet("api/mobile/calendar-feed")]
    public async Task<ActionResult> GetMyFeed()
    {
        if (MemberId <= 0) return Unauthorized();
        return Ok(new { url = FeedUrl(await _meetings.GetFeedTokenAsync(null, MemberId)) });
    }

    [HttpPost("api/mobile/calendar-feed")]
    public async Task<ActionResult> ResetMyFeed()
    {
        if (MemberId <= 0) return Unauthorized();
        return Ok(new { url = FeedUrl(await _meetings.ResetFeedTokenAsync(null, MemberId, MemberId)) });
    }

    /// <summary>The iCal feed itself. The token in the URL is the only credential, so calendar apps can subscribe.</summary>
    [AllowAnonymous]
    [EnableRateLimiting("feed")]
    [HttpGet("api/public/calendar/{token}.ics")]
    public async Task<ActionResult> Ics(string token)
    {
        if (!TokenFormat.IsMatch(token)) return NotFound();
        var ics = await _meetings.BuildIcsAsync(token.ToUpperInvariant());
        if (ics == null) return NotFound();
        Response.Headers.CacheControl = "private, max-age=300";
        return Content(ics, "text/calendar; charset=utf-8");
    }

    // ── Compliance ───────────────────────────────────────────────────────────────────────────

    /// <summary>"YYYY-MM", or the last complete month when empty.</summary>
    private static bool TryMonth(string? month, out DateTime value)
    {
        if (string.IsNullOrWhiteSpace(month))
        {
            value = new DateTime(DateTime.Now.Year, DateTime.Now.Month, 1).AddMonths(-1);
            return true;
        }
        return DateTime.TryParseExact(month + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out value);
    }

    [HttpGet("api/districts/{districtId:int}/meeting-compliance")]
    public async Task<ActionResult<MeetingComplianceDto>> GetDistrictCompliance(int districtId, [FromQuery] string? month)
    {
        // The scope guard lets every member of the district read district routes; this list is for its managers.
        if (!await ScopeWriteGuardMiddleware.AllowedAsync(_cs, MemberId, false, districtId))
            return StatusCode(403, new { message = "You do not manage this district." });
        if (!TryMonth(month, out var m)) return BadRequest(new { message = "Month must be YYYY-MM." });
        return Ok(await _meetings.GetComplianceAsync(districtId, null, m));
    }

    [HttpGet("api/clubs/{clubId:int}/meeting-compliance")]
    public async Task<ActionResult<MeetingComplianceDto>> GetClubCompliance(int clubId, [FromQuery] string? month)
    {
        if (!TryMonth(month, out var m)) return BadRequest(new { message = "Month must be YYYY-MM." });
        var dto = await _meetings.GetComplianceAsync(null, clubId, m);
        return dto == null ? NotFound(new { message = "Club not found." }) : Ok(dto);
    }

    /// <summary>District default (no clubId) or a club's override (clubId; a null count clears it).</summary>
    [HttpPut("api/districts/{districtId:int}/meeting-compliance/rule")]
    public async Task<ActionResult> SetRule(int districtId, [FromBody] SetMeetingRuleDto dto)
    {
        if (dto.ClubId == null && dto.MeetingsPerMonth == null)
            return BadRequest(new { message = "Meetings per month is required." });
        if (!await _meetings.SetRuleAsync(districtId, dto.ClubId, dto.MeetingsPerMonth, MemberId))
            return NotFound(new { message = "Club not found in this district." });
        await _audit.LogAsync(MemberId, "UPDATE", "meeting_rule", dto.ClubId ?? districtId, dto.ClubId == null ? "district default" : "club override",
            new { districtId, dto.ClubId, dto.MeetingsPerMonth }, HttpContext);
        return NoContent();
    }
}
