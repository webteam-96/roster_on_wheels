namespace RotaryApi.DTOs;

// Chat (build spec 3.10, flag chat): Services/ChatService.cs, Controllers/ChatController.cs.

/// <summary>A chat operation's outcome: Status is the HTTP status, Error the message shown when it failed.</summary>
public sealed record ChatResult(int Status, object? Value = null, string? Error = null)
{
    public static ChatResult Ok(object? value = null) => new(value == null ? 204 : 200, value);
    public static ChatResult Fail(int status, string error) => new(status, null, error);
}

/// <param name="Kind">direct (two members of one club) or group</param>
/// <param name="Scope">club or district (district groups only)</param>
/// <param name="MemberIds">the other members; a direct chat names exactly one</param>
public sealed record CreateChatDto(string? Kind, string? Scope, int OwnerId, List<int>? MemberIds, string? Title);

public sealed record ChatMemberIdsDto(List<int>? MemberIds);

/// <param name="ClientKey">optional, chosen by the app per message: a retry with the same key returns the stored message</param>
public sealed record SendChatMessageDto(string? Body, string? ClientKey);

public sealed record ChatReadDto(long MessageId);

public sealed record ReportChatMessageDto(string? Reason);

public sealed record ResolveChatReportDto(string? Note);

/// <summary>One conversation in the member's list. Title is the group name, or the other member's name in a direct chat.</summary>
public sealed class ChatConversationDto
{
    public int Id { get; set; }
    public string Scope { get; set; } = "";
    public int OwnerId { get; set; }
    public string Kind { get; set; } = "";
    public string? Title { get; set; }
    public int? OtherMemberId { get; set; }
    public string? Photo { get; set; }
    public int MemberCount { get; set; }
    public bool IsOwner { get; set; }
    public bool Muted { get; set; }
    public int Unread { get; set; }
    public long? LastMessageId { get; set; }
    public int? LastSenderId { get; set; }
    public string? LastBody { get; set; }
    public bool LastHidden { get; set; }
    public DateTime LastActivityAt { get; set; }
}

public sealed class ChatMemberDto
{
    public int MemberId { get; set; }
    public string? Name { get; set; }
    public string? Photo { get; set; }
    public bool IsOwner { get; set; }
    public bool Muted { get; set; }
    public long LastReadMessageId { get; set; }
}

/// <summary>Body is null when a moderator has hidden the message.</summary>
public sealed class ChatMessageDto
{
    public long Id { get; set; }
    public int ConversationId { get; set; }
    public int SenderId { get; set; }
    public string? SenderName { get; set; }
    public string? Body { get; set; }
    public bool Hidden { get; set; }
    public DateTime CreatedAt { get; set; }
}

/// <summary>A reported message in the moderation queue; MessageBody is shown to moderators even when hidden.</summary>
public sealed class ChatReportDto
{
    public int Id { get; set; }
    public string? Reason { get; set; }
    public DateTime ReportedAt { get; set; }
    public int ReporterId { get; set; }
    public string? ReporterName { get; set; }
    public long MessageId { get; set; }
    public string MessageBody { get; set; } = "";
    public DateTime MessageAt { get; set; }
    public bool Hidden { get; set; }
    public int SenderId { get; set; }
    public string? SenderName { get; set; }
    public bool SenderMuted { get; set; }
    public int ConversationId { get; set; }
    public string ConversationKind { get; set; } = "";
    public string? ConversationTitle { get; set; }
    public DateTime? ResolvedAt { get; set; }
    public string? ResolvedByName { get; set; }
    public string? Resolution { get; set; }
}
