import 'package:flutter/material.dart';
import 'app_colors.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

class AppTextStyles {
  // Primary: Plus Jakarta Sans
  // Heading: Playfair Display (Geist when "Modern" font style is picked)
  // Mono: JetBrains Mono

  static TextStyle get h1 => AppFonts.display(
    fontSize: 28,
    fontWeight: FontWeight.w700,
    color: AppColors.textPrimary,
    height: 1.3,
  );

  static TextStyle get h2 => AppFonts.display(
    fontSize: 24,
    fontWeight: FontWeight.w700,
    color: AppColors.textPrimary,
    height: 1.3,
  );

  static TextStyle get h3 => AppFonts.display(
    fontSize: 20,
    fontWeight: FontWeight.w600,
    color: AppColors.textPrimary,
    height: 1.4,
  );

  static TextStyle get h4 => AppFonts.body(
    fontSize: 18,
    fontWeight: FontWeight.w600,
    color: AppColors.textPrimary,
    height: 1.4,
  );

  static TextStyle get bodyLarge => AppFonts.body(
    fontSize: 16,
    fontWeight: FontWeight.w400,
    color: AppColors.textPrimary,
    height: 1.5,
  );

  static TextStyle get body => AppFonts.body(
    fontSize: 14,
    fontWeight: FontWeight.w400,
    color: AppColors.textPrimary,
    height: 1.5,
  );

  /// Same as [body] but in the locked app family (Geist) instead of the raw
  /// Plus Jakarta Sans. Use where the text must match the app's effective body
  /// font — e.g. dialog content, where the global textTheme override that
  /// re-fonts `bodyMedium` does NOT reach an explicit `contentTextStyle`.
  static TextStyle get bodyLocked => AppFonts.body(
    fontSize: 14,
    fontWeight: FontWeight.w400,
    color: AppColors.textPrimary,
    height: 1.5,
  );

  static TextStyle get bodyMedium => AppFonts.body(
    fontSize: 14,
    fontWeight: FontWeight.w500,
    color: AppColors.textPrimary,
    height: 1.5,
  );

  static TextStyle get bodySemiBold => AppFonts.body(
    fontSize: 14,
    fontWeight: FontWeight.w600,
    color: AppColors.textPrimary,
    height: 1.5,
  );

  static TextStyle get caption => AppFonts.body(
    fontSize: 12,
    fontWeight: FontWeight.w400,
    color: AppColors.textSecondary,
    height: 1.4,
  );

  static TextStyle get captionMedium => AppFonts.body(
    fontSize: 12,
    fontWeight: FontWeight.w500,
    color: AppColors.textSecondary,
    height: 1.4,
  );

  static TextStyle get label => AppFonts.body(
    fontSize: 13,
    fontWeight: FontWeight.w500,
    color: AppColors.textPrimary,
    height: 1.4,
  );

  static TextStyle get button => AppFonts.body(
    fontSize: 14,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.1,
    height: 1.0,
  );

  static TextStyle get buttonSmall => AppFonts.body(
    fontSize: 12,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.1,
    height: 1.0,
  );

  static TextStyle get link => AppFonts.body(
    fontSize: 14,
    fontWeight: FontWeight.w500,
    color: AppColors.primaryPrime,
    decoration: TextDecoration.underline,
    decorationColor: AppColors.primaryPrime,
  );

  static TextStyle get statValue => AppFonts.body(
    fontSize: 28,
    fontWeight: FontWeight.w700,
    color: AppColors.textPrimary,
    height: 1.2,
  );

  static TextStyle get statLabel => AppFonts.body(
    fontSize: 13,
    fontWeight: FontWeight.w500,
    color: AppColors.textSecondary,
    height: 1.4,
  );

  static TextStyle get mono => AppFonts.body(
    fontSize: 12,
    fontFeatures: const [FontFeature.tabularFigures()],
    color: AppColors.textSecondary,
  );
}
