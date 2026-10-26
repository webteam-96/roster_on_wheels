import 'package:flutter/material.dart' hide Text;
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_exceptions.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../widgets/common/custom_app_bar.dart';
import '../../../widgets/common/custom_text_field.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

// ─────────────────────────────────────────────────────────────────────────────
// District Citation — Add/Edit Auto Question form
//
// Web parity: rotary-frontend/src/app/districts/[id]/citation/page.tsx
//   (Auto Question dialog section).
//
// Sub-items are gated by `activity.subType == 1`. Two flavours based on
// activity name:
//   • Club Service    → Meeting Type dropdown (no further nesting).
//   • Other services  → Area of Focus dropdown.
// ─────────────────────────────────────────────────────────────────────────────

class CitationQuestionFormOption {
  final int id;
  final String name;
  // For activities only. subType == 1 means the activity supports sub-items.
  final int? subType;
  const CitationQuestionFormOption({
    required this.id,
    required this.name,
    this.subType,
  });
}

class CitationSubItemInitial {
  final String subItemType; // meeting_type | area_of_focus
  final int? subItemId;
  final String? subItemName;
  final num points;
  final bool isBonus;
  final num? bonusPoints;
  final num? minBonus;
  final num? maxBonus;
  const CitationSubItemInitial({
    required this.subItemType,
    this.subItemId,
    this.subItemName,
    required this.points,
    this.isBonus = false,
    this.bonusPoints,
    this.minBonus,
    this.maxBonus,
  });
}

class CitationQuestionFormInitial {
  final int id;
  final int? categoryId;
  final int? activityId;
  final num points;
  final int sortOrder;
  final bool isBonus;
  final num? bonusPoints;
  final num? minBonus;
  final num? maxBonus;
  final List<CitationSubItemInitial> subItems;
  const CitationQuestionFormInitial({
    required this.id,
    this.categoryId,
    this.activityId,
    required this.points,
    required this.sortOrder,
    required this.isBonus,
    this.bonusPoints,
    this.minBonus,
    this.maxBonus,
    this.subItems = const [],
  });
}

class DistrictCitationQuestionFormScreen extends StatefulWidget {
  final int districtId;
  final int yearId;
  final List<CitationQuestionFormOption> categories;
  final List<CitationQuestionFormOption> activities;
  // Hardcoded by the backend; passed in so the screen doesn't refetch.
  final List<CitationQuestionFormOption> meetingTypes;
  final CitationQuestionFormInitial? initial;

  const DistrictCitationQuestionFormScreen({
    super.key,
    required this.districtId,
    required this.yearId,
    required this.categories,
    required this.activities,
    this.meetingTypes = const [],
    this.initial,
  });

  @override
  State<DistrictCitationQuestionFormScreen> createState() =>
      _DistrictCitationQuestionFormScreenState();
}

// Each sub-item card holds its own draft state + its own AoF list (loaded
// lazily once the type is known).
class _SubItemDraft {
  String subItemType; // empty until user picks
  int? subItemId;
  String? subItemName;
  final TextEditingController pointsCtrl;
  bool isBonus;
  final TextEditingController bonusPointsCtrl;
  final TextEditingController minBonusCtrl;
  final TextEditingController maxBonusCtrl;

  // Loaded lookup list (populated lazily once the type is picked).
  List<CitationQuestionFormOption> aofList;

  _SubItemDraft({
    this.subItemType = '',
    this.subItemId,
    this.subItemName,
    String points = '',
    this.isBonus = false,
    String bonusPoints = '',
    String minBonus = '',
    String maxBonus = '',
  })  : pointsCtrl = TextEditingController(text: points),
        bonusPointsCtrl = TextEditingController(text: bonusPoints),
        minBonusCtrl = TextEditingController(text: minBonus),
        maxBonusCtrl = TextEditingController(text: maxBonus),
        aofList = const [];

  void dispose() {
    pointsCtrl.dispose();
    bonusPointsCtrl.dispose();
    minBonusCtrl.dispose();
    maxBonusCtrl.dispose();
  }

