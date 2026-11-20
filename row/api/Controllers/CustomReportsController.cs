using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Custom report builder (Services/CustomReportService.cs). Club routes need someone who manages the club, district
/// routes someone who manages the district, for reads too: ScopeWriteGuardMiddleware lets any member read club and
/// district routes, and these reports carry members' contact details.
/// </summary>
[ApiController]
[Authorize]
public class CustomReportsController : ControllerBase
{
    private const string Club = "api/clubs/{scopeId:int}/custom-reports";
    private const string District = "api/districts/{scopeId:int}/custom-reports";
    private readonly CustomReportService _reports;
    private readonly string _cs;

    public CustomReportsController(CustomReportService reports, IConfiguration configuration)
    {
        _reports = reports;
        _cs = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int MemberId => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;
    private bool IsClub => Request.Path.StartsWithSegments("/api/clubs", StringComparison.OrdinalIgnoreCase);

    private async Task<bool> ManagesAsync(int scopeId) =>
        MemberId > 0 && await ScopeWriteGuardMiddleware.AllowedAsync(_cs, MemberId, IsClub, scopeId);

    private ObjectResult Forbidden() => StatusCode(403, new { message = IsClub
        ? "Only the club's admins can use its reports."
        : "Only the district's admins can use its reports." });
    private NotFoundObjectResult Missing() => NotFound(new { message = "Report not found." });

    [HttpGet(Club + "/catalog"), HttpGet(District + "/catalog")]
    public async Task<IActionResult> Catalog(int scopeId)
    {
        if (!await ManagesAsync(scopeId)) return Forbidden();
        return Ok(await _reports.CatalogAsync());
    }

    [HttpGet(Club), HttpGet(District)]
    public async Task<IActionResult> List(int scopeId)
    {
        if (!await ManagesAsync(scopeId)) return Forbidden();
        return Ok(await _reports.ListAsync(IsClub, scopeId));
    }

    [HttpGet(Club + "/{id:int}"), HttpGet(District + "/{id:int}")]
    public async Task<IActionResult> Get(int scopeId, int id)
    {
        if (!await ManagesAsync(scopeId)) return Forbidden();
        var r = await _reports.GetAsync(IsClub, scopeId, id);
        return r == null ? Missing() : Ok(r);
    }

    [HttpPost(Club), HttpPost(District)]
    public async Task<IActionResult> Create(int scopeId, [FromBody] SaveCustomReportDto dto)
    {
        if (!await ManagesAsync(scopeId)) return Forbidden();
        var (id, problem) = await _reports.SaveAsync(IsClub, scopeId, null, dto, MemberId);
        return problem != null ? BadRequest(new { message = problem }) : Ok(new { id });
    }

    [HttpPut(Club + "/{id:int}"), HttpPut(District + "/{id:int}")]
    public async Task<IActionResult> Update(int scopeId, int id, [FromBody] SaveCustomReportDto dto)
    {
        if (!await ManagesAsync(scopeId)) return Forbidden();
        var (saved, problem) = await _reports.SaveAsync(IsClub, scopeId, id, dto, MemberId);
        if (problem != null) return BadRequest(new { message = problem });
        return saved == 0 ? Missing() : Ok(new { id });
    }

    [HttpDelete(Club + "/{id:int}"), HttpDelete(District + "/{id:int}")]
    public async Task<IActionResult> Delete(int scopeId, int id)
    {
        if (!await ManagesAsync(scopeId)) return Forbidden();
        return await _reports.DeleteAsync(IsClub, scopeId, id, MemberId) ? NoContent() : Missing();
    }

    /// <summary>Runs a definition (saved or not) and returns the rows.</summary>
    [HttpPost(Club + "/run"), HttpPost(District + "/run")]
    public async Task<IActionResult> Run(int scopeId, [FromBody] CustomReportDefinition definition)
    {
        if (!await ManagesAsync(scopeId)) return Forbidden();
        var (result, problem) = await _reports.RunAsync(IsClub, scopeId, definition);
        return result == null ? BadRequest(new { message = problem }) : Ok(result);
    }

    /// <summary>Runs a definition and returns it as an Excel, CSV or PDF file.</summary>
    [HttpPost(Club + "/export"), HttpPost(District + "/export")]
    public async Task<IActionResult> Export(int scopeId, [FromQuery] string format, [FromQuery] string? title, [FromBody] CustomReportDefinition definition)
    {
        if (!await ManagesAsync(scopeId)) return Forbidden();
        if (!CustomReportService.IsFormat(format)) return BadRequest(new { message = "Choose Excel, CSV or PDF." });
        var (result, problem) = await _reports.RunAsync(IsClub, scopeId, definition);
        if (result == null) return BadRequest(new { message = problem });
        var name = string.IsNullOrWhiteSpace(title) ? "Report" : title.Trim()[..Math.Min(title.Trim().Length, 150)];
        var (bytes, type, ext) = CustomReportService.Export(result, format, name);
        return File(bytes, type, $"{CustomReportService.FileName(name)}.{ext}");
    }

    /// <summary>Emails a saved report to the club's or district's officers now (the monthly schedule sends the same).</summary>
    [HttpPost(Club + "/{id:int}/send"), HttpPost(District + "/{id:int}/send")]
    public async Task<IActionResult> Send(int scopeId, int id)
    {
        if (!await ManagesAsync(scopeId)) return Forbidden();
        var (sent, problem) = await _reports.SendAsync(IsClub, scopeId, id);
        if (problem == "Report not found.") return Missing();
        return problem != null ? BadRequest(new { message = problem }) : Ok(new { sent });
    }
}
