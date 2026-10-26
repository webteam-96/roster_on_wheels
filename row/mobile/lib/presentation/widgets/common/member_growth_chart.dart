import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart' hide Text;
import '../../../core/theme/app_colors.dart';
import '../../../data/models/club_overview_models.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// Multi-series membership growth chart — Male / Female / Honorary by month,
/// with a legend. The composition the web AreaChart shows. Shared by the
/// Overview and Membership tabs.
class MemberGrowthChart extends StatelessWidget {
  final List<MemberGrowthPoint> growth;
  const MemberGrowthChart({super.key, required this.growth});

  static String _shortMonth(String s) {
    final m = s.trim().split(' ').first;
    return m.length > 3 ? m.substring(0, 3) : m;
  }

  Widget _legend(Color c, String t) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(color: c, shape: BoxShape.circle)),
          const SizedBox(width: 4),
          Text(t,
              style: AppFonts.body(
                  fontSize: 10, color: AppColors.slate500)),
        ],
      );

  @override
  Widget build(BuildContext context) {
    final g = growth;
    final maxVal = g
        .map((p) =>
            [p.male, p.female, p.honorary].reduce((a, b) => a > b ? a : b))
        .fold<int>(0, (a, b) => b > a ? b : a);
    List<FlSpot> spots(int Function(MemberGrowthPoint) sel) => [
          for (var i = 0; i < g.length; i++)
            FlSpot(i.toDouble(), sel(g[i]).toDouble())
        ];
    LineChartBarData bar(int Function(MemberGrowthPoint) sel, Color c) =>
        LineChartBarData(
          spots: spots(sel),
          isCurved: true,
          color: c,
          barWidth: 2.5,
          dotData: const FlDotData(show: false),
        );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SizedBox(
          height: 150,
          child: LineChart(LineChartData(
            minY: 0,
            maxY: maxVal <= 0 ? 1 : maxVal * 1.2,
            gridData: const FlGridData(show: false),
            borderData: FlBorderData(show: false),
            titlesData: FlTitlesData(
              topTitles:
                  const AxisTitles(sideTitles: SideTitles(showTitles: false)),
              rightTitles:
                  const AxisTitles(sideTitles: SideTitles(showTitles: false)),
              leftTitles:
                  const AxisTitles(sideTitles: SideTitles(showTitles: false)),
              bottomTitles: AxisTitles(
                sideTitles: SideTitles(
                  showTitles: true,
                  reservedSize: 20,
                  interval: 1,
                  getTitlesWidget: (value, meta) {
                    final i = value.round();
                    if (i < 0 || i >= g.length) return const SizedBox.shrink();
                    if (g.length > 6 && i % 2 != 0) {
                      return const SizedBox.shrink();
                    }
                    return Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text(_shortMonth(g[i].month),
                          style: AppFonts.body(
                              fontSize: 8.5, color: AppColors.slate400)),
                    );
                  },
                ),
              ),
            ),
            lineBarsData: [
              bar((p) => p.male, AppColors.rotaryBlue),
              bar((p) => p.female, AppColors.error),
              bar((p) => p.honorary, AppColors.donutFillAmber),
            ],
          )),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 14,
          runSpacing: 6,
          children: [
            _legend(AppColors.rotaryBlue, 'Male'),
            _legend(AppColors.error, 'Female'),
            _legend(AppColors.donutFillAmber, 'Honorary'),
          ],
        ),
      ],
    );
  }
}
