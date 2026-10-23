using Dapper;
using Microsoft.AspNetCore.SignalR;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

/// <summary>
/// Chat between members (build spec 3.10, flag chat). Direct chats are between two active members of one club; groups
/// belong to a club (any active member starts one) or a district (its managers start one, members of its clubs join).
/// Everyone in a chat must stay an active member of that club or district: the same rule decides who reads, posts and
/// gets the real-time copy, so a member who leaves the club loses the chat at once. Text is stored as typed and escaped
/// by whoever renders it. Moderators (the club's or the district's managers) see reported messages only.
/// </summary>
public class ChatService : IChatService
{
    public const int MaxBody = 2000, MaxGroup = 256, SendsPerMinute = 30, ReportsPerHour = 20, GroupsPerHour = 10, MaxList = 200;
    private static readonly ChatResult NotFound = ChatResult.Fail(404, "Chat not found.");
    private readonly string _cs;
    private readonly IHubContext<ChatHub> _hub;

    public ChatService(IConfiguration config, IHubContext<ChatHub> hub)
    {
        _cs = config.GetConnectionString("DefaultConnection")!;
        _hub = hub;
    }

    // True when the member is active in the club (scope 'club') or in a club of the district (scope 'district').
    // The arguments are SQL expressions written in this file, never user input.
    private static string Active(string member, string scope, string owner) => $@"EXISTS (
        SELECT 1 FROM club_members cm JOIN club_master cl ON cl.pk_club_id = cm.fk_club_id AND IFNULL(cl.isdeleted, 0) = 0
        WHERE cm.fk_member_master_profile_id = {member} AND cm.IsActive = 1 AND IFNULL(cm.isdeleted, 0) = 0
          AND (({scope} = 'club' AND cm.fk_club_id = {owner}) OR ({scope} = 'district' AND cl.fk_district_id = {owner})))";

    // shortcut: the newest 200 conversations and reports, no paging; add paging when a member or a queue passes that.
    private static readonly string ListSql = $@"
        SELECT c.pk_conversation_id AS Id, c.scope AS Scope, c.owner_id AS OwnerId, c.kind AS Kind,
               COALESCE(c.title, om.MemberName) AS Title, o.member_id AS OtherMemberId, om.ProfilePhotoPath AS Photo,
               (SELECT COUNT(*) FROM chat_members n WHERE n.conversation_id = c.pk_conversation_id) AS MemberCount,
               p.is_owner AS IsOwner, p.muted_at IS NOT NULL AS Muted,
               (SELECT COUNT(*) FROM chat_messages u WHERE u.conversation_id = c.pk_conversation_id
                  AND u.pk_message_id > p.last_read_message_id AND u.sender_id <> @me AND u.hidden_at IS NULL) AS Unread,
               lm.pk_message_id AS LastMessageId, lm.sender_id AS LastSenderId,
               IF(lm.hidden_at IS NULL, lm.body, NULL) AS LastBody, lm.hidden_at IS NOT NULL AS LastHidden,
               COALESCE(lm.created_at, c.created_at) AS LastActivityAt
        FROM chat_conversations c
        JOIN chat_members p ON p.conversation_id = c.pk_conversation_id AND p.member_id = @me
        LEFT JOIN chat_members o ON c.kind = 'direct' AND o.conversation_id = c.pk_conversation_id AND o.member_id <> @me
        LEFT JOIN member_master_profile om ON om.pk_member_master_profile_id = o.member_id
        LEFT JOIN chat_messages lm ON lm.pk_message_id =
            (SELECT MAX(x.pk_message_id) FROM chat_messages x WHERE x.conversation_id = c.pk_conversation_id)
        WHERE {Active("@me", "c.scope", "c.owner_id")} AND (@id IS NULL OR c.pk_conversation_id = @id)
        ORDER BY LastActivityAt DESC, c.pk_conversation_id DESC
        LIMIT {MaxList}";

    private const string MessageSql = @"
        SELECT x.pk_message_id AS Id, x.conversation_id AS ConversationId, x.sender_id AS SenderId, s.MemberName AS SenderName,
               IF(x.hidden_at IS NULL, x.body, NULL) AS Body, x.hidden_at IS NOT NULL AS Hidden, x.created_at AS CreatedAt
        FROM chat_messages x LEFT JOIN member_master_profile s ON s.pk_member_master_profile_id = x.sender_id";

    private sealed class Conv
    {
        public string Scope { get; set; } = "";
        public int OwnerId { get; set; }
        public string Kind { get; set; } = "";
        public bool IsOwner { get; set; }
        public bool Muted { get; set; }
    }

    // The conversation when the member may use it, else null: "not found" and "not yours" answer the same 404.
    private static async Task<Conv?> ConvAsync(MySqlConnection conn, int id, int me) => await conn.QueryFirstOrDefaultAsync<Conv>($@"
        SELECT c.scope AS Scope, c.owner_id AS OwnerId, c.kind AS Kind, p.is_owner AS IsOwner, p.muted_at IS NOT NULL AS Muted
        FROM chat_conversations c
        JOIN chat_members p ON p.conversation_id = c.pk_conversation_id AND p.member_id = @me
        WHERE c.pk_conversation_id = @id AND {Active("@me", "c.scope", "c.owner_id")}", new { id, me });

    private static async Task<bool> AllActiveAsync(MySqlConnection conn, IReadOnlyCollection<int> ids, string scope, int owner)
        => ids.Count == 0 || await conn.ExecuteScalarAsync<int>($@"
            SELECT COUNT(*) FROM member_master_profile m
            WHERE m.pk_member_master_profile_id IN @ids AND {Active("m.pk_member_master_profile_id", "@scope", "@owner")}",
            new { ids, scope, owner }) == ids.Count;

    private static async Task<List<ChatConversationDto>> ListQueryAsync(MySqlConnection conn, int me, int? id)
        => (await conn.QueryAsync<ChatConversationDto>(ListSql, new { me, id })).ToList();

    // Real-time copy for everyone who may read the chat (the REST rule), the sender's other devices included.
    private async Task PushAsync(MySqlConnection conn, int conversationId, string evt, object payload)
    {
        var users = (await conn.QueryAsync<int>($@"
            SELECT p.member_id FROM chat_members p JOIN chat_conversations c ON c.pk_conversation_id = p.conversation_id
            WHERE p.conversation_id = @conversationId AND {Active("p.member_id", "c.scope", "c.owner_id")}", new { conversationId }))
            .Select(id => id.ToString()).ToList();
        // A stalled connection is dropped after 5 seconds instead of holding up the sender; the app reconnects and
        // catches up with GET messages?after=.
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        await _hub.Clients.Users(users).SendAsync(evt, payload, cts.Token);
    }

    public async Task<IReadOnlyList<ChatConversationDto>> ListAsync(int me)
    {
        await using var conn = new MySqlConnection(_cs);
        return await ListQueryAsync(conn, me, null);
    }

    public async Task<ChatResult> CreateAsync(int me, CreateChatDto dto)
    {
        if (dto.Kind is not ("direct" or "group") || dto.Scope is not ("club" or "district"))
            return ChatResult.Fail(400, "Choose a direct chat or a group, in a club or a district.");
        var group = dto.Kind == "group";
        var others = (dto.MemberIds ?? new()).Where(id => id != me).Distinct().ToList();
        var title = dto.Title?.Trim();
        if (!group && (dto.Scope != "club" || others.Count != 1))
            return ChatResult.Fail(400, "A direct chat is between you and one other member of your club.");
        if (group && (string.IsNullOrEmpty(title) || title.Length > 100))
            return ChatResult.Fail(400, "Give the group a name of up to 100 characters.");
        if (group && (others.Count == 0 || others.Count >= MaxGroup))
            return ChatResult.Fail(400, $"A group has 2 to {MaxGroup} members.");

        await using var conn = new MySqlConnection(_cs);
        await conn.OpenAsync();
        if (!await AllActiveAsync(conn, new[] { me }, dto.Scope, dto.OwnerId))
            return ChatResult.Fail(403, "You are not a member of this club or district.");
        if (group && dto.Scope == "district" && !await ScopeWriteGuardMiddleware.AllowedAsync(_cs, me, false, dto.OwnerId))
            return ChatResult.Fail(403, "Only the district's admins start district groups.");
        if (!await AllActiveAsync(conn, others, dto.Scope, dto.OwnerId))
            return ChatResult.Fail(400, "Everyone in the chat must be an active member of this club or district.");
        if (group && await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM chat_conversations WHERE created_by = @me AND kind = 'group' AND created_at > NOW() - INTERVAL 1 HOUR",
                new { me }) >= GroupsPerHour)
            return ChatResult.Fail(429, "You have started too many groups this hour. Try again later.");

        await using var tx = await conn.BeginTransactionAsync();
        int id;
        if (group)
            id = await conn.ExecuteScalarAsync<int>(
                "INSERT INTO chat_conversations (scope, owner_id, kind, title, created_by) VALUES (@Scope, @OwnerId, 'group', @title, @me); SELECT LAST_INSERT_ID();",
                new { dto.Scope, dto.OwnerId, title, me }, tx);
        else
        {
            // One direct chat per pair and club: opening it again returns the same conversation (unique direct_key).
            var key = $"{Math.Min(me, others[0])}:{Math.Max(me, others[0])}";
            await conn.ExecuteAsync(
                "INSERT IGNORE INTO chat_conversations (scope, owner_id, kind, direct_key, created_by) VALUES ('club', @OwnerId, 'direct', @key, @me)",
                new { dto.OwnerId, key, me }, tx);
            id = await conn.ExecuteScalarAsync<int>(
                "SELECT pk_conversation_id FROM chat_conversations WHERE scope = 'club' AND owner_id = @OwnerId AND direct_key = @key",
                new { dto.OwnerId, key }, tx);
        }
        await conn.ExecuteAsync("INSERT IGNORE INTO chat_members (conversation_id, member_id, is_owner) VALUES (@id, @m, @owner)",
            others.Select(m => new { id, m, owner = false }).Append(new { id, m = me, owner = group }), tx);
        await tx.CommitAsync();
        return ChatResult.Ok((await ListQueryAsync(conn, me, id)).FirstOrDefault());
    }

    public async Task<ChatResult> MembersAsync(int me, int conversationId)
    {
        await using var conn = new MySqlConnection(_cs);
        await conn.OpenAsync();
        if (await ConvAsync(conn, conversationId, me) == null) return NotFound;
        return ChatResult.Ok((await conn.QueryAsync<ChatMemberDto>($@"
            SELECT p.member_id AS MemberId, m.MemberName AS Name, m.ProfilePhotoPath AS Photo, p.is_owner AS IsOwner,
                   p.muted_at IS NOT NULL AS Muted, p.last_read_message_id AS LastReadMessageId
            FROM chat_members p
            JOIN chat_conversations c ON c.pk_conversation_id = p.conversation_id
            JOIN member_master_profile m ON m.pk_member_master_profile_id = p.member_id
            WHERE p.conversation_id = @conversationId AND {Active("p.member_id", "c.scope", "c.owner_id")}
            ORDER BY p.is_owner DESC, m.MemberName", new { conversationId })).ToList());
    }

    public async Task<ChatResult> AddMembersAsync(int me, int conversationId, List<int>? memberIds)
    {
        await using var conn = new MySqlConnection(_cs);
        await conn.OpenAsync();
        var conv = await ConvAsync(conn, conversationId, me);
        if (conv == null) return NotFound;
        if (conv.Kind != "group") return ChatResult.Fail(400, "Members are added to groups only.");
        if (!conv.IsOwner) return ChatResult.Fail(403, "Only the group's owner adds members.");
        var ids = (memberIds ?? new()).Distinct().ToList();
        if (ids.Count == 0 || !await AllActiveAsync(conn, ids, conv.Scope, conv.OwnerId))
            return ChatResult.Fail(400, "Everyone in the chat must be an active member of this club or district.");
        var others = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM chat_members WHERE conversation_id = @conversationId AND member_id NOT IN @ids", new { conversationId, ids });
        if (others + ids.Count > MaxGroup) return ChatResult.Fail(400, $"A group has up to {MaxGroup} members.");
        await conn.ExecuteAsync("INSERT IGNORE INTO chat_members (conversation_id, member_id) VALUES (@conversationId, @m)",
            ids.Select(m => new { conversationId, m }));
        return ChatResult.Ok();
    }

    public async Task<ChatResult> RemoveMemberAsync(int me, int conversationId, int memberId)
    {
        await using var conn = new MySqlConnection(_cs);
        await conn.OpenAsync();
        var conv = await ConvAsync(conn, conversationId, me);
        if (conv == null) return NotFound;
        if (conv.Kind != "group") return ChatResult.Fail(400, "A direct chat has no members to remove.");
        if (memberId != me && !conv.IsOwner) return ChatResult.Fail(403, "Only the group's owner removes members.");
        if (await conn.ExecuteAsync("DELETE FROM chat_members WHERE conversation_id = @conversationId AND member_id = @memberId",
                new { conversationId, memberId }) == 0)
            return ChatResult.Fail(404, "This member is not in the group.");
        // The owner left: the longest-standing member takes over, so the group can still add people.
        if (memberId == me && conv.IsOwner)
            await conn.ExecuteAsync("UPDATE chat_members SET is_owner = 1 WHERE conversation_id = @conversationId ORDER BY joined_at, member_id LIMIT 1",
                new { conversationId });
        return ChatResult.Ok();
    }

    public async Task<ChatResult> MessagesAsync(int me, int conversationId, long? before, long? after, int limit)
    {
        await using var conn = new MySqlConnection(_cs);
        await conn.OpenAsync();
        if (await ConvAsync(conn, conversationId, me) == null) return NotFound;
        limit = Math.Clamp(limit, 1, 100);
        // Oldest first either way: ?after= catches up after a reconnect, ?before= pages back through the history.
        var sql = after != null
            ? $"{MessageSql} WHERE x.conversation_id = @conversationId AND x.pk_message_id > @after ORDER BY x.pk_message_id LIMIT @limit"
            : $@"SELECT * FROM ({MessageSql} WHERE x.conversation_id = @conversationId AND (@before IS NULL OR x.pk_message_id < @before)
                 ORDER BY x.pk_message_id DESC LIMIT @limit) t ORDER BY t.Id";
        return ChatResult.Ok((await conn.QueryAsync<ChatMessageDto>(sql, new { conversationId, before, after, limit })).ToList());
    }

    public async Task<ChatResult> SendAsync(int me, int conversationId, SendChatMessageDto dto)
    {
        var body = dto.Body?.Trim();
        var key = string.IsNullOrWhiteSpace(dto.ClientKey) ? null : dto.ClientKey.Trim();
        if (string.IsNullOrEmpty(body) || body.Length > MaxBody) return ChatResult.Fail(400, $"Write a message of 1 to {MaxBody} characters.");
        if (key is { Length: > 64 }) return ChatResult.Fail(400, "clientKey has up to 64 characters.");

        await using var conn = new MySqlConnection(_cs);
        await conn.OpenAsync();
        var conv = await ConvAsync(conn, conversationId, me);
        if (conv == null) return NotFound;
        if (key != null)
        {
            // The app sent this message before and is retrying after a timeout: answer with the stored one.
            var earlier = await conn.QueryFirstOrDefaultAsync<ChatMessageDto>($"{MessageSql} WHERE x.sender_id = @me AND x.client_key = @key", new { me, key });
            if (earlier != null) return ChatResult.Ok(earlier);
        }
        if (conv.Muted) return ChatResult.Fail(403, "A moderator has muted you in this chat.");
        // Counted in the database, so the limit holds across API instances.
        if (await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM chat_messages WHERE sender_id = @me AND created_at > NOW() - INTERVAL 1 MINUTE", new { me }) >= SendsPerMinute)
            return ChatResult.Fail(429, "You are sending messages too fast. Wait a minute and try again.");

        var id = await conn.ExecuteScalarAsync<long>(
            "INSERT INTO chat_messages (conversation_id, sender_id, body, client_key) VALUES (@conversationId, @me, @body, @key); SELECT LAST_INSERT_ID();",
            new { conversationId, me, body, key });
        await conn.ExecuteAsync("UPDATE chat_members SET last_read_message_id = @id WHERE conversation_id = @conversationId AND member_id = @me",
            new { id, conversationId, me });
        var message = await conn.QueryFirstAsync<ChatMessageDto>($"{MessageSql} WHERE x.pk_message_id = @id", new { id });
        await PushAsync(conn, conversationId, "message", message);
        return ChatResult.Ok(message);
    }

    public async Task<ChatResult> ReadAsync(int me, int conversationId, long messageId)
    {
        await using var conn = new MySqlConnection(_cs);
        await conn.OpenAsync();
        if (await ConvAsync(conn, conversationId, me) == null) return NotFound;
        // Forward only, and never past the chat's last message.
        await conn.ExecuteAsync(@"
            UPDATE chat_members SET last_read_message_id = GREATEST(last_read_message_id,
                LEAST(@messageId, (SELECT COALESCE(MAX(pk_message_id), 0) FROM chat_messages WHERE conversation_id = @conversationId)))
            WHERE conversation_id = @conversationId AND member_id = @me", new { messageId, conversationId, me });
        var at = await conn.ExecuteScalarAsync<long>(
            "SELECT last_read_message_id FROM chat_members WHERE conversation_id = @conversationId AND member_id = @me", new { conversationId, me });
        await PushAsync(conn, conversationId, "read", new { conversationId, memberId = me, messageId = at });
        return ChatResult.Ok();
    }

    public async Task<ChatResult> ReportAsync(int me, long messageId, string? reason)
    {
        reason = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim();
        if (reason is { Length: > 500 }) return ChatResult.Fail(400, "Keep the reason to 500 characters.");
        await using var conn = new MySqlConnection(_cs);
        await conn.OpenAsync();
        var (conversationId, senderId) = await conn.QueryFirstOrDefaultAsync<(int, int)>(
            "SELECT conversation_id, sender_id FROM chat_messages WHERE pk_message_id = @messageId", new { messageId });
        if (conversationId == 0 || await ConvAsync(conn, conversationId, me) == null) return ChatResult.Fail(404, "Message not found.");
        if (senderId == me) return ChatResult.Fail(400, "You cannot report your own message.");
        if (await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM chat_reports WHERE reporter_id = @me AND created_at > NOW() - INTERVAL 1 HOUR", new { me }) >= ReportsPerHour)
            return ChatResult.Fail(429, "You have sent many reports this hour. Try again later.");
        // A second report of the same message by the same member keeps the first one.
        await conn.ExecuteAsync("INSERT IGNORE INTO chat_reports (message_id, reporter_id, reason) VALUES (@messageId, @me, @reason)",
            new { messageId, me, reason });
        return ChatResult.Ok();
    }

    public Task<bool> CanModerateAsync(int me, string scope, int ownerId)
        => ScopeWriteGuardMiddleware.AllowedAsync(_cs, me, scope == "club", ownerId);

    public async Task<IReadOnlyList<ChatReportDto>> ReportsAsync(string scope, int ownerId, bool resolved)
    {
        await using var conn = new MySqlConnection(_cs);
        return (await conn.QueryAsync<ChatReportDto>($@"
            SELECT r.pk_report_id AS Id, r.reason AS Reason, r.created_at AS ReportedAt, r.reporter_id AS ReporterId, rm.MemberName AS ReporterName,
                   x.pk_message_id AS MessageId, x.body AS MessageBody, x.created_at AS MessageAt, x.hidden_at IS NOT NULL AS Hidden,
                   x.sender_id AS SenderId, sm.MemberName AS SenderName, sp.muted_at IS NOT NULL AS SenderMuted,
                   c.pk_conversation_id AS ConversationId, c.kind AS ConversationKind, c.title AS ConversationTitle,
                   r.resolved_at AS ResolvedAt, vm.MemberName AS ResolvedByName, r.resolution AS Resolution
            FROM chat_reports r
            JOIN chat_messages x ON x.pk_message_id = r.message_id
            JOIN chat_conversations c ON c.pk_conversation_id = x.conversation_id
            LEFT JOIN chat_members sp ON sp.conversation_id = c.pk_conversation_id AND sp.member_id = x.sender_id
            LEFT JOIN member_master_profile rm ON rm.pk_member_master_profile_id = r.reporter_id
            LEFT JOIN member_master_profile sm ON sm.pk_member_master_profile_id = x.sender_id
            LEFT JOIN member_master_profile vm ON vm.pk_member_master_profile_id = r.resolved_by
            WHERE c.scope = @scope AND c.owner_id = @ownerId AND (r.resolved_at IS NOT NULL) = @resolved
            ORDER BY r.pk_report_id DESC
            LIMIT {MaxList}", new { scope, ownerId, resolved })).ToList();
    }

    public async Task<ChatResult> HideAsync(int me, string scope, int ownerId, long messageId, bool hidden)
    {
        await using var conn = new MySqlConnection(_cs);
        await conn.OpenAsync();
        var conversationId = await conn.ExecuteScalarAsync<int?>(@"
            SELECT c.pk_conversation_id FROM chat_messages x JOIN chat_conversations c ON c.pk_conversation_id = x.conversation_id
            WHERE x.pk_message_id = @messageId AND c.scope = @scope AND c.owner_id = @ownerId", new { messageId, scope, ownerId });
        if (conversationId == null) return ChatResult.Fail(404, "Message not found.");
        await conn.ExecuteAsync(@"
            UPDATE chat_messages SET hidden_at = IF(@hidden, COALESCE(hidden_at, NOW()), NULL), hidden_by = IF(@hidden, COALESCE(hidden_by, @me), NULL)
            WHERE pk_message_id = @messageId", new { hidden, me, messageId });
        // The apps swap the text for a "removed by a moderator" line (or back) by message id.
        await PushAsync(conn, conversationId.Value, "messageUpdated",
            await conn.QueryFirstAsync<ChatMessageDto>($"{MessageSql} WHERE x.pk_message_id = @messageId", new { messageId }));
        return ChatResult.Ok();
    }

    public async Task<ChatResult> MuteAsync(int me, string scope, int ownerId, int conversationId, int memberId, bool muted)
    {
        await using var conn = new MySqlConnection(_cs);
        await conn.OpenAsync();
        if (await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM chat_members p JOIN chat_conversations c ON c.pk_conversation_id = p.conversation_id
                WHERE p.conversation_id = @conversationId AND p.member_id = @memberId AND c.scope = @scope AND c.owner_id = @ownerId",
                new { conversationId, memberId, scope, ownerId }) == 0)
            return ChatResult.Fail(404, "This member is not in the chat.");
        await conn.ExecuteAsync(@"
            UPDATE chat_members SET muted_at = IF(@muted, COALESCE(muted_at, NOW()), NULL), muted_by = IF(@muted, COALESCE(muted_by, @me), NULL)
            WHERE conversation_id = @conversationId AND member_id = @memberId", new { muted, me, conversationId, memberId });
        return ChatResult.Ok();
    }

    public async Task<ChatResult> ResolveAsync(int me, string scope, int ownerId, int reportId, string? note)
    {
        note = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
        if (note is { Length: > 500 }) return ChatResult.Fail(400, "Keep the note to 500 characters.");
        await using var conn = new MySqlConnection(_cs);
        await conn.OpenAsync();
        var messageId = await conn.ExecuteScalarAsync<long?>(@"
            SELECT r.message_id FROM chat_reports r
            JOIN chat_messages x ON x.pk_message_id = r.message_id
            JOIN chat_conversations c ON c.pk_conversation_id = x.conversation_id
            WHERE r.pk_report_id = @reportId AND c.scope = @scope AND c.owner_id = @ownerId", new { reportId, scope, ownerId });
        if (messageId == null) return ChatResult.Fail(404, "Report not found.");
        // One decision per message: every open report of it closes together.
        await conn.ExecuteAsync(@"
            UPDATE chat_reports SET resolved_at = NOW(), resolved_by = @me, resolution = @note
            WHERE message_id = @messageId AND resolved_at IS NULL", new { me, note, messageId });
        return ChatResult.Ok();
    }
}
