import 'package:flutter/material.dart' hide Text;
import 'package:flutter/services.dart';
import '../../../../core/services/district_admin_dashboard_api.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../data/models/district_admin_dashboard_models.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// "Set Membership Goal" editor — mobile twin of the web
/// `/districts/[id]/membership-goal/v2/edit` page.
///
/// One row per (district, rotary year). Loads the saved goal for the selected
/// year (blank if none), then upserts via
/// `POST /api/mobile/district-admin-dashboard/membership-goal`. Returns `true`
/// from `Navigator.pop` when a goal was saved, so the caller can refresh.
class MembershipGoalEditScreen extends StatefulWidget {
  final int districtId;
  final String districtNumber;
  final String yearLabel; // current dashboard RY — used to pre-select the year
  final int currentTotal; // live district-wide member count (read-only display)

  const MembershipGoalEditScreen({
    super.key,
    required this.districtId,
    required this.districtNumber,
    required this.yearLabel,
    required this.currentTotal,
  });

  @override
  State<MembershipGoalEditScreen> createState() =>
      _MembershipGoalEditScreenState();
}

class _MembershipGoalEditScreenState extends State<MembershipGoalEditScreen> {
  final DistrictAdminDashboardApi _api = DistrictAdminDashboardApi();

  final _totalCtrl = TextEditingController();
  final _newCtrl = TextEditingController();
  final _retentionCtrl = TextEditingController();

  List<RotaryYearLite> _years = const [];
  int? _selectedYearId;
  bool _loading = true;
  bool _loadingGoal = false;
  bool _saving = false;
  String? _bootError;

  @override
  void initState() {
    super.initState();
    _init();
  }

  @override
  void dispose() {
    _totalCtrl.dispose();
    _newCtrl.dispose();
    _retentionCtrl.dispose();
    super.dispose();
  }

