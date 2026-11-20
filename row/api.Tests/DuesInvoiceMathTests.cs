using RotaryApi.Services;
using Xunit;
using static RotaryApi.Services.DuesInvoiceMath;

namespace RotaryApi.Tests;

public class DuesInvoiceMathTests
{
    [Fact]
    public void Invoice_numbers_are_padded_and_reject_zero()
    {
        Assert.Equal("INV-00042", FormatInvoiceNo(42));
        Assert.Throws<ArgumentOutOfRangeException>(() => FormatInvoiceNo(0));
    }

    [Fact]
    public void Status_follows_paid_amount()
    {
        Assert.Equal(Open, StatusFor(100, 0));
        Assert.Equal(PartPaid, StatusFor(100, 40));
        Assert.Equal(Paid, StatusFor(100, 100));
    }

    [Fact]
    public void Allocate_pays_own_fee_type_first_then_oldest_and_keeps_overpayment()
    {
        var r = Allocate(new[] { new InvoiceSlot(1, 1, 100), new InvoiceSlot(2, 2, 50) },
            new[] { new PaymentSlot(10, 2, 70), new PaymentSlot(11, 1, 120) });
        Assert.Equal(50, r.PaidByInvoice[2]);
        Assert.Equal(100, r.PaidByInvoice[1]);
        Assert.Equal(40, r.Unapplied); // 20 of payment 10 went to invoice 1, so 120 - 80 = 40 left
    }

    [Fact]
    public void Statement_carries_opening_balance_and_running_total()
    {
        var lines = new[]
        {
            new StatementLine(new DateTime(2026, 1, 5), true, "INV-1", "Dues", 100),
            new StatementLine(new DateTime(2026, 2, 1), false, "PAY-1", "Payment", 60),
            new StatementLine(new DateTime(2026, 3, 1), true, "INV-2", "Dinner", 30),
            new StatementLine(new DateTime(2026, 3, 1), false, "PAY-2", "Payment", 10),
        };
        var s = BuildStatement(lines, new DateTime(2026, 2, 1), new DateTime(2026, 3, 31));
        Assert.Equal(100, s.Opening);
        Assert.Equal(new[] { 40m, 70m, 60m }, s.Rows.Select(r => r.Balance));
        Assert.Equal(60, s.Closing);
    }

    [Fact]
    public void Csv_quotes_and_defuses_formulas()
    {
        Assert.Equal("\"a,b\"", CsvField("a,b"));
        Assert.Equal("\"say \"\"hi\"\"\"", CsvField("say \"hi\""));
        Assert.Equal("'=SUM(A1)", CsvField("=SUM(A1)"));
        Assert.Equal("-10.00", CsvField("-10.00", text: false));
    }

    [Fact]
    public void PriceLines_rounds_and_validates()
    {
        var p = PriceLines(new[] { new LineInput(null, " Dinner ", 3, 12.345m) });
        Assert.Equal("Dinner", p[0].Description);
        Assert.Equal(37.05m, p[0].Amount); // 3 x 12.35
        Assert.Throws<ArgumentException>(() => PriceLines(Array.Empty<LineInput>()));
        Assert.Throws<ArgumentException>(() => PriceLines(new[] { new LineInput(null, "", 1, 5) }));
        Assert.Throws<ArgumentException>(() => PriceLines(new[] { new LineInput(null, "x", 0, 5) }));
        Assert.Throws<ArgumentException>(() => PriceLines(new[] { new LineInput(null, "x", 1, 0) }));
    }

    private static readonly OpenInvoice[] Open3 = { new(1, 100, true), new(2, 30, false), new(3, 50, false) };

    [Fact]
    public void SplitPayment_auto_pays_oldest_and_skips_dues_it_cannot_clear()
    {
        Assert.Equal(new[] { (1, 100m), (2, 30m), (3, 20m) }, SplitPayment(150, Open3, null).Select(s => (s.InvoiceId, s.Amount)));
        // 60 cannot clear dues invoice 1, so it goes to 2 then 3.
        Assert.Equal(new[] { (2, 30m), (3, 30m) }, SplitPayment(60, Open3, null).Select(s => (s.InvoiceId, s.Amount)));
    }

