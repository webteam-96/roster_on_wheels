import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import '../../../core/services/ag_dashboard_api.dart';
import '../../../core/theme/app_colors.dart';
import '../../../data/models/ag_dashboard_models.dart';
import 'widgets/ag_clubs_tab.dart';
import 'widgets/ag_district_view_tab.dart';
import 'widgets/ag_membership_tab.dart';
import 'widgets/ag_service_projects_tab.dart';
import '../ag_reports/ag_reports_screen.dart';
import 'package:provider/provider.dart';
import '../../../core/maintenance/maintenance_controller.dart';
import '../../widgets/maintenance/maintenance_panel.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// AG (Assistant Governor) dashboard. Mirrors the web AG sidebar, which surfaces
/// exactly 5 sections and hides the rest.
///
/// Primary tabs (left → right, matching the web nav): My Clubs · Membership ·
/// Service Projects & Public Image · District View · Reports.
///
/// The three sections the web keeps but hides from its sidebar — Foundation &
/// TRF, Goals, Youth Services — live behind the app-bar "More" (⋮) overflow and
/// open as full-screen pushes. Nothing is removed; the shell just mirrors the
/// web's 5-up nav.
///
/// A global Rotary-year picker in the app bar (mirrors the web `AgYearSelector`)
/// threads `yearId` into every section; each refetches when it changes. The
/// picker lists only the years this AG holds an assignment for — it locks when
/// there is a single year and renders nothing until at least one is known.
class AgOverviewScreen extends StatefulWidget {
  const AgOverviewScreen({super.key});

  @override
  State<AgOverviewScreen> createState() => _AgOverviewScreenState();
}

class _AgOverviewScreenState extends State<AgOverviewScreen> {
  final AgDashboardApi _api = AgDashboardApi();

  AgAvailableYears _years = AgAvailableYears.empty;

  /// Effective year sent to the tabs. `null` = the server's default (current
  /// year) — kept null until the AG explicitly picks another year so the first
  /// paint doesn't trigger a redundant refetch.
  int? _selectedYearId;

  @override
  void initState() {
    super.initState();
    _loadYears();
  }

  Future<void> _loadYears() async {
    try {
      final y = await _api.getAvailableYears();
      if (mounted) setState(() => _years = y);
    } catch (_) {
      // Non-fatal: the dashboard still works on the server-default year without
      // a picker. Leave `_years` empty (picker renders nothing).
    }
  }

  void _pickYear(int id) {
    if (id == (_selectedYearId ?? _years.currentYearId)) return;
    setState(() => _selectedYearId = id);
  }

  @override
  Widget build(BuildContext context) {
    final yearId = _selectedYearId;
    return DefaultTabController(
      length: 5,
      child: Scaffold(
        backgroundColor: AppColors.lightBg,
        appBar: AppBar(
          backgroundColor: AppColors.primaryPrime,
          foregroundColor: Colors.white,
          elevation: 0,
          centerTitle: true,
          titleSpacing: 0,
          leading: IconButton(
            icon: const Icon(Icons.arrow_back_ios_new_rounded,
                color: Colors.white),
            onPressed: () => context.pop(),
          ),
          title: Text(
            'AG DASHBOARD',
            style: AppFonts.body(
              fontWeight: FontWeight.w800,
              fontSize: 14,
              color: Colors.white,
              letterSpacing: 1,
            ),
          ),
          actions: [
            _AgYearPicker(
              years: _years,
              selectedId: _selectedYearId ?? _years.currentYearId,
              onPicked: _pickYear,
            ),
            const SizedBox(width: 6),
          ],
          bottom: PreferredSize(
            preferredSize: const Size.fromHeight(46),
            child: TabBar(
              // Refresh maintenance flags on tab switch (throttled) so a tab
              // toggled while the user is in the dashboard is caught.
              onTap: (_) => context.read<MaintenanceController>().refresh(),
              isScrollable: true,
              tabAlignment: TabAlignment.start,
              labelColor: Colors.white,
              unselectedLabelColor: Colors.white.withValues(alpha: 0.62),
              indicatorColor: AppColors.goldPrime,
              indicatorWeight: 3,
              dividerColor: Colors.transparent,
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
                Tab(text: 'My Clubs'),
                Tab(text: 'Membership'),
                Tab(text: 'Service Projects & Public Image'),
                Tab(text: 'District View'),
                Tab(text: 'Reports'),
              ],
            ),
          ),
        ),
        body: TabBarView(
          children: [
            MaintenanceTabGate(
                routeKey: '/agdashboard#my-clubs',
                child: AgClubsTab(yearId: yearId)),
            MaintenanceTabGate(
                routeKey: '/agdashboard#membership',
                child: AgMembershipTab(yearId: yearId)),
            MaintenanceTabGate(
                routeKey: '/agdashboard#service-projects',
                child: AgServiceProjectsTab(yearId: yearId)),
            MaintenanceTabGate(
                routeKey: '/agdashboard#district-view',
                child: AgDistrictViewTab(yearId: yearId)),
            const MaintenanceTabGate(
                routeKey: '/agdashboard#reports',
                child: AgReportsScreen(embedded: true)),
          ],
        ),
      ),
    );
  }

}

