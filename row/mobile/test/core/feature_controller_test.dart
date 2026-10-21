import 'package:flutter_test/flutter_test.dart';
import 'package:rotary_flutter_app/core/features/feature_controller.dart';

void main() {
  // Same patterns the API sends in adminPaths (api/Services/FeatureGate.cs).
  final off = offPatterns([
    {'key': 'pph_camps', 'adminPaths': ['/pph-camps(/|\$)']},
    {'key': 'sub_groups', 'adminPaths': ['^/(clubs|districts)/[^/]+/sub-groups(/|\$)']},
  ]);

  test('off modules match their app routes', () {
    expect(offPatternsMatch(off, '/clubs/3/pph-camps'), isTrue);
    expect(offPatternsMatch(off, '/districts/1/sub-groups'), isTrue);
  });

  test('other routes and look-alikes stay open', () {
    expect(offPatternsMatch(off, '/clubs/3/members'), isFalse);
    expect(offPatternsMatch(off, '/clubs/3/pph-camps-old'), isFalse);
    expect(offPatternsMatch(off, '/districts/1/committee/groups/2/sub-groups'), isFalse);
  });
}
