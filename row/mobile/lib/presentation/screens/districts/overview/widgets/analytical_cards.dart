import 'package:flutter/material.dart';
import '../../../../../core/services/district_analytics_service.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../data/models/district_admin_dashboard_models.dart';
import 'district_dashboard_async.dart';
import 'donut_chart.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// The four analytical panel cards rendered below the KPI strip on the District
/// Overview screen. Each card reads the live `/overview` response from
/// `DistrictOverviewScope.of(context)`. When the underlying panel `isPending`
/// the card shows a `DaPendingChip` in its header and a muted "Pending data"
/// placeholder body — never the raw 0.

// ─────────────────────────────────────────────────────────────────────────
// Shared building blocks
// ─────────────────────────────────────────────────────────────────────────

/// Card chrome: white surface, rounded, slate border, header (icon + title +
/// subtitle + optional trailing Pending chip), then the body.
class _PanelCard extends StatelessWidget {
  final IconData icon;
  final Color iconColor;
  final String title;
  final String subtitle;
  final bool pending;
  final Widget child;
  const _PanelCard({
    required this.icon,
    required this.iconColor,
    required this.title,
    required this.subtitle,
    required this.pending,
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
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 30,
                height: 30,
                decoration: BoxDecoration(
                  color: iconColor.withValues(alpha: 0.10),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(icon, size: 16, color: iconColor),
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
                        fontSize: 14,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 1),
                    Text(
                      subtitle,
                      style: AppFonts.body(
                        fontSize: 11,
                        fontWeight: FontWeight.w500,
                        color: AppColors.slate500,
                      ),
                    ),
                  ],
                ),
              ),
              if (pending) ...[
                const SizedBox(width: 8),
                const DaPendingChip(),
              ],
            ],
          ),
          const SizedBox(height: 14),
          child,
        ],
      ),
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
    final clamped = progress.isNaN ? 0.0 : progress.clamp(0.0, 1.0);
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
                  fontWeight: FontWeight.w500,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const SizedBox(width: 8),
            Text(
              valueDisplay,
              style: AppFonts.body(
                fontSize: 11.5,
                fontWeight: FontWeight.w700,
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
            value: clamped,
            minHeight: 6,
            backgroundColor: AppColors.slate100,
            valueColor: AlwaysStoppedAnimation<Color>(color),
          ),
        ),
      ],
    );
  }
}

class _Divider extends StatelessWidget {
  const _Divider();
  @override
  Widget build(BuildContext context) =>
      Container(height: 1, color: AppColors.slate100);
}

