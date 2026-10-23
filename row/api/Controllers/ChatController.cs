using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Chat for the app (build spec 3.10, flag chat): conversations, history, send, read state and reports. ChatService
/// checks on every call that the member is in the chat and still active in its club or district. Writes here are not
/// in audit_log (AuditMiddleware skips api/chat): the messages and reports are their own record.
/// </summary>
[ApiController]
[Authorize]
[Route("api/chat")]
public class ChatController : ControllerBase, IActionFilter
{
    private readonly IChatService _chat;

    public ChatController(IChatService chat) => _chat = chat;

    private int Me => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    // A family member signs in with the member's id; chat speaks for the member, so family sessions are refused.
    [NonAction]
    public void OnActionExecuting(ActionExecutingContext context)
    {
        if (Me <= 0 || User.FindFirst("familyMemberId") != null)
            context.Result = StatusCode(StatusCodes.Status403Forbidden, new { message = "Chat is for members." });
    }

    [NonAction]
    public void OnActionExecuted(ActionExecutedContext context) { }

    internal static IActionResult Reply(ControllerBase c, ChatResult r) => r.Error != null
        ? c.StatusCode(r.Status, new { message = r.Error })
        : r.Value == null ? c.NoContent() : c.Ok(r.Value);

    [HttpGet("conversations")]
    public async Task<IActionResult> List() => Ok(await _chat.ListAsync(Me));

    [HttpPost("conversations")]
    public async Task<IActionResult> Create([FromBody] CreateChatDto dto) => Reply(this, await _chat.CreateAsync(Me, dto));

    [HttpGet("conversations/{id:int}/members")]
    public async Task<IActionResult> Members(int id) => Reply(this, await _chat.MembersAsync(Me, id));

    [HttpPost("conversations/{id:int}/members")]
    public async Task<IActionResult> AddMembers(int id, [FromBody] ChatMemberIdsDto dto) => Reply(this, await _chat.AddMembersAsync(Me, id, dto.MemberIds));

    [HttpDelete("conversations/{id:int}/members/{memberId:int}")]
    public async Task<IActionResult> RemoveMember(int id, int memberId) => Reply(this, await _chat.RemoveMemberAsync(Me, id, memberId));

    [HttpGet("conversations/{id:int}/messages")]
    public async Task<IActionResult> Messages(int id, [FromQuery] long? before, [FromQuery] long? after, [FromQuery] int limit = 50)
        => Reply(this, await _chat.MessagesAsync(Me, id, before, after, limit));

    [HttpPost("conversations/{id:int}/messages")]
    public async Task<IActionResult> Send(int id, [FromBody] SendChatMessageDto dto) => Reply(this, await _chat.SendAsync(Me, id, dto));

    [HttpPost("conversations/{id:int}/read")]
    public async Task<IActionResult> Read(int id, [FromBody] ChatReadDto dto) => Reply(this, await _chat.ReadAsync(Me, id, dto.MessageId));

    [HttpPost("messages/{messageId:long}/report")]
    public async Task<IActionResult> Report(long messageId, [FromBody] ReportChatMessageDto dto) => Reply(this, await _chat.ReportAsync(Me, messageId, dto.Reason));
}

/// <summary>
/// The moderation queue for a club's or district's managers (the ScopeWriteGuardMiddleware rule, checked here for
/// reads too, since that middleware lets members read). AuditMiddleware records every write under this path.
/// </summary>
[ApiController]
[Authorize]
[Route("api/{scope:regex(^(clubs|districts)$)}/{ownerId:int}/chat-moderation")]
public class ChatModerationController : ControllerBase, IAsyncActionFilter
{
    private readonly IChatService _chat;

    public ChatModerationController(IChatService chat) => _chat = chat;

    private int Me => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;
    private static string Owner(string scope) => scope == "clubs" ? "club" : "district";

    [NonAction]
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var scope = Owner(context.RouteData.Values["scope"]?.ToString() ?? "");
        var ownerId = int.TryParse(context.RouteData.Values["ownerId"]?.ToString(), out var o) ? o : 0;
        if (Me <= 0 || !await _chat.CanModerateAsync(Me, scope, ownerId))
        {
            context.Result = StatusCode(StatusCodes.Status403Forbidden, new { message = "You do not moderate chats here." });
            return;
        }
        await next();
    }

    [HttpGet("reports")]
    public async Task<IActionResult> Reports(string scope, int ownerId, [FromQuery] string? status)
        => Ok(await _chat.ReportsAsync(Owner(scope), ownerId, status == "resolved"));

    [HttpPost("messages/{messageId:long}/hide")]
    public async Task<IActionResult> Hide(string scope, int ownerId, long messageId)
        => ChatController.Reply(this, await _chat.HideAsync(Me, Owner(scope), ownerId, messageId, true));

    [HttpPost("messages/{messageId:long}/unhide")]
    public async Task<IActionResult> Unhide(string scope, int ownerId, long messageId)
        => ChatController.Reply(this, await _chat.HideAsync(Me, Owner(scope), ownerId, messageId, false));

    [HttpPost("conversations/{conversationId:int}/mute/{memberId:int}")]
    public async Task<IActionResult> Mute(string scope, int ownerId, int conversationId, int memberId)
        => ChatController.Reply(this, await _chat.MuteAsync(Me, Owner(scope), ownerId, conversationId, memberId, true));

    [HttpPost("conversations/{conversationId:int}/unmute/{memberId:int}")]
    public async Task<IActionResult> Unmute(string scope, int ownerId, int conversationId, int memberId)
        => ChatController.Reply(this, await _chat.MuteAsync(Me, Owner(scope), ownerId, conversationId, memberId, false));

    [HttpPost("reports/{reportId:int}/resolve")]
    public async Task<IActionResult> Resolve(string scope, int ownerId, int reportId, [FromBody] ResolveChatReportDto? dto)
        => ChatController.Reply(this, await _chat.ResolveAsync(Me, Owner(scope), ownerId, reportId, dto?.Note));
}
