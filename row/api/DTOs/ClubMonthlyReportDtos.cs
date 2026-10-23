namespace RotaryApi.DTOs;

// Listing page item
public class MonthlyReportListDto
{
    public int? ReportId { get; set; }
    public int Month { get; set; }
    public string MonthName { get; set; } = "";
    public bool IsCreated { get; set; }
    public DateTime? CreatedDate { get; set; }
    public DateTime? ModifiedDate { get; set; }
    public bool IsUploadedToDistrict { get; set; }
}

// Full report for editing/viewing
public class MonthlyReportDetailDto
{
    public int ReportId { get; set; }
    public int ClubId { get; set; }
    public int YearId { get; set; }
    public int ReportMonth { get; set; }
    public int MemberCountLastMonth { get; set; }
    public int MembersDeleted { get; set; }
    public int MembersAdded { get; set; }
    public int CurrentMemberCount { get; set; }
    public string? AdditionalRemarks { get; set; }
    public bool IsUploadedToDistrict { get; set; }
    public string? AssistantGovernor { get; set; }
    public DateTime? CreatedDate { get; set; }
    public DateTime? ModifiedDate { get; set; }
    public List<TrfEntryDto> TrfEntries { get; set; } = new();
}

// TRF entry
public class TrfEntryDto
{
    public int TrfId { get; set; }
    public DateTime TrfDate { get; set; }
    public string DonorName { get; set; } = "";
    public decimal AmountUSD { get; set; }
    public string FundType { get; set; } = "";
    public string? OtherFundName { get; set; }
}

// Create/Update TRF entry
public class SaveTrfEntryDto
{
    public int? TrfId { get; set; }
    public DateTime TrfDate { get; set; }
    public string DonorName { get; set; } = "";
    public decimal AmountUSD { get; set; }
    public string FundType { get; set; } = "";
    public string? OtherFundName { get; set; }
}

// Save member info (step 4)
public class SaveMemberInfoDto
{
    public int MemberCountLastMonth { get; set; }
    public int MembersDeleted { get; set; }
    public int MembersAdded { get; set; }
    public string? AdditionalRemarks { get; set; }
}

// Auto-computed member stats for a CMR month, derived live from club_members.
// memberCountLastMonth = active members as at the report month's opening midnight
// (joined before the 1st, not terminated by then); membersDeleted/membersAdded =
// terminations / joins that fall WITHIN the report month. Used to pre-fill the
// Members Info step (still editable by the admin before save).
public class ComputedMemberInfoDto
{
    public int MemberCountLastMonth { get; set; }
    public int MembersDeleted { get; set; }
    public int MembersAdded { get; set; }
    public int CurrentMemberCount { get; set; }
}

// Meeting for the report display
public class ReportMeetingDto
{
    public int ProjectId { get; set; }
    public string Title { get; set; } = "";
    public string? MeetingType { get; set; }
    public string? ProjectDate { get; set; }
    public int? Attendance { get; set; }
    public decimal? AttendancePercentage { get; set; }
}

// Project for the report display
public class ReportProjectDto
{
    public int ProjectId { get; set; }
    public string Title { get; set; } = "";
    public string? ProjectType { get; set; }
    public int? ParentProjectId { get; set; }
    public string? ProjectDate { get; set; }
    public string? AreaOfFocusName { get; set; }
    public decimal? ProjectCost { get; set; }
    public int? DirectBeneficiaries { get; set; }
    public int? ManHours { get; set; }
    public int? RotariansInvolved { get; set; }
    public int? RotaractorsInvolved { get; set; }
    // Rotary Community Corps members involved - optional, 0 when nothing was entered. Always sits
    // next to RotaractorsInvolved (user 2026-10-05).
    public int? RccInvolved { get; set; }
}

// Report preview - full report data
public class MonthlyReportPreviewDto
{
    public int ReportId { get; set; }
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public string? ClubCode { get; set; }
    public int YearId { get; set; }
    public string YearLabel { get; set; } = "";
    public int ReportMonth { get; set; }
    public string MonthName { get; set; } = "";
    public DateTime? ReportDate { get; set; }
    public string? PreparedBy { get; set; }
    public string? Designation { get; set; }
    public string? AssistantGovernor { get; set; }
    public int MemberCountLastMonth { get; set; }
    public int MembersDeleted { get; set; }
    public int MembersAdded { get; set; }
    public int CurrentMemberCount { get; set; }
    public int TotalMeetings { get; set; }
    public decimal AverageAttendance { get; set; }
    public decimal TrfCurrentMonth { get; set; }
    public decimal TrfThisYear { get; set; }
    public string? AdditionalRemarks { get; set; }
    public bool IsUploadedToDistrict { get; set; }
    public DateTime? UploadedToDistrictDate { get; set; }
    public List<ReportMeetingDto> Meetings { get; set; } = new();
    public List<TrfEntryDto> TrfEntries { get; set; } = new();
    public Dictionary<string, List<ReportProjectDto>> Projects { get; set; } = new();
}

// Year dropdown item
public class ReportYearDto
{
    public int Id { get; set; }
    public string YearLabel { get; set; } = "";
    public bool IsCurrent { get; set; }
}

// Send report email request
public class SendReportEmailDto
{
    public string PdfBase64 { get; set; } = "";
    public int YearId { get; set; }
    public int Month { get; set; }
    public string MonthName { get; set; } = "";
    public string ClubName { get; set; } = "";
    public string YearLabel { get; set; } = "";
}

// Send report email response
public class SendReportEmailResultDto
{
    public List<string> SentTo { get; set; } = new();
    public List<string> Warnings { get; set; } = new();
}

// ── Detailed Word export ─────────────────────────────────────────────────────
// Rich per-project/meeting row (with photos) for the downloadable Word report.
public class CmrWordProjectDto
{
    public int ProjectId { get; set; }
    public string ModuleKey { get; set; } = "";        // club_service | community_service | ...
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    public string? Location { get; set; }
    public string? ProjectDate { get; set; }
    public string? MeetingType { get; set; }
    public string? AreaOfFocusName { get; set; }
    public string? OtherAreaOfFocus { get; set; }
    public decimal? ProjectCost { get; set; }
    public string? FundingName { get; set; }
    public int? DirectBeneficiaries { get; set; }
    public int? ManHours { get; set; }
    public int? RotariansInvolved { get; set; }
    public int? RotaractorsInvolved { get; set; }
    // Rotary Community Corps members involved - optional, 0 when nothing was entered. Always sits
    // next to RotaractorsInvolved (user 2026-10-05).
    public int? RccInvolved { get; set; }
    public int? Attendance { get; set; }
    public decimal? AttendancePercentage { get; set; }
    public bool IsJointProject { get; set; }
    public string? CoHostName { get; set; }
    public string? AgendaDocument { get; set; }
    public string? MinutesDocument { get; set; }
    public List<CmrWordPhotoDto> Photos { get; set; } = new();
}

public class CmrWordPhotoDto
{
    public int ProjectId { get; set; }                 // used to group photos to projects
    public string ImagePath { get; set; } = "";        // resolved /Documents/gallery/... path
    public string? Description { get; set; }
    public bool IsPrimary { get; set; }
    public int SortOrder { get; set; }
    // Populated by the controller before the doc is built (disk-first, then media host).
    public byte[]? ImageBytes { get; set; }
    public string? ImageExtension { get; set; }         // jpg | png | gif | ...
}
