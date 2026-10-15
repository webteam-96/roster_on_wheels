using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IPotentialMemberService
{
    Task<PagedResult<PotentialMemberDto>> GetByClubAsync(int clubId, int page, int pageSize, string? search);
    Task<PotentialMemberDto?> GetByIdAsync(int id);
    Task<int> CreateAsync(int clubId, CreatePotentialMemberDto dto, int createdBy);
    Task UpdateAsync(int id, UpdatePotentialMemberDto dto, int modifiedBy);
    Task DeleteAsync(int id, int deletedBy);
}
