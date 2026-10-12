using System.Text.Json;
using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

public class AuditLogService : IAuditLogService
{
    private readonly string _connectionString;
    private readonly ILogger<AuditLogService> _logger;

    public AuditLogService(IConfiguration configuration, ILogger<AuditLogService> logger)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _logger = logger;
    }

    public async Task LogAsync(
        int memberId,
        string action,
        string entityType,
        int? entityId = null,
        string? entityName = null,
        object? details = null,
        HttpContext? httpContext = null)
    {
        try
        {
            using var conn = new MySqlConnection(_connectionString);
            await conn.OpenAsync();

            // Resolve member name + primary role for quick display in viewer
            var memberInfo = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
                SELECT MemberName FROM member_master_profile WHERE pk_member_master_profile_id = @Id",
                new { Id = memberId });

            // Primary role: pick the highest-privilege active role for display purposes
            var roleName = await conn.ExecuteScalarAsync<string?>(@"
                SELECT r.RoleName
                FROM member_roles mr
                JOIN roles r ON r.pk_role_id = mr.fk_role_id
                WHERE mr.fk_member_master_profile_id = @Id
                  AND mr.IsActive = 1 AND mr.isdeleted = 0
                ORDER BY CASE r.RoleName
                    WHEN 'SuperAdmin' THEN 1
                    WHEN 'RIDirector' THEN 2
                    WHEN 'ZonalCoordinator' THEN 3
                    WHEN 'Admin' THEN 4
                    WHEN 'AG' THEN 5
                    WHEN 'ClubModerator' THEN 6
                    ELSE 99
                END ASC
                LIMIT 1",
                new { Id = memberId });

            var detailsJson = details == null ? null : JsonSerializer.Serialize(details);

            string? ipAddress = httpContext?.Connection.RemoteIpAddress?.ToString();
            string? userAgent = httpContext?.Request.Headers.UserAgent.ToString();
            if (userAgent != null && userAgent.Length > 500) userAgent = userAgent.Substring(0, 500);

            await conn.ExecuteAsync(@"
                INSERT INTO audit_log
                    (fk_member_master_profile_id, member_name, role_name, action, entity_type,
                     entity_id, entity_name, details, ip_address, user_agent)
                VALUES (@MemberId, @MemberName, @RoleName, @Action, @EntityType,
                        @EntityId, @EntityName, @Details, @Ip, @Ua)",
                new
                {
                    MemberId = memberId,
                    MemberName = (string?)memberInfo?.MemberName,
                    RoleName = roleName,
                    Action = action,
                    EntityType = entityType,
                    EntityId = entityId,
                    EntityName = entityName,
                    Details = detailsJson,
                    Ip = ipAddress,
                    Ua = userAgent
                });
        }
        catch (Exception ex)
        {
            // Audit logging must never break the primary operation
            _logger.LogError(ex, "Failed to write audit log entry: {Action} {Entity}", action, entityType);
        }
    }
}
