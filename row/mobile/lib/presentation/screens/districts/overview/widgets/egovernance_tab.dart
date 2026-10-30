import 'dart:async';

import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import '../../../../../core/services/district_admin_dashboard_api.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../data/models/district_admin_dashboard_models.dart';
import '../../modules/district_citation_screen.dart';
import '../../modules/district_reports_screen.dart';
import 'district_dashboard_async.dart';
import 'stat_card.dart';
import '../../../../widgets/common/dashboard_refresh.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// "E-Governance & Reporting" tab of the District Admin dashboard, wired to
/// `GET /api/mobile/district-admin-dashboard/egovernance` (+ `/egovernance/per-club`
/// for the real 12-month CMR grid).
///
/// Mirrors the web console: header + 2 KPI tiles + 3 sub-tabs (Club Monthly
/// Report / District Awards / Reports). Per the backend, the main
/// response's Wave-13A2 fields are dead-code, so KPIs use the live legacy CMR
/// totals; the per-club grid is fetched from the dedicated endpoint; District
/// Awards / Reports are Pending / empty (awaiting Wave 13A1).
class EGovernanceTab extends StatefulWidget {
  final int districtId;
  final int? yearId;

  /// Concrete Rotary-year id resolved by the dashboard (`selected ?? current`).
  /// [yearId] can be null for the current year (server default) — but the CMR
  /// month-detail route needs a real id, so this carries it for navigation.
  final int? effectiveYearId;
  const EGovernanceTab({
    super.key,
    required this.districtId,
    this.yearId,
    this.effectiveYearId,
  });

  @override
  State<EGovernanceTab> createState() => _EGovernanceTabState();
}

class _EGovernanceTabState extends State<EGovernanceTab>
    with AutomaticKeepAliveClientMixin<EGovernanceTab> {
  final DistrictAdminDashboardApi _api = DistrictAdminDashboardApi();
  late Future<DistrictAdminEGovernance> _future;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _future = _api.getEGovernance(widget.districtId, yearId: widget.yearId);
  }

  void _reload() => setState(
      () => _future = _api.getEGovernance(widget.districtId, yearId: widget.yearId));

  /// Pull-to-refresh: fetch first, then swap so content doesn't flash a loader.
  Future<void> _refresh() async {
    final f = _api.getEGovernance(widget.districtId, yearId: widget.yearId);
    await f.then((_) {}, onError: (_) {});
    if (!mounted) return;
    setState(() => _future = f);
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return FutureBuilder<DistrictAdminEGovernance>(
      future: _future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const DaLoading();
        }
        if (snap.hasError || !snap.hasData) {
          return DaError(error: snap.error ?? 'No data', onRetry: _reload);
        }
        return DashboardRefresh.around(
          onRefresh: _refresh,
          child: _EGovBody(
              data: snap.data!,
              districtId: widget.districtId,
              yearId: widget.yearId,
              effectiveYearId: widget.effectiveYearId),
        );
      },
    );
  }
}

// ── status palette + month labels (CMR per-club grid) ────────────────────────

const Color _kNotStarted = AppColors.lightBorder; // slate-300

Color _cmrColor(String status) {
  switch (status) {
    case 'submitted':
      return AppColors.success;
    case 'late':
      return AppColors.error;
    case 'pending':
      return AppColors.warning;
    default:
      return _kNotStarted; // not_started
  }
}

String _cmrLabel(String status) {
  switch (status) {
    case 'submitted':
      return 'Submitted';
    case 'late':
      return 'Late';
    case 'pending':
      return 'Pending';
    default:
      return 'Not Started';
  }
}

const List<String> _kRyMonths = [
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', //
];

// ─────────────────────────────────────────────────────────────────────────
// Body
// ─────────────────────────────────────────────────────────────────────────

const List<({String key, String label})> _kSubTabs = [
  (key: 'cmr', label: 'Club Monthly Report'),
  (key: 'citation', label: 'District Awards'),
  (key: 'reports', label: 'Reports'),
];

class _EGovBody extends StatefulWidget {
  final DistrictAdminEGovernance data;
  final int districtId;
  final int? yearId;
  final int? effectiveYearId;
  const _EGovBody({
    required this.data,
    required this.districtId,
    this.yearId,
    this.effectiveYearId,
  });

  @override
  State<_EGovBody> createState() => _EGovBodyState();
}

