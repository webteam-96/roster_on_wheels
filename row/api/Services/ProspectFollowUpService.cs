using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

/// <summary>
/// Follow-up tasks on prospects (assigned to a member, due date, reminder, open/done) and the club's choice of who
/// hears about a new prospect and how (gap agent, 2026-11-19; feature contacts_growth). Every notice is one
/// prospect_notifications row per recipient: the app's bell reads it (in_app), ProspectFollowUpBackgroundService
/// emails it (email_status 'pending') and writes the task reminders. Recipients are always active members of the club.
/// </summary>
public class ProspectFollowUpService
{
    public const string FeatureKey = "contacts_growth";
    public const int PresidentDesignation = 1;      // designation_master
    public const int MembershipChairDesignation = 13;

    private readonly string _cs;

    public ProspectFollowUpService(IConfiguration config) => _cs = config.GetConnectionString("DefaultConnection")!;

    private MySqlConnection Open() => new(_cs);

    // ── Pure rules (unit tested) ───────────────────────────────────────────────────────────

    public record CleanTask(string Title, string? Notes, DateTime DueDate, int? RemindDaysBefore);

    /// <summary>Validated task fields; throws ArgumentException with a message for the user.</summary>
    public static CleanTask Validate(string? title, string? notes, DateTime dueDate, int? remindDaysBefore)
    {
        var t = ContactRules.Clean(title, 200, "Title") ?? throw new ArgumentException("Give the task a title.");
        if (dueDate.Year < 2000 || dueDate.Year > 2100) throw new ArgumentException("Choose a due date.");
        if (remindDaysBefore is < 0 or > 30) throw new ArgumentException("Remind between 0 and 30 days before the due date.");
        return new CleanTask(t, ContactRules.Clean(notes, 1000, "Notes"), dueDate.Date, remindDaysBefore);
    }

    /// <summary>True when an open task's reminder should go out on the club's day <paramref name="clubToday"/>.</summary>
    public static bool ReminderDue(DateTime dueDate, int? remindDaysBefore, DateTime clubToday) =>
        remindDaysBefore is { } d && clubToday.Date >= dueDate.Date.AddDays(-d);

    /// <summary>Who hears about a new prospect: the chosen roles plus the named members, once each, never the person
    /// who added it.</summary>
    public static List<int> Recipients(ProspectNotifySettingsDto s, IEnumerable<int> presidents, IEnumerable<int> chairs, int? actor) =>
        (s.ToPresident ? presidents : Enumerable.Empty<int>())
            .Concat(s.ToMembershipChair ? chairs : Enumerable.Empty<int>())
            .Concat(s.MemberIds)
            .Where(id => id > 0 && id != actor)
            .Distinct()
            .ToList();

    // ── Tasks (club managers) ──────────────────────────────────────────────────────────────

    private const string TaskSelect = @"
        SELECT t.pk_task_id AS Id, t.fk_club_id AS ClubId, c.ClubName, t.fk_potential_member_id AS ProspectId,
               pm.name AS ProspectName, pm.email AS ProspectEmail, pm.mobile_number AS ProspectMobile, pm.stage AS ProspectStage,
               t.title AS Title, t.notes AS Notes, t.fk_assignee_member_id AS AssigneeMemberId, m.MemberName AS AssigneeName,
               DATE_FORMAT(t.due_date, '%Y-%m-%d') AS DueDate, t.remind_days_before AS RemindDaysBefore, t.status AS Status,
               t.reminder_sent_at AS ReminderSentAt, t.completed_at AS CompletedAt, t.completion_note AS CompletionNote,
               t.created_date AS CreatedDate
        FROM prospect_tasks t
        JOIN potential_members pm ON pm.pk_potential_member_id = t.fk_potential_member_id AND pm.isdeleted = 0
        JOIN club_master c ON c.pk_club_id = t.fk_club_id
        LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = t.fk_assignee_member_id";

    public async Task<List<ProspectTaskDto>> ListAsync(int clubId, string? status, int? prospectId)
    {
        using var c = Open();
        return (await c.QueryAsync<ProspectTaskDto>($@"{TaskSelect}
            WHERE t.fk_club_id = @ClubId
              AND (@Status IS NULL OR t.status = @Status) AND (@Prospect IS NULL OR t.fk_potential_member_id = @Prospect)
            ORDER BY t.status = 'done', t.due_date, t.pk_task_id LIMIT 500",
            new { ClubId = clubId, Status = status is "open" or "done" ? status : null, Prospect = prospectId })).ToList();
    }

    private static async Task<bool> IsActiveMemberAsync(MySqlConnection c, int clubId, int memberId) =>
        await c.ExecuteScalarAsync<int>(@"SELECT COUNT(*) FROM club_members
            WHERE fk_club_id = @ClubId AND fk_member_master_profile_id = @M AND IsActive = 1 AND isdeleted = 0",
            new { ClubId = clubId, M = memberId }) > 0;

