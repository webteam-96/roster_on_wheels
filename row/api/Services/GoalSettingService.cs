using ClosedXML.Excel;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

public class GoalSettingService : IGoalSettingService
{
    private readonly string _cs;

    public GoalSettingService(IConfiguration configuration)
    {
        _cs = configuration.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("DefaultConnection missing");
    }

    private MySqlConnection CreateConnection() => new(_cs);

    public async Task<List<GoalCategoryDto>> GetCategoriesAsync()
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var rows = await conn.QueryAsync<dynamic>(
            "SELECT pk_category_id AS id, IF(Name = 'TRF', 'Foundation', Name) AS name, SortOrder AS sortOrder FROM goal_categories WHERE isdeleted = 0 ORDER BY SortOrder");
        return rows.Select(r => new GoalCategoryDto
        {
            Id = Convert.ToInt32(r.id),
            Name = (string)r.name,
            SortOrder = Convert.ToInt32(r.sortOrder),
            HasMonthWise = !IsAnnualOnlyCategory((string)r.name),
        }).ToList();
    }

    // ── Club resolution ──────────────────────────────────────────────────
    // Same shape as FoundationGoalsService.ResolveClubIdAsync, but the District Admin
    // override is UNCONDITIONAL here (no AllClubsAccess gate) — every District Admin must
    // be able to view/edit every one of their clubs' goals, per the Goal Setting spec.
    private async Task<int> ResolveClubIdAsync(MySqlConnection conn, int memberId, int? requestedClubId)
    {
        if (memberId <= 0) return 0;

        if (requestedClubId is > 0)
        {
            var isSelfAdmin = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM member_roles
                WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 2
                  AND fk_club_id = @ClubId AND IsActive = 1 AND isdeleted = 0",
                new { MemberId = memberId, ClubId = requestedClubId.Value });
            if (isSelfAdmin > 0) return requestedClubId.Value;

            var isDistrictAdminForClub = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM member_roles mr
                JOIN club_master c ON c.pk_club_id = @ClubId AND c.isdeleted = 0
                WHERE mr.fk_member_master_profile_id = @MemberId AND mr.fk_role_id = 2
                  AND mr.fk_district_id = c.fk_district_id
                  AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0)
                  AND mr.IsActive = 1 AND mr.isdeleted = 0",
                new { MemberId = memberId, ClubId = requestedClubId.Value });
            if (isDistrictAdminForClub > 0) return requestedClubId.Value;

            if (await ClubAdminAccessHelper.IsSuperAdminAsync(conn, memberId)) return requestedClubId.Value;

            throw new UnauthorizedAccessException("You are not authorised for this club's goals.");
        }

        var clubId = await conn.ExecuteScalarAsync<int?>(@"
            SELECT fk_club_id FROM member_roles
            WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 2
              AND fk_club_id IS NOT NULL AND fk_club_id > 0 AND IsActive = 1 AND isdeleted = 0
            ORDER BY pk_member_role_id DESC LIMIT 1", new { MemberId = memberId });
        if (clubId is > 0) return clubId.Value;

        return 0;
    }

    // ── District resolution ──────────────────────────────────────────────
    // Same convention as DistrictAdminDashboardService.ResolveDistrictIdAsync.
    private async Task<int> ResolveDistrictIdAsync(MySqlConnection conn, int memberId, int? requestedDistrictId)
    {
        if (memberId <= 0) return 0;

        if (await ClubAdminAccessHelper.IsSuperAdminAsync(conn, memberId))
        {
            if (requestedDistrictId is > 0) return requestedDistrictId.Value;
        }

        if (requestedDistrictId is > 0)
        {
            var isDistrictAdmin = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM member_roles
                WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 2
                  AND fk_district_id = @DistrictId
                  AND (fk_club_id IS NULL OR fk_club_id = 0)
                  AND IsActive = 1 AND isdeleted = 0",
                new { MemberId = memberId, DistrictId = requestedDistrictId.Value });
            if (isDistrictAdmin > 0) return requestedDistrictId.Value;

            if (await ClubAdminAccessHelper.IsSuperAdminAsync(conn, memberId)) return requestedDistrictId.Value;
            throw new UnauthorizedAccessException("You are not an active admin for this district.");
        }

        var districtId = await conn.ExecuteScalarAsync<int?>(@"
            SELECT fk_district_id FROM member_roles
            WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 2
              AND fk_district_id IS NOT NULL AND fk_district_id > 0
              AND (fk_club_id IS NULL OR fk_club_id = 0)
              AND IsActive = 1 AND isdeleted = 0
            ORDER BY pk_member_role_id DESC LIMIT 1", new { MemberId = memberId });
        return districtId ?? 0;
    }

    // ── Year resolution ──────────────────────────────────────────────────
    private async Task<(int YearId, string YearLabel, bool IsEditable)> ResolveYearAsync(MySqlConnection conn, int? yearId)
    {
        var row = yearId is > 0
            ? await conn.QueryFirstOrDefaultAsync<dynamic>(
                "SELECT pk_year_id AS id, YearLabel AS label, (EndDate >= CURDATE()) AS editable FROM rotary_year_master WHERE pk_year_id = @Id AND isdeleted = 0",
                new { Id = yearId.Value })
            : await conn.QueryFirstOrDefaultAsync<dynamic>(
                "SELECT pk_year_id AS id, YearLabel AS label, (EndDate >= CURDATE()) AS editable FROM rotary_year_master WHERE isdeleted = 0 AND IsCurrent = 1 ORDER BY pk_year_id DESC LIMIT 1");
        if (row == null) return (0, "", false);
        return (Convert.ToInt32(row.id), (string)row.label, Convert.ToBoolean(row.editable ?? 0L));
    }

    // ── Generic field+value loading (shared by club and district forms) ────
    private async Task<List<GoalFieldWithValueDto>> LoadFieldsWithValuesAsync(
        MySqlConnection conn, int categoryId, int yearId, string entityType, int clubId, int districtId,
        bool autoFillLive = false)
    {
        var rows = await conn.QueryAsync<dynamic>(@"
            SELECT f.pk_field_id AS fieldId, f.GroupName AS groupName, f.FieldKey AS fieldKey,
                   f.FieldLabel AS fieldLabel, f.DataType AS dataType, f.Unit AS unit, f.FieldRole AS fieldRole,
                   e.NumericValue AS numericValue, e.TextValue AS textValue, e.BoolValue AS boolValue
            FROM goal_fields f
            LEFT JOIN goal_entries e
                   ON e.fk_field_id = f.pk_field_id AND e.fk_year_id = @YearId AND e.EntityType = @EntityType
                  AND e.fk_club_id = @ClubId AND e.fk_district_id = @DistrictId AND e.isdeleted = 0
            WHERE f.fk_category_id = @CategoryId AND f.isdeleted = 0 AND f.IsActive = 1 AND f.IsHidden = 0
              AND (f.AppliesTo = 'Both' OR f.AppliesTo = @EntityType)
            ORDER BY f.SortOrder, f.pk_field_id",
            new { CategoryId = categoryId, YearId = yearId, EntityType = entityType, ClubId = clubId, DistrictId = districtId });

        var list = rows.Select(r => new GoalFieldWithValueDto
        {
            FieldId = Convert.ToInt32(r.fieldId),
            GroupName = (string)r.groupName,
            FieldKey = (string)r.fieldKey,
            FieldLabel = (string)r.fieldLabel,
            DataType = (string)r.dataType,
            Unit = r.unit as string,
            FieldRole = (string)r.fieldRole,
            NumericValue = r.numericValue is null ? null : Whole(Convert.ToDecimal(r.numericValue)),
            TextValue = r.textValue as string,
            BoolValue = r.boolValue is null ? null : Convert.ToBoolean(r.boolValue),
        }).ToList();
        // MinValue is stamped at the END of this method (after the live auto-fill), so the floor is
        // measured against the figures the user actually sees.

        // Total Clubs / Total Members / Women Members (baseline "as on July 1st" + achieved) are
        // date-windowed by the viewed year's Jul 1 → Jun 30 range, so they are auto-calculated for
        // EVERY year (past years included) straight from ClubCharterDate / club_members.JoinedDate.
        // Everything else — Target, TRF/Youth/PI, and the RAG "Healthy Clubs" bands (a right-now
        // snapshot) — is only auto-filled for the current/editable year; past years keep saved figures.
        bool hasMembership = list.Any(f => f.FieldKey is "total_clubs" or "total_members" or "existing_women_members"
            or "new_clubs_achieved" or "new_members_achieved" or "new_women_members_achieved"
            or "women_members_percent" or "avg_members_per_club");
        if (autoFillLive || hasMembership)
        {
            int? liveClubs = null, liveMembers = null, liveWomen = null;
            int? newClubsAchieved = null, newWomenAchieved = null, newMembersAchieved = null;
            (int Red, int Amber, int Green, int SuperGreen)? rag = null;

            // "Achieved this year" progress is bounded by the viewed Rotary year's date range
            // (new clubs by ClubCharterDate, new women by club_members.JoinedDate).
            DateTime? yearStart = null, yearEnd = null;
            var yr = await conn.QueryFirstOrDefaultAsync(
                "SELECT StartDate AS s, EndDate AS e FROM rotary_year_master WHERE pk_year_id = @Y AND isdeleted = 0",
                new { Y = yearId });
            if (yr != null)
            {
                if (yr.s != null) yearStart = (DateTime)yr.s;
                if (yr.e != null) yearEnd = (DateTime)yr.e;
            }

            // From 2026-27 the district's Clubs / Members / Women (July 1st + Achieved) come from the
            // Rotary.org Excel import (user 2026-10-08) - no live counting; the stored figures show.
            if (hasMembership && entityType == "District" && !IsDistrictMembershipImported(entityType, yearStart))
            {
                liveClubs = await LiveDistrictClubCountAsync(conn, districtId, yearStart);
                liveMembers = await LiveDistrictMemberCountAsync(conn, districtId, yearStart);
                liveWomen = await LiveDistrictWomenCountAsync(conn, districtId, yearStart);
                if (yearStart != null && yearEnd != null)
                {
                    newClubsAchieved = await AchievedNewClubsDistrictAsync(conn, districtId, yearStart.Value, yearEnd.Value);
                    newWomenAchieved = await AchievedNewWomenDistrictAsync(conn, districtId, yearStart.Value, yearEnd.Value);
                    newMembersAchieved = await AchievedNewMembersDistrictAsync(conn, districtId, yearStart.Value, yearEnd.Value);
                }
            }
            else if (hasMembership && entityType == "Club")
            {
                liveMembers = await LiveClubMemberCountAsync(conn, clubId, yearStart);
                liveWomen = await LiveClubWomenCountAsync(conn, clubId, yearStart);
                if (yearStart != null && yearEnd != null)
                {
                    newWomenAchieved = await AchievedNewWomenClubAsync(conn, clubId, yearStart.Value, yearEnd.Value);
                    newMembersAchieved = await AchievedNewMembersClubAsync(conn, clubId, yearStart.Value, yearEnd.Value);
                }
            }

            // RAG "Healthy Clubs" bands are a right-now snapshot of current active membership →
            // only meaningful for the current/editable year.
            if (autoFillLive && entityType == "District")
                rag = await LiveDistrictRagCountsAsync(conn, districtId);

            foreach (var f in list)
            {
                if (f.FieldKey == "total_clubs" && liveClubs != null) f.NumericValue = liveClubs;
                else if (f.FieldKey == "total_members" && liveMembers != null) f.NumericValue = liveMembers;
                else if (f.FieldKey == "existing_women_members" && liveWomen != null) f.NumericValue = liveWomen;
                else if (f.FieldKey == "women_members_percent" && liveMembers is > 0 && liveWomen != null)
                    f.NumericValue = Math.Round((decimal)liveWomen.Value / liveMembers.Value * 100, 0, MidpointRounding.AwayFromZero);
                else if (f.FieldKey == "avg_members_per_club" && liveClubs is > 0 && liveMembers != null)
                    f.NumericValue = Math.Round((decimal)liveMembers.Value / liveClubs.Value, 0, MidpointRounding.AwayFromZero);
                // RAG "Healthy Clubs" bands by active member count per club:
                // Red 10-25, Amber 26-40, Green 41+. Clubs with <10 members fall in no band.
                else if (f.FieldKey == "rag_red" && rag != null) f.NumericValue = rag.Value.Red;
                else if (f.FieldKey == "rag_amber" && rag != null) f.NumericValue = rag.Value.Amber;
                else if (f.FieldKey == "rag_green" && rag != null) f.NumericValue = rag.Value.Green;
                else if (f.FieldKey == "rag_super_green" && rag != null) f.NumericValue = rag.Value.SuperGreen;
                // Achieved shows the CURRENT TOTAL = "as on July 1st" baseline + gained this year.
                // (Percentage Achievement below still uses gained ÷ Target — baseline is subtracted there.)
                else if (f.FieldKey == "new_clubs_achieved" && newClubsAchieved != null) f.NumericValue = (liveClubs ?? 0) + newClubsAchieved;
                else if (f.FieldKey == "new_members_achieved" && newMembersAchieved != null) f.NumericValue = (liveMembers ?? 0) + newMembersAchieved;
                else if (f.FieldKey == "new_women_members_achieved" && newWomenAchieved != null) f.NumericValue = (liveWomen ?? 0) + newWomenAchieved;
            }
        }
        // NOTE: the Foundation "Reference"/imported figures are populated by the SuperAdmin Excel
        // import straight into goal_entries — they come back through the normal LEFT JOIN above.

        // TRF tab (District) — Total Giving (2026-09-16, user request; SUPERSEDES the 2026-09-09 "fully
        // manual" rule for these two boxes):
        //   Achieved            = Annual Fund + Polio Plus + Endowment + CSR  (their Achieved figures)
        //   Percentage Achieved = that sum ÷ Target for the Current year × 100 — the same formula the
        //                         other 4 funds use (NOT the 4 percentages added together).
        // 2026-10-06: both boxes are LOCKED - always worked out, never typed (a typed figure could
        // contradict the imported funds). Saves ignore them (SystemFilledFieldKeys) and any old typed
        // value is overridden here. Target and Highest are untouched: they stay imported/typed.
        {
            decimal FundAch(string key) => list.FirstOrDefault(f => f.FieldKey == key)?.NumericValue ?? 0m;
            var tgAchieved = list.FirstOrDefault(f => f.FieldKey == "total_giving_achieved");
            if (tgAchieved != null)
                tgAchieved.NumericValue = FundAch("annual_fund_achieved") + FundAch("polio_plus_achieved")
                                        + FundAch("endowment_achieved") + FundAch("csr_achieved");

            var tgPct = list.FirstOrDefault(f => f.FieldKey == "total_giving_pct");
            if (tgPct != null)
            {
                var tgTarget = list.FirstOrDefault(f => f.FieldKey == "total_contributions_target")?.NumericValue ?? 0m;
                var tgAch = tgAchieved?.NumericValue ?? 0m;
                tgPct.NumericValue = tgTarget > 0m
                    ? Math.Round(Math.Max(0m, Math.Min(100m, tgAch / tgTarget * 100m)), 2, MidpointRounding.AwayFromZero)
                    : 0m;
            }
        }

        // TRF tab (CLUB) — the "Total" group (2026-09-16, user request):
        //   Achieved            = AF Per Capita + Annual Fund YTD + PolioPlus Fund YTD
        //                         + Other Funds YTD + Endowment Fund YTD   (all FIVE — per-capita included)
        //   Percentage Achieved = that sum ÷ Total's Target for the Current year × 100
        // Both boxes stay EDITABLE (FieldRole 'Reference'), so only an EMPTY box is auto-filled and a
        // figure the club admin typed and saved is never overwritten.
        // NOTE: the displayed Total no longer comes from the MCR file's own "-- Total --" column
        // (McrClubColumns 11) — that import still writes the field, but our sum fills it when it's empty.
        {
            decimal ClubAch(string key) => list.FirstOrDefault(f => f.FieldKey == key)?.NumericValue ?? 0m;
            var clubTotal = list.FirstOrDefault(f => f.FieldKey == "club_total_ytd");
            if (clubTotal != null && clubTotal.NumericValue == null)
                clubTotal.NumericValue = ClubAch("club_af_per_capita") + ClubAch("club_annual_fund_ytd")
                                       + ClubAch("club_polioplus_ytd") + ClubAch("club_other_funds_ytd")
                                       + ClubAch("club_endowment_ytd");

            var clubTotalPct = list.FirstOrDefault(f => f.FieldKey == "club_total_pct");
            if (clubTotalPct != null && clubTotalPct.NumericValue == null)
            {
                var ctTarget = list.FirstOrDefault(f => f.FieldKey == "club_total_target")?.NumericValue ?? 0m;
                var ctAch = clubTotal?.NumericValue ?? 0m;
                clubTotalPct.NumericValue = ctTarget > 0m
                    ? Math.Round(Math.Max(0m, Math.Min(100m, ctAch / ctTarget * 100m)), 2, MidpointRounding.AwayFromZero)
                    : 0m;
            }
        }

        // Percentage Achievement = Achieved ÷ Target × 100, per group (Membership groups + every TRF fund).
        // Two operations (÷ and ×) exceed the single-op compute engine, so we derive them here from the
        // already-loaded/injected Target + Achieved values. Read-only; shown for every year. Target 0 → 0%.
        // (Pct field, Target field, Achieved field, Baseline field). Baseline is subtracted from Achieved
        // so the numerator is "gained this year" — Membership Achieved now shows baseline+gained, so we
        // strip the baseline back off here; TRF has no baseline ("").
        var pctMap = new (string Pct, string Target, string Achieved, string Baseline)[]
        {
            ("clubs_percentage_achievement",  "new_clubs",                  "new_clubs_achieved",          "total_clubs"),
            ("percentage_increase",           "new_members",                "new_members_achieved",        "total_members"),
            ("women_percentage_achievement",  "new_women_members",          "new_women_members_achieved",  "existing_women_members"),
            ("annual_fund_pct",               "annual_fund_target",         "annual_fund_achieved",        ""),
            ("polio_plus_pct",                "polio_plus_target",          "polio_plus_achieved",         ""),
            ("endowment_pct",                 "endowment_target",           "endowment_achieved",          ""),
            ("csr_pct",                       "csr_target",                 "csr_achieved",                ""),
            // total_giving_pct is intentionally NOT derived (2026-09-09) — Total Giving is manual now.
            ("club_af_per_capita_pct",        "club_af_per_capita_target",   "club_af_per_capita",         ""),
            ("club_annual_fund_ytd_pct",      "club_annual_fund_ytd_target", "club_annual_fund_ytd",       ""),
            ("club_polioplus_ytd_pct",        "club_polioplus_ytd_target",   "club_polioplus_ytd",         ""),
            ("club_other_funds_ytd_pct",      "club_other_funds_ytd_target", "club_other_funds_ytd",       ""),
            ("club_endowment_ytd_pct",        "club_endowment_ytd_target",   "club_endowment_ytd",         ""),
            // club_total_pct is NOT derived here any more (2026-09-16): it is auto-filled just above,
            // and only while the box is empty, so a club admin's own typed figure is never overwritten.
        };
        foreach (var (pctKey, tgtKey, achKey, baseKey) in pctMap)
        {
            var pctField = list.FirstOrDefault(f => f.FieldKey == pctKey);
            if (pctField == null) continue;
            var tgt = list.FirstOrDefault(f => f.FieldKey == tgtKey)?.NumericValue ?? 0m;
            var ach = list.FirstOrDefault(f => f.FieldKey == achKey)?.NumericValue ?? 0m;
            decimal pct;
            if (string.IsNullOrEmpty(baseKey))
            {
                // TRF/Foundation: no July-1st baseline (Achieved starts at 0) → % of the target amount raised.
                // 2 decimals, like the month-wise panel (user 2026-10-07: 3.35% there, 3% here).
                pct = tgt > 0m ? Math.Round(ach / tgt * 100m, 2, MidpointRounding.AwayFromZero) : 0m;
            }
            else
            {
                // Membership (Clubs / Members / Women): Achieved already INCLUDES the July-1st baseline, so
                // measure progress on the planned NEW additions only — otherwise 0 growth reads as ~96%.
                //   % = (Achieved − Baseline) ÷ (Target − Baseline) × 100, floored at 0 and capped at 100.
                //   e.g. baseline 104, target 108, achieved 104 → (0)/(4) = 0%; achieved 108 → 100%.
                var baseVal = list.FirstOrDefault(f => f.FieldKey == baseKey)?.NumericValue ?? 0m;
                var gained = ach - baseVal;      // clubs/members actually added this year
                var planned = tgt - baseVal;     // clubs/members the goal plans to add
                // Target 0 = "no target set" → 0% (nothing to measure, never 100%). Target = baseline
                // (0 planned growth, but a real target) → 100% once you're at/above it.
                pct = planned > 0m ? gained / planned * 100m : (tgt > 0m && ach >= tgt ? 100m : 0m);
                pct = Math.Round(Math.Max(0m, Math.Min(100m, pct)), 0, MidpointRounding.AwayFromZero);
            }
            pctField.NumericValue = pct;
        }

        // Youth Service (DISTRICT only): Percentage Achievement against the PLANNED NEW figure. Unlike
        // Membership, the Youth target field ("Proposed New …") is already just the additions, so only the
        // achieved side has the July-1st figure subtracted:
        //   % = (Achieved − Existing as on July 1st) ÷ Proposed New × 100, floored at 0, capped at 100.
        var youthPct = new (string Pct, string Achieved, string Existing, string Proposed)[]
        {
            ("rotaract_clubs_pct",   "rotaract_clubs_achieved",   "rotaract_existing_clubs",   "rotaract_new_clubs_target"),
            ("rotaract_members_pct", "rotaract_members_achieved", "rotaract_existing_members", "rotaract_new_members_target"),
            ("interact_clubs_pct",   "interact_clubs_achieved",   "interact_existing_clubs",   "interact_new_clubs_target"),
            ("rcc_clubs_pct",        "rcc_clubs_achieved",        "rcc_existing_clubs",        "rcc_new_clubs_target"),
        };
        foreach (var (pctKey, achKey, existKey, planKey) in youthPct)
        {
            var pctField = list.FirstOrDefault(f => f.FieldKey == pctKey);
            if (pctField == null) continue;
            var ach = list.FirstOrDefault(f => f.FieldKey == achKey)?.NumericValue ?? 0m;
            var exist = list.FirstOrDefault(f => f.FieldKey == existKey)?.NumericValue ?? 0m;
            var planned = list.FirstOrDefault(f => f.FieldKey == planKey)?.NumericValue ?? 0m;
            pctField.NumericValue = planned > 0m
                ? Math.Round(Math.Max(0m, Math.Min(100m, (ach - exist) / planned * 100m)), 0, MidpointRounding.AwayFromZero)
                : 0m;
        }

        // Membership Summary (all computed/injected — the compute engine can't subtract). These show what
        // has ACTUALLY been added from July 1st to date = Achieved − Baseline (Achieved already includes the
        // July-1st baseline). Floored at 0. The planned/target numbers live in each section's own rows.
        //   Total New Clubs             = Clubs Achieved − Clubs as on July 1st (new clubs added so far)
        //   Total Membership Net Growth = Members Achieved − Members as on July 1st (net growth so far)
        //   Total New women members     = Women Achieved − Existing Women Members as on July 1st (added so far)
        //   (Total Nos is hidden — see hiddenFieldKeys in DatabaseInitializer — so it isn't injected.)
        //   NOTE: field key "new_club_members_computed" is legacy — it now holds "Total New women members".
        // Any Summary row present — the club page has Net Growth + New women members but no Total New Clubs.
        if (list.Any(f => f.FieldKey is "total_new_clubs" or "total_membership_net_growth" or "new_club_members_computed"))
        {
            decimal V(string k) => list.FirstOrDefault(f => f.FieldKey == k)?.NumericValue ?? 0m;
            void Set(string k, decimal v) { var f = list.FirstOrDefault(x => x.FieldKey == k); if (f != null) f.NumericValue = v; }
            decimal newClubsAdded = Math.Max(0m, V("new_clubs_achieved") - V("total_clubs"));
            decimal membersAdded = Math.Max(0m, V("new_members_achieved") - V("total_members"));
            decimal womenAdded = Math.Max(0m, V("new_women_members_achieved") - V("existing_women_members"));
            Set("total_new_clubs", newClubsAdded);
            Set("total_membership_net_growth", membersAdded);
            Set("new_club_members_computed", womenAdded);
        }
        // Last, once every figure above is in place: the lowest value each target may be saved with.
        // Applies to District Membership from 2026-27 too (user 2026-10-09: the check must stay; low
        // targets were corrected once in the data - Clubs July 1st +10%, Members +3%).
        ApplyTargetFloors(list);
        return list;
    }

    // The official DISTRICT Foundation Excel is a TRANSPOSED MATRIX: fields are ROWS
    // (SrNo | Number1_Dont_change | Category | Input Type | <district numbers as columns 5+>),
    // one value per (field, district). We import the 10 "Number" metrics below into each field's
    // "_achieved" Reference goal_field; a row is matched by its exact Category name (which is unique
    // to the main Number row — the Yes/No sub-rows and DDF/EPF/Hall-of-Honor rows are ignored).
    // ExcelId = the file's "Number1_Dont_change" id, reproduced verbatim in the sample download.
    private static readonly (int SrNo, int ExcelId, string Category, string FieldKey)[] FoundationImportRows =
    {
        (1, 47, "Annual Fund",                 "annual_fund_achieved"),
        (2, 47, "Annual Fund_Target",          "annual_fund_target"),
        (3, 46, "Polio Plus Society",          "polio_plus_achieved"),
        (4, 46, "Polio Plus Society_Target",   "polio_plus_target"),
        (5, 41, "Endowment",                   "endowment_achieved"),
        (6, 41, "Endowment_Target",            "endowment_target"),
        (7, 52, "CSR project with RFI",        "csr_achieved"),
        (8, 52, "CSR project with RFI_Target", "csr_target"),
    };
    private static readonly string[] FoundationImportFieldKeys =
        FoundationImportRows.Select(r => r.FieldKey).ToArray();

    // FULL official district Foundation template (every row of the ROW sheet, in order) — used to
    // build the sample download so its structure EXACTLY matches what the district uploads. Import
    // still only reads the 10 main "Number" metrics above (matched by Category name); the Yes/No and
    // DDF/EPF/Hall-of-Honor sub-rows are part of the format but ignored on import. IsNumber tells the
    // sample which cells get a 0 baseline (Number) vs. left blank (Yes/No).
    private static readonly (int SrNo, int ExcelId, string Category, string InputType)[] FoundationSampleRows =
    {
        (1, 47, "Annual Fund",                 "Number"),
        (2, 47, "Annual Fund_Target",          "Number"),
        (3, 46, "Polio Plus Society",          "Number"),
        (4, 46, "Polio Plus Society_Target",   "Number"),
        (5, 41, "Endowment",                   "Number"),
        (6, 41, "Endowment_Target",            "Number"),
        (7, 52, "CSR project with RFI",        "Number"),
        (8, 52, "CSR project with RFI_Target", "Number"),
    };
    // Category name (normalised) → field key, for matching each Excel field row.
    private static readonly Dictionary<string, string> FoundationCategoryToKey =
        FoundationImportRows.ToDictionary(
            r => r.Category.Trim().ToLowerInvariant(), r => r.FieldKey);

    // ── Live baseline counts (for read-only reference auto-fill) ────────────
    // "Total No of Clubs as of 1 July" — clubs chartered BEFORE the viewed Rotary year's start
    // (1 July). @AsOf = the year StartDate; when null (no date), counts all (unbounded fallback).
    // NULL charter date → treated as pre-existing (counted in the baseline).
    // CLUB counts include synced AND non-synced clubs so they match Rotary.org (user 2026-09-28: D3142
    // showed 104 against Rotary.org's 107). Member counts below stay synced-only.
    private static async Task<int> LiveDistrictClubCountAsync(MySqlConnection conn, int districtId, DateTime? asOf)
    {
        if (districtId <= 0) return 0;
        return await conn.ExecuteScalarAsync<int>(
            @"SELECT COUNT(*) FROM club_master
              WHERE fk_district_id = @Id AND IsActive = 1 AND isdeleted = 0
                AND (@AsOf IS NULL OR ClubCharterDate IS NULL OR ClubCharterDate < @AsOf)",
            new { Id = districtId, AsOf = asOf });
    }

    // Honorary members are never counted as part of "Total Members" (business rule
    // 2026-08-25) — an honorary member is not an active member of the club. Applies to
    // every live count below (total, women, RAG bands, new-this-year achieved).
    // "Total Membership (Existing) as of 1 July" — members who JOINED before the viewed year's start
    // (1 July). @AsOf = the year StartDate; null → unbounded. NULL JoinedDate → counted as existing.
    private static async Task<int> LiveDistrictMemberCountAsync(MySqlConnection conn, int districtId, DateTime? asOf)
    {
        if (districtId <= 0) return 0;
        return await conn.ExecuteScalarAsync<int>(
            @"SELECT COUNT(DISTINCT m.pk_member_master_profile_id)
              FROM club_members cm
              JOIN club_master c ON c.pk_club_id = cm.fk_club_id
              JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
              WHERE c.fk_district_id = @Id
                AND cm.IsActive = 1 AND cm.isdeleted = 0 AND cm.IsHonoraryMember = 0
                AND c.IsActive = 1 AND c.isdeleted = 0
                AND c.IsSyncedFromRotaryOrg = 1
                AND m.isdeleted = 0
                AND (@AsOf IS NULL OR cm.JoinedDate IS NULL OR cm.JoinedDate < @AsOf)",
            new { Id = districtId, AsOf = asOf });
    }

    private static async Task<int> LiveClubMemberCountAsync(MySqlConnection conn, int clubId, DateTime? asOf)
    {
        if (clubId <= 0) return 0;
        return await conn.ExecuteScalarAsync<int>(
            @"SELECT COUNT(DISTINCT m.pk_member_master_profile_id)
              FROM club_members cm
              JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
              WHERE cm.fk_club_id = @Id
                AND cm.IsActive = 1 AND cm.isdeleted = 0 AND cm.IsHonoraryMember = 0
                AND m.isdeleted = 0
                AND (@AsOf IS NULL OR cm.JoinedDate IS NULL OR cm.JoinedDate < @AsOf)",
            new { Id = clubId, AsOf = asOf });
    }

    // Existing Women Members baseline — active members with Gender = 'Female' (the codebase-wide
    // convention). District = synced clubs only (matches the club/member count rule); club = its roster.
    // "Existing Women Members as of 1 July" — women (Gender='Female') who JOINED before the viewed
    // year's start (1 July). @AsOf = the year StartDate; null → unbounded. NULL JoinedDate → existing.
    private static async Task<int> LiveDistrictWomenCountAsync(MySqlConnection conn, int districtId, DateTime? asOf)
    {
        if (districtId <= 0) return 0;
        return await conn.ExecuteScalarAsync<int>(
            @"SELECT COUNT(DISTINCT m.pk_member_master_profile_id)
              FROM club_members cm
              JOIN club_master c ON c.pk_club_id = cm.fk_club_id
              JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
              WHERE c.fk_district_id = @Id
                AND cm.IsActive = 1 AND cm.isdeleted = 0 AND cm.IsHonoraryMember = 0
                AND c.IsActive = 1 AND c.isdeleted = 0
                AND c.IsSyncedFromRotaryOrg = 1
                AND m.isdeleted = 0 AND m.Gender = 'Female'
                AND (@AsOf IS NULL OR cm.JoinedDate IS NULL OR cm.JoinedDate < @AsOf)",
            new { Id = districtId, AsOf = asOf });
    }

    private static async Task<int> LiveClubWomenCountAsync(MySqlConnection conn, int clubId, DateTime? asOf)
    {
        if (clubId <= 0) return 0;
        return await conn.ExecuteScalarAsync<int>(
            @"SELECT COUNT(DISTINCT m.pk_member_master_profile_id)
              FROM club_members cm
              JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
              WHERE cm.fk_club_id = @Id
                AND cm.IsActive = 1 AND cm.isdeleted = 0 AND cm.IsHonoraryMember = 0
                AND m.isdeleted = 0 AND m.Gender = 'Female'
                AND (@AsOf IS NULL OR cm.JoinedDate IS NULL OR cm.JoinedDate < @AsOf)",
            new { Id = clubId, AsOf = asOf });
    }

    // ── "Achieved this year" progress vs target ────────────────────────────
    // New clubs chartered in the district within the viewed Rotary year — synced AND non-synced clubs
    // (user 2026-09-28: a new club is usually not synced yet, so synced-only never counted it).
    private static async Task<int> AchievedNewClubsDistrictAsync(MySqlConnection conn, int districtId, DateTime start, DateTime end)
    {
        if (districtId <= 0) return 0;
        return await conn.ExecuteScalarAsync<int>(
            @"SELECT COUNT(*) FROM club_master
              WHERE fk_district_id = @Id AND IsActive = 1 AND isdeleted = 0
                AND ClubCharterDate IS NOT NULL
                AND ClubCharterDate >= @S AND ClubCharterDate <= @E",
            new { Id = districtId, S = start, E = end });
    }

    // Women (Gender='Female') who JOINED within the viewed Rotary year — district (synced clubs).
    private static async Task<int> AchievedNewWomenDistrictAsync(MySqlConnection conn, int districtId, DateTime start, DateTime end)
    {
        if (districtId <= 0) return 0;
        return await conn.ExecuteScalarAsync<int>(
            @"SELECT COUNT(DISTINCT m.pk_member_master_profile_id)
              FROM club_members cm
              JOIN club_master c ON c.pk_club_id = cm.fk_club_id
              JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
              WHERE c.fk_district_id = @Id
                AND cm.IsActive = 1 AND cm.isdeleted = 0 AND cm.IsHonoraryMember = 0
                AND c.IsActive = 1 AND c.isdeleted = 0
                AND c.IsSyncedFromRotaryOrg = 1
                AND m.isdeleted = 0 AND m.Gender = 'Female'
                AND cm.JoinedDate IS NOT NULL
                AND cm.JoinedDate >= @S AND cm.JoinedDate <= @E",
            new { Id = districtId, S = start, E = end });
    }

    // Women who JOINED within the viewed Rotary year — a single club's own roster.
    private static async Task<int> AchievedNewWomenClubAsync(MySqlConnection conn, int clubId, DateTime start, DateTime end)
    {
        if (clubId <= 0) return 0;
        return await conn.ExecuteScalarAsync<int>(
            @"SELECT COUNT(DISTINCT m.pk_member_master_profile_id)
              FROM club_members cm
              JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
              WHERE cm.fk_club_id = @Id
                AND cm.IsActive = 1 AND cm.isdeleted = 0 AND cm.IsHonoraryMember = 0
                AND m.isdeleted = 0 AND m.Gender = 'Female'
                AND cm.JoinedDate IS NOT NULL
                AND cm.JoinedDate >= @S AND cm.JoinedDate <= @E",
            new { Id = clubId, S = start, E = end });
    }

    // Members (any gender) who JOINED within the viewed Rotary year — district (synced clubs).
    private static async Task<int> AchievedNewMembersDistrictAsync(MySqlConnection conn, int districtId, DateTime start, DateTime end)
    {
        if (districtId <= 0) return 0;
        return await conn.ExecuteScalarAsync<int>(
            @"SELECT COUNT(DISTINCT m.pk_member_master_profile_id)
              FROM club_members cm
              JOIN club_master c ON c.pk_club_id = cm.fk_club_id
              JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
              WHERE c.fk_district_id = @Id
                AND cm.IsActive = 1 AND cm.isdeleted = 0 AND cm.IsHonoraryMember = 0
                AND c.IsActive = 1 AND c.isdeleted = 0
                AND c.IsSyncedFromRotaryOrg = 1
                AND m.isdeleted = 0
                AND cm.JoinedDate IS NOT NULL
                AND cm.JoinedDate >= @S AND cm.JoinedDate <= @E",
            new { Id = districtId, S = start, E = end });
    }

    // Members (any gender) who JOINED within the viewed Rotary year — a single club's own roster.
    private static async Task<int> AchievedNewMembersClubAsync(MySqlConnection conn, int clubId, DateTime start, DateTime end)
    {
        if (clubId <= 0) return 0;
        return await conn.ExecuteScalarAsync<int>(
            @"SELECT COUNT(DISTINCT m.pk_member_master_profile_id)
              FROM club_members cm
              JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
              WHERE cm.fk_club_id = @Id
                AND cm.IsActive = 1 AND cm.isdeleted = 0 AND cm.IsHonoraryMember = 0
                AND m.isdeleted = 0
                AND cm.JoinedDate IS NOT NULL
                AND cm.JoinedDate >= @S AND cm.JoinedDate <= @E",
            new { Id = clubId, S = start, E = end });
    }

    // RAG "Healthy Clubs" counts: classify each club in the district by
    // its active member count — Red 10-25, Amber 26-40, Green 41-50, Super Green 51+. Clubs with
    // <10 active members fall in no band and are not counted (matches the Healthy-Clubs definition).
    private static async Task<(int Red, int Amber, int Green, int SuperGreen)> LiveDistrictRagCountsAsync(MySqlConnection conn, int districtId)
    {
        if (districtId <= 0) return (0, 0, 0, 0);
        var row = await conn.QueryFirstOrDefaultAsync<dynamic>(
            @"SELECT
                  COALESCE(SUM(mc BETWEEN 10 AND 25), 0) AS Red,
                  COALESCE(SUM(mc BETWEEN 26 AND 40), 0) AS Amber,
                  -- GREEN is 41+ (was 41-50): the 'Super Green 51+' field was retired, so every club
                  -- with 51+ members was counted into a band nobody can see — D3142 showed GREEN 10
                  -- instead of 31, with 21 clubs missing from the three bands altogether.
                  COALESCE(SUM(mc >= 41), 0)             AS Green,
                  COALESCE(SUM(mc >= 51), 0)             AS SuperGreen
              FROM (
                  SELECT COUNT(DISTINCT m.pk_member_master_profile_id) AS mc
                  FROM club_master c
                  JOIN club_members cm ON cm.fk_club_id = c.pk_club_id
                       AND cm.IsActive = 1 AND cm.isdeleted = 0 AND cm.IsHonoraryMember = 0
                  JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                       AND m.isdeleted = 0
                  WHERE c.fk_district_id = @Id AND c.IsActive = 1 AND c.isdeleted = 0
                        AND c.IsSyncedFromRotaryOrg = 1
                  GROUP BY c.pk_club_id
              ) t",
            new { Id = districtId });
        if (row == null) return (0, 0, 0, 0);
        return (Convert.ToInt32(row.Red), Convert.ToInt32(row.Amber), Convert.ToInt32(row.Green), Convert.ToInt32(row.SuperGreen));
    }

    // Server-side upsert of entries. Fields whose FieldRole = 'Computed' are silently
    // skipped from the client payload (never trust a client-submitted computed value) —
    // computed fields are recalculated here from the entries just saved.
    // Fields a club/district admin can NOT set through a goal form save (2026-10-06): the API side of
    // SYSTEM_FILLED_REFERENCE in GoalSettingPanel.tsx - keep the two lists the same.
    //   Membership - injected live from member/club counts.
    //   Foundation (district) - Achieved comes from the SuperAdmin imports / the club roll-up; Total
    //     Giving Achieved = the four funds and its % is worked out from it (both locked since 2026-10-06).
    //   Foundation (club) - the contribution figures come from the Rotary.org MCR import.
    // Targets (and the club's Goal Amount / Goal % Achieved) stay editable.
    private static readonly HashSet<string> SystemFilledFieldKeys = new(StringComparer.Ordinal)
    {
        "total_clubs", "new_clubs_achieved", "total_members", "new_members_achieved",
        "existing_women_members", "new_women_members_achieved",
        "rag_red", "rag_amber", "rag_green", "rag_super_green",
        "aks_achieved", "endowment_achieved", "bequest_achieved", "directed_gift_achieved",
        "polio_plus_achieved", "annual_fund_achieved", "phf_achieved", "phsm_achieved",
        "major_donors_achieved", "csr_achieved", "total_giving_achieved", "total_giving_pct",
        "club_af_per_capita", "club_annual_fund_ytd", "club_polioplus_ytd",
        "club_other_funds_ytd", "club_endowment_ytd", "club_total_ytd",
        // Youth Service -> Rotaract "Clubs Achieved" comes from the Rotaract file import (2026-10-08).
        "rotaract_clubs_achieved", "interact_clubs_achieved",
    };

    // Locked on the DISTRICT form only - the club Youth Service form still types its own (2026-10-08):
    // the district's "Existing Rotaract / Interact Clubs as on July 1st" come from the Rotary.org files.
    // Rotaractors (July 1st + Achieved) too, from the same Rotaract file (user 2026-10-09).
    private static readonly HashSet<string> DistrictSystemFilledFieldKeys = new(StringComparer.Ordinal)
        { "rotaract_existing_clubs", "interact_existing_clubs", "rotaract_existing_members", "rotaract_members_achieved" };

    // Month-wise Foundation figures come from the imports only; admins cannot type them.
    private static readonly HashSet<string> ImportedMonthlyFieldKeys = new(StringComparer.Ordinal)
    {
        "annual_fund_achieved", "polio_plus_achieved", "endowment_achieved", "csr_achieved",
        "club_af_per_capita", "club_annual_fund_ytd", "club_polioplus_ytd", "club_other_funds_ytd", "club_endowment_ytd",
    };

    private async Task SaveEntriesAsync(
        MySqlConnection conn, int categoryId, int yearId, string entityType, int clubId, int districtId,
        List<GoalEntrySaveDto> entries, int memberId)
    {
        var fieldDefs = (await conn.QueryAsync<dynamic>(@"
            SELECT pk_field_id AS id, DataType AS dataType, FieldRole AS role, FieldKey AS fieldKey,
                   ComputeExpression AS compute, AppliesTo AS appliesTo
            FROM goal_fields WHERE fk_category_id = @CategoryId AND isdeleted = 0",
            new { CategoryId = categoryId }))
            .ToDictionary(f => (int)f.id, f => f);

        foreach (var entry in entries)
        {
            if (!fieldDefs.TryGetValue(entry.FieldId, out var def)) continue;
            if ((string)def.role == "Computed") continue; // recomputed below, never trusted from client
            // Imported / system-filled figures are never taken from a form save (web or mobile) -
            // the same list the web form shows read-only. They only change through the imports.
            if (SystemFilledFieldKeys.Contains((string)def.fieldKey)) continue;
            if (entityType == "District" && DistrictSystemFilledFieldKeys.Contains((string)def.fieldKey)) continue;

            await conn.ExecuteAsync(@"
                INSERT INTO goal_entries (fk_field_id, fk_year_id, EntityType, fk_club_id, fk_district_id,
                                           NumericValue, TextValue, BoolValue, created_by, created_date, isdeleted)
                VALUES (@FieldId, @YearId, @EntityType, @ClubId, @DistrictId,
                        @NumericValue, @TextValue, @BoolValue, @MemberId, NOW(), 0)
                ON DUPLICATE KEY UPDATE
                    NumericValue = @NumericValue, TextValue = @TextValue, BoolValue = @BoolValue,
                    modified_by = @MemberId, modified_date = NOW()",
                new
                {
                    FieldId = entry.FieldId, YearId = yearId, EntityType = entityType, ClubId = clubId, DistrictId = districtId,
                    entry.NumericValue, entry.TextValue, BoolValue = entry.BoolValue.HasValue ? (entry.BoolValue.Value ? 1 : 0) : (int?)null,
                    MemberId = memberId,
                });
        }

        // Recompute every Computed field in this category from a simple "sum of named
        // fields" expression (ComputeExpression uses '+'/'*' against sibling FieldKeys —
        // see the seed data in DatabaseInitializer.cs for the exact expressions in use).
        var currentValues = (await conn.QueryAsync<dynamic>(@"
            SELECT f.FieldKey AS fieldKey, e.NumericValue AS val
            FROM goal_fields f
            LEFT JOIN goal_entries e ON e.fk_field_id = f.pk_field_id AND e.fk_year_id = @YearId
                AND e.EntityType = @EntityType AND e.fk_club_id = @ClubId AND e.fk_district_id = @DistrictId AND e.isdeleted = 0
            WHERE f.fk_category_id = @CategoryId AND f.isdeleted = 0",
            new { CategoryId = categoryId, YearId = yearId, EntityType = entityType, ClubId = clubId, DistrictId = districtId }))
            .ToDictionary(
                r => (string)r.fieldKey,
                r => { object? v = r.val; return v is null ? 0m : Convert.ToDecimal(v); });

        // Only recompute computed fields that apply to THIS entity level — otherwise a
        // club save would write district-only computed rows (and vice-versa).
        foreach (var f in fieldDefs.Values.Where(f => (string)f.role == "Computed" && f.compute != null
                     && ((string)f.appliesTo == "Both" || (string)f.appliesTo == entityType)))
        {
            var expr = (string)f.compute;
            decimal result = EvaluateSimpleExpression(expr, currentValues);
            await conn.ExecuteAsync(@"
                INSERT INTO goal_entries (fk_field_id, fk_year_id, EntityType, fk_club_id, fk_district_id,
                                           NumericValue, created_by, created_date, isdeleted)
                VALUES (@FieldId, @YearId, @EntityType, @ClubId, @DistrictId, @Value, @MemberId, NOW(), 0)
                ON DUPLICATE KEY UPDATE NumericValue = @Value, modified_by = @MemberId, modified_date = NOW()",
                new { FieldId = (int)f.id, YearId = yearId, EntityType = entityType, ClubId = clubId, DistrictId = districtId, Value = result, MemberId = memberId });
        }
    }

    // Deliberately tiny: every ComputeExpression in the seed data is either
    // "a / b", "a * <literal>", or "a + b [+ c]" against sibling FieldKeys — no need for a
    // general expression engine for a fixed, known set of ~5 computed fields.
    private static decimal EvaluateSimpleExpression(string expr, Dictionary<string, decimal> values)
    {
        decimal Resolve(string token)
        {
            token = token.Trim();
            if (decimal.TryParse(token, out var lit)) return lit;
            return values.TryGetValue(token, out var v) ? v : 0m;
        }

        if (expr.Contains('/'))
        {
            var parts = expr.Split('/');
            var denom = Resolve(parts[1]);
            return denom == 0 ? 0 : Math.Round(Resolve(parts[0]) / denom, 0, MidpointRounding.AwayFromZero);
        }
        if (expr.Contains('*'))
        {
            var parts = expr.Split('*');
            return Resolve(parts[0]) * Resolve(parts[1]);
        }
        if (expr.Contains('+'))
        {
            return expr.Split('+').Sum(Resolve);
        }
        return Resolve(expr);
    }

    private static async Task<string> GetCategoryNameAsync(MySqlConnection conn, int categoryId)
        => await conn.ExecuteScalarAsync<string>(
            "SELECT IF(Name = 'TRF', 'Foundation', Name) FROM goal_categories WHERE pk_category_id = @Id AND isdeleted = 0",
            new { Id = categoryId }) ?? "";

    // ── Quarterly / month-wise TARGETS (user 2026-09-25) ────────────────────────────────────────
    // The YEARLY target is never touched by any of this: it stays the single figure the club types,
    // in goal_entries. What is stored here is that year SPLIT across the 12 months. A quarter is
    // never stored - it is the sum of its three months - so month, quarter and year cannot disagree.
    //
    // Rotary year runs July→June, so the quarters are Jul-Sep, Oct-Dec, Jan-Mar, Apr-Jun.
    private static int QuarterOfMonth(int month) => month switch
    {
        7 or 8 or 9 => 1,
        10 or 11 or 12 => 2,
        1 or 2 or 3 => 3,
        _ => 4,
    };

    private static readonly int[][] QuarterMonths =
    {
        new[] { 7, 8, 9 }, new[] { 10, 11, 12 }, new[] { 1, 2, 3 }, new[] { 4, 5, 6 },
    };

    // Spread a total over N slots, LAST slot absorbing the remainder so the sum is always exact:
    // 12 over 4 → 3,3,3,3 · 10 over 4 → 2,2,2,4 · 100 over 12 → 8×11 then 12.
    //
    // `whole` matters: a count like "New Members" must never be split into 3.33 of a member, so for
    // an Integer metric the slots are whole numbers and the last one takes the rest (1 across a
    // quarter's 3 months → 0, 0, 1). Money (TRF) keeps its paise.
    //
    // This is only the SUGGESTION the screen opens with. The admin may then type any numbers at all -
    // 0, 1, 10, 1 is perfectly valid - and they are saved exactly as typed. The one rule enforced on
    // Save is that they add up to the yearly target.
    // Goal Setting shows WHOLE numbers only - yearly, quarterly and month-wise alike, on every
    // screen, in every report and for every login (user 2026-09-29). TRF was the visible offender:
    // its fields are Currency, so 10,000 / 12 came out as 833.33 x 11 + 833.37. Rounding here, at
    // the point the numbers are produced, means no consumer can show a decimal - screens, Excel
    // and the mobile API all read these same DTOs.
    private static decimal Whole(decimal v) => Math.Round(v, 0, MidpointRounding.AwayFromZero);
    private static decimal? Whole(decimal? v) => v.HasValue ? Whole(v.Value) : (decimal?)null;

    private static List<decimal> SpreadTarget(decimal total, int slots, bool whole = false)
    {
        var outv = new List<decimal>(slots);
        if (slots <= 0) return outv;
        // `whole` is now always true in practice (see Whole above) - the parameter stays so the
        // intent is readable at the call sites.
        decimal each = Math.Truncate(total / slots);                 // never rounds UP past the total
        decimal used = 0m;
        for (int i = 0; i < slots - 1; i++) { outv.Add(each); used += each; }
        outv.Add(total - used);                                      // the last slot takes what is left
        return outv;
    }

    // A metric counted in whole units (members, clubs, activities) as opposed to money.
    // Everything is a whole number now, money included: a TRF target of $10,000 splits into 12
    // months of 833 and a last one of 837, never 833.33 (user 2026-09-29).
    private static bool IsWholeNumberMetric(string? dataType) => true;

    // Fill a field's MonthlyTargets / QuarterlyTargets. When nothing has been saved yet the split is
    // SUGGESTED from the yearly target (TargetsAreSuggested = true) - shown to the user, not stored,
    // until they press Save.
    // Every figure a month-wise surface can print, rounded in one pass: the monthly collections,
    // the yearly target beside them, the July-1st baseline, the 12 monthly targets and the 4
    // quarterly ones, and both totals. A saved split is already whole; an OLD one saved before
    // 2026-09-29 may carry decimals, and this rounds it for display without touching the row.
    private static void RoundToWhole(GoalMonthlyFieldDto f)
    {
        foreach (var m in f.Monthly.Keys.ToList()) f.Monthly[m] = Whole(f.Monthly[m]);
        foreach (var m in f.MonthlyTargets.Keys.ToList()) f.MonthlyTargets[m] = Whole(f.MonthlyTargets[m]);
        foreach (var q in f.QuarterlyTargets.Keys.ToList()) f.QuarterlyTargets[q] = Whole(f.QuarterlyTargets[q]);
        foreach (var q in f.QuarterlyAchieved.Keys.ToList()) f.QuarterlyAchieved[q] = Whole(f.QuarterlyAchieved[q]);
        f.AnnualTarget = Whole(f.AnnualTarget);
        f.Baseline = Whole(f.Baseline);
        f.SplitBase = Whole(f.SplitBase);
        f.Total = Whole(f.Total);
        f.TargetTotal = Whole(f.TargetTotal);
    }

    private static void ApplyTargetSplit(
        GoalMonthlyFieldDto dto, List<GoalMonthPeriodDto> months, Dictionary<int, decimal?>? saved)
    {
        var monthOrder = months.Select(m => m.Month).ToList();
        bool anySaved = saved != null && saved.Values.Any(v => v.HasValue);

        // What the split must total. A Membership metric carries a July-1st baseline and its target is
        // the YEAR-END total, so the thing to spread is the GROWTH: 104 clubs today, 108 wanted → 4 to
        // add, not 108. TRF starts from zero, so there the target itself is the growth.
        dto.SplitBase = dto.AnnualTarget.HasValue
            ? (dto.Baseline.HasValue ? dto.AnnualTarget.Value - dto.Baseline.Value : dto.AnnualTarget.Value)
            : (decimal?)null;

        if (!anySaved && dto.SplitBase is > 0m && monthOrder.Count > 0)
        {
            var spread = SpreadTarget(dto.SplitBase.Value, monthOrder.Count, IsWholeNumberMetric(dto.DataType));
            for (int i = 0; i < monthOrder.Count; i++) dto.MonthlyTargets[monthOrder[i]] = spread[i];
            dto.TargetsAreSuggested = true;
        }
        else
        {
            foreach (var m in monthOrder)
                dto.MonthlyTargets[m] = saved != null && saved.TryGetValue(m, out var v) ? v : null;
        }

        dto.TargetTotal = dto.MonthlyTargets.Values.Sum(v => v ?? 0m);

        for (int q = 1; q <= 4; q++)
        {
            decimal? qt = null, qa = null;
            foreach (var m in QuarterMonths[q - 1])
            {
                if (dto.MonthlyTargets.TryGetValue(m, out var t) && t.HasValue) qt = (qt ?? 0m) + t.Value;
                if (dto.Monthly.TryGetValue(m, out var a) && a.HasValue) qa = (qa ?? 0m) + a.Value;
            }
            dto.QuarterlyTargets[q] = qt;
            dto.QuarterlyAchieved[q] = qa;
        }
    }

    // ── Annual-only categories (user 2026-09-25) ────────────────────────────────────────────────
    // Youth Service and Public Image have NO month-wise concept. They keep everything else exactly
    // as it is — the forms, the Till Date figures, the Till Date report columns — but they never
    // appear in a month-wise tab, a month-wise column or a Month-wise report sheet. Open Month-wise
    // anywhere and only Membership and TRF are there.
    //
    // The gate is on the SURFACES, not on MonthlyCollectedToTarget: the Till Date rows are built
    // from the month-wise form (ComputeCategoryMetricsAsync reads BuildMonthlyFormAsync's fields),
    // so emptying that map would delete these two categories from the annual reports as well.
    private static readonly HashSet<string> AnnualOnlyCategories = new(StringComparer.OrdinalIgnoreCase)
    {
        "Youth Service", "Public Image",
    };

    private static bool IsAnnualOnlyCategory(string? categoryName)
        => !string.IsNullOrWhiteSpace(categoryName) && AnnualOnlyCategories.Contains(categoryName!);

    private static async Task<bool> IsAnnualOnlyCategoryAsync(MySqlConnection conn, int categoryId)
        => categoryId > 0 && IsAnnualOnlyCategory(await GetCategoryNameAsync(conn, categoryId));

    // ── Club goal form ───────────────────────────────────────────────────
    public async Task<GoalCategoryFormDto?> GetClubGoalFormAsync(int memberId, int categoryId, int? yearId, int? requestedClubId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var clubId = await ResolveClubIdAsync(conn, memberId, requestedClubId);
        if (clubId == 0) return null;

        var (resolvedYearId, yearLabel, isEditable) = await ResolveYearAsync(conn, yearId);
        if (resolvedYearId == 0) return null;

        var clubName = await conn.ExecuteScalarAsync<string>(
            "SELECT ClubName FROM club_master WHERE pk_club_id = @Id AND isdeleted = 0", new { Id = clubId }) ?? "";
        var categoryName = await GetCategoryNameAsync(conn, categoryId);
        var fields = await LoadFieldsWithValuesAsync(conn, categoryId, resolvedYearId, "Club", clubId, 0, autoFillLive: isEditable);

        return new GoalCategoryFormDto
        {
            CategoryId = categoryId, CategoryName = categoryName, EntityType = "Club", ClubId = clubId,
            EntityName = clubName, YearId = resolvedYearId, YearLabel = yearLabel,
            IsEditable = isEditable,
            AchievedAsOn = await AchievedAsOnAsync(conn, categoryId, resolvedYearId, "Club", clubId, 0),
            Fields = fields,
        };
    }

    public async Task<GoalCategoryFormDto> SaveClubGoalFormAsync(int memberId, int categoryId, SaveGoalEntriesRequest request, int? requestedClubId)
    {
        if (request.YearId <= 0) throw new InvalidOperationException("yearId required");
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var clubId = await ResolveClubIdAsync(conn, memberId, requestedClubId);
        if (clubId == 0) throw new UnauthorizedAccessException("No club admin assignment found.");

        var (_, _, isEditable) = await ResolveYearAsync(conn, request.YearId);
        if (!isEditable) throw new InvalidOperationException("Past years are read-only and cannot be edited.");

        await ValidateTargetsVsBaselineAsync(conn, categoryId, request.YearId, "Club", clubId, 0, request.Entries);
        await SaveEntriesAsync(conn, categoryId, request.YearId, "Club", clubId, 0, request.Entries, memberId);
        // Also snapshot the current month's collected values into the month-wise table (additive).
        await SnapshotCurrentMonthAsync(conn, categoryId, request.YearId, "Club", clubId, 0, memberId);
        return (await GetClubGoalFormAsync(memberId, categoryId, request.YearId, clubId))!;
    }

    // ── District's own goal form ─────────────────────────────────────────
    // "One category's fields for one district" for the District Admin's own-goal form.
    private async Task<GoalCategoryFormDto> BuildDistrictFormDtoAsync(
        MySqlConnection conn, int categoryId, int districtId, int yearId, string yearLabel, bool yearIsEditable)
    {
        var districtName = await conn.ExecuteScalarAsync<string>(
            "SELECT DistrictNumber FROM district_master WHERE pk_district_id = @Id AND isdeleted = 0", new { Id = districtId }) ?? "";
        var categoryName = await GetCategoryNameAsync(conn, categoryId);
        var fields = await LoadFieldsWithValuesAsync(conn, categoryId, yearId, "District", 0, districtId, autoFillLive: yearIsEditable);

        return new GoalCategoryFormDto
        {
            CategoryId = categoryId, CategoryName = categoryName, EntityType = "District", DistrictId = districtId,
            EntityName = $"District {districtName}", YearId = yearId, YearLabel = yearLabel,
            IsEditable = yearIsEditable,
            AchievedAsOn = await AchievedAsOnAsync(conn, categoryId, yearId, "District", 0, districtId),
            Fields = fields,
        };
    }

    public async Task<GoalCategoryFormDto?> GetDistrictGoalFormAsync(int memberId, int categoryId, int? yearId, int? requestedDistrictId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var districtId = await ResolveDistrictIdAsync(conn, memberId, requestedDistrictId);
        if (districtId == 0) return null;

        var (resolvedYearId, yearLabel, isEditable) = await ResolveYearAsync(conn, yearId);
        if (resolvedYearId == 0) return null;

        return await BuildDistrictFormDtoAsync(conn, categoryId, districtId, resolvedYearId, yearLabel, isEditable);
    }

    // ── The target floor (user 2026-09-29) ──────────────────────────────────────────────────────
    // "Target for the Current year" is a YEAR-END TOTAL, so it can never be set below what the club
    // or district ALREADY has. The floor is the highest existing figure of the same metric:
    //   · the "... as on July 1st" figure (where the year started), and
    //   · "Achieved" (members gained / money raised so far - always the higher one once the year runs).
    // ZERO is refused by the same rule, not as a special case: a target of 0 against 60 existing
    // members is a plan to close the club. Only where the metric has NO existing figure does 0 stay
    // legal - Youth Service "Proposed New Rotaract Clubs" etc. are ADDITIONS on top of what exists,
    // and every Public Image activity count starts from nothing. A BLANK target is still allowed:
    // that means "not decided yet", while 0 is an explicit promise to shrink.
    private const string CurrentYearTargetLabel = "Target for the Current year";

    // The existing-figure fields: the July 1st baseline and the live "Achieved" total. TRF's "Highest"
    // is deliberately NOT one of them - that is a historical best, not what the district holds today.
    // User 2026-10-09: the floor is the "as on July 1st" figure ONLY - "Achieved" no longer raises it.
    private static bool IsExistingFigure(GoalFieldWithValueDto f) =>
        f.FieldRole == "Reference" &&
        f.FieldLabel.Contains("as on July 1st", StringComparison.OrdinalIgnoreCase);

    // The lowest legal value for one field, with the figure it came from (for the message).
    // 0 for anything that is not a current-year target, and for targets whose metric has no
    // existing figure to fall below.
    private static (decimal Floor, string? FromLabel) TargetFloor(List<GoalFieldWithValueDto> fields, GoalFieldWithValueDto target)
    {
        if (target.FieldRole != "Target"
            || !target.FieldLabel.Trim().Equals(CurrentYearTargetLabel, StringComparison.OrdinalIgnoreCase))
            return (0m, null);

        decimal floor = 0m; string? from = null;
        foreach (var f in fields)
            if (f.GroupName == target.GroupName && IsExistingFigure(f) && f.NumericValue is > 0m && f.NumericValue.Value > floor)
            {
                floor = f.NumericValue.Value;
                from = f.FieldLabel.Trim().Equals("Achieved", StringComparison.OrdinalIgnoreCase)
                    ? "already achieved this year" : "as on July 1st";
            }
        return (floor, from);
    }

    // Stamp every field with its floor so the browser can block the same values the API refuses
    // (one rule, two places - the UI can never drift from the server).
    private static void ApplyTargetFloors(List<GoalFieldWithValueDto> fields)
    {
        foreach (var f in fields)
        {
            var (floor, _) = TargetFloor(fields, f);
            f.MinValue = floor > 0m ? floor : null;
        }
    }

    private async Task ValidateTargetsVsBaselineAsync(MySqlConnection conn, int categoryId, int yearId, string entityType, int clubId, int districtId, List<GoalEntrySaveDto> entries)
    {
        if (entries == null || entries.Count == 0) return;
        var fields = await LoadFieldsWithValuesAsync(conn, categoryId, yearId, entityType, clubId, districtId, autoFillLive: true);
        foreach (var target in fields)
        {
            var entry = entries.FirstOrDefault(e => e.FieldId == target.FieldId);
            if (entry?.NumericValue == null) continue;          // blank → not decided yet, allowed
            var (floor, from) = TargetFloor(fields, target);
            if (floor <= 0m) continue;                          // no existing figure → 0 stays legal
            if (entry.NumericValue.Value < floor)
                throw new InvalidOperationException(
                    $"{target.GroupName}: \"{CurrentYearTargetLabel}\" ({entry.NumericValue.Value:N0}) cannot be less than the {floor:N0} {from}.");
        }
    }

    public async Task<GoalCategoryFormDto> SaveDistrictGoalFormAsync(int memberId, int categoryId, SaveGoalEntriesRequest request, int? requestedDistrictId)
    {
        if (request.YearId <= 0) throw new InvalidOperationException("yearId required");
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var districtId = await ResolveDistrictIdAsync(conn, memberId, requestedDistrictId);
        if (districtId == 0) throw new UnauthorizedAccessException("No district admin assignment found.");

        var (_, _, isEditable) = await ResolveYearAsync(conn, request.YearId);
        if (!isEditable) throw new InvalidOperationException("Past years are read-only and cannot be edited.");

        await ValidateTargetsVsBaselineAsync(conn, categoryId, request.YearId, "District", 0, districtId, request.Entries);
        await SaveEntriesAsync(conn, categoryId, request.YearId, "District", 0, districtId, request.Entries, memberId);
        // Also snapshot the current month's collected values into the month-wise table (additive).
        await SnapshotCurrentMonthAsync(conn, categoryId, request.YearId, "District", 0, districtId, memberId);
        return (await GetDistrictGoalFormAsync(memberId, categoryId, request.YearId, districtId))!;
    }

    // ══════════════════════════════════════════════════════════════════════════════════════
    // MONTH-WISE goals (additive; the annual flow above is untouched). Only the "collected" fields
    // are tracked per month, in goal_entries_monthly. Targets/baselines stay annual. Membership + TRF
    // first (Youth Service + Public Image reuse this by adding their collected keys to the map below).
    // ══════════════════════════════════════════════════════════════════════════════════════
    private static readonly Dictionary<string, string> MonthlyCollectedToTarget = new(StringComparer.Ordinal)
    {
        // Membership — collected → its paired annual target field.
        ["new_members_achieved"]       = "new_members",
        ["new_women_members_achieved"] = "new_women_members",
        ["new_clubs_achieved"]         = "new_clubs",
        // TRF (district)
        ["annual_fund_achieved"]       = "annual_fund_target",
        ["polio_plus_achieved"]        = "polio_plus_target",
        ["endowment_achieved"]         = "endowment_target",
        ["csr_achieved"]               = "csr_target",
        // TRF (club)
        ["club_af_per_capita"]         = "club_af_per_capita_target",
        ["club_annual_fund_ytd"]       = "club_annual_fund_ytd_target",
        ["club_polioplus_ytd"]         = "club_polioplus_ytd_target",
        ["club_other_funds_ytd"]       = "club_other_funds_ytd_target",
        ["club_endowment_ytd"]         = "club_endowment_ytd_target",
        // Youth Service — new clubs/members added (no separate annual target field → "").
        ["rotaract_new_clubs_target"]   = "",
        ["rotaract_new_members_target"] = "",
        ["interact_new_clubs_target"]   = "",
        ["rcc_new_clubs_target"]        = "",
        // Public Image — activity counts (no separate annual target field → "").
        ["district_polio_awareness_programme"] = "",
        ["inter_district_pi_programme"]        = "",
        ["bulletin_newsletter"]                = "",
        ["mega_pi_activities"]                 = "",
        ["adoption_garden_park_road"]          = "",
        ["display_items"]                      = "",
        ["press_media_coverage"]               = "",
        ["public_rally"]                       = "",
    };

    // Youth Service, DISTRICT only: the admin types an "Achieved" figure per section and the page shows a
    // Percentage Achievement beside it (2026-09-16 request). Their keys end in "_achieved"/"_pct", which the
    // month-wise form and the overview grid both drop as "derived" — that rule exists for Membership/TRF,
    // whose achieved + % already sit INSIDE the metric's own columns. These Youth fields sit in no such
    // block (Youth's monthly fields are the "Proposed New …" counts, which have no paired target), so
    // without this exemption they never reach the popup or the grid at all.
    private static readonly HashSet<string> YouthDistrictOwnKeys = new(StringComparer.Ordinal)
    {
        "rotaract_clubs_achieved", "rotaract_clubs_pct",
        "rotaract_members_achieved", "rotaract_members_pct",
        "interact_clubs_achieved", "interact_clubs_pct",
        "rcc_clubs_achieved", "rcc_clubs_pct",
    };

    // Those Youth "Percentage Achievement" values print in a single value cell, which otherwise shows a
    // bare number ("60"). Only these 4 fields are affected — every other category keeps its formatting.
    private static string? YouthPctText(GoalFieldWithValueDto fv)
        => YouthDistrictOwnKeys.Contains(fv.FieldKey) && fv.DataType == "Percentage" && fv.NumericValue.HasValue
            ? fv.NumericValue.Value.ToString("0.##") + "%"
            : null;

    private static readonly string[] RotaryMonthLabels =
        { "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec" };

    // 12 Rotary-year months from the year StartDate (Jul→Jun). IsAvailable = the month has started
    // (past years → all 12; current year → up to the current month; future months not yet collectable).
    private static List<GoalMonthPeriodDto> BuildRotaryMonths(DateTime start)
    {
        var todayFirst = new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1);
        var list = new List<GoalMonthPeriodDto>(12);
        for (int i = 0; i < 12; i++)
        {
            var dt = start.AddMonths(i);
            var firstOfMonth = new DateTime(dt.Year, dt.Month, 1);
            list.Add(new GoalMonthPeriodDto
            {
                Month = dt.Month,
                Label = RotaryMonthLabels[dt.Month - 1],
                CalendarYear = dt.Year,
                IsAvailable = firstOfMonth <= todayFirst,
            });
        }
        return list;
    }

    // "Achieved as on <date>" for the annual goal form: the last calendar day of the LATEST month
    // (in Jul→Jun order) that has month-wise data imported for this entity+category+year. E.g. July
    // data (whenever uploaded) → "31 Jul 2026"; Aug data → "31 Aug 2026". Null = no month-wise data yet.
    // TRF / Foundation figures are not typed - they arrive through the SuperAdmin Excel import, and the
    // "Achieved (as on ...)" date must name the latest month THE IMPORT COVERS. Not when the file was
    // uploaded, not the latest month that happens to hold a row, and not the current calendar month
    // (user 2026-10-01: "consider which month data we have imported").
    //
    // District and Club are two separate uploads and move independently - districts may be imported
    // through August while clubs are only through July. The date is the same for EVERY district (or
    // every club): an entity with no figures of its own still reads the imported-through month, which
    // says "the data is current to here, this one has nothing in it".
    private async Task<string?> FoundationAsOnAsync(MySqlConnection conn, int yearId, string entityType)
    {
        var yr = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT StartDate AS s FROM rotary_year_master WHERE pk_year_id = @Y AND isdeleted = 0", new { Y = yearId });
        if (yr == null || yr.s == null) return null;
        DateTime start = (DateTime)yr.s;

        List<int> months;
        try
        {
            months = (await conn.QueryAsync<int>(@"
                SELECT PeriodMonth FROM goal_foundation_import_months
                WHERE fk_year_id = @Y AND Scope = @S AND isdeleted = 0",
                new { Y = yearId, S = entityType })).ToList();
        }
        catch (MySqlException)
        {
            // Table not created yet (run SQL/goal_foundation_import_months.sql): show NO date rather
            // than a wrong one - the screens fall back to the plain "Achieved" heading.
            return null;
        }
        if (months.Count == 0) return null;

        int startMonth = start.Month, bestIdx = -1; DateTime bestDate = start;
        foreach (var pm in months)
        {
            int idx = ((pm - startMonth) + 12) % 12;        // 0 = July ... 11 = June
            if (idx > bestIdx) { bestIdx = idx; bestDate = start.AddMonths(idx); }
        }
        return new DateTime(bestDate.Year, bestDate.Month,
            DateTime.DaysInMonth(bestDate.Year, bestDate.Month)).ToString("d MMM yyyy");
    }

    // Rotary-year index (0 = July ... 11 = June) of the latest Foundation month imported for this scope;
    // -1 when nothing is imported yet, null when the bookkeeping table is missing (then no cap).
    private async Task<int?> FoundationImportedThroughIndexAsync(MySqlConnection conn, int yearId, string scope, int startMonth)
    {
        try
        {
            var months = await conn.QueryAsync<int>(@"
                SELECT PeriodMonth FROM goal_foundation_import_months
                WHERE fk_year_id = @Y AND Scope = @S AND isdeleted = 0",
                new { Y = yearId, S = scope });
            return months.Select(pm => ((pm - startMonth) + 12) % 12).DefaultIfEmpty(-1).Max();
        }
        catch (MySqlException) { return null; }
    }

    // Record what an import covered, so the "as on" date above can read it back. Called once per import,
    // with the DATA month the file carries - never the upload date.
    private async Task RecordFoundationImportMonthAsync(MySqlConnection conn, int yearId, string scope, int month, int memberId)
    {
        if (month is < 1 or > 12) return;
        try
        {
            await conn.ExecuteAsync(@"
                INSERT INTO goal_foundation_import_months (fk_year_id, Scope, PeriodMonth, created_by, created_date)
                VALUES (@Y, @S, @M, @U, NOW())
                ON DUPLICATE KEY UPDATE isdeleted = 0, modified_by = @U, modified_date = NOW()",
                new { Y = yearId, S = scope, M = month, U = memberId });
        }
        catch (MySqlException)
        {
            // Never fail an import over this bookkeeping row - the figures matter more than the label.
        }
    }

    private async Task<string?> AchievedAsOnAsync(MySqlConnection conn, int categoryId, int yearId, string entityType, int clubId, int districtId)
    {
        // TRF / Foundation follows the import, not the month-wise rows (user 2026-10-01).
        var categoryName = await GetCategoryNameAsync(conn, categoryId);
        if (IsTrfCategory(categoryName))
            return await FoundationAsOnAsync(conn, yearId, entityType);

        var yr = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT StartDate AS s, EndDate AS e FROM rotary_year_master WHERE pk_year_id = @Y AND isdeleted = 0", new { Y = yearId });
        if (yr == null || yr.s == null) return null;
        DateTime start = (DateTime)yr.s;
        // District Membership (2026-27 on) is imported too: its date is the latest month imported.
        if (IsDistrictMembershipImported(entityType, start)
            && string.Equals(categoryName, "Membership", StringComparison.OrdinalIgnoreCase))
            return await FoundationAsOnAsync(conn, yearId, MembershipImportScope);
        // Youth Service: annual only now - its "as on" is the Rotaract/Interact import, never old month-wise rows.
        if (IsDistrictMembershipImported(entityType, start)
            && string.Equals(categoryName, "Youth Service", StringComparison.OrdinalIgnoreCase))
            return await FoundationAsOnAsync(conn, yearId, YouthImportScope);
        var monthsWithData = (await conn.QueryAsync<int>(@"
            SELECT DISTINCT m.PeriodMonth
            FROM goal_entries_monthly m
            JOIN goal_fields f ON f.pk_field_id = m.fk_field_id AND f.fk_category_id = @Cat AND f.isdeleted = 0
            WHERE m.fk_year_id = @Y AND m.EntityType = @E AND m.fk_club_id = @C AND m.fk_district_id = @D
              AND m.isdeleted = 0 AND m.NumericValue IS NOT NULL",
            new { Cat = categoryId, Y = yearId, E = entityType, C = clubId, D = districtId })).ToList();
        // Exclude the CURRENT calendar month's auto-snapshot (SnapshotCurrentMonthAsync writes the live
        // cumulative into the in-progress month on every save) — the "as on" date must reflect the latest
        // COMPLETED / uploaded month, not the running month. Only applies while inside this rotary year.
        var today = DateTime.Today;
        if (yr.e != null && today >= start && today <= (DateTime)yr.e)
            monthsWithData = monthsWithData.Where(m => m != today.Month).ToList();
        if (monthsWithData.Count == 0) return null;
        int startMonth = start.Month;
        int bestIdx = -1; DateTime bestDate = start;
        foreach (var pm in monthsWithData)
        {
            int idx = ((pm - startMonth) + 12) % 12;   // 0 = July … 11 = June (rotary order)
            if (idx > bestIdx) { bestIdx = idx; bestDate = start.AddMonths(idx); }
        }
        int lastDay = DateTime.DaysInMonth(bestDate.Year, bestDate.Month);
        return new DateTime(bestDate.Year, bestDate.Month, lastDay).ToString("d MMM yyyy");
    }

    private async Task<GoalMonthlyFormDto?> BuildMonthlyFormAsync(
        MySqlConnection conn, int categoryId, int yearId, string entityType, int clubId, int districtId,
        string entityName, bool canEdit)
    {
        var yr = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT YearLabel AS label, StartDate AS s FROM rotary_year_master WHERE pk_year_id = @Y AND isdeleted = 0",
            new { Y = yearId });
        if (yr == null || yr.s == null) return null;
        DateTime start = (DateTime)yr.s;
        var months = BuildRotaryMonths(start);
        var categoryName = await GetCategoryNameAsync(conn, categoryId);
        // TRF / Foundation months run only up to the latest month IMPORTED (user 2026-10-06: imported
        // till Sep -> show Jul, Aug, Sep; Oct stays blank like a future month). Membership is unchanged.
        if (IsTrfCategory(categoryName))
        {
            var lastIdx = await FoundationImportedThroughIndexAsync(conn, yearId, entityType, start.Month);
            if (lastIdx != null)
                foreach (var mo in months)
                    if (((mo.Month - start.Month) + 12) % 12 > lastIdx.Value) mo.IsAvailable = false;
        }
        // District Membership (2026-27 on): only the months the Rotary.org import covered carry a figure.
        // First import is "1 Jul to 30 Sep" -> Jul and Aug stay blank, Sep holds the value (user 2026-10-08).
        bool membershipImported = IsDistrictMembershipImported(entityType, start)
            && string.Equals(categoryName, "Membership", StringComparison.OrdinalIgnoreCase);
        if (membershipImported)
        {
            var imported = await MembershipImportedMonthsAsync(conn, yearId);
            foreach (var mo in months)
                if (!imported.Contains(mo.Month)) mo.IsAvailable = false;
        }

        // Collected (monthly) fields of THIS category that apply to this entity level.
        var collectedKeys = MonthlyCollectedToTarget.Keys.ToArray();
        var fieldRows = (await conn.QueryAsync<dynamic>(@"
            SELECT f.pk_field_id AS fieldId, f.GroupName AS groupName, f.FieldKey AS fieldKey,
                   f.FieldLabel AS fieldLabel, f.DataType AS dataType, f.Unit AS unit
            FROM goal_fields f
            WHERE f.fk_category_id = @Cat AND f.isdeleted = 0 AND f.IsActive = 1 AND f.IsHidden = 0
              AND (f.AppliesTo = 'Both' OR f.AppliesTo = @Entity)
              AND f.FieldKey IN @Keys
            ORDER BY f.SortOrder, f.pk_field_id",
            new { Cat = categoryId, Entity = entityType, Keys = collectedKeys })).ToList();

        var fields = new List<GoalMonthlyFieldDto>();
        if (fieldRows.Count == 0)
            return new GoalMonthlyFormDto
            {
                CategoryId = categoryId, CategoryName = categoryName, EntityType = entityType,
                ClubId = entityType == "Club" ? clubId : (int?)null,
                DistrictId = entityType == "District" ? districtId : (int?)null,
                EntityName = entityName, YearId = yearId, YearLabel = (string)yr.label,
                IsEditable = canEdit, Months = months, Fields = fields,
            };

        var fieldIds = fieldRows.Select(r => (int)r.fieldId).ToArray();

        // Saved monthly values.
        var monthlyRows = await conn.QueryAsync<dynamic>(@"
            SELECT fk_field_id AS fieldId, PeriodMonth AS month, NumericValue AS val, TargetValue AS tgt
            FROM goal_entries_monthly
            WHERE fk_year_id = @Y AND EntityType = @E AND fk_club_id = @C AND fk_district_id = @D
              AND isdeleted = 0 AND fk_field_id IN @Ids",
            new { Y = yearId, E = entityType, C = clubId, D = districtId, Ids = fieldIds });
        var monthlyByField = new Dictionary<int, Dictionary<int, decimal?>>();
        var monthTargetByField = new Dictionary<int, Dictionary<int, decimal?>>();
        foreach (var m in monthlyRows)
        {
            int fid = (int)m.fieldId; int mon = Convert.ToInt32(m.month);
            if (!monthlyByField.TryGetValue(fid, out var map)) { map = new(); monthlyByField[fid] = map; }
            map[mon] = m.val is null ? null : (decimal?)Convert.ToDecimal(m.val);
            if (!monthTargetByField.TryGetValue(fid, out var tmap)) { tmap = new(); monthTargetByField[fid] = tmap; }
            tmap[mon] = m.tgt is null ? null : (decimal?)Convert.ToDecimal(m.tgt);
        }

        // Paired annual targets (from the annual goal_entries). Some collected fields (Youth/PI) have no
        // separate target ("" in the map) → no target column for them.
        var targetKeys = fieldRows.Select(r => MonthlyCollectedToTarget[(string)r.fieldKey])
            .Where(k => !string.IsNullOrEmpty(k)).Distinct().ToArray();
        var targetByKey = new Dictionary<string, decimal?>(StringComparer.Ordinal);
        if (targetKeys.Length > 0)
        {
            var targetRows = await conn.QueryAsync<dynamic>(@"
                SELECT f.FieldKey AS fieldKey, e.NumericValue AS val
                FROM goal_fields f
                LEFT JOIN goal_entries e ON e.fk_field_id = f.pk_field_id AND e.fk_year_id = @Y
                     AND e.EntityType = @E AND e.fk_club_id = @C AND e.fk_district_id = @D AND e.isdeleted = 0
                WHERE f.fk_category_id = @Cat AND f.isdeleted = 0 AND f.FieldKey IN @Keys",
                new { Cat = categoryId, Y = yearId, E = entityType, C = clubId, D = districtId, Keys = targetKeys });
            foreach (var t in targetRows)
                targetByKey[(string)t.fieldKey] = t.val is null ? null : (decimal?)Convert.ToDecimal(t.val);
        }

        foreach (var r in fieldRows)
        {
            int fid = (int)r.fieldId;
            string key = (string)r.fieldKey;
            monthlyByField.TryGetValue(fid, out var map);
            var monthly = new Dictionary<int, decimal?>();
            decimal total = 0m;
            foreach (var mo in months)
            {
                decimal? v = map != null && map.TryGetValue(mo.Month, out var mv) ? mv : null;
                monthly[mo.Month] = v;
                total += v ?? 0m;
            }
            targetByKey.TryGetValue(MonthlyCollectedToTarget[key], out var tgt);
            var dto = new GoalMonthlyFieldDto
            {
                FieldId = fid, GroupName = (string)r.groupName, FieldKey = key,
                FieldLabel = (string)r.fieldLabel, DataType = (string)r.dataType, Unit = r.unit as string,
                AnnualTarget = tgt, Monthly = monthly, Total = total,
            };
            fields.Add(dto);
        }

        // Membership month-wise is AUTO-derived from the sync's charter/join dates (not stored snapshots):
        // baseline = before Jul 1; each month = clubs chartered / members joined that month; Total = Σ additions.
        // District from 2026-27: the imported figures instead (baseline = stored "as on July 1st").
        if (membershipImported) await ApplyImportedMembershipAsync(conn, fields, months, yearId, districtId);
        else await ApplyMembershipDateBucketsAsync(conn, fields, months, entityType, clubId, districtId, start);

        // AFTER the buckets, never before: they REPLACE Monthly with the real per-month additions and
        // set the July-1st Baseline. Computing the quarterly figures earlier was reading the stored
        // rows instead, which is why Q1 "Achieved" showed the whole membership (3,796) rather than
        // what was added in Jul-Sep.
        foreach (var fld in fields)
        {
            monthTargetByField.TryGetValue(fld.FieldId, out var savedTargets);
            ApplyTargetSplit(fld, months, savedTargets);
            RoundToWhole(fld);
            if (fld.MonthlyTargets.Values.Any(v => v.HasValue))
            {
                decimal run = fld.Baseline ?? 0m;
                foreach (var mo in months)
                {
                    run += fld.MonthlyTargets.TryGetValue(mo.Month, out var t) && t.HasValue ? t.Value : 0m;
                    fld.MonthlyTargetsRunning[mo.Month] = run;
                }
            }
        }

        // Every OTHER field of the category, listed with its value but with EMPTY month cells: the July-1
        // baselines, RAG, Summary, TRF Total Giving, Youth "Existing …"/"Total …", Public Image Other
        // Points + Suggestions. They are annual values with nothing stored per month, so the month-wise
        // view used to drop them entirely and showed only part of the category.
        var annualOnly = await LoadFieldsWithValuesAsync(conn, categoryId, yearId, entityType, clubId, districtId, autoFillLive: true);
        var haveKeys = new HashSet<string>(fields.Select(f => f.FieldKey), StringComparer.Ordinal);
        // Anything already shown INSIDE a tracked metric's own columns must NOT be repeated as its own row:
        // the metric's paired target, its "as on July 1st" baseline, its "_achieved" partner and its
        // Percentage Achievement field. Without this every Membership group printed five rows —
        // "Clubs as on July 1st", "New Clubs — Target …", "New Clubs", "New Clubs — Achievement(%)".
        foreach (var f in fields)
        {
            if (MonthlyCollectedToTarget.TryGetValue(f.FieldKey, out var pairedTarget) && !string.IsNullOrEmpty(pairedTarget))
                haveKeys.Add(pairedTarget);
            if (MembershipBaselineKey.TryGetValue(f.FieldKey, out var baselineKey))
                haveKeys.Add(baselineKey);
            // Same for the TRF fund's "Highest": it is rendered as the metric's own reference column,
            // so listing it again as a separate row would print it twice (2026-09-16).
            if (TrfHighestKey.TryGetValue(f.FieldKey, out var highestKey))
                haveKeys.Add(highestKey);
        }
        // TRF Total Giving is rebuilt as a FULL metric for the reports (see ComputeCategoryMetricsAsync),
        // so its Highest and Target must not ALSO be listed here as loose annual rows.
        if (IsTrfCategory(categoryName))
        {
            haveKeys.Add("total_contributions_highest");
            haveKeys.Add("total_contributions_target");
        }
        static bool IsDerivedField(string key)
            => key.EndsWith("_achieved", StringComparison.OrdinalIgnoreCase)
            || key.EndsWith("_pct", StringComparison.OrdinalIgnoreCase)
            || key.EndsWith("_percentage_achievement", StringComparison.OrdinalIgnoreCase)
            || key == "percentage_increase";
        var extras = new List<GoalMonthlyFieldDto>();
        // The 10 Public Image suggestion fields all carry the SAME label ("Any Other Public Image Activity
        // you would like to suggest"), so listing them one by one printed that sentence ten times. They
        // collapse into ONE "Suggestions" row holding the entries that were filled in, numbered.
        var suggestionTexts = new List<string>();
        GoalMonthlyFieldDto? suggestionRow = null;
        foreach (var fv in annualOnly)
        {
            if (haveKeys.Contains(fv.FieldKey)
                || (IsDerivedField(fv.FieldKey) && !YouthDistrictOwnKeys.Contains(fv.FieldKey))) continue;
            var blank = new Dictionary<int, decimal?>();
            foreach (var mo in months) blank[mo.Month] = null;
            if (fv.GroupName.Equals("Suggestions", StringComparison.OrdinalIgnoreCase))
            {
                if (!string.IsNullOrWhiteSpace(fv.TextValue)) suggestionTexts.Add(fv.TextValue!.Trim());
                if (suggestionRow == null)
                {
                    suggestionRow = new GoalMonthlyFieldDto
                    {
                        FieldId = fv.FieldId, GroupName = fv.GroupName, FieldKey = "suggestions",
                        FieldLabel = "Suggestions", DataType = "Text", Unit = null,
                        Monthly = blank, Total = 0m, MonthlyTracked = false,
                    };
                    extras.Add(suggestionRow);
                }
                continue;
            }
            extras.Add(new GoalMonthlyFieldDto
            {
                FieldId = fv.FieldId, GroupName = fv.GroupName, FieldKey = fv.FieldKey,
                FieldLabel = fv.FieldLabel, DataType = fv.DataType, Unit = fv.Unit,
                AnnualTarget = fv.DataType is "Boolean" or "Text" ? null : fv.NumericValue,
                Monthly = blank, Total = 0m, MonthlyTracked = false,
                DisplayText = fv.DataType == "Boolean" ? (fv.BoolValue == null ? null : (fv.BoolValue.Value ? "Yes" : "No"))
                            : fv.DataType == "Text" ? fv.TextValue
                            : YouthPctText(fv),
            });
        }
        if (suggestionRow != null && suggestionTexts.Count > 0)
            suggestionRow.DisplayText = string.Join("\n", suggestionTexts.Select((s, i) => $"{i + 1}) {s}"));
        // Keep the category's own field order (SortOrder) rather than "tracked first".
        var order = annualOnly.Select((fv, i) => (fv.FieldKey, i)).ToDictionary(x => x.FieldKey, x => x.i, StringComparer.Ordinal);
        fields.AddRange(extras);
        fields = fields.OrderBy(f => order.TryGetValue(f.FieldKey, out var i) ? i : int.MaxValue).ToList();

        return new GoalMonthlyFormDto
        {
            CategoryId = categoryId, CategoryName = categoryName, EntityType = entityType,
            ClubId = entityType == "Club" ? clubId : (int?)null,
            DistrictId = entityType == "District" ? districtId : (int?)null,
            EntityName = entityName, YearId = yearId, YearLabel = (string)yr.label,
            IsEditable = canEdit, Months = months, Fields = fields,
        };
    }

    // The 3 Membership monthly metrics that are auto-derived from ClubCharterDate / club_members.JoinedDate.
    private static readonly HashSet<string> MembershipMonthlyKeys = new(StringComparer.Ordinal)
        { "new_clubs_achieved", "new_members_achieved", "new_women_members_achieved" };

    // ── District Membership from the Rotary.org Excel (user 2026-10-08) ──────────────────────────
    // From 2026-27 a DISTRICT's Clubs / Members / Women "as on July 1st" and Achieved are no longer
    // counted live from the synced clubs - they come from the SuperAdmin import of Rotary.org's
    // "Comparison to 1 July" (clubs + members) and "Members Admitted by Gender" files, so the
    // website matches Rotary.org exactly. Clubs and earlier years keep the live counting. RAG and
    // Targets are untouched.
    private static readonly DateTime MembershipImportFromYearStart = new(2026, 7, 1);
    private const string MembershipImportScope = "Membership";   // goal_foundation_import_months.Scope
    private const string YouthImportScope = "Youth";             // Youth Service -> Rotaract / Interact Clubs Achieved

    private static bool IsDistrictMembershipImported(string entityType, DateTime? yearStart)
        => entityType == "District" && yearStart.HasValue && yearStart.Value >= MembershipImportFromYearStart;

    // The months a Membership import covered (calendar month numbers). Empty when none / table missing.
    private static async Task<HashSet<int>> MembershipImportedMonthsAsync(MySqlConnection conn, int yearId)
    {
        try
        {
            return (await conn.QueryAsync<int>(@"
                SELECT PeriodMonth FROM goal_foundation_import_months
                WHERE fk_year_id = @Y AND Scope = @S AND isdeleted = 0",
                new { Y = yearId, S = MembershipImportScope })).ToHashSet();
        }
        catch (MySqlException) { return new HashSet<int>(); }
    }

    // Imported mode of ApplyMembershipDateBucketsAsync: baseline = the stored "as on July 1st" figure,
    // each imported month = what was added in it (stored by the import), every other month blank.
    private static async Task ApplyImportedMembershipAsync(
        MySqlConnection conn, List<GoalMonthlyFieldDto> fields, List<GoalMonthPeriodDto> months, int yearId, int districtId)
    {
        if (!fields.Any(f => MembershipMonthlyKeys.Contains(f.FieldKey))) return;
        var baselines = (await conn.QueryAsync<(string k, decimal? v)>(@"
            SELECT f.FieldKey AS k, e.NumericValue AS v
            FROM goal_fields f
            JOIN goal_entries e ON e.fk_field_id = f.pk_field_id AND e.fk_year_id = @Y AND e.EntityType = 'District'
                               AND e.fk_club_id = 0 AND e.fk_district_id = @D AND e.isdeleted = 0
            WHERE f.isdeleted = 0 AND f.FieldKey IN @Keys",
            new { Y = yearId, D = districtId, Keys = MembershipBaselineKey.Values.ToArray() }))
            .GroupBy(x => x.k).ToDictionary(g => g.Key, g => g.First().v, StringComparer.Ordinal);
        foreach (var f in fields.Where(x => MembershipMonthlyKeys.Contains(x.FieldKey)))
        {
            f.Baseline = MembershipBaselineKey.TryGetValue(f.FieldKey, out var bk) && baselines.TryGetValue(bk, out var b) ? b : null;
            var monthly = new Dictionary<int, decimal?>();
            decimal total = 0m;
            foreach (var mo in months)
            {
                decimal? v = mo.IsAvailable && f.Monthly.TryGetValue(mo.Month, out var mv) ? mv : null;
                monthly[mo.Month] = v;
                total += v ?? 0m;
            }
            f.Monthly = monthly;
            f.Total = total;
        }
    }

    // Every sheet of an .xlsx as (name, cells by (row, col) -> text). Plain OpenXML on purpose:
    // Rotary.org's exports carry pictures with duplicate ids, which ClosedXML refuses to open.
    private static List<(string Name, Dictionary<(int R, int C), string> Cells)> ReadXlsxGrids(Stream stream)
    {
        using var doc = DocumentFormat.OpenXml.Packaging.SpreadsheetDocument.Open(stream, false);
        var wbp = doc.WorkbookPart ?? throw new InvalidOperationException("Not an Excel (.xlsx) file.");
        var sst = wbp.SharedStringTablePart?.SharedStringTable?
            .Elements<DocumentFormat.OpenXml.Spreadsheet.SharedStringItem>().Select(i => i.InnerText).ToList() ?? new List<string>();
        var list = new List<(string, Dictionary<(int, int), string>)>();
        foreach (var sheet in wbp.Workbook.Sheets?.Elements<DocumentFormat.OpenXml.Spreadsheet.Sheet>()
                              ?? Enumerable.Empty<DocumentFormat.OpenXml.Spreadsheet.Sheet>())
        {
            if (sheet.Id?.Value == null || wbp.GetPartById(sheet.Id.Value) is not DocumentFormat.OpenXml.Packaging.WorksheetPart wsp) continue;
            var cells = new Dictionary<(int, int), string>();
            foreach (var c in wsp.Worksheet.Descendants<DocumentFormat.OpenXml.Spreadsheet.Cell>())
            {
                var reference = c.CellReference?.Value;
                if (string.IsNullOrEmpty(reference)) continue;
                int col = 0, i = 0;
                for (; i < reference.Length && char.IsLetter(reference[i]); i++) col = col * 26 + (char.ToUpperInvariant(reference[i]) - 'A' + 1);
                if (!int.TryParse(reference.AsSpan(i), out var row)) continue;
                string v = c.CellValue?.Text ?? c.InlineString?.InnerText ?? "";
                if (c.DataType?.Value == DocumentFormat.OpenXml.Spreadsheet.CellValues.SharedString
                    && int.TryParse(v, out var si) && si >= 0 && si < sst.Count) v = sst[si];
                cells[(row, col)] = v.Trim();
            }
            list.Add((sheet.Name?.Value ?? "", cells));
        }
        return list;
    }

    // Rotary.org "Comparison to 1 July" (Rotary or Rotaract - same layout): per district, "# Club" and
    // "# Member" on 1 July and on the report date, plus that date ("30 September 2026").
    private static (Dictionary<string, (int Jul1Clubs, int Jul1Members, int Clubs, int Members)> Rows, DateTime AsOf)
        ParseComparisonFile(Stream stream, string what, DateTime start, DateTime end)
    {
        static int? Num(string? t)
        {
            if (string.IsNullOrWhiteSpace(t)) return null;
            if (decimal.TryParse(t.Replace(",", ""), System.Globalization.NumberStyles.Any,
                    System.Globalization.CultureInfo.InvariantCulture, out var d)) return (int)Math.Round(d);
            return null;
        }
        static bool IsDistrictNo(string? t) => !string.IsNullOrEmpty(t) && t.All(char.IsDigit);

        var members = new Dictionary<string, (int Jul1Clubs, int Jul1Members, int Clubs, int Members)>(StringComparer.Ordinal);
        DateTime asOf;
        {
            var cells = ReadXlsxGrids(stream).FirstOrDefault().Cells
                ?? throw new InvalidOperationException($"{what} file has no sheet.");
            string At(int r, int c) => cells.TryGetValue((r, c), out var v) ? v : "";
            int hdr = 0, dCol = 0; var clubCols = new List<int>(); var memCols = new List<int>();
            foreach (var r in cells.Keys.Select(k => k.R).Distinct().Where(r => r <= 30).OrderBy(r => r))
            {
                var row = cells.Where(k => k.Key.R == r).OrderBy(k => k.Key.C).ToList();
                dCol = row.FirstOrDefault(k => k.Value.Equals("District", StringComparison.OrdinalIgnoreCase)).Key.C;
                clubCols = row.Where(k => k.Value.Equals("# Club", StringComparison.OrdinalIgnoreCase)).Select(k => k.Key.C).ToList();
                memCols = row.Where(k => k.Value.Equals("# Member", StringComparison.OrdinalIgnoreCase)).Select(k => k.Key.C).ToList();
                if (dCol > 0 && clubCols.Count >= 2 && memCols.Count >= 2) { hdr = r; break; }
            }
            if (hdr == 0)
                throw new InvalidOperationException($"{what} file: could not find the District / # Club / # Member header. Upload Rotary.org's \"Comparison to 1 July\" file.");

            // The report date sits above the second "# Club" column ("30 September 2026").
            DateTime? found = null;
            for (int r = hdr - 1; r >= 1 && found == null; r--)
            {
                var t = At(r, clubCols[1]).Replace("*", "").Trim();
                if (t.Length == 0) continue;
                if (DateTime.TryParse(t, System.Globalization.CultureInfo.InvariantCulture,
                        System.Globalization.DateTimeStyles.None, out var d)) found = d;
                else if (double.TryParse(t, System.Globalization.NumberStyles.Any,
                        System.Globalization.CultureInfo.InvariantCulture, out var oa) && oa > 30000 && oa < 80000)
                    found = DateTime.FromOADate(oa);   // a real Excel date cell
            }
            if (found == null) throw new InvalidOperationException($"{what} file: could not read the report date (e.g. \"30 September 2026\").");
            asOf = found.Value.Date;
            if (asOf < start || asOf > end)
                throw new InvalidOperationException($"{what} file is dated {asOf:d MMM yyyy}, which is not in the selected Rotary year.");

            foreach (var r in cells.Keys.Select(k => k.R).Distinct().Where(r => r > hdr))
            {
                var dn = At(r, dCol);
                if (!IsDistrictNo(dn)) continue;   // "# of Districts:" / blank rows
                members[dn] = (Num(At(r, clubCols[0])) ?? 0, Num(At(r, memCols[0])) ?? 0,
                               Num(At(r, clubCols[1])) ?? 0, Num(At(r, memCols[1])) ?? 0);
            }
        }
        return (members, asOf);
    }

    // Rotary.org "Interact_Statistics": sheet "By District" - District · Total Active Clubs · … with
    // "AS OF 30-September-2026" above the header. Returns per district the active Interact clubs now and
    // on 1 July (= now - "Change in Clubs from End of Previous Rotary Year"), plus the date.
    private static (Dictionary<string, (int Now, int Jul1)> Rows, DateTime AsOf) ParseInteractStatistics(Stream stream)
    {
        var sheet = ReadXlsxGrids(stream).FirstOrDefault(x => x.Name.Trim().Equals("By District", StringComparison.OrdinalIgnoreCase));
        if (sheet.Cells == null)
            throw new InvalidOperationException("Interact file: sheet \"By District\" not found. Upload Rotary.org's \"Interact_Statistics\" file.");
        var cells = sheet.Cells;
        DateTime? asOf = null; int hdr = 0, dCol = 0, tCol = 0, yCol = 0;
        foreach (var r in cells.Keys.Select(k => k.R).Distinct().Where(r => r <= 30).OrderBy(r => r))
        {
            var row = cells.Where(k => k.Key.R == r).ToList();
            foreach (var kv in row)
            {
                var t = kv.Value;
                if (asOf == null && t.StartsWith("AS OF", StringComparison.OrdinalIgnoreCase)
                    && DateTime.TryParseExact(t.Substring(5).Trim(), new[] { "d-MMMM-yyyy", "dd-MMMM-yyyy", "d-MMM-yyyy" },
                        System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var d))
                    asOf = d.Date;
            }
            dCol = row.FirstOrDefault(k => k.Value.Equals("District", StringComparison.OrdinalIgnoreCase)).Key.C;
            tCol = row.FirstOrDefault(k => k.Value.Equals("Total Active Clubs", StringComparison.OrdinalIgnoreCase)).Key.C;
            yCol = row.FirstOrDefault(k => k.Value.Contains("Previous Rotary Year", StringComparison.OrdinalIgnoreCase)).Key.C;
            if (dCol > 0 && tCol > 0 && yCol > 0) { hdr = r; break; }
        }
        if (hdr == 0) throw new InvalidOperationException("Interact file: District / Total Active Clubs / Change from End of Previous Rotary Year header not found on \"By District\".");
        if (asOf == null) throw new InvalidOperationException("Interact file: could not read the \"AS OF\" date.");
        static int? N(Dictionary<(int R, int C), string> cs, int r, int c)
            => cs.TryGetValue((r, c), out var t) && decimal.TryParse(t, System.Globalization.NumberStyles.Any,
                   System.Globalization.CultureInfo.InvariantCulture, out var n) ? (int)Math.Round(n) : null;
        var rows = new Dictionary<string, (int Now, int Jul1)>(StringComparer.Ordinal);
        foreach (var r in cells.Keys.Select(k => k.R).Distinct().Where(r => r > hdr))
        {
            var dn = cells.TryGetValue((r, dCol), out var dv) ? dv : "";
            if (string.IsNullOrEmpty(dn) || !dn.All(char.IsDigit)) continue;
            var now = N(cells, r, tCol);
            if (now == null) continue;
            rows[dn] = (now.Value, now.Value - (N(cells, r, yCol) ?? 0));
        }
        return (rows, asOf.Value);
    }

    // SuperAdmin import. `membersStream` = Rotary.org "Comparison to 1 July" (ROTARY clubs - the
    // Rotaract file has the same layout and is refused by name); `genderStream` = "Members Admitted by
    // Gender" (Admitted_Rotary + Terminated_Rotary sheets). The data month is read from the members
    // file's date heading ("30 September 2026"). Only our own districts (Zones 1-9, not Zone 0 / Other
    // Zones) are written; everything else in the files is ignored.
    //   Clubs   : July 1st = "# Club" on 1 July,   Achieved = "# Club" on the report date.
    //   Members : July 1st = "# Member" on 1 July, Achieved = "# Member" on the report date.
    //   Women   : July 1st = our system's count on 1 July (Rotary gives no women total), frozen at the
    //             first import of the year; Achieved = that + women admitted - women terminated.
    // Month-wise: the month stores what was added since the previous imported month.
    public async Task<GoalFoundationImportResultDto> ImportDistrictMembershipAsync(
        int memberId, int yearId, Stream membersStream, string membersFileName, Stream genderStream,
        Stream? rotaractStream = null, string? rotaractFileName = null, Stream? interactStream = null)
    {
        if (rotaractStream != null && !(rotaractFileName ?? "").Contains("rotaract", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("The third file must be Rotary.org's Rotaract \"Comparison to 1 July\" file (its name contains \"Rotaract\").");
        if (!string.IsNullOrEmpty(membersFileName) && membersFileName.Contains("rotaract", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("This is the Rotaract file. Upload the Rotary \"Comparison to 1 July\" file.");

        using var conn = CreateConnection();
        await conn.OpenAsync();
        var yr = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT StartDate AS s, EndDate AS e FROM rotary_year_master WHERE pk_year_id = @Y AND isdeleted = 0", new { Y = yearId });
        if (yr == null || yr.s == null) throw new InvalidOperationException("Invalid Rotary year.");
        DateTime start = (DateTime)yr.s;
        DateTime end = yr.e != null ? (DateTime)yr.e : start.AddYears(1).AddDays(-1);
        if (start < MembershipImportFromYearStart)
            throw new InvalidOperationException("Membership import is used from Rotary year 2026-27 onwards.");

        static int? Num(string? t)
        {
            if (string.IsNullOrWhiteSpace(t)) return null;
            if (decimal.TryParse(t.Replace(",", ""), System.Globalization.NumberStyles.Any,
                    System.Globalization.CultureInfo.InvariantCulture, out var d)) return (int)Math.Round(d);
            return null;
        }
        static bool IsDistrictNo(string? t) => !string.IsNullOrEmpty(t) && t.All(char.IsDigit);

        // ── File 1: clubs + members by district ──
        var (members, asOf) = ParseComparisonFile(membersStream, "Members", start, end);
        int month = asOf.Month;

        // ── File 3 (optional): Rotaract clubs + Rotaractors, July 1st and now (clubs 2026-10-08, Rotaractors 2026-10-09) ──
        Dictionary<string, (int Jul1Clubs, int Jul1Members, int Clubs, int Members)>? rotaract = null;
        if (rotaractStream != null)
        {
            var (rows, racAsOf) = ParseComparisonFile(rotaractStream, "Rotaract", start, end);
            if (racAsOf != asOf)
                throw new InvalidOperationException($"The Rotaract file is dated {racAsOf:d MMM yyyy} but the Rotary file {asOf:d MMM yyyy} - download both for the same date.");
            rotaract = rows;
        }
        // Youth Service fields the two optional files fill (user 2026-10-08): Clubs Achieved, and the
        // "Existing … Clubs as on July 1st" so the Percentage Achieved has a correct base too.
        var youthIds = (await conn.QueryAsync<(string k, int id)>(@"
            SELECT FieldKey AS k, pk_field_id AS id FROM goal_fields WHERE isdeleted = 0 AND FieldKey IN @Keys",
            new { Keys = new[] { "rotaract_clubs_achieved", "rotaract_existing_clubs", "rotaract_existing_members", "rotaract_members_achieved",
                                 "interact_clubs_achieved", "interact_existing_clubs" } }))
            .GroupBy(x => x.k).ToDictionary(g => g.Key, g => g.First().id, StringComparer.Ordinal);
        foreach (var k in (rotaract != null ? new[] { "rotaract_clubs_achieved", "rotaract_existing_clubs", "rotaract_existing_members", "rotaract_members_achieved" } : Array.Empty<string>()))
            if (!youthIds.ContainsKey(k)) throw new InvalidOperationException($"Youth Service field '{k}' is missing.");
        int racWritten = 0;

        // ── File 4 (optional): Interact_Statistics, sheet "By District" - Interact "Clubs Achieved" ──
        Dictionary<string, (int Now, int Jul1)>? interact = null;
        if (interactStream != null)
        {
            var (rows, intAsOf) = ParseInteractStatistics(interactStream);
            if (intAsOf != asOf)
                throw new InvalidOperationException($"The Interact file is as of {intAsOf:d MMM yyyy} but the Rotary file {asOf:d MMM yyyy} - download both for the same date.");
            interact = rows;
        }
        foreach (var k in (interact != null ? new[] { "interact_clubs_achieved", "interact_existing_clubs" } : Array.Empty<string>()))
            if (!youthIds.ContainsKey(k)) throw new InvalidOperationException($"Youth Service field '{k}' is missing.");
        async Task UpsertDistrictAsync(int fieldId, int districtId, decimal value) => await conn.ExecuteAsync(@"
            INSERT INTO goal_entries (fk_field_id, fk_year_id, EntityType, fk_club_id, fk_district_id, NumericValue, created_by, created_date, isdeleted)
            VALUES (@F, @Y, 'District', 0, @D, @V, @By, NOW(), 0)
            ON DUPLICATE KEY UPDATE NumericValue = VALUES(NumericValue), modified_by = @By, modified_date = NOW(), isdeleted = 0",
            new { F = fieldId, Y = yearId, D = districtId, V = value, By = memberId });
        int intWritten = 0;

        // ── File 2: women admitted / terminated by district (Rotary sheets only, never Rotaract) ──
        var womenIn = new Dictionary<string, int>(StringComparer.Ordinal);
        var womenOut = new Dictionary<string, int>(StringComparer.Ordinal);
        {
            var sheets = ReadXlsxGrids(genderStream);
            void ReadSheet(string word, Dictionary<string, int> into)
            {
                var sh = sheets.FirstOrDefault(x =>
                    x.Name.Contains(word, StringComparison.OrdinalIgnoreCase)
                    && x.Name.Contains("rotary", StringComparison.OrdinalIgnoreCase)
                    && !x.Name.Contains("rotaract", StringComparison.OrdinalIgnoreCase));
                if (sh.Cells == null)
                    throw new InvalidOperationException($"Gender file: sheet \"{word}_Rotary\" not found. Upload Rotary.org's \"Members Admitted by Gender\" file.");
                var cells = sh.Cells;
                int hdr = 0, dCol = 0, fCol = 0;
                foreach (var r in cells.Keys.Select(k => k.R).Distinct().Where(r => r <= 30).OrderBy(r => r))
                {
                    var row = cells.Where(k => k.Key.R == r).OrderBy(k => k.Key.C).ToList();
                    dCol = row.FirstOrDefault(k => k.Value.Equals("District", StringComparison.OrdinalIgnoreCase)).Key.C;
                    fCol = row.FirstOrDefault(k => k.Value.Equals("Female", StringComparison.OrdinalIgnoreCase)).Key.C;
                    if (dCol > 0 && fCol > 0) { hdr = r; break; }
                }
                if (hdr == 0) throw new InvalidOperationException($"Gender file: District / Female header not found on sheet \"{sh.Name}\".");
                foreach (var r in cells.Keys.Select(k => k.R).Distinct().Where(r => r > hdr))
                {
                    var dn = cells.TryGetValue((r, dCol), out var dv) ? dv : "";
                    if (!IsDistrictNo(dn)) continue;
                    into[dn] = (into.TryGetValue(dn, out var sum) ? sum : 0) + (Num(cells.TryGetValue((r, fCol), out var fv) ? fv : null) ?? 0);
                }
            }
            ReadSheet("Admitted", womenIn);
            ReadSheet("Terminated", womenOut);
        }

        // Our districts only.
        var districts = (await conn.QueryAsync<(int id, string num)>(@"
            SELECT d.pk_district_id AS id, d.DistrictNumber AS num
            FROM district_master d
            JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE d.isdeleted = 0 AND z.isdeleted = 0
              AND z.ZoneName LIKE 'Zone %' AND z.ZoneName <> 'Zone 0'
            ORDER BY CAST(d.DistrictNumber AS UNSIGNED)")).ToList();

        var keys = new[] { "total_clubs", "new_clubs_achieved", "total_members", "new_members_achieved",
                           "existing_women_members", "new_women_members_achieved" };
        var fieldIds = (await conn.QueryAsync<(string k, int id)>(@"
            SELECT f.FieldKey AS k, f.pk_field_id AS id FROM goal_fields f
            JOIN goal_categories c ON c.pk_category_id = f.fk_category_id AND c.Name = 'Membership'
            WHERE f.isdeleted = 0 AND f.FieldKey IN @Keys", new { Keys = keys }))
            .GroupBy(x => x.k).ToDictionary(g => g.Key, g => g.First().id, StringComparer.Ordinal);
        foreach (var k in keys)
            if (!fieldIds.ContainsKey(k)) throw new InvalidOperationException($"Membership field '{k}' is missing.");

        // Earlier imported months of this year: the month stores only what was added since them.
        var importedBefore = await MembershipImportedMonthsAsync(conn, yearId);
        bool firstImport = importedBefore.Count == 0;
        int Idx(int m) => ((m - start.Month) + 12) % 12;
        var priorMonths = importedBefore.Where(m => Idx(m) < Idx(month)).ToArray();
        var prior = new Dictionary<(int FieldId, int DistrictId), decimal>();
        if (priorMonths.Length > 0)
            foreach (var pr in await conn.QueryAsync<(int f, int d, decimal s)>(@"
                SELECT fk_field_id AS f, fk_district_id AS d, COALESCE(SUM(NumericValue), 0) AS s
                FROM goal_entries_monthly
                WHERE fk_year_id = @Y AND EntityType = 'District' AND fk_club_id = 0 AND isdeleted = 0
                  AND PeriodMonth IN @Ms AND fk_field_id IN @Fs
                GROUP BY fk_field_id, fk_district_id",
                new { Y = yearId, Ms = priorMonths, Fs = fieldIds.Values.ToArray() }))
                prior[(pr.f, pr.d)] = pr.s;

        // Women on July 1st: frozen at the first import; later imports reuse the stored figure.
        var storedWomen = firstImport ? new Dictionary<int, decimal>() : (await conn.QueryAsync<(int d, decimal v)>(@"
            SELECT fk_district_id AS d, NumericValue AS v FROM goal_entries
            WHERE fk_field_id = @F AND fk_year_id = @Y AND EntityType = 'District' AND fk_club_id = 0
              AND isdeleted = 0 AND NumericValue IS NOT NULL",
            new { F = fieldIds["existing_women_members"], Y = yearId })).ToDictionary(x => x.d, x => x.v);

        var result = new GoalFoundationImportResultDto { YearId = yearId };
        foreach (var (did, num) in districts)
        {
            if (!members.TryGetValue(num.Trim(), out var m))
            {
                result.SkippedRows.Add(new GoalFoundationImportSkippedRowDto { DistrictNumber = num, Reason = "Not in the Rotary.org members file - left unchanged." });
                continue;
            }
            decimal womenJul1 = storedWomen.TryGetValue(did, out var sw)
                ? sw : await LiveDistrictWomenCountAsync(conn, did, start);
            womenIn.TryGetValue(num.Trim(), out var wi);
            womenOut.TryGetValue(num.Trim(), out var wo);

            var annual = new (string Key, decimal Value)[]
            {
                ("total_clubs", m.Jul1Clubs), ("new_clubs_achieved", m.Clubs),
                ("total_members", m.Jul1Members), ("new_members_achieved", m.Members),
                ("existing_women_members", womenJul1), ("new_women_members_achieved", womenJul1 + wi - wo),
            };
            foreach (var (key, value) in annual)
            {
                await conn.ExecuteAsync(@"
                    INSERT INTO goal_entries (fk_field_id, fk_year_id, EntityType, fk_club_id, fk_district_id, NumericValue, created_by, created_date, isdeleted)
                    VALUES (@F, @Y, 'District', 0, @D, @V, @By, NOW(), 0)
                    ON DUPLICATE KEY UPDATE NumericValue = VALUES(NumericValue), modified_by = @By, modified_date = NOW(), isdeleted = 0",
                    new { F = fieldIds[key], Y = yearId, D = did, V = value, By = memberId });
                result.ValuesWritten++;
            }
            foreach (var (achKey, baseKey) in MembershipBaselineKey)
            {
                int fid = fieldIds[achKey];
                decimal ach = annual.First(a => a.Key == achKey).Value, bas = annual.First(a => a.Key == baseKey).Value;
                prior.TryGetValue((fid, did), out var before);
                await conn.ExecuteAsync(@"
                    INSERT INTO goal_entries_monthly (fk_field_id, fk_year_id, EntityType, fk_club_id, fk_district_id, PeriodMonth, NumericValue, created_by, created_date, isdeleted)
                    VALUES (@F, @Y, 'District', 0, @D, @M, @V, @By, NOW(), 0)
                    ON DUPLICATE KEY UPDATE NumericValue = VALUES(NumericValue), modified_by = @By, modified_date = NOW(), isdeleted = 0",
                    new { F = fid, Y = yearId, D = did, M = month, V = ach - bas - before, By = memberId });
            }
            result.ImportedDistricts++;
        }
        // Rotaract clubs + Rotaractors (July 1st and Achieved), for our districts in the Rotaract file.
        if (rotaract != null)
        {
            foreach (var (did, num) in districts)
            {
                if (!rotaract.TryGetValue(num.Trim(), out var rc)) continue;
                await UpsertDistrictAsync(youthIds["rotaract_existing_clubs"], did, rc.Jul1Clubs);
                await UpsertDistrictAsync(youthIds["rotaract_clubs_achieved"], did, rc.Clubs);
                await UpsertDistrictAsync(youthIds["rotaract_existing_members"], did, rc.Jul1Members);
                await UpsertDistrictAsync(youthIds["rotaract_members_achieved"], did, rc.Members);
                racWritten++;
            }
        }
        // Interact Clubs Achieved, for our districts in Interact_Statistics "By District".
        if (interact != null)
        {
            foreach (var (did, num) in districts)
            {
                if (!interact.TryGetValue(num.Trim(), out var ic)) continue;
                await UpsertDistrictAsync(youthIds["interact_existing_clubs"], did, ic.Jul1);
                await UpsertDistrictAsync(youthIds["interact_clubs_achieved"], did, ic.Now);
                intWritten++;
            }
        }
        if (rotaract != null || interact != null)
            await RecordFoundationImportMonthAsync(conn, yearId, YouthImportScope, month, memberId);
        await RecordFoundationImportMonthAsync(conn, yearId, MembershipImportScope, month, memberId);

        result.Message = $"Membership as on {asOf:d MMM yyyy}: {result.ImportedDistricts} district(s) updated"
                       + (result.SkippedRows.Count > 0 ? $", {result.SkippedRows.Count} not in the file" : "")
                       + (rotaract != null ? $"; Rotaract clubs + Rotaractors (July 1st + Achieved) set for {racWritten} district(s)" : "")
                       + (interact != null ? $"; Interact clubs (July 1st + Achieved) set for {intWritten} district(s)" : "") + ".";
        return result;
    }

    // Overwrite the 3 Membership monthly fields with date-derived buckets + an "As on Jul 1" baseline.
    // Baseline + Σ(months) reconciles to the active total; null charter/join dates fold into the baseline
    // (the Live* queries count them as existing); future/not-yet-started months stay null.
    private static async Task ApplyMembershipDateBucketsAsync(
        MySqlConnection conn, List<GoalMonthlyFieldDto> fields, List<GoalMonthPeriodDto> months,
        string entityType, int clubId, int districtId, DateTime yearStart)
    {
        if (!fields.Any(f => MembershipMonthlyKeys.Contains(f.FieldKey))) return;
        DateTime yearEnd = yearStart.AddYears(1).AddDays(-1);

        void Apply(string fieldKey, int baseline, Dictionary<(int Year, int Month), int> buckets)
        {
            var f = fields.FirstOrDefault(x => x.FieldKey == fieldKey);
            if (f == null) return;
            f.Baseline = baseline;
            var monthly = new Dictionary<int, decimal?>();
            decimal total = 0m;
            foreach (var mo in months)
            {
                if (!mo.IsAvailable) { monthly[mo.Month] = null; continue; }
                buckets.TryGetValue((mo.CalendarYear, mo.Month), out var cnt);
                monthly[mo.Month] = cnt;
                total += cnt;
            }
            f.Monthly = monthly;
            f.Total = total;
        }

        if (entityType == "District")
        {
            if (fields.Any(f => f.FieldKey == "new_clubs_achieved"))
                Apply("new_clubs_achieved", await LiveDistrictClubCountAsync(conn, districtId, yearStart),
                    await MonthlyNewClubsDistrictAsync(conn, districtId, yearStart, yearEnd));
            if (fields.Any(f => f.FieldKey == "new_members_achieved"))
                Apply("new_members_achieved", await LiveDistrictMemberCountAsync(conn, districtId, yearStart),
                    await MonthlyNewMembersDistrictAsync(conn, districtId, yearStart, yearEnd));
            if (fields.Any(f => f.FieldKey == "new_women_members_achieved"))
                Apply("new_women_members_achieved", await LiveDistrictWomenCountAsync(conn, districtId, yearStart),
                    await MonthlyNewWomenDistrictAsync(conn, districtId, yearStart, yearEnd));
        }
        else if (entityType == "Club")
        {
            if (fields.Any(f => f.FieldKey == "new_members_achieved"))
                Apply("new_members_achieved", await LiveClubMemberCountAsync(conn, clubId, yearStart),
                    await MonthlyNewMembersClubAsync(conn, clubId, yearStart, yearEnd));
            if (fields.Any(f => f.FieldKey == "new_women_members_achieved"))
                Apply("new_women_members_achieved", await LiveClubWomenCountAsync(conn, clubId, yearStart),
                    await MonthlyNewWomenClubAsync(conn, clubId, yearStart, yearEnd));
            // new_clubs is not meaningful at a single club → left as-is (baseline null).
        }
    }

    private static async Task<Dictionary<(int, int), int>> MonthBucketsAsync(MySqlConnection conn, string sql, object p)
    {
        var rows = await conn.QueryAsync<dynamic>(sql, p);
        var dict = new Dictionary<(int, int), int>();
        foreach (var r in rows) dict[(Convert.ToInt32(r.y), Convert.ToInt32(r.mo))] = Convert.ToInt32(r.cnt);
        return dict;
    }

    // Clubs chartered per (year, month) — district (active, synced AND non-synced). Same filters as AchievedNewClubsDistrictAsync.
    private static Task<Dictionary<(int, int), int>> MonthlyNewClubsDistrictAsync(MySqlConnection conn, int districtId, DateTime start, DateTime end) =>
        MonthBucketsAsync(conn,
            @"SELECT YEAR(ClubCharterDate) AS y, MONTH(ClubCharterDate) AS mo, COUNT(*) AS cnt
              FROM club_master
              WHERE fk_district_id = @Id AND IsActive = 1 AND isdeleted = 0
                AND ClubCharterDate IS NOT NULL AND ClubCharterDate >= @S AND ClubCharterDate <= @E
              GROUP BY YEAR(ClubCharterDate), MONTH(ClubCharterDate)",
            new { Id = districtId, S = start, E = end });

    // Members joined per (year, month) — district (active, synced, non-honorary). Same filters as the Live/Achieved members query.
    private static Task<Dictionary<(int, int), int>> MonthlyNewMembersDistrictAsync(MySqlConnection conn, int districtId, DateTime start, DateTime end) =>
        MonthBucketsAsync(conn,
            @"SELECT YEAR(cm.JoinedDate) AS y, MONTH(cm.JoinedDate) AS mo, COUNT(DISTINCT m.pk_member_master_profile_id) AS cnt
              FROM club_members cm
              JOIN club_master c ON c.pk_club_id = cm.fk_club_id
              JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
              WHERE c.fk_district_id = @Id
                AND cm.IsActive = 1 AND cm.isdeleted = 0 AND cm.IsHonoraryMember = 0
                AND c.IsActive = 1 AND c.isdeleted = 0 AND c.IsSyncedFromRotaryOrg = 1
                AND m.isdeleted = 0
                AND cm.JoinedDate IS NOT NULL AND cm.JoinedDate >= @S AND cm.JoinedDate <= @E
              GROUP BY YEAR(cm.JoinedDate), MONTH(cm.JoinedDate)",
            new { Id = districtId, S = start, E = end });

    private static Task<Dictionary<(int, int), int>> MonthlyNewWomenDistrictAsync(MySqlConnection conn, int districtId, DateTime start, DateTime end) =>
        MonthBucketsAsync(conn,
            @"SELECT YEAR(cm.JoinedDate) AS y, MONTH(cm.JoinedDate) AS mo, COUNT(DISTINCT m.pk_member_master_profile_id) AS cnt
              FROM club_members cm
              JOIN club_master c ON c.pk_club_id = cm.fk_club_id
              JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
              WHERE c.fk_district_id = @Id
                AND cm.IsActive = 1 AND cm.isdeleted = 0 AND cm.IsHonoraryMember = 0
                AND c.IsActive = 1 AND c.isdeleted = 0 AND c.IsSyncedFromRotaryOrg = 1
                AND m.isdeleted = 0 AND m.Gender = 'Female'
                AND cm.JoinedDate IS NOT NULL AND cm.JoinedDate >= @S AND cm.JoinedDate <= @E
              GROUP BY YEAR(cm.JoinedDate), MONTH(cm.JoinedDate)",
            new { Id = districtId, S = start, E = end });

    private static Task<Dictionary<(int, int), int>> MonthlyNewMembersClubAsync(MySqlConnection conn, int clubId, DateTime start, DateTime end) =>
        MonthBucketsAsync(conn,
            @"SELECT YEAR(cm.JoinedDate) AS y, MONTH(cm.JoinedDate) AS mo, COUNT(DISTINCT m.pk_member_master_profile_id) AS cnt
              FROM club_members cm
              JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
              WHERE cm.fk_club_id = @Id
                AND cm.IsActive = 1 AND cm.isdeleted = 0 AND cm.IsHonoraryMember = 0
                AND m.isdeleted = 0
                AND cm.JoinedDate IS NOT NULL AND cm.JoinedDate >= @S AND cm.JoinedDate <= @E
              GROUP BY YEAR(cm.JoinedDate), MONTH(cm.JoinedDate)",
            new { Id = clubId, S = start, E = end });

    private static Task<Dictionary<(int, int), int>> MonthlyNewWomenClubAsync(MySqlConnection conn, int clubId, DateTime start, DateTime end) =>
        MonthBucketsAsync(conn,
            @"SELECT YEAR(cm.JoinedDate) AS y, MONTH(cm.JoinedDate) AS mo, COUNT(DISTINCT m.pk_member_master_profile_id) AS cnt
              FROM club_members cm
              JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
              WHERE cm.fk_club_id = @Id
                AND cm.IsActive = 1 AND cm.isdeleted = 0 AND cm.IsHonoraryMember = 0
                AND m.isdeleted = 0 AND m.Gender = 'Female'
                AND cm.JoinedDate IS NOT NULL AND cm.JoinedDate >= @S AND cm.JoinedDate <= @E
              GROUP BY YEAR(cm.JoinedDate), MONTH(cm.JoinedDate)",
            new { Id = clubId, S = start, E = end });

    // Upsert one month's collected values. Guards: field must be a known monthly field of the category,
    // and the month must be a real, already-started month of the Rotary year.
    // restrictToCurrentMonth: district/club admins may only write the CURRENT calendar month of the
    // current Rotary year (no back-dating a past month). SuperAdmin passes false → no such restriction.
    private async Task SaveMonthlyCoreAsync(
        MySqlConnection conn, int categoryId, int yearId, string entityType, int clubId, int districtId,
        int month, List<GoalMonthlySaveDto> entries, int memberId, bool restrictToCurrentMonth = false)
    {
        var yr = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT StartDate AS s FROM rotary_year_master WHERE pk_year_id = @Y AND isdeleted = 0", new { Y = yearId });
        if (yr == null || yr.s == null) throw new InvalidOperationException("Invalid year.");
        var months = BuildRotaryMonths((DateTime)yr.s);
        var period = months.FirstOrDefault(m => m.Month == month);
        if (period == null) throw new InvalidOperationException("That month is not part of this Rotary year.");
        if (!period.IsAvailable) throw new InvalidOperationException("That month hasn't started yet.");

        // District/Club admins can only edit the current month of the current Rotary year — past months
        // freeze at their saved value; only SuperAdmin may correct an earlier month.
        if (restrictToCurrentMonth)
        {
            var today = DateTime.Today;
            var current = months.FirstOrDefault(m => m.Month == today.Month && m.CalendarYear == today.Year);
            if (current == null || current.Month != month)
                throw new InvalidOperationException("You can only edit the current month.");
        }

        // Only the category's own monthly (collected) fields may be written. Club/District admins
        // (restrictToCurrentMonth) cannot write the imported Foundation months; SuperAdmin still can.
        var monthlyKeys = MonthlyCollectedToTarget.Keys
            .Where(k => !restrictToCurrentMonth || !ImportedMonthlyFieldKeys.Contains(k)).ToArray();
        var validFieldIds = (await conn.QueryAsync<int>(@"
            SELECT f.pk_field_id FROM goal_fields f
            WHERE f.fk_category_id = @Cat AND f.isdeleted = 0 AND f.FieldKey IN @Keys",
            new { Cat = categoryId, Keys = monthlyKeys })).ToHashSet();

        foreach (var e in entries)
        {
            if (!validFieldIds.Contains(e.FieldId)) continue;
            await conn.ExecuteAsync(@"
                INSERT INTO goal_entries_monthly
                    (fk_field_id, fk_year_id, EntityType, fk_club_id, fk_district_id, PeriodMonth, NumericValue, created_by, created_date, isdeleted)
                VALUES (@F, @Y, @E, @C, @D, @M, @V, @By, NOW(), 0)
                ON DUPLICATE KEY UPDATE NumericValue = @V, modified_by = @By, modified_date = NOW(), isdeleted = 0",
                new { F = e.FieldId, Y = yearId, E = entityType, C = clubId, D = districtId, M = month, V = e.NumericValue, By = memberId });
        }
    }

    // Snapshot the CURRENT month's collected/achieved values into goal_entries_monthly. Called from the
    // normal (annual) Save so the month-wise table fills as a side-effect — the annual "till date" save
    // is untouched. The month is the real current calendar month, and only when TODAY is inside the saved
    // Rotary year (so we never stamp a month onto a past/future year). Re-saving the same month overwrites it.
    private async Task SnapshotCurrentMonthAsync(MySqlConnection conn, int categoryId, int yearId, string entityType, int clubId, int districtId, int memberId)
    {
        var yr = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT StartDate AS s, EndDate AS e FROM rotary_year_master WHERE pk_year_id = @Y AND isdeleted = 0", new { Y = yearId });
        if (yr == null || yr.s == null || yr.e == null) return;
        var today = DateTime.Today;
        if (today < (DateTime)yr.s || today > (DateTime)yr.e) return;   // not the current Rotary year → no snapshot
        int month = today.Month;

        // Current collected/achieved values (live-injected), for the monthly-tracked fields of this category.
        var fields = await LoadFieldsWithValuesAsync(conn, categoryId, yearId, entityType, clubId, districtId, autoFillLive: true);
        foreach (var f in fields)
        {
            if (!MonthlyCollectedToTarget.ContainsKey(f.FieldKey)) continue;
            await conn.ExecuteAsync(@"
                INSERT INTO goal_entries_monthly
                    (fk_field_id, fk_year_id, EntityType, fk_club_id, fk_district_id, PeriodMonth, NumericValue, created_by, created_date, isdeleted)
                VALUES (@F, @Y, @E, @C, @D, @M, @V, @By, NOW(), 0)
                ON DUPLICATE KEY UPDATE NumericValue = @V, modified_by = @By, modified_date = NOW(), isdeleted = 0",
                new { F = f.FieldId, Y = yearId, E = entityType, C = clubId, D = districtId, M = month, V = f.NumericValue, By = memberId });
        }
    }

    // ── District month-wise ──────────────────────────────────────────────
    public async Task<GoalMonthlyFormDto?> GetDistrictMonthlyGoalFormAsync(int memberId, int categoryId, int? yearId, int? requestedDistrictId, bool readOnly = false)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        // Youth Service / Public Image have no month-wise concept at all (user 2026-09-25).
        if (await IsAnnualOnlyCategoryAsync(conn, categoryId)) return null;
        var districtId = await ResolveDistrictIdAsync(conn, memberId, requestedDistrictId);
        if (districtId == 0) return null;
        var (resolvedYearId, _, _) = await ResolveYearAsync(conn, yearId);
        if (resolvedYearId == 0) return null;
        var name = await conn.ExecuteScalarAsync<string>(
            "SELECT DistrictNumber FROM district_master WHERE pk_district_id = @Id", new { Id = districtId }) ?? "";
        return await BuildMonthlyFormAsync(conn, categoryId, resolvedYearId, "District", 0, districtId, name, !readOnly);
    }

    // Goal Overview (SuperAdmin) read-only month-wise for ANY district — NOT gated on the district-admin
    // role. Used by the row-click popup so every district opens.
    public async Task<GoalMonthlyFormDto?> GetDistrictMonthlyGoalFormScopedAsync(int memberId, int categoryId, int? yearId, int districtId)
    {
        if (districtId <= 0) return null;
        using var conn = CreateConnection();
        await conn.OpenAsync();
        // Youth Service / Public Image have no month-wise concept at all (user 2026-09-25).
        if (await IsAnnualOnlyCategoryAsync(conn, categoryId)) return null;

        if (!await ClubAdminAccessHelper.IsSuperAdminAsync(conn, memberId))
            throw new UnauthorizedAccessException("This district is outside your goal-setting scope.");

        var (resolvedYearId, _, _) = await ResolveYearAsync(conn, yearId);
        if (resolvedYearId == 0) return null;
        var name = await conn.ExecuteScalarAsync<string>(
            "SELECT DistrictNumber FROM district_master WHERE pk_district_id = @Id", new { Id = districtId }) ?? "";
        return await BuildMonthlyFormAsync(conn, categoryId, resolvedYearId, "District", 0, districtId, name, false);
    }

    public async Task<GoalMonthlyFormDto> SaveDistrictMonthlyGoalsAsync(int memberId, int categoryId, SaveGoalMonthlyRequest request, int? requestedDistrictId)
    {
        if (request.YearId <= 0) throw new InvalidOperationException("yearId required");
        using var conn = CreateConnection();
        await conn.OpenAsync();
        // Youth Service / Public Image have no month-wise concept at all (user 2026-09-25).
        if (await IsAnnualOnlyCategoryAsync(conn, categoryId))
            throw new InvalidOperationException("This category is annual only - it has no month-wise entry.");
        var districtId = await ResolveDistrictIdAsync(conn, memberId, requestedDistrictId);
        if (districtId == 0) throw new UnauthorizedAccessException("No district admin assignment found.");
        var isSuperAdmin = await ClubAdminAccessHelper.IsSuperAdminAsync(conn, memberId);
        await SaveMonthlyCoreAsync(conn, categoryId, request.YearId, "District", 0, districtId, request.Month, request.Entries, memberId, restrictToCurrentMonth: !isSuperAdmin);
        return (await GetDistrictMonthlyGoalFormAsync(memberId, categoryId, request.YearId, districtId))!;
    }

    // ── Save the SPLIT of the yearly target (user 2026-09-25) ───────────────────────────────────
    // The yearly target is never sent and never written here. The 12 monthly figures are, and they
    // must add up to that yearly target EXACTLY - no less, no more. A quarter is spread across its
    // own three months (last month absorbs the remainder) and never leaks into another quarter.
    private async Task SaveTargetSplitCoreAsync(
        MySqlConnection conn, int categoryId, int yearId, string entityType, int clubId, int districtId,
        SaveGoalTargetSplitRequest req, int memberId, GoalMonthlyFormDto form)
    {
        bool byQuarter = string.Equals(req.Period, "quarter", StringComparison.OrdinalIgnoreCase);
        var byField = form.Fields.Where(f => f.MonthlyTracked).ToDictionary(f => f.FieldId);
        var monthOrder = form.Months.Select(m => m.Month).ToList();

        var toWrite = new Dictionary<int, Dictionary<int, decimal?>>();   // fieldId -> month -> target
        var errors = new List<GoalTargetSplitErrorDto>();
        var negatives = new List<string>();  // "Total Members: Jan, Feb" — reported before the sum check

        foreach (var incoming in req.Fields)
        {
            if (!byField.TryGetValue(incoming.FieldId, out var fld)) continue;

            var months = new Dictionary<int, decimal?>();
            if (byQuarter)
            {
                foreach (var q in Enumerable.Range(1, 4))
                {
                    incoming.Values.TryGetValue(q, out var qv);
                    var spread = SpreadTarget(qv ?? 0m, QuarterMonths[q - 1].Length, IsWholeNumberMetric(fld.DataType));
                    for (int i = 0; i < QuarterMonths[q - 1].Length; i++)
                        months[QuarterMonths[q - 1][i]] = qv.HasValue ? spread[i] : (decimal?)null;
                }
            }
            else
            {
                foreach (var m in monthOrder)
                    months[m] = incoming.Values.TryGetValue(m, out var v) ? v : null;
            }

            // A target of 0 is legitimate — a club may plan nothing this quarter and everything the
            // next. A NEGATIVE one is not: it reads as "we plan to lose 40 members", and because the
            // only rule here was the SUM, -40/40/40/4 balanced exactly like 11/11/11/11 and saved
            // (user 2026-09-29). It then poisons the reports, whose percentage divides by this target.
            // Checked here as well as in the browser so a hand-made payload cannot get through.
            var negative = months.Where(kv => kv.Value is < 0m).Select(kv => kv.Key).ToList();
            if (negative.Count > 0)
                negatives.Add($"{MonthlyMetricLabel(fld)}: {string.Join(", ", negative.Select(m => RotaryMonthLabels[m - 1]))}");

            // The whole point of the feature: the split must equal the year.
            if (fld.SplitBase.HasValue)
            {
                decimal entered = months.Values.Sum(v => v ?? 0m);
                if (entered != fld.SplitBase.Value)
                    errors.Add(new GoalTargetSplitErrorDto
                    {
                        FieldId = fld.FieldId, FieldLabel = fld.FieldLabel,
                        AnnualTarget = fld.SplitBase.Value, Entered = entered,
                        Difference = entered - fld.SplitBase.Value,
                    });
            }
            toWrite[incoming.FieldId] = months;
        }

        if (negatives.Count > 0)
            throw new InvalidOperationException(
                "A quarterly or month-wise target cannot be negative (0 is allowed). " + string.Join(" | ", negatives));

        if (errors.Count > 0)
        {
            var lines = errors.Select(e =>
            {
                var d = e.Difference > 0 ? $"{e.Difference:0.##} too much" : $"{-e.Difference:0.##} short";
                return $"{e.FieldLabel}: yearly target {e.AnnualTarget:0.##}, entered {e.Entered:0.##} ({d})";
            });
            throw new InvalidOperationException(
                "The split must add up to the yearly target exactly. " + string.Join(" | ", lines));
        }

        foreach (var (fieldId, months) in toWrite)
            foreach (var (month, val) in months)
                await conn.ExecuteAsync(@"
                    INSERT INTO goal_entries_monthly
                        (fk_field_id, fk_year_id, EntityType, fk_club_id, fk_district_id, PeriodMonth,
                         TargetValue, created_by, created_date, isdeleted)
                    VALUES (@F, @Y, @E, @C, @D, @M, @T, @By, NOW(), 0)
                    ON DUPLICATE KEY UPDATE TargetValue = VALUES(TargetValue),
                        modified_by = @By, modified_date = NOW(), isdeleted = 0",
                    new { F = fieldId, Y = yearId, E = entityType, C = clubId, D = districtId, M = month,
                          T = val, By = memberId });
    }

    public async Task<GoalMonthlyFormDto> SaveDistrictTargetSplitAsync(
        int memberId, int categoryId, SaveGoalTargetSplitRequest req, int? requestedDistrictId)
    {
        if (req.YearId <= 0) throw new InvalidOperationException("yearId required");
        using var conn = CreateConnection();
        await conn.OpenAsync();
        if (await IsAnnualOnlyCategoryAsync(conn, categoryId))
            throw new InvalidOperationException("This category is annual only - it has no quarterly or month-wise target.");
        var districtId = await ResolveDistrictIdAsync(conn, memberId, requestedDistrictId);
        if (districtId == 0) throw new UnauthorizedAccessException("No district admin assignment found.");
        if (!GoalTargetSplitPilot.AllowsDistrict(districtId))
            throw new InvalidOperationException(GoalTargetSplitPilot.NotInPilotMessage);
        var (resolvedYearId, _, isEditable) = await ResolveYearAsync(conn, req.YearId);
        if (!isEditable) throw new InvalidOperationException("Past years are read-only and cannot be edited.");

        var form = await GetDistrictMonthlyGoalFormAsync(memberId, categoryId, resolvedYearId, districtId)
                   ?? throw new InvalidOperationException("No month-wise metrics for this category.");
        await SaveTargetSplitCoreAsync(conn, categoryId, resolvedYearId, "District", 0, districtId, req, memberId, form);
        return (await GetDistrictMonthlyGoalFormAsync(memberId, categoryId, resolvedYearId, districtId))!;
    }

    public async Task<GoalMonthlyFormDto> SaveClubTargetSplitAsync(
        int memberId, int categoryId, SaveGoalTargetSplitRequest req, int? requestedClubId)
    {
        if (req.YearId <= 0) throw new InvalidOperationException("yearId required");
        using var conn = CreateConnection();
        await conn.OpenAsync();
        if (await IsAnnualOnlyCategoryAsync(conn, categoryId))
            throw new InvalidOperationException("This category is annual only - it has no quarterly or month-wise target.");
        var clubId = await ResolveClubIdAsync(conn, memberId, requestedClubId);
        if (clubId == 0) throw new UnauthorizedAccessException("No club admin assignment found.");
        if (!GoalTargetSplitPilot.AllowsClub(clubId))
            throw new InvalidOperationException(GoalTargetSplitPilot.NotInPilotMessage);
        var (resolvedYearId, _, isEditable) = await ResolveYearAsync(conn, req.YearId);
        if (!isEditable) throw new InvalidOperationException("Past years are read-only and cannot be edited.");

        var form = await GetClubMonthlyGoalFormAsync(memberId, categoryId, resolvedYearId, clubId)
                   ?? throw new InvalidOperationException("No month-wise metrics for this category.");
        await SaveTargetSplitCoreAsync(conn, categoryId, resolvedYearId, "Club", clubId, 0, req, memberId, form);
        return (await GetClubMonthlyGoalFormAsync(memberId, categoryId, resolvedYearId, clubId))!;
    }

    // ── Club month-wise ──────────────────────────────────────────────────
    public async Task<GoalMonthlyFormDto?> GetClubMonthlyGoalFormAsync(int memberId, int categoryId, int? yearId, int? requestedClubId, bool readOnly = false)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        // Youth Service / Public Image have no month-wise concept at all (user 2026-09-25).
        if (await IsAnnualOnlyCategoryAsync(conn, categoryId)) return null;
        var clubId = await ResolveClubIdAsync(conn, memberId, requestedClubId);
        if (clubId == 0) return null;
        var (resolvedYearId, _, _) = await ResolveYearAsync(conn, yearId);
        if (resolvedYearId == 0) return null;
        var name = await conn.ExecuteScalarAsync<string>(
            "SELECT ClubName FROM club_master WHERE pk_club_id = @Id AND isdeleted = 0", new { Id = clubId }) ?? "";
        return await BuildMonthlyFormAsync(conn, categoryId, resolvedYearId, "Club", clubId, 0, name, !readOnly);
    }

    public async Task<GoalMonthlyFormDto> SaveClubMonthlyGoalsAsync(int memberId, int categoryId, SaveGoalMonthlyRequest request, int? requestedClubId)
    {
        if (request.YearId <= 0) throw new InvalidOperationException("yearId required");
        using var conn = CreateConnection();
        await conn.OpenAsync();
        // Youth Service / Public Image have no month-wise concept at all (user 2026-09-25).
        if (await IsAnnualOnlyCategoryAsync(conn, categoryId))
            throw new InvalidOperationException("This category is annual only - it has no month-wise entry.");
        var clubId = await ResolveClubIdAsync(conn, memberId, requestedClubId);
        if (clubId == 0) throw new UnauthorizedAccessException("No club admin assignment found.");
        var isSuperAdmin = await ClubAdminAccessHelper.IsSuperAdminAsync(conn, memberId);
        await SaveMonthlyCoreAsync(conn, categoryId, request.YearId, "Club", clubId, 0, request.Month, request.Entries, memberId, restrictToCurrentMonth: !isSuperAdmin);
        return (await GetClubMonthlyGoalFormAsync(memberId, categoryId, request.YearId, clubId))!;
    }

    // ── Month-wise Excel (2 sheets: "Till Date" simple + "Month wise") ──────────────
    private static string MonthlyMetricLabel(GoalMonthlyFieldDto f) => f.FieldLabel == "Achieved" ? f.GroupName : f.FieldLabel;

    // ALL four categories in one workbook: two sheets ("Till Date" + "Month wise"), each with a bold
    // category header before that category's metric rows. `forms` is one monthly form per category.
    private static byte[] BuildMultiCategoryExcel(List<GoalMonthlyFormDto> forms)
    {
        var first = forms[0];
        var months = first.Months;
        using var wb = new ClosedXML.Excel.XLWorkbook();

        // Sheet 1 — Till Date (simple).
        var s1 = wb.Worksheets.Add("Till Date");
        s1.Cell(1, 1).Value = $"Goals — Till Date · {first.EntityName} · RY {first.YearLabel}";
        s1.Range(1, 1, 1, 4).Merge().Style.Font.SetBold();
        s1.Cell(2, 1).Value = "Particulars"; s1.Cell(2, 2).Value = "Collected (to date)";
        s1.Cell(2, 3).Value = "Target"; s1.Cell(2, 4).Value = "% Achieved";
        s1.Row(2).Style.Font.SetBold();
        int r = 3;
        foreach (var form in forms)
        {
            s1.Cell(r, 1).Value = form.CategoryName;
            s1.Range(r, 1, r, 4).Merge().Style.Font.SetBold().Fill.SetBackgroundColor(ClosedXML.Excel.XLColor.LightGray);
            r++;
            foreach (var f in form.Fields)
            {
                s1.Cell(r, 1).Value = MonthlyMetricLabel(f);
                s1.Cell(r, 2).Value = (double)f.Total;
                if (f.AnnualTarget.HasValue) s1.Cell(r, 3).Value = (double)f.AnnualTarget.Value;
                if (f.AnnualTarget is > 0m) s1.Cell(r, 4).Value = (double)Math.Round(f.Total / f.AnnualTarget.Value * 100m, IsTrfCategory(form.CategoryName) ? 2 : 0, MidpointRounding.AwayFromZero);
                r++;
            }
        }
        s1.Columns(1, 4).AdjustToContents();

        // Sheet 2 — Quarter (user 2026-09-25): the yearly target split across Q1-Q4 with what each
        // quarter achieved. Annual-only categories are skipped, as on the Month wise sheet below.
        var sq = wb.Worksheets.Add("Quarter");
        string[] qLbl = { "Q1 · Jul-Sep", "Q2 · Oct-Dec", "Q3 · Jan-Mar", "Q4 · Apr-Jun" };
        sq.Cell(1, 1).Value = $"Goals — Quarter · {first.EntityName} · RY {first.YearLabel}";
        sq.Range(1, 1, 1, 10).Merge().Style.Font.SetBold();
        sq.Cell(2, 1).Value = "Particulars";
        sq.Cell(2, 2).Value = "Yearly target";
        for (int i = 0; i < 4; i++)
        {
            sq.Cell(2, 3 + i * 2).Value = qLbl[i] + " target";
            sq.Cell(2, 4 + i * 2).Value = qLbl[i] + " achieved";
        }
        sq.Row(2).Style.Font.SetBold();
        int rq = 3;
        foreach (var form in forms)
        {
            if (IsAnnualOnlyCategory(form.CategoryName)) continue;
            sq.Cell(rq, 1).Value = form.CategoryName;
            sq.Range(rq, 1, rq, 10).Merge().Style.Font.SetBold().Fill.SetBackgroundColor(ClosedXML.Excel.XLColor.LightGray);
            rq++;
            foreach (var f in form.Fields.Where(x => x.MonthlyTracked))
            {
                sq.Cell(rq, 1).Value = MonthlyMetricLabel(f);
                if (f.AnnualTarget.HasValue) sq.Cell(rq, 2).Value = (double)f.AnnualTarget.Value;
                for (int q = 1; q <= 4; q++)
                {
                    if (f.QuarterlyTargets.TryGetValue(q, out var qt) && qt.HasValue)
                        sq.Cell(rq, 1 + q * 2).Value = (double)qt.Value;
                    if (f.QuarterlyAchieved.TryGetValue(q, out var qa) && qa.HasValue)
                        sq.Cell(rq, 2 + q * 2).Value = (double)qa.Value;
                }
                rq++;
            }
        }
        sq.Columns(1, 10).AdjustToContents();

        // Sheet 3 — Month wise.
        var s2 = wb.Worksheets.Add("Month wise");
        int totalCols = 1 + months.Count + 2;
        s2.Cell(1, 1).Value = $"Goals — Month wise · {first.EntityName} · RY {first.YearLabel}";
        s2.Range(1, 1, 1, Math.Max(1, totalCols)).Merge().Style.Font.SetBold();
        s2.Cell(2, 1).Value = "Particulars";
        int c = 2;
        foreach (var m in months) { s2.Cell(2, c).Value = m.Label; c++; }
        s2.Cell(2, c).Value = "Total"; s2.Cell(2, c + 1).Value = "Target";
        s2.Row(2).Style.Font.SetBold();
        r = 3;
        foreach (var form in forms)
        {
            // Annual-only categories never reach a Month wise sheet (user 2026-09-25).
            if (IsAnnualOnlyCategory(form.CategoryName)) continue;
            s2.Cell(r, 1).Value = form.CategoryName;
            s2.Range(r, 1, r, Math.Max(1, totalCols)).Merge().Style.Font.SetBold().Fill.SetBackgroundColor(ClosedXML.Excel.XLColor.LightGray);
            r++;
            foreach (var f in form.Fields)
            {
                s2.Cell(r, 1).Value = MonthlyMetricLabel(f);
                c = 2;
                foreach (var m in months)
                {
                    if (f.Monthly.TryGetValue(m.Month, out var v) && v.HasValue) s2.Cell(r, c).Value = (double)v.Value;
                    c++;
                }
                s2.Cell(r, c).Value = (double)f.Total;
                if (f.AnnualTarget.HasValue) s2.Cell(r, c + 1).Value = (double)f.AnnualTarget.Value;
                r++;
            }
        }
        s2.Columns(1, Math.Max(1, totalCols)).AdjustToContents();

        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }

    // District/Club ADMIN report-section export — the same attractive YTD + Month-wise workbook as the
    // oversight reports (no Messages sheet; admins have no messaging). Scope via ResolveDistrictIdAsync /
    // ResolveClubIdAsync. (categoryId is ignored — the report always spans all 4 categories.)
    public async Task<byte[]?> BuildDistrictMonthlyExcelAsync(int memberId, int categoryId, int? yearId, int? requestedDistrictId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var districtId = await ResolveDistrictIdAsync(conn, memberId, requestedDistrictId);
        if (districtId == 0) return null;
        var (resolvedYearId, yearLabel, isEditable) = await ResolveYearAsync(conn, yearId);
        if (resolvedYearId == 0) return null;
        var num = await conn.ExecuteScalarAsync<string>(
            "SELECT DistrictNumber FROM district_master WHERE pk_district_id = @Id", new { Id = districtId }) ?? "";
        var wb = await RenderEntityWorkbookAsync(conn, "District", 0, districtId, resolvedYearId,
            $"District {num}", $"Rotary Year {yearLabel}   ·   Generated {DateTime.Now:dd MMM yyyy, hh:mm tt}", isEditable);
        return wb == null ? null : SaveAndDispose(wb);
    }

    // Goal Overview (SuperAdmin) per-district download: renders the EXACT same "District Goal Setting"
    // workbook as BuildDistrictMonthlyExcelAsync, but checks for the SuperAdmin instead of the district-admin
    // role. Kept separate so the district-admin path (goals-excel/districts) is untouched.
    public async Task<byte[]?> BuildDistrictGoalSettingReportScopedAsync(int memberId, int districtId, int? yearId)
    {
        if (districtId <= 0) return null;
        using var conn = CreateConnection();
        await conn.OpenAsync();

        if (!await ClubAdminAccessHelper.IsSuperAdminAsync(conn, memberId))
            throw new UnauthorizedAccessException("This district is outside your goal-setting scope.");

        var (resolvedYearId, yearLabel, isEditable) = await ResolveYearAsync(conn, yearId);
        if (resolvedYearId == 0) return null;
        var num = await conn.ExecuteScalarAsync<string>(
            "SELECT DistrictNumber FROM district_master WHERE pk_district_id = @Id", new { Id = districtId }) ?? "";
        var wb = await RenderEntityWorkbookAsync(conn, "District", 0, districtId, resolvedYearId,
            $"District {num}", $"Rotary Year {yearLabel}   ·   Generated {DateTime.Now:dd MMM yyyy, hh:mm tt}", isEditable,
            dropYouthPct: true);
        return wb == null ? null : SaveAndDispose(wb);
    }

    public async Task<byte[]?> BuildClubMonthlyExcelAsync(int memberId, int categoryId, int? yearId, int? requestedClubId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var clubId = await ResolveClubIdAsync(conn, memberId, requestedClubId);
        if (clubId == 0) return null;
        var (resolvedYearId, yearLabel, isEditable) = await ResolveYearAsync(conn, yearId);
        if (resolvedYearId == 0) return null;
        var row = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT c.ClubName AS name, d.DistrictNumber AS num FROM club_master c LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id WHERE c.pk_club_id = @Id AND c.isdeleted = 0",
            new { Id = clubId });
        if (row == null) return null;
        string clubName = (row.name as string) ?? $"Club {clubId}";
        string dnum = (row.num as string) ?? "";
        var wb = await RenderEntityWorkbookAsync(conn, "Club", clubId, 0, resolvedYearId,
            clubName, $"District {dnum}   ·   Rotary Year {yearLabel}   ·   Generated {DateTime.Now:dd MMM yyyy, hh:mm tt}", isEditable);
        return wb == null ? null : SaveAndDispose(wb);
    }

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // ATTRACTIVE GOAL REPORTS (zone / district / club) — print-friendly workbooks styled like the Club
    // Analytics report. Sheets: "YTD (Till Date)" (As on Jul 1 · Target · Achieved · % Achieved, all 4
    // categories), "Month wise" (Jul→Jun + Total + Target), and "Messages" (on district/zone reports).
    // Scope-enforced per caller; SuperAdmin unrestricted.
    // ══════════════════════════════════════════════════════════════════════════════════════════════

    // The 3 Membership metrics carry an "as on July 1st" baseline; the other categories do not.
    private static readonly Dictionary<string, string> MembershipBaselineKey = new(StringComparer.Ordinal)
    {
        ["new_clubs_achieved"]         = "total_clubs",
        ["new_members_achieved"]       = "total_members",
        ["new_women_members_achieved"] = "existing_women_members",
    };

    // TRF (district): each fund's "Highest" is shown as the reference column IN FRONT of the target —
    // Highest · Target for the Current year · Achieved · Percentage Achieved (2026-09-16 request).
    // DISPLAY ONLY. It deliberately does NOT go through MembershipBaselineKey, because that map also
    // drives ComputePct's `membership` flag: TRF must keep % = Achieved ÷ Target, never (Ach−Highest)
    // ÷ (Target−Highest).
    private static readonly Dictionary<string, string> TrfHighestKey = new(StringComparer.Ordinal)
    {
        ["annual_fund_achieved"] = "annual_fund_highest",
        ["polio_plus_achieved"]  = "polio_plus_highest",
        ["endowment_achieved"]   = "endowment_highest",
        ["csr_achieved"]         = "csr_highest",
        ["total_giving_achieved"] = "total_contributions_highest",
    };

    private static readonly XLColor RepNavy    = XLColor.FromHtml("#1a365d");
    private static readonly XLColor RepBlue    = XLColor.FromHtml("#2d7fc7");
    private static readonly XLColor RepLabelBg = XLColor.FromHtml("#f1f5f9");
    private static readonly XLColor RepHeadBg  = XLColor.FromHtml("#e2e8f0");
    private static readonly XLColor RepBorder  = XLColor.FromHtml("#cbd5e1");
    private static readonly XLColor RepInk     = XLColor.FromHtml("#1e293b");

    private sealed class GoalMetricComputed
    {
        public bool TwoDecimalPct;         // TRF / Foundation: every % shown with 2 decimals (user 2026-10-07)
        public string Label = "";
        public string GroupName = "";      // metric group ("New Clubs" / "Total Members" / "Women Membership")
        public string BaselineLabel = "";  // exact "as on July 1st" field label, matches the district admin form
        public decimal? Baseline;   // "as on Jul 1" (Membership only, else null)
        public bool HasBaseline;    // false → the report drops the "As on Jul 1" column for this metric (TRF etc.)
        public string? DisplayText; // Public Image Yes/No + Suggestions text — printed in the Target column
        // TRF only: Baseline carries the fund's "Highest" — a REFERENCE figure for comparison, NOT a
        // July-1st opening amount. So it must never be subtracted in a percentage, and month-wise
        // cumulative totals must start from 0 rather than from Highest (2026-09-16).
        public bool BaselineIsReferenceOnly;
        public bool SingleValue;    // Public Image: ONE column holding the value, no Target/Achieved/% block
        public string FieldKey = ""; // the goal_fields key this row came from
        public bool MonthlyTracked = true; // false → annual-only row: listed month-wise with EMPTY month cells,
                                           // and left out of the YTD sheets (which are unchanged).
        public decimal? Target;
        public decimal? Achieved;   // to date
        public decimal? Pct;
        public decimal MonthTotal;  // Σ of the monthly cells (gained this year for Membership; YTD total for others)
        public Dictionary<int, decimal?> Monthly = new();
        // Months this row has no data for yet (TRF: after the last imported month). Sheets that share one
        // month header across categories leave these cells blank, like a future month.
        public HashSet<int> ClosedMonths = new();
        // The yearly target SPLIT (user 2026-09-25). Target above is still the yearly figure and is
        // untouched; these are that year spread over the months, and each quarter's share of it.
        public decimal? SplitBase;  // what the split totals: Target - Baseline for Membership, Target for TRF
        public Dictionary<int, decimal?> MonthlyTargets = new();    // month 7..6
        public bool TargetsSuggested;      // MonthlyTargets is the auto spread, not a split the admin saved
        public Dictionary<int, decimal?> QuarterlyTargets = new();  // quarter 1..4
        public Dictionary<int, decimal?> QuarterlyAchieved = new(); // quarter 1..4
    }

    private static byte[] SaveAndDispose(XLWorkbook wb)
    {
        using (wb) { using var ms = new MemoryStream(); wb.SaveAs(ms); return ms.ToArray(); }
    }

    private async Task<Dictionary<string, decimal?>> LiveValuesByKeyAsync(
        MySqlConnection conn, int categoryId, int yearId, string entityType, int clubId, int districtId, bool autoFillLive)
    {
        var fields = await LoadFieldsWithValuesAsync(conn, categoryId, yearId, entityType, clubId, districtId, autoFillLive);
        var dict = new Dictionary<string, decimal?>(StringComparer.Ordinal);
        foreach (var f in fields) dict[f.FieldKey] = f.NumericValue;
        return dict;
    }

    private static decimal? DeriveAchievedFromMonthly(GoalMonthlyFieldDto f, List<GoalMonthPeriodDto> months, bool cumulative)
    {
        if (cumulative)   // Membership snapshots the cumulative value each month → take the latest one.
        {
            decimal? last = null;
            foreach (var mo in months) if (f.Monthly.TryGetValue(mo.Month, out var v) && v.HasValue) last = v;
            return last;
        }
        return f.Total;   // TRF (YTD deltas) / Youth / Public Image (activity counts) → sum.
    }

    // The Foundation category is stored as "TRF" but SHOWN as "Foundation" in Goal Setting (user
    // 2026-10-09) - every name read for display returns "Foundation", so checks accept both.
    private static bool IsTrfCategory(string? name) =>
        string.Equals(name, "TRF", StringComparison.OrdinalIgnoreCase)
        || string.Equals(name, "Foundation", StringComparison.OrdinalIgnoreCase);

    private static decimal? ComputePct(decimal? baseline, decimal? target, decimal? achieved, bool membership, int decimals = 1)
    {
        if (target is null || target.Value <= 0m) return 0m;           // no target → 0%
        decimal ach = achieved ?? 0m;
        if (membership)
        {
            decimal b = baseline ?? 0m;
            decimal planned = target.Value - b;
            if (planned <= 0m) return 0m;
            return Math.Max(0m, Math.Min(100m, Math.Round((ach - b) / planned * 100m, 1)));
        }
        return Math.Max(0m, Math.Min(100m, Math.Round(ach / target.Value * 100m, decimals)));
    }

    // One category's metric rows for one entity, with baseline / target / achieved / % resolved.
    private async Task<(string CategoryName, List<GoalMetricComputed> Rows, List<GoalMonthPeriodDto> Months)>
        ComputeCategoryMetricsAsync(MySqlConnection conn, int categoryId, int yearId, string entityType, int clubId, int districtId, bool autoFillLive)
    {
        var form = await BuildMonthlyFormAsync(conn, categoryId, yearId, entityType, clubId, districtId, "", false);
        if (form == null || form.Fields.Count == 0)
            return ("", new List<GoalMetricComputed>(), new List<GoalMonthPeriodDto>());
        // Load the fields once to get BOTH values and labels (so the report headers can carry the exact
        // baseline field label — "Total No of Clubs as on July 1st" — matching the district admin form).
        var fieldList = await LoadFieldsWithValuesAsync(conn, categoryId, yearId, entityType, clubId, districtId, autoFillLive);
        var live = new Dictionary<string, decimal?>(StringComparer.Ordinal);
        var labelByKey = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var fv in fieldList) { live[fv.FieldKey] = fv.NumericValue; labelByKey[fv.FieldKey] = fv.FieldLabel; }
        var rows = new List<GoalMetricComputed>();
        var closedMonths = form.Months.Where(m => !m.IsAvailable).Select(m => m.Month).ToHashSet();
        foreach (var f in form.Fields)
        {
            bool hasBaseline = MembershipBaselineKey.TryGetValue(f.FieldKey, out var baseKey);
            decimal? baseline = hasBaseline && live.TryGetValue(baseKey!, out var bv) ? bv : (decimal?)null;
            // TRF only: show the fund's "Highest" in the reference column before the Target. Display
            // only — `hasBaseline` (the ComputePct membership switch) stays false, so the percentage
            // still divides by the Target.
            // (TryGetValue runs unconditionally: short-circuiting it behind !hasBaseline leaves highKey
            // "unassigned" as far as the compiler is concerned — CS0165.)
            bool hasHighKey = TrfHighestKey.TryGetValue(f.FieldKey, out var highKey);
            bool trfHighest = !hasBaseline && hasHighKey;
            decimal? highestVal = trfHighest && live.TryGetValue(highKey!, out var hv) ? hv : (decimal?)null;
            decimal? target = null;
            bool ownTarget = false;   // Youth Service / Public Image: the typed figure IS the target
            if (MonthlyCollectedToTarget.TryGetValue(f.FieldKey, out var tKey))
            {
                if (!string.IsNullOrEmpty(tKey)) { if (live.TryGetValue(tKey, out var tv)) target = tv; }
                else ownTarget = true;   // mapped to "" = no separate target field (see the map)
            }
            target ??= f.AnnualTarget;
            decimal? achieved = live.TryGetValue(f.FieldKey, out var av) && av.HasValue
                ? av : DeriveAchievedFromMonthly(f, form.Months, hasBaseline);
            // Without this, "Proposed New Rotaract Clubs" / "No of Press Meet" printed the typed figure
            // under ACHIEVED with an empty Target and 0% — every Youth/Public Image row read as 0%.
            if (ownTarget) { target = achieved ?? target; achieved = null; }
            var baselineLabel = hasBaseline && labelByKey.TryGetValue(baseKey!, out var bl) && !string.IsNullOrWhiteSpace(bl)
                ? bl
                : trfHighest ? "Highest" : "As on July 1st";
            rows.Add(new GoalMetricComputed
            {
                FieldKey = f.FieldKey,
                MonthlyTracked = f.MonthlyTracked,
                DisplayText = f.DisplayText,
                Label = MonthlyMetricLabel(f),
                GroupName = string.IsNullOrWhiteSpace(f.GroupName) ? MonthlyMetricLabel(f) : f.GroupName,
                BaselineLabel = baselineLabel,
                Baseline = f.Baseline ?? baseline ?? highestVal, HasBaseline = hasBaseline || trfHighest,
                BaselineIsReferenceOnly = trfHighest, Target = target,
                Achieved = achieved, Pct = ComputePct(baseline, target, achieved, hasBaseline, IsTrfCategory(form.CategoryName) ? 2 : 1),
                TwoDecimalPct = IsTrfCategory(form.CategoryName),
                MonthTotal = f.Total, Monthly = f.Monthly,
                MonthlyTargets = f.MonthlyTargets, TargetsSuggested = f.TargetsAreSuggested, QuarterlyTargets = f.QuarterlyTargets,
                QuarterlyAchieved = f.QuarterlyAchieved, SplitBase = f.SplitBase,
                ClosedMonths = closedMonths,
            });
        }

        // TRF ONLY: Total Giving has no monthly-collected field (it is not in MonthlyCollectedToTarget),
        // so it never reached the YTD sheet — the report showed 4 funds while the district page shows 5
        // (2026-09-16 request). Append it here as a FULL metric built from the annual values, so every
        // report renders it exactly like the other funds: Highest · Target · Achieved · Percentage Achieved.
        // MonthlyTracked = true only so the YTD sheet keeps it; its month cells are empty by design.
        if (IsTrfCategory(form.CategoryName)
            && !rows.Any(x => x.FieldKey == "total_giving_achieved"))
        {
            decimal? TgVal(string key) => live.TryGetValue(key, out var v) ? v : null;
            rows.Add(new GoalMetricComputed
            {
                FieldKey = "total_giving_achieved",
                MonthlyTracked = true,
                Label = "Total Giving",
                GroupName = "Total Giving",
                BaselineLabel = "Highest",
                Baseline = TgVal("total_contributions_highest"),
                HasBaseline = true,
                BaselineIsReferenceOnly = true,
                Target = TgVal("total_contributions_target"),
                Achieved = TgVal("total_giving_achieved"),
                Pct = TgVal("total_giving_pct"),
                TwoDecimalPct = true,
                MonthTotal = 0m,
                Monthly = form.Months.ToDictionary(m => m.Month, _ => (decimal?)null),
                ClosedMonths = closedMonths,
            });
        }

        // PUBLIC IMAGE ONLY: the month-wise form carries just the 8 "Activities" counts, so the reports
        // never showed "Other Points" (Yes/No + the two %) or "Suggestions" at all. Append them from the
        // annual values so the report lists the same fields as the district form. No other category is
        // affected — every one of its fields is already a monthly metric.
        // PUBLIC IMAGE + YOUTH SERVICE: every field is a plain figure the admin types — there is no
        // target/achieved pair — so reports and the overview list ONE column per field, in the district
        // form's own order and with the form's own labels. The month-wise form carries only some of these
        // fields (Public Image's 8 Activities, Youth's 4 "Proposed New …"), so the rest are read from the
        // annual values here; otherwise "Existing Rotaract Clubs as on July 1st", "Total Clubs" etc. never
        // appeared in any report.
        if (string.Equals(form.CategoryName, "Public Image", StringComparison.OrdinalIgnoreCase)
            || string.Equals(form.CategoryName, "Youth Service", StringComparison.OrdinalIgnoreCase))
        {
            var byKey = new Dictionary<string, GoalMetricComputed>(StringComparer.Ordinal);
            foreach (var have in rows) if (!byKey.ContainsKey(have.FieldKey)) byKey[have.FieldKey] = have;

            var ordered = new List<GoalMetricComputed>();
            var suggestions = new List<string>();
            GoalMetricComputed? suggestionRow = null;
            foreach (var fv in fieldList)
            {
                // The 10 suggestion fields share one label → ONE column, numbered list inside.
                if (fv.GroupName.Equals("Suggestions", StringComparison.OrdinalIgnoreCase))
                {
                    if (!string.IsNullOrWhiteSpace(fv.TextValue)) suggestions.Add(fv.TextValue!.Trim());
                    if (suggestionRow == null)
                    {
                        suggestionRow = new GoalMetricComputed
                        {
                            FieldKey = "suggestions", Label = "Suggestions", GroupName = fv.GroupName,
                            BaselineLabel = "As on July 1st", HasBaseline = false, SingleValue = true,
                        };
                        ordered.Add(suggestionRow);
                    }
                    continue;
                }
                if (byKey.TryGetValue(fv.FieldKey, out var row))
                {
                    row.SingleValue = true; row.HasBaseline = false;
                    ordered.Add(row);
                }
                else
                {
                    ordered.Add(new GoalMetricComputed
                    {
                        FieldKey = fv.FieldKey, Label = fv.FieldLabel, GroupName = fv.GroupName,
                        BaselineLabel = "As on July 1st", HasBaseline = false, SingleValue = true,
                        Target = fv.DataType is "Boolean" or "Text" ? null : fv.NumericValue,
                        DisplayText = fv.DataType == "Boolean" ? (fv.BoolValue == null ? null : (fv.BoolValue.Value ? "Yes" : "No"))
                                    : fv.DataType == "Text" ? fv.TextValue
                                    : YouthPctText(fv),
                    });
                }
            }
            if (suggestionRow != null && suggestions.Count > 0)
                suggestionRow.DisplayText = string.Join("\n", suggestions.Select((s, i) => $"{i + 1}) {s}"));
            rows = ordered;
        }
        return (form.CategoryName, rows, form.Months);
    }

    // ── ClosedXML style helpers (property-style, matching BuildClubReportExcel) ──
    private static void SetNumCell(IXLCell cell, decimal? v)
    {
        if (v.HasValue) cell.Value = (double)v.Value; else cell.Value = "—";
        cell.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
    }
    private static void SetPctCell(IXLCell cell, decimal? v, bool twoDecimals = false)
    {
        // TRF: 2 decimals (3.35%); a whole figure stays whole (0%, 100%) - same as the screens.
        if (v.HasValue) { cell.Value = (double)v.Value; cell.Style.NumberFormat.Format = twoDecimals && v.Value != decimal.Truncate(v.Value) ? "0.00\"%\"" : "0\"%\""; }
        else cell.Value = "—";
        cell.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
    }
    private static void StyleHeaderCell(IXLCell cell)
    {
        cell.Style.Font.Bold = true;
        cell.Style.Font.FontColor = RepInk;
        cell.Style.Fill.BackgroundColor = RepHeadBg;
        cell.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
        cell.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
        cell.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
        cell.Style.Border.OutsideBorderColor = RepBorder;
    }
    private static void BorderRow(IXLWorksheet ws, int row, int cols)
    {
        var rng = ws.Range(row, 1, row, cols);
        rng.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
        rng.Style.Border.InsideBorder = XLBorderStyleValues.Thin;
        rng.Style.Border.OutsideBorderColor = RepBorder;
        rng.Style.Border.InsideBorderColor = RepBorder;
        ws.Cell(row, 1).Style.Font.Bold = true;
        ws.Cell(row, 1).Style.Fill.BackgroundColor = RepLabelBg;
    }
    private static void RenderTitleBand(IXLWorksheet ws, int cols, string title, string subtitle, ref int r)
    {
        ws.Range(r, 1, r, cols).Merge();
        var t = ws.Cell(r, 1);
        t.Value = title;
        t.Style.Font.Bold = true; t.Style.Font.FontSize = 18; t.Style.Font.FontColor = XLColor.White;
        t.Style.Fill.BackgroundColor = RepNavy;
        t.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
        t.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
        ws.Row(r).Height = 32; r++;
        ws.Range(r, 1, r, cols).Merge();
        var s = ws.Cell(r, 1);
        s.Value = subtitle;
        s.Style.Font.FontSize = 10; s.Style.Font.FontColor = XLColor.FromHtml("#475569");
        s.Style.Fill.BackgroundColor = XLColor.FromHtml("#eef2f7");
        s.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
        ws.Row(r).Height = 18; r++;
        r++; // spacer
    }
    private static void RenderSectionBand(IXLWorksheet ws, int cols, string label, ref int r)
    {
        ws.Range(r, 1, r, cols).Merge();
        var c = ws.Cell(r, 1);
        c.Value = label;
        c.Style.Font.Bold = true; c.Style.Font.FontColor = XLColor.White;
        c.Style.Fill.BackgroundColor = RepBlue;
        c.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
        ws.Row(r).Height = 20; r++;
    }

    // Build the attractive per-entity workbook (YTD + Month wise). Returns the OPEN workbook so the
    // caller can append a Messages sheet before saving. Null when the entity has no goal data.
    private async Task<XLWorkbook?> RenderEntityWorkbookAsync(
        MySqlConnection conn, string entityType, int clubId, int districtId, int yearId,
        string entityTitle, string subtitle, bool autoFillLive, bool dropYouthPct = false)
    {
        // The month the Foundation import covers, for the TRF "Achieved" heading below.
        var trfAsOn = await FoundationAsOnAsync(conn, yearId, entityType);
        var cats = await GetCategoriesAsync();
        var perCat = new List<(string Name, List<GoalMetricComputed> Rows, List<GoalMonthPeriodDto> Months)>();
        foreach (var cat in cats)
        {
            var (name, rows, months) = await ComputeCategoryMetricsAsync(conn, cat.Id, yearId, entityType, clubId, districtId, autoFillLive);
            if (rows.Count > 0) perCat.Add((string.IsNullOrEmpty(name) ? cat.Name : name, rows, months));
        }
        if (perCat.Count == 0) return null;
        if (dropYouthPct) DropYouthPct(perCat);
        var months0 = perCat.First(p => p.Months.Count > 0).Months;

        var wb = new XLWorkbook();

        // ── Sheet 1 — YTD (Till Date) ──
        var s1 = wb.Worksheets.Add("YTD (Till Date)");
        s1.Column(1).Width = 34;
        for (int i = 2; i <= 5; i++) s1.Column(i).Width = 15;
        int r = 1;
        RenderTitleBand(s1, 5, entityTitle, subtitle, ref r);
        WriteYtdBlock(s1, perCat, ref r, trfAsOn);
        s1.PageSetup.PageOrientation = XLPageOrientation.Landscape;
        s1.PageSetup.FitToPages(1, 0);
        s1.PageSetup.Margins.Top = 0.5; s1.PageSetup.Margins.Bottom = 0.5;
        s1.PageSetup.Margins.Left = 0.4; s1.PageSetup.Margins.Right = 0.4;
        s1.PageSetup.PrintAreas.Add($"A1:E{r - 1}");

        // ── Sheet 2 — Quarter (user 2026-09-25): the yearly target split across Q1-Q4, what was
        //    achieved in each quarter, and the %. Youth Service / Public Image are annual only and
        //    never appear here. The Till Date sheet above is untouched. ──
        var sq = wb.Worksheets.Add("Quarter");
        int qCols = 1 + 1 + 1 + 4;   // Metric · As on Jul 1 · Target · Q1..Q4
        sq.Column(1).Width = 30;
        r = 1;
        RenderTitleBand(sq, qCols, entityTitle, subtitle + "   ·   Quarter", ref r);
        WriteQuarterBlock(sq, perCat, qCols, ref r);
        sq.PageSetup.PageOrientation = XLPageOrientation.Landscape;
        sq.PageSetup.FitToPages(1, 0);
        sq.PageSetup.Margins.Top = 0.5; sq.PageSetup.Margins.Bottom = 0.5;
        if (r > 1) sq.PageSetup.PrintAreas.Add($"A1:{XLHelper.GetColumnLetterFromNumber(qCols)}{r - 1}");

        // ── Sheet 3 — Month wise (Achieved per month only; the yearly Target is NOT shown here — it
        //    belongs to the YTD sheet. Month-wise is purely the monthly collected/added values + Total) ──
        var s2 = wb.Worksheets.Add("Month wise");
        // District (user 2026-10-09): every month carries a Target | Achieved pair, metrics are rows -
        // the same grid as the Month-wise popup. Clubs keep the row-per-figure layout below.
        bool grid = entityType == "District";
        int totalCols = grid ? 1 + 1 + 1 + 2 * months0.Count + 2     // Metric · Jul 1 · Target · <month T|A> · Achieved · %
                             : 1 + 1 + 1 + months0.Count;            // Metric · As on Jul 1 · Target · <months>
        s2.Column(1).Width = 30;
        r = 1;
        RenderTitleBand(s2, totalCols, entityTitle, subtitle + "   ·   Month wise", ref r);
        if (grid) WriteMonthGridBlock(s2, perCat, ref r);
        else WriteMonthBlock(s2, perCat, totalCols, ref r);
        s2.PageSetup.PageOrientation = XLPageOrientation.Landscape;
        s2.PageSetup.FitToPages(1, 0);
        s2.PageSetup.Margins.Top = 0.5; s2.PageSetup.Margins.Bottom = 0.5;
        s2.PageSetup.PrintAreas.Add($"A1:{XLHelper.GetColumnLetterFromNumber(totalCols)}{r - 1}");

        return wb;
    }

    // Compute the per-category metric blocks for one entity (club/district). Returns null when the
    // entity has NO goal data at all. Shared by the single-entity workbook and the all-clubs workbook.
    private async Task<(List<(string Name, List<GoalMetricComputed> Rows, List<GoalMonthPeriodDto> Months)> PerCat, List<GoalMonthPeriodDto> Months0)?> ComputeEntityPerCatAsync(
        MySqlConnection conn, string entityType, int clubId, int districtId, int yearId, bool autoFillLive)
    {
        var cats = await GetCategoriesAsync();
        var perCat = new List<(string Name, List<GoalMetricComputed> Rows, List<GoalMonthPeriodDto> Months)>();
        foreach (var cat in cats)
        {
            var (name, rows, months) = await ComputeCategoryMetricsAsync(conn, cat.Id, yearId, entityType, clubId, districtId, autoFillLive);
            if (rows.Count > 0) perCat.Add((string.IsNullOrEmpty(name) ? cat.Name : name, rows, months));
        }
        if (perCat.Count == 0) return null;
        var months0 = UnionMonths(perCat.Select(p => p.Months));
        return (perCat, months0);
    }

    // One month header shared by several categories: a month is open when ANY category has it open.
    // (Taking the first category's months let District Membership - blank until imported - blank the
    // Jul/Aug of every other category. Per-category gaps still show through each row's ClosedMonths.)
    private static List<GoalMonthPeriodDto> UnionMonths(IEnumerable<List<GoalMonthPeriodDto>> lists)
    {
        var all = lists.Where(l => l.Count > 0).ToList();
        if (all.Count == 0) return new List<GoalMonthPeriodDto>();
        return all[0].Select(mo => new GoalMonthPeriodDto
        {
            Month = mo.Month, Label = mo.Label, CalendarYear = mo.CalendarYear,
            IsAvailable = all.Any(l => l.Any(x => x.Month == mo.Month && x.IsAvailable)),
        }).ToList();
    }

    // Write one entity's YTD (Till Date) category tables onto sheet `s` starting at row `r`; advances r.
    private void WriteYtdBlock(IXLWorksheet s, List<(string Name, List<GoalMetricComputed> Rows, List<GoalMonthPeriodDto> Months)> perCat, ref int r, string? trfAsOn = null)
    {
        foreach (var (name, allRows, _) in perCat)
        {
            // Annual-only rows (baselines, RAG, Summary, TRF Total Giving) are listed month-wise with empty
            // month cells, but the YTD sheet keeps exactly the metrics it always had.
            var rows = allRows.Where(x => x.MonthlyTracked || x.SingleValue).ToList();
            if (rows.Count == 0) continue;
            // Public Image: one value per field, no Target/Achieved/% block (matches the overview grid).
            bool allSingle = rows.Count > 0 && rows.All(x => x.SingleValue);
            // No July-1 baseline anywhere in this category (TRF) → drop that column entirely.
            bool hasBase = !allSingle && rows.Any(x => x.HasBaseline);
            int cols = allSingle ? 2 : (hasBase ? 5 : 4);
            RenderSectionBand(s, cols, name, ref r);
            // The reference column's header comes from the rows themselves — "Highest" for TRF,
            // "Clubs as on July 1st" etc. for Membership. Mixed labels fall back to the old wording.
            var baseLabels = rows.Where(x => x.HasBaseline).Select(x => ReportLabel(x.BaselineLabel)).Distinct().ToList();
            string baseHeader = baseLabels.Count == 1 && !string.IsNullOrWhiteSpace(baseLabels[0]) ? baseLabels[0] : "As on Jul 1";
            string[] hs = allSingle
                ? new[] { "Particulars", "Value" }
                : hasBase
                ? new[] { "Particulars", baseHeader, TargetHeader(name), AchievedHeader(name, trfAsOn), "Achievement(%)" }
                : new[] { "Particulars", TargetHeader(name), AchievedHeader(name, trfAsOn), "Achievement(%)" };
            for (int c = 0; c < hs.Length; c++) { var cell = s.Cell(r, c + 1); cell.Value = hs[c]; StyleHeaderCell(cell); }
            r++;
            foreach (var m in rows)
            {
                int cc = 1;
                s.Cell(r, cc).Value = QualifiedLabel(m, rows); cc++;
                if (allSingle)
                {
                    // ONE value cell: the number, or Yes/No / the numbered Suggestions list.
                    if (m.DisplayText != null) { var dc = s.Cell(r, cc); dc.Value = m.DisplayText; dc.Style.Alignment.WrapText = true; }
                    else SetNumCell(s.Cell(r, cc), m.Target);
                    BorderRow(s, r, cols); r++;
                    continue;
                }
                if (hasBase) { SetNumCell(s.Cell(r, cc), m.Baseline); cc++; }
                SetNumCell(s.Cell(r, cc), m.Target); cc++;
                SetNumCell(s.Cell(r, cc), m.Achieved); cc++;
                SetPctCell(s.Cell(r, cc), m.Pct, m.TwoDecimalPct);
                BorderRow(s, r, cols); r++;
            }
            r++; // spacer
        }
    }

    // Write one entity's Month-wise category tables onto sheet `s` starting at row `r`; advances r.
    // EXTENDED format (user request 2026-09-09): each metric expands to 3 rows —
    //   1) the metric label + "As on Jul 1" baseline + yearly Target (month cells blank),
    //   2) "Achieved" = the cumulative achieved value at each month (baseline + additions to date),
    //   3) "% Achieved" = achievement % at each month.
    // Columns: Metric | As on Jul 1 | Target | <each month>.  totalCols must be 3 + months.Count.
    // Write one entity's QUARTER tables onto sheet `s` (user 2026-09-25). Same shape as the month
    // block, four columns instead of twelve: Q1 Jul-Sep · Q2 Oct-Dec · Q3 Jan-Mar · Q4 Apr-Jun.
    // Each metric prints three rows - the quarter's share of the yearly target, what was achieved in
    // that quarter, and the achievement %. The yearly target column is the SAME figure as everywhere
    // else; nothing about it changes here.
    private void WriteQuarterBlock(IXLWorksheet s,
        List<(string Name, List<GoalMetricComputed> Rows, List<GoalMonthPeriodDto> Months)> perCat,
        int totalCols, ref int r)
    {
        string[] qLabels = { "Q1 · Jul-Sep", "Q2 · Oct-Dec", "Q3 · Jan-Mar", "Q4 · Apr-Jun" };
        foreach (var (name, rows, months) in perCat)
        {
            // Youth Service / Public Image are annual only - no quarterly either.
            if (IsAnnualOnlyCategory(name)) continue;
            var tracked = rows.Where(x => x.MonthlyTracked).ToList();
            if (tracked.Count == 0) continue;

            bool hasBase = tracked.Any(x => x.HasBaseline);
            int blockCols = 1 + (hasBase ? 1 : 0) + 2 + qLabels.Length;   // + the "To add" column
            RenderSectionBand(s, blockCols, name, ref r);

            int c = 1;
            var mh = s.Cell(r, c); mh.Value = "Particulars"; StyleHeaderCell(mh); c++;
            if (hasBase) { var bh = s.Cell(r, c); bh.Value = "As on Jul 1 / Value"; StyleHeaderCell(bh); c++; }
            var th = s.Cell(r, c); th.Value = TargetHeader(name); StyleHeaderCell(th); c++;
            var ah = s.Cell(r, c); ah.Value = "To add"; StyleHeaderCell(ah); c++;
            foreach (var q in qLabels) { var cell = s.Cell(r, c); cell.Value = q; StyleHeaderCell(cell); c++; }
            r++;

            foreach (var m in tracked)
            {
                // Row 1 — metric, baseline, yearly target (unchanged figure).
                c = 1; s.Cell(r, c).Value = QualifiedLabel(m, tracked); c++;
                if (hasBase) { SetNumCell(s.Cell(r, c), m.Baseline); c++; }
                SetNumCell(s.Cell(r, c), m.Target); c++;
                // What the quarters below add up to: the GROWTH for a Membership metric (108 wanted
                // against 104 today = 4 to add), the target itself for TRF.
                SetNumCell(s.Cell(r, c), m.SplitBase); c++;
                BorderRow(s, r, blockCols); r++;

                // Row 2 — the quarter's share of that growth.
                c = 1; s.Cell(r, c).Value = "  Target"; c++;
                if (hasBase) c++;
                c += 2;
                for (int q = 1; q <= 4; q++)
                {
                    SetNumCell(s.Cell(r, c), m.QuarterlyTargets.TryGetValue(q, out var qt) ? qt : null);
                    c++;
                }
                BorderRow(s, r, blockCols); r++;

                // Row 3 — achieved IN that quarter (not cumulative - the quarter stands on its own).
                c = 1; s.Cell(r, c).Value = "  Achieved"; c++;
                if (hasBase) c++;
                c += 2;
                for (int q = 1; q <= 4; q++)
                {
                    SetNumCell(s.Cell(r, c), m.QuarterlyAchieved.TryGetValue(q, out var qa) ? qa : null);
                    c++;
                }
                BorderRow(s, r, blockCols); r++;

                // Row 4 — achieved ÷ that quarter's target.
                c = 1; s.Cell(r, c).Value = "  Achievement(%)"; c++;
                if (hasBase) c++;
                c += 2;
                for (int q = 1; q <= 4; q++)
                {
                    m.QuarterlyTargets.TryGetValue(q, out var qt);
                    m.QuarterlyAchieved.TryGetValue(q, out var qa);
                    // Capped at 100% (user 2026-09-25): beating a quarter's share is good news, but
                    // "385%" reads like a fault. Month-wise and Quarter only - the yearly screens keep
                    // showing the true figure.
                    decimal? pct = (qt.HasValue && qt.Value != 0m && qa.HasValue)
                        ? Math.Min(100m, Math.Round(qa.Value / qt.Value * 100m, m.TwoDecimalPct ? 2 : 0, MidpointRounding.AwayFromZero)) : (decimal?)null;
                    SetPctCell(s.Cell(r, c), pct, m.TwoDecimalPct);
                    c++;
                }
                BorderRow(s, r, blockCols); r++;
            }
            r++; // spacer between categories
        }
    }

    private void WriteMonthBlock(IXLWorksheet s, List<(string Name, List<GoalMetricComputed> Rows, List<GoalMonthPeriodDto> Months)> perCat, int totalCols, ref int r)
    {
        foreach (var (name, rows, months) in perCat)
        {
            // Youth Service / Public Image are annual only - they never appear on a Month wise sheet
            // (user 2026-09-25). Their Till Date block on sheet 1 is untouched.
            if (IsAnnualOnlyCategory(name)) continue;
            // No July-1 baseline in this category (TRF) → drop that column (it was always blank).
            bool hasBase = rows.Any(x => x.HasBaseline);
            int blockCols = totalCols - (hasBase ? 0 : 1);
            RenderSectionBand(s, blockCols, name, ref r);
            int c = 1;
            var mh = s.Cell(r, c); mh.Value = "Particulars"; StyleHeaderCell(mh); c++;
            if (hasBase) { var bh = s.Cell(r, c); bh.Value = "As on Jul 1 / Value"; StyleHeaderCell(bh); c++; }
            var th = s.Cell(r, c); th.Value = TargetHeader(name); StyleHeaderCell(th); c++;
            foreach (var mo in months) { var cell = s.Cell(r, c); cell.Value = mo.Label; StyleHeaderCell(cell); c++; }
            r++;
            foreach (var m in rows)
            {
                // Row 1 — metric label + baseline (when the category has one) + yearly target.
                c = 1; s.Cell(r, c).Value = QualifiedLabel(m, rows); c++;
                if (!m.MonthlyTracked)
                {
                    // Annual-only field: its value ONCE, in the first data column — the "As on Jul 1 / Value"
                    // column when the category has one, otherwise the Target column (TRF has no baseline, so
                    // Total Giving would otherwise print an empty row). Month cells stay empty and the
                    // "Achieved" / "Achievement(%)" rows below are skipped.
                    int valueCol = c;
                    if (m.DisplayText != null) { var dc = s.Cell(r, valueCol); dc.Value = m.DisplayText; dc.Style.Alignment.WrapText = true; }
                    else SetNumCell(s.Cell(r, valueCol), m.Target ?? m.Baseline);
                    c++;
                    if (hasBase) { SetNumCell(s.Cell(r, c), (decimal?)null); c++; }   // Target cell left blank
                    BorderRow(s, r, blockCols); r++;
                    continue;
                }
                if (hasBase) { SetNumCell(s.Cell(r, c), m.Baseline); c++; }
                SetNumCell(s.Cell(r, c), m.Target); c++;
                BorderRow(s, r, blockCols); r++;

                // Cumulative achieved per month (baseline + additions to date); null for future months.
                var cum = new List<decimal?>();
                // TRF starts at 0 — its reference column is "Highest", not a July-1st opening figure.
                decimal run = m.BaselineIsReferenceOnly ? 0m : (m.Baseline ?? 0m);
                foreach (var mo in months)
                {
                    if (mo.IsAvailable) { run += (m.Monthly.TryGetValue(mo.Month, out var v) && v.HasValue) ? v.Value : 0m; cum.Add(run); }
                    else cum.Add(null);
                }

                // Row 2 — the month's share of the yearly target (user 2026-09-25). The yearly figure
                // is on the row above and is unchanged; this is how it was split. Blank until the
                // club/district has saved a split.
                if (m.MonthlyTargets.Values.Any(v => v.HasValue))
                {
                    c = 1; s.Cell(r, c).Value = "  Target"; c++;
                    if (hasBase) c++;
                    c++;
                    foreach (var mo in months)
                    {
                        SetNumCell(s.Cell(r, c), m.MonthlyTargets.TryGetValue(mo.Month, out var mt) ? mt : null);
                        c++;
                    }
                    BorderRow(s, r, blockCols); r++;
                }

                // Row 3 — Achieved (cumulative) per month.
                c = 1; s.Cell(r, c).Value = "  Achieved"; c++;
                if (hasBase) c++;   // As on Jul 1 cell blank on this row
                c++;                // Target cell blank on this row
                foreach (var v in cum) { SetNumCell(s.Cell(r, c), v); c++; }
                BorderRow(s, r, blockCols); r++;

                // Row 4 — % Achieved per month.
                c = 1; s.Cell(r, c).Value = "  Achievement(%)"; c++;
                if (hasBase) c++;
                c++;
                foreach (var v in cum) { SetPctCell(s.Cell(r, c), v.HasValue ? PctAtMonth(m, v.Value) : (decimal?)null, m.TwoDecimalPct); c++; }
                BorderRow(s, r, blockCols); r++;
            }
            r++; // spacer between categories
        }
    }

    // Running monthly TARGET (user 2026-10-09): the year's growth (Target - As on July 1st; the Target
    // itself for Foundation) split over the 12 months in whole numbers, the whole leftover in the LAST
    // month (June), shown as a running total from July 1st. 122 -> 135: Jul 123 ... May 133, Jun 135;
    // 10 -> 13: Jul..May 10, Jun 13. A split the admin saved (pilot) is used as it is.
    private static Dictionary<int, decimal?> RunningMonthTargets(GoalMetricComputed m, List<GoalMonthPeriodDto> months)
    {
        var outv = new Dictionary<int, decimal?>();
        decimal start = m.BaselineIsReferenceOnly ? 0m : (m.Baseline ?? 0m);
        bool saved = !m.TargetsSuggested && m.MonthlyTargets.Values.Any(v => v.HasValue);
        List<decimal> shares;
        if (saved)
            shares = months.Select(mo => m.MonthlyTargets.TryGetValue(mo.Month, out var v) && v.HasValue ? v.Value : 0m).ToList();
        else if (m.Target.HasValue && months.Count > 0)
        {
            decimal growth = Math.Round(m.Target.Value - start, 0, MidpointRounding.AwayFromZero);
            if (growth <= 0m) { foreach (var mo in months) outv[mo.Month] = m.Target; return outv; }
            decimal each = Math.Floor(growth / months.Count);
            decimal extra = growth - each * months.Count;
            shares = months.Select((_, i) => each + (i == months.Count - 1 ? extra : 0m)).ToList();
        }
        else { foreach (var mo in months) outv[mo.Month] = null; return outv; }
        decimal run = start;
        for (int i = 0; i < months.Count; i++) { run += shares[i]; outv[months[i].Month] = run; }
        return outv;
    }

    // District Month wise sheet as a grid (user 2026-10-09): header row 1 = months (each spanning two
    // columns), row 2 = Target | Achieved under every month; one row per metric. Annual-only rows keep
    // their single value and empty month cells.
    private void WriteMonthGridBlock(IXLWorksheet s, List<(string Name, List<GoalMetricComputed> Rows, List<GoalMonthPeriodDto> Months)> perCat, ref int r)
    {
        foreach (var (name, rows, months) in perCat)
        {
            if (IsAnnualOnlyCategory(name)) continue;
            int blockCols = 3 + 2 * months.Count + 2;
            RenderSectionBand(s, blockCols, name, ref r);
            int hr = r;   // header row (a ref parameter cannot be used inside the local function)
            void TallHeader(int col, string txt)
            {
                int r = hr;
                var hc = s.Cell(r, col); hc.Value = txt; StyleHeaderCell(hc); StyleHeaderCell(s.Cell(r + 1, col));
                s.Range(r, col, r + 1, col).Merge().Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
            }
            TallHeader(1, "Particulars");
            TallHeader(2, "As on Jul 1 / Value");
            TallHeader(3, TargetHeader(name));
            int c = 4;
            foreach (var mo in months)
            {
                var hc = s.Cell(r, c); hc.Value = mo.Label; StyleHeaderCell(hc); StyleHeaderCell(s.Cell(r, c + 1));
                s.Range(r, c, r, c + 1).Merge().Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
                var t = s.Cell(r + 1, c); t.Value = "Target"; StyleHeaderCell(t);
                var a = s.Cell(r + 1, c + 1); a.Value = "Achieved"; StyleHeaderCell(a);
                c += 2;
            }
            TallHeader(c, "Achieved"); c++;
            TallHeader(c, "% Achievement");
            BorderRow(s, r, blockCols); BorderRow(s, r + 1, blockCols);
            r += 2;

            foreach (var m in rows)
            {
                // Membership's yearly-only rows (RED / AMBER / GREEN + the 3 Summary totals) have nothing
                // month-wise - hidden here (user 2026-10-09); the YTD sheet still lists them.
                if (!m.MonthlyTracked && name.Equals("Membership", StringComparison.OrdinalIgnoreCase)) continue;
                s.Cell(r, 1).Value = QualifiedLabel(m, rows);
                if (!m.MonthlyTracked)
                {
                    if (m.DisplayText != null) { var dc = s.Cell(r, 3); dc.Value = m.DisplayText; dc.Style.Alignment.WrapText = true; }
                    else SetNumCell(s.Cell(r, 3), m.Target ?? m.Baseline);
                    BorderRow(s, r, blockCols); r++;
                    continue;
                }
                SetNumCell(s.Cell(r, 2), m.BaselineIsReferenceOnly || !m.HasBaseline ? null : m.Baseline);
                SetNumCell(s.Cell(r, 3), m.Target);
                var tgt = RunningMonthTargets(m, months);
                decimal run = m.BaselineIsReferenceOnly ? 0m : (m.Baseline ?? 0m);
                decimal? last = null;
                c = 4;
                foreach (var mo in months)
                {
                    SetNumCell(s.Cell(r, c), tgt.TryGetValue(mo.Month, out var tv) ? tv : null);
                    decimal? ach = null;
                    if (mo.IsAvailable) { run += (m.Monthly.TryGetValue(mo.Month, out var v) && v.HasValue) ? v.Value : 0m; ach = run; last = run; }
                    SetNumCell(s.Cell(r, c + 1), ach);
                    c += 2;
                }
                var ac = s.Cell(r, c); SetNumCell(ac, last); ac.Style.Font.Bold = true; c++;
                SetPctCell(s.Cell(r, c), last.HasValue ? PctAtMonth(m, last.Value) : (decimal?)null, m.TwoDecimalPct);
                BorderRow(s, r, blockCols); r++;
            }
            r++; // spacer between categories
        }
    }

    // Achievement % at a given cumulative-achieved value. Membership metrics subtract the July-1st
    // baseline (progress on planned NEW additions); other categories use achieved ÷ target. Matches
    // the YTD %-achievement logic. Returns null when there's no meaningful target.
    private static decimal? PctAtMonth(GoalMetricComputed m, decimal cumAchieved)
    {
        decimal target = m.Target ?? 0m;
        // TRF: Baseline is "Highest", a reference figure — never subtract it. % stays Achieved ÷ Target.
        if (m.Baseline.HasValue && !m.BaselineIsReferenceOnly)
        {
            decimal baseline = m.Baseline.Value;
            decimal planned = target - baseline;
            decimal gained = cumAchieved - baseline;
            decimal pct = planned > 0m ? gained / planned * 100m : (target > 0m && cumAchieved >= target ? 100m : 0m);
            return Math.Round(Math.Max(0m, Math.Min(100m, pct)), 0, MidpointRounding.AwayFromZero);
        }
        // TRF had no cap here while the Membership branch above always had one, so a fund that beat
        // its target printed 118% on the Month-wise sheet. Capped to match (user 2026-09-25).
        return target > 0m ? Math.Min(100m, Math.Round(cumAchieved / target * 100m, m.TwoDecimalPct ? 2 : 0, MidpointRounding.AwayFromZero)) : (decimal?)null;
    }

    // ── ALL CLUBS in a district — one workbook (2 sheets: YTD + Month wise) with every club's goals
    //    stacked, each under its own club-name band. Used by Club Goal Setting → "All". Clubs with no
    //    goal data are skipped; returns null when NO club in the district has any goals. ──
    public async Task<byte[]?> BuildAllClubsMonthlyExcelAsync(int memberId, int? yearId, int? requestedDistrictId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var districtId = await ResolveDistrictIdAsync(conn, memberId, requestedDistrictId);
        // user 2026-10-08: Rotaract clubs hidden from the District Admin's goal screens (SuperAdmin keeps them).
        return await BuildAllClubsMonthlyExcelCoreAsync(conn, districtId, yearId,
            excludeRotaract: ClubScopeSql.HideRotaract(await ClubAdminAccessHelper.IsSuperAdminAsync(conn, memberId)));
    }

    // Goal Overview "View clubs" popup: the all-clubs "Club Goal Setting" report for ANY district the
    // caller may report on (validated via CanAccessDistrictReportAsync).
    public async Task<byte[]?> BuildAllClubsMonthlyExcelScopedAsync(int memberId, int? yearId, int districtId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        if (!await CanAccessDistrictReportAsync(conn, memberId, districtId))
            throw new UnauthorizedAccessException("This district is outside your goal-setting scope.");
        return await BuildAllClubsMonthlyExcelCoreAsync(conn, districtId, yearId);
    }

    private async Task<byte[]?> BuildAllClubsMonthlyExcelCoreAsync(MySqlConnection conn, int districtId, int? yearId,
        bool excludeRotaract = false)
    {
        if (districtId == 0) return null;
        var (resolvedYearId, yearLabel, isEditable) = await ResolveYearAsync(conn, yearId);
        if (resolvedYearId == 0) return null;
        var num = await conn.ExecuteScalarAsync<string>(
            "SELECT DistrictNumber FROM district_master WHERE pk_district_id = @Id", new { Id = districtId }) ?? "";
        var clubs = (await conn.QueryAsync<(int Id, string Name)>(
            "SELECT pk_club_id AS Id, ClubName AS Name FROM club_master WHERE fk_district_id = @D AND isdeleted = 0 AND IsActive = 1"
            + (excludeRotaract ? " AND " + ClubScopeSql.NotRotaract("") : "") + " ORDER BY ClubName",
            new { D = districtId })).ToList();
        if (clubs.Count == 0) return null;

        var subtitle = $"District {num}   ·   Rotary Year {yearLabel}   ·   Generated {DateTime.Now:dd MMM yyyy, hh:mm tt}";
        // Pre-compute every club's per-category metrics once (skip clubs with no goals). HORIZONTAL layout:
        // one row per club, all the details spread across columns to the right of the club name.
        // Parallel pre-compute (bounded) — the per-club metric build is the slow part; each task uses its
        // OWN pooled connection so they don't contend on `conn`. Order is preserved (clubs are ORDER BY name).
        var sem = new SemaphoreSlim(12);
        var computeTasks = clubs.Select(async club =>
        {
            await sem.WaitAsync();
            try
            {
                using var c2 = CreateConnection();
                await c2.OpenAsync();
                var data = await ComputeEntityPerCatAsync(c2, "Club", club.Id, 0, resolvedYearId, isEditable);
                return (club.Name, Data: data);
            }
            finally { sem.Release(); }
        }).ToList();
        var computedClubs = await Task.WhenAll(computeTasks);

        var clubData = new List<(string ClubName, List<(string Name, List<GoalMetricComputed> Rows, List<GoalMonthPeriodDto> Months)> PerCat)>();
        List<GoalMonthPeriodDto> months0 = new();
        foreach (var (name, data) in computedClubs)
        {
            if (data == null) continue;   // this club has no goals → skip
            clubData.Add((name, data.Value.PerCat));
            if (months0.Count == 0) months0 = data.Value.Months0;
        }
        if (clubData.Count == 0) return null;

        return BuildHorizontalGoalWorkbook("Club", $"All Clubs — District {num}", subtitle, clubData, months0,
            await FoundationAsOnAsync(conn, resolvedYearId, "Club"));
    }

    // ── District Performance Report (2026-09-17) — READ-ONLY, system call, NO caller scope ─────────
    // Only DistrictPerformanceReportService (SuperAdmin screen + scheduled DG report) calls this; it is
    // never exposed on a user-scoped endpoint. Returns the district's own YTD goal rows — exactly the
    // rows the district "Goal Setting" report's YTD sheet prints (MonthlyTracked || SingleValue, so TRF
    // Total Giving is included) — and, when asked, the district + all-clubs Goal Setting workbooks
    // UNCHANGED so the DG report can carry them as sheets. Nothing is written.
    public async Task<DistrictPerformanceGoalData> GetDistrictPerformanceGoalDataAsync(int districtId, int yearId, bool includeWorkbooks)
    {
        var result = new DistrictPerformanceGoalData();
        if (districtId <= 0) return result;
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var (resolvedYearId, yearLabel, isEditable) = await ResolveYearAsync(conn, yearId);
        if (resolvedYearId == 0) return result;

        var data = await ComputeEntityPerCatAsync(conn, "District", 0, districtId, resolvedYearId, isEditable);
        if (data != null)
        {
            foreach (var (name, allRows, _) in data.Value.PerCat)
            {
                var rows = allRows.Where(x => x.MonthlyTracked || x.SingleValue).ToList();
                foreach (var m in rows)
                    result.DistrictMetrics.Add(new DistrictPerformanceGoalMetric
                    {
                        Category = name,
                        Metric = QualifiedLabel(m, rows),
                        Baseline = m.HasBaseline ? m.Baseline : null,
                        Target = m.Target,
                        Achieved = m.Achieved,
                        Pct = m.Pct,
                        DisplayText = m.DisplayText,
                        SingleValue = m.SingleValue,
                    });
            }
            // "Achieved (as on …)" per category — the same date the district's Goal Setting form shows.
            foreach (var cat in await conn.QueryAsync<(int Id, string Name)>(
                "SELECT pk_category_id AS Id, IF(Name = 'TRF', 'Foundation', Name) AS Name FROM goal_categories WHERE isdeleted = 0"))
            {
                var asOn = await AchievedAsOnAsync(conn, cat.Id, resolvedYearId, "District", 0, districtId);
                if (asOn != null) result.AchievedAsOn[cat.Name] = asOn;
            }
        }

        if (includeWorkbooks)
        {
            var num = await conn.ExecuteScalarAsync<string>(
                "SELECT DistrictNumber FROM district_master WHERE pk_district_id = @Id", new { Id = districtId }) ?? "";
            var wb = await RenderEntityWorkbookAsync(conn, "District", 0, districtId, resolvedYearId,
                $"District {num}", $"Rotary Year {yearLabel}   ·   Generated {DateTime.Now:dd MMM yyyy, hh:mm tt}", isEditable);
            result.DistrictWorkbook = wb == null ? null : SaveAndDispose(wb);
            result.ClubsWorkbook = await BuildAllClubsMonthlyExcelCoreAsync(conn, districtId, resolvedYearId, excludeRotaract: true);   // DG email
        }
        return result;
    }

    // Renders a HORIZONTAL goal workbook shared by the All-Clubs report and the District oversight report:
    // one row per entity (club or district), each category's metrics spread across columns. Sheet 1 = YTD
    // (Jul 1 · Target · Ach. · %), Sheet 2 = Month-wise (cumulative Achieved per month + Total).
    private byte[] BuildHorizontalGoalWorkbook(
        string firstColHeader, string title, string subtitle,
        List<(string Name, List<(string Name, List<GoalMetricComputed> Rows, List<GoalMonthPeriodDto> Months)> PerCat)> rowData,
        List<GoalMonthPeriodDto> months0, string? trfAsOn = null)
    {
        // Column model: categories in first-seen order, and per category the metric labels by INDEX
        // (labels can repeat within a category, so we align by position, longest row wins).
        // Sheet 1 (YTD) keeps exactly the metrics it always had; Sheet 2 (Month-wise) also lists the
        // annual-only fields (baselines, RAG, Summary, Total Giving …) with empty month cells.
        static List<GoalMetricComputed> YtdRows(List<GoalMetricComputed> rows)
            => rows.Where(x => x.MonthlyTracked || x.SingleValue).ToList();

        var catOrder = new List<string>();
        var catMetricLabels = new Dictionary<string, List<(string GroupName, string MetricLabel, string BaselineLabel, bool HasBaseline, bool Single)>>();
        var catMonthLabels = new Dictionary<string, List<string>>();
        foreach (var cd in rowData)
            foreach (var (cat, allRows, _) in cd.PerCat)
            {
                var rows = YtdRows(allRows);
                if (!catMetricLabels.TryGetValue(cat, out var lbls)) { lbls = new(); catMetricLabels[cat] = lbls; catOrder.Add(cat); }
                for (int i = lbls.Count; i < rows.Count; i++)
                    lbls.Add((rows[i].GroupName, ReportLabel(rows[i].Label), rows[i].BaselineLabel, rows[i].HasBaseline, rows[i].SingleValue));
                // Youth Service / Public Image are annual only (user 2026-09-25): leave their month
                // label list EMPTY and every Month wise block for them collapses to zero width, while
                // their Till Date columns on sheet 1 stay exactly as they are.
                if (!catMonthLabels.TryGetValue(cat, out var mlbls)) { mlbls = new(); catMonthLabels[cat] = mlbls; }
                if (!IsAnnualOnlyCategory(cat))
                    for (int i = mlbls.Count; i < rows.Count; i++) mlbls.Add(QualifiedLabel(rows[i], rows));
            }
        // Public Image → 1 column per field (just its value). Otherwise 4 columns, or 3 when the metric
        // has no July-1 baseline (TRF: giving starts at zero, that column was always "—").
        static int MetricCols((string GroupName, string MetricLabel, string BaselineLabel, bool HasBaseline, bool Single) l)
            => l.Single ? 1 : (l.HasBaseline ? 4 : 3);
        int CatCols(string cat) => catMetricLabels[cat].Sum(MetricCols);
        List<GoalMetricComputed> RowsFor(List<(string Name, List<GoalMetricComputed> Rows, List<GoalMonthPeriodDto> Months)> perCat, string cat)
            => perCat.FirstOrDefault(p => p.Name == cat).Rows ?? new List<GoalMetricComputed>();

        var wb = new XLWorkbook();

        // ── Sheet 1 — YTD, HORIZONTAL: <entity> | [category → each metric → Jul 1 · Target · Ach. · %] ──
        var s1 = wb.Worksheets.Add("YTD (Till Date)");
        s1.Column(1).Width = 30;
        int width1 = 1 + catOrder.Sum(CatCols);
        int r = 1;
        RenderTitleBand(s1, width1, title, subtitle, ref r);
        int aRow = r, bRow = r + 1, cRow = r + 2;                 // 3 header tiers: category · metric · sub-cols
        s1.Range(aRow, 1, cRow, 1).Merge();
        var h1 = s1.Cell(aRow, 1); h1.Value = firstColHeader; StyleHeaderCell(h1);
        int col = 2;
        foreach (var cat in catOrder)
        {
            var lbls = catMetricLabels[cat];
            int span = CatCols(cat);
            if (span == 0) continue;
            s1.Range(aRow, col, aRow, col + span - 1).Merge();
            var ch = s1.Cell(aRow, col); ch.Value = cat; StyleHeaderCell(ch);
            for (int k = 1; k < span; k++) StyleHeaderCell(s1.Cell(aRow, col + k));
            int mc = col;
            for (int li = 0; li < lbls.Count; li++)
            {
                var l = lbls[li];
                int cols = MetricCols(l);
                if (l.Single)
                {
                    // Public Image: consecutive fields of the same group share ONE group heading, and each
                    // field's own label sits below it with the value in that single column.
                    int run = 1;
                    while (li + run < lbls.Count && lbls[li + run].Single && lbls[li + run].GroupName == l.GroupName) run++;
                    s1.Range(bRow, mc, bRow, mc + run - 1).Merge();
                    var gh = s1.Cell(bRow, mc); gh.Value = l.GroupName; StyleHeaderCell(gh);
                    for (int k = 1; k < run; k++) StyleHeaderCell(s1.Cell(bRow, mc + k));
                    for (int k = 0; k < run; k++)
                    {
                        var cell = s1.Cell(cRow, mc + k);
                        cell.Value = lbls[li + k].MetricLabel; cell.Style.Alignment.WrapText = true; StyleHeaderCell(cell);
                    }
                    mc += run; li += run - 1;
                    continue;
                }
                s1.Range(bRow, mc, bRow, mc + cols - 1).Merge();
                var mh = s1.Cell(bRow, mc); mh.Value = l.GroupName; StyleHeaderCell(mh);
                for (int k = 1; k < cols; k++) StyleHeaderCell(s1.Cell(bRow, mc + k));
                string[] sub = l.HasBaseline
                    ? new[] { ReportLabel(l.BaselineLabel), TargetHeader(cat), AchievedHeader(cat, trfAsOn), "Achievement(%)" }
                    : new[] { TargetHeader(cat), AchievedHeader(cat, trfAsOn), "Achievement(%)" };
                for (int k = 0; k < cols; k++) { var cell = s1.Cell(cRow, mc + k); cell.Value = sub[k]; cell.Style.Alignment.WrapText = true; StyleHeaderCell(cell); }
                mc += cols;
            }
            col += span;
        }
        r = cRow + 1;
        foreach (var cd in rowData)
        {
            s1.Cell(r, 1).Value = cd.Name;
            col = 2;
            foreach (var cat in catOrder)
            {
                var lbls = catMetricLabels[cat];
                var rows = YtdRows(RowsFor(cd.PerCat, cat));   // aligned with the YTD labels above
                for (int i = 0; i < lbls.Count; i++)
                {
                    var m = i < rows.Count ? rows[i] : null;
                    int cols = MetricCols(lbls[i]);
                    int cc = col;
                    if (lbls[i].Single)
                    {
                        // ONE cell: the number, or Yes/No / the numbered Suggestions list.
                        if (m?.DisplayText != null) { var dc = s1.Cell(r, cc); dc.Value = m.DisplayText; dc.Style.Alignment.WrapText = true; }
                        else SetNumCell(s1.Cell(r, cc), m?.Target);
                        col += cols;
                        continue;
                    }
                    if (lbls[i].HasBaseline) { SetNumCell(s1.Cell(r, cc), m?.Baseline); cc++; }
                    SetNumCell(s1.Cell(r, cc), m?.Target); cc++;
                    SetNumCell(s1.Cell(r, cc), m?.Achieved); cc++;
                    SetPctCell(s1.Cell(r, cc), m?.Pct, m?.TwoDecimalPct == true);
                    col += cols;
                }
            }
            BorderRow(s1, r, width1); r++;
        }
        for (int cc = 2; cc <= width1; cc++) s1.Column(cc).Width = 12;
        s1.Row(cRow).Height = 46;   // room for the wrapped exact field labels
        s1.PageSetup.PageOrientation = XLPageOrientation.Landscape; s1.PageSetup.FitToPages(1, 0);
        s1.SheetView.FreezeColumns(1);

        // ── Sheet 2 — Quarter, HORIZONTAL (user 2026-09-25): <entity> | [metric → Q1..Q4 target+achieved] ──
        // catMonthLabels is EMPTY for an annual-only category, so Youth Service / Public Image collapse
        // to zero width here exactly as they do on the Month wise sheet.
        {
            string[] qh = { "Q1", "Q2", "Q3", "Q4" };
            var sq = wb.Worksheets.Add("Quarter");
            sq.Column(1).Width = 30;
            int perQ = 8;                                          // 4 quarters × (target, achieved)
            int widthQ = 1 + catOrder.Sum(c => catMonthLabels[c].Count) * perQ;
            int rq = 1;
            RenderTitleBand(sq, widthQ, title, subtitle + "   ·   Quarter", ref rq);
            int aq = rq, bq = rq + 1, cq = rq + 2;
            sq.Range(aq, 1, cq, 1).Merge();
            var hq = sq.Cell(aq, 1); hq.Value = firstColHeader; StyleHeaderCell(hq);
            int colq = 2;
            foreach (var cat in catOrder)
            {
                int span = catMonthLabels[cat].Count * perQ;
                if (span == 0) continue;
                sq.Range(aq, colq, aq, colq + span - 1).Merge();
                var ch = sq.Cell(aq, colq); ch.Value = cat; StyleHeaderCell(ch);
                for (int k = 1; k < span; k++) StyleHeaderCell(sq.Cell(aq, colq + k));
                foreach (var metricLabel in catMonthLabels[cat])
                {
                    sq.Range(bq, colq, bq, colq + perQ - 1).Merge();
                    var mh2 = sq.Cell(bq, colq); mh2.Value = metricLabel; StyleHeaderCell(mh2);
                    for (int k = 1; k < perQ; k++) StyleHeaderCell(sq.Cell(bq, colq + k));
                    int sub = colq;
                    foreach (var q in qh)
                    {
                        var t1 = sq.Cell(cq, sub); t1.Value = q + " tgt"; StyleHeaderCell(t1); sub++;
                        var t2 = sq.Cell(cq, sub); t2.Value = q + " ach"; StyleHeaderCell(t2); sub++;
                    }
                    colq += perQ;
                }
            }
            rq = cq + 1;
            foreach (var cd in rowData)
            {
                sq.Cell(rq, 1).Value = cd.Name;
                colq = 2;
                foreach (var cat in catOrder)
                {
                    var lbls = catMonthLabels[cat];
                    var rws = YtdRows(RowsFor(cd.PerCat, cat));
                    for (int i = 0; i < lbls.Count; i++)
                    {
                        var m = i < rws.Count ? rws[i] : null;
                        int sub = colq;
                        for (int q = 1; q <= 4; q++)
                        {
                            SetNumCell(sq.Cell(rq, sub), m != null && m.QuarterlyTargets.TryGetValue(q, out var qt) ? qt : null); sub++;
                            SetNumCell(sq.Cell(rq, sub), m != null && m.QuarterlyAchieved.TryGetValue(q, out var qa) ? qa : null); sub++;
                        }
                        colq += perQ;
                    }
                }
                BorderRow(sq, rq, widthQ); rq++;
            }
            for (int cc = 2; cc <= widthQ; cc++) sq.Column(cc).Width = 9;
            sq.PageSetup.PageOrientation = XLPageOrientation.Landscape;
            sq.PageSetup.FitToPages(1, 0);
            sq.SheetView.FreezeColumns(1);
        }

        // ── Sheet 3 — Month wise, HORIZONTAL: <entity> | [metric → each month (cumulative Achieved) · Total] ──
        var s2 = wb.Worksheets.Add("Month wise");
        s2.Column(1).Width = 30;
        int perMetric = months0.Count + 1;                        // months + Total
        int width2 = 1 + catOrder.Sum(c => catMonthLabels[c].Count) * perMetric;
        r = 1;
        RenderTitleBand(s2, width2, title, subtitle + "   ·   Month wise", ref r);
        // THREE header tiers, matching the YTD sheet: category · metric · months. Without the category
        // row you cannot tell which of the four categories a block of month columns belongs to.
        int a2 = r, b2 = r + 1, c2 = r + 2;
        s2.Range(a2, 1, c2, 1).Merge();
        var h2 = s2.Cell(a2, 1); h2.Value = firstColHeader; StyleHeaderCell(h2);
        col = 2;
        foreach (var cat in catOrder)
        {
            int catSpan = catMonthLabels[cat].Count * perMetric;
            if (catSpan == 0) continue;
            s2.Range(a2, col, a2, col + catSpan - 1).Merge();
            var ch2 = s2.Cell(a2, col); ch2.Value = cat; StyleHeaderCell(ch2);
            for (int k = 1; k < catSpan; k++) StyleHeaderCell(s2.Cell(a2, col + k));
            foreach (var metricLabel in catMonthLabels[cat])
            {
                s2.Range(b2, col, b2, col + perMetric - 1).Merge();
                var mh = s2.Cell(b2, col); mh.Value = metricLabel; StyleHeaderCell(mh);
                for (int k = 1; k < perMetric; k++) StyleHeaderCell(s2.Cell(b2, col + k));
                int cc = col;
                foreach (var mo in months0) { var cell = s2.Cell(c2, cc); cell.Value = mo.Label; StyleHeaderCell(cell); cc++; }
                var tc = s2.Cell(c2, cc); tc.Value = "Total"; StyleHeaderCell(tc);
                col += perMetric;
            }
        }
        r = c2 + 1;
        foreach (var cd in rowData)
        {
            s2.Cell(r, 1).Value = cd.Name;
            col = 2;
            foreach (var cat in catOrder)
            {
                var lbls = catMonthLabels[cat];
                var rows = YtdRows(RowsFor(cd.PerCat, cat));   // aligned with the month-sheet labels
                for (int i = 0; i < lbls.Count; i++)
                {
                    var m = i < rows.Count ? rows[i] : null;
                    if (m != null)
                    {
                        decimal run = m.BaselineIsReferenceOnly ? 0m : (m.Baseline ?? 0m); decimal? finalCum = null; int cc = col;
                        foreach (var mo in months0)
                        {
                            if (mo.IsAvailable && !m.ClosedMonths.Contains(mo.Month)) { run += (m.Monthly.TryGetValue(mo.Month, out var v) && v.HasValue) ? v.Value : 0m; SetNumCell(s2.Cell(r, cc), run); finalCum = run; }
                            else SetNumCell(s2.Cell(r, cc), (decimal?)null);
                            cc++;
                        }
                        SetNumCell(s2.Cell(r, cc), finalCum);
                    }
                    col += perMetric;
                }
            }
            BorderRow(s2, r, width2); r++;
        }
        for (int cc = 2; cc <= width2; cc++) s2.Column(cc).Width = 7;
        s2.PageSetup.PageOrientation = XLPageOrientation.Landscape; s2.PageSetup.FitToPages(1, 0);
        s2.SheetView.FreezeColumns(1);

        return SaveAndDispose(wb);
    }

    // ── District goal report (SuperAdmin Goal Overview): districts = rows, categories horizontal, YTD +
    //    Month-wise. Scope: districtId>0 → that district; else zoneId>0 → that zone's districts; else ALL.
    public async Task<byte[]?> BuildGoalDistrictReportExcelAsync(int memberId, int? zoneId, int? districtId, int? yearId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var (resolvedYearId, yearLabel, isEditable) = await ResolveYearAsync(conn, yearId);
        if (resolvedYearId == 0) return null;

        if (!await ClubAdminAccessHelper.IsSuperAdminAsync(conn, memberId)) return null;

        string where = "d.isdeleted=0 AND d.IsActive=1";
        if (districtId is > 0) where += " AND d.pk_district_id=@Did";
        else if (zoneId is > 0) where += " AND d.fk_zone_id=@Zid";
        var districts = (await conn.QueryAsync<(int Id, string Number)>(
            $"SELECT pk_district_id AS Id, DistrictNumber AS Number FROM district_master d WHERE {where} ORDER BY DistrictNumber",
            new { Did = districtId ?? 0, Zid = zoneId ?? 0 })).ToList();
        if (districts.Count == 0) return null;

        // Parallel pre-compute (bounded) — one own connection per task.
        var sem = new SemaphoreSlim(12);
        var tasks = districts.Select(async d =>
        {
            await sem.WaitAsync();
            try
            {
                using var c2 = CreateConnection();
                await c2.OpenAsync();
                var data = await ComputeEntityPerCatAsync(c2, "District", 0, d.Id, resolvedYearId, isEditable);
                return (Name: $"D {d.Number}", Data: data);
            }
            finally { sem.Release(); }
        }).ToList();
        var computed = await Task.WhenAll(tasks);

        var rowData = new List<(string Name, List<(string Name, List<GoalMetricComputed> Rows, List<GoalMonthPeriodDto> Months)> PerCat)>();
        List<GoalMonthPeriodDto> months0 = new();
        foreach (var (name, data) in computed)
        {
            if (data == null) continue;
            DropYouthPct(data.Value.PerCat);   // oversight report: no Youth Service % (user 2026-10-09)
            rowData.Add((name, data.Value.PerCat));
            if (months0.Count == 0) months0 = data.Value.Months0;
        }
        if (rowData.Count == 0) return null;

        string scopeLabel = districtId is > 0 ? $"District {districts[0].Number}"
            : zoneId is > 0 ? $"Zone (districts) — {districts.Count} district(s)"
            : $"All districts — {districts.Count} district(s)";
        var subtitle = $"{scopeLabel}   ·   Rotary Year {yearLabel}   ·   Generated {DateTime.Now:dd MMM yyyy, hh:mm tt}";
        return BuildHorizontalGoalWorkbook("District", "Goal Setting — District Report", subtitle, rowData, months0,
            await FoundationAsOnAsync(conn, resolvedYearId, "District"));
    }

    // ── Report-scope validator (SuperAdmin or the district's admin) ──
    private async Task<bool> CanAccessDistrictReportAsync(MySqlConnection conn, int memberId, int districtId)
    {
        if (districtId <= 0 || memberId <= 0) return false;
        if (await ClubAdminAccessHelper.IsSuperAdminAsync(conn, memberId)) return true;
        try { return await ResolveDistrictIdAsync(conn, memberId, districtId) == districtId; }
        catch (UnauthorizedAccessException) { return false; }
    }
    // ── District Admin's club list overview ──────────────────────────────
    public async Task<List<GoalClubSummaryDto>> GetDistrictClubsGoalListAsync(int memberId, int categoryId, int yearId, int? requestedDistrictId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var districtId = await ResolveDistrictIdAsync(conn, memberId, requestedDistrictId);
        if (districtId == 0) return new List<GoalClubSummaryDto>();

        var rows = await conn.QueryAsync<dynamic>(@"
            SELECT c.pk_club_id AS clubId, c.ClubName AS clubName,
                   (SELECT COUNT(*) FROM goal_entries e
                     JOIN goal_fields f ON f.pk_field_id = e.fk_field_id AND f.isdeleted = 0
                    WHERE f.fk_category_id = @CategoryId AND e.fk_year_id = @YearId
                      AND e.EntityType = 'Club' AND e.fk_club_id = c.pk_club_id AND e.isdeleted = 0) AS entryCount,
                   (SELECT DATE_FORMAT(MAX(COALESCE(e.modified_date, e.created_date)), '%Y-%m-%d %H:%i')
                      FROM goal_entries e JOIN goal_fields f ON f.pk_field_id = e.fk_field_id AND f.isdeleted = 0
                     WHERE f.fk_category_id = @CategoryId AND e.fk_year_id = @YearId
                       AND e.EntityType = 'Club' AND e.fk_club_id = c.pk_club_id AND e.isdeleted = 0) AS lastUpdatedDate
            FROM club_master c
            WHERE c.fk_district_id = @DistrictId AND c.isdeleted = 0 AND c.IsActive = 1
            ORDER BY c.ClubName",
            new { CategoryId = categoryId, YearId = yearId, DistrictId = districtId });

        return rows.Select(r => new GoalClubSummaryDto
        {
            ClubId = Convert.ToInt32(r.clubId),
            ClubName = (string)r.clubName,
            HasAnyGoalSet = Convert.ToInt32(r.entryCount ?? 0L) > 0,
            LastUpdatedDate = r.lastUpdatedDate as string,
        }).ToList();
    }

    // Read-only matrix for the District Admin "View club goals" screen: every club of the district
    // as a row, every field of ONE category as a column, with that club's live/saved value, plus a
    // per-club RAG band (active synced member count). No editing, no drill-in.
    public async Task<GoalClubMatrixDto> GetDistrictClubsGoalMatrixAsync(int memberId, int categoryId, int? yearId, int? requestedDistrictId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var districtId = await ResolveDistrictIdAsync(conn, memberId, requestedDistrictId);
        return await BuildDistrictClubsGoalMatrixCoreAsync(conn, categoryId, districtId, yearId,
            excludeRotaract: ClubScopeSql.HideRotaract(await ClubAdminAccessHelper.IsSuperAdminAsync(conn, memberId)));   // user 2026-10-08
    }

    // Goal Overview variant: validate the district with CanAccessDistrictReportAsync (SuperAdmin or the
    // district's admin). Used by the "Club Goal Setting" popup on the Goal Overview district matrix.
    public async Task<GoalClubMatrixDto> GetScopedDistrictClubsGoalMatrixAsync(int memberId, int categoryId, int? yearId, int districtId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        if (!await CanAccessDistrictReportAsync(conn, memberId, districtId))
            throw new UnauthorizedAccessException("This district is outside your goal-setting scope.");
        return await BuildDistrictClubsGoalMatrixCoreAsync(conn, categoryId, districtId, yearId);
    }

    private async Task<GoalClubMatrixDto> BuildDistrictClubsGoalMatrixCoreAsync(MySqlConnection conn, int categoryId, int districtId, int? yearId, bool excludeRotaract = false)
    {
        var result = new GoalClubMatrixDto { CategoryId = categoryId };
        if (districtId == 0) return result;

        var (resolvedYearId, yearLabel, isEditable) = await ResolveYearAsync(conn, yearId);
        if (resolvedYearId == 0) return result;
        result.YearId = resolvedYearId;
        result.YearLabel = yearLabel;
        result.CategoryName = await GetCategoryNameAsync(conn, categoryId);

        var clubs = (await conn.QueryAsync<(int Id, string Name)>(
            @"SELECT pk_club_id AS Id, ClubName AS Name FROM club_master
              WHERE fk_district_id = @D AND isdeleted = 0 AND IsActive = 1"
            + (excludeRotaract ? " AND " + ClubScopeSql.NotRotaract("") : "") + " ORDER BY ClubName",
            new { D = districtId })).ToList();

        bool columnsSet = false;
        foreach (var club in clubs)
        {
            // Reuse the exact per-club field-with-live-values loader used by the club form.
            var fields = await LoadFieldsWithValuesAsync(conn, categoryId, resolvedYearId, "Club", club.Id, 0, autoFillLive: isEditable);

            // The 10 Public Image suggestion slots share one label, so they were 10 columns. Collapse them
            // into ONE "Suggestions" column holding only the filled entries, numbered — same as the reports.
            static bool IsSuggestion(GoalFieldWithValueDto f) => f.GroupName.Equals("Suggestions", StringComparison.OrdinalIgnoreCase);

            if (!columnsSet)
            {
                var cols = new List<GoalMatrixColumnDto>();
                foreach (var f in fields)
                {
                    if (IsSuggestion(f))
                    {
                        if (!cols.Any(c => c.FieldKey == "suggestions"))
                            cols.Add(new GoalMatrixColumnDto { FieldKey = "suggestions", FieldLabel = "Suggestions", GroupName = f.GroupName, DataType = "Text" });
                        continue;
                    }
                    cols.Add(new GoalMatrixColumnDto
                    {
                        FieldKey = f.FieldKey, FieldLabel = f.FieldLabel, GroupName = f.GroupName,
                        DataType = f.DataType, Unit = f.Unit,
                    });
                }
                result.Columns = cols;
                columnsSet = true;
            }

            var (band, mc) = await LiveClubRagBandAsync(conn, club.Id);
            var row = new GoalMatrixRowDto { ClubId = club.Id, ClubName = club.Name, Rag = band, MemberCount = mc };
            var suggestionTexts = new List<string>();
            foreach (var f in fields)
            {
                if (IsSuggestion(f))
                {
                    if (!string.IsNullOrWhiteSpace(f.TextValue)) suggestionTexts.Add(f.TextValue!.Trim());
                    continue;
                }
                row.Values[f.FieldKey] = FormatGoalValue(f);
            }
            if (fields.Any(IsSuggestion))
                row.Values["suggestions"] = suggestionTexts.Count == 0 ? null
                    : string.Join("; ", suggestionTexts.Select((t, i) => $"{i + 1}) {t}"));
            result.Clubs.Add(row);
        }
        return result;
    }

    // Month-wise "all clubs" matrix (clubs = rows, months = columns) for one category+year. Reuses the
    // exact per-club month-wise builder so the values match the single-club month-wise panel 1:1.
    public async Task<GoalClubMonthlyMatrixDto> GetDistrictClubsMonthlyMatrixAsync(int memberId, int categoryId, int? yearId, int? requestedDistrictId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var districtId = await ResolveDistrictIdAsync(conn, memberId, requestedDistrictId);
        return await BuildDistrictClubsMonthlyMatrixCoreAsync(conn, categoryId, districtId, yearId,
            excludeRotaract: ClubScopeSql.HideRotaract(await ClubAdminAccessHelper.IsSuperAdminAsync(conn, memberId)));   // user 2026-10-08
    }

    // Goal Overview variant (validated by CanAccessDistrictReportAsync) — for the "Club Goal Setting" popup.
    public async Task<GoalClubMonthlyMatrixDto> GetScopedDistrictClubsMonthlyMatrixAsync(int memberId, int categoryId, int? yearId, int districtId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        if (!await CanAccessDistrictReportAsync(conn, memberId, districtId))
            throw new UnauthorizedAccessException("This district is outside your goal-setting scope.");
        return await BuildDistrictClubsMonthlyMatrixCoreAsync(conn, categoryId, districtId, yearId);
    }

    private async Task<GoalClubMonthlyMatrixDto> BuildDistrictClubsMonthlyMatrixCoreAsync(MySqlConnection conn, int categoryId, int districtId, int? yearId, bool excludeRotaract = false)
    {
        var result = new GoalClubMonthlyMatrixDto { CategoryId = categoryId };
        if (districtId == 0) return result;
        // Youth Service / Public Image are annual only - no month-wise matrix (user 2026-09-25).
        if (await IsAnnualOnlyCategoryAsync(conn, categoryId)) return result;

        var (resolvedYearId, yearLabel, isEditable) = await ResolveYearAsync(conn, yearId);
        if (resolvedYearId == 0) return result;
        result.YearId = resolvedYearId;
        result.YearLabel = yearLabel;
        result.CategoryName = await GetCategoryNameAsync(conn, categoryId);

        var clubs = (await conn.QueryAsync<(int Id, string Name)>(
            @"SELECT pk_club_id AS Id, ClubName AS Name FROM club_master
              WHERE fk_district_id = @D AND isdeleted = 0 AND IsActive = 1"
            + (excludeRotaract ? " AND " + ClubScopeSql.NotRotaract("") : "") + " ORDER BY ClubName",
            new { D = districtId })).ToList();

        // The per-club monthly form is the slow part, and a big district has 100+ clubs — building them
        // one after another ran past the browser's timeout ("Failed to load month-wise data", user
        // 2026-09-21). Bounded parallel build, each task on its OWN pooled connection; the results are
        // re-ordered by club name afterwards so the table looks exactly as before.
        var sem = new SemaphoreSlim(12);
        var forms = await Task.WhenAll(clubs.Select(async club =>
        {
            await sem.WaitAsync();
            try
            {
                using var c2 = CreateConnection();
                await c2.OpenAsync();
                var form = await BuildMonthlyFormAsync(c2, categoryId, resolvedYearId, "Club", club.Id, 0, club.Name, isEditable);
                return (Club: club, Form: form);
            }
            finally { sem.Release(); }
        }));

        bool metaSet = false;
        foreach (var (club, form) in forms)
        {
            if (form == null) continue;
            if (!metaSet)
            {
                result.Months = form.Months;
                result.Fields = form.Fields
                    .Select(f => new GoalMatrixMonthlyFieldDto { FieldKey = f.FieldKey, GroupName = f.GroupName, FieldLabel = f.FieldLabel, Unit = f.Unit })
                    .ToList();
                metaSet = true;
            }
            var row = new GoalClubMonthlyRowDto { ClubId = club.Id, ClubName = club.Name };
            foreach (var f in form.Fields)
            {
                var monthMap = new Dictionary<int, string?>();
                foreach (var kv in f.Monthly) monthMap[kv.Key] = FormatMonthlyNumber(kv.Value);
                row.Values[f.FieldKey] = monthMap;
                row.Totals[f.FieldKey] = FormatMonthlyNumber(f.Total);
            }
            result.Clubs.Add(row);
        }
        return result;
    }

    // Trim a monthly collected value to a clean string (whole numbers without decimals). null → "—" left to the UI.
    private static string? FormatMonthlyNumber(decimal? v)
    {
        if (!v.HasValue) return null;
        var n = v.Value;
        return n == decimal.Truncate(n) ? decimal.Truncate(n).ToString("0") : n.ToString("0.##");
    }

    // Per-club RAG band by active, non-honorary, synced member count — same rule + same underlying
    // count as LiveDistrictRagCountsAsync (Red 10-25, Amber 26-40, Green 41-50, SuperGreen 51+, None <10).
    private static async Task<(string Band, int Count)> LiveClubRagBandAsync(MySqlConnection conn, int clubId)
    {
        var mc = await conn.ExecuteScalarAsync<int>(
            @"SELECT COUNT(DISTINCT m.pk_member_master_profile_id)
              FROM club_master c
              JOIN club_members cm ON cm.fk_club_id = c.pk_club_id
                   AND cm.IsActive = 1 AND cm.isdeleted = 0 AND cm.IsHonoraryMember = 0
              JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                   AND m.isdeleted = 0
              WHERE c.pk_club_id = @Id AND c.IsActive = 1 AND c.isdeleted = 0 AND c.IsSyncedFromRotaryOrg = 1",
            new { Id = clubId });
        string band = mc >= 51 ? "SuperGreen" : mc >= 41 ? "Green" : mc >= 26 ? "Amber" : mc >= 10 ? "Red" : "None";
        return (band, mc);
    }

    // Formats a goal field's value for read-only display: Boolean → Yes/No, Percentage → "12%",
    // numbers trimmed of trailing zeros, else the text value.
    private static string? FormatGoalValue(GoalFieldWithValueDto f)
    {
        if (f.BoolValue.HasValue) return f.BoolValue.Value ? "Yes" : "No";
        if (f.NumericValue.HasValue)
        {
            var n = f.NumericValue.Value;
            var s = (n == decimal.Truncate(n)) ? decimal.Truncate(n).ToString("0") : n.ToString("0.##");
            return string.Equals(f.DataType, "Percentage", StringComparison.OrdinalIgnoreCase) ? s + "%" : s;
        }
        return string.IsNullOrWhiteSpace(f.TextValue) ? null : f.TextValue;
    }

    // ── SuperAdmin read-only Overview matrix (one zone × one category × one year) ──────────
    // A comparison grid: rows = the category's district-level metrics, columns = every active
    // district in the zone, each cell = that district's Target and/or Achieved value.
    //
    // Target-vs-Achieved derivation (there is no single "achieved" FieldRole — see the seed data):
    //   • Every district's fields are loaded through the SAME LoadFieldsWithValuesAsync used by the
    //     District goal form (so live-auto-filled achieved figures + saved/computed values match the
    //     form exactly). autoFillLive follows the year's editability, like GetDistrictGoalFormAsync.
    //   • Fields are paired into metric rows by (GroupName + base FieldKey), where the base key drops
    //     a trailing "_target" / "_achieved". A field is the row's TARGET when its key ends "_target"
    //     or its FieldRole == 'Target'; otherwise it's the ACHIEVED side (Reference/Computed baseline,
    //     e.g. the imported Foundation figures or the live "*_achieved" progress). Unpaired fields
    //     (pure targets in Public Image, pure references) simply fill one side of their row.
    // Districts = rows, one compact Target/Achieved/% block per category (SuperAdmin Goal Overview). Reuses
    // the per-category overview, taking each category's HEADLINE metric (first row with a Target) as the
    // summary. Adds a summed total per category. Anyone else gets an empty matrix.
    public async Task<GoalDistrictSummaryMatrixDto> GetScopedDistrictSummaryMatrixAsync(int memberId, int zoneId, int? yearId)
    {
        var result = new GoalDistrictSummaryMatrixDto { ZoneId = zoneId };
        using (var conn = CreateConnection())
        {
            await conn.OpenAsync();
            if (!await ClubAdminAccessHelper.IsSuperAdminAsync(conn, memberId)) return result;
        }
        var cats = await GetCategoriesAsync();
        var order = new List<GoalSummaryDistrictRowDto>();
        var byId = new Dictionary<int, GoalSummaryDistrictRowDto>();
        // Per (categoryId, metricIndex) totals accumulator.
        var totals = new Dictionary<int, List<(decimal Base, decimal Tgt, decimal Ach, bool Any, bool HasBase)>>();

        foreach (var cat in cats)
        {
            var m = await GetOverviewMatrixAsync(zoneId, cat.Id, yearId);
            if (m == null || m.Districts.Count == 0 || m.Rows.Count == 0) continue;

            if (string.IsNullOrEmpty(result.ZoneName)) { result.ZoneName = m.ZoneName; result.YearId = m.YearId; result.YearLabel = m.YearLabel; }

            // Merge the overview's rows by GroupName so each group (e.g. "New Clubs") is ONE metric that
            // carries its baseline ("Total No of Clubs as on July 1st") AND its target + achieved together —
            // exactly like the district admin form (the overview splits the baseline field and the
            // target/achieved field into separate rows; here we recombine them).
            // Collect the rows of each group first, then decide the SHAPE once per group:
            //   • the group has a target / achieved row → ONE metric, 4 columns
            //     (baseline · Target for the Current year · Achieved · Achievement(%)) — Membership, TRF.
            //   • the group has none → ONE column PER ROW, each just a number — RAG bands, Summary,
            //     Youth Service, Public Image. (Merging those hid all but one field: Public Image showed
            //     1 of its 8 Activities.)
            var byGroup = new List<(string Name, List<GoalOverviewRowDto> Rows)>();
            var seen = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            foreach (var r in m.Rows)
            {
                var gname = string.IsNullOrWhiteSpace(r.GroupName) ? r.Label : r.GroupName;
                if (!seen.TryGetValue(gname, out var gi)) { gi = byGroup.Count; seen[gname] = gi; byGroup.Add((gname, new List<GoalOverviewRowDto>())); }
                byGroup[gi].Rows.Add(r);
            }

            var groups = new List<(string GroupName, string BaselineLabel, GoalOverviewRowDto? Ref, GoalOverviewRowDto? Val, GoalOverviewRowDto? Ach, string? Rag, bool Single, List<GoalOverviewRowDto>? Combine)>();
            // PUBLIC IMAGE ONLY: every field is a plain figure the admin types (no target/achieved pair),
            // so each field gets its OWN column with its value — exactly the fields the district form
            // shows. Merged, the whole category rendered as three columns of dashes ("Activities" /
            // "Other Points" / "Suggestions"). Membership, Youth Service and TRF are untouched.
            bool perFieldColumns = string.Equals(m.CategoryName, "Public Image", StringComparison.OrdinalIgnoreCase)
                || string.Equals(m.CategoryName, "Youth Service", StringComparison.OrdinalIgnoreCase);
            // TRF's reference column is "Highest" — a comparison figure, NOT a July-1st baseline. Without
            // this flag SummaryPct subtracts it like a Membership baseline, so every TRF % read 0% (when
            // Target > Highest) or "—" (when Target < Highest). TRF is always Achieved ÷ Target × 100.
            bool trfRatioPct = IsTrfCategory(m.CategoryName);
            foreach (var (gname, grows) in byGroup)
            {
                var targetRow = grows.FirstOrDefault(x => x.HasTarget);
                var achievedRow = grows.FirstOrDefault(x => x.HasAchieved);
                if (!perFieldColumns && (targetRow != null || achievedRow != null))
                {
                    // Baseline = the group's own "as on July 1st" row (Membership). TRF has none → 3 columns.
                    var refRow = grows.FirstOrDefault(x => x.HasReference && !x.HasTarget && !x.HasAchieved);
                    var baselineLabel = !string.IsNullOrWhiteSpace(refRow?.ReferenceLabel)
                        ? ReportLabel(refRow!.ReferenceLabel) : "As on July 1st";
                    groups.Add((gname, baselineLabel, refRow, targetRow, achievedRow, null, false, null));
                }
                else if (gname.Equals("Suggestions", StringComparison.OrdinalIgnoreCase))
                {
                    // ONE "Suggestions" column holding the entries that were filled in, numbered one per
                    // line. The overview now hands us a single already-numbered row, so take it as it is -
                    // re-numbering it here would print "1) 1) ...". Older shapes (one row per slot) still
                    // get combined.
                    if (grows.Count == 1)
                        groups.Add((gname, "Suggestions", grows[0], null, null, null, true, null));
                    else
                        groups.Add((gname, "Suggestions", null, null, null, null, true, grows.ToList()));
                }
                else
                {
                    foreach (var r in grows)
                    {
                        // Youth Service: no Achievement(%) columns on the Goal Overview (user 2026-10-09);
                        // the District Admin's own form keeps them.
                        if (IsYouthCategory(m.CategoryName) && r.DataType == "Percentage") continue;
                        groups.Add((gname, ReportLabel(r.Label), r, r, r, RagBandOf(r.MetricKey, r.Label), true, null));
                    }
                }
            }

            var catDto = new GoalSummaryCategoryDto { CategoryId = cat.Id, Name = m.CategoryName };
            foreach (var g in groups)
                catDto.Metrics.Add(new GoalSummaryMetricDto
                {
                    GroupName = g.GroupName, BaselineLabel = g.BaselineLabel, RagBand = g.Rag,
                    SingleValue = g.Single, HasBaseline = !g.Single && g.Ref != null,
                    // Not every single-value column is a quantity. Public Image "Suggestions" holds the
                    // typed sentences and "Club Website %" holds a percentage - adding either one up is
                    // meaningless, and ParseGoalNum used to pull the digits out of the suggestion text and
                    // total THOSE (user 2026-09-29: the TOTAL row read 122).
                    NotSummable = g.Combine != null || IsSuggestionGroup(g.GroupName) || IsPercentMetric(g),
                });
            result.Categories.Add(catDto);
            var acc = Enumerable.Range(0, groups.Count).Select(_ => (Base: 0m, Tgt: 0m, Ach: 0m, Any: false, HasBase: false)).ToList();

            foreach (var d in m.Districts)
            {
                if (!byId.TryGetValue(d.DistrictId, out var row))
                {
                    row = new GoalSummaryDistrictRowDto { DistrictId = d.DistrictId, DistrictNumber = d.DistrictNumber };
                    byId[d.DistrictId] = row; order.Add(row);
                }
                var cells = new List<GoalSummaryCellDto>();
                for (int i = 0; i < groups.Count; i++)
                {
                    var g = groups[i];
                    if (g.Single)
                    {
                        // One column with a single value (RAG club count / Summary figure / the combined
                        // Suggestions list); totals sum it when it is a number.
                        string? oneStr;
                        if (g.Combine != null)
                        {
                            var entries = g.Combine
                                .Select(rw => rw.Cells.FirstOrDefault(c => c.DistrictId == d.DistrictId))
                                .Select(c => c?.Target ?? c?.Total ?? c?.Achieved)
                                .Where(s => !string.IsNullOrWhiteSpace(s))
                                .Select(s => s!.Trim())
                                .ToList();
                            oneStr = entries.Count == 0 ? null
                                : string.Join("\n", entries.Select((s, n) => $"{n + 1}) {s}"));
                        }
                        else
                        {
                            var oneCell = g.Ref?.Cells.FirstOrDefault(c => c.DistrictId == d.DistrictId);
                            oneStr = oneCell?.Total ?? oneCell?.Achieved ?? oneCell?.Target;
                        }
                        cells.Add(new GoalSummaryCellDto { Value = oneStr });
                        // Text and percentage columns carry no quantity - never add them up.
                        if (g.Combine != null || IsSuggestionGroup(g.GroupName) || IsPercentMetric(g)) continue;
                        var ra = acc[i];
                        var rn = ParseGoalNum(oneStr);
                        if (rn.HasValue) { ra.Base += rn.Value; ra.Any = true; ra.HasBase = true; }
                        acc[i] = ra;
                        continue;
                    }
                    var refCell = g.Ref?.Cells.FirstOrDefault(c => c.DistrictId == d.DistrictId);
                    var valCell = g.Val?.Cells.FirstOrDefault(c => c.DistrictId == d.DistrictId);
                    var achCell = g.Ach?.Cells.FirstOrDefault(c => c.DistrictId == d.DistrictId);
                    var baseStr = refCell?.Total ?? valCell?.Total;
                    // Target and Achieved can live on DIFFERENT rows (TRF "Total Giving": the target field
                    // and the achieved field have unrelated keys), so read each from its own row.
                    var tgtStr = valCell?.Target; var achStr = achCell?.Achieved ?? valCell?.Achieved;
                    var bn = ParseGoalNum(baseStr); var tn = ParseGoalNum(tgtStr); var an = ParseGoalNum(achStr);
                    cells.Add(new GoalSummaryCellDto
                    {
                        AsOnJul1 = baseStr, Target = tgtStr, Achieved = achStr,
                        // TRF passes no baseline → plain Achieved ÷ Target (see trfRatioPct above).
                        Pct = FormatPct(SummaryPct(trfRatioPct ? (decimal?)null : bn, tn, an, trfRatioPct ? 2 : 0)),
                    });
                    var a = acc[i];
                    if (bn.HasValue) { a.Base += bn.Value; a.Any = true; a.HasBase = true; }
                    if (tn.HasValue) { a.Tgt += tn.Value; a.Any = true; }
                    if (an.HasValue) { a.Ach += an.Value; a.Any = true; }
                    acc[i] = a;
                }
                row.Cells[cat.Id] = cells;
            }
            totals[cat.Id] = acc;
        }

        result.Districts = order.OrderBy(d => d.DistrictNumber, StringComparer.OrdinalIgnoreCase).ToList();
        foreach (var c in result.Categories)
        {
            if (!totals.TryGetValue(c.CategoryId, out var acc)) continue;
            for (int i = 0; i < acc.Count; i++)
            {
                var a = acc[i];
                // Single-value column (RAG band / Summary) → the summed number only. A text or
                // percentage column gets an EMPTY total rather than a made-up number.
                if (i < c.Metrics.Count && c.Metrics[i].SingleValue)
                {
                    c.Totals.Add(new GoalSummaryCellDto
                    {
                        Value = (!c.Metrics[i].NotSummable && a.HasBase) ? FormatMonthlyNumber(a.Base) : null,
                    });
                    continue;
                }
                // Same rule for the TOTAL row: TRF's "Highest" must not be subtracted like a baseline.
                bool totalsTrf = IsTrfCategory(c.Name);
                c.Totals.Add(new GoalSummaryCellDto
                {
                    AsOnJul1 = a.HasBase ? FormatMonthlyNumber(a.Base) : null,
                    Target = FormatMonthlyNumber(a.Tgt),
                    Achieved = FormatMonthlyNumber(a.Ach),
                    Pct = FormatPct(SummaryPct(a.HasBase && !totalsTrf ? a.Base : (decimal?)null, a.Tgt, a.Ach, totalsTrf ? 2 : 0)),
                });
            }
        }
        return result;
    }

    // % for the district overview: Membership metrics (which have a July-1 baseline) use progress on the
    // PLANNED increase = (achieved − baseline) / (target − baseline); others use achieved / target. Matches
    // the district admin form (e.g. New Clubs 141→154, achieved 142 → 7.69%).
    // decimals: TRF 2 (3.35%, same as the month-wise panel - user 2026-10-07), everything else 0.
    private static decimal? SummaryPct(decimal? baseline, decimal? target, decimal? achieved, int decimals = 0)
    {
        if (target is null || target.Value <= 0m) return null;
        decimal ach = achieved ?? 0m;
        if (baseline.HasValue)
        {
            decimal planned = target.Value - baseline.Value;
            if (planned <= 0m) return null;
            return Math.Max(0m, Math.Min(100m, Math.Round((ach - baseline.Value) / planned * 100m, 0, MidpointRounding.AwayFromZero)));
        }
        return Math.Max(0m, Math.Min(100m, Math.Round(ach / target.Value * 100m, decimals, MidpointRounding.AwayFromZero)));
    }
    private static string? FormatPct(decimal? p) => p.HasValue ? p.Value.ToString("0.##") + "%" : null;

    private static bool IsYouthCategory(string? name) => string.Equals(name, "Youth Service", StringComparison.OrdinalIgnoreCase);

    // Goal Overview reports (SuperAdmin, user 2026-10-09): Youth Service without its Achievement(%)
    // columns. The District Admin's own exports are not passed through this.
    private static void DropYouthPct(List<(string Name, List<GoalMetricComputed> Rows, List<GoalMonthPeriodDto> Months)> perCat)
    {
        foreach (var (name, rows, _) in perCat)
            if (IsYouthCategory(name)) rows.RemoveAll(x => x.FieldKey.EndsWith("_pct", StringComparison.Ordinal));
    }

    // Shorter wording for the OVERVIEW grid + every Excel report ONLY. The district / club admin Goal
    // Setting forms keep the seeded labels untouched — this is display text, never stored.
    private static string ReportLabel(string? label) => (label ?? "") switch
    {
        "Total No of Clubs as on July 1st" => "Clubs as on July 1st",
        "Total Members as on July 1st" => "Members as on July 1st",
        "Existing Women Members as on July 1st" => "Women Members as on July 1st",
        "Percentage Achieved" => "Achievement(%)",
        _ => label ?? "",
    };

    // TRF's target column is headed "Highest" (user request 2026-09-16); every other category keeps
    // "Target for the Current year".
    // Every category's target column carries the same header. TRF briefly showed "Highest" here
    // (2026-09-16) — reverted: "Highest" is now its OWN field sitting above the Target, so the Target
    // column keeps its own name in every grid and report.
    private static string TargetHeader(string? categoryName) => "Target for the Current year";

    // TRF / Foundation figures come from the Excel import, so their "Achieved" column names the month
    // the import covers - the same date the Goal Setting screens show (user 2026-10-01). Every other
    // category keeps the plain heading; so does TRF when nothing has been imported yet.
    private static string AchievedHeader(string? categoryName, string? trfAsOn)
        => IsTrfCategory(categoryName) && !string.IsNullOrWhiteSpace(trfAsOn)
            ? $"Achieved (as on {trfAsOn})"
            : "Achieved";

    // "Total Clubs" exists under Rotaract, Interact AND RCC, so a plain label repeats three times in a
    // report. Prefix the group when a label is not unique inside its category.
    private static string QualifiedLabel(GoalMetricComputed m, List<GoalMetricComputed> all)
    {
        var label = ReportLabel(m.Label);
        bool duplicate = all.Count(x => string.Equals(ReportLabel(x.Label), label, StringComparison.OrdinalIgnoreCase)) > 1;
        return duplicate && !string.IsNullOrWhiteSpace(m.GroupName) ? $"{m.GroupName} — {label}" : label;
    }

    // Membership RAG band of an overview row ("Red"/"Amber"/"Green"), or null for every other metric.
    // Matched on the field key, falling back to the row label (seeded as "RED" / "AMBER" / "GREEN").
    private static string? RagBandOf(string? metricKey, string? label)
    {
        var k = (metricKey ?? "").Trim().ToLowerInvariant();
        var l = (label ?? "").Trim().ToLowerInvariant();
        if (k == "rag_red" || l == "red") return "Red";
        if (k == "rag_amber" || l == "amber") return "Amber";
        if (k == "rag_green" || l == "green") return "Green";
        if (k == "rag_super_green" || l == "super green") return "SuperGreen";
        return null;
    }

    // Pull a leading number out of a formatted cell ("12%", "1,200", "—") for totals/percent math.
    // A percentage column is a rate, not a count: four districts at 100% do not make 400%.
    private static bool IsPercentMetric(
        (string GroupName, string BaselineLabel, GoalOverviewRowDto? Ref, GoalOverviewRowDto? Val,
         GoalOverviewRowDto? Ach, string? Rag, bool Single, List<GoalOverviewRowDto>? Combine) g)
        => g.Single && g.Combine == null
           && (g.BaselineLabel.Contains('%')
               || g.BaselineLabel.Contains("Percentage", StringComparison.OrdinalIgnoreCase));

    private static decimal? ParseGoalNum(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        var cleaned = new string(s.Where(ch => char.IsDigit(ch) || ch == '.' || ch == '-').ToArray());
        return decimal.TryParse(cleaned, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var v) ? v : (decimal?)null;
    }

    public async Task<GoalOverviewMatrixDto?> GetOverviewMatrixAsync(int zoneId, int categoryId, int? yearId)
    {
        if (zoneId <= 0) return null;
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var zoneName = await conn.ExecuteScalarAsync<string?>(
            "SELECT ZoneName FROM zone_master WHERE pk_zone_id = @Id", new { Id = zoneId });
        if (zoneName == null) return null;

        var (resolvedYearId, yearLabel, isEditable) = await ResolveYearAsync(conn, yearId);
        if (resolvedYearId == 0) return null;

        var categoryName = await GetCategoryNameAsync(conn, categoryId);

        // Active districts of the zone.
        var districtRows = (await conn.QueryAsync<dynamic>(@"
            SELECT pk_district_id AS id, DistrictNumber AS number
            FROM district_master
            WHERE fk_zone_id = @Z AND isdeleted = 0 AND IsActive = 1
            ORDER BY DistrictNumber", new { Z = zoneId })).ToList();

        var districts = districtRows.Select(r => new GoalOverviewDistrictDto
        {
            DistrictId = Convert.ToInt32(r.id),
            DistrictNumber = (string)r.number,
        }).ToList();

        var result = new GoalOverviewMatrixDto
        {
            ZoneId = zoneId, ZoneName = zoneName, CategoryId = categoryId, CategoryName = categoryName,
            YearId = resolvedYearId, YearLabel = yearLabel, Districts = districts,
        };

        // Row template + field defs (identical field set across districts — only values differ).
        var templateFields = await LoadFieldsWithValuesAsync(conn, categoryId, resolvedYearId, "District", 0, 0, autoFillLive: false);
        if (templateFields.Count == 0) return result;

        // Per-district field values, keyed by fieldId, using the exact District-form loader.
        var perDistrict = new Dictionary<int, Dictionary<int, GoalFieldWithValueDto>>();
        foreach (var d in districts)
        {
            var fields = await LoadFieldsWithValuesAsync(conn, categoryId, resolvedYearId, "District", 0, d.DistrictId, autoFillLive: isEditable);
            perDistrict[d.DistrictId] = fields.ToDictionary(f => f.FieldId);
        }

        // Group the template fields into metric rows, preserving first-seen order. Each row can carry
        // up to three values, matching the district/club admin pages: a Reference "Total" (baseline
        // like Total No of Clubs / Existing Members), a Target (entered), and an Achieved ("_achieved").
        var rowOrder = new List<(string GroupName, string BaseKey)>();
        var rowFields = new Dictionary<(string, string), (GoalFieldWithValueDto? Target, GoalFieldWithValueDto? Achieved, GoalFieldWithValueDto? Reference)>();
        var suggestionFields = new List<GoalFieldWithValueDto>();   // the 10 slots, collapsed into one row
        foreach (var f in templateFields)
        {
            // Percentage-Achievement fields (Achieved ÷ Target) are shown in the read-only goal panels,
            // not in this Total/Target/Achieved matrix — skip them so they don't add stray metric rows.
            if (!YouthDistrictOwnKeys.Contains(f.FieldKey)
                && (f.FieldKey.EndsWith("_pct", StringComparison.OrdinalIgnoreCase)
                    || f.FieldKey.EndsWith("_percentage_achievement", StringComparison.OrdinalIgnoreCase)
                    || f.FieldKey == "percentage_increase")) continue;
            // Public Image "Suggestions": all 10 slots carry the identical label, so keying them by
            // their own field key produced ten identical rows. One key = one row.
            var baseKey = IsSuggestionGroup(f.GroupName) ? "suggestions" : StripRoleSuffix(f.FieldKey);
            var key = (f.GroupName, baseKey);
            if (!rowFields.ContainsKey(key)) { rowFields[key] = (null, null, null); rowOrder.Add(key); }
            if (IsSuggestionGroup(f.GroupName)) { suggestionFields.Add(f); continue; }
            var cur = rowFields[key];
            if (IsTargetField(f)) cur.Target ??= f;
            else if (f.FieldKey.EndsWith("_achieved", StringComparison.OrdinalIgnoreCase)) cur.Achieved ??= f;
            else cur.Reference ??= f;   // Reference/Computed baseline → the "Total" value
            rowFields[key] = cur;
        }

        foreach (var (groupName, baseKey) in rowOrder)
        {
            // ── the one collapsed Suggestions row ──
            if (baseKey == "suggestions" && suggestionFields.Count > 0)
            {
                var sRow = new GoalOverviewRowDto
                {
                    MetricKey = "suggestions", GroupName = groupName, Label = "Suggestions",
                    DataType = "Text", HasReference = true, HasTarget = false, HasAchieved = false,
                };
                foreach (var d in districts)
                {
                    var byFieldS = perDistrict[d.DistrictId];
                    var entries = suggestionFields
                        .Select(f => byFieldS.TryGetValue(f.FieldId, out var v) ? v.TextValue : null)
                        .Where(t => !string.IsNullOrWhiteSpace(t))
                        .Select(t => t!.Trim())
                        .ToList();
                    sRow.Cells.Add(new GoalOverviewCellDto
                    {
                        DistrictId = d.DistrictId,
                        Total = entries.Count == 0 ? null
                            : string.Join("\n", entries.Select((t, i) => $"{i + 1}) {t}")),
                    });
                }
                result.Rows.Add(sRow);
                continue;
            }

            var (tmplTarget, tmplAchieved, tmplReference) = rowFields[(groupName, baseKey)];
            var sample = tmplTarget ?? tmplAchieved ?? tmplReference!;   // at least one is non-null

            var row = new GoalOverviewRowDto
            {
                MetricKey = baseKey,
                GroupName = groupName,
                // Youth district "Achieved" / "Rotaractors Achieved" keep their exact label: RowLabel
                // strips the word "Achieved" (right for Membership's "New Clubs — Achieved"), which
                // would have left these columns titled just "Rotaract" / "Rotaractors".
                Label = YouthDistrictOwnKeys.Contains(sample.FieldKey)
                    ? sample.FieldLabel
                    : RowLabel(groupName, tmplTarget, tmplAchieved, tmplReference),
                ReferenceLabel = tmplReference?.FieldLabel,
                DataType = sample.DataType,
                Unit = sample.Unit,
                HasReference = tmplReference != null,
                HasTarget = tmplTarget != null,
                HasAchieved = tmplAchieved != null,
            };

            foreach (var d in districts)
            {
                var byField = perDistrict[d.DistrictId];
                GoalFieldWithValueDto? rv = tmplReference != null && byField.TryGetValue(tmplReference.FieldId, out var rf) ? rf : null;
                GoalFieldWithValueDto? tv = tmplTarget != null && byField.TryGetValue(tmplTarget.FieldId, out var tf) ? tf : null;
                GoalFieldWithValueDto? av = tmplAchieved != null && byField.TryGetValue(tmplAchieved.FieldId, out var af) ? af : null;
                row.Cells.Add(new GoalOverviewCellDto
                {
                    DistrictId = d.DistrictId,
                    Total = FormatFieldValue(rv),
                    Target = FormatFieldValue(tv),
                    Achieved = FormatFieldValue(av),
                });
            }
            result.Rows.Add(row);
        }

        return result;
    }

    // Public Image "Suggestions" - ten slots behind one label, always shown as a single numbered list.
    private static bool IsSuggestionGroup(string? groupName)
        => (groupName ?? "").Trim().Equals("Suggestions", StringComparison.OrdinalIgnoreCase);

    // "aks_target" → "aks", "new_clubs_achieved" → "new_clubs", "total_clubs" → "total_clubs".
    private static string StripRoleSuffix(string fieldKey)
    {
        if (fieldKey.EndsWith("_target", StringComparison.OrdinalIgnoreCase))
            return fieldKey[..^"_target".Length];
        if (fieldKey.EndsWith("_achieved", StringComparison.OrdinalIgnoreCase))
            return fieldKey[..^"_achieved".Length];
        return fieldKey;
    }

    private static bool IsTargetField(GoalFieldWithValueDto f)
        => f.FieldKey.EndsWith("_target", StringComparison.OrdinalIgnoreCase) || f.FieldRole == "Target";

    // Row label: when both fields carry the generic "Target"/"Achieved" labels (the Foundation
    // shape), fall back to the GroupName; otherwise use the specific field label with the generic
    // Target/Achieved word stripped.
    private static string RowLabel(string groupName, GoalFieldWithValueDto? target, GoalFieldWithValueDto? achieved, GoalFieldWithValueDto? reference = null)
    {
        var raw = target?.FieldLabel ?? achieved?.FieldLabel ?? reference?.FieldLabel ?? groupName;
        var stripped = raw.Replace("Achieved", "", StringComparison.OrdinalIgnoreCase)
                          .Replace("Target", "", StringComparison.OrdinalIgnoreCase)
                          .Trim(' ', '-', '–', ':');
        return string.IsNullOrEmpty(stripped) ? groupName : stripped;
    }

    // Pre-format a field's value for display; null when the field has no value set.
    private static string? FormatFieldValue(GoalFieldWithValueDto? f)
    {
        if (f == null) return null;
        switch (f.DataType)
        {
            case "Boolean":
                return f.BoolValue == null ? null : (f.BoolValue.Value ? "Yes" : "No");
            case "Text":
                return string.IsNullOrWhiteSpace(f.TextValue) ? null : f.TextValue;
            default:
                if (f.NumericValue == null) return null;
                var v = f.NumericValue.Value;
                var num = v == Math.Floor(v) ? ((long)v).ToString() : v.ToString("0.##");
                if (f.DataType == "Currency") return (f.Unit ?? "$") + num;
                if (f.DataType == "Percentage") return num + "%";
                return num;
        }
    }

    // Goal Overview (SuperAdmin): every active district with its goal status for one category + year.
    public async Task<List<GoalDistrictSummaryDto>> GetScopedDistrictsGoalListAsync(int memberId, int categoryId, int yearId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        if (!await ClubAdminAccessHelper.IsSuperAdminAsync(conn, memberId))
            throw new UnauthorizedAccessException("You have no goal-setting oversight access for this category.");

        var rows = await conn.QueryAsync<dynamic>(@"
            SELECT d.pk_district_id AS districtId, d.DistrictNumber AS districtNumber, d.fk_zone_id AS zoneId, z.ZoneName AS zoneName,
                   (SELECT COUNT(*) FROM goal_entries e
                     JOIN goal_fields f ON f.pk_field_id = e.fk_field_id AND f.isdeleted = 0
                    WHERE f.fk_category_id = @CategoryId AND e.fk_year_id = @YearId
                      AND e.EntityType = 'District' AND e.fk_district_id = d.pk_district_id AND e.isdeleted = 0) AS entryCount,
                   (SELECT DATE_FORMAT(MAX(COALESCE(e.modified_date, e.created_date)), '%Y-%m-%d %H:%i')
                      FROM goal_entries e JOIN goal_fields f ON f.pk_field_id = e.fk_field_id AND f.isdeleted = 0
                     WHERE f.fk_category_id = @CategoryId AND e.fk_year_id = @YearId
                       AND e.EntityType = 'District' AND e.fk_district_id = d.pk_district_id AND e.isdeleted = 0) AS lastUpdatedDate
            FROM district_master d
            LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE d.isdeleted = 0 AND d.IsActive = 1
            ORDER BY d.DistrictNumber",
            new { CategoryId = categoryId, YearId = yearId });

        return rows.Select(r => new GoalDistrictSummaryDto
        {
            DistrictId = Convert.ToInt32(r.districtId),
            DistrictNumber = (string)r.districtNumber,
            ZoneId = r.zoneId == null ? 0 : Convert.ToInt32(r.zoneId),
            ZoneName = r.zoneName as string,
            HasAnyGoalSet = Convert.ToInt32(r.entryCount ?? 0L) > 0,
            LastUpdatedDate = r.lastUpdatedDate as string,
        }).ToList();
    }

    // ── Messaging (two-way threads; formerly "comments") ──────────────────────
    // A thread is (category, district, year) for the district thread (clubId 0), or
    // (category, district, club, year) for a club thread (clubId > 0). Everyone with
    // access to a thread sees the WHOLE conversation (two-way chat) — the tier is now only
    // a display label + post-eligibility gate, no longer a read filter.
    //
    // District thread participants: District Admin (tier 1) + SuperAdmin (5).
    // Club thread participants: the Club Admin of that club (tier 1) + its District Admin
    // (tier 2) + SuperAdmin (5).
    private async Task<int?> ResolveThreadTierAsync(MySqlConnection conn, int memberId, int categoryId, int districtId, int clubId)
    {
        if (await ClubAdminAccessHelper.IsSuperAdminAsync(conn, memberId)) return 5;

        if (clubId > 0)
        {
            var isClubAdmin = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM member_roles
                WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 2
                  AND fk_club_id = @ClubId AND IsActive = 1 AND isdeleted = 0",
                new { MemberId = memberId, ClubId = clubId });
            if (isClubAdmin > 0) return 1;
            if (await ClubAdminAccessHelper.IsDistrictAdminWithClubAccessAsync(conn, memberId, clubId)) return 2;
            return null;
        }

        var isDistrictAdmin = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM member_roles
            WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 2
              AND fk_district_id = @DistrictId AND (fk_club_id IS NULL OR fk_club_id = 0)
              AND IsActive = 1 AND isdeleted = 0",
            new { MemberId = memberId, DistrictId = districtId });
        return isDistrictAdmin > 0 ? 1 : (int?)null;
    }

    // Human label for a sender's tier, shown under their name in the chat bubble.
    private static string TierLabel(int tier, bool clubThread) => clubThread
        ? tier switch { 5 => "SuperAdmin", 2 => "District Admin", 1 => "Club Admin", _ => "" }
        : tier switch { 5 => "SuperAdmin", 1 => "District Admin", _ => "" };

    public async Task<List<GoalCommentDto>> GetCommentsAsync(int memberId, int categoryId, int districtId, int clubId, int yearId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var tier = await ResolveThreadTierAsync(conn, memberId, categoryId, districtId, clubId);
        if (tier == null) throw new UnauthorizedAccessException("You do not have access to this message thread.");

        // Two-way: everyone in the thread sees every message (no PostedByTier filter).
        // The poster is labelled by their tier.
        var rows = await conn.QueryAsync<dynamic>(@"
            SELECT c.pk_id AS id, c.CommentText AS commentText, c.PostedByMemberId AS postedByMemberId,
                   m.MemberName AS postedByName, c.PostedByTier AS postedByTier,
                   DATE_FORMAT(c.created_date, '%Y-%m-%d %H:%i') AS createdDate
            FROM goal_comments c
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = c.PostedByMemberId
            WHERE c.fk_district_id = @DistrictId AND c.fk_category_id = @CategoryId
              AND c.fk_club_id = @ClubId AND c.fk_year_id = @YearId AND c.isdeleted = 0
            ORDER BY c.created_date ASC",
            new { DistrictId = districtId, CategoryId = categoryId, ClubId = clubId, YearId = yearId });

        bool clubThread = clubId > 0;
        var list = new List<GoalCommentDto>();
        foreach (var r in rows)
        {
            int postedByTier = Convert.ToInt32(r.postedByTier);
            int postedBy = Convert.ToInt32(r.postedByMemberId);
            list.Add(new GoalCommentDto
            {
                Id = Convert.ToInt64(r.id),
                CommentText = (string)r.commentText,
                PostedByMemberId = postedBy,
                PostedByName = r.postedByName as string ?? "",
                PostedByTier = postedByTier,
                PostedByRoleLabel = TierLabel(postedByTier, clubThread),
                IsMine = postedBy == memberId,
                CreatedDate = r.createdDate as string,
            });
        }
        return list;
    }

    public async Task<GoalCommentDto> PostCommentAsync(int memberId, int categoryId, int districtId, int clubId, int yearId, string commentText)
    {
        if (string.IsNullOrWhiteSpace(commentText)) throw new InvalidOperationException("Message text is required.");
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var tier = await ResolveThreadTierAsync(conn, memberId, categoryId, districtId, clubId);
        if (tier == null) throw new UnauthorizedAccessException("You do not have access to message on this thread.");

        var trimmed = commentText.Trim();
        var id = await conn.ExecuteScalarAsync<long>(@"
            INSERT INTO goal_comments (fk_category_id, fk_district_id, fk_club_id, fk_year_id, CommentText, PostedByMemberId, PostedByTier, created_date, isdeleted)
            VALUES (@CategoryId, @DistrictId, @ClubId, @YearId, @CommentText, @MemberId, @Tier, NOW(), 0);
            SELECT LAST_INSERT_ID();",
            new { CategoryId = categoryId, DistrictId = districtId, ClubId = clubId, YearId = yearId, CommentText = trimmed, MemberId = memberId, Tier = tier.Value });

        var memberName = await conn.ExecuteScalarAsync<string>(
            "SELECT MemberName FROM member_master_profile WHERE pk_member_master_profile_id = @Id", new { Id = memberId }) ?? "";

        return new GoalCommentDto
        {
            Id = id, CommentText = trimmed, PostedByMemberId = memberId, PostedByName = memberName,
            PostedByTier = tier.Value, PostedByRoleLabel = TierLabel(tier.Value, clubId > 0),
            IsMine = true, CreatedDate = DateTime.Now.ToString("yyyy-MM-dd HH:mm"),
        };
    }

    private static async Task<int?> DistrictZoneIdAsync(MySqlConnection conn, int districtId)
        => await conn.ExecuteScalarAsync<int?>(
            "SELECT fk_zone_id FROM district_master WHERE pk_district_id = @Id", new { Id = districtId });

    private static async Task<string> MemberNameAsync(MySqlConnection conn, int memberId)
        => (await conn.ExecuteScalarAsync<string>(
            "SELECT MemberName FROM member_master_profile WHERE pk_member_master_profile_id = @Id", new { Id = memberId })) ?? "";

    // Red dot: unread District Admin / DG messages in the zone that the viewer may read.
    public async Task<bool> HasUnreadZoneMessagesAsync(int memberId, int zoneId, int yearId)
    {
        if (zoneId <= 0) return false;
        using var conn = CreateConnection();
        await conn.OpenAsync();
        return await HasUnreadDistrictSideAsync(conn, memberId, zoneId, yearId);
    }

    // ── District-side messages (user 2026-10-09) ────────────────────────────────────────────────
    // A District Admin or the District Governor writes about one category. The SuperAdmin reads it;
    // nobody replies. Stored in goal_comments with PostedByTier = 1 and ThreadOwnerMemberId = -districtId.
    // The same negative key drives goal_message_thread_seen.
    private const int DistrictSideTier = 1;
    private static int DistrictThreadKey(int districtId) => -districtId;

    // "District Governor" / "District Admin" for a member writing about this district, else null.
    private static async Task<string?> DistrictSidePosterRoleAsync(MySqlConnection conn, int memberId, int districtId, int yearId)
    {
        if (memberId <= 0 || districtId <= 0) return null;
        if (await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM district_governors
                WHERE fk_member_id = @M AND fk_district_id = @D AND fk_year_id = @Y AND COALESCE(isdeleted,0) = 0",
                new { M = memberId, D = districtId, Y = yearId }) > 0)
            return "District Governor";
        if (await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM member_roles
                WHERE fk_member_master_profile_id = @M AND fk_role_id = 2 AND fk_district_id = @D
                  AND COALESCE(fk_club_id,0) = 0 AND IsActive = 1 AND isdeleted = 0",
                new { M = memberId, D = districtId }) > 0)
            return "District Admin";
        return null;
    }

    // Rows of goal_comments c (district-side) the viewer may READ, as SQL. SuperAdmin -> everything.
    // The district's own Admin / DG see their district.
    private const string DistrictSideScopeSql = @"(
        EXISTS (SELECT 1 FROM member_roles r
                WHERE r.fk_member_master_profile_id = @Viewer AND r.IsActive = 1 AND r.isdeleted = 0
                  AND r.fk_role_id = 2 AND r.fk_district_id = c.fk_district_id AND COALESCE(r.fk_club_id,0) = 0)
     OR EXISTS (SELECT 1 FROM district_governors g
                WHERE g.fk_member_id = @Viewer AND g.fk_district_id = c.fk_district_id AND g.fk_year_id = c.fk_year_id AND COALESCE(g.isdeleted,0) = 0))";

    private static string DistrictSideFilter(bool isSuper) =>
        $"c.PostedByTier = {DistrictSideTier} AND c.ThreadOwnerMemberId < 0 AND c.isdeleted = 0"
        + (isSuper ? "" : " AND " + DistrictSideScopeSql);

    private sealed class DistrictSideRow
    {
        public long Id { get; set; }
        public int CategoryId { get; set; }
        public string CategoryName { get; set; } = "";
        public int CategorySort { get; set; }
        public int DistrictId { get; set; }
        public string? DistrictNumber { get; set; }
        public int ZoneId { get; set; }
        public int YearId { get; set; }
        public int PostedBy { get; set; }
        public string FromName { get; set; } = "";
        public string Text { get; set; } = "";
        public DateTime Created { get; set; }
        public string? FromRole { get; set; }   // filled after the query
    }

    private static async Task<List<DistrictSideRow>> DistrictSideRowsAsync(
        MySqlConnection conn, int viewer, bool isSuper, int yearId, int zoneId, int categoryId, int districtId)
    {
        var rows = (await conn.QueryAsync<DistrictSideRow>($@"
            SELECT c.pk_id AS Id, c.fk_category_id AS CategoryId,
                   IF(cat.Name = 'TRF', 'Foundation', cat.Name) AS CategoryName, cat.SortOrder AS CategorySort,
                   c.fk_district_id AS DistrictId, dm.DistrictNumber AS DistrictNumber, c.fk_zone_id AS ZoneId,
                   c.fk_year_id AS YearId, c.PostedByMemberId AS PostedBy, COALESCE(m.MemberName,'') AS FromName,
                   c.CommentText AS Text, c.created_date AS Created
            FROM goal_comments c
            JOIN goal_categories cat ON cat.pk_category_id = c.fk_category_id AND cat.isdeleted = 0
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = c.PostedByMemberId
            LEFT JOIN district_master dm ON dm.pk_district_id = c.fk_district_id
            WHERE c.fk_year_id = @Y AND {DistrictSideFilter(isSuper)}
              AND (@Z = 0 OR c.fk_zone_id = @Z) AND (@Cat = 0 OR c.fk_category_id = @Cat) AND (@D = 0 OR c.fk_district_id = @D)
            ORDER BY c.created_date, c.pk_id",
            new { Viewer = viewer, Y = yearId, Z = zoneId, Cat = categoryId, D = districtId })).ToList();
        // The writer's role on the district (DG wins); a writer who has since left the post keeps the
        // plain "District Admin" label.
        var roleCache = new Dictionary<(int, int, int), string>();
        foreach (var r in rows)
        {
            var key = (r.PostedBy, r.DistrictId, r.YearId);
            if (!roleCache.TryGetValue(key, out var role))
                roleCache[key] = role = await DistrictSidePosterRoleAsync(conn, r.PostedBy, r.DistrictId, r.YearId) ?? "District Admin";
            r.FromRole = role;
        }
        return rows;
    }

    private static async Task<DateTime?> DistrictSideLastSeenAsync(MySqlConnection conn, int viewer, int districtId, int categoryId, int yearId)
        => await conn.ExecuteScalarAsync<DateTime?>(@"
            SELECT last_seen_date FROM goal_message_thread_seen
            WHERE fk_member_id = @M AND ThreadOwnerMemberId = @O AND fk_category_id = @C AND fk_year_id = @Y",
            new { M = viewer, O = DistrictThreadKey(districtId), C = categoryId, Y = yearId });

    private static async Task MarkDistrictSideSeenAsync(MySqlConnection conn, int viewer, int districtId, int categoryId, int yearId)
    {
        if (viewer <= 0 || districtId <= 0) return;
        await conn.ExecuteAsync(@"
            INSERT INTO goal_message_thread_seen (fk_member_id, ThreadOwnerMemberId, fk_category_id, fk_year_id, last_seen_date)
            VALUES (@M, @O, @C, @Y, NOW())
            ON DUPLICATE KEY UPDATE last_seen_date = NOW()",
            new { M = viewer, O = DistrictThreadKey(districtId), C = categoryId, Y = yearId });
    }

    private static GoalCommentDto ToCommentDto(DistrictSideRow r, int viewer) => new()
    {
        Id = r.Id, CommentText = r.Text, PostedByMemberId = r.PostedBy, PostedByName = r.FromName,
        PostedByTier = DistrictSideTier, PostedByRoleLabel = r.FromRole, IsMine = r.PostedBy == viewer,
        CreatedDate = r.Created.ToString("yyyy-MM-dd HH:mm"), DistrictId = r.DistrictId, DistrictNumber = r.DistrictNumber,
        CategoryName = r.CategoryName,
    };

    // One district + category conversation. The district's Admin / DG can write (CanPost); every
    // other permitted viewer reads, and opening it marks it read for them.
    public async Task<GoalDistrictMessagesDto> GetDistrictMessagesAsync(int memberId, int categoryId, int districtId, int yearId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        bool isSuper = await ClubAdminAccessHelper.IsSuperAdminAsync(conn, memberId);
        var posterRole = await DistrictSidePosterRoleAsync(conn, memberId, districtId, yearId);
        var rows = await DistrictSideRowsAsync(conn, memberId, isSuper, yearId, 0, categoryId, districtId);
        if (!isSuper && posterRole == null && rows.Count == 0
            && !await CanReadDistrictSideAsync(conn, memberId, categoryId, districtId, yearId))
            throw new UnauthorizedAccessException("You cannot view this district's messages.");
        if (posterRole == null) await MarkDistrictSideSeenAsync(conn, memberId, districtId, categoryId, yearId);
        var dnum = await conn.ExecuteScalarAsync<string?>("SELECT DistrictNumber FROM district_master WHERE pk_district_id=@D", new { D = districtId });
        var catName = await conn.ExecuteScalarAsync<string?>(
            "SELECT IF(Name = 'TRF', 'Foundation', Name) FROM goal_categories WHERE pk_category_id=@C", new { C = categoryId }) ?? "";
        return new GoalDistrictMessagesDto
        {
            DistrictId = districtId, DistrictNumber = dnum, CategoryId = categoryId, CategoryName = catName,
            CanPost = posterRole != null, PosterRole = posterRole,
            Messages = rows.Select(r => ToCommentDto(r, memberId)).ToList(),
        };
    }

    // Can this viewer read the district+category conversation (used when it has no messages yet).
    private static async Task<bool> CanReadDistrictSideAsync(MySqlConnection conn, int viewer, int categoryId, int districtId, int yearId)
    {
        var zoneId = await DistrictZoneIdAsync(conn, districtId) ?? 0;
        // Evaluate the same scope rule against a virtual row for this district / category / zone.
        return await conn.ExecuteScalarAsync<int>($@"
            SELECT COUNT(*) FROM (SELECT @Cat AS fk_category_id, @D AS fk_district_id, @Z AS fk_zone_id, @Y AS fk_year_id) c
            WHERE {DistrictSideScopeSql}",
            new { Viewer = viewer, Cat = categoryId, D = districtId, Z = zoneId, Y = yearId }) > 0;
    }

    public async Task<GoalCommentDto> PostDistrictMessageAsync(int memberId, int categoryId, int districtId, int yearId, string text)
    {
        if (string.IsNullOrWhiteSpace(text)) throw new InvalidOperationException("Message cannot be empty.");
        if (text.Trim().Length > 4000) throw new InvalidOperationException("Message is too long (max 4000 characters).");
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var role = await DistrictSidePosterRoleAsync(conn, memberId, districtId, yearId)
            ?? throw new UnauthorizedAccessException("Only this district's District Admin or District Governor can send a message here.");
        var catOk = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM goal_categories WHERE pk_category_id=@C AND isdeleted=0", new { C = categoryId });
        if (catOk == 0) throw new InvalidOperationException("Unknown category.");
        var zoneId = await DistrictZoneIdAsync(conn, districtId) ?? 0;
        var trimmed = text.Trim();
        var id = await conn.ExecuteScalarAsync<long>(@"
            INSERT INTO goal_comments (fk_category_id, fk_district_id, fk_club_id, fk_year_id, ThreadOwnerMemberId, fk_zone_id, CommentText, PostedByMemberId, PostedByTier, created_date, isdeleted)
            VALUES (@C, @D, 0, @Y, @O, @Z, @Text, @M, @Tier, NOW(), 0); SELECT LAST_INSERT_ID();",
            new { C = categoryId, D = districtId, Y = yearId, O = DistrictThreadKey(districtId), Z = zoneId, Text = trimmed, M = memberId, Tier = DistrictSideTier });
        return new GoalCommentDto
        {
            Id = id, CommentText = trimmed, PostedByMemberId = memberId, PostedByName = await MemberNameAsync(conn, memberId),
            PostedByTier = DistrictSideTier, PostedByRoleLabel = role, IsMine = true,
            CreatedDate = DateTime.Now.ToString("yyyy-MM-dd HH:mm"), DistrictId = districtId,
            DistrictNumber = await conn.ExecuteScalarAsync<string?>("SELECT DistrictNumber FROM district_master WHERE pk_district_id=@D", new { D = districtId }),
        };
    }

    // Inbox for the reader (SuperAdmin): one row per district + category that has district-side
    // messages the viewer may read, newest first, with unread counts.
    public async Task<List<GoalDistrictConversationDto>> GetDistrictMessageInboxAsync(int memberId, int zoneId, int yearId, int categoryId, int districtId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();
        bool isSuper = await ClubAdminAccessHelper.IsSuperAdminAsync(conn, memberId);
        var rows = await DistrictSideRowsAsync(conn, memberId, isSuper, yearId, zoneId, categoryId, districtId);
        var result = new List<GoalDistrictConversationDto>();
        foreach (var g in rows.GroupBy(r => (r.DistrictId, r.CategoryId)))
        {
            var last = g.OrderBy(r => r.Created).ThenBy(r => r.Id).Last();
            var seen = await DistrictSideLastSeenAsync(conn, memberId, g.Key.DistrictId, g.Key.CategoryId, yearId);
            result.Add(new GoalDistrictConversationDto
            {
                DistrictId = g.Key.DistrictId, DistrictNumber = last.DistrictNumber, CategoryId = g.Key.CategoryId,
                CategoryName = last.CategoryName, MessageCount = g.Count(),
                UnreadCount = g.Count(r => r.PostedBy != memberId && (seen == null || r.Created > seen.Value)),
                LastFrom = last.FromName, LastFromRole = last.FromRole, LastPreview = last.Text,
                LastDate = last.Created.ToString("yyyy-MM-dd HH:mm"),
            });
        }
        return result.OrderByDescending(x => x.LastDate).ToList();
    }

    // Red dot: any district-side message in the zone the viewer may read and has not seen.
    private static async Task<bool> HasUnreadDistrictSideAsync(MySqlConnection conn, int memberId, int zoneId, int yearId)
    {
        bool isSuper = await ClubAdminAccessHelper.IsSuperAdminAsync(conn, memberId);
        return await conn.ExecuteScalarAsync<int>($@"
            SELECT COUNT(*) FROM goal_comments c
            LEFT JOIN goal_message_thread_seen s
                   ON s.fk_member_id = @Viewer AND s.ThreadOwnerMemberId = c.ThreadOwnerMemberId
                  AND s.fk_category_id = c.fk_category_id AND s.fk_year_id = c.fk_year_id
            WHERE c.fk_zone_id = @Z AND c.fk_year_id = @Y AND {DistrictSideFilter(isSuper)}
              AND c.PostedByMemberId <> @Viewer
              AND (s.last_seen_date IS NULL OR c.created_date > s.last_seen_date)",
            new { Viewer = memberId, Z = zoneId, Y = yearId }) > 0;
    }

    // Excel: district-side rows the viewer may read, as (category, district, role, from, message, date).
    private static async Task<List<DistrictSideRow>> DistrictSideReportRowsAsync(
        MySqlConnection conn, int memberId, int yearId, int zoneId, int categoryId, int districtId)
        => await DistrictSideRowsAsync(conn, memberId, await ClubAdminAccessHelper.IsSuperAdminAsync(conn, memberId),
            yearId, zoneId, categoryId, districtId);

    // ── Goal messages report (SuperAdmin) ───────────────────────────────────────────────────────
    // Every District Admin / DG goal message in a zone, filterable by category (0 = all) and district
    // (0 = all). Columns: Category · District · Role · From · Message · Date & Time.
    public async Task<byte[]?> BuildGoalMessagesReportExcelAsync(int memberId, int zoneId, int yearId, int categoryId, int districtId)
    {
        if (zoneId <= 0) return null;
        using var conn = CreateConnection();
        await conn.OpenAsync();
        if (!await ClubAdminAccessHelper.IsSuperAdminAsync(conn, memberId))
            throw new UnauthorizedAccessException("You are not authorised to view this zone's messages.");

        var yearLabel = await conn.ExecuteScalarAsync<string>(
            "SELECT YearLabel FROM rotary_year_master WHERE pk_year_id=@Y", new { Y = yearId }) ?? "";
        var zoneName = await conn.ExecuteScalarAsync<string>(
            "SELECT ZoneName FROM zone_master WHERE pk_zone_id=@Z", new { Z = zoneId }) ?? $"Zone {zoneId}";

        var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add("Messages");
        ws.Column(1).Width = 6; ws.Column(2).Width = 18; ws.Column(3).Width = 16; ws.Column(4).Width = 20;
        ws.Column(5).Width = 28; ws.Column(6).Width = 70; ws.Column(7).Width = 22;
        int r = 1;
        RenderTitleBand(ws, 7, "Goal Messages Report",
            $"{zoneName}   ·   Rotary Year {yearLabel}   ·   Generated {DateTime.Now:dd MMM yyyy, hh:mm tt}", ref r);
        string[] hs = { "Sr No", "Category", "District", "Role", "From", "Message", "Date & Time" };
        for (int c = 0; c < hs.Length; c++) { var cell = ws.Cell(r, c + 1); cell.Value = hs[c]; StyleHeaderCell(cell); }
        r++;
        // The District Admin / DG messages (user 2026-10-09).
        var all = (await DistrictSideReportRowsAsync(conn, memberId, yearId, zoneId, categoryId, districtId))
            .Select(d => (Sort: d.CategorySort, Cat: d.CategoryName, Did: d.DistrictId, Dnum: d.DistrictNumber,
                Role: d.FromRole ?? "District Admin", From: d.FromName, Msg: d.Text,
                Dt: d.Created.ToString("dd MMM yyyy, hh:mm tt"), Raw: d.Created)).ToList();
        int sr = 1;
        foreach (var row in all.OrderBy(x => x.Sort).ThenBy(x => x.Raw))
        {
            ws.Cell(r, 1).Value = sr++;
            ws.Cell(r, 2).Value = row.Cat;
            ws.Cell(r, 3).Value = row.Did > 0 ? (row.Dnum ?? row.Did.ToString()) : "All districts";
            ws.Cell(r, 4).Value = row.Role;
            ws.Cell(r, 5).Value = row.From;
            ws.Cell(r, 6).Value = row.Msg;
            ws.Cell(r, 6).Style.Alignment.WrapText = true;
            ws.Cell(r, 7).Value = row.Dt;
            r++;
        }
        if (sr == 1) ws.Cell(r, 1).Value = "No messages for this filter.";
        return SaveAndDispose(wb);
    }

    // ── Foundation benchmark import (SuperAdmin, cumulative till-date) ──────────
    // The master Excel carries the CUMULATIVE (as-of-now / till-date) figure per district —
    // NOT monthly increments. Storage is the normal goal_entries table (one row per
    // district+year+field, EntityType='District'), exactly like every other goal value; the
    // Foundation form reads it as-is (read-only Reference). Re-importing OVERWRITES via the
    // goal_entries unique key (fk_field_id, fk_year_id, EntityType, fk_club_id, fk_district_id).
    // No month dimension, no summing, no history.
    public async Task<GoalFoundationImportResultDto> ImportFoundationMonthlyAsync(
        int memberId, int yearId, Stream excelStream, int month = 0)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var yearExists = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM rotary_year_master WHERE pk_year_id = @Y AND isdeleted = 0",
            new { Y = yearId });
        if (yearExists == 0)
            throw new InvalidOperationException("Invalid Rotary year.");
        // month > 0 → the Excel is a specific month's YTD: also record the amount collected IN that month
        // (= imported YTD − earlier Rotary-year months). The annual goal_entries upsert below is unchanged.
        bool writeMonthly = month is >= 1 and <= 12;

        // Earlier-month sums per (field, district), pre-fetched once so the batched import stays fast.
        var monthPriorCum = new Dictionary<(int FieldId, int DistrictId), decimal>();
        if (writeMonthly)
        {
            int orderM = month >= 7 ? month - 6 : month + 6;   // Rotary-year order: Jul=1 … Jun=12
            var priorRows = await conn.QueryAsync<dynamic>(@"
                SELECT fk_field_id AS f, fk_district_id AS d, COALESCE(SUM(NumericValue), 0) AS s
                FROM goal_entries_monthly
                WHERE fk_year_id = @Y AND EntityType = 'District' AND fk_club_id = 0 AND COALESCE(isdeleted, 0) = 0
                  AND (CASE WHEN PeriodMonth >= 7 THEN PeriodMonth - 6 ELSE PeriodMonth + 6 END) < @OrderM
                GROUP BY fk_field_id, fk_district_id", new { Y = yearId, OrderM = orderM });
            foreach (var pr in priorRows) monthPriorCum[((int)pr.f, (int)pr.d)] = Convert.ToDecimal(pr.s);
        }

        // Field-key → pk_field_id for the 9 Foundation Reference fields.
        var fieldIds = (await conn.QueryAsync<dynamic>(
            "SELECT FieldKey AS k, pk_field_id AS id FROM goal_fields WHERE FieldKey IN @Keys AND isdeleted = 0",
            new { Keys = FoundationImportFieldKeys }))
            .ToDictionary(r => (string)r.k, r => (int)r.id);

        // District number → id — any district that has at least one ACTIVE club (synced OR not),
        // so test districts (e.g. Zone 0 / 5656, whose clubs aren't Rotary.org-synced) are included
        // for goal-setting testing. GroupBy guards against a duplicate DistrictNumber (first wins).
        var districtMap = (await conn.QueryAsync<dynamic>(@"
            SELECT d.pk_district_id AS id, d.DistrictNumber AS num
            FROM district_master d
            INNER JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE d.isdeleted = 0 AND z.isdeleted = 0
              AND EXISTS (SELECT 1 FROM club_master c
                          WHERE c.fk_district_id = d.pk_district_id
                            AND COALESCE(c.isdeleted, 0) = 0)"))
            .GroupBy(d => ((string)d.num ?? "").Trim())
            .Where(g => !string.IsNullOrEmpty(g.Key))
            .ToDictionary(g => g.Key, g => (int)g.First().id);

        using var workbook = new ClosedXML.Excel.XLWorkbook(excelStream);
        var ws = workbook.Worksheets.First();

        // Validate the file is the district Foundation matrix — the first 4 header labels are fixed.
        static string NormH(string? s) => System.Text.RegularExpressions.Regex.Replace((s ?? "").ToLowerInvariant(), @"[^a-z0-9]", "");
        var expectedFirst4 = new[] { "SrNo", "Number1_Dont_change", "Category", "Input Type" };
        for (int i = 0; i < expectedFirst4.Length; i++)
            if (!NormH(ws.Row(1).Cell(i + 1).GetString()).Contains(NormH(expectedFirst4[i])))
                throw new InvalidOperationException(
                    $"This file doesn't match the district Foundation format — column {i + 1} should be \"{expectedFirst4[i]}\". Please upload the exact district Foundation Excel from ROW.");

        int lastRow = ws.LastRowUsed()?.RowNumber() ?? 1;
        int lastCol = ws.LastColumnUsed()?.ColumnNumber() ?? 4;

        var result = new GoalFoundationImportResultDto { YearId = yearId };

        // TRANSPOSED MATRIX layout: header row 1 = SrNo | Number1_Dont_change | Category | Input Type
        // | <district numbers, cols 5+>. Field values live at (field-row, district-column).
        // 1) Map each district COLUMN (col 5+) to a synced district id from the header row.
        const int firstDistrictCol = 5;
        var districtColumns = new List<(int Col, int DistrictId)>();
        var seenUnknownDistricts = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (int col = firstDistrictCol; col <= lastCol; col++)
        {
            var num = ws.Row(1).Cell(col).GetString().Trim();
            if (string.IsNullOrEmpty(num)) continue;
            if (districtMap.TryGetValue(num, out int did))
                districtColumns.Add((col, did));
            else if (seenUnknownDistricts.Add(num))
                result.SkippedRows.Add(new GoalFoundationImportSkippedRowDto
                {
                    Row = 1, DistrictNumber = num,
                    Reason = "District number not found in the system (or it has no active club) — column skipped.",
                });
        }

        // 2) Walk each field ROW; match by exact Category name (col 3) to one of the 10 metrics,
        //    then upsert its "_achieved" value for every mapped district column.
        //    Batched upsert (chunks of one multi-row INSERT … ON DUPLICATE KEY UPDATE) so a wide
        //    matrix doesn't turn into hundreds of sequential round-trips → HTTP timeout.
        const int BatchRows = 500;
        var annual = new List<(int FieldId, int DistrictId, decimal Value)>();
        var monthly = new List<(int FieldId, int DistrictId, decimal Value)>();

        async Task FlushAnnualAsync()
        {
            if (annual.Count == 0) return;
            var sb = new System.Text.StringBuilder(
                "INSERT INTO goal_entries (fk_field_id, fk_year_id, EntityType, fk_club_id, fk_district_id, NumericValue, created_by, created_date, isdeleted) VALUES ");
            var p = new DynamicParameters();
            p.Add("Y", yearId); p.Add("By", memberId);
            for (int i = 0; i < annual.Count; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append($"(@f{i}, @Y, 'District', 0, @d{i}, @v{i}, @By, NOW(), 0)");
                p.Add($"f{i}", annual[i].FieldId); p.Add($"d{i}", annual[i].DistrictId); p.Add($"v{i}", annual[i].Value);
            }
            sb.Append(" ON DUPLICATE KEY UPDATE NumericValue = VALUES(NumericValue), modified_by = @By, modified_date = NOW(), isdeleted = 0");
            await conn.ExecuteAsync(sb.ToString(), p);
            annual.Clear();
        }

        async Task FlushMonthlyAsync()
        {
            if (monthly.Count == 0) return;
            var sb = new System.Text.StringBuilder(
                "INSERT INTO goal_entries_monthly (fk_field_id, fk_year_id, EntityType, fk_club_id, fk_district_id, PeriodMonth, NumericValue, created_by, created_date, isdeleted) VALUES ");
            var p = new DynamicParameters();
            p.Add("Y", yearId); p.Add("M", month); p.Add("By", memberId);
            for (int i = 0; i < monthly.Count; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append($"(@f{i}, @Y, 'District', 0, @d{i}, @M, @v{i}, @By, NOW(), 0)");
                p.Add($"f{i}", monthly[i].FieldId); p.Add($"d{i}", monthly[i].DistrictId); p.Add($"v{i}", monthly[i].Value);
            }
            sb.Append(" ON DUPLICATE KEY UPDATE NumericValue = VALUES(NumericValue), modified_by = @By, modified_date = NOW(), isdeleted = 0");
            await conn.ExecuteAsync(sb.ToString(), p);
            monthly.Clear();
        }

        var districtsTouched = new HashSet<int>();
        for (int row = 2; row <= lastRow; row++)
        {
            var category = ws.Row(row).Cell(3).GetString().Trim();
            if (string.IsNullOrEmpty(category)) continue;
            if (!FoundationCategoryToKey.TryGetValue(category.ToLowerInvariant(), out var key)) continue; // sub-rows / DDF / EPF / Hall of Honor — skip
            if (!fieldIds.TryGetValue(key, out int fieldId)) continue;

            foreach (var (col, districtId) in districtColumns)
            {
                var raw = ws.Row(row).Cell(col).GetString().Trim();
                if (string.IsNullOrEmpty(raw)) continue; // truly blank — leave existing value untouched
                decimal value;
                if (raw == "-" || raw == "–" || raw == "—") // a dash means zero contribution
                {
                    value = 0m;
                }
                else
                {
                    // Accept ONLY the number: strip $, commas, spaces, and any stray characters, keeping
                    // digits and the decimal point (e.g. "$11,000" and "11,000" both become 11000).
                    var cleaned = System.Text.RegularExpressions.Regex.Replace(raw, @"[^0-9.]", "");
                    if (string.IsNullOrEmpty(cleaned) || cleaned == ".") continue; // nothing numeric — skip
                    if (!decimal.TryParse(cleaned, System.Globalization.NumberStyles.Any,
                            System.Globalization.CultureInfo.InvariantCulture, out value))
                        continue; // still not a valid number — skip this cell
                }

                // District Foundation figures are whole-dollar amounts. Excel holds the exact number
                // (e.g. 14219.58) but DISPLAYS it rounded ("$14,220"); store the rounded whole number
                // so the system matches what the sheet shows (14219.58 → 14220).
                value = Math.Round(value, 0, MidpointRounding.AwayFromZero);

                annual.Add((fieldId, districtId, value));
                // Month-wise: also stamp this collected value into the chosen month (TRF collected keys only).
                if (writeMonthly && MonthlyCollectedToTarget.ContainsKey(key))
                {
                    // Month value = this month's YTD − the earlier Rotary-year months already recorded.
                    monthPriorCum.TryGetValue((fieldId, districtId), out var prior);
                    monthly.Add((fieldId, districtId, value - prior));
                }

                result.ValuesWritten++;
                districtsTouched.Add(districtId);

                if (annual.Count >= BatchRows) await FlushAnnualAsync();
                if (monthly.Count >= BatchRows) await FlushMonthlyAsync();
            }
        }
        await FlushAnnualAsync();
        await FlushMonthlyAsync();

        // Remember WHICH MONTH this file carried, so "Achieved (as on ...)" can name it. The upload
        // date is irrelevant - a July file uploaded in December still means July (user 2026-10-01).
        if (writeMonthly) await RecordFoundationImportMonthAsync(conn, yearId, "District", month, memberId);

        result.ImportedDistricts = districtsTouched.Count;
        result.Message = $"Imported {result.ImportedDistricts} district(s), {result.ValuesWritten} value(s). "
                       + $"{result.SkippedRows.Count} district column(s) skipped.";
        return result;
    }

    // Column → club field key for Rotary's Monthly Contribution Report (MCR). One row per club:
    // 1=Club No, 2=Name, 3=Rotarians, 4=AF Goal Amount, 5=Goal % Achieved, 6=AF Per Capita,
    // 7=Annual Fund YTD, 8=PolioPlus YTD, 9=Other Funds YTD, 10=Endowment YTD, 11=Total.
    private static readonly (int Col, string FieldKey)[] McrClubColumns =
    {
        (4,  "club_af_goal_amount"),
        (5,  "club_goal_pct_achieved"),
        (6,  "club_af_per_capita"),
        (7,  "club_annual_fund_ytd"),
        (8,  "club_polioplus_ytd"),
        (9,  "club_other_funds_ytd"),
        (10, "club_endowment_ytd"),
        (11, "club_total_ytd"),        // "-- Total --" column
    };

    // Expected MCR (club) header labels, in column order — used to validate the uploaded file.
    private static readonly string[] McrExpectedHeaders =
    {
        "Club No", "Name", "Rotarians", "Annual Fund Goal Amount", "Goal % Achieved", "AF Per Capita",
        "Annual Fund", "PolioPlus Fund", "Other Funds", "Endowment Fund", "Total",
    };

    // Validates the uploaded club sheet is the Monthly Contribution Report — the first-row headers
    // must match the fixed layout. Throws a clear error on any column mismatch (comparison is
    // whitespace/newline-insensitive and substring-based to tolerate "Annual Fund\nYTD" / "-- Total --").
    private static void ValidateMcrHeader(ClosedXML.Excel.IXLWorksheet ws)
    {
        static string Norm(string? s) => System.Text.RegularExpressions.Regex.Replace((s ?? "").ToLowerInvariant(), @"[^a-z0-9]", "");
        for (int i = 0; i < McrExpectedHeaders.Length; i++)
        {
            var actual = Norm(ws.Row(1).Cell(i + 1).GetString());
            var expected = Norm(McrExpectedHeaders[i]);
            if (!actual.Contains(expected))
                throw new InvalidOperationException(
                    $"This file doesn't match the Monthly Contribution Report format — column {i + 1} should be \"{McrExpectedHeaders[i]}\". Please upload the exact MCR Excel from Rotary.");
        }
    }

    // CLUB Foundation import — Year only. The MCR Excel carries EVERY district's clubs in one file;
    // each club row is matched globally by Club No = club_master.ClubRotaryId and upserted into that
    // club's Foundation goal_entries (SuperAdmin only). District sub-total / grand-total rows are
    // skipped silently; a real club whose "Club No" isn't found in the system is skipped and listed
    // (with its Excel row number) so the caller can see exactly what was left out. Errors — with the
    // offending column number — if the file isn't the expected MCR format.
    public async Task<GoalFoundationImportResultDto> ImportFoundationClubAsync(int memberId, int yearId, Stream excelStream, int month = 0)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var yearExists = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM rotary_year_master WHERE pk_year_id = @Y AND isdeleted = 0", new { Y = yearId });
        if (yearExists == 0) throw new InvalidOperationException("Invalid Rotary year.");
        bool writeMonthly = month is >= 1 and <= 12;   // also record the amount collected IN this month

        // Month-wise stores the DELTA (collected IN month M) = imported YTD − the sum of the EARLIER
        // Rotary-year months already recorded. Pre-fetch those earlier-month sums per (field, club) in ONE
        // grouped query (keeps the batched import fast), then look them up O(1) in the row loop.
        var monthPriorCum = new Dictionary<(int FieldId, int ClubId), decimal>();
        if (writeMonthly)
        {
            int orderM = month >= 7 ? month - 6 : month + 6;   // Rotary-year order: Jul=1 … Jun=12
            var priorRows = await conn.QueryAsync<dynamic>(@"
                SELECT fk_field_id AS f, fk_club_id AS c, COALESCE(SUM(NumericValue), 0) AS s
                FROM goal_entries_monthly
                WHERE fk_year_id = @Y AND EntityType = 'Club' AND fk_district_id = 0 AND COALESCE(isdeleted, 0) = 0
                  AND (CASE WHEN PeriodMonth >= 7 THEN PeriodMonth - 6 ELSE PeriodMonth + 6 END) < @OrderM
                GROUP BY fk_field_id, fk_club_id", new { Y = yearId, OrderM = orderM });
            foreach (var pr in priorRows) monthPriorCum[((int)pr.f, (int)pr.c)] = Convert.ToDecimal(pr.s);
        }

        // SYNCED clubs only, every district: ClubRotaryId -> pk_club_id (the file is not district-scoped).
        // Non-synced clubs (test/manual) are intentionally excluded — only Rotary.org-synced clubs import.
        var clubMap = (await conn.QueryAsync<dynamic>(@"
            SELECT pk_club_id AS id, ClubRotaryId AS rid FROM club_master
            WHERE COALESCE(isdeleted, 0) = 0 AND COALESCE(IsSyncedFromRotaryOrg, 0) = 1
              AND ClubRotaryId IS NOT NULL AND ClubRotaryId <> ''"))
            .GroupBy(c => ((string)c.rid).Trim())
            .Where(g => !string.IsNullOrEmpty(g.Key))
            .ToDictionary(g => g.Key, g => (int)g.First().id);

        var fieldIds = (await conn.QueryAsync<dynamic>(
            "SELECT FieldKey AS k, pk_field_id AS id FROM goal_fields WHERE FieldKey IN @Keys AND isdeleted = 0",
            new { Keys = McrClubColumns.Select(c => c.FieldKey).ToArray() }))
            .ToDictionary(r => (string)r.k, r => (int)r.id);

        using var workbook = new ClosedXML.Excel.XLWorkbook(excelStream);
        var ws = workbook.Worksheets.First();
        ValidateMcrHeader(ws); // throws with the bad column number on a format mismatch
        int lastRow = ws.LastRowUsed()?.RowNumber() ?? 1;

        var result = new GoalFoundationImportResultDto { YearId = yearId };
        var clubsTouched = new HashSet<int>();

        // District sub-total ("District 2981 Contributions") and grand-total rows are not clubs.
        static bool IsNonClubRow(string name)
        {
            var n = name.ToLowerInvariant();
            return (n.Contains("district") && n.Contains("contribution")) || n.Contains("total");
        }

        // Batched upsert — one club row × 8 columns × 4,000+ clubs would be 25,000+ round-trips
        // (7+ minutes on a remote DB → HTTP timeout). Collect the parsed values and flush in
        // chunks of one multi-row INSERT … ON DUPLICATE KEY UPDATE, which turns it into ~50 calls.
        const int BatchRows = 500;
        var annual = new List<(int FieldId, int ClubId, decimal Value)>();
        var monthly = new List<(int FieldId, int ClubId, decimal Value)>();

        async Task FlushAnnualAsync()
        {
            if (annual.Count == 0) return;
            var sb = new System.Text.StringBuilder(
                "INSERT INTO goal_entries (fk_field_id, fk_year_id, EntityType, fk_club_id, fk_district_id, NumericValue, created_by, created_date, isdeleted) VALUES ");
            var p = new DynamicParameters();
            p.Add("Y", yearId); p.Add("By", memberId);
            for (int i = 0; i < annual.Count; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append($"(@f{i}, @Y, 'Club', @c{i}, 0, @v{i}, @By, NOW(), 0)");
                p.Add($"f{i}", annual[i].FieldId); p.Add($"c{i}", annual[i].ClubId); p.Add($"v{i}", annual[i].Value);
            }
            sb.Append(" ON DUPLICATE KEY UPDATE NumericValue = VALUES(NumericValue), modified_by = @By, modified_date = NOW(), isdeleted = 0");
            await conn.ExecuteAsync(sb.ToString(), p);
            annual.Clear();
        }

        async Task FlushMonthlyAsync()
        {
            if (monthly.Count == 0) return;
            var sb = new System.Text.StringBuilder(
                "INSERT INTO goal_entries_monthly (fk_field_id, fk_year_id, EntityType, fk_club_id, fk_district_id, PeriodMonth, NumericValue, created_by, created_date, isdeleted) VALUES ");
            var p = new DynamicParameters();
            p.Add("Y", yearId); p.Add("M", month); p.Add("By", memberId);
            for (int i = 0; i < monthly.Count; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append($"(@f{i}, @Y, 'Club', @c{i}, 0, @M, @v{i}, @By, NOW(), 0)");
                p.Add($"f{i}", monthly[i].FieldId); p.Add($"c{i}", monthly[i].ClubId); p.Add($"v{i}", monthly[i].Value);
            }
            sb.Append(" ON DUPLICATE KEY UPDATE NumericValue = VALUES(NumericValue), modified_by = @By, modified_date = NOW(), isdeleted = 0");
            await conn.ExecuteAsync(sb.ToString(), p);
            monthly.Clear();
        }

        for (int row = 2; row <= lastRow; row++)
        {
            var no = ws.Row(row).Cell(1).GetString().Trim();
            var name = ws.Row(row).Cell(2).GetString().Trim();
            if (string.IsNullOrEmpty(no) && string.IsNullOrEmpty(name)) continue; // blank spacer row
            if (IsNonClubRow(name)) continue;                                     // district / grand total row
            if (string.IsNullOrEmpty(no))                                         // club row with no id → list it
            {
                result.SkippedRows.Add(new GoalFoundationImportSkippedRowDto
                {
                    Row = row, ClubNo = "", ClubName = name,
                    Reason = "Row has no Club No — skipped.",
                });
                continue;
            }

            if (!clubMap.TryGetValue(no, out int clubId))
            {
                // Club No not matched to a SYNCED club (either not in the system, or not Rotary.org-synced) — skip but list it.
                result.SkippedRows.Add(new GoalFoundationImportSkippedRowDto
                {
                    Row = row, ClubNo = no, ClubName = name,
                    Reason = "Club No not found or club is not synced from Rotary.org — skipped.",
                });
                continue;
            }

            foreach (var (col, key) in McrClubColumns)
            {
                if (!fieldIds.TryGetValue(key, out int fieldId)) continue;
                var raw = ws.Row(row).Cell(col).GetString().Trim();
                if (string.IsNullOrEmpty(raw)) continue; // truly blank — leave existing untouched
                decimal value;
                if (raw == "-" || raw == "–" || raw == "—") // a dash means zero
                {
                    value = 0m;
                }
                else
                {
                    // Strip $, commas, spaces and stray chars — "$11,000"/"11,000" → 11000.
                    var cleaned = System.Text.RegularExpressions.Regex.Replace(raw, @"[^0-9.]", "");
                    if (string.IsNullOrEmpty(cleaned) || cleaned == ".") continue;
                    if (!decimal.TryParse(cleaned, System.Globalization.NumberStyles.Any,
                            System.Globalization.CultureInfo.InvariantCulture, out value)) continue;
                }
                // Money and % are kept to 2 decimals (21.2765957446809 -> 21.28; user 2026-10-06).
                value = Math.Round(value, 2, MidpointRounding.AwayFromZero);

                annual.Add((fieldId, clubId, value));
                if (writeMonthly && MonthlyCollectedToTarget.ContainsKey(key))
                {
                    // Month value = this month's YTD − the earlier Rotary-year months already recorded.
                    monthPriorCum.TryGetValue((fieldId, clubId), out var prior);
                    monthly.Add((fieldId, clubId, value - prior));
                }

                result.ValuesWritten++;
                clubsTouched.Add(clubId);

                if (annual.Count >= BatchRows) await FlushAnnualAsync();
                if (monthly.Count >= BatchRows) await FlushMonthlyAsync();
            }
        }
        await FlushAnnualAsync();
        await FlushMonthlyAsync();

        // Club imports move independently of the district ones - see RecordFoundationImportMonthAsync.
        if (writeMonthly) await RecordFoundationImportMonthAsync(conn, yearId, "Club", month, memberId);

        // Districts follow their clubs: each district's Foundation Achieved = the sum of its SYNCED clubs.
        var districtsRolledUp = await RollUpClubFoundationToDistrictsAsync(conn, yearId, month, memberId, clubsTouched);

        result.ImportedDistricts = clubsTouched.Count; // reused as the club count for the UI
        result.Message = $"Imported {clubsTouched.Count} synced club(s), {result.ValuesWritten} value(s). "
                       + $"{result.SkippedRows.Count} club row(s) skipped (not found or not synced from Rotary.org). "
                       + $"{districtsRolledUp} district(s) updated with the sum of their synced clubs.";
        return result;
    }

    // Club Foundation field -> the district Foundation "Achieved" field that totals it. Only Achieved:
    // the district TARGETS are the district's own goals (e.g. D2981 600,000) and are nothing like the
    // sum of club goals (87,700), so they are never touched here. Other Funds and AF Per Capita have no
    // district field; CSR is not in the club file; Total Giving fills itself from the four funds.
    private static readonly (string ClubKey, string DistrictKey)[] ClubToDistrictFoundation =
    {
        ("club_annual_fund_ytd", "annual_fund_achieved"),
        ("club_polioplus_ytd",   "polio_plus_achieved"),
        ("club_endowment_ytd",   "endowment_achieved"),
    };

    // After a club Foundation import: for every district that had a club in the file, set its Foundation
    // Achieved = SUM over its SYNCED, active clubs' stored YTD (all of them, not only the rows in this
    // file, so a club missing from the file still counts with its last value). The district's own
    // "District Contributions" row of the Rotary file is NOT added (user 2026-10-06). With a month, the
    // amount for that month is also stored the way the district import does it:
    // district YTD - the earlier Rotary-year months already recorded. 2 decimals, like the clubs.
    private async Task<int> RollUpClubFoundationToDistrictsAsync(
        MySqlConnection conn, int yearId, int month, int memberId, HashSet<int> clubsTouched)
    {
        if (clubsTouched.Count == 0) return 0;
        bool writeMonthly = month is >= 1 and <= 12;

        var districtIds = (await conn.QueryAsync<int>(
            "SELECT DISTINCT fk_district_id FROM club_master WHERE pk_club_id IN @Ids AND COALESCE(fk_district_id, 0) > 0",
            new { Ids = clubsTouched })).ToList();
        if (districtIds.Count == 0) return 0;

        var keys = ClubToDistrictFoundation.SelectMany(m => new[] { m.ClubKey, m.DistrictKey }).ToArray();
        var fieldIds = (await conn.QueryAsync<(string k, int id)>(
            "SELECT FieldKey AS k, pk_field_id AS id FROM goal_fields WHERE FieldKey IN @Keys AND isdeleted = 0",
            new { Keys = keys })).ToDictionary(x => x.k, x => x.id);

        var sums = (await conn.QueryAsync<(int d, string k, decimal s)>(@"
            SELECT c.fk_district_id AS d, f.FieldKey AS k, COALESCE(SUM(e.NumericValue), 0) AS s
            FROM goal_entries e
            JOIN goal_fields f ON f.pk_field_id = e.fk_field_id
            JOIN club_master c ON c.pk_club_id = e.fk_club_id
                              AND COALESCE(c.isdeleted, 0) = 0 AND c.IsSyncedFromRotaryOrg = 1
            WHERE e.EntityType = 'Club' AND e.fk_year_id = @Y AND COALESCE(e.isdeleted, 0) = 0
              AND f.FieldKey IN @ClubKeys AND c.fk_district_id IN @Ds
            GROUP BY c.fk_district_id, f.FieldKey",
            new { Y = yearId, ClubKeys = ClubToDistrictFoundation.Select(m => m.ClubKey).ToArray(), Ds = districtIds }))
            .ToDictionary(x => (x.d, x.k), x => x.s);

        var prior = new Dictionary<(int FieldId, int DistrictId), decimal>();
        if (writeMonthly)
        {
            int orderM = month >= 7 ? month - 6 : month + 6;   // Rotary-year order: Jul=1 ... Jun=12
            foreach (var pr in await conn.QueryAsync<(int f, int d, decimal s)>(@"
                SELECT fk_field_id AS f, fk_district_id AS d, COALESCE(SUM(NumericValue), 0) AS s
                FROM goal_entries_monthly
                WHERE fk_year_id = @Y AND EntityType = 'District' AND fk_club_id = 0 AND COALESCE(isdeleted, 0) = 0
                  AND fk_district_id IN @Ds
                  AND (CASE WHEN PeriodMonth >= 7 THEN PeriodMonth - 6 ELSE PeriodMonth + 6 END) < @OrderM
                GROUP BY fk_field_id, fk_district_id", new { Y = yearId, Ds = districtIds, OrderM = orderM }))
                prior[(pr.f, pr.d)] = pr.s;
        }

        foreach (var (clubKey, districtKey) in ClubToDistrictFoundation)
        {
            if (!fieldIds.TryGetValue(districtKey, out var dField)) continue;
            foreach (var d in districtIds)
            {
                sums.TryGetValue((d, clubKey), out var total);
                total = Math.Round(total, 2, MidpointRounding.AwayFromZero);
                await conn.ExecuteAsync(@"
                    INSERT INTO goal_entries (fk_field_id, fk_year_id, EntityType, fk_club_id, fk_district_id, NumericValue, created_by, created_date, isdeleted)
                    VALUES (@F, @Y, 'District', 0, @D, @V, @By, NOW(), 0)
                    ON DUPLICATE KEY UPDATE NumericValue = VALUES(NumericValue), modified_by = @By, modified_date = NOW(), isdeleted = 0",
                    new { F = dField, Y = yearId, D = d, V = total, By = memberId });
                if (writeMonthly && MonthlyCollectedToTarget.ContainsKey(districtKey))
                {
                    prior.TryGetValue((dField, d), out var before);
                    await conn.ExecuteAsync(@"
                        INSERT INTO goal_entries_monthly (fk_field_id, fk_year_id, EntityType, fk_club_id, fk_district_id, PeriodMonth, NumericValue, created_by, created_date, isdeleted)
                        VALUES (@F, @Y, 'District', 0, @D, @M, @V, @By, NOW(), 0)
                        ON DUPLICATE KEY UPDATE NumericValue = VALUES(NumericValue), modified_by = @By, modified_date = NOW(), isdeleted = 0",
                        new { F = dField, Y = yearId, D = d, M = month, V = total - before, By = memberId });
                }
            }
        }

        if (writeMonthly) await RecordFoundationImportMonthAsync(conn, yearId, "District", month, memberId);
        return districtIds.Count;
    }

    // DISTRICT Foundation sample download — the EXACT official transposed-matrix format (all 24 rows),
    // with one column per current district (any district that has an active club, so a newly-added
    // district appears automatically) and a 0 baseline in every Number cell (Yes/No cells left blank).
    // The district fills in the real numbers and re-uploads.
    public async Task<byte[]> BuildFoundationSampleExcelAsync()
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Any district with at least one ACTIVE club (synced OR not — matches the import), so test
        // districts (Zone 0 / 5656) and any newly-added district are included automatically.
        var districts = (await conn.QueryAsync<dynamic>(@"
            SELECT d.DistrictNumber AS num
            FROM district_master d
            INNER JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE d.isdeleted = 0 AND z.isdeleted = 0
              AND EXISTS (SELECT 1 FROM club_master c
                          WHERE c.fk_district_id = d.pk_district_id
                            AND COALESCE(c.isdeleted, 0) = 0)
            ORDER BY CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber")).ToList();

        using var wb = new ClosedXML.Excel.XLWorkbook();
        var ws = wb.Worksheets.Add("Foundation");

        ws.Cell(1, 1).Value = "SrNo";
        ws.Cell(1, 2).Value = "Number1_Dont_change";
        ws.Cell(1, 3).Value = "Category";
        ws.Cell(1, 4).Value = "Input Type";
        const int firstDistrictCol = 5;
        for (int j = 0; j < districts.Count; j++)
            ws.Cell(1, firstDistrictCol + j).Value = (string)districts[j].num;

        int lastCol = firstDistrictCol - 1 + Math.Max(1, districts.Count);
        var headerRange = ws.Range(1, 1, 1, lastCol);
        headerRange.Style.Font.Bold = true;
        headerRange.Style.Fill.BackgroundColor = ClosedXML.Excel.XLColor.FromHtml("#003366");
        headerRange.Style.Font.FontColor = ClosedXML.Excel.XLColor.White;
        headerRange.Style.Alignment.Horizontal = ClosedXML.Excel.XLAlignmentHorizontalValues.Center;

        // The 8 TRF rows (4 funds × High + Target). Every row is a Number and gets a 0 baseline in
        // each district column; the admin fills the real High + Target values. Import matches by Category.
        int row = 2;
        foreach (var r in FoundationSampleRows)
        {
            ws.Cell(row, 1).Value = r.SrNo;
            ws.Cell(row, 2).Value = r.ExcelId;
            ws.Cell(row, 3).Value = r.Category;
            ws.Cell(row, 4).Value = r.InputType;
            if (r.InputType == "Number")
                for (int j = 0; j < districts.Count; j++)
                    ws.Cell(row, firstDistrictCol + j).Value = 0;
            row++;
        }

        ws.Columns(1, lastCol).AdjustToContents();
        ws.SheetView.FreezeRows(1);
        ws.SheetView.FreezeColumns(4);

        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }

    // CLUB Foundation sample download — the EXACT Rotary MCR column layout, one row per current
    // SYNCED club (so a newly-added synced club appears automatically) with Club No = ClubRotaryId,
    // the club Name, and a 0 baseline in every value column. The admin fills the real figures and
    // re-uploads (import matches rows back by Club No = ClubRotaryId).
    // Rotary.org's raw Monthly Contribution Report -> our club import file (the club sample layout).
    // Rotary's file lists every club of every district - non-synced clubs, Rotaract, "District N
    // Contributions", "Total For", "District Summary" and repeated header rows included. This keeps ONLY
    // our synced clubs, one row each in the sample's order, with Rotary's figures rounded to 2 decimals.
    // A club Rotary lists under two districts takes the row of the district it has in our system. A
    // synced club missing from Rotary's file is left BLANK, so the import keeps its current values.
    // Nothing is imported here: the SuperAdmin checks the file, then uploads it through the club import.
    // A second "Notes" sheet (ignored by the import, which reads the first sheet) explains the result.
    public async Task<(byte[] File, int Filled, int Missing)> ConvertFoundationMcrToClubFileAsync(Stream mcrStream)
    {
        using var src = new ClosedXML.Excel.XLWorkbook(mcrStream);
        var sws = src.Worksheets.First();
        ValidateMcrHeader(sws);

        // Club No -> rows found in Rotary's file, each with the district block it sat in.
        var found = new Dictionary<string, List<(string District, decimal?[] Values)>>();
        string district = "";
        bool inSummary = false;
        int last = sws.LastRowUsed()?.RowNumber() ?? 1;
        int lastCol = McrExpectedHeaders.Length;
        for (int r = 2; r <= last; r++)
        {
            var a = sws.Row(r).Cell(1).GetString().Trim();
            var name = sws.Row(r).Cell(2).GetString().Trim();
            if (a.StartsWith("District:", StringComparison.OrdinalIgnoreCase))
            {
                district = a.Substring("District:".Length).Trim();
                inSummary = false;
                continue;
            }
            if (a.Equals("District Summary", StringComparison.OrdinalIgnoreCase)) { inSummary = true; continue; }
            if (inSummary || string.IsNullOrEmpty(a) || !a.All(char.IsDigit)) continue;  // totals, headers, notes
            if (name.StartsWith("District", StringComparison.OrdinalIgnoreCase)
                && name.Contains("Contribution", StringComparison.OrdinalIgnoreCase)) continue;  // district's own row

            var vals = new decimal?[lastCol + 1];
            for (int col = 3; col <= lastCol; col++)
            {
                var raw = sws.Row(r).Cell(col).GetString().Trim();
                if (string.IsNullOrEmpty(raw)) continue;
                if (raw == "-" || raw == "–" || raw == "—") { vals[col] = 0m; continue; }
                var cleaned = System.Text.RegularExpressions.Regex.Replace(raw, @"[^0-9.\-]", "");
                if (decimal.TryParse(cleaned, System.Globalization.NumberStyles.Any,
                        System.Globalization.CultureInfo.InvariantCulture, out var v))
                    vals[col] = Math.Round(v, 2, MidpointRounding.AwayFromZero);
            }
            if (!found.TryGetValue(a, out var list)) found[a] = list = new();
            list.Add((district, vals));
        }

        using var conn = CreateConnection();
        await conn.OpenAsync();
        var clubs = (await conn.QueryAsync<dynamic>(@"
            SELECT TRIM(c.ClubRotaryId) AS rid, c.ClubName AS name, d.DistrictNumber AS dn
            FROM club_master c
            LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
            WHERE c.IsSyncedFromRotaryOrg = 1 AND COALESCE(c.isdeleted, 0) = 0
              AND c.ClubRotaryId IS NOT NULL AND c.ClubRotaryId <> ''
            ORDER BY CAST(c.ClubRotaryId AS UNSIGNED), c.ClubRotaryId")).ToList();

        using var wb = new ClosedXML.Excel.XLWorkbook();
        var ws = wb.Worksheets.Add("MCR Report");
        for (int i = 0; i < McrExpectedHeaders.Length; i++)
            ws.Cell(1, i + 1).Value = McrExpectedHeaders[i];
        var headerRange = ws.Range(1, 1, 1, lastCol);
        headerRange.Style.Font.Bold = true;
        headerRange.Style.Fill.BackgroundColor = ClosedXML.Excel.XLColor.FromHtml("#003366");
        headerRange.Style.Font.FontColor = ClosedXML.Excel.XLColor.White;
        headerRange.Style.Alignment.Horizontal = ClosedXML.Excel.XLAlignmentHorizontalValues.Center;

        int row = 2, filled = 0;
        var missing = new List<(string Rid, string Name)>();
        foreach (var c in clubs)
        {
            string rid = (string)c.rid;
            ws.Cell(row, 1).Value = rid;
            ws.Cell(row, 2).Value = (string)(c.name ?? "");
            if (found.TryGetValue(rid, out var hits) && hits.Count > 0)
            {
                var pick = hits.FirstOrDefault(h => h.District == (string?)c.dn);
                if (pick.Values == null) pick = hits[0];
                for (int col = 3; col <= lastCol; col++)
                {
                    var v = pick.Values[col] ?? 0m;
                    ws.Cell(row, col).Value = v;
                    ws.Cell(row, col).Style.NumberFormat.Format = col == 3 ? "0" : "0.00";
                }
                filled++;
            }
            else
            {
                missing.Add((rid, (string)(c.name ?? "")));   // left blank -> import keeps current values
            }
            row++;
        }
        ws.Columns(1, lastCol).AdjustToContents();
        ws.SheetView.FreezeRows(1);

        var notes = wb.Worksheets.Add("Notes");
        notes.Cell(1, 1).Value = "Converted from the Rotary.org Monthly Contribution Report";
        notes.Cell(1, 1).Style.Font.Bold = true;
        notes.Cell(2, 1).Value = $"Synced clubs filled: {filled}";
        notes.Cell(3, 1).Value = $"Synced clubs not in Rotary's file (left blank - the import keeps their current values): {missing.Count}";
        notes.Cell(4, 1).Value = "Only the first sheet (MCR Report) is imported. All amounts are rounded to 2 decimals.";
        int nr = 6;
        if (missing.Count > 0)
        {
            notes.Cell(nr, 1).Value = "Club No"; notes.Cell(nr, 2).Value = "Club";
            notes.Range(nr, 1, nr, 2).Style.Font.Bold = true;
            foreach (var m in missing) { nr++; notes.Cell(nr, 1).Value = m.Rid; notes.Cell(nr, 2).Value = m.Name; }
        }
        notes.Columns(1, 2).AdjustToContents();

        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return (ms.ToArray(), filled, missing.Count);
    }

    public async Task<byte[]> BuildFoundationClubSampleExcelAsync()
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var clubs = (await conn.QueryAsync<dynamic>(@"
            SELECT ClubRotaryId AS rid, ClubName AS name, fk_district_id AS did
            FROM club_master
            WHERE IsSyncedFromRotaryOrg = 1 AND COALESCE(isdeleted, 0) = 0
              AND ClubRotaryId IS NOT NULL AND ClubRotaryId <> ''
            ORDER BY CAST(ClubRotaryId AS UNSIGNED), ClubRotaryId")).ToList();

        using var wb = new ClosedXML.Excel.XLWorkbook();
        var ws = wb.Worksheets.Add("MCR Report");

        // Header — the exact MCR labels (see McrExpectedHeaders), in column order.
        for (int i = 0; i < McrExpectedHeaders.Length; i++)
            ws.Cell(1, i + 1).Value = McrExpectedHeaders[i];
        int lastCol = McrExpectedHeaders.Length;
        var headerRange = ws.Range(1, 1, 1, lastCol);
        headerRange.Style.Font.Bold = true;
        headerRange.Style.Fill.BackgroundColor = ClosedXML.Excel.XLColor.FromHtml("#003366");
        headerRange.Style.Font.FontColor = ClosedXML.Excel.XLColor.White;
        headerRange.Style.Alignment.Horizontal = ClosedXML.Excel.XLAlignmentHorizontalValues.Center;

        int row = 2;
        foreach (var c in clubs)
        {
            ws.Cell(row, 1).Value = (string)c.rid;   // Club No = ClubRotaryId
            ws.Cell(row, 2).Value = (string)(c.name ?? "");
            for (int col = 3; col <= lastCol; col++) // Rotarians + all value columns → 0 baseline
                ws.Cell(row, col).Value = 0;
            row++;
        }

        ws.Columns(1, lastCol).AdjustToContents();
        ws.SheetView.FreezeRows(1);

        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return ms.ToArray();
    }
}
