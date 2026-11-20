import '../network/api_client.dart';

/// Prospect follow-up tasks assigned to the signed-in member (feature `contacts_growth`):
/// `api/mobile/prospect-tasks`. Errors throw ApiException with the server's message.
class ProspectTaskApi {
  ProspectTaskApi({ApiClient? api}) : _api = api ?? ApiClient();
  final ApiClient _api;

  /// The member's tasks; [status] is `open`, `done` or null for both.
  Future<List<Map<String, dynamic>>> mine({String? status}) async =>
      ((await _api.get<List<dynamic>>('/api/mobile/prospect-tasks${status == null ? '' : '?status=$status'}',
                      fromJson: (j) => j as List<dynamic>))
                  .data ??
              const [])
          .cast<Map<String, dynamic>>();

  /// Marks the task done, with an optional note on the outcome.
  Future<void> complete(int id, String? note) =>
      _api.post<dynamic>('/api/mobile/prospect-tasks/$id/complete', body: {'note': note});
}
