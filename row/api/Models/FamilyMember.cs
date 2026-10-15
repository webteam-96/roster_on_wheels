namespace RotaryApi.Models;

public class FamilyMember
{
    public int Id { get; set; }
    public int FkMemberMasterProfileId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Relation { get; set; }
    public string? BloodGroup { get; set; }
    public int FkCountryId { get; set; } = 1;
    public string? PhoneNumber { get; set; }
    public string? EmailId { get; set; }
    public DateTime? BirthDate { get; set; }
    public DateTime? AnniversaryDate { get; set; }
    public string? PhotoPath { get; set; }
    public int? CreatedBy { get; set; }
    public DateTime? CreatedDate { get; set; }
    public int? ModifiedBy { get; set; }
    public DateTime? ModifiedDate { get; set; }
    public int IsDeleted { get; set; }
    public int? DeletedBy { get; set; }
    public DateTime? DeletedDate { get; set; }
}
