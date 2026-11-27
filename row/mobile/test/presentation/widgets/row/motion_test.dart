import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rotary_flutter_app/core/theme/app_theme.dart';
import 'package:rotary_flutter_app/core/theme/row_page_transitions.dart';
import 'package:rotary_flutter_app/presentation/widgets/common/custom_button.dart';
import 'package:rotary_flutter_app/presentation/widgets/common/loading_widget.dart';
import 'package:rotary_flutter_app/presentation/widgets/common/module_status_badge.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/bento.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/motion.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/roster_wheel.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/skeleton_list.dart';

Widget _host(Widget child, {bool still = false}) => MaterialApp(
      theme: AppTheme.lightTheme,
      home: MediaQuery(
        data: MediaQueryData(size: const Size(800, 600), disableAnimations: still),
        child: Scaffold(body: child),
      ),
    );

void main() {
  group('bento', () {
    test('every group size packs flush: no holes, no overlaps', () {
      const columns = 4;
      for (var n = 1; n <= 24; n++) {
        final sizes = RowBento.spans(n);
        expect(sizes.length, n);
        final (spots, rows) = RowBento.pack(sizes, columns);
        final cells = <(int, int)>{};
        for (var i = 0; i < n; i++) {
          for (var x = 0; x < sizes[i].$1; x++) {
            for (var y = 0; y < sizes[i].$2; y++) {
              expect(cells.add((spots[i].$1 + x, spots[i].$2 + y)), isTrue, reason: 'overlap at n=$n tile $i');
            }
          }
        }
        expect(cells.length, columns * rows, reason: 'hole at n=$n');
      }
    });

    testWidgets('long labels fit their tiles at a large text size', (tester) async {
      final spans = RowBento.spans(5);
      await tester.pumpWidget(MaterialApp(
        home: MediaQuery(
          data: const MediaQueryData(size: Size(360, 800), textScaler: TextScaler.linear(1.6)),
          child: Scaffold(
            body: SingleChildScrollView(
              child: SizedBox(
                width: 328,
                child: RowBento(items: [
                  for (final (i, s) in spans.indexed)
                    BentoItem(
                      s.$1,
                      s.$2,
                      RowBentoTile(
                        label: 'Öffentlichkeitsinitiative Bekanntmachungen',
                        icon: const Icon(Icons.star),
                        tone: RowBentoTile.toneFor(i, s),
                        badge: const ModuleBadgeChip(badge: ModuleBadge('1,240 left', ModuleBadge.green)),
                      ),
                    ),
                ]),
              ),
            ),
          ),
        ),
      ));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });
  });

  group('count up keeps the format of the final number', () {
    for (final (value, half) in [
      ('100', '50'),
      (r'$6.8K', r'$3.4K'),
      ('12,40,000', '6,20,000'),
      ('2,400,000', '1,200,000'),
    ]) {
      test(value, () {
        expect(RowCountUp.at(value, .5), half);
        expect(RowCountUp.at(value, 1), value);
      });
    }

    test('text that is not one number is left alone', () {
      for (final value in ['3 / 10', '12 Jun 2026', 'No data', '', '–', '12 left']) {
        expect(RowCountUp.at(value, .5), isNull, reason: value);
      }
    });
  });

  testWidgets('reveal arrives, and is already in place with reduced motion', (tester) async {
    double opacity() => tester
        .widget<FadeTransition>(find.ancestor(of: find.text('row'), matching: find.byType(FadeTransition)).first)
        .opacity
        .value;
    await tester.pumpWidget(_host(const RowReveal(child: Text('row'))));
    expect(opacity(), 0);
    await tester.pumpAndSettle();
    expect(opacity(), 1);

    await tester.pumpWidget(_host(const RowReveal(key: ValueKey('still'), child: Text('row')), still: true));
    expect(opacity(), 1);
  });

  testWidgets('rows met while scrolling do not animate', (tester) async {
    await tester.pumpWidget(_host(RowListView.builder(
      itemCount: 50,
      itemExtent: 200,
      itemBuilder: (_, i) => Text('row $i'),
    )));
    await tester.pumpAndSettle();
    await tester.drag(find.byType(Scrollable), const Offset(0, -1200));
    await tester.pump();
    final fade = tester
        .widget<FadeTransition>(find.ancestor(of: find.text('row 7'), matching: find.byType(FadeTransition)).first);
    expect(fade.opacity.value, 1);
  });

  testWidgets('press feedback leaves the tap to the child', (tester) async {
    var taps = 0;
    await tester.pumpWidget(_host(Center(
      child: RowPressable(child: GestureDetector(onTap: () => taps++, child: const Text('open'))),
    )));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    expect(taps, 1);
  });

  test('a page grows out of a card once, and only just after the press', () {
    RowMorphOrigin.remember(const Rect.fromLTWH(1, 2, 3, 4));
    expect(RowMorphOrigin.take(), const Rect.fromLTWH(1, 2, 3, 4));
    expect(RowMorphOrigin.take(), isNull);
  });

  testWidgets('a page opened by a morph keeps its state when the transition ends', (tester) async {
    _PageState.created = 0;
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.lightTheme,
      home: Builder(
        builder: (context) => Center(
          child: RowPressable(
            morph: true,
            child: TextButton(
              onPressed: () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => const _Page())),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('open'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));
    await tester.pumpAndSettle();
    expect(find.text('page'), findsOneWidget);
    expect(_PageState.created, 1);
  });

  testWidgets('a loading button keeps its size and cannot be pressed', (tester) async {
    var taps = 0;
    Widget button(bool loading) =>
        _host(Center(child: CustomButton(label: 'Save', isLoading: loading, onPressed: () => taps++)));
    await tester.pumpWidget(button(false));
    final size = tester.getSize(find.byType(CustomButton));
    await tester.pumpWidget(button(true));
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.byType(RowLoader), findsOneWidget);
    expect(tester.getSize(find.byType(CustomButton)), size);
    await tester.tap(find.byType(CustomButton), warnIfMissed: false);
    expect(taps, 0);
  });

  testWidgets('loading shows skeleton rows on a page and the dots in a small box', (tester) async {
    await tester.pumpWidget(_host(const LoadingWidget()));
    expect(find.byType(RowSkeletonList), findsOneWidget);
    await tester.pumpWidget(_host(const SizedBox(height: 100, child: LoadingWidget())));
    expect(find.byType(RowLoader), findsOneWidget);
  });

  testWidgets('pull to refresh runs the refresh and puts the dots away', (tester) async {
    var refreshed = 0;
    await tester.pumpWidget(_host(RowRefresh(
      onRefresh: () async => refreshed++,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: const [SizedBox(height: 100, child: Text('top'))],
      ),
    )));
    await tester.fling(find.text('top'), const Offset(0, 400), 1000);
    await tester.pumpAndSettle();
    expect(refreshed, 1);
    expect(find.byType(RowDots), findsNothing);
  });
}

class _Page extends StatefulWidget {
  const _Page();

  @override
  State<_Page> createState() => _PageState();
}

class _PageState extends State<_Page> {
  static int created = 0;

  @override
  void initState() {
    super.initState();
    created++;
  }

  @override
  Widget build(BuildContext context) => const Scaffold(body: Text('page'));
}
