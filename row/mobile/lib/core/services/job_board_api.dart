import '../network/api_client.dart';

/// Job postings and business offers of the member's districts (feature `job_board`): `api/mobile/job-board`.
/// Errors throw ApiException with the server's message.
class JobBoardApi {
  JobBoardApi({ApiClient? api}) : _api = api ?? ApiClient();
  final ApiClient _api;

  List<Map<String, dynamic>> _list(dynamic data) => ((data as List?) ?? const []).cast<Map<String, dynamic>>();

  /// Live posts; [kind] is `job` or `offer`, [query] searches title, description, company and location.
  Future<List<Map<String, dynamic>>> browse({String? kind, String? query}) async => _list((await _api.get<List<dynamic>>(
        '/api/mobile/job-board',
        queryParams: {
          if (kind != null) 'kind': kind,
          if (query != null && query.trim().isNotEmpty) 'q': query.trim(),
        },
        fromJson: (j) => j as List<dynamic>,
      ))
          .data);

  /// The member's own posts in every state (pending, approved, rejected, removed, withdrawn, expired).
  Future<List<Map<String, dynamic>>> mine() async =>
      _list((await _api.get<List<dynamic>>('/api/mobile/job-board/mine', fromJson: (j) => j as List<dynamic>)).data);

  Future<void> create(Map<String, dynamic> post) => _api.post<dynamic>('/api/mobile/job-board', body: post);

  Future<void> withdraw(int id) => _api.delete<dynamic>('/api/mobile/job-board/$id');

  Future<void> report(int id, String reason) =>
      _api.post<dynamic>('/api/mobile/job-board/$id/report', body: {'reason': reason});
}
