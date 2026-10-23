using System.Net;
using System.Security.Cryptography;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

/// <summary>
/// "Bring a guest" prompts (N3, spec B.4 #33). A club admin schedules a prompt for a meeting; on its send date
/// (InvitePromptBackgroundService, or "send now") every active member gets an email and an in-app feed item
/// (MobileNotificationFeedService reads invite_prompt_log) with their personal invite link. The guest's RSVP page
/// (PublicJoinController) turns the reply into a contact or a prospect of the club.
/// </summary>
public class InvitePromptService
{
    private readonly string _connectionString;
    private readonly IConfiguration _config;
    private readonly IEmailService _email;
    private readonly ILogger<InvitePromptService> _logger;

    public InvitePromptService(IConfiguration configuration, IEmailService email, ILogger<InvitePromptService> logger)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _config = configuration;
        _email = email;
        _logger = logger;
    }

    private MySqlConnection Open() => new(_connectionString);

    // Dates are the club's local dates (its district's time zone, N12).
    public async Task<List<InvitePromptDto>> ListAsync(int clubId)
    {
        await using var conn = Open();
        var today = ZoneTime.Local(await ZoneTime.OfClubAsync(conn, clubId)).Date;
        return (await conn.QueryAsync<InvitePromptDto>(@"
            SELECT pk_invite_prompt_id AS Id, meeting_date AS MeetingDate, send_on AS SendOn, note AS Note, status AS Status,
                   sent_count AS SentCount, sent_date AS SentDate
            FROM invite_prompts WHERE fk_club_id = @C AND (meeting_date >= @Today - INTERVAL 60 DAY)
            ORDER BY meeting_date DESC, pk_invite_prompt_id DESC LIMIT 50", new { C = clubId, Today = today })).ToList();
    }

    public async Task<int> CreateAsync(int clubId, CreateInvitePromptDto dto, int by)
    {
        if (dto.DaysBefore is < 0 or > 14) throw new ArgumentException("Send the prompt 0 to 14 days before the meeting.");
        var meeting = dto.MeetingDate.Date;
        await using var conn = Open();
        var today = ZoneTime.Local(await ZoneTime.OfClubAsync(conn, clubId)).Date;
        if (meeting < today) throw new ArgumentException("The meeting date has passed.");
        if (meeting > today.AddYears(1)) throw new ArgumentException("Pick a meeting within the next year.");
        var sendOn = meeting.AddDays(-dto.DaysBefore) < today ? today : meeting.AddDays(-dto.DaysBefore);
        return await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO invite_prompts (fk_club_id, meeting_date, send_on, note, created_by) VALUES (@C, @M, @S, @N, @By);
            SELECT LAST_INSERT_ID();",
            new { C = clubId, M = meeting, S = sendOn, N = ContactRules.Clean(dto.Note, 500, "Note"), By = by });
    }

    public async Task<bool> CancelAsync(int clubId, int id)
    {
        await using var conn = Open();
        return await conn.ExecuteAsync(
            "UPDATE invite_prompts SET status = 'cancelled' WHERE pk_invite_prompt_id = @Id AND fk_club_id = @C AND status = 'scheduled'",
            new { Id = id, C = clubId }) > 0;
    }

    /// <summary>Marks a scheduled prompt as sending. Only one caller wins, so two runs never send twice.</summary>
    // shortcut: a run that dies mid-send leaves the prompt at 'sending'; setting it back to 'scheduled' resends to the
    // members not yet logged. Add a claimed-at time and an automatic retry if this happens in practice.
    public async Task<bool> ClaimAsync(int clubId, int id)
    {
        await using var conn = Open();
        return await conn.ExecuteAsync(
            "UPDATE invite_prompts SET status = 'sending' WHERE pk_invite_prompt_id = @Id AND fk_club_id = @C AND status = 'scheduled'",
            new { Id = id, C = clubId }) > 0;
    }

    /// <summary>Background job: claims and sends every prompt whose send date has come in its club's time zone.</summary>
    public async Task SendDueAsync(CancellationToken ct)
    {
        var due = new List<(int Id, int ClubId)>();
        await using (var conn = Open())
            foreach (var (tz, zone) in await ZoneTime.ZonesAsync(conn))
                due.AddRange(await conn.QueryAsync<(int, int)>($@"
                    SELECT ip.pk_invite_prompt_id, ip.fk_club_id FROM invite_prompts ip
                    JOIN club_master c ON c.pk_club_id = ip.fk_club_id
                    LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
                    WHERE ip.status = 'scheduled' AND ip.send_on <= @Today AND ip.meeting_date >= @Today AND {ZoneTime.Filter("d")}",
                    new { Today = ZoneTime.Local(zone).Date, Tz = tz }));
        foreach (var (id, clubId) in due)
        {
            if (ct.IsCancellationRequested) return;
            if (await ClaimAsync(clubId, id)) await DeliverAsync(id);
        }
    }

    /// <summary>Sends a claimed prompt: one log row (in-app feed) and one email per active member, then marks it sent.</summary>
    public async Task DeliverAsync(int promptId)
    {
        await using var conn = Open();
        await conn.OpenAsync();
        var p = await conn.QueryFirstAsync<(int ClubId, DateTime MeetingDate, string? Note, string ClubName, TimeSpan? From, string? Address)>(@"
            SELECT ip.fk_club_id, ip.meeting_date, ip.note, c.ClubName, c.MeetingFromTime, c.MeetingAddress
            FROM invite_prompts ip JOIN club_master c ON c.pk_club_id = ip.fk_club_id
            WHERE ip.pk_invite_prompt_id = @Id", new { Id = promptId });
        var members = (await conn.QueryAsync<(int Id, string Name, string? Email)>(@"
            SELECT DISTINCT m.pk_member_master_profile_id, m.MemberName, m.EmailId
            FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
            WHERE cm.fk_club_id = @C AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0", new { C = p.ClubId })).ToList();

        string H(string? s) => WebUtility.HtmlEncode(s ?? "");
        var when = p.MeetingDate.ToString("dddd d MMMM yyyy") + (p.From is { } f ? $" at {f:hh\\:mm}" : "");
        var subject = $"Bring a guest to {p.ClubName} on {p.MeetingDate:d MMMM}";
        var sent = 0;
        foreach (var m in members)
        {
            // INSERT IGNORE: a member already prompted for this meeting (a retried run) is skipped.
            if (await conn.ExecuteAsync(
                    "INSERT IGNORE INTO invite_prompt_log (fk_invite_prompt_id, fk_club_id, fk_member_id) VALUES (@P, @C, @M)",
                    new { P = promptId, C = p.ClubId, M = m.Id }) == 0) continue;
            sent++;
            if (string.IsNullOrWhiteSpace(m.Email)) continue;
            var url = await LinkAsync(conn, p.ClubId, m.Id);
            var body = $"<p>Dear {H(m.Name)},</p>"
                     + $"<p>{H(p.ClubName)} meets on {H(when)}{(string.IsNullOrWhiteSpace(p.Address) ? "" : " at " + H(p.Address))}. "
                     + "Who would you like to bring as a guest?</p>"
                     + (string.IsNullOrWhiteSpace(p.Note) ? "" : $"<p>{H(p.Note)}</p>")
                     + $"<p>Send them your personal invite link: <a href=\"{H(url)}\">{H(url)}</a></p>"
                     + "<p>Your guest can reply on that page and the club will welcome them.</p>";
            try { await _email.SendScopedEmailAsync(m.Email, subject, body, p.ClubId, null); }
            catch (Exception ex) { _logger.LogWarning(ex, "Invite prompt {PromptId}: email to member {MemberId} failed", promptId, m.Id); }
        }
        await conn.ExecuteAsync("UPDATE invite_prompts SET status = 'sent', sent_count = sent_count + @N, sent_date = NOW() WHERE pk_invite_prompt_id = @Id",
            new { N = sent, Id = promptId });
    }

    private string Origin()
    {
        var f = _config["FrontendUrl"];
        return (!string.IsNullOrWhiteSpace(f) ? f : !string.IsNullOrWhiteSpace(Brand.PortalOrigin) ? Brand.PortalOrigin : "http://localhost:3000").TrimEnd('/');
    }

    /// <summary>The member's personal invite link for this club, created on first use.</summary>
    public async Task<string> LinkAsync(int clubId, int memberId)
    {
        await using var conn = Open();
        return await LinkAsync(conn, clubId, memberId);
    }

    private async Task<string> LinkAsync(MySqlConnection conn, int clubId, int memberId)
    {
        // 128 random bits: the link cannot be guessed. INSERT IGNORE + re-read keeps one token per member and club.
        await conn.ExecuteAsync("INSERT IGNORE INTO member_invite_links (fk_club_id, fk_member_id, token) VALUES (@C, @M, @T)",
            new { C = clubId, M = memberId, T = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant() });
        var token = await conn.ExecuteScalarAsync<string>("SELECT token FROM member_invite_links WHERE fk_club_id = @C AND fk_member_id = @M",
            new { C = clubId, M = memberId });
        return $"{Origin()}/invite/{token}";
    }

    public async Task<bool> IsActiveMemberAsync(int clubId, int memberId)
    {
        await using var conn = Open();
        return await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM club_members WHERE fk_club_id = @C AND fk_member_master_profile_id = @M AND IsActive = 1 AND isdeleted = 0",
            new { C = clubId, M = memberId }) > 0;
    }

    /// <summary>The invite behind a token: club, inviter and the club's next prompted meeting (if any).</summary>
    public async Task<(int ClubId, int MemberId, PublicInviteDto Dto)?> ResolveAsync(string token)
    {
        if (token.Length != 32 || !token.All(Uri.IsHexDigit)) return null;
        await using var conn = Open();
        var row = await conn.QueryFirstOrDefaultAsync<InviteRow>(@"
            SELECT l.fk_club_id AS ClubId, l.fk_member_id AS MemberId, c.ClubName, m.MemberName AS InviterName, c.MeetingDay,
                   TIME_FORMAT(c.MeetingFromTime, '%H:%i') AS MeetingFromTime, TIME_FORMAT(c.MeetingToTime, '%H:%i') AS MeetingToTime,
                   c.MeetingAddress
            FROM member_invite_links l
            JOIN club_master c ON c.pk_club_id = l.fk_club_id AND c.isdeleted = 0 AND c.IsActive = 1
            JOIN member_master_profile m ON m.pk_member_master_profile_id = l.fk_member_id AND m.isdeleted = 0
            JOIN club_members cm ON cm.fk_club_id = l.fk_club_id AND cm.fk_member_master_profile_id = l.fk_member_id
                 AND cm.IsActive = 1 AND cm.isdeleted = 0
            WHERE l.token = @T LIMIT 1", new { T = token.ToLowerInvariant() });
        if (row == null) return null;
        // The club's next prompted meeting, from its local date.
        row.MeetingDate = await conn.ExecuteScalarAsync<DateTime?>(
            "SELECT MIN(meeting_date) FROM invite_prompts WHERE fk_club_id = @C AND meeting_date >= @Today AND status <> 'cancelled'",
            new { C = row.ClubId, Today = ZoneTime.Local(await ZoneTime.OfClubAsync(conn, row.ClubId)).Date });
        return (row.ClubId, row.MemberId, new PublicInviteDto
        {
            ClubName = row.ClubName, InviterName = row.InviterName, MeetingDate = row.MeetingDate, MeetingDay = row.MeetingDay,
            MeetingFromTime = row.MeetingFromTime, MeetingToTime = row.MeetingToTime, MeetingAddress = row.MeetingAddress,
        });
    }

    private sealed class InviteRow
    {
        public int ClubId { get; set; }
        public int MemberId { get; set; }
        public string ClubName { get; set; } = "";
        public string InviterName { get; set; } = "";
        public string? MeetingDay { get; set; }
        public string? MeetingFromTime { get; set; }
        public string? MeetingToTime { get; set; }
        public string? MeetingAddress { get; set; }
        public DateTime? MeetingDate { get; set; }
    }
}

/// <summary>Sends invite prompts on their send date. Hourly; off while the contacts_growth feature is off.</summary>
public class InvitePromptBackgroundService : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<InvitePromptBackgroundService> _logger;
    private readonly string _connectionString;

    public InvitePromptBackgroundService(IServiceScopeFactory scopes, ILogger<InvitePromptBackgroundService> logger, IConfiguration configuration)
    {
        _scopes = scopes;
        _logger = logger;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Delay(TimeSpan.FromMinutes(3), stoppingToken);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (await FeatureGate.IsOnAsync("contacts_growth", _connectionString))
                {
                    using var scope = _scopes.CreateScope();
                    await scope.ServiceProvider.GetRequiredService<InvitePromptService>().SendDueAsync(stoppingToken);
                }
            }
            catch (Exception ex) { _logger.LogError(ex, "Invite prompt run failed."); }
            await Task.Delay(TimeSpan.FromHours(1), stoppingToken);
        }
    }
}
