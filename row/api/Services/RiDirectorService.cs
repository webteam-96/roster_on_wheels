using System.Data;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public partial class RiDirectorService : IRiDirectorService
{
    private readonly string _connectionString;
    private readonly IWebHostEnvironment _env;
    private readonly ILogger<RiDirectorService> _logger;
    private readonly IServiceScopeFactory _scopeFactory;

    public RiDirectorService(IConfiguration configuration, IWebHostEnvironment env, ILogger<RiDirectorService> logger, IServiceScopeFactory scopeFactory)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _env = env;
        _logger = logger;
        _scopeFactory = scopeFactory;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    // ══════════════════════════════════════════════════════════════
    // Context (dashboard summary)
    // ══════════════════════════════════════════════════════════════
    public async Task<RiDirectorContextDto> GetContextAsync()
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        // RI Director counts cover the real Rotary zones only. Use an EXCLUSION list (not a whitelist)
        // so a newly-activated zone (e.g. Zone 8) is auto-included without a code change — we only
        // drop the two placeholder zones. Match is case-insensitive (ci collation).
        var zoneCount = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM zone_master z WHERE z.isdeleted = 0 AND z.ZoneName NOT IN ('Other Zones','Zone 0')");
        var districtCount = await conn.ExecuteScalarAsync<int>(
            @"SELECT COUNT(*) FROM district_master d
              JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0
                   AND z.ZoneName NOT IN ('Other Zones','Zone 0')
              WHERE d.isdeleted = 0");
        var clubCount = await conn.ExecuteScalarAsync<int>(
            @"SELECT COUNT(*) FROM club_master c
              JOIN district_master d ON d.pk_district_id = c.fk_district_id
              JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0
                   AND z.ZoneName NOT IN ('Other Zones','Zone 0')
              WHERE c.isdeleted = 0 AND d.isdeleted = 0");
        var memberCount = await conn.ExecuteScalarAsync<int>(
            @"SELECT COUNT(DISTINCT cm.fk_member_master_profile_id)
              FROM club_members cm
              JOIN club_master c ON c.pk_club_id = cm.fk_club_id
              JOIN district_master d ON d.pk_district_id = c.fk_district_id
              JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0
                   AND z.ZoneName NOT IN ('Other Zones','Zone 0')
              JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
              WHERE cm.IsActive = 1 AND cm.isdeleted = 0 AND c.isdeleted = 0 AND m.isdeleted = 0");

        var balance = await GetCreditBalanceAsync(conn);

        return new RiDirectorContextDto
        {
            ZoneCount = zoneCount,
            DistrictCount = districtCount,
            ClubCount = clubCount,
            MemberCount = memberCount,
            Credits = balance
        };
    }

    // ══════════════════════════════════════════════════════════════
    // Credit Management
    // ══════════════════════════════════════════════════════════════
    public async Task<RiCreditBalanceDto> GetCreditBalanceAsync()
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        return await GetCreditBalanceAsync(conn);
    }

    private async Task<RiCreditBalanceDto> GetCreditBalanceAsync(MySqlConnection conn)
    {
        var today = DateTime.Today;
        var rows = (await conn.QueryAsync<dynamic>(@"
            SELECT CreditType, COALESCE(SUM(CreditCount),0) AS total, COALESCE(SUM(UsedCount),0) AS used
            FROM ri_director_credits
            WHERE isdeleted = 0 AND IsActive = 1 AND @Today BETWEEN FromDate AND ToDate
            GROUP BY CreditType", new { Today = today })).ToList();

        int eT = 0, eU = 0, wT = 0, wU = 0;
        foreach (var r in rows)
        {
            var type = ((string)r.CreditType)?.ToLowerInvariant() ?? "";
            int total = (int)(long)r.total;
            int used = (int)(long)r.used;
            if (type == "email") { eT = total; eU = used; }
            else if (type == "whatsapp") { wT = total; wU = used; }
        }

        return new RiCreditBalanceDto
        {
            EmailTotal = eT,
            EmailUsed = eU,
            EmailBalance = Math.Max(0, eT - eU),
            WhatsappTotal = wT,
            WhatsappUsed = wU,
            WhatsappBalance = Math.Max(0, wT - wU)
        };
    }

    public async Task<(List<RiCreditListDto> Items, int TotalCount)> GetCreditsAsync(string? creditType, int page, int pageSize)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var typeFilter = string.IsNullOrWhiteSpace(creditType) ? "" : " AND CreditType = @CreditType ";
        var countSql = $"SELECT COUNT(*) FROM ri_director_credits WHERE isdeleted = 0 {typeFilter}";
        var total = await conn.ExecuteScalarAsync<int>(countSql, new { CreditType = creditType });

        var sql = $@"
            SELECT pk_credit_id AS Id, CreditType, CreditCount, UsedCount, PreviousCount,
                   FromDate, ToDate, TransactionId, PaymentDate,
                   CASE
                       WHEN ProofDocumentPath IS NULL OR ProofDocumentPath = '' THEN NULL
                       WHEN ProofDocumentPath LIKE '/%' THEN ProofDocumentPath
                       ELSE CONCAT('/Documents/ri_credit_proofs/', ProofDocumentPath)
                   END AS ProofDocumentPath,
                   IsActive, created_date AS CreatedDate,
                   (SELECT MAX(h.created_date)
                      FROM ri_director_credit_usage_history h
                     WHERE h.CreditType = ri_director_credits.CreditType) AS LastUsedDate
            FROM ri_director_credits
            WHERE isdeleted = 0 {typeFilter}
            ORDER BY pk_credit_id DESC
            LIMIT @PageSize OFFSET @Offset";
        var items = (await conn.QueryAsync<RiCreditListDto>(sql, new
        {
            CreditType = creditType,
            PageSize = pageSize,
            Offset = (page - 1) * pageSize
        })).ToList();

        return (items, total);
    }

    public async Task<int> AddCreditAsync(RiAddCreditDto dto, IFormFile? proof, int userId, IWebHostEnvironment env)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        string? proofPath = null;
        if (proof != null && proof.Length > 0)
        {
            var uploadsDir = Path.Combine(env.WebRootPath, "Documents", "ri_credit_proofs");
            Directory.CreateDirectory(uploadsDir);
            var fn = $"{Guid.NewGuid():N}{Path.GetExtension(proof.FileName)}";
            var fp = Path.Combine(uploadsDir, fn);
            using var fs = new FileStream(fp, FileMode.Create);
            await proof.CopyToAsync(fs);
            // Store filename only — full URL reconstructed on SELECT via CONCAT('/Documents/ri_credit_proofs/', ProofDocumentPath)
            proofPath = fn;
        }
        else
        {
            proofPath = dto.ProofDocumentPath;
        }

        // Sum previous total for this type
        var previousTotal = await conn.ExecuteScalarAsync<int>(
            @"SELECT COALESCE(SUM(CreditCount),0) FROM ri_director_credits
              WHERE CreditType = @T AND isdeleted = 0", new { T = dto.CreditType });

        var id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO ri_director_credits
                (CreditType, CreditCount, UsedCount, PreviousCount, FromDate, ToDate,
                 TransactionId, PaymentDate, ProofDocumentPath, IsActive,
                 created_by, created_date, isdeleted)
            VALUES (@CreditType, @CreditCount, 0, @PreviousCount, @FromDate, @ToDate,
                    @TransactionId, @PaymentDate, @ProofPath, 1,
                    @UserId, NOW(), 0);
            SELECT LAST_INSERT_ID();",
            new
            {
                dto.CreditType,
                dto.CreditCount,
                PreviousCount = previousTotal,
                dto.FromDate,
                dto.ToDate,
                dto.TransactionId,
                dto.PaymentDate,
                ProofPath = proofPath,
                UserId = userId
            });

        return id;
    }

    public async Task DeductCreditWithHistoryAsync(string creditType, int count, string source, int? sourceId, string? sourceDetail, int userId)
    {
        if (count <= 0) return;
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var today = DateTime.Today;
        var balanceBefore = await conn.ExecuteScalarAsync<int>(@"
            SELECT COALESCE(SUM(CreditCount - UsedCount),0)
            FROM ri_director_credits
            WHERE CreditType = @T AND IsActive = 1 AND isdeleted = 0 AND @Today BETWEEN FromDate AND ToDate",
            new { T = creditType, Today = today });

        int remaining = count;
        // Deduct FIFO across active rows
        var rows = (await conn.QueryAsync<dynamic>(@"
            SELECT pk_credit_id, CreditCount, UsedCount
            FROM ri_director_credits
            WHERE CreditType = @T AND IsActive = 1 AND isdeleted = 0 AND @Today BETWEEN FromDate AND ToDate
            ORDER BY pk_credit_id ASC", new { T = creditType, Today = today })).ToList();

        foreach (var r in rows)
        {
            int avail = (int)r.CreditCount - (int)r.UsedCount;
            if (avail <= 0) continue;
            int take = Math.Min(avail, remaining);
            await conn.ExecuteAsync(
                "UPDATE ri_director_credits SET UsedCount = UsedCount + @Take, modified_by = @U, modified_date = NOW() WHERE pk_credit_id = @Id",
                new { Take = take, U = userId, Id = (int)r.pk_credit_id });
            remaining -= take;
            if (remaining <= 0) break;
        }

        var balanceAfter = Math.Max(0, balanceBefore - count);
        await conn.ExecuteAsync(@"
            INSERT INTO ri_director_credit_usage_history
                (CreditType, DeductedCount, Source, SourceId, SourceDetail,
                 BalanceBefore, BalanceAfter, created_by, created_date)
            VALUES (@T, @Ded, @Src, @SrcId, @Detail, @BB, @BA, @U, NOW())",
            new
            {
                T = creditType,
                Ded = count,
                Src = source,
                SrcId = sourceId,
                Detail = sourceDetail,
                BB = balanceBefore,
                BA = balanceAfter,
                U = userId
            });
    }

    public async Task<int> GetDeductedAmountAsync(string creditType, string source, int sourceId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        return await conn.ExecuteScalarAsync<int?>(
            @"SELECT COALESCE(SUM(DeductedCount), 0) FROM ri_director_credit_usage_history
              WHERE CreditType = @T AND Source = @S AND SourceId = @Id",
            new { T = creditType, S = source, Id = sourceId }) ?? 0;
    }

    public async Task RefundCreditWithHistoryAsync(string creditType, int count, string source, int? sourceId, string? sourceDetail, int userId)
    {
        if (count <= 0) return;
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var balanceBefore = await conn.ExecuteScalarAsync<int?>(
            @"SELECT COALESCE(SUM(CreditCount - UsedCount),0) FROM ri_director_credits
              WHERE CreditType = @T AND IsActive = 1 AND isdeleted = 0",
            new { T = creditType }) ?? 0;

        var rows = (await conn.QueryAsync<dynamic>(@"
            SELECT pk_credit_id AS Id, UsedCount FROM ri_director_credits
            WHERE CreditType = @T AND isdeleted = 0 AND UsedCount > 0
            ORDER BY pk_credit_id DESC", new { T = creditType })).ToList();

        int remaining = count;
        int totalRefunded = 0;
        foreach (var r in rows)
        {
            if (remaining <= 0) break;
            int used = (int)r.UsedCount;
            int refundFromRow = Math.Min(used, remaining);
            if (refundFromRow <= 0) continue;
            await conn.ExecuteAsync(
                "UPDATE ri_director_credits SET UsedCount = UsedCount - @R, modified_by = @U, modified_date = NOW() WHERE pk_credit_id = @Id",
                new { R = refundFromRow, U = userId, Id = (int)r.Id });
            remaining -= refundFromRow;
            totalRefunded += refundFromRow;
        }
        if (totalRefunded == 0) return;

        await conn.ExecuteAsync(@"
            INSERT INTO ri_director_credit_usage_history
                (CreditType, DeductedCount, Source, SourceId, SourceDetail,
                 BalanceBefore, BalanceAfter, created_by, created_date)
            VALUES (@T, @Count, @Src, @SrcId, @Detail, @BB, @BA, @U, NOW())",
            new
            {
                T = creditType,
                Count = -totalRefunded,
                Src = source,
                SrcId = sourceId,
                Detail = "[Refund] " + (sourceDetail ?? ""),
                BB = balanceBefore,
                BA = balanceBefore + totalRefunded,
                U = userId
            });
    }

    public async Task<bool> HasSufficientCreditsAsync(string creditType, int count)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var today = DateTime.Today;
        var avail = await conn.ExecuteScalarAsync<int>(@"
            SELECT COALESCE(SUM(CreditCount - UsedCount),0)
            FROM ri_director_credits
            WHERE CreditType = @T AND IsActive = 1 AND isdeleted = 0 AND @Today BETWEEN FromDate AND ToDate",
            new { T = creditType, Today = today });
        return avail >= count;
    }

    public async Task<(List<RiCreditUsageHistoryDto> Items, int TotalCount)> GetUsageHistoryAsync(string? creditType, int page, int pageSize)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var typeFilter = string.IsNullOrWhiteSpace(creditType) ? "" : " WHERE CreditType = @CreditType ";
        var total = await conn.ExecuteScalarAsync<int>(
            $"SELECT COUNT(*) FROM ri_director_credit_usage_history {typeFilter}",
            new { CreditType = creditType });

        var items = (await conn.QueryAsync<RiCreditUsageHistoryDto>($@"
            SELECT pk_id AS Id, CreditType, DeductedCount, Source, SourceId, SourceDetail,
                   BalanceBefore, BalanceAfter, created_date AS CreatedDate
            FROM ri_director_credit_usage_history
            {typeFilter}
            ORDER BY pk_id DESC
            LIMIT @PageSize OFFSET @Offset", new
        {
            CreditType = creditType,
            PageSize = pageSize,
            Offset = (page - 1) * pageSize
        })).ToList();

        return (items, total);
    }

    // ══════════════════════════════════════════════════════════════
    // Announcements (RI-scoped)
    // ══════════════════════════════════════════════════════════════
    public async Task<(List<AnnouncementListDto> Items, int TotalCount)> GetAnnouncementsAsync(string? status, string? search, int page, int pageSize)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var statusCondition = string.IsNullOrEmpty(status) ? "" : @"AND (
            CASE WHEN NOW() < a.PublishDateTime THEN 'Unpublished'
                 WHEN NOW() > a.ExpiryDateTime THEN 'Expired'
                 ELSE 'Published' END = @Status)";
        var searchCondition = string.IsNullOrEmpty(search) ? "" : "AND a.Title LIKE CONCAT('%', @Search, '%')";

        var sql = $@"
            SELECT a.pk_announcement_id AS Id, a.fk_club_id AS ClubId,
                   a.Title, a.Description,
                   CASE
                       WHEN a.ImagePath IS NULL OR a.ImagePath = '' THEN NULL
                       WHEN a.ImagePath LIKE '/%' THEN a.ImagePath
                       ELSE CONCAT('/Documents/announcement/ri/', a.ImagePath)
                   END AS ImagePath,
                   a.PublishDateTime, a.ExpiryDateTime,
                   a.IsDisplayOnBanner, a.IsSendWhatsapp, a.IsSendEmail, a.IsRepeatNotification,
                   a.WhatsAppSentDate, a.WhatsAppSentCount, a.WhatsAppFailedCount,
                   a.EmailSentDate, a.EmailSentCount, a.EmailFailedCount,
                   CASE WHEN NOW() < a.PublishDateTime THEN 'Unpublished'
                        WHEN NOW() > a.ExpiryDateTime THEN 'Expired'
                        ELSE 'Published' END AS Status,
                   (SELECT COUNT(*) FROM announcement_reminders r WHERE r.fk_announcement_id = a.pk_announcement_id) AS ReminderCount
            FROM announcements a
            WHERE a.Scope = 'ri' AND a.isdeleted = 0
            {statusCondition} {searchCondition}
            ORDER BY a.PublishDateTime DESC
            LIMIT @PageSize OFFSET @Offset;

            SELECT COUNT(*) FROM announcements a
            WHERE a.Scope = 'ri' AND a.isdeleted = 0
            {statusCondition} {searchCondition};";

        using var multi = await conn.QueryMultipleAsync(sql, new
        {
            Status = status ?? "",
            Search = search ?? "",
            PageSize = pageSize,
            Offset = (page - 1) * pageSize
        });

        var items = (await multi.ReadAsync<AnnouncementListDto>()).ToList();
        var totalCount = await multi.ReadSingleAsync<int>();
        return (items, totalCount);
    }

    public async Task<AnnouncementDetailDto?> GetAnnouncementByIdAsync(int id)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var detail = await conn.QueryFirstOrDefaultAsync<AnnouncementDetailDto>(@"
            SELECT pk_announcement_id AS Id, fk_club_id AS ClubId,
                   Title, Description,
                   CASE
                       WHEN ImagePath IS NULL OR ImagePath = '' THEN NULL
                       WHEN ImagePath LIKE '/%' THEN ImagePath
                       ELSE CONCAT('/Documents/announcement/ri/', ImagePath)
                   END AS ImagePath,
                   PublishDateTime, ExpiryDateTime,
                   IsDisplayOnBanner, IsSendWhatsapp, IsSendEmail, IsRepeatNotification,
                   RecipientTarget, RecipientZoneIds, RecipientDistrictIds, RecipientSubgroupIds,
                   CASE WHEN NOW() < PublishDateTime THEN 'Unpublished'
                        WHEN NOW() > ExpiryDateTime THEN 'Expired'
                        ELSE 'Published' END AS Status
            FROM announcements
            WHERE pk_announcement_id = @Id AND Scope = 'ri' AND isdeleted = 0",
            new { Id = id });

        if (detail == null) return null;

        detail.Reminders = (await conn.QueryAsync<AnnouncementReminderDto>(@"
            SELECT pk_reminder_id AS Id, ReminderDateTime
            FROM announcement_reminders WHERE fk_announcement_id = @Id ORDER BY ReminderDateTime",
            new { Id = id })).ToList();

        return detail;
    }

    public async Task<int> CreateAnnouncementAsync(CreateAnnouncementDto dto, int createdBy)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Pre-check WhatsApp credits if send flag is on — total = recipients × (1 initial + N reminders)

        // Email parity — block save when email is on without enough Email credits (counts members with an email).
        if (dto.IsSendEmail)
        {
            var emailRecipients = await GetRecipientCountAsync(
                "email", dto.RecipientTarget ?? "all",
                dto.RecipientZoneIds, dto.RecipientDistrictIds, dto.RecipientSubgroupIds);
            int erc = dto.Reminders?.Count ?? 0;
            int emailNeeded = emailRecipients * (1 + erc);
            if (emailNeeded > 0 && !await HasSufficientCreditsAsync("Email", emailNeeded))
                throw new InvalidOperationException($"Insufficient Email credits. Need {emailNeeded} credit(s) for {emailRecipients} members × {1 + erc} sends. Please uncheck 'Send through Email' to save without email notification, or reduce reminders, or purchase more credits.");
        }

        var id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO announcements (fk_club_id, fk_district_id, Scope, Title, Description, ImagePath,
                PublishDateTime, ExpiryDateTime, IsDisplayOnBanner, IsSendWhatsapp, IsSendEmail, IsRepeatNotification,
                RecipientTarget, RecipientZoneIds, RecipientDistrictIds, RecipientSubgroupIds,
                created_by, created_date, isdeleted)
            VALUES (0, NULL, 'ri', @Title, @Description, @ImagePath,
                @PublishDateTime, @ExpiryDateTime, @IsDisplayOnBanner, @IsSendWhatsapp, @IsSendEmail, @IsRepeatNotification,
                @RecipientTarget, @RecipientZoneIds, @RecipientDistrictIds, @RecipientSubgroupIds,
                @CreatedBy, NOW(), 0);
            SELECT LAST_INSERT_ID();", new
            {
                dto.Title,
                dto.Description,
                dto.ImagePath,
                dto.PublishDateTime,
                dto.ExpiryDateTime,
                IsDisplayOnBanner = dto.IsDisplayOnBanner ? 1 : 0,
                IsSendWhatsapp = 0,
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
                    INSERT INTO announcement_reminders (fk_announcement_id, ReminderDateTime, created_by, created_date)
                    VALUES (@Id, @Dt, @U, NOW())",
                    new { Id = id, Dt = r, U = createdBy });
            }
        }

        // Deduct WhatsApp credits after successful save

        return id;
    }

    public async Task UpdateAnnouncementAsync(int id, UpdateAnnouncementDto dto, int modifiedBy)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Check if send flag is being toggled on (false → true)
        var prior = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT IsSendWhatsapp, RecipientTarget, RecipientZoneIds, RecipientDistrictIds, RecipientSubgroupIds
            FROM announcements WHERE pk_announcement_id = @Id AND Scope = 'ri' AND isdeleted = 0",
            new { Id = id });
        bool priorWhatsapp = prior != null && Convert.ToBoolean(prior.IsSendWhatsapp);

        // Pre-check credits if newly turning on WhatsApp

        // Email parity — block save when email is on without enough Email credits.
        if (dto.IsSendEmail)
        {
            var emailRecipients = await GetRecipientCountAsync(
                "email", dto.RecipientTarget ?? "all",
                dto.RecipientZoneIds, dto.RecipientDistrictIds, dto.RecipientSubgroupIds);
            int erc = dto.Reminders?.Count ?? 0;
            int emailNeeded = emailRecipients * (1 + erc);
            if (emailNeeded > 0 && !await HasSufficientCreditsAsync("Email", emailNeeded))
                throw new InvalidOperationException($"Insufficient Email credits. Need {emailNeeded} credit(s) for {emailRecipients} members × {1 + erc} sends. Please uncheck 'Send through Email' to save without email notification, or reduce reminders, or purchase more credits.");
        }

        await conn.ExecuteAsync(@"
            UPDATE announcements
            SET Title = @Title, Description = @Description, ImagePath = @ImagePath,
                PublishDateTime = @PublishDateTime, ExpiryDateTime = @ExpiryDateTime,
                IsDisplayOnBanner = @IsDisplayOnBanner, IsSendWhatsapp = @IsSendWhatsapp, IsSendEmail = @IsSendEmail,
                IsRepeatNotification = @IsRepeatNotification,
                RecipientTarget = @RecipientTarget, RecipientZoneIds = @RecipientZoneIds,
                RecipientDistrictIds = @RecipientDistrictIds, RecipientSubgroupIds = @RecipientSubgroupIds,
                modified_by = @ModifiedBy, modified_date = NOW()
            WHERE pk_announcement_id = @Id AND Scope = 'ri'",
            new
            {
                Id = id,
                dto.Title,
                dto.Description,
                dto.ImagePath,
                dto.PublishDateTime,
                dto.ExpiryDateTime,
                IsDisplayOnBanner = dto.IsDisplayOnBanner ? 1 : 0,
                IsSendWhatsapp = 0,
                IsSendEmail = dto.IsSendEmail ? 1 : 0,
                IsRepeatNotification = dto.IsRepeatNotification ? 1 : 0,
                RecipientTarget = dto.RecipientTarget ?? "all",
                RecipientZoneIds = dto.RecipientZoneIds != null && dto.RecipientZoneIds.Length > 0 ? string.Join(",", dto.RecipientZoneIds) : null,
                RecipientDistrictIds = dto.RecipientDistrictIds != null && dto.RecipientDistrictIds.Length > 0 ? string.Join(",", dto.RecipientDistrictIds) : null,
                RecipientSubgroupIds = dto.RecipientSubgroupIds != null && dto.RecipientSubgroupIds.Length > 0 ? string.Join(",", dto.RecipientSubgroupIds) : null,
                ModifiedBy = modifiedBy
            });

        await conn.ExecuteAsync("DELETE FROM announcement_reminders WHERE fk_announcement_id = @Id", new { Id = id });
        if (dto.Reminders != null && dto.Reminders.Count > 0)
        {
            foreach (var r in dto.Reminders)
            {
                await conn.ExecuteAsync(@"
                    INSERT INTO announcement_reminders (fk_announcement_id, ReminderDateTime, created_by, created_date)
                    VALUES (@Id, @Dt, @U, NOW())",
                    new { Id = id, Dt = r, U = modifiedBy });
            }
        }

        // Deduct WhatsApp credits only if flag newly turned on (no refund if turned off)
    }

    public async Task DeleteAnnouncementAsync(int id, int deletedBy)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Check: refund WhatsApp credits if not yet sent by scheduler
        var row = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT IsSendWhatsapp, WhatsAppSentDate, Title FROM announcements
            WHERE pk_announcement_id = @Id AND Scope = 'ri' AND isdeleted = 0",
            new { Id = id });
        bool shouldRefund = row != null
            && Convert.ToBoolean(row.IsSendWhatsapp)
            && row.WhatsAppSentDate == null;

        await conn.ExecuteAsync(@"
            UPDATE announcements SET isdeleted = 1, modified_by = @U, modified_date = NOW()
            WHERE pk_announcement_id = @Id AND Scope = 'ri'",
            new { Id = id, U = deletedBy });

        if (shouldRefund)
        {
            var deducted = await GetDeductedAmountAsync("WhatsApp", "RiAnnouncement", id);
            if (deducted > 0)
                await RefundCreditWithHistoryAsync("WhatsApp", deducted, "RiAnnouncement", id, $"Deleted before publish: {(string)row.Title}", deletedBy);
        }
    }

    public async Task<string> UploadAnnouncementImageAsync(IFormFile file)
    {
        var uploadsPath = Path.Combine(_env.WebRootPath, "Documents", "announcement", "ri");
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
    // Recipient count helpers
    // ══════════════════════════════════════════════════════════════
    public async Task<int> GetRecipientCountAsync(string channel, string target, int[]? zoneIds, int[]? districtIds, int[]? subgroupIds = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        // channel = 'email' | 'whatsapp' — determines which contact field must be non-empty
        // target  = 'all' | 'zones' | 'districts' | 'subgroups'
        var contactFilter = channel?.ToLowerInvariant() == "whatsapp"
            ? "m.PrimaryMobileNumber IS NOT NULL AND m.PrimaryMobileNumber <> ''"
            : "m.EmailId IS NOT NULL AND m.EmailId <> ''";

        // Special-case subgroups: union of distinct members across picked groups
        if (target?.ToLowerInvariant() == "subgroups")
        {
            if (subgroupIds == null || subgroupIds.Length == 0) return 0;
            var sql = $@"
                SELECT COUNT(DISTINCT m.pk_member_master_profile_id)
                FROM sub_group_members sm
                JOIN sub_groups sg ON sg.pk_sub_group_id = sm.fk_sub_group_id AND sg.Scope = 'ri' AND sg.isdeleted = 0
                JOIN member_master_profile m ON m.pk_member_master_profile_id = sm.fk_member_master_profile_id
                WHERE sm.fk_sub_group_id IN @SubgroupIds AND sm.isdeleted = 0 AND m.isdeleted = 0
                  AND {contactFilter}";
            return await conn.ExecuteScalarAsync<int>(sql, new { SubgroupIds = subgroupIds });
        }

        string whereScope;
        object? prm;
        switch (target?.ToLowerInvariant())
        {
            case "zones":
                if (zoneIds == null || zoneIds.Length == 0) return 0;
                whereScope = "d.fk_zone_id IN @ZoneIds";
                prm = new { ZoneIds = zoneIds };
                break;
            case "districts":
                if (districtIds == null || districtIds.Length == 0) return 0;
                whereScope = "c.fk_district_id IN @DistrictIds";
                prm = new { DistrictIds = districtIds };
                break;
            default:
                whereScope = "1=1";
                prm = new { };
                break;
        }

        var sqlAll = $@"
            SELECT COUNT(DISTINCT m.pk_member_master_profile_id)
            FROM member_master_profile m
            JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id
            LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
            WHERE cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0 AND c.isdeleted = 0
              AND {contactFilter}
              AND {whereScope}";

        return await conn.ExecuteScalarAsync<int>(sqlAll, prm);
    }
}
