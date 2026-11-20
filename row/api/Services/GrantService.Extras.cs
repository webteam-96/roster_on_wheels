using System.Data;
using System.Net;
using System.Text.RegularExpressions;
using ClosedXML.Excel;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

/// <summary>
/// Grants extras (2026-11-20): club qualification per Rotary year (MOU signed + officer training, expiry, members
/// trained), the district's monthly cash flow with recorded receipts and an Excel export, and the district's editable
/// subject/body for the grant emails (status notifications and report reminders).
/// Qualification gate: per district setting "require club qualification to submit" (grant_district_settings, default
/// off). Off: an unqualified club is warned (GrantApplicationDto.QualificationWarning) but may submit. On: the submit
/// and resubmit are refused (CheckSubmittableAsync).
/// </summary>
public partial class GrantService
{
    // ===== Qualification =====

    /// <summary>Null when qualified on <paramref name="today"/> (UTC date), else why not.</summary>
    public static string? QualificationProblem(DateTime? mouSignedOn, DateTime? trainingOn, DateTime? expiresOn, DateTime today)
    {
        if (mouSignedOn == null) return "The club has not signed the district's grant MOU for this Rotary year.";
        if (trainingOn == null) return "The club's officers have not attended grant management training for this Rotary year.";
        if (expiresOn is { } e && e.Date < today.Date) return $"The club's grant qualification expired on {e:yyyy-MM-dd}.";
        return null;
    }

    private const string QualificationSelect = @"
        SELECT c.pk_club_id AS ClubId, c.ClubName, y.pk_year_id AS YearId, y.YearLabel, q.mou_signed_on AS MouSignedOn,
               q.training_on AS TrainingOn, q.expires_on AS ExpiresOn, q.note AS Note, q.modified_at_utc AS ModifiedAtUtc,
               q.pk_qualification_id AS QualificationId";

    private sealed class QualRow
    {
        public int ClubId { get; set; }
        public string ClubName { get; set; } = "";
        public int YearId { get; set; }
        public string YearLabel { get; set; } = "";
        public DateTime? MouSignedOn { get; set; }
        public DateTime? TrainingOn { get; set; }
        public DateTime? ExpiresOn { get; set; }
        public string? Note { get; set; }
        public DateTime? ModifiedAtUtc { get; set; }
        public int? QualificationId { get; set; }
    }

