using System.Data;
using System.Net;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

/// <summary>
/// Enhanced committees (gap agent, beats ClubRunner Enhanced Committees). A committee is a club sub group
/// (kind "club", sub_groups) or a district committee (kind "district", district_committee_group).
/// Committees nest to any depth (parent column on each table, same club or district and year, no cycles).
/// Each committee has private documents (App_Data, served after the access check) and a message archive: a member
/// writes to the committee, the message goes out through the mass email pipeline and is kept here.
/// Access: the committee's own members (while still members of that club / a club of that district) and the
/// people who manage that club or district (ScopeWriteGuardMiddleware.AllowedAsync). Structure changes: managers only.
/// </summary>
public class CommitteeService
{
    public const string Club = "club", District = "district";
    public const int MaxFileBytes = 20 * 1024 * 1024;
    public const int MaxMessagesPerDay = 10;

    private readonly string _cs;
    private readonly string _fileRoot;
    private readonly IClubMassEmailService _mail;
    private readonly IAuditLogService _audit;

    public CommitteeService(IConfiguration config, IWebHostEnvironment env, IClubMassEmailService mail, IAuditLogService audit)
    {
        _cs = config.GetConnectionString("DefaultConnection")!;
        // Outside wwwroot: files are only served through CommitteesController after the access check.
        _fileRoot = Path.Combine(env.ContentRootPath, "App_Data", "committee-files");
        _mail = mail;
        _audit = audit;
    }

    public sealed record Committee(string Kind, int Id, string Name, int ScopeId, int YearId, int? ParentId);
    public sealed record Access(Committee Committee, bool IsMember, bool CanManage);

    public static bool ValidKind(string kind) => kind is Club or District;

    // ===== Lookup and access =====

    private static string CommitteeSql(string kind) => kind == Club
        ? @"SELECT 'club' AS Kind, pk_sub_group_id AS Id, GroupName AS Name, fk_club_id AS ScopeId, fk_year_id AS YearId,
                   fk_parent_sub_group_id AS ParentId
            FROM sub_groups WHERE pk_sub_group_id = @Id AND fk_club_id > 0 AND IFNULL(isdeleted, 0) = 0"
        : @"SELECT 'district' AS Kind, id AS Id, group_name AS Name, fk_district_id AS ScopeId, fk_year_id AS YearId,
                   fk_parent_group_id AS ParentId
            FROM district_committee_group WHERE id = @Id AND IFNULL(isdeleted, 0) = 0";

    private static string MemberSql(string kind) => kind == Club
        ? "SELECT COUNT(*) FROM sub_group_members WHERE fk_sub_group_id = @Id AND fk_member_master_profile_id = @M AND IFNULL(isdeleted, 0) = 0"
        : "SELECT COUNT(*) FROM district_committee_group_member WHERE fk_group_id = @Id AND fk_member_id = @M AND IFNULL(isdeleted, 0) = 0 AND IFNULL(is_active, 1) = 1";

    public async Task<Committee?> FindAsync(string kind, int id)
    {
        if (!ValidKind(kind) || id <= 0) return null;
        await using var c = RowDb.Connect(_cs);
        return await c.QueryFirstOrDefaultAsync<Committee>(CommitteeSql(kind), new { Id = id });
    }

    /// <summary>The caller's access to a committee, or null when the committee does not exist or the caller may not
    /// see it (the controller answers 404 for both, so ids cannot be probed).</summary>
    public async Task<Access?> AccessAsync(string kind, int id, int memberId)
    {
        if (memberId <= 0) return null;
        var committee = await FindAsync(kind, id);
        if (committee == null) return null;
        var isClub = kind == Club;
        var canManage = await ScopeWriteGuardMiddleware.AllowedAsync(_cs, memberId, isClub, committee.ScopeId);
        bool isMember;
        await using (var c = RowDb.Connect(_cs))
            isMember = await c.ExecuteScalarAsync<int>(MemberSql(kind), new { Id = id, M = memberId }) > 0;
        // A member who has left the club (or every club of the district) loses access with it.
        if (isMember && !canManage)
            isMember = await ScopeWriteGuardMiddleware.ReadAllowedAsync(_cs, memberId, isClub, committee.ScopeId);
        return isMember || canManage ? new Access(committee, isMember, canManage) : null;
    }

