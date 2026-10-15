using System.Security.Claims;
using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

// Enforces the four contact-visibility flags on member_master_profile:
//   ShowPhoneInMyClub / ShowPhoneInAllClubs / ShowEmailInMyClub / ShowEmailInAllClubs
//
// They are GLOBAL per-member flags (one set per member, not per club):
//   • "MyClub"   → the viewer shares at least one active club with the row being displayed.
//   • "AllClubs" → everyone else. That single bucket deliberately also covers the district
//                  directory, cross-district Find-a-Rotarian search and the anonymous
//                  public club website.
//
// A member always sees their OWN phone/email regardless of their own toggles.
public static class MemberPrivacyHelper
{
    public sealed class Flags
    {
        public bool ShowPhoneInMyClub { get; init; } = true;
        public bool ShowPhoneInAllClubs { get; init; } = true;
        public bool ShowEmailInMyClub { get; init; } = true;
        public bool ShowEmailInAllClubs { get; init; } = true;
    }

    // Used when a member has no row / no flag data — matches the DB default (visible).
    public static readonly Flags VisibleFlags = new();

    // TINYINT(1) comes back as bool / byte / sbyte / int / ulong depending on connection
    // settings; Convert.ToBoolean handles all of them. NULL means "never set" → visible.
    public static bool ToFlag(object? raw) => raw == null || Convert.ToBoolean(raw);

    // The requesting member, or null for an anonymous / claimless caller.
    public static int? GetViewerMemberId(ClaimsPrincipal? user)
    {
        var raw = user?.FindFirst("memberId")?.Value;
        return int.TryParse(raw, out var id) && id > 0 ? id : null;
    }

    public static bool ShouldShowPhone(int? viewerMemberId, int rowMemberId, bool viewerSharesClub,
        object? showPhoneInMyClub, object? showPhoneInAllClubs)
        => Decide(viewerMemberId, rowMemberId, viewerSharesClub, showPhoneInMyClub, showPhoneInAllClubs);

    public static bool ShouldShowEmail(int? viewerMemberId, int rowMemberId, bool viewerSharesClub,
        object? showEmailInMyClub, object? showEmailInAllClubs)
        => Decide(viewerMemberId, rowMemberId, viewerSharesClub, showEmailInMyClub, showEmailInAllClubs);

    public static bool ShouldShowPhone(int? viewerMemberId, int rowMemberId, bool viewerSharesClub, Flags flags)
        => Decide(viewerMemberId, rowMemberId, viewerSharesClub, flags.ShowPhoneInMyClub, flags.ShowPhoneInAllClubs);

    public static bool ShouldShowEmail(int? viewerMemberId, int rowMemberId, bool viewerSharesClub, Flags flags)
        => Decide(viewerMemberId, rowMemberId, viewerSharesClub, flags.ShowEmailInMyClub, flags.ShowEmailInAllClubs);

    private static bool Decide(int? viewerMemberId, int rowMemberId, bool viewerSharesClub,
        object? myClubFlag, object? allClubsFlag)
    {
        if (viewerMemberId.HasValue && viewerMemberId.Value == rowMemberId) return true;
        return ToFlag(viewerSharesClub ? myClubFlag : allClubsFlag);
    }

    // Clubs where the viewer holds an active membership. Empty for an anonymous viewer —
    // used by single-club endpoints to answer "is the viewer a peer in THIS club?".
    public static async Task<HashSet<int>> GetViewerClubIdsAsync(MySqlConnection conn, int? viewerMemberId)
    {
        if (!viewerMemberId.HasValue) return new HashSet<int>();
        var ids = await conn.QueryAsync<int>(@"
            SELECT DISTINCT cm.fk_club_id
            FROM club_members cm
            WHERE cm.fk_member_master_profile_id = @ViewerId
              AND cm.IsActive = 1 AND COALESCE(cm.isdeleted, 0) = 0",
            new { ViewerId = viewerMemberId.Value });
        return ids.ToHashSet();
    }

