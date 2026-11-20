import '../network/api_client.dart';

/// Time-limited cross-district access granted to the signed-in member (`api/district-access-grants/mine`): the
/// extra districts they may open, until each grant's expiry. The server enforces the grant on every request.
class DistrictAccessApi {
  DistrictAccessApi({ApiClient? api}) : _api = api ?? ApiClient();
  final ApiClient _api;

  Future<List<Map<String, dynamic>>> mine() async =>
      ((await _api.get<List<dynamic>>('/api/district-access-grants/mine', fromJson: (j) => j as List<dynamic>)).data ??
              const [])
          .cast<Map<String, dynamic>>();
}
