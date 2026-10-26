import 'package:flutter/material.dart' hide Text;
import '../../../../../core/theme/app_colors.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

enum StatSubTone { up, down, muted }

/// KPI card used in the District Overview's top strip.
///
/// Visual: 4-px colored accent bar at top, white surface with slate border,
/// uppercase tracking label, big tabular-nums value, optional subtitle.
/// Mirrors the React `StatCard` component used by Overview.jsx.
class StatCard extends StatelessWidget {
  final String label;
  final String value;
  final String? sub;
  final Color accent;
  final StatSubTone subTone;

  const StatCard({
    super.key,
    required this.label,
    required this.value,
    this.sub,
    required this.accent,
    this.subTone = StatSubTone.muted,
  });

  Color get _subColor {
    switch (subTone) {
      case StatSubTone.up:    return AppColors.success;
      case StatSubTone.down:  return AppColors.error;
      case StatSubTone.muted: return AppColors.slate500;
    }
  }

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
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          // Accent bar
          Container(height: 4, color: accent),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  label.toUpperCase(),
                  style: AppFonts.body(
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    color: AppColors.slate500,
                    letterSpacing: 0.6,
                  ),
                  // Allow a long label (e.g. "TRF CONTRIBUTION") to wrap in a
                  // narrow 3-across tile instead of truncating. Short labels
                  // stay on one line.
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 6),
                // scaleDown keeps long exact values (e.g. full money amounts) on
                // one line, shrinking only when they'd otherwise clip.
                FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Text(
                    value,
                    style: AppFonts.body(
                      fontSize: 22,
                      fontWeight: FontWeight.w800,
                      color: AppColors.textPrimary,
                      height: 1.1,
                      fontFeatures: const [FontFeature.tabularFigures()],
                    ),
                    maxLines: 1,
                  ),
                ),
                if (sub != null) ...[
                  const SizedBox(height: 4),
                  Text(
                    sub!,
                    style: AppFonts.body(
                      fontSize: 11,
                      fontWeight: FontWeight.w500,
                      color: _subColor,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
