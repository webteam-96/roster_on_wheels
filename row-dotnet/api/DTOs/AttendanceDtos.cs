using System.ComponentModel.DataAnnotations;

namespace RotaryApi.DTOs;

public class AttendanceListDto
{
    public int Id { get; set; }
    public int ClubId { get; set; }
    public int YearId { get; set; }
    public string EventName { get; set; } = "";
    public DateTime EventDateTime { get; set; }
    public int MembersCount { get; set; }
    public int AnnsCount { get; set; }
    public int AnnetsCount { get; set; }
    public int VisitorsCount { get; set; }
    public int RotariansCount { get; set; }
    public int DelegatesCount { get; set; }
}

public class AttendanceDetailDto
{
    public int Id { get; set; }
    public int ClubId { get; set; }
    public int YearId { get; set; }
    public string EventName { get; set; } = "";
    public string Description { get; set; } = "";
    public DateTime EventDateTime { get; set; }
    public List<AttendanceMemberDto> Members { get; set; } = new();
    public List<AttendanceAnnDto> Anns { get; set; } = new();
    public List<AttendanceAnnetDto> Annets { get; set; } = new();
    public List<AttendanceVisitorDto> Visitors { get; set; } = new();
    public List<AttendanceRotarianDto> Rotarians { get; set; } = new();
    public List<AttendanceDelegateDto> Delegates { get; set; } = new();
}

public class AttendanceMemberDto
{
    public int Id { get; set; }
    public int MemberId { get; set; }
    public string MemberName { get; set; } = "";
}

public class AttendanceAnnDto
{
    public int Id { get; set; }
    public string AnnName { get; set; } = "";
}

public class AttendanceAnnetDto
{
    public int Id { get; set; }
    public string AnnetName { get; set; } = "";
}

public class AttendanceVisitorDto
{
    public int Id { get; set; }
    public string VisitorName { get; set; } = "";
    public string? InvitedBy { get; set; }
}

public class AttendanceRotarianDto
{
    public int Id { get; set; }
    public string RotarianName { get; set; } = "";
    public string? ClubName { get; set; }
}

public class AttendanceDelegateDto
{
    public int Id { get; set; }
    public string RotarianName { get; set; } = "";
    public string? DistrictDesignation { get; set; }
    public string? ClubName { get; set; }
}

public class CreateAttendanceDto
{
    [Required, StringLength(500, ErrorMessage = "Event Name must be 500 characters or less.")]
    public string EventName { get; set; } = "";
    [StringLength(10000, ErrorMessage = "Description must be 10000 characters or less.")]
    public string Description { get; set; } = "";
    public DateTime EventDateTime { get; set; }
    public List<int>? MemberIds { get; set; }
    public List<CreateAttendanceAnnDto>? Anns { get; set; }
    public List<CreateAttendanceAnnetDto>? Annets { get; set; }
    public List<CreateAttendanceVisitorDto>? Visitors { get; set; }
    public List<CreateAttendanceRotarianDto>? Rotarians { get; set; }
    public List<CreateAttendanceDelegateDto>? Delegates { get; set; }
}

public class UpdateAttendanceDto
{
    [Required, StringLength(500, ErrorMessage = "Event Name must be 500 characters or less.")]
    public string EventName { get; set; } = "";
    [StringLength(10000, ErrorMessage = "Description must be 10000 characters or less.")]
    public string Description { get; set; } = "";
    public DateTime EventDateTime { get; set; }
    public List<int>? MemberIds { get; set; }
    public List<CreateAttendanceAnnDto>? Anns { get; set; }
    public List<CreateAttendanceAnnetDto>? Annets { get; set; }
    public List<CreateAttendanceVisitorDto>? Visitors { get; set; }
    public List<CreateAttendanceRotarianDto>? Rotarians { get; set; }
    public List<CreateAttendanceDelegateDto>? Delegates { get; set; }
}

public class CreateAttendanceAnnDto { public string AnnName { get; set; } = ""; }
public class CreateAttendanceAnnetDto { public string AnnetName { get; set; } = ""; }
public class CreateAttendanceVisitorDto { public string VisitorName { get; set; } = ""; public string? InvitedBy { get; set; } }
public class CreateAttendanceRotarianDto { public string RotarianName { get; set; } = ""; public string? ClubName { get; set; } }
public class CreateAttendanceDelegateDto { public string RotarianName { get; set; } = ""; public string? DistrictDesignation { get; set; } public string? ClubName { get; set; } }

public class ClubMemberSimpleDto
{
    public int Id { get; set; }
    public string MemberName { get; set; } = "";
}
