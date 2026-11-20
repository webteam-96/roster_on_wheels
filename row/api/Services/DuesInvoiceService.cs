using Dapper;
using MySqlConnector;
using static RotaryApi.Services.DuesInvoiceMath;

namespace RotaryApi.Services;

// Invoices, statements, balances, recorded payments and the QuickBooks export (gap #7). An invoice is raised either
// on membership dues (membership_dues_member_fees: a member's Annual / Semi Annual 1 / Semi Annual 2 fee) or from the
// club's products list. Dues payments stay in membership_dues_payments; a dues invoice's paid amount is rebuilt from
// them on every read (SyncAsync), so the dues module needs no hook. A product invoice is paid by invoice_receipts.
// Callers check access; this class only reads and writes.
public sealed partial class DuesInvoiceService
{
    private readonly string _connStr;
    private readonly IEmailService _email;
    private readonly IEnumerable<IInvoicePaymentListener> _listeners;
    private readonly ILogger<DuesInvoiceService> _logger;

    public DuesInvoiceService(IConfiguration config, IEmailService email, IEnumerable<IInvoicePaymentListener> listeners, ILogger<DuesInvoiceService> logger)
    {
        _connStr = config.GetConnectionString("DefaultConnection")!;
        _email = email;
        _listeners = listeners;
        _logger = logger;
    }

    // What a dues payment counts for: offline = its amount; online = the fee's base amount at most (the online
    // surcharge is a processing fee, not credit towards the invoice).
    private const string FeeBase = "(CASE p.FeeType WHEN 1 THEN f0.AnnualAmount WHEN 2 THEN f0.Semi1Amount ELSE f0.Semi2Amount END)";
    private const string CreditSql = "IF(p.IsOnline = 1 AND " + FeeBase + " > 0, LEAST(p.Amount, " + FeeBase + "), p.Amount)";
    private const string FeeBaseJoin = "JOIN membership_dues_member_fees f0 ON f0.pk_id = p.fk_member_fee_id";
    private const string PaymentDateSql = "DATE(COALESCE(p.PaymentDate, p.ApprovedDate, p.created_date))";
    private const string PaymentRefSql = "COALESCE(NULLIF(p.TransactionId, ''), NULLIF(p.OfflineTransactionId, ''), CONCAT('PAY-', p.pk_id))";
    // Dues payments a recorded receipt wrote: they are shown through the receipt, never twice.
    private const string NotFromReceipt = "NOT EXISTS (SELECT 1 FROM invoice_receipt_allocations ra WHERE ra.fk_dues_payment_id = p.pk_id)";

    // Classes (not positional records) so Dapper converts column types by property name.
    public sealed class InvoiceRow
    {
        public int Id { get; set; }
        public int ClubId { get; set; }
        public int? DuesId { get; set; }
        public int? MemberFeeId { get; set; }
        public int MemberId { get; set; }
        public string MemberName { get; set; } = "";
        public int? FeeType { get; set; }
        public string InvoiceNo { get; set; } = "";
        public DateTime IssueDate { get; set; }
        public DateTime DueDate { get; set; }
        public decimal Amount { get; set; }
        public decimal PaidAmount { get; set; }
        public string Status { get; set; } = "";
        public string? Notes { get; set; }
        public string? VoidReason { get; set; }
        public string? Description { get; set; }
        public int EmailCount { get; set; }
        public DateTime? EmailedAt { get; set; }
    }
    public sealed class InvoiceLine
    {
        public int? ProductId { get; set; }
        public string Description { get; set; } = "";
        public decimal Quantity { get; set; }
        public decimal UnitAmount { get; set; }
        public decimal Amount { get; set; }
    }
    public sealed class AppliedPayment
    {
        public DateTime Date { get; set; }
        public string Reference { get; set; } = "";
        public string Method { get; set; } = "";
        public decimal Amount { get; set; }
    }
    public sealed record GenerateResult(int Created, int Skipped, IReadOnlyList<string> InvoiceNos);
    public sealed class BalanceRow
    {
        public int MemberId { get; set; }
        public string MemberName { get; set; } = "";
        public int OpenInvoices { get; set; }
        public decimal Invoiced { get; set; }
        public decimal Paid { get; set; }
        public decimal Outstanding { get; set; }
        public decimal Credit { get; set; }
        public DateTime? OldestDue { get; set; }
    }
    public sealed class ClubInfo
    {
        public string ClubName { get; set; } = "";
        public string? DistrictNumber { get; set; }
    }
    public sealed class Product
    {
        public int Id { get; set; }
        public string Name { get; set; } = "";
        public string? Description { get; set; }
        public decimal UnitAmount { get; set; }
        public bool IsActive { get; set; }
    }
    public sealed class Receipt
    {
        public int Id { get; set; }
        public int MemberId { get; set; }
        public string MemberName { get; set; } = "";
        public DateTime ReceiptDate { get; set; }
        public string Method { get; set; } = "";
        public string? Reference { get; set; }
        public decimal Amount { get; set; }
        public decimal Applied { get; set; }
        public string? Notes { get; set; }
    }
    public sealed record ReceiptInput(int MemberId, DateTime ReceiptDate, string Method, string? Reference, decimal Amount, string? Notes, IReadOnlyList<Split>? Splits);
    public sealed record EmailResult(int Sent, int Skipped, IReadOnlyList<string> Problems);

    private MySqlConnection Conn() => new(_connStr);

    // ── Paid amounts ──

