using System.Data;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public partial class RiDirectorService
{
    // ══════════════════════════════════════════════════════════════
    // UPCOMING EVENTS (RI-scoped)
    // ══════════════════════════════════════════════════════════════
    public async Task<(List<UpcomingEventListDto> Items, int TotalCount)> GetUpcomingEventsAsync(string? status, string? search, int page, int pageSize)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var statusCondition = string.IsNullOrEmpty(status) ? "" : @"AND (
            CASE WHEN NOW() < e.PublishDate THEN 'Unpublished'
                 WHEN NOW() > e.ExpiryDate THEN 'Expired'
                 ELSE 'Published' END = @Status)";
        var searchCondition = string.IsNullOrEmpty(search) ? "" : "AND e.Title LIKE CONCAT('%', @Search, '%')";

        var sql = $@"
            SELECT e.pk_upcoming_event_id AS Id, e.fk_club_id AS ClubId,
                   e.Title, e.Description,
                   CASE
                       WHEN e.ImagePath IS NULL OR e.ImagePath = '' THEN NULL
                       WHEN e.ImagePath LIKE '/%' THEN e.ImagePath
                       ELSE CONCAT('/Documents/Event/ri/', e.ImagePath)
                   END AS ImagePath,
                   e.EventDate, e.PublishDate, e.ExpiryDate,
                   e.EventVenue, e.RegistrationLink, e.IsSendWhatsapp, e.IsSendEmail, e.IsRepeatNotification,
                   e.WhatsAppSentDate, e.WhatsAppSentCount, e.WhatsAppFailedCount,
                   e.EmailSentDate, e.EmailSentCount, e.EmailFailedCount,
                   CASE WHEN NOW() < e.PublishDate THEN 'Unpublished'
                        WHEN NOW() > e.ExpiryDate THEN 'Expired'
                        ELSE 'Published' END AS Status,
                   (SELECT COUNT(*) FROM upcoming_event_reminders r WHERE r.fk_upcoming_event_id = e.pk_upcoming_event_id AND r.IsActive = 1) AS ReminderCount
            FROM upcoming_events e
            WHERE e.Scope = 'ri' AND e.isdeleted = 0
            {statusCondition} {searchCondition}
            ORDER BY e.EventDate DESC
            LIMIT @PageSize OFFSET @Offset;

            SELECT COUNT(*) FROM upcoming_events e
            WHERE e.Scope = 'ri' AND e.isdeleted = 0 {statusCondition} {searchCondition};";

        using var multi = await conn.QueryMultipleAsync(sql, new
        {
            Status = status ?? "",
            Search = search ?? "",
            PageSize = pageSize,
            Offset = (page - 1) * pageSize
        });

        var items = (await multi.ReadAsync<UpcomingEventListDto>()).ToList();
        var totalCount = await multi.ReadSingleAsync<int>();
        return (items, totalCount);
    }

    public async Task<UpcomingEventDetailDto?> GetUpcomingEventByIdAsync(int id)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var detail = await conn.QueryFirstOrDefaultAsync<UpcomingEventDetailDto>(@"
            SELECT pk_upcoming_event_id AS Id, fk_club_id AS ClubId,
                   Title, Description,
                   CASE
                       WHEN ImagePath IS NULL OR ImagePath = '' THEN NULL
                       WHEN ImagePath LIKE '/%' THEN ImagePath
                       ELSE CONCAT('/Documents/Event/ri/', ImagePath)
                   END AS ImagePath,
                   EventDate, PublishDate, ExpiryDate,
                   EventVenue, RegistrationLink, IsSendWhatsapp, IsSendEmail, IsRepeatNotification,
                   RecipientTarget, RecipientZoneIds, RecipientDistrictIds, RecipientSubgroupIds,
                   CASE WHEN NOW() < PublishDate THEN 'Unpublished'
                        WHEN NOW() > ExpiryDate THEN 'Expired'
                        ELSE 'Published' END AS Status
            FROM upcoming_events
            WHERE pk_upcoming_event_id = @Id AND Scope = 'ri' AND isdeleted = 0",
            new { Id = id });

        if (detail == null) return null;

        detail.Reminders = (await conn.QueryAsync<EventReminderDto>(@"
            SELECT pk_reminder_id AS Id, ReminderDateTime
            FROM upcoming_event_reminders WHERE fk_upcoming_event_id = @Id AND IsActive = 1
            ORDER BY ReminderDateTime", new { Id = id })).ToList();

        return detail;
    }

    public async Task<int> CreateUpcomingEventAsync(CreateUpcomingEventDto dto, int createdBy)
    {
        // Pre-check WhatsApp credits — total = recipients × (1 initial + N reminders)
        if (dto.IsSendWhatsapp)
        {
            var count = await GetRecipientCountAsync("whatsapp", dto.RecipientTarget ?? "all", dto.RecipientZoneIds, dto.RecipientDistrictIds, dto.RecipientSubgroupIds);
            int rc = dto.Reminders?.Count ?? 0;
            int totalCreditsNeeded = count * (1 + rc);
            if (totalCreditsNeeded > 0 && !await HasSufficientCreditsAsync("WhatsApp", totalCreditsNeeded))
                throw new InvalidOperationException($"Insufficient WhatsApp credits. Need {totalCreditsNeeded} credit(s) for {count} members × {1 + rc} sends. Please uncheck 'Send through WhatsApp' to save without WhatsApp notification, or reduce reminders, or purchase more credits.");
        }
        // Email parity — block save when email is on without enough Email credits.
        if (dto.IsSendEmail)
        {
            var emailCount = await GetRecipientCountAsync("email", dto.RecipientTarget ?? "all", dto.RecipientZoneIds, dto.RecipientDistrictIds, dto.RecipientSubgroupIds);
            int erc = dto.Reminders?.Count ?? 0;
            int emailNeeded = emailCount * (1 + erc);
            if (emailNeeded > 0 && !await HasSufficientCreditsAsync("Email", emailNeeded))
                throw new InvalidOperationException($"Insufficient Email credits. Need {emailNeeded} credit(s) for {emailCount} members × {1 + erc} sends. Please uncheck 'Send through Email' to save without email notification, or reduce reminders, or purchase more credits.");
        }

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO upcoming_events (fk_club_id, fk_district_id, Scope, Title, Description, ImagePath,
                EventDate, PublishDate, ExpiryDate, EventVenue, RegistrationLink,
                IsSendWhatsapp, IsSendEmail, IsRepeatNotification, Status,
                RecipientTarget, RecipientZoneIds, RecipientDistrictIds, RecipientSubgroupIds,
                created_by, created_date, isdeleted)
            VALUES (0, NULL, 'ri', @Title, @Description, @ImagePath,
                @EventDate, @PublishDate, @ExpiryDate, @EventVenue, @RegistrationLink,
                @IsSendWhatsapp, @IsSendEmail, @IsRepeatNotification, 'Unpublished',
                @RecipientTarget, @RecipientZoneIds, @RecipientDistrictIds, @RecipientSubgroupIds,
                @CreatedBy, NOW(), 0);
            SELECT LAST_INSERT_ID();", new
            {
                dto.Title, dto.Description, dto.ImagePath,
                dto.EventDate, dto.PublishDate, dto.ExpiryDate,
                dto.EventVenue, dto.RegistrationLink,
                IsSendWhatsapp = dto.IsSendWhatsapp ? 1 : 0,
                IsSendEmail = dto.IsSendEmail ? 1 : 0,
                IsRepeatNotification = dto.IsRepeatNotification ? 1 : 0,
                RecipientTarget = dto.RecipientTarget ?? "all",
                RecipientZoneIds = dto.RecipientZoneIds != null && dto.RecipientZoneIds.Length > 0 ? string.Join(",", dto.RecipientZoneIds) : null,
                RecipientDistrictIds = dto.RecipientDistrictIds != null && dto.RecipientDistrictIds.Length > 0 ? string.Join(",", dto.RecipientDistrictIds) : null,
                RecipientSubgroupIds = dto.RecipientSubgroupIds != null && dto.RecipientSubgroupIds.Length > 0 ? string.Join(",", dto.RecipientSubgroupIds) : null,
                CreatedBy = createdBy
            });

        if (dto.Reminders != null && dto.Reminders.Count > 0)
        {
            foreach (var r in dto.Reminders)
            {
                await conn.ExecuteAsync(@"
                    INSERT INTO upcoming_event_reminders (fk_upcoming_event_id, ReminderDateTime, IsActive, created_by, created_date)
                    VALUES (@Id, @Dt, 1, @U, NOW())",
                    new { Id = id, Dt = r, U = createdBy });
            }
        }

        // Deduct WhatsApp credits after save
        if (dto.IsSendWhatsapp)
        {
            var count = await GetRecipientCountAsync("whatsapp", dto.RecipientTarget ?? "all", dto.RecipientZoneIds, dto.RecipientDistrictIds, dto.RecipientSubgroupIds);
            if (count > 0)
                await DeductCreditWithHistoryAsync("WhatsApp", count, "RiUpcomingEvent", id, $"Event WhatsApp: {dto.Title}", createdBy);
        }

        return id;
    }

    public async Task UpdateUpcomingEventAsync(int id, UpdateUpcomingEventDto dto, int modifiedBy)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var prior = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT IsSendWhatsapp, IsSendEmail FROM upcoming_events
            WHERE pk_upcoming_event_id = @Id AND Scope = 'ri' AND isdeleted = 0",
            new { Id = id });
        bool priorWhatsapp = prior != null && Convert.ToBoolean(prior.IsSendWhatsapp);
        bool priorEmail = prior != null && Convert.ToBoolean(prior.IsSendEmail);

        if (dto.IsSendWhatsapp && !priorWhatsapp)
        {
            var count = await GetRecipientCountAsync("whatsapp", dto.RecipientTarget ?? "all", dto.RecipientZoneIds, dto.RecipientDistrictIds, dto.RecipientSubgroupIds);
            int rc = dto.Reminders?.Count ?? 0;
            int totalCreditsNeeded = count * (1 + rc);
            if (totalCreditsNeeded > 0 && !await HasSufficientCreditsAsync("WhatsApp", totalCreditsNeeded))
                throw new InvalidOperationException($"Insufficient WhatsApp credits. Need {totalCreditsNeeded} credit(s) for {count} members × {1 + rc} sends. Please uncheck 'Send through WhatsApp' to save without WhatsApp notification, or reduce reminders, or purchase more credits.");
        }
        // Email parity — block save when email is newly turned on without enough Email credits.
        if (dto.IsSendEmail && !priorEmail)
        {
            var emailCount = await GetRecipientCountAsync("email", dto.RecipientTarget ?? "all", dto.RecipientZoneIds, dto.RecipientDistrictIds, dto.RecipientSubgroupIds);
            int erc = dto.Reminders?.Count ?? 0;
            int emailNeeded = emailCount * (1 + erc);
            if (emailNeeded > 0 && !await HasSufficientCreditsAsync("Email", emailNeeded))
                throw new InvalidOperationException($"Insufficient Email credits. Need {emailNeeded} credit(s) for {emailCount} members × {1 + erc} sends. Please uncheck 'Send through Email' to save without email notification, or reduce reminders, or purchase more credits.");
        }

        await conn.ExecuteAsync(@"
            UPDATE upcoming_events
            SET Title = @Title, Description = @Description, ImagePath = @ImagePath,
                EventDate = @EventDate, PublishDate = @PublishDate, ExpiryDate = @ExpiryDate,
                EventVenue = @EventVenue, RegistrationLink = @RegistrationLink,
                IsSendWhatsapp = @IsSendWhatsapp, IsSendEmail = @IsSendEmail, IsRepeatNotification = @IsRepeatNotification,
                RecipientTarget = @RecipientTarget, RecipientZoneIds = @RecipientZoneIds,
                RecipientDistrictIds = @RecipientDistrictIds, RecipientSubgroupIds = @RecipientSubgroupIds,
                modified_by = @ModifiedBy, modified_date = NOW()
            WHERE pk_upcoming_event_id = @Id AND Scope = 'ri'", new
            {
                Id = id,
                dto.Title, dto.Description, dto.ImagePath,
                dto.EventDate, dto.PublishDate, dto.ExpiryDate,
                dto.EventVenue, dto.RegistrationLink,
                IsSendWhatsapp = dto.IsSendWhatsapp ? 1 : 0,
                IsSendEmail = dto.IsSendEmail ? 1 : 0,
                IsRepeatNotification = dto.IsRepeatNotification ? 1 : 0,
                RecipientTarget = dto.RecipientTarget ?? "all",
                RecipientZoneIds = dto.RecipientZoneIds != null && dto.RecipientZoneIds.Length > 0 ? string.Join(",", dto.RecipientZoneIds) : null,
                RecipientDistrictIds = dto.RecipientDistrictIds != null && dto.RecipientDistrictIds.Length > 0 ? string.Join(",", dto.RecipientDistrictIds) : null,
                RecipientSubgroupIds = dto.RecipientSubgroupIds != null && dto.RecipientSubgroupIds.Length > 0 ? string.Join(",", dto.RecipientSubgroupIds) : null,
                ModifiedBy = modifiedBy
            });

        await conn.ExecuteAsync("DELETE FROM upcoming_event_reminders WHERE fk_upcoming_event_id = @Id", new { Id = id });
        if (dto.Reminders != null && dto.Reminders.Count > 0)
        {
            foreach (var r in dto.Reminders)
            {
                await conn.ExecuteAsync(@"
                    INSERT INTO upcoming_event_reminders (fk_upcoming_event_id, ReminderDateTime, IsActive, created_by, created_date)
                    VALUES (@Id, @Dt, 1, @U, NOW())",
                    new { Id = id, Dt = r, U = modifiedBy });
            }
        }

        if (dto.IsSendWhatsapp && !priorWhatsapp)
        {
            var count = await GetRecipientCountAsync("whatsapp", dto.RecipientTarget ?? "all", dto.RecipientZoneIds, dto.RecipientDistrictIds, dto.RecipientSubgroupIds);
            if (count > 0)
                await DeductCreditWithHistoryAsync("WhatsApp", count, "RiUpcomingEvent", id, $"Event WhatsApp: {dto.Title}", modifiedBy);
        }
    }

    public async Task DeleteUpcomingEventAsync(int id, int deletedBy)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var row = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT IsSendWhatsapp, WhatsAppSentDate, Title FROM upcoming_events
            WHERE pk_upcoming_event_id = @Id AND Scope = 'ri' AND isdeleted = 0",
            new { Id = id });
        bool shouldRefund = row != null
            && Convert.ToBoolean(row.IsSendWhatsapp)
            && row.WhatsAppSentDate == null;

        await conn.ExecuteAsync(@"
            UPDATE upcoming_events SET isdeleted = 1, deleted_by = @U, deleted_date = NOW()
            WHERE pk_upcoming_event_id = @Id AND Scope = 'ri'",
            new { Id = id, U = deletedBy });

        if (shouldRefund)
        {
            var deducted = await GetDeductedAmountAsync("WhatsApp", "RiUpcomingEvent", id);
            if (deducted > 0)
                await RefundCreditWithHistoryAsync("WhatsApp", deducted, "RiUpcomingEvent", id, $"Deleted before publish: {(string)row.Title}", deletedBy);
        }
    }

    public async Task<string> UploadUpcomingEventImageAsync(IFormFile file)
    {
        var uploadsPath = Path.Combine(_env.WebRootPath, "Documents", "Event", "ri");
        Directory.CreateDirectory(uploadsPath);
        // IIS/URL-safe filename: replace spaces/'+'/special chars with '_' (IIS 404s on '+' etc. in the path).
        var originalName = System.Text.RegularExpressions.Regex.Replace(Path.GetFileNameWithoutExtension(file.FileName), @"[^A-Za-z0-9\-]+", "_").Trim('_');
        if (string.IsNullOrEmpty(originalName)) originalName = "file";
        var extension = Path.GetExtension(file.FileName);
        var timestamp = DateTime.Now.ToString("ddMMyyyyhhmmsstt");
        var fileName = $"{originalName}_{Guid.NewGuid().ToString("N").Substring(0, 8)}{timestamp}{extension}";
        var filePath = Path.Combine(uploadsPath, fileName);
        using var stream = new FileStream(filePath, FileMode.Create);
        await file.CopyToAsync(stream);
        // Store filename only — full URL reconstructed via SQL CONCAT on read
        return fileName;
    }

    // ══════════════════════════════════════════════════════════════
    // SUB GROUPS (RI-scoped)
    // ══════════════════════════════════════════════════════════════
    public async Task<List<RiSubGroupListDto>> GetSubGroupsAsync(int? yearId = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var yearFilter = yearId.HasValue ? " AND sg.fk_year_id = @YearId " : "";

        return (await conn.QueryAsync<RiSubGroupListDto>($@"
            SELECT sg.pk_sub_group_id AS Id, sg.fk_year_id AS YearId,
                   ry.YearLabel,
                   sg.GroupName,
                   (SELECT COUNT(*) FROM sub_group_members sm
                    WHERE sm.fk_sub_group_id = sg.pk_sub_group_id AND sm.isdeleted = 0) AS MemberCount,
                   sg.created_date AS CreatedDate
            FROM sub_groups sg
            LEFT JOIN rotary_year_master ry ON ry.pk_year_id = sg.fk_year_id
            WHERE sg.Scope = 'ri' AND sg.isdeleted = 0 {yearFilter}
            ORDER BY sg.fk_year_id DESC, sg.GroupName", new { YearId = yearId })).ToList();
    }

    public async Task<List<RiSubGroupYearDto>> GetSubGroupYearsAsync()
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        return (await conn.QueryAsync<RiSubGroupYearDto>(@"
            SELECT ry.pk_year_id AS Id, ry.YearLabel,
                   CASE WHEN CURDATE() BETWEEN ry.StartDate AND ry.EndDate THEN 1 ELSE 0 END AS IsCurrent,
                   COUNT(sg.pk_sub_group_id) AS GroupCount
            FROM rotary_year_master ry
            JOIN sub_groups sg ON sg.fk_year_id = ry.pk_year_id
                               AND sg.Scope = 'ri' AND sg.isdeleted = 0
            GROUP BY ry.pk_year_id, ry.YearLabel, ry.StartDate, ry.EndDate
            HAVING GroupCount > 0
            ORDER BY ry.StartDate DESC")).ToList();
    }

    public async Task<RiSubGroupDetailDto?> GetSubGroupByIdAsync(int id)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var header = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT sg.pk_sub_group_id, sg.fk_year_id, ry.YearLabel, sg.GroupName
            FROM sub_groups sg
            LEFT JOIN rotary_year_master ry ON ry.pk_year_id = sg.fk_year_id
            WHERE sg.pk_sub_group_id = @Id AND sg.Scope = 'ri' AND sg.isdeleted = 0",
            new { Id = id });
        if (header == null) return null;

        var members = (await conn.QueryAsync<RiSubGroupMemberDto>(@"
            SELECT m.pk_member_master_profile_id AS MemberId, m.MemberName,
                   m.EmailId AS Email, m.PrimaryMobileNumber AS MobileNumber,
                   CASE
                       WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                       WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                       ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                   END AS ProfilePhotoPath,
                   c.ClubName, d.DistrictNumber
            FROM sub_group_members sm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = sm.fk_member_master_profile_id
            LEFT JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.IsActive = 1 AND cm.isdeleted = 0
            LEFT JOIN club_master c ON c.pk_club_id = cm.fk_club_id
            LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
            WHERE sm.fk_sub_group_id = @Id AND sm.isdeleted = 0 AND m.isdeleted = 0
            GROUP BY m.pk_member_master_profile_id, m.MemberName, m.EmailId, m.PrimaryMobileNumber, m.ProfilePhotoPath, c.ClubName, d.DistrictNumber
            ORDER BY m.MemberName", new { Id = id })).ToList();

        return new RiSubGroupDetailDto
        {
            Id = (int)header.pk_sub_group_id,
            YearId = (int)header.fk_year_id,
            YearLabel = (string?)header.YearLabel,
            GroupName = (string)header.GroupName,
            Members = members
        };
    }

    public async Task<int> CreateSubGroupAsync(RiCreateSubGroupDto dto, int createdBy)
    {
        if (string.IsNullOrWhiteSpace(dto.GroupName))
            throw new InvalidOperationException("Group name is required.");
        if (dto.YearId <= 0)
            throw new InvalidOperationException("Year is required.");

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var exists = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM sub_groups
            WHERE Scope = 'ri' AND isdeleted = 0 AND fk_year_id = @YearId AND GroupName = @Name",
            new { YearId = dto.YearId, Name = dto.GroupName.Trim() });
        if (exists > 0)
            throw new InvalidOperationException("A sub group with this name already exists for this year.");

        var id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO sub_groups (fk_club_id, fk_district_id, fk_year_id, Scope, GroupName, created_by, created_date, isdeleted)
            VALUES (0, NULL, @YearId, 'ri', @Name, @U, NOW(), 0);
            SELECT LAST_INSERT_ID();",
            new { YearId = dto.YearId, Name = dto.GroupName.Trim(), U = createdBy });

        foreach (var memberId in dto.MemberIds.Distinct())
        {
            await conn.ExecuteAsync(@"
                INSERT INTO sub_group_members (fk_sub_group_id, fk_member_master_profile_id, created_by, created_date, isdeleted)
                VALUES (@Gid, @Mid, @U, NOW(), 0)",
                new { Gid = id, Mid = memberId, U = createdBy });
        }

        return id;
    }

    public async Task UpdateSubGroupAsync(int id, RiCreateSubGroupDto dto, int modifiedBy)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        if (string.IsNullOrWhiteSpace(dto.GroupName))
            throw new InvalidOperationException("Group name is required.");
        if (dto.YearId <= 0)
            throw new InvalidOperationException("Year is required.");

        var exists = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM sub_groups
            WHERE Scope = 'ri' AND isdeleted = 0 AND fk_year_id = @YearId AND GroupName = @Name AND pk_sub_group_id <> @Id",
            new { YearId = dto.YearId, Name = dto.GroupName.Trim(), Id = id });
        if (exists > 0)
            throw new InvalidOperationException("A sub group with this name already exists for this year.");

        await conn.ExecuteAsync(@"
            UPDATE sub_groups SET fk_year_id = @YearId, GroupName = @Name, modified_by = @U, modified_date = NOW()
            WHERE pk_sub_group_id = @Id AND Scope = 'ri'",
            new { YearId = dto.YearId, Name = dto.GroupName.Trim(), Id = id, U = modifiedBy });

        // Soft-delete removed members, add new
        var existing = (await conn.QueryAsync<int>(
            "SELECT fk_member_master_profile_id FROM sub_group_members WHERE fk_sub_group_id = @Id AND isdeleted = 0",
            new { Id = id })).ToList();

        var wanted = dto.MemberIds.Distinct().ToList();

        var toRemove = existing.Except(wanted).ToList();
        var toAdd = wanted.Except(existing).ToList();

        if (toRemove.Count > 0)
        {
            await conn.ExecuteAsync(@"
                UPDATE sub_group_members SET isdeleted = 1
                WHERE fk_sub_group_id = @Id AND fk_member_master_profile_id IN @Mids",
                new { Id = id, Mids = toRemove });
        }
        foreach (var m in toAdd)
        {
            await conn.ExecuteAsync(@"
                INSERT INTO sub_group_members (fk_sub_group_id, fk_member_master_profile_id, created_by, created_date, isdeleted)
                VALUES (@Gid, @Mid, @U, NOW(), 0)",
                new { Gid = id, Mid = m, U = modifiedBy });
        }
    }

    public async Task DeleteSubGroupAsync(int id, int deletedBy)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        await conn.ExecuteAsync(@"
            UPDATE sub_groups SET isdeleted = 1, deleted_by = @U, deleted_date = NOW()
            WHERE pk_sub_group_id = @Id AND Scope = 'ri'",
            new { Id = id, U = deletedBy });
    }

    public async Task<List<RiAvailableMemberDto>> GetAvailableMembersAsync(string? search)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var where = string.IsNullOrWhiteSpace(search)
            ? ""
            : "AND (m.MemberName LIKE CONCAT('%', @Search, '%') OR m.EmailId LIKE CONCAT('%', @Search, '%') OR m.PrimaryMobileNumber LIKE CONCAT('%', @Search, '%') OR m.RotaryId LIKE CONCAT('%', @Search, '%'))";

        return (await conn.QueryAsync<RiAvailableMemberDto>($@"
            SELECT m.pk_member_master_profile_id AS Id, m.MemberName,
                   m.EmailId AS Email, m.PrimaryMobileNumber AS MobileNumber,
                   CASE
                       WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                       WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                       ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                   END AS ProfilePhotoPath,
                   c.ClubName, d.DistrictNumber,
                   d.fk_zone_id AS ZoneId, z.ZoneName
            FROM member_master_profile m
            JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.IsActive = 1 AND cm.isdeleted = 0
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
            LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
            LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE m.isdeleted = 0 {where}
            GROUP BY m.pk_member_master_profile_id, m.MemberName, m.EmailId, m.PrimaryMobileNumber, m.ProfilePhotoPath, c.ClubName, d.DistrictNumber, d.fk_zone_id, z.ZoneName
            ORDER BY m.MemberName
            LIMIT 500", new { Search = search })).ToList();
    }

    // ══════════════════════════════════════════════════════════════
    // MASS EMAILS (RI-scoped)
    // ══════════════════════════════════════════════════════════════
    public async Task<(List<MassEmailListDto> Items, int TotalCount)> GetMassEmailsAsync(string? status, string? search, int page, int pageSize)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var statusCond = string.IsNullOrEmpty(status) ? "" : "AND Status = @Status";
        var searchCond = string.IsNullOrEmpty(search) ? "" : "AND (Subject LIKE CONCAT('%', @Search, '%') OR FromName LIKE CONCAT('%', @Search, '%'))";

        var sql = $@"
            SELECT pk_mass_email_id AS Id, Subject, Status, RecipientType, TotalRecipients,
                   SentCount, FailedCount, SentDate, created_date AS CreatedDate
            FROM club_mass_emails
            WHERE Scope = 'ri' AND isdeleted = 0 {statusCond} {searchCond}
            ORDER BY pk_mass_email_id DESC
            LIMIT @PageSize OFFSET @Offset;

            SELECT COUNT(*) FROM club_mass_emails
            WHERE Scope = 'ri' AND isdeleted = 0 {statusCond} {searchCond};";

        using var multi = await conn.QueryMultipleAsync(sql, new
        {
            Status = status ?? "",
            Search = search ?? "",
            PageSize = pageSize,
            Offset = (page - 1) * pageSize
        });

        var items = (await multi.ReadAsync<MassEmailListDto>()).ToList();
        var total = await multi.ReadSingleAsync<int>();
        return (items, total);
    }

    public async Task<RiMassEmailDetailDto?> GetMassEmailByIdAsync(int id)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var detail = await conn.QueryFirstOrDefaultAsync<RiMassEmailDetailDto>(@"
            SELECT me.pk_mass_email_id AS Id, me.RecipientType,
                   me.RecipientTarget, me.RecipientZoneIds, me.RecipientDistrictIds, me.RecipientSubgroupIds,
                   me.fk_subgroup_id AS FkSubgroupId,
                   sg.GroupName AS SubgroupName,
                   me.FromName, me.ReplyName, me.ReplyEmail, me.Subject, me.EmailBody,
                   me.Status, me.TotalRecipients, me.SentCount, me.FailedCount,
                   me.SentDate, me.created_date AS CreatedDate
            FROM club_mass_emails me
            LEFT JOIN sub_groups sg ON sg.pk_sub_group_id = me.fk_subgroup_id
            WHERE me.pk_mass_email_id = @Id AND me.Scope = 'ri' AND me.isdeleted = 0",
            new { Id = id });
        if (detail == null) return null;

        detail.Recipients = (await conn.QueryAsync<MassEmailRecipientDto>(@"
            SELECT fk_member_id AS MemberId, MemberName, Email, Status, SentDate, ErrorMessage
            FROM club_mass_email_recipients
            WHERE fk_mass_email_id = @Id AND isdeleted = 0
            ORDER BY MemberName", new { Id = id })).ToList();

        return detail;
    }

    public async Task<int> CreateMassEmailAsync(RiCreateMassEmailDto dto, int createdBy)
    {
        if (string.IsNullOrWhiteSpace(dto.Subject))
            throw new InvalidOperationException("Subject is required.");
        if (string.IsNullOrWhiteSpace(dto.FromName))
            throw new InvalidOperationException("From Name is required.");

        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Validate — Manual Members (type 5) not supported
        if (dto.RecipientType == 5)
            throw new InvalidOperationException("Manual Members recipient type is not supported.");

        string target = dto.RecipientType switch
        {
            2 => "zones",
            3 => "districts",
            4 => "subgroups",
            _ => "all"
        };

        var id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO club_mass_emails
                (fk_club_id, fk_district_id, Scope, RecipientType, fk_subgroup_id,
                 RecipientTarget, RecipientZoneIds, RecipientDistrictIds, RecipientSubgroupIds,
                 FromName, ReplyName, ReplyEmail, Subject, EmailBody, Status,
                 created_by, created_date, isdeleted)
            VALUES (0, NULL, 'ri', @RecipientType, @FkSubgroupId,
                 @Target, @ZoneIds, @DistrictIds, @SubgroupIds,
                 @FromName, @ReplyName, @ReplyEmail, @Subject, @EmailBody, @Status,
                 @U, NOW(), 0);
            SELECT LAST_INSERT_ID();", new
            {
                dto.RecipientType,
                FkSubgroupId = (dto.SubgroupIds != null && dto.SubgroupIds.Length > 0) ? (int?)dto.SubgroupIds[0] : null,
                Target = target,
                ZoneIds = dto.ZoneIds != null && dto.ZoneIds.Length > 0 ? string.Join(",", dto.ZoneIds) : null,
                DistrictIds = dto.DistrictIds != null && dto.DistrictIds.Length > 0 ? string.Join(",", dto.DistrictIds) : null,
                SubgroupIds = dto.SubgroupIds != null && dto.SubgroupIds.Length > 0 ? string.Join(",", dto.SubgroupIds) : null,
                dto.FromName,
                dto.ReplyName,
                dto.ReplyEmail,
                dto.Subject,
                dto.EmailBody,
                Status = dto.SaveAsDraft ? "Draft" : "Draft",
                U = createdBy
            });

        await PopulateMassEmailRecipientsAsync(conn, id, dto);

        // Update TotalRecipients
        var total = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM club_mass_email_recipients WHERE fk_mass_email_id = @Id AND isdeleted = 0",
            new { Id = id });
        await conn.ExecuteAsync(
            "UPDATE club_mass_emails SET TotalRecipients = @T WHERE pk_mass_email_id = @Id",
            new { T = total, Id = id });

        return id;
    }

    public async Task UpdateMassEmailAsync(int id, RiCreateMassEmailDto dto, int modifiedBy)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var status = await conn.ExecuteScalarAsync<string>(
            "SELECT Status FROM club_mass_emails WHERE pk_mass_email_id = @Id AND Scope = 'ri' AND isdeleted = 0",
            new { Id = id });
        if (status != "Draft")
            throw new InvalidOperationException("Only draft emails can be edited.");

        if (dto.RecipientType == 5)
            throw new InvalidOperationException("Manual Members recipient type is not supported.");

        string target = dto.RecipientType switch
        {
            2 => "zones",
            3 => "districts",
            4 => "subgroups",
            _ => "all"
        };

        await conn.ExecuteAsync(@"
            UPDATE club_mass_emails
            SET RecipientType = @RecipientType, fk_subgroup_id = @FkSubgroupId,
                RecipientTarget = @Target, RecipientZoneIds = @ZoneIds, RecipientDistrictIds = @DistrictIds,
                RecipientSubgroupIds = @SubgroupIds,
                FromName = @FromName, ReplyName = @ReplyName, ReplyEmail = @ReplyEmail,
                Subject = @Subject, EmailBody = @EmailBody,
                modified_by = @U, modified_date = NOW()
            WHERE pk_mass_email_id = @Id AND Scope = 'ri'", new
            {
                Id = id,
                dto.RecipientType,
                FkSubgroupId = (dto.SubgroupIds != null && dto.SubgroupIds.Length > 0) ? (int?)dto.SubgroupIds[0] : null,
                Target = target,
                ZoneIds = dto.ZoneIds != null && dto.ZoneIds.Length > 0 ? string.Join(",", dto.ZoneIds) : null,
                DistrictIds = dto.DistrictIds != null && dto.DistrictIds.Length > 0 ? string.Join(",", dto.DistrictIds) : null,
                SubgroupIds = dto.SubgroupIds != null && dto.SubgroupIds.Length > 0 ? string.Join(",", dto.SubgroupIds) : null,
                dto.FromName, dto.ReplyName, dto.ReplyEmail, dto.Subject, dto.EmailBody,
                U = modifiedBy
            });

        await conn.ExecuteAsync(
            "UPDATE club_mass_email_recipients SET isdeleted = 1 WHERE fk_mass_email_id = @Id",
            new { Id = id });
        await PopulateMassEmailRecipientsAsync(conn, id, dto);

        var total = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM club_mass_email_recipients WHERE fk_mass_email_id = @Id AND isdeleted = 0",
            new { Id = id });
        await conn.ExecuteAsync(
            "UPDATE club_mass_emails SET TotalRecipients = @T WHERE pk_mass_email_id = @Id",
            new { T = total, Id = id });
    }

    public async Task DeleteMassEmailAsync(int id, int deletedBy)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Refund only if never sent (Draft). Failed/Partial/Sending/Sent → credits already consumed.
        var row = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT Status, Subject FROM club_mass_emails
            WHERE pk_mass_email_id = @Id AND Scope = 'ri' AND isdeleted = 0",
            new { Id = id });
        bool shouldRefund = row != null && (string)row.Status == "Draft";

        await conn.ExecuteAsync(@"
            UPDATE club_mass_emails SET isdeleted = 1, modified_by = @U, modified_date = NOW()
            WHERE pk_mass_email_id = @Id AND Scope = 'ri'",
            new { Id = id, U = deletedBy });

        if (shouldRefund)
        {
            var deducted = await GetDeductedAmountAsync("Email", "RiMassEmail", id);
            if (deducted > 0)
                await RefundCreditWithHistoryAsync("Email", deducted, "RiMassEmail", id, $"Deleted draft: {(string)row.Subject}", deletedBy);
        }
    }

    public async Task SendMassEmailAsync(int id, int userId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var email = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pk_mass_email_id, Subject, EmailBody, Status, FromName, ReplyName, ReplyEmail
            FROM club_mass_emails
            WHERE pk_mass_email_id = @Id AND Scope = 'ri' AND isdeleted = 0", new { Id = id });
        if (email == null) throw new InvalidOperationException("Mass email not found.");
        // Allow: Draft (first send), Failed / Partial (retry), Sending (stuck after app recycle)
        var currentStatus = (string)email.Status;
        if (currentStatus != "Draft" && currentStatus != "Failed" && currentStatus != "Partial" && currentStatus != "Sending")
            throw new InvalidOperationException("This email is already sent or cannot be resent.");

        var recipients = (await conn.QueryAsync<dynamic>(@"
            SELECT pk_id AS Id, Email, MemberName FROM club_mass_email_recipients
            WHERE fk_mass_email_id = @Id AND isdeleted = 0
              AND (Status = 'Pending' OR Status = 'Failed')
              AND Email IS NOT NULL AND Email <> ''",
            new { Id = id })).ToList();

        if (recipients.Count == 0)
            throw new InvalidOperationException("No pending recipients to send.");

        // Deduct credits only on first send (Draft). On resume (Failed/Partial/Sending), credits were already deducted.
        bool isFirstSend = currentStatus == "Draft";
        if (isFirstSend)
        {
            if (!await HasSufficientCreditsAsync("Email", recipients.Count))
                throw new InvalidOperationException($"Insufficient Email credits. Need {recipients.Count} credit(s).");
            await DeductCreditWithHistoryAsync("Email", recipients.Count, "RiMassEmail", id, $"Mass Email: {(string)email.Subject}", userId);
        }

        await conn.ExecuteAsync(
            "UPDATE club_mass_emails SET Status = 'Sending' WHERE pk_mass_email_id = @Id",
            new { Id = id });

        var subject = (string)email.Subject;
        var body = (string?)email.EmailBody ?? "";

        // Fire-and-forget parallel send (max 10 concurrent connections to SMTP)
        _ = Task.Run(async () =>
        {
            int sent = 0, failed = 0;
            const int maxConcurrency = 10;
            try
            {
                using var scope = _scopeFactory.CreateScope();
                var emailSvc = scope.ServiceProvider.GetRequiredService<IEmailService>();

                await Parallel.ForEachAsync(
                    recipients,
                    new ParallelOptions { MaxDegreeOfParallelism = maxConcurrency },
                    async (r, ct) =>
                    {
                        try
                        {
                            await emailSvc.SendGenericEmailAsync((string)r.Email, subject, body);
                            using var c = new MySqlConnection(_connectionString);
                            await c.OpenAsync(ct);
                            await c.ExecuteAsync(
                                "UPDATE club_mass_email_recipients SET Status = 'Sent', SentDate = NOW(), ErrorMessage = NULL WHERE pk_id = @Id",
                                new { Id = (int)r.Id });
                            Interlocked.Increment(ref sent);
                        }
                        catch (Exception ex)
                        {
                            var msg = ex.Message.Length > 500 ? ex.Message[..500] : ex.Message;
                            try
                            {
                                using var c = new MySqlConnection(_connectionString);
                                await c.OpenAsync(ct);
                                await c.ExecuteAsync(
                                    "UPDATE club_mass_email_recipients SET Status = 'Failed', ErrorMessage = @E WHERE pk_id = @Id",
                                    new { E = msg, Id = (int)r.Id });
                            }
                            catch { /* swallow DB error during failure logging */ }
                            Interlocked.Increment(ref failed);
                        }
                    });

                using var sendConn = new MySqlConnection(_connectionString);
                await sendConn.OpenAsync();
                await sendConn.ExecuteAsync(@"
                    UPDATE club_mass_emails
                    SET Status = @Status, SentCount = @Sent, FailedCount = @Failed, SentDate = NOW()
                    WHERE pk_mass_email_id = @Id",
                    new
                    {
                        Id = id,
                        Sent = sent,
                        Failed = failed,
                        Status = failed == 0 ? "Sent" : (sent == 0 ? "Failed" : "Partial")
                    });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "RI mass email send failed for {Id}", id);
            }
        });
    }

    private async Task PopulateMassEmailRecipientsAsync(MySqlConnection conn, int massEmailId, RiCreateMassEmailDto dto)
    {
        string whereScope;
        object? prm;

        switch (dto.RecipientType)
        {
            case 2: // Zones
                if (dto.ZoneIds == null || dto.ZoneIds.Length == 0) return;
                whereScope = "d.fk_zone_id IN @ZoneIds";
                prm = new { ZoneIds = dto.ZoneIds };
                break;
            case 3: // Districts
                if (dto.DistrictIds == null || dto.DistrictIds.Length == 0) return;
                whereScope = "c.fk_district_id IN @DistrictIds";
                prm = new { DistrictIds = dto.DistrictIds };
                break;
            case 4: // Sub groups
                if (dto.SubgroupIds == null || dto.SubgroupIds.Length == 0) return;
                var subMemberIds = (await conn.QueryAsync<int>(@"
                    SELECT DISTINCT sm.fk_member_master_profile_id
                    FROM sub_group_members sm
                    JOIN sub_groups sg ON sg.pk_sub_group_id = sm.fk_sub_group_id
                    WHERE sm.fk_sub_group_id IN @Ids AND sm.isdeleted = 0 AND sg.Scope = 'ri'",
                    new { Ids = dto.SubgroupIds })).ToList();
                if (subMemberIds.Count == 0) return;
                whereScope = "m.pk_member_master_profile_id IN @MemberIds";
                prm = new { MemberIds = subMemberIds };
                break;
            default: // 1 = All
                whereScope = "1=1";
                prm = new { };
                break;
        }

        var sql = $@"
            INSERT INTO club_mass_email_recipients (fk_mass_email_id, fk_member_id, MemberName, Email, Status, isdeleted)
            SELECT @MassId, m.pk_member_master_profile_id, m.MemberName, m.EmailId, 'Pending', 0
            FROM member_master_profile m
            JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.IsActive = 1 AND cm.isdeleted = 0
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
            LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
            WHERE m.isdeleted = 0 AND m.EmailId IS NOT NULL AND m.EmailId <> ''
              AND {whereScope}
            GROUP BY m.pk_member_master_profile_id, m.MemberName, m.EmailId";

        var dp = new DynamicParameters();
        dp.Add("MassId", massEmailId);
        if (prm is not null)
        {
            var props = prm.GetType().GetProperties();
            foreach (var p in props)
            {
                dp.Add(p.Name, p.GetValue(prm));
            }
        }
        await conn.ExecuteAsync(sql, dp);
    }
}
