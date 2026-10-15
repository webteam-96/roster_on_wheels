using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IZoneService
{
    Task<PagedResult<ZoneListDto>> GetAllAsync(int page, int pageSize, string? search, int? isActive);
    Task<ZoneDetailDto?> GetByIdAsync(int id);
    Task<int> CreateAsync(CreateZoneDto dto, int createdBy);
    Task UpdateAsync(int id, UpdateZoneDto dto, int modifiedBy);
    Task DeleteAsync(int id, int deletedBy);
}
