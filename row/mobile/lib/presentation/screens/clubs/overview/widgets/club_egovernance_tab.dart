import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../../../../core/features/feature_controller.dart';
import '../../../../../core/services/club_admin_dashboard_api.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../data/models/club_admin_dashboard_models.dart';
import '../../../districts/overview/widgets/stat_card.dart';
import '../../../../widgets/common/dashboard_refresh.dart';
import 'club_dashboard_async.dart';
import 'cmr_month_report_subtab.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// "E-Governance" tab on the Club Overview screen. Shows the live
/// `egovernance` analytics (Monthly-Report + Attendance summaries) plus an
/// **E-Governance Modules** grid that opens the existing full-CRUD module
/// screens (Club Monthly Report, OCV/GOV, Attendance, District Awards,
/// Reports) via their go_router routes — mirroring the web's five sub-tabs.
class ClubEgovernanceTab extends StatefulWidget {
  final int clubId;
  final int? yearId;
  const ClubEgovernanceTab({super.key, required this.clubId, this.yearId});

  @override
  State<ClubEgovernanceTab> createState() => _ClubEgovernanceTabState();
}

class _ClubEgovernanceTabState extends State<ClubEgovernanceTab>
    with AutomaticKeepAliveClientMixin<ClubEgovernanceTab> {
  final ClubAdminDashboardApi _api = ClubAdminDashboardApi();
  // E-Governance data + the Overview (for the TRF / District-Citation KPI cards,
  // which the egovernance endpoint doesn't carry). Overview is best-effort —
  // those two cards fall back to "—" if it fails.
  late Future<(ClubAdminEGovernance, ClubAdminOverview?)> _future;
  String _active = 'monthly';

  static const _tabs = <({String id, String label})>[
    (id: 'monthly', label: 'Monthly Report'),
    (id: 'attendance', label: 'Attendance'),
  ];

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<(ClubAdminEGovernance, ClubAdminOverview?)> _load() async {
    final egovFuture = _api.getEGovernance(widget.clubId, yearId: widget.yearId);
    final overviewFuture = _api
        .getOverview(widget.clubId, yearId: widget.yearId)
        .then<ClubAdminOverview?>((o) => o, onError: (_) => null);
    return (await egovFuture, await overviewFuture);
  }

  void _reload() => setState(() => _future = _load());

  /// Pull-to-refresh: fetch first, then swap so content doesn't flash a loader.
  Future<void> _refresh() async {
    final f = _load();
    await f.then((_) {}, onError: (_) {});
    if (!mounted) return;
    setState(() => _future = f);
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return FutureBuilder<(ClubAdminEGovernance, ClubAdminOverview?)>(
      future: _future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const ClubDashboardLoading();
        }
        if (snap.hasError) {
          return ClubDashboardError(error: snap.error!, onRetry: _reload);
        }
        final (data, overview) = snap.data!;
        return DashboardRefresh(
          onRefresh: _refresh,
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 32),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _EgovKpiStrip(data: data, overview: overview),
              const SizedBox(height: 14),
              _EgovManagementGrid(clubId: widget.clubId),
              const SizedBox(height: 14),
              Container(
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: AppColors.slate200),
                ),
                padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      'E-Governance & Reporting',
                      style: AppFonts.body(
                        fontSize: 14,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary,
                      ),
                    ),
                    Text(
                      [
                        if (data.clubName.isNotEmpty) data.clubName,
                        if (data.yearLabel.isNotEmpty) 'RY ${data.yearLabel}',
                      ].join(' · '),
                      style: AppFonts.body(
                        fontSize: 13,
                        color: AppColors.slate500,
                      ),
                    ),
                    const SizedBox(height: 10),
                    _PillTabBar(
                      active: _active,
                      tabs: _tabs,
                      onSelect: (id) => setState(() => _active = id),
                    ),
                    const SizedBox(height: 12),
                    if (_active == 'monthly')
                      CmrMonthReportSubtab(
                          clubId: widget.clubId, yearId: widget.yearId)
                    else
                      _AttendanceSubTab(data: data),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// E-Governance Modules grid (gateways to the full-CRUD module screens)
// ─────────────────────────────────────────────────────────────────────────

class _EgovManagementGrid extends StatelessWidget {
  final int clubId;
  const _EgovManagementGrid({required this.clubId});

  static const _tiles =
      <({String label, IconData icon, int color, String route})>[
    (label: 'Club Monthly Report', icon: Icons.event_note_outlined, color: 0xFF9333EA, route: 'club-monthly-report'),
    (label: 'OCV / gov', icon: Icons.folder_copy_outlined, color: 0xFF1C5BAE, route: 'ocv-gov'),
    (label: 'Attendance', icon: Icons.how_to_reg_outlined, color: 0xFF0D9488, route: 'attendance'),
    (label: 'District Awards', icon: Icons.workspace_premium_outlined, color: 0xFFE97A10, route: 'citation'),
    (label: 'Reports', icon: Icons.assessment_outlined, color: 0xFF16A34A, route: 'reports'),
    (label: 'Rotary Network', icon: Icons.hub_outlined, color: 0xFF4F46E5, route: 'rotary-network'),
    (label: 'Targets', icon: Icons.flag_outlined, color: 0xFF0F766E, route: 'targets'),
    (label: 'Grants', icon: Icons.savings_outlined, color: 0xFF1C5BAE, route: 'grants'),
    (label: 'Speakers', icon: Icons.record_voice_over_outlined, color: 0xFF9333EA, route: 'speakers'),
  ];

