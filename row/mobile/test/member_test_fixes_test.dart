import 'package:flutter/material.dart' hide Text;
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/intl.dart';
import 'package:rotary_flutter_app/core/i18n/text.dart';
import 'package:rotary_flutter_app/core/utils/date_formatter.dart';
import 'package:rotary_flutter_app/core/utils/snackbar_utils.dart';
import 'package:rotary_flutter_app/presentation/widgets/weblinks/weblinks_section.dart';

// The member test of 2026-11-25 (findings 5, 9 and 17).
void main() {
  setUpAll(DateFormatter.init);

  test('"your time" is the device zone, not UTC', () {
    const raw = '2026-12-31T05:53:00Z';
    final local = DateTime.parse(raw).toLocal();
    // A zone the device is surely not in at that moment, so the second time always shows.
    final zone = local.timeZoneOffset == const Duration(hours: 9) ? 'Asia/Kolkata' : 'Asia/Tokyo';
    final shown = DateFormatter.eventDateTime(raw, zone, locale: 'en_US');
    expect(shown, contains('your time'));
    expect(shown, contains(DateFormat.jm('en_US').format(local)));
  });

  test('rich-editor HTML shows as plain text', () {
    expect(plainText('<p>To&nbsp;help&nbsp;you</p><p>Tom &amp; Ann</p>'), 'To help you Tom & Ann');
    expect(plainText('<p></p>'), '');
    expect(plainText(null), '');
  });

  testWidgets('an error raised in a sheet shows above the sheet and goes away', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (context) => TextButton(
            onPressed: () => showModalBottomSheet<void>(
              context: context,
              builder: (ctx) => TextButton(
                onPressed: () => SnackbarUtils.showError(ctx, 'Enter the business name.'),
                child: const Text('Save'),
              ),
            ),
            child: const Text('Open'),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Save'));
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.byType(SnackBar), findsNothing);
    expect(find.text('Enter the business name.'), findsOneWidget);
    expect(tester.getCenter(find.text('Enter the business name.')).dy, lessThan(120));
    await tester.pump(const Duration(seconds: 3));
    await tester.pumpAndSettle();
    expect(find.text('Enter the business name.'), findsNothing);
  });
}
