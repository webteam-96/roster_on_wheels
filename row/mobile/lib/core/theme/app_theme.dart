import 'package:flutter/material.dart';
import 'app_fonts.dart';
import 'row_tokens.dart';
import 'app_colors.dart';
import 'app_text_styles.dart';

/// Fellowship theme (row/website/design.md): explicit colours (no seed), Bricolage
/// display / Figtree body, pill buttons, flat cards with a hairline, no elevation.
class AppTheme {
  static const Color _line = Color(0x1F1B2C42); // rgba(27,44,66,.12)

  static ThemeData get lightTheme {
    const pill = StadiumBorder();
    return ThemeData(
      useMaterial3: true,
      fontFamily: AppFonts.bodyFamily,
      primaryColor: AppColors.primaryPrime,
      colorScheme: const ColorScheme(
        brightness: Brightness.light,
        primary: AppColors.primaryPrime,
        onPrimary: AppColors.primaryForeground,
        primaryContainer: AppColors.primaryLight,
        onPrimaryContainer: AppColors.primaryDeep,
        secondary: AppColors.goldPrime,
        onSecondary: AppColors.secondaryForeground,
        secondaryContainer: AppColors.goldLight,
        onSecondaryContainer: AppColors.textPrimary,
        error: AppColors.error,
        onError: AppColors.primaryForeground,
        surface: AppColors.surface,
        onSurface: AppColors.textPrimary,
        onSurfaceVariant: AppColors.textSecondary,
        surfaceContainerHighest: AppColors.muted,
        outline: AppColors.lightBorder,
        outlineVariant: _line,
      ),
      scaffoldBackgroundColor: AppColors.lightBg,
      textTheme: TextTheme(
        displayLarge: AppTextStyles.h1,
        displayMedium: AppTextStyles.h2,
        displaySmall: AppTextStyles.h3,
        headlineLarge: AppTextStyles.h1,
        headlineMedium: AppTextStyles.h2,
        headlineSmall: AppTextStyles.h3,
        titleLarge: AppTextStyles.h4,
        bodyLarge: AppTextStyles.bodyLarge,
        bodyMedium: AppTextStyles.bodyMedium,
        bodySmall: AppTextStyles.caption,
        labelLarge: AppTextStyles.button,
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: AppColors.transparent,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: true,
        titleTextStyle: AppTextStyles.h4,
        iconTheme: const IconThemeData(color: AppColors.textPrimary, size: 24),
      ),
      cardTheme: const CardThemeData(
        color: AppColors.card,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.all(Radius.circular(RowRadii.tile)),
          side: BorderSide(color: _line, width: 1),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.primaryPrime,
          foregroundColor: AppColors.primaryForeground,
          elevation: 0,
          minimumSize: const Size(0, 52),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
          shape: pill,
          textStyle: AppTextStyles.button,
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: AppColors.primaryPrime,
          foregroundColor: AppColors.primaryForeground,
          minimumSize: const Size(0, 52),
          shape: pill,
          textStyle: AppTextStyles.button,
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: AppColors.primaryPrime,
          side: const BorderSide(color: AppColors.primaryPrime, width: 1.5),
          minimumSize: const Size(0, 52),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
          shape: pill,
          textStyle: AppTextStyles.button,
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.surface,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
        border: const OutlineInputBorder(
          borderRadius: BorderRadius.all(Radius.circular(12)),
          borderSide: BorderSide(color: AppColors.lightBorder),
        ),
        enabledBorder: const OutlineInputBorder(
          borderRadius: BorderRadius.all(Radius.circular(12)),
          borderSide: BorderSide(color: AppColors.lightBorder),
        ),
        focusedBorder: const OutlineInputBorder(
          borderRadius: BorderRadius.all(Radius.circular(12)),
          borderSide: BorderSide(color: AppColors.textPrimary, width: 2),
        ),
        errorBorder: const OutlineInputBorder(
          borderRadius: BorderRadius.all(Radius.circular(12)),
          borderSide: BorderSide(color: AppColors.error),
        ),
        labelStyle: AppTextStyles.bodyMedium.copyWith(color: AppColors.textSecondary),
        hintStyle: AppTextStyles.body.copyWith(color: AppColors.textMuted),
      ),
      tabBarTheme: TabBarThemeData(
        labelColor: AppColors.primaryPrime,
        unselectedLabelColor: AppColors.textSecondary,
        indicatorColor: AppColors.goldPrime,
        indicatorSize: TabBarIndicatorSize.label,
        labelStyle: AppTextStyles.bodySemiBold,
        unselectedLabelStyle: AppTextStyles.body,
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: AppColors.surface,
        elevation: 0,
        shape: const RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(RowRadii.panel))),
        titleTextStyle: AppTextStyles.h3,
        contentTextStyle: AppTextStyles.bodyLocked,
      ),
      bottomNavigationBarTheme: BottomNavigationBarThemeData(
        selectedItemColor: AppColors.primaryPrime,
        unselectedItemColor: AppColors.textMuted,
        selectedLabelStyle: AppTextStyles.captionMedium,
        unselectedLabelStyle: AppTextStyles.caption,
        type: BottomNavigationBarType.fixed,
        backgroundColor: AppColors.surface,
        elevation: 0,
      ),
      dividerColor: _line,
      dividerTheme: const DividerThemeData(color: _line, thickness: 1),
    );
  }
}

class AppSpacing {
  static const double xs = 4.0;
  static const double sm = 8.0;
  static const double md = 16.0;
  static const double lg = 24.0;
  static const double xl = 32.0;
  static const double xxl = 48.0;
}
