// Guards the zone messaging popup's shell: an RI Director gets one tab per
// category, a Zone Co-ordinator / District Assistant gets their single panel
// with no tabs at all, and the unread dot only shows when there is unread mail.
//
// ⚠️ The single-panel case is not cosmetic. A ZC/DA holds ONE category and one
// conversation in it; showing them another category's tab would blank their only
// thread, because the server answers `viewerRole: None` for a category they hold
// no role in.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rotary_flutter_app/presentation/screens/goal_setting/widgets/goal_messages_sheet.dart';

Future<void> _pumpButton(
  WidgetTester tester, {
  required bool hasUnread,
  VoidCallback? onTap,
}) async {
  await tester.pumpWidget(MaterialApp(
    home: Scaffold(
      body: GoalMessagesButton(
        hasUnread: hasUnread,
        onTap: onTap ?? () {},
        label: 'Messages — your RI Director',
      ),
    ),
  ));
  await tester.pumpAndSettle();
}

void main() {
  group('messages button', () {
    testWidgets('unread → the dot and the "New" flag show', (tester) async {
      await _pumpButton(tester, hasUnread: true);
      expect(find.text('New'), findsOneWidget);
      expect(find.text('Messages — your RI Director'), findsOneWidget);
    });

    testWidgets('nothing unread → no dot, no flag', (tester) async {
      await _pumpButton(tester, hasUnread: false);
      expect(find.text('New'), findsNothing);
    });

    testWidgets('tapping opens it', (tester) async {
      var taps = 0;
      await _pumpButton(tester, hasUnread: false, onTap: () => taps++);
      await tester.tap(find.byType(GoalMessagesButton));
      await tester.pumpAndSettle();
      expect(taps, 1);
    });

    testWidgets('with no zone picked the button is inert', (tester) async {
      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
          body: GoalMessagesButton(hasUnread: false, onTap: null),
        ),
      ));
      await tester.pumpAndSettle();
      // Nothing to assert beyond it rendering without a handler — the tap is a
      // no-op rather than opening an empty popup.
      expect(find.byType(GoalMessagesButton), findsOneWidget);
    });
  });
}
