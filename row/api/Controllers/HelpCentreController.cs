using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Help centre (competitor gap 2026-11-19). Public reads under api/public/help for the ROW website, the app and the
/// admin's contextual Help link (published articles only, translated with ?lang=). Editing under api/help/admin is
/// Super Admin only; article bodies are sanitized on save and again after translation.
/// </summary>
[ApiController]
public class HelpCentreController : ControllerBase
{
    private readonly HelpCentreService _help;
    private readonly IAuditLogService _audit;

    public HelpCentreController(HelpCentreService help, IAuditLogService audit)
    {
        _help = help;
        _audit = audit;
    }

    public record FeedbackDto(bool Helpful);

    private bool IsSuperAdmin => UserPermissionHelper.IsSuperAdmin(User);
    private int Me => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;
    private ObjectResult SuperAdminOnly() => StatusCode(403, new { message = "Super Admin only." });

    // ── Public ─────────────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Categories with published articles, and the articles (all, or those matching q and/or category).</summary>
    [HttpGet("api/public/help")]
    [AllowAnonymous]
    [EnableRateLimiting("public-read")]
    public async Task<IActionResult> Index([FromQuery] string? q, [FromQuery] string? category, [FromQuery] string? lang)
    {
        if (q?.Length > 200) return BadRequest(new { message = "Search is 200 characters at most." });
        return Ok(await _help.PublicIndexAsync(lang, q, category));
    }

    [HttpGet("api/public/help/articles/{slug}")]
    [AllowAnonymous]
    [EnableRateLimiting("public-read")]
    public async Task<IActionResult> Article(string slug, [FromQuery] string? lang)
    {
        if (!HelpCentreService.ValidSlug(slug)) return NotFound(new { message = "Article not found." });
        var a = await _help.PublicArticleAsync(slug, lang);
        return a == null ? NotFound(new { message = "Article not found." }) : Ok(a);
    }

    /// <summary>"Was this helpful?" Counted per press; the rate limit keeps one visitor from skewing it much.</summary>
    [HttpPost("api/public/help/articles/{slug}/feedback")]
    [AllowAnonymous]
    [EnableRateLimiting("public-form")]
    public async Task<IActionResult> Feedback(string slug, [FromBody] FeedbackDto dto)
    {
        if (!HelpCentreService.ValidSlug(slug) || !await _help.FeedbackAsync(slug, dto.Helpful))
            return NotFound(new { message = "Article not found." });
        return Ok(new { recorded = true });
    }

    /// <summary>The published article for an admin page path (longest matching context path), or article = null.</summary>
    [HttpGet("api/public/help/context")]
    [AllowAnonymous]
    [EnableRateLimiting("public-read")]
    public async Task<IActionResult> Context([FromQuery] string? path, [FromQuery] string? lang)
    {
        if (string.IsNullOrWhiteSpace(path) || path.Length > 300 || path[0] != '/') return BadRequest(new { message = "Give the page path." });
        return Ok(new { article = await _help.ContextAsync(path, lang) });
    }

    // ── Super Admin ────────────────────────────────────────────────────────────────────────────────────────────

    [HttpGet("api/help/admin/categories")]
    [Authorize]
    public async Task<IActionResult> Categories()
    {
        if (!IsSuperAdmin) return SuperAdminOnly();
        return Ok(await _help.CategoriesAsync());
    }

    [HttpPost("api/help/admin/categories")]
    [Authorize]
    public Task<IActionResult> CreateCategory([FromBody] HelpCentreService.CategoryInput dto) => SaveCategory(null, dto);

    [HttpPut("api/help/admin/categories/{id:int}")]
    [Authorize]
    public Task<IActionResult> UpdateCategory(int id, [FromBody] HelpCentreService.CategoryInput dto) => SaveCategory(id, dto);

    private async Task<IActionResult> SaveCategory(int? id, HelpCentreService.CategoryInput dto)
    {
        if (!IsSuperAdmin) return SuperAdminOnly();
        var (clean, error) = HelpCentreService.Validate(dto);
        if (clean == null) return BadRequest(new { message = error });
        if (id is int existing && !await _help.CategoryExistsAsync(existing)) return NotFound(new { message = "Category not found." });
        var saved = await _help.SaveCategoryAsync(id, clean);
        if (saved == null) return Conflict(new { message = "Another category already uses that web address." });
        await _audit.LogAsync(Me, id == null ? "Create" : "Update", "HelpCategory", saved, clean.Name, null, HttpContext);
        return Ok(new { id = saved });
    }

    [HttpDelete("api/help/admin/categories/{id:int}")]
    [Authorize]
    public async Task<IActionResult> DeleteCategory(int id)
    {
        if (!IsSuperAdmin) return SuperAdminOnly();
        if (!await _help.CategoryExistsAsync(id)) return NotFound(new { message = "Category not found." });
        if (!await _help.DeleteCategoryAsync(id)) return Conflict(new { message = "Move or delete its articles first." });
        await _audit.LogAsync(Me, "Delete", "HelpCategory", id, null, null, HttpContext);
        return Ok(new { deleted = true });
    }

    [HttpGet("api/help/admin/articles")]
    [Authorize]
    public async Task<IActionResult> Articles([FromQuery] string? q, [FromQuery] string? status)
    {
        if (!IsSuperAdmin) return SuperAdminOnly();
        if (q?.Length > 200) return BadRequest(new { message = "Search is 200 characters at most." });
        return Ok(await _help.ArticlesAsync(q, status));
    }

    [HttpGet("api/help/admin/articles/{id:int}")]
    [Authorize]
    public async Task<IActionResult> GetArticle(int id)
    {
        if (!IsSuperAdmin) return SuperAdminOnly();
        var a = await _help.ArticleAsync(id);
        return a == null ? NotFound(new { message = "Article not found." }) : Ok(a);
    }

    [HttpPost("api/help/admin/articles")]
    [Authorize]
    public Task<IActionResult> CreateArticle([FromBody] HelpCentreService.ArticleInput dto) => SaveArticle(null, dto);

    [HttpPut("api/help/admin/articles/{id:int}")]
    [Authorize]
    public Task<IActionResult> UpdateArticle(int id, [FromBody] HelpCentreService.ArticleInput dto) => SaveArticle(id, dto);

    private async Task<IActionResult> SaveArticle(int? id, HelpCentreService.ArticleInput dto)
    {
        if (!IsSuperAdmin) return SuperAdminOnly();
        var (clean, error) = HelpCentreService.Validate(dto);
        if (clean == null) return BadRequest(new { message = error });
        if (!await _help.CategoryExistsAsync(clean.CategoryId)) return BadRequest(new { message = "Pick a category." });
        if (id is int existing && await _help.ArticleAsync(existing) == null) return NotFound(new { message = "Article not found." });
        var saved = await _help.SaveArticleAsync(id, clean, Me);
        if (saved == null) return Conflict(new { message = "Another article already uses that web address." });
        await _audit.LogAsync(Me, id == null ? "Create" : "Update", "HelpArticle", saved, clean.Title, new { clean.Status }, HttpContext);
        return Ok(new { id = saved, slug = clean.Slug });
    }

    [HttpDelete("api/help/admin/articles/{id:int}")]
    [Authorize]
    public async Task<IActionResult> DeleteArticle(int id)
    {
        if (!IsSuperAdmin) return SuperAdminOnly();
        if (!await _help.DeleteArticleAsync(id)) return NotFound(new { message = "Article not found." });
        await _audit.LogAsync(Me, "Delete", "HelpArticle", id, null, null, HttpContext);
        return Ok(new { deleted = true });
    }
}
