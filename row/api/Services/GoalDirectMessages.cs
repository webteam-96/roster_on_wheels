using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

// ── One-to-one goal messages (user 2026-10-16) ─────────────────────────────────────────────────
// Chat-style PRIVATE chats between two people of a zone - only those two ever see a chat.
// Who may chat with whom (both directions, either side may start):
//   RI Director        ↔ Zone Co-ordinator, District Assistant, District Admin, District Governor
//   Zone Co-ordinator  ↔ District Assistant, District Admin, District Governor (whole zone)
//   District Assistant ↔ District Admin / District Governor of THEIR assigned districts only
// Everyone you may talk to is listed even before a message exists (the contact list). The older
// seat threads + district-side messages stay readable as before; new messages live here.
public partial class GoalSettingService
{
    private const string KindRi = "RIDirector", KindZc = "ZoneCoordinator", KindDa = "DistrictAssistant",
                         KindDg = "DistrictGovernor", KindDadm = "DistrictAdmin", KindSa = "SuperAdmin";

    private sealed class ZoneSeat
    {
        public int MemberId; public string Kind = ""; public string Title = "";
        public Dictionary<int, string> Districts = new();   // district id -> number (DA / District Admin / DG)
    }

    private static int KindRank(string k) => k switch { KindSa => 6, KindRi => 5, KindZc => 4, KindDa => 3, KindDg => 2, _ => 1 };

    // May a person in seat `a` chat with a person in seat `b`? Symmetric.
    private static bool PairAllowed(ZoneSeat a, ZoneSeat b)
    {
        if (a.MemberId == b.MemberId) return false;
        bool IsDistrictSide(ZoneSeat s) => s.Kind is KindDadm or KindDg;
        (ZoneSeat hi, ZoneSeat lo) = KindRank(a.Kind) >= KindRank(b.Kind) ? (a, b) : (b, a);
        return hi.Kind switch
        {
            // SuperAdmin (user 2026-10-16) may chat with anyone of the zone, and they may reply. The chat
            // is still private to the two people - a SuperAdmin never reads other people's chats.
            KindSa => true,
            KindRi => lo.Kind is KindZc or KindDa or KindDg or KindDadm,
            KindZc => lo.Kind is KindDa or KindDg or KindDadm,
            KindDa => IsDistrictSide(lo) && hi.Districts.Keys.Any(lo.Districts.ContainsKey),
            _ => false,
        };
    }

    private static volatile bool _directTableReady;
    private static async Task EnsureDirectTableAsync(MySqlConnection conn)
    {
        if (_directTableReady) return;
        await conn.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS goal_direct_messages (
                pk_id BIGINT AUTO_INCREMENT PRIMARY KEY,
                fk_year_id INT NOT NULL,
                fk_zone_id INT NOT NULL DEFAULT 0,
                SenderMemberId INT NOT NULL,
                SenderKind VARCHAR(30) NOT NULL,
                SenderTitle VARCHAR(200) NULL,
                ReceiverMemberId INT NOT NULL,
                fk_category_id INT NOT NULL,
                fk_district_id INT NOT NULL DEFAULT 0,
                CommentText TEXT NOT NULL,
                created_date DATETIME NOT NULL,
                read_date DATETIME NULL,
                isdeleted TINYINT(1) NOT NULL DEFAULT 0,
                KEY ix_gdm_pair (SenderMemberId, ReceiverMemberId, fk_year_id),
                KEY ix_gdm_recv (ReceiverMemberId, fk_year_id, read_date)
            )");
        // District chats (user 2026-10-16): the higher levels see ONE chat per district, under the DG's
        // name; ChatDistrictId ties every message of that chat together, whichever admin wrote it.
        var hasCol = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'goal_direct_messages' AND COLUMN_NAME = 'ChatDistrictId'");
        if (hasCol == 0)
            await conn.ExecuteAsync("ALTER TABLE goal_direct_messages ADD COLUMN ChatDistrictId INT NOT NULL DEFAULT 0 AFTER fk_district_id");
        _directTableReady = true;
    }

    private static async Task<int> ResolveDirectZoneAsync(MySqlConnection conn, int zoneId, int contextDistrictId)
        => zoneId > 0 ? zoneId : (contextDistrictId > 0 ? await DistrictZoneIdAsync(conn, contextDistrictId) ?? 0 : 0);

