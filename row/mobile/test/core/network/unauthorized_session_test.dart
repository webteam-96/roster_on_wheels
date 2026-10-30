import 'package:flutter_test/flutter_test.dart';
import 'package:rotary_flutter_app/core/network/api_client.dart';

// A 401 may only end the session it was sent with. Regression for 29 Oct 2026: the notification badge
// polled with no token on the sign-in screen, its 401 cleared storage while the new login was saving,
// and the member landed back on Sign In with a blank name.
void main() {
  test('a 401 for the current token ends the session', () {
    expect(ApiClient.rejectsCurrentSession('Bearer abc', 'abc'), isTrue);
  });

  test('a 401 for a request sent without a token does not end the session', () {
    expect(ApiClient.rejectsCurrentSession(null, 'abc'), isFalse);
  });

  test('a 401 for an older token does not end the newer session', () {
    expect(ApiClient.rejectsCurrentSession('Bearer old', 'new'), isFalse);
  });

  test('a 401 when no session is stored has nothing to end', () {
    expect(ApiClient.rejectsCurrentSession('Bearer abc', null), isFalse);
  });
}
