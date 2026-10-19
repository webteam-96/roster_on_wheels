using System.Data;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class AnnouncementService : IAnnouncementService
{
    private readonly string _connectionString;
    private readonly IWebHostEnvironment _env;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<AnnouncementService> _logger;

    public AnnouncementService(IConfiguration configuration, IWebHostEnvironment env, IServiceScopeFactory scopeFactory, ILogger<AnnouncementService> logger)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _env = env;
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    public async Task<(List<AnnouncementListDto> Items, int TotalCount)> GetAllAsync(int clubId, string status, string search, int page, int pageSize, int? districtId = null)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var whereClause = districtId.HasValue ? "a.fk_district_id = @EntityId" : "a.fk_club_id = @EntityId";
        var entityId = districtId.HasValue ? districtId.Value : clubId;

        var statusCondition = string.IsNullOrEmpty(status) ? "" : @"AND (
            CASE
                WHEN NOW() < a.PublishDateTime THEN 'Unpublished'
                WHEN NOW() > a.ExpiryDateTime THEN 'Expired'
                ELSE 'Published'
            END = @Status)";

        var searchCondition = string.IsNullOrEmpty(search) ? "" : "AND a.Title LIKE CONCAT('%', @Search, '%')";

        var sql = $@"
            SELECT a.pk_announcement_id AS Id, a.fk_club_id AS ClubId,
                   a.Title, a.Description,
                   CASE
                       WHEN a.ImagePath IS NULL OR a.ImagePath = '' THEN NULL
                       WHEN a.ImagePath LIKE '/%' THEN a.ImagePath
                       WHEN a.Scope = 'ri' THEN CONCAT('/Documents/announcement/ri/', a.ImagePath)
                       WHEN a.fk_district_id IS NOT NULL THEN CONCAT('/Documents/announcement/Group', a.fk_district_id, '/', a.ImagePath)
                       ELSE CONCAT('/Documents/announcement/Group', a.fk_club_id, '/', a.ImagePath)
                   END AS ImagePath,
                   a.PublishDateTime, a.ExpiryDateTime,
                   a.IsDisplayOnBanner, a.IsSendWhatsapp, a.IsSendEmail, a.IsRepeatNotification,
                   a.WhatsAppSentDate, a.WhatsAppSentCount, a.WhatsAppFailedCount,
                   a.EmailSentDate, a.EmailSentCount, a.EmailFailedCount,
                   CASE
                       WHEN NOW() < a.PublishDateTime THEN 'Unpublished'
                       WHEN NOW() > a.ExpiryDateTime THEN 'Expired'
                       ELSE 'Published'
                   END AS Status,
                   (SELECT COUNT(*) FROM announcement_reminders r WHERE r.fk_announcement_id = a.pk_announcement_id) AS ReminderCount
            FROM announcements a
            WHERE {whereClause} AND a.isdeleted = 0
            {statusCondition} {searchCondition}
            ORDER BY a.PublishDateTime DESC
            LIMIT @PageSize OFFSET @Offset;

            SELECT COUNT(*) FROM announcements a
            WHERE {whereClause} AND a.isdeleted = 0
            {statusCondition} {searchCondition};";

        using var multi = await connection.QueryMultipleAsync(sql, new
        {
            EntityId = entityId,
            Status = status ?? "",
            Search = search ?? "",
            PageSize = pageSize,
            Offset = (page - 1) * pageSize
        });

        var items = (await multi.ReadAsync<AnnouncementListDto>()).ToList();
        var totalCount = await multi.ReadSingleAsync<int>();
        return (items, totalCount);
    }

    public async Task<AnnouncementDetailDto?> GetByIdAsync(int id)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        using var multi = await connection.QueryMultipleAsync(@"
            SELECT a.pk_announcement_id AS Id,
                   a.fk_club_id AS ClubId,
                   a.Title, a.Description,
                   CASE
                       WHEN a.ImagePath IS NULL OR a.ImagePath = '' THEN NULL
                       WHEN a.ImagePath LIKE '/%' THEN a.ImagePath
                       WHEN a.Scope = 'ri' THEN CONCAT('/Documents/announcement/ri/', a.ImagePath)
                       WHEN a.fk_district_id IS NOT NULL THEN CONCAT('/Documents/announcement/Group', a.fk_district_id, '/', a.ImagePath)
                       ELSE CONCAT('/Documents/announcement/Group', a.fk_club_id, '/', a.ImagePath)
                   END AS ImagePath,
                   a.PublishDateTime, a.ExpiryDateTime,
                   a.IsDisplayOnBanner, a.IsSendWhatsapp, a.IsSendEmail, a.IsRepeatNotification,
                   a.RecipientTarget, a.RecipientZoneIds, a.RecipientDistrictIds, a.RecipientSubgroupIds,
                   CASE
                       WHEN a.ExpiryDateTime < NOW() THEN 'Expired'
                       WHEN a.PublishDateTime <= NOW() AND a.ExpiryDateTime >= NOW() THEN 'Published'
                       ELSE 'Unpublished'
                   END AS Status
            FROM announcements a
            WHERE a.pk_announcement_id = @Id AND a.isdeleted = 0;

            SELECT r.pk_reminder_id AS Id, r.ReminderDateTime
            FROM announcement_reminders r
            WHERE r.fk_announcement_id = @Id AND r.IsActive = 1
            ORDER BY r.ReminderDateTime;",
            new { Id = id });

        var detail = await multi.ReadFirstOrDefaultAsync<AnnouncementDetailDto>();
        if (detail != null)
        {
            detail.Reminders = (await multi.ReadAsync<AnnouncementReminderDto>()).ToList();
        }
        return detail;
    }

    public async Task<int> CreateAsync(int clubId, CreateAnnouncementDto dto, int createdBy, int? districtId = null)
    {
        // Character limits — keep the WhatsApp body under the template ceiling (club + district).
        CommsLimits.Require(dto.Title, CommsLimits.AnnouncementTitle, "Title");
        CommsLimits.Require(dto.Description, CommsLimits.AnnouncementDescription, "Description");

        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Pre-check WhatsApp credits BEFORE insert — total = recipients × (1 initial + N reminders)
        int memberCountForCheck = 0;
        int refundEntityIdForCheck = districtId ?? clubId;
        int reminderCount = dto.Reminders?.Count ?? 0;
        int totalCreditsNeeded = 0;

        // Pre-check Email credits BEFORE insert (parity with WhatsApp; counts members with an email).
        if (dto.IsSendEmail && refundEntityIdForCheck > 0)
        {
            int emailCount = await CountRecipientsAsync(connection, clubId, districtId, forEmail: true);
            int emailNeeded = emailCount * (1 + reminderCount);
            if (emailNeeded > 0)
            {
                using var scope = _scopeFactory.CreateScope();
                var creditSvc = scope.ServiceProvider.GetRequiredService<ICreditManagementService>();
                if (!await creditSvc.HasSufficientCreditsAsync(refundEntityIdForCheck, "Email", emailNeeded))
                    throw new InvalidOperationException($"Insufficient Email credits. Need {emailNeeded} credit(s) for {emailCount} members × {1 + reminderCount} sends. Please uncheck 'Send through Email' to save without email notification, or reduce reminders, or purchase more credits.");
            }
        }

        var sql = @"INSERT INTO announcements (fk_club_id, fk_district_id, Title, Description, ImagePath,
                        PublishDateTime, ExpiryDateTime, IsDisplayOnBanner, IsSendWhatsapp, IsSendEmail, IsRepeatNotification,
                        created_by, created_date, isdeleted)
                    VALUES (@ClubId, @DistrictId, @Title, @Description, @ImagePath,
                        @PublishDateTime, @ExpiryDateTime, @IsDisplayOnBanner, @IsSendWhatsapp, @IsSendEmail, @IsRepeatNotification,
                        @CreatedBy, NOW(), 0);
                    SELECT LAST_INSERT_ID();";

        var announcementId = await connection.ExecuteScalarAsync<int>(sql, new
        {
            ClubId = districtId.HasValue ? 0 : clubId,
            DistrictId = districtId,
            dto.Title,
            dto.Description,
            dto.ImagePath,
            dto.PublishDateTime,
            dto.ExpiryDateTime,
            IsDisplayOnBanner = dto.IsDisplayOnBanner ? 1 : 0,
            IsSendWhatsapp = 0,
            IsSendEmail = dto.IsSendEmail ? 1 : 0,
            IsRepeatNotification = dto.IsRepeatNotification ? 1 : 0,
            CreatedBy = createdBy
        });

        if (dto.Reminders != null && dto.Reminders.Count > 0)
        {
            foreach (var reminder in dto.Reminders)
            {
                await connection.ExecuteAsync(
                    "sp_announcement_reminder_add",
                    new
                    {
                        p_AnnouncementId = announcementId,
                        p_ReminderDateTime = reminder,
                        p_CreatedBy = createdBy
                    },
                    commandType: CommandType.StoredProcedure);
            }
        }

        // Credits deducted at send-time by scheduler based on actual SentCount
        return announcementId;
    }

    private async Task<int> CountRecipientsAsync(MySqlConnection conn, int clubId, int? districtId, bool forEmail = false)
    {
        // Same kill-switch-filtered audience the scheduler sends to; the contact filter is the
        // only difference between channels — WhatsApp needs a mobile, Email needs an EmailId.
        var contact = forEmail
            ? "m.EmailId IS NOT NULL AND m.EmailId <> ''"
            : "m.PrimaryMobileNumber IS NOT NULL AND m.PrimaryMobileNumber <> ''";
        if (districtId.HasValue)
        {
            return await conn.ExecuteScalarAsync<int>(
                $@"SELECT COUNT(DISTINCT cm.fk_member_master_profile_id)
                  FROM club_members cm
                  JOIN club_master c ON c.pk_club_id = cm.fk_club_id
                  JOIN district_master d ON d.pk_district_id = c.fk_district_id
                  JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
                  JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                  WHERE c.fk_district_id = @Id
                    AND cm.IsActive = 1 AND cm.isdeleted = 0
                    AND c.IsActive = 1 AND c.isdeleted = 0
                    AND d.IsActive = 1 AND d.isdeleted = 0
                    AND z.IsActive = 1 AND z.isdeleted = 0
                    AND m.isdeleted = 0
                    AND {contact}",
                new { Id = districtId.Value });
        }
        return await conn.ExecuteScalarAsync<int>(
            $@"SELECT COUNT(*) FROM club_members cm
              JOIN club_master c ON c.pk_club_id = cm.fk_club_id
              JOIN district_master d ON d.pk_district_id = c.fk_district_id
              JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
              JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
              WHERE cm.fk_club_id = @Id
                AND cm.IsActive = 1 AND cm.isdeleted = 0
                AND c.IsActive = 1 AND c.isdeleted = 0
                AND d.IsActive = 1 AND d.isdeleted = 0
                AND z.IsActive = 1 AND z.isdeleted = 0
                AND m.isdeleted = 0
                AND {contact}",
            new { Id = clubId });
    }

    public async Task UpdateAsync(int id, UpdateAnnouncementDto dto, int modifiedBy)
    {
        // Character limits — also validated on EDIT so a legacy over-limit record must be trimmed.
        CommsLimits.Require(dto.Title, CommsLimits.AnnouncementTitle, "Title");
        CommsLimits.Require(dto.Description, CommsLimits.AnnouncementDescription, "Description");

        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Expiry guard: reject edits on already-expired items (defense-in-depth; UI hides Edit too)
        var existingExpiry = await connection.ExecuteScalarAsync<DateTime?>(
            @"SELECT ExpiryDateTime FROM announcements WHERE pk_announcement_id = @Id AND isdeleted = 0",
            new { Id = id });
        if (existingExpiry.HasValue && existingExpiry.Value < DateTime.Now)
            throw new InvalidOperationException("Cannot edit an expired item. Once an item's expiry date has passed, it can no longer be modified.");

        // Pre-check WhatsApp/Email credits if a channel is being newly turned ON and not yet sent
        var prior = await connection.QueryFirstOrDefaultAsync<dynamic>(
            @"SELECT fk_club_id, fk_district_id, IsSendWhatsapp, WhatsAppSentDate, IsSendEmail, EmailSentDate, PublishDateTime
              FROM announcements WHERE pk_announcement_id = @Id AND isdeleted = 0",
            new { Id = id });
        bool priorWhatsapp = prior != null && Convert.ToBoolean(prior.IsSendWhatsapp);
        bool alreadySent = prior != null && prior.WhatsAppSentDate != null;
        int memberCountForCheck = 0;
        int clubIdForCheck = prior != null ? (int)prior.fk_club_id : 0;
        int? districtIdForCheck = prior != null && prior.fk_district_id != null ? (int?)prior.fk_district_id : null;
        int refundEntityIdForCheck = districtIdForCheck ?? clubIdForCheck;
        bool newlyTurnedOn = false && !priorWhatsapp && !alreadySent;
        bool resendOnDateChange = false && alreadySent && dto.PublishDateTime > DateTime.Now;
        int reminderCount = dto.Reminders?.Count ?? 0;
        if ((newlyTurnedOn || resendOnDateChange) && refundEntityIdForCheck > 0)
        {
            memberCountForCheck = await CountRecipientsAsync(connection, clubIdForCheck, districtIdForCheck);
            int totalCreditsNeeded = memberCountForCheck * (1 + reminderCount);
            if (totalCreditsNeeded > 0)
            {
                using var scope = _scopeFactory.CreateScope();
                var creditSvc = scope.ServiceProvider.GetRequiredService<ICreditManagementService>();
                if (!await creditSvc.HasSufficientCreditsAsync(refundEntityIdForCheck, "WhatsApp", totalCreditsNeeded))
                    throw new InvalidOperationException($"Insufficient WhatsApp credits. Need {totalCreditsNeeded} credit(s) for {memberCountForCheck} members × {1 + reminderCount} sends. Please uncheck 'Send through WhatsApp' to save without WhatsApp notification, or reduce reminders, or purchase more credits.");
            }
        }

        // Email parity — block save when email is newly turned on (or re-sent) without enough Email credits.
        bool priorEmail = prior != null && Convert.ToBoolean(prior.IsSendEmail);
        bool emailAlreadySent = prior != null && prior.EmailSentDate != null;
        bool emailNewlyOn = dto.IsSendEmail && !priorEmail && !emailAlreadySent;
        bool emailResend = dto.IsSendEmail && emailAlreadySent && dto.PublishDateTime > DateTime.Now;
        if ((emailNewlyOn || emailResend) && refundEntityIdForCheck > 0)
        {
            int emailCount = await CountRecipientsAsync(connection, clubIdForCheck, districtIdForCheck, forEmail: true);
            int emailNeeded = emailCount * (1 + reminderCount);
            if (emailNeeded > 0)
            {
                using var scope = _scopeFactory.CreateScope();
                var creditSvc = scope.ServiceProvider.GetRequiredService<ICreditManagementService>();
                if (!await creditSvc.HasSufficientCreditsAsync(refundEntityIdForCheck, "Email", emailNeeded))
                    throw new InvalidOperationException($"Insufficient Email credits. Need {emailNeeded} credit(s) for {emailCount} members × {1 + reminderCount} sends. Please uncheck 'Send through Email' to save without email notification, or reduce reminders, or purchase more credits.");
            }
        }

        await connection.ExecuteAsync(
            "sp_announcement_update",
            new
            {
                p_Id = id,
                p_Title = dto.Title,
                p_Description = dto.Description,
                p_ImagePath = dto.ImagePath,
                p_PublishDateTime = dto.PublishDateTime,
                p_ExpiryDateTime = dto.ExpiryDateTime,
                p_IsDisplayOnBanner = dto.IsDisplayOnBanner ? 1 : 0,
                p_IsSendWhatsapp = 0,
                p_IsRepeatNotification = dto.IsRepeatNotification ? 1 : 0,
                p_ModifiedBy = modifiedBy
            },
            commandType: CommandType.StoredProcedure);

        // sp_announcement_update doesn't carry IsSendEmail (avoids a stored-proc change that prod's
        // SkipInit would not auto-apply); set it with a small inline update.
        await connection.ExecuteAsync(
            "UPDATE announcements SET IsSendEmail = @E WHERE pk_announcement_id = @Id",
            new { E = dto.IsSendEmail ? 1 : 0, Id = id });

        // Clear each channel's sent-state INDEPENDENTLY so the scheduler re-sends it. A channel
        // resets when it's newly turned on or re-sent via a future publish date. Previously only
        // WhatsApp's condition cleared BOTH — so turning on Email alone never reset EmailSentDate
        // and the email never sent.
        string clearWa = (newlyTurnedOn || resendOnDateChange)
            ? "WhatsAppSentDate = NULL, WhatsAppSentCount = 0, WhatsAppFailedCount = 0" : "";
        string clearEmail = (emailNewlyOn || emailResend)
            ? "EmailSentDate = NULL, EmailSentCount = 0, EmailFailedCount = 0" : "";
        var clearParts = new[] { clearWa, clearEmail }.Where(s => s.Length > 0).ToArray();
        if (clearParts.Length > 0)
        {
            await connection.ExecuteAsync(
                $"UPDATE announcements SET {string.Join(", ", clearParts)} WHERE pk_announcement_id = @Id",
                new { Id = id });
        }

        // Push notification re-send: when PublishDateTime changes, reset push flag so the
        // background service re-fires. Compares prior vs new at the second granularity.
        if (prior != null)
        {
            var priorPub = (DateTime)prior.PublishDateTime;
            if (Math.Abs((priorPub - dto.PublishDateTime).TotalSeconds) >= 1)
            {
                await connection.ExecuteAsync(
                    "UPDATE announcements SET PushNotificationSent = 0, PushNotificationSentAt = NULL WHERE pk_announcement_id = @Id",
                    new { Id = id });
            }
        }

        // Delete existing reminders and re-add
        await connection.ExecuteAsync(
            "DELETE FROM announcement_reminders WHERE fk_announcement_id = @EventId",
            new { EventId = id });

        if (dto.Reminders != null && dto.Reminders.Count > 0)
        {
            foreach (var reminder in dto.Reminders)
            {
                await connection.ExecuteAsync(
                    "sp_announcement_reminder_add",
                    new
                    {
                        p_AnnouncementId = id,
                        p_ReminderDateTime = reminder,
                        p_CreatedBy = modifiedBy
                    },
                    commandType: CommandType.StoredProcedure);
            }
        }

        // Credits deducted at send-time by scheduler based on actual SentCount
    }

    public async Task DeleteAsync(int id, int deletedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Inspect record BEFORE delete for refund decision
        var row = await connection.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT fk_club_id, fk_district_id, IsSendWhatsapp, WhatsAppSentDate, Title
            FROM announcements WHERE pk_announcement_id = @Id AND isdeleted = 0",
            new { Id = id });

        await connection.ExecuteAsync(
            "sp_announcement_delete",
            new { p_Id = id, p_DeletedBy = deletedBy },
            commandType: CommandType.StoredProcedure);

        // No refund needed — credits only deducted at send-time
    }

    public async Task<string> UploadImageAsync(int clubId, IFormFile file)
    {
        var groupFolder = $"Group{clubId}";
        var uploadsPath = Path.Combine(_env.WebRootPath, "Documents", "announcement", groupFolder);
        Directory.CreateDirectory(uploadsPath);

        // IIS/URL-safe filename: replace spaces/'+'/special chars with '_' (IIS 404s on '+' etc. in the path).
        var originalName = System.Text.RegularExpressions.Regex.Replace(Path.GetFileNameWithoutExtension(file.FileName), @"[^A-Za-z0-9\-]+", "_").Trim('_');
        if (string.IsNullOrEmpty(originalName)) originalName = "file";
        var extension = Path.GetExtension(file.FileName);
        var now = DateTime.Now;
        var timestamp = now.ToString("ddMMyyyyhhmmsstt");
        var fileName = $"{originalName}_{Guid.NewGuid().ToString("N").Substring(0, 8)}{timestamp}{extension}";
        var filePath = Path.Combine(uploadsPath, fileName);

        using var stream = new FileStream(filePath, FileMode.Create);
        await file.CopyToAsync(stream);

        // Store filename only — full URL reconstructed via SQL CONCAT on read
        return fileName;
    }
}
