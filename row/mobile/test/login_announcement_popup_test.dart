// Guards the ◀ ▶ multi-announcement popup: navigation must actually swap the
// body (a one-slot HTML cache used to pin the first one on screen), the counter
// must track, and the arrows must stop at both ends rather than wrapping.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rotary_flutter_app/data/models/login_announcement_model.dart';
import 'package:rotary_flutter_app/presentation/widgets/login_announcement_popup.dart';

ActiveLoginAnnouncement _three() => ActiveLoginAnnouncement.fromJson({
      'show': true,
      'items': [
        {'id': 1, 'content': '<p>Alpha notice</p>', 'roles': ['ClubAdmin']},
        {'id': 2, 'content': '<p>Bravo notice</p>', 'roles': ['ALL']},
        {'id': 3, 'content': '<p>Charlie notice</p>', 'roles': []},
      ],
    });

ActiveLoginAnnouncement _one() => ActiveLoginAnnouncement.fromJson({
      'show': true,
      'items': [
        {'id': 5, 'content': '<p>Solo notice</p>', 'roles': ['RIDirector']},
      ],
    });

Future<void> _pump(WidgetTester tester, ActiveLoginAnnouncement a) async {
  await tester.pumpWidget(MaterialApp(
    home: Scaffold(body: LoginAnnouncementPopup(announcement: a)),
  ));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('several → counter, role line, and working arrows', (tester) async {
    await _pump(tester, _three());

    expect(find.text('For: Club Admin · 1 of 3'), findsOneWidget);
    expect(find.textContaining('Alpha notice'), findsOneWidget);

    await tester.tap(find.byIcon(Icons.chevron_right_rounded));
    await tester.pumpAndSettle();

    // The body really changed — this is what the per-item cache fixes.
    expect(find.textContaining('Bravo notice'), findsOneWidget);
    expect(find.textContaining('Alpha notice'), findsNothing);
    // "ALL" is not worth naming, so only the counter remains.
    expect(find.text('2 of 3'), findsOneWidget);

    await tester.tap(find.byIcon(Icons.chevron_left_rounded));
    await tester.pumpAndSettle();
    expect(find.textContaining('Alpha notice'), findsOneWidget);
  });

  testWidgets('arrows stop at both ends instead of wrapping', (tester) async {
    await _pump(tester, _three());

    // Already at the first — Back does nothing.
    await tester.tap(find.byIcon(Icons.chevron_left_rounded));
    await tester.pumpAndSettle();
    expect(find.text('For: Club Admin · 1 of 3'), findsOneWidget);

    for (var i = 0; i < 4; i++) {
      await tester.tap(find.byIcon(Icons.chevron_right_rounded));
      await tester.pumpAndSettle();
    }
    expect(find.text('3 of 3'), findsOneWidget);
    expect(find.textContaining('Charlie notice'), findsOneWidget);
  });

  testWidgets('a single announcement shows no arrows and no counter', (tester) async {
    await _pump(tester, _one());

    expect(find.byIcon(Icons.chevron_left_rounded), findsNothing);
    expect(find.byIcon(Icons.chevron_right_rounded), findsNothing);
    expect(find.text('For: RI Director'), findsOneWidget);
    expect(find.textContaining('of'), findsNothing);
  });
}
