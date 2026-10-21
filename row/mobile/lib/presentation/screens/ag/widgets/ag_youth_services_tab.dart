import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../../../core/services/ag_dashboard_api.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../data/models/ag_dashboard_models.dart';
import 'ag_async.dart';
import 'ag_format.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// "Youth Services" tab — wired to `GET /api/mobile/ag-dashboard/youth`.
///
/// Layout:
///   1. Header (title + "across all {n} clubs — Rotary Year {yearLabel}")
///   2. KPI strip (New Generation / Vocational / International / Total Projects)
///   3. Per-club New Generation count — horizontal progress bars (% of group)
///   4. Per-club service breakdown — grouped horizontal bars (NewGen/Voc/Intl)
///   5. Club-wise service table — header + card rows + totals footer
///   6. Per-club service detail cards (one per club)
class AgYouthServicesTab extends StatefulWidget {
  final int? yearId;
  const AgYouthServicesTab({super.key, this.yearId});

  @override
  State<AgYouthServicesTab> createState() => _AgYouthServicesTabState();
}

class _AgYouthServicesTabState extends State<AgYouthServicesTab>
    with AutomaticKeepAliveClientMixin<AgYouthServicesTab> {
  final AgDashboardApi _api = AgDashboardApi();
  late Future<AgYouthResponse> _future;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _future = _api.getYouth(yearId: widget.yearId);
  }

  @override
  void didUpdateWidget(covariant AgYouthServicesTab old) {
    super.didUpdateWidget(old);
    if (old.yearId != widget.yearId) {
      setState(() => _future = _api.getYouth(yearId: widget.yearId));
    }
  }

  void _reload() =>
      setState(() => _future = _api.getYouth(yearId: widget.yearId));

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return FutureBuilder<AgYouthResponse>(
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
              _KpiStrip(data: data),
              const SizedBox(height: 14),
              _NewGenPerClubCard(data: data),
              const SizedBox(height: 14),
              _ServiceBreakdownCard(data: data),
              const SizedBox(height: 14),
              _ServiceTableCard(data: data),
              if (data.clubs.isNotEmpty) ...[
                const SizedBox(height: 14),
                _ClubDetailCards(data: data),
              ],
            ],
          ),
        );
      },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Shared color tokens
// ─────────────────────────────────────────────────────────────────────────

const _newGenColor = AppColors.goldPrime; // Rotary gold
const _vocColor = AppColors.rotaryBlue;
const _intlColor = AppColors.accentBlue;
const _projectColor = AppColors.statusDone;

// ─────────────────────────────────────────────────────────────────────────
// 1. Header
// ─────────────────────────────────────────────────────────────────────────

class _Header extends StatelessWidget {
  final AgYouthResponse data;
  const _Header({required this.data});

