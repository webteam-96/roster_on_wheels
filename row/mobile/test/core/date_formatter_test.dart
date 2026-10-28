import 'package:flutter_test/flutter_test.dart';
import 'package:intl/intl.dart';
import 'package:rotary_flutter_app/core/utils/date_formatter.dart';
import 'package:timezone/timezone.dart' as tz;

void main() {
  setUpAll(DateFormatter.init);

  test('a stored UTC time shows in device time, in the device locale', () {
    final utc = DateTime.utc(2026, 10, 23, 18, 30);
    expect(DateFormatter.toDisplayWithTime(utc), DateFormat.yMMMd('en_US').add_jm().format(utc.toLocal()));
    expect(DateFormatter.toDisplay(DateTime(2026, 10, 23)), 'Oct 23, 2026'); // the test device is en_US
    expect(DateFormatter.toTimeDisplay('18:05'), '6:05 PM'); // CLDR puts a narrow space before AM/PM
  });

  group('event times (spec 3.3)', () {
    const ny = 'America/New_York';
    test('wall-clock is the event zone; same-zone viewer sees it once', () {
      DateFormatter.eventDateTime('2026-10-30T19:00:00', ny, locale: 'en_US'); // loads the zone data
      final v = tz.getLocation(ny);
      expect(DateFormatter.eventDateTime('2026-10-30T19:00:00', ny, viewer: v, locale: 'en_US'),
          'Oct 30, 2026 7:00 PM EDT');
    });
    test('another zone adds the viewer time, with the date when it differs', () {
      final tokyo = tz.getLocation('Asia/Tokyo');
      expect(DateFormatter.eventDateTime('2026-10-30T19:00:00', ny, viewer: tokyo, locale: 'en_US'),
          'Oct 30, 2026 7:00 PM EDT (Oct 31, 2026 8:00 AM your time)');
      final london = tz.getLocation('Europe/London');
      expect(DateFormatter.eventDateTime('2026-10-30T19:00:00', ny, viewer: london, locale: 'en_US'),
          'Oct 30, 2026 7:00 PM EDT (11:00 PM your time)');
    });
    test('a UTC instant and winter time', () {
      final v = tz.getLocation(ny);
      expect(DateFormatter.eventDateTime('2026-10-30T23:00:00Z', ny, viewer: v, locale: 'en_US'),
          'Oct 30, 2026 7:00 PM EDT');
      expect(DateFormatter.eventDateTime('2026-12-01T19:00:00', ny, viewer: v, locale: 'en_US'),
          'Dec 1, 2026 7:00 PM EST');
    });
    test('empty and unknown zone', () {
      expect(DateFormatter.eventDateTime(null, ny), '-');
      expect(DateFormatter.eventDateTime('2026-10-30T19:00:00', 'Not/AZone'),
          DateFormatter.toDisplayWithTime(DateTime(2026, 10, 30, 19)));
    });
  });

  test('API dates stay ISO and zero dates stay empty', () {
    expect(DateFormatter.toApiFormat(DateTime(2026, 1, 5)), '2026-01-05');
    expect(DateFormatter.toDisplay(DateTime(1)), '-');
  });
}
