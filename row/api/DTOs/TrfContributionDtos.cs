namespace RotaryApi.DTOs;

public class TrfFundDto
{
    public int Id { get; set; }
    public string FundName { get; set; } = "";
    public int SortOrder { get; set; }
    public bool IsActive { get; set; }
}

public class CreateTrfFundDto
{
    public string FundName { get; set; } = "";
    public int SortOrder { get; set; }
}

public class UpdateTrfFundDto
{
    public string FundName { get; set; } = "";
    public int SortOrder { get; set; }
    public bool IsActive { get; set; }
}

public class TrfContributionDto
{
    public int Id { get; set; }
    public int ClubId { get; set; }
    public int YearId { get; set; }
    public DateTime TrfDate { get; set; }
    public string DonorName { get; set; } = "";
    public decimal AmountUSD { get; set; }
    public int FundId { get; set; }
    public string FundType { get; set; } = "";
    public string? OtherFundName { get; set; }
}

public class CreateTrfContributionDto
{
    public int YearId { get; set; }
    public DateTime TrfDate { get; set; }
    public string DonorName { get; set; } = "";
    public decimal AmountUSD { get; set; }
    public int FundId { get; set; }
    public string? OtherFundName { get; set; }
}

public class UpdateTrfContributionDto
{
    public DateTime TrfDate { get; set; }
    public string DonorName { get; set; } = "";
    public decimal AmountUSD { get; set; }
    public int FundId { get; set; }
    public string? OtherFundName { get; set; }
}
