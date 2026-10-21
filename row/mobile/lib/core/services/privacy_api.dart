import '../network/api_client.dart';

/// Member privacy calls (ROW WS7, `api/privacy`), the app's twin of the web
/// ConsentGate and member export. Inert unless the brand sets `privacy.enabled`.
class PrivacyApi {
  PrivacyApi({ApiClient? api}) : _api = api ?? ApiClient();
  final ApiClient _api;

  /// The policy version the member must accept now, or null when nothing is required.
  Future<String?> requiredPolicyVersion() async {
    final res = await _api.get<Map<String, dynamic>>('/api/privacy/consent', fromJson: (j) => j as Map<String, dynamic>);
    final d = res.data;
    if (!res.isSuccess || d == null || d['required'] != true) return null;
    final v = d['policyVersion']?.toString() ?? '';
    return v.isEmpty ? null : v;
  }

  Future<bool> acceptConsent(String policyVersion, String language) async {
    final res = await _api.post<dynamic>('/api/privacy/consent',
        body: {'policyVersion': policyVersion, 'language': language, 'channel': 'app'});
    return res.isSuccess;
  }

  Future<bool> withdrawConsent() async => (await _api.post<dynamic>('/api/privacy/consent/withdraw')).isSuccess;

  /// Builds the member's data export; returns the download link (valid 7 days) or null.
  Future<String?> exportMyData(int memberId) async {
    final res = await _api.post<Map<String, dynamic>>('/api/privacy/members/$memberId/export',
        fromJson: (j) => j as Map<String, dynamic>);
    final url = res.data?['downloadUrl']?.toString() ?? '';
    return res.isSuccess && url.isNotEmpty ? url : null;
  }
}
