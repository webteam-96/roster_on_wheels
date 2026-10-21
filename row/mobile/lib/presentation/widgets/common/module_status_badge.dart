import 'package:flutter/material.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/theme/app_colors.dart';

/// A small value/status badge shown on a dashboard module tile. Used by the
/// Payments category: email credit balance (a number) and Website /
/// Membership Dues status ("Active" / "Expired" / "Not set up").
class ModuleBadge {
  final String text;
  final Color color;
  const ModuleBadge(this.text, this.color);

  // Traffic-light colors — color is the primary signal for older users.
  static const Color green = AppColors.success; // fine
  static const Color orange = AppColors.warningDark; // running low
  static const Color red = AppColors.error; // act now (empty / expired)
  static const Color grey = AppColors.textSecondary; // not set up / neutral
  static const Color blue = AppColors.accentBlue; // call to action (buy)

  static const int lowCreditThreshold = 100;

  /// Credit count with thousands separators, e.g. 1240 -> "1,240".
  static String formatCount(int n) {
    final s = n.abs().toString();
    final buf = StringBuffer();
    for (var i = 0; i < s.length; i++) {
      if (i > 0 && (s.length - i) % 3 == 0) buf.write(',');
      buf.write(s[i]);
    }
    return (n < 0 ? '-' : '') + buf.toString();
  }

  /// Self-explanatory email balance badge for older users: the number
  /// is always labelled, and the color + word flags when to act.
  ///   0            -> "0 left"       (red)
  ///   1..99        -> "Low: 80"      (orange)
  ///   100+         -> "1,240 left"   (green)
  factory ModuleBadge.credits(int count) {
    if (count <= 0) return const ModuleBadge('0 left', red);
    if (count < lowCreditThreshold) {
      return ModuleBadge('Low: ${formatCount(count)}', orange);
    }
    return ModuleBadge('${formatCount(count)} left', green);
  }
}

/// Renders a [ModuleBadge] as a compact tinted pill. [dense] shrinks it for the
/// square Featured/Grid tile corners; the default fits the list-row trailing
/// slot.
class ModuleBadgeChip extends StatelessWidget {
  final ModuleBadge badge;
  final bool dense;
  const ModuleBadgeChip({super.key, required this.badge, this.dense = false});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(
          horizontal: dense ? 6 : 8, vertical: dense ? 2 : 3),
      decoration: BoxDecoration(
        color: badge.color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: badge.color.withValues(alpha: 0.30)),
      ),
      child: Text(
        badge.text,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: AppFonts.body(
          fontSize: dense ? 8.5 : 11,
          fontWeight: FontWeight.w800,
          color: badge.color,
          height: 1.0,
        ),
      ),
    );
  }
}
