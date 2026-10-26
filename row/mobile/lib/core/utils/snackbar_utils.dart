import 'package:flutter/material.dart' hide Text;
import '../theme/app_colors.dart';
import '../theme/app_text_styles.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

class SnackbarUtils {
  static void showSuccess(BuildContext context, String message) {
    _show(context, message, AppColors.success);
  }

  static void showError(BuildContext context, String message) {
    _show(context, message, AppColors.error);
  }

  static void showInfo(BuildContext context, String message) {
    _show(context, message, AppColors.primary);
  }

  static void showWarning(BuildContext context, String message) {
    _show(context, message, AppColors.warning);
  }

  static void _show(BuildContext context, String message, Color color) {
    ScaffoldMessenger.of(context).hideCurrentSnackBar();
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message, style: AppTextStyles.body.copyWith(color: Colors.white)),
        backgroundColor: color,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        margin: const EdgeInsets.all(16),
        duration: const Duration(seconds: 3),
      ),
    );
  }
}