    public static async Task<bool> ViewerSharesClubAsync(MySqlConnection conn, int? viewerMemberId, int clubId)
    {
        if (!viewerMemberId.HasValue) return false;
        var count = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*)
            FROM club_members cm
            WHERE cm.fk_member_master_profile_id = @ViewerId
              AND cm.fk_club_id = @ClubId
              AND cm.IsActive = 1 AND COALESCE(cm.isdeleted, 0) = 0",
            new { ViewerId = viewerMemberId.Value, ClubId = clubId });
        return count > 0;
    }

    // Every member who shares at least one active club with the viewer. Cross-club
    // listings (district directory, Find-a-Rotarian) resolve "MyClub vs AllClubs"
    // per row by testing membership of this set. Empty for an anonymous viewer.
    public static async Task<HashSet<int>> GetClubPeerMemberIdsAsync(MySqlConnection conn, int? viewerMemberId)
    {
        if (!viewerMemberId.HasValue) return new HashSet<int>();
        var ids = await conn.QueryAsync<int>(@"
            SELECT DISTINCT peer.fk_member_master_profile_id
            FROM club_members mine
            JOIN club_members peer ON peer.fk_club_id = mine.fk_club_id
                 AND peer.IsActive = 1 AND COALESCE(peer.isdeleted, 0) = 0
            WHERE mine.fk_member_master_profile_id = @ViewerId
              AND mine.IsActive = 1 AND COALESCE(mine.isdeleted, 0) = 0",
            new { ViewerId = viewerMemberId.Value });
        return ids.ToHashSet();
    }

    // Does the viewer share an active club with this specific member?
    public static async Task<bool> ViewerSharesClubWithMemberAsync(MySqlConnection conn, int? viewerMemberId, int rowMemberId)
    {
        if (!viewerMemberId.HasValue) return false;
        if (viewerMemberId.Value == rowMemberId) return true;
        var count = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*)
            FROM club_members mine
            JOIN club_members peer ON peer.fk_club_id = mine.fk_club_id
                 AND peer.fk_member_master_profile_id = @RowId
                 AND peer.IsActive = 1 AND COALESCE(peer.isdeleted, 0) = 0
            WHERE mine.fk_member_master_profile_id = @ViewerId
              AND mine.IsActive = 1 AND COALESCE(mine.isdeleted, 0) = 0",
            new { ViewerId = viewerMemberId.Value, RowId = rowMemberId });
        return count > 0;
    }

    // The four flags for a set of members, for call sites whose main query can't
    // easily carry the extra columns (typed DTO projections).
    public static async Task<Dictionary<int, Flags>> GetFlagsAsync(MySqlConnection conn, IEnumerable<int> memberIds)
    {
        var ids = memberIds.Distinct().ToList();
        if (ids.Count == 0) return new Dictionary<int, Flags>();
        var rows = await conn.QueryAsync<dynamic>(@"
            SELECT pk_member_master_profile_id AS memberId,
                   ShowPhoneInMyClub   AS showPhoneInMyClub,
                   ShowPhoneInAllClubs AS showPhoneInAllClubs,
                   ShowEmailInMyClub   AS showEmailInMyClub,
                   ShowEmailInAllClubs AS showEmailInAllClubs
            FROM member_master_profile
            WHERE pk_member_master_profile_id IN @Ids",
            new { Ids = ids });

        var map = new Dictionary<int, Flags>();
        foreach (var r in rows)
        {
            map[Convert.ToInt32(r.memberId)] = new Flags
            {
                ShowPhoneInMyClub   = ToFlag(r.showPhoneInMyClub),
                ShowPhoneInAllClubs = ToFlag(r.showPhoneInAllClubs),
                ShowEmailInMyClub   = ToFlag(r.showEmailInMyClub),
                ShowEmailInAllClubs = ToFlag(r.showEmailInAllClubs),
            };
        }
        return map;
    }

    public static Flags FlagsFor(Dictionary<int, Flags> map, int memberId)
        => map.TryGetValue(memberId, out var f) ? f : VisibleFlags;
}
