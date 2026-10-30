import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/services/club_admin_dashboard_api.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../data/models/club_admin_dashboard_models.dart';
import 'widgets/club_avenue_tab.dart';
import 'widgets/club_communication_tab.dart';
import 'widgets/club_dues_tab.dart';
import 'widgets/club_egovernance_tab.dart';
import 'widgets/club_foundation_tab.dart';
import 'widgets/club_membership_tab.dart';
import 'widgets/club_overview_tab.dart';
// import 'widgets/club_payment_links_tab.dart'; // Payment Links tab hidden (per request)
import 'widgets/club_website_tab.dart';
import '../../wallet/wallet_topup_screen.dart';
import 'package:provider/provider.dart';
import '../../../../core/maintenance/maintenance_controller.dart';
import '../../../widgets/maintenance/maintenance_panel.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// Data-rich club analytics dashboard, reached via the analytics icon on the
/// existing `ClubDashboardScreen` AppBar. The default landing is the
/// **Membership** tab per the React reference URL
/// `/clubdashboard/membership`.
///
/// Mirrors `AG_module-master/src/modules/club/layout/ClubLayout.jsx`'s 8
/// nav sections, adapted to a scrollable mobile TabBar.
class ClubOverviewScreen extends StatefulWidget {
  final int clubId;
  const ClubOverviewScreen({super.key, required this.clubId});

  @override
  State<ClubOverviewScreen> createState() => _ClubOverviewScreenState();
}

class _ClubOverviewScreenState extends State<ClubOverviewScreen> {
  final ApiClient _api = ApiClient();
  final ClubAdminDashboardApi _dashApi = ClubAdminDashboardApi();
  String? _clubName;

  // Global Rotary-year selector. `_selectedYearId == null` means the current
  // year (the server default); each tab inherits this id via its `yearId` and
  // a year-keyed ValueKey forces a fresh fetch when it changes.
  List<DashYear> _years = const [];
  int? _selectedYearId;
  int? _currentYearId;
  String _currentYearLabel = '';

  @override
  void initState() {
    super.initState();
    _fetchClubName();
    _fetchYears();
  }

  Future<void> _fetchYears() async {
    try {
      final r = await _dashApi.getAvailableYears(widget.clubId);
      if (!mounted) return;
      setState(() {
        _years = r.years;
        _currentYearId = r.currentYearId;
        _currentYearLabel = r.currentYearLabel;
      });
    } catch (_) {
      // silent — without the year list the dashboard stays on the current year
    }
  }

