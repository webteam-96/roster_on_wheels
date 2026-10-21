// Guards the cross-club PPH participation history.
//
// Two things matter medically and are easy to get wrong: the path is derived
// from the CAMP base by dropping the camp id (the history hangs off the camps
// collection, not one camp), and "latest reading" must be the newest across
// EVERY club — not the newest inside the first group the server happened to
// return.
import 'package:flutter_test/flutter_test.dart';
import 'package:rotary_flutter_app/presentation/screens/districts/modules/pph_attendee_history.dart';

PphMobileHistory _history() => PphMobileHistory.fromJson({
      'mobile': '9876543210',
      'totalEntries': 3,
      'groupCount': 2,
      'groups': [
        {
          'groupName': 'Rotary Club of Alpha',
          'isDistrict': false,
          'entryCount': 2,
          'entries': [
            {
              'campTitle': 'Alpha Camp 2024',
              'campDate': '2024-11-02T00:00:00',
              'yearLabel': '2024-25',
              'readingCount': 1,
              'readings': [
                {
                  'readingDate': '2024-11-02T00:00:00',
                  'bpSystolic': 130,
                  'bpDiastolic': 85,
                  'bpStatus': 'New High Blood Pressure Detected',
                  'bloodSugarType': 'FBS',
                  'bloodSugarValue': 104.0,
                  'diabetesStatus': 'None',
                  'bmi': 26.5,
                },
              ],
            },
            {
              'campTitle': 'Alpha Camp 2023',
              'campDate': '2023-10-01T00:00:00',
              'yearLabel': '2023-24',
              'readingCount': 0,
              'readings': [],
            },
          ],
        },
        {
          // NEWEST reading lives here, in the SECOND group.
          'groupName': 'District 3141',
          'isDistrict': true,
          'entryCount': 1,
          'entries': [
            {
              'campTitle': 'District Mega Camp',
              'campDate': '2026-08-14T00:00:00',
              'yearLabel': '2026-27',
              'readingCount': 1,
              'readings': [
                {
                  'readingDate': '2026-08-14T00:00:00',
                  'bpSystolic': 118,
                  'bpDiastolic': 76,
                  'bloodSugarValue': 92.0,
                  'bmi': 24.0,
                },
              ],
            },
          ],
        },
      ],
    });

void main() {
  group('history path', () {
    test('drops the camp id — history hangs off the camps collection', () {
      expect(pphHistoryPathFrom('/api/clubs/7/pph-camps/42'),
          '/api/clubs/7/pph-camps/attendee-history');
      expect(pphHistoryPathFrom('/api/district-modules/9/pph-camps/13'),
          '/api/district-modules/9/pph-camps/attendee-history');
    });

    test('a base with no slash yields null rather than a nonsense URL', () {
      expect(pphHistoryPathFrom('nonsense'), isNull);
      expect(pphHistoryPathFrom(''), isNull);
    });
  });

  test('parses groups, entries and readings', () {
    final h = _history();
    expect(h.isEmpty, isFalse);
    expect(h.totalEntries, 3);
    expect(h.groups.length, 2);
    expect(h.groups.first.entries.length, 2);
    expect(h.groups.last.isDistrict, isTrue);
    expect(h.groups.first.entries.first.readings.single.bpSystolic, 130);
  });

  test('latest reading is the newest across EVERY club, not the first group', () {
    final last = _history().latestReading;
    expect(last, isNotNull);
    expect(last!.groupName, 'District 3141');
    expect(last.campTitle, 'District Mega Camp');
    expect(last.reading.readingDate!.year, 2026);
  });

  test('an empty history reads as empty', () {
    final h = PphMobileHistory.fromJson(
        {'mobile': '9', 'totalEntries': 0, 'groupCount': 0, 'groups': []});
    expect(h.isEmpty, isTrue);
    expect(h.latestReading, isNull);
  });

  group('reading text', () {
    test('formats BP, sugar and BMI, trimming trailing zeros', () {
      final r = _history().groups.last.entries.single.readings.single;
      expect(r.bpText, '118/76');
      expect(r.sugarText, '92');
      expect(r.bmiText, '24');
    });

    test('missing values read as a dash, never a blank', () {
      final r = PphHistoryReading.fromJson({'readingDate': '2026-01-01'});
      expect(r.bpText, '–');
      expect(r.sugarText, '–');
      expect(r.bmiText, '–');
    });

    test('sugar names its type when there is one', () {
      final r = _history().groups.first.entries.first.readings.single;
      expect(r.sugarText, '104 (FBS)');
    });
  });
}
