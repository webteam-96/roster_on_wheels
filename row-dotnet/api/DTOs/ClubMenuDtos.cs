namespace RotaryApi.DTOs;

public class ClubMenuDto
{
    public int Id { get; set; }
    public int ClubId { get; set; }
    public string MenuName { get; set; } = "";
    public string LinkType { get; set; } = "page";
    public string LinkValue { get; set; } = "";
    // Rich-text body, used when LinkType = "html" on a custom menu.
    public string? ContentHtml { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; }
    public int SubMenuCount { get; set; }
    public bool IsDefault { get; set; }
}

public class CreateClubMenuDto
{
    public string MenuName { get; set; } = "";
    public string LinkType { get; set; } = "page";
    public string LinkValue { get; set; } = "";
    public string? ContentHtml { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
}

public class UpdateClubMenuDto
{
    public string MenuName { get; set; } = "";
    public string LinkType { get; set; } = "page";
    public string LinkValue { get; set; } = "";
    public string? ContentHtml { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
}

public class ReorderMenusDto
{
    public int Id1 { get; set; }
    public int Id2 { get; set; }
}

public class ClubSubMenuDto
{
    public int Id { get; set; }
    public int MenuId { get; set; }
    public string SubMenuName { get; set; } = "";
    public string LinkType { get; set; } = "page";
    public string LinkValue { get; set; } = "";
    public int SortOrder { get; set; }
    public bool IsActive { get; set; }
    // True for the 6 avenue sub-menus auto-seeded under Projects. Admin UI hides
    // delete/edit buttons when true; service rejects mutation requests on these rows.
    public bool IsSystemManaged { get; set; }
}

public class CreateClubSubMenuDto
{
    public string SubMenuName { get; set; } = "";
    public string LinkType { get; set; } = "page";
    public string LinkValue { get; set; } = "";
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
}

public class UpdateClubSubMenuDto
{
    public string SubMenuName { get; set; } = "";
    public string LinkType { get; set; } = "page";
    public string LinkValue { get; set; } = "";
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
}

public class ReorderSubMenusDto
{
    public int Id1 { get; set; }
    public int Id2 { get; set; }
}

public class SetMenuActiveDto
{
    public bool IsActive { get; set; }
}