    [Fact]
    public void SplitPayment_rejects_bad_splits()
    {
        Assert.Throws<ArgumentException>(() => SplitPayment(100, Open3, new[] { new Split(1, 50) }));            // part of a dues invoice
        Assert.Throws<ArgumentException>(() => SplitPayment(100, Open3, new[] { new Split(2, 31) }));            // more than owed
        Assert.Throws<ArgumentException>(() => SplitPayment(100, Open3, new[] { new Split(9, 10) }));            // not this member's
        Assert.Throws<ArgumentException>(() => SplitPayment(40, Open3, new[] { new Split(2, 30), new Split(3, 20) })); // over the payment
        Assert.Throws<ArgumentException>(() => SplitPayment(0, Open3, null));
        // A split smaller than the payment leaves credit.
        Assert.Single(SplitPayment(80, Open3, new[] { new Split(2, 30) }));
    }

    [Fact]
    public void Iif_writes_balanced_invoice_and_payment_blocks()
    {
        var iif = Iif(
            new[] { new IifInvoice("INV-00001", "Asha\tRao #7", new DateTime(2026, 7, 1), new DateTime(2026, 7, 31), new[] { ("Dues", 100m), ("Dinner", 25m) }) },
            new[] { new IifPayment("Asha\tRao #7", new DateTime(2026, 7, 5), 125m, "CHQ 12", "INV-00001") });
        var lines = iif.Split("\r\n", StringSplitOptions.RemoveEmptyEntries);
        Assert.Equal("!CUST\tNAME", lines[0]);
        Assert.Equal("CUST\tAsha Rao #7", lines[1]); // tab inside a value is replaced
        Assert.Contains("TRNS\tINVOICE\t07/01/2026\tAccounts Receivable\tAsha Rao #7\t125.00\tINV-00001\t\t07/31/2026", lines);
        Assert.Contains(lines, l => l.StartsWith("SPL\tINVOICE\t07/01/2026\tClub Dues and Fees Income\tAsha Rao #7\t-25.00"));
        Assert.Contains("TRNS\tPAYMENT\t07/05/2026\tUndeposited Funds\tAsha Rao #7\t125.00\tINV-00001\tCHQ 12\t", lines);
        Assert.Equal(2, lines.Count(l => l == "ENDTRNS"));
        // Each transaction sums to zero.
        decimal Sum(string type) => lines.Where(l => (l.StartsWith("TRNS\t" + type) || l.StartsWith("SPL\t" + type)))
            .Sum(l => decimal.Parse(l.Split('\t')[5], System.Globalization.CultureInfo.InvariantCulture));
        Assert.Equal(0, Sum("INVOICE"));
        Assert.Equal(0, Sum("PAYMENT"));
    }

    [Fact]
    public void Diners_lists_members_and_named_guests_on_the_host()
    {
        var meals = Diners(new[]
        {
            new DinerInput(7, true, new[] { " Ann Lee ", "Raj" }),
            new DinerInput(8, false, new[] { "Guest of 8" }), // host did not eat, guest did
            new DinerInput(9, false, null),
        });
        Assert.Equal(new[] { (7, ""), (7, "Ann Lee"), (7, "Raj"), (8, "Guest of 8") }, meals.Select(m => (m.MemberId, m.GuestName)));
        Assert.Throws<ArgumentException>(() => Diners(new[] { new DinerInput(7, true, null), new DinerInput(7, false, null) }));
        Assert.Throws<ArgumentException>(() => Diners(new[] { new DinerInput(7, true, new[] { "Raj", "raj" }) }));
        Assert.Throws<ArgumentException>(() => Diners(new[] { new DinerInput(7, true, new[] { " " }) }));
        Assert.Empty(Diners(null));
    }

    [Fact]
    public void MealLine_and_Month()
    {
        Assert.Equal("Meal, 05 Nov 2026, Weekly meeting", MealLine(new DateTime(2026, 11, 5), "Weekly meeting", ""));
        Assert.Equal("Guest meal (Raj), 05 Nov 2026", MealLine(new DateTime(2026, 11, 5), null, "Raj"));
        Assert.Equal((new DateTime(2026, 2, 1), new DateTime(2026, 2, 28)), Month("2026-02"));
        Assert.Throws<ArgumentException>(() => Month("Nov 2026"));
    }
}
