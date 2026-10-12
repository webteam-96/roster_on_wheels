using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using ClosedXML.Excel;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

// Thrown when a caller tries to approve/reject a payment that has already been
// approved or rejected. The controller catches this and returns 200 OK with the
// message so admins clicking the email link a second time get a clear notice
// instead of a 500 "Failed" error.
public class AlreadyHandledException : Exception
{
    public AlreadyHandledException(string message) : base(message) { }
}

public class MembershipDuesService : IMembershipDuesService
{
    private readonly string _connStr;
    private readonly IConfiguration _config;
    private readonly IEmailService _emailService;
    private readonly ISmsService _smsService;
    private readonly IInteraktService _interaktService;
    private readonly IGoogleSheetsService _googleSheetsService;
    private readonly ICreditManagementService _creditService;
    private readonly HttpClient _httpClient;
    private readonly ILogger<MembershipDuesService> _logger;

    public MembershipDuesService(IConfiguration config, IEmailService emailService, ISmsService smsService,
        IInteraktService interaktService, IHttpClientFactory httpClientFactory, IGoogleSheetsService googleSheetsService,
        ICreditManagementService creditService,
        ILogger<MembershipDuesService> logger)
    {
        _connStr = config.GetConnectionString("DefaultConnection")!;
        _config = config;
        _emailService = emailService;
        _smsService = smsService;
        _interaktService = interaktService;
        _googleSheetsService = googleSheetsService;
        _creditService = creditService;
        _httpClient = httpClientFactory.CreateClient();
        _logger = logger;
    }

    private MySqlConnection GetConnection() => new(_connStr);

    // Online amount is always DERIVED from the ONE true (base/offline) amount
    // plus the campaign's own OnlineSurchargePercent — never separately
    // stored. Mirrors ClubDuesService's onlineOwed formula/rounding.
    private static decimal ComputeOnlineAmount(decimal baseAmount, decimal surchargePercent)
        => Math.Round(baseAmount * (1 + surchargePercent / 100m), 2, MidpointRounding.AwayFromZero);

    // ═══════════════════════════════════════════════════════════════
    //  CRUD
    // ═══════════════════════════════════════════════════════════════

    public async Task<IEnumerable<MembershipDuesListDto>> GetListAsync(int? clubId, int? districtId, string? search, string? year)
    {
        using var conn = GetConnection();
        // MemberCount and PaidCount EXCLUDE honorary members (added 2026-07-09) —
        // honoraries don't pay dues, so counting them was inflating the
        // denominator on the dues listing page and dragging Paid/Unpaid ratios
        // to look wrong. Matches the dashboard KPI + member list treatment.
        var sql = new StringBuilder(@"
            SELECT md.pk_membership_dues_id AS Id, d.DistrictNumber, c.ClubName, md.RotaryYear, md.Purpose,
                   md.IsActive, md.WeblinkUrl, md.GoogleSheetId, md.GoogleSheetUrl, md.created_date AS CreatedDate,
                   (SELECT COUNT(*) FROM membership_dues_member_fees f
                    INNER JOIN club_members cm ON cm.fk_member_master_profile_id = f.fk_member_profile_id
                        AND cm.fk_club_id = md.fk_club_id
                        AND cm.IsActive = 1
                        AND COALESCE(cm.isdeleted, 0) = 0
                        AND COALESCE(cm.IsHonoraryMember, 0) = 0
                    WHERE f.fk_membership_dues_id=md.pk_membership_dues_id AND f.isdeleted=0) AS MemberCount,
                   (SELECT COUNT(DISTINCT p.fk_member_profile_id) FROM membership_dues_payments p
                    INNER JOIN club_members cm ON cm.fk_member_master_profile_id = p.fk_member_profile_id
                        AND cm.fk_club_id = md.fk_club_id
                        AND cm.IsActive = 1
                        AND COALESCE(cm.isdeleted, 0) = 0
                        AND COALESCE(cm.IsHonoraryMember, 0) = 0
                    WHERE p.fk_membership_dues_id=md.pk_membership_dues_id AND p.IsPaid=1 AND p.isdeleted=0) AS PaidCount
            FROM membership_dues md
            LEFT JOIN district_master d ON md.fk_district_id = d.pk_district_id
            LEFT JOIN club_master c ON md.fk_club_id = c.pk_club_id
            WHERE md.isdeleted=0");

        if (clubId.HasValue) sql.Append(" AND md.fk_club_id=@ClubId");
        if (districtId.HasValue) sql.Append(" AND md.fk_district_id=@DistrictId");
        if (!string.IsNullOrWhiteSpace(search)) sql.Append(" AND (md.Purpose LIKE @Search OR c.ClubName LIKE @Search)");
        if (!string.IsNullOrWhiteSpace(year)) sql.Append(" AND md.RotaryYear=@Year");
        sql.Append(" ORDER BY md.created_date DESC");

        var results = await conn.QueryAsync<MembershipDuesListDto>(sql.ToString(),
            new { ClubId = clubId, DistrictId = districtId, Search = $"%{search}%", Year = year });

        foreach (var item in results)
            item.UnpaidCount = item.MemberCount - item.PaidCount;

        return results;
    }

    public async Task<MembershipDuesDetailDto?> GetDetailAsync(int duesId)
    {
        using var conn = GetConnection();
        var dues = await conn.QueryFirstOrDefaultAsync<MembershipDuesDetailDto>(@"
            SELECT pk_membership_dues_id AS Id, fk_district_id AS FkDistrictId, fk_club_id AS FkClubId,
                   RotaryYear, Purpose, PurposeDescription, PurposeLogo, BackgroundImage,
                   ModeOfPayment, IsShowBankInReceipt,
                   IsFees1, IsFees2, IsFees3, Fees1Text, Fees2Text, Fees3Text,
                   DefaultCategoryType, DefaultAnnualAmount,
                   DefaultSemi1Amount, DefaultSemi2Amount, OnlineSurchargePercent,
                   AmountType, DefaultPercentage,
                   OfflineBankName, OfflineAccountNumber, OfflineIfscCode,
                   EmailHeaderLogo, EmailCC, EmailSubject, EmailBody,
                   EmailReminderSubject, EmailReminderBody,
                   GoogleSheetId, GoogleSheetEmail
            FROM membership_dues WHERE pk_membership_dues_id=@Id AND isdeleted=0", new { Id = duesId });

        if (dues == null) return null;

        dues.Vendors = (await conn.QueryAsync<MembershipDuesVendorDto>(@"
            SELECT v.pk_id AS Id, v.fk_kyc_id AS FkKycId, k.vendor_id AS VendorId, k.name AS VendorName,
                   v.AnnualAmount, v.Semi1Amount, v.Semi2Amount, v.IsDefault, v.IsSelf
            FROM membership_dues_vendors v
            LEFT JOIN cashfree_kyc k ON v.fk_kyc_id = k.pk_kyc_id
            WHERE v.fk_membership_dues_id=@Id AND v.isdeleted=0",
            new { Id = duesId })).ToList();

        // Assign AccountLabel sequentially
        for (int i = 0; i < dues.Vendors.Count; i++)
            dues.Vendors[i].AccountLabel = $"A/C{i + 1}";

        return dues;
    }

    public async Task<int> CreateAsync(CreateMembershipDuesDto dto, IFormFile? logo, IFormFile? bgImage,
        IFormFile? emailLogo, int userId, IWebHostEnvironment env)
    {
        using var conn = GetConnection();
        await conn.OpenAsync();
        using var tx = await conn.BeginTransactionAsync();
        try
        {
            var clubId = dto.FkClubId;

            // Check duplicate: one per club per year
            var exists = await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM membership_dues WHERE fk_club_id=@ClubId AND RotaryYear=@Year AND isdeleted=0",
                new { ClubId = clubId, Year = dto.RotaryYear }, tx);
            if (exists > 0)
                throw new InvalidOperationException("Club dues already exist for this club and year.");

            var logoPath = logo != null ? await SaveFileAsync(logo, clubId, env) : dto.PurposeLogo;
            var bgPath = bgImage != null ? await SaveFileAsync(bgImage, clubId, env) : dto.BackgroundImage;
            var emailLogoPath = emailLogo != null ? await SaveFileAsync(emailLogo, clubId, env) : dto.EmailHeaderLogo;

            // 1. Insert club dues config
            var duesId = await conn.ExecuteScalarAsync<int>(@"
                INSERT INTO membership_dues (fk_district_id, fk_club_id, RotaryYear, Purpose, PurposeDescription,
                    PurposeLogo, BackgroundImage, ModeOfPayment, IsShowBankInReceipt,
                    IsFees1, IsFees2, IsFees3, Fees1Text, Fees2Text, Fees3Text,
                    DefaultCategoryType, DefaultAnnualAmount,
                    DefaultSemi1Amount, DefaultSemi2Amount, OnlineSurchargePercent,
                    AmountType, DefaultPercentage,
                    OfflineBankName, OfflineAccountNumber, OfflineIfscCode,
                    EmailHeaderLogo, EmailCC, EmailSubject, EmailBody,
                    EmailReminderSubject, EmailReminderBody,
                    GoogleSheetEmail,
                    IsActive, created_by, created_date)
                VALUES (@FkDistrictId, @FkClubId, @RotaryYear, @Purpose, @PurposeDescription,
                    @Logo, @BgImage, @ModeOfPayment, @IsShowBankInReceipt,
                    @IsFees1, @IsFees2, @IsFees3, @Fees1Text, @Fees2Text, @Fees3Text,
                    @DefaultCategoryType, @DefaultAnnualAmount,
                    @DefaultSemi1Amount, @DefaultSemi2Amount, @OnlineSurchargePercent,
                    @AmountType, @DefaultPercentage,
                    @OfflineBankName, @OfflineAccountNumber, @OfflineIfscCode,
                    @EmailLogo, @EmailCC, @EmailSubject, @EmailBody,
                    @EmailReminderSubject, @EmailReminderBody,
                    @GoogleSheetEmail,
                    1, @UserId, NOW());
                SELECT LAST_INSERT_ID();",
                new
                {
                    dto.FkDistrictId, dto.FkClubId, dto.RotaryYear, dto.Purpose, dto.PurposeDescription,
                    Logo = logoPath, BgImage = bgPath, dto.ModeOfPayment, dto.IsShowBankInReceipt,
                    dto.IsFees1, dto.IsFees2, dto.IsFees3, dto.Fees1Text, dto.Fees2Text, dto.Fees3Text,
                    dto.DefaultCategoryType, dto.DefaultAnnualAmount,
                    dto.DefaultSemi1Amount, dto.DefaultSemi2Amount, dto.OnlineSurchargePercent,
                    dto.AmountType, dto.DefaultPercentage,
                    dto.OfflineBankName, dto.OfflineAccountNumber, dto.OfflineIfscCode,
                    EmailLogo = emailLogoPath, dto.EmailCC, dto.EmailSubject, dto.EmailBody,
                    dto.EmailReminderSubject, dto.EmailReminderBody,
                    dto.GoogleSheetEmail,
                    UserId = userId
                }, tx);

            // 2. Parse and insert vendors (frontend sends per-feeType rows, group by vendor)
            if (!string.IsNullOrWhiteSpace(dto.VendorsJson))
            {
                var rawSplits = JsonSerializer.Deserialize<List<JsonElement>>(dto.VendorsJson);
                if (rawSplits != null)
                {
                    // Group by fkKycId
                    var grouped = new Dictionary<int, (string vendorId, decimal annual, decimal semi1, decimal semi2, bool isDefault, bool isSelf)>();
                    foreach (var s in rawSplits)
                    {
                        var kycId = s.GetProperty("fkKycId").GetInt32();
                        var feeType = s.TryGetProperty("fkFeeType", out var ft) ? ft.GetInt32() : 0;
                        var amount = s.TryGetProperty("splitAmount", out var sa) ? sa.GetDecimal() : 0;
                        var vid = s.TryGetProperty("vendorId", out var vi) ? vi.GetString() ?? "" : "";
                        var isDef = s.TryGetProperty("isDefault", out var id) && id.GetBoolean();
                        var isSelf = s.TryGetProperty("isSelf", out var isf) && isf.GetBoolean();

                        if (!grouped.ContainsKey(kycId))
                            grouped[kycId] = (vid, 0, 0, 0, isDef, isSelf);

                        var cur = grouped[kycId];
                        if (feeType == 1) cur.annual = amount;
                        else if (feeType == 2) cur.semi1 = amount;
                        else if (feeType == 3) cur.semi2 = amount;
                        cur.vendorId = string.IsNullOrEmpty(cur.vendorId) ? vid : cur.vendorId;
                        cur.isDefault = cur.isDefault || isDef;
                        cur.isSelf = cur.isSelf || isSelf;
                        grouped[kycId] = cur;
                    }

                    foreach (var kvp in grouped)
                    {
                        var v = kvp.Value;
                        var vendorId = !string.IsNullOrEmpty(v.vendorId) ? v.vendorId
                            : await conn.ExecuteScalarAsync<string?>("SELECT vendor_id FROM cashfree_kyc WHERE pk_kyc_id=@Id", new { Id = kvp.Key }, tx) ?? "";
                        await conn.ExecuteAsync(@"
                            INSERT INTO membership_dues_vendors (fk_membership_dues_id, fk_kyc_id, VendorId, AnnualAmount, Semi1Amount, Semi2Amount, IsDefault, IsSelf, created_by, created_date)
                            VALUES (@DuesId, @KycId, @VendorId, @Annual, @Semi1, @Semi2, @IsDefault, @IsSelf, @UserId, NOW())",
                            new { DuesId = duesId, KycId = kvp.Key, VendorId = vendorId, Annual = v.annual, Semi1 = v.semi1, Semi2 = v.semi2, IsDefault = v.isDefault, IsSelf = v.isSelf, UserId = userId }, tx);
                    }
                }
            }

            // 2b. Default vendor is managed by frontend Step 3 — no auto-add here

            // 3. Auto-allocate fees to all club members
            var members = await conn.QueryAsync<dynamic>(@"
                SELECT cm.fk_member_master_profile_id AS MemberId
                FROM club_members cm
                JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                WHERE cm.fk_club_id=@ClubId AND cm.IsActive=1 AND cm.isdeleted=0 AND m.isdeleted=0",
                new { ClubId = dto.FkClubId }, tx);

            foreach (var m in members)
            {
                int memberId = (int)m.MemberId;
                // Insert member fee with default amounts
                var feeId = await conn.ExecuteScalarAsync<int>(@"
                    INSERT INTO membership_dues_member_fees (fk_membership_dues_id, fk_member_profile_id,
                        CategoryType, AnnualAmount, Semi1Amount, Semi2Amount, IsNewMember, created_by, created_date)
                    VALUES (@DuesId, @MemberId, @CategoryType, @AnnualAmount,
                        @Semi1Amount, @Semi2Amount, 0, @UserId, NOW());
                    SELECT LAST_INSERT_ID();",
                    new
                    {
                        DuesId = duesId, MemberId = memberId,
                        CategoryType = dto.DefaultCategoryType,
                        AnnualAmount = dto.DefaultAnnualAmount,
                        Semi1Amount = dto.DefaultSemi1Amount,
                        Semi2Amount = dto.DefaultSemi2Amount,
                        UserId = userId
                    }, tx);

                // Copy vendor splits to member
                var duesVendors = await conn.QueryAsync<dynamic>(@"
                    SELECT fk_kyc_id, AnnualAmount, Semi1Amount, Semi2Amount, IsSelf
                    FROM membership_dues_vendors WHERE fk_membership_dues_id=@DuesId AND isdeleted=0",
                    new { DuesId = duesId }, tx);

                foreach (var dv in duesVendors)
                {
                    var mvVendorId = await conn.ExecuteScalarAsync<string?>(
                        "SELECT vendor_id FROM cashfree_kyc WHERE pk_kyc_id=@Id", new { Id = (int)dv.fk_kyc_id }, tx) ?? "";
                    await conn.ExecuteAsync(@"
                        INSERT INTO membership_dues_member_vendors (fk_membership_dues_id, fk_member_profile_id, fk_member_fee_id, fk_kyc_id, VendorId, AnnualAmount, Semi1Amount, Semi2Amount, IsSelf, created_by, created_date)
                        VALUES (@DuesId, @MemberId, @FeeId, @KycId, @VendorId, @AnnualAmount, @Semi1Amount, @Semi2Amount, @IsSelf, @UserId, NOW())",
                        new { DuesId = duesId, MemberId = memberId, FeeId = feeId, KycId = (int)dv.fk_kyc_id, VendorId = mvVendorId, AnnualAmount = (decimal)dv.AnnualAmount, Semi1Amount = (decimal)dv.Semi1Amount, Semi2Amount = (decimal)dv.Semi2Amount, IsSelf = Convert.ToBoolean(dv.IsSelf), UserId = userId }, tx);
                }
            }

            // 4. Auto-create weblink entry
            if (clubId > 0)
            {
                var frontendUrl = _config["FrontendUrl"] ?? "http://localhost:3000";
                var payUrl = $"{frontendUrl}/pay/dues/{duesId}";
                var weblinkId = await conn.ExecuteScalarAsync<int>(@"
                    INSERT INTO weblinks (fk_club_id, Title, Writeup, LogoPath, LinkType, LinkUrl, Level, IsActive, created_by, created_date)
                    VALUES (@ClubId, @Title, @Desc, @Logo, 'URL', @Url, 0, 1, @UserId, NOW());
                    SELECT LAST_INSERT_ID();",
                    new { ClubId = clubId, Title = dto.Purpose ?? "Club Dues", Desc = dto.PurposeDescription, Logo = logoPath, Url = payUrl, UserId = userId }, tx);

                await conn.ExecuteAsync("UPDATE membership_dues SET fk_weblink_id=@WId, WeblinkUrl=@Url WHERE pk_membership_dues_id=@DId",
                    new { WId = weblinkId, Url = payUrl, DId = duesId }, tx);
            }

            // 4b. Apply per-member overrides (category, fees, vendor costs)
            if (!string.IsNullOrWhiteSpace(dto.MemberOverridesJson))
            {
                var overrides = JsonSerializer.Deserialize<List<JsonElement>>(dto.MemberOverridesJson);
                if (overrides != null)
                {
                    foreach (var ov in overrides)
                    {
                        var memberId = ov.GetProperty("memberId").GetInt32();
                        var setClauses = new List<string>();
                        var p = new DynamicParameters();
                        p.Add("DuesId", duesId);
                        p.Add("MemberId", memberId);

                        if (ov.TryGetProperty("categoryType", out var cat))
                        { setClauses.Add("CategoryType=@Cat"); p.Add("Cat", cat.GetString()); }
                        if (ov.TryGetProperty("annualAmount", out var a1))
                        { setClauses.Add("AnnualAmount=@A1"); p.Add("A1", a1.GetDecimal()); }
                        if (ov.TryGetProperty("semi1Amount", out var s1))
                        { setClauses.Add("Semi1Amount=@S1"); p.Add("S1", s1.GetDecimal()); }
                        if (ov.TryGetProperty("semi2Amount", out var s2))
                        { setClauses.Add("Semi2Amount=@S2"); p.Add("S2", s2.GetDecimal()); }

                        if (setClauses.Count > 0)
                        {
                            await conn.ExecuteAsync(
                                $"UPDATE membership_dues_member_fees SET {string.Join(", ", setClauses)} WHERE fk_membership_dues_id=@DuesId AND fk_member_profile_id=@MemberId AND isdeleted=0",
                                p, tx);
                        }

                        // Vendor overrides
                        if (ov.TryGetProperty("vendorOverrides", out var vOvs) && vOvs.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var vo in vOvs.EnumerateArray())
                            {
                                var kycId = vo.GetProperty("fkKycId").GetInt32();
                                var feeType = vo.GetProperty("feeType").GetInt32();
                                var amount = vo.GetProperty("amount").GetDecimal();
                                var colName = feeType == 1 ? "AnnualAmount" : feeType == 2 ? "Semi1Amount" : "Semi2Amount";

                                var feeId = await conn.ExecuteScalarAsync<int?>(
                                    "SELECT pk_id FROM membership_dues_member_fees WHERE fk_membership_dues_id=@DuesId AND fk_member_profile_id=@MemberId AND isdeleted=0",
                                    new { DuesId = duesId, MemberId = memberId }, tx);
                                if (feeId.HasValue)
                                {
                                    await conn.ExecuteAsync(
                                        $"UPDATE membership_dues_member_vendors SET {colName}=@Amt WHERE fk_member_fee_id=@FeeId AND fk_kyc_id=@KycId AND isdeleted=0",
                                        new { Amt = amount, FeeId = feeId.Value, KycId = kycId }, tx);
                                }
                            }
                        }
                    }
                }
            }

            await tx.CommitAsync();

            // 5. Fire-and-forget: Create Google Sheet if GoogleSheetEmail provided
            if (!string.IsNullOrWhiteSpace(dto.GoogleSheetEmail))
            {
                _ = Task.Run(async () =>
                {
                    try { await CreateGoogleSheetAsync(duesId); }
                    catch (Exception ex) { _logger.LogError(ex, "Failed to create Google Sheet for dues {DuesId}", duesId); }
                });
            }

            return duesId;
        }
        catch
        {
            await tx.RollbackAsync();
            throw;
        }
    }

    public async Task UpdateAsync(int duesId, CreateMembershipDuesDto dto, IFormFile? logo, IFormFile? bgImage,
        IFormFile? emailLogo, int userId, IWebHostEnvironment env)
    {
        using var conn = GetConnection();
        var existing = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT fk_club_id, PurposeLogo, BackgroundImage, EmailHeaderLogo, GoogleSheetEmail FROM membership_dues WHERE pk_membership_dues_id=@Id AND isdeleted=0",
            new { Id = duesId });
        if (existing == null) throw new KeyNotFoundException("Club dues not found.");

        var clubId = dto.FkClubId;
        var logoPath = logo != null ? await SaveFileAsync(logo, clubId, env) : (string?)existing.PurposeLogo;
        var bgPath = bgImage != null ? await SaveFileAsync(bgImage, clubId, env) : (string?)existing.BackgroundImage;
        var emailLogoPath = emailLogo != null ? await SaveFileAsync(emailLogo, clubId, env) : (string?)existing.EmailHeaderLogo;

        // 1. Update club dues config
        await conn.ExecuteAsync(@"
            UPDATE membership_dues SET
                fk_district_id=@FkDistrictId, fk_club_id=@FkClubId, RotaryYear=@RotaryYear,
                Purpose=@Purpose, PurposeDescription=@PurposeDescription,
                PurposeLogo=@Logo, BackgroundImage=@BgImage,
                ModeOfPayment=@ModeOfPayment, IsShowBankInReceipt=@IsShowBankInReceipt,
                IsFees1=@IsFees1, IsFees2=@IsFees2, IsFees3=@IsFees3,
                Fees1Text=@Fees1Text, Fees2Text=@Fees2Text, Fees3Text=@Fees3Text,
                DefaultCategoryType=@DefaultCategoryType,
                DefaultAnnualAmount=@DefaultAnnualAmount,
                DefaultSemi1Amount=@DefaultSemi1Amount, DefaultSemi2Amount=@DefaultSemi2Amount,
                OnlineSurchargePercent=@OnlineSurchargePercent,
                AmountType=@AmountType, DefaultPercentage=@DefaultPercentage,
                OfflineBankName=@OfflineBankName, OfflineAccountNumber=@OfflineAccountNumber, OfflineIfscCode=@OfflineIfscCode,
                EmailHeaderLogo=@EmailLogo, EmailCC=@EmailCC, EmailSubject=@EmailSubject, EmailBody=@EmailBody,
                EmailReminderSubject=@EmailReminderSubject, EmailReminderBody=@EmailReminderBody,
                GoogleSheetEmail=@GoogleSheetEmail,
                modified_by=@UserId, modified_date=NOW()
            WHERE pk_membership_dues_id=@Id",
            new
            {
                dto.FkDistrictId, dto.FkClubId, dto.RotaryYear, dto.Purpose, dto.PurposeDescription,
                Logo = logoPath, BgImage = bgPath,
                dto.ModeOfPayment, dto.IsShowBankInReceipt,
                dto.IsFees1, dto.IsFees2, dto.IsFees3, dto.Fees1Text, dto.Fees2Text, dto.Fees3Text,
                dto.DefaultCategoryType, dto.DefaultAnnualAmount,
                dto.DefaultSemi1Amount, dto.DefaultSemi2Amount, dto.OnlineSurchargePercent,
                dto.AmountType, dto.DefaultPercentage,
                dto.OfflineBankName, dto.OfflineAccountNumber, dto.OfflineIfscCode,
                EmailLogo = emailLogoPath, dto.EmailCC, dto.EmailSubject, dto.EmailBody,
                dto.EmailReminderSubject, dto.EmailReminderBody,
                dto.GoogleSheetEmail,
                UserId = userId, Id = duesId
            });

        // 2. Delete old vendors, re-insert new ones
        await conn.ExecuteAsync("UPDATE membership_dues_vendors SET isdeleted=1 WHERE fk_membership_dues_id=@Id", new { Id = duesId });

        if (!string.IsNullOrWhiteSpace(dto.VendorsJson))
        {
            var rawSplits = JsonSerializer.Deserialize<List<JsonElement>>(dto.VendorsJson);
            if (rawSplits != null)
            {
                var grouped = new Dictionary<int, (string vendorId, decimal annual, decimal semi1, decimal semi2, bool isDefault, bool isSelf)>();
                foreach (var s in rawSplits)
                {
                    var kycId = s.GetProperty("fkKycId").GetInt32();
                    var feeType = s.TryGetProperty("fkFeeType", out var ft) ? ft.GetInt32() : 0;
                    var amount = s.TryGetProperty("splitAmount", out var sa) ? sa.GetDecimal() : 0;
                    var vid = s.TryGetProperty("vendorId", out var vi) ? vi.GetString() ?? "" : "";
                    var isDef = s.TryGetProperty("isDefault", out var id) && id.GetBoolean();
                    var isSelf = s.TryGetProperty("isSelf", out var isf) && isf.GetBoolean();

                    if (!grouped.ContainsKey(kycId))
                        grouped[kycId] = (vid, 0, 0, 0, isDef, isSelf);

                    var cur = grouped[kycId];
                    if (feeType == 1) cur.annual = amount;
                    else if (feeType == 2) cur.semi1 = amount;
                    else if (feeType == 3) cur.semi2 = amount;
                    cur.vendorId = string.IsNullOrEmpty(cur.vendorId) ? vid : cur.vendorId;
                    cur.isDefault = cur.isDefault || isDef;
                    cur.isSelf = cur.isSelf || isSelf;
                    grouped[kycId] = cur;
                }

                foreach (var kvp in grouped)
                {
                    var v = kvp.Value;
                    var vendorId = !string.IsNullOrEmpty(v.vendorId) ? v.vendorId
                        : await conn.ExecuteScalarAsync<string?>("SELECT vendor_id FROM cashfree_kyc WHERE pk_kyc_id=@Id", new { Id = kvp.Key }) ?? "";
                    await conn.ExecuteAsync(@"
                        INSERT INTO membership_dues_vendors (fk_membership_dues_id, fk_kyc_id, VendorId, AnnualAmount, Semi1Amount, Semi2Amount, IsDefault, IsSelf, created_by, created_date)
                        VALUES (@DuesId, @KycId, @VendorId, @Annual, @Semi1, @Semi2, @IsDefault, @IsSelf, @UserId, NOW())",
                        new { DuesId = duesId, KycId = kvp.Key, VendorId = vendorId, Annual = v.annual, Semi1 = v.semi1, Semi2 = v.semi2, IsDefault = v.isDefault, IsSelf = v.isSelf, UserId = userId });
                }
            }
        }

