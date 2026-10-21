// Guards the 1-July greetings pause notice. This is the ONLY thing that tells a
// mobile-only admin why birthday/anniversary messages stopped going out, so the
// paused state must never render as the quiet explainer, and the year labels
// must degrade to sensible prose when the server sends nothing.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rotary_flutter_app/presentation/widgets/common/greeting_pause_notice.dart';

Future<void> _pump(WidgetTester tester, Widget child) async {
  await tester.pumpWidget(MaterialApp(home: Scaffold(body: child)));
  await tester.pumpAndSettle();
}

/// Matches across the RichText/Text spans regardless of wrapping.
bool _has(WidgetTester tester, String needle) => tester
    .widgetList<Text>(find.byType(Text))
    .any((t) => (t.data ?? '').contains(needle));

void main() {
  testWidgets('not paused → the standing 1 July explainer, no alarm', (tester) async {
    await _pump(tester, const GreetingPauseNotice(
      paused: false, reviewedYear: '2026-27', currentYear: '2026-27'));

    expect(_has(tester, 'Every 1 July'), isTrue);
    expect(_has(tester, 'paused for'), isFalse);
    expect(find.byIcon(Icons.warning_amber_rounded), findsNothing);
  });

  testWidgets('paused → names the year and says how to resume', (tester) async {
    await _pump(tester, const GreetingPauseNotice(
      paused: true, reviewedYear: '2025-26', currentYear: '2026-27'));

    expect(_has(tester, 'paused for 2026-27'), isTrue);
    expect(_has(tester, 'last saved for 2025-26'), isTrue);
    expect(_has(tester, 'Save Settings'), isTrue);
    expect(find.byIcon(Icons.warning_amber_rounded), findsOneWidget);
  });

  testWidgets('paused with no reviewed year → prose, never a blank or "null"', (tester) async {
    await _pump(tester, const GreetingPauseNotice(
      paused: true, reviewedYear: null, currentYear: '2026-27'));

    expect(_has(tester, 'in an earlier Rotary year'), isTrue);
    expect(_has(tester, 'null'), isFalse);
  });

  testWidgets('paused with no year labels at all → still a clean sentence', (tester) async {
    await _pump(tester, const GreetingPauseNotice(
      paused: true, reviewedYear: '', currentYear: ''));

    // No dangling "for" when the server sent no current-year label.
    expect(_has(tester, 'greetings are paused.'), isTrue);
    expect(_has(tester, 'paused for .'), isFalse);
  });
}
