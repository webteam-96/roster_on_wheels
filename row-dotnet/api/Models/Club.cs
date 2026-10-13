namespace RotaryApi.Models;

public class Club
{
    public int Id { get; set; }
    public int FkDistrictId { get; set; }
    public string ClubRotaryId { get; set; } = string.Empty;
    public string ClubName { get; set; } = string.Empty;
    public string Timezone { get; set; } = RotaryApi.Services.Brand.DefaultTimeZone;
    public DateTime? ClubCharterDate { get; set; }
    public string? ClubLogoPath { get; set; }
    public string? ClubWebsite { get; set; }
    public string? MeetingDay { get; set; }
    public TimeSpan? MeetingFromTime { get; set; }
    public TimeSpan? MeetingToTime { get; set; }
    public string? MeetingAddress { get; set; }
    public string Country { get; set; } = "India";
    public string? State { get; set; }
    public string? City { get; set; }
    public string? Pincode { get; set; }
    public DateTime? ActiveFromDate { get; set; }
    public DateTime? ActiveToDate { get; set; }
    public bool IsAutomaticMeetingReminder { get; set; } = true;
    public bool IsFamilyLogin { get; set; } = false;
    public bool IsActive { get; set; } = true;
    public int? CreatedBy { get; set; }
    public DateTime? CreatedDate { get; set; }
    public int? ModifiedBy { get; set; }
    public DateTime? ModifiedDate { get; set; }
    public int IsDeleted { get; set; }
    public int? DeletedBy { get; set; }
    public DateTime? DeletedDate { get; set; }
}
