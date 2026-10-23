using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class ClubMassEmailService : IClubMassEmailService
{
    private readonly string _connectionString;
    private readonly IEmailService _emailService;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ICreditManagementService _creditService;
    private readonly CommsService _comms;
    private readonly ILogger<ClubMassEmailService> _logger;

    public ClubMassEmailService(
        IConfiguration configuration,
        IEmailService emailService,
        IServiceScopeFactory scopeFactory,
        ICreditManagementService creditService,
        CommsService comms,
        ILogger<ClubMassEmailService> logger)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _emailService = emailService;
        _scopeFactory = scopeFactory;
        _creditService = creditService;
        _comms = comms;
        _logger = logger;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    private static readonly System.Text.RegularExpressions.Regex TemplateKeyFormat = new(@"^[a-z0-9][a-z0-9_-]{0,49}$");

    /// <summary>N5: the optional template key whose language versions a send uses; null when blank.</summary>
    private static string? TemplateKeyOf(CreateMassEmailDto dto)
    {
        var key = string.IsNullOrWhiteSpace(dto.TemplateKey) ? null : dto.TemplateKey.Trim().ToLowerInvariant();
        if (key != null && !TemplateKeyFormat.IsMatch(key)) throw new InvalidOperationException("Unknown template key.");
        return key;
    }

    /// <summary>True when the campaign belongs to this club (clubId) or district (districtId); guards every id route.</summary>
    public async Task<bool> BelongsToAsync(int id, int? clubId, int? districtId)
    {
        using var connection = CreateConnection();
        return await connection.ExecuteScalarAsync<int>(clubId.HasValue
            ? "SELECT COUNT(*) FROM club_mass_emails WHERE pk_mass_email_id = @Id AND fk_club_id = @ClubId AND fk_club_id > 0 AND isdeleted = 0"
            : "SELECT COUNT(*) FROM club_mass_emails WHERE pk_mass_email_id = @Id AND fk_club_id = 0 AND fk_district_id = @DistrictId AND isdeleted = 0",
            new { Id = id, ClubId = clubId, DistrictId = districtId }) > 0;
    }

    public async Task<(List<MassEmailListDto> Items, int TotalCount)> GetListAsync(
        int clubId, string? status, string? search, int page, int pageSize, int? districtId = null)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var ownerCondition = districtId.HasValue ? "me.fk_district_id = @OwnerId" : "me.fk_club_id = @OwnerId";
        var ownerId = districtId.HasValue ? districtId.Value : clubId;

        var conditions = new List<string> { ownerCondition, "me.isdeleted = 0" };
        if (!string.IsNullOrEmpty(status)) conditions.Add("me.Status = @Status");
        if (!string.IsNullOrEmpty(search)) conditions.Add("me.Subject LIKE CONCAT('%', @Search, '%')");

        var whereClause = string.Join(" AND ", conditions);

        var sql = $@"
            SELECT me.pk_mass_email_id AS Id, me.Subject, me.Status, me.RecipientType,
                   me.TotalRecipients, me.SentCount, me.FailedCount, me.SentDate,
                   me.created_date AS CreatedDate
            FROM club_mass_emails me
            WHERE {whereClause}
            ORDER BY me.created_date DESC
            LIMIT @PageSize OFFSET @Offset;

            SELECT COUNT(*) FROM club_mass_emails me
            WHERE {whereClause};";

        using var multi = await connection.QueryMultipleAsync(sql, new
        {
            OwnerId = ownerId,
            Status = status ?? "",
            Search = search ?? "",
            PageSize = pageSize,
            Offset = (page - 1) * pageSize
        });

        var items = (await multi.ReadAsync<MassEmailListDto>()).ToList();
        var totalCount = await multi.ReadSingleAsync<int>();
        return (items, totalCount);
    }

    public async Task<MassEmailDetailDto?> GetDetailAsync(int id)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var detail = await connection.QueryFirstOrDefaultAsync<MassEmailDetailDto>(
            @"SELECT me.pk_mass_email_id AS Id, me.fk_club_id AS FkClubId, me.RecipientType,
                     me.fk_subgroup_id AS FkSubgroupId, sg.GroupName AS SubgroupName, me.ContactGroupIds AS ContactGroupIdsCsv,
                     me.FromName, me.ReplyName, me.ReplyEmail, me.Subject, me.EmailBody,
                     me.Status, me.TotalRecipients, me.SentCount, me.FailedCount,
                     me.SentDate, me.created_date AS CreatedDate, me.TemplateKey
              FROM club_mass_emails me
              LEFT JOIN sub_groups sg ON sg.pk_sub_group_id = me.fk_subgroup_id
              WHERE me.pk_mass_email_id = @Id AND me.isdeleted = 0",
            new { Id = id });

        if (detail != null)
        {
            detail.Recipients = (await connection.QueryAsync<MassEmailRecipientDto>(
                @"SELECT r.fk_member_id AS MemberId, r.MemberName, r.Email, r.Status,
                         r.SentDate, r.ErrorMessage
                  FROM club_mass_email_recipients r
                  WHERE r.fk_mass_email_id = @Id AND r.isdeleted = 0
                  ORDER BY r.MemberName",
                new { Id = id })).ToList();
        }

        return detail;
    }

    public async Task<int> CreateAsync(int clubId, CreateMassEmailDto dto, int userId, int? districtId = null)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var status = dto.SaveAsDraft ? "Draft" : "Draft"; // Always start as draft, send is separate

        var emailId = await connection.ExecuteScalarAsync<int>(
            @"INSERT INTO club_mass_emails (fk_club_id, fk_district_id, RecipientType, fk_subgroup_id, ContactGroupIds, FromName,
                  ReplyName, ReplyEmail, Subject, EmailBody, Status, TotalRecipients, TemplateKey,
                  created_by, created_date, isdeleted)
              VALUES (@ClubId, @DistrictId, @RecipientType, @SubgroupId, @ContactGroupIds, @FromName,
                  @ReplyName, @ReplyEmail, @Subject, @EmailBody, @Status, 0, @TemplateKey,
                  @UserId, NOW(), 0);
              SELECT LAST_INSERT_ID();",
            new
            {
                ClubId = districtId.HasValue ? 0 : clubId,
                DistrictId = districtId,
                dto.RecipientType,
                SubgroupId = dto.SubgroupIds?.Count > 0 ? dto.SubgroupIds[0] : dto.FkSubgroupId,
                ContactGroupIds = ContactGroupCsv(dto),
                dto.FromName,
                dto.ReplyName,
                dto.ReplyEmail,
                dto.Subject,
                dto.EmailBody,
                Status = status,
                TemplateKey = TemplateKeyOf(dto),
                UserId = userId
            });

        // Add recipients
        var sgIds = dto.SubgroupIds ?? (dto.FkSubgroupId.HasValue ? new List<int> { dto.FkSubgroupId.Value } : null);
        await AddRecipientsAsync(connection, emailId, clubId, dto.RecipientType, sgIds, dto.MemberIds, districtId, dto.ClubIds, dto.ContactGroupIds);

        return emailId;
    }

    private static string? ContactGroupCsv(CreateMassEmailDto dto)
        => dto.RecipientType == 4 && dto.ContactGroupIds?.Count > 0 ? string.Join(",", dto.ContactGroupIds.Distinct()) : null;

    public async Task UpdateAsync(int id, CreateMassEmailDto dto, int userId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Reset status to Draft on edit, reset counts
        await connection.ExecuteAsync(
            @"UPDATE club_mass_emails SET RecipientType = @RecipientType, fk_subgroup_id = @SubgroupId, ContactGroupIds = @ContactGroupIds,
                  FromName = @FromName, ReplyName = @ReplyName, ReplyEmail = @ReplyEmail,
                  Subject = @Subject, EmailBody = @EmailBody, TemplateKey = @TemplateKey,
                  Status = 'Draft', SentCount = 0, FailedCount = 0, SentDate = NULL,
                  modified_by = @UserId, modified_date = NOW()
              WHERE pk_mass_email_id = @Id AND isdeleted = 0",
            new
            {
                dto.RecipientType,
                SubgroupId = dto.SubgroupIds?.Count > 0 ? dto.SubgroupIds[0] : dto.FkSubgroupId,
                ContactGroupIds = ContactGroupCsv(dto),
                dto.FromName,
                dto.ReplyName,
                dto.ReplyEmail,
                dto.Subject,
                dto.EmailBody,
                TemplateKey = TemplateKeyOf(dto),
                UserId = userId,
                Id = id
            });

        // Remove old recipients and add new
        await connection.ExecuteAsync(
            "UPDATE club_mass_email_recipients SET isdeleted = 1 WHERE fk_mass_email_id = @Id",
            new { Id = id });

        // District emails are stored with fk_club_id 0: pass the district so its recipients resolve.
        var (clubId, districtId) = await connection.QueryFirstAsync<(int, int?)>(
            "SELECT fk_club_id, fk_district_id FROM club_mass_emails WHERE pk_mass_email_id = @Id",
            new { Id = id });

        var sgIds = dto.SubgroupIds ?? (dto.FkSubgroupId.HasValue ? new List<int> { dto.FkSubgroupId.Value } : null);
        await AddRecipientsAsync(connection, id, clubId, dto.RecipientType, sgIds, dto.MemberIds,
            clubId == 0 && districtId > 0 ? districtId : null, dto.ClubIds, dto.ContactGroupIds);
    }

    public async Task DeleteAsync(int id, int userId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var currentStatus = await connection.ExecuteScalarAsync<string>(
            "SELECT Status FROM club_mass_emails WHERE pk_mass_email_id = @Id AND isdeleted = 0",
            new { Id = id });

        if (currentStatus != "Draft")
            throw new InvalidOperationException("Only draft emails can be deleted.");

        await connection.ExecuteAsync(
            @"UPDATE club_mass_emails SET isdeleted = 1, modified_by = @UserId, modified_date = NOW()
              WHERE pk_mass_email_id = @Id",
            new { Id = id, UserId = userId });

        await connection.ExecuteAsync(
            "UPDATE club_mass_email_recipients SET isdeleted = 1 WHERE fk_mass_email_id = @Id",
            new { Id = id });
    }

    public async Task SendAsync(int id, int userId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Get email details
        var commsOn = await _comms.IsOnAsync();
        var email = await connection.QueryFirstOrDefaultAsync<dynamic>(
            @"SELECT pk_mass_email_id AS Id, fk_club_id AS ClubId, fk_district_id AS DistrictId, FromName, ReplyName, ReplyEmail,
                     Subject, EmailBody, Status, TemplateKey
              FROM club_mass_emails WHERE pk_mass_email_id = @Id AND isdeleted = 0",
            new { Id = id });

        if (email == null) throw new KeyNotFoundException("Mass email not found.");
        if ((string)email.Status != "Draft" && (string)email.Status != "Failed")
            throw new InvalidOperationException("Only draft or failed emails can be sent.");

        // Get recipients with email (and their language, for the N5 language versions)
        var recipients = (await connection.QueryAsync<CommsService.CampaignRecipient>(
            @"SELECT r.pk_id AS Id, r.fk_member_id AS MemberId, r.MemberName, r.Email, m.PrimaryLanguage AS Language
              FROM club_mass_email_recipients r
              LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = r.fk_member_id
              WHERE r.fk_mass_email_id = @Id AND r.isdeleted = 0
                AND r.Email IS NOT NULL AND r.Email != ''
                AND (r.Status = 'Pending' OR r.Status = 'Failed')",
            new { Id = id })).ToList();

        if (recipients.Count == 0)
            throw new InvalidOperationException("No recipients with valid email addresses.");

        // N5 (module on): unsubscribed and suppressed members are skipped, the monthly allowance replaces credits,
        // each member gets the template version in their language with an unsubscribe link, Brevo's id is kept.
        CommsService.CampaignPlan? plan = null;
        if (commsOn)
        {
            var prevStatus = (string)email.Status;
            if (await connection.ExecuteAsync("UPDATE club_mass_emails SET Status = 'Sending' WHERE pk_mass_email_id = @Id AND Status = @Prev",
                    new { Id = id, Prev = prevStatus }) == 0)
                throw new InvalidOperationException("This email is already being sent.");
            try
            {
                var tenant = (int)email.ClubId > 0
                    ? new CommsService.Tenant((int)email.ClubId, 0)
                    : new CommsService.Tenant(0, (int?)email.DistrictId ?? 0);
                plan = await _comms.PlanCampaignAsync(connection, tenant, (string?)email.TemplateKey, recipients);
            }
            catch
            {
                await connection.ExecuteAsync("UPDATE club_mass_emails SET Status = @Prev WHERE pk_mass_email_id = @Id", new { Id = id, Prev = prevStatus });
                throw;
            }
        }
        else
        {
            // Check credits
            int clubId = (int)email.ClubId;
            var hasCreds = await _creditService.HasSufficientCreditsAsync(clubId, "Email", recipients.Count);
            if (!hasCreds)
                throw new InvalidOperationException($"Insufficient email credits. Need {recipients.Count}, check your credit balance.");

            // Deduct credits upfront with history
            await _creditService.DeductWithHistoryAsync(clubId, "Email", recipients.Count, "MassEmail", id, $"Mass Email: {(string)email.Subject}", userId);
        }

        // Update status to Sending
        await connection.ExecuteAsync(
            @"UPDATE club_mass_emails SET Status = 'Sending', TotalRecipients = @Total,
                  modified_by = @UserId, modified_date = NOW()
              WHERE pk_mass_email_id = @Id",
            new { Total = recipients.Count, UserId = userId, Id = id });

        // Fire-and-forget email sending
        var emailId = id;
        var subject = (string)email.Subject;
        var body = (string?)email.EmailBody ?? "";
        var fromName = (string)email.FromName;
        var replyName = (string?)email.ReplyName;
        var replyEmail = (string?)email.ReplyEmail;
        if (plan != null)
        {
            if (string.IsNullOrWhiteSpace(fromName)) fromName = plan.FromName ?? fromName;
            if (string.IsNullOrWhiteSpace(replyEmail)) { replyEmail = plan.ReplyTo; replyName = null; }
        }
        var recipientsCopy = plan?.ToSend ?? recipients;
        var connStr = _connectionString;

        _ = Task.Run(async () =>
        {
            try
            {
                using var scope = _scopeFactory.CreateScope();
                var emailSvc = scope.ServiceProvider.GetRequiredService<IEmailService>();
                using var conn = new MySqlConnection(connStr);
                await conn.OpenAsync();

                int sentCount = 0;
                int failedCount = 0;

                foreach (var r in recipientsCopy)
                {
                    try
                    {
                        if (plan == null)
                        {
                            await emailSvc.SendMassEmailAsync(r.Email, subject, body, fromName, replyName, replyEmail);
                            await conn.ExecuteAsync(
                                "UPDATE club_mass_email_recipients SET Status = 'Sent', SentDate = NOW() WHERE pk_id = @Id",
                                new { r.Id });
                        }
                        else
                        {
                            var (s, html, language) = plan.Render(r, subject, body);
                            var messageId = await emailSvc.SendMassEmailAsync(r.Email, s, html, fromName, replyName, replyEmail, plan.FromEmail, plan.Headers(r));
                            await conn.ExecuteAsync(
                                "UPDATE club_mass_email_recipients SET Status = 'Sent', SentDate = NOW(), MessageId = @MessageId, Language = @Language WHERE pk_id = @Id",
                                new { r.Id, MessageId = messageId, Language = language });
                        }
                        sentCount++;
                    }
                    catch (Exception ex)
                    {
                        await conn.ExecuteAsync(
                            "UPDATE club_mass_email_recipients SET Status = 'Failed', ErrorMessage = @Error WHERE pk_id = @Id",
                            new { Error = ex.Message.Length > 500 ? ex.Message[..500] : ex.Message, r.Id });
                        failedCount++;
                    }
                }

                if (plan != null) await CommsService.ReleaseAsync(conn, plan, failedCount);
                var finalStatus = failedCount == recipientsCopy.Count ? "Failed" : "Sent";
                await conn.ExecuteAsync(
                    @"UPDATE club_mass_emails SET Status = @Status, SentCount = @Sent, FailedCount = @Failed,
                          SentDate = NOW(), modified_date = NOW()
                      WHERE pk_mass_email_id = @Id",
                    new { Status = finalStatus, Sent = sentCount, Failed = failedCount, Id = emailId });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error sending mass email {EmailId}", emailId);
                try
                {
                    using var conn = new MySqlConnection(connStr);
                    await conn.OpenAsync();
                    await conn.ExecuteAsync(
                        "UPDATE club_mass_emails SET Status = 'Failed', modified_date = NOW() WHERE pk_mass_email_id = @Id",
                        new { Id = emailId });
                }
                catch { /* ignore */ }
            }
        });
    }

    public async Task<List<MassEmailRecipientDto>> GetRecipientsAsync(int id)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        return (await connection.QueryAsync<MassEmailRecipientDto>(
            @"SELECT r.fk_member_id AS MemberId, r.MemberName, r.Email, r.Status,
                     r.SentDate, r.ErrorMessage
              FROM club_mass_email_recipients r
              WHERE r.fk_mass_email_id = @Id AND r.isdeleted = 0
              ORDER BY r.MemberName",
            new { Id = id })).ToList();
    }

    public async Task<RecipientCountDto> GetRecipientCountAsync(int clubId, int recipientType, List<int>? subgroupIds, List<int>? memberIds, int? districtId = null, List<int>? clubIds = null, List<int>? contactGroupIds = null)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        string sql;
        object param;

        if (recipientType == 4) // Contact groups (club or district) - only groups of this owner count
        {
            if (contactGroupIds == null || contactGroupIds.Count == 0) return new RecipientCountDto();
            return await connection.QueryFirstAsync<RecipientCountDto>(
                $"SELECT COUNT(DISTINCT c.pk_contact_id) AS TotalMembers, {ContactEmailCount} AS MembersWithEmail {ContactGroupFrom}",
                ContactGroupArgs(clubId, districtId, contactGroupIds));
        }

        // Kill-switch: skip recipients whose chain (club→district→zone) has any inactive link.
        if (recipientType == 1) // All Members
        {
            if (districtId.HasValue)
            {
                sql = @"SELECT COUNT(DISTINCT m.pk_member_master_profile_id) AS TotalMembers,
                               COUNT(DISTINCT CASE WHEN m.EmailId IS NOT NULL AND m.EmailId != '' THEN LOWER(TRIM(m.EmailId)) END) AS MembersWithEmail
                        FROM member_master_profile m
                        INNER JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
                        INNER JOIN club_master c ON c.pk_club_id = cm.fk_club_id
                        INNER JOIN district_master d ON d.pk_district_id = c.fk_district_id
                        INNER JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
                        WHERE c.fk_district_id = @DistrictId
                          AND cm.IsActive = 1 AND cm.isdeleted = 0
                          AND c.IsActive = 1 AND c.isdeleted = 0
                          AND d.IsActive = 1 AND d.isdeleted = 0
                          AND z.IsActive = 1 AND z.isdeleted = 0
                          AND m.isdeleted = 0";
                param = new { DistrictId = districtId.Value };
            }
            else
            {
                sql = @"SELECT COUNT(DISTINCT m.pk_member_master_profile_id) AS TotalMembers,
                               COUNT(DISTINCT CASE WHEN m.EmailId IS NOT NULL AND m.EmailId != '' THEN LOWER(TRIM(m.EmailId)) END) AS MembersWithEmail
                        FROM member_master_profile m
                        INNER JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
                        INNER JOIN club_master c ON c.pk_club_id = cm.fk_club_id
                        INNER JOIN district_master d ON d.pk_district_id = c.fk_district_id
                        INNER JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
                        WHERE cm.fk_club_id = @ClubId
                          AND cm.IsActive = 1 AND cm.isdeleted = 0
                          AND c.IsActive = 1 AND c.isdeleted = 0
                          AND d.IsActive = 1 AND d.isdeleted = 0
                          AND z.IsActive = 1 AND z.isdeleted = 0
                          AND m.isdeleted = 0";
                param = new { ClubId = clubId };
            }
        }
        else if (recipientType == 2 && clubIds != null && clubIds.Count > 0) // Selected Clubs (district level)
        {
            sql = @"SELECT COUNT(DISTINCT m.pk_member_master_profile_id) AS TotalMembers,
                           COUNT(DISTINCT CASE WHEN m.EmailId IS NOT NULL AND m.EmailId != '' THEN LOWER(TRIM(m.EmailId)) END) AS MembersWithEmail
                    FROM member_master_profile m
                    INNER JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
                    INNER JOIN club_master c ON c.pk_club_id = cm.fk_club_id
                    INNER JOIN district_master d ON d.pk_district_id = c.fk_district_id
                    INNER JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
                    WHERE cm.fk_club_id IN @ClubIds
                      AND cm.IsActive = 1 AND cm.isdeleted = 0
                      AND c.IsActive = 1 AND c.isdeleted = 0
                      AND d.IsActive = 1 AND d.isdeleted = 0
                      AND z.IsActive = 1 AND z.isdeleted = 0
                      AND m.isdeleted = 0";
            param = new { ClubIds = clubIds };
        }
        else if (recipientType == 2 && subgroupIds != null && subgroupIds.Count > 0) // Subgroups (club level)
        {
            sql = @"SELECT COUNT(DISTINCT m.pk_member_master_profile_id) AS TotalMembers,
                           COUNT(DISTINCT CASE WHEN m.EmailId IS NOT NULL AND m.EmailId != '' THEN LOWER(TRIM(m.EmailId)) END) AS MembersWithEmail
                    FROM member_master_profile m
                    INNER JOIN sub_group_members sgm ON sgm.fk_member_master_profile_id = m.pk_member_master_profile_id
                    WHERE sgm.fk_sub_group_id IN @SubgroupIds AND sgm.isdeleted = 0 AND m.isdeleted = 0";
            param = new { SubgroupIds = subgroupIds };
        }
        else if (recipientType == 3 && subgroupIds != null && subgroupIds.Count > 0) // Subgroups (district level)
        {
            sql = @"SELECT COUNT(DISTINCT m.pk_member_master_profile_id) AS TotalMembers,
                           COUNT(DISTINCT CASE WHEN m.EmailId IS NOT NULL AND m.EmailId != '' THEN LOWER(TRIM(m.EmailId)) END) AS MembersWithEmail
                    FROM member_master_profile m
                    INNER JOIN sub_group_members sgm ON sgm.fk_member_master_profile_id = m.pk_member_master_profile_id
                    WHERE sgm.fk_sub_group_id IN @SubgroupIds AND sgm.isdeleted = 0 AND m.isdeleted = 0";
            param = new { SubgroupIds = subgroupIds };
        }
        else if (recipientType == 3 && memberIds != null && memberIds.Count > 0) // Manual (club level)
        {
            sql = @"SELECT COUNT(*) AS TotalMembers,
                           COUNT(DISTINCT CASE WHEN m.EmailId IS NOT NULL AND m.EmailId != '' THEN LOWER(TRIM(m.EmailId)) END) AS MembersWithEmail
                    FROM member_master_profile m
                    WHERE m.pk_member_master_profile_id IN @MemberIds AND m.isdeleted = 0";
            param = new { MemberIds = memberIds };
        }
        else
        {
            return new RecipientCountDto();
        }

        var result = await connection.QueryFirstOrDefaultAsync<RecipientCountDto>(sql, param);
        return result ?? new RecipientCountDto();
    }

    // Contact groups (recipient type 4): only groups owned by the email's club or district are read, so a group id
    // of another club adds nobody.
    private const string ContactGroupFrom = @"
        FROM contact_group_members gm
        JOIN contact_groups g ON g.pk_contact_group_id = gm.fk_contact_group_id
        JOIN contacts c ON c.pk_contact_id = gm.fk_contact_id
        WHERE gm.fk_contact_group_id IN @Ids AND g.fk_club_id = @ClubId AND g.fk_district_id = @DistrictId";
    private const string ContactEmailCount = "COUNT(DISTINCT CASE WHEN c.email IS NOT NULL AND c.email != '' THEN LOWER(TRIM(c.email)) END)";
    private static object ContactGroupArgs(int clubId, int? districtId, List<int> ids)
        => new { Ids = ids, ClubId = districtId.HasValue ? 0 : clubId, DistrictId = districtId ?? 0 };

    private async Task AddRecipientsAsync(MySqlConnection connection, int emailId, int clubId,
        int recipientType, List<int>? subgroupIds, List<int>? memberIds, int? districtId = null, List<int>? clubIds = null,
        List<int>? contactGroupIds = null)
    {
        List<dynamic> members;

        if (recipientType == 4 && contactGroupIds?.Count > 0) // Contact groups (club or district)
        {
            // shortcut: contacts get no unsubscribe link yet; add it with the communication upgrades module
            // (unsubscribe on every bulk message, plan module 6).
            if (!await FeatureGate.IsOnAsync("contacts_growth", _connectionString))
                throw new InvalidOperationException("Contacts are switched off.");
            members = (await connection.QueryAsync<dynamic>(
                $"SELECT DISTINCT 0 AS MemberId, c.pk_contact_id AS ContactId, c.name AS MemberName, c.email AS Email {ContactGroupFrom}",
                ContactGroupArgs(clubId, districtId, contactGroupIds))).ToList();
        }
        // Kill-switch: skip recipients whose chain (club→district→zone) has any inactive link.
        else if (recipientType == 1) // All Members
        {
            if (districtId.HasValue)
            {
                members = (await connection.QueryAsync<dynamic>(
                    @"SELECT DISTINCT m.pk_member_master_profile_id AS MemberId, m.MemberName, m.EmailId AS Email
                      FROM member_master_profile m
                      INNER JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
                      INNER JOIN club_master c ON c.pk_club_id = cm.fk_club_id
                      INNER JOIN district_master d ON d.pk_district_id = c.fk_district_id
                      INNER JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
                      WHERE c.fk_district_id = @DistrictId
                        AND cm.IsActive = 1 AND cm.isdeleted = 0
                        AND c.IsActive = 1 AND c.isdeleted = 0
                        AND d.IsActive = 1 AND d.isdeleted = 0
                        AND z.IsActive = 1 AND z.isdeleted = 0
                        AND m.isdeleted = 0",
                    new { DistrictId = districtId.Value })).ToList();
            }
            else
            {
                members = (await connection.QueryAsync<dynamic>(
                    @"SELECT m.pk_member_master_profile_id AS MemberId, m.MemberName, m.EmailId AS Email
                      FROM member_master_profile m
                      INNER JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
                      INNER JOIN club_master c ON c.pk_club_id = cm.fk_club_id
                      INNER JOIN district_master d ON d.pk_district_id = c.fk_district_id
                      INNER JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
                      WHERE cm.fk_club_id = @ClubId
                        AND cm.IsActive = 1 AND cm.isdeleted = 0
                        AND c.IsActive = 1 AND c.isdeleted = 0
                        AND d.IsActive = 1 AND d.isdeleted = 0
                        AND z.IsActive = 1 AND z.isdeleted = 0
                        AND m.isdeleted = 0",
                    new { ClubId = clubId })).ToList();
            }
        }
        else if (recipientType == 2 && clubIds != null && clubIds.Count > 0) // Selected Clubs (district level)
        {
            members = (await connection.QueryAsync<dynamic>(
                @"SELECT DISTINCT m.pk_member_master_profile_id AS MemberId, m.MemberName, m.EmailId AS Email
                  FROM member_master_profile m
                  INNER JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
                  INNER JOIN club_master c ON c.pk_club_id = cm.fk_club_id
                  INNER JOIN district_master d ON d.pk_district_id = c.fk_district_id
                  INNER JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
                  WHERE cm.fk_club_id IN @ClubIds
                    AND cm.IsActive = 1 AND cm.isdeleted = 0
                    AND c.IsActive = 1 AND c.isdeleted = 0
                    AND d.IsActive = 1 AND d.isdeleted = 0
                    AND z.IsActive = 1 AND z.isdeleted = 0
                    AND m.isdeleted = 0",
                new { ClubIds = clubIds })).ToList();
        }
        else if (recipientType == 2 && subgroupIds != null && subgroupIds.Count > 0) // Subgroups (club level)
        {
            members = (await connection.QueryAsync<dynamic>(
                @"SELECT DISTINCT m.pk_member_master_profile_id AS MemberId, m.MemberName, m.EmailId AS Email
                  FROM member_master_profile m
                  INNER JOIN sub_group_members sgm ON sgm.fk_member_master_profile_id = m.pk_member_master_profile_id
                  WHERE sgm.fk_sub_group_id IN @SubgroupIds AND sgm.isdeleted = 0 AND m.isdeleted = 0",
                new { SubgroupIds = subgroupIds })).ToList();
        }
        else if (recipientType == 3 && subgroupIds != null && subgroupIds.Count > 0) // Subgroups (district level)
        {
            members = (await connection.QueryAsync<dynamic>(
                @"SELECT DISTINCT m.pk_member_master_profile_id AS MemberId, m.MemberName, m.EmailId AS Email
                  FROM member_master_profile m
                  INNER JOIN sub_group_members sgm ON sgm.fk_member_master_profile_id = m.pk_member_master_profile_id
                  WHERE sgm.fk_sub_group_id IN @SubgroupIds AND sgm.isdeleted = 0 AND m.isdeleted = 0",
                new { SubgroupIds = subgroupIds })).ToList();
        }
        else if (recipientType == 3 && memberIds != null && memberIds.Count > 0) // Manual
        {
            members = (await connection.QueryAsync<dynamic>(
                @"SELECT m.pk_member_master_profile_id AS MemberId, m.MemberName, m.EmailId AS Email
                  FROM member_master_profile m
                  WHERE m.pk_member_master_profile_id IN @MemberIds AND m.isdeleted = 0",
                new { MemberIds = memberIds })).ToList();
        }
        else
        {
            return;
        }

        // Only insert recipients with a valid email AND deduplicate by email
        // address (case-insensitive, trimmed). This matches the compose
        // recipient-count query which uses COUNT(DISTINCT LOWER(TRIM(email))).
        //
        // Two reasons to dedupe by email, not just member_id:
        //   1. Cross-club: same member in N clubs → JOIN produces N rows.
        //   2. Shared mailbox: 2 members using the same email (spouse-of-
        //      spouse, family address) — sending twice is wasted credit and
        //      spammy for the recipient.
        //
        // Keeps Compose count == Detail Total == Sent + Failed == credits
        // deducted — zero mismatch across the whole flow.
        var seenEmails = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        int inserted = 0;
        foreach (var m in members)
        {
            var email = (string?)m.Email;
            if (string.IsNullOrWhiteSpace(email)) continue;
            var normalized = email.Trim();
            if (!seenEmails.Add(normalized.ToLowerInvariant())) continue;
            // Contact rows carry fk_member_id 0 and their contact id.
            ((IDictionary<string, object>)m).TryGetValue("ContactId", out var contactId);
            await connection.ExecuteAsync(
                @"INSERT INTO club_mass_email_recipients (fk_mass_email_id, fk_member_id, fk_contact_id, MemberName, Email, Status, isdeleted)
                  VALUES (@EmailId, @MemberId, @ContactId, @MemberName, @Email, 'Pending', 0)",
                new { EmailId = emailId, MemberId = Convert.ToInt32(m.MemberId), ContactId = contactId, MemberName = (string?)m.MemberName, Email = normalized });
            inserted++;
        }

        // Update total recipients count — reflects distinct email addresses
        // that will actually receive the email, matching what compose promised.
        await connection.ExecuteAsync(
            "UPDATE club_mass_emails SET TotalRecipients = @Total WHERE pk_mass_email_id = @Id",
            new { Total = inserted, Id = emailId });
    }

    private static async Task DeductCreditsInternalAsync(MySqlConnection connection, int clubId, string creditType, int count)
    {
        var credits = (await connection.QueryAsync<dynamic>(
            @"SELECT pk_credit_id AS Id, CreditCount, UsedCount
              FROM club_credits
              WHERE fk_club_id = @ClubId AND CreditType = @CreditType
                AND IsActive = 1 AND isdeleted = 0
                AND NOW() BETWEEN FromDate AND ToDate
                AND (CreditCount - UsedCount) > 0
              ORDER BY ToDate ASC",
            new { ClubId = clubId, CreditType = creditType })).ToList();

        var remaining = count;
        foreach (var c in credits)
        {
            if (remaining <= 0) break;
            var available = (int)c.CreditCount - (int)c.UsedCount;
            var deduct = Math.Min(available, remaining);
            await connection.ExecuteAsync(
                "UPDATE club_credits SET UsedCount = UsedCount + @Deduct WHERE pk_credit_id = @Id",
                new { Deduct = deduct, Id = (int)c.Id });
            remaining -= deduct;
        }
    }
}
