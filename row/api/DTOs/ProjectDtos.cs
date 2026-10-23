namespace RotaryApi.DTOs;

public class ProjectListDto
{
    public int Id { get; set; }
    public int ClubId { get; set; }
    public int ModuleId { get; set; }
    public int YearId { get; set; }
    public string YearLabel { get; set; } = "";
    public string ProjectType { get; set; } = "";
    public int? ParentProjectId { get; set; }
    public string? OngoingGroupTitle { get; set; }
    public bool IsJointProject { get; set; }
    public string? CoHostName { get; set; }
    public string? ClubRole { get; set; }
    public string Title { get; set; } = "";
    public string? Location { get; set; }
    public string? AreaOfFocusName { get; set; }
    public string? OtherAreaOfFocus { get; set; }
    public DateTime? ProjectDate { get; set; }
    public decimal? ProjectCost { get; set; }
    public string Currency { get; set; } = RotaryApi.Services.Brand.DefaultCurrency;
    public string? FundingName { get; set; }
    public int? DirectBeneficiaries { get; set; }
    public string? MeetingType { get; set; }
    public int? Attendance { get; set; }
    public decimal? AttendancePercentage { get; set; }
    public bool IsActive { get; set; }
    public string? PrimaryPhotoPath { get; set; }
    public bool IsSendEmail { get; set; }
    public DateTime? EmailSentDate { get; set; }
    public int EmailSentCount { get; set; }
    public int EmailFailedCount { get; set; }
}

public class ProjectDetailDto
{
    public int Id { get; set; }
    public int ClubId { get; set; }
    public int ModuleId { get; set; }
    public int YearId { get; set; }
    public string YearLabel { get; set; } = "";
    public string ProjectType { get; set; } = "";
    public int? ParentProjectId { get; set; }
    public string? OngoingGroupTitle { get; set; }
    public bool IsJointProject { get; set; }
    public string? CoHostName { get; set; }
    public string? ClubRole { get; set; }
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    public string? Location { get; set; }
    public int? AreaOfFocusId { get; set; }
    public string? AreaOfFocusName { get; set; }
    public string? OtherAreaOfFocus { get; set; }
    public DateTime? ProjectDate { get; set; }
    public decimal? ProjectCost { get; set; }
    public string Currency { get; set; } = RotaryApi.Services.Brand.DefaultCurrency;
    public int? FundingId { get; set; }
    public string? FundingName { get; set; }
    public int? DirectBeneficiaries { get; set; }
    public int? ManHours { get; set; }
    public int? RotariansInvolved { get; set; }
    public int? RotaractorsInvolved { get; set; }
    // Rotary Community Corps members involved - optional, 0 when nothing was entered. Always sits
    // next to RotaractorsInvolved (user 2026-10-05).
    public int? RccInvolved { get; set; }
    public bool SendEmail { get; set; }
    public string? MeetingType { get; set; }
    public string? AgendaDocument { get; set; }
    public string? MinutesDocument { get; set; }
    public int? Attendance { get; set; }
    public decimal? AttendancePercentage { get; set; }

    // Funding-conditional fields (Global Grant / CSR)
    public string? GlobalGrantNumber { get; set; }
    public decimal? AmountSanctioned { get; set; }
    public decimal? AmountReceived { get; set; }
    public decimal? AmountSpent { get; set; }
    public string? HostClubsDistricts { get; set; }
    public string? GlobalPartnerClubsDistricts { get; set; }
    public string? CsrCompanyName { get; set; }

    public bool IsActive { get; set; }
    public List<ProjectPhotoDto> Photos { get; set; } = new();
}

public class ProjectPhotoDto
{
    public int Id { get; set; }
    public int ProjectId { get; set; }
    public string ImagePath { get; set; } = "";
    public string? Description { get; set; }
    public bool IsPrimary { get; set; }
    public int SortOrder { get; set; }
}

