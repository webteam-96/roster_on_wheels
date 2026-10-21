import 'package:flutter/services.dart';

/// Bridge to the platform-native passcode-only authentication, which
/// `local_auth` does not expose.
///
/// - **iOS**: `LAContext.evaluateAccessControl` with `.devicePasscode`
///   — skips Face ID / Touch ID entirely, prompts only the device passcode.
/// - **Android**: `BiometricPrompt` with `Authenticators.DEVICE_CREDENTIAL`
///   only — skips fingerprint / face unlock, prompts only the device PIN /
///   pattern / password.
class PasscodeAuthChannel {
  static const _channel = MethodChannel('rotary_india/passcode_auth');

  /// Prompts the OS for the device passcode. Returns true on success,
  /// false on cancel, error, or when the device has no passcode set.
  static Future<bool> authenticate({
    String reason = 'Enter your device passcode to unlock',
    String? androidTitle,
    String? androidSubtitle,
  }) async {
    try {
      final ok = await _channel.invokeMethod<bool>(
        'authenticatePasscode',
        {
          // iOS uses `reason` as the localizedReason on the prompt.
          'reason': reason,
          // Android uses title + subtitle on the BiometricPrompt sheet.
          'title': androidTitle ?? 'Unlock',
          'subtitle': androidSubtitle ?? reason,
        },
      );
      return ok ?? false;
    } catch (_) {
      return false;
    }
  }
}
