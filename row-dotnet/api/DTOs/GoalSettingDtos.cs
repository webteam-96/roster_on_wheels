namespace RotaryApi.DTOs;

public class GoalCategoryDto
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public int SortOrder { get; set; }
    // false for Youth Service and Public Image (user 2026-09-25): they are ANNUAL ONLY. Everything
    // else about them is unchanged - only the month-wise tab, columns and report sheet are gone, so
    // a client can hide the month-wise surface instead of asking for a form that comes back empty.
    public bool HasMonthWise { get; set; } = true;
}

// A field definition merged with its current value for one (entity, year) — what the
// generic frontend field-renderer consumes directly, one component per DataType.
public class GoalFieldWithValueDto
{
    public int FieldId { get; set; }
    public string GroupName { get; set; } = "";
    public string FieldKey { get; set; } = "";
    public string FieldLabel { get; set; } = "";
    public string DataType { get; set; } = "";   // Integer/Decimal/Percentage/Currency/Boolean/Text
    public string? Unit { get; set; }
    public string FieldRole { get; set; } = "";   // Reference/Target/Computed
    public decimal? NumericValue { get; set; }
    public string? TextValue { get; set; }
    public bool? BoolValue { get; set; }
    // The lowest value this field may be saved with - the existing figure of the same metric (the
    // July 1st total, or what has already been achieved). null = no floor, so 0 is legal. Set by the
    // server so the browser blocks exactly what the API refuses (user 2026-09-29).
    public decimal? MinValue { get; set; }
}

// One saved value from the client — only one of the three Value properties is populated,
// matching the field's DataType (server trusts FieldRole=Computed fields to be recomputed
// server-side, not blindly accepted from the client — see GoalSettingService).
public class GoalEntrySaveDto
{
    public int FieldId { get; set; }
    public decimal? NumericValue { get; set; }
    public string? TextValue { get; set; }
    public bool? BoolValue { get; set; }
}

public class SaveGoalEntriesRequest
{
    public int YearId { get; set; }
    public List<GoalEntrySaveDto> Entries { get; set; } = new();
}

// The full form for one category + one entity (club or district) + one year.
public class GoalCategoryFormDto
{
    public int CategoryId { get; set; }
    public string CategoryName { get; set; } = "";
    public string EntityType { get; set; } = "";  // "Club" or "District"
    public int? ClubId { get; set; }
    public int? DistrictId { get; set; }
    public string EntityName { get; set; } = "";  // club or district display name
    public int YearId { get; set; }
    public string YearLabel { get; set; } = "";
    public bool IsEditable { get; set; }          // year not yet ended AND not locked
    public bool IsLocked { get; set; }
    public string? LockedByName { get; set; }
    public string? LockedDate { get; set; }
    public bool CanLock { get; set; }             // caller is authorised to lock/unlock this scope
    // "Achieved as on <date>" — last calendar day of the latest month that has month-wise data
    // imported for this entity+category+year (e.g. "31 Aug 2026"). Null when no month-wise data yet
    // (frontend then shows "as on July 1st").
    public string? AchievedAsOn { get; set; }
    public List<GoalFieldWithValueDto> Fields { get; set; } = new();
}

// One row in a District Admin's "all my clubs" list for a category+year — summarised,
// not the full field list (the district drills into a specific club for the full form).
public class GoalClubSummaryDto
{
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    public bool HasAnyGoalSet { get; set; }
    public string? LastUpdatedDate { get; set; }
    public string? LastUpdatedBy { get; set; }
    public bool IsLocked { get; set; }
}

// Read-only matrix: every club of a district as a row, every field of ONE category as a column,
// with the club's live/saved value per field, plus a per-club RAG band (Membership). Powers the
// District Admin "View club goals" screen (category tab → values inline per club, no drill-in).
public class GoalClubMatrixDto
{
    public int CategoryId { get; set; }
    public string CategoryName { get; set; } = "";
    public int YearId { get; set; }
    public string YearLabel { get; set; } = "";
    public List<GoalMatrixColumnDto> Columns { get; set; } = new();
    public List<GoalMatrixRowDto> Clubs { get; set; } = new();
}

