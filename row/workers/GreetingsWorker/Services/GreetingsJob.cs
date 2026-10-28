using System.Globalization;
using Dapper;
using Microsoft.Extensions.Logging;
using MySqlConnector;
using RotaryApi.Services.Localization;

namespace GreetingsWorker.Services;

// Core daily job: greet every active member whose BIRTHDAY or wedding ANNIVERSARY is today.
//   • Club greetings  → each active club whose greeting config is enabled greets its members.
//   • District greetings → each active district whose config is enabled greets members across its clubs.
//   • "Send both": a member covered by an enabled club AND district gets one greeting from each.
//   • Channels per config: Email (Brevo) and push (Firebase).
//   • Credits: each send deducts 1 from the source's club/district credits (unless DeductCredits=false).
//   • Idempotency: greeting_send_log keys on (member, occasion, channel, sourceType, sourceId, date),
//     so a re-run never double-sends; a prior 'failed'/'skipped' entry is retried.
//   • Time zones (N12): the job runs every hour. Each source works out its local date and hour from its district's
//     zone (ZoneTime); it is greeted from SendHour local (08:00) once per local day: a 'Run' row (member 0) in
//     greeting_send_log marks it done, and every log row carries the source's local date.
public class GreetingsJob
{
    private readonly string _conn;
    private readonly ILogger<GreetingsJob> _log;
    private readonly BrevoEmailSender _email;
    private readonly FirebasePushSender _push;
    private readonly GreetingsOptions _opt;

    public GreetingsJob(string connectionString, ILogger<GreetingsJob> log,
        BrevoEmailSender email, FirebasePushSender push, GreetingsOptions opt)
    {
        _conn = connectionString;
        _log = log;
        _email = email;
        _push = push;
        _opt = opt;
    }

    public class RunStats
    {
        public DateTime RunStartedAt { get; set; }
        public DateTime RunCompletedAt { get; set; }
        public int ClubsProcessed { get; set; }
        public int DistrictsProcessed { get; set; }
        public int EmailSent { get; set; }
        public int EmailFailed { get; set; }
        public int PushSent { get; set; }
        public int PushFailed { get; set; }
        public int Skipped { get; set; }
        public int NotDue { get; set; }      // sources before their local SendHour, or already done today
    }

    // ── config resolved per occasion ──────────────────────────────────────
    private const string Birthday = "Birthday";
    private const string Anniversary = "Anniversary";
    private const string ChEmail = "Email";
    private const string ChPush = "Push";

    // Language, EmailBlocked, PushBlocked: N5 communication (blocked = unsubscribed or suppressed; 0 while the module is off).
    private record Celebrant(int MemberId, string MemberName, string? Mobile, string? Email, string? DeviceToken,
        string? Language, long EmailBlocked, long PushBlocked);

    // Holds one source's (club or district) enabled greeting config.
    private class SourceConfig
    {
        public int SourceId;
        public bool IsDistrict;
        public string SourceName = "";        // {{3}} — club or district display name
        public bool BirthdayOn, AnniversaryOn;
        public bool SendEmailChannel;         // club: always true; district: IsGreetingSendEmail
        public bool SendPush;                 // club: on (gated per-occasion by notify flag); district: IsGreetingSendPush
        public bool BirthdayEmailOn, AnniversaryEmailOn;
        public string? BirthdayGreeting, AnniversaryGreeting;
        public string? BirthdayEmailSubject, BirthdayEmailMessage;
        public string? AnniversaryEmailSubject, AnniversaryEmailMessage;
        public string? OfficerName;        // current-year DG (district) / Club President (club)
        public string OfficerTitle = "";   // "District Governor" / "Club President"
        public int? ReviewedYearId;        // GreetingReviewedYearId — year the Greetings Settings page was last saved for
        // N5 communication (module on): language versions of the 'birthday' / 'anniversary' templates, the source's
        // language, and for club greetings the district's Governor note (null when the district has it off).
        public Dictionary<string, RotaryApi.Services.CommsTemplates.Template> BirthdayVersions = new(), AnniversaryVersions = new();
        public string Language = "";
        public string? GovernorNoteHtml;
        public string FoundationLink = "";   // {{foundation_link}}: the district's giving link, "" = none
    }

    private bool _comms;              // N5 communication module on (platform_features 'communication')

    private bool _dryRun;
    private int _refMonth, _refDay;   // the month/day matched against BirthDate/AnniversaryDate (current source)
    private DateTime _day;            // the current source's local date: SendDate of its log rows
    private DateTime _utcNow;         // the run's clock (--now mocks it)
    private DateTime? _dateOverride;  // --date: match this date, no SendHour wait
    private bool _scheduled;          // full run (no scope, no --date, not dry): skip sources already done today
    private Dictionary<int, TimeZoneInfo> _zones = new();   // district id -> time zone
    private int? _currentYearId;      // rotary_year_master.IsCurrent = 1
    private string? _currentYearLabel;
    private bool _hasReviewedYearColumn; // GreetingReviewedYearId present on both club_master + district_master

    // Selected as-is when the column exists; otherwise NULL so the pause rule is simply off (never blocks sends).
    private string ReviewedYearSelect => _hasReviewedYearColumn ? "GreetingReviewedYearId" : "NULL AS GreetingReviewedYearId";

    // clubNameFilter / districtNumberFilter scope a TEST run:
    //   • both null      → full run (all enabled clubs + all enabled districts)
    //   • clubName set    → only that club is processed
    //   • districtNumber set → only that district is processed
    //   • if EITHER is set, the OTHER source type is skipped unless it too is set
    //     (so "--club-name X" runs ONLY club X, no districts; both set runs exactly those two).
    public async Task<RunStats> RunAsync(bool dryRun = false, string? clubNameFilter = null, string? districtNumberFilter = null, DateTime? overrideDate = null, DateTime? utcNow = null)
    {
        _dryRun = dryRun;
        _utcNow = utcNow ?? DateTime.UtcNow;
        _dateOverride = overrideDate?.Date;
        _scheduled = !dryRun && overrideDate == null && string.IsNullOrWhiteSpace(clubNameFilter) && string.IsNullOrWhiteSpace(districtNumberFilter);
        var stats = new RunStats { RunStartedAt = DateTime.Now };
        await using var conn = new MySqlConnection(_conn);
        await conn.OpenAsync();
        await ServerStrings.LoadAsync(conn); // S5: push wording in the source's language
        if (!dryRun) await EnsureLogTableAsync(conn);   // dry-run is strictly read-only — no schema change
        _zones = await RotaryApi.Services.ZoneTime.DistrictZonesAsync(conn);
        _comms = await RotaryApi.Services.CommsTemplates.IsOnAsync(conn);

        // Current Rotary year — used to resolve the DG / Club President for the signature.
        var yr = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT pk_year_id AS Id, YearLabel AS Label FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1");
        _currentYearId = yr != null ? (int?)yr.Id : null;
        _currentYearLabel = yr != null ? (string?)yr.Label : null;

        _hasReviewedYearColumn = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('club_master', 'district_master')
              AND COLUMN_NAME = 'GreetingReviewedYearId'") == 2;
        if (!_hasReviewedYearColumn)
            _log.LogWarning("GreetingReviewedYearId column missing — stale-message pause rule is OFF for this run.");

        bool clubScoped = !string.IsNullOrWhiteSpace(clubNameFilter);
        bool districtScoped = !string.IsNullOrWhiteSpace(districtNumberFilter);
        bool scoped = clubScoped || districtScoped;

        if (clubScoped || !scoped) await ProcessClubsAsync(conn, stats, clubNameFilter);
        if (districtScoped || !scoped) await ProcessDistrictsAsync(conn, stats, districtNumberFilter);

        stats.RunCompletedAt = DateTime.Now;
        return stats;
    }