    private static async Task<List<GrantClubQualificationDto>> ToQualificationsAsync(MySqlConnection c, List<QualRow> rows)
    {
        var ids = rows.Where(r => r.QualificationId != null).Select(r => r.QualificationId!.Value).ToList();
        var members = ids.Count == 0 ? new List<(int QualificationId, int MemberId, string? MemberName, DateTime? TrainedOn)>()
            : (await c.QueryAsync<(int QualificationId, int MemberId, string? MemberName, DateTime? TrainedOn)>(@"
                SELECT qm.fk_qualification_id, qm.fk_member_id, m.MemberName, qm.trained_on
                FROM grant_qualified_members qm LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = qm.fk_member_id
                WHERE qm.fk_qualification_id IN @ids ORDER BY m.MemberName", new { ids })).ToList();
        var today = DateTime.UtcNow.Date;
        return rows.Select(r =>
        {
            var problem = QualificationProblem(r.MouSignedOn, r.TrainingOn, r.ExpiresOn, today);
            return new GrantClubQualificationDto
            {
                ClubId = r.ClubId, ClubName = r.ClubName, YearId = r.YearId, YearLabel = r.YearLabel, MouSignedOn = r.MouSignedOn,
                TrainingOn = r.TrainingOn, ExpiresOn = r.ExpiresOn, Note = r.Note, ModifiedAtUtc = r.ModifiedAtUtc,
                Qualified = problem == null, Problem = problem,
                Members = members.Where(m => m.QualificationId == r.QualificationId)
                    .Select(m => new GrantQualifiedMemberDto { MemberId = m.MemberId, MemberName = m.MemberName, TrainedOn = m.TrainedOn }).ToList(),
            };
        }).ToList();
    }

    /// <summary>Every active club of the district for one Rotary year, qualified or not.</summary>
    public async Task<List<GrantClubQualificationDto>> ListQualificationsAsync(int districtId, int yearId)
    {
        await using var c = RowDb.Connect(_cs);
        var rows = (await c.QueryAsync<QualRow>(QualificationSelect + @"
            FROM club_master c
            JOIN rotary_year_master y ON y.pk_year_id = @yearId
            LEFT JOIN grant_club_qualifications q ON q.fk_club_id = c.pk_club_id AND q.fk_year_id = y.pk_year_id
            WHERE c.fk_district_id = @districtId AND IFNULL(c.isdeleted, 0) = 0 AND IFNULL(c.IsActive, 1) = 1
            ORDER BY c.ClubName", new { districtId, yearId })).ToList();
        return await ToQualificationsAsync(c, rows);
    }

    private static async Task<List<GrantClubQualificationDto>> ClubQualificationsAsync(MySqlConnection c, int clubId) =>
        await ToQualificationsAsync(c, (await c.QueryAsync<QualRow>(QualificationSelect + @"
            FROM grant_club_qualifications q
            JOIN club_master c ON c.pk_club_id = q.fk_club_id
            JOIN rotary_year_master y ON y.pk_year_id = q.fk_year_id
            WHERE q.fk_club_id = @clubId ORDER BY y.StartDate DESC", new { clubId })).ToList());

    /// <summary>The district records a club's qualification for a year. Null when the club is not in the district.</summary>
    public async Task<GrantClubQualificationDto?> SaveQualificationAsync(int districtId, int clubId, int yearId, SaveGrantQualificationDto dto, int memberId, HttpContext http)
    {
        var note = Clean(dto.Note, 500, "The note");
        if (dto.MouSignedOn != null && dto.ExpiresOn != null && dto.ExpiresOn < dto.MouSignedOn)
            throw new InvalidOperationException("The qualification cannot expire before the MOU was signed.");
        var members = dto.Members ?? new();
        if (members.Count > 200) throw new InvalidOperationException("At most 200 trained members.");
        if (members.Select(m => m.MemberId).Distinct().Count() != members.Count) throw new InvalidOperationException("Each trained member once.");

        await using var c = RowDb.Connect(_cs);
        await c.OpenAsync();
        await using var tx = await c.BeginTransactionAsync(IsolationLevel.ReadCommitted);
        if (await c.ExecuteScalarAsync<int?>("SELECT fk_district_id FROM club_master WHERE pk_club_id = @clubId AND IFNULL(isdeleted, 0) = 0",
                new { clubId }, tx) != districtId) return null;
        if (await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM rotary_year_master WHERE pk_year_id = @yearId AND isdeleted = 0", new { yearId }, tx) == 0)
            throw new InvalidOperationException("Choose a Rotary year.");
        if (members.Count > 0)
        {
            var ids = members.Select(m => m.MemberId).ToList();
            var active = await c.ExecuteScalarAsync<int>(@"
                SELECT COUNT(DISTINCT fk_member_master_profile_id) FROM club_members
                WHERE fk_club_id = @clubId AND IFNULL(isdeleted, 0) = 0 AND fk_member_master_profile_id IN @ids", new { clubId, ids }, tx);
            if (active != ids.Count) throw new InvalidOperationException("Trained members must be members of the club.");
        }
        await c.ExecuteAsync(@"
            INSERT INTO grant_club_qualifications (fk_district_id, fk_club_id, fk_year_id, mou_signed_on, training_on, expires_on, note, modified_by, modified_at_utc)
            VALUES (@districtId, @clubId, @yearId, @MouSignedOn, @TrainingOn, @ExpiresOn, @note, @memberId, UTC_TIMESTAMP())
            ON DUPLICATE KEY UPDATE mou_signed_on = VALUES(mou_signed_on), training_on = VALUES(training_on), expires_on = VALUES(expires_on),
                note = VALUES(note), modified_by = VALUES(modified_by), modified_at_utc = VALUES(modified_at_utc)",
            new { districtId, clubId, yearId, MouSignedOn = dto.MouSignedOn?.Date, TrainingOn = dto.TrainingOn?.Date, ExpiresOn = dto.ExpiresOn?.Date, note, memberId }, tx);
        var qid = await c.ExecuteScalarAsync<int>(
            "SELECT pk_qualification_id FROM grant_club_qualifications WHERE fk_club_id = @clubId AND fk_year_id = @yearId", new { clubId, yearId }, tx);
        await c.ExecuteAsync("DELETE FROM grant_qualified_members WHERE fk_qualification_id = @qid", new { qid }, tx);
        if (members.Count > 0)
            await c.ExecuteAsync("INSERT INTO grant_qualified_members (fk_qualification_id, fk_member_id, trained_on) VALUES (@qid, @MemberId, @TrainedOn)",
                members.Select(m => new { qid, m.MemberId, TrainedOn = m.TrainedOn?.Date }), tx);
        await tx.CommitAsync();
        await _audit.LogAsync(memberId, "UPDATE", "grant_qualification", qid, null,
            new { clubId, yearId, dto.MouSignedOn, dto.TrainingOn, dto.ExpiresOn, members = members.Count }, http);
        return (await ListQualificationsAsync(districtId, yearId)).FirstOrDefault(q => q.ClubId == clubId);
    }

    /// <summary>What the submit does with a qualification problem: refused when the district requires qualification,
    /// else allowed (the club sees the problem as a warning). Null = no block.</summary>
    public static string? QualificationBlock(bool required, string? problem) =>
        required && problem != null ? problem + " Ask the district grants chair." : null;

    /// <summary>Null when the club is qualified for the cycle's Rotary year, else why not.</summary>
    private static async Task<string?> CycleQualificationProblemAsync(MySqlConnection c, MySqlTransaction? tx, int cycleId, int clubId)
    {
        var q = await c.QueryFirstOrDefaultAsync<(DateTime? Mou, DateTime? Training, DateTime? Expires)?>(@"
            SELECT q.mou_signed_on, q.training_on, q.expires_on FROM grant_club_qualifications q
            JOIN grant_cycles gc ON gc.fk_year_id = q.fk_year_id AND gc.pk_cycle_id = @cycleId
            WHERE q.fk_club_id = @clubId", new { cycleId, clubId }, tx);
        return q == null
            ? "The club is not qualified for district grants this Rotary year. The district records the signed MOU and the officer training."
            : QualificationProblem(q.Value.Mou, q.Value.Training, q.Value.Expires, DateTime.UtcNow.Date);
    }

    private static async Task<bool> RequiresQualificationAsync(MySqlConnection c, MySqlTransaction? tx, int districtId) =>
        await c.ExecuteScalarAsync<int?>("SELECT require_qualification FROM grant_district_settings WHERE fk_district_id = @districtId",
            new { districtId }, tx) == 1;

    /// <summary>Submit / resubmit gate (see the class summary).</summary>
    private static async Task CheckQualifiedAsync(MySqlConnection c, MySqlTransaction tx, AppRow app)
    {
        if (QualificationBlock(await RequiresQualificationAsync(c, tx, app.DistrictId),
                await CycleQualificationProblemAsync(c, tx, app.CycleId, app.ClubId)) is { } block)
            throw new InvalidOperationException(block);
    }

    /// <summary>Club side: the warning shown on an application that is not yet submitted (or sent back) while the club is not qualified.</summary>
    private static async Task FillQualificationWarningAsync(MySqlConnection c, GrantApplicationDto a)
    {
        if (!EditableStates.Contains(a.Status)) return;
        a.QualificationRequired = await RequiresQualificationAsync(c, null, a.DistrictId);
        a.QualificationWarning = await CycleQualificationProblemAsync(c, null, a.CycleId, a.ClubId);
    }

    public async Task<GrantSettingsDto> GetSettingsAsync(int districtId)
    {
        await using var c = RowDb.Connect(_cs);
        return new GrantSettingsDto { RequireQualification = await RequiresQualificationAsync(c, null, districtId) };
    }

    public async Task<GrantSettingsDto> SaveSettingsAsync(int districtId, GrantSettingsDto dto, int memberId, HttpContext http)
    {
        await using var c = RowDb.Connect(_cs);
        await c.ExecuteAsync(@"
            INSERT INTO grant_district_settings (fk_district_id, require_qualification, modified_by, modified_at_utc)
            VALUES (@districtId, @req, @memberId, UTC_TIMESTAMP())
            ON DUPLICATE KEY UPDATE require_qualification = VALUES(require_qualification), modified_by = VALUES(modified_by),
                modified_at_utc = VALUES(modified_at_utc)", new { districtId, req = dto.RequireQualification ? 1 : 0, memberId });
        await _audit.LogAsync(memberId, "UPDATE", "grant_settings", districtId, null, new { dto.RequireQualification }, http);
        return await GetSettingsAsync(districtId);
    }

    // ===== Monthly cash flow and receipts =====

    /// <summary>Month rows (yyyy-MM, sorted) from the three money streams, with the running balance receipts minus payments.</summary>
    public static List<GrantMonthRowDto> BuildMonths(
        IEnumerable<(string Month, decimal Amount)> approved, IEnumerable<(string Month, decimal Amount)> paid, IEnumerable<(string Month, decimal Amount)> receipts)
    {
        var rows = new SortedDictionary<string, GrantMonthRowDto>(StringComparer.Ordinal);
        GrantMonthRowDto Row(string m) => rows.TryGetValue(m, out var r) ? r : rows[m] = new GrantMonthRowDto { Month = m };
        foreach (var (m, a) in approved) Row(m).Approved += a;
        foreach (var (m, a) in paid) Row(m).PaidOut += a;
        foreach (var (m, a) in receipts) Row(m).Receipts += a;
        decimal balance = 0;
        foreach (var r in rows.Values) { balance += r.Receipts - r.PaidOut; r.Balance = balance; }
        return rows.Values.ToList();
    }

    public async Task<GrantMonthlyCashFlowDto?> GetMonthlyCashFlowAsync(int districtId, int cycleId)
    {
        await using var c = RowDb.Connect(_cs);
        var cycle = await c.QueryFirstOrDefaultAsync<(string YearLabel, decimal Budget)?>(@"
            SELECT y.YearLabel, gc.ddf_budget FROM grant_cycles gc JOIN rotary_year_master y ON y.pk_year_id = gc.fk_year_id
            WHERE gc.pk_cycle_id = @cycleId AND gc.fk_district_id = @districtId", new { cycleId, districtId });
        if (cycle == null) return null;
        // Approved: by the month of the (last) approval, for grants still committed.
        var approved = await c.QueryAsync<(string, decimal)>(@"
            SELECT DATE_FORMAT(e.at, '%Y-%m'), a.amount_approved FROM grant_applications a
            JOIN (SELECT fk_application_id, MAX(created_date) AS at FROM grant_events WHERE action = 'approve' GROUP BY fk_application_id) e
              ON e.fk_application_id = a.pk_application_id
            WHERE a.fk_cycle_id = @cycleId AND a.status IN @CommittedStates AND a.amount_approved IS NOT NULL", new { cycleId, CommittedStates });
        var paid = await c.QueryAsync<(string, decimal)>(@"
            SELECT DATE_FORMAT(p.paid_on, '%Y-%m'), p.amount FROM grant_payments p
            JOIN grant_applications a ON a.pk_application_id = p.fk_application_id WHERE a.fk_cycle_id = @cycleId", new { cycleId });
        var receipts = (await c.QueryAsync<GrantReceiptDto>(@"
            SELECT r.pk_receipt_id AS Id, r.amount AS Amount, r.received_on AS ReceivedOn, r.source AS Source, r.reference AS Reference,
                   m.MemberName AS RecordedByName
            FROM grant_cycle_receipts r LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = r.recorded_by
            WHERE r.fk_cycle_id = @cycleId ORDER BY r.received_on, r.pk_receipt_id", new { cycleId })).ToList();
        var months = BuildMonths(approved, paid, receipts.Select(r => (r.ReceivedOn.ToString("yyyy-MM"), r.Amount)));
        return new GrantMonthlyCashFlowDto
        {
            CycleId = cycleId, YearLabel = cycle.Value.YearLabel, DdfBudget = cycle.Value.Budget, Months = months, ReceiptList = receipts,
            Approved = months.Sum(m => m.Approved), PaidOut = months.Sum(m => m.PaidOut), Receipts = months.Sum(m => m.Receipts),
            Balance = months.LastOrDefault()?.Balance ?? 0,
        };
    }

    /// <summary>Money the district received for its grants (DDF from the Foundation, club refunds). Null when the cycle is not the district's.</summary>
    public async Task<GrantMonthlyCashFlowDto?> AddReceiptAsync(int districtId, int cycleId, SaveGrantReceiptDto dto, int memberId, HttpContext http)
    {
        if (dto.Amount is not { } amount || amount <= 0 || amount > MaxAmount) throw new InvalidOperationException("Enter the amount received.");
        if (dto.ReceivedOn is not { } on) throw new InvalidOperationException("Enter the date received.");
        if (on.Date > DateTime.UtcNow.Date.AddDays(1)) throw new InvalidOperationException("The date received cannot be in the future.");
        var source = Clean(dto.Source, 150, "The source") ?? throw new InvalidOperationException("Say where the money came from.");
        var reference = Clean(dto.Reference, 100, "The reference");
        await using var c = RowDb.Connect(_cs);
        if (await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM grant_cycles WHERE pk_cycle_id = @cycleId AND fk_district_id = @districtId",
                new { cycleId, districtId }) == 0) return null;
        var id = await c.ExecuteScalarAsync<int>(@"
            INSERT INTO grant_cycle_receipts (fk_cycle_id, amount, received_on, source, reference, recorded_by, created_at_utc)
            VALUES (@cycleId, @amount, @on, @source, @reference, @memberId, UTC_TIMESTAMP()); SELECT LAST_INSERT_ID();",
            new { cycleId, amount = decimal.Round(amount, 2), on = on.Date, source, reference, memberId });
        await _audit.LogAsync(memberId, "CREATE", "grant_receipt", id, source, new { cycleId, amount }, http);
        return await GetMonthlyCashFlowAsync(districtId, cycleId);
    }

    public async Task<bool> DeleteReceiptAsync(int districtId, int cycleId, int receiptId, int memberId, HttpContext http)
    {
        await using var c = RowDb.Connect(_cs);
        var n = await c.ExecuteAsync(@"
            DELETE r FROM grant_cycle_receipts r JOIN grant_cycles gc ON gc.pk_cycle_id = r.fk_cycle_id
            WHERE r.pk_receipt_id = @receiptId AND r.fk_cycle_id = @cycleId AND gc.fk_district_id = @districtId", new { receiptId, cycleId, districtId });
        if (n > 0) await _audit.LogAsync(memberId, "DELETE", "grant_receipt", receiptId, null, new { cycleId }, http);
        return n > 0;
    }

    /// <summary>The monthly cash flow as an Excel workbook (months, then receipts).</summary>
    public async Task<byte[]?> ExportMonthlyCashFlowAsync(int districtId, int cycleId)
    {
        var f = await GetMonthlyCashFlowAsync(districtId, cycleId);
        if (f == null) return null;
        using var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add("Cash flow");
        ws.Cell(1, 1).Value = $"Grants cash flow, Rotary year {f.YearLabel}";
        ws.Cell(1, 1).Style.Font.Bold = true;
        ws.Cell(2, 1).Value = "DDF budget";
        ws.Cell(2, 2).Value = f.DdfBudget;
        string[] head = { "Month", "Approved", "Paid out", "Receipts", "Balance" };
        for (var i = 0; i < head.Length; i++) { ws.Cell(4, i + 1).Value = head[i]; ws.Cell(4, i + 1).Style.Font.Bold = true; }
        var row = 5;
        foreach (var m in f.Months)
        {
            ws.Cell(row, 1).Value = m.Month;
            ws.Cell(row, 2).Value = m.Approved;
            ws.Cell(row, 3).Value = m.PaidOut;
            ws.Cell(row, 4).Value = m.Receipts;
            ws.Cell(row, 5).Value = m.Balance;
            row++;
        }
        ws.Cell(row, 1).Value = "Total";
        ws.Cell(row, 2).Value = f.Approved;
        ws.Cell(row, 3).Value = f.PaidOut;
        ws.Cell(row, 4).Value = f.Receipts;
        ws.Cell(row, 5).Value = f.Balance;
        ws.Row(row).Style.Font.Bold = true;
        ws.Range(5, 2, row, 5).Style.NumberFormat.Format = "#,##0.00";
        ws.Columns().AdjustToContents();

        var rs = wb.Worksheets.Add("Receipts");
        string[] rh = { "Received on", "Source", "Reference", "Amount", "Recorded by" };
        for (var i = 0; i < rh.Length; i++) { rs.Cell(1, i + 1).Value = rh[i]; rs.Cell(1, i + 1).Style.Font.Bold = true; }
        row = 2;
        foreach (var r in f.ReceiptList)
        {
            rs.Cell(row, 1).Value = r.ReceivedOn;
            rs.Cell(row, 1).Style.DateFormat.Format = "yyyy-mm-dd";
            rs.Cell(row, 2).Value = r.Source;
            rs.Cell(row, 3).Value = r.Reference ?? "";
            rs.Cell(row, 4).Value = r.Amount;
            rs.Cell(row, 5).Value = r.RecordedByName ?? "";
            row++;
        }
        rs.Columns().AdjustToContents();
        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }

    // ===== Email templates =====

    public static readonly string[] TemplateKinds = { "status", "reminder" };
    public static readonly string[] TemplatePlaceholders = { "recipient", "message", "details", "application", "club", "year", "status", "link" };

    /// <summary>Used when the district has not edited a template; matches the email sent before templates existed.</summary>
    public static GrantEmailTemplateDto DefaultTemplate(string kind) => new()
    {
        Kind = kind, IsDefault = true, Subject = "{{message}}",
        Body = "Dear {{recipient}},\n\n{{message}}\n\n{{details}}\n\nOpen the application: {{link}}",
    };

    private static readonly Regex Placeholder = new(@"\{\{\s*([a-z_]+)\s*\}\}", RegexOptions.Compiled);

    /// <summary>Null when every {{placeholder}} is known, else the problem.</summary>
    public static string? TemplateProblem(string text)
    {
        var unknown = Placeholder.Matches(text).Select(m => m.Groups[1].Value).Where(p => !TemplatePlaceholders.Contains(p)).Distinct().ToList();
        return unknown.Count == 0 ? null : $"Unknown placeholder: {string.Join(", ", unknown.Select(u => "{{" + u + "}}"))}.";
    }

    /// <summary>Subject: placeholders replaced, one line. Html: the body HTML-encoded (values too), line breaks kept.</summary>
    public static GrantEmailPreviewDto RenderTemplate(string subject, string body, IReadOnlyDictionary<string, string?> values)
    {
        string Fill(string text, bool html) => Placeholder.Replace(text, m =>
        {
            var v = values.TryGetValue(m.Groups[1].Value, out var x) ? x ?? "" : "";
            return html ? WebUtility.HtmlEncode(v) : v;
        });
        var s = Regex.Replace(Fill(subject, false), @"\s+", " ").Trim();
        // Encode the template's own text first; placeholders survive encoding ({{ }} and a-z are not encoded).
        var h = Fill(WebUtility.HtmlEncode(body.Replace("\r\n", "\n")), true).Replace("\n", "<br>");
        return new GrantEmailPreviewDto
        {
            Subject = s.Length > 250 ? s[..250] : s,
            Html = $@"<div style=""font-family:Figtree, Arial,Helvetica,sans-serif;font-size:15px;color:#1B2C42;line-height:1.6;max-width:640px"">{h}</div>",
        };
    }

    public async Task<List<GrantEmailTemplateDto>> ListTemplatesAsync(int districtId)
    {
        await using var c = RowDb.Connect(_cs);
        var saved = (await c.QueryAsync<GrantEmailTemplateDto>(
            "SELECT kind AS Kind, subject AS Subject, body AS Body FROM grant_email_templates WHERE fk_district_id = @districtId", new { districtId })).ToList();
        return TemplateKinds.Select(k => saved.FirstOrDefault(s => s.Kind == k) ?? DefaultTemplate(k)).ToList();
    }

    /// <summary>The district's template for a kind, or null for the built-in email (used by the email job).</summary>
    public static async Task<GrantEmailTemplateDto?> FindTemplateAsync(MySqlConnection c, int districtId, string kind) =>
        await c.QueryFirstOrDefaultAsync<GrantEmailTemplateDto>(
            "SELECT kind AS Kind, subject AS Subject, body AS Body FROM grant_email_templates WHERE fk_district_id = @districtId AND kind = @kind",
            new { districtId, kind });

    private static (string Subject, string Body) CheckTemplate(string kind, SaveGrantEmailTemplateDto dto)
    {
        if (!TemplateKinds.Contains(kind)) throw new InvalidOperationException("Unknown template.");
        var subject = Clean(dto.Subject, 250, "The subject") ?? throw new InvalidOperationException("Enter a subject.");
        var body = Clean(dto.Body, 8000, "The body") ?? throw new InvalidOperationException("Enter the email text.");
        if ((TemplateProblem(subject) ?? TemplateProblem(body)) is { } p) throw new InvalidOperationException(p);
        return (subject, body);
    }

    public async Task<GrantEmailTemplateDto> SaveTemplateAsync(int districtId, string kind, SaveGrantEmailTemplateDto dto, int memberId, HttpContext http)
    {
        var (subject, body) = CheckTemplate(kind, dto);
        await using var c = RowDb.Connect(_cs);
        await c.ExecuteAsync(@"
            INSERT INTO grant_email_templates (fk_district_id, kind, subject, body, modified_by, modified_at_utc)
            VALUES (@districtId, @kind, @subject, @body, @memberId, UTC_TIMESTAMP())
            ON DUPLICATE KEY UPDATE subject = VALUES(subject), body = VALUES(body), modified_by = VALUES(modified_by), modified_at_utc = VALUES(modified_at_utc)",
            new { districtId, kind, subject, body, memberId });
        await _audit.LogAsync(memberId, "UPDATE", "grant_email_template", districtId, kind, new { subject }, http);
        return new GrantEmailTemplateDto { Kind = kind, Subject = subject, Body = body };
    }

    public async Task<GrantEmailTemplateDto> ResetTemplateAsync(int districtId, string kind, int memberId, HttpContext http)
    {
        if (!TemplateKinds.Contains(kind)) throw new InvalidOperationException("Unknown template.");
        await using var c = RowDb.Connect(_cs);
        await c.ExecuteAsync("DELETE FROM grant_email_templates WHERE fk_district_id = @districtId AND kind = @kind", new { districtId, kind });
        await _audit.LogAsync(memberId, "DELETE", "grant_email_template", districtId, kind, null, http);
        return DefaultTemplate(kind);
    }

    /// <summary>The template with sample values, as the email job would send it.</summary>
    public static GrantEmailPreviewDto PreviewTemplate(string kind, SaveGrantEmailTemplateDto dto)
    {
        var (subject, body) = CheckTemplate(kind, dto);
        return RenderTemplate(subject, body, new Dictionary<string, string?>
        {
            ["recipient"] = "Asha Perera", ["application"] = "Clean water for the village school", ["club"] = "Rotary Club of Example",
            ["year"] = "2026-27", ["status"] = kind == "reminder" ? "Paid" : "Approved",
            ["message"] = kind == "reminder" ? "Grant final report due 2027-05-31: Clean water for the village school" : "Grant application approved: Clean water for the village school",
            ["details"] = "Rotary Club of Example, 2026-27.", ["link"] = "https://example.org/club-admin-dashboard/grants/1",
        });
    }
}
