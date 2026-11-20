import '../network/api_client.dart';

/// Youth programs (gap #12, feature `youth_programs`): `api/youth/...`. The member's own Youth Protection clearance,
/// and for an appointed club youth officer or district youth chair, RYLA and RLI participants and the clearance
/// register of their club or district. The API enforces who sees what. Errors throw ApiException.
class YouthApi {
  YouthApi({ApiClient? api}) : _api = api ?? ApiClient();
  final ApiClient _api;

  static String _base(int districtId, int clubId) =>
      clubId > 0 ? '/api/youth/clubs/$clubId' : '/api/youth/districts/$districtId';

  Future<Map<String, dynamic>> me() async =>
      (await _api.get<Map<String, dynamic>>('/api/youth/me', fromJson: (j) => j as Map<String, dynamic>)).data ??
      const {};

  Future<List<Map<String, dynamic>>> _list(String path, [Map<String, dynamic>? query]) async =>
      ((await _api.get<List<dynamic>>(path, queryParams: query, fromJson: (j) => j as List<dynamic>)).data ?? const [])
          .cast<Map<String, dynamic>>();

  Future<List<Map<String, dynamic>>> years() => _list('/api/youth/years');

  Future<List<Map<String, dynamic>>> participants(int districtId, int clubId, int yearId) =>
      _list('${_base(districtId, clubId)}/participants', {'yearId': '$yearId'});

  Future<void> addParticipant(int clubId, Map<String, dynamic> body) =>
      _api.post<dynamic>('/api/youth/clubs/$clubId/participants', body: body);

  Future<void> setStatus(int districtId, int clubId, int id, String status) =>
      _api.put<dynamic>('${_base(districtId, clubId)}/participants/$id/status', body: {'status': status});

  Future<List<Map<String, dynamic>>> clearances(int districtId, int clubId) =>
      _list('${_base(districtId, clubId)}/clearances');

  Future<void> saveClearance(int districtId, int clubId, int memberId, Map<String, dynamic> body) =>
      _api.put<dynamic>('${_base(districtId, clubId)}/clearances/$memberId', body: body);
}

/// Mirrors YouthRules.MayMove in the API: the statuses this person may move a participant to.
List<String> youthNextStatuses(String from, {required bool chair}) {
  final club = from == 'applied' || from == 'approved' ? ['withdrawn'] : <String>[];
  if (!chair) return club;
  const decide = {
    'applied': ['approved', 'declined'],
    'approved': ['attended', 'declined'],
    'attended': ['completed'],
  };
  return [...?decide[from], ...club];
}
