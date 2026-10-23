using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace RotaryApi.Services;

/// <summary>
/// Real-time chat delivery (build spec 3.10, flag chat), mapped at /api/chat/hub; the token comes in the access_token
/// query. Clients only listen: messages are sent through ChatController (validation, mute, rate limit) and ChatService
/// pushes each event to the members who may read that conversation, so a connection never chooses what it receives.
/// Events: "message" and "messageUpdated" (a ChatMessageDto), "read" ({ conversationId, memberId, messageId }).
/// </summary>
[Authorize]
public class ChatHub : Hub
{
}

/// <summary>
/// Hub connections are addressed by the token's memberId. A family member signs in with the member's id, and chat
/// speaks for the member, so a family session gets no user id and receives nothing.
/// </summary>
public class ChatUserIdProvider : IUserIdProvider
{
    public string? GetUserId(HubConnectionContext connection)
        => connection.User?.FindFirst("familyMemberId") == null ? connection.User?.FindFirst("memberId")?.Value : null;
}
