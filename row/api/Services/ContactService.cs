using System.Net;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

/// <summary>Who a contact or group belongs to: a club (DistrictId 0) or a district (ClubId 0).</summary>
public record ContactOwner(int ClubId, int DistrictId)
{
    public bool IsClub => ClubId > 0;
}

/// <summary>
/// Non-member contacts (guests, speakers, sponsors, partners, volunteers) and contact groups for a club or a
/// district (N3, 2026-10-23). Groups are their own table, so they work while the flagged Sub Groups module is off.
/// Groups feed mass email (recipient type 4) and event invites.
/// </summary>
public class ContactService
{
    public const int MaxImportRows = 5000;

    private readonly string _connectionString;
    private readonly IClubMassEmailService _massEmail;

    public ContactService(IConfiguration configuration, IClubMassEmailService massEmail)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _massEmail = massEmail;
    }

    private MySqlConnection Open() => new(_connectionString);

    private const string OwnerWhere = "fk_club_id = @ClubId AND fk_district_id = @DistrictId";

    private sealed record Clean(string Name, string? Email, string? Mobile, string Type, string? Organisation, string? Notes);

    private static Clean Validate(string? name, string? email, string? mobile, string? type, string? organisation, string? notes)
        => new(ContactRules.Name(name), ContactRules.Email(email), ContactRules.Phone(mobile), ContactRules.ContactType(type),
               ContactRules.Clean(organisation, 200, "Organisation"), ContactRules.Clean(notes, 1000, "Notes"));

    // ── Contacts ─────────────────────────────────────────────────────────────────────────

    public async Task<PagedResult<ContactDto>> ListAsync(ContactOwner o, string? search, string? type, int? groupId, int page, int pageSize)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 500);
        var where = "c.fk_club_id = @ClubId AND c.fk_district_id = @DistrictId"
            + (string.IsNullOrWhiteSpace(search) ? "" : " AND (c.name LIKE @Like OR c.email LIKE @Like OR c.mobile LIKE @Like OR c.organisation LIKE @Like)")
            + (string.IsNullOrWhiteSpace(type) ? "" : " AND c.contact_type = @Type")
            + (groupId is > 0 ? " AND EXISTS (SELECT 1 FROM contact_group_members x WHERE x.fk_contact_id = c.pk_contact_id AND x.fk_contact_group_id = @GroupId)" : "");
        await using var conn = Open();
        using var multi = await conn.QueryMultipleAsync($@"
            SELECT c.pk_contact_id AS Id, c.name AS Name, c.email AS Email, c.mobile AS Mobile, c.contact_type AS ContactType,
                   c.organisation AS Organisation, c.notes AS Notes, c.source AS Source, c.created_date AS CreatedDate,
                   (SELECT GROUP_CONCAT(gm.fk_contact_group_id) FROM contact_group_members gm WHERE gm.fk_contact_id = c.pk_contact_id) AS GroupIdsCsv
            FROM contacts c WHERE {where}
            ORDER BY c.name, c.pk_contact_id LIMIT @Take OFFSET @Skip;
            SELECT COUNT(*) FROM contacts c WHERE {where};",
            new { o.ClubId, o.DistrictId, Like = $"%{search?.Trim()}%", Type = type?.Trim().ToLowerInvariant(), GroupId = groupId,
                  Take = pageSize, Skip = (page - 1) * pageSize });
        var items = (await multi.ReadAsync<ContactDto>()).ToList();
        return new PagedResult<ContactDto> { Items = items, TotalCount = await multi.ReadSingleAsync<int>(), Page = page, PageSize = pageSize };
    }

    public async Task<int> CreateAsync(ContactOwner o, SaveContactDto dto, int by, string source = "manual")
    {
        var v = Validate(dto.Name, dto.Email, dto.Mobile, dto.ContactType, dto.Organisation, dto.Notes);
        await using var conn = Open();
        await conn.OpenAsync();
        await EnsureEmailFreeAsync(conn, o, v.Email, null);
        await using var tx = await conn.BeginTransactionAsync();
        var id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO contacts (fk_club_id, fk_district_id, name, email, mobile, contact_type, organisation, notes, source, created_by)
            VALUES (@ClubId, @DistrictId, @Name, @Email, @Mobile, @Type, @Organisation, @Notes, @Source, @By);
            SELECT LAST_INSERT_ID();",
            new { o.ClubId, o.DistrictId, v.Name, v.Email, v.Mobile, v.Type, v.Organisation, v.Notes, Source = source, By = by }, tx);
        if (dto.GroupIds != null) await SetGroupsAsync(conn, tx, o, id, dto.GroupIds);
        await tx.CommitAsync();
        return id;
    }

    public async Task<bool> UpdateAsync(ContactOwner o, int id, SaveContactDto dto, int by)
    {
        var v = Validate(dto.Name, dto.Email, dto.Mobile, dto.ContactType, dto.Organisation, dto.Notes);
        await using var conn = Open();
        await conn.OpenAsync();
        await EnsureEmailFreeAsync(conn, o, v.Email, id);
        await using var tx = await conn.BeginTransactionAsync();
        var n = await conn.ExecuteAsync($@"
            UPDATE contacts SET name = @Name, email = @Email, mobile = @Mobile, contact_type = @Type, organisation = @Organisation,
                   notes = @Notes, modified_by = @By, modified_date = NOW()
            WHERE pk_contact_id = @Id AND {OwnerWhere}",
            new { v.Name, v.Email, v.Mobile, v.Type, v.Organisation, v.Notes, By = by, Id = id, o.ClubId, o.DistrictId }, tx);
        if (n == 0) return false;
        if (dto.GroupIds != null) await SetGroupsAsync(conn, tx, o, id, dto.GroupIds);
        await tx.CommitAsync();
        return true;
    }

    public async Task<bool> DeleteAsync(ContactOwner o, int id)
    {
        await using var conn = Open();
        await conn.OpenAsync();
        await using var tx = await conn.BeginTransactionAsync();
        var n = await conn.ExecuteAsync($"DELETE FROM contacts WHERE pk_contact_id = @Id AND {OwnerWhere}", new { Id = id, o.ClubId, o.DistrictId }, tx);
        if (n > 0) await conn.ExecuteAsync("DELETE FROM contact_group_members WHERE fk_contact_id = @Id", new { Id = id }, tx);
        await tx.CommitAsync();
        return n > 0;
    }

    private static async Task EnsureEmailFreeAsync(MySqlConnection conn, ContactOwner o, string? email, int? exceptId)
    {
        if (email == null) return;
        var taken = await conn.ExecuteScalarAsync<int>($@"
            SELECT COUNT(*) FROM contacts WHERE {OwnerWhere} AND email = @Email AND (@Except IS NULL OR pk_contact_id <> @Except)",
            new { o.ClubId, o.DistrictId, Email = email, Except = exceptId });
        if (taken > 0) throw new InvalidOperationException("A contact with this email already exists.");
    }

    /// <summary>Replaces the contact's groups; every group must belong to the same owner.</summary>
    private static async Task SetGroupsAsync(MySqlConnection conn, MySqlTransaction tx, ContactOwner o, int contactId, List<int> groupIds)
    {
        var ids = groupIds.Distinct().ToList();
        if (ids.Count > 0 && await conn.ExecuteScalarAsync<int>(
                $"SELECT COUNT(*) FROM contact_groups WHERE pk_contact_group_id IN @Ids AND {OwnerWhere}",
                new { Ids = ids, o.ClubId, o.DistrictId }, tx) != ids.Count)
            throw new ArgumentException("One or more groups were not found.");
        await conn.ExecuteAsync("DELETE FROM contact_group_members WHERE fk_contact_id = @Id", new { Id = contactId }, tx);
        foreach (var g in ids)
            await conn.ExecuteAsync("INSERT INTO contact_group_members (fk_contact_group_id, fk_contact_id) VALUES (@G, @C)", new { G = g, C = contactId }, tx);
    }

    // ── Groups ───────────────────────────────────────────────────────────────────────────

    public async Task<List<ContactGroupDto>> ListGroupsAsync(ContactOwner o)
    {
        await using var conn = Open();
        return (await conn.QueryAsync<ContactGroupDto>(@"
            SELECT g.pk_contact_group_id AS Id, g.name AS Name, COUNT(gm.fk_contact_id) AS ContactCount
            FROM contact_groups g
            LEFT JOIN contact_group_members gm ON gm.fk_contact_group_id = g.pk_contact_group_id
            WHERE g.fk_club_id = @ClubId AND g.fk_district_id = @DistrictId
            GROUP BY g.pk_contact_group_id, g.name ORDER BY g.name", new { o.ClubId, o.DistrictId })).ToList();
    }

    public async Task<int> CreateGroupAsync(ContactOwner o, string? name, int by)
    {
        var n = ContactRules.Clean(name, 100, "Group name") ?? throw new ArgumentException("Group name is required.");
        await using var conn = Open();
        await EnsureGroupNameFreeAsync(conn, o, n, null);
        return await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO contact_groups (fk_club_id, fk_district_id, name, created_by) VALUES (@ClubId, @DistrictId, @Name, @By);
            SELECT LAST_INSERT_ID();", new { o.ClubId, o.DistrictId, Name = n, By = by });
    }

    public async Task<bool> RenameGroupAsync(ContactOwner o, int id, string? name)
    {
        var n = ContactRules.Clean(name, 100, "Group name") ?? throw new ArgumentException("Group name is required.");
        await using var conn = Open();
        await EnsureGroupNameFreeAsync(conn, o, n, id);
        return await conn.ExecuteAsync($"UPDATE contact_groups SET name = @Name WHERE pk_contact_group_id = @Id AND {OwnerWhere}",
            new { Name = n, Id = id, o.ClubId, o.DistrictId }) > 0;
    }

    public async Task<bool> DeleteGroupAsync(ContactOwner o, int id)
    {
        await using var conn = Open();
        await conn.OpenAsync();
        await using var tx = await conn.BeginTransactionAsync();
        var n = await conn.ExecuteAsync($"DELETE FROM contact_groups WHERE pk_contact_group_id = @Id AND {OwnerWhere}", new { Id = id, o.ClubId, o.DistrictId }, tx);
        if (n > 0) await conn.ExecuteAsync("DELETE FROM contact_group_members WHERE fk_contact_group_id = @Id", new { Id = id }, tx);
        await tx.CommitAsync();
        return n > 0;
    }

    private static async Task EnsureGroupNameFreeAsync(MySqlConnection conn, ContactOwner o, string name, int? exceptId)
    {
        if (await conn.ExecuteScalarAsync<int>($@"
                SELECT COUNT(*) FROM contact_groups WHERE {OwnerWhere} AND name = @Name AND (@Except IS NULL OR pk_contact_group_id <> @Except)",
                new { o.ClubId, o.DistrictId, Name = name, Except = exceptId }) > 0)
            throw new InvalidOperationException("A group with this name already exists.");
    }

    // ── CSV import ───────────────────────────────────────────────────────────────────────

    private sealed record Existing(int Id, string? Email, string Name, string Digits);

    /// <summary>Classifies every row: invalid, duplicate (email first, then name and phone, against existing
    /// contacts and earlier rows of the same file) or new. The commit runs the same classification again.</summary>
    private static async Task<List<(ContactImportPreviewRowDto Row, Clean? Value)>> ClassifyAsync(MySqlConnection conn, ContactOwner o, List<ContactImportRowDto> rows)
    {
        if (rows.Count > MaxImportRows) throw new ArgumentException($"Import at most {MaxImportRows} rows at a time.");
        var existing = (await conn.QueryAsync<(int Id, string? Email, string Name, string? Mobile)>(
            $"SELECT pk_contact_id, email, name, mobile FROM contacts WHERE {OwnerWhere}", new { o.ClubId, o.DistrictId }))
            .Select(e => new Existing(e.Id, e.Email?.ToLowerInvariant(), e.Name.Trim().ToLowerInvariant(), ContactRules.Digits(e.Mobile))).ToList();
        var byEmail = existing.Where(e => e.Email != null).GroupBy(e => e.Email!).ToDictionary(g => g.Key, g => g.First().Id);
        var byNamePhone = existing.GroupBy(e => e.Name + "|" + e.Digits).ToDictionary(g => g.Key, g => g.First().Id);
        var fileEmail = new Dictionary<string, int>();
        var fileNamePhone = new Dictionary<string, int>();

        var result = new List<(ContactImportPreviewRowDto, Clean?)>();
        for (var i = 0; i < rows.Count; i++)
        {
            var r = rows[i];
            var p = new ContactImportPreviewRowDto { Row = i + 1, Name = r.Name?.Trim() ?? "", Email = r.Email?.Trim(), Mobile = r.Mobile?.Trim() };
            Clean v;
            try { v = Validate(r.Name, r.Email, r.Mobile, r.ContactType, r.Organisation, r.Notes); }
            catch (ArgumentException ex) { p.Status = "invalid"; p.Reason = ex.Message; result.Add((p, null)); continue; }

            p.Name = v.Name; p.Email = v.Email; p.Mobile = v.Mobile; p.ContactType = v.Type;
            var namePhone = v.Name.ToLowerInvariant() + "|" + ContactRules.Digits(v.Mobile);
            if (v.Email != null && byEmail.TryGetValue(v.Email, out var id1)) (p.Status, p.Reason, p.MatchId) = ("duplicate", "Same email as an existing contact", id1);
            else if (v.Email != null && fileEmail.TryGetValue(v.Email, out var row1)) (p.Status, p.Reason) = ("duplicate", $"Same email as row {row1}");
            else if (byNamePhone.TryGetValue(namePhone, out var id2)) (p.Status, p.Reason, p.MatchId) = ("duplicate", "Same name and phone as an existing contact", id2);
            else if (fileNamePhone.TryGetValue(namePhone, out var row2)) (p.Status, p.Reason) = ("duplicate", $"Same name and phone as row {row2}");
            if (v.Email != null) fileEmail.TryAdd(v.Email, p.Row);
            fileNamePhone.TryAdd(namePhone, p.Row);
            result.Add((p, v));
        }
        return result;
    }

    public async Task<List<ContactImportPreviewRowDto>> PreviewImportAsync(ContactOwner o, List<ContactImportRowDto> rows)
    {
        await using var conn = Open();
        return (await ClassifyAsync(conn, o, rows)).Select(x => x.Row).ToList();
    }

    public async Task<ContactImportResultDto> ImportAsync(ContactOwner o, ContactImportRequest req, int by)
    {
        await using var conn = Open();
        await conn.OpenAsync();
        if (req.GroupId is > 0 && await conn.ExecuteScalarAsync<int>(
                $"SELECT COUNT(*) FROM contact_groups WHERE pk_contact_group_id = @Id AND {OwnerWhere}", new { Id = req.GroupId, o.ClubId, o.DistrictId }) == 0)
            throw new ArgumentException("Group not found.");
        var rows = await ClassifyAsync(conn, o, req.Rows);
        var result = new ContactImportResultDto();
        await using var tx = await conn.BeginTransactionAsync();
        foreach (var (p, v) in rows)
        {
            int? contactId = null;
            if (v == null) result.Invalid++;
            else if (p.Status == "new")
            {
                contactId = await conn.ExecuteScalarAsync<int>(@"
                    INSERT INTO contacts (fk_club_id, fk_district_id, name, email, mobile, contact_type, organisation, notes, source, created_by)
                    VALUES (@ClubId, @DistrictId, @Name, @Email, @Mobile, @Type, @Organisation, @Notes, 'import', @By);
                    SELECT LAST_INSERT_ID();",
                    new { o.ClubId, o.DistrictId, v.Name, v.Email, v.Mobile, v.Type, v.Organisation, v.Notes, By = by }, tx);
                result.Created++;
            }
            else if (p.MatchId is int match)
            {
                contactId = match;
                if (req.UpdateExisting)
                {
                    // Fill in what the existing contact is missing; never overwrite what the club typed in.
                    await conn.ExecuteAsync(@"
                        UPDATE contacts SET email = COALESCE(NULLIF(email, ''), @Email), mobile = COALESCE(NULLIF(mobile, ''), @Mobile),
                               organisation = COALESCE(NULLIF(organisation, ''), @Organisation), notes = COALESCE(NULLIF(notes, ''), @Notes),
                               modified_by = @By, modified_date = NOW()
                        WHERE pk_contact_id = @Id",
                        new { v.Email, v.Mobile, v.Organisation, v.Notes, By = by, Id = match }, tx);
                    result.Updated++;
                }
                else result.Skipped++;
            }
            else result.Skipped++; // repeated row inside the file

            if (contactId != null && req.GroupId is > 0)
                await conn.ExecuteAsync("INSERT IGNORE INTO contact_group_members (fk_contact_group_id, fk_contact_id) VALUES (@G, @C)",
                    new { G = req.GroupId, C = contactId }, tx);
        }
        await tx.CommitAsync();
        return result;
    }

    // ── Event invite ─────────────────────────────────────────────────────────────────────

    /// <summary>Creates a mass email draft for the owner's upcoming event, addressed to the contact groups.
    /// The admin reviews and sends it from Mass Email (credits and sending stay there). Returns the draft id.</summary>
    public async Task<int> InviteToEventAsync(ContactOwner o, InviteEventRequest req, int by)
    {
        var groups = req.ContactGroupIds.Distinct().ToList();
        if (groups.Count == 0) throw new ArgumentException("Pick at least one contact group.");
        await using var conn = Open();
        var ev = await conn.QueryFirstOrDefaultAsync<(string Title, string? Description, DateTime EventDate, string? Venue, string? Link)>(@"
            SELECT Title, Description, EventDate, EventVenue, RegistrationLink FROM upcoming_events
            WHERE pk_upcoming_event_id = @Id AND isdeleted = 0
              AND ((@ClubId > 0 AND fk_club_id = @ClubId) OR (@ClubId = 0 AND fk_district_id = @DistrictId))",
            new { Id = req.EventId, o.ClubId, o.DistrictId });
        if (ev.Title == null) throw new KeyNotFoundException("Event not found.");
        if (await conn.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM contact_groups WHERE pk_contact_group_id IN @Ids AND {OwnerWhere}",
                new { Ids = groups, o.ClubId, o.DistrictId }) != groups.Count)
            throw new ArgumentException("One or more groups were not found.");

        var ownerName = o.IsClub
            ? await conn.ExecuteScalarAsync<string?>("SELECT ClubName FROM club_master WHERE pk_club_id = @Id", new { Id = o.ClubId })
            : "District " + await conn.ExecuteScalarAsync<string?>("SELECT DistrictNumber FROM district_master WHERE pk_district_id = @Id", new { Id = o.DistrictId });
        string H(string? s) => WebUtility.HtmlEncode(s ?? "");
        var link = Uri.TryCreate(ev.Link, UriKind.Absolute, out var u) && (u.Scheme == "https" || u.Scheme == "http") ? u.ToString() : null;
        var body = $"<p>You are invited to <strong>{H(ev.Title)}</strong>.</p>"
                 + $"<p>Date: {H(ev.EventDate.ToString("dddd d MMMM yyyy, h:mm tt"))}"
                 + (string.IsNullOrWhiteSpace(ev.Venue) ? "" : $"<br>Venue: {H(ev.Venue)}") + "</p>"
                 + (string.IsNullOrWhiteSpace(ev.Description) ? "" : $"<p>{H(ev.Description)}</p>")
                 + (link == null ? "" : $"<p><a href=\"{H(link)}\">Register here</a></p>")
                 + $"<p>{H(ownerName)}</p>";
        return await _massEmail.CreateAsync(o.ClubId, new CreateMassEmailDto
        {
            RecipientType = 4,
            ContactGroupIds = groups,
            FromName = ContactRules.Clean(req.FromName, 200, "From name") ?? ownerName ?? "Rotary",
            Subject = $"Invitation: {ev.Title}",
            EmailBody = body,
            SaveAsDraft = true,
        }, by, o.IsClub ? null : o.DistrictId);
    }
}
