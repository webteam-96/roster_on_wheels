using System.Net.Mail;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Dapper;
using Microsoft.AspNetCore.DataProtection;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

/// <summary>
/// Volunteer sign-up sheets (ROW build spec 3.13): a club's sheet for an event or a service project, with slots (task,
/// time, capacity). Members sign up from the app; non-members through the sheet's public link (name, email, consent).
/// Capacity holds under concurrency: a sign-up first raises volunteer_slots.filled with a conditional UPDATE.
/// Hours recorded per person afterwards roll into the linked project's man_hours: hours_applied on the sheet is what
/// the sheet already added there, so every change adds only the difference, in the same transaction as the change
/// (sheet row locked). Who may call what: VolunteersController. Reminders: VolunteerReminderBackgroundService.
/// </summary>
// shortcut: club sheets only (district events and projects have no sheets yet), add district routes if districts ask.
// shortcut: people sign up themselves, a club admin cannot add a walk-in; add an admin "add sign-up" if clubs ask.
public partial class VolunteerService
{
    private const int MaxSlots = 50, MaxCapacity = 1000;
    private const decimal MaxHours = 999m;
    private static readonly TimeSpan FormLifetime = TimeSpan.FromHours(12), MinFillTime = TimeSpan.FromSeconds(3);
    private readonly string _cs;
    private readonly IYearTableResolver _years;
    private readonly ITimeLimitedDataProtector _forms;

    public VolunteerService(IConfiguration config, IYearTableResolver years, IDataProtectionProvider dataProtection)
    {
        _cs = config.GetConnectionString("DefaultConnection")!;
        _years = years;
        _forms = dataProtection.CreateProtector("VolunteerSignupForm").ToTimeLimitedDataProtector();
    }

    [GeneratedRegex("^[0-9a-f]{32}$")]
    private static partial Regex TokenShape();

    internal static string? Clean(string? s, int max, string what)
    {
        s = s?.Trim();
        if (string.IsNullOrEmpty(s)) return null;
        if (s.Length > max) throw new InvalidOperationException($"{what} is {max} characters at most.");
        return s;
    }

    /// <summary>A trimmed, lower-case email address; anything else is refused.</summary>
    internal static string CleanEmail(string? email)
    {
        email = email?.Trim().ToLowerInvariant() ?? "";
        if (email.Length is 0 or > 254 || !MailAddress.TryCreate(email, out var a) || a.Address != email || !a.Host.Contains('.'))
            throw new InvalidOperationException("Please enter a valid email address.");
        return email;
    }

    private sealed class SheetRow
    {
        public int Id { get; set; }
        public int ClubId { get; set; }
        public int? YearId { get; set; }
        public int? ProjectId { get; set; }
        public int HoursApplied { get; set; }
    }

