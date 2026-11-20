using System.Text.Json;
using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// Pending officer-progression steps for the year a rollover moves into (PN, PE, P, IPP; DGN, DGE, DG, IPDG).
/// Optional: nothing implements it in this module. The officer-progression module registers one after the merge
/// and the rollover preview lists its steps; until then the preview says the source is not connected.
/// </summary>
public interface IRolloverProgressionSource
{
    Task<IReadOnlyList<RolloverPendingStep>> GetPendingAsync(string scope, int scopeId, int toYearId);
}

public sealed record RolloverPendingStep(string Role, int MemberId, string MemberName, string Status);

/// <summary>Undo refused: rows added or edited after the run hang off it (listed for the admin to remove first).</summary>
public sealed class RolloverUndoBlockedException(List<string> blockers)
    : InvalidOperationException("Undo would remove changes made after this rollover. Remove or move them first, then undo.")
{
    public List<string> Blockers { get; } = blockers;
}

public sealed record RolloverCommitteePick(int SourceId, List<string>? MemberKeys);

public sealed class RolloverApplyRequest
{
    public int FromYearId { get; set; }
    public bool IncludeIpp { get; set; }
    public List<int>? OfficerIds { get; set; }
    public List<RolloverCommitteePick>? Committees { get; set; }
}

/// <summary>
/// Year-end rollover for a club or a district: carries committees (with the members the admin picks) and chosen
/// officers into the next Rotary year, and puts the outgoing club president in as Immediate Past President.
/// Preview first; apply records every inserted row (year_rollover_item) so undo soft-deletes exactly those.
/// Anything already in the new year is skipped, so a second apply adds nothing.
/// Controller: YearRolloverController. Tables: DatabaseInitializer.Rollover.cs.
/// </summary>
public class YearRolloverService
{
    public const string Club = "club";
    public const string District = "district";
    public const string DistrictTeamName = "District team";

    private readonly string _cs;
    private readonly IAdminYearService _years;
    private readonly IAuditLogService _audit;
    private readonly IBodSubGroupAutoService _bodGroups;
    private readonly IEnumerable<IRolloverProgressionSource> _progression;

    public YearRolloverService(IConfiguration config, IAdminYearService years, IAuditLogService audit,
        IBodSubGroupAutoService bodGroups, IEnumerable<IRolloverProgressionSource> progression)
    {
        _cs = config.GetConnectionString("DefaultConnection")!;
        _years = years;
        _audit = audit;
        _bodGroups = bodGroups;
        _progression = progression;
    }

    // ===== Pure rules (unit tested) =====

    /// <summary>Auto groups mirror the board ("Club President", "Club President 2025-26"); they rebuild themselves.</summary>
    public static bool IsAutoGroup(string groupName, IEnumerable<string> designationNames) =>
        designationNames.Any(d => !string.IsNullOrWhiteSpace(d) &&
            (string.Equals(groupName.Trim(), d.Trim(), StringComparison.OrdinalIgnoreCase) ||
             groupName.Trim().StartsWith(d.Trim() + " ", StringComparison.OrdinalIgnoreCase)));

    /// <summary>The same person: by member id when both have one, otherwise by name.</summary>
    public static string PersonKey(int? memberId, string? name) =>
        memberId is > 0 ? "id:" + memberId : "name:" + (name ?? "").Trim().ToLowerInvariant();

    /// <summary>Picked member keys for one committee; null picks means none (members are chosen, never implied).</summary>
    public static HashSet<string> PickedKeys(IEnumerable<RolloverCommitteePick>? picks, int sourceId) =>
        new((picks ?? []).Where(p => p.SourceId == sourceId).SelectMany(p => p.MemberKeys ?? []), StringComparer.Ordinal);

    public static string NormName(string? s) => (s ?? "").Trim().ToLowerInvariant();

    // ===== Model =====

    public sealed record Year(int Id, string Label, DateTime Start, DateTime End);

    public sealed class MemberRow
    {
        public string Key { get; init; } = "";
        public int RowId { get; init; }
        public int? MemberId { get; init; }
        public string Name { get; init; } = "";
        public int? SubGroupId { get; init; }
        public string Action { get; set; } = "add"; // add | exists | left
    }

    public sealed class CommitteeRow
    {
        public int SourceId { get; init; }
        public string Name { get; init; } = "";
        public int? TargetId { get; set; }
        public string Action { get; set; } = "add"; // add | exists (members still merge in)
        public List<string> SubGroups { get; init; } = [];
        public List<MemberRow> Members { get; init; } = [];
    }

    public sealed class OfficerRow
    {
        public int SourceId { get; init; }
        public int? MemberId { get; init; }
        public string Name { get; init; } = "";
        public int DesignationId { get; init; }
        public string Designation { get; init; } = "";
        public string Action { get; set; } = "add"; // add | exists
    }

