import 'package:flutter/material.dart';
import '../../../../../core/services/club_admin_dashboard_api.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../core/utils/money_format.dart';
import '../../../../widgets/common/member_growth_chart.dart';
import '../../../../../data/models/club_admin_dashboard_models.dart';
import '../../../../../data/models/club_overview_models.dart';
import 'club_dashboard_async.dart';
import 'dashboard/dashboard_bod_subtab.dart';
import 'dashboard/dashboard_directory_subtab.dart';
import 'dashboard/dashboard_rotary_network_subtab.dart';
import '../../../../widgets/common/dashboard_refresh.dart';
import '../../../../widgets/common/website_renewal_dialog.dart';
import '../../modules/website_purchase/website_purchase_screen.dart';
import 'membership_summary_card.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// The club "Dashboard" tab — mirrors the web Club Dashboard's five sub-tabs
/// (Overview · Directory · Board of Directors · Rotary Network).
class ClubOverviewTab extends StatefulWidget {
  final int clubId;
  final int? yearId;
  const ClubOverviewTab({super.key, required this.clubId, this.yearId});

  @override
  State<ClubOverviewTab> createState() => _ClubOverviewTabState();
}

class _ClubOverviewTabState extends State<ClubOverviewTab>
    with AutomaticKeepAliveClientMixin<ClubOverviewTab> {
  int _active = 0;

  static const _labels = [
    'Overview',
    'Directory',
    'Board of Directors',
    'Rotary Network',
  ];

  @override
  bool get wantKeepAlive => true;

  Widget _content() {
    switch (_active) {
      case 1:
        return DashboardDirectorySubtab(
            clubId: widget.clubId, yearId: widget.yearId);
      case 2:
        return DashboardBodSubtab(
            clubId: widget.clubId, yearId: widget.yearId);
      case 3:
        return DashboardRotaryNetworkSubtab(
            clubId: widget.clubId, yearId: widget.yearId);
      default:
        return _OverviewSubTab(clubId: widget.clubId, yearId: widget.yearId);
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _DashboardSubTabBar(
          active: _active,
          labels: _labels,
          onSelect: (i) => setState(() => _active = i),
        ),
        Expanded(child: _content()),
      ],
    );
  }
}

class _DashboardSubTabBar extends StatelessWidget {
  final int active;
  final List<String> labels;
  final ValueChanged<int> onSelect;
  const _DashboardSubTabBar({
    required this.active,
    required this.labels,
    required this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 12, 12, 0),
      padding: const EdgeInsets.all(6),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.slate200),
      ),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            for (var i = 0; i < labels.length; i++)
              Padding(
                padding: const EdgeInsets.only(right: 4),
                child: Material(
                  color: i == active ? AppColors.rotaryBlue : Colors.transparent,
                  borderRadius: BorderRadius.circular(8),
                  child: InkWell(
                    onTap: () => onSelect(i),
                    borderRadius: BorderRadius.circular(8),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 8),
                      child: Text(
                        labels[i],
                        style: AppFonts.body(
                          fontSize: 12,
                          fontWeight:
                              i == active ? FontWeight.w800 : FontWeight.w600,
                          color: i == active ? Colors.white : AppColors.slate500,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// "Overview" tab of the Club Overview screen.
/// Mirrors `AG_module-master/src/modules/club/pages/Overview.jsx` OverviewContent.
///
/// Layout:
///   1. Status alerts strip (Rotary.org sync · website renewal)
///   2. KPI strip (5 metrics)
///   3. 4 analytical cards (Membership / TRF / Avenue / Citation),
///      chart-inside-active-card pattern, same as District Overview
///   4. Upcoming events
class _OverviewSubTab extends StatefulWidget {
  final int clubId;
  final int? yearId;
  const _OverviewSubTab({required this.clubId, this.yearId});

  @override
  State<_OverviewSubTab> createState() => _OverviewSubTabState();
}

enum _ActiveCard { membership, trf, avenue, citation }

/// Provides the fetched `/overview` payload to the tab's descendant widgets.
class _OverviewScope extends InheritedWidget {
  final ClubAdminOverview data;
  const _OverviewScope({required this.data, required super.child});

  static ClubAdminOverview of(BuildContext context) {
    final scope =
        context.dependOnInheritedWidgetOfExactType<_OverviewScope>();
    assert(scope != null, 'No _OverviewScope found in context');
    return scope!.data;
  }

  @override
  bool updateShouldNotify(_OverviewScope oldWidget) => data != oldWidget.data;
}

class _OverviewSubTabState extends State<_OverviewSubTab>
    with AutomaticKeepAliveClientMixin<_OverviewSubTab> {
  final ClubAdminDashboardApi _api = ClubAdminDashboardApi();
  late Future<ClubAdminOverview> _future;
  _ActiveCard _active = _ActiveCard.membership;
  final GlobalKey _activeCardKey = GlobalKey();

  @override
  void initState() {
    super.initState();
    _future = _api.getOverview(widget.clubId, yearId: widget.yearId);
  }

  void _reload() =>
      setState(() => _future = _api.getOverview(widget.clubId, yearId: widget.yearId));

  /// Pull-to-refresh: fetch first, then swap so content doesn't flash a loader.
  Future<void> _refresh() async {
    final f = _api.getOverview(widget.clubId, yearId: widget.yearId);
    await f.then((_) {}, onError: (_) {});
    if (!mounted) return;
    setState(() => _future = f);
  }

  void _setActive(_ActiveCard c) {
    setState(() => _active = c);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final ctx = _activeCardKey.currentContext;
      if (ctx == null || !mounted) return;
      Scrollable.ensureVisible(
        ctx,
        duration: const Duration(milliseconds: 320),
        curve: Curves.easeInOut,
        alignment: 0.0,
        alignmentPolicy: ScrollPositionAlignmentPolicy.explicit,
      );
    });
  }

  @override
  bool get wantKeepAlive => true;

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return FutureBuilder<ClubAdminOverview>(
      future: _future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const ClubDashboardLoading();
        }
        if (snap.hasError) {
          return ClubDashboardError(error: snap.error!, onRetry: _reload);
        }
        return _OverviewScope(
          data: snap.data!,
          child: DashboardRefresh(
            onRefresh: _refresh,
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 32),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _StatusAlerts(clubId: widget.clubId),
                const SizedBox(height: 14),
                const _KpiStrip(),
                const SizedBox(height: 14),
                _AnalyticalCardsList(
                  active: _active,
                  onSelect: _setActive,
                  activeCardKey: _activeCardKey,
                ),
                const SizedBox(height: 14),
                const _EventsCard(),
              ],
            ),
          ),
        );
      },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 1. Status alerts strip (Rotary.org sync + website overdue)