class _EGovBodyState extends State<_EGovBody> {
  String _active = 'cmr';

  void _select(String k) => setState(() => _active = k);

  @override
  Widget build(BuildContext context) {
    final d = widget.data;

    // NestedScrollView so the KPI strip + sub-tab bar scroll AWAY as the active
    // tab's content scrolls up (they'd otherwise stay pinned and eat the
    // screen). The header title block ("E-Governance & Reporting · <district> ·
    // RY …") is intentionally dropped — the dashboard already has an app bar +
    // year bar. The body hosts either the inline CMR cards (own scroll view) or
    // a full embedded module Scaffold (its own scroll / search / actions).
    return NestedScrollView(
      headerSliverBuilder: (context, _) => [
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
            child: _TopKpis(data: d),
          ),
        ),
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
            child: _SubTabBar(active: _active, onSelect: _select),
          ),
        ),
        const SliverToBoxAdapter(child: SizedBox(height: 10)),
      ],
      body: _activeContent(),
    );
  }

  Widget _activeContent() {
    switch (_active) {
      case 'cmr':
        return SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(12, 2, 12, 32),
          child: _CmrSubTab(
              data: widget.data,
              districtId: widget.districtId,
              yearId: widget.yearId,
              effectiveYearId: widget.effectiveYearId),
        );
      case 'citation':
        return DistrictCitationScreen(
          key: const ValueKey('egov-citation'),
          districtId: widget.districtId,
          embedded: true,
        );
      case 'reports':
        return DistrictReportsScreen(
          key: const ValueKey('egov-reports'),
          districtId: widget.districtId,
          embedded: true,
        );
      default:
        return const SizedBox.shrink();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Top KPI tiles
// ─────────────────────────────────────────────────────────────────────────

class _TopKpis extends StatelessWidget {
  final DistrictAdminEGovernance data;
  const _TopKpis({required this.data});

  @override
  Widget build(BuildContext context) {
    final citationPending = data.citationPending;
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(
            child: StatCard(
              label: 'Monthly Reports',
              value: data.monthlyReports.toString(),
              sub: 'Submitted on time',
              accent: AppColors.rotaryBlue,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: StatCard(
              label: 'Avg Awards Score',
              value: citationPending
                  ? '–'
                  : '${data.avgCitationScore.round()}/1000',
              sub: citationPending ? 'Pending' : 'All clubs',
              accent: AppColors.rotaryGold,
            ),
          ),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-tab bar
// ─────────────────────────────────────────────────────────────────────────

class _SubTabBar extends StatelessWidget {
  final String active;
  final ValueChanged<String> onSelect;
  const _SubTabBar({required this.active, required this.onSelect});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(6),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.slate200),
      ),
      child: Wrap(
        spacing: 4,
        runSpacing: 4,
        children: [
          for (final t in _kSubTabs)
            _SubTabPill(
              label: t.label,
              isActive: t.key == active,
              onTap: () => onSelect(t.key),
            ),
        ],
      ),
    );
  }
}

