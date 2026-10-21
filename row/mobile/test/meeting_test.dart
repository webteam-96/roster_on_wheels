import 'package:flutter_test/flutter_test.dart';
import 'package:rotary_flutter_app/core/utils/meeting.dart';

void main() {
  test('same rule as the API: online/hybrid links must be https; in person has none', () {
    expect(validateMeetingLink('in_person', 'http://x'), isNull);
    expect(validateMeetingLink('hybrid', 'https://zoom.us/j/1'), isNull);
    expect(validateMeetingLink('online', ''), isNull);
    expect(validateMeetingLink('online', 'javascript:alert(1)'), isNotNull);
    expect(validateMeetingLink('hybrid', 'http://example.org'), isNotNull);
  });

  test('payload drops the link for in-person meetings', () {
    expect(meetingPayload('in_person', 'https://zoom.us/j/1'), {'meetingMode': 'in_person', 'meetingLink': null});
    expect(meetingPayload('online', ' https://meet.google.com/abc '),
        {'meetingMode': 'online', 'meetingLink': 'https://meet.google.com/abc'});
  });
}