  factory _SubItemDraft.fromInitial(CitationSubItemInitial s) => _SubItemDraft(
        subItemType: s.subItemType,
        subItemId: s.subItemId,
        subItemName: s.subItemName,
        points: s.points.toString(),
        isBonus: s.isBonus,
        bonusPoints: s.bonusPoints?.toString() ?? '',
        minBonus: s.minBonus?.toString() ?? '',
        maxBonus: s.maxBonus?.toString() ?? '',
      );

  Map<String, dynamic> toJson() => {
        'subItemType': subItemType,
        'subItemId': subItemId,
        'subItemName': subItemName,
        'points': num.tryParse(pointsCtrl.text.trim()) ?? 0,
        'isBonus': isBonus,
        'bonusPoints': isBonus
            ? (num.tryParse(bonusPointsCtrl.text.trim()) ?? 0)
            : 0,
        'minBonus': isBonus ? (num.tryParse(minBonusCtrl.text.trim()) ?? 0) : 0,
        'maxBonus': isBonus ? (num.tryParse(maxBonusCtrl.text.trim()) ?? 0) : 0,
      };
}

class _DistrictCitationQuestionFormScreenState
    extends State<DistrictCitationQuestionFormScreen> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _pointsCtrl = TextEditingController();
  final _sortCtrl = TextEditingController();
  final _bonusPointsCtrl = TextEditingController();
  final _minBonusCtrl = TextEditingController();
  final _maxBonusCtrl = TextEditingController();

  int? _categoryId;
  int? _activityId;
  bool _isBonus = false;
  bool _saving = false;

  final List<_SubItemDraft> _subItems = [];

  bool get _isEdit => widget.initial != null;

  CitationQuestionFormOption? get _selectedActivity {
    if (_activityId == null) return null;
    for (final a in widget.activities) {
      if (a.id == _activityId) return a;
    }
    return null;
  }

  /// Maps an activity name to the moduleKey used by the AoF API.
  String _moduleKeyForActivity(String name) {
    final n = name.toLowerCase();
    if (n.contains('community')) return 'community_service';
    if (n.contains('vocational')) return 'vocational_service';
    if (n.contains('international')) return 'international_service';
    if (n.contains('new generation')) return 'new_generation_service';
    if (n.contains('public image')) return 'public_image_initiative';
    return '';
  }

  bool get _isClubService =>
      (_selectedActivity?.name ?? '').toLowerCase().contains('club service');

  @override
  void initState() {
    super.initState();
    final init = widget.initial;
    if (init != null) {
      _categoryId = init.categoryId;
      _activityId = init.activityId;
      _pointsCtrl.text = init.points.toString();
      _sortCtrl.text = init.sortOrder.toString();
      _isBonus = init.isBonus;
      _bonusPointsCtrl.text = init.bonusPoints?.toString() ?? '';
      _minBonusCtrl.text = init.minBonus?.toString() ?? '';
      _maxBonusCtrl.text = init.maxBonus?.toString() ?? '';
      for (final s in init.subItems) {
        _subItems.add(_SubItemDraft.fromInitial(s));
      }
      // Preload lookup lists for each sub-item (so edit shows the right
      // selected values without the user having to re-pick).
      WidgetsBinding.instance.addPostFrameCallback((_) => _hydrateSubItems());
    } else {
      _pointsCtrl.text = '0';
      _sortCtrl.text = '0';
    }
  }

  @override
  void dispose() {
    _pointsCtrl.dispose();
    _sortCtrl.dispose();
    _bonusPointsCtrl.dispose();
    _minBonusCtrl.dispose();
    _maxBonusCtrl.dispose();
    for (final s in _subItems) {
      s.dispose();
    }
    super.dispose();
  }

  // ── Lookup loaders ─────────────────────────────────────────
  Future<List<CitationQuestionFormOption>> _loadAof(String moduleKey) async {
    if (moduleKey.isEmpty) return const [];
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/district-modules/citation/area-of-focus',
        queryParams: {'moduleKey': moduleKey},
        fromJson: (j) => j as List<dynamic>,
      );
      return (resp.data ?? [])
          .map((e) => CitationQuestionFormOption(
                id: (e['id'] as int?) ?? 0,
                name: e['name']?.toString() ?? '',
              ))
          .toList();
    } on ApiException {
      return const [];
    }
  }

  /// Pre-populates the AoF lookup list for each existing sub-item so the
  /// dropdown can render the currently-selected value.
  Future<void> _hydrateSubItems() async {
    final act = _selectedActivity;
    if (act == null) return;
    final moduleKey = _moduleKeyForActivity(act.name);
    if (moduleKey.isEmpty) return;
    for (var i = 0; i < _subItems.length; i++) {
      final sub = _subItems[i];
      if (sub.subItemType == 'meeting_type' || sub.subItemType.isEmpty) continue;
      sub.aofList = await _loadAof(moduleKey);
      if (mounted) setState(() {});
    }
  }

  // ── Sub-item mutators ──────────────────────────────────────
  void _addSubItem() {
    setState(() => _subItems.add(_SubItemDraft(
          subItemType: _isClubService ? 'meeting_type' : '',
        )));
  }

  void _removeSubItem(int i) {
    setState(() {
      _subItems[i].dispose();
      _subItems.removeAt(i);
    });
  }

  Future<void> _onSubItemTypeChanged(int i, String newType) async {
    setState(() {
      final s = _subItems[i];
      s.subItemType = newType;
      s.subItemId = null;
      s.subItemName = null;
      s.aofList = const [];
    });
    if (newType.isNotEmpty &&
        newType != 'meeting_type' &&
        _selectedActivity != null) {
      final list = await _loadAof(_moduleKeyForActivity(_selectedActivity!.name));
      if (mounted) {
        setState(() => _subItems[i].aofList = list);
      }
    }
  }

  void _onAofChanged(int i, int aofId) {
    final s = _subItems[i];
    final picked =
        s.aofList.firstWhere((o) => o.id == aofId, orElse: () => const CitationQuestionFormOption(id: 0, name: ''));
    setState(() {
      s.subItemId = aofId;
      s.subItemName = picked.name;
    });
  }

  // ── Save ──────────────────────────────────────────────────
  String? _validateSubItems() {
    for (var i = 0; i < _subItems.length; i++) {
      final s = _subItems[i];
      final label = 'Sub Item #${i + 1}';
      if (s.subItemType == 'meeting_type') {
        if (s.subItemName == null || s.subItemName!.isEmpty) {
          return '$label: Please select a Meeting Type.';
        }
      } else if (s.subItemType.isEmpty) {
        return '$label: Please select what the points are for.';
      } else if (s.subItemId == null) {
        return '$label: Please select a value.';
      }
      final pts = num.tryParse(s.pointsCtrl.text.trim()) ?? 0;
      if (pts <= 0) return '$label: Points is required.';
      if (s.isBonus) {
        final bp = num.tryParse(s.bonusPointsCtrl.text.trim()) ?? 0;
        if (bp <= 0) return '$label: Bonus Points is required when Bonus is on.';
      }
    }
    return null;
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    final subErr = _validateSubItems();
    if (subErr != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(subErr), backgroundColor: AppColors.error),
      );
      return;
    }
    final body = <String, dynamic>{
      'yearId': widget.yearId,
      'categoryId': _categoryId,
      'activityId': _activityId,
      'points': num.tryParse(_pointsCtrl.text.trim()) ?? 0,
      'sortOrder': int.tryParse(_sortCtrl.text.trim()) ?? 0,
      'isBonus': _isBonus,
      'bonusPoints':
          _isBonus ? num.tryParse(_bonusPointsCtrl.text.trim()) ?? 0 : 0,
      'minBonus':
          _isBonus ? num.tryParse(_minBonusCtrl.text.trim()) ?? 0 : 0,
      'maxBonus':
          _isBonus ? num.tryParse(_maxBonusCtrl.text.trim()) ?? 0 : 0,
      'subItems': _subItems.map((s) => s.toJson()).toList(),
    };
    setState(() => _saving = true);
    try {
      final base =
          '/api/district-modules/${widget.districtId}/citation/auto-questions';
      if (_isEdit) {
        await _api.put('$base/${widget.initial!.id}', body: body);
      } else {
        await _api.post(base, body: body);
      }
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).clearSnackBars();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content: Text('Save failed: $e'),
            backgroundColor: AppColors.error),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  // ── UI ────────────────────────────────────────────────────
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(
        title: _isEdit ? 'Edit Auto Question' : 'Add Auto Question',
        onBack: _saving ? null : () => Navigator.of(context).pop(false),
        actions: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
            child: TextButton(
              onPressed: _saving ? null : _save,
              style: TextButton.styleFrom(
                backgroundColor: AppColors.goldPrime,
                foregroundColor: AppColors.darkBg,
                padding: const EdgeInsets.symmetric(horizontal: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
              child: _saving
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2.2,
                        color: Colors.black54,
                      ),
                    )
                  : Text(
                      'Save',
                      style: AppFonts.body(
                        fontWeight: FontWeight.w800,
                        fontSize: 13,
                      ),
                    ),
            ),
          ),
        ],
      ),
      body: Form(
        key: _formKey,
        autovalidateMode: AutovalidateMode.onUserInteraction,
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
            DropdownButtonFormField<int>(
              initialValue: _categoryId,
              decoration: InputDecoration(
                labelText: 'Category',
                border:
                    OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
              ),
              items: widget.categories
                  .map((c) => DropdownMenuItem(value: c.id, child: Text(c.name)))
                  .toList(),
              onChanged:
                  _saving ? null : (v) => setState(() => _categoryId = v),
              validator: (v) => v == null ? 'Category is required' : null,
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<int>(
              initialValue: _activityId,
              decoration: InputDecoration(
                labelText: 'Activity',
                border:
                    OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
              ),
              items: widget.activities
                  .map((a) => DropdownMenuItem(value: a.id, child: Text(a.name)))
                  .toList(),
              onChanged: _saving
                  ? null
                  : (v) {
                      setState(() {
                        _activityId = v;
                        // Reset sub-items if activity changes (lookup keys change).
                        for (final s in _subItems) {
                          s.dispose();
                        }
                        _subItems.clear();
                      });
                    },
              validator: (v) => v == null ? 'Activity is required' : null,
            ),
            const SizedBox(height: 12),
            CustomTextField(
              label: 'Points',
              controller: _pointsCtrl,
              keyboardType: TextInputType.number,
              prefixIcon: Icons.star_outline,
            ),
            const SizedBox(height: 12),
            CustomTextField(
              label: 'Sort Order',
              controller: _sortCtrl,
              keyboardType: TextInputType.number,
              prefixIcon: Icons.sort,
            ),
            const SizedBox(height: 8),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Bonus question'),
              value: _isBonus,
              onChanged: _saving ? null : (v) => setState(() => _isBonus = v),
            ),
            if (_isBonus) ...[
              CustomTextField(
                label: 'Bonus Points',
                controller: _bonusPointsCtrl,
                keyboardType: TextInputType.number,
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: CustomTextField(
                      label: 'Min Bonus',
                      controller: _minBonusCtrl,
                      keyboardType: TextInputType.number,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: CustomTextField(
                      label: 'Max Bonus',
                      controller: _maxBonusCtrl,
                      keyboardType: TextInputType.number,
                    ),
                  ),
                ],
              ),
            ],
            const SizedBox(height: 16),
            _buildSubItemsSection(),
          ],
        ),
        ),
      ),
    );
  }

  Widget _buildSubItemsSection() {
    final act = _selectedActivity;
    // Sub-items only relevant when activity opts-in (subType == 1).
    if (act == null || act.subType != 1) {
      return const SizedBox.shrink();
    }
    final sectionLabel = _isClubService ? 'Meeting Types' : 'Area of Focus';
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.border),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(sectionLabel,
                    style: const TextStyle(fontWeight: FontWeight.w700)),
              ),
              TextButton.icon(
                onPressed: _saving ? null : _addSubItem,
                icon: const Icon(Icons.add, size: 16),
                label: const Text('Add'),
              ),
            ],
          ),
          if (_subItems.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 8),
              child: const Text(
                'No sub-items yet. Tap Add to create one.',
                style: const TextStyle(color: AppColors.textSecondary),
              ),
            )
          else
            ..._subItems.asMap().entries.map((e) => _buildSubItemCard(e.key)),
        ],
      ),
    );
  }

  Widget _buildSubItemCard(int i) {
    final sub = _subItems[i];
    return Container(
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppColors.surface,
        border: Border.all(color: AppColors.border),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text('#${i + 1}',
                    style: const TextStyle(fontWeight: FontWeight.w600)),
              ),
              IconButton(
                icon: const Icon(Icons.delete_outline,
                    size: 18, color: AppColors.error),
                onPressed: _saving ? null : () => _removeSubItem(i),
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
              ),
            ],
          ),
          const SizedBox(height: 8),
          if (_isClubService)
            _meetingTypeDropdown(i, sub)
          else ...[
            _pointsForDropdown(i, sub),
            const SizedBox(height: 8),
            if (sub.subItemType.isNotEmpty) _cascadingDropdowns(i, sub),
          ],
          const SizedBox(height: 10),
          CustomTextField(
            label: 'Points',
            controller: sub.pointsCtrl,
            keyboardType: TextInputType.number,
          ),
          const SizedBox(height: 4),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            dense: true,
            title: const Text('Bonus', style: TextStyle(fontSize: 13)),
            value: sub.isBonus,
            onChanged: _saving
                ? null
                : (v) => setState(() => sub.isBonus = v),
          ),
          if (sub.isBonus) ...[
            CustomTextField(
              label: 'Bonus Points',
              controller: sub.bonusPointsCtrl,
              keyboardType: TextInputType.number,
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: CustomTextField(
                    label: 'Min Bonus',
                    controller: sub.minBonusCtrl,
                    keyboardType: TextInputType.number,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: CustomTextField(
                    label: 'Max Bonus',
                    controller: sub.maxBonusCtrl,
                    keyboardType: TextInputType.number,
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _meetingTypeDropdown(int i, _SubItemDraft sub) {
    return DropdownButtonFormField<String>(
      initialValue: (sub.subItemName?.isNotEmpty ?? false) ? sub.subItemName : null,
      decoration: const InputDecoration(
        labelText: 'Meeting Type',
        isDense: true,
      ),
      items: widget.meetingTypes
          .map((mt) => DropdownMenuItem<String>(
                value: mt.name,
                child: Text(mt.name),
              ))
          .toList(),
      onChanged: _saving
          ? null
          : (v) => setState(() {
                sub.subItemType = 'meeting_type';
                sub.subItemName = v;
                sub.subItemId = null;
              }),
    );
  }

  Widget _pointsForDropdown(int i, _SubItemDraft sub) {
    const options = [
      ['area_of_focus', 'Area of Focus'],
    ];
    return DropdownButtonFormField<String>(
      initialValue: sub.subItemType.isEmpty ? null : sub.subItemType,
      decoration: const InputDecoration(
        labelText: 'Points For',
        isDense: true,
      ),
      items: options
          .map((o) => DropdownMenuItem<String>(value: o[0], child: Text(o[1])))
          .toList(),
      onChanged:
          _saving ? null : (v) => v == null ? null : _onSubItemTypeChanged(i, v),
    );
  }

  Widget _cascadingDropdowns(int i, _SubItemDraft sub) {
    return DropdownButtonFormField<int>(
      initialValue: sub.subItemId,
      decoration: const InputDecoration(
        labelText: 'Area of Focus',
        isDense: true,
      ),
      items: sub.aofList
          .map((it) =>
              DropdownMenuItem<int>(value: it.id, child: Text(it.name)))
          .toList(),
      onChanged: _saving
          ? null
          : (v) => v == null ? null : _onAofChanged(i, v),
    );
  }
}
