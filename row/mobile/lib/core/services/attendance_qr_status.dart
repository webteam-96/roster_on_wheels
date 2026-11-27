import 'package:flutter/foundation.dart';

import '../constants/api_constants.dart';
import '../constants/feature_flags.dart';
import '../network/api_client.dart';

/// Which of my clubs have QR attendance switched on. Marker: QR-ATTENDANCE
///
/// SuperAdmin decides per club on the web (Settings → QR Attendance) — test
/// clubs first, then all clubs. Until the server answers, or if it fails (an
/// older API without the endpoint), the set is EMPTY, so nothing is shown.
class AttendanceQrStatus {
  AttendanceQrStatus._();
  static final AttendanceQrStatus instance = AttendanceQrStatus._();

  final ValueNotifier<Set<int>> enabledClubIds = ValueNotifier(const {});
  final _api = ApiClient();

  bool get anyClub => enabledClubIds.value.isNotEmpty;
  bool isClubEnabled(int clubId) => enabledClubIds.value.contains(clubId);

  Future<void> refresh() async {
    if (!kQrAttendanceEnabled) return;
    try {
      final res = await _api.get<Map<String, dynamic>>(
        ApiConstants.attendanceQrStatus,
        fromJson: (j) => j as Map<String, dynamic>,
      );
      if (!res.isSuccess || res.data == null) return;
      final ids = (res.data!['enabledClubIds'] as List? ?? const [])
          .map((e) => (e as num).toInt())
          .toSet();
      enabledClubIds.value = ids;
    } catch (_) {
      // Keep the last known answer; the feature just stays hidden.
    }
  }
}
