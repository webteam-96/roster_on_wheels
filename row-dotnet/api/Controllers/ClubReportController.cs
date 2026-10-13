using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/clubs/{clubId}/club-report")]
[Authorize]
public class ClubReportController : ControllerBase
{
    private readonly string _connectionString;
    private readonly IYearTableResolver _yearTables;
    private readonly string _frontendUrl;
    private readonly IWebHostEnvironment _env;
    private readonly IClubMonthlyReportService _cmr;
    private readonly string? _mediaRedirectBase;
    private readonly string _mediaBaseForLinks;
    private readonly RotaryApi.Services.ICurrencyRateService _fx;

    public ClubReportController(IConfiguration config, IYearTableResolver yearTables, IWebHostEnvironment env, IClubMonthlyReportService cmr, RotaryApi.Services.ICurrencyRateService fx)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        _yearTables = yearTables;
        _frontendUrl = (config["FrontendUrl"] ?? RotaryApi.Services.Brand.PortalOrigin).TrimEnd('/');
        _env = env;
        _cmr = cmr;
        _fx = fx;
        _mediaRedirectBase = config["Media:RedirectBaseUrl"];
        _mediaBaseForLinks = !string.IsNullOrWhiteSpace(_mediaRedirectBase) ? _mediaRedirectBase! : (config["Api:BaseUrl"] ?? "");
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    // The currency a club's project-cost totals are expressed in (its district DefaultCurrency,
    // or a country-based guess). Per-project rows keep their own currency.
    private static async Task<string> ResolveClubDistrictCurrencyAsync(MySqlConnection conn, int clubId)
    {
        var row = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT d.DefaultCurrency AS DefaultCurrency, d.Country AS Country
            FROM club_master c JOIN district_master d ON d.pk_district_id = c.fk_district_id
            WHERE c.pk_club_id = @C LIMIT 1", new { C = clubId });
        return RotaryApi.Services.CurrencyHelper.ResolveDefaultCurrency(row?.DefaultCurrency as string, row?.Country as string);
    }

    // ── Attendance (Member Wise) MATRIX ──────────────────────────────────────
    // Rows = active club members, columns = each meeting/event of the year.
    // Cell = did the member attend (present) or not. Feeds the styled Excel export
    // on the Reports tab (P = Present, A = Absent), mirroring the legacy layout.
    public class AttendanceMatrixEventDto { public int Id { get; set; } public string Name { get; set; } = ""; public DateTime? DateTime { get; set; } }
    public class AttendanceMatrixMemberDto { public string MemberName { get; set; } = ""; public List<bool> Present { get; set; } = new(); }
    public class AttendanceMatrixDto
    {
        public string ClubName { get; set; } = "";
        public string YearLabel { get; set; } = "";
        public List<AttendanceMatrixEventDto> Events { get; set; } = new();
        public List<AttendanceMatrixMemberDto> Members { get; set; } = new();
    }

    [HttpGet("attendance-matrix")]
    public async Task<ActionResult<AttendanceMatrixDto>> GetAttendanceMatrix(int clubId, [FromQuery] int yearId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        if (yearId <= 0) return BadRequest(new { message = "yearId is required." });

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var clubName = await conn.ExecuteScalarAsync<string?>(
            "SELECT ClubName FROM club_master WHERE pk_club_id = @C AND isdeleted = 0", new { C = clubId }) ?? "";
        var yearLabel = await conn.ExecuteScalarAsync<string?>(
            "SELECT YearLabel FROM rotary_year_master WHERE pk_year_id = @Y", new { Y = yearId }) ?? "";

        // Events (columns), oldest first.
        var events = (await conn.QueryAsync<AttendanceMatrixEventDto>(@"
            SELECT a.pk_attendance_id AS Id, a.EventName AS Name, a.EventDateTime AS DateTime
            FROM club_attendance a
            WHERE a.fk_club_id = @C AND a.fk_year_id = @Y AND a.isdeleted = 0
            ORDER BY a.EventDateTime, a.pk_attendance_id",
            new { C = clubId, Y = yearId })).ToList();

        // Active members (rows), A→Z.
        var members = (await conn.QueryAsync<dynamic>(@"
            SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS memberName
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            WHERE cm.fk_club_id = @C AND cm.IsActive = 1 AND cm.isdeleted = 0
            ORDER BY m.MemberName",
            new { C = clubId })).ToList();

        // All (member, event) attendance pairs for this club + year.
        var pairs = (await conn.QueryAsync<dynamic>(@"
            SELECT am.fk_member_id AS memberId, am.fk_attendance_id AS attendanceId
            FROM club_attendance_members am
            JOIN club_attendance a ON a.pk_attendance_id = am.fk_attendance_id
            WHERE a.fk_club_id = @C AND a.fk_year_id = @Y AND a.isdeleted = 0",
            new { C = clubId, Y = yearId })).ToList();

        var presentByMember = new Dictionary<int, HashSet<int>>();
        foreach (var p in pairs)
        {
            int mid = Convert.ToInt32(p.memberId);
            int aid = Convert.ToInt32(p.attendanceId);
            if (!presentByMember.TryGetValue(mid, out var set)) { set = new HashSet<int>(); presentByMember[mid] = set; }
            set.Add(aid);
        }

        var eventIds = events.Select(e => e.Id).ToList();
        var memberDtos = new List<AttendanceMatrixMemberDto>();
        foreach (var m in members)
        {
            int mid = Convert.ToInt32(m.memberId);
            presentByMember.TryGetValue(mid, out var set);
            var present = eventIds.Select(eid => set != null && set.Contains(eid)).ToList();
            memberDtos.Add(new AttendanceMatrixMemberDto { MemberName = (string)(m.memberName ?? ""), Present = present });
        }

        return Ok(new AttendanceMatrixDto { ClubName = clubName, YearLabel = yearLabel, Events = events, Members = memberDtos });
    }

    [HttpGet]
    public async Task<ActionResult> GetReport(int clubId, [FromQuery] int yearId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        if (yearId <= 0) return BadRequest(new { message = "yearId is required." });

        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Club info
        var club = await conn.QueryFirstOrDefaultAsync<dynamic>(
            @"SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId,
                     c.fk_district_id AS fkDistrictId,
                     CASE
                         WHEN c.ClubLogoPath IS NULL OR c.ClubLogoPath = '' THEN NULL
                         WHEN c.ClubLogoPath LIKE '/%' THEN c.ClubLogoPath
                         ELSE CONCAT('/uploads/club/', c.ClubLogoPath)
                     END AS clubLogo,
                     c.City AS city, c.State AS state,
                     d.DistrictNumber AS districtNumber
              FROM club_master c
              JOIN district_master d ON d.pk_district_id = c.fk_district_id
              WHERE c.pk_club_id = @Id AND c.isdeleted = 0",
            new { Id = clubId });
        if (club == null) return NotFound(new { message = "Club not found." });

        var year = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT pk_year_id AS id, YearLabel AS yearLabel FROM rotary_year_master WHERE pk_year_id = @Id",
            new { Id = yearId });

