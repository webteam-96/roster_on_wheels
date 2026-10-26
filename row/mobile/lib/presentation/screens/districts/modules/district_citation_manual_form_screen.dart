import 'package:flutter/material.dart' hide Text;
import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../widgets/common/custom_app_bar.dart';
import '../../../widgets/common/custom_text_field.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

// ─────────────────────────────────────────────────────────────────────────────
// District Citation — Add/Edit Manual Criteria form.
//
// Web parity: rotary-frontend/src/app/districts/[id]/citation/page.tsx
//   (Manual Criteria dialog section).
//
// Payload mirrors CitationManualCriteriaDto on the backend:
//   {
//     yearId, categoryId, criteriaName, sortOrder,
//     subCriteria: [{
//       subCriteriaTitle, answerType (number|yesno|choose_one),
//       points, isBonus, bonusPoints, minBonus, maxBonus, remark, sortOrder,
//       options: [{ optionText, optionPoints, sortOrder }]   // choose_one only
//     }]
//   }
// ─────────────────────────────────────────────────────────────────────────────

class CitationManualCategoryOption {
  final int id;
  final String name;
  const CitationManualCategoryOption({required this.id, required this.name});
}

class CitationManualOptionInitial {
  final String optionText;
  final num optionPoints;
  final int sortOrder;
  const CitationManualOptionInitial({
    required this.optionText,
    this.optionPoints = 0,
    this.sortOrder = 0,
  });
}

class CitationManualSubCriteriaInitial {
  final String subCriteriaTitle;
  final String answerType; // number | yesno | choose_one
  final num points;
  final bool isBonus;
  final num? bonusPoints;
  final num? minBonus;
  final num? maxBonus;
  final String remark;
  final int sortOrder;
  final List<CitationManualOptionInitial> options;

  const CitationManualSubCriteriaInitial({
    required this.subCriteriaTitle,
    this.answerType = 'number',
    this.points = 0,
    this.isBonus = false,
    this.bonusPoints,
    this.minBonus,
    this.maxBonus,
    this.remark = '',
    this.sortOrder = 0,
    this.options = const [],
  });
}

class CitationManualFormInitial {
  final int id;
  final int? categoryId;
  final int sortOrder;
  final List<CitationManualSubCriteriaInitial> subCriteria;
  const CitationManualFormInitial({
    required this.id,
    this.categoryId,
    this.sortOrder = 0,
    this.subCriteria = const [],
  });
}

class DistrictCitationManualFormScreen extends StatefulWidget {
  final int districtId;
  final int yearId;
  final List<CitationManualCategoryOption> categories;
  // Category IDs already used by other manual criteria — those are hidden in
  // the category dropdown (matches web behaviour). When editing, the current
  // category should be left in the list (caller decides what to pass).
  final Set<int> usedCategoryIds;
  final CitationManualFormInitial? initial;

  const DistrictCitationManualFormScreen({
    super.key,
    required this.districtId,
    required this.yearId,
    required this.categories,
    this.usedCategoryIds = const {},
    this.initial,
  });

  @override
  State<DistrictCitationManualFormScreen> createState() =>
      _DistrictCitationManualFormScreenState();
}

// In-form draft for a single Option inside a choose_one sub-criterion.
class _OptionDraft {
  final TextEditingController textCtrl;
  final TextEditingController pointsCtrl;
  final TextEditingController sortCtrl;
  _OptionDraft({String text = '', String points = '', String sort = '0'})
      : textCtrl = TextEditingController(text: text),
        pointsCtrl = TextEditingController(text: points),
        sortCtrl = TextEditingController(text: sort);
  void dispose() {
    textCtrl.dispose();
    pointsCtrl.dispose();
    sortCtrl.dispose();
  }

  Map<String, dynamic> toJson() => {
        'optionText': textCtrl.text.trim(),
        // Backend CitationSubCriteriaOptionDto.OptionPoints is int — send a
        // whole number, never a double (a decimal would 400 the model binder).
        'optionPoints': (num.tryParse(pointsCtrl.text.trim()) ?? 0).round(),
        'sortOrder': int.tryParse(sortCtrl.text.trim()) ?? 0,
      };
}

class _SubCriteriaDraft {
  final TextEditingController titleCtrl;
  String answerType; // number | yesno | choose_one
  final TextEditingController pointsCtrl;
  bool isBonus;
  final TextEditingController bonusPointsCtrl;
  final TextEditingController minBonusCtrl;
  final TextEditingController maxBonusCtrl;
  final TextEditingController remarkCtrl;
  final TextEditingController sortCtrl;
  final List<_OptionDraft> options;