    // ===== Access =====

    public async Task<bool> CanRunAsync(int memberId, string scope, int scopeId, int fromYearId, int toYearId)
    {
        await using var conn = new MySqlConnection(_cs);
        await conn.OpenAsync();
        return scope == Club
            ? await _years.CanEditClubYearAsync(conn, memberId, scopeId, fromYearId) && await _years.CanEditClubYearAsync(conn, memberId, scopeId, toYearId)
            : await _years.CanEditDistrictYearAsync(conn, memberId, scopeId, fromYearId) && await _years.CanEditDistrictYearAsync(conn, memberId, scopeId, toYearId);
    }

    /// <summary>From year (default: the current one) and the year after it. Throws when either is missing.</summary>
    public async Task<(Year From, Year To)> YearsAsync(int? fromYearId)
    {
        await using var conn = new MySqlConnection(_cs);
        await conn.OpenAsync();
        var from = await conn.QueryFirstOrDefaultAsync<Year>(@"
            SELECT pk_year_id AS Id, YearLabel AS Label, StartDate AS Start, EndDate AS End FROM rotary_year_master
            WHERE COALESCE(isdeleted,0) = 0 AND (pk_year_id = @fromYearId OR (@fromYearId IS NULL AND IsCurrent = 1)) LIMIT 1",
            new { fromYearId }) ?? throw new KeyNotFoundException("That Rotary year was not found.");
        var to = await conn.QueryFirstOrDefaultAsync<Year>(@"
            SELECT pk_year_id AS Id, YearLabel AS Label, StartDate AS Start, EndDate AS End FROM rotary_year_master
            WHERE COALESCE(isdeleted,0) = 0 AND StartDate = DATE_ADD(@End, INTERVAL 1 DAY) LIMIT 1",
            new { from.End }) ?? throw new InvalidOperationException($"The Rotary year after {from.Label} is not set up yet.");
        return (from, to);
    }

    public async Task<bool> ScopeExistsAsync(string scope, int scopeId)
    {
        await using var conn = new MySqlConnection(_cs);
        return await conn.ExecuteScalarAsync<int>(scope == Club
            ? "SELECT COUNT(*) FROM club_master WHERE pk_club_id = @scopeId AND isdeleted = 0"
            : "SELECT COUNT(*) FROM district_master WHERE pk_district_id = @scopeId AND isdeleted = 0", new { scopeId }) > 0;
    }

    // ===== Preview =====