  /// The year-selector chip in the AppBar (hidden when the club has <2
  /// data-bearing years). Selecting a year re-fetches every tab.
  List<Widget> _yearActions() {
    if (_years.length < 2) return const [];
    final selId = _selectedYearId ?? _currentYearId;
    final selLabel = _years
        .firstWhere(
          (y) => y.id == selId,
          orElse: () =>
              DashYear(id: 0, label: _currentYearLabel, isCurrent: true),
        )
        .label;
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
                      y.label,
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

  /// Best-effort fetch of the real club name from `/api/clubs/{id}`. Failure
  /// falls back silently to the mock club name. Analytics data is mocked
  /// anyway — the page is useful even without the API.
  Future<void> _fetchClubName() async {
    try {
      final res =
          await _api.get<Map<String, dynamic>>('/api/clubs/${widget.clubId}');
      final data = res.data;
      if (data == null || !mounted) return;
      // GET /api/clubs/{id} (ClubDetailDto) serializes the name as `clubName`
      // — there is NO `name` key, so reading `name` left the title stuck on the
      // fallback. Prefer `clubName`; keep `name` as a defensive fallback.
      final name = (data['clubName'] ?? data['name'])?.toString();
      if (name != null && name.isNotEmpty) {
        setState(() => _clubName = name);
      }
    } catch (_) {
      // silent — title falls back to 'Club Dashboard'
    }
  }

  String get _title => (_clubName ?? 'Club Dashboard');

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      // Open on the Dashboard tab (index 0).
      length: 9,
      initialIndex: 0,
      child: Scaffold(
        backgroundColor: AppColors.lightBg,
        appBar: AppBar(
          backgroundColor: AppColors.lightBg,
          foregroundColor: AppColors.textPrimary,
          elevation: 0,
          centerTitle: false,
          leading: IconButton(
            icon: const Icon(Icons.arrow_back_ios_new_rounded,
                color: AppColors.textPrimary),
            onPressed: () => context.pop(),
          ),
          title: Text(
            _title,
            style: AppFonts.body(
              fontWeight: FontWeight.w800,
              fontSize: 15,
              color: AppColors.textPrimary,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          actions: _yearActions(),
          bottom: PreferredSize(
            preferredSize: const Size.fromHeight(46),
            child: TabBar(
              // Refresh maintenance flags when the user switches tabs (throttled)
              // so a tab toggled while they're in the dashboard is caught.
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
                Tab(text: 'Dashboard'),
                Tab(text: 'Projects / Events'),
                Tab(text: 'Membership'),
                Tab(text: 'Service Projects'),
                Tab(text: 'E-Governance'),
                Tab(text: 'Communication'),
                Tab(text: 'My Club Website'),
                Tab(text: 'Club Dues'),
                // Payment Links tab hidden (per request). Route/screen kept.
                Tab(text: 'Wallet'),
              ],
            ),
          ),
        ),
        body: TabBarView(
          children: [
            // Each tab is keyed by the selected year so changing the global
            // year re-creates it (fresh fetch with the new yearId). Payment
            // Links is not year-scoped, so it is left untouched.
            MaintenanceTabGate(routeKey: '/clubs/:id/overview#dashboard', child: ClubOverviewTab(key: ValueKey('dashboard-${_selectedYearId ?? 0}'), clubId: widget.clubId, yearId: _selectedYearId)),
            MaintenanceTabGate(routeKey: '/clubs/:id/overview#foundation', child: ClubFoundationTab(key: ValueKey('foundation-${_selectedYearId ?? 0}'), clubId: widget.clubId, yearId: _selectedYearId)),
            MaintenanceTabGate(routeKey: '/clubs/:id/overview#membership', child: ClubMembershipTab(key: ValueKey('membership-${_selectedYearId ?? 0}'), clubId: widget.clubId, yearId: _selectedYearId)),
            MaintenanceTabGate(routeKey: '/clubs/:id/overview#service-projects', child: ClubAvenueTab(key: ValueKey('service-${_selectedYearId ?? 0}'), clubId: widget.clubId, yearId: _selectedYearId)),
            MaintenanceTabGate(routeKey: '/clubs/:id/overview#e-governance', child: ClubEgovernanceTab(key: ValueKey('egov-${_selectedYearId ?? 0}'), clubId: widget.clubId, yearId: _selectedYearId)),
            MaintenanceTabGate(routeKey: '/clubs/:id/overview#communication', child: ClubCommunicationTab(key: ValueKey('comm-${_selectedYearId ?? 0}'), clubId: widget.clubId, yearId: _selectedYearId)),
            MaintenanceTabGate(routeKey: '/clubs/:id/overview#my-club-website', child: ClubWebsiteTab(key: ValueKey('website-${_selectedYearId ?? 0}'), clubId: widget.clubId, yearId: _selectedYearId)),
            MaintenanceTabGate(routeKey: '/clubs/:id/overview#membership-dues', child: ClubDuesTab(key: ValueKey('dues-${_selectedYearId ?? 0}'), clubId: widget.clubId, yearId: _selectedYearId)),
            // Payment Links tab hidden (per request). To restore: re-add the Tab
            // above, this child, bump DefaultTabController length back to 10, and
            // re-import club_payment_links_tab.dart.
            MaintenanceTabGate(routeKey: '/clubs/:id/overview#wallet', child: WalletTopupScreen(scope: 'club', clubId: widget.clubId, clubName: _clubName, embedded: true)),
          ],
        ),
      ),
    );
  }
}