/// App-bar Rotary-year pill. Renders nothing until the year list is known;
/// locks (non-interactive) when the AG holds a single year; otherwise opens a
/// menu of years with the current year tagged.
class _AgYearPicker extends StatelessWidget {
  final AgAvailableYears years;
  final int? selectedId;
  final ValueChanged<int> onPicked;
  const _AgYearPicker({
    required this.years,
    required this.selectedId,
    required this.onPicked,
  });

  String get _label {
    if (years.years.isEmpty) return years.currentYearLabel;
    final match = years.years.where((y) => y.id == selectedId);
    if (match.isNotEmpty) return match.first.yearLabel;
    return years.currentYearLabel.isEmpty
        ? years.years.first.yearLabel
        : years.currentYearLabel;
  }

  @override
  Widget build(BuildContext context) {
    // Nothing known yet → no control (dashboard runs on the default year).
    if (years.years.isEmpty && years.currentYearLabel.isEmpty) {
      return const SizedBox.shrink();
    }

    final locked = years.years.length <= 1;
    final pill = Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: Colors.white.withValues(alpha: 0.22)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.calendar_today_rounded,
              size: 12, color: Colors.white),
          const SizedBox(width: 5),
          Text(
            _label.isEmpty ? 'Year' : _label,
            style: AppFonts.body(
              fontSize: 11.5,
              fontWeight: FontWeight.w700,
              color: Colors.white,
            ),
          ),
          if (!locked) ...[
            const SizedBox(width: 2),
            const Icon(Icons.keyboard_arrow_down_rounded,
                size: 15, color: Colors.white),
          ],
        ],
      ),
    );

    if (locked) {
      return Center(
        child: Tooltip(message: 'Rotary Year $_label', child: pill),
      );
    }

    return Center(
      child: PopupMenuButton<int>(
        tooltip: 'Rotary Year',
        offset: const Offset(0, 44),
        shape:
            RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        color: Colors.white,
        onSelected: onPicked,
        itemBuilder: (context) => [
          for (final y in years.years)
            PopupMenuItem<int>(
              value: y.id,
              child: Row(
                children: [
                  Icon(
                    y.id == selectedId
                        ? Icons.radio_button_checked_rounded
                        : Icons.radio_button_unchecked_rounded,
                    size: 16,
                    color: y.id == selectedId
                        ? AppColors.primaryPrime
                        : AppColors.slate400,
                  ),
                  const SizedBox(width: 8),
                  Text(
                    y.yearLabel,
                    style: AppFonts.body(
                      fontSize: 13,
                      fontWeight:
                          y.id == selectedId ? FontWeight.w800 : FontWeight.w600,
                      color: AppColors.textPrimary,
                    ),
                  ),
                  if (y.isCurrent) ...[
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 6, vertical: 1),
                      decoration: BoxDecoration(
                        color: AppColors.background,
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Text(
                        'Current',
                        style: AppFonts.body(
                          fontSize: 8.5,
                          fontWeight: FontWeight.w800,
                          color: AppColors.successDark,
                          letterSpacing: 0.3,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
        ],
        child: pill,
      ),
    );
  }
}
