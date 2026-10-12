namespace RotaryApi.DTOs;

public class CreateMemberDto
{
    public string MemberName { get; set; } = string.Empty;
    public string? ProfilePhotoPath { get; set; }
    public int FkPrimaryCountryId { get; set; } = 1;
    public string? PrimaryMobileNumber { get; set; }
    public string? EmailId { get; set; }
    public DateTime? BirthDate { get; set; }
    public DateTime? AnniversaryDate { get; set; }
    public string? BloodGroup { get; set; }
    public int FkSecondaryCountryId { get; set; } = 1;
    public string? SecondaryMobileNumber { get; set; }
    public bool IsPersonalDetailsVisible { get; set; } = true;
    // Honorary moved to club_members (per-club) 2026-06-26. Kept on CreateMemberDto
    // only — when a member is created with a ClubId, this flag is stamped onto
    // the new club_members row for that single club. NOT on UpdateMemberDto:
    // post-create honorary changes go through the SuperAdmin per-club endpoint.
    public bool IsHonoraryMember { get; set; } = false;
    public string? Gender { get; set; }
    public string PrimaryLanguage { get; set; } = "English";
    public bool IsYouth { get; set; } = false;
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
    public bool IsFamilyDetailsVisible { get; set; } = true;
    public List<MemberAddressDto>? Addresses { get; set; }
    public List<FamilyMemberDto>? FamilyMembers { get; set; }
    public int? ClubId { get; set; }
    public DateTime? JoinedDate { get; set; }
    // Member-level — written to club_members across all active memberships (Step 11B 2026-06-18).
    public string? Designation { get; set; }
    public string? ClassificationProfession { get; set; }
}
