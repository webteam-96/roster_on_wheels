namespace RotaryApi.DTOs;

public class FamilyMemberDto
{
    public int Id { get; set; }
    public int FkMemberMasterProfileId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Relation { get; set; }
    public string? BloodGroup { get; set; }
    public int FkCountryId { get; set; }   // ROW: no default country (the original: 1 = India)
    public string Country { get; set; } = "India";
    public string? CountryPhoneCode { get; set; }
    public string? PhoneNumber { get; set; }
    public string? EmailId { get; set; }
    public DateTime? BirthDate { get; set; }
    public DateTime? AnniversaryDate { get; set; }
    public string? PhotoPath { get; set; }
}
