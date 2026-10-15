using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IAreaOfFocusService
{
    Task<List<AreaOfFocusDto>> GetAllAsync(int? moduleId = null);
    Task<AreaOfFocusDto?> GetByIdAsync(int id);
    Task<int> CreateAsync(CreateAreaOfFocusDto dto, int createdBy);
    Task UpdateAsync(int id, UpdateAreaOfFocusDto dto, int modifiedBy);
    Task DeleteAsync(int id, int deletedBy);
    Task<string> UploadImageAsync(IFormFile file);
}
