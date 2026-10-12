using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IClubAdvertisementService
{
    Task<List<ClubAdvertisementDto>> GetByClubAsync(int clubId, int yearId);
    Task<ClubAdvertisementDto?> GetByIdAsync(int id);
    Task<int> CreateAsync(int clubId, CreateClubAdvertisementDto dto, int createdBy);
    Task UpdateAsync(int id, UpdateClubAdvertisementDto dto, int modifiedBy);
    Task DeleteAsync(int id, int deletedBy);
    Task ReorderAsync(int id1, int id2);
    Task<string> UploadImageAsync(IFormFile file);
    Task<string> UploadDocumentAsync(IFormFile file);
}