    /// <summary>Rebuilds the paid amount of the club's (or one member's) dues invoices from the dues payments.
    /// Called before every read, so a payment taken, approved, deleted or reverted in the dues module shows at once.
    /// shortcut: rebuilds every invoiced fee of the club per read; fine for a club's few hundred invoices, move to a
    /// hook in MembershipDuesService if clubs reach thousands.</summary>
    public async Task SyncAsync(int? clubId, int? memberId)
    {
        await using var conn = Conn();
        await conn.OpenAsync();
        var fees = (await conn.QueryAsync<int>(@"
            SELECT DISTINCT fk_member_fee_id FROM dues_invoices
            WHERE fk_member_fee_id IS NOT NULL AND status <> 'void'
              AND (@C IS NULL OR fk_club_id = @C) AND (@M IS NULL OR fk_member_profile_id = @M)", new { C = clubId, M = memberId })).ToList();
        foreach (var fee in fees)
        {
            await using var tx = await conn.BeginTransactionAsync();
            await SyncMemberFeeAsync(conn, tx, fee);
            await tx.CommitAsync();
        }
    }

    // Rebuilds paid amounts, statuses and allocation rows of one member fee's invoices from its paid payments.
    private static async Task SyncMemberFeeAsync(MySqlConnection conn, MySqlTransaction tx, int feeId)
    {
        var invoices = (await conn.QueryAsync<(int Id, int FeeType, decimal Amount, decimal Paid)>(
            "SELECT pk_invoice_id, fee_type, amount, paid_amount FROM dues_invoices WHERE fk_member_fee_id = @F AND status <> 'void' ORDER BY pk_invoice_id FOR UPDATE",
            new { F = feeId }, tx)).ToList();
        if (invoices.Count == 0) return;
        var payments = await conn.QueryAsync<(int Id, int FeeType, decimal Amount)>($@"
            SELECT p.pk_id, p.FeeType, {CreditSql}
            FROM membership_dues_payments p {FeeBaseJoin}
            WHERE p.fk_member_fee_id = @F AND p.IsPaid = 1 AND p.isdeleted = 0", new { F = feeId }, tx);
        var result = Allocate(invoices.Select(i => new InvoiceSlot(i.Id, i.FeeType, i.Amount)),
            payments.Select(p => new PaymentSlot(p.Id, p.FeeType, p.Amount)));
        var ids = invoices.Select(i => i.Id).ToArray();
        await conn.ExecuteAsync("DELETE FROM dues_invoice_payments WHERE fk_invoice_id IN @Ids", new { Ids = ids }, tx);
        if (result.Allocations.Count > 0)
            await conn.ExecuteAsync("INSERT INTO dues_invoice_payments (fk_invoice_id, fk_payment_id, amount) VALUES (@InvoiceId, @PaymentId, @Amount)",
                result.Allocations, tx);
        foreach (var i in invoices)
        {
            var paid = result.PaidByInvoice[i.Id];
            if (paid != i.Paid || StatusFor(i.Amount, paid) != StatusFor(i.Amount, i.Paid))
                await conn.ExecuteAsync("UPDATE dues_invoices SET paid_amount = @P, status = @S WHERE pk_invoice_id = @Id",
                    new { P = paid, S = StatusFor(i.Amount, paid), i.Id }, tx);
        }
    }

    // ── Numbering ──

    // The club's counter row is the lock that serialises all invoice creation for the club.
    private static async Task<int> LockSeqAsync(MySqlConnection conn, MySqlTransaction tx, int clubId)
    {
        await conn.ExecuteAsync("INSERT IGNORE INTO dues_invoice_counters (fk_club_id, last_seq) VALUES (@C, 0)", new { C = clubId }, tx);
        return await conn.ExecuteScalarAsync<int>("SELECT last_seq FROM dues_invoice_counters WHERE fk_club_id = @C FOR UPDATE", new { C = clubId }, tx);
    }

    private static Task SaveSeqAsync(MySqlConnection conn, MySqlTransaction tx, int clubId, int seq) =>
        conn.ExecuteAsync("UPDATE dues_invoice_counters SET last_seq = @S WHERE fk_club_id = @C", new { S = seq, C = clubId }, tx);

    private static async Task<int> InsertInvoiceAsync(MySqlConnection conn, MySqlTransaction tx, int clubId, int? duesId, int? feeId, int memberId,
        int? feeType, int seq, DateTime issue, DateTime due, IReadOnlyList<PricedLine> lines, string? notes, int userId)
    {
        var id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO dues_invoices (fk_club_id, fk_membership_dues_id, fk_member_fee_id, fk_member_profile_id, fee_type, invoice_seq,
                invoice_no, issue_date, due_date, amount, notes, created_by, created_at)
            VALUES (@C, @D, @F, @M, @T, @Seq, @No, @Issue, @Due, @A, @N, @U, UTC_TIMESTAMP());
            SELECT LAST_INSERT_ID();",
            new { C = clubId, D = duesId, F = feeId, M = memberId, T = feeType, Seq = seq, No = FormatInvoiceNo(seq), Issue = issue.Date, Due = due.Date,
                  A = lines.Sum(l => l.Amount), N = notes, U = userId }, tx);
        await conn.ExecuteAsync(@"INSERT INTO dues_invoice_lines (fk_invoice_id, fk_product_id, description, quantity, unit_amount, amount)
            VALUES (@I, @ProductId, @Description, @Quantity, @UnitAmount, @Amount)",
            lines.Select(l => new { I = id, l.ProductId, l.Description, l.Quantity, l.UnitAmount, l.Amount }), tx);
        return id;
    }

    private static void CheckDates(DateTime issue, DateTime due)
    {
        if (issue.Year < 2000 || issue.Year > 2100) throw new ArgumentException("Issue date is not valid.");
        if (due.Date < issue.Date) throw new ArgumentException("Due date cannot be before the issue date.");
    }

    /// <summary>Raises invoices for a dues cycle: every member fee with an amount for <paramref name="feeType"/>,
    /// or just <paramref name="memberFeeId"/>. A fee that already has a live invoice for that fee type is skipped,
    /// so running it twice (or at once) creates nothing twice.</summary>
    public async Task<GenerateResult> GenerateAsync(int clubId, int duesId, int feeType, DateTime issueDate, DateTime dueDate, int? memberFeeId, int userId)
    {
        if (feeType is < 1 or > 3) throw new ArgumentException("Fee type must be 1 (Annual), 2 (Semi Annual 1) or 3 (Semi Annual 2).");
        CheckDates(issueDate, dueDate);
        await using var conn = Conn();
        await conn.OpenAsync();
        var dues = await conn.QueryFirstOrDefaultAsync<(string? Purpose, string Year, string? F1, string? F2, string? F3)>(@"
            SELECT Purpose, RotaryYear, Fees1Text, Fees2Text, Fees3Text FROM membership_dues
            WHERE pk_membership_dues_id = @D AND fk_club_id = @C AND isdeleted = 0", new { D = duesId, C = clubId });
        if (dues.Year == null) throw new KeyNotFoundException("Dues not found for this club.");
        var feeLabel = (feeType switch { 1 => dues.F1, 2 => dues.F2, _ => dues.F3 }) is { Length: > 0 } t ? t
            : feeType switch { 1 => "Annual", 2 => "Semi Annual 1", _ => "Semi Annual 2" };
        var description = $"{(string.IsNullOrWhiteSpace(dues.Purpose) ? "Club dues" : dues.Purpose!.Trim())} {dues.Year}: {feeLabel}";
        if (description.Length > 300) description = description[..300];

        await using var tx = await conn.BeginTransactionAsync();
        var seq = await LockSeqAsync(conn, tx, clubId);
        var fees = (await conn.QueryAsync<(int FeeId, int MemberId, decimal Amount)>(@"
            SELECT f.pk_id, f.fk_member_profile_id,
                   CASE @T WHEN 1 THEN f.AnnualAmount WHEN 2 THEN f.Semi1Amount ELSE f.Semi2Amount END
            FROM membership_dues_member_fees f
            WHERE f.fk_membership_dues_id = @D AND f.isdeleted = 0 AND (@One IS NULL OR f.pk_id = @One)
              AND NOT EXISTS (SELECT 1 FROM dues_invoices i WHERE i.fk_member_fee_id = f.pk_id AND i.fee_type = @T AND i.status <> 'void')
            ORDER BY f.pk_id", new { D = duesId, T = feeType, One = memberFeeId }, tx)).ToList();
        if (memberFeeId != null && fees.Count == 0
            && await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM membership_dues_member_fees WHERE pk_id = @F AND fk_membership_dues_id = @D AND isdeleted = 0",
                new { F = memberFeeId, D = duesId }, tx) == 0)
            throw new KeyNotFoundException("Member fee not found in these dues.");
        var skipped = fees.Count(f => f.Amount <= 0);
        var numbers = new List<string>();
        foreach (var f in fees.Where(f => f.Amount > 0))
        {
            seq++;
            await InsertInvoiceAsync(conn, tx, clubId, duesId, f.FeeId, f.MemberId, feeType, seq, issueDate, dueDate,
                new[] { new PricedLine(null, description, 1, f.Amount, f.Amount) }, null, userId);
            // Payments already made for this fee (before the invoice existed) apply at once.
            await SyncMemberFeeAsync(conn, tx, f.FeeId);
            numbers.Add(FormatInvoiceNo(seq));
        }
        await SaveSeqAsync(conn, tx, clubId, seq);
        await tx.CommitAsync();
        return new GenerateResult(numbers.Count, skipped, numbers);
    }

    /// <summary>One invoice per member (single or batch) with the same lines. A line with a product id must name an
    /// active product of this club; its description defaults to the product name.</summary>
    public async Task<GenerateResult> CreateAsync(int clubId, IReadOnlyList<int> memberIds, DateTime issueDate, DateTime dueDate,
        IReadOnlyList<LineInput> lines, string? notes, int userId)
    {
        CheckDates(issueDate, dueDate);
        var members = memberIds?.Distinct().ToList() ?? new();
        if (members.Count is < 1 or > 500) throw new ArgumentException("Pick between 1 and 500 members.");
        if (notes is { Length: > 500 }) throw new ArgumentException("Notes can be up to 500 characters.");
        await using var conn = Conn();
        await conn.OpenAsync();
        var productIds = lines?.Where(l => l.ProductId != null).Select(l => l.ProductId!.Value).Distinct().ToArray() ?? Array.Empty<int>();
        var products = productIds.Length == 0 ? new Dictionary<int, string>() : (await conn.QueryAsync<(int Id, string Name)>(
            "SELECT pk_product_id, name FROM invoice_products WHERE fk_club_id = @C AND is_active = 1 AND pk_product_id IN @Ids",
            new { C = clubId, Ids = productIds })).ToDictionary(p => p.Id, p => p.Name);
        if (products.Count != productIds.Length) throw new ArgumentException("A product on the invoice is not in this club's active products.");
        var priced = PriceLines(lines?.Select(l => l with { Description = string.IsNullOrWhiteSpace(l.Description) && l.ProductId != null ? products[l.ProductId.Value] : l.Description }));
        var active = (await conn.QueryAsync<int>(@"
            SELECT DISTINCT fk_member_master_profile_id FROM club_members
            WHERE fk_club_id = @C AND IsActive = 1 AND IFNULL(isdeleted, 0) = 0 AND fk_member_master_profile_id IN @M",
            new { C = clubId, M = members })).ToHashSet();
        if (members.Any(m => !active.Contains(m))) throw new ArgumentException("Every member must be an active member of this club.");

        await using var tx = await conn.BeginTransactionAsync();
        var seq = await LockSeqAsync(conn, tx, clubId);
        var numbers = new List<string>();
        foreach (var m in members)
        {
            seq++;
            await InsertInvoiceAsync(conn, tx, clubId, null, null, m, null, seq, issueDate, dueDate, priced, string.IsNullOrWhiteSpace(notes) ? null : notes.Trim(), userId);
            numbers.Add(FormatInvoiceNo(seq));
        }
        await SaveSeqAsync(conn, tx, clubId, seq);
        await tx.CommitAsync();
        return new GenerateResult(numbers.Count, 0, numbers);
    }

    // ── Reads ──

    private const string InvoiceSelect = @"
        SELECT i.pk_invoice_id AS Id, i.fk_club_id AS ClubId, i.fk_membership_dues_id AS DuesId, i.fk_member_fee_id AS MemberFeeId,
               i.fk_member_profile_id AS MemberId, COALESCE(m.MemberName, '') AS MemberName, i.fee_type AS FeeType, i.invoice_no AS InvoiceNo,
               i.issue_date AS IssueDate, i.due_date AS DueDate, i.amount AS Amount, i.paid_amount AS PaidAmount, i.status AS Status,
               i.notes AS Notes, i.void_reason AS VoidReason, i.email_count AS EmailCount, i.emailed_at AS EmailedAt,
               (SELECT l.description FROM dues_invoice_lines l WHERE l.fk_invoice_id = i.pk_invoice_id ORDER BY l.pk_line_id LIMIT 1) AS Description
        FROM dues_invoices i
        LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = i.fk_member_profile_id";

    public async Task<IReadOnlyList<InvoiceRow>> ListForClubAsync(int clubId, int? duesId, int? memberId, string? status)
    {
        await SyncAsync(clubId, memberId);
        await using var conn = Conn();
        return (await conn.QueryAsync<InvoiceRow>(InvoiceSelect + @"
            WHERE i.fk_club_id = @C AND (@D IS NULL OR i.fk_membership_dues_id = @D) AND (@M IS NULL OR i.fk_member_profile_id = @M)
              AND (@S IS NULL OR i.status = @S)
            ORDER BY i.invoice_seq DESC LIMIT 2000", new { C = clubId, D = duesId, M = memberId, S = status })).ToList();
    }

    public async Task<IReadOnlyList<InvoiceRow>> ListForMemberAsync(int memberId)
    {
        await SyncAsync(null, memberId);
        await using var conn = Conn();
        return (await conn.QueryAsync<InvoiceRow>(InvoiceSelect + @"
            WHERE i.fk_member_profile_id = @M ORDER BY i.issue_date DESC, i.pk_invoice_id DESC", new { M = memberId })).ToList();
    }

    public async Task<InvoiceRow?> GetAsync(int invoiceId)
    {
        await using var conn = Conn();
        var fee = await conn.ExecuteScalarAsync<int?>("SELECT fk_member_fee_id FROM dues_invoices WHERE pk_invoice_id = @Id", new { Id = invoiceId });
        if (fee is > 0)
        {
            await conn.OpenAsync();
            await using var tx = await conn.BeginTransactionAsync();
            await SyncMemberFeeAsync(conn, tx, fee.Value);
            await tx.CommitAsync();
        }
        return await conn.QueryFirstOrDefaultAsync<InvoiceRow>(InvoiceSelect + " WHERE i.pk_invoice_id = @Id", new { Id = invoiceId });
    }

    public async Task<IReadOnlyList<InvoiceLine>> LinesAsync(int invoiceId)
    {
        await using var conn = Conn();
        return (await conn.QueryAsync<InvoiceLine>(@"
            SELECT fk_product_id AS ProductId, description AS Description, quantity AS Quantity, unit_amount AS UnitAmount, amount AS Amount
            FROM dues_invoice_lines WHERE fk_invoice_id = @Id ORDER BY pk_line_id", new { Id = invoiceId })).ToList();
    }

    /// <summary>The payments applied to one invoice: recorded receipts, and dues payments made in the dues module.</summary>
    public async Task<IReadOnlyList<AppliedPayment>> PaymentsForAsync(int invoiceId)
    {
        await using var conn = Conn();
        return (await conn.QueryAsync<AppliedPayment>($@"
            SELECT r.receipt_date AS Date, COALESCE(NULLIF(r.reference, ''), CONCAT('RCPT-', r.pk_receipt_id)) AS Reference, r.method AS Method, ra.amount AS Amount
            FROM invoice_receipt_allocations ra JOIN invoice_receipts r ON r.pk_receipt_id = ra.fk_receipt_id
            WHERE ra.fk_invoice_id = @Id
            UNION ALL
            SELECT {PaymentDateSql}, {PaymentRefSql}, IF(p.IsOnline = 1, 'online', 'offline'), ip.amount
            FROM dues_invoice_payments ip JOIN membership_dues_payments p ON p.pk_id = ip.fk_payment_id
            WHERE ip.fk_invoice_id = @Id AND {NotFromReceipt}
            ORDER BY 1", new { Id = invoiceId })).ToList();
    }

    public async Task<ClubInfo> ClubAsync(int clubId)
    {
        await using var conn = Conn();
        return await conn.QueryFirstOrDefaultAsync<ClubInfo>(@"
            SELECT c.ClubName, d.DistrictNumber FROM club_master c LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
            WHERE c.pk_club_id = @C", new { C = clubId }) ?? new ClubInfo();
    }

    public async Task<string> MemberNameAsync(int memberId)
    {
        await using var conn = Conn();
        return await conn.ExecuteScalarAsync<string?>("SELECT MemberName FROM member_master_profile WHERE pk_member_master_profile_id = @M", new { M = memberId }) ?? "";
    }

    /// <summary>Voids an invoice of this club. Refused once a payment has been applied (record the refund or
    /// correct the payment first), so no money is ever left pointing at a void invoice.</summary>
    public async Task VoidAsync(int clubId, int invoiceId, string reason, int userId)
    {
        await GetAsync(invoiceId); // brings a dues invoice's paid amount up to date first
        await using var conn = Conn();
        await conn.OpenAsync();
        await using var tx = await conn.BeginTransactionAsync();
        var row = await conn.QueryFirstOrDefaultAsync<(string Status, decimal Paid)>(
            "SELECT status, paid_amount FROM dues_invoices WHERE pk_invoice_id = @Id AND fk_club_id = @C FOR UPDATE", new { Id = invoiceId, C = clubId }, tx);
        if (row.Status == null) throw new KeyNotFoundException("Invoice not found.");
        if (row.Status == Voided) throw new InvalidOperationException("Invoice is already void.");
        if (row.Paid > 0) throw new InvalidOperationException("This invoice has payments applied, so it cannot be voided.");
        await conn.ExecuteAsync(@"UPDATE dues_invoices SET status = 'void', void_reason = @R, voided_by = @U, voided_at = UTC_TIMESTAMP()
            WHERE pk_invoice_id = @Id", new { Id = invoiceId, R = reason, U = userId }, tx);
        // Meals billed on it can be billed again.
        await conn.ExecuteAsync("UPDATE meal_charges SET fk_invoice_id = NULL WHERE fk_invoice_id = @Id", new { Id = invoiceId }, tx);
        await tx.CommitAsync();
    }

    // Credit = the part of recorded receipts not applied to any invoice.
    private const string CreditByMember = @"
        SELECT r.fk_member_profile_id AS mid, SUM(r.amount - COALESCE(a.applied, 0)) AS credit
        FROM invoice_receipts r
        LEFT JOIN (SELECT fk_receipt_id, SUM(amount) AS applied FROM invoice_receipt_allocations GROUP BY fk_receipt_id) a ON a.fk_receipt_id = r.pk_receipt_id
        WHERE r.fk_club_id = @C GROUP BY r.fk_member_profile_id";

    /// <summary>Members of the club with an unpaid invoice balance or a credit, largest outstanding first.</summary>
    public async Task<IReadOnlyList<BalanceRow>> BalancesAsync(int clubId, int? memberId = null)
    {
        await SyncAsync(clubId, memberId);
        await using var conn = Conn();
        return (await conn.QueryAsync<BalanceRow>($@"
            SELECT x.mid AS MemberId, COALESCE(m.MemberName, '') AS MemberName, COALESCE(inv.OpenInvoices, 0) AS OpenInvoices,
                   COALESCE(inv.Invoiced, 0) AS Invoiced, COALESCE(inv.Paid, 0) AS Paid, COALESCE(inv.Outstanding, 0) AS Outstanding,
                   COALESCE(cr.credit, 0) AS Credit, inv.OldestDue
            FROM (SELECT fk_member_profile_id AS mid FROM dues_invoices WHERE fk_club_id = @C AND status <> 'void'
                  UNION SELECT fk_member_profile_id FROM invoice_receipts WHERE fk_club_id = @C) x
            LEFT JOIN (SELECT fk_member_profile_id AS mid, CAST(SUM(status IN ('open', 'part_paid')) AS SIGNED) AS OpenInvoices,
                              SUM(amount) AS Invoiced, SUM(paid_amount) AS Paid, SUM(amount - paid_amount) AS Outstanding,
                              MIN(CASE WHEN status IN ('open', 'part_paid') THEN due_date END) AS OldestDue
                       FROM dues_invoices WHERE fk_club_id = @C AND status <> 'void' GROUP BY fk_member_profile_id) inv ON inv.mid = x.mid
            LEFT JOIN ({CreditByMember}) cr ON cr.mid = x.mid
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = x.mid
            WHERE (@M IS NULL OR x.mid = @M) AND (COALESCE(inv.Outstanding, 0) > 0 OR COALESCE(cr.credit, 0) > 0 OR @M IS NOT NULL)
            ORDER BY Outstanding DESC, MemberName", new { C = clubId, M = memberId })).ToList();
    }

    /// <summary>The member's statement: live invoices as charges; recorded receipts and the paid dues payments on
    /// invoiced fees as payments. <paramref name="clubId"/> null = all the member's clubs (the app).</summary>
    public async Task<Statement> StatementAsync(int memberId, int? clubId, DateTime from, DateTime to)
    {
        if (to.Date < from.Date) throw new ArgumentException("The end date is before the start date.");
        await SyncAsync(clubId, memberId);
        await using var conn = Conn();
        var charges = await conn.QueryAsync<(DateTime Date, string Ref, string? Desc, decimal Amount)>(@"
            SELECT i.issue_date, i.invoice_no,
                   (SELECT l.description FROM dues_invoice_lines l WHERE l.fk_invoice_id = i.pk_invoice_id ORDER BY l.pk_line_id LIMIT 1), i.amount
            FROM dues_invoices i
            WHERE i.fk_member_profile_id = @M AND i.status <> 'void' AND (@C IS NULL OR i.fk_club_id = @C)
              AND i.issue_date <= @To", new { M = memberId, C = clubId, To = to.Date });
        var payments = await conn.QueryAsync<(DateTime Date, string Ref, decimal Amount, string Desc)>($@"
            SELECT {PaymentDateSql}, {PaymentRefSql}, {CreditSql}, IF(p.IsOnline = 1, 'Payment, online', 'Payment, offline')
            FROM membership_dues_payments p {FeeBaseJoin}
            JOIN membership_dues md ON md.pk_membership_dues_id = p.fk_membership_dues_id
            WHERE p.fk_member_profile_id = @M AND p.IsPaid = 1 AND p.isdeleted = 0 AND (@C IS NULL OR md.fk_club_id = @C)
              AND EXISTS (SELECT 1 FROM dues_invoices i WHERE i.fk_member_fee_id = p.fk_member_fee_id AND i.status <> 'void')
              AND {NotFromReceipt} AND {PaymentDateSql} <= @To
            UNION ALL
            SELECT r.receipt_date, COALESCE(NULLIF(r.reference, ''), CONCAT('RCPT-', r.pk_receipt_id)), r.amount, CONCAT('Payment, ', r.method)
            FROM invoice_receipts r
            WHERE r.fk_member_profile_id = @M AND (@C IS NULL OR r.fk_club_id = @C) AND r.receipt_date <= @To", new { M = memberId, C = clubId, To = to.Date });
        var lines = charges.Select(c => new StatementLine(c.Date, true, c.Ref, c.Desc ?? "Dues", c.Amount))
            .Concat(payments.Select(p => new StatementLine(p.Date, false, p.Ref, p.Desc, p.Amount)));
        return BuildStatement(lines, from, to);
    }

    // ── Products ──

    public async Task<IReadOnlyList<Product>> ProductsAsync(int clubId, bool activeOnly)
    {
        await using var conn = Conn();
        return (await conn.QueryAsync<Product>(@"
            SELECT pk_product_id AS Id, name AS Name, description AS Description, unit_amount AS UnitAmount, is_active = 1 AS IsActive
            FROM invoice_products WHERE fk_club_id = @C AND (@A = 0 OR is_active = 1) ORDER BY is_active DESC, name",
            new { C = clubId, A = activeOnly ? 1 : 0 })).ToList();
    }

    private static (string Name, string? Desc) CheckProduct(string? name, string? description, decimal unitAmount)
    {
        var n = (name ?? "").Trim();
        if (n.Length is 0 or > 150) throw new ArgumentException("Product name is required, up to 150 characters.");
        var d = string.IsNullOrWhiteSpace(description) ? null : description.Trim();
        if (d is { Length: > 300 }) throw new ArgumentException("Description can be up to 300 characters.");
        if (unitAmount < 0 || unitAmount > 10_000_000) throw new ArgumentException("Price must be between 0 and 10,000,000.");
        return (n, d);
    }

    public async Task<int> SaveProductAsync(int clubId, int? productId, string? name, string? description, decimal unitAmount, bool isActive, int userId)
    {
        var (n, d) = CheckProduct(name, description, unitAmount);
        var price = Math.Round(unitAmount, 2, MidpointRounding.AwayFromZero);
        await using var conn = Conn();
        if (productId == null)
            return await conn.ExecuteScalarAsync<int>(@"
                INSERT INTO invoice_products (fk_club_id, name, description, unit_amount, is_active, created_by, created_at)
                VALUES (@C, @N, @D, @P, @A, @U, UTC_TIMESTAMP()); SELECT LAST_INSERT_ID();",
                new { C = clubId, N = n, D = d, P = price, A = isActive, U = userId });
        var changed = await conn.ExecuteAsync(@"
            UPDATE invoice_products SET name = @N, description = @D, unit_amount = @P, is_active = @A, updated_at = UTC_TIMESTAMP()
            WHERE pk_product_id = @Id AND fk_club_id = @C", new { Id = productId, C = clubId, N = n, D = d, P = price, A = isActive });
        if (changed == 0) throw new KeyNotFoundException("Product not found.");
        return productId.Value;
    }

    // ── Recorded payments (cash / cheque / bank) ──

    public async Task<IReadOnlyList<Receipt>> ReceiptsAsync(int clubId, int? memberId)
    {
        await using var conn = Conn();
        return (await conn.QueryAsync<Receipt>(@"
            SELECT r.pk_receipt_id AS Id, r.fk_member_profile_id AS MemberId, COALESCE(m.MemberName, '') AS MemberName, r.receipt_date AS ReceiptDate,
                   r.method AS Method, r.reference AS Reference, r.amount AS Amount, r.notes AS Notes,
                   COALESCE((SELECT SUM(a.amount) FROM invoice_receipt_allocations a WHERE a.fk_receipt_id = r.pk_receipt_id), 0) AS Applied
            FROM invoice_receipts r LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = r.fk_member_profile_id
            WHERE r.fk_club_id = @C AND (@M IS NULL OR r.fk_member_profile_id = @M)
            ORDER BY r.receipt_date DESC, r.pk_receipt_id DESC LIMIT 1000", new { C = clubId, M = memberId })).ToList();
    }

    /// <summary>Records one payment and applies it across the member's open invoices. For a dues invoice it also
    /// writes a paid offline row in membership_dues_payments, so the dues module shows the fee as paid. The ledger
    /// listeners hear about it after the commit.</summary>
    public async Task<int> RecordReceiptAsync(int clubId, ReceiptInput input, int userId)
    {
        var method = (input.Method ?? "").Trim().ToLowerInvariant();
        if (!Methods.Contains(method)) throw new ArgumentException("Method must be cash, cheque or bank.");
        if (input.ReceiptDate.Year < 2000 || input.ReceiptDate.Date > DateTime.UtcNow.Date.AddDays(1)) throw new ArgumentException("Payment date is not valid.");
        var reference = string.IsNullOrWhiteSpace(input.Reference) ? null : input.Reference.Trim();
        if (reference is { Length: > 100 }) throw new ArgumentException("Reference can be up to 100 characters.");
        if (method == "cheque" && reference == null) throw new ArgumentException("Enter the cheque number as the reference.");
        var notes = string.IsNullOrWhiteSpace(input.Notes) ? null : input.Notes.Trim();
        if (notes is { Length: > 500 }) throw new ArgumentException("Notes can be up to 500 characters.");
        var amount = Math.Round(input.Amount, 2, MidpointRounding.AwayFromZero);

        await SyncAsync(clubId, input.MemberId);
        await using var conn = Conn();
        await conn.OpenAsync();
        if (await conn.ExecuteScalarAsync<int>(@"SELECT COUNT(*) FROM club_members WHERE fk_club_id = @C AND fk_member_master_profile_id = @M AND IFNULL(isdeleted, 0) = 0",
                new { C = clubId, M = input.MemberId }) == 0)
            throw new ArgumentException("This member is not in this club.");
        await using var tx = await conn.BeginTransactionAsync();
        var open = (await conn.QueryAsync<(int Id, decimal Amount, decimal Paid, int? FeeId, int? FeeType, int? DuesId, string No)>(@"
            SELECT pk_invoice_id, amount, paid_amount, fk_member_fee_id, fee_type, fk_membership_dues_id, invoice_no FROM dues_invoices
            WHERE fk_club_id = @C AND fk_member_profile_id = @M AND status IN ('open', 'part_paid') ORDER BY pk_invoice_id FOR UPDATE",
            new { C = clubId, M = input.MemberId }, tx)).ToList();
        var splits = SplitPayment(amount, open.Select(o => new OpenInvoice(o.Id, o.Amount - o.Paid, o.FeeId != null)).ToList(), input.Splits);
        var receiptId = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO invoice_receipts (fk_club_id, fk_member_profile_id, receipt_date, method, reference, amount, notes, created_by, created_at)
            VALUES (@C, @M, @D, @Method, @Ref, @A, @N, @U, UTC_TIMESTAMP()); SELECT LAST_INSERT_ID();",
            new { C = clubId, M = input.MemberId, D = input.ReceiptDate.Date, Method = method, Ref = reference, A = amount, N = notes, U = userId }, tx);
        var applied = new List<InvoicePaymentApplied>();
        foreach (var s in splits)
        {
            var inv = open.First(o => o.Id == s.InvoiceId);
            int? duesPaymentId = null;
            if (inv.FeeId != null)
            {
                duesPaymentId = await conn.ExecuteScalarAsync<int>(@"
                    INSERT INTO membership_dues_payments (fk_membership_dues_id, fk_member_fee_id, fk_member_profile_id, FeeType, Amount, IsPaid, IsOnline,
                        PaymentStatus, OfflineStatus, OfflineTransactionType, OfflineTransactionId, OfflineChequeNumber, OfflineRemark, PaidSource, PaymentDate,
                        created_by, created_date)
                    VALUES (@D, @F, @M, @T, @A, 1, 0, 'Approved', 'Approved', @Type, @Ref, @Cheque, @Remark, 'Invoice', @Date, @U, NOW());
                    SELECT LAST_INSERT_ID();",
                    new { D = inv.DuesId, F = inv.FeeId, M = input.MemberId, T = inv.FeeType, A = s.Amount,
                          Type = method switch { "cash" => "Cash", "cheque" => "Cheque", _ => "Bank Transfer" }, Ref = reference ?? $"RCPT-{receiptId}",
                          Cheque = method == "cheque" ? reference : "", Remark = $"Recorded against invoice {inv.No}", Date = input.ReceiptDate.Date, U = userId }, tx);
            }
            await conn.ExecuteAsync("INSERT INTO invoice_receipt_allocations (fk_receipt_id, fk_invoice_id, amount, fk_dues_payment_id) VALUES (@R, @I, @A, @P)",
                new { R = receiptId, I = s.InvoiceId, A = s.Amount, P = duesPaymentId }, tx);
            if (inv.FeeId != null) await SyncMemberFeeAsync(conn, tx, inv.FeeId.Value);
            else
            {
                var paid = inv.Paid + s.Amount;
                await conn.ExecuteAsync("UPDATE dues_invoices SET paid_amount = @P, status = @S WHERE pk_invoice_id = @Id",
                    new { P = paid, S = StatusFor(inv.Amount, paid), Id = inv.Id }, tx);
            }
            applied.Add(new InvoicePaymentApplied(inv.Id, inv.No, s.Amount, inv.FeeId != null));
        }
        await tx.CommitAsync();

        var e = new InvoicePaymentRecorded(clubId, receiptId, input.MemberId, input.ReceiptDate.Date, method, reference, amount, applied, userId);
        foreach (var l in _listeners)
        {
            try { await l.OnPaymentRecordedAsync(e); }
            catch (Exception ex) { _logger.LogError(ex, "Invoice payment listener {Listener} failed for receipt {ReceiptId}", l.GetType().Name, receiptId); }
        }
        return receiptId;
    }

    // ── Email ──

    /// <summary>Emails each invoice's PDF to its member (send and resend are the same). Void invoices and members
    /// without an email address are skipped and named in the result.</summary>
    public async Task<EmailResult> EmailAsync(int clubId, IReadOnlyList<int> invoiceIds)
    {
        var ids = invoiceIds?.Distinct().ToList() ?? new();
        if (ids.Count is < 1 or > 500) throw new ArgumentException("Pick between 1 and 500 invoices.");
        await SyncAsync(clubId, null);
        await using var conn = Conn();
        var rows = (await conn.QueryAsync<InvoiceRow>(InvoiceSelect + " WHERE i.fk_club_id = @C AND i.pk_invoice_id IN @Ids ORDER BY i.invoice_seq",
            new { C = clubId, Ids = ids })).ToList();
        if (rows.Count != ids.Count) throw new KeyNotFoundException("An invoice was not found in this club.");
        var emails = (await conn.QueryAsync<(int Id, string? Email)>(
            "SELECT pk_member_master_profile_id, EmailId FROM member_master_profile WHERE pk_member_master_profile_id IN @M",
            new { M = rows.Select(r => r.MemberId).Distinct() })).ToDictionary(x => x.Id, x => x.Email);
        var club = await ClubAsync(clubId);
        int sent = 0, skipped = 0;
        var problems = new List<string>();
        foreach (var inv in rows)
        {
            if (inv.Status == Voided) { skipped++; problems.Add($"{inv.InvoiceNo}: void"); continue; }
            var to = emails.GetValueOrDefault(inv.MemberId)?.Trim();
            if (string.IsNullOrEmpty(to) || !to.Contains('@')) { skipped++; problems.Add($"{inv.InvoiceNo}: no email address"); continue; }
            var pdf = DuesInvoicePdfBuilder.Invoice(inv, await LinesAsync(inv.Id), club);
            Func<string?, string?> enc = System.Net.WebUtility.HtmlEncode;
            var body = $"<p>Dear {enc(inv.MemberName)},</p><p>Please find attached invoice {enc(inv.InvoiceNo)} from {enc(club.ClubName)} " +
                       $"for {enc(Brand.Money(inv.Amount))}, due on {inv.DueDate:dd MMM yyyy}. Amount still due: {enc(Brand.Money(inv.Amount - inv.PaidAmount))}.</p>" +
                       "<p>You can also see your invoices and balance in the app.</p>";
            try
            {
                await _email.SendScopedEmailWithAttachmentAsync(to, $"Invoice {inv.InvoiceNo} from {club.ClubName}", body, pdf, $"{inv.InvoiceNo}.pdf",
                    null, clubId, null, "Invoice");
                await conn.ExecuteAsync("UPDATE dues_invoices SET email_count = email_count + 1, emailed_at = UTC_TIMESTAMP() WHERE pk_invoice_id = @Id", new { inv.Id });
                sent++;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Emailing invoice {InvoiceId} failed", inv.Id);
                skipped++;
                problems.Add($"{inv.InvoiceNo}: sending failed");
            }
        }
        return new EmailResult(sent, skipped, problems);
    }

    // ── QuickBooks ──

    private async Task<List<IifInvoice>> ExportInvoicesAsync(int clubId, DateTime from, DateTime to)
    {
        await using var conn = Conn();
        var rows = await conn.QueryAsync<(int Id, string No, string? Name, int MemberId, DateTime Issue, DateTime Due, string Item, decimal Amount)>(@"
            SELECT i.pk_invoice_id, i.invoice_no, m.MemberName, i.fk_member_profile_id, i.issue_date, i.due_date, l.description, l.amount
            FROM dues_invoices i
            JOIN dues_invoice_lines l ON l.fk_invoice_id = i.pk_invoice_id
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = i.fk_member_profile_id
            WHERE i.fk_club_id = @C AND i.status <> 'void' AND i.issue_date BETWEEN @F AND @T
            ORDER BY i.invoice_seq, l.pk_line_id", new { C = clubId, F = from.Date, T = to.Date });
        return rows.GroupBy(r => r.Id).Select(g =>
        {
            var f = g.First();
            return new IifInvoice(f.No, QbCustomer(f.Name, f.MemberId), f.Issue, f.Due, g.Select(x => (x.Item, x.Amount)).ToList());
        }).ToList();
    }

    // One row per invoice a payment paid, plus one with no invoice for any unapplied remainder.
    private async Task<List<IifPayment>> ExportPaymentsAsync(int clubId, DateTime from, DateTime to)
    {
        await SyncAsync(clubId, null);
        await using var conn = Conn();
        var rows = await conn.QueryAsync<(DateTime Date, string? Name, int MemberId, decimal Amount, string Ref, string? No)>($@"
            SELECT d, MemberName, MemberId, amt, ref, no FROM (
                SELECT {PaymentDateSql} AS d, m.MemberName, p.fk_member_profile_id AS MemberId, ip.amount AS amt, {PaymentRefSql} AS ref,
                       i.invoice_no AS no, p.pk_id AS pid, i.invoice_seq AS seq
                FROM membership_dues_payments p
                JOIN dues_invoice_payments ip ON ip.fk_payment_id = p.pk_id
                JOIN dues_invoices i ON i.pk_invoice_id = ip.fk_invoice_id
                LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = p.fk_member_profile_id
                WHERE i.fk_club_id = @C AND p.IsPaid = 1 AND p.isdeleted = 0 AND {NotFromReceipt}
                UNION ALL
                SELECT {PaymentDateSql}, m.MemberName, p.fk_member_profile_id, {CreditSql} - COALESCE(ap.applied, 0), {PaymentRefSql}, NULL, p.pk_id, 0
                FROM membership_dues_payments p {FeeBaseJoin}
                JOIN membership_dues md ON md.pk_membership_dues_id = p.fk_membership_dues_id
                LEFT JOIN (SELECT fk_payment_id, SUM(amount) AS applied FROM dues_invoice_payments GROUP BY fk_payment_id) ap ON ap.fk_payment_id = p.pk_id
                LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = p.fk_member_profile_id
                WHERE md.fk_club_id = @C AND p.IsPaid = 1 AND p.isdeleted = 0 AND {NotFromReceipt}
                  AND EXISTS (SELECT 1 FROM dues_invoices i WHERE i.fk_member_fee_id = p.fk_member_fee_id AND i.status <> 'void')
                  AND {CreditSql} - COALESCE(ap.applied, 0) > 0
                UNION ALL
                SELECT r.receipt_date, m.MemberName, r.fk_member_profile_id, ra.amount, COALESCE(NULLIF(r.reference, ''), CONCAT('RCPT-', r.pk_receipt_id)),
                       i.invoice_no, -r.pk_receipt_id, i.invoice_seq
                FROM invoice_receipts r
                JOIN invoice_receipt_allocations ra ON ra.fk_receipt_id = r.pk_receipt_id
                JOIN dues_invoices i ON i.pk_invoice_id = ra.fk_invoice_id
                LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = r.fk_member_profile_id
                WHERE r.fk_club_id = @C
                UNION ALL
                SELECT r.receipt_date, m.MemberName, r.fk_member_profile_id, r.amount - COALESCE(a.applied, 0),
                       COALESCE(NULLIF(r.reference, ''), CONCAT('RCPT-', r.pk_receipt_id)), NULL, -r.pk_receipt_id, 0
                FROM invoice_receipts r
                LEFT JOIN (SELECT fk_receipt_id, SUM(amount) AS applied FROM invoice_receipt_allocations GROUP BY fk_receipt_id) a ON a.fk_receipt_id = r.pk_receipt_id
                LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = r.fk_member_profile_id
                WHERE r.fk_club_id = @C AND r.amount - COALESCE(a.applied, 0) > 0
            ) x WHERE d BETWEEN @F AND @T ORDER BY d, pid, seq", new { C = clubId, F = from.Date, T = to.Date });
        return rows.Select(r => new IifPayment(QbCustomer(r.Name, r.MemberId), r.Date, r.Amount, r.Ref, r.No)).ToList();
    }

    public async Task<string> QuickBooksInvoicesCsvAsync(int clubId, DateTime from, DateTime to) =>
        Csv(InvoiceHeader, (await ExportInvoicesAsync(clubId, from, to)).SelectMany(i => i.Lines.Select(l => (IReadOnlyList<(string, bool)>)new[]
        {
            (i.InvoiceNo, true), (i.Customer, true), (QbDate(i.IssueDate), false), (QbDate(i.DueDate), false), (l.Item, true), (QbAmount(l.Amount), false),
        })));

    public async Task<string> QuickBooksPaymentsCsvAsync(int clubId, DateTime from, DateTime to) =>
        Csv(PaymentHeader, (await ExportPaymentsAsync(clubId, from, to)).Select(p => (IReadOnlyList<(string, bool)>)new[]
        {
            (QbDate(p.Date), false), (p.Customer, true), (QbAmount(p.Amount), false), (p.Reference, true), (p.InvoiceNo ?? "", true),
        }));

    public async Task<string> QuickBooksIifAsync(int clubId, DateTime from, DateTime to) =>
        Iif(await ExportInvoicesAsync(clubId, from, to), await ExportPaymentsAsync(clubId, from, to));
}
