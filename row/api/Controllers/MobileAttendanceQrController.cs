using System.Security.Cryptography;
using System.Text;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// QR attendance (mobile only). Marker: QR-ATTENDANCE
///
/// How the "living QR" works — and why it costs the server almost nothing:
///   1. The member's app fetches a DAY KEY once a day (GET qr-key). The key is
///      HMAC(secret, memberId|date), so the server stores nothing.
///   2. The app draws the QR ITSELF, offline: every 500 ms a new "tick"
///      (server-synced time / 500 ms) and a signature HMAC(dayKey, memberId|tick).
///   3. The admin's scanner reads 2+ frames and sends them (POST scan). The
///      server re-derives the day key and checks: signatures valid, ticks
///      DIFFERENT and INCREASING (a photo/screenshot is one frozen frame), and
///      the newest tick is recent (an old video replay is stale).
///
/// Scans are only accepted around the meeting's time (see MeetingWindow; UTC, no fixed zone). Present rows go into the
/// existing club_attendance_members table, so web and the manual screen see them.
/// </summary>
[ApiController]
[Authorize]
public class MobileAttendanceQrController : ControllerBase
{
    private const string Prefix = "RA1";
    private const long TickMs = 500;
    /// Newest scanned frame may be at most this far from server time
    /// (covers phone-clock drift + upload time; still kills replays).
    private const long MaxSkewTicks = 40;      // 20 s
    /// Frames must come from one short burst, not two separate photos.
    private const long MaxBurstTicks = 10;     // 5 s

    private readonly AdminYearGuard _guard;
    private readonly string _connectionString;
    private readonly byte[] _secret;

    public MobileAttendanceQrController(AdminYearGuard guard, IConfiguration config)
    {
        _guard = guard;
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        var secret = config["AttendanceQr:Secret"];
        if (string.IsNullOrWhiteSpace(secret))
            secret = "attendance-qr|" + (config["JwtSettings:Secret"]
                ?? throw new InvalidOperationException("JwtSettings:Secret is not configured."));
        _secret = Encoding.UTF8.GetBytes(secret);
    }

    private int GetUserId() => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;
    private static long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    private static string B64Url(byte[] b) =>
        Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private byte[] DayKey(int memberId, string yyyymmdd) =>
        HMACSHA256.HashData(_secret, Encoding.UTF8.GetBytes($"day|{memberId}|{yyyymmdd}"));

    private static string Sig(byte[] dayKey, int memberId, long tick) =>
        B64Url(HMACSHA256.HashData(dayKey, Encoding.UTF8.GetBytes($"{memberId}|{tick}"))[..12]);

    private const string OffMessage = "QR attendance is not switched on for this club yet.";

    // ── Roll-out switch: which of my clubs have QR attendance ───────────
    // Settings → QR Attendance (SuperAdmin) decides; the app hides the QR tile
    // and the Scan button for clubs not in this list.
    [HttpGet("api/mobile/attendance/qr-status")]
    public async Task<ActionResult> GetQrStatus()
    {
        var memberId = GetUserId();
        if (memberId <= 0) return Unauthorized(new { message = "Not signed in." });
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        return Ok(new
        {
            allClubs = await AttendanceQrSwitch.AllClubsAsync(conn),
            enabledClubIds = await AttendanceQrSwitch.EnabledClubsOfMemberAsync(conn, memberId),
        });
    }

    // ── Member: today's key ─────────────────────────────────────────────
    [HttpGet("api/mobile/attendance/qr-key")]
    public async Task<ActionResult> GetQrKey()
    {
        var memberId = GetUserId();
        if (memberId <= 0) return Unauthorized(new { message = "Not signed in." });
        await using (var conn = new MySqlConnection(_connectionString))
        {
            await conn.OpenAsync();
            if ((await AttendanceQrSwitch.EnabledClubsOfMemberAsync(conn, memberId)).Count == 0)
                return StatusCode(403, new { code = "qrOff", message = OffMessage });
        }
        var date = DateTime.UtcNow.ToString("yyyyMMdd");
        return Ok(new
        {
            memberId,
            date,
            dayKey = B64Url(DayKey(memberId, date)),
            serverTimeMs = NowMs(),
            tickMs = TickMs,
            prefix = Prefix,
        });
    }

    // ── Admin: today's meetings for the dropdown ───────────────────────
    [HttpGet("api/mobile/clubs/{clubId}/attendance/today")]
    public async Task<ActionResult> GetTodaysMeetings(int clubId)
    {
        var denied = await _guard.ClubAnyYearAsync(User, clubId);
        if (denied != null) return denied;

        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        if (!await AttendanceQrSwitch.IsClubEnabledAsync(conn, clubId))
            return StatusCode(403, new { code = "qrOff", message = OffMessage });
        var rows = await conn.QueryAsync(@"
            SELECT a.pk_attendance_id AS id, a.EventName AS eventName, a.EventDateTime AS eventDateTime,
                   (SELECT COUNT(*) FROM club_attendance_members m WHERE m.fk_attendance_id = a.pk_attendance_id) AS presentCount
            FROM club_attendance a
            WHERE a.fk_club_id = @ClubId AND a.isdeleted = 0
              AND a.EventDateTime BETWEEN @From AND @To
            ORDER BY a.EventDateTime DESC",
            new { ClubId = clubId, From = DateTime.UtcNow - MeetingWindow, To = DateTime.UtcNow + MeetingWindow });
        return Ok(rows);
    }

    public class ScanDto
    {
        public List<string> Codes { get; set; } = new();
    }

