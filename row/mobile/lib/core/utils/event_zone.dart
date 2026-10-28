import '../network/api_client.dart';

/// The IANA zone a club's or district's events are in (build spec 3.3), for [DateFormatter.eventDateTime].
/// One request per club / district per app run; null when the lookup fails (times then show in device time).
class EventZones {
  static final Map<String, Future<String?>> _cache = {};

  static Future<String?> club(int clubId) => _get('clubId', clubId);
  static Future<String?> district(int districtId) => _get('districtId', districtId);

  static Future<String?> _get(String key, int id) {
    if (id <= 0) return Future.value(null);
    return _cache.putIfAbsent('$key$id', () async {
      try {
        final resp = await ApiClient().get<Map<String, dynamic>>('/api/time-zone',
            queryParams: {key: '$id'}, fromJson: (j) => j as Map<String, dynamic>);
        return resp.data?['timeZone'] as String?;
      } catch (_) {
        _cache.remove('$key$id');
        return null;
      }
    });
  }
}
