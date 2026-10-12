using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/clubs/{clubId}/ocv-gov")]
[Authorize]
public class OcvGovController : ControllerBase
{
    private readonly IOcvGovService _service;
    private readonly IWebHostEnvironment _env;
    private readonly string _connectionString;
    private readonly string? _mediaRedirectBase;
    private readonly string? _frontendUrl;
    private readonly string? _sofficePath;

    public OcvGovController(IOcvGovService service, IWebHostEnvironment env, IConfiguration configuration)
    {
        _service = service;
        _env = env;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _mediaRedirectBase = configuration["Media:RedirectBaseUrl"];
        _frontendUrl = configuration["FrontendUrl"];
        _sofficePath = configuration["LibreOffice:SofficePath"];
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");
    private string GetRoleName() => User.FindFirst("roleName")?.Value ?? "";

    // ── Categories ──────────────────────────────────────────────────────

    [HttpGet("categories")]
    public async Task<ActionResult> GetCategories(int clubId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var categories = await _service.GetCategoriesAsync();
        return Ok(categories);
    }

    // ── Document Types ──────────────────────────────────────────────────

    [HttpGet("document-types/{categoryId}")]
    public async Task<ActionResult> GetDocumentTypes(int clubId, int categoryId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var types = await _service.GetDocumentTypesAsync(categoryId);
        return Ok(types);
    }

    // ── Documents ───────────────────────────────────────────────────────

    [HttpGet("documents/{categoryId}")]
    public async Task<ActionResult> GetDocuments(int clubId, int categoryId, [FromQuery] int yearId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var documents = await _service.GetDocumentsAsync(clubId, yearId, categoryId);
        return Ok(documents);
    }

    [HttpPost("documents")]
    public async Task<ActionResult> UploadDocument(int clubId, [FromForm] UploadOcvDocumentDto dto, IFormFile file)
    {
        if (file == null || file.Length == 0)
            return BadRequest(new { message = "No file uploaded." });

        var allowedExtensions = new[] { ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".jpg", ".jpeg", ".png", ".gif" };
        var extension = System.IO.Path.GetExtension(file.FileName).ToLowerInvariant();
        if (!allowedExtensions.Contains(extension))
            return BadRequest(new { message = "Invalid file type. Allowed: PDF, DOC, DOCX, XLS, XLSX, JPG, JPEG, PNG, GIF" });

        if (file.Length > 20 * 1024 * 1024)
            return BadRequest(new { message = "File size must be less than 10MB." });

        try
        {
            var result = await _service.UploadDocumentAsync(clubId, dto, file, GetUserId(), _env);
            return Ok(result);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPut("documents/{documentId}")]
    public async Task<ActionResult> UpdateDocument(int clubId, int documentId, [FromForm] UpdateOcvDocumentDto dto, IFormFile? file)
    {
        if (file != null && file.Length > 0)
        {
            var allowedExtensions = new[] { ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".jpg", ".jpeg", ".png", ".gif" };
            var extension = System.IO.Path.GetExtension(file.FileName).ToLowerInvariant();
            if (!allowedExtensions.Contains(extension))
                return BadRequest(new { message = "Invalid file type. Allowed: PDF, DOC, DOCX, XLS, XLSX, JPG, JPEG, PNG, GIF" });
        }
        try
        {
            var result = await _service.UpdateDocumentAsync(clubId, documentId, dto, file, GetUserId(), _env);
            return Ok(result);
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { message = ex.Message });
        }
    }

    [HttpDelete("documents/{documentId}")]
    public async Task<ActionResult> DeleteDocument(int clubId, int documentId)
    {
        await _service.DeleteDocumentAsync(documentId, GetUserId());
        return Ok(new { message = "Document deleted successfully." });
    }

    /// <summary>
    /// Streams the document file with Content-Disposition: attachment so the browser
    /// always downloads (instead of previewing). Bypasses the static-file CORS issue —
    /// this is a controller route covered by app.UseCors().
    /// </summary>
    [HttpGet("documents/{documentId}/download")]
    public async Task<ActionResult> DownloadDocument(int clubId, int documentId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var info = await _service.GetDocumentFileAsync(clubId, documentId);
        if (info == null) return NotFound(new { message = "Document not found." });

        var (relPath, originalFileName) = info.Value;
        // Disk-first, then the configured media host (Media:RedirectBaseUrl) — the SAME loader the
        // OCV report uses to embed images. This lets the download work even when the file lives on
        // the live media server rather than this instance's local disk (e.g. running locally against
        // production data). Normalise to a leading-slash web path so the media-host URL is well-formed.
        var webPath = "/" + (relPath ?? "").Replace('\\', '/').TrimStart('/');
        var bytes = await CmrMediaLoader.LoadBytesAsync(_env, _mediaRedirectBase, webPath);
        if (bytes == null || bytes.Length == 0)
            return NotFound(new { message = "File not found." });

        // application/octet-stream + fileDownloadName forces Content-Disposition: attachment
        return File(bytes, "application/octet-stream",
            string.IsNullOrWhiteSpace(originalFileName) ? Path.GetFileName(webPath) : originalFileName);
    }

    // ── OCV Report ──────────────────────────────────────────────────────

    [HttpGet("report")]
    public async Task<ActionResult> GetOcvReport(int clubId, [FromQuery] int yearId, [FromQuery] string? status = "all")
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var report = await _service.GetOcvReportAsync(clubId, yearId, status);
        return Ok(report);
    }

