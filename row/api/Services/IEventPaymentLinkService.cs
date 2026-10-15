using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IEventPaymentLinkService
{
    // Masters
    Task<IEnumerable<EventTshirtSizeDto>> GetTshirtSizesAsync();
    Task<int> CreateTshirtSizeAsync(CreateEventTshirtSizeDto dto, int userId);
    Task UpdateTshirtSizeAsync(int id, CreateEventTshirtSizeDto dto, int userId);
    Task DeleteTshirtSizeAsync(int id);
    Task<IEnumerable<EventFoodPreferenceDto>> GetFoodPreferencesAsync();
    Task<int> CreateFoodPreferenceAsync(CreateEventFoodPreferenceDto dto, int userId);
    Task UpdateFoodPreferenceAsync(int id, CreateEventFoodPreferenceDto dto, int userId);
    Task DeleteFoodPreferenceAsync(int id);

    // Payment Links
    Task<IEnumerable<EventPaymentLinkListDto>> GetPaymentLinksAsync(int? clubId, int? districtId, string? search);
    Task<EventPaymentLinkDetailDto?> GetPaymentLinkDetailAsync(int linkId);
    Task<int> CreatePaymentLinkAsync(CreateEventPaymentLinkDto dto, IFormFile? logo, IFormFile? eventImage, IFormFile? bgImage, IFormFile? emailLogo, int userId, IWebHostEnvironment env);
    Task<int> CreateFullPaymentLinkAsync(CreateFullEventPaymentLinkDto dto, IFormFile? logo, IFormFile? bgImage, IFormFile? emailLogo, int userId, IWebHostEnvironment env);
    Task UpdateFullPaymentLinkAsync(int linkId, CreateFullEventPaymentLinkDto dto, IFormFile? logo, IFormFile? bgImage, IFormFile? emailLogo, int userId, IWebHostEnvironment env);
    Task UpdatePaymentLinkAsync(int linkId, UpdateEventPaymentLinkDto dto, IFormFile? logo, IFormFile? eventImage, IFormFile? bgImage, IFormFile? emailLogo, int userId, IWebHostEnvironment env);
    Task DeletePaymentLinkAsync(int linkId, int userId);
    Task ToggleActiveAsync(int linkId, int userId);

    // Registrations
    Task<IEnumerable<EventRegistrationDto>> GetRegistrationsAsync(int linkId);
    Task<int> SaveRegistrationAsync(int linkId, CreateEventRegistrationDto dto, int userId);
    Task UpdateRegistrationAsync(int linkId, int regId, CreateEventRegistrationDto dto, int userId);
    Task DeleteRegistrationAsync(int regId, int userId);

    // Vendor Splits
    Task<IEnumerable<EventVendorSplitDto>> GetVendorSplitsAsync(int linkId);
    Task SaveVendorSplitsAsync(int linkId, SaveVendorSplitsDto dto, int userId);

    // Designations
    Task<IEnumerable<EventDesignationDto>> GetDesignationsAsync(int linkId);
    Task<int> SaveDesignationAsync(int linkId, CreateEventDesignationDto dto, int userId);
    Task DeleteDesignationAsync(int desigId, int userId);

    // Members
    Task<IEnumerable<EventMemberListDto>> GetMembersAsync(int linkId, bool isPaid, string? search);
    Task<int> RecordOfflinePaymentAsync(int linkId, RecordOfflinePaymentDto dto, IFormFile? attachment, int userId, IWebHostEnvironment env);
    Task UpdateOfflinePaymentAsync(int memberPaymentId, RecordOfflinePaymentDto dto, IFormFile? attachment, int userId, IWebHostEnvironment env);
    Task<dynamic?> GetMemberPaymentAsync(int memberPaymentId);
    Task SendReceiptEmailAsync(int memberPaymentId, string? extraRemark = null);
    Task SendReminderEmailAsync(int memberPaymentId, string? extraRemark = null);
    Task SendReminderWhatsAppAsync(int memberPaymentId);
    Task BulkSendReminderEmailAsync(int linkId, string? extraRemark = null);
    Task BulkSendReminderWhatsAppAsync(int linkId);
    Task<byte[]> ExportMembersExcelAsync(int linkId, bool isPaid);

    // Public
    Task<PublicEventLinkDto?> GetPublicLinkDetailsAsync(int linkId);
    Task<IEnumerable<PublicClubDto>> GetClubsForDistrictAsync(int linkId, int districtId);
    Task<IEnumerable<PublicMemberSearchDto>> SearchMembersForLinkAsync(int linkId, int? districtId, int? clubId, string? query);
    Task<bool> SendPaymentOtpAsync(int linkId, SendOtpRequestDto dto);
    Task<bool> VerifyOtpAsync(int linkId, VerifyOtpRequestDto dto);
    Task<PaymentSessionResponseDto> CreatePaymentOrderAsync(int linkId, PublicPaymentSubmitDto dto);
    Task<VerifyPaymentResponseDto> VerifyPaymentAsync(int linkId, string orderId, int memberPaymentId);
    Task HandleWebhookAsync(string payload);
    Task<PublicReportDto?> GetPublicReportAsync(int linkId);
    Task<string> CreateGoogleSheetForLinkAsync(int linkId);
    Task DeleteGoogleSheetForLinkAsync(int linkId);

    // Settlements
    Task RefreshEventSettlementsAsync(int linkId);
    Task<object> GetEventSettlementReportAsync(int linkId);
}
