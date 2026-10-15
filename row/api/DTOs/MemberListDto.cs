namespace RotaryApi.DTOs;

public class MemberListDto
{
    public int Id { get; set; }
    public string MemberName { get; set; } = string.Empty;
    public string? ProfilePhotoPath { get; set; }
    public string? EmailId { get; set; }
    public string? PrimaryMobileNumber { get; set; }
    public string? PrimaryCountryPhoneCode { get; set; }
    public string? BloodGroup { get; set; }
    public string? Gender { get; set; }
    public string? RotaryId { get; set; }
    // From Business address (joined)
    public string? BusinessName { get; set; }
    public string? Designation { get; set; }
    // From Residential address (joined)
    public string? ResCity { get; set; }
    public string? ResState { get; set; }
}
