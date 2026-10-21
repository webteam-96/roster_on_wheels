// Guards the oversight district matrix (web `district-summary-matrix`).
//
// The matrix is positional: `row.cells[categoryId][i]` and `category.totals[i]`
// must line up with `category.metrics[i]`, and each metric contributes four
// columns. Two things bite here and are pinned below: the `cells` object keys
// arrive as JSON STRINGS (a district id typed as int would silently find
// nothing), and a district that hasn't filled a metric sends a SHORT list
// rather than padding with nulls.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rotary_flutter_app/data/models/goal_setting_models.dart';
import 'package:rotary_flutter_app/presentation/screens/goal_setting/widgets/goal_district_matrix_table.dart';

GoalDistrictSummaryMatrix _matrix() => GoalDistrictSummaryMatrix.fromJson({
      'zoneId': 3,
      'zoneName': 'Zone 4',
      'yearId': 9,
      'yearLabel': '2026-27',
      'categories': [
        {
          'categoryId': 1,
          'name': 'Membership',
          'metrics': [
            {
              'groupName': 'New Clubs',
              'baselineLabel': 'Total No of Clubs as on July 1st',
            },
            {
              'groupName': 'Total Members',
              'baselineLabel': 'Total Members as on July 1st',
            },
          ],
          'totals': [
            {'asOnJul1': '120', 'target': '18', 'achieved': '9', 'pct': '50%'},
            {'asOnJul1': '4300', 'target': '500', 'achieved': '260', 'pct': '52%'},
          ],
        },
        {
          'categoryId': 2,
          'name': 'TRF',
          'metrics': [
            // hasBaseline FALSE → 3 columns, no July-1 cell (giving restarts at 0).
            {
              'groupName': 'Annual Fund',
              'baselineLabel': 'AF as on July 1st',
              'hasBaseline': false,
            },
          ],
          'totals': [
            {'asOnJul1': '1000', 'target': '2000', 'achieved': '750', 'pct': '38%'},
          ],
        },
        {
          'categoryId': 3,
          'name': 'RAG',
          'metrics': [
            // Two RAG bands of the SAME group → tier-2 heading collapses to one.
            {'groupName': 'RAG Analysis', 'baselineLabel': 'Red', 'ragBand': 'Red'},
            {'groupName': 'RAG Analysis', 'baselineLabel': 'Amber', 'ragBand': 'Amber'},
            // Single value with no RAG colour.
            {
              'groupName': 'Summary',
              'baselineLabel': 'Net Growth',
              'singleValue': true,
            },
          ],
          'totals': [
            {'value': '7'},
            {'value': '4'},
            {'value': '12'},
          ],
        },
      ],
      'districts': [
        {
          'districtId': 5656,
          'districtNumber': '3141',
          // Keys are STRINGS on the wire.
          'cells': {
            '1': [
              {'asOnJul1': '60', 'target': '9', 'achieved': '5', 'pct': '56%'},
              {'asOnJul1': '2100', 'target': '250', 'achieved': '130', 'pct': '52%'},
            ],
            '2': [
              {'asOnJul1': '500', 'target': '1000', 'achieved': '400', 'pct': '40%'},
            ],
            '3': [
              {'value': '31'},
              {'value': '22'},
              {'value': '53'},
            ],
          },
        },
        {
          'districtId': 5657,
          'districtNumber': '3142',
          // Only the FIRST Membership metric filled in, and no TRF at all.
          'cells': {
            '1': [
              {'asOnJul1': '60', 'target': '9', 'achieved': '4', 'pct': '44%'},
            ],
          },
        },
      ],
    });

