import 'package:flutter/material.dart' hide Text;
import '../../../../../core/theme/app_colors.dart';
import '../../../../../data/models/district_admin_dashboard_models.dart';
import 'district_dashboard_async.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// Club leaderboard ranked by overall score, driven by the live `/overview`
/// response's `clubLeaderboard` list. Each row shows a rank badge (gold for
/// #1, silver #2, bronze #3, slate otherwise), the club name, and the score.
/// Reads the response from `DistrictOverviewScope.of(context)`.
class LeaderboardCard extends StatelessWidget {
  const LeaderboardCard({super.key});

  @override
  Widget build(BuildContext context) {
    final rows = DistrictOverviewScope.of(context).clubLeaderboard;
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
            'Club Leaderboard',
            style: AppFonts.body(
              fontSize: 13,
              fontWeight: FontWeight.w800,
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            'Ranked by overall score',
            style: AppFonts.body(
              fontSize: 11,
              fontWeight: FontWeight.w500,
              color: AppColors.slate500,
            ),
          ),
          const SizedBox(height: 12),
          if (rows.isEmpty)
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
            for (var i = 0; i < rows.length; i++) ...[
              _LeaderboardRow(row: rows[i]),
              if (i != rows.length - 1) const SizedBox(height: 6),
            ],
        ],
      ),
    );
  }
}

class _LeaderboardRow extends StatelessWidget {
  final DaClubLeaderboardRow row;
  const _LeaderboardRow({required this.row});

  // Medal palette for the top 3 ranks; slate for the rest.
  ({Color bg, Color fg}) get _badge {
    switch (row.rank) {
      case 1:
        return (bg: AppColors.goldPrime, fg: Colors.white);
      case 2:
        return (bg: AppColors.textMuted, fg: Colors.white); // silver
      case 3:
        return (bg: AppColors.warningInk, fg: Colors.white); // bronze
      default:
        return (bg: AppColors.slate100, fg: AppColors.slate500);
    }
  }

  @override
  Widget build(BuildContext context) {
    final badge = _badge;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
      decoration: BoxDecoration(
        color: row.rank <= 3 ? AppColors.slate50 : Colors.white,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.slate100),
      ),
      child: Row(
        children: [
          Container(
            width: 24,
            height: 24,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: badge.bg,
              shape: BoxShape.circle,
            ),
            child: Text(
              '${row.rank}',
              style: AppFonts.body(
                fontSize: 11,
                fontWeight: FontWeight.w800,
                color: badge.fg,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              row.clubName,
              style: AppFonts.body(
                fontSize: 12.5,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          // Percentile % badge removed — the web leaderboard doesn't show it.
          const SizedBox(width: 8),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                row.score.toStringAsFixed(1),
                style: AppFonts.body(
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
              Text(
                'score',
                style: AppFonts.body(
                  fontSize: 8.5,
                  fontWeight: FontWeight.w700,
                  color: AppColors.slate400,
                  letterSpacing: 0.4,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
