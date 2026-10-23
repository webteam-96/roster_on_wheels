import 'package:flutter_test/flutter_test.dart';
import 'package:rotary_flutter_app/core/features/feature_controller.dart';

void main() {
  // Same patterns the API sends in adminPaths (api/Services/FeatureGate.cs).
  final off = offPatterns([
    {'key': 'retired_module', 'adminPaths': ['/retired-module(/|\$)']},
    {'key': 'sub_groups', 'adminPaths': ['^/(clubs|districts)/[^/]+/sub-groups(/|\$)']},
  ]);

  test('off modules match their app routes', () {
    expect(offPatternsMatch(off, '/clubs/3/retired-module'), isTrue);
    expect(offPatternsMatch(off, '/districts/1/sub-groups'), isTrue);
  });

  test('other routes and look-alikes stay open', () {
    expect(offPatternsMatch(off, '/clubs/3/members'), isFalse);
    expect(offPatternsMatch(off, '/clubs/3/retired-module-old'), isFalse);
    expect(offPatternsMatch(off, '/districts/1/committee/groups/2/sub-groups'), isFalse);
  });
}
