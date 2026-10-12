using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/app/route-maintenance")]
public class RouteMaintenanceController : ControllerBase
{
    private readonly IRouteMaintenanceService _service;
    private readonly string _connectionString;

    public RouteMaintenanceController(IRouteMaintenanceService service, IConfiguration configuration)
    {
        _service = service;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    // Mobile app reads (any authenticated user) — returns only currently-blocked routes.
    // 30s cache: every device polls every ~8s, but origin only computes once per 30s.
    // Maintenance toggles reach users within ~30s — acceptable for a flag-flip flow.
    // Safe to cache "Any" location because the response shape is identical for every
    // authenticated user (no per-user filtering); /all (SuperAdmin) and PUT (writes)
    // intentionally stay uncached.
    [HttpGet]
    [Authorize]
    [ResponseCache(Duration = 30, Location = ResponseCacheLocation.Any)]
    public async Task<ActionResult> GetActive()
    {
        var rows = await _service.GetActiveAsync();
        return Ok(rows);
    }

    // Admin reads ALL rows (SuperAdmin only).
    [HttpGet("all")]
    [Authorize]
    public async Task<ActionResult> GetAll()
    {
        if (!await IsSuperAdminAsync())
            return StatusCode(403, new { message = "SuperAdmin access required." });

        var rows = await _service.GetAllAsync();
        return Ok(rows);
    }

    // Admin upsert (SuperAdmin only).
    [HttpPut]
    [Authorize]
    public async Task<ActionResult> Upsert([FromBody] RouteMaintenanceUpsertDto dto)
    {
        if (!await IsSuperAdminAsync())
            return StatusCode(403, new { message = "SuperAdmin access required." });

        if (string.IsNullOrWhiteSpace(dto.RouteKey))
            return BadRequest(new { message = "RouteKey is required." });

        await _service.UpsertAsync(dto, GetUserId());
        return Ok(new { message = "Route maintenance flag updated." });
    }

    private async Task<bool> IsSuperAdminAsync()
    {
        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        var count = await conn.ExecuteScalarAsync<int>(
            @"SELECT COUNT(*) FROM member_roles
              WHERE fk_member_master_profile_id = @MemberId
                AND fk_role_id = 3
                AND IsActive = 1
                AND isdeleted = 0",
            new { MemberId = GetUserId() });
        return count > 0;
    }
}
