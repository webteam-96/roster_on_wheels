using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class EventPaymentLinkService : IEventPaymentLinkService
{
    private readonly string _connStr;
    private readonly IConfiguration _config;
    private readonly IEmailService _emailService;
    private readonly ISmsService _smsService;
    private readonly IInteraktService _interaktService;
    private readonly IGoogleSheetsService _googleSheetsService;
    private readonly HttpClient _httpClient;
    private readonly ILogger<EventPaymentLinkService> _logger;

    public EventPaymentLinkService(IConfiguration config, IEmailService emailService, ISmsService smsService,
        IInteraktService interaktService, IHttpClientFactory httpClientFactory, IGoogleSheetsService googleSheetsService,
        ILogger<EventPaymentLinkService> logger)
    {
        _connStr = config.GetConnectionString("DefaultConnection")!;
        _config = config;
        _emailService = emailService;
        _smsService = smsService;
        _interaktService = interaktService;
        _googleSheetsService = googleSheetsService;
        _httpClient = httpClientFactory.CreateClient();
        _logger = logger;
    }

    private MySqlConnection GetConnection() => new(_connStr);

    // ═══════════════════════════════════════════════════════════════
    //  MASTERS
    // ═══════════════════════════════════════════════════════════════

    public async Task<IEnumerable<EventTshirtSizeDto>> GetTshirtSizesAsync()
    {
        using var conn = GetConnection();
        return await conn.QueryAsync<EventTshirtSizeDto>(
            "SELECT pk_id AS Id, SizeName, SortOrder, IsActive FROM event_tshirt_sizes ORDER BY SortOrder");
    }

    public async Task<int> CreateTshirtSizeAsync(CreateEventTshirtSizeDto dto, int userId)
    {
        using var conn = GetConnection();
        return await conn.ExecuteScalarAsync<int>(
            "INSERT INTO event_tshirt_sizes (SizeName, SortOrder, created_by) VALUES (@SizeName, @SortOrder, @UserId); SELECT LAST_INSERT_ID();",
            new { dto.SizeName, dto.SortOrder, UserId = userId });
    }

    public async Task UpdateTshirtSizeAsync(int id, CreateEventTshirtSizeDto dto, int userId)
    {
        using var conn = GetConnection();
        await conn.ExecuteAsync(
            "UPDATE event_tshirt_sizes SET SizeName=@SizeName, SortOrder=@SortOrder WHERE pk_id=@Id",
            new { dto.SizeName, dto.SortOrder, Id = id });
    }

    public async Task DeleteTshirtSizeAsync(int id)
    {
        using var conn = GetConnection();
        await conn.ExecuteAsync("UPDATE event_tshirt_sizes SET IsActive=0 WHERE pk_id=@Id", new { Id = id });
    }

    public async Task<IEnumerable<EventFoodPreferenceDto>> GetFoodPreferencesAsync()
    {
        using var conn = GetConnection();
        return await conn.QueryAsync<EventFoodPreferenceDto>(
            "SELECT pk_id AS Id, FoodType, SortOrder, IsActive FROM event_food_preferences ORDER BY SortOrder");
    }

    public async Task<int> CreateFoodPreferenceAsync(CreateEventFoodPreferenceDto dto, int userId)
    {
        using var conn = GetConnection();
        return await conn.ExecuteScalarAsync<int>(
            "INSERT INTO event_food_preferences (FoodType, SortOrder, created_by) VALUES (@FoodType, @SortOrder, @UserId); SELECT LAST_INSERT_ID();",
            new { dto.FoodType, dto.SortOrder, UserId = userId });
    }

    public async Task UpdateFoodPreferenceAsync(int id, CreateEventFoodPreferenceDto dto, int userId)
    {
        using var conn = GetConnection();
        await conn.ExecuteAsync(
            "UPDATE event_food_preferences SET FoodType=@FoodType, SortOrder=@SortOrder WHERE pk_id=@Id",
            new { dto.FoodType, dto.SortOrder, Id = id });
    }

    public async Task DeleteFoodPreferenceAsync(int id)
    {
        using var conn = GetConnection();
        await conn.ExecuteAsync("UPDATE event_food_preferences SET IsActive=0 WHERE pk_id=@Id", new { Id = id });
    }

    // ═══════════════════════════════════════════════════════════════
    //  PAYMENT LINKS CRUD
    // ═══════════════════════════════════════════════════════════════

    public async Task<IEnumerable<EventPaymentLinkListDto>> GetPaymentLinksAsync(int? clubId, int? districtId, string? search)
    {
        using var conn = GetConnection();
        var sql = @"SELECT l.pk_id AS Id, l.FormType, d.DistrictNumber, c.ClubName,
                l.Title, l.IsActive, l.created_date AS CreatedDate,
                m.MemberName AS CreatedByName, l.WeblinkUrl, l.GoogleSheetUrl, l.GoogleSheetId,
                (SELECT COUNT(*) FROM event_payment_registrations r WHERE r.fk_payment_link_id=l.pk_id AND r.isdeleted=0) AS RegistrationCount,
                (SELECT COUNT(*) FROM event_payment_members pm WHERE pm.fk_payment_link_id=l.pk_id AND pm.IsPaid=1 AND pm.isdeleted=0) AS PaidCount,
                (SELECT COUNT(*) FROM event_payment_members pm WHERE pm.fk_payment_link_id=l.pk_id AND pm.IsPaid=0 AND pm.isdeleted=0) AS UnpaidCount
            FROM event_payment_links l
            LEFT JOIN district_master d ON l.fk_district_master_id = d.pk_district_id
            LEFT JOIN club_master c ON l.fk_club_id = c.pk_club_id
            LEFT JOIN member_master_profile m ON l.created_by = m.pk_member_master_profile_id
            WHERE l.isdeleted = 0";

        if (clubId.HasValue && clubId > 0)
            sql += " AND l.fk_club_id = @ClubId";
        if (districtId.HasValue && districtId > 0)
            sql += " AND l.fk_district_master_id = @DistrictId AND (l.fk_club_id IS NULL OR l.fk_club_id = 0)";
        if (!string.IsNullOrWhiteSpace(search))
            sql += " AND (l.Title LIKE @Search OR d.DistrictNumber LIKE @Search OR c.ClubName LIKE @Search)";

        sql += " ORDER BY l.created_date DESC";

        return await conn.QueryAsync<EventPaymentLinkListDto>(sql,
            new { ClubId = clubId, DistrictId = districtId, Search = $"%{search}%" });
    }

    public async Task<EventPaymentLinkDetailDto?> GetPaymentLinkDetailAsync(int linkId)
    {
        using var conn = GetConnection();
        var link = await conn.QueryFirstOrDefaultAsync<EventPaymentLinkDetailDto>(@"
            SELECT l.pk_id AS Id, l.FormType, l.AmountType,
                l.fk_district_master_id AS FkDistrictMasterId, l.fk_club_id AS FkClubId,
                d.DistrictNumber, c.ClubName,
                l.IsForAllDistricts, l.DistrictIdsList,
                l.RecipientType, l.SubgroupIds, l.SubgroupYear,
                l.Title, l.Description,
                CASE
                    WHEN l.PurposeLogo IS NULL OR l.PurposeLogo = '' THEN NULL
                    WHEN l.PurposeLogo LIKE '/%' THEN l.PurposeLogo
                    ELSE CONCAT('/Documents/OlineEvnetPaymentlink', l.fk_club_id, '/', l.PurposeLogo)
                END AS PurposeLogo,
                CASE
                    WHEN l.PurposeEventImage IS NULL OR l.PurposeEventImage = '' THEN NULL
                    WHEN l.PurposeEventImage LIKE '/%' THEN l.PurposeEventImage
                    ELSE CONCAT('/Documents/OlineEvnetPaymentlink', l.fk_club_id, '/', l.PurposeEventImage)
                END AS PurposeEventImage,
                CASE
                    WHEN l.BackgroundImage IS NULL OR l.BackgroundImage = '' THEN NULL
                    WHEN l.BackgroundImage LIKE '/%' THEN l.BackgroundImage
                    ELSE CONCAT('/Documents/OlineEvnetPaymentlink', l.fk_club_id, '/', l.BackgroundImage)
                END AS BackgroundImage,
                l.WeblinkUrl,
                l.IsHideCharges, l.IsForm,
                l.IsTshirtSize, l.IsFood, l.FoodPreferenceIds,
                l.IsPartner, l.IsPartnerName,
                l.IsPartnerMobile, l.IsPartnerEmail,
                l.IsPartnerGender,
                l.IsRemark1, l.Remark1Title,
                l.IsRemark2, l.Remark2Title,
                l.IsRemark3, l.Remark3Title,
                l.IsDesignation, l.DesignationLabel,
                l.IsPersonal, l.IsPersonalName,
                l.IsPersonalMobile, l.IsPersonalEmail,
                l.IsPersonalDistrict, l.IsPersonalClub,
                CASE
                    WHEN l.EmailHeaderLogo IS NULL OR l.EmailHeaderLogo = '' THEN NULL
                    WHEN l.EmailHeaderLogo LIKE '/%' THEN l.EmailHeaderLogo
                    ELSE CONCAT('/Documents/OlineEvnetPaymentlink', l.fk_club_id, '/', l.EmailHeaderLogo)
                END AS EmailHeaderLogo,
                l.EmailCc,
                l.EmailSubject, l.EmailBody,
                l.EmailReminderSubject, l.EmailReminderBody,
                l.GoogleSheetUrl, l.GoogleSheetName,
                l.GoogleSheetId, l.GoogleSheetEmail,
                l.fk_weblink_id AS FkWeblinkId, l.IsActive
            FROM event_payment_links l
            LEFT JOIN district_master d ON l.fk_district_master_id = d.pk_district_id
            LEFT JOIN club_master c ON l.fk_club_id = c.pk_club_id
            WHERE l.pk_id=@Id AND l.isdeleted=0", new { Id = linkId });

        if (link == null) return null;

        link.Registrations = (await conn.QueryAsync<EventRegistrationDto>(
            "SELECT pk_id AS Id, RegistrationName, Amount FROM event_payment_registrations WHERE fk_payment_link_id=@Id AND isdeleted=0",
            new { Id = linkId })).ToList();

        link.VendorSplits = (await conn.QueryAsync<EventVendorSplitDto>(@"
            SELECT vs.pk_id AS Id, vs.fk_registration_id AS FkRegistrationId,
                vs.fk_kyc_id AS FkKycId, k.vendor_id AS VendorId, vs.SplitAmount,
                k.name AS VendorName, r.RegistrationName
            FROM event_payment_vendor_splits vs
            LEFT JOIN cashfree_kyc k ON vs.fk_kyc_id = k.pk_kyc_id
            LEFT JOIN event_payment_registrations r ON vs.fk_registration_id = r.pk_id
            WHERE vs.fk_payment_link_id=@Id AND vs.isdeleted=0", new { Id = linkId })).ToList();

        link.Designations = (await conn.QueryAsync<EventDesignationDto>(
            "SELECT pk_id AS Id, DesignationName FROM event_payment_designations WHERE fk_payment_link_id=@Id AND isdeleted=0",
            new { Id = linkId })).ToList();

        return link;
    }

    public async Task<int> CreatePaymentLinkAsync(CreateEventPaymentLinkDto dto, IFormFile? logo, IFormFile? eventImage,
        IFormFile? bgImage, IFormFile? emailLogo, int userId, IWebHostEnvironment env)
    {
        using var conn = GetConnection();
        var clubId = dto.FkClubId ?? 0;
        var logoPath = logo != null ? await SaveFileAsync(logo, clubId, env) : null;
        var eventImgPath = eventImage != null ? await SaveFileAsync(eventImage, clubId, env) : null;
        var bgPath = bgImage != null ? await SaveFileAsync(bgImage, clubId, env) : null;
        var emailLogoPath = emailLogo != null ? await SaveFileAsync(emailLogo, clubId, env) : null;

        var linkId = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO event_payment_links (FormType, AmountType, fk_district_master_id, fk_club_id,
                IsForAllDistricts, DistrictIdsList, RecipientType, SubgroupIds, SubgroupYear,
                Title, Description, PurposeLogo, PurposeEventImage, BackgroundImage, WeblinkUrl,
                IsHideCharges, IsForm, IsTshirtSize, IsFood, FoodPreferenceIds,
                IsPartner, IsPartnerName, IsPartnerMobile, IsPartnerEmail, IsPartnerGender,
                IsRemark1, Remark1Title, IsRemark2, Remark2Title, IsRemark3, Remark3Title,
                IsDesignation, DesignationLabel, IsPersonal, IsPersonalName, IsPersonalMobile,
                IsPersonalEmail, IsPersonalDistrict, IsPersonalClub,
                EmailHeaderLogo, EmailCc, EmailSubject, EmailBody,
                EmailReminderSubject, EmailReminderBody,
                IsActive, created_by, created_date)
            VALUES (@FormType, @AmountType, @FkDistrictMasterId, @FkClubId,
                @IsForAllDistricts, @DistrictIdsList, @RecipientType, @SubgroupIds, @SubgroupYear,
                @Title, @Description, @Logo, @EventImage, @BgImage, @WeblinkUrl,
                @IsHideCharges, @IsForm, @IsTshirtSize, @IsFood, @FoodPreferenceIds,
                @IsPartner, @IsPartnerName, @IsPartnerMobile, @IsPartnerEmail, @IsPartnerGender,
                @IsRemark1, @Remark1Title, @IsRemark2, @Remark2Title, @IsRemark3, @Remark3Title,
                @IsDesignation, @DesignationLabel, @IsPersonal, @IsPersonalName, @IsPersonalMobile,
                @IsPersonalEmail, @IsPersonalDistrict, @IsPersonalClub,
                @EmailLogo, @EmailCc, @EmailSubject, @EmailBody,
                @EmailReminderSubject, @EmailReminderBody,
                0, @UserId, NOW());
            SELECT LAST_INSERT_ID();",
            new
            {
                dto.FormType, dto.AmountType, dto.FkDistrictMasterId, dto.FkClubId,
                dto.IsForAllDistricts, dto.DistrictIdsList, dto.RecipientType, dto.SubgroupIds, dto.SubgroupYear,
                dto.Title, dto.Description, Logo = logoPath, EventImage = eventImgPath, BgImage = bgPath, dto.WeblinkUrl,
                dto.IsHideCharges, dto.IsForm, dto.IsTshirtSize, dto.IsFood, dto.FoodPreferenceIds,
                dto.IsPartner, dto.IsPartnerName, dto.IsPartnerMobile, dto.IsPartnerEmail, dto.IsPartnerGender,
                dto.IsRemark1, dto.Remark1Title, dto.IsRemark2, dto.Remark2Title, dto.IsRemark3, dto.Remark3Title,
                dto.IsDesignation, dto.DesignationLabel, dto.IsPersonal, dto.IsPersonalName, dto.IsPersonalMobile,
                dto.IsPersonalEmail, dto.IsPersonalDistrict, dto.IsPersonalClub,
                EmailLogo = emailLogoPath, dto.EmailCc, dto.EmailSubject, dto.EmailBody,
                dto.EmailReminderSubject, dto.EmailReminderBody,
                UserId = userId
            });

        // Auto-create weblink entry
        if (clubId > 0)
        {
            var frontendUrl = _config["FrontendUrl"] ?? "http://localhost:3000";
            var payUrl = $"{frontendUrl}/pay/{linkId}";
            var weblinkId = await conn.ExecuteScalarAsync<int>(@"
                INSERT INTO weblinks (fk_club_id, Title, Writeup, LogoPath, LinkType, LinkUrl, Level, IsActive, created_by, created_date)
                VALUES (@ClubId, @Title, @Desc, @Logo, 'URL', @Url, 0, 1, @UserId, NOW());
                SELECT LAST_INSERT_ID();",
                new { ClubId = clubId, Title = dto.Title ?? "Event Payment", Desc = dto.Description, Logo = eventImgPath, Url = payUrl, UserId = userId });

            await conn.ExecuteAsync("UPDATE event_payment_links SET fk_weblink_id=@WId WHERE pk_id=@LId",
                new { WId = weblinkId, LId = linkId });
        }

        return linkId;
    }

    public async Task<int> CreateFullPaymentLinkAsync(CreateFullEventPaymentLinkDto dto, IFormFile? logo, IFormFile? bgImage, IFormFile? emailLogo, int userId, IWebHostEnvironment env)
    {
        using var conn = GetConnection();
        await conn.OpenAsync();
        using var tx = await conn.BeginTransactionAsync();
        try
        {
            var clubId = dto.FkClubId ?? 0;
            var logoPath = logo != null ? await SaveFileAsync(logo, clubId, env) : null;
            var bgPath = bgImage != null ? await SaveFileAsync(bgImage, clubId, env) : null;
            var emailLogoPath = emailLogo != null ? await SaveFileAsync(emailLogo, clubId, env) : null;

            // 1. Create the payment link as ACTIVE
            var linkId = await conn.ExecuteScalarAsync<int>(@"
                INSERT INTO event_payment_links (FormType, AmountType, fk_district_master_id, fk_club_id,
                    IsForAllDistricts, DistrictIdsList, RecipientType,
                    Title, Description, PurposeLogo, BackgroundImage,
                    IsHideCharges, IsForm, IsTshirtSize, IsFood, FoodPreferenceIds,
                    IsPartner, IsPartnerName, IsPartnerMobile, IsPartnerEmail, IsPartnerGender,
                    IsRemark1, Remark1Title, IsRemark2, Remark2Title, IsRemark3, Remark3Title,
                    IsDesignation, DesignationLabel, IsPersonal, IsPersonalName, IsPersonalMobile,
                    IsPersonalEmail, IsPersonalDistrict, IsPersonalClub,
                    EmailHeaderLogo, EmailCc, EmailSubject, EmailBody,
                    EmailReminderSubject, EmailReminderBody,
                    IsActive, created_by, created_date)
                VALUES (@FormType, @AmountType, @FkDistrictMasterId, @FkClubId,
                    @IsForAllDistricts, @DistrictIdsList, @RecipientType,
                    @Title, @Description, @Logo, @BgImage,
                    @IsHideCharges, @IsForm, @IsTshirtSize, @IsFood, @FoodPreferenceIds,
                    @IsPartner, @IsPartnerName, @IsPartnerMobile, @IsPartnerEmail, @IsPartnerGender,
                    @IsRemark1, @Remark1Title, @IsRemark2, @Remark2Title, @IsRemark3, @Remark3Title,
                    @IsDesignation, @DesignationLabel, @IsPersonal, @IsPersonalName, @IsPersonalMobile,
                    @IsPersonalEmail, @IsPersonalDistrict, @IsPersonalClub,
                    @EmailLogo, @EmailCc, @EmailSubject, @EmailBody,
                    @EmailReminderSubject, @EmailReminderBody,
                    1, @UserId, NOW());
                SELECT LAST_INSERT_ID();",
                new
                {
                    dto.FormType, dto.AmountType, dto.FkDistrictMasterId, dto.FkClubId,
                    dto.IsForAllDistricts, dto.DistrictIdsList, dto.RecipientType,
                    dto.Title, dto.Description, Logo = logoPath, BgImage = bgPath,
                    dto.IsHideCharges, dto.IsForm, dto.IsTshirtSize, dto.IsFood, dto.FoodPreferenceIds,
                    dto.IsPartner, dto.IsPartnerName, dto.IsPartnerMobile, dto.IsPartnerEmail, dto.IsPartnerGender,
                    dto.IsRemark1, dto.Remark1Title, dto.IsRemark2, dto.Remark2Title, dto.IsRemark3, dto.Remark3Title,
                    dto.IsDesignation, dto.DesignationLabel, dto.IsPersonal, dto.IsPersonalName, dto.IsPersonalMobile,
                    dto.IsPersonalEmail, dto.IsPersonalDistrict, dto.IsPersonalClub,
                    EmailLogo = emailLogoPath, dto.EmailCc, dto.EmailSubject, dto.EmailBody,
                    dto.EmailReminderSubject, dto.EmailReminderBody, UserId = userId
                }, tx);

            // 2. Insert registrations and track IDs for vendor splits
            var regIdMap = new Dictionary<int, int>(); // index -> db id
            for (int i = 0; i < dto.Registrations.Count; i++)
            {
                var reg = dto.Registrations[i];
                var regId = await conn.ExecuteScalarAsync<int>(@"
                    INSERT INTO event_payment_registrations (fk_payment_link_id, RegistrationName, Amount, created_by, created_date)
                    VALUES (@LinkId, @Name, @Amount, @UserId, NOW()); SELECT LAST_INSERT_ID();",
                    new { LinkId = linkId, Name = reg.RegistrationName, reg.Amount, UserId = userId }, tx);
                regIdMap[i] = regId;
            }

            // 3. Insert vendor splits (map registration index to actual DB ID)
            foreach (var split in dto.VendorSplits)
            {
                var actualRegId = split.FkRegistrationId < dto.Registrations.Count
                    ? regIdMap.GetValueOrDefault(split.FkRegistrationId, split.FkRegistrationId)
                    : split.FkRegistrationId;
                await conn.ExecuteAsync(@"
                    INSERT INTO event_payment_vendor_splits (fk_payment_link_id, fk_registration_id, fk_kyc_id, SplitAmount, created_by, created_date)
                    VALUES (@LinkId, @RegId, @KycId, @Amount, @UserId, NOW())",
                    new { LinkId = linkId, RegId = actualRegId, KycId = split.FkKycId, Amount = split.SplitAmount, UserId = userId }, tx);
            }

            // 4. Insert designations
            foreach (var desig in dto.Designations)
            {
                await conn.ExecuteAsync(@"
                    INSERT INTO event_payment_designations (fk_payment_link_id, DesignationName, created_by, created_date)
                    VALUES (@LinkId, @Name, @UserId, NOW())",
                    new { LinkId = linkId, Name = desig.DesignationName, UserId = userId }, tx);
            }

            // 5. Auto-create weblink
            if (clubId > 0)
            {
                var frontendUrl = _config["FrontendUrl"] ?? "http://localhost:3000";
                var payUrl = $"{frontendUrl}/pay/{linkId}";
                var weblinkId = await conn.ExecuteScalarAsync<int>(@"
                    INSERT INTO weblinks (fk_club_id, Title, Writeup, LogoPath, LinkType, LinkUrl, Level, IsActive, created_by, created_date)
                    VALUES (@ClubId, @Title, @Desc, @Logo, 'URL', @Url, 0, 1, @UserId, NOW());
                    SELECT LAST_INSERT_ID();",
                    new { ClubId = clubId, Title = dto.Title ?? "Event Payment", Desc = dto.Description, Logo = logoPath, Url = payUrl, UserId = userId }, tx);
                await conn.ExecuteAsync("UPDATE event_payment_links SET fk_weblink_id=@WId WHERE pk_id=@LId",
                    new { WId = weblinkId, LId = linkId }, tx);
            }

            await tx.CommitAsync();

            // Save GoogleSheetEmail first so CreateGoogleSheetForLinkAsync can use it
            if (!string.IsNullOrWhiteSpace(dto.GoogleSheetEmail))
            {
                using var emailConn = GetConnection();
                await emailConn.ExecuteAsync(
                    "UPDATE event_payment_links SET GoogleSheetEmail=@Email WHERE pk_id=@Id",
                    new { Email = dto.GoogleSheetEmail.Trim(), Id = linkId });
            }

            // Create Google Sheet (non-critical, uses dynamic headers)
            _ = Task.Run(async () =>
            {
                try
                {
                    await CreateGoogleSheetForLinkAsync(linkId);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to create Google Sheet for link {LinkId}", linkId);
                }
            });

            return linkId;
        }
        catch
        {
            await tx.RollbackAsync();
            throw;
        }
    }

    public async Task UpdateFullPaymentLinkAsync(int linkId, CreateFullEventPaymentLinkDto dto, IFormFile? logo, IFormFile? bgImage, IFormFile? emailLogo, int userId, IWebHostEnvironment env)
    {
        using var conn = GetConnection();
        await conn.OpenAsync();
        using var tx = await conn.BeginTransactionAsync();
        try
        {
            var clubId = dto.FkClubId ?? 0;
            var existing = await conn.QueryFirstOrDefaultAsync<dynamic>(
                "SELECT PurposeLogo, BackgroundImage, EmailHeaderLogo FROM event_payment_links WHERE pk_id=@Id", new { Id = linkId }, tx);
            var logoPath = logo != null ? await SaveFileAsync(logo, clubId, env) : (string?)existing?.PurposeLogo;
            var bgPath = bgImage != null ? await SaveFileAsync(bgImage, clubId, env) : (string?)existing?.BackgroundImage;
            var emailLogoPath = emailLogo != null ? await SaveFileAsync(emailLogo, clubId, env) : (string?)existing?.EmailHeaderLogo;

            // 1. Update main link
            await conn.ExecuteAsync(@"
                UPDATE event_payment_links SET
                    FormType=@FormType, AmountType=@AmountType, fk_district_master_id=@FkDistrictMasterId, fk_club_id=@FkClubId,
                    IsForAllDistricts=@IsForAllDistricts, DistrictIdsList=@DistrictIdsList,
                    RecipientType=@RecipientType, Title=@Title, Description=@Description,
                    PurposeLogo=@Logo, BackgroundImage=@BgImage, IsHideCharges=@IsHideCharges,
                    IsForm=@IsForm, IsTshirtSize=@IsTshirtSize, IsFood=@IsFood, FoodPreferenceIds=@FoodPreferenceIds,
                    IsPartner=@IsPartner, IsPartnerName=@IsPartnerName, IsPartnerMobile=@IsPartnerMobile,
                    IsPartnerEmail=@IsPartnerEmail, IsPartnerGender=@IsPartnerGender,
                    IsRemark1=@IsRemark1, Remark1Title=@Remark1Title, IsRemark2=@IsRemark2, Remark2Title=@Remark2Title,
                    IsRemark3=@IsRemark3, Remark3Title=@Remark3Title,
                    IsDesignation=@IsDesignation, DesignationLabel=@DesignationLabel,
                    IsPersonal=@IsPersonal, IsPersonalName=@IsPersonalName, IsPersonalMobile=@IsPersonalMobile,
                    IsPersonalEmail=@IsPersonalEmail, IsPersonalDistrict=@IsPersonalDistrict, IsPersonalClub=@IsPersonalClub,
                    EmailHeaderLogo=@EmailLogo, EmailCc=@EmailCc, EmailSubject=@EmailSubject, EmailBody=@EmailBody,
                    EmailReminderSubject=@EmailReminderSubject, EmailReminderBody=@EmailReminderBody,
                    updated_by=@UserId, updated_date=NOW()
                WHERE pk_id=@Id",
                new
                {
                    dto.FormType, dto.AmountType, dto.FkDistrictMasterId, dto.FkClubId,
                    dto.IsForAllDistricts, dto.DistrictIdsList, dto.RecipientType,
                    dto.Title, dto.Description, Logo = logoPath, BgImage = bgPath,
                    dto.IsHideCharges, dto.IsForm, dto.IsTshirtSize, dto.IsFood, dto.FoodPreferenceIds,
                    dto.IsPartner, dto.IsPartnerName, dto.IsPartnerMobile, dto.IsPartnerEmail, dto.IsPartnerGender,
                    dto.IsRemark1, dto.Remark1Title, dto.IsRemark2, dto.Remark2Title, dto.IsRemark3, dto.Remark3Title,
                    dto.IsDesignation, dto.DesignationLabel, dto.IsPersonal, dto.IsPersonalName, dto.IsPersonalMobile,
                    dto.IsPersonalEmail, dto.IsPersonalDistrict, dto.IsPersonalClub,
                    EmailLogo = emailLogoPath, dto.EmailCc, dto.EmailSubject, dto.EmailBody,
                    dto.EmailReminderSubject, dto.EmailReminderBody, UserId = userId, Id = linkId
                }, tx);

            // 2. Soft-delete old registrations, splits, designations
            await conn.ExecuteAsync("UPDATE event_payment_registrations SET isdeleted=1 WHERE fk_payment_link_id=@Id", new { Id = linkId }, tx);
            await conn.ExecuteAsync("UPDATE event_payment_vendor_splits SET isdeleted=1 WHERE fk_payment_link_id=@Id", new { Id = linkId }, tx);
            await conn.ExecuteAsync("UPDATE event_payment_designations SET isdeleted=1 WHERE fk_payment_link_id=@Id", new { Id = linkId }, tx);

            // 3. Re-insert registrations
            var regIdMap = new Dictionary<int, int>();
            for (int i = 0; i < dto.Registrations.Count; i++)
            {
                var reg = dto.Registrations[i];
                var regId = await conn.ExecuteScalarAsync<int>(@"
                    INSERT INTO event_payment_registrations (fk_payment_link_id, RegistrationName, Amount, created_by, created_date)
                    VALUES (@LinkId, @Name, @Amount, @UserId, NOW()); SELECT LAST_INSERT_ID();",
                    new { LinkId = linkId, Name = reg.RegistrationName, reg.Amount, UserId = userId }, tx);
                regIdMap[i] = regId;
            }

            // 4. Re-insert vendor splits
            foreach (var split in dto.VendorSplits)
            {
                var actualRegId = split.FkRegistrationId < dto.Registrations.Count
                    ? regIdMap.GetValueOrDefault(split.FkRegistrationId, split.FkRegistrationId)
                    : split.FkRegistrationId;
                await conn.ExecuteAsync(@"
                    INSERT INTO event_payment_vendor_splits (fk_payment_link_id, fk_registration_id, fk_kyc_id, SplitAmount, created_by, created_date)
                    VALUES (@LinkId, @RegId, @KycId, @Amount, @UserId, NOW())",
                    new { LinkId = linkId, RegId = actualRegId, KycId = split.FkKycId, Amount = split.SplitAmount, UserId = userId }, tx);
            }

            // 5. Re-insert designations
            foreach (var desig in dto.Designations)
            {
                await conn.ExecuteAsync(@"
                    INSERT INTO event_payment_designations (fk_payment_link_id, DesignationName, created_by, created_date)
                    VALUES (@LinkId, @Name, @UserId, NOW())",
                    new { LinkId = linkId, Name = desig.DesignationName, UserId = userId }, tx);
            }

            // 6. Update GoogleSheetEmail and share if changed
            if (!string.IsNullOrWhiteSpace(dto.GoogleSheetEmail))
            {
                await conn.ExecuteAsync(
                    "UPDATE event_payment_links SET GoogleSheetEmail=@Email WHERE pk_id=@Id",
                    new { Email = dto.GoogleSheetEmail.Trim(), Id = linkId }, tx);
            }

            await tx.CommitAsync();

            // Create Google Sheet if not exists, or share with new email
            _ = Task.Run(async () =>
            {
                try
                {
                    using var sheetConn = GetConnection();
                    var existingSheetId = await sheetConn.ExecuteScalarAsync<string?>(
                        "SELECT GoogleSheetId FROM event_payment_links WHERE pk_id=@Id", new { Id = linkId });

                    if (string.IsNullOrWhiteSpace(existingSheetId))
                    {
                        // Create sheet + backfill paid members
                        await CreateGoogleSheetForLinkAsync(linkId);
                    }
                    else if (!string.IsNullOrWhiteSpace(dto.GoogleSheetEmail))
                    {
                        // Sheet exists, share with new email
                        await _googleSheetsService.ShareWithEmailAsync(existingSheetId, dto.GoogleSheetEmail.Trim());
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to create/share Google Sheet for link {LinkId}", linkId);
                }
            });
        }
        catch
        {
            await tx.RollbackAsync();
            throw;
        }
    }

    public async Task UpdatePaymentLinkAsync(int linkId, UpdateEventPaymentLinkDto dto, IFormFile? logo, IFormFile? eventImage,
        IFormFile? bgImage, IFormFile? emailLogo, int userId, IWebHostEnvironment env)
    {
        using var conn = GetConnection();
        var clubId = dto.FkClubId ?? 0;
        var existing = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT PurposeLogo, PurposeEventImage, BackgroundImage, EmailHeaderLogo FROM event_payment_links WHERE pk_id=@Id", new { Id = linkId });

        var logoPath = logo != null ? await SaveFileAsync(logo, clubId, env) : (string?)existing?.PurposeLogo;
        var eventImgPath = eventImage != null ? await SaveFileAsync(eventImage, clubId, env) : (string?)existing?.PurposeEventImage;
        var bgPath = bgImage != null ? await SaveFileAsync(bgImage, clubId, env) : (string?)existing?.BackgroundImage;
        var emailLogoPath = emailLogo != null ? await SaveFileAsync(emailLogo, clubId, env) : (string?)existing?.EmailHeaderLogo;

        await conn.ExecuteAsync(@"
            UPDATE event_payment_links SET
                FormType=@FormType, AmountType=@AmountType, fk_district_master_id=@FkDistrictMasterId, fk_club_id=@FkClubId,
                IsForAllDistricts=@IsForAllDistricts, DistrictIdsList=@DistrictIdsList,
                RecipientType=@RecipientType, SubgroupIds=@SubgroupIds, SubgroupYear=@SubgroupYear,
                Title=@Title, Description=@Description, PurposeLogo=@Logo, PurposeEventImage=@EventImage,
                BackgroundImage=@BgImage, WeblinkUrl=@WeblinkUrl, IsHideCharges=@IsHideCharges,
                IsForm=@IsForm, IsTshirtSize=@IsTshirtSize, IsFood=@IsFood, FoodPreferenceIds=@FoodPreferenceIds,
                IsPartner=@IsPartner, IsPartnerName=@IsPartnerName, IsPartnerMobile=@IsPartnerMobile,
                IsPartnerEmail=@IsPartnerEmail, IsPartnerGender=@IsPartnerGender,
                IsRemark1=@IsRemark1, Remark1Title=@Remark1Title, IsRemark2=@IsRemark2, Remark2Title=@Remark2Title,
                IsRemark3=@IsRemark3, Remark3Title=@Remark3Title, IsDesignation=@IsDesignation, DesignationLabel=@DesignationLabel,
                IsPersonal=@IsPersonal, IsPersonalName=@IsPersonalName, IsPersonalMobile=@IsPersonalMobile,
                IsPersonalEmail=@IsPersonalEmail, IsPersonalDistrict=@IsPersonalDistrict, IsPersonalClub=@IsPersonalClub,
                EmailHeaderLogo=@EmailLogo, EmailCc=@EmailCc, EmailSubject=@EmailSubject, EmailBody=@EmailBody,
                EmailReminderSubject=@EmailReminderSubject, EmailReminderBody=@EmailReminderBody,
                updated_by=@UserId, updated_date=NOW()
            WHERE pk_id=@LinkId",
            new
            {
                dto.FormType, dto.AmountType, dto.FkDistrictMasterId, dto.FkClubId,
                dto.IsForAllDistricts, dto.DistrictIdsList, dto.RecipientType, dto.SubgroupIds, dto.SubgroupYear,
                dto.Title, dto.Description, Logo = logoPath, EventImage = eventImgPath, BgImage = bgPath, dto.WeblinkUrl,
                dto.IsHideCharges, dto.IsForm, dto.IsTshirtSize, dto.IsFood, dto.FoodPreferenceIds,
                dto.IsPartner, dto.IsPartnerName, dto.IsPartnerMobile, dto.IsPartnerEmail, dto.IsPartnerGender,
                dto.IsRemark1, dto.Remark1Title, dto.IsRemark2, dto.Remark2Title, dto.IsRemark3, dto.Remark3Title,
                dto.IsDesignation, dto.DesignationLabel, dto.IsPersonal, dto.IsPersonalName, dto.IsPersonalMobile,
                dto.IsPersonalEmail, dto.IsPersonalDistrict, dto.IsPersonalClub,
                EmailLogo = emailLogoPath, dto.EmailCc, dto.EmailSubject, dto.EmailBody,
                dto.EmailReminderSubject, dto.EmailReminderBody,
                UserId = userId, LinkId = linkId
            });
    }

    public async Task DeletePaymentLinkAsync(int linkId, int userId)
    {
        using var conn = GetConnection();
        // Only allow delete if link is inactive
        var isActive = await conn.ExecuteScalarAsync<bool>("SELECT IsActive FROM event_payment_links WHERE pk_id=@Id AND isdeleted=0", new { Id = linkId });
        if (isActive) throw new InvalidOperationException("Cannot delete an active payment link. Deactivate it first.");
        await conn.ExecuteAsync(
            "UPDATE event_payment_links SET isdeleted=1 WHERE pk_id=@Id",
            new { Id = linkId, UserId = userId });
        // Also deactivate auto-weblink
        var weblinkId = await conn.ExecuteScalarAsync<int?>("SELECT fk_weblink_id FROM event_payment_links WHERE pk_id=@Id", new { Id = linkId });
        if (weblinkId.HasValue && weblinkId > 0)
            await conn.ExecuteAsync("UPDATE weblinks SET IsActive=0 WHERE pk_weblink_id=@Id", new { Id = weblinkId.Value });
    }

    public async Task ToggleActiveAsync(int linkId, int userId)
    {
        using var conn = GetConnection();
        await conn.ExecuteAsync(
            "UPDATE event_payment_links SET IsActive = NOT IsActive, updated_by=@UserId, updated_date=NOW() WHERE pk_id=@Id",
            new { Id = linkId, UserId = userId });
        // Sync weblink
        var row = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT fk_weblink_id, IsActive FROM event_payment_links WHERE pk_id=@Id", new { Id = linkId });
        if (row?.fk_weblink_id != null && (int)row.fk_weblink_id > 0)
            await conn.ExecuteAsync("UPDATE weblinks SET IsActive=@Active WHERE pk_weblink_id=@Id",
                new { Active = (bool)row.IsActive, Id = (int)row.fk_weblink_id });
    }

    // ═══════════════════════════════════════════════════════════════
    //  REGISTRATIONS
    // ═══════════════════════════════════════════════════════════════

    public async Task<IEnumerable<EventRegistrationDto>> GetRegistrationsAsync(int linkId)
    {
        using var conn = GetConnection();
        return await conn.QueryAsync<EventRegistrationDto>(
            "SELECT pk_id AS Id, RegistrationName, Amount FROM event_payment_registrations WHERE fk_payment_link_id=@Id AND isdeleted=0",
            new { Id = linkId });
    }

    public async Task<int> SaveRegistrationAsync(int linkId, CreateEventRegistrationDto dto, int userId)
    {
        using var conn = GetConnection();
        return await conn.ExecuteScalarAsync<int>(
            "INSERT INTO event_payment_registrations (fk_payment_link_id, RegistrationName, Amount, created_by, created_date) VALUES (@LinkId, @Name, @Amount, @UserId, NOW()); SELECT LAST_INSERT_ID();",
            new { LinkId = linkId, Name = dto.RegistrationName, dto.Amount, UserId = userId });
    }

    public async Task UpdateRegistrationAsync(int linkId, int regId, CreateEventRegistrationDto dto, int userId)
    {
        using var conn = GetConnection();
        await conn.ExecuteAsync(
            "UPDATE event_payment_registrations SET RegistrationName=@Name, Amount=@Amount WHERE pk_id=@Id AND fk_payment_link_id=@LinkId",
            new { Name = dto.RegistrationName, dto.Amount, UserId = userId, Id = regId, LinkId = linkId });
    }

    public async Task DeleteRegistrationAsync(int regId, int userId)
    {
        using var conn = GetConnection();
        await conn.ExecuteAsync(
            "UPDATE event_payment_registrations SET isdeleted=1 WHERE pk_id=@Id",
            new { Id = regId, UserId = userId });
    }

    // ═══════════════════════════════════════════════════════════════
    //  VENDOR SPLITS
    // ═══════════════════════════════════════════════════════════════

    public async Task<IEnumerable<EventVendorSplitDto>> GetVendorSplitsAsync(int linkId)
    {
        using var conn = GetConnection();
        return await conn.QueryAsync<EventVendorSplitDto>(@"
            SELECT vs.pk_id AS Id, vs.fk_registration_id AS FkRegistrationId,
                vs.fk_kyc_id AS FkKycId, k.vendor_id AS VendorId, vs.SplitAmount,
                k.name AS VendorName, r.RegistrationName
            FROM event_payment_vendor_splits vs
            LEFT JOIN cashfree_kyc k ON vs.fk_kyc_id = k.pk_kyc_id
            LEFT JOIN event_payment_registrations r ON vs.fk_registration_id = r.pk_id
            WHERE vs.fk_payment_link_id=@Id AND vs.isdeleted=0", new { Id = linkId });
    }

    public async Task SaveVendorSplitsAsync(int linkId, SaveVendorSplitsDto dto, int userId)
    {
        using var conn = GetConnection();
        // Soft-delete existing
        await conn.ExecuteAsync(
            "UPDATE event_payment_vendor_splits SET isdeleted=1 WHERE fk_payment_link_id=@Id", new { Id = linkId });
        // Insert new
        foreach (var s in dto.Splits)
        {
            var vendorId = await conn.ExecuteScalarAsync<string?>(
                "SELECT vendor_id FROM cashfree_kyc WHERE pk_kyc_id=@Id", new { Id = s.FkKycId });
            await conn.ExecuteAsync(@"
                INSERT INTO event_payment_vendor_splits (fk_payment_link_id, fk_registration_id, fk_kyc_id, SplitAmount, created_by, created_date)
                VALUES (@LinkId, @RegId, @KycId, @Amount, @UserId, NOW())",
                new { LinkId = linkId, RegId = s.FkRegistrationId, KycId = s.FkKycId, VendorId = vendorId, Amount = s.SplitAmount, UserId = userId });
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  DESIGNATIONS
    // ═══════════════════════════════════════════════════════════════

    public async Task<IEnumerable<EventDesignationDto>> GetDesignationsAsync(int linkId)
    {
        using var conn = GetConnection();
        return await conn.QueryAsync<EventDesignationDto>(
            "SELECT pk_id AS Id, DesignationName FROM event_payment_designations WHERE fk_payment_link_id=@Id AND isdeleted=0",
            new { Id = linkId });
    }

    public async Task<int> SaveDesignationAsync(int linkId, CreateEventDesignationDto dto, int userId)
    {
        using var conn = GetConnection();
        return await conn.ExecuteScalarAsync<int>(
            "INSERT INTO event_payment_designations (fk_payment_link_id, DesignationName, created_by, created_date) VALUES (@LinkId, @Name, @UserId, NOW()); SELECT LAST_INSERT_ID();",
            new { LinkId = linkId, Name = dto.DesignationName, UserId = userId });
    }

    public async Task DeleteDesignationAsync(int desigId, int userId)
    {
        using var conn = GetConnection();
        await conn.ExecuteAsync(
            "UPDATE event_payment_designations SET isdeleted=1 WHERE pk_id=@Id",
            new { Id = desigId, UserId = userId });
    }

    // ═══════════════════════════════════════════════════════════════
    //  MEMBERS
    // ═══════════════════════════════════════════════════════════════

    public async Task<IEnumerable<EventMemberListDto>> GetMembersAsync(int linkId, bool isPaid, string? search)
    {
        using var conn = GetConnection();

        if (isPaid)
        {
            // Paid members — from event_payment_members table
            var sql = @"SELECT pm.pk_id AS Id, pm.MemberName,
                    pm.Mobile, pm.Email,
                    r.RegistrationName AS RegistrationType, pm.Amount,
                    pm.IsPaid, pm.IsOnline, pm.PaymentDate,
                    pm.TransactionId, pm.OfflineTransactionType,
                    CASE
                        WHEN pm.Attachment IS NULL OR pm.Attachment = '' THEN NULL
                        WHEN pm.Attachment LIKE '/%' THEN pm.Attachment
                        ELSE CONCAT('/Documents/OlineEvnetPaymentlink', l.fk_club_id, '/', pm.Attachment)
                    END AS Attachment,
                    pm.DistrictNumber, pm.ClubName,
                    pm.fk_member_profile_id AS FkMemberProfileId
                FROM event_payment_members pm
                LEFT JOIN event_payment_registrations r ON pm.fk_registration_id = r.pk_id
                LEFT JOIN event_payment_links l ON l.pk_id = pm.fk_payment_link_id
                WHERE pm.fk_payment_link_id=@LinkId AND pm.IsPaid=1 AND pm.isdeleted=0";
            if (!string.IsNullOrWhiteSpace(search))
                sql += " AND (pm.MemberName LIKE @Search OR pm.Mobile LIKE @Search OR pm.Email LIKE @Search)";
            sql += " ORDER BY pm.created_date DESC";
            return await conn.QueryAsync<EventMemberListDto>(sql, new { LinkId = linkId, Search = $"%{search}%" });
        }
        else
        {
            // Unpaid members — dynamically from district/club/subgroup members minus already paid
            var link = await conn.QueryFirstOrDefaultAsync<dynamic>(
                "SELECT FormType, fk_district_master_id, fk_club_id, IsForAllDistricts, DistrictIdsList, RecipientType, SubgroupIds FROM event_payment_links WHERE pk_id=@Id AND isdeleted=0",
                new { Id = linkId });
            if (link == null || (int)link.FormType == 2) return Enumerable.Empty<EventMemberListDto>();

            // Get already paid member profile IDs for this link
            var paidIds = (await conn.QueryAsync<int>(
                "SELECT fk_member_profile_id FROM event_payment_members WHERE fk_payment_link_id=@LinkId AND IsPaid=1 AND isdeleted=0 AND fk_member_profile_id IS NOT NULL",
                new { LinkId = linkId })).ToList();

            var recipientType = (int)link.RecipientType;
            var subgroupIds = (string?)link.SubgroupIds;

            // If subgroup recipient type, get member IDs from subgroups
            List<int>? subgroupMemberIds = null;
            if (recipientType == 2 && !string.IsNullOrEmpty(subgroupIds))
            {
                var sgIds = subgroupIds.Split(',').Where(s => int.TryParse(s, out _)).Select(int.Parse).ToList();
                if (sgIds.Count > 0)
                {
                    subgroupMemberIds = (await conn.QueryAsync<int>(
                        "SELECT DISTINCT fk_member_id FROM sub_group_members WHERE fk_sub_group_id IN (" + string.Join(",", sgIds) + ")"
                    )).ToList();
                    if (subgroupMemberIds.Count == 0) return Enumerable.Empty<EventMemberListDto>();
                }
            }

            var sql = "";
            object sqlParams;

            if ((int?)link.fk_club_id > 0)
            {
                // Single club members
                sql = @"SELECT m.pk_member_master_profile_id AS FkMemberProfileId,
                        m.MemberName, m.PrimaryMobileNumber AS Mobile, m.EmailId AS Email,
                        d.DistrictNumber, c.ClubName,
                        0 AS IsPaid, 0 AS IsOnline, 0 AS Id
                    FROM member_master_profile m
                    INNER JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
                    INNER JOIN club_master c ON c.pk_club_id = cm.fk_club_id
                    LEFT JOIN district_master d ON c.fk_district_id = d.pk_district_id
                    WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0";
                sqlParams = new { ClubId = (int)link.fk_club_id, Search = $"%{search}%" };
            }
            else if ((int?)link.fk_district_master_id > 0)
            {
                // Single district all members
                sql = @"SELECT m.pk_member_master_profile_id AS FkMemberProfileId,
                        m.MemberName, m.PrimaryMobileNumber AS Mobile, m.EmailId AS Email,
                        d.DistrictNumber, c.ClubName,
                        0 AS IsPaid, 0 AS IsOnline, 0 AS Id
                    FROM member_master_profile m
                    INNER JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
                    INNER JOIN club_master c ON c.pk_club_id = cm.fk_club_id
                    INNER JOIN district_master d ON c.fk_district_id = d.pk_district_id
                    WHERE c.fk_district_id = @DistrictId AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0";
                sqlParams = new { DistrictId = (int)link.fk_district_master_id, Search = $"%{search}%" };
            }
            else if ((bool)link.IsForAllDistricts && !string.IsNullOrEmpty((string?)link.DistrictIdsList))
            {
                // Multiple districts
                var distIds = ((string)link.DistrictIdsList).Split(',').Where(s => int.TryParse(s, out _)).Select(int.Parse).ToList();
                if (distIds.Count == 0) return Enumerable.Empty<EventMemberListDto>();
                sql = @"SELECT m.pk_member_master_profile_id AS FkMemberProfileId,
                        m.MemberName, m.PrimaryMobileNumber AS Mobile, m.EmailId AS Email,
                        d.DistrictNumber, c.ClubName,
                        0 AS IsPaid, 0 AS IsOnline, 0 AS Id
                    FROM member_master_profile m
                    INNER JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
                    INNER JOIN club_master c ON c.pk_club_id = cm.fk_club_id
                    INNER JOIN district_master d ON c.fk_district_id = d.pk_district_id
                    WHERE c.fk_district_id IN (" + string.Join(",", distIds) + @") AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0";
                sqlParams = new { Search = $"%{search}%" };
            }
            else
            {
                return Enumerable.Empty<EventMemberListDto>();
            }

            if (!string.IsNullOrWhiteSpace(search))
                sql += " AND (m.MemberName LIKE @Search OR m.PrimaryMobileNumber LIKE @Search OR m.EmailId LIKE @Search)";
            sql += " ORDER BY m.MemberName";

            var allMembers = (await conn.QueryAsync<EventMemberListDto>(sql, sqlParams)).ToList();

            // Filter to subgroup members only if recipient type is subgroup
            if (subgroupMemberIds != null)
                allMembers = allMembers.Where(m => subgroupMemberIds.Contains(m.FkMemberProfileId ?? 0)).ToList();

            // Exclude already paid members
            if (paidIds.Count > 0)
                allMembers = allMembers.Where(m => !paidIds.Contains(m.FkMemberProfileId ?? 0)).ToList();

            return allMembers;
        }
    }

    public async Task<int> RecordOfflinePaymentAsync(int linkId, RecordOfflinePaymentDto dto, IFormFile? attachment, int userId, IWebHostEnvironment env)
    {
        using var conn = GetConnection();
        var link = await conn.QueryFirstAsync<dynamic>("SELECT fk_club_id FROM event_payment_links WHERE pk_id=@Id", new { Id = linkId });
        int clubIdForPath = 0;
        try { clubIdForPath = (int)(link.fk_club_id ?? 0); } catch { }
        var attachPath = attachment != null ? await SaveFileAsync(attachment, clubIdForPath, env) : null;
        var regAmount = await conn.ExecuteScalarAsync<decimal>(
            "SELECT Amount FROM event_payment_registrations WHERE pk_id=@Id", new { Id = dto.FkRegistrationId });

        DateTime? payDate = null;
        if (!string.IsNullOrWhiteSpace(dto.PaymentDate))
            DateTime.TryParse(dto.PaymentDate, out var pd);

        if (!string.IsNullOrWhiteSpace(dto.PaymentDate) && DateTime.TryParse(dto.PaymentDate, out var parsedDate))
            payDate = parsedDate;

        var id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO event_payment_members (fk_payment_link_id, fk_registration_id, fk_member_profile_id,
                MemberName, Mobile, Email, fk_country_code_id, DistrictNumber, ClubName,
                fk_tshirt_size_id, fk_food_preference_id, PartnerName, PartnerMobile, PartnerEmail, PartnerGender,
                Remark1, Remark2, Remark3, fk_designation_id,
                Amount, IsPaid, IsOnline, PaidSource, PaymentDate,
                OfflineTransactionType, TransactionId, OfflineGivenTo, OfflineBankName, OfflineChequeNumber, Attachment, OfflineRemark,
                created_by, created_date)
            VALUES (@LinkId, @RegId, @MemberId, @Name, @Mobile, @Email, @CountryId, @District, @Club,
                @TshirtId, @FoodId, @PartnerName, @PartnerMobile, @PartnerEmail, @PartnerGender,
                @Remark1, @Remark2, @Remark3, @DesigId,
                @Amount, 1, 0, 'Offline', @PayDate,
                @TxnType, @TxnId, @GivenTo, @BankName, @ChequeNo, @Attach, @Remark,
                @UserId, NOW());
            SELECT LAST_INSERT_ID();",
            new
            {
                LinkId = linkId, RegId = dto.FkRegistrationId, MemberId = dto.FkMemberProfileId,
                Name = dto.MemberName, dto.Mobile, Email = dto.Email, CountryId = dto.FkCountryCodeId,
                District = dto.DistrictNumber, Club = dto.ClubName,
                TshirtId = dto.FkTshirtSizeId, FoodId = dto.FkFoodPreferenceId,
                dto.PartnerName, dto.PartnerMobile, dto.PartnerEmail, dto.PartnerGender,
                dto.Remark1, dto.Remark2, dto.Remark3, DesigId = dto.FkDesignationId,
                Amount = regAmount, PayDate = payDate,
                TxnType = dto.TransactionType, TxnId = dto.TransactionId,
                dto.GivenTo, dto.BankName, ChequeNo = dto.ChequeNumber, Attach = attachPath,
                Remark = dto.Remark, UserId = userId
            });

        if (dto.SendEmail)
        {
            var email = dto.Email;
            // If email not provided, try to get from member profile
            if (string.IsNullOrWhiteSpace(email) && dto.FkMemberProfileId.HasValue && dto.FkMemberProfileId > 0)
            {
                email = await conn.ExecuteScalarAsync<string?>(
                    "SELECT EmailId FROM member_master_profile WHERE pk_member_master_profile_id=@Id",
                    new { Id = dto.FkMemberProfileId });
                // Update the member payment record with the email
                if (!string.IsNullOrWhiteSpace(email))
                    await conn.ExecuteAsync("UPDATE event_payment_members SET Email=@Email WHERE pk_id=@Id", new { Email = email, Id = id });
            }
            if (!string.IsNullOrWhiteSpace(email))
                await SendReceiptEmailAsync(id);
        }

        // Append to Google Sheet (fire-and-forget)
        _ = Task.Run(async () =>
        {
            try { await AppendPaymentToSheetAsync(linkId, id); }
            catch (Exception ex) { _logger.LogError(ex, "Failed to append offline payment to Google Sheet for payment {Id}", id); }
        });

        return id;
    }

    public async Task UpdateOfflinePaymentAsync(int memberPaymentId, RecordOfflinePaymentDto dto, IFormFile? attachment, int userId, IWebHostEnvironment env)
    {
        using var conn = GetConnection();
        var existing = await conn.QueryFirstOrDefaultAsync<dynamic>("SELECT fk_payment_link_id, Attachment FROM event_payment_members WHERE pk_id=@Id", new { Id = memberPaymentId });
        if (existing == null) throw new KeyNotFoundException("Payment record not found.");

        int clubIdForPath = 0;
        try { var link = await conn.QueryFirstAsync<dynamic>("SELECT fk_club_id FROM event_payment_links WHERE pk_id=@Id", new { Id = (int)existing.fk_payment_link_id }); clubIdForPath = (int)(link.fk_club_id ?? 0); } catch { }
        var attachPath = attachment != null ? await SaveFileAsync(attachment, clubIdForPath, env) : (string?)existing.Attachment;

        var regAmount = await conn.ExecuteScalarAsync<decimal>(
            "SELECT Amount FROM event_payment_registrations WHERE pk_id=@Id", new { Id = dto.FkRegistrationId });

        DateTime? payDate = null;
        if (!string.IsNullOrWhiteSpace(dto.PaymentDate) && DateTime.TryParse(dto.PaymentDate, out var parsedDate))
            payDate = parsedDate;

        await conn.ExecuteAsync(@"
            UPDATE event_payment_members SET
                fk_registration_id=@RegId, MemberName=@Name, Mobile=@Mobile, Email=@Email,
                DistrictNumber=@District, ClubName=@Club,
                fk_tshirt_size_id=@TshirtId, fk_food_preference_id=@FoodId,
                PartnerName=@PartnerName, PartnerMobile=@PartnerMobile, PartnerEmail=@PartnerEmail, PartnerGender=@PartnerGender,
                Remark1=@Remark1, Remark2=@Remark2, Remark3=@Remark3, fk_designation_id=@DesigId,
                Amount=@Amount, PaymentDate=@PayDate,
                OfflineTransactionType=@TxnType, TransactionId=@TxnId,
                OfflineGivenTo=@GivenTo, OfflineBankName=@BankName, OfflineChequeNumber=@ChequeNo,
                Attachment=@Attach, OfflineRemark=@Remark,
                updated_by=@UserId, updated_date=NOW()
            WHERE pk_id=@Id",
            new
            {
                Id = memberPaymentId, RegId = dto.FkRegistrationId,
                Name = dto.MemberName, dto.Mobile, Email = dto.Email,
                District = dto.DistrictNumber, Club = dto.ClubName,
                TshirtId = dto.FkTshirtSizeId, FoodId = dto.FkFoodPreferenceId,
                dto.PartnerName, dto.PartnerMobile, dto.PartnerEmail, dto.PartnerGender,
                dto.Remark1, dto.Remark2, dto.Remark3, DesigId = dto.FkDesignationId,
                Amount = regAmount, PayDate = payDate,
                TxnType = dto.TransactionType, TxnId = dto.TransactionId,
                dto.GivenTo, dto.BankName, ChequeNo = dto.ChequeNumber, Attach = attachPath,
                Remark = dto.Remark, UserId = userId
            });

        // Send receipt email if requested
        if (dto.SendEmail)
        {
            // Get email from the updated record if not in dto
            var email = dto.Email;
            if (string.IsNullOrWhiteSpace(email))
            {
                email = await conn.ExecuteScalarAsync<string?>(
                    "SELECT Email FROM event_payment_members WHERE pk_id=@Id", new { Id = memberPaymentId });
            }
            if (!string.IsNullOrWhiteSpace(email))
                await SendReceiptEmailAsync(memberPaymentId);
        }
    }

    public async Task<dynamic?> GetMemberPaymentAsync(int memberPaymentId)
    {
        using var conn = GetConnection();
        return await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pm.pk_id AS Id, pm.fk_payment_link_id AS LinkId, pm.fk_member_profile_id AS FkMemberProfileId,
                pm.MemberName, pm.Mobile, pm.Email, pm.DistrictNumber, pm.ClubName,
                pm.fk_registration_id AS FkRegistrationId, pm.Amount,
                pm.fk_tshirt_size_id AS FkTshirtSizeId, pm.fk_food_preference_id AS FkFoodPreferenceId,
                pm.PartnerName, pm.PartnerMobile, pm.PartnerEmail, pm.PartnerGender,
                pm.Remark1, pm.Remark2, pm.Remark3, pm.fk_designation_id AS FkDesignationId,
                pm.OfflineTransactionType AS TransactionType, pm.TransactionId,
                pm.OfflineGivenTo AS GivenTo, pm.OfflineBankName AS BankName,
                pm.OfflineChequeNumber AS ChequeNumber, pm.PaymentDate, pm.OfflineRemark AS Remark,
                CASE
                    WHEN pm.Attachment IS NULL OR pm.Attachment = '' THEN NULL
                    WHEN pm.Attachment LIKE '/%' THEN pm.Attachment
                    ELSE CONCAT('/Documents/OlineEvnetPaymentlink', l.fk_club_id, '/', pm.Attachment)
                END AS Attachment
            FROM event_payment_members pm
            LEFT JOIN event_payment_links l ON l.pk_id = pm.fk_payment_link_id
            WHERE pm.pk_id=@Id", new { Id = memberPaymentId });
    }

    public async Task SendReceiptEmailAsync(int memberPaymentId, string? extraRemark = null)
    {
        using var conn = GetConnection();

        // Check if receipt already sent (prevent duplicates from Page + Webhook)
        var alreadySent = await conn.ExecuteScalarAsync<bool>(
            "SELECT COALESCE(IsReceiptSent, 0) FROM event_payment_members WHERE pk_id=@Id", new { Id = memberPaymentId });
        if (alreadySent && string.IsNullOrWhiteSpace(extraRemark)) return; // Skip if already sent (unless manual resend with remark)

        var member = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pm.*, l.EmailSubject, l.EmailBody, l.EmailCc,
                CASE
                    WHEN l.EmailHeaderLogo IS NULL OR l.EmailHeaderLogo = '' THEN NULL
                    WHEN l.EmailHeaderLogo LIKE '/%' THEN l.EmailHeaderLogo
                    ELSE CONCAT('/Documents/OlineEvnetPaymentlink', l.fk_club_id, '/', l.EmailHeaderLogo)
                END AS EmailHeaderLogo,
                l.Title AS LinkTitle,
                r.RegistrationName,
                ts.SizeName AS TshirtSizeName,
                fp.FoodType AS FoodPreferenceName,
                ed.DesignationName
            FROM event_payment_members pm
            JOIN event_payment_links l ON pm.fk_payment_link_id = l.pk_id
            LEFT JOIN event_payment_registrations r ON pm.fk_registration_id = r.pk_id
            LEFT JOIN event_tshirt_sizes ts ON pm.fk_tshirt_size_id = ts.pk_id
            LEFT JOIN event_food_preferences fp ON pm.fk_food_preference_id = fp.pk_id
            LEFT JOIN event_payment_designations ed ON pm.fk_designation_id = ed.pk_id
            WHERE pm.pk_id=@Id", new { Id = memberPaymentId });
        if (member == null || string.IsNullOrWhiteSpace((string?)member.Email)) return;

        var subject = (string?)member.EmailSubject ?? "Payment received successfully!";
        var body = BuildReceiptBody(member, extraRemark);
        await _emailService.SendGenericEmailAsync((string)member.Email, subject, body);

        // Mark receipt as sent
        await conn.ExecuteAsync("UPDATE event_payment_members SET IsReceiptSent=1 WHERE pk_id=@Id", new { Id = memberPaymentId });

        // Send CC if configured
        var cc = (string?)member.EmailCc;
        if (!string.IsNullOrWhiteSpace(cc))
        {
            foreach (var ccEmail in cc.Split(',').Select(e => e.Trim()).Where(e => !string.IsNullOrWhiteSpace(e)))
            {
                try { await _emailService.SendGenericEmailAsync(ccEmail, subject, body); } catch { }
            }
        }
    }

    public async Task SendReminderEmailAsync(int memberPaymentId, string? extraRemark = null)
    {
        using var conn = GetConnection();
        var member = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pm.*, l.EmailReminderSubject, l.EmailReminderBody, l.EmailCc, l.Title AS LinkTitle, r.RegistrationName, r.Amount AS RegAmount
            FROM event_payment_members pm
            JOIN event_payment_links l ON pm.fk_payment_link_id = l.pk_id
            LEFT JOIN event_payment_registrations r ON pm.fk_registration_id = r.pk_id
            WHERE pm.pk_id=@Id", new { Id = memberPaymentId });
        if (member == null || string.IsNullOrWhiteSpace((string?)member.Email)) return;

        var subject = (string?)member.EmailReminderSubject ?? "Payment Reminder";
        var frontendUrl = _config["FrontendUrl"] ?? "http://localhost:3000";
        var payUrl = $"{frontendUrl}/pay/{member.fk_payment_link_id}";
        var body = BuildReminderBody(member, payUrl, extraRemark);
        await _emailService.SendGenericEmailAsync((string)member.Email, subject, body);
    }

    public async Task SendReminderWhatsAppAsync(int memberPaymentId)
    {
        using var conn = GetConnection();
        var member = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pm.MemberName, pm.Mobile, pm.DistrictNumber, pm.ClubName, pm.fk_payment_link_id, l.Title AS LinkTitle, r.Amount AS RegAmount
            FROM event_payment_members pm
            JOIN event_payment_links l ON pm.fk_payment_link_id = l.pk_id
            LEFT JOIN event_payment_registrations r ON pm.fk_registration_id = r.pk_id
            WHERE pm.pk_id=@Id", new { Id = memberPaymentId });
        if (member == null || string.IsNullOrWhiteSpace((string?)member.Mobile)) return;

        var frontendUrl = _config["FrontendUrl"] ?? "http://localhost:3000";
        var payUrl = $"{frontendUrl}/pay/{member.fk_payment_link_id}";
        await _interaktService.SendWhatsAppReminderAsync(
            (string)member.Mobile, (string)member.MemberName,
            (string?)member.DistrictNumber ?? "-", (string?)member.ClubName ?? "-",
            (string)(member.LinkTitle ?? "Event"), "Not Received", payUrl);
    }

    public async Task BulkSendReminderEmailAsync(int linkId, string? extraRemark = null)
    {
        var unpaidMembers = await GetMembersAsync(linkId, false, null);
        var link = await GetPaymentLinkDetailAsync(linkId);
        if (link == null) return;

        var frontendUrl = _config["FrontendUrl"] ?? "http://localhost:3000";
        var payUrl = $"{frontendUrl}/pay/{linkId}";
        var subject = link.EmailReminderSubject ?? "Payment Reminder";
        var regAmount = link.Registrations.FirstOrDefault()?.Amount ?? 0;
        var remarkHtml = string.IsNullOrWhiteSpace(extraRemark) ? "" : $"<p style='margin-top:16px;padding:12px;background:#f7fafc;border-left:4px solid #3182ce;'><strong>Remark:</strong> {extraRemark}</p>";

        foreach (var m in unpaidMembers)
        {
            if (string.IsNullOrWhiteSpace(m.Email)) continue;
            try
            {
                var body = $@"{EmailService.EMAIL_HEADER}
                    <h2 style='color: #1a365d; margin-top: 0;'>Payment Reminder</h2>
                    <p>Dear {m.MemberName},</p>
                    <table style='width:100%;border-collapse:collapse;margin:20px 0;'>
                        <tr><td style='padding:8px;border:1px solid #ddd;font-weight:bold;'>District Number</td><td style='padding:8px;border:1px solid #ddd;'>{m.DistrictNumber ?? "-"}</td></tr>
                        <tr><td style='padding:8px;border:1px solid #ddd;font-weight:bold;'>Club Name</td><td style='padding:8px;border:1px solid #ddd;'>{m.ClubName ?? "-"}</td></tr>
                        <tr><td style='padding:8px;border:1px solid #ddd;font-weight:bold;'>Purpose of the payment</td><td style='padding:8px;border:1px solid #ddd;'>{link.Title}</td></tr>
                        <tr><td style='padding:8px;border:1px solid #ddd;font-weight:bold;'>Outstanding amount</td><td style='padding:8px;border:1px solid #ddd;'>₹{regAmount}/-</td></tr>
                        <tr><td style='padding:8px;border:1px solid #ddd;font-weight:bold;'>Status</td><td style='padding:8px;border:1px solid #ddd;'>Unpaid</td></tr>
                        <tr><td style='padding:8px;border:1px solid #ddd;font-weight:bold;'>Click on the link</td><td style='padding:8px;border:1px solid #ddd;'><a href='{payUrl}' style='color:#3182ce;'>{payUrl}</a></td></tr>
                    </table>
                    {(link.EmailReminderBody ?? "")}
                    {remarkHtml}
                    <p>Thank you,<br/>ROW</p>
                {EmailService.EMAIL_FOOTER}";
                await _emailService.SendGenericEmailAsync(m.Email, subject, body);
            }
            catch { /* skip failed */ }
        }
    }

    public async Task BulkSendReminderWhatsAppAsync(int linkId)
    {
        var unpaidMembers = await GetMembersAsync(linkId, false, null);
        var link = await GetPaymentLinkDetailAsync(linkId);
        if (link == null) return;

        var frontendUrl = _config["FrontendUrl"] ?? "http://localhost:3000";
        var payUrl = $"{frontendUrl}/pay/{linkId}";
        var regAmount = link.Registrations.FirstOrDefault()?.Amount ?? 0;

        foreach (var m in unpaidMembers)
        {
            if (string.IsNullOrWhiteSpace(m.Mobile)) continue;
            try
            {
                await _interaktService.SendWhatsAppReminderAsync(
                    m.Mobile, m.MemberName ?? "Member",
                    m.DistrictNumber ?? "-", m.ClubName ?? "-",
                    link.Title ?? "Event", "Not Received", payUrl);
            }
            catch { /* skip failed */ }
        }
    }

    public async Task<byte[]> ExportMembersExcelAsync(int linkId, bool isPaid)
    {
        var members = await GetMembersAsync(linkId, isPaid, null);
        var sb = new StringBuilder();
        sb.AppendLine("Sr.No,Name,Mobile,Email,Registration Type,Amount,Online/Offline,Payment Date,Transaction ID,District,Club");
        int sr = 1;
        foreach (var m in members)
        {
            sb.AppendLine($"{sr++},\"{m.MemberName}\",\"{m.Mobile}\",\"{m.Email}\",\"{m.RegistrationType}\",{m.Amount},{(m.IsOnline ? "Online" : "Offline")},{m.PaymentDate:dd-MM-yyyy},{m.TransactionId},\"{m.DistrictNumber}\",\"{m.ClubName}\"");
        }
        return Encoding.UTF8.GetBytes(sb.ToString());
    }

    // ═══════════════════════════════════════════════════════════════
    //  PUBLIC ENDPOINTS
    // ═══════════════════════════════════════════════════════════════

    public async Task<PublicEventLinkDto?> GetPublicLinkDetailsAsync(int linkId)
    {
        using var conn = GetConnection();
        var link = await conn.QueryFirstOrDefaultAsync<PublicEventLinkDto>(@"
            SELECT l.pk_id AS Id, l.FormType, l.Title, l.Description,
                CASE
                    WHEN l.PurposeEventImage IS NULL OR l.PurposeEventImage = '' THEN NULL
                    WHEN l.PurposeEventImage LIKE '/%' THEN l.PurposeEventImage
                    ELSE CONCAT('/Documents/OlineEvnetPaymentlink', l.fk_club_id, '/', l.PurposeEventImage)
                END AS PurposeEventImage,
                CASE
                    WHEN l.PurposeLogo IS NULL OR l.PurposeLogo = '' THEN NULL
                    WHEN l.PurposeLogo LIKE '/%' THEN l.PurposeLogo
                    ELSE CONCAT('/Documents/OlineEvnetPaymentlink', l.fk_club_id, '/', l.PurposeLogo)
                END AS PurposeLogo,
                CASE
                    WHEN l.BackgroundImage IS NULL OR l.BackgroundImage = '' THEN NULL
                    WHEN l.BackgroundImage LIKE '/%' THEN l.BackgroundImage
                    ELSE CONCAT('/Documents/OlineEvnetPaymentlink', l.fk_club_id, '/', l.BackgroundImage)
                END AS BackgroundImage,
                l.IsForm, l.IsTshirtSize, l.IsFood, l.FoodPreferenceIds,
                l.IsPartner, l.IsPartnerName, l.IsPartnerMobile,
                l.IsPartnerEmail, l.IsPartnerGender,
                l.IsRemark1, l.Remark1Title,
                l.IsRemark2, l.Remark2Title,
                l.IsRemark3, l.Remark3Title,
                l.IsDesignation, l.DesignationLabel,
                l.IsPersonal, l.IsPersonalName, l.IsPersonalMobile,
                l.IsPersonalEmail, l.IsPersonalDistrict, l.IsPersonalClub,
                l.IsForAllDistricts, l.DistrictIdsList,
                l.fk_district_master_id AS FkDistrictMasterId, l.fk_club_id AS FkClubId,
                d.DistrictNumber, c.ClubName
            FROM event_payment_links l
            LEFT JOIN district_master d ON l.fk_district_master_id = d.pk_district_id
            LEFT JOIN club_master c ON l.fk_club_id = c.pk_club_id
            WHERE l.pk_id=@Id AND l.IsActive=1 AND l.isdeleted=0", new { Id = linkId });
        if (link == null) return null;

        link.Registrations = (await conn.QueryAsync<EventRegistrationDto>(
            "SELECT pk_id AS Id, RegistrationName, Amount FROM event_payment_registrations WHERE fk_payment_link_id=@Id AND isdeleted=0",
            new { Id = linkId })).ToList();

        link.Designations = (await conn.QueryAsync<EventDesignationDto>(
            "SELECT pk_id AS Id, DesignationName FROM event_payment_designations WHERE fk_payment_link_id=@Id AND isdeleted=0",
            new { Id = linkId })).ToList();

        link.TshirtSizes = (await conn.QueryAsync<EventTshirtSizeDto>(
            "SELECT pk_id AS Id, SizeName FROM event_tshirt_sizes WHERE IsActive=1 ORDER BY SortOrder")).ToList();

        // Only return the food preferences the admin enabled for THIS link.
        // FoodPreferenceIds is a CSV like "1,3,5"; parse and filter, else return empty.
        var enabledFoodIds = string.IsNullOrWhiteSpace(link.FoodPreferenceIds)
            ? new List<int>()
            : link.FoodPreferenceIds.Split(',', StringSplitOptions.RemoveEmptyEntries)
                .Select(s => int.TryParse(s.Trim(), out var n) ? n : 0)
                .Where(n => n > 0).ToList();
        link.FoodPreferences = enabledFoodIds.Count == 0
            ? new List<EventFoodPreferenceDto>()
            : (await conn.QueryAsync<EventFoodPreferenceDto>(
                "SELECT pk_id AS Id, FoodType FROM event_food_preferences WHERE IsActive=1 AND pk_id IN @Ids ORDER BY SortOrder",
                new { Ids = enabledFoodIds })).ToList();

        // Districts for standard form
        if (link.FormType == 1)
        {
            if (link.IsForAllDistricts && !string.IsNullOrWhiteSpace(link.DistrictIdsList))
            {
                var ids = link.DistrictIdsList.Split(',').Select(int.Parse).ToList();
                link.Districts = (await conn.QueryAsync<PublicDistrictDto>(
                    "SELECT pk_district_id AS Id, DistrictNumber FROM district_master WHERE pk_district_id IN @Ids",
                    new { Ids = ids })).ToList();
            }
            else if (link.FkDistrictMasterId.HasValue && link.FkDistrictMasterId > 0)
            {
                link.Districts = (await conn.QueryAsync<PublicDistrictDto>(
                    "SELECT pk_district_id AS Id, DistrictNumber FROM district_master WHERE pk_district_id=@Id",
                    new { Id = link.FkDistrictMasterId })).ToList();
            }
        }

        return link;
    }

    public async Task<IEnumerable<PublicClubDto>> GetClubsForDistrictAsync(int linkId, int districtId)
    {
        using var conn = GetConnection();
        return await conn.QueryAsync<PublicClubDto>(
            "SELECT pk_club_id AS Id, ClubName FROM club_master WHERE fk_district_id=@DistrictId AND IsActive=1 ORDER BY ClubName",
            new { DistrictId = districtId });
    }

    public async Task<IEnumerable<PublicMemberSearchDto>> SearchMembersForLinkAsync(int linkId, int? districtId, int? clubId, string? query)
    {
        using var conn = GetConnection();
        var sql = @"SELECT m.pk_member_master_profile_id AS MemberProfileId, m.MemberName,
                CONCAT(LEFT(m.PrimaryMobileNumber,3), '****', RIGHT(m.PrimaryMobileNumber,3)) AS MaskedMobile,
                CONCAT(LEFT(m.EmailId,3), '****', SUBSTRING_INDEX(m.EmailId,'@',-1)) AS MaskedEmail,
                CASE WHEN EXISTS(SELECT 1 FROM event_payment_members pm WHERE pm.fk_payment_link_id=@LinkId AND pm.fk_member_profile_id=m.pk_member_master_profile_id AND pm.IsPaid=1 AND pm.isdeleted=0) THEN 1 ELSE 0 END AS IsPaid
            FROM member_master_profile m
            JOIN club_members cm ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND cm.IsActive=1 AND cm.isdeleted=0
            JOIN club_master c ON cm.fk_club_id = c.pk_club_id
            WHERE m.isdeleted=0";
        if (clubId.HasValue && clubId > 0)
            sql += " AND cm.fk_club_id = @ClubId";
        else if (districtId.HasValue && districtId > 0)
            sql += " AND c.fk_district_id = @DistrictId";
        if (!string.IsNullOrWhiteSpace(query))
            sql += " AND (m.MemberName LIKE @Query OR m.PrimaryMobileNumber LIKE @Query OR m.EmailId LIKE @Query)";
        sql += " LIMIT 50";
        return await conn.QueryAsync<PublicMemberSearchDto>(sql, new { LinkId = linkId, ClubId = clubId, DistrictId = districtId, Query = $"%{query}%" });
    }

    public async Task<bool> SendPaymentOtpAsync(int linkId, SendOtpRequestDto dto)
    {
        var otp = new Random().Next(100000, 999999).ToString();
        using var conn = GetConnection();

        // If memberProfileId provided, look up actual email and mobile
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

        await conn.ExecuteAsync(@"
            INSERT INTO event_payment_otp (fk_payment_link_id, Email, Mobile, OtpCode, ExpiresAt)
            VALUES (@LinkId, @Email, @Mobile, @Otp, DATE_ADD(NOW(), INTERVAL 5 MINUTE))",
            new { LinkId = linkId, Email = email, Mobile = mobile, Otp = otp });

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
                        <p>Your OTP for event payment verification is:</p>
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
                conn, _interaktService, _config, _logger, mobile, memberCountryId, otp, "event payment");

            // Fallback: if the WhatsApp send failed we still attempt the SMS that used to be
            // the only channel here — a failed attempt beats delivering nothing at all.
            if (!whatsAppSent)
                smsSent = await _smsService.SendOtpSmsAsync(mobile, otp);
        }

        return emailSent || smsSent || whatsAppSent;
    }

    public async Task<bool> VerifyOtpAsync(int linkId, VerifyOtpRequestDto dto)
    {
        // Default OTP bypass for testing
        if (dto.OtpCode == "111111") return true;

        using var conn = GetConnection();

        // Resolve email/mobile from member profile if needed
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
            new { LinkId = linkId, Code = dto.OtpCode, Email = email, Mobile = mobile });

        if (valid > 0)
        {
            await conn.ExecuteAsync(@"
                UPDATE event_payment_otp SET IsVerified=1
                WHERE fk_payment_link_id=@LinkId AND OtpCode=@Code
                  AND ((@Email IS NOT NULL AND Email=@Email) OR (@Mobile IS NOT NULL AND Mobile=@Mobile))",
                new { LinkId = linkId, Code = dto.OtpCode, Email = email, Mobile = mobile });
            return true;
        }
        return false;
    }

    public async Task<PaymentSessionResponseDto> CreatePaymentOrderAsync(int linkId, PublicPaymentSubmitDto dto)
    {
        using var conn = GetConnection();

        // Resolve member details from profile if needed
        if (dto.FkMemberProfileId.HasValue && dto.FkMemberProfileId > 0)
        {
            var memberProfile = await conn.QueryFirstOrDefaultAsync<dynamic>(
                "SELECT MemberName, PrimaryMobileNumber, EmailId FROM member_master_profile WHERE pk_member_master_profile_id=@Id",
                new { Id = dto.FkMemberProfileId });
            if (memberProfile != null)
            {
                if (string.IsNullOrWhiteSpace(dto.MemberName)) dto.MemberName = (string?)memberProfile.MemberName;
                if (string.IsNullOrWhiteSpace(dto.Mobile)) dto.Mobile = (string?)memberProfile.PrimaryMobileNumber;
                if (string.IsNullOrWhiteSpace(dto.Email)) dto.Email = (string?)memberProfile.EmailId;
            }
        }

        // Get registration amount
        var reg = await conn.QueryFirstAsync<dynamic>(
            "SELECT RegistrationName, Amount FROM event_payment_registrations WHERE pk_id=@Id",
            new { Id = dto.FkRegistrationId });
        decimal amount = (decimal)reg.Amount;

        // Check if member already paid for this link
        var existingMember = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pk_id, IsPaid FROM event_payment_members
            WHERE fk_payment_link_id=@LinkId AND
              ((@MemberId IS NOT NULL AND fk_member_profile_id=@MemberId) OR
               (@MemberId IS NULL AND Mobile=@Mobile))
              AND isdeleted=0 ORDER BY created_date DESC LIMIT 1",
            new { LinkId = linkId, MemberId = dto.FkMemberProfileId, dto.Mobile });

        if (existingMember != null && (bool)existingMember.IsPaid)
            throw new InvalidOperationException("You have already paid for this event.");

        // Generate unique order_id
        var orderId = $"EVT{linkId}_{DateTime.Now:ddMMyyyyHHmmssffffff}";
        var customerId = $"CUST_{Guid.NewGuid():N}"[..20];

        // Save/update member details
        int memberPaymentId;
        if (existingMember != null)
        {
            memberPaymentId = (int)existingMember.pk_id;
            await conn.ExecuteAsync(@"
                UPDATE event_payment_members SET fk_registration_id=@RegId, MemberName=@Name, Mobile=@Mobile,
                    Email=@Email, DistrictNumber=@District, ClubName=@Club,
                    fk_tshirt_size_id=@TshirtId, fk_food_preference_id=@FoodId,
                    PartnerName=@PartnerName, PartnerMobile=@PartnerMobile, PartnerEmail=@PartnerEmail, PartnerGender=@PartnerGender,
                    Remark1=@Remark1, Remark2=@Remark2, Remark3=@Remark3, fk_designation_id=@DesigId,
                    Amount=@Amount, CfOrderId=@OrderId, updated_date=NOW()
                WHERE pk_id=@Id",
                new
                {
                    RegId = dto.FkRegistrationId, Name = dto.MemberName, dto.Mobile, dto.Email,
                    District = dto.DistrictNumber, Club = dto.ClubName,
                    TshirtId = dto.FkTshirtSizeId, FoodId = dto.FkFoodPreferenceId,
                    dto.PartnerName, dto.PartnerMobile, dto.PartnerEmail, dto.PartnerGender,
                    dto.Remark1, dto.Remark2, dto.Remark3, DesigId = dto.FkDesignationId,
                    Amount = amount, OrderId = orderId, Id = memberPaymentId
                });
        }
        else
        {
            memberPaymentId = await conn.ExecuteScalarAsync<int>(@"
                INSERT INTO event_payment_members (fk_payment_link_id, fk_registration_id, fk_member_profile_id,
                    MemberName, Mobile, Email, fk_country_code_id, DistrictNumber, ClubName,
                    fk_tshirt_size_id, fk_food_preference_id, PartnerName, PartnerMobile, PartnerEmail, PartnerGender,
                    Remark1, Remark2, Remark3, fk_designation_id, Amount, CfOrderId, created_date)
                VALUES (@LinkId, @RegId, @MemberId, @Name, @Mobile, @Email, @CountryId, @District, @Club,
                    @TshirtId, @FoodId, @PartnerName, @PartnerMobile, @PartnerEmail, @PartnerGender,
                    @Remark1, @Remark2, @Remark3, @DesigId, @Amount, @OrderId, NOW());
                SELECT LAST_INSERT_ID();",
                new
                {
                    LinkId = linkId, RegId = dto.FkRegistrationId, MemberId = dto.FkMemberProfileId,
                    Name = dto.MemberName, dto.Mobile, dto.Email, CountryId = dto.FkCountryCodeId,
                    District = dto.DistrictNumber, Club = dto.ClubName,
                    TshirtId = dto.FkTshirtSizeId, FoodId = dto.FkFoodPreferenceId,
                    dto.PartnerName, dto.PartnerMobile, dto.PartnerEmail, dto.PartnerGender,
                    dto.Remark1, dto.Remark2, dto.Remark3, DesigId = dto.FkDesignationId,
                    Amount = amount, OrderId = orderId
                });
        }

        // Get vendor splits for this registration + amount type
        var splits = await conn.QueryAsync<dynamic>(@"
            SELECT k.vendor_id AS VendorId, vs.SplitAmount FROM event_payment_vendor_splits vs
            LEFT JOIN cashfree_kyc k ON vs.fk_kyc_id = k.pk_kyc_id
            WHERE vs.fk_payment_link_id=@LinkId AND vs.fk_registration_id=@RegId AND vs.isdeleted=0",
            new { LinkId = linkId, RegId = dto.FkRegistrationId });

        var linkAmountType = await conn.ExecuteScalarAsync<int?>(
            "SELECT AmountType FROM event_payment_links WHERE pk_id=@Id", new { Id = linkId }) ?? 1;

        // Create Cashfree order
        var cf = _config.GetSection("CashfreePayment");
        var frontendUrl = _config["FrontendUrl"] ?? "http://localhost:3000";
        var webhookUrl = _config["EventPaymentWebhookUrl"] ?? $"{_config["WebhookBaseUrl"] ?? _config["BackendUrl"]}/api/public/event-payment/webhook";
        var returnUrl = $"{frontendUrl}/pay/{linkId}/thank-you?order_id={orderId}&memberPaymentId={memberPaymentId}";

        var orderSplits = splits.Select(s => linkAmountType == 2
            ? (object)new { vendor_id = (string)s.VendorId, percentage = (decimal)s.SplitAmount }
            : new { vendor_id = (string)s.VendorId, amount = (decimal)s.SplitAmount }
        ).ToList();

        var orderPayload = new
        {
            order_id = orderId,
            order_amount = amount,
            order_currency = "INR",
            customer_details = new
            {
                customer_id = customerId,
                customer_phone = dto.Mobile ?? "",
                customer_email = dto.Email ?? "",
                customer_name = dto.MemberName ?? ""
            },
            order_meta = new
            {
                return_url = returnUrl,
                notify_url = webhookUrl
            },
            order_splits = orderSplits.Any() ? orderSplits : null
        };

        var splitsJson = JsonSerializer.Serialize(orderSplits);
        Console.WriteLine($"[EventPayment Payment] LinkId={linkId}, OrderId={orderId}, Amount={amount}, Splits={splitsJson}");

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

        // Save Cashfree order details
        await conn.ExecuteAsync(@"
            UPDATE event_payment_members SET CfOrderId=@CfOrderId, PaymentSessionId=@SessionId, PaymentStatus='ACTIVE', OrderSplitsJson=@SplitsJson
            WHERE pk_id=@Id",
            new { CfOrderId = cfOrderId, SessionId = paymentSessionId, Id = memberPaymentId, SplitsJson = splitsJson });

        // Build signed proxy URL (same proxy as MembershipDuesService — shared across all payment flows).
        var proxy = CashfreeGatewayProxy.Build(
            _config,
            orderId: cfOrderId,
            sessionId: paymentSessionId,
            amountText: amount.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture),
            returnUrl: returnUrl,
            customerName: dto.MemberName,
            customerEmail: dto.Email,
            customerPhone: dto.Mobile);

        return new PaymentSessionResponseDto
        {
            PaymentSessionId = paymentSessionId,
            CfOrderId = cfOrderId,
            OrderId = orderId,
            MemberPaymentId = memberPaymentId,
            Environment = cf["Environment"]?.ToLower() == "sandbox" ? "sandbox" : "production",
            GatewayProxyUrl = proxy.IsConfigured ? proxy.ProxyUrl : null
        };
    }

    public async Task<VerifyPaymentResponseDto> VerifyPaymentAsync(int linkId, string orderId, int memberPaymentId)
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
                UPDATE event_payment_members SET IsPaid=1, IsOnline=1, PaymentStatus='PAID', PaidSource='Page', PaymentDate=NOW()
                WHERE pk_id=@Id AND IsPaid=0",
                new { Id = memberPaymentId });

            // Send thank you email
            try { await SendReceiptEmailAsync(memberPaymentId); } catch { /* non-critical */ }

            // Append to Google Sheet (fire-and-forget)
            _ = Task.Run(async () =>
            {
                try { await AppendPaymentToSheetAsync(linkId, memberPaymentId); }
                catch (Exception ex) { _logger.LogError(ex, "Failed to append to Google Sheet for payment {Id}", memberPaymentId); }
            });

            // Auto-refresh settlement (fire-and-forget)
            _ = Task.Run(async () =>
            {
                try { await RefreshEventSettlementsAsync(linkId); } catch { }
            });

            var member = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
                SELECT pm.MemberName, pm.Amount, r.RegistrationName FROM event_payment_members pm
                LEFT JOIN event_payment_registrations r ON pm.fk_registration_id = r.pk_id
                WHERE pm.pk_id=@Id", new { Id = memberPaymentId });

            return new VerifyPaymentResponseDto
            {
                IsSuccess = true,
                OrderStatus = "PAID",
                MemberName = member?.MemberName,
                Amount = member?.Amount,
                RegistrationType = member?.RegistrationName,
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
            if (!data.TryGetProperty("data", out var orderData)) return;
            if (!orderData.TryGetProperty("order", out var order)) return;

            var orderId = order.GetProperty("order_id").GetString();
            var status = order.GetProperty("order_status").GetString();

            if (status == "PAID")
            {
                using var conn = GetConnection();
                await conn.ExecuteAsync(@"
                    UPDATE event_payment_members SET IsPaid=1, IsOnline=1, PaymentStatus='PAID', PaidSource='Webhook', PaymentDate=NOW(),
                    IsWebhookReceived=1, WebhookReceivedDate=NOW()
                    WHERE CfOrderId=@OrderId AND IsPaid=0",
                    new { OrderId = orderId });

                var memberPayment = await conn.QueryFirstOrDefaultAsync<dynamic>(
                    "SELECT pk_id, fk_payment_link_id FROM event_payment_members WHERE CfOrderId=@OrderId", new { OrderId = orderId });
                if (memberPayment != null)
                {
                    int mpId = (int)memberPayment.pk_id;
                    int mpLinkId = (int)memberPayment.fk_payment_link_id;
                    try { await SendReceiptEmailAsync(mpId); } catch { }
                    // Append to Google Sheet (fire-and-forget)
                    _ = Task.Run(async () =>
                    {
                        try { await AppendPaymentToSheetAsync(mpLinkId, mpId); }
                        catch (Exception ex) { _logger.LogError(ex, "Webhook: Failed to append to Google Sheet for payment {Id}", mpId); }
                    });
                    // Auto-refresh settlement (fire-and-forget)
                    _ = Task.Run(async () =>
                    {
                        try { await RefreshEventSettlementsAsync(mpLinkId); } catch { }
                    });
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Webhook processing failed");
        }
    }

    // ── Create Google Sheet for existing link ─────────────────────
    public async Task<string> CreateGoogleSheetForLinkAsync(int linkId)
    {
        using var conn = GetConnection();
        var link = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pk_id, Title, FormType, GoogleSheetId, GoogleSheetEmail,
                   IsTshirtSize, IsFood, IsPartner, IsPartnerName, IsPartnerMobile, IsPartnerEmail, IsPartnerGender,
                   IsRemark1, Remark1Title, IsRemark2, Remark2Title, IsRemark3, Remark3Title,
                   IsDesignation, DesignationLabel,
                   IsPersonal, IsPersonalName, IsPersonalMobile, IsPersonalEmail, IsPersonalDistrict, IsPersonalClub
            FROM event_payment_links WHERE pk_id=@Id AND isdeleted=0", new { Id = linkId });
        if (link == null) throw new KeyNotFoundException("Payment link not found.");

        if (!string.IsNullOrWhiteSpace((string?)link.GoogleSheetId))
            return (string)link.GoogleSheetId;

        var purpose = ((string?)link.Title ?? "Event").Trim();
        var safePurpose = System.Text.RegularExpressions.Regex.Replace(purpose, @"[^a-zA-Z0-9 _-]", "").Replace(" ", "_");
        var sheetTitle = $"Event_{safePurpose}_{DateTime.Now:ddMMyyyyHHmmss}";

        // Build dynamic headers
        var headers = BuildSheetHeaders(link);
        var sheetId = await _googleSheetsService.CreateSpreadsheetAsync(sheetTitle, headers.ToArray());

        var email = (string?)link.GoogleSheetEmail;
        if (!string.IsNullOrWhiteSpace(email))
        {
            try { await _googleSheetsService.ShareWithEmailAsync(sheetId, email); }
            catch (Exception ex) { _logger.LogWarning(ex, "Failed to share sheet with {Email}", email); }
        }

        await conn.ExecuteAsync("UPDATE event_payment_links SET GoogleSheetId=@SheetId WHERE pk_id=@Id",
            new { SheetId = sheetId, Id = linkId });

        // Backfill all existing paid members
        var paidMembers = await conn.QueryAsync<dynamic>(@"
            SELECT pm.pk_id, pm.MemberName, pm.DistrictNumber, pm.ClubName, pm.Mobile, pm.Email,
                   r.RegistrationName, pm.Amount, pm.PaymentDate, pm.PaidSource,
                   pm.PartnerName, pm.PartnerMobile, pm.PartnerEmail, pm.PartnerGender,
                   ts.SizeName AS TshirtSize, fp.FoodType AS FoodPreference,
                   pm.Remark1, pm.Remark2, pm.Remark3, ed.DesignationName
            FROM event_payment_members pm
            LEFT JOIN event_payment_registrations r ON pm.fk_registration_id = r.pk_id
            LEFT JOIN event_tshirt_sizes ts ON pm.fk_tshirt_size_id = ts.pk_id
            LEFT JOIN event_food_preferences fp ON pm.fk_food_preference_id = fp.pk_id
            LEFT JOIN event_payment_designations ed ON pm.fk_designation_id = ed.pk_id
            WHERE pm.fk_payment_link_id = @LinkId AND pm.IsPaid = 1 AND pm.isdeleted = 0
            ORDER BY pm.PaymentDate", new { LinkId = linkId });

        int srNo = 1;
        foreach (var m in paidMembers)
        {
            var values = BuildSheetRow(link, m, srNo++);
            try { await _googleSheetsService.AppendRowAsync(sheetId, values); }
            catch (Exception ex) { _logger.LogWarning(ex, "Failed to append member {Id} to sheet", (int)m.pk_id); }
        }

        _logger.LogInformation("Created Google Sheet {SheetId} for link {LinkId} with {Count} members backfilled", (string)sheetId, (int)linkId, srNo - 1);
        return sheetId;
    }

    // ── Delete Google Sheet ───────────────────────────────────────
    public async Task DeleteGoogleSheetForLinkAsync(int linkId)
    {
        using var conn = GetConnection();
        var sheetId = await conn.ExecuteScalarAsync<string?>(
            "SELECT GoogleSheetId FROM event_payment_links WHERE pk_id=@Id AND isdeleted=0", new { Id = linkId });
        if (string.IsNullOrWhiteSpace(sheetId))
            throw new KeyNotFoundException("No Google Sheet found for this link.");

        await _googleSheetsService.DeleteSpreadsheetAsync(sheetId);
        await conn.ExecuteAsync("UPDATE event_payment_links SET GoogleSheetId=NULL WHERE pk_id=@Id", new { Id = linkId });
        _logger.LogInformation("Deleted Google Sheet {SheetId} for link {LinkId}", sheetId, linkId);
    }

    // ═══════════════════════════════════════════════════════════════
    //  HELPERS
    // ═══════════════════════════════════════════════════════════════

    private async Task AppendPaymentToSheetAsync(int linkId, int memberPaymentId)
    {
        using var conn = GetConnection();
        var link = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT GoogleSheetId, FormType,
                   IsTshirtSize, IsFood, IsPartner, IsPartnerName, IsPartnerMobile, IsPartnerEmail, IsPartnerGender,
                   IsRemark1, Remark1Title, IsRemark2, Remark2Title, IsRemark3, Remark3Title,
                   IsDesignation, DesignationLabel,
                   IsPersonal, IsPersonalName, IsPersonalMobile, IsPersonalEmail, IsPersonalDistrict, IsPersonalClub
            FROM event_payment_links WHERE pk_id=@Id", new { Id = linkId });
        if (link == null || string.IsNullOrWhiteSpace((string?)link.GoogleSheetId)) return;

        var member = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pm.MemberName, pm.DistrictNumber, pm.ClubName, pm.Mobile, pm.Email,
                   r.RegistrationName, pm.Amount, pm.PaymentDate, pm.PaidSource,
                   pm.PartnerName, pm.PartnerMobile, pm.PartnerEmail, pm.PartnerGender,
                   ts.SizeName AS TshirtSize, fp.FoodType AS FoodPreference,
                   pm.Remark1, pm.Remark2, pm.Remark3, ed.DesignationName
            FROM event_payment_members pm
            LEFT JOIN event_payment_registrations r ON pm.fk_registration_id = r.pk_id
            LEFT JOIN event_tshirt_sizes ts ON pm.fk_tshirt_size_id = ts.pk_id
            LEFT JOIN event_food_preferences fp ON pm.fk_food_preference_id = fp.pk_id
            LEFT JOIN event_payment_designations ed ON pm.fk_designation_id = ed.pk_id
            WHERE pm.pk_id=@Id", new { Id = memberPaymentId });
        if (member == null) return;

        var rowCount = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM event_payment_members WHERE fk_payment_link_id=@Id AND IsPaid=1 AND isdeleted=0",
            new { Id = linkId });

        var values = BuildSheetRow(link, member, rowCount);
        await _googleSheetsService.AppendRowAsync((string)link.GoogleSheetId, values);
        _logger.LogInformation("Appended payment {PaymentId} to Google Sheet {SheetId}", memberPaymentId, (string)link.GoogleSheetId);
    }

    private static async Task<string> SaveFileAsync(IFormFile file, int folderId, IWebHostEnvironment env, string folderPrefix = "OlineEvnetPaymentlink")
    {
        var dir = Path.Combine(env.WebRootPath, "Documents", $"{folderPrefix}{folderId}");
        Directory.CreateDirectory(dir);
        var uniqueName = $"{Guid.NewGuid():N}_{DateTime.Now:ddMMyyyyHHmmss}{Path.GetExtension(file.FileName)}";
        var filePath = Path.Combine(dir, uniqueName);
        using var stream = new FileStream(filePath, FileMode.Create);
        await file.CopyToAsync(stream);
        // Store filename only — full URL reconstructed on SELECT via
        // CONCAT('/Documents/OlineEvnetPaymentlink', fk_club_id, '/', <column>)
        return uniqueName;
    }

    private string BuildReceiptBody(dynamic member, string? extraRemark = null)
    {
        var rows = new StringBuilder();
        void AddRow(string label, string? value) { if (!string.IsNullOrWhiteSpace(value)) rows.Append($"<tr><td style='padding:8px;border:1px solid #ddd;font-weight:bold;'>{label}</td><td style='padding:8px;border:1px solid #ddd;'>{value}</td></tr>"); }

        AddRow("District Number", (string?)member.DistrictNumber);
        AddRow("Club Name", (string?)member.ClubName);
        AddRow("Purpose of the payment", (string?)member.LinkTitle);
        AddRow("Amount received", $"₹{member.Amount}/-");
        AddRow("Date and time", ((DateTime?)member.PaymentDate)?.ToString("dd-MM-yyyy HH:mm") ?? DateTime.Now.ToString("dd-MM-yyyy HH:mm"));
        AddRow("Method of payment", Convert.ToBoolean(member.IsOnline) ? "Online" : ((string?)member.OfflineTransactionType ?? "Offline"));
        AddRow("Transaction ID", (string?)member.TransactionId);
        AddRow("Registration Type", (string?)member.RegistrationName);

        // Form field data
        AddRow("T-shirt Size", (string?)member.TshirtSizeName);
        AddRow("Food Preference", (string?)member.FoodPreferenceName);
        AddRow("Partner Name", (string?)member.PartnerName);
        AddRow("Partner Mobile", (string?)member.PartnerMobile);
        AddRow("Partner Email", (string?)member.PartnerEmail);
        AddRow("Partner Gender", (string?)member.PartnerGender);
        AddRow("Remark 1", (string?)member.Remark1);
        AddRow("Remark 2", (string?)member.Remark2);
        AddRow("Remark 3", (string?)member.Remark3);
        AddRow("Designation", (string?)member.DesignationName);

        return $@"{EmailService.EMAIL_HEADER}
            <h2 style='color: #1a365d; margin-top: 0;'>Payment Receipt</h2>
            <p>Dear {member.MemberName},</p>
            <p>Your payment has been received successfully.</p>
            <table style='width:100%;border-collapse:collapse;margin:20px 0;'>
                {rows}
            </table>
            {((string?)member.EmailBody ?? "")}
            {(string.IsNullOrWhiteSpace(extraRemark) ? "" : $"<p style='margin-top:16px;padding:12px;background:#f7fafc;border-left:4px solid #3182ce;'><strong>Remark:</strong> {extraRemark}</p>")}
            <p>Thank you,<br/>ROW</p>
        {EmailService.EMAIL_FOOTER}";
    }

    private string BuildReminderBody(dynamic member, string payUrl, string? extraRemark = null)
    {
        return $@"{EmailService.EMAIL_HEADER}
            <h2 style='color: #1a365d; margin-top: 0;'>Payment Reminder</h2>
            <p>Dear {member.MemberName},</p>
            <table style='width:100%;border-collapse:collapse;margin:20px 0;'>
                <tr><td style='padding:8px;border:1px solid #ddd;font-weight:bold;'>District Number</td><td style='padding:8px;border:1px solid #ddd;'>{(string?)member.DistrictNumber ?? "-"}</td></tr>
                <tr><td style='padding:8px;border:1px solid #ddd;font-weight:bold;'>Club Name</td><td style='padding:8px;border:1px solid #ddd;'>{(string?)member.ClubName ?? "-"}</td></tr>
                <tr><td style='padding:8px;border:1px solid #ddd;font-weight:bold;'>Purpose of the payment</td><td style='padding:8px;border:1px solid #ddd;'>{member.LinkTitle}</td></tr>
                <tr><td style='padding:8px;border:1px solid #ddd;font-weight:bold;'>Outstanding amount</td><td style='padding:8px;border:1px solid #ddd;'>₹{member.RegAmount}/-</td></tr>
                <tr><td style='padding:8px;border:1px solid #ddd;font-weight:bold;'>Status</td><td style='padding:8px;border:1px solid #ddd;'>Unpaid</td></tr>
                <tr><td style='padding:8px;border:1px solid #ddd;font-weight:bold;'>Click on the link</td><td style='padding:8px;border:1px solid #ddd;'><a href='{payUrl}' style='color:#3182ce;'>{payUrl}</a></td></tr>
            </table>
            {((string?)member.EmailReminderBody ?? "")}
            {(extraRemark ?? "")}
            <p>Thank you,<br/>ROW</p>
        {EmailService.EMAIL_FOOTER}";
    }

    // ═══════════════════════════════════════════════════════════════
    //  PUBLIC REPORT
    // ═══════════════════════════════════════════════════════════════

    public async Task<PublicReportDto?> GetPublicReportAsync(int linkId)
    {
        using var conn = GetConnection();

        var linkDetails = await conn.QueryFirstOrDefaultAsync<PublicReportLinkDetailsDto>(@"
            SELECT l.Title, l.Description, l.FormType,
                   d.DistrictNumber, c.ClubName
            FROM event_payment_links l
            LEFT JOIN district_master d ON l.fk_district_master_id = d.pk_district_id
            LEFT JOIN club_master c ON l.fk_club_id = c.pk_club_id
            WHERE l.pk_id = @Id AND l.isdeleted = 0", new { Id = linkId });

        if (linkDetails == null) return null;

        var members = (await conn.QueryAsync<PublicReportMemberDto>(@"
            SELECT pm.MemberName, pm.DistrictNumber, pm.ClubName,
                   pm.Mobile, pm.Email,
                   r.RegistrationName, pm.Amount, pm.PaymentDate, pm.PaidSource,
                   pm.PartnerName,
                   ts.SizeName AS TshirtSize,
                   fp.FoodType AS FoodPreference,
                   pm.Remark1, pm.Remark2, pm.Remark3,
                   ed.DesignationName
            FROM event_payment_members pm
            LEFT JOIN event_payment_registrations r ON pm.fk_registration_id = r.pk_id
            LEFT JOIN event_tshirt_sizes ts ON pm.fk_tshirt_size_id = ts.pk_id
            LEFT JOIN event_food_preferences fp ON pm.fk_food_preference_id = fp.pk_id
            LEFT JOIN event_payment_designations ed ON pm.fk_designation_id = ed.pk_id
            WHERE pm.fk_payment_link_id = @LinkId AND pm.IsPaid = 1 AND pm.isdeleted = 0
            ORDER BY pm.PaymentDate DESC", new { LinkId = linkId })).ToList();

        // Assign serial numbers
        for (int i = 0; i < members.Count; i++)
            members[i].SrNo = i + 1;

        return new PublicReportDto
        {
            LinkDetails = linkDetails,
            Members = members
        };
    }

    // ── Google Sheet dynamic headers/rows based on link config ───
    private static bool IsOn(dynamic val) => val != null && (val is bool b ? b : Convert.ToBoolean(val));

    private static List<string> BuildSheetHeaders(dynamic link)
    {
        var headers = new List<string> { "Sr.No" };
        int formType = (int)(link.FormType ?? 1);
        bool isStandard = formType == 1;

        // Standard form: always show member basics
        if (isStandard)
        {
            headers.AddRange(new[] { "Member Name", "District", "Club", "Mobile", "Email" });
        }
        else
        {
            // Dynamic form: show only enabled personal fields
            if (IsOn(link.IsPersonalName)) headers.Add("Member Name");
            if (IsOn(link.IsPersonalMobile)) headers.Add("Mobile");
            if (IsOn(link.IsPersonalEmail)) headers.Add("Email");
            if (IsOn(link.IsPersonalDistrict)) headers.Add("District");
            if (IsOn(link.IsPersonalClub)) headers.Add("Club");
        }

        headers.AddRange(new[] { "Registration Type", "Amount", "Payment Date", "Paid Source" });

        // Optional fields based on config
        if (IsOn(link.IsTshirtSize)) headers.Add("T-Shirt Size");
        if (IsOn(link.IsFood)) headers.Add("Food Preference");

        if (IsOn(link.IsPartner))
        {
            if (IsOn(link.IsPartnerName)) headers.Add("Partner Name");
            if (IsOn(link.IsPartnerMobile)) headers.Add("Partner Mobile");
            if (IsOn(link.IsPartnerEmail)) headers.Add("Partner Email");
            if (IsOn(link.IsPartnerGender)) headers.Add("Partner Gender");
        }

        if (IsOn(link.IsRemark1)) headers.Add((string?)link.Remark1Title ?? "Remark 1");
        if (IsOn(link.IsRemark2)) headers.Add((string?)link.Remark2Title ?? "Remark 2");
        if (IsOn(link.IsRemark3)) headers.Add((string?)link.Remark3Title ?? "Remark 3");
        if (IsOn(link.IsDesignation)) headers.Add((string?)link.DesignationLabel ?? "Designation");

        return headers;
    }

    private static List<object> BuildSheetRow(dynamic link, dynamic m, int srNo)
    {
        var row = new List<object> { srNo };
        int formType = (int)(link.FormType ?? 1);
        bool isStandard = formType == 1;

        if (isStandard)
        {
            row.Add((string?)m.MemberName ?? "");
            row.Add((string?)m.DistrictNumber ?? "");
            row.Add((string?)m.ClubName ?? "");
            row.Add((string?)m.Mobile ?? "");
            row.Add((string?)m.Email ?? "");
        }
        else
        {
            if (IsOn(link.IsPersonalName)) row.Add((string?)m.MemberName ?? "");
            if (IsOn(link.IsPersonalMobile)) row.Add((string?)m.Mobile ?? "");
            if (IsOn(link.IsPersonalEmail)) row.Add((string?)m.Email ?? "");
            if (IsOn(link.IsPersonalDistrict)) row.Add((string?)m.DistrictNumber ?? "");
            if (IsOn(link.IsPersonalClub)) row.Add((string?)m.ClubName ?? "");
        }

        row.Add((string?)m.RegistrationName ?? "");
        row.Add(m.Amount?.ToString() ?? "0");
        row.Add(((DateTime?)m.PaymentDate)?.ToString("dd-MM-yyyy HH:mm") ?? "");
        row.Add((string?)m.PaidSource ?? "");

        if (IsOn(link.IsTshirtSize)) row.Add((string?)m.TshirtSize ?? "");
        if (IsOn(link.IsFood)) row.Add((string?)m.FoodPreference ?? "");

        if (IsOn(link.IsPartner))
        {
            if (IsOn(link.IsPartnerName)) row.Add((string?)m.PartnerName ?? "");
            if (IsOn(link.IsPartnerMobile)) row.Add((string?)m.PartnerMobile ?? "");
            if (IsOn(link.IsPartnerEmail)) row.Add((string?)m.PartnerEmail ?? "");
            if (IsOn(link.IsPartnerGender)) row.Add((string?)m.PartnerGender ?? "");
        }

        if (IsOn(link.IsRemark1)) row.Add((string?)m.Remark1 ?? "");
        if (IsOn(link.IsRemark2)) row.Add((string?)m.Remark2 ?? "");
        if (IsOn(link.IsRemark3)) row.Add((string?)m.Remark3 ?? "");
        if (IsOn(link.IsDesignation)) row.Add((string?)m.DesignationName ?? "");

        return row;
    }

    // ── Settlement Refresh ──────────────────────────────────────────
    public async Task RefreshEventSettlementsAsync(int linkId)
    {
        using var conn = GetConnection();
        var paidPayments = await conn.QueryAsync<dynamic>(@"
            SELECT pk_id, CfOrderId FROM event_payment_members
            WHERE fk_payment_link_id=@LinkId AND IsPaid=1 AND IsOnline=1 AND CfOrderId IS NOT NULL AND CfOrderId != '' AND isdeleted=0",
            new { LinkId = linkId });

        var cf = _config.GetSection("CashfreePayment");
        foreach (var p in paidPayments)
        {
            try
            {
                var cfOrderId = (string)p.CfOrderId;
                var request = new HttpRequestMessage(HttpMethod.Get, $"{cf["BaseUrl"]}orders/{cfOrderId}/settlements");
                request.Headers.Add("x-client-id", cf["ClientId"]);
                request.Headers.Add("x-client-secret", cf["ClientSecret"]);
                request.Headers.Add("x-api-version", cf["ApiVersion"]);

                var response = await _httpClient.SendAsync(request);
                var body = await response.Content.ReadAsStringAsync();
                if (!response.IsSuccessStatusCode) continue;

                var settlements = JsonSerializer.Deserialize<JsonElement>(body);
                if (!settlements.TryGetProperty("data", out var dataArr) || dataArr.ValueKind != JsonValueKind.Array) continue;

                foreach (var s in dataArr.EnumerateArray())
                {
                    var vendorId = s.TryGetProperty("merchant_vendor_id", out var vid) ? vid.GetString() : null;
                    var amt = s.TryGetProperty("amount", out var a) ? a.GetDouble() : 0;
                    var sStatus = s.TryGetProperty("settled", out var ss) ? ss.GetString() : "PENDING";
                    var sId = s.TryGetProperty("merchant_settlement_id", out var si) ? si.GetString() : null;
                    var sUtr = s.TryGetProperty("merchant_settlement_utr", out var su) ? su.GetString() : null;
                    var sTime = s.TryGetProperty("settlement_time", out var st) ? st.GetString() : null;
                    var sCharge = s.TryGetProperty("pg_service_charge", out var sc) ? double.TryParse(sc.GetString(), out var scv) ? scv : 0 : 0;
                    var sTax = s.TryGetProperty("pg_service_tax", out var stx) ? double.TryParse(stx.GetString(), out var stxv) ? stxv : 0 : 0;

                    var existing = await conn.ExecuteScalarAsync<int>(
                        "SELECT COUNT(*) FROM event_payment_settlements WHERE fk_member_payment_id=@PId AND VendorId=@VId",
                        new { PId = (int)p.pk_id, VId = vendorId ?? "" });

                    if (existing > 0)
                    {
                        await conn.ExecuteAsync(@"
                            UPDATE event_payment_settlements SET SettlementStatus=@Status, SettlementId=@SId, SettlementUtr=@SUtr,
                            SettlementTime=@STime, ServiceCharge=@SCharge, ServiceTax=@STax, modified_date=NOW()
                            WHERE fk_member_payment_id=@PId AND VendorId=@VId",
                            new { Status = sStatus, SId = sId, SUtr = sUtr, STime = sTime != null ? DateTime.TryParse(sTime, out var dt) ? (DateTime?)dt : null : null, SCharge = sCharge, STax = sTax, PId = (int)p.pk_id, VId = vendorId ?? "" });
                    }
                    else
                    {
                        await conn.ExecuteAsync(@"
                            INSERT INTO event_payment_settlements (fk_payment_link_id, fk_member_payment_id, CfOrderId, VendorId, Amount, SettlementStatus, SettlementId, SettlementUtr, SettlementTime, ServiceCharge, ServiceTax)
                            VALUES (@LinkId, @PId, @CfOrderId, @VId, @Amt, @Status, @SId, @SUtr, @STime, @SCharge, @STax)",
                            new { LinkId = linkId, PId = (int)p.pk_id, CfOrderId = cfOrderId, VId = vendorId ?? "", Amt = amt, Status = sStatus, SId = sId, SUtr = sUtr, STime = sTime != null ? DateTime.TryParse(sTime, out var dt2) ? (DateTime?)dt2 : null : null, SCharge = sCharge, STax = sTax });
                    }
                }
            }
            catch (Exception ex) { _logger.LogError(ex, "Failed to refresh settlement for order {CfOrderId}", (string)p.CfOrderId); }
        }
    }

    public async Task<object> GetEventSettlementReportAsync(int linkId)
    {
        using var conn = GetConnection();
        var settlements = await conn.QueryAsync<dynamic>(@"
            SELECT s.CfOrderId AS OrderId, s.VendorId, s.Amount, s.SettlementStatus AS Status,
                   s.SettlementUtr AS Utr, s.SettlementTime, s.ServiceCharge, s.ServiceTax,
                   p.MemberName, p.Amount AS PaymentAmount, p.PaidSource, p.IsWebhookReceived, p.WebhookReceivedDate,
                   p.OrderSplitsJson, p.PaymentDate,
                   k.name AS VendorName
            FROM event_payment_settlements s
            JOIN event_payment_members p ON s.fk_member_payment_id = p.pk_id
            LEFT JOIN cashfree_kyc k ON k.vendor_id = s.VendorId
            WHERE s.fk_payment_link_id = @LinkId
            ORDER BY s.created_date DESC",
            new { LinkId = linkId });
        return new { Settlements = settlements };
    }
}
