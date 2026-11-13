using System.Text.RegularExpressions;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

// "Sync from Rotary.org" for a District Governor (user 2026-11-06, option B).
// The DG signs in with his OWN Rotary.org login; this API only queues a request - the RccGoalsFetcher
// worker (Windows service on the server) signs in, fetches that district's current-year goals and writes
// goal_rotary_org_values (Target only if empty, Achieved/Value every sync). One sync at a time.
// Saved password: encrypted (RotaryOrgCredentialCrypto), optional nightly auto-sync. A wrong password
// marks the login EXPIRED (worker) - the DG enters the new one here. New Rotary year = old login DISABLED.
[ApiController]
[Route("api/goal-setting-rotary/sync")]
[Authorize]
public class GoalRotarySyncController : ControllerBase
{
    private readonly string _cs;
    private readonly IConfiguration _config;
    private readonly ILogger<GoalRotarySyncController> _logger;
    private static bool _tablesReady;
    private const double DefaultSecondsPerClub = 4.5, SignInSeconds = 60;

    public GoalRotarySyncController(IConfiguration config, ILogger<GoalRotarySyncController> logger)
    {
        _config = config; _logger = logger;
        _cs = config.GetConnectionString("DefaultConnection")!;
    }

    private int MemberId() => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    public sealed class StartDto
    {
        public int DistrictId { get; set; }
        public string? Email { get; set; }
        public string? Password { get; set; }
        public bool SavePassword { get; set; }
        public bool AllowNightly { get; set; }
    }
    public sealed class DistrictDto { public int DistrictId { get; set; } }

    private async Task<MySqlConnection> OpenAsync()
    {
        var c = new MySqlConnection(_cs);
        await c.OpenAsync();
        if (!_tablesReady)
        {
            await c.ExecuteAsync(@"CREATE TABLE IF NOT EXISTS rotary_org_sync_logins (
                pk_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_district_id INT NOT NULL, fk_year_id INT NOT NULL, fk_member_id INT NOT NULL,
                RotaryEmail VARCHAR(200) NOT NULL, PasswordEnc VARCHAR(1000) NULL,
                AllowNightly TINYINT(1) NOT NULL DEFAULT 0,
                Status VARCHAR(20) NOT NULL DEFAULT 'NEW',
                StatusMessage VARCHAR(500) NULL, LastOkAt DATETIME NULL, ExpiredMailSentAt DATETIME NULL,
                created_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, modified_date DATETIME NULL,
                isdeleted TINYINT(1) NOT NULL DEFAULT 0,
                KEY ix_rosl_district (fk_district_id, isdeleted)) DEFAULT CHARSET=utf8mb4");
            await c.ExecuteAsync(@"CREATE TABLE IF NOT EXISTS rotary_org_sync_requests (
                pk_id BIGINT AUTO_INCREMENT PRIMARY KEY,
                fk_district_id INT NOT NULL, DistrictNumber VARCHAR(20) NOT NULL, fk_year_id INT NOT NULL,
                fk_member_id INT NULL, TriggerType VARCHAR(10) NOT NULL,
                fk_login_id INT NULL,
                OneTimeEmail VARCHAR(200) NULL, OneTimePasswordEnc VARCHAR(1000) NULL,
                SaveOnSuccess TINYINT(1) NOT NULL DEFAULT 0, SaveAllowNightly TINYINT(1) NOT NULL DEFAULT 0,
                Status VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
                Stage VARCHAR(100) NULL, ClubsDone INT NOT NULL DEFAULT 0, ClubsTotal INT NOT NULL DEFAULT 0,
                RowsWritten INT NOT NULL DEFAULT 0, ErrorMessage VARCHAR(1000) NULL,
                StartedAt DATETIME NULL, FinishedAt DATETIME NULL,
                created_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                KEY ix_rosr_status (Status, pk_id), KEY ix_rosr_district (fk_district_id, pk_id)) DEFAULT CHARSET=utf8mb4");
            _tablesReady = true;
        }
        return c;
    }

    private static Task<int> CurrentYearAsync(MySqlConnection c) =>
        c.ExecuteScalarAsync<int>("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND COALESCE(isdeleted,0) = 0 ORDER BY pk_year_id DESC LIMIT 1");

