namespace RotaryApi.DTOs;

public class MemberDetailDto
{
    public int Id { get; set; }
    public string MemberName { get; set; } = string.Empty;
    public string? ProfilePhotoPath { get; set; }
    public int FkPrimaryCountryId { get; set; }   // ROW: no default country (the original: 1 = India)
    public string PrimaryCountry { get; set; } = "India";
    public string? PrimaryCountryPhoneCode { get; set; }
    public string? PrimaryMobileNumber { get; set; }
    public string? EmailId { get; set; }
    public DateTime? BirthDate { get; set; }
    public DateTime? AnniversaryDate { get; set; }
    public string? BloodGroup { get; set; }
    public int FkSecondaryCountryId { get; set; }   // ROW: no default country (the original: 1 = India)
    public string SecondaryCountry { get; set; } = "India";
    public string? SecondaryCountryPhoneCode { get; set; }
    public string? SecondaryMobileNumber { get; set; }
    public bool IsPersonalDetailsVisible { get; set; }
    public string? Gender { get; set; }
    public string PrimaryLanguage { get; set; } = "English";
    public bool IsYouth { get; set; }
    public string? MemberIntroduction { get; set; }
    public string? Facebook { get; set; }
    public string? Instagram { get; set; }
    public string? LinkedIn { get; set; }
    public string? Twitter { get; set; }
    public string? Youtube { get; set; }
    public string? Website { get; set; }
    public string? RotaryId { get; set; }
    public string? DonorRecognition { get; set; }
    public string? FamilyPhotoPath { get; set; }
    public bool IsFamilyDetailsVisible { get; set; }
    public int? CreatedBy { get; set; }
    public DateTime? CreatedDate { get; set; }
    public int? ModifiedBy { get; set; }
    public DateTime? ModifiedDate { get; set; }
    public List<MemberAddressDto> Addresses { get; set; } = new();
    public List<FamilyMemberDto> FamilyMembers { get; set; } = new();
    // Active club membership (for edit form prefill — earliest active club_members row)
    public int? ClubId { get; set; }
    public DateTime? JoinedDate { get; set; }
    // Member-level fields stored on club_members (Step 11B 2026-06-18). Same value across all active memberships.
    public string? Designation { get; set; }
    public string? ClassificationProfession { get; set; }
}
