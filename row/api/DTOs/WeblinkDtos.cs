namespace RotaryApi.DTOs;

public class WeblinkListDto
{
    public int Id { get; set; }
    public int ClubId { get; set; }
    public int? ParentId { get; set; }
    public int Level { get; set; }
    public string Title { get; set; } = "";
    public string? Writeup { get; set; }
    public string? LogoPath { get; set; }
    public string? BannerPath { get; set; }
    public string LinkType { get; set; } = "None";
    public string? LinkUrl { get; set; }
    public string? PdfPath { get; set; }
    public string? YoutubeUrl { get; set; }
    public string? ButtonText { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; }
    public int ChildCount { get; set; }
}

public class WeblinkTreeDto
{
    public int Id { get; set; }
    public int? ParentId { get; set; }
    public int Level { get; set; }
    public string Title { get; set; } = "";
    public string? Writeup { get; set; }
    public string? LogoPath { get; set; }
    public string? BannerPath { get; set; }
    public string LinkType { get; set; } = "None";
    public string? LinkUrl { get; set; }
    public string? PdfPath { get; set; }
    public string? YoutubeUrl { get; set; }
    public string? ButtonText { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; }
    public List<WeblinkTreeDto> Children { get; set; } = new();
}

public class CreateWeblinkDto
{
    public int? ParentId { get; set; }
    public string Title { get; set; } = "";
    public string? Writeup { get; set; }
    public string LinkType { get; set; } = "None";
    public string? LinkUrl { get; set; }
    public string? YoutubeUrl { get; set; }
    public string? ButtonText { get; set; }
    public int SortOrder { get; set; }
}

public class UpdateWeblinkDto
{
    public string Title { get; set; } = "";
    public string? Writeup { get; set; }
    public string LinkType { get; set; } = "None";
    public string? LinkUrl { get; set; }
    public string? YoutubeUrl { get; set; }
    public string? ButtonText { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; }
}
