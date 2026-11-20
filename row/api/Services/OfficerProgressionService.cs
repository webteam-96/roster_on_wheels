using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

/// <summary>One step of an officer chain: who it makes them, in which Rotary year, and where confirming it writes.</summary>
public sealed record ProgressionStepPlan(string Role, string Title, int StartYear, string YearLabel, string AppliesTo);

/// <summary>
/// The pure rules of the chain. Club: President-Nominee, President-Elect, President, Immediate Past President in
/// four consecutive Rotary years. District: DGN, DGE, DG, IPDG the same way.
/// AppliesTo says what confirming writes: "board" = a board_of_directors row, "governor" = district_governors,
/// "record" = nothing beyond the confirmed step (ROW has no designation for PN/PE or DGN/DGE/IPDG).
/// </summary>
public static class OfficerProgressionChain
{
    public const string Club = "club";
    public const string District = "district";

    private static readonly (string Role, string Title, string AppliesTo)[] ClubChain =
    {
        ("PN", "President-Nominee", "record"),
        ("PE", "President-Elect", "record"),
        ("P", "President", "board"),
        ("IPP", "Immediate Past President", "board"),
    };

    private static readonly (string Role, string Title, string AppliesTo)[] DistrictChain =
    {
        ("DGN", "District Governor-Nominee", "record"),
        ("DGE", "District Governor-Elect", "record"),
        ("DG", "District Governor", "governor"),
        ("IPDG", "Immediate Past District Governor", "record"),
    };

    public static bool IsScope(string? scope) => scope == Club || scope == District;

    /// <summary>"2027-28" for 2027: the label rotary_year_master uses.</summary>
    public static string YearLabel(int startYear) => $"{startYear}-{(startYear + 1) % 100:D2}";

    public static IReadOnlyList<ProgressionStepPlan> Build(string scope, int nomineeStartYear)
    {
        var chain = scope switch
        {
            Club => ClubChain,
            District => DistrictChain,
            _ => throw new ArgumentException("Scope must be 'club' or 'district'."),
        };
        return chain.Select((c, i) => new ProgressionStepPlan(c.Role, c.Title, nomineeStartYear + i,
            YearLabel(nomineeStartYear + i), c.AppliesTo)).ToList();
    }

    public static ProgressionStepPlan Step(string scope, int nomineeStartYear, string role) =>
        Build(scope, nomineeStartYear).FirstOrDefault(s => s.Role == role)
        ?? throw new ArgumentException($"Unknown role '{role}' for a {scope} chain.");

    /// <summary>The board designation a club step writes, by designation_master name.</summary>
    public static string? BoardDesignation(string role) => role switch
    {
        "P" => "Club President",
        "IPP" => "Immediate Past President",
        _ => null,
    };

    /// <summary>Three years back (to record a chain already under way, e.g. this year's President) to three years ahead.</summary>
    public static bool IsNomineeYearAllowed(int nomineeStartYear, int currentStartYear) =>
        nomineeStartYear >= currentStartYear - 3 && nomineeStartYear <= currentStartYear + 3;
}

public sealed class ProgressionStepDto
{
    public int StepId { get; set; }
    public string Role { get; set; } = "";
    public string Title { get; set; } = "";
    public string YearLabel { get; set; } = "";
    public int? YearId { get; set; }
    public string Status { get; set; } = "pending";
    public string AppliesTo { get; set; } = "record";
    /// <summary>Who already holds this office in that year (board / governor steps), so a clash is visible before confirming.</summary>
    public string? CurrentHolderName { get; set; }
    public bool CurrentHolderIsNominee { get; set; }
    public DateTime? DecidedDate { get; set; }
}

public sealed class ProgressionDto
{
    public int ProgressionId { get; set; }
    public string Scope { get; set; } = "";
    public int ScopeId { get; set; }
    public int MemberId { get; set; }
    public string MemberName { get; set; } = "";
    public string NomineeYearLabel { get; set; } = "";
    public DateTime CreatedDate { get; set; }
    public List<ProgressionStepDto> Steps { get; set; } = new();
}

