import 'package:flutter_test/flutter_test.dart';
import 'package:rotary_flutter_app/core/utils/validators.dart';

void main() {
  test('accepts non-Indian numbers by their own country rules', () {
    expect(Validators.phoneForCountry('77 123 4567', isoCode: 'LR'), isNull);
    expect(Validators.phoneForCountry('202 555 0143', isoCode: 'US'), isNull);
    expect(Validators.phoneForCountry('7911 123456', dialCode: '+44'), isNull);
  });

  test('rejects a number too short for its country', () {
    expect(Validators.phoneForCountry('555 01', isoCode: 'US'), isNotNull);
  });

  test('country-agnostic check allows any plausible E.164 length', () {
    expect(Validators.phone('+231 77 123 4567'), isNull);
    expect(Validators.phone('1234'), isNotNull);
  });
}
