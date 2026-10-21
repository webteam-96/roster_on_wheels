class MergedModule {
  final int moduleId;
  final String moduleName;
  final String moduleKey;
  final String? iconClass;
  final String? iconPath;
  final String? routeUrl;
  final String? description;
  final List<String> scope; // ['district'], ['club'], or ['district', 'club']

  const MergedModule({
    required this.moduleId,
    required this.moduleName,
    required this.moduleKey,
    this.iconClass,
    this.iconPath,
    this.routeUrl,
    this.description,
    required this.scope,
  });

  bool get isShared => scope.contains('district') && scope.contains('club');
  bool get isDistrictOnly => !scope.contains('club');
  bool get isClubOnly => !scope.contains('district');
}

class MergedModuleGroup {
  final int categoryId;
  final String categoryName;
  final int sortOrder;
  final List<MergedModule> modules;

  const MergedModuleGroup({
    required this.categoryId,
    required this.categoryName,
    required this.sortOrder,
    required this.modules,
  });
}
