// Goal Setting (mobile) models — mirror RotaryApi/DTOs/GoalSettingDtos.cs.
// Covers BOTH the Goal Oversight dashboard (matrix + messaging) AND the club/
// district goal ENTRY form (categories → metadata-driven fields → save). Keep in
// sync with the backend DTOs; the oversight matrix carries Total/Target/Achieved
// per district, and the entry form is fully metadata-driven (never hardcode
// field keys — DataType + FieldRole decide how each field renders and saves).

// ── primitive parsers (same idiom as club_admin_dashboard_models) ────────────
int _i(dynamic v) {
  if (v is int) return v;
  if (v is num) return v.round();
  return int.tryParse('${v ?? ''}') ?? 0;
}

bool _b(dynamic v) {
  if (v is bool) return v;
  if (v is num) return v != 0;
  final s = '${v ?? ''}'.toLowerCase();
  return s == 'true' || s == '1';
}

String _s(dynamic v) => v?.toString() ?? '';

String? _sn(dynamic v) {
  final s = v?.toString();
  return (s == null || s.isEmpty) ? null : s;
}

/// Nullable numeric — preserves int vs double as the server sent it, null when
/// absent/unparseable (so an empty Target stays empty, not 0).
num? _numN(dynamic v) {
  if (v == null) return null;
  if (v is num) return v;
  return num.tryParse('$v');
}

/// Nullable boolean — distinguishes "not set" (null) from false, needed for
/// Boolean goal fields whose value may legitimately be unset.
bool? _boolN(dynamic v) {
  if (v == null) return null;
  if (v is bool) return v;
  if (v is num) return v != 0;
  final s = '$v'.toLowerCase();
  if (s == 'true' || s == '1') return true;
  if (s == 'false' || s == '0') return false;
  return null;
}

List<Map<String, dynamic>> _list(dynamic v) => v is List
    ? v.whereType<Map>().map((e) => e.cast<String, dynamic>()).toList()
    : const [];

List<int> _intList(dynamic v) => v is List
    ? v.map(_i).toList()
    : const [];

// ── categories ───────────────────────────────────────────────────────────────
class GoalCategory {
  final int id;
  final String name;
  final int sortOrder;
  const GoalCategory({required this.id, required this.name, required this.sortOrder});
  factory GoalCategory.fromJson(Map<String, dynamic> j) => GoalCategory(
        id: _i(j['id']),
        name: _s(j['name']),
        sortOrder: _i(j['sortOrder']),
      );
}

// ── the caller's own oversight assignments (drives scope + role label) ────────
class GoalMyAssignment {
  final int assignmentId;
  final String roleType; // FewDistrictsOneCategoryOneZone / AllDistrictsOneCategoryOneZone / AllCategoryAllDistrictsFewZones
  final String assignmentName;
  final List<int> categoryIds;
  final List<int> districtIds;
  final List<int> zoneIds;
  final bool canBulkLock;
  const GoalMyAssignment({
    required this.assignmentId,
    required this.roleType,
    required this.assignmentName,
    required this.categoryIds,
    required this.districtIds,
    required this.zoneIds,
    required this.canBulkLock,
  });
  factory GoalMyAssignment.fromJson(Map<String, dynamic> j) => GoalMyAssignment(
        assignmentId: _i(j['assignmentId']),
        roleType: _s(j['roleType']),
        assignmentName: _s(j['assignmentName']),
        categoryIds: _intList(j['categoryIds']),
        districtIds: _intList(j['districtIds']),
        zoneIds: _intList(j['zoneIds']),
        canBulkLock: _b(j['canBulkLock']),
      );
}

// ── one district row in a scoped list ────────────────────────────────────────
class GoalDistrictSummary {
  final int districtId;
  final String districtNumber;
  final int zoneId;
  final String? zoneName;
  final bool hasAnyGoalSet;
  final String? lastUpdatedDate;
  final bool isLocked;
  const GoalDistrictSummary({
    required this.districtId,
    required this.districtNumber,
    required this.zoneId,
    required this.zoneName,
    required this.hasAnyGoalSet,
    required this.lastUpdatedDate,
    required this.isLocked,
  });
  factory GoalDistrictSummary.fromJson(Map<String, dynamic> j) => GoalDistrictSummary(
        districtId: _i(j['districtId']),
        districtNumber: _s(j['districtNumber']),
        zoneId: _i(j['zoneId']),
        zoneName: _sn(j['zoneName']),
        hasAnyGoalSet: _b(j['hasAnyGoalSet']),
        lastUpdatedDate: _sn(j['lastUpdatedDate']),
        isLocked: _b(j['isLocked']),
      );
}

