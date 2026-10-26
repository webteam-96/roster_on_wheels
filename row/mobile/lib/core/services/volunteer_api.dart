import '../network/api_client.dart';

/// Volunteer sign-up sheets and meeting duties for the signed-in member (N4, feature `volunteers`):
/// `api/mobile/volunteers` and `api/mobile/meeting-duties`. Errors throw ApiException with the server's message.
class VolunteerApi {
  VolunteerApi({ApiClient? api}) : _api = api ?? ApiClient();
  final ApiClient _api;

  /// Open sheets of the member's clubs; each slot says whether the member has signed up.
  Future<List<Map<String, dynamic>>> sheets() async =>
      ((await _api.get<List<dynamic>>('/api/mobile/volunteers', fromJson: (j) => j as List<dynamic>)).data ?? const [])
          .cast<Map<String, dynamic>>();

  Future<void> signUp(int slotId) => _api.post<dynamic>('/api/mobile/volunteers/slots/$slotId/signup');

  Future<void> cancel(int slotId) => _api.delete<dynamic>('/api/mobile/volunteers/slots/$slotId/signup');

  /// The member's upcoming meeting duties (speaker host, greeter, and so on).
  Future<List<Map<String, dynamic>>> duties() async =>
      ((await _api.get<List<dynamic>>('/api/mobile/meeting-duties', fromJson: (j) => j as List<dynamic>)).data ??
              const [])
          .cast<Map<String, dynamic>>();

  /// The member's personal guest invite link for a club (feature `contacts_growth`).
  Future<String?> inviteLink(int clubId) async {
    final res = await _api.get<Map<String, dynamic>>('/api/clubs/$clubId/invite-link',
        fromJson: (j) => j as Map<String, dynamic>);
    final url = res.data?['url']?.toString() ?? '';
    return url.isEmpty ? null : url;
  }
}
