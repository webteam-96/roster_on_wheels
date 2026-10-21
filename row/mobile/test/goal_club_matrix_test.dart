// Guards the "View clubs" matrices behind the oversight popup.
//
// Both payloads are dictionary-shaped, and BOTH arrive with STRING keys —
// values are keyed by fieldKey, and the month-wise values are keyed by fieldKey
// AND then by month number. Indexing either with the wrong type silently yields
// an empty table, so the parsing is pinned here.
import 'package:flutter_test/flutter_test.dart';
import 'package:rotary_flutter_app/data/models/goal_setting_models.dart';

GoalClubMatrix _goals() => GoalClubMatrix.fromJson({
      'categoryId': 1,
      'categoryName': 'Membership',
      'yearId': 9,
      'yearLabel': '2026-27',
      'columns': [
        // The RAG columns are shown as their own column, not as data.
        {'fieldKey': 'rag_red', 'fieldLabel': 'Red', 'groupName': 'RAG Analysis'},
        {
          'fieldKey': 'new_members',
          'fieldLabel': 'New Members',
          'groupName': 'Total Members',
          'unit': 'nos',
        },
        {
          'fieldKey': 'women',
          'fieldLabel': 'Women Members',
          'groupName': 'Total Members',
        },
      ],
      'clubs': [
        {
          'clubId': 11,
          'clubName': 'Rotary Club of Alpha',
          'rag': 'Green',
          'memberCount': 44,
          'values': {'new_members': '12', 'women': '5', 'rag_red': '0'},
        },
        {
          'clubId': 12,
          'clubName': 'Rotary Club of Beta',
          // Fewer than 10 members ⇒ no band at all.
          'rag': 'None',
          'memberCount': 7,
          'values': {'new_members': null},
        },
      ],
    });

GoalClubMonthlyMatrix _monthly() => GoalClubMonthlyMatrix.fromJson({
      'categoryId': 1,
      'categoryName': 'Membership',
      'yearLabel': '2026-27',
      'months': [
        {'month': 7, 'label': 'Jul', 'calendarYear': 2026, 'isAvailable': true},
        {'month': 8, 'label': 'Aug', 'calendarYear': 2026, 'isAvailable': true},
        // A future month of the current year — can't be collected yet.
        {'month': 9, 'label': 'Sep', 'calendarYear': 2026, 'isAvailable': false},
      ],
      'fields': [
        {'fieldKey': 'collected', 'fieldLabel': 'New members collected', 'unit': 'nos'},
      ],
      'clubs': [
        {
          'clubId': 11,
          'clubName': 'Rotary Club of Alpha',
          'values': {
            'collected': {'7': '3', '8': '4'},
          },
          'totals': {'collected': '7'},
        },
      ],
    });

void main() {
  group('club goals matrix', () {
    test('RAG columns are dropped from the data columns', () {
      final m = _goals();
      expect(m.columns.length, 3);
      expect(m.dataColumns.map((c) => c.fieldKey), ['new_members', 'women']);
    });

    test('values are reachable by their string fieldKey', () {
      final alpha = _goals().clubs.first;
      expect(alpha.values['new_members'], '12');
      expect(alpha.rag, 'Green');
      expect(alpha.memberCount, 44);
    });

    test('a null value stays null so it can render as a dash, not zero', () {
      final beta = _goals().clubs[1];
      expect(beta.values['new_members'], isNull);
      expect(beta.values.containsKey('new_members'), isTrue);
      expect(beta.rag, 'None');
    });

    test('the unit is appended to the heading only when there is one', () {
      final cols = _goals().dataColumns;
      expect(cols.first.headingWithUnit, 'New Members (nos)');
      expect(cols.last.headingWithUnit, 'Women Members');
    });

    test('membership is detected from the category name', () {
      expect(_goals().isMembership, isTrue);
      expect(
        GoalClubMatrix.fromJson({'categoryName': 'TRF'}).isMembership,
        isFalse,
      );
    });
  });

  group('club month-wise matrix', () {
    test('month keys arrive as STRINGS and are reachable by int', () {
      final club = _monthly().clubs.single;
      expect(club.valueFor('collected', 7), '3');
      expect(club.valueFor('collected', 8), '4');
    });

    test('a month with nothing collected is null, not zero', () {
      final club = _monthly().clubs.single;
      expect(club.valueFor('collected', 9), isNull);
      expect(club.valueFor('nonexistent', 7), isNull);
    });

    test('the year total is kept separately from the months', () {
      expect(_monthly().clubs.single.totals['collected'], '7');
    });

    test('a future month of the current year is flagged unavailable', () {
      final months = _monthly().months;
      expect(months.map((m) => m.label), ['Jul', 'Aug', 'Sep']);
      expect(months.last.isAvailable, isFalse);
      expect(months.first.isAvailable, isTrue);
    });
  });
}
