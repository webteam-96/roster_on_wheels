using System.Globalization;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

// Books/reschedules website-training appointments. Slots are 30 min, Mon–Fri, in configured
// windows (default 11:30–12:30 + 14:30–17:30 in the brand's time zone), max 3/day GLOBALLY. Each booking creates a
// Zoom meeting; reschedule updates the same meeting's time. Booking is serialized per-day with a
// SELECT … FOR UPDATE so the daily cap and per-slot uniqueness hold under concurrency.
public class TrainingAppointmentService : ITrainingAppointmentService
{
    private readonly string _conn;
    private readonly IZoomMeetingService _zoom;
    private readonly IEmailService _email;
    private readonly IConfiguration _config;
    private readonly ILogger<TrainingAppointmentService> _logger;

    public TrainingAppointmentService(IConfiguration config, IZoomMeetingService zoom, IEmailService email, ILogger<TrainingAppointmentService> logger)
    {
        _config = config;
        _conn = config.GetConnectionString("DefaultConnection")!;
        _zoom = zoom;
        _email = email;
        _logger = logger;
    }

    private MySqlConnection NewConn() => new(_conn);

    // ── config ───────────────────────────────────────────────────────────────
    private int SlotMinutes() => _config.GetValue("Training:SlotMinutes", 30);
    private int MaxPerDay() => _config.GetValue("Training:MaxPerDay", 3);
    private int MinNoticeDays() => _config.GetValue("Training:MinNoticeDays", 1);
    private int HorizonDays() => _config.GetValue("Training:HorizonDays", 30);
    private string[] SlotTimes()
    {
        var raw = _config["Training:Slots"];
        if (!string.IsNullOrWhiteSpace(raw))
            return raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return new[] { "11:30", "12:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00" };
    }
    private string[] TeamEmails() => _config.GetSection("Training:TeamEmails").Get<string[]>() ?? Array.Empty<string>();

