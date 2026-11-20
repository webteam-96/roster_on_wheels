using System.Globalization;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// Profile update requests and the years-of-service / anniversaries report (competitor gaps #3 and #4).
///
/// A club admin asks chosen members (or every member with an incomplete profile) to check their profile. Each member
/// gets an email with a personal link to a small public form (/public/profile-update/{token}: no sign-in, because
/// ordinary members cannot sign in to the web portal) and an item in the app's bell that opens their own profile
/// editor. The request counts as done when the member saves the form, confirms nothing changed, or saves their own
/// profile in the app or portal (MembersController.Update calls <see cref="MarkProfileSavedAsync"/>).
/// The link never changes login details (primary mobile, primary email): those stay with the app and the club admin.
/// </summary>
public class ProfileUpdateService
{
    public const int LinkDays = 30;
    public const int MaxMembersPerSend = 500;
    public const int MessageMax = 1000;

    private readonly string _connectionString;
    private readonly IEmailService _email;
    private readonly IConfiguration _config;

    public ProfileUpdateService(IConfiguration config, IEmailService email)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("DefaultConnection missing");
        _email = email;
        _config = config;
    }

    // ── Pure helpers (unit-tested in api.Tests/ProfileUpdateTests.cs) ──

    /// <summary>The profile fields a complete profile has. Keys are what the API returns in "missing".</summary>
    public static string[] Missing(string? photo, string? email, string? mobile, DateTime? birthDate, string? classification)
    {
        var missing = new List<string>();
        if (string.IsNullOrWhiteSpace(photo)) missing.Add("photo");
        if (string.IsNullOrWhiteSpace(email)) missing.Add("email");
        if (string.IsNullOrWhiteSpace(mobile)) missing.Add("mobile");
        if (birthDate == null || birthDate.Value.Year < 1900) missing.Add("birthDate");
        if (string.IsNullOrWhiteSpace(classification)) missing.Add("classification");
        return missing.ToArray();
    }

    /// <summary>A new link token (sent once, in the email) and the hash stored for it.</summary>
    public static (string Token, string Hash) NewToken()
    {
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        return (token, HashToken(token));
    }

    public static string HashToken(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))).ToLowerInvariant();

    /// <summary>A token as sent: 43 URL-safe base64 characters. Anything else is refused before a lookup.</summary>
    public static bool LooksLikeToken(string? token) => token != null && Regex.IsMatch(token, "^[A-Za-z0-9_-]{43}$");

    /// <summary>pending, updated or expired, for a request row.</summary>
    public static string Status(DateTime? completedAt, DateTime expiresAt, DateTime utcNow) =>
        completedAt != null ? "updated" : expiresAt <= utcNow ? "expired" : "pending";

    /// <summary>Milestone years of membership: every fifth year, plus the district's own engagement milestone years.</summary>
    public static bool IsMilestone(int years, IReadOnlyCollection<int> districtYears) =>
        years > 0 && (years % 5 == 0 || districtYears.Contains(years));

    /// <summary>Whole years from joined to asOf (a member who joined on 29 Feb counts the year on 28 Feb).</summary>
    public static int YearsBetween(DateTime joined, DateTime asOf)
    {
        var years = asOf.Year - joined.Year;
        var anniversary = SafeDate(asOf.Year, joined.Month, joined.Day);
        if (asOf.Date < anniversary) years--;
        return Math.Max(0, years);
    }

    public static DateTime SafeDate(int year, int month, int day) => new(year, month, Math.Min(day, DateTime.DaysInMonth(year, month)));

    public sealed class ReportInput
    {
        public int MemberId { get; set; }
        public string MemberName { get; set; } = "";
        public DateTime? JoinedDate { get; set; }
        public DateTime? BirthDate { get; set; }
        public DateTime? AnniversaryDate { get; set; }
        public bool ShowPersonal { get; set; } = true;
    }

    public sealed record ReportRow(int MemberId, string MemberName, string? JoinedDate, int? YearsOfService,
        int? JoinAnniversaryDay, int? AnniversaryYears, bool Milestone, int? BirthdayDay, int? WeddingAnniversaryDay);

    /// <summary>
    /// One row per member for the month: years of service today (club's local date), the joining anniversary in this
    /// month and the years it completes, milestone, and birthday / wedding anniversary day in this month (day only:
    /// birth years are often a 1900 placeholder). Hidden personal dates (ShowPersonal false) are left out.
    /// </summary>
    public static List<ReportRow> BuildReport(IEnumerable<ReportInput> members, int year, int month, DateTime today,
        IReadOnlyCollection<int> districtYears)
    {
        var rows = new List<ReportRow>();
        foreach (var m in members)
        {
            int? years = null, annDay = null, annYears = null;
            var milestone = false;
            if (m.JoinedDate is DateTime j && j.Year >= 1900 && j.Date <= today.Date)
            {
                years = YearsBetween(j, today);
                if (j.Month == month && year > j.Year)
                {
                    annDay = SafeDate(year, month, j.Day).Day;
                    annYears = year - j.Year;
                    milestone = IsMilestone(annYears.Value, districtYears);
                }
            }
            int? bDay = m.ShowPersonal && m.BirthDate is DateTime b && b.Year >= 1900 && b.Month == month ? SafeDate(year, month, b.Day).Day : null;
            int? wDay = m.ShowPersonal && m.AnniversaryDate is DateTime w && w.Year >= 1900 && w.Month == month ? SafeDate(year, month, w.Day).Day : null;
            rows.Add(new ReportRow(m.MemberId, m.MemberName,
                m.JoinedDate is DateTime jd && jd.Year >= 1900 ? jd.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : null,
                years, annDay, annYears, milestone, bDay, wDay));
        }
        return rows.OrderByDescending(r => r.YearsOfService ?? -1).ThenBy(r => r.MemberName, StringComparer.OrdinalIgnoreCase).ToList();
    }

    /// <summary>One CSV cell: quoted, and a leading = + - @ (or tab / CR) is neutralised so a spreadsheet never runs it.</summary>
    public static string CsvCell(object? value)
    {
        var s = Convert.ToString(value, CultureInfo.InvariantCulture) ?? "";
        if (s.Length > 0 && "=+-@\t\r".Contains(s[0])) s = "'" + s;
        return "\"" + s.Replace("\"", "\"\"") + "\"";
    }

    public static string ReportCsv(IEnumerable<ReportRow> rows)
    {
        var sb = new StringBuilder();
        sb.Append("Member,Joined,Years of service,Joining anniversary day,Years completed,Milestone,Birthday day,Wedding anniversary day\r\n");
        foreach (var r in rows)
            sb.Append(string.Join(",", new object?[]
            {
                r.MemberName, r.JoinedDate, r.YearsOfService, r.JoinAnniversaryDay, r.AnniversaryYears,
                r.Milestone ? "Yes" : "", r.BirthdayDay, r.WeddingAnniversaryDay,
            }.Select(CsvCell))).Append("\r\n");
        return sb.ToString();
    }

    // ── Club admin: candidates, send, history ──

    public sealed class CandidateRow
    {
        public int MemberId { get; set; }
        public string MemberName { get; set; } = "";
        public string? EmailId { get; set; }
        public string? ProfilePhotoPath { get; set; }
        public string? PrimaryMobileNumber { get; set; }
        public DateTime? BirthDate { get; set; }
        public string? ClassificationProfession { get; set; }
        public DateTime? LastRequestedAt { get; set; }
        public DateTime? LastExpiresAt { get; set; }
        public DateTime? LastCompletedAt { get; set; }
    }

    private const string ClubMembersFrom = @"
        FROM club_members cm
        JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0";
    private const string ClubMembersWhere = @"
        WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND IFNULL(cm.isdeleted, 0) = 0";
    private const string ActiveClubMembers = ClubMembersFrom + ClubMembersWhere;

    public async Task<List<object>> CandidatesAsync(int clubId)
    {
        await using var conn = new MySqlConnection(_connectionString);
        var rows = await conn.QueryAsync<CandidateRow>($@"
            SELECT m.pk_member_master_profile_id AS MemberId, m.MemberName, m.EmailId, m.ProfilePhotoPath,
                   m.PrimaryMobileNumber, m.BirthDate, MAX(cm.ClassificationProfession) AS ClassificationProfession,
                   r.requested_at AS LastRequestedAt, r.expires_at AS LastExpiresAt, r.completed_at AS LastCompletedAt
            {ClubMembersFrom}
            LEFT JOIN profile_update_requests r ON r.pk_request_id = (
                SELECT MAX(r2.pk_request_id) FROM profile_update_requests r2
                WHERE r2.fk_club_id = @ClubId AND r2.fk_member_id = m.pk_member_master_profile_id)
            {ClubMembersWhere}
            GROUP BY m.pk_member_master_profile_id, m.MemberName, m.EmailId, m.ProfilePhotoPath, m.PrimaryMobileNumber,
                     m.BirthDate, r.requested_at, r.expires_at, r.completed_at
            ORDER BY m.MemberName", new { ClubId = clubId });
        var now = DateTime.UtcNow;
        return rows.Select(r => (object)new
        {
            memberId = r.MemberId,
            memberName = r.MemberName,
            hasEmail = !string.IsNullOrWhiteSpace(r.EmailId),
            missing = Missing(r.ProfilePhotoPath, r.EmailId, r.PrimaryMobileNumber, r.BirthDate, r.ClassificationProfession),
            lastRequestedAt = r.LastRequestedAt is DateTime d ? DateTime.SpecifyKind(d, DateTimeKind.Utc) : (DateTime?)null,
            lastStatus = r.LastRequestedAt == null ? null : Status(r.LastCompletedAt, r.LastExpiresAt!.Value, now),
        }).ToList();
    }

    public sealed record SendResult(int Requested, int Emailed, int NoEmail, int Skipped);

    /// <summary>
    /// Creates one request per chosen active member of the club (memberIds), or for every active member whose
    /// profile is incomplete (incompleteOnly). Members outside the club are skipped. An older open request of the
    /// same member and club is closed. Email goes to members with an address; every member gets the in-app item.
    /// </summary>
    public async Task<SendResult> SendAsync(int clubId, int callerId, IReadOnlyCollection<int>? memberIds, bool incompleteOnly, string? message)
    {
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        var members = (await conn.QueryAsync<CandidateRow>($@"
            SELECT m.pk_member_master_profile_id AS MemberId, m.MemberName, m.EmailId, m.ProfilePhotoPath,
                   m.PrimaryMobileNumber, m.BirthDate, MAX(cm.ClassificationProfession) AS ClassificationProfession
            {ActiveClubMembers}
            GROUP BY m.pk_member_master_profile_id, m.MemberName, m.EmailId, m.ProfilePhotoPath, m.PrimaryMobileNumber, m.BirthDate",
            new { ClubId = clubId })).ToList();

        var chosen = incompleteOnly
            ? members.Where(m => Missing(m.ProfilePhotoPath, m.EmailId, m.PrimaryMobileNumber, m.BirthDate, m.ClassificationProfession).Length > 0).ToList()
            : members.Where(m => memberIds!.Contains(m.MemberId)).ToList();
        var skipped = incompleteOnly ? 0 : memberIds!.Distinct().Count() - chosen.Count;

        var club = await conn.QueryFirstAsync<(string ClubName, int DistrictId)>(
            "SELECT ClubName, fk_district_id FROM club_master WHERE pk_club_id = @ClubId", new { ClubId = clubId });
        var frontend = (_config["FrontendUrl"] ?? Brand.PortalOrigin).TrimEnd('/');
        int emailed = 0, noEmail = 0;
        var now = DateTime.UtcNow;
        foreach (var m in chosen)
        {
            var (token, hash) = NewToken();
            var hasEmail = !string.IsNullOrWhiteSpace(m.EmailId);
            await conn.ExecuteAsync(@"
                UPDATE profile_update_requests SET expires_at = @Now
                WHERE fk_club_id = @ClubId AND fk_member_id = @MemberId AND completed_at IS NULL AND expires_at > @Now;
                INSERT INTO profile_update_requests
                    (fk_club_id, fk_member_id, token_hash, message, requested_by, requested_at, expires_at, email_status)
                VALUES (@ClubId, @MemberId, @Hash, @Message, @By, @Now, @Expires, @Status)",
                new { ClubId = clubId, m.MemberId, Hash = hash, Message = message, By = callerId, Now = now,
                      Expires = now.AddDays(LinkDays), Status = hasEmail ? "emailed" : "no_email" });
            if (!hasEmail) { noEmail++; continue; }
            await SendEmailAsync(conn, m, club.ClubName, clubId, club.DistrictId, message, $"{frontend}/public/profile-update/{token}");
            emailed++;
        }
        return new SendResult(chosen.Count, emailed, noEmail, skipped);
    }

    private async Task SendEmailAsync(MySqlConnection conn, CandidateRow m, string clubName, int clubId, int districtId, string? message, string link)
    {
        // The fixed wording in the member's language (their own, else their club's), like the milestone email.
        using var culture = Localization.MessageCulture.Use(await Localization.MessageCulture.ForMemberAsync(conn, m.MemberId));
        var L = Localization.DbStringLocalizer.Instance;
        static string H(string s) => WebUtility.HtmlEncode(s).Replace("\r\n", "\n").Replace("\n", "<br/>");
        var note = string.IsNullOrWhiteSpace(message) ? "" : $"<p>{H(message)}</p>";
        var html = $@"{EmailService.EMAIL_HEADER}
                        <h2 style='color: #17458F; margin-top: 0;'>{H(L["Please check your member profile"])}</h2>
                        <p>{H(L["Dear {0},", m.MemberName])}</p>
                        <p>{H(L["{0} is updating its member records. Please take a minute to check your details and correct anything that has changed.", clubName])}</p>
                        {note}
                        <p><a href=""{H(link)}"" style='display:inline-block;background:#17458F;color:#ffffff;padding:10px 18px;text-decoration:none;'>{H(L["Review my profile"])}</a></p>
                        <p style='font-size:12px;color:#555;'>{H(L["This link is personal to you and works for {0} days. You can also update your profile in the app.", LinkDays])}</p>
            {EmailService.EMAIL_FOOTER}";
        await _email.SendScopedEmailAsync(m.EmailId!, L["Please check your member profile"], html, clubId, districtId);
    }

    public sealed class RequestRow
    {
        public int Id { get; set; }
        public int MemberId { get; set; }
        public string MemberName { get; set; } = "";
        public string? RequestedByName { get; set; }
        public DateTime RequestedAt { get; set; }
        public DateTime ExpiresAt { get; set; }
        public string EmailStatus { get; set; } = "";
        public DateTime? CompletedAt { get; set; }
        public string? CompletedVia { get; set; }
    }

    public async Task<List<object>> RequestsAsync(int clubId)
    {
        await using var conn = new MySqlConnection(_connectionString);
        // shortcut: newest 500 requests only, no paging; page it when a club's history outgrows that.
        var rows = await conn.QueryAsync<RequestRow>(@"
            SELECT r.pk_request_id AS Id, r.fk_member_id AS MemberId, COALESCE(m.MemberName, '') AS MemberName,
                   rb.MemberName AS RequestedByName, r.requested_at AS RequestedAt, r.expires_at AS ExpiresAt,
                   r.email_status AS EmailStatus, r.completed_at AS CompletedAt, r.completed_via AS CompletedVia
            FROM profile_update_requests r
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = r.fk_member_id AND m.isdeleted = 0
            LEFT JOIN member_master_profile rb ON rb.pk_member_master_profile_id = r.requested_by
            WHERE r.fk_club_id = @ClubId
            ORDER BY r.requested_at DESC, r.pk_request_id DESC LIMIT 500", new { ClubId = clubId });
        var now = DateTime.UtcNow;
        static DateTime? Utc(DateTime? d) => d is DateTime v ? DateTime.SpecifyKind(v, DateTimeKind.Utc) : null;
        return rows.Select(r => (object)new
        {
            id = r.Id,
            memberId = r.MemberId,
            memberName = r.MemberName,
            requestedByName = r.RequestedByName,
            requestedAt = Utc(r.RequestedAt),
            expiresAt = Utc(r.ExpiresAt),
            emailStatus = r.EmailStatus,
            completedAt = Utc(r.CompletedAt),
            completedVia = r.CompletedVia,
            status = Status(r.CompletedAt, r.ExpiresAt, now),
        }).ToList();
    }

    /// <summary>The member saved their own profile (app or portal): every open request of theirs is done.</summary>
    public static async Task MarkProfileSavedAsync(string connectionString, int memberId)
    {
        await using var conn = new MySqlConnection(connectionString);
        await conn.ExecuteAsync(@"
            UPDATE profile_update_requests SET completed_at = UTC_TIMESTAMP(), completed_via = 'profile'
            WHERE fk_member_id = @MemberId AND completed_at IS NULL AND expires_at > UTC_TIMESTAMP()",
            new { MemberId = memberId });
    }

    // ── The member's emailed link (public, token only) ──

    public sealed class LinkRow
    {
        public int Id { get; set; }
        public int ClubId { get; set; }
        public int MemberId { get; set; }
        public string ClubName { get; set; } = "";
        public string MemberName { get; set; } = "";
        public string? EmailId { get; set; }
        public string? PrimaryMobileNumber { get; set; }
        public string? SecondaryEmailId { get; set; }
        public string? SecondaryMobileNumber { get; set; }
        public DateTime? BirthDate { get; set; }
        public DateTime? AnniversaryDate { get; set; }
        public string? MemberIntroduction { get; set; }
        public string? LinkedIn { get; set; }
        public string? Website { get; set; }
        public string? ClassificationProfession { get; set; }
        public DateTime? CompletedAt { get; set; }
    }

    /// <summary>The open request for a link token, with the member's current details; null when unknown or expired.</summary>
    public async Task<LinkRow?> LinkAsync(string token)
    {
        if (!LooksLikeToken(token)) return null;
        await using var conn = new MySqlConnection(_connectionString);
        return await conn.QueryFirstOrDefaultAsync<LinkRow>(@"
            SELECT r.pk_request_id AS Id, r.fk_club_id AS ClubId, r.fk_member_id AS MemberId, c.ClubName, m.MemberName,
                   m.EmailId, m.PrimaryMobileNumber, m.SecondaryEmailId, m.SecondaryMobileNumber, m.BirthDate,
                   m.AnniversaryDate, m.MemberIntroduction, m.LinkedIn, m.Website, cm.ClassificationProfession,
                   r.completed_at AS CompletedAt
            FROM profile_update_requests r
            JOIN member_master_profile m ON m.pk_member_master_profile_id = r.fk_member_id AND m.isdeleted = 0
            JOIN club_master c ON c.pk_club_id = r.fk_club_id
            JOIN club_members cm ON cm.fk_club_id = r.fk_club_id AND cm.fk_member_master_profile_id = r.fk_member_id
                                AND cm.IsActive = 1 AND IFNULL(cm.isdeleted, 0) = 0
            WHERE r.token_hash = @Hash AND r.expires_at > UTC_TIMESTAMP()
            LIMIT 1", new { Hash = HashToken(token) });
    }

    public sealed class LinkUpdate
    {
        public bool ConfirmOnly { get; set; }
        public string? SecondaryEmailId { get; set; }
        public string? SecondaryMobileNumber { get; set; }
        public DateTime? BirthDate { get; set; }
        public DateTime? AnniversaryDate { get; set; }
        public string? MemberIntroduction { get; set; }
        public string? LinkedIn { get; set; }
        public string? Website { get; set; }
        public string? ClassificationProfession { get; set; }
    }

    private static readonly Regex EmailRe = new(@"^[^@\s]+@[^@\s]+\.[^@\s]+$", RegexOptions.Compiled);
    private static readonly Regex PhoneRe = new(@"^\+?[0-9 ()-]{6,20}$", RegexOptions.Compiled);

    /// <summary>Trims the form and returns the first problem in it, or null when it is fine.</summary>
    public static string? Validate(LinkUpdate u, DateTime utcToday)
    {
        static string? T(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
        u.SecondaryEmailId = T(u.SecondaryEmailId);
        u.SecondaryMobileNumber = T(u.SecondaryMobileNumber);
        u.MemberIntroduction = T(u.MemberIntroduction);
        u.LinkedIn = T(u.LinkedIn);
        u.Website = T(u.Website);
        u.ClassificationProfession = T(u.ClassificationProfession);
        if (u.ConfirmOnly) return null;
        if (u.SecondaryEmailId != null && (u.SecondaryEmailId.Length > 150 || !EmailRe.IsMatch(u.SecondaryEmailId)))
            return "The other email address is not valid.";
        if (u.SecondaryMobileNumber != null && !PhoneRe.IsMatch(u.SecondaryMobileNumber))
            return "The other mobile number is not valid.";
        foreach (var (d, label) in new[] { (u.BirthDate, "birth date"), (u.AnniversaryDate, "wedding anniversary") })
            if (d is DateTime v && (v.Year < 1900 || v.Date > utcToday.Date.AddDays(1)))
                return $"The {label} is not a valid date.";
        if (u.MemberIntroduction?.Length > 2000) return "The introduction can be at most 2000 characters.";
        if (u.ClassificationProfession?.Length > 200) return "The classification can be at most 200 characters.";
        foreach (var (url, label) in new[] { (u.LinkedIn, "LinkedIn"), (u.Website, "website") })
            if (url != null && (url.Length > 300 || !Uri.TryCreate(url, UriKind.Absolute, out var uri) || (uri.Scheme != "https" && uri.Scheme != "http")))
                return $"The {label} address must start with https://.";
        return null;
    }

    /// <summary>Saves the link's form (or only confirms) and marks the request done. Returns false when the link is gone.</summary>
    public async Task<bool> SaveLinkAsync(string token, LinkUpdate u)
    {
        var link = await LinkAsync(token);
        if (link == null) return false;
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        await using var tx = await conn.BeginTransactionAsync();
        if (!u.ConfirmOnly)
        {
            await conn.ExecuteAsync(@"
                UPDATE member_master_profile SET SecondaryEmailId = @SecondaryEmailId,
                       SecondaryMobileNumber = @SecondaryMobileNumber, BirthDate = @BirthDate, AnniversaryDate = @AnniversaryDate,
                       MemberIntroduction = @MemberIntroduction, LinkedIn = @LinkedIn, Website = @Website,
                       modified_by = @MemberId, modified_date = NOW()
                WHERE pk_member_master_profile_id = @MemberId AND isdeleted = 0",
                new { u.SecondaryEmailId, u.SecondaryMobileNumber, BirthDate = u.BirthDate?.Date, AnniversaryDate = u.AnniversaryDate?.Date,
                      u.MemberIntroduction, u.LinkedIn, u.Website, link.MemberId }, tx);
            await conn.ExecuteAsync(@"
                UPDATE club_members SET ClassificationProfession = @Classification, modified_by = @MemberId, modified_date = NOW()
                WHERE fk_club_id = @ClubId AND fk_member_master_profile_id = @MemberId AND IsActive = 1 AND IFNULL(isdeleted, 0) = 0",
                new { Classification = u.ClassificationProfession, link.ClubId, link.MemberId }, tx);
        }
        // The first save closes the request; saving again within the link's life only updates the profile.
        await conn.ExecuteAsync(@"
            UPDATE profile_update_requests SET completed_at = UTC_TIMESTAMP(), completed_via = @Via
            WHERE pk_request_id = @Id AND completed_at IS NULL",
            new { link.Id, Via = u.ConfirmOnly ? "confirm" : "link" }, tx);
        await tx.CommitAsync();
        return true;
    }

    // ── Years of service and anniversaries ──

    /// <summary>The report for a club and month. showAllPersonal: the viewer manages the club (sees hidden birthdays).</summary>
    public async Task<(string ClubName, List<ReportRow> Rows, int Year, int Month, DateTime Today)> ReportAsync(
        int clubId, int? year, int? month, int viewerId, bool showAllPersonal)
    {
        await using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        var club = await conn.QueryFirstAsync<(string ClubName, int DistrictId)>(
            "SELECT ClubName, fk_district_id FROM club_master WHERE pk_club_id = @ClubId", new { ClubId = clubId });
        var today = ZoneTime.Local(await ZoneTime.OfClubAsync(conn, clubId)).Date;
        int y = year ?? today.Year, mo = month ?? today.Month;
        var settings = await conn.QueryFirstOrDefaultAsync<string?>(
            "SELECT milestone_years FROM engagement_district_settings WHERE fk_district_id = @D", new { D = club.DistrictId });
        var districtYears = EngagementService.ParseYears(settings) ?? Array.Empty<int>();
        var members = await conn.QueryAsync<ReportInput>($@"
            SELECT m.pk_member_master_profile_id AS MemberId, m.MemberName, MIN(cm.JoinedDate) AS JoinedDate,
                   m.BirthDate, m.AnniversaryDate,
                   CASE WHEN @All = 1 OR m.pk_member_master_profile_id = @Viewer OR IFNULL(m.IsPersonalDetailsVisible, 1) = 1
                        THEN 1 ELSE 0 END AS ShowPersonal
            {ActiveClubMembers}
            GROUP BY m.pk_member_master_profile_id, m.MemberName, m.BirthDate, m.AnniversaryDate, m.IsPersonalDetailsVisible",
            new { ClubId = clubId, All = showAllPersonal ? 1 : 0, Viewer = viewerId });
        return (club.ClubName, BuildReport(members, y, mo, today, districtYears), y, mo, today);
    }
}
