import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../../../../core/network/api_exceptions.dart';
import '../../../../../core/routing/route_names.dart';
import '../../../../../core/theme/app_colors.dart';
import '../../../../providers/auth_provider.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';

/// Centered loading spinner used while a dashboard tab fetches.
class ClubDashboardLoading extends StatelessWidget {
  const ClubDashboardLoading({super.key});

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(vertical: 64),
      child: Center(
        child: SizedBox(
          width: 28,
          height: 28,
          child: CircularProgressIndicator(
            strokeWidth: 2.6,
            valueColor: AlwaysStoppedAnimation<Color>(AppColors.rotaryBlue),
          ),
        ),
      ),
    );
  }
}

/// Error / empty state for a dashboard tab.
///
/// Distinguishes the kill-switch 403 (zone/district/club inactive) — a neutral,
/// non-retryable state — from ordinary failures, which offer a Retry button.
/// A 403 "not an active admin" message is also shown neutrally (retrying won't
/// help) but without the inactive-chain framing.
class ClubDashboardError extends StatelessWidget {
  final Object error;
  final VoidCallback onRetry;
  const ClubDashboardError({
    super.key,
    required this.error,
    required this.onRetry,
  });

  @override
  Widget build(BuildContext context) {
    final err = error;
    final isApi = err is ApiException;
    final message = isApi ? err.message : 'Something went wrong.';
    final inactive = isApi && err.isInactiveChain;
    final forbidden = isApi && err.statusCode == 403;

    // Stale-token role change: the backend gates these endpoints on the `roles`
    // claim baked into the JWT at login. If the member was promoted to club
    // admin AFTER logging in, my-context (a live DB read, so `auth.isClubAdmin`
    // is true) shows the new role, but the endpoint keeps returning a generic
    // 403 ("Access denied.", empty body) because the token still says Member.
    // The DB-level "not an active admin for this club" 403 carries its own
    // message and is excluded — re-login wouldn't help there. Only a fresh
    // login re-mints the claim, so offer that instead of a dead lock screen.
    final auth = context.read<AuthProvider>();
    final genericForbidden =
        forbidden && message.trim().toLowerCase() == 'access denied.';
    final staleRole = genericForbidden && auth.isClubAdmin;

    final retryable = !inactive && !forbidden;

    if (staleRole) {
      return _RoleChangedRelogin(
        onRelogin: () async {
          final router = GoRouter.of(context);
          await auth.forceReloginForRoleChange();
          router.go(RouteNames.login);
        },
      );
    }

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 48, horizontal: 24),
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              inactive
                  ? Icons.pause_circle_outline_rounded
                  : forbidden
                      ? Icons.lock_outline_rounded
                      : Icons.cloud_off_rounded,
              size: 38,
              color: AppColors.slate400,
            ),
            const SizedBox(height: 12),
            Text(
              message,
              textAlign: TextAlign.center,
              style: AppFonts.body(
                fontSize: 12.5,
                color: AppColors.slate500,
                height: 1.4,
              ),
            ),
            if (retryable) ...[
              const SizedBox(height: 16),
              OutlinedButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh_rounded, size: 16),
                label: Text(
                  'Retry',
                  style: AppFonts.body(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppColors.rotaryBlue,
                  side: const BorderSide(color: AppColors.slate200),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(8),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Shown when a member was promoted to admin after login: my-context grants the
/// role but the JWT (frozen at login) doesn't, so the admin endpoints 403.
/// A fresh login re-mints the token's `roles` claim.
class _RoleChangedRelogin extends StatelessWidget {
  final Future<void> Function() onRelogin;
  const _RoleChangedRelogin({required this.onRelogin});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 48, horizontal: 24),
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.manage_accounts_outlined,
                size: 38, color: AppColors.slate400),
            const SizedBox(height: 12),
            Text(
              'Your role was recently updated',
              textAlign: TextAlign.center,
              style: AppFonts.body(
                fontSize: 14,
                fontWeight: FontWeight.w800,
                color: AppColors.textPrimary,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              'Please log in again to access your new admin features.',
              textAlign: TextAlign.center,
              style: AppFonts.body(
                fontSize: 12.5,
                color: AppColors.slate500,
                height: 1.4,
              ),
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: onRelogin,
              icon: const Icon(Icons.login_rounded, size: 16),
              label: Text(
                'Log in again',
                style: AppFonts.body(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w700,
                ),
              ),
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
