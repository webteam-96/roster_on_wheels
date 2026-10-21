import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../../../core/services/ag_dashboard_api.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../data/models/ag_dashboard_models.dart';
import 'ag_async.dart';
import 'ag_format.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// "Membership" tab — wired to `GET /api/mobile/ag-dashboard/membership`.
///
/// Layout (mirrors the web Member Management page):
///   1. Header (title + AG/RY/as-of subtitle + LIVE chip + clubs·district badge)
///   2. "Membership Overview" card with 4 KPI cards
///   3. "Club-by-Club Comparison" (Members · Meetings · Projects bars)
///   4. "Club Activity at a Glance" (stacked Meetings + Projects)
///   5. "Members Distribution" donut + legend
///   6. "Club-wise Detail" sortable table (incl. GCs Wave-12A + District Rank)
///   7. Notes footnote
class AgMembershipTab extends StatefulWidget {
  final int? yearId;
  const AgMembershipTab({super.key, this.yearId});

  @override
  State<AgMembershipTab> createState() => _AgMembershipTabState();
}

enum _SortKey { name, members, meetings, projects, trf, gcs, rank }

enum _SortDir { asc, desc }

class _AgMembershipTabState extends State<AgMembershipTab>
    with AutomaticKeepAliveClientMixin<AgMembershipTab> {
  final AgDashboardApi _api = AgDashboardApi();
  late Future<AgMembershipResponse> _future;

  _SortKey _sortKey = _SortKey.members;
  _SortDir _sortDir = _SortDir.desc;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _future = _api.getMembership(yearId: widget.yearId);
  }

  @override
  void didUpdateWidget(covariant AgMembershipTab old) {
    super.didUpdateWidget(old);
    if (old.yearId != widget.yearId) {
      setState(() => _future = _api.getMembership(yearId: widget.yearId));
    }
  }

  void _reload() =>
      setState(() => _future = _api.getMembership(yearId: widget.yearId));

  void _toggleSort(_SortKey k) {
    setState(() {
      if (k == _sortKey) {
        _sortDir = _sortDir == _SortDir.asc ? _SortDir.desc : _SortDir.asc;
      } else {
        _sortKey = k;
        _sortDir = _SortDir.desc;
      }
    });
  }

  List<AgMembershipClubRow> _sortedClubs(List<AgMembershipClubRow> clubs) {
    int Function(AgMembershipClubRow a, AgMembershipClubRow b) compare;
    switch (_sortKey) {
      case _SortKey.name:
        compare = (a, b) => a.clubName.compareTo(b.clubName);
        break;
      case _SortKey.members:
        compare = (a, b) => a.members.compareTo(b.members);
        break;
      case _SortKey.meetings:
        compare = (a, b) => a.meetings.compareTo(b.meetings);
        break;
      case _SortKey.projects:
        compare = (a, b) => a.totalProjects.compareTo(b.totalProjects);
        break;
      case _SortKey.trf:
        compare = (a, b) => a.trf.compareTo(b.trf);
        break;
      case _SortKey.gcs:
        compare = (a, b) => a.goalsCitations.compareTo(b.goalsCitations);
        break;
      case _SortKey.rank:
        compare = (a, b) => a.projectRank.compareTo(b.projectRank);
        break;
    }
    final list = [...clubs]..sort(compare);
    if (_sortDir == _SortDir.desc) return list.reversed.toList();
    return list;
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return FutureBuilder<AgMembershipResponse>(
      future: _future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const AgLoading();
        }
        if (snap.hasError) {
          return AgError(error: snap.error!, onRetry: _reload);
        }
        final data = snap.data!;
        final clubs = data.clubs;
        final clubCount = math.max(1, clubs.length);

        return SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 32),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _Header(ag: data.ag, clubCount: clubs.length),
              const SizedBox(height: 14),
              _OverviewCard(data: data, clubCount: clubCount),
              const SizedBox(height: 14),
              _ComparisonCard(clubs: clubs),
              const SizedBox(height: 14),
              _ActivityCard(clubs: clubs),
              const SizedBox(height: 14),
              _DistributionDonut(clubs: clubs, totalMembers: data.totalMembers),
              const SizedBox(height: 14),
              _DetailTable(
                data: data,
                rows: _sortedClubs(clubs),
                sortKey: _sortKey,
                sortDir: _sortDir,
                onSort: _toggleSort,
              ),
              const SizedBox(height: 12),
              _Footnote(data: data),
            ],
          ),
        );
      },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 1. Header