public class GoalMatrixColumnDto
{
    public string FieldKey { get; set; } = "";
    public string FieldLabel { get; set; } = "";
    public string GroupName { get; set; } = "";
    public string DataType { get; set; } = "";
    public string? Unit { get; set; }
}

public class GoalMatrixRowDto
{
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    // Per-club RAG band by active synced member count (same rule as the district RAG):
    // Red 10-25, Amber 26-40, Green 41-50, SuperGreen 51+, None (<10). Meaningful on the Membership tab.
    public string Rag { get; set; } = "None";
    public int MemberCount { get; set; }
    // fieldKey -> display value (already formatted: numbers, "Yes/No", "12%", text).
    public Dictionary<string, string?> Values { get; set; } = new();
}

// ── Month-wise "all clubs" matrix (clubs = rows, months = columns) for one category+year ──
// Same read-only comparison idea as GoalClubMatrixDto, but for the month-wise collected metrics.
// A category has several monthly metrics (e.g. Total Members, Women…) — Fields lists them so the UI
// offers a metric picker; each club row then carries that metric's value per month.
public class GoalClubMonthlyMatrixDto
{
    public int CategoryId { get; set; }
    public string CategoryName { get; set; } = "";
    public int YearId { get; set; }
    public string YearLabel { get; set; } = "";
    public List<GoalMonthPeriodDto> Months { get; set; } = new();        // Jul..Jun (+ availability)
    public List<GoalMatrixMonthlyFieldDto> Fields { get; set; } = new(); // the monthly metrics to pick from
    public List<GoalClubMonthlyRowDto> Clubs { get; set; } = new();
}

public class GoalMatrixMonthlyFieldDto
{
    public string FieldKey { get; set; } = "";
    // The metric group ("Total Members", "Annual Fund" …). Labels repeat across groups — "Achieved"
    // appears 3x in Membership and 11x in TRF — so the picker needs this to tell them apart.
    public string GroupName { get; set; } = "";
    public string FieldLabel { get; set; } = "";
    public string? Unit { get; set; }
}

public class GoalClubMonthlyRowDto
{
    public int ClubId { get; set; }
    public string ClubName { get; set; } = "";
    // fieldKey -> (month 7..6 -> formatted value)
    public Dictionary<string, Dictionary<int, string?>> Values { get; set; } = new();
    // fieldKey -> total across the year (formatted)
    public Dictionary<string, string?> Totals { get; set; } = new();
}

// One selectable person in the SuperAdmin "Observe as" list (RI Directors + Zone Coordinators).
// Gated to the observer SuperAdmin only. ZoneNames is comma-joined (an RI Director covers many zones).
public class GoalObserverRoleDto
{
    public int MemberId { get; set; }
    public string MemberName { get; set; } = "";
    public string RoleType { get; set; } = "";   // AllCategoryAllDistrictsFewZones | AllDistrictsOneCategoryOneZone
    public string RoleLabel { get; set; } = "";   // "RI Director" | "Zone Co-ordinator"
    public string ZoneNames { get; set; } = "";
    public string? CategoryName { get; set; }     // ZC is per-category; null for RI Director
}

public class GoalLockStatusDto
{
    public bool IsLocked { get; set; }
    public string? LockedByName { get; set; }
    public string? LockedDate { get; set; }
}

// ── Specialized oversight roles (Phase 3) ──────────────────────────────────
// RoleType is one of: FewDistrictsOneCategoryOneZone / AllDistrictsOneCategoryOneZone /
// AllCategoryAllDistrictsFewZones. Club Admin / District Admin reuse member_roles — not here.
public class GoalRoleAssignmentDto
{
    public int Id { get; set; }
    public int MemberId { get; set; }
    public string MemberName { get; set; } = "";
    public string RoleType { get; set; } = "";
    public string AssignmentName { get; set; } = "";
    public int? CategoryId { get; set; }
    public string? CategoryName { get; set; }
    public int? ZoneId { get; set; }
    public string? ZoneName { get; set; }
    public List<int> DistrictIds { get; set; } = new();
    public List<string> DistrictNumbers { get; set; } = new();
    public List<int> ZoneIds { get; set; } = new();
    public List<string> ZoneNames { get; set; } = new();
    public bool IsActive { get; set; }
    public string? AssignedDate { get; set; }
    // When this holder was last sent their role email — shown in the listing. Null = never emailed.
    public string? RoleEmailSentDate { get; set; }
    // Zonal-leadership hierarchy overlay (all optional/additive).
    public string? RoleTitle { get; set; }
    public string? Avenue { get; set; }
    public int? HomeDistrictId { get; set; }
    public string? HomeDistrictNumber { get; set; }
    public string? DgYear { get; set; }
    public string? SupportingText { get; set; }
}

