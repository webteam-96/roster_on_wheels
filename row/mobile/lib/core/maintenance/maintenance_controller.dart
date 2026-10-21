import 'package:flutter/foundation.dart';
import '../network/api_client.dart';
import '../../presentation/providers/auth_provider.dart';
import 'maintenance_models.dart';

/// Holds the current ACTIVE route-maintenance snapshot. Kept fresh WITHOUT
/// background polling — refresh is event-driven, only at the moments the gate is
/// about to be evaluated:
///   • on login (forced),
///   • on app resume (forced),
///   • on every navigation (router redirect pings `refresh()`),
///   • on a dashboard tab tap (the 3 overview screens ping `refresh()`).
/// All non-forced calls are throttled to ≤1 fetch per [_minGap], so rapid events
/// can't hammer the API and an **idle** app makes **zero** calls.
/// Fail-soft: a failed fetch keeps the last good snapshot (never blocks the app);
/// the snapshot is cleared on logout so flags don't leak between users.
class MaintenanceController extends ChangeNotifier {
  MaintenanceController(this._auth, {ApiClient? api})
      : _api = api ?? ApiClient() {
    _wasLoggedIn = _auth.isLoggedIn;
    _auth.addListener(_onAuthChanged);
    if (_auth.isLoggedIn) refresh(force: true);
  }

  final AuthProvider _auth;
  final ApiClient _api;

  // Minimum gap between non-forced fetches — lets `refresh()` be pinged
  // liberally (navigation, tab taps) without hammering the API.
  static const Duration _minGap = Duration(seconds: 8);

  MaintenanceRegistry _registry = MaintenanceRegistry.empty();
  bool _wasLoggedIn = false;
  bool _inFlight = false;
  DateTime? _lastFetchAt;
  String? _lastNavPath;

  MaintenanceRegistry get registry => _registry;

  void _onAuthChanged() {
    final now = _auth.isLoggedIn;
    if (now && !_wasLoggedIn) {
      refresh(force: true);
    } else if (!now && _wasLoggedIn) {
      _registry = MaintenanceRegistry.empty();
      _lastFetchAt = null;
      _lastNavPath = null;
      notifyListeners();
    }
    _wasLoggedIn = now;
  }

  /// Refresh tied to a navigation redirect. De-duped by [path] so the router's
  /// per-second redirect re-evaluations — driven by the UNRELATED session-
  /// countdown timer in [AuthProvider] (`Timer.periodic(1s)` → `notifyListeners`),
  /// which the router's merged `refreshListenable` picks up — do NOT cause idle
  /// fetches. Only a genuine path change pings the (still-throttled) network
  /// refresh. Result: sitting idle on a screen makes ZERO maintenance calls.
  void refreshForPath(String path) {
    if (path == _lastNavPath) return;
    _lastNavPath = path;
    refresh();
  }

  /// Re-fetch the active list. Throttled to at most once per [_minGap] unless
  /// [force] (login / resume). Fire-and-forget safe — call it on tab taps; for
  /// navigation use [refreshForPath] so same-path redirect ticks are ignored.
  Future<void> refresh({bool force = false}) async {
    if (!_auth.isLoggedIn || _inFlight) return;
    final now = DateTime.now();
    if (!force &&
        _lastFetchAt != null &&
        now.difference(_lastFetchAt!) < _minGap) {
      return;
    }
    _inFlight = true;
    _lastFetchAt = now;
    try {
      final next = await MaintenanceRegistry.fetch(_api);
      if (next != null && !next.sameAs(_registry)) {
        _registry = next;
        notifyListeners();
      }
      // next == null → fetch failed → keep the last good snapshot.
      // next.sameAs(current) → unchanged → skip notify (no redundant rebuilds).
    } finally {
      _inFlight = false;
    }
  }

  @override
  void dispose() {
    _auth.removeListener(_onAuthChanged);
    super.dispose();
  }
}
