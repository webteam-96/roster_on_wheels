import 'package:rotary_flutter_app/core/utils/currency_symbol.dart';
class ProjectModel {
  final int id;
  final int? moduleId;
  final String? moduleName;
  final int? yearId;
  final String? yearName;
  final String title;
  final String? description;
  final String? location;
  final String? projectDate;
  final double? projectCost;
  final int? areaOfFocusId;
  final String? areaOfFocusName;
  final int? categoryId;
  final String? categoryName;
  final int? subCategoryId;
  final String? subCategoryName;
  final String? subCategoryOther;
  final int? fundingId;
  final String? fundingName;
  final int? directBeneficiaries;
  final int? attendance;
  final double? attendancePercentage;
  final String? photoPath;
  final bool isJointProject;
  final String? coHostName;
  final String? clubRole;
  final bool isActive;
  final String? createdAt;
  // ISO currency code the projectCost is denominated in (INR/LKR/NPR/USD).
  // The backend now stamps this per project row (default INR).
  final String? currency;

  const ProjectModel({
    required this.id,
    this.moduleId,
    this.moduleName,
    this.yearId,
    this.yearName,
    required this.title,
    this.description,
    this.location,
    this.projectDate,
    this.projectCost,
    this.areaOfFocusId,
    this.areaOfFocusName,
    this.categoryId,
    this.categoryName,
    this.subCategoryId,
    this.subCategoryName,
    this.subCategoryOther,
    this.fundingId,
    this.fundingName,
    this.directBeneficiaries,
    this.attendance,
    this.attendancePercentage,
    this.photoPath,
    this.isJointProject = false,
    this.coHostName,
    this.clubRole,
    this.isActive = true,
    this.createdAt,
    this.currency,
  });

  /// Symbol for this project's currency; the instance currency when unset (web getCurrencySymbol).
  String get currencySymbol => currencySymbolFor(currency);

  factory ProjectModel.fromJson(Map<String, dynamic> json) {
    return ProjectModel(
      id: json['id'] as int? ?? 0,
      moduleId: json['moduleId'] as int?,
      moduleName: json['moduleName'] as String?,
      yearId: json['yearId'] as int?,
      yearName: json['yearName'] as String?,
      title: json['title'] as String? ?? '',
      description: json['description'] as String?,
      location: json['location'] as String?,
      projectDate: json['projectDate'] as String?,
      projectCost: (json['projectCost'] as num?)?.toDouble(),
      areaOfFocusId: json['areaOfFocusId'] as int?,
      areaOfFocusName: json['areaOfFocusName'] as String?,
      categoryId: json['categoryId'] as int?,
      categoryName: json['categoryName'] as String?,
      subCategoryId: json['subCategoryId'] as int?,
      subCategoryName: json['subCategoryName'] as String?,
      subCategoryOther: json['subCategoryOther'] as String?,
      fundingId: json['fundingId'] as int?,
      fundingName: json['fundingName'] as String?,
      directBeneficiaries: json['directBeneficiaries'] as int?,
      attendance: json['attendance'] as int?,
      attendancePercentage: (json['attendancePercentage'] as num?)?.toDouble(),
      photoPath: json['photoPath'] as String?,
      isJointProject: json['isJointProject'] as bool? ?? false,
      coHostName: json['coHostName'] as String?,
      clubRole: json['clubRole'] as String?,
      isActive: json['isActive'] as bool? ?? true,
      createdAt: json['createdAt'] as String?,
      currency: json['currency'] as String?,
    );
  }

  Map<String, dynamic> toJson() => {
    'moduleId': moduleId,
    'yearId': yearId,
    'title': title,
    'description': description,
    'location': location,
    'projectDate': projectDate,
    'projectCost': projectCost,
    'areaOfFocusId': areaOfFocusId,
    'categoryId': categoryId,
    'subCategoryId': subCategoryId,
    'subCategoryOther': subCategoryOther,
    'fundingId': fundingId,
    'directBeneficiaries': directBeneficiaries,
    'attendance': attendance,
    'isJointProject': isJointProject,
    'coHostName': coHostName,
    'clubRole': clubRole,
    'isActive': isActive,
  };
}