public class CreateGoalRoleAssignmentRequest
{
    public int MemberId { get; set; }
    // Free-text member name when the person isn't a pickable member (MemberId then 0).
    public string? MemberNameText { get; set; }
    public string RoleType { get; set; } = "";
    public string AssignmentName { get; set; } = "";
    public int? CategoryId { get; set; }
    public int? ZoneId { get; set; }
    public List<int>? DistrictIds { get; set; }
    public List<int>? ZoneIds { get; set; }
    // Zonal-leadership hierarchy overlay.
    public string? RoleTitle { get; set; }
    public string? Avenue { get; set; }
    public int? HomeDistrictId { get; set; }
    public string? DgYear { get; set; }
    public string? SupportingText { get; set; }
}

// REPLACE the holder of an existing goal-role assignment (and, for RI Director, edit its zone set;
// for a District Assistant, its district set) WITHOUT revoking — so the hierarchy below is preserved.
// "+" next to a name: ADD another holder to an existing assignment. The new person inherits the same
// role type, avenue/category, zone(s) and districts — so there is nothing else to pick (2026-09-16).
public class AddGoalRoleHolderRequest
{
    public int MemberId { get; set; }
    public string? MemberNameText { get; set; }   // free-text name when MemberId is 0
}

public class ChangeGoalRoleAssignmentRequest
{
    public int MemberId { get; set; }                 // new holder (0 + MemberNameText for a free-text name)
    public string? MemberNameText { get; set; }
    public List<int>? ZoneIds { get; set; }           // RI Director: the NEW full zone set (add/remove diffed server-side)
    public int? ZoneId { get; set; }                  // Zone Co-ordinator: optional new single zone
    public List<int>? DistrictIds { get; set; }       // District Assistant: the NEW full district set
}

// Extensible leadership-designation catalog (RMC, ARC, RPIC …). SuperAdmin-managed.
public class GoalDesignationDto
{
    public int Id { get; set; }
    public string Title { get; set; } = "";
    public string Avenue { get; set; } = "";
    public string RoleType { get; set; } = "";
    public string? DefaultCategoryName { get; set; }
    public int? DefaultCategoryId { get; set; }
    public int SortOrder { get; set; }
}

public class CreateGoalDesignationRequest
{
    public string Title { get; set; } = "";
    public string Avenue { get; set; } = "";
    public string RoleType { get; set; } = "";
    public string? DefaultCategoryName { get; set; }
}

// Zone-scoped member picker result for the assign form.
public class GoalZoneMemberDto
{
    public int Id { get; set; }
    public string MemberName { get; set; } = "";
    public string EmailId { get; set; } = "";
    public string PrimaryMobileNumber { get; set; } = "";
    public string? ClubName { get; set; }
    public string? DistrictNumber { get; set; }
}

// What the CURRENT caller holds — drives the read-only oversight dashboard's own menu.
public class GoalMyAssignmentDto
{
    public int AssignmentId { get; set; }
    public string RoleType { get; set; } = "";
    public string AssignmentName { get; set; } = "";
    public List<int> CategoryIds { get; set; } = new();   // all 4 for AllCategoryAllDistrictsFewZones
    public List<int> DistrictIds { get; set; } = new();
    public List<int> ZoneIds { get; set; } = new();
    public bool CanBulkLock { get; set; }
}

public class GoalDistrictSummaryDto
{
    public int DistrictId { get; set; }
    public string DistrictNumber { get; set; } = "";
    public int ZoneId { get; set; }
    public string? ZoneName { get; set; }
    public bool HasAnyGoalSet { get; set; }
    public string? LastUpdatedDate { get; set; }
    public bool IsLocked { get; set; }
}

