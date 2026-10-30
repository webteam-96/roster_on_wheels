import 'package:flutter/material.dart' hide Text;
import 'package:flutter/services.dart';
import '../../../../core/services/district_admin_dashboard_api.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../data/models/district_admin_dashboard_models.dart';
import 'package:rotary_flutter_app/core/utils/money_format.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// "Set Foundation Goals" editor — mobile twin of the web
/// `/districts/[id]/foundation-goal/v2/edit` (Foundation Collection Goals tab).
///
/// The DA enters the four fund targets in **USD**, which is how the backend
/// stores them (no conversion, as the web editor).
/// One row per (district, year); upsert via `POST /foundation-goal`.
/// "Raised so far" is shown per fund in the instance currency for context. Returns `true` from
/// `Navigator.pop` when a goal was saved.
class FoundationGoalEditScreen extends StatefulWidget {
  final int districtId;
  final String districtNumber;
  final String yearLabel;
  final double annualRaisedInr;
  final double polioRaisedInr;
  final double endowmentRaisedInr;
  final double othersRaisedInr;

  const FoundationGoalEditScreen({
    super.key,
    required this.districtId,
    required this.districtNumber,
    required this.yearLabel,
    required this.annualRaisedInr,
    required this.polioRaisedInr,
    required this.endowmentRaisedInr,
    required this.othersRaisedInr,
  });

  @override
  State<FoundationGoalEditScreen> createState() =>
      _FoundationGoalEditScreenState();
}

class _FoundationGoalEditScreenState extends State<FoundationGoalEditScreen> {
  // The five service-project avenues configured here (key must match
  // module_master.ModuleKey; labels mirror the web foundation-goal editor).
  static const List<List<String>> _kAvenues = [
    ['community_service', 'Community Service'],
    ['vocational_service', 'Vocational Service'],
    ['international_service', 'International Service'],
    ['public_image_initiative', 'Public Image'],
    ['new_generation_service', 'New Generation Service'],
  ];

  final DistrictAdminDashboardApi _api = DistrictAdminDashboardApi();

  final _annualCtrl = TextEditingController();
  final _polioCtrl = TextEditingController();
  final _endowCtrl = TextEditingController();
  final _otherCtrl = TextEditingController();

  // Per-avenue target inputs (keyed by avenue key).
  final Map<String, TextEditingController> _targetCtrls = {
    for (final a in _kAvenues) a[0]: TextEditingController(),
  };

  List<RotaryYearLite> _years = const [];
  int? _selectedYearId;
  bool _loading = true;
  bool _loadingGoal = false;
  bool _saving = false;
  String? _bootError;

  // Project-targets-per-avenue state.
  Map<String, int> _completedByKey = const {};
  Map<String, double> _pctByKey = const {};
  Map<String, int> _moduleIdByKey = const {}; // avenue key → module id (for save)
  bool _loadingTargets = false;
  bool _savingTargets = false;

  @override
  void initState() {
    super.initState();
    for (final c in [_annualCtrl, _polioCtrl, _endowCtrl, _otherCtrl]) {
      c.addListener(_onTargetsChanged);
    }
    _init();
  }

  @override
  void dispose() {
    for (final c in [_annualCtrl, _polioCtrl, _endowCtrl, _otherCtrl]) {
      c.removeListener(_onTargetsChanged);
      c.dispose();
    }
    for (final c in _targetCtrls.values) {
      c.dispose();
    }
    super.dispose();
  }

  void _onTargetsChanged() => setState(() {}); // refresh the live total