public sealed class ProgressionCandidateDto
{
    public int MemberId { get; set; }
    public string MemberName { get; set; } = "";
    public string? ClubName { get; set; }
}

/// <summary>A pending step whose year has started: what the year-end rollover surfaces to admins.</summary>
public sealed class ProgressionSuggestionDto
{
    public int StepId { get; set; }
    public string Scope { get; set; } = "";
    public int ScopeId { get; set; }
    public int MemberId { get; set; }
    public string MemberName { get; set; } = "";
    public string Role { get; set; } = "";
    public string Title { get; set; } = "";
    public string YearLabel { get; set; } = "";
}

public interface IOfficerProgressionService
{
    Task<List<ProgressionDto>> ListAsync(string scope, int scopeId);
    Task<List<ProgressionCandidateDto>> CandidatesAsync(string scope, int scopeId, string? search);
    Task<int> CreateAsync(string scope, int scopeId, int memberId, int nomineeStartYear, int by);
    Task<(string Scope, int ScopeId)?> ProgressionScopeAsync(int progressionId);
    Task<(string Scope, int ScopeId, int? YearId)?> StepScopeAsync(int stepId);
    Task DeleteAsync(int progressionId, int by);
    Task<string> ConfirmStepAsync(int stepId, int by);
    Task DismissStepAsync(int stepId, int by);

    /// <summary>
    /// For the year-end rollover job: every still-pending step of the Rotary year <paramref name="yearId"/>, across all
    /// clubs and districts. Read-only on purpose: the chain only suggests, an admin confirms each one.
    /// </summary>
    Task<List<ProgressionSuggestionDto>> GetPendingForYearAsync(int yearId);
}

public class OfficerProgressionService : IOfficerProgressionService
{
    private readonly string _cs;
    private readonly IBoardDirectorService _board;

    public OfficerProgressionService(IConfiguration config, IBoardDirectorService board)
    {
        _cs = config.GetConnectionString("DefaultConnection")!;
        _board = board;
    }

    private static T? First<T>(IEnumerable<T> rows) where T : struct
    {
        foreach (var r in rows) return r;
        return null;
    }

    private async Task<MySqlConnection> OpenAsync()
    {
        var conn = new MySqlConnection(_cs);
        await conn.OpenAsync();
        return conn;
    }

    private static Task<int?> YearIdAsync(MySqlConnection conn, string label) =>
        conn.ExecuteScalarAsync<int?>(
            "SELECT pk_year_id FROM rotary_year_master WHERE YearLabel = @label AND COALESCE(isdeleted,0) = 0 LIMIT 1",
            new { label });

    private static async Task<int> CurrentStartYearAsync(MySqlConnection conn)
    {
        var start = await conn.ExecuteScalarAsync<DateTime?>(
            "SELECT StartDate FROM rotary_year_master WHERE IsCurrent = 1 AND COALESCE(isdeleted,0) = 0 LIMIT 1");
        var d = start ?? DateTime.UtcNow;
        return d.Month >= 7 ? d.Year : d.Year - 1;
    }