public class GoalBulkLockRequest
{
    public int YearId { get; set; }
    public List<int>? CategoryIds { get; set; }
    public List<int>? ZoneIds { get; set; }
    public bool Locked { get; set; }
}

public class GoalBulkLockResultDto
{
    public int AffectedCount { get; set; }
}

// ── Commenting (Phase 4) ────────────────────────────────────────────────
// PostedByTier: 1=District Admin, 2=FewDistrictsOneCategoryOneZone,
// 3=AllDistrictsOneCategoryOneZone, 4=AllCategoryAllDistrictsFewZones, 5=SuperAdmin.
// A viewer sees every comment with PostedByTier <= their own resolved tier for that thread.
public class GoalCommentDto
{
    public long Id { get; set; }
    public string CommentText { get; set; } = "";
    public int PostedByMemberId { get; set; }
    public string PostedByName { get; set; } = "";
    public int PostedByTier { get; set; }
    public string? CreatedDate { get; set; }
    // Chat-UI extras: the sender's leadership title/tier label (shown under the name),
    // and whether the current viewer authored it (drives right-vs-left bubble alignment).
    public string? PostedByRoleLabel { get; set; }
    public bool IsMine { get; set; }
    // District this message is about (District Assistant tags each message to a district, or 0 = "All
    // districts"). ZC / RI messages are zone-wide → 0. DistrictNumber is null for 0.
    public int DistrictId { get; set; }
    public string? DistrictNumber { get; set; }
}

// A district option for the District Assistant's "message about which district" picker.
public class GoalMessageDistrictDto
{
    public int Id { get; set; }
    public string Number { get; set; } = "";
}

// A Zone Co-ordinator / District Assistant in the zone (for the "who can message" roster shown when a
// filter has no messages yet — so the RI sees each ZC/DA with "No message yet").
public class GoalMessageOwnerDto
{
    public int MemberId { get; set; }
    public int CategoryId { get; set; }              // the owner's category (a ZC/DA is per-category)
    public string Name { get; set; } = "";
    public string RoleLabel { get; set; } = "";     // "Zone Co-ordinator" | "District Assistant"
    public string CategoryName { get; set; } = "";
    public string? Districts { get; set; }           // DA's covered district numbers (comma-joined); null for ZC
    public int MessageCount { get; set; }
    // How many of those the reader has NOT opened yet (their own messages never count) - drives the
    // per-person red badge and the "Unread only" filter in the RI Director / SuperAdmin popup.
    public int UnreadCount { get; set; }
}

// One row in the RI Director's unified (all-categories, all-districts) messages view — the on-screen
// twin of the messages report, filterable by category + district.
public class GoalMessageRowDto
{
    public long Id { get; set; }
    public int CategoryId { get; set; }
    public string CategoryName { get; set; } = "";
    public int DistrictId { get; set; }            // 0 = zone-wide / all districts
    public string? DistrictNumber { get; set; }
    public string FromName { get; set; } = "";
    public string RoleLabel { get; set; } = "";
    public int PostedByTier { get; set; }
    public string Message { get; set; } = "";
    public string? CreatedDate { get; set; }
}

// One pairwise oversight thread: a District Assistant or Zone Co-ordinator (the OWNER) talking
// privately with the RI Director over its zone, scoped to (category, district, year).
public class GoalMessageThreadDto
{
    public int OwnerMemberId { get; set; }
    public string OwnerName { get; set; } = "";
    public string OwnerRoleLabel { get; set; } = "";   // designation title (RMC / ARC …) or generic role
    public string? Scope { get; set; }                  // coverage — "Zone 0" for a ZC, "D 3141, 3142" for a DA
    public bool IsMine { get; set; }                    // caller owns this thread (DA/ZC self view)
    public string? LastMessagePreview { get; set; }
    public string? LastMessageDate { get; set; }
    public int MessageCount { get; set; }
    // Messages in THIS conversation the viewer has not seen yet, written by somebody else
    // (user 2026-09-25). 0 = nothing new. Each box clears on its own when it is opened.
    public int UnreadCount { get; set; }
    public string? CounterpartyName { get; set; }       // RI Director name (shown to the DA/ZC)
    public bool CanPost { get; set; }
    public string? Notice { get; set; }                 // e.g. "No RI Director assigned for this zone yet."
}

