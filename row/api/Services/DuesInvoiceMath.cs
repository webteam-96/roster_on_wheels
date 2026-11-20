using System.Globalization;
using System.Text;

namespace RotaryApi.Services;

// Pure rules behind dues invoices (gap #7): numbering, applying payments, statement arithmetic and the QuickBooks
// CSV. No database here so api.Tests covers them directly; DuesInvoiceService does the reads and writes.
public static class DuesInvoiceMath
{
    public const string Open = "open", PartPaid = "part_paid", Paid = "paid", Voided = "void";

    /// <summary>Club-scoped invoice number, e.g. seq 42 → "INV-00042". The sequence itself comes from
    /// dues_invoice_counters under a row lock, so it has no gaps or repeats.</summary>
    public static string FormatInvoiceNo(int seq) =>
        seq > 0 ? "INV-" + seq.ToString("D5", CultureInfo.InvariantCulture) : throw new ArgumentOutOfRangeException(nameof(seq));

    public static string StatusFor(decimal amount, decimal paid) =>
        paid <= 0 ? Open : paid < amount ? PartPaid : Paid;

    public sealed record InvoiceSlot(int Id, int FeeType, decimal Amount);
    public sealed record PaymentSlot(int Id, int FeeType, decimal Amount);
    public sealed record Allocation(int InvoiceId, int PaymentId, decimal Amount);
    public sealed record AllocationResult(IReadOnlyList<Allocation> Allocations, IReadOnlyDictionary<int, decimal> PaidByInvoice, decimal Unapplied);

    /// <summary>
    /// Applies a member fee's payments to its live (not void) invoices. Payments go in id order; each pays the
    /// invoices of its own fee type first, then any other open invoice of the same fee, oldest first. What is
    /// left over is unapplied (an overpayment / credit). Rebuilding from scratch each time keeps it idempotent and
    /// correct after a payment is deleted or reverted.
    /// </summary>
    public static AllocationResult Allocate(IEnumerable<InvoiceSlot> invoices, IEnumerable<PaymentSlot> payments)
    {
        var inv = invoices.OrderBy(i => i.Id).ToList();
        var paid = inv.ToDictionary(i => i.Id, _ => 0m);
        var allocations = new List<Allocation>();
        var unapplied = 0m;
        foreach (var p in payments.OrderBy(p => p.Id))
        {
            var left = p.Amount;
            foreach (var i in inv.OrderBy(i => i.FeeType == p.FeeType ? 0 : 1).ThenBy(i => i.Id))
            {
                if (left <= 0) break;
                var take = Math.Min(left, i.Amount - paid[i.Id]);
                if (take <= 0) continue;
                paid[i.Id] += take;
                left -= take;
                allocations.Add(new Allocation(i.Id, p.Id, take));
            }
            if (left > 0) unapplied += left;
        }
        return new AllocationResult(allocations, paid, unapplied);
    }

    public sealed record StatementLine(DateTime Date, bool IsCharge, string Reference, string Description, decimal Amount);
    public sealed record StatementRow(StatementLine Line, decimal Balance);
    public sealed record Statement(decimal Opening, IReadOnlyList<StatementRow> Rows, decimal Charges, decimal Payments, decimal Closing);

    /// <summary>Opening = charges minus payments dated before <paramref name="from"/>; then each line in the range
    /// (charges before payments on the same day) moves the running balance. Positive = the member owes.</summary>
    public static Statement BuildStatement(IEnumerable<StatementLine> lines, DateTime from, DateTime to)
    {
        var all = lines.ToList();
        var opening = all.Where(l => l.Date.Date < from.Date).Sum(l => l.IsCharge ? l.Amount : -l.Amount);
        var rows = new List<StatementRow>();
        var balance = opening;
        foreach (var l in all.Where(l => l.Date.Date >= from.Date && l.Date.Date <= to.Date)
                     .OrderBy(l => l.Date.Date).ThenBy(l => l.IsCharge ? 0 : 1))
        {
            balance += l.IsCharge ? l.Amount : -l.Amount;
            rows.Add(new StatementRow(l, balance));
        }
        var charges = rows.Where(r => r.Line.IsCharge).Sum(r => r.Line.Amount);
        var payments = rows.Where(r => !r.Line.IsCharge).Sum(r => r.Line.Amount);
        return new Statement(opening, rows, charges, payments, opening + charges - payments);
    }

