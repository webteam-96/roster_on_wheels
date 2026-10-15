using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

// Mint + confirm the RI Flow-Bot project → Service Project Center sync. The browser extension has no
// login/JWT, so the trust is carried by a signed ProjectSyncToken:
//   1. the club-admin UI asks the AUTHENTICATED /token endpoint for a token for (projectId, clubId),
//   2. it hands that token to the extension inside the add-to-org payload,
//   3. after the user reviews + publishes on spc.rotary.org, the extension POSTs the token back to the
//      PUBLIC /confirm endpoint, which decrypts it (tamper => reject) and flips synced_to_org so the
//      club-admin listing can drop the project's "Sync" button.
[ApiController]
public class RotaryOrgProjectSyncController : ControllerBase
{
    private readonly IConfiguration _config;
    private readonly IYearTableResolver _yearTables;
    private readonly ILogger<RotaryOrgProjectSyncController> _logger;
    private readonly string _conn;

    public RotaryOrgProjectSyncController(IConfiguration config, IYearTableResolver yearTables,
        ILogger<RotaryOrgProjectSyncController> logger)
    {
        _config = config;
        _yearTables = yearTables;
        _logger = logger;
        _conn = config.GetConnectionString("DefaultConnection")!;
    }

    // Authenticated: mint a signed token for a project the club admin is about to sync. The token only
    // authorizes flipping THIS project's synced flag, so it's safe to hand to the extension.
    [Authorize]
    [HttpGet("api/rotary-org-sync/token")]
    // Minting the token IS the "Sync" click, so it is logged here as sync_clicked; the clicker's id
    // rides inside the token so the later "published" row can name the same person.
    public async Task<ActionResult<object>> MintToken([FromQuery] int projectId, [FromQuery] int clubId)
    {
        if (projectId <= 0 || clubId <= 0)
            return BadRequest(new { message = "projectId and clubId are required." });
        var memberId = CurrentMemberId();
        var token = ProjectSyncToken.Generate(_config, projectId, clubId, memberId: memberId);
        await LogSyncEventAsync(null, projectId, clubId, "sync_clicked", memberId);
        return Ok(new { token });
    }

    // Public: the extension confirms the project was published into SPC. Token-gated (no login needed).
    // Idempotent — re-confirming a project is a no-op.
    [AllowAnonymous]
    [HttpPost("api/public/rotary-org-sync/confirm")]
    public async Task<ActionResult> Confirm([FromBody] ConfirmSyncRequest req)
    {
        if (!ProjectSyncToken.TryDecrypt(_config, req?.Token, out var payload, out var error) || payload is null)
            return BadRequest(new { message = error ?? "Invalid token." });

        using var conn = new MySqlConnection(_conn);
        await conn.OpenAsync();

        // pk_project_id is unique only WITHIN a year table, so resolve the right table by (project, club).
        var info = await _yearTables.FindByProjectAndClubAsync(conn, payload.ProjectId, payload.ClubId);
        if (info is null) return NotFound(new { message = "Project not found." });

        var affected = await conn.ExecuteAsync(
            $"UPDATE `{info.ProjectsTable}` SET synced_to_org=1, synced_to_org_date=NOW() " +
            "WHERE pk_project_id=@Pid AND fk_club_id=@Cid AND isdeleted=0",
            new { Pid = payload.ProjectId, Cid = payload.ClubId });

        _logger.LogInformation("RI Flow-Bot sync confirmed: project {Pid}, club {Cid}, rows {N}",
            payload.ProjectId, payload.ClubId, affected);
        await LogSyncEventAsync(info, payload.ProjectId, payload.ClubId, "published", payload.MemberId);
        return Ok(new { ok = true, updated = affected });
    }

    // SuperAdmin ONLY: clear the synced flag so the club can sync the project again.
    //
    // Why this exists: synced_to_org is set when the admin says they published on SPC, and people do
    // say it without clicking Rotary.org's own Publish - the project then reads "Synced" here while
    // Rotary.org never received it (club reported 2026-10-05). The club admin cannot undo it; he
    // calls support, and support (SuperAdmin) resets the row from this club's listing.
    //
    // Deliberately NOT open to a club or district admin: a reset followed by a re-sync creates a
    // SECOND initiative on Rotary.org when the first one really was published, and only support can
    // check that first.
    [Authorize]
    [HttpPost("api/rotary-org-sync/reset")]
    public async Task<ActionResult> ResetSync([FromBody] ResetSyncRequest req)
    {
        var roles = User.FindFirst("roles")?.Value ?? "";
        if (!roles.Contains("SuperAdmin")) return Forbid();
        if (req is null || req.ProjectId <= 0 || req.ClubId <= 0)
            return BadRequest(new { message = "projectId and clubId are required." });

        using var conn = new MySqlConnection(_conn);
        await conn.OpenAsync();

        // pk_project_id is unique only WITHIN a year table - same lookup the confirm endpoint uses.
        var info = await _yearTables.FindByProjectAndClubAsync(conn, req.ProjectId, req.ClubId);
        if (info is null) return NotFound(new { message = "Project not found." });

        var affected = await conn.ExecuteAsync(
            $"UPDATE `{info.ProjectsTable}` SET synced_to_org=0, synced_to_org_date=NULL " +
            "WHERE pk_project_id=@Pid AND fk_club_id=@Cid AND isdeleted=0",
            new { Pid = req.ProjectId, Cid = req.ClubId });

        var byMember = User.FindFirst("memberId")?.Value ?? "?";
        await LogSyncEventAsync(info, req.ProjectId, req.ClubId, "reset", CurrentMemberId());
        _logger.LogInformation("RI Flow-Bot sync RESET by member {By}: project {Pid}, club {Cid}, rows {N}",
            byMember, req.ProjectId, req.ClubId, affected);
        return Ok(new { ok = true, updated = affected, message = affected > 0
            ? "Sync status reset - the club can sync this project again."
            : "Nothing to reset for this project." });
    }

    private int? CurrentMemberId()
        => int.TryParse(User.FindFirst("memberId")?.Value, out var id) && id > 0 ? id : null;

    // Writes one row to rotary_org_project_sync_log (SuperAdmin → Settings → Project Sync). The log is
    // a side record only: a failure here is logged and swallowed so Sync / Publish / Reset never break.
    private async Task LogSyncEventAsync(YearTableInfo? info, int projectId, int clubId, string action, int? memberId)
    {
        try
        {
            using var conn = new MySqlConnection(_conn);
            await conn.OpenAsync();
            info ??= await _yearTables.FindByProjectAndClubAsync(conn, projectId, clubId);
            await conn.ExecuteAsync(@"
                INSERT INTO rotary_org_project_sync_log
                    (fk_project_id, fk_club_id, fk_year_id, projects_table, action, fk_member_id, client_ip)
                VALUES (@Pid, @Cid, @YearId, @Tbl, @Action, @MemberId, @Ip)",
                new
                {
                    Pid = projectId, Cid = clubId, YearId = info?.YearId, Tbl = info?.ProjectsTable,
                    Action = action, MemberId = memberId,
                    Ip = HttpContext?.Connection?.RemoteIpAddress?.ToString(),
                });
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Project sync log write failed: {Action} project {Pid}, club {Cid}",
                action, projectId, clubId);
        }
    }

    public sealed class ConfirmSyncRequest
    {
        public string? Token { get; set; }
    }

    public sealed class ResetSyncRequest
    {
        public int ProjectId { get; set; }
        public int ClubId { get; set; }
    }
}
