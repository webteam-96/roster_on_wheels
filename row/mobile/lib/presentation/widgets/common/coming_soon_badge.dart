import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../core/theme/app_colors.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// Formats the Coming Soon availability date the same way the web admin shows
/// it (e.g. "12 Jun 2026, 10:00 AM"). Returns '' when no date is set.
String formatComingSoonDate(DateTime? date) {
  if (date == null) return '';
  return DateFormat('d MMM yyyy, h:mm a').format(date);
}

/// Amber pill reading "Coming Soon" plus the availability date underneath.
/// [dense] drops the date line and shrinks the text for grid tiles.
class ComingSoonBadge extends StatelessWidget {
  final DateTime? date;
  final bool dense;
  const ComingSoonBadge({super.key, this.date, this.dense = false});

  @override
  Widget build(BuildContext context) {
    final dateText = formatComingSoonDate(date);
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: dense ? 6 : 7,
        vertical: dense ? 2 : 3,
      ),
      decoration: BoxDecoration(
        color: AppColors.warning,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Text(
            'Coming Soon',
            style: AppFonts.body(
              fontSize: dense ? 8 : 9,
              fontWeight: FontWeight.w800,
              color: Colors.white,
              letterSpacing: 0.3,
            ),
          ),
          if (!dense && dateText.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 1),
              child: Text(
                dateText,
                style: AppFonts.body(
                  fontSize: 8,
                  fontWeight: FontWeight.w600,
                  color: Colors.white.withValues(alpha: 0.95),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Wraps a module grid tile so that, when [isComingSoon], the tile dims and a
/// badge pins to its top-right corner. Tap-blocking is the caller's job — it
/// swaps the tile's onTap for [showComingSoonMessage].
Widget comingSoonOverlay({
  required bool isComingSoon,
  DateTime? date,
  required Widget child,
  bool dense = true,
}) {
  if (!isComingSoon) return child;
  return Stack(
    children: [
      Opacity(opacity: 0.45, child: child),
      Positioned(top: 6, right: 6, child: ComingSoonBadge(date: date, dense: dense)),
    ],
  );
}

/// Snackbar shown when a member taps a Coming Soon module instead of
/// navigating into it.
void showComingSoonMessage(BuildContext context, String moduleName, DateTime? date) {
  final dateText = formatComingSoonDate(date);
  final msg = dateText.isEmpty
      ? '$moduleName is coming soon.'
      : '$moduleName is coming soon: available $dateText.';
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(content: Text(msg), duration: const Duration(seconds: 3)),
  );
}
