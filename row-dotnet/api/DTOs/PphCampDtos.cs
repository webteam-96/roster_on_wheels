using System.ComponentModel.DataAnnotations;

namespace RotaryApi.DTOs;

// Camp DTOs
public class PphCampListDto
{
    public int Id { get; set; }
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    public string? Address { get; set; }
    public DateTime CampDate { get; set; }
    public string? CampLogoPath { get; set; }
    public bool IsActive { get; set; }
    public int AttendanceCount { get; set; }
}

public class CreatePphCampDto
{
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    public string? Address { get; set; }
    public string CampDate { get; set; } = "";
}

public class UpdatePphCampDto
{
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    public string? Address { get; set; }
    public string CampDate { get; set; } = "";
    public bool IsActive { get; set; }
}

// Attendance DTOs
public class PphAttendanceDto
{
    public int Id { get; set; }
    public int CampId { get; set; }
    public string Name { get; set; } = "";
    public string? MobileNo { get; set; }
    public string? Sex { get; set; }
    public string? Address { get; set; }
    public int? Age { get; set; }
    public int? BPSystolic { get; set; }
    public int? BPDiastolic { get; set; }
    public string? BloodSugarType { get; set; }
    public decimal? BloodSugarValue { get; set; }
    public decimal? HeightCm { get; set; }
    public decimal? WeightKg { get; set; }
    public decimal? BMI { get; set; }
    public string? DiabetesStatus { get; set; }
    public string? BPStatus { get; set; }
    public bool IsOverweight { get; set; }
    public bool IsObese { get; set; }
    public bool IsConsentedForMessages { get; set; }
    public string? Remarks { get; set; }
}

public class CreatePphAttendanceDto
{
    public string Name { get; set; } = "";
    public string? MobileNo { get; set; }
    public string? Sex { get; set; }
    public string? Address { get; set; }
    public int? Age { get; set; }
    public int? BPSystolic { get; set; }
    public int? BPDiastolic { get; set; }
    public string? BloodSugarType { get; set; }
    public decimal? BloodSugarValue { get; set; }
    public decimal? HeightCm { get; set; }
    public decimal? WeightKg { get; set; }
    public decimal? BMI { get; set; }
    public string? DiabetesStatus { get; set; }
    public string? BPStatus { get; set; }
    public bool IsOverweight { get; set; }
    public bool IsObese { get; set; }
    public bool IsConsentedForMessages { get; set; }
    public string? Remarks { get; set; }
}

public class UpdatePphAttendanceDto
{
    public string Name { get; set; } = "";
    public string? MobileNo { get; set; }
    public string? Sex { get; set; }
    public string? Address { get; set; }
    public int? Age { get; set; }
    public int? BPSystolic { get; set; }
    public int? BPDiastolic { get; set; }
    public string? BloodSugarType { get; set; }
    public decimal? BloodSugarValue { get; set; }
    public decimal? HeightCm { get; set; }
    public decimal? WeightKg { get; set; }
    public decimal? BMI { get; set; }
    public string? DiabetesStatus { get; set; }
    public string? BPStatus { get; set; }
    public bool IsOverweight { get; set; }
    public bool IsObese { get; set; }
    public bool IsConsentedForMessages { get; set; }
    public string? Remarks { get; set; }
}

// ════════════════════════════════════════════════════════════════════════
// 3-level model: Camp → Attendee (person, mobile unique per camp) → Medical readings (many)
// ════════════════════════════════════════════════════════════════════════

// One medical reading / visit (child of an attendee)
public class PphMedicalReadingDto
{
    public int Id { get; set; }
    public int AttendeeId { get; set; }
    public int CampId { get; set; }
    public string? RegistrationNo { get; set; }
    public DateTime ReadingDate { get; set; }
    public int? Age { get; set; }
    public int? BPSystolic { get; set; }
    public int? BPDiastolic { get; set; }
    public string? BloodSugarType { get; set; }
    public decimal? BloodSugarValue { get; set; }
    public decimal? HeightCm { get; set; }
    public decimal? WeightKg { get; set; }
    public decimal? BMI { get; set; }
    public string? DiabetesStatus { get; set; }
    public string? BPStatus { get; set; }
    public bool IsOverweight { get; set; }
    public bool IsObese { get; set; }
    public string? Remarks { get; set; }
}

// Attendee (person) — includes latest reading + count for list view
public class PphAttendeeDto
{
    public int Id { get; set; }
    public int CampId { get; set; }
    public string Name { get; set; } = "";
    public string MobileNo { get; set; } = "";
    public string? Sex { get; set; }
    public string? Address { get; set; }
    public bool IsConsentedForMessages { get; set; }
    public int ReadingCount { get; set; }
    public PphMedicalReadingDto? LatestReading { get; set; }
}

// Attendee + full medical history
public class PphAttendeeDetailDto
{
    public PphAttendeeDto Attendee { get; set; } = new();
    public List<PphMedicalReadingDto> History { get; set; } = new();
}

// ════════════════════════════════════════════════════════════════════════
// Attendee history BY MOBILE — cross-club / cross-camp / cross-year lookup.
// An "entry" = one attendee row (one camp participation). The same mobile has
// a separate attendee row per camp, so this NEVER dedupes: every entry is
// listed, grouped club-wise, with a per-club count and a grand total.
// ════════════════════════════════════════════════════════════════════════

