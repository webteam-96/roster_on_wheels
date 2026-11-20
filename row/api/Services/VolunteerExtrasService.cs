using System.Globalization;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

/// <summary>
/// Extras on volunteer sign-up sheets (VolunteerService): a confirmation email text per sheet (sent on every sign-up
/// once the club writes one), follow-up emails N days before a slot or after it (VolunteerFollowupBackgroundService
/// sends each once per sign-up), archiving a finished sheet, copying a sheet as a new one, and emailing the volunteer
/// list to the sheet's coordinators. Who may call what: VolunteerExtrasController and VolunteersController.
/// </summary>
public class VolunteerExtrasService
{
    public const int MaxFollowups = 5, MaxDays = 90, MaxCoordinators = 10, MaxShiftDays = 730;
    // shortcut: a thank-you added more than 30 days after it was due is not sent, raise it if clubs ask.
    public static readonly TimeSpan AfterWindow = TimeSpan.FromDays(30);
    private readonly string _cs;
    private readonly IEmailService _email;
    private readonly ILogger<VolunteerExtrasService> _log;

    public VolunteerExtrasService(IConfiguration config, IEmailService email, ILogger<VolunteerExtrasService> log)
    {
        _cs = config.GetConnectionString("DefaultConnection")!;
        _email = email;
        _log = log;
    }

    // ===== Pure rules (unit tested) =====

    /// <summary>When a follow-up is due for a slot: days before it starts, or days after it ends (or starts).</summary>
    public static DateTime DueAt(string kind, int days, DateTime startsAt, DateTime? endsAt) =>
        kind == "before" ? startsAt.AddDays(-days) : (endsAt ?? startsAt).AddDays(days);

    /// <summary>A reminder goes from its due time until the slot starts; a thank-you from its due time for 30 days.</summary>
    public static bool IsDue(string kind, int days, DateTime startsAt, DateTime? endsAt, DateTime now)
    {
        var due = DueAt(kind, days, startsAt, endsAt);
        return now >= due && (kind == "before" ? now < startsAt : now < due + AfterWindow);
    }

    public static List<VolunteerFollowupDto> NormalizeFollowups(List<VolunteerFollowupDto>? list)
    {
        list ??= new();
        if (list.Count > MaxFollowups) throw new InvalidOperationException($"A sheet has {MaxFollowups} follow-up emails at most.");
        foreach (var f in list)
        {
            if (f.Kind is not ("before" or "after")) throw new InvalidOperationException("A follow-up goes before or after the slot.");
            var min = f.Kind == "before" ? 1 : 0;
            if (f.Days < min || f.Days > MaxDays) throw new InvalidOperationException($"Days for a follow-up are from {min} to {MaxDays}.");
            f.Subject = VolunteerService.Clean(f.Subject, 200, "A follow-up subject") ?? throw new InvalidOperationException("Every follow-up needs a subject.");
            f.Body = VolunteerService.Clean(f.Body, 4000, "A follow-up text") ?? throw new InvalidOperationException("Every follow-up needs a text.");
        }
        if (list.Where(f => f.Id != null).GroupBy(f => f.Id).Any(g => g.Count() > 1)) throw new InvalidOperationException("A follow-up is listed twice.");
        return list;
    }

