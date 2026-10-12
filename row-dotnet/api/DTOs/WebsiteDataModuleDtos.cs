namespace RotaryApi.DTOs;

public class WebsiteDataModuleDto
{
    public int Id { get; set; }
    public string ModuleName { get; set; } = "";
    public string ModuleKey { get; set; } = "";
    public string IconClass { get; set; } = "Globe";
    public int SortOrder { get; set; }
}

public class CreateWebsiteDataModuleDto
{
    public string ModuleName { get; set; } = "";
    public string ModuleKey { get; set; } = "";
    public string IconClass { get; set; } = "Globe";
}

public class UpdateWebsiteDataModuleDto
{
    public string ModuleName { get; set; } = "";
    public string ModuleKey { get; set; } = "";
    public string IconClass { get; set; } = "Globe";
}

public class ReorderWebsiteDataModuleDto
{
    public int Id1 { get; set; }
    public int Id2 { get; set; }
}
