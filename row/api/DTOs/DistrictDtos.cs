namespace RotaryApi.DTOs;

public class DistrictListDto
{
    public int Id { get; set; }
    public string DistrictNumber { get; set; } = string.Empty;
    public string? DistrictLogoPath { get; set; }
    public bool IsActive { get; set; }
    public DateTime? CreatedDate { get; set; }
    public int? FkZoneId { get; set; }
    public string? ZoneName { get; set; }
    public string? Country { get; set; }
    public string? DefaultCurrency { get; set; }
    /// <summary>IANA time zone (N12); null = the brand's zone.</summary>
    public string? Timezone { get; set; }
    public int TotalClubs { get; set; }
    public int TotalMembers { get; set; }
}

public class DistrictDetailDto
{
    public int Id { get; set; }
    public string DistrictNumber { get; set; } = string.Empty;
    public string? DistrictLogoPath { get; set; }
    public bool IsActive { get; set; }
    public int? CreatedBy { get; set; }
    public DateTime? CreatedDate { get; set; }
    public int? ModifiedBy { get; set; }
    public DateTime? ModifiedDate { get; set; }
    public int? FkZoneId { get; set; }
    public string? ZoneName { get; set; }
    public string? Country { get; set; }
    public string? DefaultCurrency { get; set; }
    /// <summary>IANA time zone (N12); null = the brand's zone.</summary>
    public string? Timezone { get; set; }
    public int TotalClubs { get; set; }
    public int TotalMembers { get; set; }
}

public class CreateDistrictDto
{
    public string DistrictNumber { get; set; } = string.Empty;
    public string? DistrictLogoPath { get; set; }
    public bool IsActive { get; set; } = true;
    public int? FkZoneId { get; set; }
    public string? Country { get; set; } = "India";
    public string? DefaultCurrency { get; set; }
    /// <summary>IANA time zone (N12); null = the brand's zone.</summary>
    public string? Timezone { get; set; }
}

public class UpdateDistrictDto
{
    public string DistrictNumber { get; set; } = string.Empty;
    public string? DistrictLogoPath { get; set; }
    public bool IsActive { get; set; } = true;
    public int? FkZoneId { get; set; }
    public string? Country { get; set; } = "India";
    public string? DefaultCurrency { get; set; }
    /// <summary>IANA time zone (N12); null = the brand's zone.</summary>
    public string? Timezone { get; set; }
}

public class UpdateDistrictCurrencyDto
{
    public string? DefaultCurrency { get; set; }
}
