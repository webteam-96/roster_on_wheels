using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IClubService
{
    Task<PagedResult<ClubListDto>> GetAllAsync(int page, int pageSize, string? search, int? districtId, string? city, string? meetingDay, int? isActive, int? zoneId = null);
    Task<ClubDetailDto?> GetByIdAsync(int id);
    Task<int> CreateAsync(CreateClubDto dto, int createdBy);
    Task UpdateAsync(int id, UpdateClubDto dto, int modifiedBy);
    Task DeleteAsync(int id, int deletedBy);
    Task<PagedResult<ClubMemberDto>> GetMembersAsync(int clubId, int page, int pageSize, string? search, int? year = null,
        string? email = null, string? rotaryId = null, string? districtNumber = null, string? designation = null,
        string? classification = null, string? familyMemberName = null, int? viewerMemberId = null);
    Task<List<int>> GetMemberDesignationYearsAsync(int clubId);
    Task<(string? DistrictNumber, string? YearLabel)> GetCogDesignationAsync(int clubId, int memberId);
    Task<bool> UpdateCogDesignationAsync(int clubId, int memberId, string districtNumber, string yearLabel, int modifiedBy);
    Task<int> AddMemberAsync(int clubId, AddClubMemberDto dto, int createdBy);
    Task RemoveMemberAsync(int clubId, int memberId, int deletedBy, string? terminationReason = null);
    Task<MemberRemovalPreviewDto?> GetMemberRemovalPreviewAsync(int clubId, int memberId);
    Task<string> UploadLogoAsync(IFormFile file);
    Task<string> UploadClubLogoToGroupAsync(IFormFile file);
    Task<string> UploadRotaryLogoToGroupAsync(int clubId, IFormFile file);
    Task<(string? ClubLogo, string? RotaryLogo)> GetLogosAsync(int clubId);
    Task SetLogosAsync(int clubId, string? clubLogoPath, string? rotaryLogoPath, int modifiedBy);
    Task<PagedResult<TerminatedMemberDto>> GetTerminatedMembersAsync(int clubId, int page, int pageSize, string? search);
}
