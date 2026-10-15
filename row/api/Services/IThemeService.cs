using Microsoft.AspNetCore.Http;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IThemeService
{
    Task<List<ThemeDto>> GetAllAsync();
    Task<int> CreateAsync(CreateThemeDto dto, int createdBy);
    Task UpdateAsync(int id, UpdateThemeDto dto, int modifiedBy);
    Task DeleteAsync(int id, int deletedBy);
    Task<string> UploadImageAsync(IFormFile file);
}
