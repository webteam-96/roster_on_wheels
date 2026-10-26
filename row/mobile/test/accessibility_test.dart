import 'package:flutter/material.dart' hide Text;
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:rotary_flutter_app/core/services/chat_api.dart';
import 'package:rotary_flutter_app/core/services/volunteer_api.dart';
import 'package:rotary_flutter_app/presentation/screens/chat/chat_screens.dart';
import 'package:rotary_flutter_app/presentation/screens/settings/language_screen.dart';
import 'package:rotary_flutter_app/presentation/screens/volunteers/volunteers_screen.dart';

// Build spec 5: "App follows platform accessibility guidelines". Flutter's own checks on the new screens: tap targets
// at least 48x48 (Android) / 44x44 (iOS), every tappable element labelled, and text contrast.
class _Volunteers implements VolunteerApi {
  @override
  Future<List<Map<String, dynamic>>> sheets() async => [
        {
          'id': 1,
          'clubName': 'Club A',
          'title': 'Food drive',
          'slots': [
            {'id': 10, 'task': 'Packing', 'startsAt': '2026-11-01T09:00:00Z', 'capacity': 2, 'filled': 0, 'signedUp': false},
          ],
        },
      ];
  @override
  Future<void> signUp(int slotId) async {}
  @override
  Future<void> cancel(int slotId) async {}
  @override
  Future<List<Map<String, dynamic>>> duties() async => const [];
  @override
  Future<String?> inviteLink(int clubId) async => null;
}

class _Chat implements ChatApi {
  @override
  Future<List<Map<String, dynamic>>> messages(int conversationId, {int? after, int? before}) async => after == null
      ? [
          {'id': 1, 'senderId': 7, 'senderName': 'Ana', 'body': 'Hello', 'createdAt': '2026-10-26T09:00:00Z'}
        ]
      : const [];
  @override
  Future<Map<String, dynamic>?> send(int conversationId, String body, String clientKey) async => null;
  @override
  Future<void> markRead(int conversationId, int messageId) async {}
  @override
  Future<List<Map<String, dynamic>>> conversations() async => const [];
  @override
  Future<void> report(int messageId, String reason) async {}
  @override
  Future<int?> openDirect(int clubId, int memberId) async => null;
  @override
  Future<int?> createGroup(int clubId, String title, List<int> memberIds) async => null;
}

Future<void> _pump(WidgetTester tester, Widget screen) async {
  await tester.pumpWidget(MaterialApp.router(
      routerConfig: GoRouter(routes: [GoRoute(path: '/', builder: (_, __) => screen)])));
  await tester.pumpAndSettle();
}

Future<void> _meetsAll(WidgetTester tester) async {
  await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
  await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
  await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
  await expectLater(tester, meetsGuideline(textContrastGuideline));
}

void main() {
  testWidgets('volunteering meets the platform accessibility guidelines', (tester) async {
    final handle = tester.ensureSemantics();
    await _pump(tester, VolunteersScreen(api: _Volunteers()));
    await _meetsAll(tester);
    handle.dispose();
  });

  testWidgets('a chat meets the platform accessibility guidelines', (tester) async {
    final handle = tester.ensureSemantics();
    await _pump(tester, ChatScreen(conversationId: 1, title: 'Ana', me: 3, api: _Chat(), pollEvery: const Duration(hours: 1)));
    await _meetsAll(tester);
    await tester.pumpWidget(const SizedBox());
    handle.dispose();
  });

  testWidgets('the language picker meets the platform accessibility guidelines', (tester) async {
    final handle = tester.ensureSemantics();
    await _pump(tester, const LanguageScreen());
    await _meetsAll(tester);
    handle.dispose();
  });
}
