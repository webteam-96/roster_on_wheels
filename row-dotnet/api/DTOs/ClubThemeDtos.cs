namespace RotaryApi.DTOs;

public class ClubThemeDto
{
    public int Id { get; set; }
    public int ClubId { get; set; }
    public int YearId { get; set; }
    public string YearLabel { get; set; } = "";
    public int ThemeId { get; set; }
    public string ThemeName { get; set; } = "";
    public string? ThemeImagePath { get; set; }
}

public class SaveClubThemeDto
{
    public int YearId { get; set; }
    public int ThemeId { get; set; }
}
