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
    private readonly ILogger<ClubMassEmailService> _logger;

    public ClubMassEmailService(
        IConfiguration configuration,
        IEmailService emailService,
        IServiceScopeFactory scopeFactory,
        ICreditManagementService creditService,
        ILogger<ClubMassEmailService> logger)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _emailService = emailService;
        _scopeFactory = scopeFactory;
        _creditService = creditService;
        _logger = logger;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

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
                     me.fk_subgroup_id AS FkSubgroupId, sg.GroupName AS SubgroupName,
                     me.FromName, me.ReplyName, me.ReplyEmail, me.Subject, me.EmailBody,
                     me.Status, me.TotalRecipients, me.SentCount, me.FailedCount,
                     me.SentDate, me.created_date AS CreatedDate
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
            @"INSERT INTO club_mass_emails (fk_club_id, fk_district_id, RecipientType, fk_subgroup_id, FromName,
                  ReplyName, ReplyEmail, Subject, EmailBody, Status, TotalRecipients,
                  created_by, created_date, isdeleted)
              VALUES (@ClubId, @DistrictId, @RecipientType, @SubgroupId, @FromName,
                  @ReplyName, @ReplyEmail, @Subject, @EmailBody, @Status, 0,
                  @UserId, NOW(), 0);
              SELECT LAST_INSERT_ID();",
            new
            {
                ClubId = districtId.HasValue ? 0 : clubId,
                DistrictId = districtId,
                dto.RecipientType,
                SubgroupId = dto.SubgroupIds?.Count > 0 ? dto.SubgroupIds[0] : dto.FkSubgroupId,
                dto.FromName,
                dto.ReplyName,
                dto.ReplyEmail,
                dto.Subject,
                dto.EmailBody,
                Status = status,
                UserId = userId
            });

        // Add recipients
        var sgIds = dto.SubgroupIds ?? (dto.FkSubgroupId.HasValue ? new List<int> { dto.FkSubgroupId.Value } : null);
        await AddRecipientsAsync(connection, emailId, clubId, dto.RecipientType, sgIds, dto.MemberIds, districtId, dto.ClubIds);

        return emailId;
    }

    public async Task UpdateAsync(int id, CreateMassEmailDto dto, int userId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Reset status to Draft on edit, reset counts
        await connection.ExecuteAsync(
            @"UPDATE club_mass_emails SET RecipientType = @RecipientType, fk_subgroup_id = @SubgroupId,
                  FromName = @FromName, ReplyName = @ReplyName, ReplyEmail = @ReplyEmail,
                  Subject = @Subject, EmailBody = @EmailBody,
                  Status = 'Draft', SentCount = 0, FailedCount = 0, SentDate = NULL,
                  modified_by = @UserId, modified_date = NOW()
              WHERE pk_mass_email_id = @Id AND isdeleted = 0",
            new
            {
                dto.RecipientType,
                SubgroupId = dto.SubgroupIds?.Count > 0 ? dto.SubgroupIds[0] : dto.FkSubgroupId,
                dto.FromName,
                dto.ReplyName,
                dto.ReplyEmail,
                dto.Subject,
                dto.EmailBody,
                UserId = userId,
                Id = id
            });

        // Remove old recipients and add new
        await connection.ExecuteAsync(
            "UPDATE club_mass_email_recipients SET isdeleted = 1 WHERE fk_mass_email_id = @Id",
            new { Id = id });

        var clubId = await connection.ExecuteScalarAsync<int>(
            "SELECT fk_club_id FROM club_mass_emails WHERE pk_mass_email_id = @Id",
            new { Id = id });

        var sgIds = dto.SubgroupIds ?? (dto.FkSubgroupId.HasValue ? new List<int> { dto.FkSubgroupId.Value } : null);
        await AddRecipientsAsync(connection, id, clubId, dto.RecipientType, sgIds, dto.MemberIds, null, dto.ClubIds);
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
        var email = await connection.QueryFirstOrDefaultAsync<dynamic>(
            @"SELECT pk_mass_email_id AS Id, fk_club_id AS ClubId, FromName, ReplyName, ReplyEmail,
                     Subject, EmailBody, Status
              FROM club_mass_emails WHERE pk_mass_email_id = @Id AND isdeleted = 0",
            new { Id = id });

        if (email == null) throw new KeyNotFoundException("Mass email not found.");
        if ((string)email.Status != "Draft" && (string)email.Status != "Failed")
            throw new InvalidOperationException("Only draft or failed emails can be sent.");

        // Get recipients with email
        var recipients = (await connection.QueryAsync<dynamic>(
            @"SELECT pk_id AS Id, fk_member_id AS MemberId, MemberName, Email
              FROM club_mass_email_recipients
              WHERE fk_mass_email_id = @Id AND isdeleted = 0
                AND Email IS NOT NULL AND Email != ''
                AND (Status = 'Pending' OR Status = 'Failed')",
            new { Id = id })).ToList();

        if (recipients.Count == 0)
            throw new InvalidOperationException("No recipients with valid email addresses.");

        // Check credits
        int clubId = (int)email.ClubId;
        var hasCreds = await _creditService.HasSufficientCreditsAsync(clubId, "Email", recipients.Count);
        if (!hasCreds)
            throw new InvalidOperationException($"Insufficient email credits. Need {recipients.Count}, check your credit balance.");

        // Deduct credits upfront with history
        await _creditService.DeductWithHistoryAsync(clubId, "Email", recipients.Count, "MassEmail", id, $"Mass Email: {(string)email.Subject}", userId);

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
        var recipientsCopy = recipients.Select(r => new { Id = (int)r.Id, MemberId = (int)r.MemberId, MemberName = (string)r.MemberName, Email = (string)r.Email }).ToList();
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
                        await emailSvc.SendMassEmailAsync(r.Email, subject, body, fromName, replyName, replyEmail);
                        await conn.ExecuteAsync(
                            "UPDATE club_mass_email_recipients SET Status = 'Sent', SentDate = NOW() WHERE pk_id = @Id",
                            new { r.Id });
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

    public async Task<RecipientCountDto> GetRecipientCountAsync(int clubId, int recipientType, List<int>? subgroupIds, List<int>? memberIds, int? districtId = null, List<int>? clubIds = null)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        string sql;
        object param;

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

    private async Task AddRecipientsAsync(MySqlConnection connection, int emailId, int clubId,
        int recipientType, List<int>? subgroupIds, List<int>? memberIds, int? districtId = null, List<int>? clubIds = null)
    {
        List<dynamic> members;

        // Kill-switch: skip recipients whose chain (club→district→zone) has any inactive link.
        if (recipientType == 1) // All Members
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
            await connection.ExecuteAsync(
                @"INSERT INTO club_mass_email_recipients (fk_mass_email_id, fk_member_id, MemberName, Email, Status, isdeleted)
                  VALUES (@EmailId, @MemberId, @MemberName, @Email, 'Pending', 0)",
                new { EmailId = emailId, MemberId = (int)m.MemberId, MemberName = (string?)m.MemberName, Email = normalized });
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
