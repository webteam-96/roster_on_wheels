import '../network/api_client.dart';

/// The signed-in member's service hours (feature `service_hours`): `api/mobile/service-hours`.
/// Errors throw ApiException with the server's message.
class ServiceHoursApi {
  ServiceHoursApi({ApiClient? api}) : _api = api ?? ApiClient();
  final ApiClient _api;

  static String _day(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  /// `{entries: [...], years: [...]}`: the member's logged entries plus hours recorded on volunteer sheets.
  Future<Map<String, dynamic>> mine() async =>
      (await _api.get<Map<String, dynamic>>('/api/mobile/service-hours', fromJson: (j) => j as Map<String, dynamic>)).data ??
      const {};

  /// The member's clubs, each with its projects of the Rotary year of [date].
  Future<List<Map<String, dynamic>>> options(DateTime date) async =>
      ((await _api.get<List<dynamic>>('/api/mobile/service-hours/options',
                      queryParams: {'date': _day(date)}, fromJson: (j) => j as List<dynamic>))
                  .data ??
              const [])
          .cast<Map<String, dynamic>>();

  /// Logs hours (pending until a club officer approves); returns the new entry.
  Future<Map<String, dynamic>> log({
    required int clubId,
    int? projectId,
    String? otherService,
    required DateTime date,
    required double hours,
    String? note,
  }) async =>
      (await _api.post<Map<String, dynamic>>('/api/mobile/service-hours',
              body: {
                'clubId': clubId,
                'projectId': projectId,
                'otherService': otherService,
                'serviceDate': _day(date),
                'hours': hours,
                'note': note,
              },
              fromJson: (j) => j as Map<String, dynamic>))
          .data ??
      const {};

  /// Adds the service photo (JPEG, PNG or WebP, 5 MB at most) to a pending entry of the member's.
  Future<void> photo(int id, String filePath) =>
      _api.sendMultipart<dynamic>('/api/mobile/service-hours/$id/photo', files: {'file': filePath});

  /// Removes an entry that is not approved yet.
  Future<void> remove(int id) => _api.delete<dynamic>('/api/mobile/service-hours/$id');
}