    private static Task<bool> IsClubMemberAsync(MySqlConnection conn, int memberId, int clubId) =>
        conn.ExecuteScalarAsync<bool>(@"
            SELECT COUNT(*) > 0 FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            WHERE cm.fk_club_id = @clubId AND cm.fk_member_master_profile_id = @memberId
              AND cm.IsActive = 1 AND IFNULL(cm.isdeleted,0) = 0", new { memberId, clubId });

    private static Task<bool> IsDistrictMemberAsync(MySqlConnection conn, int memberId, int districtId) =>
        conn.ExecuteScalarAsync<bool>(@"
            SELECT COUNT(*) > 0 FROM club_members cm
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.fk_district_id = @districtId AND c.isdeleted = 0
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            WHERE cm.fk_member_master_profile_id = @memberId AND cm.IsActive = 1 AND IFNULL(cm.isdeleted,0) = 0",
            new { memberId, districtId });

    /// <summary>A member of the club (or of any club in the district) may see its chain.</summary>
    public static Task<bool> IsInScopeAsync(MySqlConnection conn, string scope, int scopeId, int memberId) =>
        scope == OfficerProgressionChain.Club ? IsClubMemberAsync(conn, memberId, scopeId) : IsDistrictMemberAsync(conn, memberId, scopeId);

    /// <summary>Name of whoever holds the office the step writes, in that year; null when free or the step writes nothing.</summary>
    private static async Task<(int MemberId, string Name)?> HolderAsync(MySqlConnection conn, string scope, int scopeId, string role, int yearId)
    {
        if (scope == OfficerProgressionChain.Club && OfficerProgressionChain.BoardDesignation(role) is string des)
        {
            return First(await conn.QueryAsync<(int, string)>(@"
                SELECT COALESCE(b.fk_member_master_profile_id, 0), COALESCE(m.MemberName, b.non_member_name, '')
                FROM board_of_directors b
                JOIN designation_master d ON d.pk_designation_id = b.fk_designation_id AND d.designation_name = @des
                LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = b.fk_member_master_profile_id
                WHERE b.fk_club_id = @scopeId AND b.fk_year_id = @yearId AND b.isdeleted = 0
                ORDER BY b.pk_board_director_id LIMIT 1", new { des, scopeId, yearId }));
        }
        if (scope == OfficerProgressionChain.District && role == "DG")
        {
            return First(await conn.QueryAsync<(int, string)>(@"
                SELECT COALESCE(fk_member_id, 0), member_name FROM district_governors
                WHERE fk_district_id = @scopeId AND fk_year_id = @yearId AND COALESCE(isdeleted,0) = 0
                ORDER BY pk_id LIMIT 1", new { scopeId, yearId }));
        }
        return null;
    }

    public async Task<List<ProgressionDto>> ListAsync(string scope, int scopeId)
    {
        await using var conn = await OpenAsync();
        var rows = (await conn.QueryAsync<(int Id, int MemberId, string Name, int Start, DateTime Created)>(@"
            SELECT p.pk_progression_id, p.fk_member_id, COALESCE(m.MemberName, ''), p.nominee_start_year, p.created_date
            FROM officer_progression p
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = p.fk_member_id
            WHERE p.scope = @scope AND p.scope_id = @scopeId AND p.isdeleted = 0
            ORDER BY p.nominee_start_year DESC, p.pk_progression_id DESC", new { scope, scopeId })).ToList();
        if (rows.Count == 0) return new();

        var steps = (await conn.QueryAsync<(int StepId, int ProgressionId, string Role, string Status, DateTime? Decided)>(@"
            SELECT pk_step_id, fk_progression_id, role, status, decided_date FROM officer_progression_step
            WHERE fk_progression_id IN @ids", new { ids = rows.Select(r => r.Id).ToArray() }))
            .ToLookup(s => s.ProgressionId);

        var yearIds = (await conn.QueryAsync<(string Label, int Id)>(
            "SELECT YearLabel, pk_year_id FROM rotary_year_master WHERE COALESCE(isdeleted,0) = 0"))
            .ToDictionary(y => y.Label, y => y.Id);

        var result = new List<ProgressionDto>();
        foreach (var r in rows)
        {
            var dto = new ProgressionDto
            {
                ProgressionId = r.Id, Scope = scope, ScopeId = scopeId, MemberId = r.MemberId, MemberName = r.Name,
                NomineeYearLabel = OfficerProgressionChain.YearLabel(r.Start), CreatedDate = DateTime.SpecifyKind(r.Created, DateTimeKind.Utc),
            };
            foreach (var plan in OfficerProgressionChain.Build(scope, r.Start))
            {
                var s = steps[r.Id].FirstOrDefault(x => x.Role == plan.Role);
                if (s.StepId == 0) continue;
                int? yearId = yearIds.TryGetValue(plan.YearLabel, out var y) ? y : null;
                var step = new ProgressionStepDto
                {
                    StepId = s.StepId, Role = plan.Role, Title = plan.Title, YearLabel = plan.YearLabel, YearId = yearId,
                    Status = s.Status, AppliesTo = plan.AppliesTo,
                    DecidedDate = s.Decided is DateTime dd ? DateTime.SpecifyKind(dd, DateTimeKind.Utc) : null,
                };
                if (yearId is int yid && await HolderAsync(conn, scope, scopeId, plan.Role, yid) is (int hid, string hname))
                {
                    step.CurrentHolderName = hname;
                    step.CurrentHolderIsNominee = hid == r.MemberId;
                }
                dto.Steps.Add(step);
            }
            result.Add(dto);
        }
        return result;
    }

    public async Task<List<ProgressionCandidateDto>> CandidatesAsync(string scope, int scopeId, string? search)
    {
        await using var conn = await OpenAsync();
        var like = "%" + (search ?? "").Trim() + "%";
        var clubFilter = scope == OfficerProgressionChain.Club ? "c.pk_club_id = @scopeId" : "c.fk_district_id = @scopeId";
        return (await conn.QueryAsync<ProgressionCandidateDto>($@"
            SELECT DISTINCT m.pk_member_master_profile_id AS MemberId, m.MemberName, c.ClubName
            FROM club_members cm
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            WHERE {clubFilter} AND cm.IsActive = 1 AND IFNULL(cm.isdeleted,0) = 0 AND m.MemberName LIKE @like
            ORDER BY m.MemberName LIMIT 30", new { scopeId, like })).ToList();
    }

    public async Task<int> CreateAsync(string scope, int scopeId, int memberId, int nomineeStartYear, int by)
    {
        if (!OfficerProgressionChain.IsScope(scope)) throw new ArgumentException("Scope must be 'club' or 'district'.");
        if (memberId <= 0) throw new ArgumentException("Choose the nominee.");
        await using var conn = await OpenAsync();
        if (!OfficerProgressionChain.IsNomineeYearAllowed(nomineeStartYear, await CurrentStartYearAsync(conn)))
            throw new ArgumentException("The nominee year must be within three years of the current Rotary year.");
        if (!await IsInScopeAsync(conn, scope, scopeId, memberId))
            throw new ArgumentException(scope == OfficerProgressionChain.Club
                ? "The nominee must be an active member of this club."
                : "The nominee must be an active member of a club in this district.");

        await using var tx = await conn.BeginTransactionAsync();
        var taken = await conn.ExecuteScalarAsync<string?>(@"
            SELECT COALESCE(m.MemberName, '') FROM officer_progression p
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = p.fk_member_id
            WHERE p.scope = @scope AND p.scope_id = @scopeId AND p.nominee_start_year = @nomineeStartYear AND p.isdeleted = 0
            LIMIT 1 FOR UPDATE", new { scope, scopeId, nomineeStartYear }, tx);
        if (taken != null)
            throw new InvalidOperationException($"{taken} is already the nominee for {OfficerProgressionChain.YearLabel(nomineeStartYear)}. Remove that chain first.");

        var id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO officer_progression (scope, scope_id, fk_member_id, nominee_start_year, created_by, created_date)
            VALUES (@scope, @scopeId, @memberId, @nomineeStartYear, @by, UTC_TIMESTAMP());
            SELECT LAST_INSERT_ID();", new { scope, scopeId, memberId, nomineeStartYear, by }, tx);
        foreach (var s in OfficerProgressionChain.Build(scope, nomineeStartYear))
            await conn.ExecuteAsync(@"
                INSERT INTO officer_progression_step (fk_progression_id, role, start_year, status)
                VALUES (@id, @Role, @StartYear, 'pending')", new { id, s.Role, s.StartYear }, tx);
        await tx.CommitAsync();
        return id;
    }

    public async Task<(string Scope, int ScopeId)?> ProgressionScopeAsync(int progressionId)
    {
        await using var conn = await OpenAsync();
        return First(await conn.QueryAsync<(string, int)>(
            "SELECT scope, scope_id FROM officer_progression WHERE pk_progression_id = @progressionId AND isdeleted = 0",
            new { progressionId }));
    }

    public async Task<(string Scope, int ScopeId, int? YearId)?> StepScopeAsync(int stepId)
    {
        await using var conn = await OpenAsync();
        var row = First(await conn.QueryAsync<(string Scope, int ScopeId, int Start)>(@"
            SELECT p.scope, p.scope_id, s.start_year FROM officer_progression_step s
            JOIN officer_progression p ON p.pk_progression_id = s.fk_progression_id AND p.isdeleted = 0
            WHERE s.pk_step_id = @stepId", new { stepId }));
        if (row is not (string scope, int scopeId, int start)) return null;
        return (scope, scopeId, await YearIdAsync(conn, OfficerProgressionChain.YearLabel(start)));
    }

    public async Task DeleteAsync(int progressionId, int by)
    {
        await using var conn = await OpenAsync();
        // Confirmed steps already wrote board / governor rows; those stay, as the board screen owns them now.
        await conn.ExecuteAsync(@"
            UPDATE officer_progression SET isdeleted = 1, deleted_by = @by, deleted_date = UTC_TIMESTAMP()
            WHERE pk_progression_id = @progressionId AND isdeleted = 0", new { progressionId, by });
    }

    public async Task DismissStepAsync(int stepId, int by)
    {
        await using var conn = await OpenAsync();
        var n = await conn.ExecuteAsync(@"
            UPDATE officer_progression_step SET status = 'dismissed', decided_by = @by, decided_date = UTC_TIMESTAMP()
            WHERE pk_step_id = @stepId AND status = 'pending'", new { stepId, by });
        if (n == 0) throw new InvalidOperationException("This suggestion was already decided.");
    }

    public async Task<string> ConfirmStepAsync(int stepId, int by)
    {
        await using var conn = await OpenAsync();
        var row = First(await conn.QueryAsync<(string Scope, int ScopeId, int MemberId, int Start, string Role)>(@"
            SELECT p.scope, p.scope_id, p.fk_member_id, p.nominee_start_year, s.role FROM officer_progression_step s
            JOIN officer_progression p ON p.pk_progression_id = s.fk_progression_id AND p.isdeleted = 0
            WHERE s.pk_step_id = @stepId", new { stepId }));
        if (row is not (string scope, int scopeId, int memberId, int start, string role)) throw new KeyNotFoundException("Suggestion not found.");
        var plan = OfficerProgressionChain.Step(scope, start, role);
        var yearId = await YearIdAsync(conn, plan.YearLabel)
            ?? throw new InvalidOperationException($"Rotary year {plan.YearLabel} is not open yet. Confirm this after the year is created.");

        // Claim the step first so two admins confirming at once cannot both write the office.
        if (await conn.ExecuteAsync(
                "UPDATE officer_progression_step SET status = 'applying' WHERE pk_step_id = @stepId AND status = 'pending'",
                new { stepId }) == 0)
            throw new InvalidOperationException("This suggestion was already decided.");

        try
        {
            string? appliedRef = null;
            if (plan.AppliesTo != "record")
            {
                var holder = await HolderAsync(conn, scope, scopeId, role, yearId);
                if (holder is (int hid, string hname) && hid != memberId)
                    // Never overwrite: the admin changes the office on the board / governor screen if they mean it.
                    throw new InvalidOperationException(
                        $"{hname} already holds {plan.Title} for {plan.YearLabel}. Change it on the {(plan.AppliesTo == "board" ? "Board of Directors" : "District Governors")} page first.");
                if (holder == null)
                    appliedRef = plan.AppliesTo == "board"
                        ? await ApplyBoardAsync(conn, scopeId, memberId, plan, yearId, by)
                        : await ApplyGovernorAsync(conn, scopeId, memberId, yearId, by);
            }

            await conn.ExecuteAsync(@"
                UPDATE officer_progression_step SET status = 'confirmed', applied_ref = @appliedRef, decided_by = @by, decided_date = UTC_TIMESTAMP()
                WHERE pk_step_id = @stepId", new { stepId, appliedRef, by });
            return appliedRef == null ? $"{plan.Title} {plan.YearLabel} confirmed." : $"{plan.Title} {plan.YearLabel} confirmed and added.";
        }
        catch
        {
            await conn.ExecuteAsync("UPDATE officer_progression_step SET status = 'pending' WHERE pk_step_id = @stepId AND status = 'applying'", new { stepId });
            throw;
        }
    }

    private async Task<string> ApplyBoardAsync(MySqlConnection conn, int clubId, int memberId, ProgressionStepPlan plan, int yearId, int by)
    {
        var desName = OfficerProgressionChain.BoardDesignation(plan.Role)!;
        var desId = await conn.ExecuteScalarAsync<int?>(
            "SELECT pk_designation_id FROM designation_master WHERE designation_name = @desName AND isdeleted = 0 LIMIT 1", new { desName })
            ?? throw new InvalidOperationException($"The designation '{desName}' does not exist.");
        // The same path as the Board of Directors screen, with its one-president-per-year rules.
        var id = await _board.CreateAsync(clubId, new CreateBoardDirectorDto { MemberId = memberId, DesignationId = desId, YearId = yearId }, by);
        return $"board_of_directors:{id}";
    }

    private static async Task<string> ApplyGovernorAsync(MySqlConnection conn, int districtId, int memberId, int yearId, int by)
    {
        var id = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO district_governors (fk_district_id, fk_year_id, fk_member_id, member_name, email, mobile_number, created_by, isdeleted)
            SELECT @districtId, @yearId, m.pk_member_master_profile_id, m.MemberName, m.EmailId, m.PrimaryMobileNumber, @by, 0
            FROM member_master_profile m WHERE m.pk_member_master_profile_id = @memberId;
            SELECT LAST_INSERT_ID();", new { districtId, yearId, memberId, by });
        return $"district_governors:{id}";
    }

    public async Task<List<ProgressionSuggestionDto>> GetPendingForYearAsync(int yearId)
    {
        await using var conn = await OpenAsync();
        var label = await conn.ExecuteScalarAsync<string?>("SELECT YearLabel FROM rotary_year_master WHERE pk_year_id = @yearId", new { yearId });
        if (label == null || !int.TryParse(label[..4], out var startYear)) return new();
        var rows = await conn.QueryAsync<(int StepId, string Scope, int ScopeId, int MemberId, string Name, int Start, string Role)>(@"
            SELECT s.pk_step_id, p.scope, p.scope_id, p.fk_member_id, COALESCE(m.MemberName, ''), p.nominee_start_year, s.role
            FROM officer_progression_step s
            JOIN officer_progression p ON p.pk_progression_id = s.fk_progression_id AND p.isdeleted = 0
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = p.fk_member_id
            WHERE s.start_year = @startYear AND s.status = 'pending'", new { startYear });
        return rows.Select(r =>
        {
            var plan = OfficerProgressionChain.Step(r.Scope, r.Start, r.Role);
            return new ProgressionSuggestionDto
            {
                StepId = r.StepId, Scope = r.Scope, ScopeId = r.ScopeId, MemberId = r.MemberId, MemberName = r.Name,
                Role = r.Role, Title = plan.Title, YearLabel = plan.YearLabel,
            };
        }).ToList();
    }
}

/// <summary>Feeds the year-end rollover preview with the officer-progression steps still pending for the new year.</summary>
public sealed class OfficerProgressionRolloverSource(IOfficerProgressionService progression) : IRolloverProgressionSource
{
    public async Task<IReadOnlyList<RolloverPendingStep>> GetPendingAsync(string scope, int scopeId, int toYearId) =>
        (await progression.GetPendingForYearAsync(toYearId))
            .Where(s => s.Scope == scope && s.ScopeId == scopeId)
            .Select(s => new RolloverPendingStep(s.Role, s.MemberId, s.MemberName, "pending"))
            .ToList();
}
