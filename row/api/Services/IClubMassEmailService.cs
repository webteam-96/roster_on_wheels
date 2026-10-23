using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IClubMassEmailService
{
    Task<(List<MassEmailListDto> Items, int TotalCount)> GetListAsync(int clubId, string? status, string? search, int page, int pageSize, int? districtId = null);
    Task<MassEmailDetailDto?> GetDetailAsync(int id);
    // True when campaign id belongs to the club (clubId) or the district (districtId) named in the URL.
    Task<bool> BelongsToAsync(int id, int? clubId, int? districtId);
    Task<int> CreateAsync(int clubId, CreateMassEmailDto dto, int userId, int? districtId = null);
    Task UpdateAsync(int id, CreateMassEmailDto dto, int userId);
    Task DeleteAsync(int id, int userId);
    Task SendAsync(int id, int userId);
    Task<List<MassEmailRecipientDto>> GetRecipientsAsync(int id);
    Task<RecipientCountDto> GetRecipientCountAsync(int clubId, int recipientType, List<int>? subgroupIds, List<int>? memberIds, int? districtId = null, List<int>? clubIds = null, List<int>? contactGroupIds = null);
}
