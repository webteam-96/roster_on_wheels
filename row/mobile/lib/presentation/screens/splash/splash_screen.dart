import 'package:rotary_flutter_app/presentation/widgets/row/handshake_logo.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/motion.dart';
import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../../core/routing/route_names.dart';
import '../../../core/security/biometric_controller.dart';
import '../../../core/services/mobile_version_service.dart';
import '../../../core/theme/app_colors.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/force_update_dialog.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  @override
  void initState() {
    super.initState();
    _navigate();
  }

  Future<void> _navigate() async {
    // The whole method is wrapped so that NOTHING on the startup path can
    // leave the splash spinning forever. If any step throws (e.g. a wedged
    // Android keystore after a native→Flutter upgrade), we fall back to the
    // login screen instead of hanging on "CONNECTING MEMBERS". The individual
    // loops/reads below are also bounded so a native-level stall (which throws
    // nothing) can't get stuck either.
    try {
      // Kick off the version check in parallel with the splash animation so it
      // doesn't add wall-clock time on the happy path.
      final versionFuture = MobileVersionService().check();

      await Future.delayed(const Duration(milliseconds: 2500));
      if (!mounted) return;

      final auth = context.read<AuthProvider>();
      // Wait for auth check to finish. checkAuthStatus is now timeout-guarded
      // so it always completes; the deadline is a generous backstop (longer
      // than any legitimate storage+network path) so we never spin forever and
      // never cut off a slow-but-valid returning user.
      final authDeadline = DateTime.now().add(const Duration(seconds: 45));
      while (auth.isCheckingAuth && DateTime.now().isBefore(authDeadline)) {
        await Future.delayed(const Duration(milliseconds: 50));
        if (!mounted) return;
      }

      // Update gate. Force-update blocks the app entirely; soft-update is a
      // dismissible prompt that lets us proceed.
      final version = await versionFuture;
      if (!mounted) return;
      if (version.isForceUpdate) {
        // Returns only if the loop is broken, which currently it never is.
        await showForceUpdateDialog(context, result: version);
        return;
      }
      if (version.isUpdateAvailable) {
        await showSoftUpdateDialog(context, result: version);
        if (!mounted) return;
      }

      if (!auth.isLoggedIn) {
        context.go(RouteNames.mobileLogin);
        return;
      }
      // Logged in. Pattern A: only gate on cold start.
      final biometric = context.read<BiometricController>();
      // Bounded so a biometric controller that never initializes can't hang
      // the splash; on timeout we simply skip the lock and open the app.
      final bioDeadline = DateTime.now().add(const Duration(seconds: 5));
      while (!biometric.initialized && DateTime.now().isBefore(bioDeadline)) {
        await Future.delayed(const Duration(milliseconds: 30));
        if (!mounted) return;
      }
      // App Lock fires whenever the user enabled it AND the device can
      // authenticate. `supported` is true if there's a phone passcode set
      // (with or without biometric enrolled), so passcode-only mode works
      // even without Face ID / fingerprint.
      if (biometric.enabled && biometric.supported) {
        context.go(RouteNames.appLock);
      } else {
        context.go(RouteNames.home);
      }
    } catch (e) {
      // Last-resort escape hatch: never strand the user on the splash.
      debugPrint('Splash navigation failed, routing to login: $e');
      if (mounted) context.go(RouteNames.mobileLogin);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      key: const Key('splash_screen_root'),
      backgroundColor: AppColors.lightBg,
      body: SafeArea(
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // ROW lockup, full colour on the light field
              const HandshakeLogo(width: 240),
              const SizedBox(height: 24),
              RowReveal(
                delay: const Duration(
                    milliseconds: 1000), // after the hands have met
                child: Text(
                  'CONNECTING MEMBERS',
                  style: AppFonts.body(
                    color: AppColors.textSecondary,
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
