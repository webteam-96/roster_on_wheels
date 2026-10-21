import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../../../core/services/ag_dashboard_api.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../data/models/ag_dashboard_models.dart';
import 'ag_async.dart';
import 'ag_format.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// "Goals & Club Excellence" tab — wired to
/// `GET /api/mobile/ag-dashboard/excellence`.
///
/// Layout:
///   1. Header (title + AG name + RY)
///   2. Summary KPIs (Awards Achieved / Goals On Track / Avg Citation / Top Club)
///   3. District Awards Scores — stacked horizontal bars + breakdown table
///   4. Goals Achievement Grid — per-club cards with 6 goal bars
///   5. Club Excellence Award Status (PENDING placeholder or status chips)
///   6. Monthly Goal Tracking — line chart toggle (Projects / Meetings / TRF)
class AgGoalsTab extends StatefulWidget {
  final int? yearId;
  const AgGoalsTab({super.key, this.yearId});

  @override
  State<AgGoalsTab> createState() => _AgGoalsTabState();
}

class _AgGoalsTabState extends State<AgGoalsTab>
    with AutomaticKeepAliveClientMixin<AgGoalsTab> {
  final AgDashboardApi _api = AgDashboardApi();
  late Future<AgExcellenceResponse> _future;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _future = _api.getExcellence(yearId: widget.yearId);
  }

  @override
  void didUpdateWidget(covariant AgGoalsTab old) {
    super.didUpdateWidget(old);
    if (old.yearId != widget.yearId) {
      setState(() => _future = _api.getExcellence(yearId: widget.yearId));
    }
  }

  void _reload() =>
      setState(() => _future = _api.getExcellence(yearId: widget.yearId));

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return FutureBuilder<AgExcellenceResponse>(
      future: _future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const AgLoading();
        }
        if (snap.hasError) {
          return AgError(error: snap.error!, onRetry: _reload);
        }
        final data = snap.data!;
        final ry =
            data.ag.yearLabel.isEmpty ? '–' : data.ag.yearLabel;
        return SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 32),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _Header(agName: data.ag.name, ry: ry),
              const SizedBox(height: 14),
              _SummaryKpis(data: data),
              const SizedBox(height: 18),
              const _SectionTitle(
                icon: Icons.bar_chart_rounded,
                label: 'District Awards Scores',
              ),
              const SizedBox(height: 10),
              _CitationScoresCard(citation: data.citation),
              const SizedBox(height: 10),
              _CitationBreakdownCard(citation: data.citation),
              const SizedBox(height: 18),
              const _SectionTitle(
                icon: Icons.gps_fixed_rounded,
                label: 'Goals Achievement Grid',
              ),
              const SizedBox(height: 4),
              const _GoalsLegendNote(),
              const SizedBox(height: 10),
              _GoalsGrid(goals: data.goals),
              const SizedBox(height: 10),
              const _GoalsTargetsRef(),
              const SizedBox(height: 18),
              const _SectionTitle(
                icon: Icons.emoji_events_rounded,
                label: 'Club Excellence Award Status',
              ),
              const SizedBox(height: 10),
              _AwardStatusCard(
                awardStatus: data.awardStatus,
                isPending: data.awardStatusIsPending,
                ry: ry,
              ),
              const SizedBox(height: 18),
              const _SectionTitle(
                icon: Icons.show_chart_rounded,
                label: 'Monthly Goal Tracking',
              ),
              const SizedBox(height: 10),
              _MonthlyTrackingCard(
                monthlyProjects: data.monthlyProjects,
                monthlyMeetings: data.monthlyMeetings,
                monthlyTrf: data.monthlyTrf,
                ry: ry,
              ),
            ],
          ),
        );
      },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Shared helpers / constants
// ─────────────────────────────────────────────────────────────────────────

// TRF is served in USD (backend USD_INR = 1). Short USD, mirrors web `fmtUsdShort`.
String _fmtUsd(num n) {
  if (n >= 1000000) return '\$${(n / 1000000).toStringAsFixed(1)}M';
  if (n >= 1000) return '\$${(n / 1000).toStringAsFixed(0)}K';
  return '\$${n.round()}';
}

const _green = AppColors.statusDone;
const _amber = AppColors.warningDark;
const _red = AppColors.statusNone;

/// Goal targets used for the on-track maths and the goal bars. Mirrors the web
/// ClubExcellence targets.
class _GoalDef {
  final String key;
  final String label;
  final String unit; // 'USD' | '%' | 'count'
  final double target;
  const _GoalDef(this.key, this.label, this.unit, this.target);
}

