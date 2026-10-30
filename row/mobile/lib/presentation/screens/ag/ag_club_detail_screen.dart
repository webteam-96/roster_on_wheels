import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import '../../../core/services/ag_dashboard_api.dart';
import '../../../core/theme/app_colors.dart';
import '../../../data/models/ag_dashboard_models.dart';
import 'widgets/ag_async.dart';
import 'widgets/ag_format.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// Per-club drill-down reached by tapping a club card in the "My Clubs" tab.
/// Wired to `GET /api/mobile/ag-dashboard/clubs/{clubId}` →
/// `AgClubDetail {summary, monthly, trf, recentProjects}`.
class AgClubDetailScreen extends StatefulWidget {
  final int clubId;
  const AgClubDetailScreen({super.key, required this.clubId});

  @override
  State<AgClubDetailScreen> createState() => _AgClubDetailScreenState();
}

class _AgClubDetailScreenState extends State<AgClubDetailScreen> {
  final AgDashboardApi _api = AgDashboardApi();
  late Future<AgClubDetail> _future;

  @override
  void initState() {
    super.initState();
    _future = _api.getClubDetail(widget.clubId);
  }

  void _reload() =>
      setState(() => _future = _api.getClubDetail(widget.clubId));

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
              color: AppColors.textPrimary),
          onPressed: () => context.pop(),
        ),
        title: Text(
          'Club details',
          style: AppFonts.body(
            fontWeight: FontWeight.w800,
            fontSize: 13,
            color: AppColors.textPrimary,
          ),
        ),
      ),
      body: FutureBuilder<AgClubDetail>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const AgLoading();
          }
          if (snap.hasError) {
            return AgError(error: snap.error!, onRetry: _reload);
          }
          final d = snap.data!;
          final s = d.summary;
          return SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(12, 14, 12, 32),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _HeaderCard(summary: s),
                const SizedBox(height: 12),
                _kpis(s),
                const SizedBox(height: 14),
                _TrfCard(trf: d.trf),
                const SizedBox(height: 14),
                _MonthlyCard(points: d.monthly),
                const SizedBox(height: 14),
                _RecentProjectsCard(projects: d.recentProjects),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _kpis(AgClubSummary s) {
    final cards = [
      _Kpi(label: 'Members', value: agFmtInt(s.members), icon: Icons.groups_rounded, accent: AppColors.rotaryBlue),
      _Kpi(label: 'Meetings', value: agFmtInt(s.meetings), icon: Icons.event_rounded, accent: AppColors.avenueNewGen),
      _Kpi(label: 'Projects', value: agFmtInt(s.totalProjects), icon: Icons.work_outline_rounded, accent: AppColors.avenueVocational),
      _Kpi(label: 'TRF (usd)', value: agFmtUsdShort(s.trfTotalInr), icon: Icons.emoji_events_rounded, accent: AppColors.avenuePublicImage),
      _Kpi(label: 'OCV', value: agFmtInt(s.ocv), icon: Icons.verified_outlined, accent: AppColors.avenueInternational),
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
        rows.add(Row(children: [
          Expanded(child: cards[i]),
          const SizedBox(width: 10),
          const Expanded(child: SizedBox()),
        ]));
      }
      if (i + 2 < cards.length) rows.add(const SizedBox(height: 10));
    }
    return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch, children: rows);
  }
}

class _HeaderCard extends StatelessWidget {
  final AgClubSummary summary;
  const _HeaderCard({required this.summary});

  @override
  Widget build(BuildContext context) {
    final pending = summary.nationalRankIsPending || summary.nationalRank == null;
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.slate200),
      ),
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            summary.clubName.isEmpty ? 'Club' : summary.clubName,
            style: AppFonts.body(
                fontSize: 16,
                fontWeight: FontWeight.w800,
                color: AppColors.textPrimary),
          ),
          const SizedBox(height: 6),
          Wrap(
            spacing: 8,
            runSpacing: 6,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: AppColors.slate100,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(pending ? Icons.schedule_rounded : Icons.military_tech_rounded,
                        size: 11, color: AppColors.slate500),
                    const SizedBox(width: 4),
                    Text(
                      pending
                          ? 'National Rank: Pending'
                          : '#${summary.nationalRank} nationally',
                      style: AppFonts.body(
                          fontSize: 13,
                          fontWeight: FontWeight.w800,
                          color: AppColors.slate500),
                    ),
                  ],
                ),
              ),
              if (summary.presidentName.isNotEmpty)
                Text('President: ${summary.presidentName}',
                    style: AppFonts.body(
                        fontSize: 13, color: AppColors.slate500)),
              if (summary.districtNumber.isNotEmpty)
                Text(summary.districtNumber,
                    style: AppFonts.body(
                        fontSize: 13, color: AppColors.slate500)),
            ],
          ),
        ],
      ),
    );
  }
}

class _Kpi extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;
  final Color accent;
  const _Kpi({
    required this.label,
    required this.value,
    required this.icon,
    required this.accent,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.slate200),
      ),
      padding: const EdgeInsets.fromLTRB(12, 11, 12, 11),
      child: Row(
        children: [
          Container(
            width: 32,
            height: 32,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: accent.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(9),
            ),
            child: Icon(icon, size: 16, color: accent),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(value,
                    style: AppFonts.body(
                        fontSize: 15,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary,
                        fontFeatures: const [FontFeature.tabularFigures()])),
                Text(label,
                    style: AppFonts.body(
                        fontSize: 13, color: AppColors.slate500)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionCard extends StatelessWidget {
  final String title;
  final Widget child;
  const _SectionCard({required this.title, required this.child});

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
          Text(title,
              style: AppFonts.body(
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary)),
          const SizedBox(height: 12),
          child,
        ],
      ),
    );
  }
}

