import 'package:flutter/material.dart' hide Text;

import '../../../core/network/api_exceptions.dart';
import '../../../core/services/district_admin_dashboard_api.dart';
import '../../../core/services/goal_setting_api.dart';
import '../../../core/theme/app_colors.dart';
import '../../../data/models/district_admin_dashboard_models.dart' show RotaryYearLite;
import '../../../data/models/goal_setting_models.dart';
import '../../widgets/common/custom_app_bar.dart';
import '../../widgets/common/rotary_year_bar.dart';
import 'widgets/goal_form_fields.dart';
import '../../../core/utils/snackbar_utils.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// Which entity's goals this form edits.
enum GoalEntityType { club, district }

/// Goal Setting ENTRY form — the mobile twin of the web `GoalSettingPanel`, used
/// by Club and District Admins to set their own yearly targets by category.
///
/// Fully metadata-driven: the server returns each category's fields with a
/// DataType (Integer/Decimal/Percentage/Currency/Boolean/Text) and a FieldRole
/// (Reference / Target / Computed), and this screen decides how each renders and
/// whether it's editable — NEVER hardcodes field keys (the DISHA field rebuild
/// flows through untouched). Targets are always editable; a Reference is editable
/// only when the system does NOT auto-fill it; Computed values are always
/// read-only. Past years come back with `isEditable=false` and render
/// read-only.
class GoalSettingEntryScreen extends StatefulWidget {
  final GoalEntityType entityType;

  /// Club id (for [GoalEntityType.club]) or district id (for
  /// [GoalEntityType.district]).
  final int entityId;

  const GoalSettingEntryScreen({
    super.key,
    required this.entityType,
    required this.entityId,
  });

  bool get _isClub => entityType == GoalEntityType.club;

  @override
  State<GoalSettingEntryScreen> createState() => _GoalSettingEntryScreenState();
}

class _GoalSettingEntryScreenState extends State<GoalSettingEntryScreen> {
  final GoalSettingApi _api = GoalSettingApi();
  final DistrictAdminDashboardApi _dashApi = DistrictAdminDashboardApi();

  bool _loading = true;
  String? _bootError;

  List<GoalCategory> _categories = const [];
  List<RotaryYearLite> _years = const [];
  int? _yearId;
  int? _activeCategoryId;

  GoalCategoryForm? _form;
  bool _loadingForm = false;
  String? _formError;

  final Map<int, GoalFieldBuffer> _buffers = {};

