import 'dart:ui' show PlatformDispatcher;

import 'package:intl/date_symbol_data_local.dart';
import 'package:intl/intl.dart';
import 'package:timezone/data/latest.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

/// Dates for display in the device's locale and time zone (N12): the API sends stored UTC times with "Z", so a
/// time is shown in device time. API values ([toApiFormat]) stay ISO, whatever the locale.
/// shortcut: screens that build their own DateFormat('...') keep fixed English patterns; move them here when the
/// app gets more languages.
class DateFormatter {
  static final DateFormat _api = DateFormat('yyyy-MM-dd', 'en_US');

  /// Loads the date names of every locale intl ships; call once before runApp.
  static Future<void> init() => initializeDateFormatting();

  /// The device's locale (or its language) when intl has date names for it, else English.
  static String get _locale => Intl.verifiedLocale(
      PlatformDispatcher.instance.locale.toLanguageTag(), DateFormat.localeExists,
      onFailure: (_) => 'en_US')!;

  /// MySQL "zero" dates now deserialize to `0001-01-01` on the backend (after
  /// the `ConvertZeroDateTime=true` connection-string change) instead of
  /// erroring. They are a "no value" sentinel, not a real date, so we treat any
  /// year <= 1 as empty everywhere — never render "01 Jan 0001".
  static bool isZeroDate(DateTime? date) => date == null || date.year <= 1;

  static String toDisplay(DateTime? date) {
    if (isZeroDate(date)) return '-';
    return DateFormat.yMMMd(_locale).format(date!.toLocal());
  }

  static String toDisplayWithTime(DateTime? date) {
    if (isZeroDate(date)) return '-';
    return DateFormat.yMMMd(_locale).add_jm().format(date!.toLocal());
  }

  static bool _zonesLoaded = false;

  /// An event or meeting time from the API (build spec 3.3), shown in the event's zone (its district's IANA id,
  /// from /api/time-zone) with the zone's abbreviation, plus the device's own time when its zone differs at that
  /// moment. [raw] is the API string: with an offset ("Z") it is an instant; without one it is the event zone's
  /// wall-clock. No [zone] (not loaded yet) shows the value as the device-time display does. [viewer] is for tests.
  static String eventDateTime(String? raw, String? zone, {tz.Location? viewer, String? locale}) {
    if (raw == null || raw.isEmpty) return '-';
    final parsed = DateTime.tryParse(raw);
    if (parsed == null || parsed.year <= 1) return '-';
    if (zone == null || zone.isEmpty) return toDisplayWithTime(parsed);
    if (!_zonesLoaded) {
      tzdata.initializeTimeZones();
      _zonesLoaded = true;
    }
    final tz.Location loc;
    try {
      loc = tz.getLocation(zone);
    } catch (_) {
      return toDisplayWithTime(parsed);
    }
    final at = parsed.isUtc
        ? tz.TZDateTime.from(parsed, loc)
        : tz.TZDateTime(loc, parsed.year, parsed.month, parsed.day, parsed.hour, parsed.minute, parsed.second);
    final l = locale ?? _locale;
    final full = DateFormat.yMMMd(l).add_jm();
    final shown = '${full.format(at)} ${at.timeZoneName}';
    final DateTime mine = viewer != null ? tz.TZDateTime.from(at, viewer) : at.toLocal();
    if (mine.timeZoneOffset == at.timeZoneOffset) return shown;
    final sameDay = mine.year == at.year && mine.month == at.month && mine.day == at.day;
    return '$shown (${(sameDay ? DateFormat.jm(l) : full).format(mine)} your time)';
  }

  static String toApiFormat(DateTime? date) {
    if (isZeroDate(date)) return '';
    return _api.format(date!);
  }

  static String toTimeDisplay(String? timeStr) {
    if (timeStr == null || timeStr.isEmpty) return '-';
    try {
      final parts = timeStr.split(':');
      final hour = int.parse(parts[0]);
      final minute = int.parse(parts[1]);
      final dt = DateTime(2000, 1, 1, hour, minute);
      return DateFormat.jm(_locale).format(dt);
    } catch (_) {
      return timeStr;
    }
  }

  static String toMonthYear(DateTime? date) {
    if (isZeroDate(date)) return '-';
    return DateFormat.yMMM(_locale).format(date!.toLocal());
  }

  static DateTime? fromApiString(String? dateStr) {
    if (dateStr == null || dateStr.isEmpty) return null;
    try {
      final parsed = DateTime.parse(dateStr).toLocal();
      // A backend zero date (`0001-01-01…`) means "no value" — surface it as
      // null so callers don't have to special-case the sentinel themselves.
      if (parsed.year <= 1) return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  static String relativeTime(DateTime? date) {
    if (isZeroDate(date)) return '-';
    final now = DateTime.now();
    final diff = now.difference(date!);
    if (diff.inDays > 365) return '${(diff.inDays / 365).floor()}y ago';
    if (diff.inDays > 30) return '${(diff.inDays / 30).floor()}mo ago';
    if (diff.inDays > 0) return '${diff.inDays}d ago';
    if (diff.inHours > 0) return '${diff.inHours}h ago';
    if (diff.inMinutes > 0) return '${diff.inMinutes}m ago';
    return 'Just now';
  }
}
