import 'package:flutter_test/flutter_test.dart';
import 'package:rotary_flutter_app/data/models/member_model.dart';

void main() {
  test('Residence and Residential are the same home address', () {
    expect(isHomeAddressType('Residence'), isTrue);
    expect(isHomeAddressType('Residential'), isTrue);
    expect(isHomeAddressType('residence'), isTrue);
    expect(isHomeAddressType('Business'), isFalse);
    expect(isHomeAddressType(null), isFalse);
  });
}
