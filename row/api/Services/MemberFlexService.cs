using System.Globalization;
using System.Text;
using System.Text.Json;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

/// <summary>
/// Member flexibility for a club (gap agent, 2026-11-19): tags on members and contacts, custom profile fields with a
/// visibility (admins only or members), and smart lists (saved filters) that drive previews, CSV exports and mass
/// email drafts. Every query is scoped to the club; the controller checks who may call it.
/// </summary>
public class MemberFlexService
{
    private readonly string _connectionString;
    private readonly IClubMassEmailService _massEmail;

    public MemberFlexService(IConfiguration configuration, IClubMassEmailService massEmail)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _massEmail = massEmail;
    }

    private MySqlConnection Open() => new(_connectionString);

    private const string ActiveMembers = @"
        FROM club_members cm
        JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
        WHERE cm.fk_club_id = @ClubId AND cm.IsActive = 1 AND IFNULL(cm.isdeleted, 0) = 0 AND IFNULL(m.isdeleted, 0) = 0";

    public async Task<bool> IsActiveMemberAsync(int clubId, int memberId)
    {
        await using var conn = Open();
        return await conn.ExecuteScalarAsync<int>($"SELECT COUNT(*) {ActiveMembers} AND m.pk_member_master_profile_id = @M",
            new { ClubId = clubId, M = memberId }) > 0;
    }

    // ── Tags ────────────────────────────────────────────────────────────────────────────

    public async Task<List<ClubTagDto>> ListTagsAsync(int clubId)
    {
        await using var conn = Open();
        return (await conn.QueryAsync<ClubTagDto>(@"
            SELECT t.pk_club_tag_id AS Id, t.name AS Name, t.color AS Color,
                   (SELECT COUNT(*) FROM club_tag_assignments a WHERE a.fk_club_tag_id = t.pk_club_tag_id AND a.entity_type = 'member') AS MemberCount,
                   (SELECT COUNT(*) FROM club_tag_assignments a WHERE a.fk_club_tag_id = t.pk_club_tag_id AND a.entity_type = 'contact') AS ContactCount
            FROM club_tags t WHERE t.fk_club_id = @ClubId ORDER BY t.name", new { ClubId = clubId })).ToList();
    }

    public async Task<int> CreateTagAsync(int clubId, SaveClubTagDto dto, int by)
    {
        var name = MemberFlexRules.Name(dto.Name, 50, "Tag name");
        var color = MemberFlexRules.Color(dto.Color);
        await using var conn = Open();
        await EnsureFreeAsync(conn, "club_tags", "name", "pk_club_tag_id", clubId, name, null, "A tag with this name already exists.");
        return await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO club_tags (fk_club_id, name, color, created_by) VALUES (@ClubId, @Name, @Color, @By); SELECT LAST_INSERT_ID();",
            new { ClubId = clubId, Name = name, Color = color, By = by });
    }

    public async Task<bool> UpdateTagAsync(int clubId, int id, SaveClubTagDto dto)
    {
        var name = MemberFlexRules.Name(dto.Name, 50, "Tag name");
        var color = MemberFlexRules.Color(dto.Color);
        await using var conn = Open();
        await EnsureFreeAsync(conn, "club_tags", "name", "pk_club_tag_id", clubId, name, id, "A tag with this name already exists.");
        return await conn.ExecuteAsync("UPDATE club_tags SET name = @Name, color = @Color WHERE pk_club_tag_id = @Id AND fk_club_id = @ClubId",
            new { Name = name, Color = color, Id = id, ClubId = clubId }) > 0;
    }

    public async Task<bool> DeleteTagAsync(int clubId, int id)
    {
        await using var conn = Open();
        await conn.OpenAsync();
        await using var tx = await conn.BeginTransactionAsync();
        var n = await conn.ExecuteAsync("DELETE FROM club_tags WHERE pk_club_tag_id = @Id AND fk_club_id = @ClubId", new { Id = id, ClubId = clubId }, tx);
        if (n > 0) await conn.ExecuteAsync("DELETE FROM club_tag_assignments WHERE fk_club_tag_id = @Id", new { Id = id }, tx);
        await tx.CommitAsync();
        return n > 0;
    }

    /// <summary>Replaces the tags of a club member ("member") or a club contact ("contact"). Returns false when the
    /// member or contact is not the club's.</summary>
    public async Task<bool> SetTagsAsync(int clubId, string entityType, int entityId, List<int> tagIds, int by)
    {
        var ids = tagIds.Distinct().ToList();
        await using var conn = Open();
        await conn.OpenAsync();
        var owned = entityType == "member"
            ? await conn.ExecuteScalarAsync<int>($"SELECT COUNT(*) {ActiveMembers} AND m.pk_member_master_profile_id = @Id", new { ClubId = clubId, Id = entityId })
            : await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM contacts WHERE pk_contact_id = @Id AND fk_club_id = @ClubId AND fk_district_id = 0",
                new { ClubId = clubId, Id = entityId });
        if (owned == 0) return false;
        if (ids.Count > 0 && await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM club_tags WHERE fk_club_id = @ClubId AND pk_club_tag_id IN @Ids",
                new { ClubId = clubId, Ids = ids }) != ids.Count)
            throw new ArgumentException("One or more tags were not found.");
        await using var tx = await conn.BeginTransactionAsync();
        // Only this club's tags are replaced: the same member may carry tags of another club.
        await conn.ExecuteAsync(@"
            DELETE a FROM club_tag_assignments a JOIN club_tags t ON t.pk_club_tag_id = a.fk_club_tag_id
            WHERE t.fk_club_id = @ClubId AND a.entity_type = @Type AND a.entity_id = @Id",
            new { ClubId = clubId, Type = entityType, Id = entityId }, tx);
        foreach (var t in ids)
            await conn.ExecuteAsync("INSERT INTO club_tag_assignments (fk_club_tag_id, entity_type, entity_id, created_by) VALUES (@T, @Type, @Id, @By)",
                new { T = t, Type = entityType, Id = entityId, By = by }, tx);
        await tx.CommitAsync();
        return true;
    }

    // ── Profile fields ──────────────────────────────────────────────────────────────────

    private sealed record FieldRow(int Id, string Label, string FieldType, string? OptionsJson, string Visibility, int SortOrder);

    private static ProfileFieldDto ToDto(FieldRow r) => new()
    {
        Id = r.Id, Label = r.Label, FieldType = r.FieldType, Visibility = r.Visibility, SortOrder = r.SortOrder,
        Options = string.IsNullOrEmpty(r.OptionsJson) ? new() : JsonSerializer.Deserialize<List<string>>(r.OptionsJson) ?? new(),
    };

    private static async Task<List<ProfileFieldDto>> FieldsAsync(MySqlConnection conn, int clubId, bool membersOnly)
        => (await conn.QueryAsync<FieldRow>(@"
            SELECT pk_profile_field_id AS Id, label AS Label, field_type AS FieldType, options_json AS OptionsJson,
                   visibility AS Visibility, sort_order AS SortOrder
            FROM club_profile_fields WHERE fk_club_id = @ClubId AND (@MembersOnly = 0 OR visibility = 'members')
            ORDER BY sort_order, label", new { ClubId = clubId, MembersOnly = membersOnly })).Select(ToDto).ToList();

    public async Task<List<ProfileFieldDto>> ListFieldsAsync(int clubId, bool membersOnly)
    {
        await using var conn = Open();
        return await FieldsAsync(conn, clubId, membersOnly);
    }

    public async Task<int> CreateFieldAsync(int clubId, SaveProfileFieldDto dto, int by)
    {
        var (label, type, options, visibility) = ValidateField(dto);
        await using var conn = Open();
        await EnsureFreeAsync(conn, "club_profile_fields", "label", "pk_profile_field_id", clubId, label, null, "A field with this name already exists.");
        return await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO club_profile_fields (fk_club_id, label, field_type, options_json, visibility, sort_order, created_by)
            VALUES (@ClubId, @Label, @Type, @Options, @Visibility, @Sort, @By); SELECT LAST_INSERT_ID();",
            new { ClubId = clubId, Label = label, Type = type, Options = options, Visibility = visibility, Sort = dto.SortOrder, By = by });
    }

    /// <summary>The type of a field is fixed once created (stored values were checked against it).</summary>
    public async Task<bool> UpdateFieldAsync(int clubId, int id, SaveProfileFieldDto dto)
    {
        await using var conn = Open();
        var type = await conn.ExecuteScalarAsync<string?>("SELECT field_type FROM club_profile_fields WHERE pk_profile_field_id = @Id AND fk_club_id = @ClubId",
            new { Id = id, ClubId = clubId });
        if (type == null) return false;
        if (!string.IsNullOrWhiteSpace(dto.FieldType) && MemberFlexRules.FieldType(dto.FieldType) != type)
            throw new ArgumentException("The type of a field cannot be changed. Create a new field instead.");
        dto.FieldType = type;
        var (label, _, options, visibility) = ValidateField(dto);
        await EnsureFreeAsync(conn, "club_profile_fields", "label", "pk_profile_field_id", clubId, label, id, "A field with this name already exists.");
        if (type == "choice")
        {
            // A removed option must not leave values that are no longer valid.
            var kept = JsonSerializer.Deserialize<List<string>>(options!)!;
            var inUse = (await conn.QueryAsync<string>("SELECT DISTINCT value FROM club_profile_values WHERE fk_profile_field_id = @Id", new { Id = id })).ToList();
            var orphan = inUse.FirstOrDefault(v => !kept.Contains(v, StringComparer.OrdinalIgnoreCase));
            if (orphan != null) throw new ArgumentException($"Option '{orphan}' is still in use by members. Clear it from their profiles first.");
        }
        return await conn.ExecuteAsync(@"
            UPDATE club_profile_fields SET label = @Label, options_json = @Options, visibility = @Visibility, sort_order = @Sort
            WHERE pk_profile_field_id = @Id AND fk_club_id = @ClubId",
            new { Label = label, Options = options, Visibility = visibility, Sort = dto.SortOrder, Id = id, ClubId = clubId }) > 0;
    }

    public async Task<bool> DeleteFieldAsync(int clubId, int id)
    {
        await using var conn = Open();
        await conn.OpenAsync();
        await using var tx = await conn.BeginTransactionAsync();
        var n = await conn.ExecuteAsync("DELETE FROM club_profile_fields WHERE pk_profile_field_id = @Id AND fk_club_id = @ClubId", new { Id = id, ClubId = clubId }, tx);
        if (n > 0) await conn.ExecuteAsync("DELETE FROM club_profile_values WHERE fk_profile_field_id = @Id", new { Id = id }, tx);
        await tx.CommitAsync();
        return n > 0;
    }

    private static (string Label, string Type, string? OptionsJson, string Visibility) ValidateField(SaveProfileFieldDto dto)
    {
        var type = MemberFlexRules.FieldType(dto.FieldType);
        var options = MemberFlexRules.Options(type, dto.Options);
        return (MemberFlexRules.Name(dto.Label, 100, "Field name"), type, type == "choice" ? JsonSerializer.Serialize(options) : null,
            MemberFlexRules.Visibility(dto.Visibility));
    }

    private static MemberFlexRules.FieldDef Def(ProfileFieldDto f) => new(f.Id, f.FieldType, f.Options);

    /// <summary>A member's values for the club's fields (members-visible fields only unless the caller manages the club).</summary>
    public async Task<List<ProfileFieldValueDto>> GetValuesAsync(int clubId, int memberId, bool membersOnly)
    {
        await using var conn = Open();
        var fields = await FieldsAsync(conn, clubId, membersOnly);
        var values = (await conn.QueryAsync<(int FieldId, string Value)>(@"
            SELECT v.fk_profile_field_id, v.value FROM club_profile_values v
            JOIN club_profile_fields f ON f.pk_profile_field_id = v.fk_profile_field_id
            WHERE f.fk_club_id = @ClubId AND v.fk_member_id = @M", new { ClubId = clubId, M = memberId }))
            .ToDictionary(x => x.FieldId, x => x.Value);
        return fields.Select(f => new ProfileFieldValueDto
        {
            Id = f.Id, Label = f.Label, FieldType = f.FieldType, Options = f.Options, Visibility = f.Visibility, SortOrder = f.SortOrder,
            Value = values.GetValueOrDefault(f.Id),
        }).ToList();
    }

    public async Task SaveValuesAsync(int clubId, int memberId, List<ProfileValueInput> input, int by)
    {
        await using var conn = Open();
        await conn.OpenAsync();
        var fields = (await FieldsAsync(conn, clubId, false)).ToDictionary(f => f.Id);
        var clean = new List<(int FieldId, string? Value)>();
        foreach (var v in input.GroupBy(v => v.FieldId).Select(g => g.Last()))
        {
            if (!fields.TryGetValue(v.FieldId, out var f)) throw new ArgumentException("One or more fields were not found.");
            try { clean.Add((f.Id, MemberFlexRules.NormalizeValue(Def(f), v.Value))); }
            catch (ArgumentException ex) { throw new ArgumentException($"{f.Label}: {ex.Message}"); }
        }
        await using var tx = await conn.BeginTransactionAsync();
        foreach (var (fieldId, value) in clean)
        {
            if (value == null)
                await conn.ExecuteAsync("DELETE FROM club_profile_values WHERE fk_profile_field_id = @F AND fk_member_id = @M", new { F = fieldId, M = memberId }, tx);
            else
                await conn.ExecuteAsync(@"
                    INSERT INTO club_profile_values (fk_profile_field_id, fk_member_id, value, modified_by, modified_date)
                    VALUES (@F, @M, @V, @By, UTC_TIMESTAMP())
                    ON DUPLICATE KEY UPDATE value = @V, modified_by = @By, modified_date = UTC_TIMESTAMP()",
                    new { F = fieldId, M = memberId, V = value, By = by }, tx);
        }
        await tx.CommitAsync();
    }

    // ── Smart lists ─────────────────────────────────────────────────────────────────────

    public async Task<List<ClubSubGroupOptionDto>> ListCommitteesAsync(int clubId)
    {
        await using var conn = Open();
        return (await conn.QueryAsync<ClubSubGroupOptionDto>(@"
            SELECT pk_sub_group_id AS Id, GroupName AS Name FROM sub_groups
            WHERE fk_club_id = @ClubId AND IFNULL(isdeleted, 0) = 0 ORDER BY GroupName", new { ClubId = clubId })).ToList();
    }

    private async Task<(string Sql, DynamicParameters Args)> CompileAsync(MySqlConnection conn, int clubId, SmartListFilter filter)
    {
        var fields = (await FieldsAsync(conn, clubId, false)).ToDictionary(f => f.Id, Def);
        var tags = (await conn.QueryAsync<int>("SELECT pk_club_tag_id FROM club_tags WHERE fk_club_id = @ClubId", new { ClubId = clubId })).ToHashSet();
        var groups = (await ListCommitteesAsync(clubId)).Select(g => g.Id).ToHashSet();
        var (sql, args) = MemberFlexRules.Compile(filter, fields, tags, groups);
        var p = new DynamicParameters(args);
        p.Add("ClubId", clubId);
        return (sql, p);
    }

    private const string MemberColumns = @"
        SELECT DISTINCT m.pk_member_master_profile_id AS MemberId, m.MemberName AS Name, m.EmailId AS Email, m.PrimaryMobileNumber AS Mobile,
               cm.JoinedDate AS JoinedDate, (IFNULL(cm.IsHonoraryMember, 0) = 1) AS IsHonorary,
               (SELECT GROUP_CONCAT(a.fk_club_tag_id) FROM club_tag_assignments a JOIN club_tags t ON t.pk_club_tag_id = a.fk_club_tag_id
                WHERE t.fk_club_id = @ClubId AND a.entity_type = 'member' AND a.entity_id = m.pk_member_master_profile_id) AS TagIdsCsv";

    public async Task<PagedResult<SmartListMemberDto>> PreviewAsync(int clubId, SmartListFilter filter, int page, int pageSize)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 500);
        await using var conn = Open();
        var (where, p) = await CompileAsync(conn, clubId, filter);
        p.Add("Take", pageSize);
        p.Add("Skip", (page - 1) * pageSize);
        using var multi = await conn.QueryMultipleAsync($@"
            {MemberColumns} {ActiveMembers} {where} ORDER BY Name, MemberId LIMIT @Take OFFSET @Skip;
            SELECT COUNT(DISTINCT m.pk_member_master_profile_id) {ActiveMembers} {where};", p);
        var items = (await multi.ReadAsync<SmartListMemberDto>()).ToList();
        return new PagedResult<SmartListMemberDto> { Items = items, TotalCount = await multi.ReadSingleAsync<int>(), Page = page, PageSize = pageSize };
    }

    private async Task<List<SmartListMemberDto>> AllMembersAsync(MySqlConnection conn, int clubId, SmartListFilter filter)
    {
        var (where, p) = await CompileAsync(conn, clubId, filter);
        return (await conn.QueryAsync<SmartListMemberDto>($"{MemberColumns} {ActiveMembers} {where} ORDER BY Name, MemberId", p)).ToList();
    }

    private sealed record ListRow(int Id, string Name, string FilterJson, DateTime CreatedDate, DateTime? ModifiedDate);

    private static SmartListDto ToDto(ListRow r) => new()
    {
        Id = r.Id, Name = r.Name, CreatedDate = r.CreatedDate, ModifiedDate = r.ModifiedDate,
        Filter = JsonSerializer.Deserialize<SmartListFilter>(r.FilterJson, Json) ?? new(),
    };

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<List<SmartListDto>> ListSmartListsAsync(int clubId)
    {
        await using var conn = Open();
        return (await conn.QueryAsync<ListRow>(@"
            SELECT pk_smart_list_id AS Id, name AS Name, filter_json AS FilterJson, created_date AS CreatedDate, modified_date AS ModifiedDate
            FROM club_smart_lists WHERE fk_club_id = @ClubId ORDER BY name", new { ClubId = clubId })).Select(ToDto).ToList();
    }

    public async Task<SmartListDto?> GetSmartListAsync(int clubId, int id)
    {
        await using var conn = Open();
        var row = await conn.QueryFirstOrDefaultAsync<ListRow>(@"
            SELECT pk_smart_list_id AS Id, name AS Name, filter_json AS FilterJson, created_date AS CreatedDate, modified_date AS ModifiedDate
            FROM club_smart_lists WHERE fk_club_id = @ClubId AND pk_smart_list_id = @Id", new { ClubId = clubId, Id = id });
        return row == null ? null : ToDto(row);
    }

    public async Task<int> CreateSmartListAsync(int clubId, SaveSmartListDto dto, int by)
    {
        var name = MemberFlexRules.Name(dto.Name, 100, "List name");
        await using var conn = Open();
        await CompileAsync(conn, clubId, dto.Filter); // rejects a filter that does not fit the club
        await EnsureFreeAsync(conn, "club_smart_lists", "name", "pk_smart_list_id", clubId, name, null, "A list with this name already exists.");
        return await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO club_smart_lists (fk_club_id, name, filter_json, created_by, created_date) VALUES (@ClubId, @Name, @Filter, @By, UTC_TIMESTAMP());
            SELECT LAST_INSERT_ID();", new { ClubId = clubId, Name = name, Filter = JsonSerializer.Serialize(dto.Filter, Json), By = by });
    }

    public async Task<bool> UpdateSmartListAsync(int clubId, int id, SaveSmartListDto dto)
    {
        var name = MemberFlexRules.Name(dto.Name, 100, "List name");
        await using var conn = Open();
        await CompileAsync(conn, clubId, dto.Filter);
        await EnsureFreeAsync(conn, "club_smart_lists", "name", "pk_smart_list_id", clubId, name, id, "A list with this name already exists.");
        return await conn.ExecuteAsync(@"
            UPDATE club_smart_lists SET name = @Name, filter_json = @Filter, modified_date = UTC_TIMESTAMP()
            WHERE pk_smart_list_id = @Id AND fk_club_id = @ClubId",
            new { Name = name, Filter = JsonSerializer.Serialize(dto.Filter, Json), Id = id, ClubId = clubId }) > 0;
    }

    public async Task<bool> DeleteSmartListAsync(int clubId, int id)
    {
        await using var conn = Open();
        return await conn.ExecuteAsync("DELETE FROM club_smart_lists WHERE pk_smart_list_id = @Id AND fk_club_id = @ClubId", new { Id = id, ClubId = clubId }) > 0;
    }

    /// <summary>CSV of the list's members: contact details, member type, tags and every profile field. Null when the
    /// list is not the club's.</summary>
    public async Task<(string Name, string Csv)?> ExportCsvAsync(int clubId, int id)
    {
        var list = await GetSmartListAsync(clubId, id);
        if (list == null) return null;
        await using var conn = Open();
        var members = await AllMembersAsync(conn, clubId, list.Filter);
        var fields = await FieldsAsync(conn, clubId, false);
        var tags = (await ListTagsAsync(clubId)).ToDictionary(t => t.Id, t => t.Name);
        var ids = members.Select(m => m.MemberId).ToList();
        var values = ids.Count == 0 ? new Dictionary<(int, int), string>() : (await conn.QueryAsync<(int FieldId, int MemberId, string Value)>(@"
            SELECT v.fk_profile_field_id, v.fk_member_id, v.value FROM club_profile_values v
            JOIN club_profile_fields f ON f.pk_profile_field_id = v.fk_profile_field_id
            WHERE f.fk_club_id = @ClubId AND v.fk_member_id IN @Ids", new { ClubId = clubId, Ids = ids }))
            .ToDictionary(x => (x.FieldId, x.MemberId), x => x.Value);

        var sb = new StringBuilder();
        var head = new List<string> { "Name", "Email", "Mobile", "Joined", "Member type", "Tags" };
        head.AddRange(fields.Select(f => f.Label));
        sb.AppendLine(string.Join(",", head.Select(MemberFlexRules.Csv)));
        foreach (var m in members)
        {
            var cells = new List<string?>
            {
                m.Name, m.Email, m.Mobile, m.JoinedDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                m.IsHonorary ? "Honorary" : "Active",
                string.Join("; ", m.TagIds.Where(tags.ContainsKey).Select(t => tags[t])),
            };
            cells.AddRange(fields.Select(f => values.GetValueOrDefault((f.Id, m.MemberId))));
            sb.AppendLine(string.Join(",", cells.Select(MemberFlexRules.Csv)));
        }
        return (list.Name, sb.ToString());
    }

    /// <summary>Creates a mass email draft addressed to the list's members as they are now (recipient type 3,
    /// manual). The admin reviews and sends it from Mass Email, where credits and sending stay. Returns the draft id,
    /// or null when the list is not the club's.</summary>
    public async Task<int?> CreateMassEmailDraftAsync(int clubId, int id, SmartListMassEmailRequest req, int by)
    {
        var list = await GetSmartListAsync(clubId, id);
        if (list == null) return null;
        await using var conn = Open();
        var members = await AllMembersAsync(conn, clubId, list.Filter);
        if (members.Count == 0) throw new InvalidOperationException("This list has no members right now.");
        var clubName = await conn.ExecuteScalarAsync<string?>("SELECT ClubName FROM club_master WHERE pk_club_id = @Id", new { Id = clubId });
        return await _massEmail.CreateAsync(clubId, new CreateMassEmailDto
        {
            RecipientType = 3,
            MemberIds = members.Select(m => m.MemberId).ToList(),
            FromName = ContactRules.Clean(req.FromName, 200, "From name") ?? clubName ?? "Rotary",
            Subject = ContactRules.Clean(req.Subject, 200, "Subject") ?? list.Name,
            EmailBody = "",
            SaveAsDraft = true,
        }, by);
    }

    // table and column names are constants from this class, never client input
    private static async Task EnsureFreeAsync(MySqlConnection conn, string table, string column, string pk, int clubId, string value, int? exceptId, string message)
    {
        if (await conn.ExecuteScalarAsync<int>(
                $"SELECT COUNT(*) FROM {table} WHERE fk_club_id = @ClubId AND {column} = @Value AND (@Except IS NULL OR {pk} <> @Except)",
                new { ClubId = clubId, Value = value, Except = exceptId }) > 0)
            throw new InvalidOperationException(message);
    }
}
