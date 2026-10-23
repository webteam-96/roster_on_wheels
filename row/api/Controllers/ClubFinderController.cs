using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/mobile/club-finder")]
[Authorize] // registered users only — mobile must pass a JWT
public class ClubFinderController : ControllerBase
{
    private readonly string _connectionString;
    private readonly IYearTableResolver _yearTables;

    public ClubFinderController(IConfiguration config, IYearTableResolver yearTables)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        _yearTables = yearTables;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    // ── Search clubs (filter mode) ──
    [HttpGet]
    public async Task<ActionResult> Search(
        [FromQuery] string? keyword,
        [FromQuery] int? countryId,
        [FromQuery] string? state,
        [FromQuery] string? districtNumber,
        [FromQuery] string? meetingDay,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20)
    {
        var kw = keyword?.Trim();
        var st = state?.Trim();
        var dn = districtNumber?.Trim();
        var md = meetingDay?.Trim();

        var hasAny = !string.IsNullOrEmpty(kw) || countryId.HasValue
                  || !string.IsNullOrEmpty(st) || !string.IsNullOrEmpty(dn) || !string.IsNullOrEmpty(md);
        if (!hasAny) return Ok(new { items = Array.Empty<object>(), totalCount = 0, page, pageSize });
        if (!string.IsNullOrEmpty(kw) && kw.Length < 2)
            return Ok(new { items = Array.Empty<object>(), totalCount = 0, page, pageSize });
        (page, pageSize) = NormalizePaging(page, pageSize);

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var whereSql = @"
            FROM club_master c
            JOIN district_master d ON d.pk_district_id = c.fk_district_id AND d.isdeleted = 0 AND d.IsActive = 1
            LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0
            LEFT JOIN country_master co ON co.CountryName = c.Country AND co.isdeleted = 0
            WHERE c.isdeleted = 0 AND c.IsActive = 1";

        var p = new DynamicParameters();

        if (!string.IsNullOrEmpty(kw))
        {
            whereSql += @" AND (
                c.ClubName LIKE @Kw OR c.ClubRotaryId LIKE @Kw OR c.City LIKE @Kw OR c.State LIKE @Kw
                OR c.Country LIKE @Kw OR c.MeetingAddress LIKE @Kw OR c.MeetingDay LIKE @Kw
                OR d.DistrictNumber LIKE @Kw OR z.ZoneName LIKE @Kw OR CAST(c.pk_club_id AS CHAR) = @KwExact
            )";
            p.Add("Kw", $"%{kw}%");
            p.Add("KwExact", kw);
        }
        if (countryId.HasValue) { whereSql += " AND co.pk_country_id = @CountryId"; p.Add("CountryId", countryId.Value); }
        if (!string.IsNullOrEmpty(st)) { whereSql += " AND c.State LIKE @State"; p.Add("State", $"%{st}%"); }
        if (!string.IsNullOrEmpty(dn)) { whereSql += " AND d.DistrictNumber LIKE @DistrictNumber"; p.Add("DistrictNumber", $"%{dn}%"); }
        if (!string.IsNullOrEmpty(md)) { whereSql += " AND c.MeetingDay LIKE @MeetingDay"; p.Add("MeetingDay", $"%{md}%"); }