  /// Tiles whose app path differs from the admin's, so the switch is checked by key.
  static const _tileFeature = {'targets': 'target_dashboard', 'grants': 'grants'};

  @override
  Widget build(BuildContext context) {
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
          Text('E-Governance Modules',
              style: AppFonts.body(
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary)),
          Text('Manage reports, documents, attendance & awards',
              style: AppFonts.body(
                  fontSize: 13, color: AppColors.slate500)),
          const SizedBox(height: 12),
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            crossAxisSpacing: 10,
            mainAxisSpacing: 10,
            childAspectRatio: 1.5,
            children: [
              // ROW module switches (FeatureController): skipped or switched-off modules lose their tile
              for (final t in _tiles.where((t) =>
                  !context.watch<FeatureController>().isPathOff('/clubs/$clubId/${t.route}') &&
                  context.watch<FeatureController>().isOn(_tileFeature[t.route] ?? '')))
                _EgovTile(
                  label: t.label,
                  icon: t.icon,
                  color: Color(t.color),
                  onTap: () => context.push('/clubs/$clubId/${t.route}'),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _EgovTile extends StatelessWidget {
  final String label;
  final IconData icon;
  final Color color;
  final VoidCallback onTap;
  const _EgovTile({
    required this.label,
    required this.icon,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.slate50,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.slate200),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.12),
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, color: color, size: 20),
              ),
              const SizedBox(height: 8),
              Text(label,
                  textAlign: TextAlign.center,
                  style: AppFonts.body(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: AppColors.textPrimary),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis),
            ],
          ),
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// KPI strip — 2 cards
// ─────────────────────────────────────────────────────────────────────────

class _EgovKpiStrip extends StatelessWidget {
  final ClubAdminEGovernance data;
  final ClubAdminOverview? overview;
  const _EgovKpiStrip({required this.data, required this.overview});

  // TRF is served in USD (backend USD_INR = 1). Short USD, mirrors web
  // `fmtUsdShort`.
  static String _fmtUsd(double v) {
    if (v >= 1000000) return '\$${(v / 1000000).toStringAsFixed(1)}M';
    if (v >= 1000) return '\$${(v / 1000).toStringAsFixed(1)}K';
    return '\$${v.round()}';
  }

