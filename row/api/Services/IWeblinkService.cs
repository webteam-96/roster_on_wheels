using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IWeblinkService
{
    Task<IEnumerable<WeblinkListDto>> GetWeblinksAsync(int clubId, int? parentId = null, int? districtId = null);
    Task<List<WeblinkTreeDto>> GetWeblinkTreeAsync(int clubId, int? districtId = null);
    Task<WeblinkListDto> CreateWeblinkAsync(int clubId, CreateWeblinkDto dto, IFormFile? logo, IFormFile? banner, IFormFile? pdf, int userId, IWebHostEnvironment env, int? districtId = null);
    Task<WeblinkListDto> UpdateWeblinkAsync(int clubId, int weblinkId, UpdateWeblinkDto dto, IFormFile? logo, IFormFile? banner, IFormFile? pdf, int userId, IWebHostEnvironment env, int? districtId = null);
    Task DeleteWeblinkAsync(int weblinkId, int userId);
    Task ToggleActiveAsync(int weblinkId, int userId);
}
