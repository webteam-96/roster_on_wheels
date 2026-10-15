using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IAuthService
{
    Task<LoginResponseDto> LoginAsync(LoginRequestDto request, string? ipAddress = null, string? userAgent = null);

    // Builds a full WEB login session (JWT + roles + scopes) for a member WITHOUT a password —
    // used by the mobile→web SSO handoff. Returns null if the member has no admin role.
    Task<LoginResponseDto?> BuildSessionForMemberAsync(int memberId);
    Task<(List<LoginAuditLogDto> items, int totalCount)> GetLoginLogsAsync(string search, string status, DateTime? fromDate, DateTime? toDate, int page, int pageSize);
    Task<object> ForgotPasswordAsync(ForgotPasswordRequestDto request);
    Task<object> ResetPasswordAsync(ResetPasswordRequestDto request);
    Task<object> ChangePasswordAsync(int memberId, ChangePasswordRequestDto request);
}
