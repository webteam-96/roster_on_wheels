import 'package:flutter/material.dart';
import 'app_colors.dart';

/// Kept for existing callers, now flat: Fellowship uses solid fields, no colour
/// gradients (FRONTEND-RULES #1). Each "gradient" is one colour at both stops.
class AppGradients {
  static const LinearGradient royalSweep = LinearGradient(
    colors: [AppColors.primaryPrime, AppColors.primaryPrime],
  );

  static const LinearGradient goldenHour = LinearGradient(
    colors: [AppColors.goldPrime, AppColors.goldPrime],
  );
}
