using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.Services.RotaryOrg;
using System.Diagnostics;

namespace RotaryApi.Controllers;

// SuperAdmin-only endpoints for Rotary.org sync.
// Phase 1 (current): only /ping — proves auth + fetch works. No DB writes yet.
[ApiController]
[Route("api/admin/rotary-org-sync")]
[Authorize]
public class RotaryOrgSyncController : ControllerBase
{
    private readonly IRotaryOrgApiClient _client;
    private readonly IClubSyncService _sync;
    private readonly ILogger<RotaryOrgSyncController> _logger;

    public RotaryOrgSyncController(IRotaryOrgApiClient client, IClubSyncService sync, ILogger<RotaryOrgSyncController> logger)
    {
        _client = client;
        _sync = sync;
        _logger = logger;
    }

    private bool IsSuperAdmin() => User.FindFirst("roles")?.Value?.Contains("SuperAdmin") == true;
    private int CurrentUserId() => int.TryParse(User.FindFirst("memberId")?.Value, out var x) ? x : 0;
    private string CurrentEmail() => User.FindFirst("email")?.Value ?? "";
    private string CurrentName() => User.FindFirst("name")?.Value ?? "";

    /// <summary>
    /// Probe Rotary.org connectivity. Authenticates, fetches /clubs, returns count + timings.
    /// Does NOT write to our DB.
    /// </summary>
    [HttpGet("ping")]
    public async Task<ActionResult> Ping(CancellationToken ct)
    {
        if (!IsSuperAdmin()) return Forbid();

        try
        {
            var swAuth = Stopwatch.StartNew();
            var token = await _client.GetTokenAsync(ct);
            swAuth.Stop();

            var swFetch = Stopwatch.StartNew();
            var clubs = await _client.GetClubsAsync(ct);
            swFetch.Stop();

            var byDistrict = clubs
                .GroupBy(c => c.DistrictId ?? 0)
                .Select(g => new { districtId = g.Key, count = g.Count() })
                .OrderByDescending(x => x.count)
                .Take(10)
                .ToList();

            return Ok(new
            {
                authenticated = !string.IsNullOrEmpty(token),
                authDurationMs = swAuth.ElapsedMilliseconds,
                fetchDurationMs = swFetch.ElapsedMilliseconds,
                clubCount = clubs.Count,
                sampleClub = clubs.FirstOrDefault(),
                topDistrictsByClubCount = byDistrict,
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Rotary.org ping failed");
            return StatusCode(500, new
            {
                message = "Ping failed — see server logs for details.",
                error = ex.Message,
                type = ex.GetType().Name,
            });
        }
    }

    /// <summary>
    /// Trigger full bootstrap sync in the background. Returns immediately with the sync log id.
    /// Poll /status/{logId} to track progress. On completion, an Excel report is emailed to you.
    /// </summary>
    [HttpPost("bootstrap")]
    public async Task<ActionResult> Bootstrap()
    {
        if (!IsSuperAdmin()) return Forbid();
        var logId = await _sync.StartBootstrapAsync(CurrentEmail(), CurrentName(), CurrentUserId());
        return Accepted(new
        {
            message = "Bootstrap started in the background. Check status with /api/admin/rotary-org-sync/status/{logId}. Report email will arrive when complete (~1 hour).",
            logId,
            statusUrl = $"/api/admin/rotary-org-sync/status/{logId}",
        });
    }

    /// <summary>
    /// Status snapshot for a running / completed sync.
    /// </summary>
    [HttpGet("status/{logId:int}")]
    public async Task<ActionResult> Status(int logId)
    {
        if (!IsSuperAdmin()) return Forbid();
        var s = await _sync.GetStatusAsync(logId);
        if (s == null) return NotFound(new { message = $"No sync log with id {logId}" });
        return Ok(s);
    }
}