// ─────────────────────────────────────────────────────────────────────────

class _Header extends StatelessWidget {
  final AgIdentity ag;
  final int clubCount;
  const _Header({required this.ag, required this.clubCount});

  @override
  Widget build(BuildContext context) {
    final agName = ag.name.isEmpty ? '–' : ag.name;
    final year = ag.yearLabel.isEmpty ? '–' : ag.yearLabel;
    final district = ag.districtNumber.isEmpty ? '–' : ag.districtNumber;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 36,
          height: 36,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: AppColors.rotaryBlue.withValues(alpha: 0.10),
            borderRadius: BorderRadius.circular(10),
          ),
          child: const Icon(
            Icons.trending_up_rounded,
            size: 18,
            color: AppColors.rotaryBlue,
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Flexible(
                    child: Text(
                      'Membership',
                      style: AppFonts.body(
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary,
                      ),
                    ),
                  ),
                  const SizedBox(width: 6),
                  const _LiveChip(),
                ],
              ),
              Text(
                'AG: $agName · RY $year · Data as of ${agToday()}',
                style: AppFonts.body(
                  fontSize: 11,
                  color: AppColors.slate500,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(width: 8),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
          decoration: BoxDecoration(
            color: AppColors.slate50,
            borderRadius: BorderRadius.circular(999),
            border: Border.all(color: AppColors.slate200),
          ),
          child: Text(
            '$clubCount club${clubCount == 1 ? "" : "s"} · $district',
            style: AppFonts.body(
              fontSize: 9.5,
              fontWeight: FontWeight.w700,
              color: AppColors.slate500,
            ),
          ),
        ),
      ],
    );
  }
}

class _LiveChip extends StatelessWidget {
  const _LiveChip();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: AppColors.slate100,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: AppColors.slate200),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: const BoxDecoration(
              color: AppColors.statusDone,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 4),
          Text(
            'LIVE',
            style: AppFonts.body(
              fontSize: 8.5,
              fontWeight: FontWeight.w800,
              color: AppColors.slate500,
              letterSpacing: 0.6,
            ),
          ),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 2. "Membership Overview" card — 4 KPI cards
// ─────────────────────────────────────────────────────────────────────────

class _OverviewCard extends StatelessWidget {
  final AgMembershipResponse data;
  final int clubCount;
  const _OverviewCard({required this.data, required this.clubCount});

