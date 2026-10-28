using Dapper;
using Microsoft.AspNetCore.Hosting;
using MySqlConnector;

namespace RotaryApi.Services;

public interface ICmrSubmissionMailer
{
    // Build the detailed PDF and email it to DG + AG + Club President + Club Secretary.
    // Best-effort: any failure is logged, never thrown (runs in the background after submit).
    Task SendSubmissionEmailsAsync(int clubId, int reportId, int requestedBy);
}

public class CmrSubmissionMailer : ICmrSubmissionMailer
{
    private readonly string _conn;
    private readonly string? _mediaRedirectBase;
    private readonly string _mediaBaseForLinks;
    private readonly string? _emailOverride;
    private readonly IEmailService _email;
    private readonly IClubMonthlyReportService _cmr;
    private readonly IDistrictCmrEmailSettingsService _districtSettings;
    private readonly IWebHostEnvironment _env;
    private readonly ILogger<CmrSubmissionMailer> _logger;
    private readonly bool _suppressLocalDev;

    public CmrSubmissionMailer(IConfiguration config, IEmailService email, IClubMonthlyReportService cmr,
        IDistrictCmrEmailSettingsService districtSettings,
        IWebHostEnvironment env, ILogger<CmrSubmissionMailer> logger)
    {
        _conn = config.GetConnectionString("DefaultConnection")!;
        // Safe local testing: the production server connects to the DB as Server=localhost, while a
        // developer machine points at a REMOTE DB host. So a non-localhost DB host ⇒ we're running
        // locally ⇒ do NOT actually email real CP/CS/AG/DG. Never fires on the server (localhost).
        _suppressLocalDev = IsRemoteDb(_conn);
        _mediaRedirectBase = config["Media:RedirectBaseUrl"];
        // Absolute base for Agenda/MoM links: media host if set, else the public API base.
        _mediaBaseForLinks = !string.IsNullOrWhiteSpace(_mediaRedirectBase)
            ? _mediaRedirectBase!
            : (config["Api:BaseUrl"] ?? "");
        _emailOverride = config["Cmr:SubmissionEmailOverride"];   // dev-only test redirect
        _email = email;
        _cmr = cmr;
        _districtSettings = districtSettings;
        _env = env;
        _logger = logger;
    }

