import 'package:flutter_test/flutter_test.dart';
import 'package:rotary_flutter_app/core/services/attendance_qr_code.dart';

// QR-ATTENDANCE — the signature must match MobileAttendanceQrController.
// Expected value computed independently (Python hmac/sha256, same recipe).
void main() {
  AttendanceQrKey key({int offset = 0}) => AttendanceQrKey.fromJson({
        'memberId': 1234,
        'date': '20261124',
        'dayKey': 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
        'serverTimeMs': 1000000 + offset,
        'tickMs': 500,
        'prefix': 'RA1',
      }, 1000000, 1000000);

  test('code matches the server recipe', () {
    expect(key().codeForTick(3590000000),
        'RA1.1234.20261124.3590000000.AFrUMLIP5ch9OU3L');
  });

  test('tick moves every 500 ms and follows the server clock', () {
    final k = key(offset: 2000); // server is 2 s ahead of this phone
    expect(k.tickAt(1000000), (1000000 + 2000) ~/ 500);
    expect(k.tickAt(1000499) == k.tickAt(1000000), isTrue);
    expect(k.tickAt(1000500), k.tickAt(1000000) + 1);
  });

  test('consecutive ticks give different codes', () {
    final k = key();
    expect(k.codeForTick(10) == k.codeForTick(11), isFalse);
  });

  test('parse accepts our codes and rejects others', () {
    final p = ScannedAttendanceQr.parse('RA1.1234.20261124.3590000000.AFrUMLIP5ch9OU3L');
    expect(p?.memberId, 1234);
    expect(p?.tick, 3590000000);
    expect(ScannedAttendanceQr.parse('https://example.com'), isNull);
    expect(ScannedAttendanceQr.parse('RA1.x.20261124.1.a'), isNull);
  });
}
