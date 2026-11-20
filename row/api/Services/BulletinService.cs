using System.Net;
using System.Text;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

/// <summary>
/// Club email bulletin (gap #6): a manager picks announcements, adds an intro and the president's message; upcoming
/// events and the next meeting's speakers and duties are filled in from the club's own records. Sending creates (or
/// reuses) one club mass email and sends it through <see cref="IClubMassEmailService"/>, so tracking, unsubscribe and
/// credits/allowance work exactly as for any mass email. The HTML sent is kept as the archive copy.
/// </summary>
public class BulletinService
{
    public static readonly string[] Layouts = { "classic", "compact", "spotlight" };

    private readonly string _cs;
    private readonly IClubMassEmailService _massEmails;
    private readonly ICreditManagementService _credits;
    private readonly CommsService _comms;
    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<BulletinService> _logger;

    public BulletinService(IConfiguration config, IClubMassEmailService massEmails, ICreditManagementService credits, CommsService comms,
        IServiceScopeFactory scopes, ILogger<BulletinService> logger)
    {
        _cs = config.GetConnectionString("DefaultConnection")!;
        _massEmails = massEmails;
        _credits = credits;
        _comms = comms;
        _scopes = scopes;
        _logger = logger;
    }

    private MySqlConnection Conn() => new(_cs);

