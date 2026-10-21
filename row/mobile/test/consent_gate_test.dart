import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rotary_flutter_app/core/brand/brand.dart';
import 'package:rotary_flutter_app/core/services/privacy_api.dart';
import 'package:rotary_flutter_app/presentation/widgets/consent_gate.dart';

class _FakePrivacy implements PrivacyApi {
  _FakePrivacy(this.required);
  final String? required;
  String? accepted;

  @override
  Future<String?> requiredPolicyVersion() async => required;
  @override
  Future<bool> acceptConsent(String policyVersion, String language) async {
    accepted = policyVersion;
    return true;
  }
  @override
  Future<bool> withdrawConsent() async => true;
  @override
  Future<String?> exportMyData(int memberId) async => null;
}

Future<void> _open(WidgetTester tester, PrivacyApi api) async {
  await tester.pumpWidget(MaterialApp(
    home: Builder(
      builder: (context) => TextButton(
        onPressed: () => checkAndShowConsent(context, api: api),
        child: const Text('go'),
      ),
    ),
  ));
  await tester.tap(find.text('go'));
  await tester.pumpAndSettle();
}

void main() {
  tearDown(() => Brand.current = BrandInfo.defaults);

  testWidgets('a required policy blocks with a dialog; Accept records that version', (tester) async {
    Brand.current = BrandInfo.fromJson({'features': {'privacy.enabled': true}});
    final api = _FakePrivacy('2026-10');
    await _open(tester, api);
    expect(find.text('Your privacy'), findsOneWidget);
    await tester.tap(find.text('Accept'));
    await tester.pumpAndSettle();
    expect(api.accepted, '2026-10');
    expect(find.text('Your privacy'), findsNothing);
  });

  testWidgets('nothing shows when consent is not required', (tester) async {
    Brand.current = BrandInfo.fromJson({'features': {'privacy.enabled': true}});
    await _open(tester, _FakePrivacy(null));
    expect(find.text('Your privacy'), findsNothing);
  });

  testWidgets('nothing shows when the instance has privacy switched off', (tester) async {
    Brand.current = BrandInfo.fromJson({'features': {'privacy.enabled': false}});
    await _open(tester, _FakePrivacy('2026-10'));
    expect(find.text('Your privacy'), findsNothing);
  });
}