        // 3. Cascade a changed default amount to existing members, but ONLY when
        // every member who hasn't already paid that fee type shares the
        // identical amount — i.e. nobody's been customized on Step 4 yet.
        // Members who already paid are excluded from both the uniformity
        // check and the update: their fee is a closed historical record and
        // can't be retroactively repriced. If even one still-unpaid member
        // has diverged, leave everyone untouched; the frontend greys out the
        // corresponding default-amount field in that case, so this is the
        // same rule enforced server-side (a stale page can't force a silent
        // mass-overwrite).
        async Task CascadeDefaultIfUniform(string amountCol, int feeTypeNum, decimal newAmount)
        {
            var distinctCount = await conn.ExecuteScalarAsync<int>($@"
                SELECT COUNT(DISTINCT f.{amountCol})
                FROM membership_dues_member_fees f
                WHERE f.fk_membership_dues_id=@DuesId AND f.isdeleted=0
                  AND NOT EXISTS (
                      SELECT 1 FROM membership_dues_payments p
                      WHERE p.fk_member_fee_id = f.pk_id AND p.FeeType=@FeeType AND p.IsPaid=1 AND p.isdeleted=0
                  )",
                new { DuesId = duesId, FeeType = feeTypeNum });
            if (distinctCount > 1) return;
            await conn.ExecuteAsync($@"
                UPDATE membership_dues_member_fees f
                SET f.{amountCol}=@NewAmount, f.modified_by=@UserId, f.modified_date=NOW()
                WHERE f.fk_membership_dues_id=@DuesId AND f.isdeleted=0
                  AND NOT EXISTS (
                      SELECT 1 FROM membership_dues_payments p
                      WHERE p.fk_member_fee_id = f.pk_id AND p.FeeType=@FeeType AND p.IsPaid=1 AND p.isdeleted=0
                  )",
                new { DuesId = duesId, FeeType = feeTypeNum, NewAmount = newAmount, UserId = userId });
        }
        if (dto.IsFees1) await CascadeDefaultIfUniform("AnnualAmount", 1, dto.DefaultAnnualAmount);
        if (dto.IsFees2) await CascadeDefaultIfUniform("Semi1Amount", 2, dto.DefaultSemi1Amount);
        if (dto.IsFees3) await CascadeDefaultIfUniform("Semi2Amount", 3, dto.DefaultSemi2Amount);

        // 4. Allocate fees to any new club members not yet in the table
        var newClubMembers = await conn.QueryAsync<dynamic>(@"
            SELECT cm.fk_member_master_profile_id AS MemberId
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
            WHERE cm.fk_club_id=@ClubId AND cm.IsActive=1 AND cm.isdeleted=0 AND m.isdeleted=0
              AND cm.fk_member_master_profile_id NOT IN (
                SELECT fk_member_profile_id FROM membership_dues_member_fees WHERE fk_membership_dues_id=@DuesId AND isdeleted=0
              )", new { ClubId = clubId, DuesId = duesId });

        foreach (var nm in newClubMembers)
        {
            int memberId = (int)nm.MemberId;
            var feeId = await conn.ExecuteScalarAsync<int>(@"
                INSERT INTO membership_dues_member_fees (fk_membership_dues_id, fk_member_profile_id,
                    CategoryType, AnnualAmount, Semi1Amount, Semi2Amount, IsNewMember, created_by, created_date)
                VALUES (@DuesId, @MemberId, @CategoryType, @AnnualAmount,
                    @Semi1Amount, @Semi2Amount, 1, @UserId, NOW());
                SELECT LAST_INSERT_ID();",
                new { DuesId = duesId, MemberId = memberId, CategoryType = dto.DefaultCategoryType,
                      AnnualAmount = dto.DefaultAnnualAmount,
                      Semi1Amount = dto.DefaultSemi1Amount,
                      Semi2Amount = dto.DefaultSemi2Amount,
                      UserId = userId });

            var duesVendors = await conn.QueryAsync<dynamic>(
                "SELECT fk_kyc_id, VendorId, AnnualAmount, Semi1Amount, Semi2Amount, IsSelf FROM membership_dues_vendors WHERE fk_membership_dues_id=@DuesId AND isdeleted=0",
                new { DuesId = duesId });
            foreach (var dv in duesVendors)
            {
                await conn.ExecuteAsync(@"
                    INSERT INTO membership_dues_member_vendors (fk_membership_dues_id, fk_member_profile_id, fk_member_fee_id, fk_kyc_id, VendorId, AnnualAmount, Semi1Amount, Semi2Amount, IsSelf, created_by, created_date)
                    VALUES (@DuesId, @MemberId, @FeeId, @KycId, @VendorId, @AnnualAmount, @Semi1Amount, @Semi2Amount, @IsSelf, @UserId, NOW())",
                    new { DuesId = duesId, MemberId = memberId, FeeId = feeId, KycId = (int)dv.fk_kyc_id, VendorId = (string)dv.VendorId,
                          AnnualAmount = (decimal)dv.AnnualAmount, Semi1Amount = (decimal)dv.Semi1Amount, Semi2Amount = (decimal)dv.Semi2Amount,
                          IsSelf = Convert.ToBoolean(dv.IsSelf), UserId = userId });
            }
        }

        // 5. Clear IsNewMember flag for all members (they've been reviewed/saved)
        await conn.ExecuteAsync(
            "UPDATE membership_dues_member_fees SET IsNewMember=0 WHERE fk_membership_dues_id=@DuesId AND IsNewMember=1",
            new { DuesId = duesId });

        // 6. If GoogleSheetEmail changed, create new sheet
        var oldEmail = (string?)existing.GoogleSheetEmail;
        if (!string.IsNullOrWhiteSpace(dto.GoogleSheetEmail) && dto.GoogleSheetEmail != oldEmail)
        {
            _ = Task.Run(async () =>
            {
                try { await CreateGoogleSheetAsync(duesId); }
                catch (Exception ex) { _logger.LogError(ex, "Failed to create Google Sheet for dues {DuesId}", duesId); }
            });
        }
    }

    public async Task UpdateBasicAsync(int duesId, string? purpose, string? purposeDescription,
        string? emailCC, string? emailSubject, string? emailBody,
        string? emailReminderSubject, string? emailReminderBody,
        IFormFile? logo, IFormFile? bgImage, IFormFile? emailLogo,
        int userId, IWebHostEnvironment env)
    {
        using var conn = GetConnection();
        var existing = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT fk_club_id, PurposeLogo, BackgroundImage, EmailHeaderLogo FROM membership_dues WHERE pk_membership_dues_id=@Id AND isdeleted=0",
            new { Id = duesId });
        if (existing == null) throw new KeyNotFoundException("Club dues not found.");

        var clubId = (int)existing.fk_club_id;
        var logoPath = logo != null ? await SaveFileAsync(logo, clubId, env) : (string?)existing.PurposeLogo;
        var bgPath = bgImage != null ? await SaveFileAsync(bgImage, clubId, env) : (string?)existing.BackgroundImage;
        var emailLogoPath = emailLogo != null ? await SaveFileAsync(emailLogo, clubId, env) : (string?)existing.EmailHeaderLogo;

