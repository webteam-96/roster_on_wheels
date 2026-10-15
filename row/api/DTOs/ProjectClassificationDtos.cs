namespace RotaryApi.DTOs;

// One row of the unified project-classification smart search (area of focus / category / sub-category).
// Carries the FULL hierarchy path so the form can punch all three ids on a single selection.
// Module fields are populated by the AI suggest endpoint (which searches across ALL modules) so the
// caller can tell whether a suggestion belongs to the current project type or a different one.
public class ClassificationSearchResultDto
{
    public string Type { get; set; } = "";           // "area" | "category" | "subcategory"
    public int AreaOfFocusId { get; set; }
    public string AreaOfFocusName { get; set; } = "";
    public int? CategoryId { get; set; }
    public string? CategoryName { get; set; }
    public int? SubCategoryId { get; set; }
    public string? SubCategoryName { get; set; }
    // The module (project type) this classification belongs to. Null for the module-scoped smart
    // search (the caller already knows the module); populated by the cross-module AI suggest.
    public int? ModuleId { get; set; }
    public string? ModuleKey { get; set; }
    public string? ModuleName { get; set; }
}

// AI suggestion request: classify a project's title/description into the taxonomy.
public class ClassificationSuggestRequest
{
    public string? Title { get; set; }
    public string? Description { get; set; }
    public int ModuleId { get; set; }
}

// AI suggestion response. Matches are the best entries WITHIN the current module (shown inline for
// the user to Select). BetterModule is a single best-fitting entry from a DIFFERENT module when the
// project reads like it belongs to another project type — surfaced as a passive "better fit" hint.
public class ClassificationSuggestResponseDto
{
    public List<ClassificationSearchResultDto> Matches { get; set; } = new();
    public ClassificationSearchResultDto? BetterModule { get; set; }
}
