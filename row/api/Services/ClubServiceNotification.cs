using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// Club Service (module key 'club_service') meeting data for the Email scheduler.
/// Club Service rows are meetings, not service projects — they carry Meeting Type / Attendance /
/// Agenda / Minutes instead of Area of Focus / Cost / Beneficiaries / Man Hours — so the scheduler
/// sends them with their own email body built from these fields only. (Club Service is email-only;
/// the add/edit pages offer no WhatsApp option.)
///
/// Loaded per row (SELECT *) rather than inside the scheduler's UNION across every year table:
/// not every year table has every column (e.g. a junk year table without old_pk), and one missing
/// column in a UNION leg would fail the whole project send for all modules.
/// </summary>
public static class ClubServiceNotification
{
    public const string ModuleKey = "club_service";

    public sealed record MeetingInfo(
        string? Description,
        string MeetingType,
        string Attendance,
        string? AgendaDocument,
        string? MinutesDocument,
        string? PrimaryPhotoPath);

    public static bool IsClubService(string? moduleKey)
        => string.Equals(moduleKey, ModuleKey, StringComparison.OrdinalIgnoreCase);

    public static async Task<MeetingInfo?> LoadAsync(
        MySqlConnection conn, string projectsTable, string photosTable, string yearLabel, int projectId)
    {
        var row = (IDictionary<string, object?>?)await conn.QueryFirstOrDefaultAsync(
            $"SELECT * FROM `{projectsTable}` WHERE pk_project_id = @Id",
            new { Id = projectId });
        if (row == null) return null;

        string? Str(string col) => row.TryGetValue(col, out var v) && v != null && v != DBNull.Value ? v.ToString() : null;
        int? Int(string col) => row.TryGetValue(col, out var v) && v != null && v != DBNull.Value ? Convert.ToInt32(v) : null;
        decimal? Dec(string col) => row.TryGetValue(col, out var v) && v != null && v != DBNull.Value ? Convert.ToDecimal(v) : null;

        // Primary photo — same served-path shape as ProjectService's CONCAT (filename-only in DB).
        string? photoPath = null;
        var image = await conn.ExecuteScalarAsync<string?>(
            $@"SELECT image_path FROM `{photosTable}`
               WHERE fk_project_id = @Id AND image_path IS NOT NULL AND image_path <> ''
               ORDER BY is_primary DESC, sort_order LIMIT 1",
            new { Id = projectId });
        if (!string.IsNullOrWhiteSpace(image))
        {
            if (image.StartsWith("/") || image.StartsWith("http"))
                photoPath = image;
            else
            {
                var clubId = Int("fk_club_id") ?? 0;
                var oldPk = Int("old_pk");
                var album = oldPk != null ? $"Album{oldPk}" : $"{yearLabel.Replace("-", "_")}/Album{projectId}";
                photoPath = $"/Documents/gallery/Group{clubId}/{album}/{image}";
            }
        }

        return new MeetingInfo(
            Str("description"),
            MeetingTypeLabel(Str("meeting_type")),
            AttendanceText(Int("attendance"), Dec("attendance_percentage")),
            Str("agenda_document"),
            Str("minutes_document"),
            photoPath);
    }

    // Stored values are the add/edit form's radio keys (regular / fellowship / bod / assembly / trust).
    public static string MeetingTypeLabel(string? raw) => (raw ?? "").Trim().ToLowerInvariant() switch
    {
        "" => "-",
        "regular" => "Regular",
        "fellowship" => "Fellowship",
        "bod" => "BOD",
        "assembly" => "Assembly",
        "trust" => "Trust",
        _ => raw!.Trim(),
    };

    // "25 (78.13%)" — the two Attendance fields on the add/edit form.
    public static string AttendanceText(int? attendance, decimal? percentage)
    {
        if (attendance == null) return "-";
        return percentage != null ? $"{attendance} ({percentage.Value:0.##}%)" : attendance.Value.ToString();
    }
}
