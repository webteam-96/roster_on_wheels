using System.Data;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class NewsletterService : INewsletterService
{
    private readonly string _connectionString;
    private readonly IWebHostEnvironment _env;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<NewsletterService> _logger;
    private readonly ICitationRecalcTrigger _citationRecalc;

    public NewsletterService(IConfiguration configuration, IWebHostEnvironment env, IServiceScopeFactory scopeFactory, ILogger<NewsletterService> logger, ICitationRecalcTrigger citationRecalc)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _env = env;
        _scopeFactory = scopeFactory;
        _logger = logger;
        _citationRecalc = citationRecalc;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    public async Task<(List<NewsletterListDto> Items, int TotalCount)> GetAllAsync(int clubId, int yearId, string status, string search, int page, int pageSize, int? districtId = null)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var whereClause = districtId.HasValue ? "n.fk_district_id = @EntityId" : "n.fk_club_id = @EntityId";
        var entityId = districtId.HasValue ? districtId.Value : clubId;

        var statusCondition = string.IsNullOrEmpty(status) ? "" : @"AND (
            CASE
                WHEN NOW() < n.PublishDateTime THEN 'Unpublished'
                ELSE 'Published'
            END = @Status)";

        var searchCondition = string.IsNullOrEmpty(search) ? "" : "AND n.Title LIKE CONCAT('%', @Search, '%')";

        // Year filter: resolve yearId → rotary year start/end and filter PublishDateTime range
        var yearJoin = yearId > 0
            ? "JOIN rotary_year_master y ON y.pk_year_id = @YearId AND n.PublishDateTime >= y.StartDate AND n.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)"
            : "";

        var sql = $@"
            SELECT n.pk_newsletter_id AS Id, n.fk_club_id AS ClubId,
                   n.Title, n.PublishDateTime, n.ExpiryDateTime, n.AttachmentType, n.LinkUrl,
                   CASE
                       WHEN n.FilePath IS NULL OR n.FilePath = '' THEN NULL
                       WHEN n.FilePath LIKE '/%' THEN n.FilePath
                       WHEN n.Scope = 'ri' THEN CONCAT('/Documents/ebulletin/ri/', n.FilePath)
                       WHEN n.fk_district_id IS NOT NULL AND n.fk_district_id > 0
                            THEN CONCAT('/Documents/ebulletin/Group', n.fk_district_id, '/', n.FilePath)
                       WHEN n.fk_club_id IS NOT NULL AND n.fk_club_id > 0
                            THEN CONCAT('/Documents/ebulletin/Group', n.fk_club_id, '/', n.FilePath)
                       ELSE NULL  /* orphan row (no scope, no club, no district) — hide instead of building Group0/... */
                   END AS FilePath,
                   n.IsSendWhatsapp, n.IsSendEmail,
                   n.WhatsAppSentDate, n.WhatsAppSentCount, n.WhatsAppFailedCount,
                   n.EmailSentDate, n.EmailSentCount, n.EmailFailedCount,
                   CASE
                       WHEN NOW() < n.PublishDateTime THEN 'Unpublished'
                       ELSE 'Published'
                   END AS Status
            FROM newsletters n
            {yearJoin}
            WHERE {whereClause} AND COALESCE(n.isdeleted, 0) = 0
            {statusCondition} {searchCondition}
            ORDER BY n.PublishDateTime DESC
            LIMIT @PageSize OFFSET @Offset;

            SELECT COUNT(*) FROM newsletters n
            {yearJoin}
            WHERE {whereClause} AND COALESCE(n.isdeleted, 0) = 0
            {statusCondition} {searchCondition};";

        using var multi = await connection.QueryMultipleAsync(sql, new
        {
            EntityId = entityId,
            YearId = yearId,
            Status = status ?? "",
            Search = search ?? "",
            PageSize = pageSize,
            Offset = (page - 1) * pageSize
        });

        var items = (await multi.ReadAsync<NewsletterListDto>()).ToList();
        var totalCount = await multi.ReadSingleAsync<int>();
        return (items, totalCount);
    }

    public async Task<NewsletterDetailDto?> GetByIdAsync(int id)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        var detail = await connection.QueryFirstOrDefaultAsync<NewsletterDetailDto>(@"
            SELECT n.pk_newsletter_id AS Id,
                   n.fk_club_id AS ClubId,
                   n.Title, n.PublishDateTime, n.ExpiryDateTime,
                   n.AttachmentType, n.LinkUrl,
                   CASE
                       WHEN n.FilePath IS NULL OR n.FilePath = '' THEN NULL
                       WHEN n.FilePath LIKE '/%' THEN n.FilePath
                       WHEN n.Scope = 'ri' THEN CONCAT('/Documents/ebulletin/ri/', n.FilePath)
                       WHEN n.fk_district_id IS NOT NULL AND n.fk_district_id > 0
                            THEN CONCAT('/Documents/ebulletin/Group', n.fk_district_id, '/', n.FilePath)
                       WHEN n.fk_club_id IS NOT NULL AND n.fk_club_id > 0
                            THEN CONCAT('/Documents/ebulletin/Group', n.fk_club_id, '/', n.FilePath)
                       ELSE NULL  /* orphan row — see GetAllAsync */
                   END AS FilePath,
                   n.IsSendWhatsapp, n.IsSendEmail,
                   CASE
                       WHEN NOW() < n.PublishDateTime THEN 'Unpublished'
                       ELSE 'Published'
                   END AS Status
            FROM newsletters n
            WHERE n.pk_newsletter_id = @Id AND COALESCE(n.isdeleted, 0) = 0",
            new { Id = id });
        return detail;
    }

    public async Task<int> CreateAsync(int clubId, CreateNewsletterDto dto, int createdBy, int? districtId = null)
    {
        CommsLimits.Require(dto.Title, CommsLimits.NewsletterTitle, "Title"); // club + district

        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Pre-check WhatsApp credits BEFORE insert (block save if insufficient)
        int memberCountForCheck = 0;
        int refundEntityIdForCheck = districtId ?? clubId;
        if (dto.IsSendWhatsapp && refundEntityIdForCheck > 0)
        {
            memberCountForCheck = await CountRecipientsAsync(connection, clubId, districtId);
            if (memberCountForCheck > 0)
            {
                using var scope = _scopeFactory.CreateScope();
                var creditSvc = scope.ServiceProvider.GetRequiredService<ICreditManagementService>();
                if (!await creditSvc.HasSufficientCreditsAsync(refundEntityIdForCheck, "WhatsApp", memberCountForCheck))
                    throw new InvalidOperationException($"Insufficient WhatsApp credits. Need {memberCountForCheck} credit(s).");
            }
        }

        // Pre-check Email credits BEFORE insert (parity with WhatsApp; counts members with an email).
        if (dto.IsSendEmail && refundEntityIdForCheck > 0)
        {
            int emailCount = await CountRecipientsAsync(connection, clubId, districtId, forEmail: true);
            if (emailCount > 0)
            {
                using var scope = _scopeFactory.CreateScope();
                var creditSvc = scope.ServiceProvider.GetRequiredService<ICreditManagementService>();
                if (!await creditSvc.HasSufficientCreditsAsync(refundEntityIdForCheck, "Email", emailCount))
                    throw new InvalidOperationException($"Insufficient Email credits. Need {emailCount} credit(s).");
            }
        }

        // fk_year_id is resolved at INSERT time from PublishDateTime via rotary_year_master,
        // so the listing (filtered by year column) and the date-range fallback always agree.
        var sql = @"INSERT INTO newsletters (fk_club_id, fk_district_id, fk_year_id, Title, PublishDateTime, ExpiryDateTime,
                        AttachmentType, LinkUrl, FilePath, IsSendWhatsapp, IsSendEmail, created_by, created_date, isdeleted)
                    VALUES (@ClubId, @DistrictId,
                        (SELECT pk_year_id FROM rotary_year_master
                         WHERE @PublishDateTime >= StartDate
                           AND @PublishDateTime < DATE_ADD(EndDate, INTERVAL 1 DAY)
                         LIMIT 1),
                        @Title, @PublishDateTime, @ExpiryDateTime,
                        @AttachmentType, @LinkUrl, @FilePath, @IsSendWhatsapp, @IsSendEmail, @CreatedBy, NOW(), 0);
                    SELECT LAST_INSERT_ID();";

        var newsletterId = await connection.ExecuteScalarAsync<int>(sql, new
        {
            ClubId = districtId.HasValue ? 0 : clubId,
            DistrictId = districtId,
            dto.Title,
            dto.PublishDateTime,
            dto.ExpiryDateTime,
            dto.AttachmentType,
            dto.LinkUrl,
            dto.FilePath,
            IsSendWhatsapp = dto.IsSendWhatsapp ? 1 : 0,
            IsSendEmail = dto.IsSendEmail ? 1 : 0,
            CreatedBy = createdBy
        });

        // Refresh District Awards "Newsletter" auto-count for this club.
        if (!districtId.HasValue) _citationRecalc.TriggerForClub(clubId);

        // Credits deducted at send-time by scheduler based on actual SentCount
        return newsletterId;
    }

    private async Task<int> CountRecipientsAsync(MySqlConnection conn, int clubId, int? districtId, bool forEmail = false)
    {
        // Same kill-switch-filtered audience the scheduler sends to; only the contact filter
        // differs per channel — WhatsApp needs a mobile, Email needs an EmailId.
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

    public async Task UpdateAsync(int id, UpdateNewsletterDto dto, int modifiedBy)
    {
        CommsLimits.Require(dto.Title, CommsLimits.NewsletterTitle, "Title"); // club + district, edit too

        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Expiry guard removed 2026-06-12 — UI no longer captures Expiry Date and
        // allows past/future PublishDateTime. Editing an "expired" item is now allowed.

        // Pre-check WhatsApp/Email credits if a channel is being newly turned ON and not yet sent
        var prior = await connection.QueryFirstOrDefaultAsync<dynamic>(
            @"SELECT fk_club_id, fk_district_id, IsSendWhatsapp, WhatsAppSentDate, IsSendEmail, EmailSentDate, PublishDateTime
              FROM newsletters WHERE pk_newsletter_id = @Id AND COALESCE(isdeleted, 0) = 0",
            new { Id = id });
        bool priorWhatsapp = prior != null && Convert.ToBoolean(prior.IsSendWhatsapp);
        bool alreadySent = prior != null && prior.WhatsAppSentDate != null;
        int memberCountForCheck = 0;
        int clubIdForCheck = prior != null ? (int)prior.fk_club_id : 0;
        int? districtIdForCheck = prior != null && prior.fk_district_id != null ? (int?)prior.fk_district_id : null;
        int refundEntityIdForCheck = districtIdForCheck ?? clubIdForCheck;
        bool newlyTurnedOn = dto.IsSendWhatsapp && !priorWhatsapp && !alreadySent;
        bool resendOnDateChange = dto.IsSendWhatsapp && alreadySent && dto.PublishDateTime > DateTime.Now;
        if ((newlyTurnedOn || resendOnDateChange) && refundEntityIdForCheck > 0)
        {
            memberCountForCheck = await CountRecipientsAsync(connection, clubIdForCheck, districtIdForCheck);
            if (memberCountForCheck > 0)
            {
                using var scope = _scopeFactory.CreateScope();
                var creditSvc = scope.ServiceProvider.GetRequiredService<ICreditManagementService>();
                if (!await creditSvc.HasSufficientCreditsAsync(refundEntityIdForCheck, "WhatsApp", memberCountForCheck))
                    throw new InvalidOperationException($"Insufficient WhatsApp credits. Need {memberCountForCheck} credit(s).");
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
            if (emailCount > 0)
            {
                using var scope = _scopeFactory.CreateScope();
                var creditSvc = scope.ServiceProvider.GetRequiredService<ICreditManagementService>();
                if (!await creditSvc.HasSufficientCreditsAsync(refundEntityIdForCheck, "Email", emailCount))
                    throw new InvalidOperationException($"Insufficient Email credits. Need {emailCount} credit(s).");
            }
        }

        await connection.ExecuteAsync(
            "sp_newsletter_update",
            new
            {
                p_Id = id,
                p_Title = dto.Title,
                p_PublishDateTime = dto.PublishDateTime,
                p_ExpiryDateTime = dto.ExpiryDateTime,
                p_AttachmentType = dto.AttachmentType,
                p_LinkUrl = dto.LinkUrl,
                p_FilePath = dto.FilePath,
                p_IsSendWhatsapp = dto.IsSendWhatsapp ? 1 : 0,
                p_ModifiedBy = modifiedBy
            },
            commandType: CommandType.StoredProcedure);

        // SP can't be updated under current DB user (SYSTEM_USER privilege). Patch
        // fk_year_id post-SP so a publish-date change moves the newsletter into the
        // right rotary year — keeps listing (year-column filter) in sync with date.
        await connection.ExecuteAsync(@"
            UPDATE newsletters
            SET fk_year_id = (
                SELECT pk_year_id FROM rotary_year_master
                WHERE @PublishDateTime >= StartDate
                  AND @PublishDateTime < DATE_ADD(EndDate, INTERVAL 1 DAY)
                LIMIT 1),
                IsSendEmail = @IsSendEmail
            WHERE pk_newsletter_id = @Id",
            new { Id = id, PublishDateTime = dto.PublishDateTime, IsSendEmail = dto.IsSendEmail ? 1 : 0 });

        // Clear each channel's sent-state INDEPENDENTLY so the scheduler re-sends it (turning on
        // Email alone previously never reset EmailSentDate, so the email never sent).
        string clearWa = (newlyTurnedOn || resendOnDateChange)
            ? "WhatsAppSentDate = NULL, WhatsAppSentCount = 0, WhatsAppFailedCount = 0" : "";
        string clearEmail = (emailNewlyOn || emailResend)
            ? "EmailSentDate = NULL, EmailSentCount = 0, EmailFailedCount = 0" : "";
        var clearParts = new[] { clearWa, clearEmail }.Where(s => s.Length > 0).ToArray();
        if (clearParts.Length > 0)
        {
            await connection.ExecuteAsync(
                $"UPDATE newsletters SET {string.Join(", ", clearParts)} WHERE pk_newsletter_id = @Id",
                new { Id = id });
        }

        // Push re-send: when PublishDateTime changes, reset the push flag so the background
        // service re-fires (mirrors AnnouncementService). Compared at second granularity.
        if (prior != null && prior.PublishDateTime != null
            && Math.Abs((((DateTime)prior.PublishDateTime) - dto.PublishDateTime).TotalSeconds) >= 1)
        {
            await connection.ExecuteAsync(
                "UPDATE newsletters SET PushNotificationSent = 0, PushNotificationSentAt = NULL WHERE pk_newsletter_id = @Id",
                new { Id = id });
        }
    }

    public async Task DeleteAsync(int id, int deletedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var row = await connection.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT fk_club_id, fk_district_id, IsSendWhatsapp, WhatsAppSentDate, Title
            FROM newsletters WHERE pk_newsletter_id = @Id AND COALESCE(isdeleted, 0) = 0",
            new { Id = id });

        await connection.ExecuteAsync(
            "sp_newsletter_delete",
            new { p_Id = id, p_DeletedBy = deletedBy },
            commandType: CommandType.StoredProcedure);

        // Refresh District Awards "Newsletter" auto-count for the affected club.
        if (row != null)
        {
            int clubFk = row.fk_club_id != null ? (int)row.fk_club_id : 0;
            if (clubFk > 0) _citationRecalc.TriggerForClub(clubFk);
        }

        // No refund needed — credits only deducted at send-time
    }

    public async Task<string> UploadFileAsync(int clubId, IFormFile file)
    {
        // Reject id=0 to stop files landing in a literal "Group0" folder
        // (root cause of the orphan-newsletter bug). Both club-scoped and
        // district-scoped routes pass their entity id here; either must be
        // a real positive id.
        if (clubId <= 0)
            throw new ArgumentException("Newsletter upload requires a valid club or district id (>0).", nameof(clubId));

        var groupFolder = $"Group{clubId}";
        var uploadsPath = Path.Combine(_env.WebRootPath, "Documents", "ebulletin", groupFolder);
        Directory.CreateDirectory(uploadsPath);

        var rawName = Path.GetFileNameWithoutExtension(file.FileName);
        // IIS/URL-safe filename: spaces in the uploaded name arrive as '+' (or spaces), and IIS
        // rejects/mis-decodes '+' and other special chars in the request PATH → 404 on reopen.
        // Collapse anything that isn't a letter/digit/dash into '_' so the stored name is servable.
        var originalName = System.Text.RegularExpressions.Regex.Replace(rawName, @"[^A-Za-z0-9\-]+", "_").Trim('_');
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

    public async Task<List<object>> GetYearsAsync(int clubId, int? districtId = null)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var whereClause = districtId.HasValue ? "n.fk_district_id = @EntityId" : "n.fk_club_id = @EntityId";
        var entityId = districtId.HasValue ? districtId.Value : clubId;

        var result = await connection.QueryAsync(
            $@"SELECT DISTINCT y.pk_year_id AS id, y.YearLabel AS yearLabel, y.IsCurrent AS isCurrent
              FROM rotary_year_master y
              INNER JOIN newsletters n
                ON n.PublishDateTime >= y.StartDate
               AND n.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
              WHERE {whereClause}
                AND COALESCE(n.isdeleted, 0) = 0

              UNION

              SELECT y2.pk_year_id AS id, y2.YearLabel AS yearLabel, y2.IsCurrent AS isCurrent
              FROM rotary_year_master y2
              WHERE y2.IsCurrent = 1

              ORDER BY id DESC",
            new { EntityId = entityId });
        return result.Select(r => (object)r).ToList();
    }
}
