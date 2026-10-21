import 'package:flutter/foundation.dart';
import '../constants/api_constants.dart';
import '../network/api_client.dart';
import '../../presentation/providers/auth_provider.dart';

/// Platform module switches (api/Services/FeatureGate.cs, user's module sheet 2026-10-21). A skipped module, or a
/// flagged one a SuperAdmin has not switched on, is off: the router sends its screens to "Not available" and menus
/// drop its tiles. The app routes use the same paths as the admin, so the admin path patterns apply here as well.
/// Fetched on login and app resume; fail-soft (a failed fetch keeps the last list, the API refuses the calls anyway).
class FeatureController extends ChangeNotifier {
  FeatureController(this._auth, {ApiClient? api}) : _api = api ?? ApiClient() {
    _wasLoggedIn = _auth.isLoggedIn;
    _auth.addListener(_onAuthChanged);
    if (_auth.isLoggedIn) refresh();
  }

  final AuthProvider _auth;
  final ApiClient _api;
  bool _wasLoggedIn = false;
  List<RegExp> _off = const [];
  Set<String> _offKeys = const {};

  /// True when [path] (an app route such as `/clubs/3/pph-camps`) belongs to a module that is off.
  bool isPathOff(String path) => offPatternsMatch(_off, path);

  /// True when the module is usable. Unknown keys and a not-yet-loaded list count as on.
  bool isOn(String key) => !_offKeys.contains(key);

  void _onAuthChanged() {
    final now = _auth.isLoggedIn;
    if (now && !_wasLoggedIn) {
      refresh();
    } else if (!now && _wasLoggedIn) {
      _off = const [];
      _offKeys = const {};
      notifyListeners();
    }
    _wasLoggedIn = now;
  }

  Future<void> refresh() async {
    if (!_auth.isLoggedIn) return;
    try {
      final resp = await _api.get<List<dynamic>>(ApiConstants.features, fromJson: (j) => j as List<dynamic>);
      final rows = (resp.data ?? const []).cast<Map<String, dynamic>>();
      final off = rows.where((f) => f['kind'] == 'skipped' || f['enabled'] != true).toList();
      _offKeys = off.map((f) => f['key'] as String).toSet();
      _off = offPatterns(off);
      notifyListeners();
    } catch (_) {
      // keep the last list
    }
  }
}

List<RegExp> offPatterns(List<Map<String, dynamic>> offFeatures) => [
      for (final f in offFeatures)
        for (final p in (f['adminPaths'] as List? ?? const [])) RegExp(p as String, caseSensitive: false),
    ];

bool offPatternsMatch(List<RegExp> patterns, String path) => patterns.any((re) => re.hasMatch(path));