  Future<void> _init() async {
    try {
      final years = await _api.getRotaryYears();
      if (!mounted) return;
      // Resolve initial year: match the dashboard's yearLabel → isCurrent → first.
      int? initial;
      for (final y in years) {
        if (y.yearLabel == widget.yearLabel) {
          initial = y.id;
          break;
        }
      }
      if (initial == null) {
        for (final y in years) {
          if (y.isCurrent) {
            initial = y.id;
            break;
          }
        }
      }
      initial ??= years.isNotEmpty ? years.first.id : null;
      setState(() {
        _years = years;
        _selectedYearId = initial;
        _loading = false;
      });
      if (initial != null) await _loadGoal(initial);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _bootError = _msgFrom(e, fallback: 'Failed to load the goal page.');
        _loading = false;
      });
    }
  }

  Future<void> _loadGoal(int yearId) async {
    setState(() => _loadingGoal = true);
    try {
      final goal = await _api.getMembershipGoal(widget.districtId, yearId: yearId);
      if (!mounted) return;
      setState(() {
        _totalCtrl.text = goal == null ? '' : goal.targetTotal.toString();
        _newCtrl.text = goal == null ? '' : goal.targetNewMembers.toString();
        _retentionCtrl.text = goal == null
            ? ''
            : _trimDecimal(goal.targetRetentionPercent);
        _loadingGoal = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _loadingGoal = false);
      _snack(_msgFrom(e, fallback: 'Failed to load the existing goal.'),
          error: true);
    }
  }

  Future<void> _save() async {
    final yearId = _selectedYearId;
    if (yearId == null) {
      _snack('Please select a rotary year.', error: true);
      return;
    }
    final total = int.tryParse(_totalCtrl.text.trim());
    final newM = int.tryParse(_newCtrl.text.trim());
    final retention = double.tryParse(_retentionCtrl.text.trim());

    if (total == null || total < 0) {
      _snack('Target Total Members must be a non-negative whole number.',
          error: true);
      return;
    }
    if (newM == null || newM < 0) {
      _snack('Target New Members must be a non-negative whole number.',
          error: true);
      return;
    }
    if (retention == null || retention < 0 || retention > 100) {
      _snack('Target Retention % must be between 0 and 100.', error: true);
      return;
    }

    setState(() => _saving = true);
    try {
      await _api.upsertMembershipGoal(DistrictMembershipGoal(
        fkDistrictId: widget.districtId,
        fkYearId: yearId,
        targetTotal: total,
        targetNewMembers: newM,
        targetRetentionPercent: retention,
      ));
      if (!mounted) return;
      _snack('Membership goal saved.');
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      final msg = _msgFrom(e, fallback: 'Failed to save the goal.');
      final lower = msg.toLowerCase();
      final gated = lower.contains('403') || lower.contains('forbidden');
      _snack(gated ? 'Permission denied: $msg' : msg, error: true);
    }
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  static String _trimDecimal(double v) {
    if (v == v.roundToDouble()) return v.toInt().toString();
    return v.toString();
  }

  String _msgFrom(Object e, {required String fallback}) {
    final s = e.toString().replaceFirst('Exception: ', '').trim();
    return s.isEmpty ? fallback : s;
  }

  void _snack(String text, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(text),
      behavior: SnackBarBehavior.floating,
      backgroundColor: error ? AppColors.error : null,
    ));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.lightBg,
      appBar: AppBar(
        backgroundColor: AppColors.lightBg,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded,
              color: AppColors.textPrimary, size: 20),
          onPressed: () => Navigator.of(context).pop(),
        ),
        title: Text(
          'Set Membership Goal',
          style: AppFonts.body(
            fontWeight: FontWeight.w800,
            fontSize: 16,
            color: AppColors.textPrimary,
          ),
        ),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(strokeWidth: 2.4))
          : _bootError != null
              ? _errorView(_bootError!)
              : _form(),
      bottomNavigationBar: (_loading || _bootError != null) ? null : _saveBar(),
    );
  }

  Widget _errorView(String msg) => Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.cloud_off_rounded,
                  size: 34, color: AppColors.slate400),
              const SizedBox(height: 12),
              Text(msg,
                  textAlign: TextAlign.center,
                  style: AppFonts.body(
                      fontSize: 13, color: AppColors.slate500)),
            ],
          ),
        ),
      );

  Widget _form() {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 28),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            '${widget.districtNumber.isEmpty ? '–' : widget.districtNumber}'
            ' · RY ${widget.yearLabel.isEmpty ? '–' : widget.yearLabel}',
            style: AppFonts.body(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: AppColors.slate500),
          ),
          const SizedBox(height: 14),
          _SectionCard(
            number: 1,
            icon: Icons.calendar_today_rounded,
            title: 'Rotary Year',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                DropdownButtonFormField<int>(
                  initialValue: _selectedYearId,
                  isExpanded: true,
                  decoration: _fieldDecoration(),
                  style: AppFonts.body(
                      fontSize: 14, color: AppColors.textPrimary),
                  items: [
                    for (final y in _years)
                      DropdownMenuItem<int>(
                        value: y.id,
                        child: Text(
                          '${y.yearLabel}${y.isCurrent ? '  (Current)' : ''}',
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                  ],
                  onChanged: _saving
                      ? null
                      : (v) {
                          if (v == null || v == _selectedYearId) return;
                          setState(() => _selectedYearId = v);
                          _loadGoal(v);
                        },
                ),
                const SizedBox(height: 6),
                Text(
                  'Goals are stored one row per (district, year). Switching the '
                  'year loads that RY’s saved values, if any.',
                  style: AppFonts.body(
                      fontSize: 13, color: AppColors.slate400, height: 1.4),
                ),
              ],
            ),
          ),
          _SectionCard(
            number: 2,
            icon: Icons.groups_rounded,
            title: 'Current Standing',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _ReadOnlyField(
                    label: 'Current Total Members',
                    value: widget.currentTotal.toString()),
                const SizedBox(height: 6),
                Text(
                  'Live district-wide member count from the dashboard.',
                  style: AppFonts.body(
                      fontSize: 13, color: AppColors.slate400),
                ),
              ],
            ),
          ),
          _SectionCard(
            number: 3,
            icon: Icons.flag_rounded,
            title: 'Membership Targets',
            trailing: _loadingGoal
                ? const SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(strokeWidth: 2))
                : null,
            child: Column(
              children: [
                _NumberField(
                  label: 'Target Total Members',
                  controller: _totalCtrl,
                  hint: 'e.g. 1200',
                  decimal: false,
                ),
                const SizedBox(height: 14),
                _NumberField(
                  label: 'Target New Members',
                  controller: _newCtrl,
                  hint: 'e.g. 150',
                  decimal: false,
                ),
                const SizedBox(height: 14),
                _NumberField(
                  label: 'Target Retention %  (0–100)',
                  controller: _retentionCtrl,
                  hint: 'e.g. 92.5',
                  decimal: true,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _saveBar() {
    return SafeArea(
      minimum: const EdgeInsets.fromLTRB(14, 8, 14, 12),
      child: SizedBox(
        height: 46,
        child: ElevatedButton(
          onPressed: _saving ? null : _save,
          style: ElevatedButton.styleFrom(
            backgroundColor: AppColors.warningDark,
            foregroundColor: Colors.white,
            elevation: 0,
            shape: const StadiumBorder(),
          ),
          child: _saving
              ? const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(
                      strokeWidth: 2.2, color: Colors.white))
              : Text('Save Goal',
                  style: AppFonts.body(
                      fontSize: 14, fontWeight: FontWeight.w800)),
        ),
      ),
    );
  }

  InputDecoration _fieldDecoration({String? hint}) => InputDecoration(
        hintText: hint,
        hintStyle: AppFonts.body(
            fontSize: 13.5, color: AppColors.slate400),
        isDense: true,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        filled: true,
        fillColor: Colors.white,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(9),
          borderSide: const BorderSide(color: AppColors.slate200),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(9),
          borderSide: const BorderSide(color: AppColors.slate200),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(9),
          borderSide: const BorderSide(color: AppColors.rotaryBlue),
        ),
      );
}

