import '../../core/constants/api_constants.dart';
import '../../core/network/api_client.dart';

/// Mirror of the web `ModuleComingSoonInfo` (GET /api/modules/coming-soon).
/// SuperAdmin bypasses Coming Soon on the web; the Flutter app has no
/// SuperAdmin (auth_provider.isSuperAdmin is always false), so every mobile
/// user sees the placeholder for any module flagged in module_master.
class ModuleComingSoonInfo {
  final int moduleId;
  final String moduleKey;
  final String moduleName;
  final bool isComingSoon;
  final DateTime? comingSoonDate;

  const ModuleComingSoonInfo({
    required this.moduleId,
    required this.moduleKey,
    required this.moduleName,
    required this.isComingSoon,
    this.comingSoonDate,
  });

  factory ModuleComingSoonInfo.fromJson(Map<String, dynamic> json) {
    // The server serializes ComingSoonDate without a timezone offset; parse
    // it as the stored wall-clock value and DON'T convert to local (matches
    // the RI per-module datetime conventions — no UTC "fix" here).
    final raw = json['comingSoonDate']?.toString();
    return ModuleComingSoonInfo(
      moduleId: json['moduleId'] as int? ?? 0,
      moduleKey: json['moduleKey']?.toString() ?? '',
      moduleName: json['moduleName']?.toString() ?? '',
      isComingSoon: json['isComingSoon'] as bool? ?? false,
      comingSoonDate:
          (raw == null || raw.isEmpty) ? null : DateTime.tryParse(raw),
    );
  }
}

/// Lookup of which modules are flagged Coming Soon, keyed by a normalized
/// moduleKey so it matches the same normalization the dashboards use when
/// resolving routes (lowercase, no spaces/underscores/hyphens).
class ComingSoonRegistry {
  final Map<String, DateTime?> _byKey;

  const ComingSoonRegistry._(this._byKey);

  factory ComingSoonRegistry.empty() => const ComingSoonRegistry._({});

  factory ComingSoonRegistry.fromList(List<ModuleComingSoonInfo> list) {
    final map = <String, DateTime?>{};
    for (final m in list) {
      if (m.isComingSoon) map[normalizeKey(m.moduleKey)] = m.comingSoonDate;
    }
    return ComingSoonRegistry._(map);
  }

  static String normalizeKey(String key) => key
      .toLowerCase()
      .replaceAll(' ', '')
      .replaceAll('_', '')
      .replaceAll('-', '');

  bool isComingSoon(String moduleKey) =>
      _byKey.containsKey(normalizeKey(moduleKey));

  DateTime? dateFor(String moduleKey) => _byKey[normalizeKey(moduleKey)];

  /// Fetches the flags. Never throws — returns an empty registry on any
  /// failure so a backend hiccup never blocks the dashboard from rendering.
  static Future<ComingSoonRegistry> fetch(ApiClient api) async {
    try {
      final resp = await api.get<List<ModuleComingSoonInfo>>(
        ApiConstants.modulesComingSoon,
        fromJson: (j) => (j as List<dynamic>)
            .map((e) => ModuleComingSoonInfo.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
      return ComingSoonRegistry.fromList(resp.data ?? const []);
    } catch (_) {
      return ComingSoonRegistry.empty();
    }
  }
}