  _SubCriteriaDraft({
    String title = '',
    this.answerType = 'number',
    String points = '',
    this.isBonus = false,
    String bonusPoints = '',
    String minBonus = '',
    String maxBonus = '',
    String remark = '',
    String sort = '0',
    List<_OptionDraft>? options,
  })  : titleCtrl = TextEditingController(text: title),
        pointsCtrl = TextEditingController(text: points),
        bonusPointsCtrl = TextEditingController(text: bonusPoints),
        minBonusCtrl = TextEditingController(text: minBonus),
        maxBonusCtrl = TextEditingController(text: maxBonus),
        remarkCtrl = TextEditingController(text: remark),
        sortCtrl = TextEditingController(text: sort),
        options = options ?? <_OptionDraft>[];

  void dispose() {
    titleCtrl.dispose();
    pointsCtrl.dispose();
    bonusPointsCtrl.dispose();
    minBonusCtrl.dispose();
    maxBonusCtrl.dispose();
    remarkCtrl.dispose();
    sortCtrl.dispose();
    for (final o in options) {
      o.dispose();
    }
  }

  factory _SubCriteriaDraft.fromInitial(CitationManualSubCriteriaInitial s) =>
      _SubCriteriaDraft(
        title: s.subCriteriaTitle,
        answerType: s.answerType,
        points: s.points == 0 ? '' : s.points.toString(),
        isBonus: s.isBonus,
        bonusPoints: s.bonusPoints?.toString() ?? '',
        minBonus: s.minBonus?.toString() ?? '',
        maxBonus: s.maxBonus?.toString() ?? '',
        remark: s.remark,
        sort: s.sortOrder.toString(),
        options: s.options
            .map((o) => _OptionDraft(
                  text: o.optionText,
                  points: o.optionPoints.toString(),
                  sort: o.sortOrder.toString(),
                ))
            .toList(),
      );

  Map<String, dynamic> toJson() => {
        'subCriteriaTitle': titleCtrl.text.trim(),
        'answerType': answerType,
        // Backend CitationManualSubCriteriaDto.Points/BonusPoints/MinBonus/
        // MaxBonus are all int — send whole numbers only. A double (from any
        // decimal input, e.g. "10.0") would 400 the [ApiController] model
        // binder and silently break "Add"/"Edit" (whole-points module).
        'points': (num.tryParse(pointsCtrl.text.trim()) ?? 0).round(),
        'isBonus': answerType == 'number' && isBonus,
        'bonusPoints': (answerType == 'number' && isBonus)
            ? (num.tryParse(bonusPointsCtrl.text.trim()) ?? 0).round()
            : 0,
        'minBonus': (answerType == 'number' && isBonus)
            ? (num.tryParse(minBonusCtrl.text.trim()) ?? 0).round()
            : 0,
        'maxBonus': (answerType == 'number' && isBonus)
            ? (num.tryParse(maxBonusCtrl.text.trim()) ?? 0).round()
            : 0,
        'remark': remarkCtrl.text.trim(),
        'sortOrder': int.tryParse(sortCtrl.text.trim()) ?? 0,
        'options': answerType == 'choose_one'
            ? options.map((o) => o.toJson()).toList()
            : <Map<String, dynamic>>[],
      };
}

