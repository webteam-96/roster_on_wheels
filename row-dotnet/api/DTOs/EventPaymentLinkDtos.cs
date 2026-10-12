namespace RotaryApi.DTOs;

// ── Masters ──────────────────────────────────────────────────────
public class EventTshirtSizeDto
{
    public int Id { get; set; }
    public string SizeName { get; set; } = "";
    public int SortOrder { get; set; }
    public bool IsActive { get; set; }
}
public class CreateEventTshirtSizeDto
{
    public string SizeName { get; set; } = "";
    public int SortOrder { get; set; }
}
public class EventFoodPreferenceDto
{
    public int Id { get; set; }
    public string FoodType { get; set; } = "";
    public int SortOrder { get; set; }
    public bool IsActive { get; set; }
}
public class CreateEventFoodPreferenceDto
{
    public string FoodType { get; set; } = "";
    public int SortOrder { get; set; }
}

// ── Payment Link ─────────────────────────────────────────────────
public class EventPaymentLinkListDto
{
    public int Id { get; set; }
    public int FormType { get; set; }
    public string? DistrictNumber { get; set; }
    public string? ClubName { get; set; }
    public string? Title { get; set; }
    public int RegistrationCount { get; set; }
    public int PaidCount { get; set; }
    public int UnpaidCount { get; set; }
    public bool IsActive { get; set; }
    public DateTime CreatedDate { get; set; }
    public string? CreatedByName { get; set; }
    public string? WeblinkUrl { get; set; }
    public string? GoogleSheetUrl { get; set; }
    public string? GoogleSheetId { get; set; }
}

public class EventPaymentLinkDetailDto
{
    public int Id { get; set; }
    public int FormType { get; set; }
    public int AmountType { get; set; }
    public int? FkDistrictMasterId { get; set; }
    public int? FkClubId { get; set; }
    public string? DistrictNumber { get; set; }
    public string? ClubName { get; set; }
    public bool IsForAllDistricts { get; set; }
    public string? DistrictIdsList { get; set; }
    public int RecipientType { get; set; }
    public string? SubgroupIds { get; set; }
    public string? SubgroupYear { get; set; }
    public string? Title { get; set; }
    public string? Description { get; set; }
    public string? PurposeLogo { get; set; }
    public string? PurposeEventImage { get; set; }
    public string? BackgroundImage { get; set; }
    public string? WeblinkUrl { get; set; }
    public bool IsHideCharges { get; set; }
    // Form toggles
    public bool IsForm { get; set; }
    public bool IsTshirtSize { get; set; }
    public bool IsFood { get; set; }
    public string? FoodPreferenceIds { get; set; }
    public bool IsPartner { get; set; }
    public bool IsPartnerName { get; set; }
    public bool IsPartnerMobile { get; set; }
    public bool IsPartnerEmail { get; set; }
    public bool IsPartnerGender { get; set; }
    public bool IsRemark1 { get; set; }
    public string? Remark1Title { get; set; }
    public bool IsRemark2 { get; set; }
    public string? Remark2Title { get; set; }
    public bool IsRemark3 { get; set; }
    public string? Remark3Title { get; set; }
    public bool IsDesignation { get; set; }
    public string? DesignationLabel { get; set; }
    public bool IsPersonal { get; set; }
    public bool IsPersonalName { get; set; }
    public bool IsPersonalMobile { get; set; }
    public bool IsPersonalEmail { get; set; }
    public bool IsPersonalDistrict { get; set; }
    public bool IsPersonalClub { get; set; }
    // Email
    public string? EmailHeaderLogo { get; set; }
    public string? EmailCc { get; set; }
    public string? EmailSubject { get; set; }
    public string? EmailBody { get; set; }
    public string? EmailReminderSubject { get; set; }
    public string? EmailReminderBody { get; set; }
    // Google sheet
    public string? GoogleSheetUrl { get; set; }
    public string? GoogleSheetName { get; set; }
    public string? GoogleSheetId { get; set; }
    public string? GoogleSheetEmail { get; set; }
    public int? FkWeblinkId { get; set; }
    public bool IsActive { get; set; }
    // Related data
    public List<EventRegistrationDto> Registrations { get; set; } = new();
    public List<EventVendorSplitDto> VendorSplits { get; set; } = new();
    public List<EventDesignationDto> Designations { get; set; } = new();
}

