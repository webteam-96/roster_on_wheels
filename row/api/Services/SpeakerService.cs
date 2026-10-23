using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

/// <summary>
/// Speakers and meeting duties (ROW build spec 3.13). A speaker (name, topic, bio, photo, contact) is scheduled to a
/// meeting date: the club website shows the coming ones without contact details, and the bulletin reads the admin
/// list for a date range. A meeting duty assigns a club member to a duty at a meeting; VolunteerReminderBackgroundService
/// reminds them. Who may call what: SpeakersController.
/// </summary>
public partial class SpeakerService
{
    private static readonly string[] PhotoTypes = { ".jpg", ".jpeg", ".png", ".webp" };
    private readonly string _cs;
    private readonly string _webRoot;

    public SpeakerService(IConfiguration config, IWebHostEnvironment env)
    {
        _cs = config.GetConnectionString("DefaultConnection")!;
        _webRoot = env.WebRootPath ?? Path.Combine(env.ContentRootPath, "wwwroot");
    }

    [GeneratedRegex(@"^[0-9+()\-. ]{5,40}$")]
    private static partial Regex PhoneShape();

    private const string SpeakerSelect = @"
        SELECT pk_speaker_id AS Id, meeting_date AS MeetingDate, name AS Name, topic AS Topic, bio AS Bio, photo_path AS PhotoPath,
               email AS Email, phone AS Phone, show_on_website AS ShowOnWebsite
        FROM club_speakers";

