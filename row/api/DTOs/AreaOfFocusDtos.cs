namespace RotaryApi.DTOs;

public class AreaOfFocusDto
{
    public int Id { get; set; }
    public int? ModuleId { get; set; }
    public string? ModuleName { get; set; }
    public string Name { get; set; } = "";
    public string? ImagePath { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; }
}

public class CreateAreaOfFocusDto
{
    public int ModuleId { get; set; }
    public string Name { get; set; } = "";
    public string? ImagePath { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
}

public class UpdateAreaOfFocusDto
{
    public int ModuleId { get; set; }
    public string Name { get; set; } = "";
    public string? ImagePath { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
}
