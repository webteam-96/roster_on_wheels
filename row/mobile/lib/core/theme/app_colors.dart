import 'package:flutter/material.dart';

/// Fellowship palette (row/website/design.md §1), locked: the palette and gold
/// pickers were removed on 2026-10-19. Field names are kept for existing callers.
class AppColors {
  static const Color primaryPrime = Color(0xFF17458F); // azure
  static const Color primaryLight = Color(0xFFCFE2F6); // sky
  static const Color primaryDeep = Color(0xFF0B3F7A); // mint-ink

  static const Color goldPrime = Color(0xFFF7A81B); // marigold
  static const Color goldLight = Color(0xFFFFC65C); // coral
  static const Color goldDark = Color(0xFFE59A10);

  // Dark fields, retinted from ink.
  static const Color darkBg = Color(0xFF132033);
  static const Color darkSurface = Color(0xFF1B2C42);
  static const Color darkCard = Color(0xFF2A3F5C);
  static const Color darkBorder = Color(0xFF4A5A70);
  static const Color darkMuted = Color(0xFF8796AA);
  static const Color darkTextPrimary = Color(0xFFF7F9FC);
  static const Color darkTextSecondary = Color(0xFFB7C3D2);

  static const Color lightBg = Color(0xFFF7F9FC); // cream
  static const Color lightBorder = Color(0xFFD5DEE8); // stone

  static const Color primary = primaryPrime;
  static const Color primaryForeground = Color(0xFFF7F9FC);
  static const Color secondary = goldPrime;
  static const Color secondaryForeground = Color(0xFF1B2C42);

  // Backgrounds (no pure white: FRONTEND-RULES #3)
  static const Color background = lightBg;
  static const Color surface = Color(0xFFFCFDFE);
  static const Color card = Color(0xFFFCFDFE);
  static const Color muted = Color(0xFFEDF4FB); // cream-2

  // Text
  static const Color textPrimary = Color(0xFF1B2C42); // ink
  static const Color textSecondary = Color(0xFF64748B); // ink-soft
  static const Color textMuted = Color(0xFF8796AA);

  // Border
  static const Color border = lightBorder;
  static const Color divider = Color(0xFFEDF4FB);

  // Hairline and scrim (ink at 12% / 40%)
  static const Color line = Color(0x1F1B2C42);
  static const Color scrim = Color(0x661B2C42);

  // Status (semantic, unchanged), with darker text and paler tint steps
  static const Color successDark = Color(0xFF15803D);
  static const Color successTint = Color(0xFFF0FDF4);
  static const Color errorDark = Color(0xFFB91C1C);
  static const Color errorTint = Color(0xFFFEF2F2);
  static const Color warningDark = Color(0xFFB97A0B);
  static const Color warningInk = Color(0xFF8A5B08);
  static const Color warningTint = Color(0xFFFFF8EA);
  static const Color success = Color(0xFF16A34A);
  static const Color successLight = Color(0xFFDCFCE7);
  static const Color error = Color(0xFFDC2626);
  static const Color errorLight = Color(0xFFFEE2E2);
  static const Color warning = Color(0xFFE59A10);
  static const Color warningLight = Color(0xFFFFEFCC);
  static const Color info = Color(0xFF0067C8);
  static const Color infoLight = Color(0xFFEDF4FB);

  // Section accents: one brand blue scale plus marigold (FRONTEND-RULES #2).
  static const Color accentBlue = Color(0xFF0067C8);
  static const Color accentBlueSoft = Color(0xFFCFE2F6);
  static const Color accentBlueTint = Color(0xFFEDF4FB);
  static const Color accentPurple = Color(0xFF17458F);
  static const Color accentPurpleSoft = Color(0xFFCFE2F6);
  static const Color accentPurpleTint = Color(0xFFF3F8FD);
  static const Color accentGreen = Color(0xFF16A34A);
  static const Color accentGreenSoft = Color(0xFFDCFCE7);
  static const Color accentGreenTint = Color(0xFFF0FDF4);
  static const Color accentAmber = Color(0xFFE59A10);
  static const Color accentAmberSoft = Color(0xFFFFEFCC);
  static const Color accentAmberTint = Color(0xFFFFF8EA);

  // Shimmer
  static const Color shimmerBase = Color(0xFFEDF4FB);
  static const Color shimmerHighlight = Color(0xFFF7F9FC);

  // Chart series: azure, marigold, mint, coral, lilac
  static const Color chart1 = Color(0xFF17458F);
  static const Color chart2 = Color(0xFFF7A81B);
  static const Color chart3 = Color(0xFF0067C8);
  static const Color chart4 = Color(0xFFFFC65C);
  static const Color chart5 = Color(0xFFA9C6EA);

  // Rotary brand
  static const Color rotaryBlue = Color(0xFF17458F);
  static const Color rotaryGold = Color(0xFFF7A81B);

  // Service avenues (same series as the web overview)
  static const Color avenueCommunity = Color(0xFF0067C8);
  static const Color avenueVocational = Color(0xFF10B981);
  static const Color avenueNewGen = Color(0xFF2A3F5C);
  static const Color avenueInternational = Color(0xFF17458F);
  static const Color avenuePublicImage = Color(0xFFF7A81B);
  static const Color avenueClubService = Color(0xFFA9C6EA);

  // Donut chart tracks and fills
  static const Color donutTrackAmber = Color(0xFFFFEFCC);
  static const Color donutTrackSlate = Color(0xFFEDF4FB);
  static const Color donutTrackNeutral = Color(0xFFEDF4FB);
  static const Color donutFillAmber = Color(0xFFF7A81B); // TRF
  static const Color donutFillRose = Color(0xFF0067C8); // Citation

  // Status dots (complete / partial / incomplete)
  static const Color statusDone = Color(0xFF16A34A);
  static const Color statusPart = Color(0xFFF7A81B);
  static const Color statusNone = Color(0xFFDC2626);

  // Neutral scale (Fellowship neutrals under the old slate names)
  static const Color slate50 = Color(0xFFF7F9FC);
  static const Color slate100 = Color(0xFFEDF4FB);
  static const Color slate200 = Color(0xFFD5DEE8);
  static const Color slate400 = Color(0xFF8796AA);
  static const Color slate500 = Color(0xFF64748B);
  static const Color slate700 = Color(0xFF2A3F5C);

  // Leaderboard row tints
  static const Color leaderboardTopBg = Color(0xFFF0FDF4);
  static const Color leaderboardTopText = Color(0xFF15803D);
  static const Color leaderboardBotBg = Color(0xFFFEF2F2);
  static const Color leaderboardBotText = Color(0xFFB91C1C);
  static const Color leaderboardMidBg = Color(0xFFF7F9FC);

  static const Color white = Color(0xFFFCFDFE);
  static const Color transparent = Colors.transparent;
}