class _SectionCard extends StatelessWidget {
  final int number;
  final IconData icon;
  final String title;
  final Widget child;
  final Widget? trailing;
  const _SectionCard({
    required this.number,
    required this.icon,
    required this.title,
    required this.child,
    this.trailing,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.slate200),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            color: AppColors.slate100.withValues(alpha: 0.5),
            child: Row(
              children: [
                Container(
                  width: 22,
                  height: 22,
                  alignment: Alignment.center,
                  decoration: const BoxDecoration(
                    color: AppColors.rotaryBlue,
                    shape: BoxShape.circle,
                  ),
                  child: Text('$number',
                      style: AppFonts.body(
                          fontSize: 13,
                          fontWeight: FontWeight.w800,
                          color: Colors.white)),
                ),
                const SizedBox(width: 8),
                Icon(icon, size: 15, color: AppColors.slate500),
                const SizedBox(width: 6),
                Text(title,
                    style: AppFonts.body(
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary)),
                const Spacer(),
                if (trailing != null) trailing!,
              ],
            ),
          ),
          Padding(padding: const EdgeInsets.all(12), child: child),
        ],
      ),
    );
  }
}

class _ReadOnlyField extends StatelessWidget {
  final String label;
  final String value;
  const _ReadOnlyField({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _FieldLabel(label),
        const SizedBox(height: 5),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
          decoration: BoxDecoration(
            color: AppColors.slate100,
            borderRadius: BorderRadius.circular(9),
            border: Border.all(color: AppColors.slate200),
          ),
          child: Text(value,
              style: AppFonts.body(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary)),
        ),
      ],
    );
  }
}

class _NumberField extends StatelessWidget {
  final String label;
  final TextEditingController controller;
  final String hint;
  final bool decimal;
  const _NumberField({
    required this.label,
    required this.controller,
    required this.hint,
    required this.decimal,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _FieldLabel(label),
        const SizedBox(height: 5),
        TextField(
          controller: controller,
          keyboardType: TextInputType.numberWithOptions(decimal: decimal),
          inputFormatters: [
            decimal
                ? FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))
                : FilteringTextInputFormatter.digitsOnly,
          ],
          style: AppFonts.body(
              fontSize: 14, color: AppColors.textPrimary),
          decoration: InputDecoration(
            hintText: hint,
            hintStyle: AppFonts.body(
                fontSize: 13.5, color: AppColors.slate400),
            isDense: true,
            contentPadding:
                const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
            filled: true,
            fillColor: Colors.white,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(9),
              borderSide: const BorderSide(color: AppColors.slate200),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(9),
              borderSide: const BorderSide(color: AppColors.slate200),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(9),
              borderSide: const BorderSide(color: AppColors.rotaryBlue),
            ),
          ),
        ),
      ],
    );
  }
}

class _FieldLabel extends StatelessWidget {
  final String text;
  const _FieldLabel(this.text);

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: AppFonts.body(
        fontSize: 13,
        fontWeight: FontWeight.w700,
        color: AppColors.slate700,
      ),
    );
  }
}
