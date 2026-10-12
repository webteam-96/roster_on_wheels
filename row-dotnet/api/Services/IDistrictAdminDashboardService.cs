using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IDistrictAdminDashboardService
{
    // All public methods accept an optional `requestedDistrictId` so multi-district
    // admins can scope the request to a specific district. When null, falls back
    // to the legacy LIMIT 1 district resolution for backward compat.
    Task<DistrictAdminOverviewResponse?> GetOverviewAsync(int memberId, int? yearId, int? requestedDistrictId = null);
    Task<DistrictAdminMembershipResponse?> GetMembershipAsync(int memberId, int? yearId, int? requestedDistrictId = null);
    Task<DistrictAdminFoundationResponse?> GetFoundationAsync(int memberId, int? yearId, int? requestedDistrictId = null);
    Task<DistrictAdminCommunicationResponse?> GetCommunicationAsync(int memberId, int? yearId, int? requestedDistrictId = null);
    Task<DistrictAdminEGovernanceResponse?> GetEGovernanceAsync(int memberId, int? yearId, int? requestedDistrictId = null);

    // ── Sub-endpoints (Wave 13A2) ───────────────────────────────────────
    // Paginated Member Directory for Membership page.
    Task<DistrictAdminDirectoryPagedResponse?> GetMembershipDirectoryAsync(
        int memberId, int? yearId, int page, int pageSize, string? search,
        int? requestedDistrictId = null);

    // District-wide Rotary Network (Terminated + Potential members across every club).
    Task<DistrictAdminRotaryNetworkResponse?> GetRotaryNetworkAsync(
        int memberId, int? yearId, string? search, int? clubId,
        int? requestedDistrictId = null);

    // Live Rotary.org terminated members for ONE club (fast path when the club filter is
    // active) — writes through to rotary_org_terminated_cache.
    Task<DistrictAdminLiveTerminatedResponse> GetLiveTerminatedMembersAsync(
        int memberId, int? requestedDistrictId, int? clubId);

    // Resolves memberId -> the district this admin manages, for callers (like the background
    // refresh job endpoints) that need the same resolution rules without pulling in a whole
    // dashboard response.
    Task<int> ResolveDistrictIdForMemberAsync(int memberId, int? requestedDistrictId);

    // Per-club CMR grid drill (E-Governance > CMR sub-tab).
    Task<DistrictAdminCmrPerClubGridResponse?> GetEGovernancePerClubGridAsync(
        int memberId, int? yearId, int? requestedDistrictId = null);

    // ─── Wave 13A3 — DG goal-setting + AG-feeding endpoints ─────────────
    // GET methods scope district from member_roles (legacy LIMIT 1 if no
    // requestedDistrictId), POST methods require active District Admin
    // assignment at the requested district (else UnauthorizedAccessException → 403).

    Task<DistrictMembershipGoalDto?> GetMembershipGoalAsync(int memberId, int? yearId, int? requestedDistrictId = null);
    Task<DistrictMembershipGoalDto> UpsertMembershipGoalAsync(int memberId, DistrictMembershipGoalDto dto);

    Task<DistrictFoundationGoalDto?> GetFoundationGoalAsync(int memberId, int? yearId, int? requestedDistrictId = null);
    Task<DistrictFoundationGoalDto> UpsertFoundationGoalAsync(int memberId, DistrictFoundationGoalDto dto);

    Task<List<DistrictProjectTargetDto>> GetProjectTargetsAsync(int memberId, int? yearId, int? requestedDistrictId = null);
    Task<List<DistrictProjectTargetDto>> UpsertProjectTargetsAsync(int memberId, DistrictProjectTargetsBulkRequest req);

    // Club-scoped (DG authorizes by validating the club's district matches a DA assignment).
    Task<ClubAwardStatusDto?> GetClubAwardStatusAsync(int memberId, int clubId, int? yearId);
    Task<ClubAwardStatusDto> UpsertClubAwardStatusAsync(int memberId, ClubAwardStatusDto dto);

    Task<ClubMyRotaryTrackingDto?> GetClubMyRotaryAsync(int memberId, int clubId, int? yearId);
    Task<ClubMyRotaryTrackingDto> UpsertClubMyRotaryAsync(int memberId, ClubMyRotaryTrackingDto dto);
}
