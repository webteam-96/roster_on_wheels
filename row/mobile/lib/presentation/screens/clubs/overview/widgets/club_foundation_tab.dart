import 'package:flutter/material.dart' hide Text;
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../../../../../core/constants/feature_flags.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_exceptions.dart';
import '../../../../../core/services/club_admin_dashboard_api.dart';
import '../../../../../core/services/club_foundation_goals_api.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/utils/date_formatter.dart';
import '../../../../../core/utils/money_format.dart';
import '../../../../../core/utils/snackbar_utils.dart';
import '../../../../../data/models/club_admin_dashboard_models.dart';
import '../../../../providers/auth_provider.dart';
import '../../../../widgets/common/confirmation_dialog.dart';
import '../../../../widgets/common/dashboard_refresh.dart';
import '../../modules/trf/trf_screen.dart';
import 'club_dashboard_async.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// "Foundation" tab on the Club Overview screen — wired to the live
/// `api/mobile/club-admin-dashboard/foundation` (this club's fund actuals) and
/// `api/mobile/club-foundation-goals` (persisted collection goals).
///
/// The React reference's national-rank / district-comparison cards are dropped:
/// the club-admin API exposes no rank/average/benchmark data. What remains is
/// fully real — a persistable goal-setter and a funds-raised breakdown.
///
/// Set to false to hide the entire "Foundation Collection Goals" card (the
/// goal-progress rows plus the Set/Edit/Save/Delete-Goals UI). The TRF hero,
/// KPIs and funds-raised breakdown stay visible; only the goals card is gated.
/// Enabled to match the web club-admin Foundation page, which shows the live
/// "Set Foundation Collection Goals" editor. Flip back to false to hide it.
const bool kFoundationGoalsEnabled = true;

class ClubFoundationTab extends StatefulWidget {
  final int clubId;
  final int? yearId;
  const ClubFoundationTab({super.key, required this.clubId, this.yearId});

  @override
  State<ClubFoundationTab> createState() => _ClubFoundationTabState();
}

class _FoundationData {
  final ClubAdminFoundation funds;
  final FoundationGoalList goals;
  const _FoundationData(this.funds, this.goals);
}

class _ClubFoundationTabState extends State<ClubFoundationTab>
    with AutomaticKeepAliveClientMixin<ClubFoundationTab> {
  final ClubAdminDashboardApi _dashApi = ClubAdminDashboardApi();
  final ClubFoundationGoalsApi _goalsApi = ClubFoundationGoalsApi();
  late Future<_FoundationData> _future;
  int? _yearId; // null = current rotary year

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _yearId = widget.yearId; // seed from the global selector
    _future = _load();
  }

  Future<_FoundationData> _load() async {
    final results = await Future.wait([
      _dashApi.getFoundation(widget.clubId, yearId: _yearId),
      _goalsApi.list(widget.clubId, yearId: _yearId),
    ]);
    return _FoundationData(
      results[0] as ClubAdminFoundation,
      results[1] as FoundationGoalList,
    );
  }

  void _reload() => setState(() => _future = _load());

  /// Pull-to-refresh: fetch first, then swap so content doesn't flash a loader.
  Future<void> _refresh() async {
    final f = _load();
    await f.then((_) {}, onError: (_) {});
    if (!mounted) return;
    setState(() => _future = f);
  }

  void _selectYear(int yearId) =>
      setState(() {
        _yearId = yearId;
        _future = _load();
      });

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return FutureBuilder<_FoundationData>(
      future: _future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const ClubDashboardLoading();
        }
        if (snap.hasError) {
          return ClubDashboardError(error: snap.error!, onRetry: _reload);
        }
        final data = snap.data!;
        final clubName = data.funds.clubName.isNotEmpty
            ? data.funds.clubName
            : data.goals.clubName;
        return DashboardRefresh(
          onRefresh: _refresh,
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 32),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _Header(clubName: clubName, yearLabel: data.funds.yearLabel),
              const SizedBox(height: 12),
              _FoundationKpiGrid(funds: data.funds),
              // Also gated by the release-wide Goal Setting switch.
              if (kFoundationGoalsEnabled && kGoalSettingEnabled) ...[
                const SizedBox(height: 14),
                _GoalsCard(
                  clubId: widget.clubId,
                  goalsApi: _goalsApi,
                  goal: data.goals.currentSelection,
                  years: data.goals.years,
                  funds: data.funds,
                  onReload: _reload,
                  onSelectYear: _selectYear,
                ),
              ],
              const SizedBox(height: 14),
              _ContributionRecords(
                key: ValueKey('trf-records-${widget.clubId}-$_yearId'),
                clubId: widget.clubId,
                yearId: _yearId,
              ),
            ],
          ),
        );
      },
    );
  }
}

