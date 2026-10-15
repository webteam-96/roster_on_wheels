namespace RotaryOrgSyncWorker.Services;

public interface IRotaryOrgApiClient
{
    Task<string> GetTokenAsync(CancellationToken ct = default);
    Task<string> ReauthenticateAsync(CancellationToken ct = default);
    Task<List<RotaryOrgClubListDto>> GetClubsAsync(CancellationToken ct = default);
    Task<RotaryOrgClubDetailDto?> GetClubDetailAsync(string clubType, int clubId, CancellationToken ct = default);
    /// <summary>
    /// GET /v1.1/clubs/updates?startDate=MM-DD-YYYY&amp;endDate=MM-DD-YYYY — returns clubs whose
    /// data changed in that window. Used by the nightly delta sync.
    /// </summary>
    Task<List<RotaryOrgClubListDto>> GetClubUpdatesAsync(DateTime startDate, DateTime endDate, CancellationToken ct = default);

    /// <summary>
    /// GET /v1.1/Clubs/search?searchterm=(type=country:value=&lt;country&gt;)&amp;searchterm=(type=ClubType:value=Rotary Club)
    /// Returns ALL Rotary clubs in the given country (regardless of sync permission). Used by weekly country sync.
    /// </summary>
    Task<List<RotaryOrgClubSearchDto>> SearchClubsByCountryAsync(string country, CancellationToken ct = default);

    /// <summary>
    /// GET /v1.1/individuals/updates?startDate=MM-dd-yyyy&amp;endDate=MM-dd-yyyy
    /// Returns CHANGE NOTIFICATIONS (MemberId + EntityType) — NOT full member data.
    /// Same MemberId may appear multiple times if multiple entity types changed.
    /// </summary>
    Task<List<RotaryOrgMemberUpdateNotificationDto>> GetMemberUpdateNotificationsAsync(DateTime startDate, DateTime endDate, CancellationToken ct = default);

    /// <summary>
    /// GET /v1.1/individuals/{memberId} — full member detail (name, club, dates, contact info, etc.)
    /// </summary>
    Task<RotaryOrgMemberDto?> GetMemberDetailAsync(long memberId, CancellationToken ct = default);

    /// <summary>
    /// GET /v1.1/clubs/{clubType}/{clubId}/members/{offset}/{limit}/Active — paginated active member list.
    /// Used by the per-club member sweep to ADD new, UPDATE existing, and SOFT-DELETE terminated members.
    /// </summary>
    Task<List<RotaryOrgClubMemberDto>> GetClubMembersAsync(string clubType, int clubId, CancellationToken ct = default);

    /// <summary>
    /// GET /v1.1/clubs/{clubType}/{clubId}/members/0/1500/Honorary — honorary members
    /// (filtered out of /Active endpoint by Rotary.org). Non-fatal on 404.
    /// </summary>
    Task<List<RotaryOrgClubMemberDto>> GetClubHonoraryMembersAsync(string clubType, int clubId, CancellationToken ct = default);

    /// <summary>
    /// GET /v1.1/clubs/{clubType}/{clubId}/members/terminated — historical terminations.
    /// Same MemberId can appear MULTIPLE TIMES (joined → terminated → rejoined → terminated again).
    /// Caller MUST dedupe by MemberId (keep MAX(TerminationDate)).
    /// TerminationDate + TerminationReason are populated; other fields may be sparse.
    /// </summary>
    Task<List<RotaryOrgClubMemberDto>> GetClubTerminatedMembersAsync(string clubType, int clubId, CancellationToken ct = default);

    /// <summary>
    /// GET /v1.1/individuals/{memberId}/profile — full member profile (DOB, gender, language, contact info).
    /// Use this when ADDing a new member to get the full data set.
    /// </summary>
    Task<RotaryOrgIndividualProfileResponse?> GetIndividualProfileAsync(long memberId, CancellationToken ct = default);

    /// <summary>
    /// GET /v1.1/clubs/{clubType}/{clubId}/officers?startDate=07/01/{fromYear}&amp;endDate=06/30/{fromYear+1}
    /// Returns the BOD/officer list for a club for the given Rotary year (Jul 1 → Jun 30).
    /// Used by --bod-sync to populate designation_master and board_of_directors.
    /// </summary>
    Task<List<RotaryOrgClubOfficerDto>> GetClubOfficersAsync(string clubType, int clubId, int fromYear, CancellationToken ct = default);

    /// <summary>
    /// GET /v1.1/clubs/{clubType}/{clubId}/officers?startDate=07/01/{fromYear}&amp;endDate=06/30/{toYear+1}
    /// Wide-range variant: returns ALL officers between fromYear's July 1 and toYear+1's June 30 in
    /// a single call. --bod-sync uses this to pull a club's entire officer history at once and then
    /// derives each officer's Rotary year from its own StartDate/EndDate — instead of one call per year.
    /// </summary>
    Task<List<RotaryOrgClubOfficerDto>> GetClubOfficersAsync(string clubType, int clubId, int fromYear, int toYear, CancellationToken ct = default);

    /// <summary>
    /// Diagnostic — returns the RAW JSON body from /clubs/{clubType}/{clubId}/members.
    /// Used by --probe-club-members to inspect actual API response shape.
    /// </summary>
    Task<(int StatusCode, string Body)> GetClubMembersRawAsync(string clubType, int clubId, CancellationToken ct = default);

    /// <summary>
    /// Generic GET to any path on the Rotary.org API, with auto-auth. Used for diagnostic probes.
    /// </summary>
    Task<(int StatusCode, string Body)> GetRawAsync(string path, CancellationToken ct = default);
}
