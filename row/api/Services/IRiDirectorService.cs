using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IRiDirectorService
{
    Task<RiDirectorContextDto> GetContextAsync();

    // Credits
    Task<RiCreditBalanceDto> GetCreditBalanceAsync();
    Task<(List<RiCreditListDto> Items, int TotalCount)> GetCreditsAsync(string? creditType, int page, int pageSize);
    Task<int> AddCreditAsync(RiAddCreditDto dto, IFormFile? proof, int userId, IWebHostEnvironment env);
    Task DeductCreditWithHistoryAsync(string creditType, int count, string source, int? sourceId, string? sourceDetail, int userId);
    Task<bool> HasSufficientCreditsAsync(string creditType, int count);
    Task<int> GetDeductedAmountAsync(string creditType, string source, int sourceId);
    Task RefundCreditWithHistoryAsync(string creditType, int count, string source, int? sourceId, string? sourceDetail, int userId);
    Task<(List<RiCreditUsageHistoryDto> Items, int TotalCount)> GetUsageHistoryAsync(string? creditType, int page, int pageSize);

    // Announcements (RI-scoped)
    Task<(List<AnnouncementListDto> Items, int TotalCount)> GetAnnouncementsAsync(string? status, string? search, int page, int pageSize);
    Task<AnnouncementDetailDto?> GetAnnouncementByIdAsync(int id);
    Task<int> CreateAnnouncementAsync(CreateAnnouncementDto dto, int createdBy);
    Task UpdateAnnouncementAsync(int id, UpdateAnnouncementDto dto, int modifiedBy);
    Task DeleteAnnouncementAsync(int id, int deletedBy);
    Task<string> UploadAnnouncementImageAsync(IFormFile file);

    // Recipient helpers (member count by selection)
    Task<int> GetRecipientCountAsync(string channel, string target, int[]? zoneIds, int[]? districtIds, int[]? subgroupIds = null);

    // Upcoming Events (RI-scoped)
    Task<(List<UpcomingEventListDto> Items, int TotalCount)> GetUpcomingEventsAsync(string? status, string? search, int page, int pageSize);
    Task<UpcomingEventDetailDto?> GetUpcomingEventByIdAsync(int id);
    Task<int> CreateUpcomingEventAsync(CreateUpcomingEventDto dto, int createdBy);
    Task UpdateUpcomingEventAsync(int id, UpdateUpcomingEventDto dto, int modifiedBy);
    Task DeleteUpcomingEventAsync(int id, int deletedBy);
    Task<string> UploadUpcomingEventImageAsync(IFormFile file);

    // Sub Groups (RI-scoped, year-scoped)
    Task<List<RiSubGroupListDto>> GetSubGroupsAsync(int? yearId = null);
    Task<List<RiSubGroupYearDto>> GetSubGroupYearsAsync();
    Task<RiSubGroupDetailDto?> GetSubGroupByIdAsync(int id);
    Task<int> CreateSubGroupAsync(RiCreateSubGroupDto dto, int createdBy);
    Task UpdateSubGroupAsync(int id, RiCreateSubGroupDto dto, int modifiedBy);
    Task DeleteSubGroupAsync(int id, int deletedBy);
    Task<List<RiAvailableMemberDto>> GetAvailableMembersAsync(string? search);

    // Mass Emails (RI-scoped)
    Task<(List<MassEmailListDto> Items, int TotalCount)> GetMassEmailsAsync(string? status, string? search, int page, int pageSize);
    Task<RiMassEmailDetailDto?> GetMassEmailByIdAsync(int id);
    Task<int> CreateMassEmailAsync(RiCreateMassEmailDto dto, int createdBy);
    Task UpdateMassEmailAsync(int id, RiCreateMassEmailDto dto, int modifiedBy);
    Task DeleteMassEmailAsync(int id, int deletedBy);
    Task SendMassEmailAsync(int id, int userId);

    // Web Links (RI-scoped)
    Task<List<RiWeblinkListDto>> GetWeblinksAsync();
    Task<RiWeblinkListDto?> GetWeblinkByIdAsync(int id);
    Task<int> CreateWeblinkAsync(RiCreateWeblinkDto dto, int createdBy);
    Task UpdateWeblinkAsync(int id, RiCreateWeblinkDto dto, int modifiedBy);
    Task DeleteWeblinkAsync(int id, int deletedBy);

    // Documents (RI-scoped)
    Task<(List<DocumentListDto> Items, int TotalCount)> GetDocumentsAsync(string? status, string? search, int page, int pageSize);
    Task<DocumentDetailDto?> GetDocumentByIdAsync(int id);
    Task<int> CreateDocumentAsync(CreateDocumentDto dto, int createdBy);
    Task UpdateDocumentAsync(int id, UpdateDocumentDto dto, int modifiedBy);
    Task DeleteDocumentAsync(int id, int deletedBy);
    Task<(string Path, string OriginalName)> UploadDocumentFileAsync(IFormFile file);

    // Newsletters (RI-scoped)
    Task<(List<NewsletterListDto> Items, int TotalCount)> GetNewslettersAsync(string? status, string? search, int page, int pageSize);
    Task<NewsletterDetailDto?> GetNewsletterByIdAsync(int id);
    Task<int> CreateNewsletterAsync(RiCreateNewsletterDto dto, int createdBy);
    Task UpdateNewsletterAsync(int id, RiCreateNewsletterDto dto, int modifiedBy);
    Task DeleteNewsletterAsync(int id, int deletedBy);
    Task<string> UploadNewsletterFileAsync(IFormFile file);

    // Reports (XLSX)
    Task<byte[]> GetReportZonesXlsxAsync();
    Task<byte[]> GetReportDistrictsXlsxAsync();
    Task<byte[]> GetReportClubsXlsxAsync();
    Task<byte[]> GetReportMembersXlsxAsync();
    Task<byte[]> GetReportCommunicationsXlsxAsync();
}
