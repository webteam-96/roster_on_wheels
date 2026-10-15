namespace RotaryApi.Models;

public class ClubMember
{
    public int Id { get; set; }
    public int FkClubId { get; set; }
    public int FkMemberMasterProfileId { get; set; }
    public DateTime? JoinedDate { get; set; }
    public bool IsActive { get; set; } = true;
    public string? Designation { get; set; }
    public string? ClassificationProfession { get; set; }
    public int? CreatedBy { get; set; }
    public DateTime? CreatedDate { get; set; }
    public int? ModifiedBy { get; set; }
    public DateTime? ModifiedDate { get; set; }
    public int IsDeleted { get; set; }
    public int? DeletedBy { get; set; }
    public DateTime? DeletedDate { get; set; }
}