// ─────────────────────────────────────────────────────────────────────────

class _StatusAlerts extends StatelessWidget {
  final int clubId;
  const _StatusAlerts({required this.clubId});

  static String _fmtExpiry(DateTime d) =>
      '${d.day.toString().padLeft(2, '0')}/'
      '${d.month.toString().padLeft(2, '0')}/${d.year}';

  @override
  Widget build(BuildContext context) {
    // Real per-club status from the `/overview` `club` identity object
    // (rotaryOrgSyncEnabled / clubWebsiteActive / clubWebsiteExpiry).
    final data = _OverviewScope.of(context);
    final syncOn = data.rotaryOrgSyncEnabled;
    final siteActive = data.clubWebsiteActive;
    final expiry = data.clubWebsiteExpiry;
    final expiryLabel = expiry != null ? 'Expiry ${_fmtExpiry(expiry)}' : null;
    // The club has NEVER set up a website when it isn't active AND has no
    // expiry date — the backend only returns an expiry when a `club_websites`
    // row exists, so a null expiry means "no subscription ever" (not expired).
    // Show "Not set up" + a Set-up action instead of "Over Due" + Renew.
    final notConfigured = !siteActive && expiry == null;

    return Container(
      decoration: BoxDecoration(
        color: AppColors.slate50,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.slate200),
      ),
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
      child: Column(
        children: [
          _AlertRow(
            dotColor: syncOn ? AppColors.success : AppColors.statusPart,
            text: syncOn
                ? 'Rotary.org Sync: Enabled'
                : 'Rotary.org Sync: Disabled',
            textColor: syncOn ? AppColors.success : AppColors.statusPart,
            action:
                syncOn ? const SizedBox.shrink() : const _HowToEnableButton(),
          ),
          const SizedBox(height: 8),
          _AlertRow(
            dotColor: siteActive
                ? AppColors.success
                : notConfigured
                    ? AppColors.statusPart
                    : AppColors.statusNone,
            text: siteActive
                ? 'Integrated Club Website: Active'
                : notConfigured
                    ? 'Integrated Club Website: Not set up'
                    : 'Integrated Club Website: Over Due',
            textColor: siteActive
                ? AppColors.success
                : notConfigured
                    ? AppColors.statusPart
                    : AppColors.statusNone,
            sub: notConfigured ? null : expiryLabel,
            action: siteActive
                ? const SizedBox.shrink()
                : notConfigured
                    ? _SetupButton(clubId: clubId)
                    : const _RenewButton(),
          ),
          const SizedBox(height: 10),
          // Available communication credits (email), from the
          // /overview `club` object (emailCreditBalance).
          Align(
            alignment: Alignment.centerLeft,
            child: Wrap(
              spacing: 8,
              runSpacing: 6,
              children: [
                _CreditChip(
                  icon: Icons.mail_outline_rounded,
                  label: 'Email',
                  value: data.emailCreditBalance,
                  color: AppColors.accentBlue,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// A small pill showing an available communication-credit balance
/// (email) on the Overview status strip.
class _CreditChip extends StatelessWidget {
  final IconData icon;
  final String label;
  final int value;
  final Color color;
  const _CreditChip({
    required this.icon,
    required this.label,
    required this.value,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withValues(alpha: 0.25)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: color),
          const SizedBox(width: 5),
          Text(
            '$label  $value',
            style: AppFonts.body(
              fontSize: 11,
              fontWeight: FontWeight.w800,
              color: color,
            ),
          ),
        ],
      ),
    );
  }
}

class _AlertRow extends StatelessWidget {
  final Color dotColor;
  final String text;
  final Color textColor;
  final String? sub;
  final Widget action;
  const _AlertRow({
    required this.dotColor,
    required this.text,
    required this.textColor,
    this.sub,
    required this.action,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(color: dotColor, shape: BoxShape.circle),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                text,
                style: AppFonts.body(
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                  color: textColor,
                ),
              ),
              if (sub != null)
                Text(
                  sub!,
                  style: AppFonts.body(
                    fontSize: 10.5,
                    color: textColor.withValues(alpha: 0.7),
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(width: 8),
        action,
      ],
    );
  }
}

const _syncSteps = <String>[
  'Go to rotary.org and sign in',
  'Click My Rotary',
  'Open Club Administration',
  'Select Enable Data Sync',
  'Enter your Club ID and save',
];

class _HowToEnableButton extends StatelessWidget {
  const _HowToEnableButton();

  void _showSteps(BuildContext context) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius:
            BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (_) => Padding(
        padding: const EdgeInsets.fromLTRB(
            20, 16, 20, 28),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Center(
              child: Container(
                width: 36,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.slate200,
                  borderRadius: BorderRadius.circular(99),
                ),
              ),
            ),
            const SizedBox(height: 14),
            Text(
              'Steps to enable Rotary.org Sync',
              style: AppFonts.body(
                fontSize: 14,
                fontWeight: FontWeight.w800,
                color: AppColors.textPrimary,
              ),
            ),
            const SizedBox(height: 12),
            for (var i = 0; i < _syncSteps.length; i++)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 18,
                      height: 18,
                      alignment: Alignment.center,
                      decoration: const BoxDecoration(
                        color: AppColors.warningLight,
                        shape: BoxShape.circle,
                      ),
                      child: Text(
                        '${i + 1}',
                        style: AppFonts.body(
                          fontSize: 10,
                          fontWeight: FontWeight.w800,
                          color: AppColors.statusPart,
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        _syncSteps[i],
                        style: AppFonts.body(
                          fontSize: 12.5,
                          color: AppColors.slate700,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.warningLight,
      borderRadius: BorderRadius.circular(6),
      child: InkWell(
        onTap: () => _showSteps(context),
        borderRadius: BorderRadius.circular(6),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          child: Text(
            'How?',
            style: AppFonts.body(
              fontSize: 10.5,
              fontWeight: FontWeight.w800,
              color: AppColors.statusPart,
            ),
          ),
        ),
      ),
    );
  }
}

class _RenewButton extends StatelessWidget {
  const _RenewButton();

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.statusNone,
      borderRadius: BorderRadius.circular(6),
      child: InkWell(
        onTap: () => showWebsiteRenewalDialog(context),
        borderRadius: BorderRadius.circular(6),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
          child: Text(
            'Renew',
            style: AppFonts.body(
              fontSize: 10.5,
              fontWeight: FontWeight.w800,
              color: Colors.white,
            ),
          ),
        ),
      ),
    );
  }
}

/// Shown when the club has no website yet — opens the self-service Buy flow
/// (New mode) so the admin can set one up, instead of the (wrong) Renew action.
class _SetupButton extends StatelessWidget {
  final int clubId;
  const _SetupButton({required this.clubId});

  @override
  Widget build(BuildContext context) {
    final clubName = _OverviewScope.of(context).clubName;
    return Material(
      color: AppColors.primary,
      borderRadius: BorderRadius.circular(6),
      child: InkWell(
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute<bool>(
            builder: (_) => WebsitePurchaseScreen(
              clubId: clubId,
              clubName: clubName.trim().isEmpty ? null : clubName,
            ),
          ),
        ),
        borderRadius: BorderRadius.circular(6),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
          child: Text(
            'Set up',
            style: AppFonts.body(
              fontSize: 10.5,
              fontWeight: FontWeight.w800,
              color: Colors.white,
            ),
          ),
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 2. KPI strip — mobile-friendly take on the web Overview's 8 KPIs.
//    Instead of 8 separate boxes we group them into two compact cards:
//      • Membership card — hero Total + composition bar + Paid/Male/Female/
//        Honorary legend.
//      • Performance card — Avg Attendance · TRF Raised · Awards Score in
//        three divided columns.
// ─────────────────────────────────────────────────────────────────────────

class _KpiStrip extends StatelessWidget {
  const _KpiStrip();

  @override
  Widget build(BuildContext context) {
    final d = _OverviewScope.of(context);
    final s = d.stats;

    return Column(
      children: [
        MembershipSummaryCard(
          total: s.totalMembers,
          paid: s.fullMembers,
          male: d.maleMembers,
          female: d.femaleMembers,
          honorary: s.honoraryMembers,
          newThisYear: s.newMembersThisYear,
        ),
        const SizedBox(height: 10),
        _PerformanceCard(
          attendance: '${s.avgAttendance.toStringAsFixed(1)}%',
          trf: shortMoney(s.trfRaised, 'USD'),
          trfSub: d.hasTrfGoal ? '${d.trfPct}% of goal' : 'No goal set',
          awards: '${s.districtCitationScore}',
        ),
      ],
    );
  }
}

/// Rounded surface shared by the two KPI cards.
class _KpiSurface extends StatelessWidget {
  final Widget child;
  const _KpiSurface({required this.child});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(14, 13, 14, 14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.slate200),
      ),
      child: child,
    );
  }
}

/// Three performance metrics in equal, divided columns.
class _PerformanceCard extends StatelessWidget {
  final String attendance;
  final String trf;
  final String trfSub;
  final String awards;
  const _PerformanceCard({
    required this.attendance,
    required this.trf,
    required this.trfSub,
    required this.awards,
  });

  @override
  Widget build(BuildContext context) {
    return _KpiSurface(
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(
              child: _MetricCell(
                value: attendance,
                label: 'Avg Attendance',
                sub: 'Meeting records',
                accent: AppColors.avenueVocational,
              ),
            ),
            const VerticalDivider(
                width: 1, thickness: 1, color: AppColors.slate200),
            Expanded(
              child: _MetricCell(
                value: trf,
                label: 'TRF Raised',
                sub: trfSub,
                accent: AppColors.avenuePublicImage,
              ),
            ),
            const VerticalDivider(
                width: 1, thickness: 1, color: AppColors.slate200),
            Expanded(
              child: _MetricCell(
                value: awards,
                label: 'Awards Score',
                sub: 'District',
                accent: AppColors.avenueClubService,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// One stacked metric (value over label over sub) inside [_PerformanceCard].
class _MetricCell extends StatelessWidget {
  final String value;
  final String label;
  final String sub;
  final Color accent;
  const _MetricCell({
    required this.value,
    required this.label,
    required this.sub,
    required this.accent,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.center,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          FittedBox(
            fit: BoxFit.scaleDown,
            child: Text(
              value,
              maxLines: 1,
              style: AppFonts.body(
                fontSize: 19,
                fontWeight: FontWeight.w800,
                color: accent,
                height: 1.0,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
          ),
          const SizedBox(height: 5),
          Text(
            label.toUpperCase(),
            textAlign: TextAlign.center,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppFonts.body(
              fontSize: 9.5,
              fontWeight: FontWeight.w700,
              color: AppColors.slate500,
              letterSpacing: 0.4,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            sub,
            textAlign: TextAlign.center,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppFonts.body(
              fontSize: 10,
              fontWeight: FontWeight.w500,
              color: AppColors.textMuted,
            ),
          ),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 3. Analytical cards — chart-inside-active-card pattern
// ─────────────────────────────────────────────────────────────────────────

class _AnalyticalCardsList extends StatelessWidget {
  final _ActiveCard active;
  final ValueChanged<_ActiveCard> onSelect;
  final GlobalKey activeCardKey;
  const _AnalyticalCardsList({
    required this.active,
    required this.onSelect,
    required this.activeCardKey,
  });

  @override
  Widget build(BuildContext context) {
    Widget shell(_ActiveCard id) {
      final isActive = id == active;
      return Container(
        key: isActive ? activeCardKey : ValueKey('club-card-${id.name}'),
        margin: const EdgeInsets.only(bottom: 10),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: isActive ? AppColors.rotaryBlue : AppColors.slate200,
            width: isActive ? 2 : 1,
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: () => onSelect(id),
          child: isActive
              ? Column(
                  children: [
                    _CardBody(id: id, collapsed: false),
                    Container(height: 1, color: AppColors.slate100),
                    _CardChart(id: id),
                  ],
                )
              : _CardBody(id: id, collapsed: true),
        ),
      );
    }

    return Column(
      children: [
        shell(_ActiveCard.membership),
        shell(_ActiveCard.trf),
        shell(_ActiveCard.avenue),
        shell(_ActiveCard.citation),
      ],
    );
  }
}

class _CardBody extends StatelessWidget {
  final _ActiveCard id;
  final bool collapsed;
  const _CardBody({required this.id, required this.collapsed});

  @override
  Widget build(BuildContext context) {
    switch (id) {
      case _ActiveCard.membership: return _MembershipBody(collapsed: collapsed);
      case _ActiveCard.trf:        return _TrfBody(collapsed: collapsed);
      case _ActiveCard.avenue:     return _AvenueBody(collapsed: collapsed);
      case _ActiveCard.citation:   return _CitationBody(collapsed: collapsed);
    }
  }
}

// ── Collapsed pill — shared shape for inactive cards ──────────────────────

class _CollapsedRow extends StatelessWidget {
  final String title;
  final String value;
  final String sub;
  final Color accent;
  const _CollapsedRow({
    required this.title,
    required this.value,
    required this.sub,
    required this.accent,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
      child: Row(
        children: [
          Container(
            width: 4,
            height: 28,
            decoration: BoxDecoration(
              color: accent,
              borderRadius: BorderRadius.circular(999),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  title,
                  style: AppFonts.body(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: 1),
                Text(
                  sub,
                  style: AppFonts.body(
                    fontSize: 11,
                    color: AppColors.slate400,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Text(
            value,
            style: AppFonts.body(
              fontSize: 16,
              fontWeight: FontWeight.w800,
              color: accent,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
          const SizedBox(width: 4),
          const Icon(
            Icons.expand_more_rounded,
            size: 20,
            color: AppColors.slate400,
          ),
        ],
      ),
    );
  }
}

// ── Card bodies (expanded views) ──────────────────────────────────────────

class _MembershipBody extends StatelessWidget {
  final bool collapsed;
  const _MembershipBody({required this.collapsed});

  @override
  Widget build(BuildContext context) {
    final d = _OverviewScope.of(context);
    final kClubStats = d.stats;
    final kMemberGrowth = d.growth;
    if (collapsed) {
      return _CollapsedRow(
        title: 'Membership',
        value: '${kClubStats.totalMembers}',
        sub: '+${kClubStats.newMembersThisYear} new · ${kClubStats.activeMembers} active',
        accent: AppColors.rotaryBlue,
      );
    }
    final last = kMemberGrowth.isNotEmpty
        ? kMemberGrowth.last
        : MemberGrowthPoint(
            month: '',
            members: d.maleMembers + d.femaleMembers + d.honoraryMembers,
            male: d.maleMembers,
            female: d.femaleMembers,
            honorary: d.honoraryMembers,
          );
    final segs = <({String label, int value, Color color})>[
      (label: 'Active',   value: kClubStats.activeMembers,                   color: AppColors.rotaryBlue),
      (label: 'Male',     value: last.male,                                  color: AppColors.avenueInternational),
      (label: 'Female',   value: last.female,                                color: AppColors.avenueClubService),
      (label: 'Honorary', value: kClubStats.honoraryMembers,                 color: AppColors.avenueNewGen),
      (label: 'Inactive', value: kClubStats.totalMembers -
          kClubStats.activeMembers,                                          color: AppColors.slate400),
    ];
    return Padding(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Membership',
                      style: AppFonts.body(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary,
                      ),
                    ),
                    Text(
                      'RY ${d.yearLabel} snapshot',
                      style: AppFonts.body(
                        fontSize: 11,
                        color: AppColors.slate500,
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(
                    horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: AppColors.successLight,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  '+${kClubStats.newMembersThisYear} new',
                  style: AppFonts.body(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w800,
                    color: AppColors.successDark,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                '${kClubStats.totalMembers}',
                style: AppFonts.body(
                  fontSize: 30,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                  height: 1.0,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
              const SizedBox(width: 6),
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Text(
                  'total members',
                  style: AppFonts.body(
                    fontSize: 11,
                    color: AppColors.slate400,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          for (var i = 0; i < segs.length; i++) ...[
            _ProgressRow(
              label: segs[i].label,
              valueDisplay: '${segs[i].value}',
              progress: segs[i].value / kClubStats.totalMembers,
              color: segs[i].color,
            ),
            if (i != segs.length - 1) const SizedBox(height: 8),
          ],
          const SizedBox(height: 10),
          Container(height: 1, color: AppColors.slate100),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Terminated this RY',
                style: AppFonts.body(
                  fontSize: 11.5,
                  color: AppColors.slate500,
                ),
              ),
              Text(
                '${kClubStats.terminatedThisYear}',
                style: AppFonts.body(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w800,
                  color: AppColors.slate700,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _TrfBody extends StatelessWidget {
  final bool collapsed;
  const _TrfBody({required this.collapsed});

  @override
  Widget build(BuildContext context) {
    final d = _OverviewScope.of(context);
    final kClubStats = d.stats;
    final trfPct = d.trfPct;
    if (collapsed) {
      // Label says "TRF Raised" because the big value IS the raised amount —
      // previously titled "TRF Goal" while showing the raised figure (mismatch).
      return _CollapsedRow(
        title: 'TRF Raised',
        value: shortMoney(kClubStats.trfRaised, 'USD'),
        sub: d.hasTrfGoal
            ? '$trfPct% of ${shortMoney(kClubStats.trfGoal, 'USD')} goal'
            : 'raised this year',
        accent: AppColors.donutFillAmber,
      );
    }
    // Real fund breakdown from /overview (all INR). Bars are scaled relative to
    // the largest fund (no per-fund server goal exists); donor counts scale
    // relative to each other.
    final fundPeak = [
      d.trfAnnualFundInr,
      d.trfPolioFundInr,
      d.trfEndowmentInr,
    ].fold<num>(1, (m, v) => v > m ? v : m);
    final donorPeak = [
      kClubStats.trfMajorDonors,
      kClubStats.phfContributors,
    ].fold<num>(1, (m, v) => v > m ? v : m);
    final lines = <({String label, num value, num max, Color color, String display})>[
      (label: 'Annual Fund',      value: d.trfAnnualFundInr,         max: fundPeak,  color: AppColors.rotaryBlue,        display: shortMoney(d.trfAnnualFundInr, 'USD')),
      (label: 'Polio Fund',       value: d.trfPolioFundInr,          max: fundPeak,  color: AppColors.avenueNewGen,      display: shortMoney(d.trfPolioFundInr, 'USD')),
      (label: 'Endowment',        value: d.trfEndowmentInr,          max: fundPeak,  color: AppColors.avenueClubService, display: shortMoney(d.trfEndowmentInr, 'USD')),
      (label: 'Major Donors',     value: kClubStats.trfMajorDonors,  max: donorPeak, color: AppColors.avenuePublicImage, display: '${kClubStats.trfMajorDonors}'),
      (label: 'PHF Contributors', value: kClubStats.phfContributors, max: donorPeak, color: AppColors.avenueVocational,  display: '${kClubStats.phfContributors} members'),
    ];
    return Padding(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            'TRF Goal',
            style: AppFonts.body(
              fontSize: 14,
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary,
            ),
          ),
          Text(
            d.hasTrfGoal
                ? '${shortMoney(kClubStats.trfGoal, 'USD')} target this year'
                : 'Fund contributions this year',
            style: AppFonts.body(
              fontSize: 11,
              color: AppColors.slate500,
            ),
          ),
          const SizedBox(height: 12),
          // Donut-like progress chip — large pct + "raised" caption
          Center(
            child: Column(
              children: [
                Stack(
                  alignment: Alignment.center,
                  children: [
                    SizedBox(
                      width: 92,
                      height: 92,
                      child: CircularProgressIndicator(
                        value: trfPct / 100,
                        strokeWidth: 10,
                        backgroundColor: AppColors.warningLight,
                        valueColor: const AlwaysStoppedAnimation<Color>(
                          AppColors.donutFillAmber,
                        ),
                      ),
                    ),
                    Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          '$trfPct%',
                          style: AppFonts.body(
                            fontSize: 20,
                            fontWeight: FontWeight.w800,
                            color: AppColors.donutFillAmber,
                            fontFeatures: const [FontFeature.tabularFigures()],
                          ),
                        ),
                        Text(
                          'of goal',
                          style: AppFonts.body(
                            fontSize: 10,
                            color: AppColors.slate400,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  '${shortMoney(kClubStats.trfRaised, 'USD')} raised',
                  style: AppFonts.body(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          for (var i = 0; i < lines.length; i++) ...[
            _ProgressRow(
              label: lines[i].label,
              valueDisplay: lines[i].display,
              progress: (lines[i].value / lines[i].max).toDouble(),
              color: lines[i].color,
            ),
            if (i != lines.length - 1) const SizedBox(height: 8),
          ],
          const SizedBox(height: 10),
          Container(height: 1, color: AppColors.slate100),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Remaining to goal',
                style: AppFonts.body(
                  fontSize: 11.5,
                  color: AppColors.slate500,
                ),
              ),
              Text(
                d.hasTrfGoal
                    ? shortMoney(d.trfRemaining, 'USD')
                    : '–',
                style: AppFonts.body(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w800,
                  color: AppColors.error,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          const CurrencyLegend(),
        ],
      ),
    );
  }
}

class _AvenueBody extends StatelessWidget {
  final bool collapsed;
  const _AvenueBody({required this.collapsed});

  @override
  Widget build(BuildContext context) {
    final d = _OverviewScope.of(context);
    final kAvenue = d.avenues;
    final kClubStats = d.stats;
    if (collapsed) {
      return _CollapsedRow(
        title: 'Service Projects & Public Image',
        value: '${d.avenueTotalCompleted}',
        sub: '${kAvenue.length} avenues · ${kClubStats.serviceProjects} total',
        accent: AppColors.avenueVocational,
      );
    }
    return Padding(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            'Service Projects & Public Image',
            style: AppFonts.body(
              fontSize: 14,
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary,
            ),
          ),
          Text(
            'Project completion this RY',
            style: AppFonts.body(
              fontSize: 11,
              color: AppColors.slate500,
            ),
          ),
          const SizedBox(height: 12),
          if (kAvenue.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Text(
                'No projects recorded this year',
                style: AppFonts.body(
                  fontSize: 11.5,
                  color: AppColors.slate400,
                ),
              ),
            ),
          for (var i = 0; i < kAvenue.length; i++) ...[
            _ProgressRow(
              label: kAvenue[i].name,
              valueDisplay: '${kAvenue[i].completed}',
              progress: kAvenue[i].completed / kAvenue[i].target,
              color: Color(kAvenue[i].colorArgb),
            ),
            if (i != kAvenue.length - 1) const SizedBox(height: 10),
          ],
          const SizedBox(height: 10),
          Container(height: 1, color: AppColors.slate100),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Total projects',
                style: AppFonts.body(
                  fontSize: 11.5,
                  color: AppColors.slate500,
                ),
              ),
              Text(
                '${d.avenueTotalCompleted}',
                style: AppFonts.body(
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _CitationBody extends StatelessWidget {
  final bool collapsed;
  const _CitationBody({required this.collapsed});

  Color _statusColor(CitationStatus s) {
    switch (s) {
      case CitationStatus.done:       return AppColors.statusDone;
      case CitationStatus.partial:    return AppColors.statusPart;
      case CitationStatus.incomplete: return AppColors.statusNone;
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _OverviewScope.of(context);
    final kClubStats = d.stats;
    final kCitationChecklist = d.citation;
    final pct = d.citationPct;
    if (collapsed) {
      return _CollapsedRow(
        title: 'District Awards',
        value: '${kClubStats.districtCitationScore}',
        sub: '$pct% complete',
        accent: AppColors.donutFillRose,
      );
    }
    return Padding(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            'District Awards',
            style: AppFonts.body(
              fontSize: 14,
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary,
            ),
          ),
          Text(
            'RY ${d.yearLabel} scorecard',
            style: AppFonts.body(
              fontSize: 11,
              color: AppColors.slate500,
            ),
          ),
          const SizedBox(height: 12),
          Center(
            child: Stack(
              alignment: Alignment.center,
              children: [
                SizedBox(
                  width: 92,
                  height: 92,
                  child: CircularProgressIndicator(
                    value: pct / 100,
                    strokeWidth: 10,
                    backgroundColor: AppColors.slate100,
                    valueColor: const AlwaysStoppedAnimation<Color>(
                      AppColors.donutFillRose,
                    ),
                  ),
                ),
                Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      '${kClubStats.districtCitationScore}',
                      style: AppFonts.body(
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                        color: AppColors.donutFillRose,
                        fontFeatures: const [FontFeature.tabularFigures()],
                      ),
                    ),
                    Text(
                      'score',
                      style: AppFonts.body(
                        fontSize: 10,
                        color: AppColors.slate400,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          for (var i = 0; i < kCitationChecklist.length; i++) ...[
            _ProgressRow(
              label: kCitationChecklist[i].criterion,
              valueDisplay: '${kCitationChecklist[i].earned}',
              progress:
                  kCitationChecklist[i].earned / kCitationChecklist[i].points,
              color: _statusColor(kCitationChecklist[i].status),
            ),
            if (i != kCitationChecklist.length - 1) const SizedBox(height: 8),
          ],
          const SizedBox(height: 10),
          Container(height: 1, color: AppColors.slate100),
          const SizedBox(height: 8),
          const Row(
            children: [
              _LegendDot(color: AppColors.statusDone, label: 'Complete'),
              SizedBox(width: 10),
              _LegendDot(color: AppColors.statusPart, label: 'Partial'),
              SizedBox(width: 10),
              _LegendDot(color: AppColors.statusNone, label: 'Incomplete'),
            ],
          ),
        ],
      ),
    );
  }
}

class _LegendDot extends StatelessWidget {
  final Color color;
  final String label;
  const _LegendDot({required this.color, required this.label});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 4),
        Text(
          label,
          style: AppFonts.body(
            fontSize: 10.5,
            color: AppColors.slate500,
          ),
        ),
      ],
    );
  }
}

class _ProgressRow extends StatelessWidget {
  final String label;
  final String valueDisplay;
  final double progress;
  final Color color;
  const _ProgressRow({
    required this.label,
    required this.valueDisplay,
    required this.progress,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    final p = progress.isNaN ? 0.0 : progress.clamp(0.0, 1.0);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Expanded(
              child: Text(
                label,
                style: AppFonts.body(
                  fontSize: 11.5,
                  color: AppColors.slate500,
                ),
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const SizedBox(width: 6),
            Text(
              valueDisplay,
              style: AppFonts.body(
                fontSize: 11.5,
                fontWeight: FontWeight.w800,
                color: color,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
          ],
        ),
        const SizedBox(height: 4),
        ClipRRect(
          borderRadius: BorderRadius.circular(999),
          child: LinearProgressIndicator(
            value: p,
            minHeight: 6,
            backgroundColor: AppColors.slate100,
            valueColor: AlwaysStoppedAnimation<Color>(color),
          ),
        ),
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Chart-inside-active-card body
// ─────────────────────────────────────────────────────────────────────────

class _CardChart extends StatelessWidget {
  final _ActiveCard id;
  const _CardChart({required this.id});

  String get _title {
    switch (id) {
      case _ActiveCard.membership: return 'Membership: Growth Trend';
      case _ActiveCard.trf:        return 'TRF: Fund Breakdown';
      case _ActiveCard.avenue:     return 'Service Projects: By Avenue';
      case _ActiveCard.citation:   return 'District Awards: Per Criterion';
    }
  }

  String get _subtitle {
    switch (id) {
      case _ActiveCard.membership: return 'New joiners by month · Male / Female / Honorary';
      case _ActiveCard.trf:        return 'Contribution per fund';
      case _ActiveCard.avenue:     return 'Completed vs target';
      case _ActiveCard.citation:   return 'Earned points / max';
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            _title,
            style: AppFonts.body(
              fontSize: 13,
              fontWeight: FontWeight.w800,
              color: AppColors.textPrimary,
            ),
          ),
          Text(
            _subtitle,
            style: AppFonts.body(
              fontSize: 11,
              color: AppColors.slate500,
            ),
          ),
          const SizedBox(height: 12),
          _buildChartRows(_OverviewScope.of(context)),
        ],
      ),
    );
  }

  Widget _emptyChart(String text) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Text(
          text,
          style: AppFonts.body(
            fontSize: 11.5,
            color: AppColors.slate400,
          ),
        ),
      );

  Widget _buildChartRows(ClubAdminOverview d) {
    switch (id) {
      case _ActiveCard.membership:
        final growth = d.growth;
        if (growth.isEmpty) return _emptyChart('No monthly data');
        return MemberGrowthChart(growth: growth);
      case _ActiveCard.trf:
        // Real fund contributions (USD — TRF is served in USD), scaled relative
        // to the largest fund.
        final rows = <({String name, num value, Color color})>[
          (name: 'Annual Fund', value: d.trfAnnualFundInr, color: AppColors.rotaryBlue),
          (name: 'Polio Fund',  value: d.trfPolioFundInr,  color: AppColors.avenueNewGen),
          (name: 'Endowment',   value: d.trfEndowmentInr,  color: AppColors.avenueClubService),
        ];
        final peak = rows.map((r) => r.value).fold<num>(1, (a, b) => b > a ? b : a);
        return Column(
          children: [
            for (var i = 0; i < rows.length; i++) ...[
              _HorizBarRow(
                label: rows[i].name,
                value: shortMoney(rows[i].value, 'USD'),
                progress: (rows[i].value / peak).toDouble(),
                color: rows[i].color,
              ),
              if (i != rows.length - 1) const SizedBox(height: 8),
            ],
          ],
        );
      case _ActiveCard.avenue:
        final avenues = d.avenues;
        if (avenues.isEmpty) return _emptyChart('No projects recorded');
        final peak =
            avenues.map((a) => a.completed).fold<int>(1, (x, y) => y > x ? y : x);
        return Column(
          children: [
            for (var i = 0; i < avenues.length; i++) ...[
              _HorizBarRow(
                label: avenues[i].name,
                value: '${avenues[i].completed}',
                progress: avenues[i].completed / peak,
                color: Color(avenues[i].colorArgb),
              ),
              if (i != avenues.length - 1) const SizedBox(height: 8),
            ],
          ],
        );
      case _ActiveCard.citation:
        final items = d.citation;
        if (items.isEmpty) return _emptyChart('No awards criteria');
        Color color(CitationStatus s) {
          switch (s) {
            case CitationStatus.done:       return AppColors.statusDone;
            case CitationStatus.partial:    return AppColors.statusPart;
            case CitationStatus.incomplete: return AppColors.statusNone;
          }
        }
        return Column(
          children: [
            for (var i = 0; i < items.length; i++) ...[
              _HorizBarRow(
                label: items[i].criterion,
                value: '${items[i].earned}/${items[i].points}',
                progress: items[i].points == 0
                    ? 0
                    : items[i].earned / items[i].points,
                color: color(items[i].status),
              ),
              if (i != items.length - 1) const SizedBox(height: 8),
            ],
          ],
        );
    }
  }
}

class _HorizBarRow extends StatelessWidget {
  final String label;
  final String value;
  final double progress;
  final Color color;
  const _HorizBarRow({
    required this.label,
    required this.value,
    required this.progress,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                label,
                style: AppFonts.body(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                ),
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const SizedBox(width: 6),
            Text(
              value,
              style: AppFonts.body(
                fontSize: 12,
                fontWeight: FontWeight.w800,
                color: color,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
          ],
        ),
        const SizedBox(height: 4),
        ClipRRect(
          borderRadius: BorderRadius.circular(999),
          child: LinearProgressIndicator(
            value: progress.isNaN ? 0 : progress.clamp(0.0, 1.0),
            minHeight: 6,
            backgroundColor: AppColors.slate100,
            valueColor: AlwaysStoppedAnimation<Color>(color),
          ),
        ),
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 4. Upcoming events card
// ─────────────────────────────────────────────────────────────────────────

class _EventsCard extends StatelessWidget {
  const _EventsCard();

  static const _eventColors = <String, ({Color bg, Color text})>{
    'Meeting':  (bg: AppColors.muted, text: AppColors.accentBlue),
    'Service':  (bg: AppColors.errorTint, text: AppColors.errorDark),
    'TRF':      (bg: AppColors.background, text: AppColors.warningInk),
    'New Gen':  (bg: AppColors.background, text: AppColors.primaryPrime),
    'District': (bg: AppColors.muted, text: AppColors.slate700),
  };

  @override
  Widget build(BuildContext context) {
    final kClubEvents = _OverviewScope.of(context).events;
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.slate200),
      ),
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Upcoming Events',
            style: AppFonts.body(
              fontSize: 14,
              fontWeight: FontWeight.w800,
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(height: 10),
          if (kClubEvents.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 10),
              child: Text(
                'No upcoming events',
                style: AppFonts.body(
                  fontSize: 12,
                  color: AppColors.slate400,
                ),
              ),
            ),
          for (var i = 0; i < kClubEvents.length; i++)
            _EventRow(
              event: kClubEvents[i],
              isLast: i == kClubEvents.length - 1,
              palette:
                  _eventColors[kClubEvents[i].type] ?? _eventColors['District']!,
            ),
        ],
      ),
    );
  }
}

class _EventRow extends StatelessWidget {
  final ClubEvent event;
  final bool isLast;
  final ({Color bg, Color text}) palette;
  const _EventRow({
    required this.event,
    required this.isLast,
    required this.palette,
  });

  String get _day {
    final parts = event.date.split('-');
    if (parts.length != 3) return '?';
    return parts[2];
  }

  String get _month {
    final parts = event.date.split('-');
    if (parts.length != 3) return '';
    final m = int.tryParse(parts[1]);
    if (m == null || m < 1 || m > 12) return '';
    return const [
      'Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'
    ][m - 1];
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Column(
        children: [
          Row(
            children: [
              Container(
                width: 44,
                padding: const EdgeInsets.symmetric(vertical: 4),
                decoration: BoxDecoration(
                  color: AppColors.slate50,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      _month.toUpperCase(),
                      style: AppFonts.body(
                        fontSize: 9.5,
                        fontWeight: FontWeight.w800,
                        color: AppColors.slate400,
                      ),
                    ),
                    Text(
                      _day,
                      style: AppFonts.body(
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary,
                        height: 1.0,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      event.name,
                      style: AppFonts.body(
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    Text(
                      '${event.time} · ${event.venue}',
                      style: AppFonts.body(
                        fontSize: 11,
                        color: AppColors.slate400,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 6),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: palette.bg,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  event.type,
                  style: AppFonts.body(
                    fontSize: 10,
                    fontWeight: FontWeight.w800,
                    color: palette.text,
                  ),
                ),
              ),
            ],
          ),
          if (!isLast) ...[
            const SizedBox(height: 6),
            Container(height: 1, color: AppColors.slate100),
          ],
        ],
      ),
    );
  }
}
