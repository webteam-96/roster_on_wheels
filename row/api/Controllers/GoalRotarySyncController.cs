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
// CLUB sync (user 2026-11-10): every endpoint also takes clubId. clubId > 0 = that club's own sync by its
// Club Admin / current-year President / Secretary (or Super Admin) with THEIR OWN Rotary.org login; the
// worker checks the login's club and writes that club only. clubId = 0 (or missing) = the district, as before;
// district queries look at district rows only (fk_club_id = 0). Same tables, column fk_club_id.
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
        public int ClubId { get; set; }
        public string? Email { get; set; }
        public string? Password { get; set; }
        public bool SavePassword { get; set; }
        public bool AllowNightly { get; set; }
        // The Rotary year to sync (user 2026-11-20): 0 = the current year. Each DG syncs only the year they are DG for -
        // a past year (Achieved; a goal only where none is saved), the next year (goals only).
        public int YearId { get; set; }
    }
    public sealed class DistrictDto { public int DistrictId { get; set; } public int ClubId { get; set; } }

    private async Task<MySqlConnection> OpenAsync()
    {
        var c = RowDb.Connect(_cs);
        await c.OpenAsync();
        if (!_tablesReady)
        {
            await c.ExecuteAsync(@"CREATE TABLE IF NOT EXISTS rotary_org_sync_logins (
                pk_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_district_id INT NOT NULL, fk_club_id INT NOT NULL DEFAULT 0, fk_year_id INT NOT NULL, fk_member_id INT NOT NULL,
                RotaryEmail VARCHAR(200) NOT NULL, PasswordEnc VARCHAR(1000) NULL,
                AllowNightly TINYINT(1) NOT NULL DEFAULT 0,
                Status VARCHAR(20) NOT NULL DEFAULT 'NEW',
                StatusMessage VARCHAR(500) NULL, LastOkAt DATETIME NULL, ExpiredMailSentAt DATETIME NULL,
                created_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, modified_date DATETIME NULL,
                isdeleted TINYINT(1) NOT NULL DEFAULT 0,
                KEY ix_rosl_district (fk_district_id, isdeleted)) DEFAULT CHARSET=utf8mb4");
            await c.ExecuteAsync(@"CREATE TABLE IF NOT EXISTS rotary_org_sync_requests (
                pk_id BIGINT AUTO_INCREMENT PRIMARY KEY,
                fk_district_id INT NOT NULL, fk_club_id INT NOT NULL DEFAULT 0, DistrictNumber VARCHAR(20) NOT NULL, fk_year_id INT NOT NULL,
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

    // Super Admin, the district's current-year DG, or the District Admin of that district WITH rights for the
    // current Rotary year (Year-wise Admin Rights, user 2026-11-20) - the sync writes the current year only.
    private async Task<bool> CanSyncAsync(MySqlConnection c, int districtId, int yearId)
    {
        var m = MemberId();
        if (m == 0) return false;
        if (await ClubAdminAccessHelper.IsSuperAdminAsync(c, m)) return true;
        // The DG of THAT year (user 2026-11-20: last year's DG syncs last year, next year's DG next year).
        var (admin, dg) = await c.QueryFirstAsync<(int, int)>(@"
            SELECT (SELECT COUNT(*) FROM member_roles WHERE fk_member_master_profile_id = @M AND fk_role_id = 2 AND fk_district_id = @D
                      AND (fk_club_id IS NULL OR fk_club_id = 0) AND IsActive = 1 AND isdeleted = 0),
                   (SELECT COUNT(*) FROM district_governors g
                      WHERE g.fk_member_id = @M AND g.fk_district_id = @D AND g.fk_year_id = @Y AND COALESCE(g.isdeleted,0) = 0)",
            new { M = m, D = districtId, Y = yearId });
        if (dg > 0) return true;
        if (admin == 0) return false;
        var guard = HttpContext.RequestServices.GetRequiredService<AdminYearGuard>();
        return await guard.DistrictYearAsync(User, districtId, yearId) == null;
    }

    // Club sync (user 2026-11-10): Super Admin, the club's Club Admin, or its CURRENT-year Club President /
    // Club Secretary (Board of Directors) - each for their own club only.
    private async Task<bool> CanSyncClubAsync(MySqlConnection c, int clubId, int yearId)
    {
        var m = MemberId();
        if (m == 0 || clubId <= 0) return false;
        if (await ClubAdminAccessHelper.IsSuperAdminAsync(c, m)) return true;
        // Club Admin: only with rights for the current Rotary year (Year-wise Admin Rights, user 2026-11-20).
        var isAdmin = await c.ExecuteScalarAsync<int>(@"SELECT COUNT(*) FROM member_roles WHERE fk_member_master_profile_id = @M
            AND fk_role_id = 2 AND fk_club_id = @C AND IsActive = 1 AND isdeleted = 0", new { M = m, C = clubId }) > 0;
        if (isAdmin && await HttpContext.RequestServices.GetRequiredService<AdminYearGuard>().ClubYearAsync(User, clubId, yearId) == null)
            return true;
        return await c.ExecuteScalarAsync<int>(@"
            SELECT (SELECT COUNT(*) FROM board_of_directors b
                      JOIN designation_master dm ON dm.pk_designation_id = b.fk_designation_id
                      WHERE b.fk_member_master_profile_id = @M AND b.fk_club_id = @C AND b.fk_year_id = @Y AND COALESCE(b.isdeleted,0) = 0
                        AND dm.designation_name IN ('Club President', 'Club Secretary'))",
            new { M = m, C = clubId, Y = yearId }) > 0;
    }

    // (district, club) a request is about: a club's own district comes from club_master, never from the caller.
    private async Task<(int District, int Club, bool Allowed)> ScopeAsync(MySqlConnection c, int districtId, int clubId, int yearId = 0)
    {
        if (yearId <= 0) yearId = await CurrentYearAsync(c);
        if (clubId > 0)
        {
            var d = await c.ExecuteScalarAsync<int?>("SELECT fk_district_id FROM club_master WHERE pk_club_id = @C AND COALESCE(isdeleted,0) = 0", new { C = clubId }) ?? 0;
            return (d, clubId, d > 0 && await CanSyncClubAsync(c, clubId, yearId));
        }
        return (districtId, 0, await CanSyncAsync(c, districtId, yearId));
    }

    // The year asked for, if it exists; 0 / unknown = the current year.
    private async Task<int> YearOrCurrentAsync(MySqlConnection c, int yearId) =>
        yearId > 0 && await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM rotary_year_master WHERE pk_year_id = @Y AND COALESCE(isdeleted,0) = 0", new { Y = yearId }) > 0
            ? yearId : await CurrentYearAsync(c);

    private static string MaskEmail(string e)
    {
        var at = e.IndexOf('@');
        return at <= 2 ? e : e[..2] + new string('*', Math.Max(1, at - 2)) + e[at..];
    }

    // "As on" date shown on the district page and in View Club Goals: last finished sync, else the last
    // time Rotary.org figures were written for that district this year.
    [HttpGet("as-on")]
    public async Task<ActionResult> AsOn([FromQuery] int districtId, [FromQuery] int clubId = 0)
    {
        await using var c = await OpenAsync();
        var y = await CurrentYearAsync(c);
        if (clubId > 0) districtId = await c.ExecuteScalarAsync<int?>("SELECT fk_district_id FROM club_master WHERE pk_club_id = @C", new { C = clubId }) ?? 0;
        return Ok(new { asOn = await AsOnAsync(c, districtId, y, clubId) });
    }

    // District: its own DG syncs. Club: its own syncs OR its district's DG sync (that covers every club).
    private static async Task<DateTime?> AsOnAsync(MySqlConnection c, int districtId, int yearId, int clubId = 0) =>
        await c.ExecuteScalarAsync<DateTime?>(@"
            SELECT COALESCE(
              (SELECT MAX(FinishedAt) FROM rotary_org_sync_requests WHERE fk_district_id = @D AND fk_year_id = @Y AND Status = 'DONE'
                 AND (fk_club_id = 0 OR fk_club_id = @Cl)),
              (SELECT MAX(COALESCE(modified_date, created_date)) FROM goal_rotary_org_values WHERE fk_district_id = @D AND fk_year_id = @Y AND isdeleted = 0
                 AND (@Cl = 0 OR (EntityType = 'Club' AND fk_club_id = @Cl))))",
            new { D = districtId, Y = yearId, Cl = clubId });

    [HttpGet("status")]
    public async Task<ActionResult> Status([FromQuery] int districtId, [FromQuery] int clubId = 0, [FromQuery] int yearId = 0)
    {
        await using var c = await OpenAsync();
        var y = await YearOrCurrentAsync(c, yearId);
        var (d, cl, canSync) = await ScopeAsync(c, districtId, clubId, y);
        districtId = d;
        var asOn = await AsOnAsync(c, districtId, y, cl);
        if (!canSync) return Ok(new { canSync, asOn });

        var secPerClub = await SecondsPerClubAsync(c);
        var active = await c.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pk_id, Status, Stage, ClubsDone, ClubsTotal, StartedAt, created_date, fk_member_id, TriggerType
            FROM rotary_org_sync_requests WHERE fk_district_id = @D AND fk_club_id = @Cl AND Status IN ('QUEUED','RUNNING','CANCELLING') ORDER BY pk_id DESC LIMIT 1", new { D = districtId, Cl = cl });
        object? current = null;
        if (active != null)
        {
            long id = active.pk_id;
            string st = active.Status;
            int done = active.ClubsDone, total = active.ClubsTotal;
            if (total == 0) total = cl > 0 ? 1 : await ClubCountAsync(c, districtId);
            // Requests ahead in the queue (the worker runs one at a time, oldest first).
            var ahead = (await c.QueryAsync<(long Id, string Status, int Done, int Total, int District, int Club)>(@"
                SELECT pk_id, Status, ClubsDone, ClubsTotal, fk_district_id, fk_club_id FROM rotary_org_sync_requests
                WHERE Status IN ('QUEUED','RUNNING','CANCELLING') AND pk_id < @Id ORDER BY pk_id", new { Id = id })).ToList();
            double eta = 0;
            foreach (var a in ahead)
            {
                var t = a.Total > 0 ? a.Total : a.Club > 0 ? 1 : await ClubCountAsync(c, a.District);
                eta += (a.Status == "RUNNING" && a.Done > 0 ? 0 : SignInSeconds) + Math.Max(0, t - a.Done) * secPerClub;
            }
            eta += (st == "RUNNING" && done > 0 ? 0 : SignInSeconds) + Math.Max(0, total - done) * secPerClub;
            current = new
            {
                id, status = st, stage = (string?)active.Stage, clubsDone = done, clubsTotal = total,
                queuePosition = st == "QUEUED" ? ahead.Count + 1 : 0,
                etaSeconds = (int)Math.Round(eta), startedAt = (DateTime?)active.StartedAt, requestedAt = (DateTime)active.created_date,
                // Cancel (user 2026-11-23): the person who started it, or the Super Admin.
                cancelling = st == "CANCELLING",
                canCancel = st != "CANCELLING" && (((int?)active.fk_member_id ?? 0) == MemberId() || await ClubAdminAccessHelper.IsSuperAdminAsync(c, MemberId())),
            };
        }
        var last = await c.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT Status, FinishedAt, ErrorMessage, RowsWritten, ClubsTotal FROM rotary_org_sync_requests
            WHERE fk_district_id = @D AND fk_club_id = @Cl AND Status IN ('DONE','FAILED','LOGIN_FAILED','CANCELLED') ORDER BY pk_id DESC LIMIT 1", new { D = districtId, Cl = cl });
        var login = await c.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT RotaryEmail, AllowNightly, Status, StatusMessage, LastOkAt, fk_year_id FROM rotary_org_sync_logins
            WHERE fk_district_id = @D AND fk_club_id = @Cl AND fk_year_id = @Y AND isdeleted = 0 ORDER BY pk_id DESC LIMIT 1", new { D = districtId, Cl = cl, Y = y });
        // Club: is the district's DG weekly auto-sync on? Then it already covers this club every week.
        var districtAuto = cl > 0 && await c.ExecuteScalarAsync<int>(@"SELECT COUNT(*) FROM rotary_org_sync_logins WHERE fk_district_id = @D AND fk_club_id = 0
            AND isdeleted = 0 AND AllowNightly = 1 AND Status IN ('OK','NEW') AND fk_year_id = @Y", new { D = districtId, Y = y }) > 0;
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
            canSync, asOn, current, savedLogin, districtAuto,
            configured = RotaryOrgCredentialCrypto.IsConfigured(_config),
            estimateMinutes = Math.Max(1, (int)Math.Round((SignInSeconds + (cl > 0 ? 1 : await ClubCountAsync(c, districtId)) * secPerClub) / 60)),
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
        if (dto.DistrictId <= 0 && dto.ClubId <= 0) return BadRequest(new { message = "District is required." });
        var y = await YearOrCurrentAsync(c, dto.YearId);
        var (districtId, clubId, allowed) = await ScopeAsync(c, dto.DistrictId, dto.ClubId, y);
        if (!allowed) return StatusCode(403, new { message = clubId > 0
            ? "Only this club's Club Admin, President or Secretary can sync it."
            : "Only the District Governor / District Admin of this district can sync it." });
        if (!RotaryOrgCredentialCrypto.IsConfigured(_config)) return BadRequest(new { message = "Rotary.org sync is not set up on the server yet." });
        dto.DistrictId = districtId;
        if (clubId > 0 && string.IsNullOrWhiteSpace(await c.ExecuteScalarAsync<string?>("SELECT TRIM(ClubRotaryId) FROM club_master WHERE pk_club_id = @C", new { C = clubId })))
            return BadRequest(new { message = "This club has no Rotary club number in ROW, so it cannot be synced from Rotary.org." });

        var districtNumber = await c.ExecuteScalarAsync<string?>("SELECT DistrictNumber FROM district_master WHERE pk_district_id = @D AND isdeleted = 0", new { D = dto.DistrictId });
        if (string.IsNullOrWhiteSpace(districtNumber)) return BadRequest(new { message = "District not found." });

        // One at a time per district / club: a queued / running sync is simply returned.
        var running = await c.QueryFirstOrDefaultAsync<(long Id, int? Year)?>("SELECT pk_id, fk_year_id FROM rotary_org_sync_requests WHERE fk_district_id = @D AND fk_club_id = @Cl AND Status IN ('QUEUED','RUNNING','CANCELLING') ORDER BY pk_id DESC LIMIT 1",
            new { D = dto.DistrictId, Cl = clubId });
        // The running sync is returned only when it is for the year asked; another year's sync is not passed off as this one.
        if (running is { } r && (r.Year ?? y) == y) return Ok(new { requestId = r.Id, alreadyRunning = true });
        if (running != null) return Conflict(new { message = "A Rotary.org sync for another Rotary year is still running. Start this one when it has finished." });

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
            // A login is saved per Rotary year (user 2026-11-20): the same person DG for two years is asked again.
            var saved = await c.QueryFirstOrDefaultAsync<dynamic>(@"SELECT pk_id, Status, fk_year_id FROM rotary_org_sync_logins
                WHERE fk_district_id = @D AND fk_club_id = @Cl AND fk_year_id = @Y AND isdeleted = 0 AND PasswordEnc IS NOT NULL ORDER BY pk_id DESC LIMIT 1",
                new { D = dto.DistrictId, Cl = clubId, Y = y });
            if (saved == null) return BadRequest(new { message = "Enter your Rotary.org email and password." });
            string st = saved.Status;
            if (st == "EXPIRED") return BadRequest(new { message = "Your Rotary.org password has changed. Please enter the new one." });
            if (st == "MFA") return BadRequest(new { message = "This Rotary.org account needs extra verification, so automatic sync is not possible." });
            if (st == "DISABLED") return BadRequest(new { message = "The saved login is switched off. Please enter your Rotary.org login." });
            loginId = (int)saved.pk_id;
        }

        var id = await c.ExecuteScalarAsync<long>(@"INSERT INTO rotary_org_sync_requests
            (fk_district_id, fk_club_id, DistrictNumber, fk_year_id, fk_member_id, TriggerType, fk_login_id, OneTimeEmail, OneTimePasswordEnc, SaveOnSuccess, SaveAllowNightly, Status, Stage, created_date)
            VALUES (@D, @Cl, @Dn, @Y, @M, 'MANUAL', @L, @OE, @OP, @SV, @SN, 'QUEUED', 'Waiting in queue', NOW()); SELECT LAST_INSERT_ID();",
            new { D = dto.DistrictId, Cl = clubId, Dn = districtNumber.Trim(), Y = y, M = MemberId(), L = loginId, OE = oneEmail, OP = onePass,
                  SV = onePass != null && dto.SavePassword, SN = onePass != null && dto.SavePassword && dto.AllowNightly });
        _logger.LogInformation("Rotary.org sync queued: district {District}, club {Club}, request {Id}, by member {Member}", districtNumber, clubId, id, MemberId());
        return Ok(new { requestId = id, alreadyRunning = false });
    }

    // Cancel a sync (user 2026-11-23) - the person who started it, or the Super Admin.
    //   Waiting in the queue -> cancelled at once, nothing fetched.
    //   Running -> CANCELLING: the worker stops before anything is saved (it saves only at the very end), so
    //   a cancelled sync never leaves half the figures changed.
    [HttpPost("cancel")]
    public async Task<ActionResult> Cancel([FromBody] DistrictDto dto)
    {
        await using var c = await OpenAsync();
        var (d, cl, _) = await ScopeAsync(c, dto.DistrictId, dto.ClubId);
        var r = await c.QueryFirstOrDefaultAsync<dynamic>(@"SELECT pk_id, Status, fk_member_id, fk_year_id FROM rotary_org_sync_requests
            WHERE fk_district_id = @D AND fk_club_id = @Cl AND Status IN ('QUEUED','RUNNING') ORDER BY pk_id DESC LIMIT 1", new { D = d, Cl = cl });
        if (r == null) return BadRequest(new { message = "There is no sync to cancel." });
        // Rights are checked for the sync's own Rotary year, so a last-year DG can cancel the last-year sync they started.
        var (_, _, allowed) = await ScopeAsync(c, dto.DistrictId, dto.ClubId, (int?)r.fk_year_id ?? 0);
        if (!allowed) return StatusCode(403, new { message = "Not allowed." });
        if (((int?)r.fk_member_id ?? 0) != MemberId() && !await ClubAdminAccessHelper.IsSuperAdminAsync(c, MemberId()))
            return StatusCode(403, new { message = "Only the person who started this sync, or the Super Admin, can cancel it." });
        long id = r.pk_id;
        var n = await c.ExecuteAsync(@"UPDATE rotary_org_sync_requests SET Status = 'CANCELLED', Stage = 'Cancelled', ErrorMessage = 'Cancelled by user',
            FinishedAt = NOW(), OneTimeEmail = NULL, OneTimePasswordEnc = NULL WHERE pk_id = @Id AND Status = 'QUEUED'", new { Id = id });
        if (n == 0)
            n = await c.ExecuteAsync(@"UPDATE rotary_org_sync_requests SET Status = 'CANCELLING', Stage = 'Cancelling'
                WHERE pk_id = @Id AND Status = 'RUNNING'", new { Id = id });
        _logger.LogInformation("Rotary.org sync {Id} cancel requested by member {Member}", id, MemberId());
        return n > 0 ? Ok(new { ok = true }) : BadRequest(new { message = "This sync has just finished." });
    }

    // Turn nightly auto-sync on / off for the saved login.
    [HttpPost("nightly")]
    public async Task<ActionResult> Nightly([FromBody] StartDto dto)
    {
        await using var c = await OpenAsync();
        var (d, cl, allowed) = await ScopeAsync(c, dto.DistrictId, dto.ClubId);
        if (!allowed) return StatusCode(403, new { message = "Not allowed." });
        var n = await c.ExecuteAsync("UPDATE rotary_org_sync_logins SET AllowNightly = @N, modified_date = NOW() WHERE fk_district_id = @D AND fk_club_id = @Cl AND isdeleted = 0",
            new { D = d, Cl = cl, N = dto.AllowNightly });
        return n > 0 ? Ok(new { ok = true }) : BadRequest(new { message = cl > 0 ? "No saved login for this club." : "No saved login for this district." });
    }

    // Remove the saved login: the password is wiped and the row soft-deleted (manual sync with a typed password still works).
    [HttpPost("remove-login")]
    public async Task<ActionResult> RemoveLogin([FromBody] DistrictDto dto)
    {
        await using var c = await OpenAsync();
        var (d, cl, allowed) = await ScopeAsync(c, dto.DistrictId, dto.ClubId);
        if (!allowed) return StatusCode(403, new { message = "Not allowed." });
        await c.ExecuteAsync(@"UPDATE rotary_org_sync_logins SET PasswordEnc = NULL, AllowNightly = 0, Status = 'DISABLED', isdeleted = 1, modified_date = NOW()
            WHERE fk_district_id = @D AND fk_club_id = @Cl AND isdeleted = 0", new { D = d, Cl = cl });
        return Ok(new { ok = true });
    }
}