    public async Task<object> PreviewAsync(string scope, int scopeId, Year from, Year to)
    {
        await using var conn = new MySqlConnection(_cs);
        await conn.OpenAsync();
        var plan = await PlanAsync(conn, null, scope, scopeId, from.Id, to.Id);

        var connected = _progression.Any();
        var steps = new List<RolloverPendingStep>();
        foreach (var p in _progression) steps.AddRange(await p.GetPendingAsync(scope, scopeId, to.Id));

        var runs = await conn.QueryAsync(@"
            SELECT r.pk_run_id AS runId, r.from_year_id AS fromYearId, r.to_year_id AS toYearId, r.status,
                   r.summary_json AS summary, r.created_date AS createdUtc, r.undone_date AS undoneUtc,
                   m.MemberName AS createdByName
            FROM year_rollover_run r LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = r.created_by
            WHERE r.scope = @scope AND r.scope_id = @scopeId ORDER BY r.pk_run_id DESC LIMIT 20", new { scope, scopeId });

        return new
        {
            scope, scopeId,
            fromYear = new { from.Id, from.Label },
            toYear = new { to.Id, to.Label },
            committees = plan.Committees,
            officers = plan.Officers,
            ipp = plan.Ipp,
            incoming = plan.Incoming,
            // Filled by IRolloverProgressionSource once the officer-progression module is merged.
            pendingProgression = new { connected, steps },
            runs,
        };
    }

    private sealed record Plan(List<CommitteeRow> Committees, List<OfficerRow> Officers, OfficerRow? Ipp, int IppDesignationId, List<object> Incoming);

    private async Task<Plan> PlanAsync(MySqlConnection conn, MySqlTransaction? tx, string scope, int scopeId, int fromYearId, int toYearId)
    {
        var designations = (await conn.QueryAsync<(int Id, string Name)>(
            "SELECT pk_designation_id, designation_name FROM designation_master WHERE COALESCE(isdeleted,0) = 0", transaction: tx)).ToList();
        var a = new { scopeId, fromYearId, toYearId };

        if (scope == District) return await PlanDistrictAsync(conn, tx, a.scopeId, fromYearId, toYearId);

        // Club committees = the club's own sub_groups, minus the board mirror groups.
        var groups = (await conn.QueryAsync<(int Id, string Name)>(@"
            SELECT pk_sub_group_id, GroupName FROM sub_groups
            WHERE fk_club_id = @scopeId AND fk_district_id IS NULL AND fk_year_id = @fromYearId AND COALESCE(isdeleted,0) = 0
            ORDER BY GroupName", a, tx)).Where(g => !IsAutoGroup(g.Name, designations.Select(d => d.Name))).ToList();
        var targets = (await conn.QueryAsync<(int Id, string Name)>(@"
            SELECT pk_sub_group_id, GroupName FROM sub_groups
            WHERE fk_club_id = @scopeId AND fk_district_id IS NULL AND fk_year_id = @toYearId AND COALESCE(isdeleted,0) = 0", a, tx))
            .GroupBy(g => NormName(g.Name)).ToDictionary(g => g.Key, g => g.First().Id);
        var active = (await conn.QueryAsync<int>(@"
            SELECT fk_member_master_profile_id FROM club_members WHERE fk_club_id = @scopeId AND IsActive = 1 AND isdeleted = 0", a, tx)).ToHashSet();

        var committees = new List<CommitteeRow>();
        foreach (var g in groups)
        {
            var c = new CommitteeRow { SourceId = g.Id, Name = g.Name };
            if (targets.TryGetValue(NormName(g.Name), out var t)) { c.TargetId = t; c.Action = "exists"; }
            var inTarget = c.TargetId is int tid
                ? (await conn.QueryAsync<int>("SELECT fk_member_master_profile_id FROM sub_group_members WHERE fk_sub_group_id = @tid AND COALESCE(isdeleted,0) = 0", new { tid }, tx)).ToHashSet()
                : [];
            var members = await conn.QueryAsync<(int Id, int MemberId, string Name)>(@"
                SELECT sm.pk_sub_group_member_id, sm.fk_member_master_profile_id, COALESCE(m.MemberName, '')
                FROM sub_group_members sm LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = sm.fk_member_master_profile_id
                WHERE sm.fk_sub_group_id = @Id AND COALESCE(sm.isdeleted,0) = 0 ORDER BY m.MemberName", new { g.Id }, tx);
            foreach (var m in members)
                c.Members.Add(new MemberRow
                {
                    Key = "m:" + m.Id, RowId = m.Id, MemberId = m.MemberId, Name = m.Name,
                    Action = !active.Contains(m.MemberId) ? "left" : inTarget.Contains(m.MemberId) ? "exists" : "add",
                });
            committees.Add(c);
        }

        int presId = designations.FirstOrDefault(d => d.Name == "Club President").Id;
        int ippId = designations.FirstOrDefault(d => d.Name == "Immediate Past President").Id;
        var fromBoard = await BoardAsync(conn, tx, scopeId, fromYearId);
        var toBoard = await BoardAsync(conn, tx, scopeId, toYearId);
        var toKeys = toBoard.Select(o => (o.DesignationId, PersonKey(o.MemberId, o.Name))).ToHashSet();

        var officers = fromBoard.Where(o => o.DesignationId != presId && o.DesignationId != ippId).ToList();
        foreach (var o in officers) if (toKeys.Contains((o.DesignationId, PersonKey(o.MemberId, o.Name)))) o.Action = "exists";

        OfficerRow? ipp = null;
        var pres = fromBoard.FirstOrDefault(o => o.DesignationId == presId);
        if (pres != null && ippId > 0)
            ipp = new OfficerRow
            {
                SourceId = pres.SourceId, MemberId = pres.MemberId, Name = pres.Name, DesignationId = ippId,
                Designation = "Immediate Past President",
                Action = toBoard.Any(o => o.DesignationId == ippId) ? "exists" : "add",
            };

        var incoming = toBoard.Select(o => (object)new { o.Name, o.Designation }).ToList();
        return new Plan(committees, officers, ipp, ippId, incoming);
    }

    private static async Task<List<OfficerRow>> BoardAsync(MySqlConnection conn, MySqlTransaction? tx, int clubId, int yearId) =>
        (await conn.QueryAsync<OfficerRow>(@"
            SELECT b.pk_board_director_id AS SourceId, b.fk_member_master_profile_id AS MemberId,
                   COALESCE(m.MemberName, b.non_member_name, '') AS Name, b.fk_designation_id AS DesignationId,
                   COALESCE(NULLIF(b.custom_designation, ''), d.designation_name, '') AS Designation
            FROM board_of_directors b
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id
            LEFT JOIN designation_master d ON d.pk_designation_id = b.fk_designation_id
            WHERE b.fk_club_id = @clubId AND b.fk_year_id = @yearId AND COALESCE(b.isdeleted,0) = 0
            ORDER BY d.sort_order, b.sort_order, Name", new { clubId, yearId }, tx)).ToList();

    private static async Task<Plan> PlanDistrictAsync(MySqlConnection conn, MySqlTransaction? tx, int districtId, int fromYearId, int toYearId)
    {
        var a = new { districtId, fromYearId, toYearId };
        var committees = new List<CommitteeRow>();

        // The district team (level 1) has no group row: source id 0.
        var team = new CommitteeRow { SourceId = 0, Name = DistrictTeamName, Action = "exists" };
        var teamTarget = (await conn.QueryAsync<(int? MemberId, string Name)>(@"
            SELECT fk_member_id, name FROM district_committee_member
            WHERE fk_district_id = @districtId AND fk_year_id = @toYearId AND COALESCE(isdeleted,0) = 0", a, tx))
            .Select(x => PersonKey(x.MemberId, x.Name)).ToHashSet();
        foreach (var m in await conn.QueryAsync<(int Id, int? MemberId, string Name)>(@"
            SELECT id, fk_member_id, name FROM district_committee_member
            WHERE fk_district_id = @districtId AND fk_year_id = @fromYearId AND COALESCE(isdeleted,0) = 0 ORDER BY sort_order, name", a, tx))
            team.Members.Add(new MemberRow { Key = "t:" + m.Id, RowId = m.Id, MemberId = m.MemberId, Name = m.Name, Action = teamTarget.Contains(PersonKey(m.MemberId, m.Name)) ? "exists" : "add" });
        if (team.Members.Count > 0) committees.Add(team);

        var targets = (await conn.QueryAsync<(int Id, string Name)>(@"
            SELECT id, group_name FROM district_committee_group
            WHERE fk_district_id = @districtId AND fk_year_id = @toYearId AND COALESCE(isdeleted,0) = 0", a, tx))
            .GroupBy(g => NormName(g.Name)).ToDictionary(g => g.Key, g => g.First().Id);
        foreach (var g in await conn.QueryAsync<(int Id, string Name)>(@"
            SELECT id, group_name FROM district_committee_group
            WHERE fk_district_id = @districtId AND fk_year_id = @fromYearId AND COALESCE(isdeleted,0) = 0 ORDER BY sort_order, group_name", a, tx))
        {
            var c = new CommitteeRow { SourceId = g.Id, Name = g.Name };
            if (targets.TryGetValue(NormName(g.Name), out var t)) { c.TargetId = t; c.Action = "exists"; }

            // Target people already in the group (or in a same-named sub-group).
            var inGroup = new HashSet<string>();
            var inSub = new HashSet<string>();
            if (c.TargetId is int tid)
            {
                foreach (var x in await conn.QueryAsync<(int? MemberId, string Name)>(
                    "SELECT fk_member_id, name FROM district_committee_group_member WHERE fk_group_id = @tid AND COALESCE(isdeleted,0) = 0", new { tid }, tx))
                    inGroup.Add(PersonKey(x.MemberId, x.Name));
                foreach (var x in await conn.QueryAsync<(string Sub, int? MemberId, string Name)>(@"
                    SELECT sg.sub_group_name, sm.fk_member_id, sm.name FROM district_committee_sub_group sg
                    JOIN district_committee_sub_group_member sm ON sm.fk_sub_group_id = sg.id AND COALESCE(sm.isdeleted,0) = 0
                    WHERE sg.fk_group_id = @tid AND COALESCE(sg.isdeleted,0) = 0", new { tid }, tx))
                    inSub.Add(NormName(x.Sub) + "|" + PersonKey(x.MemberId, x.Name));
            }

            foreach (var m in await conn.QueryAsync<(int Id, int? MemberId, string Name)>(@"
                SELECT id, fk_member_id, name FROM district_committee_group_member
                WHERE fk_group_id = @Id AND COALESCE(isdeleted,0) = 0 ORDER BY sort_order, name", new { g.Id }, tx))
                c.Members.Add(new MemberRow { Key = "g:" + m.Id, RowId = m.Id, MemberId = m.MemberId, Name = m.Name, Action = inGroup.Contains(PersonKey(m.MemberId, m.Name)) ? "exists" : "add" });

            foreach (var m in await conn.QueryAsync<(int Id, int? MemberId, string Name, int SubId, string Sub)>(@"
                SELECT sm.id, sm.fk_member_id, sm.name, sg.id, sg.sub_group_name FROM district_committee_sub_group sg
                JOIN district_committee_sub_group_member sm ON sm.fk_sub_group_id = sg.id AND COALESCE(sm.isdeleted,0) = 0
                WHERE sg.fk_group_id = @Id AND COALESCE(sg.isdeleted,0) = 0 ORDER BY sg.sort_order, sm.sort_order, sm.name", new { g.Id }, tx))
                c.Members.Add(new MemberRow
                {
                    Key = "s:" + m.Id, RowId = m.Id, MemberId = m.MemberId, Name = m.Name + " (" + m.Sub + ")", SubGroupId = m.SubId,
                    Action = inSub.Contains(NormName(m.Sub) + "|" + PersonKey(m.MemberId, m.Name)) ? "exists" : "add",
                });

            c.SubGroups.AddRange(await conn.QueryAsync<string>(
                "SELECT sub_group_name FROM district_committee_sub_group WHERE fk_group_id = @Id AND COALESCE(isdeleted,0) = 0 ORDER BY sort_order, sub_group_name", new { g.Id }, tx));
            committees.Add(c);
        }

        var incoming = (await conn.QueryAsync<string>(
            "SELECT member_name FROM district_governors WHERE fk_district_id = @districtId AND fk_year_id = @toYearId AND COALESCE(isdeleted,0) = 0", a, tx))
            .Select(n => (object)new { Name = n, Designation = "District Governor" }).ToList();
        return new Plan(committees, [], null, 0, incoming);
    }

    // ===== Apply =====

    private const string DistrictMemberCols =
        "fk_member_id, is_member, name, mobile, email, district_designation, fk_club_id, club_name, district_remark, profile_photo, sort_order, is_active";

    public async Task<object> ApplyAsync(string scope, int scopeId, Year from, Year to, RolloverApplyRequest req, int by, HttpContext? ctx)
    {
        await using var conn = new MySqlConnection(_cs);
        await conn.OpenAsync();
        // One rollover per scope at a time: a double click waits, then finds everything already there.
        var lockName = $"row_rollover_{scope}_{scopeId}";
        if (await conn.ExecuteScalarAsync<int?>("SELECT GET_LOCK(@lockName, 15)", new { lockName }) != 1)
            throw new InvalidOperationException("Another rollover for this scope is running. Try again in a moment.");
        try
        {
            var items = new List<(string Kind, int Source, string Table, int Target)>();
            var bodDesignations = new HashSet<int>();
            int? runId = null;
            await using (var tx = await conn.BeginTransactionAsync())
            {
                var plan = await PlanAsync(conn, tx, scope, scopeId, from.Id, to.Id);
                var p = new { scopeId, fromYearId = from.Id, toYearId = to.Id, by };
                var picksBySource = (req.Committees ?? []).Select(c => c.SourceId).ToHashSet();

                foreach (var c in plan.Committees.Where(c => picksBySource.Contains(c.SourceId)))
                {
                    var keys = PickedKeys(req.Committees, c.SourceId);
                    var add = c.Members.Where(m => m.Action == "add" && keys.Contains(m.Key)).ToList();
                    if (scope == Club)
                    {
                        var target = c.TargetId ?? 0;
                        if (target == 0)
                        {
                            target = await conn.ExecuteScalarAsync<int>(@"
                                INSERT INTO sub_groups (fk_club_id, fk_district_id, fk_year_id, GroupName, created_by, created_date, isdeleted)
                                VALUES (@scopeId, NULL, @toYearId, @Name, @by, NOW(), 0); SELECT LAST_INSERT_ID();",
                                new { scopeId, toYearId = to.Id, c.Name, by }, tx);
                            items.Add(("committee", c.SourceId, "sub_groups", target));
                        }
                        foreach (var m in add)
                            items.Add(("member", m.RowId, "sub_group_members", await conn.ExecuteScalarAsync<int>(@"
                                INSERT INTO sub_group_members (fk_sub_group_id, fk_member_master_profile_id, created_by, created_date, isdeleted)
                                VALUES (@target, @MemberId, @by, NOW(), 0); SELECT LAST_INSERT_ID();", new { target, m.MemberId, by }, tx)));
                    }
                    else if (c.SourceId == 0)
                    {
                        foreach (var m in add)
                            items.Add(("member", m.RowId, "district_committee_member", await conn.ExecuteScalarAsync<int>($@"
                                INSERT INTO district_committee_member (fk_district_id, fk_year_id, {DistrictMemberCols}, created_by, created_date, isdeleted)
                                SELECT fk_district_id, @toYearId, {DistrictMemberCols}, @by, NOW(), 0 FROM district_committee_member WHERE id = @RowId AND fk_district_id = @scopeId;
                                SELECT LAST_INSERT_ID();", new { scopeId, toYearId = to.Id, m.RowId, by }, tx)));
                    }
                    else
                    {
                        var target = c.TargetId ?? 0;
                        if (target == 0)
                        {
                            target = await conn.ExecuteScalarAsync<int>(@"
                                INSERT INTO district_committee_group (fk_district_id, fk_year_id, group_name, sort_order, is_active, created_by, created_date, isdeleted)
                                SELECT fk_district_id, @toYearId, group_name, sort_order, is_active, @by, NOW(), 0 FROM district_committee_group WHERE id = @SourceId AND fk_district_id = @scopeId;
                                SELECT LAST_INSERT_ID();", new { scopeId, toYearId = to.Id, c.SourceId, by }, tx);
                            items.Add(("committee", c.SourceId, "district_committee_group", target));
                        }
                        // Sub-groups come with the committee (matched by name when it already exists).
                        var targetSubs = (await conn.QueryAsync<(int Id, string Name)>(
                            "SELECT id, sub_group_name FROM district_committee_sub_group WHERE fk_group_id = @target AND COALESCE(isdeleted,0) = 0", new { target }, tx))
                            .GroupBy(s => NormName(s.Name)).ToDictionary(s => s.Key, s => s.First().Id);
                        var subMap = new Dictionary<int, int>();
                        foreach (var s in await conn.QueryAsync<(int Id, string Name)>(
                            "SELECT id, sub_group_name FROM district_committee_sub_group WHERE fk_group_id = @SourceId AND COALESCE(isdeleted,0) = 0", new { c.SourceId }, tx))
                        {
                            if (!targetSubs.TryGetValue(NormName(s.Name), out var ts))
                            {
                                ts = await conn.ExecuteScalarAsync<int>(@"
                                    INSERT INTO district_committee_sub_group (fk_group_id, sub_group_name, sort_order, is_active, created_by, created_date, isdeleted)
                                    SELECT @target, sub_group_name, sort_order, is_active, @by, NOW(), 0 FROM district_committee_sub_group WHERE id = @Id;
                                    SELECT LAST_INSERT_ID();", new { target, s.Id, by }, tx);
                                items.Add(("subcommittee", s.Id, "district_committee_sub_group", ts));
                                targetSubs[NormName(s.Name)] = ts;
                            }
                            subMap[s.Id] = ts;
                        }
                        foreach (var m in add)
                        {
                            if (m.SubGroupId is int sid)
                                items.Add(("member", m.RowId, "district_committee_sub_group_member", await conn.ExecuteScalarAsync<int>($@"
                                    INSERT INTO district_committee_sub_group_member (fk_sub_group_id, {DistrictMemberCols}, created_by, created_date, isdeleted)
                                    SELECT @ts, {DistrictMemberCols}, @by, NOW(), 0 FROM district_committee_sub_group_member WHERE id = @RowId;
                                    SELECT LAST_INSERT_ID();", new { ts = subMap[sid], m.RowId, by }, tx)));
                            else
                                items.Add(("member", m.RowId, "district_committee_group_member", await conn.ExecuteScalarAsync<int>($@"
                                    INSERT INTO district_committee_group_member (fk_group_id, {DistrictMemberCols}, created_by, created_date, isdeleted)
                                    SELECT @target, {DistrictMemberCols}, @by, NOW(), 0 FROM district_committee_group_member WHERE id = @RowId;
                                    SELECT LAST_INSERT_ID();", new { target, m.RowId, by }, tx)));
                        }
                    }
                }

                if (scope == Club)
                {
                    var chosen = (req.OfficerIds ?? []).ToHashSet();
                    var officers = plan.Officers.Where(o => o.Action == "add" && chosen.Contains(o.SourceId)).ToList();
                    foreach (var o in officers)
                    {
                        items.Add(("officer", o.SourceId, "board_of_directors", await conn.ExecuteScalarAsync<int>(@"
                            INSERT INTO board_of_directors (fk_club_id, fk_member_master_profile_id, non_member_name, non_member_mobile, non_member_email,
                                   fk_designation_id, custom_designation, fk_year_id, sort_order, SyncSource, created_by, created_date, isdeleted)
                            SELECT fk_club_id, fk_member_master_profile_id, non_member_name, non_member_mobile, non_member_email,
                                   fk_designation_id, custom_designation, @toYearId, sort_order, 'Manual', @by, NOW(), 0
                            FROM board_of_directors WHERE pk_board_director_id = @SourceId AND fk_club_id = @scopeId;
                            SELECT LAST_INSERT_ID();", new { scopeId, toYearId = to.Id, o.SourceId, by }, tx)));
                        bodDesignations.Add(o.DesignationId);
                    }
                    if (req.IncludeIpp && plan.Ipp is { Action: "add" } ipp)
                    {
                        items.Add(("ipp", ipp.SourceId, "board_of_directors", await conn.ExecuteScalarAsync<int>(@"
                            INSERT INTO board_of_directors (fk_club_id, fk_member_master_profile_id, non_member_name, non_member_mobile, non_member_email,
                                   fk_designation_id, fk_year_id, SyncSource, created_by, created_date, isdeleted)
                            SELECT fk_club_id, fk_member_master_profile_id, non_member_name, non_member_mobile, non_member_email,
                                   @ippId, @toYearId, 'Manual', @by, NOW(), 0
                            FROM board_of_directors WHERE pk_board_director_id = @SourceId AND fk_club_id = @scopeId;
                            SELECT LAST_INSERT_ID();", new { scopeId, toYearId = to.Id, ipp.SourceId, ippId = plan.IppDesignationId, by }, tx)));
                        bodDesignations.Add(plan.IppDesignationId);
                    }
                }

                if (items.Count > 0)
                {
                    var summary = JsonSerializer.Serialize(items.GroupBy(i => i.Kind).ToDictionary(g => g.Key, g => g.Count()));
                    runId = await conn.ExecuteScalarAsync<int>(@"
                        INSERT INTO year_rollover_run (scope, scope_id, from_year_id, to_year_id, status, summary_json, created_by, created_date)
                        VALUES (@scope, @scopeId, @fromYearId, @toYearId, 'applied', @summary, @by, UTC_TIMESTAMP()); SELECT LAST_INSERT_ID();",
                        new { scope, p.scopeId, p.fromYearId, p.toYearId, summary, by }, tx);
                    await conn.ExecuteAsync(@"
                        INSERT INTO year_rollover_item (fk_run_id, kind, source_id, target_table, target_id) VALUES (@runId, @Kind, @Source, @Table, @Target)",
                        items.Select(i => new { runId, i.Kind, i.Source, i.Table, i.Target }), tx);
                }
                await tx.CommitAsync();
            }

            foreach (var d in bodDesignations)
                try { await _bodGroups.OnBodChangedAsync(scopeId, d, to.Id); } catch { /* mirror groups rebuild nightly too */ }

            var counts = items.GroupBy(i => i.Kind).ToDictionary(g => g.Key, g => g.Count());
            var result = new { runId, changed = items.Count, counts, fromYearId = from.Id, toYearId = to.Id };
            if (runId != null) await _audit.LogAsync(by, "APPLY", "year_rollover", runId, $"{scope} {scopeId} {from.Label} to {to.Label}", result, ctx);
            return result;
        }
        finally
        {
            await conn.ExecuteScalarAsync<int?>("SELECT RELEASE_LOCK(@lockName)", new { lockName });
        }
    }

    // ===== Undo =====

    // Tables a run may write to, and their primary keys. Undo only ever touches these.
    private static readonly Dictionary<string, string> UndoTables = new()
    {
        ["sub_groups"] = "pk_sub_group_id",
        ["sub_group_members"] = "pk_sub_group_member_id",
        ["board_of_directors"] = "pk_board_director_id",
        ["district_committee_member"] = "id",
        ["district_committee_group"] = "id",
        ["district_committee_sub_group"] = "id",
        ["district_committee_group_member"] = "id",
        ["district_committee_sub_group_member"] = "id",
    };

    /// <summary>A live row that sits on (Table, Id) or under a parent; Edited = changed since it was inserted.</summary>
    public sealed record UndoRow(string Table, int Id, string? ParentTable, int? ParentId, string Label, bool Edited);

    /// <summary>
    /// Why undo must stop: a row the run inserted was edited since, or someone added a row under a committee or
    /// sub-group the run created. Undo never removes what an admin added after the run.
    /// </summary>
    public static List<string> UndoBlockers(IEnumerable<(string Table, int Id)> runRows, IEnumerable<UndoRow> rows)
    {
        var run = runRows.ToHashSet();
        var blockers = new List<string>();
        foreach (var r in rows)
        {
            if (run.Contains((r.Table, r.Id)))
            {
                if (r.Edited) blockers.Add($"{r.Label} was changed after the rollover");
            }
            else if (r.ParentTable != null && r.ParentId is int p && run.Contains((r.ParentTable, p)))
                blockers.Add($"{r.Label} was added after the rollover");
        }
        return blockers;
    }

    // Rows that can hang off a container the run created: (container, child table, parent column, label SQL).
    private static readonly (string Parent, string Child, string Fk, string Label)[] UndoChildren =
    [
        ("sub_groups", "sub_group_members", "fk_sub_group_id",
            "CONCAT('Member ', COALESCE((SELECT MemberName FROM member_master_profile WHERE pk_member_master_profile_id = c.fk_member_master_profile_id), c.fk_member_master_profile_id))"),
        ("district_committee_group", "district_committee_group_member", "fk_group_id", "CONCAT('Member ', c.name)"),
        ("district_committee_group", "district_committee_sub_group", "fk_group_id", "CONCAT('Sub-group ', c.sub_group_name)"),
        ("district_committee_sub_group", "district_committee_sub_group_member", "fk_sub_group_id", "CONCAT('Member ', c.name)"),
    ];

    // Run-inserted rows that carry modified_date (set by MySQL on any later edit; the run inserts it NULL).
    private static readonly Dictionary<string, string> EditLabel = new()
    {
        ["sub_groups"] = "CONCAT('Committee ', c.GroupName)",
        ["board_of_directors"] = "CONCAT('Board entry for ', COALESCE((SELECT MemberName FROM member_master_profile WHERE pk_member_master_profile_id = c.fk_member_master_profile_id), c.non_member_name, ''))",
        ["district_committee_member"] = "CONCAT('Team member ', c.name)",
        ["district_committee_group"] = "CONCAT('Committee ', c.group_name)",
        ["district_committee_sub_group"] = "CONCAT('Sub-group ', c.sub_group_name)",
        ["district_committee_group_member"] = "CONCAT('Member ', c.name)",
        ["district_committee_sub_group_member"] = "CONCAT('Member ', c.name)",
    };

    private static async Task<List<string>> UndoBlockersAsync(MySqlConnection conn, MySqlTransaction tx, List<(string Table, int Target)> items)
    {
        var rows = new List<UndoRow>();
        foreach (var g in items.GroupBy(i => i.Table))
        {
            var ids = g.Select(i => i.Target).ToList();
            if (EditLabel.TryGetValue(g.Key, out var label))
                rows.AddRange((await conn.QueryAsync<(int Id, string Label)>(
                    $"SELECT c.{UndoTables[g.Key]}, {label} FROM {g.Key} c WHERE c.{UndoTables[g.Key]} IN @ids AND COALESCE(c.isdeleted,0) = 0 AND c.modified_date IS NOT NULL",
                    new { ids }, tx)).Select(r => new UndoRow(g.Key, r.Id, null, null, r.Label, true)));
            foreach (var (parent, child, fk, childLabel) in UndoChildren.Where(c => c.Parent == g.Key))
                rows.AddRange((await conn.QueryAsync<(int Id, int ParentId, string Label)>(
                    $"SELECT c.{UndoTables[child]}, c.{fk}, {childLabel} FROM {child} c WHERE c.{fk} IN @ids AND COALESCE(c.isdeleted,0) = 0",
                    new { ids }, tx)).Select(r => new UndoRow(child, r.Id, parent, r.ParentId, r.Label, false)));
        }
        return UndoBlockers(items.Select(i => (i.Table, i.Target)), rows);
    }

    public sealed record Run(int Id, string Scope, int ScopeId, int FromYearId, int ToYearId, string Status);

    public async Task<Run?> RunAsync(int runId)
    {
        await using var conn = new MySqlConnection(_cs);
        return await conn.QueryFirstOrDefaultAsync<Run>(@"
            SELECT pk_run_id AS Id, scope AS Scope, scope_id AS ScopeId, from_year_id AS FromYearId, to_year_id AS ToYearId, status AS Status
            FROM year_rollover_run WHERE pk_run_id = @runId", new { runId });
    }

    public async Task<object> UndoAsync(Run run, int by, HttpContext? ctx)
    {
        await using var conn = new MySqlConnection(_cs);
        await conn.OpenAsync();
        var removed = 0;
        var bodDesignations = new List<int>();
        await using (var tx = await conn.BeginTransactionAsync())
        {
            var status = await conn.ExecuteScalarAsync<string>(
                "SELECT status FROM year_rollover_run WHERE pk_run_id = @Id FOR UPDATE", new { run.Id }, tx);
            if (status != "applied") throw new InvalidOperationException("This rollover was already undone.");
            var items = (await conn.QueryAsync<(string Table, int Target)>(
                "SELECT target_table, target_id FROM year_rollover_item WHERE fk_run_id = @Id ORDER BY pk_item_id DESC", new { run.Id }, tx))
                .Where(i => UndoTables.ContainsKey(i.Table)).ToList();
            var blockers = await UndoBlockersAsync(conn, tx, items);
            if (blockers.Count > 0) throw new RolloverUndoBlockedException(blockers);
            foreach (var (table, target) in items)
            {
                if (!UndoTables.TryGetValue(table, out var pk)) continue;
                if (table == "board_of_directors")
                    bodDesignations.AddRange(await conn.QueryAsync<int>(
                        "SELECT fk_designation_id FROM board_of_directors WHERE pk_board_director_id = @target", new { target }, tx));
                removed += await conn.ExecuteAsync(
                    $"UPDATE {table} SET isdeleted = 1 WHERE {pk} = @target AND COALESCE(isdeleted,0) = 0", new { target }, tx);
            }
            await conn.ExecuteAsync(
                "UPDATE year_rollover_run SET status = 'undone', undone_by = @by, undone_date = UTC_TIMESTAMP() WHERE pk_run_id = @Id",
                new { run.Id, by }, tx);
            await tx.CommitAsync();
        }
        if (run.Scope == Club)
            foreach (var d in bodDesignations.Distinct())
                try { await _bodGroups.OnBodChangedAsync(run.ScopeId, d, run.ToYearId); } catch { /* mirror groups rebuild nightly too */ }
        var result = new { runId = run.Id, removed };
        await _audit.LogAsync(by, "UNDO", "year_rollover", run.Id, $"{run.Scope} {run.ScopeId}", result, ctx);
        return result;
    }
}
