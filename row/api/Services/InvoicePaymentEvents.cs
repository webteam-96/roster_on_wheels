namespace RotaryApi.Services;

/// <summary>Raised after a club records a cash / cheque / bank payment against a member's invoices and the
/// transaction has committed. The club ledger (GL) registers an <see cref="IInvoicePaymentListener"/> to post it;
/// nothing is registered by the invoices module itself.</summary>
public sealed record InvoicePaymentRecorded(
    int ClubId, int ReceiptId, int MemberId, DateTime ReceiptDate, string Method, string? Reference, decimal Amount,
    IReadOnlyList<InvoicePaymentApplied> Applied, int RecordedBy);

/// <param name="IsDues">True for a membership dues invoice (the receipt also wrote a membership_dues_payments row).
/// False for an items invoice (meals, products): non-dues income with no dues payment row.</param>
public sealed record InvoicePaymentApplied(int InvoiceId, string InvoiceNo, decimal Amount, bool IsDues);

public interface IInvoicePaymentListener
{
    /// <summary>A listener failure is logged and never undoes the payment.</summary>
    Task OnPaymentRecordedAsync(InvoicePaymentRecorded e);
}