        await conn.ExecuteAsync(@"
            UPDATE membership_dues SET
                Purpose=@Purpose, PurposeDescription=@PurposeDescription,
                PurposeLogo=@Logo, BackgroundImage=@BgImage,
                EmailHeaderLogo=@EmailLogo, EmailCC=@EmailCC,
                EmailSubject=@EmailSubject, EmailBody=@EmailBody,
                EmailReminderSubject=@EmailReminderSubject, EmailReminderBody=@EmailReminderBody,
                modified_by=@UserId, modified_date=NOW()
            WHERE pk_membership_dues_id=@Id",
            new
            {
                Purpose = purpose, PurposeDescription = purposeDescription,
                Logo = logoPath, BgImage = bgPath, EmailLogo = emailLogoPath,
                EmailCC = emailCC, EmailSubject = emailSubject, EmailBody = emailBody,
                EmailReminderSubject = emailReminderSubject, EmailReminderBody = emailReminderBody,
                UserId = userId, Id = duesId
            });
    }

    public async Task DeleteAsync(int duesId, int userId)
    {
        using var conn = GetConnection();
        await conn.ExecuteAsync("UPDATE membership_dues SET isdeleted=1, modified_by=@UserId, modified_date=NOW() WHERE pk_membership_dues_id=@Id", new { Id = duesId, UserId = userId });
        await conn.ExecuteAsync("UPDATE membership_dues_vendors SET isdeleted=1 WHERE fk_membership_dues_id=@Id", new { Id = duesId });
        await conn.ExecuteAsync("UPDATE membership_dues_member_fees SET isdeleted=1 WHERE fk_membership_dues_id=@Id", new { Id = duesId });
        await conn.ExecuteAsync("UPDATE membership_dues_member_vendors SET isdeleted=1 WHERE fk_membership_dues_id=@Id", new { Id = duesId });
        await conn.ExecuteAsync("UPDATE membership_dues_payments SET isdeleted=1 WHERE fk_membership_dues_id=@Id", new { Id = duesId });
    }

    public async Task ToggleActiveAsync(int duesId, int userId)
    {
        using var conn = GetConnection();
        await conn.ExecuteAsync(@"
            UPDATE membership_dues SET IsActive = NOT IsActive, modified_by=@UserId, modified_date=NOW()
            WHERE pk_membership_dues_id=@Id",
            new { Id = duesId, UserId = userId });
    }

    // ═══════════════════════════════════════════════════════════════
    //  MEMBER FEES
    // ═══════════════════════════════════════════════════════════════

    // One raw payment row for a campaign. Deliberately kept as ints (not bools)
    // for IsPaid/IsOnline: membership_dues_payments.IsOnline is declared tinyint(1)
    // but production actually stores 0, 1 AND 2, and the old SQL tested `IsOnline=1`
    // / `IsOnline=0`. Mapping to bool would silently reclassify every IsOnline=2 row
    // as an online (gateway) payment, so the `== 1` / `== 0` tests below are exact.
    private sealed class DuesPaymentRow
    {
        public int MemberFeeId { get; set; }
        public int PaymentId { get; set; }
        public int FeeType { get; set; }
        public decimal Amount { get; set; }
        public int? IsPaid { get; set; }
        public int? IsOnline { get; set; }
        public string? PaymentStatus { get; set; }
        public DateTime? PaymentDate { get; set; }
        public string? TransactionId { get; set; }
        public string? OfflineStatus { get; set; }
        public string? OfflineTransactionType { get; set; }
        public string? OfflineTransactionId { get; set; }
        public string? OfflineGivenTo { get; set; }
        public string? OfflineRemark { get; set; }
        public string? Attachment { get; set; }
        public DateTime? CreatedDate { get; set; }
    }

    // Mirrors the old inline SQL CASE that turned a payment row into a display mode.
    private static string PaymentModeOf(DuesPaymentRow p) => p.IsOnline == 1
        ? "Payment Gateway"
        : p.OfflineTransactionType switch
        {
            "1" => "Cash",
            "2" => "Cheque",
            "3" => "NEFT",
            "4" => "UPI",
            "5" => "Other",
            var t => string.IsNullOrEmpty(t) ? "Cash" : t
        };

    // `ORDER BY <key> DESC LIMIT 1`. MySQL sorts NULLs last in DESC, and so does this
    // (null sorts lowest in .NET comparers). pk_id is the tiebreaker so repeat calls
    // are deterministic — the old SQL left ties to the storage engine.
    private static DuesPaymentRow? Latest(IEnumerable<DuesPaymentRow> rows, Func<DuesPaymentRow, DateTime?> key)
        => rows.OrderByDescending(key).ThenByDescending(r => r.PaymentId).FirstOrDefault();

    public async Task<object> GetMemberFeesAsync(int duesId, string? search, string? filter)
    {
        using var conn = GetConnection();

        // Get dues config for fee toggles
        var duesConfig = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT IsFees1, IsFees2, IsFees3, Fees1Text, Fees2Text, Fees3Text, RotaryYear,
                   DefaultAnnualAmount, DefaultSemi1Amount, DefaultSemi2Amount
            FROM membership_dues WHERE pk_membership_dues_id=@Id AND isdeleted=0", new { Id = duesId });
        if (duesConfig == null) throw new KeyNotFoundException("Club dues not found.");
        decimal defaultAnnual = (decimal)duesConfig.DefaultAnnualAmount;
        decimal defaultSemi1 = (decimal)duesConfig.DefaultSemi1Amount;
        decimal defaultSemi2 = (decimal)duesConfig.DefaultSemi2Amount;

        // ── PERF ───────────────────────────────────────────────────────────────
        // This used to be ONE query carrying ~25 correlated subqueries over
        // membership_dues_payments per member row (plus more in the filter and the
        // ORDER BY). membership_dues_payments has no index other than its PRIMARY
        // KEY, so every one of those subqueries was a full table scan: a 160-member
        // campaign meant ~4,000 scans of a ~12,800-row table (~51M row reads) and the
        // endpoint took ~40 SECONDS, which is what timed out the SuperAdmin wizard's
        // Step 4 (Member List).
        //
        // It is now two set-based queries — the member rows, and every payment row
        // for this campaign in ONE pass — with the per-member roll-up done in memory.
        // Same output, same ordering, ~0.2-1.0s. Measured on the real 160-member
        // campaign: 39,673 ms -> 367 ms. The filter/search/ORDER BY subqueries moved
        // in-memory too, since each one was another full scan per row.
        var sql = new StringBuilder(@"
            SELECT f.pk_id AS MemberFeeId, f.fk_member_profile_id AS MemberId, m.MemberName, f.CategoryType,
                   f.AnnualAmount, @DefaultAnnual AS AnnualBaseAmount,
                   f.Semi1Amount, @DefaultSemi1 AS Semi1BaseAmount,
                   f.Semi2Amount, @DefaultSemi2 AS Semi2BaseAmount,
                   f.IsNewMember
            FROM membership_dues_member_fees f
            JOIN member_master_profile m ON f.fk_member_profile_id = m.pk_member_master_profile_id
                AND m.isdeleted = 0
            JOIN membership_dues md ON md.pk_membership_dues_id = f.fk_membership_dues_id
            JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
                AND cm.fk_club_id = md.fk_club_id
                AND cm.IsActive = 1
                AND COALESCE(cm.isdeleted, 0) = 0
                AND COALESCE(cm.IsHonoraryMember, 0) = 0
            WHERE f.fk_membership_dues_id=@DuesId AND f.isdeleted=0");

        if (!string.IsNullOrWhiteSpace(search))
            sql.Append(" AND m.MemberName LIKE @Search");

        // Name order is settled here (MySQL collation); the pending/new-member ranking
        // is applied afterwards as a STABLE sort, which reproduces the old
        // `ORDER BY <rank>, m.MemberName` exactly.
        sql.Append(" ORDER BY m.MemberName");

        var fees = (await conn.QueryAsync<MemberFeesListDto>(sql.ToString(),
            new { DuesId = duesId, Search = $"%{search}%", DefaultAnnual = defaultAnnual, DefaultSemi1 = defaultSemi1, DefaultSemi2 = defaultSemi2 })).ToList();

        // Every non-deleted payment for this campaign, in one scan. Joining through
        // membership_dues_member_fees (rather than trusting p.fk_membership_dues_id)
        // keeps this identical to the correlated subqueries it replaces.
        var payments = (await conn.QueryAsync<DuesPaymentRow>(@"
            SELECT p.fk_member_fee_id AS MemberFeeId, p.pk_id AS PaymentId, p.FeeType,
                   p.Amount, p.IsPaid, p.IsOnline, p.PaymentStatus, p.PaymentDate,
                   p.TransactionId, p.OfflineStatus, p.OfflineTransactionType,
                   p.OfflineTransactionId, p.OfflineGivenTo, p.OfflineRemark,
                   p.Attachment, p.created_date AS CreatedDate
            FROM membership_dues_payments p
            JOIN membership_dues_member_fees f ON f.pk_id = p.fk_member_fee_id
            WHERE f.fk_membership_dues_id=@DuesId AND f.isdeleted=0 AND p.isdeleted=0",
            new { DuesId = duesId })).ToList();

        var paymentsByFee = payments.GroupBy(p => p.MemberFeeId)
            .ToDictionary(g => g.Key, g => g.ToList());
        var noPayments = new List<DuesPaymentRow>();

        foreach (var f in fees)
        {
            var ps = paymentsByFee.TryGetValue(f.MemberFeeId, out var list) ? list : noPayments;

            // Pending offline approval — latest by created_date, across all fee types.
            var pending = ps.Where(p => p.OfflineStatus == "Pending").ToList();
            var latestPending = Latest(pending, p => p.CreatedDate);
            f.HasPendingApproval = pending.Count > 0;
            f.PendingPaymentId = latestPending?.PaymentId;
            f.PendingFeeType = latestPending?.FeeType;
            f.PendingTransactionType = latestPending?.OfflineTransactionType;
            f.PendingTransactionId = latestPending?.OfflineTransactionId;
            f.PendingGivenTo = latestPending?.OfflineGivenTo;
            f.PendingPaymentDate = latestPending?.PaymentDate;
            f.PendingRemark = latestPending?.OfflineRemark;
            f.PendingAttachment = latestPending?.Attachment;
            f.PendingAmount = latestPending?.Amount;

            for (int ft = 1; ft <= 3; ft++)
            {
                var ftRows = ps.Where(p => p.FeeType == ft).ToList();
                var paidRows = ftRows.Where(p => p.IsPaid == 1).ToList();

                decimal paid = paidRows.Sum(p => p.Amount);
                string? status = Latest(ftRows, p => p.CreatedDate)?.PaymentStatus;
                var latestPaid = Latest(paidRows, p => p.PaymentDate);
                string? mode = latestPaid == null ? null : PaymentModeOf(latestPaid);
                DateTime? paidOn = latestPaid?.PaymentDate;
                int? offlineId = Latest(paidRows.Where(p => p.IsOnline == 0), p => p.PaymentDate)?.PaymentId;
                string? onlineTxn = Latest(paidRows.Where(p => p.IsOnline == 1), p => p.PaymentDate)?.TransactionId;

                if (ft == 1)
                {
                    f.AnnualPaid = paid; f.AnnualStatus = status;
                    f.AnnualPaymentMode = mode; f.AnnualPaymentDate = paidOn;
                    f.AnnualPaidOfflineId = offlineId; f.AnnualOnlineTransactionId = onlineTxn;
                }
                else if (ft == 2)
                {
                    f.Semi1Paid = paid; f.Semi1Status = status;
                    f.Semi1PaymentMode = mode; f.Semi1PaymentDate = paidOn;
                    f.Semi1PaidOfflineId = offlineId; f.Semi1OnlineTransactionId = onlineTxn;
                }
                else
                {
                    f.Semi2Paid = paid; f.Semi2Status = status;
                    f.Semi2PaymentMode = mode; f.Semi2PaymentDate = paidOn;
                    f.Semi2PaidOfflineId = offlineId; f.Semi2OnlineTransactionId = onlineTxn;
                }
            }
        }

        // Filter: all, paid, unpaid, pending — same predicates as the old EXISTS /
        // NOT EXISTS clauses, evaluated against the rows already loaded.
        if (filter == "paid")
            fees = fees.Where(f => paymentsByFee.TryGetValue(f.MemberFeeId, out var l) && l.Any(p => p.IsPaid == 1)).ToList();
        else if (filter == "unpaid")
            fees = fees.Where(f => !paymentsByFee.TryGetValue(f.MemberFeeId, out var l) || !l.Any(p => p.IsPaid == 1)).ToList();
        else if (filter == "pending")
            fees = fees.Where(f => f.HasPendingApproval).ToList();

        // Pending first, then new members, then the rest. OrderBy is a stable sort in
        // LINQ, so the MemberName order the SQL already applied is preserved within
        // each group — identical to the old SQL ORDER BY.
        fees = fees.OrderBy(f => f.HasPendingApproval ? 0 : (f.IsNewMember ? 1 : 2)).ToList();

        // Calculate balances
        foreach (var f in fees)
        {
            f.AnnualBalance = f.AnnualAmount - f.AnnualPaid;
            f.Semi1Balance = f.Semi1Amount - f.Semi1Paid;
            f.Semi2Balance = f.Semi2Amount - f.Semi2Paid;
        }

        // Get vendor splits per member (including IsDefault and IsSelf flags)
        var memberVendors = await conn.QueryAsync<dynamic>(@"
            SELECT mv.fk_member_fee_id AS MemberFeeId, k.vendor_id AS VendorId, k.name AS VendorName,
                   mv.AnnualAmount, mv.Semi1Amount, mv.Semi2Amount,
                   COALESCE(dv.IsDefault, 0) AS IsDefault,
                   COALESCE(mv.IsSelf, 0) AS IsSelf
            FROM membership_dues_member_vendors mv
            LEFT JOIN cashfree_kyc k ON mv.fk_kyc_id = k.pk_kyc_id
            LEFT JOIN membership_dues_vendors dv ON dv.fk_kyc_id = mv.fk_kyc_id AND dv.fk_membership_dues_id=@DuesId AND dv.isdeleted=0
            WHERE mv.fk_member_fee_id IN (SELECT pk_id FROM membership_dues_member_fees WHERE fk_membership_dues_id=@DuesId AND isdeleted=0)
              AND mv.isdeleted=0",
            new { DuesId = duesId });

        var vendorsByFee = memberVendors.GroupBy(v => (int)v.MemberFeeId).ToDictionary(g => g.Key, g => g.ToList());

        foreach (var f in fees)
        {
            if (vendorsByFee.TryGetValue(f.MemberFeeId, out var vList))
            {
                int idx = 0;
                f.AnnualVendors = vList.Select(v => { idx++; return new MemberVendorSplitDto { VendorId = (string)v.VendorId, VendorName = (string?)v.VendorName, Amount = (decimal)v.AnnualAmount, IsDefault = Convert.ToBoolean(v.IsDefault), IsSelf = Convert.ToBoolean(v.IsSelf), AccountLabel = $"A/C{idx}" }; }).ToList();
                idx = 0;
                f.Semi1Vendors = vList.Select(v => { idx++; return new MemberVendorSplitDto { VendorId = (string)v.VendorId, VendorName = (string?)v.VendorName, Amount = (decimal)v.Semi1Amount, IsDefault = Convert.ToBoolean(v.IsDefault), IsSelf = Convert.ToBoolean(v.IsSelf), AccountLabel = $"A/C{idx}" }; }).ToList();
                idx = 0;
                f.Semi2Vendors = vList.Select(v => { idx++; return new MemberVendorSplitDto { VendorId = (string)v.VendorId, VendorName = (string?)v.VendorName, Amount = (decimal)v.Semi2Amount, IsDefault = Convert.ToBoolean(v.IsDefault), IsSelf = Convert.ToBoolean(v.IsSelf), AccountLabel = $"A/C{idx}" }; }).ToList();
            }
        }

        return new
        {
            Config = new
            {
                IsFees1 = (bool)duesConfig.IsFees1,
                IsFees2 = (bool)duesConfig.IsFees2,
                IsFees3 = (bool)duesConfig.IsFees3,
                Fees1Text = (string?)duesConfig.Fees1Text,
                Fees2Text = (string?)duesConfig.Fees2Text,
                Fees3Text = (string?)duesConfig.Fees3Text,
                RotaryYear = (string?)duesConfig.RotaryYear
            },
            Members = fees
        };
    }

    public async Task AllocateDefaultFeesAsync(int duesId, int userId)
    {
        using var conn = GetConnection();
        var dues = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT fk_club_id, DefaultCategoryType, DefaultAnnualAmount,
                   DefaultSemi1Amount, DefaultSemi2Amount
            FROM membership_dues WHERE pk_membership_dues_id=@Id AND isdeleted=0", new { Id = duesId });
        if (dues == null) throw new KeyNotFoundException("Club dues not found.");

        // Get club members not yet allocated
        var newMembers = await conn.QueryAsync<dynamic>(@"
            SELECT cm.fk_member_master_profile_id AS MemberId
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
            WHERE cm.fk_club_id=@ClubId AND cm.IsActive=1 AND cm.isdeleted=0 AND m.isdeleted=0
              AND cm.fk_member_master_profile_id NOT IN (
                SELECT fk_member_profile_id FROM membership_dues_member_fees WHERE fk_membership_dues_id=@DuesId AND isdeleted=0
              )",
            new { ClubId = (int)dues.fk_club_id, DuesId = duesId });

        // Get vendor splits for this dues
        var duesVendors = await conn.QueryAsync<dynamic>(@"
            SELECT fk_kyc_id, AnnualAmount, Semi1Amount, Semi2Amount, IsSelf
            FROM membership_dues_vendors WHERE fk_membership_dues_id=@DuesId AND isdeleted=0",
            new { DuesId = duesId });

        foreach (var m in newMembers)
        {
            int memberId = (int)m.MemberId;
            var feeId = await conn.ExecuteScalarAsync<int>(@"
                INSERT INTO membership_dues_member_fees (fk_membership_dues_id, fk_member_profile_id,
                    CategoryType, AnnualAmount, Semi1Amount, Semi2Amount, IsNewMember, created_by, created_date)
                VALUES (@DuesId, @MemberId, @CategoryType, @AnnualAmount,
                    @Semi1Amount, @Semi2Amount, 1, @UserId, NOW());
                SELECT LAST_INSERT_ID();",
                new
                {
                    DuesId = duesId, MemberId = memberId,
                    CategoryType = (string?)dues.DefaultCategoryType,
                    AnnualAmount = (decimal)dues.DefaultAnnualAmount,
                    Semi1Amount = (decimal)dues.DefaultSemi1Amount,
                    Semi2Amount = (decimal)dues.DefaultSemi2Amount,
                    UserId = userId
                });

            foreach (var dv in duesVendors)
            {
                var mvVendorId = await conn.ExecuteScalarAsync<string?>(
                    "SELECT vendor_id FROM cashfree_kyc WHERE pk_kyc_id=@Id", new { Id = (int)dv.fk_kyc_id }) ?? "";
                await conn.ExecuteAsync(@"
                    INSERT INTO membership_dues_member_vendors (fk_membership_dues_id, fk_member_profile_id, fk_member_fee_id, fk_kyc_id, VendorId, AnnualAmount, Semi1Amount, Semi2Amount, IsSelf, created_by, created_date)
                    VALUES (@DuesId, @MemberId, @FeeId, @KycId, @VendorId, @AnnualAmount, @Semi1Amount, @Semi2Amount, @IsSelf, @UserId, NOW())",
                    new { DuesId = duesId, MemberId = (int)m.MemberId, FeeId = feeId, KycId = (int)dv.fk_kyc_id, VendorId = mvVendorId, AnnualAmount = (decimal)dv.AnnualAmount, Semi1Amount = (decimal)dv.Semi1Amount, Semi2Amount = (decimal)dv.Semi2Amount, IsSelf = Convert.ToBoolean(dv.IsSelf), UserId = userId });
            }
        }
    }

    public async Task UpdateMemberFeeAsync(int duesId, int memberFeeId, UpdateMemberFeeDto dto, int userId)
    {
        _logger.LogInformation("UpdateMemberFee: duesId={DuesId}, memberFeeId={MFId}, Cat={Cat}, Annual={A}, Semi1={S1}, Semi2={S2}",
            duesId, memberFeeId, dto.CategoryType, dto.AnnualAmount, dto.Semi1Amount, dto.Semi2Amount);

        using var conn = GetConnection();

        // Build dynamic UPDATE with only provided fields
        var setClauses = new List<string>();
        var p = new DynamicParameters();
        p.Add("UserId", userId);
        p.Add("Id", memberFeeId);
        p.Add("DuesId", duesId);

        if (dto.CategoryType != null) { setClauses.Add("CategoryType=@Cat"); p.Add("Cat", dto.CategoryType); }
        if (dto.AnnualAmount.HasValue) { setClauses.Add("AnnualAmount=@A1"); p.Add("A1", dto.AnnualAmount.Value); }
        if (dto.Semi1Amount.HasValue) { setClauses.Add("Semi1Amount=@S1"); p.Add("S1", dto.Semi1Amount.Value); }
        if (dto.Semi2Amount.HasValue) { setClauses.Add("Semi2Amount=@S2"); p.Add("S2", dto.Semi2Amount.Value); }

        if (setClauses.Count > 0)
        {
            setClauses.Add("modified_by=@UserId");
            setClauses.Add("modified_date=NOW()");
            var sql = $"UPDATE membership_dues_member_fees SET {string.Join(", ", setClauses)} WHERE pk_id=@Id AND fk_membership_dues_id=@DuesId";
            Console.WriteLine($"[UpdateMemberFee SQL] {sql} | Id={memberFeeId}, DuesId={duesId}");
            var rows = await conn.ExecuteAsync(sql, p);
            Console.WriteLine($"[UpdateMemberFee] Rows affected: {rows}");
        }
        else
        {
            Console.WriteLine($"[UpdateMemberFee] No SET clauses - nothing to update!");
        }

        // Update vendor splits if provided — format: [{ vendorId, feeType, amount }]
        if (!string.IsNullOrWhiteSpace(dto.VendorsJson))
        {
            var vendorOverrides = JsonSerializer.Deserialize<List<JsonElement>>(dto.VendorsJson);
            if (vendorOverrides != null)
            {
                foreach (var vo in vendorOverrides)
                {
                    var vendorId = vo.TryGetProperty("vendorId", out var vid) ? vid.GetString() ?? "" : "";
                    var feeType = vo.TryGetProperty("feeType", out var ft) ? ft.GetInt32() : 0;
                    var amount = vo.TryGetProperty("amount", out var amt) ? amt.GetDecimal() : 0;

                    if (string.IsNullOrEmpty(vendorId) || feeType == 0) continue;

                    var kycId = await conn.ExecuteScalarAsync<int?>(
                        "SELECT pk_kyc_id FROM cashfree_kyc WHERE vendor_id=@VendorId LIMIT 1",
                        new { VendorId = vendorId });
                    if (!kycId.HasValue) continue;

                    var colName = feeType switch { 1 => "AnnualAmount", 2 => "Semi1Amount", 3 => "Semi2Amount", _ => "" };
                    if (string.IsNullOrEmpty(colName)) continue;

                    // Update the specific fee type column for this vendor
                    var existing = await conn.ExecuteScalarAsync<int>(
                        "SELECT COUNT(*) FROM membership_dues_member_vendors WHERE fk_member_fee_id=@FeeId AND fk_kyc_id=@KycId AND isdeleted=0",
                        new { FeeId = memberFeeId, KycId = kycId.Value });

                    if (existing > 0)
                    {
                        await conn.ExecuteAsync(
                            $"UPDATE membership_dues_member_vendors SET {colName}=@Amt WHERE fk_member_fee_id=@FeeId AND fk_kyc_id=@KycId AND isdeleted=0",
                            new { Amt = amount, FeeId = memberFeeId, KycId = kycId.Value });
                    }
                }
            }
        }

        // NOTE: the default vendor's split is no longer auto-recalculated here as
        // a flat % of the fee amount — its cut is now (its own normal editable
        // split above, same as any vendor) + (100% of the online surcharge,
        // computed fresh at payment time in CreatePaymentOrderAsync). See the
        // "one true amount + online surcharge %" rework.
    }

    // ═══════════════════════════════════════════════════════════════
    //  OFFLINE PAYMENTS
    // ═══════════════════════════════════════════════════════════════

    public async Task<int> RecordOfflinePaymentAsync(int duesId, int memberFeeId, RecordOfflineDuesPaymentDto dto,
        IFormFile? attachment, int userId, IWebHostEnvironment env)
    {
        using var conn = GetConnection();

        // Get fee details to determine amount
        var fee = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT f.pk_id, f.fk_member_profile_id, f.AnnualAmount,
                   f.Semi1Amount, f.Semi2Amount,
                   md.fk_club_id
            FROM membership_dues_member_fees f
            JOIN membership_dues md ON f.fk_membership_dues_id = md.pk_membership_dues_id
            WHERE f.pk_id=@Id AND f.fk_membership_dues_id=@DuesId AND f.isdeleted=0",
            new { Id = memberFeeId, DuesId = duesId });
        if (fee == null) throw new KeyNotFoundException("Member fee not found.");

        // Offline payments always charge the ONE true (base) amount — no surcharge.
        decimal amount = dto.FeeType switch
        {
            1 => (decimal)fee.AnnualAmount,
            2 => (decimal)fee.Semi1Amount,
            3 => (decimal)fee.Semi2Amount,
            _ => 0
        };

        var clubId = (int)fee.fk_club_id;
        var attachPath = attachment != null ? await SaveFileAsync(attachment, clubId, env) : null;

        var paymentId = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO membership_dues_payments (fk_membership_dues_id, fk_member_fee_id, fk_member_profile_id,
                FeeType, Amount, IsPaid, IsOnline, PaymentStatus, OfflineStatus,
                OfflineTransactionType, OfflineTransactionId, OfflineGivenTo, OfflineBankName, OfflineChequeNumber,
                Attachment, OfflineRemark, PaymentDate,
                created_by, created_date)
            VALUES (@DuesId, @FeeId, @MemberId,
                @FeeType, @Amount, 1, 0, 'Approved', 'Approved',
                @TransType, @TransId, @GivenTo, @BankName, @ChequeNo,
                @Attach, @Remark, @PayDate,
                @UserId, NOW());
            SELECT LAST_INSERT_ID();",
            new
            {
                DuesId = duesId, FeeId = memberFeeId, MemberId = (int)fee.fk_member_profile_id,
                dto.FeeType, Amount = amount,
                TransType = dto.TransactionType ?? "", TransId = dto.TransactionId ?? "",
                GivenTo = dto.GivenTo ?? "", BankName = dto.BankName ?? "", ChequeNo = dto.ChequeNumber ?? "",
                Attach = attachPath ?? "", Remark = dto.Remark ?? "",
                PayDate = dto.PaymentDate ?? DateTime.Now,
                UserId = userId
            });

        // Send receipt email if requested (fire-and-forget)
        if (dto.SendReceiptEmail)
        {
            _ = Task.Run(async () => { try { await SendReceiptEmailAsync(paymentId); } catch { } });
        }

        return paymentId;
    }

    // Update an existing offline payment row in place. Used by the admin
    // "Update Offline" button on the members page — covers both Pending and
    // Approved (Paid) offline rows. Status fields (IsPaid / OfflineStatus /
    // PaymentStatus / IsOnline) are NOT touched here — only the data fields
    // the admin can correct. If sendReceiptOnUpdate is true AND the row is
    // currently Approved, the receipt email is re-sent so the member has
    // the corrected version. 2026-06-14.
    public async Task UpdateOfflinePaymentAsync(int paymentId, RecordOfflineDuesPaymentDto dto, IFormFile? attachment, int userId, IWebHostEnvironment env, bool sendReceiptOnUpdate)
    {
        using var conn = GetConnection();

        var existing = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT p.pk_id, p.fk_member_fee_id, p.IsOnline, p.IsPaid, p.OfflineStatus, p.PaymentStatus, p.Attachment,
                   md.fk_club_id
            FROM membership_dues_payments p
            JOIN membership_dues md ON md.pk_membership_dues_id = p.fk_membership_dues_id
            WHERE p.pk_id = @Id AND p.isdeleted = 0",
            new { Id = paymentId });
        if (existing == null) throw new KeyNotFoundException("Payment not found.");

        if (Convert.ToInt32(existing.IsOnline) == 1)
            throw new ArgumentException("Cannot update — this is an online (payment-gateway) payment.");

        // Compute the amount based on the (possibly updated) fee type, mirroring
        // the same lookup the original record path uses.
        var fee = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT f.AnnualAmount, f.Semi1Amount, f.Semi2Amount
            FROM membership_dues_member_fees f
            WHERE f.pk_id = @FeeId AND f.isdeleted = 0",
            new { FeeId = (int)existing.fk_member_fee_id });
        if (fee == null) throw new KeyNotFoundException("Member fee allocation not found.");

        // Offline payments always charge the ONE true (base) amount — no surcharge.
        decimal amount = dto.FeeType switch
        {
            1 => (decimal)fee.AnnualAmount,
            2 => (decimal)fee.Semi1Amount,
            3 => (decimal)fee.Semi2Amount,
            _ => 0
        };

        var clubId = (int)existing.fk_club_id;
        string? attachPath = attachment != null
            ? await SaveFileAsync(attachment, clubId, env)
            : (string?)existing.Attachment;

        await conn.ExecuteAsync(@"
            UPDATE membership_dues_payments
               SET FeeType                 = @FeeType,
                   Amount                  = @Amount,
                   OfflineTransactionType  = @TransType,
                   OfflineTransactionId    = @TransId,
                   OfflineGivenTo          = @GivenTo,
                   OfflineBankName         = @BankName,
                   OfflineChequeNumber     = @ChequeNo,
                   Attachment              = @Attach,
                   OfflineRemark           = @Remark,
                   PaymentDate             = @PayDate,
                   modified_by             = @UserId,
                   modified_date           = NOW()
             WHERE pk_id = @Id",
            new
            {
                Id = paymentId,
                dto.FeeType, Amount = amount,
                TransType = dto.TransactionType ?? "",
                TransId   = dto.TransactionId ?? "",
                GivenTo   = dto.GivenTo ?? "",
                BankName  = dto.BankName ?? "",
                ChequeNo  = dto.ChequeNumber ?? "",
                Attach    = attachPath ?? "",
                Remark    = dto.Remark ?? "",
                PayDate   = dto.PaymentDate ?? DateTime.Now,
                UserId    = userId
            });

        var existingStatus = ((string?)existing.OfflineStatus ?? "").Trim();
        var isApproved = string.Equals(existingStatus, "Approved", StringComparison.OrdinalIgnoreCase);
        var wasPending = string.Equals(existingStatus, "Pending", StringComparison.OrdinalIgnoreCase);

        // When admin saves an Offline Entry update on a row that is still Pending
        // (member-submitted via public form, awaiting BOD approval), treat the
        // save itself as an admin-side approval. CP/CS clicks from the email
        // later then hit the AlreadyHandledException short-circuit in
        // ApproveRejectPaymentAsync. ApprovalRemark falls back to a default
        // string when the admin leaves it blank — keeps the audit trail
        // explicit without forcing UX friction.
        if (wasPending)
        {
            var autoRemark = string.IsNullOrWhiteSpace(dto.ApprovalRemark)
                ? "Auto-approved on admin offline-entry update"
                : dto.ApprovalRemark.Trim();

            await conn.ExecuteAsync(@"
                UPDATE membership_dues_payments SET
                    IsPaid=1, PaymentStatus='Approved', OfflineStatus='Approved',
                    ApprovedBy=@UserId, ApprovedDate=NOW(), ApprovalRemark=@Remark,
                    ApprovalSource='admin-portal',
                    modified_by=@UserId, modified_date=NOW()
                WHERE pk_id=@Id",
                new { Id = paymentId, UserId = userId, Remark = autoRemark });

            // Receipt email — always on Pending→Approved transition, regardless
            // of the sendReceiptOnUpdate checkbox (which is for re-sending on an
            // already-Approved row).
            _ = Task.Run(async () =>
            {
                try { await SendReceiptEmailAsync(paymentId); }
                catch (Exception ex) { _logger.LogError(ex, "Update Offline: receipt email failed for payment {Id}", paymentId); }
            });

            // Google Sheet append mirrors the in-portal approve path.
            _ = Task.Run(async () =>
            {
                try { await SyncGoogleSheetAsync(paymentId); }
                catch (Exception ex) { _logger.LogError(ex, "Update Offline: sheet append failed for payment {Id}", paymentId); }
            });
        }
        else if (sendReceiptOnUpdate && isApproved)
        {
            _ = Task.Run(async () =>
            {
                try { await SendReceiptEmailAsync(paymentId); }
                catch (Exception ex) { _logger.LogError(ex, "Update Offline: receipt email failed for payment {Id}", paymentId); }
            });
        }
    }

    // SuperAdmin-only corrective action — undoes a mistaken offline entry (e.g. recorded
    // against the wrong member) by soft-deleting the payment row. Every read path already
    // derives paid/unpaid status live from non-deleted membership_dues_payments rows, so
    // this alone flips the member back to Unpaid — no separate status flag to fix up.
    // Online (gateway) payments can't be removed this way — real money already moved, so
    // deleting the record would just hide it, not reverse it.
    public async Task DeleteOfflinePaymentAsync(int paymentId, int userId)
    {
        using var conn = GetConnection();

        var existing = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pk_id, IsOnline
            FROM membership_dues_payments
            WHERE pk_id = @Id AND isdeleted = 0",
            new { Id = paymentId });
        if (existing == null) throw new KeyNotFoundException("Payment not found.");

        if (Convert.ToInt32(existing.IsOnline) == 1)
            throw new ArgumentException("Cannot remove — this is an online (payment-gateway) payment.");

        await conn.ExecuteAsync(@"
            UPDATE membership_dues_payments
               SET isdeleted = 1, modified_by = @UserId, modified_date = NOW()
             WHERE pk_id = @Id",
            new { Id = paymentId, UserId = userId });
    }

    public async Task<int> RecordPublicOfflinePaymentAsync(int duesId, RecordOfflineDuesPaymentDto dto, IFormFile? attachment, IWebHostEnvironment env)
    {
        using var conn = GetConnection();
        // Get member fee allocation
        var fee = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT f.pk_id AS FeeId, f.fk_member_profile_id, f.AnnualAmount, f.Semi1Amount, f.Semi2Amount,
                   md.fk_club_id
            FROM membership_dues_member_fees f
            JOIN membership_dues md ON f.fk_membership_dues_id = md.pk_membership_dues_id
            WHERE f.fk_membership_dues_id=@DuesId AND f.fk_member_profile_id=@MemberId AND f.isdeleted=0",
            new { DuesId = duesId, MemberId = dto.FkMemberProfileId });
        if (fee == null) throw new KeyNotFoundException("Member fee allocation not found.");

        int memberFeeId = (int)fee.FeeId;
        // Offline payments always charge the ONE true (base) amount — no surcharge.
        decimal amount = dto.FeeType switch
        {
            1 => (decimal)fee.AnnualAmount,
            2 => (decimal)fee.Semi1Amount,
            3 => (decimal)fee.Semi2Amount,
            _ => throw new ArgumentException("Invalid fee type.")
        };

        var clubId = (int)fee.fk_club_id;
        var attachPath = attachment != null ? await SaveFileAsync(attachment, clubId, env) : null;

        // Insert as PENDING (not auto-approved like admin)
        var paymentId = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO membership_dues_payments (fk_membership_dues_id, fk_member_fee_id, fk_member_profile_id,
                FeeType, Amount, IsPaid, IsOnline, PaymentStatus, OfflineStatus,
                OfflineTransactionType, OfflineTransactionId, OfflineGivenTo, OfflineBankName, OfflineChequeNumber,
                Attachment, OfflineRemark, PaymentDate,
                created_date)
            VALUES (@DuesId, @FeeId, @MemberId,
                @FeeType, @Amount, 0, 0, 'PendingApproval', 'Pending',
                @TransType, @TransId, @GivenTo, @BankName, @ChequeNo,
                @Attach, @Remark, @PayDate,
                NOW());
            SELECT LAST_INSERT_ID();",
            new
            {
                DuesId = duesId, FeeId = memberFeeId, MemberId = dto.FkMemberProfileId,
                dto.FeeType, Amount = amount,
                TransType = dto.TransactionType ?? "", TransId = dto.TransactionId ?? "",
                GivenTo = dto.GivenTo ?? "", BankName = dto.BankName ?? "", ChequeNo = dto.ChequeNumber ?? "",
                Attach = attachPath ?? "", Remark = dto.Remark ?? "",
                PayDate = dto.PaymentDate ?? DateTime.Now
            });

        // Send notification email synchronously (NOT Task.Run) — IIS/iisnode can recycle
        // the worker process the moment the response goes out, killing any fire-and-forget
        // task before it actually hits Brevo. User reported approval emails silently dropping
        // for public-submitted offline payments. 2026-06-14.
        try
        {
            var details = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
                SELECT m.MemberName, m.EmailId AS MemberEmail, md.Purpose, md.EmailCC, md.fk_club_id, md.RotaryYear,
                       md.Fees1Text, md.Fees2Text, md.Fees3Text,
                       d.DistrictNumber, c.ClubName
                FROM membership_dues_payments p
                JOIN membership_dues_member_fees f ON p.fk_member_fee_id = f.pk_id
                JOIN member_master_profile m ON p.fk_member_profile_id = m.pk_member_master_profile_id
                JOIN membership_dues md ON p.fk_membership_dues_id = md.pk_membership_dues_id
                LEFT JOIN district_master d ON md.fk_district_id = d.pk_district_id
                LEFT JOIN club_master c ON md.fk_club_id = c.pk_club_id
                WHERE p.pk_id=@Id", new { Id = paymentId });
            if (details == null)
            {
                _logger.LogWarning("Offline payment {Id}: lookup query returned null; cannot send notification emails.", paymentId);
            }
            if (details != null)
            {
                var feeLabel = dto.FeeType switch { 1 => (string?)details.Fees1Text ?? "Annual", 2 => (string?)details.Fees2Text ?? "Semi-Annual 1", 3 => (string?)details.Fees3Text ?? "Semi-Annual 2", _ => "Dues" };
                var memberEmail = (string?)details.MemberEmail;
                _logger.LogInformation("Offline payment {Id}: notification block reached; memberEmail='{Me}'.", paymentId, memberEmail ?? "(null)");

                // Approval recipients = Club President + Club Secretary for the rotary year
                // THIS dues record was created for. Match BY DESIGNATION NAME, not by id —
                // designation_master.pk_designation_id is NOT consistent across years for
                // the same role (e.g. President is id=1 for year 52 but id=41 for year 46
                // on club 2765). The year is resolved from membership_dues.RotaryYear
                // (VARCHAR like "2025-26") by matching rotary_year_master.YearLabel; if the
                // BOD has no matching row for that year, fall back to current year so
                // somebody is still notified. Per project rule 2026-06-14: only President +
                // Secretary, nothing else — no EmailCC, no Club Admins, no district admins.
                int duesClubId = details.fk_club_id != null ? (int)details.fk_club_id : 0;
                var duesYearLabel = (string?)details.RotaryYear;
                // Each recipient gets their own signed token so the audit log records
                // who actually clicked Approve / Reject (President vs Secretary).
                var adminRecipients = new List<(int memberId, string name, string email, string designation)>();
                if (duesClubId > 0)
                {
                    var bodRows = (await conn.QueryAsync<dynamic>(@"
                        SELECT m2.pk_member_master_profile_id AS MemberId,
                               m2.MemberName AS Name,
                               m2.EmailId    AS Email,
                               dm.designation_name AS Designation
                        FROM board_of_directors bod
                        JOIN member_master_profile m2 ON m2.pk_member_master_profile_id = bod.fk_member_master_profile_id
                        JOIN designation_master dm    ON dm.pk_designation_id = bod.fk_designation_id
                        JOIN rotary_year_master y     ON y.pk_year_id = bod.fk_year_id
                        WHERE bod.fk_club_id = @ClubId
                          AND dm.designation_name IN ('Club President', 'Club Secretary')
                          AND COALESCE(bod.isdeleted, 0) = 0
                          AND (
                              (@DuesYear IS NOT NULL AND @DuesYear <> '' AND y.YearLabel = @DuesYear)
                              OR ((@DuesYear IS NULL OR @DuesYear = '') AND y.IsCurrent = 1)
                          )
                          AND m2.isdeleted = 0
                          AND m2.EmailId IS NOT NULL AND m2.EmailId <> ''",
                        new { ClubId = duesClubId, DuesYear = duesYearLabel })).ToList();
                    if (bodRows.Count == 0 && !string.IsNullOrWhiteSpace(duesYearLabel))
                    {
                        bodRows = (await conn.QueryAsync<dynamic>(@"
                            SELECT m2.pk_member_master_profile_id AS MemberId,
                                   m2.MemberName AS Name,
                                   m2.EmailId    AS Email,
                                   dm.designation_name AS Designation
                            FROM board_of_directors bod
                            JOIN member_master_profile m2 ON m2.pk_member_master_profile_id = bod.fk_member_master_profile_id
                            JOIN designation_master dm    ON dm.pk_designation_id = bod.fk_designation_id
                            JOIN rotary_year_master y     ON y.pk_year_id = bod.fk_year_id
                            WHERE bod.fk_club_id = @ClubId
                              AND dm.designation_name IN ('Club President', 'Club Secretary')
                              AND COALESCE(bod.isdeleted, 0) = 0
                              AND y.IsCurrent = 1
                              AND m2.isdeleted = 0
                              AND m2.EmailId IS NOT NULL AND m2.EmailId <> ''",
                            new { ClubId = duesClubId })).ToList();
                        if (bodRows.Count > 0)
                            _logger.LogInformation("Offline payment {Id}: no BOD for dues year {Year}, fell back to current year ({Count} recipient(s)).", paymentId, duesYearLabel, bodRows.Count);
                    }
                    if (bodRows.Count == 0)
                    {
                        // Last resort: neither the dues year nor the "current" year
                        // (per rotary_year_master.IsCurrent) has a President/Secretary
                        // on file — common right at the July year rollover, when a
                        // club hasn't entered its new-year BOD yet and IsCurrent may
                        // already have flipped ahead of the club's own data entry.
                        // Find the single most recent year the club actually has
                        // President/Secretary data for (NOT every past year — that
                        // would email every former President/Secretary), then pull
                        // just that year's recipients.
                        var latestYearId = await conn.ExecuteScalarAsync<int?>(@"
                            SELECT MAX(bod.fk_year_id)
                            FROM board_of_directors bod
                            JOIN member_master_profile m2 ON m2.pk_member_master_profile_id = bod.fk_member_master_profile_id
                            JOIN designation_master dm    ON dm.pk_designation_id = bod.fk_designation_id
                            WHERE bod.fk_club_id = @ClubId
                              AND dm.designation_name IN ('Club President', 'Club Secretary')
                              AND COALESCE(bod.isdeleted, 0) = 0
                              AND m2.isdeleted = 0
                              AND m2.EmailId IS NOT NULL AND m2.EmailId <> ''",
                            new { ClubId = duesClubId });
                        if (latestYearId != null)
                        {
                            bodRows = (await conn.QueryAsync<dynamic>(@"
                                SELECT m2.pk_member_master_profile_id AS MemberId,
                                       m2.MemberName AS Name,
                                       m2.EmailId    AS Email,
                                       dm.designation_name AS Designation
                                FROM board_of_directors bod
                                JOIN member_master_profile m2 ON m2.pk_member_master_profile_id = bod.fk_member_master_profile_id
                                JOIN designation_master dm    ON dm.pk_designation_id = bod.fk_designation_id
                                WHERE bod.fk_club_id = @ClubId
                                  AND bod.fk_year_id = @YearId
                                  AND dm.designation_name IN ('Club President', 'Club Secretary')
                                  AND COALESCE(bod.isdeleted, 0) = 0
                                  AND m2.isdeleted = 0
                                  AND m2.EmailId IS NOT NULL AND m2.EmailId <> ''",
                                new { ClubId = duesClubId, YearId = latestYearId })).ToList();
                        }
                        if (bodRows.Count > 0)
                            _logger.LogInformation("Offline payment {Id}: no BOD for dues year {Year} or current year, fell back to most recent year on file ({Count} recipient(s)).", paymentId, duesYearLabel, bodRows.Count);
                    }
                    foreach (var r in bodRows)
                        adminRecipients.Add(((int)r.MemberId, (string)r.Name, (string)r.Email, (string)r.Designation));
                }

                var remarkRow = !string.IsNullOrWhiteSpace(dto.Remark)
                    ? $"<tr><td style='padding:8px;border:1px solid #ddd;font-weight:bold;vertical-align:top;'>Remark</td><td style='padding:8px;border:1px solid #ddd;white-space:pre-wrap;'>{System.Net.WebUtility.HtmlEncode(dto.Remark.Trim())}</td></tr>"
                    : "";

                var emailTable = $@"<table style='width:100%;border-collapse:collapse;margin:20px 0;'>
                    <tr><td style='padding:8px;border:1px solid #ddd;font-weight:bold;'>Member Name</td><td style='padding:8px;border:1px solid #ddd;'>{(string?)details.MemberName}</td></tr>
                    <tr><td style='padding:8px;border:1px solid #ddd;font-weight:bold;'>District Number</td><td style='padding:8px;border:1px solid #ddd;'>{(string?)details.DistrictNumber ?? "-"}</td></tr>
                    <tr><td style='padding:8px;border:1px solid #ddd;font-weight:bold;'>Club Name</td><td style='padding:8px;border:1px solid #ddd;'>{(string?)details.ClubName ?? "-"}</td></tr>
                    <tr><td style='padding:8px;border:1px solid #ddd;font-weight:bold;'>Purpose</td><td style='padding:8px;border:1px solid #ddd;'>{(string?)details.Purpose}</td></tr>
                    <tr><td style='padding:8px;border:1px solid #ddd;font-weight:bold;'>Fee Type</td><td style='padding:8px;border:1px solid #ddd;'>{feeLabel}</td></tr>
                    <tr><td style='padding:8px;border:1px solid #ddd;font-weight:bold;'>Amount</td><td style='padding:8px;border:1px solid #ddd;'>₹{amount}/-</td></tr>
                    <tr><td style='padding:8px;border:1px solid #ddd;font-weight:bold;'>Payment Mode</td><td style='padding:8px;border:1px solid #ddd;'>{dto.TransactionType}</td></tr>
                    {remarkRow}
                    <tr><td style='padding:8px;border:1px solid #ddd;font-weight:bold;'>Status</td><td style='padding:8px;border:1px solid #ddd;color:#d69e2e;font-weight:bold;'>Pending Approval</td></tr>
                </table>";

                // Personalised token per recipient so the audit log records which
                // BOD officer clicked Approve/Reject. Both buttons point at the same
                // public approval page — the page shows Approve + Reject and
                // collects the remark/reason. No login wall.
                var frontendBase = (_config["FrontendUrl"] ?? "").TrimEnd('/');
                var signingSecret = _config["JwtSettings:Secret"] ?? "";

                foreach (var rec in adminRecipients.GroupBy(r => r.email, StringComparer.OrdinalIgnoreCase)
                                                   .Select(g => g.First()))
                {
                    var token = MembershipDuesApprovalToken.Generate(paymentId, rec.memberId, signingSecret);
                    // Two URLs, same token + page. The ?action= query param tells the
                    // public page which path to show (Approve confirmation vs Reject
                    // form with required remark). No login required — token is auth.
                    var approveUrl = $"{frontendBase}/dues-approval/{token}?action=approve";
                    var rejectUrl  = $"{frontendBase}/dues-approval/{token}?action=reject";
                    var greeting = string.IsNullOrWhiteSpace(rec.name) ? "Hello," : $"Dear {rec.name},";
                    var roleLine = string.IsNullOrWhiteSpace(rec.designation)
                        ? ""
                        : $"<p style='color:#666; font-size:13px;'>You're receiving this as the <strong>{rec.designation}</strong> of {(string?)details.ClubName}.</p>";

                    var adminBody = $@"{EmailService.EMAIL_HEADER}
                        <h2 style='color: #1a365d; margin-top: 0;'>New Offline Payment - Pending Approval</h2>
                        <p>{greeting}</p>
                        {roleLine}
                        <p>A member has submitted an offline payment that needs your approval:</p>
                        {emailTable}
                        <div style='text-align:center; margin:28px 0;'>
                            <a href='{approveUrl}' style='background-color:#16a34a; color:white; padding:12px 28px; text-decoration:none; border-radius:6px; font-weight:bold; display:inline-block; margin:0 6px;'>Approve</a>
                            <a href='{rejectUrl}' style='background-color:#dc2626; color:white; padding:12px 28px; text-decoration:none; border-radius:6px; font-weight:bold; display:inline-block; margin:0 6px;'>Reject</a>
                        </div>
                        <p style='color:#666; font-size:12px; text-align:center;'>
                            One click — no login required. Rejecting needs a reason on the next screen.<br/>
                            This link is personalised to you and expires in 7 days.
                        </p>
                        <p>Thank you,<br/>ROW</p>
                    {EmailService.EMAIL_FOOTER}";

                    try { await _emailService.SendGenericEmailAsync(rec.email, "Club Dues - New Offline Payment Pending Approval", adminBody); }
                    catch (Exception ex) { _logger.LogError(ex, "Offline payment {Id}: admin email to {Email} failed.", paymentId, rec.email); }
                }

                if (!string.IsNullOrWhiteSpace(memberEmail))
                {
                    var memberBody = $@"{EmailService.EMAIL_HEADER}
                        <h2 style='color: #1a365d; margin-top: 0;'>Offline Payment Submitted</h2>
                        <p>Dear {(string?)details.MemberName},</p>
                        <p>Your offline payment has been submitted and is pending approval.</p>
                        {emailTable}
                        <p>You will receive an email once your payment is approved or rejected.</p>
                        <p>Thank you,<br/>ROW</p>
                    {EmailService.EMAIL_FOOTER}";
                    try { await _emailService.SendGenericEmailAsync(memberEmail, "Club Dues - Payment Submitted for Approval", memberBody); }
                    catch (Exception ex) { _logger.LogError(ex, "Offline payment {Id}: member confirmation email to {Email} failed.", paymentId, memberEmail); }
                }

                if (adminRecipients.Count == 0)
                    _logger.LogWarning("Offline payment {Id}: no Club President/Secretary found on BOD for club {ClubId} in the current rotary year. Only the member was notified.", paymentId, duesClubId);
            }
        }
        catch (Exception ex) { _logger.LogError(ex, "Failed to send offline payment notification for payment {Id}", paymentId); }

        return paymentId;
    }

    public async Task ApproveRejectPaymentAsync(int paymentId, ApproveDuesPaymentDto dto, int userId)
    {
        using var conn = GetConnection();

        // Resolve the actual payment row. The frontend may pass either the
        // payment id OR the member-fee id; we accept both. We also accept
        // payments that are already Approved/Rejected so the caller gets a
        // clear "already handled" response instead of a 500 — supports
        // idempotent clicks from the email and double-click from the UI.
        var paymentRow = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT pk_id, OfflineStatus FROM membership_dues_payments WHERE pk_id=@Id AND isdeleted=0",
            new { Id = paymentId });
        if (paymentRow == null)
        {
            // Try as memberFeeId — find the most recent payment (any status)
            paymentRow = await conn.QueryFirstOrDefaultAsync<dynamic>(
                "SELECT pk_id, OfflineStatus FROM membership_dues_payments WHERE fk_member_fee_id=@FeeId AND isdeleted=0 ORDER BY created_date DESC LIMIT 1",
                new { FeeId = paymentId });
            if (paymentRow == null)
                throw new KeyNotFoundException("No payment found for the supplied id.");
            paymentId = (int)paymentRow.pk_id;
        }
        var currentStatus = ((string?)paymentRow.OfflineStatus ?? "").Trim();

        // Idempotent short-circuit — surface a clear, non-error message.
        if (string.Equals(currentStatus, "Approved", StringComparison.OrdinalIgnoreCase))
            throw new AlreadyHandledException(dto.IsApproved
                ? "Payment is already approved."
                : "Payment is already approved and cannot now be rejected.");
        if (string.Equals(currentStatus, "Rejected", StringComparison.OrdinalIgnoreCase))
            throw new AlreadyHandledException(dto.IsApproved
                ? "Payment is already rejected and cannot now be approved."
                : "Payment is already rejected.");

        if (!dto.IsApproved && string.IsNullOrWhiteSpace(dto.RejectionReason))
            throw new ArgumentException("Rejection reason is required when rejecting a payment.");

        if (dto.IsApproved)
        {
            // ApprovalSource defaults to 'admin-portal' for in-portal admin clicks; the
            // public dues-approval controller overrides this overload via a separate
            // entry point that passes 'email-link'.
            await conn.ExecuteAsync(@"
                UPDATE membership_dues_payments SET
                    IsPaid=1, PaymentStatus='Approved', OfflineStatus='Approved',
                    ApprovedBy=@UserId, ApprovedDate=NOW(), ApprovalRemark=@Remark,
                    ApprovalSource='admin-portal',
                    modified_by=@UserId, modified_date=NOW()
                WHERE pk_id=@Id",
                new {
                    Id = paymentId,
                    UserId = userId,
                    Remark = string.IsNullOrWhiteSpace(dto.ApprovalRemark) ? null : dto.ApprovalRemark.Trim()
                });

            // Send receipt email synchronously (NOT Task.Run) — IIS/iisnode can
            // recycle the worker process the moment the response goes out,
            // killing any fire-and-forget task before it actually hits Brevo.
            // Same root cause already fixed for the pending-approval email in
            // RecordPublicOfflinePaymentAsync (2026-06-14).
            try { await SendReceiptEmailAsync(paymentId); }
            catch (Exception ex) { _logger.LogError(ex, "Failed to send receipt email for payment {Id}", paymentId); }

            // Append to Google Sheet (fire-and-forget)
            _ = Task.Run(async () =>
            {
                try { await SyncGoogleSheetAsync(paymentId); }
                catch (Exception ex) { _logger.LogError(ex, "Failed to append to Google Sheet for payment {Id}", paymentId); }
            });
        }
        else
        {
            await conn.ExecuteAsync(@"
                UPDATE membership_dues_payments SET
                    PaymentStatus='Rejected', OfflineStatus='Rejected',
                    RejectedBy=@UserId, RejectedDate=NOW(), RejectionReason=@Reason,
                    RejectionSource='admin-portal',
                    modified_by=@UserId, modified_date=NOW()
                WHERE pk_id=@Id",
                new { Id = paymentId, UserId = userId, Reason = dto.RejectionReason });

            // Send rejection email synchronously (NOT Task.Run) — same IIS-recycle
            // risk as the approve branch above.
            try
            {
                var payment = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
                    SELECT p.FeeType, p.Amount, m.MemberName, m.EmailId,
                           md.Purpose, md.Fees1Text, md.Fees2Text, md.Fees3Text,
                           d.DistrictNumber, c.ClubName
                    FROM membership_dues_payments p
                    JOIN membership_dues_member_fees f ON p.fk_member_fee_id = f.pk_id
                    JOIN member_master_profile m ON p.fk_member_profile_id = m.pk_member_master_profile_id
                    JOIN membership_dues md ON p.fk_membership_dues_id = md.pk_membership_dues_id
                    LEFT JOIN district_master d ON md.fk_district_id = d.pk_district_id
                    LEFT JOIN club_master c ON md.fk_club_id = c.pk_club_id
                    WHERE p.pk_id=@Id", new { Id = paymentId });
                if (payment != null && !string.IsNullOrWhiteSpace((string?)payment.EmailId))
                {
                    var feeLabel = (int)payment.FeeType switch
                    {
                        1 => (string?)payment.Fees1Text ?? "Annual",
                        2 => (string?)payment.Fees2Text ?? "Semi-Annual 1",
                        3 => (string?)payment.Fees3Text ?? "Semi-Annual 2",
                        _ => "Dues"
                    };
                    var reasonText = string.IsNullOrWhiteSpace(dto.RejectionReason) ? "No reason provided." : dto.RejectionReason;

                    var body = $@"{EmailService.EMAIL_HEADER}
                        <h2 style='color: #c53030; margin-top: 0;'>Payment Rejected</h2>
                        <p>Dear {(string?)payment.MemberName},</p>
                        <p>Your offline payment has been rejected. Please see the details below:</p>
                        <table style='width:100%;border-collapse:collapse;margin:20px 0;'>
                            <tr><td style='padding:8px;border:1px solid #ddd;font-weight:bold;'>District Number</td><td style='padding:8px;border:1px solid #ddd;'>{(string?)payment.DistrictNumber ?? "-"}</td></tr>
                            <tr><td style='padding:8px;border:1px solid #ddd;font-weight:bold;'>Club Name</td><td style='padding:8px;border:1px solid #ddd;'>{(string?)payment.ClubName ?? "-"}</td></tr>
                            <tr><td style='padding:8px;border:1px solid #ddd;font-weight:bold;'>Purpose</td><td style='padding:8px;border:1px solid #ddd;'>{(string?)payment.Purpose}</td></tr>
                            <tr><td style='padding:8px;border:1px solid #ddd;font-weight:bold;'>Fee Type</td><td style='padding:8px;border:1px solid #ddd;'>{feeLabel}</td></tr>
                            <tr><td style='padding:8px;border:1px solid #ddd;font-weight:bold;'>Amount</td><td style='padding:8px;border:1px solid #ddd;'>₹{payment.Amount}/-</td></tr>
                            <tr><td style='padding:8px;border:1px solid #ddd;font-weight:bold;'>Status</td><td style='padding:8px;border:1px solid #ddd;color:#c53030;font-weight:bold;'>Rejected</td></tr>
                            <tr><td style='padding:8px;border:1px solid #ddd;font-weight:bold;'>Reason</td><td style='padding:8px;border:1px solid #ddd;'>{reasonText}</td></tr>
                        </table>
                        <p>You can resubmit your payment. Please contact your club admin for more details.</p>
                        <p>Thank you,<br/>ROW</p>
                    {EmailService.EMAIL_FOOTER}";

                    await _emailService.SendGenericEmailAsync((string)payment.EmailId, "Club Dues - Payment Rejected", body);
                }
            }
            catch (Exception ex) { _logger.LogError(ex, "Failed to send rejection email for payment {Id}", paymentId); }
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  RECEIPTS & REMINDERS
    // ═══════════════════════════════════════════════════════════════

    // Resolve the header logo URL for receipt / reminder emails.
    // Order of precedence:
    //   1. If dues has an uploaded EmailHeaderLogo (full URL or relative path),
    //      use that (so each club's custom brand shows in their emails).
    //   2. Otherwise fall back to the shared white ROW logo.
    // Kept as a private helper because the same rule is used by the receipt
    // email AND by both reminder emails (individual + bulk).
    private static string DEFAULT_HEADER_LOGO_URL => Brand.EmailLogoUrl;
    private static string ResolveEmailHeaderLogoUrl(string? uploadedPath)
    {
        if (string.IsNullOrWhiteSpace(uploadedPath)) return DEFAULT_HEADER_LOGO_URL;
        return (uploadedPath!.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
                uploadedPath!.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            ? uploadedPath!
            : $"{Brand.PortalOrigin}/{uploadedPath!.TrimStart('/')}";
    }

    // The club's own logo (club_master.ClubLogoPath) takes priority over the
    // dues-specific EmailHeaderLogo — members expect to see their own club's
    // branding on a dues email, not a generic per-campaign upload. Falls back
    // to the dues logo, then to the shared ROW logo, via the same
    // resolver so relative/absolute paths are handled identically.
    private static string ResolveEmailLogoUrl(string? clubLogoPath, string? duesHeaderLogo)
        => ResolveEmailHeaderLogoUrl(!string.IsNullOrWhiteSpace(clubLogoPath) ? clubLogoPath : duesHeaderLogo);

    // Header + footer HTML for receipt / reminder emails. Keeps the header
    // markup identical across all three so the branding stays consistent.
    // Includes a viewport meta tag + responsive rules — without them, mobile
    // mail clients render the fixed 620px layout at desktop scale and force
    // the user to pinch-zoom / horizontal-scroll the whole email.
    private static string BuildBrandedEmailHeader(string logoUrl) => $@"
            <html>
            <head>
                <meta charset='utf-8' />
                <meta name='viewport' content='width=device-width, initial-scale=1.0' />
                <style>
                    img {{ max-width: 100%; height: auto; }}
                    @media only screen and (max-width: 480px) {{
                        .rz-email-body {{ padding: 16px !important; }}
                        table.rz-email-table th, table.rz-email-table td {{ padding: 6px !important; font-size: 13px !important; }}
                    }}
                </style>
            </head>
            <body style='font-family: Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f5f5f5; margin: 0; padding: 0;'>
                <div style='max-width: 620px; width: 100%; margin: 0 auto; box-sizing: border-box;'>
                    <div style='background-color: #1a365d; padding: 16px 24px; text-align: center; border-radius: 8px 8px 0 0;'>
                        <img src='{logoUrl}' alt='ROW' style='height: 77px; max-width: 100%;' />
                    </div>
                    <div class='rz-email-body' style='background-color: #ffffff; padding: 28px 32px; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; box-sizing: border-box;'>";

    private const string BRANDED_EMAIL_FOOTER = @"
                    </div>
                    <div style='background-color: #f8f9fa; border: 1px solid #e2e8f0; border-top: none; padding: 16px 24px; text-align: center; border-radius: 0 0 8px 8px;'>
                        <p style='font-size: 12px; color: #666; margin: 0; font-style: italic;'>This is generated by <strong>ROW</strong></p>
                    </div>
                </div>
            </body>
            </html>";

    // Fee-id-based send. Resolves the latest PAID payment for the given
    // membership_dues_member_fees.pk_id, then dispatches the receipt through
    // the strict payment-id path below. Introduced 2026-07-08 to close the
    // pk_id-collision misroute: memberFeeId and payment.pk_id both come from
    // AUTO_INCREMENT counters on separate tables, so a fee id could numerically
    // match an unrelated member's payment id. Any UI that has a memberFeeId
    // (e.g. the "Send Receipt" button on the members list) MUST call this
    // method rather than passing the fee id into SendReceiptEmailAsync.
    public async Task SendReceiptEmailByFeeIdAsync(int memberFeeId)
    {
        using (var conn = GetConnection())
        {
            var feeExists = await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM membership_dues_member_fees WHERE pk_id=@Id AND isdeleted=0",
                new { Id = memberFeeId });
            if (feeExists == 0)
                throw new KeyNotFoundException($"Member fee row {memberFeeId} not found.");

            var paidPaymentId = await conn.ExecuteScalarAsync<int?>(
                @"SELECT pk_id FROM membership_dues_payments
                  WHERE fk_member_fee_id=@FeeId AND IsPaid=1 AND isdeleted=0
                  ORDER BY PaymentDate DESC, pk_id DESC LIMIT 1",
                new { FeeId = memberFeeId });
            if (!paidPaymentId.HasValue)
                throw new KeyNotFoundException("No paid payment found for this member — receipt cannot be sent.");

            await SendReceiptEmailAsync(paidPaymentId.Value);
        }
    }

    public async Task SendReceiptEmailAsync(int paymentId)
    {
        using var conn = GetConnection();

        // Strict payment-id resolution. The old dual-use fallback ("if the id
        // doesn't match a payment row, try it as a memberFeeId") was removed
        // 2026-07-08 after a widespread misroute bug: memberFeeId and payment
        // pk_id share the same integer space but come from different tables,
        // so a fee id (like 6770 for Kalpesh) could NUMERICALLY collide with
        // an unrelated member's payment id (6770 was Dilip's payment) →
        // receipt went to Dilip. Callers who have a memberFeeId must now call
        // SendReceiptEmailByFeeIdAsync instead of stuffing the fee id into
        // this method.
        var isActualPayment = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM membership_dues_payments WHERE pk_id=@Id AND isdeleted=0", new { Id = paymentId });
        if (isActualPayment == 0)
            throw new KeyNotFoundException($"Payment row {paymentId} not found — receipt cannot be sent.");

        // Note: no duplicate check — manual resend is allowed

        // LEFT JOIN everything so an orphaned reference (deleted member,
        // deleted fee allocation, etc.) doesn't silently nuke the whole
        // query. We then check each essential piece below and throw a
        // message that actually names what's missing.
        var payment = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT p.*, f.CategoryType, f.AnnualAmount AS FeeAnnualAmount, f.Semi1Amount AS FeeSemi1Amount, f.Semi2Amount AS FeeSemi2Amount,
                   f.fk_member_profile_id AS FeeMemberId,
                   m.MemberName, m.EmailId, m.PrimaryMobileNumber,
                   mf.MemberName AS FeeMemberName, mf.EmailId AS FeeMemberEmail,
                   md.fk_club_id AS ClubId, md.pk_membership_dues_id AS DuesId,
                   md.Purpose, md.EmailSubject, md.EmailBody, md.EmailCC, md.EmailHeaderLogo, md.IsShowBankInReceipt,
                   md.OfflineBankName, md.OfflineAccountNumber, md.OfflineIfscCode,
                   md.Fees1Text, md.Fees2Text, md.Fees3Text, md.OnlineSurchargePercent,
                   d.DistrictNumber, c.ClubName,
                   CASE
                       WHEN c.ClubLogoPath IS NULL OR c.ClubLogoPath = '' THEN NULL
                       WHEN c.ClubLogoPath LIKE '/%' THEN c.ClubLogoPath
                       ELSE CONCAT('/uploads/club/', c.ClubLogoPath)
                   END AS ClubLogoPath
            FROM membership_dues_payments p
            LEFT JOIN membership_dues_member_fees f ON p.fk_member_fee_id = f.pk_id
            LEFT JOIN member_master_profile m ON p.fk_member_profile_id = m.pk_member_master_profile_id
            LEFT JOIN member_master_profile mf ON f.fk_member_profile_id = mf.pk_member_master_profile_id
            LEFT JOIN membership_dues md ON p.fk_membership_dues_id = md.pk_membership_dues_id
            LEFT JOIN district_master d ON md.fk_district_id = d.pk_district_id
            LEFT JOIN club_master c ON md.fk_club_id = c.pk_club_id
            WHERE p.pk_id=@Id", new { Id = paymentId });
        if (payment == null)
            throw new KeyNotFoundException($"Payment row {paymentId} not found.");
        if (payment.DuesId == null)
            throw new InvalidOperationException("Club dues record for this payment is missing or deleted.");

        // Member name/email come from the LEFT JOIN. If they're blank the FK on
        // the payment row may point at a missing/blank-named profile (e.g. from
        // an import). Fall back paths, in order:
        //   1. Direct SELECT on member_master_profile by FK (catches the
        //      column-blank case + soft-deleted profile that the JOIN already
        //      returned anyway).
        //   2. JOIN through club_members for the dues' club to find an active
        //      profile that still belongs to that club — covers cases where the
        //      payment's stored fk_member_profile_id was reassigned/merged.
        //   3. If we still have no NAME but DO have an email, use "Rotarian"
        //      as a placeholder name so the receipt still goes out.
        //   4. If we still have no EMAIL, fail with a clear message — we can't
        //      send a receipt without a recipient.
        var memberName = (string?)payment.MemberName;
        var memberEmail = (string?)payment.EmailId;
        int fkMember = Convert.ToInt32(payment.fk_member_profile_id ?? 0);
        if (string.IsNullOrWhiteSpace(memberName) || string.IsNullOrWhiteSpace(memberEmail))
        {
            if (fkMember > 0)
            {
                var profile = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
                    SELECT MemberName, EmailId, PrimaryMobileNumber, isdeleted
                    FROM member_master_profile
                    WHERE pk_member_master_profile_id = @Id",
                    new { Id = fkMember });
                if (profile != null)
                {
                    memberName = (string?)profile.MemberName ?? memberName;
                    memberEmail = (string?)profile.EmailId ?? memberEmail;
                }
            }
        }
        // Last-ditch lookup: any active club_members row pointing at the same
        // FK — sometimes the profile was renumbered post-import and the new
        // row carries the name/email.
        if ((string.IsNullOrWhiteSpace(memberName) || string.IsNullOrWhiteSpace(memberEmail)) && fkMember > 0)
        {
            var viaClubMembers = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
                SELECT m.MemberName, m.EmailId
                FROM club_members cm
                JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                WHERE cm.fk_member_master_profile_id = @Id AND COALESCE(cm.isdeleted, 0) = 0
                LIMIT 1",
                new { Id = fkMember });
            if (viaClubMembers != null)
            {
                memberName = string.IsNullOrWhiteSpace(memberName) ? (string?)viaClubMembers.MemberName : memberName;
                memberEmail = string.IsNullOrWhiteSpace(memberEmail) ? (string?)viaClubMembers.EmailId : memberEmail;
            }
        }

        // FINAL fallback: payment.fk_member_profile_id can be stale (e.g. points
        // at a member that was hard-deleted in an old cleanup), while the FEE
        // row's fk_member_profile_id is still correct (because that's what the
        // members page reads to render the row). Try the FEE's FK as a last
        // resort. FeeMemberName/Email are populated by the LEFT JOIN above on
        // `mf` (member_master_profile via f.fk_member_profile_id).
        if (string.IsNullOrWhiteSpace(memberName))
        {
            var feeMemberName = (string?)payment.FeeMemberName;
            if (!string.IsNullOrWhiteSpace(feeMemberName))
            {
                memberName = feeMemberName;
                int feeMemberId = Convert.ToInt32(payment.FeeMemberId ?? 0);
                _logger.LogWarning(
                    "Payment {Pid}: payment.fk_member_profile_id={StaleFk} is orphaned; falling back to fee.fk_member_profile_id={GoodFk} for the receipt recipient.",
                    paymentId, fkMember, feeMemberId);
            }
        }
        if (string.IsNullOrWhiteSpace(memberEmail))
        {
            var feeMemberEmail = (string?)payment.FeeMemberEmail;
            if (!string.IsNullOrWhiteSpace(feeMemberEmail))
                memberEmail = feeMemberEmail;
        }

        // Email is mandatory — we can't send a receipt to no-one.
        if (string.IsNullOrWhiteSpace(memberEmail))
        {
            _logger.LogWarning(
                "Receipt skipped: no email on file for payment {Pid} (fk_member_profile_id={Fk}). Name resolved to '{Name}'.",
                paymentId, fkMember, memberName ?? "(blank)");
            throw new InvalidOperationException(
                $"Cannot send receipt — no email on file for this member. (payment={paymentId}, fk_member_profile_id={fkMember}). " +
                "Please add an email to the member profile and try again.");
        }

        // Name is a nice-to-have. If it's still blank, use a generic salutation
        // so the receipt still goes out — the body has all the payment details.
        if (string.IsNullOrWhiteSpace(memberName))
        {
            _logger.LogWarning(
                "Payment {Pid}: member profile (fk_member_profile_id={Fk}) has blank MemberName; using 'Rotarian' as fallback.",
                paymentId, fkMember);
            memberName = "Rotarian";
        }

        var fees1Text = (string?)payment.Fees1Text;
        var fees2Text = (string?)payment.Fees2Text;
        var fees3Text = (string?)payment.Fees3Text;
        string FeeTypeLabel(int t) => t switch
        {
            1 => fees1Text ?? "Annual",
            2 => fees2Text ?? "Semi-Annual 1",
            3 => fees3Text ?? "Semi-Annual 2",
            _ => "Dues"
        };

        // Per-fee receipt table (added 2026-07-08 per user request):
        //   Sr No | Fee Type | Amount | Mode | Payment Gateway Charges | Transaction ID
        // Show one row per PAID payment for this member's fee.
        //   Annual paid          → 1 row (Annual)
        //   Semi 1 only paid     → 1 row (Semi 1)
        //   Semi 1 + Semi 2 paid → 2 rows (Semi 1 first, then Semi 2)
        // Rules:
        //   Offline row → Amount = payment.Amount (rounded to int, half-up).
        //                 Payment Gateway Charges = "N/A".
        //   Online row  → payment.Amount is the online (with-surcharge) figure;
        //                 back out the ONE true amount via the campaign's real
        //                 OnlineSurchargePercent (payment.Amount = base * (1 +
        //                 surcharge/100)), Gateway Charges = payment.Amount − base.
        //   Transaction ID → per-row: TransactionId if present, else OfflineTransactionId, else "-".
        decimal surchargePercent = (decimal)payment.OnlineSurchargePercent;
        var paidPayments = (await conn.QueryAsync<dynamic>(@"
            SELECT p.pk_id, p.FeeType, p.Amount, p.IsOnline, p.PaymentDate,
                   p.TransactionId, p.OfflineTransactionId, p.OfflineTransactionType
            FROM membership_dues_payments p
            WHERE p.fk_member_fee_id = @FeeId
              AND p.IsPaid = 1
              AND p.isdeleted = 0
            ORDER BY p.FeeType, p.PaymentDate, p.pk_id",
            new { FeeId = Convert.ToInt32(payment.fk_member_fee_id) })).ToList();

        var feesTable = new StringBuilder();
        feesTable.Append(@"<table class='rz-email-table' style='width:100%;border-collapse:collapse;margin:12px 0;border:1px solid #ddd;'>
            <thead><tr style='background:#f3f4f6;'>
                <th style='padding:8px;border:1px solid #ddd;text-align:left;'>Sr No</th>
                <th style='padding:8px;border:1px solid #ddd;text-align:left;'>Fee Type</th>
                <th style='padding:8px;border:1px solid #ddd;text-align:right;'>Amount</th>
                <th style='padding:8px;border:1px solid #ddd;text-align:left;'>Mode</th>
                <th style='padding:8px;border:1px solid #ddd;text-align:right;'>Payment Gateway Charges</th>
                <th style='padding:8px;border:1px solid #ddd;text-align:left;'>Payment Date</th>
                <th style='padding:8px;border:1px solid #ddd;text-align:left;'>Transaction ID</th>
            </tr></thead><tbody>");

        int sr = 0;
        foreach (var pp in paidPayments)
        {
            sr++;
            int ft = Convert.ToInt32(pp.FeeType);
            decimal total = Convert.ToDecimal(pp.Amount);
            bool ppIsOnline = Convert.ToBoolean(pp.IsOnline);

            string amountCell, gatewayCell;
            if (ppIsOnline)
            {
                decimal baseEquivalent = surchargePercent > 0 ? total / (1 + surchargePercent / 100m) : total;
                decimal gateway = Math.Round(total - baseEquivalent, 2, MidpointRounding.AwayFromZero);
                int netAmount = (int)Math.Round(total - gateway, 0, MidpointRounding.AwayFromZero);
                amountCell = $"₹{netAmount:N0}";
                gatewayCell = $"₹{gateway:N2}";
            }
            else
            {
                int netAmount = (int)Math.Round(total, 0, MidpointRounding.AwayFromZero);
                amountCell = $"₹{netAmount:N0}";
                gatewayCell = "N/A";
            }

            string txnId = (string?)pp.TransactionId ?? "";
            if (string.IsNullOrWhiteSpace(txnId))
                txnId = (string?)pp.OfflineTransactionId ?? "";
            if (string.IsNullOrWhiteSpace(txnId))
                txnId = "N/A";

            var payDate = ((DateTime?)pp.PaymentDate)?.ToString("dd-MMM-yyyy") ?? "-";

            feesTable.Append($@"<tr>
                <td style='padding:8px;border:1px solid #ddd;'>{sr}</td>
                <td style='padding:8px;border:1px solid #ddd;'>{System.Net.WebUtility.HtmlEncode(FeeTypeLabel(ft))}</td>
                <td style='padding:8px;border:1px solid #ddd;text-align:right;'>{amountCell}</td>
                <td style='padding:8px;border:1px solid #ddd;'>{(ppIsOnline ? "Online" : "Offline")}</td>
                <td style='padding:8px;border:1px solid #ddd;text-align:right;'>{gatewayCell}</td>
                <td style='padding:8px;border:1px solid #ddd;'>{payDate}</td>
                <td style='padding:8px;border:1px solid #ddd;'>{System.Net.WebUtility.HtmlEncode(txnId)}</td>
            </tr>");
        }
        feesTable.Append("</tbody></table>");

        // Top-level meta rows (kept above the fees table). Fee Type / Amount /
        // Method of Payment / Transaction ID were REMOVED — those live inside
        // the per-fee table now.
        var rows = new StringBuilder();
        void AddRow(string label, string? value)
        {
            if (!string.IsNullOrWhiteSpace(value))
                rows.Append($"<tr><td style='padding:8px;border:1px solid #ddd;font-weight:bold;'>{label}</td><td style='padding:8px;border:1px solid #ddd;'>{value}</td></tr>");
        }

        AddRow("Member Name", memberName);
        AddRow("District Number", (string?)payment.DistrictNumber);
        AddRow("Club Name", (string?)payment.ClubName);
        AddRow("Purpose", (string?)payment.Purpose);
        AddRow("Status", "Paid");
        AddRow("Date and Time", ((DateTime?)payment.PaymentDate)?.ToString("dd-MMM-yyyy hh:mm tt") ?? DateTime.Now.ToString("dd-MMM-yyyy hh:mm tt"));
        AddRow("Approver's Remark", (string?)payment.ApprovalRemark);

        var subject = (string?)payment.EmailSubject ?? "Club Dues - Payment Received";

        // Receipt-specific header + footer. Club's own logo (club_master.
        // ClubLogoPath) takes priority over the per-dues EmailHeaderLogo, else
        // falls back to the shared ROW brand logo. Kept separate from the
        // shared EmailService.EMAIL_HEADER/EMAIL_FOOTER so OTPs / other system
        // emails are NOT affected by the rename to "ROW"
        // and the logo change here.
        var logoUrl = ResolveEmailLogoUrl((string?)payment.ClubLogoPath, (string?)payment.EmailHeaderLogo);

        // Includes a viewport meta tag + responsive rules — same fix applied
        // to BuildBrandedEmailHeader (reminder emails); without it, mobile
        // mail clients render this fixed 620px layout at desktop scale.
        var receiptHeader = $@"
            <html>
            <head>
                <meta charset='utf-8' />
                <meta name='viewport' content='width=device-width, initial-scale=1.0' />
                <style>
                    img {{ max-width: 100%; height: auto; }}
                    @media only screen and (max-width: 480px) {{
                        .rz-email-body {{ padding: 16px !important; }}
                        table.rz-email-table th, table.rz-email-table td {{ padding: 6px !important; font-size: 12px !important; }}
                    }}
                </style>
            </head>
            <body style='font-family: Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f5f5f5; margin: 0; padding: 0;'>
                <div style='max-width: 620px; width: 100%; margin: 0 auto; box-sizing: border-box;'>
                    <div style='background-color: #1a365d; padding: 16px 24px; text-align: center; border-radius: 8px 8px 0 0;'>
                        <img src='{logoUrl}' alt='ROW' style='height: 77px; max-width: 100%;' />
                    </div>
                    <div class='rz-email-body' style='background-color: #ffffff; padding: 28px 32px; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; box-sizing: border-box;'>";

        const string receiptFooter = @"
                    </div>
                    <div style='background-color: #f8f9fa; border: 1px solid #e2e8f0; border-top: none; padding: 16px 24px; text-align: center; border-radius: 0 0 8px 8px;'>
                        <p style='font-size: 12px; color: #666; margin: 0; font-style: italic;'>This is generated by <strong>ROW</strong></p>
                    </div>
                </div>
            </body>
            </html>";

        var body = $@"{receiptHeader}
            <h2 style='color: #1a365d; margin-top: 0;'>Payment Receipt</h2>
            <p>Dear {memberName},</p>
            <p>Thank you for your payment. Here are the details:</p>
            <table style='width:100%;border-collapse:collapse;margin:20px 0;'>
                {rows}
            </table>
            <h3 style='color:#1a365d;margin:16px 0 6px;'>Fees</h3>
            <div style='overflow-x:auto;'>{feesTable}</div>
            {((string?)payment.EmailBody ?? "")}
        {receiptFooter}";

        // Single Brevo call: member as TO, EmailCC (from membership_dues.EmailCC)
        // as a real Cc: header on the SAME email. If EmailCC is null/blank, only
        // the member receives it — no side deliveries. Fixed 2026-07-08 (was
        // sending N separate TO emails per CC address).
        var cc = (string?)payment.EmailCC;
        await _emailService.SendGenericEmailWithCcAsync(memberEmail!, cc, subject, body);

        // Mark receipt as sent
        await conn.ExecuteAsync("UPDATE membership_dues_payments SET IsReceiptSent=1 WHERE pk_id=@Id", new { Id = paymentId });

        // Club Dues emails are free — no credit deduction
    }

    // Reminder calendar window (re-added 2026-08-14 per club-dues rule):
    //   Annual (1) + Semi 1 (2)  → remindable all rotary year (Jul–Jun)
    //   Semi 2 (3)               → remindable ONLY Jan–Jun (months 1-6); blocked Jul–Dec (7-12)
    // So a Semi 2 reminder never goes out before January; Semi 1 stays remindable after Jan
    // (overdue). currentMonth comes from the DB's MONTH(NOW()) so it matches server time.
    private static bool IsFeeTypeRemindable(int feeType, int currentMonth)
        => feeType != 3 || (currentMonth >= 1 && currentMonth <= 6);

    public async Task SendReminderEmailAsync(int memberFeeId, int feeType, string? remark)
    {
        using var conn = GetConnection();
        var data = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT f.pk_id, f.fk_member_profile_id, f.AnnualAmount, f.Semi1Amount, f.Semi2Amount,
                   m.MemberName, m.EmailId,
                   md.pk_membership_dues_id AS DuesId, md.fk_club_id AS ClubId, md.Purpose, md.RotaryYear,
                   md.EmailReminderSubject, md.EmailReminderBody, md.EmailCC, md.EmailHeaderLogo,
                   md.OfflineBankName, md.OfflineAccountNumber, md.OfflineIfscCode, md.IsShowBankInReceipt,
                   md.Fees1Text, md.Fees2Text, md.Fees3Text,
                   md.IsFees1, md.IsFees2, md.IsFees3,
                   d.DistrictNumber, c.ClubName,
                   CASE
                       WHEN c.ClubLogoPath IS NULL OR c.ClubLogoPath = '' THEN NULL
                       WHEN c.ClubLogoPath LIKE '/%' THEN c.ClubLogoPath
                       ELSE CONCAT('/uploads/club/', c.ClubLogoPath)
                   END AS ClubLogoPath
            FROM membership_dues_member_fees f
            JOIN member_master_profile m ON f.fk_member_profile_id = m.pk_member_master_profile_id
            JOIN membership_dues md ON f.fk_membership_dues_id = md.pk_membership_dues_id
            JOIN club_members cm ON cm.fk_member_master_profile_id = f.fk_member_profile_id
                AND cm.fk_club_id = md.fk_club_id
                AND cm.IsActive = 1
                AND COALESCE(cm.isdeleted, 0) = 0
                AND COALESCE(cm.IsHonoraryMember, 0) = 0
            LEFT JOIN district_master d ON md.fk_district_id = d.pk_district_id
            LEFT JOIN club_master c ON md.fk_club_id = c.pk_club_id
            WHERE f.pk_id=@Id AND f.isdeleted=0", new { Id = memberFeeId });
        // data == null also covers an honorary member's fee row (the club_members join above
        // excludes them) — same defense-in-depth as the payment endpoint, in case a stale link
        // or a future caller ever reaches here without going through the (already-filtered)
        // admin member list first.
        if (data == null || string.IsNullOrWhiteSpace((string?)data.EmailId)) return;

        // Determine which fee types to send reminder for
        var feeTypes = new List<int>();
        if (feeType > 0) { feeTypes.Add(feeType); }
        else
        {
            // feeType=0 means all unpaid fees
            if (Convert.ToBoolean(data.IsFees1)) feeTypes.Add(1);
            if (Convert.ToBoolean(data.IsFees2)) feeTypes.Add(2);
            if (Convert.ToBoolean(data.IsFees3)) feeTypes.Add(3);
        }

        // Check N/A logic: Annual paid → skip all, Semi1 paid → skip Annual
        var annualPaidCheck = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM membership_dues_payments WHERE fk_member_fee_id=@FeeId AND FeeType=1 AND IsPaid=1 AND isdeleted=0",
            new { FeeId = memberFeeId });
        if (annualPaidCheck > 0) return; // Annual paid — nothing to remind

        var semi1PaidCheck = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM membership_dues_payments WHERE fk_member_fee_id=@FeeId AND FeeType=2 AND IsPaid=1 AND isdeleted=0",
            new { FeeId = memberFeeId });

        int curMonth = await conn.ExecuteScalarAsync<int>("SELECT MONTH(NOW())");
        var unpaidRows = new System.Text.StringBuilder();
        foreach (var ft in feeTypes)
        {
            // N/A checks: if Semi1 paid, Annual is N/A
            if (ft == 1 && semi1PaidCheck > 0) continue;

            var isPaid = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM membership_dues_payments
                WHERE fk_member_fee_id=@FeeId AND FeeType=@FeeType AND IsPaid=1 AND isdeleted=0",
                new { FeeId = memberFeeId, FeeType = ft });
            if (isPaid > 0) continue;
            // Calendar-window gate: Semi 2 only Jan–Jun (see IsFeeTypeRemindable).
            if (!IsFeeTypeRemindable(ft, curMonth)) continue;

            var label = ft switch { 1 => (string?)data.Fees1Text ?? "Annual", 2 => (string?)data.Fees2Text ?? "Semi-Annual 1", 3 => (string?)data.Fees3Text ?? "Semi-Annual 2", _ => "Dues" };
            decimal amt = ft switch { 1 => (decimal)data.AnnualAmount, 2 => (decimal)data.Semi1Amount, 3 => (decimal)data.Semi2Amount, _ => 0 };
            unpaidRows.Append($"<tr><td style='padding:8px;border:1px solid #ddd;'>{label}</td><td style='padding:8px;border:1px solid #ddd;'>₹{amt}/-</td><td style='padding:8px;border:1px solid #ddd;'>Unpaid</td></tr>");
        }
        if (unpaidRows.Length == 0) return; // nothing to remind

        var frontendUrl = _config["FrontendUrl"] ?? "http://localhost:3000";
        var payUrl = $"{frontendUrl}/pay/dues/{(int)data.DuesId}";
        var remarkHtml = string.IsNullOrWhiteSpace(remark) ? "" : $"<p style='margin-top:16px;padding:12px;background:#f7fafc;border-left:4px solid #3182ce;'><strong>Remark:</strong> {remark}</p>";

        var subject = (string?)data.EmailReminderSubject ?? "Club Dues - Payment Reminder";
        var headerLogoUrl = ResolveEmailLogoUrl((string?)data.ClubLogoPath, (string?)data.EmailHeaderLogo);
        var body = $@"{BuildBrandedEmailHeader(headerLogoUrl)}
            <h2 style='color: #1a365d; margin-top: 0;'>Payment Reminder</h2>
            <p>Dear {(string?)data.MemberName},</p>
            <table style='width:100%;border-collapse:collapse;margin:20px 0;'>
                <tr><td style='padding:8px;border:1px solid #ddd;font-weight:bold;'>District Number</td><td colspan='2' style='padding:8px;border:1px solid #ddd;'>{(string?)data.DistrictNumber ?? "-"}</td></tr>
                <tr><td style='padding:8px;border:1px solid #ddd;font-weight:bold;'>Club Name</td><td colspan='2' style='padding:8px;border:1px solid #ddd;'>{(string?)data.ClubName ?? "-"}</td></tr>
                <tr><td style='padding:8px;border:1px solid #ddd;font-weight:bold;'>Purpose</td><td colspan='2' style='padding:8px;border:1px solid #ddd;'>{(string?)data.Purpose}</td></tr>
            </table>
            <div style='overflow-x:auto;'>
            <table class='rz-email-table' style='width:100%;border-collapse:collapse;margin:20px 0;'>
                <tr style='background:#17458F;color:white;'><th style='padding:8px;border:1px solid #ddd;'>Fee Type</th><th style='padding:8px;border:1px solid #ddd;'>Outstanding Amount</th><th style='padding:8px;border:1px solid #ddd;'>Status</th></tr>
                {unpaidRows}
            </table>
            </div>
            <p><strong>Click to Pay:</strong> <a href='{payUrl}' style='color:#3182ce;'>{payUrl}</a></p>
            {((string?)data.EmailReminderBody ?? "")}
            {remarkHtml}
        {BRANDED_EMAIL_FOOTER}";

        await _emailService.SendGenericEmailAsync((string)data.EmailId, subject, body);

        // Club Dues emails are free — no credit deduction
    }

    public async Task BulkSendReminderEmailAsync(int duesId, string? remark)
    {
        using var conn = GetConnection();
        var dues = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pk_membership_dues_id, fk_club_id AS ClubId, Purpose, RotaryYear, IsFees1, IsFees2, IsFees3,
                   Fees1Text, Fees2Text, Fees3Text, EmailReminderSubject, EmailReminderBody, EmailCC, EmailHeaderLogo,
                   OfflineBankName, OfflineAccountNumber, OfflineIfscCode, IsShowBankInReceipt
            FROM membership_dues WHERE pk_membership_dues_id=@Id AND isdeleted=0", new { Id = duesId });
        if (dues == null) return;

        // Get all member fees that have at least one unpaid fee type. Honorary members never
        // owe dues (their fee row just sits unpaid forever, by design), so this must exclude
        // them the same way the admin member list and payment endpoint already do — this bulk
        // query used to skip that join entirely, which is why honoraries kept getting reminded.
        var unpaidFees = await conn.QueryAsync<dynamic>(@"
            SELECT f.pk_id AS FeeId, f.fk_member_profile_id, f.AnnualAmount, f.Semi1Amount, f.Semi2Amount,
                   m.MemberName, m.EmailId,
                   d.DistrictNumber, c.ClubName,
                   CASE
                       WHEN c.ClubLogoPath IS NULL OR c.ClubLogoPath = '' THEN NULL
                       WHEN c.ClubLogoPath LIKE '/%' THEN c.ClubLogoPath
                       ELSE CONCAT('/uploads/club/', c.ClubLogoPath)
                   END AS ClubLogoPath
            FROM membership_dues_member_fees f
            JOIN member_master_profile m ON f.fk_member_profile_id = m.pk_member_master_profile_id
                AND m.isdeleted = 0
            JOIN membership_dues md ON f.fk_membership_dues_id = md.pk_membership_dues_id
            JOIN club_members cm ON cm.fk_member_master_profile_id = f.fk_member_profile_id
                AND cm.fk_club_id = md.fk_club_id
                AND cm.IsActive = 1
                AND COALESCE(cm.isdeleted, 0) = 0
                AND COALESCE(cm.IsHonoraryMember, 0) = 0
            LEFT JOIN district_master d ON md.fk_district_id = d.pk_district_id
            LEFT JOIN club_master c ON md.fk_club_id = c.pk_club_id
            WHERE f.fk_membership_dues_id=@DuesId AND f.isdeleted=0",
            new { DuesId = duesId });

        var frontendUrl = _config["FrontendUrl"] ?? "http://localhost:3000";
        var payUrl = $"{frontendUrl}/pay/dues/{duesId}";
        var remarkHtml = string.IsNullOrWhiteSpace(remark) ? "" : $"<p style='margin-top:16px;padding:12px;background:#f7fafc;border-left:4px solid #3182ce;'><strong>Remark:</strong> {remark}</p>";
        var subject = (string?)dues.EmailReminderSubject ?? "Club Dues - Payment Reminder";
        int sentCount = 0;
        int clubId = (int)dues.ClubId;
        int curMonth = await conn.ExecuteScalarAsync<int>("SELECT MONTH(NOW())");

        foreach (var f in unpaidFees)
        {
            if (string.IsNullOrWhiteSpace((string?)f.EmailId)) continue;

            // Check paid status for each fee type
            var feeId = (int)f.FeeId;
            var annualPaidCount = await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM membership_dues_payments WHERE fk_member_fee_id=@FeeId AND FeeType=1 AND IsPaid=1 AND isdeleted=0", new { FeeId = feeId });
            var semi1PaidCount = await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM membership_dues_payments WHERE fk_member_fee_id=@FeeId AND FeeType=2 AND IsPaid=1 AND isdeleted=0", new { FeeId = feeId });
            var semi2PaidCount = await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM membership_dues_payments WHERE fk_member_fee_id=@FeeId AND FeeType=3 AND IsPaid=1 AND isdeleted=0", new { FeeId = feeId });

            bool annualPaid = annualPaidCount > 0;
            bool semi1Paid = semi1PaidCount > 0;

            // If Annual paid → Semi1 and Semi2 are N/A, skip all
            if (annualPaid) continue;
            // If Semi1 paid → Annual is N/A

            var unpaidTypes = new List<string>();
            decimal totalOutstanding = 0;

            // Calendar-window gate: Semi 2 only Jan–Jun (see IsFeeTypeRemindable). Annual + Semi 1 all year.
            if ((bool)dues.IsFees1 && !semi1Paid && !annualPaid)
            {
                unpaidTypes.Add((string?)dues.Fees1Text ?? "Annual");
                totalOutstanding += (decimal)f.AnnualAmount;
            }
            if ((bool)dues.IsFees2 && !annualPaid && semi1PaidCount == 0)
            {
                unpaidTypes.Add((string?)dues.Fees2Text ?? "Semi-Annual 1");
                totalOutstanding += (decimal)f.Semi1Amount;
            }
            if ((bool)dues.IsFees3 && !annualPaid && semi2PaidCount == 0 && IsFeeTypeRemindable(3, curMonth))
            {
                unpaidTypes.Add((string?)dues.Fees3Text ?? "Semi-Annual 2");
                totalOutstanding += (decimal)f.Semi2Amount;
            }

            if (unpaidTypes.Count == 0) continue;

            try
            {
                // Build unpaid fee rows (same format as individual reminder)
                var unpaidRowsHtml = new System.Text.StringBuilder();
                foreach (var ut in unpaidTypes)
                {
                    var amt = ut == ((string?)dues.Fees1Text ?? "Annual") ? (decimal)f.AnnualAmount
                            : ut == ((string?)dues.Fees2Text ?? "Semi-Annual 1") ? (decimal)f.Semi1Amount
                            : (decimal)f.Semi2Amount;
                    unpaidRowsHtml.Append($"<tr><td style='padding:8px;border:1px solid #ddd;'>{ut}</td><td style='padding:8px;border:1px solid #ddd;'>₹{amt}/-</td><td style='padding:8px;border:1px solid #ddd;'>Unpaid</td></tr>");
                }

                var bulkHeaderLogoUrl = ResolveEmailLogoUrl((string?)f.ClubLogoPath, (string?)dues.EmailHeaderLogo);
                var body = $@"{BuildBrandedEmailHeader(bulkHeaderLogoUrl)}
                    <h2 style='color: #1a365d; margin-top: 0;'>Payment Reminder</h2>
                    <p>Dear {(string?)f.MemberName},</p>
                    <table style='width:100%;border-collapse:collapse;margin:20px 0;'>
                        <tr><td style='padding:8px;border:1px solid #ddd;font-weight:bold;'>District Number</td><td colspan='2' style='padding:8px;border:1px solid #ddd;'>{(string?)f.DistrictNumber ?? "-"}</td></tr>
                        <tr><td style='padding:8px;border:1px solid #ddd;font-weight:bold;'>Club Name</td><td colspan='2' style='padding:8px;border:1px solid #ddd;'>{(string?)f.ClubName ?? "-"}</td></tr>
                        <tr><td style='padding:8px;border:1px solid #ddd;font-weight:bold;'>Purpose</td><td colspan='2' style='padding:8px;border:1px solid #ddd;'>{(string?)dues.Purpose}</td></tr>
                    </table>
                    <div style='overflow-x:auto;'>
                    <table class='rz-email-table' style='width:100%;border-collapse:collapse;margin:20px 0;'>
                        <tr style='background:#17458F;color:white;'><th style='padding:8px;border:1px solid #ddd;'>Fee Type</th><th style='padding:8px;border:1px solid #ddd;'>Outstanding Amount</th><th style='padding:8px;border:1px solid #ddd;'>Status</th></tr>
                        {unpaidRowsHtml}
                    </table>
                    </div>
                    <p><strong>Click to Pay:</strong> <a href='{payUrl}' style='color:#3182ce;'>{payUrl}</a></p>
                    {((string?)dues.EmailReminderBody ?? "")}
                    {remarkHtml}
                {BRANDED_EMAIL_FOOTER}";

                await _emailService.SendGenericEmailAsync((string)f.EmailId, subject, body);
                sentCount++;
            }
            catch { /* skip failed */ }
        }

        // Club Dues emails are free — no credit deduction
    }

    public async Task SendReminderWhatsAppAsync(int memberFeeId, int feeType)
    {
        using var conn = GetConnection();
        var data = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT f.pk_id, m.MemberName, m.PrimaryMobileNumber,
                   md.pk_membership_dues_id AS DuesId, md.fk_club_id AS ClubId, md.Purpose, md.RotaryYear, md.ModeOfPayment,
                   md.IsShowBankInReceipt,
                   md.Fees1Text, md.Fees2Text, md.Fees3Text,
                   md.IsFees1, md.IsFees2, md.IsFees3,
                   md.OfflineBankName, md.OfflineAccountNumber, md.OfflineIfscCode,
                   f.AnnualAmount, f.Semi1Amount, f.Semi2Amount,
                   d.DistrictNumber, c.ClubName
            FROM membership_dues_member_fees f
            JOIN member_master_profile m ON f.fk_member_profile_id = m.pk_member_master_profile_id
            JOIN membership_dues md ON f.fk_membership_dues_id = md.pk_membership_dues_id
            JOIN club_members cm ON cm.fk_member_master_profile_id = f.fk_member_profile_id
                AND cm.fk_club_id = md.fk_club_id
                AND cm.IsActive = 1
                AND COALESCE(cm.isdeleted, 0) = 0
                AND COALESCE(cm.IsHonoraryMember, 0) = 0
            LEFT JOIN district_master d ON md.fk_district_id = d.pk_district_id
            LEFT JOIN club_master c ON md.fk_club_id = c.pk_club_id
            WHERE f.pk_id=@Id AND f.isdeleted=0", new { Id = memberFeeId });
        // Same honorary-exclusion guard as SendReminderEmailAsync above.
        if (data == null || string.IsNullOrWhiteSpace((string?)data.PrimaryMobileNumber)) return;

        // Determine which fee types to send
        var feeTypes = new List<int>();
        if (feeType > 0) { feeTypes.Add(feeType); }
        else
        {
            if (Convert.ToBoolean(data.IsFees1)) feeTypes.Add(1);
            if (Convert.ToBoolean(data.IsFees2)) feeTypes.Add(2);
            if (Convert.ToBoolean(data.IsFees3)) feeTypes.Add(3);
        }

        int curMonth = await conn.ExecuteScalarAsync<int>("SELECT MONTH(NOW())");
        decimal totalUnpaid = 0;
        foreach (var ft in feeTypes)
        {
            var isPaid = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM membership_dues_payments
                WHERE fk_member_fee_id=@FeeId AND FeeType=@FeeType AND IsPaid=1 AND isdeleted=0",
                new { FeeId = memberFeeId, FeeType = ft });
            if (isPaid > 0) continue;
            // Calendar-window gate: Semi 2 only Jan–Jun (see IsFeeTypeRemindable).
            if (!IsFeeTypeRemindable(ft, curMonth)) continue;
            totalUnpaid += ft switch { 1 => (decimal)data.AnnualAmount, 2 => (decimal)data.Semi1Amount, 3 => (decimal)data.Semi2Amount, _ => 0 };
        }
        if (totalUnpaid <= 0) return;

        var frontendUrl = _config["FrontendUrl"] ?? "http://localhost:3000";
        var payUrl = $"{frontendUrl}/pay/dues/{(int)data.DuesId}";

        // Club Dues has one reminder template — unlike District Dues it always includes the
        // bank-details block; bank fields fall back to "-" when not configured, same as before.
        await _interaktService.SendWhatsAppWithBodyValuesAsync(
            (string)data.PrimaryMobileNumber, "updated_row_club_membership_dues_collection",
            new[] { (string)data.MemberName, (string?)data.ClubName ?? "-",
                    (string)(data.Purpose ?? "Club Dues"), "Not Received", payUrl,
                    (string?)data.OfflineBankName ?? "-", (string?)data.OfflineAccountNumber ?? "-", (string?)data.OfflineIfscCode ?? "-" });

        // Club Dues WhatsApp is free — no credit deduction
    }

    public async Task BulkSendReminderWhatsAppAsync(int duesId)
    {
        using var conn = GetConnection();
        var dues = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pk_membership_dues_id, fk_club_id AS ClubId, Purpose, RotaryYear, IsFees1, IsFees2, IsFees3, ModeOfPayment,
                   IsShowBankInReceipt, OfflineBankName, OfflineAccountNumber, OfflineIfscCode
            FROM membership_dues WHERE pk_membership_dues_id=@Id AND isdeleted=0", new { Id = duesId });
        if (dues == null) return;

        // Same honorary exclusion as the bulk email reminder above — this query used to have
        // no club_members join at all, so honorary members' permanently-unpaid fee rows kept
        // triggering WhatsApp reminders too.
        var members = await conn.QueryAsync<dynamic>(@"
            SELECT f.pk_id AS FeeId, m.MemberName, m.PrimaryMobileNumber,
                   f.AnnualAmount, f.Semi1Amount, f.Semi2Amount,
                   d.DistrictNumber, c.ClubName
            FROM membership_dues_member_fees f
            JOIN member_master_profile m ON f.fk_member_profile_id = m.pk_member_master_profile_id
                AND m.isdeleted = 0
            JOIN membership_dues md ON f.fk_membership_dues_id = md.pk_membership_dues_id
            JOIN club_members cm ON cm.fk_member_master_profile_id = f.fk_member_profile_id
                AND cm.fk_club_id = md.fk_club_id
                AND cm.IsActive = 1
                AND COALESCE(cm.isdeleted, 0) = 0
                AND COALESCE(cm.IsHonoraryMember, 0) = 0
            LEFT JOIN district_master d ON md.fk_district_id = d.pk_district_id
            LEFT JOIN club_master c ON md.fk_club_id = c.pk_club_id
            WHERE f.fk_membership_dues_id=@DuesId AND f.isdeleted=0",
            new { DuesId = duesId });

        var frontendUrl = _config["FrontendUrl"] ?? "http://localhost:3000";
        var payUrl = $"{frontendUrl}/pay/dues/{duesId}";
        int sentCount = 0;
        int clubId = (int)dues.ClubId;
        int curMonth = await conn.ExecuteScalarAsync<int>("SELECT MONTH(NOW())");

        foreach (var m in members)
        {
            if (string.IsNullOrWhiteSpace((string?)m.PrimaryMobileNumber)) continue;

            // Check paid status with N/A logic
            var feeId = (int)m.FeeId;
            var annualPaidWA = await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM membership_dues_payments WHERE fk_member_fee_id=@FeeId AND FeeType=1 AND IsPaid=1 AND isdeleted=0", new { FeeId = feeId });
            var semi1PaidWA = await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM membership_dues_payments WHERE fk_member_fee_id=@FeeId AND FeeType=2 AND IsPaid=1 AND isdeleted=0", new { FeeId = feeId });
            var semi2PaidWA = await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM membership_dues_payments WHERE fk_member_fee_id=@FeeId AND FeeType=3 AND IsPaid=1 AND isdeleted=0", new { FeeId = feeId });

            // If Annual paid → all N/A, skip
            if (annualPaidWA > 0) continue;

            decimal totalOutstanding = 0;
            // Calendar-window gate: Semi 2 only Jan–Jun (see IsFeeTypeRemindable). Annual + Semi 1 all year.
            if ((bool)dues.IsFees1 && semi1PaidWA == 0)
                totalOutstanding += (decimal)m.AnnualAmount;
            if ((bool)dues.IsFees2 && semi1PaidWA == 0)
                totalOutstanding += (decimal)m.Semi1Amount;
            if ((bool)dues.IsFees3 && semi2PaidWA == 0 && IsFeeTypeRemindable(3, curMonth))
                totalOutstanding += (decimal)m.Semi2Amount;

            if (totalOutstanding <= 0) continue;

            try
            {
                // Same single always-with-bank template as the individual reminder.
                await _interaktService.SendWhatsAppWithBodyValuesAsync(
                    (string)m.PrimaryMobileNumber, "updated_row_club_membership_dues_collection",
                    new[] { (string)m.MemberName, (string?)m.ClubName ?? "-",
                            (string)(dues.Purpose ?? "Club Dues"), "Not Received", payUrl,
                            (string?)dues.OfflineBankName ?? "-", (string?)dues.OfflineAccountNumber ?? "-", (string?)dues.OfflineIfscCode ?? "-" });
                sentCount++;
            }
            catch { /* skip failed */ }
        }

        // Club Dues WhatsApp is free — no credit deduction
    }

    // ═══════════════════════════════════════════════════════════════
    //  GOOGLE SHEETS
    // ═══════════════════════════════════════════════════════════════

    public async Task<string> CreateGoogleSheetAsync(int duesId)
    {
        using var conn = GetConnection();
        var dues = await GetDuesSheetConfigAsync(conn, duesId);
        if (dues == null) throw new KeyNotFoundException("Club dues not found.");

        if (!string.IsNullOrWhiteSpace((string?)dues.GoogleSheetId))
            return (string)dues.GoogleSheetId;

        var purpose = ((string?)dues.Purpose ?? "ClubDues").Trim();
        var safePurpose = System.Text.RegularExpressions.Regex.Replace(purpose, @"[^a-zA-Z0-9 _-]", "").Replace(" ", "_");
        var sheetTitle = $"Dues_{safePurpose}_{DateTime.Now:ddMMyyyyHHmmss}";

        // Explicit casts below: passing the dynamic `dues` row into a helper makes that CALL
        // dynamically dispatched too, which otherwise "infects" the assigned variable's static
        // type and breaks the ILogger extension-method calls further down (CS1973).
        string[] headers = BuildMemberSheetHeaders(dues);
        string sheetId = await _googleSheetsService.CreateSpreadsheetAsync(sheetTitle, headers);

        var email = (string?)dues.GoogleSheetEmail;
        if (!string.IsNullOrWhiteSpace(email))
        {
            try { await _googleSheetsService.ShareWithEmailAsync(sheetId, email); }
            catch (Exception ex) { _logger.LogWarning(ex, "Failed to share sheet with {Email}", email); }
        }

        await conn.ExecuteAsync("UPDATE membership_dues SET GoogleSheetId=@SheetId WHERE pk_membership_dues_id=@Id",
            new { SheetId = sheetId, Id = duesId });

        IList<IList<object>> rows = await BuildPaidMemberSheetRowsAsync(conn, duesId, dues);
        try { await _googleSheetsService.WriteRowsAsync(sheetId, rows); }
        catch (Exception ex) { _logger.LogWarning(ex, "Failed to backfill sheet {SheetId}", sheetId); }

        _logger.LogInformation("Created Google Sheet {SheetId} for dues {DuesId} with {Count} paid members", sheetId, duesId, rows.Count);
        return sheetId;
    }

    public async Task DeleteGoogleSheetAsync(int duesId)
    {
        using var conn = GetConnection();
        var sheetId = await conn.ExecuteScalarAsync<string?>(
            "SELECT GoogleSheetId FROM membership_dues WHERE pk_membership_dues_id=@Id AND isdeleted=0", new { Id = duesId });
        if (string.IsNullOrWhiteSpace(sheetId))
            throw new KeyNotFoundException("No Google Sheet found for this dues.");

        await _googleSheetsService.DeleteSpreadsheetAsync(sheetId);
        await conn.ExecuteAsync("UPDATE membership_dues SET GoogleSheetId=NULL WHERE pk_membership_dues_id=@Id", new { Id = duesId });
        _logger.LogInformation("Deleted Google Sheet {SheetId} for dues {DuesId}", sheetId, duesId);
    }

    // ═══════════════════════════════════════════════════════════════
    //  PUBLIC ENDPOINTS
    // ═══════════════════════════════════════════════════════════════

    public async Task<PublicMembershipDuesDto?> GetPublicDuesAsync(int duesId)
    {
        using var conn = GetConnection();
        var dues = await conn.QueryFirstOrDefaultAsync<PublicMembershipDuesDto>(@"
            SELECT md.pk_membership_dues_id AS Id, md.Purpose, md.PurposeDescription, md.PurposeLogo, md.BackgroundImage,
                   d.DistrictNumber, c.ClubName,
                   md.IsFees1, md.IsFees2, md.IsFees3, md.Fees1Text, md.Fees2Text, md.Fees3Text,
                   md.ModeOfPayment
            FROM membership_dues md
            LEFT JOIN district_master d ON md.fk_district_id = d.pk_district_id
            LEFT JOIN club_master c ON md.fk_club_id = c.pk_club_id
            WHERE md.pk_membership_dues_id=@Id AND md.isdeleted=0 AND md.IsActive=1",
            new { Id = duesId });

        return dues;
    }

    public async Task<IEnumerable<dynamic>> SearchMembersAsync(int duesId, string? query)
    {
        using var conn = GetConnection();
        var clubId = await conn.ExecuteScalarAsync<int?>(
            "SELECT fk_club_id FROM membership_dues WHERE pk_membership_dues_id=@Id AND isdeleted=0", new { Id = duesId });
        if (!clubId.HasValue) return Enumerable.Empty<dynamic>();

        // Honorary members are excluded from the /pay/dues member search — they
        // don't pay dues, so they should not appear as a selectable option on
        // the public payment page. Matches the dashboard KPI + member list
        // handling (added 2026-07-09).
        return await conn.QueryAsync<dynamic>(@"
            SELECT m.pk_member_master_profile_id AS MemberId, m.MemberName, m.EmailId, m.PrimaryMobileNumber
            FROM club_members cm
            JOIN member_master_profile m ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
            WHERE cm.fk_club_id=@ClubId AND cm.IsActive=1 AND cm.isdeleted=0 AND m.isdeleted=0
              AND COALESCE(cm.IsHonoraryMember, 0) = 0
              AND (@Query IS NULL OR m.MemberName LIKE @Search OR m.PrimaryMobileNumber LIKE @Search OR m.EmailId LIKE @Search)
            ORDER BY m.MemberName
            LIMIT 50",
            new { ClubId = clubId, Query = query, Search = $"%{query}%" });
    }

    public async Task<object?> GetMemberDuesStatusAsync(int duesId, int memberProfileId)
    {
        using var conn = GetConnection();

        // Get dues config
        var dues = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pk_membership_dues_id, RotaryYear, IsFees1, IsFees2, IsFees3,
                   Fees1Text, Fees2Text, Fees3Text, ModeOfPayment, fk_club_id AS ClubId,
                   OfflineBankName, OfflineAccountNumber, OfflineIfscCode, IsShowBankInReceipt,
                   OnlineSurchargePercent
            FROM membership_dues WHERE pk_membership_dues_id=@Id AND isdeleted=0 AND IsActive=1",
            new { Id = duesId });
        if (dues == null) return null;
        decimal surchargePercent = (decimal)dues.OnlineSurchargePercent;

        // Defensive: block honorary members even if URL crafted directly.
        // Search endpoint already hides them, but this ensures no one can
        // circumvent by supplying a honorary's memberProfileId.
        var isHonorary = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM club_members
            WHERE fk_club_id = @ClubId AND fk_member_master_profile_id = @MemberId
              AND IsActive = 1 AND isdeleted = 0
              AND COALESCE(IsHonoraryMember, 0) = 1",
            new { ClubId = (int)dues.ClubId, MemberId = memberProfileId });
        if (isHonorary > 0)
            return new { message = "Honorary members are not required to pay club dues." };

        // Get member's fee allocation — AnnualAmount/Semi1Amount/Semi2Amount are
        // the ONE true (base/offline) amount; the online (payable) amount is
        // derived below via ComputeOnlineAmount.
        var fee = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pk_id AS FeeId, CategoryType, AnnualAmount, Semi1Amount, Semi2Amount
            FROM membership_dues_member_fees
            WHERE fk_membership_dues_id=@DuesId AND fk_member_profile_id=@MemberId AND isdeleted=0",
            new { DuesId = duesId, MemberId = memberProfileId });
        if (fee == null) return new { message = "No fee allocation found for this member. Please contact your club admin." };

        // Get payment status per fee type (include offline details for resubmit)
        var payments = await conn.QueryAsync<dynamic>(@"
            SELECT FeeType, IsPaid, PaymentStatus, OfflineStatus, Amount, PaymentDate, RejectionReason,
                   CASE WHEN IsOnline=1 THEN 'Payment Gateway' ELSE COALESCE(OfflineTransactionType, 'Cash') END AS PaymentMode,
                   OfflineTransactionType, OfflineTransactionId, OfflineGivenTo, OfflineRemark, Attachment
            FROM membership_dues_payments
            WHERE fk_member_fee_id=@FeeId AND isdeleted=0
            ORDER BY created_date DESC",
            new { FeeId = (int)fee.FeeId });

        // Helper to get status details per fee type. baseAmount is the ONE true
        // (offline) amount; Amount is the derived online (with-surcharge) figure
        // the "Pay Online" button charges — OfflineAmount is the real base, so
        // the frontend no longer needs to approximate it client-side.
        PublicDuesFeeOption BuildFeeOption(int ft, string label, decimal baseAmount, bool isPaid)
        {
            var latestPayment = payments.FirstOrDefault(p => (int)p.FeeType == ft);
            bool isPending = latestPayment != null && (string?)latestPayment.OfflineStatus == "Pending";
            bool isRejected = latestPayment != null && (string?)latestPayment!.OfflineStatus == "Rejected";
            return new PublicDuesFeeOption
            {
                FeeType = ft, Label = label,
                Amount = ComputeOnlineAmount(baseAmount, surchargePercent),
                OfflineAmount = baseAmount,
                IsPaid = isPaid,
                IsAvailable = !isPaid && !isPending,
                IsPending = isPending,
                IsRejected = isRejected,
                RejectionReason = isRejected ? (string?)latestPayment!.RejectionReason : null,
                PaymentDate = isPaid && latestPayment != null ? ((DateTime?)latestPayment!.PaymentDate)?.ToString("dd-MMM-yyyy hh:mm tt") : null,
                PaymentMode = isPaid && latestPayment != null ? (string?)latestPayment!.PaymentMode : null,
                // Previous submission details for resubmit
                PrevTransactionType = (isRejected || isPending) && latestPayment != null ? (string?)latestPayment!.OfflineTransactionType : null,
                PrevTransactionId = (isRejected || isPending) && latestPayment != null ? (string?)latestPayment!.OfflineTransactionId : null,
                PrevGivenTo = (isRejected || isPending) && latestPayment != null ? (string?)latestPayment!.OfflineGivenTo : null,
                PrevPaymentDate = (isRejected || isPending) && latestPayment != null ? ((DateTime?)latestPayment!.PaymentDate)?.ToString("yyyy-MM-dd") : null,
                PrevRemark = (isRejected || isPending) && latestPayment != null ? (string?)latestPayment!.OfflineRemark : null,
                PrevAttachment = (isRejected || isPending) && latestPayment != null ? (string?)latestPayment!.Attachment : null
            };
        }

        // NOTE: the previous implementation gated each fee type by hard-coded
        // calendar windows (Semi1 = Jul–Dec, Semi2 = Jan–Jun, Annual = whole
        // year). That rule has been removed at the user's direction — a
        // member (or admin via offline entry) can now pay ANY enabled fee
        // type at ANY time. The only remaining filter is the cross-
        // incompatibility rule applied below.
        var now = DateTime.Now;

        // Check what's paid. IsPaid is TINYINT(1) — older rows may have NULL. The (bool) cast
        // on a NULL dynamic throws InvalidCastException, which surfaces as 500 in the UI as
        // "Failed to load dues status." Convert.ToBoolean handles NULL → false correctly.
        bool annualPaid = payments.Any(p => (int)p.FeeType == 1 && Convert.ToBoolean(p.IsPaid ?? false));
        bool semi1Paid = payments.Any(p => (int)p.FeeType == 2 && Convert.ToBoolean(p.IsPaid ?? false));
        bool semi2Paid = payments.Any(p => (int)p.FeeType == 3 && Convert.ToBoolean(p.IsPaid ?? false));

        var availableFees = new List<PublicDuesFeeOption>();
        bool isFees1 = (bool)dues.IsFees1;
        bool isFees2 = (bool)dues.IsFees2;
        bool isFees3 = (bool)dues.IsFees3;

        // Cross-incompatibility filter (no calendar gating):
        //   Annual paid    → hide Semi1 + Semi2 (can't pay half on top of whole).
        //   Semi1 or Semi2 paid → hide Annual    (can't pay whole on top of half).
        //   Nothing paid   → all enabled fee types are selectable.
        // Already-paid fees stay in the list so the member sees them marked
        // "Paid" with date/mode; the UI greys them out via fee.isPaid.
        bool annualShouldShow = isFees1 && !semi1Paid && !semi2Paid;
        bool semi1ShouldShow = isFees2 && !annualPaid;
        bool semi2ShouldShow = isFees3 && !annualPaid;

        if (semi1ShouldShow)
            availableFees.Add(BuildFeeOption(2, (string?)dues.Fees2Text ?? "Semi-Annual 1", (decimal)fee.Semi1Amount, semi1Paid));
        if (semi2ShouldShow)
            availableFees.Add(BuildFeeOption(3, (string?)dues.Fees3Text ?? "Semi-Annual 2", (decimal)fee.Semi2Amount, semi2Paid));
        if (annualShouldShow)
            availableFees.Add(BuildFeeOption(1, (string?)dues.Fees1Text ?? "Annual", (decimal)fee.AnnualAmount, annualPaid));

        return new
        {
            FeeId = (int)fee.FeeId,
            CategoryType = (string?)fee.CategoryType,
            AvailableFees = availableFees,
            ModeOfPayment = (int)dues.ModeOfPayment,
            IsShowBankInReceipt = (bool)dues.IsShowBankInReceipt,
            OfflineBankName = (string?)dues.OfflineBankName,
            OfflineAccountNumber = (string?)dues.OfflineAccountNumber,
            OfflineIfscCode = (string?)dues.OfflineIfscCode
        };
    }

    public async Task<bool> SendPaymentOtpAsync(int duesId, SendOtpRequestDto dto)
    {
        var otp = new Random().Next(100000, 999999).ToString();
        using var conn = GetConnection();

        // Resolve email/mobile from member profile
        var email = dto.Email;
        var mobile = dto.Mobile;
        int? memberCountryId = null;
        if (dto.MemberProfileId.HasValue && dto.MemberProfileId > 0)
        {
            var member = await conn.QueryFirstOrDefaultAsync<dynamic>(
                "SELECT EmailId, PrimaryMobileNumber, fk_primary_country_id AS CountryId FROM member_master_profile WHERE pk_member_master_profile_id=@Id",
                new { Id = dto.MemberProfileId });
            if (member != null)
            {
                if (string.IsNullOrWhiteSpace(email)) email = (string?)member.EmailId;
                if (string.IsNullOrWhiteSpace(mobile)) mobile = (string?)member.PrimaryMobileNumber;
                memberCountryId = member.CountryId == null ? null : (int?)member.CountryId;
            }
        }

        // Reuse event_payment_otp table with duesId as linkId
        await conn.ExecuteAsync(@"
            INSERT INTO event_payment_otp (fk_payment_link_id, Email, Mobile, OtpCode, ExpiresAt)
            VALUES (@LinkId, @Email, @Mobile, @Otp, DATE_ADD(NOW(), INTERVAL 5 MINUTE))",
            new { LinkId = duesId, Email = email, Mobile = mobile, Otp = otp });

        var emailSent = false;
        var smsSent = false;
        var whatsAppSent = false;

        if (!string.IsNullOrWhiteSpace(email))
        {
            try
            {
                await _emailService.SendGenericEmailAsync(email!, "OTP Verification - ROW",
                    $@"{EmailService.EMAIL_HEADER}
                        <h2 style='color: #1a365d; margin-top: 0;'>OTP Verification</h2>
                        <p>Your OTP for club dues payment verification is:</p>
                        <div style='text-align:center;margin:20px 0;'>
                            <span style='font-size:32px;font-weight:bold;letter-spacing:8px;color:#1a365d;'>{otp}</span>
                        </div>
                        <p style='color:#718096;'>Valid for 5 minutes.</p>
                    {EmailService.EMAIL_FOOTER}");
                emailSent = true;
            }
            catch { /* skip if email fails */ }
        }
        if (!string.IsNullOrWhiteSpace(mobile))
        {
            // Outside India → WhatsApp (the DLT SMS gateway is India-only). No-ops and returns
            // false for India / unknown country, so the SMS line below stays exactly as it was.
            whatsAppSent = await OtpWhatsAppHelper.TrySendOutsideIndiaAsync(
                conn, _interaktService, _config, _logger, mobile, memberCountryId, otp, "club dues payment");

            // Fallback: if the WhatsApp send failed we still attempt the SMS that used to be
            // the only channel here — a failed attempt beats delivering nothing at all.
            if (!whatsAppSent)
                smsSent = await _smsService.SendOtpSmsAsync(mobile, otp);
        }

        return emailSent || smsSent || whatsAppSent;
    }

    public async Task<bool> VerifyOtpAsync(int duesId, VerifyOtpRequestDto dto)
    {
        // Default OTP bypass for testing
        if (dto.OtpCode == "111111") return true;

        using var conn = GetConnection();

        var email = dto.Email;
        var mobile = dto.Mobile;
        if (dto.MemberProfileId.HasValue && dto.MemberProfileId > 0)
        {
            var member = await conn.QueryFirstOrDefaultAsync<dynamic>(
                "SELECT EmailId, PrimaryMobileNumber FROM member_master_profile WHERE pk_member_master_profile_id=@Id",
                new { Id = dto.MemberProfileId });
            if (member != null)
            {
                if (string.IsNullOrWhiteSpace(email)) email = (string?)member.EmailId;
                if (string.IsNullOrWhiteSpace(mobile)) mobile = (string?)member.PrimaryMobileNumber;
            }
        }

        var valid = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM event_payment_otp
            WHERE fk_payment_link_id=@LinkId AND OtpCode=@Code AND ExpiresAt > NOW() AND IsVerified=0
              AND ((@Email IS NOT NULL AND Email=@Email) OR (@Mobile IS NOT NULL AND Mobile=@Mobile))",
            new { LinkId = duesId, Code = dto.OtpCode, Email = email, Mobile = mobile });

        if (valid > 0)
        {
            await conn.ExecuteAsync(@"
                UPDATE event_payment_otp SET IsVerified=1
                WHERE fk_payment_link_id=@LinkId AND OtpCode=@Code
                  AND ((@Email IS NOT NULL AND Email=@Email) OR (@Mobile IS NOT NULL AND Mobile=@Mobile))",
                new { LinkId = duesId, Code = dto.OtpCode, Email = email, Mobile = mobile });
            return true;
        }
        return false;
    }

    public async Task<DuesPaymentSessionResponseDto> CreatePaymentOrderAsync(int duesId, PublicDuesPaymentSubmitDto dto)
    {
        using var conn = GetConnection();

        // Get member's fee allocation
        var fee = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT f.pk_id AS FeeId, f.fk_member_profile_id, f.AnnualAmount, f.Semi1Amount, f.Semi2Amount,
                   md.fk_club_id, md.AmountType, md.OnlineSurchargePercent
            FROM membership_dues_member_fees f
            JOIN membership_dues md ON f.fk_membership_dues_id = md.pk_membership_dues_id
            WHERE f.fk_membership_dues_id=@DuesId AND f.fk_member_profile_id=@MemberId AND f.isdeleted=0",
            new { DuesId = duesId, MemberId = dto.FkMemberProfileId });
        if (fee == null) throw new KeyNotFoundException("Member fee allocation not found.");

        // baseAmount is the ONE true (offline) amount; the online payment order
        // always charges baseAmount + surcharge (see ComputeOnlineAmount).
        decimal baseAmount = dto.FeeType switch
        {
            1 => (decimal)fee.AnnualAmount,
            2 => (decimal)fee.Semi1Amount,
            3 => (decimal)fee.Semi2Amount,
            _ => throw new ArgumentException("Invalid fee type.")
        };

        if (baseAmount <= 0) throw new InvalidOperationException("Fee amount is zero.");

        decimal surchargePercent = (decimal)fee.OnlineSurchargePercent;
        decimal amount = ComputeOnlineAmount(baseAmount, surchargePercent);

        // Check if already paid
        var alreadyPaid = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM membership_dues_payments
            WHERE fk_member_fee_id=@FeeId AND FeeType=@FeeType AND IsPaid=1 AND isdeleted=0",
            new { FeeId = (int)fee.FeeId, dto.FeeType });
        if (alreadyPaid > 0) throw new InvalidOperationException("This fee has already been paid.");

        // Get member details
        var member = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT MemberName, PrimaryMobileNumber, EmailId FROM member_master_profile WHERE pk_member_master_profile_id=@Id",
            new { Id = dto.FkMemberProfileId });

        // Get member's vendor splits for this fee type
        var vendorSplits = await conn.QueryAsync<dynamic>(@"
            SELECT k.vendor_id AS VendorId,
                   CASE @FeeType WHEN 1 THEN mv.AnnualAmount WHEN 2 THEN mv.Semi1Amount WHEN 3 THEN mv.Semi2Amount END AS SplitAmount
            FROM membership_dues_member_vendors mv
            LEFT JOIN cashfree_kyc k ON mv.fk_kyc_id = k.pk_kyc_id
            WHERE mv.fk_member_fee_id=@FeeId AND mv.isdeleted=0",
            new { FeeId = (int)fee.FeeId, dto.FeeType });

        // Generate unique order_id
        var orderId = $"DUES{duesId}_{DateTime.Now:ddMMyyyyHHmmssffffff}";
        var customerId = $"CUST_{Guid.NewGuid():N}"[..20];

        // Insert payment record
        var paymentId = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO membership_dues_payments (fk_membership_dues_id, fk_member_fee_id, fk_member_profile_id,
                FeeType, Amount, IsPaid, IsOnline, PaymentStatus, CfOrderId,
                created_date)
            VALUES (@DuesId, @FeeId, @MemberId,
                @FeeType, @Amount, 0, 1, 'ACTIVE', @OrderId,
                NOW());
            SELECT LAST_INSERT_ID();",
            new
            {
                DuesId = duesId, FeeId = (int)fee.FeeId, MemberId = dto.FkMemberProfileId,
                dto.FeeType, Amount = amount,
                OrderId = orderId
            });

        // Create Cashfree order
        var cf = _config.GetSection("CashfreePayment");
        var frontendUrl = _config["FrontendUrl"] ?? "http://localhost:3000";
        var webhookUrl = _config["MembershipDuesWebhookUrl"] ?? $"{_config["WebhookBaseUrl"] ?? _config["BackendUrl"]}/api/public/membership-dues/webhook";
        var returnUrl = $"{frontendUrl}/pay/dues/{duesId}/thank-you?orderId={orderId}&paymentId={paymentId}";

        // Vendor splits are configured (and validated in Step 3 of the wizard)
        // to sum to the ONLINE (surcharge-inflated) total directly — the
        // default vendor's own split already carries its surcharge share, so
        // no separate delta needs adding here. Convert every configured split
        // (flat amount or percentage) to an exact rupee amount and always send
        // amount-type entries to Cashfree.
        int amountType = (int)(fee.AmountType ?? 1);
        var finalSplits = vendorSplits
            .Select(s => new
            {
                VendorId = (string)s.VendorId,
                Amount = amountType == 2
                    ? Math.Round(amount * (decimal)s.SplitAmount / 100m, 2, MidpointRounding.AwayFromZero)
                    : (decimal)s.SplitAmount
            })
            .ToList();

        var orderSplits = finalSplits.Where(s => s.Amount > 0)
            .Select(s => (object)new { vendor_id = s.VendorId, amount = s.Amount })
            .ToList();

        var orderPayload = new
        {
            order_id = orderId,
            order_amount = amount,
            order_currency = "INR",
            customer_details = new
            {
                customer_id = customerId,
                customer_phone = (string?)member?.PrimaryMobileNumber ?? "",
                customer_email = (string?)member?.EmailId ?? "",
                customer_name = (string?)member?.MemberName ?? ""
            },
            order_meta = new
            {
                return_url = returnUrl,
                notify_url = webhookUrl
            },
            order_splits = orderSplits.Any() ? orderSplits : null
        };

        var splitsJson = JsonSerializer.Serialize(orderSplits);
        Console.WriteLine($"[MembershipDues Payment] DuesId={duesId}, OrderId={orderId}, Amount={amount}, Splits={splitsJson}");

        var json = JsonSerializer.Serialize(orderPayload, new JsonSerializerOptions { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull });
        var request = new HttpRequestMessage(HttpMethod.Post, $"{cf["BaseUrl"]}orders")
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json")
        };
        request.Headers.Add("x-client-id", cf["ClientId"]);
        request.Headers.Add("x-client-secret", cf["ClientSecret"]);
        request.Headers.Add("x-api-version", cf["ApiVersion"]);

        var response = await _httpClient.SendAsync(request);
        var responseBody = await response.Content.ReadAsStringAsync();

        if (!response.IsSuccessStatusCode)
        {
            _logger.LogError("Cashfree create order failed: {Body}", responseBody);
            throw new Exception($"Payment gateway error: {responseBody}");
        }

        var orderResponse = JsonSerializer.Deserialize<JsonElement>(responseBody);
        var cfOrderId = orderResponse.GetProperty("cf_order_id").ToString();
        var paymentSessionId = orderResponse.GetProperty("payment_session_id").GetString()!;

        // Update payment record with Cashfree details.
        //
        // TWO DIFFERENT IDENTIFIERS — do not conflate them:
        //   CfOrderId     = Cashfree's own numeric id ("6600000000"). Useful for the
        //                   dashboard, but NOT accepted by any Cashfree REST endpoint.
        //   TransactionId = OUR merchant order_id ("DUES105_08082026125943123456"). This is
        //                   the ONLY key GET /pg/orders/{order_id} accepts, and it is what
        //                   Cashfree echoes back as data.order.order_id on the webhook.
        // The merchant order_id was previously written by the INSERT above and then
        // destroyed by this UPDATE, which left the webhook's `WHERE CfOrderId=<order_id>`
        // permanently unmatchable and made after-the-fact reconciliation impossible.
        // Persisting it here restores the legacy behaviour (the old system stored the same
        // value in TransactionId) and is what MembershipDuesReconciliationBackgroundService
        // uses to ask Cashfree whether an ACTIVE row was actually paid.
        await conn.ExecuteAsync(@"
            UPDATE membership_dues_payments SET CfOrderId=@CfOrderId, TransactionId=@MerchantOrderId, PaymentSessionId=@SessionId, PaymentStatus='ACTIVE', OrderSplitsJson=@SplitsJson
            WHERE pk_id=@Id",
            new { CfOrderId = cfOrderId, MerchantOrderId = orderId, SessionId = paymentSessionId, Id = paymentId, SplitsJson = splitsJson });

        // Build a signed redirect URL through the shared Cashfree proxy hosted at
        // example.org (already whitelisted with Cashfree). Frontend prefers this
        // URL when present; otherwise falls back to opening Cashfree's JS SDK directly.
        var proxy = CashfreeGatewayProxy.Build(
            _config,
            orderId: cfOrderId,
            sessionId: paymentSessionId,
            amountText: amount.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture),
            returnUrl: returnUrl,
            customerName: (string?)member?.MemberName,
            customerEmail: (string?)member?.EmailId,
            customerPhone: (string?)member?.PrimaryMobileNumber);

        return new DuesPaymentSessionResponseDto
        {
            PaymentSessionId = paymentSessionId,
            CfOrderId = cfOrderId,
            OrderId = orderId,
            PaymentId = paymentId,
            Environment = cf["Environment"]?.ToLower() == "sandbox" ? "sandbox" : "production",
            GatewayProxyUrl = proxy.IsConfigured ? proxy.ProxyUrl : null
        };
    }

    public async Task<VerifyPaymentResponseDto> VerifyPaymentAsync(int duesId, string orderId, int paymentId)
    {
        var cf = _config.GetSection("CashfreePayment");
        var request = new HttpRequestMessage(HttpMethod.Get, $"{cf["BaseUrl"]}orders/{orderId}");
        request.Headers.Add("x-client-id", cf["ClientId"]);
        request.Headers.Add("x-client-secret", cf["ClientSecret"]);
        request.Headers.Add("x-api-version", cf["ApiVersion"]);

        var response = await _httpClient.SendAsync(request);
        var body = await response.Content.ReadAsStringAsync();

        if (!response.IsSuccessStatusCode)
            return new VerifyPaymentResponseDto { IsSuccess = false, OrderStatus = "ERROR" };

        var order = JsonSerializer.Deserialize<JsonElement>(body);
        var status = order.GetProperty("order_status").GetString();

        using var conn = GetConnection();
        if (status == "PAID")
        {
            await conn.ExecuteAsync(@"
                UPDATE membership_dues_payments SET IsPaid=1, IsOnline=1, PaymentStatus='PAID', PaidSource='Page', PaymentDate=NOW()
                WHERE pk_id=@Id AND IsPaid=0",
                new { Id = paymentId });

            // Send receipt email (fire-and-forget)
            _ = Task.Run(async () =>
            {
                try { await SendReceiptEmailAsync(paymentId); } catch { /* non-critical */ }
            });

            // Append to Google Sheet (fire-and-forget)
            _ = Task.Run(async () =>
            {
                try { await SyncGoogleSheetAsync(paymentId); }
                catch (Exception ex) { _logger.LogError(ex, "Failed to append to Google Sheet for payment {Id}", paymentId); }
            });

            // Auto-refresh settlement (fire-and-forget)
            _ = Task.Run(async () =>
            {
                try { await RefreshSettlementsAsync(duesId); }
                catch { /* non-critical */ }
            });

            var paymentInfo = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
                SELECT m.MemberName, p.Amount, p.FeeType,
                       md.Fees1Text, md.Fees2Text, md.Fees3Text
                FROM membership_dues_payments p
                JOIN member_master_profile m ON p.fk_member_profile_id = m.pk_member_master_profile_id
                JOIN membership_dues md ON p.fk_membership_dues_id = md.pk_membership_dues_id
                WHERE p.pk_id=@Id", new { Id = paymentId });

            var feeLabel = paymentInfo != null ? ((int)paymentInfo.FeeType switch
            {
                1 => (string?)paymentInfo.Fees1Text ?? "Annual",
                2 => (string?)paymentInfo.Fees2Text ?? "Semi-Annual 1",
                3 => (string?)paymentInfo.Fees3Text ?? "Semi-Annual 2",
                _ => "Dues"
            }) : "Dues";

            return new VerifyPaymentResponseDto
            {
                IsSuccess = true,
                OrderStatus = "PAID",
                MemberName = paymentInfo?.MemberName,
                Amount = paymentInfo?.Amount,
                RegistrationType = feeLabel,
                PaymentDate = DateTime.Now
            };
        }

        return new VerifyPaymentResponseDto { IsSuccess = false, OrderStatus = status };
    }

    public async Task HandleWebhookAsync(string payload)
    {
        try
        {
            var data = JsonSerializer.Deserialize<JsonElement>(payload);
            if (!data.TryGetProperty("data", out var orderData))
            {
                _logger.LogWarning("Dues webhook ignored: payload has no 'data' node.");
                return;
            }
            if (!orderData.TryGetProperty("order", out var order))
            {
                _logger.LogWarning("Dues webhook ignored: payload has no 'data.order' node.");
                return;
            }

            var orderId = order.TryGetProperty("order_id", out var oid) ? oid.GetString() : null;
            var status = order.TryGetProperty("order_status", out var ost) ? ost.GetString() : null;

            if (string.IsNullOrWhiteSpace(orderId))
            {
                _logger.LogWarning("Dues webhook ignored: no order_id in payload.");
                return;
            }
            if (status != "PAID")
            {
                _logger.LogInformation("Dues webhook for order {OrderId} ignored: order_status={Status} (only PAID is acted on).", orderId, status);
                return;
            }
            // This endpoint is membership-dues only; the relay is shared with other
            // projects, so anything not carrying our order_id prefix is not ours.
            if (!orderId.StartsWith("DUES"))
            {
                _logger.LogInformation("Dues webhook for order {OrderId} ignored: not a membership-dues order_id.", orderId);
                return;
            }

            var paymentId = await ResolveDuesPaymentIdAsync(orderId);
            if (paymentId == null)
            {
                _logger.LogWarning("Dues webhook for order {OrderId} matched NO membership_dues_payments row — payment left unpaid.", orderId);
                return;
            }

            await MarkOnlineDuesPaymentPaidAsync(paymentId.Value, "Webhook", viaWebhook: true, requireActiveStatus: false);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Webhook processing failed");
        }
    }

    // Maps a Cashfree order identifier back to our payment row.
    //
    // Cashfree sends us the MERCHANT order_id ("DUES105_..."), which lives in
    // TransactionId. CfOrderId is also checked so that rows written before
    // TransactionId was persisted — and any legacy row that stored the merchant id
    // in CfOrderId — still resolve. Both columns are unique per order in practice.
    internal async Task<int?> ResolveDuesPaymentIdAsync(string cashfreeOrderId)
    {
        using var conn = GetConnection();
        return await conn.ExecuteScalarAsync<int?>(@"
            SELECT pk_id FROM membership_dues_payments
            WHERE (TransactionId=@OrderId OR CfOrderId=@OrderId) AND isdeleted=0
            ORDER BY pk_id DESC LIMIT 1",
            new { OrderId = cashfreeOrderId });
    }

    // The ONE place an online membership-dues payment flips to paid.
    //
    // Callers:
    //   • HandleWebhookAsync                                  → PaidSource='Webhook'
    //   • MembershipDuesReconciliationBackgroundService        → PaidSource='Reconciled'
    // Routing both through here keeps the receipt email, Google-Sheet append and
    // settlement refresh byte-identical regardless of which path confirmed the money.
    //
    // Idempotency: the UPDATE is guarded by IsPaid=0 (and, for the reconciler,
    // PaymentStatus='ACTIVE') and we branch on rows-affected, so a webhook and a
    // reconciler racing on the same order can never both fire the side effects.
    // Returns true only if THIS call is the one that marked the row paid.
    //
    // requireActiveStatus: the reconciler passes true so it can only ever promote a
    // row it actually selected as ACTIVE. The webhook passes false to preserve its
    // existing, broader behaviour (it must still settle rows in any pre-paid state).
    public async Task<bool> MarkOnlineDuesPaymentPaidAsync(int paymentId, string paidSource, bool viaWebhook, bool requireActiveStatus)
    {
        using var conn = GetConnection();

        var sql = @"
            UPDATE membership_dues_payments
            SET IsPaid=1, IsOnline=1, PaymentStatus='PAID', PaidSource=@PaidSource, PaymentDate=NOW()"
            + (viaWebhook ? ", IsWebhookReceived=1, WebhookReceivedDate=NOW()" : "")
            + @"
            WHERE pk_id=@Id AND IsPaid=0"
            + (requireActiveStatus ? " AND PaymentStatus='ACTIVE'" : "");

        var affected = await conn.ExecuteAsync(sql, new { Id = paymentId, PaidSource = paidSource });
        if (affected == 0)
        {
            _logger.LogInformation(
                "Dues payment {PaymentId}: no rows affected by {Source} mark-paid — already paid or no longer eligible. Nothing changed.",
                paymentId, paidSource);
            return false;
        }

        var duesId = await conn.ExecuteScalarAsync<int>(
            "SELECT fk_membership_dues_id FROM membership_dues_payments WHERE pk_id=@Id", new { Id = paymentId });

        _logger.LogInformation("Dues payment {PaymentId} (dues {DuesId}) marked PAID via {Source}.", paymentId, duesId, paidSource);

        try { await SendReceiptEmailAsync(paymentId); }
        catch (Exception ex) { _logger.LogError(ex, "Receipt email failed for dues payment {PaymentId}", paymentId); }

        _ = Task.Run(async () =>
        {
            try { await SyncGoogleSheetAsync(paymentId); }
            catch (Exception ex) { _logger.LogError(ex, "Google Sheet sync failed for dues payment {PaymentId}", paymentId); }
        });
        _ = Task.Run(async () =>
        {
            try { await RefreshSettlementsAsync(duesId); }
            catch (Exception ex) { _logger.LogError(ex, "Settlement refresh failed for dues {DuesId}", duesId); }
        });

        return true;
    }

    // ═══════════════════════════════════════════════════════════════
    //  REPORT
    // ═══════════════════════════════════════════════════════════════

    public async Task<object?> GetPublicReportAsync(int duesId)
    {
        using var conn = GetConnection();
        var dues = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT md.pk_membership_dues_id AS Id, md.Purpose, md.RotaryYear,
                   md.IsFees1, md.IsFees2, md.IsFees3, md.Fees1Text, md.Fees2Text, md.Fees3Text,
                   md.OnlineSurchargePercent,
                   md.DefaultAnnualAmount, md.DefaultSemi1Amount, md.DefaultSemi2Amount,
                   d.DistrictNumber, c.ClubName
            FROM membership_dues md
            LEFT JOIN district_master d ON md.fk_district_id = d.pk_district_id
            LEFT JOIN club_master c ON md.fk_club_id = c.pk_club_id
            WHERE md.pk_membership_dues_id=@Id AND md.isdeleted=0",
            new { Id = duesId });
        if (dues == null) return null;
        decimal surchargePercent = (decimal)dues.OnlineSurchargePercent;
        // Amount column shows each member's OWN fee amount (member-wise), read from
        // membership_dues_member_fees below — matches the pay page, mobile and admin
        // edit surfaces, so every view of a member's due finally agrees.

        // Same enriched columns as the XLSX export (online-paid for Settled,
        // payment mode, latest payment date) so the public Report Link page
        // can render the same shape as the downloaded report.
        // PERF: payments are pre-aggregated ONCE per fee (two derived tables scoped to THIS dues)
        // instead of 12 correlated subqueries per member row — a 400-member report was firing
        // ~4,800 subqueries against membership_dues_payments and timing out. `pay` pivots the
        // SUM(Amount)/SUM(online) by FeeType; `lp` pivots the latest payment mode/date by FeeType.
        var members = await conn.QueryAsync<dynamic>(@"
            SELECT f.pk_id AS FeeId, m.MemberName, f.CategoryType,
                   f.AnnualAmount AS MemberAnnualAmount, f.Semi1Amount AS MemberSemi1Amount, f.Semi2Amount AS MemberSemi2Amount,
                   COALESCE(pay.AnnualPaid, 0)       AS AnnualPaid,
                   COALESCE(pay.AnnualOnlinePaid, 0) AS AnnualOnlinePaid,
                   lp.AnnualPaymentMode              AS AnnualPaymentMode,
                   lp.AnnualPaymentDate              AS AnnualPaymentDate,
                   COALESCE(pay.Semi1Paid, 0)        AS Semi1Paid,
                   COALESCE(pay.Semi1OnlinePaid, 0)  AS Semi1OnlinePaid,
                   lp.Semi1PaymentMode               AS Semi1PaymentMode,
                   lp.Semi1PaymentDate               AS Semi1PaymentDate,
                   COALESCE(pay.Semi2Paid, 0)        AS Semi2Paid,
                   COALESCE(pay.Semi2OnlinePaid, 0)  AS Semi2OnlinePaid,
                   lp.Semi2PaymentMode               AS Semi2PaymentMode,
                   lp.Semi2PaymentDate               AS Semi2PaymentDate
            FROM membership_dues_member_fees f
            JOIN member_master_profile m ON f.fk_member_profile_id = m.pk_member_master_profile_id
            JOIN membership_dues md2 ON md2.pk_membership_dues_id = f.fk_membership_dues_id
            JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
                AND cm.fk_club_id = md2.fk_club_id
                AND cm.IsActive = 1
                AND COALESCE(cm.isdeleted, 0) = 0
                AND COALESCE(cm.IsHonoraryMember, 0) = 0
            LEFT JOIN (
                SELECT p.fk_member_fee_id AS FeeId,
                       SUM(CASE WHEN p.FeeType=1 THEN p.Amount ELSE 0 END) AS AnnualPaid,
                       SUM(CASE WHEN p.FeeType=1 AND p.IsOnline=1 THEN p.Amount ELSE 0 END) AS AnnualOnlinePaid,
                       SUM(CASE WHEN p.FeeType=2 THEN p.Amount ELSE 0 END) AS Semi1Paid,
                       SUM(CASE WHEN p.FeeType=2 AND p.IsOnline=1 THEN p.Amount ELSE 0 END) AS Semi1OnlinePaid,
                       SUM(CASE WHEN p.FeeType=3 THEN p.Amount ELSE 0 END) AS Semi2Paid,
                       SUM(CASE WHEN p.FeeType=3 AND p.IsOnline=1 THEN p.Amount ELSE 0 END) AS Semi2OnlinePaid
                FROM membership_dues_payments p
                WHERE p.IsPaid=1 AND p.isdeleted=0
                  AND p.fk_member_fee_id IN (SELECT pk_id FROM membership_dues_member_fees WHERE fk_membership_dues_id=@DuesId AND isdeleted=0)
                GROUP BY p.fk_member_fee_id
            ) pay ON pay.FeeId = f.pk_id
            LEFT JOIN (
                SELECT FeeId,
                       MAX(CASE WHEN FeeType=1 THEN Mode END)        AS AnnualPaymentMode,
                       MAX(CASE WHEN FeeType=1 THEN PaymentDate END) AS AnnualPaymentDate,
                       MAX(CASE WHEN FeeType=2 THEN Mode END)        AS Semi1PaymentMode,
                       MAX(CASE WHEN FeeType=2 THEN PaymentDate END) AS Semi1PaymentDate,
                       MAX(CASE WHEN FeeType=3 THEN Mode END)        AS Semi2PaymentMode,
                       MAX(CASE WHEN FeeType=3 THEN PaymentDate END) AS Semi2PaymentDate
                FROM (
                    SELECT p.fk_member_fee_id AS FeeId, p.FeeType, p.PaymentDate,
                           CASE
                               WHEN p.IsOnline=1 THEN 'Payment Gateway'
                               WHEN p.OfflineTransactionType = '1' THEN 'Cash'
                               WHEN p.OfflineTransactionType = '2' THEN 'Cheque'
                               WHEN p.OfflineTransactionType = '3' THEN 'NEFT'
                               WHEN p.OfflineTransactionType = '4' THEN 'UPI'
                               WHEN p.OfflineTransactionType = '5' THEN 'Other'
                               ELSE COALESCE(NULLIF(p.OfflineTransactionType,''), 'Cash')
                           END AS Mode,
                           ROW_NUMBER() OVER (PARTITION BY p.fk_member_fee_id, p.FeeType ORDER BY p.PaymentDate DESC, p.pk_id DESC) AS rn
                    FROM membership_dues_payments p
                    WHERE p.IsPaid=1 AND p.isdeleted=0
                      AND p.fk_member_fee_id IN (SELECT pk_id FROM membership_dues_member_fees WHERE fk_membership_dues_id=@DuesId AND isdeleted=0)
                ) x
                WHERE x.rn = 1
                GROUP BY FeeId
            ) lp ON lp.FeeId = f.pk_id
            WHERE f.fk_membership_dues_id=@DuesId AND f.isdeleted=0
            ORDER BY m.MemberName",
            new { DuesId = duesId });

        // Amount column always shows the ONE true (base) amount — matches
        // every other surface in the app except the SuperAdmin Vendor Splits
        // step. Settled (online payments only) separately shows the base-amount
        // portion of what was actually paid, surcharge backed back out.
        decimal? Settled(decimal onlinePaid)
            => onlinePaid > 0
                ? Math.Round(surchargePercent > 0 ? onlinePaid / (1 + surchargePercent / 100m) : onlinePaid, 0, MidpointRounding.AwayFromZero)
                : (decimal?)null;

        return new
        {
            Purpose = (string?)dues.Purpose,
            RotaryYear = (string?)dues.RotaryYear,
            DistrictNumber = (string?)dues.DistrictNumber,
            ClubName = (string?)dues.ClubName,
            IsFees1 = (bool)dues.IsFees1,
            IsFees2 = (bool)dues.IsFees2,
            IsFees3 = (bool)dues.IsFees3,
            Fees1Text = (string?)dues.Fees1Text,
            Fees2Text = (string?)dues.Fees2Text,
            Fees3Text = (string?)dues.Fees3Text,
            Members = members.Select(m => new
            {
                MemberName = (string?)m.MemberName,
                CategoryType = (string?)m.CategoryType,
                AnnualAmount  = (decimal)m.MemberAnnualAmount,
                AnnualPaid    = (decimal)m.AnnualPaid,
                AnnualSettled = Settled((decimal)m.AnnualOnlinePaid),
                AnnualPaymentMode = (string?)m.AnnualPaymentMode,
                AnnualPaymentDate = (DateTime?)m.AnnualPaymentDate,
                Semi1Amount  = (decimal)m.MemberSemi1Amount,
                Semi1Paid    = (decimal)m.Semi1Paid,
                Semi1Settled = Settled((decimal)m.Semi1OnlinePaid),
                Semi1PaymentMode = (string?)m.Semi1PaymentMode,
                Semi1PaymentDate = (DateTime?)m.Semi1PaymentDate,
                Semi2Amount  = (decimal)m.MemberSemi2Amount,
                Semi2Paid    = (decimal)m.Semi2Paid,
                Semi2Settled = Settled((decimal)m.Semi2OnlinePaid),
                Semi2PaymentMode = (string?)m.Semi2PaymentMode,
                Semi2PaymentDate = (DateTime?)m.Semi2PaymentDate
            })
        };
    }

    // ═══════════════════════════════════════════════════════════════
    //  EXPORT CSV
    // ═══════════════════════════════════════════════════════════════

    public async Task<byte[]> ExportMembersCsvAsync(int duesId)
    {
        using var conn = GetConnection();
        var dues = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT md.pk_membership_dues_id AS Id, md.Purpose, md.RotaryYear,
                   md.IsFees1, md.IsFees2, md.IsFees3, md.Fees1Text, md.Fees2Text, md.Fees3Text,
                   md.OnlineSurchargePercent,
                   md.DefaultAnnualAmount, md.DefaultSemi1Amount, md.DefaultSemi2Amount,
                   d.DistrictNumber, c.ClubName
            FROM membership_dues md
            LEFT JOIN district_master d ON md.fk_district_id = d.pk_district_id
            LEFT JOIN club_master c ON md.fk_club_id = c.pk_club_id
            WHERE md.pk_membership_dues_id=@Id AND md.isdeleted=0",
            new { Id = duesId });
        if (dues == null) throw new KeyNotFoundException("Club dues not found.");
        decimal surchargePercent = (decimal)dues.OnlineSurchargePercent;
        // Amount column shows each member's OWN fee amount (member-wise), read from
        // membership_dues_member_fees below \u2014 matches the on-screen report, pay page,
        // mobile and admin edit, so every surface agrees.

        // SQL fetches per fee type:
        //   - total Paid (any payment mode)
        //   - online Paid only (drives Settled = OnlinePaid backed out to base)
        //   - latest PaymentMode (Cash / Cheque / Payment Gateway / etc.)
        //   - latest PaymentDate (for the new Payment Date column)
        // PERF: payments are pre-aggregated ONCE per fee (two derived tables scoped to THIS dues)
        // instead of 12 correlated subqueries per member row — a 400-member report was firing
        // ~4,800 subqueries against membership_dues_payments and timing out. `pay` pivots the
        // SUM(Amount)/SUM(online) by FeeType; `lp` pivots the latest payment mode/date by FeeType.
        var members = await conn.QueryAsync<dynamic>(@"
            SELECT f.pk_id AS FeeId, m.MemberName, f.CategoryType,
                   f.AnnualAmount AS MemberAnnualAmount, f.Semi1Amount AS MemberSemi1Amount, f.Semi2Amount AS MemberSemi2Amount,
                   COALESCE(pay.AnnualPaid, 0)       AS AnnualPaid,
                   COALESCE(pay.AnnualOnlinePaid, 0) AS AnnualOnlinePaid,
                   lp.AnnualPaymentMode              AS AnnualPaymentMode,
                   lp.AnnualPaymentDate              AS AnnualPaymentDate,
                   COALESCE(pay.Semi1Paid, 0)        AS Semi1Paid,
                   COALESCE(pay.Semi1OnlinePaid, 0)  AS Semi1OnlinePaid,
                   lp.Semi1PaymentMode               AS Semi1PaymentMode,
                   lp.Semi1PaymentDate               AS Semi1PaymentDate,
                   COALESCE(pay.Semi2Paid, 0)        AS Semi2Paid,
                   COALESCE(pay.Semi2OnlinePaid, 0)  AS Semi2OnlinePaid,
                   lp.Semi2PaymentMode               AS Semi2PaymentMode,
                   lp.Semi2PaymentDate               AS Semi2PaymentDate
            FROM membership_dues_member_fees f
            JOIN member_master_profile m ON f.fk_member_profile_id = m.pk_member_master_profile_id
            JOIN membership_dues md2 ON md2.pk_membership_dues_id = f.fk_membership_dues_id
            JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
                AND cm.fk_club_id = md2.fk_club_id
                AND cm.IsActive = 1
                AND COALESCE(cm.isdeleted, 0) = 0
                AND COALESCE(cm.IsHonoraryMember, 0) = 0
            LEFT JOIN (
                SELECT p.fk_member_fee_id AS FeeId,
                       SUM(CASE WHEN p.FeeType=1 THEN p.Amount ELSE 0 END) AS AnnualPaid,
                       SUM(CASE WHEN p.FeeType=1 AND p.IsOnline=1 THEN p.Amount ELSE 0 END) AS AnnualOnlinePaid,
                       SUM(CASE WHEN p.FeeType=2 THEN p.Amount ELSE 0 END) AS Semi1Paid,
                       SUM(CASE WHEN p.FeeType=2 AND p.IsOnline=1 THEN p.Amount ELSE 0 END) AS Semi1OnlinePaid,
                       SUM(CASE WHEN p.FeeType=3 THEN p.Amount ELSE 0 END) AS Semi2Paid,
                       SUM(CASE WHEN p.FeeType=3 AND p.IsOnline=1 THEN p.Amount ELSE 0 END) AS Semi2OnlinePaid
                FROM membership_dues_payments p
                WHERE p.IsPaid=1 AND p.isdeleted=0
                  AND p.fk_member_fee_id IN (SELECT pk_id FROM membership_dues_member_fees WHERE fk_membership_dues_id=@DuesId AND isdeleted=0)
                GROUP BY p.fk_member_fee_id
            ) pay ON pay.FeeId = f.pk_id
            LEFT JOIN (
                SELECT FeeId,
                       MAX(CASE WHEN FeeType=1 THEN Mode END)        AS AnnualPaymentMode,
                       MAX(CASE WHEN FeeType=1 THEN PaymentDate END) AS AnnualPaymentDate,
                       MAX(CASE WHEN FeeType=2 THEN Mode END)        AS Semi1PaymentMode,
                       MAX(CASE WHEN FeeType=2 THEN PaymentDate END) AS Semi1PaymentDate,
                       MAX(CASE WHEN FeeType=3 THEN Mode END)        AS Semi2PaymentMode,
                       MAX(CASE WHEN FeeType=3 THEN PaymentDate END) AS Semi2PaymentDate
                FROM (
                    SELECT p.fk_member_fee_id AS FeeId, p.FeeType, p.PaymentDate,
                           CASE
                               WHEN p.IsOnline=1 THEN 'Payment Gateway'
                               WHEN p.OfflineTransactionType = '1' THEN 'Cash'
                               WHEN p.OfflineTransactionType = '2' THEN 'Cheque'
                               WHEN p.OfflineTransactionType = '3' THEN 'NEFT'
                               WHEN p.OfflineTransactionType = '4' THEN 'UPI'
                               WHEN p.OfflineTransactionType = '5' THEN 'Other'
                               ELSE COALESCE(NULLIF(p.OfflineTransactionType,''), 'Cash')
                           END AS Mode,
                           ROW_NUMBER() OVER (PARTITION BY p.fk_member_fee_id, p.FeeType ORDER BY p.PaymentDate DESC, p.pk_id DESC) AS rn
                    FROM membership_dues_payments p
                    WHERE p.IsPaid=1 AND p.isdeleted=0
                      AND p.fk_member_fee_id IN (SELECT pk_id FROM membership_dues_member_fees WHERE fk_membership_dues_id=@DuesId AND isdeleted=0)
                ) x
                WHERE x.rn = 1
                GROUP BY FeeId
            ) lp ON lp.FeeId = f.pk_id
            WHERE f.fk_membership_dues_id=@DuesId AND f.isdeleted=0
            ORDER BY m.MemberName",
            new { DuesId = duesId });

        bool isFees1 = (bool)dues.IsFees1, isFees2 = (bool)dues.IsFees2, isFees3 = (bool)dues.IsFees3;
        string fees1Text = (string?)dues.Fees1Text ?? "Annual";
        string fees2Text = (string?)dues.Fees2Text ?? "Semi-Annual 1";
        string fees3Text = (string?)dues.Fees3Text ?? "Semi-Annual 2";
        string clubName = (string?)dues.ClubName ?? "";
        string districtNumber = (string?)dues.DistrictNumber ?? "";
        string purpose = (string?)dues.Purpose ?? "";
        string rotaryYear = (string?)dues.RotaryYear ?? "";

        using var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add("Club Dues");

        // Title strip with club/district/year context so an emailed file is self-describing
        ws.Cell(1, 1).Value = $"Club Dues Report \u2014 {purpose}";
        ws.Cell(2, 1).Value = $"Club: {clubName}    District: {districtNumber}    Rotary Year: {rotaryYear}    Generated: {DateTime.Now:dd-MM-yyyy HH:mm}";

        // 5 columns per enabled fee type (Paid + Balance removed per user 2026-06-24):
        //   {Fee} Amount, Settled, Payment Mode, Payment Date, Status
        var headers = new List<string> { "Sr.No", "Member Name", "Category" };
        if (isFees1) headers.AddRange(new[] { $"{fees1Text} Amount", $"{fees1Text} Settled", $"{fees1Text} Payment Mode", $"{fees1Text} Payment Date", $"{fees1Text} Status" });
        if (isFees2) headers.AddRange(new[] { $"{fees2Text} Amount", $"{fees2Text} Settled", $"{fees2Text} Payment Mode", $"{fees2Text} Payment Date", $"{fees2Text} Status" });
        if (isFees3) headers.AddRange(new[] { $"{fees3Text} Amount", $"{fees3Text} Settled", $"{fees3Text} Payment Mode", $"{fees3Text} Payment Date", $"{fees3Text} Status" });

        // Merge + style the title strip across full width
        int colCount = headers.Count;
        ws.Range(1, 1, 1, colCount).Merge();
        ws.Cell(1, 1).Style.Font.Bold = true;
        ws.Cell(1, 1).Style.Font.FontSize = 14;
        ws.Cell(1, 1).Style.Font.FontColor = XLColor.White;
        ws.Cell(1, 1).Style.Fill.BackgroundColor = XLColor.FromHtml("#1E40AF");
        ws.Cell(1, 1).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
        ws.Row(1).Height = 28;

        ws.Range(2, 1, 2, colCount).Merge();
        ws.Cell(2, 1).Style.Font.Italic = true;
        ws.Cell(2, 1).Style.Font.FontColor = XLColor.Gray;

        // Header row (row 4)
        for (int i = 0; i < headers.Count; i++) ws.Cell(4, i + 1).Value = headers[i];
        var headerRange = ws.Range(4, 1, 4, colCount);
        headerRange.Style.Font.Bold = true;
        headerRange.Style.Font.FontColor = XLColor.White;
        headerRange.Style.Fill.BackgroundColor = XLColor.FromHtml("#3B82F6");
        headerRange.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
        headerRange.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
        headerRange.Style.Border.InsideBorder = XLBorderStyleValues.Thin;
        ws.Row(4).Height = 32;
        ws.SheetView.FreezeRows(4);

        // Pre-build cell-fill colors so we don't allocate per row
        var greenFill = XLColor.FromHtml("#C6EFCE");      // Excel-standard light green
        var greenFont = XLColor.FromHtml("#006100");      // dark green text
        var redFill   = XLColor.FromHtml("#FFC7CE");      // Excel-standard light red
        var redFont   = XLColor.FromHtml("#9C0006");      // dark red text

        int rowIdx = 5;
        int srNo = 0;
        foreach (var m in members)
        {
            srNo++;
            ws.Cell(rowIdx, 1).Value = srNo;
            ws.Cell(rowIdx, 2).Value = (string?)m.MemberName ?? "";
            ws.Cell(rowIdx, 3).Value = (string?)m.CategoryType ?? "";

            // Annual and Semi1+Semi2 are alternate payment paths for the same
            // yearly due. Once one path is fully paid, the other becomes moot
            // and is blanked out (Semi2 stays visible when only Semi1 is paid,
            // since Semi2 is still a separate outstanding installment).
            // Member-wise amounts (each member's own fee row), not the campaign default.
            decimal mAnnual = (decimal)m.MemberAnnualAmount;
            decimal mSemi1 = (decimal)m.MemberSemi1Amount;
            decimal mSemi2 = (decimal)m.MemberSemi2Amount;

            bool isAnnualPaid = isFees1 && (decimal)m.AnnualPaid > 0 && (mAnnual - (decimal)m.AnnualPaid) <= 0;
            bool isSemi1Paid = isFees2 && (decimal)m.Semi1Paid > 0 && (mSemi1 - (decimal)m.Semi1Paid) <= 0;
            bool blankAnnual = isSemi1Paid && !isAnnualPaid;
            bool blankSemis = isAnnualPaid;

            int col = 4;
            if (isFees1)
                col = WriteFeeColumns(ws, rowIdx, col,
                    baseAmount: mAnnual, surchargePercent: surchargePercent,
                    paid: (decimal)m.AnnualPaid, onlinePaid: (decimal)m.AnnualOnlinePaid,
                    paymentMode: (string?)m.AnnualPaymentMode, paymentDate: (DateTime?)m.AnnualPaymentDate,
                    greenFill, greenFont, redFill, redFont, blank: blankAnnual);
            if (isFees2)
                col = WriteFeeColumns(ws, rowIdx, col,
                    baseAmount: mSemi1, surchargePercent: surchargePercent,
                    paid: (decimal)m.Semi1Paid, onlinePaid: (decimal)m.Semi1OnlinePaid,
                    paymentMode: (string?)m.Semi1PaymentMode, paymentDate: (DateTime?)m.Semi1PaymentDate,
                    greenFill, greenFont, redFill, redFont, blank: blankSemis);
            if (isFees3)
                col = WriteFeeColumns(ws, rowIdx, col,
                    baseAmount: mSemi2, surchargePercent: surchargePercent,
                    paid: (decimal)m.Semi2Paid, onlinePaid: (decimal)m.Semi2OnlinePaid,
                    paymentMode: (string?)m.Semi2PaymentMode, paymentDate: (DateTime?)m.Semi2PaymentDate,
                    greenFill, greenFont, redFill, redFont, blank: blankSemis);

            rowIdx++;
        }

        if (rowIdx > 5)
        {
            var dataRange = ws.Range(5, 1, rowIdx - 1, colCount);
            dataRange.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
            dataRange.Style.Border.InsideBorder = XLBorderStyleValues.Thin;
            dataRange.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
        }

        ws.Columns().AdjustToContents();
        // Cap column width so a long "Payment Mode" or member intro doesn't blow out the layout
        foreach (var c in ws.Columns())
        {
            if (c.Width > 35) c.Width = 35;
        }

        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }

    // Writes the 5-column block for one fee type (Annual / Semi1 / Semi2) and
    // returns the next free column index. baseAmount is the ONE true (offline)
    // amount; the online (with-surcharge) figure is derived from it.
    // Paid + Balance dropped per user request \u2014 Amount + Status convey the same.
    private static int WriteFeeColumns(
        IXLWorksheet ws, int row, int col,
        decimal baseAmount, decimal surchargePercent,
        decimal paid, decimal onlinePaid,
        string? paymentMode, DateTime? paymentDate,
        XLColor greenFill, XLColor greenFont, XLColor redFill, XLColor redFont,
        bool blank = false)
    {
        // The other payment path was already fully settled, so this fee type
        // is moot for this member \u2014 show N/A across all 5 columns instead
        // of a (misleading) Unpaid/zero-amount block.
        if (blank)
        {
            for (int i = 0; i < 5; i++)
            {
                var cell = ws.Cell(row, col + i);
                cell.Value = "N/A";
                cell.Style.Font.FontColor = XLColor.Gray;
                cell.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            }
            return col + 5;
        }

        // Amount column always shows the ONE true (base) amount \u2014 matches
        // every other surface in the app except the SuperAdmin Vendor Splits step.
        decimal displayAmount = baseAmount;

        // Settled = the base-amount portion of what was paid online (the
        // surcharge backed back out), rounded to a whole rupee. Offline-only
        // payments leave Settled blank (no gateway cut applies).
        decimal? settled = onlinePaid > 0
            ? Math.Round(surchargePercent > 0 ? onlinePaid / (1 + surchargePercent / 100m) : onlinePaid, 0, MidpointRounding.AwayFromZero)
            : (decimal?)null;
        bool isPaid = paid > 0 && (displayAmount - paid) <= 0;

        ws.Cell(row, col).Value = displayAmount;
        ws.Cell(row, col).Style.NumberFormat.Format = "#,##0.00";
        if (settled.HasValue)
        {
            ws.Cell(row, col + 1).Value = settled.Value;
            ws.Cell(row, col + 1).Style.NumberFormat.Format = "#,##0.00";
        }
        ws.Cell(row, col + 2).Value = paymentMode ?? "";
        if (paymentDate.HasValue)
        {
            ws.Cell(row, col + 3).Value = paymentDate.Value;
            ws.Cell(row, col + 3).Style.DateFormat.Format = "dd-MM-yyyy HH:mm";
        }

        var statusCell = ws.Cell(row, col + 4);
        statusCell.Value = isPaid ? "Paid" : "Unpaid";
        statusCell.Style.Fill.BackgroundColor = isPaid ? greenFill : redFill;
        statusCell.Style.Font.FontColor       = isPaid ? greenFont : redFont;
        statusCell.Style.Font.Bold = true;
        statusCell.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;

        return col + 5;
    }

    // ═══════════════════════════════════════════════════════════════
    //  HELPERS
    // ═══════════════════════════════════════════════════════════════

    // Re-snapshots the whole paid-members sheet after a payment event. Not an append —
    // a member's own row (Amount/Settled/Status per fee type) can change as they pay
    // more fee types over time, or move from Unpaid to Paid, so the sheet body is
    // rewritten in full each time rather than growing with stale/duplicate rows.
    private async Task SyncGoogleSheetAsync(int paymentId)
    {
        using var conn = GetConnection();
        var duesId = await conn.ExecuteScalarAsync<int?>(
            "SELECT fk_membership_dues_id FROM membership_dues_payments WHERE pk_id=@Id", new { Id = paymentId });
        if (!duesId.HasValue) return;

        var dues = await GetDuesSheetConfigAsync(conn, duesId.Value);
        if (dues == null || string.IsNullOrWhiteSpace((string?)dues.GoogleSheetId)) return;

        string sheetId = (string)dues.GoogleSheetId;
        IList<IList<object>> rows = await BuildPaidMemberSheetRowsAsync(conn, duesId.Value, dues);
        await _googleSheetsService.WriteRowsAsync(sheetId, rows);
        _logger.LogInformation("Synced Google Sheet {SheetId} for dues {DuesId} after payment {PaymentId} ({Count} paid members)",
            sheetId, duesId.Value, paymentId, rows.Count);
    }

    private async Task<dynamic?> GetDuesSheetConfigAsync(MySqlConnection conn, int duesId)
        => await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pk_membership_dues_id, Purpose, GoogleSheetId, GoogleSheetEmail,
                   IsFees1, IsFees2, IsFees3, Fees1Text, Fees2Text, Fees3Text,
                   OnlineSurchargePercent, DefaultAnnualAmount, DefaultSemi1Amount, DefaultSemi2Amount
            FROM membership_dues WHERE pk_membership_dues_id=@Id AND isdeleted=0", new { Id = duesId });

    // Same 5-columns-per-fee-type shape as ExportMembersCsvAsync's XLSX ("the normal
    // report") — Amount, Settled, Payment Mode, Payment Date, Status per enabled fee type.
    private static string[] BuildMemberSheetHeaders(dynamic dues)
    {
        string fees1Text = (string?)dues.Fees1Text ?? "Annual";
        string fees2Text = (string?)dues.Fees2Text ?? "Semi-Annual 1";
        string fees3Text = (string?)dues.Fees3Text ?? "Semi-Annual 2";
        var headers = new List<string> { "Sr.No", "Member Name", "Category" };
        if ((bool)dues.IsFees1) headers.AddRange(new[] { $"{fees1Text} Amount", $"{fees1Text} Settled", $"{fees1Text} Payment Mode", $"{fees1Text} Payment Date", $"{fees1Text} Status" });
        if ((bool)dues.IsFees2) headers.AddRange(new[] { $"{fees2Text} Amount", $"{fees2Text} Settled", $"{fees2Text} Payment Mode", $"{fees2Text} Payment Date", $"{fees2Text} Status" });
        if ((bool)dues.IsFees3) headers.AddRange(new[] { $"{fees3Text} Amount", $"{fees3Text} Settled", $"{fees3Text} Payment Mode", $"{fees3Text} Payment Date", $"{fees3Text} Status" });
        return headers.ToArray();
    }

    // Mirrors WriteFeeColumns' cell values exactly (same "Annual vs Semi1+Semi2 are
    // alternate paths" business rule) so the sheet and the XLSX export never disagree.
    private static List<object> BuildFeeCells(decimal baseAmount, decimal surchargePercent,
        decimal paid, decimal onlinePaid, string? paymentMode, DateTime? paymentDate, bool blank, out bool isPaid)
    {
        if (blank)
        {
            isPaid = false;
            return new List<object> { "N/A", "N/A", "N/A", "N/A", "N/A" };
        }
        decimal? settled = onlinePaid > 0
            ? Math.Round(surchargePercent > 0 ? onlinePaid / (1 + surchargePercent / 100m) : onlinePaid, 0, MidpointRounding.AwayFromZero)
            : (decimal?)null;
        isPaid = paid > 0 && (baseAmount - paid) <= 0;
        return new List<object>
        {
            baseAmount,
            settled.HasValue ? (object)settled.Value : "",
            paymentMode ?? "",
            paymentDate.HasValue ? paymentDate.Value.ToString("dd-MM-yyyy HH:mm") : "",
            isPaid ? "Paid" : "Unpaid"
        };
    }

    // "Only the paid entries" — same per-member query as ExportMembersCsvAsync/
    // GetPublicReportAsync, but skips any member whose every applicable fee type is
    // still Unpaid, so the sheet is a live record of dues actually collected.
    private async Task<IList<IList<object>>> BuildPaidMemberSheetRowsAsync(MySqlConnection conn, int duesId, dynamic dues)
    {
        decimal surchargePercent = (decimal)dues.OnlineSurchargePercent;
        // Member-wise amounts read from membership_dues_member_fees per row below.
        bool isFees1 = (bool)dues.IsFees1, isFees2 = (bool)dues.IsFees2, isFees3 = (bool)dues.IsFees3;

        // PERF: payments are pre-aggregated ONCE per fee (two derived tables scoped to THIS dues)
        // instead of 12 correlated subqueries per member row — a 400-member report was firing
        // ~4,800 subqueries against membership_dues_payments and timing out. `pay` pivots the
        // SUM(Amount)/SUM(online) by FeeType; `lp` pivots the latest payment mode/date by FeeType.
        var members = await conn.QueryAsync<dynamic>(@"
            SELECT f.pk_id AS FeeId, m.MemberName, f.CategoryType,
                   f.AnnualAmount AS MemberAnnualAmount, f.Semi1Amount AS MemberSemi1Amount, f.Semi2Amount AS MemberSemi2Amount,
                   COALESCE(pay.AnnualPaid, 0)       AS AnnualPaid,
                   COALESCE(pay.AnnualOnlinePaid, 0) AS AnnualOnlinePaid,
                   lp.AnnualPaymentMode              AS AnnualPaymentMode,
                   lp.AnnualPaymentDate              AS AnnualPaymentDate,
                   COALESCE(pay.Semi1Paid, 0)        AS Semi1Paid,
                   COALESCE(pay.Semi1OnlinePaid, 0)  AS Semi1OnlinePaid,
                   lp.Semi1PaymentMode               AS Semi1PaymentMode,
                   lp.Semi1PaymentDate               AS Semi1PaymentDate,
                   COALESCE(pay.Semi2Paid, 0)        AS Semi2Paid,
                   COALESCE(pay.Semi2OnlinePaid, 0)  AS Semi2OnlinePaid,
                   lp.Semi2PaymentMode               AS Semi2PaymentMode,
                   lp.Semi2PaymentDate               AS Semi2PaymentDate
            FROM membership_dues_member_fees f
            JOIN member_master_profile m ON f.fk_member_profile_id = m.pk_member_master_profile_id
            JOIN membership_dues md2 ON md2.pk_membership_dues_id = f.fk_membership_dues_id
            JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
                AND cm.fk_club_id = md2.fk_club_id
                AND cm.IsActive = 1
                AND COALESCE(cm.isdeleted, 0) = 0
                AND COALESCE(cm.IsHonoraryMember, 0) = 0
            LEFT JOIN (
                SELECT p.fk_member_fee_id AS FeeId,
                       SUM(CASE WHEN p.FeeType=1 THEN p.Amount ELSE 0 END) AS AnnualPaid,
                       SUM(CASE WHEN p.FeeType=1 AND p.IsOnline=1 THEN p.Amount ELSE 0 END) AS AnnualOnlinePaid,
                       SUM(CASE WHEN p.FeeType=2 THEN p.Amount ELSE 0 END) AS Semi1Paid,
                       SUM(CASE WHEN p.FeeType=2 AND p.IsOnline=1 THEN p.Amount ELSE 0 END) AS Semi1OnlinePaid,
                       SUM(CASE WHEN p.FeeType=3 THEN p.Amount ELSE 0 END) AS Semi2Paid,
                       SUM(CASE WHEN p.FeeType=3 AND p.IsOnline=1 THEN p.Amount ELSE 0 END) AS Semi2OnlinePaid
                FROM membership_dues_payments p
                WHERE p.IsPaid=1 AND p.isdeleted=0
                  AND p.fk_member_fee_id IN (SELECT pk_id FROM membership_dues_member_fees WHERE fk_membership_dues_id=@DuesId AND isdeleted=0)
                GROUP BY p.fk_member_fee_id
            ) pay ON pay.FeeId = f.pk_id
            LEFT JOIN (
                SELECT FeeId,
                       MAX(CASE WHEN FeeType=1 THEN Mode END)        AS AnnualPaymentMode,
                       MAX(CASE WHEN FeeType=1 THEN PaymentDate END) AS AnnualPaymentDate,
                       MAX(CASE WHEN FeeType=2 THEN Mode END)        AS Semi1PaymentMode,
                       MAX(CASE WHEN FeeType=2 THEN PaymentDate END) AS Semi1PaymentDate,
                       MAX(CASE WHEN FeeType=3 THEN Mode END)        AS Semi2PaymentMode,
                       MAX(CASE WHEN FeeType=3 THEN PaymentDate END) AS Semi2PaymentDate
                FROM (
                    SELECT p.fk_member_fee_id AS FeeId, p.FeeType, p.PaymentDate,
                           CASE
                               WHEN p.IsOnline=1 THEN 'Payment Gateway'
                               WHEN p.OfflineTransactionType = '1' THEN 'Cash'
                               WHEN p.OfflineTransactionType = '2' THEN 'Cheque'
                               WHEN p.OfflineTransactionType = '3' THEN 'NEFT'
                               WHEN p.OfflineTransactionType = '4' THEN 'UPI'
                               WHEN p.OfflineTransactionType = '5' THEN 'Other'
                               ELSE COALESCE(NULLIF(p.OfflineTransactionType,''), 'Cash')
                           END AS Mode,
                           ROW_NUMBER() OVER (PARTITION BY p.fk_member_fee_id, p.FeeType ORDER BY p.PaymentDate DESC, p.pk_id DESC) AS rn
                    FROM membership_dues_payments p
                    WHERE p.IsPaid=1 AND p.isdeleted=0
                      AND p.fk_member_fee_id IN (SELECT pk_id FROM membership_dues_member_fees WHERE fk_membership_dues_id=@DuesId AND isdeleted=0)
                ) x
                WHERE x.rn = 1
                GROUP BY FeeId
            ) lp ON lp.FeeId = f.pk_id
            WHERE f.fk_membership_dues_id=@DuesId AND f.isdeleted=0
            ORDER BY m.MemberName",
            new { DuesId = duesId });

        var rows = new List<IList<object>>();
        int srNo = 0;
        foreach (var m in members)
        {
            // Member-wise amounts (each member's own fee row), not the campaign default.
            decimal mAnnual = (decimal)m.MemberAnnualAmount;
            decimal mSemi1 = (decimal)m.MemberSemi1Amount;
            decimal mSemi2 = (decimal)m.MemberSemi2Amount;

            bool isAnnualPaid = isFees1 && (decimal)m.AnnualPaid > 0 && (mAnnual - (decimal)m.AnnualPaid) <= 0;
            bool isSemi1Paid = isFees2 && (decimal)m.Semi1Paid > 0 && (mSemi1 - (decimal)m.Semi1Paid) <= 0;
            bool blankAnnual = isSemi1Paid && !isAnnualPaid;
            bool blankSemis = isAnnualPaid;

            var row = new List<object> { 0, (string?)m.MemberName ?? "", (string?)m.CategoryType ?? "" };
            bool anyPaid = false;

            if (isFees1)
            {
                row.AddRange(BuildFeeCells(mAnnual, surchargePercent, (decimal)m.AnnualPaid, (decimal)m.AnnualOnlinePaid,
                    (string?)m.AnnualPaymentMode, (DateTime?)m.AnnualPaymentDate, blankAnnual, out var p1));
                anyPaid |= p1;
            }
            if (isFees2)
            {
                row.AddRange(BuildFeeCells(mSemi1, surchargePercent, (decimal)m.Semi1Paid, (decimal)m.Semi1OnlinePaid,
                    (string?)m.Semi1PaymentMode, (DateTime?)m.Semi1PaymentDate, blankSemis, out var p2));
                anyPaid |= p2;
            }
            if (isFees3)
            {
                row.AddRange(BuildFeeCells(mSemi2, surchargePercent, (decimal)m.Semi2Paid, (decimal)m.Semi2OnlinePaid,
                    (string?)m.Semi2PaymentMode, (DateTime?)m.Semi2PaymentDate, blankSemis, out var p3));
                anyPaid |= p3;
            }

            if (!anyPaid) continue;

            srNo++;
            row[0] = srNo;
            rows.Add(row);
        }
        return rows;
    }

    private static bool IsFeeTypeInPeriod(int feeType, string? rotaryYear)
    {
        if (string.IsNullOrWhiteSpace(rotaryYear)) return true;
        var parts = rotaryYear.Split('-');
        if (parts.Length < 1 || !int.TryParse(parts[0], out var startYear)) return true;

        var semi1Start = new DateTime(startYear, 7, 1);
        var semi1End = new DateTime(startYear, 12, 31);
        var semi2Start = new DateTime(startYear + 1, 1, 1);
        var semi2End = new DateTime(startYear + 1, 6, 30);
        var now = DateTime.Now;

        return feeType switch
        {
            1 => now >= semi1Start && now <= semi2End,        // Annual: Jul 1 - Jun 30
            2 => now >= semi1Start && now <= semi1End,        // Semi1: Jul 1 - Dec 31
            3 => now >= semi2Start && now <= semi2End,        // Semi2: Jan 1 - Jun 30
            _ => false
        };
    }

    // ═══════════════════════════════════════════════════════════════
    //  SETTLEMENTS
    // ═══════════════════════════════════════════════════════════════

    public async Task RefreshSettlementsAsync(int duesId)
    {
        using var conn = GetConnection();

        // Get all paid payments with CfOrderId for this duesId
        var payments = await conn.QueryAsync<dynamic>(@"
            SELECT pk_id AS PaymentId, CfOrderId
            FROM membership_dues_payments
            WHERE fk_membership_dues_id=@DuesId AND IsPaid=1 AND CfOrderId IS NOT NULL AND CfOrderId != '' AND isdeleted=0",
            new { DuesId = duesId });

        var cf = _config.GetSection("CashfreePayment");

        foreach (var payment in payments)
        {
            string cfOrderId = (string)payment.CfOrderId;
            int paymentId = (int)payment.PaymentId;

            try
            {
                var request = new HttpRequestMessage(HttpMethod.Get, $"{cf["BaseUrl"]}orders/{cfOrderId}/settlements");
                request.Headers.Add("x-client-id", cf["ClientId"]);
                request.Headers.Add("x-client-secret", cf["ClientSecret"]);
                request.Headers.Add("x-api-version", cf["ApiVersion"]);

                var response = await _httpClient.SendAsync(request);
                var body = await response.Content.ReadAsStringAsync();

                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogWarning("Settlement API returned {StatusCode} for order {OrderId}: {Body}", response.StatusCode, cfOrderId, body);
                    continue;
                }

                var settlements = JsonSerializer.Deserialize<JsonElement>(body);

                // The response can be an array of settlement objects
                if (settlements.ValueKind == JsonValueKind.Array)
                {
                    foreach (var s in settlements.EnumerateArray())
                    {
                        var settlementId = s.TryGetProperty("cf_settlement_id", out var sid) ? sid.ToString() : null;
                        var vendorId = s.TryGetProperty("entity_id", out var vid) ? vid.ToString() : null;
                        var amount = s.TryGetProperty("order_amount", out var amt) ? amt.GetDecimal() : 0m;
                        var status = s.TryGetProperty("settlement_status", out var st) ? st.GetString() : null;
                        var utr = s.TryGetProperty("utr", out var u) ? u.GetString() : null;
                        DateTime? settlementTime = s.TryGetProperty("settlement_date", out var sd) && sd.ValueKind != JsonValueKind.Null
                            ? DateTime.TryParse(sd.GetString(), out var dt) ? dt : null : null;
                        var serviceCharge = s.TryGetProperty("service_charge", out var sc) ? sc.GetDecimal() : 0m;
                        var serviceTax = s.TryGetProperty("service_tax", out var stx) ? stx.GetDecimal() : 0m;

                        // Upsert: check if already exists
                        var existingId = await conn.ExecuteScalarAsync<int?>(@"
                            SELECT pk_id FROM membership_dues_settlements
                            WHERE fk_payment_id=@PaymentId AND CfOrderId=@CfOrderId AND VendorId=@VendorId LIMIT 1",
                            new { PaymentId = paymentId, CfOrderId = cfOrderId, VendorId = vendorId });

                        if (existingId.HasValue)
                        {
                            await conn.ExecuteAsync(@"
                                UPDATE membership_dues_settlements SET
                                    Amount=@Amount, SettlementStatus=@Status, SettlementId=@SettlementId,
                                    SettlementUtr=@Utr, SettlementTime=@SettlementTime,
                                    ServiceCharge=@ServiceCharge, ServiceTax=@ServiceTax
                                WHERE pk_id=@Id",
                                new { Amount = amount, Status = status, SettlementId = settlementId, Utr = utr,
                                      SettlementTime = settlementTime, ServiceCharge = serviceCharge, ServiceTax = serviceTax,
                                      Id = existingId.Value });
                        }
                        else
                        {
                            await conn.ExecuteAsync(@"
                                INSERT INTO membership_dues_settlements (fk_membership_dues_id, fk_payment_id, CfOrderId, VendorId,
                                    Amount, SettlementStatus, SettlementId, SettlementUtr, SettlementTime, ServiceCharge, ServiceTax)
                                VALUES (@DuesId, @PaymentId, @CfOrderId, @VendorId,
                                    @Amount, @Status, @SettlementId, @Utr, @SettlementTime, @ServiceCharge, @ServiceTax)",
                                new { DuesId = duesId, PaymentId = paymentId, CfOrderId = cfOrderId, VendorId = vendorId,
                                      Amount = amount, Status = status, SettlementId = settlementId, Utr = utr,
                                      SettlementTime = settlementTime, ServiceCharge = serviceCharge, ServiceTax = serviceTax });
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to refresh settlement for order {OrderId}", cfOrderId);
            }
        }
    }

    public async Task<object> GetSettlementReportAsync(int duesId)
    {
        using var conn = GetConnection();
        var settlements = await conn.QueryAsync<dynamic>(@"
            SELECT s.pk_id AS Id, s.CfOrderId, s.VendorId, s.Amount, s.SettlementStatus,
                   s.SettlementId, s.SettlementUtr, s.SettlementTime, s.ServiceCharge, s.ServiceTax,
                   s.created_date AS CreatedDate,
                   m.MemberName, p.FeeType, p.Amount AS PaymentAmount, p.PaidSource, p.IsWebhookReceived,
                   p.WebhookReceivedDate, p.PaymentDate, p.OrderSplitsJson,
                   k.name AS VendorName
            FROM membership_dues_settlements s
            JOIN membership_dues_payments p ON s.fk_payment_id = p.pk_id
            JOIN member_master_profile m ON p.fk_member_profile_id = m.pk_member_master_profile_id
            LEFT JOIN cashfree_kyc k ON k.vendor_id = s.VendorId
            WHERE s.fk_membership_dues_id=@DuesId
            ORDER BY s.created_date DESC",
            new { DuesId = duesId });

        return new { Settlements = settlements };
    }

    // ═══════════════════════════════════════════════════════════════
    //  PAYMENT STATUS CORRECTION  (SuperAdmin only)
    // ═══════════════════════════════════════════════════════════════

    // Reverts a member fee from Paid back to Unpaid. This is NOT a refund: no
    // money moves, no gateway call. It exists for the case where an offline
    // payment was approved against the wrong member and the recorded status has
    // to be corrected.
    //
    // "Paid" is not a column on membership_dues_member_fees — it is derived live
    // from membership_dues_payments rows with IsPaid=1 AND isdeleted=0 (per
    // FeeType). So reverting means neutralising those payment rows, exactly the
    // inverse of what ApproveRejectPaymentAsync's approve branch sets.
    //
    // The rows are NOT deleted. We use the table's own soft-delete convention
    // (isdeleted=1, same as DeleteOfflinePaymentAsync) and additionally stamp
    // PaymentStatus/OfflineStatus='Reverted' plus the reason/who/when in the
    // existing RejectionReason / RejectedBy / RejectedDate / RejectionSource
    // columns, so a reverted row is distinguishable from a plainly removed one.
    // No new column is introduced.
    public async Task<RevertDuesPaymentResultDto> RevertMemberFeePaymentAsync(int duesId, int memberFeeId, RevertDuesPaymentDto dto, int userId)
    {
        var reason = (dto.Reason ?? "").Trim();
        if (string.IsNullOrWhiteSpace(reason))
            throw new ArgumentException("A reason is required to revert a payment.");
        if (reason.Length > 500)
            throw new ArgumentException("Reason must be 500 characters or fewer.");
        if (dto.FeeType.HasValue && (dto.FeeType.Value < 1 || dto.FeeType.Value > 3))
            throw new ArgumentException("Invalid fee type.");

        using var conn = GetConnection();
        await conn.OpenAsync();

        var fee = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT f.pk_id AS MemberFeeId, f.fk_member_profile_id AS MemberId, m.MemberName
            FROM membership_dues_member_fees f
            JOIN member_master_profile m ON m.pk_member_master_profile_id = f.fk_member_profile_id
            WHERE f.pk_id = @FeeId AND f.fk_membership_dues_id = @DuesId AND f.isdeleted = 0",
            new { FeeId = memberFeeId, DuesId = duesId });
        if (fee == null) throw new KeyNotFoundException("Member fee not found for this club dues.");

        // A payment still awaiting BOD approval is not "Paid" — that flow has its
        // own Reject action and must not be short-circuited here.
        var pendingCount = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM membership_dues_payments
            WHERE fk_member_fee_id = @FeeId AND OfflineStatus = 'Pending' AND isdeleted = 0
              AND (@FeeType IS NULL OR FeeType = @FeeType)",
            new { FeeId = memberFeeId, FeeType = dto.FeeType });
        if (pendingCount > 0)
            throw new ArgumentException("This fee has an offline payment awaiting approval. Use Reject on that submission instead of reverting.");

        // Everything currently counted as Paid for this fee row.
        var paidRows = (await conn.QueryAsync<dynamic>(@"
            SELECT pk_id AS PaymentId, FeeType, Amount, IsOnline
            FROM membership_dues_payments
            WHERE fk_member_fee_id = @FeeId AND IsPaid = 1 AND isdeleted = 0
              AND (@FeeType IS NULL OR FeeType = @FeeType)
            ORDER BY FeeType, pk_id",
            new { FeeId = memberFeeId, FeeType = dto.FeeType })).ToList();

        if (paidRows.Count == 0)
            throw new ArgumentException(dto.FeeType.HasValue
                ? "This fee is not currently marked Paid — there is nothing to revert."
                : "This member is not currently marked Paid — there is nothing to revert.");

        // Online (gateway) money can't be un-collected by flipping a flag — same
        // rule DeleteOfflinePaymentAsync enforces. Reverting would only hide a
        // real, settled transaction.
        if (paidRows.Any(r => Convert.ToInt32(r.IsOnline) == 1))
            throw new ArgumentException("Cannot revert — this fee was paid through the payment gateway. Only offline-recorded payments can be reverted.");

        var paymentIds = paidRows.Select(r => (int)r.PaymentId).ToList();
        var feeTypes = paidRows.Select(r => (int)r.FeeType).Distinct().OrderBy(t => t).ToList();
        decimal revertedAmount = paidRows.Sum(r => (decimal)r.Amount);

        // One transaction so a partial revert is impossible — either every paid
        // row for this fee is neutralised or none is.
        using var tx = await conn.BeginTransactionAsync();
        try
        {
            var affected = await conn.ExecuteAsync(@"
                UPDATE membership_dues_payments
                   SET IsPaid          = 0,
                       PaymentStatus   = 'Reverted',
                       OfflineStatus   = 'Reverted',
                       RejectionReason = @Reason,
                       RejectedBy      = @UserId,
                       RejectedDate    = NOW(),
                       RejectionSource = 'admin-revert',
                       isdeleted       = 1,
                       modified_by     = @UserId,
                       modified_date   = NOW()
                 WHERE pk_id IN @Ids AND IsPaid = 1 AND isdeleted = 0",
                new { Ids = paymentIds, Reason = reason, UserId = userId }, tx);

            if (affected != paymentIds.Count)
                throw new InvalidOperationException("Payment status changed while reverting. Please reload and try again.");

            await tx.CommitAsync();
        }
        catch
        {
            await tx.RollbackAsync();
            throw;
        }

        _logger.LogWarning("Club dues {DuesId}: member fee {FeeId} reverted to Unpaid by user {UserId}. Payments [{Payments}], amount {Amount}. Reason: {Reason}",
            duesId, memberFeeId, userId, string.Join(",", paymentIds), revertedAmount, reason);

        return new RevertDuesPaymentResultDto
        {
            MemberFeeId = memberFeeId,
            MemberId = (int)fee.MemberId,
            MemberName = (string?)fee.MemberName,
            RevertedAmount = revertedAmount,
            RevertedPaymentIds = paymentIds,
            RevertedFeeTypes = feeTypes,
            Message = $"Payment reverted — {(string?)fee.MemberName ?? "member"} is now marked Unpaid. No money was refunded."
        };
    }

    private static async Task<string> SaveFileAsync(IFormFile file, int folderId, IWebHostEnvironment env, string folderPrefix = "Membershipduesdocument")
    {
        var dir = Path.Combine(env.WebRootPath, "Documents", $"{folderPrefix}{folderId}");
        Directory.CreateDirectory(dir);
        var uniqueName = $"{Guid.NewGuid():N}_{DateTime.Now:ddMMyyyyHHmmss}{Path.GetExtension(file.FileName)}";
        var filePath = Path.Combine(dir, uniqueName);
        using var stream = new FileStream(filePath, FileMode.Create);
        await file.CopyToAsync(stream);
        return $"/Documents/{folderPrefix}{folderId}/{uniqueName}";
    }
}