/// One club row in a district's goal club list — drives the oversight Club
/// picker (district → one club's read-only goals). Mirrors GoalClubSummaryDto.
class GoalClubSummary {
  final int clubId;
  final String clubName;
  final bool hasAnyGoalSet;
  final String? lastUpdatedDate;
  final String? lastUpdatedBy;
  final bool isLocked;
  const GoalClubSummary({
    required this.clubId,
    required this.clubName,
    required this.hasAnyGoalSet,
    required this.lastUpdatedDate,
    required this.lastUpdatedBy,
    required this.isLocked,
  });
  factory GoalClubSummary.fromJson(Map<String, dynamic> j) => GoalClubSummary(
        clubId: _i(j['clubId']),
        clubName: _s(j['clubName']),
        hasAnyGoalSet: _b(j['hasAnyGoalSet']),
        lastUpdatedDate: _sn(j['lastUpdatedDate']),
        lastUpdatedBy: _sn(j['lastUpdatedBy']),
        isLocked: _b(j['isLocked']),
      );
}

class GoalBulkLockResult {
  final int affectedCount;
  const GoalBulkLockResult({required this.affectedCount});
  factory GoalBulkLockResult.fromJson(Map<String, dynamic> j) =>
      GoalBulkLockResult(affectedCount: _i(j['affectedCount']));
}

// ── district summary matrix (web `district-summary-matrix` → GoalOversightMatrix) ──
// Districts are ROWS; every category the caller oversees lays out horizontally in
// front of the district number. Each metric GROUP contributes FOUR columns —
// baseline (as on July 1st) · Target · Achieved · Percentage — so the list at
// `row.cells[categoryId]` aligns 1:1 with `category.metrics`, and so does
// `category.totals`. Always index by position; never assume a metric count.
class GoalSummaryCell {
  final String? asOnJul1; // baseline (Reference) value as on July 1st
  final String? target;
  final String? achieved;
  final String? pct;
  /// The ONLY figure a single-value metric carries (a RAG band's club count, or
  /// a Membership "Summary" number). The other four are null for those metrics,
  /// so reading anything else here silently shows a dash instead of the number.
  final String? value;
  const GoalSummaryCell({
    this.asOnJul1,
    this.target,
    this.achieved,
    this.pct,
    this.value,
  });
  factory GoalSummaryCell.fromJson(Map<String, dynamic> j) => GoalSummaryCell(
        asOnJul1: _sn(j['asOnJul1']),
        target: _sn(j['target']),
        achieved: _sn(j['achieved']),
        pct: _sn(j['pct']),
        value: _sn(j['value']),
      );
}

class GoalSummaryMetric {
  final String groupName; // "New Clubs" / "Total Members" / "Women Membership"
  /// The exact form label for the baseline column, e.g.
  /// "Total No of Clubs as on July 1st". Rendered verbatim — do not shorten.
  /// For a single-value metric this doubles as that one column's heading.
  final String baselineLabel;

  /// Membership "RAG Analysis" only: "Red" | "Amber" | "Green" | "SuperGreen".
  /// Such a metric is ONE column holding a club count, painted in that colour.
  final String? ragBand;

  /// ONE column holding a bare number with no target/achieved/% — the RAG bands
  /// and the Membership "Summary" rows (Net Growth / New Clubs / New women
  /// members), which have no target to measure against.
  final bool singleValue;

  /// false → this metric has NO "as on July 1st" baseline, so the grid drops
  /// that column entirely (TRF: giving restarts at zero each year, so the
  /// column was always a dash).
  ///
  /// ⚠️ Defaults to TRUE when the server omits the key. Mirrors web's
  /// `hasBaseline !== false`, so an older API that predates the field keeps the
  /// original four-column layout instead of silently losing a column.
  final bool hasBaseline;

  const GoalSummaryMetric({
    required this.groupName,
    required this.baselineLabel,
    this.ragBand,
    this.singleValue = false,
    this.hasBaseline = true,
  });

  /// One column instead of the baseline/target/achieved/% block.
  bool get isSingle => (ragBand != null && ragBand!.isNotEmpty) || singleValue;

