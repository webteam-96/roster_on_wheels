using System.Security.Cryptography;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

/// <summary>
/// District speaker bureau (gap #13 part 2, 2026-11-19). The district admin adds and approves speakers; a club
/// manager proposes one or shares a club speaker (both wait for approval). Members of the district's clubs find
/// approved speakers by topic, language, online / in person and rating. After a club hosted a speaker (a club_speakers
/// or meeting_duties row that day, or a manual "we hosted" record) its manager rates the talk 1 to 5, once per talk
/// date. Who may call what: SpeakerBureauController.
/// </summary>
public class SpeakerBureauService
{
    private static readonly string[] PhotoTypes = { ".jpg", ".jpeg", ".png", ".webp" };
    private static readonly string[] Statuses = { "pending", "approved", "rejected" };
    private readonly string _cs;
    private readonly string _webRoot;

    public SpeakerBureauService(IConfiguration config, IWebHostEnvironment env)
    {
        _cs = config.GetConnectionString("DefaultConnection")!;
        _webRoot = env.WebRootPath ?? Path.Combine(env.ContentRootPath, "wwwroot");
    }

    private const string EntrySelect = @"
        SELECT e.pk_entry_id AS Id, e.fk_district_id AS DistrictId, e.name AS Name, e.bio AS Bio, e.topics AS Topics,
               e.languages AS Languages, e.email AS Email, e.phone AS Phone, e.city AS City,
               e.available_online AS AvailableOnline, e.available_in_person AS AvailableInPerson, e.photo_path AS PhotoPath,
               e.fk_member_id AS MemberId, m.MemberName, e.status AS Status, e.fk_proposed_club_id AS ProposedByClubId,
               pc.ClubName AS ProposedByClubName
        FROM speaker_bureau_entries e
        LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = e.fk_member_id
        LEFT JOIN club_master pc ON pc.pk_club_id = e.fk_proposed_club_id";

    // ===== Pure parts (unit tested in api.Tests/SpeakerBureauTests.cs) =====

    /// <summary>Sets each entry's talk count, rating count and average (one decimal) from its talks; a talk carries
    /// its rating or null when the club has not rated it.</summary>
    public static void ApplyStats(IEnumerable<BureauEntryDto> entries, IEnumerable<(int EntryId, int? Rating)> talks)
    {
        var byEntry = talks.GroupBy(t => t.EntryId).ToDictionary(g => g.Key, g => g.ToList());
        foreach (var e in entries)
        {
            var list = byEntry.GetValueOrDefault(e.Id) ?? new();
            var scores = list.Where(t => t.Rating != null).Select(t => t.Rating!.Value).ToList();
            e.TalkCount = list.Count;
            e.RatingCount = scores.Count;
            e.AverageRating = scores.Count == 0 ? null : Math.Round(scores.Average(), 1, MidpointRounding.AwayFromZero);
        }
    }

