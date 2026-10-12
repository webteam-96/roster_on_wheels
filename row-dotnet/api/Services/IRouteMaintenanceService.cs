using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IRouteMaintenanceService
{
    Task<List<RouteMaintenanceActiveDto>> GetActiveAsync();
    Task<List<RouteMaintenanceFullDto>> GetAllAsync();
    Task UpsertAsync(RouteMaintenanceUpsertDto dto, int modifiedBy);
}
