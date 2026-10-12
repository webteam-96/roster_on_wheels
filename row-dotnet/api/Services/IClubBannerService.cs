using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IClubBannerService
{
    Task<List<ClubBannerDto>> GetByClubAsync(int clubId, int yearId);
    Task<ClubBannerDto?> GetByIdAsync(int id);
    Task<int> CreateAsync(int clubId, CreateClubBannerDto dto, int createdBy);
    Task UpdateAsync(int id, UpdateClubBannerDto dto, int modifiedBy);
    Task DeleteAsync(int id, int deletedBy);
    Task ReorderAsync(int id1, int id2);
    Task<string> UploadImageAsync(IFormFile file);
    Task<string> UploadDocumentAsync(IFormFile file);
}