    private static async Task EnsureLogTableAsync(MySqlConnection conn)
    {
        await conn.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS greeting_send_log (
                pk_id        BIGINT AUTO_INCREMENT PRIMARY KEY,
                fk_member_id INT NOT NULL,
                Occasion     VARCHAR(20)  NOT NULL,
                Channel      VARCHAR(20)  NOT NULL,
                SourceType   VARCHAR(20)  NOT NULL,
                SourceId     INT NOT NULL,
                SendDate     DATE NOT NULL,
                Status       VARCHAR(20)  NOT NULL,
                Detail       VARCHAR(500) NULL,
                created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uk_greeting (fk_member_id, Occasion, Channel, SourceType, SourceId, SendDate),
                INDEX idx_date (SendDate)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");
    }

    // ── CLUB greetings ────────────────────────────────────────────────────
    private async Task ProcessClubsAsync(MySqlConnection conn, RunStats stats, string? clubNameFilter)
    {
        var nameClause = string.IsNullOrWhiteSpace(clubNameFilter) ? "" : " AND ClubName = @ClubName ";
        var clubs = (await conn.QueryAsync<dynamic>($@"
            SELECT pk_club_id AS ClubId, ClubName, fk_district_id AS DistrictId,
                   IsEnableBirthdayNotification, IsEnableAnniversaryNotification,
                   BirthdayGreeting, AnniversaryGreeting,
                   IsEnableBirthdayEmail, BirthdayEmailSubject, BirthdayEmailMessage,
                   IsEnableAnniversaryEmail, AnniversaryEmailSubject, AnniversaryEmailMessage,
                   {ReviewedYearSelect},
                   (SELECT m.MemberName FROM board_of_directors b
                      JOIN designation_master dd ON dd.pk_designation_id = b.fk_designation_id
                      JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id AND COALESCE(m.isdeleted,0) = 0
                    WHERE b.fk_club_id = club_master.pk_club_id AND b.fk_year_id = @CurrentYearId AND b.isdeleted = 0
                      AND dd.designation_name = 'Club President'
                    ORDER BY b.pk_board_director_id DESC LIMIT 1) AS PresidentName
            FROM club_master
            WHERE isdeleted = 0 AND IsActive = 1
              AND (IsEnableBirthdayNotification = 1 OR IsEnableAnniversaryNotification = 1
                   OR IsEnableBirthdayEmail = 1 OR IsEnableAnniversaryEmail = 1)
              {nameClause}", new { ClubName = clubNameFilter, CurrentYearId = _currentYearId })).ToList();

        var governorNotes = new Dictionary<int, string?>();   // per district, for this run
        foreach (var c in clubs)
        {
            var cfg = new SourceConfig
            {
                SourceId = (int)c.ClubId,
                IsDistrict = false,
                SourceName = (string?)c.ClubName ?? "your Rotary Club",
                BirthdayOn = ToBool(c.IsEnableBirthdayNotification),
                AnniversaryOn = ToBool(c.IsEnableAnniversaryNotification),
                SendEmailChannel = true, // clubs have no separate email-channel master; gated per occasion
                SendPush = true,         // clubs: push on, gated per-occasion by the notification flag (like email)
                BirthdayEmailOn = ToBool(c.IsEnableBirthdayEmail),
                AnniversaryEmailOn = ToBool(c.IsEnableAnniversaryEmail),
                BirthdayGreeting = c.BirthdayGreeting, AnniversaryGreeting = c.AnniversaryGreeting,
                BirthdayEmailSubject = c.BirthdayEmailSubject, BirthdayEmailMessage = c.BirthdayEmailMessage,
                AnniversaryEmailSubject = c.AnniversaryEmailSubject, AnniversaryEmailMessage = c.AnniversaryEmailMessage,
                OfficerName = c.PresidentName, OfficerTitle = "Club President",
                ReviewedYearId = c.GreetingReviewedYearId == null ? null : (int?)Convert.ToInt32(c.GreetingReviewedYearId),
            };
            if (!await DueAsync(conn, cfg, (int?)c.DistrictId, stats)) continue;
            stats.ClubsProcessed++;
            if (_comms) await LoadCommsAsync(conn, cfg, governorNotes, (int?)c.DistrictId);
            await GreetForSourceAsync(conn, cfg,
                birthdayMembersSql: ClubMembersByDateSql("BirthDate", _comms),
                anniversaryMembersSql: ClubMembersByDateSql("AnniversaryDate", _comms),
                sqlParams: new { ClubId = cfg.SourceId, RefMonth = _refMonth, RefDay = _refDay }, stats);
            await MarkDoneAsync(conn, cfg);
        }
    }

    // ── DISTRICT greetings ────────────────────────────────────────────────
    private async Task ProcessDistrictsAsync(MySqlConnection conn, RunStats stats, string? districtNumberFilter)
    {
        var numClause = string.IsNullOrWhiteSpace(districtNumberFilter) ? "" : " AND DistrictNumber = @DistrictNumber ";
        var districts = (await conn.QueryAsync<dynamic>($@"
            SELECT pk_district_id AS DistrictId, DistrictNumber,
                   IsEnableBirthdayNotification, IsEnableAnniversaryNotification,
                   IsGreetingSendEmail, IsGreetingSendPush,
                   BirthdayGreeting, AnniversaryGreeting,
                   IsEnableBirthdayEmail, BirthdayEmailSubject, BirthdayEmailMessage,
                   IsEnableAnniversaryEmail, AnniversaryEmailSubject, AnniversaryEmailMessage,
                   {ReviewedYearSelect},
                   -- LEFT JOIN: a DG who is not a member of any club carries their name on the
                   -- district_governors row, and an INNER JOIN would blank DgName in the greeting.
                   (SELECT CASE WHEN m.pk_member_master_profile_id IS NULL THEN g.member_name ELSE m.MemberName END
                      FROM district_governors g
                      LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = g.fk_member_id AND COALESCE(m.isdeleted,0) = 0
                    WHERE g.fk_district_id = district_master.pk_district_id AND g.fk_year_id = @CurrentYearId AND g.isdeleted = 0
                    ORDER BY g.pk_id DESC LIMIT 1) AS DgName
            FROM district_master
            WHERE isdeleted = 0 AND IsActive = 1
              AND (IsEnableBirthdayNotification = 1 OR IsEnableAnniversaryNotification = 1
                   OR IsEnableBirthdayEmail = 1 OR IsEnableAnniversaryEmail = 1)
              {numClause}", new { DistrictNumber = districtNumberFilter, CurrentYearId = _currentYearId })).ToList();

        foreach (var d in districts)
        {
            var cfg = new SourceConfig
            {
                SourceId = (int)d.DistrictId,
                IsDistrict = true,
                SourceName = $"RI District {(string?)d.DistrictNumber}".Trim(),
                BirthdayOn = ToBool(d.IsEnableBirthdayNotification),
                AnniversaryOn = ToBool(d.IsEnableAnniversaryNotification),
                SendEmailChannel = ToBool(d.IsGreetingSendEmail),
                SendPush = ToBool(d.IsGreetingSendPush),
                BirthdayEmailOn = ToBool(d.IsEnableBirthdayEmail),
                AnniversaryEmailOn = ToBool(d.IsEnableAnniversaryEmail),
                BirthdayGreeting = d.BirthdayGreeting, AnniversaryGreeting = d.AnniversaryGreeting,
                BirthdayEmailSubject = d.BirthdayEmailSubject, BirthdayEmailMessage = d.BirthdayEmailMessage,
                AnniversaryEmailSubject = d.AnniversaryEmailSubject, AnniversaryEmailMessage = d.AnniversaryEmailMessage,
                OfficerName = d.DgName, OfficerTitle = "District Governor",
                ReviewedYearId = d.GreetingReviewedYearId == null ? null : (int?)Convert.ToInt32(d.GreetingReviewedYearId),
            };
            if (!await DueAsync(conn, cfg, cfg.SourceId, stats)) continue;
            stats.DistrictsProcessed++;
            if (_comms) await LoadCommsAsync(conn, cfg, null, null);
            await GreetForSourceAsync(conn, cfg,
                birthdayMembersSql: DistrictMembersByDateSql("BirthDate", _comms),
                anniversaryMembersSql: DistrictMembersByDateSql("AnniversaryDate", _comms),
                sqlParams: new { DistrictId = cfg.SourceId, RefMonth = _refMonth, RefDay = _refDay }, stats);
            await MarkDoneAsync(conn, cfg);
        }
    }

    // N12: sets the source's local date (_day) and the month/day to match, from its district's time zone. Not due
    // before SendHour local (unless --date is given) or, in a full run, when its 'Run' row for the local date exists.
    private async Task<bool> DueAsync(MySqlConnection conn, SourceConfig cfg, int? districtId, RunStats stats)
    {
        var zone = districtId is int id && _zones.TryGetValue(id, out var z) ? z : RotaryApi.Services.ZoneTime.Find(null);
        var local = RotaryApi.Services.ZoneTime.Local(zone, _utcNow);
        _day = local.Date;
        var match = _dateOverride ?? _day;
        _refMonth = match.Month;
        _refDay = match.Day;
        var state = _dateOverride == null && local.Hour < _opt.SendHour ? $"waiting for {_opt.SendHour:00}:00"
            : _scheduled && await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM greeting_send_log
                WHERE fk_member_id = 0 AND Occasion = 'Run' AND SourceType = @T AND SourceId = @S AND SendDate = @Day",
                new { T = cfg.IsDistrict ? "District" : "Club", S = cfg.SourceId, Day = _day }) > 0 ? "done today" : "due";
        if (_dryRun)
            Console.WriteLine($"[DRY] {(cfg.IsDistrict ? "District" : "Club")} #{cfg.SourceId} '{cfg.SourceName}': " +
                $"{RotaryApi.Services.ZoneTime.IanaId(zone)} local {local:yyyy-MM-dd HH:mm}, match {match:MM-dd}, {state}");
        if (state == "due") return true;
        stats.NotDue++;
        return false;
    }

    // The source is done for its local date: later hourly runs that day skip it.
    private async Task MarkDoneAsync(MySqlConnection conn, SourceConfig cfg)
    {
        if (_dryRun) return;
        await conn.ExecuteAsync(@"
            INSERT INTO greeting_send_log (fk_member_id, Occasion, Channel, SourceType, SourceId, SendDate, Status, Detail)
            VALUES (0, 'Run', 'All', @T, @S, @Day, 'done', NULL)
            ON DUPLICATE KEY UPDATE Status = VALUES(Status), created_at = NOW()",
            new { T = cfg.IsDistrict ? "District" : "Club", S = cfg.SourceId, Day = _day });
    }

    // N5: the source's template versions and language; a club greeting also carries its district's Governor note.
    private static async Task LoadCommsAsync(MySqlConnection conn, SourceConfig cfg, Dictionary<int, string?>? governorNotes, int? districtOfClub)
    {
        int club = cfg.IsDistrict ? 0 : cfg.SourceId, district = cfg.IsDistrict ? cfg.SourceId : 0;
        cfg.BirthdayVersions = await RotaryApi.Services.CommsTemplates.LoadAsync(conn, club, district, "birthday");
        cfg.AnniversaryVersions = await RotaryApi.Services.CommsTemplates.LoadAsync(conn, club, district, "anniversary");
        cfg.Language = await RotaryApi.Services.CommsTemplates.DefaultLanguageAsync(conn, club, district);
        // a club greeting uses its district's link
        cfg.FoundationLink = await RotaryApi.Services.CommsTemplates.FoundationLinkAsync(conn, cfg.IsDistrict ? cfg.SourceId : districtOfClub ?? 0);
        if (governorNotes != null && districtOfClub is int d && d > 0)
        {
            if (!governorNotes.TryGetValue(d, out var note))
                governorNotes[d] = note = await RotaryApi.Services.CommsTemplates.GovernorNoteHtmlAsync(conn, d);
            cfg.GovernorNoteHtml = note;
        }
    }

    // N5 columns of a celebrant row: language, and whether email / push are blocked (unsubscribed or suppressed).
    private static string CommsColumns(bool comms, string clubExpr, string districtExpr) => comms
        ? $@"m.PrimaryLanguage AS Language,
               CAST({RotaryApi.Services.CommsTemplates.EmailBlockedSql("m.pk_member_master_profile_id", "m.EmailId", clubExpr, districtExpr)} AS SIGNED) AS EmailBlocked,
               CAST({RotaryApi.Services.CommsTemplates.PushBlockedSql("m.pk_member_master_profile_id")} AS SIGNED) AS PushBlocked"
        : "m.PrimaryLanguage AS Language, CAST(0 AS SIGNED) AS EmailBlocked, CAST(0 AS SIGNED) AS PushBlocked";

    private static string ClubMembersByDateSql(string dateCol, bool comms) => $@"
        SELECT m.pk_member_master_profile_id AS MemberId, m.MemberName,
               m.PrimaryMobileNumber AS Mobile, m.EmailId AS Email, m.LastDeviceToken AS DeviceToken,
               {CommsColumns(comms, "@ClubId", "0")}
        FROM club_members cm
        JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
        WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0
          AND m.{dateCol} IS NOT NULL
          AND MONTH(m.{dateCol}) = @RefMonth AND DAY(m.{dateCol}) = @RefDay";

    private static string DistrictMembersByDateSql(string dateCol, bool comms) => $@"
        SELECT DISTINCT m.pk_member_master_profile_id AS MemberId, m.MemberName,
               m.PrimaryMobileNumber AS Mobile, m.EmailId AS Email, m.LastDeviceToken AS DeviceToken,
               {CommsColumns(comms, "0", "@DistrictId")}
        FROM club_members cm
        JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0 AND c.IsActive = 1
        JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
        WHERE c.fk_district_id = @DistrictId AND cm.IsActive = 1 AND cm.isdeleted = 0
          AND m.{dateCol} IS NOT NULL
          AND MONTH(m.{dateCol}) = @RefMonth AND DAY(m.{dateCol}) = @RefDay";

    private async Task GreetForSourceAsync(MySqlConnection conn, SourceConfig cfg,
        string birthdayMembersSql, string anniversaryMembersSql, object sqlParams, RunStats stats)
    {
        if (IsPaused(cfg))
        {
            await LogPausedAsync(conn, cfg, birthdayMembersSql, anniversaryMembersSql, sqlParams, stats);
            return;
        }

        if (cfg.BirthdayOn || cfg.BirthdayEmailOn)
        {
            var celebrants = (await conn.QueryAsync<Celebrant>(birthdayMembersSql, sqlParams)).ToList();
            foreach (var m in celebrants) await GreetMemberAsync(conn, cfg, Birthday, m, stats);
        }
        if (cfg.AnniversaryOn || cfg.AnniversaryEmailOn)
        {
            var celebrants = (await conn.QueryAsync<Celebrant>(anniversaryMembersSql, sqlParams)).ToList();
            foreach (var m in celebrants) await GreetMemberAsync(conn, cfg, Anniversary, m, stats);
        }

        // Broadcast "celebrations today" digest to ALL members of the source (not just celebrants).
        await SendCelebrationsDigestAsync(conn, cfg, birthdayMembersSql, anniversaryMembersSql, sqlParams, stats);
    }

    // Stale-message pause: the admin-typed text (any of the 4 message fields) often names that year's
    // DG / Club President, so once a new Rotary year starts (1 July) a message that was not re-saved on
    // the Greetings Settings page pauses EVERY channel for the source — email, push and the
    // digest — until someone saves it again. Blank messages never pause (the neutral default goes out).
    private bool IsPaused(SourceConfig cfg)
    {
        if (!_hasReviewedYearColumn || !_currentYearId.HasValue) return false;
        bool hasCustomText = !string.IsNullOrWhiteSpace(cfg.BirthdayGreeting) || !string.IsNullOrWhiteSpace(cfg.AnniversaryGreeting)
            || !string.IsNullOrWhiteSpace(cfg.BirthdayEmailMessage) || !string.IsNullOrWhiteSpace(cfg.AnniversaryEmailMessage);
        return hasCustomText && cfg.ReviewedYearId != _currentYearId;
    }

    // Logged once per paused source per day, only when someone was actually due a greeting today, as a
    // sentinel row (member=0, Occasion='Paused') so --diagnose / the log explains the missing greetings.
    private async Task LogPausedAsync(MySqlConnection conn, SourceConfig cfg,
        string birthdayMembersSql, string anniversaryMembersSql, object sqlParams, RunStats stats)
    {
        int birthdays = cfg.BirthdayOn || cfg.BirthdayEmailOn ? (await conn.QueryAsync<Celebrant>(birthdayMembersSql, sqlParams)).Count() : 0;
        int anniversaries = cfg.AnniversaryOn || cfg.AnniversaryEmailOn ? (await conn.QueryAsync<Celebrant>(anniversaryMembersSql, sqlParams)).Count() : 0;
        if (birthdays + anniversaries == 0) return;

        var sourceType = cfg.IsDistrict ? "District" : "Club";
        var detail = $"paused: greeting message not saved for {_currentYearLabel} ({birthdays}b/{anniversaries}a not greeted)";
        stats.Skipped += birthdays + anniversaries;

        if (_dryRun)
        {
            Console.WriteLine($"[DRY] PAUSED {sourceType} '{cfg.SourceName}': {detail}");
            return;
        }

        await conn.ExecuteAsync(@"
            INSERT INTO greeting_send_log (fk_member_id, Occasion, Channel, SourceType, SourceId, SendDate, Status, Detail)
            VALUES (0, 'Paused', 'All', @T, @S, @Day, 'skipped', @D)
            ON DUPLICATE KEY UPDATE Status=VALUES(Status), Detail=VALUES(Detail), created_at=NOW()",
            new { T = sourceType, S = cfg.SourceId, D = detail, Day = _day });
    }

    // One broadcast push per source per day summarising today's celebrations. Free (no credit), push-only,
    // opens the app calendar (data.type = "celebrations_digest", no IDs — per Firebase_Notification_Routes.md).
    // Gated by the same push toggle as personal greetings; counts each occasion only if its notification is on.
    private async Task SendCelebrationsDigestAsync(MySqlConnection conn, SourceConfig cfg,
        string birthdayMembersSql, string anniversaryMembersSql, object sqlParams, RunStats stats)
    {
        if (!cfg.SendPush) return;

        var sourceType = cfg.IsDistrict ? "District" : "Club";
        int birthdays = cfg.BirthdayOn ? (await conn.QueryAsync<Celebrant>(birthdayMembersSql, sqlParams)).Count() : 0;
        int anniversaries = cfg.AnniversaryOn ? (await conn.QueryAsync<Celebrant>(anniversaryMembersSql, sqlParams)).Count() : 0;
        if (birthdays + anniversaries == 0) return;   // nothing to celebrate → no broadcast

        var body = await BuildDigestBodyAsync(conn, cfg, birthdays, anniversaries);

        if (_dryRun)
        {
            Console.WriteLine($"[DRY] Digest -> all members of {sourceType} '{cfg.SourceName}': \"{body}\"");
            stats.PushSent++;
            return;
        }

        if (await DigestAlreadySentAsync(conn, sourceType, cfg.SourceId)) return;   // one per source per day

        var tokens = await ResolveAllMemberTokensAsync(conn, cfg);
        if (tokens.Count == 0)
        {
            await LogDigestAsync(conn, sourceType, cfg.SourceId, "skipped", "no device tokens");
            return;
        }

        var title = await TextAsync(conn, cfg, "Celebrations · {0}", cfg.SourceName);
        var data = new Dictionary<string, string> { ["type"] = "celebrations_digest" };
        var (sent, failed) = await _push.SendMulticastAsync(tokens, title, body, data);
        stats.PushSent += sent;
        stats.PushFailed += failed;
        await LogDigestAsync(conn, sourceType, cfg.SourceId,
            sent > 0 ? "sent" : "failed",
            $"{birthdays}b/{anniversaries}a to {tokens.Count} devices (sent={sent}, failed={failed})");
    }

    private static async Task<string> BuildDigestBodyAsync(MySqlConnection conn, SourceConfig cfg, int birthdays, int anniversaries)
    {
        var parts = new List<string>();
        if (birthdays > 0) parts.Add(birthdays == 1 ? await TextAsync(conn, cfg, "1 birthday") : await TextAsync(conn, cfg, "{0} birthdays", birthdays));
        if (anniversaries > 0) parts.Add(anniversaries == 1 ? await TextAsync(conn, cfg, "1 anniversary") : await TextAsync(conn, cfg, "{0} anniversaries", anniversaries));
        var line = parts.Count == 2
            ? await TextAsync(conn, cfg, "{0} and {1} to celebrate today", parts[0], parts[1])
            : await TextAsync(conn, cfg, "{0} to celebrate today", parts[0]);
        return $"{line} 🎉";
    }

    /// <summary>
    /// S5: a fixed text in the source's language (the club's, else its district's), from server_strings. The text is
    /// recorded for the API's translator; until it is translated, or with no provider, it stays English.
    /// shortcut: the source's language, not each member's: digests are one multicast per source.
    /// </summary>
    private static async Task<string> TextAsync(MySqlConnection conn, SourceConfig cfg, string english, params object[] args)
    {
        await ServerStrings.RegisterAsync(conn, english);
        if (string.IsNullOrEmpty(cfg.Language)) // set by LoadCommsAsync only while the communication module is on
            cfg.Language = await RotaryApi.Services.CommsTemplates.DefaultLanguageAsync(conn, cfg.IsDistrict ? 0 : cfg.SourceId, cfg.IsDistrict ? cfg.SourceId : 0);
        var text = ServerStrings.Find(cfg.Language, english) ?? english;
        try { return string.Format(CultureInfo.InvariantCulture, text, args); }
        catch (FormatException) { return string.Format(CultureInfo.InvariantCulture, english, args); }
    }

    // All active members of the source with a usable device token (club → its members; district → members
    // across its active clubs). Mirrors the greeting member scoping, minus the date filter. No logout filter.
    private async Task<IReadOnlyList<string>> ResolveAllMemberTokensAsync(MySqlConnection conn, SourceConfig cfg)
    {
        var sql = cfg.IsDistrict
            ? @"SELECT DISTINCT m.LastDeviceToken
                FROM club_members cm
                JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0 AND c.IsActive = 1
                JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
                WHERE c.fk_district_id = @Id AND cm.IsActive = 1 AND cm.isdeleted = 0
                  AND m.LastDeviceToken IS NOT NULL AND TRIM(m.LastDeviceToken) <> '' AND m.LastDeviceToken <> '0'"
            : @"SELECT DISTINCT m.LastDeviceToken
                FROM club_members cm
                JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
                WHERE cm.fk_club_id = @Id AND cm.IsActive = 1 AND cm.isdeleted = 0
                  AND m.LastDeviceToken IS NOT NULL AND TRIM(m.LastDeviceToken) <> '' AND m.LastDeviceToken <> '0'";
        return (await conn.QueryAsync<string>(sql, new { Id = cfg.SourceId })).ToList();
    }

    private async Task<bool> DigestAlreadySentAsync(MySqlConnection conn, string sourceType, int sourceId)
    {
        var n = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM greeting_send_log
            WHERE fk_member_id=0 AND Occasion='Digest' AND Channel='Push' AND SourceType=@T AND SourceId=@S
              AND SendDate=@Day AND Status='sent'",
            new { T = sourceType, S = sourceId, Day = _day });
        return n > 0;
    }

    // Logs the digest as a sentinel row (member=0). Stats are already updated by the caller with the real
    // device counts, so this does NOT touch stats (unlike LogAsync).
    private async Task LogDigestAsync(MySqlConnection conn, string sourceType, int sourceId, string status, string? detail)
    {
        await conn.ExecuteAsync(@"
            INSERT INTO greeting_send_log (fk_member_id, Occasion, Channel, SourceType, SourceId, SendDate, Status, Detail)
            VALUES (0, 'Digest', 'Push', @T, @S, @Day, @St, @D)
            ON DUPLICATE KEY UPDATE Status=VALUES(Status), Detail=VALUES(Detail), created_at=NOW()",
            new { T = sourceType, S = sourceId, St = status, D = detail, Day = _day });
    }

    private async Task GreetMemberAsync(MySqlConnection conn, SourceConfig cfg, string occasion, Celebrant m, RunStats stats)
    {
        bool isBirthday = occasion == Birthday;
        var notifyOn = isBirthday ? cfg.BirthdayOn : cfg.AnniversaryOn;
        var emailOn = isBirthday ? cfg.BirthdayEmailOn : cfg.AnniversaryEmailOn;
        var sourceType = cfg.IsDistrict ? "District" : "Club";

        // The configured greeting bodies are signature-free; we append a dynamic "Warm regards"
        // signed by the source's current-year officer (district → DG, club → Club President).
        var signature = BuildSignature(cfg);
        var baseMessage = Coalesce(isBirthday ? cfg.BirthdayGreeting : cfg.AnniversaryGreeting,
                              isBirthday ? _opt.DefaultBirthdayMessage : _opt.DefaultAnniversaryMessage);
        var emailSubject = Coalesce(isBirthday ? cfg.BirthdayEmailSubject : cfg.AnniversaryEmailSubject,
                                    isBirthday ? _opt.DefaultBirthdayEmailSubject : _opt.DefaultAnniversaryEmailSubject);
        var emailBody = Coalesce(isBirthday ? cfg.BirthdayEmailMessage : cfg.AnniversaryEmailMessage, baseMessage) + signature;
        // N5 (module on): the source's template in the member's language replaces the configured text; the officer's
        // signature stays. shortcut: the frame ("Greetings from", "Dear Rtn.", push text) stays English.
        var version = RotaryApi.Services.CommsTemplates.Pick(isBirthday ? cfg.BirthdayVersions : cfg.AnniversaryVersions, m.Language, cfg.Language);
        if (version != null)
        {
            var values = new Dictionary<string, string?>
            {
                ["member_name"] = m.MemberName, ["club_name"] = cfg.SourceName, ["foundation_link"] = cfg.FoundationLink,
            };
            emailSubject = RotaryApi.Services.CommsTemplates.Fill(version.Subject, values, false);
            emailBody = RotaryApi.Services.CommsTemplates.Fill(version.BodyHtml, values, true)
                + "<p>" + System.Net.WebUtility.HtmlEncode(signature.Trim()).Replace("\n", "<br>") + "</p>";
        }


        // Email
        if (emailOn && cfg.SendEmailChannel)
        {
            if (string.IsNullOrWhiteSpace(m.Email))
                await LogAsync(conn, m.MemberId, occasion, ChEmail, sourceType, cfg.SourceId, "skipped", "no email address", stats);
            else if (m.EmailBlocked != 0)
                await LogAsync(conn, m.MemberId, occasion, ChEmail, sourceType, cfg.SourceId, "skipped", "unsubscribed or address suppressed", stats);
            else if (_dryRun || !await AlreadySentAsync(conn, m.MemberId, occasion, ChEmail, sourceType, cfg.SourceId))
            {
                if (_opt.DeductCredits && await RemainingCreditsAsync(conn, cfg.SourceId, cfg.IsDistrict, ChEmail) < 1)
                    await LogAsync(conn, m.MemberId, occasion, ChEmail, sourceType, cfg.SourceId, "skipped", "no Email credits", stats);
                else if (_dryRun)
                {
                    Console.WriteLine($"[DRY] Email {occasion} -> {m.MemberName} ({RotaryApi.Services.LogMask.Email((string?)m.Email)}) via {sourceType} '{cfg.SourceName}' [subject={emailSubject}]");
                    stats.EmailSent++;
                }
                else
                {
                    var html = BuildEmailHtml(cfg.SourceName, m.MemberName ?? "Rotarian", emailBody, cfg.GovernorNoteHtml);
                    var ok = await _email.SendAsync(m.Email!, emailSubject, html);
                    if (ok && _opt.DeductCredits)
                        await DeductCreditAsync(conn, cfg.SourceId, cfg.IsDistrict, ChEmail, 1, $"{occasion} email to {m.MemberName} ({sourceType} {cfg.SourceName})", m.MemberId);
                    await LogAsync(conn, m.MemberId, occasion, ChEmail, sourceType, cfg.SourceId, ok ? "sent" : "failed", ok ? null : "Brevo send failed", stats);
                }
            }
        }

        // Push (free — no credit check). Goes to the celebrating member's own device.
        if (notifyOn && cfg.SendPush)
        {
            if (string.IsNullOrWhiteSpace(m.DeviceToken) || m.DeviceToken == "0")
                await LogAsync(conn, m.MemberId, occasion, ChPush, sourceType, cfg.SourceId, "skipped", "no device token", stats);
            else if (m.PushBlocked != 0)
                await LogAsync(conn, m.MemberId, occasion, ChPush, sourceType, cfg.SourceId, "skipped", "push switched off by the member", stats);
            else if (_dryRun || !await AlreadySentAsync(conn, m.MemberId, occasion, ChPush, sourceType, cfg.SourceId))
            {
                if (_dryRun)
                {
                    Console.WriteLine($"[DRY] Push {occasion} -> {m.MemberName} via {sourceType} '{cfg.SourceName}'");
                    stats.PushSent++;
                }
                else
                {
                    var pushTitle = isBirthday ? $"{await TextAsync(conn, cfg, "Happy Birthday!")} 🎂" : $"{await TextAsync(conn, cfg, "Happy Anniversary!")} 🎉";
                    var pushBody = await TextAsync(conn, cfg, "Warm wishes from {0}", cfg.SourceName);
                    // Deep-link contract (Firebase_Notification_Routes.md): personal greeting fired only to the
                    // celebrant → my_birthday / my_anniversary, no IDs (tap just opens the app home).
                    var data = new Dictionary<string, string>
                    {
                        ["type"] = isBirthday ? "my_birthday" : "my_anniversary",
                    };
                    var ok = await _push.SendToTokenAsync(m.DeviceToken!, pushTitle, pushBody, data);
                    await LogAsync(conn, m.MemberId, occasion, ChPush, sourceType, cfg.SourceId, ok ? "sent" : "failed", ok ? null : "Firebase send failed", stats);
                }
            }
        }
    }

    // ── diagnostics ───────────────────────────────────────────────────────
    // Read-only. Prints (to Console, so it shows up directly in the caller's
    // terminal — PowerShell included) exactly what the worker sees for a given
    // club/district and, optionally, one member: the greeting config flags
    // that gate sends, the member's own date/contact fields, and their full
    // greeting_send_log history (what was actually attempted, and why it was
    // skipped/failed if it was). Also prints a day-by-day activity summary
    // for the scope so you can see whether the scheduled task has even been
    // running recently. Never writes anything.
    public async Task DiagnoseAsync(string? clubName, string? districtNumber, string? memberName)
    {
        await using var conn = new MySqlConnection(_conn);
        await conn.OpenAsync();

        Console.WriteLine();
        Console.WriteLine("==================== GREETINGS DIAGNOSTIC ====================");

        int? clubId = null, districtId = null;

        if (!string.IsNullOrWhiteSpace(clubName))
        {
            var c = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
                SELECT pk_club_id AS ClubId, ClubName, IsActive, isdeleted,
                       IsEnableBirthdayNotification, IsEnableAnniversaryNotification,
                       IsEnableBirthdayEmail, IsEnableAnniversaryEmail
                FROM club_master WHERE ClubName = @ClubName LIMIT 1",
                new { ClubName = clubName });
            Console.WriteLine();
            Console.WriteLine($"--- Club '{clubName}' ---");
            if (c == null) { Console.WriteLine("  NOT FOUND — check spelling (exact match on ClubName)."); }
            else
            {
                clubId = (int)c.ClubId;
                Console.WriteLine($"  ClubId={c.ClubId}  IsActive={ToBool(c.IsActive)}  isdeleted={ToBool(c.isdeleted)}");
                Console.WriteLine($"  IsEnableBirthdayNotification={ToBool(c.IsEnableBirthdayNotification)}  IsEnableAnniversaryNotification={ToBool(c.IsEnableAnniversaryNotification)}");
                Console.WriteLine($"  IsEnableBirthdayEmail={ToBool(c.IsEnableBirthdayEmail)}  IsEnableAnniversaryEmail={ToBool(c.IsEnableAnniversaryEmail)}");
                bool anyOn = ToBool(c.IsEnableBirthdayNotification) || ToBool(c.IsEnableAnniversaryNotification)
                    || ToBool(c.IsEnableBirthdayEmail) || ToBool(c.IsEnableAnniversaryEmail);
                if (!ToBool(c.IsActive) || ToBool(c.isdeleted))
                    Console.WriteLine("  ISSUE: club is inactive/deleted — ProcessClubsAsync's WHERE excludes it entirely, no greetings ever sent.");
                else if (!anyOn)
                    Console.WriteLine("  ISSUE: every notification/email flag is OFF — ProcessClubsAsync's WHERE excludes it entirely.");
            }
        }

        if (!string.IsNullOrWhiteSpace(districtNumber))
        {
            var d = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
                SELECT pk_district_id AS DistrictId, DistrictNumber, IsActive, isdeleted,
                       IsEnableBirthdayNotification, IsEnableAnniversaryNotification,
                       IsGreetingSendEmail, IsGreetingSendPush,
                       IsEnableBirthdayEmail, IsEnableAnniversaryEmail
                FROM district_master WHERE DistrictNumber = @DistrictNumber LIMIT 1",
                new { DistrictNumber = districtNumber });
            Console.WriteLine();
            Console.WriteLine($"--- District '{districtNumber}' ---");
            if (d == null) { Console.WriteLine("  NOT FOUND — check the district number."); }
            else
            {
                districtId = (int)d.DistrictId;
                Console.WriteLine($"  DistrictId={d.DistrictId}  IsActive={ToBool(d.IsActive)}  isdeleted={ToBool(d.isdeleted)}");
                Console.WriteLine($"  IsEnableBirthdayNotification={ToBool(d.IsEnableBirthdayNotification)}  IsEnableAnniversaryNotification={ToBool(d.IsEnableAnniversaryNotification)}");
                Console.WriteLine($"  IsGreetingSendEmail={ToBool(d.IsGreetingSendEmail)}  IsGreetingSendPush={ToBool(d.IsGreetingSendPush)}");
                Console.WriteLine($"  IsEnableBirthdayEmail={ToBool(d.IsEnableBirthdayEmail)}  IsEnableAnniversaryEmail={ToBool(d.IsEnableAnniversaryEmail)}");
                bool anyOn = ToBool(d.IsEnableBirthdayNotification) || ToBool(d.IsEnableAnniversaryNotification)
                    || ToBool(d.IsEnableBirthdayEmail) || ToBool(d.IsEnableAnniversaryEmail);
                if (!ToBool(d.IsActive) || ToBool(d.isdeleted))
                    Console.WriteLine("  ISSUE: district is inactive/deleted — ProcessDistrictsAsync's WHERE excludes it entirely, no greetings ever sent.");
                else if (!anyOn)
                    Console.WriteLine("  ISSUE: every notification/email flag is OFF — ProcessDistrictsAsync's WHERE excludes it entirely.");
            }
        }

        // Actual birthday/anniversary matches for TODAY, using the exact same date-match
        // query the real job runs (ClubMembersByDateSql/DistrictMembersByDateSql). This
        // directly answers "was there anyone to greet today" for this club/district — the
        // digest ("X birthdays and Y anniversaries") is deliberately NOT sent, and no log
        // row is written for it, when the count is zero (see SendCelebrationsDigestAsync's
        // early return). So a missing digest notification is EXPECTED, not a bug, whenever
        // this section comes back with nothing on both sides.
        // shortcut: the server's date, not the district's zone (N12); use DueAsync's local date if operators need it.
        var todayNow = DateTime.Now;
        if (clubId.HasValue)
        {
            var bdays = (await conn.QueryAsync<dynamic>(ClubMembersByDateSql("BirthDate", false),
                new { ClubId = clubId.Value, RefMonth = todayNow.Month, RefDay = todayNow.Day })).ToList();
            var annivs = (await conn.QueryAsync<dynamic>(ClubMembersByDateSql("AnniversaryDate", false),
                new { ClubId = clubId.Value, RefMonth = todayNow.Month, RefDay = todayNow.Day })).ToList();
            Console.WriteLine();
            Console.WriteLine($"--- Today's actual birthday/anniversary matches for club (ClubId={clubId}) ---");
            Console.WriteLine($"  Birthdays today: {bdays.Count}" + (bdays.Count > 0 ? "  -> " + string.Join(", ", bdays.Select(x => (string)x.MemberName)) : ""));
            Console.WriteLine($"  Anniversaries today: {annivs.Count}" + (annivs.Count > 0 ? "  -> " + string.Join(", ", annivs.Select(x => (string)x.MemberName)) : ""));
            if (bdays.Count == 0 && annivs.Count == 0)
                Console.WriteLine("  -> Zero total. No digest is sent/logged in this case — that's expected behaviour, not a bug.");
            else
                await PrintDigestStatusAsync(conn, "Club", clubId.Value);
        }
        if (districtId.HasValue)
        {
            var bdays = (await conn.QueryAsync<dynamic>(DistrictMembersByDateSql("BirthDate", false),
                new { DistrictId = districtId.Value, RefMonth = todayNow.Month, RefDay = todayNow.Day })).ToList();
            var annivs = (await conn.QueryAsync<dynamic>(DistrictMembersByDateSql("AnniversaryDate", false),
                new { DistrictId = districtId.Value, RefMonth = todayNow.Month, RefDay = todayNow.Day })).ToList();
            Console.WriteLine();
            Console.WriteLine($"--- Today's actual birthday/anniversary matches for district (DistrictId={districtId}) ---");
            Console.WriteLine($"  Birthdays today: {bdays.Count}" + (bdays.Count > 0 ? "  -> " + string.Join(", ", bdays.Select(x => (string)x.MemberName)) : ""));
            Console.WriteLine($"  Anniversaries today: {annivs.Count}" + (annivs.Count > 0 ? "  -> " + string.Join(", ", annivs.Select(x => (string)x.MemberName)) : ""));
            if (bdays.Count == 0 && annivs.Count == 0)
                Console.WriteLine("  -> Zero total. No digest is sent/logged in this case — that's expected behaviour, not a bug.");
            else
                await PrintDigestStatusAsync(conn, "District", districtId.Value);
        }

        List<(int MemberId, string MemberName)> members = new();
        if (!string.IsNullOrWhiteSpace(memberName))
        {
            var rows = (await conn.QueryAsync<dynamic>(@"
                SELECT DISTINCT m.pk_member_master_profile_id AS MemberId, m.MemberName,
                       m.PrimaryMobileNumber AS Mobile, m.EmailId AS Email,
                       m.BirthDate, m.AnniversaryDate, m.LastDeviceToken AS DeviceToken
                FROM member_master_profile m
                WHERE m.MemberName LIKE @Pattern AND m.isdeleted = 0",
                new { Pattern = $"%{memberName}%" })).ToList();

            Console.WriteLine();
            Console.WriteLine($"--- Member(s) matching '{memberName}' ---");
            if (rows.Count == 0) { Console.WriteLine("  NOT FOUND."); }
            var today = DateTime.Now;
            foreach (var m in rows)
            {
                members.Add(((int)m.MemberId, (string)m.MemberName));
                DateTime? bd = m.BirthDate is DateTime bdv ? bdv : null;
                DateTime? ad = m.AnniversaryDate is DateTime adv ? adv : null;
                bool bdToday = bd.HasValue && bd.Value.Month == today.Month && bd.Value.Day == today.Day;
                bool adToday = ad.HasValue && ad.Value.Month == today.Month && ad.Value.Day == today.Day;
                Console.WriteLine($"  MemberId={m.MemberId}  {m.MemberName}");
                Console.WriteLine($"    Mobile={(string?)m.Mobile ?? "(none)"}  Email={((string?)m.Email == null ? "(none)" : RotaryApi.Services.LogMask.Email((string?)m.Email))}  DeviceToken={(string.IsNullOrWhiteSpace((string?)m.DeviceToken) ? "(none)" : "present")}");
                Console.WriteLine($"    BirthDate={(bd.HasValue ? bd.Value.ToString("dd-MMM") : "(none)")} (today match: {bdToday})   AnniversaryDate={(ad.HasValue ? ad.Value.ToString("dd-MMM") : "(none)")} (today match: {adToday})");
                if (!bdToday && !adToday)
                    Console.WriteLine("    NOTE: neither date matches today — this member simply isn't due a greeting today, regardless of config.");

                // Club/district membership — confirms whether the member is actually reachable
                // through the scoped club/district at all (wrong club, inactive membership, etc. all show here).
                var memberships = await conn.QueryAsync<dynamic>(@"
                    SELECT c.ClubName, d.DistrictNumber, cm.IsActive AS MembershipActive, cm.isdeleted AS MembershipDeleted
                    FROM club_members cm
                    JOIN club_master c ON c.pk_club_id = cm.fk_club_id
                    LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
                    WHERE cm.fk_member_master_profile_id = @Id",
                    new { Id = (int)m.MemberId });
                foreach (var ms in memberships)
                    Console.WriteLine($"    Club membership: '{ms.ClubName}' (District {ms.DistrictNumber})  Active={ToBool(ms.MembershipActive)}  Deleted={ToBool(ms.MembershipDeleted)}");
            }
        }

        // Per-member send log — the actual attempt-by-attempt record.
        foreach (var (memberId, name) in members)
        {
            Console.WriteLine();
            Console.WriteLine($"--- greeting_send_log for {name} (MemberId={memberId}) ---");
            var log = await conn.QueryAsync<dynamic>(@"
                SELECT Occasion, Channel, SourceType, SourceId, SendDate, Status, Detail, created_at
                FROM greeting_send_log
                WHERE fk_member_id = @Id
                ORDER BY SendDate DESC, created_at DESC
                LIMIT 50",
                new { Id = memberId });
            var any = false;
            foreach (var r in log)
            {
                any = true;
                Console.WriteLine($"  {r.SendDate:yyyy-MM-dd}  {r.Occasion,-11} {r.Channel,-8} via {r.SourceType}#{r.SourceId}  Status={r.Status,-8} Detail={(string?)r.Detail ?? ""}  (logged {r.created_at:yyyy-MM-dd HH:mm})");
            }
            if (!any) Console.WriteLine("  (no rows at all — this member has NEVER been processed by any run, dry-run excluded)");
        }

        // Day-by-day activity for the scoped club/district — shows whether the
        // scheduled task has actually been firing, independent of any one member.
        if (clubId.HasValue || districtId.HasValue)
        {
            Console.WriteLine();
            Console.WriteLine("--- Recent activity for this club/district (last 30 days) ---");
            var activity = await conn.QueryAsync<dynamic>(@"
                SELECT SendDate, SourceType,
                       COUNT(*) AS Rows_,
                       SUM(Status='sent') AS SentCount,
                       SUM(Status='failed') AS FailedCount,
                       SUM(Status='skipped') AS SkippedCount
                FROM greeting_send_log
                WHERE (@ClubId IS NOT NULL AND SourceType='Club' AND SourceId=@ClubId)
                   OR (@DistrictId IS NOT NULL AND SourceType='District' AND SourceId=@DistrictId)
                GROUP BY SendDate, SourceType
                ORDER BY SendDate DESC
                LIMIT 30",
                new { ClubId = clubId, DistrictId = districtId });
            var any = false;
            foreach (var r in activity)
            {
                any = true;
                Console.WriteLine($"  {r.SendDate:yyyy-MM-dd}  {r.SourceType,-8} rows={r.Rows_}  sent={r.SentCount} failed={r.FailedCount} skipped={r.SkippedCount}");
            }
            if (!any) Console.WriteLine("  (no rows at all in the last 30 days — the scheduled task has not processed this club/district recently, or has never run)");
        }

        // System-wide, unscoped: every distinct write "batch" (created_at rounded to the
        // minute) across the WHOLE table for the last few days. GreetingsWorker.exe only
        // logs to its own console — Task Scheduler doesn't capture that anywhere — so this
        // is the only surviving record of what an unscoped `--send` run actually wrote,
        // regardless of which club/district it touched. If the scheduled run's start time
        // (e.g. 08:00) doesn't show up here at all, it wrote nothing that morning company-wide
        // (not just for one club/district) despite Task Scheduler reporting a clean exit.
        Console.WriteLine();
        Console.WriteLine("--- System-wide write activity, last 4 days (all clubs/districts) ---");
        var batches = await conn.QueryAsync<dynamic>(@"
            SELECT DATE(created_at) AS D, HOUR(created_at) AS H, MINUTE(created_at) AS Mi,
                   COUNT(*) AS Rows_, COUNT(DISTINCT SourceType, SourceId) AS DistinctSources,
                   SUM(Status='sent') AS SentCount, SUM(Status='failed') AS FailedCount, SUM(Status='skipped') AS SkippedCount
            FROM greeting_send_log
            WHERE created_at >= NOW() - INTERVAL 4 DAY
            GROUP BY DATE(created_at), HOUR(created_at), MINUTE(created_at)
            ORDER BY D DESC, H DESC, Mi DESC
            LIMIT 60");
        var anyBatch = false;
        foreach (var r in batches)
        {
            anyBatch = true;
            Console.WriteLine($"  {r.D:yyyy-MM-dd} {r.H:D2}:{r.Mi:D2}  rows={r.Rows_}  distinct club/district sources={r.DistinctSources}  sent={r.SentCount} failed={r.FailedCount} skipped={r.SkippedCount}");
        }
        if (!anyBatch) Console.WriteLine("  (no writes anywhere in the whole table in the last 4 days)");

        Console.WriteLine();
        Console.WriteLine("==================== END DIAGNOSTIC ====================");
        Console.WriteLine();
    }

    // Today's digest row (fk_member_id=0, Occasion='Digest', Channel='Push') for this
    // source, if any — shows whether the "X birthdays/anniversaries today" push was
    // actually attempted, and if so, sent/skipped/failed and why (e.g. "no device
    // tokens" — see SendCelebrationsDigestAsync). ResolveAllMemberTokensAsync also
    // rechecked here directly so a "no device tokens" skip is visibly explained,
    // not just asserted.
    private async Task PrintDigestStatusAsync(MySqlConnection conn, string sourceType, int sourceId)
    {
        var row = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT Status, Detail, created_at FROM greeting_send_log
            WHERE fk_member_id=0 AND Occasion='Digest' AND Channel='Push'
              AND SourceType=@T AND SourceId=@S AND SendDate=CURDATE()
            LIMIT 1",
            new { T = sourceType, S = sourceId });
        if (row == null)
        {
            Console.WriteLine("  -> Digest: NO ROW for today at all — the digest step was never reached/logged for this source today.");
            return;
        }
        Console.WriteLine($"  -> Digest: Status={row.Status}  Detail={(string?)row.Detail ?? ""}  (logged {row.created_at:yyyy-MM-dd HH:mm})");
        var tokenCount = await conn.ExecuteScalarAsync<int>(sourceType == "District"
            ? @"SELECT COUNT(DISTINCT m.LastDeviceToken) FROM club_members cm
                JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0 AND c.IsActive = 1
                JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
                WHERE c.fk_district_id = @Id AND cm.IsActive = 1 AND cm.isdeleted = 0
                  AND m.LastDeviceToken IS NOT NULL AND TRIM(m.LastDeviceToken) <> '' AND m.LastDeviceToken <> '0'"
            : @"SELECT COUNT(DISTINCT m.LastDeviceToken) FROM club_members cm
                JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
                WHERE cm.fk_club_id = @Id AND cm.IsActive = 1 AND cm.isdeleted = 0
                  AND m.LastDeviceToken IS NOT NULL AND TRIM(m.LastDeviceToken) <> '' AND m.LastDeviceToken <> '0'",
            new { Id = sourceId });
        Console.WriteLine($"     (members with a usable push token in this {sourceType.ToLowerInvariant()} right now: {tokenCount})");
    }

    // ── helpers ───────────────────────────────────────────────────────────
    private static bool ToBool(object? v) => v switch
    {
        null => false,
        bool b => b,
        sbyte sb => sb != 0,
        byte by => by != 0,
        short s => s != 0,
        int i => i != 0,
        long l => l != 0,
        _ => false
    };

    private static string Coalesce(string? a, string? b)
        => !string.IsNullOrWhiteSpace(a) ? a! : (b ?? "");

    private async Task<bool> AlreadySentAsync(MySqlConnection conn, int memberId, string occasion, string channel, string sourceType, int sourceId)
    {
        var n = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM greeting_send_log
            WHERE fk_member_id=@M AND Occasion=@O AND Channel=@C AND SourceType=@T AND SourceId=@S
              AND SendDate=@Day AND Status='sent'",
            new { M = memberId, O = occasion, C = channel, T = sourceType, S = sourceId, Day = _day });
        return n > 0;
    }