    // Super Admin, the District Admin of that district, or the district's current-year DG.
    private async Task<bool> CanSyncAsync(MySqlConnection c, int districtId)
    {
        var m = MemberId();
        if (m == 0) return false;
        if (await ClubAdminAccessHelper.IsSuperAdminAsync(c, m)) return true;
        return await c.ExecuteScalarAsync<int>(@"
            SELECT (SELECT COUNT(*) FROM member_roles WHERE fk_member_master_profile_id = @M AND fk_role_id = 2 AND fk_district_id = @D
                      AND (fk_club_id IS NULL OR fk_club_id = 0) AND IsActive = 1 AND isdeleted = 0)
                 + (SELECT COUNT(*) FROM district_governors g JOIN rotary_year_master y ON y.pk_year_id = g.fk_year_id AND y.IsCurrent = 1
                      WHERE g.fk_member_id = @M AND g.fk_district_id = @D AND COALESCE(g.isdeleted,0) = 0)",
            new { M = m, D = districtId }) > 0;
    }

    private static string MaskEmail(string e)
    {
        var at = e.IndexOf('@');
        return at <= 2 ? e : e[..2] + new string('*', Math.Max(1, at - 2)) + e[at..];
    }

    // "As on" date shown on the district page and in View Club Goals: last finished sync, else the last
    // time Rotary.org figures were written for that district this year.
    [HttpGet("as-on")]
    public async Task<ActionResult> AsOn([FromQuery] int districtId)
    {
        await using var c = await OpenAsync();
        var y = await CurrentYearAsync(c);
        return Ok(new { asOn = await AsOnAsync(c, districtId, y) });
    }

    private static async Task<DateTime?> AsOnAsync(MySqlConnection c, int districtId, int yearId) =>
        await c.ExecuteScalarAsync<DateTime?>(@"
            SELECT COALESCE(
              (SELECT MAX(FinishedAt) FROM rotary_org_sync_requests WHERE fk_district_id = @D AND fk_year_id = @Y AND Status = 'DONE'),
              (SELECT MAX(COALESCE(modified_date, created_date)) FROM goal_rotary_org_values WHERE fk_district_id = @D AND fk_year_id = @Y AND isdeleted = 0))",
            new { D = districtId, Y = yearId });

