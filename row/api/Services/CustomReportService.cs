using System.Globalization;
using System.Net;
using System.Text;
using System.Text.Json;
using ClosedXML.Excel;
using Dapper;
using MySqlConnector;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

/// <summary>
/// Custom report builder for club and district admins (competitor gap, 2026-11-19). Saved reports live in
/// custom_reports (DatabaseInitializer.CustomReports.cs); the SQL comes from <see cref="CustomReportQuery"/> only.
/// A club report reads that club; a district report reads every live club of the district. The controller checks
/// that the caller manages the club or district before anything here runs.
/// </summary>
public class CustomReportService
{
    public const string ClubScope = "club";
    public const string DistrictScope = "district";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static readonly string[] Formats = { "xlsx", "csv", "pdf" };
    private readonly string _cs;
    private readonly IYearTableResolver _years;
    private readonly IEmailService _email;
    private readonly ILogger<CustomReportService> _log;

    public CustomReportService(IConfiguration config, IYearTableResolver years, IEmailService email, ILogger<CustomReportService> log)
    {
        _cs = config.GetConnectionString("DefaultConnection")!;
        _years = years;
        _email = email;
        _log = log;
    }

    private static string Scope(bool club) => club ? ClubScope : DistrictScope;

    private async Task<MySqlConnection> OpenAsync()
    {
        var c = new MySqlConnection(_cs);
        await c.OpenAsync();
        return c;
    }

    private Task<bool> ContactsOnAsync() => FeatureGate.IsOnAsync("contacts_growth", _cs);

    public async Task<IReadOnlyList<CustomReportSourceInfo>> CatalogAsync()
    {
        var contacts = await ContactsOnAsync();
        return CustomReportQuery.Catalog().Where(s => contacts || s.Key != "contacts").ToList();
    }

