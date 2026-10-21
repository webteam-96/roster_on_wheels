import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// Small always-visible "RY 2025-26" pill so the rotary year is never a bare
/// token.
class RyContextChip extends StatelessWidget {
  final String yearLabel;
  const RyContextChip({super.key, required this.yearLabel});

  @override
  Widget build(BuildContext context) {
    final label = yearLabel.trim().isEmpty ? '–' : yearLabel.trim();
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: AppColors.rotaryBlue.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        'RY $label',
        style: AppFonts.body(
          fontSize: 11,
          fontWeight: FontWeight.w800,
          color: AppColors.rotaryBlue,
        ),
      ),
    );
  }
}
