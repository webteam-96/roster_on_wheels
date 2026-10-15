using Microsoft.AspNetCore.Http;

namespace RotaryApi.Services;

public interface IAuditLogService
{
    Task LogAsync(
        int memberId,
        string action,
        string entityType,
        int? entityId = null,
        string? entityName = null,
        object? details = null,
        HttpContext? httpContext = null);
}
