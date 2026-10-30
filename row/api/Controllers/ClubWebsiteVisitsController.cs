using System.Security.Cryptography;
using System.Text;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using MySqlConnector;

namespace RotaryApi.Controllers;

/// <summary>
/// Visitor counter for the club website footers (the RIZones club site's visits.php, same contract):
/// GET /api/public/club-website/visits?club=143 records this visitor once per day and returns
/// { total, today }. total = the sum of each day's distinct visitors; today = today's (UTC day).
/// Privacy: the visitor is SHA-256(daily salt | IP | browser), the salt derived from a server secret and the date,
/// so no IP is stored and the same person cannot be linked from one day to the next.
/// </summary>
[ApiController]
[AllowAnonymous]
[Route("api/public/club-website")]   // controller-level route: PublicCorsControllerConvention opens CORS for it
public class ClubWebsiteVisitsController : ControllerBase
{
    private readonly string _cs;
    private readonly string _secret;

    public ClubWebsiteVisitsController(IConfiguration config)
    {
        _cs = config.GetConnectionString("DefaultConnection")!;
        // VisitCounter:Secret keeps counts stable across restarts; the JWT secret is the fallback.
        _secret = config["VisitCounter:Secret"] ?? config["JwtSettings:Secret"] ?? "";
    }

    public sealed record VisitCount(long Total, long Today);

    [HttpGet("visits")]
    [EnableRateLimiting("feed")]
    public async Task<ActionResult<VisitCount>> Visit([FromQuery] int club)
    {
        if (club <= 0) return BadRequest(new { error = "club is required" });
        if (string.IsNullOrEmpty(_secret)) return StatusCode(503, new { error = "visit counter is not configured" });

        using var conn = new MySqlConnection(_cs);
        await conn.OpenAsync();
        // Only clubs with a website count, so the table cannot be filled with made-up club ids.
        var hasSite = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM club_websites WHERE fk_club_id = @Club AND isdeleted = 0", new { Club = club });
        if (hasSite == 0) return NotFound(new { error = "no website for this club" });

        var today = DateTime.UtcNow.Date;
        await conn.ExecuteAsync(@"
            INSERT IGNORE INTO club_website_visits (fk_club_id, visit_date, visitor_hash)
            VALUES (@Club, @Day, @Hash)", new { Club = club, Day = today, Hash = VisitorHash(today) });

        var row = await conn.QueryFirstAsync<(long total, long todayCount)>(@"
            SELECT COUNT(*), COALESCE(SUM(visit_date = @Day), 0)
            FROM club_website_visits WHERE fk_club_id = @Club", new { Club = club, Day = today });
        return Ok(new VisitCount(row.total, row.todayCount));
    }

    private string VisitorHash(DateTime day)
    {
        var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "0.0.0.0";
        var agent = Request.Headers.UserAgent.ToString();
        var salt = Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(_secret),
            Encoding.UTF8.GetBytes("visits|" + day.ToString("yyyy-MM-dd"))));
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(salt + "|" + ip + "|" + agent))).ToLowerInvariant();
    }
}