class _SubTabPill extends StatelessWidget {
  final String label;
  final bool isActive;
  final VoidCallback onTap;
  const _SubTabPill({
    required this.label,
    required this.isActive,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: isActive ? AppColors.rotaryGold : Colors.transparent,
      borderRadius: BorderRadius.circular(8),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 7),
          child: Text(
            label,
            style: AppFonts.body(
              fontSize: 13,
              fontWeight: isActive ? FontWeight.w800 : FontWeight.w600,
              color: isActive ? AppColors.primaryDeep : AppColors.slate500,
            ),
          ),
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Club Monthly Report sub-tab
// ─────────────────────────────────────────────────────────────────────────

class _CmrSubTab extends StatefulWidget {
  final DistrictAdminEGovernance data;
  final int districtId;
  final int? yearId;
  final int? effectiveYearId;
  const _CmrSubTab({
    required this.data,
    required this.districtId,
    this.yearId,
    this.effectiveYearId,
  });

  @override
  State<_CmrSubTab> createState() => _CmrSubTabState();
}

class _CmrSubTabState extends State<_CmrSubTab> {
  final DistrictAdminDashboardApi _api = DistrictAdminDashboardApi();
  late Future<DistrictAdminCmrPerClubGrid> _future;

  @override
  void initState() {
    super.initState();
    _future =
        _api.getEGovernancePerClub(widget.districtId, yearId: widget.yearId);
  }

  void _retry() => setState(() => _future =
      _api.getEGovernancePerClub(widget.districtId, yearId: widget.yearId));

  @override
  Widget build(BuildContext context) {
    // KPI sub-tiles come from the legacy totals (real). The 12-month "District
    // Summary — By Month" and the per-club grid share ONE fetch of
    // /egovernance/per-club — the monthly summary is DERIVED by aggregating the
    // per-club month statuses (mirrors the web section, which the mobile lights
    // up with real data even though the main response's month-breakdown field
    // is dead-code).
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _CmrMiniKpis(data: widget.data),
        const SizedBox(height: 14),
        FutureBuilder<DistrictAdminCmrPerClubGrid>(
          future: _future,
          builder: (context, snap) {
            if (snap.connectionState != ConnectionState.done) {
              return const _CmrLoadingCard();
            }
            if (snap.hasError || !snap.hasData) {
              return _CmrErrorCard(onRetry: _retry);
            }
            final rows = snap.data!.rows;
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _MonthSummaryCard(
                  rows: rows,
                  districtId: widget.districtId,
                  yearId: widget.yearId,
                  effectiveYearId: widget.effectiveYearId,
                ),
                // Per-Club Breakdown card removed per request.
              ],
            );
          },
        ),
      ],
    );
  }
}

// ── shared card chrome for the CMR grid loading / error states ───────────────

class _CmrLoadingCard extends StatelessWidget {
  const _CmrLoadingCard();

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.slate200),
      ),
      padding: const EdgeInsets.symmetric(vertical: 44),
      child: const Center(
        child: SizedBox(
          width: 22,
          height: 22,
          child: CircularProgressIndicator(strokeWidth: 2.2),
        ),
      ),
    );
  }
}

class _CmrErrorCard extends StatelessWidget {
  final VoidCallback onRetry;
  const _CmrErrorCard({required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.slate200),
      ),
      padding: const EdgeInsets.symmetric(vertical: 30, horizontal: 20),
      child: Column(
        children: [
          Text(
            'Couldn’t load the monthly report data.',
            textAlign: TextAlign.center,
            style: AppFonts.body(
                fontSize: 13, color: AppColors.slate400),
          ),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh_rounded, size: 15),
            label: Text('Retry',
                style: AppFonts.body(
                    fontSize: 13, fontWeight: FontWeight.w700)),
          ),
        ],
      ),
    );
  }
}

class _CmrMiniKpis extends StatelessWidget {
  final DistrictAdminEGovernance data;
  const _CmrMiniKpis({required this.data});

  @override
  Widget build(BuildContext context) {
    return GridView.count(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      crossAxisCount: 2,
      crossAxisSpacing: 10,
      mainAxisSpacing: 10,
      childAspectRatio: 1.55,
      children: [
        StatCard(
          label: 'Total Clubs',
          value: data.cmrClubs.toString(),
          sub: 'In district',
          accent: AppColors.rotaryBlue,
        ),
        StatCard(
          label: 'Submitted',
          value: data.totalCmrSubmitted.toString(),
          sub: 'On-time reports',
          accent: AppColors.success,
          subTone: StatSubTone.up,
        ),
        StatCard(
          label: 'On Time %',
          value: '${data.onTimePercent}%',
          sub: 'Across all clubs',
          accent: AppColors.rotaryGold,
        ),
        StatCard(
          label: 'Pending',
          value: data.totalCmrPending.toString(),
          sub: 'Yet to submit',
          accent: AppColors.error,
          subTone: StatSubTone.down,
        ),
      ],
    );
  }
}

// ── District Summary — By Month (derived from the per-club grid) ─────────────

const List<String> _kRyMonthsFull = [
  'July', 'August', 'September', 'October', 'November', 'December',
  'January', 'February', 'March', 'April', 'May', 'June', //
];

class _MonthSummaryCard extends StatelessWidget {
  final List<DaCmrPerClubRow> rows;
  final int districtId;
  final int? yearId; // null → current RY (cap the list to elapsed months)
  final int? effectiveYearId; // concrete id for month-detail navigation
  const _MonthSummaryCard({
    required this.rows,
    required this.districtId,
    this.yearId,
    this.effectiveYearId,
  });

