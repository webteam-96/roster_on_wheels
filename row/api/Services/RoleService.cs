using System.Data;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class RoleService : IRoleService
{
    private readonly string _connectionString;
    private readonly IEmailService _emailService;
    private readonly IConfiguration _configuration;
    private readonly ILogger<RoleService> _logger;

    public RoleService(IConfiguration configuration, IEmailService emailService, ILogger<RoleService> logger)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _emailService = emailService;
        _configuration = configuration;
        _logger = logger;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    public async Task AssignDefaultMemberRoleAsync(int memberId, MySqlConnection connection, MySqlTransaction transaction)
    {
        // Inline SQL replaces sp_role_assign_default. The SP MAY exist on the production DB without
        // the NOT EXISTS guard (older privileged-user version that we cannot drop/replace), and
        // calling it directly can produce duplicate active Member rows ("Member, Member" in search).
        // This version always guards with NOT EXISTS regardless of which SP version is in the DB.
        await connection.ExecuteAsync(@"
            INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, AssignedBy, IsActive, isdeleted, AssignedDate)
            SELECT @MemberId, 1, @MemberId, 1, 0, NOW() FROM DUAL
            WHERE NOT EXISTS (
                SELECT 1 FROM member_roles
                WHERE fk_member_master_profile_id = @MemberId
                  AND fk_role_id = 1
                  AND IsActive = 1
                  AND isdeleted = 0
            )",
            new { MemberId = memberId }, transaction);
    }

    public async Task<object> AssignAdminRoleAsync(AssignRoleRequestDto request, int assignedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        if (request.ClubId == null || request.ClubId == 0)
            throw new ArgumentException("ClubId is required to assign Admin role.");

        // Verify member exists
        var memberExists = await connection.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM member_master_profile WHERE pk_member_master_profile_id = @MemberId AND isdeleted = 0",
            new { MemberId = request.MemberId });

        if (memberExists == 0)
            throw new KeyNotFoundException("Member not found.");

        // Mutual exclusion: Admin (role 2) cannot coexist with SA
        await CheckRoleConflictAsync(connection, request.MemberId, 2);

        // Check not already active Admin in this club
        var alreadyAdmin = await connection.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM member_roles WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 2 AND fk_club_id = @ClubId AND IsActive = 1 AND isdeleted = 0",
            new { MemberId = request.MemberId, ClubId = request.ClubId });

        if (alreadyAdmin > 0)
            throw new InvalidOperationException("Member already has an active Admin role in this club.");

        // Self-healing grant: reactivate/undelete any existing admin rows for this club (or insert one
        // if none). The old INSERT-only path ignored soft-deleted / IsActive=0 rows and piled on
        // duplicates, leaving members with no usable (IsActive=1, isdeleted=0) row → "not an active
        // admin for this club". See ClubAdminAccessHelper.EnsureActiveClubAdminRoleAsync.
        await ClubAdminAccessHelper.EnsureActiveClubAdminRoleAsync(connection, request.MemberId, request.ClubId.Value, assignedBy);

        // Get member details
        var member = await connection.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT EmailId, MemberName, PrimaryMobileNumber FROM member_master_profile WHERE pk_member_master_profile_id = @MemberId AND isdeleted = 0",
            new { MemberId = request.MemberId });

        // Check credentials state — read isdeleted too. A SOFT-DELETED row (e.g. a disabled CP/CS
        // credential) still occupies the UNIQUE fk_member_master_profile_id, so an INSERT would throw
        // "Duplicate entry ... for key member_credentials.fk_member_master_profile_id". Undelete + reset instead.
        var credState = await connection.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT IsActive, isdeleted FROM member_credentials WHERE fk_member_master_profile_id = @MemberId",
            new { MemberId = request.MemberId });

        string? tempPassword = null;
        if (credState == null)
        {
            tempPassword = GenerateTempPassword();
            var passwordHash = BCrypt.Net.BCrypt.HashPassword(tempPassword);
            await connection.ExecuteAsync(@"
                INSERT INTO member_credentials (fk_member_master_profile_id, PasswordHash, IsTemporaryPassword, IsActive, created_by)
                VALUES (@MemberId, @Hash, 1, 1, @CreatedBy)",
                new { MemberId = request.MemberId, Hash = passwordHash, CreatedBy = assignedBy });
        }
        else if (Convert.ToInt32(credState.isdeleted) == 1)
        {
            // Soft-deleted credentials → undelete + reset with a fresh temp password (cannot INSERT: unique key).
            tempPassword = GenerateTempPassword();
            var passwordHash = BCrypt.Net.BCrypt.HashPassword(tempPassword);
            await connection.ExecuteAsync(@"
                UPDATE member_credentials
                SET PasswordHash = @Hash, IsTemporaryPassword = 1, IsActive = 1, isdeleted = 0,
                    modified_by = @ModifiedBy, modified_date = NOW()
                WHERE fk_member_master_profile_id = @MemberId",
                new { MemberId = request.MemberId, Hash = passwordHash, ModifiedBy = assignedBy });
        }
        else if (Convert.ToInt32(credState.IsActive) == 0)
        {
            // Reactivate without changing password — member can log in with their existing credentials.
            await connection.ExecuteAsync(@"
                UPDATE member_credentials
                SET IsActive = 1, modified_by = @ModifiedBy, modified_date = NOW()
                WHERE fk_member_master_profile_id = @MemberId AND isdeleted = 0",
                new { MemberId = request.MemberId, ModifiedBy = assignedBy });
        }

        // Role assignment is already committed at this point — everything the caller/UI cares
        // about (the actual admin grant) is done. Send the notification email fire-and-forget
        // on its OWN connection (matching SendClubRoleRemovedEmailAsync's pattern below) so a
        // slow roles-summary query or a slow mail API call can never turn a successful
        // assignment into a reported "Failed to assign admin role" timeout.
        if (member?.EmailId != null)
        {
            var emailToSend = (string)member.EmailId;
            var memberNameToSend = (string)member.MemberName;
            var mobileToSend = (string?)member.PrimaryMobileNumber;
            _ = Task.Run(async () =>
            {
                try
                {
                    await using var emailConn = CreateConnection();
                    await emailConn.OpenAsync();
                    var rolesHtml = await BuildAllRolesHtmlAsync(emailConn, request.MemberId);
                    await SendRoleAssignmentEmailAsync(emailToSend, memberNameToSend, mobileToSend, tempPassword, rolesHtml);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Role assignment email failed for member {MemberId}", request.MemberId);
                }
            });
        }

        return new { message = "Admin role assigned successfully." };
    }

    public async Task<object> RemoveAdminRoleAsync(RemoveRoleRequestDto request, int revokedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        if (request.ClubId == null || request.ClubId == 0)
            throw new ArgumentException("ClubId is required to remove Admin role.");

        // Deactivate admin role for this specific club
        var rowsAffected = await connection.ExecuteAsync(
            "sp_role_deactivate_admin",
            new { p_MemberId = request.MemberId, p_ClubId = request.ClubId, p_RevokedBy = revokedBy },
            commandType: CommandType.StoredProcedure);

        if (rowsAffected == 0)
            throw new InvalidOperationException("No active Admin role found for this member in this club.");

        // Only deactivate credentials if member has NO remaining admin roles anywhere
        var hasSuperAdmin = await connection.ExecuteScalarAsync<int>(
            "sp_role_check_has_superadmin",
            new { p_MemberId = request.MemberId },
            commandType: CommandType.StoredProcedure);

        var hasAnyAdmin = await connection.ExecuteScalarAsync<int>(
            "sp_role_check_has_any_admin",
            new { p_MemberId = request.MemberId },
            commandType: CommandType.StoredProcedure);

        if (hasSuperAdmin == 0 && hasAnyAdmin == 0)
        {
            await connection.ExecuteAsync(
                "sp_role_deactivate_credentials",
                new { p_MemberId = request.MemberId, p_ModifiedBy = revokedBy },
                commandType: CommandType.StoredProcedure);
        }

        // Fire removal email (fire-and-forget). CC club admin / president / secretary of the same club.
        _ = Task.Run(async () => await SendClubRoleRemovedEmailAsync(request.MemberId, request.ClubId.Value, "Club Admin"));

        return new { message = "Admin role removed successfully." };
    }

    // Shared helper for club-scoped role removal emails (Club Admin, potentially others).
    // CC list: other club admins + current-year president (desig 1) + secretary (desig 4).
    private async Task SendClubRoleRemovedEmailAsync(int memberId, int clubId, string roleLabel)
    {
        try
        {
            using var conn = CreateConnection();
            await conn.OpenAsync();
            var member = await conn.QueryFirstOrDefaultAsync<dynamic>(
                "SELECT MemberName, EmailId FROM member_master_profile WHERE pk_member_master_profile_id = @Id AND isdeleted = 0",
                new { Id = memberId });
            if (member == null || string.IsNullOrWhiteSpace((string?)member.EmailId)) return;

            var club = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
                SELECT c.ClubName AS clubName, d.DistrictNumber AS districtNumber, z.ZoneName AS zoneName
                FROM club_master c
                LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
                LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
                WHERE c.pk_club_id = @Id AND c.isdeleted = 0", new { Id = clubId });
            var clubName = (string?)club?.clubName ?? "the club";
            var districtNumber = (string?)club?.districtNumber;
            var zoneName = (string?)club?.zoneName;

            var ccRows = await conn.QueryAsync<string>(@"
                SELECT DISTINCT m.EmailId
                FROM member_master_profile m
                JOIN member_roles mr ON mr.fk_member_master_profile_id = m.pk_member_master_profile_id
                WHERE mr.fk_role_id = 2 AND mr.fk_club_id = @ClubId AND mr.IsActive = 1 AND (mr.isdeleted IS NULL OR mr.isdeleted = 0)
                  AND m.pk_member_master_profile_id <> @MemberId
                  AND m.EmailId IS NOT NULL AND m.EmailId <> ''
                UNION
                SELECT DISTINCT m.EmailId
                FROM board_of_directors bod
                JOIN rotary_year_master y ON y.pk_year_id = bod.fk_year_id AND y.IsCurrent = 1
                JOIN member_master_profile m ON m.pk_member_master_profile_id = bod.fk_member_master_profile_id
                WHERE bod.fk_club_id = @ClubId AND bod.fk_designation_id IN (1, 4) AND bod.isdeleted = 0
                  AND m.pk_member_master_profile_id <> @MemberId
                  AND m.EmailId IS NOT NULL AND m.EmailId <> ''",
                new { ClubId = clubId, MemberId = memberId });

            var parts = new List<string> { clubName };
            if (!string.IsNullOrWhiteSpace(districtNumber)) parts.Add($"District {districtNumber}");
            if (!string.IsNullOrWhiteSpace(zoneName)) parts.Add($"Zone {zoneName}");

            await _emailService.SendRoleOrMembershipRemovedEmailAsync(
                (string)member.EmailId,
                (string)member.MemberName,
                $"{roleLabel} role at {clubName}",
                string.Join(" — ", parts),
                ccRows.Distinct(StringComparer.OrdinalIgnoreCase).ToList());
        }
        catch (Exception ex) { _logger.LogError(ex, "Failed to send club role removed email for member {MemberId} club {ClubId}", memberId, clubId); }
    }

    public async Task<List<string>> GetMemberRolesAsync(int memberId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var roles = await connection.QueryAsync<string>(
            "sp_role_get_active_roles",
            new { p_MemberId = memberId },
            commandType: CommandType.StoredProcedure);
        return roles.ToList();
    }

    public async Task<PagedResult<MemberWithRolesDto>> GetAllMembersWithRolesAsync(int page, int pageSize, string? search)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var totalCount = await connection.ExecuteScalarAsync<int>(
            "sp_role_get_members_count",
            new { p_Search = string.IsNullOrWhiteSpace(search) ? null : search },
            commandType: CommandType.StoredProcedure);

        var offset = (page - 1) * pageSize;

        var rawItems = await connection.QueryAsync<dynamic>(
            "sp_role_get_members_paginated",
            new { p_Search = string.IsNullOrWhiteSpace(search) ? null : search, p_PageSize = pageSize, p_Offset = offset },
            commandType: CommandType.StoredProcedure);

        var items = rawItems.Select(row => new MemberWithRolesDto
        {
            Id = (int)row.Id,
            MemberName = row.MemberName ?? "",
            EmailId = row.EmailId ?? "",
            PrimaryMobileNumber = row.PrimaryMobileNumber ?? "",
            Roles = string.IsNullOrEmpty((string?)row.RoleNames)
                ? new List<string>()
                : ((string)row.RoleNames).Split(',').ToList(),
            HasAdminRole = ((long?)row.HasAdminRole ?? 0) == 1,
            HasCredentials = ((long?)row.HasCredentials ?? 0) == 1
        }).ToList();

        // Enrich with each member's active club(s) + district(s) — inline (the SP can't be altered;
        // see the SYSTEM_USER note). One indexed pass over club_members for just this page's ids so
        // pickers can tell same-named members apart.
        var ids = items.Select(i => i.Id).ToList();
        if (ids.Count > 0)
        {
            var clubRows = await connection.QueryAsync<dynamic>(@"
                SELECT cm.fk_member_master_profile_id AS MemberId,
                       GROUP_CONCAT(DISTINCT c.ClubName ORDER BY c.ClubName SEPARATOR ', ') AS ClubNames,
                       GROUP_CONCAT(DISTINCT d.DistrictNumber ORDER BY d.DistrictNumber SEPARATOR ', ') AS DistrictNumbers
                FROM club_members cm
                JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND COALESCE(c.isdeleted, 0) = 0
                LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id AND COALESCE(d.isdeleted, 0) = 0
                WHERE cm.fk_member_master_profile_id IN @Ids
                  AND cm.IsActive = 1 AND COALESCE(cm.isdeleted, 0) = 0
                GROUP BY cm.fk_member_master_profile_id",
                new { Ids = ids });

            var byMember = clubRows.ToDictionary(r => (int)r.MemberId, r => ((string?)r.ClubNames, (string?)r.DistrictNumbers));
            foreach (var it in items)
            {
                if (byMember.TryGetValue(it.Id, out var cd))
                {
                    it.ClubName = cd.Item1;
                    it.DistrictNumber = cd.Item2;
                }
            }
        }

        return new PagedResult<MemberWithRolesDto>
        {
            Items = items,
            TotalCount = totalCount,
            Page = page,
            PageSize = pageSize
        };
    }

    private async Task<string> BuildAllRolesHtmlAsync(MySqlConnection connection, int memberId)
    {
        // Get all active roles with details
        var roles = await connection.QueryAsync<dynamic>(@"
            SELECT r.fk_role_id AS RoleId,
                   CASE r.fk_role_id
                       WHEN 2 THEN 'Club Admin'
                       WHEN 3 THEN 'Super Admin'
                       WHEN 6 THEN 'AG'
                       ELSE 'Member'
                   END AS RoleName,
                   c.ClubName,
                   d.DistrictNumber
            FROM member_roles r
            LEFT JOIN club_master c ON r.fk_club_id = c.pk_club_id
            LEFT JOIN district_master d ON c.fk_district_id = d.pk_district_id
            WHERE r.fk_member_master_profile_id = @MemberId AND r.IsActive = 1
            ORDER BY r.fk_role_id", new { MemberId = memberId });

        var html = "<table style='border-collapse: collapse; width: 100%; margin: 12px 0;'>"
            + "<tr style='background-color: #17458F; color: white;'>"
            + "<th style='padding: 8px 12px; text-align: left; border: 1px solid #ddd;'>Role</th>"
            + "<th style='padding: 8px 12px; text-align: left; border: 1px solid #ddd;'>Details</th>"
            + "</tr>";

        foreach (var r in roles)
        {
            int roleId = (int)r.RoleId;
            string roleName = (string)r.RoleName;
            string details = "";

            if (roleId == 2) // Club Admin
            {
                var district = (string?)r.DistrictNumber ?? "";
                var club = (string?)r.ClubName ?? "";
                details = $"District {district} - {club}";
            }
            else if (roleId == 3) // SuperAdmin
            {
                details = "All Districts & Clubs";
            }
            else if (roleId == 6) // AG
            {
                var district = (string?)r.DistrictNumber ?? "";
                var club = (string?)r.ClubName ?? "";
                details = !string.IsNullOrEmpty(club) ? $"District {district} - {club}" : $"District {district}";
            }

            html += $"<tr><td style='padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;'>{roleName}</td>"
                  + $"<td style='padding: 8px 12px; border: 1px solid #ddd;'>{details}</td></tr>";
        }

        html += "</table>";
        return html;
    }

    private async Task SendRoleAssignmentEmailAsync(string email, string memberName, string? mobile, string? tempPassword, string rolesHtml)
    {
        var loginUrl = _configuration["FrontendUrl"]?.TrimEnd('/') + "/login";
        var subject = "Rotary Club - Your Role Assignment";

        var credentialsHtml = tempPassword != null
            ? $@"<div style='background-color: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0;'>
                    <p><strong>Login URL:</strong> <a href='{loginUrl}' style='color: #3182ce;'>{loginUrl}</a></p>
                    {(!string.IsNullOrWhiteSpace(mobile) ? $"<p><strong>Username (Mobile):</strong> {mobile}</p>" : "")}
                    <p><strong>Username (Email):</strong> {email}</p>
                    <p><strong>Temporary Password:</strong> {tempPassword}</p>
                </div>
                <p style='color: #e53e3e;'><strong>Important:</strong> Please change your password after your first login.</p>"
            : $@"<div style='background-color: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0;'>
                    <p><strong>Login URL:</strong> <a href='{loginUrl}' style='color: #3182ce;'>{loginUrl}</a></p>
                    <p>Please use your existing credentials to login.</p>
                </div>";

        var body = $@"{EmailService.EMAIL_HEADER}
                    <h2 style='color: #1a365d; margin-top: 0;'>Role Assignment Notification</h2>
                    <p>Dear {memberName},</p>
                    <p>You have been assigned the following role(s) on the Rotary Club Admin Portal:</p>
                    {rolesHtml}
                    {credentialsHtml}
                    <div style='text-align: center; margin: 24px 0;'>
                        <a href='{loginUrl}' style='background-color: #3182ce; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;'>Login Now</a>
                    </div>
            {EmailService.EMAIL_FOOTER}";

        await _emailService.SendGenericEmailAsync(email, subject, body);
    }

    private static string GenerateTempPassword()
    {
        const string upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        var random = new Random();
        var password = new char[8];

        for (int i = 0; i < 8; i++)
        {
            password[i] = upper[random.Next(upper.Length)];
        }

        return new string(password);
    }

    // ══════════════════════════════════════════════════════════════════════
    // Role mutual exclusion helper
    // ──────────────────────────────────────────────────────────────────────
    // Top-level standalone roles (cannot stack with any other admin role):
    //   3 = SuperAdmin
    //
    // Stackable admin roles (can stack with each other but NOT with SA):
    //   2 = Admin (District Admin and Club Admin share this role id, distinguished by fk_district_id vs fk_club_id)
    //   6 = AG
    //
    // 1 = Member is implicit (from club_members) and always allowed.
    //
    // Call this BEFORE inserting a new role. Throws InvalidOperationException if conflict.
    // ══════════════════════════════════════════════════════════════════════
    private static readonly HashSet<int> TopLevelStandaloneRoles = new() { 3 };
    private static readonly HashSet<int> StackableAdminRoles = new() { 2, 6 };

    private static string RoleName(int roleId) => roleId switch
    {
        1 => "Member",
        2 => "Admin",
        3 => "SuperAdmin",
        6 => "AG",
        _ => $"Role #{roleId}"
    };

    // Role mutual-exclusion REMOVED (2026-08-14, per requirement): any role may now coexist with
    // any other on the same member (e.g. a SuperAdmin can also be District Admin / Club Admin /
    // AG). This is intentionally a no-op so every existing caller keeps
    // working without conflict errors. Operational rules (one active Club Admin
    // per club, no duplicate admin for the same member+club) still live in their own assign methods.
#pragma warning disable CS1998 // async kept for signature compatibility with callers
    private async Task CheckRoleConflictAsync(MySqlConnection conn, int memberId, int newRoleId)
    {
        await Task.CompletedTask; // no conflict checks — combinations are allowed
    }
#pragma warning restore CS1998

    // Public version — for callers outside RoleService (e.g., DistrictModulesController.AssignDistrictAdmin)
    public async Task CheckRoleConflictPublicAsync(int memberId, int newRoleId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        await CheckRoleConflictAsync(conn, memberId, newRoleId);
    }
}
