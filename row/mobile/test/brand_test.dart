import 'package:flutter_test/flutter_test.dart';
import 'package:rotary_flutter_app/core/brand/brand.dart';

void main() {
  test('parses the brand endpoint', () {
    final b = BrandInfo.fromJson({
      'productName': 'Roster On Wheels',
      'shortName': 'ROW',
      'logoUrl': '/brand/logo.png',
      'support': {'email': 'help@example.org', 'phones': ['+1 555 0100', ''], 'hours': 'Mon–Fri'},
      'domains': {'adminOrigin': 'https://admin.example.org/', 'clubSiteParent': 'clubs.example.org'},
      'legal': {'termsUrl': '/terms-and-conditions'},
      'features': {'modules.wallet': false, 'member.bloodGroup': true},
    });
    expect(b.supportPhones, ['+1 555 0100']);
    expect(b.webUrl(b.termsUrl), 'https://admin.example.org/terms-and-conditions');
    expect(b.logoFor(), 'https://admin.example.org/brand/logo.png');
    expect(b.feature('member.bloodGroup'), isTrue);
    expect(b.feature('unknown'), isFalse);
  });

  test('defaults when the brand is empty', () {
    final b = BrandInfo.fromJson({});
    expect(b.productName, 'Roster On Wheels');
    expect(b.webUrl('/websites'), '');
    expect(b.webUrl('https://x.example/y'), 'https://x.example/y');
  });
}
