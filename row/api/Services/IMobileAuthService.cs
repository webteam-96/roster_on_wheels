using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IMobileAuthService
{
    Task<MobileRequestOtpResponse> RequestOtpAsync(MobileRequestOtpDto dto);
    Task<MobileVerifyOtpResponse> VerifyOtpAsync(MobileVerifyOtpDto dto);
    Task LogoutAsync(int memberId, string? imei);
    Task<MyContextResponse> GetMyContextAsync(int memberId, int? familyMemberId);
}