public class CreateProjectDto
{
    public int ModuleId { get; set; }
    public string ProjectType { get; set; } = "one_time";
    public int? ParentProjectId { get; set; }
    public string? OngoingGroupTitle { get; set; }
    public bool IsJointProject { get; set; }
    public string? CoHostName { get; set; }
    public string? ClubRole { get; set; }
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    public string? Location { get; set; }
    public int? AreaOfFocusId { get; set; }
    public string? OtherAreaOfFocus { get; set; }
    public DateTime? ProjectDate { get; set; }
    public decimal? ProjectCost { get; set; }
    public string? Currency { get; set; }
    public int? FundingId { get; set; }
    public int? DirectBeneficiaries { get; set; }
    public int? ManHours { get; set; }
    public int? RotariansInvolved { get; set; }
    public int? RotaractorsInvolved { get; set; }
    // Rotary Community Corps members involved - optional, 0 when nothing was entered. Always sits
    // next to RotaractorsInvolved (user 2026-10-05).
    public int? RccInvolved { get; set; }
    public bool SendEmail { get; set; }
    public string? MeetingType { get; set; }
    public string? AgendaDocument { get; set; }
    public string? MinutesDocument { get; set; }
    public int? Attendance { get; set; }
    public decimal? AttendancePercentage { get; set; }

    // Funding-conditional fields (Global Grant / CSR). Backend nulls out non-applicable ones based on funding name.
    public string? GlobalGrantNumber { get; set; }
    public decimal? AmountSanctioned { get; set; }
    public decimal? AmountReceived { get; set; }
    public decimal? AmountSpent { get; set; }
    public string? HostClubsDistricts { get; set; }
    public string? GlobalPartnerClubsDistricts { get; set; }
    public string? CsrCompanyName { get; set; }

    public List<ProjectPhotoInput>? Photos { get; set; }
}

public class UpdateProjectDto
{
    public string ProjectType { get; set; } = "one_time";
    public int? ParentProjectId { get; set; }
    public string? OngoingGroupTitle { get; set; }
    public bool IsJointProject { get; set; }
    public string? CoHostName { get; set; }
    public string? ClubRole { get; set; }
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    public string? Location { get; set; }
    public int? AreaOfFocusId { get; set; }
    public string? OtherAreaOfFocus { get; set; }
    public DateTime? ProjectDate { get; set; }
    public decimal? ProjectCost { get; set; }
    public string? Currency { get; set; }
    public int? FundingId { get; set; }
    public int? DirectBeneficiaries { get; set; }
    public int? ManHours { get; set; }
    public int? RotariansInvolved { get; set; }
    public int? RotaractorsInvolved { get; set; }
    // Rotary Community Corps members involved - optional, 0 when nothing was entered. Always sits
    // next to RotaractorsInvolved (user 2026-10-05).
    public int? RccInvolved { get; set; }
    public bool SendEmail { get; set; }
    public string? MeetingType { get; set; }
    public string? AgendaDocument { get; set; }
    public string? MinutesDocument { get; set; }
    public int? Attendance { get; set; }
    public decimal? AttendancePercentage { get; set; }

    // Funding-conditional fields (Global Grant / CSR). Backend nulls out non-applicable ones based on funding name.
    public string? GlobalGrantNumber { get; set; }
    public decimal? AmountSanctioned { get; set; }
    public decimal? AmountReceived { get; set; }
    public decimal? AmountSpent { get; set; }
    public string? HostClubsDistricts { get; set; }
    public string? GlobalPartnerClubsDistricts { get; set; }
    public string? CsrCompanyName { get; set; }

    public List<ProjectPhotoInput>? Photos { get; set; }
}

public class ProjectPhotoInput
{
    public string ImagePath { get; set; } = "";
    public string? Description { get; set; }
    public bool IsPrimary { get; set; }
    public int SortOrder { get; set; }
}

public class OngoingProjectDto
{
    public int Id { get; set; }
    public string Title { get; set; } = "";
}

public class ProjectPublicDto
{
    public int Id { get; set; }
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    public string? Location { get; set; }
    public string? AreaOfFocusName { get; set; }
    public string? OtherAreaOfFocus { get; set; }
    public DateTime? ProjectDate { get; set; }
    public decimal? ProjectCost { get; set; }
    public int? DirectBeneficiaries { get; set; }
    public string? PrimaryPhotoPath { get; set; }
}

public class ProjectYearDto
{
    public int Id { get; set; }
    public string YearLabel { get; set; } = "";
    public DateTime StartDate { get; set; }
    public DateTime EndDate { get; set; }
    public bool IsCurrent { get; set; }
}