// The thread list for one (category, district, year), plus the caller's role in it so the UI knows
// whether to show a single self-thread (DA/ZC) or a list of the DA/ZC threads to reply to (RI Director).
public class GoalThreadListDto
{
    public string ViewerRole { get; set; } = "None";    // "RIDirector" | "ZoneCoordinator" | "DistrictAssistant" | "SuperAdmin" | "None"
    public List<GoalMessageThreadDto> Threads { get; set; } = new();
    // For a District Assistant viewer: the districts they cover (this zone+category) — the compose
    // "message about which district" dropdown ("All districts" = 0 is added by the UI).
    public List<GoalMessageDistrictDto> OwnerDistricts { get; set; } = new();
    // True only for the gated observer SuperAdmin (mobile allow-list). When set, the UI lets the
    // observer click any ZC/DA box and post a message AS that person (for demo/testing the upward
    // ZC→RI / DA→RI flow from one login). Everyone else is false and stays read-only.
    public bool CanObservePost { get; set; }
}

public class PostGoalCommentRequest
{
    public string CommentText { get; set; } = "";
}

// ── Foundation benchmark import (SuperAdmin, cumulative till-date) ───────────
// The 9 Foundation "Reference" fields are populated by a SuperAdmin Excel import
// (one row per district, by DistrictNumber), NOT typed by district admins. The Excel
// carries the CUMULATIVE (till-date) figure per district; each import OVERWRITES the
// stored value in goal_entries for that (district, field, year). No month dimension.
public class GoalFoundationImportSkippedRowDto
{
    public int Row { get; set; }                    // 1-based Excel row number
    public string DistrictNumber { get; set; } = "";
    public string ClubNo { get; set; } = "";        // club import: the unmatched "Club No" (ClubRotaryId)
    public string ClubName { get; set; } = "";      // club import: the club Name from the sheet
    public string Reason { get; set; } = "";
}

public class GoalFoundationImportResultDto
{
    public int YearId { get; set; }
    public int ImportedDistricts { get; set; }      // districts whose row matched + had at least one value written
    public int ValuesWritten { get; set; }          // total field cells upserted across all districts
    public List<GoalFoundationImportSkippedRowDto> SkippedRows { get; set; } = new();
    public string Message { get; set; } = "";
}

// ── SuperAdmin read-only Overview matrix (one zone + one category + one year) ────────────────
// Rows = the category's district-level metrics; columns = every active district in the zone.
// Each cell carries the district's Target and/or Achieved value for that metric (pre-formatted
// display strings, so the grid stays dumb). Target vs Achieved is derived by pairing the
// category's goal_fields on their FieldKey base (stripping the _target / _achieved suffix) —
// see GoalSettingService.GetOverviewMatrixAsync for the exact rule.
public class GoalOverviewDistrictDto
{
    public int DistrictId { get; set; }
    public string DistrictNumber { get; set; } = "";
}

public class GoalOverviewCellDto
{
    public int DistrictId { get; set; }
    public string? Total { get; set; }       // formatted display of the Reference/baseline value (null = none)
    public string? Target { get; set; }      // formatted display (null = no target field / no value)
    public string? Achieved { get; set; }    // formatted display (null = no achieved field / no value)
}

public class GoalOverviewRowDto
{
    public string MetricKey { get; set; } = "";   // normalized base FieldKey the row groups on
    public string GroupName { get; set; } = "";
    public string Label { get; set; } = "";       // row label shown in the left column
    public string? ReferenceLabel { get; set; }    // the baseline field's exact label ("Total No of Clubs as on July 1st")
    public string DataType { get; set; } = "";
    public string? Unit { get; set; }
    public bool HasReference { get; set; }         // any district has a Reference/baseline ("Total") field for this metric
    public bool HasTarget { get; set; }            // any district in the zone has a Target field for this metric
    public bool HasAchieved { get; set; }          // any district has an "_achieved" field
    public List<GoalOverviewCellDto> Cells { get; set; } = new();  // one per district (aligned to Districts order)
}

