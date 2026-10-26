import 'package:flutter/material.dart' hide Text;
import '../../../core/network/api_exceptions.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_theme.dart';
import 'custom_button.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

class EmptyStateWidget extends StatelessWidget {
  final String title;
  final String? subtitle;
  final IconData icon;
  final String? actionLabel;
  final VoidCallback? onAction;

  const EmptyStateWidget({
    super.key,
    required this.title,
    this.subtitle,
    this.icon = Icons.inbox_rounded,
    this.actionLabel,
    this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    final content = Padding(
      padding: const EdgeInsets.all(AppSpacing.xl),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            padding: const EdgeInsets.all(28),
            decoration: BoxDecoration(
              color: AppColors.primaryPrime.withOpacity(0.08),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, size: 64, color: AppColors.primaryPrime),
          ),
          const SizedBox(height: AppSpacing.xl),
          Text(
            title,
            style: AppFonts.display(
              fontSize: 22,
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary,
            ),
            textAlign: TextAlign.center,
          ),
          if (subtitle != null) ...[
            const SizedBox(height: 12),
            Text(
              subtitle!,
              style: AppFonts.body(color: AppColors.textSecondary,
                fontSize: 14,
                height: 1.5,
                fontWeight: FontWeight.w500,
              ),
              textAlign: TextAlign.center,
            ),
          ],
          if (actionLabel != null && onAction != null) ...[
            const SizedBox(height: AppSpacing.xl),
            CustomButton(
              label: actionLabel!,
              onPressed: onAction,
              icon: Icons.add_rounded,
              padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 14),
            ),
          ],
        ],
      ),
    );
    return LayoutBuilder(
      builder: (context, constraints) {
        if (!constraints.hasBoundedHeight) {
          return content;
        }
        return SingleChildScrollView(
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: constraints.maxHeight),
            child: Center(child: content),
          ),
        );
      },
    );
  }
}

class ErrorStateWidget extends StatelessWidget {
  final String message;
  final VoidCallback? onRetry;

  const ErrorStateWidget({super.key, required this.message, this.onRetry});

  @override

  Widget build(BuildContext context) {
    // The zone/district/club kill-switch returns a 403 with a specific message.
    // It's not a transient error and retrying is futile until an admin
    // reactivates the chain, so show a neutral "inactive" state without a
    // "Try Again" button.
    final inactiveChain = isInactiveChainMessage(message);
    // A dropped connection isn't an app failure — give it its own icon and
    // headline instead of the red "Something went wrong" treatment.
    final offline = !inactiveChain && isOfflineMessage(message);
    final accent = inactiveChain
        ? AppColors.warning
        : offline
            ? AppColors.textSecondary
            : AppColors.error;
    final content = Padding(
      padding: const EdgeInsets.all(AppSpacing.xl),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            padding: const EdgeInsets.all(28),
            decoration: BoxDecoration(
              color: accent.withOpacity(0.08),
              shape: BoxShape.circle,
            ),
            child: Icon(
              inactiveChain
                  ? Icons.lock_outline_rounded
                  : offline
                      ? Icons.wifi_off_rounded
                      : Icons.error_outline_rounded,
              size: 64,
              color: accent,
            ),
          ),
          const SizedBox(height: AppSpacing.xl),
          Text(
            inactiveChain
                ? 'Currently unavailable'
                : offline
                    ? "You're offline"
                    : 'Something went wrong',
            style: AppFonts.display(
              fontSize: 22,
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 12),
          Text(
            offline
                ? 'Check your internet connection and try again.'
                : message,
            style: AppFonts.body(color: AppColors.textSecondary,
              fontSize: 14,
              height: 1.5,
              fontWeight: FontWeight.w500,
            ),
            textAlign: TextAlign.center,
          ),
          // No retry for the inactive-chain case — it can't be resolved here.
          if (onRetry != null && !inactiveChain) ...[
            const SizedBox(height: AppSpacing.xl),
            CustomButton(
              label: 'Try Again',
              onPressed: onRetry,
              icon: Icons.refresh_rounded,
              variant: ButtonVariant.outline,
              padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 14),
            ),
          ],
        ],
      ),
    );
    return LayoutBuilder(
      builder: (context, constraints) {
        if (!constraints.hasBoundedHeight) {
          return content;
        }
        return SingleChildScrollView(
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: constraints.maxHeight),
            child: Center(child: content),
          ),
        );
      },
    );
  }
}