    // ── QuickBooks Online CSV ──
    // Invoices file (Sales → Invoices → Import invoices), one row per invoice line:
    //   InvoiceNo   → Invoice no.        dues_invoices.invoice_no (INV-00042)
    //   Customer    → Customer           member name + " #" + member id, so two members with one name stay apart
    //   InvoiceDate → Invoice date       issue_date, MM/dd/yyyy (pick that format in the QuickBooks import screen)
    //   DueDate     → Due date           due_date, MM/dd/yyyy
    //   Item        → Product/Service    the line description, e.g. "Club dues 2026-27: Annual"
    //   Amount      → Amount             line amount, 2 decimals, no currency sign
    // Payments file (for Receive payment import tools / manual entry), one row per invoice a payment paid:
    //   Date, Customer, Amount, Reference (gateway or offline transaction id), InvoiceNo (blank when a payment
    //   is unapplied credit). Void invoices are left out of both files.
    public static readonly string[] InvoiceHeader = { "InvoiceNo", "Customer", "InvoiceDate", "DueDate", "Item", "Amount" };
    public static readonly string[] PaymentHeader = { "Date", "Customer", "Amount", "Reference", "InvoiceNo" };

    public static string QbDate(DateTime d) => d.ToString("MM/dd/yyyy", CultureInfo.InvariantCulture);
    public static string QbAmount(decimal v) => v.ToString("0.00", CultureInfo.InvariantCulture);
    public static string QbCustomer(string? name, int memberId) => $"{(name ?? "").Trim()} #{memberId}";

    /// <summary>RFC 4180 field: quoted when it holds a comma, quote or line break; quotes doubled. Text that a
    /// spreadsheet would run as a formula (= + - @ at the start) gets a leading apostrophe.</summary>
    public static string CsvField(string? value, bool text = true)
    {
        var v = value ?? "";
        if (text && v.Length > 0 && "=+-@".Contains(v[0])) v = "'" + v;
        return v.IndexOfAny(new[] { ',', '"', '\r', '\n' }) >= 0 ? "\"" + v.Replace("\"", "\"\"") + "\"" : v;
    }

    public static string Csv(IEnumerable<string> header, IEnumerable<IReadOnlyList<(string Value, bool Text)>> rows)
    {
        var sb = new StringBuilder();
        sb.Append(string.Join(",", header)).Append("\r\n");
        foreach (var r in rows) sb.Append(string.Join(",", r.Select(c => CsvField(c.Value, c.Text)))).Append("\r\n");
        return sb.ToString();
    }

    // ── Manual invoices and recorded payments ──
    public sealed record LineInput(int? ProductId, string? Description, decimal Quantity, decimal UnitAmount);
    public sealed record PricedLine(int? ProductId, string Description, decimal Quantity, decimal UnitAmount, decimal Amount);

    /// <summary>Checks and prices invoice lines: 1 to 50 lines, a description of at most 300 characters, quantity
    /// above 0 (at most 10000), unit amount 0 to 10,000,000, and a total above 0. Amounts round to 2 decimals.</summary>
    public static IReadOnlyList<PricedLine> PriceLines(IEnumerable<LineInput>? lines)
    {
        var list = lines?.ToList() ?? new();
        if (list.Count is < 1 or > 50) throw new ArgumentException("Add between 1 and 50 line items.");
        var priced = list.Select(l =>
        {
            var desc = (l.Description ?? "").Trim();
            if (desc.Length is 0 or > 300) throw new ArgumentException("Each line needs a description of up to 300 characters.");
            if (l.Quantity <= 0 || l.Quantity > 10000) throw new ArgumentException("Quantity must be above 0 and at most 10000.");
            if (l.UnitAmount < 0 || l.UnitAmount > 10_000_000) throw new ArgumentException("Unit amount must be between 0 and 10,000,000.");
            var q = Math.Round(l.Quantity, 2, MidpointRounding.AwayFromZero);
            var u = Math.Round(l.UnitAmount, 2, MidpointRounding.AwayFromZero);
            return new PricedLine(l.ProductId, desc, q, u, Math.Round(q * u, 2, MidpointRounding.AwayFromZero));
        }).ToList();
        if (priced.Sum(l => l.Amount) <= 0) throw new ArgumentException("The invoice total must be above 0.");
        return priced;
    }