  @override
  Widget build(BuildContext context) {
    final o = overview;
    final trf = o != null ? _fmtUsd(o.trfRaisedInr) : '–';
    final citation = o != null ? '${o.districtCitationScore.round()}' : '–';
    final ry = data.yearLabel.isEmpty ? 'This year' : 'RY ${data.yearLabel}';
    // CMR card turns green at >=80% submission, else gold — at-a-glance health.
    final cmrColor =
        data.cmrPct >= 80 ? AppColors.success : AppColors.rotaryGold;
    // 5 KPI cards (web parity): CMR · Avg Attendance · TRF · District Awards ·
    // Documents. Documents has no egovernance source (web renders "—" too).
    final cards = <Widget>[
      StatCard(
        label: 'CMR Submission',
        value: '${data.cmrSubmitted}/${data.cmrTotal}',
        sub: '${data.cmrPct}% submitted',
        accent: cmrColor,
      ),
      StatCard(
        label: 'Avg Attendance',
        value: '${data.avgAttendance.round()}%',
        sub: 'Across meetings',
        accent: AppColors.avenueClubService,
      ),
      StatCard(
        label: 'TRF Raised',
        value: trf,
        sub: ry,
        accent: AppColors.avenueVocational,
      ),
      StatCard(
        label: 'District Awards',
        value: citation,
        sub: 'Earned this RY',
        accent: AppColors.avenuePublicImage,
      ),
      const StatCard(
        label: 'Documents',
        value: '–',
        sub: 'Repository items',
        accent: AppColors.avenueInternational,
      ),
    ];
    final rows = <Widget>[];
    for (var i = 0; i < cards.length; i += 2) {
      if (i + 1 < cards.length) {
        rows.add(Row(children: [
          Expanded(child: cards[i]),
          const SizedBox(width: 10),
          Expanded(child: cards[i + 1]),
        ]));
      } else {
        rows.add(cards[i]);
      }
      if (i + 2 < cards.length) rows.add(const SizedBox(height: 10));
    }
    return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch, children: rows);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Pill tab bar (horizontal scroll)
// ─────────────────────────────────────────────────────────────────────────

class _PillTabBar extends StatelessWidget {
  final String active;
  final List<({String id, String label})> tabs;
  final ValueChanged<String> onSelect;
  const _PillTabBar({
    required this.active,
    required this.tabs,
    required this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          for (final t in tabs)
            Padding(
              padding: const EdgeInsets.only(right: 4),
              child: Material(
                color:
                    active == t.id ? AppColors.goldPrime : AppColors.slate100,
                borderRadius: BorderRadius.circular(8),
                child: InkWell(
                  onTap: () => onSelect(t.id),
                  borderRadius: BorderRadius.circular(8),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 12, vertical: 8),
                    child: Text(
                      t.label,
                      style: AppFonts.body(
                        fontSize: 13,
                        fontWeight: active == t.id
                            ? FontWeight.w800
                            : FontWeight.w600,
                        color: active == t.id
                            ? AppColors.primaryDeep
                            : AppColors.slate500,
                      ),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}


// ═════════════════════════════════════════════════════════════════════════
// 2. Attendance sub-tab
// ═════════════════════════════════════════════════════════════════════════

class _AttendanceSubTab extends StatelessWidget {
  final ClubAdminEGovernance data;
  const _AttendanceSubTab({required this.data});

  Color _pctColor(int p) {
    if (p >= 75) return AppColors.statusDone;
    if (p >= 65) return AppColors.statusPart;
    return AppColors.statusNone;
  }

  Widget _attLegend(Color c, String t) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(color: c, shape: BoxShape.circle)),
          const SizedBox(width: 4),
          Text(t,
              style: AppFonts.body(
                  fontSize: 13, color: AppColors.slate500)),
        ],
      );

  ({Color bg, Color fg, String label}) _pctBadge(int p) {
    if (p >= 75) {
      return (
        bg: AppColors.successTint,
        fg: AppColors.statusDone,
        label: 'Good'
      );
    }
    if (p >= 65) {
      return (
        bg: AppColors.background,
        fg: AppColors.statusPart,
        label: 'Average'
      );
    }
    return (
      bg: AppColors.errorTint,
      fg: AppColors.statusNone,
      label: 'Low'
    );
  }

  @override
  Widget build(BuildContext context) {
    final meetings = data.meetings;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Meeting Attendance Register',
          style: AppFonts.body(
            fontSize: 13.5,
            fontWeight: FontWeight.w800,
            color: AppColors.textPrimary,
          ),
        ),
        Text(
          'Per-session attendance records',
          style: AppFonts.body(
            fontSize: 13,
            color: AppColors.slate400,
          ),
        ),
        const SizedBox(height: 10),
        Wrap(
          spacing: 12,
          runSpacing: 6,
          children: [
            _attLegend(AppColors.statusDone, 'Good ≥75%'),
            _attLegend(AppColors.statusPart, 'Average 65–74%'),
            _attLegend(AppColors.statusNone, 'Low <65%'),
          ],
        ),
        const SizedBox(height: 12),
        if (meetings.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Text(
              'No meetings recorded',
              style: AppFonts.body(
                fontSize: 13,
                color: AppColors.slate400,
              ),
            ),
          )
        else ...[
          for (var i = 0; i < meetings.length; i++) ...[
            _AttendanceRow(
              meeting: meetings[i],
              index: i,
              color: _pctColor(meetings[i].pct),
              badge: _pctBadge(meetings[i].pct),
            ),
            if (i != meetings.length - 1) const SizedBox(height: 8),
          ],
          const SizedBox(height: 8),
          Text(
            '${meetings.length} sessions recorded',
            style: AppFonts.body(
              fontSize: 13,
              color: AppColors.slate400,
            ),
          ),
        ],
      ],
    );
  }
}

class _AttendanceRow extends StatelessWidget {
  final EgovMeetingRow meeting;
  final int index;
  final Color color;
  final ({Color bg, Color fg, String label}) badge;
  const _AttendanceRow({
    required this.meeting,
    required this.index,
    required this.color,
    required this.badge,
  });

  @override
  Widget build(BuildContext context) {
    final topic = meeting.topic.isEmpty ? 'Meeting' : meeting.topic;
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.slate200),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              SizedBox(
                width: 22,
                child: Text(
                  '${index + 1}',
                  style: AppFonts.body(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: AppColors.slate400,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
              ),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      topic,
                      style: AppFonts.body(
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary,
                      ),
                    ),
                    if (meeting.date.isNotEmpty)
                      Text(
                        meeting.date,
                        style: AppFonts.body(
                          fontSize: 13,
                          color: AppColors.slate400,
                        ),
                      ),
                  ],
                ),
              ),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: badge.bg,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  badge.label,
                  style: AppFonts.body(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: badge.fg,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Text(
                '${meeting.present}/${meeting.total}',
                style: AppFonts.body(
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                  color: AppColors.slate700,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(999),
                  child: LinearProgressIndicator(
                    value: meeting.pct / 100,
                    minHeight: 6,
                    backgroundColor: AppColors.slate100,
                    valueColor: AlwaysStoppedAnimation<Color>(color),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Text(
                '${meeting.pct}%',
                style: AppFonts.body(
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                  color: color,
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
