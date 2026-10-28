namespace RotaryApi.DTOs;

// Tenant lifecycle and editions (ROW Wave 1, build spec items 1 and 5).

public class EditionDto
{
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public List<string> ModuleKeys { get; set; } = new();
}

public class UpdateEditionDto
{
    public string Name { get; set; } = "";
    public List<string> ModuleKeys { get; set; } = new();
}

public class TenantSubscriptionDto
{
    public int DistrictId { get; set; }
    public string? DistrictNumber { get; set; }
    public string EditionCode { get; set; } = "";
    public string? MemberBand { get; set; }
    public DateTime? TermStart { get; set; }
    public DateTime? TermEnd { get; set; }
    public string State { get; set; } = "live";
    public string? Region { get; set; }
    public DateTime? BridgeStart { get; set; }
    public DateTime? BridgeEnd { get; set; }
    public bool SetupFeeWaived { get; set; }
    public decimal? PlatformFeePct { get; set; }
    public decimal? PlatformFeeFixed { get; set; }
    public DateTime? FeeWaiverUntil { get; set; }
    /// <summary>Build spec 3.14: anonymise terminated members this many months after termination; null or 0 = off.</summary>
    public int? AnonymiseAfterMonths { get; set; }
    /// <summary>Build spec 3.5: renews at term end (default on); the 60-day notice says which.</summary>
    public bool? AutoRenew { get; set; }
    // Read only (renewal reminders): the term end the 60-day notice went out for, overdue reminders sent (0-3).
    public DateTime? RenewalNoticeFor { get; set; }
    public int DunningStage { get; set; }
    // Read only (N7 planning mode and trials): set by POST trial / convert-trial and the planning endpoints, never by PUT.
    public DateTime? TrialEnds { get; set; }
    public string? PlanningYearLabel { get; set; }
    public DateTime? CutoverAt { get; set; }
    public DateTime? CutoverDoneAt { get; set; }
}

public class TenantClubDto
{
    public int ClubId { get; set; }
    public string? ClubName { get; set; }
    public string EditionCode { get; set; } = "";
}

public class TenantDetailDto
{
    public TenantSubscriptionDto? Subscription { get; set; }
    public List<TenantClubDto> Clubs { get; set; } = new();
}