        // All projects grouped by module — year-wise: resolve the single year's table.
        var info = await _yearTables.ResolveByYearIdAsync(conn, yearId);
        var projects = new List<dynamic>();
        if (info != null)
        {
            projects = (await conn.QueryAsync<dynamic>($@"
                SELECT p.pk_project_id AS id, p.title, p.description, p.project_date AS projectDate,
                       p.project_cost AS projectCost, COALESCE(p.Currency, '{RotaryApi.Services.Brand.SqlCurrency}') AS currency, p.direct_beneficiaries AS directBeneficiaries,
                       p.man_hours AS manHours, p.rotarians_involved AS rotariansInvolved,
                       p.rotaractors_involved AS rotaractorsInvolved,
                       COALESCE(p.rcc_involved,0) AS rccInvolved, p.location,
                       af.name AS areaOfFocus, cat.name AS category, sc.name AS subCategory,
                       f.name AS funding, mm.ModuleName AS moduleName, mm.ModuleKey AS moduleKey,
                       p.approval_status AS approvalStatus,
                       /* Shareable public photo page — used as Excel HYPERLINK
                          target in the Photos column of each service-module table. */
                       CONCAT('{_frontendUrl}/public/project/', p.pk_project_id, '?year={yearId}') AS publicPhotoUrl
                FROM `{info.ProjectsTable}` p
                LEFT JOIN area_of_focus_master af ON af.pk_area_of_focus_id = p.fk_area_of_focus_id
                LEFT JOIN category_master cat ON cat.pk_category_id = p.fk_category_id
                LEFT JOIN sub_category_master sc ON sc.pk_sub_category_id = p.fk_sub_category_id
                LEFT JOIN funding_master f ON f.pk_funding_id = p.fk_funding_id
                LEFT JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
                WHERE p.fk_club_id = @ClubId AND p.isdeleted = 0
                ORDER BY p.project_date DESC",
                new { ClubId = clubId })).ToList();
        }

        // Group projects by moduleKey
        var projectsByModule = projects.GroupBy(p => (string?)p.moduleKey ?? "other")
            .ToDictionary(g => g.Key, g => g.ToList());

        // Announcements
        var announcements = await conn.QueryAsync<dynamic>(@"
            SELECT a.Title AS title, a.Description AS description, a.PublishDateTime AS publishDate,
                   a.ExpiryDateTime AS expiryDate, a.IsSendWhatsapp AS isSendWhatsapp, a.IsDisplayOnBanner AS isDisplayOnBanner,
                   CASE
                       WHEN a.ImagePath IS NULL OR a.ImagePath = '' THEN NULL
                       WHEN a.ImagePath LIKE '/%' THEN a.ImagePath
                       WHEN a.Scope = 'ri' THEN CONCAT('/Documents/announcement/ri/', a.ImagePath)
                       WHEN a.fk_district_id IS NOT NULL THEN CONCAT('/Documents/announcement/Group', a.fk_district_id, '/', a.ImagePath)
                       ELSE CONCAT('/Documents/announcement/Group', a.fk_club_id, '/', a.ImagePath)
                   END AS imagePath,
                   CASE WHEN NOW() < a.PublishDateTime THEN 'Unpublished'
                        WHEN NOW() > a.ExpiryDateTime THEN 'Expired' ELSE 'Published' END AS status
            FROM announcements a
            JOIN rotary_year_master y ON y.pk_year_id = @YearId
            WHERE a.fk_club_id = @ClubId AND a.isdeleted = 0
              AND a.PublishDateTime >= y.StartDate
              AND a.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
            ORDER BY a.PublishDateTime DESC",
            new { ClubId = clubId, YearId = yearId });

        // Upcoming Events
        var events = await conn.QueryAsync<dynamic>(@"
            SELECT e.Title AS title, e.Description AS description, e.EventDate AS eventDate,
                   e.EventVenue AS eventVenue, e.PublishDate AS publishDate, e.ExpiryDate AS expiryDate,
                   e.RegistrationLink AS registrationLink, e.IsSendWhatsapp AS isSendWhatsapp,
                   CASE
                       WHEN e.ImagePath IS NULL OR e.ImagePath = '' THEN NULL
                       WHEN e.ImagePath LIKE '/%' THEN e.ImagePath
                       ELSE CONCAT('/Documents/Event/Group', e.fk_club_id, '/', e.ImagePath)
                   END AS imagePath,
                   CASE WHEN NOW() < e.PublishDate THEN 'Unpublished'
                        WHEN NOW() > e.ExpiryDate THEN 'Expired' ELSE 'Published' END AS status
            FROM upcoming_events e
            JOIN rotary_year_master y ON y.pk_year_id = @YearId
            WHERE e.fk_club_id = @ClubId AND e.isdeleted = 0
              AND e.PublishDate >= y.StartDate
              AND e.PublishDate < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
            ORDER BY e.EventDate DESC",
            new { ClubId = clubId, YearId = yearId });

        // Newsletters
        var newsletters = await conn.QueryAsync<dynamic>(@"
            SELECT n.Title AS title, n.PublishDateTime AS publishDate, n.ExpiryDateTime AS expiryDate,
                   n.AttachmentType AS attachmentType, n.LinkUrl AS linkUrl,
                   CASE
                       WHEN n.FilePath IS NULL OR n.FilePath = '' THEN NULL
                       WHEN n.FilePath LIKE '/%' THEN n.FilePath
                       WHEN n.Scope = 'ri' THEN CONCAT('/Documents/ebulletin/ri/', n.FilePath)
                       WHEN n.fk_district_id IS NOT NULL AND n.fk_district_id > 0 THEN CONCAT('/Documents/ebulletin/Group', n.fk_district_id, '/', n.FilePath)
                       WHEN n.fk_club_id IS NOT NULL AND n.fk_club_id > 0 THEN CONCAT('/Documents/ebulletin/Group', n.fk_club_id, '/', n.FilePath)
                       ELSE NULL
                   END AS filePath,
                   n.IsSendWhatsapp AS isSendWhatsapp,
                   CASE WHEN NOW() < n.PublishDateTime THEN 'Unpublished'
                        WHEN NOW() > n.ExpiryDateTime THEN 'Expired' ELSE 'Published' END AS status
            FROM newsletters n
            JOIN rotary_year_master y ON y.pk_year_id = @YearId
            WHERE n.fk_club_id = @ClubId AND n.isdeleted = 0
              AND n.PublishDateTime >= y.StartDate
              AND n.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
            ORDER BY n.PublishDateTime DESC",
            new { ClubId = clubId, YearId = yearId });

        // Documents — club_documents has no fk_year_id; filter by the rotary year's date range
        // (same approach as announcements/events above).
        var documents = await conn.QueryAsync<dynamic>(@"
            SELECT d.Title AS title, d.AccessType AS accessType,
                   CASE
                       WHEN d.FilePath IS NULL OR d.FilePath = '' THEN NULL
                       WHEN d.FilePath LIKE '/%' THEN d.FilePath
                       WHEN d.Scope = 'ri' THEN CONCAT('/Documents/documentsafe/ri/', d.FilePath)
                       WHEN d.fk_district_id IS NOT NULL THEN CONCAT('/Documents/documentsafe/Group', d.fk_district_id, '/', d.FilePath)
                       ELSE CONCAT('/Documents/documentsafe/Group', d.fk_club_id, '/', d.FilePath)
                   END AS filePath,
                   d.PublishDateTime AS publishDate, d.ExpiryDateTime AS expiryDate
            FROM club_documents d
            JOIN rotary_year_master y ON y.pk_year_id = @YearId
            WHERE d.fk_club_id = @ClubId AND d.isdeleted = 0
              AND d.PublishDateTime >= y.StartDate
              AND d.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
            ORDER BY d.PublishDateTime DESC",
            new { ClubId = clubId, YearId = yearId });