    /// <summary>The clubs a report in this scope may read: the club itself, or the district's live, non-Rotaract clubs.</summary>
    private static async Task<List<int>> ClubsAsync(MySqlConnection c, bool club, int scopeId)
    {
        if (club) return new List<int> { scopeId };
        return (await c.QueryAsync<int>($@"
            SELECT c.pk_club_id FROM club_master c
            WHERE c.fk_district_id = @scopeId AND IFNULL(c.isdeleted, 0) = 0
              AND {HierarchyScopeSql.ClubLive("c")} AND {ClubScopeSql.NotRotaract("c")}", new { scopeId })).ToList();
    }

    /// <summary>Runs a definition; returns (null, problem) when it is not valid.</summary>
    public async Task<(CustomReportResult? Result, string? Problem)> RunAsync(bool club, int scopeId, CustomReportDefinition d)
    {
        if (CustomReportQuery.Validate(d) is { } problem) return (null, problem);
        if (d.Source == "contacts" && !await ContactsOnAsync()) return (null, "Contacts are switched off.");
        await using var c = await OpenAsync();
        string? table = null;
        if (d.Source == "projects")
        {
            var yearId = d.YearId ?? await c.ExecuteScalarAsync<int?>(
                "SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND IFNULL(isdeleted, 0) = 0 ORDER BY pk_year_id DESC LIMIT 1");
            var tables = await _years.GetAllExistingYearTablesAsync(c);
            table = tables.FirstOrDefault(t => t.YearId == yearId)?.ProjectsTable;
            if (table == null) return (null, "There are no projects for that year.");
        }
        var clubs = await ClubsAsync(c, club, scopeId);
        var (sql, args, columns) = CustomReportQuery.Build(d, clubs, club ? 0 : scopeId, table);
        var rows = (await c.QueryAsync(sql, args)).Cast<IDictionary<string, object?>>()
            .Select(r => Enumerable.Range(0, columns.Count).Select(i => Cell(r["c" + i])).ToArray()).ToList();
        var truncated = rows.Count > CustomReportQuery.RowCap;
        if (truncated) rows.RemoveAt(rows.Count - 1);
        return (new CustomReportResult { Columns = columns, Rows = rows, Truncated = truncated }, null);
    }

    private static object? Cell(object? v) => v switch
    {
        DateTime dt => dt.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        DateOnly d => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        DBNull => null,
        _ => v,
    };

    // ===== Saved reports =====

    private sealed class Row
    {
        public int Id { get; set; }
        public string ScopeType { get; set; } = "";
        public int ScopeId { get; set; }
        public string Name { get; set; } = "";
        public string Definition { get; set; } = "{}";
        public bool ScheduleMonthly { get; set; }
        public int ScheduleDay { get; set; }
        public string ScheduleFormat { get; set; } = "xlsx";
        public DateTime? LastSentAt { get; set; }
        public int CreatedBy { get; set; }
        public string? CreatedByName { get; set; }
        public DateTime? ModifiedAt { get; set; }
    }

    private const string Select = @"
        SELECT r.pk_report_id AS Id, r.scope_type AS ScopeType, r.scope_id AS ScopeId, r.name AS Name, r.definition AS Definition,
               r.schedule_monthly AS ScheduleMonthly, r.schedule_day AS ScheduleDay, r.schedule_format AS ScheduleFormat,
               r.last_sent_at AS LastSentAt, r.created_by AS CreatedBy, m.MemberName AS CreatedByName,
               COALESCE(r.modified_date, r.created_date) AS ModifiedAt
        FROM custom_reports r
        LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = r.created_by";

    private static CustomReportDto ToDto(Row r) => new()
    {
        Id = r.Id, Name = r.Name, ScheduleMonthly = r.ScheduleMonthly, ScheduleDay = r.ScheduleDay, ScheduleFormat = r.ScheduleFormat,
        LastSentAt = r.LastSentAt, CreatedByName = r.CreatedByName, ModifiedAt = r.ModifiedAt,
        Definition = JsonSerializer.Deserialize<CustomReportDefinition>(r.Definition, Json) ?? new(),
    };

    public async Task<List<CustomReportDto>> ListAsync(bool club, int scopeId)
    {
        await using var c = await OpenAsync();
        return (await c.QueryAsync<Row>(Select + " WHERE r.scope_type = @s AND r.scope_id = @scopeId AND r.isdeleted = 0 ORDER BY r.name",
            new { s = Scope(club), scopeId })).Select(ToDto).ToList();
    }

    public async Task<CustomReportDto?> GetAsync(bool club, int scopeId, int id)
    {
        await using var c = await OpenAsync();
        var row = await c.QueryFirstOrDefaultAsync<Row>(Select + " WHERE r.pk_report_id = @id AND r.scope_type = @s AND r.scope_id = @scopeId AND r.isdeleted = 0",
            new { id, s = Scope(club), scopeId });
        return row == null ? null : ToDto(row);
    }

    public static string? ValidateSave(SaveCustomReportDto dto)
    {
        var name = dto.Name?.Trim() ?? "";
        if (name.Length is 0 or > 150) return "Give the report a name (up to 150 characters).";
        if (dto.ScheduleDay is < 1 or > 28) return "The email day must be between 1 and 28.";
        if (!Formats.Contains(dto.ScheduleFormat)) return "Choose Excel, CSV or PDF for the email.";
        return CustomReportQuery.Validate(dto.Definition);
    }

    /// <summary>Creates (id null) or updates a saved report. Returns (id, problem); id 0 with no problem = not found.</summary>
    public async Task<(int Id, string? Problem)> SaveAsync(bool club, int scopeId, int? id, SaveCustomReportDto dto, int memberId)
    {
        if (ValidateSave(dto) is { } problem) return (0, problem);
        if (dto.Definition.Source == "contacts" && !await ContactsOnAsync()) return (0, "Contacts are switched off.");
        var args = new
        {
            id, s = Scope(club), scopeId, name = dto.Name.Trim(), def = JsonSerializer.Serialize(dto.Definition, Json),
            monthly = dto.ScheduleMonthly, day = dto.ScheduleDay, format = dto.ScheduleFormat, memberId,
        };
        await using var c = await OpenAsync();
        if (id == null)
        {
            var newId = await c.ExecuteScalarAsync<int>(@"
                INSERT INTO custom_reports (scope_type, scope_id, name, definition, schedule_monthly, schedule_day, schedule_format, created_by, created_date)
                VALUES (@s, @scopeId, @name, @def, @monthly, @day, @format, @memberId, UTC_TIMESTAMP());
                SELECT LAST_INSERT_ID();", args);
            return (newId, null);
        }
        var n = await c.ExecuteAsync(@"
            UPDATE custom_reports SET name = @name, definition = @def, schedule_monthly = @monthly, schedule_day = @day,
                   schedule_format = @format, modified_by = @memberId, modified_date = UTC_TIMESTAMP()
            WHERE pk_report_id = @id AND scope_type = @s AND scope_id = @scopeId AND isdeleted = 0", args);
        return (n == 0 ? 0 : id.Value, null);
    }

    public async Task<bool> DeleteAsync(bool club, int scopeId, int id, int memberId)
    {
        await using var c = await OpenAsync();
        return await c.ExecuteAsync(@"
            UPDATE custom_reports SET isdeleted = 1, modified_by = @memberId, modified_date = UTC_TIMESTAMP()
            WHERE pk_report_id = @id AND scope_type = @s AND scope_id = @scopeId AND isdeleted = 0",
            new { id, s = Scope(club), scopeId, memberId }) > 0;
    }

    // ===== Export =====

    public static bool IsFormat(string? f) => f != null && Formats.Contains(f);

    public static (byte[] Bytes, string ContentType, string Extension) Export(CustomReportResult r, string format, string title) => format switch
    {
        "csv" => (Encoding.UTF8.GetBytes("﻿" + Csv(r)), "text/csv", "csv"),
        "pdf" => (Pdf(r, title), "application/pdf", "pdf"),
        _ => (Xlsx(r, title), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"),
    };

    /// <summary>Text for a cell in a file: Yes/No for bool columns, invariant numbers.</summary>
    public static string Text(object? v, string type) => v switch
    {
        null => "",
        _ when type == "bool" => Convert.ToInt64(v, CultureInfo.InvariantCulture) == 1 ? "Yes" : "No",
        IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
        _ => v.ToString() ?? "",
    };

    public static string Csv(CustomReportResult r)
    {
        static string Q(string s)
        {
            // a leading = + - @ would run as a formula when the file is opened in a spreadsheet
            if (s.Length > 0 && "=+-@\t\r".Contains(s[0]) && !decimal.TryParse(s, NumberStyles.Number, CultureInfo.InvariantCulture, out _)) s = "'" + s;
            return s.IndexOfAny(new[] { ',', '"', '\n', '\r' }) >= 0 ? "\"" + s.Replace("\"", "\"\"") + "\"" : s;
        }
        var sb = new StringBuilder();
        sb.AppendLine(string.Join(",", r.Columns.Select(c => Q(c.Label))));
        foreach (var row in r.Rows)
            sb.AppendLine(string.Join(",", row.Select((v, i) => Q(Text(v, r.Columns[i].Type)))));
        return sb.ToString();
    }

    private static byte[] Xlsx(CustomReportResult r, string title)
    {
        using var wb = new XLWorkbook();
        var ws = wb.AddWorksheet("Report");
        ws.Cell(1, 1).Value = title;
        ws.Cell(1, 1).Style.Font.Bold = true;
        ws.Cell(1, 1).Style.Font.FontSize = 14;
        for (int i = 0; i < r.Columns.Count; i++)
        {
            var h = ws.Cell(3, i + 1);
            h.Value = r.Columns[i].Label;
            h.Style.Font.Bold = true;
            h.Style.Fill.BackgroundColor = XLColor.FromHtml("#EDF4FB");
        }
        for (int ri = 0; ri < r.Rows.Count; ri++)
            for (int ci = 0; ci < r.Columns.Count; ci++)
            {
                var v = r.Rows[ri][ci];
                var cell = ws.Cell(ri + 4, ci + 1);
                if (v == null) continue;
                if (r.Columns[ci].Type == "number") cell.Value = Convert.ToDouble(v, CultureInfo.InvariantCulture);
                else cell.SetValue(Text(v, r.Columns[ci].Type)); // SetValue keeps text as text (no formulas)
            }
        ws.Columns().AdjustToContents(3, Math.Min(r.Rows.Count + 3, 200));
        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }

    private static bool _pdfReady;

    private static byte[] Pdf(CustomReportResult r, string title)
    {
        if (!_pdfReady)
        {
            QuestPDF.Settings.License = LicenseType.Community;
            QuestPDF.Settings.CheckIfAllTextGlyphsAreAvailable = false; // same opt-out as DuesReceiptPdfBuilder
            _pdfReady = true;
        }
        return Document.Create(doc => doc.Page(page =>
        {
            page.Size(r.Columns.Count > 6 ? PageSizes.A4.Landscape() : PageSizes.A4);
            page.Margin(1.2f, Unit.Centimetre);
            page.DefaultTextStyle(x => x.FontFamily("Arial", "Segoe UI", "Nirmala UI").FontSize(8.5f).FontColor("#1B2C42"));
            page.Header().PaddingBottom(8).Column(col =>
            {
                col.Item().Text(title).FontSize(14).Bold().FontColor("#17458F");
                col.Item().Text($"{r.Rows.Count} row(s), {DateTime.UtcNow:yyyy-MM-dd HH:mm} UTC").FontColor("#64748B");
            });
            page.Content().Table(t =>
            {
                t.ColumnsDefinition(cd => { foreach (var _ in r.Columns) cd.RelativeColumn(); });
                t.Header(h =>
                {
                    foreach (var c in r.Columns)
                        h.Cell().Background("#EDF4FB").BorderBottom(0.5f).BorderColor("#D5DEE8").Padding(3).Text(c.Label).Bold();
                });
                foreach (var row in r.Rows)
                    for (int i = 0; i < r.Columns.Count; i++)
                        t.Cell().BorderBottom(0.5f).BorderColor("#D5DEE8").Padding(3).Text(Text(row[i], r.Columns[i].Type));
            });
            page.Footer().AlignRight().Text(x => { x.CurrentPageNumber(); x.Span(" / "); x.TotalPages(); });
        })).GeneratePdf();
    }

    // ===== Email to officers =====

    /// <summary>The scope's officers: the club's Admins, or the district's Admins (district-level rows).</summary>
    public async Task<List<(string Email, string Name)>> OfficersAsync(bool club, int scopeId)
    {
        await using var c = await OpenAsync();
        var sql = $@"
            SELECT DISTINCT TRIM(m.EmailId) AS Email, m.MemberName AS Name
            FROM member_roles mr
            JOIN member_master_profile m ON m.pk_member_master_profile_id = mr.fk_member_master_profile_id AND IFNULL(m.isdeleted, 0) = 0
            WHERE mr.fk_role_id = 2 AND mr.IsActive = 1 AND mr.isdeleted = 0 AND m.EmailId LIKE '%@%'
              AND {(club ? "mr.fk_club_id = @scopeId" : "(mr.fk_club_id IS NULL OR mr.fk_club_id = 0) AND mr.fk_district_id = @scopeId")}";
        return (await c.QueryAsync<(string, string)>(sql, new { scopeId })).ToList();
    }

    /// <summary>Runs a saved report and emails it to the scope's officers. Returns how many were sent, or a problem.</summary>
    public async Task<(int Sent, string? Problem)> SendAsync(bool club, int scopeId, int id)
    {
        var report = await GetAsync(club, scopeId, id);
        if (report == null) return (0, "Report not found.");
        var (result, problem) = await RunAsync(club, scopeId, report.Definition);
        if (result == null) return (0, problem);
        var officers = await OfficersAsync(club, scopeId);
        if (officers.Count == 0) return (0, "No officer with an email address to send to.");
        var (bytes, _, ext) = Export(result, report.ScheduleFormat, report.Name);
        var file = $"{FileName(report.Name)}-{DateTime.UtcNow:yyyy-MM}.{ext}";
        var sent = 0;
        foreach (var (email, name) in officers)
        {
            try
            {
                await _email.SendScopedEmailWithAttachmentAsync(email, $"{report.Name}: {DateTime.UtcNow:MMMM yyyy}", Html(name, report.Name, result),
                    bytes, file, null, club ? scopeId : null, club ? null : scopeId, "custom_report");
                sent++;
            }
            catch (Exception ex)
            {
                // email_log keeps the failure; the other officers still get theirs
                _log.LogWarning(ex, "Custom report {ReportId} email failed for one officer", id);
            }
        }
        await using var c = await OpenAsync();
        await c.ExecuteAsync("UPDATE custom_reports SET last_sent_at = UTC_TIMESTAMP() WHERE pk_report_id = @id", new { id });
        return (sent, null);
    }

    public static string FileName(string name)
    {
        var s = new string(name.Select(ch => char.IsLetterOrDigit(ch) ? char.ToLowerInvariant(ch) : '-').ToArray()).Trim('-');
        while (s.Contains("--")) s = s.Replace("--", "-");
        return s.Length == 0 ? "report" : s[..Math.Min(s.Length, 60)];
    }

    private static string Html(string name, string report, CustomReportResult r)
    {
        static string E(string? s) => WebUtility.HtmlEncode(s ?? "");
        return $@"<div style=""font-family:Figtree, Arial,Helvetica,sans-serif;font-size:15px;color:#1B2C42;line-height:1.6;max-width:640px"">
<p>Dear {E(name)},</p>
<p>Your monthly report <strong>{E(report)}</strong> is attached ({r.Rows.Count} row(s){(r.Truncated ? ", cut at the row limit" : "")}).</p>
<p style=""color:#64748b;font-size:12px"">This is an automated message from {E(Brand.ProductName)}. A club or district admin can change or stop it under Reports > Report builder.</p>
</div>";
    }

    /// <summary>Sends every scheduled report due today (UTC day of month) that has not gone out this month.
    /// A report is claimed for the month before it is sent, so two API instances never both send it.</summary>
    public async Task<int> SendDueAsync(DateTime utcNow)
    {
        var month = utcNow.ToString("yyyy-MM", CultureInfo.InvariantCulture);
        List<Row> due;
        await using (var c = await OpenAsync())
        {
            due = (await c.QueryAsync<Row>(Select + @"
                WHERE r.isdeleted = 0 AND r.schedule_monthly = 1 AND r.schedule_day <= @day
                  AND (r.last_sent_month IS NULL OR r.last_sent_month <> @month)", new { day = utcNow.Day, month })).ToList();
        }
        var sent = 0;
        foreach (var r in due)
        {
            var club = r.ScopeType == ClubScope;
            await using (var c = await OpenAsync())
            {
                var claimed = await c.ExecuteAsync(@"
                    UPDATE custom_reports SET last_sent_month = @month WHERE pk_report_id = @Id
                      AND (last_sent_month IS NULL OR last_sent_month <> @month)", new { r.Id, month });
                if (claimed == 0) continue;
            }
            // The report's author must still manage the scope; otherwise it stops until an admin saves it again.
            if (!await ScopeWriteGuardMiddleware.AllowedAsync(_cs, r.CreatedBy, club, r.ScopeId))
            {
                _log.LogInformation("Custom report {ReportId} skipped: its author no longer manages the {Scope}", r.Id, r.ScopeType);
                continue;
            }
            var (n, problem) = await SendAsync(club, r.ScopeId, r.Id);
            if (problem != null) _log.LogInformation("Custom report {ReportId} not sent: {Problem}", r.Id, problem);
            sent += n;
        }
        return sent;
    }
}

/// <summary>Checks once an hour for scheduled custom reports that are due (CustomReportService.SendDueAsync).</summary>
public class CustomReportScheduleBackgroundService : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<CustomReportScheduleBackgroundService> _log;

    public CustomReportScheduleBackgroundService(IServiceScopeFactory scopes, ILogger<CustomReportScheduleBackgroundService> log)
    {
        _scopes = scopes;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = _scopes.CreateScope();
                await scope.ServiceProvider.GetRequiredService<CustomReportService>().SendDueAsync(DateTime.UtcNow);
            }
            catch (Exception ex) when (ex is not OperationCanceledException) { _log.LogError(ex, "Custom report schedule tick failed"); }
            try { await Task.Delay(TimeSpan.FromHours(1), stoppingToken); }
            catch (OperationCanceledException) { break; }
        }
    }
}