// ── formatters ───────────────────────────────────────────────────────────────

// TRF / Foundation is served in USD (backend USD_INR = 1). Short USD, mirrors
// web `fmtUsdShort`.
String _fmtUsd(num v) {
  if (v >= 1000000) return '\$${(v / 1000000).toStringAsFixed(1)}M';
  if (v >= 1000) return '\$${(v / 1000).toStringAsFixed(1)}K';
  return '\$${v.round()}';
}

// ── 1. Header ────────────────────────────────────────────────────────────────

class _Header extends StatelessWidget {
  final String clubName;
  final String yearLabel;
  const _Header({required this.clubName, required this.yearLabel});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'The Rotary Foundation',
                style: AppFonts.body(
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                  color: AppColors.slate700,
                ),
              ),
              Text(
                [
                  if (clubName.isNotEmpty) clubName,
                  if (yearLabel.isNotEmpty) 'RY $yearLabel',
                ].join(' · '),
                style: AppFonts.body(
                  fontSize: 13,
                  color: AppColors.slate400,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

// ── 2. Goal-setter card (persisted via /club-foundation-goals) ───────────────

class _GoalsCard extends StatefulWidget {
  final int clubId;
  final ClubFoundationGoalsApi goalsApi;
  final FoundationGoal? goal;
  final List<FoundationGoalYear> years;
  final ClubAdminFoundation funds;
  final VoidCallback onReload;
  final void Function(int yearId) onSelectYear;

  const _GoalsCard({
    required this.clubId,
    required this.goalsApi,
    required this.goal,
    required this.years,
    required this.funds,
    required this.onReload,
    required this.onSelectYear,
  });

  @override
  State<_GoalsCard> createState() => _GoalsCardState();
}

class _GoalsCardState extends State<_GoalsCard> {
  final _apf = TextEditingController();
  final _polio = TextEditingController();
  final _endow = TextEditingController();
  final _other = TextEditingController();
  bool _editing = false;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _sync();
  }

  @override
  void didUpdateWidget(_GoalsCard old) {
    super.didUpdateWidget(old);
    if (old.goal?.yearId != widget.goal?.yearId ||
        old.goal?.goalId != widget.goal?.goalId) {
      _sync();
    }
  }

  void _sync() {
    final g = widget.goal;
    _set(_apf, g?.apfGoal);
    _set(_polio, g?.polioPlusGoal);
    _set(_endow, g?.endowmentFundGoal);
    _set(_other, g?.otherGoal);
    // Start in edit mode only when the year is editable and has no goal yet.
    _editing = g != null && g.isEditable && g.goalId == null;
  }

  void _set(TextEditingController c, double? v) =>
      c.text = (v == null || v <= 0) ? '' : v.round().toString();

  @override
  void dispose() {
    _apf.dispose();
    _polio.dispose();
    _endow.dispose();
    _other.dispose();
    super.dispose();
  }

  int _val(TextEditingController c) => int.tryParse(c.text.trim()) ?? 0;

  Future<void> _save() async {
    final g = widget.goal;
    if (g == null) return;
    setState(() => _saving = true);
    try {
      await widget.goalsApi.save(
        widget.clubId,
        yearId: g.yearId,
        apfGoal: _val(_apf),
        polioPlusGoal: _val(_polio),
        endowmentFundGoal: _val(_endow),
        otherGoal: _val(_other),
        currency: g.currency, // keep the goal's currency, as the web form does
      );
      if (!mounted) return;
      widget.onReload();
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(e.message)));
    } catch (_) {
      if (!mounted) return;
      setState(() => _saving = false);
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not save goals. Try again.')));
    }
  }

  Future<void> _delete() async {
    final g = widget.goal;
    if (g == null) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text('Delete goals?',
            style: AppFonts.body(fontWeight: FontWeight.w800)),
        content: Text('Remove the Foundation goals for RY ${g.yearLabel}?',
            style: AppFonts.body(fontSize: 13)),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel')),
          TextButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Delete',
                  style: TextStyle(color: AppColors.error))),
        ],
      ),
    );
    if (ok != true) return;
    setState(() => _saving = true);
    try {
      await widget.goalsApi.delete(widget.clubId, g.yearId);
      if (!mounted) return;
      widget.onReload();
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final g = widget.goal;
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: _editing
              ? AppColors.avenuePublicImage.withValues(alpha: 0.4)
              : AppColors.slate200,
        ),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(height: 3, color: AppColors.avenuePublicImage),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
            child: g == null
                ? _noYear()
                : Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _headerRow(g),
                      const SizedBox(height: 12),
                      if (_editing) _form(g) else _display(g),
                    ],
                  ),
          ),
        ],
      ),
    );
  }

  Widget _noYear() => Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Text('No rotary year available for goals.',
            style: AppFonts.body(
                fontSize: 13, color: AppColors.slate400)),
      );

  Widget _headerRow(FoundationGoal g) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Foundation Collection Goals',
                style: AppFonts.body(
                  fontSize: 13.5,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                ),
              ),
              const SizedBox(height: 2),
              Row(
                children: [
                  Text(
                    'RY ${g.yearLabel}',
                    style: AppFonts.body(
                      fontSize: 13,
                      color: AppColors.slate500,
                    ),
                  ),
                  if (!g.isEditable) ...[
                    const SizedBox(width: 6),
                    _pill('Past year · read-only', AppColors.slate400),
                  ],
                ],
              ),
            ],
          ),
        ),
        if (widget.years.length > 1) _yearDropdown(g),
      ],
    );
  }

  Widget _yearDropdown(FoundationGoal g) {
    return PopupMenuButton<int>(
      onSelected: widget.onSelectYear,
      itemBuilder: (_) => [
        for (final y in widget.years)
          PopupMenuItem(
            value: y.yearId,
            child: Text(
              y.yearLabel + (y.hasGoal ? '  •' : ''),
              style: AppFonts.body(
                fontSize: 13,
                fontWeight:
                    y.yearId == g.yearId ? FontWeight.w800 : FontWeight.w500,
              ),
            ),
          ),
      ],
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: AppColors.slate200),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              g.yearLabel,
              style: AppFonts.body(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: AppColors.slate700,
              ),
            ),
            const Icon(Icons.arrow_drop_down_rounded,
                size: 18, color: AppColors.slate500),
          ],
        ),
      ),
    );
  }

  // ── edit form ──────────────────────────────────────────────────────────
  Widget _form(FoundationGoal g) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _input('Annual Fund (APF)', _apf, AppColors.rotaryBlue),
        const SizedBox(height: 8),
        _input('PolioPlus', _polio, AppColors.avenueNewGen),
        const SizedBox(height: 8),
        _input('Endowment Fund', _endow, AppColors.avenuePublicImage),
        const SizedBox(height: 8),
        _input('Other', _other, AppColors.avenueVocational),
        const SizedBox(height: 14),
        Row(
          children: [
            if (g.goalId != null) ...[
              Expanded(
                child: OutlinedButton(
                  onPressed: _saving
                      ? null
                      : () => setState(() {
                            _sync();
                            _editing = false;
                          }),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.slate500,
                    side: const BorderSide(color: AppColors.slate200),
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    shape: const StadiumBorder(),
                  ),
                  child: Text('Cancel',
                      style: AppFonts.body(
                          fontSize: 13, fontWeight: FontWeight.w700)),
                ),
              ),
              const SizedBox(width: 10),
            ],
            Expanded(
              flex: 2,
              child: ElevatedButton(
                onPressed: _saving ? null : _save,
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.avenuePublicImage,
                  foregroundColor: Colors.white,
                  elevation: 0,
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  shape: const StadiumBorder(),
                ),
                child: _saving
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white))
                    : Text(g.goalId == null ? 'Set Goals' : 'Save Goals',
                        style: AppFonts.body(
                            fontSize: 13, fontWeight: FontWeight.w800)),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _input(String label, TextEditingController c, Color color) {
    return Row(
      children: [
        SizedBox(
          width: 130,
          child: Text(
            label,
            style: AppFonts.body(
              fontSize: 13,
              fontWeight: FontWeight.w800,
              color: color,
            ),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: TextField(
            controller: c,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            style: AppFonts.body(
                fontSize: 13, color: AppColors.textPrimary),
            decoration: InputDecoration(
              prefixText: '\$ ',
              hintText: '0',
              hintStyle: AppFonts.body(
                  fontSize: 13, color: AppColors.slate400),
              isDense: true,
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: const BorderSide(color: AppColors.slate200),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: const BorderSide(color: AppColors.slate200),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: BorderSide(color: color),
              ),
            ),
          ),
        ),
      ],
    );
  }

  // ── display mode (progress against actuals) ──────────────────────────────
  Widget _display(FoundationGoal g) {
    final rows = <({String label, double goal, double actual, Color color})>[
      (label: 'Annual Fund', goal: g.apfGoal, actual: widget.funds.annualFundInr, color: AppColors.rotaryBlue),
      (label: 'PolioPlus', goal: g.polioPlusGoal, actual: widget.funds.polioFundInr, color: AppColors.avenueNewGen),
      (label: 'Endowment', goal: g.endowmentFundGoal, actual: widget.funds.endowmentInr, color: AppColors.avenuePublicImage),
      (label: 'Other', goal: g.otherGoal, actual: widget.funds.othersInr, color: AppColors.avenueVocational),
    ];
    final hasAnyGoal = g.totalGoal > 0;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (!hasAnyGoal)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Text(
              g.isEditable
                  ? 'No goals set for this year yet.'
                  : 'No goals were set for this year.',
              style: AppFonts.body(
                  fontSize: 13, color: AppColors.slate500),
            ),
          ),
        for (var i = 0; i < rows.length; i++) ...[
          _progressRow(rows[i].label, rows[i].goal, rows[i].actual, rows[i].color),
          if (i != rows.length - 1) const SizedBox(height: 8),
        ],
        const SizedBox(height: 10),
        Container(height: 1, color: AppColors.slate100),
        const SizedBox(height: 8),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text('Total goal',
                style: AppFonts.body(
                    fontSize: 13, color: AppColors.slate500)),
            Text(hasAnyGoal ? _fmtUsd(g.totalGoal) : '–',
                style: AppFonts.body(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: AppColors.slate700)),
          ],
        ),
        if (g.updatedBy != null || g.updatedDate != null) ...[
          const SizedBox(height: 6),
          Text(
            'Last updated${g.updatedDate != null ? ' ${g.updatedDate}' : ''}'
            '${g.updatedBy != null ? ' by ${g.updatedBy}' : ''}',
            style: AppFonts.body(
                fontSize: 13, color: AppColors.slate400),
          ),
        ],
        if (kFoundationGoalsEnabled && g.isEditable) ...[
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: ElevatedButton.icon(
                  onPressed: _saving
                      ? null
                      : () => setState(() => _editing = true),
                  icon: const Icon(Icons.edit_rounded, size: 15),
                  label: Text(hasAnyGoal ? 'Edit Goals' : 'Set Goals',
                      style: AppFonts.body(
                          fontSize: 13, fontWeight: FontWeight.w700)),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.avenuePublicImage,
                    foregroundColor: Colors.white,
                    elevation: 0,
                    padding: const EdgeInsets.symmetric(vertical: 11),
                    shape: const StadiumBorder(),
                  ),
                ),
              ),
              if (g.goalId != null) ...[
                const SizedBox(width: 10),
                OutlinedButton(
                  onPressed: _saving ? null : _delete,
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.error,
                    side: BorderSide(
                        color: AppColors.error.withValues(alpha: 0.4)),
                    padding: const EdgeInsets.symmetric(
                        horizontal: 14, vertical: 11),
                    shape: const StadiumBorder(),
                  ),
                  child: const Icon(Icons.delete_outline_rounded, size: 18),
                ),
              ],
            ],
          ),
        ],
      ],
    );
  }

  Widget _progressRow(String label, double goal, double actual, Color color) {
    final pct =
        goal > 0 ? ((actual / goal) * 100).round().clamp(0, 100) : 0;
    return Container(
      padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.03),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withValues(alpha: 0.18)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(label,
                    style: AppFonts.body(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: AppColors.slate700)),
              ),
              Text('$pct%',
                  style: AppFonts.body(
                      fontSize: 13,
                      fontWeight: FontWeight.w800,
                      color: color,
                      fontFeatures: const [FontFeature.tabularFigures()])),
            ],
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              Text(_fmtUsd(actual),
                  style: AppFonts.body(
                      fontSize: 13,
                      fontWeight: FontWeight.w800,
                      color: color,
                      fontFeatures: const [FontFeature.tabularFigures()])),
              const SizedBox(width: 4),
              Text('/ ${goal > 0 ? _fmtUsd(goal) : '–'}',
                  style: AppFonts.body(
                      fontSize: 13, color: AppColors.slate400)),
            ],
          ),
          const SizedBox(height: 4),
          ClipRRect(
            borderRadius: BorderRadius.circular(999),
            child: LinearProgressIndicator(
              value: pct / 100,
              minHeight: 6,
              backgroundColor: AppColors.slate100,
              valueColor: AlwaysStoppedAnimation<Color>(color),
            ),
          ),
        ],
      ),
    );
  }

  Widget _pill(String text, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(999),
        ),
        child: Text(text,
            style: AppFonts.body(
                fontSize: 13, fontWeight: FontWeight.w800, color: color)),
      );
}

