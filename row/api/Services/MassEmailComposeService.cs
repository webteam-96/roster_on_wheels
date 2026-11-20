using System.Globalization;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

/// <summary>
/// Mass email compose upgrades (club and district): the template library (ROW starters plus templates the club or
/// district saved), merge fields filled per recipient at send time, file attachments and a per-sender signature.
/// An owner is a club (clubId, 0) or a district (0, districtId), like club_mass_emails.
/// </summary>
public class MassEmailComposeService
{
    private readonly string _cs;
    // Outside wwwroot: attachments are only served through MassEmailComposeController, after the scope check.
    private readonly string _fileRoot;

    public MassEmailComposeService(IConfiguration config, IWebHostEnvironment env)
    {
        _cs = config.GetConnectionString("DefaultConnection")!;
        _fileRoot = Path.Combine(env.ContentRootPath, "App_Data", "mass-email-files");
    }

    private MySqlConnection Open() => new(_cs);

    // ===== Merge fields =====

    public static readonly IReadOnlyList<MergeFieldDto> MergeFields = new[]
    {
        new MergeFieldDto("{{first_name}}", "First name"),
        new MergeFieldDto("{{member_name}}", "Full name"),
        new MergeFieldDto("{{email}}", "Email address"),
        new MergeFieldDto("{{club_name}}", "Club name"),
        new MergeFieldDto("{{district_number}}", "District number"),
        new MergeFieldDto("{{dues_amount}}", "Annual dues amount"),
    };

    private static readonly HashSet<string> Honorifics = new(StringComparer.OrdinalIgnoreCase)
    { "rtn", "rtn.", "dr", "dr.", "mr", "mr.", "mrs", "mrs.", "ms", "ms.", "pp", "pdg", "dg", "dge", "dgn", "ag", "prof", "prof." };

