using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// Attendance makeups, leave of absence, exemptions and the attendance percentage built from them (gap #5,
/// 2026-11-19). Rules live in <see cref="AttendanceCalculator"/>; this loads the rows and stores the records.
/// A meeting is a club_attendance row; presence is club_attendance_members. Meeting dates are the stored (UTC) date.
/// </summary>
public class AttendanceStandingService
{
    public const int DefaultWindowDays = 14;
    public static readonly string[] MakeupTypes = { "other_club", "district_event", "service_project", "online", "other" };
    public const string Pending = "pending", Approved = "approved", Rejected = "rejected";
    public const string Counted = "counted", OwnOnly = "own_only", Excluded = "excluded";
    public static readonly string[] CountRules = { Counted, OwnOnly, Excluded };

    /// <summary>Honorary members were never counted (rule of 2026-08-25); every other type counts unless the club says otherwise.</summary>
    public static string DefaultRule(string memberType) => memberType == "honorary" ? Excluded : Counted;

    /// <summary>The member's type: honorary from the honorary flag or the RI type, else the RI type, else active.</summary>
    public static string MemberTypeOf(bool honorary, string? riType)
        => honorary ? "honorary" : string.IsNullOrWhiteSpace(riType) ? "active" : riType.Trim().ToLowerInvariant();

    /// <summary>Thrown when a closed meeting's records would change; the controller answers 409.</summary>
    public sealed class ClosedMeetingException(string message) : Exception(message);

    private readonly string _connectionString;
    public AttendanceStandingService(IConfiguration configuration)
        => _connectionString = configuration.GetConnectionString("DefaultConnection")!;

    private MySqlConnection Open() { var c = new MySqlConnection(_connectionString); c.Open(); return c; }

    public sealed record Period(DateOnly From, DateOnly To);
    public sealed record MemberStanding(int MemberId, string MemberName, int Counted, int Present, int MadeUp,
        int Excused, bool Exempt, decimal? Percent, bool Rule85, string MemberType, bool InClubTotal);
    public sealed record Standing(DateOnly From, DateOnly To, int WindowDays, int Meetings, int Counted, int Credited,
        decimal? ClubPercent, List<MemberStanding> Members);

    /// <summary>The Rotary year, or one month of it (1-12) when month is given. Null when the year is unknown.</summary>
    public static async Task<Period?> PeriodAsync(MySqlConnection conn, int yearId, int? month)
    {
        var y = await conn.QueryFirstOrDefaultAsync<(DateTime Start, DateTime End)>(
            "SELECT StartDate, EndDate FROM rotary_year_master WHERE pk_year_id = @Y", new { Y = yearId });
        if (y == default) return null;
        var start = DateOnly.FromDateTime(y.Start);
        var end = DateOnly.FromDateTime(y.End);
        if (month is not (>= 1 and <= 12)) return new Period(start, end);
        var first = new DateOnly(month.Value >= start.Month ? start.Year : start.Year + 1, month.Value, 1);
        return new Period(first, first.AddMonths(1).AddDays(-1));
    }

    public static async Task<int> WindowDaysAsync(MySqlConnection conn, int clubId)
        => await conn.ExecuteScalarAsync<int?>(
               "SELECT makeup_window_days FROM club_attendance_settings WHERE fk_club_id = @C", new { C = clubId })
           ?? DefaultWindowDays;

