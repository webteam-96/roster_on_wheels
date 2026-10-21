class DashboardModuleModel {
  final int moduleId;
  final String moduleName;
  final String moduleKey;
  final String? iconClass;
  final String? iconPath;
  final String? routeUrl;
  final String? description;

  const DashboardModuleModel({
    required this.moduleId,
    required this.moduleName,
    required this.moduleKey,
    this.iconClass,
    this.iconPath,
    this.routeUrl,
    this.description,
  });

  factory DashboardModuleModel.fromJson(Map<String, dynamic> json) {
    return DashboardModuleModel(
      moduleId: json['moduleId'] as int? ?? 0,
      moduleName: json['moduleName'] as String? ?? '',
      moduleKey: json['moduleKey'] as String? ?? '',
      iconClass: json['iconClass'] as String?,
      iconPath: json['iconPath'] as String?,
      routeUrl: json['routeUrl'] as String?,
      description: json['description'] as String?,
    );
  }
}

class DashboardModuleGroup {
  final int categoryId;
  final String categoryName;
  final int sortOrder;
  final List<DashboardModuleModel> modules;

  const DashboardModuleGroup({
    required this.categoryId,
    required this.categoryName,
    required this.sortOrder,
    required this.modules,
  });

  factory DashboardModuleGroup.fromJson(Map<String, dynamic> json) {
    return DashboardModuleGroup(
      categoryId: json['categoryId'] as int? ?? 0,
      categoryName: json['categoryName'] as String? ?? '',
      sortOrder: json['sortOrder'] as int? ?? 0,
      modules: (json['modules'] as List<dynamic>? ?? [])
          .map((e) => DashboardModuleModel.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }
}