    public async Task SendSubmissionEmailsAsync(int clubId, int reportId, int requestedBy)
    {
        // Local-dev guard (option b): suppress real emails when running against a remote DB so
        // testing "upload to district" locally never spams real Rotarians. The freeze snapshot is
        // still captured (in UploadToDistrictAsync), so the behavior under test is fully verifiable.
        if (_suppressLocalDev)
        {
            _logger.LogWarning("CMR submission email SUPPRESSED — local dev (API connected to a remote DB, not localhost). club {Club}, report {Report}.", clubId, reportId);
            return;
        }

        try
        {
            await using var conn = new MySqlConnection(_conn);
            await conn.OpenAsync();

            var rpt = await conn.QueryFirstOrDefaultAsync<(int YearId, int Month)?>(
                "SELECT fk_year_id AS YearId, ReportMonth AS Month FROM club_monthly_reports WHERE pk_report_id = @Id AND isdeleted = 0",
                new { Id = reportId });
            if (rpt == null) { _logger.LogWarning("CMR submission email: report {Id} not found.", reportId); return; }
            int yearId = rpt.Value.YearId, month = rpt.Value.Month;

            // District admin's per-(district, year) CMR email settings, applied to EVERY club in
            // that district: Yes/No for emailing the District Governor + always-CC extra addresses.
            int districtId = await conn.QueryFirstOrDefaultAsync<int>(
                "SELECT fk_district_id FROM club_master WHERE pk_club_id = @Id", new { Id = clubId });
            var (sendToDG, extraCc) = await _districtSettings.ResolveAsync(conn, districtId, yearId);

            var recipients = await ResolveRecipientsAsync(conn, clubId, yearId, reportId, sendToDG, extraCc);
            bool overridden = !string.IsNullOrWhiteSpace(_emailOverride);
            if (!overridden && recipients.Count == 0)
            {
                _logger.LogWarning("CMR submission email: no recipients (DG/AG/President/Secretary) with an email for club {Club}, report {Report}.", clubId, reportId);
                return;
            }

            var summary = await _cmr.GetPreviewAsync(clubId, yearId, month, requestedBy);
            var items = await _cmr.GetWordProjectsForMonthAsync(clubId, yearId, month);
            foreach (var it in items)
                foreach (var ph in it.Photos)
                    await CmrMediaLoader.LoadAsync(_env, _mediaRedirectBase, ph);

            // S5: one email to all the officers, so the report and the email are in the club's language
            using var culture = RotaryApi.Services.Localization.MessageCulture.Use(await CommsTemplates.DefaultLanguageAsync(conn, clubId, 0));
            var L = RotaryApi.Services.Localization.DbStringLocalizer.Instance;
            var pdf = ClubMonthlyReportPdfBuilder.Build(summary, items, _mediaBaseForLinks);

            // Brevo rejects any message over 20 MB. Base64 inflates the attachment by ~37%, so the
            // raw PDF must stay under ~13 MB. If the photo-rich build is still too big (even after
            // compression), fall back to a TEXT-ONLY PDF (full report, images omitted) so the
            // submission e-mail is delivered instead of failing outright.
            const int MaxAttachmentBytes = 13 * 1024 * 1024;
            bool photosDropped = false;
            if (pdf.Length > MaxAttachmentBytes)
            {
                var textOnly = ClubMonthlyReportPdfBuilder.Build(summary, items, _mediaBaseForLinks, includePhotos: false);
                _logger.LogWarning("CMR PDF {Size} bytes exceeded {Max} for report {Report}; sending text-only (photos omitted). Text-only size {TextSize} bytes.",
                    pdf.Length, MaxAttachmentBytes, reportId, textOnly.Length);
                pdf = textOnly;
                photosDropped = true;
            }

            var fileName = $"{summary.ClubName}_Monthly_Report_{summary.MonthName}_{summary.YearLabel}.pdf"
                .Replace(" ", "_").Replace("/", "-");

            string subject = L["Club Monthly Report Submitted — {0} — {1} {2}", summary.ClubName, summary.MonthName, summary.YearLabel];
            var body = BuildBody(summary, recipients, overridden ? _emailOverride : null, photosDropped);

            // Dev override: redirect the whole thing to one test address (no CC to real officers).
            string to = overridden ? _emailOverride! : recipients[0].Email;
            var cc = overridden ? new List<string>() : recipients.Skip(1).Select(r => r.Email).ToList();
            // explicit type: the email log's subject guess only knows English wording
            await _email.SendScopedEmailWithAttachmentAsync(to, subject, body, pdf, fileName, cc, clubId, districtId, "Monthly Report");

            _logger.LogInformation("CMR submission email sent for report {Report} (to={To}{Mode}). Real recipients: {Recipients}",
                reportId, LogMask.Email(to), overridden ? " [TEST OVERRIDE]" : "",
                string.Join(", ", recipients.Select(r => $"{r.Role}:{LogMask.Email(r.Email)}")));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "CMR submission email failed for club {Club}, report {Report}.", clubId, reportId);
        }
    }

    // True when the DB host is NOT localhost — i.e. a developer machine pointing at the remote DB.
    private static bool IsRemoteDb(string connectionString)
    {
        try
        {
            var server = (new MySqlConnectionStringBuilder(connectionString).Server ?? "").Trim().ToLowerInvariant();
            return server.Length > 0 && server != "localhost" && server != "127.0.0.1" && server != "::1";
        }
        catch { return false; }   // can't parse → assume production (send) rather than silently drop mail
    }

    private static async Task<List<(string Name, string Email, string Role)>> ResolveRecipientsAsync(
        MySqlConnection conn, int clubId, int yearId, int reportId,
        bool sendToDistrictGovernor, List<string> extraCcEmails)
    {
        var ordered = new List<(string Name, string Email, string Role)>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        void Add(string? name, string? email, string role)
        {
            if (string.IsNullOrWhiteSpace(email)) return;
            var e = email!.Trim();
            if (!seen.Add(e)) return;
            ordered.Add((name ?? role, e, role));
        }

        // Club President + Secretary (current year BOD)
        var bod = await conn.QueryAsync<dynamic>(
            @"SELECT m.MemberName AS Name, m.EmailId AS Email, d.designation_name AS Role
              FROM board_of_directors bod
              JOIN member_master_profile m ON m.pk_member_master_profile_id = bod.fk_member_master_profile_id
              JOIN designation_master d ON d.pk_designation_id = bod.fk_designation_id
              WHERE bod.fk_club_id = @ClubId AND bod.fk_year_id = @YearId AND bod.isdeleted = 0
                AND d.designation_name IN ('Club President', 'Club Secretary')",
            new { ClubId = clubId, YearId = yearId });
        var bodList = bod.ToList();
        var president = bodList.FirstOrDefault(b => (string)b.Role == "Club President");
        var secretary = bodList.FirstOrDefault(b => (string)b.Role == "Club Secretary");
        if (president != null) Add((string?)president.Name, (string?)president.Email, "Club President");
        if (secretary != null) Add((string?)secretary.Name, (string?)secretary.Email, "Club Secretary");

        // Assistant Governor — resolved LIVE (current AG for this club + year), so a changed AG
        // gets the email, not whoever was AG when the report was first created.
        var ag = await conn.QueryFirstOrDefaultAsync<dynamic>(
            @"SELECT m.MemberName AS Name, m.EmailId AS Email
              FROM district_ag da
              JOIN member_master_profile m ON m.pk_member_master_profile_id = da.fk_member_id AND COALESCE(m.isdeleted,0) = 0
              WHERE da.fk_club_id = @ClubId AND da.fk_year_id = @YearId
                AND da.is_active = 1 AND (da.isdeleted = 0 OR da.isdeleted IS NULL)
              ORDER BY da.id DESC LIMIT 1",
            new { ClubId = clubId, YearId = yearId });
        if (ag != null) Add((string?)ag.Name, (string?)ag.Email, "Assistant Governor");

        // District Governor (via the club's district + year) — INCLUDED only when the district
        // admin's setting for this (district, year) allows it (default Yes).
        if (sendToDistrictGovernor)
        {
            // LEFT JOIN, not INNER: a DG who is not a member of any club has no fk_member_id and
            // would otherwise drop off the recipient list entirely. Their name and email live on
            // the DG row itself.
            var dg = await conn.QueryFirstOrDefaultAsync<dynamic>(
                $@"SELECT {DistrictGovernorSql.Name} AS Name, {DistrictGovernorSql.Email} AS Email
                  FROM district_governors g
                  JOIN club_master c ON c.fk_district_id = g.fk_district_id
                  {DistrictGovernorSql.JoinMember}
                  WHERE c.pk_club_id = @ClubId AND g.fk_year_id = @YearId AND g.isdeleted = 0
                  LIMIT 1",
                new { ClubId = clubId, YearId = yearId });
            if (dg != null) Add((string?)dg.Name, (string?)dg.Email, "District Governor");
        }

        // Extra CC addresses the district admin configured — ALWAYS added (independent of the DG
        // toggle). De-duped against the officers/DG above via the shared `seen` set.
        foreach (var cc in extraCcEmails)
            Add(cc, cc, "CC (District)");

        return ordered;
    }

    private static string BuildBody(DTOs.MonthlyReportPreviewDto s, List<(string Name, string Email, string Role)> recipients, string? overrideEmail, bool photosDropped)
    {
        var L = RotaryApi.Services.Localization.DbStringLocalizer.Instance;
        var who = recipients.Count > 0
            ? string.Join(", ", recipients.Select(r => $"{r.Name} ({r.Role})"))
            : L["(none resolved)"];
        var testBanner = string.IsNullOrWhiteSpace(overrideEmail) ? "" : $@"
                <p style='font-size: 13px; line-height: 1.6; background:#FFF3CD; border:1px solid #FFE69C; padding:10px; border-radius:6px;'>
                    <strong>TEST MODE:</strong> this email was redirected to {overrideEmail}. In production it would be sent to the recipients listed below.
                </p>";
        // Attachment line differs when photos had to be dropped to fit the mail-size limit.
        var attachmentLine = photosDropped
            ? $@"<p style='font-size: 14px; line-height: 1.8;'>
                    {L["The report, with meetings and all service avenues, is attached as a PDF."]}
                    <strong>{L["Photos were omitted to keep this email within the size limit;"]}</strong>
                    {L["the full report with photos is available in the portal."]}
                </p>"
            : $@"<p style='font-size: 14px; line-height: 1.8;'>
                    {L["The full report, with meetings and all service avenues with photos, is attached as a PDF."]}
                </p>";
        return $@"
            {EmailService.EMAIL_HEADER}
                <p style='font-style: italic; font-size: 15px; margin-bottom: 20px;'><strong>{L["Dear Rtn,"]}</strong></p>
                {testBanner}
                <p style='font-size: 14px; line-height: 1.8;'>
                    {L["The Club Monthly Report for {0} for {1} has been submitted to the District.", $"<strong>{s.ClubName}</strong>", $"<strong>{s.MonthName} {s.YearLabel}</strong>"]}
                </p>
                {attachmentLine}
                <p style='font-size: 13px; color:#64748B; line-height: 1.8;'>{L["Recipients: {0}", who]}</p>
                <p style='font-size: 13px; line-height: 1.8; font-style: italic;'>
                    {L["This is an autogenerated email from ROW."]}
                </p>
            {EmailService.EMAIL_FOOTER}";
    }
}
