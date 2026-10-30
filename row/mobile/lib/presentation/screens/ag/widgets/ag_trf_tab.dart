import 'package:flutter/material.dart' hide Text;
import '../../../../core/services/ag_dashboard_api.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../data/models/ag_dashboard_models.dart';
import 'ag_async.dart';
import 'ag_format.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// "Foundation & TRF" tab — The Rotary Foundation Giving. Wired to
/// `GET /api/mobile/ag-dashboard/trf`.
///
/// Layout:
///   1. Header (title + AG name + RY)
///   2. KPI strip (Total / Annual / PolioPlus / Other-Endowment)
///   3. AG banner (3-stop gradient — blue → blue → gold)
///   4. TRF stacked breakdown by club (giving clubs only)
///   5. Leaderboard (top 4 giving clubs with medals)
///   6. Per-club contribution bars (Wave-12A `percentOfAgTotal`)
///   7. Sortable detail table with dark "AG Total" footer
///
/// All TRF amounts on the model are in USD — the backend serves TRF in USD
/// (USD_INR = 1, no conversion), so they are shown with a "$" symbol.
class AgTrfTab extends StatefulWidget {
  final int? yearId;
  const AgTrfTab({super.key, this.yearId});

  @override
  State<AgTrfTab> createState() => _AgTrfTabState();
}

enum _TrfSort { name, annual, polio, endowment, others, total }

enum _TrfDir { asc, desc }

class _AgTrfTabState extends State<AgTrfTab>
    with AutomaticKeepAliveClientMixin<AgTrfTab> {
  final AgDashboardApi _api = AgDashboardApi();
  late Future<AgTrfResponse> _future;

  _TrfSort _sortKey = _TrfSort.total;
  _TrfDir _sortDir = _TrfDir.desc;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _future = _api.getTrf(yearId: widget.yearId);
  }

  @override
  void didUpdateWidget(covariant AgTrfTab old) {
    super.didUpdateWidget(old);
    if (old.yearId != widget.yearId) {
      setState(() => _future = _api.getTrf(yearId: widget.yearId));
    }
  }

  void _reload() =>
      setState(() => _future = _api.getTrf(yearId: widget.yearId));

  void _toggleSort(_TrfSort k) {
    setState(() {
      if (k == _sortKey) {
        _sortDir = _sortDir == _TrfDir.asc ? _TrfDir.desc : _TrfDir.asc;
      } else {
        _sortKey = k;
        _sortDir = _TrfDir.desc;
      }
    });
  }

  List<AgClubTrf> _sorted(List<AgClubTrf> clubs) {
    int Function(AgClubTrf, AgClubTrf) compare;
    switch (_sortKey) {
      case _TrfSort.name:
        compare = (a, b) => a.clubName.compareTo(b.clubName);
        break;
      case _TrfSort.annual:
        compare = (a, b) => a.trf.annualInr.compareTo(b.trf.annualInr);
        break;
      case _TrfSort.polio:
        compare = (a, b) => a.trf.polioInr.compareTo(b.trf.polioInr);
        break;
      case _TrfSort.endowment:
        compare = (a, b) => a.trf.endowment.compareTo(b.trf.endowment);
        break;
      case _TrfSort.others:
        compare = (a, b) => a.trf.others.compareTo(b.trf.others);
        break;
      case _TrfSort.total:
        compare = (a, b) => a.trf.totalInr.compareTo(b.trf.totalInr);
        break;
    }
    final list = [...clubs]..sort(compare);
    return _sortDir == _TrfDir.desc ? list.reversed.toList() : list;
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return FutureBuilder<AgTrfResponse>(
      future: _future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const AgLoading();
        }
        if (snap.hasError) {
          return AgError(error: snap.error!, onRetry: _reload);
        }
        final data = snap.data!;
        final agName = data.ag.name.isEmpty ? '–' : data.ag.name;
        final yearLabel =
            data.ag.yearLabel.isEmpty ? '2025–26' : data.ag.yearLabel;
        final givingClubs =
            data.clubs.where((c) => c.trf.totalInr > 0).length;

        return SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 32),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _Header(agName: agName, yearLabel: yearLabel),
              const SizedBox(height: 14),
              _KpiStrip(totals: data.totals),
              const SizedBox(height: 14),
              _AgBanner(
                totals: data.totals,
                agName: agName,
                yearLabel: yearLabel,
                clubCount: data.clubs.length,
                givingClubs: givingClubs,
              ),
              const SizedBox(height: 14),
              _StackedBreakdownCard(clubs: data.clubs),
              const SizedBox(height: 14),
              _LeaderboardCard(clubs: data.clubs),
              const SizedBox(height: 14),
              _ContributionCard(
                clubs: data.clubs,
                totals: data.totals,
                clubCount: data.clubs.length,
              ),
              const SizedBox(height: 14),
              _DetailTable(
                rows: _sorted(data.clubs),
                totals: data.totals,
                sortKey: _sortKey,
                sortDir: _sortDir,
                onSort: _toggleSort,
              ),
            ],
          ),
        );
      },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

