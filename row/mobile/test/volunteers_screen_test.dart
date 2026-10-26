import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:rotary_flutter_app/core/services/volunteer_api.dart';
import 'package:rotary_flutter_app/presentation/screens/volunteers/volunteers_screen.dart';

class _FakeVolunteers implements VolunteerApi {
  final signedUp = <int>{};

  @override
  Future<List<Map<String, dynamic>>> sheets() async => [
        {
          'id': 1,
          'clubName': 'Club A',
          'title': 'Food drive',
          'slots': [
            {'id': 10, 'task': 'Packing', 'startsAt': '2026-11-01T09:00:00Z', 'capacity': 2, 'filled': signedUp.length, 'signedUp': signedUp.contains(10)},
            {'id': 11, 'task': 'Driving', 'startsAt': '2026-11-01T10:00:00Z', 'capacity': 1, 'filled': 1, 'signedUp': false},
          ],
        },
      ];
  @override
  Future<void> signUp(int slotId) async => signedUp.add(slotId);
  @override
  Future<void> cancel(int slotId) async => signedUp.remove(slotId);
  @override
  Future<List<Map<String, dynamic>>> duties() async => const [];
  @override
  Future<String?> inviteLink(int clubId) async => null;
}

void main() {
  testWidgets('a member signs up for an open slot, then cancels; a full slot cannot be taken', (tester) async {
    final api = _FakeVolunteers();
    await tester.pumpWidget(MaterialApp.router(
        routerConfig: GoRouter(routes: [GoRoute(path: '/', builder: (_, __) => VolunteersScreen(api: api))])));
    await tester.pumpAndSettle();

    expect(find.text('Food drive'), findsOneWidget);
    final full = tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Full'));
    expect(full.onPressed, isNull);

    await tester.tap(find.widgetWithText(FilledButton, 'Sign up'));
    await tester.pumpAndSettle();
    expect(api.signedUp, {10});
    expect(find.widgetWithText(OutlinedButton, 'Cancel'), findsOneWidget);

    await tester.tap(find.widgetWithText(OutlinedButton, 'Cancel'));
    await tester.pumpAndSettle();
    expect(api.signedUp, isEmpty);
  });
}
