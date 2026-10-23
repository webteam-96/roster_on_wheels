using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Single API for PDF generation: returns all district data (committee, groups, sub-groups, clubs, BOD, members)
/// for a given rotary year and district. All fields from member_master_profile and club_master are included dynamically.
///
/// Every member-bearing row (district committee, group member, sub-group member, club BOD director, club member)
/// is enriched with:
///   - All native member_master_profile fields via SELECT m.*  (includes AnniversaryDate)
///   - residentialAddress sub-object pulled from member_address_details (AddressType='Residential')
///
/// BOD is already returned per-club inside the `clubs` array; each director carries residentialAddress too.
/// </summary>
[ApiController]
[Route("api/district-directory")]
[Authorize]
public class DistrictDirectoryController : ControllerBase
{
    private readonly string _connectionString;

    public DistrictDirectoryController(IConfiguration config)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    // m.* also carries the member's device and app sign-in trail (push token, IMEI): never directory data.
    private static readonly string[] DeviceColumns =
    {
        "LastImei", "LastDeviceToken", "LastDeviceName", "MobileLoginCount",
        "FirstMobileVisit", "LastMobileVisit", "LastMobileLogout", "mobile_force_relogin_at",
    };

    [HttpGet("{districtNumber}")]
    public async Task<ActionResult> GetDistrictDirectory(string districtNumber, [FromQuery] string rotaryYear)
    {
        if (string.IsNullOrWhiteSpace(rotaryYear)) return BadRequest(new { message = "rotaryYear is required (e.g. 2025-2026)." });

        using var conn = CreateConnection();
        await conn.OpenAsync();

        // ── District info (lookup by DistrictNumber) ──
        // IsActive = 1: an Inactive district must not render its directory publicly (returns "not found").
        var district = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT * FROM district_master WHERE DistrictNumber = @Num AND isdeleted = 0 AND IsActive = 1",
            new { Num = districtNumber });
        if (district == null) return NotFound(new { message = $"District '{districtNumber}' not found." });
        int districtId = (int)district.pk_district_id;
        // Every member's profile in the district: the same readers as /api/districts/{id} (its members and managers).
        var me = MemberPrivacyHelper.GetViewerMemberId(User) ?? 0;
        if (me <= 0 || !await ScopeWriteGuardMiddleware.ReadAllowedAsync(_connectionString, me, false, districtId))
            return StatusCode(403, new { message = "You do not have access to this district." });

