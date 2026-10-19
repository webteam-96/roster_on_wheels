using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IClubDuesService
{
    // ── Campaign CRUD ───────────────────────────────────────────
    Task<IEnumerable<ClubDuesListDto>> GetListAsync(int? districtId, string? search, string? year);
    Task<ClubDuesDetailDto?> GetDetailAsync(int duesId);
    Task<int> CreateAsync(CreateClubDuesDto dto, IFormFile? logo, IFormFile? bgImage, IFormFile? emailLogo, int userId, IWebHostEnvironment env);
    Task UpdateAsync(int duesId, CreateClubDuesDto dto, IFormFile? logo, IFormFile? bgImage, IFormFile? emailLogo, int userId, IWebHostEnvironment env);
    // District-admin content-only edit: updates ONLY logos + email copy (never amounts/dates/clubs).
    Task UpdateContentAsync(int duesId, UpdateClubDuesContentDto dto, IFormFile? logo, IFormFile? bgImage, IFormFile? emailLogo, int userId, IWebHostEnvironment env);
    Task DeleteAsync(int duesId, int userId);
    Task ToggleActiveAsync(int duesId, int userId);

    // ── Clubs + members (live sync) ─────────────────────────────
    // Ensures a club_dues_clubs row per club in the district and a club_dues_members
    // row per current non-honorary member; new members appear unpaid. Idempotent —
    // safe to call before every clubs-grid load so counts are always live.
    Task SyncClubsAndMembersAsync(int duesId, int userId);
    Task<IEnumerable<ClubDuesClubListDto>> GetClubsAsync(int duesId, string? search, bool includeNonSynced);
    Task<IEnumerable<ClubDuesMemberListDto>> GetClubMembersAsync(int duesId, int clubId);
    Task UpdateClubRateAsync(int duesId, int clubDuesClubId, UpdateClubDuesRateDto dto, int userId);

    // ── Offline payments + approval ─────────────────────────────
    Task<int> RecordOfflinePaymentAsync(int duesId, RecordOfflineClubDuesPaymentDto dto, IFormFile? attachment, int userId, IWebHostEnvironment env);
    Task<int> RecordPublicOfflinePaymentAsync(int duesId, RecordOfflineClubDuesPaymentDto dto, IFormFile? attachment, IWebHostEnvironment env);
    Task ApproveRejectPaymentAsync(int paymentId, ApproveClubDuesPaymentDto dto, int userId);
    Task<ClubDuesOfflineDetailDto?> GetOfflinePaymentDetailAsync(int paymentId);
    Task UpdateOfflinePaymentAsync(int paymentId, RecordOfflineClubDuesPaymentDto dto, IFormFile? attachment, int userId, IWebHostEnvironment env);

    // ── Per-club Razorpay split override ────────────────────────
    Task<IEnumerable<ClubDuesVendorDto>> GetClubVendorsAsync(int duesId, int clubId);
    Task<IEnumerable<ClubDuesClubVendorRow>> GetAllClubVendorsAsync(int duesId);
    Task SaveClubVendorsAsync(int duesId, int clubId, string? vendorsJson, int userId, bool isOnline);
    // Effective account list for the offline-payment picker: per-club override
    // (club_dues_club_vendors) if any rows exist, else the campaign default (club_dues_vendors).
    Task<IEnumerable<ClubDuesOfflineAccountOptionDto>> GetOfflineAccountOptionsAsync(int duesId, int clubId);

    // ── Receipts & reminders ────────────────────────────────────
    Task SendReceiptEmailAsync(int paymentId);
    Task SendReminderEmailAsync(int duesId, int clubId, string? remark);
    Task BulkSendReminderEmailAsync(int duesId, string? remark);
    // Test send of the reminder/receipt email (sample values, current template) — FREE. An optional
    // unsaved email-header logo is embedded inline so the image can be previewed before saving.
    Task SendTestEmailAsync(ClubDuesTestEmailDto dto, IFormFile? emailLogo, int userId);

    // ── Public / payment ────────────────────────────────────────
    // Live snapshot for a club: amount owed = unpaid non-honorary members x rate.
    Task<PublicClubDuesDto?> GetPublicDuesAsync(int duesId, int clubId);
    Task<ClubDuesPaymentSessionResponseDto> CreatePaymentOrderAsync(int duesId, PublicClubDuesPaymentSubmitDto dto);
    Task<VerifyPaymentResponseDto> VerifyPaymentAsync(int duesId, ClubDuesVerifyDto dto);
    Task HandleWebhookAsync(string rawBody, string signatureHeader);
    // Non-expiring, stable shareable pay link for a club (ClubDuesAccessToken).
    ClubDuesPayLinkDto GeneratePayLink(int duesId, int clubId, string frontendUrl);

    // ── Report / export ─────────────────────────────────────────
    Task<object?> GetPublicReportAsync(int duesId);
    Task<byte[]> ExportClubsCsvAsync(int duesId);

    // ── Google Sheets ────────────────────────────────────────────
    // Live, per-club snapshot (one row per club, rewritten in full — not an
    // append-only payment log, since a club's row changes as it pays down).
    Task<string> CreateGoogleSheetAsync(int duesId);
    Task DeleteGoogleSheetAsync(int duesId);
    // One-time/manual backfill — see implementation for detail. SuperAdmin-only maintenance action.
    Task<int> ResyncAllGoogleSheetsAsync();
}
