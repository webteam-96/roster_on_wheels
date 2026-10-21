import '../network/api_client.dart';
import '../../data/models/club_admin_dashboard_models.dart';

/// Client for the persistable Foundation Collection Goals
/// (`api/mobile/club-foundation-goals`, commit 5c505d3).
///
/// `clubId` is passed as a query param (the server validates the caller is an
/// active Club Admin/Moderator of it). Past years are read-only — the server
/// returns 400 on save/delete for them, surfaced as an [ApiException].
class ClubFoundationGoalsApi {
  ClubFoundationGoalsApi();

  final ApiClient _api = ApiClient();
  static const String _base = '/api/mobile/club-foundation-goals';

  /// List goals for [clubId]; [yearId] selects a year (defaults to current).
  Future<FoundationGoalList> list(int clubId, {int? yearId}) async {
    final res = await _api.get<Map<String, dynamic>>(
      '$_base/list',
      queryParams: {
        'clubId': clubId,
        if (yearId != null && yearId > 0) 'yearId': yearId,
      },
    );
    return FoundationGoalList.fromJson(res.data ?? const <String, dynamic>{});
  }

  /// Create/update (upsert) the goal for [clubId] + [yearId]. Amounts are in
  /// the club's chosen [currency] (defaults to INR here, matching the actuals).
  /// Throws [ApiException] with the server message on 400 (e.g. past year).
  Future<FoundationGoal> save(
    int clubId, {
    required int yearId,
    required num apfGoal,
    required num polioPlusGoal,
    required num endowmentFundGoal,
    required num otherGoal,
    String currency = 'INR',
    String? remarks,
  }) async {
    // ApiClient.post has no queryParams arg — clubId goes in the path query.
    final res = await _api.post<Map<String, dynamic>>(
      '$_base?clubId=$clubId',
      body: {
        'yearId': yearId,
        'apfGoal': apfGoal,
        'polioPlusGoal': polioPlusGoal,
        'endowmentFundGoal': endowmentFundGoal,
        'otherGoal': otherGoal,
        'currency': currency,
        if (remarks != null) 'remarks': remarks,
      },
    );
    return FoundationGoal.fromJson(res.data ?? const <String, dynamic>{});
  }

  /// Soft-delete the goal for [clubId] + [yearId]. Past years → 400.
  Future<void> delete(int clubId, int yearId) async {
    await _api.delete<void>('$_base/$yearId?clubId=$clubId');
  }
}