// ── Foundation KPI grid (web-parity per-fund cards) ──────────────────────────

/// One KPI card's content.
class _KpiSpec {
  final String label;
  final double value;
  final String sub;
  final IconData icon;
  final Color color;
  const _KpiSpec(this.label, this.value, this.sub, this.icon, this.color);
}

/// Six per-fund KPI cards mirroring the web TRF summary strip — Total
/// Contributions, Annual, Polio, Endowment, Global Grant, Others — laid out
/// two-per-row so they stay readable on a phone. Global Grant / Others are
/// split from the raw `metrics` (see [ClubAdminFoundation.globalGrantInr]).
class _FoundationKpiGrid extends StatelessWidget {
  final ClubAdminFoundation funds;
  const _FoundationKpiGrid({required this.funds});

  @override
  Widget build(BuildContext context) {
    final cards = <_KpiSpec>[
      _KpiSpec('Total Contributions', funds.totalCollectedInr, 'USD · all funds',
          Icons.payments_rounded, AppColors.rotaryGold),
      _KpiSpec('Annual', funds.annualFundInr, 'Annual Fund',
          Icons.trending_up_rounded, AppColors.rotaryBlue),
      _KpiSpec('Polio', funds.polioFundInr, 'PolioPlus',
          Icons.favorite_rounded, AppColors.avenueNewGen),
      _KpiSpec('Endowment', funds.endowmentInr, 'Endowment Fund',
          Icons.workspace_premium_rounded, AppColors.avenuePublicImage),
      _KpiSpec('Global Grant', funds.globalGrantInr, 'Global Grants',
          Icons.public_rounded, AppColors.avenueInternational),
      _KpiSpec('Others', funds.otherFundsInr, 'Other funds',
          Icons.account_balance_wallet_rounded, AppColors.avenueClubService),
    ];
    final rows = <Widget>[];
    for (var i = 0; i < cards.length; i += 2) {
      rows.add(IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(child: _KpiCard(spec: cards[i])),
            const SizedBox(width: 10),
            Expanded(child: _KpiCard(spec: cards[i + 1])),
          ],
        ),
      ));
      if (i + 2 < cards.length) rows.add(const SizedBox(height: 10));
    }
    return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch, children: rows);
  }
}

