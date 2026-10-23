using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IChatService
{
    // Members (me = the signed-in member)
    Task<IReadOnlyList<ChatConversationDto>> ListAsync(int me);
    Task<ChatResult> CreateAsync(int me, CreateChatDto dto);
    Task<ChatResult> MembersAsync(int me, int conversationId);
    Task<ChatResult> AddMembersAsync(int me, int conversationId, List<int>? memberIds);
    Task<ChatResult> RemoveMemberAsync(int me, int conversationId, int memberId);
    Task<ChatResult> MessagesAsync(int me, int conversationId, long? before, long? after, int limit);
    Task<ChatResult> SendAsync(int me, int conversationId, SendChatMessageDto dto);
    Task<ChatResult> ReadAsync(int me, int conversationId, long messageId);
    Task<ChatResult> ReportAsync(int me, long messageId, string? reason);

    // Moderators of a club (scope "club") or district (scope "district")
    Task<bool> CanModerateAsync(int me, string scope, int ownerId);
    Task<IReadOnlyList<ChatReportDto>> ReportsAsync(string scope, int ownerId, bool resolved);
    Task<ChatResult> HideAsync(int me, string scope, int ownerId, long messageId, bool hidden);
    Task<ChatResult> MuteAsync(int me, string scope, int ownerId, int conversationId, int memberId, bool muted);
    Task<ChatResult> ResolveAsync(int me, string scope, int ownerId, int reportId, string? note);
}