  @override
  Widget build(BuildContext context) {
    final n = data.clubs.length;
    final avgMeetings = (data.totalMeetings / clubCount).toStringAsFixed(1);
    final avgProjects = (data.totalProjects / clubCount).toStringAsFixed(1);

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
            children: [
              const Icon(Icons.insights_rounded,
                  size: 15, color: AppColors.rotaryBlue),
              const SizedBox(width: 6),
              Text(
                'Membership Overview',
                style: AppFonts.body(
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                  color: AppColors.slate700,
                ),
              ),
            ],
          ),
          Text(
            'All $n club${n == 1 ? "" : "s"} · ${data.ag.districtNumber.isEmpty ? ": " : data.ag.districtNumber} · Year ${data.ag.yearLabel.isEmpty ? ": " : data.ag.yearLabel}',
            style: AppFonts.body(
              fontSize: 11,
              color: AppColors.slate400,
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: _KpiCard(
                  icon: Icons.groups_rounded,
                  title: 'Total Members',
                  value: agFmtInt(data.totalMembers),
                  subtitle: 'Across $n club${n == 1 ? "" : "s"}',
                  color: AppColors.rotaryBlue,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _KpiCard(
                  icon: Icons.menu_book_rounded,
                  title: 'Total Meetings',
                  value: agFmtInt(data.totalMeetings),
                  subtitle: 'Avg $avgMeetings / club',
                  color: AppColors.statusDone,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: _KpiCard(
                  icon: Icons.assignment_outlined,
                  title: 'Total Projects',
                  value: agFmtInt(data.totalProjects),
                  subtitle: 'Avg $avgProjects / club',
                  color: AppColors.avenueNewGen,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _KpiCard(
                  icon: Icons.public_rounded,
                  title: 'TRF Contributions',
                  value: agFmtInrShort(data.totalTrfInr),
                  subtitle: 'All TRF funds combined',
                  color: AppColors.goldPrime,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _KpiCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String value;
  final String subtitle;
  final Color color;
  const _KpiCard({
    required this.icon,
    required this.title,
    required this.value,
    required this.subtitle,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
      decoration: BoxDecoration(
        color: AppColors.slate50,
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
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(7),
                ),
                child: Icon(icon, size: 14, color: color),
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  title.toUpperCase(),
                  style: AppFonts.body(
                    fontSize: 9.5,
                    fontWeight: FontWeight.w800,
                    color: AppColors.slate500,
                    letterSpacing: 0.4,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            value,
            style: AppFonts.body(
              fontSize: 18,
              fontWeight: FontWeight.w800,
              color: AppColors.textPrimary,
              height: 1.0,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
          const SizedBox(height: 4),
          Text(
            subtitle,
            style: AppFonts.body(
              fontSize: 10,
              color: AppColors.slate400,
            ),
          ),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Shared card scaffold (title + subtitle + body/empty)
// ─────────────────────────────────────────────────────────────────────────

class _ChartCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final Widget child;
  const _ChartCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.child,
  });

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
          Row(
            children: [
              Icon(icon, size: 15, color: AppColors.rotaryBlue),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  title,
                  style: AppFonts.body(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: AppColors.slate700,
                  ),
                ),
              ),
            ],
          ),
          Text(
            subtitle,
            style: AppFonts.body(
              fontSize: 11,
              color: AppColors.slate400,
            ),
          ),
          const SizedBox(height: 12),
          child,
        ],
      ),
    );
  }
}

class _EmptyNote extends StatelessWidget {
  final String text;
  const _EmptyNote(this.text);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 22),
      child: Center(
        child: Text(
          text,
          style: AppFonts.body(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: AppColors.slate400,
          ),
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 3. Club-by-Club comparison — 3 metrics, horizontal bars
// ─────────────────────────────────────────────────────────────────────────

class _ComparisonCard extends StatelessWidget {
  final List<AgMembershipClubRow> clubs;
  const _ComparisonCard({required this.clubs});

  @override
  Widget build(BuildContext context) {
    return _ChartCard(
      icon: Icons.bar_chart_rounded,
      title: 'Club-by-Club Comparison',
      subtitle: 'Side-by-side activity across every club in the AG\'s scope',
      child: clubs.isEmpty
          ? const _EmptyNote('No clubs yet.')
          : _ComparisonBody(clubs: clubs),
    );
  }
}

class _ComparisonBody extends StatelessWidget {
  final List<AgMembershipClubRow> clubs;
  const _ComparisonBody({required this.clubs});

  @override
  Widget build(BuildContext context) {
    final maxMembers = clubs.map((c) => c.members).fold<int>(0, math.max);
    final maxMeetings = clubs.map((c) => c.meetings).fold<int>(0, math.max);
    final maxProjects =
        clubs.map((c) => c.totalProjects).fold<int>(0, math.max);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < clubs.length; i++) ...[
          Text(
            clubs[i].clubName,
            style: AppFonts.body(
              fontSize: 12,
              fontWeight: FontWeight.w800,
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(height: 4),
          _MetricBar(
            label: 'Members',
            value: clubs[i].members,
            max: maxMembers,
            color: AppColors.rotaryBlue,
          ),
          _MetricBar(
            label: 'Meetings',
            value: clubs[i].meetings,
            max: maxMeetings,
            color: AppColors.goldPrime,
          ),
          _MetricBar(
            label: 'Projects',
            value: clubs[i].totalProjects,
            max: maxProjects,
            color: AppColors.accentBlue,
          ),
          if (i != clubs.length - 1) const SizedBox(height: 10),
        ],
        const SizedBox(height: 8),
        const Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            _LegendDot(color: AppColors.rotaryBlue, label: 'Members'),
            SizedBox(width: 12),
            const _LegendDot(color: AppColors.goldPrime, label: 'Meetings'),
            SizedBox(width: 12),
            _LegendDot(color: AppColors.accentBlue, label: 'Projects'),
          ],
        ),
      ],
    );
  }
}

class _MetricBar extends StatelessWidget {
  final String label;
  final int value;
  final int max;
  final Color color;
  const _MetricBar({
    required this.label,
    required this.value,
    required this.max,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    final pct = max == 0 ? 0.0 : value / max;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          SizedBox(
            width: 64,
            child: Text(
              label,
              style: AppFonts.body(
                fontSize: 10.5,
                color: AppColors.slate500,
              ),
            ),
          ),
          Expanded(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(999),
              child: LinearProgressIndicator(
                value: pct,
                minHeight: 8,
                backgroundColor: AppColors.slate100,
                valueColor: AlwaysStoppedAnimation<Color>(color),
              ),
            ),
          ),
          const SizedBox(width: 8),
          SizedBox(
            width: 40,
            child: Text(
              agFmtInt(value),
              textAlign: TextAlign.right,
              style: AppFonts.body(
                fontSize: 11,
                fontWeight: FontWeight.w800,
                color: color,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
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
          width: 9,
          height: 9,
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

// ─────────────────────────────────────────────────────────────────────────
// 4. Club Activity at a Glance — stacked Meetings + Projects
// ─────────────────────────────────────────────────────────────────────────

class _ActivityCard extends StatelessWidget {
  final List<AgMembershipClubRow> clubs;
  const _ActivityCard({required this.clubs});

  @override
  Widget build(BuildContext context) {
    return _ChartCard(
      icon: Icons.stacked_bar_chart_rounded,
      title: 'Club Activity at a Glance',
      subtitle: 'A focused view comparing meetings and projects per club',
      child: clubs.isEmpty
          ? const _EmptyNote('No activity yet.')
          : _ActivityBody(clubs: clubs),
    );
  }
}

class _ActivityBody extends StatelessWidget {
  final List<AgMembershipClubRow> clubs;
  const _ActivityBody({required this.clubs});

  @override
  Widget build(BuildContext context) {
    final maxStack = clubs
        .map((c) => c.meetings + c.totalProjects)
        .fold<int>(0, math.max);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final c in clubs) ...[
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        c.clubName,
                        style: AppFonts.body(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w700,
                          color: AppColors.textPrimary,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    Text(
                      '${agFmtInt(c.meetings)} M · ${agFmtInt(c.totalProjects)} P',
                      style: AppFonts.body(
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                        color: AppColors.slate500,
                        fontFeatures: const [FontFeature.tabularFigures()],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                _StackedBar(
                  meetings: c.meetings,
                  projects: c.totalProjects,
                  max: maxStack,
                ),
              ],
            ),
          ),
        ],
        const SizedBox(height: 8),
        const Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const _LegendDot(color: AppColors.goldPrime, label: 'Meetings'),
            SizedBox(width: 12),
            _LegendDot(color: AppColors.statusDone, label: 'Projects'),
          ],
        ),
      ],
    );
  }
}

class _StackedBar extends StatelessWidget {
  final int meetings;
  final int projects;
  final int max;
  const _StackedBar({
    required this.meetings,
    required this.projects,
    required this.max,
  });

