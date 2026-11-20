using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IMobileAuthService
{
    Task<MobileVerifyOtpResponse> LoginWithPasswordAsync(MobilePasswordLoginDto dto);
    Task<MobileVerifyOtpResponse> IssueSessionForVerifiedMemberAsync(int memberId, MobileVerifyOtpDto dto, bool mustChangePassword);
    Task LogoutAsync(int memberId, string? imei);
    Task<MyContextResponse> GetMyContextAsync(int memberId, int? familyMemberId);
}
