import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../constants/api_constants.dart';
import '../network/api_client.dart';

/// Drives the unread-count badge on the home bell icon.
///
/// The `/api/mobile/notifications` feed has NO server-side read/unread state, so
/// "unread" is defined client-side as *items newer than the last time the user
/// opened the Notifications screen*. That "last seen" instant is persisted (UTC
/// ISO-8601) in shared_preferences and updated by [markAllSeen] when the screen
/// opens.
///
/// The count is exposed as a [ValueNotifier] so the bell can rebuild via a
/// [ValueListenableBuilder] without any provider wiring. [refresh] fetches only
/// the newest page and counts what's newer than the stored instant; it fails
/// silently (a badge is best-effort) and leaves the current value untouched on
/// error.
class NotificationBadgeService {
  NotificationBadgeService._();
  static final NotificationBadgeService instance = NotificationBadgeService._();

  static const String _kLastSeen = 'notifications_last_seen_at';
  // Only the first page is inspected; anything past this reads as "9+" anyway.
  static const int _probePageSize = 30;

  final ApiClient _api = ApiClient();

  /// Current unread count. 0 means no badge.
  final ValueNotifier<int> count = ValueNotifier<int>(0);

  /// Recompute the badge from the newest page of the feed. Safe to call often
  /// (home mount, returning from the notifications screen). No-op visual change
  /// on network failure.
  Future<void> refresh() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_kLastSeen);
      final lastSeen = raw == null ? null : DateTime.tryParse(raw)?.toUtc();

      // First run ever: seed "now" so we start at zero instead of surfacing the
      // whole backlog as unread.
      if (lastSeen == null) {
        await prefs.setString(
            _kLastSeen, DateTime.now().toUtc().toIso8601String());
        count.value = 0;
        return;
      }

      final res = await _api.get<Map<String, dynamic>>(
        ApiConstants.mobileNotifications,
        queryParams: {'page': 1, 'pageSize': _probePageSize},
        fromJson: (j) => j as Map<String, dynamic>,
      );
      final items = (res.data?['items'] as List<dynamic>? ?? []);

      var unread = 0;
      for (final e in items) {
        if (e is! Map) continue;
        final dt = DateTime.tryParse((e['dateTime'] ?? '').toString())?.toUtc();
        if (dt != null && dt.isAfter(lastSeen)) unread++;
      }
      count.value = unread;
    } catch (_) {
      // Best-effort: keep whatever we last showed.
    }
  }

  /// Mark everything as seen (clears the badge). Called when the Notifications
  /// screen loads its first page.
  Future<void> markAllSeen() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
          _kLastSeen, DateTime.now().toUtc().toIso8601String());
    } catch (_) {
      // If persistence fails the badge simply reappears next refresh — fine.
    }
    count.value = 0;
  }
}
