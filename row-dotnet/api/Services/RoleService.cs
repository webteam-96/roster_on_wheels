using System.Data;
using Dapper;
using Microsoft.AspNetCore.Http;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class RoleService : IRoleService
{
    private readonly string _connectionString;
    private readonly IEmailService _emailService;
    private readonly IAuditLogService _auditLog;
    private readonly IConfiguration _configuration;
    private readonly ILogger<RoleService> _logger;

    public RoleService(IConfiguration configuration, IEmailService emailService, IAuditLogService auditLog, ILogger<RoleService> logger)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _emailService = emailService;
        _auditLog = auditLog;
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

        // Mutual exclusion: Admin (role 2) cannot coexist with SA/ZC/RID
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

    // Shared login provisioning + notification — mirrors the Admin/Club-Admin assign flow so any
    // feature that grants access (e.g. Goal Setting leadership roles) gives the member a login the
    // SAME way: create a temp-password credential if they have none (or undelete/reactivate one),
    // then email them their credentials. If they already have an active login, it's reused — no new
    // password. Best-effort email (fire-and-forget). Safe to call for a member who already has a login.
    public async Task EnsureLoginAndNotifyAsync(int memberId, int assignedBy, bool sendEmail = true)
    {
        if (memberId <= 0) return;
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var member = await connection.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT EmailId, MemberName, PrimaryMobileNumber FROM member_master_profile WHERE pk_member_master_profile_id = @MemberId AND isdeleted = 0",
            new { MemberId = memberId });
        if (member == null) return;

        var credState = await connection.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT IsActive, isdeleted FROM member_credentials WHERE fk_member_master_profile_id = @MemberId",
            new { MemberId = memberId });

        string? tempPassword = null;
        if (credState == null)
        {
            tempPassword = GenerateTempPassword();
            var hash = BCrypt.Net.BCrypt.HashPassword(tempPassword);
            await connection.ExecuteAsync(@"
                INSERT INTO member_credentials (fk_member_master_profile_id, PasswordHash, IsTemporaryPassword, IsActive, created_by)
                VALUES (@MemberId, @Hash, 1, 1, @CreatedBy)",
                new { MemberId = memberId, Hash = hash, CreatedBy = assignedBy });
        }
        else if (Convert.ToInt32(credState.isdeleted) == 1)
        {
            tempPassword = GenerateTempPassword();
            var hash = BCrypt.Net.BCrypt.HashPassword(tempPassword);
            await connection.ExecuteAsync(@"
                UPDATE member_credentials
                SET PasswordHash = @Hash, IsTemporaryPassword = 1, IsActive = 1, isdeleted = 0,
                    modified_by = @By, modified_date = NOW()
                WHERE fk_member_master_profile_id = @MemberId",
                new { MemberId = memberId, Hash = hash, By = assignedBy });
        }
        else if (Convert.ToInt32(credState.IsActive) == 0)
        {
            await connection.ExecuteAsync(@"
                UPDATE member_credentials SET IsActive = 1, modified_by = @By, modified_date = NOW()
                WHERE fk_member_master_profile_id = @MemberId AND isdeleted = 0",
                new { MemberId = memberId, By = assignedBy });
        }
        // else: already-active login — reuse, no new password (tempPassword stays null).

        if (sendEmail && member?.EmailId != null)
        {
            var email = (string)member.EmailId;
            var name = (string)member.MemberName;
            var mobile = (string?)member.PrimaryMobileNumber;
            _ = Task.Run(async () =>
            {
                try
                {
                    await using var emailConn = CreateConnection();
                    await emailConn.OpenAsync();
                    var rolesHtml = await BuildAllRolesHtmlAsync(emailConn, memberId);
                    await SendRoleAssignmentEmailAsync(email, name, mobile, tempPassword, rolesHtml);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Goal-role login/email provisioning failed for member {MemberId}", memberId);
                }
            });
        }
    }

    // Fire-and-forget "your goal-setting role was removed" email — mirrors the District Admin /
    // Zonal Coordinator removal notice (same template, no CC). Called by the Goal Setting revoke
    // path. Best-effort: a failed email must never turn a successful revoke into an error.
    public void NotifyGoalRoleRemoved(int memberId, string roleLabel, string? scopeContext)
    {
        if (memberId <= 0) return;
        _ = Task.Run(async () =>
        {
            try { await SendDistrictRoleRemovedEmailAsync(memberId, roleLabel, scopeContext); }
            catch (Exception ex) { _logger.LogError(ex, "Goal-role removal email failed for member {MemberId}", memberId); }
        });
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

    // District-scoped role removal — no CC. Used for District Admin, ZC, RIDirector removals.
    private async Task SendDistrictRoleRemovedEmailAsync(int memberId, string roleLabel, string? scopeContext)
    {
        try
        {
            using var conn = CreateConnection();
            await conn.OpenAsync();
            var member = await conn.QueryFirstOrDefaultAsync<dynamic>(
                "SELECT MemberName, EmailId FROM member_master_profile WHERE pk_member_master_profile_id = @Id AND isdeleted = 0",
                new { Id = memberId });
            if (member == null || string.IsNullOrWhiteSpace((string?)member.EmailId)) return;
            await _emailService.SendRoleOrMembershipRemovedEmailAsync(
                (string)member.EmailId,
                (string)member.MemberName,
                roleLabel,
                scopeContext,
                null);
        }
        catch (Exception ex) { _logger.LogError(ex, "Failed to send district role removed email for member {MemberId} role {Role}", memberId, roleLabel); }
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

    public async Task<ZonalCoordinatorDto?> GetZonalCoordinatorAsync(int zoneId)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        return await connection.QueryFirstOrDefaultAsync<ZonalCoordinatorDto>(
            "sp_zonal_coordinator_get_by_zone",
            new { p_ZoneId = zoneId },
            commandType: CommandType.StoredProcedure);
    }

    public async Task<object> AssignZonalCoordinatorAsync(AssignZonalCoordinatorDto dto, int assignedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Verify member exists
        var memberExists = await connection.ExecuteScalarAsync<int>(
            "sp_role_check_member_exists",
            new { p_MemberId = dto.MemberId },
            commandType: CommandType.StoredProcedure);

        if (memberExists == 0)
            throw new KeyNotFoundException("Member not found.");

        // Mutual exclusion: Zonal Coordinator (role 4) is standalone — cannot coexist with any other admin role
        await CheckRoleConflictAsync(connection, dto.MemberId, 4);

        // Assign coordinator role. Inlined (2026-08-14) — replaces sp_zonal_coordinator_assign, which
        // SIGNAL-blocked assigning ZC to a member who already held a SuperAdmin/Admin role. Any role
        // can now coexist, so that guard is gone. Still enforces ONE active ZC per zone: deactivate the
        // current coordinator, then insert the new one — wrapped in a transaction so the zone is never
        // left with zero or two active coordinators.
        using (var tx = await connection.BeginTransactionAsync())
        {
            await connection.ExecuteAsync(@"
                UPDATE member_roles
                SET IsActive = 0, RevokedDate = NOW(), RevokedBy = @AssignedBy
                WHERE fk_role_id = 4 AND fk_zone_id = @ZoneId AND IsActive = 1 AND isdeleted = 0",
                new { ZoneId = dto.ZoneId, AssignedBy = assignedBy }, tx);

            await connection.ExecuteAsync(@"
                INSERT INTO member_roles
                    (fk_member_master_profile_id, fk_role_id, fk_zone_id, AssignedBy, AssignedDate, IsActive, isdeleted)
                VALUES (@MemberId, 4, @ZoneId, @AssignedBy, NOW(), 1, 0)",
                new { MemberId = dto.MemberId, ZoneId = dto.ZoneId, AssignedBy = assignedBy }, tx);

            await tx.CommitAsync();
        }

        // Get member details
        var member = await connection.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT EmailId, MemberName, PrimaryMobileNumber FROM member_master_profile WHERE pk_member_master_profile_id = @MemberId AND isdeleted = 0",
            new { MemberId = dto.MemberId });

        // Check credentials state: missing, inactive (deactivated when last admin role was removed), or active.
        // Read isdeleted too — a soft-deleted row still holds the UNIQUE fk_member_master_profile_id,
        // so undelete + reset instead of INSERT (which would throw a duplicate-key error).
        var credState = await connection.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT IsActive, isdeleted FROM member_credentials WHERE fk_member_master_profile_id = @MemberId",
            new { MemberId = dto.MemberId });

        string? tempPassword = null;
        if (credState == null)
        {
            tempPassword = GenerateTempPassword();
            var passwordHash = BCrypt.Net.BCrypt.HashPassword(tempPassword);
            await connection.ExecuteAsync(
                "sp_role_create_credentials",
                new { p_MemberId = dto.MemberId, p_Hash = passwordHash, p_CreatedBy = assignedBy },
                commandType: CommandType.StoredProcedure);
        }
        else if (Convert.ToInt32(credState.isdeleted) == 1)
        {
            // Soft-deleted credentials → undelete + reset with a fresh temp password.
            tempPassword = GenerateTempPassword();
            var passwordHash = BCrypt.Net.BCrypt.HashPassword(tempPassword);
            await connection.ExecuteAsync(@"
                UPDATE member_credentials
                SET PasswordHash = @Hash, IsTemporaryPassword = 1, IsActive = 1, isdeleted = 0,
                    modified_by = @ModifiedBy, modified_date = NOW()
                WHERE fk_member_master_profile_id = @MemberId",
                new { MemberId = dto.MemberId, Hash = passwordHash, ModifiedBy = assignedBy });
        }
        else if (Convert.ToInt32(credState.IsActive) == 0)
        {
            // Reactivate without changing password — member can log in with their existing credentials.
            await connection.ExecuteAsync(@"
                UPDATE member_credentials
                SET IsActive = 1, modified_by = @ModifiedBy, modified_date = NOW()
                WHERE fk_member_master_profile_id = @MemberId AND isdeleted = 0",
                new { MemberId = dto.MemberId, ModifiedBy = assignedBy });
        }

        // Fire-and-forget on its own connection — same reasoning as AssignAdminRoleAsync: the
        // coordinator assignment above is already committed, so a slow roles-summary query or
        // mail API call must never turn a successful assignment into a reported failure.
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
                    var rolesHtml = await BuildAllRolesHtmlAsync(emailConn, dto.MemberId);
                    await SendRoleAssignmentEmailAsync(emailToSend, memberNameToSend, mobileToSend, tempPassword, rolesHtml);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Role assignment email failed for member {MemberId}", dto.MemberId);
                }
            });
        }

        return new { message = "Zonal Coordinator assigned successfully." };
    }

    public async Task<object> RemoveZonalCoordinatorAsync(int zoneId, int revokedBy)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Get current coordinator before removing
        var coordinator = await connection.QueryFirstOrDefaultAsync<dynamic>(
            "sp_zonal_coordinator_get_by_zone",
            new { p_ZoneId = zoneId },
            commandType: CommandType.StoredProcedure);

        await connection.ExecuteAsync(
            "sp_zonal_coordinator_remove",
            new { p_ZoneId = zoneId, p_RevokedBy = revokedBy },
            commandType: CommandType.StoredProcedure);

        // If removed coordinator has no other admin roles, deactivate credentials
        if (coordinator != null)
        {
            int memberId = (int)coordinator.MemberId;
            var hasSuperAdmin = await connection.ExecuteScalarAsync<int>(
                "sp_role_check_has_superadmin",
                new { p_MemberId = memberId },
                commandType: CommandType.StoredProcedure);

            var hasAnyAdmin = await connection.ExecuteScalarAsync<int>(
                "sp_role_check_has_any_admin",
                new { p_MemberId = memberId },
                commandType: CommandType.StoredProcedure);

            if (hasSuperAdmin == 0 && hasAnyAdmin == 0)
            {
                await connection.ExecuteAsync(
                    "sp_role_deactivate_credentials",
                    new { p_MemberId = memberId, p_ModifiedBy = revokedBy },
                    commandType: CommandType.StoredProcedure);
            }

            // Notify the former coordinator (no CC — district-tier role).
            var zoneName = await connection.ExecuteScalarAsync<string?>(
                "SELECT ZoneName FROM zone_master WHERE pk_zone_id = @Id", new { Id = zoneId });
            var scope = !string.IsNullOrWhiteSpace(zoneName) ? $"Zone {zoneName}" : null;
            _ = Task.Run(async () => await SendDistrictRoleRemovedEmailAsync(memberId, "Zonal Coordinator role", scope));
        }

        return new { message = "Zonal Coordinator removed successfully." };
    }

    public async Task<List<ZonalMemberSearchDto>> SearchZoneMembersAsync(int zoneId, string search)
    {
        using var connection = CreateConnection();
        await connection.OpenAsync();

        // Inlined (2026-08-14) — replaces sp_zonal_coordinator_search_members, which still filtered
        // out members who already hold an admin role (the old "ZC must be standalone" rule). Now that
        // any role can coexist (see CheckRoleConflictAsync no-op), a District/Club Admin must be
        // selectable as ZC too — so this returns EVERY active member in the zone, searchable by name,
        // mobile OR email, with no role-based exclusion. One row per member (grouped across clubs).
        var term = (search ?? string.Empty).Trim();
        var results = await connection.QueryAsync<ZonalMemberSearchDto>(@"
            SELECT m.pk_member_master_profile_id            AS MemberId,
                   m.MemberName                             AS MemberName,
                   COALESCE(MAX(m.EmailId), '')             AS Email,
                   MAX(c.ClubName)                          AS ClubName,
                   MAX(d.DistrictNumber)                    AS DistrictNumber
            FROM club_members cm
            JOIN club_master c            ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
            JOIN district_master d        ON d.pk_district_id = c.fk_district_id AND d.isdeleted = 0
            JOIN member_master_profile m  ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            WHERE d.fk_zone_id = @ZoneId
              AND cm.isdeleted = 0 AND cm.IsActive = 1 AND cm.TerminationDate IS NULL
              AND (@Search = ''
                   OR m.MemberName LIKE CONCAT('%', @Search, '%')
                   OR m.PrimaryMobileNumber LIKE CONCAT('%', @Search, '%')
                   OR m.EmailId LIKE CONCAT('%', @Search, '%'))
            GROUP BY m.pk_member_master_profile_id, m.MemberName
            ORDER BY m.MemberName
            LIMIT 50",
            new { ZoneId = zoneId, Search = term });

        return results.ToList();
    }

    private async Task<string> BuildAllRolesHtmlAsync(MySqlConnection connection, int memberId)
    {
        // Get all active roles with details
        var roles = await connection.QueryAsync<dynamic>(@"
            SELECT r.fk_role_id AS RoleId,
                   CASE r.fk_role_id
                       WHEN 2 THEN 'Club Admin'
                       WHEN 3 THEN 'Super Admin'
                       WHEN 4 THEN 'Zonal Coordinator'
                       WHEN 5 THEN 'AG'
                       WHEN 6 THEN 'Moderator'
                       WHEN 7 THEN 'District Admin'
                       ELSE 'Member'
                   END AS RoleName,
                   c.ClubName,
                   d.DistrictNumber,
                   z.ZoneName
            FROM member_roles r
            LEFT JOIN club_master c ON r.fk_club_id = c.pk_club_id
            LEFT JOIN district_master d ON c.fk_district_id = d.pk_district_id
            LEFT JOIN zone_master z ON r.fk_zone_id = z.pk_zone_id
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
            else if (roleId == 4) // Zonal Coordinator
            {
                details = (string?)r.ZoneName ?? "";
            }
            else if (roleId == 5) // AG
            {
                var district = (string?)r.DistrictNumber ?? "";
                details = $"District {district}";
            }
            else if (roleId == 6) // Moderator
            {
                var district = (string?)r.DistrictNumber ?? "";
                var club = (string?)r.ClubName ?? "";
                details = !string.IsNullOrEmpty(club) ? $"District {district} - {club}" : $"District {district}";
            }
            else if (roleId == 7) // District Admin
            {
                var district = (string?)r.DistrictNumber ?? "";
                details = $"District {district}";
            }

            html += $"<tr><td style='padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;'>{roleName}</td>"
                  + $"<td style='padding: 8px 12px; border: 1px solid #ddd;'>{details}</td></tr>";
        }

        // Goal Setting leadership roles (RI Director / Zone Co-ordinator / District Assistant) —
        // these live in goal_role_assignments, not member_roles, so add them to the same table.
        var goalRoles = await connection.QueryAsync<dynamic>(@"
            SELECT a.RoleTitle, a.Avenue, a.RoleType, z.ZoneName AS SingleZone,
                   (SELECT GROUP_CONCAT(DISTINCT zm.ZoneName ORDER BY zm.ZoneName SEPARATOR ', ')
                      FROM goal_role_assignment_zones raz JOIN zone_master zm ON zm.pk_zone_id = raz.fk_zone_id
                      WHERE raz.fk_assignment_id = a.pk_id) AS Zones,
                   (SELECT GROUP_CONCAT(DISTINCT dm.DistrictNumber ORDER BY dm.DistrictNumber SEPARATOR ', ')
                      FROM goal_role_assignment_districts rad JOIN district_master dm ON dm.pk_district_id = rad.fk_district_id
                      WHERE rad.fk_assignment_id = a.pk_id) AS Districts
            FROM goal_role_assignments a
            LEFT JOIN zone_master z ON z.pk_zone_id = a.fk_zone_id
            WHERE a.fk_member_id = @MemberId AND a.IsActive = 1 AND a.isdeleted = 0
            ORDER BY a.pk_id", new { MemberId = memberId });

        foreach (var g in goalRoles)
        {
            var title = (string?)g.RoleTitle ?? "Goal Setting Role";
            var roleType = (string?)g.RoleType ?? "";
            var avenue = (string?)g.Avenue;
            string details;
            if (roleType == "AllCategoryAllDistrictsFewZones")
                details = "Zones: " + ((string?)g.Zones ?? "-");
            else if (roleType == "FewDistrictsOneCategoryOneZone")
            {
                var dz = (string?)g.SingleZone ?? "";
                var dd = (string?)g.Districts;
                details = string.IsNullOrEmpty(dd) ? dz : $"{dz} · Districts: {dd}";
            }
            else // AllDistrictsOneCategoryOneZone
                details = (string?)g.SingleZone ?? "";
            if (!string.IsNullOrEmpty(avenue) && avenue != "RI Director")
                details = string.IsNullOrEmpty(details) ? avenue : $"{avenue} · {details}";

            html += $"<tr><td style='padding: 8px 12px; border: 1px solid #ddd; font-weight: bold;'>{title} (Goal Setting)</td>"
                  + $"<td style='padding: 8px 12px; border: 1px solid #ddd;'>{details}</td></tr>";
        }

        html += "</table>";
        return html;
    }

    // ── Goal Setting leadership email (2026-09-16 request) ──────────────────────────────────────
    // A SEPARATE path from EnsureLoginAndNotifyAsync / SendRoleAssignmentEmailAsync: those are shared
    // with the District-Admin, Club-Admin and SuperAdmin flows and must keep their existing wording.
    // This one sends the three approved role templates, lists NO other roles (the member sees those
    // after logging in) and shows no forgot-password link.
    //   • no login yet, or a deleted/soft-removed one → create a TEMPORARY password and print it; the
    //     login page then shows the change-password screen automatically (isTemporaryPassword).
    //   • an inactive login → reactivate it, keep the password.
    //   • an active login → username + link only, "use your existing password".
    public async Task SendGoalRoleCredentialsEmailAsync(int memberId, string roleType, int assignedBy)
    {
        if (memberId <= 0) return;
        using var connection = CreateConnection();
        await connection.OpenAsync();

        var member = await connection.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT EmailId, MemberName, PrimaryMobileNumber FROM member_master_profile WHERE pk_member_master_profile_id = @MemberId AND isdeleted = 0",
            new { MemberId = memberId });
        if (member == null) return;
        var email = (string?)member.EmailId;
        if (string.IsNullOrWhiteSpace(email)) return;   // nothing to send to

        var credState = await connection.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT IsActive, isdeleted FROM member_credentials WHERE fk_member_master_profile_id = @MemberId",
            new { MemberId = memberId });

        string? tempPassword = null;
        if (credState == null)
        {
            tempPassword = GenerateTempPassword();
            var hash = BCrypt.Net.BCrypt.HashPassword(tempPassword);
            await connection.ExecuteAsync(@"
                INSERT INTO member_credentials (fk_member_master_profile_id, PasswordHash, IsTemporaryPassword, IsActive, created_by)
                VALUES (@MemberId, @Hash, 1, 1, @CreatedBy)",
                new { MemberId = memberId, Hash = hash, CreatedBy = assignedBy });
        }
        else if (Convert.ToInt32(credState.isdeleted) == 1)
        {
            tempPassword = GenerateTempPassword();
            var hash = BCrypt.Net.BCrypt.HashPassword(tempPassword);
            await connection.ExecuteAsync(@"
                UPDATE member_credentials
                SET PasswordHash = @Hash, IsTemporaryPassword = 1, IsActive = 1, isdeleted = 0,
                    modified_by = @By, modified_date = NOW()
                WHERE fk_member_master_profile_id = @MemberId",
                new { MemberId = memberId, Hash = hash, By = assignedBy });
        }
        else if (Convert.ToInt32(credState.IsActive) == 0)
        {
            await connection.ExecuteAsync(@"
                UPDATE member_credentials SET IsActive = 1, modified_by = @By, modified_date = NOW()
                WHERE fk_member_master_profile_id = @MemberId AND isdeleted = 0",
                new { MemberId = memberId, By = assignedBy });
        }
        // else: active login — keep their password, the mail tells them to use it.

        var (subject, body) = BuildGoalRoleEmail(roleType, (string)member.MemberName, email!,
            (string?)member.PrimaryMobileNumber, tempPassword);
        try { await _emailService.SendGenericEmailAsync(email!, subject, body); }
        catch (Exception ex) { _logger.LogError(ex, "Goal-role email failed for member {MemberId}", memberId); }
    }

    // The three approved templates, keyed by goal_role_assignments.RoleType.
    private (string Subject, string Body) BuildGoalRoleEmail(
        string roleType, string memberName, string email, string? mobile, string? tempPassword)
    {
        var loginUrl = _configuration["FrontendUrl"]?.TrimEnd('/') + "/login";
        var (greeting, accessLine, subject) = roleType switch
        {
            "AllCategoryAllDistrictsFewZones" => (
                $"Dear RI Director {memberName},",
                "Your administrative access to the zonal report has been enabled.",
                "ROW — RI Director access enabled"),
            "AllDistrictsOneCategoryOneZone" => (
                $"Dear Regional Leader {memberName},",
                "Your administrative access to the Zonal Report portal has been enabled.",
                "ROW — Regional Leader access enabled"),
            _ => (
                $"Dear Assistant Regional Leader {memberName},",
                "Your administrative access to the assigned District Report has been enabled.",
                "ROW — Assistant Regional Leader access enabled"),
        };

        var passwordLine = tempPassword != null
            ? $"<p style='margin:4px 0;'><strong>Password:</strong> {tempPassword}</p>"
            : "<p style='margin:4px 0;'><strong>Password:</strong> Please use your existing password.</p>";

        var body = $@"{EmailService.EMAIL_HEADER}
                    <p>{greeting}</p>
                    <p>{accessLine}</p>
                    <p>Please log in to view your report:</p>
                    <div style='background-color:#f7fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0;'>
                        <p style='margin:4px 0;'><strong>Link:</strong> <a href='{loginUrl}' style='color:#3182ce;'>{loginUrl}</a></p>
                        {(!string.IsNullOrWhiteSpace(mobile) ? $"<p style='margin:4px 0;'><strong>User name (mobile):</strong> {mobile}</p>" : "")}
                        <p style='margin:4px 0;'><strong>User name (email):</strong> {email}</p>
                        {passwordLine}
                    </div>
                    {(tempPassword != null
                        ? "<p style='color:#e53e3e;'><strong>Note:</strong> You will be asked to set your own password the first time you log in.</p>"
                        : "")}
                    <div style='text-align:center;margin:24px 0;'>
                        <a href='{loginUrl}' style='background-color:#3182ce;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;'>Login Now</a>
                    </div>
                    <p style='margin-top:20px;'>Regards,<br/>ROW</p>
            {EmailService.EMAIL_FOOTER}";

        return (subject, body);
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
    //   4 = ZonalCoordinator
    //   7 = RIDirector
    //
    // Stackable admin roles (can stack with each other but NOT with SA/ZC/RID):
    //   2 = Admin (District Admin and Club Admin share this role id, distinguished by fk_district_id vs fk_club_id)
    //   5 = ClubModerator
    //   6 = AG
    //
    // 1 = Member is implicit (from club_members) and always allowed.
    //
    // Call this BEFORE inserting a new role. Throws InvalidOperationException if conflict.
    // ══════════════════════════════════════════════════════════════════════
    private static readonly HashSet<int> TopLevelStandaloneRoles = new() { 3, 4, 7 };
    private static readonly HashSet<int> StackableAdminRoles = new() { 2, 5, 6 };

    private static string RoleName(int roleId) => roleId switch
    {
        1 => "Member",
        2 => "Admin",
        3 => "SuperAdmin",
        4 => "Zonal Coordinator",
        5 => "Club Moderator",
        6 => "AG",
        7 => "RI Director",
        _ => $"Role #{roleId}"
    };

    // Role mutual-exclusion REMOVED (2026-08-14, per requirement): any role may now coexist with
    // any other on the same member (e.g. a SuperAdmin can also be District Admin / Club Admin / ZC /
    // RI Director / AG / Club Moderator). This is intentionally a no-op so every existing caller keeps
    // working without conflict errors. Operational rules (one active ZC per zone, one active Club Admin
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

    // ══════════════════════════════════════════════════════════════════════
    // RI Director Management (role id 7)
    // Mutually exclusive with ALL other admin roles. Only Member (implicit) can stack.
    // ══════════════════════════════════════════════════════════════════════

    // Everything behind one RI Director row: the profile, every club he belongs to (with its district
    // and zone), and any other admin role he holds. Roles may now be combined freely, so a director is
    // very often a club member and a club/district admin too (user 2026-09-29).
    public async Task<RIDirectorProfileDto?> GetRIDirectorProfileAsync(int memberId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var profile = await conn.QueryFirstOrDefaultAsync<RIDirectorProfileDto>(@"
            SELECT m.pk_member_master_profile_id AS MemberId,
                   m.MemberName AS MemberName,
                   m.EmailId AS Email,
                   m.PrimaryMobileNumber AS Mobile,
                   -- City/State live on the address row, not the profile (Residence first, else any).
                   (SELECT a.City FROM member_address_details a
                     WHERE a.fk_member_master_profile_id = m.pk_member_master_profile_id AND a.isdeleted = 0
                     ORDER BY a.AddressType = 'Residence' DESC, a.pk_member_address_details_id LIMIT 1) AS City,
                   (SELECT a.State FROM member_address_details a
                     WHERE a.fk_member_master_profile_id = m.pk_member_master_profile_id AND a.isdeleted = 0
                     ORDER BY a.AddressType = 'Residence' DESC, a.pk_member_address_details_id LIMIT 1) AS State,
                   m.RotaryId AS RotaryId,
                   CASE
                       WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                       WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                       ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                   END AS PhotoPath,
                   (SELECT MIN(mr.created_date) FROM member_roles mr
                     WHERE mr.fk_member_master_profile_id = m.pk_member_master_profile_id
                       AND mr.fk_role_id = 7 AND mr.IsActive = 1 AND mr.isdeleted = 0) AS AssignedDate
            FROM member_master_profile m
            WHERE m.pk_member_master_profile_id = @Id AND m.isdeleted = 0",
            new { Id = memberId });
        if (profile == null) return null;

        // Every club he is an active member of, with the club's district and zone.
        profile.Clubs = (await conn.QueryAsync<RIDirectorClubDto>(@"
            SELECT c.pk_club_id AS ClubId,
                   c.ClubName AS ClubName,
                   d.DistrictNumber AS DistrictNumber,
                   z.ZoneName AS ZoneName,
                   COALESCE(cm.IsHonoraryMember, 0) AS IsHonorary,
                   (SELECT dg.designation_name
                      FROM board_of_directors bod
                      JOIN designation_master dg ON dg.pk_designation_id = bod.fk_designation_id
                     WHERE bod.fk_member_master_profile_id = cm.fk_member_master_profile_id
                       AND bod.fk_club_id = c.pk_club_id AND bod.isdeleted = 0
                     ORDER BY bod.fk_year_id DESC, dg.sort_order LIMIT 1) AS Designation,
                   (SELECT COUNT(*) FROM member_roles mr
                     WHERE mr.fk_member_master_profile_id = cm.fk_member_master_profile_id
                       AND mr.fk_role_id = 2 AND mr.fk_club_id = c.pk_club_id
                       AND mr.IsActive = 1 AND mr.isdeleted = 0) > 0 AS IsClubAdmin
            FROM club_members cm
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
            LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
            LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE cm.fk_member_master_profile_id = @Id AND cm.IsActive = 1 AND cm.isdeleted = 0
            ORDER BY c.ClubName",
            new { Id = memberId })).ToList();

        // Districts he administers in his own right (District Admin rows carry the district).
        profile.AdminDistricts = (await conn.QueryAsync<string>(@"
            SELECT DISTINCT d.DistrictNumber
            FROM member_roles mr
            JOIN district_master d ON d.pk_district_id = mr.fk_district_id AND d.isdeleted = 0
            WHERE mr.fk_member_master_profile_id = @Id AND mr.fk_role_id = 2
              AND mr.fk_district_id > 0 AND mr.IsActive = 1 AND mr.isdeleted = 0
            ORDER BY d.DistrictNumber",
            new { Id = memberId })).ToList();

        // The other hats he wears - shown as plain information, nothing here blocks anything.
        profile.OtherRoles = (await conn.QueryAsync<string>(@"
            SELECT DISTINCT CASE mr.fk_role_id
                     WHEN 1 THEN 'Member' WHEN 2 THEN CASE WHEN mr.fk_district_id > 0 THEN 'District Admin' ELSE 'Club Admin' END
                     WHEN 3 THEN 'SuperAdmin' WHEN 4 THEN 'Zonal Coordinator' WHEN 5 THEN 'Club Moderator'
                     WHEN 6 THEN 'AG' WHEN 7 THEN 'RI Director' ELSE CONCAT('Role ', mr.fk_role_id) END
            FROM member_roles mr
            WHERE mr.fk_member_master_profile_id = @Id AND mr.IsActive = 1 AND mr.isdeleted = 0
              AND mr.fk_role_id <> 7",
            new { Id = memberId })).ToList();

        return profile;
    }

    public async Task<List<RIDirectorDto>> GetRIDirectorsAsync()
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        await EnsureRiDirectorCredentialEmailTableAsync(conn);

        var results = await conn.QueryAsync<RIDirectorDto>(@"
            SELECT m.pk_member_master_profile_id AS MemberId,
                   m.MemberName AS MemberName,
                   m.EmailId AS Email,
                   m.PrimaryMobileNumber AS Mobile,
                   mr.created_date AS AssignedDate,
                   COALESCE(ce.SentCount, 0) AS EmailSentCount,
                   ce.LastSentDate AS EmailLastSentDate
            FROM member_roles mr
            JOIN member_master_profile m ON m.pk_member_master_profile_id = mr.fk_member_master_profile_id
            LEFT JOIN ri_director_credential_email ce ON ce.fk_member_id = m.pk_member_master_profile_id
            WHERE mr.fk_role_id = 7 AND mr.IsActive = 1 AND mr.isdeleted = 0
              AND m.isdeleted = 0
            ORDER BY m.MemberName");

        return results.ToList();
    }

    public async Task<object> AssignRIDirectorAsync(int memberId, int assignedBy, HttpContext? httpContext)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Verify member exists
        var member = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pk_member_master_profile_id AS Id, MemberName, EmailId, PrimaryMobileNumber
            FROM member_master_profile
            WHERE pk_member_master_profile_id = @Id AND isdeleted = 0",
            new { Id = memberId });

        if (member == null)
            throw new KeyNotFoundException("Member not found.");

        // Mutual exclusion: RI Director (role 7) is standalone — cannot coexist with any other admin role
        await CheckRoleConflictAsync(conn, memberId, 7);

        // Idempotent: skip if already active RI Director
        var alreadyActive = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM member_roles
            WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 7
              AND IsActive = 1 AND isdeleted = 0",
            new { MemberId = memberId });

        if (alreadyActive > 0)
            throw new InvalidOperationException("Member is already an active RI Director.");

        // Insert RI Director role (global scope — no zone/district/club)
        await conn.ExecuteAsync(@"
            INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, IsActive, created_by)
            VALUES (@MemberId, 7, 1, @AssignedBy)",
            new { MemberId = memberId, AssignedBy = assignedBy });

        // Read isdeleted too — a soft-deleted row still holds the UNIQUE fk_member_master_profile_id,
        // so undelete + reset instead of INSERT (which would throw a duplicate-key error).
        var credState = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT IsActive, isdeleted FROM member_credentials WHERE fk_member_master_profile_id = @Id",
            new { Id = memberId });

        // No email on assign (user 2026-09-29): RI Directors get their login only when they ask,
        // via Send / Resend Email on the list. A new login gets a random password nobody sees;
        // the real temporary password is issued by SendRIDirectorCredentialsAsync.
        bool issuesPassword = false;
        if (credState == null)
        {
            issuesPassword = true;
            var hash = BCrypt.Net.BCrypt.HashPassword(GenerateTempPassword());
            await conn.ExecuteAsync(@"
                INSERT INTO member_credentials (fk_member_master_profile_id, PasswordHash, IsTemporaryPassword, IsActive, created_by)
                VALUES (@Id, @Hash, 1, 1, @By)",
                new { Id = memberId, Hash = hash, By = assignedBy });
        }
        else if (Convert.ToInt32(credState.isdeleted) == 1)
        {
            // Soft-deleted credentials → undelete + reset with a fresh (unshared) temp password.
            issuesPassword = true;
            var hash = BCrypt.Net.BCrypt.HashPassword(GenerateTempPassword());
            await conn.ExecuteAsync(@"
                UPDATE member_credentials
                SET PasswordHash = @Hash, IsTemporaryPassword = 1, IsActive = 1, isdeleted = 0,
                    modified_by = @By, modified_date = NOW()
                WHERE fk_member_master_profile_id = @Id",
                new { Id = memberId, Hash = hash, By = assignedBy });
        }
        else if (Convert.ToInt32(credState.IsActive) == 0)
        {
            // Reactivate without changing password — member can log in with their existing credentials.
            await conn.ExecuteAsync(@"
                UPDATE member_credentials
                SET IsActive = 1, modified_by = @ModifiedBy, modified_date = NOW()
                WHERE fk_member_master_profile_id = @Id AND isdeleted = 0",
                new { Id = memberId, ModifiedBy = assignedBy });
        }

        // Fresh "not sent" state — a re-assigned director starts over at Send Email.
        await EnsureRiDirectorCredentialEmailTableAsync(conn);
        await conn.ExecuteAsync(@"
            INSERT INTO ri_director_credential_email (fk_member_id, IssuesPassword, SentCount, created_by)
            VALUES (@Id, @Issues, 0, @By)
            ON DUPLICATE KEY UPDATE IssuesPassword = VALUES(IssuesPassword), SentCount = 0,
                LastSentDate = NULL, LastSentBy = NULL, modified_by = @By, modified_date = NOW()",
            new { Id = memberId, Issues = issuesPassword ? 1 : 0, By = assignedBy });

        // Audit log
        await _auditLog.LogAsync(
            memberId: assignedBy,
            action: "ASSIGN_ROLE",
            entityType: "ri_director",
            entityId: memberId,
            entityName: (string?)member.MemberName,
            details: new { role = "RIDirector", targetMemberId = memberId },
            httpContext: httpContext);

        return new { message = "RI Director role assigned. Login details were not emailed — use Send Email on the list when the director asks for them." };
    }

    // Tracks whether an RI Director's login details have been emailed (Send vs Resend on the list).
    // IssuesPassword = 1 → the portal owns this login's password, so each send issues a new temp
    // password; 0 → the member already had a login, so the email says "use your existing credentials".
    private static bool _riCredTableEnsured;
    private static readonly SemaphoreSlim _riCredTableLock = new(1, 1);

    // Lazy CREATE — prod may skip DatabaseInitializer. When the table is created here for the first
    // time, directors already on the list are marked as sent (they were emailed on assign before
    // 2026-09-29). Same as SQL/ri_director_credential_email.sql.
    private static async Task EnsureRiDirectorCredentialEmailTableAsync(MySqlConnection conn)
    {
        if (_riCredTableEnsured) return;
        await _riCredTableLock.WaitAsync();
        try
        {
            if (_riCredTableEnsured) return;
            var exists = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM information_schema.TABLES
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ri_director_credential_email'");
            if (exists == 0)
            {
                await conn.ExecuteAsync(@"
                    CREATE TABLE IF NOT EXISTS ri_director_credential_email (
                        pk_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                        fk_member_id INT NOT NULL,
                        IssuesPassword TINYINT(1) NOT NULL DEFAULT 0,
                        SentCount INT NOT NULL DEFAULT 0,
                        LastSentDate DATETIME NULL,
                        LastSentBy INT NULL,
                        created_by INT NULL,
                        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                        modified_by INT NULL,
                        modified_date DATETIME NULL,
                        UNIQUE KEY uk_ri_cred_member (fk_member_id)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
                await conn.ExecuteAsync(@"
                    INSERT IGNORE INTO ri_director_credential_email (fk_member_id, IssuesPassword, SentCount, LastSentDate)
                    SELECT mr.fk_member_master_profile_id,
                           CASE WHEN mc.fk_member_master_profile_id IS NULL OR mc.IsTemporaryPassword = 1 THEN 1 ELSE 0 END,
                           1, MAX(mr.created_date)
                    FROM member_roles mr
                    LEFT JOIN member_credentials mc ON mc.fk_member_master_profile_id = mr.fk_member_master_profile_id
                    WHERE mr.fk_role_id = 7 AND mr.IsActive = 1 AND mr.isdeleted = 0
                    GROUP BY mr.fk_member_master_profile_id, mc.fk_member_master_profile_id, mc.IsTemporaryPassword");
            }
            _riCredTableEnsured = true;
        }
        finally { _riCredTableLock.Release(); }
    }

    public async Task<object> SendRIDirectorCredentialsAsync(int memberId, int sentBy, HttpContext? httpContext)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        await EnsureRiDirectorCredentialEmailTableAsync(conn);

        var member = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT m.MemberName, m.EmailId, m.PrimaryMobileNumber
            FROM member_master_profile m
            WHERE m.pk_member_master_profile_id = @Id AND m.isdeleted = 0
              AND EXISTS (SELECT 1 FROM member_roles mr
                          WHERE mr.fk_member_master_profile_id = m.pk_member_master_profile_id
                            AND mr.fk_role_id = 7 AND mr.IsActive = 1 AND mr.isdeleted = 0)",
            new { Id = memberId });
        if (member == null)
            throw new KeyNotFoundException("This member is not an active RI Director.");

        var memberEmail = ((string?)member.EmailId)?.Trim();
        if (string.IsNullOrWhiteSpace(memberEmail))
            throw new InvalidOperationException("This RI Director has no email address on the profile. Add one first.");

        var state = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT IssuesPassword, SentCount FROM ri_director_credential_email WHERE fk_member_id = @Id",
            new { Id = memberId });
        // No row = assigned before tracking existed and not seeded — treat the login as portal-owned
        // only if it is still on a temporary password.
        bool issuesPassword = state != null
            ? Convert.ToInt32(state.IssuesPassword) == 1
            : await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM member_credentials
                WHERE fk_member_master_profile_id = @Id AND IsTemporaryPassword = 1", new { Id = memberId }) > 0;
        bool isResend = state != null && Convert.ToInt32(state.SentCount) > 0;

        var credState = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT IsActive, isdeleted FROM member_credentials WHERE fk_member_master_profile_id = @Id",
            new { Id = memberId });
        if (credState == null) issuesPassword = true;

        string? tempPassword = null;
        if (issuesPassword)
        {
            tempPassword = GenerateTempPassword();
            var hash = BCrypt.Net.BCrypt.HashPassword(tempPassword);
            if (credState == null)
                await conn.ExecuteAsync(@"
                    INSERT INTO member_credentials (fk_member_master_profile_id, PasswordHash, IsTemporaryPassword, IsActive, created_by)
                    VALUES (@Id, @Hash, 1, 1, @By)",
                    new { Id = memberId, Hash = hash, By = sentBy });
            else
                await conn.ExecuteAsync(@"
                    UPDATE member_credentials
                    SET PasswordHash = @Hash, IsTemporaryPassword = 1, IsActive = 1, isdeleted = 0,
                        modified_by = @By, modified_date = NOW()
                    WHERE fk_member_master_profile_id = @Id",
                    new { Id = memberId, Hash = hash, By = sentBy });
        }
        else if (Convert.ToInt32(credState!.isdeleted) == 1 || Convert.ToInt32(credState.IsActive) == 0)
        {
            // Existing login switched off since assign — switch it back on, password untouched.
            await conn.ExecuteAsync(@"
                UPDATE member_credentials SET IsActive = 1, isdeleted = 0, modified_by = @By, modified_date = NOW()
                WHERE fk_member_master_profile_id = @Id",
                new { Id = memberId, By = sentBy });
        }

        var loginUrl = _configuration["FrontendUrl"]?.TrimEnd('/') + "/login";
        var subject = "Rotary Portal — RI Director Login Details";
        var credsHtml = tempPassword != null
            ? $@"<div style='background-color: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0;'>
                    <p><strong>Login URL:</strong> <a href='{loginUrl}' style='color: #3182ce;'>{loginUrl}</a></p>
                    {(!string.IsNullOrWhiteSpace((string?)member.PrimaryMobileNumber) ? $"<p><strong>Username (Mobile):</strong> {member.PrimaryMobileNumber}</p>" : "")}
                    <p><strong>Username (Email):</strong> {memberEmail}</p>
                    <p><strong>Temporary Password:</strong> {tempPassword}</p>
                 </div>
                 <p style='color: #e53e3e;'><strong>Important:</strong> Please change your password after your first login.</p>"
            : $@"<div style='background-color: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0;'>
                    <p><strong>Login URL:</strong> <a href='{loginUrl}' style='color: #3182ce;'>{loginUrl}</a></p>
                    <p>Please use your existing credentials to login.</p>
                 </div>";

        var body = $@"{EmailService.EMAIL_HEADER}
            <h2 style='color: #1a365d; margin-top: 0;'>RI Director Role Assignment</h2>
            <p>Dear {member.MemberName},</p>
            <p>You have been assigned the <strong>RI Director</strong> role on the Rotary Admin Portal.</p>
            {credsHtml}
            <div style='text-align: center; margin: 24px 0;'>
                <a href='{loginUrl}' style='background-color: #3182ce; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;'>Login Now</a>
            </div>
            {EmailService.EMAIL_FOOTER}";

        try
        {
            await _emailService.SendGenericEmailAsync(memberEmail!, subject, body);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send RI Director login email to member {MemberId}", memberId);
            throw new InvalidOperationException("The email could not be sent. Please try again.");
        }
        _logger.LogInformation("RI Director login email sent to {Email} (member {MemberId}, resend={Resend})", memberEmail, memberId, isResend);

        await conn.ExecuteAsync(@"
            INSERT INTO ri_director_credential_email (fk_member_id, IssuesPassword, SentCount, LastSentDate, LastSentBy, created_by)
            VALUES (@Id, @Issues, 1, NOW(), @By, @By)
            ON DUPLICATE KEY UPDATE IssuesPassword = VALUES(IssuesPassword), SentCount = SentCount + 1,
                LastSentDate = NOW(), LastSentBy = @By, modified_by = @By, modified_date = NOW()",
            new { Id = memberId, Issues = issuesPassword ? 1 : 0, By = sentBy });

        await _auditLog.LogAsync(
            memberId: sentBy,
            action: isResend ? "RESEND_CREDENTIALS" : "SEND_CREDENTIALS",
            entityType: "ri_director",
            entityId: memberId,
            entityName: (string?)member.MemberName,
            details: new { role = "RIDirector", targetMemberId = memberId, newPassword = tempPassword != null },
            httpContext: httpContext);

        return new { message = $"Login details {(isResend ? "re-sent" : "sent")} to {memberEmail}." };
    }

    public async Task<object> RemoveRIDirectorAsync(int memberId, int revokedBy, HttpContext? httpContext)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var member = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT MemberName FROM member_master_profile WHERE pk_member_master_profile_id = @Id AND isdeleted = 0",
            new { Id = memberId });

        if (member == null)
            throw new InvalidOperationException("Member not found.");

        var rowsAffected = await conn.ExecuteAsync(@"
            UPDATE member_roles
            SET IsActive = 0, RevokedDate = NOW(), RevokedBy = @RevokedBy
            WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 7
              AND IsActive = 1 AND isdeleted = 0",
            new { MemberId = memberId, RevokedBy = revokedBy });

        if (rowsAffected == 0)
            throw new InvalidOperationException("Member does not have an active RI Director role.");

        // Deactivate credentials if no other admin roles remain
        var hasOtherAdminRoles = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM member_roles mr
            JOIN roles r ON r.pk_role_id = mr.fk_role_id
            WHERE mr.fk_member_master_profile_id = @MemberId
              AND r.RoleName IN ('Admin','SuperAdmin','ZonalCoordinator','AG','ClubModerator','RIDirector')
              AND mr.IsActive = 1 AND mr.isdeleted = 0",
            new { MemberId = memberId });

        // A Goal Setting role holder keeps web login (GoalLoginHelper) — don't switch their credentials off.
        if (hasOtherAdminRoles == 0 && !await GoalLoginHelper.HasActiveGoalRoleAsync(conn, memberId))
        {
            await conn.ExecuteAsync(
                "UPDATE member_credentials SET IsActive = 0 WHERE fk_member_master_profile_id = @Id",
                new { Id = memberId });
        }

        // No email on removal (user 2026-09-29): removing the role is an internal administrative
        // action - the person is not told. Assigning does not email either; login details go out only
        // when Send / Resend Email is pressed on the list.

        // Audit log
        await _auditLog.LogAsync(
            memberId: revokedBy,
            action: "REMOVE_ROLE",
            entityType: "ri_director",
            entityId: memberId,
            entityName: (string?)member.MemberName,
            details: new { role = "RIDirector", targetMemberId = memberId },
            httpContext: httpContext);

        return new { message = "RI Director role removed successfully." };
    }
}
