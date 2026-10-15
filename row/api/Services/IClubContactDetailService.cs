using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IClubContactDetailService
{
    Task<List<ClubContactDetailDto>> GetByClubAsync(int clubId, int yearId);
    Task<ClubContactDetailDto?> GetByIdAsync(int id);
    Task<int> CreateAsync(int clubId, CreateClubContactDetailDto dto, int createdBy);
    Task UpdateAsync(int id, UpdateClubContactDetailDto dto, int modifiedBy);
    Task DeleteAsync(int id, int deletedBy);
}
