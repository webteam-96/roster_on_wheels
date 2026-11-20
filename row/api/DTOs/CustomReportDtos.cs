namespace RotaryApi.DTOs;

/// <summary>What a custom report shows (Services/CustomReportQuery.cs turns it into SQL against a whitelist).</summary>
public sealed class CustomReportDefinition
{
    public string Source { get; set; } = "";
    public List<string> Columns { get; set; } = new();
    public List<CustomReportFilter> Filters { get; set; } = new();
    public string? SortBy { get; set; }
    public bool SortDesc { get; set; }
    /// <summary>Set: one row per value of this field with its count, plus the sum of each of SumFields.</summary>
    public string? GroupBy { get; set; }
    public List<string> SumFields { get; set; } = new();
    /// <summary>Projects only: the Rotary year (rotary_year_master id); empty = the current year.</summary>
    public int? YearId { get; set; }
}

public sealed class CustomReportFilter
{
    public string Field { get; set; } = "";
    public string Op { get; set; } = "eq";
    public string? Value { get; set; }
}

public sealed class SaveCustomReportDto
{
    public string Name { get; set; } = "";
    public CustomReportDefinition Definition { get; set; } = new();
    public bool ScheduleMonthly { get; set; }
    /// <summary>Day of the month (1 to 28, UTC) the scheduled email goes out.</summary>
    public int ScheduleDay { get; set; } = 1;
    public string ScheduleFormat { get; set; } = "xlsx";
}

public sealed class CustomReportDto
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public CustomReportDefinition Definition { get; set; } = new();
    public bool ScheduleMonthly { get; set; }
    public int ScheduleDay { get; set; }
    public string ScheduleFormat { get; set; } = "xlsx";
    public DateTime? LastSentAt { get; set; }
    public string? CreatedByName { get; set; }
    public DateTime? ModifiedAt { get; set; }
}

public sealed record CustomReportColumn(string Key, string Label, string Type);

public sealed class CustomReportResult
{
    public List<CustomReportColumn> Columns { get; set; } = new();
    public List<object?[]> Rows { get; set; } = new();
    /// <summary>True when more rows matched than the row cap returns.</summary>
    public bool Truncated { get; set; }
}

public sealed record CustomReportFieldInfo(string Key, string Label, string Type);
public sealed record CustomReportSourceInfo(string Key, string Label, IReadOnlyList<CustomReportFieldInfo> Fields);