    /// <summary>Find a speaker: topic (part of a topic tag), language (a whole tag), online / in person, minimum
    /// average; best rated first, then most talks, then name.</summary>
    public static List<BureauEntryDto> Search(IEnumerable<BureauEntryDto> entries, BureauSearchDto f)
    {
        var topic = f.Topic?.Trim();
        var language = f.Language?.Trim();
        return entries
            .Where(e => string.IsNullOrEmpty(topic) || Tags(e.Topics).Any(t => t.Contains(topic, StringComparison.OrdinalIgnoreCase)))
            .Where(e => string.IsNullOrEmpty(language) || Tags(e.Languages).Any(t => t.Equals(language, StringComparison.OrdinalIgnoreCase)))
            .Where(e => f.Mode switch { "online" => e.AvailableOnline, "in_person" => e.AvailableInPerson, _ => true })
            .Where(e => f.MinRating is not > 0 || e.AverageRating >= f.MinRating)
            .OrderByDescending(e => e.AverageRating ?? -1).ThenByDescending(e => e.TalkCount).ThenBy(e => e.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    /// <summary>Null when the rating may be saved, else why not.</summary>
    public static string? CheckRating(int rating, DateTime talkDate, DateTime todayUtc, bool talkAlreadyRated)
    {
        if (rating is < 1 or > 5) return "Rate the speaker from 1 to 5.";
        if (talkDate == default) return "Pick the date of the talk.";
        // One day of slack: the club's local date can be ahead of UTC.
        if (talkDate.Date > todayUtc.Date.AddDays(1)) return "You can rate a talk only after it took place.";
        if (talkAlreadyRated) return "Your club has already rated this speaker's talk on that date.";
        return null;
    }

    internal static IEnumerable<string> Tags(string? s) =>
        (s ?? "").Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);

    /// <summary>Trimmed tags, duplicates dropped, joined with ", ".</summary>
    public static string CleanTags(string? s, string what, int maxTags = 15)
    {
        var tags = Tags(s).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (tags.Count > maxTags) throw new InvalidOperationException($"{what}: {maxTags} at most.");
        if (tags.Any(t => t.Length > 50)) throw new InvalidOperationException($"{what}: each one is 50 characters at most.");
        return string.Join(", ", tags);
    }

    // ===== Reads =====

    public async Task<int?> ClubDistrictAsync(int clubId)
    {
        await using var c = new MySqlConnection(_cs);
        return await c.ExecuteScalarAsync<int?>("SELECT fk_district_id FROM club_master WHERE pk_club_id = @clubId", new { clubId });
    }

    /// <summary>The district's entries with their stats; approvedOnly for members, every status for its managers.</summary>
    public async Task<List<BureauEntryDto>> ListAsync(int districtId, BureauSearchDto f, bool approvedOnly)
    {
        var status = approvedOnly ? "approved" : Statuses.Contains(f.Status) ? f.Status : null;
        await using var c = new MySqlConnection(_cs);
        // shortcut: a district holds a few hundred speakers at most, so filtering runs in memory (Search); move it to
        // SQL if a district passes about 2,000.
        var entries = (await c.QueryAsync<BureauEntryDto>(EntrySelect + @"
            WHERE e.fk_district_id = @districtId AND (@status IS NULL OR e.status = @status) LIMIT 2000",
            new { districtId, status })).ToList();
        ApplyStats(entries, await c.QueryAsync<(int, int?)>(@"
            SELECT t.fk_entry_id, r.rating FROM speaker_bureau_talks t
            JOIN speaker_bureau_entries e ON e.pk_entry_id = t.fk_entry_id
            LEFT JOIN speaker_bureau_ratings r ON r.fk_talk_id = t.pk_talk_id
            WHERE e.fk_district_id = @districtId", new { districtId }));
        return Search(entries, f);
    }

    /// <summary>One entry of the district with its ratings; null when it is not the district's (or not approved for a
    /// member). Hidden comments are blanked unless the caller manages the district.</summary>
    public async Task<BureauProfileDto?> GetAsync(int districtId, int id, bool manager)
    {
        await using var c = new MySqlConnection(_cs);
        var entry = await c.QueryFirstOrDefaultAsync<BureauEntryDto>(EntrySelect + @"
            WHERE e.pk_entry_id = @id AND e.fk_district_id = @districtId AND (@manager OR e.status = 'approved')",
            new { id, districtId, manager });
        if (entry == null) return null;
        var ratings = (await c.QueryAsync<BureauRatingDto>(@"
            SELECT r.pk_rating_id AS Id, t.fk_club_id AS ClubId, cl.ClubName, t.talk_date AS TalkDate, r.rating AS Rating,
                   r.comment AS Comment, r.comment_hidden AS CommentHidden, r.created_date AS CreatedDate
            FROM speaker_bureau_ratings r
            JOIN speaker_bureau_talks t ON t.pk_talk_id = r.fk_talk_id
            LEFT JOIN club_master cl ON cl.pk_club_id = t.fk_club_id
            WHERE t.fk_entry_id = @id ORDER BY t.talk_date DESC, r.pk_rating_id DESC LIMIT 500", new { id })).ToList();
        if (!manager)
            foreach (var r in ratings.Where(r => r.CommentHidden)) r.Comment = null;
        ApplyStats(new[] { entry }, await c.QueryAsync<(int, int?)>(@"
            SELECT t.fk_entry_id, r.rating FROM speaker_bureau_talks t
            LEFT JOIN speaker_bureau_ratings r ON r.fk_talk_id = t.pk_talk_id WHERE t.fk_entry_id = @id", new { id }));
        return new BureauProfileDto { Entry = entry, Ratings = ratings };
    }

    // ===== Writes =====

    private async Task<SaveBureauEntryDto> NormalizeAsync(MySqlConnection c, int districtId, SaveBureauEntryDto d)
    {
        d.Name = VolunteerService.Clean(d.Name, 150, "The name") ?? "";
        if (d.Name.Length < 2) throw new InvalidOperationException("The speaker needs a name.");
        d.Bio = VolunteerService.Clean(d.Bio, 1500, "The bio");
        d.Topics = CleanTags(d.Topics, "Topics");
        if (d.Topics.Length == 0) throw new InvalidOperationException("Add at least one topic.");
        d.Languages = CleanTags(d.Languages, "Languages", 10);
        d.City = VolunteerService.Clean(d.City, 150, "The city or area");
        d.Email = d.Email?.Trim() is { Length: > 0 } e ? VolunteerService.CleanEmail(e) : null;
        d.Phone = VolunteerService.Clean(d.Phone, 40, "The phone number");
        if (d.Phone != null && !d.Phone.All(ch => char.IsAsciiDigit(ch) || "+()-. ".Contains(ch)))
            throw new InvalidOperationException("The phone number has digits, spaces and + ( ) - . only.");
        if (!d.AvailableOnline && !d.AvailableInPerson) throw new InvalidOperationException("Say whether the speaker talks online, in person or both.");
        if (d.MemberId is > 0 && await c.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM club_members cm JOIN club_master cl ON cl.pk_club_id = cm.fk_club_id
                WHERE cm.fk_member_master_profile_id = @MemberId AND cl.fk_district_id = @districtId
                  AND cm.IsActive = 1 AND IFNULL(cm.isdeleted, 0) = 0", new { d.MemberId, districtId }) == 0)
            throw new InvalidOperationException("The linked member must be a member of a club in this district.");
        if (d.MemberId is not > 0) d.MemberId = null;
        return d;
    }

    private async Task<int> InsertAsync(MySqlConnection c, int districtId, SaveBureauEntryDto d, string status, int? clubId,
        int? sourceSpeakerId, string? photoPath, int memberId) =>
        await c.ExecuteScalarAsync<int>(@"
            INSERT INTO speaker_bureau_entries (fk_district_id, name, bio, topics, languages, email, phone, city, available_online,
                available_in_person, photo_path, fk_member_id, status, fk_proposed_club_id, fk_source_speaker_id, created_by,
                created_date, reviewed_by, reviewed_date)
            VALUES (@districtId, @Name, @Bio, @Topics, @Languages, @Email, @Phone, @City, @AvailableOnline, @AvailableInPerson,
                @photoPath, @MemberId, @status, @clubId, @sourceSpeakerId, @actorId, UTC_TIMESTAMP(),
                IF(@status = 'approved', @actorId, NULL), IF(@status = 'approved', UTC_TIMESTAMP(), NULL));
            SELECT LAST_INSERT_ID();",
            new { districtId, d.Name, d.Bio, d.Topics, d.Languages, d.Email, d.Phone, d.City, d.AvailableOnline, d.AvailableInPerson,
                  photoPath, d.MemberId, status, clubId, sourceSpeakerId, actorId = memberId });

    /// <summary>The district admin adds a speaker (listed at once) or a club manager proposes one (clubId, pending).</summary>
    public async Task<BureauEntryDto> CreateAsync(int districtId, SaveBureauEntryDto dto, int memberId, int? clubId)
    {
        await using var c = new MySqlConnection(_cs);
        var d = await NormalizeAsync(c, districtId, dto);
        var id = await InsertAsync(c, districtId, d, clubId == null ? "approved" : "pending", clubId, null, null, memberId);
        return (await GetAsync(districtId, id, true))!.Entry;
    }

    public async Task<BureauEntryDto?> UpdateAsync(int districtId, int id, SaveBureauEntryDto dto, int memberId)
    {
        await using var c = new MySqlConnection(_cs);
        var d = await NormalizeAsync(c, districtId, dto);
        if (await c.ExecuteAsync(@"
                UPDATE speaker_bureau_entries SET name = @Name, bio = @Bio, topics = @Topics, languages = @Languages, email = @Email,
                    phone = @Phone, city = @City, available_online = @AvailableOnline, available_in_person = @AvailableInPerson,
                    fk_member_id = @MemberId, modified_by = @actorId, modified_date = UTC_TIMESTAMP()
                WHERE pk_entry_id = @id AND fk_district_id = @districtId",
                new { id, districtId, d.Name, d.Bio, d.Topics, d.Languages, d.Email, d.Phone, d.City, d.AvailableOnline,
                      d.AvailableInPerson, d.MemberId, actorId = memberId }) == 0)
            return null;
        return (await GetAsync(districtId, id, true))!.Entry;
    }

    /// <summary>Approve, reject, or move back to pending.</summary>
    public async Task<BureauEntryDto?> SetStatusAsync(int districtId, int id, string status, int memberId)
    {
        if (!Statuses.Contains(status)) throw new InvalidOperationException("The status is pending, approved or rejected.");
        await using var c = new MySqlConnection(_cs);
        if (await c.ExecuteAsync(@"
                UPDATE speaker_bureau_entries SET status = @status, reviewed_by = @memberId, reviewed_date = UTC_TIMESTAMP()
                WHERE pk_entry_id = @id AND fk_district_id = @districtId", new { id, districtId, status, memberId }) == 0)
            return null;
        return (await GetAsync(districtId, id, true))!.Entry;
    }

    public async Task<bool> DeleteAsync(int districtId, int id)
    {
        await using var c = new MySqlConnection(_cs);
        var path = await c.QueryFirstOrDefaultAsync<(int Id, string? Path)?>(
            "SELECT pk_entry_id, photo_path FROM speaker_bureau_entries WHERE pk_entry_id = @id AND fk_district_id = @districtId", new { id, districtId });
        if (path == null) return false;
        await c.ExecuteAsync("DELETE FROM speaker_bureau_entries WHERE pk_entry_id = @id", new { id });
        DeletePhotoFile(path.Value.Path);
        return true;
    }

    /// <summary>A real JPEG, PNG or WebP (5 MB at most) under wwwroot; replaces the old one.</summary>
    public async Task<BureauEntryDto?> SetPhotoAsync(int districtId, int id, IFormFile file)
    {
        var check = ImageQualityValidator.Validate(file, false, PhotoTypes);
        if (!check.Ok) throw new InvalidOperationException(check.Error);
        if (check.Width == 0) throw new InvalidOperationException("The file is not a readable JPEG, PNG or WebP image.");
        await using var c = new MySqlConnection(_cs);
        var old = await c.QueryFirstOrDefaultAsync<(int Id, string? Path)?>(
            "SELECT pk_entry_id, photo_path FROM speaker_bureau_entries WHERE pk_entry_id = @id AND fk_district_id = @districtId", new { id, districtId });
        if (old == null) return null;
        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        await using (var src = file.OpenReadStream())
            await c.ExecuteAsync("UPDATE speaker_bureau_entries SET photo_path = @path WHERE pk_entry_id = @id",
                new { id, path = await SavePhotoAsync(districtId, id, src, ext) });
        DeletePhotoFile(old.Value.Path);
        return (await GetAsync(districtId, id, true))!.Entry;
    }

    private async Task<string> SavePhotoAsync(int districtId, int id, Stream src, string ext)
    {
        var folder = Path.Combine(_webRoot, "Documents", "SpeakerBureau", $"District{districtId}");
        Directory.CreateDirectory(folder);
        var name = $"bureau-{id}-{RandomNumberGenerator.GetHexString(8, true)}{ext}";
        await using (var stream = File.Create(Path.Combine(folder, name)))
            await src.CopyToAsync(stream);
        return $"/Documents/SpeakerBureau/District{districtId}/{name}";
    }

    private void DeletePhotoFile(string? webPath)
    {
        if (string.IsNullOrEmpty(webPath)) return;
        var root = Path.GetFullPath(Path.Combine(_webRoot, "Documents", "SpeakerBureau")) + Path.DirectorySeparatorChar;
        var path = Path.GetFullPath(Path.Combine(_webRoot, webPath.TrimStart('/')));
        if (path.StartsWith(root, StringComparison.OrdinalIgnoreCase)) File.Delete(path);
    }

    /// <summary>Shares one of the club's speakers to its district's bureau (pending). Their topic becomes the first
    /// tag and their photo is copied, so deleting the club speaker later leaves the bureau entry whole. Null when the
    /// speaker is not the club's.</summary>
    public async Task<BureauEntryDto?> ShareClubSpeakerAsync(int clubId, int districtId, int speakerId, int memberId)
    {
        await using var c = new MySqlConnection(_cs);
        var s = await c.QueryFirstOrDefaultAsync<SpeakerDto>(@"
            SELECT pk_speaker_id AS Id, name AS Name, topic AS Topic, bio AS Bio, photo_path AS PhotoPath, email AS Email, phone AS Phone
            FROM club_speakers WHERE pk_speaker_id = @speakerId AND fk_club_id = @clubId", new { speakerId, clubId });
        if (s == null) return null;
        if (await c.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM speaker_bureau_entries WHERE fk_source_speaker_id = @speakerId AND fk_district_id = @districtId",
                new { speakerId, districtId }) > 0)
            throw new InvalidOperationException("This speaker is already shared to the bureau.");
        var bio = s.Bio is { Length: > 1500 } b ? b[..1500] : s.Bio;
        var d = await NormalizeAsync(c, districtId, new SaveBureauEntryDto
        {
            Name = s.Name, Bio = bio, Topics = s.Topic?.Replace(',', ' ') ?? "General", Email = s.Email, Phone = s.Phone,
            AvailableInPerson = true,
        });
        var id = await InsertAsync(c, districtId, d, "pending", clubId, speakerId, null, memberId);
        var src = s.PhotoPath == null ? null : Path.GetFullPath(Path.Combine(_webRoot, s.PhotoPath.TrimStart('/')));
        var speakersRoot = Path.GetFullPath(Path.Combine(_webRoot, "Documents", "Speakers")) + Path.DirectorySeparatorChar;
        if (src != null && src.StartsWith(speakersRoot, StringComparison.OrdinalIgnoreCase) && File.Exists(src))
        {
            await using var stream = File.OpenRead(src);
            await c.ExecuteAsync("UPDATE speaker_bureau_entries SET photo_path = @path WHERE pk_entry_id = @id",
                new { id, path = await SavePhotoAsync(districtId, id, stream, Path.GetExtension(src).ToLowerInvariant()) });
        }
        return (await GetAsync(districtId, id, true))!.Entry;
    }

    private static async Task<bool> ApprovedInDistrictAsync(MySqlConnection c, int districtId, int id) =>
        await c.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM speaker_bureau_entries WHERE pk_entry_id = @id AND fk_district_id = @districtId AND status = 'approved'",
            new { id, districtId }) > 0;

    /// <summary>Null when a booking for that date may be made, else why not: a date is needed, at most two years
    /// ahead (a past date records a talk the club already hosted).</summary>
    public static string? CheckBookingDate(DateTime talkDate, DateTime todayUtc)
    {
        if (talkDate == default) return "Pick the meeting date.";
        if (talkDate.Date > todayUtc.Date.AddYears(2)) return "Book a speaker at most two years ahead.";
        if (talkDate.Date < todayUtc.Date.AddYears(-1)) return "A past talk can be recorded up to one year back.";
        return null;
    }

    private const string BookingSelect = @"
        SELECT t.pk_talk_id AS Id, t.fk_entry_id AS EntryId, e.name AS Name, e.topics AS Topics, t.talk_date AS TalkDate,
               r.rating AS Rating, r.comment AS Comment
        FROM speaker_bureau_talks t
        JOIN speaker_bureau_entries e ON e.pk_entry_id = t.fk_entry_id
        LEFT JOIN speaker_bureau_ratings r ON r.fk_talk_id = t.pk_talk_id";

    private static List<BureauBookingDto> WithCanRate(IEnumerable<BureauBookingDto> list)
    {
        var today = DateTime.UtcNow;
        var result = list.ToList();
        foreach (var b in result) b.CanRate = b.Rating == null && CheckRating(3, b.TalkDate, today, false) == null;
        return result;
    }

    /// <summary>The club's bookings, newest meeting first.</summary>
    public async Task<List<BureauBookingDto>> ListBookingsAsync(int clubId)
    {
        await using var c = new MySqlConnection(_cs);
        return WithCanRate(await c.QueryAsync<BureauBookingDto>(BookingSelect + @"
            WHERE t.fk_club_id = @clubId ORDER BY t.talk_date DESC, t.pk_talk_id DESC LIMIT 500", new { clubId }));
    }

    /// <summary>The club manager books an approved speaker of the district for a meeting date (or records a talk the
    /// club hosted). The speaker also goes on the club's meeting schedule (club_speakers) unless that date already
    /// lists them, so the bulletin and the club website show the talk. Null when the entry is not an approved speaker
    /// of the club's district.</summary>
    public async Task<BureauBookingDto?> BookAsync(int clubId, int districtId, int id, DateTime talkDate, int memberId)
    {
        if (CheckBookingDate(talkDate, DateTime.UtcNow) is { } error) throw new InvalidOperationException(error);
        var date = talkDate.Date;
        await using var c = new MySqlConnection(_cs);
        if (!await ApprovedInDistrictAsync(c, districtId, id)) return null;
        var e = await c.QueryFirstAsync<(string Name, string Topics, string? Bio, string? Email, string? Phone)>(
            "SELECT name, topics, bio, email, phone FROM speaker_bureau_entries WHERE pk_entry_id = @id", new { id });
        if (await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM speaker_bureau_talks WHERE fk_entry_id = @id AND fk_club_id = @clubId AND talk_date = @date",
                new { id, clubId, date }) > 0)
            throw new InvalidOperationException("Your club has already booked this speaker for that date.");
        await c.OpenAsync();
        await using var tx = await c.BeginTransactionAsync();
        int? clubSpeakerId = null;
        if (await c.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM club_speakers WHERE fk_club_id = @clubId AND meeting_date = @date AND LOWER(TRIM(name)) = LOWER(@name)",
                new { clubId, date, name = e.Name }, tx) == 0)
            clubSpeakerId = await c.ExecuteScalarAsync<int>(@"
                INSERT INTO club_speakers (fk_club_id, meeting_date, name, topic, bio, email, phone, show_on_website, created_by)
                VALUES (@clubId, @date, @Name, @topic, @Bio, @Email, @Phone, 1, @memberId);
                SELECT LAST_INSERT_ID();",
                new { clubId, date, e.Name, topic = Tags(e.Topics).FirstOrDefault(), e.Bio, e.Email, e.Phone, memberId }, tx);
        var talkId = await c.ExecuteScalarAsync<int>(@"
            INSERT INTO speaker_bureau_talks (fk_entry_id, fk_club_id, talk_date, source, fk_club_speaker_id, created_by, created_date)
            VALUES (@id, @clubId, @date, 'booked', @clubSpeakerId, @memberId, UTC_TIMESTAMP());
            SELECT LAST_INSERT_ID();", new { id, clubId, date, clubSpeakerId, memberId }, tx);
        await tx.CommitAsync();
        return WithCanRate(await c.QueryAsync<BureauBookingDto>(BookingSelect + " WHERE t.pk_talk_id = @talkId", new { talkId }))[0];
    }

    /// <summary>Cancels a booking the club has not rated, and takes the speaker off the meeting schedule when the
    /// booking put them there. False when it is not the club's booking.</summary>
    public async Task<bool> CancelBookingAsync(int clubId, int talkId)
    {
        await using var c = new MySqlConnection(_cs);
        var t = await c.QueryFirstOrDefaultAsync<(int Id, int? ClubSpeakerId, int Rated)?>(@"
            SELECT t.pk_talk_id, t.fk_club_speaker_id, COUNT(r.pk_rating_id) FROM speaker_bureau_talks t
            LEFT JOIN speaker_bureau_ratings r ON r.fk_talk_id = t.pk_talk_id
            WHERE t.pk_talk_id = @talkId AND t.fk_club_id = @clubId GROUP BY t.pk_talk_id, t.fk_club_speaker_id", new { talkId, clubId });
        if (t == null) return false;
        if (t.Value.Rated > 0) throw new InvalidOperationException("A rated talk stays on record.");
        await c.OpenAsync();
        await using var tx = await c.BeginTransactionAsync();
        await c.ExecuteAsync("DELETE FROM speaker_bureau_talks WHERE pk_talk_id = @talkId", new { talkId }, tx);
        if (t.Value.ClubSpeakerId is { } sid)
            await c.ExecuteAsync("DELETE FROM club_speakers WHERE pk_speaker_id = @sid AND fk_club_id = @clubId", new { sid, clubId }, tx);
        await tx.CommitAsync();
        return true;
    }

    /// <summary>Rates the club's talk with this speaker on that date. The talk must be recorded (AddTalkAsync) or be
    /// in the club's meetings: a club speaker that day shared from or named like the entry, or a meeting duty that
    /// day for the linked member. Null when the entry is not an approved speaker of the club's district.</summary>
    public async Task<BureauRatingDto?> RateAsync(int clubId, int districtId, int id, SaveBureauRatingDto dto, int memberId)
    {
        var comment = VolunteerService.Clean(dto.Comment, 500, "The comment");
        var date = dto.TalkDate.Date;
        await using var c = new MySqlConnection(_cs);
        if (!await ApprovedInDistrictAsync(c, districtId, id)) return null;
        var talk = await c.QueryFirstOrDefaultAsync<(int TalkId, int Rated)?>(@"
            SELECT t.pk_talk_id, COUNT(r.pk_rating_id) FROM speaker_bureau_talks t
            LEFT JOIN speaker_bureau_ratings r ON r.fk_talk_id = t.pk_talk_id
            WHERE t.fk_entry_id = @id AND t.fk_club_id = @clubId AND t.talk_date = @date GROUP BY t.pk_talk_id", new { id, clubId, date });
        if (CheckRating(dto.Rating, dto.TalkDate, DateTime.UtcNow, talk?.Rated > 0) is { } error) throw new InvalidOperationException(error);
        var talkId = talk?.TalkId;
        if (talkId == null)
        {
            var atMeeting = await c.ExecuteScalarAsync<int>(@"
                SELECT (SELECT COUNT(*) FROM club_speakers s WHERE s.fk_club_id = @clubId AND s.meeting_date = @date
                          AND (s.pk_speaker_id = e.fk_source_speaker_id OR LOWER(TRIM(s.name)) = LOWER(e.name)))
                     + (SELECT COUNT(*) FROM meeting_duties d WHERE d.fk_club_id = @clubId AND d.meeting_date = @date
                          AND e.fk_member_id IS NOT NULL AND d.fk_member_id = e.fk_member_id)
                FROM speaker_bureau_entries e WHERE e.pk_entry_id = @id", new { id, clubId, date });
            if (atMeeting == 0)
                throw new InvalidOperationException("Record that your club hosted this speaker on that date first.");
            await c.ExecuteAsync(@"
                INSERT IGNORE INTO speaker_bureau_talks (fk_entry_id, fk_club_id, talk_date, source, created_by, created_date)
                VALUES (@id, @clubId, @date, 'meeting', @memberId, UTC_TIMESTAMP())", new { id, clubId, date, memberId });
            talkId = await c.ExecuteScalarAsync<int>(
                "SELECT pk_talk_id FROM speaker_bureau_talks WHERE fk_entry_id = @id AND fk_club_id = @clubId AND talk_date = @date",
                new { id, clubId, date });
        }
        int ratingId;
        try
        {
            ratingId = await c.ExecuteScalarAsync<int>(@"
                INSERT INTO speaker_bureau_ratings (fk_talk_id, rating, comment, created_by, created_date)
                VALUES (@talkId, @Rating, @comment, @memberId, UTC_TIMESTAMP());
                SELECT LAST_INSERT_ID();", new { talkId, dto.Rating, comment, memberId });
        }
        catch (MySqlException ex) when (ex.ErrorCode == MySqlErrorCode.DuplicateKeyEntry)
        {
            // Two managers of the same club rating at once: uk_bureau_rating_talk keeps one.
            throw new InvalidOperationException(CheckRating(dto.Rating, dto.TalkDate, DateTime.UtcNow, true)!);
        }
        return await c.QueryFirstAsync<BureauRatingDto>(@"
            SELECT r.pk_rating_id AS Id, t.fk_club_id AS ClubId, cl.ClubName, t.talk_date AS TalkDate, r.rating AS Rating,
                   r.comment AS Comment, r.comment_hidden AS CommentHidden, r.created_date AS CreatedDate
            FROM speaker_bureau_ratings r JOIN speaker_bureau_talks t ON t.pk_talk_id = r.fk_talk_id
            LEFT JOIN club_master cl ON cl.pk_club_id = t.fk_club_id WHERE r.pk_rating_id = @ratingId", new { ratingId });
    }

    /// <summary>The district admin hides (or shows again) a rating's comment; false when the rating is not the district's.</summary>
    public async Task<bool> HideCommentAsync(int districtId, int ratingId, bool hidden, int memberId)
    {
        await using var c = new MySqlConnection(_cs);
        return await c.ExecuteAsync(@"
            UPDATE speaker_bureau_ratings r
            JOIN speaker_bureau_talks t ON t.pk_talk_id = r.fk_talk_id
            JOIN speaker_bureau_entries e ON e.pk_entry_id = t.fk_entry_id
            SET r.comment_hidden = @hidden, r.hidden_by = @memberId
            WHERE r.pk_rating_id = @ratingId AND e.fk_district_id = @districtId", new { ratingId, districtId, hidden, memberId }) > 0;
    }
}
