using System.Globalization;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

/// <summary>
/// Posts the items-invoice part (meals, products) of a recorded invoice payment to the club ledger as other income.
/// Dues invoices are skipped: their membership_dues_payments rows reach the ledger through SyncDuesPaymentsAsync.
/// </summary>
public sealed class ClubLedgerInvoiceListener(ClubAccountsService accounts) : IInvoicePaymentListener
{
    public const string Source = "invoice_receipt";

    public async Task OnPaymentRecordedAsync(InvoicePaymentRecorded e)
    {
        var items = e.Applied.Where(a => !a.IsDues).ToList();
        var amount = items.Sum(a => a.Amount);
        if (amount <= 0) return;
        var memo = $"Invoice payment {string.Join(", ", items.Select(a => a.InvoiceNo))}";
        await accounts.PostPaymentAsync(new PaymentPosting(e.ClubId, Source, e.ReceiptId.ToString(CultureInfo.InvariantCulture),
            e.ReceiptDate, amount, memo.Length > 255 ? memo[..255] : memo, "other_income", MemberId: e.RecordedBy));
    }
}