    private static Task<SheetRow?> LockSheetAsync(MySqlConnection c, MySqlTransaction tx, int clubId, int id) =>
        c.QueryFirstOrDefaultAsync<SheetRow>($@"
            SELECT pk_sheet_id AS Id, fk_club_id AS ClubId, fk_year_id AS YearId, fk_project_id AS ProjectId, hours_applied AS HoursApplied
            FROM volunteer_sheets WHERE pk_sheet_id = @id AND fk_club_id = @clubId FOR UPDATE", new { id, clubId }, tx);

    /// <summary>Year id to its project table, for the tables that exist (read before a transaction starts).</summary>
    private async Task<Func<int?, string?>> ProjectTablesAsync(MySqlConnection c)
    {
        var tables = await _years.GetAllExistingYearTablesAsync(c);
        return yearId => tables.FirstOrDefault(t => t.YearId == yearId)?.ProjectsTable;
    }

    private static async Task MoveHoursAsync(MySqlConnection c, MySqlTransaction tx, string? table, int clubId, int? projectId, int delta)
    {
        if (delta == 0 || table == null || projectId == null) return;
        await c.ExecuteAsync($@"
            UPDATE `{table}` SET man_hours = GREATEST(0, COALESCE(man_hours, 0) + @delta)
            WHERE pk_project_id = @projectId AND fk_club_id = @clubId", new { delta, projectId, clubId }, tx);
    }

    /// <summary>Recomputes the sheet's hours and adds the difference to the linked project (none linked: the hours
    /// wait on the sheet and move into a project when one is linked).</summary>
    // shortcut: only hours roll in (man_hours); head counts stay as the club types them (non-members have no column),
    // roll members into rotarians_involved if clubs ask.
    private static async Task RollHoursAsync(MySqlConnection c, MySqlTransaction tx, SheetRow s, string? table)
    {
        var total = await c.ExecuteScalarAsync<decimal>(@"
            SELECT COALESCE(SUM(su.hours), 0) FROM volunteer_signups su
            JOIN volunteer_slots sl ON sl.pk_slot_id = su.fk_slot_id WHERE sl.fk_sheet_id = @Id", new { s.Id }, tx);
        var whole = (int)Math.Round(total, MidpointRounding.AwayFromZero); // man_hours is a whole number
        await MoveHoursAsync(c, tx, table, s.ClubId, s.ProjectId, whole - s.HoursApplied);
        await c.ExecuteAsync("UPDATE volunteer_sheets SET hours_applied = @whole WHERE pk_sheet_id = @Id", new { whole, s.Id }, tx);
    }

    // ===== Club admins =====

    public async Task<List<VolunteerSheetListItemDto>> ListAsync(int clubId)
    {
        await using var c = new MySqlConnection(_cs);
        // shortcut: the 500 newest sheets, add paging if a club runs more.
        return (await c.QueryAsync<VolunteerSheetListItemDto>($@"
            SELECT sh.pk_sheet_id AS Id, sh.title AS Title, sh.status AS Status, sh.is_public AS IsPublic,
                   (SELECT e.Title FROM upcoming_events e WHERE e.pk_upcoming_event_id = sh.fk_event_id) AS EventTitle,
                   sh.fk_project_id AS ProjectId, COUNT(sl.pk_slot_id) AS SlotCount,
                   COALESCE(SUM(sl.capacity), 0) AS Capacity, COALESCE(SUM(sl.filled), 0) AS Filled, MIN(sl.starts_at) AS FirstStart,
                   (SELECT COALESCE(SUM(su.hours), 0) FROM volunteer_signups su
                    JOIN volunteer_slots s2 ON s2.pk_slot_id = su.fk_slot_id WHERE s2.fk_sheet_id = sh.pk_sheet_id) AS Hours
            FROM volunteer_sheets sh
            LEFT JOIN volunteer_slots sl ON sl.fk_sheet_id = sh.pk_sheet_id
            WHERE sh.fk_club_id = @clubId
            GROUP BY sh.pk_sheet_id
            ORDER BY FirstStart DESC, sh.pk_sheet_id DESC LIMIT 500", new { clubId })).ToList();
    }

    /// <summary>The club's events and the chosen year's projects a sheet can be linked to.</summary>
    public async Task<VolunteerTargetsDto> GetTargetsAsync(int clubId, int? yearId)
    {
        await using var c = new MySqlConnection(_cs);
        await c.OpenAsync();
        var result = new VolunteerTargetsDto
        {
            Events = (await c.QueryAsync<VolunteerTargetDto>($@"
                SELECT pk_upcoming_event_id AS Id, Title, EventDate AS Date FROM upcoming_events
                WHERE fk_club_id = @clubId AND IFNULL(isdeleted, 0) = 0 AND EventDate >= NOW() - INTERVAL 1 YEAR
                ORDER BY EventDate DESC LIMIT 200", new { clubId })).ToList(),
        };
        var table = (await ProjectTablesAsync(c))(yearId);
        if (table != null)
            // shortcut: the newest 500 projects of the year, add a search if a club records more.
            result.Projects = (await c.QueryAsync<VolunteerTargetDto>($@"
                SELECT pk_project_id AS Id, title AS Title, project_date AS Date FROM `{table}`
                WHERE fk_club_id = @clubId AND IFNULL(isdeleted, 0) = 0
                ORDER BY project_date DESC, pk_project_id DESC LIMIT 500", new { clubId })).ToList();
        return result;
    }

    public async Task<VolunteerSheetDto?> GetSheetAsync(int clubId, int id)
    {
        await using var c = new MySqlConnection(_cs);
        await c.OpenAsync();
        var s = await c.QueryFirstOrDefaultAsync<VolunteerSheetDto>($@"
            SELECT sh.pk_sheet_id AS Id, sh.fk_club_id AS ClubId, sh.title AS Title, sh.description AS Description,
                   sh.fk_event_id AS EventId, e.Title AS EventTitle, sh.fk_year_id AS YearId, sh.fk_project_id AS ProjectId,
                   sh.hours_applied AS HoursApplied, sh.public_token AS PublicToken, sh.is_public AS IsPublic, sh.status AS Status
            FROM volunteer_sheets sh
            LEFT JOIN upcoming_events e ON e.pk_upcoming_event_id = sh.fk_event_id
            WHERE sh.pk_sheet_id = @id AND sh.fk_club_id = @clubId", new { id, clubId });
        if (s == null) return null;
        var table = (await ProjectTablesAsync(c))(s.YearId);
        if (table != null && s.ProjectId != null)
        {
            var p = await c.QueryFirstOrDefaultAsync<(string Title, int? ManHours)?>($@"
                SELECT title, man_hours FROM `{table}` WHERE pk_project_id = @ProjectId AND fk_club_id = @clubId", new { s.ProjectId, clubId });
            (s.ProjectTitle, s.ProjectManHours) = (p?.Title, p?.ManHours);
        }
        s.Slots = (await c.QueryAsync<VolunteerSlotDto>(@"
            SELECT pk_slot_id AS Id, task AS Task, starts_at AS StartsAt, ends_at AS EndsAt, capacity AS Capacity, filled AS Filled
            FROM volunteer_slots WHERE fk_sheet_id = @id ORDER BY starts_at, pk_slot_id", new { id })).ToList();
        var signups = (await c.QueryAsync<VolunteerSignupDto>(@"
            SELECT su.pk_signup_id AS Id, su.fk_slot_id AS SlotId, su.fk_member_id AS MemberId,
                   COALESCE(m.MemberName, su.name, '') AS Name, su.email AS Email, su.hours AS Hours,
                   su.reminder_sent_at AS ReminderSentAt, su.created_date AS CreatedDate
            FROM volunteer_signups su
            JOIN volunteer_slots sl ON sl.pk_slot_id = su.fk_slot_id
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = su.fk_member_id
            WHERE sl.fk_sheet_id = @id ORDER BY su.pk_signup_id", new { id })).ToList();
        foreach (var slot in s.Slots) slot.Signups = signups.Where(x => x.SlotId == slot.Id).ToList();
        s.TotalHours = signups.Sum(x => x.Hours ?? 0);
        return s;
    }

    private static SaveVolunteerSheetDto Normalize(SaveVolunteerSheetDto d)
    {
        d.Title = Clean(d.Title, 200, "The title") ?? throw new InvalidOperationException("The sheet needs a title.");
        d.Description = Clean(d.Description, 4000, "The description");
        if (d.Status is not ("open" or "closed")) throw new InvalidOperationException("The status is open or closed.");
        if ((d.YearId == null) != (d.ProjectId == null)) throw new InvalidOperationException("Pick the project's year and the project together.");
        d.Slots ??= new();
        if (d.Slots.Count is 0 or > MaxSlots) throw new InvalidOperationException($"A sheet has 1 to {MaxSlots} slots.");
        foreach (var s in d.Slots)
        {
            s.Task = Clean(s.Task, 200, "A task") ?? throw new InvalidOperationException("Every slot needs a task.");
            if (s.StartsAt == default) throw new InvalidOperationException($"\"{s.Task}\" needs a start time.");
            if (s.EndsAt is { } end && end <= s.StartsAt) throw new InvalidOperationException($"\"{s.Task}\" ends before it starts.");
            if (s.Capacity is < 1 or > MaxCapacity) throw new InvalidOperationException($"\"{s.Task}\" needs a capacity from 1 to {MaxCapacity}.");
        }
        if (d.Slots.Where(s => s.Id != null).GroupBy(s => s.Id).Any(g => g.Count() > 1)) throw new InvalidOperationException("A slot is listed twice.");
        return d;
    }

    /// <summary>The event and the project must be this club's own.</summary>
    private static async Task CheckTargetsAsync(MySqlConnection c, int clubId, SaveVolunteerSheetDto d, string? table)
    {
        if (d.EventId is int eventId && await c.ExecuteScalarAsync<int>($@"
                SELECT COUNT(*) FROM upcoming_events WHERE pk_upcoming_event_id = @eventId AND fk_club_id = @clubId AND IFNULL(isdeleted, 0) = 0",
                new { eventId, clubId }) == 0)
            throw new InvalidOperationException("Event not found.");
        if (d.ProjectId is int projectId && (table == null || await c.ExecuteScalarAsync<int>($@"
                SELECT COUNT(*) FROM `{table}` WHERE pk_project_id = @projectId AND fk_club_id = @clubId AND IFNULL(isdeleted, 0) = 0",
                new { projectId, clubId }) == 0))
            throw new InvalidOperationException("Project not found.");
    }

    /// <summary>Updates, adds and removes slots; a slot keeps at least its sign-ups' places and is only removed empty.</summary>
    private static async Task SaveSlotsAsync(MySqlConnection c, MySqlTransaction tx, int sheetId, List<SaveVolunteerSlotDto> slots)
    {
        var filled = (await c.QueryAsync<(int Id, int Filled)>(
            "SELECT pk_slot_id, filled FROM volunteer_slots WHERE fk_sheet_id = @sheetId FOR UPDATE", new { sheetId }, tx))
            .ToDictionary(x => x.Id, x => x.Filled);
        foreach (var gone in filled.Keys.Except(slots.Where(s => s.Id != null).Select(s => s.Id!.Value)))
        {
            if (filled[gone] > 0) throw new InvalidOperationException("A slot with sign-ups cannot be removed: remove its sign-ups first.");
            await c.ExecuteAsync("DELETE FROM volunteer_slots WHERE pk_slot_id = @gone", new { gone }, tx);
        }
        foreach (var s in slots)
        {
            var row = new { sheetId, s.Id, s.Task, s.StartsAt, s.EndsAt, s.Capacity };
            if (s.Id is not int id)
            {
                await c.ExecuteAsync(@"INSERT INTO volunteer_slots (fk_sheet_id, task, starts_at, ends_at, capacity)
                    VALUES (@sheetId, @Task, @StartsAt, @EndsAt, @Capacity)", row, tx);
                continue;
            }
            if (!filled.TryGetValue(id, out var taken)) throw new InvalidOperationException("Slot not found.");
            if (s.Capacity < taken) throw new InvalidOperationException($"\"{s.Task}\" already has {taken} sign-ups: its capacity cannot be lower.");
            // a slot moved to another time gets its reminders again
            await c.ExecuteAsync(@"
                UPDATE volunteer_signups su JOIN volunteer_slots sl ON sl.pk_slot_id = su.fk_slot_id
                SET su.reminder_sent_at = NULL WHERE sl.pk_slot_id = @Id AND sl.starts_at <> @StartsAt", row, tx);
            await c.ExecuteAsync(@"UPDATE volunteer_slots SET task = @Task, starts_at = @StartsAt, ends_at = @EndsAt, capacity = @Capacity
                WHERE pk_slot_id = @Id", row, tx);
        }
    }

    public async Task<int> CreateSheetAsync(int clubId, SaveVolunteerSheetDto dto, int memberId)
    {
        var d = Normalize(dto);
        await using var c = new MySqlConnection(_cs);
        await c.OpenAsync();
        await CheckTargetsAsync(c, clubId, d, (await ProjectTablesAsync(c))(d.YearId));
        await using var tx = await c.BeginTransactionAsync();
        var id = await c.ExecuteScalarAsync<int>(@"
            INSERT INTO volunteer_sheets (fk_club_id, title, description, fk_event_id, fk_year_id, fk_project_id, public_token, is_public, status, created_by)
            VALUES (@clubId, @Title, @Description, @EventId, @YearId, @ProjectId, @token, @IsPublic, @Status, @memberId);
            SELECT LAST_INSERT_ID();",
            new { clubId, d.Title, d.Description, d.EventId, d.YearId, d.ProjectId, token = RandomNumberGenerator.GetHexString(32, true), d.IsPublic, d.Status, memberId }, tx);
        await SaveSlotsAsync(c, tx, id, d.Slots);
        await tx.CommitAsync();
        return id;
    }

    public async Task<VolunteerSheetDto?> UpdateSheetAsync(int clubId, int id, SaveVolunteerSheetDto dto, int memberId)
    {
        var d = Normalize(dto);
        await using (var c = new MySqlConnection(_cs))
        {
            await c.OpenAsync();
            var tableOf = await ProjectTablesAsync(c);
            await CheckTargetsAsync(c, clubId, d, tableOf(d.YearId));
            await using var tx = await c.BeginTransactionAsync();
            var s = await LockSheetAsync(c, tx, clubId, id);
            if (s == null) return null;
            if (s.YearId != d.YearId || s.ProjectId != d.ProjectId)
            {
                // the hours already counted follow the sheet to its new project
                await MoveHoursAsync(c, tx, tableOf(s.YearId), clubId, s.ProjectId, -s.HoursApplied);
                await MoveHoursAsync(c, tx, tableOf(d.YearId), clubId, d.ProjectId, s.HoursApplied);
            }
            await c.ExecuteAsync(@"
                UPDATE volunteer_sheets SET title = @Title, description = @Description, fk_event_id = @EventId, fk_year_id = @YearId,
                    fk_project_id = @ProjectId, is_public = @IsPublic, status = @Status, modified_by = @memberId
                WHERE pk_sheet_id = @id",
                new { id, d.Title, d.Description, d.EventId, d.YearId, d.ProjectId, d.IsPublic, d.Status, memberId }, tx);
            await SaveSlotsAsync(c, tx, id, d.Slots);
            await tx.CommitAsync();
        }
        return await GetSheetAsync(clubId, id);
    }

    /// <summary>Deletes the sheet with its slots and sign-ups; its hours leave the project's total.</summary>
    public async Task<bool> DeleteSheetAsync(int clubId, int id)
    {
        await using var c = new MySqlConnection(_cs);
        await c.OpenAsync();
        var tableOf = await ProjectTablesAsync(c);
        await using var tx = await c.BeginTransactionAsync();
        var s = await LockSheetAsync(c, tx, clubId, id);
        if (s == null) return false;
        await MoveHoursAsync(c, tx, tableOf(s.YearId), clubId, s.ProjectId, -s.HoursApplied);
        await c.ExecuteAsync("DELETE FROM volunteer_sheets WHERE pk_sheet_id = @id", new { id }, tx);
        await tx.CommitAsync();
        return true;
    }

    /// <summary>Records hours per sign-up (null clears them) and rolls the sheet's new total into the project.</summary>
    public async Task<VolunteerSheetDto?> SaveHoursAsync(int clubId, int id, VolunteerHoursDto dto)
    {
        var entries = dto.Entries ?? new();
        if (entries.GroupBy(e => e.SignupId).Any(g => g.Count() > 1)) throw new InvalidOperationException("A sign-up is listed twice.");
        if (entries.Any(e => e.Hours is < 0 or > MaxHours)) throw new InvalidOperationException($"Hours are from 0 to {MaxHours}.");
        await using (var c = new MySqlConnection(_cs))
        {
            await c.OpenAsync();
            var tableOf = await ProjectTablesAsync(c);
            await using var tx = await c.BeginTransactionAsync();
            var s = await LockSheetAsync(c, tx, clubId, id);
            if (s == null) return null;
            var onSheet = (await c.QueryAsync<int>(@"
                SELECT su.pk_signup_id FROM volunteer_signups su JOIN volunteer_slots sl ON sl.pk_slot_id = su.fk_slot_id
                WHERE sl.fk_sheet_id = @id", new { id }, tx)).ToHashSet();
            if (entries.Any(e => !onSheet.Contains(e.SignupId))) throw new InvalidOperationException("Sign-up not found on this sheet.");
            foreach (var e in entries)
                await c.ExecuteAsync("UPDATE volunteer_signups SET hours = @hours WHERE pk_signup_id = @SignupId",
                    new { hours = e.Hours is { } h ? decimal.Round(h, 2) : (decimal?)null, e.SignupId }, tx);
            await RollHoursAsync(c, tx, s, tableOf(s.YearId));
            await tx.CommitAsync();
        }
        return await GetSheetAsync(clubId, id);
    }

    /// <summary>Removes a sign-up (spam, a no-show); its place frees up and its hours leave the totals.</summary>
    public async Task<VolunteerSheetDto?> RemoveSignupAsync(int clubId, int id, int signupId)
    {
        await using (var c = new MySqlConnection(_cs))
        {
            await c.OpenAsync();
            var tableOf = await ProjectTablesAsync(c);
            await using var tx = await c.BeginTransactionAsync();
            var s = await LockSheetAsync(c, tx, clubId, id);
            var slotId = s == null ? null : await c.ExecuteScalarAsync<int?>(@"
                SELECT su.fk_slot_id FROM volunteer_signups su JOIN volunteer_slots sl ON sl.pk_slot_id = su.fk_slot_id
                WHERE su.pk_signup_id = @signupId AND sl.fk_sheet_id = @id", new { signupId, id }, tx);
            if (s == null || slotId == null) return null;
            await c.ExecuteAsync("DELETE FROM volunteer_signups WHERE pk_signup_id = @signupId", new { signupId }, tx);
            await c.ExecuteAsync("UPDATE volunteer_slots SET filled = filled - 1 WHERE pk_slot_id = @slotId AND filled > 0", new { slotId }, tx);
            await RollHoursAsync(c, tx, s, tableOf(s.YearId));
            await tx.CommitAsync();
        }
        return await GetSheetAsync(clubId, id);
    }

    // ===== Sign-ups (the app and the public link) =====

    /// <summary>Takes a place: raises filled only while it is below capacity, then adds the sign-up, in one
    /// transaction (a duplicate gives the place back). Callers check first that the sheet is open; the UPDATE locks
    /// the slot row only, so it never waits on a sheet row an admin edit holds.</summary>
    private static async Task SignupAsync(MySqlConnection c, int slotId, int? memberId, string? name, string? email)
    {
        await using var tx = await c.BeginTransactionAsync();
        var taken = await c.ExecuteAsync(@"
            UPDATE volunteer_slots SET filled = filled + 1
            WHERE pk_slot_id = @slotId AND filled < capacity AND starts_at > NOW()", new { slotId }, tx);
        var already = memberId != null ? "You are already signed up for this slot." : "This email address is already signed up for this slot.";
        if (taken == 0)
            throw new InvalidOperationException(await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM volunteer_signups WHERE fk_slot_id = @slotId AND (fk_member_id = @memberId OR email = @email)",
                new { slotId, memberId, email }, tx) > 0 ? already : "This slot is full or no longer open for sign-ups.");
        try
        {
            // a non-member's consent is the checkbox on the public form (the caller checked it)
            await c.ExecuteAsync(@"
                INSERT INTO volunteer_signups (fk_slot_id, fk_member_id, name, email, consent_at)
                VALUES (@slotId, @memberId, @name, @email, IF(@memberId IS NULL, NOW(), NULL))",
                new { slotId, memberId, name, email }, tx);
        }
        catch (MySqlException ex) when (ex.ErrorCode == MySqlErrorCode.DuplicateKeyEntry)
        {
            await tx.RollbackAsync();
            throw new InvalidOperationException(already);
        }
        await tx.CommitAsync();
    }

    /// <summary>The club of an open sheet's slot, or null.</summary>
    public async Task<int?> OpenSlotClubAsync(int slotId)
    {
        await using var c = new MySqlConnection(_cs);
        return await c.ExecuteScalarAsync<int?>(@"
            SELECT sh.fk_club_id FROM volunteer_slots sl JOIN volunteer_sheets sh ON sh.pk_sheet_id = sl.fk_sheet_id
            WHERE sl.pk_slot_id = @slotId AND sh.status = 'open'", new { slotId });
    }

    public async Task<bool> IsActiveMemberAsync(int memberId, int clubId)
    {
        await using var c = new MySqlConnection(_cs);
        return await c.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM club_members cm JOIN club_master cl ON cl.pk_club_id = cm.fk_club_id
            WHERE cm.fk_member_master_profile_id = @memberId AND cm.fk_club_id = @clubId AND cm.IsActive = 1
              AND IFNULL(cm.isdeleted, 0) = 0 AND cl.IsActive = 1 AND IFNULL(cl.isdeleted, 0) = 0", new { memberId, clubId }) > 0;
    }

    public async Task MemberSignupAsync(int memberId, int slotId)
    {
        await using var c = new MySqlConnection(_cs);
        await c.OpenAsync();
        await SignupAsync(c, slotId, memberId, null, null);
    }

    /// <summary>A member takes back their own place, before the slot starts and before hours are recorded.</summary>
    public async Task<bool> MemberCancelAsync(int memberId, int slotId)
    {
        await using var c = new MySqlConnection(_cs);
        await c.OpenAsync();
        await using var tx = await c.BeginTransactionAsync();
        // the slot row first: the same lock order as a sign-up
        if (await c.ExecuteScalarAsync<long?>("SELECT starts_at > NOW() FROM volunteer_slots WHERE pk_slot_id = @slotId FOR UPDATE",
                new { slotId }, tx) != 1)
            return false;
        var removed = await c.ExecuteAsync(
            "DELETE FROM volunteer_signups WHERE fk_slot_id = @slotId AND fk_member_id = @memberId AND hours IS NULL", new { slotId, memberId }, tx);
        if (removed == 0) return false;
        await c.ExecuteAsync("UPDATE volunteer_slots SET filled = filled - 1 WHERE pk_slot_id = @slotId AND filled > 0", new { slotId }, tx);
        await tx.CommitAsync();
        return true;
    }

    private sealed class MemberSlotRow
    {
        public int SheetId { get; set; }
        public int ClubId { get; set; }
        public string ClubName { get; set; } = "";
        public string Title { get; set; } = "";
        public string? Description { get; set; }
        public int Id { get; set; }
        public string Task { get; set; } = "";
        public DateTime StartsAt { get; set; }
        public DateTime? EndsAt { get; set; }
        public int Capacity { get; set; }
        public int Filled { get; set; }
        public int? SignupId { get; set; }
    }

    /// <summary>The app: coming slots of the member's clubs' open sheets, plus the member's own slots on sheets
    /// closed to new sign-ups, marked when the member took them.</summary>
    public async Task<List<MemberVolunteerSheetDto>> ListForMemberAsync(int memberId)
    {
        await using var c = new MySqlConnection(_cs);
        var rows = await c.QueryAsync<MemberSlotRow>(@"
            SELECT sh.pk_sheet_id AS SheetId, sh.fk_club_id AS ClubId, cl.ClubName, sh.title AS Title, sh.description AS Description,
                   sl.pk_slot_id AS Id, sl.task AS Task, sl.starts_at AS StartsAt, sl.ends_at AS EndsAt,
                   sl.capacity AS Capacity, sl.filled AS Filled, su.pk_signup_id AS SignupId
            FROM club_members cm
            JOIN club_master cl ON cl.pk_club_id = cm.fk_club_id AND cl.IsActive = 1 AND IFNULL(cl.isdeleted, 0) = 0
            JOIN volunteer_sheets sh ON sh.fk_club_id = cm.fk_club_id
            JOIN volunteer_slots sl ON sl.fk_sheet_id = sh.pk_sheet_id AND sl.starts_at > NOW()
            LEFT JOIN volunteer_signups su ON su.fk_slot_id = sl.pk_slot_id AND su.fk_member_id = @memberId
            WHERE cm.fk_member_master_profile_id = @memberId AND cm.IsActive = 1 AND IFNULL(cm.isdeleted, 0) = 0
              AND (sh.status = 'open' OR su.pk_signup_id IS NOT NULL)
            ORDER BY sl.starts_at, sl.pk_slot_id LIMIT 500", new { memberId });
        return rows.GroupBy(r => r.SheetId).Select(g => new MemberVolunteerSheetDto
        {
            Id = g.Key, ClubId = g.First().ClubId, ClubName = g.First().ClubName, Title = g.First().Title, Description = g.First().Description,
            Slots = g.Select(r => new MemberVolunteerSlotDto
            {
                Id = r.Id, Task = r.Task, StartsAt = r.StartsAt, EndsAt = r.EndsAt, Capacity = r.Capacity, Filled = r.Filled, SignedUp = r.SignupId != null,
            }).ToList(),
        }).ToList();
    }

    public async Task<PublicVolunteerSheetDto?> GetPublicSheetAsync(string token)
    {
        if (!TokenShape().IsMatch(token)) return null;
        await using var c = new MySqlConnection(_cs);
        await c.OpenAsync();
        var sheet = await c.QueryFirstOrDefaultAsync<(int Id, string Title, string? Description, string ClubName, string? EventTitle)?>(@"
            SELECT sh.pk_sheet_id, sh.title, sh.description, cl.ClubName, e.Title
            FROM volunteer_sheets sh
            JOIN club_master cl ON cl.pk_club_id = sh.fk_club_id AND cl.IsActive = 1 AND IFNULL(cl.isdeleted, 0) = 0
            LEFT JOIN upcoming_events e ON e.pk_upcoming_event_id = sh.fk_event_id
            WHERE sh.public_token = @token AND sh.is_public = 1 AND sh.status = 'open'", new { token });
        if (sheet is not { } s) return null;
        return new PublicVolunteerSheetDto
        {
            Title = s.Title, Description = s.Description, ClubName = s.ClubName, EventTitle = s.EventTitle,
            FormToken = _forms.Protect($"{token}|{DateTime.UtcNow.Ticks}", FormLifetime),
            Slots = (await c.QueryAsync<PublicVolunteerSlotDto>(@"
                SELECT pk_slot_id AS Id, task AS Task, starts_at AS StartsAt, ends_at AS EndsAt, capacity - filled AS SpotsLeft
                FROM volunteer_slots WHERE fk_sheet_id = @Id AND starts_at > NOW() ORDER BY starts_at, pk_slot_id", new { s.Id })).ToList(),
        };
    }

    /// <summary>The form token proves the form was loaded from this sheet's page recently, and not a moment ago
    /// (a bot posts at once).</summary>
    private void CheckFormToken(string token, string? formToken)
    {
        const string expired = "This form has expired. Reload the page and try again.";
        string payload;
        try { payload = _forms.Unprotect(formToken ?? ""); }
        catch (Exception ex) when (ex is CryptographicException or FormatException or ArgumentException) { throw new InvalidOperationException(expired); }
        var parts = payload.Split('|');
        if (parts.Length != 2 || parts[0] != token || !long.TryParse(parts[1], out var ticks)) throw new InvalidOperationException(expired);
        if (DateTime.UtcNow - new DateTime(ticks, DateTimeKind.Utc) < MinFillTime)
            throw new InvalidOperationException("Please check your details, then send the form again.");
    }

    // shortcut: no confirmation email before the place is taken (rate limit, honeypot and form token instead); send
    // a confirm link if fake sign-ups become a problem.
    /// <summary>A non-member signs up through the public link; false when the sheet or slot is not open to them.</summary>
    public async Task<bool> PublicSignupAsync(string token, PublicVolunteerSignupDto dto)
    {
        if (!TokenShape().IsMatch(token)) return false;
        CheckFormToken(token, dto.FormToken);
        if (!dto.Consent) throw new InvalidOperationException("Please agree to the club keeping your name and email for this sign-up.");
        var name = Clean(dto.Name, 150, "Your name");
        if (name == null || name.Length < 2) throw new InvalidOperationException("Please enter your name.");
        var email = CleanEmail(dto.Email);
        await using var c = new MySqlConnection(_cs);
        await c.OpenAsync();
        if (await c.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM volunteer_slots sl JOIN volunteer_sheets sh ON sh.pk_sheet_id = sl.fk_sheet_id
                WHERE sl.pk_slot_id = @SlotId AND sh.public_token = @token AND sh.is_public = 1 AND sh.status = 'open'",
                new { dto.SlotId, token }) == 0)
            return false;
        await SignupAsync(c, dto.SlotId, null, name, email);
        return true;
    }
}
