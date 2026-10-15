namespace RotaryApi.DTOs;

public class ClubContactDetailDto
{
    public int Id { get; set; }
    public int ClubId { get; set; }
    public int YearId { get; set; }
    public string YearLabel { get; set; } = "";
    public string Email { get; set; } = "";
    public string Phone { get; set; } = "";
    public bool IsActive { get; set; }
}

public class CreateClubContactDetailDto
{
    public int YearId { get; set; }
    public string Email { get; set; } = "";
    public string Phone { get; set; } = "";
    public bool IsActive { get; set; } = true;
}

public class UpdateClubContactDetailDto
{
    public string Email { get; set; } = "";
    public string Phone { get; set; } = "";
    public bool IsActive { get; set; } = true;
}
