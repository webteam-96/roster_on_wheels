using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IClubThemeService
{
    Task<ClubThemeDto?> GetByClubYearAsync(int clubId, int yearId);
    Task SaveAsync(int clubId, SaveClubThemeDto dto, int userId);
}
