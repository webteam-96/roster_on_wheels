import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rotary_flutter_app/core/theme/row_tokens.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/pill_button.dart';
import 'package:rotary_flutter_app/presentation/widgets/row/tone_card.dart';

Widget _host(Widget child) => MaterialApp(home: Scaffold(body: Center(child: child)));

void main() {
  testWidgets('PillButton shows its label and fires', (tester) async {
    var taps = 0;
    await tester.pumpWidget(_host(PillButton(label: 'Pay dues', onPressed: () => taps++)));
    expect(find.text('Pay dues'), findsOneWidget);
    await tester.tap(find.text('Pay dues'));
    expect(taps, 1);
  });

  testWidgets('PillButton with no handler is disabled', (tester) async {
    await tester.pumpWidget(_host(const PillButton(label: 'Pay dues', onPressed: null)));
    final button = tester.widget<ButtonStyleButton>(find.byWidgetPredicate((w) => w is ButtonStyleButton));
    expect(button.enabled, isFalse);
  });

  testWidgets('arrow chip is decorative (hidden from semantics)', (tester) async {
    await tester.pumpWidget(_host(PillButton(label: 'Continue', onPressed: () {}, arrow: true)));
    expect(find.byKey(PillButton.arrowKey), findsOneWidget);
    expect(find.ancestor(of: find.byKey(PillButton.arrowKey), matching: find.byType(ExcludeSemantics)), findsWidgets);
  });

  testWidgets('ToneCard paints the tone and its readable ink', (tester) async {
    await tester.pumpWidget(_host(const ToneCard(tone: RowTone.marigold, child: Text('42 members'))));
    final box = tester.widget<DecoratedBox>(find.descendant(of: find.byType(ToneCard), matching: find.byType(DecoratedBox)).first);
    expect((box.decoration as BoxDecoration).color, RowTone.marigold.fill);
    expect((box.decoration as BoxDecoration).boxShadow, isNull);
    final text = tester.widget<DefaultTextStyle>(
        find.ancestor(of: find.text('42 members'), matching: find.byType(DefaultTextStyle)).first);
    expect(text.style.color, RowTone.marigold.onFill);
  });
}