  /// How many columns this metric occupies: 1 single-value, 3 without a
  /// baseline, otherwise 4. Header and body MUST both go through this — they
  /// are separate widget trees and will shear if they disagree.
  int get columnCount => isSingle ? 1 : (hasBaseline ? 4 : 3);

  factory GoalSummaryMetric.fromJson(Map<String, dynamic> j) => GoalSummaryMetric(
        groupName: _s(j['groupName']),
        baselineLabel: _s(j['baselineLabel']),
        ragBand: _sn(j['ragBand']),
        singleValue: _b(j['singleValue']),
        // Absent or null ⇒ true (see the field doc above).
        hasBaseline: j['hasBaseline'] == null ? true : _b(j['hasBaseline']),
      );
}

class GoalSummaryCategory {
  final int categoryId;
  final String name;
  final List<GoalSummaryMetric> metrics;
  final List<GoalSummaryCell> totals; // summed TOTAL row, aligned to [metrics]
  const GoalSummaryCategory({
    required this.categoryId,
    required this.name,
    required this.metrics,
    required this.totals,
  });
  factory GoalSummaryCategory.fromJson(Map<String, dynamic> j) => GoalSummaryCategory(
        categoryId: _i(j['categoryId']),
        name: _s(j['name']),
        metrics: _list(j['metrics']).map(GoalSummaryMetric.fromJson).toList(),
        totals: _list(j['totals']).map(GoalSummaryCell.fromJson).toList(),
      );
}

class GoalSummaryDistrictRow {
  final int districtId;
  final String districtNumber;
  /// categoryId → per-metric cells, aligned to that category's `metrics`.
  final Map<int, List<GoalSummaryCell>> cells;
  const GoalSummaryDistrictRow({
    required this.districtId,
    required this.districtNumber,
    required this.cells,
  });

  /// The cell for one (category, metric index), or null when the server sent
  /// nothing for it — a district that simply hasn't filled that metric in.
  GoalSummaryCell? cell(int categoryId, int metricIndex) {
    final list = cells[categoryId];
    if (list == null || metricIndex >= list.length) return null;
    return list[metricIndex];
  }

  factory GoalSummaryDistrictRow.fromJson(Map<String, dynamic> j) {
    // `cells` is a JSON object keyed by categoryId — the keys arrive as STRINGS.
    final raw = j['cells'];
    final map = <int, List<GoalSummaryCell>>{};
    if (raw is Map) {
      raw.forEach((k, v) {
        final id = int.tryParse('$k');
        if (id == null) return;
        map[id] = _list(v).map(GoalSummaryCell.fromJson).toList();
      });
    }
    return GoalSummaryDistrictRow(
      districtId: _i(j['districtId']),
      districtNumber: _s(j['districtNumber']),
      cells: map,
    );
  }
}

class GoalDistrictSummaryMatrix {
  final int zoneId;
  final String zoneName;
  final int yearId;
  final String yearLabel;
  final List<GoalSummaryCategory> categories;
  final List<GoalSummaryDistrictRow> districts;
  const GoalDistrictSummaryMatrix({
    required this.zoneId,
    required this.zoneName,
    required this.yearId,
    required this.yearLabel,
    required this.categories,
    required this.districts,
  });
  factory GoalDistrictSummaryMatrix.fromJson(Map<String, dynamic> j) =>
      GoalDistrictSummaryMatrix(
        zoneId: _i(j['zoneId']),
        zoneName: _s(j['zoneName']),
        yearId: _i(j['yearId']),
        yearLabel: _s(j['yearLabel']),
        categories:
            _list(j['categories']).map(GoalSummaryCategory.fromJson).toList(),
        districts:
            _list(j['districts']).map(GoalSummaryDistrictRow.fromJson).toList(),
      );
}

