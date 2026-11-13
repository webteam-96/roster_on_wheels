using System.Net;
using Dapper;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using MySqlConnector;

namespace RccGoalsFetcher;

/// RccGoalsFetcher.exe --worker : District Governors' own Rotary.org syncs (see WORKER_SETUP.md).
/// The web API queues rows in rotary_org_sync_requests; this loop takes one at a time (never two
/// Rotary.org sign-ins in parallel), signs in with that DG's own login, fetches ONLY that district for
/// ONLY the current Rotary year and writes goal_rotary_org_values (DbWriter rules). Once a day it also
/// queues a NIGHTLY request per saved login. Runs in a console or as a Windows Service.
public sealed class SyncWorker(Settings s) : BackgroundService
{
    public const string ServiceName = "RccGoalsWorker";

    public static async Task<int> RunHostAsync(Settings s)
    {
        Directory.CreateDirectory(Path.Combine(s.OutputFolder, "logs"));
        Log.FilePath = null;
        Log.DailyPrefix = Path.Combine(s.OutputFolder, "logs", "RccWorker");
        if (string.IsNullOrWhiteSpace(s.ConnectionString)) { Log.Error("ConnectionStrings:DefaultConnection is empty."); return 2; }
        if (string.IsNullOrWhiteSpace(s.CredentialKey)) Log.Warn("RotaryOrgSync:CredentialKey is empty - saved passwords cannot be read until it is set.");

        // One worker per machine: a second copy (console + service) would mean two Rotary sign-ins at once.
        using var single = new Mutex(true, @"Global\RccGoalsFetcherWorker", out var first);
        if (!first) { Log.Error("Another RccGoalsFetcher --worker is already running on this machine - exiting."); return 4; }

        using var host = Host.CreateDefaultBuilder()
            .UseWindowsService(o => o.ServiceName = ServiceName)
            .ConfigureServices(sv => sv.AddSingleton(s).AddHostedService<SyncWorker>())
            .Build();
        await host.RunAsync();
        GC.KeepAlive(single);
        return 0;
    }

    private const string Ddl = @"
CREATE TABLE IF NOT EXISTS rotary_org_sync_logins (
  pk_id INT AUTO_INCREMENT PRIMARY KEY,
  fk_district_id INT NOT NULL, fk_year_id INT NOT NULL, fk_member_id INT NOT NULL,
  RotaryEmail VARCHAR(200) NOT NULL, PasswordEnc VARCHAR(1000) NULL,
  AllowNightly TINYINT(1) NOT NULL DEFAULT 0,
  Status VARCHAR(20) NOT NULL DEFAULT 'NEW',
  StatusMessage VARCHAR(500) NULL, LastOkAt DATETIME NULL, ExpiredMailSentAt DATETIME NULL,
  created_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, modified_date DATETIME NULL,
  isdeleted TINYINT(1) NOT NULL DEFAULT 0,
  KEY ix_rosl_district (fk_district_id, isdeleted)) DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS rotary_org_sync_requests (
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
  KEY ix_rosr_status (Status, pk_id), KEY ix_rosr_district (fk_district_id, pk_id)) DEFAULT CHARSET=utf8mb4;";

    private sealed class Req
    {
        public long pk_id { get; set; }
        public int fk_district_id { get; set; }
        public string DistrictNumber { get; set; } = "";
        public int fk_year_id { get; set; }
        public int? fk_member_id { get; set; }
        public string TriggerType { get; set; } = "";
        public int? fk_login_id { get; set; }
        public bool SaveOnSuccess { get; set; }
        public bool SaveAllowNightly { get; set; }
        public string? OneTimeEmail { get; set; }
        public string? OneTimePasswordEnc { get; set; }
    }

    private sealed class SavedLogin
    {
        public int pk_id { get; set; }
        public int fk_district_id { get; set; }
        public int fk_year_id { get; set; }
        public int fk_member_id { get; set; }
        public string RotaryEmail { get; set; } = "";
        public string? PasswordEnc { get; set; }
        public string Status { get; set; } = "";
        public DateTime? ExpiredMailSentAt { get; set; }
        public bool isdeleted { get; set; }
    }

