using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

// ── One window per person (user 2026-10-16) ───────────────────────────────────────────────────
// The earlier message boxes are merged into the one-to-one chat with the person they were between,
// so a person shows ONCE and everything with them reads in one window (older ones under an
// "Earlier messages" line, read only):
//   * a ZC / DA seat thread (owner ↔ RI Director)   → RI Director's chat with the owner, and the
//                                                     owner's chat with the zone's RI Director
//   * a District Admin / DG message "to the chain"  → the writer's chat with each reader allowed to
//                                                     read it (their DA, the ZC of that category, the RI Director)
// A SuperAdmin gets NONE of these (user: strict privacy) - only their own chats.
public partial class GoalSettingService
{
    private sealed class EarlierRow
    {
        public long Id { get; set; }
        public int SenderId { get; set; }
        public string SenderName { get; set; } = "";
        public string? RoleTitle { get; set; }
        public int Tier { get; set; }
        public string Text { get; set; } = "";
        public DateTime Created { get; set; }
        public int DistrictId { get; set; }
        public string? DistrictNumber { get; set; }
        public string? CategoryName { get; set; }
        public int CategoryId { get; set; }
        public int ThreadOwner { get; set; }
        public long Unread { get; set; }
        public string? Title;           // filled in C#
    }

    private const string EarlierCols = @"
        SELECT c.pk_id AS Id, c.PostedByMemberId AS SenderId, COALESCE(m.MemberName,'') AS SenderName,
               NULLIF(TRIM(ra.RoleTitle),'') AS RoleTitle, c.PostedByTier AS Tier, c.CommentText AS Text,
               c.created_date AS Created, c.fk_district_id AS DistrictId, dm.DistrictNumber,
               IF(cat.Name = 'TRF', 'Foundation', cat.Name) AS CategoryName, c.fk_category_id AS CategoryId,
               c.ThreadOwnerMemberId AS ThreadOwner,
               (c.PostedByMemberId <> @V AND (s.last_seen_date IS NULL OR c.created_date > s.last_seen_date)) AS Unread
        FROM goal_comments c
        LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = c.PostedByMemberId
        LEFT JOIN goal_role_assignments ra ON ra.pk_id = c.fk_assignment_id AND c.fk_assignment_id > 0
        LEFT JOIN district_master dm ON dm.pk_district_id = c.fk_district_id
        LEFT JOIN goal_categories cat ON cat.pk_category_id = c.fk_category_id
        LEFT JOIN goal_message_thread_seen s ON s.fk_member_id = @V AND s.ThreadOwnerMemberId = c.ThreadOwnerMemberId
              AND s.fk_category_id = c.fk_category_id AND s.fk_year_id = c.fk_year_id";

