using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IWebsiteDataModuleService
{
    Task<List<WebsiteDataModuleDto>> GetAllAsync();
    Task<int> CreateAsync(CreateWebsiteDataModuleDto dto, int createdBy);
    Task UpdateAsync(int id, UpdateWebsiteDataModuleDto dto, int modifiedBy);
    Task DeleteAsync(int id, int deletedBy);
    Task SwapOrderAsync(int id1, int id2);
}
