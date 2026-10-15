namespace RotaryApi.DTOs;

// Active row returned to the mobile app (slimmer payload — only what the
// app needs to decide whether to block + what message to display).
public class RouteMaintenanceActiveDto
{
    public string RouteKey { get; set; } = "";
    public bool IsUnderMaintenance { get; set; }
    public string? Message { get; set; }
    public DateTime? MaintenanceUntil { get; set; }
}

// Full row returned to admin (includes Label + ModifiedDate for the
// SuperAdmin switchboard UI).
public class RouteMaintenanceFullDto
{
    public int Id { get; set; }
    public string RouteKey { get; set; } = "";
    public string? Label { get; set; }
    public bool IsUnderMaintenance { get; set; }
    public string? Message { get; set; }
    public DateTime? MaintenanceUntil { get; set; }
    public DateTime? ModifiedDate { get; set; }
}

// Upsert body — the only mutation surface.
public class RouteMaintenanceUpsertDto
{
    public string RouteKey { get; set; } = "";
    public bool IsUnderMaintenance { get; set; }
    public string? Message { get; set; }
    public DateTime? MaintenanceUntil { get; set; }
}
