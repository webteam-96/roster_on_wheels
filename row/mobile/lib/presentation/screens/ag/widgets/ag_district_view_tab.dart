import 'dart:math' as math;

import 'package:flutter/material.dart';
import '../../../../core/services/ag_dashboard_api.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../data/models/ag_dashboard_models.dart';
import 'ag_async.dart';
import 'ag_format.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// "District View" tab — Club Performance Comparison. Wired to
/// `GET /api/mobile/ag-dashboard/district`.
///
/// Layout:
///   1. Header ("Club Performance Comparison" + AG / District / RY subtitle)
///   2. Leaderboards (4 cards: Top TRF / Most Projects / Largest / Most Active)
///      driven by clubs[]
///   3. Head-to-Head comparison (sortable table) driven by headToHeadTable[];
///      DCK column (Wave-12A) and an always-"Pending" National Rank chip
///   4. Club metrics at a glance (Members / Projects / TRF / Meetings bars)
///      driven by metricBars maps
///   5. Multi-metric radar (Members / Projects / TRF / Goals, normalised 0-100)
///      driven by radar[]
///   6. AG group combined totals (blue gradient banner)
class AgDistrictViewTab extends StatefulWidget {
  final int? yearId;
  const AgDistrictViewTab({super.key, this.yearId});

  @override
  State<AgDistrictViewTab> createState() => _AgDistrictViewTabState();
}

class _AgDistrictViewTabState extends State<AgDistrictViewTab>
    with AutomaticKeepAliveClientMixin<AgDistrictViewTab> {
  final AgDashboardApi _api = AgDashboardApi();
  late Future<AgDistrictResponse> _future;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _future = _api.getDistrict(yearId: widget.yearId);
  }

  @override
  void didUpdateWidget(covariant AgDistrictViewTab old) {
    super.didUpdateWidget(old);
    if (old.yearId != widget.yearId) {
      setState(() => _future = _api.getDistrict(yearId: widget.yearId));
    }
  }

  void _reload() =>
      setState(() => _future = _api.getDistrict(yearId: widget.yearId));

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return FutureBuilder<AgDistrictResponse>(
      future: _future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const AgLoading();
        }
        if (snap.hasError) {
          return AgError(error: snap.error!, onRetry: _reload);
        }
        final data = snap.data!;
        return SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 32),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _Header(data: data),
              const SizedBox(height: 14),
              _LeaderboardsSection(clubs: data.clubs),
              const SizedBox(height: 14),
              _ComparisonSection(rows: data.headToHeadTable),
              const SizedBox(height: 14),
              _ChartsSection(bars: data.metricBars),
              const SizedBox(height: 14),
              _RadarSection(points: data.radar),
              const SizedBox(height: 14),
              _TotalsBanner(data: data),
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
  final AgDistrictResponse data;
  const _Header({required this.data});

  @override
  Widget build(BuildContext context) {
    final name = data.ag.name.isEmpty ? '–' : data.ag.name;
    final district =
        data.ag.districtNumber.isEmpty ? '–' : data.ag.districtNumber;
    final year = data.ag.yearLabel.isEmpty ? '–' : data.ag.yearLabel;
    final n = data.clubs.length;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Club Performance Comparison',
          style: AppFonts.body(
            fontSize: 18,
            fontWeight: FontWeight.w800,
            color: AppColors.rotaryBlue,
          ),
        ),
        Text(
          'How your $n club${n == 1 ? "" : "s"} compare across key metrics',
          style: AppFonts.body(
            fontSize: 12,
            color: AppColors.slate500,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          'AG: $name · $district · RY $year',
          style: AppFonts.body(
            fontSize: 10.5,
            color: AppColors.slate400,
          ),
        ),
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 2. Leaderboards section — 4 cards
// ─────────────────────────────────────────────────────────────────────────

class _LeaderboardsSection extends StatelessWidget {
  final List<AgDistrictClubRow> clubs;
  const _LeaderboardsSection({required this.clubs});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'LEADERBOARDS',
          style: AppFonts.body(
            fontSize: 10,
            fontWeight: FontWeight.w800,
            color: AppColors.slate500,
            letterSpacing: 0.7,
          ),
        ),
        const SizedBox(height: 8),
        _LeaderCard(
          clubs: clubs,
          icon: Icons.star_rounded,
          title: 'Top TRF Giving',
          accessor: (c) => c.trfTotalInr,
          formatter: agFmtUsd,
        ),
        const SizedBox(height: 10),
        _LeaderCard(
          clubs: clubs,
          icon: Icons.work_outline_rounded,
          title: 'Most Projects',
          accessor: (c) => c.totalProjects.toDouble(),
          formatter: (v) => '${v.round()} projects',
        ),
        const SizedBox(height: 10),
        _LeaderCard(
          clubs: clubs,
          icon: Icons.groups_rounded,
          title: 'Largest Club',
          accessor: (c) => c.members.toDouble(),
          formatter: (v) => '${v.round()} members',
        ),
        const SizedBox(height: 10),
        _LeaderCard(
          clubs: clubs,
          icon: Icons.event_rounded,
          title: 'Most Active',
          accessor: (c) => c.meetings.toDouble(),
          formatter: (v) => '${v.round()} meetings',
        ),
      ],
    );
  }
}