    public async Task<List<SpeakerDto>> ListAsync(int clubId, DateTime? from, DateTime? to)
    {
        await using var c = new MySqlConnection(_cs);
        // shortcut: 500 speakers per request, the bulletin and the page ask for a date range.
        return (await c.QueryAsync<SpeakerDto>(SpeakerSelect + @"
            WHERE fk_club_id = @clubId AND (@from IS NULL OR meeting_date >= @from) AND (@to IS NULL OR meeting_date <= @to)
            ORDER BY meeting_date, pk_speaker_id LIMIT 500", new { clubId, from = from?.Date, to = to?.Date })).ToList();
    }

    private static SaveSpeakerDto Normalize(SaveSpeakerDto d)
    {
        if (d.MeetingDate == default) throw new InvalidOperationException("Pick the meeting date.");
        d.Name = VolunteerService.Clean(d.Name, 150, "The name") ?? "";
        if (d.Name.Length < 2) throw new InvalidOperationException("The speaker needs a name.");
        d.Topic = VolunteerService.Clean(d.Topic, 250, "The topic");
        d.Bio = VolunteerService.Clean(d.Bio, 4000, "The bio");
        d.Email = d.Email?.Trim() is { Length: > 0 } e ? VolunteerService.CleanEmail(e) : null;
        d.Phone = VolunteerService.Clean(d.Phone, 40, "The phone number");
        if (d.Phone != null && !PhoneShape().IsMatch(d.Phone)) throw new InvalidOperationException("The phone number has digits, spaces and + ( ) - . only.");
        return d;
    }

    /// <summary>Adds a speaker (id null) or updates one of the club's; null when the speaker is not the club's.</summary>
    public async Task<SpeakerDto?> SaveAsync(int clubId, int? id, SaveSpeakerDto dto, int memberId)
    {
        var d = Normalize(dto);
        await using var c = new MySqlConnection(_cs);
        var row = new { clubId, id, MeetingDate = d.MeetingDate.Date, d.Name, d.Topic, d.Bio, d.Email, d.Phone, d.ShowOnWebsite, memberId };
        if (id == null)
            id = await c.ExecuteScalarAsync<int>(@"
                INSERT INTO club_speakers (fk_club_id, meeting_date, name, topic, bio, email, phone, show_on_website, created_by)
                VALUES (@clubId, @MeetingDate, @Name, @Topic, @Bio, @Email, @Phone, @ShowOnWebsite, @memberId);
                SELECT LAST_INSERT_ID();", row);
        else if (await c.ExecuteAsync(@"
                UPDATE club_speakers SET meeting_date = @MeetingDate, name = @Name, topic = @Topic, bio = @Bio, email = @Email,
                    phone = @Phone, show_on_website = @ShowOnWebsite, modified_by = @memberId
                WHERE pk_speaker_id = @id AND fk_club_id = @clubId", row) == 0)
            return null;
        return await c.QueryFirstAsync<SpeakerDto>(SpeakerSelect + " WHERE pk_speaker_id = @id", new { id });
    }

    public async Task<bool> DeleteAsync(int clubId, int id)
    {
        await using var c = new MySqlConnection(_cs);
        var photo = await c.QueryFirstOrDefaultAsync<(int Id, string? Path)?>(
            "SELECT pk_speaker_id, photo_path FROM club_speakers WHERE pk_speaker_id = @id AND fk_club_id = @clubId", new { id, clubId });
        if (photo == null) return false;
        await c.ExecuteAsync("DELETE FROM club_speakers WHERE pk_speaker_id = @id", new { id });
        DeletePhotoFile(photo.Value.Path);
        return true;
    }

    /// <summary>Stores the speaker's photo (a real JPEG, PNG or WebP, at most 5 MB) under wwwroot, where the club
    /// website loads it, and removes the one it replaces.</summary>
    // shortcut: a photo can be replaced, not removed on its own; add a remove button if clubs ask.
    public async Task<SpeakerDto?> SetPhotoAsync(int clubId, int id, IFormFile file)
    {
        var check = ImageQualityValidator.Validate(file, false, PhotoTypes);
        if (!check.Ok) throw new InvalidOperationException(check.Error);
        if (check.Width == 0) throw new InvalidOperationException("The file is not a readable JPEG, PNG or WebP image.");
        await using var c = new MySqlConnection(_cs);
        var old = await c.QueryFirstOrDefaultAsync<(int Id, string? Path)?>(
            "SELECT pk_speaker_id, photo_path FROM club_speakers WHERE pk_speaker_id = @id AND fk_club_id = @clubId", new { id, clubId });
        if (old == null) return null;
        var folder = Path.Combine(_webRoot, "Documents", "Speakers", $"Group{clubId}");
        Directory.CreateDirectory(folder);
        var name = $"speaker-{id}-{RandomNumberGenerator.GetHexString(8, true)}{Path.GetExtension(file.FileName).ToLowerInvariant()}";
        await using (var stream = File.Create(Path.Combine(folder, name)))
            await file.CopyToAsync(stream);
        await c.ExecuteAsync("UPDATE club_speakers SET photo_path = @path WHERE pk_speaker_id = @id",
            new { id, path = $"/Documents/Speakers/Group{clubId}/{name}" });
        DeletePhotoFile(old.Value.Path);
        return await c.QueryFirstAsync<SpeakerDto>(SpeakerSelect + " WHERE pk_speaker_id = @id", new { id });
    }

    private void DeletePhotoFile(string? webPath)
    {
        if (string.IsNullOrEmpty(webPath)) return;
        var root = Path.GetFullPath(Path.Combine(_webRoot, "Documents", "Speakers")) + Path.DirectorySeparatorChar;
        var path = Path.GetFullPath(Path.Combine(_webRoot, webPath.TrimStart('/')));
        if (path.StartsWith(root, StringComparison.OrdinalIgnoreCase)) File.Delete(path);
    }

    /// <summary>The club's coming speakers for its website and the app (no contact details); null when the club is
    /// not active.</summary>
    public async Task<List<PublicSpeakerDto>?> ListPublicAsync(int clubId, int limit)
    {
        await using var c = new MySqlConnection(_cs);
        if (await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM club_master WHERE pk_club_id = @clubId AND IsActive = 1 AND IFNULL(isdeleted, 0) = 0", new { clubId }) == 0)
            return null;
        return (await c.QueryAsync<PublicSpeakerDto>(@"
            SELECT meeting_date AS MeetingDate, name AS Name, topic AS Topic, bio AS Bio, photo_path AS PhotoPath
            FROM club_speakers WHERE fk_club_id = @clubId AND show_on_website = 1 AND meeting_date >= CURDATE()
            ORDER BY meeting_date, pk_speaker_id LIMIT @limit", new { clubId, limit = Math.Clamp(limit, 1, 50) })).ToList();
    }

    // ===== Meeting duties =====

    private const string DutySelect = @"
        SELECT d.pk_duty_id AS Id, d.fk_club_id AS ClubId, cl.ClubName, d.meeting_date AS MeetingDate, d.duty AS Duty,
               d.fk_member_id AS MemberId, m.MemberName, d.note AS Note, d.reminder_sent_at AS ReminderSentAt
        FROM meeting_duties d
        JOIN club_master cl ON cl.pk_club_id = d.fk_club_id
        LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = d.fk_member_id";

    public async Task<List<MeetingDutyDto>> ListDutiesAsync(int clubId, DateTime? from, DateTime? to)
    {
        await using var c = new MySqlConnection(_cs);
        return (await c.QueryAsync<MeetingDutyDto>(DutySelect + @"
            WHERE d.fk_club_id = @clubId AND (@from IS NULL OR d.meeting_date >= @from) AND (@to IS NULL OR d.meeting_date <= @to)
            ORDER BY d.meeting_date, d.duty, d.pk_duty_id LIMIT 500", new { clubId, from = from?.Date, to = to?.Date })).ToList();
    }

    public async Task<MeetingDutyDto> AddDutyAsync(int clubId, SaveMeetingDutyDto dto, int memberId)
    {
        if (dto.MeetingDate == default) throw new InvalidOperationException("Pick the meeting date.");
        var duty = VolunteerService.Clean(dto.Duty, 100, "The duty") ?? throw new InvalidOperationException("Name the duty.");
        var note = VolunteerService.Clean(dto.Note, 300, "The note");
        await using var c = new MySqlConnection(_cs);
        if (await c.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM club_members WHERE fk_member_master_profile_id = @MemberId AND fk_club_id = @clubId
                  AND IsActive = 1 AND IFNULL(isdeleted, 0) = 0", new { dto.MemberId, clubId }) == 0)
            throw new InvalidOperationException("Pick a member of this club.");
        var id = await c.ExecuteScalarAsync<int>(@"
            INSERT INTO meeting_duties (fk_club_id, meeting_date, duty, fk_member_id, note, created_by)
            VALUES (@clubId, @date, @duty, @MemberId, @note, @createdBy);
            SELECT LAST_INSERT_ID();", new { clubId, date = dto.MeetingDate.Date, duty, dto.MemberId, note, createdBy = memberId });
        return await c.QueryFirstAsync<MeetingDutyDto>(DutySelect + " WHERE d.pk_duty_id = @id", new { id });
    }

    public async Task<bool> DeleteDutyAsync(int clubId, int id)
    {
        await using var c = new MySqlConnection(_cs);
        return await c.ExecuteAsync("DELETE FROM meeting_duties WHERE pk_duty_id = @id AND fk_club_id = @clubId", new { id, clubId }) > 0;
    }

    /// <summary>The app: the member's own coming duties.</summary>
    public async Task<List<MeetingDutyDto>> MyDutiesAsync(int memberId)
    {
        await using var c = new MySqlConnection(_cs);
        return (await c.QueryAsync<MeetingDutyDto>(DutySelect + @"
            WHERE d.fk_member_id = @memberId AND d.meeting_date >= CURDATE()
            ORDER BY d.meeting_date, d.pk_duty_id LIMIT 100", new { memberId })).ToList();
    }
}
