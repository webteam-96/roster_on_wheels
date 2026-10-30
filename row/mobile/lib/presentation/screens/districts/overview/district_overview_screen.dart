import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/services/district_admin_dashboard_api.dart';
import '../../../../core/services/district_analytics_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../data/models/district_admin_dashboard_models.dart';
import 'widgets/analytical_cards.dart';
import 'widgets/club_bar_chart.dart';
import 'widgets/communication_tab.dart';
import 'widgets/district_dashboard_async.dart';
import 'widgets/egovernance_tab.dart';
import 'widgets/foundation_tab.dart';
import 'widgets/leaderboard_card.dart';
import 'widgets/membership_tab.dart';
import 'widgets/quick_links_tab.dart';
import 'widgets/rotary_network_tab.dart';
import '../modules/district_website_data_screen.dart';
import '../../wallet/wallet_topup_screen.dart';
import '../../../widgets/common/dashboard_refresh.dart';
import 'package:provider/provider.dart';
import '../../../../core/maintenance/maintenance_controller.dart';
import '../../../widgets/maintenance/maintenance_panel.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// Data-rich district analytics dashboard. Reached via the analytics icon on
/// `DistrictDashboardScreen`'s AppBar. The original module-launcher dashboard
/// is unchanged and remains the default landing for district admins.
///
/// Mirrors the layout of
/// `AG_module-master/src/modules/district/pages/Overview.jsx` and the 5
/// sections from `DistrictLayout.jsx` (Overview, Membership, Foundation,
/// Communication, E-Governance), adapted for mobile with a TabBar replacing
/// the desktop sidebar.
class DistrictOverviewScreen extends StatefulWidget {
  final int districtId;
  const DistrictOverviewScreen({super.key, required this.districtId});

  @override
  State<DistrictOverviewScreen> createState() => _DistrictOverviewScreenState();
}

class _DistrictOverviewScreenState extends State<DistrictOverviewScreen> {
  final ApiClient _api = ApiClient();
  final DistrictAdminDashboardApi _dashApi = DistrictAdminDashboardApi();
  String? _districtNumber;

  // Global Rotary-year selector (mirrors the club overview dashboard).
  // `_selectedYearId == null` means the current year (the server default); each
  // tab inherits this id via its `yearId` and a year-keyed ValueKey forces a
  // fresh fetch when it changes.
  List<RotaryYearLite> _years = const [];
  int? _selectedYearId;
  int? _currentYearId;
  String _currentYearLabel = '';

  @override
  void initState() {
    super.initState();
    _fetchDistrictNumber();
    _fetchYears();
  }

  Future<void> _fetchYears() async {
    try {
      final list = await _dashApi.getRotaryYears();
      if (!mounted) return;
      setState(() {
        _years = list;
        final current = list.where((y) => y.isCurrent);
        if (current.isNotEmpty) {
          _currentYearId = current.first.id;
          _currentYearLabel = current.first.yearLabel;
        }
      });
    } catch (_) {
      // silent — without the year list the dashboard stays on the current year
    }
  }

