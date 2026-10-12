namespace RotaryApi.DTOs;

public class MemberAddressDto
{
    public int Id { get; set; }
    public int FkMemberMasterProfileId { get; set; }
    public string AddressType { get; set; } = string.Empty;
    public int FkCountryId { get; set; } = 1;
    public string Country { get; set; } = "India";
    public string? CountryPhoneCode { get; set; }
    public string? PhoneNumber { get; set; }
    public string? Address { get; set; }
    public string? State { get; set; }
    public string? City { get; set; }
    public string? PinCode { get; set; }
    public string? BusinessName { get; set; }
    public string? BusinessEmailId { get; set; }
    public string? Keywords { get; set; }
}
