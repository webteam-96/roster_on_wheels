import '../constants/api_constants.dart';
import '../network/api_client.dart';
import '../network/api_exceptions.dart';
import '../../data/models/training_appointment_models.dart';

/// Thin client for the Website Training appointment endpoints
/// (`/api/training-appointments/*`). A club admin (role 2) of a club with an
/// ACTIVE website subscription books/reschedules a Calendly-style 30-minute
/// Zoom training session. `clubId` is passed so a multi-club admin acts on the
/// club they opened (the server validates the role, else 403).
///
/// NOTE: these are plain `/api/...` routes (NOT `/api/mobile/...`).
class TrainingAppointmentApi {
  TrainingAppointmentApi();

  final ApiClient _api = ApiClient();

  /// Open 30-minute slots. The backend returns 400 with a `{message}` when the
  /// club has no active website subscription — surfaced here as a typed
  /// [TrainingLockedException] so the screen can render a friendly locked state
  /// instead of a generic error.
  Future<AvailabilityResponse> getAvailability(int clubId) async {
    try {
      final res = await _api.get<dynamic>(
        ApiConstants.trainingAvailability,
        queryParams: {'clubId': clubId},
        fromJson: (j) => j,
      );
      final d = res.data;
      return AvailabilityResponse.fromJson(
          d is Map ? d.cast<String, dynamic>() : const <String, dynamic>{});
    } on ApiException catch (e) {
      // The only 400 this endpoint returns is the "needs active website" gate.
      if (e.statusCode == 400) throw TrainingLockedException(e.message);
      rethrow;
    }
  }

  /// This club's upcoming appointments.
  Future<List<TrainingAppointment>> getMine(int clubId) async {
    final res = await _api.get<dynamic>(
      ApiConstants.trainingMine,
      queryParams: {'clubId': clubId},
      fromJson: (j) => j,
    );
    final list = res.data;
    if (list is! List) return const <TrainingAppointment>[];
    return list
        .whereType<Map>()
        .map((e) => TrainingAppointment.fromJson(e.cast<String, dynamic>()))
        .toList();
  }

  /// Book a slot. [slotStart] must be sent EXACTLY as composed from the
  /// availability day+slot ("yyyy-MM-ddTHH:mm", IST wall-clock — no conversion).
  /// A failure comes back as a 400 whose `{message}` bubbles up as an
  /// [ApiException] (message is user-facing).
  Future<BookAppointmentResult> book(
    int clubId,
    String slotStart, {
    String? notes,
  }) async {
    final res = await _api.post<dynamic>(
      ApiConstants.trainingBook,
      body: {
        'clubId': clubId,
        'slotStart': slotStart,
        if (notes != null && notes.trim().isNotEmpty) 'notes': notes.trim(),
      },
      fromJson: (j) => j,
    );
    final d = res.data;
    return BookAppointmentResult.fromJson(
        d is Map ? d.cast<String, dynamic>() : const <String, dynamic>{});
  }

  /// Reschedule an existing appointment to a new slot.
  Future<BookAppointmentResult> reschedule(int id, String slotStart) async {
    final res = await _api.post<dynamic>(
      ApiConstants.trainingReschedule(id),
      body: {'slotStart': slotStart},
      fromJson: (j) => j,
    );
    final d = res.data;
    return BookAppointmentResult.fromJson(
        d is Map ? d.cast<String, dynamic>() : const <String, dynamic>{});
  }
}

/// Thrown by [TrainingAppointmentApi.getAvailability] when the club has no
/// active website subscription (backend 400). Lets the booking screen show a
/// friendly locked state carrying the server's message.
class TrainingLockedException implements Exception {
  final String message;
  const TrainingLockedException(this.message);

  @override
  String toString() => message;
}