    // ── Admin: scan a member's living QR ───────────────────────────────
    [HttpPost("api/mobile/attendance/{attendanceId}/scan")]
    public async Task<ActionResult> Scan(int attendanceId, [FromBody] ScanDto dto)
    {
        var parsed = new List<(int MemberId, string Date, long Tick, string Sig)>();
        foreach (var c in dto?.Codes ?? new List<string>())
        {
            var p = (c ?? "").Trim().Split('.');
            if (p.Length != 5 || p[0] != Prefix
                || !int.TryParse(p[1], out var mid) || !long.TryParse(p[3], out var tick))
                return BadRequest(new { message = "This is not an attendance QR." });
            parsed.Add((mid, p[2], tick, p[4]));
        }
        parsed = parsed.GroupBy(x => x.Tick).Select(g => g.First()).OrderBy(x => x.Tick).ToList();
        if (parsed.Count < 2)
            return BadRequest(new { code = "photo", message = "Photo detected. Please show the live QR from your own app." });

        var memberId = parsed[0].MemberId;
        var date = parsed[0].Date;
        if (parsed.Any(x => x.MemberId != memberId || x.Date != date))
            return BadRequest(new { message = "Mixed QR codes. Scan one person at a time." });
        if (!KeyDates().Contains(date))
            return BadRequest(new { code = "stale", message = "This QR is from another day. Reopen My Attendance QR." });

        var key = DayKey(memberId, date);
        foreach (var x in parsed)
            if (!CryptographicOperations.FixedTimeEquals(
                    Encoding.ASCII.GetBytes(Sig(key, memberId, x.Tick)), Encoding.ASCII.GetBytes(x.Sig)))
                return BadRequest(new { message = "This QR is not valid." });

        var nowTick = NowMs() / TickMs;
        if (Math.Abs(nowTick - parsed[^1].Tick) > MaxSkewTicks)
            return BadRequest(new { code = "stale", message = "Old or recorded QR. Please show the live QR from your own app." });
        if (parsed[^1].Tick - parsed[0].Tick > MaxBurstTicks)
            return BadRequest(new { code = "photo", message = "Photo detected. Please show the live QR from your own app." });

        return await MarkAsync(attendanceId, memberId);
    }

    // ── Admin: mark own attendance ─────────────────────────────────────
    [HttpPost("api/mobile/attendance/{attendanceId}/mark-self")]
    public Task<ActionResult> MarkSelf(int attendanceId) => MarkAsync(attendanceId, GetUserId());

    private async Task<ActionResult> MarkAsync(int attendanceId, int memberId)
    {
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();

        var meeting = await conn.QueryFirstOrDefaultAsync<(int ClubId, int YearId, DateTime EventDateTime)>(@"
            SELECT fk_club_id AS ClubId, fk_year_id AS YearId, EventDateTime
            FROM club_attendance WHERE pk_attendance_id = @Id AND isdeleted = 0",
            new { Id = attendanceId });
        if (meeting.ClubId == 0) return NotFound(new { message = "Meeting not found." });
        if (!await AttendanceQrSwitch.IsClubEnabledAsync(conn, meeting.ClubId))
            return StatusCode(403, new { code = "qrOff", message = OffMessage });

        // Only an admin of this club, with rights for the meeting's Rotary year.
        var denied = await _guard.ClubYearAsync(User, meeting.ClubId, meeting.YearId);
        if (denied != null) return denied;

        if ((meeting.EventDateTime - DateTime.UtcNow).Duration() > MeetingWindow)
            return BadRequest(new { code = "notToday", message = "Attendance can be scanned only on the meeting day." });

        var member = await conn.QueryFirstOrDefaultAsync<(string MemberName, string? Photo)>(@"
            SELECT m.MemberName, m.ProfilePhotoPath
            FROM member_master_profile m
            INNER JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
            WHERE m.pk_member_master_profile_id = @MemberId AND cm.fk_club_id = @ClubId
              AND m.isdeleted = 0 AND cm.isdeleted = 0 AND cm.IsActive = 1
            LIMIT 1",
            new { MemberId = memberId, ClubId = meeting.ClubId });
        if (member.MemberName == null)
            return BadRequest(new { code = "notMember", message = "This person is not a member of this club." });

        var inserted = await conn.ExecuteAsync(@"
            INSERT INTO club_attendance_members (fk_attendance_id, fk_member_id)
            SELECT @AttendanceId, @MemberId FROM DUAL
            WHERE NOT EXISTS (SELECT 1 FROM club_attendance_members
                              WHERE fk_attendance_id = @AttendanceId AND fk_member_id = @MemberId)",
            new { AttendanceId = attendanceId, MemberId = memberId });

        var presentCount = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM club_attendance_members WHERE fk_attendance_id = @Id", new { Id = attendanceId });

        return Ok(new
        {
            status = inserted > 0 ? "marked" : "already",
            memberId,
            memberName = member.MemberName,
            profilePhotoPath = member.Photo,
            presentCount,
        });
    }

    // shortcut: "meeting day" = within 14 h of the meeting (UTC-12..UTC+14 all fit) because ROW
    // has no club time zone; switch to the club's own day if a club time zone is added.
    private static readonly TimeSpan MeetingWindow = TimeSpan.FromHours(14);

    /// Day keys are issued for the UTC date; yesterday's stays valid so a key
    /// fetched before UTC midnight still works for the rest of the member's day.
    private static string[] KeyDates() => new[]
    {
        DateTime.UtcNow.ToString("yyyyMMdd"),
        DateTime.UtcNow.AddDays(-1).ToString("yyyyMMdd"),
    };
}
