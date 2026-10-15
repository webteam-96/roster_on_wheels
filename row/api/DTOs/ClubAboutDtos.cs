namespace RotaryApi.DTOs;

public class ClubAboutDto
{
    public int Id { get; set; }
    public int ClubId { get; set; }
    public string Content { get; set; } = "";
    public bool IsActive { get; set; }
}

public class CreateClubAboutDto
{
    public string Content { get; set; } = "";
    public bool IsActive { get; set; } = true;
}

public class UpdateClubAboutDto
{
    public string Content { get; set; } = "";
    public bool IsActive { get; set; } = true;
}