  Future<void> _init() async {
    try {
      final years = await _api.getRotaryYears();
      if (!mounted) return;
      // Best-effort: resolve avenue key → module id for saving targets.
      try {
        final mods = await _api.getModules();
        _moduleIdByKey = {
          for (final m in mods)
            if (m.moduleKey.isNotEmpty) m.moduleKey: m.id,
        };
      } catch (_) {
        // Leave empty; a save attempt will surface an unresolved-avenue message.
      }
      if (!mounted) return;
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
      if (initial != null && mounted) await _loadTargets(initial);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _bootError = _msgFrom(e, fallback: 'Failed to load the goal page.');
        _loading = false;
      });
    }
  }

  Future<void> _loadTargets(int yearId) async {
    setState(() => _loadingTargets = true);
    try {
      final ov = await _api.getOverview(widget.districtId, yearId: yearId);
      if (!mounted) return;
      final byKey = {
        for (final a in ov.serviceProjects.avenues) a.avenueKey: a,
      };
      _completedByKey = {
        for (final e in _kAvenues) e[0]: byKey[e[0]]?.completed ?? 0,
      };
      _pctByKey = {
        for (final e in _kAvenues) e[0]: byKey[e[0]]?.percentAchieved ?? 0,
      };
      for (final e in _kAvenues) {
        final t = byKey[e[0]]?.target;
        _targetCtrls[e[0]]!.text = (t == null || t <= 0) ? '' : t.toString();
      }
      setState(() => _loadingTargets = false);
    } catch (e) {
      if (!mounted) return;
      setState(() => _loadingTargets = false);
      _snack(_msgFrom(e, fallback: 'Failed to load project targets.'),
          error: true);
    }
  }

  Future<void> _saveTargets() async {
    final yearId = _selectedYearId;
    if (yearId == null) {
      _snack('Please select a rotary year.', error: true);
      return;
    }
    final items = <Map<String, int>>[];
    final unresolved = <String>[];
    for (final e in _kAvenues) {
      final moduleId = _moduleIdByKey[e[0]] ?? 0;
      if (moduleId <= 0) {
        unresolved.add(e[1]);
        continue;
      }
      final tc = int.tryParse(_targetCtrls[e[0]]!.text.trim()) ?? 0;
      items.add({'fkModuleId': moduleId, 'targetCount': tc < 0 ? 0 : tc});
    }
    if (unresolved.isNotEmpty) {
      _snack('Could not resolve: ${unresolved.join(', ')}. Please retry.',
          error: true);
      return;
    }
    if (items.isEmpty) {
      _snack('No avenue targets to save.', error: true);
      return;
    }

    setState(() => _savingTargets = true);
    try {
      await _api.saveProjectTargets(
        districtId: widget.districtId,
        yearId: yearId,
        targets: items,
      );
      if (!mounted) return;
      setState(() => _savingTargets = false);
      _snack('Project targets saved.');
      await _loadTargets(yearId);
    } catch (e) {
      if (!mounted) return;
      setState(() => _savingTargets = false);
      final msg = _msgFrom(e, fallback: 'Failed to save targets.');
      final gated = msg.toLowerCase().contains('403') ||
          msg.toLowerCase().contains('forbidden');
      _snack(gated ? 'Permission denied: $msg' : msg, error: true);
    }
  }

  Future<void> _loadGoal(int yearId) async {
    setState(() => _loadingGoal = true);
    try {
      final g = await _api.getFoundationGoal(widget.districtId, yearId: yearId);
      if (!mounted) return;
      setState(() {
        _annualCtrl.text = g == null ? '' : _usdText(g.targetAnnualFundUsd);
        _polioCtrl.text = g == null ? '' : _usdText(g.targetPolioFundUsd);
        _endowCtrl.text =
            g == null ? '' : _usdText(g.targetEndowmentFundUsd);
        _otherCtrl.text = g == null ? '' : _usdText(g.targetOtherFundUsd);
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
    // Values entered in USD.
    final annualInr = _parseAmt(_annualCtrl.text);
    final polioInr = _parseAmt(_polioCtrl.text);
    final endowInr = _parseAmt(_endowCtrl.text);
    final otherInr = _parseAmt(_otherCtrl.text);
    if (annualInr < 0 || polioInr < 0 || endowInr < 0 || otherInr < 0) {
      _snack('Targets must be non-negative.', error: true);
      return;
    }
    if (annualInr + polioInr + endowInr + otherInr <= 0) {
      _snack('Please set at least one non-zero fund target.', error: true);
      return;
    }

    setState(() => _saving = true);
    try {
      // Backend stores USD, as entered.
      await _api.upsertFoundationGoal(DistrictFoundationGoal(
        fkDistrictId: widget.districtId,
        fkYearId: yearId,
        targetAnnualFundUsd: _roundUsd(annualInr),
        targetPolioFundUsd: _roundUsd(polioInr),
        targetEndowmentFundUsd: _roundUsd(endowInr),
        targetOtherFundUsd: _roundUsd(otherInr),
      ));
      if (!mounted) return;
      _snack('Foundation goal saved.');
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      final msg = _msgFrom(e, fallback: 'Failed to save the goal.');
      final gated = msg.toLowerCase().contains('403') ||
          msg.toLowerCase().contains('forbidden');
      _snack(gated ? 'Permission denied: $msg' : msg, error: true);
    }
  }

  double get _totalInr =>
      _parseAmt(_annualCtrl.text) +
      _parseAmt(_polioCtrl.text) +
      _parseAmt(_endowCtrl.text) +
      _parseAmt(_otherCtrl.text);

  // ── helpers ──────────────────────────────────────────────────────────────

  static double _parseAmt(String s) {
    final n = double.tryParse(s.replaceAll(RegExp(r'[,\s]'), ''));
    return (n != null && n >= 0) ? n : 0;
  }

  // USD (2 dp) for storage; whole USD for display.
  static double _roundUsd(double usd) => (usd * 100).roundToDouble() / 100;
  static String _usdText(double usd) => usd.round().toString();

  // Target total, in USD as entered.
  static String _fmtUsdTotal(num v) => formatMoney(v.round(), 'USD');

  // Raised so far, in the instance currency (as the web `fmtInr`).
  static String _fmtInr(num v) => v <= 0 ? '–' : shortMoney(v, null);

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
          'Set Foundation Goals',
          style: AppFonts.body(
              fontWeight: FontWeight.w800, fontSize: 16, color: AppColors.textPrimary),
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
            child: DropdownButtonFormField<int>(
              initialValue: _selectedYearId,
              isExpanded: true,
              decoration: _decoration(),
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
                      _loadTargets(v);
                    },
            ),
          ),
          _SectionCard(
            number: 2,
            icon: Icons.volunteer_activism_rounded,
            title: 'Collection Goals (USD)',
            trailing: _loadingGoal
                ? const SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(strokeWidth: 2))
                : null,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: AppColors.rotaryBlue.withValues(alpha: 0.06),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    'Targets are entered in USD. “Raised so far” is this '
                    'year’s TRF contributions.',
                    style: AppFonts.body(
                        fontSize: 13,
                        color: AppColors.slate500,
                        height: 1.4),
                  ),
                ),
                const SizedBox(height: 14),
                _FundField(
                  name: 'Annual Fund',
                  hint: 'Unrestricted giving',
                  dot: AppColors.rotaryBlue,
                  controller: _annualCtrl,
                  raised: _fmtInr(widget.annualRaisedInr),
                ),
                const SizedBox(height: 14),
                _FundField(
                  name: 'PolioPlus',
                  hint: 'Polio eradication',
                  dot: AppColors.avenueNewGen,
                  controller: _polioCtrl,
                  raised: _fmtInr(widget.polioRaisedInr),
                ),
                const SizedBox(height: 14),
                _FundField(
                  name: 'Endowment',
                  hint: 'Long-term programme funding',
                  dot: AppColors.goldDark,
                  controller: _endowCtrl,
                  raised: _fmtInr(widget.endowmentRaisedInr),
                ),
                const SizedBox(height: 14),
                _FundField(
                  name: 'Other Designated',
                  hint: 'Restricted / other',
                  dot: AppColors.success,
                  controller: _otherCtrl,
                  raised: _fmtInr(widget.othersRaisedInr),
                ),
                const SizedBox(height: 14),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  decoration: BoxDecoration(
                    color: AppColors.slate100,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text('Total target across all funds',
                            style: AppFonts.body(
                                fontSize: 13,
                                fontWeight: FontWeight.w600,
                                color: AppColors.slate500)),
                      ),
                      Text(_fmtUsdTotal(_totalInr),
                          style: AppFonts.body(
                              fontSize: 14,
                              fontWeight: FontWeight.w800,
                              color: AppColors.textPrimary)),
                    ],
                  ),
                ),
              ],
            ),
          ),
          _SectionCard(
            number: 3,
            icon: Icons.flag_rounded,
            title: 'Project Targets per Avenue',
            trailing: _loadingTargets
                ? const SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(strokeWidth: 2))
                : null,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: AppColors.rotaryBlue.withValues(alpha: 0.06),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    'Target number of projects per avenue for the year. '
                    '“Done” is what clubs have reported so far.',
                    style: AppFonts.body(
                        fontSize: 13,
                        color: AppColors.slate500,
                        height: 1.4),
                  ),
                ),
                const SizedBox(height: 14),
                for (var i = 0; i < _kAvenues.length; i++) ...[
                  if (i > 0) const SizedBox(height: 14),
                  _AvenueTargetRow(
                    name: _kAvenues[i][1],
                    controller: _targetCtrls[_kAvenues[i][0]]!,
                    completed: _completedByKey[_kAvenues[i][0]] ?? 0,
                    percent: _pctByKey[_kAvenues[i][0]] ?? 0,
                  ),
                ],
                const SizedBox(height: 16),
                SizedBox(
                  height: 42,
                  child: OutlinedButton.icon(
                    onPressed: _savingTargets ? null : _saveTargets,
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.warningDark,
                      side: const BorderSide(color: AppColors.warningDark),
                      shape: const StadiumBorder(),
                    ),
                    icon: _savingTargets
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                                strokeWidth: 2.2, color: AppColors.warningDark))
                        : const Icon(Icons.save_outlined, size: 18),
                    label: Text('Save Targets',
                        style: AppFonts.body(
                            fontSize: 13.5, fontWeight: FontWeight.w800)),
                  ),
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
            shape:
                const StadiumBorder(),
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

  InputDecoration _decoration() => InputDecoration(
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

class _FundField extends StatelessWidget {
  final String name;
  final String hint;
  final Color dot;
  final TextEditingController controller;
  final String raised;
  const _FundField({
    required this.name,
    required this.hint,
    required this.dot,
    required this.controller,
    required this.raised,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(color: dot, shape: BoxShape.circle),
            ),
            const SizedBox(width: 6),
            Text(name,
                style: AppFonts.body(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary)),
            const SizedBox(width: 6),
            Expanded(
              child: Text('· $hint',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppFonts.body(
                      fontSize: 13, color: AppColors.slate400)),
            ),
          ],
        ),
        const SizedBox(height: 6),
        TextField(
          controller: controller,
          keyboardType:
              const TextInputType.numberWithOptions(decimal: true),
          inputFormatters: [
            FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')),
          ],
          style: AppFonts.body(
              fontSize: 14, color: AppColors.textPrimary),
          decoration: InputDecoration(
            prefixText: '\$ ',
            prefixStyle: AppFonts.body(
                fontSize: 14,
                fontWeight: FontWeight.w700,
                color: AppColors.slate500),
            hintText: '0',
            hintStyle: AppFonts.body(
                fontSize: 14, color: AppColors.slate400),
            isDense: true,
            contentPadding:
                const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
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
        const SizedBox(height: 4),
        Text('Raised so far: $raised',
            style: AppFonts.body(
                fontSize: 13, color: AppColors.slate500)),
      ],
    );
  }
}

