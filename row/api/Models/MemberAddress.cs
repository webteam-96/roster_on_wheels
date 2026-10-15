namespace RotaryApi.Models;

public class MemberAddress
{
    public int Id { get; set; }
    public int FkMemberMasterProfileId { get; set; }
    public string AddressType { get; set; } = string.Empty; // "Residential" or "Business"
    public int FkCountryId { get; set; } = 1;
    public string? PhoneNumber { get; set; }
    public string? Address { get; set; }
    public string? State { get; set; }
    public string? City { get; set; }
    public string? PinCode { get; set; }
    // Business-specific fields
    public string? BusinessName { get; set; }
    public string? BusinessEmailId { get; set; }
    public string? Keywords { get; set; }
    public int? CreatedBy { get; set; }
    public DateTime? CreatedDate { get; set; }
    public int? ModifiedBy { get; set; }
    public DateTime? ModifiedDate { get; set; }
    public int IsDeleted { get; set; }
    public int? DeletedBy { get; set; }
    public DateTime? DeletedDate { get; set; }
}
