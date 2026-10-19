using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IMembershipDuesService
{
    // CRUD
    Task<IEnumerable<MembershipDuesListDto>> GetListAsync(int? clubId, int? districtId, string? search, string? year);
    Task<MembershipDuesDetailDto?> GetDetailAsync(int duesId);
    Task<int> CreateAsync(CreateMembershipDuesDto dto, IFormFile? logo, IFormFile? bgImage, IFormFile? emailLogo, int userId, IWebHostEnvironment env);
    Task UpdateAsync(int duesId, CreateMembershipDuesDto dto, IFormFile? logo, IFormFile? bgImage, IFormFile? emailLogo, int userId, IWebHostEnvironment env);
    Task UpdateBasicAsync(int duesId, string? purpose, string? purposeDescription, string? emailCC, string? emailSubject, string? emailBody, string? emailReminderSubject, string? emailReminderBody, IFormFile? logo, IFormFile? bgImage, IFormFile? emailLogo, int userId, IWebHostEnvironment env);
    Task DeleteAsync(int duesId, int userId);
    Task ToggleActiveAsync(int duesId, int userId);

    // Member Fees
    Task<object> GetMemberFeesAsync(int duesId, string? search, string? filter);
    Task AllocateDefaultFeesAsync(int duesId, int userId);
    Task UpdateMemberFeeAsync(int duesId, int memberFeeId, UpdateMemberFeeDto dto, int userId);

    // Offline Payments
    Task<int> RecordOfflinePaymentAsync(int duesId, int memberFeeId, RecordOfflineDuesPaymentDto dto, IFormFile? attachment, int userId, IWebHostEnvironment env);
    Task UpdateOfflinePaymentAsync(int paymentId, RecordOfflineDuesPaymentDto dto, IFormFile? attachment, int userId, IWebHostEnvironment env, bool sendReceiptOnUpdate);
    Task ApproveRejectPaymentAsync(int paymentId, ApproveDuesPaymentDto dto, int userId);
    Task DeleteOfflinePaymentAsync(int paymentId, int userId);

    // Receipts & Reminders
    Task SendReceiptEmailAsync(int paymentId);
    // Fee-id-based send. Resolves latest-paid payment for the given
    // membership_dues_member_fees.pk_id, then dispatches the receipt.
    // Used by the "Send Receipt" button on the club-admin members list —
    // never call SendReceiptEmailAsync with a fee id (they collide with
    // unrelated payment ids across tables).
    Task SendReceiptEmailByFeeIdAsync(int memberFeeId);
    Task SendReminderEmailAsync(int memberFeeId, int feeType, string? remark);
    Task BulkSendReminderEmailAsync(int duesId, string? remark);

    // Google Sheets
    Task<string> CreateGoogleSheetAsync(int duesId);
    Task DeleteGoogleSheetAsync(int duesId);

    // Public
    Task<PublicMembershipDuesDto?> GetPublicDuesAsync(int duesId);
    Task<IEnumerable<dynamic>> SearchMembersAsync(int duesId, string? query);
    Task<object?> GetMemberDuesStatusAsync(int duesId, int memberProfileId);
    Task<bool> SendPaymentOtpAsync(int duesId, SendOtpRequestDto dto);
    Task<bool> VerifyOtpAsync(int duesId, VerifyOtpRequestDto dto);
    Task<DuesPaymentSessionResponseDto> CreatePaymentOrderAsync(int duesId, PublicDuesPaymentSubmitDto dto);
    Task<VerifyPaymentResponseDto> VerifyPaymentAsync(int duesId, string orderId, int paymentId);
    Task HandleWebhookAsync(string payload);

    // Shared mark-paid path for ONLINE dues payments. Used by the Cashfree webhook and
    // by MembershipDuesReconciliationBackgroundService when the webhook never arrived,
    // so receipts / sheet sync / settlement refresh stay identical either way.
    // Guarded by IsPaid=0 (plus PaymentStatus='ACTIVE' when requireActiveStatus is set);
    // returns true only if this call is the one that flipped the row.
    Task<bool> MarkOnlineDuesPaymentPaidAsync(int paymentId, string paidSource, bool viaWebhook, bool requireActiveStatus);

    // Report
    Task<object?> GetPublicReportAsync(int duesId);
    Task<byte[]> ExportMembersCsvAsync(int duesId);

    // Public offline
    Task<int> RecordPublicOfflinePaymentAsync(int duesId, RecordOfflineDuesPaymentDto dto, IFormFile? attachment, IWebHostEnvironment env);

    // Settlements
    Task RefreshSettlementsAsync(int duesId);
    Task<object> GetSettlementReportAsync(int duesId);

    // Payment status correction (SuperAdmin only)
    // Reverts a member fee that is currently Paid back to Unpaid. NOT a refund —
    // no money moves. The payment row is kept (soft-deleted + marked 'Reverted')
    // so the audit trail survives; every read path derives paid/unpaid live from
    // non-deleted membership_dues_payments rows, so this alone flips the status.
    Task<RevertDuesPaymentResultDto> RevertMemberFeePaymentAsync(int duesId, int memberFeeId, RevertDuesPaymentDto dto, int userId);
}