    // Every seat-holder of the zone: RI Directors, Zone Co-ordinators, District Assistants (their
    // districts), District Admins and this year's District Governors of the zone's districts.
    private static async Task<List<ZoneSeat>> LoadZoneSeatsAsync(MySqlConnection conn, int zoneId, int yearId)
    {
        var seats = new List<ZoneSeat>();
        foreach (var r in await conn.QueryAsync<dynamic>(@"
            SELECT DISTINCT a.fk_member_id AS m FROM goal_role_assignments a
            JOIN goal_role_assignment_zones z ON z.fk_assignment_id = a.pk_id
            WHERE a.RoleType='AllCategoryAllDistrictsFewZones' AND a.IsActive=1 AND a.isdeleted=0
              AND a.fk_member_id > 0 AND z.fk_zone_id=@Z", new { Z = zoneId }))
            seats.Add(new ZoneSeat { MemberId = Convert.ToInt32(r.m), Kind = KindRi, Title = "RI Director" });

        foreach (var r in await conn.QueryAsync<dynamic>(@"
            SELECT a.fk_member_id AS m, MAX(NULLIF(TRIM(a.RoleTitle),'')) AS t FROM goal_role_assignments a
            WHERE a.RoleType='AllDistrictsOneCategoryOneZone' AND a.IsActive=1 AND a.isdeleted=0
              AND a.fk_member_id > 0 AND a.fk_zone_id=@Z
            GROUP BY a.fk_member_id", new { Z = zoneId }))
            seats.Add(new ZoneSeat { MemberId = Convert.ToInt32(r.m), Kind = KindZc, Title = (r.t as string) ?? "Zone Co-ordinator" });

        var das = new Dictionary<int, ZoneSeat>();
        foreach (var r in await conn.QueryAsync<dynamic>($@"
            SELECT a.fk_member_id AS m, NULLIF(TRIM(a.RoleTitle),'') AS t, dm.pk_district_id AS d, dm.DistrictNumber AS n
            FROM goal_role_assignments a
            JOIN goal_role_assignment_districts ad ON ad.fk_assignment_id = a.pk_id
            JOIN district_master dm ON dm.pk_district_id = ad.fk_district_id AND dm.isdeleted = 0 AND {HierarchyScopeSql.DistrictLive("dm")}
            WHERE a.RoleType='FewDistrictsOneCategoryOneZone' AND a.IsActive=1 AND a.isdeleted=0
              AND a.fk_member_id > 0 AND a.fk_zone_id=@Z", new { Z = zoneId }))
        {
            int m = Convert.ToInt32(r.m);
            if (!das.TryGetValue(m, out var s)) das[m] = s = new ZoneSeat { MemberId = m, Kind = KindDa, Title = (r.t as string) ?? "District Assistant" };
            s.Districts[Convert.ToInt32(r.d)] = (string)r.n;
        }
        seats.AddRange(das.Values);

        var dgs = new Dictionary<int, ZoneSeat>();
        foreach (var r in await conn.QueryAsync<dynamic>($@"
            SELECT g.fk_member_id AS m, dm.pk_district_id AS d, dm.DistrictNumber AS n
            FROM district_governors g
            JOIN district_master dm ON dm.pk_district_id = g.fk_district_id AND dm.isdeleted = 0 AND dm.fk_zone_id = @Z AND {HierarchyScopeSql.DistrictLive("dm")}
            WHERE g.fk_year_id = @Y AND COALESCE(g.isdeleted,0) = 0 AND g.fk_member_id > 0", new { Z = zoneId, Y = yearId }))
        {
            int m = Convert.ToInt32(r.m);
            if (!dgs.TryGetValue(m, out var s)) dgs[m] = s = new ZoneSeat { MemberId = m, Kind = KindDg, Title = "District Governor" };
            s.Districts[Convert.ToInt32(r.d)] = (string)r.n;
        }
        seats.AddRange(dgs.Values);

        var admins = new Dictionary<int, ZoneSeat>();
        foreach (var r in await conn.QueryAsync<dynamic>($@"
            SELECT r.fk_member_master_profile_id AS m, dm.pk_district_id AS d, dm.DistrictNumber AS n
            FROM member_roles r
            JOIN district_master dm ON dm.pk_district_id = r.fk_district_id AND dm.isdeleted = 0 AND dm.fk_zone_id = @Z AND {HierarchyScopeSql.DistrictLive("dm")}
            WHERE r.fk_role_id = 2 AND r.IsActive = 1 AND r.isdeleted = 0 AND COALESCE(r.fk_club_id,0) = 0
              AND r.fk_member_master_profile_id > 0", new { Z = zoneId }))
        {
            int m = Convert.ToInt32(r.m);
            if (!admins.TryGetValue(m, out var s)) admins[m] = s = new ZoneSeat { MemberId = m, Kind = KindDadm, Title = "District Admin" };
            s.Districts[Convert.ToInt32(r.d)] = (string)r.n;
        }
        seats.AddRange(admins.Values);
        return seats;
    }

    // A SuperAdmin takes part in chats too (user 2026-10-16): added as a seat for the zone when they are
    // the viewer or the other person of a chat. Never listed to others until they have chatted.
    private static async Task AddSuperAdminSeatsAsync(MySqlConnection conn, List<ZoneSeat> seats, IEnumerable<int> ids)
    {
        foreach (var id in ids.Where(i => i > 0).Distinct().ToList())
            if (!seats.Any(s => s.MemberId == id && s.Kind == KindSa) && await ClubAdminAccessHelper.IsSuperAdminAsync(conn, id))
                seats.Add(new ZoneSeat { MemberId = id, Kind = KindSa, Title = "Super Admin" });
    }

    // The seats of the viewer and the other person that make the chat allowed (highest viewer seat first).
    private static (ZoneSeat Mine, ZoneSeat Theirs)? AllowedPair(List<ZoneSeat> seats, int viewer, int other)
    {
        var mine = seats.Where(s => s.MemberId == viewer).OrderByDescending(s => KindRank(s.Kind)).ToList();
        var theirs = seats.Where(s => s.MemberId == other).OrderByDescending(s => KindRank(s.Kind)).ToList();
        foreach (var a in mine)
            foreach (var b in theirs)
                if (PairAllowed(a, b)) return (a, b);
        return null;
    }

    private static string? DistrictText(ZoneSeat s)
        => s.Districts.Count == 0 ? null : string.Join(", ", s.Districts.Values.OrderBy(v => v, StringComparer.Ordinal));

    private sealed class DirectRow
    {
        public long Id { get; set; }
        public int SenderMemberId { get; set; }
        public int ReceiverMemberId { get; set; }
        public string SenderKind { get; set; } = "";
        public string? SenderTitle { get; set; }
        public string SenderName { get; set; } = "";
        public string Text { get; set; } = "";
        public DateTime Created { get; set; }
        public DateTime? ReadDate { get; set; }
        public int DistrictId { get; set; }
        public string? DistrictNumber { get; set; }
        public string? CategoryName { get; set; }
        public int ZoneId { get; set; }
        public int ChatDistrictId { get; set; }
    }

    private const string DirectSelect = @"
        SELECT d.pk_id AS Id, d.SenderMemberId, d.ReceiverMemberId, d.SenderKind, d.SenderTitle, COALESCE(m.MemberName,'') AS SenderName,
               d.CommentText AS Text, d.created_date AS Created, d.read_date AS ReadDate,
               d.fk_district_id AS DistrictId, dm.DistrictNumber, IF(c.Name = 'TRF', 'Foundation', c.Name) AS CategoryName,
               d.fk_zone_id AS ZoneId, d.ChatDistrictId
        FROM goal_direct_messages d
        LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = d.SenderMemberId
        LEFT JOIN district_master dm ON dm.pk_district_id = d.fk_district_id
        LEFT JOIN goal_categories c ON c.pk_category_id = d.fk_category_id";

    private static GoalCommentDto ToDto(DirectRow r, int viewer) => new()
    {
        Id = r.Id, CommentText = r.Text, PostedByMemberId = r.SenderMemberId, PostedByName = r.SenderName,
        PostedByRoleLabel = r.SenderTitle, IsMine = r.SenderMemberId == viewer,
        CreatedDate = ZoneTime.Print(r.Created, "yyyy-MM-dd HH:mm", ViewerZone.Current),
        DistrictId = r.DistrictId, DistrictNumber = r.DistrictId > 0 ? r.DistrictNumber : null, CategoryName = r.CategoryName,
    };

    // ── District chats (user 2026-10-16) ─────────────────────────────────────────────────────────
    // A district can have several District Admins plus the DG. Seen from ABOVE (RI Director, ZC, DA,
    // SuperAdmin) a district is ONE contact - the DG's name, "District 3142 · No DG" without one - and
    // every Admin's message shows under the DG's name. The real writer is always stored and is shown
    // to SuperAdmin ("entered by") and in the Excel report. A reply from above goes to the DG and only
    // the Admin who wrote last; the DG reads the whole district chat, each Admin only their own part.
    private static bool IsDistrictKind(string k) => k is KindDadm or KindDg;

    private static bool IsDistrictSide(List<ZoneSeat> seats, int memberId)
    {
        var mine = seats.Where(s => s.MemberId == memberId).ToList();
        return mine.Count > 0 && mine.All(s => IsDistrictKind(s.Kind));
    }

    // The district a District Admin / DG writes for: the screen's district when given, else their first.
    private static int DistrictOfMember(List<ZoneSeat> seats, int memberId, int contextDistrictId)
    {
        var ds = seats.Where(s => s.MemberId == memberId && IsDistrictKind(s.Kind)).SelectMany(s => s.Districts.Keys).Distinct().ToList();
        if (contextDistrictId > 0 && ds.Contains(contextDistrictId)) return contextDistrictId;
        return ds.Count > 0 ? ds.Min() : 0;
    }

    private static ZoneSeat? DgOf(List<ZoneSeat> seats, int districtId)
        => seats.FirstOrDefault(s => s.Kind == KindDg && s.Districts.ContainsKey(districtId));

    private static List<int> DistrictPeople(List<ZoneSeat> seats, int districtId)
        => seats.Where(s => IsDistrictKind(s.Kind) && s.Districts.ContainsKey(districtId)).Select(s => s.MemberId).Distinct().ToList();

    // May the viewer (from above) chat with district D - i.e. with any of its Admins / DG?
    private static bool CanReachDistrict(List<ZoneSeat> seats, int viewer, int districtId)
        => DistrictPeople(seats, districtId).Where(m => m != viewer).Any(m => AllowedPair(seats, viewer, m) != null);

    private static string DistrictNumberOf(List<ZoneSeat> seats, int districtId)
        => seats.SelectMany(s => s.Districts).FirstOrDefault(d => d.Key == districtId).Value ?? districtId.ToString();

    // Which chat a row belongs to for this viewer: the person above for a District Admin / DG; for
    // everyone else -districtId for a district chat, otherwise the other person.
    private static int ChatKeyFor(DirectRow r, int viewer, bool viewerIsDistrictSide, List<ZoneSeat> seats)
    {
        if (viewerIsDistrictSide) return IsDistrictKind(r.SenderKind) ? r.ReceiverMemberId : r.SenderMemberId;
        int other = r.SenderMemberId == viewer ? r.ReceiverMemberId : r.SenderMemberId;
        int d = r.ChatDistrictId;
        if (d == 0 && IsDistrictSide(seats, other)) d = DistrictOfMember(seats, other, 0);   // rows from before ChatDistrictId
        return d > 0 ? -d : other;
    }

    // A reply to a district is stored once per receiver (DG + the writer); show it once. The row
    // addressed to me wins, so its read marker still counts.
    private static List<DirectRow> OncePerMessage(IEnumerable<DirectRow> rows, int viewer)
        => rows.GroupBy(r => (r.SenderMemberId, r.Text, r.ChatDistrictId, r.Created.AddTicks(-(r.Created.Ticks % TimeSpan.TicksPerMinute))))
               .Select(g => g.FirstOrDefault(x => x.ReceiverMemberId == viewer) ?? g.First())
               .OrderBy(r => r.Created).ThenBy(r => r.Id).ToList();

    private sealed class ChatView
    {
        public List<ZoneSeat> Seats = new();
        public bool ViewerIsDistrictSide;
        public bool ViewerIsSa;
        public Dictionary<int, string> Names = new();
    }

    private static async Task LoadNamesAsync(MySqlConnection conn, Dictionary<int, string> names, IEnumerable<int> ids)
    {
        var want = ids.Where(id => id > 0 && !names.ContainsKey(id)).Distinct().ToList();
        if (want.Count == 0) return;
        foreach (var r in await conn.QueryAsync<dynamic>(
            "SELECT pk_member_master_profile_id AS id, COALESCE(MemberName,'') AS n FROM member_master_profile WHERE pk_member_master_profile_id IN @Ids",
            new { Ids = want }))
            names[Convert.ToInt32(r.id)] = (string)r.n;
    }

    // Seen from above, a district-side writer shows as the district's DG (SuperAdmin also sees who typed it).
    private static void AsDistrict(GoalCommentDto dto, int districtId, string realName, ChatView v)
    {
        var dg = DgOf(v.Seats, districtId);
        dto.PostedByName = dg != null && v.Names.TryGetValue(dg.MemberId, out var n) ? n : $"District {DistrictNumberOf(v.Seats, districtId)}";
        dto.PostedByRoleLabel = dg != null ? "District Governor" : "No DG";
        dto.EnteredByName = v.ViewerIsSa ? realName : null;
    }

    private static GoalCommentDto ShowDirect(DirectRow r, int viewer, ChatView v)
    {
        var dto = ToDto(r, viewer);
        if (!v.ViewerIsDistrictSide && IsDistrictKind(r.SenderKind) && r.SenderMemberId != viewer)
        {
            int d = r.ChatDistrictId > 0 ? r.ChatDistrictId : DistrictOfMember(v.Seats, r.SenderMemberId, 0);
            if (d > 0) AsDistrict(dto, d, r.SenderName, v);
        }
        return dto;
    }

    private static GoalCommentDto ShowEarlier(EarlierRow r, int viewer, ChatView v)
    {
        var dto = EarlierToDto(r, viewer);
        if (!v.ViewerIsDistrictSide && r.ThreadOwner < 0 && r.SenderId != viewer) AsDistrict(dto, -r.ThreadOwner, r.SenderName, v);
        return dto;
    }

    private async Task<ChatView> LoadChatViewAsync(MySqlConnection conn, int memberId, int zoneId, int yearId, IEnumerable<int> alsoSa)
    {
        var v = new ChatView { Seats = await LoadZoneSeatsAsync(conn, zoneId, yearId) };
        await AddSuperAdminSeatsAsync(conn, v.Seats, alsoSa.Append(memberId));
        v.ViewerIsDistrictSide = IsDistrictSide(v.Seats, memberId);
        v.ViewerIsSa = v.Seats.Any(s => s.MemberId == memberId && s.Kind == KindSa);
        await LoadNamesAsync(conn, v.Names, v.Seats.Select(s => s.MemberId));
        return v;
    }

    // My rows of the year in the zone; a DG also reads the whole chat of their district.
    private static async Task<List<DirectRow>> MyDirectRowsAsync(MySqlConnection conn, int memberId, int zoneId, int yearId, List<ZoneSeat> seats)
    {
        var dgDistricts = seats.Where(s => s.MemberId == memberId && s.Kind == KindDg).SelectMany(s => s.Districts.Keys).Distinct().ToList();
        if (dgDistricts.Count == 0) dgDistricts.Add(-1);
        return (await conn.QueryAsync<DirectRow>(DirectSelect + $@"
            WHERE d.isdeleted = 0 AND d.fk_year_id = @Y AND d.fk_zone_id = @Z
              AND {HierarchyScopeSql.DistrictIdLive("d.fk_district_id")} AND {HierarchyScopeSql.DistrictIdLive("d.ChatDistrictId")}
              AND (d.SenderMemberId = @M OR d.ReceiverMemberId = @M OR d.ChatDistrictId IN @Dg)
            ORDER BY d.created_date, d.pk_id", new { Y = yearId, Z = zoneId, M = memberId, Dg = dgDistricts })).ToList();
    }

    public async Task<List<GoalDirectContactDto>> GetDirectContactsAsync(int memberId, int zoneId, int contextDistrictId, int yearId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        await EnsureDirectTableAsync(conn);
        zoneId = await ResolveDirectZoneAsync(conn, zoneId, contextDistrictId);
        var result = new List<GoalDirectContactDto>();
        if (zoneId <= 0 || yearId <= 0) return result;

        var seats0 = await LoadZoneSeatsAsync(conn, zoneId, yearId);
        var msgs = await MyDirectRowsAsync(conn, memberId, zoneId, yearId, seats0);
        // SuperAdmins: me (contacts = everyone of the zone) and anyone who chatted with me (I can reply).
        var v = await LoadChatViewAsync(conn, memberId, zoneId, yearId, msgs.SelectMany(x => new[] { x.SenderMemberId, x.ReceiverMemberId }));
        var seats = v.Seats;
        var byKey = msgs.GroupBy(x => ChatKeyFor(x, memberId, v.ViewerIsDistrictSide, seats))
                        .ToDictionary(g => g.Key, g => OncePerMessage(g, memberId));

        // Earlier message boxes, merged per chat (one window per person / district).
        var earlier = await EarlierForViewerAsync(conn, memberId, zoneId, yearId, seats);
        var earlierByKey = earlier
            .GroupBy(x => !v.ViewerIsDistrictSide && x.R.ThreadOwner < 0 ? x.R.ThreadOwner : x.Other)
            .ToDictionary(g => g.Key, g => g.Select(x => x.R).ToList());
        await LoadNamesAsync(conn, v.Names, byKey.Keys.Concat(earlierByKey.Keys));

        GoalDirectContactDto Summary(int key, GoalDirectContactDto dto)
        {
            byKey.TryGetValue(key, out var conv);
            earlierByKey.TryGetValue(key, out var old);
            var lastNew = conv?.LastOrDefault();
            var lastOld = old?.OrderBy(x => x.Created).LastOrDefault();
            bool newIsLast = lastNew != null && (lastOld == null || lastNew.Created >= lastOld.Created);
            dto.MessageCount = (conv?.Count ?? 0) + (old?.Count ?? 0);
            dto.UnreadCount = (conv?.Count(x => x.ReceiverMemberId == memberId && x.ReadDate == null) ?? 0) + (old?.Count(x => x.Unread != 0) ?? 0);
            dto.LastMessagePreview = newIsLast ? lastNew!.Text : lastOld?.Text;
            dto.LastMessageDate = (newIsLast ? lastNew!.Created : lastOld?.Created) is DateTime ld ? ZoneTime.Print(ld, "yyyy-MM-dd HH:mm", ViewerZone.Current) : null;
            return dto;
        }
        string NameOf(int id) => v.Names.TryGetValue(id, out var n) ? n : "";
        GoalDirectContactDto DistrictContact(int d, bool canMessage)
        {
            var dg = DgOf(seats, d);
            var num = DistrictNumberOf(seats, d);
            return new GoalDirectContactDto
            {
                MemberId = -d, Name = dg != null ? NameOf(dg.MemberId) : $"District {num}",
                RoleLabel = dg != null ? "District Governor" : "No DG", RoleKind = "District", Districts = num, CanMessage = canMessage,
            };
        }

        foreach (var other in seats.Select(s => s.MemberId).Where(id => id != memberId).Distinct())
        {
            if (!v.ViewerIsDistrictSide && IsDistrictSide(seats, other)) continue;   // shown once per district below
            var pair = AllowedPair(seats, memberId, other);
            if (pair == null) continue;
            var theirs = pair.Value.Theirs;
            result.Add(Summary(other, new GoalDirectContactDto
            {
                MemberId = other, Name = NameOf(other), RoleLabel = theirs.Title, RoleKind = theirs.Kind,
                Districts = DistrictText(theirs), CanMessage = true,
            }));
        }
        if (!v.ViewerIsDistrictSide)
            foreach (var d in seats.Where(s => IsDistrictKind(s.Kind)).SelectMany(s => s.Districts.Keys).Distinct())
                if (CanReachDistrict(seats, memberId, d)) result.Add(Summary(-d, DistrictContact(d, true)));

        // Chats with people / districts that are no longer contacts: history, read only.
        foreach (var key in byKey.Keys.Concat(earlierByKey.Keys).Distinct())
        {
            if (key == memberId || result.Any(x => x.MemberId == key)) continue;
            if (key < 0) { result.Add(Summary(key, DistrictContact(-key, false))); continue; }
            var title = byKey.TryGetValue(key, out var conv) ? conv.LastOrDefault(x => x.SenderMemberId == key)?.SenderTitle : null;
            title ??= earlierByKey.TryGetValue(key, out var old) ? old.LastOrDefault(x => x.SenderId == key)?.Title : null;
            result.Add(Summary(key, new GoalDirectContactDto
            {
                MemberId = key, Name = NameOf(key), RoleLabel = title != null ? $"Former {title}" : "Former contact",
                RoleKind = "", CanMessage = false,
            }));
        }
        return result;
    }

    // otherMemberId < 0 = a district chat (-districtId), seen from above.
    public async Task<GoalDirectConversationDto> GetDirectConversationAsync(int memberId, int otherMemberId, int zoneId, int contextDistrictId, int yearId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        await EnsureDirectTableAsync(conn);
        zoneId = await ResolveDirectZoneAsync(conn, zoneId, contextDistrictId);
        if (zoneId <= 0) throw new UnauthorizedAccessException("You cannot message this person.");
        var v = await LoadChatViewAsync(conn, memberId, zoneId, yearId, new[] { otherMemberId });
        var seats = v.Seats;

        var mineRows = await MyDirectRowsAsync(conn, memberId, zoneId, yearId, seats);
        var rows = OncePerMessage(mineRows.Where(r => ChatKeyFor(r, memberId, v.ViewerIsDistrictSide, seats) == otherMemberId), memberId);
        var old = (await EarlierForViewerAsync(conn, memberId, zoneId, yearId, seats))
            .Where(x => (!v.ViewerIsDistrictSide && x.R.ThreadOwner < 0 ? x.R.ThreadOwner : x.Other) == otherMemberId)
            .Select(x => x.R).ToList();

        bool isDistrictChat = otherMemberId < 0 && !v.ViewerIsDistrictSide;
        int chatDistrict = isDistrictChat ? -otherMemberId : 0;
        var pair = isDistrictChat ? null : AllowedPair(seats, memberId, otherMemberId);
        bool canPost = isDistrictChat ? CanReachDistrict(seats, memberId, chatDistrict) : pair != null;
        // Only the people in a chat ever read it: no seat pairing and no history → nothing.
        if (!canPost && rows.Count == 0 && old.Count == 0)
            throw new UnauthorizedAccessException("You cannot message this person.");

        // Opening the chat marks what was sent to me in it as read.
        var unreadIds = rows.Where(r => r.ReceiverMemberId == memberId && r.ReadDate == null).Select(r => r.Id).ToList();
        if (unreadIds.Count > 0)
            await conn.ExecuteAsync("UPDATE goal_direct_messages SET read_date = NOW() WHERE pk_id IN @Ids", new { Ids = unreadIds });
        await MarkEarlierSeenAsync(conn, memberId, yearId, old);
        await LoadNamesAsync(conn, v.Names, rows.Select(r => r.SenderMemberId).Append(otherMemberId));

        var dto = new GoalDirectConversationDto
        {
            OtherMemberId = otherMemberId, CanPost = canPost,
            Messages = old.Select(r => ShowEarlier(r, memberId, v)).Concat(rows.Select(r => ShowDirect(r, memberId, v)))
                          .OrderBy(m => m.CreatedDate, StringComparer.Ordinal).ThenBy(m => m.IsEarlier ? 0 : 1).ToList(),
        };
        if (isDistrictChat)
        {
            var dg = DgOf(seats, chatDistrict);
            dto.OtherName = dg != null ? v.Names.GetValueOrDefault(dg.MemberId, "") : $"District {DistrictNumberOf(seats, chatDistrict)}";
            dto.OtherRoleLabel = dg != null ? "District Governor" : "No DG";
        }
        else
        {
            dto.OtherName = v.Names.TryGetValue(otherMemberId, out var n) ? n : await MemberNameAsync(conn, otherMemberId);
            dto.OtherRoleLabel = pair?.Theirs.Title ?? rows.LastOrDefault(x => x.SenderMemberId == otherMemberId)?.SenderTitle ?? "";
            // A District Admin / DG writes about their own district - no district picker.
            if (pair != null && !v.ViewerIsDistrictSide) dto.Districts = TagDistricts(pair.Value.Mine, pair.Value.Theirs);
        }
        return dto;
    }

    // Districts a message in this chat may be about: the overlap when both sides are district-bound,
    // otherwise whichever side has districts (an RI Director / ZC writing to a DA).
    private static List<GoalMessageDistrictDto> TagDistricts(ZoneSeat mine, ZoneSeat theirs)
    {
        IEnumerable<KeyValuePair<int, string>> pick =
            mine.Districts.Count > 0 && theirs.Districts.Count > 0 ? mine.Districts.Where(d => theirs.Districts.ContainsKey(d.Key))
            : mine.Districts.Count > 0 ? mine.Districts : theirs.Districts;
        return pick.OrderBy(d => d.Value, StringComparer.Ordinal).Select(d => new GoalMessageDistrictDto { Id = d.Key, Number = d.Value }).ToList();
    }

    public async Task<GoalCommentDto> PostDirectMessageAsync(int memberId, int otherMemberId, int zoneId, int contextDistrictId, int yearId, PostGoalDirectMessageRequest req)
    {
        var text = (req.CommentText ?? "").Trim();
        if (text.Length == 0) throw new InvalidOperationException("Message cannot be empty.");
        if (text.Length > 4000) throw new InvalidOperationException("Message is too long (max 4000 characters).");
        using var conn = CreateConnection();
        await conn.OpenAsync();
        await EnsureDirectTableAsync(conn);
        zoneId = await ResolveDirectZoneAsync(conn, zoneId, contextDistrictId);
        if (zoneId <= 0 || yearId <= 0) throw new InvalidOperationException("Zone and year are required.");
        var v = await LoadChatViewAsync(conn, memberId, zoneId, yearId, new[] { otherMemberId });
        var seats = v.Seats;
        var catOk = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM goal_categories WHERE pk_category_id=@C AND isdeleted=0", new { C = req.CategoryId });
        if (catOk == 0) throw new InvalidOperationException("Pick the category this message is about.");

        // (receiver, my seat, district tag, chat district) for every row to write.
        var writes = new List<(int To, ZoneSeat Mine, int Tag, int Chat)>();
        if (otherMemberId < 0 && !v.ViewerIsDistrictSide)
        {
            // Reply to a district: the DG + only the Admin who wrote last (user 2026-10-16). Nobody wrote
            // yet → the DG; no DG → every Admin of the district.
            int d = -otherMemberId;
            if (!CanReachDistrict(seats, memberId, d)) throw new UnauthorizedAccessException("You cannot message this district.");
            var people = DistrictPeople(seats, d);
            var lastWriter = await conn.ExecuteScalarAsync<int?>(@"
                SELECT SenderMemberId FROM goal_direct_messages
                WHERE isdeleted = 0 AND fk_year_id = @Y AND ChatDistrictId = @D AND ReceiverMemberId = @M
                  AND SenderKind IN ('DistrictAdmin','DistrictGovernor')
                ORDER BY created_date DESC, pk_id DESC LIMIT 1", new { Y = yearId, D = d, M = memberId });
            var dg = DgOf(seats, d);
            var to = new List<int>();
            if (dg != null) to.Add(dg.MemberId);
            if (lastWriter.HasValue && people.Contains(lastWriter.Value)) to.Add(lastWriter.Value);
            if (to.Count == 0) to.AddRange(people);
            foreach (var t in to.Distinct().Where(t => t != memberId))
            {
                var p = AllowedPair(seats, memberId, t);
                if (p != null) writes.Add((t, p.Value.Mine, d, d));
            }
            if (writes.Count == 0) throw new UnauthorizedAccessException("You cannot message this district.");
        }
        else
        {
            var pair = AllowedPair(seats, memberId, otherMemberId)
                ?? throw new UnauthorizedAccessException("You cannot message this person.");
            if (v.ViewerIsDistrictSide)
            {
                int d = DistrictOfMember(seats, memberId, contextDistrictId);
                writes.Add((otherMemberId, pair.Mine, d, d));
            }
            else
            {
                int tag = req.DistrictId > 0 && TagDistricts(pair.Mine, pair.Theirs).Any(x => x.Id == req.DistrictId) ? req.DistrictId : 0;
                writes.Add((otherMemberId, pair.Mine, tag, 0));
            }
        }

        long firstId = 0;
        foreach (var w in writes)
        {
            var id = await conn.ExecuteScalarAsync<long>(@"
                INSERT INTO goal_direct_messages (fk_year_id, fk_zone_id, SenderMemberId, SenderKind, SenderTitle, ReceiverMemberId,
                                                  fk_category_id, fk_district_id, ChatDistrictId, CommentText, created_date, isdeleted)
                VALUES (@Y, @Z, @M, @K, @T, @O, @C, @D, @Chat, @Text, NOW(), 0); SELECT LAST_INSERT_ID();",
                new { Y = yearId, Z = zoneId, M = memberId, K = w.Mine.Kind, T = w.Mine.Title, O = w.To,
                      C = req.CategoryId, D = w.Tag, Chat = w.Chat, Text = text });
            if (firstId == 0) firstId = id;
        }
        var row = await conn.QueryFirstAsync<DirectRow>(DirectSelect + " WHERE d.pk_id = @Id", new { Id = firstId });
        return ToDto(row, memberId);
    }

    // Red dot: anything sent to me in this zone + year that I have not opened.
    private static async Task<bool> HasUnreadDirectAsync(MySqlConnection conn, int memberId, int zoneId, int yearId)
    {
        await EnsureDirectTableAsync(conn);
        return await conn.ExecuteScalarAsync<int>($@"
            SELECT COUNT(*) FROM goal_direct_messages
            WHERE ReceiverMemberId = @M AND fk_zone_id = @Z AND fk_year_id = @Y AND read_date IS NULL AND isdeleted = 0
              AND {HierarchyScopeSql.DistrictIdLive("goal_direct_messages.fk_district_id")} AND {HierarchyScopeSql.DistrictIdLive("goal_direct_messages.ChatDistrictId")}",
            new { M = memberId, Z = zoneId, Y = yearId }) > 0;
    }

    // Red dot for a District Admin / DG login (user 2026-10-16): any chat sent to me in my district's
    // zone that I have not opened. Zone-based logins use HasUnreadZoneMessagesAsync, which includes this.
    public async Task<bool> HasUnreadDirectAsync(int memberId, int zoneId, int contextDistrictId, int yearId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        zoneId = await ResolveDirectZoneAsync(conn, zoneId, contextDistrictId);
        // Group messages count too (user 2026-10-19).
        return zoneId > 0 && yearId > 0 && (await HasUnreadDirectAsync(conn, memberId, zoneId, yearId)
                                            || await HasUnreadGroupAsync(conn, memberId, zoneId, yearId));
    }

    // Excel messages report: the zone's one-to-one messages (RI Director / ZC / SuperAdmin download it).
    // A district chat message reads "From" = the DG (as the higher levels see it) and "Entered by" = the
    // Admin who really typed it (user 2026-10-16). A reply to a district is listed once.
    private static async Task<List<(int Sort, string Cat, int Did, string? Dnum, string Role, string From, string Msg, string Dt, DateTime Raw, string Entered)>>
        DirectReportRowsAsync(MySqlConnection conn, int zoneId, int yearId, int categoryId, int districtId)
    {
        await EnsureDirectTableAsync(conn);
        var rows = await conn.QueryAsync<dynamic>($@"
            SELECT IF(c.Name = 'TRF', 'Foundation', c.Name) AS catName, c.SortOrder AS catSort,
                   d.fk_district_id AS did, dm.DistrictNumber AS dnum, d.SenderTitle AS title, d.SenderKind AS kind,
                   d.SenderMemberId AS sid, d.ChatDistrictId AS chat, cdm.DistrictNumber AS chatNum,
                   COALESCE(s.MemberName,'') AS fromName, COALESCE(r.MemberName,'') AS toName,
                   (SELECT COALESCE(gm.MemberName,'') FROM district_governors g
                      JOIN member_master_profile gm ON gm.pk_member_master_profile_id = g.fk_member_id
                     WHERE g.fk_district_id = d.ChatDistrictId AND g.fk_year_id = d.fk_year_id AND COALESCE(g.isdeleted,0) = 0
                     LIMIT 1) AS dgName,
                   d.CommentText AS msg, d.created_date AS raw
            FROM goal_direct_messages d
            JOIN goal_categories c ON c.pk_category_id = d.fk_category_id AND c.isdeleted = 0
            LEFT JOIN member_master_profile s ON s.pk_member_master_profile_id = d.SenderMemberId
            LEFT JOIN member_master_profile r ON r.pk_member_master_profile_id = d.ReceiverMemberId
            LEFT JOIN district_master dm ON dm.pk_district_id = d.fk_district_id
            LEFT JOIN district_master cdm ON cdm.pk_district_id = d.ChatDistrictId
            WHERE d.isdeleted = 0 AND d.fk_zone_id = @Z AND d.fk_year_id = @Y
              AND {HierarchyScopeSql.DistrictIdLive("d.fk_district_id")} AND {HierarchyScopeSql.DistrictIdLive("d.ChatDistrictId")}
              AND (@Cat = 0 OR d.fk_category_id = @Cat) AND (@Did = 0 OR d.fk_district_id = @Did)
            ORDER BY d.created_date, d.pk_id",
            new { Z = zoneId, Y = yearId, Cat = categoryId, Did = districtId });
        var outRows = new List<(int Sort, string Cat, int Did, string? Dnum, string Role, string From, string Msg, string Dt, DateTime Raw, string Entered)>();
        var seen = new HashSet<(int, string, int, DateTime)>();
        foreach (var x in rows)
        {
            DateTime raw = (DateTime)x.raw;
            int sid = Convert.ToInt32(x.sid), chat = Convert.ToInt32(x.chat);
            string msg = (string)x.msg;
            var minute = raw.AddTicks(-(raw.Ticks % TimeSpan.TicksPerMinute));
            bool districtSender = IsDistrictKind((string)x.kind) && chat > 0;
            string districtLabel = (x.dgName as string) is { Length: > 0 } dg ? dg : $"District {(x.chatNum as string) ?? chat.ToString()} (No DG)";
            string to = (string)x.toName;
            if (!districtSender && chat > 0)
            {
                if (!seen.Add((sid, msg, chat, minute))) continue;            // one reply, several receivers
                to = districtLabel;
            }
            int did = x.did == null ? 0 : Convert.ToInt32(x.did);
            string fromName = (string)x.fromName;
            string from = $"{(districtSender ? districtLabel : fromName)} → {to}";
            outRows.Add((Convert.ToInt32(x.catSort), (string)x.catName, did, x.dnum as string,
                districtSender ? "District Governor" : ((x.title as string) ?? ""), from, msg,
                ZoneTime.Print(raw, "dd MMM yyyy, hh:mm tt", ViewerZone.Current), raw, fromName));
        }
        return outRows;
    }
}