public class CreateEventPaymentLinkDto
{
    public int FormType { get; set; }
    public int AmountType { get; set; }
    public int? FkDistrictMasterId { get; set; }
    public int? FkClubId { get; set; }
    public bool IsForAllDistricts { get; set; }
    public string? DistrictIdsList { get; set; }
    public int RecipientType { get; set; }
    public string? SubgroupIds { get; set; }
    public string? SubgroupYear { get; set; }
    public string? Title { get; set; }
    public string? Description { get; set; }
    public string? WeblinkUrl { get; set; }
    public bool IsHideCharges { get; set; }
    public bool IsForm { get; set; }
    public bool IsTshirtSize { get; set; }
    public bool IsFood { get; set; }
    public string? FoodPreferenceIds { get; set; }
    public bool IsPartner { get; set; }
    public bool IsPartnerName { get; set; }
    public bool IsPartnerMobile { get; set; }
    public bool IsPartnerEmail { get; set; }
    public bool IsPartnerGender { get; set; }
    public bool IsRemark1 { get; set; }
    public string? Remark1Title { get; set; }
    public bool IsRemark2 { get; set; }
    public string? Remark2Title { get; set; }
    public bool IsRemark3 { get; set; }
    public string? Remark3Title { get; set; }
    public bool IsDesignation { get; set; }
    public string? DesignationLabel { get; set; }
    public bool IsPersonal { get; set; }
    public bool IsPersonalName { get; set; }
    public bool IsPersonalMobile { get; set; }
    public bool IsPersonalEmail { get; set; }
    public bool IsPersonalDistrict { get; set; }
    public bool IsPersonalClub { get; set; }
    public string? EmailCc { get; set; }
    public string? EmailSubject { get; set; }
    public string? EmailBody { get; set; }
    public string? EmailReminderSubject { get; set; }
    public string? EmailReminderBody { get; set; }
}

public class UpdateEventPaymentLinkDto : CreateEventPaymentLinkDto { }

// Full create DTO — all data in one request (wizard flow)
public class CreateFullEventPaymentLinkDto
{
    // Basic info
    public int FormType { get; set; }
    public int AmountType { get; set; }
    public int? FkDistrictMasterId { get; set; }
    public int? FkClubId { get; set; }
    public bool IsForAllDistricts { get; set; }
    public string? DistrictIdsList { get; set; }
    public int RecipientType { get; set; }
    public string? Title { get; set; }
    public string? Description { get; set; }
    public bool IsHideCharges { get; set; }
    // Form fields
    public bool IsForm { get; set; }
    public bool IsTshirtSize { get; set; }
    public bool IsFood { get; set; }
    public string? FoodPreferenceIds { get; set; }
    public bool IsPartner { get; set; }
    public bool IsPartnerName { get; set; }
    public bool IsPartnerMobile { get; set; }
    public bool IsPartnerEmail { get; set; }
    public bool IsPartnerGender { get; set; }
    public bool IsRemark1 { get; set; }
    public string? Remark1Title { get; set; }
    public bool IsRemark2 { get; set; }
    public string? Remark2Title { get; set; }
    public bool IsRemark3 { get; set; }
    public string? Remark3Title { get; set; }
    public bool IsDesignation { get; set; }
    public string? DesignationLabel { get; set; }
    public bool IsPersonal { get; set; }
    public bool IsPersonalName { get; set; }
    public bool IsPersonalMobile { get; set; }
    public bool IsPersonalEmail { get; set; }
    public bool IsPersonalDistrict { get; set; }
    public bool IsPersonalClub { get; set; }
    // Email
    public string? EmailCc { get; set; }
    public string? EmailSubject { get; set; }
    public string? EmailBody { get; set; }
    public string? EmailReminderSubject { get; set; }
    public string? EmailReminderBody { get; set; }
    // Google Sheet
    public string? GoogleSheetEmail { get; set; }
    // Registrations
    public List<CreateEventRegistrationDto> Registrations { get; set; } = new();
    // Vendor Splits
    public List<VendorSplitItem> VendorSplits { get; set; } = new();
    // Designations
    public List<CreateEventDesignationDto> Designations { get; set; } = new();
}

// ── Registration Types ───────────────────────────────────────────
public class EventRegistrationDto
{
    public int Id { get; set; }
    public string RegistrationName { get; set; } = "";
    public decimal Amount { get; set; }
}
public class CreateEventRegistrationDto
{
    public string RegistrationName { get; set; } = "";
    public decimal Amount { get; set; }
}

