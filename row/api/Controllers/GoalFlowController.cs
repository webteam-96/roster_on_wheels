using System.Globalization;
using System.Text.Json;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

// New goal flow (user 2026-11-17). Year-wise.
//
//   District Set Goals  DG -> clubs. The questions ARE the District Awards questions of the district + year
//                       (same tables - nothing copied, so no duplicates). The DG puts one Goal number on a
//                       line (all clubs get the same goal); the club answers exactly as in District Awards
//                       (auto = counted by the system, manual = typed). Goal numbers live in
//                       district_set_goal_targets; answers stay in district_citation_club_entry.
//   Disha Goals         RI Director (or Super Admin) -> district. Own tables (disha_goal_questions /
//                       disha_goal_answers). The District Admin answers manual questions; auto questions are
//                       counted over the district's clubs with the District Awards counting rules.
//
//   Goal: Number and auto lines take a Goal number (achievement % = answer / goal). Yes/No: achieved = Yes.
//   Choose one / Text: no goal. Points / bonus stay a District Awards thing and are not shown here.
[ApiController]
[Authorize]
public class GoalFlowController : ControllerBase, IAsyncActionFilter
{
    // Who may use District Set Goals (go-live, user 2026-11-19):
    //   Super Admin - everything.
    //   DG (District Admin) - their own district and its clubs.
    //   Club Admin - their own club only.
    // Every district / club route is checked here (reads too); the write routes keep their own checks below.
    // The old "goal-flow/disha" routes stay Super Admin only (Disha Goals live in DishaAwardsController).
    [NonAction]
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        if (IsSuperAdmin) { await next(); return; }
        var path = context.HttpContext.Request.Path.Value ?? "";
        ObjectResult? denied = null;
        if (path.StartsWith("/api/goal-flow/district-set-goals/district/", StringComparison.OrdinalIgnoreCase)
            && context.ActionArguments.TryGetValue("districtId", out var dv) && dv is int districtId)
            denied = await _guard.DistrictYearlessAsync(User, districtId);
        else if (path.StartsWith("/api/goal-flow/district-set-goals/club/", StringComparison.OrdinalIgnoreCase)
            && context.ActionArguments.TryGetValue("clubId", out var cv) && cv is int clubId)
        {
            if (await _guard.ClubYearlessAsync(User, clubId) != null)
            {
                await using var conn = await OpenAsync();
                var d = await conn.ExecuteScalarAsync<int>("SELECT fk_district_id FROM club_master WHERE pk_club_id = @C", new { C = clubId });
                denied = d > 0 ? await _guard.DistrictYearlessAsync(User, d) : StatusCode(404, new { message = "Club not found." });
            }
        }
        else if (!path.Equals("/api/goal-flow/risao-sources", StringComparison.OrdinalIgnoreCase))
            denied = StatusCode(403, new { message = "This page is not available." });
        if (denied != null) { context.Result = denied; return; }
        await next();
    }

    private readonly string _cs;
    private readonly AdminYearGuard _guard;
    public GoalFlowController(IConfiguration config, AdminYearGuard guard)
    {
        _cs = config.GetConnectionString("DefaultConnection")!;
        _guard = guard;
    }

    private int MemberId => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;
    private bool IsSuperAdmin => User.FindFirst("roles")?.Value?.Contains("SuperAdmin") == true;
    private async Task<MySqlConnection> OpenAsync() { var c = new MySqlConnection(_cs); await c.OpenAsync(); return c; }

    private static async Task<int> ResolveYearAsync(MySqlConnection conn, int? yearId) =>
        yearId > 0 ? yearId.Value
            : await conn.ExecuteScalarAsync<int?>("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1") ?? 0;

    internal static string NormType(string? raw, bool hasOptions)
    {
        var r = (raw ?? "").ToLowerInvariant().Replace(" ", "").Replace("_", "").Replace("-", "").Replace("/", "");
        if (r == "text") return "text";
        if (r is "yesno" or "yn" or "boolean" or "bool" or "yes" or "no") return "yesno";
        if (r is "chooseone" or "choose" or "select" or "option" or "options" or "radio" || hasOptions) return "choose_one";
        return "number";
    }

    internal static decimal? Num(string? s) =>
        decimal.TryParse((s ?? "").Replace(",", "").Trim(), NumberStyles.Number, CultureInfo.InvariantCulture, out var d) ? d : null;

    // Achievement % (same idea as Goal Setting: no 100 cap, whole number shown by the screen).
    internal static decimal? Pct(string type, decimal? goal, string? answer)
    {
        if (type == "yesno") return string.IsNullOrEmpty(answer) ? null : (answer == "yes" ? 100 : 0);
        if (type != "number" || goal is not > 0) return null;
        var a = Num(answer);
        return a == null ? null : Math.Round(a.Value * 100m / goal.Value, 2);
    }

    // ═════════════════════════ RISAO (user 2026-11-17) ═════════════════════════
    // A goal question can be answered from the RISAO monthly import instead of being typed: the figure the import
    // wrote into Goal Setting (goal_entries) is "punched" as the answer - on save, on Sync, and every night
    // (AwardsAutoCalcWorker). Club field = District Set Goals, district field = Disha Goals (null = not at that level).
    public static readonly (string Key, string Label, string? ClubField, string? DistrictField)[] RisaoSources =
    {
        ("annual_fund",   "Annual Fund",            "club_annual_fund_ytd", "annual_fund_achieved"),
        ("polioplus",     "PolioPlus Fund",         "club_polioplus_ytd",   "polio_plus_achieved"),
        ("endowment",     "Endowment Fund",         "club_endowment_ytd",   "endowment_achieved"),
        ("csr",           "CSR with RFI",           null,                   "csr_achieved"),
        ("other_funds",   "Other Funds",            "club_other_funds_ytd", null),
        ("af_per_capita", "Annual Fund per capita", "club_af_per_capita",   null),
        ("total_giving",  "Total Giving",           "club_total_ytd",       "total_giving_achieved"),
    };
    private static (string Key, string Label, string? ClubField, string? DistrictField)? Risao(string? key) =>
        RisaoSources.Any(r => r.Key == key) ? RisaoSources.First(r => r.Key == key) : null;

    // Same figures the Goal Setting screen shows (GoalSettingService): club Total = the stored Total, or when empty
    // the 5 club funds added up; district Total Giving = Annual Fund + PolioPlus + Endowment + CSR, always.
    private static readonly string[] ClubFundFields = { "club_af_per_capita", "club_annual_fund_ytd", "club_polioplus_ytd", "club_other_funds_ytd", "club_endowment_ytd" };
    private static readonly string[] DistrictFundFields = { "annual_fund_achieved", "polio_plus_achieved", "endowment_achieved", "csr_achieved" };
    private static decimal? ClubFigure(string field, Dictionary<string, decimal> fv)
    {
        if (fv.TryGetValue(field, out var v)) return v;
        if (field != "club_total_ytd") return null;
        var parts = ClubFundFields.Where(fv.ContainsKey).ToList();
        return parts.Count == 0 ? null : parts.Sum(k => fv[k]);
    }
    private static decimal? DistrictFigure(string field, Dictionary<string, decimal> fv)
    {
        if (field != "total_giving_achieved") return fv.TryGetValue(field, out var v) ? v : null;
        var parts = DistrictFundFields.Where(fv.ContainsKey).ToList();
        return parts.Count == 0 ? null : parts.Sum(k => fv[k]);
    }

    [HttpGet("api/goal-flow/risao-sources")]
    public ActionResult GetRisaoSources() => Ok(RisaoSources.Select(r => new
        { key = r.Key, label = r.Label, club = r.ClubField != null, district = r.DistrictField != null }));

    // District Awards points of a manual answer - same formula as the awards club form (view.tsx updateManualAnswer).
    internal static (decimal Points, decimal Bonus) ManualPoints(string type, string? answer, decimal pts, bool isBonus,
        decimal bonusPts, int minBonus, int maxBonus, Dictionary<int, decimal> optPoints)
    {
        decimal points = 0, bonus = 0;
        if (type == "number")
        {
            var v = Num(answer) ?? 0;
            points = v * pts;
            if (isBonus)
            {
                if (minBonus == 0 && maxBonus == 0) bonus = bonusPts;
                else
                {
                    if (v >= minBonus && minBonus > 0) bonus = bonusPts;
                    if (maxBonus > 0 && v > maxBonus) points = maxBonus * pts;
                }
            }
            if (v == 0) { points = 0; bonus = 0; }
        }
        else if (type == "yesno") points = answer == "yes" ? pts : 0;
        else if (type == "choose_one") points = int.TryParse(answer, out var oid) && optPoints.TryGetValue(oid, out var op) ? op : 0;
        return (points, bonus);
    }

    private static async Task UpsertClubManualEntryAsync(MySqlConnection conn, int districtId, int yearId, int clubId, int subId,
        string? answer, decimal points, decimal bonus, int memberId)
    {
        var prm = new { D = districtId, Y = yearId, C = clubId, Q = subId, A = answer, P = points, B = bonus, M = memberId };
        var existing = await conn.ExecuteScalarAsync<int?>(@"
            SELECT pk_id FROM district_citation_club_entry
            WHERE fk_district_id = @D AND fk_year_id = @Y AND fk_club_id = @C AND entry_type = 'manual' AND fk_question_id = @Q AND isdeleted = 0", prm);
        if (existing.HasValue)
            await conn.ExecuteAsync(
                "UPDATE district_citation_club_entry SET answer_value = @A, points_earned = @P, bonus_earned = @B, modified_by = @M, modified_date = NOW() WHERE pk_id = @Id",
                new { Id = existing.Value, A = answer, P = points, B = bonus, M = memberId });
        else
            await conn.ExecuteAsync(@"
                INSERT INTO district_citation_club_entry (fk_district_id, fk_year_id, fk_club_id, entry_type, fk_question_id, answer_value, points_earned, bonus_earned, created_by, created_date)
                VALUES (@D, @Y, @C, 'manual', @Q, @A, @P, @B, @M, NOW())", prm);
    }

    // Punch every club's RISAO figure into the RISAO-linked questions of the district + year. Returns answers written.
    // A club with no RISAO figure keeps whatever it had.
    private static async Task<int> PunchClubRisaoAsync(MySqlConnection conn, int districtId, int yearId, int memberId)
    {
        var links = (await conn.QueryAsync<(int SubId, string Key, decimal Pts, bool IsBonus, decimal BonusPts, int MinB, int MaxB)>(@"
            SELECT l.fk_line_id, l.risao_key, sc.points, sc.is_bonus, sc.bonus_points, sc.min_bonus, sc.max_bonus
            FROM goal_risao_links l
            JOIN district_citation_manual_sub_criteria sc ON sc.pk_id = l.fk_line_id AND sc.isdeleted = 0
            WHERE l.fk_district_id = @D AND l.fk_year_id = @Y AND l.line_type = 'manual' AND l.risao_key IS NOT NULL", new { D = districtId, Y = yearId })).ToList();
        if (links.Count == 0) return 0;
        var vals = (await conn.QueryAsync<(int Club, string Field, decimal? Val)>($@"
            SELECT e.fk_club_id, f.FieldKey, e.NumericValue
            FROM goal_entries e
            JOIN goal_fields f ON f.pk_field_id = e.fk_field_id AND f.isdeleted = 0
            JOIN club_master c ON c.pk_club_id = e.fk_club_id AND c.fk_district_id = @D AND {HierarchyScopeSql.ClubLive("c")}
            WHERE e.fk_year_id = @Y AND e.EntityType = 'Club' AND e.fk_district_id = 0 AND e.isdeleted = 0 AND f.FieldKey IN @F",
            new { D = districtId, Y = yearId, F = ClubFundFields.Append("club_total_ytd") })).Where(v => v.Val != null).ToList();
        var byClub = vals.GroupBy(v => v.Club).ToDictionary(g => g.Key, g => g.ToDictionary(x => x.Field, x => x.Val!.Value));
        int n = 0;
        foreach (var l in links)
        {
            var field = Risao(l.Key)?.ClubField;
            if (field == null) continue;
            foreach (var (club, fv) in byClub)
            {
                var val = ClubFigure(field, fv);
                if (val == null) continue;
                var answer = Math.Round(val.Value, 2).ToString(CultureInfo.InvariantCulture);
                var (p, b) = ManualPoints("number", answer, l.Pts, l.IsBonus, l.BonusPts, l.MinB, l.MaxB, new());
                await UpsertClubManualEntryAsync(conn, districtId, yearId, club, l.SubId, answer, p, b, memberId);
                n++;
            }
        }
        return n;
    }

    // Disha: the district's RISAO figure as the answer of its RISAO questions.
    private static async Task<int> PunchDishaRisaoAsync(MySqlConnection conn, int districtId, int yearId, int memberId)
    {
        var qs = (await conn.QueryAsync<(int Id, string Key)>(
            "SELECT pk_id, risao_key FROM disha_goal_questions WHERE fk_district_id = @D AND fk_year_id = @Y AND source = 'risao' AND isdeleted = 0",
            new { D = districtId, Y = yearId })).ToList();
        int n = 0;
        foreach (var q in qs)
        {
            var field = Risao(q.Key)?.DistrictField;
            if (field == null) continue;
            var fv = (await conn.QueryAsync<(string Field, decimal? Val)>(@"
                SELECT f.FieldKey, e.NumericValue FROM goal_entries e
                JOIN goal_fields f ON f.pk_field_id = e.fk_field_id AND f.isdeleted = 0
                WHERE e.fk_year_id = @Y AND e.EntityType = 'District' AND e.fk_district_id = @D AND e.fk_club_id = 0 AND e.isdeleted = 0
                  AND f.FieldKey IN @F AND e.NumericValue IS NOT NULL",
                new { Y = yearId, D = districtId, F = DistrictFundFields.Append(field) }))
                .GroupBy(x => x.Field).ToDictionary(g => g.Key, g => g.First().Val!.Value);
            var val = DistrictFigure(field, fv);
            if (val == null) continue;
            await UpsertDishaAnswerAsync(conn, q.Id, districtId, Math.Round(val.Value, 2).ToString(CultureInfo.InvariantCulture), memberId);
            n++;
        }
        return n;
    }

    // ═════════════════════════ District Set Goals ═════════════════════════

    public class GoalLine
    {
        public string LineType { get; set; } = "";     // auto | auto_sub | manual
        public int LineId { get; set; }
        public int QuestionId { get; set; }            // auto / auto_sub: the auto question (points of its entries stay on it)
        public string CategoryName { get; set; } = "";
        public string Title { get; set; } = "";
        public string Source { get; set; } = "";       // auto | manual | risao
        public string AnswerType { get; set; } = "number";
        public List<object> Options { get; set; } = new();
        public decimal? GoalValue { get; set; }
        public string? RisaoKey { get; set; }           // answered from the RISAO import (manual Number lines)
        // District view: each club's own goal (user 2026-11-17: same question for all clubs, goal per club; no row = no goal)
        public Dictionary<int, decimal?> ClubGoals { get; set; } = new();
        public int ClubsAnswered { get; set; }
        public int ClubsReached { get; set; }
        // Club view
        public string? AnswerValue { get; set; }
        public decimal? AchievementPct { get; set; }
        // District Awards points of the question (user 2026-11-18: points work exactly as District Awards)
        public decimal Points { get; set; }
        public bool IsBonus { get; set; }
        public decimal BonusPoints { get; set; }
        public int MinBonus { get; set; }
        public int MaxBonus { get; set; }
        public int PerUnit { get; set; } = 1;           // Auto: points for every PerUnit (user 2026-11-18, option B)
        public decimal PointsEarned { get; set; }       // club view: the club's points + bonus on this question
        // RCC lines (user 2026-11-20/23): one of the 26 Rotary.org goals, Auto - the RCC goal + Achieved come from the
        // Rotary.org sync (read only), the DG sets only the District Set Goal. No % and no points on these lines.
        public bool IsRcc { get; set; }
        public decimal? RccGoal { get; set; }                                   // club view: the club's Rotary.org goal
        public Dictionary<int, decimal?> ClubRccGoals { get; set; } = new();    // district view: every club's Rotary.org goal
    }

    // The 26 RCC goals shown in District Set Goals for EVERY district (user 2026-11-20: "import all 26 to all
    // districts" - built in, so no rows are copied and nothing in District Awards changes). Item = the
    // goal_rotary_org_values ItemName (Club Target / Achieved); Category = its Rotary.org section, which also
    // drives the section locks (DishaRccGoals.SectionOfCategory).
    internal static readonly (string Item, string Title, string Category)[] RccDsgItems =
    {
        ("Club membership", "Members", "Expand Our Reach"),
        ("Rotaract clubs", "Rotaract clubs", "Expand Our Reach"),
        ("Interact clubs", "Interact clubs", "Expand Our Reach"),
        ("Media stories about club projects", "Media stories about club projects", "Expand Our Reach"),
        ("New member sponsorship", "New member sponsorship", "Expand Our Reach"),
        ("RYLA participation", "RYLA participation", "Expand Our Reach"),
        ("Annual Fund contributions", "Annual Fund contributions", "Increase Our Impact"),
        ("PolioPlus Fund contributions", "PolioPlus Fund contributions", "Increase Our Impact"),
        ("Major gifts", "Major gifts", "Increase Our Impact"),
        ("Bequest Society members", "Bequest Society members", "Increase Our Impact"),
        ("Benefactors", "Benefactors", "Increase Our Impact"),
        ("Inbound Youth Exchange students", "Inbound Youth Exchange students", "Increase Our Impact"),
        ("Outbound Youth Exchange students", "Outbound Youth Exchange students", "Increase Our Impact"),
        ("Service projects", "Service projects", "Increase Our Impact"),
        ("Strategic plan", "Strategic plan", "Increase Our Ability to Adapt"),
        ("Review and consider updating your club bylaws", "Club bylaws review", "Increase Our Ability to Adapt"),
        ("Online presence", "Online presence", "Increase Our Ability to Adapt"),
        ("Update website and social media", "Update website and social media", "Increase Our Ability to Adapt"),
        ("Leadership development participation", "Leadership development participation", "Enhance Participant Engagement"),
        ("District conference attendance", "District conference attendance", "Enhance Participant Engagement"),
        ("District training participation", "District training participation", "Enhance Participant Engagement"),
        ("Rotary Action Group participation", "Rotary Action Group participation", "Enhance Participant Engagement"),
        ("Rotary Fellowship participation", "Rotary Fellowship participation", "Enhance Participant Engagement"),
        ("Service participation", "Service participation", "Enhance Participant Engagement"),
        ("Social activities", "Social activities", "Enhance Participant Engagement"),
        ("Use of official Rotary promotional materials", "Use of official Rotary promotional materials", "Enhance Participant Engagement"),
    };

    // RCC line id = year x 100 + position: the goal table's unique key has no year, so the id carries it.
    private static int RccLineId(int yearId, int index) => yearId * 100 + index + 1;

    // ── RCC points (user 2026-11-23): the DG sets points per RCC question on the "RCC Set Points" tab. SEPARATE from
    // District Awards (own table dsg_rcc_points; never in District Awards' Club Points). A club earns them from its
    // Rotary.org Achieved with the District Awards auto formula (points for every N, bonus, min / max), worked out
    // live from the synced figure - so the points follow every Rotary.org sync. No row = 0 points.
    private static bool _rccPointsReady;
    private static async Task EnsureRccPointsAsync(MySqlConnection conn)
    {
        if (_rccPointsReady) return;
        await conn.ExecuteAsync(@"CREATE TABLE IF NOT EXISTS dsg_rcc_points (
            fk_district_id INT NOT NULL, fk_year_id INT NOT NULL, item_no INT NOT NULL,
            points DECIMAL(12,2) NOT NULL DEFAULT 0, per_unit INT NOT NULL DEFAULT 1,
            is_bonus TINYINT(1) NOT NULL DEFAULT 0, bonus_points DECIMAL(12,2) NOT NULL DEFAULT 0,
            min_bonus INT NOT NULL DEFAULT 0, max_bonus INT NOT NULL DEFAULT 0,
            modified_by INT NULL, modified_date DATETIME NULL,
            PRIMARY KEY (fk_district_id, fk_year_id, item_no)) DEFAULT CHARSET=utf8mb4");
        _rccPointsReady = true;
    }
    private sealed record RccRule(decimal Points, int PerUnit, bool IsBonus, decimal BonusPoints, int MinBonus, int MaxBonus);
    private static async Task<Dictionary<int, RccRule>> RccRulesAsync(MySqlConnection conn, int districtId, int yearId)
    {
        await EnsureRccPointsAsync(conn);
        return (await conn.QueryAsync<(int No, decimal P, int U, bool B, decimal BP, int Mn, int Mx)>(@"
            SELECT item_no, points, per_unit, is_bonus, bonus_points, min_bonus, max_bonus FROM dsg_rcc_points
            WHERE fk_district_id = @D AND fk_year_id = @Y", new { D = districtId, Y = yearId }))
            .ToDictionary(r => r.No, r => new RccRule(r.P, Math.Max(1, r.U), r.B, r.BP, r.Mn, r.Mx));
    }
    // The District Awards auto formula on a Rotary.org figure (amounts are counted in whole units).
    public static decimal RccPointsOf(GoalLine l, decimal? achieved)
    {
        if (achieved is not > 0 || (l.Points <= 0 && !(l.IsBonus && l.BonusPoints > 0))) return 0;
        var count = (int)Math.Floor(achieved.Value);
        var per = Math.Max(1, l.PerUnit);
        if (!l.IsBonus) return (count / per) * l.Points;
        if (l.MinBonus == 0 && l.MaxBonus == 0) return (count / per) * l.Points + l.BonusPoints;
        var capped = l.MaxBonus > 0 && count > l.MaxBonus ? l.MaxBonus : count;
        return (capped / per) * l.Points + (count >= l.MinBonus && l.MinBonus > 0 ? l.BonusPoints : 0);
    }
    // Every club's RCC points per RCC line (or one club's).
    private static async Task<Dictionary<(int Club, string T, int L), decimal>> RccClubPointsAsync(MySqlConnection conn, int districtId, int yearId, int? clubId, List<GoalLine> lines)
    {
        var map = new Dictionary<(int, string, int), decimal>();
        var rcc = lines.Where(l => l.IsRcc).ToList();
        if (rcc.Count == 0) return map;
        var fig = await RccClubFiguresAsync(conn, districtId, yearId, clubId);
        foreach (var l in rcc)
        {
            var i = l.LineId - yearId * 100 - 1;
            if (i < 0 || i >= RccDsgItems.Length) continue;
            var item = RccDsgItems[i].Item.ToLowerInvariant();
            foreach (var kv in fig.Where(kv => kv.Key.Item == item))
            {
                var p = RccPointsOf(l, kv.Value.Achieved);
                if (p != 0) map[(kv.Key.Club, "rcc", l.LineId)] = p;
            }
        }
        return map;
    }

    public class RccPointDto { public int ItemNo { get; set; } public decimal Points { get; set; } public int PerUnit { get; set; } = 1;
        public bool IsBonus { get; set; } public decimal BonusPoints { get; set; } public int MinBonus { get; set; } public int MaxBonus { get; set; } }
    public class SaveRccPointsDto { public int YearId { get; set; } public List<RccPointDto> Items { get; set; } = new(); }

    // RCC Set Points tab: the 26 RCC questions by category with the district's points for the year.
    [HttpGet("api/goal-flow/district-set-goals/district/{districtId:int}/rcc-points")]
    public async Task<ActionResult> GetRccPoints(int districtId, [FromQuery] int? yearId)
    {
        await using var conn = await OpenAsync();
        var y = await ResolveYearAsync(conn, yearId);
        var rules = await RccRulesAsync(conn, districtId, y);
        var canEdit = await _guard.DistrictYearAsync(User, districtId, y) == null;
        return Ok(new
        {
            yearId = y, canEdit,
            items = RccDsgItems.Select((it, i) =>
            {
                var r = rules.GetValueOrDefault(i);
                return new { itemNo = i, category = it.Category, title = it.Title, points = r?.Points ?? 0, perUnit = r?.PerUnit ?? 1,
                    isBonus = r?.IsBonus ?? false, bonusPoints = r?.BonusPoints ?? 0, minBonus = r?.MinBonus ?? 0, maxBonus = r?.MaxBonus ?? 0 };
            }),
        });
    }

    [HttpPut("api/goal-flow/district-set-goals/district/{districtId:int}/rcc-points")]
    public async Task<ActionResult> SaveRccPoints(int districtId, [FromBody] SaveRccPointsDto body)
    {
        await using var conn = await OpenAsync();
        var y = await ResolveYearAsync(conn, body.YearId);
        if (await _guard.DistrictYearAsync(User, districtId, y) is { } denied) return denied;
        if (body.Items.Any(i => i.Points < 0 || i.BonusPoints < 0 || i.MinBonus < 0 || i.MaxBonus < 0 || i.PerUnit < 1))
            return BadRequest(new { message = "Points, bonus and min / max cannot be negative, and \"For every\" must be 1 or more." });
        await EnsureRccPointsAsync(conn);
        foreach (var i in body.Items.Where(i => i.ItemNo >= 0 && i.ItemNo < RccDsgItems.Length))
            await conn.ExecuteAsync(@"
                INSERT INTO dsg_rcc_points (fk_district_id, fk_year_id, item_no, points, per_unit, is_bonus, bonus_points, min_bonus, max_bonus, modified_by, modified_date)
                VALUES (@D, @Y, @N, @P, @U, @B, @BP, @Mn, @Mx, @M, NOW())
                ON DUPLICATE KEY UPDATE points = @P, per_unit = @U, is_bonus = @B, bonus_points = @BP, min_bonus = @Mn, max_bonus = @Mx, modified_by = @M, modified_date = NOW()",
                new { D = districtId, Y = y, N = i.ItemNo, P = i.Points, U = i.PerUnit, B = i.IsBonus, BP = i.BonusPoints, Mn = i.MinBonus, Mx = i.MaxBonus, M = MemberId });
        return Ok(new { message = "RCC points saved." });
    }

    // Club Target / Achieved of the 26 items for the district's clubs (or one club), keyed (club, item).
    private static async Task<Dictionary<(int Club, string Item), (decimal? Target, decimal? Achieved)>> RccClubFiguresAsync(
        MySqlConnection conn, int districtId, int yearId, int? clubId)
    {
        var rows = await conn.QueryAsync<(int C, string I, string K, decimal? V)>(@"
            SELECT fk_club_id, ItemName, Kind, NumericValue FROM goal_rotary_org_values
            WHERE fk_year_id = @Y AND EntityType = 'Club' AND fk_district_id = @D AND fk_club_id > 0 AND COALESCE(isdeleted, 0) = 0
              AND Kind IN ('Target', 'Achieved') AND ItemName IN @Items" + (clubId > 0 ? " AND fk_club_id = @C" : ""),
            new { Y = yearId, D = districtId, C = clubId ?? 0, Items = RccDsgItems.Select(i => i.Item) });
        var map = new Dictionary<(int, string), (decimal?, decimal?)>();
        foreach (var r in rows)
        {
            var key = (r.C, r.I.ToLowerInvariant());
            var cur = map.GetValueOrDefault(key);
            map[key] = r.K == "Target" ? (r.V, cur.Item2) : (cur.Item1, r.V);
        }
        return map;
    }

    // All District Awards lines of the district + year, in the awards order, with their goals.
    private static async Task<List<GoalLine>> LoadLinesAsync(MySqlConnection conn, int districtId, int yearId, int? clubId = null)
    {
        var lines = new List<GoalLine>();
        var autoQs = (await conn.QueryAsync<(int Id, string Cat, string Act, decimal Points, bool IsBonus, decimal BonusPoints, int MinBonus, int MaxBonus, int PerUnit)>(@"
            SELECT q.pk_id, cc.category_name, a.activity_name, COALESCE(q.points, 0), COALESCE(q.is_bonus, 0), COALESCE(q.bonus_points, 0),
                   COALESCE(q.min_bonus, 0), COALESCE(q.max_bonus, 0), COALESCE(q.per_unit, 1)
            FROM district_citation_auto_question q
            JOIN district_citation_activity_master a ON a.pk_id = q.fk_activity_id
            JOIN district_citation_category cc ON cc.pk_id = q.fk_category_id
            WHERE q.fk_district_id = @D AND q.fk_year_id = @Y AND q.isdeleted = 0
            ORDER BY cc.sort_order, q.sort_order", new { D = districtId, Y = yearId })).ToList();
        var subs = autoQs.Count == 0 ? new List<(int Id, int QId, string? Name, decimal Points, bool IsBonus, decimal BonusPoints, int MinBonus, int MaxBonus)>()
            : (await conn.QueryAsync<(int Id, int QId, string? Name, decimal Points, bool IsBonus, decimal BonusPoints, int MinBonus, int MaxBonus)>(@"
                SELECT pk_id, fk_auto_question_id, sub_item_name, COALESCE(points, 0), COALESCE(is_bonus, 0), COALESCE(bonus_points, 0),
                       COALESCE(min_bonus, 0), COALESCE(max_bonus, 0) FROM district_citation_auto_question_sub
                WHERE fk_auto_question_id IN @Ids AND isdeleted = 0 ORDER BY sort_order",
                new { Ids = autoQs.Select(q => q.Id) })).ToList();
        foreach (var q in autoQs)
        {
            var qs = subs.Where(s => s.QId == q.Id).ToList();
            // Same rule as the awards calculation: a main line exists when there are no sub-items or it has points.
            if (qs.Count == 0 || q.Points > 0)
                lines.Add(new GoalLine { LineType = "auto", LineId = q.Id, QuestionId = q.Id, CategoryName = q.Cat, Title = RisaoFigures.Plain(q.Act), Source = "auto",
                    Points = q.Points, IsBonus = q.IsBonus, BonusPoints = q.BonusPoints, MinBonus = q.MinBonus, MaxBonus = q.MaxBonus, PerUnit = q.PerUnit });
            foreach (var s in qs)
                lines.Add(new GoalLine { LineType = "auto_sub", LineId = s.Id, QuestionId = q.Id, CategoryName = q.Cat, Source = "auto",
                    Title = string.IsNullOrWhiteSpace(s.Name) ? RisaoFigures.Plain(q.Act) : $"{RisaoFigures.Plain(q.Act)} - {s.Name}",
                    Points = s.Points, IsBonus = s.IsBonus, BonusPoints = s.BonusPoints, MinBonus = s.MinBonus, MaxBonus = s.MaxBonus });
        }

        var manual = (await conn.QueryAsync<(int Id, string Cat, string? Criteria, string? Title, string? Type, decimal Points, bool IsBonus, decimal BonusPoints, int MinBonus, int MaxBonus)>(@"
            SELECT sc.pk_id, cc.category_name, mc.criteria_name, sc.sub_criteria_title, sc.answer_type,
                   COALESCE(sc.points, 0), COALESCE(sc.is_bonus, 0), COALESCE(sc.bonus_points, 0), COALESCE(sc.min_bonus, 0), COALESCE(sc.max_bonus, 0)
            FROM district_citation_manual_sub_criteria sc
            JOIN district_citation_manual_criteria mc ON mc.pk_id = sc.fk_criteria_id AND mc.isdeleted = 0
            JOIN district_citation_category cc ON cc.pk_id = mc.fk_category_id
            WHERE mc.fk_district_id = @D AND mc.fk_year_id = @Y AND sc.isdeleted = 0
            ORDER BY cc.sort_order, mc.sort_order, sc.sort_order", new { D = districtId, Y = yearId })).ToList();
        var opts = manual.Count == 0 ? new List<(int Id, int SubId, string Text, decimal Pts)>()
            : (await conn.QueryAsync<(int Id, int SubId, string Text, decimal Pts)>(@"
                SELECT pk_id, fk_sub_criteria_id, option_text, COALESCE(option_points, 0) FROM district_citation_manual_sub_criteria_option
                WHERE fk_sub_criteria_id IN @Ids AND isdeleted = 0 ORDER BY sort_order",
                new { Ids = manual.Select(m => m.Id) })).ToList();
        foreach (var m in manual)
        {
            var mo = opts.Where(o => o.SubId == m.Id).Select(o => (object)new { id = o.Id, optionText = o.Text, optionPoints = o.Pts }).ToList();
            lines.Add(new GoalLine { LineType = "manual", LineId = m.Id, CategoryName = m.Cat, Source = "manual",
                Title = string.IsNullOrWhiteSpace(m.Title) ? (m.Criteria ?? "") : m.Title!,
                AnswerType = NormType(m.Type, mo.Count > 0), Options = mo,
                Points = m.Points, IsBonus = m.IsBonus, BonusPoints = m.BonusPoints, MinBonus = m.MinBonus, MaxBonus = m.MaxBonus });
        }

        // The 26 RCC goals (Auto, from Rotary.org) - every district, after its own questions.
        var rccFig = await RccClubFiguresAsync(conn, districtId, yearId, clubId);
        var rccRules = await RccRulesAsync(conn, districtId, yearId);
        for (int i = 0; i < RccDsgItems.Length; i++)
        {
            var it = RccDsgItems[i];
            var rr = rccRules.GetValueOrDefault(i);
            var l = new GoalLine { LineType = "rcc", LineId = RccLineId(yearId, i), CategoryName = it.Category, Title = it.Title, Source = "rcc", IsRcc = true,
                Points = rr?.Points ?? 0, PerUnit = rr?.PerUnit ?? 1, IsBonus = rr?.IsBonus ?? false, BonusPoints = rr?.BonusPoints ?? 0,
                MinBonus = rr?.MinBonus ?? 0, MaxBonus = rr?.MaxBonus ?? 0 };
            foreach (var kv in rccFig.Where(kv => kv.Key.Item == it.Item.ToLowerInvariant() && kv.Value.Target != null))
                l.ClubRccGoals[kv.Key.Club] = kv.Value.Target;
            if (clubId > 0) l.RccGoal = l.ClubRccGoals.GetValueOrDefault(clubId.Value);
            lines.Add(l);
        }

        // Goals: one per club (fk_club_id). GoalValue = the asked club's goal; ClubGoals = every club's (district view).
        var goals = (await conn.QueryAsync<(string T, int L, int C, decimal? G)>(
            "SELECT line_type, fk_line_id, fk_club_id, goal_value FROM district_set_goal_targets WHERE fk_district_id = @D AND fk_year_id = @Y AND fk_club_id > 0 AND goal_value IS NOT NULL",
            new { D = districtId, Y = yearId })).ToList();
        foreach (var l in lines)
        {
            foreach (var g in goals.Where(g => g.T == l.LineType && g.L == l.LineId)) l.ClubGoals[g.C] = g.G;
            if (clubId > 0 && l.ClubGoals.TryGetValue(clubId.Value, out var mine)) l.GoalValue = mine;
        }
        var links = (await conn.QueryAsync<(int L, string K)>(
            "SELECT fk_line_id, risao_key FROM goal_risao_links WHERE fk_district_id = @D AND fk_year_id = @Y AND line_type = 'manual' AND risao_key IS NOT NULL",
            new { D = districtId, Y = yearId })).ToDictionary(x => x.L, x => x.K);
        foreach (var l in lines.Where(l => l.LineType == "manual" && l.AnswerType == "number"))
            if (links.TryGetValue(l.LineId, out var k)) { l.RisaoKey = k; l.Source = "risao"; }
        return lines;
    }

    // Club answers of the district + year, keyed by (club, line).
    private static async Task<Dictionary<(int Club, string T, int L), string?>> LoadClubAnswersAsync(
        MySqlConnection conn, int districtId, int yearId, int? clubId)
    {
        var rows = await conn.QueryAsync<(int Club, string Type, int Q, int? Sub, string? Val)>($@"
            SELECT e.fk_club_id, e.entry_type, e.fk_question_id, e.fk_sub_question_id, e.answer_value
            FROM district_citation_club_entry e
            JOIN club_master c ON c.pk_club_id = e.fk_club_id AND {HierarchyScopeSql.ClubLive("c")}
            WHERE e.fk_district_id = @D AND e.fk_year_id = @Y AND e.isdeleted = 0"
            + (clubId > 0 ? " AND e.fk_club_id = @C" : ""), new { D = districtId, Y = yearId, C = clubId ?? 0 });
        var map = new Dictionary<(int, string, int), string?>();
        foreach (var r in rows)
        {
            var key = r.Type == "manual" ? (r.Club, "manual", r.Q)
                : r.Sub is > 0 ? (r.Club, "auto_sub", r.Sub.Value) : (r.Club, "auto", r.Q);
            map[key] = r.Val;
        }
        // RCC lines: the Achieved is the club's Rotary.org figure (never typed).
        var inv = CultureInfo.InvariantCulture;
        foreach (var kv in await RccClubFiguresAsync(conn, districtId, yearId, clubId))
        {
            if (kv.Value.Achieved == null) continue;
            var i = Array.FindIndex(RccDsgItems, it => it.Item.ToLowerInvariant() == kv.Key.Item);
            if (i >= 0) map[(kv.Key.Club, "rcc", RccLineId(yearId, i))] = kv.Value.Achieved.Value.ToString("0.##", inv);
        }
        return map;
    }

    [HttpGet("api/goal-flow/district-set-goals/district/{districtId:int}")]
    public async Task<ActionResult> GetDistrictSetGoals(int districtId, [FromQuery] int? yearId)
    {
        if (!await KillSwitchHelper.IsDistrictDrillReachableAsync(_cs, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive." });
        await using var conn = await OpenAsync();
        var y = await ResolveYearAsync(conn, yearId);
        var lines = await LoadLinesAsync(conn, districtId, y);
        var answers = await LoadClubAnswersAsync(conn, districtId, y, null);
        var clubs = (await conn.QueryAsync<(int Id, string Name)>(
            $"SELECT c.pk_club_id, c.ClubName FROM club_master c WHERE c.fk_district_id = @D AND {HierarchyScopeSql.ClubLive("c")} ORDER BY c.ClubName",
            new { D = districtId })).ToList();
        // Every club's answer per line (for the per-club goal table).
        var clubAnswers = lines.ToDictionary(l => $"{l.LineType}:{l.LineId}",
            l => clubs.ToDictionary(c => c.Id, c => answers.TryGetValue((c.Id, l.LineType, l.LineId), out var v) ? v : null));
        foreach (var l in lines)
        {
            var mine = answers.Where(a => a.Key.T == l.LineType && a.Key.L == l.LineId && !string.IsNullOrWhiteSpace(a.Value)).ToList();
            // Auto lines always have a figure once counted; a 0 is not an answer.
            l.ClubsAnswered = l.Source == "auto" ? mine.Count(a => Num(a.Value) > 0) : mine.Count;
            l.ClubsReached = mine.Count(a => Pct(l.AnswerType, l.ClubGoals.TryGetValue(a.Key.Club, out var g) ? g : null, a.Value) >= 100);
        }
        var canEdit = await _guard.DistrictYearAsync(User, districtId, y) == null;
        var risaoAsOn = await RisaoFigures.AsOnAsync(conn, y, "Club");
        // Every club's points per line for the DG's Overview (user 2026-11-19) - exactly District Awards' points.
        var pts = await ClubPointsAsync(conn, districtId, y, null, lines);
        var clubPoints = lines.ToDictionary(l => $"{l.LineType}:{l.LineId}",
            l => clubs.Where(c => pts.ContainsKey((c.Id, l.LineType, l.LineId))).ToDictionary(c => c.Id, c => pts[(c.Id, l.LineType, l.LineId)]));
        return Ok(new { yearId = y, clubCount = clubs.Count, canEdit, risaoAsOn, clubs = clubs.Select(c => new { id = c.Id, name = c.Name }), clubAnswers, clubPoints, lines });
    }

    // Ranking of goals over a set of answers: goals with a target (Number / auto with a goal, Yes/No), each % capped
    // at 100 so one huge figure cannot carry the score. Score = average of those %.
    internal static (int Goals, int Reached, decimal? Score) ScoreOf(IEnumerable<(string Type, decimal? Goal, string? Answer)> items)
    {
        var withGoal = items.Where(i => i.Type == "yesno" || (i.Type == "number" && i.Goal > 0)).ToList();
        if (withGoal.Count == 0) return (0, 0, null);
        var pcts = withGoal.Select(i => Pct(i.Type, i.Goal, i.Answer) ?? 0).ToList();
        return (withGoal.Count, pcts.Count(p => p >= 100), Math.Round(pcts.Average(p => Math.Min(p, 100m)), 2));
    }

    // DG: every club of the district, ranked by District Awards points (as on the awards Club Points tab), with
    // the District Set Goals progress next to it.
    [HttpGet("api/goal-flow/district-set-goals/district/{districtId:int}/clubs")]
    public async Task<ActionResult> GetDistrictSetGoalClubs(int districtId, [FromQuery] int? yearId)
    {
        if (!await KillSwitchHelper.IsDistrictDrillReachableAsync(_cs, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive." });
        await using var conn = await OpenAsync();
        var y = await ResolveYearAsync(conn, yearId);
        var lines = await LoadLinesAsync(conn, districtId, y);
        var answers = await LoadClubAnswersAsync(conn, districtId, y, null);
        // Points = EXACTLY District Awards' Club Points (user 2026-11-19: District Awards is live - not one number may
        // differ). Same SQL as DistrictModulesController.GetCitationClubPoints: only entries whose question belongs to
        // this district + year and is not deleted; rounded the same way (Math.Round of the total).
        var pts = (await conn.QueryAsync<(int C, decimal P)>(@"
            SELECT clubId, SUM(score) FROM (
                SELECT e.fk_club_id AS clubId, (e.points_earned + e.bonus_earned) AS score
                FROM district_citation_club_entry e
                INNER JOIN district_citation_auto_question q
                    ON q.pk_id = e.fk_question_id AND q.fk_district_id = @D AND q.fk_year_id = @Y AND q.isdeleted = 0
                WHERE e.fk_district_id = @D AND e.fk_year_id = @Y AND e.entry_type = 'auto' AND e.isdeleted = 0
                UNION ALL
                SELECT e.fk_club_id AS clubId, (e.points_earned + e.bonus_earned) AS score
                FROM district_citation_club_entry e
                INNER JOIN district_citation_manual_sub_criteria sc ON sc.pk_id = e.fk_question_id AND sc.isdeleted = 0
                INNER JOIN district_citation_manual_criteria mc
                    ON mc.pk_id = sc.fk_criteria_id AND mc.fk_district_id = @D AND mc.fk_year_id = @Y AND mc.isdeleted = 0
                WHERE e.fk_district_id = @D AND e.fk_year_id = @Y AND e.entry_type = 'manual' AND e.isdeleted = 0
            ) t GROUP BY clubId", new { D = districtId, Y = y })).ToDictionary(x => x.C, x => x.P);
        // + the RCC points (District Set Goals only, user 2026-11-23) - District Awards' own Club Points stay as they are.
        foreach (var kv in await RccClubPointsAsync(conn, districtId, y, null, lines)) pts[kv.Key.Club] = pts.GetValueOrDefault(kv.Key.Club) + kv.Value;
        var clubs = (await conn.QueryAsync<(int Id, string Name)>(
            $"SELECT c.pk_club_id, c.ClubName FROM club_master c WHERE c.fk_district_id = @D AND {HierarchyScopeSql.ClubLive("c")}",
            new { D = districtId })).Select(c => (c.Id, c.Name, Points: pts.GetValueOrDefault(c.Id))).ToList();
        var rows = clubs.Select(c =>
        {
            var (goals, reached, _) = ScoreOf(lines.Select(l =>
                (l.AnswerType, l.ClubGoals.TryGetValue(c.Id, out var g) ? g : null, answers.TryGetValue((c.Id, l.LineType, l.LineId), out var v) ? v : null)));
            // Progress (user 2026-11-19, option A): TOTAL Achieved / TOTAL Goal x 100 over the Number questions with a goal.
            decimal totalGoal = 0, totalAch = 0;
            foreach (var l in lines.Where(l => l.AnswerType == "number"))
                if (l.ClubGoals.TryGetValue(c.Id, out var g) && g is > 0)
                {
                    totalGoal += g.Value;
                    totalAch += Num(answers.TryGetValue((c.Id, l.LineType, l.LineId), out var v) ? v : null) ?? 0;
                }
            decimal? score = totalGoal > 0 ? Math.Round(totalAch * 100m / totalGoal, 0) : null;
            return new { clubId = c.Id, clubName = c.Name, points = Math.Round(c.Points), goals, reached, score, totalGoal, totalAchieved = totalAch };
        })
        .OrderByDescending(r => r.points).ThenByDescending(r => r.score ?? -1).ThenBy(r => r.clubName)
        .Select((r, i) => new { rank = i + 1, r.clubId, r.clubName, r.points, r.goals, r.reached, r.score, r.totalGoal, r.totalAchieved })
        .ToList();
        return Ok(new { yearId = y, clubs = rows });
    }

    public class SaveGoalsRequest
    {
        public int YearId { get; set; }
        public List<GoalValueDto> Goals { get; set; } = new();      // one per club (null = no goal for that club)
        public List<RisaoLinkDto> Links { get; set; } = new();      // manual Number lines: who answers
    }
    public class GoalValueDto { public string LineType { get; set; } = ""; public int LineId { get; set; } public int ClubId { get; set; } public decimal? GoalValue { get; set; } }
    public class RisaoLinkDto { public int LineId { get; set; } public string? RisaoKey { get; set; } }   // "" / null = clubs type it

    // The goals a Save writes: lines of this district + year, its live clubs, sections not locked; the last value
    // wins when a goal is sent twice. The page sends only the goals that changed (DistrictSetGoalsPanel.saveGoals).
    public static List<GoalValueDto> GoalsToSave(IEnumerable<GoalValueDto> goals, ISet<(string, int)> validLines, ISet<int> clubIds,
        IReadOnlyDictionary<int, HashSet<string>> locks, IReadOnlyDictionary<(string, int), string> sectionOf) =>
        goals.Where(g => validLines.Contains((g.LineType, g.LineId)) && clubIds.Contains(g.ClubId)
                     && !(locks.GetValueOrDefault(g.ClubId)?.Contains(sectionOf[(g.LineType, g.LineId)]) ?? false))
            .GroupBy(g => (g.LineType, g.LineId, g.ClubId)).Select(x => x.Last()).ToList();

    public const int GoalBatchSize = 300;

    // One multi-row upsert per 300 goals (RIZones 2026-11-23: one call per goal timed out with the RCC lines).
    // A cleared goal is stored as NULL (row kept) = "no goal for this club".
    public static IEnumerable<(string Sql, DynamicParameters Params)> GoalBatches(IReadOnlyList<GoalValueDto> toSave, int districtId, int yearId, int memberId)
    {
        foreach (var chunk in toSave.Chunk(GoalBatchSize))
        {
            var p = new DynamicParameters();
            p.Add("D", districtId); p.Add("Y", yearId); p.Add("M", memberId);
            var vals = new List<string>();
            for (int i = 0; i < chunk.Length; i++)
            {
                vals.Add($"(@D, @Y, @t{i}, @l{i}, @c{i}, @g{i}, @M)");
                p.Add($"t{i}", chunk[i].LineType); p.Add($"l{i}", chunk[i].LineId); p.Add($"c{i}", chunk[i].ClubId); p.Add($"g{i}", chunk[i].GoalValue);
            }
            yield return (@"INSERT INTO district_set_goal_targets (fk_district_id, fk_year_id, line_type, fk_line_id, fk_club_id, goal_value, created_by)
                    VALUES " + string.Join(", ", vals) + @"
                    ON DUPLICATE KEY UPDATE goal_value = VALUES(goal_value), modified_by = VALUES(created_by), modified_date = NOW()", p);
        }
    }

    [HttpPut("api/goal-flow/district-set-goals/district/{districtId:int}")]
    public async Task<ActionResult> SaveDistrictSetGoals(int districtId, [FromBody] SaveGoalsRequest req)
    {
        var denied = await _guard.DistrictYearAsync(User, districtId, req.YearId);
        if (denied != null) return denied;
        if (req.Goals.Any(g => g.GoalValue < 0)) return BadRequest(new { message = "A goal cannot be negative." });
        await using var conn = await OpenAsync();
        // Only lines that belong to this district + year, and only Number / auto lines take a number.
        var numLines = (await LoadLinesAsync(conn, districtId, req.YearId)).Where(l => l.AnswerType == "number").ToList();
        var valid = numLines.Select(l => (l.LineType, l.LineId)).ToHashSet();
        var sectionOf = numLines.ToDictionary(l => (l.LineType, l.LineId), l => DishaRccGoals.SectionOfCategory(l.CategoryName));
        // A locked club section is read only for everyone until it is unlocked (user 2026-11-19).
        var dsgLocks = await DsgLocksAsync(conn, req.Goals.Select(g => g.ClubId).Distinct(), req.YearId);
        var clubIds = (await conn.QueryAsync<int>(
            $"SELECT c.pk_club_id FROM club_master c WHERE c.fk_district_id = @D AND {HierarchyScopeSql.ClubLive("c")}", new { D = districtId })).ToHashSet();
        // A cleared goal is stored as NULL (row kept) = "no goal for this club".
        // Written in batches of 300 in one transaction (user 2026-11-23: one call per goal timed out with the RCC lines).
        var toSave = GoalsToSave(req.Goals, valid, clubIds, dsgLocks, sectionOf);
        if (toSave.Count > 0)
        {
            await using var tx = await conn.BeginTransactionAsync();
            foreach (var (sql, p) in GoalBatches(toSave, districtId, req.YearId, MemberId))
                await conn.ExecuteAsync(sql, p, tx);
            await tx.CommitAsync();
        }

        // RISAO links (manual Number lines only; a source with no club figure is ignored).
        foreach (var g in req.Links.Where(g => valid.Contains(("manual", g.LineId))))
        {
            if (string.IsNullOrEmpty(g.RisaoKey))
                // Link cleared (row kept, no hard delete) - no answer is removed; the clubs then type the answer again.
                await conn.ExecuteAsync("UPDATE goal_risao_links SET risao_key = NULL, modified_by = @M, modified_date = NOW() WHERE line_type = 'manual' AND fk_line_id = @L AND fk_district_id = @D",
                    new { L = g.LineId, D = districtId, M = MemberId });
            else if (Risao(g.RisaoKey)?.ClubField != null)
                await conn.ExecuteAsync(@"
                    INSERT INTO goal_risao_links (fk_district_id, fk_year_id, line_type, fk_line_id, risao_key, created_by)
                    VALUES (@D, @Y, 'manual', @L, @K, @M)
                    ON DUPLICATE KEY UPDATE risao_key = @K, modified_by = @M, modified_date = NOW()",
                    new { D = districtId, Y = req.YearId, L = g.LineId, K = g.RisaoKey, M = MemberId });
        }
        var punched = await PunchClubRisaoAsync(conn, districtId, req.YearId, MemberId);
        return Ok(new { message = punched > 0 ? $"Goals saved. {punched} RISAO answers filled in." : "Goals saved." });
    }

    // ── District Set Goals: Lock / Unlock + the Club Admin's own goals (user 2026-11-19, same as Disha) ──
    // A club's goals lock per section (Membership / Foundation / Public Image / Youth Service / other) in
    // dsg_goal_lock. Only the District Admin (DG) of the club's district or Super Admin lock / unlock. A locked
    // section is read only for EVERYONE (DG, SA, Club Admin) until it is unlocked; the Achieved is never locked.
    // District Set Goals only - the old Goal Setting locks are not touched.
    private static async Task<Dictionary<int, HashSet<string>>> DsgLocksAsync(MySqlConnection conn, IEnumerable<int> clubs, int y) =>
        (await conn.QueryAsync<(int C, string S)>(
            "SELECT fk_club_id, section_key FROM dsg_goal_lock WHERE fk_club_id IN @Cs AND fk_year_id = @Y AND is_locked = 1",
            new { Cs = clubs.DefaultIfEmpty(0), Y = y }))
        .GroupBy(r => r.C).ToDictionary(g => g.Key, g => g.Select(r => r.S).ToHashSet());

    [HttpGet("api/goal-flow/district-set-goals/district/{districtId:int}/locks")]
    public async Task<ActionResult> GetDsgLocks(int districtId, [FromQuery] int? yearId)
    {
        await using var conn = await OpenAsync();
        var y = await ResolveYearAsync(conn, yearId);
        var clubs = (await conn.QueryAsync<int>(
            $"SELECT c.pk_club_id FROM club_master c WHERE c.fk_district_id = @D AND {HierarchyScopeSql.ClubLive("c")}", new { D = districtId })).ToList();
        var locks = await DsgLocksAsync(conn, clubs, y);
        var canLock = await _guard.DistrictYearAsync(User, districtId, y) == null;
        return Ok(new { yearId = y, canLock, clubs = clubs.ToDictionary(c => c, c => locks.TryGetValue(c, out var s) ? s.ToList() : new List<string>()) });
    }

    public class DsgLockDto { public int YearId { get; set; } public List<int>? ClubIds { get; set; } public List<string>? Sections { get; set; } public bool Locked { get; set; } }

    // DG / Super Admin: one club + one section, one club (all sections), or every club of the district.
    [HttpPost("api/goal-flow/district-set-goals/district/{districtId:int}/locks")]
    public async Task<ActionResult> SetDsgLocks(int districtId, [FromBody] DsgLockDto body)
    {
        await using var conn = await OpenAsync();
        var y = await ResolveYearAsync(conn, body.YearId);
        if (await _guard.DistrictYearAsync(User, districtId, y) is { } denied) return denied;
        var all = (await conn.QueryAsync<int>(
            $"SELECT c.pk_club_id FROM club_master c WHERE c.fk_district_id = @D AND {HierarchyScopeSql.ClubLive("c")}", new { D = districtId })).ToHashSet();
        var ids = body.ClubIds == null ? all.ToList() : body.ClubIds.Where(all.Contains).ToList();
        var sections = (body.Sections ?? DishaRccGoals.Sections.ToList()).Where(DishaRccGoals.Sections.Contains).ToList();
        foreach (var c in ids)
            foreach (var s in sections)
                await conn.ExecuteAsync(@"
                    INSERT INTO dsg_goal_lock (fk_year_id, fk_club_id, section_key, is_locked, modified_by) VALUES (@Y, @C, @S, @L, @M)
                    ON DUPLICATE KEY UPDATE is_locked = @L, modified_by = @M",
                    new { Y = y, C = c, S = s, L = body.Locked, M = MemberId });
        var what = ids.Count == 1 ? "Club goals" : $"Goals of {ids.Count} clubs";
        return Ok(new { message = $"{what} {(body.Locked ? "locked" : "unlocked")}." });
    }

    public class ClubGoalsDto { public int YearId { get; set; } public List<GoalValueDto> Goals { get; set; } = new(); }

    // The Club Admin's own goals (or the DG / SA for that club) - only sections that are not locked.
    [HttpPut("api/goal-flow/district-set-goals/club/{clubId:int}/goals")]
    public async Task<ActionResult> SaveClubSetGoalsGoals(int clubId, [FromBody] ClubGoalsDto body)
    {
        if (body.Goals.Any(g => g.GoalValue < 0)) return BadRequest(new { message = "A goal cannot be negative." });
        await using var conn = await OpenAsync();
        var districtId = await conn.ExecuteScalarAsync<int>("SELECT fk_district_id FROM club_master WHERE pk_club_id = @C", new { C = clubId });
        var y = await ResolveYearAsync(conn, body.YearId);
        var isClub = await _guard.ClubYearlessAsync(User, clubId) == null && y == await ResolveYearAsync(conn, null);
        if (!isClub && await _guard.DistrictYearAsync(User, districtId, y) is { } denied) return denied;
        var lines = (await LoadLinesAsync(conn, districtId, y)).Where(l => l.AnswerType == "number").ToDictionary(l => (l.LineType, l.LineId));
        var locked = (await DsgLocksAsync(conn, new[] { clubId }, y)).GetValueOrDefault(clubId) ?? new();
        int saved = 0, skipped = 0;
        foreach (var g in body.Goals)
        {
            if (!lines.TryGetValue((g.LineType, g.LineId), out var l)) continue;
            if (locked.Contains(DishaRccGoals.SectionOfCategory(l.CategoryName))) { skipped++; continue; }
            await conn.ExecuteAsync(@"
                INSERT INTO district_set_goal_targets (fk_district_id, fk_year_id, line_type, fk_line_id, fk_club_id, goal_value, created_by)
                VALUES (@D, @Y, @T, @L, @C, @G, @M)
                ON DUPLICATE KEY UPDATE goal_value = @G, modified_by = @M, modified_date = NOW()",
                new { D = districtId, Y = y, T = g.LineType, L = g.LineId, C = clubId, G = g.GoalValue, M = MemberId });
            saved++;
        }
        return Ok(new { message = skipped > 0 ? $"Goals saved. {skipped} goal(s) not changed - that section is locked by the District." : "Goals saved.", saved, skipped });
    }

    // Fill the RISAO-linked questions again from the latest import (also done every night).
    [HttpPost("api/goal-flow/district-set-goals/district/{districtId:int}/sync-risao")]
    public async Task<ActionResult> SyncDistrictSetGoalsRisao(int districtId, [FromQuery] int? yearId)
    {
        await using var conn = await OpenAsync();
        var y = await ResolveYearAsync(conn, yearId);
        var denied = await _guard.DistrictYearAsync(User, districtId, y);
        if (denied != null) return denied;
        var n = await PunchClubRisaoAsync(conn, districtId, y, MemberId);
        return Ok(new { message = n > 0 ? $"{n} RISAO answers filled in." : "No RISAO figures found for the linked questions yet." });
    }

    [HttpGet("api/goal-flow/district-set-goals/club/{clubId:int}")]
    public async Task<ActionResult> GetClubSetGoals(int clubId, [FromQuery] int? yearId)
    {
        if (!await KillSwitchHelper.IsClubDrillReachableAsync(_cs, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive." });
        await using var conn = await OpenAsync();
        var districtId = await conn.ExecuteScalarAsync<int>("SELECT fk_district_id FROM club_master WHERE pk_club_id = @C", new { C = clubId });
        var y = await ResolveYearAsync(conn, yearId);
        var currentYear = await ResolveYearAsync(conn, null);
        var lines = await LoadLinesAsync(conn, districtId, y, clubId);
        var answers = await LoadClubAnswersAsync(conn, districtId, y, clubId);
        // The club's District Awards points + bonus per question (same entries District Awards shows).
        // Points per line = exactly what District Awards counts for the club (see ClubPointsAsync).
        var earned = (await ClubPointsAsync(conn, districtId, y, clubId, lines)).ToDictionary(kv => (kv.Key.T, kv.Key.L), kv => kv.Value);
        foreach (var l in lines)
        {
            answers.TryGetValue((clubId, l.LineType, l.LineId), out var v);
            l.AnswerValue = v;
            l.AchievementPct = l.IsRcc ? null : Pct(l.AnswerType, l.GoalValue, v);   // RCC lines: no % (user 2026-11-20)
            l.PointsEarned = earned.GetValueOrDefault((l.LineType, l.LineId));
        }
        var enabled = await DistrictAwardsConfigHelper.IsEnabledAsync(conn, districtId, y);
        // Same rules as the District Awards club form: current year only, awards switched on, club admin rights.
        var canAnswer = y == currentYear && enabled && await _guard.ClubYearlessAsync(User, clubId) == null;
        var risaoAsOn = await RisaoFigures.AsOnAsync(conn, y, "Club");
        // Goals (user 2026-11-19): the Club Admin may set the club's own goals in sections the District has not locked.
        var canSetGoals = y == currentYear && await _guard.ClubYearlessAsync(User, clubId) == null;
        var locks = (await DsgLocksAsync(conn, new[] { clubId }, y)).GetValueOrDefault(clubId)?.ToList() ?? new List<string>();
        var clubName = await conn.ExecuteScalarAsync<string>("SELECT ClubName FROM club_master WHERE pk_club_id = @C", new { C = clubId });
        return Ok(new { yearId = y, districtId, clubName, canAnswer, canSetGoals, locks, awardsEnabled = enabled, risaoAsOn, lines });
    }

    // Month-wise (user 2026-11-18, option A): each Auto line's achieved per month for this club (District Awards
    // counting; RISAO = the monthly RISAO import) + the yearly answer and the club's goal. Manual lines are yearly.
    [HttpGet("api/goal-flow/district-set-goals/club/{clubId:int}/monthly")]
    public async Task<ActionResult> GetClubSetGoalsMonthly(int clubId, [FromQuery] int? yearId)
    {
        if (!await KillSwitchHelper.IsClubDrillReachableAsync(_cs, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive." });
        await using var conn = await OpenAsync();
        var districtId = await conn.ExecuteScalarAsync<int>("SELECT fk_district_id FROM club_master WHERE pk_club_id = @C", new { C = clubId });
        var y = await ResolveYearAsync(conn, yearId);
        var year = await conn.QueryFirstAsync<(DateTime Start, DateTime End)>("SELECT StartDate, EndDate FROM rotary_year_master WHERE pk_year_id = @Y", new { Y = y });
        var lines = await LoadLinesAsync(conn, districtId, y, clubId);
        var answers = await LoadClubAnswersAsync(conn, districtId, y, clubId);
        var mc = await MonthCtxAsync(conn, districtId, y, year.Start, year.End);
        var one = new List<int> { clubId };
        var rows = new List<object>();
        foreach (var l in lines)
        {
            var (monthly, risao) = await LineMonthlyAsync(conn, mc, l, one);
            answers.TryGetValue((clubId, l.LineType, l.LineId), out var v);
            rows.Add(new { l.LineType, l.LineId, l.CategoryName, l.Title, l.Source, isRisao = risao, l.AnswerType, l.GoalValue, answerValue = v, monthly,
                l.IsRcc, rccGoal = l.IsRcc ? l.RccGoal : null });
        }
        return Ok(new { yearId = y, months = MonthlyGoalCounts.YearMonths, risaoAsOn = await RisaoFigures.AsOnAsync(conn, y, "Club"), lines = rows });
    }

    // District month-wise (user 2026-11-19, RCC design): every line for ALL the district's clubs - goal = the clubs'
    // goals added up, achieved per month = all clubs (same counting as a club's month-wise), answer = the clubs' answers
    // added up (numbers) - the same totals the Overview tab shows.
    [HttpGet("api/goal-flow/district-set-goals/district/{districtId:int}/monthly")]
    public async Task<ActionResult> GetDistrictSetGoalsMonthly(int districtId, [FromQuery] int? yearId)
    {
        if (!await KillSwitchHelper.IsDistrictDrillReachableAsync(_cs, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive." });
        await using var conn = await OpenAsync();
        var y = await ResolveYearAsync(conn, yearId);
        var year = await conn.QueryFirstAsync<(DateTime Start, DateTime End)>("SELECT StartDate, EndDate FROM rotary_year_master WHERE pk_year_id = @Y", new { Y = y });
        var lines = await LoadLinesAsync(conn, districtId, y);
        var answers = await LoadClubAnswersAsync(conn, districtId, y, null);
        var clubs = (await conn.QueryAsync<int>($@"SELECT c.pk_club_id FROM club_master c
            WHERE c.fk_district_id = @D AND c.isdeleted = 0 AND {HierarchyScopeSql.ClubLive("c")}", new { D = districtId })).ToList();
        var mc = await MonthCtxAsync(conn, districtId, y, year.Start, year.End);
        var inv = System.Globalization.CultureInfo.InvariantCulture;
        var rows = new List<object>();
        foreach (var l in lines)
        {
            var (monthly, risao) = await LineMonthlyAsync(conn, mc, l, clubs);
            var goals = l.ClubGoals.Where(g => clubs.Contains(g.Key) && g.Value != null).Select(g => g.Value!.Value).ToList();
            decimal? goal = goals.Count > 0 ? goals.Sum() : null;
            string? ans = null;
            if (l.AnswerType == "number")
            {
                var nums = new List<decimal>();
                foreach (var c in clubs)
                    if (answers.TryGetValue((c, l.LineType, l.LineId), out var v) && decimal.TryParse(v, System.Globalization.NumberStyles.Any, inv, out var n)) nums.Add(n);
                if (nums.Count > 0) ans = nums.Sum().ToString(inv);
            }
            // RCC line: the clubs' Rotary.org RCC goals added up, next to the District Set Goals (user 2026-11-23).
            var rcc = l.IsRcc ? l.ClubRccGoals.Where(g => clubs.Contains(g.Key) && g.Value != null).Select(g => g.Value!.Value).ToList() : new List<decimal>();
            rows.Add(new { l.LineType, l.LineId, l.CategoryName, l.Title, l.Source, isRisao = risao, l.AnswerType, goalValue = goal, answerValue = ans, monthly,
                l.IsRcc, rccGoal = rcc.Count > 0 ? rcc.Sum() : (decimal?)null });
        }
        return Ok(new { yearId = y, months = MonthlyGoalCounts.YearMonths, risaoAsOn = await RisaoFigures.AsOnAsync(conn, y, "Club"), lines = rows });
    }

    // Month-wise counting context of a district + year (activity + sub-item of each auto line; the lines carry only their title).
    private sealed record MonthCtx(int Y, DateTime Start, DateTime End, string? ProjTbl, Dictionary<string, int> Mods,
        List<(int Q, int? S, string Act, string? SubType, int? SubId, string? SubName)> Auto);
    private async Task<MonthCtx> MonthCtxAsync(MySqlConnection conn, int districtId, int y, DateTime start, DateTime end)
    {
        var proj = await HttpContext.RequestServices.GetRequiredService<IYearTableResolver>().ResolveByYearIdAsync(conn, y);
        var mods = await MonthlyGoalCounts.ModuleIdsAsync(conn);
        var autoInfo = (await conn.QueryAsync<(int Q, int? S, string Act, string? SubType, int? SubId, string? SubName)>(@"
            SELECT q.pk_id, s.pk_id, a.activity_name, s.sub_item_type, s.sub_item_id, s.sub_item_name
            FROM district_citation_auto_question q
            JOIN district_citation_activity_master a ON a.pk_id = q.fk_activity_id
            LEFT JOIN district_citation_auto_question_sub s ON s.fk_auto_question_id = q.pk_id AND s.isdeleted = 0
            WHERE q.fk_district_id = @D AND q.fk_year_id = @Y AND q.isdeleted = 0", new { D = districtId, Y = y })).ToList();
        return new MonthCtx(y, start, end, proj?.ProjectsTable, mods, autoInfo);
    }
    // One line's achieved per month for these clubs (Auto = counted by month, RISAO = the monthly import); Manual = null.
    private static async Task<(Dictionary<int, decimal>? Monthly, bool Risao)> LineMonthlyAsync(MySqlConnection conn, MonthCtx c, GoalLine l, IReadOnlyList<int> clubs)
    {
        if (l.Source != "auto") return (null, false);
        var info = l.LineType == "auto_sub" ? c.Auto.FirstOrDefault(x => x.S == l.LineId) : c.Auto.FirstOrDefault(x => x.Q == l.LineId);
        if (string.IsNullOrEmpty(info.Act) || !MonthlyGoalCounts.IsMonthly(info.Act)) return (null, false);
        var risao = RisaoFigures.IsRisaoActivity(info.Act);
        // Answered from Rotary.org (user 2026-11-20): Rotary.org has no club month figures - yearly only, so the months
        // never disagree with the year figure.
        if (await RotaryOrgClubFigures.AnyFromRotaryOrgAsync(conn, info.Act, clubs, c.Y)) return (null, false);
        var sub = l.LineType == "auto_sub";
        var monthly = risao ? await MonthlyGoalCounts.RisaoClubsAsync(conn, info.Act, clubs, c.Y)
            : c.ProjTbl == null ? new() : await MonthlyGoalCounts.AutoAsync(conn, info.Act, clubs, c.Y, c.Start, c.End, c.ProjTbl, c.Mods,
                sub ? info.SubType : null, sub ? info.SubId : null, sub ? info.SubName : null);
        return (monthly, risao);
    }

    // ── Reports (user 2026-11-18): District Set Goals - all clubs (DG) and one club (Club Admin / DG) ──
    private static string? ReportAnswer(GoalLine l, string? v) => l.AnswerType switch
    {
        "yesno" => v == "yes" ? "Yes" : v == "no" ? "No" : null,
        "choose_one" => l.Options.Select(o => (dynamic)o).Where(o => ((int)o.id).ToString() == v).Select(o => (string)o.optionText).FirstOrDefault() ?? v,
        _ => v,
    };
    private static GfQuestion ReportQuestion(GoalLine l) =>
        new(l.CategoryName, l.Title, l.Source != "manual", l.AnswerType, !l.IsRcc && RisaoFigures.IsRisaoActivity(l.Title), IsRcc: l.IsRcc);

    // Every club's District Awards points + bonus per line - adds up to EXACTLY District Awards' Club Points (user
    // 2026-11-19: District Awards is live, not one number may differ). Same entries District Awards counts (question of
    // this district + year, not deleted), ADDED (never overwritten). An entry with no line of its own (a deleted
    // sub-item, or the main line of a question shown by its sub-items) stays on its question: its main line, else
    // the question's first sub-item - so nothing District Awards counts is dropped.
    private static async Task<Dictionary<(int Club, string T, int L), decimal>> ClubPointsAsync(MySqlConnection conn, int districtId, int yearId, int? clubId, List<GoalLine> lines)
    {
        var have = lines.Select(l => (l.LineType, l.LineId)).ToHashSet();
        var firstOfQuestion = lines.Where(l => l.LineType is "auto" or "auto_sub").GroupBy(l => l.QuestionId)
            .ToDictionary(g => g.Key, g => (g.FirstOrDefault(l => l.LineType == "auto") ?? g.First()) is var x ? (x.LineType, x.LineId) : default);
        var map = new Dictionary<(int, string, int), decimal>();
        foreach (var e in await conn.QueryAsync<(int C, string Type, int Q, int? Sub, decimal P)>(@"
            SELECT e.fk_club_id, e.entry_type, e.fk_question_id, e.fk_sub_question_id, e.points_earned + e.bonus_earned
            FROM district_citation_club_entry e
            INNER JOIN district_citation_auto_question q ON q.pk_id = e.fk_question_id AND q.fk_district_id = @D AND q.fk_year_id = @Y AND q.isdeleted = 0
            WHERE e.fk_district_id = @D AND e.fk_year_id = @Y AND e.entry_type = 'auto' AND e.isdeleted = 0" + (clubId > 0 ? " AND e.fk_club_id = @C" : "") + @"
            UNION ALL
            SELECT e.fk_club_id, e.entry_type, e.fk_question_id, e.fk_sub_question_id, e.points_earned + e.bonus_earned
            FROM district_citation_club_entry e
            INNER JOIN district_citation_manual_sub_criteria sc ON sc.pk_id = e.fk_question_id AND sc.isdeleted = 0
            INNER JOIN district_citation_manual_criteria mc ON mc.pk_id = sc.fk_criteria_id AND mc.fk_district_id = @D AND mc.fk_year_id = @Y AND mc.isdeleted = 0
            WHERE e.fk_district_id = @D AND e.fk_year_id = @Y AND e.entry_type = 'manual' AND e.isdeleted = 0" + (clubId > 0 ? " AND e.fk_club_id = @C" : ""),
            new { D = districtId, Y = yearId, C = clubId ?? 0 }))
        {
            (string, int) k;
            if (e.Type == "manual") k = ("manual", e.Q);
            else if (e.Sub is > 0 && have.Contains(("auto_sub", e.Sub.Value))) k = ("auto_sub", e.Sub.Value);
            else if (have.Contains(("auto", e.Q))) k = ("auto", e.Q);
            else if (firstOfQuestion.TryGetValue(e.Q, out var fq)) k = fq;
            else continue;   // cannot happen: every counted question has at least one line
            var key = (e.C, k.Item1, k.Item2);
            map[key] = map.GetValueOrDefault(key) + e.P;
        }
        // RCC lines: their own points (District Set Goals only, never District Awards).
        foreach (var kv in await RccClubPointsAsync(conn, districtId, yearId, clubId, lines)) map[kv.Key] = kv.Value;
        return map;
    }

    [HttpGet("api/goal-flow/district-set-goals/district/{districtId:int}/report")]
    public async Task<ActionResult> DistrictSetGoalsReport(int districtId, [FromQuery] int? yearId)
    {
        if (!await KillSwitchHelper.IsDistrictDrillReachableAsync(_cs, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive." });
        await using var conn = await OpenAsync();
        var y = await ResolveYearAsync(conn, yearId);
        var lines = await LoadLinesAsync(conn, districtId, y);
        if (lines.Count == 0) return NotFound(new { message = "No District Awards questions for this year yet." });
        var clubs = (await conn.QueryAsync<(int Id, string Name)>($@"
            SELECT c.pk_club_id, c.ClubName FROM club_master c
            WHERE c.fk_district_id = @D AND c.isdeleted = 0 AND {HierarchyScopeSql.ClubLive("c")} ORDER BY c.ClubName", new { D = districtId })).ToList();
        if (clubs.Count == 0) return NotFound(new { message = "No clubs." });
        var answers = await LoadClubAnswersAsync(conn, districtId, y, null);
        var points = await ClubPointsAsync(conn, districtId, y, null, lines);
        // Month wise / Quarterly sheets (user 2026-11-19): each club's achieved per month (same counting as its month-wise).
        var yr = await conn.QueryFirstAsync<(DateTime Start, DateTime End)>("SELECT StartDate, EndDate FROM rotary_year_master WHERE pk_year_id = @Y", new { Y = y });
        var mc = await MonthCtxAsync(conn, districtId, y, yr.Start, yr.End);
        var cells = new GfCell[lines.Count, clubs.Count];
        for (int i = 0; i < lines.Count; i++)
            for (int e = 0; e < clubs.Count; e++)
            {
                var l = lines[i]; var cid = clubs[e].Id;
                answers.TryGetValue((cid, l.LineType, l.LineId), out var v);
                var goal = l.ClubGoals.TryGetValue(cid, out var g) ? g : null;
                var (monthly, _) = await LineMonthlyAsync(conn, mc, l, new List<int> { cid });
                cells[i, e] = new GfCell(goal, ReportAnswer(l, v), l.IsRcc ? null : Pct(l.AnswerType, goal, l.AnswerType == "choose_one" ? null : v),
                    points.GetValueOrDefault((cid, l.LineType, l.LineId)), Monthly: monthly,
                    RccGoal: l.IsRcc ? l.ClubRccGoals.GetValueOrDefault(cid) : null);
            }
        var num = await conn.ExecuteScalarAsync<string>("SELECT DistrictNumber FROM district_master WHERE pk_district_id = @D", new { D = districtId }) ?? "";
        var yl = await conn.ExecuteScalarAsync<string>("SELECT YearLabel FROM rotary_year_master WHERE pk_year_id = @Y", new { Y = y }) ?? "";
        // Same style as the Disha reports (user 2026-11-19): clubs down; Category / Question / Goal · Achieved · % · Points.
        var bytes = GoalFlowExcel.DistrictsDownOverview($"District Set Goals - District {num} - All Clubs",
            $"Rotary Year {yl}   ·   {clubs.Count} clubs   ·   Points = District Awards points   ·   Generated {DateTime.Now:dd MMM yyyy, hh:mm tt}",
            lines.Select(ReportQuestion).ToList(), clubs.Select(c => c.Name).ToList(), cells, "Club", showPoints: true, months: MonthlyGoalCounts.YearMonths.ToList(), showPct: false);   // no % in District Set Goals (user 2026-11-23)
        return File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"District_Set_Goals_D{num}_All_Clubs_{DateTime.Now:yyyyMMdd-HHmm}.xlsx");
    }

    [HttpGet("api/goal-flow/district-set-goals/club/{clubId:int}/report")]
    public async Task<ActionResult> ClubSetGoalsReport(int clubId, [FromQuery] int? yearId)
    {
        if (!await KillSwitchHelper.IsClubDrillReachableAsync(_cs, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive." });
        await using var conn = await OpenAsync();
        var club = await conn.QueryFirstOrDefaultAsync<(int D, string Name)>("SELECT fk_district_id, ClubName FROM club_master WHERE pk_club_id = @C", new { C = clubId });
        var y = await ResolveYearAsync(conn, yearId);
        var lines = await LoadLinesAsync(conn, club.D, y, clubId);
        if (lines.Count == 0) return NotFound(new { message = "Your District has not set goals for this year yet." });
        var answers = await LoadClubAnswersAsync(conn, club.D, y, clubId);
        var points = await ClubPointsAsync(conn, club.D, y, clubId, lines);
        // Month wise / Quarterly sheets (user 2026-11-19): the club's achieved per month, as its month-wise screen.
        var yr = await conn.QueryFirstAsync<(DateTime Start, DateTime End)>("SELECT StartDate, EndDate FROM rotary_year_master WHERE pk_year_id = @Y", new { Y = y });
        var mc = await MonthCtxAsync(conn, club.D, y, yr.Start, yr.End);
        var one = new List<int> { clubId };
        var cells = new List<GfCell>();
        foreach (var l in lines)
        {
            answers.TryGetValue((clubId, l.LineType, l.LineId), out var v);
            var (monthly, _) = await LineMonthlyAsync(conn, mc, l, one);
            cells.Add(new GfCell(l.GoalValue, ReportAnswer(l, v), l.IsRcc ? null : Pct(l.AnswerType, l.GoalValue, l.AnswerType == "choose_one" ? null : v),
                points.GetValueOrDefault((clubId, l.LineType, l.LineId)), Monthly: monthly, RccGoal: l.IsRcc ? l.RccGoal : null));
        }
        var yl = await conn.ExecuteScalarAsync<string>("SELECT YearLabel FROM rotary_year_master WHERE pk_year_id = @Y", new { Y = y }) ?? "";
        var bytes = GoalFlowExcel.Single($"District Set Goals - {club.Name}",
            $"Rotary Year {yl}   ·   Points = District Awards points   ·   Generated {DateTime.Now:dd MMM yyyy, hh:mm tt}",
            lines.Select(ReportQuestion).ToList(), cells, months: MonthlyGoalCounts.YearMonths.ToList(), showPct: false);   // no % in District Set Goals (user 2026-11-23)
        var safe = new string(club.Name.Select(ch => char.IsLetterOrDigit(ch) ? ch : '_').ToArray());
        return File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"District_Set_Goals_{safe}_{DateTime.Now:yyyyMMdd-HHmm}.xlsx");
    }

    public class ClubAnswerDto { public int LineId { get; set; } public string? AnswerValue { get; set; } }

    // Manual answers - written to the District Awards entries with the same points the awards form gives,
    // so District Awards shows the same answer and points.
    [HttpPost("api/goal-flow/district-set-goals/club/{clubId:int}/answers")]
    public async Task<ActionResult> SaveClubAnswers(int clubId, [FromBody] List<ClubAnswerDto> answers)
    {
        var denied = await _guard.ClubYearlessAsync(User, clubId);
        if (denied != null) return denied;
        if (answers.Count == 0) return Ok(new { message = "Nothing to save." });
        await using var conn = await OpenAsync();
        var districtId = await conn.ExecuteScalarAsync<int>("SELECT fk_district_id FROM club_master WHERE pk_club_id = @C", new { C = clubId });
        var yearId = await ResolveYearAsync(conn, null);
        if (!await DistrictAwardsConfigHelper.IsEnabledAsync(conn, districtId, yearId))
            return StatusCode(403, new { message = "District Awards is currently disabled by the administrator, so answers are read-only." });
        if (answers.Any(a => Num(a.AnswerValue) < 0))
            return BadRequest(new { message = "Answers cannot be negative. Please enter 0 or more." });

        var subs = (await conn.QueryAsync<(int Id, string? Type, decimal Points, bool IsBonus, decimal BonusPoints, int MinBonus, int MaxBonus)>(@"
            SELECT sc.pk_id, sc.answer_type, sc.points, sc.is_bonus, sc.bonus_points, sc.min_bonus, sc.max_bonus
            FROM district_citation_manual_sub_criteria sc
            JOIN district_citation_manual_criteria mc ON mc.pk_id = sc.fk_criteria_id AND mc.isdeleted = 0
            WHERE sc.pk_id IN @Ids AND sc.isdeleted = 0 AND mc.fk_district_id = @D AND mc.fk_year_id = @Y",
            new { Ids = answers.Select(a => a.LineId), D = districtId, Y = yearId })).ToDictionary(s => s.Id);
        // Keyed by (question, option): an option only scores on its own question, never another one's.
        var optPoints = subs.Count == 0 ? new Dictionary<(int Sub, int Id), decimal>()
            : (await conn.QueryAsync<(int Sub, int Id, decimal P)>(
                "SELECT fk_sub_criteria_id, pk_id, option_points FROM district_citation_manual_sub_criteria_option WHERE fk_sub_criteria_id IN @Ids AND isdeleted = 0",
                new { Ids = subs.Keys })).ToDictionary(o => (o.Sub, o.Id), o => o.P);
        var hasOpts = subs.Count == 0 ? new HashSet<int>()
            : (await conn.QueryAsync<int>("SELECT DISTINCT fk_sub_criteria_id FROM district_citation_manual_sub_criteria_option WHERE fk_sub_criteria_id IN @Ids AND isdeleted = 0",
                new { Ids = subs.Keys })).ToHashSet();

        var risaoLinked = (await conn.QueryAsync<int>(
            "SELECT fk_line_id FROM goal_risao_links WHERE fk_district_id = @D AND fk_year_id = @Y AND line_type = 'manual' AND risao_key IS NOT NULL",
            new { D = districtId, Y = yearId })).ToHashSet();
        foreach (var a in answers)
        {
            if (!subs.TryGetValue(a.LineId, out var sc)) continue;   // not a manual question of this district + year
            if (risaoLinked.Contains(a.LineId)) continue;            // filled from RISAO, not typed
            var type = NormType(sc.Type, hasOpts.Contains(sc.Id));
            decimal points = 0, bonus = 0;
            // Same formula as the District Awards club form (clubs/[id]/citation/v2/view.tsx updateManualAnswer).
            if (type == "number")
            {
                var v = Num(a.AnswerValue) ?? 0;
                points = v * sc.Points;
                if (sc.IsBonus)
                {
                    if (sc.MinBonus == 0 && sc.MaxBonus == 0) bonus = sc.BonusPoints;
                    else
                    {
                        if (v >= sc.MinBonus && sc.MinBonus > 0) bonus = sc.BonusPoints;
                        if (sc.MaxBonus > 0 && v > sc.MaxBonus) points = sc.MaxBonus * sc.Points;
                    }
                }
                if (v == 0) { points = 0; bonus = 0; }
            }
            else if (type == "yesno") points = a.AnswerValue == "yes" ? sc.Points : 0;
            else if (type == "choose_one") points = int.TryParse(a.AnswerValue, out var oid) && optPoints.TryGetValue((sc.Id, oid), out var op) ? op : 0;

            var existing = await conn.ExecuteScalarAsync<int?>(@"
                SELECT pk_id FROM district_citation_club_entry
                WHERE fk_district_id = @D AND fk_year_id = @Y AND fk_club_id = @C AND entry_type = 'manual' AND fk_question_id = @Q AND isdeleted = 0",
                new { D = districtId, Y = yearId, C = clubId, Q = a.LineId });
            if (existing.HasValue)
                await conn.ExecuteAsync(
                    "UPDATE district_citation_club_entry SET answer_value = @A, points_earned = @P, bonus_earned = @B, modified_by = @M, modified_date = NOW() WHERE pk_id = @Id",
                    new { Id = existing.Value, A = a.AnswerValue, P = points, B = bonus, M = MemberId });
            else
                await conn.ExecuteAsync(@"
                    INSERT INTO district_citation_club_entry (fk_district_id, fk_year_id, fk_club_id, entry_type, fk_question_id, answer_value, points_earned, bonus_earned, created_by, created_date)
                    VALUES (@D, @Y, @C, 'manual', @Q, @A, @P, @B, @M, NOW())",
                    new { D = districtId, Y = yearId, C = clubId, Q = a.LineId, A = a.AnswerValue, P = points, B = bonus, M = MemberId });
        }
        return Ok(new { message = "Answers saved." });
    }

    // ═════════════════════════ Disha Goals ═════════════════════════

    // Who sets Disha questions for a district: Super Admin, an RI Director (role 7), or an RI Director goal seat
    // whose zones include the district.
    private async Task<bool> CanSetDishaAsync(MySqlConnection conn, int districtId)
    {
        if (IsSuperAdmin) return true;
        var m = MemberId;
        if (m <= 0) return false;
        if (await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM member_roles WHERE fk_member_master_profile_id = @M AND fk_role_id = 7 AND IsActive = 1 AND isdeleted = 0",
                new { M = m }) > 0) return true;
        return await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM goal_role_assignments a
            JOIN goal_role_assignment_zones z ON z.fk_assignment_id = a.pk_id
            JOIN district_master d ON d.fk_zone_id = z.fk_zone_id AND d.pk_district_id = @D
            WHERE a.fk_member_id = @M AND a.RoleType = 'AllCategoryAllDistrictsFewZones' AND a.IsActive = 1 AND a.isdeleted = 0",
            new { M = m, D = districtId }) > 0;
    }

    // Districts the caller can set Disha questions for: Super Admin / RI Director (role 7) = all, an RI Director goal
    // seat = its zones. Only Rotary.org districts (user 2026-11-17): never Zone 0 / Other Zones, and only districts
    // whose clubs are synced from Rotary.org.
    public sealed record ScopeDistrict(int id, string districtNumber, int zoneId, string zoneName);
    private async Task<List<ScopeDistrict>> ScopeDistrictsAsync(MySqlConnection conn)
    {
        var m = MemberId;
        var all = IsSuperAdmin || await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM member_roles WHERE fk_member_master_profile_id = @M AND fk_role_id = 7 AND IsActive = 1 AND isdeleted = 0",
            new { M = m }) > 0;
        var sql = $@"
            SELECT d.pk_district_id AS id, d.DistrictNumber AS districtNumber, z.pk_zone_id AS zoneId, z.ZoneName AS zoneName
            FROM district_master d
            JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE d.isdeleted = 0 AND {HierarchyScopeSql.DistrictLive("d")}
              AND z.ZoneName NOT IN ('Zone 0', 'Other Zones')
              AND EXISTS (SELECT 1 FROM club_master c WHERE c.fk_district_id = d.pk_district_id
                          AND c.IsSyncedFromRotaryOrg = 1 AND {HierarchyScopeSql.ClubLive("c")})"
            + (all ? "" : @" AND d.fk_zone_id IN (
                SELECT z2.fk_zone_id FROM goal_role_assignments a
                JOIN goal_role_assignment_zones z2 ON z2.fk_assignment_id = a.pk_id
                WHERE a.fk_member_id = @M AND a.RoleType = 'AllCategoryAllDistrictsFewZones' AND a.IsActive = 1 AND a.isdeleted = 0)")
            + " ORDER BY z.ZoneName, d.DistrictNumber";
        return (await conn.QueryAsync<ScopeDistrict>(sql, new { M = m })).ToList();
    }

    [HttpGet("api/goal-flow/disha/districts")]
    public async Task<ActionResult> GetDishaDistricts()
    {
        await using var conn = await OpenAsync();
        return Ok(await ScopeDistrictsAsync(conn));
    }

    // RI Director: the districts they set Disha goals for, ranked by achievement score (no award points here).
    [HttpGet("api/goal-flow/disha/ranking")]
    public async Task<ActionResult> GetDishaRanking([FromQuery] int? yearId)
    {
        await using var conn = await OpenAsync();
        var list = await ScopeDistrictsAsync(conn);
        var y = await ResolveYearAsync(conn, yearId);
        var ids = list.Select(d => d.id).ToList();
        var rows = ids.Count == 0 ? new List<(int D, string Type, decimal? Goal, string? Ans)>()
            : (await conn.QueryAsync<(int D, string Type, decimal? Goal, string? Ans)>(@"
                SELECT q.fk_district_id, q.answer_type, q.goal_value, a.answer_value
                FROM disha_goal_questions q
                LEFT JOIN disha_goal_answers a ON a.fk_question_id = q.pk_id AND a.fk_district_id = q.fk_district_id
                WHERE q.fk_district_id IN @Ids AND q.fk_year_id = @Y AND q.isdeleted = 0", new { Ids = ids, Y = y })).ToList();
        var ranked = list.Select(d =>
        {
            int id = d.id;
            var mine = rows.Where(r => r.D == id).ToList();
            var (goals, reached, score) = ScoreOf(mine.Select(r => (r.Type, r.Goal, r.Ans)));
            return new { districtId = id, districtNumber = d.districtNumber, zoneId = d.zoneId, zoneName = d.zoneName,
                questions = mine.Count, goals, reached, score };
        })
        .OrderByDescending(r => r.score ?? -1).ThenByDescending(r => r.reached).ThenBy(r => r.districtNumber)
        .Select((r, i) => new { rank = i + 1, r.districtId, r.districtNumber, r.zoneId, r.zoneName, r.questions, r.goals, r.reached, r.score })
        .ToList();
        return Ok(new { yearId = y, districts = ranked });
    }

    public class DishaQuestion
    {
        public int Id { get; set; }
        public string GroupKey { get; set; } = "";       // the shared question this district's row belongs to
        public string CategoryName { get; set; } = "";
        public string QuestionText { get; set; } = "";
        public string Source { get; set; } = "manual";
        public string AnswerType { get; set; } = "number";
        public List<string> Options { get; set; } = new();
        public int? ActivityId { get; set; }
        public string? ActivityName { get; set; }
        public string? SubItemType { get; set; }
        public int? SubItemId { get; set; }
        public string? SubItemName { get; set; }
        public int? FilterAofId { get; set; }
        public int? FilterCatId { get; set; }
        public decimal? GoalValue { get; set; }
        public string? RisaoKey { get; set; }
        public int SortOrder { get; set; }
        public string? AnswerValue { get; set; }
        public decimal? AchievementPct { get; set; }
    }

    private static async Task<List<DishaQuestion>> LoadDishaAsync(MySqlConnection conn, int districtId, int yearId)
    {
        var rows = (await conn.QueryAsync<dynamic>(@"
            SELECT q.pk_id, q.category_name, q.question_text, q.source, q.answer_type, q.options_json, q.fk_activity_id,
                   a.activity_name, q.sub_item_type, q.sub_item_id, q.sub_item_name, q.filter_aof_id, q.filter_cat_id,
                   q.goal_value, q.risao_key, q.sort_order, COALESCE(q.group_key, CONCAT('q', q.pk_id)) AS group_key, ans.answer_value
            FROM disha_goal_questions q
            LEFT JOIN district_citation_activity_master a ON a.pk_id = q.fk_activity_id
            LEFT JOIN disha_goal_answers ans ON ans.fk_question_id = q.pk_id AND ans.fk_district_id = q.fk_district_id
            WHERE q.fk_district_id = @D AND q.fk_year_id = @Y AND q.isdeleted = 0
            ORDER BY q.category_name, q.sort_order, q.pk_id", new { D = districtId, Y = yearId })).ToList();
        return rows.Select(r => new DishaQuestion
        {
            Id = (int)r.pk_id, CategoryName = (string)r.category_name, QuestionText = (string)r.question_text,
            Source = (string)r.source, AnswerType = (string)r.answer_type,
            Options = string.IsNullOrEmpty((string?)r.options_json) ? new List<string>()
                : JsonSerializer.Deserialize<List<string>>((string)r.options_json) ?? new List<string>(),
            ActivityId = (int?)r.fk_activity_id, ActivityName = (string?)r.activity_name,
            SubItemType = (string?)r.sub_item_type, SubItemId = (int?)r.sub_item_id, SubItemName = (string?)r.sub_item_name,
            FilterAofId = (int?)r.filter_aof_id, FilterCatId = (int?)r.filter_cat_id,
            GroupKey = (string)r.group_key, GoalValue = (decimal?)r.goal_value, RisaoKey = (string?)r.risao_key, SortOrder = (int)r.sort_order, AnswerValue = (string?)r.answer_value,
        }).ToList();
    }

    [HttpGet("api/goal-flow/disha/{districtId:int}")]
    public async Task<ActionResult> GetDisha(int districtId, [FromQuery] int? yearId)
    {
        if (!await KillSwitchHelper.IsDistrictDrillReachableAsync(_cs, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive." });
        await using var conn = await OpenAsync();
        var y = await ResolveYearAsync(conn, yearId);
        var currentYear = await ResolveYearAsync(conn, null);
        var qs = await LoadDishaAsync(conn, districtId, y);
        foreach (var q in qs) q.AchievementPct = Pct(q.AnswerType, q.GoalValue, q.AnswerValue);
        var canSet = await CanSetDishaAsync(conn, districtId);
        var canAnswer = y == currentYear && await _guard.DistrictYearAsync(User, districtId, y) == null;
        var risaoAsOn = await RisaoFigures.AsOnAsync(conn, y, "District");   // "Imported from RISAO · as on Oct 2026"
        return Ok(new { yearId = y, canSet, canAnswer, risaoAsOn, questions = qs });
    }

    public class DishaQuestionDto
    {
        public int YearId { get; set; }
        public string CategoryName { get; set; } = "";
        public string QuestionText { get; set; } = "";
        public string Source { get; set; } = "manual";
        public string AnswerType { get; set; } = "number";
        public List<string> Options { get; set; } = new();
        public int? ActivityId { get; set; }
        public string? SubItemType { get; set; }
        public int? SubItemId { get; set; }
        public string? SubItemName { get; set; }
        public int? FilterAofId { get; set; }
        public int? FilterCatId { get; set; }
        public decimal? GoalValue { get; set; }
        public string? RisaoKey { get; set; }
        public int SortOrder { get; set; }
    }

    private static string? Validate(DishaQuestionDto d)
    {
        if (string.IsNullOrWhiteSpace(d.CategoryName)) return "Category is required.";
        if (d.Source is not ("manual" or "auto" or "risao")) return "Source must be manual, auto or RISAO.";
        if (d.Source == "risao" && Risao(d.RisaoKey)?.DistrictField == null) return "Pick the RISAO figure.";
        if (d.Source == "auto" && !(d.ActivityId > 0)) return "Pick the activity for an auto question.";
        if (d.Source == "manual" && string.IsNullOrWhiteSpace(d.QuestionText)) return "Question is required.";
        if (d.AnswerType is not ("number" or "yesno" or "choose_one" or "text")) return "Unknown answer type.";
        if (d.Source == "manual" && d.AnswerType == "choose_one" && d.Options.Count(o => !string.IsNullOrWhiteSpace(o)) == 0) return "Add at least one option.";
        if (d.GoalValue < 0) return "A goal cannot be negative.";
        return null;
    }

    private static object Params(DishaQuestionDto d, int districtId, int memberId, string questionText) => new
    {
        D = districtId, Y = d.YearId, Cat = d.CategoryName.Trim(), Text = questionText, d.Source,
        Type = d.Source != "manual" ? "number" : d.AnswerType,
        Opts = d.Source == "manual" && d.AnswerType == "choose_one"
            ? JsonSerializer.Serialize(d.Options.Where(o => !string.IsNullOrWhiteSpace(o)).Select(o => o.Trim())) : null,
        Act = d.Source == "auto" ? d.ActivityId : null,
        SubT = d.Source == "auto" ? d.SubItemType : null, SubI = d.Source == "auto" ? d.SubItemId : null,
        SubN = d.Source == "auto" ? d.SubItemName : null,
        FAof = d.Source == "auto" ? d.FilterAofId : null, FCat = d.Source == "auto" ? d.FilterCatId : null,
        Goal = (d.Source != "manual" || d.AnswerType == "number") ? d.GoalValue : null,
        Risao = d.Source == "risao" ? d.RisaoKey : null,
        Sort = d.SortOrder, M = memberId,
    };

    // Auto question text = the activity (and sub-item) name, like District Awards.
    private static async Task<string> QuestionTextAsync(MySqlConnection conn, DishaQuestionDto d)
    {
        if (d.Source == "risao") return string.IsNullOrWhiteSpace(d.QuestionText) ? Risao(d.RisaoKey)!.Value.Label : d.QuestionText.Trim();
        if (d.Source != "auto") return d.QuestionText.Trim();
        var act = await conn.ExecuteScalarAsync<string?>("SELECT activity_name FROM district_citation_activity_master WHERE pk_id = @Id", new { Id = d.ActivityId }) ?? "";
        return string.IsNullOrWhiteSpace(d.SubItemName) ? act : $"{act} - {d.SubItemName}";
    }

    // ── Shared questions (user 2026-11-17): the RI Director asks ONE question of all their districts; each district has
    // its own goal (blank = no goal). Stored as one row per district sharing group_key, so answers / ranking stay per district.

    // The board: districts (optionally one zone) x questions, with each district's goal / answer / %.
    [HttpGet("api/goal-flow/disha/board")]
    public async Task<ActionResult> GetDishaBoard([FromQuery] int? yearId, [FromQuery] int? zoneId)
    {
        await using var conn = await OpenAsync();
        var y = await ResolveYearAsync(conn, yearId);
        var scope = await ScopeDistrictsAsync(conn);
        var zones = scope.GroupBy(d => d.zoneId).Select(g => new { id = g.Key, name = g.First().zoneName }).OrderBy(z => z.name).ToList();
        var districts = scope.Where(d => !(zoneId > 0) || d.zoneId == zoneId).ToList();
        var rows = new List<(int DistrictId, DishaQuestion Q)>();
        foreach (var d in districts)
            foreach (var q in await LoadDishaAsync(conn, d.id, y)) { q.AchievementPct = Pct(q.AnswerType, q.GoalValue, q.AnswerValue); rows.Add((d.id, q)); }
        var questions = rows.GroupBy(r => r.Q.GroupKey).Select(g =>
        {
            var f = g.First().Q;
            return new
            {
                groupKey = g.Key, f.CategoryName, f.QuestionText, f.Source, f.AnswerType, f.Options, f.ActivityId, f.ActivityName,
                f.SubItemType, f.SubItemId, f.SubItemName, f.FilterAofId, f.FilterCatId, f.RisaoKey, f.SortOrder,
                cells = g.ToDictionary(r => r.DistrictId, r => new { questionId = r.Q.Id, goal = r.Q.GoalValue, answer = r.Q.AnswerValue, pct = r.Q.AchievementPct }),
            };
        }).OrderBy(q => q.CategoryName).ThenBy(q => q.SortOrder).ThenBy(q => q.QuestionText).ToList();
        return Ok(new { yearId = y, canSet = scope.Count > 0, zones, districts, questions });
    }

    public class DishaGroupDto : DishaQuestionDto
    {
        public Dictionary<int, decimal?> Goals { get; set; } = new();   // districtId -> goal (missing / null = no goal)
    }

    private static async Task InsertDishaRowAsync(MySqlConnection conn, DishaQuestionDto d, string groupKey, int districtId, decimal? goal, int memberId, string text)
    {
        var p = new DynamicParameters(Params(d, districtId, memberId, text));
        p.Add("Goal", (d.Source != "manual" || d.AnswerType == "number") ? goal : null);
        p.Add("G", groupKey);
        await conn.ExecuteAsync(@"
            INSERT INTO disha_goal_questions (fk_district_id, fk_year_id, category_name, question_text, source, answer_type, options_json,
                fk_activity_id, sub_item_type, sub_item_id, sub_item_name, filter_aof_id, filter_cat_id, goal_value, risao_key, sort_order, group_key, created_by)
            VALUES (@D, @Y, @Cat, @Text, @Source, @Type, @Opts, @Act, @SubT, @SubI, @SubN, @FAof, @FCat, @Goal, @Risao, @Sort, @G, @M)", p);
    }

    // New shared question: one row for every district in the caller's scope.
    [HttpPost("api/goal-flow/disha/groups")]
    public async Task<ActionResult> CreateDishaGroup([FromBody] DishaGroupDto d)
    {
        await using var conn = await OpenAsync();
        var scope = await ScopeDistrictsAsync(conn);
        if (scope.Count == 0) return StatusCode(403, new { message = "Disha Goals are set by the RI Director or Super Admin." });
        if (Validate(d) is { } err) return BadRequest(new { message = err });
        if (d.Goals.Values.Any(g => g < 0)) return BadRequest(new { message = "A goal cannot be negative." });
        var key = Guid.NewGuid().ToString("N");
        var text = await QuestionTextAsync(conn, d);
        foreach (var dist in scope)
            await InsertDishaRowAsync(conn, d, key, dist.id, d.Goals.TryGetValue(dist.id, out var g) ? g : null, MemberId, text);
        if (d.Source == "risao") foreach (var dist in scope) await PunchDishaRisaoAsync(conn, dist.id, d.YearId, MemberId);
        return Ok(new { groupKey = key, message = $"Question added for {scope.Count} districts." });
    }

    // Edit the question itself (all districts in scope); each district's goal is kept.
    [HttpPut("api/goal-flow/disha/groups/{groupKey}")]
    public async Task<ActionResult> UpdateDishaGroup(string groupKey, [FromBody] DishaQuestionDto d)
    {
        await using var conn = await OpenAsync();
        var scope = await ScopeDistrictsAsync(conn);
        if (scope.Count == 0) return StatusCode(403, new { message = "Disha Goals are set by the RI Director or Super Admin." });
        if (Validate(d) is { } err) return BadRequest(new { message = err });
        var p = new DynamicParameters(Params(d, 0, MemberId, await QuestionTextAsync(conn, d)));
        p.Add("G", groupKey); p.Add("Ds", scope.Select(x => x.id));
        // A question that is no longer a Number one has no goal any more.
        var n = await conn.ExecuteAsync(@"
            UPDATE disha_goal_questions SET category_name = @Cat, question_text = @Text, source = @Source, answer_type = @Type,
                options_json = @Opts, fk_activity_id = @Act, sub_item_type = @SubT, sub_item_id = @SubI, sub_item_name = @SubN,
                filter_aof_id = @FAof, filter_cat_id = @FCat, risao_key = @Risao, sort_order = @Sort,
                goal_value = CASE WHEN @Type = 'number' THEN goal_value ELSE NULL END, modified_by = @M, modified_date = NOW()
            WHERE COALESCE(group_key, CONCAT('q', pk_id)) = @G AND fk_district_id IN @Ds AND isdeleted = 0", p);
        if (n > 0 && d.Source == "risao") foreach (var dist in scope) await PunchDishaRisaoAsync(conn, dist.id, d.YearId, MemberId);
        return n == 0 ? NotFound(new { message = "Question not found." }) : Ok(new { message = "Question updated." });
    }

    public class DishaGoalsDto { public int YearId { get; set; } public Dictionary<int, decimal?> Goals { get; set; } = new(); }

    // Each district's goal for one shared question. A district in scope without a row (e.g. new in the zone) gets one.
    [HttpPut("api/goal-flow/disha/groups/{groupKey}/goals")]
    public async Task<ActionResult> SaveDishaGroupGoals(string groupKey, [FromBody] DishaGoalsDto body)
    {
        await using var conn = await OpenAsync();
        var scope = (await ScopeDistrictsAsync(conn)).Select(x => x.id).ToHashSet();
        if (scope.Count == 0) return StatusCode(403, new { message = "Disha Goals are set by the RI Director or Super Admin." });
        if (body.Goals.Values.Any(g => g < 0)) return BadRequest(new { message = "A goal cannot be negative." });
        var rows = (await conn.QueryAsync<(int Id, int D, string Type)>(@"
            SELECT pk_id, fk_district_id, answer_type FROM disha_goal_questions
            WHERE COALESCE(group_key, CONCAT('q', pk_id)) = @G AND fk_year_id = @Y AND isdeleted = 0", new { G = groupKey, Y = body.YearId })).ToList();
        if (rows.Count == 0) return NotFound(new { message = "Question not found." });
        if (rows[0].Type != "number") return BadRequest(new { message = "Only Number questions have a goal." });
        foreach (var (did, goal) in body.Goals.Where(g => scope.Contains(g.Key)))
        {
            var row = rows.FirstOrDefault(r => r.D == did);
            if (row.Id > 0)
                await conn.ExecuteAsync("UPDATE disha_goal_questions SET goal_value = @V, modified_by = @M, modified_date = NOW() WHERE pk_id = @Id",
                    new { V = goal, M = MemberId, Id = row.Id });
            else
                await conn.ExecuteAsync(@"
                    INSERT INTO disha_goal_questions (fk_district_id, fk_year_id, category_name, question_text, source, answer_type, options_json,
                        fk_activity_id, sub_item_type, sub_item_id, sub_item_name, filter_aof_id, filter_cat_id, goal_value, risao_key, sort_order, group_key, created_by)
                    SELECT @D, fk_year_id, category_name, question_text, source, answer_type, options_json, fk_activity_id, sub_item_type,
                           sub_item_id, sub_item_name, filter_aof_id, filter_cat_id, @V, risao_key, sort_order, @G, @M
                    FROM disha_goal_questions WHERE pk_id = @Src",
                    new { D = did, V = goal, G = groupKey, M = MemberId, Src = rows[0].Id });
        }
        return Ok(new { message = "Goals saved." });
    }

    // Soft delete the shared question for every district in scope.
    [HttpDelete("api/goal-flow/disha/groups/{groupKey}")]
    public async Task<ActionResult> DeleteDishaGroup(string groupKey)
    {
        await using var conn = await OpenAsync();
        var scope = (await ScopeDistrictsAsync(conn)).Select(x => x.id).ToList();
        if (scope.Count == 0) return StatusCode(403, new { message = "Disha Goals are set by the RI Director or Super Admin." });
        await conn.ExecuteAsync(@"UPDATE disha_goal_questions SET isdeleted = 1, modified_by = @M, modified_date = NOW()
            WHERE COALESCE(group_key, CONCAT('q', pk_id)) = @G AND fk_district_id IN @Ds", new { G = groupKey, Ds = scope, M = MemberId });
        return Ok(new { message = "Question deleted." });
    }

    public class DishaAnswerDto { public int QuestionId { get; set; } public string? AnswerValue { get; set; } }

    // District Admin answers the manual questions (current year).
    [HttpPost("api/goal-flow/disha/{districtId:int}/answers")]
    public async Task<ActionResult> SaveDishaAnswers(int districtId, [FromBody] List<DishaAnswerDto> answers)
    {
        await using var conn = await OpenAsync();
        var y = await ResolveYearAsync(conn, null);
        var denied = await _guard.DistrictYearAsync(User, districtId, y);
        if (denied != null) return denied;
        if (answers.Any(a => Num(a.AnswerValue) < 0)) return BadRequest(new { message = "Answers cannot be negative. Please enter 0 or more." });
        var manualIds = (await conn.QueryAsync<int>(
            "SELECT pk_id FROM disha_goal_questions WHERE fk_district_id = @D AND fk_year_id = @Y AND source = 'manual' AND isdeleted = 0",
            new { D = districtId, Y = y })).ToHashSet();
        foreach (var a in answers.Where(a => manualIds.Contains(a.QuestionId)))
            await UpsertDishaAnswerAsync(conn, a.QuestionId, districtId, a.AnswerValue, MemberId);
        return Ok(new { message = "Answers saved." });
    }

    private static Task UpsertDishaAnswerAsync(MySqlConnection conn, int questionId, int districtId, string? value, int memberId) =>
        conn.ExecuteAsync(@"
            INSERT INTO disha_goal_answers (fk_question_id, fk_district_id, answer_value, created_by)
            VALUES (@Q, @D, @V, @M)
            ON DUPLICATE KEY UPDATE answer_value = @V, modified_by = @M, modified_date = NOW()",
            new { Q = questionId, D = districtId, V = value, M = memberId });

    // Count the auto questions again over the district's clubs (District Awards counting rules) and store them.
    [HttpPost("api/goal-flow/disha/{districtId:int}/refresh-auto")]
    public async Task<ActionResult> RefreshDishaAuto(int districtId, [FromQuery] int? yearId)
    {
        await using var conn = await OpenAsync();
        var y = await ResolveYearAsync(conn, yearId);
        var allowed = await CanSetDishaAsync(conn, districtId) || await _guard.DistrictYearAsync(User, districtId, y) == null;
        if (!allowed) return StatusCode(403, new { message = "You cannot refresh this district's goals." });
        var svc = HttpContext.RequestServices.GetRequiredService<CitationAutoPointsBackgroundService>();
        var autos = (await LoadDishaAsync(conn, districtId, y)).Where(q => q.Source == "auto" && !string.IsNullOrEmpty(q.ActivityName)).ToList();
        foreach (var q in autos)
        {
            var count = await svc.CountForDistrictAsync(districtId, y, q.ActivityName!, q.SubItemType, q.SubItemId, q.SubItemName);
            if (count.HasValue) await UpsertDishaAnswerAsync(conn, q.Id, districtId, count.Value.ToString(CultureInfo.InvariantCulture), MemberId);
        }
        var risao = await PunchDishaRisaoAsync(conn, districtId, y, MemberId);
        return Ok(new { message = autos.Count == 0 && risao == 0 ? "Nothing to refresh." : "Auto and RISAO answers refreshed." });
    }
}