// ── messaging ─────────────────────────────────────────────────────────────────
class GoalMessageThread {
  final int ownerMemberId;
  final String ownerName;
  final String ownerRoleLabel;
  final String? scope;
  final bool isMine;
  final String? lastMessagePreview;
  final String? lastMessageDate;
  final int messageCount;
  final String? counterpartyName;
  final bool canPost;
  final String? notice;
  const GoalMessageThread({
    required this.ownerMemberId,
    required this.ownerName,
    required this.ownerRoleLabel,
    required this.scope,
    required this.isMine,
    required this.lastMessagePreview,
    required this.lastMessageDate,
    required this.messageCount,
    required this.counterpartyName,
    required this.canPost,
    required this.notice,
  });
  factory GoalMessageThread.fromJson(Map<String, dynamic> j) => GoalMessageThread(
        ownerMemberId: _i(j['ownerMemberId']),
        ownerName: _s(j['ownerName']),
        ownerRoleLabel: _s(j['ownerRoleLabel']),
        scope: _sn(j['scope']),
        isMine: _b(j['isMine']),
        lastMessagePreview: _sn(j['lastMessagePreview']),
        lastMessageDate: _sn(j['lastMessageDate']),
        messageCount: _i(j['messageCount']),
        counterpartyName: _sn(j['counterpartyName']),
        canPost: _b(j['canPost']),
        notice: _sn(j['notice']),
      );
}

class GoalThreadList {
  final String viewerRole; // RIDirector | ZoneCoordinator | DistrictAssistant | SuperAdmin | None
  final List<GoalMessageThread> threads;
  const GoalThreadList({required this.viewerRole, required this.threads});
  factory GoalThreadList.fromJson(Map<String, dynamic> j) => GoalThreadList(
        viewerRole: _s(j['viewerRole']).isEmpty ? 'None' : _s(j['viewerRole']),
        threads: _list(j['threads']).map(GoalMessageThread.fromJson).toList(),
      );
}

class GoalComment {
  final int id;
  final String commentText;
  final int postedByMemberId;
  final String postedByName;
  final int postedByTier;
  final String? createdDate;
  final String? postedByRoleLabel;
  final bool isMine;

  /// Which district the message was posted about. A District Assistant writes
  /// about one district; a Zone Co-ordinator writes zone-wide, so these are
  /// null and the message reads as "All districts".
  final int? districtId;
  final String? districtNumber;

  const GoalComment({
    required this.id,
    required this.commentText,
    required this.postedByMemberId,
    required this.postedByName,
    required this.postedByTier,
    required this.createdDate,
    required this.postedByRoleLabel,
    required this.isMine,
    this.districtId,
    this.districtNumber,
  });
  factory GoalComment.fromJson(Map<String, dynamic> j) => GoalComment(
        id: _i(j['id']),
        commentText: _s(j['commentText']),
        postedByMemberId: _i(j['postedByMemberId']),
        postedByName: _s(j['postedByName']),
        postedByTier: _i(j['postedByTier']),
        createdDate: _sn(j['createdDate']),
        postedByRoleLabel: _sn(j['postedByRoleLabel']),
        isMine: _b(j['isMine']),
        districtId: _numN(j['districtId'])?.toInt(),
        districtNumber: _sn(j['districtNumber']),
      );
}

// ═══════════════════════════════════════════════════════════════════════════
// Goal ENTRY form (club / district) — metadata-driven, mirrors the web
// GoalSettingPanel. One category at a time; fields grouped by `groupName`.
// ═══════════════════════════════════════════════════════════════════════════

/// One field of a goal category form, carrying both its metadata (how to render)
/// and its current value. `dataType` ∈ Integer/Decimal/Percentage/Currency/
/// Boolean/Text; `fieldRole` ∈ Reference/Target/Computed.
class GoalFieldWithValue {
  final int fieldId;
  final String groupName;
  final String fieldKey;
  final String fieldLabel;
  final String dataType;
  final String? unit;
  final String fieldRole;
  final num? numericValue;
  final String? textValue;
  final bool? boolValue;
  const GoalFieldWithValue({
    required this.fieldId,
    required this.groupName,
    required this.fieldKey,
    required this.fieldLabel,
    required this.dataType,
    required this.unit,
    required this.fieldRole,
    required this.numericValue,
    required this.textValue,
    required this.boolValue,
  });
  factory GoalFieldWithValue.fromJson(Map<String, dynamic> j) => GoalFieldWithValue(
        fieldId: _i(j['fieldId']),
        groupName: _s(j['groupName']),
        fieldKey: _s(j['fieldKey']),
        fieldLabel: _s(j['fieldLabel']),
        dataType: _s(j['dataType']),
        unit: _sn(j['unit']),
        fieldRole: _s(j['fieldRole']),
        numericValue: _numN(j['numericValue']),
        textValue: _sn(j['textValue']),
        boolValue: _boolN(j['boolValue']),
      );

