using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

// Public read-only data feeds for the multi-tenant club-website Next.js app.
// Every endpoint requires the (club -> district -> zone) chain to be active —
// any inactive link in the chain returns 404 so an admin's kill-switch
// also takes the public site offline immediately.

[ApiController]
[Route("api/public/club")]
[AllowAnonymous]
public class ClubWebsitePublicDataController : ControllerBase
{
    private readonly string _connectionString;

    // Module keys understood as project/meeting buckets.
    // Spec: Projects = all Avenues of Service + Public Image Initiative EXCEPT Club Service.
    //       Meetings = Club Service only.
    // Home-page Avenues tile expects club_service alongside the other 5, so
    // we include it in /projects too. /meetings still returns the same rows
    // (filtered to club_service) for the dedicated Meetings page.
    private static readonly string[] ProjectModuleKeys = new[]
    {
        "community_service", "vocational_service", "international_service",
        "new_generation_service", "public_image_initiative", "club_service",
    };
    private const string MeetingsModuleKey = "club_service";

    private readonly IYearTableResolver _yearTables;

    public ClubWebsitePublicDataController(IConfiguration config, IYearTableResolver yearTables)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        _yearTables = yearTables;
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    private MySqlConnection CreateConn() => new(_connectionString);

    // Returns true only if the club has a (paid or trial) website AND
    // its club/district/zone are all active+not-deleted. Used as a single
    // guard at the top of every endpoint so a kill-switched site goes dark.
    private async Task<bool> IsClubServiceableAsync(MySqlConnection conn, int clubId)
    {
        var count = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*)
            FROM club_websites w
            JOIN club_master c   ON c.pk_club_id      = w.fk_club_id
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            JOIN zone_master z   ON z.pk_zone_id      = d.fk_zone_id
            WHERE w.fk_club_id = @ClubId
              AND w.isdeleted = 0
              AND c.isdeleted = 0 AND c.IsActive = 1
              AND d.isdeleted = 0 AND d.IsActive = 1
              AND z.isdeleted = 0 AND z.IsActive = 1",
            new { ClubId = clubId });
        return count > 0;
    }

    // ── Years (only years that have data anywhere) ─────────────────────────

    public class YearOptionDto
    {
        public int Id { get; set; }
        public string YearLabel { get; set; } = "";
        public bool IsCurrent { get; set; }
    }

    // Returns distinct rotary years that have data for this club across
    // BOD / projects / events / past-presidents. Drives the public year filter.
    [HttpGet("{clubId:int}/years")]
    public async Task<ActionResult<IEnumerable<YearOptionDto>>> GetYears(int clubId)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsClubServiceableAsync(conn, clubId)) return NotFound();

        // Year-wise projects: union across every existing year-wise table where this club has data.
        var projectTables = await _yearTables.GetAllExistingYearTablesAsync(conn);
        var yearProjLegs = projectTables.Count == 0 ? "SELECT NULL AS fk_year_id WHERE 1=0" :
            string.Join(" UNION ", projectTables.Select(t =>
                $"(SELECT {t.YearId} AS fk_year_id FROM `{t.ProjectsTable}` WHERE fk_club_id = @ClubId AND isdeleted = 0 AND is_active = 1 LIMIT 1)"));

        var rows = await conn.QueryAsync<YearOptionDto>($@"
            SELECT y.pk_year_id AS Id, y.YearLabel AS YearLabel, y.IsCurrent AS IsCurrent
            FROM rotary_year_master y
            WHERE y.pk_year_id IN (
                SELECT DISTINCT fk_year_id FROM board_of_directors
                  WHERE fk_club_id = @ClubId AND isdeleted = 0
                UNION
                SELECT fk_year_id FROM ({yearProjLegs}) yp
                UNION
                SELECT DISTINCT y2.pk_year_id FROM upcoming_events ue
                  JOIN rotary_year_master y2 ON ue.EventDate >= y2.StartDate AND ue.EventDate < DATE_ADD(y2.EndDate, INTERVAL 1 DAY)
                  WHERE ue.fk_club_id = @ClubId AND ue.isdeleted = 0 AND ue.IsActive = 1
                UNION
                SELECT DISTINCT fk_year_id FROM past_presidents
                  WHERE fk_club_id = @ClubId AND isdeleted = 0
                -- Always offer the CURRENT rotary year, even before the club has
                -- entered any BOD/project/event data for it (a brand-new Rotary
                -- year starts every July 1st, so for the first weeks of the year
                -- most clubs have nothing yet). Without this, a new club with no
                -- 2026-27 data yet would never see it in the selector at all and
                -- the site would look stuck on last year with no '(Current)' tag
                -- anywhere.
                UNION
                SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1
            )
            ORDER BY y.pk_year_id DESC",
            new { ClubId = clubId });
        return Ok(rows);
    }

    // ── About + contact + social (a single payload for the About page) ─────

    public class AboutDto
    {
        public string ClubName { get; set; } = "";
        public string? DistrictNumber { get; set; }  // string in DB (e.g. "5656", "3030")
        public string? ClubLogoPath { get; set; }
        public string? RotaryLogoPath { get; set; }       // Second logo (per-club Rotary mark) — added 2026-06-25
        public string? Content { get; set; }              // rich HTML from club_website_about
        public List<ContactRow> Contacts { get; set; } = new();
        public List<SocialRow> Socials { get; set; } = new();
        // Meeting + address fields straight from club_master so the home page
        // can render them without parsing the About HTML.
        public string? MeetingDay { get; set; }
        public string? MeetingFromTime { get; set; }      // HH:mm
        public string? MeetingToTime { get; set; }        // HH:mm
        public string? MeetingAddress { get; set; }
        public string? City { get; set; }
        public string? State { get; set; }
        public string? Pincode { get; set; }
        public decimal? Latitude { get; set; }
        public decimal? Longitude { get; set; }
    }
    public class ContactRow { public int YearId { get; set; } public string Email { get; set; } = ""; public string Phone { get; set; } = ""; }
    public class SocialRow  { public string Platform { get; set; } = ""; public string LinkUrl { get; set; } = ""; }

    [HttpGet("{clubId:int}/about")]
    public async Task<ActionResult<AboutDto>> GetAbout(int clubId, [FromQuery] int? yearId)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsClubServiceableAsync(conn, clubId)) return NotFound();

        var resolvedYearId = yearId ?? await ResolveYearAsync(conn, clubId);

        // Pull club identity + most-recent about content (year-filtered if provided).
        var about = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT c.ClubName AS clubName, d.DistrictNumber AS districtNumber,
                   -- Club logo lives in the shared /Documents/group/ folder (legacy convention).
                   CASE
                       WHEN c.ClubLogoPath IS NULL OR c.ClubLogoPath = '' THEN NULL
                       WHEN c.ClubLogoPath LIKE 'http%' THEN c.ClubLogoPath
                       WHEN c.ClubLogoPath LIKE '/%' THEN c.ClubLogoPath
                       ELSE CONCAT('/Documents/group/', c.ClubLogoPath)
                   END AS clubLogoPath,
                   -- Rotary logo lives in the per-club /Documents/WebsiteData/Group{clubId}/LOGO/ folder.
                   CASE
                       WHEN c.RotaryLogoPath IS NULL OR c.RotaryLogoPath = '' THEN NULL
                       WHEN c.RotaryLogoPath LIKE 'http%' THEN c.RotaryLogoPath
                       WHEN c.RotaryLogoPath LIKE '/%' THEN c.RotaryLogoPath
                       ELSE CONCAT('/Documents/WebsiteData/Group', c.pk_club_id, '/LOGO/', c.RotaryLogoPath)
                   END AS rotaryLogoPath,
                   c.MeetingDay AS meetingDay,
                   TIME_FORMAT(c.MeetingFromTime, '%H:%i') AS meetingFromTime,
                   TIME_FORMAT(c.MeetingToTime, '%H:%i') AS meetingToTime,
                   c.MeetingAddress AS meetingAddress,
                   c.City AS city, c.State AS state, c.Pincode AS pincode,
                   c.Latitude AS latitude, c.Longitude AS longitude,
                   (SELECT a.content FROM club_website_about a
                      WHERE a.fk_club_id = c.pk_club_id
                        AND a.isdeleted = 0 AND a.is_active = 1
                      ORDER BY a.modified_date DESC, a.created_date DESC
                      LIMIT 1) AS content
            FROM club_master c
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            WHERE c.pk_club_id = @ClubId",
            new { ClubId = clubId, YearId = resolvedYearId ?? 0 });

        if (about == null) return NotFound();

        // Contacts are PURELY year-scoped — if the requested year has no rows,
        // return an empty list. Do NOT fall back to another year's contact
        // (previously the resolver picked the most recent year with data, which
        // surfaced a 2023-24 contact under every other year for club 1 and made
        // admins think the per-year save wasn't working).
        var contacts = (await conn.QueryAsync<ContactRow>(@"
            SELECT fk_year_id AS YearId, email AS Email, phone AS Phone
            FROM club_website_contact_detail
            WHERE fk_club_id = @ClubId AND fk_year_id = @YearId
              AND isdeleted = 0 AND is_active = 1
            ORDER BY sort_order, pk_club_website_contact_detail_id",
            new { ClubId = clubId, YearId = resolvedYearId ?? 0 })).ToList();

        // Social media links are NOT year-wise — show all active links for the club.
        var socials = (await conn.QueryAsync<SocialRow>(@"
                SELECT platform AS Platform, link_url AS LinkUrl
                FROM club_website_social_link
                WHERE fk_club_id = @ClubId
                  AND isdeleted = 0 AND is_active = 1
                ORDER BY sort_order, pk_club_website_social_link_id",
                new { ClubId = clubId })).ToList();

        return Ok(new AboutDto
        {
            ClubName        = (string?)about.clubName ?? "",
            DistrictNumber  = (string?)about.districtNumber,
            ClubLogoPath    = (string?)about.clubLogoPath,
            RotaryLogoPath  = (string?)about.rotaryLogoPath,
            Content         = RotaryApi.Services.PublicHtml.Clean((string?)about.content),
            Contacts        = contacts,
            Socials         = socials,
            MeetingDay      = (string?)about.meetingDay,
            MeetingFromTime = (string?)about.meetingFromTime,
            MeetingToTime   = (string?)about.meetingToTime,
            MeetingAddress  = (string?)about.meetingAddress,
            City            = (string?)about.city,
            State           = (string?)about.state,
            Pincode         = (string?)about.pincode,
            Latitude        = (decimal?)about.latitude,
            Longitude       = (decimal?)about.longitude,
        });
    }

    // ── Banners (Home page hero) ───────────────────────────────────────────

    public class BannerDto
    {
        public int Id { get; set; }
        public string BannerImagePath { get; set; } = "";
        public string? DocumentPath { get; set; }
        public string? LinkUrl { get; set; }
        public string? Description { get; set; }
        public int SortOrder { get; set; }
    }

    [HttpGet("{clubId:int}/banners")]
    public async Task<ActionResult<IEnumerable<BannerDto>>> GetBanners(int clubId, [FromQuery] int? yearId)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsClubServiceableAsync(conn, clubId)) return NotFound();

        var resolvedYearId = yearId ?? await ResolveYearAsync(conn, clubId);

        var rows = await conn.QueryAsync<BannerDto>(@"
            SELECT pk_club_website_banner_id AS Id,
                   CASE
                       WHEN banner_image_path IS NULL OR banner_image_path = '' THEN NULL
                       WHEN banner_image_path LIKE '/%' THEN banner_image_path
                       ELSE CONCAT('/uploads/banner/', banner_image_path)
                   END AS BannerImagePath,
                   CASE
                       WHEN document_path IS NULL OR document_path = '' THEN NULL
                       WHEN document_path LIKE '/%' THEN document_path
                       WHEN document_path LIKE '%/%' THEN CONCAT('/', document_path)
                       ELSE CONCAT('/uploads/banner/', document_path)
                   END AS DocumentPath,
                   link_url AS LinkUrl,
                   description AS Description,
                   sort_order AS SortOrder
            FROM club_website_banner
            WHERE fk_club_id = @ClubId
              AND fk_year_id = @YearId
              AND (isdeleted = 0 OR isdeleted IS NULL)
              AND is_active = 1
            ORDER BY sort_order, pk_club_website_banner_id",
            new { ClubId = clubId, YearId = resolvedYearId ?? 0 });
        return Ok(rows);
    }

    // ── Advertisements (Home page) ─────────────────────────────────────────

    public class AdvertisementDto
    {
        public int Id { get; set; }
        public string AdvertisementImagePath { get; set; } = "";
        public string? DocumentPath { get; set; }
        public string? LinkUrl { get; set; }
        public string? Description { get; set; }
        public int SortOrder { get; set; }
    }

    [HttpGet("{clubId:int}/advertisements")]
    public async Task<ActionResult<IEnumerable<AdvertisementDto>>> GetAdvertisements(int clubId, [FromQuery] int? yearId)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsClubServiceableAsync(conn, clubId)) return NotFound();

        var resolvedYearId = yearId ?? await ResolveYearAsync(conn, clubId);

        var rows = await conn.QueryAsync<AdvertisementDto>(@"
            SELECT pk_club_website_advertisement_id AS Id,
                   CASE
                       WHEN advertisement_image_path IS NULL OR advertisement_image_path = '' THEN NULL
                       WHEN advertisement_image_path LIKE '/%' THEN advertisement_image_path
                       -- Legacy/migrated rows can carry an already-relative nested path rather than a
                       -- bare filename — blindly prefixing '/uploads/advertisement/' onto that produced
                       -- a non-existent, double-nested path.
                       WHEN advertisement_image_path LIKE '%/%' THEN CONCAT('/', advertisement_image_path)
                       ELSE CONCAT('/uploads/advertisement/', advertisement_image_path)
                   END AS AdvertisementImagePath,
                   CASE
                       WHEN document_path IS NULL OR document_path = '' THEN NULL
                       WHEN document_path LIKE '/%' THEN document_path
                       WHEN document_path LIKE '%/%' THEN CONCAT('/', document_path)
                       ELSE CONCAT('/uploads/advertisement/', document_path)
                   END AS DocumentPath,
                   link_url AS LinkUrl,
                   description AS Description,
                   sort_order AS SortOrder
            FROM club_website_advertisement
            WHERE fk_club_id = @ClubId
              AND fk_year_id = @YearId
              AND COALESCE(isdeleted,0) = 0 AND is_active = 1
            ORDER BY sort_order, pk_club_website_advertisement_id",
            new { ClubId = clubId, YearId = resolvedYearId ?? 0 });
        return Ok(rows);
    }

    // ── Board of Directors (year-filtered) ─────────────────────────────────

    public class BoardDirectorDto
    {
        public int Id { get; set; }
        public int MemberId { get; set; }
        public string MemberName { get; set; } = "";
        public string? ProfilePhotoPath { get; set; }
        public string Designation { get; set; } = "";
        public int? SortOrder { get; set; }
        public int? DesignationSortOrder { get; set; }
        // Member's self-written introduction. Used on the home page when a user clicks
        // a Club Leader card to expand the description.
        public string? MemberIntroduction { get; set; }
    }

    [HttpGet("{clubId:int}/bod")]
    public async Task<ActionResult<IEnumerable<BoardDirectorDto>>> GetBoardOfDirectors(int clubId, [FromQuery] int? yearId)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsClubServiceableAsync(conn, clubId)) return NotFound();

        var resolvedYearId = yearId ?? await ResolveYearAsync(conn, clubId);

        // Order: drag-reorder sort_order first (NULL = legacy → 9999),
        // then designation_master.sort_order as the stable fallback.
        var rows = await conn.QueryAsync<BoardDirectorDto>(@"
            SELECT bd.pk_board_director_id AS Id,
                   bd.fk_member_master_profile_id AS MemberId,
                   m.MemberName AS MemberName,
                   CASE
                       WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                       WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                       ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                   END AS ProfilePhotoPath,
                   d.designation_name AS Designation,
                   bd.sort_order AS SortOrder,
                   d.sort_order AS DesignationSortOrder,
                   m.MemberIntroduction AS MemberIntroduction
            FROM board_of_directors bd
            JOIN member_master_profile m ON m.pk_member_master_profile_id = bd.fk_member_master_profile_id
            JOIN designation_master d   ON d.pk_designation_id = bd.fk_designation_id
            WHERE bd.fk_club_id = @ClubId
              AND bd.fk_year_id = @YearId
              AND bd.isdeleted = 0
              AND m.isdeleted = 0
            ORDER BY
                CASE bd.fk_designation_id WHEN 1 THEN 0 WHEN 2 THEN 1 ELSE 2 END,
                COALESCE(bd.sort_order, 9999), d.sort_order, bd.pk_board_director_id",
            new { ClubId = clubId, YearId = resolvedYearId ?? 0 });
        return Ok(rows);
    }

    // ── Directory (all active members of the club) ─────────────────────────

    public class DirectoryMemberDto
    {
        public int MemberId { get; set; }
        public string MemberName { get; set; } = "";
        public string? ProfilePhotoPath { get; set; }
        public string? Email { get; set; }
        public string? Mobile { get; set; }
        public string? Profession { get; set; }
        public string? Designation { get; set; }
        public string? Gender { get; set; }
        public string? MemberIntroduction { get; set; }
        public bool IsPersonalDetailsVisible { get; set; }
        // true = honorary member; false = active/full member. Lets the public site's
        // "Members" counter exclude honorary members from the active count.
        public bool IsHonorary { get; set; }
    }

    // Phone/email are gated by the member's own visibility toggles at the API layer
    // rather than relying on the frontend to filter — defence-in-depth for a public
    // site. This is an anonymous endpoint, so no caller ever shares a club with a
    // member here: the *AllClubs flags always decide, and there is no self-bypass.
    [HttpGet("{clubId:int}/directory")]
    public async Task<ActionResult<IEnumerable<DirectoryMemberDto>>> GetDirectory(int clubId)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsClubServiceableAsync(conn, clubId)) return NotFound();

        var rows = (await conn.QueryAsync<dynamic>(@"
            SELECT m.pk_member_master_profile_id AS memberId,
                   m.MemberName AS memberName,
                   CASE
                       WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                       WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                       ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                   END AS profilePhotoPath,
                   m.EmailId AS email,
                   m.PrimaryMobileNumber AS mobile,
                   cm.ClassificationProfession AS profession,
                   cm.Designation AS designation,
                   m.Gender AS gender,
                   m.MemberIntroduction AS memberIntroduction,
                   m.ShowPhoneInAllClubs AS showPhoneInAllClubs,
                   m.ShowEmailInAllClubs AS showEmailInAllClubs,
                   COALESCE(cm.IsHonoraryMember, 0) AS isHonorary
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
            WHERE cm.fk_club_id = @ClubId
              AND cm.IsActive = 1 AND cm.isdeleted = 0
              AND m.isdeleted = 0
            ORDER BY m.MemberName",
            new { ClubId = clubId })).ToList();

        var list = rows.Select(r =>
        {
            int rowMemberId = (int)r.memberId;
            bool showPhone = MemberPrivacyHelper.ShouldShowPhone(null, rowMemberId, false, null, (object?)r.showPhoneInAllClubs);
            bool showEmail = MemberPrivacyHelper.ShouldShowEmail(null, rowMemberId, false, null, (object?)r.showEmailInAllClubs);
            return new DirectoryMemberDto
            {
                MemberId                  = rowMemberId,
                MemberName                = (string?)r.memberName ?? "",
                ProfilePhotoPath          = (string?)r.profilePhotoPath,
                Email                     = showEmail ? (string?)r.email  : null,
                Mobile                    = showPhone ? (string?)r.mobile : null,
                Profession                = (string?)r.profession,
                Designation               = (string?)r.designation,
                Gender                    = (string?)r.gender,
                MemberIntroduction        = (string?)r.memberIntroduction,
                // Kept for the club-website theme, which uses it to decide whether to
                // render a contact block at all — now true when either field survived.
                IsPersonalDetailsVisible  = showPhone || showEmail,
                IsHonorary                = r.isHonorary != null && Convert.ToBoolean(r.isHonorary),
            };
        });
        return Ok(list);
    }

    // ── Past Presidents ────────────────────────────────────────────────────

    public class PastPresidentDto
    {
        public int Id { get; set; }
        public int YearId { get; set; }
        public string YearLabel { get; set; } = "";
        public int MemberId { get; set; }
        public string MemberName { get; set; } = "";
        public string? ProfilePhotoPath { get; set; }
    }

    [HttpGet("{clubId:int}/past-presidents")]
    public async Task<ActionResult<IEnumerable<PastPresidentDto>>> GetPastPresidents(int clubId)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsClubServiceableAsync(conn, clubId)) return NotFound();

        var rows = await conn.QueryAsync<PastPresidentDto>(@"
            SELECT pp.pk_past_president_id AS Id,
                   pp.fk_year_id AS YearId,
                   y.YearLabel AS YearLabel,
                   COALESCE(pp.fk_member_master_profile_id, 0) AS MemberId,
                   COALESCE(NULLIF(TRIM(m.MemberName), ''), NULLIF(TRIM(pp.non_member_name), ''), '') AS MemberName,
                   CASE
                       -- Non-member entry (no linked member, or member row soft-deleted): rebuild the
                       -- uploaded photo from non_member_photo → /Documents/pastpresidents/Group{clubId}/{filename}.
                       WHEN pp.fk_member_master_profile_id IS NULL OR m.pk_member_master_profile_id IS NULL THEN
                           CASE
                               WHEN pp.non_member_photo IS NULL OR pp.non_member_photo = '' THEN NULL
                               ELSE CONCAT('/Documents/pastpresidents/Group', pp.fk_club_id, '/', SUBSTRING_INDEX(pp.non_member_photo, '/', -1))
                           END
                       -- Member entry: use the member's directory profile photo.
                       WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                       WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                       ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                   END AS ProfilePhotoPath
            FROM past_presidents pp
            JOIN rotary_year_master y ON y.pk_year_id = pp.fk_year_id
            LEFT JOIN member_master_profile m
                   ON m.pk_member_master_profile_id = pp.fk_member_master_profile_id
                  AND m.isdeleted = 0
            WHERE pp.fk_club_id = @ClubId
              AND pp.isdeleted = 0
              AND (
                    (pp.fk_member_master_profile_id IS NOT NULL AND m.pk_member_master_profile_id IS NOT NULL)
                 OR (pp.non_member_name IS NOT NULL AND TRIM(pp.non_member_name) <> '')
              )
            ORDER BY y.pk_year_id DESC",
            new { ClubId = clubId });
        return Ok(rows);
    }

    // ── Calendar (today's birthdays + anniversaries + upcoming events) ─────

    public class CalendarDayDto
    {
        public string Date { get; set; } = "";  // ISO date
        public List<BirthdayRow> Birthdays { get; set; } = new();
        public List<AnniversaryRow> Anniversaries { get; set; } = new();
        public List<EventRow> Events { get; set; } = new();
    }
    public class BirthdayRow      { public int MemberId { get; set; } public string MemberName { get; set; } = ""; public string? ProfilePhotoPath { get; set; } }
    public class AnniversaryRow   { public int MemberId { get; set; } public string MemberName { get; set; } = ""; public string? ProfilePhotoPath { get; set; } }
    public class EventRow         { public int Id { get; set; } public string Title { get; set; } = ""; public string? Description { get; set; } public string? ImagePath { get; set; } public string EventDate { get; set; } = ""; public string? Venue { get; set; } public string? RegistrationLink { get; set; } }

    // Default = today's events. Spec is explicit: "default todays you need to show".
    // Caller may override with ?date=YYYY-MM-DD for that single day's view.
    [HttpGet("{clubId:int}/calendar")]
    public async Task<ActionResult<CalendarDayDto>> GetCalendar(int clubId, [FromQuery] string? date)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsClubServiceableAsync(conn, clubId)) return NotFound();

        var target = DateTime.TryParse(date, out var d) ? d.Date : DateTime.Today;

        // Match by month+day so any year of birth/anniversary is matched against the requested date.
        var birthdays = (await conn.QueryAsync<BirthdayRow>(@"
            SELECT m.pk_member_master_profile_id AS MemberId,
                   m.MemberName AS MemberName,
                   CASE
                       WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                       WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                       ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                   END AS ProfilePhotoPath
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
            WHERE cm.fk_club_id = @ClubId
              AND cm.IsActive = 1 AND cm.isdeleted = 0
              AND m.isdeleted = 0
              AND m.BirthDate IS NOT NULL
              AND MONTH(m.BirthDate) = @M AND DAY(m.BirthDate) = @D
            ORDER BY m.MemberName",
            new { ClubId = clubId, M = target.Month, D = target.Day })).ToList();

        var anniversaries = (await conn.QueryAsync<AnniversaryRow>(@"
            SELECT m.pk_member_master_profile_id AS MemberId,
                   m.MemberName AS MemberName,
                   CASE
                       WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                       WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                       ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                   END AS ProfilePhotoPath
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
            WHERE cm.fk_club_id = @ClubId
              AND cm.IsActive = 1 AND cm.isdeleted = 0
              AND m.isdeleted = 0
              AND m.AnniversaryDate IS NOT NULL
              AND MONTH(m.AnniversaryDate) = @M AND DAY(m.AnniversaryDate) = @D
            ORDER BY m.MemberName",
            new { ClubId = clubId, M = target.Month, D = target.Day })).ToList();

        // Events whose EventDate is on the target date (only published + not expired).
        var events = (await conn.QueryAsync<dynamic>(@"
            SELECT pk_upcoming_event_id AS id,
                   Title AS title,
                   Description AS description,
                   CASE
                       WHEN ImagePath IS NULL OR ImagePath = '' THEN NULL
                       WHEN ImagePath LIKE '/%' THEN ImagePath
                       WHEN Scope = 'ri' THEN CONCAT('/Documents/Event/ri/', ImagePath)
                       WHEN fk_district_id IS NOT NULL THEN CONCAT('/Documents/Event/Group', fk_district_id, '/', ImagePath)
                       ELSE CONCAT('/Documents/Event/Group', fk_club_id, '/', ImagePath)
                   END AS imagePath,
                   EventDate AS eventDate,
                   EventVenue AS venue,
                   RegistrationLink AS registrationLink
            FROM upcoming_events
            WHERE fk_club_id = @ClubId
              AND isdeleted = 0 AND IsActive = 1
              AND Status = 'Published'
              AND DATE(EventDate) = @Date
            ORDER BY EventDate",
            new { ClubId = clubId, Date = target.ToString("yyyy-MM-dd") })).ToList();

        var eventRows = events.Select(e => new EventRow
        {
            Id               = (int)e.id,
            Title            = (string?)e.title ?? "",
            Description      = (string?)e.description,
            ImagePath        = (string?)e.imagePath,
            EventDate        = ((DateTime)e.eventDate).ToString("yyyy-MM-ddTHH:mm:ss"),
            Venue            = (string?)e.venue,
            RegistrationLink = (string?)e.registrationLink,
        }).ToList();

        return Ok(new CalendarDayDto
        {
            Date           = target.ToString("yyyy-MM-dd"),
            Birthdays      = birthdays,
            Anniversaries  = anniversaries,
            Events         = eventRows,
        });
    }

    // ── Projects (Avenues of Service + Public Image, NOT Club Service) ─────

    public class PublicProjectDto
    {
        public int Id { get; set; }
        public int ClubId { get; set; }
        public string? ClubName { get; set; }
        public int YearId { get; set; }
        public string YearLabel { get; set; } = "";
        public string ModuleKey { get; set; } = "";
        public string ModuleName { get; set; } = "";
        public string Title { get; set; } = "";
        public string? Description { get; set; }
        public string? Location { get; set; }
        public string? ProjectDate { get; set; }
        public string? AreaOfFocus { get; set; }
        public string? Category { get; set; }
        public string? SubCategory { get; set; }
        public string? PrimaryPhotoPath { get; set; }
        public string? CreatedDate { get; set; }    // ISO datetime — used to pick the most-recently-uploaded project per avenue on the home page
        public string? ModifiedDate { get; set; }   // ISO datetime — latest edit timestamp
    }

    // Full project detail with every field + up to 5 photos. Used by /projects/[id] route.
    public class ProjectDetailDto
    {
        public int Id { get; set; }
        public int YearId { get; set; }
        public string YearLabel { get; set; } = "";
        public string ModuleKey { get; set; } = "";
        public string ModuleName { get; set; } = "";
        public string Title { get; set; } = "";
        public string? Description { get; set; }
        public string? Location { get; set; }
        public string? ProjectDate { get; set; }
        public string? AreaOfFocus { get; set; }
        public string? Category { get; set; }
        public string? SubCategory { get; set; }
        public string? ProjectType { get; set; }
        public string? OngoingGroupTitle { get; set; }
        public bool? IsJointProject { get; set; }
        public string? CoHostName { get; set; }
        public string? ClubRole { get; set; }
        public string? Funding { get; set; }
        public decimal? ProjectCost { get; set; }
        public string Currency { get; set; } = RotaryApi.Services.Brand.DefaultCurrency;   // this project's own stored currency (project.Currency)
        public int? DirectBeneficiaries { get; set; }
        public int? ManHours { get; set; }
        public int? RotariansInvolved { get; set; }
        public int? RotaractorsInvolved { get; set; }
        // Rotary Community Corps members involved - optional, 0 when nothing was entered. Always sits
        // next to RotaractorsInvolved (user 2026-10-05).
        public int? RccInvolved { get; set; }
        public string? CreatedDate { get; set; }
        public string? ModifiedDate { get; set; }
        public List<string> Photos { get; set; } = new();   // up to 5, primary first — LEGACY string array; ~1,300 live sites read this. DO NOT change its shape.
        public List<PhotoDto> PhotoDetails { get; set; } = new();   // same photos + caption. Additive — new field so the legacy Photos array stays a plain string[].

        // Children + summed totals — populated ONLY when ProjectType == 'ongoing'
        // (parent rows). For one_time / club_service / non-ongoing the API returns
        // these fields empty/null so the website can hide the children section
        // and the summed stats block.
        public List<ChildProjectDto> Children { get; set; } = new();
        public decimal? SummedProjectCost { get; set; }
        public int? SummedDirectBeneficiaries { get; set; }
        public int? SummedManHours { get; set; }
        public int? SummedRotariansInvolved { get; set; }
        public int? SummedRotaractorsInvolved { get; set; }
        public int? SummedRccInvolved { get; set; }
    }

    // One row per ongoing_repeat child. Each child carries its own photos (up to 5)
    // so the website can render a per-child gallery without a follow-up call.
    public class ChildProjectDto
    {
        public int Id { get; set; }
        public int YearId { get; set; }
        public string YearLabel { get; set; } = "";
        public string Title { get; set; } = "";
        public string? Description { get; set; }
        public string? Location { get; set; }
        public string? ProjectDate { get; set; }
        public decimal? ProjectCost { get; set; }
        public string Currency { get; set; } = RotaryApi.Services.Brand.DefaultCurrency;   // this child project's own stored currency (project.Currency)
        public int? DirectBeneficiaries { get; set; }
        public int? ManHours { get; set; }
        public int? RotariansInvolved { get; set; }
        public int? RotaractorsInvolved { get; set; }
        // Rotary Community Corps members involved - optional, 0 when nothing was entered. Always sits
        // next to RotaractorsInvolved (user 2026-10-05).
        public int? RccInvolved { get; set; }
        public List<string> Photos { get; set; } = new();   // up to 5, primary first — LEGACY string array. DO NOT change its shape.
        public List<PhotoDto> PhotoDetails { get; set; } = new();   // same photos + caption (additive).
    }

    // Photo URL + its caption. Additive companion to the legacy Photos string[] so the
    // "district side shows the caption" data finally reaches the club website too.
    public class PhotoDto
    {
        public string Url { get; set; } = "";
        public string? Description { get; set; }
    }

    // Year-wise note: this URL has no yearId, so we must scan year tables until we find the
    // matching (clubId, projectId) row. Public share-links don't carry yearId, and we accept
    // the few-table scan cost for backward-compatibility with existing links.
    [HttpGet("{clubId:int}/projects/{projectId:int}")]
    public async Task<ActionResult<ProjectDetailDto>> GetProjectDetail(int clubId, int projectId, [FromQuery] int? yearId = null)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsClubServiceableAsync(conn, clubId)) return NotFound();
        return await ProjectDetailCoreAsync(conn, clubId, projectId, yearId);
    }

    // District website: a project of any active club in a district whose website is live (the club itself needs no
    // website). Same body as the club route.
    [HttpGet("/api/public/district/{districtId:int}/clubs/{clubId:int}/projects/{projectId:int}")]
    public async Task<ActionResult<ProjectDetailDto>> GetDistrictProjectDetail(int districtId, int clubId, int projectId, [FromQuery] int? yearId = null)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsDistrictClubServiceableAsync(conn, districtId, clubId)) return NotFound();
        return await ProjectDetailCoreAsync(conn, clubId, projectId, yearId);
    }

    // Projects of all active clubs in a district with a live website, newest first, one page at a time.
    // avenue: a project module key (community_service, …); empty = every avenue.
    [HttpGet("/api/public/district/{districtId:int}/projects")]
    public async Task<ActionResult<IEnumerable<PublicProjectDto>>> GetDistrictProjects(
        int districtId, [FromQuery] int? yearId, [FromQuery] string? avenue, [FromQuery] int page = 1, [FromQuery] int pageSize = 24)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsDistrictClubServiceableAsync(conn, districtId, null)) return NotFound();
        if (!string.IsNullOrEmpty(avenue) && !ProjectModuleKeys.Contains(avenue)) return BadRequest(new { message = "Unknown avenue." });
        var keys = string.IsNullOrEmpty(avenue) ? ProjectModuleKeys : new[] { avenue };
        var year = yearId ?? await conn.ExecuteScalarAsync<int?>("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1");
        pageSize = Math.Clamp(pageSize, 1, 60);
        return Ok(await QueryProjectsAsync(conn, 0, year, keys, includeMeetings: false,
            districtId: districtId, limit: pageSize, offset: (Math.Max(page, 1) - 1) * pageSize));
    }

    // District website home "snapshot": this year's service projects across the district's clubs, plus clubs and members.
    [HttpGet("/api/public/district/{districtId:int}/snapshot")]
    public async Task<ActionResult> GetDistrictSnapshot(int districtId, [FromQuery] int? yearId)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsDistrictClubServiceableAsync(conn, districtId, null)) return NotFound();
        var year = yearId ?? await conn.ExecuteScalarAsync<int?>("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1");
        var t = year.HasValue ? await _yearTables.ResolveByYearIdAsync(conn, year.Value) : null;
        var projects = t == null ? null : await conn.QueryFirstOrDefaultAsync<dynamic>($@"
            SELECT COUNT(*) AS projects, COALESCE(SUM(p.direct_beneficiaries), 0) AS beneficiaries,
                   COALESCE(SUM(p.project_cost), 0) AS cost, COALESCE(SUM(p.man_hours), 0) AS manHours
            FROM `{t.ProjectsTable}` p
            JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
            JOIN club_master c ON c.pk_club_id = p.fk_club_id
            WHERE c.fk_district_id = @DistrictId AND c.isdeleted = 0 AND c.IsActive = 1
              AND p.isdeleted = 0 AND p.is_active = 1
              AND (COALESCE(p.approval_status, '') = '' OR p.approval_status = 'Approved')
              AND mm.ModuleKey IN @Keys",
            new { DistrictId = districtId, Keys = ProjectModuleKeys });
        var people = await conn.QueryFirstAsync<dynamic>(@"
            SELECT COUNT(DISTINCT c.pk_club_id) AS clubs, COUNT(DISTINCT cm.fk_member_master_profile_id) AS members
            FROM club_master c
            LEFT JOIN club_members cm ON cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND COALESCE(cm.isdeleted, 0) = 0
            WHERE c.fk_district_id = @DistrictId AND c.isdeleted = 0 AND c.IsActive = 1",
            new { DistrictId = districtId });
        return Ok(new
        {
            yearId = year,
            projects = (long)(projects?.projects ?? 0L),
            beneficiaries = (decimal)(projects?.beneficiaries ?? 0m),
            cost = (decimal)(projects?.cost ?? 0m),
            manHours = (decimal)(projects?.manHours ?? 0m),
            clubs = (long)people.clubs,
            members = (long)people.members,
        });
    }

    // The district has a live website and an active district + zone; with clubId, that club is active and in it.
    private static async Task<bool> IsDistrictClubServiceableAsync(MySqlConnection conn, int districtId, int? clubId)
    {
        var count = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*)
            FROM district_websites w
            JOIN district_master d ON d.pk_district_id = w.fk_district_id
            JOIN zone_master z     ON z.pk_zone_id     = d.fk_zone_id
            WHERE w.fk_district_id = @DistrictId AND w.isdeleted = 0
              AND d.isdeleted = 0 AND d.IsActive = 1
              AND z.isdeleted = 0 AND z.IsActive = 1
              AND (@ClubId IS NULL OR EXISTS (SELECT 1 FROM club_master c WHERE c.pk_club_id = @ClubId
                     AND c.fk_district_id = @DistrictId AND c.isdeleted = 0 AND c.IsActive = 1))",
            new { DistrictId = districtId, ClubId = clubId });
        return count > 0;
    }

    private async Task<ActionResult<ProjectDetailDto>> ProjectDetailCoreAsync(MySqlConnection conn, int clubId, int projectId, int? yearId)
    {

        // Resolve the matching year table — prefer caller-provided yearId, else scan.
        YearTableInfo? info = null;
        if (yearId.HasValue && yearId.Value > 0)
        {
            info = await _yearTables.ResolveByYearIdAsync(conn, yearId.Value);
        }
        else
        {
            // Project ids repeat across years, even for the same club (29045 is a 2022-23 "Weekly
            // meeting" and a 2026-27 "Ration Distribution" for club 92). The scan used to take the
            // OLDEST match silently (2026-10-09). Now: one match -> use it (old share links keep
            // working); more than one -> ask for yearId instead of guessing.
            var matches = new List<YearTableInfo>();
            foreach (var t in await _yearTables.GetAllExistingYearTablesAsync(conn))
            {
                var exists = await conn.ExecuteScalarAsync<int>(
                    $"SELECT COUNT(*) FROM `{t.ProjectsTable}` WHERE pk_project_id = @Id AND fk_club_id = @ClubId AND isdeleted = 0 AND is_active = 1",
                    new { Id = projectId, ClubId = clubId });
                if (exists > 0) matches.Add(t);
            }
            if (matches.Count > 1)
                return BadRequest(new
                {
                    message = $"yearId is required: project {projectId} exists in more than one Rotary year for this club.",
                    years = matches.Select(m => new { yearId = m.YearId, yearLabel = m.YearLabel }),
                });
            info = matches.FirstOrDefault();
        }
        if (info is null) return NotFound();

        var row = await conn.QueryFirstOrDefaultAsync<dynamic>($@"
            SELECT p.pk_project_id  AS id,
                   p.fk_year_id     AS yearId,
                   y.YearLabel      AS yearLabel,
                   mm.ModuleKey     AS moduleKey,
                   mm.ModuleName    AS moduleName,
                   p.title          AS title,
                   p.description    AS description,
                   p.location       AS location,
                   p.project_date   AS projectDate,
                   COALESCE(aof.name, p.other_area_of_focus) AS areaOfFocus,
                   COALESCE(cat.name, p.other_category)      AS category,
                   COALESCE(sc.name,  p.other_sub_category)  AS subCategory,
                   p.project_type        AS projectType,
                   p.ongoing_group_title AS ongoingGroupTitle,
                   p.is_joint_project    AS isJointProject,
                   p.co_host_name        AS coHostName,
                   p.club_role           AS clubRole,
                   f.name                AS funding,
                   p.project_cost        AS projectCost,
                   p.Currency            AS currency,
                   p.direct_beneficiaries AS directBeneficiaries,
                   p.man_hours           AS manHours,
                   p.rotarians_involved  AS rotariansInvolved,
                   p.rotaractors_involved AS rotaractorsInvolved,
                   COALESCE(p.rcc_involved,0) AS rccInvolved,
                   p.created_date        AS createdDate,
                   p.modified_date       AS modifiedDate
            FROM `{info.ProjectsTable}` p
            JOIN rotary_year_master y ON y.pk_year_id = p.fk_year_id
            JOIN module_master mm     ON mm.pk_module_id = p.fk_module_id
            LEFT JOIN area_of_focus_master aof ON aof.pk_area_of_focus_id = p.fk_area_of_focus_id
            LEFT JOIN category_master cat       ON cat.pk_category_id = p.fk_category_id
            LEFT JOIN sub_category_master sc    ON sc.pk_sub_category_id = p.fk_sub_category_id
            LEFT JOIN funding_master f          ON f.pk_funding_id = p.fk_funding_id
            WHERE p.pk_project_id = @ProjectId AND p.fk_club_id = @ClubId
              AND p.isdeleted = 0 AND p.is_active = 1
              AND (COALESCE(p.approval_status, '') = '' OR p.approval_status = 'Approved')",
            new { ClubId = clubId, ProjectId = projectId });

        if (row == null) return NotFound();

        // Photos: store filename only; reconstruct full URL based on whether project is migrated (old_pk) or new.
        var suffix = info.YearLabel.Replace("-", "_");
        // Select the reconstructed URL AND ph.description (was skipped before, which is why the
        // caption showed on the district side but never on the club website). Photos = legacy
        // string[] (unchanged); PhotoDetails carries the caption alongside.
        var photoRows = (await conn.QueryAsync<dynamic>($@"
            SELECT CONCAT('/Documents/gallery/Group', @ClubId, '/',
                          CASE WHEN p.old_pk IS NOT NULL THEN CONCAT('Album', p.old_pk)
                               ELSE CONCAT('{suffix}/Album', p.pk_project_id) END,
                          '/', ph.image_path) AS url,
                   ph.description AS description
            FROM `{info.PhotosTable}` ph
            JOIN `{info.ProjectsTable}` p ON p.pk_project_id = ph.fk_project_id
            WHERE ph.fk_project_id = @ProjectId
            ORDER BY ph.is_primary DESC, ph.sort_order, ph.pk_photo_id
            LIMIT 5",
            new { ProjectId = projectId, ClubId = clubId })).ToList();
        var photos = photoRows.Select(r => (string)r.url).ToList();
        var photoDetails = photoRows.Select(r => new PhotoDto { Url = (string)r.url, Description = (string?)r.description }).ToList();

        // Children + summed totals — populated only for `ongoing` parent rows.
        // A child is any row with parent_project_id = this project's id (matching the v2
        // listing's ChildCount definition). Real child rows are stored as project_type
        // 'ongoing' (NOT 'ongoing_repeat'), so we do NOT filter on project_type — the
        // parent_project_id link alone identifies children. Recurring events run across
        // years → scan EVERY year table, not just the parent's year. Each child carries
        // its own photos (up to 5).
        var children = new List<ChildProjectDto>();
        decimal? sumCost = null;
        int? sumBeneficiaries = null, sumManHours = null, sumRotarians = null, sumRotaractors = null, sumRcc = null;

        // Ongoing AND Ongoing/Repeat parents carry updates (2026-10-09: ongoing_repeat parents came
        // back with no children though the dashboard shows them - e.g. club 92 project 10851, 4).
        var projectTypeStr = (string?)row.projectType ?? "";
        if (string.Equals(projectTypeStr, "ongoing", StringComparison.OrdinalIgnoreCase)
            || string.Equals(projectTypeStr, "ongoing_repeat", StringComparison.OrdinalIgnoreCase))
        {
            foreach (var childTable in await _yearTables.GetAllExistingYearTablesAsync(conn))
            {
                // Ids repeat across years: in ANOTHER year's table, a parent_project_id equal to this
                // id points at THAT year's own project when one exists for this club - skip it, so a
                // different project's updates are never listed here.
                if (childTable.YearId != info.YearId
                    && await conn.ExecuteScalarAsync<int>(
                        $"SELECT COUNT(*) FROM `{childTable.ProjectsTable}` WHERE pk_project_id = @Id AND fk_club_id = @ClubId",
                        new { Id = projectId, ClubId = clubId }) > 0)
                    continue;
                var childSuffix = childTable.YearLabel.Replace("-", "_");
                var childRows = (await conn.QueryAsync<dynamic>($@"
                    SELECT p.pk_project_id  AS id,
                           p.fk_year_id     AS yearId,
                           @YearLabel       AS yearLabel,
                           p.title          AS title,
                           p.description    AS description,
                           p.location       AS location,
                           p.project_date   AS projectDate,
                           p.project_cost   AS projectCost,
                           p.Currency       AS currency,
                           p.direct_beneficiaries AS directBeneficiaries,
                           p.man_hours      AS manHours,
                           p.rotarians_involved   AS rotariansInvolved,
                           p.rotaractors_involved AS rotaractorsInvolved,
                           COALESCE(p.rcc_involved,0) AS rccInvolved,
                           p.old_pk         AS oldPk
                    FROM `{childTable.ProjectsTable}` p
                    WHERE p.parent_project_id = @ProjectId
                      AND p.fk_club_id = @ClubId
                      AND p.isdeleted = 0 AND p.is_active = 1
                      AND (COALESCE(p.approval_status, '') = '' OR p.approval_status = 'Approved')
                    ORDER BY p.project_date DESC, p.pk_project_id DESC",
                    new { ProjectId = projectId, ClubId = clubId, YearLabel = childTable.YearLabel })).ToList();

                foreach (var cr in childRows)
                {
                    var childId = (int)cr.id;
                    // Per-child photo URL build mirrors the parent's reconstruction logic.
                    var childPhotoRows = (await conn.QueryAsync<dynamic>($@"
                        SELECT CONCAT('/Documents/gallery/Group', @ClubId, '/',
                                      CASE WHEN p.old_pk IS NOT NULL THEN CONCAT('Album', p.old_pk)
                                           ELSE CONCAT('{childSuffix}/Album', p.pk_project_id) END,
                                      '/', ph.image_path) AS url,
                               ph.description AS description
                        FROM `{childTable.PhotosTable}` ph
                        JOIN `{childTable.ProjectsTable}` p ON p.pk_project_id = ph.fk_project_id
                        WHERE ph.fk_project_id = @ChildId
                        ORDER BY ph.is_primary DESC, ph.sort_order, ph.pk_photo_id
                        LIMIT 5",
                        new { ChildId = childId, ClubId = clubId })).ToList();
                    var childPhotos = childPhotoRows.Select(r => (string)r.url).ToList();
                    var childPhotoDetails = childPhotoRows.Select(r => new PhotoDto { Url = (string)r.url, Description = (string?)r.description }).ToList();

                    children.Add(new ChildProjectDto
                    {
                        Id                  = childId,
                        YearId              = (int)cr.yearId,
                        YearLabel           = (string?)cr.yearLabel ?? "",
                        Title               = (string?)cr.title ?? "",
                        Description         = (string?)cr.description,
                        Location            = (string?)cr.location,
                        ProjectDate         = cr.projectDate is DateTime cpd ? cpd.ToString("yyyy-MM-dd") : null,
                        ProjectCost         = (decimal?)cr.projectCost,
                        Currency            = (string?)cr.currency ?? RotaryApi.Services.Brand.DefaultCurrency,
                        DirectBeneficiaries = (int?)cr.directBeneficiaries,
                        ManHours            = (int?)cr.manHours,
                        RotariansInvolved   = (int?)cr.rotariansInvolved,
                        RotaractorsInvolved = (int?)cr.rotaractorsInvolved,
                        RccInvolved = (int?)cr.rccInvolved,
                        Photos              = childPhotos,
                        PhotoDetails        = childPhotoDetails,
                    });
                }
            }

            // Sums: parent's own value + all children's values. Null-safe — if every
            // contributing row is NULL we return NULL (not 0) so the website can
            // distinguish "no data" from "explicit zero".
            decimal? parentCost = (decimal?)row.projectCost;
            int? parentBen = (int?)row.directBeneficiaries;
            int? parentMh = (int?)row.manHours;
            int? parentRot = (int?)row.rotariansInvolved;
            int? parentRotr = (int?)row.rotaractorsInvolved;
            int? parentRcc  = (int?)row.rccInvolved;

            sumCost          = SumNullable(parentCost,  children.Select(c => c.ProjectCost));
            sumBeneficiaries = SumNullableInt(parentBen, children.Select(c => c.DirectBeneficiaries));
            sumManHours      = SumNullableInt(parentMh,  children.Select(c => c.ManHours));
            sumRotarians     = SumNullableInt(parentRot, children.Select(c => c.RotariansInvolved));
            sumRotaractors   = SumNullableInt(parentRotr, children.Select(c => c.RotaractorsInvolved));
            sumRcc           = SumNullableInt(parentRcc, children.Select(c => c.RccInvolved));
        }

        return Ok(new ProjectDetailDto
        {
            Id                   = (int)row.id,
            YearId               = (int)row.yearId,
            YearLabel            = (string?)row.yearLabel ?? "",
            ModuleKey            = (string?)row.moduleKey ?? "",
            ModuleName           = (string?)row.moduleName ?? "",
            Title                = (string?)row.title ?? "",
            Description          = (string?)row.description,
            Location             = (string?)row.location,
            ProjectDate          = row.projectDate is DateTime pd ? pd.ToString("yyyy-MM-dd") : null,
            AreaOfFocus          = (string?)row.areaOfFocus,
            Category             = (string?)row.category,
            SubCategory          = (string?)row.subCategory,
            ProjectType          = (string?)row.projectType,
            OngoingGroupTitle    = (string?)row.ongoingGroupTitle,
            IsJointProject       = row.isJointProject == null ? (bool?)null : Convert.ToBoolean(row.isJointProject),
            CoHostName           = (string?)row.coHostName,
            ClubRole             = (string?)row.clubRole,
            Funding              = (string?)row.funding,
            ProjectCost          = (decimal?)row.projectCost,
            Currency             = (string?)row.currency ?? RotaryApi.Services.Brand.DefaultCurrency,
            DirectBeneficiaries  = (int?)row.directBeneficiaries,
            ManHours             = (int?)row.manHours,
            RotariansInvolved    = (int?)row.rotariansInvolved,
            RotaractorsInvolved  = (int?)row.rotaractorsInvolved,
            RccInvolved          = (int?)row.rccInvolved,
            CreatedDate          = row.createdDate is DateTime cd ? cd.ToString("yyyy-MM-ddTHH:mm:ss") : null,
            ModifiedDate         = row.modifiedDate is DateTime md ? md.ToString("yyyy-MM-ddTHH:mm:ss") : null,
            Photos               = photos,
            PhotoDetails         = photoDetails,
            Children                  = children,
            SummedProjectCost         = sumCost,
            SummedDirectBeneficiaries = sumBeneficiaries,
            SummedManHours            = sumManHours,
            SummedRotariansInvolved   = sumRotarians,
            SummedRotaractorsInvolved = sumRotaractors,
            SummedRccInvolved = sumRcc,
        });
    }

    // null-safe sum: returns NULL if every input is NULL; else sums the non-NULL values.
    private static decimal? SumNullable(decimal? parent, IEnumerable<decimal?> children)
    {
        var all = new[] { parent }.Concat(children).Where(v => v.HasValue).Select(v => v!.Value).ToList();
        return all.Count == 0 ? (decimal?)null : all.Sum();
    }
    private static int? SumNullableInt(int? parent, IEnumerable<int?> children)
    {
        var all = new[] { parent }.Concat(children).Where(v => v.HasValue).Select(v => v!.Value).ToList();
        return all.Count == 0 ? (int?)null : all.Sum();
    }

    [HttpGet("{clubId:int}/projects")]
    public async Task<ActionResult<IEnumerable<PublicProjectDto>>> GetProjects(int clubId, [FromQuery] int? yearId)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsClubServiceableAsync(conn, clubId)) return NotFound();

        var resolvedYearId = yearId ?? await ResolveYearAsync(conn, clubId);

        var rows = await QueryProjectsAsync(conn, clubId, resolvedYearId, ProjectModuleKeys, includeMeetings: false);
        return Ok(rows);
    }

    // ── Meetings (Club Service only) ───────────────────────────────────────

    [HttpGet("{clubId:int}/meetings")]
    public async Task<ActionResult<IEnumerable<PublicProjectDto>>> GetMeetings(int clubId, [FromQuery] int? yearId)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsClubServiceableAsync(conn, clubId)) return NotFound();

        var resolvedYearId = yearId ?? await ResolveYearAsync(conn, clubId);

        var rows = await QueryProjectsAsync(conn, clubId, resolvedYearId, new[] { MeetingsModuleKey }, includeMeetings: true);
        return Ok(rows);
    }

    private async Task<List<PublicProjectDto>> QueryProjectsAsync(
        MySqlConnection conn, int clubId, int? yearId, string[] moduleKeys, bool includeMeetings,
        int districtId = 0, int? limit = null, int offset = 0)
    {
        // districtId > 0: every active club of that district instead of one club (district website)
        var clubFilter = districtId > 0
            ? "p.fk_club_id IN (SELECT pk_club_id FROM club_master WHERE fk_district_id = @DistrictId AND isdeleted = 0 AND IsActive = 1)"
            : "p.fk_club_id = @ClubId";
        // Year-wise: when yearId provided, hit that one year's tables; else UNION across all
        // existing year-wise tables. Primary photo is reconstructed via CONCAT — handles both
        // new uploads (with year segment in folder) and migrated rows (no year segment, uses old_pk).
        var tables = (yearId.HasValue && yearId.Value > 0)
            ? new List<YearTableInfo> { (await _yearTables.ResolveByYearIdAsync(conn, yearId.Value)) }
                .Where(t => t != null).Cast<YearTableInfo>().ToList()
            : await _yearTables.GetAllExistingYearTablesAsync(conn);
        if (tables.Count == 0) return new List<PublicProjectDto>();

        // For the avenues that group children under their parent on the
        // website (community_service + public_image_initiative) exclude
        // ongoing_repeat child rows from the listing — children only render
        // nested under their parent in the project-detail view. The condition
        // is per-row (not per-query) so other avenues in the same response
        // still include their ongoing_repeat rows if any.
        const string ptFilter =
            " AND NOT (mm.ModuleKey IN ('community_service','public_image_initiative') AND p.project_type = 'ongoing_repeat')";

        var unionLegs = string.Join(" UNION ALL ", tables.Select(t => {
            var suffix = t.YearLabel.Replace("-", "_");
            return $@"SELECT p.pk_project_id AS Id,
                             p.fk_club_id   AS ClubId,
                             (SELECT ClubName FROM club_master WHERE pk_club_id = p.fk_club_id) AS ClubName,
                             p.fk_year_id   AS YearId,
                             '{t.YearLabel}' AS YearLabel,
                             mm.ModuleKey   AS ModuleKey,
                             mm.ModuleName  AS ModuleName,
                             p.title        AS Title,
                             p.description  AS Description,
                             p.location     AS Location,
                             p.project_date AS ProjectDate,
                             aof.name       AS AreaOfFocus,
                             cat.name       AS Category,
                             sc.name        AS SubCategory,
                             (SELECT CONCAT('/Documents/gallery/Group', p.fk_club_id, '/',
                                       CASE WHEN p.old_pk IS NOT NULL THEN CONCAT('Album', p.old_pk)
                                            ELSE CONCAT('{suffix}/Album', p.pk_project_id) END,
                                       '/', ph.image_path)
                              FROM `{t.PhotosTable}` ph
                              WHERE ph.fk_project_id = p.pk_project_id
                              ORDER BY ph.is_primary DESC, ph.sort_order, ph.pk_photo_id
                              LIMIT 1) AS PrimaryPhotoPath,
                             p.created_date  AS CreatedDate,
                             p.modified_date AS ModifiedDate
                      FROM `{t.ProjectsTable}` p
                      JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
                      LEFT JOIN area_of_focus_master aof ON aof.pk_area_of_focus_id = p.fk_area_of_focus_id
                      LEFT JOIN category_master cat ON cat.pk_category_id = p.fk_category_id
                      LEFT JOIN sub_category_master sc ON sc.pk_sub_category_id = p.fk_sub_category_id
                      WHERE {clubFilter}
                        AND p.isdeleted = 0 AND p.is_active = 1
                        AND (COALESCE(p.approval_status, '') = '' OR p.approval_status = 'Approved')
                        AND mm.ModuleKey IN @Keys{ptFilter}";
        }));

        var sql = $"SELECT * FROM ({unionLegs}) u ORDER BY COALESCE(u.ModifiedDate, u.CreatedDate) DESC, u.Id DESC"
                  + (limit.HasValue ? " LIMIT @Limit OFFSET @Offset" : "");
        var raw = await conn.QueryAsync<dynamic>(sql, new { ClubId = clubId, DistrictId = districtId, Keys = moduleKeys, Limit = limit ?? 0, Offset = offset });

        return raw.Select(r => new PublicProjectDto
        {
            Id               = (int)r.Id,
            ClubId           = (int)r.ClubId,
            ClubName         = (string?)r.ClubName,
            YearId           = (int)r.YearId,
            YearLabel        = (string?)r.YearLabel ?? "",
            ModuleKey        = (string?)r.ModuleKey ?? "",
            ModuleName       = (string?)r.ModuleName ?? "",
            Title            = (string?)r.Title ?? "",
            Description      = (string?)r.Description,
            Location         = (string?)r.Location,
            ProjectDate      = r.ProjectDate is DateTime pd ? pd.ToString("yyyy-MM-dd") : null,
            AreaOfFocus      = (string?)r.AreaOfFocus,
            Category         = (string?)r.Category,
            SubCategory      = (string?)r.SubCategory,
            PrimaryPhotoPath = (string?)r.PrimaryPhotoPath,
            CreatedDate      = r.CreatedDate is DateTime cd ? cd.ToString("yyyy-MM-ddTHH:mm:ss") : null,
            ModifiedDate     = r.ModifiedDate is DateTime md ? md.ToString("yyyy-MM-ddTHH:mm:ss") : null,
        }).ToList();
    }

    // ── Menus (8 default + max 1 custom) with sub-menus ────────────────────

    public class MenuDto
    {
        public int Id { get; set; }
        public string MenuName { get; set; } = "";
        public string LinkType { get; set; } = "page";   // 'page' | 'url' | 'html' | 'external' | 'document'
        public string LinkValue { get; set; } = "";
        public string? ContentHtml { get; set; }          // populated when LinkType='html'
        public bool IsDefault { get; set; }
        public int SortOrder { get; set; }
        public List<SubMenuDto> SubMenus { get; set; } = new();
    }
    public class SubMenuDto
    {
        public int Id { get; set; }
        public string SubMenuName { get; set; } = "";
        public string LinkType { get; set; } = "page";
        public string LinkValue { get; set; } = "";
        public int SortOrder { get; set; }
    }

    [HttpGet("{clubId:int}/menus")]
    public async Task<ActionResult<IEnumerable<MenuDto>>> GetMenus(int clubId)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsClubServiceableAsync(conn, clubId)) return NotFound();

        var menus = (await conn.QueryAsync<MenuDto>(@"
            SELECT pk_club_website_menu_id AS Id,
                   menu_name AS MenuName,
                   link_type AS LinkType,
                   CASE
                       WHEN link_value IS NULL OR link_value = '' THEN link_value
                       WHEN link_type = 'document'
                            AND link_value NOT LIKE '/%'
                            AND link_value NOT LIKE 'http%'
                            THEN CONCAT('/Documents/WebsiteData/Group', fk_club_id, '/MENU/', link_value)
                       ELSE link_value
                   END AS LinkValue,
                   content_html AS ContentHtml,
                   is_default AS IsDefault,
                   sort_order AS SortOrder
            FROM club_website_menu
            WHERE fk_club_id = @ClubId
              AND (fk_district_id IS NULL OR fk_district_id = 0)
              AND isdeleted = 0 AND is_active = 1
            ORDER BY sort_order, pk_club_website_menu_id",
            new { ClubId = clubId })).ToList();

        foreach (var m in menus) m.ContentHtml = RotaryApi.Services.PublicHtml.Clean(m.ContentHtml);
        if (menus.Count == 0) return Ok(menus);

        var menuIds = menus.Select(m => m.Id).ToArray();
        // Sub-menu document URL uses the parent menu's fk_club_id (sub-menu
        // table doesn't carry it directly) — join to club_website_menu.
        var subs = await conn.QueryAsync<dynamic>(@"
            SELECT sm.pk_club_website_submenu_id AS id,
                   sm.fk_menu_id AS menuId,
                   sm.submenu_name AS submenuName,
                   sm.link_type AS linkType,
                   CASE
                       WHEN sm.link_value IS NULL OR sm.link_value = '' THEN sm.link_value
                       WHEN sm.link_type = 'document'
                            AND sm.link_value NOT LIKE '/%'
                            AND sm.link_value NOT LIKE 'http%'
                            THEN CONCAT('/Documents/WebsiteData/Group', m.fk_club_id, '/MENU/', sm.link_value)
                       ELSE sm.link_value
                   END AS linkValue,
                   sm.sort_order AS sortOrder
            FROM club_website_submenu sm
            JOIN club_website_menu m ON m.pk_club_website_menu_id = sm.fk_menu_id
            WHERE sm.fk_menu_id IN @Ids
              AND sm.isdeleted = 0 AND sm.is_active = 1
            ORDER BY sm.sort_order, sm.pk_club_website_submenu_id",
            new { Ids = menuIds });

        var byMenu = subs
            .Select(s => new { MenuId = (int)s.menuId, Sub = new SubMenuDto
            {
                Id          = (int)s.id,
                SubMenuName = (string?)s.submenuName ?? "",
                LinkType    = (string?)s.linkType ?? "page",
                LinkValue   = (string?)s.linkValue ?? "",
                SortOrder   = (int)(s.sortOrder ?? 0),
            }})
            .GroupBy(x => x.MenuId)
            .ToDictionary(g => g.Key, g => g.Select(x => x.Sub).ToList());

        foreach (var m in menus)
        {
            if (byMenu.TryGetValue(m.Id, out var list)) m.SubMenus = list;
        }
        return Ok(menus);
    }

    // ── Internal: pick the default year (current year if it has data, else most recent) ──

    private async Task<int?> ResolveYearAsync(MySqlConnection conn, int clubId)
    {
        // Year-wise projects: union over every existing year-wise table where this club has a row.
        var projectTables = await _yearTables.GetAllExistingYearTablesAsync(conn);
        var yearProjLegs = projectTables.Count == 0 ? "SELECT NULL AS fk_year_id WHERE 1=0" :
            string.Join(" UNION ", projectTables.Select(t =>
                $"(SELECT {t.YearId} AS fk_year_id FROM `{t.ProjectsTable}` WHERE fk_club_id = @ClubId AND isdeleted = 0 AND is_active = 1 LIMIT 1)"));

        return await conn.ExecuteScalarAsync<int?>($@"
            SELECT y.pk_year_id
            FROM rotary_year_master y
            WHERE y.pk_year_id IN (
                SELECT DISTINCT fk_year_id FROM board_of_directors
                  WHERE fk_club_id = @ClubId AND isdeleted = 0
                UNION
                SELECT fk_year_id FROM ({yearProjLegs}) yp
                UNION
                SELECT DISTINCT y2.pk_year_id FROM upcoming_events ue
                  JOIN rotary_year_master y2 ON ue.EventDate >= y2.StartDate AND ue.EventDate < DATE_ADD(y2.EndDate, INTERVAL 1 DAY)
                  WHERE ue.fk_club_id = @ClubId AND ue.isdeleted = 0 AND ue.IsActive = 1
            )
            ORDER BY y.IsCurrent DESC, y.pk_year_id DESC
            LIMIT 1",
            new { ClubId = clubId });
    }

    // ── International President (current year by default) ─────────────────
    // Returned data is identical regardless of which club asks — single row per year.
    // Frontend home page renders a dummy card when no record exists for the year.

    public class InternationalPresidentDto
    {
        public int Id { get; set; }
        public int YearId { get; set; }
        public string YearLabel { get; set; } = "";
        public string Name { get; set; } = "";
        public string? Designation { get; set; }
        public string? ProfilePhotoPath { get; set; }
        public string? Description { get; set; }
    }

    [HttpGet("{clubId:int}/international-president")]
    public async Task<ActionResult<InternationalPresidentDto?>> GetInternationalPresident(int clubId, [FromQuery] int? yearId)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsClubServiceableAsync(conn, clubId)) return NotFound();

        // Default to current year when yearId not provided.
        int? resolvedYearId = yearId;
        if (!resolvedYearId.HasValue)
        {
            resolvedYearId = await conn.ExecuteScalarAsync<int?>(
                "SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1");
        }
        if (!resolvedYearId.HasValue) return Ok((object?)null);

        var row = await conn.QueryFirstOrDefaultAsync<InternationalPresidentDto>(@"
            SELECT p.pk_id AS Id, p.fk_year_id AS YearId, y.YearLabel AS YearLabel,
                   p.Name AS Name, p.Designation AS Designation,
                   CASE
                       WHEN p.ProfilePhotoPath IS NULL OR p.ProfilePhotoPath = '' THEN NULL
                       WHEN p.ProfilePhotoPath LIKE '/Documents/directory/%' THEN p.ProfilePhotoPath
                       ELSE CONCAT('/Documents/WebsiteData/International_President/', p.ProfilePhotoPath)
                   END AS ProfilePhotoPath,
                   p.Description AS Description
            FROM international_president p
            JOIN rotary_year_master y ON y.pk_year_id = p.fk_year_id
            WHERE p.fk_year_id = @YearId AND p.isdeleted = 0
            LIMIT 1",
            new { YearId = resolvedYearId.Value });

        if (row != null) row.Description = RotaryApi.Services.PublicHtml.Clean(row.Description);
        return Ok(row);
    }

    // ── District Governor (for this club's district, year-wise) ───────────

    public class DistrictGovernorDto
    {
        public int Id { get; set; }
        public int YearId { get; set; }
        public string YearLabel { get; set; } = "";
        public int? MemberId { get; set; }              // link to the Rotarian profile, null if no member match
        public string MemberName { get; set; } = "";
        public string? ProfilePhoto { get; set; }
        public string? Description { get; set; }
        public string? MobileNumber { get; set; }       // pulled live from member_master_profile
        public string? Email { get; set; }              // pulled live from member_master_profile
        public string Designation { get; set; } = "District Governor"; // always; included for the website's tile UI
    }

    [HttpGet("{clubId:int}/district-governor")]
    public async Task<ActionResult<DistrictGovernorDto?>> GetDistrictGovernor(int clubId, [FromQuery] int? yearId)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsClubServiceableAsync(conn, clubId)) return NotFound();

        int? resolvedYearId = yearId;
        if (!resolvedYearId.HasValue)
        {
            resolvedYearId = await conn.ExecuteScalarAsync<int?>(
                "SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1");
        }
        if (!resolvedYearId.HasValue) return Ok((object?)null);

        // Name + mobile + email + photo resolution (2026-06-25 per user):
        //   district_governors holds the row but only carries metadata. When the DG IS a
        //   member, name/mobile/email/photo all come from member_master_profile via the
        //   fk_member_id link. Single source of truth: a member's profile-photo edit is
        //   reflected everywhere (BOD card, directory, DG card) at once.
        //   Some districts have a DG who is not a member of any club (2026-09-23 per user):
        //   that row has no fk_member_id and carries its own name, photo and contacts, which
        //   is what the card falls back to instead of showing blank.
        var row = await conn.QueryFirstOrDefaultAsync<DistrictGovernorDto>($@"
            SELECT g.pk_id                                                                  AS Id,
                   g.fk_year_id                                                             AS YearId,
                   y.YearLabel                                                              AS YearLabel,
                   g.fk_member_id                                                           AS MemberId,
                   {DistrictGovernorSql.Name}                                               AS MemberName,
                   {DistrictGovernorSql.Photo}                                              AS ProfilePhoto,
                   g.description                                                            AS Description,
                   {DistrictGovernorSql.Mobile}                                             AS MobileNumber,
                   {DistrictGovernorSql.Email}                                              AS Email,
                   'District Governor'                                                      AS Designation
            FROM district_governors g
            JOIN rotary_year_master y ON y.pk_year_id = g.fk_year_id
            JOIN club_master c ON c.fk_district_id = g.fk_district_id
            {DistrictGovernorSql.JoinMember}
            WHERE c.pk_club_id = @ClubId
              AND g.fk_year_id = @YearId
              AND g.isdeleted = 0
            LIMIT 1",
            new { ClubId = clubId, YearId = resolvedYearId.Value });

        if (row != null) row.Description = RotaryApi.Services.PublicHtml.Clean(row.Description);
        return Ok(row);
    }

    // ── Upcoming Events (active only, ordered by event date) ──────────────

    public class PublicUpcomingEventDto
    {
        public int Id { get; set; }
        public string Title { get; set; } = "";
        public string? Description { get; set; }
        public string? Venue { get; set; }
        public DateTime EventDate { get; set; }
        public string? ImagePath { get; set; }
        public string? RegistrationLink { get; set; }
    }

    [HttpGet("{clubId:int}/upcoming-events")]
    public async Task<ActionResult<IEnumerable<PublicUpcomingEventDto>>> GetUpcomingEvents(int clubId, [FromQuery] int limit = 6)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsClubServiceableAsync(conn, clubId)) return NotFound();

        // Show only currently-published events: published <= NOW and not yet expired,
        // and event date in the future. Excludes drafts and finished events.
        var rows = await conn.QueryAsync<PublicUpcomingEventDto>(@"
            SELECT pk_upcoming_event_id AS Id, Title, Description,
                   EventVenue AS Venue, EventDate,
                   CASE
                       WHEN ImagePath IS NULL OR ImagePath = '' THEN NULL
                       WHEN ImagePath LIKE '/%' THEN ImagePath
                       WHEN Scope = 'ri' THEN CONCAT('/Documents/Event/ri/', ImagePath)
                       WHEN fk_district_id IS NOT NULL THEN CONCAT('/Documents/Event/Group', fk_district_id, '/', ImagePath)
                       ELSE CONCAT('/Documents/Event/Group', fk_club_id, '/', ImagePath)
                   END AS ImagePath,
                   RegistrationLink
            FROM upcoming_events
            WHERE fk_club_id = @ClubId AND isdeleted = 0
              AND PublishDate <= NOW() AND ExpiryDate >= NOW()
              AND EventDate >= CURDATE()
            ORDER BY EventDate ASC
            LIMIT @Limit",
            new { ClubId = clubId, Limit = limit });
        return Ok(rows);
    }

    // ── Newsletters (latest first, optional year filter) ──────────────────

    public class PublicNewsletterDto
    {
        public int Id { get; set; }
        public int YearId { get; set; }
        public string Title { get; set; } = "";
        public DateTime PublishDateTime { get; set; }
        public string? FilePath { get; set; }
        public string? LinkUrl { get; set; }
        public string? AttachmentType { get; set; }
    }

    [HttpGet("{clubId:int}/newsletters")]
    public async Task<ActionResult<IEnumerable<PublicNewsletterDto>>> GetNewsletters(int clubId, [FromQuery] int? yearId, [FromQuery] int limit = 6)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsClubServiceableAsync(conn, clubId)) return NotFound();

        // Newsletter visibility (public club website):
        //   • Show only PUBLISHED newsletters — PublishDateTime <= NOW(). A future publish
        //     time is "Unpublished" (exactly how the admin listing labels it) and must NOT
        //     appear publicly until it goes live. (This restores the publish gate that was
        //     dropped 2026-06-26; if a 'publish now' newsletter briefly reads as future due to
        //     admin/server clock skew, fix it by storing the publish time in the server TZ —
        //     do NOT drop this gate, or scheduled/unpublished bulletins leak to the public.)
        //   • Treat ExpiryDateTime == PublishDateTime as "no expiry": the admin UI no
        //     longer captures a separate expiry, so it stores them EQUAL — which made
        //     every newsletter vanish the instant its publish time passed. Only a
        //     GENUINE future expiry (> publish) hides the bulletin once it lapses.
        var sql = @"
            SELECT pk_newsletter_id AS Id, fk_year_id AS YearId,
                   Title, PublishDateTime,
                   CASE
                       WHEN FilePath IS NULL OR FilePath = '' THEN NULL
                       WHEN FilePath LIKE '/%' THEN FilePath
                       WHEN Scope = 'ri' THEN CONCAT('/Documents/ebulletin/ri/', FilePath)
                       WHEN fk_district_id IS NOT NULL AND fk_district_id > 0 THEN CONCAT('/Documents/ebulletin/Group', fk_district_id, '/', FilePath)
                       WHEN fk_club_id IS NOT NULL AND fk_club_id > 0 THEN CONCAT('/Documents/ebulletin/Group', fk_club_id, '/', FilePath)
                       ELSE NULL
                   END AS FilePath,
                   LinkUrl, AttachmentType
            FROM newsletters
            WHERE fk_club_id = @ClubId AND COALESCE(isdeleted, 0) = 0
              AND PublishDateTime <= NOW()
              AND (ExpiryDateTime IS NULL OR ExpiryDateTime <= PublishDateTime OR ExpiryDateTime >= NOW())";
        var p = new DynamicParameters();
        p.Add("ClubId", clubId);
        if (yearId.HasValue) { sql += " AND fk_year_id = @YearId"; p.Add("YearId", yearId.Value); }
        sql += " ORDER BY PublishDateTime DESC LIMIT @Limit";
        p.Add("Limit", limit);

        var rows = await conn.QueryAsync<PublicNewsletterDto>(sql, p);
        return Ok(rows);
    }
}
