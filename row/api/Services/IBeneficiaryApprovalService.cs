using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IBeneficiaryApprovalService
{
    Task<int> CreateApprovalRequestAsync(int projectId, int clubId, int requestedBeneficiaries, int currentLimit, int requestedBy);
    Task CancelPendingApprovalAsync(int projectId);
    Task<BeneficiaryApprovalDetailDto?> GetByTokenAsync(string token);
    Task<(string status, string result)> ApproveAsync(string token, string? remark);
    Task<(string status, string result)> RejectAsync(string token, string remark);
    Task<ZonalDashboardInfoDto?> GetZoneForMemberAsync(int memberId);
    Task<ZonalDashboardInfoDto?> GetZoneInfoByIdAsync(int zoneId);
    Task<(List<ApprovalListItemDto> items, int totalCount)> GetApprovalRequestsByZoneAsync(int zoneId, int districtId, int yearId, string? status, int page, int pageSize);
    Task<ZonalApprovalFiltersDto> GetZoneApprovalFiltersAsync(int zoneId);
    Task<List<ZonalDistrictDto>> GetZoneDistrictsAsync(int zoneId);
    Task<List<ZonalClubDto>> GetDistrictClubsAsync(int districtId);
    Task<(string status, string result)> ZonalApproveAsync(int approvalId, int zoneId, int memberId, string? remark, int? approvedBeneficiaries = null);
    Task<List<ApprovalHistoryItemDto>> GetApprovalHistoryAsync(int approvalId, int zoneId);
    Task<(string status, string result)> ZonalRejectAsync(int approvalId, int zoneId, int memberId, string remark);
}
