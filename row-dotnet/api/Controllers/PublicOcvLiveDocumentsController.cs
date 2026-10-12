using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// PUBLIC (no-login) view of a single OCV "Live Documents" project avenue for one club + year.
/// Linked from the OCV Excel report's Live Documents section (each project-type module's
/// "Download here"). Read-only, scoped strictly to (clubId, yearId, moduleKey), and gated by the
/// same club -> district -> zone active kill-switch the public site uses.
///
///   GET /api/public/ocv-live-documents?clubId=&yearId=&moduleKey=       -> JSON { header, projects[] }
///   GET /api/public/ocv-live-documents/word?clubId=&yearId=&moduleKey=  -> module-scoped .docx
///
/// Reuses the exact project + image loading written for the OCV Word report
/// (OcvGovService.GetOcvWordReportDataAsync -> OcvWordReportData.ProjectModules); no new data access.
/// </summary>
[ApiController]
[Route("api/public/ocv-live-documents")]
[AllowAnonymous]
[EnableCors("PublicOpen")]
public class PublicOcvLiveDocumentsController : ControllerBase
{
    private readonly IOcvGovService _service;
    private readonly IWebHostEnvironment _env;
    private readonly string _connectionString;
    private readonly string? _mediaRedirectBase;

    public PublicOcvLiveDocumentsController(IOcvGovService service, IWebHostEnvironment env, IConfiguration configuration)
    {
        _service = service;
        _env = env;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _mediaRedirectBase = configuration["Media:RedirectBaseUrl"];
    }