class _KpiCard extends StatelessWidget {
  final _KpiSpec spec;
  const _KpiCard({required this.spec});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.slate200),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 26,
                height: 26,
                decoration: BoxDecoration(
                  color: spec.color.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(spec.icon, size: 15, color: spec.color),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  spec.label,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: AppFonts.body(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.3,
                    height: 1.15,
                    color: AppColors.slate500,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            formatMoney(spec.value, 'USD'),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppFonts.body(
              fontSize: 18,
              fontWeight: FontWeight.w800,
              color: AppColors.textPrimary,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
          const SizedBox(height: 1),
          Text(
            spec.sub,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppFonts.body(
              fontSize: 13,
              color: AppColors.slate400,
            ),
          ),
        ],
      ),
    );
  }
}

// ── Contribution Records (per-donor list + add/edit/delete) ──────────────────

/// Donor-wise TRF contribution records with inline add / edit / delete, wired to
/// `GET|POST|PUT|DELETE /api/clubs/{clubId}/trf`. Mirrors the web "Contribution
/// Records" table but rendered as a mobile card list. Reuses the shared
/// [TrfContributionFormScreen] for create/update. Renders inline (no internal
/// scroll) so it flows inside the Foundation tab's scroll view.
class _ContributionRecords extends StatefulWidget {
  final int clubId;
  final int? yearId;
  const _ContributionRecords({super.key, required this.clubId, this.yearId});

