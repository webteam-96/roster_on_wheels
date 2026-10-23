using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.DTOs;
using RotaryApi.Services;
using RotaryApi.Services.RotaryOrg;
using Dapper;
using System.Security.Claims;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/club-admin-dashboard")]
[Authorize]
public class ClubAdminDashboardController : ControllerBase
{
    private readonly IClubAdminDashboardService _service;
    private readonly IConfiguration _configuration;
    private readonly IRotaryOrgApiClient _rotaryOrgClient;
    public ClubAdminDashboardController(
        IClubAdminDashboardService service,
        IConfiguration configuration,
        IRotaryOrgApiClient rotaryOrgClient)
    {
        _service = service;
        _configuration = configuration;
        _rotaryOrgClient = rotaryOrgClient;
    }

    private string ConnectionString =>
        _configuration.GetConnectionString("DefaultConnection") ?? "";

    private int GetMemberId()
    {
        var id = User.FindFirst("memberId")?.Value ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        return int.TryParse(id, out var x) ? x : 0;
    }

    private bool IsAuthorisedRole()
    {
        var roles = User.FindFirst("roles")?.Value ?? "";
        return roles.Contains("Admin") || roles.Contains("SuperAdmin");
    }

    private ActionResult NotConfigured() =>
        NotFound(new { message = "No club admin assignment found for this user." });

    // Translate the service's UnauthorizedAccessException into a clean 403 so the
    // frontend can show a "you do not have access to this club" message.
    private ObjectResult ForbidWithMessage(string message)
        => StatusCode(StatusCodes.Status403Forbidden, new { message });

