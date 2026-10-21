import 'package:flutter/foundation.dart';
import 'package:local_auth/local_auth.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'passcode_auth_channel.dart';

/// How the App Lock authenticates the user on cold start.
///
/// - [off]: no lock.
/// - [biometric]: prompt biometric (Face ID / fingerprint). The OS adds an
///   automatic device-passcode fallback if biometric fails or is unavailable.
/// - [passcode]: prefer the device passcode. We still call the same OS API
///   (there is no public "passcode only" policy on iOS or Android), so
///   biometric *may* appear first if it's enrolled — the user can tap Cancel
///   to enter their passcode immediately. To skip biometric entirely the
///   user can also disable per-app Face ID in iOS Settings.
enum LockMode { off, biometric, passcode }

/// Manages the optional "App Lock" feature.
///
/// **Pattern A** semantics: the lock fires only on cold start (when the
/// app process is freshly launched), not on resume from background.
/// The splash screen routes through `AppLockScreen` when [enabled] is true
/// and the device is capable.
class BiometricController extends ChangeNotifier {
  static const _kModeKey = 'appLockMode';
  // Legacy bool key from before LockMode existed. Migrated on first init.
  static const _kLegacyEnabledKey = 'biometricLockEnabled';

  final LocalAuthentication _auth = LocalAuthentication();

  LockMode _mode = LockMode.off;
  bool _initialized = false;
  bool _supported = false;
  List<BiometricType> _availableTypes = const [];

  /// Active lock mode. Persisted in SharedPreferences.
  LockMode get mode => _mode;

  /// Convenience: any non-off mode.
  bool get enabled => _mode != LockMode.off;

  /// Has [init] completed at least once?
  bool get initialized => _initialized;

  /// Device supports SOME form of authentication (biometric OR passcode).
  /// True iff the user has set up a phone passcode AND the OS exposes the
  /// LocalAuth APIs.
  bool get supported => _supported;

  /// True when [supported] AND user has enrolled at least one biometric
  /// (Face ID, Touch ID, fingerprint).
  bool get biometricEnrolled => _supported && _availableTypes.isNotEmpty;

  /// Backwards-compat alias used in older settings code paths.
  bool get usable => biometricEnrolled;

  /// Best-effort label for the available biometric.
  String get prettyLabel {
    if (_availableTypes.contains(BiometricType.face)) return 'Face ID';
    if (_availableTypes.contains(BiometricType.fingerprint)) {
      return 'Fingerprint';
    }
    if (_availableTypes.contains(BiometricType.iris)) return 'Iris';
    return 'Biometric';
  }

  /// Load persisted preference and probe the device's capability.
  /// Safe to call multiple times.
  Future<void> init() async {
    final prefs = await SharedPreferences.getInstance();
    final stored = prefs.getString(_kModeKey);
    if (stored != null) {
      _mode = LockMode.values.firstWhere(
        (m) => m.name == stored,
        orElse: () => LockMode.off,
      );
    } else {
      // Migrate from old bool flag — anyone who had it on becomes biometric.
      final legacy = prefs.getBool(_kLegacyEnabledKey);
      _mode = (legacy == true) ? LockMode.biometric : LockMode.off;
      if (legacy != null) {
        await prefs.setString(_kModeKey, _mode.name);
      }
    }
    try {
      _supported = await _auth.isDeviceSupported() &&
          await _auth.canCheckBiometrics;
      _availableTypes =
          _supported ? await _auth.getAvailableBiometrics() : const [];
    } catch (_) {
      _supported = false;
      _availableTypes = const [];
    }
    _initialized = true;
    notifyListeners();
  }

  /// Switch lock mode. When enabling (any non-off mode), we require a
  /// successful auth check first so users can't lock themselves out.
  Future<bool> setMode(LockMode mode) async {
    if (_mode == mode) return true;
    if (mode != LockMode.off) {
      final ok = await authenticate(
        reason: 'Confirm to enable App Lock',
        modeOverride: mode,
      );
      if (!ok) return false;
    }
    _mode = mode;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kModeKey, mode.name);
    return true;
  }

  /// Backwards-compat thin wrapper. Maps a bool toggle to a mode change.
  /// Picks `biometric` when enabling unless biometric isn't enrolled, in
  /// which case it falls back to `passcode`.
  Future<bool> setEnabled(bool value) {
    if (!value) return setMode(LockMode.off);
    return setMode(
      biometricEnrolled ? LockMode.biometric : LockMode.passcode,
    );
  }

  /// Triggers the OS auth prompt. Returns true on success, false if the
  /// user cancelled, no credentials are usable, or the call threw.
  ///
  /// In **biometric** mode we use `local_auth` with `biometricOnly: false`
  /// so the OS falls back to the device passcode if biometric fails.
  ///
  /// In **passcode** mode we route through [PasscodeAuthChannel], which is
  /// a native bridge that forces a passcode-only prompt (iOS keychain
  /// access-control trick / Android `BiometricPrompt` with
  /// `DEVICE_CREDENTIAL`-only authenticators). `local_auth` cannot do this
  /// — it always tries biometric first when enrolled.
  Future<bool> authenticate({
    String reason = 'Unlock to continue',
    LockMode? modeOverride,
  }) async {
    final activeMode = modeOverride ?? _mode;
    if (activeMode == LockMode.off) return true;
    if (!_supported) return false;

    if (activeMode == LockMode.passcode) {
      return PasscodeAuthChannel.authenticate(
        reason: reason,
        androidTitle: 'Unlock',
        androidSubtitle: reason,
      );
    }

    try {
      return await _auth.authenticate(
        localizedReason: reason,
        options: const AuthenticationOptions(
          stickyAuth: true,
          biometricOnly: false,
          useErrorDialogs: true,
        ),
      );
    } catch (_) {
      return false;
    }
  }

  /// Cancels any pending OS auth dialog. Safe to call when none is showing.
  Future<void> stop() async {
    try {
      await _auth.stopAuthentication();
    } catch (_) {}
  }

  /// Wipe the user's preference. Called from logout so a new user signing
  /// in on the same device starts with the lock off.
  Future<void> clear() async {
    _mode = LockMode.off;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_kModeKey);
    await prefs.remove(_kLegacyEnabledKey);
  }
}