    /// <summary>Error text for a bad draft, null when it is fine. Announcement ids are checked against the club later.</summary>
    public static string? Validate(BulletinDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.Title)) return "A heading is required.";
        if (dto.Title.Trim().Length > 200) return "The heading can be at most 200 characters.";
        if ((dto.Intro?.Length ?? 0) > 5000 || (dto.PresidentMessage?.Length ?? 0) > 5000) return "The intro and the president's message can be at most 5000 characters each.";
        if (!Layouts.Contains(dto.Layout)) return "Unknown layout.";
        if ((dto.AnnouncementIds?.Count ?? 0) > 20) return "Pick at most 20 news items.";
        if ((dto.EventIds?.Count ?? 0) > 20) return "Pick at most 20 events.";
        if ((dto.StoryIds?.Count ?? 0) > 20) return "Pick at most 20 stories.";
        return null;
    }

    private const string Columns = @"pk_bulletin_id AS Id, fk_club_id AS ClubId, title AS Title, intro AS Intro,
        president_message AS PresidentMessage, layout AS Layout, announcement_ids AS AnnouncementIdsCsv,
        event_ids AS EventIdsCsv, story_ids AS StoryIdsCsv, include_birthdays AS IncludeBirthdays, include_speakers AS IncludeSpeakers, status AS Status,
        fk_mass_email_id AS MassEmailId, sent_date AS SentDate, created_date AS CreatedDate";

    public async Task<List<BulletinListItemDto>> ListAsync(int clubId, bool sentOnly)
    {
        await using var c = Conn();
        return (await c.QueryAsync<BulletinListItemDto>(@"
            SELECT b.pk_bulletin_id AS Id, b.title AS Title, b.layout AS Layout, b.status AS Status, b.sent_date AS SentDate,
                   b.created_date AS CreatedDate, b.fk_mass_email_id AS MassEmailId, me.TotalRecipients,
                   (SELECT COUNT(*) FROM club_bulletin_deliveries d WHERE d.fk_bulletin_id = b.pk_bulletin_id AND d.status = 'Sent') AS SubscriberCount
            FROM club_bulletins b
            LEFT JOIN club_mass_emails me ON me.pk_mass_email_id = b.fk_mass_email_id AND b.status = 'Sent'
            WHERE b.fk_club_id = @clubId AND b.isdeleted = 0 AND (@sentOnly = 0 OR b.status = 'Sent')
            ORDER BY COALESCE(b.sent_date, b.created_date) DESC LIMIT 200", new { clubId, sentOnly })).ToList();
    }

    public async Task<BulletinDetailDto?> GetAsync(int clubId, int id, bool sentOnly)
    {
        await using var c = Conn();
        await c.OpenAsync();
        var b = await c.QueryFirstOrDefaultAsync<BulletinDetailDto>($@"
            SELECT {Columns}, sent_html AS Html FROM club_bulletins
            WHERE pk_bulletin_id = @id AND fk_club_id = @clubId AND isdeleted = 0 AND (@sentOnly = 0 OR status = 'Sent')",
            new { id, clubId, sentOnly });
        if (b != null && b.Status != "Sent") b.Html = await ComposeAsync(c, clubId, b);
        return b;
    }

    public async Task<int> CreateAsync(int clubId, BulletinDto dto, int by)
    {
        await using var c = Conn();
        return await c.ExecuteScalarAsync<int>(@"
            INSERT INTO club_bulletins (fk_club_id, title, intro, president_message, layout, announcement_ids, event_ids, story_ids,
                include_birthdays, include_speakers, created_by, created_date)
            VALUES (@clubId, @Title, @Intro, @PresidentMessage, @Layout, @Csv, @EventCsv, @StoryCsv, @IncludeBirthdays, @IncludeSpeakers, @by, UTC_TIMESTAMP());
            SELECT LAST_INSERT_ID();", Params(clubId, dto, by));
    }

    /// <summary>False when there is no such draft in this club (sent bulletins are archived and do not change).</summary>
    public async Task<bool> UpdateAsync(int clubId, int id, BulletinDto dto, int by)
    {
        await using var c = Conn();
        return await c.ExecuteAsync(@"
            UPDATE club_bulletins SET title = @Title, intro = @Intro, president_message = @PresidentMessage, layout = @Layout,
                announcement_ids = @Csv, event_ids = @EventCsv, story_ids = @StoryCsv, include_birthdays = @IncludeBirthdays, include_speakers = @IncludeSpeakers,
                modified_by = @by, modified_date = UTC_TIMESTAMP()
            WHERE pk_bulletin_id = @id AND fk_club_id = @clubId AND status = 'Draft' AND isdeleted = 0",
            new { id, clubId, by, Title = dto.Title.Trim(), dto.Intro, dto.PresidentMessage, dto.Layout, Csv = Csv(dto.AnnouncementIds),
                  EventCsv = Csv(dto.EventIds), StoryCsv = Csv(dto.StoryIds), dto.IncludeBirthdays, dto.IncludeSpeakers }) > 0;
    }

    public async Task<bool> DeleteAsync(int clubId, int id, int by)
    {
        await using var c = Conn();
        return await c.ExecuteAsync(@"
            UPDATE club_bulletins SET isdeleted = 1, modified_by = @by, modified_date = UTC_TIMESTAMP()
            WHERE pk_bulletin_id = @id AND fk_club_id = @clubId AND status = 'Draft' AND isdeleted = 0", new { id, clubId, by }) > 0;
    }

    public async Task<string> PreviewAsync(int clubId, BulletinDto dto)
    {
        await using var c = Conn();
        await c.OpenAsync();
        return await ComposeAsync(c, clubId, new BulletinDetailDto
        {
            Title = dto.Title.Trim(), Intro = dto.Intro, PresidentMessage = dto.PresidentMessage, Layout = dto.Layout,
            AnnouncementIdsCsv = Csv(dto.AnnouncementIds), EventIdsCsv = Csv(dto.EventIds), StoryIdsCsv = Csv(dto.StoryIds), IncludeBirthdays = dto.IncludeBirthdays,
            IncludeSpeakers = dto.IncludeSpeakers,
        });
    }

    /// <summary>Items a manager can pick: the club's current news (announcements, not expired, newest first) and its
    /// upcoming events (soonest first).</summary>
    public async Task<BulletinOptionsDto> OptionsAsync(int clubId)
    {
        await using var c = Conn();
        await c.OpenAsync();
        return new BulletinOptionsDto
        {
            Announcements = (await c.QueryAsync<BulletinOption>(@"
                SELECT pk_announcement_id AS Id, Title, PublishDateTime AS Date FROM announcements
                WHERE fk_club_id = @clubId AND isdeleted = 0 AND IFNULL(IsActive, 1) = 1
                  AND (ExpiryDateTime IS NULL OR ExpiryDateTime >= UTC_TIMESTAMP())
                ORDER BY PublishDateTime DESC LIMIT 50", new { clubId })).ToList(),
            Events = (await c.QueryAsync<BulletinOption>(@"
                SELECT pk_upcoming_event_id AS Id, Title, EventDate AS Date FROM upcoming_events
                WHERE fk_club_id = @clubId AND isdeleted = 0 AND IFNULL(IsActive, 1) = 1 AND EventDate >= UTC_DATE()
                ORDER BY EventDate LIMIT 50", new { clubId })).ToList(),
            // Only stories an editor approved (StoryService).
            Stories = (await c.QueryAsync<BulletinOption>(@"
                SELECT pk_story_id AS Id, title AS Title, reviewed_date AS Date FROM club_stories
                WHERE fk_club_id = @clubId AND status = 'Approved' AND isdeleted = 0
                ORDER BY reviewed_date DESC LIMIT 50", new { clubId })).ToList(),
            ConfirmedSubscribers = (await BulletinSubscriberService.ConfirmedAsync(c, clubId)).Count,
        };
    }

    /// <summary>Sends a draft as a club mass email to all members (recipientType 1) or sub groups (2). A failed
    /// send leaves the bulletin a draft with its mass email kept, so trying again reuses that email.</summary>
    public async Task<BulletinSendResult> SendAsync(int clubId, int id, BulletinSendDto dto, int by)
    {
        if (dto.RecipientType is not (1 or 2)) throw new ArgumentException("Send to all members or to sub groups.");
        if (dto.RecipientType == 2 && dto.SubgroupIds is not { Count: > 0 }) throw new ArgumentException("Pick at least one sub group.");

        await using var c = Conn();
        await c.OpenAsync();
        var b = await c.QueryFirstOrDefaultAsync<BulletinDetailDto>($@"
            SELECT {Columns} FROM club_bulletins WHERE pk_bulletin_id = @id AND fk_club_id = @clubId AND isdeleted = 0",
            new { id, clubId }) ?? throw new KeyNotFoundException();
        if (b.Status != "Draft") throw new InvalidOperationException("This bulletin has already been sent.");

        var html = await ComposeAsync(c, clubId, b);
        var clubName = await c.ExecuteScalarAsync<string?>("SELECT ClubName FROM club_master WHERE pk_club_id = @clubId", new { clubId }) ?? "";
        var mail = new CreateMassEmailDto
        {
            RecipientType = dto.RecipientType, SubgroupIds = dto.RecipientType == 2 ? dto.SubgroupIds : null,
            FromName = clubName, Subject = b.Title, EmailBody = html,
        };
        var massEmailId = b.MassEmailId is int existing && await _massEmails.BelongsToAsync(existing, clubId, null)
            ? existing : 0;
        if (massEmailId > 0) await _massEmails.UpdateAsync(massEmailId, mail, by);
        else
        {
            massEmailId = await _massEmails.CreateAsync(clubId, mail, by);
            await c.ExecuteAsync("UPDATE club_bulletins SET fk_mass_email_id = @massEmailId WHERE pk_bulletin_id = @id", new { massEmailId, id });
        }

        await _massEmails.SendAsync(massEmailId, by);
        await c.ExecuteAsync(@"
            UPDATE club_bulletins SET status = 'Sent', sent_html = @html, sent_date = UTC_TIMESTAMP(), modified_by = @by, modified_date = UTC_TIMESTAMP()
            WHERE pk_bulletin_id = @id", new { html, by, id });
        var (queued, note) = await QueueSubscribersAsync(c, clubId, id, clubName, b.Title, html, by);
        return new BulletinSendResult(massEmailId, queued, note);
    }

    /// <summary>
    /// Copies for the club's Confirmed subscribers (never Pending or Unsubscribed, never suppressed addresses), each
    /// with its own unsubscribe link. They are paid like mass emails: the monthly allowance when the communication
    /// module is on, else email credits. When that is short, no copy goes out and the note says so.
    /// One delivery row per subscriber and bulletin, so a copy is never sent twice.
    /// </summary>
    private async Task<(int Queued, string? Note)> QueueSubscribersAsync(MySqlConnection c, int clubId, int bulletinId, string clubName,
        string subject, string html, int by)
    {
        var subscribers = await BulletinSubscriberService.ConfirmedAsync(c, clubId);
        if (subscribers.Count == 0) return (0, null);
        var paid = await _comms.IsOnAsync()
            ? await CommsService.ReserveClubSendsAsync(c, clubId, subscribers.Count)
            : await _credits.HasSufficientCreditsAsync(clubId, "Email", subscribers.Count);
        if (!paid) return (0, $"Not sent to the {subscribers.Count} subscribers: not enough email credits or allowance left.");
        if (!await _comms.IsOnAsync())
            await _credits.DeductWithHistoryAsync(clubId, "Email", subscribers.Count, "BulletinSubscribers", bulletinId, $"Bulletin: {subject}", by);

        foreach (var s in subscribers)
            await c.ExecuteAsync("INSERT IGNORE INTO club_bulletin_deliveries (fk_bulletin_id, fk_subscriber_id, status) VALUES (@bulletinId, @Id, 'Pending')",
                new { bulletinId, s.Id });

        _ = Task.Run(async () =>
        {
            try
            {
                using var scope = _scopes.CreateScope();
                var email = scope.ServiceProvider.GetRequiredService<IEmailService>();
                var subs = scope.ServiceProvider.GetRequiredService<BulletinSubscriberService>();
                await using var conn = new MySqlConnection(_cs);
                await conn.OpenAsync();
                foreach (var s in subscribers)
                {
                    try
                    {
                        var body = BulletinSubscriberService.WithFooter(html, clubName, subs.UnsubscribeUrl(s.Id));
                        var messageId = await email.SendMassEmailAsync(s.Email, subject, body, clubName, null, null, null, subs.UnsubscribeHeaders(s.Id));
                        await conn.ExecuteAsync(@"UPDATE club_bulletin_deliveries SET status = 'Sent', message_id = @messageId, sent_date = UTC_TIMESTAMP()
                            WHERE fk_bulletin_id = @bulletinId AND fk_subscriber_id = @Id AND status = 'Pending'", new { messageId, bulletinId, s.Id });
                    }
                    catch (Exception ex)
                    {
                        await conn.ExecuteAsync(@"UPDATE club_bulletin_deliveries SET status = 'Failed', error_message = @err
                            WHERE fk_bulletin_id = @bulletinId AND fk_subscriber_id = @Id", new { err = ex.Message.Length > 500 ? ex.Message[..500] : ex.Message, bulletinId, s.Id });
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Bulletin {BulletinId}: subscriber copies stopped", bulletinId);
            }
        });
        return (subscribers.Count, null);
    }

    private static object Params(int clubId, BulletinDto dto, int by) => new
    {
        clubId, by, Title = dto.Title.Trim(), dto.Intro, dto.PresidentMessage, dto.Layout, Csv = Csv(dto.AnnouncementIds),
        EventCsv = Csv(dto.EventIds), StoryCsv = Csv(dto.StoryIds), dto.IncludeBirthdays, dto.IncludeSpeakers,
    };

    private static string? Csv(List<int>? ids) => ids is { Count: > 0 } ? string.Join(",", ids.Where(n => n > 0).Distinct()) : null;

    public static List<int> ParseIds(string? csv) => (csv ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries)
        .Select(s => int.TryParse(s, out var n) ? n : 0).Where(n => n > 0).ToList();

    /// <summary>Rows in the order the manager picked them; ids that matched no row (deleted, other club) drop out.</summary>
    public static List<T> InPickedOrder<T>(IEnumerable<T> rows, Func<T, int> id, List<int> picked)
    {
        var byId = rows.GroupBy(id).ToDictionary(g => g.Key, g => g.First());
        return picked.Where(byId.ContainsKey).Select(i => byId[i]).ToList();
    }

    /// <summary>Month-day keys ("MMdd") for the <paramref name="days"/> days starting at <paramref name="from"/>,
    /// so a week that crosses New Year still matches. A 29 Feb birthday shows on 28 Feb in a non-leap year.</summary>
    public static List<string> BirthdayKeys(DateTime from, int days)
    {
        var keys = new List<string>();
        for (var d = from.Date; d < from.Date.AddDays(days); d = d.AddDays(1))
        {
            keys.Add(d.ToString("MMdd", System.Globalization.CultureInfo.InvariantCulture));
            if (d.Month == 2 && d.Day == 28 && !DateTime.IsLeapYear(d.Year)) keys.Add("0229");
        }
        return keys;
    }

    /// <summary>Loads the club's content for a bulletin and renders it. Only this club's rows are read.</summary>
    private static async Task<string> ComposeAsync(MySqlConnection c, int clubId, BulletinDetailDto b)
    {
        var ids = ParseIds(b.AnnouncementIdsCsv);
        var eventIds = ParseIds(b.EventIdsCsv);
        var storyIds = ParseIds(b.StoryIdsCsv);
        var content = new BulletinContent
        {
            ClubName = await c.ExecuteScalarAsync<string?>("SELECT ClubName FROM club_master WHERE pk_club_id = @clubId", new { clubId }) ?? "",
            Title = b.Title, Intro = b.Intro, PresidentMessage = b.PresidentMessage, Layout = b.Layout,
        };
        if (ids.Count > 0)
            content.Announcements = InPickedOrder(await c.QueryAsync<BulletinItem>(@"
                SELECT pk_announcement_id AS Id, Title, Description AS Text FROM announcements
                WHERE pk_announcement_id IN @ids AND fk_club_id = @clubId AND isdeleted = 0", new { ids, clubId }), i => i.Id, ids);
        if (eventIds.Count > 0)
            content.Events = InPickedOrder(await c.QueryAsync<BulletinItem>(@"
                SELECT pk_upcoming_event_id AS Id, Title, Description AS Text, EventDate AS Date, EventVenue AS Detail FROM upcoming_events
                WHERE pk_upcoming_event_id IN @eventIds AND fk_club_id = @clubId AND isdeleted = 0", new { eventIds, clubId }),
                i => i.Id, eventIds);
        if (storyIds.Count > 0)
            content.Stories = InPickedOrder(await c.QueryAsync<BulletinItem>(@"
                SELECT pk_story_id AS Id, title AS Title, body AS Text FROM club_stories
                WHERE pk_story_id IN @storyIds AND fk_club_id = @clubId AND status = 'Approved' AND isdeleted = 0", new { storyIds, clubId }),
                i => i.Id, storyIds);
        if (b.IncludeBirthdays)
        {
            // The week from the day the bulletin goes out (today for a draft). Active members of this club only.
            var keys = BirthdayKeys(b.SentDate ?? DateTime.UtcNow, 7);
            var rows = await c.QueryAsync<BulletinItem>(@"
                SELECT m.MemberName AS Title, m.BirthDate AS Date FROM club_members cm
                JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                WHERE cm.fk_club_id = @clubId AND cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0
                  AND m.BirthDate IS NOT NULL AND DATE_FORMAT(m.BirthDate, '%m%d') IN @keys", new { clubId, keys });
            content.Birthdays = rows
                .OrderBy(r => keys.IndexOf(r.Date!.Value.ToString("MMdd", System.Globalization.CultureInfo.InvariantCulture)))
                .ThenBy(r => r.Title).ToList();
        }
        if (b.IncludeSpeakers)
        {
            content.Speakers = (await c.QueryAsync<BulletinItem>(@"
                SELECT name AS Title, topic AS Text, meeting_date AS Date FROM club_speakers
                WHERE fk_club_id = @clubId AND meeting_date >= UTC_DATE() ORDER BY meeting_date, pk_speaker_id LIMIT 3", new { clubId })).ToList();
            content.Duties = (await c.QueryAsync<BulletinItem>(@"
                SELECT d.duty AS Title, m.MemberName AS Text, d.meeting_date AS Date FROM meeting_duties d
                LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = d.fk_member_id
                WHERE d.fk_club_id = @clubId AND d.meeting_date = (SELECT MIN(meeting_date) FROM meeting_duties
                      WHERE fk_club_id = @clubId AND meeting_date >= UTC_DATE())
                ORDER BY d.duty", new { clubId })).ToList();
        }
        return BulletinHtml.Compose(content);
    }
}

public sealed class BulletinItem
{
    public int Id { get; set; }
    public string? Title { get; set; }
    public string? Text { get; set; }
    public DateTime? Date { get; set; }
    public string? Detail { get; set; }
}

public sealed class BulletinContent
{
    public string ClubName { get; set; } = "";
    public string Title { get; set; } = "";
    public string? Intro { get; set; }
    public string? PresidentMessage { get; set; }
    public string Layout { get; set; } = "classic";
    public List<BulletinItem> Announcements { get; set; } = new();
    public List<BulletinItem> Stories { get; set; } = new();
    public List<BulletinItem> Events { get; set; } = new();
    public List<BulletinItem> Birthdays { get; set; } = new();
    public List<BulletinItem> Speakers { get; set; } = new();
    public List<BulletinItem> Duties { get; set; } = new();
}

/// <summary>Email-safe HTML for a bulletin (inline styles, one 640px column). Every value is HTML-encoded and the
/// result goes through <see cref="PublicHtml.Clean"/>, the sanitiser used for comms templates.</summary>
public static class BulletinHtml
{
    // ROW palette (admin tailwind tokens): ink, azure, marigold, line, panel. Clubs have no brand colours of their own yet.
    private const string Ink = "#1B2C42", Azure = "#17458F", Marigold = "#F7A81B", Line = "#D5DEE8", Panel = "#F7F9FC", Soft = "#64748B";

    private static string E(string? s) => WebUtility.HtmlEncode(s ?? "");
    private static string Para(string? s) => E(s?.Trim()).Replace("\r\n", "\n").Replace("\n", "<br>");
    private static string Day(DateTime? d) => d?.ToString("ddd d MMM yyyy", System.Globalization.CultureInfo.InvariantCulture) ?? "";
    private static string DayMonth(DateTime? d) => d?.ToString("d MMMM", System.Globalization.CultureInfo.InvariantCulture) ?? "";

    public static string Compose(BulletinContent b)
    {
        var compact = b.Layout == "compact";
        var spotlight = b.Layout == "spotlight";
        var gap = compact ? "16px" : "24px";
        var sb = new StringBuilder();
        sb.Append($"<div style=\"font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:{Ink};max-width:640px;margin:0 auto\">");

        if (compact)
            sb.Append($"<div style=\"border-bottom:2px solid {Azure};padding:0 0 8px 0\"><p style=\"margin:0;font-size:12px;color:{Soft}\">{E(b.ClubName)}</p>")
              .Append($"<h1 style=\"margin:4px 0 0 0;font-size:22px;color:{Ink}\">{E(b.Title)}</h1></div>");
        else
            sb.Append($"<div style=\"background:{Ink};color:#FCFDFE;padding:20px 24px;border-bottom:4px solid {Marigold}\">")
              .Append($"<p style=\"margin:0;font-size:13px;color:#FCFDFE\">{E(b.ClubName)}</p>")
              .Append($"<h1 style=\"margin:4px 0 0 0;font-size:24px;color:#FCFDFE\">{E(b.Title)}</h1></div>");

        sb.Append($"<div style=\"padding:{(compact ? "12px 0" : "8px 24px 24px 24px")}\">");
        if (!string.IsNullOrWhiteSpace(b.Intro)) sb.Append($"<p style=\"margin:{gap} 0 0 0\">{Para(b.Intro)}</p>");

        void President()
        {
            if (string.IsNullOrWhiteSpace(b.PresidentMessage)) return;
            var box = spotlight ? $"background:{Panel};border:1px solid {Line};padding:16px;" : "";
            sb.Append($"<div style=\"margin:{gap} 0 0 0;{box}\">{Heading("From the President")}<p style=\"margin:8px 0 0 0\">{Para(b.PresidentMessage)}</p></div>");
        }
        string Heading(string text) => $"<h2 style=\"margin:0;font-size:{(compact ? "16px" : "18px")};color:{Azure}\">{E(text)}</h2>";
        void Section(string heading, List<BulletinItem> items, Func<BulletinItem, string> meta)
        {
            if (items.Count == 0) return;
            sb.Append($"<div style=\"margin:{gap} 0 0 0;border-top:1px solid {Line};padding-top:12px\">{Heading(heading)}");
            foreach (var i in items)
            {
                var m = meta(i);
                sb.Append($"<div style=\"margin:10px 0 0 0\"><p style=\"margin:0;font-weight:bold\">{E(i.Title)}</p>");
                if (m.Length > 0) sb.Append($"<p style=\"margin:0;font-size:13px;color:{Soft}\">{m}</p>");
                if (!string.IsNullOrWhiteSpace(i.Text)) sb.Append($"<p style=\"margin:2px 0 0 0\">{Para(i.Text)}</p>");
                sb.Append("</div>");
            }
            sb.Append("</div>");
        }

        if (spotlight) President();
        Section("Club news", b.Announcements, _ => "");
        Section("Stories from our members", b.Stories, _ => "");
        Section("Upcoming events", b.Events, i => E(string.Join(", ", new[] { Day(i.Date), i.Detail }.Where(s => !string.IsNullOrWhiteSpace(s)))));
        Section("Birthdays this week", b.Birthdays, i => E(DayMonth(i.Date)));
        Section("Speakers", b.Speakers, i => E(Day(i.Date)));
        Section(b.Duties.Count > 0 ? $"Meeting duties, {Day(b.Duties[0].Date)}" : "", b.Duties, _ => "");
        if (!spotlight) President();
        sb.Append("</div></div>");
        return PublicHtml.Clean(sb.ToString()) ?? "";
    }
}