  @override
  Widget build(BuildContext context) {
    final n = data.clubs.length;
    final agName = data.ag.name.isEmpty ? '–' : data.ag.name;
    final year = data.ag.yearLabel.isEmpty ? '–' : data.ag.yearLabel;
    return Row(
      children: [
        Container(
          width: 36,
          height: 36,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: _newGenColor.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(10),
          ),
          child: const Icon(Icons.star_rounded, size: 18, color: _newGenColor),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Youth & New Generation Services',
                style: AppFonts.body(
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                ),
              ),
              Text(
                'New service activities across all $n club${n == 1 ? "" : "s"}: Rotary Year $year · AG: $agName',
                style: AppFonts.body(
                  fontSize: 11,
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
  final AgYouthResponse data;
  const _KpiStrip({required this.data});

  @override
  Widget build(BuildContext context) {
    final n = data.clubs.length;
    final across = 'across $n club${n == 1 ? "" : "s"}';
    return Column(
      children: [
        Row(
          children: [
            Expanded(
              child: _KpiTile(
                icon: Icons.star_rounded,
                label: 'New Generation Service',
                value: agFmtInt(data.totalNewGeneration),
                sub: across,
                color: _newGenColor,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _KpiTile(
                icon: Icons.work_outline_rounded,
                label: 'Vocational Service',
                value: agFmtInt(data.totalVocational),
                sub: across,
                color: _vocColor,
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: _KpiTile(
                icon: Icons.public_rounded,
                label: 'International Service',
                value: agFmtInt(data.totalInternational),
                sub: across,
                color: _intlColor,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _KpiTile(
                icon: Icons.menu_book_rounded,
                label: 'Total Projects',
                value: agFmtInt(data.totalProjects),
                sub: 'all service categories',
                color: _projectColor,
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
              fontSize: 20,
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
// 3. Per-club New Generation count
// ─────────────────────────────────────────────────────────────────────────

class _NewGenPerClubCard extends StatelessWidget {
  final AgYouthResponse data;
  const _NewGenPerClubCard({required this.data});

  @override
  Widget build(BuildContext context) {
    final clubs = data.clubs;
    final groupTotal = data.totalNewGeneration;
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
          Text(
            'Per-Club New Generation Service Count',
            style: AppFonts.body(
              fontSize: 13,
              fontWeight: FontWeight.w800,
              color: AppColors.slate700,
            ),
          ),
          Text(
            'New Generation Service by club',
            style: AppFonts.body(
              fontSize: 11,
              color: AppColors.slate400,
            ),
          ),
          const SizedBox(height: 12),
          if (clubs.isEmpty)
            const _CardEmpty(text: 'No clubs in scope.')
          else
            for (var i = 0; i < clubs.length; i++) ...[
              _NewGenBar(
                clubName: clubs[i].clubName,
                clubVal: clubs[i].newGenerationService,
                groupTotal: groupTotal,
              ),
              if (i != clubs.length - 1) const SizedBox(height: 12),
            ],
        ],
      ),
    );
  }
}

class _NewGenBar extends StatelessWidget {
  final String clubName;
  final int clubVal;
  final int groupTotal;
  const _NewGenBar({
    required this.clubName,
    required this.clubVal,
    required this.groupTotal,
  });

  @override
  Widget build(BuildContext context) {
    final total = groupTotal > 0 ? groupTotal : 1;
    final pct = clubVal / total;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                clubName,
                style: AppFonts.body(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: AppColors.slate700,
                ),
              ),
            ),
            Text.rich(
              TextSpan(
                style: AppFonts.body(
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                  color: AppColors.warningInk,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
                children: [
                  TextSpan(text: '$clubVal'),
                  TextSpan(
                    text: ' / $groupTotal total',
                    style: const TextStyle(
                      color: AppColors.slate400,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 4),
        ClipRRect(
          borderRadius: BorderRadius.circular(999),
          child: LinearProgressIndicator(
            value: pct.clamp(0.0, 1.0),
            minHeight: 9,
            backgroundColor: AppColors.slate100,
            valueColor: const AlwaysStoppedAnimation<Color>(_newGenColor),
          ),
        ),
        const SizedBox(height: 2),
        Align(
          alignment: Alignment.centerRight,
          child: Text(
            '${(pct * 100).toStringAsFixed(1)}% of all clubs',
            style: AppFonts.body(
              fontSize: 9.5,
              color: AppColors.slate400,
            ),
          ),
        ),
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 4. Per-club service breakdown — 3-metric grouped horizontal bars
// ─────────────────────────────────────────────────────────────────────────

class _ServiceBreakdownCard extends StatelessWidget {
  final AgYouthResponse data;
  const _ServiceBreakdownCard({required this.data});

  @override
  Widget build(BuildContext context) {
    // Only clubs with at least one of the three metrics > 0
    final rows = data.clubs
        .where((c) =>
            c.newGenerationService +
                c.vocationalService +
                c.internationalService >
            0)
        .toList();
    final peak = rows.isEmpty
        ? 1
        : rows
            .map((c) => math.max(
                c.newGenerationService,
                math.max(c.vocationalService, c.internationalService)))
            .reduce(math.max);

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
          Text(
            'Per-Club Service Breakdown',
            style: AppFonts.body(
              fontSize: 13,
              fontWeight: FontWeight.w800,
              color: AppColors.slate700,
            ),
          ),
          Text(
            'New generation, vocational and international service activities per club',
            style: AppFonts.body(
              fontSize: 11,
              color: AppColors.slate400,
            ),
          ),
          const SizedBox(height: 12),
          if (rows.isEmpty)
            const _CardEmpty(text: 'No service activities yet.')
          else ...[
            for (var i = 0; i < rows.length; i++) ...[
              _BreakdownClubRows(club: rows[i], peak: peak),
              if (i != rows.length - 1) const SizedBox(height: 12),
            ],
            const SizedBox(height: 10),
            const Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                _LegendDot(color: _newGenColor, label: 'New Generation'),
                SizedBox(width: 12),
                _LegendDot(color: _vocColor, label: 'Vocational'),
                SizedBox(width: 12),
                _LegendDot(color: _intlColor, label: 'International'),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _BreakdownClubRows extends StatelessWidget {
  final AgYouthClubRow club;
  final int peak;
  const _BreakdownClubRows({required this.club, required this.peak});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          club.clubName,
          style: AppFonts.body(
            fontSize: 12,
            fontWeight: FontWeight.w800,
            color: AppColors.textPrimary,
          ),
        ),
        const SizedBox(height: 4),
        _MetricBar(
          label: 'New Gen',
          value: club.newGenerationService,
          peak: peak,
          color: _newGenColor,
        ),
        _MetricBar(
          label: 'Vocational',
          value: club.vocationalService,
          peak: peak,
          color: _vocColor,
        ),
        _MetricBar(
          label: 'International',
          value: club.internationalService,
          peak: peak,
          color: _intlColor,
        ),
      ],
    );
  }
}

class _MetricBar extends StatelessWidget {
  final String label;
  final int value;
  final int peak;
  final Color color;
  const _MetricBar({
    required this.label,
    required this.value,
    required this.peak,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    final pct = peak == 0 ? 0.0 : value / peak;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          SizedBox(
            width: 80,
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
                value: pct.clamp(0.0, 1.0),
                minHeight: 7,
                backgroundColor: AppColors.slate100,
                valueColor: AlwaysStoppedAnimation<Color>(color),
              ),
            ),
          ),
          const SizedBox(width: 8),
          SizedBox(
            width: 32,
            child: Text(
              value > 0 ? '$value' : '–',
              textAlign: TextAlign.right,
              style: AppFonts.body(
                fontSize: 11,
                fontWeight: FontWeight.w800,
                color: value > 0 ? color : AppColors.slate400,
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

// ─────────────────────────────────────────────────────────────────────────
// 5. Club-wise service table — header + card rows + totals footer
// ─────────────────────────────────────────────────────────────────────────

class _ServiceTableCard extends StatelessWidget {
  final AgYouthResponse data;
  const _ServiceTableCard({required this.data});

  @override
  Widget build(BuildContext context) {
    final clubs = data.clubs;
    final year = data.ag.yearLabel.isEmpty ? '–' : data.ag.yearLabel;
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
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Club-wise Service Activity',
                  style: AppFonts.body(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: AppColors.slate700,
                  ),
                ),
                Text(
                  'Service category counts per club · RY $year',
                  style: AppFonts.body(
                    fontSize: 11,
                    color: AppColors.slate400,
                  ),
                ),
              ],
            ),
          ),
          // Column-header strip (CLUB NAME / NEW GENERATION / VOCATIONAL /
          // INTERNATIONAL / TOTAL PROJECTS / MEMBERS).
          Container(
            padding: const EdgeInsets.fromLTRB(14, 8, 14, 8),
            decoration: const BoxDecoration(
              color: AppColors.slate50,
              border: Border(bottom: BorderSide(color: AppColors.slate100)),
            ),
            child: const Wrap(
              spacing: 12,
              runSpacing: 2,
              children: [
                _ColHead('Club Name'),
                _ColHead('New Generation'),
                _ColHead('Vocational'),
                _ColHead('International'),
                _ColHead('Total Projects'),
                _ColHead('Members'),
              ],
            ),
          ),
          if (clubs.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 34),
              child: Center(child: _EmptyText('No clubs in scope.')),
            )
          else
            for (final c in clubs) _ServiceRow(club: c),
          // Totals row
          if (clubs.isNotEmpty)
            Container(
              padding: const EdgeInsets.fromLTRB(14, 10, 14, 12),
              decoration: const BoxDecoration(
                color: AppColors.slate50,
                border: Border(
                  top: BorderSide(color: AppColors.slate400, width: 1.5),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'ALL CLUBS TOTAL',
                    style: AppFonts.body(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w800,
                      color: AppColors.slate500,
                      letterSpacing: 0.5,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 14,
                    runSpacing: 4,
                    children: [
                      _ValueChip(
                        label: 'New Gen',
                        value: agFmtInt(data.totalNewGeneration),
                      ),
                      _ValueChip(
                        label: 'Vocational',
                        value: agFmtInt(data.totalVocational),
                      ),
                      _ValueChip(
                        label: 'International',
                        value: agFmtInt(data.totalInternational),
                      ),
                      _ValueChip(
                        label: 'Total Projects',
                        value: agFmtInt(data.totalProjects),
                      ),
                      _ValueChip(
                        label: 'Members',
                        value: agFmtInt(
                          clubs.fold<int>(0, (s, c) => s + c.members),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _ColHead extends StatelessWidget {
  final String label;
  const _ColHead(this.label);

  @override
  Widget build(BuildContext context) {
    return Text(
      label.toUpperCase(),
      style: AppFonts.body(
        fontSize: 9,
        fontWeight: FontWeight.w800,
        color: AppColors.slate400,
        letterSpacing: 0.5,
      ),
    );
  }
}

class _ServiceRow extends StatelessWidget {
  final AgYouthClubRow club;
  const _ServiceRow({required this.club});

  @override
  Widget build(BuildContext context) {
    final isZero = club.newGenerationService +
            club.vocationalService +
            club.internationalService ==
        0;
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
      decoration: BoxDecoration(
        color: isZero ? AppColors.slate50 : Colors.white,
        border: const Border(bottom: BorderSide(color: AppColors.slate100)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            club.clubName,
            style: AppFonts.body(
              fontSize: 12.5,
              fontWeight: FontWeight.w800,
              color: isZero ? AppColors.slate400 : AppColors.textPrimary,
            ),
          ),
          const SizedBox(height: 6),
          Wrap(
            spacing: 14,
            runSpacing: 4,
            children: [
              _CellValue(
                label: 'New Gen',
                value: club.newGenerationService,
                color: _newGenColor,
              ),
              _CellValue(
                label: 'Voc',
                value: club.vocationalService,
                color: _vocColor,
              ),
              _CellValue(
                label: 'Intl',
                value: club.internationalService,
                color: _intlColor,
              ),
              _CellValue(
                label: 'Projects',
                value: club.totalProjects,
                color: _projectColor,
              ),
              _CellValue(
                label: 'Members',
                value: club.members,
                color: AppColors.slate500,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _CellValue extends StatelessWidget {
  final String label;
  final int value;
  final Color color;
  const _CellValue({
    required this.label,
    required this.value,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    final hasValue = value > 0;
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
          hasValue ? agFmtInt(value) : '–',
          style: AppFonts.body(
            fontSize: 11.5,
            fontWeight: FontWeight.w800,
            color: hasValue ? color : AppColors.slate400,
            fontFeatures: const [FontFeature.tabularFigures()],
          ),
        ),
      ],
    );
  }
}

class _ValueChip extends StatelessWidget {
  final String label;
  final String value;
  const _ValueChip({required this.label, required this.value});

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
// 6. Per-club service detail cards (only rendered when clubs exist)
// ─────────────────────────────────────────────────────────────────────────

class _ClubDetailCards extends StatelessWidget {
  final AgYouthResponse data;
  const _ClubDetailCards({required this.data});

  @override
  Widget build(BuildContext context) {
    final clubs = data.clubs;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'NEW GENERATION SERVICE DETAIL BY CLUB',
          style: AppFonts.body(
            fontSize: 10,
            fontWeight: FontWeight.w800,
            color: AppColors.slate500,
            letterSpacing: 0.7,
          ),
        ),
        const SizedBox(height: 8),
        for (var row = 0; row * 2 < clubs.length; row++) ...[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (var col = 0; col < 2; col++) ...[
                Expanded(
                  child: row * 2 + col < clubs.length
                      ? _ClubDetailCard(club: clubs[row * 2 + col])
                      : const SizedBox.shrink(),
                ),
                if (col == 0) const SizedBox(width: 10),
              ],
            ],
          ),
          if ((row + 1) * 2 < clubs.length) const SizedBox(height: 10),
        ],
      ],
    );
  }
}

class _ClubDetailCard extends StatelessWidget {
  final AgYouthClubRow club;
  const _ClubDetailCard({required this.club});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.slate200),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
            color: AppColors.rotaryBlue,
            child: Text(
              club.clubName,
              style: AppFonts.body(
                fontSize: 12,
                fontWeight: FontWeight.w800,
                color: Colors.white,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(10, 10, 10, 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _StatRow(
                  label: 'New Generation',
                  value: club.newGenerationService,
                  color: _newGenColor,
                ),
                const SizedBox(height: 6),
                _StatRow(
                  label: 'Vocational',
                  value: club.vocationalService,
                  color: _vocColor,
                ),
                const SizedBox(height: 6),
                _StatRow(
                  label: 'International',
                  value: club.internationalService,
                  color: _intlColor,
                ),
                const SizedBox(height: 6),
                _StatRow(
                  label: 'Total Projects',
                  value: club.totalProjects,
                  color: _projectColor,
                ),
                const SizedBox(height: 6),
                Container(height: 1, color: AppColors.slate100),
                const SizedBox(height: 6),
                Text(
                  '${agFmtInt(club.members)} members · ${agFmtInt(club.meetings)} meetings',
                  style: AppFonts.body(
                    fontSize: 10,
                    color: AppColors.slate400,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _StatRow extends StatelessWidget {
  final String label;
  final int value;
  final Color color;
  const _StatRow({
    required this.label,
    required this.value,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    final hasValue = value > 0;
    return Row(
      children: [
        Expanded(
          child: Text(
            label,
            style: AppFonts.body(
              fontSize: 11,
              color: AppColors.slate500,
            ),
          ),
        ),
        Text(
          hasValue ? agFmtInt(value) : '–',
          style: AppFonts.body(
            fontSize: 12.5,
            fontWeight: FontWeight.w800,
            color: hasValue ? color : AppColors.slate400,
            fontFeatures: const [FontFeature.tabularFigures()],
          ),
        ),
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Shared empty-state helpers
// ─────────────────────────────────────────────────────────────────────────

class _CardEmpty extends StatelessWidget {
  final String text;
  const _CardEmpty({required this.text});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 18),
      child: Center(child: _EmptyText(text)),
    );
  }
}

class _EmptyText extends StatelessWidget {
  final String text;
  const _EmptyText(this.text);

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: AppFonts.body(
        fontSize: 11.5,
        color: AppColors.slate400,
      ),
    );
  }
}
