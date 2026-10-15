using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IClubMonthlyReportService
{
    Task<List<MonthlyReportListDto>> GetMonthsAsync(int clubId, int yearId);
    Task<MonthlyReportDetailDto?> GetReportAsync(int clubId, int yearId, int month);
    Task<int> CreateOrGetReportAsync(int clubId, int yearId, int month, int createdBy);
    Task SaveMemberInfoAsync(int reportId, SaveMemberInfoDto dto, int modifiedBy);
    // Live member stats for a CMR month, derived from club_members (JoinedDate /
    // TerminationDate / isdeleted). Pre-fills the Members Info step.
    Task<ComputedMemberInfoDto> ComputeMemberInfoAsync(int clubId, int yearId, int month);
    Task<MonthlyReportPreviewDto> GetPreviewAsync(int clubId, int yearId, int month, int requestedBy);
    Task UploadToDistrictAsync(int reportId, int modifiedBy);
    Task<List<ReportYearDto>> GetYearsAsync(int clubId);
    Task<List<ReportMeetingDto>> GetMeetingsForMonthAsync(int clubId, int yearId, int month);
    Task<Dictionary<string, List<ReportProjectDto>>> GetProjectsForMonthAsync(int clubId, int yearId, int month);
    // Detailed rows (meetings + all 5 avenues) WITH photos, for the Word export.
    Task<List<CmrWordProjectDto>> GetWordProjectsForMonthAsync(int clubId, int yearId, int month);
    // Same, but for the whole rotary year — used by the Annual Report.
    Task<List<CmrWordProjectDto>> GetWordProjectsForYearAsync(int clubId, int yearId);
    Task<SendReportEmailResultDto> SendReportEmailAsync(int clubId, SendReportEmailDto dto);
}
