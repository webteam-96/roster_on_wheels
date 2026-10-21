import 'dart:io' show Platform;
import 'package:package_info_plus/package_info_plus.dart';
import '../network/api_client.dart';

/// Result of `/api/mobile/version-check?currentVersion=X.Y.Z`.
///
/// Backend returns all flags `false` / fields `null` when no row is
/// configured for the platform — treat that as "no update needed".
class MobileVersionResult {
  final bool isForceUpdate;
  final bool isUpdateAvailable;
  final String? currentVersion;
  final String? requiredVersion;
  final String? message;
  final String? playStoreUrl;
  final String? appStoreUrl;

  const MobileVersionResult({
    required this.isForceUpdate,
    required this.isUpdateAvailable,
    this.currentVersion,
    this.requiredVersion,
    this.message,
    this.playStoreUrl,
    this.appStoreUrl,
  });

  static const empty = MobileVersionResult(
    isForceUpdate: false,
    isUpdateAvailable: false,
  );

  MobileVersionResult copyWith({
    bool? isForceUpdate,
    bool? isUpdateAvailable,
    String? currentVersion,
    String? requiredVersion,
    String? message,
    String? playStoreUrl,
    String? appStoreUrl,
  }) {
    return MobileVersionResult(
      isForceUpdate: isForceUpdate ?? this.isForceUpdate,
      isUpdateAvailable: isUpdateAvailable ?? this.isUpdateAvailable,
      currentVersion: currentVersion ?? this.currentVersion,
      requiredVersion: requiredVersion ?? this.requiredVersion,
      message: message ?? this.message,
      playStoreUrl: playStoreUrl ?? this.playStoreUrl,
      appStoreUrl: appStoreUrl ?? this.appStoreUrl,
    );
  }

  /// Returns the right store URL for the current platform, or null.
  String? storeUrlForPlatform() {
    if (Platform.isIOS) return appStoreUrl;
    if (Platform.isAndroid) return playStoreUrl;
    return null;
  }

  factory MobileVersionResult.fromJson(Map<String, dynamic> j) {
    return MobileVersionResult(
      isForceUpdate: j['isForceUpdate'] == true,
      isUpdateAvailable: j['isUpdateAvailable'] == true,
      currentVersion: j['currentVersion'] as String?,
      requiredVersion: j['requiredVersion'] as String?,
      message: j['message'] as String?,
      playStoreUrl: j['playStoreUrl'] as String?,
      appStoreUrl: j['appStoreUrl'] as String?,
    );
  }
}

class MobileVersionService {
  MobileVersionService({ApiClient? api}) : _api = api ?? ApiClient();

  final ApiClient _api;

  /// Calls `/api/mobile/version-check`. Returns [MobileVersionResult.empty]
  /// on any error so a flaky network never blocks app launch.
  ///
  /// Note: backend's `CompareVersions` splits the version on `.` only, so
  /// values like `59.0.4+5` truncate to `59.0.0` server-side and the flags
  /// come back wrong. We re-compare `currentVersion` vs `requiredVersion`
  /// from the response (stripping `+N` build metadata) and override BOTH
  /// `isUpdateAvailable` and `isForceUpdate` when client-side compare says
  /// the client is behind. (Temporary: tighten this once the backend
  /// comparator is fixed and force vs soft can come from the server.)
  Future<MobileVersionResult> check() async {
    try {
      final info = await PackageInfo.fromPlatform();
      final resp = await _api.get<Map<String, dynamic>>(
        '/api/mobile/version-check',
        queryParams: {'currentVersion': "${info.version}+${info.buildNumber}"},
        requiresAuth: false,
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final data = resp.data;
      if (data == null) return MobileVersionResult.empty;
      final result = MobileVersionResult.fromJson(data);

      final current = result.currentVersion ?? info.version;
      final required = result.requiredVersion;
      if (required == null || required.isEmpty) return result;
      final clientSaysUpdate = compareVersions(current, required) < 0;
      if (clientSaysUpdate) {
        return result.copyWith(
          isUpdateAvailable: true,
          isForceUpdate: true,
        );
      }
      return result;
    } catch (_) {
      return MobileVersionResult.empty;
    }
  }

  /// Returns negative if `a < b`, zero if equal, positive if `a > b`.
  /// Strips `+build` and `-prerelease` suffixes before comparing each
  /// dot-separated segment numerically. Non-numeric segments compare as 0.
  static int compareVersions(String a, String b) {
    final ap = _normalize(a).split('.').map(_segment).toList();
    final bp = _normalize(b).split('.').map(_segment).toList();
    final n = ap.length > bp.length ? ap.length : bp.length;
    for (var i = 0; i < n; i++) {
      final av = i < ap.length ? ap[i] : 0;
      final bv = i < bp.length ? bp[i] : 0;
      if (av != bv) return av.compareTo(bv);
    }
    return 0;
  }

  static String _normalize(String v) {
    final t = v.trim();
    final plus = t.indexOf('+');
    final core = plus >= 0 ? t.substring(0, plus) : t;
    final dash = core.indexOf('-');
    return dash >= 0 ? core.substring(0, dash) : core;
  }

  static int _segment(String s) => int.tryParse(s.trim()) ?? 0;
}
