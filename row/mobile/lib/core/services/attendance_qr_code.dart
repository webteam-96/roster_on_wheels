import 'dart:convert';

import 'package:crypto/crypto.dart';

/// QR attendance — the "living QR". Marker: QR-ATTENDANCE
///
/// The member's phone draws the QR itself, offline, from a DAY KEY it fetches
/// once (GET /api/mobile/attendance/qr-key). Every [tickMs] (500 ms) the
/// "tick" moves on and the signature changes, so:
///   • a photo / screenshot is ONE frozen frame → the scanner sees no movement
///     and the server refuses it ("Photo detected");
///   • an old video replay carries old ticks → refused as stale.
///
/// ⚠️ Must match MobileAttendanceQrController (server) byte for byte:
///   text = "{prefix}.{memberId}.{yyyyMMdd}.{tick}.{sig}"
///   sig  = base64url(HMAC-SHA256(dayKey, "{memberId}|{tick}")[0..12]), no padding
class AttendanceQrKey {
  final int memberId;
  final String date; // yyyyMMdd (UTC) — the day the key belongs to
  final List<int> dayKey;
  final int tickMs;
  final String prefix;

  /// serverTime − deviceTime, so every phone draws the same tick as the server.
  final int clockOffsetMs;

  const AttendanceQrKey({
    required this.memberId,
    required this.date,
    required this.dayKey,
    required this.tickMs,
    required this.prefix,
    required this.clockOffsetMs,
  });

  /// [sentAtMs]/[receivedAtMs] are device times around the request; half the
  /// round trip is credited to the server's clock reading.
  factory AttendanceQrKey.fromJson(
      Map<String, dynamic> j, int sentAtMs, int receivedAtMs) {
    final serverMs = (j['serverTimeMs'] as num?)?.toInt() ?? receivedAtMs;
    final midpoint = sentAtMs + (receivedAtMs - sentAtMs) ~/ 2;
    return AttendanceQrKey(
      memberId: (j['memberId'] as num?)?.toInt() ?? 0,
      date: j['date']?.toString() ?? '',
      dayKey: base64Url.decode(base64Url.normalize(j['dayKey']?.toString() ?? '')),
      tickMs: (j['tickMs'] as num?)?.toInt() ?? 500,
      prefix: j['prefix']?.toString() ?? 'RA1',
      clockOffsetMs: serverMs - midpoint,
    );
  }

  int serverNowMs(int deviceNowMs) => deviceNowMs + clockOffsetMs;

  int tickAt(int deviceNowMs) => serverNowMs(deviceNowMs) ~/ tickMs;

  /// The UTC day (yyyyMMdd) at [deviceNowMs], on the server's clock.
  String utcDayAt(int deviceNowMs) {
    final d = DateTime.fromMillisecondsSinceEpoch(serverNowMs(deviceNowMs), isUtc: true);
    return '${d.year.toString().padLeft(4, '0')}'
        '${d.month.toString().padLeft(2, '0')}'
        '${d.day.toString().padLeft(2, '0')}';
  }

  String codeForTick(int tick) {
    final mac = Hmac(sha256, dayKey).convert(utf8.encode('$memberId|$tick')).bytes;
    final sig = base64Url.encode(mac.sublist(0, 12)).replaceAll('=', '');
    return '$prefix.$memberId.$date.$tick.$sig';
  }
}

/// A scanned QR, split into its parts. Null when it is not an attendance QR.
class ScannedAttendanceQr {
  final String raw;
  final int memberId;
  final int tick;

  const ScannedAttendanceQr(this.raw, this.memberId, this.tick);

  static ScannedAttendanceQr? parse(String? raw, {String prefix = 'RA1'}) {
    final p = (raw ?? '').trim().split('.');
    if (p.length != 5 || p[0] != prefix) return null;
    final id = int.tryParse(p[1]);
    final tick = int.tryParse(p[3]);
    if (id == null || tick == null || p[2].length != 8 || p[4].isEmpty) return null;
    return ScannedAttendanceQr(raw!.trim(), id, tick);
  }
}
