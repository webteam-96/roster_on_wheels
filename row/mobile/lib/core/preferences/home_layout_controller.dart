import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Controller for experimental / user-facing home layout preferences.
///
/// Currently exposes a single flag — [unifiedHomeEnabled] — which flips the
/// "My Connections" section on the home screen between the legacy per-scope
/// tile layout (District Admin + Club Admin + My Club as separate tiles) and
/// the new unified layout (one "My Rotary" tile that opens the unified
/// modules screen).
///
/// The flag defaults to OFF — users see the legacy per-scope tiles by default
/// and can opt in to the unified layout from Settings. The choice is persisted
/// per-device via SharedPreferences so it survives across sessions.
class HomeLayoutController extends ChangeNotifier {
  static const _kUnifiedHomeKey = 'unifiedHomeEnabled';

  bool _unifiedHomeEnabled = false;
  bool get unifiedHomeEnabled => _unifiedHomeEnabled;

  HomeLayoutController() {
    _loadFromPrefs();
  }

  Future<void> _loadFromPrefs() async {
    final prefs = await SharedPreferences.getInstance();
    _unifiedHomeEnabled = prefs.getBool(_kUnifiedHomeKey) ?? false;
    notifyListeners();
  }

  Future<void> setUnifiedHomeEnabled(bool value) async {
    if (_unifiedHomeEnabled == value) return;
    _unifiedHomeEnabled = value;
    notifyListeners();

    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_kUnifiedHomeKey, value);
  }
}
