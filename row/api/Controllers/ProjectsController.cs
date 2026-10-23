using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

// Year-wise project endpoints. Routes that target a specific project now carry yearId
// alongside the id, because each year-wise table starts its PK at 1 — the id alone is
// ambiguous (PK=5 could exist in 2024_25 AND 2025_26 as two different projects).
[ApiController]
[Authorize]
public class ProjectsController : ControllerBase
{
    private readonly IProjectService _service;
    private readonly string _connectionString;
    private readonly IClubSiteCachePurger _purger;

    public ProjectsController(IProjectService service, IConfiguration configuration, IClubSiteCachePurger purger)
    {
        _service = service;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _purger = purger;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    [HttpGet("api/clubs/{clubId}/projects")]
    public async Task<ActionResult<PagedResult<ProjectListDto>>> GetByClub(
        int clubId,
        [FromQuery] int moduleId,
        [FromQuery] int yearId,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        [FromQuery] string? search = null,
        [FromQuery] string? projectType = null)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _service.GetByClubAsync(clubId, moduleId, yearId, page, pageSize, search, projectType);
        return Ok(result);
    }

    [HttpGet("api/clubs/{clubId}/projects/{yearId}/{id}")]
    public async Task<ActionResult<ProjectDetailDto>> GetById(int clubId, int yearId, int id)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _service.GetByIdAsync(id, yearId, clubId);
        if (result == null) return NotFound(new { message = "Project not found." });
        return Ok(result);
    }

    [HttpPost("api/clubs/{clubId}/projects")]
    public async Task<ActionResult> Create(int clubId, [FromBody] CreateProjectDto dto)
    {
        if (dto.Photos == null || dto.Photos.Count == 0)
            return BadRequest(new { message = "At least 1 photo is required to save this project." });

        // project_date decides the year-partitioned table, so a typo'd year creates a junk
        // rotary year that pollutes the public year filter. See Services/ProjectDateValidator.
        var dateError = ProjectDateValidator.Validate(dto.ProjectDate);
        if (dateError != null) return BadRequest(new { message = dateError });

        var id = await _service.CreateAsync(clubId, dto, GetUserId());
        _purger.PurgeByClub(clubId);
        return Ok(new { id });
    }

    [HttpPut("api/clubs/{clubId}/projects/{yearId}/{id}")]
    public async Task<ActionResult> Update(int clubId, int yearId, int id, [FromBody] UpdateProjectDto dto)
    {
        if (dto.Photos == null || dto.Photos.Count == 0)
            return BadRequest(new { message = "At least 1 photo is required to save this project." });

        // Same year-table guard as Create. See Services/ProjectDateValidator.
        var dateError = ProjectDateValidator.Validate(dto.ProjectDate);
        if (dateError != null) return BadRequest(new { message = dateError });

        try
        {
            await _service.UpdateAsync(id, yearId, dto, GetUserId());
        }
        catch (RotaryApi.Services.CrossYearMoveRequiredException ex)
        {
            // Date now lands in a different rotary year. Don't update in place — tell the
            // frontend to confirm a cross-year move, which it triggers via the /move endpoint.
            return Conflict(new
            {
                requiresMove = true,
                fromYearId = ex.FromYearId,
                toYearId = ex.ToYearId,
                fromYearLabel = ex.FromYearLabel,
                toYearLabel = ex.ToYearLabel,
                message = $"This project's date moves it from {ex.FromYearLabel} to {ex.ToYearLabel}. " +
                          $"Move the project and its photos to {ex.ToYearLabel}? It will get a new ID there."
            });
        }

        _purger.PurgeByClub(clubId);
        return Ok(new { message = "Project updated successfully." });
    }

    // Cross-year move — called after the user confirms the dialog. The project (and its photos)
    // move from {yearId}'s tables to the year implied by dto.ProjectDate; it gets a new id there.
    // Returns the new location so the frontend can redirect.
    [HttpPost("api/clubs/{clubId}/projects/{yearId}/{id}/move")]
    public async Task<ActionResult> Move(int clubId, int yearId, int id, [FromBody] UpdateProjectDto dto)
    {
        if (dto.Photos == null || dto.Photos.Count == 0)
            return BadRequest(new { message = "At least 1 photo is required to save this project." });

        // The move target year comes from this date — same guard. See Services/ProjectDateValidator.
        var dateError = ProjectDateValidator.Validate(dto.ProjectDate);
        if (dateError != null) return BadRequest(new { message = dateError });

        try
        {
            var (newYearId, newId, newYearLabel) = await _service.MoveProjectAsync(id, yearId, dto, GetUserId());
            _purger.PurgeByClub(clubId);
            return Ok(new
            {
                message = $"Project moved to {newYearLabel} successfully.",
                newYearId,
                newId,
                newYearLabel
            });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpDelete("api/clubs/{clubId}/projects/{yearId}/{id}")]
    public async Task<ActionResult> Delete(int clubId, int yearId, int id)
    {
        await _service.DeleteAsync(id, yearId, GetUserId());
        _purger.PurgeByClub(clubId);
        return Ok(new { message = "Project deleted successfully." });
    }

    [HttpGet("api/clubs/{clubId}/projects/years")]
    public async Task<ActionResult<List<ProjectYearDto>>> GetYears(int clubId, [FromQuery] int moduleId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _service.GetYearsAsync(clubId, moduleId);
        return Ok(result);
    }

    [HttpGet("api/clubs/{clubId}/projects/ongoing")]
    public async Task<ActionResult<List<OngoingProjectDto>>> GetOngoing(
        int clubId,
        [FromQuery] int moduleId,
        [FromQuery] string? search = null,
        [FromQuery] int? yearId = null)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _service.GetOngoingAsync(clubId, moduleId, search, yearId);
        return Ok(result);
    }

    [HttpPost("api/clubs/{clubId}/projects/upload")]
    public async Task<ActionResult<object>> UploadImage(int clubId, IFormFile file, [FromQuery] int? projectId = null, [FromQuery] int? yearId = null, [FromQuery] bool strict = false)
    {
        // The web frontend shrinks photos in the browser before upload; the mobile app
        // sends the raw photo, so a large capture would fail the 5 MB size guard below.
        // Compress oversized images to ≤5 MB server-side FIRST (already-small uploads —
        // the web path — pass through untouched), so mobile behaves like web.
        file = RotaryApi.Services.ImageCompressor.EnsureWithinLimit(file);

        var v = RotaryApi.Services.ImageQualityValidator.Validate(file, strict);
        if (!v.Ok) return BadRequest(new { message = v.Error });

        var path = await _service.UploadImageAsync(file, clubId, projectId, yearId);
        return Ok(new { path, width = v.Width, height = v.Height, sizeBytes = v.SizeBytes });
    }

    [HttpPost("api/clubs/{clubId}/projects/upload-document")]
    public async Task<ActionResult<object>> UploadDocument(int clubId, IFormFile file)
    {
        if (file == null || file.Length == 0)
            return BadRequest(new { message = "No file uploaded." });

        // Club Service Agenda / Minutes pages (web + mobile) also allow PNG / JPEG scans — keep in parity.
        var allowedExtensions = new[] { ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".png", ".jpg", ".jpeg" };
        var extension = Path.GetExtension(file.FileName).ToLower();
        if (!allowedExtensions.Contains(extension))
            return BadRequest(new { message = "Invalid file type. Allowed: pdf, doc, docx, xls, xlsx, ppt, pptx, txt, png, jpg, jpeg" });

        if (file.Length > 20 * 1024 * 1024)
            return BadRequest(new { message = "File size must be less than 10MB." });

        var path = await _service.UploadDocumentAsync(file, clubId);
        return Ok(new { path });
    }

    [HttpPost("api/clubs/{clubId}/projects/{yearId}/{id}/photos")]
    public async Task<ActionResult> AddPhoto(int clubId, int yearId, int id, [FromBody] ProjectPhotoInput dto)
    {
        var photoId = await _service.AddPhotoAsync(id, yearId, dto.ImagePath, dto.Description, dto.IsPrimary, dto.SortOrder);
        return Ok(new { id = photoId });
    }

    [HttpDelete("api/clubs/{clubId}/projects/{yearId}/{projectId}/photos/{photoId}")]
    public async Task<ActionResult> DeletePhoto(int clubId, int yearId, int projectId, int photoId)
    {
        await _service.DeletePhotoAsync(photoId, yearId);
        return Ok(new { message = "Photo deleted successfully." });
    }

    [HttpPut("api/clubs/{clubId}/projects/{yearId}/{projectId}/photos/{photoId}/primary")]
    public async Task<ActionResult> SetPrimaryPhoto(int clubId, int yearId, int projectId, int photoId)
    {
        await _service.SetPrimaryPhotoAsync(projectId, photoId, yearId);
        return Ok(new { message = "Primary photo set successfully." });
    }

    // Public endpoint (no auth, with caching)
    [AllowAnonymous]
    [ResponseCache(Duration = 120)]
    [HttpGet("api/public/clubs/{clubId}/projects")]
    public async Task<ActionResult<PagedResult<ProjectPublicDto>>> GetPublic(
        int clubId,
        [FromQuery] int moduleId,
        [FromQuery] int yearId,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _service.GetPublicAsync(clubId, moduleId, yearId, page, pageSize);
        return Ok(result);
    }
}