    // Every earlier message the viewer took part in, with the person it was between (Other).
    private async Task<List<(int Other, EarlierRow R)>> EarlierForViewerAsync(MySqlConnection conn, int viewer, int zoneId, int yearId, List<ZoneSeat> seats)
    {
        var outList = new List<(int, EarlierRow)>();
        var mine = seats.Where(s => s.MemberId == viewer).ToList();
        if (mine.Count == 0 || mine.Any(s => s.Kind == KindSa)) return outList;   // SuperAdmin: own chats only
        bool isRi = mine.Any(s => s.Kind == KindRi);
        bool isOwner = mine.Any(s => s.Kind is KindZc or KindDa);
        bool isDistrict = mine.Any(s => s.Kind is KindDadm or KindDg);
        var p = new { V = viewer, Viewer = viewer, Z = zoneId, Y = yearId };
        // Hidden district (inactive district / zone, user 2026-10-21) → its messages drop too.
        string Base = $" WHERE c.fk_zone_id = @Z AND c.fk_year_id = @Y AND c.isdeleted = 0 AND {HierarchyScopeSql.DistrictIdLive("c.fk_district_id")}";

        string SeatTitle(EarlierRow r) => r.RoleTitle ?? TierRoleLabel(r.Tier);
        string DistrictTitle(EarlierRow r) =>
            seats.Any(s => s.MemberId == r.SenderId && s.Kind == KindDg && s.Districts.ContainsKey(r.DistrictId)) ? "District Governor" : "District Admin";

        if (isRi)   // every ZC / DA box of the zone → my chat with its owner
            foreach (var r in await conn.QueryAsync<EarlierRow>(EarlierCols + Base +
                         " AND c.ThreadOwnerMemberId > 0 AND c.ThreadOwnerMemberId <> @V", p))
            { r.Title = SeatTitle(r); outList.Add((r.ThreadOwner, r)); }

        if (isOwner)   // my own box → my chat with the zone's RI Director
        {
            var ri = await ResolveRiDirectorForZoneAsync(conn, zoneId);
            if (ri != null && ri.Value != viewer)
                foreach (var r in await conn.QueryAsync<EarlierRow>(EarlierCols + Base + " AND c.ThreadOwnerMemberId = @V", p))
                { r.Title = SeatTitle(r); outList.Add((ri.Value, r)); }
        }

        if (isRi || isOwner)   // District Admin / DG messages I may read → my chat with the writer
            foreach (var r in await conn.QueryAsync<EarlierRow>(EarlierCols + Base +
                         $" AND c.PostedByMemberId <> @V AND {DistrictSideFilter(false)}", p))
            { r.Title = DistrictTitle(r); outList.Add((r.SenderId, r)); }

        if (isDistrict)   // what I sent "to the chain" → my chat with each person who could read it
        {
            var zcCats = (await conn.QueryAsync<(int M, int C)>(@"
                SELECT fk_member_id, fk_category_id FROM goal_role_assignments
                WHERE RoleType='AllDistrictsOneCategoryOneZone' AND IsActive=1 AND isdeleted=0 AND fk_zone_id=@Z AND fk_category_id IS NOT NULL",
                new { Z = zoneId })).ToList();
            // A DG reads every Admin's messages of their district (user 2026-10-16); an Admin their own.
            var dgKeys = mine.Where(s => s.Kind == KindDg).SelectMany(s => s.Districts.Keys).Select(d => -d).ToList();
            if (dgKeys.Count == 0) dgKeys.Add(0);
            var sent = await conn.QueryAsync<EarlierRow>(EarlierCols + Base +
                $" AND (c.PostedByMemberId = @V OR c.ThreadOwnerMemberId IN @DgKeys) AND c.PostedByTier = {DistrictSideTier} AND c.ThreadOwnerMemberId < 0",
                new { V = viewer, Viewer = viewer, Z = zoneId, Y = yearId, DgKeys = dgKeys });
            foreach (var r in sent)
            {
                r.Title = DistrictTitle(r); r.Unread = 0;
                foreach (var reader in seats.Where(s => s.MemberId != viewer).GroupBy(s => s.MemberId))
                {
                    bool reads = reader.Any(s => s.Kind == KindRi
                        || (s.Kind == KindDa && s.Districts.ContainsKey(r.DistrictId))
                        || (s.Kind == KindZc && zcCats.Any(z => z.M == s.MemberId && z.C == r.CategoryId)));
                    if (reads) outList.Add((reader.Key, r));
                }
            }
        }
        // A message once per person.
        return outList.GroupBy(x => (x.Item1, x.Item2.Id)).Select(g => g.First()).ToList();
    }

    private static GoalCommentDto EarlierToDto(EarlierRow r, int viewer) => new()
    {
        Id = -r.Id,   // negative: never clashes with a one-to-one message id on screen
        CommentText = r.Text, PostedByMemberId = r.SenderId, PostedByName = r.SenderName, PostedByTier = r.Tier,
        PostedByRoleLabel = r.Title, IsMine = r.SenderId == viewer, CreatedDate = ZoneTime.Print(r.Created, "yyyy-MM-dd HH:mm", ViewerZone.Current),
        DistrictId = r.DistrictId, DistrictNumber = r.DistrictId > 0 ? r.DistrictNumber : null, CategoryName = r.CategoryName,
        IsEarlier = true,
    };

    // Opening the person's window marks the merged earlier messages read too (same markers as before).
    private static async Task MarkEarlierSeenAsync(MySqlConnection conn, int viewer, int yearId, IEnumerable<EarlierRow> rows)
    {
        foreach (var k in rows.Where(r => r.Unread != 0).Select(r => (r.ThreadOwner, r.CategoryId)).Distinct())
        {
            if (k.ThreadOwner > 0) await MarkThreadSeenAsync(conn, viewer, k.ThreadOwner, k.CategoryId, yearId);
            else await MarkDistrictSideSeenAsync(conn, viewer, -k.ThreadOwner, k.CategoryId, yearId);
        }
    }
}
