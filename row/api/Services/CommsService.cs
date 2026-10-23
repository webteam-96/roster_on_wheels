using System.Net;
using System.Net.Mail;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Dapper;
using DnsClient;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

/// <summary>
/// N5 Communication upgrades (build spec 3.10, #7, B.1 #24-25, B.2): tenant settings (language, Governor note,
/// sender profile), per-language templates, sender domains checked in DNS, monthly allowances, suppressions,
/// consent per channel, the unsubscribe token, campaign tracking and Brevo webhook events.
/// A tenant is a club (ClubId, 0) or a district (0, DistrictId). Behind the flagged feature 'communication'.
/// </summary>
public class CommsService
{
    public const string FeatureKey = CommsTemplates.FeatureKey;
    public static readonly string[] Channels = { "email", "push" };

    // Brevo's documented SPF includes (current brand and the Sendinblue name still in older records).
    private static readonly string[] SpfIncludes = { "include:spf.brevo.com", "include:spf.sendinblue.com" };
    private static readonly Regex DomainName = new(@"^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$", RegexOptions.Compiled);
    private static readonly Regex Selector = new(@"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$", RegexOptions.Compiled);
    private static readonly Regex TemplateKey = new(@"^[a-z0-9][a-z0-9_-]{0,49}$", RegexOptions.Compiled);
    private static readonly Regex LocalPart = new(@"^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$", RegexOptions.Compiled);
    private static readonly Regex DkimKey = new(@"(^|;)\s*p=[A-Za-z0-9+/]{40,}", RegexOptions.Compiled);

    private readonly string _cs;
    private readonly IConfiguration _config;
    private readonly ILogger<CommsService> _log;

    public CommsService(IConfiguration config, ILogger<CommsService> log)
    {
        _config = config;
        _log = log;
        _cs = config.GetConnectionString("DefaultConnection")!;
    }

    public readonly record struct Tenant(int ClubId, int DistrictId)
    {
        public bool IsClub => ClubId > 0;
    }

    private MySqlConnection Conn() => new(_cs);

    public async Task<bool> IsOnAsync() => (await FeatureGate.OnAsync(_cs)).Contains(FeatureKey);

    // ── Settings: language, Governor note, sender profile ────────────────────────────────────

    public async Task<CommSettingsDto> GetSettingsAsync(Tenant t)
    {
        await using var conn = Conn();
        await conn.OpenAsync();
        var dto = await conn.QueryFirstOrDefaultAsync<CommSettingsDto>(@"
            SELECT default_language AS DefaultLanguage, governor_note_enabled AS GovernorNoteEnabled, governor_name AS GovernorName,
                   governor_photo_url AS GovernorPhotoUrl, governor_message AS GovernorMessage, sender_from_name AS SenderFromName,
                   sender_from_email AS SenderFromEmail, sender_reply_to AS SenderReplyTo, foundation_giving_url AS FoundationGivingUrl
            FROM comm_settings WHERE fk_club_id = @ClubId AND fk_district_id = @DistrictId", new { t.ClubId, t.DistrictId }) ?? new();
        dto.EffectiveLanguage = await CommsTemplates.DefaultLanguageAsync(conn, t.ClubId, t.DistrictId);
        return dto;
    }

    /// <summary>Validates and saves the tenant's settings; returns an error message or null.</summary>
    public async Task<string?> SaveSettingsAsync(Tenant t, CommSettingsDto dto, int by)
    {
        var lang = Blank(dto.DefaultLanguage);
        if (lang != null && !CommsTemplates.LanguageCode.IsMatch(lang)) return "Language must be a code such as \"en\" or \"pt-BR\".";

        // The Governor note and the Foundation giving link belong to the district; a club row never holds them.
        string? gName = null, gPhoto = null, gMessage = null, foundation = null;
        var gOn = false;
        if (!t.IsClub)
        {
            foundation = Blank(dto.FoundationGivingUrl);
            if (foundation != null && !IsGivingUrl(foundation))
                return "The Foundation giving link must be a full https:// address of at most 500 characters.";
            gName = Blank(dto.GovernorName);
            gPhoto = Blank(dto.GovernorPhotoUrl);
            gMessage = Blank(dto.GovernorMessage)?.Replace("\r\n", "\n");
            gOn = dto.GovernorNoteEnabled;
            if (gName?.Length > 150) return "The Governor's name is 150 characters at most.";
            if (gMessage?.Length > 1000) return "The Governor's note is 1000 characters at most.";
            if (gOn && (gName == null || gMessage == null)) return "Enter the Governor's name and note before switching the note on.";
            if (gPhoto != null && !IsUploadUrl(gPhoto)) return "Upload the Governor's photo with the photo button.";
        }

        var fromName = Blank(dto.SenderFromName);
        if (fromName != null && (fromName.Length > 100 || fromName.IndexOfAny(new[] { '\r', '\n', '<', '>', '"' }) >= 0))
            return "From name is 100 characters at most, without line breaks, quotes or angle brackets.";
        var replyTo = Blank(dto.SenderReplyTo)?.ToLowerInvariant();
        if (replyTo != null && !IsEmail(replyTo)) return "Reply-to must be an email address.";
        var fromEmail = Blank(dto.SenderFromEmail)?.ToLowerInvariant();

        await using var conn = Conn();
        await conn.OpenAsync();
        // An unchanged address is not checked again (sends check its domain every time), so saving the language never
        // fails because a domain record changed since.
        var stored = await conn.ExecuteScalarAsync<string?>(
            "SELECT sender_from_email FROM comm_settings WHERE fk_club_id = @ClubId AND fk_district_id = @DistrictId", new { t.ClubId, t.DistrictId });
        if (fromEmail != null && fromEmail != stored)
        {
            var at = fromEmail.LastIndexOf('@');
            if (at <= 0 || !LocalPart.IsMatch(fromEmail[..at]) || !IsEmail(fromEmail)) return "From email must be an address such as news@yourclub.org.";
            var verified = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM comm_sender_domains WHERE fk_club_id = @ClubId AND fk_district_id = @DistrictId AND domain = @Domain
                  AND ownership_ok = 1 AND spf_ok = 1 AND dkim_ok = 1 AND dmarc_ok = 1",
                new { t.ClubId, t.DistrictId, Domain = fromEmail[(at + 1)..] });
            if (verified == 0) return "The from email must be on one of your verified sender domains.";
        }

        await conn.ExecuteAsync(@"
            INSERT INTO comm_settings (fk_club_id, fk_district_id, default_language, governor_note_enabled, governor_name, governor_photo_url,
                                       governor_message, sender_from_name, sender_from_email, sender_reply_to, foundation_giving_url, modified_by)
            VALUES (@ClubId, @DistrictId, @lang, @gOn, @gName, @gPhoto, @gMessage, @fromName, @fromEmail, @replyTo, @foundation, @by)
            ON DUPLICATE KEY UPDATE default_language = VALUES(default_language), governor_note_enabled = VALUES(governor_note_enabled),
                governor_name = VALUES(governor_name), governor_photo_url = VALUES(governor_photo_url), governor_message = VALUES(governor_message),
                sender_from_name = VALUES(sender_from_name), sender_from_email = VALUES(sender_from_email),
                sender_reply_to = VALUES(sender_reply_to), foundation_giving_url = VALUES(foundation_giving_url), modified_by = VALUES(modified_by)",
            new { t.ClubId, t.DistrictId, lang, gOn, gName, gPhoto, gMessage, fromName, fromEmail, replyTo, foundation, by });
        return null;
    }

