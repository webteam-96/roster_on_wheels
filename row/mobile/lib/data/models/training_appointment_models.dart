/// Models for the Website Training appointment booking API
/// (`/api/training-appointments/*`).
///
/// A club admin of a club with an ACTIVE website subscription books a
/// Calendly-style 30-minute Zoom training slot. The Zoom meeting is created
/// server-side; the app only displays + opens the returned `zoomJoinUrl`.
///
/// Conventions (mirrors the backend DTOs in `TrainingAppointmentDtos.cs`):
///  • all JSON property names are camelCase;
///  • availability `date` is `"yyyy-MM-dd"`, `slots` are open start times
///    `"HH:mm"` and MUST be echoed back verbatim (no timezone conversion);
///  • a booked appointment's `slotStart` is ISO `"yyyy-MM-ddTHH:mm:ss"`.
library;

// ── primitive parsers (null-safe) ───────────────────────────────────────────

int _i(dynamic v) {
  if (v is int) return v;
  if (v is num) return v.round();
  return int.tryParse('${v ?? ''}') ?? 0;
}

String _s(dynamic v) => v?.toString() ?? '';

String? _sn(dynamic v) {
  final s = v?.toString();
  return (s == null || s.isEmpty) ? null : s;
}

List<String> _strList(dynamic v) =>
    v is List ? v.map((e) => e.toString()).toList() : const <String>[];

// ── Availability ────────────────────────────────────────────────────────────

/// One bookable day with its open 30-minute start times.
class AvailabilityDay {
  final String date; // "yyyy-MM-dd"
  final String dayLabel; // e.g. "Wed, 02 Jul"
  final List<String> slots; // open start times "HH:mm"

  const AvailabilityDay({
    required this.date,
    required this.dayLabel,
    required this.slots,
  });

  factory AvailabilityDay.fromJson(Map<String, dynamic> j) => AvailabilityDay(
        date: _s(j['date']),
        dayLabel: _s(j['dayLabel']),
        slots: _strList(j['slots']),
      );

  bool get hasSlots => slots.isNotEmpty;
}

/// Availability response: the slot length and the list of days.
class AvailabilityResponse {
  final int slotMinutes;
  final List<AvailabilityDay> days;

  const AvailabilityResponse({
    required this.slotMinutes,
    required this.days,
  });

  factory AvailabilityResponse.fromJson(Map<String, dynamic> j) {
    final mins = _i(j['slotMinutes']);
    final rawDays = j['days'];
    return AvailabilityResponse(
      slotMinutes: mins > 0 ? mins : 30,
      days: rawDays is List
          ? rawDays
              .whereType<Map>()
              .map((e) => AvailabilityDay.fromJson(e.cast<String, dynamic>()))
              .toList()
          : const <AvailabilityDay>[],
    );
  }

  /// Only days that actually have at least one open slot.
  List<AvailabilityDay> get openDays =>
      days.where((d) => d.hasSlots).toList(growable: false);

  bool get hasSlots => openDays.isNotEmpty;
}

// ── Appointment ─────────────────────────────────────────────────────────────

class TrainingAppointment {
  final int id;
  final int clubId;
  final String clubName;
  final String slotStart; // ISO "yyyy-MM-ddTHH:mm:ss"
  final int durationMinutes;
  final String status;
  final String? zoomJoinUrl;
  final String? zoomStartUrl;
  final String? bookedByName;
  final String? notes;
  final String? bookedDate;

  const TrainingAppointment({
    required this.id,
    required this.clubId,
    required this.clubName,
    required this.slotStart,
    required this.durationMinutes,
    required this.status,
    required this.zoomJoinUrl,
    required this.zoomStartUrl,
    required this.bookedByName,
    required this.notes,
    required this.bookedDate,
  });

  factory TrainingAppointment.fromJson(Map<String, dynamic> j) =>
      TrainingAppointment(
        id: _i(j['id']),
        clubId: _i(j['clubId']),
        clubName: _s(j['clubName']),
        slotStart: _s(j['slotStart']),
        durationMinutes: _i(j['durationMinutes']),
        status: _s(j['status']),
        zoomJoinUrl: _sn(j['zoomJoinUrl']),
        zoomStartUrl: _sn(j['zoomStartUrl']),
        bookedByName: _sn(j['bookedByName']),
        notes: _sn(j['notes']),
        bookedDate: _sn(j['bookedDate']),
      );

  /// Parsed local wall-clock of the slot, for display formatting. Null when the
  /// server sent nothing parseable.
  DateTime? get slotDateTime => DateTime.tryParse(slotStart);

  bool get hasJoinUrl => (zoomJoinUrl ?? '').trim().isNotEmpty;
}

// ── Book / reschedule result ────────────────────────────────────────────────

class BookAppointmentResult {
  final bool isSuccess;
  final String? message;
  final TrainingAppointment? appointment;

  const BookAppointmentResult({
    required this.isSuccess,
    required this.message,
    required this.appointment,
  });

  factory BookAppointmentResult.fromJson(Map<String, dynamic> j) {
    final appt = j['appointment'];
    return BookAppointmentResult(
      isSuccess: j['isSuccess'] == true,
      message: _sn(j['message']),
      appointment: appt is Map
          ? TrainingAppointment.fromJson(appt.cast<String, dynamic>())
          : null,
    );
  }
}