// ── Vendor Splits ────────────────────────────────────────────────
public class EventVendorSplitDto
{
    public int Id { get; set; }
    public int FkRegistrationId { get; set; }
    public string? RegistrationName { get; set; }
    public int FkKycId { get; set; }
    public string? VendorId { get; set; }
    public string? VendorName { get; set; }
    public decimal SplitAmount { get; set; }
}
public class SaveVendorSplitsDto
{
    public List<VendorSplitItem> Splits { get; set; } = new();
}
public class VendorSplitItem
{
    public int FkRegistrationId { get; set; }
    public int FkKycId { get; set; }
    public decimal SplitAmount { get; set; }
}

// ── Designations ─────────────────────────────────────────────────
public class EventDesignationDto
{
    public int Id { get; set; }
    public string DesignationName { get; set; } = "";
}
public class CreateEventDesignationDto
{
    public string DesignationName { get; set; } = "";
}

// ── Members ──────────────────────────────────────────────────────
public class EventMemberListDto
{
    public int Id { get; set; }
    public string? MemberName { get; set; }
    public string? Mobile { get; set; }
    public string? Email { get; set; }
    public string? RegistrationType { get; set; }
    public decimal? Amount { get; set; }
    public bool IsPaid { get; set; }
    public bool IsOnline { get; set; }
    public DateTime? PaymentDate { get; set; }
    public string? TransactionId { get; set; }
    public string? OfflineTransactionType { get; set; }
    public string? Attachment { get; set; }
    public string? DistrictNumber { get; set; }
    public string? ClubName { get; set; }
    public int? FkMemberProfileId { get; set; }
}

public class RecordOfflinePaymentDto
{
    public int? FkMemberProfileId { get; set; }
    public string? MemberName { get; set; }
    public string? Mobile { get; set; }
    public string? Email { get; set; }
    public int? FkCountryCodeId { get; set; }
    public string? DistrictNumber { get; set; }
    public string? ClubName { get; set; }
    public int FkRegistrationId { get; set; }
    public string TransactionType { get; set; } = "";
    public string? TransactionId { get; set; }
    public string? GivenTo { get; set; }
    public string? BankName { get; set; }
    public string? ChequeNumber { get; set; }
    public string? PaymentDate { get; set; }
    public string? Remark { get; set; }
    public int? FkTshirtSizeId { get; set; }
    public int? FkFoodPreferenceId { get; set; }
    public string? PartnerName { get; set; }
    public string? PartnerMobile { get; set; }
    public string? PartnerEmail { get; set; }
    public string? PartnerGender { get; set; }
    public string? Remark1 { get; set; }
    public string? Remark2 { get; set; }
    public string? Remark3 { get; set; }
    public int? FkDesignationId { get; set; }
    public bool SendEmail { get; set; }
}

// ── Public (no auth) ─────────────────────────────────────────────
public class PublicEventLinkDto
{
    public int Id { get; set; }
    public int FormType { get; set; }
    public string? Title { get; set; }
    public string? Description { get; set; }
    public string? PurposeEventImage { get; set; }
    public string? PurposeLogo { get; set; }
    public string? BackgroundImage { get; set; }
    public bool IsForm { get; set; }
    public bool IsTshirtSize { get; set; }
    public bool IsFood { get; set; }
    public string? FoodPreferenceIds { get; set; }
    public bool IsPartner { get; set; }
    public bool IsPartnerName { get; set; }
    public bool IsPartnerMobile { get; set; }
    public bool IsPartnerEmail { get; set; }
    public bool IsPartnerGender { get; set; }
    public bool IsRemark1 { get; set; }
    public string? Remark1Title { get; set; }
    public bool IsRemark2 { get; set; }
    public string? Remark2Title { get; set; }
    public bool IsRemark3 { get; set; }
    public string? Remark3Title { get; set; }
    public bool IsDesignation { get; set; }
    public string? DesignationLabel { get; set; }
    public bool IsPersonal { get; set; }
    public bool IsPersonalName { get; set; }
    public bool IsPersonalMobile { get; set; }
    public bool IsPersonalEmail { get; set; }
    public bool IsPersonalDistrict { get; set; }
    public bool IsPersonalClub { get; set; }
    public bool IsForAllDistricts { get; set; }
    public string? DistrictIdsList { get; set; }
    public int? FkDistrictMasterId { get; set; }
    public int? FkClubId { get; set; }
    public string? DistrictNumber { get; set; }
    public string? ClubName { get; set; }
    public List<EventRegistrationDto> Registrations { get; set; } = new();
    public List<EventDesignationDto> Designations { get; set; } = new();
    public List<EventTshirtSizeDto> TshirtSizes { get; set; } = new();
    public List<EventFoodPreferenceDto> FoodPreferences { get; set; } = new();
    public List<PublicDistrictDto> Districts { get; set; } = new();
}

