using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

// SuperAdmin-only "Reports" hub — returns raw rows; frontend pipes into xlsx export.
[ApiController]
[Route("api/admin/reports")]
[Authorize]
public class ReportsController : ControllerBase
{
    private readonly string _connectionString;
    private readonly IYearTableResolver _yearTables;

    public ReportsController(IConfiguration config, IYearTableResolver yearTables)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        _yearTables = yearTables;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);
    private bool IsSuperAdmin() => User.FindFirst("roles")?.Value?.Contains("SuperAdmin") == true;

    // Simple district list for the Reports page filter dropdown
    [HttpGet("districts-list")]
    public async Task<ActionResult> DistrictsList()
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var rows = await conn.QueryAsync<dynamic>(@"
            SELECT pk_district_id AS id, DistrictNumber AS districtNumber
            FROM district_master
            WHERE isdeleted = 0
            ORDER BY CAST(DistrictNumber AS UNSIGNED), DistrictNumber");
        return Ok(rows);
    }

    // ==================== ZONES SECTION ====================

    [HttpGet("zones")]
    public async Task<ActionResult> Zones()
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var rows = await conn.QueryAsync<dynamic>(@"
            SELECT z.pk_zone_id AS zoneId,
                   z.ZoneName AS zoneName,
                   (SELECT COUNT(*) FROM district_master d WHERE d.fk_zone_id = z.pk_zone_id AND d.isdeleted = 0) AS districtCount,
                   z.IsActive AS isActive,
                   z.created_date AS createdDate
            FROM zone_master z
            WHERE z.isdeleted = 0
            ORDER BY z.ZoneName");
        return Ok(rows);
    }

    // ==================== MEMBERS BY ROLE ====================
    //
    // Role-pivoted member listing for SA reports. One endpoint, optional `role`
    // query param. Passing role=all (or omitting) returns every active assignment
    // across all roles. Passing a specific role name (e.g. role=Admin) filters to
    // that role only. Joins through the member's currently active club membership
    // to surface Zone / District / Club at the same time so the report is
    // self-contained.
    //
    // The member's "primary club" for the row is whichever club_members row is
    // currently active. Members with no active club row appear with NULL
    // club/district/zone, which is intentional — surfaces orphaned-role bugs.
    [HttpGet("members-by-role")]
    public async Task<ActionResult> MembersByRole([FromQuery] string? role)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();

        // SQL is the user-supplied template:
        //   SELECT DISTINCT dist.DistrictNumber, club.ClubName, pro.MemberName,
        //          pro.PrimaryMobileNumber, pro.EmailId
        //   FROM member_master_profile pro
        //   INNER JOIN club_members club_mem
        //          ON club_mem.fk_member_master_profile_id = pro.pk_member_master_profile_id
        //   INNER JOIN club_master club ON club.pk_club_id = club_mem.fk_club_id
        //   INNER JOIN district_master dist ON dist.pk_district_id = club.fk_district_id
        //   INNER JOIN member_roles mem_role
        //          ON mem_role.fk_member_master_profile_id = pro.pk_member_master_profile_id
        //   WHERE fk_role_id = @RoleId AND club_mem.fk_club_id <> 0;
        //
        // Role IDs:
        //   1 = Member        2 = Admin (DA + CA)   3 = SuperAdmin
        //   6 = AG
        //
        // For "All Admin Roles" we pass NULL → no role filter; the WHERE keeps the
        // club-active filter. Member role (id 1) is explicitly excluded for "all".
        var key = (role ?? "").Trim().ToLowerInvariant();
        int? roleId = key switch
        {
            "superadmin"      => 3,
            "ag"              => 6,
            "districtadmin"   => 2, // Admin, scoped District
            "clubadmin"       => 2, // Admin, scoped Club
            "alladmin"        => 2,
            "admin"           => 2,
            _                 => null,   // "all" / empty / unknown → no role filter
        };
        // District / Club Admin both have role id 2 in the DB. Distinguish via
        // the scope FK on member_roles. AllAdmin keeps both.
        string scopeFilter = key switch
        {
            "districtadmin" => " AND mem_role.fk_district_id <> 0 ",
            "clubadmin"     => " AND mem_role.fk_club_id     <> 0 ",
            _               => "",
        };
        // The "all" alias is admin-only — drop plain Members.
        string allFilter = roleId == null ? " AND mem_role.fk_role_id <> 1 " : "";

        var sql = @"
            SELECT DISTINCT
                dist.DistrictNumber   AS districtNumber,
                club.ClubName         AS clubName,
                pro.MemberName        AS memberName,
                pro.PrimaryMobileNumber AS mobile,
                pro.EmailId           AS email
            FROM member_master_profile pro
            INNER JOIN club_members club_mem
                ON club_mem.fk_member_master_profile_id = pro.pk_member_master_profile_id
               AND club_mem.IsActive = 1 AND COALESCE(club_mem.isdeleted, 0) = 0
            INNER JOIN club_master club
                ON club.pk_club_id = club_mem.fk_club_id
               AND COALESCE(club.isdeleted, 0) = 0
            INNER JOIN district_master dist
                ON dist.pk_district_id = club.fk_district_id
               AND COALESCE(dist.isdeleted, 0) = 0
            INNER JOIN member_roles mem_role
                ON mem_role.fk_member_master_profile_id = pro.pk_member_master_profile_id
               AND mem_role.IsActive = 1 AND COALESCE(mem_role.isdeleted, 0) = 0
            WHERE COALESCE(pro.isdeleted, 0) = 0
              AND club_mem.fk_club_id <> 0
              AND (@RoleId IS NULL OR mem_role.fk_role_id = @RoleId)
              " + scopeFilter + allFilter + @"
            ORDER BY CAST(dist.DistrictNumber AS UNSIGNED), dist.DistrictNumber, club.ClubName, pro.MemberName";

        var rows = await conn.QueryAsync<dynamic>(sql, new { RoleId = roleId });
        return Ok(rows);
    }

    // ==================== DISTRICTS SECTION ====================

    [HttpGet("districts")]
    public async Task<ActionResult> Districts([FromQuery] int? districtId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var sql = @"
            SELECT d.pk_district_id AS districtId,
                   d.DistrictNumber AS districtNumber,
                   z.ZoneName AS zoneName,
                   (SELECT COUNT(*) FROM club_master c WHERE c.fk_district_id = d.pk_district_id AND c.isdeleted = 0) AS clubCount,
                   d.created_date AS createdDate
            FROM district_master d
            LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0
            WHERE d.isdeleted = 0";
        var p = new DynamicParameters();
        if (districtId.HasValue) { sql += " AND d.pk_district_id = @DistrictId"; p.Add("DistrictId", districtId.Value); }
        sql += " ORDER BY CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber";
        var rows = await conn.QueryAsync<dynamic>(sql, p);
        return Ok(rows);
    }

    [HttpGet("district-governors")]
    public async Task<ActionResult> DistrictGovernors([FromQuery] int? yearId, [FromQuery] int? districtId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        // Contacts come from the member profile, or from the DG row itself when the governor
        // is not a member of any club (that row also carries the name).
        var sql = $@"
            SELECT d.DistrictNumber AS districtNumber,
                   y.YearLabel AS year,
                   {DistrictGovernorSql.Name} AS memberName,
                   COALESCE({DistrictGovernorSql.Email}, '') AS email,
                   COALESCE({DistrictGovernorSql.Mobile}, '') AS mobile,
                   g.description AS description,
                   g.created_date AS createdDate
            FROM district_governors g
            JOIN district_master d ON d.pk_district_id = g.fk_district_id
            JOIN rotary_year_master y ON y.pk_year_id = g.fk_year_id
            {DistrictGovernorSql.JoinMember}
            WHERE g.isdeleted = 0";
        var p = new DynamicParameters();
        if (yearId.HasValue) { sql += " AND g.fk_year_id = @YearId"; p.Add("YearId", yearId.Value); }
        if (districtId.HasValue) { sql += " AND g.fk_district_id = @DistrictId"; p.Add("DistrictId", districtId.Value); }
        sql += " ORDER BY y.YearLabel DESC, CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber";
        var rows = await conn.QueryAsync<dynamic>(sql, p);
        return Ok(rows);
    }

    // ==================== CLUBS SECTION ====================

    [HttpGet("clubs")]
    public async Task<ActionResult> Clubs([FromQuery] int? districtId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var sql = @"
            SELECT c.pk_club_id AS clubId, c.ClubRotaryId AS clubRotaryId, c.ClubName AS clubName,
                   d.DistrictNumber AS districtNumber,
                   z.ZoneName AS zoneName,
                   c.MeetingDay AS meetingDay, c.MeetingFromTime AS meetingFromTime, c.MeetingToTime AS meetingToTime,
                   c.MeetingAddress AS meetingAddress,
                   c.City AS city, c.State AS state, c.Country AS country, c.Pincode AS pincode,
                   c.Latitude AS latitude, c.Longitude AS longitude,
                   c.ClubWebsite AS clubWebsite,
                   c.Timezone AS timezone,
                   c.ActiveFromDate AS activeFromDate, c.ActiveToDate AS activeToDate,
                   CASE WHEN c.IsAutomaticMeetingReminder = 1 THEN 'Yes' ELSE 'No' END AS autoReminder,
                   CASE WHEN c.IsFamilyLogin = 1 THEN 'Yes' ELSE 'No' END AS familyLogin,
                   (SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id WHERE cm.fk_club_id = c.pk_club_id AND cm.isdeleted = 0 AND cm.IsActive = 1 AND m.isdeleted = 0) AS totalMembers,
                   CASE WHEN c.IsActive = 1 THEN 'Yes' ELSE 'No' END AS isActive,
                   c.ClubCharterDate AS charterDate
            FROM club_master c
            LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
            LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE c.isdeleted = 0";
        var p = new DynamicParameters();
        if (districtId.HasValue) { sql += " AND c.fk_district_id = @DistrictId"; p.Add("DistrictId", districtId.Value); }
        sql += " ORDER BY CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber, c.ClubName";
        var rows = await conn.QueryAsync<dynamic>(sql, p);
        return Ok(rows);
    }

    [HttpGet("club-members")]
    public async Task<ActionResult> ClubMembers([FromQuery] int? districtId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var sql = @"
            SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS memberName,
                   m.RotaryId AS rotaryId, m.EmailId AS email,
                   m.PrimaryMobileNumber AS mobile, m.Gender AS gender,
                   m.BirthDate AS birthDate, m.AnniversaryDate AS anniversaryDate,
                   m.BloodGroup AS bloodGroup,
                   c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId,
                   d.DistrictNumber AS districtNumber,
                   z.ZoneName AS zoneName,
                   " + CogDesignationHelper.JoinedDateExpr("cm") + @" AS joinedDate,
                   " + CogDesignationHelper.SelectColumns("cm") + @"
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE cm.isdeleted = 0 AND cm.IsActive = 1";
        var p = new DynamicParameters();
        if (districtId.HasValue) { sql += " AND c.fk_district_id = @DistrictId"; p.Add("DistrictId", districtId.Value); }
        sql += " ORDER BY CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber, c.ClubName, m.MemberName";
        var rows = await conn.QueryAsync<dynamic>(sql, p);
        return Ok(rows);
    }

    [HttpGet("club-leadership")]
    public async Task<ActionResult> ClubLeadership([FromQuery] int? yearId, [FromQuery] int? districtId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var sql = @"
            SELECT d.DistrictNumber AS districtNumber,
                   c.ClubRotaryId AS clubRotaryId, c.ClubName AS clubName,
                   y.YearLabel AS year,
                   dm.designation_name AS designation,
                   m.MemberName AS memberName,
                   m.EmailId AS email, m.PrimaryMobileNumber AS mobile
            FROM board_of_directors b
            JOIN club_master c ON c.pk_club_id = b.fk_club_id AND c.isdeleted = 0
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id
            JOIN rotary_year_master y ON y.pk_year_id = b.fk_year_id
            JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id AND m.isdeleted = 0
            WHERE b.isdeleted = 0
              AND (LOWER(dm.designation_name) LIKE '%president%' OR LOWER(dm.designation_name) LIKE '%secretary%')
              AND LOWER(dm.designation_name) NOT LIKE '%vice%'
              AND LOWER(dm.designation_name) NOT LIKE '%past%'";
        var p = new DynamicParameters();
        if (yearId.HasValue) { sql += " AND b.fk_year_id = @YearId"; p.Add("YearId", yearId.Value); }
        if (districtId.HasValue) { sql += " AND c.fk_district_id = @DistrictId"; p.Add("DistrictId", districtId.Value); }
        sql += " ORDER BY y.YearLabel DESC, CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber, c.ClubName, dm.sort_order";
        var rows = await conn.QueryAsync<dynamic>(sql, p);
        return Ok(rows);
    }

    [HttpGet("club-websites")]
    public async Task<ActionResult> ClubWebsites([FromQuery] int? districtId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var sql = @"
            SELECT d.DistrictNumber AS districtNumber,
                   c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId,
                   w.Subdomain AS subdomain, w.ClientDomain AS thirdPartyDomain,
                   t.theme_name AS theme,
                   w.StartDate AS startDate, w.EndDate AS endDate,
                   DATEDIFF(w.EndDate, CURDATE()) AS daysLeft,
                   w.Status AS status,
                   w.AmountPaid AS amountPaid,
                   w.TransactionId AS transactionId, w.PaymentDate AS paymentDate
            FROM club_websites w
            JOIN club_master c ON c.pk_club_id = w.fk_club_id
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            LEFT JOIN theme_master t ON t.pk_theme_id = w.fk_theme_id
            WHERE w.isdeleted = 0";
        var p = new DynamicParameters();
        if (districtId.HasValue) { sql += " AND c.fk_district_id = @DistrictId"; p.Add("DistrictId", districtId.Value); }
        sql += " ORDER BY w.Status, w.EndDate";
        var rows = await conn.QueryAsync<dynamic>(sql, p);
        return Ok(rows);
    }

    [HttpGet("district-websites")]
    public async Task<ActionResult> DistrictWebsites([FromQuery] int? districtId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var sql = @"
            SELECT d.DistrictNumber AS districtNumber,
                   w.Subdomain AS subdomain, w.ClientDomain AS thirdPartyDomain,
                   w.Status AS status, w.Notes AS notes,
                   w.created_date AS createdDate
            FROM district_websites w
            JOIN district_master d ON d.pk_district_id = w.fk_district_id
            WHERE w.isdeleted = 0";
        var p = new DynamicParameters();
        if (districtId.HasValue) { sql += " AND w.fk_district_id = @DistrictId"; p.Add("DistrictId", districtId.Value); }
        sql += " ORDER BY CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber";
        var rows = await conn.QueryAsync<dynamic>(sql, p);
        return Ok(rows);
    }

    // ==================== SETTINGS SECTION ====================

    [HttpGet("rotary-years")]
    public async Task<ActionResult> RotaryYears()
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var rows = await conn.QueryAsync<dynamic>(@"
            SELECT pk_year_id AS yearId,
                   YearLabel AS yearLabel,
                   StartDate AS startDate,
                   EndDate AS endDate,
                   CASE WHEN IsCurrent = 1 THEN 'Yes' ELSE 'No' END AS isCurrent
            FROM rotary_year_master
            WHERE isdeleted = 0
            ORDER BY YearLabel DESC");
        return Ok(rows);
    }

    [HttpGet("designations")]
    public async Task<ActionResult> Designations()
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var rows = await conn.QueryAsync<dynamic>(@"
            SELECT pk_designation_id AS designationId,
                   designation_name AS designationName,
                   sort_order AS sortOrder
            FROM designation_master
            WHERE isdeleted = 0
            ORDER BY sort_order, designation_name");
        return Ok(rows);
    }

    [HttpGet("themes")]
    public async Task<ActionResult> Themes()
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var rows = await conn.QueryAsync<dynamic>(@"
            SELECT pk_theme_id AS themeId,
                   theme_name AS themeName,
                   CASE
                       WHEN theme_image_path IS NULL OR theme_image_path = '' THEN NULL
                       WHEN theme_image_path LIKE '/%' THEN theme_image_path
                       ELSE CONCAT('/uploads/theme/', theme_image_path)
                   END AS imagePath,
                   created_date AS createdDate
            FROM theme_master
            WHERE isdeleted = 0
            ORDER BY theme_name");
        return Ok(rows);
    }

    [HttpGet("module-master")]
    public async Task<ActionResult> ModuleMaster()
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var rows = await conn.QueryAsync<dynamic>(@"
            SELECT m.pk_module_id AS moduleId,
                   m.ModuleKey AS moduleKey,
                   m.ModuleName AS moduleName,
                   m.ModuleLevel AS level,
                   m.Description AS description,
                   m.RouteUrl AS routeUrl,
                   CASE WHEN m.IsDefaultForDistrict = 1 THEN 'Yes' ELSE 'No' END AS defaultForDistrict,
                   CASE WHEN m.IsDefaultForClub = 1 THEN 'Yes' ELSE 'No' END AS defaultForClub,
                   m.SortOrder AS sortOrder
            FROM module_master m
            WHERE m.isdeleted = 0
            ORDER BY m.SortOrder, m.ModuleName");
        return Ok(rows);
    }

    [HttpGet("areas-of-focus")]
    public async Task<ActionResult> AreasOfFocus()
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var rows = await conn.QueryAsync<dynamic>(@"
            SELECT a.pk_area_of_focus_id AS areaId,
                   a.name AS areaName,
                   m.ModuleName AS moduleName,
                   a.sort_order AS sortOrder,
                   CASE WHEN a.is_active = 1 THEN 'Yes' ELSE 'No' END AS isActive
            FROM area_of_focus_master a
            LEFT JOIN module_master m ON m.pk_module_id = a.fk_module_id
            WHERE a.isdeleted = 0
            ORDER BY a.sort_order, a.name");
        return Ok(rows);
    }

    [HttpGet("funding")]
    public async Task<ActionResult> Funding()
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var rows = await conn.QueryAsync<dynamic>(@"
            SELECT pk_funding_id AS fundingId,
                   name AS fundingName,
                   sort_order AS sortOrder,
                   CASE WHEN is_active = 1 THEN 'Yes' ELSE 'No' END AS isActive
            FROM funding_master
            WHERE isdeleted = 0
            ORDER BY sort_order, name");
        return Ok(rows);
    }

    [HttpGet("international-president")]
    public async Task<ActionResult> InternationalPresident([FromQuery] int? yearId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var sql = @"
            SELECT y.YearLabel AS year,
                   p.Name AS name,
                   p.Designation AS designation,
                   CASE
                       WHEN p.ProfilePhotoPath IS NULL OR p.ProfilePhotoPath = '' THEN NULL
                       WHEN p.ProfilePhotoPath LIKE '/Documents/directory/%' THEN p.ProfilePhotoPath
                       ELSE CONCAT('/Documents/WebsiteData/International_President/', p.ProfilePhotoPath)
                   END AS profilePhoto
            FROM international_president p
            JOIN rotary_year_master y ON y.pk_year_id = p.fk_year_id
            WHERE p.isdeleted = 0";
        var p2 = new DynamicParameters();
        if (yearId.HasValue) { sql += " AND p.fk_year_id = @YearId"; p2.Add("YearId", yearId.Value); }
        sql += " ORDER BY y.YearLabel DESC";
        var rows = await conn.QueryAsync<dynamic>(sql, p2);
        return Ok(rows);
    }

    // ==================== PHASE 2 — YEAR-SCOPED CLUB DATA ====================

    [HttpGet("board-of-directors")]
    public async Task<ActionResult> BoardOfDirectors([FromQuery] int? yearId, [FromQuery] int? districtId, [FromQuery] string? syncSource)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var sql = @"
            SELECT d.DistrictNumber AS districtNumber, c.ClubRotaryId AS clubRotaryId, c.ClubName AS clubName,
                   y.YearLabel AS year, dm.designation_name AS designation,
                   m.MemberName AS memberName, m.EmailId AS email, m.PrimaryMobileNumber AS mobile,
                   m.RotaryId AS rotaryId,
                   IFNULL(b.SyncSource, 'Manual') AS syncSource
            FROM board_of_directors b
            JOIN club_master c ON c.pk_club_id = b.fk_club_id AND c.isdeleted = 0
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id
            JOIN rotary_year_master y ON y.pk_year_id = b.fk_year_id
            JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id AND m.isdeleted = 0
            WHERE b.isdeleted = 0";
        var p = new DynamicParameters();
        if (yearId.HasValue) { sql += " AND b.fk_year_id = @YearId"; p.Add("YearId", yearId.Value); }
        if (districtId.HasValue) { sql += " AND c.fk_district_id = @DistrictId"; p.Add("DistrictId", districtId.Value); }
        if (!string.IsNullOrWhiteSpace(syncSource) && (syncSource == "Auto" || syncSource == "Manual"))
        { sql += " AND IFNULL(b.SyncSource, 'Manual') = @SyncSource"; p.Add("SyncSource", syncSource); }
        sql += " ORDER BY y.YearLabel DESC, CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber, c.ClubName, dm.sort_order";
        var rows = await conn.QueryAsync<dynamic>(sql, p);
        return Ok(rows);
    }

    [HttpGet("club-announcements")]
    public async Task<ActionResult> ClubAnnouncements([FromQuery] int? yearId, [FromQuery] int? districtId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var sql = @"
            SELECT d.DistrictNumber AS districtNumber, c.ClubName AS clubName,
                   y.YearLabel AS year, a.Title AS title,
                   a.Description AS description,
                   a.PublishDateTime AS publishDate,
                   a.ExpiryDateTime AS expiryDate,
                   a.Status AS status,
                   CASE WHEN a.IsDisplayOnBanner = 1 THEN 'Yes' ELSE 'No' END AS displayBanner
            FROM announcements a
            JOIN club_master c ON c.pk_club_id = a.fk_club_id AND c.isdeleted = 0
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            JOIN rotary_year_master y ON a.PublishDateTime >= y.StartDate AND a.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
            WHERE a.isdeleted = 0";
        var p = new DynamicParameters();
        if (yearId.HasValue) { sql += " AND y.pk_year_id = @YearId"; p.Add("YearId", yearId.Value); }
        if (districtId.HasValue) { sql += " AND c.fk_district_id = @DistrictId"; p.Add("DistrictId", districtId.Value); }
        sql += " ORDER BY a.PublishDateTime DESC";
        var rows = await conn.QueryAsync<dynamic>(sql, p);
        return Ok(rows);
    }

    [HttpGet("club-upcoming-events")]
    public async Task<ActionResult> ClubUpcomingEvents([FromQuery] int? yearId, [FromQuery] int? districtId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var sql = @"
            SELECT d.DistrictNumber AS districtNumber, c.ClubName AS clubName,
                   y.YearLabel AS year, e.Title AS title,
                   e.Description AS description,
                   e.EventDate AS eventDate,
                   e.EventVenue AS venue,
                   e.RegistrationLink AS registrationLink,
                   e.Status AS status
            FROM upcoming_events e
            JOIN club_master c ON c.pk_club_id = e.fk_club_id AND c.isdeleted = 0
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            JOIN rotary_year_master y ON e.PublishDate >= y.StartDate AND e.PublishDate < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
            WHERE e.isdeleted = 0";
        var p = new DynamicParameters();
        if (yearId.HasValue) { sql += " AND y.pk_year_id = @YearId"; p.Add("YearId", yearId.Value); }
        if (districtId.HasValue) { sql += " AND c.fk_district_id = @DistrictId"; p.Add("DistrictId", districtId.Value); }
        sql += " ORDER BY e.EventDate DESC";
        var rows = await conn.QueryAsync<dynamic>(sql, p);
        return Ok(rows);
    }

    [HttpGet("club-attendance")]
    public async Task<ActionResult> ClubAttendance([FromQuery] int? yearId, [FromQuery] int? districtId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var sql = @"
            SELECT d.DistrictNumber AS districtNumber, c.ClubName AS clubName,
                   y.YearLabel AS year, a.EventName AS eventName,
                   a.EventDateTime AS eventDate,
                   a.Description AS description,
                   (SELECT COUNT(*) FROM club_attendance_members m WHERE m.fk_attendance_id = a.pk_attendance_id) AS membersPresent,
                   (SELECT COUNT(*) FROM club_attendance_visitors v WHERE v.fk_attendance_id = a.pk_attendance_id) AS visitors,
                   (SELECT COUNT(*) FROM club_attendance_rotarians r WHERE r.fk_attendance_id = a.pk_attendance_id) AS visitingRotarians
            FROM club_attendance a
            JOIN club_master c ON c.pk_club_id = a.fk_club_id AND c.isdeleted = 0
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            JOIN rotary_year_master y ON y.pk_year_id = a.fk_year_id
            WHERE a.isdeleted = 0";
        var p = new DynamicParameters();
        if (yearId.HasValue) { sql += " AND a.fk_year_id = @YearId"; p.Add("YearId", yearId.Value); }
        if (districtId.HasValue) { sql += " AND c.fk_district_id = @DistrictId"; p.Add("DistrictId", districtId.Value); }
        sql += " ORDER BY a.EventDateTime DESC";
        var rows = await conn.QueryAsync<dynamic>(sql, p);
        return Ok(rows);
    }

    [HttpGet("club-documents")]
    public async Task<ActionResult> ClubDocuments([FromQuery] int? yearId, [FromQuery] int? districtId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var sql = @"
            SELECT d.DistrictNumber AS districtNumber, c.ClubName AS clubName,
                   y.YearLabel AS year, doc.Title AS title,
                   doc.AccessType AS accessType,
                   CASE
                       WHEN doc.FilePath IS NULL OR doc.FilePath = '' THEN NULL
                       WHEN doc.FilePath LIKE '/%' THEN doc.FilePath
                       WHEN doc.fk_district_id IS NOT NULL THEN CONCAT('/Documents/documentsafe/Group', doc.fk_district_id, '/', doc.FilePath)
                       ELSE CONCAT('/Documents/documentsafe/Group', doc.fk_club_id, '/', doc.FilePath)
                   END AS filePath,
                   doc.OriginalFileName AS fileName,
                   doc.PublishDateTime AS publishDate,
                   doc.ExpiryDateTime AS expiryDate,
                   doc.Status AS status
            FROM club_documents doc
            JOIN club_master c ON c.pk_club_id = doc.fk_club_id AND c.isdeleted = 0
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            LEFT JOIN rotary_year_master y ON doc.PublishDateTime >= y.StartDate AND doc.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
            WHERE doc.isdeleted = 0";
        var p = new DynamicParameters();
        if (yearId.HasValue) { sql += " AND y.pk_year_id = @YearId"; p.Add("YearId", yearId.Value); }
        if (districtId.HasValue) { sql += " AND c.fk_district_id = @DistrictId"; p.Add("DistrictId", districtId.Value); }
        sql += " ORDER BY doc.PublishDateTime DESC";
        var rows = await conn.QueryAsync<dynamic>(sql, p);
        return Ok(rows);
    }

    [HttpGet("club-monthly-reports")]
    public async Task<ActionResult> ClubMonthlyReports([FromQuery] int? yearId, [FromQuery] int? districtId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var sql = @"
            SELECT d.DistrictNumber AS districtNumber, c.ClubName AS clubName,
                   y.YearLabel AS year, r.ReportMonth AS month,
                   r.MemberCountLastMonth AS lastMonthCount,
                   r.MembersDeleted AS deleted,
                   r.MembersAdded AS added,
                   r.CurrentMemberCount AS currentCount,
                   CASE WHEN r.IsUploadedToDistrict = 1 THEN 'Yes' ELSE 'No' END AS uploadedToDistrict,
                   r.AdditionalRemarks AS remarks,
                   r.created_date AS createdDate
            FROM club_monthly_reports r
            JOIN club_master c ON c.pk_club_id = r.fk_club_id AND c.isdeleted = 0
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            JOIN rotary_year_master y ON y.pk_year_id = r.fk_year_id
            WHERE r.isdeleted = 0";
        var p = new DynamicParameters();
        if (yearId.HasValue) { sql += " AND r.fk_year_id = @YearId"; p.Add("YearId", yearId.Value); }
        if (districtId.HasValue) { sql += " AND c.fk_district_id = @DistrictId"; p.Add("DistrictId", districtId.Value); }
        sql += " ORDER BY y.YearLabel DESC, CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber, c.ClubName, r.ReportMonth";
        var rows = await conn.QueryAsync<dynamic>(sql, p);
        return Ok(rows);
    }

    [HttpGet("rotary-projects")]
    public async Task<ActionResult> RotaryProjects([FromQuery] int? yearId, [FromQuery] int? districtId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        // Year-wise: pick one table when yearId given, else UNION ALL across all existing.
        var tables = yearId.HasValue
            ? new List<YearTableInfo> { (await _yearTables.ResolveByYearIdAsync(conn, yearId.Value)) }
                .Where(t => t != null).Cast<YearTableInfo>().ToList()
            : await _yearTables.GetAllExistingYearTablesAsync(conn);
        if (tables.Count == 0) return Ok(Array.Empty<object>());

        var districtFilter = districtId.HasValue ? " AND c.fk_district_id = @DistrictId" : "";
        var unionLegs = string.Join(" UNION ALL ", tables.Select(t =>
            $@"SELECT d.DistrictNumber AS districtNumber, c.ClubName AS clubName,
                      '{t.YearLabel}' AS year, md.ModuleName AS serviceType,
                      p.title AS title, p.description AS description, p.location AS location,
                      p.project_date AS projectDate, p.project_cost AS cost,
                      p.direct_beneficiaries AS beneficiaries, p.man_hours AS manHours,
                      p.rotarians_involved AS rotarians, p.rotaractors_involved AS rotaractors,
                      COALESCE(p.rcc_involved,0) AS rcc,
                      p.project_type AS projectType,
                      CASE WHEN p.is_joint_project = 1 THEN 'Yes' ELSE 'No' END AS jointProject,
                      p.co_host_name AS coHost,
                      a.name AS areaOfFocus,
                      f.name AS funding,
                      p.global_grant_number AS globalGrantNumber,
                      p.amount_sanctioned AS amountSanctioned,
                      p.amount_received AS amountReceived,
                      p.amount_spent AS amountSpent,
                      p.host_clubs_districts AS hostClubsDistricts,
                      p.global_partner_clubs_districts AS globalPartnerClubsDistricts,
                      p.csr_company_name AS csrCompanyName
               FROM `{t.ProjectsTable}` p
               JOIN club_master c ON c.pk_club_id = p.fk_club_id AND c.isdeleted = 0
               JOIN district_master d ON d.pk_district_id = c.fk_district_id
               LEFT JOIN module_master md ON md.pk_module_id = p.fk_module_id
               LEFT JOIN area_of_focus_master a ON a.pk_area_of_focus_id = p.fk_area_of_focus_id
               LEFT JOIN funding_master f ON f.pk_funding_id = p.fk_funding_id
               WHERE p.isdeleted = 0{districtFilter}"));

        var p2 = new DynamicParameters();
        if (districtId.HasValue) p2.Add("DistrictId", districtId.Value);
        var rows = await conn.QueryAsync<dynamic>(
            $"SELECT * FROM ({unionLegs}) u ORDER BY u.projectDate DESC", p2);
        return Ok(rows);
    }

    [HttpGet("trf-contributions")]
    public async Task<ActionResult> TrfContributions([FromQuery] int? yearId, [FromQuery] int? districtId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var sql = @"
            SELECT d.DistrictNumber AS districtNumber, c.ClubName AS clubName,
                   y.YearLabel AS year, t.TrfDate AS trfDate,
                   t.DonorName AS donorName,
                   t.AmountUSD AS amountUSD,
                   t.FundType AS fundType,
                   f.FundName AS fundName,
                   t.OtherFundName AS otherFundName
            FROM trf_contributions t
            JOIN club_master c ON c.pk_club_id = t.fk_club_id AND c.isdeleted = 0
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            JOIN rotary_year_master y ON y.pk_year_id = t.fk_year_id
            LEFT JOIN trf_fund_master f ON f.pk_fund_id = t.fk_fund_id
            WHERE t.isdeleted = 0";
        var p = new DynamicParameters();
        if (yearId.HasValue) { sql += " AND t.fk_year_id = @YearId"; p.Add("YearId", yearId.Value); }
        if (districtId.HasValue) { sql += " AND c.fk_district_id = @DistrictId"; p.Add("DistrictId", districtId.Value); }
        sql += " ORDER BY t.TrfDate DESC";
        var rows = await conn.QueryAsync<dynamic>(sql, p);
        return Ok(rows);
    }

    [HttpGet("newsletters")]
    public async Task<ActionResult> Newsletters([FromQuery] int? yearId, [FromQuery] int? districtId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var sql = @"
            SELECT d.DistrictNumber AS districtNumber, c.ClubName AS clubName,
                   y.YearLabel AS year, n.Title AS title,
                   n.PublishDateTime AS publishDate,
                   n.ExpiryDateTime AS expiryDate,
                   n.AttachmentType AS attachmentType,
                   n.LinkUrl AS linkUrl,
                   CASE
                       WHEN n.FilePath IS NULL OR n.FilePath = '' THEN NULL
                       WHEN n.FilePath LIKE '/%' THEN n.FilePath
                       WHEN n.fk_district_id IS NOT NULL AND n.fk_district_id > 0 THEN CONCAT('/Documents/ebulletin/Group', n.fk_district_id, '/', n.FilePath)
                       WHEN n.fk_club_id IS NOT NULL AND n.fk_club_id > 0 THEN CONCAT('/Documents/ebulletin/Group', n.fk_club_id, '/', n.FilePath)
                       ELSE NULL
                   END AS filePath,
                   n.Status AS status
            FROM newsletters n
            JOIN club_master c ON c.pk_club_id = n.fk_club_id AND c.isdeleted = 0
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            JOIN rotary_year_master y ON n.PublishDateTime >= y.StartDate AND n.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
            WHERE n.isdeleted = 0";
        var p = new DynamicParameters();
        if (yearId.HasValue) { sql += " AND y.pk_year_id = @YearId"; p.Add("YearId", yearId.Value); }
        if (districtId.HasValue) { sql += " AND c.fk_district_id = @DistrictId"; p.Add("DistrictId", districtId.Value); }
        sql += " ORDER BY n.PublishDateTime DESC";
        var rows = await conn.QueryAsync<dynamic>(sql, p);
        return Ok(rows);
    }

    // ==================== PHASE 3 — DISTRICT & SPECIALTY REPORTS ====================

    [HttpGet("district-committee")]
    public async Task<ActionResult> DistrictCommittee([FromQuery] int? yearId, [FromQuery] int? districtId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var sql = @"
            SELECT d.DistrictNumber AS districtNumber, y.YearLabel AS year,
                   cm.name AS memberName,
                   CASE WHEN COALESCE(cm.fk_member_id, 0) > 0 AND m.PrimaryMobileNumber IS NOT NULL AND TRIM(m.PrimaryMobileNumber) <> ''
                        THEN m.PrimaryMobileNumber ELSE cm.mobile END AS mobile,
                   CASE WHEN COALESCE(cm.fk_member_id, 0) > 0 AND m.EmailId IS NOT NULL AND TRIM(m.EmailId) <> ''
                        THEN m.EmailId ELSE cm.email END AS email,
                   cm.district_designation AS designation,
                   c.ClubName AS clubName,
                   cm.district_remark AS remark,
                   cm.sort_order AS sortOrder,
                   CASE WHEN cm.is_active = 1 THEN 'Yes' ELSE 'No' END AS isActive
            FROM district_committee_member cm
            JOIN district_master d ON d.pk_district_id = cm.fk_district_id
            JOIN rotary_year_master y ON y.pk_year_id = cm.fk_year_id
            LEFT JOIN club_master c ON c.pk_club_id = cm.fk_club_id
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_id AND m.isdeleted = 0
            WHERE cm.isdeleted = 0";
        var p = new DynamicParameters();
        if (yearId.HasValue) { sql += " AND cm.fk_year_id = @YearId"; p.Add("YearId", yearId.Value); }
        if (districtId.HasValue) { sql += " AND cm.fk_district_id = @DistrictId"; p.Add("DistrictId", districtId.Value); }
        sql += " ORDER BY y.YearLabel DESC, CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber, cm.sort_order";
        var rows = await conn.QueryAsync<dynamic>(sql, p);
        return Ok(rows);
    }

    // AG assignments are year-scoped (district_ag.fk_year_id). Without a yearId, returns
    // every year — useful for cross-year audit; with yearId, returns just that year.
    [HttpGet("assistant-governors")]
    public async Task<ActionResult> AssistantGovernors([FromQuery] int? districtId, [FromQuery] int? yearId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var sql = @"
            SELECT d.DistrictNumber AS districtNumber,
                   c.ClubName AS assignedClub, c.ClubRotaryId AS clubRotaryId,
                   m.MemberName AS memberName, m.EmailId AS email, m.PrimaryMobileNumber AS mobile,
                   m.RotaryId AS rotaryId,
                   y.YearLabel AS yearLabel,
                   CASE WHEN ag.is_active = 1 THEN 'Yes' ELSE 'No' END AS isActive,
                   ag.created_date AS assignedDate
            FROM district_ag ag
            JOIN district_master d ON d.pk_district_id = ag.fk_district_id
            JOIN club_master c ON c.pk_club_id = ag.fk_club_id AND c.isdeleted = 0
            JOIN member_master_profile m ON m.pk_member_master_profile_id = ag.fk_member_id AND m.isdeleted = 0
            LEFT JOIN rotary_year_master y ON y.pk_year_id = ag.fk_year_id
            WHERE ag.isdeleted = 0";
        var p = new DynamicParameters();
        if (districtId.HasValue) { sql += " AND ag.fk_district_id = @DistrictId"; p.Add("DistrictId", districtId.Value); }
        if (yearId.HasValue) { sql += " AND ag.fk_year_id = @YearId"; p.Add("YearId", yearId.Value); }
        sql += " ORDER BY y.YearLabel DESC, CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber, c.ClubName";
        var rows = await conn.QueryAsync<dynamic>(sql, p);
        return Ok(rows);
    }

    [HttpGet("district-upcoming-events")]
    public async Task<ActionResult> DistrictUpcomingEvents([FromQuery] int? yearId, [FromQuery] int? districtId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        // upcoming_events has both club and district events — use Scope/fk_district_id to filter to district scope
        var sql = @"
            SELECT d.DistrictNumber AS districtNumber, y.YearLabel AS year,
                   e.Title AS title, e.Description AS description,
                   e.EventDate AS eventDate, e.EventVenue AS venue,
                   e.RegistrationLink AS registrationLink, e.Status AS status
            FROM upcoming_events e
            JOIN district_master d ON d.pk_district_id = e.fk_district_id
            JOIN rotary_year_master y ON e.PublishDate >= y.StartDate AND e.PublishDate < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
            WHERE e.isdeleted = 0 AND e.fk_district_id IS NOT NULL AND e.Scope = 'district'";
        var p = new DynamicParameters();
        if (yearId.HasValue) { sql += " AND y.pk_year_id = @YearId"; p.Add("YearId", yearId.Value); }
        if (districtId.HasValue) { sql += " AND e.fk_district_id = @DistrictId"; p.Add("DistrictId", districtId.Value); }
        sql += " ORDER BY e.EventDate DESC";
        var rows = await conn.QueryAsync<dynamic>(sql, p);
        return Ok(rows);
    }

    [HttpGet("membership-dues")]
    public async Task<ActionResult> MembershipDues([FromQuery] int? yearId, [FromQuery] int? districtId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        // membership_dues uses RotaryYear VARCHAR — match against rotary_year_master.YearLabel
        var sql = @"
            SELECT d.DistrictNumber AS districtNumber, c.ClubName AS clubName,
                   md.RotaryYear AS rotaryYear,
                   md.Purpose AS purpose,
                   md.DefaultCategoryType AS categoryType,
                   md.DefaultAnnualAmount AS annualAmount,
                   md.DefaultSemi1Amount AS semi1Amount,
                   md.DefaultSemi2Amount AS semi2Amount,
                   md.ModeOfPayment AS modeOfPayment,
                   CASE WHEN md.IsActive = 1 THEN 'Yes' ELSE 'No' END AS isActive,
                   md.created_date AS createdDate
            FROM membership_dues md
            JOIN club_master c ON c.pk_club_id = md.fk_club_id AND c.isdeleted = 0
            JOIN district_master d ON d.pk_district_id = md.fk_district_id
            WHERE md.isdeleted = 0";
        var p = new DynamicParameters();
        if (yearId.HasValue)
        {
            sql += @" AND md.RotaryYear = (SELECT YearLabel FROM rotary_year_master WHERE pk_year_id = @YearId)";
            p.Add("YearId", yearId.Value);
        }
        if (districtId.HasValue) { sql += " AND md.fk_district_id = @DistrictId"; p.Add("DistrictId", districtId.Value); }
        sql += " ORDER BY md.RotaryYear DESC, CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber, c.ClubName";
        var rows = await conn.QueryAsync<dynamic>(sql, p);
        return Ok(rows);
    }

    [HttpGet("event-payment-links")]
    public async Task<ActionResult> EventPaymentLinks([FromQuery] int? districtId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var sql = @"
            SELECT ep.pk_id AS linkId,
                   ep.Title AS title,
                   ep.Description AS description,
                   ep.FormType AS formType,
                   ep.AmountType AS amountType,
                   d.DistrictNumber AS districtNumber,
                   c.ClubName AS clubName,
                   CASE WHEN ep.IsForAllDistricts = 1 THEN 'Yes' ELSE 'No' END AS forAllDistricts,
                   ep.WeblinkUrl AS weblinkUrl,
                   (SELECT COUNT(*) FROM event_payment_registrations r WHERE r.fk_payment_link_id = ep.pk_id) AS registrations,
                   CASE WHEN ep.IsActive = 1 THEN 'Yes' ELSE 'No' END AS isActive,
                   ep.created_date AS createdDate
            FROM event_payment_links ep
            LEFT JOIN district_master d ON d.pk_district_id = ep.fk_district_master_id
            LEFT JOIN club_master c ON c.pk_club_id = ep.fk_club_id
            WHERE ep.isdeleted = 0";
        var p = new DynamicParameters();
        if (districtId.HasValue) { sql += " AND (ep.fk_district_master_id = @DistrictId OR c.fk_district_id = @DistrictId)"; p.Add("DistrictId", districtId.Value); }
        sql += " ORDER BY ep.created_date DESC";
        var rows = await conn.QueryAsync<dynamic>(sql, p);
        return Ok(rows);
    }

    [HttpGet("district-citation")]
    public async Task<ActionResult> DistrictCitation([FromQuery] int? yearId, [FromQuery] int? districtId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var sql = @"
            SELECT d.DistrictNumber AS districtNumber, c.ClubName AS clubName,
                   y.YearLabel AS year,
                   COUNT(DISTINCT ce.pk_id) AS entryCount,
                   SUM(ce.points_earned) AS pointsEarned,
                   SUM(ce.bonus_earned) AS bonusEarned,
                   (SUM(ce.points_earned) + SUM(ce.bonus_earned)) AS totalPoints
            FROM district_citation_club_entry ce
            JOIN club_master c ON c.pk_club_id = ce.fk_club_id AND c.isdeleted = 0
            JOIN district_master d ON d.pk_district_id = ce.fk_district_id
            JOIN rotary_year_master y ON y.pk_year_id = ce.fk_year_id
            WHERE ce.isdeleted = 0";
        var p = new DynamicParameters();
        if (yearId.HasValue) { sql += " AND ce.fk_year_id = @YearId"; p.Add("YearId", yearId.Value); }
        if (districtId.HasValue) { sql += " AND ce.fk_district_id = @DistrictId"; p.Add("DistrictId", districtId.Value); }
        sql += " GROUP BY d.DistrictNumber, c.ClubName, y.YearLabel ORDER BY y.YearLabel DESC, CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber, totalPoints DESC";
        var rows = await conn.QueryAsync<dynamic>(sql, p);
        return Ok(rows);
    }

    // ==================== PHASE 4 — MEMBER & MODULE REPORTS ====================

    // Full member details — profile + each address row + each family member row (denormalized for export).
    // One row per (member × family-member) so admins see entire family grouped.
    [HttpGet("members-full-details")]
    public async Task<ActionResult> MembersFullDetails([FromQuery] int? districtId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var sql = @"
            SELECT m.MemberName AS memberName, m.RotaryId AS rotaryId,
                   m.EmailId AS email, m.PrimaryMobileNumber AS mobile,
                   m.SecondaryMobileNumber AS secondaryMobile,
                   m.Gender AS gender, m.BirthDate AS birthDate, m.AnniversaryDate AS anniversaryDate,
                   m.BloodGroup AS bloodGroup, m.PrimaryLanguage AS language,
                   CASE WHEN cm.IsHonoraryMember = 1 THEN 'Yes' ELSE 'No' END AS isHonorary,
                   CASE WHEN m.IsYouth = 1 THEN 'Yes' ELSE 'No' END AS isYouth,
                   z.ZoneName AS zoneName, d.DistrictNumber AS districtNumber,
                   c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId,
                   " + CogDesignationHelper.JoinedDateExpr("cm") + @" AS joinedDate,
                   " + CogDesignationHelper.SelectColumns("cm") + @",
                   f.Name AS familyName, f.Relation AS familyRelation,
                   f.PhoneNumber AS familyPhone, f.EmailId AS familyEmail,
                   f.BirthDate AS familyBirthDate, f.AnniversaryDate AS familyAnniversaryDate,
                   f.BloodGroup AS familyBloodGroup
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            LEFT JOIN member_family_details f ON f.fk_member_master_profile_id = m.pk_member_master_profile_id AND f.isdeleted = 0
            WHERE cm.isdeleted = 0 AND cm.IsActive = 1";
        var p = new DynamicParameters();
        if (districtId.HasValue) { sql += " AND c.fk_district_id = @DistrictId"; p.Add("DistrictId", districtId.Value); }
        sql += " ORDER BY CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber, c.ClubName, m.MemberName, f.Relation";
        var rows = await conn.QueryAsync<dynamic>(sql, p);
        // ROW: with member.familyDetails off the family columns are blanked (MemberDataGuard), so keep one row per member.
        if (!RotaryApi.Services.Brand.Feature("member.familyDetails"))
            rows = rows.GroupBy(r => { var d = (IDictionary<string, object?>)r; return $"{d["rotaryId"]}|{d["memberName"]}"; })
                       .Select(g => g.First()).ToList();
        return Ok(rows);
    }

    // Compact contact summary — zone, district, club, name, mobile, email
    [HttpGet("members-contact-summary")]
    public async Task<ActionResult> MembersContactSummary([FromQuery] int? districtId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var sql = @"
            SELECT z.ZoneName AS zoneName,
                   d.DistrictNumber AS districtNumber,
                   c.ClubName AS clubName,
                   m.MemberName AS memberName,
                   m.PrimaryMobileNumber AS mobile,
                   m.EmailId AS email
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE cm.isdeleted = 0 AND cm.IsActive = 1";
        var p = new DynamicParameters();
        if (districtId.HasValue) { sql += " AND c.fk_district_id = @DistrictId"; p.Add("DistrictId", districtId.Value); }
        sql += " ORDER BY z.ZoneName, CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber, c.ClubName, m.MemberName";
        var rows = await conn.QueryAsync<dynamic>(sql, p);
        return Ok(rows);
    }

    // Members who have logged in via mobile app (MobileLoginCount > 0) — includes device info
    [HttpGet("mobile-app-users")]
    public async Task<ActionResult> MobileAppUsers([FromQuery] int? districtId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var sql = @"
            SELECT z.ZoneName AS zoneName,
                   d.DistrictNumber AS districtNumber,
                   c.ClubName AS clubName,
                   m.MemberName AS memberName,
                   m.RotaryId AS rotaryId,
                   m.EmailId AS email, m.PrimaryMobileNumber AS mobile,
                   m.MobileLoginCount AS loginCount,
                   m.LastImei AS lastImei,
                   m.LastDeviceName AS lastDeviceName,
                   m.FirstMobileVisit AS firstVisit,
                   m.LastMobileVisit AS lastVisit,
                   m.LastMobileLogout AS lastLogout
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE cm.isdeleted = 0 AND cm.IsActive = 1
              AND COALESCE(m.MobileLoginCount, 0) > 0";
        var p = new DynamicParameters();
        if (districtId.HasValue) { sql += " AND c.fk_district_id = @DistrictId"; p.Add("DistrictId", districtId.Value); }
        sql += " ORDER BY m.LastMobileVisit DESC";
        var rows = await conn.QueryAsync<dynamic>(sql, p);
        return Ok(rows);
    }

    // Members' addresses — both residential and business, one row per address
    [HttpGet("members-addresses")]
    public async Task<ActionResult> MembersAddresses([FromQuery] int? districtId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var sql = @"
            SELECT d.DistrictNumber AS districtNumber,
                   c.ClubName AS clubName,
                   m.MemberName AS memberName,
                   m.RotaryId AS rotaryId,
                   a.AddressType AS addressType,
                   a.Address AS address,
                   a.City AS city, a.State AS state, a.PinCode AS pincode,
                   co.CountryName AS country,
                   a.PhoneNumber AS phone,
                   a.BusinessName AS businessName,
                   a.BusinessEmailId AS businessEmail,
                   cmd.Designation AS designation,
                   cmd.ClassificationProfession AS profession,
                   a.Keywords AS keywords
            FROM member_address_details a
            JOIN member_master_profile m ON m.pk_member_master_profile_id = a.fk_member_master_profile_id AND m.isdeleted = 0
            JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.isdeleted = 0 AND cm.IsActive = 1
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            LEFT JOIN country_master co ON co.pk_country_id = a.fk_country_id
            LEFT JOIN (
                SELECT fk_member_master_profile_id,
                       MAX(Designation) AS Designation,
                       MAX(ClassificationProfession) AS ClassificationProfession
                FROM club_members
                WHERE COALESCE(isdeleted, 0) = 0
                GROUP BY fk_member_master_profile_id
            ) cmd ON cmd.fk_member_master_profile_id = m.pk_member_master_profile_id
            WHERE a.isdeleted = 0";
        var p = new DynamicParameters();
        if (districtId.HasValue) { sql += " AND c.fk_district_id = @DistrictId"; p.Add("DistrictId", districtId.Value); }
        sql += " ORDER BY CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber, c.ClubName, m.MemberName, a.AddressType";
        var rows = await conn.QueryAsync<dynamic>(sql, p);
        return Ok(rows);
    }

    // Club weblinks (external links attached to club)
    [HttpGet("club-weblinks")]
    public async Task<ActionResult> ClubWeblinks([FromQuery] int? districtId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var sql = @"
            SELECT d.DistrictNumber AS districtNumber, c.ClubName AS clubName,
                   w.Level AS level,
                   w.Title AS title,
                   w.LinkType AS linkType,
                   w.LinkUrl AS linkUrl,
                   CASE
                       WHEN w.PdfPath IS NULL OR w.PdfPath = '' THEN NULL
                       WHEN w.PdfPath LIKE '/%' THEN w.PdfPath
                       WHEN w.fk_district_id IS NOT NULL THEN CONCAT('/Documents/Weblink/Group', w.fk_district_id, '/', w.PdfPath)
                       ELSE CONCAT('/Documents/Weblink/Group', w.fk_club_id, '/', w.PdfPath)
                   END AS pdfPath,
                   w.YoutubeUrl AS youtubeUrl,
                   w.ButtonText AS buttonText,
                   w.SortOrder AS sortOrder,
                   CASE WHEN w.IsActive = 1 THEN 'Yes' ELSE 'No' END AS isActive
            FROM weblinks w
            JOIN club_master c ON c.pk_club_id = w.fk_club_id AND c.isdeleted = 0
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            WHERE w.isdeleted = 0";
        var p = new DynamicParameters();
        if (districtId.HasValue) { sql += " AND c.fk_district_id = @DistrictId"; p.Add("DistrictId", districtId.Value); }
        sql += " ORDER BY CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber, c.ClubName, w.Level, w.SortOrder";
        var rows = await conn.QueryAsync<dynamic>(sql, p);
        return Ok(rows);
    }

    // Potential members (prospects)
    [HttpGet("potential-members")]
    public async Task<ActionResult> PotentialMembers([FromQuery] int? districtId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var sql = @"
            SELECT d.DistrictNumber AS districtNumber, c.ClubName AS clubName,
                   pm.name AS name,
                   pm.email AS email,
                   pm.mobile_number AS mobile,
                   pm.reference_details AS referenceDetails,
                   pm.created_date AS createdDate
            FROM potential_members pm
            JOIN club_master c ON c.pk_club_id = pm.fk_club_id AND c.isdeleted = 0
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            WHERE pm.isdeleted = 0";
        var p = new DynamicParameters();
        if (districtId.HasValue) { sql += " AND c.fk_district_id = @DistrictId"; p.Add("DistrictId", districtId.Value); }
        sql += " ORDER BY CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber, c.ClubName, pm.created_date DESC";
        var rows = await conn.QueryAsync<dynamic>(sql, p);
        return Ok(rows);
    }

    // Club mass emails (campaign log)
    [HttpGet("club-mass-emails")]
    public async Task<ActionResult> ClubMassEmails([FromQuery] int? districtId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var sql = @"
            SELECT d.DistrictNumber AS districtNumber, c.ClubName AS clubName,
                   me.FromName AS fromName,
                   me.ReplyName AS replyName,
                   me.ReplyEmail AS replyEmail,
                   me.Subject AS subject,
                   me.Status AS status,
                   me.TotalRecipients AS totalRecipients,
                   me.SentCount AS sentCount,
                   me.FailedCount AS failedCount,
                   me.SentDate AS sentDate,
                   me.created_date AS createdDate
            FROM club_mass_emails me
            JOIN club_master c ON c.pk_club_id = me.fk_club_id AND c.isdeleted = 0
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            WHERE me.isdeleted = 0";
        var p = new DynamicParameters();
        if (districtId.HasValue) { sql += " AND c.fk_district_id = @DistrictId"; p.Add("DistrictId", districtId.Value); }
        sql += " ORDER BY me.created_date DESC";
        var rows = await conn.QueryAsync<dynamic>(sql, p);
        return Ok(rows);
    }

    // OCV documents (governor's office documents per club per year)
    [HttpGet("ocv-documents")]
    public async Task<ActionResult> OcvDocuments([FromQuery] int? yearId, [FromQuery] int? districtId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var sql = @"
            SELECT d.DistrictNumber AS districtNumber, c.ClubName AS clubName,
                   y.YearLabel AS year,
                   cat.CategoryName AS category,
                   t.TypeName AS type,
                   doc.CustomTypeName AS customType,
                   doc.OriginalFileName AS fileName,
                   CASE
                       WHEN doc.FilePath IS NULL OR doc.FilePath = '' THEN NULL
                       WHEN doc.FilePath LIKE '/%' THEN doc.FilePath
                       ELSE CONCAT('/Documents/OCV/Group', doc.fk_club_id, '/', doc.FilePath)
                   END AS filePath,
                   doc.FileSize AS fileSize,
                   doc.Amount AS amount,
                   doc.PaidOn AS paidOn,
                   doc.created_date AS createdDate
            FROM ocv_documents doc
            JOIN club_master c ON c.pk_club_id = doc.fk_club_id AND c.isdeleted = 0
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            JOIN rotary_year_master y ON y.pk_year_id = doc.fk_year_id
            LEFT JOIN ocv_document_category cat ON cat.pk_category_id = doc.fk_category_id
            LEFT JOIN ocv_document_type t ON t.pk_type_id = doc.fk_type_id
            WHERE doc.isdeleted = 0";
        var p = new DynamicParameters();
        if (yearId.HasValue) { sql += " AND doc.fk_year_id = @YearId"; p.Add("YearId", yearId.Value); }
        if (districtId.HasValue) { sql += " AND c.fk_district_id = @DistrictId"; p.Add("DistrictId", districtId.Value); }
        sql += " ORDER BY doc.created_date DESC";
        var rows = await conn.QueryAsync<dynamic>(sql, p);
        return Ok(rows);
    }

    // Club social links (NOT year-wise — one set per club)
    [HttpGet("club-social-links")]
    public async Task<ActionResult> ClubSocialLinks([FromQuery] int? districtId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var sql = @"
            SELECT d.DistrictNumber AS districtNumber, c.ClubName AS clubName,
                   sl.platform AS platform,
                   sl.link_url AS linkUrl,
                   sl.sort_order AS sortOrder,
                   CASE WHEN sl.is_active = 1 THEN 'Yes' ELSE 'No' END AS isActive
            FROM club_website_social_link sl
            JOIN club_master c ON c.pk_club_id = sl.fk_club_id AND c.isdeleted = 0
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            WHERE sl.isdeleted = 0";
        var p = new DynamicParameters();
        if (districtId.HasValue) { sql += " AND c.fk_district_id = @DistrictId"; p.Add("DistrictId", districtId.Value); }
        sql += " ORDER BY CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber, c.ClubName, sl.sort_order";
        var rows = await conn.QueryAsync<dynamic>(sql, p);
        return Ok(rows);
    }
}
