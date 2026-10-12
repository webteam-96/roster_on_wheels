using Microsoft.AspNetCore.Http;
using RotaryApi.DTOs;
using MySqlConnector;

namespace RotaryApi.Services;

public interface IRoleService
{
    Task AssignDefaultMemberRoleAsync(int memberId, MySqlConnection connection, MySqlTransaction transaction);
    Task<object> AssignAdminRoleAsync(AssignRoleRequestDto request, int assignedBy);
    Task<object> RemoveAdminRoleAsync(RemoveRoleRequestDto request, int revokedBy);
    // Provision a login (temp password + email) for a member the SAME way Admin/Club-Admin does —
    // reused when granting Goal Setting leadership roles. No-op password if they already have a login.
    Task EnsureLoginAndNotifyAsync(int memberId, int assignedBy, bool sendEmail = true);
    // Goal Setting leadership email (2026-09-16): three role-specific templates (RI Director /
    // Regional Leader / Assistant Regional Leader). Lists NO other roles — the member sees those after
    // login. Provisions a login and prints a temporary password ONLY when they have none.
    Task SendGoalRoleCredentialsEmailAsync(int memberId, string roleType, int assignedBy);
    void NotifyGoalRoleRemoved(int memberId, string roleLabel, string? scopeContext);
    Task<List<string>> GetMemberRolesAsync(int memberId);
    Task<PagedResult<MemberWithRolesDto>> GetAllMembersWithRolesAsync(int page, int pageSize, string? search);
    Task<ZonalCoordinatorDto?> GetZonalCoordinatorAsync(int zoneId);
    Task<object> AssignZonalCoordinatorAsync(AssignZonalCoordinatorDto dto, int assignedBy);
    Task<object> RemoveZonalCoordinatorAsync(int zoneId, int revokedBy);
    Task<List<ZonalMemberSearchDto>> SearchZoneMembersAsync(int zoneId, string search);
    Task<List<RIDirectorDto>> GetRIDirectorsAsync();
    // Profile + clubs/districts behind one RI Director row (settings/ri-director popup).
    Task<RIDirectorProfileDto?> GetRIDirectorProfileAsync(int memberId);
    Task<object> AssignRIDirectorAsync(int memberId, int assignedBy, HttpContext? httpContext);
    Task<object> RemoveRIDirectorAsync(int memberId, int revokedBy, HttpContext? httpContext);
    Task<object> SendRIDirectorCredentialsAsync(int memberId, int sentBy, HttpContext? httpContext);
    Task CheckRoleConflictPublicAsync(int memberId, int newRoleId);
}