class _TrfCard extends StatelessWidget {
  final AgTrfBreakdown trf;
  const _TrfCard({required this.trf});

  @override
  Widget build(BuildContext context) {
    Widget row(String label, double v) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 5),
          child: Row(
            children: [
              Expanded(
                  child: Text(label,
                      style: AppFonts.body(
                          fontSize: 13, color: AppColors.slate500))),
              Text(v == 0 ? '–' : agFmtUsd(v),
                  style: AppFonts.body(
                      fontSize: 13,
                      fontWeight: FontWeight.w800,
                      color: v == 0 ? AppColors.slate400 : AppColors.textPrimary)),
            ],
          ),
        );
    return _SectionCard(
      title: 'TRF Giving Breakdown',
      child: Column(
        children: [
          row('Annual Fund', trf.annualInr),
          const Divider(height: 1),
          row('PolioPlus', trf.polioInr),
          const Divider(height: 1),
          row('Endowment', trf.endowment),
          const Divider(height: 1),
          row('Other Funds', trf.others),
          const Divider(height: 8, thickness: 0),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: AppColors.rotaryBlue.withValues(alpha: 0.06),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Row(
              children: [
                Expanded(
                    child: Text('Total Giving',
                        style: AppFonts.body(
                            fontSize: 13,
                            fontWeight: FontWeight.w800,
                            color: AppColors.textPrimary))),
                Text(agFmtUsd(trf.totalInr),
                    style: AppFonts.body(
                        fontSize: 14,
                        fontWeight: FontWeight.w800,
                        color: AppColors.rotaryBlue)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _MonthlyCard extends StatelessWidget {
  final List<AgMonthlyPoint> points;
  const _MonthlyCard({required this.points});

  @override
  Widget build(BuildContext context) {
    if (points.isEmpty) {
      return const _SectionCard(
        title: 'Monthly Activity',
        child: _EmptyLine(text: 'No monthly data yet.'),
      );
    }
    final maxProjects = points.fold<int>(1, (m, p) => p.projects > m ? p.projects : m);
    final maxMeetings = points.fold<int>(1, (m, p) => p.meetings > m ? p.meetings : m);
    final scale = maxProjects > maxMeetings ? maxProjects : maxMeetings;
    return _SectionCard(
      title: 'Monthly Activity',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              _legend('Projects', AppColors.rotaryBlue),
              const SizedBox(width: 12),
              _legend('Meetings', AppColors.goldPrime),
            ],
          ),
          const SizedBox(height: 10),
          SizedBox(
            height: 120,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                for (final p in points)
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 2),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              _bar(p.projects / scale, AppColors.rotaryBlue),
                              const SizedBox(width: 2),
                              _bar(p.meetings / scale, AppColors.goldPrime),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Text(
                            _shortMonth(p.month),
                            style: AppFonts.body(
                                fontSize: 13, color: AppColors.slate400),
                            maxLines: 1,
                            overflow: TextOverflow.clip,
                          ),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  static String _shortMonth(String m) =>
      m.isEmpty ? '' : m.split(' ').first;

  Widget _bar(double frac, Color c) => Container(
        width: 7,
        height: (frac.clamp(0.0, 1.0)) * 96 + 2,
        decoration: BoxDecoration(
            color: c, borderRadius: BorderRadius.circular(3)),
      );

  Widget _legend(String label, Color c) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(width: 8, height: 8, decoration: BoxDecoration(color: c, shape: BoxShape.circle)),
          const SizedBox(width: 4),
          Text(label,
              style: AppFonts.body(
                  fontSize: 13, color: AppColors.slate500)),
        ],
      );
}

class _RecentProjectsCard extends StatelessWidget {
  final List<AgProjectRow> projects;
  const _RecentProjectsCard({required this.projects});

  @override
  Widget build(BuildContext context) {
    if (projects.isEmpty) {
      return const _SectionCard(
        title: 'Recent Projects',
        child: _EmptyLine(text: 'No projects yet.'),
      );
    }
    final shown = projects.take(12).toList();
    return _SectionCard(
      title: 'Recent Projects',
      child: Column(
        children: [
          for (var i = 0; i < shown.length; i++) ...[
            _row(shown[i]),
            if (i != shown.length - 1)
              const Divider(height: 16, thickness: 1),
          ],
        ],
      ),
    );
  }

  Widget _row(AgProjectRow p) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(p.title,
                  style: AppFonts.body(
                      fontSize: 13,
                      fontWeight: FontWeight.w800,
                      color: AppColors.textPrimary),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis),
              const SizedBox(height: 2),
              Text(
                agFmtDate(p.date),
                style: AppFonts.body(
                    fontSize: 13, color: AppColors.slate500),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
        const SizedBox(width: 8),
        Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(p.cost > 0 ? agFmtInrShort(p.cost) : '–',
                style: AppFonts.body(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: AppColors.rotaryBlue)),
            Text(
                p.manHoursIsPending
                    ? 'Pending'
                    : (p.beneficiaries > 0
                        ? '${agFmtInt(p.beneficiaries)} ben.'
                        : '–'),
                style: AppFonts.body(
                    fontSize: 13, color: AppColors.slate400)),
          ],
        ),
      ],
    );
  }
}

class _EmptyLine extends StatelessWidget {
  final String text;
  const _EmptyLine({required this.text});
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 16),
        child: Center(
          child: Text(text,
              style: AppFonts.body(
                  fontSize: 13, color: AppColors.slate400)),
        ),
      );
}
