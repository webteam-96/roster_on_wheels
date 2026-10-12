using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IClubAboutService
{
    Task<List<ClubAboutDto>> GetByClubAsync(int clubId);
    Task<ClubAboutDto?> GetByIdAsync(int id);
    Task<int> CreateAsync(int clubId, CreateClubAboutDto dto, int createdBy);
    Task UpdateAsync(int id, UpdateClubAboutDto dto, int modifiedBy);
    Task DeleteAsync(int id, int deletedBy);
    Task<string> UploadImageAsync(IFormFile file);
}
