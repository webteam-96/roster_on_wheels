namespace RotaryApi.DTOs;

// Service hours and contributions: Services/ServiceHoursService.cs, Controllers/ServiceHoursController.cs.

public class SaveServiceHoursDto
{
    public int ClubId { get; set; }
    public int? ProjectId { get; set; }               // a project of the Rotary year of ServiceDate; null: other service
    public string? OtherService { get; set; }         // required when ProjectId is null
    public DateTime ServiceDate { get; set; }
    public decimal Hours { get; set; }
    public string? Note { get; set; }
}

public class ServiceHoursEntryDto
{
    public int Id { get; set; }
    public string Source { get; set; } = "logged";    // logged | volunteer (hours recorded on a volunteer sheet)
    public int MemberId { get; set; }
    public string MemberName { get; set; } = "";
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public int YearId { get; set; }
    public int? ProjectId { get; set; }
    public string? ProjectTitle { get; set; }
    public string? OtherService { get; set; }
    public DateTime ServiceDate { get; set; }
    public decimal Hours { get; set; }
    public string? Note { get; set; }
    public string? PhotoPath { get; set; }
    public string Status { get; set; } = "pending";   // pending | approved | rejected
    public string? ReviewNote { get; set; }
    public DateTime? ReviewedAt { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class ReviewServiceHoursDto
{
    public bool Approve { get; set; }
    public string? Note { get; set; }
}

public class ServiceProjectOptionDto
{
    public int Id { get; set; }
    public string Title { get; set; } = "";
    public DateTime? Date { get; set; }
    public string? Currency { get; set; }
}

/// <summary>A club the member may log hours for, with the projects of the Rotary year of the chosen date.</summary>
public class ServiceHoursClubOptionDto
{
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public int? YearId { get; set; }
    public List<ServiceProjectOptionDto> Projects { get; set; } = new();
}

public class MyServiceHoursDto
{
    public List<ServiceHoursEntryDto> Entries { get; set; } = new();
    public List<ServiceYearTotalDto> Years { get; set; } = new();
}

public class ServiceYearTotalDto
{
    public int YearId { get; set; }
    public string YearLabel { get; set; } = "";
    public decimal ApprovedHours { get; set; }
    public decimal PendingHours { get; set; }
    public decimal VolunteerHours { get; set; }
}

public class SaveContributionDto
{
    public int ProjectId { get; set; }
    public int YearId { get; set; }
    public string Kind { get; set; } = "cash";        // cash | in_kind
    public decimal Amount { get; set; }
    public string? Contributor { get; set; }
    public string? Description { get; set; }
    public DateTime ContributionDate { get; set; }
}

public class ContributionDto
{
    public int Id { get; set; }
    public int YearId { get; set; }
    public int ProjectId { get; set; }
    public string? ProjectTitle { get; set; }
    public string Kind { get; set; } = "cash";
    public decimal Amount { get; set; }
    public string? Currency { get; set; }
    public string? Contributor { get; set; }
    public string? Description { get; set; }
    public DateTime ContributionDate { get; set; }
}

public class MoneyDto
{
    public string Currency { get; set; } = "";
    public decimal Amount { get; set; }
}

public class ServiceYearOptionDto
{
    public int Id { get; set; }
    public string Label { get; set; } = "";
}

public class ServiceProjectReportRowDto
{
    public int? ProjectId { get; set; }               // null: other service (no project)
    public string Title { get; set; } = "";
    public int? ProjectManHours { get; set; }         // man_hours as typed on the project
    public decimal Hours { get; set; }                // approved logged hours
    public decimal VolunteerHours { get; set; }
    public int Members { get; set; }
    public List<MoneyDto> Cash { get; set; } = new();
    public List<MoneyDto> InKind { get; set; } = new();
}

public class ServiceMemberReportRowDto
{
    public int MemberId { get; set; }
    public string Name { get; set; } = "";
    public decimal Hours { get; set; }
    public decimal VolunteerHours { get; set; }
    public int Entries { get; set; }
}

public class ServiceClubReportRowDto
{
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public decimal Hours { get; set; }
    public decimal VolunteerHours { get; set; }
    public int Members { get; set; }
    public List<MoneyDto> Cash { get; set; } = new();
    public List<MoneyDto> InKind { get; set; } = new();
}

public class ServiceTotalsDto
{
    public decimal Hours { get; set; }
    public decimal VolunteerHours { get; set; }
    public int Members { get; set; }
    public int PendingEntries { get; set; }
    public List<MoneyDto> Cash { get; set; } = new();
    public List<MoneyDto> InKind { get; set; } = new();
}

public class ServiceReportDto
{
    public int YearId { get; set; }
    public string YearLabel { get; set; } = "";
    public string ScopeName { get; set; } = "";
    public List<ServiceYearOptionDto> Years { get; set; } = new();
    public List<ServiceProjectReportRowDto> ByProject { get; set; } = new();   // club report
    public List<ServiceMemberReportRowDto> ByMember { get; set; } = new();     // club report
    public List<ServiceClubReportRowDto> ByClub { get; set; } = new();         // district report
    public ServiceTotalsDto Totals { get; set; } = new();
}