    private async Task LogAsync(MySqlConnection conn, int memberId, string occasion, string channel,
        string sourceType, int sourceId, string status, string? detail, RunStats stats)
    {
        if (!_dryRun)
        {
            await conn.ExecuteAsync(@"
                INSERT INTO greeting_send_log (fk_member_id, Occasion, Channel, SourceType, SourceId, SendDate, Status, Detail)
                VALUES (@M, @O, @C, @T, @S, @Day, @St, @D)
                ON DUPLICATE KEY UPDATE Status=VALUES(Status), Detail=VALUES(Detail), created_at=NOW()",
                new { M = memberId, O = occasion, C = channel, T = sourceType, S = sourceId, St = status, D = detail, Day = _day });
        }
        else if (status == "skipped")
        {
            Console.WriteLine($"[DRY] SKIP {channel} {occasion} member#{memberId} via {sourceType}#{sourceId}: {detail}");
        }

        if (status == "sent" && channel == ChEmail) stats.EmailSent++;
        else if (status == "sent" && channel == ChPush) stats.PushSent++;
        else if (status == "failed" && channel == ChEmail) stats.EmailFailed++;
        else if (status == "failed" && channel == ChPush) stats.PushFailed++;
        else if (status == "skipped") stats.Skipped++;
    }

    private static string CreditWhere(bool isDistrict)
        => isDistrict ? "fk_club_id = 0 AND fk_district_id = @Id" : "fk_club_id = @Id";

