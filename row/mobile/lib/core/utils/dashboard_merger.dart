import '../../data/models/dashboard_module_model.dart';
import '../../data/models/merged_dashboard_model.dart';

String _normalizeKey(String key) =>
    key.toLowerCase().replaceAll('_', '').replaceAll('-', '').replaceAll(' ', '');

List<MergedModuleGroup> mergeDashboards({
  required List<DashboardModuleGroup> districtGroups,
  required List<DashboardModuleGroup> clubGroups,
}) {
  // Build a map of normalized key -> MergedModule for district modules
  final Map<String, MergedModule> mergedByKey = {};
  // Track category info by normalized key
  final Map<String, ({int categoryId, String categoryName, int sortOrder})> categoryByKey = {};

  // Process district groups first
  for (final group in districtGroups) {
    for (final module in group.modules) {
      final normalizedKey = _normalizeKey(module.moduleKey);
      mergedByKey[normalizedKey] = MergedModule(
        moduleId: module.moduleId,
        moduleName: module.moduleName,
        moduleKey: module.moduleKey,
        iconClass: module.iconClass,
        iconPath: module.iconPath,
        routeUrl: module.routeUrl,
        description: module.description,
        scope: ['district'],
      );
      categoryByKey[normalizedKey] = (
        categoryId: group.categoryId,
        categoryName: group.categoryName,
        sortOrder: group.sortOrder,
      );
    }
  }

  // Process club groups — if key already exists, mark as shared; otherwise add as club-only
  final Map<String, ({int categoryId, String categoryName, int sortOrder})> clubCategoryByKey = {};
  for (final group in clubGroups) {
    for (final module in group.modules) {
      final normalizedKey = _normalizeKey(module.moduleKey);
      if (mergedByKey.containsKey(normalizedKey)) {
        // Shared module — update scope to include 'club', keep district's data
        final existing = mergedByKey[normalizedKey]!;
        mergedByKey[normalizedKey] = MergedModule(
          moduleId: existing.moduleId,
          moduleName: existing.moduleName,
          moduleKey: existing.moduleKey,
          iconClass: existing.iconClass,
          iconPath: existing.iconPath,
          routeUrl: existing.routeUrl,
          description: existing.description,
          scope: ['district', 'club'],
        );
        // Category already set from district
      } else {
        // Club-only module
        mergedByKey[normalizedKey] = MergedModule(
          moduleId: module.moduleId,
          moduleName: module.moduleName,
          moduleKey: module.moduleKey,
          iconClass: module.iconClass,
          iconPath: module.iconPath,
          routeUrl: module.routeUrl,
          description: module.description,
          scope: ['club'],
        );
        clubCategoryByKey[normalizedKey] = (
          categoryId: group.categoryId,
          categoryName: group.categoryName,
          sortOrder: group.sortOrder,
        );
      }
    }
  }

  // Merge category maps (district takes priority)
  final allCategoryByKey = <String, ({int categoryId, String categoryName, int sortOrder})>{
    ...clubCategoryByKey,
    ...categoryByKey,
  };

  // Group by categoryName
  final Map<String, List<MergedModule>> groupedModules = {};
  final Map<String, ({int categoryId, int sortOrder})> groupMeta = {};

  for (final entry in mergedByKey.entries) {
    final normalizedKey = entry.key;
    final module = entry.value;
    final cat = allCategoryByKey[normalizedKey];
    if (cat == null) continue;

    groupedModules.putIfAbsent(cat.categoryName, () => []).add(module);
    groupMeta[cat.categoryName] = (categoryId: cat.categoryId, sortOrder: cat.sortOrder);
  }

  // Build result list sorted by sortOrder
  final result = groupedModules.entries.map((e) {
    final meta = groupMeta[e.key]!;
    return MergedModuleGroup(
      categoryId: meta.categoryId,
      categoryName: e.key,
      sortOrder: meta.sortOrder,
      modules: e.value,
    );
  }).toList();

  result.sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
  return result;
}