    public static readonly string[] Methods = { "cash", "cheque", "bank" };
    public sealed record OpenInvoice(int Id, decimal Outstanding, bool IsDues);
    public sealed record Split(int InvoiceId, decimal Amount);

    /// <summary>Validates how one recorded payment is split across a member's open invoices. With no split given,
    /// it pays the oldest invoices first. Each part is above 0 and at most what that invoice still owes; a dues
    /// invoice can only be paid in full (the dues module has no part payments). What is left is credit.</summary>
    public static IReadOnlyList<Split> SplitPayment(decimal amount, IReadOnlyList<OpenInvoice> open, IReadOnlyList<Split>? requested)
    {
        if (amount <= 0 || amount > 10_000_000) throw new ArgumentException("Amount must be above 0 and at most 10,000,000.");
        var byId = open.ToDictionary(o => o.Id);
        List<Split> splits;
        if (requested is { Count: > 0 })
        {
            if (requested.Select(r => r.InvoiceId).Distinct().Count() != requested.Count) throw new ArgumentException("An invoice appears twice in the split.");
            splits = requested.Select(r => new Split(r.InvoiceId, Math.Round(r.Amount, 2, MidpointRounding.AwayFromZero))).ToList();
        }
        else
        {
            splits = new();
            var left = amount;
            foreach (var o in open.OrderBy(o => o.Id))
            {
                if (left <= 0) break;
                if (o.IsDues && left < o.Outstanding) continue;
                var take = Math.Min(left, o.Outstanding);
                splits.Add(new Split(o.Id, take));
                left -= take;
            }
        }
        foreach (var s in splits)
        {
            if (!byId.TryGetValue(s.InvoiceId, out var o)) throw new ArgumentException("An invoice in the split is not open for this member.");
            if (s.Amount <= 0 || s.Amount > o.Outstanding) throw new ArgumentException("Each part must be above 0 and at most what the invoice still owes.");
            if (o.IsDues && s.Amount != o.Outstanding) throw new ArgumentException("A dues invoice can only be paid in full.");
        }
        if (splits.Sum(s => s.Amount) > amount) throw new ArgumentException("The split adds up to more than the payment.");
        return splits;
    }

    // ── QuickBooks Desktop IIF ──
    // File → Utilities → Import → IIF Files. Tab separated. Names are created as customers (!CUST block) first.
    // Invoice: TRNS on Accounts Receivable (+total), one SPL per line on the income account (−line amount).
    // Payment: TRNS on Undeposited Funds (+amount), SPL on Accounts Receivable (−amount); DOCNUM = invoice no.
    public const string IifReceivable = "Accounts Receivable", IifIncome = "Club Dues and Fees Income", IifDeposit = "Undeposited Funds";
    public sealed record IifInvoice(string InvoiceNo, string Customer, DateTime IssueDate, DateTime DueDate, IReadOnlyList<(string Item, decimal Amount)> Lines);
    public sealed record IifPayment(string Customer, DateTime Date, decimal Amount, string Reference, string? InvoiceNo);

    // IIF has no quoting: tabs, line breaks and double quotes inside a value are replaced.
    public static string IifField(string? v) => (v ?? "").Replace('\t', ' ').Replace('\r', ' ').Replace('\n', ' ').Replace('"', '\'').Trim();