    private async Task<int> RemainingCreditsAsync(MySqlConnection conn, int sourceId, bool isDistrict, string creditType)
    {
        return await conn.ExecuteScalarAsync<int?>($@"
            SELECT COALESCE(SUM(CreditCount - UsedCount), 0) FROM club_credits
            WHERE {CreditWhere(isDistrict)} AND CreditType=@Type
              AND IsActive=1 AND isdeleted=0 AND NOW() <= ToDate",
            new { Id = sourceId, Type = creditType }) ?? 0;
    }

    private async Task DeductCreditAsync(MySqlConnection conn, int sourceId, bool isDistrict, string creditType, int count, string detail, int memberId)
    {
        var before = await RemainingCreditsAsync(conn, sourceId, isDistrict, creditType);
        var rows = (await conn.QueryAsync<dynamic>($@"
            SELECT pk_credit_id AS Id, CreditCount, UsedCount FROM club_credits
            WHERE {CreditWhere(isDistrict)} AND CreditType=@Type
              AND IsActive=1 AND isdeleted=0 AND NOW() <= ToDate AND (CreditCount - UsedCount) > 0
            ORDER BY ToDate ASC",
            new { Id = sourceId, Type = creditType })).ToList();

        var remaining = count;
        foreach (var c in rows)
        {
            if (remaining <= 0) break;
            var available = (int)c.CreditCount - (int)c.UsedCount;
            var deduct = Math.Min(available, remaining);
            await conn.ExecuteAsync("UPDATE club_credits SET UsedCount = UsedCount + @D WHERE pk_credit_id = @Id",
                new { D = deduct, Id = (int)c.Id });
            remaining -= deduct;
        }

        var clubIdForHistory = isDistrict ? 0 : sourceId;
        int? districtIdForHistory = isDistrict
            ? sourceId
            : await conn.ExecuteScalarAsync<int?>("SELECT fk_district_id FROM club_master WHERE pk_club_id=@Id", new { Id = sourceId });

        await conn.ExecuteAsync(@"
            INSERT INTO club_credit_usage_history
                (fk_club_id, fk_district_id, CreditType, DeductedCount, Source, SourceId, SourceDetail, BalanceBefore, BalanceAfter, created_by, created_date)
            VALUES (@Club, @District, @Type, @Count, 'greeting_send', @MemberId, @Detail, @Before, @After, 0, NOW())",
            new { Club = clubIdForHistory, District = districtIdForHistory, Type = creditType, Count = count,
                  MemberId = memberId, Detail = detail, Before = before, After = before - count });
    }

