import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// Reusable "Coming Soon" stub card. Matches the District Foundation stub so
/// every launch-deferred section reads the same. Used where the web has
/// replaced a section with a "Coming Soon" placeholder for the initial launch.
class ComingSoonCard extends StatelessWidget {
  final String title;
  final String description;
  const ComingSoonCard({
    super.key,
    required this.title,
    required this.description,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.slate200),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 28),
      child: Column(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: AppColors.background,
              shape: BoxShape.circle,
              border: Border.all(color: AppColors.warningLight),
            ),
            child: const Icon(Icons.error_outline_rounded,
                size: 22, color: AppColors.warningInk),
          ),
          const SizedBox(height: 12),
          Text(
            title,
            textAlign: TextAlign.center,
            style: AppFonts.body(
              fontSize: 14,
              fontWeight: FontWeight.w800,
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(height: 8),
          // "Coming Soon" chip (self-contained — matches DaPendingChip styling).
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: AppColors.background,
              borderRadius: BorderRadius.circular(999),
              border: Border.all(color: AppColors.goldLight),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.schedule_rounded,
                    size: 10, color: AppColors.warningInk),
                const SizedBox(width: 3),
                Text(
                  'Coming Soon',
                  style: AppFonts.body(
                    fontSize: 9.5,
                    fontWeight: FontWeight.w800,
                    color: AppColors.warningInk,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          Text(
            description,
            textAlign: TextAlign.center,
            style: AppFonts.body(
              fontSize: 11.5,
              color: AppColors.slate500,
              height: 1.45,
            ),
          ),
        ],
      ),
    );
  }
}