void main() {
  test('parses categories, metrics and totals in order', () {
    final m = _matrix();
    expect(m.zoneName, 'Zone 4');
    expect(m.categories.map((c) => c.name), ['Membership', 'TRF', 'RAG']);
    expect(m.categories.first.metrics.map((x) => x.groupName),
        ['New Clubs', 'Total Members']);
    // The baseline column label is the form's own wording, rendered verbatim.
    expect(m.categories.first.metrics.first.baselineLabel,
        'Total No of Clubs as on July 1st');
    expect(m.categories.first.totals.length, 2);
    expect(m.categories.first.totals[1].achieved, '260');
  });

  test('cells keyed by a STRING categoryId are reachable by int', () {
    final d = _matrix().districts.first;
    expect(d.cell(1, 0)?.target, '9');
    expect(d.cell(1, 1)?.pct, '52%');
    expect(d.cell(2, 0)?.achieved, '400');
  });

  test('a metric the district never filled in comes back null, not zero', () {
    final d = _matrix().districts[1];
    expect(d.cell(1, 0)?.achieved, '4'); // present
    expect(d.cell(1, 1), isNull); // short list — no second Membership metric
    expect(d.cell(2, 0), isNull); // category absent entirely
  });

  testWidgets('renders a card per district plus a TOTAL card', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: GoalDistrictMatrixTable(matrix: _matrix()),
        ),
      ),
    ));
    await tester.pumpAndSettle();

    // Mobile layout: one card per district (labelled "D <number>") + a TOTAL card.
    expect(find.text('D 3141'), findsOneWidget);
    expect(find.text('D 3142'), findsOneWidget);
    expect(find.text('TOTAL'), findsOneWidget);
    // Membership is the default category; its metric groups render inside each
    // card (so the group heading appears more than once — 2 districts + TOTAL).
    expect(find.text('New Clubs'), findsWidgets);
    expect(find.text('Total Members'), findsWidgets);
  });

  testWidgets('filtering to one district drops the TOTAL row', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: GoalDistrictMatrixTable(matrix: _matrix(), districtFilterId: 5656),
        ),
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.text('D 3141'), findsOneWidget);
    expect(find.text('D 3142'), findsNothing);
    expect(find.text('TOTAL'), findsNothing);
  });

  group('column shapes — a metric is no longer always 4 columns', () {
    test('1 / 3 / 4 columns per metric', () {
      final cats = _matrix().categories;
      final membership = cats.firstWhere((c) => c.name == 'Membership');
      final trf = cats.firstWhere((c) => c.name == 'TRF');
      final rag = cats.firstWhere((c) => c.name == 'RAG');

      expect(membership.metrics.first.columnCount, 4); // normal
      expect(trf.metrics.first.columnCount, 3);        // no July-1 baseline
      expect(rag.metrics[0].columnCount, 1);           // RAG band
      expect(rag.metrics[2].columnCount, 1);           // singleValue
    });

    test('hasBaseline defaults to TRUE when the server omits it', () {
      // An older API that predates the field must keep the 4-column layout,
      // not silently lose a column. Mirrors web's `hasBaseline !== false`.
      final m = GoalSummaryMetric.fromJson({
        'groupName': 'New Clubs',
        'baselineLabel': 'Clubs as on July 1st',
      });
      expect(m.hasBaseline, isTrue);
      expect(m.columnCount, 4);
    });

    test('a RAG band is single-value even without the singleValue flag', () {
      final m = GoalSummaryMetric.fromJson(
          {'groupName': 'RAG Analysis', 'baselineLabel': 'Red', 'ragBand': 'Red'});
      expect(m.isSingle, isTrue);
      expect(m.columnCount, 1);
    });

    test('a single-value figure lives in `value`, not target/achieved', () {
      final cell = _matrix().districts.first.cell(3, 0);
      expect(cell?.value, '31');
      // Reading the usual four is exactly the bug this guards: it rendered four
      // dashes and dropped the number.
      expect(cell?.target, isNull);
      expect(cell?.achieved, isNull);
    });
  });

  testWidgets('defaults to Membership, not All', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(child: GoalDistrictMatrixTable(matrix: _matrix())),
      ),
    ));
    await tester.pumpAndSettle();

    // Membership is the default: its metric groups render, TRF's do not. The
    // other categories appear only as chips.
    expect(find.text('New Clubs'), findsWidgets); // Membership shown
    expect(find.text('Annual Fund'), findsNothing); // TRF not shown
    expect(find.text('TRF'), findsOneWidget); // chip only
    expect(find.text('RAG'), findsOneWidget); // chip only
  });

  testWidgets('RAG columns show their count and a legend', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(child: GoalDistrictMatrixTable(matrix: _matrix())),
      ),
    ));
    await tester.pumpAndSettle();

    // Switch to the RAG category the way a user would.
    await tester.tap(find.text('RAG'));
    await tester.pumpAndSettle();

    expect(find.text('31'), findsOneWidget);  // Red band count for D3141
    expect(find.text('53'), findsOneWidget);  // Net Growth for D3141
    expect(find.text('RAG: clubs by active members:'), findsOneWidget);
    // The two RAG bands collapse under ONE group heading — repeated per card
    // (each district + TOTAL), so more than one instance renders.
    expect(find.text('RAG Analysis'), findsWidgets);
    expect(find.text('Summary'), findsWidgets);
  });
}
