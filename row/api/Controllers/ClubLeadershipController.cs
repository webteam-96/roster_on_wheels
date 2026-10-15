using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;
using System.Security.Claims;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/admin/club-leadership")]
[Authorize]
public class ClubLeadershipController : ControllerBase
{
    private readonly string _connectionString;
    private readonly IEmailService _emailService;
    private readonly IDcAutoGroupService _dcAutoGroups;
    private readonly IBodSubGroupAutoService _bodSubGroups;

    public ClubLeadershipController(IConfiguration config, IEmailService emailService, IDcAutoGroupService dcAutoGroups, IBodSubGroupAutoService bodSubGroups)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        _emailService = emailService;
        _dcAutoGroups = dcAutoGroups;
        _bodSubGroups = bodSubGroups;
    }

    private void FireBodSubGroupHook(int clubId, int designationId, int yearId)
    {
        _ = Task.Run(async () => { try { await _bodSubGroups.OnBodChangedAsync(clubId, designationId, yearId); } catch { } });
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    private bool IsSuperAdmin() => User.FindFirst("roles")?.Value?.Contains("SuperAdmin") == true;

    private int GetUserId()
    {
        var id = User.FindFirst("memberId")?.Value ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        return int.TryParse(id, out var x) ? x : 0;
    }

    // List all clubs in a district with their current President & Secretary for the selected year
    [HttpGet]
    public async Task<ActionResult> GetLeadership([FromQuery] int districtId, [FromQuery] int yearId)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (districtId <= 0 || yearId <= 0)
            return BadRequest(new { message = "districtId and yearId are required." });

        using var conn = CreateConnection();
        await conn.OpenAsync();

        const int ADMIN_ROLE_ID = 2;
        var rows = await conn.QueryAsync<dynamic>(@"
            SELECT c.pk_club_id AS clubId, c.ClubName AS clubName, c.ClubRotaryId AS clubRotaryId,
                   pres.memberId AS presidentMemberId, pres.memberName AS presidentName,
                   pres.mobile AS presidentMobile, pres.email AS presidentEmail,
                   CAST(CASE WHEN pres.memberId IS NOT NULL AND EXISTS (
                        SELECT 1 FROM member_roles mr
                        WHERE mr.fk_member_master_profile_id = pres.memberId
                          AND mr.fk_role_id = @AdminRoleId AND mr.fk_club_id = c.pk_club_id
                          AND mr.IsActive = 1 AND mr.isdeleted = 0
                   ) THEN 1 ELSE 0 END AS UNSIGNED) AS presidentIsAdmin,
                   sec.memberId AS secretaryMemberId, sec.memberName AS secretaryName,
                   sec.mobile AS secretaryMobile, sec.email AS secretaryEmail,
                   CAST(CASE WHEN sec.memberId IS NOT NULL AND EXISTS (
                        SELECT 1 FROM member_roles mr
                        WHERE mr.fk_member_master_profile_id = sec.memberId
                          AND mr.fk_role_id = @AdminRoleId AND mr.fk_club_id = c.pk_club_id
                          AND mr.IsActive = 1 AND mr.isdeleted = 0
                   ) THEN 1 ELSE 0 END AS UNSIGNED) AS secretaryIsAdmin,
                   -- Phase 4 kill-switch: chainActive=1 only when club + district + zone are all active.
                   CAST(CASE WHEN c.IsActive = 1 AND c.isdeleted = 0
                                  AND d.IsActive = 1 AND d.isdeleted = 0
                                  AND z.IsActive = 1 AND z.isdeleted = 0
                             THEN 1 ELSE 0 END AS UNSIGNED) AS chainActive
            FROM club_master c
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            LEFT JOIN (
                SELECT b.fk_club_id, m.pk_member_master_profile_id AS memberId, m.MemberName AS memberName,
                       m.PrimaryMobileNumber AS mobile, m.EmailId AS email
                FROM board_of_directors b
                JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id
                JOIN designation_master d ON d.pk_designation_id = b.fk_designation_id
                WHERE b.fk_year_id = @YearId AND b.isdeleted = 0 AND d.designation_name = 'Club President'
            ) pres ON pres.fk_club_id = c.pk_club_id
            LEFT JOIN (
                SELECT b.fk_club_id, m.pk_member_master_profile_id AS memberId, m.MemberName AS memberName,
                       m.PrimaryMobileNumber AS mobile, m.EmailId AS email
                FROM board_of_directors b
                JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id
                JOIN designation_master d ON d.pk_designation_id = b.fk_designation_id
                WHERE b.fk_year_id = @YearId AND b.isdeleted = 0 AND d.designation_name = 'Club Secretary'
            ) sec ON sec.fk_club_id = c.pk_club_id
            WHERE c.fk_district_id = @DistrictId AND c.isdeleted = 0
            ORDER BY c.ClubName",
            new { DistrictId = districtId, YearId = yearId, AdminRoleId = ADMIN_ROLE_ID });

        return Ok(rows);
    }

    // Members of a specific club only (for president/secretary picker)
    [HttpGet("club-members")]
    public async Task<ActionResult> GetClubMembers([FromQuery] int clubId)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (clubId <= 0) return BadRequest(new { message = "clubId is required." });

        using var conn = CreateConnection();
        await conn.OpenAsync();
        var members = await conn.QueryAsync<dynamic>(@"
            SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS memberName,
                   m.PrimaryMobileNumber AS mobile, m.EmailId AS email
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
            WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0
            ORDER BY m.MemberName",
            new { ClubId = clubId });
        return Ok(members);
    }

    public class UpsertRequest
    {
        public int ClubId { get; set; }
        public int YearId { get; set; }
        public int MemberId { get; set; }
        public string Role { get; set; } = ""; // "President" or "Secretary"
    }

    [HttpPost]
    public async Task<ActionResult> UpsertLeadership([FromBody] UpsertRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (req.ClubId <= 0 || req.YearId <= 0 || req.MemberId <= 0)
            return BadRequest(new { message = "clubId, yearId and memberId are required." });

        var designationName = req.Role?.Trim().ToLower() switch
        {
            "president" => "Club President",
            "secretary" => "Club Secretary",
            _ => null
        };
        if (designationName == null)
            return BadRequest(new { message = "Role must be 'President' or 'Secretary'." });

        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Verify member belongs to this club
        var isMember = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM club_members
            WHERE fk_club_id = @ClubId AND fk_member_master_profile_id = @MemberId
              AND IsActive = 1 AND isdeleted = 0",
            new { req.ClubId, req.MemberId });
        if (isMember == 0)
            return BadRequest(new { message = "Selected member is not an active member of this club." });

        var designationId = await conn.ExecuteScalarAsync<int?>(
            "SELECT pk_designation_id FROM designation_master WHERE designation_name = @Name",
            new { Name = designationName });
        if (designationId == null)
            return BadRequest(new { message = $"Designation '{designationName}' not found." });

        var userId = GetUserId();

        using var tx = await conn.BeginTransactionAsync();
        try
        {
            // Capture OLD member IDs being replaced (for Admin-role cleanup after handover)
            var replacedMemberIds = (await conn.QueryAsync<int>(@"
                SELECT fk_member_master_profile_id FROM board_of_directors
                WHERE fk_club_id = @ClubId AND fk_year_id = @YearId
                  AND fk_designation_id = @DesignationId AND isdeleted = 0
                  AND fk_member_master_profile_id <> @MemberId",
                new { req.ClubId, req.YearId, DesignationId = designationId, req.MemberId }, tx)).ToList();

            // Soft-delete any existing BOD row of this designation for this club+year (only one Pres/Sec per club per year)
            await conn.ExecuteAsync(@"
                UPDATE board_of_directors
                SET isdeleted = 1, deleted_by = @UserId, deleted_date = NOW()
                WHERE fk_club_id = @ClubId AND fk_year_id = @YearId
                  AND fk_designation_id = @DesignationId AND isdeleted = 0
                  AND fk_member_master_profile_id <> @MemberId",
                new { req.ClubId, req.YearId, DesignationId = designationId, req.MemberId, UserId = userId }, tx);

            // DC auto-group hook: remove the replaced members from the corresponding DC group
            foreach (var replacedId in replacedMemberIds)
            {
                await _dcAutoGroups.OnBodRemovedAsync(conn, tx, req.ClubId, replacedId, designationId.Value, req.YearId, userId);
            }

            // Upsert BOD row
            var existingBodId = await conn.ExecuteScalarAsync<int?>(@"
                SELECT pk_board_director_id FROM board_of_directors
                WHERE fk_club_id = @ClubId AND fk_year_id = @YearId
                  AND fk_designation_id = @DesignationId AND fk_member_master_profile_id = @MemberId",
                new { req.ClubId, req.YearId, DesignationId = designationId, req.MemberId }, tx);
            if (existingBodId == null)
            {
                await conn.ExecuteAsync(@"
                    INSERT INTO board_of_directors (fk_club_id, fk_member_master_profile_id, fk_designation_id, fk_year_id, SyncSource, isdeleted, created_by)
                    VALUES (@ClubId, @MemberId, @DesignationId, @YearId, 'Manual', 0, @UserId)",
                    new { req.ClubId, req.MemberId, DesignationId = designationId, req.YearId, UserId = userId }, tx);
            }
            else
            {
                await conn.ExecuteAsync(@"
                    UPDATE board_of_directors SET isdeleted = 0, deleted_by = NULL, deleted_date = NULL,
                           SyncSource = 'Manual',
                           modified_by = @UserId, modified_date = NOW()
                    WHERE pk_board_director_id = @Id",
                    new { Id = existingBodId, UserId = userId }, tx);
            }

            // DC auto-group hook: add the new Pres/Sec to the district group
            await _dcAutoGroups.OnBodAddedOrUpdatedAsync(conn, tx, req.ClubId, req.MemberId, designationId.Value, req.YearId, userId);

            // BOD sub-group sync (fire-and-forget) — replaced members + new member
            foreach (var rid in replacedMemberIds) FireBodSubGroupHook(req.ClubId, designationId.Value, req.YearId);
            FireBodSubGroupHook(req.ClubId, designationId.Value, req.YearId);

            // Ensure Club Admin role (role_id=2) for this member+club — self-healing (reactivate/
            // undelete any existing rows, or insert one) so soft-deleted/inactive/duplicate rows
            // can't leave the member without a usable (IsActive=1, isdeleted=0) admin row.
            const int ADMIN_ROLE_ID = 2;
            await ClubAdminAccessHelper.EnsureActiveClubAdminRoleAsync(conn, req.MemberId, req.ClubId, userId, tx);

            // Ensure credentials exist
            var credExists = await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM member_credentials WHERE fk_member_master_profile_id = @Id AND IsActive = 1 AND isdeleted = 0",
                new { Id = req.MemberId }, tx);
            if (credExists == 0)
            {
                var prefix = designationName == "Club President" ? "Pres@" : "Sec@";
                var tempPassword = prefix + new Random().Next(1000, 9999);
                var hash = BCrypt.Net.BCrypt.HashPassword(tempPassword);
                var updated = await conn.ExecuteAsync(
                    "UPDATE member_credentials SET IsActive = 1, isdeleted = 0, PasswordHash = @Hash, IsTemporaryPassword = 1 WHERE fk_member_master_profile_id = @Id",
                    new { Id = req.MemberId, Hash = hash }, tx);
                if (updated == 0)
                    await conn.ExecuteAsync(
                        "INSERT INTO member_credentials (fk_member_master_profile_id, PasswordHash, IsTemporaryPassword) VALUES (@Id, @Hash, 1)",
                        new { Id = req.MemberId, Hash = hash }, tx);
            }

            // Revoke Club Admin role from replaced old members IF they hold no other Pres/Sec role in THIS club+year
            foreach (var oldMemberId in replacedMemberIds)
            {
                var stillHasBodRole = await conn.ExecuteScalarAsync<int>(@"
                    SELECT COUNT(*) FROM board_of_directors bd
                    JOIN designation_master d ON d.pk_designation_id = bd.fk_designation_id
                    WHERE bd.fk_club_id = @ClubId AND bd.fk_year_id = @YearId
                      AND bd.fk_member_master_profile_id = @OldId AND bd.isdeleted = 0
                      AND d.designation_name IN ('Club President', 'Club Secretary')",
                    new { req.ClubId, req.YearId, OldId = oldMemberId }, tx);
                if (stillHasBodRole == 0)
                {
                    // Soft-delete Admin role row for THIS club only (keeps Member role for mobile access; keeps credentials)
                    await conn.ExecuteAsync(@"
                        UPDATE member_roles
                        SET IsActive = 0, isdeleted = 1, RevokedDate = NOW(), RevokedBy = @UserId,
                            modified_by = @UserId, modified_date = NOW()
                        WHERE fk_member_master_profile_id = @OldId AND fk_role_id = @AdminRoleId
                          AND fk_club_id = @ClubId AND isdeleted = 0",
                        new { OldId = oldMemberId, AdminRoleId = ADMIN_ROLE_ID, req.ClubId, UserId = userId }, tx);
                }
            }

            await tx.CommitAsync();
            return Ok(new { success = true, message = $"{designationName} saved.", replacedMembers = replacedMemberIds.Count });
        }
        catch (Exception ex)
        {
            await tx.RollbackAsync();
            return BadRequest(new { message = $"Failed: {ex.Message}" });
        }
    }

    public class ScheduleEmailRequest
    {
        public int DistrictId { get; set; }
        public int YearId { get; set; }
        public DateTime ScheduleDateTime { get; set; }
    }

    [HttpPost("schedule-email")]
    public async Task<ActionResult> ScheduleEmail([FromBody] ScheduleEmailRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (req.DistrictId <= 0 || req.YearId <= 0)
            return BadRequest(new { message = "districtId and yearId are required." });
        if (req.ScheduleDateTime <= DateTime.Now.AddMinutes(-1))
            return BadRequest(new { message = "Schedule date/time must be in the future." });

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var recipients = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM board_of_directors b
            JOIN club_master c ON c.pk_club_id = b.fk_club_id
            JOIN designation_master d ON d.pk_designation_id = b.fk_designation_id
            JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id
            WHERE c.fk_district_id = @D AND b.fk_year_id = @Y AND b.isdeleted = 0
              AND d.designation_name IN ('Club President', 'Club Secretary')
              AND m.EmailId IS NOT NULL AND m.EmailId <> ''",
            new { D = req.DistrictId, Y = req.YearId });
        if (recipients == 0)
            return BadRequest(new { message = "No Presidents or Secretaries with email found for this district/year." });

        var id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO club_leadership_email_schedule
                (fk_district_id, fk_year_id, ScheduleDateTime, Status, TotalRecipients, created_by)
            VALUES (@D, @Y, @Dt, 'Pending', @Total, @Uid);
            SELECT LAST_INSERT_ID();",
            new { D = req.DistrictId, Y = req.YearId, Dt = req.ScheduleDateTime, Total = recipients, Uid = GetUserId() });

        return Ok(new { success = true, scheduleId = id, totalRecipients = recipients });
    }

    public class MakeAdminRequest
    {
        public int ClubId { get; set; }
        public int YearId { get; set; }
        public int DistrictId { get; set; }
        public int MemberId { get; set; }
        public string Role { get; set; } = ""; // "President" or "Secretary"
    }

    [HttpPost("make-admin")]
    public async Task<ActionResult> MakeAdmin([FromBody] MakeAdminRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (req.ClubId <= 0 || req.YearId <= 0 || req.DistrictId <= 0 || req.MemberId <= 0)
            return BadRequest(new { message = "clubId, yearId, districtId and memberId are required." });

        var designationName = req.Role?.Trim().ToLower() switch
        {
            "president" => "Club President",
            "secretary" => "Club Secretary",
            _ => null
        };
        if (designationName == null)
            return BadRequest(new { message = "Role must be 'President' or 'Secretary'." });

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var member = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT m.pk_member_master_profile_id AS memberId, m.MemberName AS memberName,
                   m.PrimaryMobileNumber AS mobile, m.EmailId AS email
            FROM member_master_profile m
            WHERE m.pk_member_master_profile_id = @Id AND m.isdeleted = 0",
            new { Id = req.MemberId });
        if (member == null) return BadRequest(new { message = "Member not found." });
        if (string.IsNullOrWhiteSpace((string?)member.email))
            return BadRequest(new { message = "Member does not have an email address. Cannot send admin email." });

        // 2026-09-25: no role block — a SuperAdmin, RI Director or Zonal Coordinator can also be
        // made Club Admin; they switch between their dashboards from the sidebar switcher.

        var clubName = await conn.ExecuteScalarAsync<string>(
            "SELECT ClubName FROM club_master WHERE pk_club_id = @Id", new { Id = req.ClubId });
        var yearLabel = await conn.ExecuteScalarAsync<string>(
            "SELECT YearLabel FROM rotary_year_master WHERE pk_year_id = @Id", new { Id = req.YearId });

        var userId = GetUserId();

        // Ensure Admin role — self-healing (reactivate/undelete existing rows, or insert one) so
        // soft-deleted/inactive/duplicate rows can't leave the member without a usable admin row.
        await ClubAdminAccessHelper.EnsureActiveClubAdminRoleAsync(conn, req.MemberId, req.ClubId, userId);

        // Ensure credentials
        string? tempPassword = null;
        var credExists = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM member_credentials WHERE fk_member_master_profile_id = @Id AND IsActive = 1 AND isdeleted = 0",
            new { Id = req.MemberId });
        if (credExists == 0)
        {
            var prefix = designationName == "Club President" ? "Pres@" : "Sec@";
            tempPassword = prefix + new Random().Next(1000, 9999);
            var hash = BCrypt.Net.BCrypt.HashPassword(tempPassword);
            var updated = await conn.ExecuteAsync(
                "UPDATE member_credentials SET IsActive = 1, isdeleted = 0, PasswordHash = @Hash, IsTemporaryPassword = 1 WHERE fk_member_master_profile_id = @Id",
                new { Id = req.MemberId, Hash = hash });
            if (updated == 0)
                await conn.ExecuteAsync(
                    "INSERT INTO member_credentials (fk_member_master_profile_id, PasswordHash, IsTemporaryPassword) VALUES (@Id, @Hash, 1)",
                    new { Id = req.MemberId, Hash = hash });
        }

        // Create synthetic "instant" schedule row so the log links correctly
        var scheduleId = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO club_leadership_email_schedule
                (fk_district_id, fk_year_id, ScheduleDateTime, Status, TotalRecipients, SentCount, FailedCount, ProcessedDate, created_by)
            VALUES (@D, @Y, NOW(), 'Processing', 1, 0, 0, NOW(), @Uid);
            SELECT LAST_INSERT_ID();",
            new { D = req.DistrictId, Y = req.YearId, Uid = userId });

        var logId = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO club_leadership_email_log
                (fk_schedule_id, fk_district_id, fk_year_id, fk_club_id, fk_member_id, DesignationName, Email, Status)
            VALUES (@S, @D, @Y, @C, @M, @Des, @E, 'Processing');
            SELECT LAST_INSERT_ID();",
            new { S = scheduleId, D = req.DistrictId, Y = req.YearId, C = req.ClubId,
                  M = req.MemberId, Des = designationName, E = (string)member.email });

        try
        {
            var warning = await _emailService.SendClubAdminAssignmentEmailAsync(
                (string)member.email, (string)member.memberName, (string?)member.mobile,
                tempPassword, designationName, clubName ?? "", yearLabel ?? "");

            await conn.ExecuteAsync(
                "UPDATE club_leadership_email_log SET Status = 'Sent', SentDate = NOW(), ErrorMessage = @Warn WHERE pk_id = @Id",
                new { Id = logId, Warn = warning });
            await conn.ExecuteAsync(
                "UPDATE club_leadership_email_schedule SET Status = 'Completed', SentCount = 1 WHERE pk_id = @Id",
                new { Id = scheduleId });
            return Ok(new { success = true, message = $"Admin email sent to {member.memberName}." });
        }
        catch (Exception ex)
        {
            var errMsg = ex.Message.Length > 500 ? ex.Message[..500] : ex.Message;
            await conn.ExecuteAsync(
                "UPDATE club_leadership_email_log SET Status = 'Failed', ErrorMessage = @Err WHERE pk_id = @Id",
                new { Id = logId, Err = errMsg });
            await conn.ExecuteAsync(
                "UPDATE club_leadership_email_schedule SET Status = 'Failed', FailedCount = 1 WHERE pk_id = @Id",
                new { Id = scheduleId });
            return BadRequest(new { message = $"Email send failed: {ex.Message}" });
        }
    }

    [HttpDelete("schedule/{id}")]
    public async Task<ActionResult> DeleteSchedule(int id)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (id <= 0) return BadRequest(new { message = "Invalid id." });

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var status = await conn.ExecuteScalarAsync<string?>(
            "SELECT Status FROM club_leadership_email_schedule WHERE pk_id = @Id AND isdeleted = 0",
            new { Id = id });
        if (status == null) return NotFound(new { message = "Schedule not found." });
        if (!string.Equals(status, "Pending", StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { message = $"Cannot delete — schedule status is '{status}'. Only Pending schedules can be deleted." });

        await conn.ExecuteAsync(
            "UPDATE club_leadership_email_schedule SET isdeleted = 1 WHERE pk_id = @Id",
            new { Id = id });
        return Ok(new { success = true, message = "Schedule deleted." });
    }

    // Debug helper: inspect what roles a member has for a given club (SuperAdmin only)
    [HttpGet("debug/member-roles")]
    public async Task<ActionResult> DebugMemberRoles([FromQuery] int memberId, [FromQuery] int clubId)
    {
        if (!IsSuperAdmin()) return Forbid();

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var member = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT pk_member_master_profile_id AS id, MemberName AS name, EmailId AS email FROM member_master_profile WHERE pk_member_master_profile_id = @Id",
            new { Id = memberId });

        var allRoles = await conn.QueryAsync<dynamic>(@"
            SELECT mr.pk_member_role_id AS id, mr.fk_role_id AS roleId, r.RoleName AS roleName,
                   mr.fk_club_id AS clubId, c.ClubName AS clubName,
                   mr.IsActive AS isActive, mr.isdeleted AS isDeleted,
                   mr.AssignedDate AS assignedDate, mr.RevokedDate AS revokedDate
            FROM member_roles mr
            LEFT JOIN roles r ON r.pk_role_id = mr.fk_role_id
            LEFT JOIN club_master c ON c.pk_club_id = mr.fk_club_id
            WHERE mr.fk_member_master_profile_id = @Id
            ORDER BY mr.isdeleted, mr.fk_role_id",
            new { Id = memberId });

        var adminForThisClub = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pk_member_role_id AS id, IsActive AS isActive, isdeleted AS isDeleted
            FROM member_roles
            WHERE fk_member_master_profile_id = @Id AND fk_role_id = 2 AND fk_club_id = @ClubId",
            new { Id = memberId, ClubId = clubId });

        return Ok(new { member, allRoles, adminForThisClub });
    }

    [HttpGet("all-schedules")]
    public async Task<ActionResult> GetAllSchedules()
    {
        if (!IsSuperAdmin()) return Forbid();

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var schedules = await conn.QueryAsync<dynamic>(@"
            SELECT s.pk_id AS id, s.fk_district_id AS districtId, d.DistrictNumber AS districtNumber,
                   s.fk_year_id AS yearId, y.YearLabel AS yearLabel,
                   s.ScheduleDateTime AS scheduleDateTime, s.Status AS status,
                   s.TotalRecipients AS totalRecipients, s.SentCount AS sentCount,
                   s.FailedCount AS failedCount, s.ProcessedDate AS processedDate,
                   s.created_date AS createdDate
            FROM club_leadership_email_schedule s
            LEFT JOIN district_master d ON d.pk_district_id = s.fk_district_id
            LEFT JOIN rotary_year_master y ON y.pk_year_id = s.fk_year_id
            WHERE s.isdeleted = 0
            ORDER BY s.ScheduleDateTime DESC");
        return Ok(schedules);
    }

    [HttpGet("schedule-log")]
    public async Task<ActionResult> GetScheduleLog([FromQuery] int scheduleId)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (scheduleId <= 0) return BadRequest(new { message = "scheduleId is required." });

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var logs = await conn.QueryAsync<dynamic>(@"
            SELECT c.ClubName AS clubName, m.MemberName AS memberName,
                   l.DesignationName AS designation, l.Email AS email,
                   l.Status AS status, l.SentDate AS sentDate, l.ErrorMessage AS errorMessage
            FROM club_leadership_email_log l
            JOIN club_master c ON c.pk_club_id = l.fk_club_id
            JOIN member_master_profile m ON m.pk_member_master_profile_id = l.fk_member_id
            WHERE l.fk_schedule_id = @Id
            ORDER BY c.ClubName, l.DesignationName",
            new { Id = scheduleId });
        return Ok(logs);
    }

    [HttpGet("email-status")]
    public async Task<ActionResult> GetEmailStatus([FromQuery] int districtId, [FromQuery] int yearId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var schedules = (await conn.QueryAsync<dynamic>(@"
            SELECT pk_id AS id, ScheduleDateTime AS scheduleDateTime, Status AS status,
                   TotalRecipients AS totalRecipients, SentCount AS sentCount,
                   FailedCount AS failedCount, ProcessedDate AS processedDate, created_date AS createdDate
            FROM club_leadership_email_schedule
            WHERE fk_district_id = @D AND fk_year_id = @Y AND isdeleted = 0
            ORDER BY ScheduleDateTime DESC",
            new { D = districtId, Y = yearId })).ToList();

        var logs = (await conn.QueryAsync<dynamic>(@"
            SELECT l.fk_schedule_id AS scheduleId, c.ClubName AS clubName,
                   m.MemberName AS memberName, l.DesignationName AS designation,
                   l.Email AS email, l.Status AS status, l.SentDate AS sentDate,
                   l.ErrorMessage AS errorMessage
            FROM club_leadership_email_log l
            JOIN club_master c ON c.pk_club_id = l.fk_club_id
            JOIN member_master_profile m ON m.pk_member_master_profile_id = l.fk_member_id
            WHERE l.fk_district_id = @D AND l.fk_year_id = @Y
            ORDER BY l.created_date DESC",
            new { D = districtId, Y = yearId })).ToList();

        return Ok(new { schedules, logs });
    }
}