// One attendee entry (participation in a single camp) in the mobile history.
public class PphMobileHistoryEntryDto
{
    public int AttendeeId { get; set; }
    public int CampId { get; set; }
    public string CampTitle { get; set; } = "";
    public DateTime CampDate { get; set; }
    public string AttendeeName { get; set; } = "";
    public string MobileNo { get; set; } = "";
    public string? Sex { get; set; }
    public string? Address { get; set; }
    public int ReadingCount { get; set; }
    public DateTime? LatestReadingDate { get; set; }
    public string YearLabel { get; set; } = "";   // Rotary year, e.g. "2025-26" (derived from CampDate)
    public bool IsConsentedForMessages { get; set; }
    // EVERY medical reading taken at this camp participation (newest first) — full values, so any camp
    // that looks the person up by mobile sees their complete past health record, not just a count.
    public List<PphMedicalReadingDto> Readings { get; set; } = new();
}

// All entries for one club (or district-scope) group.
public class PphMobileHistoryGroupDto
{
    public int? ClubId { get; set; }
    public int? DistrictId { get; set; }
    public string GroupName { get; set; } = "";    // club name, or "District <number>" for district camps
    public bool IsDistrict { get; set; }
    public int EntryCount { get; set; }
    public List<PphMobileHistoryEntryDto> Entries { get; set; } = new();
}

// Full history for a mobile: club-wise groups + grand total.
public class PphMobileHistoryDto
{
    public string Mobile { get; set; } = "";       // the last-10 digits used for matching
    public int TotalEntries { get; set; }
    public int GroupCount { get; set; }            // number of distinct clubs/groups
    public List<PphMobileHistoryGroupDto> Groups { get; set; } = new();
}

// One row of the scoped attendee REPORT (Excel export). Each row = one attendee
// entry (one camp participation). Never deduped — scope only widens WHICH clubs'
// rows are included (club / district / all) based on the downloader's context.
public class PphAttendeeReportRowDto
{
    public string? DistrictNumber { get; set; }
    public string ClubName { get; set; } = "";
    public int CampId { get; set; }
    public string CampTitle { get; set; } = "";
    public DateTime CampDate { get; set; }
    public string YearLabel { get; set; } = "";
    public string AttendeeName { get; set; } = "";
    public string MobileNo { get; set; } = "";
    public string? Sex { get; set; }
    public string? Address { get; set; }
    public int ReadingCount { get; set; }
    public DateTime? LatestReadingDate { get; set; }
}

// Add flow: person fields + one medical reading. Always creates a NEW reading;
// reuses the attendee if (camp, mobile) already exists, else creates the attendee.
public class CreatePphReadingDto
{
    [Required(ErrorMessage = "Name is required.")]
    [StringLength(200, ErrorMessage = "Name must be 200 characters or less.")]
    public string Name { get; set; } = "";

    [Required(ErrorMessage = "Mobile number is required.")]
    [StringLength(20, ErrorMessage = "Mobile number must be 20 characters or less.")]
    public string MobileNo { get; set; } = "";

    [Required(ErrorMessage = "Sex is required.")]
    public string Sex { get; set; } = "";

    [Required(ErrorMessage = "Address is required.")]
    public string Address { get; set; } = "";

    [Range(1, 150, ErrorMessage = "Age is required and must be between 1 and 150.")]
    public int Age { get; set; }

    [Range(1, 400, ErrorMessage = "Systolic blood pressure is required.")]
    public int BPSystolic { get; set; }

    [Range(1, 300, ErrorMessage = "Diastolic blood pressure is required.")]
    public int BPDiastolic { get; set; }

    [Required(ErrorMessage = "Blood sugar type is required.")]
    public string BloodSugarType { get; set; } = "";

    [Range(1, 2000, ErrorMessage = "Blood sugar value is required.")]
    public decimal BloodSugarValue { get; set; }

    [Range(1, 300, ErrorMessage = "Height (cm) is required.")]
    public decimal HeightCm { get; set; }

    [Range(1, 500, ErrorMessage = "Weight (kg) is required.")]
    public decimal WeightKg { get; set; }

    public string? DiabetesStatus { get; set; }
    public string? BPStatus { get; set; }
    public bool IsConsentedForMessages { get; set; }
    public string? Remarks { get; set; }
}

// Edit attendee (person fields only)
public class UpdatePphAttendeeDto
{
    [Required(ErrorMessage = "Name is required.")]
    [StringLength(200, ErrorMessage = "Name must be 200 characters or less.")]
    public string Name { get; set; } = "";

    [Required(ErrorMessage = "Mobile number is required.")]
    [StringLength(20, ErrorMessage = "Mobile number must be 20 characters or less.")]
    public string MobileNo { get; set; } = "";

    [Required(ErrorMessage = "Sex is required.")]
    public string Sex { get; set; } = "";

    [Required(ErrorMessage = "Address is required.")]
    public string Address { get; set; } = "";

    public bool IsConsentedForMessages { get; set; }
}

// Edit one medical reading (medical fields only — Age lives here, it can change per visit)
public class UpdatePphReadingDto
{
    [Range(1, 150, ErrorMessage = "Age is required and must be between 1 and 150.")]
    public int Age { get; set; }

    [Range(1, 400, ErrorMessage = "Systolic blood pressure is required.")]
    public int BPSystolic { get; set; }

    [Range(1, 300, ErrorMessage = "Diastolic blood pressure is required.")]
    public int BPDiastolic { get; set; }

    [Required(ErrorMessage = "Blood sugar type is required.")]
    public string BloodSugarType { get; set; } = "";

    [Range(1, 2000, ErrorMessage = "Blood sugar value is required.")]
    public decimal BloodSugarValue { get; set; }

    [Range(1, 300, ErrorMessage = "Height (cm) is required.")]
    public decimal HeightCm { get; set; }

    [Range(1, 500, ErrorMessage = "Weight (kg) is required.")]
    public decimal WeightKg { get; set; }

    public string? DiabetesStatus { get; set; }
    public string? BPStatus { get; set; }
    public string? Remarks { get; set; }
}