    public Task<bool> ManagesAsync(string kind, int scopeId, int memberId)
        => ScopeWriteGuardMiddleware.AllowedAsync(_cs, memberId, kind == Club, scopeId);

    // ===== Committees of a member (app) =====

    public sealed class MyCommittee
    {
        public string Kind { get; set; } = "";
        public int Id { get; set; }
        public string Name { get; set; } = "";
        public int ScopeId { get; set; }
        public string ScopeName { get; set; } = "";
        public int YearId { get; set; }
        public string? YearLabel { get; set; }
        public int? ParentId { get; set; }
        public string? ParentName { get; set; }
    }

    public async Task<List<MyCommittee>> MineAsync(int memberId)
    {
        await using var c = RowDb.Connect(_cs);
        return (await c.QueryAsync<MyCommittee>(@"
            SELECT 'club' AS Kind, sg.pk_sub_group_id AS Id, sg.GroupName AS Name, sg.fk_club_id AS ScopeId,
                   cl.ClubName AS ScopeName, sg.fk_year_id AS YearId, y.YearLabel, p.pk_sub_group_id AS ParentId,
                   p.GroupName AS ParentName
            FROM sub_group_members sgm
            JOIN sub_groups sg ON sg.pk_sub_group_id = sgm.fk_sub_group_id AND sg.fk_club_id > 0 AND IFNULL(sg.isdeleted, 0) = 0
            JOIN club_master cl ON cl.pk_club_id = sg.fk_club_id
            JOIN club_members cm ON cm.fk_club_id = sg.fk_club_id AND cm.fk_member_master_profile_id = @M
                 AND cm.IsActive = 1 AND IFNULL(cm.isdeleted, 0) = 0
            LEFT JOIN rotary_year_master y ON y.pk_year_id = sg.fk_year_id
            LEFT JOIN sub_groups p ON p.pk_sub_group_id = sg.fk_parent_sub_group_id AND IFNULL(p.isdeleted, 0) = 0
            WHERE sgm.fk_member_master_profile_id = @M AND IFNULL(sgm.isdeleted, 0) = 0
            UNION
            SELECT 'district', g.id, g.group_name, g.fk_district_id, CONCAT('District ', d.DistrictNumber), g.fk_year_id,
                   y.YearLabel, p.id, p.group_name
            FROM district_committee_group_member gm
            JOIN district_committee_group g ON g.id = gm.fk_group_id AND IFNULL(g.isdeleted, 0) = 0
            JOIN district_master d ON d.pk_district_id = g.fk_district_id
            LEFT JOIN rotary_year_master y ON y.pk_year_id = g.fk_year_id
            LEFT JOIN district_committee_group p ON p.id = g.fk_parent_group_id AND IFNULL(p.isdeleted, 0) = 0
            WHERE gm.fk_member_id = @M AND IFNULL(gm.isdeleted, 0) = 0 AND IFNULL(gm.is_active, 1) = 1
              AND EXISTS (SELECT 1 FROM club_members cm JOIN club_master c2 ON c2.pk_club_id = cm.fk_club_id
                          WHERE cm.fk_member_master_profile_id = @M AND c2.fk_district_id = g.fk_district_id
                            AND cm.IsActive = 1 AND IFNULL(cm.isdeleted, 0) = 0)
            ORDER BY YearId DESC, Kind, Name", new { M = memberId })).ToList();
    }

    // ===== Structure (tree) =====

    public sealed class TreeNode
    {
        public int Id { get; set; }
        public string Name { get; set; } = "";
        public int? ParentId { get; set; }
        public int MemberCount { get; set; }
        public int DocumentCount { get; set; }
        public int MessageCount { get; set; }
    }

    /// <summary>Every committee of a club or district in one year, flat with parent ids (a parent that was deleted
    /// reads as no parent).</summary>
    public async Task<List<TreeNode>> TreeAsync(string kind, int scopeId, int yearId)
    {
        await using var c = RowDb.Connect(_cs);
        var sql = kind == Club
            ? @"SELECT g.pk_sub_group_id AS Id, g.GroupName AS Name, p.pk_sub_group_id AS ParentId,
                       (SELECT COUNT(*) FROM sub_group_members m WHERE m.fk_sub_group_id = g.pk_sub_group_id AND IFNULL(m.isdeleted, 0) = 0) AS MemberCount,
                       (SELECT COUNT(*) FROM committee_documents d WHERE d.committee_kind = 'club' AND d.fk_committee_id = g.pk_sub_group_id AND d.isdeleted = 0) AS DocumentCount,
                       (SELECT COUNT(*) FROM committee_messages x WHERE x.committee_kind = 'club' AND x.fk_committee_id = g.pk_sub_group_id) AS MessageCount
                FROM sub_groups g
                LEFT JOIN sub_groups p ON p.pk_sub_group_id = g.fk_parent_sub_group_id AND IFNULL(p.isdeleted, 0) = 0
                WHERE g.fk_club_id = @S AND g.fk_year_id = @Y AND IFNULL(g.isdeleted, 0) = 0
                ORDER BY g.GroupName"
            : @"SELECT g.id AS Id, g.group_name AS Name, p.id AS ParentId,
                       (SELECT COUNT(*) FROM district_committee_group_member m WHERE m.fk_group_id = g.id AND IFNULL(m.isdeleted, 0) = 0) AS MemberCount,
                       (SELECT COUNT(*) FROM committee_documents d WHERE d.committee_kind = 'district' AND d.fk_committee_id = g.id AND d.isdeleted = 0) AS DocumentCount,
                       (SELECT COUNT(*) FROM committee_messages x WHERE x.committee_kind = 'district' AND x.fk_committee_id = g.id) AS MessageCount
                FROM district_committee_group g
                LEFT JOIN district_committee_group p ON p.id = g.fk_parent_group_id AND IFNULL(p.isdeleted, 0) = 0
                WHERE g.fk_district_id = @S AND g.fk_year_id = @Y AND IFNULL(g.isdeleted, 0) = 0
                ORDER BY g.sort_order, g.group_name";
        return (await c.QueryAsync<TreeNode>(sql, new { S = scopeId, Y = yearId })).ToList();
    }

    /// <summary>Sets (or clears, with null) a committee's parent committee. The parent must be another committee of
    /// the same club or district and year, and the move must not make a loop. Runs under row locks on that year's
    /// committees so two moves at once cannot build a loop between them. Returns an error message or null.</summary>
    public async Task<string?> SetParentAsync(Committee committee, int? parentId, int memberId, HttpContext http)
    {
        if (parentId is <= 0) parentId = null;
        await using var c = RowDb.Connect(_cs);
        await c.OpenAsync();
        await using var tx = await c.BeginTransactionAsync(IsolationLevel.ReadCommitted);
        var rows = await c.QueryAsync<(int Id, int? Parent)>(committee.Kind == Club
            ? @"SELECT pk_sub_group_id, fk_parent_sub_group_id FROM sub_groups
                WHERE fk_club_id = @S AND fk_year_id = @Y AND IFNULL(isdeleted, 0) = 0 FOR UPDATE"
            : @"SELECT id, fk_parent_group_id FROM district_committee_group
                WHERE fk_district_id = @S AND fk_year_id = @Y AND IFNULL(isdeleted, 0) = 0 FOR UPDATE",
            new { S = committee.ScopeId, Y = committee.YearId }, tx);
        var parents = rows.ToDictionary(r => r.Id, r => r.Parent);
        if (parentId.HasValue && !parents.ContainsKey(parentId.Value))
            return "The parent committee must be another committee of the same club or district and year.";
        if (CommitteeTree.CreatesCycle(committee.Id, parentId, parents))
            return "A committee cannot sit under itself or under one of its own subcommittees.";
        await c.ExecuteAsync(committee.Kind == Club
            ? "UPDATE sub_groups SET fk_parent_sub_group_id = @P, modified_by = @U WHERE pk_sub_group_id = @Id"
            : "UPDATE district_committee_group SET fk_parent_group_id = @P, modified_by = @U WHERE id = @Id",
            new { P = parentId, U = memberId, committee.Id }, tx);
        await tx.CommitAsync();
        await _audit.LogAsync(memberId, "UPDATE", "committee_parent", committee.Id, committee.Name,
            new { committee.Kind, parentId }, http);
        return null;
    }

    // ===== Detail =====

    public sealed class Person
    {
        public int? MemberId { get; set; }
        public string Name { get; set; } = "";
        public string? Designation { get; set; }
    }

    public sealed record Crumb(int Id, string Name);

    public async Task<object> DetailAsync(Access access)
    {
        var k = access.Committee;
        await using var c = RowDb.Connect(_cs);
        var members = (await c.QueryAsync<Person>(k.Kind == Club
            ? @"SELECT m.pk_member_master_profile_id AS MemberId, m.MemberName AS Name, NULL AS Designation
                FROM sub_group_members s JOIN member_master_profile m ON m.pk_member_master_profile_id = s.fk_member_master_profile_id
                WHERE s.fk_sub_group_id = @Id AND IFNULL(s.isdeleted, 0) = 0 AND IFNULL(m.isdeleted, 0) = 0
                ORDER BY m.MemberName"
            : @"SELECT fk_member_id AS MemberId, name AS Name, district_designation AS Designation
                FROM district_committee_group_member
                WHERE fk_group_id = @Id AND IFNULL(isdeleted, 0) = 0 AND IFNULL(is_active, 1) = 1
                ORDER BY sort_order, name", new { k.Id })).ToList();
        var all = await TreeAsync(k.Kind, k.ScopeId, k.YearId);
        var byId = all.ToDictionary(n => n.Id);
        var path = CommitteeTree.PathTo(k.Id, all.ToDictionary(n => n.Id, n => n.ParentId))
            .Where(byId.ContainsKey).Select(id => new Crumb(id, byId[id].Name)).ToList();
        var children = all.Where(n => n.ParentId == k.Id).Select(n => new Crumb(n.Id, n.Name)).ToList();
        return new
        {
            kind = k.Kind, id = k.Id, name = k.Name, scopeId = k.ScopeId, yearId = k.YearId,
            parentId = path.Count > 1 ? path[^2].Id : (int?)null,
            path, children, members, isMember = access.IsMember, canManage = access.CanManage,
        };
    }

    // ===== Documents =====

    public sealed class DocumentRow
    {
        public int Id { get; set; }
        public string Title { get; set; } = "";
        public string OriginalName { get; set; } = "";
        public int SizeBytes { get; set; }
        public int UploadedBy { get; set; }
        public string? UploadedByName { get; set; }
        public DateTime CreatedDate { get; set; }
        public bool CanDelete { get; set; }
    }

    public async Task<List<DocumentRow>> DocumentsAsync(Access access, int memberId)
    {
        await using var c = RowDb.Connect(_cs);
        var rows = (await c.QueryAsync<DocumentRow>(@"
            SELECT d.pk_id AS Id, d.title AS Title, d.original_name AS OriginalName, d.size_bytes AS SizeBytes,
                   d.uploaded_by AS UploadedBy, m.MemberName AS UploadedByName, d.created_date AS CreatedDate
            FROM committee_documents d
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = d.uploaded_by
            WHERE d.committee_kind = @K AND d.fk_committee_id = @Id AND d.isdeleted = 0
            ORDER BY d.created_date DESC, d.pk_id DESC",
            new { K = access.Committee.Kind, access.Committee.Id })).ToList();
        foreach (var r in rows)
        {
            r.CreatedDate = DateTime.SpecifyKind(r.CreatedDate, DateTimeKind.Utc);
            r.CanDelete = access.CanManage || r.UploadedBy == memberId;
        }
        return rows;
    }

    /// <summary>Checks the upload (size, type, first bytes) and stores it. Returns (id, null) or (0, error).</summary>
    public async Task<(int Id, string? Error)> UploadAsync(Access access, string? title, IFormFile? file, int memberId, HttpContext http)
    {
        title = title?.Trim();
        if (string.IsNullOrEmpty(title) || title.Length > 200) return (0, "Enter a title of at most 200 characters.");
        if (file == null || file.Length == 0) return (0, "Choose a file.");
        if (file.Length > MaxFileBytes) return (0, "Files must be 20 MB or smaller.");
        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (!GrantService.FileTypes.TryGetValue(ext, out var type))
            return (0, "Allowed files: PDF, Word, Excel, PowerPoint, JPG and PNG.");
        var head = new byte[8];
        await using (var s = file.OpenReadStream()) await s.ReadAtLeastAsync(head, head.Length, throwOnEndOfStream: false);
        if (!head.AsSpan().StartsWith(type.Magic)) return (0, "The file's content does not match its type.");
        var name = Path.GetFileName(file.FileName);
        if (name.Length > 255) name = name[..(255 - ext.Length)] + ext;

        var k = access.Committee;
        var stored = Guid.NewGuid().ToString("N") + ext;
        var dir = FolderOf(k);
        Directory.CreateDirectory(dir);
        var path = Path.Combine(dir, stored);
        await using (var fs = new FileStream(path, FileMode.CreateNew)) await file.CopyToAsync(fs);
        try
        {
            await using var c = RowDb.Connect(_cs);
            var id = await c.ExecuteScalarAsync<int>(@"
                INSERT INTO committee_documents (committee_kind, fk_committee_id, title, original_name, stored_name, size_bytes, uploaded_by, created_date)
                VALUES (@K, @C, @T, @N, @S, @Size, @U, UTC_TIMESTAMP());
                SELECT LAST_INSERT_ID();",
                new { K = k.Kind, C = k.Id, T = title, N = name, S = stored, Size = (int)file.Length, U = memberId });
            await _audit.LogAsync(memberId, "UPLOAD", "committee_document", id, title, new { k.Kind, committeeId = k.Id }, http);
            return (id, null);
        }
        catch
        {
            File.Delete(path);
            throw;
        }
    }

    private string FolderOf(Committee k) => Path.Combine(_fileRoot, $"{k.Kind}-{k.Id}");

    /// <summary>The stored file of a document of this committee, or null.</summary>
    public async Task<(string Path, string Name, string ContentType)?> FileAsync(Access access, int documentId)
    {
        await using var c = RowDb.Connect(_cs);
        var row = await c.QueryFirstOrDefaultAsync<(string Name, string Stored)?>(@"
            SELECT original_name, stored_name FROM committee_documents
            WHERE pk_id = @D AND committee_kind = @K AND fk_committee_id = @C AND isdeleted = 0",
            new { D = documentId, K = access.Committee.Kind, C = access.Committee.Id });
        if (row == null) return null;
        var root = Path.GetFullPath(_fileRoot) + Path.DirectorySeparatorChar;
        var path = Path.GetFullPath(Path.Combine(FolderOf(access.Committee), row.Value.Stored));
        if (!path.StartsWith(root, StringComparison.OrdinalIgnoreCase) || !File.Exists(path)) return null;
        var contentType = GrantService.FileTypes.TryGetValue(Path.GetExtension(path).ToLowerInvariant(), out var t)
            ? t.ContentType : "application/octet-stream";
        return (path, row.Value.Name, contentType);
    }

    /// <summary>Removes a document: its uploader or a manager. Returns false when not found or not allowed.</summary>
    public async Task<bool> DeleteDocumentAsync(Access access, int documentId, int memberId, HttpContext http)
    {
        await using var c = RowDb.Connect(_cs);
        var row = await c.QueryFirstOrDefaultAsync<(string Stored, int UploadedBy, string Title)?>(@"
            SELECT stored_name, uploaded_by, title FROM committee_documents
            WHERE pk_id = @D AND committee_kind = @K AND fk_committee_id = @C AND isdeleted = 0",
            new { D = documentId, K = access.Committee.Kind, C = access.Committee.Id });
        if (row == null || !(access.CanManage || row.Value.UploadedBy == memberId)) return false;
        await c.ExecuteAsync(
            "UPDATE committee_documents SET isdeleted = 1, deleted_by = @U, deleted_date = UTC_TIMESTAMP() WHERE pk_id = @D",
            new { U = memberId, D = documentId });
        var path = Path.Combine(FolderOf(access.Committee), row.Value.Stored);
        if (File.Exists(path)) File.Delete(path);
        await _audit.LogAsync(memberId, "DELETE", "committee_document", documentId, row.Value.Title,
            new { access.Committee.Kind, committeeId = access.Committee.Id }, http);
        return true;
    }

    // ===== Messages =====

    public sealed class MessageRow
    {
        public int Id { get; set; }
        public string Subject { get; set; } = "";
        public string Body { get; set; } = "";
        public int SentBy { get; set; }
        public string? SentByName { get; set; }
        public DateTime CreatedDate { get; set; }
        public string? Status { get; set; }
        public int TotalRecipients { get; set; }
        public int SentCount { get; set; }
        public int FailedCount { get; set; }
    }

    public async Task<List<MessageRow>> MessagesAsync(Access access)
    {
        await using var c = RowDb.Connect(_cs);
        var rows = (await c.QueryAsync<MessageRow>(@"
            SELECT x.pk_id AS Id, x.subject AS Subject, x.body AS Body, x.sent_by AS SentBy, m.MemberName AS SentByName,
                   x.created_date AS CreatedDate, e.Status, IFNULL(e.TotalRecipients, 0) AS TotalRecipients,
                   IFNULL(e.SentCount, 0) AS SentCount, IFNULL(e.FailedCount, 0) AS FailedCount
            FROM committee_messages x
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = x.sent_by
            LEFT JOIN club_mass_emails e ON e.pk_mass_email_id = x.fk_mass_email_id
            WHERE x.committee_kind = @K AND x.fk_committee_id = @Id
            ORDER BY x.created_date DESC, x.pk_id DESC
            LIMIT 200", new { K = access.Committee.Kind, access.Committee.Id })).ToList();
        foreach (var r in rows) r.CreatedDate = DateTime.SpecifyKind(r.CreatedDate, DateTimeKind.Utc);
        return rows;
    }

    /// <summary>Plain text to the HTML body of the email: escaped, line breaks kept.</summary>
    public static string ToHtml(string text) =>
        "<p>" + WebUtility.HtmlEncode(text.Replace("\r\n", "\n")).Replace("\n", "<br>") + "</p>";

    /// <summary>Sends a message to every member of the committee through the club's or district's mass email (its
    /// credits or allowance, its consent and suppression rules) and keeps it in the archive.
    /// Returns (archive id, null) or (0, error).</summary>
    public async Task<(int Id, string? Error)> SendMessageAsync(Access access, string? subject, string? body, int memberId, HttpContext http)
    {
        subject = subject?.Trim();
        body = body?.Trim();
        if (string.IsNullOrEmpty(subject) || subject.Length > 200) return (0, "Enter a subject of at most 200 characters.");
        if (string.IsNullOrEmpty(body) || body.Length > 20000) return (0, "Enter a message of at most 20,000 characters.");
        var k = access.Committee;

        await using var c = RowDb.Connect(_cs);
        var recent = await c.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM committee_messages
            WHERE committee_kind = @K AND fk_committee_id = @Id AND created_date > UTC_TIMESTAMP() - INTERVAL 1 DAY",
            new { K = k.Kind, k.Id });
        if (recent >= MaxMessagesPerDay) return (0, $"A committee can send at most {MaxMessagesPerDay} messages a day.");

        var sender = await c.QueryFirstOrDefaultAsync<(string? Name, string? Email)>(
            "SELECT MemberName, EmailId FROM member_master_profile WHERE pk_member_master_profile_id = @M", new { M = memberId });
        var fromName = $"{sender.Name ?? "Member"} ({k.Name})";
        var dto = new CreateMassEmailDto
        {
            FromName = fromName.Length > 100 ? fromName[..100] : fromName,
            ReplyName = sender.Name,
            ReplyEmail = string.IsNullOrWhiteSpace(sender.Email) ? null : sender.Email.Trim(),
            Subject = subject,
            EmailBody = ToHtml(body),
            SaveAsDraft = true,
        };
        int? districtId = null;
        if (k.Kind == Club)
        {
            dto.RecipientType = 2; // the club's sub group
            dto.SubgroupIds = new List<int> { k.Id };
        }
        else
        {
            // District committee members that are current members of a club in the district (the pipeline's own rule).
            dto.RecipientType = 3;
            dto.MemberIds = (await c.QueryAsync<int>(@"
                SELECT DISTINCT gm.fk_member_id FROM district_committee_group_member gm
                JOIN club_members cm ON cm.fk_member_master_profile_id = gm.fk_member_id AND cm.IsActive = 1 AND cm.isdeleted = 0
                JOIN club_master cl ON cl.pk_club_id = cm.fk_club_id AND cl.fk_district_id = @D
                WHERE gm.fk_group_id = @Id AND gm.fk_member_id IS NOT NULL AND IFNULL(gm.isdeleted, 0) = 0 AND IFNULL(gm.is_active, 1) = 1",
                new { D = k.ScopeId, k.Id })).ToList();
            if (dto.MemberIds.Count == 0) return (0, "This committee has no members with an email address.");
            districtId = k.ScopeId;
        }

        int emailId;
        try
        {
            emailId = await _mail.CreateAsync(k.Kind == Club ? k.ScopeId : 0, dto, memberId, districtId);
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException)
        {
            return (0, ex.Message);
        }
        try
        {
            await _mail.SendAsync(emailId, memberId);
        }
        catch (Exception ex) when (ex is InvalidOperationException or KeyNotFoundException)
        {
            await _mail.DeleteAsync(emailId, memberId); // still a draft: nothing went out, nothing to archive
            return (0, ex.Message);
        }

        var id = await c.ExecuteScalarAsync<int>(@"
            INSERT INTO committee_messages (committee_kind, fk_committee_id, fk_mass_email_id, sent_by, subject, body, created_date)
            VALUES (@K, @C, @E, @U, @S, @B, UTC_TIMESTAMP());
            SELECT LAST_INSERT_ID();",
            new { K = k.Kind, C = k.Id, E = emailId, U = memberId, S = subject, B = body });
        await _audit.LogAsync(memberId, "SEND", "committee_message", id, subject, new { k.Kind, committeeId = k.Id, massEmailId = emailId }, http);
        return (id, null);
    }
}

/// <summary>Pure tree rules for committees, kept apart so they can be unit tested.</summary>
public static class CommitteeTree
{
    /// <summary>True when giving <paramref name="id"/> the parent <paramref name="newParentId"/> would make a loop
    /// (including a committee under itself), given every committee's current parent.</summary>
    public static bool CreatesCycle(int id, int? newParentId, IReadOnlyDictionary<int, int?> parentOf)
    {
        var seen = new HashSet<int>();
        for (var p = newParentId; p.HasValue; p = parentOf.TryGetValue(p.Value, out var next) ? next : null)
            if (p.Value == id || !seen.Add(p.Value)) return true;
        return false;
    }

    /// <summary>The ids from the top committee down to <paramref name="id"/>. Stops at a loop or a missing parent.</summary>
    public static List<int> PathTo(int id, IReadOnlyDictionary<int, int?> parentOf)
    {
        var path = new List<int>();
        var seen = new HashSet<int>();
        for (int? p = id; p.HasValue && seen.Add(p.Value); p = parentOf.TryGetValue(p.Value, out var next) ? next : null)
            path.Add(p.Value);
        path.Reverse();
        return path;
    }
}
