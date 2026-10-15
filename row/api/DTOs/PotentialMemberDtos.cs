namespace RotaryApi.DTOs;

public class PotentialMemberDto
{
    public int Id { get; set; }
    public int ClubId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Email { get; set; }
    public string? MobileNumber { get; set; }
    public string? ReferenceDetails { get; set; }
}

public class CreatePotentialMemberDto
{
    public string Name { get; set; } = string.Empty;
    public string? Email { get; set; }
    public string? MobileNumber { get; set; }
    public string? ReferenceDetails { get; set; }
}

public class UpdatePotentialMemberDto
{
    public string Name { get; set; } = string.Empty;
    public string? Email { get; set; }
    public string? MobileNumber { get; set; }
    public string? ReferenceDetails { get; set; }
}
