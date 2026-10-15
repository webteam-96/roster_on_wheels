namespace RotaryApi.Services;

public interface IProjectApprovalService
{
    Task<(bool hasModerator, string? moderatorName)> GetModeratorInfoAsync(int clubId);
    // yearId is optional but STRONGLY preferred when the caller already
    // knows it (CreateAsync / UpdateAsync do). Passing it lets the service
    // skip the cross-year FindByProjectIdAsync scan, which has a race window
    // immediately after INSERT when the new pooled connection may not yet
    // see the just-inserted row → ResolveAsync returns null → silent skip
    // (root cause of "approval_status stays NULL + moderator email never
    // sent" bug observed in Wave 17). When yearId is null we fall back to
    // the legacy cross-year scan.
    Task SetPendingApprovalAsync(int projectId, int clubId, int moduleId, int createdBy, int? yearId = null);
    Task<object?> GetByTokenAsync(string token);
    Task<(bool success, string message)> ApproveByTokenAsync(string token, string? remark);
    Task<(bool success, string message)> RejectByTokenAsync(string token, string remark);
    Task<(bool success, string message)> ModeratorApproveAsync(int projectId, int memberId, string? remark, int? yearId = null);
    Task<(bool success, string message)> ModeratorRejectAsync(int projectId, int memberId, string remark, int? yearId = null);
    Task<object?> GetProjectDetailForModeratorAsync(int projectId, int memberId, int? yearId = null);
    Task<List<object>> GetYearSummaryAsync(int memberId);
    Task<(List<object> items, int totalCount)> GetProjectsForModeratorAsync(int memberId, int yearId, string? status, int page, int pageSize, string? moduleKey = null);
}