class _LeaderCard extends StatelessWidget {
  final List<AgDistrictClubRow> clubs;
  final IconData icon;
  final String title;
  final double Function(AgDistrictClubRow) accessor;
  final String Function(double) formatter;
  const _LeaderCard({
    required this.clubs,
    required this.icon,
    required this.title,
    required this.accessor,
    required this.formatter,
  });

  @override
  Widget build(BuildContext context) {
    // Sort a copy by metric descending, keeping the original index for color.
    final indexed = [
      for (var i = 0; i < clubs.length; i++) (club: clubs[i], index: i),
    ]..sort((a, b) => accessor(b.club).compareTo(accessor(a.club)));

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
          Row(
            children: [
              Icon(icon, size: 16, color: AppColors.rotaryBlue),
              const SizedBox(width: 6),
              Text(
                title.toUpperCase(),
                style: AppFonts.body(
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                  color: AppColors.slate500,
                  letterSpacing: 0.5,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          if (indexed.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Text(
                'No data',
                style: AppFonts.body(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: AppColors.slate400,
                ),
              ),
            )
          else ...[
            // Winner pill (blue tile)
            Container(
              padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
              decoration: BoxDecoration(
                color: AppColors.rotaryBlue,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    indexed.first.club.clubName,
                    style: AppFonts.body(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w800,
                      color: Colors.white,
                    ),
                  ),
                  Text(
                    formatter(accessor(indexed.first.club)),
                    style: AppFonts.body(
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                      color: AppColors.goldPrime,
                      fontFeatures: const [FontFeature.tabularFigures()],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            for (var i = 1; i < indexed.length; i++)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 3),
                child: Row(
                  children: [
                    Container(
                      width: 18,
                      height: 18,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: Color(agClubColor(indexed[i].index)),
                        shape: BoxShape.circle,
                      ),
                      child: Text(
                        '${i + 1}',
                        style: AppFonts.body(
                          fontSize: 9,
                          fontWeight: FontWeight.w800,
                          color: Colors.white,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        indexed[i].club.clubName,
                        style: AppFonts.body(
                          fontSize: 12,
                          color: AppColors.slate700,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    Text(
                      formatter(accessor(indexed[i].club)),
                      style: AppFonts.body(
                        fontSize: 11.5,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary,
                        fontFeatures: const [FontFeature.tabularFigures()],
                      ),
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

// ─────────────────────────────────────────────────────────────────────────
// 3. Head-to-Head comparison — sortable table
// ─────────────────────────────────────────────────────────────────────────

enum _SortKey {
  club,
  members,
  meetings,
  projects,
  trf,
  dck,
  vocational,
  international,
  newGen,
}

class _ComparisonSection extends StatefulWidget {
  final List<AgHeadToHeadRow> rows;
  const _ComparisonSection({required this.rows});

  @override
  State<_ComparisonSection> createState() => _ComparisonSectionState();
}

class _ComparisonSectionState extends State<_ComparisonSection> {
  _SortKey _sort = _SortKey.members;

  void _select(_SortKey key) => setState(() => _sort = key);

  @override
  Widget build(BuildContext context) {
    // Metrics the AG can rank clubs by. National Rank is intentionally left out —
    // it isn't published yet, so there's nothing to compare.
    final metrics = <_Metric>[
      _Metric(_SortKey.members, 'Members', (r) => r.members.toDouble(),
          (r) => agFmtInt(r.members)),
      _Metric(_SortKey.meetings, 'Meetings', (r) => r.meetings.toDouble(),
          (r) => agFmtInt(r.meetings)),
      _Metric(_SortKey.projects, 'Projects', (r) => r.totalProjects.toDouble(),
          (r) => agFmtInt(r.totalProjects)),
      _Metric(_SortKey.trf, 'TRF (USD)', (r) => r.trfInr,
          (r) => agFmtUsdShort(r.trfInr)),
      _Metric(_SortKey.dck, 'DCK', (r) => r.dck, (r) => agFmtInt(r.dck)),
      _Metric(_SortKey.vocational, 'Vocational',
          (r) => r.vocationalService.toDouble(),
          (r) => agFmtInt(r.vocationalService)),
      _Metric(_SortKey.international, 'International',
          (r) => r.internationalService.toDouble(),
          (r) => agFmtInt(r.internationalService)),
      _Metric(_SortKey.newGen, 'New Gen',
          (r) => r.newGenerationService.toDouble(),
          (r) => agFmtInt(r.newGenerationService)),
    ];
    final selected =
        metrics.firstWhere((m) => m.key == _sort, orElse: () => metrics.first);

    final colorByClub = <int, int>{
      for (var i = 0; i < widget.rows.length; i++)
        widget.rows[i].clubId: agClubColor(i),
    };

    final ranked = [...widget.rows]
      ..sort((a, b) => selected.numOf(b).compareTo(selected.numOf(a)));
    final maxVal = ranked.isEmpty
        ? 0.0
        : ranked.map(selected.numOf).fold<double>(0, (m, v) => v > m ? v : m);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'HEAD-TO-HEAD COMPARISON',
          style: AppFonts.body(
            fontSize: 10,
            fontWeight: FontWeight.w800,
            color: AppColors.slate500,
            letterSpacing: 0.7,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          'Choose a metric to rank your clubs against each other.',
          style: AppFonts.body(
            fontSize: 11,
            color: AppColors.slate500,
          ),
        ),
        const SizedBox(height: 10),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final m in metrics)
              _MetricChip(
                label: m.label,
                active: m.key == _sort,
                onTap: () => _select(m.key),
              ),
          ],
        ),
        const SizedBox(height: 12),
        if (ranked.isEmpty)
          Container(
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppColors.slate200),
            ),
            padding: const EdgeInsets.symmetric(vertical: 40),
            child: Text(
              'No club data available for this AG group.',
              textAlign: TextAlign.center,
              style: AppFonts.body(
                fontSize: 12.5,
                fontWeight: FontWeight.w600,
                color: AppColors.slate400,
              ),
            ),
          )
        else
          Container(
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AppColors.slate200),
            ),
            clipBehavior: Clip.antiAlias,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (var i = 0; i < ranked.length; i++) ...[
                  if (i > 0)
                    const Divider(
                        height: 1, thickness: 1, color: AppColors.slate200),
                  _rankRow(
                    i,
                    ranked[i],
                    selected.strOf(ranked[i]),
                    maxVal == 0 ? 0.0 : selected.numOf(ranked[i]) / maxVal,
                    Color(colorByClub[ranked[i].clubId] ?? agClubColor(i)),
                  ),
                ],
              ],
            ),
          ),
        const SizedBox(height: 6),
        Text(
          'Ranked high → low by ${selected.label}. National Rank is awaiting '
          'publication.',
          style: AppFonts.body(
            fontSize: 10.5,
            color: AppColors.slate400,
          ),
        ),
      ],
    );
  }

  /// One club's row in the ranking — rank badge, name, the selected metric's
  /// value, and a proportional bar (value ÷ the leading club's value).
  Widget _rankRow(
    int rank,
    AgHeadToHeadRow r,
    String valueText,
    double frac,
    Color color,
  ) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                width: 22,
                height: 22,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.14),
                  borderRadius: BorderRadius.circular(7),
                ),
                child: Text(
                  '${rank + 1}',
                  style: AppFonts.body(
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                    color: color,
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  r.clubName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppFonts.body(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Text(
                valueText,
                style: AppFonts.body(
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(999),
            child: LinearProgressIndicator(
              value: frac.clamp(0.0, 1.0),
              minHeight: 8,
              backgroundColor: AppColors.slate100,
              valueColor: AlwaysStoppedAnimation<Color>(color),
            ),
          ),
        ],
      ),
    );
  }

}

/// One rankable metric in the head-to-head comparison — its sort key, display
/// label, a numeric accessor (ranking + bar) and a formatted-string accessor
/// (the value shown).
class _Metric {
  final _SortKey key;
  final String label;
  final double Function(AgHeadToHeadRow) numOf;
  final String Function(AgHeadToHeadRow) strOf;
  const _Metric(this.key, this.label, this.numOf, this.strOf);
}

/// A pill toggle for choosing which metric ranks the clubs.
class _MetricChip extends StatelessWidget {
  final String label;
  final bool active;
  final VoidCallback onTap;
  const _MetricChip({
    required this.label,
    required this.active,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: active ? AppColors.rotaryBlue : Colors.white,
      borderRadius: BorderRadius.circular(999),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(999),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(999),
            border: Border.all(
                color: active ? AppColors.rotaryBlue : AppColors.slate200),
          ),
          child: Text(
            label,
            style: AppFonts.body(
              fontSize: 11.5,
              fontWeight: FontWeight.w700,
              color: active ? Colors.white : AppColors.slate500,
            ),
          ),
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 4. Charts at a glance — 2x2 bar grid driven by metricBars
// ─────────────────────────────────────────────────────────────────────────

class _ChartsSection extends StatelessWidget {
  final AgMetricBars bars;
  const _ChartsSection({required this.bars});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'CLUB METRICS AT A GLANCE',
          style: AppFonts.body(
            fontSize: 10,
            fontWeight: FontWeight.w800,
            color: AppColors.slate500,
            letterSpacing: 0.7,
          ),
        ),
        const SizedBox(height: 8),
        _MetricBars(
          title: 'Members per Club',
          data: bars.membersPerClub.map((k, v) => MapEntry(k, v.toDouble())),
          formatter: (v) => '${v.round()}',
        ),
        const SizedBox(height: 10),
        _MetricBars(
          title: 'Projects per Club',
          data: bars.projectsPerClub.map((k, v) => MapEntry(k, v.toDouble())),
          formatter: (v) => '${v.round()}',
        ),
        const SizedBox(height: 10),
        _MetricBars(
          title: 'TRF Giving per Club (USD)',
          data: bars.trfPerClub,
          formatter: agFmtUsd,
        ),
        const SizedBox(height: 10),
        _MetricBars(
          title: 'Meetings per Club',
          data: bars.meetingsPerClub.map((k, v) => MapEntry(k, v.toDouble())),
          formatter: (v) => '${v.round()}',
        ),
      ],
    );
  }
}

