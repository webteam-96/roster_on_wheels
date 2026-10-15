using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/mobile/find-rotarian")]
[Authorize] // registered users only — mobile must pass a JWT
public class FindRotarianController : ControllerBase
{
    private readonly string _connectionString;

    public FindRotarianController(IConfiguration config)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    // ── Search members ──
    // All filters are AND-combined. `keyword` is OR across classification/profession/keywords/intro/business/rotary id.
    // At least one filter must be supplied. Paged.
    [HttpGet]
    public async Task<ActionResult> Search(
        [FromQuery] string? name,
        [FromQuery] string? keyword,
        [FromQuery] string? city,
        [FromQuery] string? clubName,
        [FromQuery] string? districtNumber,
        [FromQuery] string? mobile,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20)
    {
        var nm = name?.Trim();
        var kw = keyword?.Trim();
        var ci = city?.Trim();
        var cn = clubName?.Trim();
        var dn = districtNumber?.Trim();
        var mo = mobile?.Trim();

        var hasAny = !string.IsNullOrEmpty(nm) || !string.IsNullOrEmpty(kw)
                  || !string.IsNullOrEmpty(ci) || !string.IsNullOrEmpty(cn)
                  || !string.IsNullOrEmpty(dn) || !string.IsNullOrEmpty(mo);
        if (!hasAny) return Ok(new { items = Array.Empty<object>(), totalCount = 0, page, pageSize });

        if (page < 1) page = 1;
        if (pageSize < 1) pageSize = 20;
        if (pageSize > 100) pageSize = 100;

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var whereSql = @"
            FROM member_master_profile m
            JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
                 AND cm.IsActive = 1 AND cm.isdeleted = 0
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
            JOIN district_master d ON d.pk_district_id = c.fk_district_id AND d.isdeleted = 0 AND d.IsActive = 1
            WHERE m.isdeleted = 0";

        var p = new DynamicParameters();

        if (!string.IsNullOrEmpty(nm)) { whereSql += " AND m.MemberName LIKE @Nm"; p.Add("Nm", $"%{nm}%"); }
        if (!string.IsNullOrEmpty(kw))
        {
            // search across classification/keyword-like fields on member_address_details
            // + Designation/ClassificationProfession on club_members (Step 11B 2026-06-18) + rotary id + intro
            whereSql += @" AND (
                m.RotaryId LIKE @Kw
                OR m.MemberIntroduction LIKE @Kw
                OR EXISTS (
                    SELECT 1 FROM member_address_details ma
                    WHERE ma.fk_member_master_profile_id = m.pk_member_master_profile_id
                      AND ma.isdeleted = 0
                      AND (
                          ma.Keywords LIKE @Kw
                          OR ma.BusinessName LIKE @Kw
                      )
                )
                OR EXISTS (
                    SELECT 1 FROM club_members cm2
                    WHERE cm2.fk_member_master_profile_id = m.pk_member_master_profile_id
                      AND COALESCE(cm2.isdeleted, 0) = 0
                      AND (cm2.Designation LIKE @Kw OR cm2.ClassificationProfession LIKE @Kw)
                )
            )";
            p.Add("Kw", $"%{kw}%");
        }
        if (!string.IsNullOrEmpty(ci))
        {
            whereSql += @" AND (
                c.City LIKE @Ci
                OR EXISTS (
                    SELECT 1 FROM member_address_details ma
                    WHERE ma.fk_member_master_profile_id = m.pk_member_master_profile_id
                      AND ma.isdeleted = 0 AND ma.City LIKE @Ci
                )
            )";
            p.Add("Ci", $"%{ci}%");
        }
        if (!string.IsNullOrEmpty(cn))
        {
            whereSql += " AND (c.ClubName LIKE @Cn OR c.ClubRotaryId LIKE @Cn)";
            p.Add("Cn", $"%{cn}%");
        }
        if (!string.IsNullOrEmpty(dn)) { whereSql += " AND d.DistrictNumber LIKE @Dn"; p.Add("Dn", $"%{dn}%"); }
        if (!string.IsNullOrEmpty(mo))
        {
            whereSql += " AND (m.PrimaryMobileNumber LIKE @Mo OR m.SecondaryMobileNumber LIKE @Mo)";
            p.Add("Mo", $"%{mo}%");
        }

        var totalCount = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(DISTINCT m.pk_member_master_profile_id) " + whereSql, p);

        p.Add("Offset", (page - 1) * pageSize);
        p.Add("PageSize", pageSize);

        var rawItems = await conn.QueryAsync<dynamic>(@"
            SELECT DISTINCT m.pk_member_master_profile_id AS memberId,
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
                   m.Gender AS gender,
                   c.ClubName AS clubName,
                   c.ClubRotaryId AS clubRotaryId,
                   d.DistrictNumber AS districtNumber,
                   c.City AS city, c.State AS state,
                   cm.IsHonoraryMember AS isHonorary,
                   cm.IsActive AS isActive"
            + whereSql +
            " ORDER BY m.MemberName LIMIT @PageSize OFFSET @Offset", p);

        // Global (no district restriction) search: MyClub applies only to rows that are
        // the viewer's own club peers; every other result uses the AllClubs flags.
        var viewerMemberId = Services.MemberPrivacyHelper.GetViewerMemberId(User);
        var clubPeerMemberIds = await Services.MemberPrivacyHelper.GetClubPeerMemberIdsAsync(conn, viewerMemberId);
        var items = rawItems.Select(r =>
        {
            int rowMemberId = Convert.ToInt32(r.memberId);
            bool sharesClub = clubPeerMemberIds.Contains(rowMemberId);
            bool showPhone = Services.MemberPrivacyHelper.ShouldShowPhone(viewerMemberId, rowMemberId, sharesClub,
                (object?)r.showPhoneInMyClub, (object?)r.showPhoneInAllClubs);
            bool showEmail = Services.MemberPrivacyHelper.ShouldShowEmail(viewerMemberId, rowMemberId, sharesClub,
                (object?)r.showEmailInMyClub, (object?)r.showEmailInAllClubs);
            return new
            {
                memberId = rowMemberId,
                memberName = (string?)r.memberName,
                profilePhoto = (string?)r.profilePhoto,
                rotaryId = (string?)r.rotaryId,
                email = showEmail ? (string?)r.email : null,
                mobile = showPhone ? (string?)r.mobile : null,
                gender = (string?)r.gender,
                clubName = (string?)r.clubName,
                clubRotaryId = (string?)r.clubRotaryId,
                districtNumber = (string?)r.districtNumber,
                city = (string?)r.city,
                state = (string?)r.state,
                isHonorary = r.isHonorary != null && Convert.ToBoolean(r.isHonorary),
                isActive = r.isActive == null || Convert.ToBoolean(r.isActive),
            };
        }).ToList();

        return Ok(new { items, totalCount, page, pageSize });
    }

    // ── Member detail (full: mobile + email + addresses + clubs + current-year designations) ──
    [HttpGet("{memberId}")]
    public async Task<ActionResult> GetDetail(int memberId)
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
                   CASE
                       WHEN m.FamilyPhotoPath IS NULL OR m.FamilyPhotoPath = '' THEN NULL
                       WHEN m.FamilyPhotoPath LIKE '/Documents/directory/%' THEN m.FamilyPhotoPath
                       ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.FamilyPhotoPath, '/', -1))
                   END AS familyPhoto,
                   m.RotaryId AS rotaryId,
                   m.EmailId AS email,
                   m.PrimaryMobileNumber AS primaryMobile,
                   m.SecondaryMobileNumber AS secondaryMobile,
                   m.BirthDate AS birthDate,
                   m.AnniversaryDate AS anniversaryDate,
                   m.BloodGroup AS bloodGroup,
                   m.Gender AS gender,
                   m.PrimaryLanguage AS primaryLanguage,
                   m.IsYouth AS isYouth,
                   m.IsPersonalDetailsVisible AS isPersonalDetailsVisible,
                   m.IsFamilyDetailsVisible AS isFamilyDetailsVisible,
                   m.ShowPhoneInMyClub AS showPhoneInMyClub,
                   m.ShowPhoneInAllClubs AS showPhoneInAllClubs,
                   m.ShowEmailInMyClub AS showEmailInMyClub,
                   m.ShowEmailInAllClubs AS showEmailInAllClubs,
                   m.MemberIntroduction AS memberIntroduction,
                   m.Facebook AS facebook, m.Instagram AS instagram,
                   m.LinkedIn AS linkedIn, m.Twitter AS twitter,
                   m.Youtube AS youtube, m.Website AS website,
                   m.DonorRecognition AS donorRecognition,
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
            memberDict["primaryMobile"] = null;
        if (!Services.MemberPrivacyHelper.ShouldShowEmail(viewerMemberId, memberId, sharesClub,
                memberDict.GetValueOrDefault("showEmailInMyClub"), memberDict.GetValueOrDefault("showEmailInAllClubs")))
            memberDict["email"] = null;
        memberDict.Remove("showPhoneInMyClub");
        memberDict.Remove("showPhoneInAllClubs");
        memberDict.Remove("showEmailInMyClub");
        memberDict.Remove("showEmailInAllClubs");

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

        var clubs = await conn.QueryAsync<dynamic>(@"
            SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId,
                   CASE
                       WHEN c.ClubLogoPath IS NULL OR c.ClubLogoPath = '' THEN NULL
                       WHEN c.ClubLogoPath LIKE '/%' THEN c.ClubLogoPath
                       ELSE CONCAT('/uploads/club/', c.ClubLogoPath)
                   END AS clubLogo,
                   c.City AS city, c.State AS state,
                   d.DistrictNumber AS districtNumber,
                   z.ZoneName AS zoneName,
                   " + CogDesignationHelper.JoinedDateExpr("cm") + @" AS joinedDate,
                   " + CogDesignationHelper.SelectColumns("cm") + @",
                   cm.Designation AS designation,
                   cm.ClassificationProfession AS classification
            FROM club_members cm
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE cm.fk_member_master_profile_id = @Id AND cm.IsActive = 1 AND cm.isdeleted = 0
            ORDER BY c.ClubName",
            new { Id = memberId });

        var currentYearId = await conn.ExecuteScalarAsync<int?>(
            "SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1");

        var designations = currentYearId.HasValue
            ? await conn.QueryAsync<dynamic>(@"
                SELECT dm.designation_name AS designationName, c.ClubName AS clubName,
                       dm.sort_order AS sortOrder
                FROM board_of_directors b
                JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id
                JOIN club_master c ON c.pk_club_id = b.fk_club_id
                WHERE b.fk_member_master_profile_id = @Id AND b.fk_year_id = @YearId AND b.isdeleted = 0
                ORDER BY dm.sort_order",
                new { Id = memberId, YearId = currentYearId.Value })
            : Enumerable.Empty<dynamic>();

        return Ok(new { member = memberDict, addresses, clubs, designations });
    }
}