        var totalCount = await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) " + whereSql, p);
        p.Add("Offset", (page - 1) * pageSize);
        p.Add("PageSize", pageSize);

        var items = await conn.QueryAsync<dynamic>(@"
            SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId,
                   CASE
                       WHEN c.ClubLogoPath IS NULL OR c.ClubLogoPath = '' THEN NULL
                       WHEN c.ClubLogoPath LIKE '/%' THEN c.ClubLogoPath
                       ELSE CONCAT('/uploads/club/', c.ClubLogoPath)
                   END AS clubLogo,
                   c.City AS city, c.State AS state, c.Country AS country,
                   c.MeetingDay AS meetingDay, c.MeetingAddress AS meetingAddress,
                   c.Latitude AS latitude, c.Longitude AS longitude,
                   d.DistrictNumber AS districtNumber, z.ZoneName AS zoneName,
                   c.IsSyncedFromRotaryOrg AS isSyncedFromRotaryOrg" + whereSql +
            " ORDER BY c.ClubName LIMIT @PageSize OFFSET @Offset", p);

        return Ok(new { items, totalCount, page, pageSize });
    }

    // ── Search clubs (near-me mode) ──
    [HttpGet("near-me")]
    public async Task<ActionResult> NearMe(
        [FromQuery] decimal? userLatitude,
        [FromQuery] decimal? userLongitude,
        [FromQuery] decimal? range,
        [FromQuery] string? meetingDay,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20)
    {
        if (!userLatitude.HasValue || !userLongitude.HasValue)
            return BadRequest(new { message = "userLatitude and userLongitude are required." });
        if (!range.HasValue || range.Value <= 0)
            return BadRequest(new { message = "range (in km) is required and must be > 0." });
        if (range.Value > 200)
            return BadRequest(new { message = "range cannot exceed 200 km." });
        (page, pageSize) = NormalizePaging(page, pageSize);

        var md = meetingDay?.Trim();
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var latDelta = range.Value / 111m;
        var lngDelta = range.Value / (111m * (decimal)Math.Cos((double)userLatitude.Value * Math.PI / 180.0));

        var whereSql = @"
            FROM club_master c
            JOIN district_master d ON d.pk_district_id = c.fk_district_id AND d.isdeleted = 0 AND d.IsActive = 1
            LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0
            WHERE c.isdeleted = 0 AND c.IsActive = 1
              AND c.Latitude IS NOT NULL AND c.Longitude IS NOT NULL
              AND c.Latitude BETWEEN @MinLat AND @MaxLat
              AND c.Longitude BETWEEN @MinLng AND @MaxLng";

        var p = new DynamicParameters();
        p.Add("UserLat", userLatitude.Value);
        p.Add("UserLng", userLongitude.Value);
        p.Add("Range", range.Value);
        p.Add("MinLat", userLatitude.Value - latDelta);
        p.Add("MaxLat", userLatitude.Value + latDelta);
        p.Add("MinLng", userLongitude.Value - lngDelta);
        p.Add("MaxLng", userLongitude.Value + lngDelta);
        if (!string.IsNullOrEmpty(md)) { whereSql += " AND c.MeetingDay LIKE @MeetingDay"; p.Add("MeetingDay", $"%{md}%"); }

        // Haversine great-circle distance in KM. Preferred over the spherical law of cosines
        // (6371*ACOS(...)) because ACOS loses precision at the tiny angles of "near me" distances
        // (its argument sits at ~1). Haversine's half-angle form stays numerically stable there.
        // R = 6371 km. LEAST(1.0, …) guards ASIN against a float √a that drifts just above 1.
        var distanceExpr = @"
            (2 * 6371 * ASIN(LEAST(1.0, SQRT(
                POWER(SIN(RADIANS(c.Latitude - @UserLat) / 2), 2) +
                COS(RADIANS(@UserLat)) * COS(RADIANS(c.Latitude)) *
                POWER(SIN(RADIANS(c.Longitude - @UserLng) / 2), 2)
            ))))";

        var countSql = $@"
            SELECT COUNT(*) FROM (
                SELECT {distanceExpr} AS dist {whereSql}
            ) t WHERE t.dist <= @Range";
        var totalCount = await conn.ExecuteScalarAsync<int>(countSql, p);

        p.Add("Offset", (page - 1) * pageSize);
        p.Add("PageSize", pageSize);

        var itemsSql = $@"
            SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId,
                   CASE
                       WHEN c.ClubLogoPath IS NULL OR c.ClubLogoPath = '' THEN NULL
                       WHEN c.ClubLogoPath LIKE '/%' THEN c.ClubLogoPath
                       ELSE CONCAT('/uploads/club/', c.ClubLogoPath)
                   END AS clubLogo,
                   c.City AS city, c.State AS state, c.Country AS country,
                   c.MeetingDay AS meetingDay, c.MeetingAddress AS meetingAddress,
                   c.Latitude AS latitude, c.Longitude AS longitude,
                   d.DistrictNumber AS districtNumber, z.ZoneName AS zoneName,
                   c.IsSyncedFromRotaryOrg AS isSyncedFromRotaryOrg,
                   ROUND({distanceExpr}, 2) AS distanceKm
            {whereSql}
            HAVING distanceKm <= @Range
            ORDER BY distanceKm
            LIMIT @PageSize OFFSET @Offset";

        var items = await conn.QueryAsync<dynamic>(itemsSql, p);
        return Ok(new { items, totalCount, page, pageSize });
    }

    // ── Club detail ──
    // Includes: full club row, President + Secretary, club website + district website (from our portal)
    [HttpGet("{clubId}")]
    public async Task<ActionResult> GetDetail(int clubId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var club = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT c.*, d.DistrictNumber AS districtNumber, d.pk_district_id AS districtId,
                   z.ZoneName AS zoneName
            FROM club_master c
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE c.pk_club_id = @Id AND c.isdeleted = 0",
            new { Id = clubId });
        if (club == null) return NotFound(new { message = "Club not found." });

        var currentYearId = await conn.ExecuteScalarAsync<int?>(
            "SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1");

        object? president = null;
        object? secretary = null;
        if (currentYearId.HasValue)
        {
            president = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
                SELECT m.MemberName AS name,
                       CASE
                           WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                           WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                           ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                       END AS profilePhoto
                FROM board_of_directors b
                JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id AND m.isdeleted = 0
                JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id
                WHERE b.fk_club_id = @ClubId AND b.fk_year_id = @YearId AND b.isdeleted = 0
                  AND LOWER(dm.designation_name) LIKE '%president%'
                  AND LOWER(dm.designation_name) NOT LIKE '%vice%'
                  AND LOWER(dm.designation_name) NOT LIKE '%past%'
                ORDER BY dm.sort_order LIMIT 1",
                new { ClubId = clubId, YearId = currentYearId.Value });
            secretary = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
                SELECT m.MemberName AS name,
                       CASE
                           WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                           WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                           ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                       END AS profilePhoto
                FROM board_of_directors b
                JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id AND m.isdeleted = 0
                JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id
                WHERE b.fk_club_id = @ClubId AND b.fk_year_id = @YearId AND b.isdeleted = 0
                  AND LOWER(dm.designation_name) LIKE '%secretary%'
                  AND LOWER(dm.designation_name) NOT LIKE '%joint%'
                ORDER BY dm.sort_order LIMIT 1",
                new { ClubId = clubId, YearId = currentYearId.Value });
        }

        // Club website (from our Club Websites module) — only surface when Active.
        // IMPORTANT: the mobile app opens whatever string we put in `clientDomain`
        // pretty much as-is, so we write the FINAL sanitised URL into that field
        // (full https://... when a real domain or subdomain is configured, empty
        // string "" otherwise — never "na" / "null" / "n/a", else the app would
        // build https://na). `subdomain` is still returned as a safety net (old
        // builds may fall back to it when clientDomain is empty).
        var clubParentDomain = await conn.ExecuteScalarAsync<string?>(
            "SELECT SettingValue FROM system_settings WHERE SettingKey = 'ClubWebsiteParentDomain'");
        if (string.IsNullOrWhiteSpace(clubParentDomain)) clubParentDomain = RotaryApi.Services.Brand.ClubSiteParentDomain;

        // Expired websites (CURDATE() outside StartDate..EndDate) are filtered out
        // here — same treatment as no purchase. clientDomain ends up "" in that case.
        var clubSiteRow = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT Subdomain AS subdomain, ClientDomain AS clientDomain, Status AS status
            FROM club_websites
            WHERE fk_club_id = @ClubId AND COALESCE(isdeleted, 0) = 0 AND Status = 'Active'
              AND CURDATE() BETWEEN StartDate AND EndDate
            LIMIT 1",
            new { ClubId = clubId });
        object clubWebsite;
        if (clubSiteRow != null)
        {
            var cd = ((string?)clubSiteRow.clientDomain)?.Trim();
            var sd = ((string?)clubSiteRow.subdomain)?.Trim();
            var resolved = Services.MemberScopesHelper.BuildWebsiteUrl(cd, sd, clubParentDomain);
            clubWebsite = new
            {
                clientDomain = resolved,
                subdomain = sd ?? "",
                status = (string?)clubSiteRow.status ?? "",
            };
        }
        else
        {
            clubWebsite = new { clientDomain = "", subdomain = "", status = "" };
        }

        // District website (from our District Websites module) — only surface when Active
        var districtParentDomain = await conn.ExecuteScalarAsync<string?>(
            "SELECT SettingValue FROM system_settings WHERE SettingKey = 'DistrictWebsiteParentDomain'");
        if (string.IsNullOrWhiteSpace(districtParentDomain)) districtParentDomain = clubParentDomain;

        var districtId = (int?)club.districtId;
        object districtWebsite = new { clientDomain = "", subdomain = "", status = "" };
        if (districtId.HasValue)
        {
            // district_websites has no StartDate/EndDate — purchase expiry is
            // tracked via Status only. Anything not Active or with no row
            // falls through to the empty-string object initialised above.
            var dRow = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
                SELECT Subdomain AS subdomain, ClientDomain AS clientDomain, Status AS status
                FROM district_websites
                WHERE fk_district_id = @DistrictId AND isdeleted = 0 AND Status = 'Active'
                LIMIT 1",
                new { DistrictId = districtId.Value });
            if (dRow != null)
            {
                var cd = ((string?)dRow.clientDomain)?.Trim();
                var sd = ((string?)dRow.subdomain)?.Trim();
                var resolved = Services.MemberScopesHelper.BuildWebsiteUrl(cd, sd, districtParentDomain);
                districtWebsite = new
                {
                    clientDomain = resolved,
                    subdomain = sd ?? "",
                    status = (string?)dRow.status ?? "",
                };
            }
        }

        return Ok(new { club, president, secretary, clubWebsite, districtWebsite });
    }

    // ── Members list (paged) ──
    [HttpGet("{clubId}/members")]
    public async Task<ActionResult> GetMembers(int clubId, [FromQuery] int page = 1, [FromQuery] int pageSize = 20, [FromQuery] string? search = null)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        (page, pageSize) = NormalizePaging(page, pageSize);
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var currentYearId = await conn.ExecuteScalarAsync<int?>(
            "SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1");

        var whereSql = @"
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            WHERE cm.fk_club_id = @ClubId AND cm.isdeleted = 0 AND cm.IsActive = 1";
        var p = new DynamicParameters();
        p.Add("ClubId", clubId);
        if (!string.IsNullOrWhiteSpace(search))
        {
            whereSql += " AND (m.MemberName LIKE @S OR m.RotaryId LIKE @S OR m.EmailId LIKE @S OR m.PrimaryMobileNumber LIKE @S)";
            p.Add("S", $"%{search.Trim()}%");
        }

        var totalCount = await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) " + whereSql, p);

        p.Add("YearId", currentYearId);
        p.Add("Offset", (page - 1) * pageSize);
        p.Add("PageSize", pageSize);

        var itemsSql = @"
            SELECT m.pk_member_master_profile_id AS memberId,
                   m.MemberName AS memberName,
                   CASE
                       WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                       WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                       ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                   END AS profilePhoto,
                   m.RotaryId AS rotaryId,
                   m.EmailId AS email,
                   m.PrimaryMobileNumber AS mobile,
                   m.ShowPhoneInMyClub AS showPhoneInMyClub,
                   m.ShowPhoneInAllClubs AS showPhoneInAllClubs,
                   m.ShowEmailInMyClub AS showEmailInMyClub,
                   m.ShowEmailInAllClubs AS showEmailInAllClubs,
                   " + CogDesignationHelper.JoinedDateExpr("cm") + @" AS joinedDate,
                   " + CogDesignationHelper.SelectColumns("cm") + @",
                   COALESCE(cm.IsHonoraryMember, 0) AS isHonorary,
                   (SELECT GROUP_CONCAT(dm.designation_name ORDER BY dm.sort_order SEPARATOR ', ')
                    FROM board_of_directors b
                    JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id
                    WHERE b.fk_club_id = @ClubId
                      AND b.fk_member_master_profile_id = m.pk_member_master_profile_id
                      AND b.fk_year_id = @YearId
                      AND b.isdeleted = 0) AS currentDesignation"
            + whereSql +
            " ORDER BY m.MemberName LIMIT @PageSize OFFSET @Offset";

        var rawItems = await conn.QueryAsync<dynamic>(itemsSql, p);

        // Single-club scope: the viewer gets MyClub treatment only for a club they
        // actually belong to. Flag columns are dropped from the response shape.
        var viewerMemberId = Services.MemberPrivacyHelper.GetViewerMemberId(User);
        var viewerSharesClub = await Services.MemberPrivacyHelper.ViewerSharesClubAsync(conn, viewerMemberId, clubId);
        var items = rawItems.Select(r =>
        {
            int rowMemberId = Convert.ToInt32(r.memberId);
            bool showPhone = Services.MemberPrivacyHelper.ShouldShowPhone(viewerMemberId, rowMemberId, viewerSharesClub,
                (object?)r.showPhoneInMyClub, (object?)r.showPhoneInAllClubs);
            bool showEmail = Services.MemberPrivacyHelper.ShouldShowEmail(viewerMemberId, rowMemberId, viewerSharesClub,
                (object?)r.showEmailInMyClub, (object?)r.showEmailInAllClubs);
            return new
            {
                memberId = rowMemberId,
                memberName = (string?)r.memberName,
                profilePhoto = (string?)r.profilePhoto,
                rotaryId = (string?)r.rotaryId,
                email = showEmail ? (string?)r.email : null,
                mobile = showPhone ? (string?)r.mobile : null,
                joinedDate = r.joinedDate,
                isHonorary = r.isHonorary,
                currentDesignation = (string?)r.currentDesignation,
            };
        }).ToList();

        // Club-level roster split (whole club, ignores search): regular vs honorary.
        var honoraryCount = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            WHERE cm.fk_club_id = @ClubId AND cm.isdeleted = 0 AND cm.IsActive = 1
              AND COALESCE(cm.IsHonoraryMember, 0) = 1",
            new { ClubId = clubId });
        var activeRoster = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            WHERE cm.fk_club_id = @ClubId AND cm.isdeleted = 0 AND cm.IsActive = 1",
            new { ClubId = clubId });

        return Ok(new { items, totalCount, page, pageSize, memberCount = activeRoster - honoraryCount, honoraryCount });
    }

    // ── Member detail ──
    [HttpGet("members/{memberId}")]
    public async Task<ActionResult> GetMemberDetail(int memberId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var member = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT m.pk_member_master_profile_id AS memberId,
                   m.MemberName AS memberName,
                   CASE
                       WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                       WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                       ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                   END AS profilePhoto,
                   m.RotaryId AS rotaryId,
                   m.EmailId AS email,
                   m.PrimaryMobileNumber AS primaryMobile,
                   m.SecondaryMobileNumber AS secondaryMobile,
                   m.BirthDate AS birthDate,
                   m.AnniversaryDate AS anniversaryDate,
                   m.BloodGroup AS bloodGroup,
                   m.Gender AS gender,
                   m.PrimaryLanguage AS primaryLanguage,
                   m.MemberIntroduction AS introduction,
                   m.Facebook AS facebook, m.Instagram AS instagram, m.LinkedIn AS linkedIn,
                   m.Twitter AS twitter, m.Youtube AS youtube, m.Website AS website,
                   m.DonorRecognition AS donorRecognition,
                   CASE
                       WHEN m.FamilyPhotoPath IS NULL OR m.FamilyPhotoPath = '' THEN NULL
                       WHEN m.FamilyPhotoPath LIKE '/Documents/directory/%' THEN m.FamilyPhotoPath
                       ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.FamilyPhotoPath, '/', -1))
                   END AS familyPhoto,
                   m.IsPersonalDetailsVisible AS isPersonalDetailsVisible,
                   m.IsFamilyDetailsVisible AS isFamilyDetailsVisible,
                   m.IsYouth AS isYouth,
                   m.ShowPhoneInMyClub AS showPhoneInMyClub,
                   m.ShowPhoneInAllClubs AS showPhoneInAllClubs,
                   m.ShowEmailInMyClub AS showEmailInMyClub,
                   m.ShowEmailInAllClubs AS showEmailInAllClubs,
                   pc.CountryName AS primaryCountry, pc.PhoneCode AS primaryPhoneCode,
                   sc.CountryName AS secondaryCountry, sc.PhoneCode AS secondaryPhoneCode
            FROM member_master_profile m
            LEFT JOIN country_master pc ON pc.pk_country_id = m.fk_primary_country_id
            LEFT JOIN country_master sc ON sc.pk_country_id = m.fk_secondary_country_id
            WHERE m.pk_member_master_profile_id = @Id AND m.isdeleted = 0",
            new { Id = memberId });
        if (member == null) return NotFound(new { message = "Member not found." });

        // Cross-club endpoint: MyClub applies only when the viewer and this member
        // share at least one active club. The flag columns are stripped from the payload.
        var viewerMemberId = Services.MemberPrivacyHelper.GetViewerMemberId(User);
        var sharesClub = await Services.MemberPrivacyHelper.ViewerSharesClubWithMemberAsync(conn, viewerMemberId, memberId);
        var memberDict = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var kv in (IDictionary<string, object?>)member) memberDict[kv.Key] = kv.Value;
        if (!Services.MemberPrivacyHelper.ShouldShowPhone(viewerMemberId, memberId, sharesClub,
                memberDict.GetValueOrDefault("showPhoneInMyClub"), memberDict.GetValueOrDefault("showPhoneInAllClubs")))
            memberDict["primaryMobile"] = memberDict["secondaryMobile"] = null;
        if (!Services.MemberPrivacyHelper.ShouldShowEmail(viewerMemberId, memberId, sharesClub,
                memberDict.GetValueOrDefault("showEmailInMyClub"), memberDict.GetValueOrDefault("showEmailInAllClubs")))
            memberDict["email"] = null;
        memberDict.Remove("showPhoneInMyClub");
        memberDict.Remove("showPhoneInAllClubs");
        memberDict.Remove("showEmailInMyClub");
        memberDict.Remove("showEmailInAllClubs");
        var detailsHidden = Services.MemberPrivacyHelper.HidePrivateDetails(memberDict, viewerMemberId, memberId);

        // Designation + ClassificationProfession live on club_members (per-club),
        // not on member_address_details. Stripped from addresses; surfaced
        // per-club in the clubs array below.
        var addresses = await conn.QueryAsync<dynamic>(@"
            SELECT a.AddressType AS addressType, a.PhoneNumber AS phoneNumber,
                   a.Address AS address, a.City AS city, a.State AS state, a.PinCode AS pinCode,
                   co.CountryName AS country,
                   a.BusinessName AS businessName, a.BusinessEmailId AS businessEmail,
                   a.Keywords AS keywords
            FROM member_address_details a
            LEFT JOIN country_master co ON co.pk_country_id = a.fk_country_id
            WHERE a.fk_member_master_profile_id = @Id AND a.isdeleted = 0",
            new { Id = memberId });
        // the home address is a personal detail too (the app shows it only when they are visible)
        if (detailsHidden) addresses = addresses.Where(a => !((string?)a.addressType ?? "").StartsWith("Resid", StringComparison.OrdinalIgnoreCase));

        var clubs = await conn.QueryAsync<dynamic>(@"
            SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId,
                   CASE
                       WHEN c.ClubLogoPath IS NULL OR c.ClubLogoPath = '' THEN NULL
                       WHEN c.ClubLogoPath LIKE '/%' THEN c.ClubLogoPath
                       ELSE CONCAT('/uploads/club/', c.ClubLogoPath)
                   END AS clubLogo,
                   " + CogDesignationHelper.JoinedDateExpr("cm") + @" AS joinedDate,
                   " + CogDesignationHelper.SelectColumns("cm") + @",
                   d.DistrictNumber AS districtNumber,
                   cm.Designation AS designation,
                   cm.ClassificationProfession AS profession
            FROM club_members cm
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
            LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
            WHERE cm.fk_member_master_profile_id = @Id AND cm.isdeleted = 0 AND cm.IsActive = 1
            ORDER BY cm.JoinedDate DESC",
            new { Id = memberId });

        var currentYearId = await conn.ExecuteScalarAsync<int?>(
            "SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1");

        var currentRoles = (IEnumerable<dynamic>)Array.Empty<dynamic>();
        if (currentYearId.HasValue)
        {
            currentRoles = await conn.QueryAsync<dynamic>(@"
                SELECT b.fk_club_id AS clubId, c.ClubName AS clubName,
                       dm.designation_name AS designationName, dm.sort_order AS sortOrder
                FROM board_of_directors b
                JOIN club_master c ON c.pk_club_id = b.fk_club_id AND c.isdeleted = 0
                JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id
                WHERE b.fk_member_master_profile_id = @Id AND b.fk_year_id = @YearId AND b.isdeleted = 0
                ORDER BY dm.sort_order",
                new { Id = memberId, YearId = currentYearId.Value });
        }

        return Ok(new { member = memberDict, addresses, clubs, currentRoles });
    }

    // ── Upcoming events for a club (paged) ──
    [HttpGet("{clubId}/events")]
    public async Task<ActionResult> GetEvents(int clubId, [FromQuery] int page = 1, [FromQuery] int pageSize = 20)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        (page, pageSize) = NormalizePaging(page, pageSize);
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var whereSql = @"
            FROM upcoming_events e
            WHERE e.fk_club_id = @ClubId AND e.isdeleted = 0 AND e.IsActive = 1
              AND e.EventDate >= CURDATE()";
        var p = new DynamicParameters();
        p.Add("ClubId", clubId);

        var totalCount = await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) " + whereSql, p);
        p.Add("Offset", (page - 1) * pageSize);
        p.Add("PageSize", pageSize);

        var items = await conn.QueryAsync<dynamic>(@"
            SELECT e.pk_upcoming_event_id AS eventId,
                   e.Title AS title,
                   e.Description AS description,
                   CASE
                       WHEN e.ImagePath IS NULL OR e.ImagePath = '' THEN NULL
                       WHEN e.ImagePath LIKE '/%' THEN e.ImagePath
                       WHEN e.fk_district_id IS NOT NULL THEN CONCAT('/Documents/Event/Group', e.fk_district_id, '/', e.ImagePath)
                       ELSE CONCAT('/Documents/Event/Group', e.fk_club_id, '/', e.ImagePath)
                   END AS imagePath,
                   e.EventDate AS eventDate,
                   e.EventVenue AS venue,
                   e.RegistrationLink AS registrationLink,
                   e.Status AS status"
            + whereSql +
            " ORDER BY e.EventDate LIMIT @PageSize OFFSET @Offset", p);

        return Ok(new { items, totalCount, page, pageSize });
    }

    // ── Event detail ──
    [HttpGet("events/{eventId}")]
    public async Task<ActionResult> GetEventDetail(int eventId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var ev = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT e.pk_upcoming_event_id AS eventId,
                   e.fk_club_id AS clubId, c.ClubName AS clubName,
                   CASE
                       WHEN c.ClubLogoPath IS NULL OR c.ClubLogoPath = '' THEN NULL
                       WHEN c.ClubLogoPath LIKE '/%' THEN c.ClubLogoPath
                       ELSE CONCAT('/uploads/club/', c.ClubLogoPath)
                   END AS clubLogo,
                   d.DistrictNumber AS districtNumber,
                   e.Title AS title,
                   e.Description AS description,
                   CASE
                       WHEN e.ImagePath IS NULL OR e.ImagePath = '' THEN NULL
                       WHEN e.ImagePath LIKE '/%' THEN e.ImagePath
                       WHEN e.fk_district_id IS NOT NULL THEN CONCAT('/Documents/Event/Group', e.fk_district_id, '/', e.ImagePath)
                       ELSE CONCAT('/Documents/Event/Group', e.fk_club_id, '/', e.ImagePath)
                   END AS imagePath,
                   e.EventDate AS eventDate,
                   e.PublishDate AS publishDate,
                   e.ExpiryDate AS expiryDate,
                   e.EventVenue AS venue,
                   e.RegistrationLink AS registrationLink,
                   e.Status AS status,
                   -- name only: the creator's email and mobile skipped their privacy flags, and the app shows neither
                   cb.MemberName AS organizerName
            FROM upcoming_events e
            JOIN club_master c ON c.pk_club_id = e.fk_club_id
            LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
            LEFT JOIN member_master_profile cb ON cb.pk_member_master_profile_id = e.created_by
            WHERE e.pk_upcoming_event_id = @Id AND e.isdeleted = 0",
            new { Id = eventId });
        if (ev == null) return NotFound(new { message = "Event not found." });

        return Ok(ev);
    }

    // ── Project years with data ──
    // Returns only rotary years that have at least one project for this club (for the filter dropdown)
    [HttpGet("{clubId}/project-years")]
    public async Task<ActionResult> GetProjectYears(int clubId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Year-wise: union over every existing year-wise table where this club has project rows.
        var tables = await _yearTables.GetAllExistingYearTablesAsync(conn);
        if (tables.Count == 0) return Ok(Array.Empty<object>());
        var legs = string.Join(" UNION ALL ", tables.Select(t =>
            $@"(SELECT {t.YearId} AS yearId, '{t.YearLabel}' AS yearName,
                       (SELECT IsCurrent FROM rotary_year_master WHERE pk_year_id = {t.YearId}) AS isCurrent
                FROM `{t.ProjectsTable}` p
                LEFT JOIN module_master md ON md.pk_module_id = p.fk_module_id
                WHERE p.fk_club_id = @ClubId AND p.isdeleted = 0
                  -- exclude club_service (meetings) so a meetings-only year doesn't show an empty projects list
                  AND COALESCE(md.ModuleKey, '') <> 'club_service'
                LIMIT 1)"));
        var years = await conn.QueryAsync<dynamic>(
            $"SELECT * FROM ({legs}) u ORDER BY u.yearName DESC",
            new { ClubId = clubId });
        return Ok(years);
    }

    // ── Projects listing (paged) with optional year filter ──
    [HttpGet("{clubId}/projects")]
    public async Task<ActionResult> GetProjects(int clubId, [FromQuery] int? yearId, [FromQuery] int page = 1, [FromQuery] int pageSize = 20)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        (page, pageSize) = NormalizePaging(page, pageSize);
        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Year-wise: pick one table when yearId given, else UNION across all.
        var tables = yearId.HasValue
            ? new List<YearTableInfo> { (await _yearTables.ResolveByYearIdAsync(conn, yearId.Value)) }
                .Where(t => t != null).Cast<YearTableInfo>().ToList()
            : await _yearTables.GetAllExistingYearTablesAsync(conn);
        if (tables.Count == 0) return Ok(new { items = Array.Empty<object>(), totalCount = 0, page, pageSize });

        var itemsUnion = string.Join(" UNION ALL ", tables.Select(t => {
            var suffix = t.YearLabel.Replace("-", "_");
            return $@"SELECT p.pk_project_id AS projectId,
                             p.fk_year_id AS yearId,
                             p.title AS title, p.description AS description, p.location AS location,
                             p.project_date AS projectDate, p.project_cost AS projectCost,
                             p.direct_beneficiaries AS directBeneficiaries,
                             p.project_type AS projectType,
                             p.is_joint_project AS isJointProject, p.co_host_name AS coHostName,
                             md.ModuleName AS moduleName, a.name AS areaOfFocus,
                             (SELECT CONCAT('/Documents/gallery/Group', p.fk_club_id, '/',
                                       CASE WHEN p.old_pk IS NOT NULL THEN CONCAT('Album', p.old_pk)
                                            ELSE CONCAT('{suffix}/Album', p.pk_project_id) END,
                                       '/', rp.image_path)
                              FROM `{t.PhotosTable}` rp
                              WHERE rp.fk_project_id = p.pk_project_id
                              ORDER BY rp.pk_photo_id LIMIT 1) AS coverPhoto,
                             (SELECT COUNT(*) FROM `{t.PhotosTable}` rp
                              WHERE rp.fk_project_id = p.pk_project_id) AS photoCount
                      FROM `{t.ProjectsTable}` p
                      LEFT JOIN module_master md ON md.pk_module_id = p.fk_module_id
                      LEFT JOIN area_of_focus_master a ON a.pk_area_of_focus_id = p.fk_area_of_focus_id
                      WHERE p.fk_club_id = @ClubId AND p.isdeleted = 0 AND p.is_active = 1
                        -- club_service = club meetings, not a project avenue. Excluded from every other
                        -- projects feed (PublicProjectStats, district dashboards); keep this list consistent.
                        AND COALESCE(md.ModuleKey, '') <> 'club_service'";
        }));

        var countUnion = string.Join(" UNION ALL ", tables.Select(t =>
            $@"SELECT COUNT(*) AS c FROM `{t.ProjectsTable}` p
               LEFT JOIN module_master md ON md.pk_module_id = p.fk_module_id
               WHERE p.fk_club_id = @ClubId AND p.isdeleted = 0 AND p.is_active = 1
                 AND COALESCE(md.ModuleKey, '') <> 'club_service'"));

        var totalCount = await conn.ExecuteScalarAsync<int>(
            $"SELECT COALESCE(SUM(c), 0) FROM ({countUnion}) u",
            new { ClubId = clubId });

        var items = await conn.QueryAsync<dynamic>(
            $"SELECT * FROM ({itemsUnion}) u ORDER BY u.projectDate DESC, u.projectId DESC LIMIT @PageSize OFFSET @Offset",
            new { ClubId = clubId, PageSize = pageSize, Offset = (page - 1) * pageSize });

        return Ok(new { items, totalCount, page, pageSize });
    }

    // ── Project detail with all photos ──
    // Year-wise: URL has no yearId so we scan year tables to find the matching id.
    [HttpGet("projects/{projectId}")]
    public async Task<ActionResult> GetProjectDetail(int projectId, [FromQuery] int? yearId = null)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        YearTableInfo? info = null;
        if (yearId.HasValue && yearId.Value > 0)
        {
            info = await _yearTables.ResolveByYearIdAsync(conn, yearId.Value);
        }
        else
        {
            foreach (var t in await _yearTables.GetAllExistingYearTablesAsync(conn))
            {
                var exists = await conn.ExecuteScalarAsync<int>(
                    $"SELECT COUNT(*) FROM `{t.ProjectsTable}` WHERE pk_project_id = @Id AND isdeleted = 0",
                    new { Id = projectId });
                if (exists > 0) { info = t; break; }
            }
        }
        if (info is null) return NotFound(new { message = "Project not found." });

        var project = await conn.QueryFirstOrDefaultAsync<dynamic>($@"
            SELECT p.pk_project_id AS projectId,
                   p.fk_club_id AS clubId, c.ClubName AS clubName,
                   CASE
                       WHEN c.ClubLogoPath IS NULL OR c.ClubLogoPath = '' THEN NULL
                       WHEN c.ClubLogoPath LIKE '/%' THEN c.ClubLogoPath
                       ELSE CONCAT('/uploads/club/', c.ClubLogoPath)
                   END AS clubLogo,
                   d.DistrictNumber AS districtNumber,
                   y.YearLabel AS yearName,
                   p.title AS title, p.description AS description, p.location AS location,
                   p.project_date AS projectDate, p.project_cost AS projectCost,
                   p.direct_beneficiaries AS directBeneficiaries,
                   p.man_hours AS manHours,
                   p.rotarians_involved AS rotariansInvolved,
                   p.rotaractors_involved AS rotaractorsInvolved,
                   COALESCE(p.rcc_involved,0) AS rccInvolved,
                   p.project_type AS projectType,
                   p.is_joint_project AS isJointProject, p.co_host_name AS coHostName,
                   p.club_role AS clubRole, p.ongoing_group_title AS ongoingGroupTitle,
                   md.ModuleName AS moduleName, a.name AS areaOfFocus,
                   p.other_area_of_focus AS otherAreaOfFocus,
                   f.name AS fundingName,
                   -- name only: the creator's email and mobile skipped their privacy flags, and the app shows neither
                   cb.MemberName AS createdByName,
                   p.created_date AS createdDate
            FROM `{info.ProjectsTable}` p
            JOIN club_master c ON c.pk_club_id = p.fk_club_id
            LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
            LEFT JOIN rotary_year_master y ON y.pk_year_id = p.fk_year_id
            LEFT JOIN module_master md ON md.pk_module_id = p.fk_module_id
            LEFT JOIN area_of_focus_master a ON a.pk_area_of_focus_id = p.fk_area_of_focus_id
            LEFT JOIN funding_master f ON f.pk_funding_id = p.fk_funding_id
            LEFT JOIN member_master_profile cb ON cb.pk_member_master_profile_id = p.created_by
            WHERE p.pk_project_id = @Id AND p.isdeleted = 0",
            new { Id = projectId });
        if (project == null) return NotFound(new { message = "Project not found." });

        var suffix = info.YearLabel.Replace("-", "_");
        int clubIdForPath = project.clubId != null ? (int)project.clubId : 0;
        var photos = await conn.QueryAsync<dynamic>($@"
            SELECT ph.pk_photo_id AS photoId,
                   CONCAT('/Documents/gallery/Group', @ClubId, '/',
                          CASE WHEN p.old_pk IS NOT NULL THEN CONCAT('Album', p.old_pk)
                               ELSE CONCAT('{suffix}/Album', p.pk_project_id) END,
                          '/', ph.image_path) AS imagePath,
                   ph.description AS description
            FROM `{info.PhotosTable}` ph
            JOIN `{info.ProjectsTable}` p ON p.pk_project_id = ph.fk_project_id
            WHERE ph.fk_project_id = @Id
            ORDER BY ph.pk_photo_id",
            new { Id = projectId, ClubId = clubIdForPath });

        return Ok(new { project, photos });
    }

    private static (int page, int pageSize) NormalizePaging(int page, int pageSize)
    {
        if (page < 1) page = 1;
        if (pageSize < 1) pageSize = 20;
        if (pageSize > 100) pageSize = 100;
        return (page, pageSize);
    }
}