  /// How many months to show. A specific year → the full 12; the current RY
  /// (yearId null, the default) → only the months that have already come
  /// around (July … current rotary month) — future months are just noise.
  int get _visibleMonths {
    if (yearId != null) return 12;
    final now = DateTime.now();
    return (((now.month + 5) % 12) + 1).clamp(1, 12); // Jul→1 … Jun→12
  }

  @override
  Widget build(BuildContext context) {
    final total = rows.length;

    // Aggregate every rotary month (1=Jul … 12=Jun) across all clubs.
    final onTime = List<int>.filled(12, 0);
    final late = List<int>.filled(12, 0);
    final pending = List<int>.filled(12, 0);
    final notStarted = List<int>.filled(12, 0);
    for (final row in rows) {
      final byMonth = {for (final m in row.months) m.month: m.status};
      for (int mo = 1; mo <= 12; mo++) {
        switch (byMonth[mo] ?? 'not_started') {
          case 'submitted':
            onTime[mo - 1]++;
            break;
          case 'late':
            late[mo - 1]++;
            break;
          case 'pending':
            pending[mo - 1]++;
            break;
          default:
            notStarted[mo - 1]++;
        }
      }
    }

    final visible = _visibleMonths;

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.slate200),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'District Summary: By Month',
                  style: AppFonts.body(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'Tap a month to see each club’s report status',
                  style: AppFonts.body(
                    fontSize: 13,
                    color: AppColors.slate500,
                  ),
                ),
              ],
            ),
          ),
          const Divider(height: 1, color: AppColors.slate100),
          if (total == 0)
            Padding(
              padding:
                  const EdgeInsets.symmetric(vertical: 26, horizontal: 16),
              child: Text(
                'No clubs available for this district.',
                textAlign: TextAlign.center,
                style: AppFonts.body(
                    fontSize: 13, color: AppColors.slate400),
              ),
            )
          else
            for (int mo = 1; mo <= visible; mo++) ...[
              if (mo > 1) const Divider(height: 1, color: AppColors.slate100),
              _MonthRow(
                districtId: districtId,
                navYearId: effectiveYearId,
                month: mo,
                monthName: _kRyMonthsFull[mo - 1],
                onTime: onTime[mo - 1],
                late: late[mo - 1],
                pending: pending[mo - 1],
                notStarted: notStarted[mo - 1],
                total: total,
              ),
            ],
        ],
      ),
    );
  }
}

class _MonthRow extends StatelessWidget {
  final int districtId;
  final int? navYearId; // concrete year id for the detail route (null → no nav)
  final int month; // rotary month 1..12
  final String monthName;
  final int onTime;
  final int late;
  final int pending;
  final int notStarted;
  final int total;
  const _MonthRow({
    required this.districtId,
    required this.navYearId,
    required this.month,
    required this.monthName,
    required this.onTime,
    required this.late,
    required this.pending,
    required this.notStarted,
    required this.total,
  });

  void _openDetail(BuildContext context) {
    // Mirrors the web: /districts/{id}/club-monthly-report/{yearId}/{month}
    // → the per-month detail (each club's status for that month).
    //
    // NB: the per-club grid numbers months as a rotary index (1=Jul … 12=Jun),
    // but the detail route/backend filter on ReportMonth = the CALENDAR month
    // (7=Jul … 6=Jun). Convert before routing, else we'd open the wrong month.
    final calendarMonth = ((month + 5) % 12) + 1; // 1→7 (Jul) … 12→6 (Jun)
    final name = Uri.encodeQueryComponent(monthName);
    context.push(
        '/districts/$districtId/club-monthly-report/$navYearId/$calendarMonth?name=$name');
  }

