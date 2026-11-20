using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

// ── Group messages (user 2026-10-19) ───────────────────────────────────────────────────────────
// A NEW module next to the one-to-one chats (GoalDirectMessages.cs stays as it is). Per zone + year:
//   District group  "D:{district}:{category}" - that district's DG + District Admins, every co-ordinator
//                   of the category in the zone (RRFC, E/MGA, EPNC …), the assistants covering that
//                   district (ARRFC, AE/MGA, AEPNC …) and the RI Director. A DG writes here per category.
//   Team group      "T:{category}:{track}" - one co-ordinator designation with its own assistants
//                   (RRFC + ARRFCs, E/MGA + AE/MGAs …) and the RI Director.
//   Broadcast box   "B:{category}" - a co-ordinator's "All my districts" (every district of the zone) or
//                   an assistant's "My districts": one message is written into each district group, so
//                   every district answers in its own group.
// RI Director and SuperAdmin see and may write in every group of the zone. Everyone in a group sees
// every message and may reply. District Admins write as the DG (same rule as the one-to-one chats).
public partial class GoalSettingService
{
    private sealed class GSeat
    {
        public int M; public string Kind = ""; public int Cat; public string Track = ""; public string Title = "";
        public Dictionary<int, string> Districts = new();
    }

    private sealed class GZone
    {
        public int ZoneId;
        public List<(int Id, string Num)> Districts = new();
        public Dictionary<int, (string Name, int Sort)> Cats = new();
        public List<GSeat> Seats = new();
        public Dictionary<int, string> Names = new();
    }

    private sealed class GDef
    {
        public string Key = ""; public string Kind = ""; public int Cat; public int District; public string Track = "";
        public HashSet<int> Members = new();
        public List<int> BroadcastDistricts = new();
    }

    private sealed class GRow
    {
        public long Id { get; set; }
        public string GroupKey { get; set; } = "";
        public int SenderMemberId { get; set; }
        public string SenderKind { get; set; } = "";
        public string? SenderTitle { get; set; }
        public string SenderName { get; set; } = "";
        public int CategoryId { get; set; }
        public int DistrictId { get; set; }
        public long BatchId { get; set; }
        public string Text { get; set; } = "";
        public DateTime Created { get; set; }
    }

    private static volatile bool _groupTablesReady;
    private static async Task EnsureGroupTablesAsync(MySqlConnection conn)
    {
        if (_groupTablesReady) return;
        await conn.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS goal_group_messages (
                pk_id BIGINT AUTO_INCREMENT PRIMARY KEY,
                fk_year_id INT NOT NULL,
                fk_zone_id INT NOT NULL,
                GroupKey VARCHAR(60) NOT NULL,
                fk_category_id INT NOT NULL DEFAULT 0,
                fk_district_id INT NOT NULL DEFAULT 0,
                SenderMemberId INT NOT NULL,
                SenderKind VARCHAR(30) NOT NULL,
                SenderTitle VARCHAR(200) NULL,
                BatchId BIGINT NOT NULL DEFAULT 0,
                CommentText TEXT NOT NULL,
                created_date DATETIME NOT NULL,
                isdeleted TINYINT(1) NOT NULL DEFAULT 0,
                KEY ix_ggm_group (fk_zone_id, fk_year_id, GroupKey),
                KEY ix_ggm_sender (SenderMemberId, fk_year_id)
            )");
        await conn.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS goal_group_message_reads (
                fk_member_id INT NOT NULL,
                fk_zone_id INT NOT NULL,
                fk_year_id INT NOT NULL,
                GroupKey VARCHAR(60) NOT NULL,
                LastReadId BIGINT NOT NULL DEFAULT 0,
                modified_date DATETIME NULL,
                PRIMARY KEY (fk_member_id, fk_zone_id, fk_year_id, GroupKey)
            )");
        _groupTablesReady = true;
    }

    // Track of a title = the co-ordinator short form it belongs to ("ARRFC" -> "RRFC", "E/MGA" -> "E/MGA").
    // The old "(ARC)" title is ARMC, under the RMC. Titles outside the known pairs share one track "".
    private static string ZcTrack(string? title)
    {
        var s = DesignationShort(title);
        return DesignationAssistantOf.Keys.FirstOrDefault(k => k.Equals(s, StringComparison.OrdinalIgnoreCase)) ?? "";
    }
    private static string DaTrack(string? title)
    {
        var s = DesignationShort(title);
        return s.Equals("ARC", StringComparison.OrdinalIgnoreCase) ? "RMC" : CoordinatorShortOf(title);
    }

