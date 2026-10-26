import 'package:flutter/material.dart' hide Text;
import '../../../../core/theme/app_colors.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// Shared loading spinner for AG dashboard tabs.
class AgLoading extends StatelessWidget {
  const AgLoading({super.key});
  @override
  Widget build(BuildContext context) => const Center(
        child: Padding(
          padding: EdgeInsets.symmetric(vertical: 60),
          child: CircularProgressIndicator(strokeWidth: 2.4),
        ),
      );
}

/// Shared error state with retry for AG dashboard tabs. Detects a 403 (AG-only
/// endpoints) and shows a friendlier message.
class AgError extends StatelessWidget {
  final Object error;
  final VoidCallback onRetry;
  const AgError({super.key, required this.error, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    final msg = error.toString();
    final isForbidden = msg.contains('403') ||
        msg.toLowerCase().contains('forbidden') ||
        msg.toLowerCase().contains('not an active ag') ||
        msg.toLowerCase().contains('unauthor');
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(isForbidden ? Icons.lock_outline_rounded : Icons.cloud_off_rounded,
                size: 34, color: AppColors.slate400),
            const SizedBox(height: 12),
            Text(
              isForbidden
                  ? 'AG access required'
                  : 'Couldn’t load this section',
              textAlign: TextAlign.center,
              style: AppFonts.body(
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary),
            ),
            const SizedBox(height: 4),
            Text(
              isForbidden
                  ? 'This dashboard is only available to Assistant Governors.'
                  : 'Check your connection and try again.',
              textAlign: TextAlign.center,
              style: AppFonts.body(
                  fontSize: 11.5, color: AppColors.slate500, height: 1.4),
            ),
            const SizedBox(height: 14),
            OutlinedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh_rounded, size: 16),
              label: Text('Retry',
                  style: AppFonts.body(
                      fontSize: 12, fontWeight: FontWeight.w700)),
            ),
          ],
        ),
      ),
    );
  }
}
