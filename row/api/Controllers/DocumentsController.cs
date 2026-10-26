using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Authorize]
public class DocumentsController : ControllerBase
{
    private readonly IDocumentService _service;
    private readonly string _connectionString;

    public DocumentsController(IDocumentService service, IConfiguration configuration)
    {
        _service = service;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    [HttpGet("api/clubs/{clubId}/documents")]
    public async Task<ActionResult> GetAll(int clubId, [FromQuery] string status = "", [FromQuery] string search = "", [FromQuery] int page = 1, [FromQuery] int pageSize = 10)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var (items, totalCount) = await _service.GetAllAsync(clubId, status, search, page, pageSize);
        return Ok(new { items, totalCount });
    }

    [HttpGet("api/clubs/{clubId}/documents/{id}")]
    public async Task<ActionResult<DocumentDetailDto>> GetById(int clubId, int id)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _service.GetByIdAsync(id);
        if (result == null) return NotFound(new { message = "Document not found." });
        return Ok(result);
    }

    [HttpPost("api/clubs/{clubId}/documents")]
    public async Task<ActionResult> Create(int clubId, [FromBody] CreateDocumentDto dto)
    {
        var id = await _service.CreateAsync(clubId, dto, GetUserId());
        return Ok(new { id });
    }

    [HttpPut("api/clubs/{clubId}/documents/{id}")]
    [OwnedBy(Owns.ClubDocument, "id", "clubId")]
    public async Task<ActionResult> Update(int clubId, int id, [FromBody] UpdateDocumentDto dto)
    {
        await _service.UpdateAsync(id, dto, GetUserId());
        return Ok(new { message = "Document updated successfully." });
    }

    [HttpDelete("api/clubs/{clubId}/documents/{id}")]
    [OwnedBy(Owns.ClubDocument, "id", "clubId")]
    public async Task<ActionResult> Delete(int clubId, int id)
    {
        await _service.DeleteAsync(id, GetUserId());
        return Ok(new { message = "Document deleted successfully." });
    }

    [HttpPost("api/clubs/{clubId}/documents/upload")]
    public async Task<ActionResult<object>> UploadFile(int clubId, IFormFile file)
    {
        if (file == null || file.Length == 0)
            return BadRequest(new { message = "No file uploaded" });

        var allowedExtensions = new[] { ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx" };
        var extension = System.IO.Path.GetExtension(file.FileName).ToLowerInvariant();
        if (!allowedExtensions.Contains(extension))
            return BadRequest(new { message = "Invalid file type. Allowed: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX" });

        if (file.Length > 20 * 1024 * 1024)
            return BadRequest(new { message = "File size must be less than 20 MB." });

        var (path, originalName) = await _service.UploadFileAsync(clubId, file);
        return Ok(new { path, originalName });
    }
}
