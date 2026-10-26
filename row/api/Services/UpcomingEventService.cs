using System.Data;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class UpcomingEventService : IUpcomingEventService
{
    private readonly string _connectionString;
    private readonly IWebHostEnvironment _env;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<UpcomingEventService> _logger;

    public UpcomingEventService(IConfiguration configuration, IWebHostEnvironment env, IServiceScopeFactory scopeFactory, ILogger<UpcomingEventService> logger)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _env = env;
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    public async Task<(List<UpcomingEventListDto> Items, int TotalCount)> GetAllAsync(int clubId, string status, string search, int page, int pageSize, int? districtId = null)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var whereClause = districtId.HasValue ? "e.fk_district_id = @EntityId" : "e.fk_club_id = @EntityId";
        var entityId = districtId.HasValue ? districtId.Value : clubId;

        var statusCondition = string.IsNullOrEmpty(status) ? "" : @"AND (
            CASE
                WHEN NOW() < e.PublishDate THEN 'Unpublished'
                WHEN NOW() > e.ExpiryDate THEN 'Expired'
                ELSE 'Published'
            END = @Status)";

        var searchCondition = string.IsNullOrEmpty(search) ? "" : "AND e.Title LIKE CONCAT('%', @Search, '%')";

        var sql = $@"
            SELECT e.pk_upcoming_event_id AS Id, e.fk_club_id AS ClubId,
                   e.Title, e.Description,
                   CASE
                       WHEN e.ImagePath IS NULL OR e.ImagePath = '' THEN NULL
                       WHEN e.ImagePath LIKE '/%' THEN e.ImagePath
                       WHEN e.fk_district_id IS NOT NULL THEN CONCAT('/Documents/Event/Group', e.fk_district_id, '/', e.ImagePath)
                       ELSE CONCAT('/Documents/Event/Group', e.fk_club_id, '/', e.ImagePath)
                   END AS ImagePath,
                   e.EventDate, e.PublishDate, e.ExpiryDate,
                   e.EventVenue, e.RegistrationLink, e.IsSendEmail, e.IsRepeatNotification,
                   e.EmailSentDate, e.EmailSentCount, e.EmailFailedCount,
                   CASE
                       WHEN NOW() < e.PublishDate THEN 'Unpublished'
                       WHEN NOW() > e.ExpiryDate THEN 'Expired'
                       ELSE 'Published'
                   END AS Status,
                   (SELECT COUNT(*) FROM upcoming_event_reminders r WHERE r.fk_upcoming_event_id = e.pk_upcoming_event_id) AS ReminderCount
            FROM upcoming_events e
            WHERE {whereClause} AND e.isdeleted = 0
            {statusCondition} {searchCondition}
            ORDER BY e.EventDate DESC
            LIMIT @PageSize OFFSET @Offset;

            SELECT COUNT(*) FROM upcoming_events e
            WHERE {whereClause} AND e.isdeleted = 0
            {statusCondition} {searchCondition};";

        using var multi = await connection.QueryMultipleAsync(sql, new
        {
            EntityId = entityId,
            Status = status ?? "",
            Search = search ?? "",
            PageSize = pageSize,
            Offset = (page - 1) * pageSize
        });

        var items = (await multi.ReadAsync<UpcomingEventListDto>()).ToList();
        var totalCount = await multi.ReadSingleAsync<int>();
        return (items, totalCount);
    }

    public async Task<UpcomingEventDetailDto?> GetByIdAsync(int id)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        using var multi = await connection.QueryMultipleAsync(@"
            SELECT e.pk_upcoming_event_id AS Id,
                   e.fk_club_id AS ClubId,
                   e.Title, e.Description,
                   CASE
                       WHEN e.ImagePath IS NULL OR e.ImagePath = '' THEN NULL
                       WHEN e.ImagePath LIKE '/%' THEN e.ImagePath
                       WHEN e.fk_district_id IS NOT NULL THEN CONCAT('/Documents/Event/Group', e.fk_district_id, '/', e.ImagePath)
                       ELSE CONCAT('/Documents/Event/Group', e.fk_club_id, '/', e.ImagePath)
                   END AS ImagePath,
                   e.EventDate, e.PublishDate, e.ExpiryDate,
                   e.EventVenue, e.RegistrationLink,
                   e.IsSendEmail, e.IsRepeatNotification,
                   CASE
                       WHEN e.ExpiryDate < NOW() THEN 'Expired'
                       WHEN e.PublishDate <= NOW() AND e.ExpiryDate >= NOW() THEN 'Published'
                       ELSE 'Unpublished'
                   END AS Status
            FROM upcoming_events e
            WHERE e.pk_upcoming_event_id = @Id AND e.isdeleted = 0;

            SELECT r.pk_reminder_id AS Id, r.ReminderDateTime
            FROM upcoming_event_reminders r
            WHERE r.fk_upcoming_event_id = @Id AND r.IsActive = 1
            ORDER BY r.ReminderDateTime;",
            new { Id = id });

        var eventDetail = await multi.ReadFirstOrDefaultAsync<UpcomingEventDetailDto>();
        if (eventDetail != null)
        {
            eventDetail.Reminders = (await multi.ReadAsync<EventReminderDto>()).ToList();
        }
        return eventDetail;
    }

    public async Task<int> CreateAsync(int clubId, CreateUpcomingEventDto dto, int createdBy, int? districtId = null)
    {
        // Character limits (club + district).
        CommsLimits.Require(dto.Title, CommsLimits.EventTitle, "Title");
        CommsLimits.Require(dto.EventVenue, CommsLimits.EventVenue, "Event Venue");
        CommsLimits.Require(dto.Description, CommsLimits.EventDescription, "Description");

        using var connection = CreateConnection();
        await connection.OpenAsync();

        int refundEntityIdForCheck = districtId ?? clubId;
        int reminderCount = dto.Reminders?.Count ?? 0;

        // Pre-check Email credits BEFORE insert (counts members with an email).
        if (dto.IsSendEmail && refundEntityIdForCheck > 0)
        {
            int emailCount = await CountRecipientsAsync(connection, clubId, districtId);
            int emailNeeded = emailCount * (1 + reminderCount);
            if (emailNeeded > 0)
            {
                using var scope = _scopeFactory.CreateScope();
                var creditSvc = scope.ServiceProvider.GetRequiredService<ICreditManagementService>();
                if (!await creditSvc.HasSufficientCreditsAsync(refundEntityIdForCheck, "Email", emailNeeded, districtId != null))
                    throw new InvalidOperationException($"Insufficient Email credits. Need {emailNeeded} credit(s) for {emailCount} members × {1 + reminderCount} sends. Please uncheck 'Send through Email' to save without email notification, or reduce reminders, or purchase more credits.");
            }
        }

        var sql = @"INSERT INTO upcoming_events (fk_club_id, fk_district_id, Title, Description, ImagePath,
                        EventDate, PublishDate, ExpiryDate, EventVenue, RegistrationLink,
                        IsSendEmail, IsRepeatNotification, created_by, created_date, isdeleted)
                    VALUES (@ClubId, @DistrictId, @Title, @Description, @ImagePath,
                        @EventDate, @PublishDate, @ExpiryDate, @EventVenue, @RegistrationLink,
                        @IsSendEmail, @IsRepeatNotification, @CreatedBy, NOW(), 0);
                    SELECT LAST_INSERT_ID();";

        var eventId = await connection.ExecuteScalarAsync<int>(sql, new
        {
            ClubId = districtId.HasValue ? 0 : clubId,
            DistrictId = districtId,
            dto.Title,
            dto.Description,
            dto.ImagePath,
            dto.EventDate,
            dto.PublishDate,
            dto.ExpiryDate,
            dto.EventVenue,
            dto.RegistrationLink,
            IsSendEmail = dto.IsSendEmail ? 1 : 0,
            IsRepeatNotification = dto.IsRepeatNotification ? 1 : 0,
            CreatedBy = createdBy
        });

        if (dto.Reminders != null && dto.Reminders.Count > 0)
        {
            foreach (var reminder in dto.Reminders)
            {
                await connection.ExecuteAsync(
                    @"INSERT INTO upcoming_event_reminders (fk_upcoming_event_id, ReminderDateTime, IsActive, created_by, created_date)
                      VALUES (@EventId, @ReminderDateTime, 1, @CreatedBy, NOW())",
                    new { EventId = eventId, ReminderDateTime = reminder, CreatedBy = createdBy });
            }
        }

        // Credits deducted at send-time by scheduler based on actual SentCount
        return eventId;
    }

    private async Task<int> CountRecipientsAsync(MySqlConnection conn, int clubId, int? districtId)
    {
        // Same kill-switch-filtered audience the scheduler sends to: members with an email address.
        const string contact = "m.EmailId IS NOT NULL AND m.EmailId <> ''";
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

    public async Task UpdateAsync(int id, UpdateUpcomingEventDto dto, int modifiedBy)
    {
        // Character limits — also validated on EDIT so a legacy over-limit record must be trimmed.
        CommsLimits.Require(dto.Title, CommsLimits.EventTitle, "Title");
        CommsLimits.Require(dto.EventVenue, CommsLimits.EventVenue, "Event Venue");
        CommsLimits.Require(dto.Description, CommsLimits.EventDescription, "Description");

        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Expiry guard: reject edits on already-expired items (defense-in-depth; UI hides Edit too)
        var existingExpiry = await connection.ExecuteScalarAsync<DateTime?>(
            @"SELECT ExpiryDate FROM upcoming_events WHERE pk_upcoming_event_id = @Id AND isdeleted = 0",
            new { Id = id });
        if (existingExpiry.HasValue && existingExpiry.Value < DateTime.Now)
            throw new InvalidOperationException("Cannot edit an expired item. Once an item's expiry date has passed, it can no longer be modified.");

        // Pre-check Email credits if email is newly turned ON and not yet sent
        var prior = await connection.QueryFirstOrDefaultAsync<dynamic>(
            @"SELECT fk_club_id, fk_district_id, IsSendEmail, EmailSentDate, PublishDate
              FROM upcoming_events WHERE pk_upcoming_event_id = @Id AND isdeleted = 0",
            new { Id = id });
        int clubIdForCheck = prior != null ? (int)prior.fk_club_id : 0;
        int? districtIdForCheck = prior != null && prior.fk_district_id != null ? (int?)prior.fk_district_id : null;
        int refundEntityIdForCheck = districtIdForCheck ?? clubIdForCheck;
        int reminderCount = dto.Reminders?.Count ?? 0;

        // Block save when email is newly turned on (or re-sent) without enough Email credits.
        bool priorEmail = prior != null && Convert.ToBoolean(prior.IsSendEmail);
        bool emailAlreadySent = prior != null && prior.EmailSentDate != null;
        bool emailNewlyOn = dto.IsSendEmail && !priorEmail && !emailAlreadySent;
        bool emailResend = dto.IsSendEmail && emailAlreadySent && dto.PublishDate > DateTime.Now;
        if ((emailNewlyOn || emailResend) && refundEntityIdForCheck > 0)
        {
            int emailCount = await CountRecipientsAsync(connection, clubIdForCheck, districtIdForCheck);
            int emailNeeded = emailCount * (1 + reminderCount);
            if (emailNeeded > 0)
            {
                using var scope = _scopeFactory.CreateScope();
                var creditSvc = scope.ServiceProvider.GetRequiredService<ICreditManagementService>();
                if (!await creditSvc.HasSufficientCreditsAsync(refundEntityIdForCheck, "Email", emailNeeded, districtIdForCheck != null))
                    throw new InvalidOperationException($"Insufficient Email credits. Need {emailNeeded} credit(s) for {emailCount} members × {1 + reminderCount} sends. Please uncheck 'Send through Email' to save without email notification, or reduce reminders, or purchase more credits.");
            }
        }

        // Clear the email sent-state when email is newly turned on or re-sent via a future publish date.
        string clearSentSql = "";
        if (emailNewlyOn || emailResend)
            clearSentSql += ", EmailSentDate = NULL, EmailSentCount = 0, EmailFailedCount = 0";

        await connection.ExecuteAsync(@"
            UPDATE upcoming_events SET
                Title = @Title, Description = @Description, ImagePath = @ImagePath,
                EventDate = @EventDate, PublishDate = @PublishDate, ExpiryDate = @ExpiryDate,
                EventVenue = @EventVenue, RegistrationLink = @RegistrationLink,
                IsSendEmail = @IsSendEmail, IsRepeatNotification = @IsRepeatNotification,
                modified_by = @ModifiedBy, modified_date = NOW()" + clearSentSql + @"
            WHERE pk_upcoming_event_id = @Id AND isdeleted = 0",
            new
            {
                Id = id, dto.Title, dto.Description, dto.ImagePath,
                dto.EventDate, dto.PublishDate, dto.ExpiryDate,
                dto.EventVenue, dto.RegistrationLink,
                IsSendEmail = dto.IsSendEmail ? 1 : 0,
                IsRepeatNotification = dto.IsRepeatNotification ? 1 : 0,
                ModifiedBy = modifiedBy
            });

        // Delete existing reminders and re-add
        await connection.ExecuteAsync(
            "DELETE FROM upcoming_event_reminders WHERE fk_upcoming_event_id = @EventId",
            new { EventId = id });

        if (dto.Reminders != null && dto.Reminders.Count > 0)
        {
            foreach (var reminder in dto.Reminders)
            {
                await connection.ExecuteAsync(
                    @"INSERT INTO upcoming_event_reminders (fk_upcoming_event_id, ReminderDateTime, IsActive, created_by, created_date)
                      VALUES (@EventId, @ReminderDateTime, 1, @CreatedBy, NOW())",
                    new { EventId = id, ReminderDateTime = reminder, CreatedBy = modifiedBy });
            }
        }

        // Credits deducted at send-time by scheduler based on actual SentCount
    }

    public async Task DeleteAsync(int id, int deletedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        await connection.ExecuteAsync(@"
            UPDATE upcoming_events SET isdeleted = 1, deleted_by = @DeletedBy, deleted_date = NOW()
            WHERE pk_upcoming_event_id = @Id",
            new { Id = id, DeletedBy = deletedBy });

        // No refund needed — credits only deducted at send-time; delete before send means nothing to refund
    }

    public async Task<string> UploadImageAsync(int clubId, IFormFile file)
    {
        var groupFolder = $"Group{clubId}";
        var uploadsPath = Path.Combine(_env.WebRootPath, "Documents", "Event", groupFolder);
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
