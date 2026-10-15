using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/rotary-years")]
[Authorize]
public class RotaryYearsController : ControllerBase
{
    private readonly IRotaryYearService _rotaryYearService;
    private readonly string _connectionString;

    public RotaryYearsController(IRotaryYearService rotaryYearService, IConfiguration configuration)
    {
        _rotaryYearService = rotaryYearService;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private bool IsSuperAdmin() => User.FindFirst("roles")?.Value?.Contains("SuperAdmin") == true;

    [HttpGet]
    public async Task<ActionResult<List<RotaryYearDto>>> GetAllYears()
    {
        var result = await _rotaryYearService.GetAllYearsAsync();
        return Ok(result);
    }

    [HttpGet("current")]
    public async Task<ActionResult<RotaryYearDto>> GetCurrentYear()
    {
        var result = await _rotaryYearService.GetCurrentYearAsync();
        if (result == null) return NotFound(new { message = "Current rotary year not found" });
        return Ok(result);
    }

    /// <summary>
    /// Adds the next Rotary year row (July 1 → June 30 of the year after the latest existing row).
    /// Useful for forward planning (e.g., setting up District Committee for an upcoming year).
    /// </summary>
    [HttpPost("add-next")]
    public async Task<ActionResult> AddNextYear()
    {
        if (!IsSuperAdmin()) return Forbid();

        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();

        // Find the latest year by StartDate (handles soft-deleted gaps).
        var latestStart = await conn.ExecuteScalarAsync<DateTime?>(
            "SELECT MAX(StartDate) FROM rotary_year_master WHERE isdeleted = 0");
        if (latestStart is null) return BadRequest(new { message = "No existing rotary years found." });

        // Next year starts July 1 of (latest start year + 1).
        var nextStartYear = latestStart.Value.Year + 1;
        var nextDate = new DateTime(nextStartYear, 7, 1);
        var newId = await RotaryYearHelper.EnsureRotaryYearAsync(conn, nextDate);

        var label = $"{nextStartYear}-{(nextStartYear + 1) % 100:D2}";
        return Ok(new { id = newId, yearLabel = label, message = $"Rotary year {label} added." });
    }
}