  @override
  Widget build(BuildContext context) {
    final total = meetings + projects;
    final mFlex = max == 0 ? 0 : ((meetings / max) * 1000).round();
    final pFlex = max == 0 ? 0 : ((projects / max) * 1000).round();
    final restFlex = max == 0 ? 1000 : (((max - total) / max) * 1000).round();
    return ClipRRect(
      borderRadius: BorderRadius.circular(999),
      child: SizedBox(
        height: 10,
        child: Row(
          children: [
            if (mFlex > 0)
              Expanded(
                flex: mFlex,
                child: const ColoredBox(color: AppColors.goldPrime),
              ),
            if (pFlex > 0)
              Expanded(
                flex: pFlex,
                child: const ColoredBox(color: AppColors.statusDone),
              ),
            Expanded(
              flex: restFlex < 0 ? 0 : restFlex,
              child: const ColoredBox(color: AppColors.slate100),
            ),
          ],
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 5. Members distribution donut
// ─────────────────────────────────────────────────────────────────────────

class _DistributionDonut extends StatelessWidget {
  final List<AgMembershipClubRow> clubs;
  final int totalMembers;
  const _DistributionDonut(
      {required this.clubs, required this.totalMembers});

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
          Row(
            children: [
              const Icon(Icons.pie_chart_outline_rounded,
                  size: 15, color: AppColors.rotaryBlue),
              const SizedBox(width: 6),
              Text(
                'Members Distribution',
                style: AppFonts.body(
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                  color: AppColors.slate700,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          if (clubs.isEmpty)
            const _EmptyNote('No clubs yet.')
          else
            Row(
              children: [
                SizedBox(
                  width: 130,
                  height: 130,
                  child: CustomPaint(
                    painter: _DonutPainter(
                      segments: [
                        for (var i = 0; i < clubs.length; i++)
                          (
                            value: clubs[i].members.toDouble(),
                            color: Color(agClubColor(i)),
                          ),
                      ],
                    ),
                    child: Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            agFmtInt(totalMembers),
                            style: AppFonts.body(
                              fontSize: 18,
                              fontWeight: FontWeight.w800,
                              color: AppColors.rotaryBlue,
                            ),
                          ),
                          Text(
                            'Members',
                            style: AppFonts.body(
                              fontSize: 10,
                              color: AppColors.slate500,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      for (var i = 0; i < clubs.length; i++)
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 3),
                          child: Row(
                            children: [
                              Container(
                                width: 10,
                                height: 10,
                                decoration: BoxDecoration(
                                  color: Color(agClubColor(i)),
                                  shape: BoxShape.circle,
                                ),
                              ),
                              const SizedBox(width: 6),
                              Expanded(
                                child: Text(
                                  clubs[i].clubName,
                                  style: AppFonts.body(
                                    fontSize: 11,
                                    color: AppColors.slate700,
                                  ),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              Text(
                                agFmtInt(clubs[i].members),
                                style: AppFonts.body(
                                  fontSize: 11,
                                  fontWeight: FontWeight.w800,
                                  color: AppColors.slate700,
                                  fontFeatures: const [
                                    FontFeature.tabularFigures()
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ),
        ],
      ),
    );
  }
}

class _DonutPainter extends CustomPainter {
  final List<({double value, Color color})> segments;
  const _DonutPainter({required this.segments});

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final outerR = size.width / 2 - 2;
    final innerR = outerR - 18;
    final total = segments.fold<double>(0, (s, e) => s + e.value);
    if (total <= 0) return;
    var start = -math.pi / 2;
    for (final seg in segments) {
      final sweep = (seg.value / total) * 2 * math.pi - 0.02;
      final path = Path()
        ..arcTo(
            Rect.fromCircle(center: center, radius: outerR), start, sweep, true)
        ..arcTo(Rect.fromCircle(center: center, radius: innerR),
            start + sweep, -sweep, false)
        ..close();
      canvas.drawPath(path, Paint()..color = seg.color);
      start += sweep + 0.02;
    }
  }

  @override
  bool shouldRepaint(covariant _DonutPainter old) => old.segments != segments;
}

// ─────────────────────────────────────────────────────────────────────────
// 6. Detail table (sortable)
// ─────────────────────────────────────────────────────────────────────────

class _DetailTable extends StatelessWidget {
  final AgMembershipResponse data;
  final List<AgMembershipClubRow> rows;
  final _SortKey sortKey;
  final _SortDir sortDir;
  final ValueChanged<_SortKey> onSort;
  const _DetailTable({
    required this.data,
    required this.rows,
    required this.sortKey,
    required this.sortDir,
    required this.onSort,
  });

  @override
  Widget build(BuildContext context) {
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
          Container(
            padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
            decoration: const BoxDecoration(
              border: Border(bottom: BorderSide(color: AppColors.slate100)),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    'Club-wise Detail',
                    style: AppFonts.body(
                      fontSize: 13,
                      fontWeight: FontWeight.w800,
                      color: AppColors.slate700,
                    ),
                  ),
                ),
                Text(
                  '${rows.length} club${rows.length == 1 ? "" : "s"} · tap chip to sort',
                  style: AppFonts.body(
                    fontSize: 10,
                    color: AppColors.slate400,
                  ),
                ),
              ],
            ),
          ),
          // Sort chips (CLUB NAME, MEMBERS, MEETINGS, PROJECTS, TRF, GCs, RANK)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            color: AppColors.slate50,
            child: Wrap(
              spacing: 4,
              runSpacing: 4,
              children: [
                for (final pair in const [
                  (_SortKey.name, 'Club Name'),
                  (_SortKey.members, 'Members'),
                  (_SortKey.meetings, 'Meetings'),
                  (_SortKey.projects, 'Projects'),
                  (_SortKey.trf, 'TRF (INR)'),
                  (_SortKey.gcs, 'GCs'),
                  (_SortKey.rank, 'District Rank'),
                ])
                  _SortChip(
                    label: pair.$2,
                    isActive: pair.$1 == sortKey,
                    direction: pair.$1 == sortKey ? sortDir : null,
                    onTap: () => onSort(pair.$1),
                  ),
              ],
            ),
          ),
          if (rows.isEmpty)
            const _EmptyNote('No clubs to show.')
          else ...[
            for (var i = 0; i < rows.length; i++)
              _ClubRow(
                club: rows[i],
                index: i,
                totalClubsInDistrict: data.totalClubsInDistrict,
              ),
            // AG total footer row
            Container(
              padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
              decoration: BoxDecoration(
                color: AppColors.rotaryBlue.withValues(alpha: 0.05),
                border: Border(
                  top: BorderSide(
                    color: AppColors.rotaryBlue.withValues(alpha: 0.3),
                    width: 1.5,
                  ),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    'AG TOTAL (${rows.length} CLUB${rows.length == 1 ? "" : "S"})',
                    style: AppFonts.body(
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                      color: AppColors.rotaryBlue,
                      letterSpacing: 0.5,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 14,
                    runSpacing: 4,
                    children: [
                      _StatChip(label: 'Members', value: agFmtInt(data.totalMembers)),
                      _StatChip(label: 'Meetings', value: agFmtInt(data.totalMeetings)),
                      _StatChip(label: 'Projects', value: agFmtInt(data.totalProjects)),
                      _StatChip(label: 'TRF (INR)', value: agFmtInr(data.totalTrfInr)),
                      _StatChip(label: 'OCV', value: agFmtInt(data.totalOcv)),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _SortChip extends StatelessWidget {
  final String label;
  final bool isActive;
  final _SortDir? direction;
  final VoidCallback onTap;
  const _SortChip({
    required this.label,
    required this.isActive,
    required this.direction,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: isActive ? AppColors.rotaryBlue : Colors.white,
      borderRadius: BorderRadius.circular(7),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(7),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(7),
            border: Border.all(
              color: isActive ? AppColors.rotaryBlue : AppColors.slate200,
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                label,
                style: AppFonts.body(
                  fontSize: 10.5,
                  fontWeight: FontWeight.w800,
                  color: isActive ? Colors.white : AppColors.slate500,
                ),
              ),
              if (isActive) ...[
                const SizedBox(width: 3),
                Icon(
                  direction == _SortDir.asc
                      ? Icons.arrow_upward_rounded
                      : Icons.arrow_downward_rounded,
                  size: 11,
                  color: Colors.white,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _ClubRow extends StatelessWidget {
  final AgMembershipClubRow club;
  final int index;
  final int totalClubsInDistrict;
  const _ClubRow({
    required this.club,
    required this.index,
    required this.totalClubsInDistrict,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: AppColors.slate100)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(
                  color: Color(agClubColor(index)),
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  club.clubName,
                  style: AppFonts.body(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary,
                  ),
                ),
              ),
              _RankBadge(
                rank: club.projectRank,
                totalClubsInDistrict: totalClubsInDistrict,
              ),
            ],
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 14,
            runSpacing: 4,
            children: [
              _StatChip(label: 'Members', value: agFmtInt(club.members)),
              _StatChip(label: 'Meetings', value: agFmtInt(club.meetings)),
              _StatChip(label: 'Projects', value: agFmtInt(club.totalProjects)),
              _StatChip(label: 'TRF (INR)', value: agFmtInr(club.trf)),
              _GcsChip(value: club.goalsCitations),
            ],
          ),
        ],
      ),
    );
  }
}

/// District rank — "#N / total" when ranked, else grey "Pending" chip.
class _RankBadge extends StatelessWidget {
  final int rank;
  final int totalClubsInDistrict;
  const _RankBadge({required this.rank, required this.totalClubsInDistrict});

  @override
  Widget build(BuildContext context) {
    if (rank <= 0) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: AppColors.slate100,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: AppColors.slate200),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.schedule_rounded,
                size: 10, color: AppColors.slate500),
            const SizedBox(width: 3),
            Text(
              'Pending',
              style: AppFonts.body(
                fontSize: 9.5,
                fontWeight: FontWeight.w800,
                color: AppColors.slate500,
              ),
            ),
          ],
        ),
      );
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: AppColors.rotaryBlue.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: AppColors.rotaryBlue.withValues(alpha: 0.25)),
      ),
      child: Text(
        '#$rank / ${totalClubsInDistrict > 0 ? totalClubsInDistrict : ": "}',
        style: AppFonts.body(
          fontSize: 9.5,
          fontWeight: FontWeight.w800,
          color: AppColors.rotaryBlue,
          fontFeatures: const [FontFeature.tabularFigures()],
        ),
      ),
    );
  }
}

/// GCs — Wave-12A goals/citations earned, with an award icon.
class _GcsChip extends StatelessWidget {
  final int value;
  const _GcsChip({required this.value});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(Icons.emoji_events_rounded,
            size: 11, color: AppColors.goldPrime),
        const SizedBox(width: 3),
        Text(
          'GCs ',
          style: AppFonts.body(
            fontSize: 10,
            color: AppColors.slate400,
          ),
        ),
        Text(
          agFmtInt(value),
          style: AppFonts.body(
            fontSize: 11.5,
            fontWeight: FontWeight.w800,
            color: AppColors.textPrimary,
            fontFeatures: const [FontFeature.tabularFigures()],
          ),
        ),
      ],
    );
  }
}

class _StatChip extends StatelessWidget {
  final String label;
  final String value;
  const _StatChip({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          '$label ',
          style: AppFonts.body(
            fontSize: 10,
            color: AppColors.slate400,
          ),
        ),
        Text(
          value,
          style: AppFonts.body(
            fontSize: 11.5,
            fontWeight: FontWeight.w800,
            color: AppColors.textPrimary,
            fontFeatures: const [FontFeature.tabularFigures()],
          ),
        ),
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 7. Footnote
// ─────────────────────────────────────────────────────────────────────────

class _Footnote extends StatelessWidget {
  final AgMembershipResponse data;
  const _Footnote({required this.data});

  @override
  Widget build(BuildContext context) {
    final district =
        data.ag.districtNumber.isEmpty ? '–' : data.ag.districtNumber;
    final inDistrict = data.totalClubsInDistrict;
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
      decoration: BoxDecoration(
        color: AppColors.slate50,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.slate200),
      ),
      child: Text(
        'Notes: Members = active members in club_members · '
        'Meetings = club_attendance rows in this year · '
        'GCs = goals/citations earned (district_citation_club_entry, points > 0) · '
        'District rank based on total projects among $inDistrict clubs in $district.',
        style: AppFonts.body(
          fontSize: 10.5,
          color: AppColors.slate500,
          height: 1.4,
        ),
      ),
    );
  }
}
