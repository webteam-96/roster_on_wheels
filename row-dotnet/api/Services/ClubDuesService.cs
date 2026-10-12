using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using ClosedXML.Excel;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

// District Dues service (table: club_dues). Completely separate from MembershipDuesService —
// its own tables (club_dues*), reuses cashfree_kyc. Campaign is district-scoped; each
// club owes (unpaid, non-honorary members) x its rate, computed live. A bulk payment
// (online or offline) covers the currently-unpaid members. Only Club President /
// Secretary / Treasurer may pay (enforced in the controllers). Offline payments are
// approved by the District Treasurer via the campaign's ApproverEmail.
public class ClubDuesService : IClubDuesService
{
    private readonly string _connStr;
    private readonly IConfiguration _config;
    private readonly IEmailService _emailService;
    private readonly IInteraktService _interaktService;
    private readonly IGoogleSheetsService _googleSheetsService;
    private readonly HttpClient _httpClient;
    private readonly ILogger<ClubDuesService> _logger;

    public ClubDuesService(IConfiguration config, IEmailService emailService, IInteraktService interaktService,
        IGoogleSheetsService googleSheetsService, IHttpClientFactory httpClientFactory, ILogger<ClubDuesService> logger)
    {
        _connStr = config.GetConnectionString("DefaultConnection")!;
        _config = config;
        _emailService = emailService;
        _interaktService = interaktService;
        _googleSheetsService = googleSheetsService;
        _httpClient = httpClientFactory.CreateClient();
        _logger = logger;
    }

    private MySqlConnection GetConnection() => new(_connStr);

    // ═══════════════════════════════════════════════════════════════
    //  Campaign CRUD
    // ═══════════════════════════════════════════════════════════════

    public async Task<IEnumerable<ClubDuesListDto>> GetListAsync(int? districtId, string? search, string? year)
    {
        using var conn = GetConnection();
        var sql = @"
            SELECT cd.pk_club_dues_id AS Id, d.DistrictNumber, cd.RotaryYear, cd.Purpose,
                   cd.DefaultPerMemberRate,
                   (SELECT COUNT(*) FROM club_dues_clubs cc WHERE cc.fk_club_dues_id = cd.pk_club_dues_id AND cc.isdeleted = 0) AS ClubCount,
                   (SELECT COUNT(*) FROM club_dues_members cm WHERE cm.fk_club_dues_id = cd.pk_club_dues_id AND cm.isdeleted = 0 AND cm.IsHonorary = 0) AS MemberCount,
                   (SELECT COUNT(*) FROM club_dues_members cm WHERE cm.fk_club_dues_id = cd.pk_club_dues_id AND cm.isdeleted = 0 AND cm.IsHonorary = 0 AND cm.IsPaid = 1) AS PaidMemberCount,
                   (SELECT COALESCE(SUM(p.Amount),0) FROM club_dues_payments p WHERE p.fk_club_dues_id = cd.pk_club_dues_id AND p.IsPaid = 1 AND p.isdeleted = 0) AS CollectedAmount,
                   cd.IsActive, cd.WeblinkUrl, cd.GoogleSheetId, cd.GoogleSheetUrl, cd.created_date AS CreatedDate
            FROM club_dues cd
            LEFT JOIN district_master d ON cd.fk_district_id = d.pk_district_id
            WHERE cd.isdeleted = 0
              AND (@DistrictId IS NULL OR cd.fk_district_id = @DistrictId)
              AND (@Year IS NULL OR @Year = '' OR cd.RotaryYear = @Year)
              AND (@Search IS NULL OR @Search = '' OR cd.Purpose LIKE CONCAT('%',@Search,'%') OR d.DistrictNumber LIKE CONCAT('%',@Search,'%'))
            ORDER BY cd.created_date DESC";
        var rows = (await conn.QueryAsync<ClubDuesListDto>(sql, new { DistrictId = districtId, Year = year, Search = search })).ToList();
        foreach (var r in rows) r.UnpaidMemberCount = r.MemberCount - r.PaidMemberCount;
        return rows;
    }