  /// The year-selector chip in the AppBar (hidden when the district has <2
  /// rotary years). Selecting a year re-fetches every tab.
  List<Widget> _yearActions() {
    if (_years.length < 2) return const [];
    final selId = _selectedYearId ?? _currentYearId;
    final selLabel = _years
        .firstWhere(
          (y) => y.id == selId,
          orElse: () => RotaryYearLite(
              id: 0, yearLabel: _currentYearLabel, isCurrent: true),
        )
        .yearLabel;
    return [
      Padding(
        padding: const EdgeInsets.only(right: 8),
        child: PopupMenuButton<int>(
          tooltip: 'Rotary year',
          onSelected: (id) => setState(() => _selectedYearId = id),
          itemBuilder: (_) => [
            for (final y in _years)
              PopupMenuItem<int>(
                value: y.id,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      y.yearLabel,
                      style: AppFonts.body(
                        fontSize: 13,
                        fontWeight: y.id == selId
                            ? FontWeight.w800
                            : FontWeight.w500,
                      ),
                    ),
                    if (y.isCurrent) ...[
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 6, vertical: 1),
                        decoration: BoxDecoration(
                          color: AppColors.primaryPrime.withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          'Current',
                          style: AppFonts.body(
                            fontSize: 13,
                            fontWeight: FontWeight.w700,
                            color: AppColors.primaryPrime,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
          ],
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: Colors.white.withValues(alpha: 0.30)),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.calendar_today_rounded,
                    size: 12, color: Colors.white),
                const SizedBox(width: 5),
                Text(
                  selLabel.isEmpty ? 'Year' : selLabel,
                  style: AppFonts.body(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: Colors.white,
                  ),
                ),
                const Icon(Icons.arrow_drop_down_rounded,
                    size: 18, color: Colors.white),
              ],
            ),
          ),
        ),
      ),
    ];
  }

  /// Best-effort fetch of the district's user-facing number (e.g. "3142")
  /// from `/api/districts/{id}`. Failure falls back silently to a "DISTRICT"
  /// title without the number — analytics is mocked anyway, so the page
  /// remains useful even if the API is down.
  Future<void> _fetchDistrictNumber() async {
    try {
      final res = await _api.get<Map<String, dynamic>>(
        '/api/districts/${widget.districtId}',
      );
      final data = res.data;
      if (data == null || !mounted) return;
      final number = data['districtNumber']?.toString();
      if (number != null && number.isNotEmpty) {
        setState(() => _districtNumber = number);
      }
    } catch (_) {
      // silent — title falls back to "DISTRICT"
    }
  }

  String get _appBarTitle {
    final n = _districtNumber;
    return n != null && n.isNotEmpty ? 'DISTRICT $n' : 'DISTRICT';
  }

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 9,
      child: Scaffold(
        backgroundColor: AppColors.lightBg,
        appBar: AppBar(
          backgroundColor: AppColors.lightBg,
          foregroundColor: AppColors.textPrimary,
          elevation: 0,
          centerTitle: false,
          leading: IconButton(
            icon: const Icon(Icons.arrow_back_ios_new_rounded, color: AppColors.textPrimary),
            onPressed: () => context.pop(),
          ),
          title: Text(
            _appBarTitle,
            style: AppFonts.body(
              fontWeight: FontWeight.w800,
              fontSize: 16,
              color: AppColors.textPrimary,
            ),
          ),
          actions: _yearActions(),
          bottom: PreferredSize(
            preferredSize: const Size.fromHeight(46),
            child: TabBar(
              // Refresh maintenance flags on tab switch (throttled) so a tab
              // toggled while the user is in the dashboard is caught.
              onTap: (_) => context.read<MaintenanceController>().refresh(),
              isScrollable: true,
              tabAlignment: TabAlignment.start,
              labelPadding: const EdgeInsets.symmetric(horizontal: 14),
              labelStyle: AppFonts.body(
                fontSize: 13,
                fontWeight: FontWeight.w700,
              ),
              unselectedLabelStyle: AppFonts.body(
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
              tabs: const [
                Tab(text: 'Overview'),
                Tab(text: 'Membership'),
                Tab(text: 'Projects / Events'),
                Tab(text: 'Communication'),
                Tab(text: 'E-Governance'),
                Tab(text: 'Rotary Network'),
                Tab(text: 'My District Website'),
                Tab(text: 'Quick Links'),
                Tab(text: 'Wallet'),
              ],
            ),
          ),
        ),
        body: TabBarView(
          children: [
            // Each tab is keyed by the selected year so changing the global
            // year re-creates it (fresh fetch with the new yearId).
            MaintenanceTabGate(routeKey: '/districts/:id/overview#overview', child: _OverviewTab(key: ValueKey('overview-${_selectedYearId ?? 0}'), districtId: widget.districtId, yearId: _selectedYearId)),
            MaintenanceTabGate(routeKey: '/districts/:id/overview#membership', child: MembershipTab(key: ValueKey('membership-${_selectedYearId ?? 0}'), districtId: widget.districtId, yearId: _selectedYearId)),
            MaintenanceTabGate(routeKey: '/districts/:id/overview#foundation', child: FoundationTab(key: ValueKey('foundation-${_selectedYearId ?? 0}'), districtId: widget.districtId, yearId: _selectedYearId)),
            MaintenanceTabGate(routeKey: '/districts/:id/overview#communication', child: CommunicationTab(key: ValueKey('communication-${_selectedYearId ?? 0}'), districtId: widget.districtId, yearId: _selectedYearId)),
            MaintenanceTabGate(routeKey: '/districts/:id/overview#e-governance', child: EGovernanceTab(key: ValueKey('egov-${_selectedYearId ?? 0}'), districtId: widget.districtId, yearId: _selectedYearId, effectiveYearId: _selectedYearId ?? _currentYearId)),
            MaintenanceTabGate(routeKey: '/districts/:id/overview#rotary-network', child: RotaryNetworkTab(key: ValueKey('rotary-network-${_selectedYearId ?? 0}'), districtId: widget.districtId, yearId: _selectedYearId)),
            MaintenanceTabGate(routeKey: '/districts/:id/overview#my-district-website', child: DistrictWebsiteDataScreen(districtId: widget.districtId, embedded: true)),
            MaintenanceTabGate(routeKey: '/districts/:id/overview#quick-links', child: QuickLinksTab(districtId: widget.districtId)),
            MaintenanceTabGate(routeKey: '/districts/:id/overview#wallet', child: WalletTopupScreen(scope: 'district', districtId: widget.districtId, embedded: true)),
          ],
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Overview tab — wired to GET /api/mobile/district-admin-dashboard/overview.
// Renders: header banner · KPI strip (2×2) · 4 analytical panel cards · Top 20
// Clubs by Member Count bar list · Club Leaderboard.
// ─────────────────────────────────────────────────────────────────────────

class _OverviewTab extends StatefulWidget {
  final int districtId;
  final int? yearId;
  const _OverviewTab({super.key, required this.districtId, this.yearId});

  @override
  State<_OverviewTab> createState() => _OverviewTabState();
}

class _OverviewTabState extends State<_OverviewTab>
    with AutomaticKeepAliveClientMixin<_OverviewTab> {
  final DistrictAdminDashboardApi _dashApi = DistrictAdminDashboardApi();
  late Future<DistrictAdminOverview> _future;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _future = _dashApi.getOverview(widget.districtId, yearId: widget.yearId);
  }

  void _reload() => setState(() =>
      _future = _dashApi.getOverview(widget.districtId, yearId: widget.yearId));

  /// Pull-to-refresh: fetch first, then swap so content doesn't flash a loader.
  Future<void> _refresh() async {
    final f = _dashApi.getOverview(widget.districtId, yearId: widget.yearId);
    await f.then((_) {}, onError: (_) {});
    if (!mounted) return;
    setState(() => _future = f);
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return FutureBuilder<DistrictAdminOverview>(
      future: _future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const DaLoading();
        }
        if (snap.hasError) {
          return DaError(error: snap.error!, onRetry: _reload);
        }
        return DistrictOverviewScope(
          data: snap.data!,
          child: DashboardRefresh.around(
            onRefresh: _refresh,
            child: const _OverviewBody(),
          ),
        );
      },
    );
  }
}

