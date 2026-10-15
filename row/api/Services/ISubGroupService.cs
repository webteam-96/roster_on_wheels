using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface ISubGroupService
{
    Task<IEnumerable<SubGroupListDto>> GetSubGroupsAsync(int clubId, int yearId, int? districtId = null);
    Task<SubGroupDetailDto> GetSubGroupDetailAsync(int subGroupId);
    Task<SubGroupListDto> CreateSubGroupAsync(int clubId, CreateSubGroupDto dto, int userId, int? districtId = null);
    Task<SubGroupListDto> UpdateSubGroupAsync(int subGroupId, UpdateSubGroupDto dto, int userId);
    Task DeleteSubGroupAsync(int subGroupId, int userId);
    Task<IEnumerable<SubGroupMemberDto>> GetClubMembersAsync(int clubId);
    Task<IEnumerable<SubGroupMemberDto>> GetDistrictMembersAsync(int districtId);
    Task<IEnumerable<dynamic>> GetAvailableYearsAsync(int? clubId, int? districtId);
}
