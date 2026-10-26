import 'package:flutter/material.dart' hide Text;
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../../../core/maintenance/maintenance_controller.dart';
import '../../../core/maintenance/maintenance_dev_bypass.dart';
import '../../../core/theme/app_colors.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// Shared maintenance UI — used by BOTH the full-screen route gate
/// (MaintenanceScreen) and dashboard tab bodies (MaintenanceTabGate), so the
/// look and wording are identical everywhere.
class MaintenancePanel extends StatelessWidget {
  final String? message;
  final DateTime? until;
  final VoidCallback? onRetry;
  const MaintenancePanel({super.key, this.message, this.until, this.onRetry});

  @override
  Widget build(BuildContext context) {
    final msg = (message == null || message!.trim().isEmpty)
        ? 'This section is temporarily unavailable while we make improvements. '
            'Please check back soon.'
        : message!.trim();
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 84,
              height: 84,
              decoration: BoxDecoration(
                color: AppColors.warning.withValues(alpha: 0.12),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.construction_rounded,
                  size: 42, color: AppColors.warning),
            ),
            const SizedBox(height: 20),
            Text(
              'Under Maintenance',
              textAlign: TextAlign.center,
              style: AppFonts.body(
                fontSize: 20,
                fontWeight: FontWeight.w800,
                color: AppColors.textPrimary,
              ),
            ),
            const SizedBox(height: 10),
            Text(
              msg,
              textAlign: TextAlign.center,
              style: AppFonts.body(
                fontSize: 14,
                height: 1.5,
                color: AppColors.textSecondary,
              ),
            ),
            if (until != null) ...[
              const SizedBox(height: 16),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                decoration: BoxDecoration(
                  color: AppColors.muted,
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.schedule_rounded,
                        size: 16, color: AppColors.textSecondary),
                    const SizedBox(width: 6),
                    Text(
                      'Expected back: ${DateFormat('d MMM yyyy, h:mm a').format(until!)}',
                      style: AppFonts.body(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w600,
                        color: AppColors.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
            ],
            if (onRetry != null) ...[
              const SizedBox(height: 22),
              OutlinedButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh_rounded, size: 18),
                label: const Text('Retry'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Wraps a dashboard tab body. If [routeKey] (e.g.
/// `/clubs/:id/overview#foundation`) is flagged in the registry, it renders the
/// MaintenancePanel instead of [child]; otherwise [child] is shown unchanged.
/// Watches the controller so an admin toggle reflects without reopening.
class MaintenanceTabGate extends StatelessWidget {
  final String routeKey;
  final Widget child;
  const MaintenanceTabGate(
      {super.key, required this.routeKey, required this.child});

  @override
  Widget build(BuildContext context) {
    // Dev-only: work on a flagged tab locally while live users still see the
    // panel (no-op in release — see maintenance_dev_bypass.dart).
    if (isMaintenanceDevBypassed(routeKey)) return child;
    final ctrl = context.watch<MaintenanceController>();
    final reg = ctrl.registry;
    if (!reg.isKeyBlocked(routeKey)) return child;
    final entry = reg.entryForKey(routeKey);
    return MaintenancePanel(
      message: entry?.message,
      until: entry?.until,
      onRetry: ctrl.refresh,
    );
  }
}
