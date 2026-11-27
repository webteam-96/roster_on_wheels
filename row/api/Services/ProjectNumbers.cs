namespace RotaryApi.Services;

/// <summary>Costs and head counts of a project: never below zero.</summary>
public static class ProjectNumbers
{
    public static string? Validate(params decimal?[] values) =>
        values.Any(v => v < 0) ? "Amounts and counts cannot be negative." : null;
}
