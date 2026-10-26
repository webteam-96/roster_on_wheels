import 'package:flutter/material.dart' hide Text;
import '../../../../../core/theme/app_colors.dart';
import '../../../../../data/models/district_admin_dashboard_models.dart';
import 'district_dashboard_async.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// "Top 20 Clubs by Member Count" — a standalone card driven by the live
/// `/overview` response's `top20ClubsByMembers` list. Renders one horizontal
/// bar per club (bar width ∝ members / maxMembers) with the club name and the
/// member count. Reads the response from `DistrictOverviewScope.of(context)`.
class Top20ClubsCard extends StatelessWidget {
  const Top20ClubsCard({super.key});

  @override
  Widget build(BuildContext context) {
    final clubs = DistrictOverviewScope.of(context).top20ClubsByMembers;
    final maxMembers = clubs.isEmpty
        ? 1
        : clubs.map((c) => c.members).reduce((a, b) => a > b ? a : b);
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.slate200),
      ),
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            'Top 20 Clubs by Member Count',
            style: AppFonts.body(
              fontSize: 13,
              fontWeight: FontWeight.w800,
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            'Largest clubs in the district',
            style: AppFonts.body(
              fontSize: 11,
              fontWeight: FontWeight.w500,
              color: AppColors.slate500,
            ),
          ),
          const SizedBox(height: 14),
          if (clubs.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 24),
              child: Center(
                child: Text(
                  'No clubs yet.',
                  style: AppFonts.body(
                    fontSize: 12,
                    color: AppColors.slate400,
                  ),
                ),
              ),
            )
          else
            for (var i = 0; i < clubs.length; i++) ...[
              _BarRow(
                rank: i + 1,
                club: clubs[i],
                fraction:
                    maxMembers <= 0 ? 0 : clubs[i].members / maxMembers,
                color: Color(daClubColor(i)),
              ),
              if (i != clubs.length - 1) const SizedBox(height: 10),
            ],
        ],
      ),
    );
  }
}

class _BarRow extends StatelessWidget {
  final int rank;
  final DistrictClubStat club;
  final double fraction;
  final Color color;
  const _BarRow({
    required this.rank,
    required this.club,
    required this.fraction,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    final f = fraction.isNaN ? 0.0 : fraction.clamp(0.0, 1.0);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        SizedBox(
          width: 22,
          child: Text(
            rank.toString().padLeft(2, '0'),
            style: AppFonts.body(
              fontSize: 11,
              fontWeight: FontWeight.w800,
              color: AppColors.slate400,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      club.clubName,
                      style: AppFonts.body(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    '${club.members}',
                    style: AppFonts.body(
                      fontSize: 12.5,
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
                  value: f,
                  minHeight: 8,
                  backgroundColor: AppColors.slate100,
                  valueColor: AlwaysStoppedAnimation<Color>(color),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
