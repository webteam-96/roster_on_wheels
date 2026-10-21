class ModuleCategoryModel {
  final int id;
  final String categoryName;

  const ModuleCategoryModel({required this.id, required this.categoryName});

  factory ModuleCategoryModel.fromJson(Map<String, dynamic> json) {
    return ModuleCategoryModel(
      id: json['id'] as int? ?? 0,
      categoryName: json['categoryName'] as String? ?? '',
    );
  }
}

class ModuleModel {
  final int id;
  final String moduleName;
  final String? moduleCode;
  final int? categoryId;
  final String? categoryName;
  final String? icon;
  final int? sortOrder;
  final bool isActive;

  const ModuleModel({
    required this.id,
    required this.moduleName,
    this.moduleCode,
    this.categoryId,
    this.categoryName,
    this.icon,
    this.sortOrder,
    this.isActive = true,
  });

  factory ModuleModel.fromJson(Map<String, dynamic> json) {
    return ModuleModel(
      id: json['id'] as int? ?? 0,
      moduleName: json['moduleName'] as String? ?? '',
      moduleCode: json['moduleCode'] as String?,
      categoryId: json['categoryId'] as int?,
      categoryName: json['categoryName'] as String?,
      icon: json['icon'] as String?,
      sortOrder: json['sortOrder'] as int?,
      isActive: json['isActive'] as bool? ?? true,
    );
  }

  Map<String, dynamic> toJson() => {
    'moduleName': moduleName,
    'moduleCode': moduleCode,
    'categoryId': categoryId,
    'sortOrder': sortOrder,
    'isActive': isActive,
  };
}