public class PublicDistrictDto
{
    public int Id { get; set; }
    public string DistrictNumber { get; set; } = "";
}
public class PublicClubDto
{
    public int Id { get; set; }
    public string ClubName { get; set; } = "";
}

public class PublicMemberSearchDto
{
    public int MemberProfileId { get; set; }
    public string? MemberName { get; set; }
    public string? MaskedMobile { get; set; }
    public string? MaskedEmail { get; set; }
    public bool IsPaid { get; set; }
}

public class SendOtpRequestDto
{
    public string? Email { get; set; }
    public string? Mobile { get; set; }
    public int? MemberProfileId { get; set; }
}

public class VerifyOtpRequestDto
{
    public string? Email { get; set; }
    public string? Mobile { get; set; }
    public string OtpCode { get; set; } = "";
    public int? MemberProfileId { get; set; }
}

public class PublicPaymentSubmitDto
{
    public int? FkMemberProfileId { get; set; }
    public string? MemberName { get; set; }
    public string? Mobile { get; set; }
    public string? Email { get; set; }
    public int? FkCountryCodeId { get; set; }
    public string? DistrictNumber { get; set; }
    public string? ClubName { get; set; }
    public int FkRegistrationId { get; set; }
    public int? FkTshirtSizeId { get; set; }
    public int? FkFoodPreferenceId { get; set; }
    public string? PartnerName { get; set; }
    public string? PartnerMobile { get; set; }
    public string? PartnerEmail { get; set; }
    public string? PartnerGender { get; set; }
    public string? Remark1 { get; set; }
    public string? Remark2 { get; set; }
    public string? Remark3 { get; set; }
    public int? FkDesignationId { get; set; }
}

public class PaymentSessionResponseDto
{
    public string PaymentSessionId { get; set; } = "";
    public string CfOrderId { get; set; } = "";
    public string OrderId { get; set; } = "";
    public int MemberPaymentId { get; set; }
    public string Environment { get; set; } = "";
    // When non-empty, frontend should redirect to this URL instead of opening Cashfree's JS SDK
    // directly. The proxy hosts the SDK on a whitelisted domain (example.org).
    public string? GatewayProxyUrl { get; set; }
}

public class VerifyPaymentResponseDto
{
    public bool IsSuccess { get; set; }
    public string? OrderStatus { get; set; }
    public string? MemberName { get; set; }
    public decimal? Amount { get; set; }
    public string? RegistrationType { get; set; }
    public DateTime? PaymentDate { get; set; }
}

public class SendEmailRemarkDto
{
    public string? Remark { get; set; }
}

// ── Public Report ───────────────────────────────────────────────
public class PublicReportDto
{
    public PublicReportLinkDetailsDto LinkDetails { get; set; } = new();
    public List<PublicReportMemberDto> Members { get; set; } = new();
}

public class PublicReportLinkDetailsDto
{
    public string? Title { get; set; }
    public string? Description { get; set; }
    public int FormType { get; set; }
    public string? DistrictNumber { get; set; }
    public string? ClubName { get; set; }
}

public class PublicReportMemberDto
{
    public int SrNo { get; set; }
    public string? MemberName { get; set; }
    public string? DistrictNumber { get; set; }
    public string? ClubName { get; set; }
    public string? Mobile { get; set; }
    public string? Email { get; set; }
    public string? RegistrationName { get; set; }
    public decimal Amount { get; set; }
    public DateTime? PaymentDate { get; set; }
    public string? PaidSource { get; set; }
    public string? PartnerName { get; set; }
    public string? TshirtSize { get; set; }
    public string? FoodPreference { get; set; }
    public string? Remark1 { get; set; }
    public string? Remark2 { get; set; }
    public string? Remark3 { get; set; }
    public string? DesignationName { get; set; }
}