        // ── Rotary Year info (lookup by YearLabel e.g. "2025-2026") ──
        var year = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT pk_year_id AS id, YearLabel AS yearLabel, StartDate AS startDate, EndDate AS endDate, IsCurrent AS isCurrent FROM rotary_year_master WHERE YearLabel = @Label",
            new { Label = rotaryYear.Trim() });
        if (year == null) return NotFound(new { message = $"Rotary year '{rotaryYear}' not found." });
        int yearId = (int)year.id;
        var rotaryYearInfo = year;

        // ── Year-id → YearLabel lookup (used by BOD fallback messaging) ──
        var yearLabelLookup = (await conn.QueryAsync<dynamic>(
            "SELECT pk_year_id AS id, YearLabel AS label FROM rotary_year_master"))
            .ToDictionary(r => (int)r.id, r => (string)r.label);

        // ── Residential addresses (preloaded once, keyed by member id) ──
        // We pick the LATEST row per member (MAX(pk_member_address_details_id)) because
        // member_address_details can hold historical rows from previous syncs.
        // AddressType accepts both "Residential" (legacy) and "Residence" (current canonical).
        var residentialRows = (await conn.QueryAsync<dynamic>(@"
            SELECT a.fk_member_master_profile_id AS memberId,
                   a.Address     AS address,
                   a.City        AS city,
                   a.State       AS state,
                   a.PinCode     AS pinCode,
                   a.PhoneNumber AS phoneNumber,
                   a.fk_country_id AS countryId
            FROM member_address_details a
            JOIN (
                SELECT fk_member_master_profile_id, MAX(pk_member_address_details_id) AS pk_id
                FROM member_address_details
                WHERE AddressType IN ('Residential','Residence') AND COALESCE(isdeleted, 0) = 0
                GROUP BY fk_member_master_profile_id
            ) latest ON latest.pk_id = a.pk_member_address_details_id
            WHERE a.AddressType IN ('Residential','Residence') AND COALESCE(a.isdeleted, 0) = 0")).ToList();

        var residentialByMemberId = new Dictionary<int, object>();
        foreach (var r in residentialRows)
        {
            int memberId = Convert.ToInt32(r.memberId);
            residentialByMemberId[memberId] = new
            {
                address     = r.address,
                city        = r.city,
                state       = r.state,
                pinCode     = r.pinCode,
                phoneNumber = r.phoneNumber,
                countryId   = r.countryId
            };
        }

        // ── Business addresses (preloaded once, keyed by member id) ──
        // Same latest-row-per-member logic as residential, but AddressType='Business'.
        var businessRows = (await conn.QueryAsync<dynamic>(@"
            SELECT a.fk_member_master_profile_id AS memberId,
                   a.Address     AS address,
                   a.City        AS city,
                   a.State       AS state,
                   a.PinCode     AS pinCode,
                   a.PhoneNumber AS phoneNumber,
                   a.fk_country_id AS countryId
            FROM member_address_details a
            JOIN (
                SELECT fk_member_master_profile_id, MAX(pk_member_address_details_id) AS pk_id
                FROM member_address_details
                WHERE AddressType = 'Business' AND COALESCE(isdeleted, 0) = 0
                GROUP BY fk_member_master_profile_id
            ) latest ON latest.pk_id = a.pk_member_address_details_id
            WHERE a.AddressType = 'Business' AND COALESCE(a.isdeleted, 0) = 0")).ToList();

        var businessByMemberId = new Dictionary<int, object>();
        foreach (var r in businessRows)
        {
            int memberId = Convert.ToInt32(r.memberId);
            businessByMemberId[memberId] = new
            {
                address     = r.address,
                city        = r.city,
                state       = r.state,
                pinCode     = r.pinCode,
                phoneNumber = r.phoneNumber,
                countryId   = r.countryId
            };
        }

        // ── Spouse details (preloaded once, keyed by member id) ──
        // Pulls Name/BirthDate/PhotoPath from member_family_details where Relation='Spouse'.
        // If a member has multiple spouse rows (edge case) we take the LATEST-changed one - the same row
        // the member profile reads and saves, so a change on either side shows on both.
        var spouseRows = (await conn.QueryAsync<dynamic>(@"
            SELECT f.fk_member_master_profile_id AS memberId,
                   f.Name       AS spouseName,
                   f.BirthDate  AS spouseDob,
                   CASE
                       WHEN f.PhotoPath IS NULL OR f.PhotoPath = '' THEN NULL
                       WHEN f.PhotoPath LIKE '/%'   THEN f.PhotoPath
                       WHEN f.PhotoPath LIKE 'http%' THEN f.PhotoPath
                       ELSE CONCAT('/Documents/FaimilyMembersPhoto/', SUBSTRING_INDEX(f.PhotoPath, '/', -1))
                   END          AS spousePhoto
            FROM member_family_details f
            JOIN (
                SELECT pk_member_family_details_id AS pk_id,
                       ROW_NUMBER() OVER (PARTITION BY fk_member_master_profile_id
                                          ORDER BY COALESCE(modified_date, created_date) DESC, pk_member_family_details_id DESC) AS rn
                FROM member_family_details
                WHERE LOWER(TRIM(Relation)) = 'spouse' AND COALESCE(isdeleted,0) = 0
            ) latest ON latest.pk_id = f.pk_member_family_details_id AND latest.rn = 1")).ToList();
        var spouseByMemberId = new Dictionary<int, (string? name, object? dob, string? photo)>();
        foreach (var s in spouseRows)
        {
            int mid = Convert.ToInt32(s.memberId);
            spouseByMemberId[mid] = ((string?)s.spouseName, (object?)s.spouseDob, (string?)s.spousePhoto);
        }

        // ── Classification (preloaded once, keyed by member id) ──
        // Lives on club_members.ClassificationProfession. A member can be in multiple clubs;
        // we take the row from the member's active club membership (IsActive=1) with MIN pk
        // as the canonical classification for directory display.
        var classificationRows = (await conn.QueryAsync<dynamic>(@"
            SELECT cm.fk_member_master_profile_id AS memberId,
                   cm.ClassificationProfession   AS classification
            FROM club_members cm
            JOIN (
                SELECT fk_member_master_profile_id, MIN(pk_club_member_id) AS pk_id
                FROM club_members
                WHERE COALESCE(isdeleted,0) = 0
                  AND IsActive = 1
                  AND ClassificationProfession IS NOT NULL
                  AND ClassificationProfession <> ''
                GROUP BY fk_member_master_profile_id
            ) pick ON pick.pk_id = cm.pk_club_member_id")).ToList();
        var classificationByMemberId = classificationRows
            .ToDictionary(r => (int)r.memberId, r => (string?)r.classification);

        // ── Mobile country code (preloaded once, keyed by member id) ──
        // country_master.PhoneCode (e.g. "91") looked up via fk_primary_country_id.
        var mobileCodeRows = (await conn.QueryAsync<dynamic>(@"
            SELECT m.pk_member_master_profile_id AS memberId,
                   cty.PhoneCode                 AS phoneCode,
                   cty.pk_country_id             AS countryId,
                   cty.CountryName               AS countryName
            FROM member_master_profile m
            LEFT JOIN country_master cty ON cty.pk_country_id = m.fk_primary_country_id
            WHERE m.isdeleted = 0")).ToList();
        var mobileCodeByMemberId = new Dictionary<int, (string? code, int? countryId, string? countryName)>();
        foreach (var mc in mobileCodeRows)
        {
            int mid = Convert.ToInt32(mc.memberId);
            mobileCodeByMemberId[mid] = ((string?)mc.phoneCode,
                mc.countryId == null ? (int?)null : Convert.ToInt32(mc.countryId),
                (string?)mc.countryName);
        }

        // ── Contact-visibility context (preloaded once) ──
        // Rows here span every club in the district, so "does the viewer share a club
        // with this row" is answered per-row against the viewer's club peers. Everyone
        // else in the district falls under the *AllClubs flags.
        var viewerMemberId = RotaryApi.Services.MemberPrivacyHelper.GetViewerMemberId(User);
        var clubPeerMemberIds = await RotaryApi.Services.MemberPrivacyHelper.GetClubPeerMemberIdsAsync(conn, viewerMemberId);

        // Helper: takes the Dapper dynamic rows (each one has m.* fields) and
        // returns a list where each row has a `residentialAddress` sub-object.
        // Looks up the member by `pk_member_master_profile_id`, which `m.*` exposes.
        //
        // IMPORTANT: queries like `SELECT dcm.*, m.*, c.ClubName` produce rows whose
        // column lists OVERLAP across joined tables (`created_by`, `created_date`,
        // `modified_by`, `modified_date`, `isdeleted` exist on every table). We can't
        // use `new Dictionary<>(src, comparer)` because that calls .Add() under the
        // hood and throws ArgumentException on duplicate keys. Instead we walk the
        // entries with the indexer — last-write-wins, matching how a DataReader
        // surfaces duplicate columns (the rightmost SELECT in the row wins).
        List<object> WithAddresses(IEnumerable<dynamic> rows)
        {
            var result = new List<object>();
            foreach (var row in rows)
            {
                var src  = (IDictionary<string, object?>)row;
                var dict = new Dictionary<string, object?>(StringComparer.Ordinal);
                foreach (var kv in src)
                    dict[kv.Key] = kv.Value;
                foreach (var k in DeviceColumns) dict.Remove(k);

                object? residential = null;
                object? business = null;
                string? classification = null;
                string? spouseName = null;
                object? spouseDob = null;
                string? spousePhoto = null;
                string? mobileCountryCode = null;
                int? mobileCountryId = null;
                string? mobileCountryName = null;

                if (src.TryGetValue("pk_member_master_profile_id", out var midObj) && midObj != null)
                {
                    int memberId = Convert.ToInt32(midObj);
                    if (residentialByMemberId.TryGetValue(memberId, out var addr))
                        residential = addr;
                    if (businessByMemberId.TryGetValue(memberId, out var baddr))
                        business = baddr;
                    if (classificationByMemberId.TryGetValue(memberId, out var cls))
                        classification = cls;
                    if (spouseByMemberId.TryGetValue(memberId, out var sp))
                    {
                        spouseName  = sp.name;
                        spouseDob   = sp.dob;
                        spousePhoto = sp.photo;
                    }
                    if (mobileCodeByMemberId.TryGetValue(memberId, out var mc))
                    {
                        mobileCountryCode = mc.code;
                        mobileCountryId   = mc.countryId;
                        mobileCountryName = mc.countryName;
                    }
                }

                // Member profile photo → full web path. Stored as filename only
                // (e.g. "IMG_1234.jpeg"); migrated rows may already be a full "/Documents/..." path.
                string? profilePhoto = null;
                if (src.TryGetValue("ProfilePhotoPath", out var ppObj) && ppObj is string ppStr && !string.IsNullOrWhiteSpace(ppStr))
                {
                    if (ppStr.StartsWith("/") || ppStr.StartsWith("http"))
                        profilePhoto = ppStr;
                    else
                    {
                        var fn = ppStr.Contains('/') ? ppStr[(ppStr.LastIndexOf('/') + 1)..] : ppStr;
                        profilePhoto = "/Documents/directory/" + fn;
                    }
                }

                // Contact-visibility gate. Every row here carries m.* so the four flag
                // columns are already present. The AG projections alias the same
                // two columns under different keys, so those are nulled together — but
                // committeeMobile/committeeEmail are live profile values for member rows; when
                // hidden they fall back to the district's own typed copy (see below).
                if (src.TryGetValue("pk_member_master_profile_id", out var pidObj) && pidObj != null)
                {
                    int rowMemberId = Convert.ToInt32(pidObj);
                    bool sharesClub = clubPeerMemberIds.Contains(rowMemberId);
                    if (!RotaryApi.Services.MemberPrivacyHelper.ShouldShowPhone(viewerMemberId, rowMemberId, sharesClub,
                            dict.GetValueOrDefault("ShowPhoneInMyClub"), dict.GetValueOrDefault("ShowPhoneInAllClubs")))
                    {
                        dict["PrimaryMobileNumber"] = dict["SecondaryMobileNumber"] = null;
                        if (dict.ContainsKey("committeeMobile")) dict["committeeMobile"] = dict.GetValueOrDefault("mobile");
                        if (dict.ContainsKey("agMobile")) dict["agMobile"] = null;
                    }
                    if (!RotaryApi.Services.MemberPrivacyHelper.ShouldShowEmail(viewerMemberId, rowMemberId, sharesClub,
                            dict.GetValueOrDefault("ShowEmailInMyClub"), dict.GetValueOrDefault("ShowEmailInAllClubs")))
                    {
                        dict["EmailId"] = dict["SecondaryEmailId"] = null;
                        // committeeMobile/committeeEmail read the live profile for member rows; a member
                        // who hides them gets the district's own typed copy back (what showed before).
                        if (dict.ContainsKey("committeeEmail")) dict["committeeEmail"] = dict.GetValueOrDefault("email");
                        if (dict.ContainsKey("agEmail")) dict["agEmail"] = null;
                    }
                }

                dict["residentialAddress"] = residential;
                dict["businessAddress"]    = business;
                dict["classification"]     = classification;
                dict["spouseName"]         = spouseName;
                dict["spouseDob"]          = spouseDob;
                dict["spousePhoto"]        = spousePhoto;
                dict["mobileCountryCode"]  = mobileCountryCode;
                dict["mobileCountryId"]    = mobileCountryId;
                dict["mobileCountryName"]  = mobileCountryName;
                dict["profilePhoto"]       = profilePhoto;
                result.Add(dict);
            }
            return result;
        }

        // ── 1. District Committee Members ──
        var districtCommitteeRaw = await conn.QueryAsync<dynamic>(@"
            SELECT dcm.*, m.*, c.ClubName,
                   dcm.name AS committeeName,
                   CASE WHEN COALESCE(dcm.fk_member_id, 0) > 0 AND m.PrimaryMobileNumber IS NOT NULL AND TRIM(m.PrimaryMobileNumber) <> ''
                        THEN m.PrimaryMobileNumber ELSE dcm.mobile END AS committeeMobile,
                   CASE WHEN COALESCE(dcm.fk_member_id, 0) > 0 AND m.EmailId IS NOT NULL AND TRIM(m.EmailId) <> ''
                        THEN m.EmailId ELSE dcm.email END AS committeeEmail,
                   dcm.district_designation AS districtDesignation, dcm.district_remark AS districtRemark,
                   CASE WHEN COALESCE(dcm.fk_member_id, 0) > 0 THEN
                             -- Member: profile photo only (none if the profile has none); non-member: committee upload.
                             CASE WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                                  WHEN m.ProfilePhotoPath LIKE '/%' OR m.ProfilePhotoPath LIKE 'http%' THEN m.ProfilePhotoPath
                                  ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1)) END
                        ELSE dcm.profile_photo END AS committeePhoto, dcm.is_member AS isMember, dcm.sort_order AS sortOrder
            FROM district_committee_member dcm
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = dcm.fk_member_id AND m.isdeleted = 0
            LEFT JOIN club_master c ON c.pk_club_id = dcm.fk_club_id AND c.isdeleted = 0
            WHERE dcm.fk_district_id = @DistrictId AND dcm.fk_year_id = @YearId AND dcm.isdeleted = 0
            ORDER BY dcm.sort_order, dcm.name",
            new { DistrictId = districtId, YearId = yearId });
        var districtCommittee = WithAddresses(districtCommitteeRaw);

        // ── 2. Group Committee (with members + sub-groups + sub-group members) ──
        var groups = (await conn.QueryAsync<dynamic>(@"
            SELECT g.id, g.group_name AS groupName, g.sort_order AS sortOrder, g.is_active AS isActive
            FROM district_committee_group g
            WHERE g.fk_district_id = @DistrictId AND g.fk_year_id = @YearId AND g.isdeleted = 0
            ORDER BY g.sort_order, g.group_name",
            new { DistrictId = districtId, YearId = yearId })).ToList();

        var groupResult = new List<object>();
        foreach (var g in groups)
        {
            int groupId = (int)g.id;

            var groupMembersRaw = await conn.QueryAsync<dynamic>(@"
                SELECT gm.*, m.*, c.ClubName,
                       gm.name AS committeeName,
                       CASE WHEN COALESCE(gm.fk_member_id, 0) > 0 AND m.PrimaryMobileNumber IS NOT NULL AND TRIM(m.PrimaryMobileNumber) <> ''
                            THEN m.PrimaryMobileNumber ELSE gm.mobile END AS committeeMobile,
                       CASE WHEN COALESCE(gm.fk_member_id, 0) > 0 AND m.EmailId IS NOT NULL AND TRIM(m.EmailId) <> ''
                            THEN m.EmailId ELSE gm.email END AS committeeEmail,
                       gm.district_designation AS districtDesignation, gm.district_remark AS districtRemark,
                       CASE WHEN COALESCE(gm.fk_member_id, 0) > 0 THEN
                             -- Member: profile photo only (none if the profile has none); non-member: committee upload.
                             CASE WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                                  WHEN m.ProfilePhotoPath LIKE '/%' OR m.ProfilePhotoPath LIKE 'http%' THEN m.ProfilePhotoPath
                                  ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1)) END
                        ELSE gm.profile_photo END AS committeePhoto, gm.is_member AS isMember, gm.sort_order AS sortOrder
                FROM district_committee_group_member gm
                LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = gm.fk_member_id AND m.isdeleted = 0
                LEFT JOIN club_master c ON c.pk_club_id = gm.fk_club_id AND c.isdeleted = 0
                WHERE gm.fk_group_id = @GroupId AND gm.isdeleted = 0
                ORDER BY gm.sort_order, gm.name",
                new { GroupId = groupId });
            var groupMembers = WithAddresses(groupMembersRaw);

            var subGroups = (await conn.QueryAsync<dynamic>(@"
                SELECT sg.id, sg.sub_group_name AS subGroupName, sg.sort_order AS sortOrder, sg.is_active AS isActive
                FROM district_committee_sub_group sg
                WHERE sg.fk_group_id = @GroupId AND sg.isdeleted = 0
                ORDER BY sg.sort_order, sg.sub_group_name",
                new { GroupId = groupId })).ToList();

            var subGroupResult = new List<object>();
            foreach (var sg in subGroups)
            {
                int subGroupId = (int)sg.id;
                var sgMembersRaw = await conn.QueryAsync<dynamic>(@"
                    SELECT sgm.*, m.*, c.ClubName,
                           sgm.name AS committeeName,
                           CASE WHEN COALESCE(sgm.fk_member_id, 0) > 0 AND m.PrimaryMobileNumber IS NOT NULL AND TRIM(m.PrimaryMobileNumber) <> ''
                                THEN m.PrimaryMobileNumber ELSE sgm.mobile END AS committeeMobile,
                           CASE WHEN COALESCE(sgm.fk_member_id, 0) > 0 AND m.EmailId IS NOT NULL AND TRIM(m.EmailId) <> ''
                                THEN m.EmailId ELSE sgm.email END AS committeeEmail,
                           sgm.district_designation AS districtDesignation, sgm.district_remark AS districtRemark,
                           CASE WHEN COALESCE(sgm.fk_member_id, 0) > 0 THEN
                             -- Member: profile photo only (none if the profile has none); non-member: committee upload.
                             CASE WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                                  WHEN m.ProfilePhotoPath LIKE '/%' OR m.ProfilePhotoPath LIKE 'http%' THEN m.ProfilePhotoPath
                                  ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1)) END
                        ELSE sgm.profile_photo END AS committeePhoto, sgm.is_member AS isMember, sgm.sort_order AS sortOrder
                    FROM district_committee_sub_group_member sgm
                    LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = sgm.fk_member_id AND m.isdeleted = 0
                    LEFT JOIN club_master c ON c.pk_club_id = sgm.fk_club_id AND c.isdeleted = 0
                    WHERE sgm.fk_sub_group_id = @SubGroupId AND sgm.isdeleted = 0
                    ORDER BY sgm.sort_order, sgm.name",
                    new { SubGroupId = subGroupId });
                var sgMembers = WithAddresses(sgMembersRaw);

                subGroupResult.Add(new { sg.id, sg.subGroupName, sg.sortOrder, sg.isActive, members = sgMembers });
            }

            groupResult.Add(new { g.id, g.groupName, g.sortOrder, g.isActive, members = groupMembers, subGroups = subGroupResult });
        }

        // Enriches ONE raw member-bearing row into a full dict (all member_master_profile.*
        // columns + residentialAddress/businessAddress/classification/spouse*/mobileCountry*/profilePhoto).
        IDictionary<string, object?> EnrichOne(dynamic row) =>
            (IDictionary<string, object?>)WithAddresses(new List<dynamic> { row })[0];

        // ── AG per-club map (year-scoped, then fall back to any active AG for that club) ──
        // district_ag.UNIQUE (fk_club_id, fk_year_id) → one AG per club per year.
        // m.* → ALL member_master_profile columns (a–z); summary aliases (agName/agMobile/…)
        // kept for backward compatibility. Full personal details available on each object.
        var agRows = (await conn.QueryAsync<dynamic>(@"
            SELECT ag.fk_club_id                  AS clubId,
                   ag.fk_year_id                  AS yearId,
                   ag.fk_member_id                AS memberId,
                   m.MemberName                   AS agName,
                   m.PrimaryMobileNumber          AS agMobile,
                   m.EmailId                      AS agEmail,
                   m.ProfilePhotoPath             AS agPhoto,
                   cty.PhoneCode                  AS agMobileCountryCode,
                   m.*
            FROM district_ag ag
            JOIN member_master_profile m ON m.pk_member_master_profile_id = ag.fk_member_id AND m.isdeleted = 0
            LEFT JOIN country_master cty ON cty.pk_country_id = m.fk_primary_country_id
            WHERE ag.fk_district_id = @DistrictId
              AND ag.is_active = 1
              AND ag.isdeleted = 0",
            new { DistrictId = districtId })).ToList();

        // Prefer AG row matching requested year; else fallback to the most recent active row.
        var agByClub = new Dictionary<int, object>();
        foreach (var grp in agRows.GroupBy(r => (int)r.clubId))
        {
            var pick = grp.FirstOrDefault(r => r.yearId != null && (int)r.yearId == yearId)
                    ?? grp.OrderByDescending(r => r.yearId).First();
            var agDict = EnrichOne(pick);
            agDict["agMemberId"] = Convert.ToInt32(pick.memberId);
            agDict["agYearId"]   = pick.yearId == null ? (int?)null : Convert.ToInt32(pick.yearId);
            agByClub[grp.Key] = agDict;
        }

        // ── 3. Clubs with BOD + Members (each enriched with residentialAddress) ──
        var clubs = (await conn.QueryAsync<dynamic>(@"
            SELECT c.* FROM club_master c
            WHERE c.fk_district_id = @DistrictId AND c.isdeleted = 0
            ORDER BY c.ClubName",
            new { DistrictId = districtId })).ToList();

        var clubResult = new List<object>();
        foreach (var club in clubs)
        {
            int clubId = (int)club.pk_club_id;

            // BOD for this club, with auto-fallback: if no rows exist for the requested
            // year (e.g. 2026-27 hasn't been entered yet), use the LATEST year ≤
            // requested that does have data. The inner subquery picks the effective year
            // per club, so each club independently chooses its best-available year.
            var bodRaw = (await conn.QueryAsync<dynamic>(@"
                SELECT b.pk_board_director_id AS id, b.fk_designation_id AS designationId,
                       b.fk_year_id AS effectiveYearId,
                       d.designation_name AS designationName, d.sort_order AS designationSortOrder,
                       m.*
                FROM board_of_directors b
                JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id AND m.isdeleted = 0
                LEFT JOIN designation_master d ON d.pk_designation_id = b.fk_designation_id
                WHERE b.fk_club_id = @ClubId AND b.isdeleted = 0
                  AND b.fk_year_id = (
                      SELECT MAX(bb.fk_year_id) FROM board_of_directors bb
                      WHERE bb.fk_club_id = @ClubId
                        AND bb.fk_year_id <= @YearId
                        AND bb.isdeleted = 0
                  )
                ORDER BY d.sort_order, d.designation_name",
                new { ClubId = clubId, YearId = yearId })).ToList();
            var bod = WithAddresses(bodRaw);

            // Pull the actually-used year off the first BOD row (NULL if no data exists
            // for this club in any year ≤ requested).
            int? bodEffectiveYearId = null;
            if (bodRaw.Count > 0)
            {
                var first = (IDictionary<string, object?>)bodRaw[0];
                if (first.TryGetValue("effectiveYearId", out var eyId) && eyId != null)
                    bodEffectiveYearId = Convert.ToInt32(eyId);
            }
            string? bodEffectiveYearLabel = bodEffectiveYearId.HasValue && yearLabelLookup.TryGetValue(bodEffectiveYearId.Value, out var lbl)
                ? lbl
                : null;
            bool bodIsFallback = bodEffectiveYearId.HasValue && bodEffectiveYearId.Value != yearId;

            // All active members for this club — m.* gives AnniversaryDate, BirthDate, etc.
            var membersRaw = await conn.QueryAsync<dynamic>(@"
                SELECT cm.pk_club_member_id AS clubMemberId, " + CogDesignationHelper.JoinedDateExpr("cm") + @" AS joinedDate,
                   " + CogDesignationHelper.SelectColumns("cm") + @",
                       cm.IsActive AS membershipActive, cm.TerminationDate, cm.TerminationReason,
                       m.*
                FROM club_members cm
                JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
                WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0
                ORDER BY m.MemberName",
                new { ClubId = clubId });
            var members = WithAddresses(membersRaw);

            // Attach AG per club (from district_ag).
            var agInfo         = agByClub.TryGetValue(clubId, out var ag)  ? ag  : null;

            clubResult.Add(new
            {
                club,
                assistantGovernor = agInfo,
                boardOfDirectors = bod,
                boardOfDirectorsYearId    = bodEffectiveYearId,
                boardOfDirectorsYearLabel = bodEffectiveYearLabel,
                boardOfDirectorsIsFallback = bodIsFallback,
                members
            });
        }

        // ── District-level roster: AGs and their assigned clubs ──
        // "AG have which clubs" — group agRows (preferring current-year rows) per AG,
        // then list the clubs assigned to each. Uses clubs already loaded above for names.
        var clubNameById = clubs.ToDictionary(
            c => (int)c.pk_club_id,
            c => (string)c.ClubName);

        // Each roster entry carries the AG's full member_master_profile.* details (via EnrichOne)
        // plus the list of clubs assigned to that AG.
        var agGrouped = agRows
            .GroupBy(r => Convert.ToInt32(r.memberId))
            .Select(grp =>
            {
                var head = grp.First();
                var assignedClubs = grp.Select(r =>
                {
                    int cid = Convert.ToInt32(r.clubId);
                    return new
                    {
                        clubId    = cid,
                        clubName  = clubNameById.TryGetValue(cid, out var n) ? n : null,
                        yearId    = r.yearId == null ? (int?)null : Convert.ToInt32(r.yearId)
                    };
                }).ToList();
                var dict = EnrichOne(head);
                dict["agMemberId"] = Convert.ToInt32(head.memberId);
                dict["clubCount"]  = assignedClubs.Count;
                dict["clubs"]      = assignedClubs;
                return dict;
            })
            .OrderBy(a => (string?)a["agName"])
            .ToList();

        return Ok(new
        {
            district,
            rotaryYear = rotaryYearInfo,
            districtCommittee,
            groups = groupResult,
            clubs = clubResult,
            assistantGovernors = agGrouped
        });
    }
}
