namespace RotaryApi.Models;

public class District
{
    public int Id { get; set; }
    public string DistrictNumber { get; set; } = string.Empty;
    public string? DistrictLogoPath { get; set; }
    public bool IsActive { get; set; } = true;
    public int? CreatedBy { get; set; }
    public DateTime? CreatedDate { get; set; }
    public int? ModifiedBy { get; set; }
    public DateTime? ModifiedDate { get; set; }
    public int IsDeleted { get; set; }
    public int? DeletedBy { get; set; }
    public DateTime? DeletedDate { get; set; }
}
