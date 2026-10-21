import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../../../../core/network/api_exceptions.dart';
import '../../../../../core/routing/route_names.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../../data/models/district_admin_dashboard_models.dart';
import '../../../../providers/auth_provider.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// Loading spinner for District Admin dashboard tabs.
class DaLoading extends StatelessWidget {
  const DaLoading({super.key});
  @override
  Widget build(BuildContext context) => const Center(
        child: Padding(
          padding: EdgeInsets.symmetric(vertical: 60),
          child: CircularProgressIndicator(strokeWidth: 2.4),
        ),
      );
}

/// Error state with retry. Detects 403/404 (DA-only / no-assignment) and shows
/// a friendlier message.
class DaError extends StatelessWidget {
  final Object error;
  final VoidCallback onRetry;
  const DaError({super.key, required this.error, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    final msg = error.toString().toLowerCase();
    final gated = msg.contains('403') ||
        msg.contains('forbidden') ||
        msg.contains('404') ||
        msg.contains('no district admin');

    // Stale-token role change (same as the club dashboard): a member promoted
    // to district admin after login sees the role in my-context (so
    // `auth.isDistrictAdmin` is true), but these endpoints gate on the JWT
    // `roles` claim frozen at login → generic 403 "Access denied.". The
    // DB-level "not an active admin" 403 carries its own message and is
    // excluded. Only a fresh login re-mints the claim.
    final auth = context.read<AuthProvider>();
    final err = error;
    final genericForbidden = err is ApiException &&
        err.statusCode == 403 &&
        err.message.trim().toLowerCase() == 'access denied.';
    if (genericForbidden && auth.isDistrictAdmin) {
      return _DaRoleChangedRelogin(
        onRelogin: () async {
          final router = GoRouter.of(context);
          await auth.forceReloginForRoleChange();
          router.go(RouteNames.login);
        },
      );
    }
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(gated ? Icons.lock_outline_rounded : Icons.cloud_off_rounded,
                size: 34, color: AppColors.slate400),
            const SizedBox(height: 12),
            Text(
              gated ? 'District Admin access required' : 'Couldn’t load this section',
              textAlign: TextAlign.center,
              style: AppFonts.body(
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary),
            ),
            const SizedBox(height: 4),
            Text(
              gated
                  ? 'This dashboard is only available to District Admins of this district.'
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

/// Re-login prompt for a district member promoted to admin after login: the
/// JWT (frozen at login) lacks the new role, so the admin endpoints 403. A
/// fresh login re-mints the token's `roles` claim.
class _DaRoleChangedRelogin extends StatelessWidget {
  final Future<void> Function() onRelogin;
  const _DaRoleChangedRelogin({required this.onRelogin});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.manage_accounts_outlined,
                size: 34, color: AppColors.slate400),
            const SizedBox(height: 12),
            Text(
              'Your role was recently updated',
              textAlign: TextAlign.center,
              style: AppFonts.body(
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary),
            ),
            const SizedBox(height: 4),
            Text(
              'Please log in again to access your new admin features.',
              textAlign: TextAlign.center,
              style: AppFonts.body(
                  fontSize: 11.5, color: AppColors.slate500, height: 1.4),
            ),
            const SizedBox(height: 14),
            FilledButton.icon(
              onPressed: onRelogin,
              icon: const Icon(Icons.login_rounded, size: 16),
              label: Text('Log in again',
                  style: AppFonts.body(
                      fontSize: 12, fontWeight: FontWeight.w700)),
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.rotaryBlue,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Inherited scope holding the fetched `/overview` response, so the nested
/// Overview widgets (KPI strip, analytical cards, bar chart, leaderboard) can
/// read it without prop-drilling.
class DistrictOverviewScope extends InheritedWidget {
  final DistrictAdminOverview data;
  const DistrictOverviewScope({
    super.key,
    required this.data,
    required super.child,
  });

  static DistrictAdminOverview of(BuildContext context) {
    final scope =
        context.dependOnInheritedWidgetOfExactType<DistrictOverviewScope>();
    assert(scope != null, 'DistrictOverviewScope not found in context');
    return scope!.data;
  }

  @override
  bool updateShouldNotify(DistrictOverviewScope oldWidget) =>
      oldWidget.data != data;
}

/// A grey "Pending" chip — shown when a goal panel's data isn't populated yet.
class DaPendingChip extends StatelessWidget {
  final String label;
  const DaPendingChip({super.key, this.label = 'Pending'});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: AppColors.background,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: AppColors.goldLight),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.schedule_rounded,
              size: 10, color: AppColors.warningInk),
          const SizedBox(width: 3),
          Text(
            label,
            style: AppFonts.body(
              fontSize: 9.5,
              fontWeight: FontWeight.w800,
              color: AppColors.warningInk,
            ),
          ),
        ],
      ),
    );
  }
}
