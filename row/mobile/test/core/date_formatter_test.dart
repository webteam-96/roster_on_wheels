import 'package:flutter_test/flutter_test.dart';
import 'package:intl/intl.dart';
import 'package:rotary_flutter_app/core/utils/date_formatter.dart';

void main() {
  setUpAll(DateFormatter.init);

  test('a stored UTC time shows in device time, in the device locale', () {
    final utc = DateTime.utc(2026, 10, 23, 18, 30);
    expect(DateFormatter.toDisplayWithTime(utc), DateFormat.yMMMd('en_US').add_jm().format(utc.toLocal()));
    expect(DateFormatter.toDisplay(DateTime(2026, 10, 23)), 'Oct 23, 2026'); // the test device is en_US
    expect(DateFormatter.toTimeDisplay('18:05'), '6:05 PM'); // CLDR puts a narrow space before AM/PM
  });

  test('API dates stay ISO and zero dates stay empty', () {
    expect(DateFormatter.toApiFormat(DateTime(2026, 1, 5)), '2026-01-05');
    expect(DateFormatter.toDisplay(DateTime(1)), '-');
  });
}
