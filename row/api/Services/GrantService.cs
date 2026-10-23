using System.Data;
using System.Globalization;
using System.Text;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

/// <summary>
/// District grants (ROW build spec 3.8): one cycle per district per Rotary year with a DDF budget and qualification
/// rules, club applications that move through the spec's states, recorded disbursements (not online payments), the
/// final report and closure. Club actions happen on club routes and district actions on district routes
/// (GrantsController checks who manages which). Every transition writes a grant_events row, an audit_log row and one
/// grant_notifications row per recipient: the app's bell reads those rows and GrantNotificationEmailBackgroundService
/// emails them.
/// "District on ROW" = the district has a tenant row (tenant_subscriptions, fk_club_id = 0). A club whose district
/// is not on ROW is in light mode: it only records a grant amount and a report date on its own projects.
/// </summary>
public class GrantService
{
    public const string ClubSide = "club", DistrictSide = "district";
    public const string NotOnRow = "This district is not on ROW yet (no tenant subscription). A SuperAdmin adds it in Settings > Tenants.";
    private static readonly string[] Archived = { "rejected", "closed", "cancelled" };
    private static readonly string[] EditableStates = { "draft", "information_requested", "adjustment_requested" };
    private static readonly string[] CommittedStates = { "approved", "paid", "report_submitted", "closed" };
    private static readonly string[] PayableStates = { "approved", "paid", "report_submitted" };
    private static readonly string[] CycleStates = { "draft", "open", "closed" };
    private static readonly string[] LineKinds = { "income", "expense", "partner" };
    private static readonly string[] PaymentMethods = { "bank_transfer", "cheque", "cash", "other" };
    private const decimal MaxAmount = 99_999_999m;
    private const long MaxFileBytes = 20 * 1024 * 1024;
    private const int MaxAttachments = 20;

    public sealed record Transition(string Action, string Side, string[] From, string To, bool CommentRequired);

    /// <summary>The state machine. "draft" comes before the spec's ten states; "paid" is reached by recording the
    /// first payment (RecordPaymentAsync), not by an action.</summary>
    public static readonly Transition[] Transitions =
    {
        new("submit", ClubSide, new[] { "draft" }, "submitted", false),
        new("provide_information", ClubSide, new[] { "information_requested" }, "information_provided", true),
        new("resubmit", ClubSide, new[] { "adjustment_requested" }, "submitted", false),
        new("submit_report", ClubSide, new[] { "paid" }, "report_submitted", false),
        new("cancel", ClubSide, new[] { "draft", "submitted", "information_requested", "information_provided", "adjustment_requested", "approved" }, "cancelled", false),
        new("request_information", DistrictSide, new[] { "submitted", "information_provided" }, "information_requested", true),
        new("request_adjustment", DistrictSide, new[] { "submitted", "information_provided" }, "adjustment_requested", true),
        new("approve", DistrictSide, new[] { "submitted", "information_provided" }, "approved", false),
        new("reject", DistrictSide, new[] { "submitted", "information_requested", "information_provided", "adjustment_requested" }, "rejected", true),
        new("return_report", DistrictSide, new[] { "report_submitted" }, "paid", true),
        new("close", DistrictSide, new[] { "report_submitted" }, "closed", false),
        new("cancel", DistrictSide, new[] { "approved" }, "cancelled", true),
    };

    private static readonly Dictionary<string, string> StatusLabels = new()
    {
        ["draft"] = "Draft", ["submitted"] = "Submitted", ["information_requested"] = "Information requested",
        ["information_provided"] = "Information provided", ["adjustment_requested"] = "Adjustment requested",
        ["approved"] = "Approved", ["rejected"] = "Rejected", ["paid"] = "Paid", ["report_submitted"] = "Report submitted",
        ["closed"] = "Closed", ["cancelled"] = "Cancelled",
    };

