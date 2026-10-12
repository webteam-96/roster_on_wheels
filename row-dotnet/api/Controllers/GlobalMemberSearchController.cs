using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/admin/global-member-search")]
[Authorize]
public class GlobalMemberSearchController : ControllerBase
{
    private readonly string _connectionString;
    private readonly IClubService _clubService;

    public GlobalMemberSearchController(IConfiguration config, IClubService clubService)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        _clubService = clubService;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);
    private bool IsSuperAdmin() => User.FindFirst("roles")?.Value?.Contains("SuperAdmin") == true;
    private int GetUserId() => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    [HttpGet]
    public async Task<ActionResult> Search([FromQuery] string? search)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (string.IsNullOrWhiteSpace(search) || search.Trim().Length < 2)
            return Ok(Array.Empty<object>());

        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Search members — SELECT * for future-proof.
        // Two legs UNION-ed:
        //   A) members with an ACTIVE club membership (matched by profile fields OR club name).
        //   B) members holding an ACTIVE admin role (RIDirector / SuperAdmin / ZC / AG / ClubModerator /
        //      Admin) matched by profile fields — EVEN IF they have no active club membership. RI
        //      Directors especially are top-level and often have no club membership, so leg A alone
        //      would drop them (their RIDirector badge never showed). Plain members with no club and
        //      no role stay hidden (soft-delete behaviour preserved).
        var members = (await conn.QueryAsync<dynamic>(@"
            SELECT * FROM (
                SELECT m.*
                FROM member_master_profile m
                INNER JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.isdeleted = 0
                INNER JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
                WHERE m.isdeleted = 0
                  AND (
                      m.MemberName LIKE @Search
                      OR m.EmailId LIKE @Search
                      OR m.PrimaryMobileNumber LIKE @Search
                      OR m.SecondaryMobileNumber LIKE @Search
                      OR m.RotaryId LIKE @Search
                      OR c.ClubName LIKE @Search
                  )
                UNION
                SELECT m.*
                FROM member_master_profile m
                INNER JOIN member_roles mr ON mr.fk_member_master_profile_id = m.pk_member_master_profile_id
                     AND mr.isdeleted = 0 AND mr.IsActive = 1
                INNER JOIN roles r ON r.pk_role_id = mr.fk_role_id
                     AND r.RoleName IN ('Admin','SuperAdmin','ZonalCoordinator','ClubModerator','AG','RIDirector')
                WHERE m.isdeleted = 0
                  AND (
                      m.MemberName LIKE @Search
                      OR m.EmailId LIKE @Search
                      OR m.PrimaryMobileNumber LIKE @Search
                      OR m.SecondaryMobileNumber LIKE @Search
                      OR m.RotaryId LIKE @Search
                  )
            ) u
            ORDER BY u.MemberName
            LIMIT 50",
            new { Search = $"%{search.Trim()}%" })).ToList();

        var result = new List<object>();

        foreach (var member in members)
        {
            int memberId = (int)member.pk_member_master_profile_id;

            // Club memberships
            var clubs = await conn.QueryAsync<dynamic>(@"
                SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId,
                       c.City AS city, c.State AS state,
                       d.pk_district_id AS districtId, d.DistrictNumber AS districtNumber,
                       z.pk_zone_id AS zoneId, z.ZoneName AS zoneName,
                       " + CogDesignationHelper.JoinedDateExpr("cm") + @" AS joinedDate, cm.IsActive AS isActive,
                   " + CogDesignationHelper.SelectColumns("cm") + @",
                       cm.TerminationDate AS terminationDate, cm.TerminationReason AS terminationReason
                FROM club_members cm
                JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
                JOIN district_master d ON d.pk_district_id = c.fk_district_id
                LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
                WHERE cm.fk_member_master_profile_id = @Id AND cm.isdeleted = 0
                ORDER BY cm.IsActive DESC, c.ClubName",
                new { Id = memberId });

            // Roles
            var roles = await conn.QueryAsync<dynamic>(@"
                SELECT r.RoleName AS roleName,
                       CASE
                           WHEN r.RoleName = 'Admin' AND mr.fk_district_id > 0 AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0) THEN 'District Admin'
                           WHEN r.RoleName = 'Admin' AND mr.fk_club_id > 0 THEN 'Club Admin'
                           ELSE r.RoleName
                       END AS displayRole,
                       mr.fk_club_id AS clubId, mr.fk_district_id AS districtId, mr.fk_zone_id AS zoneId,
                       mr.IsActive AS isActive
                FROM member_roles mr
                JOIN roles r ON r.pk_role_id = mr.fk_role_id
                WHERE mr.fk_member_master_profile_id = @Id AND mr.isdeleted = 0 AND mr.IsActive = 1",
                new { Id = memberId });

            // BOD designations (all years)
            var designations = await conn.QueryAsync<dynamic>(@"
                SELECT dm.designation_name AS designationName, c.ClubName AS clubName,
                       y.YearLabel AS yearLabel, y.IsCurrent AS isCurrent
                FROM board_of_directors b
                JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id
                JOIN club_master c ON c.pk_club_id = b.fk_club_id
                JOIN rotary_year_master y ON y.pk_year_id = b.fk_year_id
                WHERE b.fk_member_master_profile_id = @Id AND b.isdeleted = 0
                ORDER BY y.pk_year_id DESC, dm.sort_order",
                new { Id = memberId });

            // District Committee member entries
            var districtCommittee = await conn.QueryAsync<dynamic>(@"
                SELECT dcm.district_designation AS designation, dcm.district_remark AS remark,
                       d.DistrictNumber AS districtNumber, y.YearLabel AS yearLabel
                FROM district_committee_member dcm
                JOIN district_master d ON d.pk_district_id = dcm.fk_district_id
                JOIN rotary_year_master y ON y.pk_year_id = dcm.fk_year_id
                WHERE dcm.fk_member_id = @Id AND dcm.isdeleted = 0
                ORDER BY y.pk_year_id DESC",
                new { Id = memberId });

            // Group Committee member entries
            var groupCommittee = await conn.QueryAsync<dynamic>(@"
                SELECT gm.district_designation AS designation, gm.district_remark AS remark,
                       g.group_name AS groupName, d.DistrictNumber AS districtNumber, y.YearLabel AS yearLabel
                FROM district_committee_group_member gm
                JOIN district_committee_group g ON g.id = gm.fk_group_id
                JOIN district_master d ON d.pk_district_id = g.fk_district_id
                JOIN rotary_year_master y ON y.pk_year_id = g.fk_year_id
                WHERE gm.fk_member_id = @Id AND gm.isdeleted = 0
                ORDER BY y.pk_year_id DESC",
                new { Id = memberId });

            // Sub Group Committee member entries
            var subGroupCommittee = await conn.QueryAsync<dynamic>(@"
                SELECT sgm.district_designation AS designation, sgm.district_remark AS remark,
                       sg.sub_group_name AS subGroupName, g.group_name AS groupName,
                       d.DistrictNumber AS districtNumber, y.YearLabel AS yearLabel
                FROM district_committee_sub_group_member sgm
                JOIN district_committee_sub_group sg ON sg.id = sgm.fk_sub_group_id
                JOIN district_committee_group g ON g.id = sg.fk_group_id
                JOIN district_master d ON d.pk_district_id = g.fk_district_id
                JOIN rotary_year_master y ON y.pk_year_id = g.fk_year_id
                WHERE sgm.fk_member_id = @Id AND sgm.isdeleted = 0
                ORDER BY y.pk_year_id DESC",
                new { Id = memberId });

            // District Governor entries
            var districtGovernor = await conn.QueryAsync<dynamic>(@"
                SELECT d.DistrictNumber AS districtNumber, y.YearLabel AS yearLabel
                FROM district_governors dg
                JOIN district_master d ON d.pk_district_id = dg.fk_district_id
                JOIN rotary_year_master y ON y.pk_year_id = dg.fk_year_id
                WHERE dg.fk_member_id = @Id AND dg.isdeleted = 0
                ORDER BY y.pk_year_id DESC",
                new { Id = memberId });

            // Past Presidents
            var pastPresident = await conn.QueryAsync<dynamic>(@"
                SELECT c.ClubName AS clubName, y.YearLabel AS yearLabel
                FROM past_presidents pp
                JOIN club_master c ON c.pk_club_id = pp.fk_club_id
                JOIN rotary_year_master y ON y.pk_year_id = pp.fk_year_id
                WHERE pp.fk_member_master_profile_id = @Id AND pp.isdeleted = 0
                ORDER BY y.pk_year_id DESC",
                new { Id = memberId });

            // Assistant Governor assignments (one per club/year). member_roles carries the 'AG'
            // role flag; this table carries WHICH club + year the member is AG for.
            var assistantGovernor = await conn.QueryAsync<dynamic>(@"
                SELECT c.ClubName AS clubName, d.DistrictNumber AS districtNumber,
                       y.YearLabel AS yearLabel, y.IsCurrent AS isCurrent
                FROM district_ag ag
                JOIN club_master c ON c.pk_club_id = ag.fk_club_id
                JOIN district_master d ON d.pk_district_id = ag.fk_district_id
                LEFT JOIN rotary_year_master y ON y.pk_year_id = ag.fk_year_id
                WHERE ag.fk_member_id = @Id AND ag.isdeleted = 0
                ORDER BY y.pk_year_id DESC",
                new { Id = memberId });

            // Club Moderator assignments (which club the member moderates; no year dimension).
            var clubModerator = await conn.QueryAsync<dynamic>(@"
                SELECT c.ClubName AS clubName, d.DistrictNumber AS districtNumber, cmod.is_active AS isActive
                FROM district_club_moderator cmod
                JOIN club_master c ON c.pk_club_id = cmod.fk_club_id
                JOIN district_master d ON d.pk_district_id = cmod.fk_district_id
                WHERE cmod.fk_member_id = @Id AND cmod.isdeleted = 0
                ORDER BY c.ClubName",
                new { Id = memberId });

            // Club-level sub-groups / committees (includes CP/CS auto-groups) — year-wise.
            var clubSubGroups = await conn.QueryAsync<dynamic>(@"
                SELECT sg.GroupName AS groupName, c.ClubName AS clubName,
                       y.YearLabel AS yearLabel, y.IsCurrent AS isCurrent
                FROM sub_group_members sgm
                JOIN sub_groups sg ON sg.pk_sub_group_id = sgm.fk_sub_group_id AND sg.isdeleted = 0
                JOIN club_master c ON c.pk_club_id = sg.fk_club_id
                LEFT JOIN rotary_year_master y ON y.pk_year_id = sg.fk_year_id
                WHERE sgm.fk_member_master_profile_id = @Id AND sgm.isdeleted = 0
                ORDER BY y.pk_year_id DESC",
                new { Id = memberId });

            // ── Tier 2: transactional participation ──

            // Events the member registered/paid for (event payment links).
            var events = await conn.QueryAsync<dynamic>(@"
                SELECT el.Title AS eventTitle, epm.Amount AS amount, epm.IsPaid AS isPaid,
                       epm.PaymentDate AS paymentDate, epm.ClubName AS clubName,
                       epm.DistrictNumber AS districtNumber
                FROM event_payment_members epm
                JOIN event_payment_links el ON el.pk_id = epm.fk_payment_link_id
                WHERE epm.fk_member_profile_id = @Id AND epm.isdeleted = 0
                ORDER BY epm.created_date DESC",
                new { Id = memberId });

            // Membership dues instalments billed to / paid by the member.
            var membershipDues = await conn.QueryAsync<dynamic>(@"
                SELECT COALESCE(NULLIF(md.Purpose, ''), 'Membership Dues') AS purpose,
                       md.RotaryYear AS rotaryYear, c.ClubName AS clubName,
                       dp.FeeType AS feeType, dp.Amount AS amount, dp.IsPaid AS isPaid,
                       dp.PaymentStatus AS paymentStatus, dp.PaymentDate AS paymentDate
                FROM membership_dues_payments dp
                JOIN membership_dues md ON md.pk_membership_dues_id = dp.fk_membership_dues_id
                JOIN club_master c ON c.pk_club_id = md.fk_club_id
                WHERE dp.fk_member_profile_id = @Id AND dp.isdeleted = 0
                ORDER BY dp.created_date DESC",
                new { Id = memberId });

            // District Directory data-collection submissions by/for the member (no isdeleted column).
            var directorySubmissions = await conn.QueryAsync<dynamic>(@"
                SELECT d.DistrictNumber AS districtNumber, y.YearLabel AS yearLabel,
                       dsl.GroupType AS groupType, dsl.CompletedCount AS completedCount,
                       dsl.TotalCount AS totalCount, dsl.SubmittedAt AS submittedAt
                FROM district_directory_submission_log dsl
                JOIN district_directory_config cfg ON cfg.pk_id = dsl.fk_config_id
                JOIN district_master d ON d.pk_district_id = cfg.fk_district_id
                LEFT JOIN rotary_year_master y ON y.pk_year_id = cfg.fk_year_id
                WHERE dsl.fk_member_id = @Id
                ORDER BY dsl.SubmittedAt DESC",
                new { Id = memberId });

            result.Add(new
            {
                member,
                clubs,
                roles,
                designations,
                districtCommittee,
                groupCommittee,
                subGroupCommittee,
                districtGovernor,
                pastPresident,
                assistantGovernor,
                clubModerator,
                clubSubGroups,
                events,
                membershipDues,
                directorySubmissions
            });
        }

        return Ok(result);
    }

    // One member's contact card, by id — name, photo, contacts and the clubs (with their district and
    // zone) they belong to. Used where a screen shows a member's NAME and wants to open their details
    // on click: the search action above only matches on a string, so it cannot answer "who is id 123".
    // SuperAdmin only, like the rest of this controller, so contacts are returned unmasked.
    [HttpGet("{memberId:int}/card")]
    public async Task<ActionResult> GetCard(int memberId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var member = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS memberName,
                   m.RotaryId AS rotaryId, m.EmailId AS email,
                   m.PrimaryMobileNumber AS mobile, pc.PhoneCode AS mobileCode,
                   m.SecondaryMobileNumber AS secondaryMobile,
                   CASE
                       WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                       WHEN m.ProfilePhotoPath LIKE 'http%' THEN m.ProfilePhotoPath
                       WHEN m.ProfilePhotoPath LIKE '/Documents/%' THEN m.ProfilePhotoPath
                       ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                   END AS profilePhoto
            FROM member_master_profile m
            LEFT JOIN country_master pc ON pc.pk_country_id = m.fk_primary_country_id
            WHERE m.pk_member_master_profile_id = @Id AND COALESCE(m.isdeleted, 0) = 0",
            new { Id = memberId });

        if (member == null) return NotFound(new { message = "Member not found." });

        // Active memberships first; a terminated one still says where they were.
        var clubs = await conn.QueryAsync<dynamic>(@"
            SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId,
                   c.City AS city, c.State AS state,
                   d.pk_district_id AS districtId, d.DistrictNumber AS districtNumber,
                   z.ZoneName AS zoneName, cm.IsActive AS isActive
            FROM club_members cm
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE cm.fk_member_master_profile_id = @Id AND cm.isdeleted = 0
            ORDER BY cm.IsActive DESC, c.ClubName",
            new { Id = memberId });

        return Ok(new { member, clubs });
    }

    // Delete a member globally, using the SAME removal logic as the Club Dashboard / rotary-org
    // delete (ClubService.RemoveMemberAsync) applied to EVERY club the member is active in. Result:
    // all club-scoped rows soft-deleted, and on the LAST club the primary mobile is freed
    // (Primary -> Secondary) + address & family soft-deleted. The profile row itself is KEPT
    // (never soft-deleted — Family Login + re-sync survive). Because the search INNER-JOINs active
    // club_members, a member with no active clubs no longer appears here, so removing every club
    // membership effectively "deletes" them from this screen without touching the profile.
    [HttpPost("{id:int}/soft-delete")]
    public async Task<ActionResult> SoftDelete(int id)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var exists = await conn.ExecuteScalarAsync<int?>(
            "SELECT pk_member_master_profile_id FROM member_master_profile WHERE pk_member_master_profile_id = @Id AND isdeleted = 0",
            new { Id = id });
        if (exists == null) return NotFound(new { message = "Member not found or already deleted." });

        // Every club this member is still active in.
        var clubIds = (await conn.QueryAsync<int>(
            "SELECT DISTINCT fk_club_id FROM club_members WHERE fk_member_master_profile_id = @Id AND isdeleted = 0",
            new { Id = id })).ToList();

        if (clubIds.Count > 0)
        {
            // Remove from each club via the shared logic. Because each call recomputes "last club"
            // from the remaining active memberships, the FINAL removal frees the mobile + soft-deletes
            // address/family. Profile is kept throughout.
            foreach (var clubId in clubIds)
                await _clubService.RemoveMemberAsync(clubId, id, GetUserId());
        }
        else
        {
            // Orphaned member (no active club): apply the same person-scoped cleanup directly so the
            // number is freed and stale personal data is soft-deleted. Profile is still kept.
            var by = GetUserId();
            await conn.ExecuteAsync(@"
                UPDATE member_master_profile
                SET SecondaryMobileNumber = CASE WHEN SecondaryMobileNumber IS NULL OR SecondaryMobileNumber = ''
                                                 THEN PrimaryMobileNumber ELSE SecondaryMobileNumber END,
                    PrimaryMobileNumber = NULL,
                    modified_by = @By, modified_date = NOW()
                WHERE pk_member_master_profile_id = @Id AND PrimaryMobileNumber IS NOT NULL",
                new { Id = id, By = by });
            await conn.ExecuteAsync(
                "UPDATE member_address_details SET isdeleted = 1, modified_date = NOW() WHERE fk_member_master_profile_id = @Id AND isdeleted = 0",
                new { Id = id });
            await conn.ExecuteAsync(
                "UPDATE member_family_details SET isdeleted = 1, modified_date = NOW() WHERE fk_member_master_profile_id = @Id AND isdeleted = 0",
                new { Id = id });
        }

        return Ok(new { message = "Member removed. Mobile freed, address/family soft-deleted; profile kept." });
    }

    public class UpdateContactRequest
    {
        public string? PrimaryMobileNumber { get; set; }
        public string? SecondaryMobileNumber { get; set; }
        public string? EmailId { get; set; }
    }

    // Edit ONLY the mobile numbers + email of a member (Global Member Search inline edit).
    [HttpPut("{id:int}/contact")]
    public async Task<ActionResult> UpdateContact(int id, [FromBody] UpdateContactRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var exists = await conn.ExecuteScalarAsync<int?>(
            "SELECT pk_member_master_profile_id FROM member_master_profile WHERE pk_member_master_profile_id = @Id AND isdeleted = 0",
            new { Id = id });
        if (exists == null) return NotFound(new { message = "Member not found." });

        var primary = string.IsNullOrWhiteSpace(req.PrimaryMobileNumber) ? null : req.PrimaryMobileNumber.Trim();
        var secondary = string.IsNullOrWhiteSpace(req.SecondaryMobileNumber) ? null : req.SecondaryMobileNumber.Trim();
        var email = string.IsNullOrWhiteSpace(req.EmailId) ? null : req.EmailId.Trim();
        var by = GetUserId();

        // Email is UNIQUE with no alternate slot to move it to — a clash with another ACTIVE member
        // is a hard stop (we can't silently steal someone's login email).
        if (email != null)
        {
            var emailClash = await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM member_master_profile WHERE EmailId = @E AND isdeleted = 0 AND pk_member_master_profile_id <> @Id",
                new { E = email, Id = id });
            if (emailClash > 0)
                return Conflict(new { message = "This email is already used by another active member." });
        }

        using var tx = await conn.BeginTransactionAsync();
        try
        {
            // Whoever else currently holds this primary number — ACTIVE or soft-deleted — gives it up:
            // move THEIR Primary -> Secondary (only when their secondary is empty, so nothing is lost)
            // and null their Primary. This is the deliberate SuperAdmin consolidation: the number is
            // reassigned to THIS member; the old holder keeps it as their secondary.
            if (primary != null)
            {
                await conn.ExecuteAsync(@"
                    UPDATE member_master_profile
                    SET SecondaryMobileNumber = CASE WHEN SecondaryMobileNumber IS NULL OR SecondaryMobileNumber = ''
                                                     THEN PrimaryMobileNumber ELSE SecondaryMobileNumber END,
                        PrimaryMobileNumber = NULL,
                        modified_by = @By, modified_date = NOW()
                    WHERE PrimaryMobileNumber = @M AND pk_member_master_profile_id <> @Id",
                    new { M = primary, Id = id, By = by }, tx);
            }

            await conn.ExecuteAsync(@"
                UPDATE member_master_profile
                SET PrimaryMobileNumber   = @Primary,
                    SecondaryMobileNumber = @Secondary,
                    EmailId               = @Email,
                    modified_by = @By, modified_date = NOW()
                WHERE pk_member_master_profile_id = @Id",
                new { Id = id, Primary = primary, Secondary = secondary, Email = email, By = by }, tx);

            await tx.CommitAsync();
        }
        catch
        {
            await tx.RollbackAsync();
            throw;
        }

        return Ok(new { message = "Contact details updated." });
    }
}