    // The photo comes from the shared image upload (/api/mass-email/image), which answers an absolute /uploads/ URL on
    // the API's host; another host would let a tracking pixel into every greeting.
    private bool IsUploadUrl(string url)
    {
        if (url.Length > 500 || !Uri.TryCreate(url, UriKind.Absolute, out var u) || (u.Scheme != Uri.UriSchemeHttps && u.Scheme != Uri.UriSchemeHttp)
            || !u.AbsolutePath.Contains("/uploads/", StringComparison.OrdinalIgnoreCase) || u.Query.Length > 0)
            return false;
        var api = Blank(_config["Api:BaseUrl"]) ?? Brand.ApiOrigin;
        return api.Length == 0 || (Uri.TryCreate(api, UriKind.Absolute, out var a) && string.Equals(a.Host, u.Host, StringComparison.OrdinalIgnoreCase));
    }

    // Goes into greeting and milestone emails as a link: an absolute https address without credentials or characters
    // that could break out of an HTML attribute.
    private static bool IsGivingUrl(string url)
        => url.Length <= 500 && !url.Any(c => char.IsWhiteSpace(c) || char.IsControl(c) || "\"'<>\\".Contains(c))
           && Uri.TryCreate(url, UriKind.Absolute, out var u) && u.Scheme == Uri.UriSchemeHttps && u.UserInfo.Length == 0
           && u.Host.Contains('.');

    private static bool IsEmail(string s)
        => s.Length <= 254 && s.IndexOfAny(new[] { ' ', '\r', '\n', '<', '>', '"', ',' }) < 0
           && MailAddress.TryCreate(s, out var a) && a.Address == s;

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    // ── Templates ────────────────────────────────────────────────────────────────────────────

    private const string TemplateSelect = @"
        SELECT pk_template_id AS Id, template_key AS TemplateKey, language AS Language, subject AS Subject, body_html AS BodyHtml,
               reviewed AS Reviewed, modified_date AS ModifiedDate
        FROM comm_templates";