class _MetricBars extends StatelessWidget {
  final String title;
  final Map<String, double> data;
  final String Function(double) formatter;
  const _MetricBars({
    required this.title,
    required this.data,
    required this.formatter,
  });

  @override
  Widget build(BuildContext context) {
    final entries = data.entries.toList();
    final peak = entries.isEmpty
        ? 0.0
        : entries.map((e) => e.value).reduce((a, b) => a > b ? a : b);

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.slate200),
      ),
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            title,
            style: AppFonts.body(
              fontSize: 13,
              fontWeight: FontWeight.w800,
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(height: 10),
          if (entries.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 14),
              child: Text(
                'No club data available for this AG group.',
                textAlign: TextAlign.center,
                style: AppFonts.body(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w600,
                  color: AppColors.slate400,
                ),
              ),
            )
          else
            for (var i = 0; i < entries.length; i++) ...[
              Tooltip(
                message: '${entries[i].key}: ${formatter(entries[i].value)}',
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    SizedBox(
                      width: 96,
                      child: Text(
                        entries[i].key,
                        style: AppFonts.body(
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          color: AppColors.slate700,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    Expanded(
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(999),
                        child: LinearProgressIndicator(
                          value: peak == 0 ? 0 : entries[i].value / peak,
                          minHeight: 8,
                          backgroundColor: AppColors.slate100,
                          valueColor: AlwaysStoppedAnimation<Color>(
                            Color(agClubColor(i)),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    SizedBox(
                      width: 72,
                      child: Text(
                        formatter(entries[i].value),
                        textAlign: TextAlign.right,
                        style: AppFonts.body(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w800,
                          color: Color(agClubColor(i)),
                          fontFeatures: const [FontFeature.tabularFigures()],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              if (i != entries.length - 1) const SizedBox(height: 8),
            ],
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 5. Multi-metric radar — clubs normalised 0-100 across four axes
// ─────────────────────────────────────────────────────────────────────────

/// Radar axis definition — label + how to pull the raw value off a point.
class _RadarAxis {
  final String label;
  final double Function(AgRadarPoint) value;
  const _RadarAxis(this.label, this.value);
}

const _kRadarAxes = <_RadarAxis>[
  _RadarAxis('Members', _axMembers),
  _RadarAxis('Projects', _axProjects),
  _RadarAxis('TRF', _axTrf),
  _RadarAxis('Goals', _axGoals),
];

double _axMembers(AgRadarPoint p) => p.members.toDouble();
double _axProjects(AgRadarPoint p) => p.projects.toDouble();
double _axTrf(AgRadarPoint p) => p.trfInr;
double _axGoals(AgRadarPoint p) => p.goalsScore;

class _RadarSection extends StatelessWidget {
  final List<AgRadarPoint> points;
  const _RadarSection({required this.points});

  @override
  Widget build(BuildContext context) {
    final hasData = points.isNotEmpty;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'MULTI-METRIC RADAR',
          style: AppFonts.body(
            fontSize: 10,
            fontWeight: FontWeight.w800,
            color: AppColors.slate500,
            letterSpacing: 0.7,
          ),
        ),
        const SizedBox(height: 8),
        Container(
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
                'All metrics normalised 0-100 so clubs can be compared across '
                'dimensions. Outer edge = leader in that axis.',
                style: AppFonts.body(
                  fontSize: 11,
                  color: AppColors.slate500,
                ),
              ),
              const SizedBox(height: 12),
              if (!hasData)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 30),
                  child: Text(
                    'No club data available for this AG group.',
                    textAlign: TextAlign.center,
                    style: AppFonts.body(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: AppColors.slate400,
                    ),
                  ),
                )
              else ...[
                AspectRatio(
                  aspectRatio: 1,
                  child: CustomPaint(
                    painter: _RadarPainter(points: points),
                  ),
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 12,
                  runSpacing: 6,
                  children: [
                    for (var i = 0; i < points.length; i++)
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Container(
                            width: 10,
                            height: 10,
                            decoration: BoxDecoration(
                              color: Color(agClubColor(i)),
                              shape: BoxShape.circle,
                            ),
                          ),
                          const SizedBox(width: 5),
                          Text(
                            points[i].clubName,
                            style: AppFonts.body(
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                              color: AppColors.slate700,
                            ),
                          ),
                        ],
                      ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _RadarPainter extends CustomPainter {
  final List<AgRadarPoint> points;
  _RadarPainter({required this.points});

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = (size.shortestSide / 2) - 34; // leave room for labels
    if (radius <= 0) return;
    final axisCount = _kRadarAxes.length;
    // Axis angles: start at top (−90°), clockwise.
    final angles = [
      for (var i = 0; i < axisCount; i++)
        -math.pi / 2 + i * (2 * math.pi / axisCount),
    ];

    // Per-axis max across clubs for 0-1 normalisation.
    final maxes = [
      for (final ax in _kRadarAxes)
        points.map(ax.value).fold<double>(0, (m, v) => v > m ? v : m),
    ];

    final gridPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1
      ..color = AppColors.lightBorder;
    final spokePaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1
      ..color = AppColors.lightBorder;

    // Concentric grid rings (4 levels).
    for (var level = 1; level <= 4; level++) {
      final r = radius * level / 4;
      final path = Path();
      for (var i = 0; i < axisCount; i++) {
        final p = center + Offset(r * _cos(angles[i]), r * _sin(angles[i]));
        if (i == 0) {
          path.moveTo(p.dx, p.dy);
        } else {
          path.lineTo(p.dx, p.dy);
        }
      }
      path.close();
      canvas.drawPath(path, gridPaint);
    }

    // Spokes + axis labels.
    for (var i = 0; i < axisCount; i++) {
      final tip = center +
          Offset(radius * _cos(angles[i]), radius * _sin(angles[i]));
      canvas.drawLine(center, tip, spokePaint);
      final labelPos = center +
          Offset((radius + 18) * _cos(angles[i]),
              (radius + 18) * _sin(angles[i]));
      final tp = TextPainter(
        text: TextSpan(
          text: _kRadarAxes[i].label,
          style: AppFonts.body(
            fontSize: 10.5,
            fontWeight: FontWeight.w700,
            color: AppColors.slate500,
          ),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      tp.paint(
        canvas,
        labelPos - Offset(tp.width / 2, tp.height / 2),
      );
    }

    // One polygon per club.
    for (var c = 0; c < points.length; c++) {
      final color = Color(agClubColor(c));
      final path = Path();
      for (var i = 0; i < axisCount; i++) {
        final max = maxes[i];
        final norm = max <= 0 ? 0.0 : (_kRadarAxes[i].value(points[c]) / max);
        final r = radius * norm.clamp(0.0, 1.0);
        final p = center + Offset(r * _cos(angles[i]), r * _sin(angles[i]));
        if (i == 0) {
          path.moveTo(p.dx, p.dy);
        } else {
          path.lineTo(p.dx, p.dy);
        }
      }
      path.close();
      canvas.drawPath(
        path,
        Paint()
          ..style = PaintingStyle.fill
          ..color = color.withValues(alpha: 0.15),
      );
      canvas.drawPath(
        path,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2
          ..color = color,
      );
    }
  }

  double _cos(double r) => math.cos(r);
  double _sin(double r) => math.sin(r);

  @override
  bool shouldRepaint(covariant _RadarPainter old) => old.points != points;
}

// ─────────────────────────────────────────────────────────────────────────
// 6. AG Totals banner
// ─────────────────────────────────────────────────────────────────────────

class _TotalsBanner extends StatelessWidget {
  final AgDistrictResponse data;
  const _TotalsBanner({required this.data});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
      decoration: BoxDecoration(
        color: AppColors.primaryDeep,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'AG GROUP COMBINED TOTALS',
            style: AppFonts.body(
              fontSize: 10,
              fontWeight: FontWeight.w800,
              color: Colors.white.withValues(alpha: 0.7),
              letterSpacing: 1.2,
            ),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: _TotalsTile(
                  value: agFmtInt(data.totalMembers),
                  label: 'Total Members',
                ),
              ),
              Expanded(
                child: _TotalsTile(
                  value: agFmtInt(data.totalMeetings),
                  label: 'Total Meetings',
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: _TotalsTile(
                  value: agFmtInt(data.totalProjects),
                  label: 'Total Projects',
                ),
              ),
              Expanded(
                child: _TotalsTile(
                  value: agFmtUsd(data.totalTrfInr),
                  label: 'Total TRF',
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _TotalsTile extends StatelessWidget {
  final String value;
  final String label;
  const _TotalsTile({required this.value, required this.label});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(
          value,
          style: AppFonts.body(
            fontSize: 18,
            fontWeight: FontWeight.w800,
            color: Colors.white,
            fontFeatures: const [FontFeature.tabularFigures()],
          ),
        ),
        const SizedBox(height: 2),
        Text(
          label,
          style: AppFonts.body(
            fontSize: 10.5,
            color: AppColors.chart5,
          ),
        ),
      ],
    );
  }
}
