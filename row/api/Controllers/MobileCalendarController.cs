using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/mobile")]
[Authorize]
public class MobileCalendarController : ControllerBase
{
    private readonly string _connectionString;

    public MobileCalendarController(IConfiguration config)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);
    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    // ══════════════════════════════════════════════
    // Club Calendar
    // ══════════════════════════════════════════════

    // ── My clubs list ──
    [HttpGet("club-calendar/my-clubs")]
    public async Task<ActionResult> GetMyClubs()
    {
        var memberId = GetUserId();
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var clubs = await conn.QueryAsync<dynamic>(@"
            SELECT c.pk_club_id AS clubId, c.ClubName AS clubName,
                   CASE
                       WHEN c.ClubLogoPath IS NULL OR c.ClubLogoPath = '' THEN NULL
                       WHEN c.ClubLogoPath LIKE '/%' THEN c.ClubLogoPath
                       ELSE CONCAT('/uploads/club/', c.ClubLogoPath)
                   END AS clubLogo,
                   d.DistrictNumber AS districtNumber
            FROM club_members cm
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            WHERE cm.fk_member_master_profile_id = @MemberId AND cm.IsActive = 1 AND cm.isdeleted = 0
            ORDER BY c.ClubName",
            new { MemberId = memberId });

        return Ok(clubs);
    }

    // ── Club calendar data ──
    [HttpGet("club-calendar/{clubId}")]
    public async Task<ActionResult> GetClubCalendar(int clubId, [FromQuery] int? month, [FromQuery] int? year)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var now = DateTime.Now;
        int m = month ?? now.Month;
        int y = year ?? now.Year;
        var monthStart = new DateTime(y, m, 1);
        var monthEnd = monthStart.AddMonths(1).AddSeconds(-1);

        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Birthdays — match by month (recurring yearly). Includes contact + designation + classification.
        // Both `Designation` and `ClassificationProfession` live on club_members per the
        // designation refactor (project memory 2026-06-22) — surface both so mobile can show
        // a clear job/role label next to the birthday card.
        var birthdays = await conn.QueryAsync<dynamic>(@"
            SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS memberName,
                   CASE
                       WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                       WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                       ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                   END AS profilePhoto,
                   DATE_FORMAT(m.BirthDate, '%d-%m') AS birthDate,
                   DAY(m.BirthDate) AS day,
                   m.EmailId AS email,
                   m.PrimaryMobileNumber AS primaryMobile,
                   m.SecondaryMobileNumber AS secondaryMobile,
                   NULLIF(TRIM(cm.Designation), '') AS designation,
                   NULLIF(TRIM(cm.ClassificationProfession), '') AS classificationProfession
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0
              AND m.BirthDate IS NOT NULL AND MONTH(m.BirthDate) = @Month
            ORDER BY DAY(m.BirthDate)",
            new { ClubId = clubId, Month = m });

        // Anniversaries — match by month (recurring yearly). Includes spouse name + contact + designation + classification.
        var anniversaries = await conn.QueryAsync<dynamic>(@"
            SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS memberName,
                   CASE
                       WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                       WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                       ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                   END AS profilePhoto,
                   DATE_FORMAT(m.AnniversaryDate, '%d-%m') AS anniversaryDate,
                   DAY(m.AnniversaryDate) AS day,
                   m.EmailId AS email,
                   m.PrimaryMobileNumber AS primaryMobile,
                   m.SecondaryMobileNumber AS secondaryMobile,
                   NULLIF(TRIM(cm.Designation), '') AS designation,
                   NULLIF(TRIM(cm.ClassificationProfession), '') AS classificationProfession,
                   spouse.Name AS spouseName
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            LEFT JOIN member_family_details spouse ON spouse.fk_member_master_profile_id = m.pk_member_master_profile_id AND spouse.Relation = 'Spouse' AND spouse.isdeleted = 0
            WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0
              AND m.AnniversaryDate IS NOT NULL AND MONTH(m.AnniversaryDate) = @Month
            ORDER BY DAY(m.AnniversaryDate)",
            new { ClubId = clubId, Month = m });

        // Family birthdays (spouse + children) for every member in this club, matched by month (recurring yearly).
        // Includes contact fields + country code + phone dial code.
        var familyBirthdays = await conn.QueryAsync<dynamic>(@"
            SELECT fd.pk_member_family_details_id AS familyId,
                   fd.fk_member_master_profile_id AS memberId,
                   m.MemberName AS memberName,
                   cm.Designation AS designation,
                   cm.ClassificationProfession AS classificationProfession,
                   fd.Name AS familyMemberName,
                   fd.Relation AS relation,
                   DATE_FORMAT(fd.BirthDate, '%d-%m') AS birthDate,
                   DAY(fd.BirthDate) AS day,
                   CASE
                       WHEN fd.PhotoPath IS NULL OR fd.PhotoPath = '' THEN NULL
                       WHEN fd.PhotoPath LIKE '/%' THEN fd.PhotoPath
                       ELSE CONCAT('/uploads/family/', fd.PhotoPath)
                   END AS profilePhoto,
                   COALESCE(NULLIF(TRIM(fd.EmailId), ''), m.EmailId) AS email,
                   COALESCE(NULLIF(TRIM(fd.PhoneNumber), ''), m.PrimaryMobileNumber) AS mobile,
                   country.CountryCode AS countryCode,
                   country.PhoneCode AS phoneCode
            FROM member_family_details fd
            JOIN member_master_profile m ON m.pk_member_master_profile_id = fd.fk_member_master_profile_id AND m.isdeleted = 0
            JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.IsActive = 1 AND cm.isdeleted = 0
            LEFT JOIN country_master country ON country.pk_country_id = fd.fk_country_id AND country.isdeleted = 0
            WHERE cm.fk_club_id = @ClubId
              AND fd.isdeleted = 0
              AND fd.BirthDate IS NOT NULL AND MONTH(fd.BirthDate) = @Month
            ORDER BY DAY(fd.BirthDate), m.MemberName",
            new { ClubId = clubId, Month = m });

        // Family anniversaries (spouse + others with AnniversaryDate), matched by month.
        // Includes contact fields + country code + phone dial code.
        // Email + mobile fall back to the parent member when the family record
        // has none — spouse/child rows rarely carry their own contact details,
        // so showing the member's was the user's intent (2026-06-13).
        var familyAnniversaries = await conn.QueryAsync<dynamic>(@"
            SELECT fd.pk_member_family_details_id AS familyId,
                   fd.fk_member_master_profile_id AS memberId,
                   m.MemberName AS memberName,
                   cm.Designation AS designation,
                   cm.ClassificationProfession AS classificationProfession,
                   fd.Name AS familyMemberName,
                   fd.Relation AS relation,
                   DATE_FORMAT(fd.AnniversaryDate, '%d-%m') AS anniversaryDate,
                   DAY(fd.AnniversaryDate) AS day,
                   CASE
                       WHEN fd.PhotoPath IS NULL OR fd.PhotoPath = '' THEN NULL
                       WHEN fd.PhotoPath LIKE '/%' THEN fd.PhotoPath
                       ELSE CONCAT('/uploads/family/', fd.PhotoPath)
                   END AS profilePhoto,
                   COALESCE(NULLIF(TRIM(fd.EmailId), ''), m.EmailId) AS email,
                   COALESCE(NULLIF(TRIM(fd.PhoneNumber), ''), m.PrimaryMobileNumber) AS mobile,
                   country.CountryCode AS countryCode,
                   country.PhoneCode AS phoneCode
            FROM member_family_details fd
            JOIN member_master_profile m ON m.pk_member_master_profile_id = fd.fk_member_master_profile_id AND m.isdeleted = 0
            JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.IsActive = 1 AND cm.isdeleted = 0
            LEFT JOIN country_master country ON country.pk_country_id = fd.fk_country_id AND country.isdeleted = 0
            WHERE cm.fk_club_id = @ClubId
              AND fd.isdeleted = 0
              AND fd.AnniversaryDate IS NOT NULL AND MONTH(fd.AnniversaryDate) = @Month
            ORDER BY DAY(fd.AnniversaryDate), m.MemberName",
            new { ClubId = clubId, Month = m });

        // Upcoming events — match by date range
        var upcomingEvents = await conn.QueryAsync<dynamic>(@"
            SELECT pk_upcoming_event_id AS id, Title AS title, Description AS description,
                   CASE
                       WHEN ImagePath IS NULL OR ImagePath = '' THEN NULL
                       WHEN ImagePath LIKE '/%' THEN ImagePath
                       WHEN fk_district_id IS NOT NULL THEN CONCAT('/Documents/Event/Group', fk_district_id, '/', ImagePath)
                       ELSE CONCAT('/Documents/Event/Group', fk_club_id, '/', ImagePath)
                   END AS imagePath,
                   EventDate AS eventDate, EventVenue AS eventVenue,
                   RegistrationLink AS registrationLink,
                   PublishDate AS publishDate, ExpiryDate AS expiryDate
            FROM upcoming_events
            WHERE fk_club_id = @ClubId AND isdeleted = 0
              AND EventDate >= @MonthStart AND EventDate <= @MonthEnd
            ORDER BY EventDate",
            new { ClubId = clubId, MonthStart = monthStart, MonthEnd = monthEnd });

        return Ok(new
        {
            month = m,
            year = y,
            monthLabel = monthStart.ToString("MMMM yyyy"),
            birthdays,
            familyBirthdays,
            anniversaries,
            familyAnniversaries,
            upcomingEvents
        });
    }

    // ══════════════════════════════════════════════
    // District Calendar
    // ══════════════════════════════════════════════

    // ── My districts list ──
    [HttpGet("district-calendar/my-districts")]
    public async Task<ActionResult> GetMyDistricts()
    {
        var memberId = GetUserId();
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var districts = await conn.QueryAsync<dynamic>(@"
            SELECT DISTINCT d.pk_district_id AS districtId, d.DistrictNumber AS districtNumber,
                   z.ZoneName AS zoneName
            FROM club_members cm
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
            JOIN district_master d ON d.pk_district_id = c.fk_district_id AND d.isdeleted = 0
            LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE cm.fk_member_master_profile_id = @MemberId AND cm.IsActive = 1 AND cm.isdeleted = 0
            ORDER BY CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber",
            new { MemberId = memberId });

        return Ok(districts);
    }

    // ── District calendar data (district events only) ──
    [HttpGet("district-calendar/{districtId}")]
    public async Task<ActionResult> GetDistrictCalendar(int districtId, [FromQuery] int? month, [FromQuery] int? year)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        var now = DateTime.Now;
        int m = month ?? now.Month;
        int y = year ?? now.Year;
        var monthStart = new DateTime(y, m, 1);
        var monthEnd = monthStart.AddMonths(1).AddSeconds(-1);

        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Birthdays — all members in every club under this district, matched by month (recurring yearly).
        // Includes contact + classification.
        var birthdays = await conn.QueryAsync<dynamic>(@"
            SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS memberName,
                   CASE
                       WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                       WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                       ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                   END AS profilePhoto,
                   DATE_FORMAT(m.BirthDate, '%d-%m') AS birthDate,
                   DAY(m.BirthDate) AS day,
                   c.pk_club_id AS clubId, c.ClubName AS clubName,
                   m.EmailId AS email,
                   m.PrimaryMobileNumber AS primaryMobile,
                   m.SecondaryMobileNumber AS secondaryMobile,
                   NULLIF(TRIM(cm.Designation), '') AS designation,
                   NULLIF(TRIM(cm.ClassificationProfession), '') AS classificationProfession
            FROM club_members cm
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            WHERE c.fk_district_id = @DistrictId
              AND cm.IsActive = 1 AND cm.isdeleted = 0
              AND m.BirthDate IS NOT NULL AND MONTH(m.BirthDate) = @Month
            ORDER BY DAY(m.BirthDate), m.MemberName",
            new { DistrictId = districtId, Month = m });

        // Family birthdays (spouse + children) for every member in this district, matched by month.
        // Includes contact fields + country code + phone dial code.
        var familyBirthdays = await conn.QueryAsync<dynamic>(@"
            SELECT fd.pk_member_family_details_id AS familyId,
                   fd.fk_member_master_profile_id AS memberId,
                   m.MemberName AS memberName,
                   cm.Designation AS designation,
                   cm.ClassificationProfession AS classificationProfession,
                   fd.Name AS familyMemberName,
                   fd.Relation AS relation,
                   DATE_FORMAT(fd.BirthDate, '%d-%m') AS birthDate,
                   DAY(fd.BirthDate) AS day,
                   CASE
                       WHEN fd.PhotoPath IS NULL OR fd.PhotoPath = '' THEN NULL
                       WHEN fd.PhotoPath LIKE '/%' THEN fd.PhotoPath
                       ELSE CONCAT('/uploads/family/', fd.PhotoPath)
                   END AS profilePhoto,
                   COALESCE(NULLIF(TRIM(fd.EmailId), ''), m.EmailId) AS email,
                   COALESCE(NULLIF(TRIM(fd.PhoneNumber), ''), m.PrimaryMobileNumber) AS mobile,
                   country.CountryCode AS countryCode,
                   country.PhoneCode AS phoneCode,
                   c.pk_club_id AS clubId, c.ClubName AS clubName
            FROM member_family_details fd
            JOIN member_master_profile m ON m.pk_member_master_profile_id = fd.fk_member_master_profile_id AND m.isdeleted = 0
            JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.IsActive = 1 AND cm.isdeleted = 0
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
            LEFT JOIN country_master country ON country.pk_country_id = fd.fk_country_id AND country.isdeleted = 0
            WHERE c.fk_district_id = @DistrictId
              AND fd.isdeleted = 0
              AND fd.BirthDate IS NOT NULL AND MONTH(fd.BirthDate) = @Month
            ORDER BY DAY(fd.BirthDate), m.MemberName",
            new { DistrictId = districtId, Month = m });

        // Anniversaries — all members in every club under this district, matched by month.
        // Includes spouse name + contact + classification.
        var anniversaries = await conn.QueryAsync<dynamic>(@"
            SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS memberName,
                   CASE
                       WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                       WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                       ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                   END AS profilePhoto,
                   DATE_FORMAT(m.AnniversaryDate, '%d-%m') AS anniversaryDate,
                   DAY(m.AnniversaryDate) AS day,
                   c.pk_club_id AS clubId, c.ClubName AS clubName,
                   m.EmailId AS email,
                   m.PrimaryMobileNumber AS primaryMobile,
                   m.SecondaryMobileNumber AS secondaryMobile,
                   NULLIF(TRIM(cm.Designation), '') AS designation,
                   NULLIF(TRIM(cm.ClassificationProfession), '') AS classificationProfession,
                   spouse.Name AS spouseName
            FROM club_members cm
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            LEFT JOIN member_family_details spouse ON spouse.fk_member_master_profile_id = m.pk_member_master_profile_id AND spouse.Relation = 'Spouse' AND spouse.isdeleted = 0
            WHERE c.fk_district_id = @DistrictId
              AND cm.IsActive = 1 AND cm.isdeleted = 0
              AND m.AnniversaryDate IS NOT NULL AND MONTH(m.AnniversaryDate) = @Month
            ORDER BY DAY(m.AnniversaryDate), m.MemberName",
            new { DistrictId = districtId, Month = m });

        // District upcoming events only (fk_district_id set, not club events)
        var upcomingEvents = await conn.QueryAsync<dynamic>(@"
            SELECT pk_upcoming_event_id AS id, Title AS title, Description AS description,
                   CASE
                       WHEN ImagePath IS NULL OR ImagePath = '' THEN NULL
                       WHEN ImagePath LIKE '/%' THEN ImagePath
                       WHEN fk_district_id IS NOT NULL THEN CONCAT('/Documents/Event/Group', fk_district_id, '/', ImagePath)
                       ELSE CONCAT('/Documents/Event/Group', fk_club_id, '/', ImagePath)
                   END AS imagePath,
                   EventDate AS eventDate, EventVenue AS eventVenue,
                   RegistrationLink AS registrationLink,
                   PublishDate AS publishDate, ExpiryDate AS expiryDate
            FROM upcoming_events
            WHERE fk_district_id = @DistrictId AND (fk_club_id = 0 OR fk_club_id IS NULL) AND isdeleted = 0
              AND EventDate >= @MonthStart AND EventDate <= @MonthEnd
            ORDER BY EventDate",
            new { DistrictId = districtId, MonthStart = monthStart, MonthEnd = monthEnd });

        // Family anniversaries (spouse + others with AnniversaryDate) for every member in this district, matched by month.
        // Includes contact fields + country code + phone dial code.
        var familyAnniversaries = await conn.QueryAsync<dynamic>(@"
            SELECT fd.pk_member_family_details_id AS familyId,
                   fd.fk_member_master_profile_id AS memberId,
                   m.MemberName AS memberName,
                   cm.Designation AS designation,
                   cm.ClassificationProfession AS classificationProfession,
                   fd.Name AS familyMemberName,
                   fd.Relation AS relation,
                   DATE_FORMAT(fd.AnniversaryDate, '%d-%m') AS anniversaryDate,
                   DAY(fd.AnniversaryDate) AS day,
                   CASE
                       WHEN fd.PhotoPath IS NULL OR fd.PhotoPath = '' THEN NULL
                       WHEN fd.PhotoPath LIKE '/%' THEN fd.PhotoPath
                       ELSE CONCAT('/uploads/family/', fd.PhotoPath)
                   END AS profilePhoto,
                   COALESCE(NULLIF(TRIM(fd.EmailId), ''), m.EmailId) AS email,
                   COALESCE(NULLIF(TRIM(fd.PhoneNumber), ''), m.PrimaryMobileNumber) AS mobile,
                   country.CountryCode AS countryCode,
                   country.PhoneCode AS phoneCode,
                   c.pk_club_id AS clubId, c.ClubName AS clubName
            FROM member_family_details fd
            JOIN member_master_profile m ON m.pk_member_master_profile_id = fd.fk_member_master_profile_id AND m.isdeleted = 0
            JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.IsActive = 1 AND cm.isdeleted = 0
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
            LEFT JOIN country_master country ON country.pk_country_id = fd.fk_country_id AND country.isdeleted = 0
            WHERE c.fk_district_id = @DistrictId
              AND fd.isdeleted = 0
              AND fd.AnniversaryDate IS NOT NULL AND MONTH(fd.AnniversaryDate) = @Month
            ORDER BY DAY(fd.AnniversaryDate), m.MemberName",
            new { DistrictId = districtId, Month = m });

        // District announcements for this month
        var announcements = await conn.QueryAsync<dynamic>(@"
            SELECT pk_announcement_id AS id, Title AS title, Description AS description,
                   CASE
                       WHEN ImagePath IS NULL OR ImagePath = '' THEN NULL
                       WHEN ImagePath LIKE '/%' THEN ImagePath
                       WHEN fk_district_id IS NOT NULL THEN CONCAT('/Documents/announcement/Group', fk_district_id, '/', ImagePath)
                       ELSE CONCAT('/Documents/announcement/Group', fk_club_id, '/', ImagePath)
                   END AS imagePath,
                   PublishDateTime AS publishDate, ExpiryDateTime AS expiryDate
            FROM announcements
            WHERE fk_district_id = @DistrictId AND (fk_club_id = 0 OR fk_club_id IS NULL) AND isdeleted = 0
              AND PublishDateTime >= @MonthStart AND PublishDateTime <= @MonthEnd
            ORDER BY PublishDateTime",
            new { DistrictId = districtId, MonthStart = monthStart, MonthEnd = monthEnd });

        return Ok(new
        {
            month = m,
            year = y,
            monthLabel = monthStart.ToString("MMMM yyyy"),
            birthdays,
            familyBirthdays,
            anniversaries,
            familyAnniversaries,
            upcomingEvents,
            announcements
        });
    }
}
