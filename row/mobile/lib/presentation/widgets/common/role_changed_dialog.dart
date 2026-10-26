import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../../core/routing/app_router.dart';
import '../../../core/routing/route_names.dart';
import '../../../core/theme/app_colors.dart';
import '../../providers/auth_provider.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

// Module-level guard so only one dialog shows at a time.
bool _dialogVisible = false;

/// App-wide role-change gate. Mount ONCE, high in the tree (see `app.dart`);
/// renders nothing and simply watches [AuthProvider.staleAdminToken], firing
/// the mandatory re-login dialog the moment a role change is detected.
///
/// This replaces the old per-screen calls on home / club dashboard / district
/// dashboard, which left every other screen uncovered — a user who opened the
/// app onto Directory or a module page was never told their roles had changed.
/// AuthProvider recomputes the flag on login, on every my-context refresh, and
/// on app resume (`checkAuthStatus`), and notifies listeners each time, so
/// watching it here catches all three without any per-screen wiring.
class RoleChangeWatcher extends StatelessWidget {
  const RoleChangeWatcher({super.key});

  @override
  Widget build(BuildContext context) {
    if (context.watch<AuthProvider>().staleAdminToken) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        // showDialog needs a Navigator ancestor. This widget lives in
        // MaterialApp's builder, which sits ABOVE the Navigator, so borrow the
        // router's navigator context rather than our own (which has none).
        final navContext =
            appRouter?.routerDelegate.navigatorKey.currentContext;
        if (navContext != null) maybeShowRoleChangedDialog(navContext);
      });
    }
    return const SizedBox.shrink();
  }
}

/// Shows a MANDATORY "your roles were updated, please log in again" popup when
/// the signed-in user's roles changed AFTER login — their JWT still carries the
/// old `roles` claim, so a newly granted role 403s and a revoked one stays
/// usable until the token expires (see [AuthProvider.staleAdminToken]).
///
/// Mounted app-wide by [RoleChangeWatcher], so it fires wherever the user is
/// rather than only on the three dashboards that used to call it.
///
/// There is no dismiss path: no "Later" button, tap-outside is disabled, and the
/// Android back button is blocked. The only action is "Log in again", which logs
/// the user out and routes to the login screen — they must re-authenticate to
/// pick up the new role. Safe to call from any screen's post-frame callback: it
/// no-ops when the token is current and shows at most one dialog. Call after a
/// context refresh so the flag is up to date.
Future<void> maybeShowRoleChangedDialog(BuildContext context) async {
  final auth = context.read<AuthProvider>();
  if (!auth.staleAdminToken) return;
  if (_dialogVisible) return;
  _dialogVisible = true;

  await showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (ctx) => PopScope(
      canPop: false,
      child: AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: AppColors.rotaryBlue.withValues(alpha: 0.10),
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Icon(Icons.manage_accounts_outlined,
                  color: AppColors.rotaryBlue, size: 22),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                'Role updated',
                style: AppFonts.body(
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                ),
              ),
            ),
          ],
        ),
        content: Text(
          'Your roles were recently updated. Please log in again so your '
          'access is up to date.',
          style: AppFonts.body(
            fontSize: 13,
            color: AppColors.slate500,
            height: 1.45,
          ),
        ),
        actionsPadding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
        actions: [
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: () async {
                final router = GoRouter.of(context);
                Navigator.of(ctx).pop();
                await auth.forceReloginForRoleChange();
                router.go(RouteNames.login);
              },
              icon: const Icon(Icons.login_rounded, size: 16),
              label: Text(
                'Log in again',
                style: AppFonts.body(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                ),
              ),
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.rotaryBlue,
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(8)),
              ),
            ),
          ),
        ],
      ),
    ),
  );

  _dialogVisible = false;
}
