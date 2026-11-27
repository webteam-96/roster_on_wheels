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
    /// <summary>The currency of <see cref="Country"/>, for the Settings > Currency screen.</summary>
    public string? CountryCurrency => Services.CountryCurrency.Of(Country);
    /// <summary>IANA time zone (N12); null = the brand's zone.</summary>
    public string? Timezone { get; set; }
    public int TotalClubs { get; set; }
    public int TotalMembers { get; set; }
}

/// <summary>One district whose currency was set from its country.</summary>
public sealed record DistrictCurrencyChange(int Id, string DistrictNumber, string? From, string To);

public class DistrictDetailDto
{
    public int Id { get; set; }
    public string DistrictNumber { get; set; } = string.Empty;
    public string? DistrictLogoPath { get; set; }
    public bool IsActive { get; set; }
    // upstream 2026-10-21: false when the district or its zone is inactive (SuperAdmin sees it marked).
    public bool IsChainActive { get; set; } = true;
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
    public string? Country { get; set; } = "";
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
    public string? Country { get; set; } = "";
    public string? DefaultCurrency { get; set; }
    /// <summary>IANA time zone (N12); null = the brand's zone.</summary>
    public string? Timezone { get; set; }
}

public class UpdateDistrictCurrencyDto
{
    public string? DefaultCurrency { get; set; }
}