    public static string Iif(IEnumerable<IifInvoice> invoices, IEnumerable<IifPayment> payments)
    {
        var inv = invoices.ToList();
        var pay = payments.ToList();
        var sb = new StringBuilder();
        void Row(params string[] f) => sb.Append(string.Join("\t", f)).Append("\r\n");
        Row("!CUST", "NAME");
        foreach (var n in inv.Select(i => i.Customer).Concat(pay.Select(p => p.Customer)).Distinct()) Row("CUST", IifField(n));
        Row("!TRNS", "TRNSTYPE", "DATE", "ACCNT", "NAME", "AMOUNT", "DOCNUM", "MEMO", "DUEDATE");
        Row("!SPL", "TRNSTYPE", "DATE", "ACCNT", "NAME", "AMOUNT", "DOCNUM", "MEMO", "DUEDATE");
        Row("!ENDTRNS");
        foreach (var i in inv)
        {
            var date = QbDate(i.IssueDate);
            Row("TRNS", "INVOICE", date, IifReceivable, IifField(i.Customer), QbAmount(i.Lines.Sum(l => l.Amount)), IifField(i.InvoiceNo), "", QbDate(i.DueDate));
            foreach (var l in i.Lines)
                Row("SPL", "INVOICE", date, IifIncome, IifField(i.Customer), QbAmount(-l.Amount), IifField(i.InvoiceNo), IifField(l.Item), "");
            Row("ENDTRNS");
        }
        foreach (var p in pay)
        {
            var date = QbDate(p.Date);
            Row("TRNS", "PAYMENT", date, IifDeposit, IifField(p.Customer), QbAmount(p.Amount), IifField(p.InvoiceNo), IifField(p.Reference), "");
            Row("SPL", "PAYMENT", date, IifReceivable, IifField(p.Customer), QbAmount(-p.Amount), IifField(p.InvoiceNo), IifField(p.Reference), "");
            Row("ENDTRNS");
        }
        return sb.ToString();
    }

    // ── Meal charges ──
    public sealed record DinerInput(int MemberId, bool Ate, IReadOnlyList<string>? Guests);
    public sealed record Meal(int MemberId, string GuestName);

    /// <summary>Who ate at a meeting: each member once; a member's guests are named lines on the host (at most 20,
    /// 1 to 150 characters, no repeats per host). A guest can be listed without the host eating.</summary>
    public static IReadOnlyList<Meal> Diners(IEnumerable<DinerInput>? diners)
    {
        var list = diners?.ToList() ?? new();
        if (list.Select(d => d.MemberId).Distinct().Count() != list.Count) throw new ArgumentException("A member appears twice.");
        var meals = new List<Meal>();
        foreach (var d in list)
        {
            if (d.MemberId <= 0) throw new ArgumentException("Member is missing.");
            if (d.Ate) meals.Add(new Meal(d.MemberId, ""));
            var guests = (d.Guests ?? Array.Empty<string>()).Select(g => (g ?? "").Trim()).ToList();
            if (guests.Count > 20) throw new ArgumentException("At most 20 guests per member.");
            if (guests.Any(g => g.Length is 0 or > 150)) throw new ArgumentException("Each guest needs a name of up to 150 characters.");
            if (guests.Distinct(StringComparer.OrdinalIgnoreCase).Count() != guests.Count) throw new ArgumentException("A guest name appears twice for one member.");
            meals.AddRange(guests.Select(g => new Meal(d.MemberId, g)));
        }
        if (meals.Count > 2000) throw new ArgumentException("Too many diners for one meeting.");
        return meals;
    }

    public static string MealLine(DateTime date, string? meeting, string guest)
    {
        var what = string.IsNullOrEmpty(guest) ? "Meal" : $"Guest meal ({guest})";
        var m = string.IsNullOrWhiteSpace(meeting) ? "" : $", {meeting.Trim()}";
        var line = $"{what}, {date.ToString("dd MMM yyyy", CultureInfo.InvariantCulture)}{m}";
        return line.Length > 300 ? line[..300] : line;
    }

    /// <summary>"2026-11" → 1 Nov 2026 to 30 Nov 2026.</summary>
    public static (DateTime From, DateTime To) Month(string? month)
    {
        if (!DateTime.TryParseExact(month, "yyyy-MM", CultureInfo.InvariantCulture, DateTimeStyles.None, out var m) || m.Year < 2000)
            throw new ArgumentException("Month must look like 2026-11.");
        return (m, m.AddMonths(1).AddDays(-1));
    }
}