  @override
  Widget build(BuildContext context) {
    final submitted = onTime + late;
    final canOpen = navYearId != null;
    return InkWell(
      onTap: canOpen ? () => _openDetail(context) : null,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
        child: Row(
          children: [
            const Icon(Icons.description_outlined,
                size: 16, color: AppColors.slate400),
            const SizedBox(width: 9),
            SizedBox(
              width: 78,
              child: Text(
                monthName,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppFonts.body(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                ),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(child: _triBar()),
            const SizedBox(width: 8),
            Text(
              '$submitted/$total',
              style: AppFonts.body(
                fontSize: 13,
                color: AppColors.slate500,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
            if (canOpen) ...[
              const SizedBox(width: 2),
              const Icon(Icons.chevron_right_rounded,
                  size: 18, color: AppColors.slate400),
            ],
          ],
        ),
      ),
    );
  }

  Widget _triBar() {
    final pendingAll = pending + notStarted;
    if (total <= 0) {
      return Container(
        height: 6,
        decoration: BoxDecoration(
          color: AppColors.slate100,
          borderRadius: BorderRadius.circular(999),
        ),
      );
    }
    return ClipRRect(
      borderRadius: BorderRadius.circular(999),
      child: SizedBox(
        height: 6,
        child: Row(
          children: [
            if (onTime > 0)
              Expanded(
                  flex: onTime, child: Container(color: AppColors.success)),
            if (late > 0)
              Expanded(flex: late, child: Container(color: AppColors.error)),
            if (pendingAll > 0)
              Expanded(
                  flex: pendingAll,
                  child: Container(color: AppColors.warning)),
          ],
        ),
      ),
    );
  }
}

// ── Per-Club Breakdown (real /egovernance/per-club grid) ─────────────────────

const int _kCmrPageSize = 20;

class _PerClubBreakdown extends StatefulWidget {
  final List<DaCmrPerClubRow> rows;
  const _PerClubBreakdown({required this.rows});

  @override
  State<_PerClubBreakdown> createState() => _PerClubBreakdownState();
}

class _PerClubBreakdownState extends State<_PerClubBreakdown> {
  final TextEditingController _searchCtrl = TextEditingController();
  Timer? _debounce;
  String _search = '';
  int _page = 1;

  void _onSearch(String v) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 250), () {
      if (!mounted) return;
      setState(() {
        _search = v.trim().toLowerCase();
        _page = 1;
      });
    });
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final rows = widget.rows;
    final filtered = _search.isEmpty
        ? rows
        : rows
            .where((r) => r.clubName.toLowerCase().contains(_search))
            .toList();
    final total = filtered.length;
    final totalPages = total == 0 ? 1 : ((total - 1) ~/ _kCmrPageSize) + 1;
    final page = _page.clamp(1, totalPages);
    final paged = filtered
        .skip((page - 1) * _kCmrPageSize)
        .take(_kCmrPageSize)
        .toList();

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.slate200),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Per-Club Breakdown',
                  style: AppFonts.body(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'Each club’s month-by-month reporting status',
                  style: AppFonts.body(
                    fontSize: 13,
                    color: AppColors.slate500,
                  ),
                ),
                const SizedBox(height: 10),
                _searchField(),
                const SizedBox(height: 10),
                const _StatusLegend(),
              ],
            ),
          ),
          const Divider(height: 1, color: AppColors.slate100),
          if (rows.isEmpty)
            _msg('No clubs available.')
          else if (filtered.isEmpty)
            _msg('No clubs match your search.')
          else
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (int i = 0; i < paged.length; i++) ...[
                  if (i > 0)
                    const Divider(height: 1, color: AppColors.slate100),
                  _ClubRow(row: paged[i]),
                ],
                if (totalPages > 1)
                  _Pager(
                    page: page,
                    totalPages: totalPages,
                    total: total,
                    onPage: (p) => setState(() => _page = p),
                  ),
              ],
            ),
        ],
      ),
    );
  }

  Widget _searchField() {
    return TextField(
      controller: _searchCtrl,
      onChanged: _onSearch,
      style: AppFonts.body(
          fontSize: 13, color: AppColors.textPrimary),
      decoration: InputDecoration(
        hintText: 'Search club…',
        hintStyle: AppFonts.body(
            fontSize: 13, color: AppColors.slate400),
        prefixIcon: const Icon(Icons.search_rounded,
            size: 18, color: AppColors.slate400),
        isDense: true,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 8, vertical: 11),
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
    );
  }

  Widget _msg(String text) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 30, horizontal: 20),
      child: Center(
        child: Text(
          text,
          textAlign: TextAlign.center,
          style: AppFonts.body(
              fontSize: 13, color: AppColors.slate400),
        ),
      ),
    );
  }
}

