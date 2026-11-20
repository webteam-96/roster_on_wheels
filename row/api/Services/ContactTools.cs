using System.Text;
using System.Text.Json;
using ClosedXML.Excel;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

/// <summary>Pure rules for the contacts export, duplicate finder and merge (gap agent, 2026-11-19). Unit tested.</summary>
public static class ContactMergeRules
{
    public const int MaxMerge = 20;
    public static readonly string[] Fields = { "name", "email", "mobile", "contactType", "organisation", "notes" };

    public static string NameKey(string? name)
    {
        var sb = new StringBuilder();
        foreach (var ch in (name ?? "").ToLowerInvariant())
            if (char.IsLetterOrDigit(ch)) sb.Append(ch);
            else if (sb.Length > 0 && sb[^1] != ' ') sb.Append(' ');
        return sb.ToString().Trim();
    }

    /// <summary>Last 9 digits, so +94 77 123 4567 and 077 123 4567 match; too short numbers give no key.</summary>
    public static string? PhoneKey(string? phone)
    {
        var d = ContactRules.Digits(phone);
        return d.Length < 7 ? null : d.Length > 9 ? d[^9..] : d;
    }

    /// <summary>Groups of two or more contacts that share an email, a phone number or a name (transitively).</summary>
    public static List<ContactDuplicateGroupDto> FindDuplicates(IReadOnlyList<ContactDto> contacts)
    {
        var parent = Enumerable.Range(0, contacts.Count).ToArray();
        int Find(int i) => parent[i] == i ? i : parent[i] = Find(parent[i]);
        var reasons = new Dictionary<(int, int), HashSet<string>>();
        var pairReasons = new List<(int A, int B, string Reason)>();
        void Link(Func<ContactDto, string?> key, string reason)
        {
            var first = new Dictionary<string, int>();
            for (var i = 0; i < contacts.Count; i++)
            {
                var k = key(contacts[i]);
                if (string.IsNullOrEmpty(k)) continue;
                if (first.TryGetValue(k, out var j)) { parent[Find(i)] = Find(j); pairReasons.Add((j, i, reason)); }
                else first[k] = i;
            }
        }
        Link(c => c.Email?.Trim().ToLowerInvariant(), "Same email");
        Link(c => PhoneKey(c.Mobile), "Same phone");
        Link(c => { var n = NameKey(c.Name); return n.Length >= 3 ? n : null; }, "Same name");

        return Enumerable.Range(0, contacts.Count).GroupBy(Find).Where(g => g.Count() > 1)
            .Select(g => new ContactDuplicateGroupDto
            {
                Contacts = g.Select(i => contacts[i]).OrderBy(c => c.CreatedDate).ThenBy(c => c.Id).ToList(),
                Reasons = pairReasons.Where(p => Find(p.A) == g.Key).Select(p => p.Reason).Distinct().ToList(),
            })
            .OrderBy(g => g.Contacts[0].Name).ToList();
    }

    /// <summary>The surviving values: each field from the contact named in <paramref name="sources"/>, else the
    /// survivor's value, else the first non-blank value among the others (oldest first).</summary>
    public static ContactDto Pick(IReadOnlyList<ContactDto> set, int survivorId, IReadOnlyDictionary<string, int>? sources)
    {
        var survivor = set.FirstOrDefault(c => c.Id == survivorId) ?? throw new ArgumentException("The contact to keep is not in the list.");
        sources ??= new Dictionary<string, int>();
        foreach (var (field, id) in sources)
        {
            if (!Fields.Contains(field)) throw new ArgumentException($"Unknown field: {field}.");
            if (set.All(c => c.Id != id)) throw new ArgumentException($"The value for {field} must come from one of the contacts being merged.");
        }
        string? Value(ContactDto c, string f) => f switch
        {
            "name" => c.Name, "email" => c.Email, "mobile" => c.Mobile, "contactType" => c.ContactType,
            "organisation" => c.Organisation, _ => c.Notes,
        };
        string? Choose(string f) => sources.TryGetValue(f, out var id)
            ? Value(set.First(c => c.Id == id), f)
            : new[] { survivor }.Concat(set.Where(c => c.Id != survivorId).OrderBy(c => c.CreatedDate).ThenBy(c => c.Id))
                .Select(c => Value(c, f)).FirstOrDefault(v => !string.IsNullOrWhiteSpace(v));
        return new ContactDto
        {
            Id = survivorId,
            Name = Choose("name") ?? survivor.Name,
            Email = Choose("email"),
            Mobile = Choose("mobile"),
            ContactType = Choose("contactType") ?? survivor.ContactType,
            Organisation = Choose("organisation"),
            Notes = Choose("notes"),
        };
    }

