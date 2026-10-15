using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class RouteMaintenanceService : IRouteMaintenanceService
{
    private readonly string _connectionString;

    public RouteMaintenanceService(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    // Mobile app reads only the rows currently flagged on — keeps the
    // payload small (the catalog can grow to ~200+ rows over time).
    public async Task<List<RouteMaintenanceActiveDto>> GetActiveAsync()
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var rows = await conn.QueryAsync<RouteMaintenanceActiveDto>(@"
            SELECT
                RouteKey            AS RouteKey,
                IsUnderMaintenance  AS IsUnderMaintenance,
                Message             AS Message,
                MaintenanceUntil    AS MaintenanceUntil
            FROM route_maintenance
            WHERE IsUnderMaintenance = 1
            ORDER BY RouteKey");

        return rows.AsList();
    }

    // Admin reads ALL rows so the SuperAdmin switchboard can render the
    // full catalog (Auth & System rows show as locked).
    public async Task<List<RouteMaintenanceFullDto>> GetAllAsync()
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var rows = await conn.QueryAsync<RouteMaintenanceFullDto>(@"
            SELECT
                pk_route_maintenance_id AS Id,
                RouteKey                AS RouteKey,
                Label                   AS Label,
                IsUnderMaintenance      AS IsUnderMaintenance,
                Message                 AS Message,
                MaintenanceUntil        AS MaintenanceUntil,
                modified_date           AS ModifiedDate
            FROM route_maintenance
            ORDER BY RouteKey");

        return rows.AsList();
    }

    // Upsert by RouteKey. The unique index on RouteKey lets us flip flags
    // for routes that exist in the seed AND for routes the spec hasn't
    // covered yet (future-proof).
    public async Task UpsertAsync(RouteMaintenanceUpsertDto dto, int modifiedBy)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        await conn.ExecuteAsync(@"
            INSERT INTO route_maintenance
                (RouteKey, IsUnderMaintenance, Message, MaintenanceUntil, modified_by)
            VALUES
                (@RouteKey, @IsUnderMaintenance, @Message, @MaintenanceUntil, @ModifiedBy)
            ON DUPLICATE KEY UPDATE
                IsUnderMaintenance = VALUES(IsUnderMaintenance),
                Message            = VALUES(Message),
                MaintenanceUntil   = VALUES(MaintenanceUntil),
                modified_by        = VALUES(modified_by),
                modified_date      = CURRENT_TIMESTAMP",
            new
            {
                dto.RouteKey,
                IsUnderMaintenance = dto.IsUnderMaintenance ? 1 : 0,
                dto.Message,
                dto.MaintenanceUntil,
                ModifiedBy = modifiedBy
            });
    }
}
