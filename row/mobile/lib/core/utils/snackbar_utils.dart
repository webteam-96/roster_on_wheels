import 'dart:async';
import 'package:flutter/material.dart' hide Text;
import 'package:flutter/services.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/core/theme/app_colors.dart';
import 'package:rotary_flutter_app/core/theme/app_text_styles.dart';
import 'package:rotary_flutter_app/core/theme/row_tokens.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/motion.dart';

/// Result messages. The fills are the dark status steps, so the light text on them reads (4.5:1 or more).
class SnackbarUtils {
  static void showSuccess(BuildContext context, String message) {
    HapticFeedback.lightImpact();
    _show(context, message, AppColors.successDark, Icons.check_rounded);
  }

  static void showError(BuildContext context, String message) {
    HapticFeedback.mediumImpact();
    _show(context, message, AppColors.errorDark, Icons.priority_high_rounded);
  }

  static void showInfo(BuildContext context, String message) {
    _show(context, message, AppColors.primary, Icons.info_outline_rounded);
  }

  static void showWarning(BuildContext context, String message) {
    _show(context, message, AppColors.warningInk, Icons.warning_amber_rounded);
  }

  static OverlayEntry? _over;

  static void _show(BuildContext context, String message, Color color, IconData icon) {
    final content = Row(
          children: [
            RowPop(
              from: 0,
              child: Container(
                width: 28,
                height: 28,
                decoration: BoxDecoration(color: AppColors.white.withValues(alpha: .18), shape: BoxShape.circle),
                child: Icon(icon, size: 18, color: AppColors.white),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(child: Text(message, style: AppTextStyles.body.copyWith(color: AppColors.white))),
          ],
        );
    // A snackbar belongs to the page, so a sheet or dialog covers it: there the message goes on top, below the status bar.
    if (ModalRoute.of(context) is PopupRoute) {
      _over?.remove();
      final entry = OverlayEntry(
        builder: (ctx) => Positioned(
          left: 16,
          right: 16,
          top: MediaQuery.paddingOf(ctx).top + 8,
          child: IgnorePointer(
            child: Semantics(
              liveRegion: true,
              child: Material(
                color: color,
                borderRadius: BorderRadius.circular(RowRadii.tile),
                child: Padding(padding: const EdgeInsets.all(14), child: content),
              ),
            ),
          ),
        ),
      );
      _over = entry;
      Overlay.of(context, rootOverlay: true).insert(entry);
      Timer(const Duration(seconds: 3), () {
        if (!identical(_over, entry)) return; // a newer message replaced it
        entry.remove();
        _over = null;
      });
      return;
    }
    ScaffoldMessenger.of(context).hideCurrentSnackBar();
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: content,
        backgroundColor: color,
        elevation: 0,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(RowRadii.tile)),
        margin: const EdgeInsets.all(16),
        duration: const Duration(seconds: 3),
      ),
    );
  }
}
