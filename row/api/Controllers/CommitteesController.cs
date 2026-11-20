using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Enhanced committees (gap agent): subcommittee tree, committee-private documents and committee email.
/// {kind} is "club" (sub group) or "district" (district committee). Kept outside api/clubs|districts/{id} on purpose:
/// committee members who are not club managers write here (documents, messages), so every action checks the caller
/// against the committee itself (CommitteeService.AccessAsync); no access and no such committee both answer 404.
/// Platform switch "committees" (FeatureGate).
/// </summary>
[ApiController]
[Authorize]
[Route("api/committees")]
public class CommitteesController : ControllerBase
{
    private readonly CommitteeService _service;

    public CommitteesController(CommitteeService service) => _service = service;

    private int CallerId() => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    private static NotFoundObjectResult Missing() => new(new { message = "Committee not found." });

    /// <summary>The caller's own committees (club and district), newest year first.</summary>
    [HttpGet("mine")]
    public async Task<IActionResult> Mine() => Ok(await _service.MineAsync(CallerId()));

    /// <summary>Every committee of a club or district in one year with parent ids: managers only.</summary>
    [HttpGet("tree")]
    public async Task<IActionResult> Tree([FromQuery] string kind, [FromQuery] int scopeId, [FromQuery] int yearId)
    {
        if (!CommitteeService.ValidKind(kind) || scopeId <= 0 || yearId <= 0)
            return BadRequest(new { message = "kind (club or district), scopeId and yearId are required." });
        if (!await _service.ManagesAsync(kind, scopeId, CallerId()))
            return StatusCode(403, new { message = "You do not manage this club or district." });
        return Ok(await _service.TreeAsync(kind, scopeId, yearId));
    }

    [HttpGet("{kind}/{id:int}")]
    public async Task<IActionResult> Detail(string kind, int id)
    {
        var access = await _service.AccessAsync(kind, id, CallerId());
        return access == null ? Missing() : Ok(await _service.DetailAsync(access));
    }

    public sealed class ParentBody
    {
        public int? ParentId { get; set; }
    }

    [HttpPut("{kind}/{id:int}/parent")]
    public async Task<IActionResult> SetParent(string kind, int id, [FromBody] ParentBody body)
    {
        var access = await _service.AccessAsync(kind, id, CallerId());
        if (access == null) return Missing();
        if (!access.CanManage) return StatusCode(403, new { message = "Only the club's or district's managers can move committees." });
        var error = await _service.SetParentAsync(access.Committee, body.ParentId, CallerId(), HttpContext);
        return error == null ? Ok(new { message = "Committee moved." }) : BadRequest(new { message = error });
    }

    // ===== Documents =====

    [HttpGet("{kind}/{id:int}/documents")]
    public async Task<IActionResult> Documents(string kind, int id)
    {
        var access = await _service.AccessAsync(kind, id, CallerId());
        return access == null ? Missing() : Ok(await _service.DocumentsAsync(access, CallerId()));
    }

    public sealed class UploadForm
    {
        public string? Title { get; set; }
        public IFormFile? File { get; set; }
    }

    [HttpPost("{kind}/{id:int}/documents")]
    [RequestSizeLimit(CommitteeService.MaxFileBytes + 1024 * 1024)]
    public async Task<IActionResult> Upload(string kind, int id, [FromForm] UploadForm form)
    {
        var access = await _service.AccessAsync(kind, id, CallerId());
        if (access == null) return Missing();
        var (docId, error) = await _service.UploadAsync(access, form.Title, form.File, CallerId(), HttpContext);
        return error == null ? Ok(new { id = docId }) : BadRequest(new { message = error });
    }

    [HttpGet("{kind}/{id:int}/documents/{documentId:int}/file")]
    public async Task<IActionResult> Download(string kind, int id, int documentId)
    {
        var access = await _service.AccessAsync(kind, id, CallerId());
        if (access == null) return Missing();
        var file = await _service.FileAsync(access, documentId);
        if (file == null) return NotFound(new { message = "Document not found." });
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        Response.Headers["Cache-Control"] = "private, no-store";
        return PhysicalFile(file.Value.Path, file.Value.ContentType, file.Value.Name);
    }

    [HttpDelete("{kind}/{id:int}/documents/{documentId:int}")]
    public async Task<IActionResult> DeleteDocument(string kind, int id, int documentId)
    {
        var access = await _service.AccessAsync(kind, id, CallerId());
        if (access == null) return Missing();
        return await _service.DeleteDocumentAsync(access, documentId, CallerId(), HttpContext)
            ? Ok(new { message = "Document removed." })
            : NotFound(new { message = "Document not found, or you did not upload it." });
    }

    // ===== Messages =====

    [HttpGet("{kind}/{id:int}/messages")]
    public async Task<IActionResult> Messages(string kind, int id)
    {
        var access = await _service.AccessAsync(kind, id, CallerId());
        return access == null ? Missing() : Ok(await _service.MessagesAsync(access));
    }

    public sealed class MessageBody
    {
        public string? Subject { get; set; }
        public string? Body { get; set; }
    }

    [HttpPost("{kind}/{id:int}/messages")]
    public async Task<IActionResult> Send(string kind, int id, [FromBody] MessageBody body)
    {
        var access = await _service.AccessAsync(kind, id, CallerId());
        if (access == null) return Missing();
        var (messageId, error) = await _service.SendMessageAsync(access, body.Subject, body.Body, CallerId(), HttpContext);
        return error == null ? Ok(new { id = messageId }) : BadRequest(new { message = error });
    }
}
