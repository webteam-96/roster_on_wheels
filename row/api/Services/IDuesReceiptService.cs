using RotaryApi.DTOs;

namespace RotaryApi.Services;

// Thrown when the caller is not the member the payment belongs to.
// Controllers translate this to 403 (never 200, never another member's data).
public class ReceiptForbiddenException : Exception
{
    public ReceiptForbiddenException(string message) : base(message) { }
}

// Thrown when the payment exists and belongs to the caller, but is not in a
// state that may be receipted (IsPaid=0 — Pending / ACTIVE / Rejected).
public class ReceiptNotPayableException : Exception
{
    public ReceiptNotPayableException(string message) : base(message) { }
}

public interface IDuesReceiptService
{
    // Builds the receipt model for a membership-dues payment, enforcing that
    // the payment belongs to <paramref name="memberId"/> and is actually paid.
    // Throws KeyNotFoundException / ReceiptForbiddenException /
    // ReceiptNotPayableException — never returns another member's data.
    Task<DuesReceiptDto> GetReceiptAsync(int paymentId, int memberId);
}
