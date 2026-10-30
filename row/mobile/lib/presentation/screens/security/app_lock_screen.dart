import 'package:flutter/material.dart' hide Text;
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../../core/routing/route_names.dart';
import '../../../core/security/biometric_controller.dart';
import '../../../core/theme/app_colors.dart';
import '../../providers/auth_provider.dart';
import 'package:rotary_flutter_app/core/brand/brand.dart';
import 'package:rotary_flutter_app/core/theme/app_fonts.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';

/// Cold-start biometric gate. Shown after splash when:
/// - the user is logged in (valid stored JWT) AND
/// - they have App Lock enabled in settings AND
/// - the device has a usable biometric.
///
/// Routes to /home on success, or back to login (after logout) if the user
/// chooses the "Use OTP instead" fallback. Sticky against accidental dismiss.
class AppLockScreen extends StatefulWidget {
  const AppLockScreen({super.key});

  @override
  State<AppLockScreen> createState() => _AppLockScreenState();
}

class _AppLockScreenState extends State<AppLockScreen>
    with WidgetsBindingObserver {
  bool _busy = false;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) => _runPrompt());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  Future<void> _runPrompt() async {
    if (_busy || !mounted) return;
    setState(() {
      _busy = true;
      _failed = false;
    });
    final controller = context.read<BiometricController>();
    final reason = controller.mode == LockMode.passcode
        ? 'Enter your device passcode to unlock ${Brand.current.productName}'
        : 'Unlock ${Brand.current.productName}';
    final ok = await controller.authenticate(reason: reason);
    if (!mounted) return;
    if (ok) {
      context.go(RouteNames.home);
      return;
    }
    setState(() {
      _busy = false;
      _failed = true;
    });
  }

  Future<void> _useOtpInstead() async {
    final auth = context.read<AuthProvider>();
    final controller = context.read<BiometricController>();
    await controller.stop();
    await auth.logout();
    if (!mounted) return;
    context.go(RouteNames.mobileLogin);
  }

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<BiometricController>();
    final passcodeMode = controller.mode == LockMode.passcode;
    final unlockedIcon =
        passcodeMode ? Icons.password_rounded : Icons.fingerprint_rounded;
    const lockedIcon = Icons.lock_outline;
    final unlockMethod =
        passcodeMode ? 'your device passcode' : controller.prettyLabel;
    final fallbackHint = passcodeMode
        ? ''
        : ' or your device passcode';
    return PopScope(
      canPop: false,
      child: Scaffold(
        body: Container(
          width: double.infinity,
          decoration: const BoxDecoration(color: AppColors.primaryPrime),
          child: SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Container(
                    width: 88,
                    height: 88,
                    decoration: BoxDecoration(
                      color: AppColors.white.withValues(alpha: 0.12),
                      shape: BoxShape.circle,
                      border: Border.all(
                          color: AppColors.white.withValues(alpha: 0.2)),
                    ),
                    child: Icon(
                      _failed ? lockedIcon : unlockedIcon,
                      color: AppColors.goldPrime,
                      size: 44,
                    ),
                  ),
                  const SizedBox(height: 24),
                  Text(
                    _failed ? 'Locked' : 'Unlock to continue',
                    style: AppFonts.display(
                      color: AppColors.white,
                      fontSize: 24,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    _failed
                        ? 'We could not verify $unlockMethod. Tap retry$fallbackHint.'
                        : 'Use $unlockMethod$fallbackHint to access your account.',
                    textAlign: TextAlign.center,
                    style: AppFonts.body(
                      color: AppColors.white.withValues(alpha: 0.7),
                      fontSize: 13,
                      height: 1.4,
                    ),
                  ),
                  const SizedBox(height: 32),
                  if (_busy)
                    const SizedBox(
                      width: 28,
                      height: 28,
                      child: CircularProgressIndicator(
                        strokeWidth: 2.5,
                        valueColor:
                            AlwaysStoppedAnimation<Color>(Colors.white),
                      ),
                    )
                  else
                    SizedBox(
                      width: double.infinity,
                      child: ElevatedButton.icon(
                        onPressed: _runPrompt,
                        icon: Icon(unlockedIcon),
                        label: Text(
                          _failed
                              ? 'Try Again'
                              : (passcodeMode ? 'Enter Passcode' : 'Unlock'),
                          style: AppFonts.body(
                            fontWeight: FontWeight.w700,
                            fontSize: 15,
                          ),
                        ),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.goldPrime,
                          foregroundColor: AppColors.darkBg,
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          shape: const StadiumBorder(),
                          elevation: 0,
                        ),
                      ),
                    ),
                  const SizedBox(height: 14),
                  TextButton(
                    onPressed: _busy ? null : _useOtpInstead,
                    style: TextButton.styleFrom(
                      foregroundColor: AppColors.white.withValues(alpha: 0.85),
                    ),
                    child: Text(
                      'Use OTP instead',
                      style: AppFonts.body(
                        fontWeight: FontWeight.w600,
                        fontSize: 13,
                        decoration: TextDecoration.underline,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