    /// <summary>The first name of a stored full name: the first word that is not a title ("Rtn. Dr. Asha Rao" is Asha).</summary>
    public static string FirstNameOf(string? fullName)
    {
        var words = (fullName ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return words.FirstOrDefault(w => !Honorifics.Contains(w)) ?? words.FirstOrDefault() ?? "";
    }

    /// <summary>What a send fills in per recipient, loaded once per campaign.</summary>
    public sealed class SendExtras
    {
        public string OwnerClubName { get; init; } = "";
        public string DistrictNumber { get; init; } = "";
        public Dictionary<int, string> MemberClub { get; init; } = new();
        public Dictionary<int, decimal> Dues { get; init; } = new();
        public decimal? DefaultDues { get; init; }
        public List<(string Name, byte[] Content)> Attachments { get; init; } = new();

        public Dictionary<string, string?> ValuesFor(CommsService.CampaignRecipient r)
        {
            decimal? dues = r.MemberId > 0 && Dues.TryGetValue(r.MemberId, out var d) ? d : DefaultDues;
            return new()
            {
                ["first_name"] = FirstNameOf(r.MemberName),
                ["member_name"] = r.MemberName ?? "",
                ["email"] = r.Email,
                ["club_name"] = OwnerClubName.Length > 0 ? OwnerClubName : MemberClub.GetValueOrDefault(r.MemberId, ""),
                ["district_number"] = DistrictNumber,
                ["dues_amount"] = dues?.ToString("N2", CultureInfo.InvariantCulture) ?? "",
            };
        }

        /// <summary>Fills the merge fields in an already rendered subject and body; unknown placeholders stay.</summary>
        public (string Subject, string Html) Merge(CommsService.CampaignRecipient r, string subject, string html)
        {
            var v = ValuesFor(r);
            return (CommsTemplates.Fill(subject, v, false), CommsTemplates.Fill(html, v, true));
        }

        public IReadOnlyList<(string Name, byte[] Content)>? AttachmentsOrNull => Attachments.Count > 0 ? Attachments : null;
    }

    /// <summary>Loads the merge values and attachment files a campaign send needs.</summary>
    public async Task<SendExtras> LoadSendExtrasAsync(MySqlConnection conn, int emailId, int clubId, int? districtId,
        IEnumerable<CommsService.CampaignRecipient> recipients)
    {
        var memberIds = recipients.Select(r => r.MemberId).Where(id => id > 0).Distinct().ToList();
        var ownerClub = clubId > 0
            ? await conn.ExecuteScalarAsync<string?>("SELECT ClubName FROM club_master WHERE pk_club_id = @clubId", new { clubId }) ?? ""
            : "";
        var districtNumber = await conn.ExecuteScalarAsync<string?>(@"
            SELECT d.DistrictNumber FROM district_master d
            WHERE d.pk_district_id = IF(@clubId > 0, (SELECT fk_district_id FROM club_master WHERE pk_club_id = @clubId), @districtId)",
            new { clubId, districtId = districtId ?? 0 }) ?? "";

        var memberClub = new Dictionary<int, string>();
        if (clubId == 0 && memberIds.Count > 0)
            foreach (var row in await conn.QueryAsync<(int MemberId, string ClubName)>(@"
                SELECT cm.fk_member_master_profile_id, MIN(c.ClubName)
                FROM club_members cm JOIN club_master c ON c.pk_club_id = cm.fk_club_id
                WHERE cm.fk_member_master_profile_id IN @memberIds AND cm.IsActive = 1 AND cm.isdeleted = 0
                GROUP BY cm.fk_member_master_profile_id", new { memberIds }))
                memberClub[row.MemberId] = row.ClubName;

        // Dues: the club's latest active membership dues setup; a member's own fee row wins over the default.
        var dues = new Dictionary<int, decimal>();
        decimal? defaultDues = null;
        if (clubId > 0)
        {
            var setup = (await conn.QueryAsync<(int Id, decimal Amount)>(@"
                SELECT pk_membership_dues_id, IFNULL(DefaultAnnualAmount, 0) FROM membership_dues
                WHERE fk_club_id = @clubId AND IFNULL(IsActive, 1) = 1 AND IFNULL(isdeleted, 0) = 0
                ORDER BY pk_membership_dues_id DESC LIMIT 1", new { clubId })).ToList();
            if (setup.Count > 0 && setup[0] is var s)
            {
                defaultDues = s.Amount;
                if (memberIds.Count > 0)
                    foreach (var row in await conn.QueryAsync<(int MemberId, decimal Amount)>(@"
                        SELECT fk_member_profile_id, IFNULL(AnnualAmount, 0) FROM membership_dues_member_fees
                        WHERE fk_membership_dues_id = @Id AND IFNULL(isdeleted, 0) = 0 AND fk_member_profile_id IN @memberIds",
                        new { s.Id, memberIds }))
                        dues[row.MemberId] = row.Amount;
            }
        }

        var attachments = new List<(string, byte[])>();
        foreach (var a in await conn.QueryAsync<(string FileName, string StoredName)>(
            "SELECT FileName, StoredName FROM mass_email_attachments WHERE fk_mass_email_id = @emailId AND isdeleted = 0 ORDER BY pk_attachment_id",
            new { emailId }))
        {
            var path = Path.Combine(_fileRoot, a.StoredName);
            if (!File.Exists(path)) throw new InvalidOperationException($"The attachment {a.FileName} is missing. Remove it and attach it again.");
            attachments.Add((a.FileName, await File.ReadAllBytesAsync(path)));
        }

        return new SendExtras
        {
            OwnerClubName = ownerClub, DistrictNumber = districtNumber, MemberClub = memberClub,
            Dues = dues, DefaultDues = defaultDues, Attachments = attachments,
        };
    }

    // ===== Templates =====

    private static MassEmailTemplateDto Starter(string key, string name, string subject, string body)
        => new() { Key = key, Name = name, Subject = subject, BodyHtml = body, IsStarter = true };

    // ROW's own starter texts (not RIZones content). Plain English; the admin edits them after picking one.
    public static readonly IReadOnlyList<MassEmailTemplateDto> Starters = new[]
    {
        Starter("meeting-reminder", "Meeting reminder", "Reminder: our next club meeting",
            "<p>Dear {{first_name}},</p><p>This is a reminder that {{club_name}} meets next on [date] at [time], at [venue].</p><p>Our programme: [speaker or topic].</p><p>Please reply if you cannot attend.</p>"),
        Starter("dues-reminder", "Dues reminder", "Your {{club_name}} dues",
            "<p>Dear {{first_name}},</p><p>Your annual dues for {{club_name}} are {{dues_amount}}. You can pay them in the ROW app under Membership Dues.</p><p>Thank you for supporting the work of our club.</p>"),
        Starter("newsletter", "Newsletter", "{{club_name}} news",
            "<p>Dear {{first_name}},</p><p><strong>Highlights</strong></p><p>[What happened since the last newsletter.]</p><p><strong>Coming up</strong></p><p>[Meetings, events and service projects.]</p><p><strong>Thank you</strong></p><p>[Members and partners to thank.]</p>"),
        Starter("event-invite", "Event invitation", "You are invited: [event name]",
            "<p>Dear {{first_name}},</p><p>{{club_name}} invites you to [event name] on [date] at [venue].</p><p>[What the event is about and who should come.]</p><p>Please register in the ROW app or reply to this email.</p>"),
        Starter("welcome", "Welcome new member", "Welcome to {{club_name}}",
            "<p>Dear {{first_name}},</p><p>Welcome to {{club_name}}. We are glad to have you with us.</p><p>Your ROW app has the meeting calendar, the member directory and your dues. Your mentor will be in touch this week.</p>"),
        Starter("district-announcement", "District announcement", "District {{district_number}}: [announcement]",
            "<p>Dear {{first_name}},</p><p>[The announcement, in two or three short paragraphs.]</p><p>What we ask of clubs: [action and deadline].</p>"),
    };

    private const string TemplateSelect = @"SELECT pk_template_id AS Id, Name, Subject, BodyHtml, IFNULL(modified_date, created_date) AS ModifiedDate
        FROM mass_email_templates WHERE fk_club_id = @clubId AND fk_district_id = @districtId AND isdeleted = 0";

    public async Task<MassEmailTemplateLibraryDto> GetLibraryAsync(int clubId, int districtId)
    {
        await using var c = Open();
        var saved = (await c.QueryAsync<MassEmailTemplateDto>(TemplateSelect + " ORDER BY Name", new { clubId, districtId })).ToList();
        return new MassEmailTemplateLibraryDto { Starters = Starters.ToList(), Saved = saved, MergeFields = MergeFields.ToList() };
    }

    private static (string Name, string Subject, string Body) Validate(SaveMassEmailTemplateDto dto)
    {
        var name = dto.Name?.Trim() ?? "";
        var subject = dto.Subject?.Trim() ?? "";
        var body = PublicHtml.Clean(dto.BodyHtml ?? "") ?? "";
        if (name.Length is 0 or > 120) throw new ArgumentException("Give the template a name of up to 120 characters.");
        if (subject.Length > 300) throw new ArgumentException("The subject is 300 characters at most.");
        if (body.Length > 200_000) throw new ArgumentException("The template body is too long.");
        if (subject.Length == 0 && body.Replace("<p>", "").Replace("</p>", "").Replace("<br>", "").Trim().Length == 0)
            throw new ArgumentException("A template needs a subject or a body.");
        return (name, subject, body);
    }

    public async Task<int> CreateTemplateAsync(int clubId, int districtId, SaveMassEmailTemplateDto dto, int userId)
    {
        var (name, subject, body) = Validate(dto);
        await using var c = Open();
        if (await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM mass_email_templates WHERE fk_club_id = @clubId AND fk_district_id = @districtId AND isdeleted = 0",
                new { clubId, districtId }) >= 200)
            throw new ArgumentException("You can keep up to 200 templates. Delete one first.");
        return await c.ExecuteScalarAsync<int>(@"
            INSERT INTO mass_email_templates (fk_club_id, fk_district_id, Name, Subject, BodyHtml, created_by, created_date, isdeleted)
            VALUES (@clubId, @districtId, @name, @subject, @body, @userId, UTC_TIMESTAMP(), 0); SELECT LAST_INSERT_ID();",
            new { clubId, districtId, name, subject, body, userId });
    }

    /// <summary>False when the template is not this owner's.</summary>
    public async Task<bool> UpdateTemplateAsync(int clubId, int districtId, int id, SaveMassEmailTemplateDto dto, int userId)
    {
        var (name, subject, body) = Validate(dto);
        await using var c = Open();
        return await c.ExecuteAsync(@"
            UPDATE mass_email_templates SET Name = @name, Subject = @subject, BodyHtml = @body, modified_by = @userId, modified_date = UTC_TIMESTAMP()
            WHERE pk_template_id = @id AND fk_club_id = @clubId AND fk_district_id = @districtId AND isdeleted = 0",
            new { id, clubId, districtId, name, subject, body, userId }) > 0;
    }

    public async Task<bool> DeleteTemplateAsync(int clubId, int districtId, int id, int userId)
    {
        await using var c = Open();
        return await c.ExecuteAsync(@"
            UPDATE mass_email_templates SET isdeleted = 1, modified_by = @userId, modified_date = UTC_TIMESTAMP()
            WHERE pk_template_id = @id AND fk_club_id = @clubId AND fk_district_id = @districtId AND isdeleted = 0",
            new { id, clubId, districtId, userId }) > 0;
    }

    // ===== Signature (per sender) =====

    public async Task<string> GetSignatureAsync(int memberId)
    {
        await using var c = Open();
        return await c.ExecuteScalarAsync<string?>("SELECT SignatureHtml FROM mass_email_signatures WHERE fk_member_id = @memberId", new { memberId }) ?? "";
    }

    public async Task<string> SaveSignatureAsync(int memberId, string? html)
    {
        var clean = PublicHtml.Clean(html?.Trim() ?? "") ?? "";
        if (clean.Length > 5000) throw new ArgumentException("The signature is 5000 characters at most.");
        await using var c = Open();
        await c.ExecuteAsync(@"
            INSERT INTO mass_email_signatures (fk_member_id, SignatureHtml, modified_date) VALUES (@memberId, @clean, UTC_TIMESTAMP())
            ON DUPLICATE KEY UPDATE SignatureHtml = VALUES(SignatureHtml), modified_date = UTC_TIMESTAMP()",
            new { memberId, clean });
        return clean;
    }

    // ===== Attachments =====

    public const int MaxFiles = 5;
    public const long MaxFileBytes = 5L * 1024 * 1024;
    public const long MaxTotalBytes = 10L * 1024 * 1024;

    private static readonly Dictionary<string, string> SafeTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        [".pdf"] = "application/pdf",
        [".doc"] = "application/msword",
        [".docx"] = "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        [".xls"] = "application/vnd.ms-excel",
        [".xlsx"] = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        [".ppt"] = "application/vnd.ms-powerpoint",
        [".pptx"] = "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        [".txt"] = "text/plain",
        [".csv"] = "text/csv",
        [".ics"] = "text/calendar",
        [".jpg"] = "image/jpeg",
        [".jpeg"] = "image/jpeg",
        [".png"] = "image/png",
        [".gif"] = "image/gif",
    };

    private static bool StartsWith(byte[] b, params byte[] sig) => b.Length >= sig.Length && b.AsSpan(0, sig.Length).SequenceEqual(sig);

    /// <summary>
    /// Null when the file may be attached, else the reason. The extension must be on the safe list and the content must
    /// look like that type (a renamed program is refused).
    /// </summary>
    public static string? CheckAttachment(string fileName, byte[] content)
    {
        var ext = Path.GetExtension(fileName ?? "");
        if (!SafeTypes.ContainsKey(ext))
            return "Only PDF, Word, Excel, PowerPoint, text, CSV, calendar (.ics) and JPG, PNG or GIF files can be attached.";
        if (content.Length == 0) return "The file is empty.";
        if (content.Length > MaxFileBytes) return "Each file can be 5 MB at most.";
        var ok = ext.ToLowerInvariant() switch
        {
            ".pdf" => StartsWith(content, (byte)'%', (byte)'P', (byte)'D', (byte)'F'),
            ".docx" or ".xlsx" or ".pptx" => StartsWith(content, 0x50, 0x4B, 0x03, 0x04),
            ".doc" or ".xls" or ".ppt" => StartsWith(content, 0xD0, 0xCF, 0x11, 0xE0),
            ".jpg" or ".jpeg" => StartsWith(content, 0xFF, 0xD8, 0xFF),
            ".png" => StartsWith(content, 0x89, 0x50, 0x4E, 0x47),
            ".gif" => StartsWith(content, (byte)'G', (byte)'I', (byte)'F', (byte)'8'),
            _ => Array.IndexOf(content, (byte)0, 0, Math.Min(content.Length, 8192)) < 0, // text: no NUL bytes
        };
        return ok ? null : "The file content does not match its type.";
    }

    public static string ContentTypeOf(string fileName) => SafeTypes.GetValueOrDefault(Path.GetExtension(fileName), "application/octet-stream");

    private static string SafeFileName(string fileName)
    {
        var name = Path.GetFileName(fileName ?? "").Trim();
        foreach (var ch in Path.GetInvalidFileNameChars()) name = name.Replace(ch, '_');
        name = name.Replace("\"", "_");
        return name.Length > 150 ? name[..100] + Path.GetExtension(name) : name;
    }

    public async Task<List<MassEmailAttachmentDto>> ListAttachmentsAsync(int emailId)
    {
        await using var c = Open();
        return (await c.QueryAsync<MassEmailAttachmentDto>(@"
            SELECT pk_attachment_id AS Id, FileName, ContentType, SizeBytes, created_date AS CreatedDate
            FROM mass_email_attachments WHERE fk_mass_email_id = @emailId AND isdeleted = 0 ORDER BY pk_attachment_id",
            new { emailId })).ToList();
    }

    private static async Task EnsureEditableAsync(MySqlConnection c, int emailId)
    {
        var status = await c.ExecuteScalarAsync<string?>("SELECT Status FROM club_mass_emails WHERE pk_mass_email_id = @emailId AND isdeleted = 0", new { emailId });
        if (status != "Draft" && status != "Failed")
            throw new InvalidOperationException("Attachments can only be changed while the email is a draft.");
    }

    public async Task<MassEmailAttachmentDto> AddAttachmentAsync(int emailId, string fileName, byte[] content, int userId)
    {
        var name = SafeFileName(fileName);
        if (CheckAttachment(name, content) is { } problem) throw new ArgumentException(problem);
        await using var c = Open();
        await EnsureEditableAsync(c, emailId);
        var (count, total) = await c.QueryFirstAsync<(long Count, long Total)>(
            "SELECT COUNT(*), IFNULL(SUM(SizeBytes), 0) FROM mass_email_attachments WHERE fk_mass_email_id = @emailId AND isdeleted = 0", new { emailId });
        if (count >= MaxFiles) throw new ArgumentException($"An email can carry {MaxFiles} files at most.");
        if (total + content.Length > MaxTotalBytes) throw new ArgumentException("All attachments together can be 10 MB at most.");

        Directory.CreateDirectory(_fileRoot);
        var stored = $"{Guid.NewGuid():N}{Path.GetExtension(name).ToLowerInvariant()}";
        await File.WriteAllBytesAsync(Path.Combine(_fileRoot, stored), content);
        var type = ContentTypeOf(name);
        var id = await c.ExecuteScalarAsync<int>(@"
            INSERT INTO mass_email_attachments (fk_mass_email_id, FileName, StoredName, ContentType, SizeBytes, created_by, created_date, isdeleted)
            VALUES (@emailId, @name, @stored, @type, @size, @userId, UTC_TIMESTAMP(), 0); SELECT LAST_INSERT_ID();",
            new { emailId, name, stored, type, size = content.Length, userId });
        return new MassEmailAttachmentDto { Id = id, FileName = name, ContentType = type, SizeBytes = content.Length, CreatedDate = DateTime.UtcNow };
    }

    /// <summary>Copies a campaign's attachments (rows and files) onto another campaign, so deleting one copy never
    /// removes the other's file. Used by resend-to-non-openers. A missing source file is skipped.</summary>
    public async Task CopyAttachmentsAsync(MySqlConnection c, MySqlTransaction tx, int fromEmailId, int toEmailId, int userId)
    {
        var rows = await c.QueryAsync<(string FileName, string StoredName, string ContentType, long SizeBytes)>(@"
            SELECT FileName, StoredName, ContentType, SizeBytes FROM mass_email_attachments
            WHERE fk_mass_email_id = @fromEmailId AND isdeleted = 0 ORDER BY pk_attachment_id", new { fromEmailId }, tx);
        foreach (var a in rows)
        {
            var src = Path.Combine(_fileRoot, a.StoredName);
            if (!File.Exists(src)) continue;
            var stored = $"{Guid.NewGuid():N}{Path.GetExtension(a.StoredName)}";
            File.Copy(src, Path.Combine(_fileRoot, stored));
            await c.ExecuteAsync(@"
                INSERT INTO mass_email_attachments (fk_mass_email_id, FileName, StoredName, ContentType, SizeBytes, created_by, created_date, isdeleted)
                VALUES (@toEmailId, @FileName, @stored, @ContentType, @SizeBytes, @userId, UTC_TIMESTAMP(), 0)",
                new { toEmailId, a.FileName, stored, a.ContentType, a.SizeBytes, userId }, tx);
        }
    }

    public async Task<bool> DeleteAttachmentAsync(int emailId, int attachmentId)
    {
        await using var c = Open();
        await EnsureEditableAsync(c, emailId);
        var stored = await c.ExecuteScalarAsync<string?>(
            "SELECT StoredName FROM mass_email_attachments WHERE pk_attachment_id = @attachmentId AND fk_mass_email_id = @emailId AND isdeleted = 0",
            new { attachmentId, emailId });
        if (stored == null) return false;
        await c.ExecuteAsync("UPDATE mass_email_attachments SET isdeleted = 1 WHERE pk_attachment_id = @attachmentId", new { attachmentId });
        var path = Path.Combine(_fileRoot, stored);
        if (File.Exists(path)) File.Delete(path);
        return true;
    }

    public async Task<(string FileName, string ContentType, byte[] Content)?> ReadAttachmentAsync(int emailId, int attachmentId)
    {
        await using var c = Open();
        var rows = (await c.QueryAsync<(string FileName, string ContentType, string StoredName)>(@"
            SELECT FileName, ContentType, StoredName FROM mass_email_attachments
            WHERE pk_attachment_id = @attachmentId AND fk_mass_email_id = @emailId AND isdeleted = 0", new { attachmentId, emailId })).ToList();
        if (rows.Count == 0) return null;
        var r = rows[0];
        var path = Path.Combine(_fileRoot, r.StoredName);
        return File.Exists(path) ? (r.FileName, r.ContentType, await File.ReadAllBytesAsync(path)) : null;
    }
}
