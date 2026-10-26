import 'package:flutter/material.dart' hide Text;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/routing/route_names.dart';
import '../../../core/security/biometric_controller.dart';
import '../../../core/services/mobile_version_service.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_gradients.dart';
import '../../providers/auth_provider.dart';
import '../../widgets/force_update_dialog.dart';
import 'package:rotary_flutter_app/core/brand/brand.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> with SingleTickerProviderStateMixin {
  final _storage =
      const FlutterSecureStorage(
    aOptions: AndroidOptions(resetOnError: false),
    iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
  );
  late AnimationController _controller;
  late Animation<double> _fadeAnimation;
  late Animation<double> _scaleAnimation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    );

    _fadeAnimation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(parent: _controller, curve: const Interval(0.0, 0.5, curve: Curves.easeIn)),
    );

    _scaleAnimation = Tween<double>(begin: 0.8, end: 1.0).animate(
      CurvedAnimation(parent: _controller, curve: const Interval(0.0, 0.5, curve: Curves.easeOutBack)),
    );

    _controller.forward();
    _navigate();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
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

      // Timeout-guarded: a stalled read resolves to null → treated as
      // "terms not accepted" → routes to the terms screen (then login).
      String? termsAccepted;
      try {
        termsAccepted = await _storage
            .read(key: AppConstants.termsAcceptedKey)
            .timeout(const Duration(seconds: 5), onTimeout: () => null);
      } catch (_) {
        termsAccepted = null;
      }

      if (!mounted) return;

      if (termsAccepted != 'true') {
        context.go(RouteNames.terms);
        return;
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
      body: Container(
        width: double.infinity,
        decoration: const BoxDecoration(
          gradient: AppGradients.royalSweep,
        ),
        child: SafeArea(
          child: Column(
            children: [
              Expanded(
                child: FadeTransition(
                  opacity: _fadeAnimation,
                  child: ScaleTransition(
                    scale: _scaleAnimation,
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        // ROW lockup (white, on the azure field)
                        Image.asset(
                          'assets/images/row-logo-inverse.png',
                          width: 220,
                          semanticLabel: Brand.current.productName,
                        ),
                        const SizedBox(height: 48),
                        const SizedBox(
                          width: 40,
                          height: 2,
                          child: const LinearProgressIndicator(
                            backgroundColor: Colors.white24,
                            valueColor: const AlwaysStoppedAnimation<Color>(AppColors.goldPrime),
                          ),
                        ),
                        const SizedBox(height: 25),
                        Text(
                          'CONNECTING MEMBERS',
                          style: AppFonts.body(
                            color: AppColors.white.withOpacity(0.6),
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 2,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),

              // Footer
              FadeTransition(
                opacity: _fadeAnimation,
                child: const Padding(
                  padding: EdgeInsets.only(bottom: 32),
                  child: const Column(
                    children: const [
                      // Text(
                      //   'CONNECTING MEMBERS',
                      //   style: AppFonts.body(
                      //     color: AppColors.white.withOpacity(0.6),
                      //     fontSize: 12,
                      //     fontWeight: FontWeight.w700,
                      //     letterSpacing: 2,
                      //   ),
                      // ),
                      // const SizedBox(height: 24),
                    ],
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
