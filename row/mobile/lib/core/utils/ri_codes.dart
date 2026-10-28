import '../network/api_client.dart';

/// One entry of the RI lists (build spec 3.12): kind is member_type, join_reason or termination_reason.
class RiCode {
  final String kind;
  final String code;
  final String label;
  const RiCode(this.kind, this.code, this.label);
}

/// The RI lists Super Admin keeps (GET /api/ri-codes), loaded once per app run; empty when the lookup fails.
class RiCodes {
  static Future<List<RiCode>>? _all;

  static Future<List<RiCode>> of(String kind) async =>
      (await (_all ??= _load())).where((c) => c.kind == kind).toList();

  static Future<List<RiCode>> _load() async {
    try {
      final resp = await ApiClient().get<List<dynamic>>('/api/ri-codes', fromJson: (j) => j as List<dynamic>);
      return (resp.data ?? [])
          .map((e) => e as Map<String, dynamic>)
          .map((e) => RiCode('${e['kind']}', '${e['code']}', '${e['label']}'))
          .toList();
    } catch (_) {
      _all = null; // try again next time
      return [];
    }
  }
}
