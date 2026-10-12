namespace RotaryApi.DTOs;

// Data-only filter options for a zone's beneficiary approvals + zone-wide status
// counts (across ALL years + ALL districts of the zone) for the top summary tiles.
public class ZonalApprovalFiltersDto
{
    public List<ZonalFilterYearDto> Years { get; set; } = new();
    public List<ZonalFilterDistrictDto> Districts { get; set; } = new();
    public ApprovalStatusCountsDto Counts { get; set; } = new();
}
public class ZonalFilterYearDto { public int Id { get; set; } public string Label { get; set; } = ""; public bool IsCurrent { get; set; } }
public class ZonalFilterDistrictDto { public int Id { get; set; } public string Number { get; set; } = ""; }
public class ApprovalStatusCountsDto { public int Pending { get; set; } public int Approved { get; set; } public int Rejected { get; set; } }

// One attempt in a project's approval history (a project may be submitted for approval
// multiple times). Ordered newest-first in the response.
public class ApprovalHistoryItemDto
{
    public int ApprovalId { get; set; }
    public int RequestedBeneficiaries { get; set; }
    public int? ApprovedBeneficiaries { get; set; }
    public string Status { get; set; } = "";
    public string? Remark { get; set; }
    public DateTime CreatedDate { get; set; }
    public DateTime? RespondedDate { get; set; }
    public string? RespondedByName { get; set; }
}

public class BeneficiaryApprovalRequestDto
{
    public int ProjectId { get; set; }
    public int RequestedBeneficiaries { get; set; }
    // pk_project_id is only unique WITHIN a year table (reused across years for different
    // clubs), so the caller MUST pass the club so the backend can resolve the zone
    // deterministically instead of scanning year tables by id alone. YearId is optional
    // (used to locate the correct year table for the email's photo URLs).
    public int ClubId { get; set; }
    public int YearId { get; set; }
}

public class BeneficiaryApprovalDetailDto
{
    public int Id { get; set; }
    public int ProjectId { get; set; }
    public int ZoneId { get; set; }
    public int ClubId { get; set; }
    public int RequestedBeneficiaries { get; set; }
    // The count the ZC actually approved (may differ from the requested one). Null when
    // pending/rejected or approved via the email link (which applies the requested count).
    public int? ApprovedBeneficiaries { get; set; }
    public int CurrentLimit { get; set; }
    public string ApprovalToken { get; set; } = "";
    public string Status { get; set; } = "";
    public string? Remark { get; set; }
    public int RequestedBy { get; set; }
    // Rotary year of the project (from its year-wise table) — used to pick that year's CP/CS.
    public int? YearId { get; set; }
    public DateTime? RespondedDate { get; set; }
    public DateTime CreatedDate { get; set; }
    public string ProjectTitle { get; set; } = "";
    public string? ProjectDescription { get; set; }
    public DateTime? ProjectDate { get; set; }
    public decimal? ProjectCost { get; set; }
    public int? CurrentBeneficiaries { get; set; }
    public int? ManHours { get; set; }
    public int? RotariansInvolved { get; set; }
    public int? RotaractorsInvolved { get; set; }
    // Rotary Community Corps members involved - optional, 0 when nothing was entered. Always sits
    // next to RotaractorsInvolved (user 2026-10-05).
    public int? RccInvolved { get; set; }
    public string ClubName { get; set; } = "";
    public string DistrictNumber { get; set; } = "";
    public string ZoneName { get; set; } = "";
    public string RequestedByName { get; set; } = "";
    public string RequestedByEmail { get; set; } = "";
    public string RequestedByMobile { get; set; } = "";
    public List<string> PhotoUrls { get; set; } = new();
}

public class ApprovalActionDto
{
    public int ApprovalId { get; set; }
    public string? Remark { get; set; }
    // Approve only: the beneficiary count the ZC actually approves (editable, pre-filled
    // with the requested amount). Null → apply the requested amount.
    public int? ApprovedBeneficiaries { get; set; }
}

public class ZonalDashboardInfoDto
{
    public int ZoneId { get; set; }
    public string ZoneName { get; set; } = "";
    public string ZoneCode { get; set; } = "";
}

public class ApprovalListItemDto
{
    public int Id { get; set; }
    public int ProjectId { get; set; }
    public int RequestedBeneficiaries { get; set; }
    public int CurrentLimit { get; set; }
    public string ApprovalToken { get; set; } = "";
    public string Status { get; set; } = "";
    public string? Remark { get; set; }
    public DateTime? RespondedDate { get; set; }
    public DateTime CreatedDate { get; set; }
    public string ProjectTitle { get; set; } = "";
    public DateTime? ProjectDate { get; set; }
    public string ClubName { get; set; } = "";
    public string DistrictNumber { get; set; } = "";
    public string RequestedByName { get; set; } = "";
}

public class ZonalDistrictDto
{
    public int Id { get; set; }
    public string DistrictNumber { get; set; } = "";
    public string DistrictName { get; set; } = "";
    public int TotalClubs { get; set; }
    public int TotalMembers { get; set; }
}

public class ZonalClubDto
{
    public int Id { get; set; }
    public string ClubName { get; set; } = "";
    public string ClubCode { get; set; } = "";
}
