namespace RotaryApi.DTOs;

public class ThemeDto
{
    public int Id { get; set; }
    public string ThemeName { get; set; } = "";
    public string? ThemeImagePath { get; set; }
    public string? Description { get; set; }
}

public class CreateThemeDto
{
    public string ThemeName { get; set; } = "";
    public string? ThemeImagePath { get; set; }
    public string? Description { get; set; }
}

public class UpdateThemeDto
{
    public string ThemeName { get; set; } = "";
    public string? ThemeImagePath { get; set; }
    public string? Description { get; set; }
}
