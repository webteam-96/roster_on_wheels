import '../network/api_client.dart';

/// Donation campaigns open in the signed-in member's clubs and districts (gap #13): `api/mobile/donations`.
/// Giving happens on the campaign's public giving page (givingUrl), where the payment provider takes the card.
class DonationApi {
  DonationApi({ApiClient? api}) : _api = api ?? ApiClient();
  final ApiClient _api;

  Future<List<Map<String, dynamic>>> campaigns() async =>
      ((await _api.get<List<dynamic>>('/api/mobile/donations', fromJson: (j) => j as List<dynamic>)).data ?? const [])
          .cast<Map<String, dynamic>>();
}
