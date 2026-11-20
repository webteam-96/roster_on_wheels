namespace RotaryApi.DTOs;

// Youth programs (gap #12): RYLA and RLI participants and the Youth Protection clearance register. Services/YouthService.cs.

public class YouthOfficerDto
{
    public int MemberId { get; set; }
    public string MemberName { get; set; } = "";
    public string? ClubName { get; set; }
}

public class YouthMemberRefDto
{
    public int MemberId { get; set; }
}

public class YouthMemberPickDto
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string? ClubName { get; set; }
}

public class YouthYearDto
{
    public int Id { get; set; }
    public string Label { get; set; } = "";
    public bool IsCurrent { get; set; }
}

public class SaveYouthParticipantDto
{
    public string? Program { get; set; }
    public int YearId { get; set; }
    public string? FullName { get; set; }
    public string? ContactEmail { get; set; }
}

public class YouthParticipantDto
{
    public int Id { get; set; }
    public string Program { get; set; } = "";
    public int YearId { get; set; }
    public string YearLabel { get; set; } = "";
    public int SponsorClubId { get; set; }
    public string SponsorClubName { get; set; } = "";
    public string FullName { get; set; } = "";
    public string? ContactEmail { get; set; }
    public string Status { get; set; } = "";
    public DateTime CreatedDate { get; set; }
}

public class YouthStatusDto
{
    public string? Status { get; set; }
}

public class SaveClearanceDto
{
    public DateTime? TrainingDate { get; set; }
    public DateTime? CheckDate { get; set; }
    public DateTime? ExpiryDate { get; set; }
}

public class ClearanceDto
{
    public int MemberId { get; set; }
    public string MemberName { get; set; } = "";
    public string? ClubName { get; set; }
    public DateTime? TrainingDate { get; set; }
    public DateTime? CheckDate { get; set; }
    public DateTime? ExpiryDate { get; set; }
    public string State { get; set; } = "";        // YouthRules.ClearanceState
}

/// <summary>The app: the signed-in member's own clearances and the scopes where they are a youth officer.</summary>
public class MyYouthDto
{
    public List<ClearanceDto> Clearances { get; set; } = new();
    public List<YouthScopeDto> OfficerOf { get; set; } = new();
}

public class YouthScopeDto
{
    public int DistrictId { get; set; }
    public int ClubId { get; set; }                 // 0 = district youth chair
    public string Name { get; set; } = "";
}