        // Attendance
        var activeMemberCount = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM club_members WHERE fk_club_id = @C AND IsActive = 1 AND isdeleted = 0",
            new { C = clubId });
        var attendance = (await conn.QueryAsync<dynamic>(@"
            SELECT a.EventName AS eventName, a.EventDateTime AS eventDateTime,
                   (SELECT COUNT(*) FROM club_attendance_members m WHERE m.fk_attendance_id = a.pk_attendance_id) AS membersPresent,
                   (SELECT COUNT(*) FROM club_attendance_visitors v WHERE v.fk_attendance_id = a.pk_attendance_id) AS visitors,
                   (SELECT COUNT(*) FROM club_attendance_rotarians r WHERE r.fk_attendance_id = a.pk_attendance_id) AS rotarians,
                   @Total AS totalMembers,
                   ROUND((SELECT COUNT(*) FROM club_attendance_members m WHERE m.fk_attendance_id = a.pk_attendance_id) * 100.0 / NULLIF(@Total, 0), 1) AS attendancePercent
            FROM club_attendance a
            WHERE a.fk_club_id = @ClubId AND a.fk_year_id = @YearId AND a.isdeleted = 0
            ORDER BY a.EventDateTime DESC",
            new { ClubId = clubId, YearId = yearId, Total = activeMemberCount })).ToList();

        // BOD — extended with club name + Auto/Manual source for the report listing.
        var bod = await conn.QueryAsync<dynamic>(@"
            SELECT (SELECT ClubName FROM club_master WHERE pk_club_id = @ClubId) AS clubName,
                   m.MemberName AS memberName, m.PrimaryMobileNumber AS mobile, m.EmailId AS email,
                   CASE
                       WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                       WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                       ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                   END AS profilePhoto,
                   dm.designation_name AS designation, dm.sort_order AS sortOrder,
                   COALESCE(b.SyncSource, 'Manual') AS autoManual
            FROM board_of_directors b
            JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id
            JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id
            WHERE b.fk_club_id = @ClubId AND b.fk_year_id = @YearId AND b.isdeleted = 0
            ORDER BY dm.sort_order",
            new { ClubId = clubId, YearId = yearId });

        // Members (active) — extended with every field the All-Members report needs.
        // Designation + Classification live on club_members (Step 11B migration).
        // RI Admission Date = club_members.JoinedDate (per-club). Address comes
        // from the most recent Residence row. Country is joined via country_master.
        var members = await conn.QueryAsync<dynamic>(@"
            SELECT (SELECT ClubName FROM club_master WHERE pk_club_id = @ClubId) AS clubName,
                   m.MemberName AS memberName,
                   CASE
                       WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                       WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                       ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                   END AS profilePhoto,
                   cm.ClassificationProfession AS classification,
                   cm.Designation              AS clubDesignation,
                   CASE WHEN cm.IsHonoraryMember = 1 THEN 'Honorary' ELSE 'Active' END AS memberType,
                   (SELECT cy.CountryName
                      FROM member_address_details ad
                      LEFT JOIN country_master cy ON cy.pk_country_id = ad.fk_country_id
                     WHERE ad.fk_member_master_profile_id = m.pk_member_master_profile_id
                       AND ad.AddressType = 'Residence'
                       AND COALESCE(ad.isdeleted, 0) = 0
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
                              NULLIF(ad.State,''),   NULLIF(ad.PinCode,''))
                      FROM member_address_details ad
                     WHERE ad.fk_member_master_profile_id = m.pk_member_master_profile_id
                       AND ad.AddressType = 'Residence'
                       AND COALESCE(ad.isdeleted, 0) = 0
                     ORDER BY ad.pk_member_address_details_id DESC LIMIT 1) AS address,
                   (SELECT CONCAT_WS(', ',
                              NULLIF(ad.Address,''), NULLIF(ad.City,''),
                              NULLIF(ad.State,''),   NULLIF(ad.PinCode,''))
                      FROM member_address_details ad
                     WHERE ad.fk_member_master_profile_id = m.pk_member_master_profile_id
                       AND ad.AddressType = 'Business'
                       AND COALESCE(ad.isdeleted, 0) = 0
                     ORDER BY ad.pk_member_address_details_id DESC LIMIT 1) AS businessAddress,
                   m.RotaryId AS rotaryId,
                   " + CogDesignationHelper.JoinedDateExpr("cm") + @" AS riAdmissionDate,
                   " + CogDesignationHelper.SelectColumns("cm") + @",
                   m.BirthDate AS birthDate,
                   m.AnniversaryDate AS anniversaryDate
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0
            ORDER BY m.MemberName",
            new { ClubId = clubId });

        // Mobile-app active users — every active member of this club who has
        // ever signed into the mobile app (LastDeviceName populated). One row
        // per member; latest device wins.
        var appUsers = await conn.QueryAsync<dynamic>(@"
            SELECT m.MemberName AS memberName, m.PrimaryMobileNumber AS mobile,
                   m.EmailId AS email, m.LastDeviceName AS deviceName
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0
              AND m.LastDeviceName IS NOT NULL AND m.LastDeviceName <> ''
            ORDER BY m.MemberName",
            new { ClubId = clubId });

        // Family details — one row per family relation per active member. Includes
        // the member's own contact fields + the family relation's own contact
        // fields. Member's residence address is joined for context.
        var family = await conn.QueryAsync<dynamic>(@"
            SELECT (SELECT ClubName FROM club_master WHERE pk_club_id = @ClubId) AS clubName,
                   m.MemberName AS memberName,
                   m.PrimaryMobileNumber AS mobile,
                   m.EmailId AS email,
                   m.BirthDate AS dob,
                   m.AnniversaryDate AS doa,
                   m.RotaryId AS rotaryId,
                   (SELECT CONCAT_WS(', ',
                              NULLIF(ad.Address,''), NULLIF(ad.City,''),
                              NULLIF(ad.State,''),   NULLIF(ad.PinCode,''))
                      FROM member_address_details ad
                     WHERE ad.fk_member_master_profile_id = m.pk_member_master_profile_id
                       AND ad.AddressType = 'Residence'
                       AND COALESCE(ad.isdeleted, 0) = 0
                     ORDER BY ad.pk_member_address_details_id DESC LIMIT 1) AS address,
                   f.Relation        AS familyRelation,
                   f.Name            AS familyName,
                   f.PhoneNumber     AS familyMobile,
                   f.EmailId         AS familyEmail,
                   f.BirthDate       AS familyDob,
                   f.AnniversaryDate AS familyAnniversary,
                   f.BloodGroup      AS familyBloodGroup
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            JOIN member_family_details f ON f.fk_member_master_profile_id = m.pk_member_master_profile_id
                                        AND COALESCE(f.isdeleted, 0) = 0
            WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0
            ORDER BY m.MemberName, f.Relation",
            new { ClubId = clubId });

        // Blood Group report — an emergency call-list of EVERY person (the member AND
        // each of their family members) with their own blood group + a contact number.
        // Member row first, then that member's family rows (sortFamily 0→1), grouped by
        // member name. A UNION ALL so members with no family still appear. Flat + sortable
        // so the user can filter by Blood Group in Excel and phone whoever matches.
        var bloodGroups = await conn.QueryAsync<dynamic>(@"
            SELECT c.ClubName AS clubName, d.DistrictNumber AS districtNumber,
                   m.MemberName AS ownerName, 'Member' AS relation,
                   m.MemberName AS personName, m.PrimaryMobileNumber AS mobile,
                   m.EmailId AS email, m.BloodGroup AS bloodGroup,
                   m.MemberName AS sortName, 0 AS sortFamily
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0
              AND COALESCE(m.BloodGroup,'') <> ''
            UNION ALL
            SELECT c.ClubName AS clubName, d.DistrictNumber AS districtNumber,
                   m.MemberName AS ownerName, COALESCE(NULLIF(f.Relation,''),'Family') AS relation,
                   f.Name AS personName, f.PhoneNumber AS mobile,
                   f.EmailId AS email, f.BloodGroup AS bloodGroup,
                   m.MemberName AS sortName, 1 AS sortFamily
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            JOIN member_family_details f ON f.fk_member_master_profile_id = m.pk_member_master_profile_id AND COALESCE(f.isdeleted,0) = 0
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0
              AND COALESCE(f.BloodGroup,'') <> ''
            ORDER BY sortName, sortFamily, personName",
            new { ClubId = clubId });

        // ROW: family and blood-group lists follow member.familyDetails / member.bloodGroup (off on ROW).
        if (!RotaryApi.Services.Brand.Feature("member.familyDetails")) family = Enumerable.Empty<dynamic>();
        if (!RotaryApi.Services.Brand.Feature("member.bloodGroup")) bloodGroups = Enumerable.Empty<dynamic>();

        // ── CLUBS SUBSECTION REPORTS ────────────────────────────────────
        // Each report mirrors the column set of its legacy example.org
        // counterpart so the migrated workbooks look identical — only the
        // visual design improves on the frontend export side.

        // Attendance (Meeting Wise) — one row per meeting with aggregate stats.
        var attendanceMeetingWise = (await conn.QueryAsync<dynamic>(@"
            SELECT a.EventDateTime AS date,
                   a.EventName     AS title,
                   a.Description   AS description,
                   (SELECT COUNT(*) FROM club_attendance_members m WHERE m.fk_attendance_id = a.pk_attendance_id) AS membersPresent,
                   @Total AS totalMembers,
                   ROUND((SELECT COUNT(*) FROM club_attendance_members m WHERE m.fk_attendance_id = a.pk_attendance_id) * 100.0 / NULLIF(@Total, 0), 2) AS attendancePercent,
                   (SELECT COUNT(*) FROM club_attendance_anns      x WHERE x.fk_attendance_id = a.pk_attendance_id) AS anns,
                   (SELECT COUNT(*) FROM club_attendance_annets    x WHERE x.fk_attendance_id = a.pk_attendance_id) AS annets,
                   (SELECT COUNT(*) FROM club_attendance_visitors  x WHERE x.fk_attendance_id = a.pk_attendance_id) AS visitors,
                   (SELECT COUNT(*) FROM club_attendance_rotarians x WHERE x.fk_attendance_id = a.pk_attendance_id) AS rotarians,
                   (SELECT COUNT(*) FROM club_attendance_delegates x WHERE x.fk_attendance_id = a.pk_attendance_id) AS delegates
            FROM club_attendance a
            WHERE a.fk_club_id = @ClubId AND a.fk_year_id = @YearId AND a.isdeleted = 0
            ORDER BY a.EventDateTime DESC",
            new { ClubId = clubId, YearId = yearId, Total = activeMemberCount })).ToList();

        // Attendance (Member Wise) — one row per active member with totals.
        var attendanceMemberWise = (await conn.QueryAsync<dynamic>(@"
            SELECT m.MemberName AS memberName,
                   m.PrimaryMobileNumber AS mobile,
                   m.EmailId AS email,
                   (SELECT COUNT(*) FROM club_attendance_members am
                      JOIN club_attendance a ON a.pk_attendance_id = am.fk_attendance_id
                     WHERE am.fk_member_id = m.pk_member_master_profile_id
                       AND a.fk_club_id = @ClubId AND a.fk_year_id = @YearId AND a.isdeleted = 0) AS meetingsAttended,
                   (SELECT COUNT(*) FROM club_attendance a
                     WHERE a.fk_club_id = @ClubId AND a.fk_year_id = @YearId AND a.isdeleted = 0) AS totalMeetings,
                   ROUND(
                       (SELECT COUNT(*) FROM club_attendance_members am
                          JOIN club_attendance a ON a.pk_attendance_id = am.fk_attendance_id
                         WHERE am.fk_member_id = m.pk_member_master_profile_id
                           AND a.fk_club_id = @ClubId AND a.fk_year_id = @YearId AND a.isdeleted = 0) * 100.0 /
                       NULLIF((SELECT COUNT(*) FROM club_attendance a
                                WHERE a.fk_club_id = @ClubId AND a.fk_year_id = @YearId AND a.isdeleted = 0), 0),
                       2
                   ) AS attendancePercent
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0
            ORDER BY m.MemberName",
            new { ClubId = clubId, YearId = yearId })).ToList();

        // Club Dues — documents uploaded by the club (the legacy report listed
        // every document with Type / Name / Uploaded / Paid / Amount).
        var clubDues = (await conn.QueryAsync<dynamic>(@"
            SELECT d.Title AS documentType,
                   COALESCE(d.OriginalFileName, d.FilePath) AS documentName,
                   d.created_date AS uploadedOn,
                   d.PublishDateTime AS paidOn,
                   /* legacy Amount column not present on club_documents — sent as NULL */
                   CAST(NULL AS DECIMAL(15,2)) AS amount
            FROM club_documents d
            WHERE d.fk_club_id = @ClubId AND d.isdeleted = 0
            ORDER BY d.created_date DESC",
            new { ClubId = clubId })).ToList();

        // Club Dues (OCV) — one amount per dues document type for THIS club + year, mirroring the
        // district "Club Dues" report so the club admin sees the same dues-type breakdown. Every
        // dues type appears (LEFT JOIN → Amount 0, isUploaded=No when nothing was uploaded).
        var ocvDuesCatId = await conn.ExecuteScalarAsync<int?>(
            "SELECT pk_category_id FROM ocv_document_category WHERE CategoryCode = 'dues' LIMIT 1");
        var duesReportOcv = new List<dynamic>();
        if (ocvDuesCatId.HasValue && ocvDuesCatId.Value > 0)
        {
            duesReportOcv = (await conn.QueryAsync<dynamic>(@"
                SELECT t.pk_type_id AS typeId, COALESCE(t.TypeName,'') AS documentType, t.SortOrder AS typeSort,
                       COALESCE(SUM(d.Amount),0) AS amount,
                       MAX(d.PaidOn) AS paidOn,
                       CASE WHEN COUNT(d.pk_document_id) > 0 THEN 1 ELSE 0 END AS isUploaded,
                       (SELECT dm.DistrictNumber FROM district_master dm
                         JOIN club_master c2 ON c2.fk_district_id = dm.pk_district_id
                        WHERE c2.pk_club_id = @ClubId LIMIT 1) AS districtNumber
                FROM ocv_document_type t
                LEFT JOIN ocv_documents d ON d.fk_type_id = t.pk_type_id AND d.fk_club_id = @ClubId
                     AND d.fk_category_id = @DuesCat AND d.fk_year_id = @YearId AND d.isdeleted = 0
                WHERE t.fk_category_id = @DuesCat AND t.isdeleted = 0 AND t.IsActive = 1
                GROUP BY t.pk_type_id, t.TypeName, t.SortOrder
                ORDER BY t.SortOrder, t.TypeName",
                new { ClubId = clubId, YearId = yearId, DuesCat = ocvDuesCatId.Value })).ToList();
        }

        // Club Monthly Report — one row per month for the selected year.
        // Bug fix: previously hardcoded '2024' produced labels like "July 2024"
        // regardless of which rotary year was selected. Now uses the actual
        // start/end years derived from rotary_year_master.YearLabel
        // (e.g. "2025-26" → Jul-Dec carry 2025, Jan-Jun carry 2026).
        int rotaryStartYear = DateTime.Now.Year, rotaryEndYear = DateTime.Now.Year + 1;
        if (year != null)
        {
            string yLbl = ((string?)year.yearLabel) ?? "";
            var dashIdx = yLbl.IndexOf('-');
            if (dashIdx > 0 && int.TryParse(yLbl.Substring(0, dashIdx), out var sy))
            {
                rotaryStartYear = sy;
                rotaryEndYear   = sy + 1;
            }
        }

        var monthlyReport = (await conn.QueryAsync<dynamic>(@"
            SELECT r.ReportMonth AS monthNum,
                   DATE_FORMAT(
                     STR_TO_DATE(
                       CONCAT(
                         CASE WHEN r.ReportMonth >= 7 THEN @StartYear ELSE @EndYear END,
                         '-', r.ReportMonth, '-01'
                       ),
                       '%Y-%c-%d'
                     ),
                     '%M %Y'
                   ) AS month,
                   /* per-month meeting count from club_attendance */
                   (SELECT COUNT(*) FROM club_attendance a
                     WHERE a.fk_club_id = r.fk_club_id AND a.fk_year_id = r.fk_year_id AND a.isdeleted = 0
                       AND MONTH(a.EventDateTime) = r.ReportMonth) AS meeting,
                   /* per-month TRF total from trf_contributions */
                   COALESCE((SELECT SUM(t.AmountUSD) FROM trf_contributions t
                              WHERE t.fk_club_id = r.fk_club_id AND t.fk_year_id = r.fk_year_id AND t.isdeleted = 0
                                AND MONTH(t.TrfDate) = r.ReportMonth), 0) AS trf,
                   /* project counts/cost/etc need year-wise table — filled by C# below */
                   0 AS clubService,
                   0 AS projects, 0 AS cost, 0 AS beneficiaries, 0 AS manHours,
                   0 AS rotariansInvolved, 0 AS rotaractors, 0 AS rcc,
                   r.CurrentMemberCount AS members
            FROM club_monthly_reports r
            WHERE r.fk_club_id = @ClubId AND r.fk_year_id = @YearId AND r.isdeleted = 0
            ORDER BY CASE WHEN r.ReportMonth >= 7 THEN r.ReportMonth - 7 ELSE r.ReportMonth + 5 END",
            new { ClubId = clubId, YearId = yearId, StartYear = rotaryStartYear, EndYear = rotaryEndYear })).ToList();

        // Backfill the project aggregates per month from the year-wise project list
        // already loaded above. Cheaper than another year-table query.
        // Costs convert into the club's district default currency; rows keep their own currency.
        var reportCurrency = await ResolveClubDistrictCurrencyAsync(conn, clubId);
        var fxRates = await _fx.GetInrRatesAsync();
        foreach (var m in monthlyReport)
        {
            int mm = (int)m.monthNum;
            var monthAll = projects.Where(p => ((DateTime?)p.projectDate)?.Month == mm).ToList();
            // Club Service entries get their own column; Projects and its totals cover the other avenues
            // only, so nothing is counted twice. "meeting" (attendance count) is left in the payload as is.
            m.clubService       = monthAll.Count(p => (string?)p.moduleKey == "club_service");
            var monthProjects   = monthAll.Where(p => (string?)p.moduleKey != "club_service").ToList();
            m.projects          = monthProjects.Count;
            m.cost              = monthProjects.Sum(p => RotaryApi.Services.CurrencyHelper.Convert((decimal?)p.projectCost ?? 0, p.currency as string, reportCurrency, fxRates));
            m.beneficiaries     = monthProjects.Sum(p => (int?)p.directBeneficiaries ?? 0);
            m.manHours          = monthProjects.Sum(p => (int?)p.manHours ?? 0);
            m.rotariansInvolved = monthProjects.Sum(p => (int?)p.rotariansInvolved ?? 0);
            m.rotaractors       = monthProjects.Sum(p => (int?)p.rotaractorsInvolved ?? 0);
            m.rcc               = monthProjects.Sum(p => (int?)p.rccInvolved ?? 0);
        }

        // PPH Camps — one row per camp (camp itself, not the attendees).
        var pphCamps = (await conn.QueryAsync<dynamic>(@"
            SELECT c.CampDate AS campDate,
                   c.Title    AS campName,
                   c.Address  AS campAddress,
                   (SELECT COUNT(*) FROM pph_camp_attendies a WHERE a.fk_camp_id = c.pk_camp_id AND a.isdeleted = 0) AS totalAttendees,
                   c.Description AS campDescription
            FROM pph_camps c
            WHERE c.fk_club_id = @ClubId AND c.isdeleted = 0
            ORDER BY c.CampDate DESC",
            new { ClubId = clubId })).ToList();

        // PPH Camp Attendees — this club's camps dated within the selected Rotary year. ONE ROW PER
        // MEDICAL READING, each with that attendee's OWN values (attendees with no reading still get one
        // blank row). Legacy rows store isdeleted as NULL, so every isdeleted check is COALESCE'd.
        var pphCampAttendees = (await conn.QueryAsync<dynamic>(@"
            SELECT c.CampDate     AS campDate,
                   c.Title        AS campName,
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
                   CASE WHEN pa.IsObese      = 1 THEN 'Yes' ELSE 'No' END AS obese,
                   CASE WHEN pa.IsOverweight = 1 THEN 'Yes' ELSE 'No' END AS overweight,
                   pa.Remarks     AS remarks
            FROM pph_camp_attendies att
            JOIN pph_camps c ON c.pk_camp_id = att.fk_camp_id AND COALESCE(c.isdeleted, 0) = 0
            JOIN rotary_year_master y ON y.pk_year_id = @YearId
            LEFT JOIN pph_camp_attendance pa
                   ON pa.fk_attendee_id = att.pk_attendee_id AND COALESCE(pa.isdeleted, 0) = 0
            WHERE c.fk_club_id = @ClubId AND COALESCE(att.isdeleted, 0) = 0
              AND c.CampDate >= y.StartDate AND c.CampDate < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
            ORDER BY c.CampDate DESC, att.Name, att.pk_attendee_id, pa.pk_attendance_id",
            new { ClubId = clubId, YearId = yearId })).ToList();

        // ── DATA COLLECTION REPORTS (3 reports — All Members / BOD / DC) ──
        // Only emitted when this club's district has an active
        // district_directory_config row for the selected year. When the config
        // is absent, dataCollection stays NULL and the frontend hides all three
        // SectionRows + their titles.
        dynamic? dataCollection = null;
        var clubDistrictId = await conn.ExecuteScalarAsync<int?>(
            "SELECT fk_district_id FROM club_master WHERE pk_club_id = @C AND isdeleted = 0",
            new { C = clubId });

        if (clubDistrictId.HasValue)
        {
            var ddcCfg = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
                SELECT pk_id AS id,
                       COALESCE(DcFieldsJson, '[]')     AS dcJson,
                       COALESCE(BodFieldsJson, '[]')    AS bodJson,
                       COALESCE(MemberFieldsJson, '[]') AS memberJson
                FROM district_directory_config
                WHERE fk_district_id = @D AND fk_year_id = @Y AND isdeleted = 0
                LIMIT 1",
                new { D = clubDistrictId.Value, Y = yearId });

            if (ddcCfg != null)
            {
                int configId = (int)ddcCfg.id;
                var dcKeys     = DirectoryDataCollectionFields.DeserializeKeys((string)ddcCfg.dcJson);
                var bodKeys    = DirectoryDataCollectionFields.DeserializeKeys((string)ddcCfg.bodJson);
                var memberKeys = DirectoryDataCollectionFields.DeserializeKeys((string)ddcCfg.memberJson);

                // Rows are LAZY-LOADED via 3 dedicated endpoints below
                // (data-collection/all-members, /bod, /dc). Pre-computing
                // here was too slow — N queries per member × hundreds of members.
                dataCollection = new
                {
                    configId,
                    enabled = true,
                    columns = new
                    {
                        allMembers = BuildClubDcColumnSpec(memberKeys),
                        bod        = BuildClubDcColumnSpec(bodKeys),
                        dc         = BuildClubDcColumnSpec(dcKeys)
                    }
                };
            }
        }

        // TRF
        var trf = (await conn.QueryAsync<dynamic>(@"
            SELECT t.TrfDate AS trfDate, t.DonorName AS donorName, t.AmountUSD AS amountUsd,
                   t.FundType AS fundType, t.OtherFundName AS otherFundName,
                   COALESCE(f.FundName, t.OtherFundName) AS fundName
            FROM trf_contributions t
            LEFT JOIN trf_fund_master f ON f.pk_fund_id = t.fk_fund_id
            WHERE t.fk_club_id = @ClubId AND t.fk_year_id = @YearId AND t.isdeleted = 0
            ORDER BY t.TrfDate DESC",
            new { ClubId = clubId, YearId = yearId })).ToList();

        // Summary stats
        var avgAttendance = attendance.Count > 0
            ? attendance.Average(a => (double?)a.attendancePercent ?? 0)
            : 0;
        var totalTrf = trf.Sum(t => (decimal?)t.amountUsd ?? 0);

        return Ok(new
        {
            club,
            rotaryYear = year,
            summary = new
            {
                totalProjects = projects.Count,
                totalAnnouncements = announcements.Count(),
                totalEvents = events.Count(),
                totalNewsletters = newsletters.Count(),
                totalDocuments = documents.Count(),
                totalMeetings = attendance.Count,
                avgAttendancePercent = Math.Round(avgAttendance, 1),
                activeMembers = members.Count(),
                bodCount = bod.Count(),
                totalTrfAmount = totalTrf,
                totalTrfContributions = trf.Count
            },
            projectsByModule,
            announcements,
            events,
            newsletters,
            documents,
            attendance,
            bod,
            members,
            appUsers,
            family,
            bloodGroups,
            trf,
            attendanceMeetingWise,
            attendanceMemberWise,
            clubDues,
            duesReportOcv,
            monthlyReport,
            pphCamps,
            pphCampAttendees,
            dataCollection,
        });
    }

    // Excel-friendly render for a Data Collection field value. Different field
    // types need different stringification so the spreadsheet stays readable:
    //   image        → "Uploaded" / "" (URLs are too long; legacy convention)
    //   date         → "dd-MMM" if birthday/anniversary (year=1900 placeholder), else "dd-MMM-yyyy"
    //   address-bulk → "Address, City, State - PinCode" (comma-joined, no JSON)
    private static string? RenderForExport(DirectoryDataCollectionFields.FieldDef f, string? v)
    {
        // Member Introduction is reported as a simple Yes/No (is an intro written?), not the
        // full free-text, so the sheet stays scannable (2026-09-09, user request). Checked
        // before the empty-guard so a blank intro reports "No" rather than an empty cell.
        if (f.Key == "memberIntroduction")
            return string.IsNullOrWhiteSpace(v) ? "No" : "Yes";
        if (string.IsNullOrWhiteSpace(v)) return null;
        switch (f.Type)
        {
            case "image":
                return "Uploaded";
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
                    var csp = string.Join(", ", new[] { G("City"), G("State"), G("PinCode") }.Where(p => !string.IsNullOrWhiteSpace(p)));
                    if (!string.IsNullOrWhiteSpace(csp)) parts.Add(csp);
                    var phone = G("PhoneNumber"); if (!string.IsNullOrWhiteSpace(phone)) parts.Add("Ph: " + phone);
                    var biz = G("BusinessName"); if (!string.IsNullOrWhiteSpace(biz)) parts.Add(biz);
                    return string.Join(" | ", parts);
                }
                catch { return v; }
            default:
                return v;
        }
    }

    // ── Data Collection lazy-load helpers ──
    // Rows are heavy (N queries per member). Main report endpoint returns just
    // enabled + columns; the 3 endpoints below build rows on Download click.

    private static List<object> BuildClubDcColumnSpec(List<string> keys)
    {
        var prefix = new List<object>
        {
            new { key = "clubName",         label = "Club Name" },
            new { key = "memberName",       label = "Member Name" },
            new { key = "updatedOn",        label = "Updated On" },
            new { key = "mobile",           label = "Mobile Number" },
            new { key = "rotaryId",         label = "Rotary Id" },
            new { key = "secondaryMobile",  label = "Secondary_mobile_Number" },
        };
        var middle = keys
            .Select(k => DirectoryDataCollectionFields.GetField(k))
            .Where(f => f != null)
            .Cast<DirectoryDataCollectionFields.FieldDef>()
            .Select(f => new { key = f.Key, label = f.Label })
            .ToList<object>();
        var suffix = new List<object>
        {
            new { key = "donePercent",    label = "Done (%)" },
            new { key = "pendingPercent", label = "Pending (%)" },
            new { key = "totalFields",    label = "No. of Total Fields" },
            new { key = "pendingFields",  label = "No. of Pending Fields" },
        };
        return prefix.Concat(middle).Concat(suffix).ToList();
    }

    private static async Task<Dictionary<string, object?>> BuildClubDcRowAsync(
        MySqlConnection conn, int configId,
        int memberId, string memName,
        string? mobile, string? rotaryId, string? secondaryMobile,
        List<string> keys, string clubLabel)
    {
        var values = await DirectoryDataCollectionFields.LoadValuesAsync(conn, memberId, keys);
        var (filled, total, _) = DirectoryDataCollectionFields.ComputeCompletion(values, keys);
        int pendingCount = Math.Max(0, total - filled);
        int donePct    = total > 0 ? (int)Math.Round(100.0 * filled / total) : 0;
        int pendingPct = total > 0 ? 100 - donePct : 0;
        var updatedOn = await conn.ExecuteScalarAsync<DateTime?>(@"
            SELECT MAX(SubmittedAt) FROM district_directory_submission_log
            WHERE fk_config_id = @C AND fk_member_id = @M",
            new { C = configId, M = memberId });
        var row = new Dictionary<string, object?>
        {
            ["clubName"]        = clubLabel,
            ["memberName"]      = memName,
            ["updatedOn"]       = updatedOn?.ToString("dd/MMM/yy hh:mm:ss tt"),
            ["mobile"]          = mobile ?? "",
            ["rotaryId"]        = rotaryId ?? "",
            ["secondaryMobile"] = secondaryMobile ?? "",
            ["donePercent"]     = donePct + "%",
            ["pendingPercent"]  = pendingPct + "%",
            ["totalFields"]     = total,
            ["pendingFields"]   = pendingCount,
        };
        foreach (var key in keys)
        {
            var f = DirectoryDataCollectionFields.GetField(key);
            if (f == null) { row[key] = null; continue; }
            values.TryGetValue(key, out var v);
            row[key] = RenderForExport(f, v);
        }
        return row;
    }

    // Look up (configId, dcKeys, bodKeys, memberKeys, districtId, clubName).
    private async Task<(int configId, List<string> dcKeys, List<string> bodKeys, List<string> memberKeys, int districtId, string clubName)?>
        LoadClubDcConfigAsync(MySqlConnection conn, int clubId, int yearId)
    {
        var clubRow = await conn.QueryFirstOrDefaultAsync<(int districtId, string clubName)>(
            "SELECT IFNULL(fk_district_id, 0) AS districtId, IFNULL(ClubName, '') AS clubName FROM club_master WHERE pk_club_id = @C AND isdeleted = 0",
            new { C = clubId });
        if (clubRow.districtId == 0) return null;
        var ddcCfg = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pk_id AS id,
                   COALESCE(DcFieldsJson, '[]')     AS dcJson,
                   COALESCE(BodFieldsJson, '[]')    AS bodJson,
                   COALESCE(MemberFieldsJson, '[]') AS memberJson
            FROM district_directory_config
            WHERE fk_district_id = @D AND fk_year_id = @Y AND isdeleted = 0
            LIMIT 1", new { D = clubRow.districtId, Y = yearId });
        if (ddcCfg == null) return null;
        return ((int)ddcCfg.id,
            DirectoryDataCollectionFields.DeserializeKeys((string)ddcCfg.dcJson),
            DirectoryDataCollectionFields.DeserializeKeys((string)ddcCfg.bodJson),
            DirectoryDataCollectionFields.DeserializeKeys((string)ddcCfg.memberJson),
            clubRow.districtId, clubRow.clubName);
    }

    [HttpGet("data-collection/all-members")]
    public async Task<ActionResult> DataCollectionAllMembers(int clubId, [FromQuery] int yearId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId))
            return StatusCode(403, new { message = "This club is inactive." });
        if (yearId <= 0) return BadRequest(new { message = "yearId is required." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var cfg = await LoadClubDcConfigAsync(conn, clubId, yearId);
        if (cfg == null) return Ok(new { rows = new List<object>() });
        var (configId, _, _, memberKeys, _, clubName) = cfg.Value;
        var rows = new List<Dictionary<string, object?>>();
        var members = await conn.QueryAsync<dynamic>(@"
            SELECT m.pk_member_master_profile_id AS id, m.MemberName AS name,
                   m.PrimaryMobileNumber AS mobile, m.RotaryId AS rotaryId,
                   m.SecondaryMobileNumber AS secMobile
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            WHERE cm.fk_club_id = @C AND cm.IsActive = 1 AND cm.isdeleted = 0
            ORDER BY m.MemberName", new { C = clubId });
        foreach (var x in members)
            rows.Add(await BuildClubDcRowAsync(conn, configId, (int)x.id, (string)x.name, (string?)x.mobile, (string?)x.rotaryId, (string?)x.secMobile, memberKeys, clubName));
        return Ok(new { rows });
    }

    [HttpGet("data-collection/bod")]
    public async Task<ActionResult> DataCollectionBod(int clubId, [FromQuery] int yearId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId))
            return StatusCode(403, new { message = "This club is inactive." });
        if (yearId <= 0) return BadRequest(new { message = "yearId is required." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var cfg = await LoadClubDcConfigAsync(conn, clubId, yearId);
        if (cfg == null) return Ok(new { rows = new List<object>() });
        var (configId, _, bodKeys, _, _, clubName) = cfg.Value;
        var rows = new List<Dictionary<string, object?>>();
        var members = await conn.QueryAsync<dynamic>(@"
            SELECT m.pk_member_master_profile_id AS id, m.MemberName AS name,
                   m.PrimaryMobileNumber AS mobile, m.RotaryId AS rotaryId,
                   m.SecondaryMobileNumber AS secMobile
            FROM board_of_directors b
            JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id AND m.isdeleted = 0
            WHERE b.fk_club_id = @C AND b.fk_year_id = @Y AND b.isdeleted = 0
              AND b.fk_designation_id IN (1, 2)
            GROUP BY m.pk_member_master_profile_id, m.MemberName, m.PrimaryMobileNumber, m.RotaryId, m.SecondaryMobileNumber
            ORDER BY m.MemberName", new { C = clubId, Y = yearId });
        foreach (var x in members)
            rows.Add(await BuildClubDcRowAsync(conn, configId, (int)x.id, (string)x.name, (string?)x.mobile, (string?)x.rotaryId, (string?)x.secMobile, bodKeys, clubName));
        return Ok(new { rows });
    }

    [HttpGet("data-collection/dc")]
    public async Task<ActionResult> DataCollectionDc(int clubId, [FromQuery] int yearId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId))
            return StatusCode(403, new { message = "This club is inactive." });
        if (yearId <= 0) return BadRequest(new { message = "yearId is required." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var cfg = await LoadClubDcConfigAsync(conn, clubId, yearId);
        if (cfg == null) return Ok(new { rows = new List<object>() });
        var (configId, dcKeys, _, _, districtId, clubName) = cfg.Value;
        var rows = new List<Dictionary<string, object?>>();
        var members = await conn.QueryAsync<dynamic>(@"
            SELECT m.pk_member_master_profile_id AS id, m.MemberName AS name,
                   m.PrimaryMobileNumber AS mobile, m.RotaryId AS rotaryId,
                   m.SecondaryMobileNumber AS secMobile
            FROM district_committee_member dcm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = dcm.fk_member_id AND m.isdeleted = 0
            JOIN club_members cm        ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.isdeleted = 0
            WHERE dcm.fk_district_id = @D AND dcm.fk_year_id = @Y AND dcm.isdeleted = 0 AND dcm.is_active = 1
              AND cm.fk_club_id = @C AND cm.IsActive = 1
            GROUP BY m.pk_member_master_profile_id, m.MemberName, m.PrimaryMobileNumber, m.RotaryId, m.SecondaryMobileNumber
            ORDER BY m.MemberName", new { D = districtId, C = clubId, Y = yearId });
        foreach (var x in members)
            rows.Add(await BuildClubDcRowAsync(conn, configId, (int)x.id, (string)x.name, (string?)x.mobile, (string?)x.rotaryId, (string?)x.secMobile, dcKeys, clubName));
        return Ok(new { rows });
    }

    // ── Avenue of Service Raw Data — Word .docx ───────────────────────
    // Per-avenue aggregated table grouped by Area of Focus.
    [HttpGet("avenue-of-service-raw-data")]
    public async Task<ActionResult> AvenueOfServiceRawData(int clubId, [FromQuery] int yearId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        if (yearId <= 0) return BadRequest(new { message = "yearId is required." });

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var club = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT c.ClubName AS clubName FROM club_master c WHERE c.pk_club_id = @Id AND c.isdeleted = 0",
            new { Id = clubId });
        if (club == null) return NotFound();
        string clubName = (string)club.clubName;

        var year = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT YearLabel AS yearLabel FROM rotary_year_master WHERE pk_year_id = @Id",
            new { Id = yearId });
        string yearLabel = year?.yearLabel ?? "";

        int membership = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM club_members WHERE fk_club_id = @C AND IsActive = 1 AND isdeleted = 0",
            new { C = clubId });

        // Year-wise project table for this year.
        var info = await _yearTables.ResolveByYearIdAsync(conn, yearId);
        var sections = new List<ClubReportWordBuilder.AvenueSection>();
        if (info != null)
        {
            // Aggregate per avenue + area of focus.
            var rows = await conn.QueryAsync<dynamic>($@"
                SELECT mm.ModuleKey  AS moduleKey,
                       mm.ModuleName AS moduleName,
                       COALESCE(af.name, '(Uncategorised)') AS areaOfFocus,
                       COUNT(*)                              AS projects,
                       COALESCE(SUM(p.direct_beneficiaries), 0) AS beneficiaries,
                       COALESCE(SUM(p.project_cost), 0)         AS amountSpent
                FROM `{info.ProjectsTable}` p
                JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
                LEFT JOIN area_of_focus_master af ON af.pk_area_of_focus_id = p.fk_area_of_focus_id
                WHERE p.fk_club_id = @C AND p.isdeleted = 0
                GROUP BY mm.ModuleKey, mm.ModuleName, af.name
                ORDER BY mm.ModuleName, af.name",
                new { C = clubId });

            foreach (var grp in rows.GroupBy(r => (string)r.moduleName))
            {
                var areaRows = grp.Select(r => new ClubReportWordBuilder.AvenueAreaSummary(
                    AreaOfFocus:   (string)r.areaOfFocus,
                    Projects:      Convert.ToInt32(r.projects),
                    Beneficiaries: Convert.ToInt32(r.beneficiaries),
                    AmountSpent:   Convert.ToDecimal(r.amountSpent))).ToList();
                sections.Add(new ClubReportWordBuilder.AvenueSection(grp.Key, areaRows));
            }
        }

        var bytes = ClubReportWordBuilder.BuildAvenueRawData(clubName, yearLabel, membership, sections);
        var stamp = DateTime.Now.ToString("dd-MM-yyyy HH-mm-ss");
        var safeClub = string.Concat(clubName.Split(Path.GetInvalidFileNameChars())).Replace(' ', '_');
        var fileName = $"{safeClub}_Avenue_of_Service_Raw_Data_{stamp}.docx";
        return File(bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", fileName);
    }

    // ── Annual Club Service Raw Data — Word .docx ─────────────────────
    // Single section listing every club meeting for the year.
    [HttpGet("annual-club-service-raw-data")]
    public async Task<ActionResult> AnnualClubServiceRawData(int clubId, [FromQuery] int yearId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        if (yearId <= 0) return BadRequest(new { message = "yearId is required." });

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var club = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT c.ClubName AS clubName FROM club_master c WHERE c.pk_club_id = @Id AND c.isdeleted = 0",
            new { Id = clubId });
        if (club == null) return NotFound();
        string clubName = (string)club.clubName;

        var year = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT YearLabel AS yearLabel FROM rotary_year_master WHERE pk_year_id = @Id",
            new { Id = yearId });
        string yearLabel = year?.yearLabel ?? "";

        int membership = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM club_members WHERE fk_club_id = @C AND IsActive = 1 AND isdeleted = 0",
            new { C = clubId });

        var rows = await conn.QueryAsync<dynamic>(@"
            SELECT a.EventDateTime AS date,
                   a.EventName     AS title,
                   a.Description   AS description,
                   (SELECT COUNT(*) FROM club_attendance_members m WHERE m.fk_attendance_id = a.pk_attendance_id) AS membersPresent
            FROM club_attendance a
            WHERE a.fk_club_id = @C AND a.fk_year_id = @Y AND a.isdeleted = 0
            ORDER BY a.EventDateTime",
            new { C = clubId, Y = yearId });

        var meetings = rows.Select(r => new ClubReportWordBuilder.MeetingRow(
            DateLabel:      ((DateTime?)r.date)?.ToString("dd MMM yyyy") ?? "",
            Title:          (string)(r.title ?? ""),
            Description:    (string)(r.description ?? ""),
            MembersPresent: Convert.ToInt32(r.membersPresent))).ToList();

        var bytes = ClubReportWordBuilder.BuildAnnualClubServiceRawData(clubName, yearLabel, membership, meetings);
        var stamp = DateTime.Now.ToString("dd-MM-yyyy HH-mm-ss");
        var safeClub = string.Concat(clubName.Split(Path.GetInvalidFileNameChars())).Replace(' ', '_');
        var fileName = $"{safeClub}_Annual_Club_Service_Raw_Data_{stamp}.docx";
        return File(bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", fileName);
    }

    // ── Annual Report — Word .docx ────────────────────────────────────
    // Book-like (same flow as the monthly report), for the whole year: Membership analytics +
    // Club Service + all service avenues, each item detailed with photos. No TRF.
    [HttpGet("annual-report")]
    public async Task<ActionResult> AnnualReport(int clubId, [FromQuery] int yearId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        if (yearId <= 0) return BadRequest(new { message = "yearId is required." });

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var club = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT ClubName AS clubName FROM club_master WHERE pk_club_id = @Id AND isdeleted = 0", new { Id = clubId });
        if (club == null) return NotFound();
        string clubName = (string)club.clubName;

        var yr = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT YearLabel AS yearLabel, StartDate AS startDate, EndDate AS endDate FROM rotary_year_master WHERE pk_year_id = @Id", new { Id = yearId });
        if (yr == null) return NotFound();
        string yearLabel = (string)(yr.yearLabel ?? "");
        DateTime start = yr.startDate;
        DateTime end = yr.endDate;

        // Membership analytics (current strength + gender + honorary + joined-this-year).
        var m = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT COUNT(*) AS total,
                   SUM(CASE WHEN mp.Gender = 'Male' THEN 1 ELSE 0 END) AS male,
                   SUM(CASE WHEN mp.Gender = 'Female' THEN 1 ELSE 0 END) AS female,
                   SUM(CASE WHEN cm.IsHonoraryMember = 1 THEN 1 ELSE 0 END) AS honorary
            FROM club_members cm
            JOIN member_master_profile mp ON mp.pk_member_master_profile_id = cm.fk_member_master_profile_id
            WHERE cm.fk_club_id = @C AND cm.IsActive = 1 AND cm.isdeleted = 0",
            new { C = clubId });
        int added = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM club_members
            WHERE fk_club_id = @C AND isdeleted = 0 AND JoinedDate >= @S AND JoinedDate <= @E",
            new { C = clubId, S = start, E = end });

        var mem = new ClubMonthlyReportWordBuilder.AnnualMembership(
            Current: Convert.ToInt32(m?.total ?? 0),
            Male: Convert.ToInt32(m?.male ?? 0),
            Female: Convert.ToInt32(m?.female ?? 0),
            Honorary: Convert.ToInt32(m?.honorary ?? 0),
            AddedThisYear: added);

        var items = await _cmr.GetWordProjectsForYearAsync(clubId, yearId);
        foreach (var it in items)
            foreach (var ph in it.Photos)
                await CmrMediaLoader.LoadAsync(_env, _mediaRedirectBase, ph);

        var bytes = ClubMonthlyReportWordBuilder.BuildAnnualReport(clubName, yearLabel, mem, items, _mediaBaseForLinks);
        var stamp = DateTime.Now.ToString("dd-MM-yyyy HH-mm-ss");
        var safeClub = string.Concat(clubName.Split(Path.GetInvalidFileNameChars())).Replace(' ', '_');
        var fileName = $"{safeClub}_Annual_Report_{stamp}.docx";
        return File(bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", fileName);
    }

    // Get years that have any data for this club
    [HttpGet("available-years")]
    public async Task<ActionResult> GetAvailableYears(int clubId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        // Year-wise projects: for each existing year-wise table, check whether this club has a row.
        var projectTables = await _yearTables.GetAllExistingYearTablesAsync(conn);
        var yearProjLegs = projectTables.Count == 0 ? "SELECT NULL AS fk_year_id WHERE 1=0" :
            string.Join(" UNION ", projectTables.Select(t =>
                $"(SELECT {t.YearId} AS fk_year_id FROM `{t.ProjectsTable}` WHERE fk_club_id = @C AND isdeleted = 0 LIMIT 1)"));

        var years = await conn.QueryAsync<dynamic>($@"
            SELECT DISTINCT y.pk_year_id AS id, y.YearLabel AS yearLabel, y.IsCurrent AS isCurrent
            FROM rotary_year_master y
            WHERE y.pk_year_id IN (
                SELECT fk_year_id FROM ({yearProjLegs}) yp
                UNION SELECT y2.pk_year_id FROM rotary_year_master y2
                       JOIN announcements a ON a.PublishDateTime >= y2.StartDate AND a.PublishDateTime < DATE_ADD(y2.EndDate, INTERVAL 1 DAY)
                       WHERE a.fk_club_id = @C AND a.isdeleted = 0
                UNION SELECT y3.pk_year_id FROM rotary_year_master y3
                       JOIN upcoming_events e ON e.PublishDate >= y3.StartDate AND e.PublishDate < DATE_ADD(y3.EndDate, INTERVAL 1 DAY)
                       WHERE e.fk_club_id = @C AND e.isdeleted = 0
                UNION SELECT y4.pk_year_id FROM rotary_year_master y4
                       JOIN newsletters n ON n.PublishDateTime >= y4.StartDate AND n.PublishDateTime < DATE_ADD(y4.EndDate, INTERVAL 1 DAY)
                       WHERE n.fk_club_id = @C AND n.isdeleted = 0
                UNION SELECT fk_year_id FROM club_attendance WHERE fk_club_id = @C AND isdeleted = 0
                UNION SELECT fk_year_id FROM board_of_directors WHERE fk_club_id = @C AND isdeleted = 0
            )
            OR y.IsCurrent = 1
            ORDER BY y.pk_year_id DESC",
            new { C = clubId });
        return Ok(years);
    }
}
