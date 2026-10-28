using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class ClubsController : ControllerBase
{
    private readonly IClubService _clubService;
    private readonly IAuditLogService _auditLog;
    private readonly string _connectionString;

    public ClubsController(IClubService clubService, IAuditLogService auditLog, IConfiguration configuration)
    {
        _clubService = clubService;
        _auditLog = auditLog;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    // Phase 4 kill-switch helper: drill-down into a club is blocked if the club, its
    // district, or its zone is inactive. Even SA must reactivate before managing — only
    // GetById and Update bypass so the Edit dialog still works.
    private async Task<bool> IsClubDrillReachableAsync(int clubId)
    {
        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        var count = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM club_master c
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE c.pk_club_id = @Id
              AND c.IsActive = 1 AND c.isdeleted = 0
              AND d.IsActive = 1 AND d.isdeleted = 0
              AND z.IsActive = 1 AND z.isdeleted = 0",
            new { Id = clubId });
        return count > 0;
    }

    [HttpGet]
    public async Task<ActionResult<PagedResult<ClubListDto>>> GetAll(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 12,
        [FromQuery] string? search = null,
        [FromQuery] int? districtId = null,
        [FromQuery] string? city = null,
        [FromQuery] string? meetingDay = null,
        [FromQuery] int? isActive = null,
        [FromQuery] int? zoneId = null)
    {
        // user 2026-10-08: Rotaract clubs only for SuperAdmin (District / Club Admin screens hide them).
        var result = await _clubService.GetAllAsync(page, pageSize, search, districtId, city, meetingDay, isActive, zoneId,
            excludeRotaract: ClubScopeSql.HideRotaract(UserPermissionHelper.IsSuperAdmin(User)));
        return Ok(result);
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<ClubDetailDto>> GetById(int id)
    {
        var club = await _clubService.GetByIdAsync(id);
        if (club == null)
            return NotFound(new { message = "Club not found" });
        return Ok(club);
    }

    [HttpGet("{id}/members")]
    public async Task<ActionResult<PagedResult<ClubMemberDto>>> GetMembers(
        int id,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        [FromQuery] string? search = null,
        [FromQuery] int? year = null,
        [FromQuery] string? email = null,
        [FromQuery] string? rotaryId = null,
        [FromQuery] string? districtNumber = null,
        [FromQuery] string? designation = null,
        [FromQuery] string? classification = null,
        [FromQuery] string? familyMemberName = null)
    {
        var club = await _clubService.GetByIdAsync(id);
        if (club == null)
            return NotFound(new { message = "Club not found" });

        // Phase 4 kill-switch: block drill-down if club/district/zone chain has any inactive link.
        if (!await IsClubDrillReachableAsync(id))
            return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access members." });

        var result = await _clubService.GetMembersAsync(id, page, pageSize, search, year,
            email, rotaryId, districtNumber, designation, classification, familyMemberName,
            MemberPrivacyHelper.GetViewerMemberId(User));
        return Ok(result);
    }

    // Distinct years available for the members-page Year filter (COG/club 31598 use case).
    [HttpGet("{id}/members/years")]
    public async Task<ActionResult<List<int>>> GetMemberYears(int id)
    {
        var club = await _clubService.GetByIdAsync(id);
        if (club == null)
            return NotFound(new { message = "Club not found" });
        if (!await IsClubDrillReachableAsync(id))
            return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access members." });

        var years = await _clubService.GetMemberDesignationYearsAsync(id);
        return Ok(years);
    }

    // The "COG" catch-all club — its member rows carry a past-DG label in
    // club_members.Designation ("3292 Dg 2025 - 26") instead of a real classification.
    private static int CogClubId => RotaryApi.Services.Brand.CogClubId;

    // Current district + Rotary year for one COG member, so the member edit form can
    // pre-fill the two pickers. Open to any authenticated user — same access model as
    // GET honorary-status: the value isn't sensitive and Club Admins see it read-only.
    // Writing stays SuperAdmin-only (the PUT below).
    [HttpGet("{id}/members/{memberId}/cog-designation")]
    public async Task<ActionResult> GetCogDesignation(int id, int memberId)
    {
        if (id != CogClubId)
            return Ok(new { districtNumber = (string?)null, yearLabel = (string?)null });

        var (districtNumber, yearLabel) = await _clubService.GetCogDesignationAsync(id, memberId);
        return Ok(new { districtNumber, yearLabel });
    }

    // SuperAdmin sets a COG member's District Number + Rotary Year. The pair is
    // stored back into club_members.Designation (COG row only) in the canonical
    // "NNNN Dg YYYY - YY" shape — no new column, so nothing to apply by hand on prod.
    // Members only VIEW the result (GET {id}/members returns cogDistrictNumber +
    // cogYear); there is no mobile write path.
    [HttpPut("{id}/members/{memberId}/cog-designation")]
    public async Task<ActionResult> UpdateCogDesignation(int id, int memberId, [FromBody] UpdateCogDesignationDto dto)
    {
        if (!IsSuperAdmin())
            return StatusCode(403, new { message = "Only SuperAdmin can change the COG district and year." });

        if (id != CogClubId)
            return BadRequest(new { message = "District/year is only maintained for the COG club." });

        var districtNumber = (dto?.DistrictNumber ?? string.Empty).Trim();
        var yearLabel = (dto?.YearLabel ?? string.Empty).Trim();

        if (!System.Text.RegularExpressions.Regex.IsMatch(districtNumber, @"^\d{3,5}$"))
            return BadRequest(new { message = "District number must be 3-5 digits." });
        if (!System.Text.RegularExpressions.Regex.IsMatch(yearLabel, @"^\d{4}-\d{2}$"))
            return BadRequest(new { message = "Year must be a Rotary year label such as 2025-26." });

        var updated = await _clubService.UpdateCogDesignationAsync(id, memberId, districtNumber, yearLabel, GetCurrentMemberId());
        if (!updated)
            return NotFound(new { message = "This member has no COG membership row." });

        await _auditLog.LogAsync(GetCurrentMemberId(), "UPDATE", "club_member_cog_designation", memberId,
            $"{districtNumber} / {yearLabel}", new { clubId = id, memberId, districtNumber, yearLabel }, HttpContext);

        return Ok(new { districtNumber, yearLabel });
    }

    [HttpGet("{id}/terminated-members")]
    public async Task<ActionResult<PagedResult<TerminatedMemberDto>>> GetTerminatedMembers(
        int id,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        [FromQuery] string? search = null)
    {
        var result = await _clubService.GetTerminatedMembersAsync(id, page, pageSize, search);
        return Ok(result);
    }

    [HttpPost]
    public async Task<ActionResult<object>> Create([FromBody] CreateClubDto dto)
    {
        if (!IsSuperAdmin())
            return StatusCode(403, new { message = "Only SuperAdmin can create clubs." });

        try
        {
            var id = await _clubService.CreateAsync(dto, GetCurrentMemberId());
            await _auditLog.LogAsync(GetCurrentMemberId(), "CREATE", "club", id, dto.ClubName, dto, HttpContext);
            return CreatedAtAction(nameof(GetById), new { id }, new { id });
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            return Conflict(new { message = ex.Message });
        }
    }

    [HttpPut("{id}")]
    public async Task<ActionResult> Update(int id, [FromBody] UpdateClubDto dto)
    {
        if (!IsSuperAdmin())
            return StatusCode(403, new { message = "Only SuperAdmin can update clubs." });

        var existing = await _clubService.GetByIdAsync(id);
        if (existing == null)
            return NotFound(new { message = "Club not found" });

        try
        {
            await _clubService.UpdateAsync(id, dto, GetCurrentMemberId());
            await _auditLog.LogAsync(GetCurrentMemberId(), "UPDATE", "club", id, dto.ClubName, dto, HttpContext);
            return NoContent();
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            return Conflict(new { message = ex.Message });
        }
    }

    [HttpDelete("{id}")]
    public async Task<ActionResult> Delete(int id)
    {
        if (!IsSuperAdmin())
            return StatusCode(403, new { message = "Only SuperAdmin can delete clubs." });

        var existing = await _clubService.GetByIdAsync(id);
        if (existing == null)
            return NotFound(new { message = "Club not found" });

        await _clubService.DeleteAsync(id, GetCurrentMemberId());
        await _auditLog.LogAsync(GetCurrentMemberId(), "DELETE", "club", id, existing.ClubName, null, HttpContext);
        return NoContent();
    }

    [HttpPost("{id}/members")]
    public async Task<ActionResult<object>> AddMember(int id, [FromBody] AddClubMemberDto dto)
    {
        if (!IsSuperAdmin())
            return StatusCode(403, new { message = "Only SuperAdmin can add members to clubs." });

        var club = await _clubService.GetByIdAsync(id);
        if (club == null)
            return NotFound(new { message = "Club not found" });

        try
        {
            var memberId = await _clubService.AddMemberAsync(id, dto, GetCurrentMemberId());
            return Ok(new { id = memberId });
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            return Conflict(new { message = ex.Message });
        }
    }

    [HttpDelete("{id}/members/{memberId}")]
    public async Task<ActionResult> RemoveMember(int id, int memberId, [FromQuery] string? reason = null, [FromQuery] string? reasonCode = null)
    {
        if (!IsSuperAdminOrAdmin())
            return StatusCode(403, new { message = "Only SuperAdmin or Club Admin can remove members from clubs." });

        var club = await _clubService.GetByIdAsync(id);
        if (club == null)
            return NotFound(new { message = "Club not found" });

        await using (var conn = new MySqlConnector.MySqlConnection(_connectionString))
            if (!await RiCodes.IsValidAsync(conn, "termination_reason", reasonCode))
                return BadRequest(new { message = "Pick a termination reason from the RI list." });
        await _clubService.RemoveMemberAsync(id, memberId, GetCurrentMemberId(), reason, reasonCode);
        return NoContent();
    }

    // Returns what will be deleted across all modules if this member is removed from this club.
    // Frontend calls this BEFORE the actual delete to show a confirmation popup.
    [HttpGet("{id}/members/{memberId}/removal-preview")]
    public async Task<ActionResult<MemberRemovalPreviewDto>> GetRemovalPreview(int id, int memberId)
    {
        if (!IsSuperAdminOrAdmin())
            return StatusCode(403, new { message = "Only SuperAdmin or Club Admin can preview member removal." });

        var preview = await _clubService.GetMemberRemovalPreviewAsync(id, memberId);
        if (preview == null)
            return NotFound(new { message = "Member or club not found." });

        return Ok(preview);
    }

    [HttpPost("upload")]
    public async Task<ActionResult<object>> Upload(IFormFile file)
    {
        if (!IsSuperAdmin())
            return StatusCode(403, new { message = "Only SuperAdmin can upload club logos." });

        if (file == null || file.Length == 0)
            return BadRequest(new { message = "No file uploaded" });

        var allowedExtensions = new[] { ".jpg", ".jpeg", ".png", ".gif", ".webp" };
        var extension = Path.GetExtension(file.FileName).ToLower();
        if (!allowedExtensions.Contains(extension))
            return BadRequest(new { message = "Invalid file type. Allowed: jpg, jpeg, png, gif, webp" });

        if (file.Length > 5 * 1024 * 1024)
            return BadRequest(new { message = "File size must be less than 5MB" });

        var path = await _clubService.UploadLogoAsync(file);
        return Ok(new { path });
    }

    // ── Logos (Club + Rotary) — used by /clubs/{id}/website-data/logos ──
    // Two separate logo URLs per club, stored on club_master so the Club Logo
    // edited here automatically matches the Club Logo on the club add/edit page
    // (same column). Rotary Logo is a NEW per-club image — not the standard
    // Rotary International mark, but the club's branded variant.
    //
    // Upload flow: frontend POSTs the file bytes to /api/clubs/upload (existing
    // endpoint, returns a filename), then PUTs the filename here via setLogos.
    // We never receive the file bytes on this endpoint — only the saved filename.

    public class ClubLogosDto
    {
        public string? ClubLogoUrl   { get; set; }
        public string? RotaryLogoUrl { get; set; }
    }

    public class SetClubLogosDto
    {
        // Either field optional — null means "leave unchanged", empty string means "clear".
        public string? ClubLogoPath   { get; set; }
        public string? RotaryLogoPath { get; set; }
    }

    [HttpGet("{id:int}/logos")]
    public async Task<ActionResult<ClubLogosDto>> GetLogos(int id)
    {
        var (clubLogo, rotaryLogo) = await _clubService.GetLogosAsync(id);
        return Ok(new ClubLogosDto
        {
            ClubLogoUrl   = BuildClubLogoUrl(clubLogo),
            RotaryLogoUrl = BuildRotaryLogoUrl(id, rotaryLogo),
        });
    }

    [HttpPut("{id:int}/logos")]
    public async Task<ActionResult> SetLogos(int id, [FromBody] SetClubLogosDto dto)
    {
        if (!IsSuperAdminOrAdmin())
            return StatusCode(403, new { message = "Access denied." });
        await _clubService.SetLogosAsync(id, dto.ClubLogoPath, dto.RotaryLogoPath, GetCurrentMemberId());
        return Ok(new { message = "Logos saved." });
    }

    // ── Per-logo upload endpoints (2026-06-25 per user) ─────────────────
    // Club logos go to /Documents/group/<file> — same folder legacy club
    // logos already live in. Edit on this page → reflects on club add/edit
    // page AND on the public website (one column, one folder).
    [HttpPost("{id:int}/upload-club-logo")]
    public async Task<ActionResult<object>> UploadClubLogo(int id, IFormFile file)
    {
        if (!IsSuperAdminOrAdmin())
            return StatusCode(403, new { message = "Access denied." });
        var (err, _) = ValidateImage(file);
        if (err != null) return BadRequest(new { message = err });

        var fileName = await _clubService.UploadClubLogoToGroupAsync(file);
        return Ok(new { path = fileName });
    }

    // Rotary logos go to /Documents/WebsiteData/Group{clubId}/LOGO/<file>.
    [HttpPost("{id:int}/upload-rotary-logo")]
    public async Task<ActionResult<object>> UploadRotaryLogo(int id, IFormFile file)
    {
        if (!IsSuperAdminOrAdmin())
            return StatusCode(403, new { message = "Access denied." });
        var (err, _) = ValidateImage(file);
        if (err != null) return BadRequest(new { message = err });

        var fileName = await _clubService.UploadRotaryLogoToGroupAsync(id, file);
        return Ok(new { path = fileName });
    }

    private static (string? Error, string? Ext) ValidateImage(IFormFile file)
    {
        if (file == null || file.Length == 0) return ("No file uploaded", null);
        var allowed = new[] { ".jpg", ".jpeg", ".png", ".gif", ".webp" };
        var ext = Path.GetExtension(file.FileName).ToLower();
        if (!allowed.Contains(ext)) return ("Invalid file type. Allowed: jpg, jpeg, png, gif, webp", null);
        if (file.Length > 5 * 1024 * 1024) return ("File size must be less than 5 MB", null);
        return (null, ext);
    }

    // Club logo URL builder. Stored values can be:
    //   • Full path "/Documents/group/xxx.png" or "/uploads/club/xxx.jpg" → use as-is
    //   • http(s):// absolute → use as-is
    //   • Bare filename like "club_logo_xyz.png" → land in /Documents/group/<file>
    //     (the new convention; legacy "/uploads/club/" callers are NOT affected
    //     because they would have stored a slash-prefixed path)
    private static string? BuildClubLogoUrl(string? stored)
    {
        if (string.IsNullOrWhiteSpace(stored)) return null;
        if (stored.StartsWith("http", StringComparison.OrdinalIgnoreCase)) return stored;
        if (stored.StartsWith("/")) return stored;
        return "/Documents/group/" + stored;
    }

    // Rotary logo URL builder — per-club folder convention.
    //   • Full path or URL → use as-is
    //   • Bare filename → /Documents/WebsiteData/Group{clubId}/LOGO/<file>
    private static string? BuildRotaryLogoUrl(int clubId, string? stored)
    {
        if (string.IsNullOrWhiteSpace(stored)) return null;
        if (stored.StartsWith("http", StringComparison.OrdinalIgnoreCase)) return stored;
        if (stored.StartsWith("/")) return stored;
        return $"/Documents/WebsiteData/Group{clubId}/LOGO/" + stored;
    }

    private bool IsSuperAdmin()
    {
        return User.FindFirst("roles")?.Value?.Contains("SuperAdmin") == true;
    }

    private bool IsSuperAdminOrAdmin()
    {
        var roles = User.FindFirst("roles")?.Value ?? string.Empty;
        return roles.Contains("SuperAdmin") || roles.Contains("Admin");
    }

    private int GetCurrentMemberId()
    {
        return int.Parse(User.FindFirst("memberId")?.Value ?? "0");
    }
}