    // Word (.docx) companion to the Excel checklist: uploaded documents grouped by category with
    // images embedded and every other file hyperlinked, plus Live Documents module snapshots and
    // newsletters.
    [HttpGet("report/word")]
    public async Task<ActionResult> GetOcvReportWord(int clubId, [FromQuery] int yearId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        if (yearId <= 0) return BadRequest(new { message = "yearId is required." });

        try
        {
            var data = await _service.GetOcvWordReportDataAsync(clubId, yearId);

            // Best-effort media load (disk-first, then the configured media host). Images embed as
            // pictures; PDFs are rasterised page-by-page and embedded inline. Anything unreadable
            // falls back to a labelled attachment entry in the doc.
            foreach (var d in data.Documents.Where(d => d.IsImage))
                d.ImageBytes = await CmrMediaLoader.LoadBytesAsync(_env, _mediaRedirectBase, d.FilePath);
            foreach (var d in data.Documents.Where(d => d.IsPdf))
                d.PdfBytes = await CmrMediaLoader.LoadBytesAsync(_env, _mediaRedirectBase, d.FilePath);

            // Office files (.doc/.docx/.xls/.xlsx): convert to PDF via LibreOffice headless (only
            // when soffice is installed), so the builder can snapshot the first page inline. When
            // LibreOffice is absent OfficeSnapshotPdfBytes stays null and the builder falls back to
            // a labelled entry — both cases still get the download link. Best-effort, never fatal.
            foreach (var d in data.Documents.Where(d => d.IsOfficeDoc))
            {
                var officeBytes = await CmrMediaLoader.LoadBytesAsync(_env, _mediaRedirectBase, d.FilePath);
                if (officeBytes is { Length: > 0 })
                    d.OfficeSnapshotPdfBytes = await OfficeToPdfConverter.TryConvertAsync(officeBytes, d.Extension ?? "", _sofficePath);
            }

            // Project images for the detailed Live Documents section — same disk-first, then
            // media-host loader as the uploaded documents. Best-effort: an unreadable image is
            // simply omitted from the report.
            foreach (var pm in data.ProjectModules)
                foreach (var pr in pm.Projects)
                    foreach (var img in pr.Images)
                        img.ImageBytes = await CmrMediaLoader.LoadBytesAsync(_env, _mediaRedirectBase, img.ImagePath);

            // The document-type checklist (Module / Document Type) shown as a summary table — the
            // SAME source the Excel report uses, so Word and Excel stay consistent.
            var reportItems = await _service.GetOcvReportAsync(clubId, yearId, "all");

            // Absolute base so the document links work wherever the .docx is opened.
            var mediaBase = !string.IsNullOrWhiteSpace(_mediaRedirectBase)
                ? _mediaRedirectBase!
                : $"{Request.Scheme}://{Request.Host}{Request.PathBase}";

            var bytes = OcvReportWordBuilder.BuildReport(data, reportItems, mediaBase);
            var fileName = $"OCV_Report_{data.ClubName}_{data.YearLabel}.docx"
                .Replace(" ", "_").Replace("/", "-");
            return File(bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", fileName);
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = $"Failed to generate Word report: {ex.Message}", detail = ex.InnerException?.Message });
        }
    }

    // Excel (.xls) checklist — an HTML-table workbook that exactly matches the legacy
    // example.org "OCVList….xls": header block, one row per document-type across ALL
    // categories with a "Download Here" hyperlink to the API download URL for uploaded docs,
    // then Live Documents and Newsletters sections. Full report — page filters do not narrow it.
    [HttpGet("report/excel")]
    public async Task<ActionResult> GetOcvReportExcel(int clubId, [FromQuery] int yearId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        if (yearId <= 0) return BadRequest(new { message = "yearId is required." });

        try
        {
            var header = await _service.GetOcvWordReportDataAsync(clubId, yearId);
            var items = await _service.GetOcvReportAsync(clubId, yearId, "all");

            // API base for the controller download route (documents/{id}/download).
            var apiBase = $"{Request.Scheme}://{Request.Host}{Request.PathBase}";
            // Media host for newsletter attachments (falls back to the API base when unset).
            var mediaBase = !string.IsNullOrWhiteSpace(_mediaRedirectBase) ? _mediaRedirectBase! : apiBase;
            var frontendBase = _frontendUrl ?? "";

            var bytes = OcvReportExcelBuilder.Build(header, items, clubId, yearId, apiBase, mediaBase, frontendBase);
            var fileName = $"OCV_Report_{header.ClubName}_{DateTime.Now:yyyy-MM-dd_HH-mm-ss}.xls"
                .Replace(" ", "_").Replace("/", "-");
            return File(bytes, "application/vnd.ms-excel", fileName);
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = $"Failed to generate Excel report: {ex.Message}", detail = ex.InnerException?.Message });
        }
    }

    // Live Documents module snapshots as JSON — the SAME OcvWordModuleTable list the Word
    // report renders, so the Excel export can reproduce that section table-for-table and
    // cell-for-cell instead of maintaining its own module catalog. Uploaded documents,
    // photos and newsletters are not returned: the Excel gets those from its own checklist.
    [HttpGet("report/live-tables")]
    public async Task<ActionResult> GetOcvReportLiveTables(int clubId, [FromQuery] int yearId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        if (yearId <= 0) return BadRequest(new { message = "yearId is required." });

        try
        {
            var data = await _service.GetOcvWordReportDataAsync(clubId, yearId);
            return Ok(data.LiveTables.Select(t => new
            {
                label = t.Label,
                headers = t.Headers,
                rows = t.Rows,
            }));
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = $"Failed to load live documents: {ex.Message}" });
        }
    }

    // ── Settings (SuperAdmin only) ──────────────────────────────────────

    [HttpPost("settings/document-types")]
    public async Task<ActionResult> CreateDocumentType(int clubId, [FromBody] CreateOcvDocumentTypeDto dto)
    {
        if (GetRoleName() != "SuperAdmin")
            return Forbid();

        var result = await _service.CreateDocumentTypeAsync(dto);
        return Ok(result);
    }

    [HttpPut("settings/document-types/{typeId}")]
    public async Task<ActionResult> UpdateDocumentType(int clubId, int typeId, [FromBody] UpdateOcvDocumentTypeDto dto)
    {
        if (GetRoleName() != "SuperAdmin")
            return Forbid();

        await _service.UpdateDocumentTypeAsync(typeId, dto);
        return Ok(new { message = "Document type updated successfully." });
    }

    [HttpDelete("settings/document-types/{typeId}")]
    public async Task<ActionResult> DeleteDocumentType(int clubId, int typeId)
    {
        if (GetRoleName() != "SuperAdmin")
            return Forbid();

        await _service.DeleteDocumentTypeAsync(typeId);
        return Ok(new { message = "Document type deleted successfully." });
    }
}
