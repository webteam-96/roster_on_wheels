using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IMemberService
{
    Task<PagedResult<MemberListDto>> GetAllAsync(int page, int pageSize, string? search, string? bloodGroup, string? gender);
    Task<MemberDetailDto?> GetByIdAsync(int id, int? clubId = null);
    Task<int> CreateAsync(CreateMemberDto dto);
    Task UpdateAsync(int id, UpdateMemberDto dto);
    Task DeleteAsync(int id);
    Task<string> UploadPhotoAsync(IFormFile file, string type);
}
