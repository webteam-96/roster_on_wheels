using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface ISystemSettingService
{
    Task<SystemSettingDto?> GetSettingAsync(string key);
    Task UpsertSettingAsync(UpsertSettingDto dto, int modifiedBy);
    Task<List<SystemSettingDto>> GetAllSettingsAsync();
}