    public async Task<ClubDuesDetailDto?> GetDetailAsync(int duesId)
    {
        using var conn = GetConnection();
        var dto = await conn.QueryFirstOrDefaultAsync<ClubDuesDetailDto>(@"
            SELECT pk_club_dues_id AS Id, fk_district_id AS FkDistrictId, RotaryYear, Purpose, PurposeDescription,
                   PurposeLogo, BackgroundImage, DefaultPerMemberRate, AmountType, DefaultPercentage, OnlineSurchargePercent,
                   RateModel, OnlinePerMemberRate, OfflinePerMemberRate,
                   ModeOfPayment, IsShowBankInReceipt, OfflineBankName, OfflineAccountNumber, OfflineIfscCode,
                   ApproverEmail, EmailHeaderLogo, EmailCC, EmailSubject, EmailBody, EmailReminderSubject,
                   EmailReminderBody, ReminderButtonText, GoogleSheetId, GoogleSheetEmail
            FROM club_dues WHERE pk_club_dues_id = @Id AND isdeleted = 0", new { Id = duesId });
        if (dto == null) return null;
        // Both online (IsOnline=1) and offline (IsOnline=0) rows come back together — the frontend
        // buckets by IsOnline; for legacy campaigns every row is IsOnline=1.
        dto.Vendors = (await conn.QueryAsync<ClubDuesVendorDto>(@"
            SELECT v.pk_club_dues_vendor_id AS Id, v.fk_route_account_id AS FkRouteAccountId, v.AccountId, ra.Name AS AccountName,
                   v.SplitAmount, v.SplitPercentage, v.IsDefault, v.IsSelf, v.IsOnline
            FROM club_dues_vendors v
            LEFT JOIN razorpay_route_accounts ra ON v.fk_route_account_id = ra.pk_id
            WHERE v.fk_club_dues_id = @Id AND v.isdeleted = 0", new { Id = duesId })).ToList();
        return dto;
    }

    public async Task<int> CreateAsync(CreateClubDuesDto dto, IFormFile? logo, IFormFile? bgImage, IFormFile? emailLogo, int userId, IWebHostEnvironment env)
    {
        using var conn = GetConnection();

        // Only one active District Dues campaign per district + rotary year.
        var dup = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM club_dues WHERE fk_district_id=@D AND RotaryYear=@Y AND isdeleted=0",
            new { D = dto.FkDistrictId, Y = dto.RotaryYear });
        if (dup > 0)
            throw new InvalidOperationException("A District Dues campaign already exists for this district and rotary year.");

        var logoPath = logo != null ? await SaveFileAsync(logo, env) : dto.PurposeLogo;
        var bgPath = bgImage != null ? await SaveFileAsync(bgImage, env) : dto.BackgroundImage;
        var emailLogoPath = emailLogo != null ? await SaveFileAsync(emailLogo, env) : dto.EmailHeaderLogo;

        var duesId = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO club_dues (fk_district_id, RotaryYear, Purpose, PurposeDescription, PurposeLogo, BackgroundImage,
                DefaultPerMemberRate, AmountType, DefaultPercentage, OnlineSurchargePercent, RateModel, OnlinePerMemberRate, OfflinePerMemberRate,
                ModeOfPayment, IsShowBankInReceipt,
                OfflineBankName, OfflineAccountNumber, OfflineIfscCode, ApproverEmail, EmailHeaderLogo,
                EmailCC, EmailSubject, EmailBody, EmailReminderSubject, EmailReminderBody, ReminderButtonText,
                GoogleSheetId, GoogleSheetEmail, IsActive, created_by, created_date)
            VALUES (@FkDistrictId, @RotaryYear, @Purpose, @PurposeDescription, @Logo, @Bg,
                @DefaultPerMemberRate, @AmountType, @DefaultPercentage, @OnlineSurchargePercent, @RateModel, @OnlinePerMemberRate, @OfflinePerMemberRate,
                @ModeOfPayment, @IsShowBankInReceipt,
                @OfflineBankName, @OfflineAccountNumber, @OfflineIfscCode, @ApproverEmail, @EmailLogo,
                @EmailCC, @EmailSubject, @EmailBody, @EmailReminderSubject, @EmailReminderBody, @ReminderButtonText,
                @GoogleSheetId, @GoogleSheetEmail, 1, @UserId, NOW());
            SELECT LAST_INSERT_ID();",
            new
            {
                dto.FkDistrictId, dto.RotaryYear, dto.Purpose, dto.PurposeDescription, Logo = logoPath, Bg = bgPath,
                dto.DefaultPerMemberRate, dto.AmountType, dto.DefaultPercentage, dto.OnlineSurchargePercent,
                dto.RateModel, dto.OnlinePerMemberRate, dto.OfflinePerMemberRate,
                dto.ModeOfPayment, dto.IsShowBankInReceipt,
                dto.OfflineBankName, dto.OfflineAccountNumber, dto.OfflineIfscCode, dto.ApproverEmail, EmailLogo = emailLogoPath,
                dto.EmailCC, dto.EmailSubject, dto.EmailBody, dto.EmailReminderSubject, dto.EmailReminderBody, dto.ReminderButtonText,
                dto.GoogleSheetId, dto.GoogleSheetEmail, UserId = userId
            });

        bool independent = dto.RateModel == 1;
        decimal onlineSaveRate = independent ? dto.OnlinePerMemberRate : dto.DefaultPerMemberRate;
        await SaveVendorsAsync(conn, duesId, dto.VendorsJson, userId, onlineSaveRate, isOnline: true);
        if (independent)
            await SaveVendorsAsync(conn, duesId, dto.OfflineVendorsJson, userId, dto.OfflinePerMemberRate, isOnline: false);
        await SyncClubsAndMembersInternalAsync(conn, duesId, userId, dto.ClubOverridesJson);
        return duesId;
    }

    public async Task UpdateAsync(int duesId, CreateClubDuesDto dto, IFormFile? logo, IFormFile? bgImage, IFormFile? emailLogo, int userId, IWebHostEnvironment env)
    {
        using var conn = GetConnection();
        var logoPath = logo != null ? await SaveFileAsync(logo, env) : dto.PurposeLogo;
        var bgPath = bgImage != null ? await SaveFileAsync(bgImage, env) : dto.BackgroundImage;
        var emailLogoPath = emailLogo != null ? await SaveFileAsync(emailLogo, env) : dto.EmailHeaderLogo;

        // Capture the pre-update campaign rates so a rate change made here (Payment & Split is
        // editable at any time, not just at creation) can cascade to clubs still on the OLD default —
        // club_dues_clubs snapshots a rate at sync time rather than resolving it live, so without this
        // an admin-edited rate would silently stop applying to already-synced clubs. Clubs explicitly
        // customized away from the old default (Club List step / Clubs page) are left untouched.
        var oldRates = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT DefaultPerMemberRate, OnlinePerMemberRate, OfflinePerMemberRate FROM club_dues WHERE pk_club_dues_id=@Id AND isdeleted=0", new { Id = duesId });

        await conn.ExecuteAsync(@"
            UPDATE club_dues SET Purpose=@Purpose, PurposeDescription=@PurposeDescription,
                PurposeLogo=COALESCE(@Logo,PurposeLogo), BackgroundImage=COALESCE(@Bg,BackgroundImage),
                DefaultPerMemberRate=@DefaultPerMemberRate, AmountType=@AmountType, DefaultPercentage=@DefaultPercentage,
                OnlineSurchargePercent=@OnlineSurchargePercent, OnlinePerMemberRate=@OnlinePerMemberRate, OfflinePerMemberRate=@OfflinePerMemberRate,
                ModeOfPayment=@ModeOfPayment, IsShowBankInReceipt=@IsShowBankInReceipt,
                OfflineBankName=@OfflineBankName, OfflineAccountNumber=@OfflineAccountNumber, OfflineIfscCode=@OfflineIfscCode,
                ApproverEmail=@ApproverEmail, EmailHeaderLogo=COALESCE(@EmailLogo,EmailHeaderLogo),
                EmailCC=@EmailCC, EmailSubject=@EmailSubject, EmailBody=@EmailBody,
                EmailReminderSubject=@EmailReminderSubject, EmailReminderBody=@EmailReminderBody, ReminderButtonText=@ReminderButtonText,
                GoogleSheetEmail=@GoogleSheetEmail,
                modified_by=@UserId, modified_date=NOW()
            WHERE pk_club_dues_id=@Id AND isdeleted=0",
            new
            {
                dto.Purpose, dto.PurposeDescription, Logo = logoPath, Bg = bgPath,
                dto.DefaultPerMemberRate, dto.AmountType, dto.DefaultPercentage, dto.OnlineSurchargePercent,
                dto.OnlinePerMemberRate, dto.OfflinePerMemberRate,
                dto.ModeOfPayment, dto.IsShowBankInReceipt,
                dto.OfflineBankName, dto.OfflineAccountNumber, dto.OfflineIfscCode, dto.ApproverEmail, EmailLogo = emailLogoPath,
                dto.EmailCC, dto.EmailSubject, dto.EmailBody, dto.EmailReminderSubject, dto.EmailReminderBody, dto.ReminderButtonText,
                dto.GoogleSheetEmail, UserId = userId, Id = duesId
            });

        // Determine RateModel from the existing (immutable) row rather than trusting the submitted dto.
        var rateModel = await conn.ExecuteScalarAsync<int>("SELECT RateModel FROM club_dues WHERE pk_club_dues_id=@Id", new { Id = duesId });
        bool independent = rateModel == 1;

        if (oldRates != null)
        {
            if (independent)
            {
                if ((decimal)oldRates.OnlinePerMemberRate != dto.OnlinePerMemberRate)
                    await conn.ExecuteAsync(
                        "UPDATE club_dues_clubs SET OnlinePerMemberRate=@New WHERE fk_club_dues_id=@Id AND OnlinePerMemberRate=@Old AND isdeleted=0",
                        new { New = dto.OnlinePerMemberRate, Old = (decimal)oldRates.OnlinePerMemberRate, Id = duesId });
                if ((decimal)oldRates.OfflinePerMemberRate != dto.OfflinePerMemberRate)
                    await conn.ExecuteAsync(
                        "UPDATE club_dues_clubs SET OfflinePerMemberRate=@New WHERE fk_club_dues_id=@Id AND OfflinePerMemberRate=@Old AND isdeleted=0",
                        new { New = dto.OfflinePerMemberRate, Old = (decimal)oldRates.OfflinePerMemberRate, Id = duesId });
            }
            else if ((decimal)oldRates.DefaultPerMemberRate != dto.DefaultPerMemberRate)
            {
                await conn.ExecuteAsync(
                    "UPDATE club_dues_clubs SET PerMemberRate=@New WHERE fk_club_dues_id=@Id AND PerMemberRate=@Old AND isdeleted=0",
                    new { New = dto.DefaultPerMemberRate, Old = (decimal)oldRates.DefaultPerMemberRate, Id = duesId });
                // Legacy: club_dues_members.Rate is a per-member snapshot too — refresh it for still-unpaid
                // members of clubs that just picked up the cascaded rate (mirrors UpdateClubRateAsync).
                await conn.ExecuteAsync(@"
                    UPDATE club_dues_members m
                    JOIN club_dues_clubs cc ON cc.fk_club_dues_id=m.fk_club_dues_id AND cc.fk_club_id=m.fk_club_id
                    SET m.Rate=@New
                    WHERE m.fk_club_dues_id=@Id AND m.IsPaid=0 AND m.isdeleted=0 AND cc.PerMemberRate=@New",
                    new { New = dto.DefaultPerMemberRate, Id = duesId });
            }
        }

        // Replace vendors (scoped per channel so saving one never wipes the other), refresh clubs/members + per-club rate/split overrides.
        await conn.ExecuteAsync("UPDATE club_dues_vendors SET isdeleted=1 WHERE fk_club_dues_id=@Id AND IsOnline=1", new { Id = duesId });
        decimal onlineSaveRate = independent ? dto.OnlinePerMemberRate : dto.DefaultPerMemberRate;
        await SaveVendorsAsync(conn, duesId, dto.VendorsJson, userId, onlineSaveRate, isOnline: true);
        if (independent)
        {
            await conn.ExecuteAsync("UPDATE club_dues_vendors SET isdeleted=1 WHERE fk_club_dues_id=@Id AND IsOnline=0", new { Id = duesId });
            await SaveVendorsAsync(conn, duesId, dto.OfflineVendorsJson, userId, dto.OfflinePerMemberRate, isOnline: false);
        }
        await SyncClubsAndMembersInternalAsync(conn, duesId, userId, dto.ClubOverridesJson);

        // ModeOfPayment (offline on/off) may have just changed — the sheet's column shape
        // depends on it, so refresh immediately rather than waiting for the next payment event.
        await SyncGoogleSheetIfEnabledAsync(duesId);
    }

    public async Task DeleteAsync(int duesId, int userId)
    {
        using var conn = GetConnection();
        await conn.ExecuteAsync("UPDATE club_dues SET isdeleted=1, modified_by=@UserId, modified_date=NOW() WHERE pk_club_dues_id=@Id",
            new { Id = duesId, UserId = userId });
    }

    // District-admin content-only edit. Touches ONLY branding logos + email copy — never
    // amounts, dates, approver, vendor splits, clubs or members. A null uploaded file /
    // string leaves the existing logo intact (COALESCE); email fields are always written.
    public async Task UpdateContentAsync(int duesId, UpdateClubDuesContentDto dto, IFormFile? logo, IFormFile? bgImage, IFormFile? emailLogo, int userId, IWebHostEnvironment env)
    {
        using var conn = GetConnection();
        var logoPath = logo != null ? await SaveFileAsync(logo, env) : dto.PurposeLogo;
        var bgPath = bgImage != null ? await SaveFileAsync(bgImage, env) : dto.BackgroundImage;
        var emailLogoPath = emailLogo != null ? await SaveFileAsync(emailLogo, env) : dto.EmailHeaderLogo;
        await conn.ExecuteAsync(@"
            UPDATE club_dues SET
                PurposeLogo=COALESCE(@Logo,PurposeLogo), BackgroundImage=COALESCE(@Bg,BackgroundImage),
                EmailHeaderLogo=COALESCE(@EmailLogo,EmailHeaderLogo),
                EmailCC=@EmailCC, EmailSubject=@EmailSubject, EmailBody=@EmailBody,
                EmailReminderSubject=@EmailReminderSubject, EmailReminderBody=@EmailReminderBody, ReminderButtonText=@ReminderButtonText,
                modified_by=@UserId, modified_date=NOW()
            WHERE pk_club_dues_id=@Id AND isdeleted=0",
            new
            {
                Logo = logoPath, Bg = bgPath, EmailLogo = emailLogoPath,
                dto.EmailCC, dto.EmailSubject, dto.EmailBody, dto.EmailReminderSubject, dto.EmailReminderBody, dto.ReminderButtonText,
                UserId = userId, Id = duesId
            });
    }

    public async Task ToggleActiveAsync(int duesId, int userId)
    {
        using var conn = GetConnection();
        await conn.ExecuteAsync("UPDATE club_dues SET IsActive = 1 - IsActive, modified_by=@UserId, modified_date=NOW() WHERE pk_club_dues_id=@Id",
            new { Id = duesId, UserId = userId });
    }

    // The one Route account every District Dues campaign's ONLINE split must always include, at a
    // fixed percentage (system_settings: ClubDuesPlatformFeeRouteAccountId / ClubDuesPlatformFeePercent).
    // Returns (null, null, 0) when unconfigured or the account isn't active — callers then leave
    // whatever was submitted untouched rather than silently failing.
    private async Task<(int? id, string? accountId, decimal percent)> ResolvePlatformFeeAccountAsync(MySqlConnection conn)
    {
        var raw = await conn.ExecuteScalarAsync<string?>(
            "SELECT SettingValue FROM system_settings WHERE SettingKey = 'ClubDuesPlatformFeeRouteAccountId' LIMIT 1");
        if (!int.TryParse(raw, out var id) || id <= 0) return (null, null, 0);
        var accountId = await conn.ExecuteScalarAsync<string?>(
            "SELECT AccountId FROM razorpay_route_accounts WHERE pk_id=@Id AND IsActive=1 AND isdeleted=0 LIMIT 1", new { Id = id });
        if (string.IsNullOrWhiteSpace(accountId)) return (null, null, 0);
        var pctRaw = await conn.ExecuteScalarAsync<string?>(
            "SELECT SettingValue FROM system_settings WHERE SettingKey = 'ClubDuesPlatformFeePercent' LIMIT 1");
        if (!decimal.TryParse(pctRaw, out var pct) || pct <= 0) pct = 2.95m;
        return (id, accountId, pct);
    }

    // Ensures the platform-fee account is present at its fixed percentage, scaling the caller's
    // other rows down proportionally so the whole set still sums to 100%. Keeps SplitAmount in
    // sync with SplitPercentage x rate for every row (SplitPercentage is what actually drives
    // Razorpay Route transfers — see CreatePaymentOrderAsync — but SplitAmount must stay correct
    // too since it's what the SuperAdmin sees when the Split UI is in "Amount" mode).
    private async Task<List<ClubDuesVendorDto>> ApplyPlatformFeeAsync(MySqlConnection conn, List<ClubDuesVendorDto> vendors, decimal rate)
    {
        var (platformId, platformAccountId, platformPct) = await ResolvePlatformFeeAccountAsync(conn);
        if (!platformId.HasValue) return vendors;

        var others = vendors.Where(v => v.FkRouteAccountId != platformId.Value).ToList();
        decimal otherTotalPct = others.Sum(v => v.SplitPercentage);
        decimal scale = otherTotalPct > 0 ? (100m - platformPct) / otherTotalPct : 0;
        foreach (var v in others)
        {
            v.SplitPercentage = Math.Round(v.SplitPercentage * scale, 2, MidpointRounding.AwayFromZero);
            v.SplitAmount = Math.Round(rate * v.SplitPercentage / 100m, 2, MidpointRounding.AwayFromZero);
        }
        others.Add(new ClubDuesVendorDto
        {
            FkRouteAccountId = platformId.Value,
            AccountId = platformAccountId!,
            SplitPercentage = platformPct,
            SplitAmount = Math.Round(rate * platformPct / 100m, 2, MidpointRounding.AwayFromZero),
        });
        return others;
    }

    private async Task SaveVendorsAsync(MySqlConnection conn, int duesId, string? vendorsJson, int userId, decimal rate, bool isOnline)
    {
        List<ClubDuesVendorDto> vendors = new();
        if (!string.IsNullOrWhiteSpace(vendorsJson))
        {
            try { vendors = JsonSerializer.Deserialize<List<ClubDuesVendorDto>>(vendorsJson, new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new(); }
            catch { vendors = new(); }
        }
        // The platform-fee (gateway commission) account only ever belongs on the ONLINE split — offline
        // payments never touch Razorpay, so an independent-mode offline split stays a clean 100%.
        if (isOnline) vendors = await ApplyPlatformFeeAsync(conn, vendors, rate);
        foreach (var v in vendors)
        {
            await conn.ExecuteAsync(@"
                INSERT INTO club_dues_vendors (fk_club_dues_id, fk_route_account_id, AccountId, SplitAmount, SplitPercentage, IsDefault, IsSelf, IsOnline, created_by, created_date)
                VALUES (@DuesId, @FkRouteAccountId, @AccountId, @SplitAmount, @SplitPercentage, @IsDefault, @IsSelf, @IsOnline, @UserId, NOW())",
                new { DuesId = duesId, v.FkRouteAccountId, v.AccountId, v.SplitAmount, v.SplitPercentage, v.IsDefault, v.IsSelf, IsOnline = isOnline, UserId = userId });
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  Clubs + members — LIVE per-member sync
    // ═══════════════════════════════════════════════════════════════

    public async Task SyncClubsAndMembersAsync(int duesId, int userId)
    {
        using var conn = GetConnection();
        await SyncClubsAndMembersInternalAsync(conn, duesId, userId, null);
    }

    // Parses one club-override vendor array (either the legacy "vendors" key or the independent-mode
    // "onlineVendors"/"offlineVendors" keys) into vendor DTOs.
    private static List<ClubDuesVendorDto> ParseVendorArray(JsonElement arr)
    {
        var list = new List<ClubDuesVendorDto>();
        foreach (var v in arr.EnumerateArray())
            list.Add(new ClubDuesVendorDto
            {
                FkRouteAccountId = v.TryGetProperty("fkRouteAccountId", out var fr) ? fr.GetInt32() : 0,
                AccountId = v.TryGetProperty("accountId", out var ai) ? (ai.GetString() ?? "") : "",
                SplitPercentage = v.TryGetProperty("splitPercentage", out var sp) ? sp.GetDecimal() : 0,
                SplitAmount = v.TryGetProperty("splitAmount", out var sa) ? sa.GetDecimal() : 0,
            });
        return list;
    }

    // Idempotent: ensures a club_dues_clubs row per club in the district and a
    // club_dues_members row per current member (IsHonorary flagged, excluded from billing).
    // New members show up unpaid; honorary flag refreshed each run.
    private async Task SyncClubsAndMembersInternalAsync(MySqlConnection conn, int duesId, int userId, string? clubOverridesJson)
    {
        var dues = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT fk_district_id, DefaultPerMemberRate, RateModel, OnlinePerMemberRate, OfflinePerMemberRate FROM club_dues WHERE pk_club_dues_id=@Id AND isdeleted=0", new { Id = duesId });
        if (dues == null) return;
        int districtId = (int)dues.fk_district_id;
        bool independent = Convert.ToInt32(dues.RateModel) == 1;
        decimal defaultRate = (decimal)dues.DefaultPerMemberRate;                // legacy
        decimal defaultOnlineRate = (decimal)dues.OnlinePerMemberRate;           // independent
        decimal defaultOfflineRate = (decimal)dues.OfflinePerMemberRate;         // independent

        // Per-club rate + vendor-split overrides from the create/edit wizard's Club List step.
        // LEGACY row shape: {fkClubId, perMemberRate, vendors}.
        // INDEPENDENT row shape: {fkClubId, onlinePerMemberRate, offlinePerMemberRate, onlineVendors, offlineVendors}.
        var overrides = new Dictionary<int, decimal>();
        var vendorOverrides = new Dictionary<int, List<ClubDuesVendorDto>>();
        var onlineRateOverrides = new Dictionary<int, decimal>();
        var offlineRateOverrides = new Dictionary<int, decimal>();
        var onlineVendorOverrides = new Dictionary<int, List<ClubDuesVendorDto>>();
        var offlineVendorOverrides = new Dictionary<int, List<ClubDuesVendorDto>>();
        if (!string.IsNullOrWhiteSpace(clubOverridesJson))
        {
            try
            {
                using var doc = JsonDocument.Parse(clubOverridesJson);
                foreach (var el in doc.RootElement.EnumerateArray())
                {
                    int cid = el.GetProperty("fkClubId").GetInt32();
                    if (independent)
                    {
                        onlineRateOverrides[cid] = el.TryGetProperty("onlinePerMemberRate", out var opr) ? opr.GetDecimal() : defaultOnlineRate;
                        offlineRateOverrides[cid] = el.TryGetProperty("offlinePerMemberRate", out var ofpr) ? ofpr.GetDecimal() : defaultOfflineRate;
                        if (el.TryGetProperty("onlineVendors", out var ovArr) && ovArr.ValueKind == JsonValueKind.Array)
                            onlineVendorOverrides[cid] = ParseVendorArray(ovArr);
                        if (el.TryGetProperty("offlineVendors", out var fvArr) && fvArr.ValueKind == JsonValueKind.Array)
                            offlineVendorOverrides[cid] = ParseVendorArray(fvArr);
                    }
                    else
                    {
                        decimal rate = el.TryGetProperty("perMemberRate", out var pr) ? pr.GetDecimal() : defaultRate;
                        overrides[cid] = rate;
                        if (el.TryGetProperty("vendors", out var vArr) && vArr.ValueKind == JsonValueKind.Array)
                            vendorOverrides[cid] = ParseVendorArray(vArr);
                    }
                }
            }
            catch { /* ignore malformed overrides */ }
        }

        // 1) Ensure a club_dues_clubs row for every club in the district (sync + non-sync).
        var clubs = (await conn.QueryAsync<dynamic>(@"
            SELECT pk_club_id AS ClubId FROM club_master WHERE fk_district_id=@DistrictId AND isdeleted=0",
            new { DistrictId = districtId })).ToList();
        foreach (var c in clubs)
        {
            int clubId = (int)c.ClubId;
            decimal rate = overrides.TryGetValue(clubId, out var r) ? r : defaultRate;
            decimal onlineRate = onlineRateOverrides.TryGetValue(clubId, out var orr) ? orr : defaultOnlineRate;
            decimal offlineRate = offlineRateOverrides.TryGetValue(clubId, out var ofr) ? ofr : defaultOfflineRate;
            var existing = await conn.ExecuteScalarAsync<int?>(
                "SELECT pk_club_dues_club_id FROM club_dues_clubs WHERE fk_club_dues_id=@DuesId AND fk_club_id=@ClubId AND isdeleted=0",
                new { DuesId = duesId, ClubId = clubId });
            if (existing == null)
            {
                await conn.ExecuteAsync(@"
                    INSERT INTO club_dues_clubs (fk_club_dues_id, fk_club_id, PerMemberRate, OnlinePerMemberRate, OfflinePerMemberRate, created_by, created_date)
                    VALUES (@DuesId, @ClubId, @Rate, @OnlineRate, @OfflineRate, @UserId, NOW())",
                    new { DuesId = duesId, ClubId = clubId, Rate = rate, OnlineRate = onlineRate, OfflineRate = offlineRate, UserId = userId });
            }
            else if (overrides.ContainsKey(clubId) || onlineRateOverrides.ContainsKey(clubId) || offlineRateOverrides.ContainsKey(clubId))
            {
                await conn.ExecuteAsync(
                    "UPDATE club_dues_clubs SET PerMemberRate=@Rate, OnlinePerMemberRate=@OnlineRate, OfflinePerMemberRate=@OfflineRate, modified_by=@UserId, modified_date=NOW() WHERE pk_club_dues_club_id=@Id",
                    new { Rate = rate, OnlineRate = onlineRate, OfflineRate = offlineRate, UserId = userId, Id = existing.Value });
            }
        }

        // 1b) Apply per-club vendor-split overrides (now that the club_dues_clubs rows exist).
        if (independent)
        {
            foreach (var kv in onlineVendorOverrides)
            {
                decimal clubOnlineRate = onlineRateOverrides.TryGetValue(kv.Key, out var cr) ? cr : defaultOnlineRate;
                var vendorsWithFee = await ApplyPlatformFeeAsync(conn, kv.Value, clubOnlineRate);
                await SaveClubVendorsInternalAsync(conn, duesId, kv.Key, vendorsWithFee, isOnline: true);
            }
            foreach (var kv in offlineVendorOverrides)
                await SaveClubVendorsInternalAsync(conn, duesId, kv.Key, kv.Value, isOnline: false); // no platform fee on the offline track
        }
        else
        {
            foreach (var kv in vendorOverrides)
            {
                decimal clubRate = overrides.TryGetValue(kv.Key, out var cr) ? cr : defaultRate;
                var vendorsWithFee = await ApplyPlatformFeeAsync(conn, kv.Value, clubRate);
                await SaveClubVendorsInternalAsync(conn, duesId, kv.Key, vendorsWithFee, isOnline: true);
            }
        }

        // 2) Ensure a club_dues_members row per current active member of each club.
        //    Excludes deleted; flags honorary. Uses the club's current rate for new rows.
        await conn.ExecuteAsync(@"
            INSERT INTO club_dues_members (fk_club_dues_id, fk_club_id, fk_member_profile_id, IsHonorary, Rate, IsPaid, created_date)
            SELECT @DuesId, cm.fk_club_id, cm.fk_member_master_profile_id,
                   COALESCE(cm.IsHonoraryMember,0),
                   (SELECT PerMemberRate FROM club_dues_clubs cc WHERE cc.fk_club_dues_id=@DuesId AND cc.fk_club_id=cm.fk_club_id AND cc.isdeleted=0 LIMIT 1),
                   0, NOW()
            FROM club_members cm
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.fk_district_id=@DistrictId AND c.isdeleted=0
            WHERE cm.isdeleted = 0
              AND NOT EXISTS (
                SELECT 1 FROM club_dues_members x
                WHERE x.fk_club_dues_id=@DuesId AND x.fk_club_id=cm.fk_club_id
                  AND x.fk_member_profile_id=cm.fk_member_master_profile_id AND x.isdeleted=0)",
            new { DuesId = duesId, DistrictId = districtId });

        // 3) Refresh honorary flag (a member may have become honorary since).
        await conn.ExecuteAsync(@"
            UPDATE club_dues_members x
            JOIN club_members cm ON cm.fk_club_id = x.fk_club_id AND cm.fk_member_master_profile_id = x.fk_member_profile_id AND cm.isdeleted = 0
            SET x.IsHonorary = COALESCE(cm.IsHonoraryMember,0)
            WHERE x.fk_club_dues_id=@DuesId AND x.isdeleted=0", new { DuesId = duesId });

        // 4) Refresh cached counts on club rows (display only).
        await conn.ExecuteAsync(@"
            UPDATE club_dues_clubs cc SET
                MemberCountCached = (SELECT COUNT(*) FROM club_dues_members m WHERE m.fk_club_dues_id=cc.fk_club_dues_id AND m.fk_club_id=cc.fk_club_id AND m.isdeleted=0 AND m.IsHonorary=0),
                PaidMemberCountCached = (SELECT COUNT(*) FROM club_dues_members m WHERE m.fk_club_dues_id=cc.fk_club_dues_id AND m.fk_club_id=cc.fk_club_id AND m.isdeleted=0 AND m.IsHonorary=0 AND m.IsPaid=1)
            WHERE cc.fk_club_dues_id=@DuesId AND cc.isdeleted=0", new { DuesId = duesId });
    }

    public async Task<IEnumerable<ClubDuesClubListDto>> GetClubsAsync(int duesId, string? search, bool includeNonSynced)
    {
        using var conn = GetConnection();
        // Always refresh so counts are live before display.
        await SyncClubsAndMembersInternalAsync(conn, duesId, 0, null);
        var campaign = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT RateModel, OnlineSurchargePercent FROM club_dues WHERE pk_club_dues_id=@Id AND isdeleted=0", new { Id = duesId });
        bool independent = campaign != null && Convert.ToInt32(campaign.RateModel) == 1;
        decimal surcharge = campaign != null ? (decimal)campaign.OnlineSurchargePercent : 0;

        var sql = @"
            SELECT cc.pk_club_dues_club_id AS ClubDuesClubId, cc.fk_club_id AS FkClubId, c.ClubName,
                   COALESCE(c.IsSyncedFromRotaryOrg,0) AS IsSyncedFromRotaryOrg, cc.PerMemberRate,
                   cc.OnlinePerMemberRate, cc.OfflinePerMemberRate,
                   (SELECT COUNT(*) FROM club_dues_members m WHERE m.fk_club_dues_id=cc.fk_club_dues_id AND m.fk_club_id=cc.fk_club_id AND m.isdeleted=0 AND m.IsHonorary=0) AS MemberCount,
                   (SELECT COUNT(*) FROM club_dues_members m WHERE m.fk_club_dues_id=cc.fk_club_dues_id AND m.fk_club_id=cc.fk_club_id AND m.isdeleted=0 AND m.IsHonorary=0 AND m.IsPaid=1) AS PaidCount,
                   (SELECT COALESCE(SUM(p.Amount),0) FROM club_dues_payments p WHERE p.fk_club_dues_id=cc.fk_club_dues_id AND p.fk_club_id=cc.fk_club_id AND p.IsPaid=1 AND p.isdeleted=0) AS AmountPaid,
                   (SELECT COALESCE(SUM(p.Amount),0) FROM club_dues_payments p WHERE p.fk_club_dues_id=cc.fk_club_dues_id AND p.fk_club_id=cc.fk_club_id AND p.IsPaid=1 AND p.IsOnline=0 AND p.isdeleted=0) AS OfflinePaid,
                   (SELECT COALESCE(SUM(p.Amount),0) FROM club_dues_payments p WHERE p.fk_club_dues_id=cc.fk_club_dues_id AND p.fk_club_id=cc.fk_club_id AND p.IsPaid=1 AND p.IsOnline=1 AND p.isdeleted=0) AS OnlinePaid,
                   (SELECT COUNT(*) FROM club_dues_payments p WHERE p.fk_club_dues_id=cc.fk_club_dues_id AND p.fk_club_id=cc.fk_club_id AND p.OfflineStatus='Pending' AND p.isdeleted=0) AS PendingCount,
                   (SELECT p.pk_club_dues_payment_id FROM club_dues_payments p WHERE p.fk_club_dues_id=cc.fk_club_dues_id AND p.fk_club_id=cc.fk_club_id AND p.OfflineStatus='Pending' AND p.isdeleted=0 ORDER BY p.pk_club_dues_payment_id DESC LIMIT 1) AS PendingPaymentId,
                   (SELECT p.pk_club_dues_payment_id FROM club_dues_payments p WHERE p.fk_club_dues_id=cc.fk_club_dues_id AND p.fk_club_id=cc.fk_club_id AND p.IsPaid=1 AND p.isdeleted=0 ORDER BY p.pk_club_dues_payment_id DESC LIMIT 1) AS LastPaidPaymentId,
                   (SELECT p.pk_club_dues_payment_id FROM club_dues_payments p WHERE p.fk_club_dues_id=cc.fk_club_dues_id AND p.fk_club_id=cc.fk_club_id AND p.IsOnline=0 AND p.isdeleted=0 ORDER BY p.pk_club_dues_payment_id DESC LIMIT 1) AS LastOfflinePaymentId,
                   EXISTS(SELECT 1 FROM club_dues_club_vendors v WHERE v.fk_club_dues_id=cc.fk_club_dues_id AND v.fk_club_id=cc.fk_club_id AND v.isdeleted=0) AS HasClubVendorSplit,
                   EXISTS(SELECT 1 FROM club_dues_payments p WHERE p.fk_club_dues_id=cc.fk_club_dues_id AND p.fk_club_id=cc.fk_club_id AND p.IsPaid=1 AND p.IsOnline=1 AND p.isdeleted=0) AS HasOnlinePaid
            FROM club_dues_clubs cc
            JOIN club_master c ON c.pk_club_id = cc.fk_club_id
            WHERE cc.fk_club_dues_id=@DuesId AND cc.isdeleted=0
              AND (@Search IS NULL OR @Search='' OR c.ClubName LIKE CONCAT('%',@Search,'%'))
              AND (@IncludeNonSynced = 1 OR COALESCE(c.IsSyncedFromRotaryOrg,0) = 1)
            ORDER BY c.ClubName";
        var rows = (await conn.QueryAsync<ClubDuesClubListDto>(sql,
            new { DuesId = duesId, Search = search, IncludeNonSynced = includeNonSynced ? 1 : 0 })).ToList();

        // Which (club, account) pairs have an APPROVED offline payment already — drives
        // OfflineAccountBreakdown[i].IsPaid.
        var offlinePaidPairs = (await conn.QueryAsync<(int ClubId, int AccountId)>(@"
            SELECT DISTINCT fk_club_id, FkRouteAccountId FROM club_dues_payments
            WHERE fk_club_dues_id=@DuesId AND IsPaid=1 AND IsOnline=0 AND FkRouteAccountId IS NOT NULL AND isdeleted=0",
            new { DuesId = duesId })).ToHashSet();

        // Clubs with an approved offline payment recorded BEFORE per-account split tracking
        // existed (FkRouteAccountId is nullable and was added by a later migration — every row
        // inserted before it landed on NULL, and any offline submission made through a campaign
        // with no split configured at the time also lands here). These payments genuinely
        // covered the club's dues; they just can't be matched to one specific account.
        // Per-account status still needs to say something, so — same assumption the overall
        // club Status already makes — treat the configured split as having been honored: every
        // account configured for this club counts as paid. Only affects OfflineAccountBreakdown's
        // per-row IsPaid flag; amounts/rates are unaffected.
        var legacyOfflinePaidClubs = (await conn.QueryAsync<int>(@"
            SELECT DISTINCT fk_club_id FROM club_dues_payments
            WHERE fk_club_dues_id=@DuesId AND IsPaid=1 AND IsOnline=0 AND FkRouteAccountId IS NULL AND isdeleted=0",
            new { DuesId = duesId })).ToHashSet();

        var (platformId, _, _) = await ResolvePlatformFeeAccountAsync(conn);

        foreach (var r in rows)
        {
            r.UnpaidCount = r.MemberCount - r.PaidCount;
            r.Status = r.MemberCount == 0 ? "No Members" : r.UnpaidCount == 0 ? "Fully Paid" : r.PaidCount == 0 ? "Unpaid" : "Partial";
            r.HasPendingApproval = r.PendingPaymentId.HasValue;

            // Effective rates for this club (per-club override else campaign default, already resolved
            // into club_dues_clubs at sync time for independent campaigns).
            decimal offlineRate = independent ? r.OfflinePerMemberRate : r.PerMemberRate;
            decimal onlineRate = independent
                ? r.OnlinePerMemberRate
                : Math.Round(r.PerMemberRate * (1 + surcharge / 100m), 2, MidpointRounding.AwayFromZero);
            r.OnlinePerMemberRate = onlineRate;
            r.OfflinePerMemberRate = offlineRate;
            r.OnlineAmount = r.MemberCount * onlineRate;
            r.OfflineAmount = r.MemberCount * offlineRate;

            // Online-paid: legacy backs the surcharge out (mirrors MembershipDuesService's Settled()
            // convention so "Paid" never overstates collections); independent mode's raw sum is
            // already apples-to-apples with OnlineAmount (no surcharge inflation to reverse).
            decimal onlinePaidRaw = r.OnlinePaid;
            r.OnlinePaid = independent
                ? onlinePaidRaw
                : (onlinePaidRaw > 0 ? Math.Round(surcharge > 0 ? onlinePaidRaw / (1 + surcharge / 100m) : onlinePaidRaw, 0, MidpointRounding.AwayFromZero) : 0);
            r.TotalPaid = r.OfflinePaid + r.OnlinePaid;

            var hasOnline = r.HasOnlinePaid;
            r.PaidOnline = hasOnline ? true : (r.OfflinePaid > 0 ? false : (bool?)null);

            // Online breakdown: this club's online-split rows (platform account excluded from display).
            var onlineRows = (await GetEffectiveVendorRowsAsync(conn, duesId, r.FkClubId, isOnline: true))
                .Where(v => !platformId.HasValue || (int)v.FkRouteAccountId != platformId.Value).ToList();
            // Offline breakdown: LEGACY reuses the same (platform-excluded) rows against the offline
            // total; INDEPENDENT uses the fully separate offline-only split.
            var offlineRows = independent
                ? await GetEffectiveVendorRowsAsync(conn, duesId, r.FkClubId, isOnline: false)
                : onlineRows;

            r.OnlineAccountBreakdown = onlineRows.Select(v =>
            {
                int accountId = (int)v.FkRouteAccountId;
                decimal pct = (decimal)v.SplitPercentage;
                return new ClubDuesAccountBreakdownDto
                {
                    FkRouteAccountId = accountId,
                    AccountLabel = BuildAccountLabel((string?)v.AccountName, (string?)v.BankAccountLast4, (string?)v.BankIfsc),
                    Amount = Math.Round(r.OnlineAmount * pct / 100m, 2, MidpointRounding.AwayFromZero),
                    IsPaid = hasOnline // Route settles all of one order's transfers together
                };
            }).ToList();
            r.OfflineAccountBreakdown = offlineRows.Select(v =>
            {
                int accountId = (int)v.FkRouteAccountId;
                decimal pct = (decimal)v.SplitPercentage;
                return new ClubDuesAccountBreakdownDto
                {
                    FkRouteAccountId = accountId,
                    AccountLabel = BuildAccountLabel((string?)v.AccountName, (string?)v.BankAccountLast4, (string?)v.BankIfsc),
                    Amount = Math.Round(r.OfflineAmount * pct / 100m, 2, MidpointRounding.AwayFromZero),
                    // Does NOT inherit hasOnline — the other channel settling doesn't mean this
                    // account was ever paid. DOES count a pre-split-tracking legacy payment, on
                    // the assumption its (unrecorded) split matched what's configured today.
                    IsPaid = offlinePaidPairs.Contains((r.FkClubId, accountId)) || legacyOfflinePaidClubs.Contains(r.FkClubId)
                };
            }).ToList();
        }
        return rows;
    }

    public async Task<IEnumerable<ClubDuesMemberListDto>> GetClubMembersAsync(int duesId, int clubId)
    {
        using var conn = GetConnection();
        return (await conn.QueryAsync<ClubDuesMemberListDto>(@"
            SELECT m.pk_club_dues_member_id AS ClubDuesMemberId, m.fk_member_profile_id AS FkMemberProfileId,
                   mm.MemberName, m.IsHonorary, m.Rate, m.IsPaid, m.PaidDate, m.fk_payment_id AS FkPaymentId
            FROM club_dues_members m
            JOIN member_master_profile mm ON mm.pk_member_master_profile_id = m.fk_member_profile_id
            WHERE m.fk_club_dues_id=@DuesId AND m.fk_club_id=@ClubId AND m.isdeleted=0
            ORDER BY m.IsPaid, mm.MemberName", new { DuesId = duesId, ClubId = clubId })).ToList();
    }

    public async Task UpdateClubRateAsync(int duesId, int clubDuesClubId, UpdateClubDuesRateDto dto, int userId)
    {
        using var conn = GetConnection();
        var clubId = await conn.ExecuteScalarAsync<int?>(
            "SELECT fk_club_id FROM club_dues_clubs WHERE pk_club_dues_club_id=@Id AND fk_club_dues_id=@DuesId AND isdeleted=0",
            new { Id = clubDuesClubId, DuesId = duesId });
        if (clubId == null) throw new KeyNotFoundException("Club not found in this campaign.");
        // OnlinePerMemberRate/OfflinePerMemberRate are optional — independent-mode campaigns send
        // them (COALESCE keeps whichever one wasn't sent); legacy campaigns only ever send PerMemberRate.
        await conn.ExecuteAsync(
            "UPDATE club_dues_clubs SET PerMemberRate=@Rate, OnlinePerMemberRate=COALESCE(@OnlineRate,OnlinePerMemberRate), OfflinePerMemberRate=COALESCE(@OfflineRate,OfflinePerMemberRate), modified_by=@UserId, modified_date=NOW() WHERE pk_club_dues_club_id=@Id",
            new { Rate = dto.PerMemberRate, OnlineRate = dto.OnlinePerMemberRate, OfflineRate = dto.OfflinePerMemberRate, UserId = userId, Id = clubDuesClubId });
        // Update the rate on still-unpaid members so their owed amount reflects the new rate (legacy only — club_dues_members.Rate is a single legacy field).
        await conn.ExecuteAsync(
            "UPDATE club_dues_members SET Rate=@Rate, modified_date=NOW() WHERE fk_club_dues_id=@DuesId AND fk_club_id=@ClubId AND IsPaid=0 AND isdeleted=0",
            new { Rate = dto.PerMemberRate, DuesId = duesId, ClubId = clubId.Value });
    }

    // Which account(s) a payment on this channel settles: a specific offline account if one was
    // chosen, else every account actually in effect for that channel — a lump-sum online payment
    // via Razorpay Route always settles every configured online account in one transaction; an
    // offline payment with no account chosen (no split configured at all) settles every offline
    // account the same way. Falls back to the [0] sentinel when a channel has no configured
    // accounts at all, matching club_dues_member_account_payments' NOT NULL fk_route_account_id —
    // "account 0" then just means "the whole club balance, no real split."
    private async Task<List<int>> ResolveSettledAccountIdsAsync(MySqlConnection conn, int duesId, int clubId, bool isOnline, int? explicitAccountId)
    {
        if (explicitAccountId is > 0) return new List<int> { explicitAccountId.Value };

        List<dynamic> rows = await GetEffectiveVendorRowsAsync(conn, duesId, clubId, isOnline);
        if (isOnline)
        {
            var (platformId, _, _) = await ResolvePlatformFeeAccountAsync(conn);
            if (platformId.HasValue) rows = rows.Where(r => (int)r.FkRouteAccountId != platformId.Value).ToList();
        }
        var ids = rows.Select(r => (int)r.FkRouteAccountId).Distinct().ToList();
        return ids.Count > 0 ? ids : new List<int> { 0 };
    }

    // True once a member has a paid row for EVERY account on at least one full track (online or
    // offline) — mirrors ClubRates' documented "a club only needs one track fully paid" rule.
    // The [0] sentinel (see ResolveSettledAccountIdsAsync) makes an unsplit channel's "paid in
    // full" fall out of the same .All() check with no special-casing needed.
    private async Task RecomputeOverallPaidAsync(MySqlConnection conn, int duesId, int clubId, List<int> memberIds)
    {
        if (memberIds.Count == 0) return;
        var onlineAccountIds = await ResolveSettledAccountIdsAsync(conn, duesId, clubId, isOnline: true, explicitAccountId: null);
        var offlineAccountIds = await ResolveSettledAccountIdsAsync(conn, duesId, clubId, isOnline: false, explicitAccountId: null);

        foreach (var memberId in memberIds)
        {
            var paidAccountIds = (await conn.QueryAsync<int>(
                "SELECT fk_route_account_id FROM club_dues_member_account_payments WHERE fk_club_dues_member_id=@Id AND IsPaid=1 AND isdeleted=0",
                new { Id = memberId })).ToHashSet();

            bool onlineDone = onlineAccountIds.All(a => paidAccountIds.Contains(a));
            bool offlineDone = offlineAccountIds.All(a => paidAccountIds.Contains(a));

            if (onlineDone || offlineDone)
                await conn.ExecuteAsync(
                    "UPDATE club_dues_members SET IsPaid=1, modified_date=NOW() WHERE pk_club_dues_member_id=@Id AND IsPaid=0",
                    new { Id = memberId });
        }
    }

    // Marks up to `count` currently-unpaid (for the given account(s)) non-honorary members of the
    // club as covered by this payment — one club_dues_member_account_payments row per (member,
    // account) — then recomputes each affected member's overall club_dues_members.IsPaid.
    // Returns the number of members actually covered.
    private async Task<int> CoverUnpaidMembersAsync(MySqlConnection conn, int duesId, int clubId, int paymentId, int count, List<int> accountIds)
    {
        if (count <= 0 || accountIds.Count == 0) return 0;

        // Next `count` members lacking a paid row for the first account being settled — every
        // account in accountIds is marked for this same member set below (a lump-sum payment
        // settles them all together), so any one account gives a stable, consistent selection.
        var ids = (await conn.QueryAsync<int>(@"
            SELECT m.pk_club_dues_member_id FROM club_dues_members m
            WHERE m.fk_club_dues_id=@DuesId AND m.fk_club_id=@ClubId AND m.IsHonorary=0 AND m.isdeleted=0
              AND NOT EXISTS (
                SELECT 1 FROM club_dues_member_account_payments ap
                WHERE ap.fk_club_dues_member_id = m.pk_club_dues_member_id
                  AND ap.fk_route_account_id = @FirstAccountId AND ap.IsPaid=1 AND ap.isdeleted=0)
            ORDER BY m.pk_club_dues_member_id LIMIT @Count",
            new { DuesId = duesId, ClubId = clubId, FirstAccountId = accountIds[0], Count = count })).ToList();
        if (ids.Count == 0) return 0;

        foreach (var accountId in accountIds)
        {
            foreach (var memberId in ids)
            {
                await conn.ExecuteAsync(@"
                    INSERT INTO club_dues_member_account_payments (fk_club_dues_member_id, fk_route_account_id, fk_payment_id, IsPaid, PaidDate, created_date)
                    VALUES (@MemberId, @AccountId, @PaymentId, 1, NOW(), NOW())
                    ON DUPLICATE KEY UPDATE fk_payment_id=@PaymentId, IsPaid=1, PaidDate=NOW(), modified_date=NOW(), isdeleted=0",
                    new { MemberId = memberId, AccountId = accountId, PaymentId = paymentId });
            }
        }

        await RecomputeOverallPaidAsync(conn, duesId, clubId, ids);
        return ids.Count;
    }

    // Resolved rate snapshot for a club, covering BOTH tracks at once. LEGACY campaigns (RateModel=0)
    // derive OnlineRate from OfflineRate x (1+surcharge/100) — byte-identical to the old single-rate
    // formula. INDEPENDENT campaigns (RateModel=1) read the two tracks' own resolved per-club rates
    // directly (SyncClubsAndMembersInternalAsync always keeps club_dues_clubs.On/OfflinePerMemberRate
    // populated with the effective — override else campaign-default — value). Unpaid member count is
    // shared across both tracks (a club only needs ONE track fully paid to be "Paid").
    private sealed class ClubRates
    {
        public int Unpaid { get; set; }
        public int MemberCount { get; set; }
        public int PaidCount { get; set; }
        public decimal OfflineRate { get; set; }
        public decimal OfflineOwed { get; set; }
        public decimal OnlineRate { get; set; }
        public decimal OnlineOwed { get; set; }
        public bool Independent { get; set; }
        public int ModeOfPayment { get; set; }
    }

    private static async Task<ClubRates> GetClubRatesAsync(MySqlConnection conn, int duesId, int clubId)
    {
        var row = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT cc.PerMemberRate, cc.OnlinePerMemberRate, cc.OfflinePerMemberRate,
                   cd.RateModel, cd.OnlineSurchargePercent, cd.ModeOfPayment,
                   (SELECT COUNT(*) FROM club_dues_members m WHERE m.fk_club_dues_id=@DuesId AND m.fk_club_id=@ClubId AND m.isdeleted=0 AND m.IsHonorary=0) AS MemberCount,
                   (SELECT COUNT(*) FROM club_dues_members m WHERE m.fk_club_dues_id=@DuesId AND m.fk_club_id=@ClubId AND m.isdeleted=0 AND m.IsHonorary=0 AND m.IsPaid=1) AS PaidCount
            FROM club_dues_clubs cc
            JOIN club_dues cd ON cd.pk_club_dues_id = cc.fk_club_dues_id
            WHERE cc.fk_club_dues_id=@DuesId AND cc.fk_club_id=@ClubId AND cc.isdeleted=0",
            new { DuesId = duesId, ClubId = clubId });
        if (row == null) return new ClubRates();

        int memberCount = (int)(long)row.MemberCount;
        int paidCount = (int)(long)row.PaidCount;
        int unpaid = memberCount - paidCount;
        bool independent = Convert.ToInt32(row.RateModel) == 1;

        decimal offlineRate, onlineRate;
        if (independent)
        {
            offlineRate = (decimal)row.OfflinePerMemberRate;
            onlineRate = (decimal)row.OnlinePerMemberRate;
        }
        else
        {
            offlineRate = (decimal)row.PerMemberRate;
            decimal surcharge = (decimal)row.OnlineSurchargePercent;
            onlineRate = Math.Round(offlineRate * (1 + surcharge / 100m), 2, MidpointRounding.AwayFromZero);
        }

        return new ClubRates
        {
            Unpaid = unpaid, MemberCount = memberCount, PaidCount = paidCount,
            OfflineRate = offlineRate, OfflineOwed = unpaid * offlineRate,
            OnlineRate = onlineRate, OnlineOwed = unpaid * onlineRate,
            Independent = independent, ModeOfPayment = (int)row.ModeOfPayment,
        };
    }

    // Server-side enforcement of ModeOfPayment (1=online-only, 2=offline-only, 3=both) — today this was
    // UI-only; in independent mode a disabled channel's rate can legitimately sit at 0, so this guard
    // is what stops that channel from being paid for free if its endpoint is hit directly.
    private static bool ChannelEnabled(int modeOfPayment, bool isOnline) =>
        isOnline ? (modeOfPayment == 1 || modeOfPayment == 3) : (modeOfPayment == 2 || modeOfPayment == 3);

    // ═══════════════════════════════════════════════════════════════
    //  Offline payments + approval
    // ═══════════════════════════════════════════════════════════════

    // Resolves the account Name for a route account (written into OfflineBankName too, so every
    // existing read path — report/export/receipt email — keeps showing a bank name without needing
    // a join everywhere; FkRouteAccountId is the accurate source for anything that needs it later).
    private async Task<string?> ResolveRouteAccountNameAsync(MySqlConnection conn, int? fkRouteAccountId)
    {
        if (!fkRouteAccountId.HasValue) return null;
        return await conn.ExecuteScalarAsync<string?>(
            "SELECT Name FROM razorpay_route_accounts WHERE pk_id=@Id", new { Id = fkRouteAccountId.Value });
    }

    // Admin-entered offline payment → immediately Approved/Paid. Amount is always the full
    // currently-owed figure (same as online) — no partial/split-amount entry; the officer/admin
    // only chooses WHICH account the money went into.
    public async Task<int> RecordOfflinePaymentAsync(int duesId, RecordOfflineClubDuesPaymentDto dto, IFormFile? attachment, int userId, IWebHostEnvironment env)
    {
        using var conn = GetConnection();
        await SyncClubsAndMembersInternalAsync(conn, duesId, userId, null);
        var rates = await GetClubRatesAsync(conn, duesId, dto.FkClubId);
        if (!ChannelEnabled(rates.ModeOfPayment, isOnline: false))
            throw new InvalidOperationException("Offline payment is not enabled for this campaign.");
        if (rates.Unpaid <= 0) throw new InvalidOperationException("This club has no unpaid members.");
        var attachPath = attachment != null ? await SaveFileAsync(attachment, env) : null;
        var vendorRows = await GetOfflineEligibleVendorRowsAsync(conn, duesId, dto.FkClubId, rates.Independent);
        var (amount, count) = await ResolveAccountAmountAsync(conn, duesId, dto.FkClubId, vendorRows, dto.FkRouteAccountId, rates.OfflineRate, rates.OfflineOwed, rates.Unpaid);
        var accountName = await ResolveRouteAccountNameAsync(conn, dto.FkRouteAccountId);

        var paymentId = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO club_dues_payments (fk_club_dues_id, fk_club_id, Amount, MemberCountCovered, PaidByMemberId,
                IsPaid, IsOnline, PaymentStatus, OfflineStatus, OfflineTransactionType, OfflineTransactionId,
                OfflineGivenTo, OfflineBankName, FkRouteAccountId, OfflineChequeNumber, OfflineRemark, Attachment, PaymentDate,
                ApprovalRemark, ApprovedBy, ApprovedDate, ApprovalSource, created_by, created_date)
            VALUES (@DuesId, @ClubId, @Amount, @Count, @PaidBy,
                1, 0, 'Approved', 'Approved', @TransType, @TransId,
                @GivenTo, @BankName, @FkRouteAccountId, @ChequeNo, @Remark, @Attach, @PayDate,
                @ApprovalRemark, @UserId, NOW(), 'admin-portal', @UserId, NOW());
            SELECT LAST_INSERT_ID();",
            new
            {
                DuesId = duesId, ClubId = dto.FkClubId, Amount = amount, Count = count, PaidBy = dto.PaidByMemberId,
                TransType = dto.TransactionType ?? "", TransId = dto.TransactionId ?? "", GivenTo = dto.GivenTo ?? "",
                BankName = accountName ?? dto.BankName ?? "", dto.FkRouteAccountId, ChequeNo = dto.ChequeNumber ?? "", Remark = dto.Remark ?? "",
                Attach = attachPath ?? "", PayDate = dto.PaymentDate ?? DateTime.Now, dto.ApprovalRemark, UserId = userId
            });

        var settledAccountIds = await ResolveSettledAccountIdsAsync(conn, duesId, dto.FkClubId, isOnline: false, dto.FkRouteAccountId);
        await CoverUnpaidMembersAsync(conn, duesId, dto.FkClubId, paymentId, count, settledAccountIds);
        await SyncGoogleSheetIfEnabledAsync(duesId);
        if (dto.SendReceiptEmail) { try { await SendReceiptEmailAsync(paymentId); } catch { } }
        return paymentId;
    }

    // Officer/public offline submission → Pending, emails the approver (District Treasurer).
    // Same account-driven amount rule as the admin path above.
    public async Task<int> RecordPublicOfflinePaymentAsync(int duesId, RecordOfflineClubDuesPaymentDto dto, IFormFile? attachment, IWebHostEnvironment env)
    {
        using var conn = GetConnection();
        await SyncClubsAndMembersInternalAsync(conn, duesId, 0, null);
        var rates = await GetClubRatesAsync(conn, duesId, dto.FkClubId);
        if (!ChannelEnabled(rates.ModeOfPayment, isOnline: false))
            throw new InvalidOperationException("Offline payment is not enabled for this campaign.");
        if (rates.Unpaid <= 0) throw new InvalidOperationException("This club has no unpaid members.");

        // DUPLICATE GUARD. The pay link never expires and is freely forwardable, so without this a
        // double-tap (or anyone re-opening the link, or a direct API call — the UI notice alone is
        // client-side) stacks N Pending rows for the same dues, each with its own uploaded receipt
        // and its own approval email, and the treasurer can approve more than one of them.
        // Predicate matches what the UI already reads — GetPublicDuesAsync's IsPending and
        // GetClubsAsync's PendingCount/HasPendingApproval: OfflineStatus='Pending' AND isdeleted=0
        // for this (campaign, club).
        // The account clause preserves the documented MULTI-ACCOUNT flow: a club depositing into
        // several configured accounts sends one submission per account, each covering only that
        // account's share (see ResolveAccountAmount + SendApprovalRequestEmailAsync's copy), so those
        // are not duplicates of each other. A submission with NO account covers the FULL owed amount
        // and therefore collides with any pending row in either direction.
        // Placed BEFORE SaveFileAsync so a rejected duplicate never litters the upload folder.
        var pendingDuplicates = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM club_dues_payments
            WHERE fk_club_dues_id=@DuesId AND fk_club_id=@ClubId
              AND OfflineStatus='Pending' AND isdeleted=0
              AND (@AccountId IS NULL OR FkRouteAccountId IS NULL OR FkRouteAccountId=@AccountId)",
            new { DuesId = duesId, ClubId = dto.FkClubId, AccountId = dto.FkRouteAccountId });
        if (pendingDuplicates > 0)
            throw new InvalidOperationException("An offline payment for this club is already awaiting verification.");

        var attachPath = attachment != null ? await SaveFileAsync(attachment, env) : null;
        var vendorRows = await GetOfflineEligibleVendorRowsAsync(conn, duesId, dto.FkClubId, rates.Independent);
        var (amount, count) = await ResolveAccountAmountAsync(conn, duesId, dto.FkClubId, vendorRows, dto.FkRouteAccountId, rates.OfflineRate, rates.OfflineOwed, rates.Unpaid);
        var accountName = await ResolveRouteAccountNameAsync(conn, dto.FkRouteAccountId);

        var paymentId = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO club_dues_payments (fk_club_dues_id, fk_club_id, Amount, MemberCountCovered, PaidByMemberId,
                IsPaid, IsOnline, PaymentStatus, OfflineStatus, OfflineTransactionType, OfflineTransactionId,
                OfflineGivenTo, OfflineBankName, FkRouteAccountId, OfflineChequeNumber, OfflineRemark, Attachment, PaymentDate, created_date)
            VALUES (@DuesId, @ClubId, @Amount, @Count, @PaidBy,
                0, 0, 'PendingApproval', 'Pending', @TransType, @TransId,
                @GivenTo, @BankName, @FkRouteAccountId, @ChequeNo, @Remark, @Attach, @PayDate, NOW());
            SELECT LAST_INSERT_ID();",
            new
            {
                DuesId = duesId, ClubId = dto.FkClubId, Amount = amount, Count = count, PaidBy = dto.PaidByMemberId,
                TransType = dto.TransactionType ?? "", TransId = dto.TransactionId ?? "", GivenTo = dto.GivenTo ?? "",
                BankName = accountName ?? dto.BankName ?? "", dto.FkRouteAccountId, ChequeNo = dto.ChequeNumber ?? "", Remark = dto.Remark ?? "",
                Attach = attachPath ?? "", PayDate = dto.PaymentDate ?? DateTime.Now
            });

        // Notify the approver (District Treasurer / configured ApproverEmail) synchronously.
        try { await SendApprovalRequestEmailAsync(conn, duesId, paymentId); }
        catch (Exception ex) { _logger.LogError(ex, "Club dues approval email failed for payment {Id}", paymentId); }
        return paymentId;
    }

    public async Task ApproveRejectPaymentAsync(int paymentId, ApproveClubDuesPaymentDto dto, int userId)
    {
        using var conn = GetConnection();
        var payment = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT fk_club_dues_id, fk_club_id, MemberCountCovered, OfflineStatus, FkRouteAccountId FROM club_dues_payments WHERE pk_club_dues_payment_id=@Id AND isdeleted=0",
            new { Id = paymentId });
        if (payment == null) throw new KeyNotFoundException("Payment not found.");
        string current = (string?)payment.OfflineStatus ?? "";
        if (current == "Approved" || current == "Rejected")
            throw new AlreadyHandledException($"This payment was already {current.ToLower()}.");

        int duesId = (int)payment.fk_club_dues_id;
        int clubId = (int)payment.fk_club_id;
        int count = (int)payment.MemberCountCovered;
        int? fkRouteAccountId = payment.FkRouteAccountId == null ? null : (int)payment.FkRouteAccountId;

        if (dto.IsApproved)
        {
            await conn.ExecuteAsync(@"
                UPDATE club_dues_payments SET IsPaid=1, PaymentStatus='Approved', OfflineStatus='Approved',
                    ApprovedBy=@UserId, ApprovedDate=NOW(), ApprovalRemark=@Remark, ApprovalSource='admin-portal',
                    PaymentDate=COALESCE(PaymentDate,NOW()), modified_date=NOW()
                WHERE pk_club_dues_payment_id=@Id",
                new { UserId = userId, Remark = dto.ApprovalRemark, Id = paymentId });
            var settledAccountIds = await ResolveSettledAccountIdsAsync(conn, duesId, clubId, isOnline: false, fkRouteAccountId);
            await CoverUnpaidMembersAsync(conn, duesId, clubId, paymentId, count, settledAccountIds);
            await SyncGoogleSheetIfEnabledAsync(duesId);
            try { await SendReceiptEmailAsync(paymentId); } catch { }
        }
        else
        {
            await conn.ExecuteAsync(@"
                UPDATE club_dues_payments SET PaymentStatus='Rejected', OfflineStatus='Rejected',
                    RejectedBy=@UserId, RejectedDate=NOW(), RejectionReason=@Reason, RejectionSource='admin-portal', modified_date=NOW()
                WHERE pk_club_dues_payment_id=@Id",
                new { UserId = userId, Reason = dto.RejectionReason, Id = paymentId });
            try { await SendRejectionEmailAsync(paymentId, dto.RejectionReason); } catch { }
        }
    }

    // Notifies the submitting officer that their offline payment was rejected, with the reason.
    // Mirrors SendReceiptEmailAsync's join (payer email via PaidByMemberId).
    private async Task SendRejectionEmailAsync(int paymentId, string? reason)
    {
        using var conn = GetConnection();
        var info = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT p.Amount, p.MemberCountCovered, cd.Purpose, cd.RotaryYear, cd.EmailCC,
                   d.DistrictNumber, c.ClubName,
                   mm.EmailId AS OfficerEmail, mm.MemberName AS OfficerName,
                   ra.Name AS AccountName, ra.BankAccountLast4, ra.BankIfsc
            FROM club_dues_payments p
            JOIN club_dues cd ON cd.pk_club_dues_id = p.fk_club_dues_id
            LEFT JOIN district_master d ON cd.fk_district_id = d.pk_district_id
            LEFT JOIN club_master c ON p.fk_club_id = c.pk_club_id
            LEFT JOIN member_master_profile mm ON mm.pk_member_master_profile_id = p.PaidByMemberId
            LEFT JOIN razorpay_route_accounts ra ON p.FkRouteAccountId = ra.pk_id
            WHERE p.pk_club_dues_payment_id=@Id", new { Id = paymentId });
        if (info == null) return;
        var toEmail = (string?)info.OfficerEmail;
        if (string.IsNullOrWhiteSpace(toEmail)) return;
        var reasonText = string.IsNullOrWhiteSpace(reason) ? "No reason provided." : reason;
        var accountLabel = info.AccountName == null ? "-" : BuildAccountLabel((string?)info.AccountName, (string?)info.BankAccountLast4, (string?)info.BankIfsc);
        var subject = $"District Dues payment rejected — {(string?)info.ClubName}";
        var body = $@"<div style='font-family:Arial,sans-serif'>
<h2 style='color:#c53030;margin-top:0'>Payment Rejected</h2>
<p>Dear {(string?)info.OfficerName},</p>
<p>Your club's offline dues payment has been rejected. Please see the details below:</p>
<table style='border-collapse:collapse'>
<tr><td style='padding:4px 10px'>District</td><td style='padding:4px 10px'><b>{(string?)info.DistrictNumber ?? "-"}</b></td></tr>
<tr><td style='padding:4px 10px'>Club</td><td style='padding:4px 10px'><b>{(string?)info.ClubName ?? "-"}</b></td></tr>
<tr><td style='padding:4px 10px'>Members covered</td><td style='padding:4px 10px'><b>{(int)info.MemberCountCovered}</b></td></tr>
<tr><td style='padding:4px 10px'>Account</td><td style='padding:4px 10px'><b>{accountLabel}</b></td></tr>
<tr><td style='padding:4px 10px'>Amount</td><td style='padding:4px 10px'><b>₹{(decimal)info.Amount:0.00}</b></td></tr>
<tr><td style='padding:4px 10px'>Year</td><td style='padding:4px 10px'>{(string?)info.RotaryYear}</td></tr>
<tr><td style='padding:4px 10px'>Reason</td><td style='padding:4px 10px;color:#c53030'><b>{reasonText}</b></td></tr>
</table>
<p>You can resubmit your payment. Please contact your district for more details.</p>
<p>Thank you.</p></div>";
        var cc = (string?)info.EmailCC;
        if (!string.IsNullOrWhiteSpace(cc)) await _emailService.SendGenericEmailWithCcAsync(toEmail, cc, subject, body);
        else await _emailService.SendGenericEmailAsync(toEmail, subject, body);
    }

    private async Task SendApprovalRequestEmailAsync(MySqlConnection conn, int duesId, int paymentId)
    {
        var info = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT cd.ApproverEmail, cd.Purpose, cd.RotaryYear, d.DistrictNumber, c.ClubName, p.Amount, p.MemberCountCovered,
                   ra.Name AS AccountName, ra.BankAccountLast4, ra.BankIfsc
            FROM club_dues_payments p
            JOIN club_dues cd ON cd.pk_club_dues_id = p.fk_club_dues_id
            LEFT JOIN district_master d ON cd.fk_district_id = d.pk_district_id
            LEFT JOIN club_master c ON p.fk_club_id = c.pk_club_id
            LEFT JOIN razorpay_route_accounts ra ON p.FkRouteAccountId = ra.pk_id
            WHERE p.pk_club_dues_payment_id=@Id", new { Id = paymentId });
        if (info == null) return;
        var approverEmail = (string?)info.ApproverEmail;
        if (string.IsNullOrWhiteSpace(approverEmail)) { _logger.LogWarning("Club dues {Id}: no ApproverEmail set; approval email skipped.", paymentId); return; }

        var secret = _config["JwtSettings:Secret"] ?? "";
        var token = ClubDuesApprovalToken.Generate(paymentId, 0, secret);
        var frontendUrl = _config["FrontendUrl"] ?? "http://localhost:3000";
        var url = $"{frontendUrl}/club-dues-approval/{token}";
        var accountLabel = info.AccountName == null ? "-" : BuildAccountLabel((string?)info.AccountName, (string?)info.BankAccountLast4, (string?)info.BankIfsc);
        var subject = $"District Dues approval — {(string?)info.ClubName} ({(string?)info.DistrictNumber})";
        var body = $@"<div style='font-family:Arial,sans-serif'>
<p>An offline District Dues payment needs your approval. This submission covers ONE of the club's
configured accounts — if the club is depositing into more than one account, each will arrive as its
own separate approval request.</p>
<table style='border-collapse:collapse'>
<tr><td style='padding:4px 10px'>District</td><td style='padding:4px 10px'><b>{(string?)info.DistrictNumber}</b></td></tr>
<tr><td style='padding:4px 10px'>Club</td><td style='padding:4px 10px'><b>{(string?)info.ClubName}</b></td></tr>
<tr><td style='padding:4px 10px'>Members covered</td><td style='padding:4px 10px'><b>{(int)info.MemberCountCovered}</b></td></tr>
<tr><td style='padding:4px 10px'>Account</td><td style='padding:4px 10px'><b>{accountLabel}</b></td></tr>
<tr><td style='padding:4px 10px'>Amount for this account</td><td style='padding:4px 10px'><b>₹{(decimal)info.Amount:0.00}</b></td></tr>
</table>
<p><a href='{url}' style='background:#1a365d;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none'>Review &amp; Approve / Reject</a></p>
<p style='color:#64748b;font-size:12px'>This link is unique to this payment.</p>
</div>";
        await _emailService.SendGenericEmailAsync(approverEmail, subject, body);
    }

    // Offline detail (for the Edit dialog).
    public async Task<ClubDuesOfflineDetailDto?> GetOfflinePaymentDetailAsync(int paymentId)
    {
        using var conn = GetConnection();
        var dto = await conn.QueryFirstOrDefaultAsync<ClubDuesOfflineDetailDto>(@"
            SELECT p.pk_club_dues_payment_id AS PaymentId, p.fk_club_id AS FkClubId, p.Amount, p.MemberCountCovered,
                   p.OfflineTransactionType AS TransactionType, p.OfflineTransactionId AS TransactionId,
                   p.OfflineGivenTo AS GivenTo, p.OfflineBankName AS BankName, p.OfflineChequeNumber AS ChequeNumber,
                   p.OfflineRemark AS Remark, p.PaymentDate, p.Attachment, p.OfflineStatus, p.FkRouteAccountId,
                   ra.Name AS AccountName, ra.BankAccountLast4, ra.BankIfsc
            FROM club_dues_payments p
            LEFT JOIN razorpay_route_accounts ra ON p.FkRouteAccountId = ra.pk_id
            WHERE p.pk_club_dues_payment_id=@Id AND p.IsOnline=0 AND p.isdeleted=0",
            new { Id = paymentId });
        if (dto != null && dto.FkRouteAccountId.HasValue)
            dto.AccountLabel = BuildAccountLabel(dto.AccountName, dto.BankAccountLast4, dto.BankIfsc);
        return dto;
    }

    // Update a saved offline payment. If it was Pending, saving also APPROVES it (marks paid + covers
    // members), matching the membership-dues offline-update behaviour.
    public async Task UpdateOfflinePaymentAsync(int paymentId, RecordOfflineClubDuesPaymentDto dto, IFormFile? attachment, int userId, IWebHostEnvironment env)
    {
        using var conn = GetConnection();
        var payment = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT fk_club_dues_id, fk_club_id, MemberCountCovered, OfflineStatus, Attachment FROM club_dues_payments WHERE pk_club_dues_payment_id=@Id AND IsOnline=0 AND isdeleted=0",
            new { Id = paymentId });
        if (payment == null) throw new KeyNotFoundException("Offline payment not found.");
        var attachPath = attachment != null ? await SaveFileAsync(attachment, env) : (string?)payment.Attachment;
        bool wasPending = ((string?)payment.OfflineStatus ?? "") == "Pending";
        var accountName = await ResolveRouteAccountNameAsync(conn, dto.FkRouteAccountId);

        await conn.ExecuteAsync(@"
            UPDATE club_dues_payments SET
                OfflineTransactionType=@TransType, OfflineTransactionId=@TransId, OfflineGivenTo=@GivenTo,
                OfflineBankName=@BankName, FkRouteAccountId=@FkRouteAccountId, OfflineChequeNumber=@ChequeNo, OfflineRemark=@Remark,
                Attachment=@Attach, PaymentDate=@PayDate, modified_by=@UserId, modified_date=NOW()
            WHERE pk_club_dues_payment_id=@Id",
            new
            {
                TransType = dto.TransactionType ?? "", TransId = dto.TransactionId ?? "", GivenTo = dto.GivenTo ?? "",
                BankName = accountName ?? dto.BankName ?? "", dto.FkRouteAccountId, ChequeNo = dto.ChequeNumber ?? "", Remark = dto.Remark ?? "",
                Attach = attachPath ?? "", PayDate = dto.PaymentDate ?? DateTime.Now, UserId = userId, Id = paymentId
            });

        if (wasPending)
        {
            await conn.ExecuteAsync(@"
                UPDATE club_dues_payments SET IsPaid=1, PaymentStatus='Approved', OfflineStatus='Approved',
                    ApprovedBy=@UserId, ApprovedDate=NOW(), ApprovalRemark=@Remark, ApprovalSource='admin-portal',
                    PaymentDate=COALESCE(PaymentDate,NOW()), modified_date=NOW()
                WHERE pk_club_dues_payment_id=@Id",
                new { UserId = userId, Remark = dto.ApprovalRemark, Id = paymentId });
            var settledAccountIds = await ResolveSettledAccountIdsAsync(conn, (int)payment.fk_club_dues_id, (int)payment.fk_club_id, isOnline: false, dto.FkRouteAccountId);
            await CoverUnpaidMembersAsync(conn, (int)payment.fk_club_dues_id, (int)payment.fk_club_id, paymentId, (int)payment.MemberCountCovered, settledAccountIds);
            await SyncGoogleSheetIfEnabledAsync((int)payment.fk_club_dues_id);
        }
        if (dto.SendReceiptEmail) { try { await SendReceiptEmailAsync(paymentId); } catch { } }
    }

    // Masked "•••1234 · IFSC XXXX0001234 — Name" label so an account is identifiable by its real
    // bank number/IFSC rather than only the arbitrary friendly Name (full account number is never
    // stored in MySQL — only the last 4 digits — the rest lives solely at Razorpay).
    private static string BuildAccountLabel(string? name, string? last4, string? ifsc)
    {
        var maskedNumber = string.IsNullOrWhiteSpace(last4) ? "••••----" : $"••••{last4}";
        var ifscPart = string.IsNullOrWhiteSpace(ifsc) ? "IFSC N/A" : $"IFSC {ifsc}";
        var namePart = string.IsNullOrWhiteSpace(name) ? "" : $" — {name}";
        return $"{maskedNumber} · {ifscPart}{namePart}";
    }

    // ── Per-club Razorpay split override ────────────────────────
    public async Task<IEnumerable<ClubDuesVendorDto>> GetClubVendorsAsync(int duesId, int clubId)
    {
        using var conn = GetConnection();
        var rows = (await conn.QueryAsync<ClubDuesVendorDto>(@"
            SELECT v.pk_club_dues_club_vendor_id AS Id, v.fk_route_account_id AS FkRouteAccountId, v.AccountId, ra.Name AS AccountName,
                   ra.BankAccountLast4, ra.BankIfsc,
                   v.SplitAmount, v.SplitPercentage, v.IsOnline
            FROM club_dues_club_vendors v
            LEFT JOIN razorpay_route_accounts ra ON v.fk_route_account_id = ra.pk_id
            WHERE v.fk_club_dues_id=@DuesId AND v.fk_club_id=@ClubId AND v.isdeleted=0", new { DuesId = duesId, ClubId = clubId })).ToList();
        foreach (var r in rows) r.AccountLabel = BuildAccountLabel(r.AccountName, r.BankAccountLast4, r.BankIfsc);
        return rows;
    }

    // Bulk per-club vendor fetch (seeds the create/edit wizard's Club List step prefill). Both
    // channels come back together, tagged IsOnline — the frontend buckets client-side.
    public async Task<IEnumerable<ClubDuesClubVendorRow>> GetAllClubVendorsAsync(int duesId)
    {
        using var conn = GetConnection();
        return (await conn.QueryAsync<ClubDuesClubVendorRow>(@"
            SELECT fk_club_id AS FkClubId, fk_route_account_id AS FkRouteAccountId, AccountId, SplitAmount, SplitPercentage, IsOnline
            FROM club_dues_club_vendors WHERE fk_club_dues_id=@DuesId AND isdeleted=0", new { DuesId = duesId })).ToList();
    }

    // Effective vendor rows for a club/channel: this club's override (club_dues_club_vendors) if it
    // has one FOR THAT CHANNEL, else the campaign default (club_dues_vendors) for that channel.
    // isOnline=true is the ONLINE track (routing — CreatePaymentOrderAsync); for a legacy campaign
    // every row defaults to IsOnline=1, so this filter is a no-op and behavior is unchanged.
    private static async Task<List<dynamic>> GetEffectiveVendorRowsAsync(MySqlConnection conn, int duesId, int clubId, bool isOnline)
    {
        var rows = (await conn.QueryAsync<dynamic>(@"
            SELECT v.fk_route_account_id AS FkRouteAccountId, v.AccountId, v.SplitAmount, v.SplitPercentage,
                   ra.Name AS AccountName, ra.BankAccountLast4, ra.BankIfsc
            FROM club_dues_club_vendors v
            LEFT JOIN razorpay_route_accounts ra ON v.fk_route_account_id = ra.pk_id
            WHERE v.fk_club_dues_id=@DuesId AND v.fk_club_id=@ClubId AND v.isdeleted=0 AND v.IsOnline=@IsOnline
              AND v.AccountId IS NOT NULL AND v.AccountId <> ''",
            new { DuesId = duesId, ClubId = clubId, IsOnline = isOnline })).ToList();
        if (rows.Count == 0)
            rows = (await conn.QueryAsync<dynamic>(@"
                SELECT v.fk_route_account_id AS FkRouteAccountId, v.AccountId, v.SplitAmount, v.SplitPercentage,
                       ra.Name AS AccountName, ra.BankAccountLast4, ra.BankIfsc
                FROM club_dues_vendors v
                LEFT JOIN razorpay_route_accounts ra ON v.fk_route_account_id = ra.pk_id
                WHERE v.fk_club_dues_id=@DuesId AND v.isdeleted=0 AND v.IsOnline=@IsOnline
                  AND v.AccountId IS NOT NULL AND v.AccountId <> ''",
                new { DuesId = duesId, IsOnline = isOnline })).ToList();
        return rows;
    }

    // Offline-eligible vendor rows. LEGACY: the shared (IsOnline=1) split minus the platform-fee
    // account — it's an online-only cut (covers the payment gateway's own commission), never shown
    // as an offline destination and never taking a cut of offline collections. INDEPENDENT: the
    // fully separate offline (IsOnline=0) split directly — it never had a platform-fee row injected.
    private async Task<List<dynamic>> GetOfflineEligibleVendorRowsAsync(MySqlConnection conn, int duesId, int clubId, bool independent)
    {
        if (independent)
            return await GetEffectiveVendorRowsAsync(conn, duesId, clubId, isOnline: false);
        var rows = await GetEffectiveVendorRowsAsync(conn, duesId, clubId, isOnline: true);
        var (platformId, _, _) = await ResolvePlatformFeeAccountAsync(conn);
        if (!platformId.HasValue) return rows;
        return rows.Where(r => (int)r.FkRouteAccountId != platformId.Value).ToList();
    }

    // The amount + member count a specific account should collect offline right now: only the
    // members who DON'T yet have a paid row for THIS account, times this account's own
    // per-member share (rate x its stored SplitPercentage, taken literally — NOT renormalized
    // against the rest of the platform-excluded group; see the old comment this replaces for why
    // that's correct even though the group no longer sums to 100%). This is independent of what
    // any OTHER account has collected — the fix for the multi-account bug, where this used to be
    // computed against the club's single shared "still unpaid" count, so paying one account
    // shrank every other account's remaining balance even though that account had collected
    // nothing. No configured accounts at all, or no account chosen, falls back to the
    // whole-club figures (fallbackOwed/fallbackCount).
    private async Task<(decimal Amount, int Count)> ResolveAccountAmountAsync(
        MySqlConnection conn, int duesId, int clubId, List<dynamic> vendorRows, int? fkRouteAccountId, decimal rate, decimal fallbackOwed, int fallbackCount)
    {
        if (vendorRows.Count == 0 || !fkRouteAccountId.HasValue) return (fallbackOwed, fallbackCount);
        foreach (var v in vendorRows)
        {
            if ((int)v.FkRouteAccountId != fkRouteAccountId.Value) continue;
            int unpaidForAccount = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM club_dues_members m
                WHERE m.fk_club_dues_id=@DuesId AND m.fk_club_id=@ClubId AND m.IsHonorary=0 AND m.isdeleted=0
                  AND NOT EXISTS (
                    SELECT 1 FROM club_dues_member_account_payments ap
                    WHERE ap.fk_club_dues_member_id = m.pk_club_dues_member_id AND ap.fk_route_account_id=@AccountId
                      AND ap.IsPaid=1 AND ap.isdeleted=0)",
                new { DuesId = duesId, ClubId = clubId, AccountId = fkRouteAccountId.Value });
            decimal amount = Math.Round(unpaidForAccount * rate * (decimal)v.SplitPercentage / 100m, 2, MidpointRounding.AwayFromZero);
            return (amount, unpaidForAccount);
        }
        return (fallbackOwed, fallbackCount);
    }

    // Effective account list for the offline-payment picker: this club's override if it has one,
    // else the campaign default — same fallback CreatePaymentOrderAsync uses for online routing —
    // with the platform-fee account excluded (online-only). Each option carries the amount THAT
    // specific account still has left to collect (its own unpaid members, not the club's shared
    // unpaid count), so selecting an account shows the right figure instead of the whole club balance.
    public async Task<IEnumerable<ClubDuesOfflineAccountOptionDto>> GetOfflineAccountOptionsAsync(int duesId, int clubId)
    {
        using var conn = GetConnection();
        var rates = await GetClubRatesAsync(conn, duesId, clubId);
        var rows = await GetOfflineEligibleVendorRowsAsync(conn, duesId, clubId, rates.Independent);
        var result = new List<ClubDuesOfflineAccountOptionDto>();
        foreach (var r in rows)
        {
            var (amount, _) = await ResolveAccountAmountAsync(conn, duesId, clubId, rows, (int)r.FkRouteAccountId, rates.OfflineRate, rates.OfflineOwed, rates.Unpaid);
            result.Add(new ClubDuesOfflineAccountOptionDto
            {
                FkRouteAccountId = (int)r.FkRouteAccountId,
                AccountId = (string?)r.AccountId ?? "",
                AccountLabel = BuildAccountLabel((string?)r.AccountName, (string?)r.BankAccountLast4, (string?)r.BankIfsc),
                Amount = amount
            });
        }
        return result;
    }

    public async Task SaveClubVendorsAsync(int duesId, int clubId, string? vendorsJson, int userId, bool isOnline)
    {
        using var conn = GetConnection();
        List<ClubDuesVendorDto> vendors = new();
        if (!string.IsNullOrWhiteSpace(vendorsJson))
        {
            try { vendors = JsonSerializer.Deserialize<List<ClubDuesVendorDto>>(vendorsJson, new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new(); }
            catch { vendors = new(); }
        }
        // A cleared-back-to-empty split means "use the campaign default" — the platform-fee
        // account still gets auto-injected campaign-side, so it isn't re-added here for nothing.
        // Offline never gets the platform-fee cut at all (it never touches Razorpay).
        if (vendors.Count > 0 && isOnline)
        {
            var rates = await GetClubRatesAsync(conn, duesId, clubId);
            var rateForDisplay = rates.Independent ? rates.OnlineRate : rates.OfflineRate; // matches the legacy convention of pricing SplitAmount off the base rate
            vendors = await ApplyPlatformFeeAsync(conn, vendors, rateForDisplay);
        }
        foreach (var v in vendors) v.IsOnline = isOnline;
        await SaveClubVendorsInternalAsync(conn, duesId, clubId, vendors, isOnline);
    }

    // Replaces this club's per-club Razorpay split rows for ONE channel (soft-delete old, insert new)
    // — scoped by IsOnline so saving one track never wipes the other.
    private static async Task SaveClubVendorsInternalAsync(MySqlConnection conn, int duesId, int clubId, List<ClubDuesVendorDto>? vendors, bool isOnline)
    {
        await conn.ExecuteAsync("UPDATE club_dues_club_vendors SET isdeleted=1 WHERE fk_club_dues_id=@DuesId AND fk_club_id=@ClubId AND IsOnline=@IsOnline",
            new { DuesId = duesId, ClubId = clubId, IsOnline = isOnline });
        if (vendors == null || vendors.Count == 0) return;
        var clubDuesClubId = await conn.ExecuteScalarAsync<int?>(
            "SELECT pk_club_dues_club_id FROM club_dues_clubs WHERE fk_club_dues_id=@DuesId AND fk_club_id=@ClubId AND isdeleted=0",
            new { DuesId = duesId, ClubId = clubId });
        foreach (var v in vendors)
        {
            if (string.IsNullOrWhiteSpace(v.AccountId)) continue;
            await conn.ExecuteAsync(@"
                INSERT INTO club_dues_club_vendors (fk_club_dues_id, fk_club_id, fk_club_dues_club_id, fk_route_account_id, AccountId, SplitAmount, SplitPercentage, IsOnline, isdeleted)
                VALUES (@DuesId, @ClubId, @Cc, @FkRouteAccountId, @AccountId, @SplitAmount, @SplitPercentage, @IsOnline, 0)",
                new { DuesId = duesId, ClubId = clubId, Cc = clubDuesClubId, v.FkRouteAccountId, v.AccountId, v.SplitAmount, v.SplitPercentage, IsOnline = isOnline });
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  Receipts & reminders
    // ═══════════════════════════════════════════════════════════════

    public async Task SendReceiptEmailAsync(int paymentId)
    {
        using var conn = GetConnection();
        var info = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT p.Amount, p.MemberCountCovered, p.PaymentDate, cd.Purpose, cd.RotaryYear, cd.EmailCC,
                   cd.EmailSubject, cd.EmailBody, cd.EmailHeaderLogo, d.DistrictNumber, c.ClubName,
                   mm.EmailId AS OfficerEmail, mm.MemberName AS OfficerName
            FROM club_dues_payments p
            JOIN club_dues cd ON cd.pk_club_dues_id = p.fk_club_dues_id
            LEFT JOIN district_master d ON cd.fk_district_id = d.pk_district_id
            LEFT JOIN club_master c ON p.fk_club_id = c.pk_club_id
            LEFT JOIN member_master_profile mm ON mm.pk_member_master_profile_id = p.PaidByMemberId
            WHERE p.pk_club_dues_payment_id=@Id", new { Id = paymentId });
        if (info == null) return;
        var toEmail = (string?)info.OfficerEmail;
        if (string.IsNullOrWhiteSpace(toEmail)) return;

        var clubName = (string?)info.ClubName ?? "";
        var officerName = (string?)info.OfficerName ?? "";
        var year = (string?)info.RotaryYear ?? "";
        var amount = (decimal)info.Amount;
        var covered = (int)info.MemberCountCovered;
        var tokens = new Dictionary<string, string>
        {
            ["clubname"] = clubName,
            ["districtnumber"] = (string?)info.DistrictNumber ?? "",
            ["rotaryyear"] = year,
            ["purpose"] = (string?)info.Purpose ?? "District Dues",
            ["officername"] = officerName,
            ["memberscovered"] = covered.ToString(),
            ["amountpaid"] = amount.ToString("0.00"),
            ["amount"] = amount.ToString("0.00"),
        };

        // The admin's configured Receipt subject/body drive the email; {{tokens}} are substituted.
        // (Previously the configured text was ignored and the whole receipt was hard-coded.)
        var cfgSubject = (string?)info.EmailSubject;
        var cfgBody = (string?)info.EmailBody;
        var subject = !string.IsNullOrWhiteSpace(cfgSubject)
            ? ApplyEmailTokens(cfgSubject, tokens)
            : $"District Dues receipt — {clubName}";
        string inner;
        if (!string.IsNullOrWhiteSpace(cfgBody))
        {
            inner = ApplyEmailTokens(cfgBody, tokens);
            // If the admin's copy referenced no amount/members token, append the standard summary
            // so the receipt always carries the key figures.
            if (!TemplateHasValueToken(cfgBody, "amountpaid", "amount", "memberscovered"))
                inner += ReceiptSummaryHtml(clubName, covered, amount, year);
        }
        else
        {
            inner = $"<p>Dear {officerName},</p><p>Your club's dues payment has been received.</p>"
                  + ReceiptSummaryHtml(clubName, covered, amount, year) + "<p>Thank you.</p>";
        }
        var body = $"<div style='font-family:Arial,sans-serif'>{EmailLogoHtml((string?)info.EmailHeaderLogo)}{inner}</div>";

        var cc = (string?)info.EmailCC;
        if (!string.IsNullOrWhiteSpace(cc)) await _emailService.SendGenericEmailWithCcAsync(toEmail, cc, subject, body);
        else await _emailService.SendGenericEmailAsync(toEmail, subject, body);

        await conn.ExecuteAsync("UPDATE club_dues_payments SET IsReceiptSent=1 WHERE pk_club_dues_payment_id=@Id", new { Id = paymentId });
    }

    private static string ReceiptSummaryHtml(string clubName, int membersCovered, decimal amount, string year) => $@"
<table style='border-collapse:collapse'>
<tr><td style='padding:4px 10px'>Club</td><td style='padding:4px 10px'><b>{clubName}</b></td></tr>
<tr><td style='padding:4px 10px'>Members covered</td><td style='padding:4px 10px'><b>{membersCovered}</b></td></tr>
<tr><td style='padding:4px 10px'>Amount</td><td style='padding:4px 10px'><b>₹{amount:0.00}</b></td></tr>
<tr><td style='padding:4px 10px'>Year</td><td style='padding:4px 10px'>{year}</td></tr>
</table>";

    public async Task SendReminderEmailAsync(int duesId, int clubId, string? remark)
    {
        using var conn = GetConnection();
        var info = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT cd.EmailReminderSubject, cd.EmailReminderBody, cd.ReminderButtonText, cd.Purpose, cd.RotaryYear, cd.EmailHeaderLogo,
                   c.ClubName, cd.fk_district_id, d.DistrictNumber,
                   cd.IsShowBankInReceipt, cd.OfflineBankName, cd.OfflineAccountNumber, cd.OfflineIfscCode
            FROM club_dues cd
            LEFT JOIN club_master c ON c.pk_club_id=@ClubId
            LEFT JOIN district_master d ON d.pk_district_id=cd.fk_district_id
            WHERE cd.pk_club_dues_id=@DuesId", new { DuesId = duesId, ClubId = clubId });
        if (info == null) return;
        var rates = await GetClubRatesAsync(conn, duesId, clubId);
        if (rates.Unpaid <= 0) return;
        // Recipients: club President / Secretary / Treasurer for the campaign year (name + email).
        var recipients = await GetClubOfficerRecipientsAsync(conn, clubId, (string?)info.RotaryYear);

        var clubName = (string?)info.ClubName ?? "";
        var cfgSubject = (string?)info.EmailReminderSubject;
        var cfgBody = (string?)info.EmailReminderBody;
        var logoHtml = EmailLogoHtml((string?)info.EmailHeaderLogo);
        bool showBank = Convert.ToBoolean(info.IsShowBankInReceipt);

        // Non-expiring, stable pay link for the club (same token type as the WhatsApp reminder) —
        // re-sending the reminder re-issues the identical URL rather than a second, different one.
        var secret = _config["JwtSettings:Secret"] ?? "";
        var accessToken = ClubDuesAccessToken.Generate(duesId, clubId, secret);
        var frontendUrl = _config["FrontendUrl"] ?? "http://localhost:3000";
        var payUrl = $"{frontendUrl}/pay/club-dues/{duesId}?clubId={clubId}&token={accessToken}";

        foreach (var r in recipients)
        {
            var tokens = new Dictionary<string, string>
            {
                ["clubname"] = clubName,
                ["districtnumber"] = (string?)info.DistrictNumber ?? "",
                ["rotaryyear"] = (string?)info.RotaryYear ?? "",
                ["purpose"] = (string?)info.Purpose ?? "District Dues",
                ["officername"] = r.Name,
                ["membercount"] = rates.MemberCount.ToString(),
                ["paidcount"] = rates.PaidCount.ToString(),
                ["unpaidcount"] = rates.Unpaid.ToString(),
                ["permemberrate"] = rates.OfflineRate.ToString("0.##"),
                ["amountdue"] = rates.OfflineOwed.ToString("0.00"),
                ["amount"] = rates.OfflineOwed.ToString("0.00"),
                ["onlineratepermember"] = rates.OnlineRate.ToString("0.##"),
                ["offlineratepermember"] = rates.OfflineRate.ToString("0.##"),
                ["onlineamountdue"] = rates.OnlineOwed.ToString("0.00"),
                ["offlineamountdue"] = rates.OfflineOwed.ToString("0.00"),
                ["paylink"] = payUrl,
            };
            var subject = !string.IsNullOrWhiteSpace(cfgSubject)
                ? ApplyEmailTokens(cfgSubject, tokens)
                : $"District Dues reminder — {clubName}";
            string inner;
            if (!string.IsNullOrWhiteSpace(cfgBody))
            {
                inner = ApplyEmailTokens(cfgBody, tokens);
                if (!TemplateHasValueToken(cfgBody, "amountdue", "amount", "unpaidcount", "membercount", "paidcount", "onlineamountdue", "offlineamountdue"))
                    inner += ReminderSummaryHtml(rates.Unpaid, rates.OfflineOwed);
            }
            else
            {
                inner = (string.IsNullOrWhiteSpace(r.Name) ? "" : $"<p>Dear {r.Name},</p>")
                      + ReminderSummaryHtml(rates.Unpaid, rates.OfflineOwed);
            }
            // Pay Now button (always shown in the reminder) → the public pay page, not the portal.
            inner += PayButtonHtml(payUrl, (string?)info.ReminderButtonText);
            // Offline bank details — only when the campaign opted in (IsShowBankInReceipt).
            if (showBank)
                inner += BankDetailsHtml((string?)info.OfflineBankName, (string?)info.OfflineAccountNumber, (string?)info.OfflineIfscCode);
            if (!string.IsNullOrWhiteSpace(remark)) inner += $"<p>{remark}</p>";
            var body = $"<div style='font-family:Arial,sans-serif'>{logoHtml}{inner}</div>";
            try { await _emailService.SendGenericEmailAsync(r.Email, subject, body); } catch { }
        }
    }

    private static string ReminderSummaryHtml(int unpaid, decimal owed) =>
        $"<p>Your club has <b>{unpaid}</b> unpaid member(s). Amount due: <b>₹{owed:0.00}</b>.</p>";

    // Absolute URL for the campaign's Email header logo (stored as a bare filename under
    // Documents/ClubDues). Emails are viewed off-site, so the URL must point at the prod API host.
    private static string CLUB_DUES_MEDIA_BASE => RotaryApi.Services.Brand.ApiOrigin;
    private static string ResolveEmailLogoUrl(string? headerLogo)
    {
        if (string.IsNullOrWhiteSpace(headerLogo)) return "";
        if (headerLogo.StartsWith("http", StringComparison.OrdinalIgnoreCase)) return headerLogo;
        if (headerLogo.StartsWith("/")) return $"{CLUB_DUES_MEDIA_BASE}{headerLogo}";
        return $"{CLUB_DUES_MEDIA_BASE}/Documents/ClubDues/{headerLogo}";
    }
    // Header-logo <img> block for the top of a dues email (empty when no logo is configured).
    private static string EmailLogoHtml(string? headerLogo)
    {
        var url = ResolveEmailLogoUrl(headerLogo);
        return string.IsNullOrEmpty(url) ? "" : $"<div style='margin-bottom:14px'><img src='{url}' alt='' style='max-height:70px;max-width:240px;object-fit:contain'/></div>";
    }

    // "Pay Now/Record Offline Payment Here" button (inline styles for email clients) → the public pay page.
    // Text is configurable per campaign (ReminderButtonText); falls back to the default when blank.
    private static string PayButtonHtml(string payUrl, string? buttonText = null)
    {
        var text = string.IsNullOrWhiteSpace(buttonText) ? "Pay Now/Record Offline Payment Here" : buttonText;
        return $@"<div style='margin:18px 0'><a href='{payUrl}' style='display:inline-block;background:#1a365d;color:#ffffff;padding:12px 30px;border-radius:6px;text-decoration:none;font-weight:bold;font-family:Arial,sans-serif'>{text}</a></div>";
    }

    // Offline settlement bank details block (reminder only, when opted in). Shows only non-empty fields.
    private static string BankDetailsHtml(string? bankName, string? acctNo, string? ifsc)
    {
        var rows = new List<string>();
        if (!string.IsNullOrWhiteSpace(bankName)) rows.Add($"Bank: <b>{bankName}</b>");
        if (!string.IsNullOrWhiteSpace(acctNo)) rows.Add($"A/C No.: <b>{acctNo}</b>");
        if (!string.IsNullOrWhiteSpace(ifsc)) rows.Add($"IFSC: <b>{ifsc}</b>");
        if (rows.Count == 0) return "";
        return $@"<div style='margin-top:14px;padding:12px 14px;border:1px solid #e2e8f0;border-radius:6px;background:#f8fafc;font-family:Arial,sans-serif'>
<p style='margin:0 0 6px;font-weight:bold'>To pay offline, transfer to:</p>{string.Join("<br/>", rows)}</div>";
    }

    public async Task BulkSendReminderEmailAsync(int duesId, string? remark)
    {
        using var conn = GetConnection();
        var clubIds = (await conn.QueryAsync<int>(@"
            SELECT cc.fk_club_id FROM club_dues_clubs cc
            WHERE cc.fk_club_dues_id=@DuesId AND cc.isdeleted=0
              AND (SELECT COUNT(*) FROM club_dues_members m WHERE m.fk_club_dues_id=cc.fk_club_dues_id AND m.fk_club_id=cc.fk_club_id AND m.isdeleted=0 AND m.IsHonorary=0 AND m.IsPaid=0) > 0",
            new { DuesId = duesId })).ToList();
        foreach (var clubId in clubIds)
            try { await SendReminderEmailAsync(duesId, clubId, remark); } catch { }
    }

    // Sends a TEST reminder/receipt email (rendered with sample figures + the current template text)
    // to an arbitrary address, so an admin can preview exactly what recipients get before sending for
    // real. District Dues emails are FREE — no wallet credit is consumed.
    public async Task SendTestEmailAsync(ClubDuesTestEmailDto dto, IFormFile? emailLogo, int userId)
    {
        if (string.IsNullOrWhiteSpace(dto.Email) || !dto.Email.Contains('@'))
            throw new InvalidOperationException("Enter a valid email address.");
        if (dto.DistrictId <= 0)
            throw new InvalidOperationException("Select a district before sending a test email.");

        using var conn = GetConnection();
        var districtNumber = await conn.ExecuteScalarAsync<string?>(
            "SELECT DistrictNumber FROM district_master WHERE pk_district_id=@Id", new { Id = dto.DistrictId }) ?? "";
        // Saved email header logo for this campaign (edit mode) — so the test matches the real email.
        var headerLogo = dto.DuesId > 0
            ? await conn.ExecuteScalarAsync<string?>("SELECT EmailHeaderLogo FROM club_dues WHERE pk_club_dues_id=@Id AND isdeleted=0", new { Id = dto.DuesId })
            : null;

        // If the admin picked a NEW header logo (not yet saved), embed THAT inline so it can be
        // previewed before saving — a URL wouldn't work (the file isn't hosted anywhere public yet).
        byte[]? inlineLogoBytes = null;
        string? inlineLogoCid = null;
        if (emailLogo != null && emailLogo.Length > 0)
        {
            using var ms = new MemoryStream();
            await emailLogo.CopyToAsync(ms);
            inlineLogoBytes = ms.ToArray();
            inlineLogoCid = $"headerlogo{Path.GetExtension(emailLogo.FileName)}";
        }

        // Representative sample values (a real send pulls these from the club/payment).
        const string clubName = "Sample Rotary Club";
        const string year = "2026-27";
        const string officerName = "Club Officer";
        int memberCount = 20, paidCount = 2, unpaid = 18, membersCovered = 18;
        decimal rate = 100m, owed = unpaid * rate, amountPaid = owed;
        decimal onlineRateSample = 103m, onlineOwedSample = unpaid * onlineRateSample;

        var secret = _config["JwtSettings:Secret"] ?? "";
        var accessToken = ClubDuesAccessToken.Generate(dto.DuesId, 0, secret);
        var frontendUrl = _config["FrontendUrl"] ?? "http://localhost:3000";
        var payUrl = $"{frontendUrl}/pay/club-dues/{dto.DuesId}?clubId=0&token={accessToken}";

        var tokens = new Dictionary<string, string>
        {
            ["clubname"] = clubName,
            ["districtnumber"] = districtNumber,
            ["rotaryyear"] = year,
            ["purpose"] = "District Dues",
            ["officername"] = officerName,
            ["membercount"] = memberCount.ToString(),
            ["paidcount"] = paidCount.ToString(),
            ["unpaidcount"] = unpaid.ToString(),
            ["permemberrate"] = rate.ToString("0.##"),
            ["amountdue"] = owed.ToString("0.00"),
            ["amountpaid"] = amountPaid.ToString("0.00"),
            ["amount"] = owed.ToString("0.00"),
            ["memberscovered"] = membersCovered.ToString(),
            ["onlineratepermember"] = onlineRateSample.ToString("0.##"),
            ["offlineratepermember"] = rate.ToString("0.##"),
            ["onlineamountdue"] = onlineOwedSample.ToString("0.00"),
            ["offlineamountdue"] = owed.ToString("0.00"),
            ["paylink"] = payUrl,
        };

        bool isReminder = string.Equals(dto.Type, "reminder", StringComparison.OrdinalIgnoreCase);
        string subject, inner;
        if (isReminder)
        {
            subject = !string.IsNullOrWhiteSpace(dto.Subject) ? ApplyEmailTokens(dto.Subject, tokens) : $"District Dues reminder — {clubName}";
            if (!string.IsNullOrWhiteSpace(dto.Body))
            {
                inner = ApplyEmailTokens(dto.Body, tokens);
                if (!TemplateHasValueToken(dto.Body, "amountdue", "amount", "unpaidcount", "membercount", "paidcount", "onlineamountdue", "offlineamountdue"))
                    inner += ReminderSummaryHtml(unpaid, owed);
            }
            else inner = $"<p>Dear {officerName},</p>" + ReminderSummaryHtml(unpaid, owed);
            inner += PayButtonHtml(payUrl, dto.ButtonText);
            if (dto.ShowBank) inner += BankDetailsHtml(dto.BankName, dto.AccountNumber, dto.Ifsc);
        }
        else
        {
            subject = !string.IsNullOrWhiteSpace(dto.Subject) ? ApplyEmailTokens(dto.Subject, tokens) : $"District Dues receipt — {clubName}";
            if (!string.IsNullOrWhiteSpace(dto.Body))
            {
                inner = ApplyEmailTokens(dto.Body, tokens);
                if (!TemplateHasValueToken(dto.Body, "amountpaid", "amount", "memberscovered"))
                    inner += ReceiptSummaryHtml(clubName, membersCovered, amountPaid, year);
            }
            else inner = $"<p>Dear {officerName},</p><p>Your club's dues payment has been received.</p>"
                       + ReceiptSummaryHtml(clubName, membersCovered, amountPaid, year) + "<p>Thank you.</p>";
        }

        if (inlineLogoBytes != null && inlineLogoCid != null)
        {
            // Just-picked (unsaved) logo → embed inline via CID so it renders without a public URL.
            var logoHtml = $"<div style='margin-bottom:14px'><img src='cid:{inlineLogoCid}' alt='' style='max-height:70px;max-width:240px;object-fit:contain'/></div>";
            var body = $"<div style='font-family:Arial,sans-serif'>{logoHtml}{inner}</div>";
            await _emailService.SendEmailWithAttachmentAsync(dto.Email, $"[TEST] {subject}", body, inlineLogoBytes, inlineLogoCid);
        }
        else
        {
            // Otherwise use the campaign's saved header logo by URL (matches the real email exactly).
            var body = $"<div style='font-family:Arial,sans-serif'>{EmailLogoHtml(headerLogo)}{inner}</div>";
            await _emailService.SendGenericEmailAsync(dto.Email, $"[TEST] {subject}", body);
        }
    }

    // Club President / Secretary / Treasurer for the campaign year — name + email (for {{officerName}}).
    private async Task<List<(string Name, string Email)>> GetClubOfficerRecipientsAsync(MySqlConnection conn, int clubId, string? yearLabel)
    {
        var rows = await conn.QueryAsync<dynamic>(@"
            SELECT DISTINCT m.MemberName AS Name, m.EmailId AS Email
            FROM board_of_directors bod
            JOIN member_master_profile m ON m.pk_member_master_profile_id = bod.fk_member_master_profile_id
            JOIN designation_master dm ON dm.pk_designation_id = bod.fk_designation_id
            JOIN rotary_year_master y ON y.pk_year_id = bod.fk_year_id
            WHERE bod.fk_club_id=@ClubId AND COALESCE(bod.isdeleted,0)=0 AND m.isdeleted=0
              AND m.EmailId IS NOT NULL AND m.EmailId <> ''
              AND dm.designation_name IN ('Club President','Club Secretary','Club Treasurer')
              AND ((@Year IS NOT NULL AND @Year<>'' AND y.YearLabel=@Year) OR ((@Year IS NULL OR @Year='') AND y.IsCurrent=1))",
            new { ClubId = clubId, Year = yearLabel });
        return rows.Select(r => ((string)(r.Name ?? ""), (string)(r.Email ?? ""))).ToList();
    }

    // ── Email template tokens ({{clubName}}, {{amountDue}}, {{payLink}}, …) ──
    // Substitutes {{ token }} (case-insensitive, spaces tolerated) with values; any token not in
    // the map is removed so a stray/unknown {{...}} never leaks into a sent email.
    private static string ApplyEmailTokens(string? template, IReadOnlyDictionary<string, string> tokens)
    {
        if (string.IsNullOrEmpty(template)) return "";
        return System.Text.RegularExpressions.Regex.Replace(template, @"\{\{\s*([A-Za-z0-9_]+)\s*\}\}",
            m => tokens.TryGetValue(m.Groups[1].Value.ToLowerInvariant(), out var v) ? v : "");
    }

    // True when the template references any of the given value tokens — used to decide whether to
    // auto-append the figures (so numbers are never lost if the admin's copy omits them).
    private static bool TemplateHasValueToken(string? template, params string[] names)
    {
        if (string.IsNullOrEmpty(template)) return false;
        foreach (System.Text.RegularExpressions.Match m in System.Text.RegularExpressions.Regex.Matches(template, @"\{\{\s*([A-Za-z0-9_]+)\s*\}\}"))
            if (Array.IndexOf(names, m.Groups[1].Value.ToLowerInvariant()) >= 0) return true;
        return false;
    }

    // ── WhatsApp reminders (Interakt) ───────────────────────────
    // Templates: updated_row_district_dues_collection (bank details on) /
    // updated_row_district_dues_collection_no_bank_details (off).
    public async Task SendReminderWhatsAppAsync(int duesId, int clubId)
    {
        using var conn = GetConnection();
        await SendReminderWhatsAppInternalAsync(conn, duesId, clubId);
    }

    public async Task BulkSendReminderWhatsAppAsync(int duesId)
    {
        using var conn = GetConnection();
        var clubIds = (await conn.QueryAsync<int>(@"
            SELECT cc.fk_club_id FROM club_dues_clubs cc
            WHERE cc.fk_club_dues_id=@DuesId AND cc.isdeleted=0
              AND (SELECT COUNT(*) FROM club_dues_members m WHERE m.fk_club_dues_id=cc.fk_club_dues_id AND m.fk_club_id=cc.fk_club_id AND m.isdeleted=0 AND m.IsHonorary=0 AND m.IsPaid=0) > 0",
            new { DuesId = duesId })).ToList();
        foreach (var clubId in clubIds)
            try { await SendReminderWhatsAppInternalAsync(conn, duesId, clubId); } catch { }
    }

    private async Task SendReminderWhatsAppInternalAsync(MySqlConnection conn, int duesId, int clubId)
    {
        var info = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT cd.Purpose, cd.RotaryYear, cd.IsShowBankInReceipt,
                   cd.OfflineBankName, cd.OfflineAccountNumber, cd.OfflineIfscCode, c.ClubName
            FROM club_dues cd LEFT JOIN club_master c ON c.pk_club_id=@ClubId
            WHERE cd.pk_club_dues_id=@DuesId AND cd.isdeleted=0", new { DuesId = duesId, ClubId = clubId });
        if (info == null) return;
        var rates = await GetClubRatesAsync(conn, duesId, clubId);
        if (rates.Unpaid <= 0) return;

        // Recipients: the club's President / Secretary / Treasurer (current year) with a mobile.
        var officers = (await conn.QueryAsync<dynamic>(@"
            SELECT DISTINCT m.MemberName, m.PrimaryMobileNumber
            FROM board_of_directors bod
            JOIN member_master_profile m ON m.pk_member_master_profile_id = bod.fk_member_master_profile_id
            JOIN designation_master dm ON dm.pk_designation_id = bod.fk_designation_id
            JOIN rotary_year_master y ON y.pk_year_id = bod.fk_year_id
            WHERE bod.fk_club_id=@ClubId AND COALESCE(bod.isdeleted,0)=0 AND m.isdeleted=0
              AND m.PrimaryMobileNumber IS NOT NULL AND m.PrimaryMobileNumber <> ''
              AND dm.designation_name IN ('Club President','Club Secretary','Club Treasurer') AND y.IsCurrent=1",
            new { ClubId = clubId })).ToList();
        if (officers.Count == 0) return;

        var secret = _config["JwtSettings:Secret"] ?? "";
        var token = ClubDuesAccessToken.Generate(duesId, clubId, secret); // non-expiring, stable per club
        var frontendUrl = _config["FrontendUrl"] ?? "http://localhost:3000";
        var payUrl = $"{frontendUrl}/pay/club-dues/{duesId}?clubId={clubId}&token={token}";

        // Bank details only make sense when the campaign both wants them shown AND actually has
        // an offline track configured (ModeOfPayment 2/3) — an online-only campaign has no bank
        // details to send regardless of the checkbox.
        bool showBank = Convert.ToBoolean(info.IsShowBankInReceipt) && ChannelEnabled(rates.ModeOfPayment, isOnline: false);
        var template = showBank ? "updated_row_district_dues_collection" : "updated_row_district_dues_collection_no_bank_details";
        var purpose = (string?)info.Purpose ?? "District Dues";
        var clubName = (string?)info.ClubName ?? "-";
        var status = rates.Independent
            ? $"₹{rates.OfflineOwed:0} offline / ₹{rates.OnlineOwed:0} online pending ({rates.Unpaid} member(s))"
            : $"₹{rates.OfflineOwed:0} pending ({rates.Unpaid} member(s))";

        foreach (var o in officers)
        {
            var name = (string?)o.MemberName ?? "";
            var mobile = (string?)o.PrimaryMobileNumber ?? "";
            if (string.IsNullOrWhiteSpace(mobile)) continue;
            // Body params mirror the membership-dues templates:
            //  with bank (8): name, club, purpose, status, payUrl, bank, account, ifsc
            //  no bank  (5): name, club, purpose, status, payUrl
            string[] values = showBank
                ? new[] { name, clubName, purpose, status, payUrl,
                          (string?)info.OfflineBankName ?? "-", (string?)info.OfflineAccountNumber ?? "-", (string?)info.OfflineIfscCode ?? "-" }
                : new[] { name, clubName, purpose, status, payUrl };
            try { await _interaktService.SendWhatsAppWithBodyValuesAsync(mobile, template, values); }
            catch (Exception ex) { _logger.LogError(ex, "Club dues WhatsApp failed for club {Club} mobile {Mobile}", clubId, mobile); }
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  Public / payment
    // ═══════════════════════════════════════════════════════════════

    public async Task<PublicClubDuesDto?> GetPublicDuesAsync(int duesId, int clubId)
    {
        using var conn = GetConnection();
        await SyncClubsAndMembersInternalAsync(conn, duesId, 0, null);
        var dto = await conn.QueryFirstOrDefaultAsync<PublicClubDuesDto>(@"
            SELECT cd.pk_club_dues_id AS Id, cd.Purpose, cd.PurposeDescription, cd.PurposeLogo, cd.BackgroundImage,
                   d.DistrictNumber, cd.ModeOfPayment, cd.OnlineSurchargePercent, @ClubId AS FkClubId, c.ClubName,
                   cd.OfflineBankName, cd.OfflineAccountNumber, cd.OfflineIfscCode
            FROM club_dues cd
            LEFT JOIN district_master d ON cd.fk_district_id = d.pk_district_id
            LEFT JOIN club_master c ON c.pk_club_id = @ClubId
            WHERE cd.pk_club_dues_id=@DuesId AND cd.isdeleted=0", new { DuesId = duesId, ClubId = clubId });
        if (dto == null) return null;
        var rates = await GetClubRatesAsync(conn, duesId, clubId);
        dto.PerMemberRate = rates.OfflineRate;
        dto.MemberCount = rates.MemberCount;
        dto.PaidCount = rates.PaidCount;
        dto.UnpaidCount = rates.Unpaid;
        dto.AmountOwed = rates.OfflineOwed;      // offline / base amount
        dto.OnlineAmountOwed = rates.OnlineOwed; // independently resolved — legacy still derives it via surcharge inside GetClubRatesAsync
        dto.IsFullyPaid = rates.MemberCount > 0 && rates.Unpaid == 0;
        dto.IsPending = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM club_dues_payments WHERE fk_club_dues_id=@DuesId AND fk_club_id=@ClubId AND OfflineStatus='Pending' AND isdeleted=0",
            new { DuesId = duesId, ClubId = clubId }) > 0;

        // Surface the last rejection ONLY if the most recent offline submission was the rejected one
        // (a newer Pending/Approved submission supersedes it, so we don't nag after resubmission).
        var lastOffline = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT OfflineStatus, RejectionReason, RejectedDate
            FROM club_dues_payments
            WHERE fk_club_dues_id=@DuesId AND fk_club_id=@ClubId AND IsOnline=0 AND isdeleted=0
            ORDER BY pk_club_dues_payment_id DESC LIMIT 1", new { DuesId = duesId, ClubId = clubId });
        if (lastOffline != null && (string?)lastOffline.OfflineStatus == "Rejected")
        {
            dto.LastRejectedReason = (string?)lastOffline.RejectionReason;
            dto.LastRejectedDate = (DateTime?)lastOffline.RejectedDate;
        }
        return dto;
    }

    public async Task<ClubDuesPaymentSessionResponseDto> CreatePaymentOrderAsync(int duesId, PublicClubDuesPaymentSubmitDto dto)
    {
        using var conn = GetConnection();
        await SyncClubsAndMembersInternalAsync(conn, duesId, 0, null);
        var rates = await GetClubRatesAsync(conn, duesId, dto.FkClubId);
        if (!ChannelEnabled(rates.ModeOfPayment, isOnline: true))
            throw new InvalidOperationException("Online payment is not enabled for this campaign.");
        if (rates.Unpaid <= 0 || rates.OnlineOwed <= 0) throw new InvalidOperationException("This club has no dues to pay.");

        decimal onlineOwed = rates.OnlineOwed;

        var club = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT ClubName FROM club_master WHERE pk_club_id=@Id", new { Id = dto.FkClubId });
        var officer = dto.PaidByMemberId.HasValue
            ? await conn.QueryFirstOrDefaultAsync<dynamic>("SELECT MemberName, PrimaryMobileNumber, EmailId FROM member_master_profile WHERE pk_member_master_profile_id=@Id", new { Id = dto.PaidByMemberId })
            : null;

        long amountPaise = (long)Math.Round(onlineOwed * 100m, MidpointRounding.AwayFromZero);
        var receipt = $"CDUE{duesId}_{DateTime.Now:ddMMyyyyHHmmss}";

        var paymentId = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO club_dues_payments (fk_club_dues_id, fk_club_id, Amount, MemberCountCovered, PaidByMemberId,
                IsPaid, IsOnline, PaymentStatus, created_date)
            VALUES (@DuesId, @ClubId, @Amount, @Count, @PaidBy, 0, 1, 'ACTIVE', NOW());
            SELECT LAST_INSERT_ID();",
            new { DuesId = duesId, ClubId = dto.FkClubId, Amount = onlineOwed, Count = rates.Unpaid, PaidBy = dto.PaidByMemberId });

        // Razorpay Route: build transfers to the linked account(s). Prefer this CLUB's own split
        // override (club_dues_club_vendors) if it has one; otherwise fall back to the campaign default
        // (club_dues_vendors). Percentages of the live total; last account absorbs paise rounding.
        var vendors = await GetEffectiveVendorRowsAsync(conn, duesId, dto.FkClubId, isOnline: true);
        // Split the order amount across the linked accounts by percentage (amount-mode splits are
        // converted to a % of the total on save, so both modes land here as percentages). When the
        // accounts cover the whole amount (~100%) the LAST one absorbs any paise rounding so the
        // transfers sum EXACTLY to the order amount (Razorpay rejects transfers exceeding it); a
        // partial split (< 100%) leaves the remainder in the main account.
        var transfers = new List<object>();
        decimal totalPct = vendors.Sum(v => (decimal)v.SplitPercentage);
        bool fullSplit = totalPct >= 99.5m;
        long allocated = 0;
        for (int i = 0; i < vendors.Count; i++)
        {
            var v = vendors[i];
            long tp;
            if (i == vendors.Count - 1 && fullSplit)
                tp = amountPaise - allocated;
            else
            {
                tp = (long)Math.Round(amountPaise * (decimal)v.SplitPercentage / 100m, MidpointRounding.AwayFromZero);
                if (tp > amountPaise - allocated) tp = amountPaise - allocated;
            }
            if (tp > 0) { transfers.Add(new { account = (string)v.AccountId, amount = tp, currency = "INR", on_hold = 0 }); allocated += tp; }
        }

        var baseUrl = (_config["Razorpay:BaseUrl"] ?? "https://api.razorpay.com/v1").TrimEnd('/');
        var keyId = _config["Razorpay:KeyId"];
        var keySecret = _config["Razorpay:KeySecret"];
        if (string.IsNullOrWhiteSpace(keyId) || string.IsNullOrWhiteSpace(keySecret) || keySecret!.Contains("PLACEHOLDER", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Razorpay is not configured.");

        var notes = new { clubDuesId = duesId.ToString(), clubId = dto.FkClubId.ToString(), paymentId = paymentId.ToString(), clubName = (string?)club?.ClubName ?? "", description = $"Club dues — {(string?)club?.ClubName}" };
        object orderPayload = transfers.Count > 0
            ? new { amount = amountPaise, currency = "INR", receipt, notes, transfers = transfers.ToArray() }
            : new { amount = amountPaise, currency = "INR", receipt, notes };

        var json = JsonSerializer.Serialize(orderPayload);
        using var request = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}/orders")
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json")
        };
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue(
            "Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes($"{keyId}:{keySecret}")));

        var response = await _httpClient.SendAsync(request);
        var responseBody = await response.Content.ReadAsStringAsync();
        if (!response.IsSuccessStatusCode)
        {
            _logger.LogError("Razorpay create order (district dues) failed: {Status} {Body}", response.StatusCode, responseBody);
            throw new Exception("Payment gateway error creating order.");
        }
        using var respDoc = JsonDocument.Parse(responseBody);
        var razorpayOrderId = respDoc.RootElement.GetProperty("id").GetString()!;

        await conn.ExecuteAsync(
            "UPDATE club_dues_payments SET RazorpayOrderId=@Rid, OrderSplitsJson=@Splits WHERE pk_club_dues_payment_id=@Id",
            new { Rid = razorpayOrderId, Splits = JsonSerializer.Serialize(transfers), Id = paymentId });

        return new ClubDuesPaymentSessionResponseDto
        {
            KeyId = keyId!,
            RazorpayOrderId = razorpayOrderId,
            AmountPaise = amountPaise,
            Receipt = receipt,
            PaymentId = paymentId,
            CustomerName = (string?)officer?.MemberName ?? (string?)club?.ClubName,
            CustomerEmail = (string?)officer?.EmailId,
            CustomerPhone = (string?)officer?.PrimaryMobileNumber
        };
    }

    // Razorpay checkout callback → verify the signature, then mark paid + cover members.
    public async Task<VerifyPaymentResponseDto> VerifyPaymentAsync(int duesId, ClubDuesVerifyDto dto)
    {
        using var conn = GetConnection();
        var payment = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT fk_club_id, MemberCountCovered, IsPaid, RazorpayOrderId FROM club_dues_payments WHERE pk_club_dues_payment_id=@Id AND isdeleted=0",
            new { Id = dto.PaymentId });
        if (payment == null) return new VerifyPaymentResponseDto { IsSuccess = false, OrderStatus = "NOT_FOUND" };
        if ((string?)payment.RazorpayOrderId != dto.RazorpayOrderId)
            return new VerifyPaymentResponseDto { IsSuccess = false, OrderStatus = "MISMATCH" };

        // IsPaid is TINYINT(1) → MySqlConnector maps it to bool; Convert.ToInt32 handles bool/sbyte/int.
        if (Convert.ToInt32(payment.IsPaid) == 0)
        {
            if (!RazorpayGatewayProxy.VerifyPaymentSignature(_config, dto.RazorpayOrderId, dto.RazorpayPaymentId, dto.RazorpaySignature))
                return new VerifyPaymentResponseDto { IsSuccess = false, OrderStatus = "SIGNATURE_FAILED" };
            await conn.ExecuteAsync(@"
                UPDATE club_dues_payments SET IsPaid=1, IsOnline=1, PaymentStatus='PAID', PaidSource='Page',
                    RazorpayPaymentId=@Pid, RazorpaySignature=@Sig, PaymentDate=NOW()
                WHERE pk_club_dues_payment_id=@Id AND IsPaid=0",
                new { Pid = dto.RazorpayPaymentId, Sig = dto.RazorpaySignature, Id = dto.PaymentId });
            // Online payments settle every configured online account at once — Razorpay Route
            // splits one payment into transfers to all of them atomically.
            var settledAccountIds = await ResolveSettledAccountIdsAsync(conn, duesId, (int)payment.fk_club_id, isOnline: true, null);
            await CoverUnpaidMembersAsync(conn, duesId, (int)payment.fk_club_id, dto.PaymentId, (int)payment.MemberCountCovered, settledAccountIds);
            await SyncGoogleSheetIfEnabledAsync(duesId);
            _ = Task.Run(async () => { try { await SendReceiptEmailAsync(dto.PaymentId); } catch { } });
        }
        var info = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT c.ClubName, p.Amount FROM club_dues_payments p LEFT JOIN club_master c ON c.pk_club_id=p.fk_club_id
            WHERE p.pk_club_dues_payment_id=@Id", new { Id = dto.PaymentId });
        return new VerifyPaymentResponseDto
        {
            IsSuccess = true, OrderStatus = "PAID",
            MemberName = (string?)info?.ClubName, Amount = info?.Amount,
            RegistrationType = "District Dues", PaymentDate = DateTime.Now
        };
    }

    // Razorpay webhook (X-Razorpay-Signature) — idempotent backstop for order.paid / payment.captured.
    public async Task HandleWebhookAsync(string rawBody, string signatureHeader)
    {
        if (!RazorpayGatewayProxy.VerifyWebhookSignature(_config, rawBody, signatureHeader))
            throw new UnauthorizedAccessException("Invalid webhook signature.");
        try
        {
            using var doc = JsonDocument.Parse(rawBody);
            var root = doc.RootElement;
            var evt = root.TryGetProperty("event", out var e) ? e.GetString() : null;
            if (evt != "payment.captured" && evt != "order.paid") return;

            string? razorpayOrderId = null, razorpayPaymentId = null;
            if (root.TryGetProperty("payload", out var payload))
            {
                if (payload.TryGetProperty("payment", out var pay) && pay.TryGetProperty("entity", out var payEnt))
                {
                    if (payEnt.TryGetProperty("order_id", out var oid)) razorpayOrderId = oid.GetString();
                    if (payEnt.TryGetProperty("id", out var pid)) razorpayPaymentId = pid.GetString();
                }
                if (razorpayOrderId == null && payload.TryGetProperty("order", out var ord)
                    && ord.TryGetProperty("entity", out var ordEnt) && ordEnt.TryGetProperty("id", out var orderIdEl))
                    razorpayOrderId = orderIdEl.GetString();
            }
            if (string.IsNullOrWhiteSpace(razorpayOrderId)) return;

            using var conn = GetConnection();
            var payment = await conn.QueryFirstOrDefaultAsync<dynamic>(
                "SELECT pk_club_dues_payment_id, fk_club_dues_id, fk_club_id, MemberCountCovered, IsPaid FROM club_dues_payments WHERE RazorpayOrderId=@Oid",
                new { Oid = razorpayOrderId });
            if (payment == null || Convert.ToInt32(payment.IsPaid) == 1) return;

            int pId = (int)payment.pk_club_dues_payment_id;
            int dId = (int)payment.fk_club_dues_id;
            int clubId = (int)payment.fk_club_id;
            int count = (int)payment.MemberCountCovered;
            await conn.ExecuteAsync(@"
                UPDATE club_dues_payments SET IsPaid=1, IsOnline=1, PaymentStatus='PAID', PaidSource='Webhook',
                    RazorpayPaymentId=COALESCE(NULLIF(@Pid,''),RazorpayPaymentId), PaymentDate=NOW(),
                    IsWebhookReceived=1, WebhookReceivedDate=NOW()
                WHERE RazorpayOrderId=@Oid AND IsPaid=0", new { Pid = razorpayPaymentId ?? "", Oid = razorpayOrderId });
            var settledAccountIds = await ResolveSettledAccountIdsAsync(conn, dId, clubId, isOnline: true, null);
            await CoverUnpaidMembersAsync(conn, dId, clubId, pId, count, settledAccountIds);
            await SyncGoogleSheetIfEnabledAsync(dId);
            try { await SendReceiptEmailAsync(pId); } catch { }
        }
        catch (UnauthorizedAccessException) { throw; }
        catch (Exception ex) { _logger.LogError(ex, "Club dues Razorpay webhook processing failed"); }
    }

    public ClubDuesPayLinkDto GeneratePayLink(int duesId, int clubId, string frontendUrl)
    {
        var secret = _config["JwtSettings:Secret"] ?? "";
        var token = ClubDuesAccessToken.Generate(duesId, clubId, secret); // non-expiring; identical every call
        var baseUrl = string.IsNullOrWhiteSpace(frontendUrl) ? (_config["FrontendUrl"] ?? "http://localhost:3000") : frontendUrl;
        return new ClubDuesPayLinkDto
        {
            Url = $"{baseUrl}/pay/club-dues/{duesId}?clubId={clubId}&token={token}",
            // The link no longer expires. A far-future sentinel is kept (instead of dropping the
            // field or sending null) so existing web/mobile clients that parse this date still work.
            ExpiresAtUtc = DateTime.UtcNow.AddYears(100)
        };
    }

    // ═══════════════════════════════════════════════════════════════
    //  Report / export
    // ═══════════════════════════════════════════════════════════════

    public async Task<object?> GetPublicReportAsync(int duesId)
    {
        using var conn = GetConnection();
        // camelCase aliases — returned as a Dapper `dynamic`, whose keys serialize verbatim, so they
        // must match the report page's camelCase reads (dues.purpose, dues.districtNumber…).
        var dues = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT cd.pk_club_dues_id AS id, cd.Purpose AS purpose, cd.RotaryYear AS rotaryYear, d.DistrictNumber AS districtNumber
            FROM club_dues cd LEFT JOIN district_master d ON cd.fk_district_id=d.pk_district_id
            WHERE cd.pk_club_dues_id=@Id AND cd.isdeleted=0", new { Id = duesId });
        if (dues == null) return null;
        var clubs = await GetEnrichedClubsAsync(duesId);
        return new { dues, clubs };
    }

    // Report-only enrichment on top of GetClubsAsync: how each club actually paid. One row per
    // club — the LATEST paid payment — so callers (public report page, Google Sheet) can show
    // Payment Mode (Online/Offline) and, for offline, the reference/mode/remark/date captured
    // on the offline form. Shared so the report JSON and the Google Sheet never drift apart.
    private async Task<List<ClubDuesClubListDto>> GetEnrichedClubsAsync(int duesId)
    {
        var clubs = (await GetClubsAsync(duesId, null, true)).ToList();

        using var conn = GetConnection();
        var lastPaid = (await conn.QueryAsync<dynamic>(@"
            SELECT p.fk_club_id AS FkClubId, p.IsOnline, p.OfflineTransactionType, p.OfflineTransactionId,
                   p.OfflineRemark, p.PaymentDate, ra.Name AS AccountName, ra.BankAccountLast4, ra.BankIfsc
            FROM club_dues_payments p
            LEFT JOIN razorpay_route_accounts ra ON p.FkRouteAccountId = ra.pk_id
            JOIN (SELECT fk_club_id, MAX(pk_club_dues_payment_id) AS pid
                  FROM club_dues_payments
                  WHERE fk_club_dues_id=@DuesId AND IsPaid=1 AND isdeleted=0
                  GROUP BY fk_club_id) latest ON latest.pid = p.pk_club_dues_payment_id",
            new { DuesId = duesId })).ToDictionary(r => (int)r.FkClubId);
        foreach (var c in clubs)
        {
            if (!lastPaid.TryGetValue(c.FkClubId, out var p)) continue;
            // PaidOnline itself is already set by GetClubsAsync (any-payment-ever, not just latest) —
            // this enrichment only adds the latest payment's transaction detail fields.
            c.OfflineTransactionType = (string?)p.OfflineTransactionType;
            c.OfflineTransactionId = (string?)p.OfflineTransactionId;
            c.OfflineRemark = (string?)p.OfflineRemark;
            c.PaymentDate = (DateTime?)p.PaymentDate;
            if (c.PaidOnline == false && (string?)p.AccountName != null)
                c.OfflineAccountLabel = BuildAccountLabel((string?)p.AccountName, (string?)p.BankAccountLast4, (string?)p.BankIfsc);
        }
        return clubs;
    }

    public async Task<byte[]> ExportClubsCsvAsync(int duesId)
    {
        var clubs = (await GetClubsAsync(duesId, null, true)).ToList();
        using var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add("District Dues");
        string[] headers = { "Club", "Synced", "Members", "Paid", "Unpaid", "Amount Paid",
            "Online Rate", "Online Amount", "Online Paid", "Offline Rate", "Offline Amount", "Offline Paid",
            "Total Paid", "Status" };
        for (int i = 0; i < headers.Length; i++) ws.Cell(1, i + 1).Value = headers[i];
        ws.Range(1, 1, 1, headers.Length).Style.Font.SetBold().Fill.SetBackgroundColor(XLColor.LightGray);
        int row = 2;
        foreach (var c in clubs)
        {
            ws.Cell(row, 1).Value = c.ClubName;
            ws.Cell(row, 2).Value = c.IsSyncedFromRotaryOrg ? "Yes" : "No";
            ws.Cell(row, 3).Value = c.MemberCount;
            ws.Cell(row, 4).Value = c.PaidCount;
            ws.Cell(row, 5).Value = c.UnpaidCount;
            ws.Cell(row, 6).Value = c.AmountPaid;

            // Once one channel has won (PaidOnline true/false), the other channel's own
            // numbers are moot for this club — leave those cells blank instead of showing
            // stale rate/amount figures next to a paid-elsewhere club. Nothing paid yet
            // (PaidOnline == null) still shows both, since neither has been ruled out.
            if (c.PaidOnline != false)
            {
                ws.Cell(row, 7).Value = c.OnlinePerMemberRate;
                ws.Cell(row, 8).Value = c.OnlineAmount;
                ws.Cell(row, 9).Value = c.OnlinePaid;
            }
            if (c.PaidOnline != true)
            {
                ws.Cell(row, 10).Value = c.OfflinePerMemberRate;
                ws.Cell(row, 11).Value = c.OfflineAmount;
                ws.Cell(row, 12).Value = c.OfflinePaid;
            }

            ws.Cell(row, 13).Value = c.TotalPaid;
            ws.Cell(row, 14).Value = c.Status;
            row++;
        }
        ws.Columns().AdjustToContents();
        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }

    // ═══════════════════════════════════════════════════════════════
    //  GOOGLE SHEETS
    // ═══════════════════════════════════════════════════════════════

    // Same column shape as the public report page's "Download CSV" (report/club-dues/[duesId]/page.tsx)
    // so the sheet and the CSV always agree — richer than ExportClubsCsvAsync's flat XLSX, since it
    // includes payment mode + offline reference/mode/remark/date.
    // Offline columns are OMITTED ENTIRELY (not just blanked) when the campaign has no offline mode
    // (ModeOfPayment == 1, online-only) — there's nothing for them to ever show. BuildClubSheetRows
    // must build rows in exactly this same shape.
    private static string[] BuildSheetHeaders(bool offlineEnabled)
    {
        var headers = new List<string> { "Sr.No", "Club", "Members" };
        if (offlineEnabled) headers.AddRange(new[] { "Offline Rate", "Offline Amount", "Offline Paid", "Offline Pending" });
        headers.AddRange(new[] { "Online Rate", "Online Amount", "Online Paid", "Online Pending", "Total Paid", "Status", "Payment Mode" });
        if (offlineEnabled) headers.AddRange(new[] { "Offline Account", "Offline Mode", "Offline Reference No", "Offline Remark", "Offline Payment Date" });
        return headers.ToArray();
    }

    private static readonly Dictionary<string, string> OfflineModeLabels = new()
    {
        ["1"] = "Cash", ["2"] = "Cheque", ["3"] = "NEFT", ["4"] = "UPI", ["5"] = "Other",
    };

    // One row per club — a live snapshot, not an append-only log (a club's row changes as it pays
    // down), so the whole sheet body is rewritten on every sync rather than appended to.
    // "Only the paid entries" — skips any club that hasn't paid anything yet (Unpaid /
    // No Members), same criterion as the Club Dues (Membership) sheet: a club counts as
    // paid if it's contributed something, Partial included, not just Fully Paid.
    private static IList<IList<object>> BuildClubSheetRows(List<ClubDuesClubListDto> clubs, bool offlineEnabled)
    {
        var rows = new List<IList<object>>();
        int srNo = 1;
        foreach (var c in clubs)
        {
            decimal totalPaidCheck = c.OfflinePaid + c.OnlinePaid;
            if (totalPaidCheck <= 0) continue;

            decimal offlinePending = Math.Max(0, c.OfflineAmount - c.OfflinePaid);
            decimal onlinePending = Math.Max(0, c.OnlineAmount - c.OnlinePaid);
            decimal totalPaid = c.OfflinePaid + c.OnlinePaid;
            string status = c.Status == "Fully Paid" ? "Paid" : c.Status ?? "";
            string paymentMode = c.PaidOnline == null ? "" : (c.PaidOnline.Value ? "Online" : "Offline");

            // Offline detail columns stay blank for unpaid clubs and for online payments —
            // mirrors offlineCells() in the report page.
            bool isOfflinePaid = c.PaidOnline == false;
            string offlineMode = isOfflinePaid && c.OfflineTransactionType != null
                ? (OfflineModeLabels.TryGetValue(c.OfflineTransactionType, out var lbl) ? lbl : c.OfflineTransactionType)
                : "";
            string offlineRef = isOfflinePaid ? (c.OfflineTransactionId ?? "") : "";
            string offlineRemark = isOfflinePaid ? (c.OfflineRemark ?? "") : "";
            string offlineDate = isOfflinePaid && c.PaymentDate.HasValue ? c.PaymentDate.Value.ToString("dd-MM-yyyy") : "";
            string offlineAccount = isOfflinePaid ? (c.OfflineAccountLabel ?? "") : "";

            // Once one channel has won (PaidOnline true/false), the other channel's own rate/
            // amount/paid/pending are moot for this club — blank instead of showing stale
            // numbers next to a paid-elsewhere club. Both stay populated while PaidOnline is
            // still null (nothing paid yet, neither channel ruled out) — matches the same
            // paid-only filter's "Partial counts as paid" stance just above.
            object offRate = c.PaidOnline == true ? "" : c.OfflinePerMemberRate;
            object offAmt = c.PaidOnline == true ? "" : c.OfflineAmount;
            object offPaid = c.PaidOnline == true ? "" : c.OfflinePaid;
            object offPend = c.PaidOnline == true ? "" : offlinePending;
            object onRate = c.PaidOnline == false ? "" : c.OnlinePerMemberRate;
            object onAmt = c.PaidOnline == false ? "" : c.OnlineAmount;
            object onPaid = c.PaidOnline == false ? "" : c.OnlinePaid;
            object onPend = c.PaidOnline == false ? "" : onlinePending;

            var row = new List<object> { srNo++, c.ClubName ?? "", c.MemberCount };
            if (offlineEnabled) row.AddRange(new[] { offRate, offAmt, offPaid, offPend });
            row.AddRange(new object[] { onRate, onAmt, onPaid, onPend, totalPaid, status, paymentMode });
            if (offlineEnabled) row.AddRange(new object[] { offlineAccount, offlineMode, offlineRef, offlineRemark, offlineDate });
            rows.Add(row);
        }
        return rows;
    }

    public async Task<string> CreateGoogleSheetAsync(int duesId)
    {
        using var conn = GetConnection();
        var dues = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pk_club_dues_id, Purpose, GoogleSheetId, GoogleSheetEmail, ModeOfPayment
            FROM club_dues WHERE pk_club_dues_id=@Id AND isdeleted=0", new { Id = duesId });
        if (dues == null) throw new KeyNotFoundException("District Dues campaign not found.");

        if (!string.IsNullOrWhiteSpace((string?)dues.GoogleSheetId))
            return (string)dues.GoogleSheetId;

        var purpose = ((string?)dues.Purpose ?? "DistrictDues").Trim();
        var safePurpose = System.Text.RegularExpressions.Regex.Replace(purpose, @"[^a-zA-Z0-9 _-]", "").Replace(" ", "_");
        var sheetTitle = $"DistrictDues_{safePurpose}_{DateTime.Now:ddMMyyyyHHmmss}";
        bool offlineEnabled = ChannelEnabled((int)dues.ModeOfPayment, isOnline: false);

        var sheetId = await _googleSheetsService.CreateSpreadsheetAsync(sheetTitle, BuildSheetHeaders(offlineEnabled));

        var email = (string?)dues.GoogleSheetEmail;
        if (!string.IsNullOrWhiteSpace(email))
        {
            try { await _googleSheetsService.ShareWithEmailAsync(sheetId, email); }
            catch (Exception ex) { _logger.LogWarning(ex, "Failed to share club dues sheet with {Email}", email); }
        }

        await conn.ExecuteAsync("UPDATE club_dues SET GoogleSheetId=@SheetId WHERE pk_club_dues_id=@Id",
            new { SheetId = sheetId, Id = duesId });

        var clubs = await GetEnrichedClubsAsync(duesId);
        var rows = BuildClubSheetRows(clubs, offlineEnabled);
        try { await _googleSheetsService.WriteRowsAsync(sheetId, rows); }
        catch (Exception ex) { _logger.LogWarning(ex, "Failed to backfill club dues sheet {SheetId}", sheetId); }

        _logger.LogInformation("Created Google Sheet {SheetId} for club dues {DuesId} with {Count} clubs", sheetId, duesId, rows.Count);
        return sheetId;
    }

    public async Task DeleteGoogleSheetAsync(int duesId)
    {
        using var conn = GetConnection();
        var sheetId = await conn.ExecuteScalarAsync<string?>(
            "SELECT GoogleSheetId FROM club_dues WHERE pk_club_dues_id=@Id AND isdeleted=0", new { Id = duesId });
        if (string.IsNullOrWhiteSpace(sheetId))
            throw new KeyNotFoundException("No Google Sheet found for this campaign.");

        await _googleSheetsService.DeleteSpreadsheetAsync(sheetId);
        await conn.ExecuteAsync("UPDATE club_dues SET GoogleSheetId=NULL WHERE pk_club_dues_id=@Id", new { Id = duesId });
        _logger.LogInformation("Deleted Google Sheet {SheetId} for club dues {DuesId}", sheetId, duesId);
    }

    // Re-snapshots every club row into the sheet — called after any payment-confirming event AND
    // after a campaign edit (ModeOfPayment can flip offline on/off at any time). Headers are
    // rewritten on every call, not just rows — cheap (one extra Sheets API round trip) and it's
    // the only way a campaign that just enabled/disabled offline picks up the column change
    // without waiting for the next payment. No-op when the campaign has no sheet configured;
    // swallows its own errors so a Sheets/Drive hiccup never breaks the flow that triggered it.
    private async Task SyncGoogleSheetIfEnabledAsync(int duesId)
    {
        try
        {
            using var conn = GetConnection();
            var dues = await conn.QueryFirstOrDefaultAsync<dynamic>(
                "SELECT GoogleSheetId, ModeOfPayment FROM club_dues WHERE pk_club_dues_id=@Id AND isdeleted=0", new { Id = duesId });
            string? sheetId = dues == null ? null : (string?)dues.GoogleSheetId;
            if (string.IsNullOrWhiteSpace(sheetId)) return;
            bool offlineEnabled = ChannelEnabled((int)dues!.ModeOfPayment, isOnline: false);

            var clubs = await GetEnrichedClubsAsync(duesId);
            var headers = BuildSheetHeaders(offlineEnabled);
            var rows = BuildClubSheetRows(clubs, offlineEnabled);
            await _googleSheetsService.SetHeadersAsync(sheetId, headers);
            await _googleSheetsService.WriteRowsAsync(sheetId, rows);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to sync Google Sheet for club dues {DuesId}", duesId);
        }
    }

    // One-time/manual backfill: renames every District Dues sheet still titled with the old
    // "ClubDues_" prefix to "DistrictDues_", and rewrites headers+rows on every campaign that has
    // a sheet at all, so the offline-column-shape fix applies to sheets created before it shipped.
    // Not wired to any endpoint — SuperAdmin-only, run once via a maintenance trigger.
    public async Task<int> ResyncAllGoogleSheetsAsync()
    {
        using var conn = GetConnection();
        var campaigns = (await conn.QueryAsync<dynamic>(@"
            SELECT pk_club_dues_id, Purpose, GoogleSheetId, ModeOfPayment
            FROM club_dues WHERE isdeleted=0 AND GoogleSheetId IS NOT NULL AND GoogleSheetId <> ''")).ToList();

        int updated = 0;
        foreach (var c in campaigns)
        {
            int duesId = (int)c.pk_club_dues_id;
            string sheetId = (string)c.GoogleSheetId;
            try
            {
                var purpose = ((string?)c.Purpose ?? "DistrictDues").Trim();
                var safePurpose = System.Text.RegularExpressions.Regex.Replace(purpose, @"[^a-zA-Z0-9 _-]", "").Replace(" ", "_");
                // Timestamp suffix is cosmetic only (GoogleSheetId, not the title, is the real
                // identifier) — a fresh one each run is fine; this is a one-time/manual backfill.
                await _googleSheetsService.RenameSpreadsheetAsync(sheetId, $"DistrictDues_{safePurpose}_{DateTime.Now:ddMMyyyyHHmmss}");

                bool offlineEnabled = ChannelEnabled((int)c.ModeOfPayment, isOnline: false);
                var clubs = await GetEnrichedClubsAsync(duesId);
                await _googleSheetsService.SetHeadersAsync(sheetId, BuildSheetHeaders(offlineEnabled));
                await _googleSheetsService.WriteRowsAsync(sheetId, BuildClubSheetRows(clubs, offlineEnabled));
                updated++;
                _logger.LogInformation("Resynced Google Sheet {SheetId} for club dues {DuesId}", sheetId, duesId);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to resync Google Sheet {SheetId} for club dues {DuesId}", sheetId, duesId);
            }
        }
        return updated;
    }

    // ═══════════════════════════════════════════════════════════════
    //  Helpers
    // ═══════════════════════════════════════════════════════════════

    // Saves an uploaded file under wwwroot/Documents/ClubDues and returns the FILENAME ONLY
    // (project rule: store filename, rebuild URL on read).
    private static async Task<string> SaveFileAsync(IFormFile file, IWebHostEnvironment env)
    {
        var root = env.WebRootPath ?? Path.Combine(Directory.GetCurrentDirectory(), "wwwroot");
        var dir = Path.Combine(root, "Documents", "ClubDues");
        Directory.CreateDirectory(dir);
        var ext = Path.GetExtension(file.FileName);
        var name = $"{Guid.NewGuid():N}{ext}";
        var full = Path.Combine(dir, name);
        using (var stream = new FileStream(full, FileMode.Create))
            await file.CopyToAsync(stream);
        return name;
    }
}
