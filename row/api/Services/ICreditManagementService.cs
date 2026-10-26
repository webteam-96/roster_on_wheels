using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface ICreditManagementService
{
    Task<(List<CreditListDto> Items, int TotalCount)> GetCreditsAsync(int? districtId, int? clubId, string? creditType, string? status, int page, int pageSize);
    Task<int> AddCreditAsync(AddCreditDto dto, IFormFile? proofDocument, int userId, IWebHostEnvironment env);
    Task UpdateCreditAsync(int id, UpdateCreditDto dto, IFormFile? proofDocument, int userId, IWebHostEnvironment env);
    Task DeleteCreditAsync(int id, int userId);
    Task<CreditBalanceDto> GetClubCreditBalanceAsync(int clubId, bool isDistrict = false);
    Task DeductCreditAsync(int clubId, string creditType, int count, bool isDistrict = false);
    Task<List<CreditNotificationDto>> CheckExpiringCreditsAsync(int clubId);
    Task<bool> HasSufficientCreditsAsync(int clubId, string creditType, int count, bool isDistrict = false);
    Task DeductWithHistoryAsync(int clubId, string creditType, int count, string source, int? sourceId, string? sourceDetail, int userId, bool isDistrict = false);
    Task DeductDistrictWithHistoryAsync(int districtId, string creditType, int count, string source, int? sourceId, string? sourceDetail, int userId);
    Task<List<CreditUsageHistoryDto>> GetUsageHistoryAsync(int? clubId, int? districtId, string? creditType, int page, int pageSize);
    Task<int> GetDeductedAmountAsync(int clubId, string creditType, string source, int sourceId, bool isDistrict = false);
    Task RefundWithHistoryAsync(int clubId, string creditType, int count, string source, int? sourceId, string? sourceDetail, int userId, bool isDistrict = false);
    Task<CreditBalanceDto> GetDistrictCreditBalanceAsync(int districtId);
}
