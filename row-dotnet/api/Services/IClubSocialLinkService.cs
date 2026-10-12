using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IClubSocialLinkService
{
    Task<List<ClubSocialLinkDto>> GetByClubAsync(int clubId);
    Task<ClubSocialLinkDto?> GetByIdAsync(int id);
    Task<int> CreateAsync(int clubId, CreateClubSocialLinkDto dto, int createdBy);
    Task UpdateAsync(int id, UpdateClubSocialLinkDto dto, int modifiedBy);
    Task DeleteAsync(int id, int deletedBy);
}
