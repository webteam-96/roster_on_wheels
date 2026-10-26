import 'package:flutter/material.dart' hide Text;
import 'package:flutter_test/flutter_test.dart';
import 'package:rotary_flutter_app/core/i18n/live_translator.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _known = {'Members', 'Events', 'Settings', 'Chat', '42'};

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('English sends nothing; another language batches misses once and caches them', () async {
    final calls = <List<String>>[];
    final t = LiveTranslator(known: _known, send: (target, texts) async {
      calls.add(texts);
      return [for (final s in texts) '[$target] $s'];
    });
    await t.load();
    expect(t.lookup('Members'), 'Members');
    await Future<void>.delayed(const Duration(milliseconds: 400));
    expect(calls, isEmpty);

    await t.setLanguage('es');
    expect(t.lookup('Members'), 'Members'); // not cached yet: English for now
    t.lookup('Members');
    t.lookup('Events');
    t.lookup('42'); // numbers are not sent
    t.lookup('Colombo West'); // data, not app text: never sent
    await Future<void>.delayed(const Duration(milliseconds: 400));
    expect(calls, [
      ['Members', 'Events'],
    ]);
    expect(t.lookup('Members'), '[es] Members');

    // A new translator for the same language starts from the saved cache.
    final again = LiveTranslator(known: _known, send: (_, __) async => throw 'not called');
    await again.load();
    expect(again.lookup('Events'), '[es] Events');
  });

  test('a failed batch leaves English and is not retried until the next start', () async {
    var calls = 0;
    final t = LiveTranslator(known: _known, send: (_, __) async {
      calls++;
      return null;
    });
    await t.setLanguage('fr');
    t.lookup('Settings');
    await Future<void>.delayed(const Duration(milliseconds: 400));
    expect(t.lookup('Settings'), 'Settings');
    await Future<void>.delayed(const Duration(milliseconds: 400));
    expect(calls, 1);
  });

  testWidgets('Text shows the translation once it arrives', (tester) async {
    final t = LiveTranslator(known: _known, send: (_, texts) async => [for (final s in texts) s == 'Chat' ? 'Charla' : s]);
    await tester.runAsync(() => t.setLanguage('es'));
    await tester.pumpWidget(TranslationScope(
        translator: t, child: const MaterialApp(home: Scaffold(body: Text('Chat')))));
    expect(find.text('Chat'), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 400)); // the batch timer runs on the test clock
    await tester.pumpAndSettle();
    expect(find.text('Charla'), findsOneWidget);
  });
}
