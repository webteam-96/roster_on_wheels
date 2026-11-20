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

    private MySqlConnection CreateConnection() => RowDb.Connect(_connectionString);

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

        var conditions = new List<string> { "cc.isdeleted = 0",
            // Hidden club / district (inactive club, district or zone, user 2026-10-21) drop out of the list.
            HierarchyScopeSql.DistrictIdLive("cc.fk_district_id"), HierarchyScopeSql.ClubIdLive("cc.fk_club_id") };
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
                        ? $"<tr><td style='padding:8px;border:1px solid #D5DEE8;font-weight:bold;'>Transaction ID</td><td style='padding:8px;border:1px solid #D5DEE8;'>{dto.TransactionId}</td></tr>"
                        : "";
                    var payDateHtml = dto.PaymentDate.HasValue
                        ? $"<tr><td style='padding:8px;border:1px solid #D5DEE8;font-weight:bold;'>Payment Date</td><td style='padding:8px;border:1px solid #D5DEE8;'>{dto.PaymentDate.Value:dd-MMM-yyyy}</td></tr>"
                        : "";

                    var subject = $"Rotary Club - {dto.CreditType} Credits Allocated for {clubName}";
                    var body = $@"
                        {EmailService.EMAIL_HEADER}
                            <h2 style='color: #17458F; margin-top: 0;'>{dto.CreditType} Credits Allocated</h2>
                            <p>Dear {(string)adminInfo.MemberName},</p>
                            <p><strong>{dto.CreditType}</strong> credits have been allocated to <strong>{clubName}</strong>.</p>
                            <table style='width:100%;border-collapse:collapse;margin:16px 0;'>
                                <tr style='background:#F7F9FC;'><td style='padding:8px;border:1px solid #D5DEE8;font-weight:bold;'>Credit Type</td><td style='padding:8px;border:1px solid #D5DEE8;'>{dto.CreditType}</td></tr>
                                <tr><td style='padding:8px;border:1px solid #D5DEE8;font-weight:bold;'>Previous Balance</td><td style='padding:8px;border:1px solid #D5DEE8;'>{currentBalance}</td></tr>
                                <tr style='background:#F7F9FC;'><td style='padding:8px;border:1px solid #D5DEE8;font-weight:bold;'>Credits Added</td><td style='padding:8px;border:1px solid #D5DEE8;color:#38a169;font-weight:bold;'>+{dto.CreditCount}</td></tr>
                                <tr><td style='padding:8px;border:1px solid #D5DEE8;font-weight:bold;'>Updated Balance</td><td style='padding:8px;border:1px solid #D5DEE8;color:#17458F;font-weight:bold;'>{newBalance}</td></tr>
                                <tr style='background:#F7F9FC;'><td style='padding:8px;border:1px solid #D5DEE8;font-weight:bold;'>Expiry Date</td><td style='padding:8px;border:1px solid #D5DEE8;'>{dto.ToDate:dd-MMM-yyyy}</td></tr>
                                {txnHtml}
                                {payDateHtml}
                            </table>
                            <p style='color:#64748B;font-size:13px;'>Credited on: {DateTime.UtcNow:dd-MMM-yyyy hh:mm tt}</p>
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
        if (!Convert.ToBoolean(row.IsActive) || DateTime.UtcNow > (DateTime)row.ToDate)
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
        if (!Convert.ToBoolean(row.IsActive) || DateTime.UtcNow > (DateTime)row.ToDate)
            throw new InvalidOperationException("Cannot delete an expired or inactive credit pack.");
        if ((int)row.UsedCount > 0)
            throw new InvalidOperationException($"Cannot delete: {(int)row.UsedCount} credit(s) already used from this pack.");

        await connection.ExecuteAsync(
            "UPDATE club_credits SET isdeleted = 1, modified_by = @UserId, modified_date = NOW() WHERE pk_credit_id = @Id",
            new { UserId = userId, Id = id });
    }

    // ── Manual deduction + credit/debit history (user 2026-11-16) ──
    // Super Admin takes credits off ONE pack for usage that happened outside ROW (e.g. emails the support
    // team sent through a third-party app). Credited stays as given; Used goes up; one usage-history row
    // (Source "Manual deduction", SourceId = the pack, SourceDetail = the reason) with the balance before/after.
    public const string ManualDeductionSource = "Manual deduction";

    public async Task<(int BalanceBefore, int BalanceAfter)> ManualDeductAsync(int creditId, int count, string reason, int userId)
    {
        if (count <= 0) throw new InvalidOperationException("Enter how many credits to deduct (1 or more).");
        reason = (reason ?? "").Trim();
        if (reason.Length == 0) throw new InvalidOperationException("Please give the reason for the deduction.");
        if (reason.Length > 450) reason = reason[..450];

        using var connection = CreateConnection();
        await connection.OpenAsync();
        using var tx = await connection.BeginTransactionAsync();

        var row = await connection.QueryFirstOrDefaultAsync<dynamic>(
            @"SELECT fk_district_id, fk_club_id, CreditType, CreditCount, UsedCount, ToDate, IsActive, isdeleted
              FROM club_credits WHERE pk_credit_id = @Id FOR UPDATE", new { Id = creditId }, tx);
        if (row == null || Convert.ToBoolean(row.isdeleted)) throw new InvalidOperationException("Credit entry not found.");
        if (!Convert.ToBoolean(row.IsActive) || DateTime.UtcNow > (DateTime)row.ToDate)
            throw new InvalidOperationException("This credit pack is expired or inactive - nothing can be deducted from it.");
        int left = (int)row.CreditCount - (int)row.UsedCount;
        if (count > left) throw new InvalidOperationException($"Only {left} credit(s) are left in this pack - cannot deduct {count}.");

        int clubId = (int)row.fk_club_id, districtId = (int)row.fk_district_id;
        string type = (string)row.CreditType;
        // Same balance the automatic deductions record: the entity's active, unexpired packs of this type.
        var before = await connection.ExecuteScalarAsync<int?>(clubId > 0
            ? @"SELECT SUM(CreditCount - UsedCount) FROM club_credits WHERE fk_club_id = @C AND CreditType = @T
                  AND IsActive = 1 AND isdeleted = 0 AND NOW() <= ToDate"
            : @"SELECT SUM(CreditCount - UsedCount) FROM club_credits WHERE fk_club_id = 0 AND fk_district_id = @D AND CreditType = @T
                  AND IsActive = 1 AND isdeleted = 0 AND NOW() <= ToDate",
            new { C = clubId, D = districtId, T = type }, tx) ?? 0;

        await connection.ExecuteAsync(
            "UPDATE club_credits SET UsedCount = UsedCount + @N, modified_by = @U, modified_date = NOW() WHERE pk_credit_id = @Id",
            new { N = count, U = userId, Id = creditId }, tx);
        await connection.ExecuteAsync(
            @"INSERT INTO club_credit_usage_history (fk_club_id, fk_district_id, CreditType, DeductedCount, Source, SourceId, SourceDetail, BalanceBefore, BalanceAfter, created_by, created_date)
              VALUES (@C, @D, @T, @N, @S, @Id, @R, @B, @A, @U, NOW())",
            new { C = clubId, D = districtId, T = type, N = count, S = ManualDeductionSource, Id = creditId, R = reason, B = before, A = before - count, U = userId }, tx);
        await tx.CommitAsync();
        return (before, before - count);
    }

    /// <summary>Credit tally of the pack's club (or district wallet) for its type, first day to today (user 2026-11-16):
    /// every support-team action (credit / edit / minus) and online purchase is its own line; the ROW sends
    /// between two of them are ONE line (count + what was sent); running balance after each line. Details = every
    /// single entry (for the download).</summary>
    public async Task<CreditHistoryDto> GetCreditHistoryAsync(int creditId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        var row = await connection.QueryFirstOrDefaultAsync<dynamic>(
            @"SELECT cc.fk_district_id, cc.fk_club_id, cc.CreditType, d.DistrictNumber, c.ClubName
              FROM club_credits cc JOIN district_master d ON d.pk_district_id = cc.fk_district_id
              LEFT JOIN club_master c ON c.pk_club_id = cc.fk_club_id WHERE cc.pk_credit_id = @Id", new { Id = creditId });
        if (row == null) throw new InvalidOperationException("Credit entry not found.");
        int clubId = (int)row.fk_club_id, districtId = (int)row.fk_district_id;
        string type = (string)row.CreditType;
        var p = new { C = clubId, D = districtId, T = type };
        string packWhere = clubId > 0 ? "cc.fk_club_id = @C" : "cc.fk_club_id = 0 AND cc.fk_district_id = @D";

        var packs = (await connection.QueryAsync<(int Id, int CreditCount, int UsedCount, DateTime ToDate, bool IsActive, DateTime Created, DateTime? Modified, string? Txn)>($@"
            SELECT cc.pk_credit_id, cc.CreditCount, cc.UsedCount, cc.ToDate, cc.IsActive = 1, cc.created_date, cc.modified_date, cc.TransactionId
            FROM club_credits cc WHERE {packWhere} AND cc.CreditType = @T AND cc.isdeleted = 0", p)).ToList();
        var packIds = packs.Select(x => x.Id).ToList();
        var ev = new List<CreditHistoryEntryDto>();   // Kind: Credit / Debit; Group: Support / Online / ROW / Expired
        var explained = packIds.ToDictionary(x => x, _ => 0L);

        if (packIds.Count > 0)
        {
            // Online purchases (paid and credited to one of these packs).
            foreach (var o in await connection.QueryAsync<(int Pack, int Count, DateTime When, string? Pay, decimal Total)>(@"
                SELECT fk_credit_id, CreditCount, COALESCE(CreditedDate, created_date), RazorpayPaymentId, TotalAmount
                FROM wallet_topup_orders WHERE fk_credit_id IN @Ids AND PaymentStatus = 'PAID' AND IsCredited = 1 AND isdeleted = 0",
                new { Ids = packIds }))
            {
                explained[o.Pack] += o.Count;
                ev.Add(new CreditHistoryEntryDto { Date = o.When, Kind = "Credit", Group = "Online", Source = "Bought online",
                    Count = o.Count, Detail = $"{o.Pay} · {Brand.Money(o.Total)}" });
            }
            // Offline credits and pack edits by the support team.
            try
            {
                foreach (var l in await connection.QueryAsync<(int Pack, string Entry, int? Count, int? Before, int? After, DateTime When, string? Txn)>(@"
                    SELECT fk_credit_id, EntryType, CreditCount, CountBefore, CountAfter, created_date, TransactionId
                    FROM club_credit_offline_log WHERE fk_credit_id IN @Ids", new { Ids = packIds }))
                {
                    int n = l.Count ?? 0;
                    explained[l.Pack] += n;
                    ev.Add(l.Entry == "Edited"
                        ? new CreditHistoryEntryDto { Date = l.When, Kind = n >= 0 ? "Credit" : "Debit", Group = "Support", Source = "Support team edited pack",
                              Count = n, Detail = $"pack count {l.Before} -> {l.After}" }
                        : new CreditHistoryEntryDto { Date = l.When, Kind = "Credit", Group = "Support", Source = "Support team credited",
                              Count = n, Detail = string.IsNullOrWhiteSpace(l.Txn) ? null : $"Txn {l.Txn}" });
                }
            }
            catch (Exception ex) { _logger.LogWarning(ex, "Credit history: offline log not read"); }
        }
        // Whatever a pack's count holds beyond the recorded credits / edits (entries from before the log, or a
        // change with no record) - shown so the tally still adds up.
        foreach (var pk in packs)
        {
            long gap = pk.CreditCount - explained[pk.Id];
            if (gap == 0) continue;
            ev.Add(new CreditHistoryEntryDto { Date = gap > 0 ? pk.Created : (pk.Modified ?? pk.Created), Kind = gap > 0 ? "Credit" : "Debit",
                Group = "Support", Source = gap > 0 ? "Credit (no record of who added it)" : "Reduced (no record of who reduced it)",
                Count = (int)gap, Detail = "Difference between the pack count and the recorded credits" });
        }

        // Usage: ROW sends (and refunds), support-team manual deductions.
        var used = (await connection.QueryAsync<(DateTime When, int Count, string Source, string? Detail)>($@"
            SELECT h.created_date, h.DeductedCount, h.Source, h.SourceDetail FROM club_credit_usage_history h
            WHERE {(clubId > 0 ? "h.fk_club_id = @C" : "h.fk_club_id = 0 AND h.fk_district_id = @D")} AND h.CreditType = @T", p)).ToList();
        foreach (var u in used)
        {
            bool manual = u.Source == ManualDeductionSource;
            ev.Add(new CreditHistoryEntryDto { Date = u.When, Kind = u.Count < 0 ? "Credit" : "Debit", Group = manual ? "Support" : "ROW",
                Source = manual ? "Support team deducted" : u.Count < 0 ? "Refund" : SendLabel(u.Source, u.Detail),
                Count = -u.Count, Detail = u.Detail });
        }
        // Used from the packs but never recorded send by send.
        long usedAll = packs.Sum(x => (long)x.UsedCount), logged = used.Sum(x => (long)x.Count);
        if (usedAll - logged != 0 && packs.Count > 0)
        {
            var at = (used.Count > 0 ? used.Min(x => x.When) : packs.Min(x => x.Created)).AddSeconds(-1);
            ev.Add(new CreditHistoryEntryDto { Date = at, Kind = usedAll > logged ? "Debit" : "Credit", Group = "ROW",
                Source = "Sent (not recorded one by one)", Count = -(int)(usedAll - logged),
                Detail = "Used from the packs before item-wise history was kept" });
        }
        // Expired packs: what was left in them is gone.
        foreach (var pk in packs.Where(x => (!x.IsActive || x.ToDate < DateTime.UtcNow) && x.CreditCount - x.UsedCount > 0))
            ev.Add(new CreditHistoryEntryDto { Date = pk.ToDate, Kind = "Debit", Group = "Expired", Source = "Expired unused",
                Count = -(pk.CreditCount - pk.UsedCount), Detail = $"pack expired {pk.ToDate:dd/MM/yyyy}" });

        // Oldest first, running balance; consecutive ROW sends become one line.
        var ordered = ev.OrderBy(x => x.Date).ThenBy(x => x.Group == "ROW" ? 1 : 0).ToList();
        var tally = new List<CreditHistoryEntryDto>();
        long bal = 0;
        foreach (var x in ordered)
        {
            bal += x.Count;
            x.BalanceAfter = (int)bal;
            var last = tally.Count > 0 ? tally[^1] : null;
            if (x.Group == "ROW" && last != null && last.Group == "ROW")
            {
                last.Count += x.Count; last.DateTo = x.Date; last.BalanceAfter = (int)bal; last.Lines++;
                last.Parts![x.Source] = last.Parts.GetValueOrDefault(x.Source) + x.Count;
                continue;
            }
            var t = new CreditHistoryEntryDto { Date = x.Date, Kind = x.Kind, Group = x.Group, Source = x.Source, Count = x.Count,
                Detail = x.Detail, BalanceAfter = (int)bal, Lines = 1 };
            if (x.Group == "ROW") { t.Source = "Sent through ROW"; t.Parts = new Dictionary<string, int> { [x.Source] = x.Count }; }
            tally.Add(t);
        }
        foreach (var t in tally.Where(t => t.Parts != null))
        {
            t.Kind = t.Count >= 0 ? "Credit" : "Debit";
            t.Detail = string.Join(" · ", t.Parts!.OrderBy(kv => kv.Value).Select(kv => $"{kv.Key} {Math.Abs(kv.Value):N0}"));
        }

        var active = packs.Where(x => x.IsActive && x.ToDate >= DateTime.UtcNow).ToList();
        return new CreditHistoryDto
        {
            DistrictNumber = (string)row.DistrictNumber, ClubName = (string?)row.ClubName, CreditType = type,
            ActiveCredited = active.Sum(x => x.CreditCount), ActiveUsed = active.Sum(x => x.UsedCount),
            CreditedBySupport = (int)ev.Where(x => x.Group == "Support" && x.Count > 0).Sum(x => (long)x.Count),
            BoughtOnline = (int)ev.Where(x => x.Group == "Online").Sum(x => (long)x.Count),
            SentThroughRow = (int)-ev.Where(x => x.Group == "ROW").Sum(x => (long)x.Count),
            DeductedBySupport = (int)-ev.Where(x => x.Group == "Support" && x.Count < 0).Sum(x => (long)x.Count),
            Expired = (int)-ev.Where(x => x.Group == "Expired").Sum(x => (long)x.Count),
            Balance = (int)bal,
            Tally = tally,
            Entries = ordered,
        };
    }

    // What a ROW send was, for the tally's breakdown ("Birthday email 30 · Upcoming event 12").
    private static string SendLabel(string source, string? detail)
    {
        if (source == "greeting_send")
        {
            var d = detail ?? "";
            return d.StartsWith("Birthday", StringComparison.OrdinalIgnoreCase) ? "Birthday greetings"
                 : d.StartsWith("Anniversary", StringComparison.OrdinalIgnoreCase) ? "Anniversary greetings" : "Greetings";
        }
        return source switch
        {
            "UpcomingEvent" => "Upcoming events", "UpcomingEventReminder" => "Upcoming event reminders",
            "Announcement" => "Announcements", "AnnouncementReminder" => "Announcement reminders",
            "Project" => "Projects", "Newsletter" => "Newsletters", "MassEmail" => "Mass email",
            "MonthlyReportReminder" => "Monthly report reminders", "ExpiryWarning" => "Credit expiry warnings",
            _ => source,
        };
    }

    // One wallet only: a club wallet (fk_club_id = id) or a district wallet (fk_club_id = 0, fk_district_id = id).
    // Matching both let club 5 spend district 5's credits. Constant SQL fragments, never input.
    private static string WalletWhere(bool isDistrict) =>
        isDistrict ? "fk_club_id = 0 AND fk_district_id = @ClubId" : "fk_club_id = @ClubId";

    public async Task<CreditBalanceDto> GetClubCreditBalanceAsync(int clubId, bool isDistrict = false)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var credits = (await connection.QueryAsync<dynamic>(
            $@"SELECT CreditType, CreditCount, UsedCount, ToDate
              FROM club_credits
              WHERE {WalletWhere(isDistrict)}
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

    public async Task DeductCreditAsync(int clubId, string creditType, int count, bool isDistrict = false)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var credits = (await connection.QueryAsync<dynamic>(
            $@"SELECT pk_credit_id AS Id, CreditCount, UsedCount
              FROM club_credits
              WHERE {WalletWhere(isDistrict)}
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

    public async Task<bool> HasSufficientCreditsAsync(int clubId, string creditType, int count, bool isDistrict = false)
    {
        var balance = await GetClubCreditBalanceAsync(clubId, isDistrict);
        var available = creditType == "Email" ? balance.EmailRemaining : 0;
        return available >= count;
    }

    public async Task DeductWithHistoryAsync(int clubId, string creditType, int count, string source, int? sourceId, string? sourceDetail, int userId, bool isDistrict = false)
    {
        if (isDistrict) { await DeductDistrictWithHistoryAsync(clubId, creditType, count, source, sourceId, sourceDetail, userId); return; }
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Get balance before
        var balanceBefore = await connection.ExecuteScalarAsync<int?>(
            $@"SELECT SUM(CreditCount - UsedCount) FROM club_credits
              WHERE {WalletWhere(isDistrict)}
                AND CreditType = @CreditType
                AND IsActive = 1 AND isdeleted = 0 AND NOW() <= ToDate",
            new { ClubId = clubId, CreditType = creditType }) ?? 0;

        // Deduct
        await DeductCreditAsync(clubId, creditType, count, isDistrict);

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

    public async Task<int> GetDeductedAmountAsync(int clubId, string creditType, string source, int sourceId, bool isDistrict = false)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();
        // Sum of positive deductions (ignores any prior refund entries which are negative)
        return await connection.ExecuteScalarAsync<int?>(
            $@"SELECT COALESCE(SUM(DeductedCount), 0) FROM club_credit_usage_history
              WHERE {WalletWhere(isDistrict)}
                AND CreditType = @CreditType AND Source = @Source AND SourceId = @SourceId",
            new { ClubId = clubId, CreditType = creditType, Source = source, SourceId = sourceId }) ?? 0;
    }

    public async Task RefundWithHistoryAsync(int clubId, string creditType, int count, string source, int? sourceId, string? sourceDetail, int userId, bool isDistrict = false)
    {
        if (count <= 0) return;
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var balanceBefore = await connection.ExecuteScalarAsync<int?>(
            $@"SELECT SUM(CreditCount - UsedCount) FROM club_credits
              WHERE {WalletWhere(isDistrict)}
                AND CreditType = @CreditType AND IsActive = 1 AND isdeleted = 0",
            new { ClubId = clubId, CreditType = creditType }) ?? 0;

        // Fetch credit rows for this club/creditType with UsedCount > 0 in reverse order (newest first)
        var rows = (await connection.QueryAsync<dynamic>(
            $@"SELECT pk_credit_id AS Id, UsedCount FROM club_credits
              WHERE {WalletWhere(isDistrict)}
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
        var today = DateTime.UtcNow.Date;
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
        var conditions = new List<string> { HierarchyScopeSql.DistrictIdLive("h.fk_district_id"), HierarchyScopeSql.ClubIdLive("h.fk_club_id") };
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
