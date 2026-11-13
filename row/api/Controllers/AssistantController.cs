using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.Services;
using RotaryApi.Services.Assistant;

namespace RotaryApi.Controllers;

// AI Assistant (ported from upstream 2026-11-09). Web-portal JWTs only, and only for members listed
// in assistant_users. Data access is decided per question by AssistantScopeBuilder - never by the
// token's roles claim. /api/assistant is skipped by AuditMiddleware; the assistant logs to its own tables.
[ApiController]
[Route("api/assistant")]
[Authorize]
public class AssistantController : ControllerBase
{
    private readonly AssistantSettings _settings;
    private readonly AssistantStore _store;
    private readonly AssistantOrchestrator _orchestrator;
    private readonly AssistantScopeBuilder _scopeBuilder;

    public AssistantController(AssistantSettings settings, AssistantStore store, AssistantOrchestrator orchestrator,
        AssistantScopeBuilder scopeBuilder)
    {
        _settings = settings;
        _store = store;
        _orchestrator = orchestrator;
        _scopeBuilder = scopeBuilder;
    }

    public sealed class ChatRequest
    {
        public long? ConversationId { get; set; }
        public string? Message { get; set; }
    }

    // memberId of a web session, or null for anything else: mobile tokens and RI Director secretary
    // sessions (whose token carries the director's memberId) are not allowed in.
    private int? WebMemberId()
    {
        if (User.FindFirst("loginType")?.Value == "mobile") return null;
        return int.TryParse(User.FindFirst("memberId")?.Value, out var id) && id > 0 ? id : null;
    }

    private string MemberName() => User.FindFirst("name")?.Value ?? User.FindFirst(ClaimTypes.Name)?.Value ?? "";

    [HttpGet("me")]
    public async Task<IActionResult> Me()
    {
        if (!_settings.Enabled) return Ok(new { allowed = false, reason = "The assistant is not switched on yet." });
        if (WebMemberId() is not int memberId) return Ok(new { allowed = false, reason = "Please sign in with your admin account." });
        await using var db = await _store.OpenAsync(HttpContext.RequestAborted);
        var user = await _store.GetActiveUserAsync(db, memberId);
        if (user == null) return Ok(new { allowed = false, reason = "Your account is not on the assistant's access list." });
        await using var ro = new MySqlConnector.MySqlConnection(_settings.ReadOnlyConnectionString);
        await ro.OpenAsync(HttpContext.RequestAborted);
        var scope = await _scopeBuilder.BuildAsync(ro, memberId, MemberName());
        return Ok(new
        {
            allowed = true,
            name = MemberName(),
            scope = scope.Describe(),
            questionsToday = await _store.QuestionsTodayAsync(db, memberId),
            dailyLimit = _store.DailyLimitFor(user),
            blockedUntil = user.BlockedUntil > DateTime.UtcNow ? user.BlockedUntil : null,
        });
    }

    [HttpGet("conversations")]
    public async Task<IActionResult> Conversations()
    {
        if (await AllowedMemberAsync() is not int memberId) return Forbid();
        await using var db = await _store.OpenAsync(HttpContext.RequestAborted);
        return Ok(await _store.ListConversationsAsync(db, memberId));
    }

    [HttpGet("conversations/{id:long}")]
    public async Task<IActionResult> Conversation(long id)
    {
        if (await AllowedMemberAsync() is not int memberId) return Forbid();
        await using var db = await _store.OpenAsync(HttpContext.RequestAborted);
        if (!await _store.OwnsConversationAsync(db, memberId, id)) return NotFound();
        return Ok(new { id, messages = await _store.GetMessagesAsync(db, id) });
    }

    [HttpDelete("conversations/{id:long}")]
    public async Task<IActionResult> DeleteConversation(long id)
    {
        if (await AllowedMemberAsync() is not int memberId) return Forbid();
        await using var db = await _store.OpenAsync(HttpContext.RequestAborted);
        return await _store.DeleteConversationAsync(db, memberId, id) ? NoContent() : NotFound();
    }

    // Server-sent events: meta, status, delta, answer_reset, done, error. All failures after the
    // stream starts are reported as an `error` event - the status line is already 200 by then.
    [HttpPost("chat")]
    public async Task Chat([FromBody] ChatRequest body)
    {
        var ct = HttpContext.RequestAborted;
        var memberId = await AllowedMemberAsync();
        if (memberId == null)
        {
            Response.StatusCode = StatusCodes.Status403Forbidden;
            return;
        }

        await using var sse = new SseWriter(Response);
        await sse.StartAsync(ct);
        await _orchestrator.RunAsync(memberId.Value, MemberName(), body.ConversationId, body.Message ?? "", sse, ct);
    }

    private async Task<int?> AllowedMemberAsync()
    {
        if (!_settings.Enabled || WebMemberId() is not int memberId) return null;
        await using var db = await _store.OpenAsync(HttpContext.RequestAborted);
        return await _store.GetActiveUserAsync(db, memberId) != null ? memberId : null;
    }
}