    private static readonly byte[] Zip = { 0x50, 0x4B, 0x03, 0x04 }, Ole = { 0xD0, 0xCF, 0x11, 0xE0 };
    // Allowed attachment types: the extension and the file's first bytes must agree.
    private static readonly Dictionary<string, (byte[] Magic, string ContentType)> FileTypes = new()
    {
        [".pdf"] = ("%PDF"u8.ToArray(), "application/pdf"),
        [".png"] = (new byte[] { 0x89, 0x50, 0x4E, 0x47 }, "image/png"),
        [".jpg"] = (new byte[] { 0xFF, 0xD8, 0xFF }, "image/jpeg"),
        [".jpeg"] = (new byte[] { 0xFF, 0xD8, 0xFF }, "image/jpeg"),
        [".docx"] = (Zip, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        [".xlsx"] = (Zip, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        [".pptx"] = (Zip, "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
        [".doc"] = (Ole, "application/msword"),
        [".xls"] = (Ole, "application/vnd.ms-excel"),
        [".ppt"] = (Ole, "application/vnd.ms-powerpoint"),
    };

    private readonly string _cs;
    private readonly IAuditLogService _audit;
    private readonly IYearTableResolver _years;
    private readonly string _fileRoot;

    public GrantService(IConfiguration config, IAuditLogService audit, IYearTableResolver years, IWebHostEnvironment env)
    {
        _cs = config.GetConnectionString("DefaultConnection")!;
        _audit = audit;
        _years = years;
        // Outside wwwroot: attachments are only served through GrantsController, after the scope check.
        _fileRoot = Path.Combine(env.ContentRootPath, "App_Data", "grant-files");
    }

    public static string Label(string status) => StatusLabels.GetValueOrDefault(status, status);

    // A district sees an application once it has been submitted (drafts, and drafts the club cancelled, stay private).
    private static string Scope(string side) => side == ClubSide
        ? "a.fk_club_id = @scopeId"
        : "a.fk_district_id = @scopeId AND a.submitted_at IS NOT NULL";

    private static async Task<bool> DistrictOnRowAsync(MySqlConnection c, int districtId) =>
        await c.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM tenant_subscriptions WHERE fk_district_id = @districtId AND fk_club_id = 0", new { districtId }) > 0;

    private static Task<int?> ClubDistrictAsync(MySqlConnection c, int clubId) =>
        c.ExecuteScalarAsync<int?>("SELECT fk_district_id FROM club_master WHERE pk_club_id = @clubId AND IFNULL(isdeleted, 0) = 0", new { clubId });

    private static string? Clean(string? s, int max, string what)
    {
        s = s?.Trim();
        if (string.IsNullOrEmpty(s)) return null;
        if (s.Length > max) throw new InvalidOperationException($"{what} is {max} characters at most.");
        return s;
    }

    private static string Trunc(string s, int max) => s.Length <= max ? s : s[..(max - 3)] + "...";

    // ===== Cycles (district) =====

    private const string CycleSelect = @"
        SELECT gc.pk_cycle_id AS Id, gc.fk_district_id AS DistrictId, gc.fk_year_id AS YearId, y.YearLabel,
               gc.status AS Status, gc.ddf_budget AS DdfBudget, gc.max_request AS MaxRequest,
               gc.min_qualified_members AS MinQualifiedMembers, gc.opens_on AS OpensOn, gc.closes_on AS ClosesOn,
               gc.report_due_on AS ReportDueOn, gc.rules AS Rules
        FROM grant_cycles gc
        JOIN rotary_year_master y ON y.pk_year_id = gc.fk_year_id";

    /// <summary>The district's cycles, newest year first, with approved (committed) and paid totals and the number
    /// of applications in each state: the dashboard by status and year.</summary>
    public async Task<List<GrantCycleDto>> ListCyclesAsync(int districtId)
    {
        await using var c = new MySqlConnection(_cs);
        var cycles = (await c.QueryAsync<GrantCycleDto>(CycleSelect + " WHERE gc.fk_district_id = @districtId ORDER BY y.StartDate DESC", new { districtId })).ToList();
        if (cycles.Count == 0) return cycles;
        var ids = cycles.Select(x => x.Id).ToList();
        var counts = (await c.QueryAsync<(int CycleId, string Status, long N, decimal Approved)>(@"
            SELECT fk_cycle_id, status, COUNT(*), COALESCE(SUM(amount_approved), 0)
            FROM grant_applications WHERE fk_cycle_id IN @ids AND submitted_at IS NOT NULL
            GROUP BY fk_cycle_id, status", new { ids })).ToList();
        var paid = (await c.QueryAsync<(int CycleId, decimal Paid)>(@"
            SELECT a.fk_cycle_id, SUM(p.amount) FROM grant_payments p
            JOIN grant_applications a ON a.pk_application_id = p.fk_application_id
            WHERE a.fk_cycle_id IN @ids GROUP BY a.fk_cycle_id", new { ids })).ToDictionary(x => x.CycleId, x => x.Paid);
        foreach (var cy in cycles)
        {
            foreach (var r in counts.Where(r => r.CycleId == cy.Id))
            {
                cy.StatusCounts[r.Status] = (int)r.N;
                if (CommittedStates.Contains(r.Status)) cy.Committed += r.Approved;
            }
            cy.Paid = paid.GetValueOrDefault(cy.Id);
        }
        return cycles;
    }

    /// <summary>Creates (cycleId null) or updates a cycle. The year is fixed once a cycle exists.</summary>
    public async Task<GrantCycleDto?> SaveCycleAsync(int districtId, int? cycleId, SaveGrantCycleDto dto, int memberId, HttpContext http)
    {
        var status = (dto.Status ?? "").Trim().ToLowerInvariant();
        if (!CycleStates.Contains(status)) throw new InvalidOperationException("Status must be draft, open or closed.");
        var budget = decimal.Round(dto.DdfBudget, 2);
        if (budget < 0 || budget > MaxAmount) throw new InvalidOperationException("Enter a DDF budget between 0 and 99,999,999.");
        var maxRequest = dto.MaxRequest is { } m ? decimal.Round(m, 2) : (decimal?)null;
        if (maxRequest is <= 0 or > MaxAmount) throw new InvalidOperationException("The largest grant per application must be more than 0.");
        if (dto.MinQualifiedMembers is < 0 or > 50) throw new InvalidOperationException("Qualified members must be between 0 and 50.");
        if (dto.OpensOn > dto.ClosesOn) throw new InvalidOperationException("Applications must close after they open.");
        var rules = Clean(dto.Rules, 4000, "The qualification rules");

        await using var c = new MySqlConnection(_cs);
        await c.OpenAsync();
        if (!await DistrictOnRowAsync(c, districtId)) throw new InvalidOperationException(NotOnRow);

        await using var tx = await c.BeginTransactionAsync(IsolationLevel.ReadCommitted);
        int yearId = dto.YearId;
        if (cycleId != null)
        {
            // Locked like an approval locks it, so a budget cut and an approval cannot pass each other.
            var existing = await c.QueryFirstOrDefaultAsync<int?>(
                "SELECT fk_year_id FROM grant_cycles WHERE pk_cycle_id = @cycleId AND fk_district_id = @districtId FOR UPDATE",
                new { cycleId, districtId }, tx);
            if (existing == null) return null;
            yearId = existing.Value;
            var committed = await c.ExecuteScalarAsync<decimal>(
                "SELECT COALESCE(SUM(amount_approved), 0) FROM grant_applications WHERE fk_cycle_id = @cycleId AND status IN @CommittedStates",
                new { cycleId, CommittedStates }, tx);
            if (budget < committed) throw new InvalidOperationException($"The budget cannot be less than the {committed:0.00} already approved.");
        }
        var isCurrent = await c.QueryFirstOrDefaultAsync<bool?>(
            "SELECT IsCurrent FROM rotary_year_master WHERE pk_year_id = @yearId AND isdeleted = 0", new { yearId }, tx);
        if (isCurrent == null) throw new InvalidOperationException("Choose a Rotary year.");
        // Same rule as PlanningWriteGuardMiddleware, which cannot see a year sent in the body.
        if (isCurrent == true && await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM tenant_subscriptions WHERE fk_district_id = @districtId AND fk_club_id = 0 AND state = 'planning'",
                new { districtId }, tx) > 0)
            throw new InvalidOperationException("This district is in planning: the current year is read-only. Open the cycle for next year.");

        var p = new { districtId, yearId, status, budget, maxRequest, dto.MinQualifiedMembers, dto.OpensOn, dto.ClosesOn, dto.ReportDueOn, rules, memberId, cycleId };
        var creating = cycleId == null;
        if (creating)
        {
            try
            {
                cycleId = await c.ExecuteScalarAsync<int>(@"
                    INSERT INTO grant_cycles (fk_district_id, fk_year_id, status, ddf_budget, max_request, min_qualified_members,
                        opens_on, closes_on, report_due_on, rules, created_by)
                    VALUES (@districtId, @yearId, @status, @budget, @maxRequest, @MinQualifiedMembers,
                        @OpensOn, @ClosesOn, @ReportDueOn, @rules, @memberId);
                    SELECT LAST_INSERT_ID();", p, tx);
            }
            catch (MySqlException ex) when (ex.ErrorCode == MySqlErrorCode.DuplicateKeyEntry)
            {
                throw new InvalidOperationException("This district already has a grant cycle for that year.");
            }
        }
        else
        {
            await c.ExecuteAsync(@"
                UPDATE grant_cycles SET status = @status, ddf_budget = @budget, max_request = @maxRequest,
                    min_qualified_members = @MinQualifiedMembers, opens_on = @OpensOn, closes_on = @ClosesOn,
                    report_due_on = @ReportDueOn, rules = @rules, modified_by = @memberId
                WHERE pk_cycle_id = @cycleId AND fk_district_id = @districtId", p, tx);
        }
        await tx.CommitAsync();
        await _audit.LogAsync(memberId, creating ? "CREATE" : "UPDATE", "grant_cycle", cycleId, null,
            new { districtId, yearId, status, budget }, http);
        return (await ListCyclesAsync(districtId)).First(x => x.Id == cycleId);
    }

    /// <summary>Payments of a cycle in date order with the running total paid and what is left of the DDF budget.</summary>
    public async Task<GrantCashFlowDto?> GetCashFlowAsync(int districtId, int cycleId)
    {
        var cycle = (await ListCyclesAsync(districtId)).FirstOrDefault(x => x.Id == cycleId);
        if (cycle == null) return null;
        await using var c = new MySqlConnection(_cs);
        var rows = (await c.QueryAsync<GrantCashFlowRowDto>(@"
            SELECT p.paid_on AS PaidOn, cm.ClubName, a.title AS Title, p.amount AS Amount, p.method AS Method, p.reference AS Reference
            FROM grant_payments p
            JOIN grant_applications a ON a.pk_application_id = p.fk_application_id
            JOIN club_master cm ON cm.pk_club_id = a.fk_club_id
            WHERE a.fk_cycle_id = @cycleId AND a.fk_district_id = @districtId
            ORDER BY p.paid_on, p.pk_payment_id", new { cycleId, districtId })).ToList();
        decimal running = 0;
        foreach (var r in rows)
        {
            running += r.Amount;
            r.CumulativePaid = running;
            r.Balance = cycle.DdfBudget - running;
        }
        return new GrantCashFlowDto { Budget = cycle.DdfBudget, Committed = cycle.Committed, Paid = cycle.Paid, Rows = rows };
    }

    /// <summary>Every submitted application of a cycle as CSV (archived ones included).</summary>
    public async Task<string?> ExportCsvAsync(int districtId, int cycleId)
    {
        await using var c = new MySqlConnection(_cs);
        if (await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM grant_cycles WHERE pk_cycle_id = @cycleId AND fk_district_id = @districtId",
                new { cycleId, districtId }) == 0) return null;
        var rows = await ListAsync(c, DistrictSide, districtId, cycleId, null, null);
        var sb = new StringBuilder("Year,Club,Project,Status,Requested,Approved,Paid,Outstanding,Submitted\r\n");
        foreach (var r in rows)
            sb.AppendJoin(',', new[]
            {
                r.YearLabel, r.ClubName, r.Title, Label(r.Status), Money(r.AmountRequested), Money(r.AmountApproved),
                Money(r.Paid), Money((r.AmountApproved ?? 0) - r.Paid), r.SubmittedAt?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            }.Select(Csv)).Append("\r\n");
        return sb.ToString();
    }

    private static string Money(decimal? v) => v?.ToString("0.00", CultureInfo.InvariantCulture) ?? "";

    // Quotes every cell; a cell starting with = + - @ is prefixed with ' so a spreadsheet never runs it as a formula.
    private static string Csv(string? v)
    {
        v ??= "";
        if (v.Length > 0 && "=+-@\t\r".Contains(v[0])) v = "'" + v;
        return "\"" + v.Replace("\"", "\"\"") + "\"";
    }

    // ===== Applications: lists and detail =====

    private const string ListSelect = @"
        SELECT a.pk_application_id AS Id, a.fk_cycle_id AS CycleId, y.YearLabel, a.fk_club_id AS ClubId, c.ClubName,
               a.title AS Title, a.status AS Status, a.amount_requested AS AmountRequested, a.amount_approved AS AmountApproved,
               (SELECT COALESCE(SUM(p.amount), 0) FROM grant_payments p WHERE p.fk_application_id = a.pk_application_id) AS Paid,
               a.submitted_at AS SubmittedAt, COALESCE(a.modified_date, a.created_date) AS UpdatedAt
        FROM grant_applications a
        JOIN grant_cycles gc ON gc.pk_cycle_id = a.fk_cycle_id
        JOIN rotary_year_master y ON y.pk_year_id = gc.fk_year_id
        JOIN club_master c ON c.pk_club_id = a.fk_club_id";

    public async Task<List<GrantApplicationListItemDto>> ListDistrictApplicationsAsync(int districtId, int? cycleId, string? status, bool? archived)
    {
        await using var c = new MySqlConnection(_cs);
        return await ListAsync(c, DistrictSide, districtId, cycleId, status, archived);
    }

    private static async Task<List<GrantApplicationListItemDto>> ListAsync(MySqlConnection c, string side, int scopeId, int? cycleId, string? status, bool? archived)
    {
        var where = new StringBuilder(Scope(side));
        if (cycleId != null) where.Append(" AND a.fk_cycle_id = @cycleId");
        if (!string.IsNullOrEmpty(status)) where.Append(" AND a.status = @status");
        if (archived == true) where.Append(" AND a.status IN @Archived");
        if (archived == false) where.Append(" AND a.status NOT IN @Archived");
        // shortcut: no paging, the 1000 most recently changed; add paging when a district passes that in a year.
        return (await c.QueryAsync<GrantApplicationListItemDto>(
            $"{ListSelect} WHERE {where} ORDER BY UpdatedAt DESC, a.pk_application_id DESC LIMIT 1000",
            new { scopeId, cycleId, status, Archived })).ToList();
    }

    /// <summary>The club's own view: light mode, or its district's published cycles and the club's applications.</summary>
    public async Task<GrantClubOverviewDto?> GetClubOverviewAsync(int clubId)
    {
        await using var c = new MySqlConnection(_cs);
        var districtId = await ClubDistrictAsync(c, clubId);
        if (districtId == null) return null;
        if (!await DistrictOnRowAsync(c, districtId.Value)) return new GrantClubOverviewDto { LightMode = true };
        return new GrantClubOverviewDto
        {
            Cycles = (await c.QueryAsync<GrantCycleDto>(
                CycleSelect + " WHERE gc.fk_district_id = @districtId AND gc.status <> 'draft' ORDER BY y.StartDate DESC", new { districtId })).ToList(),
            Applications = await ListAsync(c, ClubSide, clubId, null, null, null),
        };
    }

    public async Task<GrantApplicationDto?> GetApplicationAsync(string side, int scopeId, int id)
    {
        await using var c = new MySqlConnection(_cs);
        var a = await c.QueryFirstOrDefaultAsync<GrantApplicationDto>($@"
            SELECT a.pk_application_id AS Id, a.fk_cycle_id AS CycleId, y.YearLabel, a.fk_club_id AS ClubId, c.ClubName,
                   a.title AS Title, a.status AS Status, a.amount_requested AS AmountRequested, a.amount_approved AS AmountApproved,
                   a.submitted_at AS SubmittedAt, COALESCE(a.modified_date, a.created_date) AS UpdatedAt,
                   a.fk_district_id AS DistrictId, a.description AS Description, a.location AS Location,
                   a.start_date AS StartDate, a.end_date AS EndDate, a.beneficiaries AS Beneficiaries,
                   a.rules_accepted AS RulesAccepted, a.rejection_reason AS RejectionReason,
                   a.report_summary AS ReportSummary, a.report_amount_spent AS ReportAmountSpent,
                   a.report_beneficiaries AS ReportBeneficiaries, a.report_submitted_at AS ReportSubmittedAt,
                   a.closed_at AS ClosedAt, m.MemberName AS CreatedByName
            FROM grant_applications a
            JOIN grant_cycles gc ON gc.pk_cycle_id = a.fk_cycle_id
            JOIN rotary_year_master y ON y.pk_year_id = gc.fk_year_id
            JOIN club_master c ON c.pk_club_id = a.fk_club_id
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = a.created_by
            WHERE a.pk_application_id = @id AND {Scope(side)}", new { id, scopeId });
        if (a == null) return null;

        using (var multi = await c.QueryMultipleAsync(CycleSelect + @" WHERE gc.pk_cycle_id = @cycleId;
            SELECT kind AS Kind, description AS Description, detail AS Detail, amount AS Amount
            FROM grant_application_lines WHERE fk_application_id = @id ORDER BY sort_order, pk_line_id;
            SELECT gm.fk_member_id AS MemberId, m.MemberName, gm.note AS Note
            FROM grant_application_members gm LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = gm.fk_member_id
            WHERE gm.fk_application_id = @id ORDER BY m.MemberName;
            SELECT pk_attachment_id AS Id, kind AS Kind, original_name AS OriginalName, size_bytes AS SizeBytes, created_date AS CreatedDate
            FROM grant_attachments WHERE fk_application_id = @id ORDER BY pk_attachment_id;
            SELECT e.pk_event_id AS Id, e.side AS Side, e.action AS Action, e.from_status AS FromStatus, e.to_status AS ToStatus,
                   e.comment AS Comment, m.MemberName, e.created_date AS CreatedDate
            FROM grant_events e LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = e.fk_member_id
            WHERE e.fk_application_id = @id ORDER BY e.pk_event_id;
            SELECT p.pk_payment_id AS Id, p.amount AS Amount, p.paid_on AS PaidOn, p.method AS Method, p.reference AS Reference,
                   p.note AS Note, m.MemberName AS RecordedByName
            FROM grant_payments p LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = p.recorded_by
            WHERE p.fk_application_id = @id ORDER BY p.paid_on, p.pk_payment_id;", new { id, cycleId = a.CycleId }))
        {
            a.Cycle = await multi.ReadFirstAsync<GrantCycleDto>();
            a.Lines = (await multi.ReadAsync<GrantLineDto>()).ToList();
            a.Members = (await multi.ReadAsync<GrantMemberDto>()).ToList();
            a.Attachments = (await multi.ReadAsync<GrantAttachmentDto>()).ToList();
            a.Events = (await multi.ReadAsync<GrantEventDto>()).ToList();
            a.Payments = (await multi.ReadAsync<GrantPaymentDto>()).ToList();
        }
        a.Paid = a.Payments.Sum(p => p.Amount);
        a.Actions = Transitions.Where(t => t.Side == side && t.From.Contains(a.Status))
            .Select(t => new GrantActionInfoDto { Action = t.Action, To = t.To, CommentRequired = t.CommentRequired }).ToList();
        a.Editable = side == ClubSide && EditableStates.Contains(a.Status);
        a.AttachmentKind = side == ClubSide ? AttachmentKind(a.Status) : null;
        a.CanRecordPayment = side == DistrictSide && PayableStates.Contains(a.Status);
        return a;
    }

    // Club files: application papers while the form is editable, report papers while the report is due.
    private static string? AttachmentKind(string status) =>
        EditableStates.Contains(status) ? "application" : status == "paid" ? "report" : null;

    // ===== Applications: club writes =====

    private static void Normalize(SaveGrantApplicationDto d)
    {
        d.Title = (d.Title ?? "").Trim();
        if (d.Title.Length is 0 or > 200) throw new InvalidOperationException("Enter a project title (200 characters at most).");
        d.Description = Clean(d.Description, 8000, "The project description");
        d.Location = Clean(d.Location, 200, "The location");
        if (d.StartDate > d.EndDate) throw new InvalidOperationException("The project must end after it starts.");
        if (d.Beneficiaries is < 0 or > 100_000_000) throw new InvalidOperationException("Beneficiaries must be 0 or more.");
        d.AmountRequested = decimal.Round(d.AmountRequested, 2);
        if (d.AmountRequested < 0 || d.AmountRequested > MaxAmount) throw new InvalidOperationException("The amount requested is out of range.");
        d.Lines ??= new();
        d.Members ??= new();
        if (d.Lines.Count > 100) throw new InvalidOperationException("An application has at most 100 budget lines and partners.");
        if (d.Members.Count > 100) throw new InvalidOperationException("An application lists at most 100 qualified members.");
        foreach (var l in d.Lines)
        {
            l.Kind = (l.Kind ?? "").Trim().ToLowerInvariant();
            if (!LineKinds.Contains(l.Kind)) throw new InvalidOperationException("Each line is income, expense or partner.");
            l.Description = (l.Description ?? "").Trim();
            if (l.Description.Length is 0 or > 300) throw new InvalidOperationException("Each budget line and partner needs a description (300 characters at most).");
            l.Detail = Clean(l.Detail, 300, "A line's detail");
            if (l.Kind != "partner" && l.Amount == null) throw new InvalidOperationException("Each income and expense line needs an amount.");
            l.Amount = l.Amount is { } a ? decimal.Round(a, 2) : null;
            if (l.Amount is < 0 or > MaxAmount) throw new InvalidOperationException("A line amount is out of range.");
        }
        if (d.Members.Select(x => x.MemberId).Distinct().Count() != d.Members.Count) throw new InvalidOperationException("A member is listed twice.");
        foreach (var m in d.Members) m.Note = Clean(m.Note, 200, "A member note");
    }

    // Qualified members must be active members of the applying club.
    private static async Task CheckMembersAsync(MySqlConnection c, MySqlTransaction? tx, int clubId, List<int> ids)
    {
        if (ids.Count == 0) return;
        var active = await c.ExecuteScalarAsync<int>(@"
            SELECT COUNT(DISTINCT fk_member_master_profile_id) FROM club_members
            WHERE fk_club_id = @clubId AND IsActive = 1 AND IFNULL(isdeleted, 0) = 0 AND fk_member_master_profile_id IN @ids",
            new { clubId, ids }, tx);
        if (active != ids.Distinct().Count()) throw new InvalidOperationException("Qualified members must be active members of the club.");
    }

    private static async Task SaveChildrenAsync(MySqlConnection c, MySqlTransaction tx, int id, SaveGrantApplicationDto d)
    {
        await c.ExecuteAsync(@"DELETE FROM grant_application_lines WHERE fk_application_id = @id;
            DELETE FROM grant_application_members WHERE fk_application_id = @id;", new { id }, tx);
        if (d.Lines.Count > 0)
            await c.ExecuteAsync(@"INSERT INTO grant_application_lines (fk_application_id, kind, description, detail, amount, sort_order)
                VALUES (@id, @Kind, @Description, @Detail, @Amount, @Sort)",
                d.Lines.Select((l, i) => new { id, l.Kind, l.Description, l.Detail, l.Amount, Sort = i }), tx);
        if (d.Members.Count > 0)
            await c.ExecuteAsync("INSERT INTO grant_application_members (fk_application_id, fk_member_id, note) VALUES (@id, @MemberId, @Note)",
                d.Members.Select(m => new { id, m.MemberId, m.Note }), tx);
    }

    /// <summary>Starts a draft in an open cycle of the club's district.</summary>
    public async Task<int> CreateApplicationAsync(int clubId, SaveGrantApplicationDto dto, int memberId, HttpContext http)
    {
        Normalize(dto);
        await using var c = new MySqlConnection(_cs);
        await c.OpenAsync();
        var districtId = await ClubDistrictAsync(c, clubId) ?? throw new InvalidOperationException("Club not found.");
        if (!await DistrictOnRowAsync(c, districtId))
            throw new InvalidOperationException("Your district does not run its grants on ROW: record grant amounts on your projects instead.");
        if (await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM grant_cycles WHERE pk_cycle_id = @CycleId AND fk_district_id = @districtId AND status = 'open'",
                new { dto.CycleId, districtId }) == 0)
            throw new InvalidOperationException("This grant cycle is not open for applications.");
        await CheckMembersAsync(c, null, clubId, dto.Members.Select(x => x.MemberId).ToList());

        await using var tx = await c.BeginTransactionAsync(IsolationLevel.ReadCommitted);
        var id = await c.ExecuteScalarAsync<int>(@"
            INSERT INTO grant_applications (fk_cycle_id, fk_district_id, fk_club_id, title, description, location, start_date,
                end_date, beneficiaries, amount_requested, rules_accepted, created_by)
            VALUES (@CycleId, @districtId, @clubId, @Title, @Description, @Location, @StartDate,
                @EndDate, @Beneficiaries, @AmountRequested, @RulesAccepted, @memberId);
            SELECT LAST_INSERT_ID();",
            new { dto.CycleId, districtId, clubId, dto.Title, dto.Description, dto.Location, dto.StartDate, dto.EndDate,
                  dto.Beneficiaries, dto.AmountRequested, dto.RulesAccepted, memberId }, tx);
        await SaveChildrenAsync(c, tx, id, dto);
        await tx.CommitAsync();
        await _audit.LogAsync(memberId, "CREATE", "grant_application", id, dto.Title, new { clubId, dto.CycleId }, http);
        return id;
    }

    /// <summary>Saves the form while the club may change it (draft, information or adjustment requested).</summary>
    public async Task<bool> UpdateApplicationAsync(int clubId, int id, SaveGrantApplicationDto dto, int memberId, HttpContext http)
    {
        Normalize(dto);
        await using var c = new MySqlConnection(_cs);
        await c.OpenAsync();
        await using var tx = await c.BeginTransactionAsync(IsolationLevel.ReadCommitted);
        var app = await LockAsync(c, tx, ClubSide, clubId, id);
        if (app == null) return false;
        if (!EditableStates.Contains(app.Status)) throw new InvalidOperationException("This application cannot be changed now.");
        await CheckMembersAsync(c, tx, clubId, dto.Members.Select(x => x.MemberId).ToList());
        await c.ExecuteAsync(@"
            UPDATE grant_applications SET title = @Title, description = @Description, location = @Location,
                start_date = @StartDate, end_date = @EndDate, beneficiaries = @Beneficiaries,
                amount_requested = @AmountRequested, rules_accepted = @RulesAccepted, modified_by = @memberId
            WHERE pk_application_id = @id",
            new { dto.Title, dto.Description, dto.Location, dto.StartDate, dto.EndDate, dto.Beneficiaries,
                  dto.AmountRequested, dto.RulesAccepted, memberId, id }, tx);
        await SaveChildrenAsync(c, tx, id, dto);
        await tx.CommitAsync();
        await _audit.LogAsync(memberId, "UPDATE", "grant_application", id, dto.Title, new { app.Status }, http);
        return true;
    }

    // ===== Transitions, comments, payments =====

    private sealed class AppRow
    {
        public int Id { get; set; }
        public int CycleId { get; set; }
        public int DistrictId { get; set; }
        public int ClubId { get; set; }
        public string ClubName { get; set; } = "";
        public string YearLabel { get; set; } = "";
        public string Status { get; set; } = "";
        public string Title { get; set; } = "";
        public string? Description { get; set; }
        public decimal AmountRequested { get; set; }
        public decimal? AmountApproved { get; set; }
        public bool RulesAccepted { get; set; }
        public int CreatedBy { get; set; }
        public DateTime? SubmittedAt { get; set; }
        public string CycleStatus { get; set; } = "";
        public DateTime? OpensOn { get; set; }
        public DateTime? ClosesOn { get; set; }
        public decimal? MaxRequest { get; set; }
        public int MinQualifiedMembers { get; set; }
        public decimal DdfBudget { get; set; }
    }

    private sealed class Recipient
    {
        public int MemberId { get; set; }
        public string Side { get; set; } = "";
    }

    /// <summary>Locks the application row, then reads it within the caller's scope (null: not found or not theirs).</summary>
    private static async Task<AppRow?> LockAsync(MySqlConnection c, MySqlTransaction tx, string side, int scopeId, int id)
    {
        await c.ExecuteScalarAsync<int?>("SELECT pk_application_id FROM grant_applications WHERE pk_application_id = @id FOR UPDATE", new { id }, tx);
        return await c.QueryFirstOrDefaultAsync<AppRow>($@"
            SELECT a.pk_application_id AS Id, a.fk_cycle_id AS CycleId, a.fk_district_id AS DistrictId, a.fk_club_id AS ClubId,
                   c.ClubName, y.YearLabel, a.status AS Status, a.title AS Title, a.description AS Description,
                   a.amount_requested AS AmountRequested, a.amount_approved AS AmountApproved, a.rules_accepted AS RulesAccepted,
                   a.created_by AS CreatedBy, a.submitted_at AS SubmittedAt, gc.status AS CycleStatus, gc.opens_on AS OpensOn,
                   gc.closes_on AS ClosesOn, gc.max_request AS MaxRequest, gc.min_qualified_members AS MinQualifiedMembers,
                   gc.ddf_budget AS DdfBudget
            FROM grant_applications a
            JOIN grant_cycles gc ON gc.pk_cycle_id = a.fk_cycle_id
            JOIN rotary_year_master y ON y.pk_year_id = gc.fk_year_id
            JOIN club_master c ON c.pk_club_id = a.fk_club_id
            WHERE a.pk_application_id = @id AND {Scope(side)}", new { id, scopeId }, tx);
    }

    /// <summary>The cycle's qualification rules, checked when the club submits (first) or resubmits.</summary>
    private static async Task CheckSubmittableAsync(MySqlConnection c, MySqlTransaction tx, AppRow app, bool first)
    {
        if (first)
        {
            if (app.CycleStatus != "open") throw new InvalidOperationException("This grant cycle is not open for applications.");
            if (app.OpensOn > DateTime.Today) throw new InvalidOperationException($"Applications open on {app.OpensOn:yyyy-MM-dd}.");
            if (app.ClosesOn < DateTime.Today) throw new InvalidOperationException($"Applications closed on {app.ClosesOn:yyyy-MM-dd}.");
        }
        if (string.IsNullOrWhiteSpace(app.Description)) throw new InvalidOperationException("Describe the project before submitting.");
        if (app.AmountRequested <= 0) throw new InvalidOperationException("Enter the amount requested.");
        if (app.MaxRequest is { } max && app.AmountRequested > max)
            throw new InvalidOperationException($"This cycle funds at most {max:0.00} per application.");
        var (income, expense) = await c.QueryFirstAsync<(decimal Income, decimal Expense)>(@"
            SELECT COALESCE(SUM(CASE WHEN kind = 'income' THEN amount END), 0), COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount END), 0)
            FROM grant_application_lines WHERE fk_application_id = @Id", new { app.Id }, tx);
        if (expense <= 0) throw new InvalidOperationException("Add the project's expenses to the budget.");
        if (app.AmountRequested > expense - income)
            throw new InvalidOperationException($"The amount requested cannot be more than expenses minus other income ({expense - income:0.00}).");
        var members = (await c.QueryAsync<int>("SELECT fk_member_id FROM grant_application_members WHERE fk_application_id = @Id", new { app.Id }, tx)).ToList();
        if (members.Count < app.MinQualifiedMembers)
            throw new InvalidOperationException($"This cycle needs at least {app.MinQualifiedMembers} qualified members on the application.");
        await CheckMembersAsync(c, tx, app.ClubId, members);
        if (!app.RulesAccepted) throw new InvalidOperationException("Confirm that the club meets the cycle's qualification rules.");
    }

    public async Task<GrantApplicationDto?> TransitionAsync(string side, int scopeId, int id, string action, GrantActionDto dto, int memberId, HttpContext http)
    {
        var t = Transitions.FirstOrDefault(x => x.Action == action && x.Side == side)
            ?? throw new InvalidOperationException("This action is not available here.");
        var comment = Clean(dto.Comment, 4000, "The comment");
        if (t.CommentRequired && comment == null)
            throw new InvalidOperationException(t.To == "rejected" ? "Give the reason for the rejection." : "Add a comment explaining what is needed.");

        await using var c = new MySqlConnection(_cs);
        await c.OpenAsync();
        await using var tx = await c.BeginTransactionAsync(IsolationLevel.ReadCommitted);
        var app = await LockAsync(c, tx, side, scopeId, id);
        if (app == null) return null;
        if (!t.From.Contains(app.Status))
            throw new InvalidOperationException($"This is not possible while the application is {Label(app.Status).ToLowerInvariant()}.");

        // Extra columns per transition: constant SQL, values as parameters.
        var set = "";
        var p = new DynamicParameters(new { id, memberId, to = t.To, from = app.Status });
        decimal? amount = null;
        switch (t.Action)
        {
            case "submit":
            case "resubmit":
                await CheckSubmittableAsync(c, tx, app, t.Action == "submit");
                set = ", submitted_at = NOW()";
                break;
            case "approve":
                amount = decimal.Round(dto.Amount ?? 0, 2);
                if (amount <= 0 || amount > app.AmountRequested)
                    throw new InvalidOperationException("Approve an amount above 0 and no more than the amount requested.");
                // The cycle row lock serialises approvals, so two at once cannot overspend the DDF budget.
                await c.ExecuteScalarAsync<int?>("SELECT pk_cycle_id FROM grant_cycles WHERE pk_cycle_id = @CycleId FOR UPDATE", new { app.CycleId }, tx);
                var committed = await c.ExecuteScalarAsync<decimal>(@"
                    SELECT COALESCE(SUM(amount_approved), 0) FROM grant_applications
                    WHERE fk_cycle_id = @CycleId AND status IN @CommittedStates AND pk_application_id <> @id",
                    new { app.CycleId, CommittedStates, id }, tx);
                if (committed + amount > app.DdfBudget)
                    throw new InvalidOperationException($"This would exceed the cycle's DDF budget: {app.DdfBudget - committed:0.00} is left.");
                set = ", amount_approved = @amount";
                p.Add("amount", amount);
                break;
            case "reject":
                set = ", rejection_reason = @comment";
                p.Add("comment", comment);
                break;
            case "submit_report":
                var summary = Clean(dto.ReportSummary, 8000, "The report") ?? throw new InvalidOperationException("Write the report summary.");
                if (dto.ReportAmountSpent is not { } spent || spent < 0 || spent > MaxAmount) throw new InvalidOperationException("Enter the amount spent.");
                if (dto.ReportBeneficiaries is < 0 or > 100_000_000) throw new InvalidOperationException("Beneficiaries must be 0 or more.");
                set = ", report_summary = @summary, report_amount_spent = @spent, report_beneficiaries = @beneficiaries, report_submitted_at = NOW()";
                p.Add("summary", summary);
                p.Add("spent", decimal.Round(spent, 2));
                p.Add("beneficiaries", dto.ReportBeneficiaries);
                break;
            case "close":
                set = ", closed_at = NOW()";
                break;
        }
        await c.ExecuteAsync($"UPDATE grant_applications SET status = @to, modified_by = @memberId{set} WHERE pk_application_id = @id AND status = @from", p, tx);
        await RecordEventAsync(c, tx, app, memberId, side, t.Action, app.Status, t.To, comment);
        await tx.CommitAsync();
        await _audit.LogAsync(memberId, t.Action.ToUpperInvariant(), "grant_application", id, app.Title, new { from = app.Status, to = t.To, amount }, http);
        return await GetApplicationAsync(side, scopeId, id);
    }

    // shortcut: every comment is shared by the club and the district, add district-only notes if reviewers ask for them.
    public async Task<GrantApplicationDto?> CommentAsync(string side, int scopeId, int id, string? text, int memberId, HttpContext http)
    {
        var comment = Clean(text, 4000, "The comment") ?? throw new InvalidOperationException("Write a comment.");
        await using var c = new MySqlConnection(_cs);
        await c.OpenAsync();
        await using var tx = await c.BeginTransactionAsync(IsolationLevel.ReadCommitted);
        var app = await LockAsync(c, tx, side, scopeId, id);
        if (app == null) return null;
        await RecordEventAsync(c, tx, app, memberId, side, "comment", null, null, comment);
        await tx.CommitAsync();
        await _audit.LogAsync(memberId, "COMMENT", "grant_application", id, app.Title, null, http);
        return await GetApplicationAsync(side, scopeId, id);
    }

    /// <summary>Records a disbursement. The first one moves an approved application to paid; payments never exceed
    /// the approved amount.</summary>
    public async Task<GrantApplicationDto?> RecordPaymentAsync(int districtId, int id, RecordGrantPaymentDto dto, int memberId, HttpContext http)
    {
        var amount = decimal.Round(dto.Amount, 2);
        if (amount <= 0 || amount > MaxAmount) throw new InvalidOperationException("Enter the amount paid.");
        if (dto.PaidOn is not { } paidOn) throw new InvalidOperationException("Enter the payment date.");
        if (paidOn.Date > DateTime.Today.AddDays(1)) throw new InvalidOperationException("The payment date cannot be in the future.");
        var method = (dto.Method ?? "").Trim().ToLowerInvariant();
        if (!PaymentMethods.Contains(method)) throw new InvalidOperationException("Choose how the grant was paid.");
        var reference = Clean(dto.Reference, 100, "The reference");
        var note = Clean(dto.Note, 500, "The note");

        await using var c = new MySqlConnection(_cs);
        await c.OpenAsync();
        await using var tx = await c.BeginTransactionAsync(IsolationLevel.ReadCommitted);
        var app = await LockAsync(c, tx, DistrictSide, districtId, id);
        if (app == null) return null;
        if (!PayableStates.Contains(app.Status)) throw new InvalidOperationException("Payments can be recorded once the grant is approved.");
        var approved = app.AmountApproved ?? 0;
        var paid = await c.ExecuteScalarAsync<decimal>("SELECT COALESCE(SUM(amount), 0) FROM grant_payments WHERE fk_application_id = @id", new { id }, tx);
        if (paid + amount > approved)
            throw new InvalidOperationException($"Payments cannot exceed the approved amount: {approved - paid:0.00} is left to pay.");
        await c.ExecuteAsync(@"
            INSERT INTO grant_payments (fk_application_id, amount, paid_on, method, reference, note, recorded_by)
            VALUES (@id, @amount, @paidOn, @method, @reference, @note, @memberId)",
            new { id, amount, paidOn = paidOn.Date, method, reference, note, memberId }, tx);
        var to = app.Status == "approved" ? "paid" : app.Status;
        if (to != app.Status)
            await c.ExecuteAsync("UPDATE grant_applications SET status = 'paid', modified_by = @memberId WHERE pk_application_id = @id", new { id, memberId }, tx);
        var text = $"{amount:0.00} paid on {paidOn:yyyy-MM-dd} by {method.Replace('_', ' ')}{(reference == null ? "" : ", reference " + reference)}.";
        await RecordEventAsync(c, tx, app, memberId, DistrictSide, "payment", app.Status, to, text);
        await tx.CommitAsync();
        await _audit.LogAsync(memberId, "PAYMENT", "grant_application", id, app.Title, new { amount, paidOn = paidOn.Date, from = app.Status, to }, http);
        return await GetApplicationAsync(DistrictSide, districtId, id);
    }

    /// <summary>History row plus one notification per recipient (in the same transaction): whoever created the
    /// application, the club's admins and, once the district can see the application, the district's admins;
    /// never the person who acted.</summary>
    private static async Task RecordEventAsync(MySqlConnection c, MySqlTransaction tx, AppRow app, int memberId, string side,
        string action, string? from, string? to, string? comment)
    {
        var eventId = await c.ExecuteScalarAsync<int>(@"
            INSERT INTO grant_events (fk_application_id, fk_member_id, side, action, from_status, to_status, comment)
            VALUES (@Id, @memberId, @side, @action, @from, @to, @comment);
            SELECT LAST_INSERT_ID();", new { app.Id, memberId, side, action, from, to, comment }, tx);

        var withDistrict = app.SubmittedAt != null || to == "submitted";
        var recipients = (await c.QueryAsync<Recipient>(@"
            SELECT @CreatedBy AS MemberId, 'club' AS Side
            UNION ALL
            SELECT fk_member_master_profile_id, 'club' FROM member_roles
            WHERE fk_role_id = 2 AND fk_club_id = @ClubId AND IsActive = 1 AND isdeleted = 0
            UNION ALL
            SELECT fk_member_master_profile_id, 'district' FROM member_roles
            WHERE @withDistrict = 1 AND fk_role_id = 2 AND (fk_club_id IS NULL OR fk_club_id = 0)
              AND fk_district_id = @DistrictId AND IsActive = 1 AND isdeleted = 0",
            new { app.CreatedBy, app.ClubId, app.DistrictId, withDistrict }, tx))
            .Where(r => r.MemberId != memberId)
            .GroupBy(r => r.MemberId)
            .Select(g => new { MemberId = g.Key, Side = g.Any(x => x.Side == DistrictSide) ? DistrictSide : ClubSide })
            .ToList();
        if (recipients.Count == 0) return;

        var title = Trunc(action switch
        {
            "comment" => $"New comment on a grant application: {app.Title}",
            "payment" => $"Grant payment recorded: {app.Title}",
            _ => $"Grant application {Label(to ?? "").ToLowerInvariant()}: {app.Title}",
        }, 250);
        var body = Trunc($"{app.ClubName}, {app.YearLabel}." + (comment == null ? "" : " " + comment), 600);
        await c.ExecuteAsync(@"
            INSERT INTO grant_notifications (fk_member_id, fk_application_id, fk_event_id, side, title, body)
            VALUES (@MemberId, @appId, @eventId, @Side, @title, @body)",
            recipients.Select(r => new { r.MemberId, r.Side, appId = app.Id, eventId, title, body }), tx);
    }

    // ===== Attachments =====

    public async Task<GrantAttachmentDto?> AddAttachmentAsync(int clubId, int id, IFormFile file, int memberId, HttpContext http)
    {
        if (file == null || file.Length == 0) throw new InvalidOperationException("Choose a file.");
        if (file.Length > MaxFileBytes) throw new InvalidOperationException("Files must be 20 MB or smaller.");
        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (!FileTypes.TryGetValue(ext, out var type)) throw new InvalidOperationException("Allowed files: PDF, Word, Excel, PowerPoint, JPG and PNG.");
        var head = new byte[8];
        await using (var s = file.OpenReadStream()) await s.ReadAtLeastAsync(head, head.Length, throwOnEndOfStream: false);
        if (!head.AsSpan().StartsWith(type.Magic)) throw new InvalidOperationException("The file's content does not match its type.");
        var name = Path.GetFileName(file.FileName);
        if (name.Length > 255) name = name[..(255 - ext.Length)] + ext;

        await using var c = new MySqlConnection(_cs);
        await c.OpenAsync();
        await using var tx = await c.BeginTransactionAsync(IsolationLevel.ReadCommitted);
        var app = await LockAsync(c, tx, ClubSide, clubId, id);
        if (app == null) return null;
        var kind = AttachmentKind(app.Status) ?? throw new InvalidOperationException("Files cannot be added to this application now.");
        if (await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM grant_attachments WHERE fk_application_id = @id", new { id }, tx) >= MaxAttachments)
            throw new InvalidOperationException($"An application holds at most {MaxAttachments} files.");

        var stored = Guid.NewGuid().ToString("N") + ext;
        var dir = Path.Combine(_fileRoot, id.ToString(CultureInfo.InvariantCulture));
        var path = Path.Combine(dir, stored);
        Directory.CreateDirectory(dir);
        await using (var fs = new FileStream(path, FileMode.CreateNew)) await file.CopyToAsync(fs);
        try
        {
            var attId = await c.ExecuteScalarAsync<int>(@"
                INSERT INTO grant_attachments (fk_application_id, kind, original_name, stored_name, size_bytes, uploaded_by)
                VALUES (@id, @kind, @name, @stored, @size, @memberId);
                SELECT LAST_INSERT_ID();", new { id, kind, name, stored, size = (int)file.Length, memberId }, tx);
            await tx.CommitAsync();
            await _audit.LogAsync(memberId, "UPLOAD", "grant_application", id, app.Title, new { attachmentId = attId, kind }, http);
            return new GrantAttachmentDto { Id = attId, Kind = kind, OriginalName = name, SizeBytes = (int)file.Length, CreatedDate = DateTime.Now };
        }
        catch
        {
            File.Delete(path);
            throw;
        }
    }

    public async Task<bool> DeleteAttachmentAsync(int clubId, int id, int attachmentId, int memberId, HttpContext http)
    {
        await using var c = new MySqlConnection(_cs);
        await c.OpenAsync();
        await using var tx = await c.BeginTransactionAsync(IsolationLevel.ReadCommitted);
        var app = await LockAsync(c, tx, ClubSide, clubId, id);
        if (app == null) return false;
        var att = await c.QueryFirstOrDefaultAsync<(string Kind, string Stored)?>(
            "SELECT kind, stored_name FROM grant_attachments WHERE pk_attachment_id = @attachmentId AND fk_application_id = @id",
            new { attachmentId, id }, tx);
        if (att == null) return false;
        if (AttachmentKind(app.Status) != att.Value.Kind) throw new InvalidOperationException("This file cannot be removed now.");
        await c.ExecuteAsync("DELETE FROM grant_attachments WHERE pk_attachment_id = @attachmentId", new { attachmentId }, tx);
        await tx.CommitAsync();
        File.Delete(Path.Combine(_fileRoot, id.ToString(CultureInfo.InvariantCulture), att.Value.Stored));
        await _audit.LogAsync(memberId, "DELETE", "grant_application", id, app.Title, new { attachmentId }, http);
        return true;
    }

    /// <summary>The stored file of an attachment the caller's side may see, or null.</summary>
    public async Task<(string Path, string Name, string ContentType)?> GetAttachmentFileAsync(string side, int scopeId, int id, int attachmentId)
    {
        await using var c = new MySqlConnection(_cs);
        var row = await c.QueryFirstOrDefaultAsync<(string Name, string Stored)?>($@"
            SELECT t.original_name, t.stored_name FROM grant_attachments t
            JOIN grant_applications a ON a.pk_application_id = t.fk_application_id
            WHERE t.pk_attachment_id = @attachmentId AND a.pk_application_id = @id AND {Scope(side)}",
            new { attachmentId, id, scopeId });
        if (row == null) return null;
        var root = Path.GetFullPath(_fileRoot) + Path.DirectorySeparatorChar;
        var path = Path.GetFullPath(Path.Combine(_fileRoot, id.ToString(CultureInfo.InvariantCulture), row.Value.Stored));
        if (!path.StartsWith(root, StringComparison.OrdinalIgnoreCase) || !File.Exists(path)) return null;
        var contentType = FileTypes.TryGetValue(Path.GetExtension(path).ToLowerInvariant(), out var t) ? t.ContentType : "application/octet-stream";
        return (path, row.Value.Name, contentType);
    }

    // ===== Light mode =====

    private static async Task RequireLightModeAsync(MySqlConnection c, int clubId)
    {
        var districtId = await ClubDistrictAsync(c, clubId) ?? throw new InvalidOperationException("Club not found.");
        if (await DistrictOnRowAsync(c, districtId))
            throw new InvalidOperationException("Your district runs its grants on ROW: apply in its grant cycle instead.");
    }

    private async Task<string?> ProjectsTableAsync(MySqlConnection c, int yearId) =>
        (await _years.GetAllExistingYearTablesAsync(c)).FirstOrDefault(t => t.YearId == yearId)?.ProjectsTable;

    public async Task<List<GrantLightProjectDto>> GetLightProjectsAsync(int clubId, int yearId)
    {
        await using var c = new MySqlConnection(_cs);
        await c.OpenAsync();
        await RequireLightModeAsync(c, clubId);
        var table = await ProjectsTableAsync(c, yearId);
        if (table == null) return new();
        // shortcut: the newest 500 projects of the year; add paging if a club records more.
        return (await c.QueryAsync<GrantLightProjectDto>($@"
            SELECT p.pk_project_id AS ProjectId, p.title AS Title, p.project_date AS ProjectDate,
                   gl.grant_amount AS GrantAmount, gl.report_date AS ReportDate
            FROM `{table}` p
            LEFT JOIN grant_project_light gl ON gl.fk_year_id = @yearId AND gl.fk_project_id = p.pk_project_id
            WHERE p.fk_club_id = @clubId AND IFNULL(p.isdeleted, 0) = 0
            ORDER BY p.project_date DESC, p.pk_project_id DESC LIMIT 500", new { clubId, yearId })).ToList();
    }

    public async Task<bool> SaveLightAsync(int clubId, int yearId, int projectId, SaveGrantLightDto dto, int memberId, HttpContext http)
    {
        var amount = dto.GrantAmount is { } a ? decimal.Round(a, 2) : (decimal?)null;
        if (amount is < 0 or > MaxAmount) throw new InvalidOperationException("The grant amount is out of range.");
        await using var c = new MySqlConnection(_cs);
        await c.OpenAsync();
        await RequireLightModeAsync(c, clubId);
        var table = await ProjectsTableAsync(c, yearId);
        if (table == null || await c.ExecuteScalarAsync<int>(
                $"SELECT COUNT(*) FROM `{table}` WHERE pk_project_id = @projectId AND fk_club_id = @clubId AND IFNULL(isdeleted, 0) = 0",
                new { projectId, clubId }) == 0)
            return false;
        await c.ExecuteAsync(@"
            INSERT INTO grant_project_light (fk_club_id, fk_year_id, fk_project_id, grant_amount, report_date, modified_by)
            VALUES (@clubId, @yearId, @projectId, @amount, @reportDate, @memberId)
            ON DUPLICATE KEY UPDATE grant_amount = VALUES(grant_amount), report_date = VALUES(report_date), modified_by = VALUES(modified_by)",
            new { clubId, yearId, projectId, amount, reportDate = dto.ReportDate?.Date, memberId });
        await _audit.LogAsync(memberId, "UPDATE", "grant_project_light", projectId, null, new { clubId, yearId, amount, reportDate = dto.ReportDate?.Date }, http);
        return true;
    }
}