    private static async Task<string?> ProspectNameAsync(MySqlConnection c, int clubId, int prospectId) =>
        await c.ExecuteScalarAsync<string?>(@"SELECT name FROM potential_members
            WHERE pk_potential_member_id = @Id AND fk_club_id = @ClubId AND isdeleted = 0", new { Id = prospectId, ClubId = clubId });

    /// <summary>New task; the assignee gets an "assigned" notice. Throws ArgumentException / KeyNotFoundException.</summary>
    public async Task<int> CreateAsync(int clubId, SaveProspectTaskDto dto, int by)
    {
        var v = Validate(dto.Title, dto.Notes, dto.DueDate, dto.RemindDaysBefore);
        await using var c = Open();
        await c.OpenAsync();
        var prospect = await ProspectNameAsync(c, clubId, dto.ProspectId) ?? throw new KeyNotFoundException("Prospect not found.");
        if (!await IsActiveMemberAsync(c, clubId, dto.AssigneeMemberId))
            throw new ArgumentException("Assign the task to an active member of this club.");
        var id = await c.ExecuteScalarAsync<int>(@"
            INSERT INTO prospect_tasks (fk_club_id, fk_potential_member_id, title, notes, fk_assignee_member_id, due_date,
                                        remind_days_before, created_by, created_date)
            VALUES (@ClubId, @Prospect, @Title, @Notes, @Assignee, @Due, @Remind, @By, UTC_TIMESTAMP());
            SELECT LAST_INSERT_ID();",
            new { ClubId = clubId, Prospect = dto.ProspectId, v.Title, v.Notes, Assignee = dto.AssigneeMemberId, Due = v.DueDate,
                  Remind = v.RemindDaysBefore, By = by });
        if (dto.AssigneeMemberId != by) await AssignedNoticeAsync(c, clubId, dto.ProspectId, id, dto.AssigneeMemberId, prospect, v);
        return id;
    }

    /// <summary>Edit a task. A new assignee gets an "assigned" notice; a new assignee or due date re-arms the reminder.</summary>
    public async Task<bool> UpdateAsync(int clubId, int id, SaveProspectTaskDto dto, int by)
    {
        var v = Validate(dto.Title, dto.Notes, dto.DueDate, dto.RemindDaysBefore);
        if (dto.Status is not (null or "open" or "done")) throw new ArgumentException("Status must be open or done.");
        await using var c = Open();
        await c.OpenAsync();
        var cur = await c.QueryFirstOrDefaultAsync<(int Prospect, int Assignee, DateTime Due, string Status)>(@"
            SELECT t.fk_potential_member_id, t.fk_assignee_member_id, t.due_date, t.status FROM prospect_tasks t
            JOIN potential_members pm ON pm.pk_potential_member_id = t.fk_potential_member_id AND pm.isdeleted = 0
            WHERE t.pk_task_id = @Id AND t.fk_club_id = @ClubId", new { Id = id, ClubId = clubId });
        if (cur.Prospect == 0) return false;
        var reassigned = cur.Assignee != dto.AssigneeMemberId;
        if (reassigned && !await IsActiveMemberAsync(c, clubId, dto.AssigneeMemberId))
            throw new ArgumentException("Assign the task to an active member of this club.");
        var status = dto.Status ?? cur.Status;
        await c.ExecuteAsync(@"
            UPDATE prospect_tasks SET title = @Title, notes = @Notes, fk_assignee_member_id = @Assignee, due_date = @Due,
                   remind_days_before = @Remind,
                   reminder_sent_at = IF(@Rearm, NULL, reminder_sent_at),
                   status = @Status,
                   completed_at = IF(@Status = 'done', COALESCE(completed_at, UTC_TIMESTAMP()), NULL),
                   completed_by = IF(@Status = 'done', COALESCE(completed_by, @By), NULL),
                   modified_by = @By, modified_date = UTC_TIMESTAMP()
            WHERE pk_task_id = @Id AND fk_club_id = @ClubId",
            new { v.Title, v.Notes, Assignee = dto.AssigneeMemberId, Due = v.DueDate, Remind = v.RemindDaysBefore,
                  Rearm = reassigned || cur.Due.Date != v.DueDate, Status = status, By = by, Id = id, ClubId = clubId });
        if (reassigned && status == "open" && dto.AssigneeMemberId != by)
            await AssignedNoticeAsync(c, clubId, cur.Prospect, id, dto.AssigneeMemberId,
                await ProspectNameAsync(c, clubId, cur.Prospect) ?? "", v);
        return true;
    }

    public async Task<bool> DeleteAsync(int clubId, int id)
    {
        using var c = Open();
        return await c.ExecuteAsync("DELETE FROM prospect_tasks WHERE pk_task_id = @Id AND fk_club_id = @ClubId",
            new { Id = id, ClubId = clubId }) > 0;
    }

    // ── The assigned member (app) ──────────────────────────────────────────────────────────

    /// <summary>Tasks assigned to the member in clubs they are still an active member of.</summary>
    public async Task<List<ProspectTaskDto>> ForMemberAsync(int memberId, string? status)
    {
        using var c = Open();
        return (await c.QueryAsync<ProspectTaskDto>($@"{TaskSelect}
            JOIN club_members cm ON cm.fk_club_id = t.fk_club_id AND cm.fk_member_master_profile_id = t.fk_assignee_member_id
                                AND cm.IsActive = 1 AND cm.isdeleted = 0
            WHERE t.fk_assignee_member_id = @M AND (@Status IS NULL OR t.status = @Status)
            ORDER BY t.status = 'done', t.due_date, t.pk_task_id LIMIT 200",
            new { M = memberId, Status = status is "open" or "done" ? status : null })).ToList();
    }

    /// <summary>The assignee marks the task done. False when it is not theirs (or they left the club).</summary>
    public async Task<bool> CompleteAsync(int memberId, int id, string? note)
    {
        var n = ContactRules.Clean(note, 500, "Note");
        using var c = Open();
        return await c.ExecuteAsync(@"
            UPDATE prospect_tasks t
            JOIN potential_members pm ON pm.pk_potential_member_id = t.fk_potential_member_id AND pm.isdeleted = 0
            JOIN club_members cm ON cm.fk_club_id = t.fk_club_id AND cm.fk_member_master_profile_id = t.fk_assignee_member_id
                                AND cm.IsActive = 1 AND cm.isdeleted = 0
            SET t.status = 'done', t.completed_at = UTC_TIMESTAMP(), t.completed_by = @M, t.completion_note = @Note,
                t.modified_by = @M, t.modified_date = UTC_TIMESTAMP()
            WHERE t.pk_task_id = @Id AND t.fk_assignee_member_id = @M AND t.status = 'open'",
            new { M = memberId, Id = id, Note = n }) > 0;
    }

    // ── Settings ───────────────────────────────────────────────────────────────────────────

    internal static async Task<ProspectNotifySettingsDto> SettingsAsync(MySqlConnection c, int clubId)
    {
        var s = await c.QueryFirstOrDefaultAsync<ProspectNotifySettingsDto>(@"
            SELECT to_president AS ToPresident, to_membership_chair AS ToMembershipChair, by_in_app AS InApp, by_email AS Email
            FROM prospect_notify_settings WHERE fk_club_id = @ClubId", new { ClubId = clubId }) ?? new ProspectNotifySettingsDto();
        s.MemberIds = (await c.QueryAsync<int>(@"
            SELECT n.fk_member_id FROM prospect_notify_members n
            JOIN club_members cm ON cm.fk_club_id = n.fk_club_id AND cm.fk_member_master_profile_id = n.fk_member_id
                                AND cm.IsActive = 1 AND cm.isdeleted = 0
            WHERE n.fk_club_id = @ClubId", new { ClubId = clubId })).ToList();
        return s;
    }

    /// <summary>Active club members holding a designation on this year's board.</summary>
    private static async Task<List<(int Id, string Name)>> OfficersAsync(MySqlConnection c, int clubId, int designation) =>
        (await c.QueryAsync<(int, string)>(@"
            SELECT DISTINCT m.pk_member_master_profile_id, m.MemberName
            FROM board_of_directors b
            JOIN rotary_year_master y ON y.pk_year_id = b.fk_year_id AND y.IsCurrent = 1
            JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id AND m.isdeleted = 0
            JOIN club_members cm ON cm.fk_club_id = b.fk_club_id AND cm.fk_member_master_profile_id = m.pk_member_master_profile_id
                                AND cm.IsActive = 1 AND cm.isdeleted = 0
            WHERE b.fk_club_id = @ClubId AND b.fk_designation_id = @D AND b.isdeleted = 0",
            new { ClubId = clubId, D = designation })).ToList();

    public async Task<ProspectNotifySettingsDto> GetSettingsAsync(int clubId)
    {
        await using var c = Open();
        await c.OpenAsync();
        var s = await SettingsAsync(c, clubId);
        s.Presidents = (await OfficersAsync(c, clubId, PresidentDesignation)).Select(o => o.Name).ToList();
        s.MembershipChairs = (await OfficersAsync(c, clubId, MembershipChairDesignation)).Select(o => o.Name).ToList();
        return s;
    }

    public async Task SaveSettingsAsync(int clubId, ProspectNotifySettingsDto dto, int by)
    {
        var ids = dto.MemberIds.Where(i => i > 0).Distinct().ToList();
        if (ids.Count > 50) throw new ArgumentException("Choose at most 50 members.");
        await using var c = Open();
        await c.OpenAsync();
        if (ids.Count > 0 && await c.ExecuteScalarAsync<int>(@"SELECT COUNT(DISTINCT fk_member_master_profile_id) FROM club_members
                WHERE fk_club_id = @ClubId AND fk_member_master_profile_id IN @Ids AND IsActive = 1 AND isdeleted = 0",
                new { ClubId = clubId, Ids = ids }) != ids.Count)
            throw new ArgumentException("Every chosen member must be an active member of this club.");
        await using var tx = await c.BeginTransactionAsync();
        await c.ExecuteAsync(@"
            INSERT INTO prospect_notify_settings (fk_club_id, to_president, to_membership_chair, by_in_app, by_email, modified_by, modified_date)
            VALUES (@ClubId, @P, @C, @I, @E, @By, UTC_TIMESTAMP())
            ON DUPLICATE KEY UPDATE to_president = @P, to_membership_chair = @C, by_in_app = @I, by_email = @E,
                                    modified_by = @By, modified_date = UTC_TIMESTAMP()",
            new { ClubId = clubId, P = dto.ToPresident, C = dto.ToMembershipChair, I = dto.InApp, E = dto.Email, By = by }, tx);
        await c.ExecuteAsync("DELETE FROM prospect_notify_members WHERE fk_club_id = @ClubId", new { ClubId = clubId }, tx);
        if (ids.Count > 0)
            await c.ExecuteAsync("INSERT INTO prospect_notify_members (fk_club_id, fk_member_id) VALUES (@ClubId, @M)",
                ids.Select(m => new { ClubId = clubId, M = m }), tx);
        await tx.CommitAsync();
    }

    // ── Notices ────────────────────────────────────────────────────────────────────────────

    /// <summary>Writes one notice per recipient, on the club's chosen channels. Nothing when both channels are off.</summary>
    internal static async Task NotifyAsync(MySqlConnection c, int clubId, int prospectId, int? taskId, string kind,
        string title, string? body, IEnumerable<int> members, bool inApp, bool email)
    {
        if (!inApp && !email) return;
        await c.ExecuteAsync(@"
            INSERT INTO prospect_notifications (fk_member_id, fk_club_id, fk_potential_member_id, fk_task_id, kind, title, body,
                                                in_app, email_status, created_date)
            VALUES (@M, @ClubId, @Prospect, @Task, @Kind, @Title, @Body, @InApp, @EmailStatus, UTC_TIMESTAMP())",
            members.Select(m => new { M = m, ClubId = clubId, Prospect = prospectId, Task = taskId, Kind = kind,
                Title = Cut(title, 250), Body = body == null ? null : Cut(body, 600), InApp = inApp, EmailStatus = email ? "pending" : "none" }));
    }

    private static string Cut(string s, int max) => s.Length <= max ? s : s[..max];

    private static async Task AssignedNoticeAsync(MySqlConnection c, int clubId, int prospectId, int taskId, int assignee,
        string prospect, CleanTask v)
    {
        if (!await FeatureGate.IsOnAsync(FeatureKey, c.ConnectionString)) return;
        var s = await SettingsAsync(c, clubId);
        await NotifyAsync(c, clubId, prospectId, taskId, "task_assigned", $"Follow-up task: {v.Title}",
            $"Prospect {prospect}. Due {v.DueDate:d MMM yyyy}.", new[] { assignee }, s.InApp, s.Email);
    }

    /// <summary>Tells the club's chosen people about a new prospect (manual add, join form or guest invite).
    /// Never throws: a failed notice must not fail the add.</summary>
    public static async Task NewProspectAsync(string connectionString, int clubId, int prospectId, string name, string source,
        int? actor, ILogger? log = null)
    {
        try
        {
            if (!await FeatureGate.IsOnAsync(FeatureKey, connectionString)) return;
            await using var c = new MySqlConnection(connectionString);
            await c.OpenAsync();
            var s = await SettingsAsync(c, clubId);
            var to = Recipients(s,
                (await OfficersAsync(c, clubId, PresidentDesignation)).Select(o => o.Id),
                (await OfficersAsync(c, clubId, MembershipChairDesignation)).Select(o => o.Id), actor);
            if (to.Count == 0) return;
            var how = source switch { "website" => "the club website", "district_site" => "the district website", "invite" => "a member's guest invite", _ => "a club officer" };
            await NotifyAsync(c, clubId, prospectId, null, "new_prospect", $"New prospect: {name}",
                $"Added through {how}. Open Potential Members to follow up.", to, s.InApp, s.Email);
        }
        catch (Exception ex)
        {
            log?.LogError(ex, "New prospect notice failed for club {ClubId}", clubId);
        }
    }
}
