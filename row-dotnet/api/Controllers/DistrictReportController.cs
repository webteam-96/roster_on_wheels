using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/districts/{districtId}/district-report")]
[Authorize]
public class DistrictReportController : ControllerBase
{
    private readonly string _connectionString;
    private readonly IYearTableResolver _yearTables;
    private readonly string _frontendUrl;
    private readonly ILogger<DistrictReportController> _logger;
    private readonly RotaryApi.Services.RotaryOrg.IRotaryOrgApiClient _rotaryOrg;
    private readonly RotaryApi.Services.ICurrencyRateService _fx;

    public DistrictReportController(IConfiguration config, IYearTableResolver yearTables, ILogger<DistrictReportController> logger, RotaryApi.Services.RotaryOrg.IRotaryOrgApiClient rotaryOrg, RotaryApi.Services.ICurrencyRateService fx)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        _yearTables = yearTables;
        _frontendUrl = (config["FrontendUrl"] ?? RotaryApi.Services.Brand.PortalOrigin).TrimEnd('/');
        _logger = logger;
        _rotaryOrg = rotaryOrg;
        _fx = fx;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    // user 2026-10-08: Rotaract clubs (ClubType = 'Rotaract Club') appear in these district reports
    // only for SuperAdmin. Every report narrows to clubIds first, so filtering there covers it all.
    private string NotRotaractUnlessSa(string alias = "c") =>
        !ClubScopeSql.HideRotaract(UserPermissionHelper.IsSuperAdmin(User)) ? "" : " AND " + ClubScopeSql.NotRotaract(alias);

