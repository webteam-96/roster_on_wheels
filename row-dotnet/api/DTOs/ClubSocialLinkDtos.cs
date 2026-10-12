namespace RotaryApi.DTOs;

public class ClubSocialLinkDto
{
    public int Id { get; set; }
    public int ClubId { get; set; }
    public string Platform { get; set; } = "";
    public string LinkUrl { get; set; } = "";
    public int SortOrder { get; set; }
    public bool IsActive { get; set; }
}

public class CreateClubSocialLinkDto
{
    public string Platform { get; set; } = "";
    public string LinkUrl { get; set; } = "";
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
}

public class UpdateClubSocialLinkDto
{
    public string Platform { get; set; } = "";
    public string LinkUrl { get; set; } = "";
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
}
