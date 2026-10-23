// Goal Setting (mobile) models — mirror RotaryApi/DTOs/GoalSettingDtos.cs.
// Covers the club/district goal ENTRY form (categories → metadata-driven fields
// → save). Keep in sync with the backend DTOs; the entry form is fully
// metadata-driven (never hardcode field keys — DataType + FieldRole decide how
// each field renders and saves).

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

/// A full category form: the entity it belongs to, its edit state, and the
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
        fields: _list(j['fields']).map(GoalFieldWithValue.fromJson).toList(),
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
