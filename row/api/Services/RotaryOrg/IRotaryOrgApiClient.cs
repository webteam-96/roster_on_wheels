namespace RotaryApi.Services.RotaryOrg;

/// <summary>
/// Thin HTTP client for Rotary International's Data Integration API
/// (https://api.rotary.org:8443/v1.1). Handles authentication + token caching.
/// </summary>
public interface IRotaryOrgApiClient
{
    /// <summary>
    /// Returns a valid Bearer token. Uses cached token if still valid, else re-authenticates.
    /// </summary>
    Task<string> GetTokenAsync(CancellationToken ct = default);

    /// <summary>
    /// Forces a fresh authentication, ignoring the cached token. Used on 401.
    /// </summary>
    Task<string> ReauthenticateAsync(CancellationToken ct = default);

    /// <summary>
    /// GET /v1.1/clubs — returns all clubs authorized to this participant.
    /// </summary>
    Task<List<RotaryOrgClubListDto>> GetClubsAsync(CancellationToken ct = default);

    /// <summary>
    /// GET /v1.1/clubs/{clubType}/{clubId}?summary=false — full club detail with addresses.
    /// </summary>
    Task<RotaryOrgClubDetailDto?> GetClubDetailAsync(string clubType, int clubId, CancellationToken ct = default);

    /// <summary>
    /// GET /v1.1/Clubs/search?country=&type=Rotary Club — country-scoped clubs with district number string.
    /// </summary>
    Task<List<RotaryOrgClubSearchDto>> SearchClubsByCountryAsync(string country, CancellationToken ct = default);

    /// <summary>
    /// GET /v1.1/clubs/{type}/{id}/members/0/1500/Active — active members for one club.
    /// </summary>
    Task<List<RotaryOrgClubMemberDto>> GetClubMembersAsync(string clubType, int clubId, CancellationToken ct = default);

    /// Club officers for a date range (startDate/endDate as MM/DD/YYYY), from
    /// /clubs/{type}/{id}/officers?startDate=..&endDate=.. — used by the Club Officers (From RI) report.
    Task<List<RotaryOrgClubOfficerDto>> GetClubOfficersAsync(string clubType, int clubId, string startDate, string endDate, CancellationToken ct = default);

    /// <summary>
    /// GET /v1.1/clubs/{type}/{id}/members/0/1500/Honorary — honorary members for one club.
    /// The /Active endpoint excludes honorary members, so this is fetched separately.
    /// Non-fatal on any error (returns empty list).
    /// </summary>
    Task<List<RotaryOrgClubMemberDto>> GetClubHonoraryMembersAsync(string clubType, int clubId, CancellationToken ct = default);

    /// <summary>
    /// GET /v1.1/clubs/{type}/{id}/members/terminated — terminated (former) members
    /// for one club. The response shape matches GetClubMembersAsync (same DTO);
    /// TerminationDate and TerminationReason fields are populated.
    /// Used for display only — results are NEVER persisted to our DB.
    /// </summary>
    Task<List<RotaryOrgClubMemberDto>> GetClubTerminatedMembersAsync(string clubType, int clubId, CancellationToken ct = default);

    /// <summary>
    /// GET /v1.1/individuals/{id}/profile — full member profile with Address[]/Phone[]/Email[].
    /// </summary>
    Task<RotaryOrgIndividualProfileResponse?> GetIndividualProfileAsync(long memberId, CancellationToken ct = default);
}