  bool get isCurrency => dataType == 'Currency';
  bool get isPercentage => dataType == 'Percentage';
  bool get isBoolean => dataType == 'Boolean';
  bool get isText => dataType == 'Text';
  bool get isComputed => fieldRole == 'Computed';
  bool get isTarget => fieldRole == 'Target';
  bool get isReference => fieldRole == 'Reference';
}

/// A full category form: the entity it belongs to, its edit/lock state, and the
/// ordered list of fields to render.
class GoalCategoryForm {
  final int categoryId;
  final String categoryName;
  final String entityType; // Club | District
  final int? clubId;
  final int? districtId;
  final String entityName;
  final int yearId;
  final String yearLabel;
  final bool isEditable;
  final bool isLocked;
  final String? lockedByName;
  final String? lockedDate;
  final bool canLock;
  final List<GoalFieldWithValue> fields;
  const GoalCategoryForm({
    required this.categoryId,
    required this.categoryName,
    required this.entityType,
    required this.clubId,
    required this.districtId,
    required this.entityName,
    required this.yearId,
    required this.yearLabel,
    required this.isEditable,
    required this.isLocked,
    required this.lockedByName,
    required this.lockedDate,
    required this.canLock,
    required this.fields,
  });
  factory GoalCategoryForm.fromJson(Map<String, dynamic> j) => GoalCategoryForm(
        categoryId: _i(j['categoryId']),
        categoryName: _s(j['categoryName']),
        entityType: _s(j['entityType']),
        clubId: _numN(j['clubId'])?.toInt(),
        districtId: _numN(j['districtId'])?.toInt(),
        entityName: _s(j['entityName']),
        yearId: _i(j['yearId']),
        yearLabel: _s(j['yearLabel']),
        isEditable: _b(j['isEditable']),
        isLocked: _b(j['isLocked']),
        lockedByName: _sn(j['lockedByName']),
        lockedDate: _sn(j['lockedDate']),
        canLock: _b(j['canLock']),
        fields: _list(j['fields']).map(GoalFieldWithValue.fromJson).toList(),
      );
}

/// Lock/unlock result for a category+year.
class GoalLockStatus {
  final bool isLocked;
  final String? lockedByName;
  final String? lockedDate;
  const GoalLockStatus({
    required this.isLocked,
    required this.lockedByName,
    required this.lockedDate,
  });
  factory GoalLockStatus.fromJson(Map<String, dynamic> j) => GoalLockStatus(
        isLocked: _b(j['isLocked']),
        lockedByName: _sn(j['lockedByName']),
        lockedDate: _sn(j['lockedDate']),
      );
}

/// One outgoing saved entry. Exactly one of numeric/text/bool carries the value
/// (matching the field's DataType); the other two stay null.
class GoalEntrySave {
  final int fieldId;
  final num? numericValue;
  final String? textValue;
  final bool? boolValue;
  const GoalEntrySave({
    required this.fieldId,
    this.numericValue,
    this.textValue,
    this.boolValue,
  });
  Map<String, dynamic> toJson() => {
        'fieldId': fieldId,
        'numericValue': numericValue,
        'textValue': textValue,
        'boolValue': boolValue,
      };
}

/// Save payload for one category's editable fields.
class SaveGoalEntriesRequest {
  final int yearId;
  final List<GoalEntrySave> entries;
  const SaveGoalEntriesRequest({required this.yearId, required this.entries});
  Map<String, dynamic> toJson() => {
        'yearId': yearId,
        'entries': entries.map((e) => e.toJson()).toList(),
      };
}

// ── Club Goal Setting matrices (the oversight "View clubs" popup) ────────────
// Web `ClubGoalSettingPanel`, fed by the *scoped* oversight endpoints so an RI
// Director / ZC / DA can view any district they oversee. Read-only.

class GoalMatrixColumn {
  final String fieldKey;
  final String fieldLabel;
  final String groupName;
  final String dataType;
  final String? unit;
  const GoalMatrixColumn({
    required this.fieldKey,
    required this.fieldLabel,
    required this.groupName,
    this.dataType = '',
    this.unit,
  });
  factory GoalMatrixColumn.fromJson(Map<String, dynamic> j) => GoalMatrixColumn(
        fieldKey: _s(j['fieldKey']),
        fieldLabel: _s(j['fieldLabel']),
        groupName: _s(j['groupName']),
        dataType: _s(j['dataType']),
        unit: _sn(j['unit']),
      );

