using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IBoardDirectorService
{
    Task<List<BoardDirectorDto>> GetByClubAsync(int clubId, int yearId);
    Task<BoardDirectorDto?> GetByIdAsync(int id);
    Task<List<BoardYearDto>> GetYearsByClubAsync(int clubId);
    Task<int> CreateAsync(int clubId, CreateBoardDirectorDto dto, int createdBy);
    Task UpdateAsync(int id, UpdateBoardDirectorDto dto, int modifiedBy);
    Task DeleteAsync(int id, int deletedBy);
    Task<List<ClubMemberSearchDto>> SearchClubMembersAsync(int clubId, string? search);
    Task ReorderAsync(int clubId, int yearId, List<int> orderedIds, int modifiedBy);
}