    // The currency a district's project-cost totals are expressed in (its DefaultCurrency, or a
    // country-based guess). Per-project rows keep their own currency; totals convert into this.
    private static async Task<string> ResolveDistrictCurrencyAsync(MySqlConnection conn, int districtId)
    {
        var row = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT DefaultCurrency, Country FROM district_master WHERE pk_district_id = @D LIMIT 1",
            new { D = districtId });
        return RotaryApi.Services.CurrencyHelper.ResolveDefaultCurrency(row?.DefaultCurrency as string, row?.Country as string);
    }

    // Clubs an AG is assigned to in this district for this year. Returns null when
    // agMemberId isn't supplied — callers treat null as "no AG scoping", which is what
    // keeps the District Admin and Club Admin reports byte-for-byte unchanged.
    // Empty list = the AG holds no clubs here → report should come back empty, NOT
    // district-wide, so the distinction between null and empty matters.
    private static async Task<List<int>?> ResolveAgScopeClubIdsAsync(
        MySqlConnection conn, int districtId, int yearId, int? agMemberId)
    {
        if (!agMemberId.HasValue || agMemberId.Value <= 0) return null;
        var ids = (await conn.QueryAsync<int>(@"
            SELECT DISTINCT a.fk_club_id
            FROM district_ag a
            JOIN club_master c ON c.pk_club_id = a.fk_club_id AND c.isdeleted = 0
            WHERE a.fk_member_id = @Ag AND a.fk_year_id = @YearId
              AND a.isdeleted = 0 AND a.is_active = 1
              AND c.fk_district_id = @D",
            new { Ag = agMemberId.Value, YearId = yearId, D = districtId })).ToList();
        return ids;
    }

    // agMemberId (optional): scopes the whole report to that AG's clubs. Omitted by the
    // District Admin report, so its behaviour is unchanged.
    [HttpGet]
    public async Task<ActionResult> GetReport(int districtId, [FromQuery] int yearId, [FromQuery] int? agMemberId = null)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        if (yearId <= 0) return BadRequest(new { message = "yearId is required." });

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var district = await conn.QueryFirstOrDefaultAsync<dynamic>(
            @"SELECT d.pk_district_id AS districtId, d.DistrictNumber AS districtNumber,
                     z.ZoneName AS zoneName
              FROM district_master d
              LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
              WHERE d.pk_district_id = @Id AND d.isdeleted = 0",
            new { Id = districtId });
        if (district == null) return NotFound(new { message = "District not found." });

        var year = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT pk_year_id AS id, YearLabel AS yearLabel, StartDate AS startDate, EndDate AS endDate FROM rotary_year_master WHERE pk_year_id = @Id",
            new { Id = yearId });
        DateTime? yrStart = year?.startDate, yrEnd = year?.endDate;

        var clubIds = (await conn.QueryAsync<int>(
            $"SELECT pk_club_id FROM club_master WHERE fk_district_id = @D AND isdeleted = 0{NotRotaractUnlessSa("")}",
            new { D = districtId })).ToList();

        // AG scope: narrow the district's clubs to this AG's clubs. Everything downstream
        // filters on clubIds / clubIdCsv, so constraining the list here scopes the entire
        // payload in one place rather than editing 40+ queries.
        var agClubIds = await ResolveAgScopeClubIdsAsync(conn, districtId, yearId, agMemberId);
        if (agClubIds != null) clubIds = clubIds.Where(id => agClubIds.Contains(id)).ToList();

        var totalClubs = clubIds.Count;
        // "0" keeps `IN (...)` syntactically valid and matching nothing — correct for an AG
        // with no clubs here (empty report), and unchanged for a district with no clubs.
        var clubIdCsv = clubIds.Count > 0 ? string.Join(",", clubIds) : "0";

        var p = new { D = districtId, YearId = yearId };

        // Projects aggregated — year-wise: resolve the single year's table.
        var pInfo = await _yearTables.ResolveByYearIdAsync(conn, yearId);
        var projects = new List<dynamic>();
        if (pInfo != null)
        {
            projects = (await conn.QueryAsync<dynamic>($@"
                SELECT p.pk_project_id AS id, p.fk_club_id AS clubId, p.title, p.description, p.project_date AS projectDate,
                       p.project_cost AS projectCost, p.project_cost AS amountSpent,
                       COALESCE(p.Currency, '{RotaryApi.Services.Brand.SqlCurrency}') AS currency,
                       p.direct_beneficiaries AS directBeneficiaries,
                       p.man_hours AS manHours, p.rotarians_involved AS rotariansInvolved,
                       p.rotaractors_involved AS rotaractorsInvolved,
                       COALESCE(p.rcc_involved,0) AS rccInvolved,
                       p.location, af.name AS areaOfFocus, cat.name AS category, sc.name AS subCategory,
                       f.name AS funding, mm.ModuleName AS moduleName, mm.ModuleKey AS moduleKey,
                       mm.ModuleName AS typeOfProject,
                       p.club_role AS clubRole, p.co_host_name AS coHostName,
                       p.global_grant_number AS globalGrantNumber, p.csr_company_name AS csrCompanyName,
                       p.amount_sanctioned AS amountSanctioned, p.amount_received AS amountReceived,
                       p.host_clubs_districts AS hostClubsDistricts,
                       p.global_partner_clubs_districts AS globalPartners,
                       CASE WHEN p.project_type = 'one_time' THEN 'One-time' ELSE 'Ongoing' END AS oneTimeOngoing,
                       CASE WHEN p.parent_project_id IS NULL OR p.parent_project_id = 0 THEN 'New' ELSE 'Existing' END AS newExisting,
                       p.approval_status AS approvalStatus,
                       COALESCE(c.ClubName, 'District Level') AS clubName,
                       /* Shareable public photo page — used as Excel HYPERLINK
                          target in the Photos/Image column of each service-module table. */
                       CONCAT('{_frontendUrl}/public/project/', p.pk_project_id, '?year={yearId}') AS publicPhotoUrl
                FROM `{pInfo.ProjectsTable}` p
                LEFT JOIN area_of_focus_master af ON af.pk_area_of_focus_id = p.fk_area_of_focus_id
                LEFT JOIN category_master cat ON cat.pk_category_id = p.fk_category_id
                LEFT JOIN sub_category_master sc ON sc.pk_sub_category_id = p.fk_sub_category_id
                LEFT JOIN funding_master f ON f.pk_funding_id = p.fk_funding_id
                LEFT JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
                LEFT JOIN club_master c ON c.pk_club_id = p.fk_club_id
                WHERE p.isdeleted = 0
                  AND (p.fk_district_id = @D OR p.fk_club_id IN ({clubIdCsv}))
                ORDER BY p.project_date DESC", p)).ToList();
        }

        var projectsByModule = projects.GroupBy(x => (string?)x.moduleKey ?? "other")
            .ToDictionary(g => g.Key, g => g.ToList());

        // Club Monthly Report (Project Details) — per club, per month aggregate.
        // Mirrors the single-club club-report "Club Monthly Report" section
        // (Meeting / TRF / Projects / Cost / Beneficiaries / Man Hours / Rotarians /
        // Rotaractors), but for EVERY club in the district. The frontend filters
        // to All Clubs or one club and appends a totals row.
        int yrStartYear = yrStart?.Year ?? DateTime.Today.Year;
        int yrEndYear = yrEnd?.Year ?? (yrStartYear + 1);
        var clubMonthlyProjectDetails = (await conn.QueryAsync<dynamic>($@"
            SELECT r.fk_club_id AS clubId, c.ClubName AS clubName,
                   r.ReportMonth AS monthNum,
                   DATE_FORMAT(
                     STR_TO_DATE(CONCAT(CASE WHEN r.ReportMonth >= 7 THEN @YrStartYear ELSE @YrEndYear END,
                                        '-', r.ReportMonth, '-01'), '%Y-%c-%d'),
                     '%M %Y') AS month,
                   (SELECT COUNT(*) FROM club_attendance a
                     WHERE a.fk_club_id = r.fk_club_id AND a.fk_year_id = r.fk_year_id
                       AND a.isdeleted = 0 AND MONTH(a.EventDateTime) = r.ReportMonth) AS meeting,
                   COALESCE((SELECT SUM(t.AmountUSD) FROM trf_contributions t
                              WHERE t.fk_club_id = r.fk_club_id AND t.fk_year_id = r.fk_year_id
                                AND t.isdeleted = 0 AND MONTH(t.TrfDate) = r.ReportMonth), 0) AS trf,
                   0 AS clubService,
                   0 AS projects, 0 AS cost, 0 AS beneficiaries, 0 AS manHours,
                   0 AS rotariansInvolved, 0 AS rotaractors, 0 AS rcc
            FROM club_monthly_reports r
            JOIN club_master c ON c.pk_club_id = r.fk_club_id
            WHERE r.fk_year_id = @YearId AND r.isdeleted = 0 AND r.fk_club_id IN ({clubIdCsv})
            ORDER BY c.ClubName,
                     CASE WHEN r.ReportMonth >= 7 THEN r.ReportMonth - 7 ELSE r.ReportMonth + 5 END",
            new { YearId = yearId, YrStartYear = yrStartYear, YrEndYear = yrEndYear })).ToList();

        // Backfill the project aggregates per (club, month) from the already-loaded
        // year-wise project list — same approach as the single-club club report.
        // Costs convert into the district default currency; rows keep their own currency.
        var reportCurrency = await ResolveDistrictCurrencyAsync(conn, districtId);
        var fxRates = await _fx.GetInrRatesAsync();
        foreach (var m in clubMonthlyProjectDetails)
        {
            int mm = Convert.ToInt32(m.monthNum);
            long cid = Convert.ToInt64(m.clubId);
            var mAll = projects.Where(p =>
                p.clubId != null && Convert.ToInt64(p.clubId) == cid &&
                ((DateTime?)p.projectDate)?.Month == mm).ToList();
            // Club Service entries get their own column; Projects and its totals cover the other avenues
            // only, so nothing is counted twice. "meeting" (attendance count) is left in the payload as is.
            m.clubService       = mAll.Count(p => (string?)p.moduleKey == "club_service");
            var mp              = mAll.Where(p => (string?)p.moduleKey != "club_service").ToList();
            m.projects          = mp.Count;
            m.cost              = mp.Sum(p => RotaryApi.Services.CurrencyHelper.Convert((decimal?)p.projectCost ?? 0, p.currency as string, reportCurrency, fxRates));
            m.beneficiaries     = mp.Sum(p => (int?)p.directBeneficiaries ?? 0);
            m.manHours          = mp.Sum(p => (int?)p.manHours ?? 0);
            m.rotariansInvolved = mp.Sum(p => (int?)p.rotariansInvolved ?? 0);
            m.rotaractors       = mp.Sum(p => (int?)p.rotaractorsInvolved ?? 0);
            m.rcc               = mp.Sum(p => (int?)p.rccInvolved ?? 0);
        }

        // Announcements (district + club)
        var announcements = (await conn.QueryAsync<dynamic>($@"
            SELECT a.fk_club_id AS clubId, a.Title AS title, a.Description AS description, a.PublishDateTime AS publishDate,
                   a.ExpiryDateTime AS expiryDate, a.IsSendWhatsapp AS isSendWhatsapp,
                   CASE
                       WHEN a.ImagePath IS NULL OR a.ImagePath = '' THEN NULL
                       WHEN a.ImagePath LIKE '/%' THEN a.ImagePath
                       WHEN a.Scope = 'ri' THEN CONCAT('/Documents/announcement/ri/', a.ImagePath)
                       WHEN a.fk_district_id IS NOT NULL THEN CONCAT('/Documents/announcement/Group', a.fk_district_id, '/', a.ImagePath)
                       ELSE CONCAT('/Documents/announcement/Group', a.fk_club_id, '/', a.ImagePath)
                   END AS imagePath,
                   COALESCE(c.ClubName, 'District Level') AS clubName,
                   CASE WHEN NOW() < a.PublishDateTime THEN 'Unpublished'
                        WHEN NOW() > a.ExpiryDateTime THEN 'Expired' ELSE 'Published' END AS status
            FROM announcements a
            LEFT JOIN club_master c ON c.pk_club_id = a.fk_club_id
            JOIN rotary_year_master y ON y.pk_year_id = @YearId
            WHERE a.isdeleted = 0
              AND a.PublishDateTime >= y.StartDate
              AND a.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
              AND (a.fk_district_id = @D OR a.fk_club_id IN ({clubIdCsv}))
            ORDER BY a.PublishDateTime DESC", p)).ToList();

        var events = (await conn.QueryAsync<dynamic>($@"
            SELECT e.fk_club_id AS clubId, e.Title AS title, e.Description AS description, e.EventDate AS eventDate,
                   e.EventVenue AS eventVenue, e.PublishDate AS publishDate, e.ExpiryDate AS expiryDate,
                   e.RegistrationLink AS registrationLink,
                   CASE
                       WHEN e.ImagePath IS NULL OR e.ImagePath = '' THEN NULL
                       WHEN e.ImagePath LIKE '/%' THEN e.ImagePath
                       WHEN e.fk_district_id IS NOT NULL THEN CONCAT('/Documents/Event/Group', e.fk_district_id, '/', e.ImagePath)
                       ELSE CONCAT('/Documents/Event/Group', e.fk_club_id, '/', e.ImagePath)
                   END AS imagePath,
                   COALESCE(c.ClubName, 'District Level') AS clubName,
                   CASE WHEN NOW() < e.PublishDate THEN 'Unpublished'
                        WHEN NOW() > e.ExpiryDate THEN 'Expired' ELSE 'Published' END AS status
            FROM upcoming_events e
            LEFT JOIN club_master c ON c.pk_club_id = e.fk_club_id
            JOIN rotary_year_master y ON y.pk_year_id = @YearId
            WHERE e.isdeleted = 0
              AND e.PublishDate >= y.StartDate
              AND e.PublishDate < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
              AND (e.fk_district_id = @D OR e.fk_club_id IN ({clubIdCsv}))
            ORDER BY e.EventDate DESC", p)).ToList();

        var newsletters = (await conn.QueryAsync<dynamic>($@"
            SELECT n.fk_club_id AS clubId, n.Title AS title, n.PublishDateTime AS publishDate, n.ExpiryDateTime AS expiryDate,
                   n.AttachmentType AS attachmentType, n.LinkUrl AS linkUrl,
                   CASE
                       WHEN n.FilePath IS NULL OR n.FilePath = '' THEN NULL
                       WHEN n.FilePath LIKE '/%' THEN n.FilePath
                       WHEN n.Scope = 'ri' THEN CONCAT('/Documents/ebulletin/ri/', n.FilePath)
                       WHEN n.fk_district_id IS NOT NULL AND n.fk_district_id > 0 THEN CONCAT('/Documents/ebulletin/Group', n.fk_district_id, '/', n.FilePath)
                       WHEN n.fk_club_id IS NOT NULL AND n.fk_club_id > 0 THEN CONCAT('/Documents/ebulletin/Group', n.fk_club_id, '/', n.FilePath)
                       ELSE NULL
                   END AS filePath,
                   COALESCE(c.ClubName, 'District Level') AS clubName,
                   CASE WHEN NOW() < n.PublishDateTime THEN 'Unpublished'
                        WHEN NOW() > n.ExpiryDateTime THEN 'Expired' ELSE 'Published' END AS status
            FROM newsletters n
            LEFT JOIN club_master c ON c.pk_club_id = n.fk_club_id
            JOIN rotary_year_master y ON y.pk_year_id = @YearId
            WHERE n.isdeleted = 0
              AND n.PublishDateTime >= y.StartDate
              AND n.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
              AND (n.fk_district_id = @D OR n.fk_club_id IN ({clubIdCsv}))
            ORDER BY n.PublishDateTime DESC", p)).ToList();

        var documents = (await conn.QueryAsync<dynamic>($@"
            SELECT d.fk_club_id AS clubId, d.Title AS title, d.AccessType AS accessType,
                   CASE
                       WHEN d.FilePath IS NULL OR d.FilePath = '' THEN NULL
                       WHEN d.FilePath LIKE '/%' THEN d.FilePath
                       WHEN d.Scope = 'ri' THEN CONCAT('/Documents/documentsafe/ri/', d.FilePath)
                       WHEN d.fk_district_id IS NOT NULL THEN CONCAT('/Documents/documentsafe/Group', d.fk_district_id, '/', d.FilePath)
                       ELSE CONCAT('/Documents/documentsafe/Group', d.fk_club_id, '/', d.FilePath)
                   END AS filePath,
                   d.PublishDateTime AS publishDate, d.ExpiryDateTime AS expiryDate,
                   COALESCE(c.ClubName, 'District Level') AS clubName
            FROM club_documents d
            JOIN rotary_year_master y ON y.pk_year_id = @YearId
            LEFT JOIN club_master c ON c.pk_club_id = d.fk_club_id
            WHERE d.isdeleted = 0
              AND d.PublishDateTime >= y.StartDate
              AND d.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
              AND (d.fk_district_id = @D OR d.fk_club_id IN ({clubIdCsv}))
            ORDER BY d.PublishDateTime DESC", p)).ToList();

        // Attendance (all district clubs)
        var attendance = (await conn.QueryAsync<dynamic>($@"
            SELECT c.pk_club_id AS clubId, c.ClubName AS clubName,
                   a.EventName AS eventName, a.Description AS description, a.EventDateTime AS eventDateTime,
                   (SELECT COUNT(*) FROM club_attendance_members   m WHERE m.fk_attendance_id = a.pk_attendance_id) AS membersCount,
                   (SELECT COUNT(*) FROM club_attendance_anns       x WHERE x.fk_attendance_id = a.pk_attendance_id) AS annsCount,
                   (SELECT COUNT(*) FROM club_attendance_annets     x WHERE x.fk_attendance_id = a.pk_attendance_id) AS annetsCount,
                   (SELECT COUNT(*) FROM club_attendance_visitors   x WHERE x.fk_attendance_id = a.pk_attendance_id) AS visitorsCount,
                   (SELECT COUNT(*) FROM club_attendance_rotarians  x WHERE x.fk_attendance_id = a.pk_attendance_id) AS rotariansOtherClubsCount,
                   (SELECT COUNT(*) FROM club_attendance_delegates  x WHERE x.fk_attendance_id = a.pk_attendance_id) AS districtDelegatesCount
            FROM club_attendance a
            JOIN club_master c ON c.pk_club_id = a.fk_club_id
            WHERE a.fk_year_id = @YearId AND a.isdeleted = 0 AND a.fk_club_id IN ({clubIdCsv})
            ORDER BY c.ClubName, a.EventDateTime DESC", p)).ToList();

        // BOD across all district clubs
        var bod = (await conn.QueryAsync<dynamic>($@"
            SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, m.MemberName AS memberName, m.PrimaryMobileNumber AS mobile,
                   m.EmailId AS email, dm.designation_name AS designation, dm.sort_order AS sortOrder,
                   COALESCE(b.SyncSource, 'Manual') AS autoManual
            FROM board_of_directors b
            JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id
            JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id
            JOIN club_master c ON c.pk_club_id = b.fk_club_id
            WHERE b.fk_year_id = @YearId AND b.isdeleted = 0 AND b.fk_club_id IN ({clubIdCsv})
            ORDER BY c.ClubName, dm.sort_order", p)).ToList();

        // Active members across all district clubs — full column set (mirrors the club report).
        // Classification/Designation live on club_members; RI Admission Date = club_members.JoinedDate;
        // Address/Country from the latest Residence row; Downloaded inferred from LastDeviceName.
        var members = (await conn.QueryAsync<dynamic>($@"
            SELECT c.pk_club_id AS clubId,
                   c.ClubName AS clubName,
                   m.MemberName AS memberName,
                   CASE
                       WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                       WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                       ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                   END AS profilePhoto,
                   cm.ClassificationProfession AS classification,
                   cm.Designation              AS clubDesignation,
                   (SELECT cy.CountryName
                      FROM member_address_details ad
                      LEFT JOIN country_master cy ON cy.pk_country_id = ad.fk_country_id
                     WHERE ad.fk_member_master_profile_id = m.pk_member_master_profile_id
                       AND ad.AddressType = 'Residence' AND COALESCE(ad.isdeleted, 0) = 0
                     ORDER BY ad.pk_member_address_details_id DESC LIMIT 1) AS country,
                   m.PrimaryMobileNumber AS mobile,
                   m.EmailId AS email,
                   m.Gender AS gender,
                   m.PrimaryLanguage AS primaryLanguage,
                   CASE WHEN m.IsYouth = 1 THEN 'Yes' ELSE 'No' END AS youthFlag,
                   m.BirthDate AS dob,
                   m.AnniversaryDate AS doa,
                   m.BloodGroup AS bloodGroup,
                   m.LastDeviceName AS deviceName,
                   CASE WHEN m.LastDeviceName IS NULL OR m.LastDeviceName = '' THEN 'No' ELSE 'Yes' END AS downloaded,
                   (SELECT CONCAT_WS(', ',
                              NULLIF(ad.Address,''), NULLIF(ad.City,''),
                              NULLIF(ad.State,''),   NULLIF(cy2.CountryName,''),
                              NULLIF(ad.PinCode,''))
                      FROM member_address_details ad
                      LEFT JOIN country_master cy2 ON cy2.pk_country_id = ad.fk_country_id
                     WHERE ad.fk_member_master_profile_id = m.pk_member_master_profile_id
                       AND ad.AddressType = 'Residence' AND COALESCE(ad.isdeleted, 0) = 0
                     ORDER BY ad.pk_member_address_details_id DESC LIMIT 1) AS address,
                   m.RotaryId AS rotaryId,
                   {CogDesignationHelper.JoinedDateExpr("cm")} AS riAdmissionDate,
                   {CogDesignationHelper.SelectColumns("cm")}
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id
            WHERE cm.IsActive = 1 AND cm.isdeleted = 0 AND cm.fk_club_id IN ({clubIdCsv})
            ORDER BY c.ClubName, m.MemberName", p)).ToList();

        // Blood Group report (all district clubs) — emergency call-list of EVERY person
        // (the member AND each family member) with their own blood group + a contact number.
        // UNION ALL so members with no family still appear; member row first then their
        // family, grouped by club → member. Flat + sortable so you filter by Blood Group
        // in Excel and phone whoever matches. District report keeps Club Name.
        var bloodGroups = (await conn.QueryAsync<dynamic>($@"
            SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, d.DistrictNumber AS districtNumber,
                   m.MemberName AS ownerName, 'Member' AS relation,
                   m.MemberName AS personName, m.PrimaryMobileNumber AS mobile,
                   m.EmailId AS email, m.BloodGroup AS bloodGroup,
                   c.ClubName AS sortClub, m.MemberName AS sortName, 0 AS sortFamily
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            WHERE cm.IsActive = 1 AND cm.isdeleted = 0 AND cm.fk_club_id IN ({clubIdCsv})
              AND COALESCE(m.BloodGroup,'') <> ''
            UNION ALL
            SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, d.DistrictNumber AS districtNumber,
                   m.MemberName AS ownerName, COALESCE(NULLIF(f.Relation,''),'Family') AS relation,
                   f.Name AS personName, f.PhoneNumber AS mobile,
                   f.EmailId AS email, f.BloodGroup AS bloodGroup,
                   c.ClubName AS sortClub, m.MemberName AS sortName, 1 AS sortFamily
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            JOIN member_family_details f ON f.fk_member_master_profile_id = m.pk_member_master_profile_id AND COALESCE(f.isdeleted,0) = 0
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            WHERE cm.IsActive = 1 AND cm.isdeleted = 0 AND cm.fk_club_id IN ({clubIdCsv})
              AND COALESCE(f.BloodGroup,'') <> ''
            ORDER BY sortClub, sortName, sortFamily, personName", p)).ToList();
        // ROW: the blood-group call list follows member.bloodGroup (off on ROW).
        if (!RotaryApi.Services.Brand.Feature("member.bloodGroup")) bloodGroups.Clear();

        // TRF across all district clubs
        var trf = (await conn.QueryAsync<dynamic>($@"
            SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, t.TrfDate AS trfDate, t.DonorName AS donorName,
                   t.AmountUSD AS amountUsd, t.FundType AS fundType, t.OtherFundName AS otherFundName,
                   COALESCE(f.FundName, t.OtherFundName) AS fundName
            FROM trf_contributions t
            LEFT JOIN trf_fund_master f ON f.pk_fund_id = t.fk_fund_id
            JOIN club_master c ON c.pk_club_id = t.fk_club_id
            WHERE t.fk_year_id = @YearId AND t.isdeleted = 0 AND t.fk_club_id IN ({clubIdCsv})
            ORDER BY t.TrfDate DESC", p)).ToList();

        // District Committee — three separate arrays per spec (so the Excel
        // export can land each level on its own sheet). Existing flattened
        // `committee` UNION is kept below for the legacy single-sheet export.
        var committeeMain = (await conn.QueryAsync<dynamic>(@"
            SELECT dcm.name               AS memberName,
                   CASE WHEN COALESCE(dcm.fk_member_id, 0) > 0 AND mp.PrimaryMobileNumber IS NOT NULL AND TRIM(mp.PrimaryMobileNumber) <> ''
                        THEN mp.PrimaryMobileNumber ELSE dcm.mobile END AS mobile,
                   CASE WHEN COALESCE(dcm.fk_member_id, 0) > 0 AND mp.EmailId IS NOT NULL AND TRIM(mp.EmailId) <> ''
                        THEN mp.EmailId ELSE dcm.email END AS email,
                   dcm.district_designation AS designation
            FROM district_committee_member dcm
            LEFT JOIN member_master_profile mp ON mp.pk_member_master_profile_id = dcm.fk_member_id AND mp.isdeleted = 0
            WHERE dcm.fk_district_id = @D AND dcm.fk_year_id = @YearId AND dcm.isdeleted = 0 AND dcm.is_active = 1
            ORDER BY dcm.name", p)).ToList();

        var committeeGroup = (await conn.QueryAsync<dynamic>(@"
            SELECT g.group_name           AS groupName,
                   gm.name                AS memberName,
                   CASE WHEN COALESCE(gm.fk_member_id, 0) > 0 AND mp.PrimaryMobileNumber IS NOT NULL AND TRIM(mp.PrimaryMobileNumber) <> ''
                        THEN mp.PrimaryMobileNumber ELSE gm.mobile END AS mobile,
                   CASE WHEN COALESCE(gm.fk_member_id, 0) > 0 AND mp.EmailId IS NOT NULL AND TRIM(mp.EmailId) <> ''
                        THEN mp.EmailId ELSE gm.email END AS email,
                   gm.district_designation AS designation
            FROM district_committee_group_member gm
            JOIN district_committee_group g ON g.id = gm.fk_group_id
            LEFT JOIN member_master_profile mp ON mp.pk_member_master_profile_id = gm.fk_member_id AND mp.isdeleted = 0
            WHERE g.fk_district_id = @D AND g.fk_year_id = @YearId
              AND gm.isdeleted = 0 AND gm.is_active = 1 AND g.isdeleted = 0
            ORDER BY g.group_name, gm.name", p)).ToList();

        var committeeSubGroup = (await conn.QueryAsync<dynamic>(@"
            SELECT g.group_name           AS groupName,
                   sg.sub_group_name      AS subGroupName,
                   sm.name                AS memberName,
                   CASE WHEN COALESCE(sm.fk_member_id, 0) > 0 AND mp.PrimaryMobileNumber IS NOT NULL AND TRIM(mp.PrimaryMobileNumber) <> ''
                        THEN mp.PrimaryMobileNumber ELSE sm.mobile END AS mobile,
                   CASE WHEN COALESCE(sm.fk_member_id, 0) > 0 AND mp.EmailId IS NOT NULL AND TRIM(mp.EmailId) <> ''
                        THEN mp.EmailId ELSE sm.email END AS email,
                   sm.district_designation AS designation
            FROM district_committee_sub_group_member sm
            JOIN district_committee_sub_group sg ON sg.id = sm.fk_sub_group_id
            JOIN district_committee_group     g  ON g.id  = sg.fk_group_id
            LEFT JOIN member_master_profile mp ON mp.pk_member_master_profile_id = sm.fk_member_id AND mp.isdeleted = 0
            WHERE g.fk_district_id = @D AND g.fk_year_id = @YearId
              AND sm.isdeleted = 0 AND sm.is_active = 1 AND sg.isdeleted = 0 AND g.isdeleted = 0
            ORDER BY g.group_name, sg.sub_group_name, sm.name", p)).ToList();

        var committee = (await conn.QueryAsync<dynamic>(@"
            SELECT 'Main Committee' AS section, dcm.name AS memberName,
                   CASE WHEN COALESCE(dcm.fk_member_id, 0) > 0 AND mp.PrimaryMobileNumber IS NOT NULL AND TRIM(mp.PrimaryMobileNumber) <> ''
                        THEN mp.PrimaryMobileNumber ELSE dcm.mobile END AS mobile,
                   CASE WHEN COALESCE(dcm.fk_member_id, 0) > 0 AND mp.EmailId IS NOT NULL AND TRIM(mp.EmailId) <> ''
                        THEN mp.EmailId ELSE dcm.email END AS email,
                   dcm.district_designation AS designation, NULL AS groupName
            FROM district_committee_member dcm
            LEFT JOIN member_master_profile mp ON mp.pk_member_master_profile_id = dcm.fk_member_id AND mp.isdeleted = 0
            WHERE dcm.fk_district_id = @D AND dcm.fk_year_id = @YearId AND dcm.isdeleted = 0 AND dcm.is_active = 1
            UNION ALL
            SELECT 'Group' AS section, gm.name AS memberName,
                   CASE WHEN COALESCE(gm.fk_member_id, 0) > 0 AND mp.PrimaryMobileNumber IS NOT NULL AND TRIM(mp.PrimaryMobileNumber) <> ''
                        THEN mp.PrimaryMobileNumber ELSE gm.mobile END AS mobile,
                   CASE WHEN COALESCE(gm.fk_member_id, 0) > 0 AND mp.EmailId IS NOT NULL AND TRIM(mp.EmailId) <> ''
                        THEN mp.EmailId ELSE gm.email END AS email,
                   gm.district_designation AS designation, g.group_name AS groupName
            FROM district_committee_group_member gm
            JOIN district_committee_group g ON g.id = gm.fk_group_id
            LEFT JOIN member_master_profile mp ON mp.pk_member_master_profile_id = gm.fk_member_id AND mp.isdeleted = 0
            WHERE g.fk_district_id = @D AND g.fk_year_id = @YearId
              AND gm.isdeleted = 0 AND gm.is_active = 1 AND g.isdeleted = 0
            UNION ALL
            SELECT 'Sub Group' AS section, sm.name AS memberName,
                   CASE WHEN COALESCE(sm.fk_member_id, 0) > 0 AND mp.PrimaryMobileNumber IS NOT NULL AND TRIM(mp.PrimaryMobileNumber) <> ''
                        THEN mp.PrimaryMobileNumber ELSE sm.mobile END AS mobile,
                   CASE WHEN COALESCE(sm.fk_member_id, 0) > 0 AND mp.EmailId IS NOT NULL AND TRIM(mp.EmailId) <> ''
                        THEN mp.EmailId ELSE sm.email END AS email,
                   sm.district_designation AS designation,
                   CONCAT(g.group_name, ' > ', sg.sub_group_name) AS groupName
            FROM district_committee_sub_group_member sm
            JOIN district_committee_sub_group sg ON sg.id = sm.fk_sub_group_id
            JOIN district_committee_group g ON g.id = sg.fk_group_id
            LEFT JOIN member_master_profile mp ON mp.pk_member_master_profile_id = sm.fk_member_id AND mp.isdeleted = 0
            WHERE g.fk_district_id = @D AND g.fk_year_id = @YearId
              AND sm.isdeleted = 0 AND sm.is_active = 1 AND sg.isdeleted = 0 AND g.isdeleted = 0
            ORDER BY section, groupName", p)).ToList();

        // District Governor — name and photo come from the member profile when one is linked
        // (same rule as every other screen), and from the row's own columns for a governor who
        // is not a member of any club.
        var governor = await conn.QueryFirstOrDefaultAsync<dynamic>($@"
            SELECT {DistrictGovernorSql.Name} AS memberName, g.description,
                   {DistrictGovernorSql.Photo} AS profilePhoto
            FROM district_governors g
            {DistrictGovernorSql.JoinMember}
            WHERE g.fk_district_id = @D AND g.fk_year_id = @YearId AND g.isdeleted = 0",
            p);

        // AG — year-scoped (district_ag.fk_year_id). District report renders for one year,
        // so the AG list must be scoped to that year too.
        var ags = (await conn.QueryAsync<dynamic>(@"
            SELECT m.MemberName AS memberName, m.PrimaryMobileNumber AS mobile, m.EmailId AS email,
                   c.ClubName AS clubName
            FROM district_ag a
            JOIN member_master_profile m ON m.pk_member_master_profile_id = a.fk_member_id
            JOIN club_master c ON c.pk_club_id = a.fk_club_id
            WHERE a.fk_district_id = @D AND a.fk_year_id = @YearId AND a.isdeleted = 0 AND a.is_active = 1
            ORDER BY c.ClubName",
            p)).ToList();

        // Club Moderators — club-scoped, so it must respect the AG club filter too
        // (fk_district_id alone would leak the whole district into an AG's report).
        var moderators = (await conn.QueryAsync<dynamic>($@"
            SELECT m.MemberName AS memberName, m.PrimaryMobileNumber AS mobile, m.EmailId AS email,
                   c.ClubName AS clubName
            FROM district_club_moderator cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_id
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id
            WHERE cm.fk_district_id = @D AND cm.isdeleted = 0 AND cm.is_active = 1
              AND cm.fk_club_id IN ({clubIdCsv})
            ORDER BY c.ClubName",
            p)).ToList();

        // Club Monthly Reports (all clubs in district)
        var monthlyReports = (await conn.QueryAsync<dynamic>($@"
            SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, r.ReportMonth AS reportMonth,
                   r.MemberCountLastMonth AS memberCountLastMonth, r.MembersDeleted AS membersDeleted,
                   r.MembersAdded AS membersAdded, r.CurrentMemberCount AS currentMemberCount,
                   r.IsUploadedToDistrict AS isUploadedToDistrict, r.created_date AS createdDate
            FROM club_monthly_reports r
            JOIN club_master c ON c.pk_club_id = r.fk_club_id
            WHERE r.fk_year_id = @YearId AND r.isdeleted = 0 AND r.fk_club_id IN ({clubIdCsv})
            ORDER BY c.ClubName, r.ReportMonth", p)).ToList();

        // District Awards - aggregated by club with total points
        var districtCitation = (await conn.QueryAsync<dynamic>($@"
            SELECT c.ClubName AS clubName,
                   CAST(ROUND(SUM(e.points_earned)) AS SIGNED) AS totalPoints,
                   CAST(ROUND(SUM(e.bonus_earned)) AS SIGNED) AS totalBonus,
                   CAST(ROUND(SUM(e.points_earned + e.bonus_earned)) AS SIGNED) AS grandTotal,
                   COUNT(*) AS entryCount
            FROM district_citation_club_entry e
            JOIN club_master c ON c.pk_club_id = e.fk_club_id
            WHERE e.fk_district_id = @D AND e.fk_year_id = @YearId AND e.isdeleted = 0
              AND e.fk_club_id IN ({clubIdCsv})
            GROUP BY c.pk_club_id, c.ClubName
            ORDER BY grandTotal DESC", p)).ToList();

        // NOTE: the District Citation MATRIX (categories × questions × clubs grid) is intentionally
        // NOT built here anymore. It was never consumed from this payload — the District Awards
        // reports fetch it lazily via GET /api/citation-matrix — and assembling the grid (4 heavy
        // queries + per-club/per-question loops) on every report load AND every year change was the
        // single biggest cost of this endpoint. Removed for performance.

        // PPH Camps (district + all clubs in district)
        var pphCamps = (await conn.QueryAsync<dynamic>($@"
            SELECT pc.fk_club_id AS clubId, COALESCE(c.ClubName, 'District Level') AS clubName,
                   pc.Title AS title, pc.Description AS description, pc.Address AS address,
                   pc.CampDate AS campDate,
                   (SELECT COUNT(*) FROM pph_camp_attendance a WHERE a.fk_camp_id = pc.pk_camp_id AND a.isdeleted = 0) AS attendanceCount
            FROM pph_camps pc
            LEFT JOIN club_master c ON c.pk_club_id = pc.fk_club_id
            WHERE pc.isdeleted = 0
              AND (pc.fk_district_id = @D OR pc.fk_club_id IN ({clubIdCsv}))
              AND (@Start IS NULL OR pc.CampDate BETWEEN @Start AND @End)
            ORDER BY pc.CampDate DESC",
            new { D = districtId, YearId = yearId, Start = yrStart, End = yrEnd })).ToList();

        // Mass Emails (district scope)
        var massEmails = (await conn.QueryAsync<dynamic>($@"
            SELECT COALESCE(c.ClubName, 'District Level') AS clubName,
                   me.Subject AS subject, me.FromName AS fromName, me.Status AS status,
                   me.TotalRecipients AS totalRecipients, me.SentCount AS sentCount,
                   me.FailedCount AS failedCount, me.SentDate AS sentDate, me.created_date AS createdDate
            FROM club_mass_emails me
            LEFT JOIN club_master c ON c.pk_club_id = me.fk_club_id
            WHERE me.isdeleted = 0
              AND (me.fk_district_id = @D OR me.fk_club_id IN ({clubIdCsv}))
              AND (@Start IS NULL OR me.created_date BETWEEN @Start AND @End)
            ORDER BY me.created_date DESC",
            new { D = districtId, YearId = yearId, Start = yrStart, End = yrEnd })).ToList();

        // Event Payment Links
        var eventPaymentLinks = (await conn.QueryAsync<dynamic>($@"
            SELECT COALESCE(c.ClubName, 'District Level') AS clubName,
                   epl.Title AS title, epl.Description AS description, epl.WeblinkUrl AS weblinkUrl,
                   epl.created_date AS createdDate,
                   (SELECT COUNT(*) FROM event_payment_registrations r WHERE r.fk_payment_link_id = epl.pk_id AND r.isdeleted = 0) AS registrationCount,
                   (SELECT COALESCE(SUM(r.Amount), 0) FROM event_payment_registrations r WHERE r.fk_payment_link_id = epl.pk_id AND r.isdeleted = 0) AS totalAmount
            FROM event_payment_links epl
            LEFT JOIN club_master c ON c.pk_club_id = epl.fk_club_id
            WHERE epl.isdeleted = 0
              AND (epl.fk_district_master_id = @D OR epl.fk_club_id IN ({clubIdCsv}))
              AND (@Start IS NULL OR epl.created_date BETWEEN @Start AND @End)
            ORDER BY epl.created_date DESC",
            new { D = districtId, YearId = yearId, Start = yrStart, End = yrEnd })).ToList();

        // Zonal Awards entries
        var zonalAwards = (await conn.QueryAsync<dynamic>(@"
            SELECT g.title AS goalTitle, q.sub_title AS question, q.category,
                   o.goal_requirement_label AS requirement, o.report_use_title AS optionLabel,
                   e.month, e.entered_counts AS enteredCounts, e.received_points AS receivedPoints
            FROM zonal_awards_district_entry e
            JOIN zonal_awards_question_option o ON o.pk_id = e.fk_option_id
            JOIN zonal_awards_question q ON q.pk_id = o.fk_question_id
            JOIN zonal_awards_goal g ON g.pk_id = q.fk_goal_id
            WHERE e.fk_district_id = @D AND e.fk_year_id = @YearId AND e.isdeleted = 0
            ORDER BY g.sort_order, q.sort_order, o.sort_order, e.month",
            p)).ToList();

        var totalTrf = trf.Sum(t => (decimal?)t.amountUsd ?? 0);
        var totalProjectCost = projects.Sum(x => RotaryApi.Services.CurrencyHelper.Convert((decimal?)x.projectCost ?? 0, x.currency as string, reportCurrency, fxRates));
        var totalBeneficiaries = projects.Sum(x => (int?)x.directBeneficiaries ?? 0);

        // ── EGOVERNANCE-REPORT EXTENSIONS (district-admin reports rebuild) ──

        // Club list (id, name) for client-side dropdowns on every
        // "All Clubs / specific club" report. Active clubs only.
        // Drives the club dropdown — under AG scope it must list ONLY the AG's clubs.
        var clubList = (await conn.QueryAsync<dynamic>($@"
            SELECT c.pk_club_id  AS clubId,
                   c.ClubName    AS clubName,
                   COALESCE(c.IsSyncedFromRotaryOrg, 0) AS isSyncedFromRotaryOrg
            FROM club_master c
            WHERE c.fk_district_id = @D AND c.isdeleted = 0
              AND c.pk_club_id IN ({clubIdCsv})
            ORDER BY c.ClubName", new { D = districtId })).ToList();

        // AG → Club mapping for the year. Used by "AG-wise" report filters so
        // the dropdown lists each AG once and a single export pulls only their
        // assigned clubs.
        var agAllocation = (await conn.QueryAsync<dynamic>($@"
            SELECT a.fk_member_id     AS agMemberId,
                   m.MemberName       AS agName,
                   m.PrimaryMobileNumber AS agMobile,
                   m.EmailId          AS agEmail,
                   c.pk_club_id       AS clubId,
                   c.ClubName         AS clubName,
                   c.ClubRotaryId     AS clubRotaryId,
                   (SELECT c2.ClubName FROM club_members cm2
                      JOIN club_master c2 ON c2.pk_club_id = cm2.fk_club_id AND c2.isdeleted = 0
                     WHERE cm2.fk_member_master_profile_id = a.fk_member_id
                       AND cm2.isdeleted = 0 AND cm2.IsActive = 1
                     ORDER BY cm2.pk_club_member_id LIMIT 1) AS agClubName
            FROM district_ag a
            JOIN member_master_profile m ON m.pk_member_master_profile_id = a.fk_member_id AND m.isdeleted = 0
            JOIN club_master c           ON c.pk_club_id                    = a.fk_club_id  AND c.isdeleted = 0
            WHERE a.fk_district_id = @D AND a.fk_year_id = @YearId
              AND a.isdeleted = 0 AND a.is_active = 1
              AND a.fk_club_id IN ({clubIdCsv})
            ORDER BY m.MemberName, c.ClubName",
            p)).ToList();

        // Active app users — ALL active members across the district. Device Name is blank when the
        // member has not downloaded the app; `downloaded` = Yes/No; `platform` (Android/iOS) comes
        // from the member's latest active FCM token. The frontend uses these for the
        // Not-Downloaded / Android / iOS totals in the report header.
        var appUsers = (await conn.QueryAsync<dynamic>($@"
            SELECT cm.fk_club_id     AS clubId,
                   c.ClubName        AS clubName,
                   m.MemberName      AS memberName,
                   m.PrimaryMobileNumber AS mobile,
                   m.EmailId         AS email,
                   COALESCE(NULLIF(m.LastDeviceName, ''), '') AS deviceName,
                   CASE WHEN m.LastDeviceName IS NULL OR m.LastDeviceName = '' THEN 'No' ELSE 'Yes' END AS downloaded,
                   -- Platform is derived from the Device Name shown in the report (the same signal
                   -- that decides Downloaded), so counts always match the visible rows. Apple
                   -- device names contain iPhone/iPad/iPod/iOS/Apple/Mac; everything else = Android.
                   CASE
                       WHEN m.LastDeviceName IS NULL OR m.LastDeviceName = '' THEN ''
                       WHEN LOWER(m.LastDeviceName) LIKE '%iphone%'
                         OR LOWER(m.LastDeviceName) LIKE '%ipad%'
                         OR LOWER(m.LastDeviceName) LIKE '%ipod%'
                         OR LOWER(m.LastDeviceName) LIKE '%ios%'
                         OR LOWER(m.LastDeviceName) LIKE '%apple%'
                         OR LOWER(m.LastDeviceName) LIKE '%mac%' THEN 'iOS'
                       ELSE 'Android'
                   END AS platform
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            JOIN club_master c           ON c.pk_club_id                    = cm.fk_club_id
            WHERE cm.fk_club_id IN ({clubIdCsv})
              AND cm.IsActive = 1 AND cm.isdeleted = 0
            ORDER BY c.ClubName, m.MemberName", p)).ToList();

        // PPH Camp attendees across every camp in the district (club camps + district-level camps),
        // camps dated within the selected Rotary year. ONE ROW PER MEDICAL READING, each with that
        // attendee's OWN values (attendees with no reading still get one blank row). Legacy rows store
        // isdeleted as NULL, so every isdeleted check is COALESCE'd or old attendees drop out.
        var pphCampAttendees = (await conn.QueryAsync<dynamic>($@"
            SELECT pc.fk_club_id AS clubId,
                   COALESCE(c.ClubName, 'District Level') AS clubName,
                   pc.CampDate    AS campDate,
                   pc.Title       AS campName,
                   pa.created_date AS readingDate,
                   pa.RegistrationNo AS serialNumber,
                   att.Name       AS name,
                   att.MobileNo   AS mobileNumber,
                   att.Address    AS address,
                   att.Sex        AS gender,
                   CASE WHEN att.IsConsentedForMessages = 1 THEN 'Yes' ELSE 'No' END AS approvalForSms,
                   pa.Age         AS age,
                   pa.BPSystolic  AS bpSystolic,
                   pa.BPDiastolic AS bpDiastolic,
                   CASE WHEN pa.BloodSugarType = 'FBS' THEN pa.BloodSugarValue ELSE NULL END AS fbs,
                   CASE WHEN pa.BloodSugarType = 'RBS' THEN pa.BloodSugarValue ELSE NULL END AS rbs,
                   pa.HeightCm    AS height,
                   pa.WeightKg    AS weight,
                   pa.BMI         AS bmi,
                   pa.DiabetesStatus  AS diabetes,
                   pa.BPStatus        AS highBloodPressure,
                   CASE WHEN pa.IsObese = 1 THEN 'Yes' ELSE 'No' END AS obese,
                   CASE WHEN pa.IsOverweight = 1 THEN 'Yes' ELSE 'No' END AS overweight,
                   pa.Remarks     AS remarks
            FROM pph_camp_attendies att
            JOIN pph_camps pc ON pc.pk_camp_id = att.fk_camp_id AND COALESCE(pc.isdeleted, 0) = 0
            JOIN rotary_year_master y ON y.pk_year_id = @YearId
            LEFT JOIN club_master c ON c.pk_club_id = pc.fk_club_id
            LEFT JOIN pph_camp_attendance pa
                   ON pa.fk_attendee_id = att.pk_attendee_id AND COALESCE(pa.isdeleted, 0) = 0
            WHERE (pc.fk_district_id = @D OR pc.fk_club_id IN ({clubIdCsv}))
              AND COALESCE(att.isdeleted, 0) = 0
              AND pc.CampDate >= y.StartDate AND pc.CampDate < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
            ORDER BY pc.CampDate DESC, att.Name, att.pk_attendee_id, pa.pk_attendance_id", new { D = districtId, YearId = yearId })).ToList();

        // Per-club per-month Submission Details for Club Monthly Report.
        // One row per (club, month) with status string + date string. The pivot
        // into 12 columns is done client-side at export time.
        // "Submitted" here means the club actually UPLOADED the report to the district
        // (IsUploadedToDistrict=1 → uploaded_to_district_date set). A report the club only
        // STARTED (row created, never uploaded) must NOT count as submitted — hence we return
        // uploaded_to_district_date ONLY, never falling back to created_date. A NULL date makes
        // the client render that month as "Not Submitted" (an in-progress or not-started month).
        var monthlyReportSubmissions = (await conn.QueryAsync<dynamic>($@"
            SELECT c.pk_club_id AS clubId, c.ClubName AS clubName,
                   r.ReportMonth AS reportMonth,
                   CASE WHEN COALESCE(r.IsUploadedToDistrict, 0) = 1
                        THEN r.uploaded_to_district_date ELSE NULL END AS submittedDate
            FROM club_monthly_reports r
            JOIN club_master c ON c.pk_club_id = r.fk_club_id
            WHERE r.fk_year_id = @YearId AND r.isdeleted = 0 AND r.fk_club_id IN ({clubIdCsv})
            ORDER BY c.ClubName, r.ReportMonth", p)).ToList();

        // OCV "Dues" report — one row per (club × dues document type) for the selected year.
        // CROSS JOIN clubs × dues types, LEFT JOIN the uploaded docs, so a club/type with nothing
        // uploaded still appears (Amount 0, Uploaded=No). Amount is summed and PaidOn is the latest
        // when a type allows multiple uploads. The client renders the flat list + per-club subtotal
        // (horizontal), per-type total (vertical) and grand total, and applies the Club / Dues-type filters.
        var duesCategoryId = await conn.ExecuteScalarAsync<int?>(
            "SELECT pk_category_id FROM ocv_document_category WHERE CategoryCode = 'dues' LIMIT 1");
        var duesReport = new List<dynamic>();
        if (duesCategoryId.HasValue && duesCategoryId.Value > 0)
        {
            duesReport = (await conn.QueryAsync<dynamic>($@"
                SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, dm.DistrictNumber AS districtNumber,
                       t.pk_type_id AS typeId, COALESCE(t.TypeName, '') AS documentType, t.SortOrder AS typeSort,
                       COALESCE(SUM(d.Amount), 0) AS amount,
                       MAX(d.PaidOn) AS paidOn,
                       CASE WHEN COUNT(d.pk_document_id) > 0 THEN 1 ELSE 0 END AS isUploaded,
                       (SELECT CASE WHEN d2.FilePath IS NULL OR d2.FilePath = '' THEN NULL
                                    WHEN d2.FilePath LIKE '/%' THEN d2.FilePath
                                    ELSE CONCAT('/Documents/OCV/Group', d2.fk_club_id, '/', d2.FilePath) END
                          FROM ocv_documents d2
                          WHERE d2.fk_club_id = c.pk_club_id AND d2.fk_type_id = t.pk_type_id
                            AND d2.fk_category_id = @DuesCat AND d2.fk_year_id = @YearId AND d2.isdeleted = 0
                          ORDER BY d2.created_date DESC LIMIT 1) AS filePath
                FROM club_master c
                JOIN district_master dm ON dm.pk_district_id = c.fk_district_id
                CROSS JOIN ocv_document_type t
                LEFT JOIN ocv_documents d
                       ON d.fk_club_id = c.pk_club_id AND d.fk_type_id = t.pk_type_id
                      AND d.fk_category_id = @DuesCat AND d.fk_year_id = @YearId AND d.isdeleted = 0
                WHERE c.fk_district_id = @D AND c.isdeleted = 0 AND c.pk_club_id IN ({clubIdCsv})
                      AND t.fk_category_id = @DuesCat AND t.isdeleted = 0 AND t.IsActive = 1
                GROUP BY c.pk_club_id, c.ClubName, dm.DistrictNumber, t.pk_type_id, t.TypeName, t.SortOrder
                ORDER BY c.ClubName, t.SortOrder, t.TypeName",
                new { D = districtId, YearId = yearId, DuesCat = duesCategoryId.Value })).ToList();
        }

        // District-level projects (NOT club projects) — projects rolled up to the
        // district. The year-wise project table also stores direct district rows
        // (no club id). Surfaced as its own report per spec.
        var districtProjects = new List<dynamic>();
        if (pInfo != null)
        {
            districtProjects = (await conn.QueryAsync<dynamic>($@"
                SELECT p.title, p.description, p.project_date AS projectDate,
                       p.project_cost AS projectCost, p.project_cost AS amountSpent,
                       p.direct_beneficiaries AS directBeneficiaries,
                       p.man_hours AS manHours, p.rotarians_involved AS rotariansInvolved,
                       p.location,
                       af.name AS areaOfFocus, cat.name AS category, sc.name AS subCategory,
                       f.name AS funding,
                       p.global_grant_number AS globalGrantNumber, p.csr_company_name AS csrCompanyName,
                       p.amount_sanctioned AS amountSanctioned, p.amount_received AS amountReceived,
                       p.host_clubs_districts AS hostClubsDistricts,
                       p.global_partner_clubs_districts AS globalPartners,
                       CONCAT('{_frontendUrl}/public/project/', p.pk_project_id, '?year={yearId}') AS publicPhotoUrl
                FROM `{pInfo.ProjectsTable}` p
                LEFT JOIN area_of_focus_master af ON af.pk_area_of_focus_id = p.fk_area_of_focus_id
                LEFT JOIN category_master cat ON cat.pk_category_id = p.fk_category_id
                LEFT JOIN sub_category_master sc ON sc.pk_sub_category_id = p.fk_sub_category_id
                LEFT JOIN funding_master f ON f.pk_funding_id = p.fk_funding_id
                WHERE p.fk_district_id = @D
                  AND (p.DistrictProjectType = 'Project' OR p.DistrictProjectType IS NULL)
                  AND p.isdeleted = 0
                ORDER BY p.project_date DESC", new { D = districtId })).ToList();
        }

        // District EVENTS — same source as district admin → Foundation → District Events:
        // the year-wise projects table rows tagged DistrictProjectType='Event' (Projects and
        // Events share the table, split by that column). Was previously (wrongly) read from the
        // generic upcoming-events feed filtered by clubName='District Level'.
        var districtEvents = new List<dynamic>();
        if (pInfo != null)
        {
            districtEvents = (await conn.QueryAsync<dynamic>($@"
                SELECT p.title, p.description, p.project_date AS eventDate,
                       (SELECT CONCAT('/Documents/DistrictEvent/', p.fk_district_id, '/', pp.image_path)
                          FROM `{pInfo.PhotosTable}` pp WHERE pp.fk_project_id = p.pk_project_id LIMIT 1) AS imagePath
                FROM `{pInfo.ProjectsTable}` p
                WHERE p.fk_district_id = @D AND p.DistrictProjectType = 'Event' AND p.isdeleted = 0
                ORDER BY p.project_date DESC", new { D = districtId })).ToList();
        }

        // Non-Synchronized clubs — these are NOT synced from Rotary.org, so they have no
        // BOD (President/Secretary), which is why those columns were always blank. Show only
        // the club's own details: Club ID, Name, Charter Date, Address. Honours clubIdCsv so
        // an AG only ever sees their own clubs.
        var nonRiSyncedClubs = (await conn.QueryAsync<dynamic>($@"
            SELECT COALESCE(NULLIF(c.ClubRotaryId, ''), CAST(c.pk_club_id AS CHAR)) AS clubId,
                   c.ClubName AS clubName,
                   c.ClubCharterDate AS charterDate,
                   CONCAT_WS(', ', NULLIF(c.MeetingAddress, ''), NULLIF(c.City, ''),
                                   NULLIF(c.State, ''), NULLIF(c.Pincode, '')) AS address,
                   d.DistrictNumber AS districtNumber
            FROM club_master c
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            WHERE c.fk_district_id = @D AND COALESCE(c.IsSyncedFromRotaryOrg, 0) = 0 AND c.isdeleted = 0
              AND c.pk_club_id IN ({clubIdCsv})
            ORDER BY c.ClubName",
            p)).ToList();

        // Synchronized clubs — SAME columns as Non-Synchronized (Club + District +
        // President/Secretary from BOD). IsSyncedFromRotaryOrg = 1.
        var riSyncedClubs = (await conn.QueryAsync<dynamic>($@"
            SELECT c.ClubName AS clubName, d.DistrictNumber AS districtNumber,
                   (SELECT m.MemberName FROM board_of_directors b
                      JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id
                     WHERE b.fk_club_id = c.pk_club_id AND b.fk_year_id = @YearId AND b.fk_designation_id = 1 AND b.isdeleted = 0 LIMIT 1) AS president,
                   (SELECT m.PrimaryMobileNumber FROM board_of_directors b
                      JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id
                     WHERE b.fk_club_id = c.pk_club_id AND b.fk_year_id = @YearId AND b.fk_designation_id = 1 AND b.isdeleted = 0 LIMIT 1) AS presidentMobile,
                   (SELECT m.EmailId FROM board_of_directors b
                      JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id
                     WHERE b.fk_club_id = c.pk_club_id AND b.fk_year_id = @YearId AND b.fk_designation_id = 1 AND b.isdeleted = 0 LIMIT 1) AS presidentEmail,
                   (SELECT m.MemberName FROM board_of_directors b
                      JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id
                     WHERE b.fk_club_id = c.pk_club_id AND b.fk_year_id = @YearId AND b.fk_designation_id = 2 AND b.isdeleted = 0 LIMIT 1) AS secretary,
                   (SELECT m.PrimaryMobileNumber FROM board_of_directors b
                      JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id
                     WHERE b.fk_club_id = c.pk_club_id AND b.fk_year_id = @YearId AND b.fk_designation_id = 2 AND b.isdeleted = 0 LIMIT 1) AS secretaryMobile,
                   (SELECT m.EmailId FROM board_of_directors b
                      JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id
                     WHERE b.fk_club_id = c.pk_club_id AND b.fk_year_id = @YearId AND b.fk_designation_id = 2 AND b.isdeleted = 0 LIMIT 1) AS secretaryEmail
            FROM club_master c
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            WHERE c.fk_district_id = @D AND COALESCE(c.IsSyncedFromRotaryOrg, 0) = 1 AND c.isdeleted = 0
              AND c.pk_club_id IN ({clubIdCsv})
            ORDER BY c.ClubName",
            p)).ToList();

        // Data Collection — 3 reports only when the district's directory config
        // exists for the selected year. When absent, dataCollection stays null
        // and the frontend hides those 3 SectionRows + titles entirely.
        dynamic? dataCollection = null;
        var ddcCfg = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pk_id AS id,
                   COALESCE(DcFieldsJson, '[]')     AS dcJson,
                   COALESCE(BodFieldsJson, '[]')    AS bodJson,
                   COALESCE(MemberFieldsJson, '[]') AS memberJson
            FROM district_directory_config
            WHERE fk_district_id = @D AND fk_year_id = @YearId AND isdeleted = 0
            LIMIT 1", p);

        if (ddcCfg != null)
        {
            int configId = (int)ddcCfg.id;
            var dcKeys     = Services.DirectoryDataCollectionFields.DeserializeKeys((string)ddcCfg.dcJson);
            var bodKeys    = Services.DirectoryDataCollectionFields.DeserializeKeys((string)ddcCfg.bodJson);
            var memberKeys = Services.DirectoryDataCollectionFields.DeserializeKeys((string)ddcCfg.memberJson);

            // Rows are LAZY-LOADED via the 3 dedicated endpoints below
            // (DataCollectionAllMembers / DataCollectionBod / DataCollectionDc).
            // Pre-computing them here was too slow — N queries per member ×
            // thousands of members = many seconds per year change.
            dataCollection = new
            {
                configId,
                enabled = true,
                columns = new
                {
                    allMembers = BuildDcColumnSpec(memberKeys),
                    bod        = BuildDcColumnSpec(bodKeys),
                    dc         = BuildDcColumnSpec(dcKeys, includeCommittee: true)
                }
            };
        }

        return Ok(new
        {
            district,
            rotaryYear = year,
            summary = new
            {
                totalClubs,
                totalProjects = projects.Count,
                totalProjectCost,
                projectCostCurrency = reportCurrency,
                totalBeneficiaries,
                totalAnnouncements = announcements.Count,
                totalEvents = events.Count,
                totalNewsletters = newsletters.Count,
                totalDocuments = documents.Count,
                totalMeetings = attendance.Count,
                totalMembers = members.Count,
                totalBod = bod.Count,
                totalTrfAmount = totalTrf,
                totalTrfContributions = trf.Count,
                totalCommitteeMembers = committee.Count,
                totalAgs = ags.Count,
                totalModerators = moderators.Count,
                totalMonthlyReports = monthlyReports.Count,
                totalZonalAwardEntries = zonalAwards.Count,
                totalCitationClubs = districtCitation.Count,
                totalPphCamps = pphCamps.Count,
                totalMassEmails = massEmails.Count,
                totalEventPaymentLinks = eventPaymentLinks.Count
            },
            projectsByModule,
            announcements,
            events,
            newsletters,
            documents,
            attendance,
            bod,
            members,
            bloodGroups,
            trf,
            committee,
            committeeMain,
            committeeGroup,
            committeeSubGroup,
            governor,
            ags,
            moderators,
            monthlyReports,
            clubMonthlyProjectDetails,
            zonalAwards,
            districtCitation,
            pphCamps,
            massEmails,
            eventPaymentLinks,
            // EgovReport rebuild — additive fields used by district-admin reports tab.
            clubList,
            agAllocation,
            appUsers,
            pphCampAttendees,
            monthlyReportSubmissions,
            duesReport,
            districtProjects,
            districtEvents,
            nonRiSyncedClubs,
            riSyncedClubs,
            dataCollection,
        });
    }

    // Excel-friendly stringifier for Data Collection field values. Mirrors the
    // ClubReportController helper so the District-level Data Collection reports
    // look identical column-for-column to the Club-level ones.
    private static string? RenderForExport(Services.DirectoryDataCollectionFields.FieldDef f, string? v)
    {
        // Member Introduction is reported as a simple Yes/No (is an intro written?), not the
        // full free-text, so the sheet stays scannable (2026-09-09, user request). Checked
        // before the empty-guard so a blank intro reports "No" rather than an empty cell.
        if (f.Key == "memberIntroduction")
            return string.IsNullOrWhiteSpace(v) ? "No" : "Yes";
        if (string.IsNullOrWhiteSpace(v)) return null;
        switch (f.Type)
        {
            case "image": return "Uploaded";
            case "date":
                if (DateTime.TryParse(v, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var dt))
                    return dt.Year == 1900
                        ? dt.ToString("dd-MMM", System.Globalization.CultureInfo.InvariantCulture)
                        : dt.ToString("dd-MMM-yyyy", System.Globalization.CultureInfo.InvariantCulture);
                return v;
            case "address-bulk":
                try
                {
                    using var doc = System.Text.Json.JsonDocument.Parse(v);
                    var el = doc.RootElement;
                    string? G(string n) => el.TryGetProperty(n, out var x) && x.ValueKind != System.Text.Json.JsonValueKind.Null ? x.ToString() : null;
                    var parts = new List<string>();
                    var addr = G("Address"); if (!string.IsNullOrWhiteSpace(addr)) parts.Add(addr);
                    var csp = string.Join(", ", new[] { G("City"), G("State"), G("PinCode") }.Where(s => !string.IsNullOrWhiteSpace(s)));
                    if (!string.IsNullOrWhiteSpace(csp)) parts.Add(csp);
                    var phone = G("PhoneNumber"); if (!string.IsNullOrWhiteSpace(phone)) parts.Add("Ph: " + phone);
                    var biz = G("BusinessName"); if (!string.IsNullOrWhiteSpace(biz)) parts.Add(biz);
                    return string.Join(" | ", parts);
                }
                catch { return v; }
            default: return v;
        }
    }

    // ── Data Collection lazy-load helpers ──
    // Column spec is cheap (no I/O). Rows are heavy (N queries per member) so
    // they live in 3 dedicated endpoints below; the main report endpoint only
    // returns columns + enabled flag.

    // includeCommittee: DC report only — names which committee level(s) the member sits on
    // (District Committee / Group Committee / Sub Group Committee). Meaningless for the
    // All Members and BOD reports, so it stays off by default.
    private static List<object> BuildDcColumnSpec(List<string> keys, bool includeCommittee = false)
    {
        // master = true marks the fixed identity/summary columns. The export tints them so
        // they read as a separate block from the dynamic data-collection fields in between
        // (which vary per report and per district config).
        var prefix = new List<object>
        {
            new { key = "clubName",         label = "Club Name",   master = true },
            new { key = "memberName",       label = "Member Name", master = true },
        };
        if (includeCommittee)
            prefix.Add(new { key = "committee", label = "Committee", master = true });
        prefix.AddRange(new List<object>
        {
            new { key = "updatedOn",        label = "Updated On",              master = true },
            new { key = "mobile",           label = "Mobile Number",           master = true },
            new { key = "rotaryId",         label = "Rotary Id",               master = true },
            new { key = "secondaryMobile",  label = "Secondary_mobile_Number", master = true },
        });
        // The dynamic block: exactly the fields this district selected for THIS report type
        // (DcFieldsJson / BodFieldsJson / MemberFieldsJson) — select 10 and you get 10.
        var middle = keys.Select(Services.DirectoryDataCollectionFields.GetField)
            .Where(f => f != null).Cast<Services.DirectoryDataCollectionFields.FieldDef>()
            .Select(f => new { key = f.Key, label = f.Label, master = false }).ToList<object>();
        var suffix = new List<object>
        {
            new { key = "donePercent",    label = "Done (%)",              master = true },
            new { key = "pendingPercent", label = "Pending (%)",           master = true },
            new { key = "totalFields",    label = "No. of Total Fields",   master = true },
            new { key = "pendingFields",  label = "No. of Pending Fields", master = true },
        };
        return prefix.Concat(middle).Concat(suffix).ToList();
    }

    private static async Task<Dictionary<string, object?>> BuildDcRowAsync(
        MySqlConnection conn, int configId,
        int memberId, string memName,
        string? mobile, string? rotaryId, string? secondaryMobile,
        List<string> keys, bool spouseNotApplicable, string clubLabel,
        // DC report only — which committee level(s) this member sits on. Null for the
        // All Members / BOD reports, where the key is omitted entirely.
        string? committee = null)
    {
        // Load values for the FULL key list (spouse fields included) so the spouse columns
        // still render whatever is actually stored — but exclude them from the completion
        // calc when the member ticked "Not Applicable (no spouse)", same as the Settings →
        // Directory Data Collection report/export (DirectoryDataCollectionController).
        var values = await Services.DirectoryDataCollectionFields.LoadValuesAsync(conn, memberId, keys);
        var effectiveKeys = Services.DirectoryDataCollectionFields.ApplySpouseNotApplicable(keys, spouseNotApplicable);
        var (filled, total, _) = Services.DirectoryDataCollectionFields.ComputeCompletion(values, effectiveKeys);
        int pendingCount = Math.Max(0, total - filled);
        int donePct    = total > 0 ? (int)Math.Round(100.0 * filled / total) : 0;
        int pendingPct = total > 0 ? 100 - donePct : 0;
        var updatedOn = await conn.ExecuteScalarAsync<DateTime?>(
            "SELECT MAX(SubmittedAt) FROM district_directory_submission_log WHERE fk_config_id = @C AND fk_member_id = @M",
            new { C = configId, M = memberId });
        var row = new Dictionary<string, object?>
        {
            ["clubName"]        = clubLabel,
            ["memberName"]      = memName,
        };
        if (committee != null) row["committee"] = committee;
        foreach (var kv in new Dictionary<string, object?>
        {
            ["updatedOn"]       = updatedOn?.ToString("dd/MMM/yy hh:mm:ss tt"),
            ["mobile"]          = mobile ?? "",
            ["rotaryId"]        = rotaryId ?? "",
            ["secondaryMobile"] = secondaryMobile ?? "",
            ["donePercent"]     = donePct + "%",
            ["pendingPercent"]  = pendingPct + "%",
            ["totalFields"]     = total,
            ["pendingFields"]   = pendingCount,
        }) row[kv.Key] = kv.Value;
        foreach (var key in keys)
        {
            var f = Services.DirectoryDataCollectionFields.GetField(key);
            if (f == null) { row[key] = null; continue; }
            values.TryGetValue(key, out var v);
            row[key] = RenderForExport(f, v);
        }
        return row;
    }

    // Returns (configId, dcKeys, bodKeys, memberKeys) or null when no config row exists.
    private static async Task<(int configId, List<string> dcKeys, List<string> bodKeys, List<string> memberKeys)?>
        LoadDcConfigAsync(MySqlConnection conn, int districtId, int yearId)
    {
        var ddcCfg = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pk_id AS id,
                   COALESCE(DcFieldsJson, '[]')     AS dcJson,
                   COALESCE(BodFieldsJson, '[]')    AS bodJson,
                   COALESCE(MemberFieldsJson, '[]') AS memberJson
            FROM district_directory_config
            WHERE fk_district_id = @D AND fk_year_id = @Y AND isdeleted = 0
            LIMIT 1", new { D = districtId, Y = yearId });
        if (ddcCfg == null) return null;
        return ((int)ddcCfg.id,
            Services.DirectoryDataCollectionFields.DeserializeKeys((string)ddcCfg.dcJson),
            Services.DirectoryDataCollectionFields.DeserializeKeys((string)ddcCfg.bodJson),
            Services.DirectoryDataCollectionFields.DeserializeKeys((string)ddcCfg.memberJson));
    }

    [HttpGet("data-collection/all-members")]
    public async Task<ActionResult> DataCollectionAllMembers(int districtId, [FromQuery] int yearId, [FromQuery] int? clubId = null, [FromQuery] int? agMemberId = null)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId))
            return StatusCode(403, new { message = "This district or its zone is inactive." });
        if (yearId <= 0) return BadRequest(new { message = "yearId is required." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var cfg = await LoadDcConfigAsync(conn, districtId, yearId);
        if (cfg == null) return Ok(new { rows = new List<object>() });
        var (configId, _, _, memberKeys) = cfg.Value;
        var spouseNaMap = await Services.DirectoryDataCollectionFields.GetSpouseNotApplicableMapAsync(conn, configId);
        bool SpouseNa(int id) => spouseNaMap.TryGetValue(id, out var f) && f;
        var agClubIds = await ResolveAgScopeClubIdsAsync(conn, districtId, yearId, agMemberId);
        // Narrow query to a single club when caller requests it — avoids the
        // N-queries-per-member cost of scanning the entire district.
        string clubFilter;
        object queryParams;
        if (clubId.HasValue && clubId.Value > 0)
        {
            if (agClubIds != null && !agClubIds.Contains(clubId.Value))
                return Ok(new { rows = new List<object>() });
            clubFilter = "cm.fk_club_id = @ClubId";
            queryParams = new { ClubId = clubId.Value };
        }
        else
        {
            var clubIds = (await conn.QueryAsync<int>(
                $"SELECT pk_club_id FROM club_master WHERE fk_district_id = @D AND isdeleted = 0{NotRotaractUnlessSa("")}",
                new { D = districtId })).ToList();
            if (agClubIds != null) clubIds = clubIds.Where(id => agClubIds.Contains(id)).ToList();
            var clubIdCsv = clubIds.Count > 0 ? string.Join(",", clubIds) : "0";
            clubFilter = $"cm.fk_club_id IN ({clubIdCsv})";
            queryParams = new { };
        }
        var rows = new List<Dictionary<string, object?>>();
        var members = await conn.QueryAsync<dynamic>($@"
            SELECT m.pk_member_master_profile_id AS id, m.MemberName AS name,
                   m.PrimaryMobileNumber AS mobile, m.RotaryId AS rotaryId,
                   m.SecondaryMobileNumber AS secMobile, c.ClubName AS clubName
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            JOIN club_master c           ON c.pk_club_id = cm.fk_club_id
            WHERE {clubFilter} AND cm.IsActive = 1 AND cm.isdeleted = 0
            ORDER BY c.ClubName, m.MemberName", queryParams);
        foreach (var x in members)
            rows.Add(await BuildDcRowAsync(conn, configId, (int)x.id, (string)x.name, (string?)x.mobile, (string?)x.rotaryId, (string?)x.secMobile, memberKeys, SpouseNa((int)x.id), (string)x.clubName));
        return Ok(new { rows });
    }

    [HttpGet("data-collection/bod")]
    public async Task<ActionResult> DataCollectionBod(int districtId, [FromQuery] int yearId, [FromQuery] int? clubId = null, [FromQuery] int? agMemberId = null)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId))
            return StatusCode(403, new { message = "This district or its zone is inactive." });
        if (yearId <= 0) return BadRequest(new { message = "yearId is required." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var cfg = await LoadDcConfigAsync(conn, districtId, yearId);
        if (cfg == null) return Ok(new { rows = new List<object>() });
        var (configId, _, bodKeys, _) = cfg.Value;
        var spouseNaMap = await Services.DirectoryDataCollectionFields.GetSpouseNotApplicableMapAsync(conn, configId);
        bool SpouseNa(int id) => spouseNaMap.TryGetValue(id, out var f) && f;
        var agClubIds = await ResolveAgScopeClubIdsAsync(conn, districtId, yearId, agMemberId);
        string clubFilter;
        object queryParams;
        if (clubId.HasValue && clubId.Value > 0)
        {
            // Under AG scope, a club outside their allocation returns nothing rather than
            // that club's data — the id could be tampered with in the query string.
            if (agClubIds != null && !agClubIds.Contains(clubId.Value))
                return Ok(new { rows = new List<object>() });
            clubFilter = "b.fk_club_id = @ClubId";
            queryParams = new { ClubId = clubId.Value, YearId = yearId };
        }
        else
        {
            var clubIds = (await conn.QueryAsync<int>(
                $"SELECT pk_club_id FROM club_master WHERE fk_district_id = @D AND isdeleted = 0{NotRotaractUnlessSa("")}",
                new { D = districtId })).ToList();
            if (agClubIds != null) clubIds = clubIds.Where(id => agClubIds.Contains(id)).ToList();
            var clubIdCsv = clubIds.Count > 0 ? string.Join(",", clubIds) : "0";
            clubFilter = $"b.fk_club_id IN ({clubIdCsv})";
            queryParams = new { YearId = yearId };
        }
        var rows = new List<Dictionary<string, object?>>();
        var members = await conn.QueryAsync<dynamic>($@"
            SELECT m.pk_member_master_profile_id AS id, m.MemberName AS name,
                   m.PrimaryMobileNumber AS mobile, m.RotaryId AS rotaryId,
                   m.SecondaryMobileNumber AS secMobile, c.ClubName AS clubName
            FROM board_of_directors b
            JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id AND m.isdeleted = 0
            JOIN club_master c            ON c.pk_club_id = b.fk_club_id
            WHERE {clubFilter} AND b.fk_year_id = @YearId AND b.isdeleted = 0
              AND b.fk_designation_id IN (1, 2)
            GROUP BY m.pk_member_master_profile_id, m.MemberName, m.PrimaryMobileNumber, m.RotaryId, m.SecondaryMobileNumber, c.ClubName
            ORDER BY c.ClubName, m.MemberName", queryParams);
        foreach (var x in members)
            rows.Add(await BuildDcRowAsync(conn, configId, (int)x.id, (string)x.name, (string?)x.mobile, (string?)x.rotaryId, (string?)x.secMobile, bodKeys, SpouseNa((int)x.id), (string)x.clubName));
        return Ok(new { rows });
    }

    // District Committee data-collection report.
    //
    // Covers ALL THREE committee levels, not just the top one:
    //   1. District Committee   — district_committee_member          (district + year)
    //   2. Group Committee      — district_committee_group_member    (via group → district + year)
    //   3. Sub-Group Committee  — district_committee_sub_group_member(via sub-group → group → district + year)
    // Sub-groups carry no district/year of their own, so they inherit both through their group.
    //
    // Only member-linked rows (fk_member_id set) can appear — a typed-in non-member has no
    // member_master_profile to collect data against. Deduped: one row per person even if they
    // sit on several committees.
    //
    // District-wide by design: no clubId filter, unlike the BOD report. The district committee
    // is one list for the whole district, so this always returns all of it.
    [HttpGet("data-collection/dc")]
    public async Task<ActionResult> DataCollectionDc(int districtId, [FromQuery] int yearId, [FromQuery] int? agMemberId = null)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId))
            return StatusCode(403, new { message = "This district or its zone is inactive." });
        if (yearId <= 0) return BadRequest(new { message = "yearId is required." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var cfg = await LoadDcConfigAsync(conn, districtId, yearId);
        if (cfg == null) return Ok(new { rows = new List<object>() });
        var (configId, dcKeys, _, _) = cfg.Value;
        var spouseNaMap = await Services.DirectoryDataCollectionFields.GetSpouseNotApplicableMapAsync(conn, configId);
        bool SpouseNa(int id) => spouseNaMap.TryGetValue(id, out var f) && f;
        var rows = new List<Dictionary<string, object?>>();

        // AG scope: keep only committee members who belong to one of the AG's clubs.
        // The district committee itself is district-wide, so without this an AG would see
        // members from clubs they don't hold.
        var agClubIds = await ResolveAgScopeClubIdsAsync(conn, districtId, yearId, agMemberId);
        var agClubFilter = agClubIds == null
            ? ""
            : $@" AND EXISTS (SELECT 1 FROM club_members cmag
                              WHERE cmag.fk_member_master_profile_id = m.pk_member_master_profile_id
                                AND cmag.IsActive = 1 AND cmag.isdeleted = 0
                                AND cmag.fk_club_id IN ({(agClubIds.Count > 0 ? string.Join(",", agClubIds) : "0")}))";

        // PERF: the committee id set MUST be the driving table. Written as
        // `FROM member_master_profile m WHERE m.pk... IN (<union>)` MySQL scans the whole
        // member table (tens of thousands of rows) and runs the correlated clubName
        // subquery for every one — the query timed out. Driving from the ~20-row derived
        // set and joining to members by primary key keeps it to ~20 indexed lookups.
        var members = await conn.QueryAsync<dynamic>($@"
            SELECT m.pk_member_master_profile_id AS id, m.MemberName AS name,
                   m.PrimaryMobileNumber AS mobile, m.RotaryId AS rotaryId,
                   m.SecondaryMobileNumber AS secMobile,
                   (SELECT c2.ClubName FROM club_members cm2
                      JOIN club_master c2 ON c2.pk_club_id = cm2.fk_club_id
                     WHERE cm2.fk_member_master_profile_id = m.pk_member_master_profile_id
                       AND cm2.IsActive = 1 AND cm2.isdeleted = 0
                     ORDER BY cm2.pk_club_member_id DESC LIMIT 1) AS clubName,
                   ids.committee AS committee
            FROM (
                -- One row per member, naming every level they sit on, one per line:
                --   - District Committee
                --   - Group Committee
                --   - Sub Group Committee
                -- srt keeps them in hierarchy order. No DISTINCT: the inner UNION already
                -- collapses duplicates, and GROUP_CONCAT(DISTINCT x ORDER BY y) is an error
                -- in MySQL when the two expressions differ.
                SELECT u.mid, GROUP_CONCAT(CONCAT('- ', u.src) ORDER BY u.srt SEPARATOR '\n') AS committee
                FROM (
                    -- 1. District Committee
                    SELECT dcm.fk_member_id AS mid, 'District Committee' AS src, 1 AS srt
                    FROM district_committee_member dcm
                    WHERE dcm.fk_district_id = @D AND dcm.fk_year_id = @YearId
                      AND dcm.isdeleted = 0 AND dcm.is_active = 1
                      AND COALESCE(dcm.fk_member_id, 0) > 0
                    UNION
                    -- 2. Group Committee
                    SELECT gm.fk_member_id, 'Group Committee', 2
                    FROM district_committee_group_member gm
                    JOIN district_committee_group g ON g.id = gm.fk_group_id
                         AND g.isdeleted = 0 AND g.is_active = 1
                    WHERE g.fk_district_id = @D AND g.fk_year_id = @YearId
                      AND gm.isdeleted = 0 AND gm.is_active = 1
                      AND COALESCE(gm.fk_member_id, 0) > 0
                    UNION
                    -- 3. Sub-Group Committee (district + year inherited via the parent group)
                    SELECT sgm.fk_member_id, 'Sub Group Committee', 3
                    FROM district_committee_sub_group_member sgm
                    JOIN district_committee_sub_group sg ON sg.id = sgm.fk_sub_group_id
                         AND sg.isdeleted = 0 AND sg.is_active = 1
                    JOIN district_committee_group g2 ON g2.id = sg.fk_group_id
                         AND g2.isdeleted = 0 AND g2.is_active = 1
                    WHERE g2.fk_district_id = @D AND g2.fk_year_id = @YearId
                      AND sgm.isdeleted = 0 AND sgm.is_active = 1
                      AND COALESCE(sgm.fk_member_id, 0) > 0
                ) u
                GROUP BY u.mid
            ) ids
            JOIN member_master_profile m
                 ON m.pk_member_master_profile_id = ids.mid AND m.isdeleted = 0
            WHERE 1 = 1 {agClubFilter}
            ORDER BY m.MemberName", new { D = districtId, YearId = yearId });

        foreach (var x in members)
            rows.Add(await BuildDcRowAsync(conn, configId, (int)x.id, (string)x.name, (string?)x.mobile, (string?)x.rotaryId, (string?)x.secMobile, dcKeys, SpouseNa((int)x.id), (string)(x.clubName ?? ""), (string)(x.committee ?? "")));
        return Ok(new { rows });
    }

    // Governor's Official Visit (OCV/GOV) report — every OCV sub-module (category)
    // and its document types, per club, with the uploaded file (hyperlink) or N/A.
    // clubId → one club (Club Wise); agMemberId → that AG's clubs (AG Wise).
    [HttpGet("ocv-gov")]
    public async Task<ActionResult> GetOcvGovReport(int districtId, [FromQuery] int yearId, [FromQuery] int? clubId = null, [FromQuery] int? agMemberId = null)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId))
            return StatusCode(403, new { message = "This district or its zone is inactive." });
        if (yearId <= 0) return BadRequest(new { message = "yearId is required." });
        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Resolve target clubs: one club, or an AG's allocated clubs.
        List<int> clubIds;
        if (clubId.HasValue && clubId.Value > 0)
            clubIds = new List<int> { clubId.Value };
        else if (agMemberId.HasValue && agMemberId.Value > 0)
            clubIds = (await conn.QueryAsync<int>(
                @"SELECT a.fk_club_id FROM district_ag a
                  WHERE a.fk_member_id = @Ag AND a.fk_year_id = @YearId AND a.isdeleted = 0 AND a.is_active = 1",
                new { Ag = agMemberId.Value, YearId = yearId })).ToList();
        else
            clubIds = (await conn.QueryAsync<int>(
                $"SELECT pk_club_id FROM club_master WHERE fk_district_id = @D AND isdeleted = 0{NotRotaractUnlessSa("")}",
                new { D = districtId })).ToList();

        if (clubIds.Count == 0) return Ok(new { districtNumber = "", clubs = new List<object>() });

        var districtNumber = await conn.ExecuteScalarAsync<string>(
            "SELECT DistrictNumber FROM district_master WHERE pk_district_id = @D", new { D = districtId }) ?? "";

        // Per-club metadata for the report header block (Club Name / ID / President / AG).
        var clubMeta = (await conn.QueryAsync<dynamic>(
            @"SELECT c.pk_club_id AS clubPk, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId,
                     (SELECT m.MemberName FROM board_of_directors b
                        JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id AND m.isdeleted = 0
                        JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id
                       WHERE b.fk_club_id = c.pk_club_id AND b.fk_year_id = @YearId AND b.isdeleted = 0
                         AND dm.designation_name = 'Club President' LIMIT 1) AS presidentName,
                     (SELECT m.MemberName FROM district_ag a
                        JOIN member_master_profile m ON m.pk_member_master_profile_id = a.fk_member_id AND m.isdeleted = 0
                       WHERE a.fk_club_id = c.pk_club_id AND a.fk_year_id = @YearId AND a.isdeleted = 0 AND a.is_active = 1 LIMIT 1) AS agName
              FROM club_master c WHERE c.pk_club_id IN @ClubIds ORDER BY c.ClubName",
            new { YearId = yearId, ClubIds = clubIds })).ToList();

        // ALL categories × ALL types per club, LEFT JOIN the actual uploads → Uploaded No when absent.
        var rows = (await conn.QueryAsync<dynamic>(
            @"SELECT c.pk_club_id AS clubPk,
                     cat.CategoryName AS moduleName,
                     COALESCE(NULLIF(d.CustomTypeName, ''), t.TypeName) AS documentType,
                     CASE WHEN d.pk_document_id IS NULL THEN 0 ELSE 1 END AS uploaded,
                     CASE WHEN d.FilePath IS NULL OR d.FilePath = '' THEN NULL
                          WHEN d.FilePath LIKE '/%' THEN d.FilePath
                          ELSE CONCAT('/Documents/OCV/Group', d.fk_club_id, '/', d.FilePath) END AS downloadUrl
              FROM club_master c
              CROSS JOIN ocv_document_category cat
              JOIN ocv_document_type t ON t.fk_category_id = cat.pk_category_id AND t.isdeleted = 0 AND t.IsActive = 1
              LEFT JOIN ocv_documents d ON d.fk_club_id = c.pk_club_id AND d.fk_year_id = @YearId
                    AND d.fk_category_id = cat.pk_category_id AND d.fk_type_id = t.pk_type_id AND d.isdeleted = 0
              WHERE c.pk_club_id IN @ClubIds AND cat.IsActive = 1
              ORDER BY c.ClubName, cat.SortOrder, cat.CategoryName, t.SortOrder, t.TypeName, d.pk_document_id",
            new { YearId = yearId, ClubIds = clubIds })).ToList();

        var rowsByClub = rows.GroupBy(r => (int)r.clubPk)
            .ToDictionary(g => g.Key, g => g.Select(r => new {
                moduleName = (string)r.moduleName,
                documentType = (string)r.documentType,
                uploaded = Convert.ToInt32(r.uploaded) == 1,
                downloadUrl = (string?)r.downloadUrl,
            }).ToList());

        var clubs = clubMeta.Select(cm => new {
            clubId = (int)cm.clubPk,
            clubName = (string)cm.clubName,
            clubRotaryId = (string?)cm.clubRotaryId,
            presidentName = (string?)cm.presidentName,
            agName = (string?)cm.agName,
            rows = rowsByClub.TryGetValue((int)cm.clubPk, out var rr) ? rr : new(),
        }).ToList();

        return Ok(new { districtNumber, yearId, clubs });
    }

    // Club Officers (From RI) — live from Rotary.org /clubs/Rotary Club/{clubRotaryId}/officers
    // for the selected year's date range. One row per club with the 8 office roles.
    [HttpGet("club-officers-ri")]
    public async Task<ActionResult> GetClubOfficersFromRi(int districtId, [FromQuery] int yearId, [FromQuery] int? clubId = null, [FromQuery] int? agMemberId = null)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId))
            return StatusCode(403, new { message = "This district or its zone is inactive." });
        if (yearId <= 0) return BadRequest(new { message = "yearId is required." });
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var yr = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT StartDate, EndDate FROM rotary_year_master WHERE pk_year_id = @Y", new { Y = yearId });
        if (yr == null) return BadRequest(new { message = "Invalid year." });
        string startDate = ((DateTime)yr.StartDate).ToString("MM/dd/yyyy");
        string endDate = ((DateTime)yr.EndDate).ToString("MM/dd/yyyy");

        // AG scope — empty for District Admin, so its behaviour is unchanged.
        var agIdsRi = await ResolveAgScopeClubIdsAsync(conn, districtId, yearId, agMemberId);
        var agFilterRi = agIdsRi == null
            ? ""
            : $"AND c.pk_club_id IN ({(agIdsRi.Count > 0 ? string.Join(",", agIdsRi) : "0")})";

        // Synced clubs only (they have a Rotary.org ClubRotaryId). Optional single club.
        var clubs = (await conn.QueryAsync<dynamic>(
            $@"SELECT c.pk_club_id AS clubPk, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId,
                     COALESCE(NULLIF(c.ClubType,''),'Rotary Club') AS clubType
              FROM club_master c
              WHERE c.fk_district_id = @D AND c.isdeleted = 0{NotRotaractUnlessSa()}
                AND c.ClubRotaryId IS NOT NULL AND c.ClubRotaryId <> ''
                AND (@ClubId IS NULL OR c.pk_club_id = @ClubId)
                {agFilterRi}
              ORDER BY c.ClubName",
            new { D = districtId, ClubId = clubId })).ToList();

        // Fetch officers per club with bounded parallelism (Rotary.org is slow per call).
        var sem = new SemaphoreSlim(6);
        var tasks = clubs.Select(async c =>
        {
            await sem.WaitAsync();
            try
            {
                int rid = int.TryParse((string?)c.clubRotaryId, out var v) ? v : 0;
                var officers = rid > 0
                    ? await _rotaryOrg.GetClubOfficersAsync((string)c.clubType, rid, startDate, endDate)
                    : new List<RotaryApi.Services.RotaryOrg.RotaryOrgClubOfficerDto>();
                return (clubName: (string)c.clubName, officers);
            }
            catch { return (clubName: (string)c.clubName, officers: new List<RotaryApi.Services.RotaryOrg.RotaryOrgClubOfficerDto>()); }
            finally { sem.Release(); }
        });
        var perClub = (await Task.WhenAll(tasks)).ToList();

        // Rotary.org often omits email/mobile — fill them from our own DB by matching
        // the officer's Rotary individual id to member_master_profile.RotaryId.
        var allRids = perClub.SelectMany(x => x.officers)
            .Select(o => o.RotaryId).Where(x => !string.IsNullOrWhiteSpace(x)).Distinct().ToList();
        if (allRids.Count > 0)
        {
            var dbByRid = (await conn.QueryAsync<dynamic>(
                @"SELECT RotaryId AS rotaryId, EmailId AS email, PrimaryMobileNumber AS mobile, MemberName AS name
                  FROM member_master_profile WHERE RotaryId IN @Rids AND isdeleted = 0",
                new { Rids = allRids }))
                .GroupBy(d => (string)d.rotaryId)
                .ToDictionary(g => g.Key, g => g.First());
            foreach (var (_, officers) in perClub)
                foreach (var o in officers)
                    if (!string.IsNullOrWhiteSpace(o.RotaryId) && dbByRid.TryGetValue(o.RotaryId!, out var db))
                    {
                        if (string.IsNullOrWhiteSpace(o.Email)) o.Email = (string?)db.email;
                        if (string.IsNullOrWhiteSpace(o.Phone)) o.Phone = (string?)db.mobile;
                        if (string.IsNullOrWhiteSpace(o.Name)) o.Name = (string?)db.name;
                    }
        }

        var rows = perClub.Select(x => MapOfficerRow(x.clubName, x.officers)).ToList();
        return Ok(rows);
    }

    // Map Rotary.org officers → the 8 fixed office columns (by role-name keywords).
    private static object MapOfficerRow(string clubName, List<RotaryApi.Services.RotaryOrg.RotaryOrgClubOfficerDto> officers)
    {
        RotaryApi.Services.RotaryOrg.RotaryOrgClubOfficerDto? Find(Func<string, bool> match) =>
            officers.FirstOrDefault(o => !string.IsNullOrWhiteSpace(o.Role) && match(o.Role!.ToLowerInvariant()));
        var pres = Find(r => r.Contains("president") && !r.Contains("vice") && !r.Contains("past") && !r.Contains("elect"));
        var execSec = Find(r => r.Contains("executive secretary") || r.Contains("exec secretary"));
        var sec = Find(r => r.Contains("secretary") && !r.Contains("executive") && !r.Contains("exec"));
        var treas = Find(r => r.Contains("treasurer"));
        var found = Find(r => r.Contains("foundation"));
        var memb = Find(r => r.Contains("membership"));
        var pubImg = Find(r => r.Contains("public image") || r.Contains("public relations") || r.Contains("image"));
        var svc = Find(r => r.Contains("service project") || r.Contains("service projects") || r.Contains("projects"));
        return new
        {
            clubName,
            presidentName = pres?.Name, presidentEmail = pres?.Email, presidentMobile = pres?.Phone,
            secretaryName = sec?.Name, secretaryEmail = sec?.Email, secretaryMobile = sec?.Phone,
            execSecretaryName = execSec?.Name, execSecretaryMobile = execSec?.Phone, execSecretaryEmail = execSec?.Email,
            treasurerName = treas?.Name, treasurerEmail = treas?.Email, treasurerMobile = treas?.Phone,
            foundationChairName = found?.Name, foundationChairEmail = found?.Email, foundationChairMobile = found?.Phone,
            membershipChairName = memb?.Name, membershipChairEmail = memb?.Email, membershipChairMobile = memb?.Phone,
            publicImageChairName = pubImg?.Name, publicImageChairEmail = pubImg?.Email, publicImageChairMobile = pubImg?.Phone,
            serviceProjectsChairName = svc?.Name, serviceProjectsChairEmail = svc?.Email, serviceProjectsChairMobile = svc?.Phone,
        };
    }

    [HttpGet("available-years")]
    public async Task<ActionResult> GetAvailableYears(int districtId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var clubIds = (await conn.QueryAsync<int>(
            $"SELECT pk_club_id FROM club_master WHERE fk_district_id = @D AND isdeleted = 0{NotRotaractUnlessSa("")}",
            new { D = districtId })).ToList();
        var clubIdCsv = clubIds.Count > 0 ? string.Join(",", clubIds) : "0";

        // Year-wise projects: for each existing year table, emit its year_id if any matching row exists.
        var projectTables = await _yearTables.GetAllExistingYearTablesAsync(conn);
        var yearProjLegs = projectTables.Count == 0 ? "SELECT NULL AS fk_year_id WHERE 1=0" :
            string.Join(" UNION ", projectTables.Select(t =>
                $"(SELECT {t.YearId} AS fk_year_id FROM `{t.ProjectsTable}` WHERE isdeleted = 0 AND (fk_district_id = @D OR fk_club_id IN ({clubIdCsv})) LIMIT 1)"));

        var years = await conn.QueryAsync<dynamic>($@"
            SELECT DISTINCT y.pk_year_id AS id, y.YearLabel AS yearLabel, y.IsCurrent AS isCurrent
            FROM rotary_year_master y
            WHERE y.pk_year_id IN (
                SELECT fk_year_id FROM ({yearProjLegs}) yp
                UNION SELECT y2.pk_year_id FROM rotary_year_master y2
                       JOIN announcements a ON a.PublishDateTime >= y2.StartDate AND a.PublishDateTime < DATE_ADD(y2.EndDate, INTERVAL 1 DAY)
                       WHERE a.isdeleted = 0 AND (a.fk_district_id = @D OR a.fk_club_id IN ({clubIdCsv}))
                UNION SELECT y3.pk_year_id FROM rotary_year_master y3
                       JOIN upcoming_events e ON e.PublishDate >= y3.StartDate AND e.PublishDate < DATE_ADD(y3.EndDate, INTERVAL 1 DAY)
                       WHERE e.isdeleted = 0 AND (e.fk_district_id = @D OR e.fk_club_id IN ({clubIdCsv}))
                UNION SELECT y4.pk_year_id FROM rotary_year_master y4
                       JOIN newsletters n ON n.PublishDateTime >= y4.StartDate AND n.PublishDateTime < DATE_ADD(y4.EndDate, INTERVAL 1 DAY)
                       WHERE n.isdeleted = 0 AND (n.fk_district_id = @D OR n.fk_club_id IN ({clubIdCsv}))
                UNION SELECT fk_year_id FROM club_attendance WHERE isdeleted = 0 AND fk_club_id IN ({clubIdCsv})
                UNION SELECT fk_year_id FROM board_of_directors WHERE isdeleted = 0 AND fk_club_id IN ({clubIdCsv})
                UNION SELECT fk_year_id FROM district_governors WHERE fk_district_id = @D AND isdeleted = 0
                UNION SELECT fk_year_id FROM district_committee_member WHERE fk_district_id = @D AND isdeleted = 0
                UNION SELECT fk_year_id FROM club_monthly_reports WHERE isdeleted = 0 AND fk_club_id IN ({clubIdCsv})
            )
            OR y.IsCurrent = 1
            ORDER BY y.pk_year_id DESC",
            new { D = districtId });
        return Ok(years);
    }

    // ───────────────────────────────────────────────────────────────────
    // Avenue Of Service (All Clubs) — flat per-project list for the year
    // across every club in the district. Mirrors the wide column set used
    // by the V2 club-report page (Type of Project, Your Club Role, etc.)
    // so the District Admin's Excel matches the per-club Excel format.
    // ───────────────────────────────────────────────────────────────────
    [HttpGet("avenue-of-service-all-clubs")]
    public async Task<ActionResult> AvenueOfServiceAllClubs(int districtId, [FromQuery] int yearId, [FromQuery] int? agMemberId = null)
    {
        _logger.LogInformation("AvenueOfServiceAllClubs: district={DistrictId} year={YearId}", districtId, yearId);
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId))
            return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        if (yearId <= 0) return BadRequest(new { message = "yearId is required." });

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var pInfo = await _yearTables.ResolveByYearIdAsync(conn, yearId);
        if (pInfo == null)
        {
            _logger.LogWarning("AvenueOfServiceAllClubs: no year-wise projects table for yearId={YearId}; returning empty.", yearId);
            return Ok(Array.Empty<object>());
        }

        // AG scope — empty for District Admin, so its behaviour is unchanged.
        var agIdsAv = await ResolveAgScopeClubIdsAsync(conn, districtId, yearId, agMemberId);
        var agFilterAv = agIdsAv == null
            ? ""
            : $"AND c.pk_club_id IN ({(agIdsAv.Count > 0 ? string.Join(",", agIdsAv) : "0")})";

        // All five avenues are included (Club Service + Community + Vocational
        // + International + Public Image). The "Type of Project" column carries
        // the avenue label for filtering in Excel.
        var rows = await conn.QueryAsync<dynamic>($@"
            SELECT c.ClubName               AS clubName,
                   d.DistrictNumber         AS districtNumber,
                   mm.ModuleName            AS typeOfProject,
                   mm.ModuleKey             AS moduleKey,
                   p.club_role              AS clubRole,
                   p.co_host_name           AS coHostName,
                   af.name                  AS areaOfFocus,
                   cat.name                 AS category,
                   sc.name                  AS subCategory,
                   p.project_date           AS projectDate,
                   p.title                  AS title,
                   p.description            AS description,
                   p.location               AS location,
                   p.project_cost           AS projectCost,
                   f.name                   AS funding,
                   p.global_grant_number    AS globalGrantNumber,
                   p.csr_company_name       AS csrCompanyName,
                   p.amount_sanctioned      AS amountSanctioned,
                   p.amount_received        AS amountReceived,
                   p.project_cost           AS amountSpent,
                   p.host_clubs_districts   AS hostClubsDistricts,
                   p.global_partner_clubs_districts AS globalPartners,
                   p.direct_beneficiaries   AS beneficiaries,
                   p.man_hours              AS manHours,
                   p.rotarians_involved     AS rotariansInvolved,
                   CONCAT('{_frontendUrl}/public/project/', p.pk_project_id, '?year={yearId}') AS publicPhotoUrl
            FROM `{pInfo.ProjectsTable}` p
            JOIN club_master c        ON c.pk_club_id = p.fk_club_id AND c.isdeleted = 0
            JOIN district_master d    ON d.pk_district_id = c.fk_district_id
            JOIN module_master mm     ON mm.pk_module_id = p.fk_module_id
            LEFT JOIN area_of_focus_master af ON af.pk_area_of_focus_id = p.fk_area_of_focus_id
            LEFT JOIN category_master cat     ON cat.pk_category_id = p.fk_category_id
            LEFT JOIN sub_category_master sc  ON sc.pk_sub_category_id = p.fk_sub_category_id
            LEFT JOIN funding_master f        ON f.pk_funding_id = p.fk_funding_id
            WHERE c.fk_district_id = @D
              AND p.isdeleted = 0
              {agFilterAv}
            ORDER BY c.ClubName, p.project_date DESC, p.pk_project_id DESC",
            new { D = districtId });
        return Ok(rows);
    }

    // ───────────────────────────────────────────────────────────────────
    // Avenue Of Service (Club Wise Count) — one row per club with project
    // count for the year, EXCLUDING club_service per spec. Used by the
    // District Admin's egov Reports tab to give a quick scorecard.
    // ───────────────────────────────────────────────────────────────────
    [HttpGet("avenue-of-service-club-count")]
    public async Task<ActionResult> AvenueOfServiceClubCount(int districtId, [FromQuery] int yearId, [FromQuery] int? agMemberId = null)
    {
        _logger.LogInformation("AvenueOfServiceClubCount: district={DistrictId} year={YearId}", districtId, yearId);
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId))
            return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        if (yearId <= 0) return BadRequest(new { message = "yearId is required." });

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var pInfo = await _yearTables.ResolveByYearIdAsync(conn, yearId);
        if (pInfo == null)
        {
            _logger.LogWarning("AvenueOfServiceClubCount: no year-wise projects table for yearId={YearId}; returning empty.", yearId);
            return Ok(Array.Empty<object>());
        }

        // AG scope — empty string for District Admin, so its behaviour is unchanged.
        var agIds = await ResolveAgScopeClubIdsAsync(conn, districtId, yearId, agMemberId);
        var agFilter = agIds == null
            ? ""
            : $"AND c.pk_club_id IN ({(agIds.Count > 0 ? string.Join(",", agIds) : "0")})";

        // LEFT JOIN to projects so every club shows (count=0 when no projects).
        // module.ModuleKey='club_service' is explicitly excluded from the count.
        var rows = await conn.QueryAsync<dynamic>($@"
            SELECT c.pk_club_id          AS clubId,
                   d.DistrictNumber      AS districtNumber,
                   c.ClubName            AS clubName,
                   COUNT(p.pk_project_id) AS projectCount
            FROM club_master c
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            LEFT JOIN `{pInfo.ProjectsTable}` p
                ON p.fk_club_id = c.pk_club_id
               AND p.isdeleted = 0
               AND p.fk_module_id IN (SELECT pk_module_id FROM module_master WHERE ModuleKey <> 'club_service')
            WHERE c.fk_district_id = @D AND c.isdeleted = 0{NotRotaractUnlessSa()} {agFilter}
            GROUP BY c.pk_club_id, d.DistrictNumber, c.ClubName
            ORDER BY c.ClubName",
            new { D = districtId });
        return Ok(rows);
    }
}
