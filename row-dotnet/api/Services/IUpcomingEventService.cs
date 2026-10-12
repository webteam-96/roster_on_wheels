namespace RotaryApi.Services;
using RotaryApi.DTOs;

public interface IUpcomingEventService
{
    Task<(List<UpcomingEventListDto> Items, int TotalCount)> GetAllAsync(int clubId, string status, string search, int page, int pageSize, int? districtId = null);
    Task<UpcomingEventDetailDto?> GetByIdAsync(int id);
    Task<int> CreateAsync(int clubId, CreateUpcomingEventDto dto, int createdBy, int? districtId = null);
    Task UpdateAsync(int id, UpdateUpcomingEventDto dto, int modifiedBy);
    Task DeleteAsync(int id, int deletedBy);
    Task<string> UploadImageAsync(int clubId, IFormFile file);
}