const _annualColor = AppColors.rotaryBlue;
const _polioColor = AppColors.accentBlue;
const _endowmentColor = AppColors.goldPrime;
const _otherColor = AppColors.success;

// ─────────────────────────────────────────────────────────────────────────
// 1. Header
// ─────────────────────────────────────────────────────────────────────────

class _Header extends StatelessWidget {
  final String agName;
  final String yearLabel;
  const _Header({required this.agName, required this.yearLabel});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 36,
          height: 36,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: AppColors.avenueClubService.withValues(alpha: 0.10),
            borderRadius: BorderRadius.circular(10),
          ),
          child: const Icon(
            Icons.favorite_rounded,
            size: 18,
            color: AppColors.avenueClubService,
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'The Rotary Foundation Giving',
                style: AppFonts.body(
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                ),
              ),
              Text(
                'Charitable contributions · RY $yearLabel · AG: $agName',
                style: AppFonts.body(
                  fontSize: 13,
                  color: AppColors.slate500,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 2. KPI strip (2×2)
// ─────────────────────────────────────────────────────────────────────────

class _KpiStrip extends StatelessWidget {
  final AgTrfBreakdown totals;
  const _KpiStrip({required this.totals});

  @override
  Widget build(BuildContext context) {
    final otherEndowment = totals.endowment + totals.others;
    return Column(
      children: [
        Row(
          children: [
            Expanded(
              child: _KpiCard(
                icon: Icons.attach_money_rounded,
                label: 'Total Giving (USD)',
                value: agFmtUsd(totals.totalInr),
                sub: 'All TRF funds combined',
                color: AppColors.goldPrime,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _KpiCard(
                icon: Icons.trending_up_rounded,
                label: 'Annual Fund',
                value: agFmtUsd(totals.annualInr),
                sub: 'Unrestricted annual giving',
                color: _annualColor,
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: _KpiCard(
                icon: Icons.favorite_outline_rounded,
                label: 'PolioPlus Fund',
                value: agFmtUsd(totals.polioInr),
                sub: 'Polio eradication',
                color: _polioColor,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _KpiCard(
                icon: Icons.emoji_events_rounded,
                label: 'Other / Endowment',
                value: agFmtUsd(otherEndowment),
                sub: 'Designated & special',
                color: _otherColor,
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _KpiCard extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final String sub;
  final Color color;
  const _KpiCard({
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
                  label,
                  style: AppFonts.body(
                    fontSize: 13,
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
              fontSize: 17,
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
              fontSize: 13,
              color: AppColors.slate400,
            ),
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 3. AG banner — gradient blue → gold
// ─────────────────────────────────────────────────────────────────────────

class _AgBanner extends StatelessWidget {
  final AgTrfBreakdown totals;
  final String agName;
  final String yearLabel;
  final int clubCount;
  final int givingClubs;
  const _AgBanner({
    required this.totals,
    required this.agName,
    required this.yearLabel,
    required this.clubCount,
    required this.givingClubs,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
      decoration: BoxDecoration(
        color: AppColors.primaryDeep,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'TOTAL TRF GIVING',
                      style: AppFonts.body(
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                        color: Colors.white.withValues(alpha: 0.85),
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      agFmtUsd(totals.totalInr),
                      style: AppFonts.body(
                        fontSize: 28,
                        fontWeight: FontWeight.w800,
                        color: Colors.white,
                        height: 1.0,
                        fontFeatures: const [FontFeature.tabularFigures()],
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'AG: $agName · $clubCount club${clubCount == 1 ? "" : "s"} · RY $yearLabel',
                      style: AppFonts.body(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: Colors.white,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Flexible(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      'ANNUAL + POLIOPLUS + ENDOWMENT + OTHER',
                      textAlign: TextAlign.right,
                      style: AppFonts.body(
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                        color: Colors.white.withValues(alpha: 0.9),
                        letterSpacing: 0.3,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      'Combined giving across $givingClubs contributing club${givingClubs == 1 ? "" : "s"}',
                      textAlign: TextAlign.right,
                      style: AppFonts.body(
                        fontSize: 13,
                        color: Colors.white.withValues(alpha: 0.8),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          ClipRRect(
            borderRadius: BorderRadius.circular(999),
            child: Container(
              height: 8,
              color: Colors.white.withValues(alpha: 0.20),
              child: const Row(
                children: [
                  Expanded(child: ColoredBox(color: _endowmentColor)),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 4. Stacked breakdown — horizontal bars with fund segments
// ─────────────────────────────────────────────────────────────────────────

class _StackedBreakdownCard extends StatelessWidget {
  final List<AgClubTrf> clubs;
  const _StackedBreakdownCard({required this.clubs});

  @override
  Widget build(BuildContext context) {
    final rows = [...clubs]
      ..removeWhere((c) => c.trf.totalInr <= 0)
      ..sort((a, b) => b.trf.totalInr.compareTo(a.trf.totalInr));
    final peak = rows.isEmpty
        ? 0.0
        : rows.map((c) => c.trf.totalInr).reduce((a, b) => a > b ? a : b);

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
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'TRF Giving Breakdown by Club',
                      style: AppFonts.body(
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                        color: AppColors.slate700,
                      ),
                    ),
                    Text(
                      'Stacked by fund type · clubs with giving only',
                      style: AppFonts.body(
                        fontSize: 13,
                        color: AppColors.slate400,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.bar_chart_rounded,
                  size: 18, color: AppColors.slate400),
            ],
          ),
          const SizedBox(height: 12),
          if (rows.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 24),
              child: Center(
                child: Text(
                  'No TRF giving recorded yet.',
                  style: AppFonts.body(
                    fontSize: 13,
                    color: AppColors.slate400,
                  ),
                ),
              ),
            )
          else
            for (var i = 0; i < rows.length; i++) ...[
              _StackedRow(club: rows[i], peakInr: peak),
              if (i != rows.length - 1) const SizedBox(height: 10),
            ],
          if (rows.isNotEmpty) ...[
            const SizedBox(height: 12),
            const Wrap(
              spacing: 12,
              runSpacing: 4,
              children: [
                _LegendDot(color: _annualColor, label: 'Annual Fund'),
                _LegendDot(color: _polioColor, label: 'PolioPlus'),
                _LegendDot(color: _endowmentColor, label: 'Endowment'),
                _LegendDot(color: _otherColor, label: 'Other Funds'),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _StackedRow extends StatelessWidget {
  final AgClubTrf club;
  final double peakInr;
  const _StackedRow({required this.club, required this.peakInr});

  @override
  Widget build(BuildContext context) {
    final t = club.trf;
    final widthFrac = peakInr <= 0 ? 0.0 : t.totalInr / peakInr;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                club.clubName,
                style: AppFonts.body(
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                ),
                overflow: TextOverflow.ellipsis,
              ),
            ),
            Text(
              agFmtUsd(t.totalInr),
              style: AppFonts.body(
                fontSize: 13,
                fontWeight: FontWeight.w800,
                color: AppColors.rotaryBlue,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
          ],
        ),
        const SizedBox(height: 4),
        // Stacked bar with all 4 segments. Width relative to peak so all
        // bars share the same horizontal scale.
        LayoutBuilder(
          builder: (context, box) {
            final totalWidth = box.maxWidth * widthFrac;
            if (t.totalInr <= 0) {
              return SizedBox(
                height: 10,
                child: Container(
                  decoration: BoxDecoration(
                    color: AppColors.slate100,
                    borderRadius: BorderRadius.circular(999),
                  ),
                ),
              );
            }
            return SizedBox(
              height: 10,
              child: Stack(
                children: [
                  // Background track (full width)
                  Container(
                    decoration: BoxDecoration(
                      color: AppColors.slate100,
                      borderRadius: BorderRadius.circular(999),
                    ),
                  ),
                  // Filled stacked segments
                  ClipRRect(
                    borderRadius: BorderRadius.circular(999),
                    child: SizedBox(
                      width: totalWidth,
                      child: Row(
                        children: [
                          if (t.annualInr > 0)
                            Expanded(
                              flex: (t.annualInr).round().clamp(1, 99999999),
                              child: const ColoredBox(color: _annualColor),
                            ),
                          if (t.polioInr > 0)
                            Expanded(
                              flex: (t.polioInr).round().clamp(1, 99999999),
                              child: const ColoredBox(color: _polioColor),
                            ),
                          if (t.endowment > 0)
                            Expanded(
                              flex: (t.endowment).round().clamp(1, 99999999),
                              child: const ColoredBox(color: _endowmentColor),
                            ),
                          if (t.others > 0)
                            Expanded(
                              flex: (t.others).round().clamp(1, 99999999),
                              child: const ColoredBox(color: _otherColor),
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
            fontSize: 13,
            color: AppColors.slate500,
          ),
        ),
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 5. Leaderboard — top 4 giving clubs
// ─────────────────────────────────────────────────────────────────────────

class _LeaderboardCard extends StatelessWidget {
  final List<AgClubTrf> clubs;
  const _LeaderboardCard({required this.clubs});

  static const _medals = <String>['🥇', '🥈', '🥉'];

  @override
  Widget build(BuildContext context) {
    final ranked = [...clubs]
      ..removeWhere((c) => c.trf.totalInr <= 0)
      ..sort((a, b) => b.trf.totalInr.compareTo(a.trf.totalInr));
    final top = ranked.take(4).toList();

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
              Expanded(
                child: Text(
                  'Top Giving Clubs',
                  style: AppFonts.body(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: AppColors.slate700,
                  ),
                ),
              ),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: AppColors.slate100,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  'My Clubs',
                  style: AppFonts.body(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: AppColors.slate500,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          if (top.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 18),
              child: Center(
                child: Text(
                  'No giving yet.',
                  style: AppFonts.body(
                    fontSize: 13,
                    color: AppColors.slate400,
                  ),
                ),
              ),
            )
          else
            for (var i = 0; i < top.length; i++)
              _LeaderboardRow(
                rankPrefix: i < 3 ? _medals[i] : '#${i + 1}',
                club: top[i],
                isLast: i == top.length - 1,
              ),
        ],
      ),
    );
  }
}

class _LeaderboardRow extends StatelessWidget {
  final String rankPrefix;
  final AgClubTrf club;
  final bool isLast;
  const _LeaderboardRow({
    required this.rankPrefix,
    required this.club,
    required this.isLast,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        children: [
          Row(
            children: [
              SizedBox(
                width: 28,
                child: Text(
                  rankPrefix,
                  textAlign: TextAlign.center,
                  style: AppFonts.body(
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                    color: AppColors.slate500,
                  ),
                ),
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      club.clubName,
                      style: AppFonts.body(
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                    Text(
                      '${club.members} member${club.members == 1 ? "" : "s"}',
                      style: AppFonts.body(
                        fontSize: 13,
                        color: AppColors.slate400,
                      ),
                    ),
                  ],
                ),
              ),
              Text(
                agFmtUsd(club.trf.totalInr),
                style: AppFonts.body(
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                  color: AppColors.rotaryBlue,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
            ],
          ),
          if (!isLast) ...[
            const SizedBox(height: 8),
            Container(height: 1, color: AppColors.slate100),
          ],
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 6. Per-club contribution bars (Wave-12A percentOfAgTotal)
// ─────────────────────────────────────────────────────────────────────────

class _ContributionCard extends StatelessWidget {
  final List<AgClubTrf> clubs;
  final AgTrfBreakdown totals;
  final int clubCount;
  const _ContributionCard({
    required this.clubs,
    required this.totals,
    required this.clubCount,
  });

  @override
  Widget build(BuildContext context) {
    final ranked = [...clubs]
      ..removeWhere((c) => c.trf.totalInr <= 0)
      ..sort((a, b) => b.percentOfAgTotal.compareTo(a.percentOfAgTotal));

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
              Expanded(
                child: Text.rich(
                  TextSpan(
                    children: [
                      TextSpan(
                        text: 'MY CLUBS TRF SUMMARY',
                        style: AppFonts.body(
                          fontSize: 13,
                          fontWeight: FontWeight.w800,
                          color: AppColors.slate700,
                        ),
                      ),
                      TextSpan(
                        text: ': Per-club contribution',
                        style: AppFonts.body(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: AppColors.slate400,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (ranked.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 18),
              child: Center(
                child: Text(
                  'No TRF contributions recorded yet.',
                  style: AppFonts.body(
                    fontSize: 13,
                    color: AppColors.slate400,
                  ),
                ),
              ),
            )
          else ...[
            for (final c in ranked) ...[
              _ContributionRow(club: c),
              const SizedBox(height: 8),
            ],
            const _AgTotalContributionRow(),
            const SizedBox(height: 8),
            Text(
              'Combined giving across $clubCount club${clubCount == 1 ? "" : "s"}',
              textAlign: TextAlign.right,
              style: AppFonts.body(
                fontSize: 13,
                color: AppColors.slate400,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _ContributionRow extends StatelessWidget {
  final AgClubTrf club;
  const _ContributionRow({required this.club});

  @override
  Widget build(BuildContext context) {
    final pct = club.percentOfAgTotal; // 0–100
    final frac = (pct / 100).clamp(0.0, 1.0);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                club.clubName,
                style: AppFonts.body(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: AppColors.slate700,
                ),
                overflow: TextOverflow.ellipsis,
              ),
            ),
            Text(
              '${pct.toStringAsFixed(1)}% of AG total',
              style: AppFonts.body(
                fontSize: 13,
                fontWeight: FontWeight.w800,
                color: AppColors.rotaryBlue,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
          ],
        ),
        const SizedBox(height: 4),
        ClipRRect(
          borderRadius: BorderRadius.circular(999),
          child: LinearProgressIndicator(
            value: frac,
            minHeight: 14,
            backgroundColor: AppColors.slate100,
            valueColor:
                const AlwaysStoppedAnimation<Color>(AppColors.rotaryBlue),
          ),
        ),
      ],
    );
  }
}

class _AgTotalContributionRow extends StatelessWidget {
  const _AgTotalContributionRow();

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                'AG Total (All Clubs)',
                style: AppFonts.body(
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                  color: AppColors.slate700,
                ),
              ),
            ),
            Text(
              '100% of AG total',
              style: AppFonts.body(
                fontSize: 13,
                fontWeight: FontWeight.w800,
                color: AppColors.goldPrime,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
          ],
        ),
        const SizedBox(height: 4),
        ClipRRect(
          borderRadius: BorderRadius.circular(999),
          child: const LinearProgressIndicator(
            value: 1.0,
            minHeight: 14,
            backgroundColor: AppColors.slate100,
            valueColor: const AlwaysStoppedAnimation<Color>(AppColors.goldPrime),
          ),
        ),
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 7. Detail table (sortable, columnar with dark AG-Total footer)
// ─────────────────────────────────────────────────────────────────────────

class _DetailTable extends StatelessWidget {
  final List<AgClubTrf> rows;
  final AgTrfBreakdown totals;
  final _TrfSort sortKey;
  final _TrfDir sortDir;
  final ValueChanged<_TrfSort> onSort;
  const _DetailTable({
    required this.rows,
    required this.totals,
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
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Detailed TRF Giving',
                  style: AppFonts.body(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: AppColors.slate700,
                  ),
                ),
              ),
              Text(
                'Tap a fund to sort',
                style: AppFonts.body(
                  fontSize: 13,
                  color: AppColors.slate400,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Align(alignment: Alignment.centerLeft, child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(vertical: 2),
            child: Row(
              children: [
                for (final ch in _trfChips)
                  Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: _TrfSortChip(
                      label: ch.$2,
                      active: sortKey == ch.$1,
                      dir: sortDir,
                      onTap: () => onSort(ch.$1),
                    ),
                  ),
              ],
            ),
          )),
          const SizedBox(height: 12),
          if (rows.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 26),
              child: Center(
                child: Text(
                  'No clubs found.',
                  style: AppFonts.body(
                    fontSize: 13,
                    color: AppColors.slate400,
                  ),
                ),
              ),
            )
          else
            Column(
              children: [
                for (final c in rows)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: _TrfClubCard(club: c),
                  ),
              ],
            ),
          _AgTotalCard(totals: totals),
        ],
      ),
    );
  }
}

// Sortable funds — (key, chip label).
const _trfChips = <(_TrfSort, String)>[
  (_TrfSort.total, 'Total'),
  (_TrfSort.annual, 'Annual'),
  (_TrfSort.polio, 'PolioPlus'),
  (_TrfSort.endowment, 'Endowment'),
  (_TrfSort.others, 'Other'),
  (_TrfSort.name, 'Club Name'),
];

// Compact fund value — em-dash for zero.
String _fundShort(double v) => v <= 0 ? '–' : agFmtUsdShort(v);

class _TrfSortChip extends StatelessWidget {
  final String label;
  final bool active;
  final _TrfDir dir;
  final VoidCallback onTap;
  const _TrfSortChip({
    required this.label,
    required this.active,
    required this.dir,
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
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                label,
                style: AppFonts.body(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: active ? Colors.white : AppColors.slate500,
                ),
              ),
              if (active) ...[
                const SizedBox(width: 2),
                Icon(
                  dir == _TrfDir.asc
                      ? Icons.arrow_upward_rounded
                      : Icons.arrow_downward_rounded,
                  size: 12,
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

class _TrfClubCard extends StatelessWidget {
  final AgClubTrf club;
  const _TrfClubCard({required this.club});

  @override
  Widget build(BuildContext context) {
    final t = club.trf;
    final funds = <(String, double)>[
      ('Annual', t.annualInr),
      ('PolioPlus', t.polioInr),
      ('Endowment', t.endowment),
      ('Other', t.others),
    ];
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.slate200),
      ),
      padding: const EdgeInsets.fromLTRB(12, 11, 12, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  club.clubName.isEmpty ? '–' : club.clubName,
                  style: AppFonts.body(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: 6),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                decoration: BoxDecoration(
                  color: AppColors.rotaryBlue.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  t.totalInr <= 0 ? '–' : agFmtUsd(t.totalInr),
                  style: AppFonts.body(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: AppColors.rotaryBlue,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              for (var i = 0; i < funds.length; i++) ...[
                if (i != 0) const SizedBox(width: 8),
                Expanded(
                  child: _TrfFundTile(
                    label: funds[i].$1,
                    value: _fundShort(funds[i].$2),
                  ),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }
}

class _TrfFundTile extends StatelessWidget {
  final String label;
  final String value;
  const _TrfFundTile({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    final empty = value == '–';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 7),
      decoration: BoxDecoration(
        color: AppColors.slate50,
        borderRadius: BorderRadius.circular(9),
        border: Border.all(color: AppColors.slate200),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: AppFonts.body(
              fontSize: 13,
              fontWeight: FontWeight.w800,
              color: AppColors.slate400,
              letterSpacing: 0.3,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: 2),
          Text(
            value,
            style: AppFonts.body(
              fontSize: 13,
              fontWeight: FontWeight.w800,
              color: empty ? AppColors.slate400 : AppColors.textPrimary,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ),
    );
  }
}

class _AgTotalCard extends StatelessWidget {
  final AgTrfBreakdown totals;
  const _AgTotalCard({required this.totals});

  @override
  Widget build(BuildContext context) {
    final funds = <(String, double)>[
      ('Annual', totals.annualInr),
      ('PolioPlus', totals.polioInr),
      ('Endowment', totals.endowment),
      ('Other', totals.others),
    ];
    return Container(
      decoration: BoxDecoration(
        color: AppColors.primaryDeep,
        borderRadius: BorderRadius.circular(14),
      ),
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'AG Total',
                  style: AppFonts.body(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: Colors.white,
                    letterSpacing: 0.3,
                  ),
                ),
              ),
              Text(
                agFmtUsd(totals.totalInr),
                style: AppFonts.body(
                  fontSize: 15,
                  fontWeight: FontWeight.w800,
                  color: Colors.white,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              for (var i = 0; i < funds.length; i++) ...[
                if (i != 0) const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        funds[i].$1,
                        style: AppFonts.body(
                          fontSize: 13,
                          fontWeight: FontWeight.w800,
                          color: Colors.white.withValues(alpha: 0.6),
                          letterSpacing: 0.3,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        _fundShort(funds[i].$2),
                        style: AppFonts.body(
                          fontSize: 13,
                          fontWeight: FontWeight.w800,
                          color: Colors.white,
                          fontFeatures: const [FontFeature.tabularFigures()],
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }
}