    /// <summary>Plain text typed by the club as HTML: encoded, blank lines start paragraphs, line breaks kept.</summary>
    public static string TextToHtml(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return "";
        var paragraphs = text.Replace("\r\n", "\n").Split("\n\n", StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return string.Concat(paragraphs.Select(p => $"<p>{WebUtility.HtmlEncode(p).Replace("\n", "<br>")}</p>"));
    }

    private static string E(string? s) => WebUtility.HtmlEncode(s ?? "");

    private static string Wrap(string? name, string clubName, string body) => $@"<div style=""font-family:Figtree, Arial,Helvetica,sans-serif;font-size:15px;color:#1B2C42;line-height:1.6;max-width:640px"">
<p>Dear {E(name)},</p>
{body}
<p style=""color:#64748b;font-size:12px"">This is an automated message from {E(Brand.ProductName)} for {E(clubName)}.</p>
</div>";

    private static string When(DateTime start, DateTime? end) =>
        start.ToString("dddd d MMMM yyyy, HH:mm", CultureInfo.InvariantCulture)
        + (end is { } u ? " to " + u.ToString(u.Date == start.Date ? "HH:mm" : "d MMMM, HH:mm", CultureInfo.InvariantCulture) : "");

    private static string SlotLine(string task, string sheet, DateTime start, DateTime? end) =>
        $"<p><strong>{E(task)}</strong> ({E(sheet)})<br>{E(When(start, end))}</p>";

    private static string? Address(string? email) => email?.Trim() is { Length: > 3 } e && e.Contains('@') ? e : null;

    private static Task<bool> SheetOfClubAsync(MySqlConnection c, int clubId, int id, MySqlTransaction? tx = null) =>
        c.ExecuteScalarAsync<bool>("SELECT COUNT(*) > 0 FROM volunteer_sheets WHERE pk_sheet_id = @id AND fk_club_id = @clubId",
            new { id, clubId }, tx);

    private static Task<IEnumerable<VolunteerCoordinatorDto>> ClubMembersAsync(MySqlConnection c, int clubId) =>
        // shortcut: the first 2000 active members by name, add a search if a club has more.
        c.QueryAsync<VolunteerCoordinatorDto>(@"
            SELECT DISTINCT m.pk_member_master_profile_id AS MemberId, m.MemberName AS Name,
                   (NULLIF(TRIM(m.EmailId), '') IS NOT NULL) AS HasEmail
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND IFNULL(m.isdeleted, 0) = 0
            WHERE cm.fk_club_id = @clubId AND cm.IsActive = 1 AND IFNULL(cm.isdeleted, 0) = 0
            ORDER BY m.MemberName LIMIT 2000", new { clubId });

    // ===== Club admins =====

    public async Task<VolunteerSheetExtrasDto?> GetExtrasAsync(int clubId, int id)
    {
        await using var c = RowDb.Connect(_cs);
        await c.OpenAsync();
        var s = await c.QueryFirstOrDefaultAsync<VolunteerSheetExtrasDto>(@"
            SELECT confirmation_text AS ConfirmationText, archived_at AS ArchivedAt FROM volunteer_sheets
            WHERE pk_sheet_id = @id AND fk_club_id = @clubId", new { id, clubId });
        if (s == null) return null;
        s.Followups = (await c.QueryAsync<VolunteerFollowupDto>(@"
            SELECT f.pk_followup_id AS Id, f.kind AS Kind, f.days AS Days, f.subject AS Subject, f.body AS Body,
                   (SELECT COUNT(*) FROM volunteer_followup_sends x WHERE x.fk_followup_id = f.pk_followup_id) AS SentCount
            FROM volunteer_followups f WHERE f.fk_sheet_id = @id ORDER BY f.kind DESC, f.days DESC, f.pk_followup_id", new { id })).ToList();
        s.CoordinatorIds = (await c.QueryAsync<int>(
            "SELECT fk_member_id FROM volunteer_sheet_coordinators WHERE fk_sheet_id = @id ORDER BY fk_member_id", new { id })).ToList();
        s.Members = (await ClubMembersAsync(c, clubId)).ToList();
        return s;
    }

    /// <summary>Saves the confirmation text, the follow-ups (kept by id, so what was sent stays sent) and the
    /// coordinators, who must be active members of the club.</summary>
    public async Task<VolunteerSheetExtrasDto?> SaveExtrasAsync(int clubId, int id, SaveVolunteerSheetExtrasDto dto)
    {
        var text = VolunteerService.Clean(dto.ConfirmationText, 4000, "The confirmation text");
        var followups = NormalizeFollowups(dto.Followups);
        var coordinators = (dto.CoordinatorIds ?? new()).Distinct().ToList();
        if (coordinators.Count > MaxCoordinators) throw new InvalidOperationException($"A sheet has {MaxCoordinators} coordinators at most.");
        await using (var c = RowDb.Connect(_cs))
        {
            await c.OpenAsync();
            await using var tx = await c.BeginTransactionAsync();
            if (await c.QueryFirstOrDefaultAsync<int?>("SELECT pk_sheet_id FROM volunteer_sheets WHERE pk_sheet_id = @id AND fk_club_id = @clubId FOR UPDATE",
                    new { id, clubId }, tx) == null)
                return null;
            if (coordinators.Count > 0 && await c.ExecuteScalarAsync<int>(@"
                    SELECT COUNT(DISTINCT cm.fk_member_master_profile_id) FROM club_members cm
                    WHERE cm.fk_club_id = @clubId AND cm.IsActive = 1 AND IFNULL(cm.isdeleted, 0) = 0
                      AND cm.fk_member_master_profile_id IN @coordinators", new { clubId, coordinators }, tx) != coordinators.Count)
                throw new InvalidOperationException("Coordinators must be active members of the club.");
            var existing = (await c.QueryAsync<int>("SELECT pk_followup_id FROM volunteer_followups WHERE fk_sheet_id = @id", new { id }, tx)).ToHashSet();
            if (followups.Any(f => f.Id is int fid && !existing.Contains(fid))) throw new InvalidOperationException("Follow-up not found.");
            var kept = followups.Where(f => f.Id != null).Select(f => f.Id!.Value).ToList();
            foreach (var gone in existing.Except(kept))
                await c.ExecuteAsync("DELETE FROM volunteer_followups WHERE pk_followup_id = @gone", new { gone }, tx);
            foreach (var f in followups)
                await c.ExecuteAsync(f.Id == null
                    ? "INSERT INTO volunteer_followups (fk_sheet_id, kind, days, subject, body) VALUES (@id, @Kind, @Days, @Subject, @Body)"
                    : "UPDATE volunteer_followups SET kind = @Kind, days = @Days, subject = @Subject, body = @Body WHERE pk_followup_id = @Fid",
                    new { id, f.Kind, f.Days, f.Subject, f.Body, Fid = f.Id }, tx);
            await c.ExecuteAsync("DELETE FROM volunteer_sheet_coordinators WHERE fk_sheet_id = @id", new { id }, tx);
            foreach (var m in coordinators)
                await c.ExecuteAsync("INSERT INTO volunteer_sheet_coordinators (fk_sheet_id, fk_member_id) VALUES (@id, @m)", new { id, m }, tx);
            await c.ExecuteAsync("UPDATE volunteer_sheets SET confirmation_text = @text WHERE pk_sheet_id = @id", new { id, text }, tx);
            await tx.CommitAsync();
        }
        return await GetExtrasAsync(clubId, id);
    }

    /// <summary>Archiving closes the sheet to new sign-ups and moves it out of the main list; unarchiving brings it
    /// back, still closed. Follow-ups already due still go out.</summary>
    public async Task<bool> ArchiveAsync(int clubId, int id, bool archived)
    {
        await using var c = RowDb.Connect(_cs);
        return await c.ExecuteAsync(archived
            ? "UPDATE volunteer_sheets SET archived_at = COALESCE(archived_at, UTC_TIMESTAMP()), status = 'closed' WHERE pk_sheet_id = @id AND fk_club_id = @clubId"
            : "UPDATE volunteer_sheets SET archived_at = NULL WHERE pk_sheet_id = @id AND fk_club_id = @clubId", new { id, clubId }) > 0;
    }

    /// <summary>A new open sheet with the same text, slots (moved by shiftDays, no sign-ups), follow-ups and
    /// coordinators, and a new public link. Event and project links are left for the club to set again.</summary>
    public async Task<int?> CopyAsync(int clubId, int id, int shiftDays, int memberId)
    {
        if (shiftDays < 0 || shiftDays > MaxShiftDays) throw new InvalidOperationException($"Move the slots by 0 to {MaxShiftDays} days.");
        await using var c = RowDb.Connect(_cs);
        await c.OpenAsync();
        await using var tx = await c.BeginTransactionAsync();
        var title = await c.QueryFirstOrDefaultAsync<string?>("SELECT title FROM volunteer_sheets WHERE pk_sheet_id = @id AND fk_club_id = @clubId",
            new { id, clubId }, tx);
        if (title == null) return null;
        var copyTitle = title.Length > 193 ? title[..193] + " (copy)" : title + " (copy)";
        var newId = await c.ExecuteScalarAsync<int>(@"
            INSERT INTO volunteer_sheets (fk_club_id, title, description, public_token, is_public, status, created_by, confirmation_text)
            SELECT fk_club_id, @copyTitle, description, @token, is_public, 'open', @memberId, confirmation_text
            FROM volunteer_sheets WHERE pk_sheet_id = @id;
            SELECT LAST_INSERT_ID();",
            new { id, copyTitle, memberId, token = RandomNumberGenerator.GetHexString(32, true) }, tx);
        await c.ExecuteAsync(@"
            INSERT INTO volunteer_slots (fk_sheet_id, task, starts_at, ends_at, capacity)
            SELECT @newId, task, starts_at + INTERVAL @shiftDays DAY, ends_at + INTERVAL @shiftDays DAY, capacity
            FROM volunteer_slots WHERE fk_sheet_id = @id ORDER BY starts_at, pk_slot_id;
            INSERT INTO volunteer_followups (fk_sheet_id, kind, days, subject, body)
            SELECT @newId, kind, days, subject, body FROM volunteer_followups WHERE fk_sheet_id = @id ORDER BY pk_followup_id;
            INSERT INTO volunteer_sheet_coordinators (fk_sheet_id, fk_member_id)
            SELECT @newId, fk_member_id FROM volunteer_sheet_coordinators WHERE fk_sheet_id = @id;",
            new { id, newId, shiftDays }, tx);
        await tx.CommitAsync();
        return newId;
    }

    private sealed class RosterRow
    {
        public int SlotId { get; set; }
        public string Task { get; set; } = "";
        public DateTime StartsAt { get; set; }
        public DateTime? EndsAt { get; set; }
        public int Capacity { get; set; }
        public int Filled { get; set; }
        public string? Name { get; set; }
        public string? Email { get; set; }
        public decimal? Hours { get; set; }
    }

    /// <summary>Emails the sheet's volunteer list to each coordinator; the number of emails sent, or null when the
    /// sheet is not the club's.</summary>
    public async Task<int?> EmailCoordinatorsAsync(int clubId, int id)
    {
        await using var c = RowDb.Connect(_cs);
        await c.OpenAsync();
        var sheet = await c.QueryFirstOrDefaultAsync<(string Title, string ClubName, int? DistrictId)?>(@"
            SELECT sh.title, cl.ClubName, cl.fk_district_id FROM volunteer_sheets sh JOIN club_master cl ON cl.pk_club_id = sh.fk_club_id
            WHERE sh.pk_sheet_id = @id AND sh.fk_club_id = @clubId", new { id, clubId });
        if (sheet is not { } s) return null;
        var to = (await c.QueryAsync<(string? Name, string? Email)>(@"
            SELECT m.MemberName, m.EmailId FROM volunteer_sheet_coordinators k
            JOIN member_master_profile m ON m.pk_member_master_profile_id = k.fk_member_id AND IFNULL(m.isdeleted, 0) = 0
            JOIN club_members cm ON cm.fk_member_master_profile_id = k.fk_member_id AND cm.fk_club_id = @clubId AND cm.IsActive = 1 AND IFNULL(cm.isdeleted, 0) = 0
            WHERE k.fk_sheet_id = @id GROUP BY k.fk_member_id, m.MemberName, m.EmailId", new { id, clubId }))
            .Where(x => Address(x.Email) != null).ToList();
        if (to.Count == 0) throw new InvalidOperationException("Add coordinators with an email address first.");
        // a member's address is shown only when they let their club see it; a non-member gave theirs to the club
        var rows = (await c.QueryAsync<RosterRow>(@"
            SELECT sl.pk_slot_id AS SlotId, sl.task AS Task, sl.starts_at AS StartsAt, sl.ends_at AS EndsAt, sl.capacity AS Capacity,
                   sl.filled AS Filled, COALESCE(m.MemberName, su.name) AS Name,
                   CASE WHEN su.fk_member_id IS NULL THEN su.email WHEN IFNULL(m.ShowEmailInMyClub, 1) = 1 THEN m.EmailId END AS Email,
                   su.hours AS Hours
            FROM volunteer_slots sl
            LEFT JOIN volunteer_signups su ON su.fk_slot_id = sl.pk_slot_id
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = su.fk_member_id
            WHERE sl.fk_sheet_id = @id ORDER BY sl.starts_at, sl.pk_slot_id, su.pk_signup_id", new { id })).ToList();
        var zone = await ZoneTime.OfClubAsync(c, clubId);
        var html = new StringBuilder($"<p>The volunteer list for <strong>{E(s.Title)}</strong>:</p>");
        foreach (var slot in rows.GroupBy(r => r.SlotId))
        {
            var f = slot.First();
            html.Append(SlotLine(f.Task, $"{f.Filled} of {f.Capacity} places taken", ZoneTime.StoredToLocal(zone, f.StartsAt),
                f.EndsAt is { } e ? ZoneTime.StoredToLocal(zone, e) : null));
            var people = slot.Where(r => r.Name != null).ToList();
            html.Append(people.Count == 0 ? "<p>No sign-ups yet.</p>"
                : "<table cellpadding=\"4\" style=\"border-collapse:collapse;font-size:14px\"><tr><th align=\"left\">Name</th><th align=\"left\">Email</th><th align=\"right\">Hours</th></tr>"
                  + string.Concat(people.Select(p => $"<tr><td>{E(p.Name)}</td><td>{E(p.Email)}</td><td align=\"right\">{(p.Hours is { } h ? h.ToString("0.##", CultureInfo.InvariantCulture) : "")}</td></tr>"))
                  + "</table>");
        }
        foreach (var (name, email) in to)
            await _email.SendScopedEmailAsync(email!.Trim(), $"Volunteer list: {s.Title}", Wrap(name, s.ClubName, html.ToString()), clubId, s.DistrictId);
        return to.Count;
    }

    // ===== Sign-ups =====

    /// <summary>After a sign-up: the sheet's confirmation email, when the club wrote one. Never throws: the place is
    /// already taken, and email_log records a failed send.</summary>
    public async Task SendConfirmationAsync(int slotId, int? memberId, string? email)
    {
        try
        {
            await using var c = RowDb.Connect(_cs);
            await c.OpenAsync();
            var x = await c.QueryFirstOrDefaultAsync<FollowupDue>(@"
                SELECT COALESCE(m.EmailId, su.email) AS Email, COALESCE(m.MemberName, su.name) AS Name, sh.confirmation_text AS Body,
                       sl.task AS Task, sh.title AS Title, sl.starts_at AS StartsAt, sl.ends_at AS EndsAt, sh.fk_club_id AS ClubId,
                       cl.fk_district_id AS DistrictId, cl.ClubName
                FROM volunteer_signups su
                JOIN volunteer_slots sl ON sl.pk_slot_id = su.fk_slot_id
                JOIN volunteer_sheets sh ON sh.pk_sheet_id = sl.fk_sheet_id
                JOIN club_master cl ON cl.pk_club_id = sh.fk_club_id
                LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = su.fk_member_id
                WHERE su.fk_slot_id = @slotId AND NULLIF(TRIM(sh.confirmation_text), '') IS NOT NULL
                  AND (su.fk_member_id = @memberId OR (@memberId IS NULL AND su.fk_member_id IS NULL AND su.email = @email))
                LIMIT 1", new { slotId, memberId, email = email?.Trim().ToLowerInvariant() });
            if (x == null || Address(x.Email) is not { } to) return;
            var zone = await ZoneTime.OfClubAsync(c, x.ClubId);
            var body = TextToHtml(x.Body) + SlotLine(x.Task, x.Title, ZoneTime.StoredToLocal(zone, x.StartsAt),
                x.EndsAt is { } e ? ZoneTime.StoredToLocal(zone, e) : null);
            await _email.SendScopedEmailAsync(to, $"You are signed up: {x.Task}", Wrap(x.Name, x.ClubName, body), x.ClubId, x.DistrictId);
        }
        catch (Exception ex) { _log.LogError(ex, "Volunteer confirmation email failed for slot {SlotId}", slotId); }
    }

    private sealed class MySignupRow
    {
        public int SignupId { get; set; }
        public int SlotId { get; set; }
        public string SheetTitle { get; set; } = "";
        public string ClubName { get; set; } = "";
        public string Task { get; set; } = "";
        public DateTime StartsAt { get; set; }
        public DateTime? EndsAt { get; set; }
        public string? ConfirmationText { get; set; }
        public int SheetId { get; set; }
    }

    /// <summary>The app: the member's own coming sign-ups, with the confirmation text and each follow-up's text, when
    /// it is due and whether it went.</summary>
    public async Task<List<MemberVolunteerSignupDto>> ListMySignupsAsync(int memberId)
    {
        await using var c = RowDb.Connect(_cs);
        await c.OpenAsync();
        var rows = (await c.QueryAsync<MySignupRow>(@"
            SELECT su.pk_signup_id AS SignupId, sl.pk_slot_id AS SlotId, sh.title AS SheetTitle, cl.ClubName, sl.task AS Task,
                   sl.starts_at AS StartsAt, sl.ends_at AS EndsAt, sh.confirmation_text AS ConfirmationText, sh.pk_sheet_id AS SheetId
            FROM volunteer_signups su
            JOIN volunteer_slots sl ON sl.pk_slot_id = su.fk_slot_id AND sl.starts_at > NOW()
            JOIN volunteer_sheets sh ON sh.pk_sheet_id = sl.fk_sheet_id
            JOIN club_master cl ON cl.pk_club_id = sh.fk_club_id
            WHERE su.fk_member_id = @memberId
            ORDER BY sl.starts_at, sl.pk_slot_id LIMIT 200", new { memberId })).ToList();
        if (rows.Count == 0) return new();
        var sheetIds = rows.Select(r => r.SheetId).Distinct().ToList();
        var signupIds = rows.Select(r => r.SignupId).ToList();
        var followups = (await c.QueryAsync<(int Id, int SheetId, string Kind, int Days, string Subject, string Body)>(@"
            SELECT pk_followup_id, fk_sheet_id, kind, days, subject, body FROM volunteer_followups
            WHERE fk_sheet_id IN @sheetIds ORDER BY kind DESC, days DESC, pk_followup_id", new { sheetIds })).ToList();
        var sent = (await c.QueryAsync<(int FollowupId, int SignupId, DateTime SentAt)>(@"
            SELECT fk_followup_id, fk_signup_id, sent_at FROM volunteer_followup_sends WHERE fk_signup_id IN @signupIds", new { signupIds }))
            .ToDictionary(x => (x.FollowupId, x.SignupId), x => x.SentAt);
        return rows.Select(r => new MemberVolunteerSignupDto
        {
            SignupId = r.SignupId, SlotId = r.SlotId, SheetTitle = r.SheetTitle, ClubName = r.ClubName, Task = r.Task,
            StartsAt = r.StartsAt, EndsAt = r.EndsAt, ConfirmationText = r.ConfirmationText,
            Reminders = followups.Where(f => f.SheetId == r.SheetId).Select(f => new MemberVolunteerReminderDto
            {
                Kind = f.Kind, Days = f.Days, Subject = f.Subject, Body = f.Body, DueAt = DueAt(f.Kind, f.Days, r.StartsAt, r.EndsAt),
                SentAt = sent.TryGetValue((f.Id, r.SignupId), out var at) ? at : null,
            }).ToList(),
        }).ToList();
    }

    // ===== The follow-up job =====

    private sealed class FollowupDue
    {
        public int FollowupId { get; set; }
        public int SignupId { get; set; }
        public string Kind { get; set; } = "";
        public int Days { get; set; }
        public string Subject { get; set; } = "";
        public string Body { get; set; } = "";
        public string? Email { get; set; }
        public string? Name { get; set; }
        public string Task { get; set; } = "";
        public string Title { get; set; } = "";
        public DateTime StartsAt { get; set; }
        public DateTime? EndsAt { get; set; }
        public int ClubId { get; set; }
        public int? DistrictId { get; set; }
        public string ClubName { get; set; } = "";
    }

    /// <summary>One pass: every (follow-up, sign-up) pair now due and not yet sent is claimed in
    /// volunteer_followup_sends, then emailed; a crash loses one email instead of sending it twice. Returns the number
    /// claimed.</summary>
    // shortcut: failed sends are not retried (email_log shows them), like the 24-hour reminders.
    public async Task<int> RunFollowupsAsync(CancellationToken ct)
    {
        await using var c = RowDb.Connect(_cs);
        await c.OpenAsync(ct);
        var due = new List<(FollowupDue Row, TimeZoneInfo Zone)>();
        foreach (var (tz, zone) in await ZoneTime.ZonesAsync(c))
        {
            // slot times are stored like meeting times (UTC on a UTC server), as the 24-hour reminder job reads them
            var now = ZoneTime.StoredUtc ? DateTime.UtcNow : ZoneTime.Local(zone);
            var rows = await c.QueryAsync<FollowupDue>($@"
                SELECT f.pk_followup_id AS FollowupId, su.pk_signup_id AS SignupId, f.kind AS Kind, f.days AS Days, f.subject AS Subject,
                       f.body AS Body, COALESCE(m.EmailId, su.email) AS Email, COALESCE(m.MemberName, su.name) AS Name, sl.task AS Task,
                       sh.title AS Title, sl.starts_at AS StartsAt, sl.ends_at AS EndsAt, sh.fk_club_id AS ClubId,
                       cl.fk_district_id AS DistrictId, cl.ClubName
                FROM volunteer_followups f
                JOIN volunteer_sheets sh ON sh.pk_sheet_id = f.fk_sheet_id
                JOIN volunteer_slots sl ON sl.fk_sheet_id = sh.pk_sheet_id
                JOIN volunteer_signups su ON su.fk_slot_id = sl.pk_slot_id
                JOIN club_master cl ON cl.pk_club_id = sh.fk_club_id
                LEFT JOIN district_master dz ON dz.pk_district_id = cl.fk_district_id
                LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = su.fk_member_id AND IFNULL(m.isdeleted, 0) = 0
                WHERE NOT EXISTS (SELECT 1 FROM volunteer_followup_sends x WHERE x.fk_followup_id = f.pk_followup_id AND x.fk_signup_id = su.pk_signup_id)
                  AND sl.starts_at BETWEEN @Now - INTERVAL 125 DAY AND @Now + INTERVAL 95 DAY
                  {SubscriptionAccess.OwnerWorksSql("sh.fk_club_id", "0")} AND {ZoneTime.Filter("dz")}
                LIMIT 1000", new { Now = now, Tz = tz });
            due.AddRange(rows.Where(r => IsDue(r.Kind, r.Days, r.StartsAt, r.EndsAt, now)).Select(r => (r, zone)));
        }
        var claimed = 0;
        foreach (var (r, zone) in due)
        {
            if (await c.ExecuteAsync("INSERT IGNORE INTO volunteer_followup_sends (fk_followup_id, fk_signup_id) VALUES (@FollowupId, @SignupId)",
                    new { r.FollowupId, r.SignupId }) == 0)
                continue;
            claimed++;
            if (Address(r.Email) is not { } to) continue;
            var body = TextToHtml(r.Body) + SlotLine(r.Task, r.Title, ZoneTime.StoredToLocal(zone, r.StartsAt),
                r.EndsAt is { } e ? ZoneTime.StoredToLocal(zone, e) : null);
            await _email.SendScopedEmailAsync(to, r.Subject, Wrap(r.Name, r.ClubName, body), r.ClubId, r.DistrictId);
        }
        return claimed;
    }
}
