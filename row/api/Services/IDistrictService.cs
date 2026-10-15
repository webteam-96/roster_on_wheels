using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IDistrictService
{
    Task<PagedResult<DistrictListDto>> GetAllAsync(int page, int pageSize, string? search, int? isActive, int? zoneId = null, bool? hasClubs = null, bool? hasMembers = null, bool? hasSyncClubs = null);
    Task<DistrictDetailDto?> GetByIdAsync(int id);
    Task<int> CreateAsync(CreateDistrictDto dto, int createdBy);
    Task UpdateAsync(int id, UpdateDistrictDto dto, int modifiedBy);
    Task UpdateDefaultCurrencyAsync(int id, string? defaultCurrency, int modifiedBy);
    Task DeleteAsync(int id, int deletedBy);
    Task<IEnumerable<ClubListDto>> GetClubsAsync(int districtId, bool? hasMembers = null, bool excludeRotaract = false);
    Task<PagedResult<DistrictMemberDto>> GetMembersAsync(int districtId, int page, int pageSize, string? search);
    Task<string> UploadLogoAsync(IFormFile file);
}
