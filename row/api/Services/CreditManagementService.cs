using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class CreditManagementService : ICreditManagementService
{
    private readonly string _connectionString;
    private readonly IEmailService _emailService;
    private readonly ILogger<CreditManagementService> _logger;

    public CreditManagementService(IConfiguration configuration, IEmailService emailService, ILogger<CreditManagementService> logger)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _emailService = emailService;
        _logger = logger;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    // One row per offline entry (Add / count Edit) for Settings › Wallet's combined list. A failure
    // here is logged and swallowed — the credits themselves are already saved and must stay saved.
    private async Task LogOfflineEntryAsync(MySqlConnection connection, int creditId, int districtId, int clubId,
        string creditType, string entryType, int creditCount, int? countBefore, int? countAfter, DateTime? toDate,
        string? transactionId, DateTime? paymentDate, string? proofPath, int userId)
    {
        try
        {
            await connection.ExecuteAsync(
                @"INSERT INTO club_credit_offline_log (fk_credit_id, fk_district_id, fk_club_id, CreditType, EntryType,
                      CreditCount, CountBefore, CountAfter, ToDate, TransactionId, PaymentDate, ProofDocumentPath,
                      created_by, created_date)
                  VALUES (@CreditId, @DistrictId, @ClubId, @CreditType, @EntryType,
                      @CreditCount, @CountBefore, @CountAfter, @ToDate, @TransactionId, @PaymentDate, @ProofPath,
                      @UserId, NOW())",
                new { CreditId = creditId, DistrictId = districtId, ClubId = clubId, CreditType = creditType, EntryType = entryType,
                      CreditCount = creditCount, CountBefore = countBefore, CountAfter = countAfter, ToDate = toDate,
                      TransactionId = transactionId, PaymentDate = paymentDate, ProofPath = proofPath, UserId = userId });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Offline credit log write failed (credit {CreditId}, {Type} {Count}) — credits were saved", creditId, creditType, creditCount);
        }
    }

    public async Task<(List<CreditListDto> Items, int TotalCount)> GetCreditsAsync(
        int? districtId, int? clubId, string? creditType, string? status, int page, int pageSize)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var conditions = new List<string> { "cc.isdeleted = 0" };
        if (districtId.HasValue && districtId > 0) conditions.Add("cc.fk_district_id = @DistrictId");
        if (clubId.HasValue && clubId > 0) conditions.Add("cc.fk_club_id = @ClubId");
        if (!string.IsNullOrEmpty(creditType)) conditions.Add("cc.CreditType = @CreditType");
        if (!string.IsNullOrEmpty(status))
        {
            if (status == "Active")
                conditions.Add("cc.IsActive = 1 AND NOW() <= cc.ToDate");
            else if (status == "Expired")
                conditions.Add("(cc.IsActive = 0 OR NOW() > cc.ToDate)");
        }

        var whereClause = string.Join(" AND ", conditions);

        var sql = $@"
            SELECT cc.pk_credit_id AS Id,
                   d.DistrictNumber, c.ClubName, cc.CreditType,
                   cc.PreviousCount, cc.CreditCount, cc.UsedCount,
                   (cc.CreditCount - cc.UsedCount) AS Remaining,
                   cc.FromDate, cc.ToDate, cc.IsActive,
                   CASE WHEN NOW() > cc.ToDate THEN 1 ELSE 0 END AS IsExpired,
                   cc.TransactionId, cc.PaymentDate,
                   CASE
                       WHEN cc.ProofDocumentPath IS NULL OR cc.ProofDocumentPath = '' THEN NULL
                       WHEN cc.ProofDocumentPath LIKE '/%' THEN cc.ProofDocumentPath
                       ELSE CONCAT('/Documents/CreditProofs/', cc.ProofDocumentPath)
                   END AS ProofDocumentPath,
                   cc.created_date AS CreatedDate,
                   (SELECT MAX(h.created_date)
                      FROM club_credit_usage_history h
                     WHERE h.fk_club_id = cc.fk_club_id
                       AND h.fk_district_id = cc.fk_district_id
                       AND h.CreditType = cc.CreditType) AS LastUsedDate
            FROM club_credits cc
            INNER JOIN district_master d ON d.pk_district_id = cc.fk_district_id
            LEFT JOIN club_master c ON c.pk_club_id = cc.fk_club_id
            WHERE {whereClause}
            ORDER BY cc.created_date DESC
            LIMIT @PageSize OFFSET @Offset";

        var countSql = $"SELECT COUNT(*) FROM club_credits cc WHERE {whereClause}";

        var items = (await connection.QueryAsync<CreditListDto>(sql, new
        {
            DistrictId = districtId ?? 0,
            ClubId = clubId ?? 0,
            CreditType = creditType ?? "",
            PageSize = pageSize,
            Offset = (page - 1) * pageSize
        })).ToList();

        var totalCount = await connection.ExecuteScalarAsync<int>(countSql, new
        {
            DistrictId = districtId ?? 0,
            ClubId = clubId ?? 0,
            CreditType = creditType ?? "",
        });

        return (items, totalCount);
    }

    public async Task<int> AddCreditAsync(AddCreditDto dto, IFormFile? proofDocument, int userId, IWebHostEnvironment env)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Save proof document if provided
        string? proofPath = null;
        if (proofDocument != null)
        {
            var uploadsDir = Path.Combine(env.WebRootPath, "Documents", "CreditProofs");
            Directory.CreateDirectory(uploadsDir);
            var fileName = $"{Guid.NewGuid()}{Path.GetExtension(proofDocument.FileName)}";
            var filePath = Path.Combine(uploadsDir, fileName);
            using var stream = new FileStream(filePath, FileMode.Create);
            await proofDocument.CopyToAsync(stream);
            // Store filename only — full URL reconstructed on SELECT via CONCAT('/Documents/CreditProofs/', ProofDocumentPath)
            proofPath = fileName;
        }

        // Get current balance for previous count. fk_district_id must be part of the match —
        // fk_club_id = 0 is the shared "district-level" sentinel, reused by EVERY district's
        // district-level pack, so matching on fk_club_id alone let this cross districts.
        var currentBalance = await connection.ExecuteScalarAsync<int?>(
            @"SELECT SUM(CreditCount - UsedCount) FROM club_credits
              WHERE fk_club_id = @ClubId AND fk_district_id = @DistrictId AND CreditType = @CreditType
                AND IsActive = 1 AND isdeleted = 0 AND NOW() <= ToDate",
            new { ClubId = dto.FkClubId, DistrictId = dto.FkDistrictId, CreditType = dto.CreditType }) ?? 0;

        // Check if active credit exists for same district+club+type (not yet expired)
        var existing = await connection.QueryFirstOrDefaultAsync<dynamic>(
            @"SELECT pk_credit_id AS Id, CreditCount, ToDate
              FROM club_credits
              WHERE fk_club_id = @ClubId AND fk_district_id = @DistrictId AND CreditType = @CreditType
                AND IsActive = 1 AND isdeleted = 0 AND NOW() <= ToDate
              ORDER BY ToDate DESC LIMIT 1",
            new { ClubId = dto.FkClubId, DistrictId = dto.FkDistrictId, CreditType = dto.CreditType });

        int creditId;
        if (existing != null)
        {
            // Extend existing: add count, extend toDate if new is later
            var newToDate = (DateTime)existing.ToDate > dto.ToDate ? (DateTime)existing.ToDate : dto.ToDate;
            await connection.ExecuteAsync(
                @"UPDATE club_credits
                  SET CreditCount = CreditCount + @AddCount, ToDate = @NewToDate,
                      PreviousCount = @PreviousCount,
                      TransactionId = COALESCE(@TransactionId, TransactionId),
                      PaymentDate = COALESCE(@PaymentDate, PaymentDate),
                      ProofDocumentPath = COALESCE(@ProofPath, ProofDocumentPath),
                      modified_by = @UserId, modified_date = NOW()
                  WHERE pk_credit_id = @Id",
                new
                {
                    AddCount = dto.CreditCount,
                    NewToDate = newToDate,
                    PreviousCount = currentBalance,
                    TransactionId = dto.TransactionId,
                    PaymentDate = dto.PaymentDate,
                    ProofPath = proofPath,
                    UserId = userId,
                    Id = (int)existing.Id
                });
            creditId = (int)existing.Id;
        }
        else
        {
            // Insert new — FromDate = NOW(), ToDate = user-specified expiry
            creditId = await connection.ExecuteScalarAsync<int>(
                @"INSERT INTO club_credits (fk_district_id, fk_club_id, CreditType, CreditCount, UsedCount,
                      PreviousCount, FromDate, ToDate, TransactionId, PaymentDate, ProofDocumentPath,
                      IsActive, created_by, created_date, isdeleted)
                  VALUES (@DistrictId, @ClubId, @CreditType, @CreditCount, 0,
                      @PreviousCount, NOW(), @ToDate, @TransactionId, @PaymentDate, @ProofPath,
                      1, @UserId, NOW(), 0);
                  SELECT LAST_INSERT_ID();",
                new
                {
                    DistrictId = dto.FkDistrictId,
                    ClubId = dto.FkClubId,
                    dto.CreditType,
                    dto.CreditCount,
                    PreviousCount = currentBalance,
                    dto.ToDate,
                    TransactionId = dto.TransactionId,
                    PaymentDate = dto.PaymentDate,
                    ProofPath = proofPath,
                    UserId = userId
                });
        }

        await LogOfflineEntryAsync(connection, creditId, dto.FkDistrictId, dto.FkClubId, dto.CreditType, "Added",
            dto.CreditCount, null, null, dto.ToDate, dto.TransactionId, dto.PaymentDate, proofPath, userId);

        // Send confirmation email to club admin (fire-and-forget)
        _ = Task.Run(async () =>
        {
            try
            {
                using var conn2 = CreateConnection();
                // Get admin email for this club
                var adminInfo = await conn2.QueryFirstOrDefaultAsync<dynamic>(@"
                    SELECT m.MemberName, m.EmailId
                    FROM member_roles mr
                    JOIN member_master_profile m ON m.pk_member_master_profile_id = mr.fk_member_master_profile_id
                    WHERE mr.fk_role_id = 2 AND mr.fk_club_id = @ClubId AND mr.IsActive = 1 AND mr.isdeleted = 0
                    LIMIT 1", new { ClubId = dto.FkClubId });

                if (adminInfo != null && !string.IsNullOrWhiteSpace((string?)adminInfo.EmailId))
                {
                    var clubName = await conn2.ExecuteScalarAsync<string>(
                        "SELECT ClubName FROM club_master WHERE pk_club_id=@Id", new { Id = dto.FkClubId }) ?? "Club";

                    var newBalance = currentBalance + dto.CreditCount;
                    var txnHtml = !string.IsNullOrWhiteSpace(dto.TransactionId)
                        ? $"<tr><td style='padding:8px;border:1px solid #e2e8f0;font-weight:bold;'>Transaction ID</td><td style='padding:8px;border:1px solid #e2e8f0;'>{dto.TransactionId}</td></tr>"
                        : "";
                    var payDateHtml = dto.PaymentDate.HasValue
                        ? $"<tr><td style='padding:8px;border:1px solid #e2e8f0;font-weight:bold;'>Payment Date</td><td style='padding:8px;border:1px solid #e2e8f0;'>{dto.PaymentDate.Value:dd-MMM-yyyy}</td></tr>"
                        : "";

                    var subject = $"Rotary Club - {dto.CreditType} Credits Allocated for {clubName}";
                    var body = $@"
                        {EmailService.EMAIL_HEADER}
                            <h2 style='color: #1a365d; margin-top: 0;'>{dto.CreditType} Credits Allocated</h2>
                            <p>Dear {(string)adminInfo.MemberName},</p>
                            <p><strong>{dto.CreditType}</strong> credits have been allocated to <strong>{clubName}</strong>.</p>
                            <table style='width:100%;border-collapse:collapse;margin:16px 0;'>
                                <tr style='background:#f7fafc;'><td style='padding:8px;border:1px solid #e2e8f0;font-weight:bold;'>Credit Type</td><td style='padding:8px;border:1px solid #e2e8f0;'>{dto.CreditType}</td></tr>
                                <tr><td style='padding:8px;border:1px solid #e2e8f0;font-weight:bold;'>Previous Balance</td><td style='padding:8px;border:1px solid #e2e8f0;'>{currentBalance}</td></tr>
                                <tr style='background:#f7fafc;'><td style='padding:8px;border:1px solid #e2e8f0;font-weight:bold;'>Credits Added</td><td style='padding:8px;border:1px solid #e2e8f0;color:#38a169;font-weight:bold;'>+{dto.CreditCount}</td></tr>
                                <tr><td style='padding:8px;border:1px solid #e2e8f0;font-weight:bold;'>Updated Balance</td><td style='padding:8px;border:1px solid #e2e8f0;color:#1a365d;font-weight:bold;'>{newBalance}</td></tr>
                                <tr style='background:#f7fafc;'><td style='padding:8px;border:1px solid #e2e8f0;font-weight:bold;'>Expiry Date</td><td style='padding:8px;border:1px solid #e2e8f0;'>{dto.ToDate:dd-MMM-yyyy}</td></tr>
                                {txnHtml}
                                {payDateHtml}
                            </table>
                            <p style='color:#718096;font-size:13px;'>Credited on: {DateTime.Now:dd-MMM-yyyy hh:mm tt}</p>
                        {EmailService.EMAIL_FOOTER}";

                    await _emailService.SendGenericEmailAsync((string)adminInfo.EmailId, subject, body);
                }
            }
            catch (Exception ex) { _logger.LogError(ex, "Failed to send credit confirmation email"); }
        });

        return creditId;
    }

    public async Task UpdateCreditAsync(int id, UpdateCreditDto dto, IFormFile? proofDocument, int userId, IWebHostEnvironment env)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var row = await connection.QueryFirstOrDefaultAsync<dynamic>(
            @"SELECT pk_credit_id, fk_district_id, fk_club_id, CreditType, CreditCount, UsedCount, FromDate, ToDate, IsActive, isdeleted
              FROM club_credits WHERE pk_credit_id = @Id",
            new { Id = id });
        if (row == null) throw new InvalidOperationException("Credit entry not found.");
        if (Convert.ToBoolean(row.isdeleted)) throw new InvalidOperationException("Credit entry already deleted.");
        if (!Convert.ToBoolean(row.IsActive) || DateTime.Now > (DateTime)row.ToDate)
            throw new InvalidOperationException("Cannot edit an expired or inactive credit pack.");
        if (dto.CreditCount < (int)row.UsedCount)
            throw new InvalidOperationException($"New count ({dto.CreditCount}) cannot be less than already used credits ({(int)row.UsedCount}).");

        string? proofPath = null;
        if (proofDocument != null)
        {
            var uploadsDir = Path.Combine(env.WebRootPath, "Documents", "CreditProofs");
            Directory.CreateDirectory(uploadsDir);
            var fileName = $"{Guid.NewGuid()}{Path.GetExtension(proofDocument.FileName)}";
            using var stream = new FileStream(Path.Combine(uploadsDir, fileName), FileMode.Create);
            await proofDocument.CopyToAsync(stream);
            // Store filename only — full URL reconstructed on SELECT via CONCAT('/Documents/CreditProofs/', ProofDocumentPath)
            proofPath = fileName;
        }

        await connection.ExecuteAsync(
            @"UPDATE club_credits
              SET CreditCount = @CreditCount, ToDate = @ToDate,
                  TransactionId = COALESCE(@TransactionId, TransactionId),
                  PaymentDate = COALESCE(@PaymentDate, PaymentDate),
                  ProofDocumentPath = COALESCE(@ProofPath, ProofDocumentPath),
                  modified_by = @UserId, modified_date = NOW()
              WHERE pk_credit_id = @Id",
            new { dto.CreditCount, dto.ToDate, dto.TransactionId, dto.PaymentDate, ProofPath = proofPath, UserId = userId, Id = id });

        var countBefore = (int)row.CreditCount;
        if (dto.CreditCount != countBefore)
            await LogOfflineEntryAsync(connection, id, (int)row.fk_district_id, (int)row.fk_club_id, (string)row.CreditType, "Edited",
                dto.CreditCount - countBefore, countBefore, dto.CreditCount, dto.ToDate, dto.TransactionId, dto.PaymentDate, proofPath, userId);
    }

    public async Task DeleteCreditAsync(int id, int userId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var row = await connection.QueryFirstOrDefaultAsync<dynamic>(
            @"SELECT UsedCount, ToDate, IsActive, isdeleted FROM club_credits WHERE pk_credit_id = @Id",
            new { Id = id });
        if (row == null) throw new InvalidOperationException("Credit entry not found.");
        if (Convert.ToBoolean(row.isdeleted)) throw new InvalidOperationException("Credit entry already deleted.");
        if (!Convert.ToBoolean(row.IsActive) || DateTime.Now > (DateTime)row.ToDate)
            throw new InvalidOperationException("Cannot delete an expired or inactive credit pack.");
        if ((int)row.UsedCount > 0)
            throw new InvalidOperationException($"Cannot delete — {(int)row.UsedCount} credit(s) already used from this pack.");

        await connection.ExecuteAsync(
            "UPDATE club_credits SET isdeleted = 1, modified_by = @UserId, modified_date = NOW() WHERE pk_credit_id = @Id",
            new { UserId = userId, Id = id });
    }

    public async Task<CreditBalanceDto> GetClubCreditBalanceAsync(int clubId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var credits = (await connection.QueryAsync<dynamic>(
            @"SELECT CreditType, CreditCount, UsedCount, ToDate
              FROM club_credits
              WHERE (fk_club_id = @ClubId OR (fk_club_id = 0 AND fk_district_id = @ClubId))
                AND IsActive = 1 AND isdeleted = 0
                AND NOW() <= ToDate
              ORDER BY ToDate ASC",
            new { ClubId = clubId })).ToList();

        var result = new CreditBalanceDto();

        foreach (var c in credits)
        {
            if ((string)c.CreditType == "Email")
            {
                result.EmailCredits += (int)c.CreditCount;
                result.EmailUsed += (int)c.UsedCount;
                result.EmailExpiry = (DateTime)c.ToDate;
            }
        }

        result.EmailRemaining = result.EmailCredits - result.EmailUsed;

        return result;
    }

    public async Task DeductCreditAsync(int clubId, string creditType, int count)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var credits = (await connection.QueryAsync<dynamic>(
            @"SELECT pk_credit_id AS Id, CreditCount, UsedCount
              FROM club_credits
              WHERE (fk_club_id = @ClubId OR (fk_club_id = 0 AND fk_district_id = @ClubId))
                AND CreditType = @CreditType
                AND IsActive = 1 AND isdeleted = 0
                AND NOW() <= ToDate
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

    public async Task<List<CreditNotificationDto>> CheckExpiringCreditsAsync(int clubId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var notifications = (await connection.QueryAsync<CreditNotificationDto>(
            @"SELECT CreditType,
                     (CreditCount - UsedCount) AS RemainingCredits,
                     ToDate AS ExpiryDate,
                     DATEDIFF(ToDate, NOW()) AS DaysLeft
              FROM club_credits
              WHERE fk_club_id = @ClubId AND IsActive = 1 AND isdeleted = 0
                AND NOW() <= ToDate
                AND DATEDIFF(ToDate, NOW()) <= 5
                AND (CreditCount - UsedCount) > 0
              ORDER BY ToDate ASC",
            new { ClubId = clubId })).ToList();

        return notifications;
    }

    public async Task<bool> HasSufficientCreditsAsync(int clubId, string creditType, int count)
    {
        var balance = await GetClubCreditBalanceAsync(clubId);
        var available = creditType == "Email" ? balance.EmailRemaining : 0;
        return available >= count;
    }

    public async Task DeductWithHistoryAsync(int clubId, string creditType, int count, string source, int? sourceId, string? sourceDetail, int userId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Get balance before
        var balanceBefore = await connection.ExecuteScalarAsync<int?>(
            @"SELECT SUM(CreditCount - UsedCount) FROM club_credits
              WHERE (fk_club_id = @ClubId OR (fk_club_id = 0 AND fk_district_id = @ClubId))
                AND CreditType = @CreditType
                AND IsActive = 1 AND isdeleted = 0 AND NOW() <= ToDate",
            new { ClubId = clubId, CreditType = creditType }) ?? 0;

        // Deduct
        await DeductCreditAsync(clubId, creditType, count);

        // Get district id for the club
        var districtId = await connection.ExecuteScalarAsync<int?>(
            "SELECT fk_district_id FROM club_master WHERE pk_club_id = @Id", new { Id = clubId });

        // Record history
        await connection.ExecuteAsync(
            @"INSERT INTO club_credit_usage_history (fk_club_id, fk_district_id, CreditType, DeductedCount, Source, SourceId, SourceDetail, BalanceBefore, BalanceAfter, created_by, created_date)
              VALUES (@ClubId, @DistrictId, @CreditType, @Count, @Source, @SourceId, @SourceDetail, @BalanceBefore, @BalanceAfter, @UserId, NOW())",
            new { ClubId = clubId, DistrictId = districtId, CreditType = creditType, Count = count, Source = source, SourceId = sourceId, SourceDetail = sourceDetail, BalanceBefore = balanceBefore, BalanceAfter = balanceBefore - count, UserId = userId });
    }

    // District-scoped deduction — targets ONLY the district wallet
    // (club_credits with fk_club_id = 0 AND fk_district_id = @DistrictId), never a
    // club whose pk happens to equal the districtId. Used by district reminders.
    public async Task DeductDistrictWithHistoryAsync(int districtId, string creditType, int count, string source, int? sourceId, string? sourceDetail, int userId)
    {
        if (count <= 0) return;
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var balanceBefore = await connection.ExecuteScalarAsync<int?>(
            @"SELECT SUM(CreditCount - UsedCount) FROM club_credits
              WHERE fk_club_id = 0 AND fk_district_id = @DistrictId
                AND CreditType = @CreditType AND IsActive = 1 AND isdeleted = 0 AND NOW() <= ToDate",
            new { DistrictId = districtId, CreditType = creditType }) ?? 0;

        var credits = (await connection.QueryAsync<dynamic>(
            @"SELECT pk_credit_id AS Id, CreditCount, UsedCount FROM club_credits
              WHERE fk_club_id = 0 AND fk_district_id = @DistrictId
                AND CreditType = @CreditType AND IsActive = 1 AND isdeleted = 0
                AND NOW() <= ToDate AND (CreditCount - UsedCount) > 0
              ORDER BY ToDate ASC",
            new { DistrictId = districtId, CreditType = creditType })).ToList();

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

        await connection.ExecuteAsync(
            @"INSERT INTO club_credit_usage_history (fk_club_id, fk_district_id, CreditType, DeductedCount, Source, SourceId, SourceDetail, BalanceBefore, BalanceAfter, created_by, created_date)
              VALUES (0, @DistrictId, @CreditType, @Count, @Source, @SourceId, @SourceDetail, @BalanceBefore, @BalanceAfter, @UserId, NOW())",
            new { DistrictId = districtId, CreditType = creditType, Count = count, Source = source, SourceId = sourceId, SourceDetail = sourceDetail, BalanceBefore = balanceBefore, BalanceAfter = balanceBefore - count, UserId = userId });
    }

    public async Task<int> GetDeductedAmountAsync(int clubId, string creditType, string source, int sourceId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        // Sum of positive deductions (ignores any prior refund entries which are negative)
        return await connection.ExecuteScalarAsync<int?>(
            @"SELECT COALESCE(SUM(DeductedCount), 0) FROM club_credit_usage_history
              WHERE (fk_club_id = @ClubId OR fk_district_id = @ClubId)
                AND CreditType = @CreditType AND Source = @Source AND SourceId = @SourceId",
            new { ClubId = clubId, CreditType = creditType, Source = source, SourceId = sourceId }) ?? 0;
    }

    public async Task RefundWithHistoryAsync(int clubId, string creditType, int count, string source, int? sourceId, string? sourceDetail, int userId)
    {
        if (count <= 0) return;
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var balanceBefore = await connection.ExecuteScalarAsync<int?>(
            @"SELECT SUM(CreditCount - UsedCount) FROM club_credits
              WHERE (fk_club_id = @ClubId OR (fk_club_id = 0 AND fk_district_id = @ClubId))
                AND CreditType = @CreditType AND IsActive = 1 AND isdeleted = 0",
            new { ClubId = clubId, CreditType = creditType }) ?? 0;

        // Fetch credit rows for this club/creditType with UsedCount > 0 in reverse order (newest first)
        var rows = (await connection.QueryAsync<dynamic>(
            @"SELECT pk_credit_id AS Id, UsedCount FROM club_credits
              WHERE (fk_club_id = @ClubId OR (fk_club_id = 0 AND fk_district_id = @ClubId))
                AND CreditType = @CreditType AND isdeleted = 0 AND UsedCount > 0
              ORDER BY pk_credit_id DESC",
            new { ClubId = clubId, CreditType = creditType })).ToList();

        int remaining = count;
        int totalRefunded = 0;
        foreach (var r in rows)
        {
            if (remaining <= 0) break;
            int used = (int)r.UsedCount;
            int refundFromRow = Math.Min(used, remaining); // clamp: never goes below 0
            if (refundFromRow <= 0) continue;
            await connection.ExecuteAsync(
                "UPDATE club_credits SET UsedCount = UsedCount - @R, modified_by = @U, modified_date = NOW() WHERE pk_credit_id = @Id",
                new { R = refundFromRow, U = userId, Id = (int)r.Id });
            remaining -= refundFromRow;
            totalRefunded += refundFromRow;
        }

        if (totalRefunded == 0) return;

        var districtId = await connection.ExecuteScalarAsync<int?>(
            "SELECT fk_district_id FROM club_master WHERE pk_club_id = @Id", new { Id = clubId });

        await connection.ExecuteAsync(
            @"INSERT INTO club_credit_usage_history (fk_club_id, fk_district_id, CreditType, DeductedCount, Source, SourceId, SourceDetail, BalanceBefore, BalanceAfter, created_by, created_date)
              VALUES (@ClubId, @DistrictId, @CreditType, @Count, @Source, @SourceId, @SourceDetail, @BalanceBefore, @BalanceAfter, @UserId, NOW())",
            new { ClubId = clubId, DistrictId = districtId, CreditType = creditType, Count = -totalRefunded, Source = source, SourceId = sourceId, SourceDetail = "[Refund] " + (sourceDetail ?? ""), BalanceBefore = balanceBefore, BalanceAfter = balanceBefore + totalRefunded, UserId = userId });
    }

    public async Task<CreditBalanceDto> GetDistrictCreditBalanceAsync(int districtId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        var today = DateTime.Today;
        var rows = (await connection.QueryAsync<dynamic>(@"
            SELECT CreditType, COALESCE(SUM(CreditCount),0) AS total, COALESCE(SUM(UsedCount),0) AS used
            FROM club_credits
            WHERE fk_club_id = 0 AND fk_district_id = @DistrictId
              AND IsActive = 1 AND isdeleted = 0 AND @Today BETWEEN FromDate AND ToDate
            GROUP BY CreditType", new { DistrictId = districtId, Today = today })).ToList();
        int eT = 0, eU = 0;
        foreach (var r in rows)
        {
            var t = ((string)r.CreditType)?.ToLowerInvariant() ?? "";
            int total = Convert.ToInt32(r.total);
            int used = Convert.ToInt32(r.used);
            if (t == "email") { eT = total; eU = used; }
        }
        return new CreditBalanceDto { EmailCredits = eT, EmailUsed = eU, EmailRemaining = Math.Max(0, eT - eU) };
    }

    public async Task<List<CreditUsageHistoryDto>> GetUsageHistoryAsync(int? clubId, int? districtId, string? creditType, int page, int pageSize)
    {
        using var connection = CreateConnection();
        var conditions = new List<string>();
        if (clubId.HasValue && clubId > 0) conditions.Add("h.fk_club_id = @ClubId");
        if (districtId.HasValue && districtId > 0) conditions.Add("h.fk_district_id = @DistrictId");
        if (!string.IsNullOrEmpty(creditType)) conditions.Add("h.CreditType = @CreditType");
        var where = conditions.Count > 0 ? "WHERE " + string.Join(" AND ", conditions) : "";

        return (await connection.QueryAsync<CreditUsageHistoryDto>(
            $@"SELECT h.pk_id AS Id, COALESCE(c.ClubName, '') AS ClubName, COALESCE(d.DistrictNumber, '') AS DistrictNumber,
                      h.CreditType, h.DeductedCount, h.Source, h.SourceId, h.SourceDetail,
                      h.BalanceBefore, h.BalanceAfter, h.created_date AS CreatedDate
               FROM club_credit_usage_history h
               LEFT JOIN club_master c ON c.pk_club_id = h.fk_club_id
               LEFT JOIN district_master d ON d.pk_district_id = h.fk_district_id
               {where}
               ORDER BY h.created_date DESC
               LIMIT @PageSize OFFSET @Offset",
            new { ClubId = clubId ?? 0, DistrictId = districtId ?? 0, CreditType = creditType ?? "", PageSize = pageSize, Offset = (page - 1) * pageSize })).ToList();
    }
}
