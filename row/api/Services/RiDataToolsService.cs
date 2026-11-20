using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// Rotary International data tools for a club (beats ClubRunner / DACdb RI integration): the six RI-reported officer
/// positions in ROW next to what RI holds, and a transfer-in list of people RI lists for the club who are not in ROW.
/// Works ONLY from data the server sync already stored: <c>ri_club_officers</c> (SubscriptionOfficers.SyncClubAsync,
/// run daily by SubscriptionDailyService) and <c>rotary_org_club_members_cache</c> (Super Admin "refresh cache" in
/// the manual sync). It never calls Rotary.org.
/// </summary>
public sealed class RiDataToolsService
{
    /// <summary>RI's six club officer titles, as designation_master.ri_title stores them, in RI's order.</summary>
    public static readonly string[] RiTitles =
        { "President", "Secretary", "Treasurer", "Membership Chair", "Foundation Chair", "Executive Secretary" };

    private readonly string _cs;
    public RiDataToolsService(IConfiguration config) => _cs = config.GetConnectionString("DefaultConnection")!;

    /// <summary>
    /// Maps an RI officer role ("Club President", "Club Rotary Foundation Chair", "Club Executive Secretary/Director")
    /// to one of <see cref="RiTitles"/>, or null for roles RI does not count among the six (President-Elect and so on).
    /// </summary>
    public static string? NormalizeRiRole(string? role)
    {
        if (string.IsNullOrWhiteSpace(role)) return null;
        var r = " " + role.Trim().ToLowerInvariant().Replace("/director", "").Replace("rotary foundation", "foundation") + " ";
        r = r.Replace(" club ", " ").Trim();
        return RiTitles.FirstOrDefault(t => t.Equals(r, StringComparison.OrdinalIgnoreCase));
    }

    public sealed record Holder(string Name, string? RotaryId, int? MemberId);
    public sealed record OfficerRow(string Title, List<Holder> Row, List<Holder> Ri, string Status);
    public sealed record RiOfficer(long RiMemberId, string Role, DateTime Start, DateTime End, string? Name, int? MemberId);

    /// <summary>
    /// One row per RI title. Status: match (same RI ids), different, missing_in_row, missing_in_ri, empty, or
    /// not_synced when RI data has never been stored for the club (the RI side is then unknown, not empty).
    /// A ROW holder without an RI member id can never match: the screen says so.
    /// </summary>
    public static List<OfficerRow> Compare(IEnumerable<(string Title, Holder Holder)> row, IEnumerable<(string Title, Holder Holder)> ri, bool riSynced)
    {
        var rowBy = row.ToLookup(x => x.Title, x => x.Holder, StringComparer.OrdinalIgnoreCase);
        var riBy = ri.ToLookup(x => x.Title, x => x.Holder, StringComparer.OrdinalIgnoreCase);
        return RiTitles.Select(t =>
        {
            var a = rowBy[t].DistinctBy(h => h.RotaryId ?? "name:" + h.Name).ToList();
            var b = riBy[t].DistinctBy(h => h.RotaryId).ToList();
            string status;
            if (!riSynced) status = "not_synced";
            else if (a.Count == 0 && b.Count == 0) status = "empty";
            else if (a.Count == 0) status = "missing_in_row";
            else if (b.Count == 0) status = "missing_in_ri";
            else
            {
                var ids = a.Select(h => h.RotaryId?.Trim()).ToHashSet();
                status = !ids.Contains(null) && !ids.Contains("") && ids.SetEquals(b.Select(h => h.RotaryId?.Trim())) ? "match" : "different";
            }
            return new OfficerRow(t, a, b, status);
        }).ToList();
    }

    public sealed record Year(int Id, string Label, DateTime Start, DateTime End, bool IsCurrent);
    public sealed record SyncInfo(string Status, DateTime? SyncedAtUtc, string? Message);
    public sealed record OfficerCompare(int ClubId, string ClubName, string? RiClubId, Year Year, List<Year> Years, SyncInfo Sync, List<OfficerRow> Rows);

