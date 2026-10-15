namespace RotaryApi.Services;
using RotaryApi.DTOs;

public interface IAnnouncementService
{
    Task<(List<AnnouncementListDto> Items, int TotalCount)> GetAllAsync(int clubId, string status, string search, int page, int pageSize, int? districtId = null);
    Task<AnnouncementDetailDto?> GetByIdAsync(int id);
    Task<int> CreateAsync(int clubId, CreateAnnouncementDto dto, int createdBy, int? districtId = null);
    Task UpdateAsync(int id, UpdateAnnouncementDto dto, int modifiedBy);
    Task DeleteAsync(int id, int deletedBy);
    Task<string> UploadImageAsync(int clubId, IFormFile file);
}