    /// <summary>Attendance standing of a club for a period. Also used by the monthly report and dashboards.</summary>
    public static async Task<Standing> ComputeAsync(MySqlConnection conn, int clubId, Period p)
    {
        var window = await WindowDaysAsync(conn, clubId);
        var args = new { C = clubId, From = p.From.ToDateTime(TimeOnly.MinValue), To = p.To.ToDateTime(TimeOnly.MinValue), W = window };
        var meetings = (await conn.QueryAsync<(int Id, DateTime At)>(
            @"SELECT pk_attendance_id, EventDateTime FROM club_attendance
              WHERE fk_club_id = @C AND isdeleted = 0 AND DATE(EventDateTime) BETWEEN @From AND @To", args))
            .Select(m => new AttendanceCalculator.Meeting(m.Id, DateOnly.FromDateTime(m.At))).ToList();
        // Member types count as the club's rules say (honorary excluded by default, rule of 2026-08-25).
        // A member who left during the period still counts for the meetings before leaving.
        // FirstJoined: earliest join in any club, for the rule of 85 ("years of membership in one or more clubs").
        var rules = await RulesAsync(conn, clubId);
        var roster = (await conn.QueryAsync<(int Id, string? Name, DateTime? Joined, DateTime? Left, bool Active, DateTime? Birth, DateTime? FirstJoined, bool Honorary, string? RiType)>(
            $@"SELECT m.pk_member_master_profile_id, m.MemberName, cm.JoinedDate, cm.TerminationDate, cm.IsActive = 1, m.BirthDate,
                      (SELECT MIN(x.JoinedDate) FROM club_members x WHERE x.fk_member_master_profile_id = m.pk_member_master_profile_id AND x.isdeleted = 0),
                      cm.IsHonoraryMember = 1, cm.ri_member_type
               FROM club_members cm
               JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
               WHERE cm.fk_club_id = @C AND cm.isdeleted = 0
                 AND (cm.IsActive = 1 OR cm.TerminationDate >= @From)
               ORDER BY m.MemberName", args)).GroupBy(r => r.Id).Select(g => g.First())
            .Where(r => RuleFor(rules, MemberTypeOf(r.Honorary, r.RiType)) != Excluded).ToList();
        var members = roster.Select(r => new AttendanceCalculator.Member(r.Id,
            r.Joined is { } j ? DateOnly.FromDateTime(j) : null,
            !r.Active && r.Left is { } l ? DateOnly.FromDateTime(l) : null,
            RuleFor(rules, MemberTypeOf(r.Honorary, r.RiType)) == Counted)).ToList();
        var ids = meetings.Select(m => m.Id).ToList();
        var present = ids.Count == 0 ? new HashSet<(int, int)>() : (await conn.QueryAsync<(int A, int M)>(
            "SELECT fk_attendance_id, fk_member_id FROM club_attendance_members WHERE fk_attendance_id IN @Ids",
            new { Ids = ids })).ToHashSet();
        var makeups = (await conn.QueryAsync<(int Id, int M, DateTime D, int? Missed)>(
            @"SELECT pk_makeup_id, fk_member_id, makeup_date, fk_missed_attendance_id FROM club_attendance_makeups
              WHERE fk_club_id = @C AND status = 'approved' AND makeup_date BETWEEN DATE_SUB(@From, INTERVAL @W DAY) AND DATE_ADD(@To, INTERVAL @W DAY)", args))
            .Select(k => new AttendanceCalculator.Makeup(k.Id, k.M, DateOnly.FromDateTime(k.D), k.Missed)).ToList();
        var leaves = (await conn.QueryAsync<(int M, DateTime F, DateTime T)>(
            "SELECT fk_member_id, from_date, to_date FROM club_member_leaves WHERE fk_club_id = @C AND to_date >= @From AND from_date <= @To", args))
            .Select(l => new AttendanceCalculator.Leave(l.M, DateOnly.FromDateTime(l.F), DateOnly.FromDateTime(l.T))).ToList();
        var exemptions = (await conn.QueryAsync<(int M, DateTime? E)>(
            "SELECT fk_member_id, end_date FROM club_member_attendance_exemptions WHERE fk_club_id = @C", args))
            .Select(e => new AttendanceCalculator.Exemption(e.M, e.E is { } d ? DateOnly.FromDateTime(d) : null)).ToList();

        var r = AttendanceCalculator.Compute(meetings, members, present, makeups, leaves, exemptions, window);
        var byId = roster.ToDictionary(x => x.Id);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        return new Standing(p.From, p.To, window, meetings.Count, r.Counted, r.Credited, r.Percent,
            r.Members.Select(m =>
            {
                var x = byId[m.MemberId];
                var rule85 = AttendanceCalculator.Rule85(x.Birth is { } b ? DateOnly.FromDateTime(b) : null,
                    x.FirstJoined is { } f ? DateOnly.FromDateTime(f) : null, today);
                return new MemberStanding(m.MemberId, x.Name ?? "", m.Counted, m.Present, m.MadeUp, m.Excused, m.Exempt, m.Percent, rule85,
                    MemberTypeOf(x.Honorary, x.RiType), m.InClubTotal);
            }).ToList());
    }

    /// <summary>The club percentage for a year or month, or null when the club recorded no meetings then.</summary>
    public static async Task<decimal?> ClubPercentAsync(MySqlConnection conn, int clubId, int yearId, int? month)
    {
        var p = await PeriodAsync(conn, yearId, month);
        if (p == null) return null;
        var s = await ComputeAsync(conn, clubId, p);
        return s.Meetings == 0 ? null : s.ClubPercent;
    }

    public async Task<Standing?> GetStandingAsync(int clubId, int yearId, int? month)
    {
        await using var conn = Open();
        var p = await PeriodAsync(conn, yearId, month);
        return p == null ? null : await ComputeAsync(conn, clubId, p);
    }

    // ── records ──────────────────────────────────────────────────────────

    public async Task<bool> IsClubMemberAsync(int clubId, int memberId)
    {
        await using var conn = Open();
        return await conn.ExecuteScalarAsync<int>(
            @"SELECT COUNT(*) FROM club_members WHERE fk_club_id = @C AND fk_member_master_profile_id = @M
              AND isdeleted = 0 AND IsActive = 1", new { C = clubId, M = memberId }) > 0;
    }

    /// <summary>Makeups of a period; pending ones are listed whatever their date so none waits unseen.</summary>
    public async Task<List<dynamic>> ListMakeupsAsync(int clubId, Period p, int? memberId, string? status = null)
    {
        await using var conn = Open();
        return (await conn.QueryAsync(
            @"SELECT k.pk_makeup_id AS id, k.fk_member_id AS memberId, m.MemberName AS memberName,
                     DATE_FORMAT(k.makeup_date, '%Y-%m-%d') AS makeupDate, k.makeup_type AS makeupType, k.note,
                     k.fk_missed_attendance_id AS missedAttendanceId, a.EventName AS missedEventName,
                     k.status, k.review_note AS reviewNote, k.created_by = k.fk_member_id AS selfLogged
              FROM club_attendance_makeups k
              JOIN member_master_profile m ON m.pk_member_master_profile_id = k.fk_member_id
              LEFT JOIN club_attendance a ON a.pk_attendance_id = k.fk_missed_attendance_id
              WHERE k.fk_club_id = @C AND (k.makeup_date BETWEEN @From AND @To OR k.status = 'pending')
                AND (@M IS NULL OR k.fk_member_id = @M) AND (@S IS NULL OR k.status = @S)
              ORDER BY k.status = 'pending' DESC, k.makeup_date DESC, k.pk_makeup_id DESC",
            new { C = clubId, From = p.From.ToDateTime(TimeOnly.MinValue), To = p.To.ToDateTime(TimeOnly.MinValue), M = memberId, S = status })).ToList();
    }

    /// <summary>Meetings of the period the member was on the roll for and not marked present at (to tie a makeup to).</summary>
    public async Task<List<dynamic>> MissedMeetingsAsync(int clubId, int memberId, Period p)
    {
        await using var conn = Open();
        return (await conn.QueryAsync(
            @"SELECT a.pk_attendance_id AS id, a.EventName AS eventName, DATE_FORMAT(a.EventDateTime, '%Y-%m-%d') AS meetingDate,
                     EXISTS(SELECT 1 FROM club_attendance_makeups k WHERE k.fk_missed_attendance_id = a.pk_attendance_id
                            AND k.fk_member_id = @M AND k.status <> 'rejected') AS hasMakeup,
                     EXISTS(SELECT 1 FROM club_attendance_closures c WHERE c.fk_attendance_id = a.pk_attendance_id) AS closed
              FROM club_attendance a
              WHERE a.fk_club_id = @C AND a.isdeleted = 0 AND DATE(a.EventDateTime) BETWEEN @From AND @To
                AND DATE(a.EventDateTime) <= UTC_DATE()
                AND NOT EXISTS(SELECT 1 FROM club_attendance_members p WHERE p.fk_attendance_id = a.pk_attendance_id AND p.fk_member_id = @M)
                AND EXISTS(SELECT 1 FROM club_members cm WHERE cm.fk_club_id = @C AND cm.fk_member_master_profile_id = @M AND cm.isdeleted = 0
                           AND (cm.JoinedDate IS NULL OR cm.JoinedDate <= DATE(a.EventDateTime)))
              ORDER BY a.EventDateTime DESC",
            new { C = clubId, M = memberId, From = p.From.ToDateTime(TimeOnly.MinValue), To = p.To.ToDateTime(TimeOnly.MinValue) })).ToList();
    }

    /// <summary>Validates and stores a makeup. Throws ArgumentException with a message for the caller.</summary>
    public async Task<int> AddMakeupAsync(int clubId, int memberId, DateOnly date, string? type, string? note, int? missedId, int by, bool selfLogged = false)
    {
        var t = (type ?? "").Trim().ToLowerInvariant();
        if (!MakeupTypes.Contains(t)) throw new ArgumentException("Makeup type must be other_club, district_event, service_project, online or other.");
        note = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
        if (note?.Length > 500) throw new ArgumentException("The note can be at most 500 characters.");
        if (date > DateOnly.FromDateTime(DateTime.UtcNow).AddDays(1)) throw new ArgumentException("A makeup cannot be in the future.");
        if (!await IsClubMemberAsync(clubId, memberId)) throw new ArgumentException("This member is not an active member of the club.");
        await using var conn = Open();
        if (await ClosedMeetingCoveringAsync(conn, clubId, date, missedId) is { } closed)
            throw new ClosedMeetingException($"The meeting of {closed} is closed. An officer must reopen it first.");
        if (missedId is { } mid)
        {
            var missed = await conn.QueryFirstOrDefaultAsync<DateTime?>(
                "SELECT EventDateTime FROM club_attendance WHERE pk_attendance_id = @A AND fk_club_id = @C AND isdeleted = 0",
                new { A = mid, C = clubId });
            if (missed == null) throw new ArgumentException("The missed meeting was not found in this club.");
            if (await conn.ExecuteScalarAsync<int>(
                    "SELECT COUNT(*) FROM club_attendance_members WHERE fk_attendance_id = @A AND fk_member_id = @M",
                    new { A = mid, M = memberId }) > 0)
                throw new ArgumentException("The member was present at that meeting.");
            var window = await WindowDaysAsync(conn, clubId);
            if (!AttendanceCalculator.WithinWindow(DateOnly.FromDateTime(missed.Value), date, window))
                throw new ArgumentException($"The makeup must be within {window} days of the missed meeting.");
            if (await conn.ExecuteScalarAsync<int>(
                    @"SELECT COUNT(*) FROM club_attendance_makeups WHERE fk_missed_attendance_id = @A AND fk_member_id = @M
                      AND status <> 'rejected'", new { A = mid, M = memberId }) > 0)
                throw new ArgumentException("A makeup for that meeting is already recorded.");
        }
        // Self-logged makeups wait for an officer; an officer's entry is approved as it is saved.
        return await conn.ExecuteScalarAsync<int>(
            @"INSERT INTO club_attendance_makeups (fk_club_id, fk_member_id, makeup_date, makeup_type, note, fk_missed_attendance_id,
                     status, reviewed_by, reviewed_date, created_by, created_date)
              VALUES (@C, @M, @D, @T, @N, @X, @S, IF(@S = 'approved', @By, NULL), IF(@S = 'approved', UTC_TIMESTAMP(), NULL), @By, UTC_TIMESTAMP());
              SELECT LAST_INSERT_ID();",
            new { C = clubId, M = memberId, D = date.ToDateTime(TimeOnly.MinValue), T = t, N = note, X = missedId,
                  S = selfLogged ? Pending : Approved, By = by });
    }

    /// <summary>An officer approves or rejects a pending makeup. False when it is not pending in this club.</summary>
    public async Task<bool> ReviewMakeupAsync(int clubId, int id, bool approve, string? note, int by)
    {
        note = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
        if (note?.Length > 500) throw new ArgumentException("The note can be at most 500 characters.");
        await using var conn = Open();
        await EnsureMakeupOpenAsync(conn, clubId, id);
        return await conn.ExecuteAsync(
            @"UPDATE club_attendance_makeups SET status = @S, review_note = @N, reviewed_by = @By, reviewed_date = UTC_TIMESTAMP()
              WHERE pk_makeup_id = @Id AND fk_club_id = @C AND status = 'pending'",
            new { S = approve ? Approved : Rejected, N = note, By = by, Id = id, C = clubId }) > 0;
    }

    /// <summary>A member withdraws their own makeup while it is still pending.</summary>
    public async Task<bool> WithdrawMyMakeupAsync(int memberId, int id)
    {
        await using var conn = Open();
        var club = await conn.ExecuteScalarAsync<int?>(
            "SELECT fk_club_id FROM club_attendance_makeups WHERE pk_makeup_id = @Id AND fk_member_id = @M", new { Id = id, M = memberId });
        if (club is { } c) await EnsureMakeupOpenAsync(conn, c, id);
        return await conn.ExecuteAsync(
            "DELETE FROM club_attendance_makeups WHERE pk_makeup_id = @Id AND fk_member_id = @M AND status = 'pending'",
            new { Id = id, M = memberId }) > 0;
    }

    // ── closed meetings ──────────────────────────────────────────────────

    /// <summary>The date of a closed meeting the makeup would credit: the tied meeting, or (untied) any closed meeting
    /// within the window of its date. Null when none is closed.</summary>
    private static async Task<string?> ClosedMeetingCoveringAsync(MySqlConnection conn, int clubId, DateOnly date, int? missedId)
    {
        var window = await WindowDaysAsync(conn, clubId);
        return await conn.ExecuteScalarAsync<string?>(
            @"SELECT DATE_FORMAT(a.EventDateTime, '%Y-%m-%d') FROM club_attendance_closures c
              JOIN club_attendance a ON a.pk_attendance_id = c.fk_attendance_id
              WHERE c.fk_club_id = @C AND (a.pk_attendance_id = @X
                    OR (@X IS NULL AND ABS(DATEDIFF(DATE(a.EventDateTime), @D)) <= @W))
              ORDER BY a.EventDateTime LIMIT 1",
            new { C = clubId, X = missedId, D = date.ToDateTime(TimeOnly.MinValue), W = window });
    }

    /// <summary>Throws ClosedMeetingException when the makeup could credit a closed meeting.</summary>
    public async Task EnsureMakeupOpenAsync(int clubId, int makeupId)
    {
        await using var conn = Open();
        await EnsureMakeupOpenAsync(conn, clubId, makeupId);
    }

    private static async Task EnsureMakeupOpenAsync(MySqlConnection conn, int clubId, int makeupId)
    {
        var k = await conn.QueryFirstOrDefaultAsync<(DateTime Date, int? Missed)>(
            "SELECT makeup_date, fk_missed_attendance_id FROM club_attendance_makeups WHERE pk_makeup_id = @Id AND fk_club_id = @C",
            new { Id = makeupId, C = clubId });
        if (k == default) return;
        if (await ClosedMeetingCoveringAsync(conn, clubId, DateOnly.FromDateTime(k.Date), k.Missed) is { } closed)
            throw new ClosedMeetingException($"The meeting of {closed} is closed. An officer must reopen it first.");
    }

    public static async Task<bool> IsMeetingClosedAsync(MySqlConnection conn, int attendanceId)
        => await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM club_attendance_closures WHERE fk_attendance_id = @A", new { A = attendanceId }) > 0;

    public async Task<bool> IsMeetingClosedAsync(int attendanceId)
    {
        await using var conn = Open();
        return await IsMeetingClosedAsync(conn, attendanceId);
    }

    /// <summary>The club's meetings of a period with their present count and whether they are closed.</summary>
    public async Task<List<dynamic>> ListMeetingsAsync(int clubId, Period p)
    {
        await using var conn = Open();
        return (await conn.QueryAsync(
            @"SELECT a.pk_attendance_id AS id, a.EventName AS eventName, DATE_FORMAT(a.EventDateTime, '%Y-%m-%d') AS meetingDate,
                     (SELECT COUNT(*) FROM club_attendance_members x WHERE x.fk_attendance_id = a.pk_attendance_id) AS presentCount,
                     c.fk_attendance_id IS NOT NULL AS closed, DATE_FORMAT(c.closed_date, '%Y-%m-%dT%H:%i:%sZ') AS closedDate,
                     m.MemberName AS closedByName
              FROM club_attendance a
              LEFT JOIN club_attendance_closures c ON c.fk_attendance_id = a.pk_attendance_id
              LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = c.closed_by
              WHERE a.fk_club_id = @C AND a.isdeleted = 0 AND DATE(a.EventDateTime) BETWEEN @From AND @To
              ORDER BY a.EventDateTime DESC",
            new { C = clubId, From = p.From.ToDateTime(TimeOnly.MinValue), To = p.To.ToDateTime(TimeOnly.MinValue) })).ToList();
    }

    /// <summary>The meeting's name, date and year, or null when it is not a live meeting of this club.</summary>
    public async Task<(string Name, DateTime At, int YearId)?> MeetingAsync(int clubId, int attendanceId)
    {
        await using var conn = Open();
        var m = await conn.QueryFirstOrDefaultAsync<(string Name, DateTime At, int YearId)>(
            "SELECT EventName, EventDateTime, fk_year_id FROM club_attendance WHERE pk_attendance_id = @A AND fk_club_id = @C AND isdeleted = 0",
            new { A = attendanceId, C = clubId });
        return m == default ? null : m;
    }

    /// <summary>Closes (close) or reopens a meeting. False when it already was in that state.</summary>
    public async Task<bool> SetClosedAsync(int clubId, int attendanceId, bool close, int by)
    {
        await using var conn = Open();
        return close
            ? await conn.ExecuteAsync(
                  @"INSERT IGNORE INTO club_attendance_closures (fk_attendance_id, fk_club_id, closed_by, closed_date)
                    VALUES (@A, @C, @By, UTC_TIMESTAMP())", new { A = attendanceId, C = clubId, By = by }) > 0
            : await conn.ExecuteAsync(
                  "DELETE FROM club_attendance_closures WHERE fk_attendance_id = @A AND fk_club_id = @C", new { A = attendanceId, C = clubId }) > 0;
    }

    // ── member-type rules ────────────────────────────────────────────────

    public static async Task<Dictionary<string, string>> RulesAsync(MySqlConnection conn, int clubId)
        => (await conn.QueryAsync<(string Type, string Rule)>(
                "SELECT member_type, count_rule FROM club_attendance_member_type_rules WHERE fk_club_id = @C", new { C = clubId }))
            .ToDictionary(r => r.Type, r => r.Rule);

    private static string RuleFor(Dictionary<string, string> rules, string type)
        => rules.TryGetValue(type, out var r) ? r : DefaultRule(type);

    /// <summary>Every RI member type (ri_codes) with the rule this club applies to it.</summary>
    public async Task<List<object>> GetMemberTypeRulesAsync(int clubId)
    {
        await using var conn = Open();
        var rules = await RulesAsync(conn, clubId);
        var types = (await conn.QueryAsync<(string Code, string Label)>(
            "SELECT code, label FROM ri_codes WHERE kind = 'member_type' AND isdeleted = 0 ORDER BY sort_order, label")).ToList();
        if (!types.Any(t => t.Code == "active")) types.Insert(0, ("active", "Active"));
        if (!types.Any(t => t.Code == "honorary")) types.Add(("honorary", "Honorary"));
        return types.Select(t => (object)new { memberType = t.Code, label = t.Label, rule = RuleFor(rules, t.Code), isDefault = !rules.ContainsKey(t.Code) }).ToList();
    }

    public async Task SetMemberTypeRuleAsync(int clubId, string? memberType, string? rule, int by)
    {
        var type = (memberType ?? "").Trim().ToLowerInvariant();
        var r = (rule ?? "").Trim().ToLowerInvariant();
        if (!CountRules.Contains(r)) throw new ArgumentException("The rule must be counted, own_only or excluded.");
        await using var conn = Open();
        if (type is not ("active" or "honorary") && await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM ri_codes WHERE kind = 'member_type' AND code = @T AND isdeleted = 0", new { T = type }) == 0)
            throw new ArgumentException("Unknown member type.");
        await conn.ExecuteAsync(
            @"INSERT INTO club_attendance_member_type_rules (fk_club_id, member_type, count_rule, modified_by, modified_date)
              VALUES (@C, @T, @R, @By, UTC_TIMESTAMP())
              ON DUPLICATE KEY UPDATE count_rule = VALUES(count_rule), modified_by = VALUES(modified_by), modified_date = UTC_TIMESTAMP()",
            new { C = clubId, T = type, R = r, By = by });
    }

    // ── printables ───────────────────────────────────────────────────────

    public sealed record Rule85Row(int MemberId, string MemberName, int Age, int Years, bool Exempt);

    /// <summary>Active members of the club who qualify for the rule of 85 today, oldest total first.</summary>
    public async Task<(string ClubName, List<Rule85Row> Rows)> Rule85ReportAsync(int clubId)
    {
        await using var conn = Open();
        var club = await conn.ExecuteScalarAsync<string?>("SELECT ClubName FROM club_master WHERE pk_club_id = @C", new { C = clubId }) ?? "";
        var rows = await conn.QueryAsync<(int Id, string? Name, DateTime? Birth, DateTime? FirstJoined, bool Exempt)>(
            @"SELECT m.pk_member_master_profile_id, m.MemberName, m.BirthDate,
                     (SELECT MIN(x.JoinedDate) FROM club_members x WHERE x.fk_member_master_profile_id = m.pk_member_master_profile_id AND x.isdeleted = 0),
                     EXISTS(SELECT 1 FROM club_member_attendance_exemptions e WHERE e.fk_club_id = @C AND e.fk_member_id = m.pk_member_master_profile_id
                            AND (e.end_date IS NULL OR e.end_date >= UTC_DATE()))
              FROM club_members cm
              JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
              WHERE cm.fk_club_id = @C AND cm.isdeleted = 0 AND cm.IsActive = 1", new { C = clubId });
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var list = rows.GroupBy(r => r.Id).Select(g => g.First())
            .Where(r => r.Birth.HasValue && r.FirstJoined.HasValue
                        && AttendanceCalculator.Rule85(DateOnly.FromDateTime(r.Birth.Value), DateOnly.FromDateTime(r.FirstJoined.Value), today))
            .Select(r => new Rule85Row(r.Id, r.Name ?? "", AttendanceCalculator.FullYears(DateOnly.FromDateTime(r.Birth!.Value), today),
                AttendanceCalculator.FullYears(DateOnly.FromDateTime(r.FirstJoined!.Value), today), r.Exempt))
            .OrderByDescending(r => r.Age + r.Years).ThenBy(r => r.MemberName).ToList();
        return (club, list);
    }

    /// <summary>Club name and the names of members on the roll on the meeting's date, for the sign-in sheet.</summary>
    public async Task<(string ClubName, List<string> Names)> SignInNamesAsync(int clubId, DateTime meetingAt)
    {
        await using var conn = Open();
        var club = await conn.ExecuteScalarAsync<string?>("SELECT ClubName FROM club_master WHERE pk_club_id = @C", new { C = clubId }) ?? "";
        var names = (await conn.QueryAsync<string>(
            @"SELECT DISTINCT m.MemberName FROM club_members cm
              JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
              WHERE cm.fk_club_id = @C AND cm.isdeleted = 0 AND (cm.JoinedDate IS NULL OR cm.JoinedDate <= DATE(@D))
                AND (cm.IsActive = 1 OR cm.TerminationDate > DATE(@D))
              ORDER BY m.MemberName", new { C = clubId, D = meetingAt })).ToList();
        return (club, names);
    }

    public async Task<DateOnly?> MakeupDateAsync(int clubId, int id)
    {
        await using var conn = Open();
        var d = await conn.ExecuteScalarAsync<DateTime?>(
            "SELECT makeup_date FROM club_attendance_makeups WHERE pk_makeup_id = @Id AND fk_club_id = @C", new { Id = id, C = clubId });
        return d is { } v ? DateOnly.FromDateTime(v) : null;
    }

    public async Task<bool> DeleteAsync(string table, string key, int clubId, int id)
    {
        // table/key are fixed names from the controller, never user input.
        await using var conn = Open();
        return await conn.ExecuteAsync($"DELETE FROM {table} WHERE {key} = @Id AND fk_club_id = @C", new { Id = id, C = clubId }) > 0;
    }

    public async Task<List<dynamic>> ListLeavesAsync(int clubId, Period p, int? memberId)
    {
        await using var conn = Open();
        return (await conn.QueryAsync(
            @"SELECT l.pk_leave_id AS id, l.fk_member_id AS memberId, m.MemberName AS memberName,
                     DATE_FORMAT(l.from_date, '%Y-%m-%d') AS fromDate, DATE_FORMAT(l.to_date, '%Y-%m-%d') AS toDate, l.reason
              FROM club_member_leaves l
              JOIN member_master_profile m ON m.pk_member_master_profile_id = l.fk_member_id
              WHERE l.fk_club_id = @C AND l.to_date >= @From AND l.from_date <= @To AND (@M IS NULL OR l.fk_member_id = @M)
              ORDER BY l.from_date DESC",
            new { C = clubId, From = p.From.ToDateTime(TimeOnly.MinValue), To = p.To.ToDateTime(TimeOnly.MinValue), M = memberId })).ToList();
    }

    public async Task<int> AddLeaveAsync(int clubId, int memberId, DateOnly from, DateOnly to, string? reason, int by)
    {
        if (to < from) throw new ArgumentException("The leave must end on or after its start date.");
        if (to.DayNumber - from.DayNumber > 366) throw new ArgumentException("A leave of absence can be at most one year.");
        reason = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim();
        if (reason?.Length > 500) throw new ArgumentException("The reason can be at most 500 characters.");
        if (!await IsClubMemberAsync(clubId, memberId)) throw new ArgumentException("This member is not an active member of the club.");
        await using var conn = Open();
        return await conn.ExecuteScalarAsync<int>(
            @"INSERT INTO club_member_leaves (fk_club_id, fk_member_id, from_date, to_date, reason, created_by, created_date)
              VALUES (@C, @M, @F, @T, @R, @By, UTC_TIMESTAMP()); SELECT LAST_INSERT_ID();",
            new { C = clubId, M = memberId, F = from.ToDateTime(TimeOnly.MinValue), T = to.ToDateTime(TimeOnly.MinValue), R = reason, By = by });
    }

    public async Task<List<dynamic>> ListExemptionsAsync(int clubId, int? memberId)
    {
        await using var conn = Open();
        return (await conn.QueryAsync(
            @"SELECT e.pk_exemption_id AS id, e.fk_member_id AS memberId, m.MemberName AS memberName, e.reason,
                     DATE_FORMAT(e.end_date, '%Y-%m-%d') AS endDate
              FROM club_member_attendance_exemptions e
              JOIN member_master_profile m ON m.pk_member_master_profile_id = e.fk_member_id
              WHERE e.fk_club_id = @C AND (@M IS NULL OR e.fk_member_id = @M)
              ORDER BY m.MemberName",
            new { C = clubId, M = memberId })).ToList();
    }

    public async Task SetExemptionAsync(int clubId, int memberId, string? reason, DateOnly? endDate, int by)
    {
        reason = (reason ?? "").Trim();
        if (reason.Length == 0) throw new ArgumentException("A reason is required.");
        if (reason.Length > 200) throw new ArgumentException("The reason can be at most 200 characters.");
        if (!await IsClubMemberAsync(clubId, memberId)) throw new ArgumentException("This member is not an active member of the club.");
        await using var conn = Open();
        await conn.ExecuteAsync(
            @"INSERT INTO club_member_attendance_exemptions (fk_club_id, fk_member_id, reason, end_date, created_by, created_date)
              VALUES (@C, @M, @R, @E, @By, UTC_TIMESTAMP())
              ON DUPLICATE KEY UPDATE reason = VALUES(reason), end_date = VALUES(end_date), created_by = VALUES(created_by), created_date = UTC_TIMESTAMP()",
            new { C = clubId, M = memberId, R = reason, E = endDate?.ToDateTime(TimeOnly.MinValue), By = by });
    }

    public async Task<int> GetWindowAsync(int clubId)
    {
        await using var conn = Open();
        return await WindowDaysAsync(conn, clubId);
    }

    public async Task SetWindowAsync(int clubId, int days, int by)
    {
        if (days is < 0 or > 90) throw new ArgumentException("The makeup window must be between 0 and 90 days.");
        await using var conn = Open();
        await conn.ExecuteAsync(
            @"INSERT INTO club_attendance_settings (fk_club_id, makeup_window_days, modified_by, modified_date)
              VALUES (@C, @D, @By, UTC_TIMESTAMP())
              ON DUPLICATE KEY UPDATE makeup_window_days = VALUES(makeup_window_days), modified_by = VALUES(modified_by), modified_date = UTC_TIMESTAMP()",
            new { C = clubId, D = days, By = by });
    }
}