  /// "New Members (nos)" — the unit only when there is one.
  String get headingWithUnit =>
      (unit == null || unit!.isEmpty) ? fieldLabel : '$fieldLabel ($unit)';
}

class GoalMatrixRow {
  final int clubId;
  final String clubName;

  /// Per-club RAG by active synced members: Red 10-25, Amber 26-40,
  /// Green 41-50, SuperGreen 51+, None (<10). Only meaningful on Membership.
  final String rag;
  final int memberCount;

  /// fieldKey → already-formatted display value (numbers, "Yes/No", "12%").
  /// Formatting belongs to the server — never re-format these client-side.
  final Map<String, String?> values;

  const GoalMatrixRow({
    required this.clubId,
    required this.clubName,
    this.rag = 'None',
    this.memberCount = 0,
    this.values = const {},
  });

  factory GoalMatrixRow.fromJson(Map<String, dynamic> j) => GoalMatrixRow(
        clubId: _i(j['clubId']),
        clubName: _s(j['clubName']),
        rag: _s(j['rag']).isEmpty ? 'None' : _s(j['rag']),
        memberCount: _i(j['memberCount']),
        values: _strMap(j['values']),
      );
}

class GoalClubMatrix {
  final int categoryId;
  final String categoryName;
  final int yearId;
  final String yearLabel;
  final List<GoalMatrixColumn> columns;
  final List<GoalMatrixRow> clubs;

  const GoalClubMatrix({
    this.categoryId = 0,
    this.categoryName = '',
    this.yearId = 0,
    this.yearLabel = '',
    this.columns = const [],
    this.clubs = const [],
  });

  /// The RAG band is shown as its own column rather than as data, so its
  /// generated columns are dropped — same as web.
  List<GoalMatrixColumn> get dataColumns =>
      columns.where((c) => c.groupName != 'RAG Analysis').toList();

  bool get isMembership => categoryName.toLowerCase().contains('membership');

  factory GoalClubMatrix.fromJson(Map<String, dynamic> j) => GoalClubMatrix(
        categoryId: _i(j['categoryId']),
        categoryName: _s(j['categoryName']),
        yearId: _i(j['yearId']),
        yearLabel: _s(j['yearLabel']),
        columns:
            _list(j['columns']).map(GoalMatrixColumn.fromJson).toList(),
        clubs: _list(j['clubs']).map(GoalMatrixRow.fromJson).toList(),
      );
}

class GoalMonthPeriod {
  final int month; // calendar month 7..12 then 1..6
  final String label; // "Jul", "Aug" …
  final int calendarYear;

  /// false = a future month of the current year, so nothing can be collected
  /// yet. Its heading is dimmed rather than hidden.
  final bool isAvailable;

  const GoalMonthPeriod({
    required this.month,
    required this.label,
    this.calendarYear = 0,
    this.isAvailable = true,
  });

  factory GoalMonthPeriod.fromJson(Map<String, dynamic> j) => GoalMonthPeriod(
        month: _i(j['month']),
        label: _s(j['label']),
        calendarYear: _i(j['calendarYear']),
        isAvailable: _b(j['isAvailable']),
      );
}

class GoalMatrixMonthlyField {
  final String fieldKey;
  final String fieldLabel;
  final String? unit;
  const GoalMatrixMonthlyField({
    required this.fieldKey,
    required this.fieldLabel,
    this.unit,
  });
  factory GoalMatrixMonthlyField.fromJson(Map<String, dynamic> j) =>
      GoalMatrixMonthlyField(
        fieldKey: _s(j['fieldKey']),
        fieldLabel: _s(j['fieldLabel']),
        unit: _sn(j['unit']),
      );
}

class GoalClubMonthlyRow {
  final int clubId;
  final String clubName;

  /// fieldKey → (month 7..6 → formatted value).
  final Map<String, Map<int, String?>> values;

  /// fieldKey → year total (formatted).
  final Map<String, String?> totals;

  const GoalClubMonthlyRow({
    required this.clubId,
    required this.clubName,
    this.values = const {},
    this.totals = const {},
  });

  /// One club's value for a metric in a month, or null when nothing was
  /// collected — rendered as a dash, never as zero.
  String? valueFor(String fieldKey, int month) => values[fieldKey]?[month];

