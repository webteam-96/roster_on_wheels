import 'package:intl/intl.dart';

class DateFormatter {
  static final DateFormat _display = DateFormat('dd MMM yyyy');
  static final DateFormat _displayWithTime = DateFormat('dd MMM yyyy, hh:mm a');
  static final DateFormat _api = DateFormat('yyyy-MM-dd');
  static final DateFormat _time = DateFormat('hh:mm a');
  static final DateFormat _monthYear = DateFormat('MMM yyyy');

  /// MySQL "zero" dates now deserialize to `0001-01-01` on the backend (after
  /// the `ConvertZeroDateTime=true` connection-string change) instead of
  /// erroring. They are a "no value" sentinel, not a real date, so we treat any
  /// year <= 1 as empty everywhere — never render "01 Jan 0001".
  static bool isZeroDate(DateTime? date) => date == null || date.year <= 1;

  static String toDisplay(DateTime? date) {
    if (isZeroDate(date)) return '-';
    return _display.format(date!);
  }

  static String toDisplayWithTime(DateTime? date) {
    if (isZeroDate(date)) return '-';
    return _displayWithTime.format(date!);
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
      return _time.format(dt);
    } catch (_) {
      return timeStr;
    }
  }

  static String toMonthYear(DateTime? date) {
    if (isZeroDate(date)) return '-';
    return _monthYear.format(date!);
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
