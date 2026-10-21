// Guards the month-wise oversight figures.
//
// Every month column is CUMULATIVE — the July 1st baseline plus every addition
// up to that month — not the raw amount collected in it. Getting that wrong
// silently understates every district. The % formula also differs by metric: one
// with a baseline measures GROWTH against the target, one without is a plain
// ratio.
import 'package:flutter_test/flutter_test.dart';
import 'package:rotary_flutter_app/data/models/goal_setting_models.dart';

List<GoalMonthPeriod> _months() => [
      const GoalMonthPeriod(month: 7, label: 'Jul'),
      const GoalMonthPeriod(month: 8, label: 'Aug'),
      // A future month of the current year — nothing can be collected yet.
      const GoalMonthPeriod(month: 9, label: 'Sep', isAvailable: false),
    ];

GoalMonthlyField _field(Map<String, dynamic> over) =>
    GoalMonthlyField.fromJson({
      'fieldId': 1,
      'fieldLabel': 'Total Members',
      'monthly': {'7': 5, '8': 3},
      ...over,
    });

void main() {
  group('cumulative months', () {
    test('runs on from the baseline, month by month', () {
      final f = _field({'baseline': 100});
      expect(f.cumulative(_months()), [105.0, 108.0, null]);
      expect(f.achieved(_months()), 108.0);
    });

    test('starts at zero when the metric has no baseline', () {
      final f = _field({'baseline': null});
      expect(f.cumulative(_months()), [5.0, 8.0, null]);
    });

    test('an unavailable month is null, not a repeat of the last figure', () {
      final cells = _field({'baseline': 100}).cumulative(_months());
      expect(cells.last, isNull);
    });

    test('a month with nothing collected carries the figure forward', () {
      final f = _field({'baseline': 10, 'monthly': {'7': 2}});
      // Aug collected nothing, so it stays at 12 rather than dropping out.
      expect(f.cumulative(_months()), [12.0, 12.0, null]);
      expect(f.achieved(_months()), 12.0);
    });

    test('no available months at all ⇒ no achieved figure', () {
      final f = _field({'baseline': 10});
      final future = [const GoalMonthPeriod(month: 7, label: 'Jul', isAvailable: false)];
      expect(f.achieved(future), isNull);
    });

    test('month keys arrive as STRINGS and still add up', () {
      expect(_field({'baseline': 0}).monthly[7], 5.0);
      expect(_field({'baseline': 0}).monthly[8], 3.0);
    });
  });

  group('% achievement', () {
    test('a metric WITH a baseline measures growth against the target', () {
      // baseline 100, target 200, achieved 150 → 50 of the 100 needed.
      final f = _field({'baseline': 100, 'annualTarget': 200});
      expect(f.pctAchievedText(150), '50%');
    });

    test('a metric WITHOUT a baseline is a plain ratio', () {
      final f = _field({'baseline': null, 'annualTarget': 200});
      expect(f.pctAchievedText(150), '75%');
    });

    test('a zero denominator has no meaningful percentage', () {
      // Target equals the baseline — nothing to grow into.
      final f = _field({'baseline': 100, 'annualTarget': 100});
      expect(f.pctAchievedText(150), '–');
    });

    test('no target or nothing achieved ⇒ a dash', () {
      expect(_field({'annualTarget': null}).pctAchievedText(5), '–');
      expect(_field({'annualTarget': 10}).pctAchievedText(null), '–');
    });

    test('is rounded to at most two places', () {
      final f = _field({'baseline': null, 'annualTarget': 3});
      expect(f.pctAchievedText(1), '33.33%');
    });
  });

  group('annual-only fields', () {
    test('monthlyTracked defaults to TRUE when the server omits it', () {
      expect(_field({}).monthlyTracked, isTrue);
    });

    test('an explicit false marks it annual-only', () {
      final f = _field({'monthlyTracked': false, 'displayText': 'Yes'});
      expect(f.monthlyTracked, isFalse);
      expect(f.displayText, 'Yes');
    });
  });

  group('number formatting', () {
    test('whole numbers stay plain and decimals lose trailing zeros', () {
      expect(fmtGoalNumber(12), '12');
      expect(fmtGoalNumber(12.0), '12');
      expect(fmtGoalNumber(12.5), '12.5');
      expect(fmtGoalNumber(12.50), '12.5');
      expect(fmtGoalNumber(12.345), '12.35');
      expect(fmtGoalNumber(1200), '1200'); // trailing zeros are NOT stripped
    });

    test('nothing reads as a dash', () {
      expect(fmtGoalNumber(null), '–');
    });
  });
}