  factory GoalClubMonthlyRow.fromJson(Map<String, dynamic> j) {
    // values is an object of objects, and BOTH levels arrive as string keys.
    final raw = j['values'];
    final out = <String, Map<int, String?>>{};
    if (raw is Map) {
      raw.forEach((field, months) {
        if (months is! Map) return;
        final byMonth = <int, String?>{};
        months.forEach((m, v) {
          final month = int.tryParse('$m');
          if (month != null) byMonth[month] = _sn(v);
        });
        out['$field'] = byMonth;
      });
    }
    return GoalClubMonthlyRow(
      clubId: _i(j['clubId']),
      clubName: _s(j['clubName']),
      values: out,
      totals: _strMap(j['totals']),
    );
  }
}

class GoalClubMonthlyMatrix {
  final int categoryId;
  final String categoryName;
  final int yearId;
  final String yearLabel;
  final List<GoalMonthPeriod> months;
  final List<GoalMatrixMonthlyField> fields;
  final List<GoalClubMonthlyRow> clubs;

  const GoalClubMonthlyMatrix({
    this.categoryId = 0,
    this.categoryName = '',
    this.yearId = 0,
    this.yearLabel = '',
    this.months = const [],
    this.fields = const [],
    this.clubs = const [],
  });

  factory GoalClubMonthlyMatrix.fromJson(Map<String, dynamic> j) =>
      GoalClubMonthlyMatrix(
        categoryId: _i(j['categoryId']),
        categoryName: _s(j['categoryName']),
        yearId: _i(j['yearId']),
        yearLabel: _s(j['yearLabel']),
        months: _list(j['months']).map(GoalMonthPeriod.fromJson).toList(),
        fields:
            _list(j['fields']).map(GoalMatrixMonthlyField.fromJson).toList(),
        clubs: _list(j['clubs']).map(GoalClubMonthlyRow.fromJson).toList(),
      );
}

/// `{"a": "1", "b": null}` → a plain string map, tolerating non-string keys.
Map<String, String?> _strMap(dynamic raw) {
  final out = <String, String?>{};
  if (raw is Map) {
    raw.forEach((k, v) => out['$k'] = _sn(v));
  }
  return out;
}

// ── Month-wise collection (the oversight row-click popup) ────────────────────
// Read-only twin of web's `DistrictMonthWiseReport`: per category, metric rows ×
// month columns showing the CUMULATIVE achieved figure at each month.

/// Formats a goal number the way the report does: whole numbers plain, decimals
/// to at most 2 places with trailing zeros trimmed, nothing at all as a dash.
String fmtGoalNumber(num? v) {
  if (v == null) return '–';
  final d = v.toDouble();
  if (d == d.roundToDouble()) return d.toInt().toString();
  var s = d.toStringAsFixed(2);
  if (s.contains('.')) {
    s = s.replaceAll(RegExp(r'0+$'), '');
    if (s.endsWith('.')) s = s.substring(0, s.length - 1);
  }
  return s;
}

class GoalMonthlyField {
  final int fieldId;
  final String groupName;
  final String fieldKey;
  final String fieldLabel;
  final String dataType;
  final String? unit;

  /// The paired annual target from the goal form.
  final double? annualTarget;

  /// "As on July 1st" — Membership only (clubs / members / women), else null.
  final double? baseline;

  /// month (7..12 then 1..6) → the value collected IN that month (an addition,
  /// not a running figure).
  final Map<int, double?> monthly;

  final double total;

  /// false → the field is ANNUAL only (baselines, RAG, Summary, Total Giving,
  /// Youth "Existing/Total", Public Image Other Points + Suggestions). It is
  /// listed with its value but with EMPTY month cells.
  ///
  /// ⚠️ Defaults to TRUE when the server omits the key, matching the C# default.
  final bool monthlyTracked;

  /// Yes/No or free text for annual-only fields, shown instead of the target.
  final String? displayText;

  const GoalMonthlyField({
    required this.fieldId,
    required this.fieldLabel,
    this.groupName = '',
    this.fieldKey = '',
    this.dataType = '',
    this.unit,
    this.annualTarget,
    this.baseline,
    this.monthly = const {},
    this.total = 0,
    this.monthlyTracked = true,
    this.displayText,
  });

