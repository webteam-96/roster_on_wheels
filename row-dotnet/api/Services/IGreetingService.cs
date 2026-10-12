using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IGreetingService
{
    Task<GreetingSettingsDto?> GetSettingsAsync(int clubId);
    Task UpdateSettingsAsync(int clubId, UpdateGreetingSettingsDto dto, int modifiedBy);
    Task<DistrictGreetingSettingsDto?> GetDistrictSettingsAsync(int districtId);
    Task UpdateDistrictSettingsAsync(int districtId, UpdateDistrictGreetingSettingsDto dto, int modifiedBy);
}