    /// <summary>A CSV cell: quoted when needed, and text that a spreadsheet would run as a formula is prefixed with '.</summary>
    public static string CsvCell(string? value)
    {
        var v = value ?? "";
        // a phone number like +94 77 123 4567 stays as it is: digits and spacing cannot run as a formula
        var number = v.Length > 0 && "+-".Contains(v[0]) && v.Skip(1).All(ch => char.IsDigit(ch) || " ()-.".Contains(ch));
        if (v.Length > 0 && "=+-@\t\r".Contains(v[0]) && !number) v = "'" + v;
        return v.IndexOfAny(new[] { ',', '"', '\n', '\r' }) >= 0 ? "\"" + v.Replace("\"", "\"\"") + "\"" : v;
    }
}

/// <summary>Export, duplicate merge and Friends of the club on top of <see cref="ContactService"/>.</summary>
public class ContactToolsService
{
    public const string FriendsKey = "friends";
    private const string OwnerWhere = "fk_club_id = @ClubId AND fk_district_id = @DistrictId";
    private const int MaxExport = 20000;
    private readonly string _connectionString;
    private readonly ContactService _contacts;

    public ContactToolsService(IConfiguration configuration, ContactService contacts)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _contacts = contacts;
    }

    private MySqlConnection Open() => new(_connectionString);

    // ── Export ───────────────────────────────────────────────────────────────────────────

    private static readonly string[] ExportHeader = { "Name", "Type", "Email", "Phone", "Organisation", "Notes", "Groups", "Source", "Added (UTC)" };

    public async Task<(byte[] Bytes, string ContentType, string FileName)> ExportAsync(ContactOwner o, string format,
        string? search, string? type, int? groupId, int by)
    {
        var csv = format.Equals("csv", StringComparison.OrdinalIgnoreCase);
        if (!csv && !format.Equals("xlsx", StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("Format must be xlsx or csv.");
        var rows = new List<ContactDto>();
        for (var page = 1; ; page++)
        {
            var p = await _contacts.ListAsync(o, search, type, groupId, page, 500);
            rows.AddRange(p.Items);
            if (p.Items.Count < 500 || rows.Count >= MaxExport) break;
        }
        var groups = (await _contacts.ListGroupsAsync(o)).ToDictionary(g => g.Id, g => g.Name);
        var cells = rows.Select(c => new[]
        {
            c.Name, ContactTypeLabel(c.ContactType), c.Email ?? "", c.Mobile ?? "", c.Organisation ?? "", c.Notes ?? "",
            string.Join("; ", c.GroupIds.Where(groups.ContainsKey).Select(id => groups[id])), c.Source,
            c.CreatedDate.ToString("yyyy-MM-dd HH:mm"),
        }).ToList();
        await using (var conn = Open())
            // a download of non-members' personal data: who took it is recorded (count only, no names)
            await conn.ExecuteAsync(@"INSERT INTO audit_log (fk_member_master_profile_id, action, entity_type, entity_id, details, created_date)
                VALUES (@By, 'EXPORT', @Type, @Id, @Details, UTC_TIMESTAMP())",
                new { By = by, Type = o.IsClub ? "club_contacts" : "district_contacts", Id = o.IsClub ? o.ClubId : o.DistrictId,
                      Details = $"{(csv ? "csv" : "xlsx")}, {rows.Count} contacts" });
        var stamp = DateTime.UtcNow.ToString("yyyyMMdd");
        if (csv)
        {
            var sb = new StringBuilder();
            foreach (var line in cells.Prepend(ExportHeader)) sb.Append(string.Join(",", line.Select(ContactMergeRules.CsvCell))).Append("\r\n");
            // BOM so Excel opens non-Latin names correctly
            return (Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(sb.ToString())).ToArray(), "text/csv", $"contacts-{stamp}.csv");
        }
        using var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add("Contacts");
        for (var c = 0; c < ExportHeader.Length; c++) ws.Cell(1, c + 1).Value = ExportHeader[c];
        ws.Row(1).Style.Font.Bold = true;
        for (var r = 0; r < cells.Count; r++)
            for (var c = 0; c < cells[r].Length; c++) ws.Cell(r + 2, c + 1).SetValue(cells[r][c]); // text, never a formula
        ws.SheetView.FreezeRows(1);
        ws.Columns().AdjustToContents(1, Math.Min(cells.Count + 1, 200));
        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return (ms.ToArray(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"contacts-{stamp}.xlsx");
    }

    private static string ContactTypeLabel(string t) => t == ContactRules.Friend ? "Friend of the club" : t.Length > 0 ? char.ToUpper(t[0]) + t[1..] : t;

    // ── Duplicates and merge ─────────────────────────────────────────────────────────────

    private static async Task<List<ContactDto>> LoadAsync(MySqlConnection conn, ContactOwner o, IEnumerable<int>? ids = null, MySqlTransaction? tx = null)
        => (await conn.QueryAsync<ContactDto>($@"
            SELECT c.pk_contact_id AS Id, c.name AS Name, c.email AS Email, c.mobile AS Mobile, c.contact_type AS ContactType,
                   c.organisation AS Organisation, c.notes AS Notes, c.source AS Source, c.created_date AS CreatedDate,
                   (SELECT GROUP_CONCAT(gm.fk_contact_group_id) FROM contact_group_members gm WHERE gm.fk_contact_id = c.pk_contact_id) AS GroupIdsCsv
            FROM contacts c WHERE c.{OwnerWhere} {(ids == null ? "" : "AND c.pk_contact_id IN @Ids FOR UPDATE")}",
            new { o.ClubId, o.DistrictId, Ids = ids }, tx)).ToList();

    public async Task<List<ContactDuplicateGroupDto>> FindDuplicatesAsync(ContactOwner o)
    {
        await using var conn = Open();
        return ContactMergeRules.FindDuplicates(await LoadAsync(conn, o));
    }

    /// <summary>Folds the other contacts into the survivor: values field by field, group memberships and every
    /// other record that points at a merged contact move to the survivor; a snapshot of each merged contact is kept
    /// in contact_merge_log.</summary>
    public async Task<ContactDto> MergeAsync(ContactOwner o, MergeContactsRequest req, int by)
    {
        var others = req.MergeIds.Distinct().Where(id => id != req.SurvivorId).ToList();
        if (others.Count == 0) throw new ArgumentException("Pick at least one other contact to merge.");
        if (others.Count > ContactMergeRules.MaxMerge) throw new ArgumentException($"Merge at most {ContactMergeRules.MaxMerge} contacts at a time.");
        var all = others.Prepend(req.SurvivorId).ToList();

        await using var conn = Open();
        await conn.OpenAsync();
        await using var tx = await conn.BeginTransactionAsync();
        var set = await LoadAsync(conn, o, all, tx);
        if (set.Count != all.Count) throw new KeyNotFoundException("One or more contacts were not found.");
        var merged = ContactMergeRules.Pick(set, req.SurvivorId, req.FieldSources);
        // The same rules as a manual save, so a merge cannot store what the form would refuse.
        merged.Name = ContactRules.Name(merged.Name);
        merged.Email = ContactRules.Email(merged.Email);
        merged.Mobile = ContactRules.Phone(merged.Mobile);
        merged.ContactType = ContactRules.ContactType(merged.ContactType);

        var sources = req.FieldSources == null ? null : JsonSerializer.Serialize(req.FieldSources);
        foreach (var c in set.Where(c => c.Id != req.SurvivorId))
            await conn.ExecuteAsync(@"
                INSERT INTO contact_merge_log (fk_club_id, fk_district_id, fk_survivor_contact_id, merged_contact_id, merged_snapshot,
                       field_sources, merged_by, merged_date_utc)
                VALUES (@ClubId, @DistrictId, @Survivor, @Merged, @Snapshot, @Sources, @By, UTC_TIMESTAMP())",
                new { o.ClubId, o.DistrictId, Survivor = req.SurvivorId, Merged = c.Id, Snapshot = JsonSerializer.Serialize(c), Sources = sources, By = by }, tx);
        // Earlier merges into a contact that is now merged away follow it to the survivor.
        await conn.ExecuteAsync("UPDATE contact_merge_log SET fk_survivor_contact_id = @S WHERE fk_survivor_contact_id IN @M",
            new { S = req.SurvivorId, M = others }, tx);

        await conn.ExecuteAsync(@"
            INSERT IGNORE INTO contact_group_members (fk_contact_group_id, fk_contact_id)
            SELECT fk_contact_group_id, @S FROM contact_group_members WHERE fk_contact_id IN @M", new { S = req.SurvivorId, M = others }, tx);
        await conn.ExecuteAsync("DELETE FROM contact_group_members WHERE fk_contact_id IN @M", new { M = others }, tx);

        // Club tags key contacts by entity_id (no fk_contact_id column), so the generic relink below misses them.
        await conn.ExecuteAsync(@"
            INSERT IGNORE INTO club_tag_assignments (fk_club_tag_id, entity_type, entity_id, created_by)
            SELECT fk_club_tag_id, 'contact', @S, created_by FROM club_tag_assignments WHERE entity_type = 'contact' AND entity_id IN @M;
            DELETE FROM club_tag_assignments WHERE entity_type = 'contact' AND entity_id IN @M;", new { S = req.SurvivorId, M = others }, tx);

        // Every other table that links to a contact (mass email recipients, volunteer sign-ups, speakers, and any
        // later module) is found by its fk_contact_id column. Names come from the schema, not from input.
        var linked = await conn.QueryAsync<string>(@"
            SELECT TABLE_NAME FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'fk_contact_id'
              AND TABLE_NAME NOT IN ('contacts', 'contact_group_members', 'contact_merge_log')", transaction: tx);
        foreach (var table in linked)
            await conn.ExecuteAsync($"UPDATE IGNORE `{table.Replace("`", "")}` SET fk_contact_id = @S WHERE fk_contact_id IN @M",
                new { S = req.SurvivorId, M = others }, tx);

        await conn.ExecuteAsync($"DELETE FROM contacts WHERE pk_contact_id IN @M AND {OwnerWhere}", new { M = others, o.ClubId, o.DistrictId }, tx);
        await conn.ExecuteAsync($@"
            UPDATE contacts SET name = @Name, email = @Email, mobile = @Mobile, contact_type = @ContactType, organisation = @Organisation,
                   notes = @Notes, modified_by = @By, modified_date = UTC_TIMESTAMP()
            WHERE pk_contact_id = @Id AND {OwnerWhere}",
            new { merged.Name, merged.Email, merged.Mobile, merged.ContactType, merged.Organisation, merged.Notes, By = by, merged.Id, o.ClubId, o.DistrictId }, tx);
        await SyncFriendsGroupAsync(conn, tx, o);
        await tx.CommitAsync();
        return (await LoadAsync(conn, o, new[] { req.SurvivorId })).Single();
    }

    public async Task<List<ContactMergeHistoryDto>> HistoryAsync(ContactOwner o, int contactId)
    {
        await using var conn = Open();
        var rows = await conn.QueryAsync<(int Id, int MergedId, string Snapshot, int? By, string? ByName, DateTime At)>($@"
            SELECT l.pk_merge_id, l.merged_contact_id, l.merged_snapshot, l.merged_by, m.MemberName, l.merged_date_utc
            FROM contact_merge_log l
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = l.merged_by
            WHERE l.fk_survivor_contact_id = @Id AND l.{OwnerWhere} ORDER BY l.pk_merge_id DESC",
            new { Id = contactId, o.ClubId, o.DistrictId });
        return rows.Select(r => new ContactMergeHistoryDto
        {
            Id = r.Id, MergedContactId = r.MergedId, MergedBy = r.ByName, MergedDateUtc = DateTime.SpecifyKind(r.At, DateTimeKind.Utc),
            Merged = JsonSerializer.Deserialize<ContactDto>(r.Snapshot) ?? new ContactDto(),
        }).ToList();
    }

    // ── Friends of the club ──────────────────────────────────────────────────────────────

    /// <summary>Keeps the owner's system group equal to its friends; creates it on the first friend. A group the
    /// admin deleted comes back on the next save; a rename is kept.</summary>
    public static async Task SyncFriendsGroupAsync(MySqlConnection conn, MySqlTransaction tx, ContactOwner o)
    {
        var args = new { o.ClubId, o.DistrictId, Key = FriendsKey, Friend = ContactRules.Friend };
        var groupId = await conn.ExecuteScalarAsync<int?>(
            $"SELECT pk_contact_group_id FROM contact_groups WHERE {OwnerWhere} AND system_key = @Key LIMIT 1", args, tx);
        if (groupId == null)
        {
            if (await conn.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM contacts WHERE {OwnerWhere} AND contact_type = @Friend", args, tx) == 0) return;
            var name = o.IsClub ? "Friends of the club" : "Friends of the district";
            if (await conn.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM contact_groups WHERE {OwnerWhere} AND name = @Name", new { o.ClubId, o.DistrictId, Name = name }, tx) > 0)
                name += " (auto)";
            groupId = await conn.ExecuteScalarAsync<int>(@"
                INSERT INTO contact_groups (fk_club_id, fk_district_id, name, system_key) VALUES (@ClubId, @DistrictId, @Name, @Key);
                SELECT LAST_INSERT_ID();", new { o.ClubId, o.DistrictId, Name = name, Key = FriendsKey }, tx);
        }
        await conn.ExecuteAsync(@"
            DELETE gm FROM contact_group_members gm JOIN contacts c ON c.pk_contact_id = gm.fk_contact_id
            WHERE gm.fk_contact_group_id = @G AND c.contact_type <> @Friend", new { G = groupId, Friend = ContactRules.Friend }, tx);
        await conn.ExecuteAsync($@"
            INSERT IGNORE INTO contact_group_members (fk_contact_group_id, fk_contact_id)
            SELECT @G, pk_contact_id FROM contacts WHERE {OwnerWhere} AND contact_type = @Friend",
            new { G = groupId, o.ClubId, o.DistrictId, Friend = ContactRules.Friend }, tx);
    }
}