  /// Bumped on every (re)load so the field rows get fresh keys and their
  /// TextFormFields re-seed from the newly-loaded values (an `initialValue`
  /// alone is ignored on rebuild once a field's State exists).
  int _reload = 0;

  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _boot();
  }

  Future<void> _boot() async {
    setState(() {
      _loading = true;
      _bootError = null;
    });
    try {
      final results = await Future.wait([
        _api.getCategories(),
        _dashApi.getRotaryYears(),
      ]);
      if (!mounted) return;
      _categories = results[0] as List<GoalCategory>;
      _years = results[1] as List<RotaryYearLite>;
      _yearId = _currentYearId(_years);
      _activeCategoryId = _categories.isNotEmpty ? _categories.first.id : null;
      setState(() => _loading = false);
      if (_activeCategoryId != null) _loadForm();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _bootError = friendlyErrorMessage(e, fallback: 'Failed to load Goal Setting.');
      });
    }
  }

  int? _currentYearId(List<RotaryYearLite> years) {
    if (years.isEmpty) return null;
    for (final y in years) {
      if (y.isCurrent) return y.id;
    }
    return years.first.id;
  }

  Future<void> _loadForm() async {
    final cat = _activeCategoryId;
    if (cat == null) return;
    setState(() {
      _loadingForm = true;
      _formError = null;
    });
    try {
      final GoalCategoryForm? form = widget._isClub
          ? await _api.getClubGoalForm(cat, yearId: _yearId, clubId: widget.entityId)
          : await _api.getDistrictGoalForm(cat, yearId: _yearId, districtId: widget.entityId);
      if (!mounted) return;
      if (form == null) {
        setState(() {
          _form = null;
          _loadingForm = false;
          _formError = widget._isClub
              ? 'No club admin assignment found for these goals.'
              : 'No district admin assignment found for these goals.';
        });
        return;
      }
      _fillBuffers(form);
      setState(() {
        _form = form;
        _loadingForm = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loadingForm = false;
        _formError = friendlyErrorMessage(e, fallback: 'Failed to load goals.');
      });
    }
  }

  void _fillBuffers(GoalCategoryForm form) {
    _buffers
      ..clear()
      ..addAll(goalBuffersFromForm(form));
    _reload++;
  }

  void _onYearChanged(int? id) {
    if (id == null || id == _yearId) return;
    setState(() => _yearId = id);
    _loadForm();
  }

  void _onCategory(int id) {
    if (id == _activeCategoryId) return;
    setState(() => _activeCategoryId = id);
    _loadForm();
  }

  bool get _isEditable => (_form?.isEditable ?? false) && !_saving;

  Future<void> _save() async {
    final form = _form;
    final cat = _activeCategoryId;
    if (form == null || cat == null) return;
    setState(() => _saving = true);
    try {
      final entries = <GoalEntrySave>[];
      for (final f in form.fields) {
        if (f.isComputed) continue;
        final buf = _buffers[f.fieldId] ?? GoalFieldBuffer();
        if (f.isBoolean) {
          entries.add(GoalEntrySave(fieldId: f.fieldId, boolValue: buf.bool_));
        } else if (f.isText) {
          final t = buf.text.trim();
          entries.add(GoalEntrySave(fieldId: f.fieldId, textValue: t.isEmpty ? null : buf.text));
        } else {
          final t = buf.text.trim();
          entries.add(GoalEntrySave(
              fieldId: f.fieldId, numericValue: t.isEmpty ? null : num.tryParse(t)));
        }
      }
      final req = SaveGoalEntriesRequest(yearId: form.yearId, entries: entries);
      final fresh = widget._isClub
          ? await _api.saveClubGoalForm(cat, req, clubId: widget.entityId)
          : await _api.saveDistrictGoalForm(cat, req, districtId: widget.entityId);
      if (!mounted) return;
      _fillBuffers(fresh);
      setState(() {
        _form = fresh;
        _saving = false;
      });
      SnackbarUtils.showSuccess(context, 'Goals saved successfully.');
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      SnackbarUtils.showError(context, friendlyErrorMessage(e, fallback: 'Failed to save goals.'));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: CustomAppBar(title: widget._isClub ? 'Goal Setting' : 'District Goals'),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _bootError != null
              ? _errorState(_bootError!)
              : _content(),
    );
  }

  Widget _errorState(String message) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline_rounded, size: 40, color: AppColors.error),
            const SizedBox(height: 12),
            Text(
              message,
              textAlign: TextAlign.center,
              style: AppFonts.body(fontSize: 13, color: AppColors.slate500),
            ),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              onPressed: _boot,
              icon: const Icon(Icons.refresh_rounded, size: 16),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _content() {
    if (_categories.isEmpty) {
      return _errorState('No goal categories are available.');
    }
    final form = _form;
    return Column(
      children: [
        RotaryYearBar<int>(
          value: _yearId,
          onChanged: _saving ? null : _onYearChanged,
          options: [
            for (final y in _years)
              RotaryYearOption<int>(value: y.id, label: y.yearLabel, isCurrent: y.isCurrent),
          ],
        ),
        _headerCard(),
        _categoryPills(),
        Expanded(
          child: _loadingForm
              ? const Center(child: CircularProgressIndicator())
              : _formError != null
                  ? _errorState(_formError!)
                  : form == null
                      ? const SizedBox.shrink()
                      : _formBody(form),
        ),
        if (form != null && _isEditable) _saveBar(form),
      ],
    );
  }

  Widget _headerCard() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppColors.infoLight,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.slate200),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              widget._isClub ? 'Goal Setting' : 'District Goals',
              style: AppFonts.body(
                fontSize: 14,
                fontWeight: FontWeight.w800,
                color: AppColors.textPrimary,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              widget._isClub
                  ? "Set your club's targets for the year, by category"
                  : 'District-level targets for the year, by category',
              style: AppFonts.body(fontSize: 12, color: AppColors.slate500),
            ),
          ],
        ),
      ),
    );
  }

  Widget _categoryPills() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 8),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            for (final c in _categories) ...[
              GoalCategoryPill(
                label: c.name,
                active: c.id == _activeCategoryId,
                onTap: _saving ? null : () => _onCategory(c.id),
              ),
              const SizedBox(width: 8),
            ],
          ],
        ),
      ),
    );
  }

  Widget _formBody(GoalCategoryForm form) {
    final groups = groupGoalFields(form);
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
      children: [
        if (!form.isEditable) _statusChip(),
        for (final g in groups)
          GoalGroupCard(
            groupName: g.key,
            fields: g.value,
            buffers: _buffers,
            reloadTick: _reload,
            enabled: _isEditable,
            onText: (f, v) => _buffers[f.fieldId]!.text = v,
            onBool: (f, v) => setState(() => _buffers[f.fieldId]!.bool_ = v),
          ),
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text(
            '${form.fields.length} fields',
            style: AppFonts.body(fontSize: 11, color: AppColors.slate400),
          ),
        ),
      ],
    );
  }

  Widget _statusChip() {
    const text = 'Past year · read only';
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.slate100,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.slate200),
      ),
      child: Row(
        children: [
          const Icon(Icons.lock_outline_rounded, size: 14, color: AppColors.slate500),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              text,
              style: AppFonts.body(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: AppColors.slate700,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _saveBar(GoalCategoryForm form) {
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
        decoration: const BoxDecoration(
          color: AppColors.surface,
          border: Border(top: BorderSide(color: AppColors.slate200)),
        ),
        child: SizedBox(
          width: double.infinity,
          child: FilledButton.icon(
            onPressed: _saving ? null : _save,
            icon: _saving
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : const Icon(Icons.save_rounded, size: 17),
            label: Text(_saving ? 'Saving…' : 'Save Goals'),
            style: FilledButton.styleFrom(
              backgroundColor: AppColors.rotaryBlue,
              padding: const EdgeInsets.symmetric(vertical: 13),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              textStyle: AppFonts.body(fontSize: 14, fontWeight: FontWeight.w700),
            ),
          ),
        ),
      ),
    );
  }
}