    private async Task<GZone> LoadGroupZoneAsync(MySqlConnection conn, int zoneId, int yearId)
    {
        var z = new GZone { ZoneId = zoneId };
        z.Districts = (await conn.QueryAsync<(int, string)>(
            $"SELECT pk_district_id, DistrictNumber FROM district_master WHERE fk_zone_id = @Z AND isdeleted = 0 AND IsActive = 1 AND {HierarchyScopeSql.DistrictLive("district_master")} ORDER BY DistrictNumber",
            new { Z = zoneId })).ToList();
        foreach (var c in await conn.QueryAsync<dynamic>(
            "SELECT pk_category_id AS id, IF(Name = 'TRF', 'Foundation', Name) AS n, SortOrder AS s FROM goal_categories WHERE isdeleted = 0"))
        {
            string name = (string)c.n; int sort = Convert.ToInt32((object)c.s);
            z.Cats[Convert.ToInt32((object)c.id)] = (name, sort);
        }

        foreach (var r in await conn.QueryAsync<dynamic>(@"
            SELECT DISTINCT a.fk_member_id AS m FROM goal_role_assignments a
            JOIN goal_role_assignment_zones gz ON gz.fk_assignment_id = a.pk_id
            WHERE a.RoleType = 'AllCategoryAllDistrictsFewZones' AND a.IsActive = 1 AND a.isdeleted = 0
              AND a.fk_member_id > 0 AND gz.fk_zone_id = @Z", new { Z = zoneId }))
            z.Seats.Add(new GSeat { M = Convert.ToInt32(r.m), Kind = KindRi, Title = "RI Director" });

        foreach (var r in await conn.QueryAsync<dynamic>(@"
            SELECT a.fk_member_id AS m, a.RoleTitle AS t, a.fk_category_id AS c FROM goal_role_assignments a
            WHERE a.RoleType = 'AllDistrictsOneCategoryOneZone' AND a.IsActive = 1 AND a.isdeleted = 0
              AND a.fk_member_id > 0 AND a.fk_zone_id = @Z AND a.fk_category_id IS NOT NULL", new { Z = zoneId }))
        {
            string t = (r.t as string) ?? "Zone Co-ordinator";
            z.Seats.Add(new GSeat { M = Convert.ToInt32(r.m), Kind = KindZc, Cat = Convert.ToInt32(r.c), Track = ZcTrack(t), Title = t });
        }

        var das = new Dictionary<long, GSeat>();
        foreach (var r in await conn.QueryAsync<dynamic>($@"
            SELECT a.pk_id AS id, a.fk_member_id AS m, a.RoleTitle AS t, a.fk_category_id AS c, dm.pk_district_id AS d, dm.DistrictNumber AS n
            FROM goal_role_assignments a
            JOIN goal_role_assignment_districts ad ON ad.fk_assignment_id = a.pk_id
            JOIN district_master dm ON dm.pk_district_id = ad.fk_district_id AND dm.isdeleted = 0 AND {HierarchyScopeSql.DistrictLive("dm")}
            WHERE a.RoleType = 'FewDistrictsOneCategoryOneZone' AND a.IsActive = 1 AND a.isdeleted = 0
              AND a.fk_member_id > 0 AND a.fk_zone_id = @Z AND a.fk_category_id IS NOT NULL", new { Z = zoneId }))
        {
            long id = Convert.ToInt64(r.id);
            if (!das.TryGetValue(id, out var s))
            {
                string t = (r.t as string) ?? "District Assistant";
                das[id] = s = new GSeat { M = Convert.ToInt32(r.m), Kind = KindDa, Cat = Convert.ToInt32(r.c), Track = DaTrack(t), Title = t };
            }
            s.Districts[Convert.ToInt32(r.d)] = (string)r.n;
        }
        z.Seats.AddRange(das.Values);

        // DGs + District Admins, the same people the one-to-one chats use.
        foreach (var s in (await LoadZoneSeatsAsync(conn, zoneId, yearId)).Where(s => s.Kind is KindDg or KindDadm))
            z.Seats.Add(new GSeat { M = s.MemberId, Kind = s.Kind, Title = s.Title, Districts = s.Districts });

        await LoadNamesAsync(conn, z.Names, z.Seats.Select(s => s.M));
        return z;
    }

    // Every District and Team group of the zone.
    private static List<GDef> ZoneGroups(GZone z)
    {
        var ri = z.Seats.Where(s => s.Kind == KindRi).Select(s => s.M).ToList();
        var list = new List<GDef>();
        foreach (var (did, _) in z.Districts)
            foreach (var cat in z.Cats.Keys)
            {
                var g = new GDef { Key = $"D:{did}:{cat}", Kind = "District", Cat = cat, District = did };
                foreach (var s in z.Seats)
                {
                    bool inIt = s.Kind switch
                    {
                        KindDg or KindDadm => s.Districts.ContainsKey(did),
                        KindZc => s.Cat == cat,
                        KindDa => s.Cat == cat && s.Districts.ContainsKey(did),
                        _ => false,
                    };
                    if (inIt) g.Members.Add(s.M);
                }
                g.Members.UnionWith(ri);
                list.Add(g);
            }
        foreach (var t in z.Seats.Where(s => s.Kind is KindZc or KindDa).Select(s => (s.Cat, s.Track)).Distinct())
        {
            var g = new GDef { Key = $"T:{t.Cat}:{t.Track}", Kind = "Team", Cat = t.Cat, Track = t.Track };
            foreach (var s in z.Seats.Where(s => s.Kind is KindZc or KindDa && s.Cat == t.Cat && s.Track == t.Track)) g.Members.Add(s.M);
            g.Members.UnionWith(ri);
            list.Add(g);
        }
        return list;
    }

    // The viewer's own "All my districts" boxes, one per category they co-ordinate / assist in.
    private static List<GDef> BroadcastGroups(GZone z, int viewer)
    {
        var list = new List<GDef>();
        foreach (var cat in z.Seats.Where(s => s.M == viewer && s.Kind is KindZc or KindDa).Select(s => s.Cat).Distinct())
        {
            bool zc = z.Seats.Any(s => s.M == viewer && s.Kind == KindZc && s.Cat == cat);
            var ds = zc ? z.Districts.Select(d => d.Id).ToList()
                        : z.Seats.Where(s => s.M == viewer && s.Kind == KindDa && s.Cat == cat).SelectMany(s => s.Districts.Keys)
                              .Where(d => z.Districts.Any(x => x.Id == d)).Distinct().ToList();
            if (ds.Count == 0) continue;
            var track = z.Seats.Where(s => s.M == viewer && s.Cat == cat && s.Kind == (zc ? KindZc : KindDa)).Select(s => s.Track).FirstOrDefault() ?? "";
            list.Add(new GDef { Key = $"B:{cat}", Kind = "Broadcast", Cat = cat, Track = track, BroadcastDistricts = ds, Members = { viewer } });
        }
        return list;
    }

    private static async Task<bool> SeesAllGroupsAsync(MySqlConnection conn, GZone z, int viewer)
        => z.Seats.Any(s => s.M == viewer && s.Kind == KindRi) || await ClubAdminAccessHelper.IsSuperAdminAsync(conn, viewer);

    private async Task<(GZone Z, List<GDef> Groups, bool All)> ViewerGroupsAsync(MySqlConnection conn, int viewer, int zoneId, int yearId)
    {
        var z = await LoadGroupZoneAsync(conn, zoneId, yearId);
        bool all = await SeesAllGroupsAsync(conn, z, viewer);
        var groups = ZoneGroups(z).Where(g => all || g.Members.Contains(viewer)).ToList();
        groups.AddRange(BroadcastGroups(z, viewer));
        return (z, groups, all);
    }

    private string GroupName(GZone z, GDef g)
    {
        string cat = z.Cats.TryGetValue(g.Cat, out var c) ? c.Name : "";
        return g.Kind switch
        {
            "District" => $"District {z.Districts.FirstOrDefault(d => d.Id == g.District).Num} · {cat}",
            "Team" => g.Track != "" ? $"{g.Track} team · {cat}" : $"{cat} team",
            _ => $"{(g.BroadcastDistricts.Count == z.Districts.Count ? "All my districts" : "My districts")} · {cat}",
        };
    }

    private static string? GroupSub(GZone z, GDef g)
    {
        if (g.Kind == "Broadcast")
            return $"{(g.Track != "" ? g.Track + " → " : "")}D {string.Join(", ", g.BroadcastDistricts.Select(d => z.Districts.First(x => x.Id == d).Num))}";
        // Members by short role, co-ordinators first: "Uttam Ganguli (RRFC), Pawan Agarwal (E/MGA), …"
        return string.Join(", ", ShownMembers(z, g).Select(x => $"{x.Name} ({ShortOf(x.Role)})"));
    }

    // Who a group lists (user 2026-10-19): District Admins are NOT shown - only the DG (or "No DG").
    // They still receive every message of their district's groups and may reply (shown as the DG).
    private static List<GoalGroupMemberDto> ShownMembers(GZone z, GDef g)
    {
        var list = g.Members.Select(m => new GoalGroupMemberDto { MemberId = m, Name = z.Names.GetValueOrDefault(m, ""), Role = MemberRoleIn(z, g, m) })
            .Where(x => x.Role != "District Admin")
            .OrderBy(x => RoleSort(x.Role)).ThenBy(x => x.Name).ToList();
        if (g.Kind == "District" && !list.Any(x => x.Role == "District Governor"))
            list.Add(new GoalGroupMemberDto { MemberId = -g.District, Name = $"District {z.Districts.FirstOrDefault(d => d.Id == g.District).Num}", Role = "No DG" });
        return list;
    }

    private static string ShortOf(string role) { var s = DesignationShort(role); return s != "" ? s : role switch { "District Governor" => "DG", _ => role }; }
    private static int RoleSort(string role) => role switch
    {
        "RI Director" => 0, "District Governor" => 8, "No DG" => 8, "District Admin" => 9,
        _ => role.StartsWith("Assistant", StringComparison.OrdinalIgnoreCase) ? 5 : 2,
    };

    // The role a member holds inside one group (co-ordinator / assistant title of that category first).
    private static string MemberRoleIn(GZone z, GDef g, int m)
    {
        var mine = z.Seats.Where(s => s.M == m).ToList();
        var zc = mine.FirstOrDefault(s => s.Kind == KindZc && s.Cat == g.Cat && (g.Kind != "Team" || s.Track == g.Track));
        if (zc != null) return zc.Title;
        var da = mine.FirstOrDefault(s => s.Kind == KindDa && s.Cat == g.Cat && (g.Kind != "Team" || s.Track == g.Track)
                                          && (g.Kind != "District" || s.Districts.ContainsKey(g.District)));
        if (da != null) return da.Title;
        if (mine.Any(s => s.Kind == KindRi)) return "RI Director";
        if (g.Kind == "District" && mine.Any(s => s.Kind == KindDg && s.Districts.ContainsKey(g.District))) return "District Governor";
        if (g.Kind == "District" && mine.Any(s => s.Kind == KindDadm && s.Districts.ContainsKey(g.District))) return "District Admin";
        return "Super Admin";
    }

    private static string KindOfRole(string role) => role switch
    {
        "RI Director" => KindRi, "District Governor" => KindDg, "District Admin" => KindDadm, "Super Admin" => KindSa,
        _ => role.StartsWith("Assistant", StringComparison.OrdinalIgnoreCase) ? KindDa : KindZc,
    };

    private static async Task<List<GRow>> GroupRowsAsync(MySqlConnection conn, int zoneId, int yearId, string? key = null)
        => (await conn.QueryAsync<GRow>(@"
            SELECT g.pk_id AS Id, g.GroupKey, g.SenderMemberId, g.SenderKind, g.SenderTitle, COALESCE(m.MemberName,'') AS SenderName,
                   g.fk_category_id AS CategoryId, g.fk_district_id AS DistrictId, g.BatchId, g.CommentText AS Text, g.created_date AS Created
            FROM goal_group_messages g
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = g.SenderMemberId
            WHERE g.isdeleted = 0 AND g.fk_zone_id = @Z AND g.fk_year_id = @Y AND (@K IS NULL OR g.GroupKey = @K)
            ORDER BY g.created_date, g.pk_id", new { Z = zoneId, Y = yearId, K = key })).ToList();

    // Rows of a broadcast box: the viewer's own fan-out messages of that category, once per batch.
    private static List<GRow> BroadcastRows(List<GRow> rows, int viewer, int cat)
        => rows.Where(r => r.SenderMemberId == viewer && r.BatchId > 0 && r.CategoryId == cat)
               .GroupBy(r => r.BatchId).Select(g => g.First()).OrderBy(r => r.Created).ThenBy(r => r.Id).ToList();

    private static async Task<Dictionary<string, long>> GroupReadsAsync(MySqlConnection conn, int viewer, int zoneId, int yearId)
        => (await conn.QueryAsync<(string, long)>(
            "SELECT GroupKey, LastReadId FROM goal_group_message_reads WHERE fk_member_id = @M AND fk_zone_id = @Z AND fk_year_id = @Y",
            new { M = viewer, Z = zoneId, Y = yearId })).ToDictionary(x => x.Item1, x => x.Item2);

    private GoalGroupDto ToGroupDto(GZone z, GDef g, List<GRow> rows, long lastRead, int viewer, bool all)
    {
        var last = rows.LastOrDefault();
        return new GoalGroupDto
        {
            Key = g.Key, Kind = g.Kind, Name = GroupName(z, g), Sub = GroupSub(z, g),
            CategoryId = g.Cat, CategoryName = z.Cats.TryGetValue(g.Cat, out var c) ? c.Name : null,
            DistrictId = g.District, DistrictNumber = g.District > 0 ? z.Districts.FirstOrDefault(d => d.Id == g.District).Num : null,
            MemberCount = ShownMembers(z, g).Count, MessageCount = rows.Count,
            UnreadCount = g.Kind == "Broadcast" ? 0 : rows.Count(r => r.Id > lastRead && r.SenderMemberId != viewer),
            LastMessagePreview = last == null ? null : (last.SenderMemberId == viewer ? "You: " : $"{ShownName(z, last, viewer)}: ") + last.Text,
            LastMessageDate = last != null ? ZoneTime.Print(last.Created, "yyyy-MM-dd HH:mm", ViewerZone.Current) : null,
            CanPost = all || g.Members.Contains(viewer),
        };
    }

    // A District Admin writes as the DG (seen from outside that district); SuperAdmin also sees who typed it.
    private static bool ViewerInDistrict(GZone z, int viewer, int districtId)
        => z.Seats.Any(s => s.M == viewer && s.Kind is KindDg or KindDadm && s.Districts.ContainsKey(districtId));

    private static string ShownName(GZone z, GRow r, int viewer)
    {
        if (r.SenderKind is KindDg or KindDadm && r.DistrictId > 0 && !ViewerInDistrict(z, viewer, r.DistrictId))
        {
            var dg = z.Seats.FirstOrDefault(s => s.Kind == KindDg && s.Districts.ContainsKey(r.DistrictId));
            return dg != null ? z.Names.GetValueOrDefault(dg.M, r.SenderName) : $"District {z.Districts.FirstOrDefault(d => d.Id == r.DistrictId).Num}";
        }
        return r.SenderName;
    }

    private static GoalCommentDto GroupMsgDto(GZone z, GRow r, int viewer, bool viewerIsSa)
    {
        bool asDg = r.SenderKind is KindDg or KindDadm && r.DistrictId > 0 && !ViewerInDistrict(z, viewer, r.DistrictId);
        bool hasDg = z.Seats.Any(s => s.Kind == KindDg && s.Districts.ContainsKey(r.DistrictId));
        return new GoalCommentDto
        {
            Id = r.Id, CommentText = r.Text, PostedByMemberId = r.SenderMemberId, IsMine = r.SenderMemberId == viewer,
            PostedByName = ShownName(z, r, viewer),
            PostedByRoleLabel = asDg ? (hasDg ? "District Governor" : "No DG") : r.SenderTitle,
            EnteredByName = asDg && viewerIsSa && r.SenderKind == KindDadm ? r.SenderName : null,
            CreatedDate = ZoneTime.Print(r.Created, "yyyy-MM-dd HH:mm", ViewerZone.Current),
        };
    }

    private async Task<int> GroupZoneAsync(MySqlConnection conn, int zoneId, int districtId)
        => zoneId > 0 ? zoneId : (districtId > 0 ? await DistrictZoneIdAsync(conn, districtId) ?? 0 : 0);

    public async Task<List<GoalGroupDto>> GetGoalGroupsAsync(int viewer, int zoneId, int districtId, int yearId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        await EnsureGroupTablesAsync(conn);
        zoneId = await GroupZoneAsync(conn, zoneId, districtId);
        if (zoneId <= 0 || yearId <= 0) return new();
        var (z, groups, all) = await ViewerGroupsAsync(conn, viewer, zoneId, yearId);
        // A district screen shows only that district's groups (user 2026-10-19) - also for a SuperAdmin
        // or RI Director opening it; their zone screens show the rest.
        if (districtId > 0) groups = groups.Where(g => g.Kind == "District" && g.District == districtId).ToList();
        var rows = await GroupRowsAsync(conn, zoneId, yearId);
        var byKey = rows.GroupBy(r => r.GroupKey).ToDictionary(g => g.Key, g => g.ToList());
        var reads = await GroupReadsAsync(conn, viewer, zoneId, yearId);
        return groups.Select(g => ToGroupDto(z, g,
                g.Kind == "Broadcast" ? BroadcastRows(rows, viewer, g.Cat) : byKey.GetValueOrDefault(g.Key) ?? new(),
                reads.GetValueOrDefault(g.Key), viewer, all))
            .OrderBy(g => g.Kind == "Broadcast" ? 0 : 1)
            .ThenBy(g => z.Cats.TryGetValue(g.CategoryId, out var c) ? c.Sort : 99)
            .ThenBy(g => g.Kind == "Team" ? 0 : 1).ThenBy(g => g.Name, StringComparer.Ordinal).ToList();
    }

    public async Task<GoalGroupConversationDto> GetGoalGroupConversationAsync(int viewer, string key, int zoneId, int districtId, int yearId, bool markRead)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        await EnsureGroupTablesAsync(conn);
        zoneId = await GroupZoneAsync(conn, zoneId, districtId);
        if (zoneId <= 0 || yearId <= 0) throw new UnauthorizedAccessException("You are not in this group.");
        var (z, groups, all) = await ViewerGroupsAsync(conn, viewer, zoneId, yearId);
        var g = groups.FirstOrDefault(x => x.Key == key) ?? throw new UnauthorizedAccessException("You are not in this group.");
        var rows = g.Kind == "Broadcast" ? BroadcastRows(await GroupRowsAsync(conn, zoneId, yearId), viewer, g.Cat)
                                         : await GroupRowsAsync(conn, zoneId, yearId, key);
        var reads = await GroupReadsAsync(conn, viewer, zoneId, yearId);
        var dto = new GoalGroupConversationDto { Group = ToGroupDto(z, g, rows, reads.GetValueOrDefault(key), viewer, all) };
        if (markRead && rows.Count > 0 && g.Kind != "Broadcast")
            await conn.ExecuteAsync(@"
                INSERT INTO goal_group_message_reads (fk_member_id, fk_zone_id, fk_year_id, GroupKey, LastReadId, modified_date)
                VALUES (@M, @Z, @Y, @K, @L, NOW())
                ON DUPLICATE KEY UPDATE LastReadId = GREATEST(LastReadId, VALUES(LastReadId)), modified_date = NOW()",
                new { M = viewer, Z = zoneId, Y = yearId, K = key, L = rows.Max(r => r.Id) });
        bool isSa = await ClubAdminAccessHelper.IsSuperAdminAsync(conn, viewer);
        dto.Messages = rows.Select(r => GroupMsgDto(z, r, viewer, isSa)).ToList();
        if (g.Kind == "Broadcast")
            foreach (var m in dto.Messages) m.CategoryName = null;
        dto.Members = ShownMembers(z, g);
        if (g.Kind == "Broadcast")
            dto.Members = g.BroadcastDistricts.Select(d => new GoalGroupMemberDto { MemberId = -d, Name = $"District {z.Districts.First(x => x.Id == d).Num}", Role = "District" }).ToList();
        return dto;
    }

    public async Task<GoalCommentDto> PostGoalGroupMessageAsync(int viewer, string key, int zoneId, int districtId, int yearId, string? commentText)
    {
        var text = (commentText ?? "").Trim();
        if (text.Length == 0) throw new InvalidOperationException("Message cannot be empty.");
        if (text.Length > 4000) throw new InvalidOperationException("Message is too long (max 4000 characters).");
        using var conn = CreateConnection();
        await conn.OpenAsync();
        await EnsureGroupTablesAsync(conn);
        zoneId = await GroupZoneAsync(conn, zoneId, districtId);
        if (zoneId <= 0 || yearId <= 0) throw new InvalidOperationException("Zone and year are required.");
        var (z, groups, all) = await ViewerGroupsAsync(conn, viewer, zoneId, yearId);
        var g = groups.FirstOrDefault(x => x.Key == key) ?? throw new UnauthorizedAccessException("You are not in this group.");

        // Fan-out: a broadcast writes into each of the sender's district groups of that category.
        var targets = g.Kind == "Broadcast"
            ? g.BroadcastDistricts.Select(d => ZoneGroups(z).First(x => x.Key == $"D:{d}:{g.Cat}")).ToList()
            : new List<GDef> { g };
        long batch = 0, firstId = 0;
        foreach (var t in targets)
        {
            string role = MemberRoleIn(z, t, viewer);
            int did = t.District;
            var id = await conn.ExecuteScalarAsync<long>(@"
                INSERT INTO goal_group_messages (fk_year_id, fk_zone_id, GroupKey, fk_category_id, fk_district_id,
                                                 SenderMemberId, SenderKind, SenderTitle, BatchId, CommentText, created_date, isdeleted)
                VALUES (@Y, @Z, @K, @C, @D, @M, @Kind, @T, @B, @Text, NOW(), 0); SELECT LAST_INSERT_ID();",
                new { Y = yearId, Z = zoneId, K = t.Key, C = t.Cat, D = did, M = viewer, Kind = KindOfRole(role), T = role, B = batch, Text = text });
            if (g.Kind == "Broadcast" && batch == 0)
            {
                batch = id;
                await conn.ExecuteAsync("UPDATE goal_group_messages SET BatchId = @B WHERE pk_id = @B", new { B = batch });
            }
            if (firstId == 0) firstId = id;
        }
        var row = (await conn.QueryAsync<GRow>(@"
            SELECT g.pk_id AS Id, g.GroupKey, g.SenderMemberId, g.SenderKind, g.SenderTitle, COALESCE(m.MemberName,'') AS SenderName,
                   g.fk_category_id AS CategoryId, g.fk_district_id AS DistrictId, g.BatchId, g.CommentText AS Text, g.created_date AS Created
            FROM goal_group_messages g
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = g.SenderMemberId
            WHERE g.pk_id = @Id", new { Id = firstId })).First();
        return GroupMsgDto(z, row, viewer, false);
    }

    // Excel messages report (user 2026-10-19): group messages only - personal chats stay private.
    // A District Admin's message reads as the DG ("Entered by" keeps the real writer). A broadcast is
    // listed once ("All my districts") unless the report is filtered to one district.
    private static async Task<List<(int Sort, string Cat, int Did, string? Dnum, string Role, string From, string Msg, string Dt, DateTime Raw, string Entered)>>
        GroupReportRowsAsync(MySqlConnection conn, int zoneId, int yearId, int categoryId, int districtId)
    {
        await EnsureGroupTablesAsync(conn);
        var rows = await conn.QueryAsync<dynamic>($@"
            SELECT IF(c.Name = 'TRF', 'Foundation', c.Name) AS catName, c.SortOrder AS catSort,
                   g.GroupKey AS gkey, g.fk_district_id AS did, dm.DistrictNumber AS dnum, g.SenderKind AS kind, g.SenderTitle AS title,
                   g.BatchId AS batch, COALESCE(s.MemberName,'') AS fromName, g.CommentText AS msg, g.created_date AS raw,
                   (SELECT COALESCE(gm.MemberName,'') FROM district_governors dg
                      JOIN member_master_profile gm ON gm.pk_member_master_profile_id = dg.fk_member_id
                     WHERE dg.fk_district_id = g.fk_district_id AND dg.fk_year_id = g.fk_year_id AND COALESCE(dg.isdeleted,0) = 0
                     LIMIT 1) AS dgName
            FROM goal_group_messages g
            JOIN goal_categories c ON c.pk_category_id = g.fk_category_id AND c.isdeleted = 0
            LEFT JOIN member_master_profile s ON s.pk_member_master_profile_id = g.SenderMemberId
            LEFT JOIN district_master dm ON dm.pk_district_id = g.fk_district_id
            WHERE g.isdeleted = 0 AND g.fk_zone_id = @Z AND g.fk_year_id = @Y
              AND {HierarchyScopeSql.DistrictIdLive("g.fk_district_id")}
              AND (@Cat = 0 OR g.fk_category_id = @Cat) AND (@Did = 0 OR g.fk_district_id = @Did)
            ORDER BY g.created_date, g.pk_id", new { Z = zoneId, Y = yearId, Cat = categoryId, Did = districtId });
        var outRows = new List<(int, string, int, string?, string, string, string, string, DateTime, string)>();
        var batches = new HashSet<long>();
        foreach (var x in rows)
        {
            long batch = Convert.ToInt64((object)x.batch);
            bool once = batch > 0 && districtId == 0;
            if (once && !batches.Add(batch)) continue;
            DateTime raw = (DateTime)x.raw;
            string cat = (string)x.catName, key = (string)x.gkey, kind = (string)x.kind, fromName = (string)x.fromName;
            int did = Convert.ToInt32((object)x.did);
            string? dnum = x.dnum as string;
            bool district = kind is KindDg or KindDadm;
            string dg = (x.dgName as string) is { Length: > 0 } n ? n : $"District {dnum} (No DG)";
            string group = once ? $"All my districts · {cat}"
                : key.StartsWith("T:") ? $"{(key.Split(':').Length > 2 && key.Split(':')[2] != "" ? key.Split(':')[2] + " team" : cat + " team")} · {cat}"
                : $"District {dnum} · {cat}";
            outRows.Add((Convert.ToInt32((object)x.catSort), cat, once ? 0 : did, once ? null : dnum,
                district ? "District Governor" : ((x.title as string) ?? ""),
                $"{(district ? dg : fromName)} → {group}", (string)x.msg, ZoneTime.Print(raw, "dd MMM yyyy, hh:mm tt", ViewerZone.Current), raw, fromName));
        }
        return outRows;
    }

    // Red dot: any group of mine with a message from someone else I have not opened.
    private async Task<bool> HasUnreadGroupAsync(MySqlConnection conn, int viewer, int zoneId, int yearId)
    {
        await EnsureGroupTablesAsync(conn);
        var any = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM goal_group_messages WHERE fk_zone_id = @Z AND fk_year_id = @Y AND isdeleted = 0 AND SenderMemberId <> @M",
            new { Z = zoneId, Y = yearId, M = viewer });
        if (any == 0) return false;
        var (_, groups, _) = await ViewerGroupsAsync(conn, viewer, zoneId, yearId);
        var keys = groups.Where(g => g.Kind != "Broadcast").Select(g => g.Key).ToHashSet();
        var reads = await GroupReadsAsync(conn, viewer, zoneId, yearId);
        var latest = await conn.QueryAsync<(string, long)>(@"
            SELECT GroupKey, MAX(pk_id) FROM goal_group_messages
            WHERE fk_zone_id = @Z AND fk_year_id = @Y AND isdeleted = 0 AND SenderMemberId <> @M GROUP BY GroupKey",
            new { Z = zoneId, Y = yearId, M = viewer });
        return latest.Any(x => keys.Contains(x.Item1) && x.Item2 > reads.GetValueOrDefault(x.Item1));
    }

    public async Task<bool> HasUnreadGoalGroupsAsync(int viewer, int zoneId, int districtId, int yearId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        zoneId = await GroupZoneAsync(conn, zoneId, districtId);
        return zoneId > 0 && yearId > 0 && await HasUnreadGroupAsync(conn, viewer, zoneId, yearId);
    }
}
