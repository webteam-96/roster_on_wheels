namespace RotaryApi.Services;
using RotaryApi.DTOs;

public interface IAttendanceService
{
    Task<(List<AttendanceListDto> Items, int TotalCount)> GetAllAsync(int clubId, int yearId, string search, int page, int pageSize);
    Task<AttendanceDetailDto?> GetByIdAsync(int id);
    Task<int> CreateAsync(int clubId, CreateAttendanceDto dto, int createdBy);
    Task<bool> UpdateAsync(int clubId, int id, UpdateAttendanceDto dto, int modifiedBy);
    Task<bool> DeleteAsync(int clubId, int id, int deletedBy);
    Task<List<object>> GetYearsAsync(int clubId);
    Task<List<ClubMemberSimpleDto>> GetClubMembersAsync(int clubId);
}