    private static readonly TimeZoneInfo Zone = BrandZone();
    private static TimeZoneInfo BrandZone() => Brand.TimeZone;
    private static DateTime LocalNow() => TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, Zone);

    // ── active subscription gate ──────────────────────────────────────────────
    public async Task<bool> HasActiveWebsiteAsync(int clubId)
    {
        await using var conn = NewConn();
        await conn.OpenAsync();
        var n = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM club_websites
            WHERE fk_club_id = @C AND isdeleted = 0
              AND (IsPurchased = 1 OR (AmountPaid IS NOT NULL AND AmountPaid > 0) OR (TransactionId IS NOT NULL AND TransactionId <> ''))
              AND EndDate >= CURDATE()", new { C = clubId });
        return n > 0;
    }

    // ── availability ───────────────────────────────────────────────────────────
    // Every day in the booking window comes back, INCLUDING days and times that cannot be taken -
    // they arrive disabled with a reason instead of vanishing (user 2026-09-29). `Slots` still
    // carries only the open times, so anything already reading this response is unaffected.
    public async Task<AvailabilityResponseDto> GetAvailabilityAsync()
    {
        var today = LocalNow().Date;
        var start = today.AddDays(MinNoticeDays());
        var end = today.AddDays(HorizonDays());
        int maxPerDay = MaxPerDay();

        await using var conn = NewConn();
        await conn.OpenAsync();
        var booked = (await conn.QueryAsync<DateTime>(@"
            SELECT SlotStart FROM website_training_appointments
            WHERE SlotStart >= @S AND SlotStart < @E AND Status <> 'Cancelled' AND isdeleted = 0",
            new { S = start, E = end.AddDays(1) })).ToList();
        var byDate = booked.GroupBy(d => d.Date).ToDictionary(g => g.Key, g => g.ToList());

        var weekly = await LoadWeeklyHoursAsync(conn);
        var overrides = await LoadOverridesAsync(conn, start, end);

        var days = new List<AvailabilityDayDto>();
        for (var d = start; d <= end; d = d.AddDays(1))
        {
            var dayBooked = byDate.TryGetValue(d, out var lst) ? lst : new List<DateTime>();
            var taken = dayBooked.Select(x => x.ToString("HH:mm")).ToHashSet();
            var (ranges, closedReason) = DayRanges(d, weekly, overrides);

            // A closed day still appears, with no slots and the reason sitting on the date.
            if (ranges.Count == 0)
            {
                days.Add(new AvailabilityDayDto
                {
                    Date = d.ToString("yyyy-MM-dd"),
                    DayLabel = d.ToString("ddd, dd MMM", CultureInfo.InvariantCulture),
                    IsClosed = true,
                    ClosedReason = closedReason ?? "Not available",
                });
                continue;
            }

            bool dayFull = dayBooked.Count >= maxPerDay;
            var all = new List<AvailabilitySlotDto>();
            foreach (var t in SlotsInRanges(ranges))
            {
                if (taken.Contains(t))
                    all.Add(new AvailabilitySlotDto { Time = t, IsOpen = false, Status = "booked", Reason = "Already booked" });
                else if (dayFull)
                    all.Add(new AvailabilitySlotDto { Time = t, IsOpen = false, Status = "dayFull", Reason = "That day is fully booked" });
                else
                    all.Add(new AvailabilitySlotDto { Time = t, IsOpen = true, Status = "open" });
            }

            bool noneOpen = !all.Any(x => x.IsOpen);
            days.Add(new AvailabilityDayDto
            {
                Date = d.ToString("yyyy-MM-dd"),
                DayLabel = d.ToString("ddd, dd MMM", CultureInfo.InvariantCulture),
                Slots = all.Where(x => x.IsOpen).Select(x => x.Time).ToList(),
                AllSlots = all,
                IsClosed = noneOpen,
                ClosedReason = noneOpen ? "Fully booked" : null,
            });
        }
        return new AvailabilityResponseDto { SlotMinutes = SlotMinutes(), Days = days };
    }

    // ── the stored pattern ─────────────────────────────────────────────────────
    private sealed record HourRange(int Id, TimeSpan Start, TimeSpan End);

    private static async Task<Dictionary<int, List<HourRange>>> LoadWeeklyHoursAsync(MySqlConnection conn)
    {
        var rows = await conn.QueryAsync<(int pk, int dow, TimeSpan st, TimeSpan en)>(
            @"SELECT pk_id, DayOfWeek, StartTime, EndTime FROM training_weekly_hours
              WHERE isdeleted = 0 ORDER BY DayOfWeek, StartTime");
        var map = new Dictionary<int, List<HourRange>>();
        foreach (var r in rows)
        {
            if (!map.TryGetValue(r.dow, out var list)) map[r.dow] = list = new List<HourRange>();
            list.Add(new HourRange(r.pk, r.st, r.en));
        }
        return map;
    }

    private sealed class DayOverride
    {
        public bool AllDay { get; set; }
        public string? Reason { get; set; }
        public List<HourRange> Ranges { get; } = new();
    }

    private static async Task<Dictionary<DateTime, DayOverride>> LoadOverridesAsync(MySqlConnection conn, DateTime from, DateTime to)
    {
        var rows = await conn.QueryAsync<(int pk, DateTime dt, bool allDay, TimeSpan? st, TimeSpan? en, string? reason)>(
            @"SELECT pk_id, OverrideDate, IsUnavailableAllDay, StartTime, EndTime, Reason
              FROM training_date_overrides
              WHERE isdeleted = 0 AND OverrideDate BETWEEN @F AND @T
              ORDER BY OverrideDate, StartTime", new { F = from.Date, T = to.Date });
        var map = new Dictionary<DateTime, DayOverride>();
        foreach (var r in rows)
        {
            if (!map.TryGetValue(r.dt.Date, out var o)) map[r.dt.Date] = o = new DayOverride();
            if (r.allDay) o.AllDay = true;
            else if (r.st != null && r.en != null) o.Ranges.Add(new HourRange(r.pk, r.st.Value, r.en.Value));
            if (!string.IsNullOrWhiteSpace(r.reason)) o.Reason = r.reason;
        }
        return map;
    }

    // What the team is free for on one date: an override REPLACES the weekly pattern for that date
    // (all-day override = closed); otherwise the weekday's own hours apply.
    private static (List<HourRange> Ranges, string? ClosedReason) DayRanges(
        DateTime date, Dictionary<int, List<HourRange>> weekly, Dictionary<DateTime, DayOverride> overrides)
    {
        if (overrides.TryGetValue(date.Date, out var o))
        {
            if (o.AllDay || o.Ranges.Count == 0)
                return (new List<HourRange>(), o.Reason ?? "Not available");
            return (o.Ranges, null);
        }
        return weekly.TryGetValue((int)date.DayOfWeek, out var w) && w.Count > 0
            ? (w, null)
            : (new List<HourRange>(), "Not available");
    }

    // Slot start times inside the ranges - 11:30-12:30 at 30 min gives 11:30 and 12:00.
    private List<string> SlotsInRanges(List<HourRange> ranges)
    {
        var step = TimeSpan.FromMinutes(SlotMinutes());
        var times = new List<string>();
        foreach (var r in ranges.OrderBy(x => x.Start))
            for (var t = r.Start; t + step <= r.End; t += step)
            {
                var label = string.Format("{0:00}:{1:00}", t.Hours, t.Minutes);
                if (!times.Contains(label)) times.Add(label);
            }
        times.Sort(StringComparer.Ordinal);
        return times;
    }

    // Shape + window only. Whether the team is actually free then is checked against the stored
    // hours in ValidateSlotAvailableAsync - hiding a slot in the UI is not a guard on its own.
    private (bool Ok, DateTime Slot, string? Error) ParseAndValidateSlot(string slotStr)
    {
        if (!DateTime.TryParse(slotStr, CultureInfo.InvariantCulture, DateTimeStyles.None, out var slot))
            return (false, default, "Invalid date/time.");
        slot = new DateTime(slot.Year, slot.Month, slot.Day, slot.Hour, slot.Minute, 0);

        var today = LocalNow().Date;
        if (slot.Date < today.AddDays(MinNoticeDays()) || slot.Date > today.AddDays(HorizonDays()))
            return (false, slot, "That date is outside the booking window.");
        return (true, slot, null);
    }

    // The slot must fall inside the hours the training team has published for that date. Blocking a
    // date in Settings therefore refuses the booking even if someone posts straight to the API.
    private async Task<string?> ValidateSlotAvailableAsync(MySqlConnection conn, DateTime slot)
    {
        var weekly = await LoadWeeklyHoursAsync(conn);
        var overrides = await LoadOverridesAsync(conn, slot.Date, slot.Date);
        var (ranges, closedReason) = DayRanges(slot.Date, weekly, overrides);
        if (ranges.Count == 0)
            return closedReason is { Length: > 0 } and not "Not available"
                ? $"The training team is not available that day ({closedReason})."
                : "The training team is not available on that day.";
        var label = string.Format("{0:00}:{1:00}", slot.Hour, slot.Minute);
        if (!SlotsInRanges(ranges).Contains(label))
            return "The training team is not available at that time. Please pick another slot.";
        return null;
    }

    // ── book ─────────────────────────────────────────────────────────────────
    public async Task<BookAppointmentResponseDto> BookAsync(BookAppointmentDto dto, int userId)
    {
        if (dto.ClubId <= 0) return Fail("Club is required.");
        if (!await HasActiveWebsiteAsync(dto.ClubId))
            return Fail("Your club needs an active website subscription to book training.");

        var (ok, slot, err) = ParseAndValidateSlot(dto.SlotStart);
        if (!ok) return Fail(err!);

        await using var conn = NewConn();
        await conn.OpenAsync();
        var blocked = await ValidateSlotAvailableAsync(conn, slot);
        if (blocked != null) return Fail(blocked);
        long id;
        using (var tx = await conn.BeginTransactionAsync())
        {
            var dayStart = slot.Date; var dayEnd = slot.Date.AddDays(1);
            var dayAppts = (await conn.QueryAsync<DateTime>(@"
                SELECT SlotStart FROM website_training_appointments
                WHERE SlotStart >= @S AND SlotStart < @E AND Status <> 'Cancelled' AND isdeleted = 0
                FOR UPDATE", new { S = dayStart, E = dayEnd }, tx)).ToList();

            if (dayAppts.Count >= MaxPerDay()) { await tx.RollbackAsync(); return Fail("That date is fully booked. Please pick another day."); }
            if (dayAppts.Any(x => x == slot)) { await tx.RollbackAsync(); return Fail("That slot was just taken. Please pick another."); }

            var fkDistrict = await conn.ExecuteScalarAsync<int?>(
                "SELECT fk_district_id FROM club_master WHERE pk_club_id = @C", new { C = dto.ClubId }, tx) ?? 0;

            id = await conn.ExecuteScalarAsync<long>(@"
                INSERT INTO website_training_appointments
                    (fk_club_id, fk_district_id, SlotStart, DurationMinutes, Status, fk_booker_member_id, Notes, created_by, created_date, isdeleted)
                VALUES (@Club, @District, @Slot, @Dur, 'Scheduled', @User, @Notes, @User, NOW(), 0);
                SELECT LAST_INSERT_ID();",
                new { Club = dto.ClubId, District = fkDistrict, Slot = slot, Dur = SlotMinutes(), User = userId, Notes = dto.Notes }, tx);

            await tx.CommitAsync();
        }

        // Zoom + emails happen after the slot is reserved (outside the row lock).
        var clubName = await ClubNameAsync(conn, dto.ClubId);
        var zoom = _zoom.IsConfigured
            ? await _zoom.CreateMeetingAsync($"Website Training — {clubName}", slot, SlotMinutes())
            : null;
        if (zoom != null)
            await conn.ExecuteAsync(
                "UPDATE website_training_appointments SET ZoomMeetingId=@M, ZoomJoinUrl=@J, ZoomStartUrl=@S, modified_date=NOW() WHERE pk_id=@Id",
                new { M = zoom.MeetingId, J = zoom.JoinUrl, S = zoom.StartUrl, Id = id });

        await NotifyAsync(conn, id, dto.ClubId, clubName, slot, zoom?.JoinUrl, userId, isReschedule: false);

        return await SuccessWithAppointmentAsync(conn, id);
    }

    // ── reschedule (auth is enforced by the controller before calling) ──────────
    public async Task<BookAppointmentResponseDto> RescheduleAsync(RescheduleAppointmentDto dto, int userId)
    {
        var (ok, slot, err) = ParseAndValidateSlot(dto.SlotStart);
        if (!ok) return Fail(err!);

        await using var conn = NewConn();
        await conn.OpenAsync();
        var blocked = await ValidateSlotAvailableAsync(conn, slot);
        if (blocked != null) return Fail(blocked);

        var appt = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT pk_id, fk_club_id, SlotStart, ZoomMeetingId, Status FROM website_training_appointments WHERE pk_id=@Id AND isdeleted=0",
            new { Id = dto.AppointmentId });
        if (appt == null || (string?)appt.Status == "Cancelled") return Fail("Appointment not found.");
        int clubId = (int)appt.fk_club_id;

        using (var tx = await conn.BeginTransactionAsync())
        {
            var dayStart = slot.Date; var dayEnd = slot.Date.AddDays(1);
            var dayAppts = (await conn.QueryAsync<dynamic>(@"
                SELECT pk_id, SlotStart FROM website_training_appointments
                WHERE SlotStart >= @S AND SlotStart < @E AND Status <> 'Cancelled' AND isdeleted = 0
                FOR UPDATE", new { S = dayStart, E = dayEnd }, tx)).ToList();

            var others = dayAppts.Where(a => (long)a.pk_id != dto.AppointmentId).ToList();
            if (others.Count >= MaxPerDay()) { await tx.RollbackAsync(); return Fail("That date is fully booked. Please pick another day."); }
            if (others.Any(a => (DateTime)a.SlotStart == slot)) { await tx.RollbackAsync(); return Fail("That slot is taken. Please pick another."); }

            await conn.ExecuteAsync(@"
                UPDATE website_training_appointments
                SET SlotStart=@Slot, Status='Scheduled', RescheduleCount=RescheduleCount+1, modified_by=@User, modified_date=NOW()
                WHERE pk_id=@Id", new { Slot = slot, User = userId, Id = dto.AppointmentId }, tx);
            await tx.CommitAsync();
        }

        // Keep the same Zoom meeting — just move its time.
        var meetingId = (string?)appt.ZoomMeetingId;
        if (!string.IsNullOrWhiteSpace(meetingId) && _zoom.IsConfigured)
            await _zoom.UpdateMeetingTimeAsync(meetingId!, slot, SlotMinutes());

        var clubName = await ClubNameAsync(conn, clubId);
        var joinUrl = await conn.ExecuteScalarAsync<string?>(
            "SELECT ZoomJoinUrl FROM website_training_appointments WHERE pk_id=@Id", new { Id = dto.AppointmentId });
        await NotifyAsync(conn, dto.AppointmentId, clubId, clubName, slot, joinUrl, userId, isReschedule: true);

        return await SuccessWithAppointmentAsync(conn, dto.AppointmentId);
    }

    // ── reads ────────────────────────────────────────────────────────────────
    public async Task<List<TrainingAppointmentDto>> GetForClubAsync(int clubId)
    {
        await using var conn = NewConn();
        await conn.OpenAsync();
        return (await QueryAppointmentsAsync(conn,
            "a.fk_club_id = @C AND a.Status <> 'Cancelled' AND a.isdeleted = 0 AND a.SlotStart >= (NOW() - INTERVAL 1 DAY)",
            "a.SlotStart ASC", new { C = clubId })).ToList();
    }

    public async Task<List<TrainingAppointmentDto>> GetAllAsync()
    {
        await using var conn = NewConn();
        await conn.OpenAsync();
        return (await QueryAppointmentsAsync(conn, "a.isdeleted = 0", "a.SlotStart DESC", new { })).ToList();
    }

    public async Task<int?> GetAppointmentClubIdAsync(long appointmentId)
    {
        await using var conn = NewConn();
        await conn.OpenAsync();
        return await conn.ExecuteScalarAsync<int?>(
            "SELECT fk_club_id FROM website_training_appointments WHERE pk_id=@Id AND isdeleted=0", new { Id = appointmentId });
    }

    // ── helpers ──────────────────────────────────────────────────────────────
    private static async Task<IEnumerable<TrainingAppointmentDto>> QueryAppointmentsAsync(MySqlConnection conn, string where, string orderBy, object args)
    {
        return await conn.QueryAsync<TrainingAppointmentDto>($@"
            SELECT a.pk_id AS Id, a.fk_club_id AS ClubId, c.ClubName AS ClubName,
                   DATE_FORMAT(a.SlotStart, '%Y-%m-%dT%H:%i:%s') AS SlotStart,
                   a.DurationMinutes AS DurationMinutes, a.Status AS Status,
                   a.ZoomJoinUrl AS ZoomJoinUrl, a.ZoomStartUrl AS ZoomStartUrl,
                   m.MemberName AS BookedByName, a.Notes AS Notes, a.created_date AS BookedDate
            FROM website_training_appointments a
            LEFT JOIN club_master c ON c.pk_club_id = a.fk_club_id
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = a.fk_booker_member_id
            WHERE {where}
            ORDER BY {orderBy}", args);
    }

    private static async Task<string> ClubNameAsync(MySqlConnection conn, int clubId) =>
        await conn.ExecuteScalarAsync<string?>("SELECT ClubName FROM club_master WHERE pk_club_id=@C", new { C = clubId }) ?? "your club";

    private async Task<BookAppointmentResponseDto> SuccessWithAppointmentAsync(MySqlConnection conn, long id)
    {
        var appt = (await QueryAppointmentsAsync(conn, "a.pk_id = @Id", "a.pk_id", new { Id = id })).FirstOrDefault();
        return new BookAppointmentResponseDto { IsSuccess = true, Appointment = appt };
    }

    private static BookAppointmentResponseDto Fail(string msg) => new() { IsSuccess = false, Message = msg };

    // Personal confirmation to the booker + FYI to ALL club admins + the configured team list.
    // Recipients are de-duped (case-insensitive) so nobody is emailed twice, and each send is
    // isolated so one bad address never blocks the rest. Whole thing is best-effort.
    private async Task NotifyAsync(MySqlConnection conn, long apptId, int clubId, string clubName, DateTime slot, string? joinUrl, int bookerId, bool isReschedule)
    {
        var sentTo = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        async Task SendSafe(string? to, string subject, string body, string? cc = null)
        {
            if (string.IsNullOrWhiteSpace(to)) return;
            var addr = to.Trim();
            if (!sentTo.Add(addr)) return; // already emailed this address
            try { await _email.SendGenericEmailWithCcAsync(addr, cc, subject, body); }
            catch (Exception ex) { _logger.LogWarning(ex, "Training {Id}: email to {To} failed.", apptId, LogMask.Email(addr)); }
        }

        try
        {
            var booker = await conn.QueryFirstOrDefaultAsync<dynamic>(
                "SELECT MemberName, EmailId FROM member_master_profile WHERE pk_member_master_profile_id=@Id", new { Id = bookerId });
            string bookerName = (string?)booker?.MemberName ?? "there";
            string? bookerEmail = (string?)booker?.EmailId;
            string when = slot.ToString("dddd, dd MMM yyyy 'at' h:mm tt", CultureInfo.InvariantCulture);
            string verb = isReschedule ? "rescheduled" : "confirmed";
            string linkHtml = string.IsNullOrWhiteSpace(joinUrl)
                ? "<p>The Zoom meeting link will be shared shortly.</p>"
                : $"<p><strong>Zoom link:</strong> <a href=\"{joinUrl}\">{joinUrl}</a></p>";

            // S5: the booker's and the club admins' emails in the club's language; the internal team email below
            // stays English.
            using (RotaryApi.Services.Localization.MessageCulture.Use(await CommsTemplates.DefaultLanguageAsync(conn, clubId, 0)))
            {
                var L = RotaryApi.Services.Localization.DbStringLocalizer.Instance;
                string whenLocal = $"{slot.ToString("dddd, dd MMM yyyy, h:mm tt", CultureInfo.CurrentCulture)} ({Brand.TimeZoneLabel})";
                string localLink = string.IsNullOrWhiteSpace(joinUrl)
                    ? $"<p>{L["The Zoom meeting link will be shared shortly."]}</p>"
                    : $"<p><strong>{L["Zoom link:"]}</strong> <a href=\"{joinUrl}\">{joinUrl}</a></p>";

                // 1. Personal confirmation to whoever booked it.
                if (!string.IsNullOrWhiteSpace(bookerEmail))
                {
                    var body = $@"<p>{L["Hi {0},", bookerName]}</p>
<p>{(isReschedule ? L["Your website training session for {0} has been rescheduled for:", $"<strong>{clubName}</strong>"]
                  : L["Your website training session for {0} has been confirmed for:", $"<strong>{clubName}</strong>"])}</p>
<p style=""font-size:16px""><strong>{whenLocal}</strong></p>
{localLink}
<p>{L["Please join a few minutes early. If you need to change the time, use the Reschedule option in your dashboard."]}</p>";
                    await SendSafe(bookerEmail, isReschedule ? L["Website Training Rescheduled — {0}", whenLocal] : L["Website Training Confirmed — {0}", whenLocal], body,
                        cc: RotaryApi.Services.Brand.InternalCc);
                }

                // 2. FYI to all active club admins (skips the booker via the de-dupe set).
                var adminBody = $@"<p>{(isReschedule ? L["A website training session for {0} has been rescheduled:", $"<strong>{clubName}</strong>"]
                                       : L["A website training session for {0} has been confirmed:", $"<strong>{clubName}</strong>"])}</p>
<ul>
  <li><strong>{L["When:"]}</strong> {whenLocal}</li>
  <li><strong>{L["Booked by:"]}</strong> {bookerName}</li>
</ul>
{localLink}
<p>{L["Any club admin may join using the link above. To change the time, use the Reschedule option in the club admin dashboard."]}</p>";
                foreach (var admin in await ClubAdminRecipientsAsync(conn, clubId))
                    await SendSafe(admin.Email, isReschedule ? L["Website Training Rescheduled — {0} ({1})", clubName, whenLocal]
                                                             : L["Website Training Scheduled — {0} ({1})", clubName, whenLocal], adminBody);
            }

            // 3. Internal team list (config-driven; currently empty by default).
            var teamBody = $@"<p>A website training appointment was {verb}:</p>
<ul>
  <li><strong>Club:</strong> {clubName}</li>
  <li><strong>When:</strong> {when} ({Brand.TimeZoneLabel})</li>
  <li><strong>Booked by:</strong> {bookerName}</li>
</ul>
{linkHtml}";
            foreach (var t in TeamEmails())
                await SendSafe(t, $"New Website Training {(isReschedule ? "Reschedule" : "Booking")} — {clubName} ({when})", teamBody);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Training appointment {Id} notification emails failed.", apptId);
        }
    }

    private sealed class AdminRecipient
    {
        public string? Name { get; set; }
        public string? Email { get; set; }
    }

    // Active club admins (member_roles.fk_role_id = 2, club-scoped) with an email on file.
    private static async Task<List<AdminRecipient>> ClubAdminRecipientsAsync(MySqlConnection conn, int clubId)
    {
        var rows = await conn.QueryAsync<AdminRecipient>(@"
            SELECT DISTINCT m.MemberName AS Name, m.EmailId AS Email
            FROM member_roles mr
            JOIN member_master_profile m ON m.pk_member_master_profile_id = mr.fk_member_master_profile_id
            WHERE mr.fk_role_id = 2 AND mr.fk_club_id = @ClubId
              AND mr.IsActive = 1 AND mr.isdeleted = 0
              AND m.isdeleted = 0
              AND m.EmailId IS NOT NULL AND m.EmailId <> ''",
            new { ClubId = clubId });
        return rows.ToList();
    }

    // ── Super Admin: the training team's availability (user 2026-09-29) ─────────
    // One shared calendar for the whole training team - the daily cap is global too.
    private static readonly string[] DayNames = { "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday" };

    private static string Hhmm(TimeSpan t) => string.Format("{0:00}:{1:00}", t.Hours, t.Minutes);

    private static bool TryHhmm(string? v, out TimeSpan t)
    {
        t = default;
        return !string.IsNullOrWhiteSpace(v) && TimeSpan.TryParse(v.Trim(), CultureInfo.InvariantCulture, out t);
    }

    public async Task<TrainingAvailabilityDto> GetAvailabilitySettingsAsync()
    {
        await using var conn = NewConn();
        await conn.OpenAsync();
        var weekly = await LoadWeeklyHoursAsync(conn);

        var week = new List<TrainingWeekdayDto>();
        for (int d = 0; d < 7; d++)
        {
            var ranges = weekly.TryGetValue(d, out var r) ? r : new List<HourRange>();
            week.Add(new TrainingWeekdayDto
            {
                DayOfWeek = d,
                DayName = DayNames[d],
                IsAvailable = ranges.Count > 0,
                Ranges = ranges.OrderBy(x => x.Start)
                    .Select(x => new TrainingHourRangeDto { Id = x.Id, Start = Hhmm(x.Start), End = Hhmm(x.End) }).ToList(),
            });
        }

        // Overrides from today forward - past ones are history and only clutter the screen.
        var today = LocalNow().Date;
        var rows = (await conn.QueryAsync<(int pk, DateTime dt, bool allDay, TimeSpan? st, TimeSpan? en, string? reason)>(
            @"SELECT pk_id, OverrideDate, IsUnavailableAllDay, StartTime, EndTime, Reason
              FROM training_date_overrides
              WHERE isdeleted = 0 AND OverrideDate >= @T
              ORDER BY OverrideDate, StartTime", new { T = today })).ToList();

        var bookedPerDay = (await conn.QueryAsync<(DateTime d, int n)>(
            @"SELECT DATE(SlotStart) AS d, COUNT(*) AS n FROM website_training_appointments
              WHERE SlotStart >= @T AND Status <> 'Cancelled' AND isdeleted = 0
              GROUP BY DATE(SlotStart)", new { T = today })).ToDictionary(x => x.d.Date, x => x.n);

        var overrides = new List<TrainingDateOverrideDto>();
        foreach (var g in rows.GroupBy(r => r.dt.Date).OrderBy(g => g.Key))
        {
            var first = g.First();
            overrides.Add(new TrainingDateOverrideDto
            {
                Id = first.pk,
                Date = g.Key.ToString("yyyy-MM-dd"),
                DateLabel = g.Key.ToString("ddd, dd MMM yyyy", CultureInfo.InvariantCulture),
                IsUnavailableAllDay = g.Any(x => x.allDay),
                Reason = g.Select(x => x.reason).FirstOrDefault(x => !string.IsNullOrWhiteSpace(x)),
                Ranges = g.Where(x => !x.allDay && x.st != null && x.en != null)
                          .OrderBy(x => x.st)
                          .Select(x => new TrainingHourRangeDto { Id = x.pk, Start = Hhmm(x.st!.Value), End = Hhmm(x.en!.Value) })
                          .ToList(),
                BookedCount = bookedPerDay.GetValueOrDefault(g.Key, 0),
            });
        }

        return new TrainingAvailabilityDto
        {
            SlotMinutes = SlotMinutes(),
            MaxPerDay = MaxPerDay(),
            Week = week,
            Overrides = overrides,
        };
    }

    // The whole week is replaced in one go - simplest thing that keeps the screen and the table in
    // step. Old rows are soft-deleted, never removed.
    public async Task SaveWeeklyHoursAsync(SaveTrainingWeekRequest request, int userId)
    {
        await using var conn = NewConn();
        await conn.OpenAsync();
        using var tx = await conn.BeginTransactionAsync();
        await conn.ExecuteAsync(
            "UPDATE training_weekly_hours SET isdeleted = 1, modified_by = @U, modified_date = NOW() WHERE isdeleted = 0",
            new { U = userId }, tx);

        foreach (var day in request.Week ?? new List<TrainingWeekdayDto>())
        {
            if (day.DayOfWeek is < 0 or > 6 || !day.IsAvailable) continue;
            foreach (var r in day.Ranges ?? new List<TrainingHourRangeDto>())
            {
                if (!TryHhmm(r.Start, out var st) || !TryHhmm(r.End, out var en)) continue;
                if (en <= st) throw new InvalidOperationException($"{DayNames[day.DayOfWeek]}: the end time must be after the start time.");
                await conn.ExecuteAsync(@"
                    INSERT INTO training_weekly_hours (DayOfWeek, StartTime, EndTime, created_by, created_date)
                    VALUES (@D, @S, @E, @U, NOW())",
                    new { D = day.DayOfWeek, S = st, E = en, U = userId }, tx);
            }
        }
        await tx.CommitAsync();
    }

    // One date: either closed all day, or the hours they ARE free. Saving a date replaces whatever
    // was stored for it. Appointments already booked on that date are LEFT ALONE - the screen shows
    // the count so the Super Admin can move them by hand.
    public async Task<int> SaveDateOverrideAsync(SaveTrainingOverrideRequest request, int userId)
    {
        // One date or many - the screen can hand over a whole run of days picked off the calendar,
        // all carrying the same rule (user 2026-09-29).
        var raw = new List<string>();
        if (!string.IsNullOrWhiteSpace(request.Date)) raw.Add(request.Date);
        if (request.Dates != null) raw.AddRange(request.Dates.Where(d => !string.IsNullOrWhiteSpace(d)));

        var dates = new List<DateTime>();
        foreach (var one in raw)
        {
            if (!DateTime.TryParse(one, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d))
                throw new InvalidOperationException($"\"{one}\" is not a valid date.");
            if (d.Date < LocalNow().Date) throw new InvalidOperationException($"{d:dd MMM yyyy} has already passed.");
            if (!dates.Contains(d.Date)) dates.Add(d.Date);
        }
        if (dates.Count == 0) throw new InvalidOperationException("Pick at least one date.");

        // Validate the hours ONCE, before touching anything - a bad time must not leave half the
        // selected dates blocked and the rest not.
        var ranges = new List<(TimeSpan Start, TimeSpan End)>();
        if (!request.IsUnavailableAllDay)
        {
            foreach (var r in request.Ranges ?? new List<TrainingHourRangeDto>())
            {
                if (!TryHhmm(r.Start, out var st) || !TryHhmm(r.End, out var en)) continue;
                if (en <= st) throw new InvalidOperationException("The end time must be after the start time.");
                ranges.Add((st, en));
            }
            if (ranges.Count == 0)
                throw new InvalidOperationException("Give the hours the team is free that day, or mark the day unavailable.");
        }

        await using var conn = NewConn();
        await conn.OpenAsync();
        using var tx = await conn.BeginTransactionAsync();

        int firstId = 0;
        foreach (var date in dates)
        {
            // Saving a date REPLACES whatever it had.
            await conn.ExecuteAsync(
                "UPDATE training_date_overrides SET isdeleted = 1, modified_by = @U, modified_date = NOW() WHERE OverrideDate = @D AND isdeleted = 0",
                new { D = date, U = userId }, tx);

            if (request.IsUnavailableAllDay)
            {
                var id = await conn.ExecuteScalarAsync<int>(@"
                    INSERT INTO training_date_overrides (OverrideDate, IsUnavailableAllDay, Reason, created_by, created_date)
                    VALUES (@D, 1, @R, @U, NOW());
                    SELECT LAST_INSERT_ID();",
                    new { D = date, R = request.Reason, U = userId }, tx);
                if (firstId == 0) firstId = id;
            }
            else
            {
                foreach (var (st, en) in ranges)
                {
                    var id = await conn.ExecuteScalarAsync<int>(@"
                        INSERT INTO training_date_overrides (OverrideDate, IsUnavailableAllDay, StartTime, EndTime, Reason, created_by, created_date)
                        VALUES (@D, 0, @S, @E, @R, @U, NOW());
                        SELECT LAST_INSERT_ID();",
                        new { D = date, S = st, E = en, R = request.Reason, U = userId }, tx);
                    if (firstId == 0) firstId = id;
                }
            }
        }
        await tx.CommitAsync();
        return firstId;
    }

    // Removing an override puts that date back on the normal weekly pattern.
    public async Task DeleteDateOverrideAsync(int id, int userId)
    {
        await using var conn = NewConn();
        await conn.OpenAsync();
        var date = await conn.ExecuteScalarAsync<DateTime?>(
            "SELECT OverrideDate FROM training_date_overrides WHERE pk_id = @Id AND isdeleted = 0", new { Id = id });
        if (date == null) return;
        await conn.ExecuteAsync(
            "UPDATE training_date_overrides SET isdeleted = 1, modified_by = @U, modified_date = NOW() WHERE OverrideDate = @D AND isdeleted = 0",
            new { D = date.Value.Date, U = userId });
    }
}