    // The six project avenues (rendered as projects with photos). Keys match module_master.ModuleKey.
    private static readonly HashSet<string> ProjectModuleKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        "community_service", "vocational_service", "international_service",
        "new_generation_service", "public_image_initiative", "club_service",
    };

    // The seven table modules (rendered as the Word report's live table — headers + rows).
    private static readonly HashSet<string> TableModuleKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        "announcements", "upcoming_events", "documents", "attendance",
        "board_of_directors", "members", "trf_contributions",
    };

    private const string NewslettersKey = "newsletters";

    // Every moduleKey the public page understands.
    private static bool IsKnownModule(string key) =>
        ProjectModuleKeys.Contains(key) || TableModuleKeys.Contains(key) ||
        string.Equals(key, NewslettersKey, StringComparison.OrdinalIgnoreCase);

    // Absolute base for image URLs so a logged-out browser can load them directly. Same resolution
    // the report uses: the configured media host, else this request's scheme/host/pathbase.
    private string MediaBase() => !string.IsNullOrWhiteSpace(_mediaRedirectBase)
        ? _mediaRedirectBase!.TrimEnd('/')
        : $"{Request.Scheme}://{Request.Host}{Request.PathBase}".TrimEnd('/');

    private static string AbsUrl(string mediaBase, string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return "";
        if (path.StartsWith("http", StringComparison.OrdinalIgnoreCase)) return path;
        return path.StartsWith("/") ? mediaBase + path : mediaBase + "/" + path;
    }

    private object HeaderObj(OcvWordReportData data, string moduleKey, string moduleLabel) => new
    {
        clubName = data.ClubName,
        clubDisplayName = string.IsNullOrWhiteSpace(data.ClubName) ? "Rotary Club" :
            data.ClubName.StartsWith("Rotary", StringComparison.OrdinalIgnoreCase) ? data.ClubName : $"Rotary Club of {data.ClubName}",
        zoneName = data.ZoneName,
        districtNumber = data.DistrictNumber,
        clubRotaryId = data.ClubRotaryId,
        presidentName = data.PresidentName,
        assistantGovernorName = data.AssistantGovernorName,
        yearLabel = data.YearLabel,
        generatedAt = DateTime.Now.ToString("dd MMM yyyy HH:mm"),
        moduleKey,
        moduleLabel,
    };

    // ── JSON: header + the module's content (projects | table | newsletters) ───
    [HttpGet]
    public async Task<ActionResult> GetModule([FromQuery] int clubId, [FromQuery] int yearId, [FromQuery] string? moduleKey)
    {
        if (clubId <= 0 || yearId <= 0 || string.IsNullOrWhiteSpace(moduleKey))
            return BadRequest(new { message = "clubId, yearId and moduleKey are required." });
        if (!IsKnownModule(moduleKey!))
            return BadRequest(new { message = "Unknown module." });
        if (!await KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId))
            return NotFound(new { message = "Not available." });

        var data = await _service.GetOcvWordReportDataAsync(clubId, yearId);
        var mediaBase = MediaBase();

        // Project avenue → projects with photos.
        if (ProjectModuleKeys.Contains(moduleKey!))
        {
            var module = data.ProjectModules.FirstOrDefault(m => string.Equals(m.ModuleKey, moduleKey, StringComparison.OrdinalIgnoreCase));
            if (module is null) return NotFound(new { message = "Not available." });
            return Ok(new
            {
                kind = "projects",
                header = HeaderObj(data, module.ModuleKey, module.Label),
                projects = module.Projects.Select(p => new
                {
                    title = p.Title,
                    description = p.Description,
                    fields = p.Fields.Select(f => new { label = f.Label, value = f.Value }),
                    images = p.Images.Select(im => new { url = AbsUrl(mediaBase, im.ImagePath), caption = im.Caption }),
                }),
            });
        }

        // Newsletters → list with meta + open link.
        if (string.Equals(moduleKey, NewslettersKey, StringComparison.OrdinalIgnoreCase))
        {
            return Ok(new
            {
                kind = "newsletters",
                header = HeaderObj(data, NewslettersKey, "Newsletters"),
                newsletters = data.Newsletters.Select(n => new
                {
                    title = n.Title,
                    publishDate = n.PublishDate?.ToString("dd MMM yyyy"),
                    attachmentType = n.AttachmentType,
                    status = n.Status,
                    url = AbsUrl(mediaBase, !string.IsNullOrWhiteSpace(n.FilePath) ? n.FilePath : n.LinkUrl),
                }),
            });
        }

        // Table module → the live table's headers + rows.
        var table = data.LiveTables.FirstOrDefault(t => string.Equals(t.ModuleKey, moduleKey, StringComparison.OrdinalIgnoreCase));
        if (table is null) return NotFound(new { message = "Not available." });
        return Ok(new
        {
            kind = "table",
            header = HeaderObj(data, table.ModuleKey, table.Label),
            table = new { headers = table.Headers, rows = table.Rows },
        });
    }

    // ── Word (.docx): module-scoped download (projects | table | newsletters) ──
    [HttpGet("word")]
    public async Task<ActionResult> GetModuleWord([FromQuery] int clubId, [FromQuery] int yearId, [FromQuery] string? moduleKey)
    {
        if (clubId <= 0 || yearId <= 0 || string.IsNullOrWhiteSpace(moduleKey))
            return BadRequest(new { message = "clubId, yearId and moduleKey are required." });
        if (!IsKnownModule(moduleKey!))
            return BadRequest(new { message = "Unknown module." });
        if (!await KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId))
            return NotFound(new { message = "Not available." });

        try
        {
            var data = await _service.GetOcvWordReportDataAsync(clubId, yearId);

            // Resolve the display label + confirm the module has content to render.
            var projectModule = data.ProjectModules.FirstOrDefault(m => string.Equals(m.ModuleKey, moduleKey, StringComparison.OrdinalIgnoreCase));
            var tableModule = data.LiveTables.FirstOrDefault(t => string.Equals(t.ModuleKey, moduleKey, StringComparison.OrdinalIgnoreCase));
            var isNewsletters = string.Equals(moduleKey, NewslettersKey, StringComparison.OrdinalIgnoreCase);
            if (projectModule is null && tableModule is null && !isNewsletters)
                return NotFound(new { message = "Not available." });
            var moduleLabel = projectModule?.Label ?? tableModule?.Label ?? "Newsletters";

            // Image bytes are only needed for project modules (their projects embed photos).
            if (projectModule is not null)
                foreach (var pr in projectModule.Projects)
                    foreach (var img in pr.Images)
                        img.ImageBytes = await CmrMediaLoader.LoadBytesAsync(_env, _mediaRedirectBase, img.ImagePath);

            var bytes = OcvReportWordBuilder.BuildModuleReport(data, moduleKey!, MediaBase());
            var fileName = $"OCV_{moduleLabel}_{data.ClubName}_{data.YearLabel}.docx"
                .Replace(" ", "_").Replace("/", "-");
            return File(bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", fileName);
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = $"Failed to generate Word report: {ex.Message}" });
        }
    }
}
