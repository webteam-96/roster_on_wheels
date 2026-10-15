namespace RotaryApi.DTOs;

public class ZoneListDto
{
    public int Id { get; set; }
    public string ZoneName { get; set; } = string.Empty;
    public bool IsActive { get; set; }
    public DateTime? CreatedDate { get; set; }
    public int TotalDistricts { get; set; }
    public int TotalClubs { get; set; }
    public int TotalMembers { get; set; }
    public bool IsZonalAwardsEnabled { get; set; }
    public string? CoordinatorName { get; set; }
    public string? CoordinatorEmail { get; set; }
}

public class ZoneDetailDto
{
    public int Id { get; set; }
    public string ZoneName { get; set; } = string.Empty;
    public bool IsActive { get; set; }
    public int? CreatedBy { get; set; }
    public DateTime? CreatedDate { get; set; }
    public int? ModifiedBy { get; set; }
    public DateTime? ModifiedDate { get; set; }
    public int TotalDistricts { get; set; }
    public int TotalClubs { get; set; }
    public int TotalMembers { get; set; }
}

public class CreateZoneDto
{
    public string ZoneName { get; set; } = string.Empty;
    public bool IsActive { get; set; } = true;
}

public class UpdateZoneDto
{
    public string ZoneName { get; set; } = string.Empty;
    public bool IsActive { get; set; } = true;
}
