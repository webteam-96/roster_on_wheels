namespace RotaryApi.Services;

/// <summary>
/// Thrown by ProjectService.UpdateAsync when the edited project_date falls in a
/// different rotary year than the table the project currently lives in. The controller
/// catches this and returns a 409 so the frontend can confirm a cross-year move
/// (which relocates the row + photos to the target year's tables via MoveProjectAsync).
/// </summary>
public class CrossYearMoveRequiredException : Exception
{
    public int FromYearId { get; }
    public int ToYearId { get; }
    public string FromYearLabel { get; }
    public string ToYearLabel { get; }

    public CrossYearMoveRequiredException(int fromYearId, int toYearId, string fromYearLabel, string toYearLabel)
        : base("Project date falls in a different rotary year; a cross-year move is required.")
    {
        FromYearId = fromYearId;
        ToYearId = toYearId;
        FromYearLabel = fromYearLabel;
        ToYearLabel = toYearLabel;
    }
}
