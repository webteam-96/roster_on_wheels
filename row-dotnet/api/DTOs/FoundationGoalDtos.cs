namespace RotaryApi.DTOs;

// Foundation Collection Goals (one ACTIVE row per club per year)
// Past years are read-only; current/future years can be edited & deleted.

public class FoundationGoalDto
{
    public int? GoalId { get; set; }            // null if no goal saved yet
    public int ClubId { get; set; }
    public int YearId { get; set; }
    public string YearLabel { get; set; } = "";
    public decimal ApfGoal { get; set; }
    public decimal PolioPlusGoal { get; set; }
    public decimal EndowmentFundGoal { get; set; }
    public decimal OtherGoal { get; set; }
    public string Currency { get; set; } = "USD";
    public string? Remarks { get; set; }
    public bool IsEditable { get; set; }        // false for past years
    public bool IsCurrent { get; set; }
    public string? UpdatedDate { get; set; }
    public string? UpdatedBy { get; set; }
}

public class FoundationGoalSaveRequest
{
    public int YearId { get; set; }
    public decimal ApfGoal { get; set; }
    public decimal PolioPlusGoal { get; set; }
    public decimal EndowmentFundGoal { get; set; }
    public decimal OtherGoal { get; set; }
    public string Currency { get; set; } = "USD";
    public string? Remarks { get; set; }
}

public class FoundationGoalYearRow
{
    public int YearId { get; set; }
    public string YearLabel { get; set; } = "";
    public bool IsCurrent { get; set; }
    public bool IsEditable { get; set; }
    public bool HasGoal { get; set; }
    public decimal TotalGoal { get; set; }
}

public class FoundationGoalListResponse
{
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public FoundationGoalDto? CurrentSelection { get; set; }
    public List<FoundationGoalYearRow> Years { get; set; } = new();
    public List<FoundationGoalDto> PastGoals { get; set; } = new();
}
