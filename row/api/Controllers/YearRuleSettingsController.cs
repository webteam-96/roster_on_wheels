using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Settings → Year-wise Admin Rights. SuperAdmin switches the year rule ON or OFF
/// per district and per club, with a platform-wide default underneath.
///
/// OFF means that scope behaves as the platform did before YWAR: an admin of the
/// club or district adds, edits and deletes in ANY Rotary year. It does NOT make
/// anyone an admin who was not already one — see
/// <see cref="AdminYearService.GetClubRightsAsync"/>.
///
/// Every write here goes through <see cref="YearRuleScopeHelper"/> so the resolve
/// cache cannot be left stale, and is picked up automatically by AuditMiddleware
/// (any successful PUT/DELETE lands in audit_log).
/// </summary>
[ApiController]
[Authorize]
public class YearRuleSettingsController : ControllerBase
{
    private readonly string _connectionString;
    private readonly YearRuleScopeHelper _scope;
    private readonly IAdminYearService _years;
    private readonly YearRuleMessagesHelper _messages;

    public YearRuleSettingsController(
        IConfiguration config, YearRuleScopeHelper scope, IAdminYearService years,
        YearRuleMessagesHelper messages)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        _scope = scope;
        _years = years;
        _messages = messages;
    }

    private bool IsSuperAdmin() => User.FindFirst("roles")?.Value?.Contains("SuperAdmin") == true;
    private int GetUserId() => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    private ObjectResult SuperAdminOnly() =>
        StatusCode(403, new { message = "Only SuperAdmin can change Year-wise Admin Rights settings." });

    private async Task<MySqlConnection> OpenAsync()
    {
        var conn = RowDb.Connect(_connectionString);
        await conn.OpenAsync();
        return conn;
    }

    // ── DTOs ────────────────────────────────────────────────────────────────

    public class ScopeOverrideDto
    {
        public int DistrictId { get; set; }
        public string? DistrictNumber { get; set; }
        public int ClubId { get; set; }
        public string? ClubName { get; set; }
        public bool IsEnabled { get; set; }
        public string? Notes { get; set; }
        public string? ModifiedDate { get; set; }
        public string? ModifiedByName { get; set; }
    }

    public class YearRuleSettingsDto
    {
        /// <summary>The platform default. Always present — seeded ON by the migration.</summary>
        public bool GlobalEnabled { get; set; }
        public string? GlobalModifiedDate { get; set; }
        public string? GlobalModifiedByName { get; set; }
        public List<ScopeOverrideDto> Districts { get; set; } = new();
        public List<ScopeOverrideDto> Clubs { get; set; } = new();
    }

    public class SetFlagDto
    {
        public bool IsEnabled { get; set; }
        public string? Notes { get; set; }
    }

    // ── Read ────────────────────────────────────────────────────────────────

    /// <summary>The platform default plus every live override, with names for display.</summary>
    [HttpGet("api/settings/year-rule")]
    public async Task<ActionResult<YearRuleSettingsDto>> Get()
    {
        if (!IsSuperAdmin()) return SuperAdminOnly();

        await using var conn = await OpenAsync();
        var rows = (await conn.QueryAsync<ScopeOverrideDto>(@"
            SELECT s.fk_district_id AS DistrictId,
                   d.DistrictNumber  AS DistrictNumber,
                   s.fk_club_id      AS ClubId,
                   c.ClubName        AS ClubName,
                   s.IsEnabled       AS IsEnabled,
                   s.Notes           AS Notes,
                   DATE_FORMAT(COALESCE(s.modified_date, s.created_date), '%d %b %Y, %h:%i %p') AS ModifiedDate,
                   m.MemberName      AS ModifiedByName
            FROM year_rule_scope_settings s
            LEFT JOIN club_master c     ON c.pk_club_id = s.fk_club_id
            LEFT JOIN district_master d ON d.pk_district_id =
                       CASE WHEN s.fk_club_id > 0 THEN c.fk_district_id ELSE s.fk_district_id END
            LEFT JOIN member_master_profile m
                   ON m.pk_member_master_profile_id = COALESCE(s.modified_by, s.created_by)
            WHERE COALESCE(s.isdeleted, 0) = 0
            ORDER BY d.DistrictNumber, c.ClubName")).ToList();

        var global = rows.FirstOrDefault(r => r.DistrictId == 0 && r.ClubId == 0);

        return Ok(new YearRuleSettingsDto
        {
            // No global row at all means the migration has not run. Report ON, which
            // is what the API actually does in that state (see
            // YearRuleScopeHelper.DefaultWhenMissing) rather than a cheerier lie.
            GlobalEnabled = global?.IsEnabled ?? true,
            GlobalModifiedDate = global?.ModifiedDate,
            GlobalModifiedByName = global?.ModifiedByName,
            Districts = rows.Where(r => r.ClubId == 0 && r.DistrictId > 0).ToList(),
            Clubs = rows.Where(r => r.ClubId > 0).ToList(),
        });
    }

    /// <summary>
    /// What the rule resolves to for one scope, and which row decided it. Diagnostic —
    /// the same call the guard makes, so it answers "why can this person edit 2019-20?".
    /// </summary>
    [HttpGet("api/settings/year-rule/effective")]
    public async Task<ActionResult> Effective([FromQuery] int clubId, [FromQuery] int districtId)
    {
        if (!IsSuperAdmin()) return SuperAdminOnly();
        if (clubId <= 0 && districtId <= 0)
            return BadRequest(new { message = "Pass clubId or districtId." });

        await using var conn = await OpenAsync();
        var (enabled, source) = clubId > 0
            ? await _scope.ResolveClubAsync(conn, clubId)
            : await _scope.ResolveDistrictAsync(conn, districtId);

        return Ok(new { isEnabled = enabled, decidedBy = source });
    }

    // ── Write ───────────────────────────────────────────────────────────────

    [HttpPut("api/settings/year-rule/global")]
    public async Task<ActionResult> SetGlobal([FromBody] SetFlagDto dto)
    {
        if (!IsSuperAdmin()) return SuperAdminOnly();

        await using var conn = await OpenAsync();
        await _scope.SetAsync(conn, 0, 0, dto.IsEnabled, GetUserId(), dto.Notes ?? "Platform default");
        return Ok(new
        {
            message = dto.IsEnabled
                ? "Year-wise Admin Rights is now ON by default for every district and club without its own setting."
                : "Year-wise Admin Rights is now OFF by default. Only districts and clubs switched on below will enforce it.",
            isEnabled = dto.IsEnabled,
        });
    }

    [HttpPut("api/settings/year-rule/district/{districtId:int}")]
    public async Task<ActionResult> SetDistrict(int districtId, [FromBody] SetFlagDto dto)
    {
        if (!IsSuperAdmin()) return SuperAdminOnly();
        if (districtId <= 0) return BadRequest(new { message = "districtId is required." });

        await using var conn = await OpenAsync();
        var exists = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM district_master WHERE pk_district_id = @D", new { D = districtId });
        if (exists == 0) return NotFound(new { message = "District not found." });

        await _scope.SetAsync(conn, districtId, 0, dto.IsEnabled, GetUserId(), dto.Notes);
        return Ok(new { message = dto.IsEnabled ? "Year rule switched ON for this district." : "Year rule switched OFF for this district.", isEnabled = dto.IsEnabled });
    }

    [HttpDelete("api/settings/year-rule/district/{districtId:int}")]
    public async Task<ActionResult> ClearDistrict(int districtId)
    {
        if (!IsSuperAdmin()) return SuperAdminOnly();
        await using var conn = await OpenAsync();
        await _scope.ClearAsync(conn, districtId, 0, GetUserId());
        return Ok(new { message = "District setting cleared. It now follows the platform default." });
    }

    [HttpPut("api/settings/year-rule/club/{clubId:int}")]
    public async Task<ActionResult> SetClub(int clubId, [FromBody] SetFlagDto dto)
    {
        if (!IsSuperAdmin()) return SuperAdminOnly();
        if (clubId <= 0) return BadRequest(new { message = "clubId is required." });

        await using var conn = await OpenAsync();
        var exists = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM club_master WHERE pk_club_id = @C", new { C = clubId });
        if (exists == 0) return NotFound(new { message = "Club not found." });

        // Club overrides are stored with fk_district_id = 0 so uq_year_rule_scope has
        // one row per club regardless of which district the club sits in today. The
        // district is resolved from club_master at read time.
        await _scope.SetAsync(conn, 0, clubId, dto.IsEnabled, GetUserId(), dto.Notes);
        return Ok(new { message = dto.IsEnabled ? "Year rule switched ON for this club." : "Year rule switched OFF for this club.", isEnabled = dto.IsEnabled });
    }

    [HttpDelete("api/settings/year-rule/club/{clubId:int}")]
    public async Task<ActionResult> ClearClub(int clubId)
    {
        if (!IsSuperAdmin()) return SuperAdminOnly();
        await using var conn = await OpenAsync();
        await _scope.ClearAsync(conn, 0, clubId, GetUserId());
        return Ok(new { message = "Club setting cleared. It now follows its district." });
    }

    // ── "View only" wording ─────────────────────────────────────────────────
    //
    // The four sentences the clients show when the year rule withholds Add /
    // Edit / Delete. Platform-wide, not per scope: the ON/OFF switch above is a
    // policy and belongs per district and club, but this is product copy and has
    // to read the same everywhere.
    //
    // The clients READ these from /api/auth/my-context, not from here — this pair
    // is the editor. See YearRuleMessagesHelper for the tokens.

    public class MessageDto
    {
        public string Key { get; set; } = "";
        /// <summary>What a reader sees today — the stored text, or the default.</summary>
        public string Template { get; set; } = "";
        public string Default { get; set; } = "";
        /// <summary>False when nobody has edited it, so the UI can hide "Reset".</summary>
        public bool IsCustom { get; set; }
        public string? ModifiedDate { get; set; }
        public string? ModifiedByName { get; set; }
    }

    public class MessagesSettingsDto
    {
        public List<MessageDto> Messages { get; set; } = new();
        /// <summary>The tokens a template may use, for the editor's help text.</summary>
        public List<TokenDto> Tokens { get; set; } = new();
    }

    public class TokenDto
    {
        public string Token { get; set; } = "";
        public string Describes { get; set; } = "";
        /// <summary>What a screen that cannot fill it shows instead.</summary>
        public string Fallback { get; set; } = "";
    }

    public class SetMessageDto
    {
        public string Key { get; set; } = "";
        /// <summary>Blank or missing RESETS this message to its default.</summary>
        public string? Template { get; set; }
    }

    /// <summary>Every message with its default, for the Settings editor.</summary>
    [HttpGet("api/settings/year-rule/messages")]
    public async Task<ActionResult<MessagesSettingsDto>> GetMessages()
    {
        if (!IsSuperAdmin()) return SuperAdminOnly();

        var stored = await _messages.GetStoredAsync();
        var result = new MessagesSettingsDto
        {
            Tokens = new List<TokenDto>
            {
                new() { Token = "{year}", Describes = "The Rotary year on screen", Fallback = "this Rotary year" },
                new() { Token = "{currentYear}", Describes = "The current Rotary year", Fallback = "the current year" },
                new() { Token = "{years}", Describes = "The years this member may edit", Fallback = "(clause is dropped)" },
                new() { Token = "{actions}", Describes = "What is being withheld", Fallback = YearRuleMessagesHelper.Defaults[YearRuleMessagesHelper.KeyDefaultActions] },
            },
        };

        foreach (var key in YearRuleMessagesHelper.AllKeys)
        {
            var def = YearRuleMessagesHelper.Defaults[key];
            stored.TryGetValue(key, out var row);
            // A seeded row holds the default text; only a different text counts as edited.
            var custom = !string.IsNullOrWhiteSpace(row?.Template) && row!.Template.Trim() != def.Trim();
            result.Messages.Add(new MessageDto
            {
                Key = key,
                Template = custom ? row!.Template.Trim() : def,
                Default = def,
                IsCustom = custom,
                ModifiedDate = custom ? row!.ModifiedDate : null,
                ModifiedByName = custom ? row!.ModifiedByName : null,
            });
        }

        return Ok(result);
    }

    /// <summary>
    /// Save one message, or reset it by sending a blank template.
    ///
    /// Picked up by AuditMiddleware like the switches above, so a wording change
    /// is as traceable as flipping the rule itself.
    /// </summary>
    [HttpPut("api/settings/year-rule/messages")]
    public async Task<ActionResult> SetMessage([FromBody] SetMessageDto dto)
    {
        if (!IsSuperAdmin()) return SuperAdminOnly();

        var key = (dto.Key ?? "").Trim();
        if (!YearRuleMessagesHelper.AllKeys.Contains(key))
            return BadRequest(new { message = "Unknown message." });

        var problem = YearRuleMessagesHelper.Validate(key, dto.Template);
        if (problem != null) return BadRequest(new { message = problem });

        var reset = string.IsNullOrWhiteSpace(dto.Template);
        await _messages.SetAsync(key, dto.Template, GetUserId());

        // The saved wording goes back so the caller renders what the SERVER now
        // holds rather than what was typed — the two differ on a reset, and on the
        // trim every other client would have to remember to do.
        var live = await _messages.GetAsync();
        return Ok(new
        {
            message = reset
                ? "Message reset to the default wording."
                : "Message saved. Web and the mobile app will show it from the next sign-in or app open.",
            key,
            isCustom = !reset,
            template = key switch
            {
                YearRuleMessagesHelper.KeyCurrentYearOnly => live.CurrentYearOnly,
                YearRuleMessagesHelper.KeyWrongYearWithYears => live.WrongYearWithYears,
                YearRuleMessagesHelper.KeyWrongYearNoYears => live.WrongYearNoYears,
                _ => live.DefaultActions,
            },
        });
    }

    // ── Preflight ───────────────────────────────────────────────────────────

    public class PreflightAdminDto
    {
        public int MemberId { get; set; }
        public string? MemberName { get; set; }
        /// <summary>"Club President", "Granted", … — why they hold what they hold.</summary>
        public List<string> Sources { get; set; } = new();
        public List<string> Years { get; set; } = new();
        public bool AllYears { get; set; }
        /// <summary>No years and no All Years — every edit button goes away when the rule comes on.</summary>
        public bool WouldLoseAccess { get; set; }
    }

    public class PreflightDto
    {
        public string ScopeLabel { get; set; } = "";
        public int AllYearsCount { get; set; }
        public int SomeYearsCount { get; set; }
        public int NoYearsCount { get; set; }
        public List<PreflightAdminDto> Admins { get; set; } = new();

        /// <summary>District flips only: clubs underneath that will newly start enforcing.</summary>
        public int CascadeClubCount { get; set; }
        /// <summary>District flips only: club admins across those clubs who hold no years.</summary>
        public int CascadeAdminsWithNoYears { get; set; }
    }

    /// <summary>
    /// Who loses what if this scope is switched ON. Must be shown before any flip to
    /// ON: a District Admin who is not the Governor and was never granted years goes
    /// from editing everything to editing nothing the moment the rule applies.
    /// </summary>
    [HttpGet("api/settings/year-rule/preflight")]
    public async Task<ActionResult<PreflightDto>> Preflight([FromQuery] int clubId, [FromQuery] int districtId)
    {
        if (!IsSuperAdmin()) return SuperAdminOnly();
        if (clubId <= 0 && districtId <= 0)
            return BadRequest(new { message = "Pass clubId or districtId." });

        await using var conn = await OpenAsync();
        var result = new PreflightDto();
        var yearLabels = (await conn.QueryAsync<(int Id, string Label)>(
                "SELECT pk_year_id AS Id, YearLabel AS Label FROM rotary_year_master WHERE COALESCE(isdeleted,0) = 0"))
            .ToDictionary(r => r.Id, r => r.Label);

        if (clubId > 0)
        {
            result.ScopeLabel = await conn.ExecuteScalarAsync<string?>(
                "SELECT ClubName FROM club_master WHERE pk_club_id = @C", new { C = clubId }) ?? $"Club {clubId}";

            foreach (var memberId in await ClubAdminMemberIdsAsync(conn, clubId))
            {
                // ⚠️ IfRuleOn, not the live rights: the rule is still OFF right now, so
                // the live call would report every one of them as All Years and the
                // dialog would cheerfully say nobody is affected.
                var rights = await _years.GetClubRightsIfRuleOnAsync(conn, memberId, clubId);
                result.Admins.Add(await ToAdminDtoAsync(conn, memberId, rights, yearLabels));
            }
        }
        else
        {
            result.ScopeLabel = "District " + (await conn.ExecuteScalarAsync<string?>(
                "SELECT DistrictNumber FROM district_master WHERE pk_district_id = @D", new { D = districtId }) ?? districtId.ToString());

            foreach (var memberId in await DistrictAdminMemberIdsAsync(conn, districtId))
            {
                var rights = await _years.GetDistrictRightsIfRuleOnAsync(conn, memberId, districtId);
                result.Admins.Add(await ToAdminDtoAsync(conn, memberId, rights, yearLabels));
            }

            // A district setting cascades to every club that has no setting of its own.
            // Counts only, by one bulk query — walking every club's admins through the
            // service would be hundreds of round trips for a large district.
            //
            // The bulk test is narrower than the service's: "holds no year at all" =
            // no live manual grant row anywhere AND no President / Secretary /
            // Executive Secretary office in that club. That is exactly the
            // WouldLoseAccess case, which is the only one this count is used for.
            result.CascadeClubCount = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM club_master c
                WHERE c.fk_district_id = @D
                  AND NOT EXISTS (
                      SELECT 1 FROM year_rule_scope_settings s
                      WHERE s.fk_club_id = c.pk_club_id AND COALESCE(s.isdeleted,0) = 0)",
                new { D = districtId });

            result.CascadeAdminsWithNoYears = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(DISTINCT mr.fk_member_master_profile_id, mr.fk_club_id)
                FROM member_roles mr
                JOIN club_master c ON c.pk_club_id = mr.fk_club_id AND c.fk_district_id = @D
                WHERE mr.fk_role_id = 2
                  AND mr.IsActive = 1 AND COALESCE(mr.isdeleted,0) = 0
                  AND NOT EXISTS (
                      SELECT 1 FROM year_rule_scope_settings s
                      WHERE s.fk_club_id = c.pk_club_id AND COALESCE(s.isdeleted,0) = 0)
                  AND NOT EXISTS (
                      SELECT 1 FROM member_admin_years g
                      WHERE g.fk_member_master_profile_id = mr.fk_member_master_profile_id
                        AND g.fk_club_id = mr.fk_club_id
                        AND g.IsActive = 1 AND COALESCE(g.isdeleted,0) = 0)
                  AND NOT EXISTS (
                      SELECT 1 FROM board_of_directors b
                      WHERE b.fk_member_master_profile_id = mr.fk_member_master_profile_id
                        AND b.fk_club_id = mr.fk_club_id
                        AND COALESCE(b.isdeleted,0) = 0
                        AND b.fk_designation_id IN (1, 2, 6))",
                new { D = districtId });
        }

        result.AllYearsCount = result.Admins.Count(a => a.AllYears);
        result.SomeYearsCount = result.Admins.Count(a => !a.AllYears && a.Years.Count > 0);
        result.NoYearsCount = result.Admins.Count(a => a.WouldLoseAccess);
        return Ok(result);
    }

    // ── Preflight helpers ───────────────────────────────────────────────────

    private static async Task<PreflightAdminDto> ToAdminDtoAsync(
        MySqlConnection conn, int memberId, AdminYearRights rights, Dictionary<int, string> yearLabels)
    {
        var name = await conn.ExecuteScalarAsync<string?>(
            "SELECT MemberName FROM member_master_profile WHERE pk_member_master_profile_id = @Id",
            new { Id = memberId });

        return new PreflightAdminDto
        {
            MemberId = memberId,
            MemberName = name ?? $"Member {memberId}",
            Sources = rights.Sources,
            AllYears = rights.AllYears,
            Years = rights.AllYears
                ? new List<string>()
                : rights.YearIds.Select(y => yearLabels.TryGetValue(y, out var l) ? l : y.ToString())
                                .OrderByDescending(l => l).ToList(),
            WouldLoseAccess = !rights.Any,
        };
    }

    // Everyone who can currently write in this club: the Admin role on the club, the
    // rights-bearing offices, and District Admins reaching in with all-clubs access.
    private static async Task<List<int>> ClubAdminMemberIdsAsync(MySqlConnection conn, int clubId)
        => (await conn.QueryAsync<int>(@"
            SELECT DISTINCT mr.fk_member_master_profile_id
            FROM member_roles mr
            WHERE mr.fk_role_id = 2 AND mr.fk_club_id = @C
              AND mr.IsActive = 1 AND COALESCE(mr.isdeleted,0) = 0
            UNION
            SELECT DISTINCT b.fk_member_master_profile_id
            FROM board_of_directors b
            WHERE b.fk_club_id = @C AND COALESCE(b.isdeleted,0) = 0
              AND b.fk_designation_id IN (1, 2, 6)
            UNION
            SELECT DISTINCT mr.fk_member_master_profile_id
            FROM member_roles mr
            JOIN club_master c ON c.pk_club_id = @C
            WHERE mr.fk_role_id = 2 AND mr.fk_district_id = c.fk_district_id
              AND COALESCE(mr.fk_club_id, 0) = 0 AND COALESCE(mr.AllClubsAccess, 0) = 1
              AND mr.IsActive = 1 AND COALESCE(mr.isdeleted,0) = 0",
            new { C = clubId })).ToList();

    // District Admins plus any District Governor on record (the DG earns the year
    // they govern, so they must appear even without an Admin role row).
    private static async Task<List<int>> DistrictAdminMemberIdsAsync(MySqlConnection conn, int districtId)
        => (await conn.QueryAsync<int>(@"
            SELECT DISTINCT mr.fk_member_master_profile_id
            FROM member_roles mr
            WHERE mr.fk_role_id = 2 AND mr.fk_district_id = @D
              AND COALESCE(mr.fk_club_id, 0) = 0
              AND mr.IsActive = 1 AND COALESCE(mr.isdeleted,0) = 0
            UNION
            SELECT DISTINCT g.fk_member_id
            FROM district_governors g
            WHERE g.fk_district_id = @D AND g.fk_member_id IS NOT NULL
              AND COALESCE(g.isdeleted,0) = 0",
            new { D = districtId })).ToList();
}
