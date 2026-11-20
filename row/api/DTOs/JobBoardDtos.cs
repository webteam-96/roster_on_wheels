namespace RotaryApi.DTOs;

// Job postings and business-to-business offers (DACdb parity): Services/JobBoardService.cs.

public class SaveJobPostDto
{
    public string? Kind { get; set; }          // job | offer
    public int? ClubId { get; set; }           // the poster's club; null = their first active club
    public string? Title { get; set; }
    public string? Description { get; set; }
    public string? Company { get; set; }
    public string? Location { get; set; }
    public string? Contact { get; set; }
    public DateTime? ExpiresOn { get; set; }   // a date; the post shows up to and including that day (UTC)
}

public class JobPostDto
{
    private DateTime _created;
    public int Id { get; set; }
    public string Kind { get; set; } = "job";
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public string? Company { get; set; }
    public string? Location { get; set; }
    public string Contact { get; set; } = "";
    public DateTime ExpiresOn { get; set; }
    /// <summary>pending | approved | rejected | removed | withdrawn | expired (expired is worked out, never stored)</summary>
    public string Status { get; set; } = "pending";
    public string? ReviewNote { get; set; }
    public int ClubId { get; set; }
    public string? ClubName { get; set; }
    public int MemberId { get; set; }
    public string? PostedBy { get; set; }
    public bool Mine { get; set; }
    public int OpenReports { get; set; }
    public DateTime CreatedAt { get => _created; set => _created = DateTime.SpecifyKind(value, DateTimeKind.Utc); }
    public List<JobPostReportDto>? Reports { get; set; }
}

public class JobPostReportDto
{
    private DateTime _at;
    public int Id { get; set; }
    public int PostId { get; set; }
    public string? ReporterName { get; set; }
    public string? Reason { get; set; }
    public DateTime ReportedAt { get => _at; set => _at = DateTime.SpecifyKind(value, DateTimeKind.Utc); }
}

public class JobPostReportBodyDto
{
    public string? Reason { get; set; }
}

public class JobPostReviewDto
{
    public string? Action { get; set; }        // approve | reject | remove
    public string? Note { get; set; }
}