  factory GoalMonthlyField.fromJson(Map<String, dynamic> j) {
    // `monthly` keys arrive as STRINGS ("7", "8" …).
    final raw = j['monthly'];
    final byMonth = <int, double?>{};
    if (raw is Map) {
      raw.forEach((k, v) {
        final m = int.tryParse('$k');
        if (m != null) byMonth[m] = _numN(v)?.toDouble();
      });
    }
    return GoalMonthlyField(
      fieldId: _i(j['fieldId']),
      groupName: _s(j['groupName']),
      fieldKey: _s(j['fieldKey']),
      fieldLabel: _s(j['fieldLabel']),
      dataType: _s(j['dataType']),
      unit: _sn(j['unit']),
      annualTarget: _numN(j['annualTarget'])?.toDouble(),
      baseline: _numN(j['baseline'])?.toDouble(),
      monthly: byMonth,
      total: _numN(j['total'])?.toDouble() ?? 0,
      monthlyTracked: j['monthlyTracked'] == false ? false : true,
      displayText: _sn(j['displayText']),
    );
  }

  /// The running achieved figure at each month: baseline plus every addition up
  /// to and including that month. A month that can't be collected yet (a future
  /// month of the current year) is null, so it renders as a dash rather than
  /// repeating the previous figure.
  List<double?> cumulative(List<GoalMonthPeriod> months) {
    var run = baseline ?? 0;
    return [
      for (final m in months)
        if (!m.isAvailable) null else (run += (monthly[m.month] ?? 0)),
    ];
  }

  /// The last figure actually reached — what the report calls "Achieved".
  double? achieved(List<GoalMonthPeriod> months) {
    double? last;
    for (final v in cumulative(months)) {
      if (v != null) last = v;
    }
    return last;
  }

  /// % Achievement, the report's formula: a metric WITH a baseline measures
  /// growth — (achieved − baseline) / (target − baseline); one without measures
  /// the plain ratio. A zero denominator has no meaningful percentage.
  String pctAchievedText(double? achievedValue) {
    if (achievedValue == null || annualTarget == null) return '–';
    final b = baseline;
    final denom = b == null ? annualTarget! : annualTarget! - b;
    final numer = b == null ? achievedValue : achievedValue - b;
    if (denom == 0) return '–';
    final p = (numer / denom) * 100;
    return '${fmtGoalNumber((p * 100).roundToDouble() / 100)}%';
  }
}

class GoalMonthlyForm {
  final int categoryId;
  final String categoryName;
  final String entityName;
  final int yearId;
  final String yearLabel;
  final List<GoalMonthPeriod> months;
  final List<GoalMonthlyField> fields;

  const GoalMonthlyForm({
    this.categoryId = 0,
    this.categoryName = '',
    this.entityName = '',
    this.yearId = 0,
    this.yearLabel = '',
    this.months = const [],
    this.fields = const [],
  });

  factory GoalMonthlyForm.fromJson(Map<String, dynamic> j) => GoalMonthlyForm(
        categoryId: _i(j['categoryId']),
        categoryName: _s(j['categoryName']),
        entityName: _s(j['entityName']),
        yearId: _i(j['yearId']),
        yearLabel: _s(j['yearLabel']),
        months: _list(j['months']).map(GoalMonthPeriod.fromJson).toList(),
        fields: _list(j['fields']).map(GoalMonthlyField.fromJson).toList(),
      );
}


/// One person in the RI Director's message roster: a Zone Co-ordinator or
/// District Assistant of the zone, with how many messages they have sent.
class GoalMessageOwner {
  final int memberId;

  /// A ZC/DA is per-category, so the SAME member can appear twice under
  /// different categories — never key a list on memberId alone.
  final int categoryId;
  final String name;
  final String roleLabel; // "Zone Co-ordinator" | "District Assistant"
  final String categoryName;

  /// A District Assistant's covered district numbers, comma-joined. Null for a
  /// Zone Co-ordinator, who covers the whole zone.
  final String? districts;

  final int messageCount;

  const GoalMessageOwner({
    required this.memberId,
    required this.categoryId,
    required this.name,
    this.roleLabel = '',
    this.categoryName = '',
    this.districts,
    this.messageCount = 0,
  });

  factory GoalMessageOwner.fromJson(Map<String, dynamic> j) => GoalMessageOwner(
        memberId: _i(j['memberId']),
        categoryId: _i(j['categoryId']),
        name: _s(j['name']),
        roleLabel: _s(j['roleLabel']),
        categoryName: _s(j['categoryName']),
        districts: _sn(j['districts']),
        messageCount: _i(j['messageCount']),
      );
}