    private async Task<MySqlConnection> OpenAsync()
    {
        var db = new MySqlConnection(s.ConnectionString);
        await db.OpenAsync();
        return db;
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        Log.Info($"Worker started (poll {s.PollSeconds} s, weekly auto-sync {s.WeeklyDay} {s.NightlyHour:00}:00, browser {(s.Headless ? "headless" : "visible")}).");
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await using (var db = await OpenAsync()) await db.ExecuteAsync(Ddl);
                await FailStaleAsync();
                break;
            }
            catch (Exception ex) when (!ct.IsCancellationRequested)
            {
                Log.Error($"Start-up (tables / stale requests) failed: {Short(ex)} - trying again in 60 s.");
                try { await Task.Delay(60_000, ct); } catch (OperationCanceledException) { return; }
            }
        }

        while (!ct.IsCancellationRequested)
        {
            try
            {
                await FailStaleAsync();
                await MaybeNightlyAsync();
                while (!ct.IsCancellationRequested && await TakeNextAsync() is { } req) await ProcessAsync(req);
                await MaybeWeeklyReportAsync();
            }
            catch (Exception ex) { Log.Error($"Worker loop: {Short(ex)}"); }
            try { await Task.Delay(TimeSpan.FromSeconds(s.PollSeconds), ct); } catch (OperationCanceledException) { break; }
        }
        Log.Info("Worker stopped.");
    }

    // RUNNING for more than 2 h = the worker died on it (a district takes minutes).
    private async Task FailStaleAsync()
    {
        await using var db = await OpenAsync();
        var n = await db.ExecuteAsync(@"UPDATE rotary_org_sync_requests
            SET Status = 'FAILED', Stage = 'Failed', ErrorMessage = 'worker restarted', FinishedAt = NOW(), OneTimeEmail = NULL, OneTimePasswordEnc = NULL
            WHERE Status = 'RUNNING' AND (StartedAt IS NULL OR StartedAt < NOW() - INTERVAL 2 HOUR)");
        if (n > 0) Log.Warn($"{n} request(s) stuck in RUNNING for over 2 h marked FAILED (worker restarted).");
    }

    private async Task<Req?> TakeNextAsync()
    {
        await using var db = await OpenAsync();
        for (var attempt = 0; attempt < 5; attempt++)
        {
            var id = await db.ExecuteScalarAsync<long?>("SELECT pk_id FROM rotary_org_sync_requests WHERE Status = 'QUEUED' ORDER BY pk_id LIMIT 1");
            if (id == null) return null;
            var took = await db.ExecuteAsync(
                "UPDATE rotary_org_sync_requests SET Status = 'RUNNING', StartedAt = NOW(), Stage = 'Starting' WHERE pk_id = @id AND Status = 'QUEUED'", new { id });
            if (took == 1)
                return await db.QuerySingleAsync<Req>(@"SELECT pk_id, fk_district_id, TRIM(DistrictNumber) AS DistrictNumber, fk_year_id, fk_member_id, TriggerType,
                    fk_login_id, OneTimeEmail, OneTimePasswordEnc, SaveOnSuccess, SaveAllowNightly FROM rotary_org_sync_requests WHERE pk_id = @id", new { id });
        }
        return null;
    }

    private async Task<(int Id, string Label)> CurrentYearAsync(MySqlConnection db)
        => await db.QuerySingleAsync<(int, string)>("SELECT pk_year_id, YearLabel FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 ORDER BY pk_year_id LIMIT 1");

    private async Task ProcessAsync(Req req)
    {
        var started = DateTime.Now;
        var num = req.DistrictNumber.Trim();
        Log.Info($"Request {req.pk_id}: district {num}, {req.TriggerType}, {(req.fk_login_id != null ? $"saved login {req.fk_login_id}" : "one-time login")}.");
        string? password = null;
        SavedLogin? login = null;
        try
        {
            await using var db = await OpenAsync();
            var (yearId, yearLabel) = await CurrentYearAsync(db);
            if (req.fk_year_id != yearId)
            {
                await FinishAsync(req, "FAILED", "Failed", $"This request is for another Rotary year - only the current year ({yearLabel}) is synced.");
                return;
            }

            // Which Rotary.org login.
            string? email;
            if (req.fk_login_id is int lid)
            {
                login = await db.QuerySingleOrDefaultAsync<SavedLogin>(@"SELECT pk_id, fk_district_id, fk_year_id, fk_member_id, RotaryEmail, PasswordEnc, Status,
                    ExpiredMailSentAt, isdeleted FROM rotary_org_sync_logins WHERE pk_id = @lid", new { lid });
                var why = login == null || login.isdeleted ? "The saved Rotary.org login was removed."
                    : login.Status == "DISABLED" || login.fk_year_id != yearId ? "The saved Rotary.org login is for an earlier Rotary year - the District Governor must save it again."
                    : login.fk_district_id != req.fk_district_id ? "The saved Rotary.org login belongs to another district."
                    : null;
                if (why != null) { login = null; await FinishAsync(req, "FAILED", "Failed", why); return; }
                if (login!.Status == "EXPIRED")
                {
                    // Never retry a password Rotary.org already refused - the DG must update it first.
                    await FinishAsync(req, "LOGIN_FAILED", "Sign-in failed", "The saved Rotary.org password stopped working - update it on the RIZones Goal Setting page.");
                    return;
                }
                email = login.RotaryEmail;
                password = Decrypt(login.PasswordEnc);
            }
            else
            {
                email = req.OneTimeEmail;
                password = Decrypt(req.OneTimePasswordEnc);
            }
            await WipeOneTimeAsync(req.pk_id);   // read once - not kept in the table a moment longer than needed
            if (string.IsNullOrWhiteSpace(email) || string.IsNullOrEmpty(password))
            {
                await FinishAsync(req, "FAILED", "Failed", "No Rotary.org email / password was given for this sync.");
                return;
            }

            await StageAsync(req.pk_id, "Signing in to Rotary.org");
            await using var rcc = new RccSession(s, email.Trim(), password);
            try { await rcc.LoginAsync(); }
            catch (RccLoginException ex) when (ex.Kind is LoginFailure.BadCredentials or LoginFailure.Mfa)
            {
                await LoginRefusedAsync(req, login, ex);
                return;
            }

            var fetcher = new GoalsFetcher(rcc, s);
            await StageAsync(req.pk_id, "Reading Rotary years");
            var fy = (await fetcher.GetFiscalYearsAsync()).FirstOrDefault(y => GoalsFetcher.YearLabel(y.Id) == yearLabel);
            if (fy.Id == 0) { await FinishAsync(req, "FAILED", "Failed", $"Rotary.org does not list the Rotary year {yearLabel}."); return; }

            // The login must be THAT district's (user 2026-11-06): Rotary.org's "my hierarchy" gives the account's
            // own district. Anything else stops here, before any data is fetched; a saved login is switched off.
            await StageAsync(req.pk_id, "Checking the login's district");
            string? myDistrict = null;
            try
            {
                var h = await rcc.GetAsync($"/api/OrgNodes/GetMyOrgHierarchy/{fy.Id}");
                if (h.ValueKind == System.Text.Json.JsonValueKind.Object && h.TryGetProperty("MyDistrict", out var md) && md.ValueKind == System.Text.Json.JsonValueKind.Object)
                    myDistrict = Json.Str(md, "Name")?.Trim();
            }
            catch (Exception ex) { Log.Warn($"Request {req.pk_id}: my-hierarchy check failed: {ex.Message.Split((char)10)[0]}"); }
            if (!string.Equals(myDistrict, num, StringComparison.OrdinalIgnoreCase))
            {
                var msg = myDistrict == null
                    ? $"Could not confirm that this Rotary.org login belongs to District {num}. Use the District Governor's own Rotary.org login."
                    : $"This Rotary.org login belongs to District {myDistrict}, not {num}. Use District {num}'s own Rotary.org login.";
                if (login != null)
                {
                    await using var db2 = await OpenAsync();
                    await db2.ExecuteAsync("UPDATE rotary_org_sync_logins SET Status = 'DISABLED', StatusMessage = @M, AllowNightly = 0, modified_date = NOW() WHERE pk_id = @Id",
                        new { Id = login.pk_id, M = msg.Length > 500 ? msg[..500] : msg });
                }
                Log.Warn($"Request {req.pk_id}: district mismatch (login district {myDistrict ?? "unknown"}, requested {num}) - stopped.");
                await FinishAsync(req, "FAILED", "Failed", msg);
                return;
            }

            var progress = new ProgressWriter(this, req.pk_id);
            YearResult res;
            try { res = await fetcher.FetchYearAsync(fy.Id, fy.End, new[] { num }, resume: false, progress: progress.Report, useCheckpoint: false); }
            finally { await progress.StopAsync(); }

            if (res.MissingDistricts.Count > 0)
            {
                await FinishAsync(req, "FAILED", "Failed", $"District {num} is not visible to this Rotary.org account - use the District Governor's own Rotary.org login.");
                return;
            }
            if (res.Clubs.Count == 0)
            {
                await FinishAsync(req, "FAILED", "Failed", "Rotary.org returned no clubs for this district" + (res.Errors.Count > 0 ? ": " + res.Errors[0] : "."));
                return;
            }

            await StageAsync(req.pk_id, "Saving to RIZones");
            var values = DbWriter.BuildRows(ExcelOut.BuildSheets(res), res.Label)
                .Where(v => v.YearLabel == yearLabel && string.Equals(v.District, num, StringComparison.OrdinalIgnoreCase)).ToList();
            var resolved = await DbWriter.ResolveAsync(db, values);
            if (!resolved.DistrictIds.TryGetValue(num, out var did) || did != req.fk_district_id)
            {
                await FinishAsync(req, "FAILED", "Failed", $"District {num} does not match this request's district in RIZones.");
                return;
            }
            var source = $"RCC sync {DateTime.Now:yyyy-MM-dd}";
            var (written, kept) = await DbWriter.WriteAsync(db, resolved.Rows, source);
            Log.Info($"Request {req.pk_id}: district {num}: {res.Clubs.Count} clubs, {resolved.Rows.Count} values -> {written} rows written, " +
                     $"{kept} existing targets left unchanged, {resolved.UnknownClubs.Count} clubs not in RIZones skipped" +
                     (resolved.UnknownClubs.Count > 0 ? $" ({string.Join(", ", resolved.UnknownClubs.Take(20))})" : "") +
                     $", {res.Errors.Count} Rotary.org errors, {(DateTime.Now - started).TotalMinutes:0.0} min.");

            var note = res.Errors.Count > 0 ? $"Done with {res.Errors.Count} Rotary.org error(s); first: {res.Errors[0]}" : null;
            await db.ExecuteAsync(@"UPDATE rotary_org_sync_requests SET Status = 'DONE', Stage = 'Done', FinishedAt = NOW(), RowsWritten = @written,
                ClubsDone = GREATEST(ClubsDone, ClubsTotal), ErrorMessage = @note, OneTimeEmail = NULL, OneTimePasswordEnc = NULL WHERE pk_id = @id",
                new { written, note = Trunc(note, 1000), id = req.pk_id });
            if (login != null)
                await db.ExecuteAsync(@"UPDATE rotary_org_sync_logins SET Status = 'OK', LastOkAt = NOW(), StatusMessage = NULL, ExpiredMailSentAt = NULL,
                    modified_date = NOW() WHERE pk_id = @id", new { id = login.pk_id });
            else if (req.SaveOnSuccess && !string.IsNullOrEmpty(password))
            {
                // "Save my login" (user 2026-11-06): saved ONLY now - after this login proved it is this district's
                // (a wrong district's login never replaces the real DG's saved one).
                var enc = CredentialCrypto.Encrypt(password, s.CredentialKey);
                var existing = await db.ExecuteScalarAsync<int?>("SELECT pk_id FROM rotary_org_sync_logins WHERE fk_district_id = @D AND isdeleted = 0 ORDER BY pk_id DESC LIMIT 1", new { D = req.fk_district_id });
                if (existing != null)
                    await db.ExecuteAsync(@"UPDATE rotary_org_sync_logins SET fk_year_id = @Y, fk_member_id = @M, RotaryEmail = @E, PasswordEnc = @P, AllowNightly = @N,
                        Status = 'OK', StatusMessage = NULL, LastOkAt = NOW(), ExpiredMailSentAt = NULL, modified_date = NOW() WHERE pk_id = @Id",
                        new { Id = existing, Y = req.fk_year_id, M = req.fk_member_id ?? 0, E = email!.Trim(), P = enc, N = req.SaveAllowNightly });
                else
                    await db.ExecuteAsync(@"INSERT INTO rotary_org_sync_logins (fk_district_id, fk_year_id, fk_member_id, RotaryEmail, PasswordEnc, AllowNightly, Status, LastOkAt, created_date)
                        VALUES (@D, @Y, @M, @E, @P, @N, 'OK', NOW(), NOW())",
                        new { D = req.fk_district_id, Y = req.fk_year_id, M = req.fk_member_id ?? 0, E = email!.Trim(), P = enc, N = req.SaveAllowNightly });
                Log.Info($"Request {req.pk_id}: login saved for district {num} (nightly {(req.SaveAllowNightly ? "on" : "off")}).");
            }
        }
        catch (Exception ex)
        {
            var msg = Short(ex);
            if (!string.IsNullOrEmpty(password)) msg = msg.Replace(password, "***");
            Log.Error($"Request {req.pk_id}: {msg}");
            try { await FinishAsync(req, "FAILED", "Failed", msg); } catch (Exception ex2) { Log.Error($"Request {req.pk_id}: could not record the failure: {Short(ex2)}"); }
        }
        finally
        {
            try { await WipeOneTimeAsync(req.pk_id); } catch (Exception ex) { Log.Error($"Request {req.pk_id}: one-time login NOT wiped: {Short(ex)}"); }
        }
    }

    private string? Decrypt(string? enc)
    {
        if (string.IsNullOrEmpty(enc)) return null;
        try { return CredentialCrypto.Decrypt(enc, s.CredentialKey); }
        catch (Exception ex)
        {
            throw new InvalidOperationException("The Rotary.org password could not be read (is the worker's RotaryOrgSync:CredentialKey the same as the API's?) - " +
                                                ex.GetType().Name);
        }
    }

    // Rotary.org refused the login: wrong email / password -> EXPIRED (+ one mail), extra verification -> MFA.
    private async Task LoginRefusedAsync(Req req, SavedLogin? login, RccLoginException ex)
    {
        var bad = ex.Kind == LoginFailure.BadCredentials;
        Log.Warn($"Request {req.pk_id}: sign-in refused ({ex.Kind}): {ex.Message}");
        var msg = bad
            ? "Rotary.org did not accept the email / password. " + (login != null ? "Update the saved Rotary.org password on the RIZones Goal Setting page." : "Check them and try again.")
            : "Rotary.org asks for an extra verification step (code) for this login, so it cannot be used for automatic syncs.";
        await FinishAsync(req, "LOGIN_FAILED", "Sign-in failed", msg);
        if (login == null) return;

        await using var db = await OpenAsync();
        await db.ExecuteAsync("UPDATE rotary_org_sync_logins SET Status = @st, StatusMessage = @m, modified_date = NOW() WHERE pk_id = @id",
            new { st = bad ? "EXPIRED" : "MFA", m = Trunc(ex.Message, 500), id = login.pk_id });
        if (!bad || login.ExpiredMailSentAt != null) return;

        var to = await db.QuerySingleOrDefaultAsync<(string? Email, string? Name)>(
            "SELECT EmailId, MemberName FROM member_master_profile WHERE pk_member_master_profile_id = @m", new { m = login.fk_member_id });
        if (string.IsNullOrWhiteSpace(to.Email)) { Log.Warn($"Request {req.pk_id}: member {login.fk_member_id} has no email - password mail not sent."); return; }
        var html = $"<p>Dear {WebUtility.HtmlEncode(to.Name ?? "Rotarian")},</p>" +
                   $"<p>The Rotary.org (My Rotary) password saved in RIZones for District {WebUtility.HtmlEncode(req.DistrictNumber)} stopped working, " +
                   "so the automatic sync of your district's goals from Rotary Club Central has stopped.</p>" +
                   "<p>Please open the <b>Goal Setting</b> page in RIZones and update your Rotary.org password there. " +
                   "If you changed your My Rotary password recently, enter the new one.</p>" +
                   "<p>This is an automatic message - you will not get it again until the password works and stops working once more.</p>";
        if (await Mailer.SendToAsync(s, to.Email!, "RIZones: your Rotary.org password needs updating", html))
            await db.ExecuteAsync("UPDATE rotary_org_sync_logins SET ExpiredMailSentAt = NOW() WHERE pk_id = @id", new { id = login.pk_id });
    }

    private async Task FinishAsync(Req req, string status, string stage, string? error)
    {
        await using var db = await OpenAsync();
        await db.ExecuteAsync(@"UPDATE rotary_org_sync_requests SET Status = @status, Stage = @stage, ErrorMessage = @error, FinishedAt = NOW(),
            OneTimeEmail = NULL, OneTimePasswordEnc = NULL WHERE pk_id = @id", new { status, stage, error = Trunc(error, 1000), id = req.pk_id });
        if (status != "DONE") Log.Warn($"Request {req.pk_id}: {status} - {error}");
    }

    private async Task WipeOneTimeAsync(long id)
    {
        await using var db = await OpenAsync();
        await db.ExecuteAsync("UPDATE rotary_org_sync_requests SET OneTimeEmail = NULL, OneTimePasswordEnc = NULL WHERE pk_id = @id AND (OneTimeEmail IS NOT NULL OR OneTimePasswordEnc IS NOT NULL)", new { id });
    }

    private async Task StageAsync(long id, string stage, int? done = null, int? total = null)
    {
        await using var db = await OpenAsync();
        await db.ExecuteAsync(@"UPDATE rotary_org_sync_requests SET Stage = @stage, ClubsDone = COALESCE(@done, ClubsDone), ClubsTotal = COALESCE(@total, ClubsTotal)
            WHERE pk_id = @id", new { stage = Trunc(stage, 100), done, total, id });
    }

    // Auto-sync is WEEKLY on a FIXED day (user 2026-11-06): every saved login that allows it is queued on
    // WeeklyDay (default Sunday) in the hour NightlyHour (or the 2 hours after it, if a sync was running),
    // unless that district synced in the last 12 h. Old-year logins are disabled every day. The day is
    // remembered in a file so a restart does not queue again.
    private string NightlyFile => Path.Combine(s.OutputFolder, "worker-nightly-last.txt");

    private async Task MaybeNightlyAsync()
    {
        var now = DateTime.Now;
        if (now.Hour < s.NightlyHour || now.Hour >= s.NightlyHour + 3) return;
        var today = now.ToString("yyyy-MM-dd");
        try { if (File.Exists(NightlyFile) && File.ReadAllText(NightlyFile).Trim() == today) return; } catch { }

        await using var db = await OpenAsync();
        var (yearId, _) = await CurrentYearAsync(db);
        var disabled = await db.ExecuteAsync(@"UPDATE rotary_org_sync_logins SET Status = 'DISABLED', modified_date = NOW(),
            StatusMessage = 'New Rotary year - the District Governor must save their own Rotary.org login again.'
            WHERE isdeleted = 0 AND fk_year_id <> @yearId AND Status <> 'DISABLED'", new { yearId });
        if (now.DayOfWeek != s.WeeklyDay)
        {
            try { File.WriteAllText(NightlyFile, today); } catch { }
            if (disabled > 0) Log.Info($"{disabled} old-year login(s) disabled.");
            return;
        }
        var logins = (await db.QueryAsync<(int Id, int District, int Member, string Num)>(@"
            SELECT l.pk_id, l.fk_district_id, l.fk_member_id, TRIM(d.DistrictNumber)
            FROM rotary_org_sync_logins l
            JOIN district_master d ON d.pk_district_id = l.fk_district_id AND d.isdeleted = 0
            WHERE l.isdeleted = 0 AND l.AllowNightly = 1 AND l.Status IN ('OK', 'NEW') AND l.fk_year_id = @yearId
            ORDER BY l.fk_district_id, (l.Status = 'OK') DESC, l.LastOkAt DESC, l.pk_id DESC", new { yearId })).ToList();
        int queued = 0, skipped = 0;
        foreach (var l in logins.GroupBy(x => x.District).Select(g => g.First()))
        {
            var busy = await db.ExecuteScalarAsync<long>(@"SELECT COUNT(*) FROM rotary_org_sync_requests WHERE fk_district_id = @d
                AND (Status IN ('QUEUED', 'RUNNING') OR (Status = 'DONE' AND FinishedAt >= NOW() - INTERVAL 12 HOUR))", new { d = l.District });
            if (busy > 0) { skipped++; continue; }
            await db.ExecuteAsync(@"INSERT INTO rotary_org_sync_requests (fk_district_id, DistrictNumber, fk_year_id, fk_member_id, TriggerType, fk_login_id, Status)
                VALUES (@d, @num, @yearId, @m, 'NIGHTLY', @lid, 'QUEUED')", new { d = l.District, num = l.Num, yearId, m = l.Member, lid = l.Id });
            queued++;
        }
        try { File.WriteAllText(NightlyFile, today); } catch (Exception ex) { Log.Warn($"Nightly marker not saved: {Short(ex)}"); }
        Log.Info($"Nightly: {queued} request(s) queued, {skipped} district(s) skipped (already queued / synced in the last 12 h), {disabled} old-year login(s) disabled.");
    }

    // Weekly report mail (user 2026-11-06): on WeeklyDay, once that day's auto-syncs have all finished, one
    // mail to RotaryOrgSync:WeeklyReportTo listing every district whose DG ticked weekly auto-sync, with this
    // run's result. Remembered in a file so it goes once per week.
    private string WeeklyReportFile => Path.Combine(s.OutputFolder, "worker-weekly-report-last.txt");

    private async Task MaybeWeeklyReportAsync()
    {
        var now = DateTime.Now;
        var today = now.ToString("yyyy-MM-dd");
        if (now.DayOfWeek != s.WeeklyDay || s.WeeklyReportTo.Count == 0) return;
        try { if (!File.Exists(NightlyFile) || File.ReadAllText(NightlyFile).Trim() != today) return; } catch { return; }
        try { if (File.Exists(WeeklyReportFile) && File.ReadAllText(WeeklyReportFile).Trim() == today) return; } catch { }

        await using var db = await OpenAsync();
        if (await db.ExecuteScalarAsync<long>("SELECT COUNT(*) FROM rotary_org_sync_requests WHERE TriggerType = 'NIGHTLY' AND Status IN ('QUEUED', 'RUNNING')") > 0) return;
        var (yearId, yearLabel) = await CurrentYearAsync(db);
        var rows = (await db.QueryAsync<WeeklyRow>(@"
            SELECT TRIM(d.DistrictNumber) AS District, m.MemberName AS Dg, l.RotaryEmail, l.Status AS LoginStatus,
                   r.Status AS RunStatus, r.TriggerType, r.ClubsTotal, r.RowsWritten, r.FinishedAt, r.ErrorMessage
            FROM rotary_org_sync_logins l
            JOIN district_master d ON d.pk_district_id = l.fk_district_id
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = l.fk_member_id
            LEFT JOIN rotary_org_sync_requests r ON r.pk_id = (SELECT MAX(x.pk_id) FROM rotary_org_sync_requests x
                 WHERE x.fk_district_id = l.fk_district_id AND x.created_date >= NOW() - INTERVAL 24 HOUR)
            WHERE l.isdeleted = 0 AND l.AllowNightly = 1 AND l.fk_year_id = @yearId
            ORDER BY CAST(d.DistrictNumber AS CHAR)", new { yearId })).ToList();

        string Result(WeeklyRow r) => r.LoginStatus is "EXPIRED" ? "Not synced - Rotary.org password changed (DG must update it)"
            : r.LoginStatus is "MFA" ? "Not synced - Rotary.org asks for extra verification"
            : r.RunStatus == "DONE" ? (r.TriggerType == "NIGHTLY" ? "Synced" : "Synced (manual sync in the last 24 h)")
            : r.RunStatus == null ? "Not synced" : $"Failed: {r.ErrorMessage}";
        var ok = rows.Count(r => r.RunStatus == "DONE" && r.LoginStatus is not ("EXPIRED" or "MFA"));
        var enc = (string? v) => WebUtility.HtmlEncode(v ?? "");
        var td = "style=\"border:1px solid #ccc;padding:4px 8px\"";
        var html = $"<p>Weekly Rotary.org goal sync ({enc(yearLabel)}) - {now:dd MMM yyyy}.</p>" +
                   $"<p><b>{rows.Count}</b> district(s) have weekly auto-sync ticked: <b>{ok}</b> synced, <b>{rows.Count - ok}</b> not synced.</p>" +
                   (rows.Count == 0 ? "<p>No District Governor has ticked weekly auto-sync yet.</p>" :
                   $"<table style=\"border-collapse:collapse;font-family:Arial;font-size:13px\"><tr><th {td}>District</th><th {td}>DG (saved login)</th><th {td}>Result</th><th {td}>Clubs</th><th {td}>Rows written</th><th {td}>Finished</th></tr>" +
                   string.Concat(rows.Select(r => $"<tr><td {td}>{enc(r.District)}</td><td {td}>{enc(r.Dg)}<br><small>{enc(r.RotaryEmail)}</small></td><td {td}>{enc(Result(r))}</td>" +
                       $"<td {td}>{(r.RunStatus == "DONE" ? r.ClubsTotal.ToString() : "")}</td><td {td}>{(r.RunStatus == "DONE" ? r.RowsWritten.ToString() : "")}</td><td {td}>{r.FinishedAt:dd MMM HH:mm}</td></tr>")) +
                   "</table>") +
                   "<p>Automatic message from the RIZones Rotary.org sync worker.</p>";
        var subject = $"RIZones: weekly Rotary.org sync - {ok} of {rows.Count} district(s) synced ({now:dd MMM yyyy})";
        foreach (var to in s.WeeklyReportTo) await Mailer.SendToAsync(s, to, subject, html);
        try { File.WriteAllText(WeeklyReportFile, today); } catch (Exception ex) { Log.Warn($"Weekly report marker not saved: {Short(ex)}"); }
        Log.Info($"Weekly report: {rows.Count} district(s) ticked, {ok} synced.");
    }

    private sealed class WeeklyRow
    {
        public string District { get; set; } = "";
        public string? Dg { get; set; }
        public string? RotaryEmail { get; set; }
        public string LoginStatus { get; set; } = "";
        public string? RunStatus { get; set; }
        public string? TriggerType { get; set; }
        public int ClubsTotal { get; set; }
        public int RowsWritten { get; set; }
        public DateTime? FinishedAt { get; set; }
        public string? ErrorMessage { get; set; }
    }

    /// Throttled progress: stage changes at once, club counts every 5 clubs or 5 seconds.
    private sealed class ProgressWriter
    {
        private readonly SyncWorker _w;
        private readonly long _id;
        private readonly CancellationTokenSource _cts = new();
        private readonly Task _loop;
        private FetchProgress? _latest, _written;
        private DateTime _writtenAt = DateTime.MinValue;

        public ProgressWriter(SyncWorker w, long id) { _w = w; _id = id; _loop = Task.Run(LoopAsync); }

        public void Report(FetchProgress p) => Interlocked.Exchange(ref _latest, p);

        private async Task LoopAsync()
        {
            while (!_cts.IsCancellationRequested)
            {
                try { await Task.Delay(1000, _cts.Token); } catch (OperationCanceledException) { break; }
                await FlushAsync(false);
            }
        }

        private async Task FlushAsync(bool force)
        {
            var p = Volatile.Read(ref _latest);
            if (p == null || p == _written) return;
            var due = force || _written == null || p.Stage != _written.Stage || p.ClubsTotal != _written.ClubsTotal
                      || Math.Abs(p.ClubsDone - _written.ClubsDone) >= 5 || DateTime.UtcNow - _writtenAt >= TimeSpan.FromSeconds(5);
            if (!due) return;
            try
            {
                await _w.StageAsync(_id, p.Stage, p.ClubsDone, p.ClubsTotal);
                _written = p;
                _writtenAt = DateTime.UtcNow;
            }
            catch (Exception ex) { Log.Warn($"Request {_id}: progress not saved: {Short(ex)}"); }
        }

        public async Task StopAsync()
        {
            _cts.Cancel();
            try { await _loop; } catch { }
            await FlushAsync(true);
        }
    }

    private static string Short(Exception ex) => Trunc(ex.Message.Split('\n')[0].Trim(), 500)!;   // first line only - never headers / cookies
    private static string? Trunc(string? t, int n) => t == null ? null : t.Length <= n ? t : t[..n];
}
