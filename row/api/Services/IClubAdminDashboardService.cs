using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IClubAdminDashboardService
{
    // All public methods accept an optional `requestedClubId` so multi-club admins
    // can scope the request to a specific club. When null, the service falls back
    // to its legacy LIMIT 1 club resolution for backward compat.
    Task<ClubAdminOverviewResponse?> GetOverviewAsync(int memberId, int? yearId, int? requestedClubId = null);
    Task<ClubAdminFoundationResponse?> GetFoundationAsync(int memberId, int? yearId, int? requestedClubId = null);
    Task<ClubAdminMembershipResponse?> GetMembershipAsync(int memberId, int? yearId, int? requestedClubId = null);
    Task<ClubAdminAvenueResponse?> GetAvenueAsync(int memberId, int? yearId, int? requestedClubId = null);
    Task<ClubAdminEGovernanceResponse?> GetEGovernanceAsync(int memberId, int? yearId, int? requestedClubId = null);
    Task<ClubAdminCommunicationResponse?> GetCommunicationAsync(int memberId, int? yearId, int? requestedClubId = null);
    Task<ClubAdminWebsiteResponse?> GetWebsiteAsync(int memberId, int? yearId, int? requestedClubId = null);
    Task<ClubAdminPaymentsResponse?> GetPaymentsAsync(int memberId, int? yearId, int? requestedClubId = null);

    // Dashboard sub-tabs (Phase B)
    Task<ClubAdminDashboardDirectoryResponse?> GetDashboardDirectoryAsync(int memberId, int? yearId, int? requestedClubId = null);
    Task<ClubAdminDashboardBodResponse?> GetDashboardBodAsync(int memberId, int? yearId, int? requestedClubId = null);
    Task<ClubAdminDashboardRotaryNetworkResponse?> GetDashboardRotaryNetworkAsync(int memberId, int? yearId, int? requestedClubId = null);

    // Service Projects & Public Image (Phase C)
    Task<ServiceProjectsOverviewResponse?> GetServiceProjectsOverviewAsync(int memberId, int? yearId, int? requestedClubId = null);
    Task<ServiceProjectsAvenueDetailResponse?> GetServiceProjectsAvenueDetailAsync(int memberId, string avenueKey, int? yearId, int? requestedClubId = null);

    // Powers the global year dropdown in the dashboard topbar.
    // Returns ONLY years for which this club actually has data — per the
    // data-only year-dropdown rule. Also returns the resolved currentYearId so
    // the frontend can default to it when no ?yearId= is in the URL.
    Task<ClubAdminAvailableYearsResponse?> GetAvailableYearsAsync(int memberId, int? requestedClubId = null);
}