    // Powers the global year dropdown in the dashboard topbar. Returns only the
    // years where THIS club has any data — projects (legacy + year-bound), BOD,
    // attendance, TRF, club_monthly_report — plus the current year always.
    [HttpGet("available-years")]
    public async Task<ActionResult<ClubAdminAvailableYearsResponse>> AvailableYears([FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try
        {
            var r = await _service.GetAvailableYearsAsync(GetMemberId(), clubId);
            return r == null ? NotConfigured() : Ok(r);
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("overview")]
    public async Task<ActionResult<ClubAdminOverviewResponse>> Overview([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try
        {
            var r = await _service.GetOverviewAsync(GetMemberId(), yearId, clubId);
            return r == null ? NotConfigured() : Ok(r);
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("foundation")]
    public async Task<ActionResult<ClubAdminFoundationResponse>> Foundation([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try
        {
            var r = await _service.GetFoundationAsync(GetMemberId(), yearId, clubId);
            return r == null ? NotConfigured() : Ok(r);
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("membership")]
    public async Task<ActionResult<ClubAdminMembershipResponse>> Membership([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try
        {
            var r = await _service.GetMembershipAsync(GetMemberId(), yearId, clubId);
            return r == null ? NotConfigured() : Ok(r);
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("avenue")]
    public async Task<ActionResult<ClubAdminAvenueResponse>> Avenue([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try
        {
            var r = await _service.GetAvenueAsync(GetMemberId(), yearId, clubId);
            return r == null ? NotConfigured() : Ok(r);
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("egovernance")]
    public async Task<ActionResult<ClubAdminEGovernanceResponse>> EGovernance([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try
        {
            var r = await _service.GetEGovernanceAsync(GetMemberId(), yearId, clubId);
            return r == null ? NotConfigured() : Ok(r);
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("communication")]
    public async Task<ActionResult<ClubAdminCommunicationResponse>> Communication([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try
        {
            var r = await _service.GetCommunicationAsync(GetMemberId(), yearId, clubId);
            return r == null ? NotConfigured() : Ok(r);
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("website")]
    public async Task<ActionResult<ClubAdminWebsiteResponse>> Website([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try
        {
            var r = await _service.GetWebsiteAsync(GetMemberId(), yearId, clubId);
            return r == null ? NotConfigured() : Ok(r);
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("payments")]
    public async Task<ActionResult<ClubAdminPaymentsResponse>> Payments([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try
        {
            var r = await _service.GetPaymentsAsync(GetMemberId(), yearId, clubId);
            return r == null ? NotConfigured() : Ok(r);
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    // ── Dashboard sub-tabs (Phase B) ────────────────────────────────────

    [HttpGet("dashboard-directory")]
    public async Task<ActionResult<ClubAdminDashboardDirectoryResponse>> DashboardDirectory([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try
        {
            var r = await _service.GetDashboardDirectoryAsync(GetMemberId(), yearId, clubId);
            return r == null ? NotConfigured() : Ok(r);
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("dashboard-bod")]
    public async Task<ActionResult<ClubAdminDashboardBodResponse>> DashboardBod([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try
        {
            var r = await _service.GetDashboardBodAsync(GetMemberId(), yearId, clubId);
            return r == null ? NotConfigured() : Ok(r);
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("dashboard-rotary-network")]
    public async Task<ActionResult<ClubAdminDashboardRotaryNetworkResponse>> DashboardRotaryNetwork([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try
        {
            var r = await _service.GetDashboardRotaryNetworkAsync(GetMemberId(), yearId, clubId);
            return r == null ? NotConfigured() : Ok(r);
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    // ── Service Projects & Public Image (Phase C) ────────────────────────

    [HttpGet("service-projects-overview")]
    public async Task<ActionResult<ServiceProjectsOverviewResponse>> ServiceProjectsOverview([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try
        {
            var r = await _service.GetServiceProjectsOverviewAsync(GetMemberId(), yearId, clubId);
            return r == null ? NotConfigured() : Ok(r);
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("service-projects-avenue")]
    public async Task<ActionResult<ServiceProjectsAvenueDetailResponse>> ServiceProjectsAvenue(
        [FromQuery] string avenueKey, [FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try
        {
            var r = await _service.GetServiceProjectsAvenueDetailAsync(GetMemberId(), avenueKey ?? "", yearId, clubId);
            return r == null ? NotConfigured() : Ok(r);
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    // Live fetch of terminated members from Rotary.org for the requested club.
    // The user explicitly asked for display-only — NEVER persist these to our DB
    // (per user feedback 2026-06-12, item #2). The dashboard rotary-network page
    // calls this for the Terminated view; we resolve the club's Rotary.org id
    // and clubType from club_master and proxy the call.
    [HttpGet("rotary-org-terminated-members")]
    public async Task<ActionResult> RotaryOrgTerminatedMembers([FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try
        {
            using var conn = new MySqlConnection(ConnectionString);
            await conn.OpenAsync();

            // Resolve which club to query — same precedence as the dashboard methods.
            var memberId = GetMemberId();
            int resolvedClubId = clubId ?? 0;
            if (resolvedClubId == 0)
            {
                resolvedClubId = await conn.ExecuteScalarAsync<int?>(@"
                    SELECT fk_club_id FROM member_roles
                    WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 2
                      AND IsActive = 1 AND isdeleted = 0 ORDER BY pk_member_role_id ASC LIMIT 1",
                    new { MemberId = memberId }) ?? 0;
            }
            // A club named in the query: only the people who manage it (names, mobiles and emails follow).
            else if (!await ScopeWriteGuardMiddleware.AllowedAsync(ConnectionString, memberId, true, resolvedClubId))
                return ForbidWithMessage("You are not an active admin for this club.");
            if (resolvedClubId == 0) return NotConfigured();
            // A club named in the query must be one this user manages (was: any club, contacts included).
            if (clubId is > 0 && !await ScopeWriteGuardMiddleware.AllowedAsync(ConnectionString, memberId, true, resolvedClubId))
                return ForbidWithMessage("You do not have access to this club.");

            // Read the Rotary.org club id (string in our DB; int at Rotary.org)
            // plus the club type string ("Rotary Club" / "Rotaract Club" / etc.).
            var meta = await conn.QueryFirstOrDefaultAsync<(string? clubRotaryId, string? clubType, string? clubName)>(@"
                SELECT ClubRotaryId AS clubRotaryId, ClubType AS clubType, ClubName AS clubName
                FROM club_master WHERE pk_club_id = @Id AND isdeleted = 0 LIMIT 1",
                new { Id = resolvedClubId });
            if (string.IsNullOrWhiteSpace(meta.clubRotaryId) || !int.TryParse(meta.clubRotaryId, out var rotaryOrgClubId))
            {
                return Ok(new { clubId = resolvedClubId, members = Array.Empty<object>(), warning = "Club is not linked to Rotary.org (missing ClubRotaryId)." });
            }
            var clubType = string.IsNullOrWhiteSpace(meta.clubType) ? "Rotary Club" : meta.clubType!;
            // No Rotary.org API login on this server (a local copy, a new instance): nothing to fetch, not a bad request.
            if (string.IsNullOrWhiteSpace(_configuration["RotaryOrgApi:Username"]) || string.IsNullOrWhiteSpace(_configuration["RotaryOrgApi:Password"]))
                return Ok(new { clubId = resolvedClubId, members = Array.Empty<object>(), warning = "Rotary.org is not connected on this server." });

            var list = await _rotaryOrgClient.GetClubTerminatedMembersAsync(clubType, rotaryOrgClubId);

            // Write-through cache (2026-07-31): persist this fetch to rotary_org_terminated_cache
            // so the district-wide Rotary Network view can read it without re-hitting Rotary.org
            // live for every club on every page load. Best-effort — a caching failure must not
            // break the live-fetch response itself.
            try { await RotaryOrgTerminatedCacheHelper.UpsertAsync(conn, rotaryOrgClubId, list); }
            catch { /* best-effort cache write; the live response still succeeds */ }

            // Display-only enrichment: look up mobile/email from OUR OWN already-stored
            // member_master_profile by RotaryId (the profile row survives club termination —
            // see ClubService.RemoveMemberAsync comments).
            var rotaryIds = list.Select(m => m.MemberId.ToString()).Distinct().ToList();
            var contactByRotaryId = rotaryIds.Count == 0
                ? new Dictionary<string, (string? mobile, string? email)>()
                : (await conn.QueryAsync<(string rotaryId, string? mobile, string? email)>(@"
                    SELECT RotaryId AS rotaryId, PrimaryMobileNumber AS mobile, EmailId AS email
                    FROM member_master_profile
                    WHERE isdeleted = 0 AND RotaryId IN @RotaryIds",
                    new { RotaryIds = rotaryIds }))
                    .ToDictionary(x => x.rotaryId, x => (x.mobile, x.email));

            // Project to a lean shape — the frontend rotary-network row type uses
            // camelCase + a subset of fields. Keeping the projection here means we
            // can swap upstream DTO shape later without touching the client TS.
            var projected = list.Select((m, i) =>
            {
                contactByRotaryId.TryGetValue(m.MemberId.ToString(), out var contact);
                return new
                {
                    id = (int)(m.MemberId % int.MaxValue), // stable display id, never persisted
                    memberId = m.MemberId.ToString(),
                    memberType = m.MemberType ?? "",
                    firstName = m.FirstName ?? "",
                    middleName = m.MiddleName ?? "",
                    lastName = m.LastName ?? "",
                    admissionDate = m.AdmissionDate,
                    terminationDate = m.TerminationDate,
                    terminationReason = m.TerminationReason ?? "",
                    mobile = contact.mobile,
                    email = contact.email,
                };
            }).ToList();

            return Ok(new {
                clubId = resolvedClubId,
                clubName = meta.clubName ?? "",
                rotaryOrgClubId,
                clubType,
                members = projected,
                totalCount = projected.Count,
            });
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
        catch (HttpRequestException ex)
        {
            return StatusCode(502, new { message = "Rotary.org API call failed.", detail = ex.Message });
        }
    }
}