    public async Task<List<CommTemplateDto>> GetTemplatesAsync(Tenant t)
    {
        await using var conn = Conn();
        return (await conn.QueryAsync<CommTemplateDto>(TemplateSelect + @"
            WHERE fk_club_id = @ClubId AND fk_district_id = @DistrictId ORDER BY template_key, language", new { t.ClubId, t.DistrictId })).ToList();
    }

    /// <summary>Creates or replaces the (key, language) version. The body is cleaned of scripts and event handlers.</summary>
    public async Task<(CommTemplateDto? Saved, string? Error)> SaveTemplateAsync(Tenant t, SaveCommTemplateDto dto, int by)
    {
        var key = Blank(dto.TemplateKey)?.ToLowerInvariant();
        var lang = Blank(dto.Language);
        var subject = Blank(dto.Subject);
        var body = PublicHtml.Clean(Blank(dto.BodyHtml));
        if (key == null || !TemplateKey.IsMatch(key)) return (null, "Key is required: lower-case letters, digits, '-' or '_' (50 at most).");
        if (lang == null || !CommsTemplates.LanguageCode.IsMatch(lang)) return (null, "Language must be a code such as \"en\" or \"pt-BR\".");
        if (subject == null || subject.Length > 300 || subject.IndexOfAny(new[] { '\r', '\n' }) >= 0) return (null, "Subject is required, one line, 300 characters at most.");
        if (string.IsNullOrWhiteSpace(body) || body.Length > 100_000) return (null, "Body is required (100,000 characters at most).");

        await using var conn = Conn();
        await conn.ExecuteAsync(@"
            INSERT INTO comm_templates (fk_club_id, fk_district_id, template_key, language, subject, body_html, reviewed, modified_by)
            VALUES (@ClubId, @DistrictId, @key, @lang, @subject, @body, @Reviewed, @by)
            ON DUPLICATE KEY UPDATE subject = VALUES(subject), body_html = VALUES(body_html), reviewed = VALUES(reviewed), modified_by = VALUES(modified_by)",
            new { t.ClubId, t.DistrictId, key, lang, subject, body, dto.Reviewed, by });
        var saved = await conn.QueryFirstAsync<CommTemplateDto>(TemplateSelect + @"
            WHERE fk_club_id = @ClubId AND fk_district_id = @DistrictId AND template_key = @key AND language = @lang", new { t.ClubId, t.DistrictId, key, lang });
        return (saved, null);
    }

    public async Task<CommTemplateDto?> DeleteTemplateAsync(Tenant t, int id)
    {
        await using var conn = Conn();
        var row = await conn.QueryFirstOrDefaultAsync<CommTemplateDto>(TemplateSelect + @"
            WHERE pk_template_id = @id AND fk_club_id = @ClubId AND fk_district_id = @DistrictId", new { id, t.ClubId, t.DistrictId });
        if (row != null) await conn.ExecuteAsync("DELETE FROM comm_templates WHERE pk_template_id = @id", new { id });
        return row;
    }

    // ── Sender domains (DNS only: TXT lookups with timeouts, never an HTTP fetch) ──────────

    private const string DomainSelect = @"
        SELECT pk_domain_id AS Id, domain AS Domain, dkim_selector AS DkimSelector, verify_token AS VerifyToken, ownership_ok AS OwnershipOk,
               spf_ok AS SpfOk, dkim_ok AS DkimOk, dmarc_ok AS DmarcOk, checked_at AS CheckedAt
        FROM comm_sender_domains";

    public async Task<List<SenderDomainDto>> GetDomainsAsync(Tenant t)
    {
        await using var conn = Conn();
        var list = (await conn.QueryAsync<SenderDomainDto>(DomainSelect + @"
            WHERE fk_club_id = @ClubId AND fk_district_id = @DistrictId ORDER BY domain", new { t.ClubId, t.DistrictId })).ToList();
        list.ForEach(WithRecords);
        return list;
    }

    // shortcut: the DKIM value comes from the platform's Brevo account and the domain must also be authenticated there
    // by ROW support; automate it with Brevo's senders/domains API when tenants add domains often.
    private static void WithRecords(SenderDomainDto d) => d.Records = new()
    {
        new() { Host = d.Domain, Value = $"row-verification={d.VerifyToken}", Purpose = "Proves that you control this domain." },
        new() { Host = d.Domain, Value = "v=spf1 include:spf.brevo.com ~all", Purpose = "SPF. If the domain already has an SPF record, add include:spf.brevo.com to it instead." },
        new() { Host = $"{d.DkimSelector}._domainkey.{d.Domain}", Value = "The DKIM key from the platform's Brevo account (ask ROW support).", Purpose = "DKIM signature." },
        new() { Host = $"_dmarc.{d.Domain}", Value = "v=DMARC1; p=none", Purpose = "DMARC policy." },
    };

    public async Task<(SenderDomainDto? Added, string? Error)> AddDomainAsync(Tenant t, AddSenderDomainDto dto, int by)
    {
        var domain = Blank(dto.Domain)?.ToLowerInvariant().TrimEnd('.');
        if (domain == null || !DomainName.IsMatch(domain)) return (null, "Enter a domain name such as yourclub.org (no https:// and no path).");
        var selector = Blank(dto.DkimSelector)?.ToLowerInvariant() ?? (Blank(_config["Brevo:DkimSelector"]) ?? "mail");
        if (!Selector.IsMatch(selector)) return (null, "DKIM selector: letters, digits and '-' only.");

        await using var conn = Conn();
        await conn.OpenAsync();
        if (await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM comm_sender_domains WHERE fk_club_id = @ClubId AND fk_district_id = @DistrictId",
                new { t.ClubId, t.DistrictId }) >= 10)
            return (null, "A club or district can add 10 sender domains at most.");
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
        var added = await conn.ExecuteAsync(@"
            INSERT IGNORE INTO comm_sender_domains (fk_club_id, fk_district_id, domain, dkim_selector, verify_token, created_by)
            VALUES (@ClubId, @DistrictId, @domain, @selector, @token, @by)", new { t.ClubId, t.DistrictId, domain, selector, token, by });
        if (added == 0) return (null, "This domain is already listed.");
        var d = await conn.QueryFirstAsync<SenderDomainDto>(DomainSelect + @"
            WHERE fk_club_id = @ClubId AND fk_district_id = @DistrictId AND domain = @domain", new { t.ClubId, t.DistrictId, domain });
        WithRecords(d);
        return (d, null);
    }

    public async Task<SenderDomainDto?> VerifyDomainAsync(Tenant t, int id)
    {
        await using var conn = Conn();
        await conn.OpenAsync();
        var d = await conn.QueryFirstOrDefaultAsync<SenderDomainDto>(DomainSelect + @"
            WHERE pk_domain_id = @id AND fk_club_id = @ClubId AND fk_district_id = @DistrictId", new { id, t.ClubId, t.DistrictId });
        if (d == null) return null;

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        var dns = new LookupClient(new LookupClientOptions(DnsServers())
        {
            UseCache = false, Timeout = TimeSpan.FromSeconds(4), Retries = 1, ThrowDnsErrors = false, ContinueOnDnsError = true,
        });
        var root = await TxtAsync(dns, d.Domain, cts.Token);
        var dkim = await TxtAsync(dns, $"{d.DkimSelector}._domainkey.{d.Domain}", cts.Token);
        var dmarc = await TxtAsync(dns, $"_dmarc.{d.Domain}", cts.Token);
        (d.OwnershipOk, d.SpfOk, d.DkimOk, d.DmarcOk) = Evaluate(d.VerifyToken, root, dkim, dmarc);
        d.CheckedAt = DateTime.UtcNow;

        await conn.ExecuteAsync(@"
            UPDATE comm_sender_domains SET ownership_ok = @OwnershipOk, spf_ok = @SpfOk, dkim_ok = @DkimOk, dmarc_ok = @DmarcOk, checked_at = @CheckedAt
            WHERE pk_domain_id = @Id", d);
        WithRecords(d);
        return d;
    }

    /// <summary>The DNS verdicts from the TXT answers (pure, so the rules are easy to read and test).</summary>
    public static (bool Ownership, bool Spf, bool Dkim, bool Dmarc) Evaluate(string token, IReadOnlyList<string> root, IReadOnlyList<string> dkim, IReadOnlyList<string> dmarc)
        => (root.Any(r => r.Trim() == $"row-verification={token}"),
            root.Any(r => r.TrimStart().StartsWith("v=spf1", StringComparison.OrdinalIgnoreCase)
                          && SpfIncludes.Any(i => r.Contains(i, StringComparison.OrdinalIgnoreCase))),
            dkim.Any(r => DkimKey.IsMatch(r)),
            dmarc.Any(r => r.TrimStart().StartsWith("v=DMARC1", StringComparison.OrdinalIgnoreCase)));

    // Public resolvers by default, as DnsPointingChecker does; Comms:DnsServers ("ip" or "ip:port") overrides them.
    private NameServer[] DnsServers()
    {
        var configured = _config.GetSection("Comms:DnsServers").Get<string[]>();
        var list = (configured is { Length: > 0 } ? configured : new[] { "8.8.8.8", "1.1.1.1" })
            .Select(s => IPEndPoint.TryParse(s.Trim(), out var ep) ? new NameServer(ep.Address, ep.Port == 0 ? 53 : ep.Port) : null)
            .Where(n => n != null).Select(n => n!).ToArray();
        return list.Length > 0 ? list : new[] { new NameServer(IPAddress.Parse("8.8.8.8")) };
    }

    private async Task<List<string>> TxtAsync(LookupClient dns, string name, CancellationToken ct)
    {
        try
        {
            var r = await dns.QueryAsync(name, QueryType.TXT, cancellationToken: ct);
            return r.Answers.TxtRecords().Select(x => string.Concat(x.Text)).ToList();
        }
        catch (Exception ex)
        {
            _log.LogInformation("Sender domain TXT lookup failed for {Name}: {Message}", name, ex.Message);
            return new();
        }
    }

    public async Task<SenderDomainDto?> DeleteDomainAsync(Tenant t, int id)
    {
        await using var conn = Conn();
        await conn.OpenAsync();
        var d = await conn.QueryFirstOrDefaultAsync<SenderDomainDto>(DomainSelect + @"
            WHERE pk_domain_id = @id AND fk_club_id = @ClubId AND fk_district_id = @DistrictId", new { id, t.ClubId, t.DistrictId });
        if (d == null) return null;
        await conn.ExecuteAsync("DELETE FROM comm_sender_domains WHERE pk_domain_id = @id", new { id });
        // A from address on a removed domain falls back to the platform sender.
        await conn.ExecuteAsync(@"
            UPDATE comm_settings SET sender_from_email = NULL
            WHERE fk_club_id = @ClubId AND fk_district_id = @DistrictId AND sender_from_email LIKE CONCAT('%@', @Domain)",
            new { t.ClubId, t.DistrictId, d.Domain });
        return d;
    }

    // ── Allowance and usage ──────────────────────────────────────────────────────────────────

    public static string MonthKey(DateTime d) => d.ToString("yyyy-MM", System.Globalization.CultureInfo.InvariantCulture);

    /// <summary>Edition, emails per member per month (null: not limited) and active members of the tenant.</summary>
    private static async Task<(string Edition, int? PerMember, int Members)> AllowanceAsync(MySqlConnection conn, Tenant t)
    {
        var edition = await conn.ExecuteScalarAsync<string?>(t.IsClub
            ? "SELECT edition_code FROM tenant_subscriptions WHERE fk_club_id = @ClubId LIMIT 1"
            : "SELECT edition_code FROM tenant_subscriptions WHERE fk_club_id = 0 AND fk_district_id = @DistrictId LIMIT 1",
            new { t.ClubId, t.DistrictId }) ?? (t.IsClub ? "club" : "district");
        var perMember = await conn.ExecuteScalarAsync<int?>(
            "SELECT email_allowance_per_member FROM edition_catalogue WHERE code = @edition", new { edition });
        var members = await conn.ExecuteScalarAsync<int>(t.IsClub
            ? @"SELECT COUNT(DISTINCT cm.fk_member_master_profile_id) FROM club_members cm
                WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND cm.isdeleted = 0"
            : @"SELECT COUNT(DISTINCT cm.fk_member_master_profile_id) FROM club_members cm
                JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0 AND c.IsActive = 1
                WHERE c.fk_district_id = @DistrictId AND cm.IsActive = 1 AND cm.isdeleted = 0",
            new { t.ClubId, t.DistrictId });
        return (edition, perMember, members);
    }

    private static string OwnerSql(Tenant t) => t.IsClub
        ? "me.fk_club_id = @ClubId"
        : "me.fk_club_id = 0 AND me.fk_district_id = @DistrictId AND me.Scope <> 'ri'";

    private const string CampaignCounts = @"
        COALESCE(SUM(r.Status = 'Sent'), 0) AS Sent,
        COALESCE(SUM(r.DeliveryStatus IN ('Delivered') OR r.OpenCount > 0 OR r.ClickCount > 0), 0) AS Delivered,
        COALESCE(SUM(r.OpenCount > 0), 0) AS Opened,
        COALESCE(SUM(r.ClickCount > 0), 0) AS Clicked,
        COALESCE(SUM(r.DeliveryStatus = 'Bounced'), 0) AS Bounced,
        COALESCE(SUM(r.DeliveryStatus = 'Complaint'), 0) AS Complaints,
        COALESCE(SUM(r.Status = 'Skipped'), 0) AS Skipped";

    public async Task<CommUsageDto> GetUsageAsync(Tenant t, DateTime month)
    {
        await using var conn = Conn();
        await conn.OpenAsync();
        var (edition, perMember, members) = await AllowanceAsync(conn, t);
        var key = MonthKey(month);
        var used = await conn.ExecuteScalarAsync<int?>(@"
            SELECT emails_used FROM comm_usage WHERE fk_club_id = @ClubId AND fk_district_id = @DistrictId AND usage_month = @key",
            new { t.ClubId, t.DistrictId, key }) ?? 0;
        int? allowance = perMember * members;
        var campaigns = (await conn.QueryAsync<CommUsageCampaignDto>($@"
            SELECT me.pk_mass_email_id AS Id, me.Subject, me.SentDate, {CampaignCounts}
            FROM club_mass_emails me
            LEFT JOIN club_mass_email_recipients r ON r.fk_mass_email_id = me.pk_mass_email_id AND r.isdeleted = 0
            WHERE {OwnerSql(t)} AND me.isdeleted = 0 AND me.SentDate >= @from AND me.SentDate < @to
            GROUP BY me.pk_mass_email_id, me.Subject, me.SentDate
            ORDER BY me.SentDate DESC",
            new { t.ClubId, t.DistrictId, from = month, to = month.AddMonths(1) })).ToList();
        return new CommUsageDto
        {
            Month = key, Edition = edition, PerMember = perMember, Members = members, Allowance = allowance, Used = used,
            Remaining = allowance == null ? null : Math.Max(0, allowance.Value - used), Campaigns = campaigns,
        };
    }

    // ── Campaign send plan (ClubMassEmailService.SendAsync while the module is on) ─────────────

    public sealed record CampaignRecipient(int Id, int MemberId, string? MemberName, string Email, string? Language);

    /// <summary>What a bulk send needs per recipient: language version, unsubscribe link and headers, sender.</summary>
    public sealed class CampaignPlan
    {
        public Tenant Tenant { get; init; }
        public string Month { get; init; } = "";
        public List<CampaignRecipient> ToSend { get; init; } = new();
        public string? FromEmail { get; init; }
        public string? FromName { get; init; }
        public string? ReplyTo { get; init; }
        internal Dictionary<string, CommsTemplates.Template> Versions { get; init; } = new();
        internal string TenantLanguage { get; init; } = "";
        internal string TenantName { get; init; } = "";
        internal string PortalOrigin { get; init; } = "";
        internal string ApiOrigin { get; init; } = "";
        internal string Secret { get; init; } = "";

        public (string Subject, string Html, string? Language) Render(CampaignRecipient r, string subject, string body)
        {
            var version = CommsTemplates.Pick(Versions, r.Language, TenantLanguage);
            var values = new Dictionary<string, string?> { ["member_name"] = r.MemberName, ["club_name"] = TenantName };
            var url = $"{PortalOrigin}/unsubscribe/{UnsubscribeToken(r.MemberId, Secret)}";
            // shortcut: the unsubscribe line is English; move it into the templates when a tenant needs it translated.
            var footer = $"<p style=\"font-size:12px;color:#64748b;text-align:center;margin:24px 0 0 0\">You receive this email as a member of {WebUtility.HtmlEncode(TenantName)}. <a href=\"{WebUtility.HtmlEncode(url)}\" style=\"color:#64748b\">Unsubscribe</a></p>";
            return (CommsTemplates.Fill(version?.Subject ?? subject, values, false),
                    CommsTemplates.Fill(version?.BodyHtml ?? body, values, true) + footer,
                    version?.Language);
        }

        /// <summary>One-click unsubscribe headers (RFC 8058), when the API's public origin is known.</summary>
        public Dictionary<string, string>? Headers(CampaignRecipient r) => ApiOrigin.Length == 0 ? null : new()
        {
            ["List-Unsubscribe"] = $"<{ApiOrigin}/api/public/comms/unsubscribe/{UnsubscribeToken(r.MemberId, Secret)}>",
            ["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click",
        };
    }

    /// <summary>
    /// Drops recipients who unsubscribed or whose address is suppressed (marked Skipped), reserves the monthly
    /// allowance for the rest and loads the language versions. Throws InvalidOperationException when the send would
    /// go over the allowance or nobody is left; nothing is changed then.
    /// </summary>
    public async Task<CampaignPlan> PlanCampaignAsync(MySqlConnection conn, Tenant t, string? templateKey, List<CampaignRecipient> recipients)
    {
        var secret = _config["JwtSettings:Secret"] ?? "";
        if (secret.Length < 32) throw new InvalidOperationException("The unsubscribe link cannot be signed: JwtSettings:Secret is not set.");

        var emails = recipients.Select(r => r.Email.Trim().ToLowerInvariant()).Distinct().ToList();
        var suppressed = (await conn.QueryAsync<string>(@"
            SELECT email FROM comm_suppressions WHERE email IN @emails
              AND ((fk_club_id = @ClubId AND fk_district_id = @DistrictId) OR (fk_club_id = 0 AND fk_district_id = 0))",
            new { emails, t.ClubId, t.DistrictId })).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var optedOut = (await conn.QueryAsync<int>(
            "SELECT fk_member_id FROM member_channel_consents WHERE channel = 'email' AND consented = 0 AND fk_member_id IN @ids",
            new { ids = recipients.Select(r => r.MemberId).Distinct().ToList() })).ToHashSet();
        string? Why(CampaignRecipient r) => optedOut.Contains(r.MemberId) ? "Unsubscribed from email"
            : suppressed.Contains(r.Email.Trim()) ? "Address suppressed (bounce or complaint)" : null;

        var toSend = recipients.Where(r => Why(r) == null).ToList();
        if (toSend.Count == 0) throw new InvalidOperationException("No recipient can receive this email: every one has unsubscribed or has a suppressed address.");

        var (_, perMember, members) = await AllowanceAsync(conn, t);
        var month = MonthKey(DateTime.UtcNow);
        if (!await ReserveAsync(conn, t, month, toSend.Count, perMember * members))
        {
            var used = await conn.ExecuteScalarAsync<int>(@"SELECT emails_used FROM comm_usage
                WHERE fk_club_id = @ClubId AND fk_district_id = @DistrictId AND usage_month = @month", new { t.ClubId, t.DistrictId, month });
            // shortcut: no overage purchase while payments are on hold (Stripe); add a wallet top-up for the excess then.
            throw new InvalidOperationException(
                $"This email needs {toSend.Count} sends but only {Math.Max(0, perMember!.Value * members - used)} of this month's allowance of {perMember * members} are left ({perMember} per member). Send it next month or to fewer members.");
        }

        foreach (var r in recipients.Where(r => Why(r) != null))
            await conn.ExecuteAsync("UPDATE club_mass_email_recipients SET Status = 'Skipped', ErrorMessage = @Why WHERE pk_id = @Id", new { Why = Why(r), r.Id });

        var settings = await conn.QueryFirstOrDefaultAsync<(string? FromName, string? FromEmail, string? ReplyTo)>(@"
            SELECT s.sender_from_name, s.sender_from_email, s.sender_reply_to FROM comm_settings s
            WHERE s.fk_club_id = @ClubId AND s.fk_district_id = @DistrictId", new { t.ClubId, t.DistrictId });
        string? fromEmail = null;
        if (settings.FromEmail is { } fe && fe.LastIndexOf('@') is var at and > 0)
        {
            var ok = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM comm_sender_domains WHERE fk_club_id = @ClubId AND fk_district_id = @DistrictId AND domain = @Domain
                  AND ownership_ok = 1 AND spf_ok = 1 AND dkim_ok = 1 AND dmarc_ok = 1", new { t.ClubId, t.DistrictId, Domain = fe[(at + 1)..] });
            if (ok > 0) fromEmail = fe;
        }

        return new CampaignPlan
        {
            Tenant = t, Month = month, ToSend = toSend, FromEmail = fromEmail, FromName = settings.FromName, ReplyTo = settings.ReplyTo,
            Versions = string.IsNullOrEmpty(templateKey) ? new() : await CommsTemplates.LoadAsync(conn, t.ClubId, t.DistrictId, templateKey),
            TenantLanguage = await CommsTemplates.DefaultLanguageAsync(conn, t.ClubId, t.DistrictId),
            TenantName = await TenantNameAsync(conn, t),
            PortalOrigin = (Blank(_config["FrontendUrl"]) ?? Brand.PortalOrigin).TrimEnd('/'),
            ApiOrigin = (Blank(_config["Api:BaseUrl"]) ?? Brand.ApiOrigin).TrimEnd('/'),
            Secret = secret,
        };
    }

    private static async Task<string> TenantNameAsync(MySqlConnection conn, Tenant t) => t.IsClub
        ? await conn.ExecuteScalarAsync<string?>("SELECT ClubName FROM club_master WHERE pk_club_id = @ClubId", new { t.ClubId }) ?? "your club"
        : "District " + (await conn.ExecuteScalarAsync<string?>("SELECT DistrictNumber FROM district_master WHERE pk_district_id = @DistrictId", new { t.DistrictId }) ?? "");

    /// <summary>Atomic: two sends at the same moment cannot both pass the allowance. allowance null = not limited.</summary>
    private static async Task<bool> ReserveAsync(MySqlConnection conn, Tenant t, string month, int count, int? allowance)
    {
        var p = new { t.ClubId, t.DistrictId, month, count, allowance };
        await conn.ExecuteAsync(@"INSERT IGNORE INTO comm_usage (fk_club_id, fk_district_id, usage_month, emails_used)
            VALUES (@ClubId, @DistrictId, @month, 0)", p);
        return await conn.ExecuteAsync(@"
            UPDATE comm_usage SET emails_used = emails_used + @count
            WHERE fk_club_id = @ClubId AND fk_district_id = @DistrictId AND usage_month = @month
              AND (@allowance IS NULL OR emails_used + @count <= @allowance)", p) == 1;
    }

    /// <summary>Gives back the allowance of sends that failed (a retry reserves it again).</summary>
    public static Task ReleaseAsync(MySqlConnection conn, CampaignPlan plan, int count) => count <= 0 ? Task.CompletedTask : conn.ExecuteAsync(@"
        UPDATE comm_usage SET emails_used = GREATEST(0, emails_used - @count)
        WHERE fk_club_id = @ClubId AND fk_district_id = @DistrictId AND usage_month = @Month",
        new { plan.Tenant.ClubId, plan.Tenant.DistrictId, plan.Month, count });

    // ── Campaign tracking ────────────────────────────────────────────────────────────────────

    public async Task<CampaignTrackingDto?> GetCampaignAsync(Tenant t, int massEmailId)
    {
        await using var conn = Conn();
        await conn.OpenAsync();
        var dto = await conn.QueryFirstOrDefaultAsync<CampaignTrackingDto>($@"
            SELECT me.pk_mass_email_id AS Id, me.Subject, me.SentDate, me.Status, me.TemplateKey, COUNT(r.pk_id) AS Recipients,
                   COALESCE(SUM(r.Status = 'Failed'), 0) AS Failed, {CampaignCounts}
            FROM club_mass_emails me
            LEFT JOIN club_mass_email_recipients r ON r.fk_mass_email_id = me.pk_mass_email_id AND r.isdeleted = 0
            WHERE me.pk_mass_email_id = @massEmailId AND {OwnerSql(t)} AND me.isdeleted = 0
            GROUP BY me.pk_mass_email_id, me.Subject, me.SentDate, me.Status, me.TemplateKey",
            new { massEmailId, t.ClubId, t.DistrictId });
        if (dto == null) return null;
        dto.RecipientRows = (await conn.QueryAsync<CampaignRecipientTrackingDto>(@"
            SELECT MemberName, Email, Language, Status, DeliveryStatus, SentDate, OpenedAt, OpenCount, ClickedAt, ClickCount, ErrorMessage
            FROM club_mass_email_recipients WHERE fk_mass_email_id = @massEmailId AND isdeleted = 0 ORDER BY MemberName",
            new { massEmailId })).ToList();
        return dto;
    }

    // ── Suppressions and opt-outs ────────────────────────────────────────────────────────────

    public async Task<List<CommSuppressionDto>> GetSuppressionsAsync(Tenant t)
    {
        await using var conn = Conn();
        return (await conn.QueryAsync<CommSuppressionDto>(@"
            SELECT pk_suppression_id AS Id, email AS Email, reason AS Reason, created_date AS CreatedDate FROM comm_suppressions
            WHERE fk_club_id = @ClubId AND fk_district_id = @DistrictId ORDER BY created_date DESC LIMIT 1000", new { t.ClubId, t.DistrictId })).ToList();
    }

    public async Task<CommSuppressionDto?> DeleteSuppressionAsync(Tenant t, int id)
    {
        await using var conn = Conn();
        var row = await conn.QueryFirstOrDefaultAsync<CommSuppressionDto>(@"
            SELECT pk_suppression_id AS Id, email AS Email, reason AS Reason, created_date AS CreatedDate FROM comm_suppressions
            WHERE pk_suppression_id = @id AND fk_club_id = @ClubId AND fk_district_id = @DistrictId", new { id, t.ClubId, t.DistrictId });
        if (row != null) await conn.ExecuteAsync("DELETE FROM comm_suppressions WHERE pk_suppression_id = @id", new { id });
        return row;
    }

    /// <summary>Members of the club (or of the district's clubs) who switched a channel off.</summary>
    public async Task<List<CommOptOutDto>> GetOptOutsAsync(Tenant t)
    {
        await using var conn = Conn();
        var scope = t.IsClub
            ? "cm.fk_club_id = @ClubId"
            : "cm.fk_club_id IN (SELECT pk_club_id FROM club_master WHERE fk_district_id = @DistrictId AND isdeleted = 0)";
        return (await conn.QueryAsync<CommOptOutDto>($@"
            SELECT k.fk_member_id AS MemberId, m.MemberName, k.channel AS Channel, k.changed_at_utc AS ChangedAtUtc, k.source AS Source
            FROM member_channel_consents k
            JOIN member_master_profile m ON m.pk_member_master_profile_id = k.fk_member_id AND m.isdeleted = 0
            WHERE k.consented = 0 AND EXISTS (SELECT 1 FROM club_members cm
                WHERE cm.fk_member_master_profile_id = k.fk_member_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND {scope})
            ORDER BY k.changed_at_utc DESC LIMIT 1000", new { t.ClubId, t.DistrictId })).ToList();
    }

    // ── Member consent per channel ───────────────────────────────────────────────────────────

    // Members of a club receive its mail until they opt out (no row = consented); a row records the choice and when.
    public async Task<MemberCommsPreferencesDto> GetPreferencesAsync(int memberId)
    {
        await using var conn = Conn();
        await conn.OpenAsync();
        var language = await conn.ExecuteScalarAsync<string?>(
            "SELECT PrimaryLanguage FROM member_master_profile WHERE pk_member_master_profile_id = @memberId", new { memberId });
        var club = await conn.ExecuteScalarAsync<int?>(@"
            SELECT fk_club_id FROM club_members WHERE fk_member_master_profile_id = @memberId AND IsActive = 1 AND isdeleted = 0
            ORDER BY pk_club_member_id LIMIT 1", new { memberId });
        var rows = (await conn.QueryAsync<ChannelConsentDto>(@"
            SELECT channel AS Channel, consented AS Consented, changed_at_utc AS ChangedAtUtc, source AS Source
            FROM member_channel_consents WHERE fk_member_id = @memberId", new { memberId })).ToList();
        return new MemberCommsPreferencesDto
        {
            Language = language,
            EffectiveLanguage = CommsTemplates.LanguageOf(language) ?? await CommsTemplates.DefaultLanguageAsync(conn, club ?? 0, 0),
            Consents = Channels.Select(c => rows.FirstOrDefault(r => r.Channel == c) ?? new ChannelConsentDto { Channel = c }).ToList(),
        };
    }

    public async Task SetConsentAsync(int memberId, string channel, bool consented, string source)
    {
        if (!Channels.Contains(channel)) throw new ArgumentOutOfRangeException(nameof(channel));
        await using var conn = Conn();
        await conn.ExecuteAsync(@"
            INSERT INTO member_channel_consents (fk_member_id, channel, consented, changed_at_utc, source)
            VALUES (@memberId, @channel, @consented, @now, @source)
            ON DUPLICATE KEY UPDATE consented = VALUES(consented), changed_at_utc = VALUES(changed_at_utc), source = VALUES(source)",
            new { memberId, channel, consented, now = DateTime.UtcNow, source });
    }

    // ── Unsubscribe token: "{memberId}.{HMAC}", no expiry so old emails keep working ──────────

    public static string UnsubscribeToken(int memberId, string secret)
    {
        var sig = HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes($"row-unsubscribe:v1:{memberId}"));
        return $"{memberId}.{System.Buffers.Text.Base64Url.EncodeToString(sig)}";
    }

    /// <summary>The member the token was issued for, or null when it is malformed or not signed by this server.</summary>
    public int? UnsubscribeMember(string? token)
    {
        var secret = _config["JwtSettings:Secret"] ?? "";
        var dot = token?.IndexOf('.') ?? -1;
        if (secret.Length < 32 || dot <= 0 || token!.Length > 80 || !int.TryParse(token[..dot], out var memberId) || memberId <= 0) return null;
        var expected = Encoding.ASCII.GetBytes(UnsubscribeToken(memberId, secret));
        return CryptographicOperations.FixedTimeEquals(expected, Encoding.ASCII.GetBytes(token)) ? memberId : null;
    }

    public async Task<UnsubscribeInfoDto?> GetUnsubscribeInfoAsync(int memberId)
    {
        await using var conn = Conn();
        var email = await conn.QueryFirstOrDefaultAsync<string>(@"
            SELECT COALESCE(EmailId, '') FROM member_master_profile WHERE pk_member_master_profile_id = @memberId AND isdeleted = 0", new { memberId });
        if (email == null) return null;
        var consented = await conn.ExecuteScalarAsync<bool?>(
            "SELECT consented FROM member_channel_consents WHERE fk_member_id = @memberId AND channel = 'email'", new { memberId });
        return new UnsubscribeInfoDto { MaskedEmail = Mask(email), Subscribed = consented ?? true };
    }

    // "j***@example.org": enough to recognise the address on a forwarded link, not enough to harvest it.
    private static string Mask(string? email)
    {
        var e = email?.Trim() ?? "";
        var at = e.IndexOf('@');
        return at <= 0 ? "" : e[0] + "***" + e[at..];
    }

    // ── Brevo webhook ────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// One Brevo transactional event. Brevo gives no event id, so the key is a hash of the fields that make an event
    /// unique; a retried delivery has the same key and is ignored. The claim and its effects commit together.
    /// </summary>
    public async Task<string> ProcessBrevoEventAsync(JsonElement e)
    {
        if (e.ValueKind != JsonValueKind.Object) return "ignored";
        string S(string name) => e.TryGetProperty(name, out var v)
            ? v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : v.ValueKind == JsonValueKind.Number ? v.GetRawText() : ""
            : "";
        var evt = S("event").Trim().ToLowerInvariant();
        var messageId = S("message-id").Trim();
        var email = S("email").Trim().ToLowerInvariant();
        if (evt.Length is 0 or > 30 || messageId.Length > 200 || email.Length > 254) return "ignored";
        var key = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
            string.Join("\n", evt, messageId, email, S("ts_epoch"), S("ts_event"), S("link"))))).ToLowerInvariant();
        var when = long.TryParse(S("ts_epoch"), out var ms) && ms > 0 ? DateTimeOffset.FromUnixTimeMilliseconds(ms).UtcDateTime
            : long.TryParse(S("ts_event"), out var sec) && sec > 0 ? DateTimeOffset.FromUnixTimeSeconds(sec).UtcDateTime
            : DateTime.UtcNow;

        await using var conn = Conn();
        await conn.OpenAsync();
        await using var tx = await conn.BeginTransactionAsync();
        // shortcut: comm_webhook_events is never pruned; delete rows older than Brevo's retry window (days) once it grows.
        if (await conn.ExecuteAsync("INSERT IGNORE INTO comm_webhook_events (event_key, event, message_id) VALUES (@key, @evt, @messageId)",
                new { key, evt, messageId }, tx) == 0)
            return "duplicate";

        var p = new { messageId, when };
        var update = evt switch
        {
            "delivered" => "DeliveryStatus = COALESCE(DeliveryStatus, 'Delivered'), DeliveredAt = COALESCE(DeliveredAt, @when)",
            "opened" or "unique_opened" or "proxy_open" =>
                "OpenCount = OpenCount + 1, OpenedAt = COALESCE(OpenedAt, @when), DeliveryStatus = COALESCE(DeliveryStatus, 'Delivered')",
            "click" => "ClickCount = ClickCount + 1, ClickedAt = COALESCE(ClickedAt, @when), DeliveryStatus = COALESCE(DeliveryStatus, 'Delivered')",
            "hard_bounce" or "invalid_email" or "blocked" or "error" => "DeliveryStatus = IF(DeliveryStatus = 'Complaint', DeliveryStatus, 'Bounced')",
            "soft_bounce" or "deferred" => "DeliveryStatus = COALESCE(DeliveryStatus, 'Deferred')",
            "spam" => "DeliveryStatus = 'Complaint'",
            _ => null,
        };
        if (update != null && messageId.Length > 0)
            await conn.ExecuteAsync($"UPDATE club_mass_email_recipients SET {update} WHERE MessageId = @messageId", p, tx);

        var reason = evt switch
        {
            "hard_bounce" => "hard_bounce", "invalid_email" => "invalid", "blocked" => "blocked",
            "spam" => "complaint", "unsubscribed" => "unsubscribed", _ => null,
        };
        if (reason != null && email.Length > 0)
        {
            // The tenant that sent it: the campaign, else the email log row, else the platform (0, 0).
            var owner = messageId.Length == 0 ? null : await conn.QueryFirstOrDefaultAsync<SenderRow>(@"
                SELECT me.fk_club_id AS ClubId, me.fk_district_id AS DistrictId
                FROM club_mass_email_recipients r JOIN club_mass_emails me ON me.pk_mass_email_id = r.fk_mass_email_id
                WHERE r.MessageId = @messageId LIMIT 1", p, tx)
                ?? await conn.QueryFirstOrDefaultAsync<SenderRow>(
                    "SELECT fk_club_id AS ClubId, fk_district_id AS DistrictId FROM email_log WHERE brevo_message_id = @messageId LIMIT 1", p, tx);
            var club = owner?.ClubId ?? 0;
            var district = club > 0 ? 0 : owner?.DistrictId ?? 0;
            await conn.ExecuteAsync(@"
                INSERT IGNORE INTO comm_suppressions (fk_club_id, fk_district_id, email, reason) VALUES (@club, @district, @email, @reason)",
                new { club, district, email, reason }, tx);
        }
        await tx.CommitAsync();
        return "processed";
    }

    private sealed class SenderRow
    {
        public int? ClubId { get; set; }
        public int? DistrictId { get; set; }
    }
}