class _StatusLegend extends StatelessWidget {
  const _StatusLegend();

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 12,
      runSpacing: 6,
      children: [
        for (final s in const ['submitted', 'pending', 'not_started'])
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 10,
                height: 10,
                decoration: BoxDecoration(
                  color: _cmrColor(s),
                  borderRadius: BorderRadius.circular(3),
                ),
              ),
              const SizedBox(width: 4),
              Text(
                _cmrLabel(s),
                style: AppFonts.body(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: AppColors.slate500,
                ),
              ),
            ],
          ),
      ],
    );
  }
}

class _ClubRow extends StatelessWidget {
  final DaCmrPerClubRow row;
  const _ClubRow({required this.row});

  @override
  Widget build(BuildContext context) {
    var onTime = 0, late = 0, pending = 0, notStarted = 0;
    for (final m in row.months) {
      switch (m.status) {
        case 'submitted':
          onTime++;
          break;
        case 'late':
          late++;
          break;
        case 'pending':
          pending++;
          break;
        default:
          notStarted++;
      }
    }
    final pendingTotal = pending + notStarted;
    final completedPct =
        ((onTime + late) / 12 * 100).round().clamp(0, 100);

    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 11, 14, 11),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            row.clubName.isEmpty ? '–' : row.clubName,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppFonts.body(
              fontSize: 13,
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(height: 8),
          _MonthDots(months: row.months),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: Text(
                  '$onTime on-time · $late late · $pendingTotal pending',
                  style: AppFonts.body(
                    fontSize: 13,
                    color: AppColors.slate500,
                  ),
                ),
              ),
              Text(
                '$completedPct%',
                style: AppFonts.body(
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                  color: AppColors.success,
                ),
              ),
            ],
          ),
          const SizedBox(height: 5),
          ClipRRect(
            borderRadius: BorderRadius.circular(999),
            child: LinearProgressIndicator(
              value: completedPct / 100,
              minHeight: 5,
              backgroundColor: AppColors.slate100,
              valueColor:
                  const AlwaysStoppedAnimation<Color>(AppColors.success),
            ),
          ),
        ],
      ),
    );
  }
}

class _MonthDots extends StatelessWidget {
  final List<DaCmrPerClubMonth> months;
  const _MonthDots({required this.months});

  @override
  Widget build(BuildContext context) {
    // Render 12 dots in rotary-month order; tolerate missing months.
    final byMonth = {for (final m in months) m.month: m.status};
    return Wrap(
      spacing: 5,
      runSpacing: 5,
      children: [
        for (int mo = 1; mo <= 12; mo++)
          Tooltip(
            message:
                '${_kRyMonths[mo - 1]}: ${_cmrLabel(byMonth[mo] ?? 'not_started')}',
            child: Container(
              width: 13,
              height: 13,
              decoration: BoxDecoration(
                color: _cmrColor(byMonth[mo] ?? 'not_started'),
                borderRadius: BorderRadius.circular(3),
              ),
            ),
          ),
      ],
    );
  }
}

// ── shared pager ─────────────────────────────────────────────────────────────

class _Pager extends StatelessWidget {
  final int page;
  final int totalPages;
  final int total;
  final ValueChanged<int> onPage;
  const _Pager({
    required this.page,
    required this.totalPages,
    required this.total,
    required this.onPage,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: AppColors.slate100)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              'Page $page of $totalPages · $total clubs',
              style: AppFonts.body(
                  fontSize: 13, color: AppColors.slate500),
            ),
          ),
          _ChevBtn(
            icon: Icons.chevron_left_rounded,
            enabled: page > 1,
            onTap: () => onPage(page - 1),
          ),
          const SizedBox(width: 6),
          _ChevBtn(
            icon: Icons.chevron_right_rounded,
            enabled: page < totalPages,
            onTap: () => onPage(page + 1),
          ),
        ],
      ),
    );
  }
}

class _ChevBtn extends StatelessWidget {
  final IconData icon;
  final bool enabled;
  final VoidCallback onTap;
  const _ChevBtn({
    required this.icon,
    required this.enabled,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: enabled ? onTap : null,
      borderRadius: BorderRadius.circular(7),
      child: Container(
        padding: const EdgeInsets.all(3),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(7),
          border: Border.all(color: AppColors.slate200),
          color: enabled ? Colors.white : AppColors.slate100,
        ),
        child: Icon(icon,
            size: 18,
            color: enabled ? AppColors.slate700 : AppColors.slate400),
      ),
    );
  }
}


