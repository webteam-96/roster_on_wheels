import 'package:flutter/cupertino.dart' show CupertinoPageTransitionsBuilder;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show SystemUiOverlayStyle;
import 'app_fonts.dart';
import 'row_tokens.dart';
import 'app_colors.dart';
import 'app_text_styles.dart';
import 'row_page_transitions.dart';

/// Fellowship theme (row/website/design.md): explicit colours (no seed), Bricolage
/// display / Figtree body, pill buttons, flat cards with a hairline, no elevation.
class AppTheme {
  static const Color _line = Color(0x1F1B2C42); // rgba(27,44,66,.12)

  /// Every button answers the finger: its label sinks a little while pressed.
  static Widget _press(BuildContext context, Set<WidgetState> states, Widget? child) {
    final pressed = states.contains(WidgetState.pressed) && !RowMotion.still(context);
    return AnimatedScale(
      scale: pressed ? .95 : 1,
      duration: pressed ? RowMotion.micro : RowMotion.ui,
      curve: pressed ? RowMotion.easeOut : RowMotion.spring,
      child: child,
    );
  }

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
      // iOS keeps its own push, so the swipe-back gesture stays.
      pageTransitionsTheme: const PageTransitionsTheme(builders: {
        TargetPlatform.android: RowPageTransitionsBuilder(),
        TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
      }),
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
        // A transparent bar reads as dark, which made the status bar icons white on the light page.
        systemOverlayStyle: SystemUiOverlayStyle.dark.copyWith(statusBarColor: AppColors.transparent),
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        scrolledUnderElevation: 0,
        // Left-aligned titles (design.md 8.6): they never collide with actions on the right.
        centerTitle: false,
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
        ).copyWith(foregroundBuilder: _press),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: AppColors.primaryPrime,
          foregroundColor: AppColors.primaryForeground,
          minimumSize: const Size(0, 52),
          shape: pill,
          textStyle: AppTextStyles.button,
        ).copyWith(foregroundBuilder: _press),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: AppColors.primaryPrime,
          side: const BorderSide(color: AppColors.primaryPrime, width: 1.5),
          minimumSize: const Size(0, 52),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
          shape: pill,
          textStyle: AppTextStyles.button,
        ).copyWith(foregroundBuilder: _press),
      ),
      // One field style across the app (design.md 8.6): outlined, label always shown on the border.
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.surface,
        floatingLabelBehavior: FloatingLabelBehavior.always,
        floatingLabelStyle: AppTextStyles.bodySemiBold.copyWith(color: AppColors.textPrimary, fontSize: 14),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
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
      // Light tabs (design.md 8.6): ink labels, the active tab on a sky pill, no band, no divider.
      tabBarTheme: TabBarThemeData(
        // Active tab: azure label over a 3 px azure underline; the bar sits on a hairline (owner 2026-11-27: no filled pill).
        labelColor: AppColors.primaryPrime,
        unselectedLabelColor: AppColors.textSecondary,
        indicator: const UnderlineTabIndicator(
          borderSide: BorderSide(color: AppColors.primaryPrime, width: 3),
          borderRadius: BorderRadius.vertical(top: Radius.circular(3)),
        ),
        indicatorSize: TabBarIndicatorSize.label,
        indicatorAnimation: TabIndicatorAnimation.elastic,
        dividerColor: AppColors.line,
        dividerHeight: 1,
        labelPadding: const EdgeInsets.symmetric(horizontal: 16),
        labelStyle: AppTextStyles.bodySemiBold.copyWith(fontWeight: FontWeight.w700),
        unselectedLabelStyle: AppTextStyles.body,
      ),
      // One primary action per screen: a flat azure pill, bottom right (design.md 8.6).
      floatingActionButtonTheme: const FloatingActionButtonThemeData(
        backgroundColor: AppColors.primaryPrime,
        foregroundColor: AppColors.lightBg,
        elevation: 0,
        focusElevation: 0,
        hoverElevation: 0,
        highlightElevation: 0,
        shape: StadiumBorder(),
        extendedTextStyle: TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
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