public class GoalOverviewMatrixDto
{
    public int ZoneId { get; set; }
    public string ZoneName { get; set; } = "";
    public int CategoryId { get; set; }
    public string CategoryName { get; set; } = "";
    public int YearId { get; set; }
    public string YearLabel { get; set; } = "";
    public List<GoalOverviewDistrictDto> Districts { get; set; } = new();
    public List<GoalOverviewRowDto> Rows { get; set; } = new();
}

// ── Goal-oversight dashboard: districts = rows, each category shown compactly (Target · Achieved · %)
//    in front of the district. Scoped to the caller's role (RI/ZC → all zone districts; DA → only
//    their districts). Categories = the ones the caller oversees (RI = all; ZC/DA = their one). ──
public class GoalDistrictSummaryMatrixDto
{
    public int ZoneId { get; set; }
    public string ZoneName { get; set; } = "";
    public int YearId { get; set; }
    public string YearLabel { get; set; } = "";
    public List<GoalSummaryCategoryDto> Categories { get; set; } = new();
    public List<GoalSummaryDistrictRowDto> Districts { get; set; } = new();
}
public class GoalSummaryCategoryDto
{
    public int CategoryId { get; set; }
    public string Name { get; set; } = "";
    public List<GoalSummaryMetricDto> Metrics { get; set; } = new();  // every group: New Clubs, Total Members, Women…
    public List<GoalSummaryCellDto> Totals { get; set; } = new();      // summed total row, aligned to Metrics
}
public class GoalSummaryMetricDto
{
    public string GroupName { get; set; } = "";      // "New Clubs" / "Total Members" / "Women Membership"
    public string BaselineLabel { get; set; } = "";  // exact form label e.g. "Total No of Clubs as on July 1st"
    // Membership "RAG Analysis" only: "Red" | "Amber" | "Green". Such a metric is ONE column holding a
    // club count (Value), not the usual baseline/target/achieved/% block — the UI paints it in that colour.
    public string? RagBand { get; set; }
    // ONE column holding a single number (Value) with no target/achieved/% — RAG bands and the
    // Membership "Summary" rows (Net Growth / New Clubs / New women members), which have no target.
    public bool SingleValue { get; set; }
    // false → the metric has NO "as on July 1st" baseline, so the grid drops that column entirely
    // (TRF: giving starts at zero each year, the column was always "—").
    public bool HasBaseline { get; set; }
    // true → this column holds something that cannot be added up: the Public Image "Suggestions" text,
    // or a percentage. Its TOTAL cell is left empty (user 2026-09-29 - it used to read 122, the digits
    // scraped out of the suggestion sentences).
    public bool NotSummable { get; set; }
}
public class GoalSummaryCellDto
{
    public string? AsOnJul1 { get; set; }   // baseline (Reference) value as on July 1st
    public string? Target { get; set; }
    public string? Achieved { get; set; }
    public string? Pct { get; set; }
    public string? Value { get; set; }      // single-value metrics (RAG bands): clubs in that band
}
public class GoalSummaryDistrictRowDto
{
    public int DistrictId { get; set; }
    public string DistrictNumber { get; set; } = "";
    public Dictionary<int, List<GoalSummaryCellDto>> Cells { get; set; } = new(); // categoryId -> per-metric cells (aligned to Metrics)
}

// ── Month-wise goals (additive; separate from the annual goal_entries flow) ──────────────
// One collected value per (field, Rotary-year month). Targets/baselines stay annual — only the
// "collected/achieved" fields are tracked per month here. PeriodMonth = calendar month (7=Jul … 6=Jun).
public class GoalMonthPeriodDto
{
    public int Month { get; set; }            // calendar month number, 7..12 then 1..6
    public string Label { get; set; } = "";   // "Jul", "Aug" …
    public int CalendarYear { get; set; }
    public bool IsAvailable { get; set; }      // false = a future month of the current year (can't collect yet)
}