class _FooterRow extends StatelessWidget {
  final String label;
  final String value;
  const _FooterRow(this.label, this.value);

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Flexible(
          child: Text(
            label,
            style: AppFonts.body(
              fontSize: 11.5,
              color: AppColors.slate500,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
        const SizedBox(width: 8),
        Text(
          value,
          style: AppFonts.body(
            fontSize: 12.5,
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
// 1. Membership card — "Current vs district goal"
// ─────────────────────────────────────────────────────────────────────────

class MembershipCard extends StatelessWidget {
  const MembershipCard({super.key});

  @override
  Widget build(BuildContext context) {
    final d = DistrictOverviewScope.of(context);
    final clubs = d.totalClubs;
    return _PanelCard(
      icon: Icons.groups_rounded,
      iconColor: AppColors.rotaryBlue,
      title: 'Membership',
      subtitle: 'All $clubs club${clubs == 1 ? '' : 's'}'
          '${d.district.yearLabel.isEmpty ? '' : ' · RY ${d.district.yearLabel}'}',
      pending: false,
      child: _body(d),
    );
  }

  Widget _body(DistrictAdminOverview d) {
    // Active count = TotalMembers (backend: TotalMembers already = IsActive=1).
    final total = d.totalMembers;
    // Bars are scaled relative to total members so "Active" reads as full.
    final scale = total <= 0 ? 1 : total;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              '$total',
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
        _ProgressRow(
            label: 'Active',
            valueDisplay: '$total',
            progress: 1.0,
            color: AppColors.success),
        const SizedBox(height: 8),
        _ProgressRow(
            label: 'Male',
            valueDisplay: '${d.maleMembers}',
            progress: d.maleMembers / scale,
            color: AppColors.rotaryBlue),
        const SizedBox(height: 8),
        _ProgressRow(
            label: 'Female',
            valueDisplay: '${d.femaleMembers}',
            progress: d.femaleMembers / scale,
            color: AppColors.accentBlue),
        const SizedBox(height: 8),
        _ProgressRow(
            label: 'Honorary',
            valueDisplay: '${d.honoraryMembers}',
            progress: d.honoraryMembers / scale,
            color: AppColors.accentBlue),
        const SizedBox(height: 8),
        _ProgressRow(
            label: 'Inactive',
            valueDisplay: '${d.inactiveMembers}',
            progress: d.inactiveMembers / scale,
            color: AppColors.slate400),
        const SizedBox(height: 12),
        const _Divider(),
        const SizedBox(height: 8),
        _FooterRow('Terminated this RY', '${d.terminatedThisYear}'),
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 2. TRF Contribution card — total raised + per-fund breakdown (district-wide)
// ─────────────────────────────────────────────────────────────────────────

class TrfGoalCard extends StatelessWidget {
  const TrfGoalCard({super.key});

  @override
  Widget build(BuildContext context) {
    final d = DistrictOverviewScope.of(context);
    return _PanelCard(
      icon: Icons.favorite_rounded,
      iconColor: AppColors.donutFillAmber,
      title: 'TRF Contribution',
      subtitle: 'District aggregate · all clubs',
      pending: false,
      child: _body(d),
    );
  }

  Widget _body(DistrictAdminOverview d) {
    final trf = d.trfGoal;
    // Prefer the dynamic per-fund breakdown (Annual / Polio / Endowment /
    // Others / Global Grant …); fall back to the fixed fund totals.
    final funds = d.fundTypeBreakdown.isNotEmpty
        ? [for (final f in d.fundTypeBreakdown) (f.fundName, f.amountInr)]
        : <(String, double)>[
            ('Annual (Unrestricted)', trf.annualFundInr),
            ('Polio', trf.polioFundInr),
            ('Endowment', trf.endowmentInr),
            ('Others', trf.othersInr),
          ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              DistrictAnalyticsService.fmtUsd(d.trfTotalInr),
              style: AppFonts.body(
                fontSize: 28,
                fontWeight: FontWeight.w800,
                color: AppColors.textPrimary,
                height: 1.0,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
            const SizedBox(width: 6),
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Text('raised',
                  style: AppFonts.body(
                      fontSize: 11, color: AppColors.slate400)),
            ),
          ],
        ),
        const SizedBox(height: 12),
        for (var i = 0; i < funds.length; i++) ...[
          _FooterRow(funds[i].$1, DistrictAnalyticsService.fmtUsd(funds[i].$2)),
          if (i != funds.length - 1) const SizedBox(height: 8),
        ],
        const SizedBox(height: 10),
        const _Divider(),
        const SizedBox(height: 8),
        _FooterRow('Total contributions',
            DistrictAnalyticsService.fmtUsd(d.trfTotalInr)),
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 3. Service Projects & Public Image card — avenue-wise progress
// ─────────────────────────────────────────────────────────────────────────

class ServiceAvenueCard extends StatelessWidget {
  const ServiceAvenueCard({super.key});

  @override
  Widget build(BuildContext context) {
    final sp = DistrictOverviewScope.of(context).serviceProjects;
    // Show the avenue completion counts regardless of whether project targets
    // are configured — the backend flags IsPending when no targets exist, but
    // still returns the real per-avenue counts (matches the web card).
    return _PanelCard(
      icon: Icons.volunteer_activism_rounded,
      iconColor: AppColors.avenueVocational,
      title: 'Service Projects & Public Image',
      subtitle: 'Project completion this RY',
      pending: false,
      child: _body(sp),
    );
  }

  Widget _body(DaServiceProjectsPanel sp) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var i = 0; i < sp.avenues.length; i++) ...[
          _ProgressRow(
            label: sp.avenues[i].avenueName,
            valueDisplay: sp.avenues[i].target != null
                ? '${sp.avenues[i].completed} / ${sp.avenues[i].target}'
                : '${sp.avenues[i].completed}',
            progress: (sp.avenues[i].percentAchieved / 100).clamp(0.0, 1.0),
            color: Color(daClubColor(i)),
          ),
          if (i != sp.avenues.length - 1) const SizedBox(height: 10),
        ],
        const SizedBox(height: 10),
        const _Divider(),
        const SizedBox(height: 8),
        _FooterRow(
          'Total projects',
          sp.totalTarget != null
              ? '${sp.totalProjects} / ${sp.totalTarget}'
              : '${sp.totalProjects}',
        ),
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 4. District Citation card — average score donut + category status
// ─────────────────────────────────────────────────────────────────────────

class CitationCard extends StatelessWidget {
  const CitationCard({super.key});

  @override
  Widget build(BuildContext context) {
    final o = DistrictOverviewScope.of(context);
    return _PanelCard(
      icon: Icons.workspace_premium_rounded,
      iconColor: AppColors.donutFillRose,
      title: 'District Citation',
      subtitle: 'Average score · all clubs',
      pending: false,
      child: _body(o),
    );
  }

  Widget _body(DistrictAdminOverview o) {
    final cit = o.citation;
    // Web parity (district-admin overview "District Citation" panel): the donut
    // shows the AVERAGE citation score per club, not the district-wide total.
    //   citationPoints = citation.totalPoints ?? round(districtCitationScore)
    //   avg = (citationPoints > 0 && totalClubs > 0)
    //           ? round(citationPoints / totalClubs) : citationPoints
    // Previously the mobile showed districtCitationScore raw (a total), so its
    // number ran far higher than the web's per-club average.
    final citationPoints =
        cit.totalPoints != 0 ? cit.totalPoints : o.districtCitationScore.roundToDouble();
    final avg = (citationPoints > 0 && o.totalClubs > 0)
        ? (citationPoints / o.totalClubs).roundToDouble()
        : citationPoints;
    final maxPoints = cit.categories.isEmpty
        ? 1.0
        : cit.categories
            .map((c) => c.pointsEarned)
            .reduce((a, b) => a > b ? a : b);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        Center(
          child: DonutChart(
            size: 150,
            strokeWidth: 18,
            percent: (avg / 1000 * 100).clamp(0.0, 100.0),
            trackColor: AppColors.donutTrackNeutral,
            fillColor: AppColors.donutFillRose,
            center: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                SizedBox(
                  width: 96,
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Text(
                      avg.round().toString(),
                      style: AppFonts.body(
                        fontSize: 26,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary,
                        height: 1.0,
                        fontFeatures: const [FontFeature.tabularFigures()],
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 2),
                Text('avg / 1000',
                    style: AppFonts.body(
                        fontSize: 11, color: AppColors.slate500)),
              ],
            ),
          ),
        ),
        const SizedBox(height: 14),
        if (cit.categories.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Center(
              child: Text('No categories configured',
                  style: AppFonts.body(
                      fontSize: 12, color: AppColors.slate400)),
            ),
          )
        else ...[
          for (var i = 0; i < cit.categories.length; i++) ...[
            _CitationRow(
              cat: cit.categories[i],
              maxPoints: maxPoints,
              color: Color(daClubColor(i)),
            ),
            if (i != cit.categories.length - 1) const SizedBox(height: 8),
          ],
        ],
        const SizedBox(height: 12),
        const _Divider(),
        const SizedBox(height: 10),
        const _CitationLegend(),
      ],
    );
  }
}

/// Complete / Partial / Incomplete legend for the District Citation card.
class _CitationLegend extends StatelessWidget {
  const _CitationLegend();

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        _dot('Complete', AppColors.success),
        const SizedBox(width: 14),
        _dot('Partial', AppColors.donutFillAmber),
        const SizedBox(width: 14),
        _dot('Incomplete', AppColors.error),
      ],
    );
  }

  Widget _dot(String label, Color c) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(color: c, shape: BoxShape.circle),
        ),
        const SizedBox(width: 5),
        Text(label,
            style: AppFonts.body(
                fontSize: 10.5,
                fontWeight: FontWeight.w600,
                color: AppColors.slate500)),
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Wave 13A4 additions — citation category row + status pill
// ─────────────────────────────────────────────────────────────────────────

/// A citation category row: name + Complete/Partial/Incomplete status pill +
/// points, over a progress bar (points relative to the top category).
class _CitationRow extends StatelessWidget {
  final DaCitationCategoryRow cat;
  final double maxPoints;
  final Color color;
  const _CitationRow({
    required this.cat,
    required this.maxPoints,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    final clamped =
        maxPoints <= 0 ? 0.0 : (cat.pointsEarned / maxPoints).clamp(0.0, 1.0);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                cat.categoryName,
                style: AppFonts.body(
                  fontSize: 11.5,
                  color: AppColors.slate500,
                  fontWeight: FontWeight.w500,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            if (cat.status.isNotEmpty) ...[
              const SizedBox(width: 6),
              _StatusPill(status: cat.status),
            ],
            const SizedBox(width: 8),
            Text(
              cat.pointsEarned.toStringAsFixed(cat.pointsEarned % 1 == 0 ? 0 : 1),
              style: AppFonts.body(
                fontSize: 11.5,
                fontWeight: FontWeight.w700,
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
            value: clamped,
            minHeight: 6,
            backgroundColor: AppColors.slate100,
            valueColor: AlwaysStoppedAnimation<Color>(color),
          ),
        ),
      ],
    );
  }
}

/// Small colored pill for a citation category's completion status.
class _StatusPill extends StatelessWidget {
  final String status; // complete | partial | incomplete
  const _StatusPill({required this.status});

  @override
  Widget build(BuildContext context) {
    final s = status.toLowerCase();
    final Color c = s == 'complete'
        ? AppColors.success
        : s == 'partial'
            ? AppColors.donutFillAmber
            : AppColors.error;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: c.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        s.isEmpty ? '' : '${s[0].toUpperCase()}${s.substring(1)}',
        style: AppFonts.body(
          fontSize: 9,
          fontWeight: FontWeight.w800,
          color: c,
        ),
      ),
    );
  }
}
