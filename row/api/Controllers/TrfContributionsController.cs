using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/clubs/{clubId}/trf")]
[Authorize]
public class TrfContributionsController : ControllerBase
{
    private readonly ITrfContributionService _service;
    private readonly string _connectionString;

    public TrfContributionsController(ITrfContributionService service, IConfiguration configuration)
    {
        _service = service;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");
    private string GetRoleName() => User.FindFirst("roleName")?.Value ?? "";

    // ── Fund Master ────────────────────────────────────────────────────

    [HttpGet("funds")]
    public async Task<ActionResult> GetFunds(int clubId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var funds = await _service.GetFundsAsync();
        return Ok(funds);
    }

    [HttpPost("settings/funds")]
    public async Task<ActionResult> CreateFund(int clubId, [FromBody] CreateTrfFundDto dto)
    {
        if (GetRoleName() != "SuperAdmin")
            return Forbid();

        var result = await _service.CreateFundAsync(dto, GetUserId());
        return Ok(result);
    }

    [HttpPut("settings/funds/{fundId}")]
    public async Task<ActionResult> UpdateFund(int clubId, int fundId, [FromBody] UpdateTrfFundDto dto)
    {
        if (GetRoleName() != "SuperAdmin")
            return Forbid();

        await _service.UpdateFundAsync(fundId, dto, GetUserId());
        return Ok(new { message = "Fund updated successfully." });
    }

    [HttpDelete("settings/funds/{fundId}")]
    public async Task<ActionResult> DeleteFund(int clubId, int fundId)
    {
        if (GetRoleName() != "SuperAdmin")
            return Forbid();

        await _service.DeleteFundAsync(fundId, GetUserId());
        return Ok(new { message = "Fund deleted successfully." });
    }

    // ── Contributions ──────────────────────────────────────────────────

    [HttpGet]
    public async Task<ActionResult> GetContributions(int clubId, [FromQuery] int yearId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var contributions = await _service.GetContributionsAsync(clubId, yearId);
        return Ok(contributions);
    }

    [HttpPost]
    public async Task<ActionResult> CreateContribution(int clubId, [FromBody] CreateTrfContributionDto dto)
    {
        var result = await _service.CreateContributionAsync(clubId, dto, GetUserId());
        return Ok(result);
    }

    [HttpPut("{trfId}")]
    public async Task<ActionResult> UpdateContribution(int clubId, int trfId, [FromBody] UpdateTrfContributionDto dto)
    {
        var result = await _service.UpdateContributionAsync(clubId, trfId, dto, GetUserId());
        return Ok(result);
    }

    [HttpDelete("{trfId}")]
    public async Task<ActionResult> DeleteContribution(int clubId, int trfId)
    {
        await _service.DeleteContributionAsync(trfId, GetUserId());
        return Ok(new { message = "Contribution deleted successfully." });
    }

    // ── CMR Helpers ────────────────────────────────────────────────────

    [HttpGet("year-total")]
    public async Task<ActionResult> GetYearTotal(int clubId, [FromQuery] int yearId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var total = await _service.GetYearTotalAsync(clubId, yearId);
        return Ok(new { total });
    }

    [HttpGet("month-total")]
    public async Task<ActionResult> GetMonthTotal(int clubId, [FromQuery] int yearId, [FromQuery] int month)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var total = await _service.GetMonthTotalAsync(clubId, yearId, month);
        return Ok(new { total });
    }

    [HttpGet("by-month")]
    public async Task<ActionResult> GetContributionsForMonth(int clubId, [FromQuery] int yearId, [FromQuery] int month)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var contributions = await _service.GetContributionsForMonthAsync(clubId, yearId, month);
        return Ok(contributions);
    }
}
