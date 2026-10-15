using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IAgDashboardService
{
    // All multi-club AG endpoints accept an optional `requestedClubId` so the caller
    // can scope the dashboard to a single club within the AG's assignments. When
    // null, the full set of the AG's clubs is returned (legacy behavior).
    //
    // Wave 9G: `requestedDistrictId` further restricts the AG's clubs to those whose
    // `club_master.fk_district_id` matches — used by the District picker in the
    // dashboard topbar when an AG is assigned to clubs in 2+ districts.
    // Years for the global topbar picker — only years where the AG's OWN clubs have data.
    Task<AgAvailableYearsResponse> GetAvailableYearsAsync(int memberId, int? districtId = null);

    // Full detail + photos for one project (AG projects popup). Null when the project
    // doesn't exist or isn't in one of this AG's clubs. yearId picks the year table.
    Task<AgProjectDetailDto?> GetProjectDetailAsync(int memberId, int projectId, int? yearId, int? districtId = null);

    Task<AgClubsResponse> GetClubsAsync(int memberId, int? yearId, int? requestedClubId = null, int? requestedDistrictId = null);

    // ClubDetail always requires an explicit clubId (single-club drill-down).
    Task<AgClubDetailResponse?> GetClubDetailAsync(int memberId, int clubId, int? yearId);

    Task<AgMembershipResponse> GetMembershipAsync(int memberId, int? yearId, int? requestedClubId = null, int? requestedDistrictId = null);
    Task<AgTrfResponse> GetTrfAsync(int memberId, int? yearId, int? requestedClubId = null, int? requestedDistrictId = null);
    Task<AgExcellenceResponse> GetExcellenceAsync(int memberId, int? yearId, int? requestedClubId = null, int? requestedDistrictId = null);
    Task<AgYouthResponse> GetYouthAsync(int memberId, int? yearId, int? requestedClubId = null, int? requestedDistrictId = null);
    Task<AgProjectsResponse> GetProjectsAsync(int memberId, int? yearId, int? requestedClubId = null, int? requestedDistrictId = null);
    Task<AgDistrictResponse> GetDistrictAsync(int memberId, int? yearId, int? requestedClubId = null, int? requestedDistrictId = null);
}
