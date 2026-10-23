namespace RotaryApi.DTOs;

public class PotentialMemberDto
{
    public int Id { get; set; }
    public int ClubId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Email { get; set; }
    public string? MobileNumber { get; set; }
    public string? ReferenceDetails { get; set; }
    // Prospect pipeline (N3, 2026-10-23)
    public string Stage { get; set; } = "inquiry";
    public int? OwnerMemberId { get; set; }
    public string? OwnerName { get; set; }
    public string? Notes { get; set; }
    public string Source { get; set; } = "manual";
    public int? ConvertedMemberId { get; set; }
    public DateTime? CreatedDate { get; set; }
}

public class CreatePotentialMemberDto
{
    public string Name { get; set; } = string.Empty;
    public string? Email { get; set; }
    public string? MobileNumber { get; set; }
    public string? ReferenceDetails { get; set; }
    // Pipeline fields are optional so older clients (the app) keep working: null keeps the default / current value.
    public string? Stage { get; set; }
    public int? OwnerMemberId { get; set; }
    public string? Notes { get; set; }
}

public class UpdatePotentialMemberDto
{
    public string Name { get; set; } = string.Empty;
    public string? Email { get; set; }
    public string? MobileNumber { get; set; }
    public string? ReferenceDetails { get; set; }
    public string? Stage { get; set; }
    public int? OwnerMemberId { get; set; }
    public string? Notes { get; set; }
}
