using RotaryApi.DTOs;
using MySqlConnector;

namespace RotaryApi.Services;

public interface IRoleService
{
    Task AssignDefaultMemberRoleAsync(int memberId, MySqlConnection connection, MySqlTransaction transaction);
    Task<object> AssignAdminRoleAsync(AssignRoleRequestDto request, int assignedBy);
    Task<object> RemoveAdminRoleAsync(RemoveRoleRequestDto request, int revokedBy);
    Task<List<string>> GetMemberRolesAsync(int memberId);
    Task<PagedResult<MemberWithRolesDto>> GetAllMembersWithRolesAsync(int page, int pageSize, string? search);
    Task CheckRoleConflictPublicAsync(int memberId, int newRoleId);
}
