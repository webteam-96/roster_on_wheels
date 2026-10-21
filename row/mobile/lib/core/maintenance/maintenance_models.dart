import '../constants/api_constants.dart';
import '../network/api_client.dart';

/// One active maintenance entry — the message + ETA for a flagged RouteKey.
class MaintenanceEntry {
  final String? message;
  final DateTime? until;
  const MaintenanceEntry({this.message, this.until});
}

/// In-memory snapshot of the backend's ACTIVE route-maintenance rows
/// (`GET /api/app/route-maintenance`). Keys are stored verbatim as the backend
/// sends them:
///   • route templates  — `/clubs/:id/overview`
///   • per-tab keys      — `/clubs/:id/overview#foundation`
///   • the global switch — `*`
///
/// Route-level matching is param-name agnostic (a concrete path like
/// `/clubs/5/overview` is matched against the active templates via regex), so it
/// never breaks if a go_router param is renamed. Tab keys and `*` use exact
/// lookups.
class MaintenanceRegistry {
  final Map<String, MaintenanceEntry> _byKey;
  // Precompiled matchers for the active ROUTE-level keys only (no `#`, no `*`).
  final List<MapEntry<RegExp, String>> _routeMatchers;

  const MaintenanceRegistry._(this._byKey, this._routeMatchers);

  factory MaintenanceRegistry.empty() =>
      const MaintenanceRegistry._({}, <MapEntry<RegExp, String>>[]);

  factory MaintenanceRegistry.fromRows(List<dynamic> rows) {
    final map = <String, MaintenanceEntry>{};
    for (final r in rows) {
      if (r is! Map<String, dynamic>) continue;
      final key = r['routeKey']?.toString();
      if (key == null || key.isEmpty) continue;
      final active =
          r['isUnderMaintenance'] == true || r['isUnderMaintenance'] == 1;
      if (!active) continue;
      final rawMsg = r['message']?.toString();
      final rawUntil = r['maintenanceUntil']?.toString();
      map[key] = MaintenanceEntry(
        message: (rawMsg == null || rawMsg.trim().isEmpty) ? null : rawMsg.trim(),
        until: (rawUntil == null || rawUntil.isEmpty)
            ? null
            : DateTime.tryParse(rawUntil),
      );
    }
    final matchers = <MapEntry<RegExp, String>>[];
    for (final key in map.keys) {
      if (key == '*' || key.contains('#')) continue;
      matchers.add(MapEntry(_templateToRegExp(key), key));
    }
    return MaintenanceRegistry._(map, matchers);
  }

  bool get globalActive => _byKey.containsKey('*');
  MaintenanceEntry? get globalEntry => _byKey['*'];

  bool get isEmpty => _byKey.isEmpty;

  /// Cheap structural equality (keys + message + until) so the controller can
  /// skip redundant notifications when a poll returns an unchanged snapshot.
  bool sameAs(MaintenanceRegistry other) {
    if (_byKey.length != other._byKey.length) return false;
    for (final e in _byKey.entries) {
      final o = other._byKey[e.key];
      if (o == null) return false;
      if (o.message != e.value.message || o.until != e.value.until) return false;
    }
    return true;
  }

  /// Exact-key lookup — used for tab keys (`…#tab`) and the global `*`.
  bool isKeyBlocked(String key) => _byKey.containsKey(key);
  MaintenanceEntry? entryForKey(String key) => _byKey[key];

  /// Matches a CONCRETE path (`/clubs/5/overview`, query stripped) against the
  /// active route-level templates. Returns the matched template key or null.
  /// Ignores tab (`#`) and global (`*`) keys.
  String? matchPath(String concretePath) {
    final path = concretePath.split('?').first;
    for (final m in _routeMatchers) {
      if (m.key.hasMatch(path)) return m.value;
    }
    return null;
  }

  MaintenanceEntry? entryForPath(String concretePath) {
    final key = matchPath(concretePath);
    return key == null ? null : _byKey[key];
  }

  // `/clubs/:id/overview` → ^/clubs/[^/]+/overview$  (each :param = one segment)
  static RegExp _templateToRegExp(String template) {
    final escaped = template.split('/').map((seg) {
      if (seg.startsWith(':')) return r'[^/]+';
      return seg.replaceAllMapped(
          RegExp(r'[.*+?^${}()|[\]\\]'), (m) => '\\${m[0]}');
    }).join('/');
    return RegExp('^$escaped\$');
  }

  /// Fetches the active list. Returns null on ANY error so the caller can keep
  /// the last good snapshot (fail-soft — a network blip must never block the app).
  static Future<MaintenanceRegistry?> fetch(ApiClient api) async {
    try {
      final resp = await api.get<List<dynamic>>(
        ApiConstants.appRouteMaintenance,
        fromJson: (j) => j as List<dynamic>,
      );
      return MaintenanceRegistry.fromRows(resp.data ?? const []);
    } catch (_) {
      return null;
    }
  }
}
