using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface ICashfreeKycService
{
    Task<IEnumerable<CashfreeKycListDto>> GetAllAsync();
    Task<string> SendOtpAsync(); // Returns success message, sends email
    Task<CashfreeKycListDto> VerifyOtpAndSaveAsync(CashfreeVerifyOtpDto dto, int userId);
    Task DeleteAsync(int kycId, int userId);
    Task ToggleActiveAsync(int kycId, int userId);
    Task<CashfreeVendorDetailDto> GetVendorDetailAsync(int kycId);
    Task<int> RefreshAllStatusAsync(int userId);
    Task<string> RefreshVendorStatusAsync(int kycId, int userId);
    Task<int> SyncVendorFromCashfreeAsync(string vendorId, int userId);
}