    // "Warm regards" signed by the source's current-year officer. Falls back to the club/district
    // name when no DG / Club President is on record for the current Rotary year.
    private string BuildSignature(SourceConfig cfg)
    {
        var name = cfg.OfficerName?.Trim();
        if (string.IsNullOrWhiteSpace(name))
            return $"\n\nWarm regards,\n{cfg.SourceName}";
        var yr = string.IsNullOrWhiteSpace(_currentYearLabel) ? "" : $" {_currentYearLabel}";
        return $"\n\nWarm regards,\n{name}\n{cfg.OfficerTitle}{yr}";
    }

    // governorNoteHtml: N5 leadership block (Governor's name, photo, note) under a club greeting; null when off.
    private static string BuildEmailHtml(string sourceName, string memberName, string message, string? governorNoteHtml = null)
    {
        // sourceName + memberName are plain text → encode.
        string Esc(string s) => System.Net.WebUtility.HtmlEncode(s);
        // The message may be admin-authored rich HTML (render as-is) OR plain text (escape it and
        // turn line breaks into <br> so the formatting survives in the email).
        var body = message.Contains('<')
            ? message
            : Esc(message).Replace("\r\n", "\n").Replace("\n", "<br>");
        return $@"
<div style='font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f2937;line-height:1.6;max-width:600px;margin:0 auto'>
  <div style='background:#07294d;color:#fff;padding:16px 24px;border-radius:8px 8px 0 0'>
    <div style='text-align:center;margin-bottom:10px'><img src='{RotaryApi.Services.Brand.EmailLogoUrl}' alt='ROW' style='height:60px' /></div>
    <h2 style='margin:0;font-size:18px'>Greetings from {Esc(sourceName)}</h2>
  </div>
  <div style='background:#ffffff;border:1px solid #e2e8f0;border-top:0;padding:24px;border-radius:0 0 8px 8px'>
    <p style='margin:0 0 14px 0'>Dear Rtn. {Esc(memberName)},</p>
    <div style='margin:0 0 14px 0'>{body}</div>{governorNoteHtml}
    <p style='margin:22px 0 0 0;color:#94a3b8;font-size:12px'>This is an automated message from ROW. Please do not reply to this message.</p>
  </div>
</div>";
    }
}

// Options bound from the appsettings "Greetings" section.
public class GreetingsOptions
{
    public string DefaultBirthdayMessage { get; set; } = "Wishing you a very happy birthday!";
    public string DefaultAnniversaryMessage { get; set; } = "Warm wishes on your wedding anniversary!";
    public string DefaultBirthdayEmailSubject { get; set; } = "Happy Birthday!";
    public string DefaultAnniversaryEmailSubject { get; set; } = "Happy Anniversary!";
    public bool DeductCredits { get; set; } = true;
    /// <summary>Local hour (in each source's district time zone) from which the day's greetings go out.</summary>
    public int SendHour { get; set; } = 8;
}
