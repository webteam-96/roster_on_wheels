using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using Dapper;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

// Mobile-facing twin of the web /api/clubs/{clubId}/past-presidents surface,
// scoped for the Flutter Club Admin app. Reuses IPastPresidentService so ALL
// behaviour (past-year-only rule, one-PP-per-year uniqueness, member vs
// non-member normalisation, soft-delete-slot reactivation) stays single-sourced
// with the web controller. Authorisation mirrors the club-admin mobile pattern:
// SuperAdmin (any club) or Admin (auto-scoped to their own club).
[ApiController]
[Route("api/mobile/club-admin/past-presidents")]
[Authorize]
public class MobileClubAdminPastPresidentsController : ControllerBase
{
    private readonly IPastPresidentService _service;
    private readonly string _connectionString;
    private readonly IWebHostEnvironment _env;

    public MobileClubAdminPastPresidentsController(IPastPresidentService service, IConfiguration configuration, IWebHostEnvironment env)
    {
        _service = service;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _env = env;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    private bool IsSuperAdminOrAdmin()
    {
        var roles = User.FindFirst("roles")?.Value ?? "";
        return roles.Contains("SuperAdmin") || roles.Contains("Admin");
    }

    // SuperAdmin or a manager of the club (its admins and AGs, a district admin with all-clubs access): the rule
    // for /api/clubs/{id} writes. Was: a "clubId" token claim that is never issued, so any Admin reached any club's
    // list and member search, and club admins were refused their own records.
    private async Task<bool> ManagesAsync(int clubId) =>
        await ScopeWriteGuardMiddleware.AllowedAsync(_connectionString, GetUserId(), true, clubId);

    private ObjectResult NotYourClub() => StatusCode(403, new { message = "Access denied." });

    // Verifies a past-president row belongs to a club the caller manages.
    private async Task<bool> CanTouchAsync(int pastPresidentId) =>
        await _service.GetByIdAsync(pastPresidentId) is { } row && await ManagesAsync(row.ClubId);

    // ── List ───────────────────────────────────────────────────────
    // GET /api/mobile/club-admin/past-presidents?clubId=
    [HttpGet("")]
    public async Task<ActionResult<List<PastPresidentDto>>> GetByClub([FromQuery] int? clubId)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        var cid = clubId;
        if (cid == null) return BadRequest(new { message = "clubId is required." });
        if (!await ManagesAsync(cid.Value)) return NotYourClub();
        if (!await KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, cid.Value))
            return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _service.GetByClubAsync(cid.Value);
        return Ok(result);
    }

    // ── Detail ─────────────────────────────────────────────────────
    [HttpGet("{id}")]
    public async Task<ActionResult<PastPresidentDto>> GetById(int id)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        if (!await CanTouchAsync(id)) return StatusCode(403, new { message = "Access denied for this record." });
        var result = await _service.GetByIdAsync(id);
        if (result == null) return NotFound(new { message = "Past president record not found" });
        return Ok(result);
    }

    // ── Create ─────────────────────────────────────────────────────
    // POST /api/mobile/club-admin/past-presidents?clubId=
    // Multipart: optional `photo` file, honoured only for non-member entries.
    [HttpPost("")]
    public async Task<ActionResult> Create([FromQuery] int? clubId, [FromForm] CreatePastPresidentDto dto, IFormFile? photo)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        var cid = clubId;
        if (cid == null) return BadRequest(new { message = "clubId is required." });
        if (!await ManagesAsync(cid.Value)) return NotYourClub();
        try
        {
            var id = await _service.CreateAsync(cid.Value, dto, photo, GetUserId(), _env);
            return Ok(new { id });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    // ── Update ─────────────────────────────────────────────────────
    [HttpPut("{id}")]
    public async Task<ActionResult> Update(int id, [FromForm] UpdatePastPresidentDto dto, IFormFile? photo)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        if (!await CanTouchAsync(id)) return StatusCode(403, new { message = "Access denied for this record." });
        try
        {
            await _service.UpdateAsync(id, dto, photo, GetUserId(), _env);
            return Ok(new { message = "Past president updated successfully." });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    // ── Delete ─────────────────────────────────────────────────────
    [HttpDelete("{id}")]
    public async Task<ActionResult> Delete(int id)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        if (!await CanTouchAsync(id)) return StatusCode(403, new { message = "Access denied for this record." });
        await _service.DeleteAsync(id, GetUserId());
        return Ok(new { message = "Past president deleted successfully." });
    }

    // ── Member autocomplete ────────────────────────────────────────
    // GET /api/mobile/club-admin/past-presidents/search-members?clubId=&search=
    [HttpGet("search-members")]
    public async Task<ActionResult<List<ClubMemberSearchDto>>> SearchMembers([FromQuery] int? clubId, [FromQuery] string? search)
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        var cid = clubId;
        if (cid == null) return BadRequest(new { message = "clubId is required." });
        if (!await ManagesAsync(cid.Value)) return NotYourClub();
        if (!await KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, cid.Value))
            return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _service.SearchClubMembersAsync(cid.Value, search);
        return Ok(result);
    }

    // ── Past-year picker ───────────────────────────────────────────
    // Past Presidents can only be recorded for PAST rotary years. This returns
    // exactly the selectable years so the mobile client doesn't have to replicate
    // the "EndDate < today" filter the web add/edit forms apply.
    // GET /api/mobile/club-admin/past-presidents/years
    [HttpGet("years")]
    public async Task<ActionResult> GetPastYears()
    {
        if (!IsSuperAdminOrAdmin()) return StatusCode(403, new { message = "Access denied." });
        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        var rows = await conn.QueryAsync(@"
            SELECT pk_year_id AS Id, YearLabel, StartDate, EndDate
            FROM rotary_year_master
            WHERE isdeleted = 0 AND EndDate < CURDATE()
            ORDER BY StartDate DESC");
        return Ok(rows);
    }
}