    [HttpGet("status")]
    public async Task<ActionResult> Status([FromQuery] int districtId)
    {
        await using var c = await OpenAsync();
        var canSync = await CanSyncAsync(c, districtId);
        var y = await CurrentYearAsync(c);
        var asOn = await AsOnAsync(c, districtId, y);
        if (!canSync) return Ok(new { canSync, asOn });

        var secPerClub = await SecondsPerClubAsync(c);
        var active = await c.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pk_id, Status, Stage, ClubsDone, ClubsTotal, StartedAt, created_date
            FROM rotary_org_sync_requests WHERE fk_district_id = @D AND Status IN ('QUEUED','RUNNING') ORDER BY pk_id DESC LIMIT 1", new { D = districtId });
        object? current = null;
        if (active != null)
        {
            long id = active.pk_id;
            string st = active.Status;
            int done = active.ClubsDone, total = active.ClubsTotal;
            if (total == 0) total = await ClubCountAsync(c, districtId);
            // Requests ahead in the queue (the worker runs one at a time, oldest first).
            var ahead = (await c.QueryAsync<(long Id, string Status, int Done, int Total, int District)>(@"
                SELECT pk_id, Status, ClubsDone, ClubsTotal, fk_district_id FROM rotary_org_sync_requests
                WHERE Status IN ('QUEUED','RUNNING') AND pk_id < @Id ORDER BY pk_id", new { Id = id })).ToList();
            double eta = 0;
            foreach (var a in ahead)
            {
                var t = a.Total > 0 ? a.Total : await ClubCountAsync(c, a.District);
                eta += (a.Status == "RUNNING" && a.Done > 0 ? 0 : SignInSeconds) + Math.Max(0, t - a.Done) * secPerClub;
            }
            eta += (st == "RUNNING" && done > 0 ? 0 : SignInSeconds) + Math.Max(0, total - done) * secPerClub;
            current = new
            {
                id, status = st, stage = (string?)active.Stage, clubsDone = done, clubsTotal = total,
                queuePosition = st == "QUEUED" ? ahead.Count + 1 : 0,
                etaSeconds = (int)Math.Round(eta), startedAt = (DateTime?)active.StartedAt, requestedAt = (DateTime)active.created_date,
            };
        }
        var last = await c.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT Status, FinishedAt, ErrorMessage, RowsWritten, ClubsTotal FROM rotary_org_sync_requests
            WHERE fk_district_id = @D AND Status IN ('DONE','FAILED','LOGIN_FAILED') ORDER BY pk_id DESC LIMIT 1", new { D = districtId });
        var login = await c.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT RotaryEmail, AllowNightly, Status, StatusMessage, LastOkAt, fk_year_id FROM rotary_org_sync_logins
            WHERE fk_district_id = @D AND isdeleted = 0 ORDER BY pk_id DESC LIMIT 1", new { D = districtId });
        object? savedLogin = login == null ? null : new
        {
            email = MaskEmail((string)login.RotaryEmail),
            allowNightly = Convert.ToBoolean(login.AllowNightly),
            status = (int)login.fk_year_id != y ? "DISABLED" : (string)login.Status,
            statusMessage = (int)login.fk_year_id != y ? "Saved for an earlier Rotary year. Please save your own Rotary.org login." : (string?)login.StatusMessage,
            lastOkAt = (DateTime?)login.LastOkAt,
        };
        return Ok(new
        {
            canSync, asOn, current, savedLogin,
            configured = RotaryOrgCredentialCrypto.IsConfigured(_config),
            estimateMinutes = Math.Max(1, (int)Math.Round((SignInSeconds + await ClubCountAsync(c, districtId) * secPerClub) / 60)),
            last = last == null ? null : new { status = (string)last.Status, finishedAt = (DateTime?)last.FinishedAt, error = (string?)last.ErrorMessage, rows = (int)last.RowsWritten, clubs = (int)last.ClubsTotal },
        });
    }

    // Average seconds per club from the last finished syncs (sign-in time taken off); 4.5 s until we have data
    // (D3142, 107 clubs ~ 8 min in Oct 2026).
    private static async Task<double> SecondsPerClubAsync(MySqlConnection c)
    {
        var v = await c.ExecuteScalarAsync<double?>(@"
            SELECT AVG(GREATEST(TIMESTAMPDIFF(SECOND, StartedAt, FinishedAt) - 60, 1) / ClubsTotal) FROM (
              SELECT StartedAt, FinishedAt, ClubsTotal FROM rotary_org_sync_requests
              WHERE Status = 'DONE' AND ClubsTotal > 0 AND StartedAt IS NOT NULL ORDER BY pk_id DESC LIMIT 10) t");
        return v is > 0 and < 120 ? v.Value : DefaultSecondsPerClub;
    }

    private static Task<int> ClubCountAsync(MySqlConnection c, int districtId) =>
        c.ExecuteScalarAsync<int>(@"SELECT COUNT(*) FROM club_master WHERE fk_district_id = @D AND isdeleted = 0
            AND COALESCE(IsActive,1) = 1 AND COALESCE(ClubType,'') <> 'Rotaract Club'", new { D = districtId });

    [HttpPost("start")]
    public async Task<ActionResult> Start([FromBody] StartDto dto)
    {
        await using var c = await OpenAsync();
        if (dto.DistrictId <= 0) return BadRequest(new { message = "District is required." });
        if (!await CanSyncAsync(c, dto.DistrictId)) return StatusCode(403, new { message = "Only the District Governor / District Admin of this district can sync it." });
        if (!RotaryOrgCredentialCrypto.IsConfigured(_config)) return BadRequest(new { message = "Rotary.org sync is not set up on the server yet." });

        var districtNumber = await c.ExecuteScalarAsync<string?>("SELECT DistrictNumber FROM district_master WHERE pk_district_id = @D AND isdeleted = 0", new { D = dto.DistrictId });
        if (string.IsNullOrWhiteSpace(districtNumber)) return BadRequest(new { message = "District not found." });
        var y = await CurrentYearAsync(c);

        // One at a time per district: a queued / running sync is simply returned.
        var running = await c.ExecuteScalarAsync<long?>("SELECT pk_id FROM rotary_org_sync_requests WHERE fk_district_id = @D AND Status IN ('QUEUED','RUNNING') ORDER BY pk_id DESC LIMIT 1", new { D = dto.DistrictId });
        if (running != null) return Ok(new { requestId = running, alreadyRunning = true });

        var email = (dto.Email ?? "").Trim();
        var password = dto.Password ?? "";
        int? loginId = null; string? oneEmail = null, onePass = null;
        if (password.Length > 0)
        {
            if (!Regex.IsMatch(email, @"^[^@\s]+@[^@\s]+\.[^@\s]+$")) return BadRequest(new { message = "Enter your Rotary.org (My Rotary) email." });
            if (password.Length > 200) return BadRequest(new { message = "Password is too long." });
            // Typed login goes with the request only. "Save my login" is applied by the worker AFTER a successful
            // sync proves the login is this district's (user 2026-11-06) - a wrong district's login is never saved.
            oneEmail = email; onePass = RotaryOrgCredentialCrypto.Encrypt(_config, password);
        }
        else
        {
            var saved = await c.QueryFirstOrDefaultAsync<dynamic>(@"SELECT pk_id, Status, fk_year_id FROM rotary_org_sync_logins
                WHERE fk_district_id = @D AND isdeleted = 0 AND PasswordEnc IS NOT NULL ORDER BY pk_id DESC LIMIT 1", new { D = dto.DistrictId });
            if (saved == null) return BadRequest(new { message = "Enter your Rotary.org email and password." });
            if ((int)saved.fk_year_id != y) return BadRequest(new { message = "The saved login is from an earlier Rotary year. Please enter your own Rotary.org login." });
            string st = saved.Status;
            if (st == "EXPIRED") return BadRequest(new { message = "Your Rotary.org password has changed. Please enter the new one." });
            if (st == "MFA") return BadRequest(new { message = "This Rotary.org account needs extra verification, so automatic sync is not possible." });
            if (st == "DISABLED") return BadRequest(new { message = "The saved login is switched off. Please enter your Rotary.org login." });
            loginId = (int)saved.pk_id;
        }

        var id = await c.ExecuteScalarAsync<long>(@"INSERT INTO rotary_org_sync_requests
            (fk_district_id, DistrictNumber, fk_year_id, fk_member_id, TriggerType, fk_login_id, OneTimeEmail, OneTimePasswordEnc, SaveOnSuccess, SaveAllowNightly, Status, Stage, created_date)
            VALUES (@D, @Dn, @Y, @M, 'MANUAL', @L, @OE, @OP, @SV, @SN, 'QUEUED', 'Waiting in queue', NOW()); SELECT LAST_INSERT_ID();",
            new { D = dto.DistrictId, Dn = districtNumber.Trim(), Y = y, M = MemberId(), L = loginId, OE = oneEmail, OP = onePass,
                  SV = onePass != null && dto.SavePassword, SN = onePass != null && dto.SavePassword && dto.AllowNightly });
        _logger.LogInformation("Rotary.org sync queued: district {District}, request {Id}, by member {Member}", districtNumber, id, MemberId());
        return Ok(new { requestId = id, alreadyRunning = false });
    }

    // Turn nightly auto-sync on / off for the saved login.
    [HttpPost("nightly")]
    public async Task<ActionResult> Nightly([FromBody] StartDto dto)
    {
        await using var c = await OpenAsync();
        if (!await CanSyncAsync(c, dto.DistrictId)) return StatusCode(403, new { message = "Not allowed." });
        var n = await c.ExecuteAsync("UPDATE rotary_org_sync_logins SET AllowNightly = @N, modified_date = NOW() WHERE fk_district_id = @D AND isdeleted = 0",
            new { D = dto.DistrictId, N = dto.AllowNightly });
        return n > 0 ? Ok(new { ok = true }) : BadRequest(new { message = "No saved login for this district." });
    }

    // Remove the saved login: the password is wiped and the row soft-deleted (manual sync with a typed password still works).
    [HttpPost("remove-login")]
    public async Task<ActionResult> RemoveLogin([FromBody] DistrictDto dto)
    {
        await using var c = await OpenAsync();
        if (!await CanSyncAsync(c, dto.DistrictId)) return StatusCode(403, new { message = "Not allowed." });
        await c.ExecuteAsync(@"UPDATE rotary_org_sync_logins SET PasswordEnc = NULL, AllowNightly = 0, Status = 'DISABLED', isdeleted = 1, modified_date = NOW()
            WHERE fk_district_id = @D AND isdeleted = 0", new { D = dto.DistrictId });
        return Ok(new { ok = true });
    }
}