class _OverviewBody extends StatelessWidget {
  const _OverviewBody();

  @override
  Widget build(BuildContext context) {
    return const SingleChildScrollView(
      physics: AlwaysScrollableScrollPhysics(),
      padding: EdgeInsets.fromLTRB(12, 12, 12, 32),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _KpiStrip(),
          SizedBox(height: 14),
          _AnalyticalCardsList(),
          SizedBox(height: 14),
          Top20ClubsCard(),
          SizedBox(height: 14),
          LeaderboardCard(),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// KPI strip — one card, three columns (Total Clubs / Total Members / TRF
// Contribution). District Citation lives in its own card below.
// ─────────────────────────────────────────────────────────────────────────

class _KpiStrip extends StatelessWidget {
  const _KpiStrip();

  @override
  Widget build(BuildContext context) {
    final o = DistrictOverviewScope.of(context);
    final number = o.district.districtNumber;
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.slate200),
      ),
      padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 6),
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Expanded(
              child: _KpiCol(
                label: 'Total Clubs',
                value: '${o.totalClubs}',
                sub: number.isEmpty ? 'In district' : 'District $number',
                accent: AppColors.rotaryBlue,
              ),
            ),
            _divider(),
            Expanded(
              child: _KpiCol(
                label: 'Total Members',
                value: '${o.totalMembers}',
                sub: 'Across all clubs',
                accent: AppColors.avenueVocational,
              ),
            ),
            _divider(),
            Expanded(
              child: _KpiCol(
                label: 'TRF Contribution',
                value: DistrictAnalyticsService.fmtUsd(o.trfTotalInr),
                sub: 'All funds combined',
                accent: AppColors.avenuePublicImage,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _divider() =>
      Container(width: 1, color: AppColors.slate100, margin: const EdgeInsets.symmetric(horizontal: 4));
}

class _KpiCol extends StatelessWidget {
  final String label;
  final String value;
  final String sub;
  final Color accent;
  const _KpiCol({
    required this.label,
    required this.value,
    required this.sub,
    required this.accent,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 6),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          FittedBox(
            fit: BoxFit.scaleDown,
            child: Text(
              value,
              style: AppFonts.body(
                fontSize: 22,
                fontWeight: FontWeight.w800,
                color: accent,
                height: 1.0,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
          ),
          const SizedBox(height: 6),
          Text(
            label,
            textAlign: TextAlign.center,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: AppFonts.body(
              fontSize: 13,
              fontWeight: FontWeight.w700,
              color: AppColors.slate500,
              letterSpacing: 0.4,
              height: 1.2,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            sub,
            textAlign: TextAlign.center,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: AppFonts.body(
              fontSize: 13,
              fontWeight: FontWeight.w500,
              color: AppColors.slate400,
              height: 1.2,
            ),
          ),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Analytical cards section — stacked single-column for mobile readability
// ─────────────────────────────────────────────────────────────────────────

class _AnalyticalCardsList extends StatelessWidget {
  const _AnalyticalCardsList();

  @override
  Widget build(BuildContext context) {
    return const Column(
      children: [
        MembershipCard(),
        SizedBox(height: 10),
        ServiceAvenueCard(),
        SizedBox(height: 10),
        TrfGoalCard(),
        SizedBox(height: 10),
        CitationCard(),
      ],
    );
  }
}