class _DistrictCitationManualFormScreenState
    extends State<DistrictCitationManualFormScreen> {
  final _api = ApiClient();
  final _formKey = GlobalKey<FormState>();
  final _sortCtrl = TextEditingController();

  int? _categoryId;
  bool _saving = false;
  final List<_SubCriteriaDraft> _subs = [];

  bool get _isEdit => widget.initial != null;

  @override
  void initState() {
    super.initState();
    final init = widget.initial;
    if (init != null) {
      _categoryId = init.categoryId;
      _sortCtrl.text = init.sortOrder.toString();
      for (final s in init.subCriteria) {
        _subs.add(_SubCriteriaDraft.fromInitial(s));
      }
    } else {
      _sortCtrl.text = '0';
    }
  }

  @override
  void dispose() {
    _sortCtrl.dispose();
    for (final s in _subs) {
      s.dispose();
    }
    super.dispose();
  }

  void _addSub() => setState(() => _subs.add(_SubCriteriaDraft()));
  void _removeSub(int i) => setState(() {
        _subs[i].dispose();
        _subs.removeAt(i);
      });
  void _addOption(int subIdx) =>
      setState(() => _subs[subIdx].options.add(_OptionDraft()));
  void _removeOption(int subIdx, int optIdx) => setState(() {
        _subs[subIdx].options[optIdx].dispose();
        _subs[subIdx].options.removeAt(optIdx);
      });

  String? _validate() {
    if (_categoryId == null) return 'Category is required.';
    for (var i = 0; i < _subs.length; i++) {
      final s = _subs[i];
      final label = 'Sub Criteria #${i + 1}';
      if (s.titleCtrl.text.trim().isEmpty) return '$label: Title is required.';
      if (s.answerType == 'number' || s.answerType == 'yesno') {
        final p = num.tryParse(s.pointsCtrl.text.trim()) ?? 0;
        if (p <= 0) return '$label: Points is required.';
      }
      if (s.answerType == 'number' && s.isBonus) {
        final bp = num.tryParse(s.bonusPointsCtrl.text.trim()) ?? 0;
        if (bp <= 0) return '$label: Bonus Points is required when Bonus is on.';
      }
      if (s.answerType == 'choose_one') {
        if (s.options.isEmpty) return '$label: Add at least one option.';
        for (var j = 0; j < s.options.length; j++) {
          if (s.options[j].textCtrl.text.trim().isEmpty) {
            return '$label, Option #${j + 1}: Text is required.';
          }
        }
      }
    }
    return null;
  }

  Future<void> _save() async {
    // Surface WHY save is blocked instead of the button silently doing nothing
    // (the only Form validator is Category → this is the common cause).
    if (!_formKey.currentState!.validate()) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(_categoryId == null
              ? 'Please select a Category. If the list is empty, add a Category first from the Categories tab.'
              : 'Please fix the highlighted fields.'),
          backgroundColor: AppColors.error,
        ),
      );
      return;
    }
    final err = _validate();
    if (err != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(err), backgroundColor: AppColors.error),
      );
      return;
    }
    final cat = widget.categories.firstWhere(
      (c) => c.id == _categoryId,
      orElse: () => const CitationManualCategoryOption(id: 0, name: ''),
    );
    final body = <String, dynamic>{
      'yearId': widget.yearId,
      'categoryId': _categoryId,
      'criteriaName': cat.name,
      'sortOrder': int.tryParse(_sortCtrl.text.trim()) ?? 0,
      'subCriteria': _subs.map((s) => s.toJson()).toList(),
    };
    setState(() => _saving = true);
    try {
      final base =
          '/api/district-modules/${widget.districtId}/citation/manual-criteria';
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
        title: _isEdit ? 'Edit Manual Criteria' : 'Add Manual Criteria',
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
                          strokeWidth: 2.2, color: Colors.black54),
                    )
                  : Text('Save',
                      style: AppFonts.body(
                          fontWeight: FontWeight.w800, fontSize: 13)),
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
            Builder(builder: (context) {
              final selectable = widget.categories
                  // Hide categories already used by another manual criterion.
                  .where((c) =>
                      c.id == _categoryId ||
                      !widget.usedCategoryIds.contains(c.id))
                  .toList();
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  DropdownButtonFormField<int>(
                    initialValue: _categoryId,
                    decoration: InputDecoration(
                      labelText: 'Category',
                      border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(10)),
                    ),
                    items: selectable
                        .map((c) =>
                            DropdownMenuItem(value: c.id, child: Text(c.name)))
                        .toList(),
                    onChanged: _saving
                        ? null
                        : (v) => setState(() => _categoryId = v),
                    validator: (v) => v == null ? 'Category is required' : null,
                  ),
                  // Every category is already used (or none exist) → the user
                  // can't add another criterion until a new Category is created.
                  if (selectable.isEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Text(
                        widget.categories.isEmpty
                            ? 'No categories exist yet. Add one from the Categories tab first, then create a manual criterion.'
                            : 'All categories already have a manual criterion. Add a new Category to create another.',
                        style: const TextStyle(
                            fontSize: 12, color: AppColors.textSecondary),
                      ),
                    ),
                ],
              );
            }),
            const SizedBox(height: 12),
            CustomTextField(
              label: 'Sort Order',
              controller: _sortCtrl,
              keyboardType: TextInputType.number,
              prefixIcon: Icons.sort,
            ),
            const SizedBox(height: 16),
            _buildSubCriteriaSection(),
          ],
        ),
        ),
      ),
    );
  }

  Widget _buildSubCriteriaSection() {
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
              const Expanded(
                child: Text('Sub Criteria',
                    style: TextStyle(fontWeight: FontWeight.w700)),
              ),
              TextButton.icon(
                onPressed: _saving ? null : _addSub,
                icon: const Icon(Icons.add, size: 16),
                label: const Text('Add'),
              ),
            ],
          ),
          if (_subs.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 8),
              child: const Text(
                'No sub criteria yet. Tap Add to create one.',
                style: const TextStyle(color: AppColors.textSecondary),
              ),
            )
          else
            ..._subs.asMap().entries.map((e) => _buildSubCard(e.key)),
        ],
      ),
    );
  }

  Widget _buildSubCard(int i) {
    final s = _subs[i];
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
                child: Text('Sub Criteria #${i + 1}',
                    style: const TextStyle(fontWeight: FontWeight.w600)),
              ),
              IconButton(
                icon: const Icon(Icons.delete_outline,
                    size: 18, color: AppColors.error),
                onPressed: _saving ? null : () => _removeSub(i),
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
              ),
            ],
          ),
          const SizedBox(height: 8),
          CustomTextField(
            label: 'Title',
            controller: s.titleCtrl,
            prefixIcon: Icons.short_text,
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: DropdownButtonFormField<String>(
                  initialValue: s.answerType,
                  decoration: const InputDecoration(
                    labelText: 'Answer Type',
                    isDense: true,
                  ),
                  items: const [
                    DropdownMenuItem(value: 'number', child: Text('Number')),
                    DropdownMenuItem(value: 'yesno', child: Text('Yes/No')),
                    DropdownMenuItem(
                        value: 'choose_one', child: Text('Choose One')),
                  ],
                  onChanged: _saving
                      ? null
                      : (v) {
                          if (v == null) return;
                          setState(() {
                            s.answerType = v;
                            // Reset points + bonus when switching to choose_one.
                            if (v == 'choose_one') {
                              s.pointsCtrl.text = '';
                              s.isBonus = false;
                            }
                            // Reset options when leaving choose_one.
                            if (v != 'choose_one') {
                              for (final o in s.options) {
                                o.dispose();
                              }
                              s.options.clear();
                            }
                          });
                        },
                ),
              ),
              if (s.answerType != 'choose_one') ...[
                const SizedBox(width: 8),
                Expanded(
                  child: CustomTextField(
                    label: 'Points',
                    controller: s.pointsCtrl,
                    keyboardType: TextInputType.number,
                  ),
                ),
              ],
            ],
          ),
          if (s.answerType == 'number') ...[
            const SizedBox(height: 4),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              dense: true,
              title: const Text('Bonus', style: TextStyle(fontSize: 13)),
              value: s.isBonus,
              onChanged:
                  _saving ? null : (v) => setState(() => s.isBonus = v),
            ),
            if (s.isBonus) ...[
              CustomTextField(
                label: 'Bonus Points',
                controller: s.bonusPointsCtrl,
                keyboardType: TextInputType.number,
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: CustomTextField(
                      label: 'Min Bonus',
                      controller: s.minBonusCtrl,
                      keyboardType: TextInputType.number,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: CustomTextField(
                      label: 'Max Bonus',
                      controller: s.maxBonusCtrl,
                      keyboardType: TextInputType.number,
                    ),
                  ),
                ],
              ),
            ],
          ],
          if (s.answerType == 'choose_one') ...[
            const SizedBox(height: 8),
            _buildOptionsList(i, s),
          ],
          const SizedBox(height: 8),
          CustomTextField(
            label: 'Remark',
            controller: s.remarkCtrl,
            prefixIcon: Icons.notes_outlined,
          ),
        ],
      ),
    );
  }

  Widget _buildOptionsList(int subIdx, _SubCriteriaDraft s) {
    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: AppColors.background,
        border: Border.all(color: AppColors.border),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(
                child: Text('Options',
                    style: TextStyle(
                        fontSize: 12, fontWeight: FontWeight.w700)),
              ),
              TextButton.icon(
                onPressed: _saving ? null : () => _addOption(subIdx),
                icon: const Icon(Icons.add, size: 14),
                label: const Text('Add Option',
                    style: TextStyle(fontSize: 12)),
              ),
            ],
          ),
          if (s.options.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 6),
              child: const Text(
                'No options yet.',
                style: const TextStyle(
                    fontSize: 12, color: AppColors.textSecondary),
              ),
            )
          else
            ...s.options.asMap().entries.map((e) {
              final j = e.key;
              final o = e.value;
              return Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Row(
                  children: [
                    Expanded(
                      flex: 3,
                      child: TextField(
                        controller: o.textCtrl,
                        decoration: InputDecoration(
                          isDense: true,
                          hintText: 'Option text',
                          border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(6)),
                          contentPadding: const EdgeInsets.symmetric(
                              horizontal: 8, vertical: 8),
                        ),
                      ),
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      flex: 1,
                      child: TextField(
                        controller: o.pointsCtrl,
                        keyboardType: TextInputType.number,
                        decoration: InputDecoration(
                          isDense: true,
                          hintText: 'Pts',
                          border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(6)),
                          contentPadding: const EdgeInsets.symmetric(
                              horizontal: 8, vertical: 8),
                        ),
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.delete_outline,
                          size: 18, color: AppColors.error),
                      onPressed:
                          _saving ? null : () => _removeOption(subIdx, j),
                      padding: EdgeInsets.zero,
                      constraints: const BoxConstraints(),
                    ),
                  ],
                ),
              );
            }),
        ],
      ),
    );
  }
}