    public async Task<OfficerCompare?> GetOfficerCompareAsync(int clubId, int? yearId)
    {
        await using var c = RowDb.Connect(_cs);
        var club = await c.QueryFirstOrDefaultAsync<(string ClubName, string? RiClubId)?>(
            "SELECT ClubName, ClubRotaryId FROM club_master WHERE pk_club_id = @clubId AND isdeleted = 0", new { clubId });
        if (club is null) return null;

        // Last four years, this year and next (officers are entered ahead for the year being planned).
        var years = (await c.QueryAsync<(int Id, string Label, DateTime Start, DateTime End, long IsCurrent)>(@"
            SELECT pk_year_id, YearLabel, StartDate, EndDate, CAST(IFNULL(IsCurrent, 0) AS SIGNED)
            FROM rotary_year_master
            WHERE StartDate <= DATE_ADD(UTC_DATE(), INTERVAL 1 YEAR) AND EndDate >= DATE_SUB(UTC_DATE(), INTERVAL 4 YEAR)
            ORDER BY StartDate DESC")).Select(y => new Year(y.Id, y.Label, y.Start, y.End, y.IsCurrent == 1)).ToList();
        var year = years.FirstOrDefault(y => y.Id == yearId) ?? years.FirstOrDefault(y => y.IsCurrent) ?? years.FirstOrDefault();
        if (year is null) return null;

        var rowHolders = await c.QueryAsync<(string Title, string? Name, string? RotaryId, int? MemberId)>(@"
            SELECT ds.ri_title, COALESCE(m.MemberName, bd.non_member_name), NULLIF(TRIM(m.RotaryId), ''), m.pk_member_master_profile_id
            FROM board_of_directors bd
            JOIN designation_master ds ON ds.pk_designation_id = bd.fk_designation_id AND ds.ri_title IS NOT NULL AND IFNULL(ds.isdeleted, 0) = 0
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = bd.fk_member_master_profile_id AND m.isdeleted = 0
            WHERE bd.fk_club_id = @clubId AND bd.fk_year_id = @yearId AND bd.isdeleted = 0", new { clubId, yearId = year.Id });

        var riOfficers = await c.QueryAsync<RiOfficer>(@"
            SELECT o.ri_member_id AS RiMemberId, o.officer_role AS Role, o.start_date AS Start, o.end_date AS End,
                   COALESCE(m.MemberName, NULLIF(TRIM(CONCAT(IFNULL(o.first_name,''), ' ', IFNULL(o.last_name,''))), '')) AS Name,
                   m.pk_member_master_profile_id AS MemberId
            FROM ri_club_officers o
            LEFT JOIN member_master_profile m ON m.RotaryId = CAST(o.ri_member_id AS CHAR) COLLATE utf8mb4_unicode_ci AND m.isdeleted = 0
            WHERE o.fk_club_id = @clubId AND o.start_date <= @End AND o.end_date >= @Start", new { clubId, year.Start, year.End });

        var sync = await c.QueryFirstOrDefaultAsync<(string Status, DateTime SyncedAt, string? Message)?>(
            "SELECT status, synced_at, message FROM ri_club_officer_sync WHERE fk_club_id = @clubId", new { clubId });
        var syncInfo = sync is { } s
            ? new SyncInfo(s.Status, DateTime.SpecifyKind(s.SyncedAt, DateTimeKind.Utc), s.Message)
            : new SyncInfo("not_synced", null, null);
        // "ok" and "no_officers" both mean RI answered; error / not_synced leave the RI side unknown.
        var riSynced = syncInfo.Status is "ok" or "no_officers";

        var rows = Compare(
            rowHolders.Select(h => (h.Title, new Holder(h.Name ?? "", h.RotaryId, h.MemberId))),
            riOfficers.Select(o => (Title: NormalizeRiRole(o.Role), o))
                .Where(x => x.Title != null)
                .Select(x => (x.Title!, new Holder(x.o.Name ?? "", x.o.RiMemberId.ToString(), x.o.MemberId))),
            riSynced);
        return new OfficerCompare(clubId, club.Value.ClubName, club.Value.RiClubId, year, years, syncInfo, rows);
    }

    // ── Transfer-in ─────────────────────────────────────────────────────────────

    public sealed record Candidate(int MemberId, string Name, string? Email, string? RotaryId, string Reason);
    public sealed record RiOnlyMember(long RotaryMemberId, string Name, string? Email, string? MemberType, DateTime? AdmissionDate,
        Candidate? SameRiId, List<Candidate> Matches);
    public sealed record TransferIn(int ClubId, string ClubName, string? RiClubId, DateTime? CacheFetchedUtc, int RiCount, List<RiOnlyMember> Missing);

    private sealed record CacheRow(long RotaryMemberId, string? LocalizedName, string? Prefix, string? FirstName, string? MiddleName,
        string? LastName, string? Suffix, string? Email, string? Mobile, string? DateOfBirth, string? Gender, string? PrimaryLanguage,
        string? MemberType, DateTime? AdmissionDate, DateTime LastFetchedUtc)
    {
        public string Name => !string.IsNullOrWhiteSpace(LocalizedName) ? LocalizedName.Trim()
            : string.Join(" ", new[] { Prefix, FirstName, MiddleName, LastName, Suffix }.Where(s => !string.IsNullOrWhiteSpace(s)).Select(s => s!.Trim()));
    }

    private const string CacheSelect = @"
        SELECT RotaryMemberId, LocalizedName, Prefix, FirstName, MiddleName, LastName, Suffix, NULLIF(TRIM(Email), '') AS Email,
               NULLIF(TRIM(Mobile), '') AS Mobile, DateOfBirth, Gender, PrimaryLanguage, MemberType, AdmissionDate, LastFetchedUtc
        FROM rotary_org_club_members_cache
        WHERE fk_rotary_club_id = @riClub AND TerminationDate IS NULL";

    /// <summary>Squashes a name for loose matching: letters and digits only, lower case.</summary>
    public static string NameKey(string? name) =>
        new string((name ?? "").ToLowerInvariant().Where(char.IsLetterOrDigit).ToArray());

    public async Task<TransferIn?> GetTransferInAsync(int clubId)
    {
        await using var c = RowDb.Connect(_cs);
        var club = await c.QueryFirstOrDefaultAsync<(string ClubName, string? RiClubId)?>(
            "SELECT ClubName, ClubRotaryId FROM club_master WHERE pk_club_id = @clubId AND isdeleted = 0", new { clubId });
        if (club is null) return null;
        if (!int.TryParse(club.Value.RiClubId, out var riClub))
            return new TransferIn(clubId, club.Value.ClubName, club.Value.RiClubId, null, 0, new());

        var cache = (await c.QueryAsync<CacheRow>(CacheSelect, new { riClub })).ToList();
        var mine = (await c.QueryAsync<(int Id, string? Name, string? Email, string? RotaryId)>(@"
            SELECT m.pk_member_master_profile_id, m.MemberName, NULLIF(TRIM(m.EmailId), ''), NULLIF(TRIM(m.RotaryId), '')
            FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
            WHERE cm.fk_club_id = @clubId AND cm.isdeleted = 0 AND m.isdeleted = 0", new { clubId })).ToList();
        var mineIds = mine.Where(m => m.RotaryId != null).Select(m => m.RotaryId!).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var missing = cache.Where(r => !mineIds.Contains(r.RotaryMemberId.ToString())).ToList();

        // People already in ROW (another club, or a past row of this one) under the same RI id: one query for all.
        var riIds = missing.Select(r => r.RotaryMemberId.ToString()).ToList();
        var elsewhere = riIds.Count == 0 ? new Dictionary<string, Candidate>() : (await c.QueryAsync<(int Id, string? Name, string? Email, string RotaryId)>(@"
                SELECT pk_member_master_profile_id, MemberName, EmailId, TRIM(RotaryId) FROM member_master_profile
                WHERE isdeleted = 0 AND TRIM(RotaryId) IN @riIds", new { riIds }))
            .GroupBy(m => m.RotaryId)
            .ToDictionary(g => g.Key, g => g.Select(m => new Candidate(m.Id, m.Name ?? "", m.Email, m.RotaryId, "same_ri_id")).First());

        // Club members with no RI id yet are the people a row may have been entered as by hand.
        var unlinked = mine.Where(m => m.RotaryId == null).ToList();
        var list = missing.Select(r =>
        {
            elsewhere.TryGetValue(r.RotaryMemberId.ToString(), out var same);
            var key = NameKey(r.Name);
            var matches = unlinked
                .Select(m => r.Email != null && string.Equals(m.Email, r.Email, StringComparison.OrdinalIgnoreCase)
                    ? new Candidate(m.Id, m.Name ?? "", m.Email, null, "email")
                    : key.Length > 0 && NameKey(m.Name) == key ? new Candidate(m.Id, m.Name ?? "", m.Email, null, "name") : null)
                .OfType<Candidate>()
                .ToList();
            return new RiOnlyMember(r.RotaryMemberId, r.Name, r.Email, r.MemberType, r.AdmissionDate, same, matches);
        }).OrderBy(m => m.Name).ToList();

        DateTime? fetched = cache.Count > 0 ? DateTime.SpecifyKind(cache.Max(r => r.LastFetchedUtc), DateTimeKind.Utc) : null;
        return new TransferIn(clubId, club.Value.ClubName, club.Value.RiClubId, fetched, cache.Count, list);
    }

    public sealed record ActionResult(bool Ok, int Status, string Message, int? MemberId = null);

    /// <summary>
    /// Brings one RI-listed person into the club. mode "link": a club member with no RI id gets this RI id.
    /// mode "add": the ROW member who already holds this RI id joins the club. mode "create": a new ROW member is
    /// made from the stored RI record. The RI id must be in the club's stored RI list and not yet in the club.
    /// </summary>
    public async Task<ActionResult> TransferInAsync(int clubId, long rotaryMemberId, string mode, int? memberId)
    {
        await using var c = RowDb.Connect(_cs);
        await c.OpenAsync();
        var riClubStr = await c.ExecuteScalarAsync<string?>(
            "SELECT ClubRotaryId FROM club_master WHERE pk_club_id = @clubId AND isdeleted = 0", new { clubId });
        if (!int.TryParse(riClubStr, out var riClub)) return new(false, 409, "This club has no RI club id.");
        var r = await c.QueryFirstOrDefaultAsync<CacheRow>(CacheSelect + " AND RotaryMemberId = @rotaryMemberId", new { riClub, rotaryMemberId });
        if (r is null) return new(false, 404, "This person is not in the club's stored RI member list.");
        var rid = rotaryMemberId.ToString();
        var inClub = await c.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
            WHERE cm.fk_club_id = @clubId AND cm.isdeleted = 0 AND m.isdeleted = 0 AND TRIM(m.RotaryId) = @rid", new { clubId, rid });
        if (inClub > 0) return new(false, 409, "This person is already a member of the club in ROW.");

        switch (mode)
        {
            case "link":
            {
                if (memberId is not > 0) return new(false, 400, "Choose the club member to link.");
                // Only a current club member who has no RI id yet may take this one.
                var ok = await c.ExecuteScalarAsync<int>(@"
                    SELECT COUNT(*) FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                    WHERE cm.fk_club_id = @clubId AND cm.fk_member_master_profile_id = @memberId AND cm.isdeleted = 0
                      AND m.isdeleted = 0 AND IFNULL(TRIM(m.RotaryId), '') = ''", new { clubId, memberId });
                if (ok == 0) return new(false, 400, "That member is not in this club or already has an RI member id.");
                var taken = await c.ExecuteScalarAsync<string?>(
                    "SELECT MemberName FROM member_master_profile WHERE isdeleted = 0 AND TRIM(RotaryId) = @rid LIMIT 1", new { rid });
                if (taken != null) return new(false, 409, $"RI member id {rid} already belongs to {taken} in ROW. Use Add to club instead.");
                await c.ExecuteAsync("UPDATE member_master_profile SET RotaryId = @rid, modified_date = NOW() WHERE pk_member_master_profile_id = @memberId",
                    new { rid, memberId });
                return new(true, 200, "Linked to the RI record.", memberId);
            }
            case "add":
            {
                var holder = await c.ExecuteScalarAsync<int?>(
                    "SELECT pk_member_master_profile_id FROM member_master_profile WHERE isdeleted = 0 AND TRIM(RotaryId) = @rid LIMIT 1", new { rid });
                if (holder is null) return new(false, 404, "No ROW member holds this RI member id. Use Create instead.");
                await RiMemberImport.JoinClubAsync(c, clubId, holder.Value, r.MemberType, r.AdmissionDate);
                return new(true, 200, "Added to the club.", holder);
            }
            case "create":
            {
                DateTime? dob = DateTime.TryParseExact(r.DateOfBirth?.Trim(), new[] { "MM/dd/yyyy", "yyyy-MM-dd" },
                    System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var d) ? d : null;
                var person = new RiPerson(rotaryMemberId, r.Name, r.Email, r.Mobile, dob, r.Gender, r.PrimaryLanguage,
                    RiMemberImport.YouthFlag(null, dob, DateTime.UtcNow.Date), r.MemberType, r.AdmissionDate);
                int id;
                try { id = await RiMemberImport.CreateProfileAsync(c, person); }
                catch (DuplicateMemberException ex) { return new(false, 409, ex.Message); }
                await RiMemberImport.JoinClubAsync(c, clubId, id, r.MemberType, r.AdmissionDate);
                return new(true, 200, "Member created from the RI record.", id);
            }
            default:
                return new(false, 400, "mode must be link, add or create.");
        }
    }
}
