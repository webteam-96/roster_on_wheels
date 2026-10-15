namespace RotaryApi.Models;

public class Member
{
    public int Id { get; set; }
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
    public int? CreatedBy { get; set; }
    public DateTime? CreatedDate { get; set; }
    public int? ModifiedBy { get; set; }
    public DateTime? ModifiedDate { get; set; }
    public int IsDeleted { get; set; }
    public int? DeletedBy { get; set; }
    public DateTime? DeletedDate { get; set; }
}