public class GoalMonthlyFieldDto
{
    public int FieldId { get; set; }
    public string GroupName { get; set; } = "";
    public string FieldKey { get; set; } = "";
    public string FieldLabel { get; set; } = "";
    public string DataType { get; set; } = "";
    public string? Unit { get; set; }
    public decimal? AnnualTarget { get; set; }                     // paired annual target (from goal_entries)
    public decimal? Baseline { get; set; }                         // "As on July 1st" — Membership only (clubs/members/women), else null
    public Dictionary<int, decimal?> Monthly { get; set; } = new();// month(7..6) -> collected value
    public decimal Total { get; set; }                            // sum of the monthly values
    // The yearly target split across the 12 months (user 2026-09-25). The YEAR itself is untouched -
    // AnnualTarget above is still the single figure the club typed. These 12 must add up to it
    // exactly. A quarter is never stored: QuarterlyTargets is the sum of each quarter's 3 months.
    public Dictionary<int, decimal?> MonthlyTargets { get; set; } = new();  // month(7..6) -> target
    public Dictionary<int, decimal?> QuarterlyTargets { get; set; } = new();// quarter(1..4) -> target
    public Dictionary<int, decimal?> QuarterlyAchieved { get; set; } = new();// quarter(1..4) -> collected
    public decimal TargetTotal { get; set; }                      // sum of the 12 monthly targets
    // WHAT the split must add up to. For a metric with a July-1st baseline (Membership: clubs,
    // members, women) that is the GROWTH - Target minus Baseline - because the district is not
    // gaining 108 clubs, it is gaining 4. TRF has no opening figure, so there it is the target
    // itself. Null when there is no target to split.
    public decimal? SplitBase { get; set; }
    // true when the split has not been saved yet and these figures are the automatic even spread.
    public bool TargetsAreSuggested { get; set; }
    // false → the field is ANNUAL only (baselines, RAG, Summary, Total Giving, Youth "Existing/Total",
    // Public Image Other Points + Suggestions). It is listed with its value but EMPTY month cells and is
    // never editable month-wise. YTD report sheets ignore these rows.
    public bool MonthlyTracked { get; set; } = true;
    public string? DisplayText { get; set; }                       // Yes/No or text value for annual-only fields
}

public class GoalMonthlyFormDto
{
    public int CategoryId { get; set; }
    public string CategoryName { get; set; } = "";
    public string EntityType { get; set; } = "";
    public int? ClubId { get; set; }
    public int? DistrictId { get; set; }
    public string EntityName { get; set; } = "";
    public int YearId { get; set; }
    public string YearLabel { get; set; } = "";
    public bool IsEditable { get; set; }
    public List<GoalMonthPeriodDto> Months { get; set; } = new();
    public List<GoalMonthlyFieldDto> Fields { get; set; } = new();
}

public class GoalMonthlySaveDto
{
    public int FieldId { get; set; }
    public decimal? NumericValue { get; set; }
}

public class SaveGoalMonthlyRequest
{
    public int YearId { get; set; }
    public int Month { get; set; }                        // the month being saved (7..6)
    public List<GoalMonthlySaveDto> Entries { get; set; } = new();
}

// Save the SPLIT of the yearly target (user 2026-09-25). The yearly figure is never sent and never
// changed here. Either 12 months or 4 quarters may be sent: a quarter is spread across its own three
// months and never leaves that quarter. The save is refused unless every field's split adds up to
// its yearly target exactly - no less, no more.
public class SaveGoalTargetSplitRequest
{
    public int YearId { get; set; }
    public string Period { get; set; } = "month";         // "month" (7..6) or "quarter" (1..4)
    public List<GoalTargetSplitFieldDto> Fields { get; set; } = new();
}

public class GoalTargetSplitFieldDto
{
    public int FieldId { get; set; }
    public Dictionary<int, decimal?> Values { get; set; } = new();  // month 7..6, or quarter 1..4
}

// What a refused split tells the user: which metric is wrong, and by how much.
public class GoalTargetSplitErrorDto
{
    public int FieldId { get; set; }
    public string FieldLabel { get; set; } = "";
    public decimal AnnualTarget { get; set; }
    public decimal Entered { get; set; }
    public decimal Difference { get; set; }               // Entered - AnnualTarget
}
