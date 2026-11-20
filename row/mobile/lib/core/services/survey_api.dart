import '../network/api_client.dart';

/// Surveys and polls for the signed-in member (gap #9): `api/mobile/surveys`. Errors throw ApiException with the
/// server's message.
class SurveyApi {
  SurveyApi({ApiClient? api}) : _api = api ?? ApiClient();
  final ApiClient _api;

  /// Surveys the member is asked (open first), with `answered` and `canSeeResults`.
  Future<List<Map<String, dynamic>>> surveys() async =>
      ((await _api.get<List<dynamic>>('/api/mobile/surveys', fromJson: (j) => j as List<dynamic>)).data ?? const [])
          .cast<Map<String, dynamic>>();

  /// One survey with its questions and the member's own answers (`myAnswers`).
  Future<Map<String, dynamic>> survey(int id) async =>
      (await _api.get<Map<String, dynamic>>('/api/mobile/surveys/$id', fromJson: (j) => j as Map<String, dynamic>)).data ??
      const {};

  /// Saves (or replaces) the member's answers: [{questionId, choices?, text?, rating?}].
  Future<void> submit(int id, List<Map<String, dynamic>> answers) =>
      _api.post<dynamic>('/api/mobile/surveys/$id/responses', body: {'answers': answers});

  /// Results without names, when the survey shares them.
  Future<Map<String, dynamic>> results(int id) async =>
      (await _api.get<Map<String, dynamic>>('/api/mobile/surveys/$id/results',
                  fromJson: (j) => j as Map<String, dynamic>))
              .data ??
          const {};
}