const _goalDefs = <_GoalDef>[
  _GoalDef('membershipGrowth', 'Membership Growth', '%', 5),
  // EREY benchmark ~$100/member. TRF is now served in USD, so the target is $100
  _GoalDef('trfPerCapita', 'TRF per Capita', 'USD', 100),
  _GoalDef('serviceProjects', 'Service Projects', 'count', 12),
  _GoalDef('meetingAttendance', 'Meeting Attendance', '%', 60),
  _GoalDef('myRotary', 'My Rotary', '%', 80),
  _GoalDef('newMembers', 'New Members', 'count', 3),
];

double _goalActual(AgGoalsClubRow r, String key) {
  switch (key) {
    case 'membershipGrowth':
      return r.membershipGrowth;
    case 'trfPerCapita':
      return r.trfPerCapita;
    case 'serviceProjects':
      return r.serviceProjects.toDouble();
    case 'meetingAttendance':
      return r.meetingAttendance;
    case 'myRotary':
      return r.myRotary;
    default:
      return r.newMembers.toDouble();
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 1. Header
// ─────────────────────────────────────────────────────────────────────────

class _Header extends StatelessWidget {
  final String agName;
  final String ry;
  const _Header({required this.agName, required this.ry});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 36,
          height: 36,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: AppColors.donutFillAmber.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(10),
          ),
          child: const Icon(Icons.emoji_events_rounded,
              size: 18, color: AppColors.donutFillAmber),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Goals & Club Excellence',
                style: AppFonts.body(
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                ),
              ),
              Text(
                'District Awards scores, goal tracking, and award status: RY $ry',
                style: AppFonts.body(
                  fontSize: 11,
                  color: AppColors.slate500,
                ),
              ),
              if (agName.isNotEmpty)
                Text(
                  'AG: $agName',
                  style: AppFonts.body(
                    fontSize: 10.5,
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

class _SectionTitle extends StatelessWidget {
  final IconData icon;
  final String label;
  const _SectionTitle({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 16, color: AppColors.rotaryBlue),
        const SizedBox(width: 6),
        Text(
          label,
          style: AppFonts.body(
            fontSize: 13,
            fontWeight: FontWeight.w800,
            color: AppColors.slate700,
          ),
        ),
      ],
    );
  }
}

class _EmptyNote extends StatelessWidget {
  final String text;
  const _EmptyNote(this.text);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 24),
      child: Center(
        child: Text(
          text,
          textAlign: TextAlign.center,
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

class _CardShell extends StatelessWidget {
  final Widget child;
  final EdgeInsets padding;
  const _CardShell({
    required this.child,
    this.padding = const EdgeInsets.fromLTRB(14, 12, 14, 14),
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.slate200),
      ),
      padding: padding,
      child: child,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 2. Summary KPIs
// ─────────────────────────────────────────────────────────────────────────

class _SummaryKpis extends StatelessWidget {
  final AgExcellenceResponse data;
  const _SummaryKpis({required this.data});

  @override
  Widget build(BuildContext context) {
    final awards = data.awardStatus;
    final awardsAchieved = awards.where((a) => a.achieved).length;
    final awardsTotal = awards.length;

    // Goals on track: per club per goal, value/target*100 >= 100.
    // Skip My Rotary when myRotaryIsPending.
    var goalsOnTrack = 0;
    var goalsTotal = 0;
    for (final r in data.goals) {
      for (final g in _goalDefs) {
        if (g.key == 'myRotary' && r.myRotaryIsPending) continue;
        goalsTotal++;
        final actual = _goalActual(r, g.key);
        if (g.target > 0 && (actual / g.target) * 100 >= 100) goalsOnTrack++;
      }
    }

    final avgCitation = agFmtInt(data.averageCitationScore);
    final topTotal = agFmtInt(data.topScoringClub?.total ?? 0);
    final topName = data.topScoringClub?.clubName ?? '–';

    return Column(
      children: [
        Row(
          children: [
            Expanded(
              child: _KpiTile(
                icon: Icons.emoji_events_rounded,
                label: 'Awards Achieved',
                value: '$awardsAchieved/$awardsTotal',
                sub: 'Club excellence awards',
                color: AppColors.donutFillAmber,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _KpiTile(
                icon: Icons.gps_fixed_rounded,
                label: 'Goals On Track',
                value: '$goalsOnTrack/$goalsTotal',
                sub: 'Individual goal metrics',
                color: AppColors.rotaryBlue,
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: _KpiTile(
                icon: Icons.trending_up_rounded,
                label: 'Avg Awards Score',
                value: avgCitation,
                sub: 'District awards pts',
                color: _green,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _KpiTile(
                icon: Icons.star_rounded,
                label: 'Top Scoring Club',
                value: topTotal,
                sub: topName,
                color: _green,
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _KpiTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final String sub;
  final Color color;
  const _KpiTile({
    required this.icon,
    required this.label,
    required this.value,
    required this.sub,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
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
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(7),
                ),
                child: Icon(icon, size: 13, color: color),
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  label.toUpperCase(),
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
            sub,
            style: AppFonts.body(
              fontSize: 10,
              color: AppColors.slate400,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 3. Citation Scores — stacked horizontal bars
// ─────────────────────────────────────────────────────────────────────────

const _categoryDefs = <({String key, String label, Color color})>[
  // Same series as the web excellence chart (CLUB_PALETTE).
  (key: 'membership', label: 'Membership', color: AppColors.primaryPrime),
  (key: 'trf', label: 'TRF', color: AppColors.goldPrime),
  (key: 'service', label: 'Service', color: AppColors.success),
  (key: 'publicImage', label: 'Public Image', color: AppColors.accentBlue),
  (key: 'youth', label: 'Youth', color: AppColors.chart5),
  (key: 'foundation', label: 'Foundation', color: AppColors.slate700),
];

double _categoryValue(AgCitationClubRow b, String key) {
  switch (key) {
    case 'membership':
      return b.membership;
    case 'trf':
      return b.trf;
    case 'service':
      return b.service;
    case 'publicImage':
      return b.publicImage;
    case 'youth':
      return b.youth;
    default:
      return b.foundation;
  }
}

class _CitationScoresCard extends StatelessWidget {
  final List<AgCitationClubRow> citation;
  const _CitationScoresCard({required this.citation});

  @override
  Widget build(BuildContext context) {
    final peak = citation.isEmpty
        ? 0.0
        : citation.map((b) => b.total).reduce(math.max);

    return _CardShell(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'District Awards Scores by Club',
            style: AppFonts.body(
              fontSize: 13,
              fontWeight: FontWeight.w800,
              color: AppColors.slate700,
            ),
          ),
          Text(
            'Stacked bar: each colour is a scoring category',
            style: AppFonts.body(
              fontSize: 11,
              color: AppColors.slate400,
            ),
          ),
          if (citation.isEmpty)
            const _EmptyNote('No awards data yet.')
          else ...[
            const SizedBox(height: 12),
            for (var i = 0; i < citation.length; i++) ...[
              _CitationStackedRow(
                clubName: citation[i].clubName,
                breakdown: citation[i],
                peak: peak,
              ),
              if (i != citation.length - 1) const SizedBox(height: 10),
            ],
            const SizedBox(height: 10),
            Wrap(
              spacing: 10,
              runSpacing: 4,
              children: [
                for (final c in _categoryDefs)
                  _LegendDot(color: c.color, label: c.label),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _CitationStackedRow extends StatelessWidget {
  final String clubName;
  final AgCitationClubRow breakdown;
  final double peak;
  const _CitationStackedRow({
    required this.clubName,
    required this.breakdown,
    required this.peak,
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
                clubName,
                style: AppFonts.body(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                ),
              ),
            ),
            Text(
              agFmtInt(breakdown.total),
              style: AppFonts.body(
                fontSize: 12,
                fontWeight: FontWeight.w800,
                color: AppColors.rotaryBlue,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
          ],
        ),
        const SizedBox(height: 4),
        LayoutBuilder(
          builder: (context, box) {
            final widthFrac = peak <= 0 ? 0.0 : breakdown.total / peak;
            final filledWidth = box.maxWidth * widthFrac;
            return SizedBox(
              height: 10,
              child: Stack(
                children: [
                  Container(
                    decoration: BoxDecoration(
                      color: AppColors.slate100,
                      borderRadius: BorderRadius.circular(999),
                    ),
                  ),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(999),
                    child: SizedBox(
                      width: filledWidth,
                      child: Row(
                        children: [
                          for (final c in _categoryDefs)
                            Expanded(
                              flex: math.max(
                                  1, _categoryValue(breakdown, c.key).round()),
                              child: ColoredBox(color: c.color),
                            ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            );
          },
        ),
      ],
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
          decoration: BoxDecoration(
            color: color,
            borderRadius: BorderRadius.circular(2),
          ),
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

class _CitationBreakdownCard extends StatelessWidget {
  final List<AgCitationClubRow> citation;
  const _CitationBreakdownCard({required this.citation});

  @override
  Widget build(BuildContext context) {
    final sorted = [...citation]..sort((a, b) => b.total.compareTo(a.total));
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
                const Icon(Icons.bar_chart_rounded,
                    size: 15, color: AppColors.rotaryBlue),
                const SizedBox(width: 6),
                Text(
                  'Category Breakdown',
                  style: AppFonts.body(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: AppColors.slate700,
                  ),
                ),
              ],
            ),
          ),
          if (sorted.isEmpty)
            const _EmptyNote('No awards data yet.')
          else
            for (var i = 0; i < sorted.length; i++)
              _CitationBreakdownRow(index: i, breakdown: sorted[i]),
        ],
      ),
    );
  }
}

class _CitationBreakdownRow extends StatelessWidget {
  final int index;
  final AgCitationClubRow breakdown;
  const _CitationBreakdownRow({required this.index, required this.breakdown});

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
              Text(
                '#${index + 1}',
                style: AppFonts.body(
                  fontSize: 10.5,
                  color: AppColors.slate400,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  breakdown.clubName.isEmpty ? '–' : breakdown.clubName,
                  style: AppFonts.body(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary,
                  ),
                ),
              ),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: AppColors.muted,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  agFmtInt(breakdown.total),
                  style: AppFonts.body(
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    color: AppColors.rotaryBlue,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 12,
            runSpacing: 4,
            children: [
              for (final c in _categoryDefs)
                _CategoryChip(
                  label: c.label,
                  value: _categoryValue(breakdown, c.key),
                  color: c.color,
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _CategoryChip extends StatelessWidget {
  final String label;
  final double value;
  final Color color;
  const _CategoryChip({
    required this.label,
    required this.value,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(
            color: color,
            borderRadius: BorderRadius.circular(2),
          ),
        ),
        const SizedBox(width: 4),
        Text(
          '$label ',
          style: AppFonts.body(
            fontSize: 10,
            color: AppColors.slate400,
          ),
        ),
        Text(
          agFmtInt(value),
          style: AppFonts.body(
            fontSize: 11,
            fontWeight: FontWeight.w800,
            color: AppColors.slate700,
            fontFeatures: const [FontFeature.tabularFigures()],
          ),
        ),
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 4. Goals Achievement Grid
// ─────────────────────────────────────────────────────────────────────────

class _GoalsLegendNote extends StatelessWidget {
  const _GoalsLegendNote();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: 22),
      child: Text.rich(
        TextSpan(
          style: AppFonts.body(
            fontSize: 10.5,
            color: AppColors.slate400,
          ),
          children: const [
            TextSpan(text: 'Progress vs Rotary targets: '),
            TextSpan(
              text: 'green',
              style: TextStyle(color: _green, fontWeight: FontWeight.w800),
            ),
            TextSpan(text: ' = achieved, '),
            TextSpan(
              text: 'amber',
              style: TextStyle(color: _amber, fontWeight: FontWeight.w800),
            ),
            TextSpan(text: ' = on track, '),
            TextSpan(
              text: 'red',
              style: TextStyle(color: _red, fontWeight: FontWeight.w800),
            ),
            TextSpan(text: ' = behind.'),
          ],
        ),
      ),
    );
  }
}

class _GoalsGrid extends StatelessWidget {
  final List<AgGoalsClubRow> goals;
  const _GoalsGrid({required this.goals});

  @override
  Widget build(BuildContext context) {
    if (goals.isEmpty) {
      return const _CardShell(child: _EmptyNote('No goal data yet.'));
    }
    return Column(
      children: [
        for (var i = 0; i < goals.length; i++) ...[
          _GoalsClubCard(row: goals[i], colorIndex: i),
          if (i != goals.length - 1) const SizedBox(height: 10),
        ],
      ],
    );
  }
}

class _GoalsClubCard extends StatelessWidget {
  final AgGoalsClubRow row;
  final int colorIndex;
  const _GoalsClubCard({required this.row, required this.colorIndex});

  @override
  Widget build(BuildContext context) {
    // Achieved count: skip My Rotary if pending.
    var achieved = 0;
    var counted = 0;
    for (final g in _goalDefs) {
      if (g.key == 'myRotary' && row.myRotaryIsPending) continue;
      counted++;
      final actual = _goalActual(row, g.key);
      if (g.target > 0 && (actual / g.target) * 100 >= 100) achieved++;
    }
    final overallFrac = counted == 0 ? 0.0 : achieved / counted;
    final overallColor = counted > 0 && achieved == counted
        ? _green
        : achieved >= (counted / 2).ceil()
            ? _amber
            : _red;

    return _CardShell(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: Color(agClubColor(colorIndex)),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  '${row.members} member${row.members == 1 ? '' : 's'}',
                  style: AppFonts.body(
                    fontSize: 10,
                    fontWeight: FontWeight.w800,
                    color: Colors.white,
                  ),
                ),
              ),
              const Spacer(),
              Text(
                '$achieved / $counted',
                style: AppFonts.body(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w800,
                  color: overallColor,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            row.clubName.isEmpty ? '–' : row.clubName,
            style: AppFonts.body(
              fontSize: 13.5,
              fontWeight: FontWeight.w800,
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(height: 6),
          ClipRRect(
            borderRadius: BorderRadius.circular(999),
            child: LinearProgressIndicator(
              value: overallFrac,
              minHeight: 4,
              backgroundColor: AppColors.slate100,
              valueColor: AlwaysStoppedAnimation<Color>(overallColor),
            ),
          ),
          const SizedBox(height: 12),
          for (var g = 0; g < _goalDefs.length; g++) ...[
            _GoalBar(
              goal: _goalDefs[g],
              actual: _goalActual(row, _goalDefs[g].key),
              pending:
                  _goalDefs[g].key == 'myRotary' && row.myRotaryIsPending,
            ),
            if (g != _goalDefs.length - 1) const SizedBox(height: 10),
          ],
        ],
      ),
    );
  }
}

class _GoalBar extends StatelessWidget {
  final _GoalDef goal;
  final double actual;
  final bool pending;
  const _GoalBar({
    required this.goal,
    required this.actual,
    required this.pending,
  });

  String _format(double v) {
    switch (goal.unit) {
      case 'USD':
        return _fmtUsd(v);
      case '%':
        return '${v.toStringAsFixed(1)}%';
      default:
        return '${v.round()}';
    }
  }

  @override
  Widget build(BuildContext context) {
    final pct = goal.target <= 0 ? 0.0 : (actual / goal.target) * 100;
    final clamp = math.min(pct, 100);
    final color = pct >= 100
        ? _green
        : pct >= 60
            ? _amber
            : _red;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                goal.label,
                style: AppFonts.body(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: AppColors.slate500,
                ),
              ),
            ),
            if (pending)
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                decoration: BoxDecoration(
                  color: AppColors.slate100,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  'Pending',
                  style: AppFonts.body(
                    fontSize: 9.5,
                    fontWeight: FontWeight.w800,
                    color: AppColors.slate500,
                  ),
                ),
              )
            else ...[
              Text.rich(
                TextSpan(
                  style: AppFonts.body(
                    fontSize: 10.5,
                    color: AppColors.slate500,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                  children: [
                    TextSpan(text: _format(actual)),
                    TextSpan(
                      text: ' / ${_format(goal.target)}',
                      style: const TextStyle(color: AppColors.slate400),
                    ),
                  ],
                ),
              ),
              if (pct >= 100) ...[
                const SizedBox(width: 4),
                const Icon(Icons.check_circle, size: 12, color: _green),
              ],
            ],
          ],
        ),
        const SizedBox(height: 3),
        ClipRRect(
          borderRadius: BorderRadius.circular(999),
          child: pending
              ? Container(
                  height: 7,
                  decoration: BoxDecoration(
                    color: AppColors.slate200,
                    borderRadius: BorderRadius.circular(999),
                  ),
                )
              : LinearProgressIndicator(
                  value: clamp / 100,
                  minHeight: 7,
                  backgroundColor: AppColors.slate100,
                  valueColor: AlwaysStoppedAnimation<Color>(color),
                ),
        ),
      ],
    );
  }
}

class _GoalsTargetsRef extends StatelessWidget {
  const _GoalsTargetsRef();

  String _formatTarget(_GoalDef g) {
    switch (g.unit) {
      case 'USD':
        return _fmtUsd(g.target);
      case '%':
        return '${g.target.round()}%';
      default:
        return '${g.target.round()}';
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
      decoration: BoxDecoration(
        color: AppColors.slate50,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.slate200),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'GOAL TARGETS',
            style: AppFonts.body(
              fontSize: 9.5,
              fontWeight: FontWeight.w800,
              color: AppColors.slate500,
              letterSpacing: 0.6,
            ),
          ),
          const SizedBox(height: 4),
          Wrap(
            spacing: 12,
            runSpacing: 3,
            children: [
              for (final g in _goalDefs)
                Text.rich(
                  TextSpan(
                    style: AppFonts.body(
                      fontSize: 10.5,
                      color: AppColors.slate500,
                    ),
                    children: [
                      TextSpan(text: '${g.label}: '),
                      TextSpan(
                        text: _formatTarget(g),
                        style: const TextStyle(
                          color: AppColors.slate700,
                          fontWeight: FontWeight.w800,
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

// ─────────────────────────────────────────────────────────────────────────
// 5. Award Status
// ─────────────────────────────────────────────────────────────────────────

const _awardLabels = <({String key, String label})>[
  (key: 'presidentialCitation', label: 'Presidential Citation'),
  (key: 'districtCitation', label: 'District Awards'),
  (key: 'membershipExcellence', label: 'Membership Excellence'),
];

class _AwardStatusCard extends StatelessWidget {
  final List<AgAwardStatus> awardStatus;
  final bool isPending;
  final String ry;
  const _AwardStatusCard({
    required this.awardStatus,
    required this.isPending,
    required this.ry,
  });

  @override
  Widget build(BuildContext context) {
    if (isPending || awardStatus.isEmpty) {
      return const _AwardPendingPlaceholder();
    }
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
          for (var i = 0; i < awardStatus.length; i++)
            _AwardClubRow(row: awardStatus[i], colorIndex: i),
          // Legend
          Container(
            padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
            color: AppColors.slate50,
            child: const Wrap(
              spacing: 10,
              runSpacing: 6,
              children: [
                _AwardLegend(status: 'achieved', hint: 'criteria fully met'),
                _AwardLegend(status: 'on-track', hint: 'progress satisfactory'),
                _AwardLegend(status: 'behind', hint: 'needs attention'),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _AwardPendingPlaceholder extends StatelessWidget {
  const _AwardPendingPlaceholder();

  @override
  Widget build(BuildContext context) {
    return _CardShell(
      padding: const EdgeInsets.fromLTRB(16, 18, 16, 18),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: AppColors.slate100,
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(
              'PENDING',
              style: AppFonts.body(
                fontSize: 10,
                fontWeight: FontWeight.w800,
                color: AppColors.slate500,
                letterSpacing: 0.6,
              ),
            ),
          ),
          const SizedBox(height: 10),
          Text(
            'Award status: data entry needed.',
            textAlign: TextAlign.center,
            style: AppFonts.body(
              fontSize: 12.5,
              fontWeight: FontWeight.w700,
              color: AppColors.slate700,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Award statuses will appear here once club_award_status rows are populated for this RY.',
            textAlign: TextAlign.center,
            style: AppFonts.body(
              fontSize: 11,
              color: AppColors.slate400,
              height: 1.4,
            ),
          ),
        ],
      ),
    );
  }
}

class _AwardClubRow extends StatelessWidget {
  final AgAwardStatus row;
  final int colorIndex;
  const _AwardClubRow({required this.row, required this.colorIndex});

  String _statusFor(String key) {
    switch (key) {
      case 'presidentialCitation':
        return row.presidentialCitation;
      case 'districtCitation':
        return row.districtCitation;
      default:
        return row.membershipExcellence;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
      decoration: BoxDecoration(
        border: const Border(
          bottom: BorderSide(color: AppColors.slate100),
        ),
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
                  color: Color(agClubColor(colorIndex)),
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  row.clubName.isEmpty ? '–' : row.clubName,
                  style: AppFonts.body(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          if (row.isPending)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: AppColors.slate100,
                borderRadius: BorderRadius.circular(999),
              ),
              child: Text(
                'Pending',
                style: AppFonts.body(
                  fontSize: 9.5,
                  fontWeight: FontWeight.w800,
                  color: AppColors.slate500,
                ),
              ),
            )
          else
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final a in _awardLabels)
                  _AwardChip(label: a.label, status: _statusFor(a.key)),
              ],
            ),
        ],
      ),
    );
  }
}

({Color bg, Color fg, Color border, IconData icon}) _awardPalette(
    String status) {
  switch (status) {
    case 'achieved':
      return (
        bg: AppColors.successLight,
        fg: _green,
        border: AppColors.lightBorder,
        icon: Icons.check_circle_rounded,
      );
    case 'on-track':
      return (
        bg: AppColors.muted,
        fg: AppColors.rotaryBlue,
        border: AppColors.primaryLight,
        icon: Icons.access_time_rounded,
      );
    case 'behind':
      return (
        bg: AppColors.errorLight,
        fg: _red,
        border: AppColors.errorLight,
        icon: Icons.error_outline_rounded,
      );
    default: // pending
      return (
        bg: AppColors.slate100,
        fg: AppColors.slate500,
        border: AppColors.slate200,
        icon: Icons.schedule_rounded,
      );
  }
}

String _statusLabel(String s) {
  switch (s) {
    case 'achieved':
      return 'Achieved';
    case 'on-track':
      return 'On Track';
    case 'behind':
      return 'Behind';
    default:
      return 'Pending';
  }
}

class _AwardChip extends StatelessWidget {
  final String label;
  final String status;
  const _AwardChip({required this.label, required this.status});

  @override
  Widget build(BuildContext context) {
    final p = _awardPalette(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: p.bg,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: p.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(p.icon, size: 10, color: p.fg),
          const SizedBox(width: 3),
          Text(
            label,
            style: AppFonts.body(
              fontSize: 9.5,
              fontWeight: FontWeight.w800,
              color: p.fg,
            ),
          ),
        ],
      ),
    );
  }
}

class _AwardLegend extends StatelessWidget {
  final String status;
  final String hint;
  const _AwardLegend({required this.status, required this.hint});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        _AwardChip(label: _statusLabel(status), status: status),
        const SizedBox(width: 4),
        Text(
          hint,
          style: AppFonts.body(
            fontSize: 10,
            color: AppColors.slate500,
          ),
        ),
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 6. Monthly Goal Tracking — line chart toggle
// ─────────────────────────────────────────────────────────────────────────

enum _MetricKey { projects, meetings, trf }

class _MonthlyTrackingCard extends StatefulWidget {
  final List<AgMonthlyTrackingPoint> monthlyProjects;
  final List<AgMonthlyTrackingPoint> monthlyMeetings;
  final List<AgMonthlyTrackingPoint> monthlyTrf;
  final String ry;
  const _MonthlyTrackingCard({
    required this.monthlyProjects,
    required this.monthlyMeetings,
    required this.monthlyTrf,
    required this.ry,
  });

  @override
  State<_MonthlyTrackingCard> createState() => _MonthlyTrackingCardState();
}

class _MonthlyTrackingCardState extends State<_MonthlyTrackingCard> {
  _MetricKey _metric = _MetricKey.projects;

  List<AgMonthlyTrackingPoint> get _points {
    switch (_metric) {
      case _MetricKey.projects:
        return widget.monthlyProjects;
      case _MetricKey.meetings:
        return widget.monthlyMeetings;
      case _MetricKey.trf:
        return widget.monthlyTrf;
    }
  }

  String _label() {
    switch (_metric) {
      case _MetricKey.projects:
        return 'Service Projects';
      case _MetricKey.meetings:
        return 'Meetings Held';
      case _MetricKey.trf:
        return 'TRF (USD)';
    }
  }

  String _formatValue(double v) {
    switch (_metric) {
      case _MetricKey.trf:
        return _fmtUsd(v);
      default:
        return '${v.round()}';
    }
  }

  @override
  Widget build(BuildContext context) {
    final points = _points;
    final months = [for (final p in points) p.month];
    // Club names taken from the keys of the first point's byClub map.
    final clubNames =
        points.isEmpty ? <String>[] : points.first.byClub.keys.toList();

    // Peak across every club series for the active metric.
    var peak = 0.0;
    for (final p in points) {
      for (final v in p.byClub.values) {
        if (v > peak) peak = v;
      }
    }

    return _CardShell(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Monthly ${_label()}',
            style: AppFonts.body(
              fontSize: 13,
              fontWeight: FontWeight.w800,
              color: AppColors.slate700,
            ),
          ),
          Text(
            'RY ${widget.ry} · All clubs compared',
            style: AppFonts.body(
              fontSize: 11,
              color: AppColors.slate400,
            ),
          ),
          const SizedBox(height: 10),
          // Metric toggle
          Container(
            padding: const EdgeInsets.all(3),
            decoration: BoxDecoration(
              color: AppColors.slate100,
              borderRadius: BorderRadius.circular(9),
            ),
            child: Row(
              children: [
                for (final m in const [
                  (key: _MetricKey.projects, label: 'Service Projects'),
                  (key: _MetricKey.meetings, label: 'Meetings Held'),
                  (key: _MetricKey.trf, label: 'TRF (USD)'),
                ])
                  Expanded(
                    child: Material(
                      color: _metric == m.key
                          ? Colors.white
                          : Colors.transparent,
                      borderRadius: BorderRadius.circular(7),
                      child: InkWell(
                        onTap: () => setState(() => _metric = m.key),
                        borderRadius: BorderRadius.circular(7),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: 6),
                          child: Center(
                            child: Text(
                              m.label,
                              textAlign: TextAlign.center,
                              style: AppFonts.body(
                                fontSize: 11,
                                fontWeight: FontWeight.w800,
                                color: _metric == m.key
                                    ? AppColors.slate700
                                    : AppColors.slate500,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          if (clubNames.isEmpty)
            const _EmptyNote('No monthly data yet.')
          else ...[
            for (var i = 0; i < clubNames.length; i++) ...[
              _MonthlySeriesRow(
                clubName: clubNames[i],
                color: Color(agClubColor(i)),
                series: [
                  for (final p in points) p.byClub[clubNames[i]] ?? 0.0
                ],
                peak: peak,
                formatValue: _formatValue,
              ),
              if (i != clubNames.length - 1) const SizedBox(height: 10),
            ],
            const SizedBox(height: 10),
            // Month axis labels
            Padding(
              padding: const EdgeInsets.only(left: 60),
              child: Row(
                children: [
                  for (final m in months)
                    Expanded(
                      child: Text(
                        m,
                        textAlign: TextAlign.center,
                        style: AppFonts.body(
                          fontSize: 9.5,
                          color: AppColors.slate400,
                        ),
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

class _MonthlySeriesRow extends StatelessWidget {
  final String clubName;
  final Color color;
  final List<double> series;
  final double peak;
  final String Function(double) formatValue;
  const _MonthlySeriesRow({
    required this.clubName,
    required this.color,
    required this.series,
    required this.peak,
    required this.formatValue,
  });

  @override
  Widget build(BuildContext context) {
    final maxV = series.isEmpty ? 0.0 : series.reduce(math.max);
    final maxIdx = series.indexOf(maxV);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Container(
              width: 9,
              height: 9,
              decoration: BoxDecoration(color: color, shape: BoxShape.circle),
            ),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                clubName,
                style: AppFonts.body(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                ),
              ),
            ),
            Text(
              'Peak ${formatValue(maxV)}',
              style: AppFonts.body(
                fontSize: 10,
                fontWeight: FontWeight.w700,
                color: color,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
          ],
        ),
        const SizedBox(height: 4),
        SizedBox(
          height: 38,
          child: Row(
            children: [
              const SizedBox(width: 54),
              Expanded(
                child: CustomPaint(
                  painter: _LinePainter(
                    series: series,
                    peak: peak,
                    color: color,
                    highlightIndex: maxIdx,
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _LinePainter extends CustomPainter {
  final List<double> series;
  final double peak;
  final Color color;
  final int highlightIndex;
  const _LinePainter({
    required this.series,
    required this.peak,
    required this.color,
    required this.highlightIndex,
  });

  @override
  void paint(Canvas canvas, Size size) {
    if (series.isEmpty || peak <= 0) return;
    final paint = Paint()
      ..color = color
      ..strokeWidth = 2
      ..style = PaintingStyle.stroke
      ..strokeJoin = StrokeJoin.round
      ..strokeCap = StrokeCap.round;
    final fillPaint = Paint()
      ..color = color.withValues(alpha: 0.1)
      ..style = PaintingStyle.fill;

    final stepX = size.width / (series.length - 1).clamp(1, 99);
    final path = Path();
    final fillPath = Path();
    for (var i = 0; i < series.length; i++) {
      final x = stepX * i;
      final y = size.height - (series[i] / peak) * size.height;
      if (i == 0) {
        path.moveTo(x, y);
        fillPath.moveTo(x, size.height);
        fillPath.lineTo(x, y);
      } else {
        path.lineTo(x, y);
        fillPath.lineTo(x, y);
      }
    }
    fillPath.lineTo((series.length - 1) * stepX, size.height);
    fillPath.close();
    canvas.drawPath(fillPath, fillPaint);
    canvas.drawPath(path, paint);

    // Dots
    final dotPaint = Paint()..color = color;
    final dotStrokePaint = Paint()
      ..color = Colors.white
      ..strokeWidth = 1.5
      ..style = PaintingStyle.stroke;
    for (var i = 0; i < series.length; i++) {
      final x = stepX * i;
      final y = size.height - (series[i] / peak) * size.height;
      final isHi = i == highlightIndex;
      canvas.drawCircle(Offset(x, y), isHi ? 3.5 : 2.5, dotPaint);
      canvas.drawCircle(Offset(x, y), isHi ? 3.5 : 2.5, dotStrokePaint);
    }
  }

  @override
  bool shouldRepaint(covariant _LinePainter old) =>
      old.series != series ||
      old.color != color ||
      old.peak != peak ||
      old.highlightIndex != highlightIndex;
}