class _AvenueTargetRow extends StatelessWidget {
  final String name;
  final TextEditingController controller;
  final int completed;
  final double percent;
  const _AvenueTargetRow({
    required this.name,
    required this.controller,
    required this.completed,
    required this.percent,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(name,
                  style: AppFonts.body(
                      fontSize: 13,
                      fontWeight: FontWeight.w800,
                      color: AppColors.textPrimary)),
              const SizedBox(height: 2),
              Text(
                'Done: $completed · ${percent.toStringAsFixed(0)}%',
                style: AppFonts.body(
                    fontSize: 13, color: AppColors.slate500),
              ),
            ],
          ),
        ),
        const SizedBox(width: 10),
        SizedBox(
          width: 92,
          child: TextField(
            controller: controller,
            keyboardType: TextInputType.number,
            textAlign: TextAlign.center,
            inputFormatters: [
              FilteringTextInputFormatter.allow(RegExp(r'[0-9]')),
            ],
            style: AppFonts.body(
                fontSize: 14, color: AppColors.textPrimary),
            decoration: InputDecoration(
              hintText: '0',
              hintStyle: AppFonts.body(
                  fontSize: 14, color: AppColors.slate400),
              isDense: true,
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 10, vertical: 11),
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
        ),
      ],
    );
  }
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
                      color: AppColors.rotaryBlue, shape: BoxShape.circle),
                  child: Text('$number',
                      style: AppFonts.body(
                          fontSize: 13,
                          fontWeight: FontWeight.w800,
                          color: Colors.white)),
                ),
                const SizedBox(width: 8),
                Icon(icon, size: 15, color: AppColors.slate500),
                const SizedBox(width: 6),
                Flexible(
                  child: Text(title,
                      overflow: TextOverflow.ellipsis,
                      style: AppFonts.body(
                          fontSize: 13,
                          fontWeight: FontWeight.w800,
                          color: AppColors.textPrimary)),
                ),
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