  @override
  State<_ContributionRecords> createState() => _ContributionRecordsState();
}

class _ContributionRecordsState extends State<_ContributionRecords> {
  final ApiClient _api = ApiClient();
  List<Map<String, dynamic>> _all = [];
  List<Map<String, dynamic>> _filtered = [];
  List<dynamic> _funds = [];
  bool _loading = true;
  String _query = '';

  /// Concrete year the list/form use. When the tab has no explicit year we
  /// resolve the current rotary year (as [TrfScreen] does) so the records match
  /// the KPI cards, whose endpoint also defaults to the current year.
  int _effectiveYearId = 0;

  bool get _canManage => Provider.of<AuthProvider>(context, listen: false)
      .isClubAdminOf(widget.clubId);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (mounted) setState(() => _loading = true);
    await _resolveYear();
    await Future.wait<void>([_loadFunds(), _loadList()]);
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _resolveYear() async {
    final y = widget.yearId ?? 0;
    if (y > 0) {
      _effectiveYearId = y;
      return;
    }
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/rotary-years',
        fromJson: (j) => j as List<dynamic>,
      );
      final list = (resp.data ?? [])
          .whereType<Map>()
          .map((e) => e.cast<String, dynamic>())
          .toList();
      Map<String, dynamic>? current;
      for (final m in list) {
        final v = m['isCurrent'];
        if (v == true || v == 1 || v?.toString().toLowerCase() == 'true') {
          current = m;
          break;
        }
      }
      current ??= list.isNotEmpty ? list.first : null;
      _effectiveYearId = (current?['id'] as num?)?.toInt() ?? 0;
    } catch (_) {
      _effectiveYearId = 0;
    }
  }

  Future<void> _loadFunds() async {
    try {
      final resp = await _api.get<List<dynamic>>(
        '/api/clubs/${widget.clubId}/trf/funds',
        fromJson: (j) => j as List<dynamic>,
      );
      _funds = resp.data ?? [];
    } catch (_) {
      // non-fatal; the form just shows no fund options
    }
  }

  Future<void> _loadList() async {
    try {
      final resp = await _api.get(
        '/api/clubs/${widget.clubId}/trf',
        queryParams: {'yearId': _effectiveYearId},
        fromJson: (json) => json,
      );
      final data = resp.data;
      final list = data is List
          ? data
          : (data is Map<String, dynamic>
              ? (data['items'] as List<dynamic>? ?? const [])
              : const []);
      _all = list
          .whereType<Map>()
          .map((e) => e.cast<String, dynamic>())
          .toList();
    } catch (_) {
      _all = [];
    }
    _applySearch();
  }

  void _applySearch() {
    final q = _query.toLowerCase().trim();
    if (q.isEmpty) {
      _filtered = List.of(_all);
      return;
    }
    _filtered = _all.where((c) {
      final donor =
          (c['donorName'] ?? c['memberName'] ?? '').toString().toLowerCase();
      final fund = (c['fundType'] ?? '').toString().toLowerCase();
      final amt =
          (c['amountUSD'] ?? c['amount'] ?? '').toString().toLowerCase();
      final date = (c['trfDate'] ?? c['contributionDate'] ?? '').toString();
      final fmt = date.isNotEmpty
          ? DateFormatter.toDisplay(DateTime.tryParse(date)).toLowerCase()
          : '';
      return donor.contains(q) ||
          fund.contains(q) ||
          amt.contains(q) ||
          fmt.contains(q);
    }).toList();
  }

  double get _total {
    var t = 0.0;
    for (final c in _filtered) {
      final a = c['amountUSD'] ?? c['amount'];
      if (a is num) {
        t += a.toDouble();
      } else if (a is String) {
        t += double.tryParse(a) ?? 0;
      }
    }
    return t;
  }

  void _openForm({Map<String, dynamic>? contribution}) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => TrfContributionFormScreen(
          clubId: widget.clubId,
          yearId: _effectiveYearId,
          contribution: contribution,
          funds: _funds,
          onSaved: _load,
        ),
      ),
    );
  }

  Future<void> _delete(int id) async {
    final ok = await ConfirmationDialog.show(
      context,
      title: 'Delete Contribution',
      message: 'Are you sure you want to delete this TRF contribution?',
    );
    if (ok != true) return;
    try {
      await _api.delete('/api/clubs/${widget.clubId}/trf/$id');
      if (mounted) SnackbarUtils.showSuccess(context, 'Contribution deleted');
      _load();
    } catch (_) {
      if (mounted) SnackbarUtils.showError(context, 'Failed to delete');
    }
  }

  @override
  Widget build(BuildContext context) {
    final canManage = _canManage;
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.slate200),
      ),
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Contribution Records',
                        style: AppFonts.body(
                            fontSize: 14,
                            fontWeight: FontWeight.w800,
                            color: AppColors.textPrimary)),
                    Text('Donor-wise contributions to The Rotary Foundation',
                        style: AppFonts.body(
                            fontSize: 13, color: AppColors.slate500)),
                  ],
                ),
              ),
              if (canManage) ...[
                const SizedBox(width: 8),
                _AddContributionButton(onTap: () => _openForm()),
              ],
            ],
          ),
          const SizedBox(height: 12),
          TextField(
            onChanged: (v) => setState(() {
              _query = v;
              _applySearch();
            }),
            style: AppFonts.body(fontSize: 13),
            decoration: InputDecoration(
              hintText: 'Search donor…',
              hintStyle: AppFonts.body(
                  fontSize: 13, color: AppColors.slate400),
              prefixIcon: const Icon(Icons.search_rounded,
                  size: 18, color: AppColors.slate400),
              isDense: true,
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
              border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(9),
                  borderSide: const BorderSide(color: AppColors.slate200)),
              enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(9),
                  borderSide: const BorderSide(color: AppColors.slate200)),
              focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(9),
                  borderSide: const BorderSide(color: AppColors.rotaryBlue)),
            ),
          ),
          const SizedBox(height: 10),
          if (_loading)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: Center(
                child: SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(strokeWidth: 2)),
              ),
            )
          else if (_filtered.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 20),
              child: Center(
                child: Text(_all.isEmpty ? 'No contributions yet.' : 'No matches.',
                    style: AppFonts.body(
                        fontSize: 13, color: AppColors.slate400)),
              ),
            )
          else ...[
            for (var i = 0; i < _filtered.length; i++) ...[
              _recordRow(_filtered[i], i, canManage),
              if (i != _filtered.length - 1)
                const Divider(height: 1, color: AppColors.slate100),
            ],
            const SizedBox(height: 10),
            Container(height: 1, color: AppColors.slate100),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('${_filtered.length} record${_filtered.length == 1 ? '' : 's'}',
                    style: AppFonts.body(
                        fontSize: 13, color: AppColors.slate500)),
                Text('Total: ${formatMoney(_total, 'USD')}',
                    style: AppFonts.body(
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary,
                        fontFeatures: const [FontFeature.tabularFigures()])),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _recordRow(Map<String, dynamic> c, int i, bool canManage) {
    final amount = c['amountUSD'] ?? c['amount'];
    final amountNum = amount is num ? amount : num.tryParse('$amount') ?? 0;
    final donor = (c['donorName'] ?? c['memberName'] ?? 'Unknown').toString();
    final fundType = (c['fundType'] ?? c['category'] ?? '').toString();
    final otherFundName = (c['otherFundName'] ?? '').toString();
    final displayFund = fundType.toLowerCase() == 'others'
        ? (otherFundName.isNotEmpty ? otherFundName : 'Others')
        : fundType;
    final dateStr = (c['trfDate'] ?? c['contributionDate'])?.toString();
    final date = (dateStr != null && dateStr.isNotEmpty)
        ? DateFormatter.toDisplay(DateTime.tryParse(dateStr))
        : '';

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 26,
            height: 26,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppColors.rotaryGold.withValues(alpha: 0.14),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text('${i + 1}',
                style: AppFonts.body(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: AppColors.rotaryGold)),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(donor,
                    style: AppFonts.body(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary)),
                const SizedBox(height: 3),
                Row(
                  children: [
                    if (displayFund.isNotEmpty)
                      Flexible(
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 7, vertical: 2),
                          decoration: BoxDecoration(
                            color: AppColors.rotaryBlue.withValues(alpha: 0.08),
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: Text(displayFund,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: AppFonts.body(
                                  fontSize: 13,
                                  fontWeight: FontWeight.w700,
                                  color: AppColors.rotaryBlue)),
                        ),
                      ),
                    if (date.isNotEmpty) ...[
                      const SizedBox(width: 8),
                      Text(date,
                          style: AppFonts.body(
                              fontSize: 13, color: AppColors.slate400)),
                    ],
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Text(formatMoney(amountNum, 'USD'),
              style: AppFonts.body(
                  fontSize: 13.5,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                  fontFeatures: const [FontFeature.tabularFigures()])),
          if (canManage)
            SizedBox(
              height: 28,
              width: 28,
              child: PopupMenuButton<String>(
                padding: EdgeInsets.zero,
                icon: const Icon(Icons.more_vert_rounded,
                    size: 18, color: AppColors.slate400),
                onSelected: (v) {
                  if (v == 'edit') _openForm(contribution: c);
                  if (v == 'delete') _delete((c['id'] as num).toInt());
                },
                itemBuilder: (_) => const [
                  PopupMenuItem(value: 'edit', child: Text('Edit')),
                  PopupMenuItem(value: 'delete', child: Text('Delete')),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _AddContributionButton extends StatelessWidget {
  final VoidCallback onTap;
  const _AddContributionButton({required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.rotaryBlue,
      borderRadius: BorderRadius.circular(9),
      child: InkWell(
        borderRadius: BorderRadius.circular(9),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.add_rounded, size: 16, color: Colors.white),
              const SizedBox(width: 4),
              Text('Add',
                  style: AppFonts.body(
                      fontSize: 13,
                      fontWeight: FontWeight.w800,
                      color: Colors.white)),
            ],
          ),
        ),
      ),
    );
  }
}
