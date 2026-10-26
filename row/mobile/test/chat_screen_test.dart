import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:rotary_flutter_app/core/services/chat_api.dart';
import 'package:rotary_flutter_app/presentation/screens/chat/chat_screens.dart';

class _FakeChat implements ChatApi {
  final server = <Map<String, dynamic>>[
    {'id': 1, 'senderId': 7, 'senderName': 'Ana', 'body': 'Hello', 'createdAt': '2026-10-26T09:00:00Z'},
  ];
  final afters = <int?>[];
  int? readUpTo;

  @override
  Future<List<Map<String, dynamic>>> messages(int conversationId, {int? after, int? before}) async {
    afters.add(after);
    return server.where((m) => after == null || (m['id'] as int) > after).toList();
  }
  @override
  Future<Map<String, dynamic>?> send(int conversationId, String body, String clientKey) async {
    final m = {'id': server.length + 1, 'senderId': 3, 'body': body, 'createdAt': '2026-10-26T09:01:00Z'};
    server.add(m);
    return m;
  }
  @override
  Future<void> markRead(int conversationId, int messageId) async => readUpTo = messageId;
  @override
  Future<List<Map<String, dynamic>>> conversations() async => const [];
  @override
  Future<void> report(int messageId, String reason) async {}
  @override
  Future<int?> openDirect(int clubId, int memberId) async => null;
  @override
  Future<int?> createGroup(int clubId, String title, List<int> memberIds) async => null;
}

void main() {
  testWidgets('loads history, sends, and polls only for newer messages', (tester) async {
    final api = _FakeChat();
    await tester.pumpWidget(MaterialApp.router(
        routerConfig: GoRouter(routes: [
      GoRoute(
          path: '/',
          builder: (_, __) =>
              ChatScreen(conversationId: 5, title: 'Ana', me: 3, api: api, pollEvery: const Duration(seconds: 5))),
    ])));
    await tester.pumpAndSettle();
    expect(find.text('Hello'), findsOneWidget);
    expect(api.readUpTo, 1);

    await tester.enterText(find.byType(TextField), 'Hi Ana');
    await tester.tap(find.byTooltip('Send'));
    await tester.pumpAndSettle();
    expect(find.text('Hi Ana'), findsOneWidget);

    api.server.add({'id': 3, 'senderId': 7, 'senderName': 'Ana', 'body': 'See you Tuesday', 'createdAt': '2026-10-26T09:02:00Z'});
    await tester.pump(const Duration(seconds: 5));
    await tester.pumpAndSettle();
    expect(find.text('See you Tuesday'), findsOneWidget);
    expect(find.text('Hello'), findsOneWidget); // no duplicates
    expect(api.afters.last, 2);
    await tester.pumpWidget(const SizedBox()); // disposes the screen and its timer
  });
}
